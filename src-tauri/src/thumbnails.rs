//! Library thumbnails: a disposable disk cache plus the commands that fill and read it.
//!
//! A cached thumbnail is one file, `<key>.jpg`, holding an 8 byte header (`width` and `height`, both
//! big-endian `u32`) followed by a JPEG. The same bytes travel over IPC as a raw response, so the
//! webview reads the proportions from the header before it has decoded anything. The key hashes the
//! library path, the file length and its modification time, so an edited original never serves a stale
//! picture and nothing needs invalidating. Images are scaled here; PDFs (and AVIF, which the `image`
//! crate cannot decode) are rendered by the webview and stored through `put_library_thumbnail`.

use crate::{read_bounded, RawBytes, Shared, MAX_IMAGE};
use image::{codecs::jpeg::JpegEncoder, DynamicImage, ImageEncoder};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU32, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::InvokeBody, AppHandle, Manager};

/// Longest edge of a stored thumbnail, in pixels.
const MAX_EDGE: u32 = 480;
const JPEG_QUALITY: u8 = 82;
/// Disk budget for the whole cache; the oldest thumbnails go first once it is exceeded.
const CACHE_CAP: u64 = 192 * 1024 * 1024;
const PRUNE_EVERY: u32 = 32;
const STALE_TEMPORARY: Duration = Duration::from_secs(600);
const HEADER_LEN: usize = 8;
/// A webview-rendered thumbnail is at most this large (a 480 px JPEG is tens of KB).
const MAX_UPLOAD: usize = 1024 * 1024;
const MAX_UPLOAD_EDGE: u32 = 1024;
/// One range read, so a hostile caller cannot ask for a whole 300 MB file in one response.
const MAX_RANGE: u64 = 8 * 1024 * 1024;
/// Formats the `image` crate decodes here. AVIF is left to the webview.
const NATIVE_FORMATS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];
/// Dominant colours kept per thumbnail (the webview measures five).
const MAX_COLOURS: usize = 8;
/// Behind a transparent image, so a cut-out does not turn black when flattened to JPEG.
const FLATTEN_BACKGROUND: u8 = 238;

pub struct ThumbnailCache {
    dir: PathBuf,
    writes: AtomicU32,
}

/// `<key>` for a library path at a given file length and modification time (nanoseconds).
pub fn cache_key(path: &str, len: u64, modified_nanos: u128) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"thumb-v1\0");
    hasher.update(path.as_bytes());
    hasher.update(b"\0");
    hasher.update(len.to_le_bytes());
    hasher.update(modified_nanos.to_le_bytes());
    hasher.finalize()[..16].iter().map(|byte| format!("{byte:02x}")).collect()
}

/// `[width u32 BE][height u32 BE][jpeg]`.
pub fn encode_thumbnail(width: u32, height: u32, jpeg: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(HEADER_LEN + jpeg.len());
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(jpeg);
    bytes
}

/// The proportions in a thumbnail's header; `None` for anything that is not a whole thumbnail.
pub fn decode_header(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() <= HEADER_LEN {
        return None;
    }
    let width = u32::from_be_bytes(bytes[0..4].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[4..8].try_into().ok()?);
    (width > 0 && height > 0).then_some((width, height))
}

fn is_jpeg(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xff, 0xd8, 0xff])
}

/// Files to delete, oldest first, so that the rest fits in 90% of `cap`. Empty while within `cap`.
fn prune_plan(mut entries: Vec<(SystemTime, u64, PathBuf)>, cap: u64) -> Vec<PathBuf> {
    let mut total: u64 = entries.iter().map(|entry| entry.1).sum();
    if total <= cap {
        return Vec::new();
    }
    entries.sort_by_key(|entry| entry.0);
    let target = cap / 10 * 9;
    let mut doomed = Vec::new();
    for (_, len, path) in entries {
        if total <= target {
            break;
        }
        total -= len;
        doomed.push(path);
    }
    doomed
}

impl ThumbnailCache {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, writes: AtomicU32::new(0) }
    }

    fn file(&self, key: &str) -> PathBuf {
        self.dir.join(format!("{key}.jpg"))
    }

    fn get(&self, key: &str) -> Option<Vec<u8>> {
        let path = self.file(key);
        let bytes = fs::read(&path).ok()?;
        if decode_header(&bytes).is_some() && is_jpeg(&bytes[HEADER_LEN..]) {
            return Some(bytes);
        }
        // A torn or foreign file under a cache key is never served.
        let _ = fs::remove_file(path);
        None
    }

    /// Just the proportions, without reading the picture.
    fn dimensions(&self, key: &str) -> Option<(u32, u32)> {
        let mut header = [0u8; HEADER_LEN + 1];
        let mut file = fs::File::open(self.file(key)).ok()?;
        file.read_exact(&mut header).ok()?;
        decode_header(&header)
    }

    fn colour_file(&self, key: &str) -> PathBuf {
        self.dir.join(format!("{key}.col"))
    }

    fn colours(&self, key: &str) -> Vec<u32> {
        fs::read(self.colour_file(key)).map(|bytes| decode_colours(&bytes)).unwrap_or_default()
    }

    fn put_colours(&self, key: &str, colours: &[u32]) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|e| format!("Thumbnail cache is unavailable: {e}"))?;
        fs::write(self.colour_file(key), encode_colours(colours)).map_err(|e| format!("Colours could not be saved: {e}"))
    }

    fn put(&self, key: &str, bytes: &[u8]) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|e| format!("Thumbnail cache is unavailable: {e}"))?;
        // Rename into place so a reader never sees half a file.
        let temporary = self.dir.join(format!("{key}.{}.tmp", std::process::id()));
        fs::write(&temporary, bytes).map_err(|e| format!("Thumbnail could not be saved: {e}"))?;
        fs::rename(&temporary, self.file(key)).map_err(|e| {
            let _ = fs::remove_file(&temporary);
            format!("Thumbnail could not be saved: {e}")
        })?;
        if self.writes.fetch_add(1, Ordering::Relaxed) % PRUNE_EVERY == 0 {
            self.prune();
        }
        Ok(())
    }

    fn prune(&self) {
        self.prune_to(CACHE_CAP);
    }

    fn prune_to(&self, cap: u64) {
        let Ok(read) = fs::read_dir(&self.dir) else { return };
        let mut entries = Vec::new();
        for entry in read.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            let modified = meta.modified().unwrap_or(UNIX_EPOCH);
            match path.extension().and_then(|ext| ext.to_str()) {
                Some("jpg") => entries.push((modified, meta.len(), path)),
                // A write that died half way leaves its temporary file behind; none is in flight this long after.
                Some("tmp") if modified.elapsed().is_ok_and(|age| age > STALE_TEMPORARY) => {
                    let _ = fs::remove_file(&path);
                }
                _ => {}
            }
        }
        for path in prune_plan(entries, cap) {
            let _ = fs::remove_file(path.with_extension("col"));
            let _ = fs::remove_file(path);
        }
    }
}

/// Colours are packed 0xRRGGBB and stored three bytes each, so a sidecar is at most `3 * MAX_COLOURS` bytes.
fn encode_colours(colours: &[u32]) -> Vec<u8> {
    colours.iter().take(MAX_COLOURS).flat_map(|colour| [(colour >> 16) as u8, (colour >> 8) as u8, *colour as u8]).collect()
}

/// Empty for anything that is not a whole sidecar.
fn decode_colours(bytes: &[u8]) -> Vec<u32> {
    if bytes.len() % 3 != 0 || bytes.len() > 3 * MAX_COLOURS {
        return Vec::new();
    }
    bytes.chunks_exact(3).map(|rgb| u32::from(rgb[0]) << 16 | u32::from(rgb[1]) << 8 | u32::from(rgb[2])).collect()
}

fn validate_colours(colours: &[u32]) -> Result<(), String> {
    if colours.len() > MAX_COLOURS || colours.iter().any(|colour| *colour > 0xff_ffff) {
        return Err("Colours must be at most eight 24-bit values.".into());
    }
    Ok(())
}

/// Length and modification time (ns since the epoch) of the original: the freshness part of the key.
fn fingerprint_of(meta: &fs::Metadata) -> (u64, u128) {
    let modified = meta.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map_or(0, |span| span.as_nanos());
    (meta.len(), modified)
}

fn fingerprint(path: &Path) -> Result<(u64, u128), String> {
    let meta = fs::metadata(path).map_err(|e| format!("Original is unavailable: {e}. Use Locate to reconnect it."))?;
    Ok(fingerprint_of(&meta))
}

/// Bytes of a cache key, as sent over IPC ahead of a payload.
const KEY_LEN: usize = 32;

fn with_key(key: &str, payload: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(KEY_LEN + payload.len());
    bytes.extend_from_slice(key.as_bytes());
    bytes.extend_from_slice(payload);
    bytes
}

/// `[total file length u64 BE][key][bytes]`: the key names the exact file state these bytes came from.
fn range_response(total: u64, key: &str, bytes: &[u8]) -> Vec<u8> {
    let mut response = Vec::with_capacity(8 + KEY_LEN + bytes.len());
    response.extend_from_slice(&total.to_be_bytes());
    response.extend_from_slice(key.as_bytes());
    response.extend_from_slice(bytes);
    response
}

/// Up to `length` (and `MAX_RANGE`) bytes from `offset`; empty at or past the end of the file.
fn read_range(file: &mut (impl Read + Seek), total: u64, offset: u64, length: u64) -> std::io::Result<Vec<u8>> {
    let want = length.min(MAX_RANGE).min(total.saturating_sub(offset));
    let mut bytes = Vec::with_capacity(want as usize);
    if want > 0 {
        file.seek(SeekFrom::Start(offset))?;
        file.take(want).read_to_end(&mut bytes)?;
    }
    Ok(bytes)
}

/// An upload is only stored if the original is still the file it was made from.
fn verify_key(provided: &str, current: &str) -> Result<(), String> {
    if provided == current { Ok(()) } else { Err("The original changed while its thumbnail was being made.".into()) }
}

fn header_key(request: &tauri::ipc::Request<'_>) -> Result<String, String> {
    request.headers().get("x-library-key").and_then(|value| value.to_str().ok()).filter(|key| key.len() == KEY_LEN).map(str::to_string).ok_or_else(|| "A thumbnail needs the key of the file it was made from.".to_string())
}

/// Resolves library paths to their originals on disk and each entry's format. The store lock is held
/// only to copy what is needed (one pass over the library, one catalog query per path); canonicalising
/// the originals, which may sit on a slow network volume, happens after it is released. A path that the
/// catalog cannot resolve falls back to the entry's own path, which must have been authorised.
fn lookup(app: &AppHandle, paths: &[String]) -> Vec<Result<(PathBuf, String), String>> {
    type Planned = Result<(Option<crate::catalog::Original>, PathBuf, String), String>;
    let shared = app.state::<Shared>();
    let (planned, authorized): (Vec<Planned>, _) = {
        let Ok(store) = shared.lock() else {
            return paths.iter().map(|_| Err("Reading state is unavailable".to_string())).collect();
        };
        let documents: HashMap<&str, &crate::state::LibraryDocument> = store.saved.library.documents.iter().map(|doc| (doc.path.as_str(), doc)).collect();
        let planned = paths
            .iter()
            .map(|path| {
                let doc = documents.get(path.as_str()).ok_or("Item is no longer in the library.")?;
                let primary = store.catalog.as_ref().and_then(|catalog| catalog.plan(&store.saved.library, path).ok());
                Ok((primary, PathBuf::from(&doc.path), doc.format.clone()))
            })
            .collect();
        (planned, store.authorized.clone())
    };
    planned
        .into_iter()
        .map(|plan| {
            let (primary, fallback, format) = plan?;
            if let Some(resolved) = primary.and_then(|original| original.open().ok()) {
                return Ok((resolved, format));
            }
            let candidate = fs::canonicalize(&fallback).map_err(|e| format!("Original is unavailable: {e}. Use Locate to reconnect it."))?;
            if !authorized.contains(&candidate) {
                return Err("This document has not been authorized on this machine.".into());
            }
            Ok((candidate, format))
        })
        .collect()
}

fn lookup_one(app: &AppHandle, path: &str) -> Result<(PathBuf, String), String> {
    lookup(app, std::slice::from_ref(&path.to_string())).remove(0)
}

/// Scales a decoded image to at most `MAX_EDGE` px and encodes it as JPEG. `None` when the `image`
/// crate cannot decode the format here (AVIF), which the webview then handles.
fn make_thumbnail(bytes: &[u8], format: &str) -> Result<Option<(u32, u32, Vec<u8>)>, String> {
    if !NATIVE_FORMATS.contains(&format.to_ascii_lowercase().as_str()) {
        return Ok(None);
    }
    let image = image::load_from_memory(bytes).map_err(|_| "Image could not be decoded.".to_string())?;
    let scaled = if image.width() > MAX_EDGE || image.height() > MAX_EDGE { image.thumbnail(MAX_EDGE, MAX_EDGE) } else { image };
    let rgb = flatten(scaled);
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY)
        .write_image(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("Thumbnail could not be encoded: {e}"))?;
    Ok(Some((rgb.width(), rgb.height(), jpeg)))
}

/// RGB with any transparency blended onto a light neutral.
fn flatten(image: DynamicImage) -> image::RgbImage {
    if !image.color().has_alpha() {
        return image.into_rgb8();
    }
    let mut rgba = image.into_rgba8();
    for pixel in rgba.pixels_mut() {
        let alpha = u32::from(pixel[3]);
        for channel in 0..3 {
            pixel[channel] = ((u32::from(pixel[channel]) * alpha + u32::from(FLATTEN_BACKGROUND) * (255 - alpha) + 127) / 255) as u8;
        }
    }
    DynamicImage::ImageRgba8(rgba).into_rgb8()
}

/// The cached thumbnail, scaling a decodable image on a miss, behind the 32-byte key of the file state it
/// describes. An empty payload means "not here": the webview should render this one (PDF, AVIF) and hand
/// it back through `put_library_thumbnail` with the same key.
#[tauri::command]
pub async fn read_library_thumbnail(path: String, app: AppHandle) -> Result<RawBytes, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (resolved, format) = lookup_one(&app, &path)?;
        let (len, modified) = fingerprint(&resolved)?;
        let cache = app.state::<ThumbnailCache>();
        let key = cache_key(&path, len, modified);
        if let Some(bytes) = cache.get(&key) {
            return Ok(RawBytes::new(with_key(&key, &bytes)));
        }
        if !NATIVE_FORMATS.contains(&format.to_ascii_lowercase().as_str()) {
            return Ok(RawBytes::new(with_key(&key, &[])));
        }
        let bytes = read_bounded(&resolved, MAX_IMAGE)?;
        let Some((width, height, jpeg)) = make_thumbnail(&bytes, &format)? else {
            return Ok(RawBytes::new(with_key(&key, &[])));
        };
        let encoded = encode_thumbnail(width, height, &jpeg);
        // A full disk must not hide a thumbnail that was made fine.
        let _ = cache.put(&key, &encoded);
        Ok(RawBytes::new(with_key(&key, &encoded)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stores a thumbnail the webview rendered. The body is the cached file format; the library path travels
/// percent-encoded in `x-library-path`, and `x-library-key` is the key of the file state it was rendered
/// from (from `read_library_range`): if the original has changed since, the upload is refused.
#[tauri::command]
pub async fn put_library_thumbnail(request: tauri::ipc::Request<'_>, app: AppHandle) -> Result<(), String> {
    let path = request
        .headers()
        .get("x-library-path")
        .and_then(|value| value.to_str().ok())
        .and_then(percent_decode)
        .ok_or("A thumbnail needs the library path it belongs to.")?;
    let provided = header_key(&request)?;
    let InvokeBody::Raw(body) = request.body() else {
        return Err("A thumbnail must be sent as raw bytes.".into());
    };
    let body = validate_upload(body)?.to_vec();
    tauri::async_runtime::spawn_blocking(move || {
        let (resolved, _) = lookup_one(&app, &path)?;
        let (len, modified) = fingerprint(&resolved)?;
        let key = cache_key(&path, len, modified);
        verify_key(&provided, &key)?;
        app.state::<ThumbnailCache>().put(&key, &body)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn validate_upload(body: &[u8]) -> Result<&[u8], String> {
    if body.len() > MAX_UPLOAD {
        return Err("This thumbnail is too large.".into());
    }
    let (width, height) = decode_header(body).ok_or("This thumbnail has no size header.")?;
    if width > MAX_UPLOAD_EDGE || height > MAX_UPLOAD_EDGE {
        return Err("This thumbnail is too large.".into());
    }
    if !is_jpeg(&body[HEADER_LEN..]) {
        return Err("A thumbnail must be a JPEG.".into());
    }
    Ok(body)
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let digits = value.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(digits, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// What the disk cache knows about one thumbnail: its pixel size and up to five dominant colours (packed
/// 0xRRGGBB). Colours are absent for thumbnails made before the colour filter existed; the webview computes
/// them the next time it loads such a thumbnail and stores them with `put_library_colours`.
#[derive(serde::Serialize)]
pub struct ThumbnailInfo {
    size: [u32; 2],
    colours: Vec<u32>,
}

/// Size and colours of the thumbnails that are already cached, so the grid can reserve every tile's real
/// shape and the colour filter can answer before a single picture has loaded. Entries without a cached
/// thumbnail are absent.
#[tauri::command]
pub async fn library_thumbnail_index(paths: Vec<String>, app: AppHandle) -> Result<HashMap<String, ThumbnailInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let resolved = lookup(&app, &paths);
        let cache = app.state::<ThumbnailCache>();
        let mut known = HashMap::new();
        for (path, found) in paths.into_iter().zip(resolved) {
            let Ok((original, _)) = found else { continue };
            let Ok((len, modified)) = fingerprint(&original) else { continue };
            let key = cache_key(&path, len, modified);
            if let Some((width, height)) = cache.dimensions(&key) {
                known.insert(path, ThumbnailInfo { size: [width, height], colours: cache.colours(&key) });
            }
        }
        Ok(known)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stores the dominant colours the webview measured for a thumbnail, under the key of the file state it was
/// measured from; refused if the original has changed since.
#[tauri::command]
pub async fn put_library_colours(path: String, colours: Vec<u32>, key: String, app: AppHandle) -> Result<(), String> {
    validate_colours(&colours)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (resolved, _) = lookup_one(&app, &path)?;
        let (len, modified) = fingerprint(&resolved)?;
        let current = cache_key(&path, len, modified);
        verify_key(&key, &current)?;
        app.state::<ThumbnailCache>().put_colours(&current, &colours)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `[total file length u64 BE][key][up to `length` bytes from `offset`]`, so the webview can render page 1
/// of a PDF that is far larger than the part it needs, and tell if the file changed between reads.
#[tauri::command]
pub async fn read_library_range(path: String, offset: u64, length: u64, app: AppHandle) -> Result<RawBytes, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (resolved, _) = lookup_one(&app, &path)?;
        let mut file = fs::File::open(&resolved).map_err(|e| format!("Could not open {}: {e}", resolved.display()))?;
        let (total, modified) = fingerprint_of(&file.metadata().map_err(|e| e.to_string())?);
        let bytes = read_range(&mut file, total, offset, length).map_err(|e| e.to_string())?;
        Ok(RawBytes::new(range_response(total, &cache_key(&path, total, modified), &bytes)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const JPEG: [u8; 4] = [0xff, 0xd8, 0xff, 0xe0];

    #[test]
    fn cache_key_follows_path_length_and_modification_time() {
        let key = cache_key("folder:a:x.pdf", 1000, 42);
        assert_eq!(key, cache_key("folder:a:x.pdf", 1000, 42));
        assert_eq!(key.len(), 32);
        assert!(key.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(key, cache_key("folder:a:y.pdf", 1000, 42));
        assert_ne!(key, cache_key("folder:a:x.pdf", 1001, 42));
        assert_ne!(key, cache_key("folder:a:x.pdf", 1000, 43));
        // Field boundaries are part of the hash: shifting a digit from one field to the next changes it.
        assert_ne!(cache_key("a", 10, 1), cache_key("a1", 0, 1));
    }

    #[test]
    fn header_round_trips_and_refuses_anything_that_is_not_a_thumbnail() {
        let bytes = encode_thumbnail(320, 480, &JPEG);
        assert_eq!(&bytes[..8], &[0, 0, 1, 64, 0, 0, 1, 224]);
        assert_eq!(&bytes[8..], &JPEG);
        assert_eq!(decode_header(&bytes), Some((320, 480)));
        assert_eq!(decode_header(&bytes[..8]), None, "a header without a picture is not a thumbnail");
        assert_eq!(decode_header(&bytes[..3]), None);
        assert_eq!(decode_header(&encode_thumbnail(0, 480, &JPEG)), None);
        assert_eq!(decode_header(&encode_thumbnail(320, 0, &JPEG)), None);
    }

    #[test]
    fn uploads_must_be_small_jpegs_with_a_sane_size() {
        let good = encode_thumbnail(300, 400, &JPEG);
        assert!(validate_upload(&good).is_ok());
        assert!(validate_upload(&encode_thumbnail(300, 400, b"\x89PNG")).is_err());
        assert!(validate_upload(&encode_thumbnail(MAX_UPLOAD_EDGE + 1, 400, &JPEG)).is_err());
        // A real JPEG start (so only the size can be wrong): exactly the limit passes, one byte over is refused.
        let padded = |len: usize| { let mut jpeg = JPEG.to_vec(); jpeg.resize(len - HEADER_LEN, 0); encode_thumbnail(300, 400, &jpeg) };
        assert!(validate_upload(&padded(MAX_UPLOAD)).is_ok());
        assert!(validate_upload(&padded(MAX_UPLOAD + 1)).unwrap_err().contains("too large"));
        assert!(validate_upload(b"").is_err());
    }

    #[test]
    fn library_paths_survive_the_header() {
        assert_eq!(percent_decode("folder%3A1%3AFashion%20photo%2Fa%C3%A9.pdf").as_deref(), Some("folder:1:Fashion photo/aé.pdf"));
        assert_eq!(percent_decode("plain.pdf").as_deref(), Some("plain.pdf"));
        assert_eq!(percent_decode("bad%zz"), None);
        assert_eq!(percent_decode("cut%4"), None);
        assert_eq!(percent_decode("%ff"), None, "not UTF-8");
    }

    #[test]
    fn cache_serves_whole_thumbnails_and_drops_corrupt_ones() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ThumbnailCache::new(dir.path().join("thumbs"));
        let key = cache_key("p", 1, 1);
        assert!(cache.get(&key).is_none());
        let stored = encode_thumbnail(10, 20, &JPEG);
        cache.put(&key, &stored).unwrap();
        assert_eq!(cache.get(&key), Some(stored));
        assert_eq!(cache.dimensions(&key), Some((10, 20)));
        assert_eq!(cache.dimensions(&cache_key("other", 1, 1)), None);
        fs::write(cache.file(&key), [0u8; 20]).unwrap();
        assert!(cache.get(&key).is_none());
        assert!(!cache.file(&key).exists(), "a corrupt entry is removed rather than retried forever");
    }

    #[test]
    fn colours_round_trip_as_three_bytes_each_and_refuse_anything_else() {
        let colours = [0x2e8b3a, 0xffffff, 0x000000, 0x0102ff];
        let bytes = encode_colours(&colours);
        assert_eq!(bytes.len(), 12);
        assert_eq!(&bytes[..3], &[0x2e, 0x8b, 0x3a]);
        assert_eq!(decode_colours(&bytes), colours);
        assert_eq!(decode_colours(&[]), Vec::<u32>::new());
        assert_eq!(decode_colours(&[1, 2]), Vec::<u32>::new(), "a torn file yields no colours rather than wrong ones");
        assert_eq!(decode_colours(&vec![7; 3 * (MAX_COLOURS + 1)]), Vec::<u32>::new());
        assert_eq!(encode_colours(&[1; 20]).len(), 3 * MAX_COLOURS, "extra colours are dropped");
    }

    #[test]
    fn colours_live_beside_the_thumbnail_and_go_with_it() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ThumbnailCache::new(dir.path().join("thumbs"));
        let key = cache_key("p", 1, 1);
        assert!(cache.colours(&key).is_empty());
        cache.put(&key, &encode_thumbnail(10, 20, &JPEG)).unwrap();
        cache.put_colours(&key, &[0x336699, 0xeeeeee]).unwrap();
        assert_eq!(cache.colours(&key), vec![0x336699, 0xeeeeee]);
        // Colours from a thumbnail that was pruned must not outlive it in the index.
        fs::remove_file(cache.file(&key)).unwrap();
        assert_eq!(cache.dimensions(&key), None);
        assert!(validate_colours(&[0x1000000]).is_err(), "more than 24 bits is not a colour");
        assert!(validate_colours(&[0xffffff; MAX_COLOURS + 1]).is_err());
        assert!(validate_colours(&[0xffffff; MAX_COLOURS]).is_ok());
    }

    #[test]
    fn pruning_removes_the_oldest_first_and_only_when_over_the_cap() {
        let base = UNIX_EPOCH + Duration::from_secs(1_000);
        let entry = |age: u64, len: u64, name: &str| (base + Duration::from_secs(age), len, PathBuf::from(name));
        let entries = vec![entry(3, 40, "new"), entry(1, 40, "old"), entry(2, 40, "mid")];
        assert!(prune_plan(entries.clone(), 120).is_empty(), "exactly at the cap is within it");
        // 120 bytes against a cap of 100 drops down to at most 90: the oldest alone is enough.
        assert_eq!(prune_plan(entries.clone(), 100), vec![PathBuf::from("old")]);
        // Against a cap of 70 (target 63) two must go, oldest first, and the newest stays.
        assert_eq!(prune_plan(entries, 70), vec![PathBuf::from("old"), PathBuf::from("mid")]);
        assert!(prune_plan(Vec::new(), 10).is_empty());
    }

    #[test]
    fn images_are_scaled_to_the_edge_and_keep_their_proportions() {
        let mut png = Vec::new();
        DynamicImage::ImageRgb8(image::RgbImage::from_pixel(1200, 600, image::Rgb([10, 120, 200])))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let (width, height, jpeg) = make_thumbnail(&png, "png").unwrap().unwrap();
        assert_eq!((width, height), (480, 240));
        assert!(is_jpeg(&jpeg));
        assert_eq!(image::load_from_memory(&jpeg).unwrap().width(), 480);
        // Small images are not enlarged.
        let mut small = Vec::new();
        DynamicImage::ImageRgb8(image::RgbImage::new(64, 32)).write_to(&mut std::io::Cursor::new(&mut small), image::ImageFormat::Png).unwrap();
        assert_eq!(make_thumbnail(&small, "PNG").unwrap().map(|(w, h, _)| (w, h)), Some((64, 32)));
        assert!(make_thumbnail(b"not an image", "png").is_err());
        assert!(make_thumbnail(&png, "avif").unwrap().is_none(), "AVIF and PDF are left to the webview");
        assert!(make_thumbnail(&png, "pdf").unwrap().is_none());
    }

    #[test]
    fn transparency_is_flattened_onto_a_light_background_not_black() {
        let transparent = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(4, 4, image::Rgba([0, 0, 0, 0])));
        assert_eq!(flatten(transparent).get_pixel(0, 0).0, [FLATTEN_BACKGROUND; 3]);
        let opaque = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(4, 4, image::Rgba([10, 20, 30, 255])));
        assert_eq!(flatten(opaque).get_pixel(0, 0).0, [10, 20, 30]);
    }

    #[test]
    fn pruning_removes_the_colour_file_with_its_thumbnail_and_cleans_only_stale_temporaries() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ThumbnailCache::new(dir.path().to_path_buf());
        let set_age = |path: &Path, seconds: u64| fs::File::options().write(true).open(path).unwrap().set_modified(SystemTime::now() - Duration::from_secs(seconds)).unwrap();
        for (name, age) in [("old", 300), ("new", 10)] {
            let key = format!("{name:0>32}");
            fs::write(cache.file(&key), vec![0u8; 100]).unwrap();
            cache.put_colours(&key, &[0x112233]).unwrap();
            set_age(&cache.file(&key), age);
        }
        let stale = dir.path().join(format!("{:0>32}.1.tmp", "a")); let fresh = dir.path().join(format!("{:0>32}.2.tmp", "b"));
        fs::write(&stale, b"half").unwrap(); fs::write(&fresh, b"half").unwrap();
        set_age(&stale, 3600); set_age(&fresh, 5);
        // Two 100-byte thumbnails against a cap of 150: the older goes, with its colours; the newer stays with its own.
        cache.prune_to(150);
        let (old, new) = (format!("{:0>32}", "old"), format!("{:0>32}", "new"));
        assert!(!cache.file(&old).exists() && !cache.colour_file(&old).exists());
        assert!(cache.file(&new).exists() && cache.colours(&new) == vec![0x112233]);
        assert!(!stale.exists(), "a temporary from a write that died is removed");
        assert!(fresh.exists(), "a temporary that may still be written is left alone");
    }

    #[test]
    fn range_reads_stop_at_the_limit_and_at_the_end_of_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("big.bin");
        let size = MAX_RANGE as usize + 1000;
        fs::write(&path, (0..size).map(|i| (i % 251) as u8).collect::<Vec<_>>()).unwrap();
        let total = size as u64;
        let mut file = fs::File::open(&path).unwrap();
        assert_eq!(read_range(&mut file, total, 0, u64::MAX).unwrap().len() as u64, MAX_RANGE, "never more than the limit");
        let tail = read_range(&mut file, total, total - 10, 100).unwrap();
        assert_eq!(tail.len(), 10, "a read crossing the end returns what is there");
        assert_eq!(tail[0], ((size - 10) % 251) as u8);
        assert!(read_range(&mut file, total, total, 10).unwrap().is_empty());
        assert!(read_range(&mut file, total, total + 5_000, 10).unwrap().is_empty(), "past the end is empty, not an error");
        assert!(read_range(&mut file, total, 3, 0).unwrap().is_empty());
        assert_eq!(read_range(&mut file, total, 250, 3).unwrap(), vec![(250 % 251) as u8, 0, 1]);
    }

    #[test]
    fn range_responses_carry_the_total_then_the_key_then_the_bytes() {
        let key = cache_key("p", 1234, 99);
        let response = range_response(1234, &key, b"abc");
        assert_eq!(&response[..8], &1234u64.to_be_bytes());
        assert_eq!(&response[8..8 + KEY_LEN], key.as_bytes());
        assert_eq!(&response[8 + KEY_LEN..], b"abc");
        assert_eq!(key.len(), KEY_LEN);
        assert_eq!(with_key(&key, &[1, 2]).len(), KEY_LEN + 2);
    }

    #[test]
    fn an_upload_made_from_old_bytes_is_refused_once_the_original_changed() {
        let before = cache_key("p", 1000, 10);
        assert!(verify_key(&before, &cache_key("p", 1000, 10)).is_ok());
        assert!(verify_key(&before, &cache_key("p", 1000, 11)).unwrap_err().contains("changed"), "same length, new mtime");
        assert!(verify_key(&before, &cache_key("p", 1001, 10)).is_err(), "same mtime, new length");
    }
}
