//! Local per-user agent control bridge (`hmb` CLI & MCP).
//!
//! Security boundary:
//! - On Unix (macOS/Linux): a `0600` Unix domain socket inside the app's local data directory.
//!   Browsers and remote hosts cannot reach Unix sockets.
//! - On Windows: a loopback-only (`127.0.0.1:0`) raw NDJSON TCP listener guarded by a per-session
//!   256-bit random token written to `control.json`. Non-HTTP framing + secret token prevents
//!   browser CSRF/DNS-rebinding.
//! - Users can disable the server at any time in Settings → Agent control; disabling tears down the
//!   listener and deletes `control.json` immediately.

use crate::{state::now, Shared};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Condvar, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Emitter, Manager, State};

/// Virtual path prefix for ephemeral briefs (never persisted to library or recents).
pub const BRIEF_PREFIX: &str = "hold-my-brief:brief/";
const MAX_REQUEST_BYTES: u64 = 8 * 1024 * 1024;
const MAX_BRIEF_BYTES: usize = 4 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const READY_TIMEOUT: Duration = Duration::from_secs(8);
const WATCH_POLL: Duration = Duration::from_millis(350);

// ---------------------------------------------------------------- event log

/// Event types the reader may record through `control_event`.
pub const EVENT_TYPES: [&str; 5] = ["selection", "page", "tab", "send", "area"];
const EVENT_RING: usize = 256;
const EVENT_STRING_CHARS: usize = 2000;
const EVENTS_DEFAULT_LIMIT: usize = 50;
const EVENTS_MAX_WAIT_MS: u64 = 60_000;
/// Folder (inside the app's local data) holding the PNGs of `area` events; it exists only while Agent control is on.
const AREAS_DIR: &str = "agent-areas";
/// The newest this many area PNGs are kept.
const AREAS_KEPT: usize = 20;
const AREA_MAX_BYTES: usize = 8 * 1024 * 1024;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

#[derive(Default)]
struct EventState {
    events: VecDeque<Value>,
    /// Seq of the newest event ever recorded; survives `clear` so seq never repeats within a process.
    last_seq: u64,
}

/// In-memory ring of what the user did in the reader. Never written to disk.
#[derive(Default)]
pub struct EventLog {
    state: Mutex<EventState>,
    arrived: Condvar,
}

fn truncate_strings(value: &mut Value) {
    match value {
        Value::String(s) => {
            if let Some((idx, _)) = s.char_indices().nth(EVENT_STRING_CHARS) {
                s.truncate(idx);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(truncate_strings),
        Value::Object(map) => map.values_mut().for_each(truncate_strings),
        _ => {}
    }
}

impl EventLog {
    /// Validates and appends one event; the native side owns `seq` and `at`. Returns the new seq.
    pub fn push(&self, event: Value) -> Result<u64, String> {
        self.push_with(event, |_, _| Ok(()))
    }

    /// Like `push`, but `prepare` sees the seq the event is about to get and may add fields (after truncation) or refuse it. It runs
    /// under the log's lock, so the seq it names is the one the event receives; a refusal consumes no seq.
    fn push_with(&self, event: Value, prepare: impl FnOnce(u64, &mut serde_json::Map<String, Value>) -> Result<(), String>) -> Result<u64, String> {
        let Value::Object(mut fields) = event else {
            return Err("An event must be a JSON object.".into());
        };
        let kind = match fields.get("type").and_then(Value::as_str) {
            Some(kind) if EVENT_TYPES.contains(&kind) => kind.to_string(),
            _ => return Err(format!("An event needs a string 'type' of: {}.", EVENT_TYPES.join(", "))),
        };
        fields.values_mut().for_each(truncate_strings);
        let mut state = self.state.lock().map_err(|_| "Event log is unavailable")?;
        state.last_seq += 1;
        let seq = state.last_seq;
        if let Err(error) = prepare(seq, &mut fields) {
            state.last_seq -= 1;
            return Err(error);
        }
        fields.insert("seq".into(), json!(seq));
        fields.insert("at".into(), json!(now()));
        fields.insert("type".into(), Value::String(kind));
        if state.events.len() == EVENT_RING {
            state.events.pop_front();
        }
        state.events.push_back(Value::Object(fields));
        self.arrived.notify_all();
        Ok(seq)
    }

    /// Drops every kept event (the seq counter stays); a waiting `query` keeps waiting for new events until its wait ends.
    pub fn clear(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.events.clear();
            self.arrived.notify_all();
        }
    }

    /// Events with `seq > since` whose type is in `types` (all when `None`), at most `limit`. Waits up
    /// to `wait` for the first match. `next` is the last returned seq, or the latest seq if none.
    pub fn query(&self, since: u64, wait: Duration, types: Option<&[String]>, limit: usize) -> Value {
        let deadline = Instant::now() + wait;
        let Ok(mut state) = self.state.lock() else {
            return json!({ "events": [], "next": since });
        };
        loop {
            let matching: Vec<Value> = state
                .events
                .iter()
                .filter(|e| e["seq"].as_u64().is_some_and(|s| s > since))
                .filter(|e| types.map_or(true, |t| e["type"].as_str().is_some_and(|k| t.iter().any(|x| x == k))))
                .take(limit)
                .cloned()
                .collect();
            let remaining = deadline.saturating_duration_since(Instant::now());
            if !matching.is_empty() || remaining.is_zero() {
                let oldest_kept = state.events.front().and_then(|e| e["seq"].as_u64()).unwrap_or(state.last_seq + 1);
                let next = matching.last().and_then(|e| e["seq"].as_u64()).unwrap_or(state.last_seq);
                let mut reply = json!({ "events": matching, "next": next });
                if oldest_kept > since.saturating_add(1) {
                    reply["dropped"] = json!(true);
                }
                return reply;
            }
            state = match self.arrived.wait_timeout(state, remaining) {
                Ok((guard, _)) => guard,
                Err(_) => return json!({ "events": [], "next": since }),
            };
        }
    }
}

/// Parsed `events` request parameters.
struct EventsQuery {
    since: u64,
    wait: Duration,
    types: Option<Vec<String>>,
    limit: usize,
}

fn parse_events_params(params: &Value) -> EventsQuery {
    let since = params.get("since").and_then(Value::as_u64).unwrap_or(0);
    let wait_ms = params.get("wait").and_then(Value::as_u64).unwrap_or(0).min(EVENTS_MAX_WAIT_MS);
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .map_or(EVENTS_DEFAULT_LIMIT, |n| n as usize)
        .clamp(1, EVENT_RING);
    let types = params
        .get("types")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect());
    EventsQuery { since, wait: Duration::from_millis(wait_ms), types, limit }
}

// ---------------------------------------------------------------- protocol types

#[derive(Debug, Deserialize)]
pub struct ControlRequest {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub token: Option<String>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ControlResponse {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ControlResponse {
    fn ok(id: String, result: Value) -> Self {
        Self { id, ok: true, result: Some(result), error: None }
    }
    fn err(id: String, message: impl Into<String>) -> Self {
        Self { id, ok: false, result: None, error: Some(message.into()) }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryInfo {
    pub version: u32,
    pub pid: u32,
    pub transport: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub socket: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub addr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlStatus {
    pub enabled: bool,
    pub running: bool,
    pub transport: String,
    pub discovery_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefEntry {
    pub id: String,
    pub path: String,
    pub title: String,
    pub format: String,
    pub content: String,
    #[serde(skip_serializing)]
    pub base_dir: Option<PathBuf>,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebviewRequest {
    id: String,
    method: String,
    params: Value,
}

// ---------------------------------------------------------------- brief store

#[derive(Default)]
pub struct BriefStore {
    entries: Mutex<HashMap<String, BriefEntry>>,
}

pub fn sanitize_brief_id(raw: Option<&str>) -> Result<String, String> {
    let id = raw.unwrap_or("default").trim();
    if id.is_empty() {
        return Ok("default".into());
    }
    if id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        return Err("Brief id must be 1–64 ASCII letters, digits, '-', '_' or '.'.".into());
    }
    if id == "." || id == ".." {
        return Err("Brief id cannot be '.' or '..'.".into());
    }
    Ok(id.to_string())
}

pub fn brief_path(id: &str) -> String {
    format!("{BRIEF_PREFIX}{id}")
}

pub fn brief_id_from_path(path: &str) -> Option<&str> {
    path.strip_prefix(BRIEF_PREFIX)
}

fn default_brief_title(id: &str) -> String {
    if id == "default" {
        return "Brief".into();
    }
    let spaced = id.replace(['-', '_'], " ");
    let mut chars = spaced.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
        None => "Brief".into(),
    }
}

impl BriefStore {
    pub fn upsert(
        &self,
        id: Option<&str>,
        title: Option<&str>,
        format: Option<&str>,
        content: String,
        append: bool,
        base_dir: Option<&str>,
    ) -> Result<(BriefEntry, bool), String> {
        let id = sanitize_brief_id(id)?;
        let fmt = format.unwrap_or("md").trim().to_ascii_lowercase();
        let fmt = match fmt.as_str() {
            "md" | "markdown" => "md",
            "txt" | "text" => "txt",
            "svg" => "svg",
            _ => return Err("Brief format must be 'md', 'txt', or 'svg'.".into()),
        };
        let resolved_base = match base_dir.map(str::trim).filter(|s| !s.is_empty()) {
            Some(dir) => {
                let canonical = fs::canonicalize(dir).map_err(|e| format!("Invalid baseDir: {e}"))?;
                if !canonical.is_dir() {
                    return Err("baseDir must be an existing directory.".into());
                }
                Some(canonical)
            }
            None => None,
        };

        let mut map = self.entries.lock().map_err(|_| "Brief store is unavailable")?;
        let existed = map.contains_key(&id);
        let next_content = if append {
            match map.get(&id) {
                Some(prev) => {
                    let mut combined = prev.content.clone();
                    if !combined.is_empty() && !combined.ends_with('\n') {
                        combined.push('\n');
                    }
                    combined.push_str(&content);
                    combined
                }
                None => content,
            }
        } else {
            content
        };
        if next_content.len() > MAX_BRIEF_BYTES {
            return Err("Brief content exceeds the 4 MiB limit.".into());
        }
        let next_title = title
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or_else(|| map.get(&id).map(|prev| prev.title.clone()))
            .unwrap_or_else(|| default_brief_title(&id));
        let base_dir_final = resolved_base.or_else(|| map.get(&id).and_then(|prev| prev.base_dir.clone()));

        let entry = BriefEntry {
            id: id.clone(),
            path: brief_path(&id),
            title: next_title,
            format: fmt.to_string(),
            content: next_content,
            base_dir: base_dir_final,
            updated_at: now(),
        };
        map.insert(id, entry.clone());
        Ok((entry, existed))
    }

    pub fn get(&self, id_or_path: &str) -> Option<BriefEntry> {
        let id = brief_id_from_path(id_or_path).unwrap_or(id_or_path);
        self.entries.lock().ok()?.get(id).cloned()
    }

    pub fn remove(&self, id_or_path: &str) -> Option<BriefEntry> {
        let id = brief_id_from_path(id_or_path).unwrap_or(id_or_path);
        self.entries.lock().ok()?.remove(id)
    }

    pub fn list_paths(&self) -> Vec<String> {
        self.entries.lock().map(|m| m.values().map(|e| e.path.clone()).collect()).unwrap_or_default()
    }
}

// ---------------------------------------------------------------- file watcher

struct WatchedEntry {
    resolved: PathBuf,
    stamp: Option<(u64, Option<SystemTime>)>,
}

fn file_stamp(path: &Path) -> Option<(u64, Option<SystemTime>)> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    Some((meta.len(), meta.modified().ok()))
}

pub struct FileWatcher {
    entries: Mutex<HashMap<String, WatchedEntry>>,
    wake: Condvar,
    shutdown: AtomicBool,
}

impl FileWatcher {
    pub fn start(app: AppHandle) -> Arc<Self> {
        let watcher = Arc::new(Self {
            entries: Mutex::new(HashMap::new()),
            wake: Condvar::new(),
            shutdown: AtomicBool::new(false),
        });
        let handle = watcher.clone();
        thread::Builder::new()
            .name("hmb-file-watcher".into())
            .spawn(move || handle.run(app))
            .ok();
        watcher
    }

    #[cfg(test)]
    fn idle() -> Arc<Self> {
        Arc::new(Self {
            entries: Mutex::new(HashMap::new()),
            wake: Condvar::new(),
            shutdown: AtomicBool::new(false),
        })
    }

    pub fn watch(&self, key: String, resolved: PathBuf) {
        let stamp = file_stamp(&resolved);
        if let Ok(mut map) = self.entries.lock() {
            map.insert(key, WatchedEntry { resolved, stamp });
            self.wake.notify_all();
        }
    }

    pub fn unwatch(&self, key: &str) {
        if let Ok(mut map) = self.entries.lock() {
            map.remove(key);
        }
    }

    pub fn stop(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
        self.wake.notify_all();
    }

    fn run(&self, app: AppHandle) {
        loop {
            if self.shutdown.load(Ordering::SeqCst) {
                return;
            }
            let changed: Vec<String>;
            {
                let mut map = match self.entries.lock() {
                    Ok(m) => m,
                    Err(_) => return,
                };
                if map.is_empty() {
                    let _guard = self.wake.wait(map);
                    continue;
                }
                changed = map
                    .iter_mut()
                    .filter_map(|(key, entry)| {
                        let current = file_stamp(&entry.resolved)?;
                        if entry.stamp != Some(current) {
                            entry.stamp = Some(current);
                            Some(key.clone())
                        } else {
                            None
                        }
                    })
                    .collect();
            }
            for path in changed {
                let _ = app.emit("file-changed", path);
            }
            thread::sleep(WATCH_POLL);
        }
    }
}

// ---------------------------------------------------------------- bridge & IPC server

pub struct ControlBridge {
    discovery_path: PathBuf,
    areas_dir: PathBuf,
    ready: Mutex<bool>,
    ready_cv: Condvar,
    next_id: AtomicU64,
    pending: Mutex<HashMap<String, mpsc::Sender<Result<Value, String>>>>,
    server: Mutex<Option<ServerHandle>>,
    pub briefs: BriefStore,
    pub watcher: Arc<FileWatcher>,
    pub events: EventLog,
}

struct ServerHandle {
    shutdown: Arc<AtomicBool>,
    #[cfg(unix)]
    socket_path: PathBuf,
    #[cfg(windows)]
    addr: String,
    join: Option<thread::JoinHandle<()>>,
}

fn default_discovery_path(app_data_dir: &Path) -> PathBuf {
    std::env::var_os("HMB_CONTROL_FILE")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| app_data_dir.join("control.json"))
}

#[cfg(unix)]
fn set_owner_only(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn set_owner_only(_path: &Path) {}

#[cfg(unix)]
fn set_owner_only_dir(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
}

#[cfg(not(unix))]
fn set_owner_only_dir(_path: &Path) {}

/// Writes a file that was never readable by anyone but its owner.
fn write_owner_only(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    set_owner_only(path);
    file.write_all(bytes)
}

/// Deletes all but the `keep` highest-numbered `<seq>.png` files of `dir`.
fn prune_areas(dir: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut files: Vec<(u64, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let seq = path.file_name()?.to_str()?.strip_suffix(".png")?.parse().ok()?;
            Some((seq, path))
        })
        .collect();
    files.sort_unstable_by_key(|(seq, _)| std::cmp::Reverse(*seq));
    for (_, path) in files.into_iter().skip(keep) {
        let _ = fs::remove_file(path);
    }
}

fn write_discovery(path: &Path, info: &DiscoveryInfo) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(info).map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!("json.tmp.{}", std::process::id()));
    {
        let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        set_owner_only(&tmp);
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().ok();
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(any(windows, test))]
fn generate_token() -> String {
    use sha2::{Digest, Sha256};
    use std::collections::hash_map::RandomState;
    use std::hash::BuildHasher;
    let mut hasher = Sha256::new();
    for i in 0u64..8 {
        let seed = RandomState::new().hash_one((i, std::process::id(), now()));
        hasher.update(seed.to_le_bytes());
    }
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

impl ControlBridge {
    pub fn new(app: &AppHandle, app_data_dir: &Path) -> Arc<Self> {
        Self::with_watcher(default_discovery_path(app_data_dir), app_data_dir.join(AREAS_DIR), FileWatcher::start(app.clone()))
    }

    fn with_watcher(discovery_path: PathBuf, areas_dir: PathBuf, watcher: Arc<FileWatcher>) -> Arc<Self> {
        Arc::new(Self {
            discovery_path,
            areas_dir,
            ready: Mutex::new(false),
            ready_cv: Condvar::new(),
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            server: Mutex::new(None),
            briefs: BriefStore::default(),
            watcher,
            events: EventLog::default(),
        })
    }

    /// Deletes the folder of area PNGs.
    pub fn clear_areas(&self) {
        let _ = fs::remove_dir_all(&self.areas_dir);
    }

    /// Stores `png` as `<areas folder>/<seq>.png` (owner only), keeps the newest `AREAS_KEPT` files and records the `area` event
    /// that names it. Returns the seq, or `None` (nothing written) while Agent control is off. `meta` supplies `paneId`, `path`, `title`, `page` and `box`; the size comes from the PNG itself.
    fn record_area(&self, enabled: bool, png: &[u8], meta: Value) -> Result<Option<u64>, String> {
        if !enabled {
            return Ok(None);
        }
        if png.len() > AREA_MAX_BYTES {
            return Err("That area is too large to send (over 8 MB).".into());
        }
        // Signature, then the IHDR chunk: length, "IHDR", width, height.
        if png.len() < 24 || png[..8] != PNG_SIGNATURE || &png[12..16] != b"IHDR" {
            return Err("The area is not a PNG image.".into());
        }
        let size = |at: usize| u32::from_be_bytes([png[at], png[at + 1], png[at + 2], png[at + 3]]);
        let (width, height) = (size(16), size(20));
        let Value::Object(meta) = meta else {
            return Err("An area needs metadata.".into());
        };
        let mut event = serde_json::Map::new();
        for key in ["paneId", "path", "title", "page", "box"] {
            if let Some(value) = meta.get(key).filter(|v| !v.is_null()) {
                event.insert(key.into(), value.clone());
            }
        }
        event.insert("type".into(), json!("area"));
        event.insert("width".into(), json!(width));
        event.insert("height".into(), json!(height));
        self.events.push_with(Value::Object(event), |seq, fields| {
            fs::create_dir_all(&self.areas_dir).map_err(|e| format!("Could not store the area: {e}"))?;
            set_owner_only_dir(&self.areas_dir);
            let file = self.areas_dir.join(format!("{seq}.png"));
            write_owner_only(&file, png).map_err(|e| format!("Could not store the area: {e}"))?;
            fields.insert("image".into(), Value::String(file.to_string_lossy().into_owned()));
            prune_areas(&self.areas_dir, AREAS_KEPT);
            Ok(())
        })
        .map(Some)
    }

    pub fn mark_ready(&self) {
        if let Ok(mut ready) = self.ready.lock() {
            *ready = true;
            self.ready_cv.notify_all();
        }
    }

    fn wait_ready(&self, timeout: Duration) -> bool {
        let Ok(guard) = self.ready.lock() else { return false };
        if *guard {
            return true;
        }
        let Ok((guard, _)) = self.ready_cv.wait_timeout_while(guard, timeout, |ready| !*ready) else {
            return false;
        };
        *guard
    }

    pub fn reply(&self, id: &str, ok: bool, result: Option<Value>, error: Option<String>) {
        if let Ok(mut pending) = self.pending.lock() {
            if let Some(tx) = pending.remove(id) {
                let payload = if ok {
                    Ok(result.unwrap_or(Value::Null))
                } else {
                    Err(error.unwrap_or_else(|| "The reader could not complete that request.".into()))
                };
                let _ = tx.send(payload);
            }
        }
    }

    pub fn status(&self, enabled: bool) -> ControlStatus {
        let running = self.server.lock().map(|s| s.is_some()).unwrap_or(false);
        let transport = if cfg!(unix) { "unix" } else { "tcp" }.to_string();
        ControlStatus {
            enabled,
            running,
            transport,
            discovery_path: self.discovery_path.to_string_lossy().into_owned(),
        }
    }

    pub fn start(self: &Arc<Self>, app: AppHandle) -> Result<(), String> {
        let mut slot = self.server.lock().map_err(|_| "Control server lock unavailable")?;
        if slot.is_some() {
            return Ok(());
        }
        // The event log starts empty with the process, so area PNGs a previous run left behind belong to no event.
        self.clear_areas();
        let shutdown = Arc::new(AtomicBool::new(false));
        let handle = self.spawn_listener(app, shutdown)?;
        *slot = Some(handle);
        Ok(())
    }

    pub fn stop(&self) {
        let handle = self.server.lock().ok().and_then(|mut slot| slot.take());
        let _ = fs::remove_file(&self.discovery_path);
        if let Some(mut handle) = handle {
            handle.shutdown.store(true, Ordering::SeqCst);
            // Poke the blocking accept() so the thread exits promptly.
            #[cfg(unix)]
            {
                let _ = std::os::unix::net::UnixStream::connect(&handle.socket_path);
            }
            #[cfg(windows)]
            {
                let _ = std::net::TcpStream::connect(&handle.addr);
            }
            if let Some(join) = handle.join.take() {
                let _ = join.join();
            }
            #[cfg(unix)]
            {
                let _ = fs::remove_file(&handle.socket_path);
            }
        }
    }

    #[cfg(unix)]
    fn spawn_listener(self: &Arc<Self>, app: AppHandle, shutdown: Arc<AtomicBool>) -> Result<ServerHandle, String> {
        use std::os::unix::net::UnixListener;
        let socket_path = self.discovery_path.with_extension("sock");
        if let Some(parent) = socket_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let _ = fs::remove_file(&socket_path);
        let listener = UnixListener::bind(&socket_path)
            .map_err(|e| format!("Could not bind control socket {}: {e}", socket_path.display()))?;
        set_owner_only(&socket_path);
        let info = DiscoveryInfo {
            version: 1,
            pid: std::process::id(),
            transport: "unix".into(),
            socket: Some(socket_path.to_string_lossy().into_owned()),
            addr: None,
            token: None,
        };
        write_discovery(&self.discovery_path, &info)?;

        let bridge = self.clone();
        let flag = shutdown.clone();
        let join = thread::Builder::new()
            .name("hmb-control-unix".into())
            .spawn(move || {
                for incoming in listener.incoming() {
                    if flag.load(Ordering::SeqCst) {
                        break;
                    }
                    let Ok(stream) = incoming else { continue };
                    let b = bridge.clone();
                    let a = app.clone();
                    thread::spawn(move || {
                        let _ = stream.set_read_timeout(Some(REQUEST_TIMEOUT));
                        let _ = stream.set_write_timeout(Some(REQUEST_TIMEOUT));
                        b.handle_stream(a, stream, None);
                    });
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(ServerHandle { shutdown, socket_path, join: Some(join) })
    }

    #[cfg(windows)]
    fn spawn_listener(self: &Arc<Self>, app: AppHandle, shutdown: Arc<AtomicBool>) -> Result<ServerHandle, String> {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Could not bind loopback control listener: {e}"))?;
        let addr = listener.local_addr().map_err(|e| e.to_string())?.to_string();
        let token = generate_token();
        let info = DiscoveryInfo {
            version: 1,
            pid: std::process::id(),
            transport: "tcp".into(),
            socket: None,
            addr: Some(addr.clone()),
            token: Some(token.clone()),
        };
        write_discovery(&self.discovery_path, &info)?;

        let bridge = self.clone();
        let flag = shutdown.clone();
        let join = thread::Builder::new()
            .name("hmb-control-tcp".into())
            .spawn(move || {
                for incoming in listener.incoming() {
                    if flag.load(Ordering::SeqCst) {
                        break;
                    }
                    let Ok(stream) = incoming else { continue };
                    let b = bridge.clone();
                    let a = app.clone();
                    let expected = token.clone();
                    thread::spawn(move || {
                        let _ = stream.set_read_timeout(Some(REQUEST_TIMEOUT));
                        let _ = stream.set_write_timeout(Some(REQUEST_TIMEOUT));
                        b.handle_stream(a, stream, Some(expected));
                    });
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(ServerHandle { shutdown, addr, join: Some(join) })
    }

    fn handle_stream<S: Read + Write>(&self, app: AppHandle, mut stream: S, expected_token: Option<String>) {
        let mut line = String::new();
        {
            let mut reader = BufReader::new((&mut stream).take(MAX_REQUEST_BYTES + 1));
            if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
                return;
            }
        }
        if line.len() as u64 > MAX_REQUEST_BYTES {
            let _ = write_response(&mut stream, &ControlResponse::err(String::new(), "Request exceeds maximum size."));
            return;
        }
        let req: ControlRequest = match serde_json::from_str(&line) {
            Ok(req) => req,
            Err(e) => {
                let _ = write_response(&mut stream, &ControlResponse::err(String::new(), format!("Invalid JSON request: {e}")));
                return;
            }
        };
        if let Some(expected) = expected_token {
            let provided = req.token.as_deref().unwrap_or("");
            if !constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
                let _ = write_response(&mut stream, &ControlResponse::err(req.id, "Unauthorized control request."));
                return;
            }
        }
        let response = self.dispatch(&app, req);
        let _ = write_response(&mut stream, &response);
    }

    fn dispatch(&self, app: &AppHandle, req: ControlRequest) -> ControlResponse {
        if let Some(response) = self.dispatch_native(&req) {
            return response;
        }
        let id = req.id.clone();
        let method = req.method.as_str();
        if !self.wait_ready(READY_TIMEOUT) {
            return ControlResponse::err(id, "Hold My Brief is still starting up. Try again in a moment.");
        }

        let params = match self.prepare_request(app, method, req.params) {
            Ok(p) => p,
            Err(e) => return ControlResponse::err(id, e),
        };

        // Handle window adjustments (pin, lock, preset, non-intrusive show / explicit focus) cleanly on the native side.
        if let Err(e) = apply_window_hints(app, &params) {
            return ControlResponse::err(id, e);
        }

        match self.call_webview(app, method, params) {
            Ok(result) => ControlResponse::ok(id, result),
            Err(error) => ControlResponse::err(id, error),
        }
    }

    /// Methods answered without the reader window (and without waiting for it to be ready). `events` may block for its `wait`
    /// on the connection's own thread; the socket timeouts only cover reading the request line, so they never cut that wait short.
    fn dispatch_native(&self, req: &ControlRequest) -> Option<ControlResponse> {
        let id = req.id.clone();
        match req.method.as_str() {
            "ping" => {
                let ready = self.ready.lock().map(|r| *r).unwrap_or(false);
                Some(ControlResponse::ok(id, json!({ "version": 1, "pid": std::process::id(), "ready": ready })))
            }
            "events" => {
                let q = parse_events_params(&req.params);
                Some(ControlResponse::ok(id, self.events.query(q.since, q.wait, q.types.as_deref(), q.limit)))
            }
            _ => None,
        }
    }

    fn prepare_request(&self, app: &AppHandle, method: &str, mut params: Value) -> Result<Value, String> {
        let shared = app.state::<Shared>();
        match method {
            "show" => {
                let obj = params.as_object_mut().ok_or("show expects a JSON object of parameters.")?;
                let raw_path = obj
                    .get("path")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or("show requires a file path.")?
                    .to_string();
                let target = {
                    let store = shared.lock().map_err(|_| "Reading state is unavailable")?;
                    resolve_show_target(&store.saved.library.documents, &raw_path)
                }
                .ok_or_else(|| format!("File not found or unsupported format: {raw_path}"))?;
                if let ShowTarget::File(canonical) = target {
                    let canonical_str = canonical.to_string_lossy().into_owned();
                    {
                        let mut store = shared.lock().map_err(|_| "Reading state is unavailable")?;
                        store.authorized_files.insert(PathBuf::from(&raw_path));
                        store.authorized_files.insert(canonical.clone());
                    }
                    obj.insert("path".into(), Value::String(canonical_str.clone()));
                    if obj.get("watch").and_then(Value::as_bool).unwrap_or(false) {
                        self.watcher.watch(canonical_str, canonical);
                    }
                }
                let beside_raw = obj
                    .get("beside")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string);
                if let Some(beside_raw) = beside_raw {
                    let beside_target = {
                        let store = shared.lock().map_err(|_| "Reading state is unavailable")?;
                        resolve_show_target(&store.saved.library.documents, &beside_raw)
                    }
                    .ok_or_else(|| format!("Beside file not found or unsupported format: {beside_raw}"))?;
                    if let ShowTarget::File(beside_canonical) = beside_target {
                        let beside_str = beside_canonical.to_string_lossy().into_owned();
                        {
                            let mut store = shared.lock().map_err(|_| "Reading state is unavailable")?;
                            store.authorized_files.insert(PathBuf::from(&beside_raw));
                            store.authorized_files.insert(beside_canonical.clone());
                        }
                        obj.insert("beside".into(), Value::String(beside_str.clone()));
                        if obj.get("watch").and_then(Value::as_bool).unwrap_or(false) {
                            self.watcher.watch(beside_str, beside_canonical);
                        }
                    }
                }
                Ok(params)
            }
            "brief" => {
                let obj = params.as_object_mut().ok_or("brief expects a JSON object of parameters.")?;
                let id = obj.get("id").and_then(Value::as_str).map(str::to_string);
                let title = obj.get("title").and_then(Value::as_str).map(str::to_string);
                let format = obj.get("format").and_then(Value::as_str).map(str::to_string);
                let append = obj.get("append").and_then(Value::as_bool).unwrap_or(false);
                let base_dir = obj.get("baseDir").and_then(Value::as_str).map(str::to_string);
                let content = obj
                    .get("content")
                    .and_then(Value::as_str)
                    .ok_or("brief requires 'content'.")?
                    .to_string();
                let (entry, existed) = self.briefs.upsert(
                    id.as_deref(),
                    title.as_deref(),
                    format.as_deref(),
                    content,
                    append,
                    base_dir.as_deref(),
                )?;
                obj.remove("content");
                obj.insert("id".into(), Value::String(entry.id));
                obj.insert("path".into(), Value::String(entry.path));
                obj.insert("title".into(), Value::String(entry.title));
                obj.insert("format".into(), Value::String(entry.format));
                obj.insert("updated".into(), Value::Bool(existed));
                Ok(params)
            }
            "close" => {
                if let Some(obj) = params.as_object() {
                    if obj.get("allBriefs").and_then(Value::as_bool).unwrap_or(false) {
                        for p in self.briefs.list_paths() {
                            self.briefs.remove(&p);
                        }
                    } else if let Some(target) = obj.get("id").and_then(Value::as_str).or_else(|| obj.get("path").and_then(Value::as_str)) {
                        self.briefs.remove(target);
                        self.watcher.unwatch(target);
                    }
                }
                Ok(params)
            }
            _ => Ok(params),
        }
    }

    fn call_webview(&self, app: &AppHandle, method: &str, params: Value) -> Result<Value, String> {
        let req_id = format!("ctl-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = mpsc::channel();
        {
            let mut pending = self.pending.lock().map_err(|_| "Control bridge unavailable")?;
            pending.insert(req_id.clone(), tx);
        }
        let event = WebviewRequest { id: req_id.clone(), method: method.to_string(), params };
        if let Err(e) = app.emit("control-request", event) {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&req_id);
            }
            return Err(format!("Could not deliver request to reader window: {e}"));
        }
        match rx.recv_timeout(REQUEST_TIMEOUT) {
            Ok(result) => result,
            Err(_) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&req_id);
                }
                Err("Timed out waiting for Hold My Brief to respond.".into())
            }
        }
    }
}

fn write_response<W: Write>(stream: &mut W, response: &ControlResponse) -> std::io::Result<()> {
    let mut bytes = serde_json::to_vec(response).unwrap_or_else(|_| b"{\"id\":\"\",\"ok\":false,\"error\":\"serialization error\"}".to_vec());
    bytes.push(b'\n');
    stream.write_all(&bytes)?;
    stream.flush()
}

/// Applies optional window-level hints (`pin`, `lock`, `preset`, `focus`) without stealing focus by default.
fn apply_window_hints(app: &AppHandle, params: &Value) -> Result<(), String> {
    let Some(obj) = params.as_object() else { return Ok(()); };
    let Some(window) = app.get_webview_window("main") else { return Ok(()); };
    let shared = app.state::<Shared>();

    if let Some(pin) = obj.get("pin").and_then(Value::as_bool) {
        let _ = crate::windows::set_pin(pin, window.clone(), shared.clone())?;
    }
    if let Some(lock) = obj.get("lock").and_then(Value::as_bool) {
        let _ = crate::windows::set_lock(lock, window.clone(), shared.clone())?;
    }
    if let Some(preset) = obj.get("preset").and_then(Value::as_str) {
        let _ = crate::windows::set_preset(preset.to_string(), window.clone(), shared)?;
    }
    if obj.get("focus").and_then(Value::as_bool).unwrap_or(false) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    } else if matches!(obj.get("reveal").and_then(Value::as_bool), Some(true))
        || (obj.contains_key("path") && !window.is_visible().unwrap_or(true))
    {
        let _ = window.show();
    }
    Ok(())
}

// ---------------------------------------------------------------- Tauri commands

#[tauri::command]
pub fn control_ready(bridge: State<'_, Arc<ControlBridge>>) {
    bridge.mark_ready();
}

#[tauri::command]
pub fn control_reply(
    id: String,
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
    bridge: State<'_, Arc<ControlBridge>>,
) {
    bridge.reply(&id, ok, result, error);
}

#[tauri::command]
pub fn control_event(
    event: Value,
    state: State<'_, Shared>,
    bridge: State<'_, Arc<ControlBridge>>,
) -> Result<(), String> {
    let enabled = state.lock().map_err(|_| "Reading state is unavailable")?.saved.control_enabled;
    if !enabled {
        return Ok(());
    }
    // An `area` event names a file only `control_area` writes.
    if event.get("type").and_then(Value::as_str) == Some("area") {
        return Err("Area events are recorded with their image only.".into());
    }
    bridge.events.push(event).map(|_| ())
}

/// The user dragged a box over a page: stores the PNG of that area and records an `area` event for it. Does nothing while Agent control is off.
#[tauri::command]
pub fn control_area(
    png: Vec<u8>,
    meta: Value,
    state: State<'_, Shared>,
    bridge: State<'_, Arc<ControlBridge>>,
) -> Result<(), String> {
    let enabled = state.lock().map_err(|_| "Reading state is unavailable")?.saved.control_enabled;
    bridge.record_area(enabled, &png, meta).map(|_| ())
}

#[tauri::command]
pub fn control_status(
    state: State<'_, Shared>,
    bridge: State<'_, Arc<ControlBridge>>,
) -> Result<ControlStatus, String> {
    let enabled = state.lock().map_err(|_| "Reading state is unavailable")?.saved.control_enabled;
    Ok(bridge.status(enabled))
}

#[tauri::command]
pub fn set_control_enabled(
    enabled: bool,
    app: AppHandle,
    state: State<'_, Shared>,
    bridge: State<'_, Arc<ControlBridge>>,
) -> Result<ControlStatus, String> {
    if enabled {
        bridge.start(app)?;
    } else {
        bridge.stop();
        bridge.events.clear();
        bridge.clear_areas();
    }
    let mut store = state.lock().map_err(|_| "Reading state is unavailable")?;
    store.saved.control_enabled = enabled;
    store.dirty = true;
    let _ = store.persist();
    Ok(bridge.status(enabled))
}

#[tauri::command]
pub fn read_brief(
    id: String,
    bridge: State<'_, Arc<ControlBridge>>,
) -> Result<BriefEntry, String> {
    bridge.briefs.get(&id).ok_or_else(|| "This brief is no longer available.".into())
}

#[tauri::command]
pub fn unwatch_file(path: String, bridge: State<'_, Arc<ControlBridge>>) {
    bridge.watcher.unwatch(&path);
    bridge.briefs.remove(&path);
}

#[tauri::command]
pub async fn save_brief_as(id: String, app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bridge = app.state::<Arc<ControlBridge>>();
        let entry = bridge.briefs.get(&id).ok_or("This brief is no longer available.")?;
        let ext = match entry.format.as_str() {
            "svg" => "svg",
            "txt" => "txt",
            _ => "md",
        };
        let suggested: String = entry
            .title
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ' ') { c } else { '-' })
            .collect();
        let suggested = suggested.trim().replace(' ', "-");
        let file_name = format!("{}.{}", if suggested.is_empty() { "brief" } else { &suggested }, ext);
        let mut dialog = rfd::FileDialog::new()
            .set_title("Save brief")
            .set_file_name(&file_name)
            .add_filter("Brief", &[ext]);
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let Some(chosen) = dialog.save_file() else {
            return Ok(None);
        };
        fs::write(&chosen, entry.content.as_bytes()).map_err(|e| format!("Could not save brief: {e}"))?;
        let canonical = crate::catalog::canonical_file(&chosen)?;
        app.state::<Shared>()
            .lock()
            .map_err(|_| "Reading state is unavailable")?
            .authorized_files
            .insert(canonical.clone());
        Ok(Some(canonical.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Resolves a relative image inside a brief's optional `base_dir` using the same path rules as Markdown documents.
pub fn brief_image_base(bridge: &ControlBridge, path: &str) -> Option<PathBuf> {
    let entry = bridge.briefs.get(path)?;
    entry.base_dir.map(|dir| dir.join("brief.md"))
}

/// What a `show`/`beside` path names.
#[derive(Debug, PartialEq)]
enum ShowTarget {
    /// A file on disk: canonicalised, authorised and (with `--watch`) watched.
    File(PathBuf),
    /// A brief (`hold-my-brief:brief/<id>`) or the `path` of a Library document (`folder:…`, `source:…`).
    /// The app resolves those itself, so they are sent on unchanged.
    Unchanged,
}

/// A file on disk always takes the file route, even when the Library also stores its path (every
/// document opened without `--ephemeral` is added to the Library), so `--watch` keeps working. Only a
/// path that is not a supported file may pass through unchanged.
fn resolve_show_target(documents: &[crate::state::LibraryDocument], raw_path: &str) -> Option<ShowTarget> {
    match crate::catalog::canonical_file(Path::new(raw_path)) {
        Ok(canonical) => Some(ShowTarget::File(canonical)),
        Err(_) if raw_path.starts_with(BRIEF_PREFIX) || documents.iter().any(|d| d.path == raw_path) => {
            Some(ShowTarget::Unchanged)
        }
        Err(_) => None,
    }
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_ids_and_briefs_pass_unchanged_but_files_keep_the_file_route() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("plan.md");
        std::fs::write(&file, "# Plan").unwrap();
        let canonical = crate::catalog::canonical_file(&file).unwrap();
        let documents = vec![
            crate::state::LibraryDocument { path: "folder:485e41a8d1a72538:reports/source.pdf".into(), ..Default::default() },
            // `confirm_open` stores the opened file's own path in the Library.
            crate::state::LibraryDocument { path: canonical.to_string_lossy().into_owned(), ..Default::default() },
        ];
        let id = "folder:485e41a8d1a72538:reports/source.pdf";
        assert_eq!(resolve_show_target(&documents, id), Some(ShowTarget::Unchanged));
        assert_eq!(resolve_show_target(&documents, "hold-my-brief:brief/plan"), Some(ShowTarget::Unchanged));
        // A file that is also a Library path is still canonicalised (and so authorised and watched).
        assert_eq!(resolve_show_target(&documents, canonical.to_str().unwrap()), Some(ShowTarget::File(canonical.clone())));
        assert_eq!(resolve_show_target(&documents, file.to_str().unwrap()), Some(ShowTarget::File(canonical)));
        assert_eq!(resolve_show_target(&documents, "folder:485e41a8d1a72538:reports/missing.pdf"), None);
        assert_eq!(resolve_show_target(&documents, "/no/such/file.pdf"), None);
    }

    #[test]
    fn brief_ids_are_validated_and_safe() {
        assert_eq!(sanitize_brief_id(None).unwrap(), "default");
        assert_eq!(sanitize_brief_id(Some("  ")).unwrap(), "default");
        assert_eq!(sanitize_brief_id(Some("auth-plan_v2.1")).unwrap(), "auth-plan_v2.1");
        assert!(sanitize_brief_id(Some("../escape")).is_err());
        assert!(sanitize_brief_id(Some("a/b")).is_err());
        assert!(sanitize_brief_id(Some("has space")).is_err());
        assert!(sanitize_brief_id(Some("..")).is_err());
    }

    #[test]
    fn brief_store_upserts_appends_and_keeps_base_dir() {
        let dir = tempfile::tempdir().unwrap();
        let store = BriefStore::default();
        let (first, existed) = store
            .upsert(Some("plan"), Some("Migration"), Some("md"), "# Step 1".into(), false, Some(dir.path().to_str().unwrap()))
            .unwrap();
        assert!(!existed);
        assert_eq!(first.path, "hold-my-brief:brief/plan");
        assert_eq!(first.title, "Migration");

        let (second, existed2) = store
            .upsert(Some("plan"), None, Some("md"), "## Step 2".into(), true, None)
            .unwrap();
        assert!(existed2);
        assert_eq!(second.title, "Migration");
        assert_eq!(second.content, "# Step 1\n## Step 2");
        assert!(second.base_dir.is_some());
    }

    #[test]
    fn constant_time_token_comparison_matches_exact_bytes() {
        let tok = generate_token();
        assert_eq!(tok.len(), 64);
        assert!(constant_time_eq(tok.as_bytes(), tok.as_bytes()));
        assert!(!constant_time_eq(tok.as_bytes(), b"wrong"));
        let mut flipped = tok.as_bytes().to_vec();
        flipped[0] ^= 1;
        assert!(!constant_time_eq(tok.as_bytes(), &flipped));
    }

    #[test]
    fn discovery_file_writes_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("control.json");
        let info = DiscoveryInfo {
            version: 1,
            pid: 42,
            transport: "unix".into(),
            socket: Some("/tmp/test.sock".into()),
            addr: None,
            token: None,
        };
        write_discovery(&file, &info).unwrap();
        let loaded: DiscoveryInfo = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        assert_eq!(loaded.pid, 42);
        assert_eq!(loaded.socket.as_deref(), Some("/tmp/test.sock"));
    }

    fn event(kind: &str, text: &str) -> Value {
        json!({ "type": kind, "text": text })
    }

    fn seqs(reply: &Value) -> Vec<u64> {
        reply["events"].as_array().unwrap().iter().map(|e| e["seq"].as_u64().unwrap()).collect()
    }

    #[test]
    fn event_ring_keeps_newest_256_and_reports_dropped() {
        let log = EventLog::default();
        for i in 0..300 {
            assert_eq!(log.push(event("page", &i.to_string())).unwrap(), i + 1);
        }
        let all = log.query(0, Duration::ZERO, None, 256);
        let got = seqs(&all);
        assert_eq!((got.len(), got[0], *got.last().unwrap()), (256, 45, 300));
        assert_eq!(all["dropped"], json!(true));
        assert_eq!(all["next"], json!(300));
        // The client has seen everything up to 44: nothing it has not seen was lost.
        assert!(log.query(44, Duration::ZERO, None, 256).get("dropped").is_none());
        assert_eq!(log.query(299, Duration::ZERO, None, 256)["events"][0]["text"], json!("299"));
    }

    #[test]
    fn event_queries_filter_by_since_types_and_limit() {
        let log = EventLog::default();
        for (kind, text) in [("selection", "a"), ("page", "b"), ("send", "c"), ("selection", "d")] {
            log.push(event(kind, text)).unwrap();
        }
        assert_eq!(seqs(&log.query(0, Duration::ZERO, None, 50)), [1, 2, 3, 4]);
        assert_eq!(seqs(&log.query(2, Duration::ZERO, None, 50)), [3, 4]);
        let wanted = vec!["selection".to_string(), "send".to_string()];
        assert_eq!(seqs(&log.query(0, Duration::ZERO, Some(&wanted), 50)), [1, 3, 4]);
        let limited = log.query(0, Duration::ZERO, None, 2);
        assert_eq!((seqs(&limited), limited["next"].clone()), (vec![1, 2], json!(2)));
        let none = log.query(4, Duration::ZERO, None, 50);
        assert_eq!((seqs(&none).len(), none["next"].clone()), (0, json!(4)));
        // A type filter that matches nothing still reports the latest seq as `next`.
        let page_only = vec!["page".to_string()];
        assert_eq!(log.query(2, Duration::ZERO, Some(&page_only), 50)["next"], json!(4));
    }

    #[test]
    fn waiting_query_returns_when_a_matching_event_is_pushed() {
        let log = Arc::new(EventLog::default());
        let producer = log.clone();
        let started = Instant::now();
        let handle = thread::spawn(move || {
            thread::sleep(Duration::from_millis(100));
            producer.push(event("page", "ignored")).unwrap();
            thread::sleep(Duration::from_millis(100));
            producer.push(event("send", "wanted")).unwrap();
        });
        let wanted = vec!["send".to_string()];
        let reply = log.query(0, Duration::from_secs(10), Some(&wanted), 50);
        handle.join().unwrap();
        assert!(started.elapsed() < Duration::from_secs(5));
        assert_eq!(seqs(&reply), [2]);
        assert_eq!(reply["events"][0]["text"], json!("wanted"));
    }

    #[test]
    fn waiting_query_times_out_empty_with_latest_next() {
        let log = EventLog::default();
        log.push(event("tab", "x")).unwrap();
        let started = Instant::now();
        let reply = log.query(1, Duration::from_millis(150), None, 50);
        assert!(started.elapsed() >= Duration::from_millis(150));
        assert_eq!(reply["events"], json!([]));
        assert_eq!(reply["next"], json!(1));
    }

    #[test]
    fn clear_empties_the_log_but_keeps_counting() {
        let log = EventLog::default();
        log.push(event("page", "a")).unwrap();
        log.push(event("page", "b")).unwrap();
        log.clear();
        let empty = log.query(0, Duration::ZERO, None, 50);
        assert_eq!((seqs(&empty).len(), empty["next"].clone()), (0, json!(2)));
        assert_eq!(empty["dropped"], json!(true));
        assert_eq!(log.push(event("page", "c")).unwrap(), 3);
    }

    #[test]
    fn push_rejects_bad_events_and_truncates_long_strings() {
        let log = EventLog::default();
        assert!(log.push(json!("selection")).is_err());
        assert!(log.push(json!([{ "type": "selection" }])).is_err());
        assert!(log.push(json!({ "text": "no type" })).is_err());
        assert!(log.push(json!({ "type": 7 })).is_err());
        assert!(log.push(json!({ "type": "keystroke" })).is_err());
        assert_eq!(log.query(0, Duration::ZERO, None, 50)["next"], json!(0));

        let long = "é".repeat(5000);
        log.push(json!({ "type": "selection", "text": long, "seq": 99, "at": 1 })).unwrap();
        let reply = log.query(0, Duration::ZERO, None, 50);
        let stored = &reply["events"][0];
        assert_eq!(stored["text"].as_str().unwrap().chars().count(), 2000);
        assert_eq!(stored["seq"], json!(1));
        assert!(stored["at"].as_u64().unwrap() > 1);
    }

    #[test]
    fn events_params_are_clamped() {
        let q = parse_events_params(&json!({}));
        assert_eq!((q.since, q.wait, q.limit, q.types), (0, Duration::ZERO, 50, None));
        let q = parse_events_params(&json!({ "since": 7, "wait": 999999, "limit": 9999, "types": ["send", 3] }));
        assert_eq!((q.since, q.wait, q.limit), (7, Duration::from_secs(60), 256));
        assert_eq!(q.types, Some(vec!["send".to_string()]));
    }

    /// A PNG header (signature, IHDR with the size) padded to `len` bytes: enough for `record_area`, which never decodes pixels.
    fn fake_png(width: u32, height: u32, len: usize) -> Vec<u8> {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.resize(len.max(24), 0);
        bytes
    }

    fn area_bridge(dir: &Path) -> Arc<ControlBridge> {
        ControlBridge::with_watcher(dir.join("control.json"), dir.join(AREAS_DIR), FileWatcher::idle())
    }

    fn area_meta() -> Value {
        json!({ "paneId": "p1", "path": "/a.pdf", "title": "A", "page": 2, "box": { "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4 }, "image": "/etc/passwd", "type": "send" })
    }

    #[test]
    fn an_area_is_stored_and_recorded_with_the_path_of_its_png() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = area_bridge(dir.path());
        let png = fake_png(300, 200, 64);
        let seq = bridge.record_area(true, &png, area_meta()).unwrap().unwrap();
        let reply = bridge.events.query(0, Duration::ZERO, Some(&["area".to_string()]), 50);
        let stored = &reply["events"][0];
        let file = dir.path().join(AREAS_DIR).join(format!("{seq}.png"));
        assert_eq!(stored["seq"], json!(seq));
        assert_eq!(stored["type"], json!("area"));
        assert_eq!(stored["image"], json!(file.to_string_lossy()));
        assert_eq!((stored["paneId"].clone(), stored["title"].clone(), stored["page"].clone()), (json!("p1"), json!("A"), json!(2)));
        assert_eq!(stored["box"], json!({ "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4 }));
        assert_eq!((stored["width"].clone(), stored["height"].clone()), (json!(300), json!(200)));
        assert_eq!(fs::read(&file).unwrap(), png);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(fs::metadata(dir.path().join(AREAS_DIR)).unwrap().permissions().mode() & 0o777, 0o700);
        }
    }

    #[test]
    fn only_the_newest_twenty_areas_are_kept() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = area_bridge(dir.path());
        let seqs: Vec<u64> = (0..25).map(|_| bridge.record_area(true, &fake_png(8, 8, 32), area_meta()).unwrap().unwrap()).collect();
        let mut kept: Vec<u64> = fs::read_dir(dir.path().join(AREAS_DIR))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_str().unwrap().trim_end_matches(".png").parse().unwrap())
            .collect();
        kept.sort_unstable();
        assert_eq!(kept, seqs[5..].to_vec());
    }

    #[test]
    fn a_non_png_or_oversize_area_is_refused_and_leaves_nothing_behind() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = area_bridge(dir.path());
        assert!(bridge.record_area(true, b"GIF89a not a png at all, long enough", area_meta()).is_err());
        assert!(bridge.record_area(true, &PNG_SIGNATURE, area_meta()).is_err());
        assert!(bridge.record_area(true, &fake_png(8, 8, AREA_MAX_BYTES + 1), area_meta()).is_err());
        assert!(bridge.record_area(true, &fake_png(8, 8, 32), json!("meta")).is_err());
        assert!(!dir.path().join(AREAS_DIR).exists());
        assert_eq!(bridge.events.query(0, Duration::ZERO, None, 50)["events"], json!([]));
        // A refusal consumes no seq.
        assert_eq!(bridge.record_area(true, &fake_png(8, 8, AREA_MAX_BYTES), area_meta()).unwrap(), Some(1));
    }

    #[test]
    fn nothing_is_stored_or_recorded_while_control_is_off() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = area_bridge(dir.path());
        assert_eq!(bridge.record_area(false, &fake_png(8, 8, 32), area_meta()), Ok(None));
        assert!(!dir.path().join(AREAS_DIR).exists());
        assert_eq!(bridge.events.query(0, Duration::ZERO, None, 50)["events"], json!([]));
    }

    #[test]
    fn turning_control_off_removes_the_areas_folder() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = area_bridge(dir.path());
        bridge.record_area(true, &fake_png(8, 8, 32), area_meta()).unwrap();
        assert!(dir.path().join(AREAS_DIR).exists());
        bridge.clear_areas();
        assert!(!dir.path().join(AREAS_DIR).exists());
        bridge.clear_areas();
    }

    #[test]
    fn a_waiting_events_call_does_not_block_ping_or_status() {
        let bridge = ControlBridge::with_watcher(PathBuf::from("unused-control.json"), PathBuf::from("unused-areas"), FileWatcher::idle());
        let waiter = bridge.clone();
        let handle = thread::spawn(move || {
            let req = ControlRequest {
                id: "w".into(),
                token: None,
                method: "events".into(),
                params: json!({ "wait": 10000, "types": ["send"] }),
            };
            waiter.dispatch_native(&req).unwrap()
        });
        thread::sleep(Duration::from_millis(150));

        let started = Instant::now();
        let ping = ControlRequest { id: "p".into(), token: None, method: "ping".into(), params: Value::Null };
        let pong = bridge.dispatch_native(&ping).unwrap();
        assert!(pong.ok);
        let status = bridge.status(true);
        assert!(!status.running);
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(!handle.is_finished());

        bridge.events.push(event("send", "go")).unwrap();
        let reply = handle.join().unwrap();
        assert!(reply.ok);
        assert_eq!(reply.result.unwrap()["events"][0]["text"], json!("go"));
    }
}
