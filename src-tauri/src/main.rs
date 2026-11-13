#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assistant;
mod state;
mod windows;
mod catalog;
mod folder_index;
mod thumbnails;

use serde::Serialize;
use serde_json::Value;
use crate::state::{Library, LibraryChange, LibraryDocument, Progress, ReadingState, Recent, Store, TabSession, WindowState};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, Arc},
    time::Duration,
};
use tauri::{window::Color, AppHandle, Emitter, Manager, State};

type Shared = Arc<Mutex<Store>>;
const MAX_DOCUMENT: u64 = 300 * 1024 * 1024;

/// Sends raw bytes over IPC instead of a JSON number array.
type RawBytes = tauri::ipc::Response;
const MAX_IMAGE: u64 = 20 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedFile {
    id: String,
    path: String,
    name: String,
    format: String,
    previous_state: Option<ReadingState>,
    warning: Option<String>,
}

#[derive(Serialize)]
struct StateView {
    recents: Vec<Recent>,
    window: WindowState,
    tabs: TabSession,
    warning: Option<String>,
}

fn document_format(path: &Path) -> Result<&'static str, String> {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "pdf" => Ok("pdf"),
        "epub" => Ok("epub"),
        "md" | "markdown" => Ok("md"),
        "txt" => Ok("txt"),
        "png" => Ok("png"),
        "jpg" => Ok("jpg"),
        "jpeg" => Ok("jpeg"),
        "webp" => Ok("webp"),
        "gif" => Ok("gif"),
        "avif" => Ok("avif"),
        "bmp" => Ok("bmp"),
        _ => Err("Unsupported file type. Choose a PDF, EPUB, Markdown, text, or supported image file.".into()),
    }
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| format!("Could not open {}: {e}. If it is stored in the cloud, make it available offline first.", path.display()))?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Choose a document file, not a folder.".into());
    }
    if metadata.len() > limit {
        return Err(format!(
            "This prototype supports files up to {} MiB.",
            limit / 1024 / 1024
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Could not finish reading the file: {e}"))?;
    if bytes.len() as u64 > limit {
        return Err("File grew beyond the supported size while being read.".into());
    }
    Ok(bytes)
}

#[tauri::command]
async fn open_file(app: AppHandle, path: Option<String>) -> Result<Option<OpenedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<Shared>();
        let candidate = if let Some(path) = path {
            let canonical = fs::canonicalize(&path).map_err(|e| format!("Could not find or access this file: {e}. Use Open to locate it."))?;
            if !shared.lock().map_err(|_| "Reading state is unavailable")?.authorized.contains(&canonical) {
                return Err("This file has not been authorized. Use Open, drop the file here, or open it from the system file browser.".into());
            }
            canonical
        } else {
            let mut dialog = rfd::FileDialog::new().set_title("Open a document or image").add_filter("Documents and images", &["pdf", "epub", "md", "markdown", "txt", "png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"]);
            if let Some(window) = app.get_webview_window("main") { dialog = dialog.set_parent(&window); }
            let Some(chosen) = dialog.pick_file() else { return Ok(None); };
            let canonical = fs::canonicalize(chosen).map_err(|e| e.to_string())?;
            shared.lock().map_err(|_| "Reading state is unavailable")?.authorized.insert(canonical.clone());
            canonical
        };
        let path = candidate.to_string_lossy().into_owned();
        opened_document(&shared, &candidate, &path).map(Some)
    }).await.map_err(|e| e.to_string())?
}

fn opened_document(shared: &Shared, resolved: &Path, path: &str) -> Result<OpenedFile, String> {
    let name = resolved
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let format = document_format(resolved)?;
    let mut store = shared.lock().map_err(|_| "Reading state is unavailable")?;
    let previous_state = store.saved.documents.get(path).cloned();
    if previous_state.is_none() {
        store.saved.path_ids.insert(path.to_string(), path.to_string());
    }
    let recent = Recent {
        id: path.to_string(),
        path: path.to_string(),
        name: name.clone(),
        format: format.to_string(),
        last_opened: crate::state::now(),
    };
    store.opened.insert(recent.id.clone(), recent.clone());
    store.opened_aliases.insert((recent.id.clone(), recent.path.clone()), recent);
    drop(store);
    Ok(OpenedFile {
        id: path.to_string(),
        path: path.to_string(),
        name,
        format: format.to_string(),
        previous_state,
        warning: None,
    })
}

/// Resolves the real file for a document that was opened previously: library
/// overrides and source roots first, then dialog/CLI paths already authorized.
fn resolve_readable(store: &Store, path: &str) -> Result<PathBuf, String> {
    if let Some(catalog) = store.catalog.as_ref() {
        match catalog.resolve(&store.saved.library, path) {
            Ok(resolved) => return Ok(resolved),
            Err(_) => {}
        }
    }
    let canonical = fs::canonicalize(path).map_err(|e| format!("Original is unavailable: {e}. Use Locate to reconnect it."))?;
    if !store.authorized.contains(&canonical) {
        return Err("This file has not been authorized. Use Open, drop the file here, or open it from the system file browser.".into());
    }
    Ok(canonical)
}

/// Streams a document's bytes as a raw IPC response instead of JSON numbers.
#[tauri::command]
async fn read_document_bytes(path: String, app: AppHandle) -> Result<RawBytes, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<Shared>();
        let store = shared.lock().map_err(|_| "Reading state is unavailable")?;
        let resolved = resolve_readable(&store, &path)?;
        drop(store);
        let bytes = read_bounded(&resolved, MAX_DOCUMENT)?;
        Ok(RawBytes::new(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn resolve_original(store: &Store, library_path: &str) -> Result<PathBuf, String> {
    if let Some(catalog) = store.catalog.as_ref() {
        if let Ok(resolved) = catalog.resolve(&store.saved.library, library_path) {
            return Ok(resolved);
        }
    }
    let document = store
        .saved
        .library
        .documents
        .iter()
        .find(|d| d.path == library_path)
        .ok_or("Item is no longer in the library.")?;
    let candidate = fs::canonicalize(&document.path).map_err(|e| format!("Original is unavailable: {e}. Use Locate to reconnect it."))?;
    if !store.authorized.contains(&candidate) {
        return Err("This document has not been authorized on this machine.".into());
    }
    Ok(candidate)
}

#[tauri::command]
async fn choose_source_root(id: String, app: AppHandle) -> Result<Library, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new().set_title("Choose the storage folder for this source");
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let chosen = dialog.pick_folder();
        let Some(chosen) = chosen else {
            let shared = app.state::<Shared>();
            return shared.lock().map_err(|_| "Reading state is unavailable")?.library();
        };
        let shared = app.state::<Shared>();
        let mut store = shared.lock().map_err(|_| "Reading state is unavailable")?;
        let mut library = store.saved.library.clone();
        let root = library.roots.iter_mut().find(|root| root.id == id).ok_or("Source root is no longer in the library.")?;
        let canonical = fs::canonicalize(&chosen).map_err(|e| format!("Could not access this folder: {e}"))?;
        root.path = Some(canonical.to_string_lossy().into_owned());
        store.authorized.insert(canonical);
        drop(store);
        let mut store = shared.lock().map_err(|_| "Reading state is unavailable")?;
        store.commit_library(library, None)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn locate_library_document(path: String, app: AppHandle) -> Result<Library, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new()
            .set_title("Locate the original file")
            .add_filter("Original file", &["pdf", "epub", "md", "markdown", "txt", "png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"]);
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let chosen = dialog.pick_file();
        let Some(chosen) = chosen else {
            let shared = app.state::<Shared>();
            return shared.lock().map_err(|_| "Reading state is unavailable")?.library();
        };
        let canonical = fs::canonicalize(&chosen).map_err(|e| format!("Could not access this file: {e}"))?;
        let shared = app.state::<Shared>();
        let mut store = shared.lock().map_err(|_| "Reading state is unavailable")?;
        let library = store.saved.library.clone();
        {
            let catalog = store.catalog.as_mut().ok_or("Library database is unavailable.")?;
            catalog.locate(&library, &path, &canonical)?;
        }
        store.authorized.insert(canonical);
        store.commit_library(library, None)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_library_document(path: String, app: AppHandle) -> Result<OpenedFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<Shared>();
        let store = shared.lock().map_err(|_| "Reading state is unavailable")?;
        let resolved = resolve_original(&store, &path)?;
        drop(store);
        opened_document(&shared, &resolved, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Indexes the PDFs below a user-chosen folder. Cancelling leaves the library unchanged.
#[tauri::command]
async fn index_folder(app: AppHandle) -> Result<Library, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<Shared>();
        let mut dialog = rfd::FileDialog::new().set_title("Choose a folder of documents to index");
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let Some(chosen) = dialog.pick_folder() else {
            return shared.lock().map_err(|_| "Reading state is unavailable")?.library();
        };
        // Walk without holding the store lock; the merge below starts from the latest library.
        let index = folder_index::index_folder(&chosen)?;
        let mut store = shared.lock().map_err(|_| "Reading state is unavailable")?;
        let merged = folder_index::merge(&store.library()?, &index)?;
        let library = store.commit_library(merged, None)?;
        store.authorized.insert(index.root);
        Ok(library)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_state(state: State<'_, Shared>) -> Result<StateView, String> {
    let store = state.lock().map_err(|_| "Reading state is unavailable")?;
    Ok(StateView {
        recents: store.saved.recents.clone(),
        window: store.saved.window.clone(),
        tabs: store.saved.tabs.clone(),
        warning: store.warning.clone(),
    })
}

#[tauri::command]
fn save_tabs(session: TabSession, state: State<'_, Shared>) -> Result<(), String> {
    state.lock().map_err(|_| "Reading state is unavailable")?.save_tabs(session)
}

#[tauri::command]
fn get_library(state: State<'_, Shared>) -> Result<Library, String> {
    state.lock().map_err(|_| "Reading state is unavailable")?.library()
}

/// How far into each document the saved position is, keyed by library path; one call for the whole library.
#[tauri::command]
fn reading_progress(state: State<'_, Shared>) -> Result<HashMap<String, Progress>, String> {
    Ok(state.lock().map_err(|_| "Reading state is unavailable")?.progress_by_path())
}

#[tauri::command]
fn edit_library(change: LibraryChange, state: State<'_, Shared>) -> Result<Library, String> {
    state.lock().map_err(|_| "Reading state is unavailable")?.edit_library(change)
}

#[tauri::command]
async fn add_documents(app: AppHandle, collection_id: Option<String>) -> Result<Library, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<Shared>();
        shared.lock().map_err(|_| "Reading state is unavailable")?
            .saved.library.validate_local_collection(collection_id.as_deref())?;
        let mut dialog = rfd::FileDialog::new()
            .set_title("Add documents to library")
            .add_filter("Documents and images", &["pdf", "epub", "md", "markdown", "txt", "png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"]);
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let Some(chosen) = dialog.pick_files() else {
            return shared.lock().map_err(|_| "Reading state is unavailable")?.library();
        };
        // Validate the entire selection before changing state. Opening a handle checks
        // readability; adding does not decode, hash, or read document contents.
        let mut documents = Vec::with_capacity(chosen.len());
        let mut paths = Vec::with_capacity(chosen.len());
        for chosen in chosen {
            let path = fs::canonicalize(&chosen)
                .map_err(|e| format!("Could not access {}: {e}", chosen.display()))?;
            let format = document_format(&path)?.to_string();
            let file = fs::File::open(&path)
                .map_err(|e| format!("Could not open {}: {e}. Make cloud files available offline first.", path.display()))?;
            let metadata = file.metadata().map_err(|e| e.to_string())?;
            if !metadata.is_file() {
                return Err(format!("{} is not a document file.", path.display()));
            }
            if metadata.len() > MAX_DOCUMENT {
                return Err(format!("{} exceeds the 300 MiB file limit.", path.display()));
            }
            documents.push(LibraryDocument {
                path: path.to_string_lossy().into_owned(),
                name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                format,
                last_opened: 0,
                ..LibraryDocument::default()
            });
            paths.push(path);
        }
        let mut store = shared.lock().map_err(|_| "Reading state is unavailable")?;
        let library = store.add_documents(documents, collection_id.as_deref())?;
        store.authorized.extend(paths);
        Ok(library)
    }).await.map_err(|e| e.to_string())?
}

/// Files that arrived before the page was listening (a launch with a file, or an Apple Event while the webview loads), in order.
#[tauri::command]
fn pending_open(state: State<'_, Shared>) -> Result<Vec<String>, String> {
    let mut store = state.lock().map_err(|_| "Reading state is unavailable")?;
    store.pending_taken = true;
    Ok(std::mem::take(&mut store.pending))
}

#[tauri::command]
fn confirm_open(id: String, path: Option<String>, state: State<'_, Shared>) -> Result<(), String> {
    let mut store = state.lock().map_err(|_| "Reading state is unavailable")?;
    if let Some(path) = path {
        let recent = store
            .opened_aliases
            .get(&(id.clone(), path))
            .cloned()
            .ok_or("Document has not been opened")?;
        store.opened.insert(id.clone(), recent);
    }
    store.promote(&id)
}

#[tauri::command]
fn save_position(
    id: String,
    path: String,
    name: String,
    format: String,
    locator: Value,
    options: Value,
    progress: Option<Progress>,
    state: State<'_, Shared>,
) -> Result<(), String> {
    if serde_json::to_vec(&locator)
        .map_err(|e| e.to_string())?
        .len()
        + serde_json::to_vec(&options)
            .map_err(|e| e.to_string())?
            .len()
        > 65536
    {
        return Err("Saved position is too large.".into());
    }
    let mut store = state.lock().map_err(|_| "Reading state is unavailable")?;
    let opened = store
        .opened_aliases
        .get(&(id.clone(), path.clone()))
        .ok_or("Document has not been opened")?;
    if opened.path != path || opened.name != name || opened.format != format {
        return Err("Document identity does not match the opened file.".into());
    }
    store.save_position(id, path, ReadingState { locator, options, progress })
}

#[tauri::command]
fn retry_save(state: State<'_, Shared>) -> Result<(), String> {
    state
        .lock()
        .map_err(|_| "Reading state is unavailable")?
        .persist()
}

#[tauri::command]
fn clear_recents(state: State<'_, Shared>) -> Result<(), String> {
    let mut store = state.lock().map_err(|_| "Reading state is unavailable")?;
    store.saved.recents.clear();
    store.persist()
}

#[tauri::command]
fn remove_recent(path: String, state: State<'_, Shared>) -> Result<(), String> {
    let mut store = state.lock().map_err(|_| "Reading state is unavailable")?;
    store.saved.recents.retain(|r| r.path != path);
    store.persist()
}

#[tauri::command]
fn clear_reading_data(state: State<'_, Shared>) -> Result<(), String> {
    let mut store = state.lock().map_err(|_| "Reading state is unavailable")?;
    store.saved.documents.clear();
    store.saved.path_ids.clear();
    store.persist()
}

#[derive(Serialize)]
struct ImageData {
    bytes: Vec<u8>,
    mime: &'static str,
}

fn image_path(document: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty() || relative.contains(':') || Path::new(relative).is_absolute() {
        return Err("Only relative local images are supported.".into());
    }
    let root = document
        .parent()
        .ok_or("Document directory is unavailable")?;
    let candidate =
        fs::canonicalize(root.join(relative)).map_err(|_| "Image is missing or unavailable")?;
    if !candidate.starts_with(root) {
        return Err("Image is outside the authorized document directory.".into());
    }
    Ok(candidate)
}

#[tauri::command]
async fn read_relative_image(
    path: String,
    relative: String,
    app: AppHandle,
) -> Result<ImageData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<Shared>();
        let document;
        let store = shared.lock().map_err(|_| "Reading state is unavailable")?;
        if !store
            .opened_aliases
            .values()
            .any(|r| r.path == path && r.format == "md")
        {
            return Err("Image access requires an open Markdown document.".into());
        }
        document = if store.saved.library.documents.iter().any(|d| d.path == path) {
            store.catalog.as_ref().ok_or("Library database is unavailable")?.resolve(&store.saved.library, &path)?
        } else {
            let canonical = fs::canonicalize(&path).map_err(|_| "Document is unavailable")?;
            if !store.authorized.contains(&canonical) { return Err("Document is not authorized.".into()); }
            canonical
        };
        drop(store);
        let candidate = image_path(&document, &relative)?;
        let mime = match candidate
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "avif" => "image/avif",
            "bmp" => "image/bmp",
            _ => {
                return Err(
                    "Unsupported image type. Use PNG, JPEG, GIF, WebP, AVIF, or BMP.".into(),
                )
            }
        };
        Ok(ImageData {
            bytes: read_bounded(&candidate, MAX_IMAGE)?,
            mime,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|_| "Invalid web link")?;
    if !matches!(parsed.scheme(), "https" | "http")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Only ordinary http and https links are supported.".into());
    }
    webbrowser::open(parsed.as_str()).map_err(|e| e.to_string())
}

/// Files named before the reading state exists (see `route_open`), in order.
struct EarlyOpens(Mutex<Vec<PathBuf>>);

/// The files a list of URLs names. macOS delivers `open -a`, Finder's Open With and a drop on the Dock icon as `file://` URLs;
/// no other system sends open events, so elsewhere this is only exercised by its test.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn paths_from_urls(urls: &[tauri::Url]) -> Vec<PathBuf> {
    urls.iter()
        .filter(|url| url.scheme() == "file")
        .filter_map(|url| url.to_file_path().ok())
        .collect()
}

/// Authorizes the supported documents among `paths` (the OS named them, so this is the authorization boundary) and returns
/// their canonical paths in order, with the names of those that cannot be opened.
fn authorize_paths(store: &mut Store, paths: Vec<PathBuf>) -> (Vec<String>, Vec<String>) {
    let (mut opened, mut unsupported) = (Vec::new(), Vec::new());
    for path in paths {
        if document_format(&path).is_err() {
            unsupported.push(path.file_name().unwrap_or_default().to_string_lossy().into_owned());
            continue;
        }
        let canonical = fs::canonicalize(&path).unwrap_or(path);
        opened.push(canonical.to_string_lossy().into_owned());
        store.authorized.insert(canonical);
    }
    (opened, unsupported)
}

/// Asks the page to open `paths`, each in a new tab, in this order: the command line, a second instance and the macOS open events
/// all come here. The paths are also queued for a page that is not listening yet (see `pending_open`).
fn route_open(app: &AppHandle, paths: Vec<PathBuf>) {
    let Some(shared) = app.try_state::<Shared>() else {
        // The state is created in `setup`, which an Apple Event can beat at a cold launch: keep the files until it exists.
        if let Ok(mut early) = app.state::<EarlyOpens>().0.lock() {
            early.extend(paths);
        }
        return;
    };
    let (opened, unsupported) = match shared.lock() {
        Ok(mut store) => {
            let (opened, unsupported) = authorize_paths(&mut store, paths);
            if !store.pending_taken {
                store.pending.extend(opened.iter().cloned());
            }
            (opened, unsupported)
        }
        Err(_) => return,
    };
    if !unsupported.is_empty() {
        let _ = app.emit("reader-warning", "Unsupported file type. Choose a document or supported image.");
    }
    if !opened.is_empty() {
        let _ = app.emit("open-request", opened);
    }
}

fn argument_file(args: impl IntoIterator<Item = String>, cwd: &Path) -> Option<PathBuf> {
    args.into_iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .map(PathBuf::from)
        .find(|p| document_format(p).is_ok())
        .map(|p| if p.is_absolute() { p } else { cwd.join(p) })
}

/// macOS ships "Close Window" on ⌘W in its default menu, and a menu accelerator is taken before the page sees the key. ⌘W closes
/// a tab here, so that item becomes "Close Tab" and tells the page; the page closes the window itself when no tab is open.
#[cfg(target_os = "macos")]
fn install_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    let menu = Menu::default(app.handle())?;
    for item in menu.items()? {
        let MenuItemKind::Submenu(submenu) = item else { continue };
        let entries = submenu.items()?;
        let Some(index) = entries.iter().position(|entry| matches!(entry, MenuItemKind::Predefined(predefined) if predefined.text().is_ok_and(|text| text.starts_with("Close")))) else { continue };
        submenu.remove(&entries[index])?;
        submenu.insert(&MenuItem::with_id(app, "close-tab", "Close Tab", true, Some("CmdOrCtrl+W"))?, index)?;
    }
    app.set_menu(menu)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(EarlyOpens(Mutex::new(Vec::new())))
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(path) = argument_file(args, Path::new(&cwd)) {
                route_open(app, vec![path]);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            open_file,
            get_state,
            save_tabs,
            get_library,
            reading_progress,
            edit_library,
            add_documents,
            choose_source_root,
            locate_library_document,
            open_library_document,
            read_document_bytes,
            thumbnails::read_library_thumbnail,
            thumbnails::put_library_thumbnail,
            thumbnails::library_thumbnail_index,
            thumbnails::put_library_colours,
            thumbnails::read_library_range,
            index_folder,
            pending_open,
            confirm_open,
            save_position,
            retry_save,
            clear_recents,
            remove_recent,
            clear_reading_data,
            read_relative_image,
            open_external,
            assistant::assistant_status,
            assistant::assistant_set_key,
            assistant::assistant_forget_key,
            assistant::assistant_models,
            assistant::assistant_send,
            windows::set_pin,
            windows::set_lock,
            windows::set_preset
        ])
        .setup(|app| {
            let directory = app.path().app_local_data_dir()?;
            let shared = Arc::new(Mutex::new(Store::load(directory.join("state.json"))));
            app.manage(shared.clone());
            // Files the OS named before this point.
            let early = std::mem::take(&mut *app.state::<EarlyOpens>().0.lock().map_err(|_| "Early open queue is unavailable")?);
            if !early.is_empty() {
                route_open(app.handle(), early);
            }
            app.manage(thumbnails::ThumbnailCache::new(app.path().app_cache_dir()?.join("thumbs")));
            #[cfg(target_os = "macos")]
            install_menu(app)?;
            let window = app
                .get_webview_window("main")
                .ok_or("Main window is missing")?;
            windows::restore(&window)?;
            // Paint the default theme's chrome before the page loads so a dark system never
            // flashes white; the page then applies the saved appearance (src/theme.ts).
            let chrome = match window.theme() {
                Ok(tauri::Theme::Dark) => Color(0x17, 0x16, 0x1c, 255),
                _ => Color(0xe4, 0xe2, 0xe9, 255),
            };
            window.set_background_color(Some(chrome))?;
            window.show()?;
            if let Some(path) = argument_file(
                std::env::args(),
                &std::env::current_dir().unwrap_or_default(),
            ) {
                route_open(app.handle(), vec![path]);
            }
            // A single writer serializes geometry with reading-position saves.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_millis(750));
                if let Ok(mut store) = shared.lock() {
                    if store.dirty {
                        let old_warning = store.warning.clone();
                        let _ = store.persist();
                        if old_warning != store.warning {
                            let _ = handle.emit("reader-warning", store.warning.clone());
                        }
                    }
                }
            });
            Ok(())
        })
        .on_webview_event(|webview, event| {
            // The page receives the drop itself (the webview's drag-drop events, see src/main.ts) and decides what to open and where.
            // The native event stays the authorization boundary: only files the user actually dropped become openable without a dialog.
            if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                if let Ok(mut store) = webview.app_handle().state::<Shared>().lock() {
                    authorize_paths(&mut store, paths.clone());
                }
            }
        })
        .on_menu_event(|app, event| {
            if event.id() == "close-tab" {
                let _ = app.emit("close-tab-request", ());
            }
        })
        .on_window_event(|window, event| {
            windows::handle_event(window, event);
        })
        .build(tauri::generate_context!())
        .expect("Could not start Hold My Brief")
        .run(|app, event| {
            // Finder's Open With, `open -a "Hold My Brief" file.pdf` and files dropped on the Dock icon reach a running app as an
            // Apple Event, not as a command line, so the single-instance plugin never sees them.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                route_open(app, paths_from_urls(urls));
            }
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(shared) = app.try_state::<Shared>() {
                    if let Ok(mut store) = shared.lock() {
                        if store.dirty {
                            let _ = store.persist();
                        }
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn images_cannot_escape_document_directory() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("book")).unwrap();
        fs::write(dir.path().join("outside.png"), b"x").unwrap();
        fs::write(dir.path().join("book").join("inside.png"), b"x").unwrap();
        let document = fs::canonicalize(dir.path().join("book"))
            .unwrap()
            .join("a.md");
        assert!(image_path(&document, "inside.png").is_ok());
        assert!(image_path(&document, "../outside.png").is_err());
        assert!(image_path(&document, "C:\\outside.png").is_err());
        assert!(image_path(&document, "https://example.com/x.png").is_err());
    }
    #[test]
    fn authorizing_keeps_supported_files_in_order_and_names_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let book = dir.path().join("book.epub");
        let note = dir.path().join("note.txt");
        let archive = dir.path().join("archive.zip");
        for path in [&book, &note, &archive] {
            fs::write(path, b"x").unwrap();
        }
        let mut store = Store::load(dir.path().join("state.json"));
        let (opened, unsupported) = authorize_paths(&mut store, vec![note.clone(), archive.clone(), book.clone()]);
        let text = |path: &PathBuf| fs::canonicalize(path).unwrap().to_string_lossy().into_owned();
        assert_eq!(opened, vec![text(&note), text(&book)]);
        assert_eq!(unsupported, vec!["archive.zip"]);
        assert!(store.authorized.contains(&fs::canonicalize(&book).unwrap()));
        assert!(store.authorized.contains(&fs::canonicalize(&note).unwrap()));
        assert!(!store.authorized.contains(&fs::canonicalize(&archive).unwrap()));
        assert_eq!(store.authorized.len(), 2);
        // Authorizing queues nothing: only `route_open` does.
        assert!(store.pending.is_empty());
    }

    #[test]
    fn opened_files_are_queued_only_until_the_page_has_taken_the_queue() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::load(dir.path().join("state.json"));
        store.pending.push("/a.pdf".into());
        // What `pending_open` does: hand the queue over once, for good.
        store.pending_taken = true;
        let first = std::mem::take(&mut store.pending);
        assert_eq!(first, vec!["/a.pdf".to_string()]);
        // Later files are announced live only, so a page reload finds nothing to replay.
        assert!(store.pending_taken && store.pending.is_empty());
    }

    // `file:///Users/...` is a path only where paths start with a slash; Windows reads that as a missing drive.
    #[cfg(unix)]
    #[test]
    fn macos_open_events_become_paths_in_order() {
        let urls: Vec<tauri::Url> = ["file:///Users/me/Books/Dune.epub", "file:///Users/me/My%20Docs/a%20b.pdf", "https://example.com/x.pdf", "file:///tmp/c.txt"]
            .iter()
            .map(|url| tauri::Url::parse(url).unwrap())
            .collect();
        let paths = paths_from_urls(&urls);
        // Only file URLs are files; spaces and other escapes are decoded.
        assert_eq!(paths, vec![PathBuf::from("/Users/me/Books/Dune.epub"), PathBuf::from("/Users/me/My Docs/a b.pdf"), PathBuf::from("/tmp/c.txt")]);
        assert_eq!(paths.len(), 3);
        assert!(paths_from_urls(&[]).is_empty());
    }

    #[test]
    fn file_reads_are_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.txt");
        fs::write(&path, b"12345").unwrap();
        assert!(read_bounded(&path, 4).is_err());
        assert_eq!(read_bounded(&path, 5).unwrap(), b"12345");
    }
}
