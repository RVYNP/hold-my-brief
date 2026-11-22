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

fn send_once(info: &DiscoveryInfo, method: &str, params: Value) -> Result<Value, String> {
    let req = ControlRequest {
        id: "1",
        token: info.token.as_deref(),
        method,
        params,
    };
    let mut payload = serde_json::to_vec(&req).map_err(|e| e.to_string())?;
    payload.push(b'\n');

    let raw_line = match info.transport.as_str() {
        #[cfg(unix)]
        "unix" => {
            use std::os::unix::net::UnixStream;
            let sock = info.socket.as_deref().ok_or("Missing unix socket path in control.json")?;
            let mut stream = UnixStream::connect(sock)
                .map_err(|e| format!("Could not connect to Hold My Brief ({sock}): {e}"))?;
            let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
            let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
            stream.write_all(&payload).map_err(|e| e.to_string())?;
            stream.flush().map_err(|e| e.to_string())?;
            let mut line = String::new();
            BufReader::new(stream).read_line(&mut line).map_err(|e| e.to_string())?;
            line
        }
        "tcp" => {
            use std::net::TcpStream;
            let addr = info.addr.as_deref().ok_or("Missing addr in control.json")?;
            let mut stream = TcpStream::connect(addr)
                .map_err(|e| format!("Could not connect to Hold My Brief ({addr}): {e}"))?;
            let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
            let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
            stream.write_all(&payload).map_err(|e| e.to_string())?;
            stream.flush().map_err(|e| e.to_string())?;
            let mut line = String::new();
            BufReader::new(stream).read_line(&mut line).map_err(|e| e.to_string())?;
            line
        }
        other => return Err(format!("Unsupported control transport: {other}")),
    };

    if raw_line.trim().is_empty() {
        return Err("Hold My Brief closed the connection without replying.".into());
    }
    let resp: ControlResponse = serde_json::from_str(&raw_line)
        .map_err(|e| format!("Invalid response from Hold My Brief: {e}"))?;
    if resp.ok {
        Ok(resp.result.unwrap_or(Value::Null))
    } else {
        Err(resp.error.unwrap_or_else(|| "Request failed.".into()))
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
    if let Ok(info) = load_discovery() {
        if let Ok(val) = send_once(&info, method, params.clone()) {
            return Ok(val);
        }
    }
    if !auto_launch {
        let info = load_discovery()?;
        return send_once(&info, method, params);
    }
    if !try_launch_app() {
        let info = load_discovery()?;
        return send_once(&info, method, params);
    }
    let deadline = Instant::now() + LAUNCH_WAIT;
    while Instant::now() < deadline {
        if let Ok(info) = load_discovery() {
            if send_once(&info, "ping", json!({})).is_ok() {
                return send_once(&info, method, params);
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
  hmb mcp                           Run compact stdio MCP server (4 tools)
  hmb ping                          Check connection

GLOBAL FLAGS:
  --json         Print compact JSON output
  --no-launch    Do not auto-launch Hold My Brief if it is not running

Visual blocks supported inside Markdown briefs: ```chart (bar|hbar|line|metrics JSON),
```flow (A[Label] -> B[Label]), ```svg (sanitized theme-aware SVG), and > [!NOTE|TIP|WARNING]."
}

#[derive(Debug, PartialEq)]
struct ParsedCall {
    method: String,
    params: Value,
    json_out: bool,
    auto_launch: bool,
    mcp_mode: bool,
    show_help: bool,
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
            });
        }
        "goto" => {
            let target = tail.first().ok_or("goto requires a target (page, line, percent, or heading).")?;
            params.insert("target".into(), Value::String(target.clone()));
            return Ok(ParsedCall { method: "goto".into(), params: Value::Object(params), json_out, auto_launch, mcp_mode: false, show_help: false });
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
            return Ok(ParsedCall { method: "show".into(), params: Value::Object(params), json_out, auto_launch, mcp_mode: false, show_help: false });
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
            return Ok(ParsedCall { method: "brief".into(), params: Value::Object(params), json_out, auto_launch, mcp_mode: false, show_help: false });
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
            return Ok(ParsedCall { method: "read".into(), params: Value::Object(params), json_out, auto_launch, mcp_mode: false, show_help: false });
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
            return Ok(ParsedCall { method: "find".into(), params: Value::Object(params), json_out, auto_launch, mcp_mode: false, show_help: false });
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
            return Ok(ParsedCall { method: "close".into(), params: Value::Object(params), json_out, auto_launch, mcp_mode: false, show_help: false });
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
            return Ok(ParsedCall { method: "cmd".into(), params: Value::Object(params), json_out, auto_launch, mcp_mode: false, show_help: false });
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
        _ => println!("{}", serde_json::to_string(value).unwrap_or_default()),
    }
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
            let args = params.and_then(|p| p.get("arguments")).cloned().unwrap_or_else(|| json!({}));
            let rpc_method = match tool_name {
                "hmb_brief" => Some("brief"),
                "hmb_show" => Some("show"),
                "hmb_status" => Some("status"),
                "hmb_read" => Some("read"),
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

    #[test]
    fn parses_compound_show_command() {
        let parsed = parse_args(&vec_args(&[
            "show", "/tmp/spec.pdf", "--page", "14", "--find", "refresh", "--watch", "--pin", "--json",
        ]))
        .unwrap();
        assert_eq!(parsed.method, "show");
        assert!(parsed.json_out);
        assert_eq!(parsed.params["path"], "/tmp/spec.pdf");
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
        assert_eq!(list["result"]["tools"].as_array().unwrap().len(), 4);
    }
}
