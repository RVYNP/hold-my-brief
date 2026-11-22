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
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Condvar, Mutex,
    },
    thread,
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Emitter, Manager, State};

/// Virtual path prefix for ephemeral briefs (never persisted to library or recents).
pub const BRIEF_PREFIX: &str = "hold-my-brief:brief/";
const MAX_REQUEST_BYTES: u64 = 8 * 1024 * 1024;
const MAX_BRIEF_BYTES: usize = 4 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const READY_TIMEOUT: Duration = Duration::from_secs(8);
const WATCH_POLL: Duration = Duration::from_millis(350);

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
    ready: Mutex<bool>,
    ready_cv: Condvar,
    next_id: AtomicU64,
    pending: Mutex<HashMap<String, mpsc::Sender<Result<Value, String>>>>,
    server: Mutex<Option<ServerHandle>>,
    pub briefs: BriefStore,
    pub watcher: Arc<FileWatcher>,
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
        Arc::new(Self {
            discovery_path: default_discovery_path(app_data_dir),
            ready: Mutex::new(false),
            ready_cv: Condvar::new(),
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            server: Mutex::new(None),
            briefs: BriefStore::default(),
            watcher: FileWatcher::start(app.clone()),
        })
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
        let id = req.id.clone();
        let method = req.method.as_str();
        if method == "ping" {
            let ready = self.ready.lock().map(|r| *r).unwrap_or(false);
            return ControlResponse::ok(id, json!({ "version": 1, "pid": std::process::id(), "ready": ready }));
        }
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
                let canonical = crate::catalog::canonical_file(Path::new(&raw_path))
                    .map_err(|_| format!("File not found or unsupported format: {raw_path}"))?;
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
                if let Some(beside_raw) = obj
                    .get("beside")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty() && !s.starts_with(BRIEF_PREFIX))
                    .map(str::to_string)
                {
                    let beside_canonical = crate::catalog::canonical_file(Path::new(&beside_raw))
                        .map_err(|_| format!("Beside file not found or unsupported format: {beside_raw}"))?;
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

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

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
}
