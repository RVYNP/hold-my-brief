//! `hmb` — fast, token-cheap CLI and compact stdio MCP bridge for Hold My Brief.
//!
//! Speaks newline-delimited JSON-RPC over the local per-user control socket described by
//! `control.json` (Unix domain socket on macOS/Linux, token-guarded loopback TCP on Windows).

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    env, fs,
    io::{self, BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const APP_ID: &str = "xyz.rpayton.holdmybrief";
const LAUNCH_WAIT: Duration = Duration::from_secs(6);
const IO_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryInfo {
    transport: String,
    socket: Option<String>,
    addr: Option<String>,
    token: Option<String>,
}

#[derive(Debug, Serialize)]
struct ControlRequest<'a> {
    id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<&'a str>,
    method: &'a str,
    params: Value,
}

#[derive(Debug, Deserialize)]
struct ControlResponse {
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

fn discovery_path() -> PathBuf {
    if let Some(override_path) = env::var_os("HMB_CONTROL_FILE").filter(|v| !v.is_empty()) {
        return PathBuf::from(override_path);
    }
    #[cfg(target_os = "macos")]
    {
        let home = env::var_os("HOME").unwrap_or_default();
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(APP_ID)
            .join("control.json")
    }
    #[cfg(target_os = "windows")]
    {
        let base = env::var_os("LOCALAPPDATA").unwrap_or_default();
        PathBuf::from(base).join(APP_ID).join("control.json")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let base = env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env::var_os("HOME").unwrap_or_default()).join(".local/share"));
        base.join(APP_ID).join("control.json")
    }
}

fn load_discovery() -> Result<DiscoveryInfo, String> {
    let path = discovery_path();
    let bytes = fs::read(&path).map_err(|_| {
        format!(
            "Hold My Brief is not running (or agent control is turned off in Settings). Expected {}.",
            path.display()
        )
    })?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Invalid control file: {e}"))
}

/// Why a request did not succeed. Only `Unreachable` may lead to launching the app and sending
/// again: once the app has the request it may already have applied it (`brief --append`), so an
/// error it answers with goes back to the caller as is.
#[derive(Debug)]
enum SendError {
    Unreachable(String),
    Failed(String),
}

impl SendError {
    fn into_message(self) -> String {
        match self {
            SendError::Unreachable(message) | SendError::Failed(message) => message,
        }
    }
}

const EVENT_TYPES: [&str; 4] = ["selection", "page", "tab", "send"];
const EVENTS_DEFAULT_WAIT_SECS: u64 = 30;
const EVENTS_MAX_WAIT_SECS: u64 = 60;
const MCP_MAX_WAIT_SECS: u64 = 30;

/// Read timeout for one request: a waiting `events` call is silent for up to its `wait`.
fn request_timeout(method: &str, params: &Value) -> Duration {
    let wait_ms = if method == "events" {
        params.get("wait").and_then(Value::as_u64).unwrap_or(0).min(EVENTS_MAX_WAIT_SECS * 1000)
    } else {
        0
    };
    IO_TIMEOUT + Duration::from_millis(wait_ms)
}

fn send_once(info: &DiscoveryInfo, method: &str, params: Value) -> Result<Value, SendError> {
    let timeout = request_timeout(method, &params);
    let req = ControlRequest {
        id: "1",
        token: info.token.as_deref(),
        method,
        params,
    };
    let mut payload = serde_json::to_vec(&req).map_err(|e| SendError::Failed(e.to_string()))?;
    payload.push(b'\n');

    let raw_line = match info.transport.as_str() {
        #[cfg(unix)]
        "unix" => {
            use std::os::unix::net::UnixStream;
            let sock = info
                .socket
                .as_deref()
                .ok_or_else(|| SendError::Unreachable("Missing unix socket path in control.json".into()))?;
            let mut stream = UnixStream::connect(sock)
                .map_err(|e| SendError::Unreachable(format!("Could not connect to Hold My Brief ({sock}): {e}")))?;
            let _ = stream.set_read_timeout(Some(timeout));
            let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
            stream.write_all(&payload).map_err(|e| SendError::Unreachable(e.to_string()))?;
            stream.flush().map_err(|e| SendError::Unreachable(e.to_string()))?;
            let mut line = String::new();
            BufReader::new(stream).read_line(&mut line).map_err(|e| SendError::Failed(e.to_string()))?;
            line
        }
        "tcp" => {
            use std::net::TcpStream;
            let addr = info
                .addr
                .as_deref()
                .ok_or_else(|| SendError::Unreachable("Missing addr in control.json".into()))?;
            let mut stream = TcpStream::connect(addr)
                .map_err(|e| SendError::Unreachable(format!("Could not connect to Hold My Brief ({addr}): {e}")))?;
            let _ = stream.set_read_timeout(Some(timeout));
            let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
            stream.write_all(&payload).map_err(|e| SendError::Unreachable(e.to_string()))?;
            stream.flush().map_err(|e| SendError::Unreachable(e.to_string()))?;
            let mut line = String::new();
            BufReader::new(stream).read_line(&mut line).map_err(|e| SendError::Failed(e.to_string()))?;
            line
        }
        other => return Err(SendError::Unreachable(format!("Unsupported control transport: {other}"))),
    };

    if raw_line.trim().is_empty() {
        return Err(SendError::Unreachable("Hold My Brief closed the connection without replying.".into()));
    }
    let resp: ControlResponse = serde_json::from_str(&raw_line)
        .map_err(|e| SendError::Failed(format!("Invalid response from Hold My Brief: {e}")))?;
    if resp.ok {
        Ok(resp.result.unwrap_or(Value::Null))
    } else {
        Err(SendError::Failed(resp.error.unwrap_or_else(|| "Request failed.".into())))
    }
}

fn try_launch_app() -> bool {
    if let Ok(explicit) = env::var("HMB_APP_BIN") {
        if !explicit.is_empty() {
            return Command::new(explicit)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .is_ok();
        }
    }
    #[cfg(target_os = "macos")]
    {
        // `-g` launches in the background without stealing focus from the user's editor/terminal.
        if Command::new("open")
            .args(["-g", "-a", "Hold My Brief"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
        {
            return true;
        }
    }
    // Fallback: sibling `hold-my-brief` binary next to `hmb`.
    if let Ok(exe) = env::current_exe() {
        let name = if cfg!(windows) { "hold-my-brief.exe" } else { "hold-my-brief" };
        let sibling = exe.with_file_name(name);
        if sibling.is_file() {
            return Command::new(sibling)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .is_ok();
        }
    }
    false
}

fn send_with_autolaunch(method: &str, params: Value, auto_launch: bool) -> Result<Value, String> {
    send_or_launch(load_discovery, try_launch_app, method, params, auto_launch)
}

/// Sends once; launches the app and sends again only when the app could not be reached.
fn send_or_launch(
    load: impl Fn() -> Result<DiscoveryInfo, String>,
    launch: impl FnOnce() -> bool,
    method: &str,
    params: Value,
    auto_launch: bool,
) -> Result<Value, String> {
    let unreachable = match load() {
        Ok(info) => match send_once(&info, method, params.clone()) {
            Err(SendError::Unreachable(message)) => message,
            answered => return answered.map_err(SendError::into_message),
        },
        Err(message) => message,
    };
    if !auto_launch || !launch() {
        return Err(unreachable);
    }
    let deadline = Instant::now() + LAUNCH_WAIT;
    while Instant::now() < deadline {
        if let Ok(info) = load() {
            if send_once(&info, "ping", json!({})).is_ok() {
                return send_once(&info, method, params).map_err(SendError::into_message);
            }
        }
        thread::sleep(Duration::from_millis(120));
    }
    Err("Launched Hold My Brief, but its control bridge did not become ready in time.".into())
}

fn absolutize(path: &str) -> String {
    let p = Path::new(path);
    if p.is_absolute() {
        path.to_string()
    } else if let Ok(cwd) = env::current_dir() {
        cwd.join(p).to_string_lossy().into_owned()
    } else {
        path.to_string()
    }
}

fn usage() -> &'static str {
    "hmb — fast visual sidecar CLI for Hold My Brief

USAGE:
  hmb status [--json]
  hmb show <file> [--page N | --line N | --heading TEXT | --target T]
                  [--find QUERY] [--beside FILE] [--beside-target T] [--beside-find Q]
                  [--watch] [--ephemeral] [--pin | --unpin] [--compact | --reading] [--focus]
  hmb brief [--id ID] [--title TITLE] [--format md|txt|svg]
            [--file FILE | --text TEXT | --stdin] [--append] [--base-dir DIR]
            [--split right|down] [--target T] [--find Q] [--pin] [--focus]
  hmb read [--limit N] [--selection] [--json]
  hmb find <query> [--show [INDEX]] [--case] [--word] [--json]
  hmb goto <target>
  hmb outline [--json]
  hmb close [<id-or-path> | --briefs]
  hmb cmd [<command-id>] [--theme NAME] [--mode system|light|dark] [--page theme|white|sepia|dim]
          [--pin | --unpin] [--lock | --unlock] [--compact | --reading] [--focus]
  hmb events [--since N] [--wait SECONDS] [--type a,b] [--limit N] [--follow]
             Wait for what the user does: selection, page, tab, send (--follow: NDJSON, never ends)
  hmb mcp                           Run compact stdio MCP server (5 tools)
  hmb ping                          Check connection

GLOBAL FLAGS:
  --json         Print compact JSON output
  --no-launch    Do not auto-launch Hold My Brief if it is not running

Visual blocks supported inside Markdown briefs: ```chart (bar|hbar|line|metrics JSON),
```flow (A[Label] -> B[Label]), ```svg (sanitized theme-aware SVG), and > [!NOTE|TIP|WARNING]."
}

#[derive(Debug, Default, PartialEq)]
struct ParsedCall {
    method: String,
    params: Value,
    json_out: bool,
    auto_launch: bool,
    mcp_mode: bool,
    show_help: bool,
    follow: bool,
}

fn parse_args(args: &[String]) -> Result<ParsedCall, String> {
    let mut json_out = false;
    let mut auto_launch = true;
    let mut rest: Vec<String> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--json" => json_out = true,
            "--no-launch" => auto_launch = false,
            _ => rest.push(args[i].clone()),
        }
        i += 1;
    }
    if rest.is_empty() || matches!(rest[0].as_str(), "-h" | "--help" | "help") {
        return Ok(ParsedCall {
            method: String::new(),
            params: Value::Null,
            json_out,
            auto_launch,
            mcp_mode: false,
            show_help: true,
            follow: false,
        });
    }

    let cmd = rest[0].as_str();
    let tail = &rest[1..];
    if cmd == "mcp" {
        return Ok(ParsedCall {
            method: "mcp".into(),
            params: Value::Null,
            json_out: true,
            auto_launch,
            mcp_mode: true,
            show_help: false,
            follow: false,
        });
    }

    let next_val = |idx: &mut usize, flag: &str| -> Result<String, String> {
        *idx += 1;
        tail.get(*idx)
            .cloned()
            .ok_or_else(|| format!("Missing value for {flag}"))
    };

    let mut params = Map::new();
    match cmd {
        "ping" | "status" | "outline" => {
            return Ok(ParsedCall {
                method: cmd.into(),
                params: Value::Object(params),
                json_out,
                auto_launch,
                mcp_mode: false,
                show_help: false,
                follow: false,
            });
        }
        "goto" => {
            let target = tail.first().ok_or("goto requires a target (page, line, percent, or heading).")?;
            params.insert("target".into(), Value::String(target.clone()));
            return Ok(ParsedCall { method: "goto".into(), params: Value::Object(params), json_out, auto_launch, mcp_mode: false, show_help: false, follow: false });
        }
        "show" => {
            let mut idx = 0;
            let mut file: Option<String> = None;
            while idx < tail.len() {
                match tail[idx].as_str() {
                    "--page" => { params.insert("target".into(), Value::String(next_val(&mut idx, "--page")?)); }
                    "--line" => { params.insert("target".into(), Value::String(next_val(&mut idx, "--line")?)); }
                    "--heading" => {
                        let h = next_val(&mut idx, "--heading")?;
                        params.insert("heading".into(), Value::String(h));
                    }
                    "--target" => { params.insert("target".into(), Value::String(next_val(&mut idx, "--target")?)); }
                    "--find" => { params.insert("find".into(), Value::String(next_val(&mut idx, "--find")?)); }
                    "--beside" => {
                        let b = next_val(&mut idx, "--beside")?;
                        params.insert("beside".into(), Value::String(if b.starts_with("hold-my-brief:") { b } else { absolutize(&b) }));
                    }
                    flag @ ("--beside-page" | "--beside-target") => {
                        params.insert("besideTarget".into(), Value::String(next_val(&mut idx, flag)?));
                    }
                    "--beside-find" => {
                        params.insert("besideFind".into(), Value::String(next_val(&mut idx, "--beside-find")?));
                    }
                    "--watch" => { params.insert("watch".into(), Value::Bool(true)); }
                    "--ephemeral" => { params.insert("ephemeral".into(), Value::Bool(true)); }
                    "--pin" => { params.insert("pin".into(), Value::Bool(true)); }
                    "--unpin" => { params.insert("pin".into(), Value::Bool(false)); }
                    "--lock" => { params.insert("lock".into(), Value::Bool(true)); }
                    "--unlock" => { params.insert("lock".into(), Value::Bool(false)); }
                    "--compact" => { params.insert("preset".into(), Value::String("compact".into())); }
                    "--reading" => { params.insert("preset".into(), Value::String("reading".into())); }
                    "--focus" => { params.insert("focus".into(), Value::Bool(true)); }
                    flag if flag.starts_with('-') => return Err(format!("Unknown flag for show: {flag}")),
                    pos => {
                        if file.is_none() {
                            file = Some(absolutize(pos));
                        } else {
                            return Err(format!("Unexpected argument: {pos}"));
                        }
                    }
                }
                idx += 1;
            }
            let path = file.ok_or("show requires a file path.")?;
            params.insert("path".into(), Value::String(path));
            return Ok(ParsedCall { method: "show".into(), params: Value::Object(params), json_out, auto_launch, mcp_mode: false, show_help: false, follow: false });
        }
        "brief" => {
            let mut idx = 0;
            let mut content: Option<String> = None;
            let mut read_stdin = false;
            let mut from_file: Option<String> = None;
            while idx < tail.len() {
                match tail[idx].as_str() {
                    "--id" => { params.insert("id".into(), Value::String(next_val(&mut idx, "--id")?)); }
                    "--title" => { params.insert("title".into(), Value::String(next_val(&mut idx, "--title")?)); }
                    "--format" => { params.insert("format".into(), Value::String(next_val(&mut idx, "--format")?)); }
                    "--text" => { content = Some(next_val(&mut idx, "--text")?); }
                    "--file" => { from_file = Some(next_val(&mut idx, "--file")?); }
                    "--stdin" => { read_stdin = true; }
                    "--append" => { params.insert("append".into(), Value::Bool(true)); }
                    "--base-dir" => { params.insert("baseDir".into(), Value::String(absolutize(&next_val(&mut idx, "--base-dir")?))); }
                    "--split" => { params.insert("split".into(), Value::String(next_val(&mut idx, "--split")?)); }
                    "--target" => { params.insert("target".into(), Value::String(next_val(&mut idx, "--target")?)); }
                    "--find" => { params.insert("find".into(), Value::String(next_val(&mut idx, "--find")?)); }
                    "--pin" => { params.insert("pin".into(), Value::Bool(true)); }
                    "--unpin" => { params.insert("pin".into(), Value::Bool(false)); }
                    "--compact" => { params.insert("preset".into(), Value::String("compact".into())); }
                    "--reading" => { params.insert("preset".into(), Value::String("reading".into())); }
                    "--focus" => { params.insert("focus".into(), Value::Bool(true)); }
                    flag if flag.starts_with('-') => return Err(format!("Unknown flag for brief: {flag}")),
                    pos => {
                        if content.is_none() { content = Some(pos.to_string()); }
                        else { return Err(format!("Unexpected argument: {pos}")); }
                    }
                }
                idx += 1;
            }
            let body = if let Some(path) = from_file {
                let abs = absolutize(&path);
                if !params.contains_key("baseDir") {
                    if let Some(parent) = Path::new(&abs).parent() {
                        params.insert("baseDir".into(), Value::String(parent.to_string_lossy().into_owned()));
                    }
                }
                fs::read_to_string(&abs).map_err(|e| format!("Could not read {abs}: {e}"))?
            } else if let Some(text) = content {
                text
            } else if read_stdin || !atty_stdin() {
                let mut buf = String::new();
                io::stdin().read_to_string(&mut buf).map_err(|e| format!("Could not read stdin: {e}"))?;
                buf
            } else {
                return Err("brief requires --text, --file, or piped stdin.".into());
            };
            params.insert("content".into(), Value::String(body));
            return Ok(ParsedCall { method: "brief".into(), params: Value::Object(params), json_out, auto_launch, mcp_mode: false, show_help: false, follow: false });
        }
        "read" => {
            let mut idx = 0;
            while idx < tail.len() {
                match tail[idx].as_str() {
                    "--limit" => {
                        let n: u64 = next_val(&mut idx, "--limit")?.parse().map_err(|_| "--limit must be a positive integer.")?;
                        params.insert("limit".into(), Value::from(n));
                    }
                    "--selection" => { params.insert("selectionOnly".into(), Value::Bool(true)); }
                    "--pane" => { params.insert("paneId".into(), Value::String(next_val(&mut idx, "--pane")?)); }
                    flag => return Err(format!("Unknown flag for read: {flag}")),
                }
                idx += 1;
            }
            return Ok(ParsedCall { method: "read".into(), params: Value::Object(params), json_out, auto_launch, mcp_mode: false, show_help: false, follow: false });
        }
        "find" => {
            let mut idx = 0;
            let mut query: Option<String> = None;
            while idx < tail.len() {
                match tail[idx].as_str() {
                    "--case" => { params.insert("matchCase".into(), Value::Bool(true)); }
                    "--word" => { params.insert("wholeWord".into(), Value::Bool(true)); }
                    "--show" => {
                        if let Some(next) = tail.get(idx + 1).and_then(|s| s.parse::<u64>().ok()) {
                            idx += 1;
                            params.insert("show".into(), Value::from(next));
                        } else {
                            params.insert("show".into(), Value::from(0));
                        }
                    }
                    flag if flag.starts_with('-') => return Err(format!("Unknown flag for find: {flag}")),
                    pos => {
                        if query.is_none() { query = Some(pos.to_string()); }
                        else { return Err(format!("Unexpected argument: {pos}")); }
                    }
                }
                idx += 1;
            }
            params.insert("query".into(), Value::String(query.ok_or("find requires a search query.")?));
            return Ok(ParsedCall { method: "find".into(), params: Value::Object(params), json_out, auto_launch, mcp_mode: false, show_help: false, follow: false });
        }
        "close" => {
            let mut idx = 0;
            while idx < tail.len() {
                match tail[idx].as_str() {
                    "--briefs" => { params.insert("allBriefs".into(), Value::Bool(true)); }
                    pos if !pos.starts_with('-') => {
                        if pos.contains('/') || pos.contains('\\') || Path::new(pos).exists() {
                            params.insert("path".into(), Value::String(absolutize(pos)));
                        } else {
                            params.insert("id".into(), Value::String(pos.to_string()));
                        }
                    }
                    flag => return Err(format!("Unknown flag for close: {flag}")),
                }
                idx += 1;
            }
            return Ok(ParsedCall { method: "close".into(), params: Value::Object(params), json_out, auto_launch, mcp_mode: false, show_help: false, follow: false });
        }
        "cmd" => {
            let mut idx = 0;
            let mut appearance = Map::new();
            while idx < tail.len() {
                match tail[idx].as_str() {
                    "--theme" => { appearance.insert("theme".into(), Value::String(next_val(&mut idx, "--theme")?)); }
                    "--mode" => { appearance.insert("mode".into(), Value::String(next_val(&mut idx, "--mode")?)); }
                    "--page" => { appearance.insert("page".into(), Value::String(next_val(&mut idx, "--page")?)); }
                    "--pin" => { params.insert("pin".into(), Value::Bool(true)); }
                    "--unpin" => { params.insert("pin".into(), Value::Bool(false)); }
                    "--lock" => { params.insert("lock".into(), Value::Bool(true)); }
                    "--unlock" => { params.insert("lock".into(), Value::Bool(false)); }
                    "--compact" => { params.insert("preset".into(), Value::String("compact".into())); }
                    "--reading" => { params.insert("preset".into(), Value::String("reading".into())); }
                    "--focus" => { params.insert("focus".into(), Value::Bool(true)); }
                    flag if flag.starts_with('-') => return Err(format!("Unknown flag for cmd: {flag}")),
                    pos => { params.insert("command".into(), Value::String(pos.to_string())); }
                }
                idx += 1;
            }
            if !appearance.is_empty() {
                params.insert("appearance".into(), Value::Object(appearance));
            }
            return Ok(ParsedCall { method: "cmd".into(), params: Value::Object(params), json_out, auto_launch, mcp_mode: false, show_help: false, follow: false });
        }
        "events" => {
            let mut idx = 0;
            let mut follow = false;
            let mut wait_secs: Option<u64> = None;
            let mut types: Vec<Value> = Vec::new();
            while idx < tail.len() {
                match tail[idx].as_str() {
                    "--since" => {
                        let n: u64 = next_val(&mut idx, "--since")?.parse().map_err(|_| "--since must be a non-negative integer.")?;
                        params.insert("since".into(), Value::from(n));
                    }
                    "--wait" => {
                        let n: u64 = next_val(&mut idx, "--wait")?.parse().map_err(|_| "--wait must be a whole number of seconds.")?;
                        if n > EVENTS_MAX_WAIT_SECS {
                            return Err(format!("--wait must be at most {EVENTS_MAX_WAIT_SECS} seconds."));
                        }
                        wait_secs = Some(n);
                    }
                    "--type" | "--types" => {
                        for name in next_val(&mut idx, "--type")?.split(',').map(str::trim) {
                            if !EVENT_TYPES.contains(&name) {
                                return Err(format!("Unknown event type '{name}'. Types: {}.", EVENT_TYPES.join(", ")));
                            }
                            types.push(Value::String(name.into()));
                        }
                    }
                    "--limit" => {
                        let n: u64 = next_val(&mut idx, "--limit")?.parse().map_err(|_| "--limit must be a positive integer.")?;
                        if n == 0 {
                            return Err("--limit must be a positive integer.".into());
                        }
                        params.insert("limit".into(), Value::from(n));
                    }
                    "--follow" => follow = true,
                    flag if flag.starts_with('-') => return Err(format!("Unknown flag for events: {flag}")),
                    pos => return Err(format!("Unexpected argument: {pos}")),
                }
                idx += 1;
            }
            // A follow loop that asked for no wait would spin on the socket; it waits one second at least.
            let wait = wait_secs.unwrap_or(EVENTS_DEFAULT_WAIT_SECS);
            params.insert("wait".into(), Value::from(if follow { wait.max(1) } else { wait } * 1000));
            if !types.is_empty() {
                params.insert("types".into(), Value::Array(types));
            }
            return Ok(ParsedCall {
                method: "events".into(),
                params: Value::Object(params),
                json_out,
                auto_launch,
                follow,
                ..ParsedCall::default()
            });
        }
        other => Err(format!("Unknown command '{other}'. Run `hmb --help` for usage.")),
    }
}

fn atty_stdin() -> bool {
    use std::io::IsTerminal;
    io::stdin().is_terminal()
}

fn print_human(method: &str, value: &Value) {
    match method {
        "read" => {
            if let Some(text) = value.get("selection").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                if value.get("text").is_none() {
                    println!("{text}");
                    return;
                }
            }
            if let Some(text) = value.get("text").and_then(Value::as_str) {
                println!("{text}");
                return;
            }
            println!("{}", serde_json::to_string_pretty(value).unwrap_or_default());
        }
        "events" => {
            let _ = write_events_human(&mut io::stdout().lock(), value);
        }
        _ => println!("{}", serde_json::to_string(value).unwrap_or_default()),
    }
}

/// `seq type place text…` — one line per event. Whitespace in selected text is collapsed.
fn event_line(event: &Value) -> String {
    let field = |key: &str| event.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
    let mut parts = vec![event.get("seq").and_then(Value::as_u64).unwrap_or(0).to_string()];
    parts.push(field("type").unwrap_or("?").to_string());
    let place = field("where").or_else(|| field("position")).or_else(|| field("title")).or_else(|| field("path"));
    parts.extend(place.map(str::to_string));
    parts.extend(field("action").map(str::to_string));
    if let Some(text) = field("text") {
        parts.push(text.split_whitespace().collect::<Vec<_>>().join(" "));
    }
    parts.join(" ")
}

fn write_events_human(out: &mut impl Write, reply: &Value) -> io::Result<()> {
    if reply.get("dropped").and_then(Value::as_bool) == Some(true) {
        writeln!(out, "(older events were dropped)")?;
    }
    for event in reply.get("events").and_then(Value::as_array).into_iter().flatten() {
        writeln!(out, "{}", event_line(event))?;
    }
    out.flush()
}

/// Calls `events` again and again, each time from the previous `next`, and writes every event as
/// one JSON line. Returns `Ok` when the reader of `out` goes away, `Err` when the app stops answering.
fn follow_events(
    mut send: impl FnMut(Value) -> Result<Value, String>,
    out: &mut impl Write,
    mut params: Map<String, Value>,
) -> Result<(), String> {
    loop {
        let reply = send(Value::Object(params.clone()))?;
        for event in reply.get("events").and_then(Value::as_array).into_iter().flatten() {
            if writeln!(out, "{event}").is_err() {
                return Ok(());
            }
        }
        if out.flush().is_err() {
            return Ok(());
        }
        if let Some(next) = reply.get("next").and_then(Value::as_u64) {
            params.insert("since".into(), Value::from(next));
        }
    }
}

/// The sender for a `--follow` loop. Only the first round may launch the app: a later unreachable
/// app means the user quit it (or turned Agent control off), and the loop must end, not relaunch it.
fn follow_sender<'a>(
    load: impl Fn() -> Result<DiscoveryInfo, String> + 'a,
    launch: impl Fn() -> bool + 'a,
    auto_launch: bool,
) -> impl FnMut(Value) -> Result<Value, String> + 'a {
    let mut first = true;
    move |params| {
        let may_launch = auto_launch && std::mem::take(&mut first);
        send_or_launch(&load, &launch, "events", params, may_launch)
    }
}

/// The MCP `hmb_events` arguments (`wait` in seconds, at most 30) as control-method params.
fn mcp_events_params(args: &Value) -> Value {
    let mut params = Map::new();
    if let Some(since) = args.get("since").and_then(Value::as_u64) {
        params.insert("since".into(), Value::from(since));
    }
    if let Some(wait) = args.get("wait").and_then(Value::as_u64) {
        params.insert("wait".into(), Value::from(wait.min(MCP_MAX_WAIT_SECS) * 1000));
    }
    if let Some(types) = args.get("types").filter(|t| t.is_array()) {
        params.insert("types".into(), types.clone());
    }
    Value::Object(params)
}

// ---------------------------------------------------------------- compact stdio MCP server

fn mcp_tools() -> Value {
    json!([
        {
            "name": "hmb_brief",
            "description": "Show or update an ephemeral visual brief in Hold My Brief (Markdown with ```chart, ```flow, ```svg, tables, code, and callouts). Updates in place by id without cluttering the user's library or stealing focus.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Stable brief slug (reusing an id updates that tab in place). Default: 'default'." },
                    "title": { "type": "string", "description": "Tab title." },
                    "content": { "type": "string", "description": "Markdown, plain text, or SVG content." },
                    "format": { "type": "string", "enum": ["md", "txt", "svg"] },
                    "append": { "type": "boolean" },
                    "baseDir": { "type": "string", "description": "Optional directory for relative local images." },
                    "split": { "type": "string", "enum": ["right", "down"], "description": "Open beside the current document." },
                    "pin": { "type": "boolean" },
                    "focus": { "type": "boolean" }
                },
                "required": ["content"]
            }
        },
        {
            "name": "hmb_show",
            "description": "Open a local document (PDF, EPUB, Markdown, text, PNG/JPEG/WebP/SVG) in Hold My Brief, optionally jumping to a page/line/heading, highlighting a search match, watching for file edits, or splitting beside a second file.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "target": { "type": "string", "description": "Page number, line number, or percentage." },
                    "heading": { "type": "string", "description": "Heading text to jump to." },
                    "find": { "type": "string", "description": "Exact text to search and highlight." },
                    "beside": { "type": "string", "description": "Optional second file path to open in a split pane." },
                    "besideTarget": { "type": "string" },
                    "watch": { "type": "boolean", "description": "Auto-reload tab when file changes on disk." },
                    "ephemeral": { "type": "boolean" },
                    "pin": { "type": "boolean" },
                    "focus": { "type": "boolean" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "hmb_status",
            "description": "Get compact JSON state of Hold My Brief: open tabs, active document/position, split panes, pin/lock, and the user's current text selection.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "hmb_read",
            "description": "Read plain text from the user's current page/viewport or selection in Hold My Brief.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": { "type": "integer", "description": "Max characters (default 8000)." },
                    "selectionOnly": { "type": "boolean" }
                }
            }
        },
        {
            "name": "hmb_events",
            "description": "Wait for what the user does in Hold My Brief: text they select, pages they turn to, tabs they show or close, and 'Send selection to agent'. Returns { events, next }: pass `next` back as `since` to continue. Blocks up to `wait` seconds for a new event; an empty list after the wait is normal. Use types [\"send\",\"selection\"] to hear only what the user points at.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "since": { "type": "integer", "description": "Return events with seq greater than this (default 0). Use the `next` of the previous reply." },
                    "wait": { "type": "integer", "description": "Seconds to wait for a new event (default 0, at most 30)." },
                    "types": { "type": "array", "items": { "type": "string", "enum": ["selection", "page", "tab", "send"] } }
                }
            }
        }
    ])
}

fn handle_mcp_message(msg: &Value, auto_launch: bool) -> Option<Value> {
    let method = msg.get("method").and_then(Value::as_str)?;
    let id = msg.get("id").cloned();
    // Notifications have no id and expect no reply.
    if id.is_none() {
        return None;
    }
    let id = id.unwrap();
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "hold-my-brief", "version": env!("CARGO_PKG_VERSION") }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": mcp_tools() })),
        "tools/call" => {
            let params = msg.get("params").and_then(Value::as_object);
            let tool_name = params.and_then(|p| p.get("name")).and_then(Value::as_str).unwrap_or("");
            let mut args = params.and_then(|p| p.get("arguments")).cloned().unwrap_or_else(|| json!({}));
            if tool_name == "hmb_events" {
                args = mcp_events_params(&args);
            }
            let rpc_method = match tool_name {
                "hmb_brief" => Some("brief"),
                "hmb_show" => Some("show"),
                "hmb_status" => Some("status"),
                "hmb_read" => Some("read"),
                "hmb_events" => Some("events"),
                _ => None,
            };
            match rpc_method {
                Some(m) => match send_with_autolaunch(m, args, auto_launch) {
                    Ok(val) => Ok(json!({
                        "content": [{ "type": "text", "text": serde_json::to_string(&val).unwrap_or_default() }]
                    })),
                    Err(err) => Ok(json!({
                        "isError": true,
                        "content": [{ "type": "text", "text": err }]
                    })),
                },
                None => Err((-32601, format!("Unknown tool: {tool_name}"))),
            }
        }
        other => Err((-32601, format!("Method not found: {other}"))),
    };
    Some(match result {
        Ok(res) => json!({ "jsonrpc": "2.0", "id": id, "result": res }),
        Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
    })
}

fn run_mcp(auto_launch: bool) -> i32 {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(reply) = handle_mcp_message(&msg, auto_launch) {
            if let Ok(text) = serde_json::to_string(&reply) {
                let _ = writeln!(stdout, "{text}");
                let _ = stdout.flush();
            }
        }
    }
    0
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let parsed = match parse_args(&args) {
        Ok(p) => p,
        Err(err) => {
            eprintln!("error: {err}");
            std::process::exit(2);
        }
    };
    if parsed.show_help {
        println!("{}", usage());
        return;
    }
    if parsed.mcp_mode {
        std::process::exit(run_mcp(parsed.auto_launch));
    }
    if parsed.follow {
        let auto_launch = parsed.auto_launch;
        let params = parsed.params.as_object().cloned().unwrap_or_default();
        let result = follow_events(
            follow_sender(load_discovery, try_launch_app, auto_launch),
            &mut io::stdout().lock(),
            params,
        );
        if let Err(err) = result {
            eprintln!("error: {err}");
            std::process::exit(1);
        }
        return;
    }
    match send_with_autolaunch(&parsed.method, parsed.params, parsed.auto_launch) {
        Ok(value) => {
            if parsed.json_out {
                println!("{}", serde_json::to_string(&value).unwrap_or_default());
            } else {
                print_human(&parsed.method, &value);
            }
        }
        Err(err) => {
            if parsed.json_out {
                println!("{}", json!({ "ok": false, "error": err }));
            } else {
                eprintln!("error: {err}");
            }
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vec_args(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    /// A stand-in for the app's Windows transport: answers each request line with `reply(method)`
    /// and records the methods it was sent, in order.
    fn stub_app(reply: fn(&str) -> Value) -> (DiscoveryInfo, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let log = seen.clone();
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut line = String::new();
                BufReader::new(stream.try_clone().unwrap()).read_line(&mut line).unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                let method = request["method"].as_str().unwrap().to_string();
                log.lock().unwrap().push(method.clone());
                let _ = writeln!(stream, "{}", reply(&method));
            }
        });
        let info = DiscoveryInfo { transport: "tcp".into(), socket: None, addr: Some(addr), token: None };
        (info, seen)
    }

    #[test]
    fn an_error_answer_is_returned_once_and_never_launches_or_resends() {
        let (info, seen) = stub_app(|_| json!({ "id": "1", "ok": false, "error": "Heading not found: Nope" }));
        let launched = std::cell::Cell::new(false);
        let result = send_or_launch(
            || Ok(info.clone()),
            || { launched.set(true); true }, // `open -g -a` succeeds when the app is already running.
            "brief",
            json!({ "id": "plan", "append": true, "content": "row", "heading": "Nope" }),
            true,
        );
        assert_eq!(result.unwrap_err(), "Heading not found: Nope");
        assert!(!launched.get());
        assert_eq!(*seen.lock().unwrap(), ["brief"]);
    }

    #[test]
    fn an_unreachable_app_is_launched_and_the_request_sent_once_it_answers() {
        let (info, seen) = stub_app(|_| json!({ "id": "1", "ok": true, "result": { "id": "plan" } }));
        let launched = std::cell::Cell::new(false);
        let result = send_or_launch(
            || if launched.get() { Ok(info.clone()) } else { Err("Hold My Brief is not running.".into()) },
            || { launched.set(true); true },
            "brief",
            json!({ "id": "plan", "content": "row" }),
            true,
        );
        assert_eq!(result.unwrap()["id"], "plan");
        assert_eq!(*seen.lock().unwrap(), ["ping", "brief"]);
    }

    #[test]
    fn parses_compound_show_command() {
        let file = env::temp_dir().join("spec.pdf").to_string_lossy().into_owned();
        let parsed = parse_args(&vec_args(&[
            "show", &file, "--page", "14", "--find", "refresh", "--watch", "--pin", "--json",
        ]))
        .unwrap();
        assert_eq!(parsed.method, "show");
        assert!(parsed.json_out);
        assert_eq!(parsed.params["path"], file.as_str());
        assert_eq!(parsed.params["target"], "14");
        assert_eq!(parsed.params["find"], "refresh");
        assert_eq!(parsed.params["watch"], true);
        assert_eq!(parsed.params["pin"], true);
    }

    #[test]
    fn parses_brief_with_text_and_split() {
        let parsed = parse_args(&vec_args(&[
            "brief", "--id", "plan", "--title", "Plan", "--text", "# Hello", "--split", "right", "--append",
        ]))
        .unwrap();
        assert_eq!(parsed.method, "brief");
        assert_eq!(parsed.params["id"], "plan");
        assert_eq!(parsed.params["title"], "Plan");
        assert_eq!(parsed.params["content"], "# Hello");
        assert_eq!(parsed.params["split"], "right");
        assert_eq!(parsed.params["append"], true);
    }

    #[test]
    fn mcp_initialize_and_tools_list_return_compact_catalog() {
        let init = handle_mcp_message(&json!({"jsonrpc": "2.0", "id": 1, "method": "initialize"}), false).unwrap();
        assert_eq!(init["result"]["serverInfo"]["name"], "hold-my-brief");
        let list = handle_mcp_message(&json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}), false).unwrap();
        let names: Vec<&str> = list["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["hmb_brief", "hmb_show", "hmb_status", "hmb_read", "hmb_events"]);
    }

    #[test]
    fn parses_events_with_every_flag() {
        let parsed = parse_args(&vec_args(&[
            "events", "--since", "12", "--wait", "45", "--type", "send,selection", "--limit", "5", "--json",
        ]))
        .unwrap();
        assert_eq!(parsed.method, "events");
        assert!(parsed.json_out && !parsed.follow);
        assert_eq!(parsed.params, json!({ "since": 12, "wait": 45000, "types": ["send", "selection"], "limit": 5 }));

        let follow = parse_args(&vec_args(&["events", "--follow", "--type", "tab", "--type", "page"])).unwrap();
        assert!(follow.follow);
        assert_eq!(follow.params, json!({ "wait": 30000, "types": ["tab", "page"] }));
    }

    #[test]
    fn events_default_to_a_30_second_wait_and_follow_never_spins() {
        let plain = parse_args(&vec_args(&["events"])).unwrap();
        assert_eq!(plain.params, json!({ "wait": 30000 }));
        let instant = parse_args(&vec_args(&["events", "--wait", "0"])).unwrap();
        assert_eq!(instant.params["wait"], 0);
        let follow = parse_args(&vec_args(&["events", "--follow", "--wait", "0"])).unwrap();
        assert_eq!(follow.params["wait"], 1000);
    }

    #[test]
    fn bad_events_arguments_are_refused() {
        for args in [
            &["events", "--wait", "61"][..],
            &["events", "--wait", "soon"],
            &["events", "--since"],
            &["events", "--limit", "0"],
            &["events", "--type", "keystroke"],
            &["events", "--type", ""],
            &["events", "extra"],
        ] {
            assert!(parse_args(&vec_args(args)).is_err(), "{args:?} should be refused");
        }
    }

    #[test]
    fn a_waiting_request_gets_a_socket_timeout_that_covers_the_wait() {
        assert_eq!(request_timeout("status", &json!({})), IO_TIMEOUT);
        assert_eq!(request_timeout("events", &json!({ "wait": 0 })), IO_TIMEOUT);
        assert_eq!(request_timeout("events", &json!({ "wait": 60000 })), IO_TIMEOUT + Duration::from_secs(60));
    }

    #[test]
    fn events_print_one_line_each() {
        let selection = json!({ "seq": 3, "type": "selection", "where": "p. 4", "path": "/a.pdf", "text": "two\n  lines" });
        assert_eq!(event_line(&selection), "3 selection p. 4 two lines");
        let page = json!({ "seq": 4, "type": "page", "path": "/a.pdf", "position": "p. 5" });
        assert_eq!(event_line(&page), "4 page p. 5");
        let tab = json!({ "seq": 5, "type": "tab", "action": "closed", "title": "Plan", "path": "hold-my-brief:brief/plan" });
        assert_eq!(event_line(&tab), "5 tab Plan closed");
        let mut out = Vec::new();
        write_events_human(&mut out, &json!({ "events": [selection], "next": 3, "dropped": true })).unwrap();
        assert_eq!(String::from_utf8(out).unwrap(), "(older events were dropped)\n3 selection p. 4 two lines\n");
    }

    #[test]
    fn follow_passes_each_next_as_since_and_prints_ndjson_until_the_app_stops() {
        let mut calls = Vec::new();
        let mut replies = vec![
            Ok(json!({ "events": [{ "seq": 1, "type": "send" }, { "seq": 2, "type": "page" }], "next": 2 })),
            Ok(json!({ "events": [], "next": 2 })),
            Ok(json!({ "events": [{ "seq": 3, "type": "tab" }], "next": 3 })),
            Err("gone".to_string()),
        ]
        .into_iter();
        let mut out = Vec::new();
        let result = follow_events(
            |params| {
                calls.push(params["since"].clone());
                replies.next().unwrap()
            },
            &mut out,
            Map::new(),
        );
        assert_eq!(result.unwrap_err(), "gone");
        assert_eq!(calls, [Value::Null, json!(2), json!(2), json!(3)]);
        let lines: Vec<Value> = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines.iter().map(|e| e["seq"].as_u64().unwrap()).collect::<Vec<_>>(), [1, 2, 3]);
    }

    #[test]
    fn follow_launches_the_app_for_the_first_round_only() {
        let (info, seen) = stub_app(|_| json!({ "id": "1", "ok": true, "result": { "events": [{ "seq": 1, "type": "send" }], "next": 1 } }));
        let loads = std::cell::Cell::new(0);
        let launches = std::cell::Cell::new(0);
        let mut out = Vec::new();
        // The app answers the first round, then is gone (the user quit it).
        let result = follow_events(
            follow_sender(
                || {
                    loads.set(loads.get() + 1);
                    if loads.get() == 1 { Ok(info.clone()) } else { Err("Hold My Brief is not running.".into()) }
                },
                || { launches.set(launches.get() + 1); true },
                true,
            ),
            &mut out,
            Map::new(),
        );
        assert_eq!(result.unwrap_err(), "Hold My Brief is not running.");
        assert_eq!(launches.get(), 0);
        assert_eq!(*seen.lock().unwrap(), ["events"]);

        // With the app down from the start, the first round does launch (once).
        let launches = std::cell::Cell::new(0);
        let result = follow_events(
            follow_sender(|| Err("Hold My Brief is not running.".into()), || { launches.set(launches.get() + 1); false }, true),
            &mut Vec::new(),
            Map::new(),
        );
        assert!(result.is_err());
        assert_eq!(launches.get(), 1);
    }

    #[test]
    fn mcp_events_converts_seconds_and_caps_the_wait() {
        assert_eq!(
            mcp_events_params(&json!({ "since": 4, "wait": 12, "types": ["send"], "junk": 1 })),
            json!({ "since": 4, "wait": 12000, "types": ["send"] })
        );
        assert_eq!(mcp_events_params(&json!({ "wait": 500 }))["wait"], 30000);
        assert_eq!(mcp_events_params(&json!({})), json!({}));
    }
}
