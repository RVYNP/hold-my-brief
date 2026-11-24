//! Who is asking: `hmb` works out which agent it runs under by walking its own parent processes.
//!
//! The walk itself (`detect`) is platform-neutral and reads a process table through a lookup function; the lookup is
//! `/proc` on Linux, `libproc` + `sysctl` on macOS and a Toolhelp snapshot on Windows. The result is cosmetic: the
//! control socket is owner-only, so the app trusts what it is told.

use serde_json::{json, Map, Value};
use std::{collections::HashSet, env, sync::LazyLock};

/// What the walk needs to know about one process.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Proc {
    pub pid: u32,
    pub ppid: u32,
    /// Executable path, or just its name where the platform gives no path.
    pub exe: String,
    /// First argument after the program, when the program is a script runtime (`node`, `bun`, …): names what it runs.
    pub script: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Known {
    Omp,
    Claude,
    Codex,
    Cursor,
}

impl Known {
    fn kind(self) -> &'static str {
        match self {
            Known::Omp => "omp",
            Known::Claude => "claude",
            Known::Codex => "codex",
            Known::Cursor => "cursor",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Known::Omp => "omp",
            Known::Claude => "Claude Code",
            Known::Codex => "Codex",
            Known::Cursor => "Cursor",
        }
    }

    /// An agent named by hand (`HMB_AGENT`).
    fn parse(name: &str) -> Option<Known> {
        match name.trim().to_lowercase().as_str() {
            "omp" => Some(Known::Omp),
            "claude" | "claude-code" | "claude code" => Some(Known::Claude),
            "codex" => Some(Known::Codex),
            "cursor" => Some(Known::Cursor),
            _ => None,
        }
    }
}

const NAME_LIMIT: usize = 64;
const MAX_DEPTH: usize = 32;
const SHELLS: [&str; 17] = [
    "sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "nu", "nushell", "pwsh", "powershell", "cmd", "conhost", "login", "env", "sudo",
];
/// Programs that run a script; `Proc::script` is read for these only.
pub const RUNTIMES: [&str; 6] = ["node", "bun", "deno", "python", "python3", "tsx"];

fn components(path: &str) -> Vec<String> {
    path.split(['/', '\\']).filter(|c| !c.is_empty()).map(str::to_lowercase).collect()
}

/// Lower-case file name of `path` without `.exe` and a login shell's leading `-`.
fn stem(path: &str) -> String {
    let name = components(path).pop().unwrap_or_default();
    let name = name.strip_suffix(".exe").unwrap_or(&name);
    name.trim_start_matches('-').to_string()
}

fn script_stem(path: &str) -> String {
    let name = stem(path);
    name.rsplit_once('.').map_or(name.clone(), |(base, _)| base.to_string())
}

fn classify_agent(p: &Proc) -> Option<Known> {
    match stem(&p.exe).as_str() {
        "omp" => return Some(Known::Omp),
        "claude" | "claude-code" => return Some(Known::Claude),
        "codex" => return Some(Known::Codex),
        // Not "Cursor Helper (…)": only the main process is the agent, so one Cursor is one entry.
        "cursor" | "cursor-agent" => return Some(Known::Cursor),
        _ => {}
    }
    // Self-updating builds live at `…/<agent>/versions/<version>`, so the file name is the version and the agent is the folder two up.
    let parts = components(&p.exe);
    if let Some(window) = parts.windows(2).rev().find(|w| w[1] == "versions") {
        match window[0].as_str() {
            "claude" => return Some(Known::Claude),
            "omp" => return Some(Known::Omp),
            "codex" => return Some(Known::Codex),
            _ => {}
        }
    }
    if RUNTIMES.contains(&stem(&p.exe).as_str()) {
        let script = p.script.as_deref()?;
        let parts = components(script);
        if parts.iter().any(|c| c == "claude-code") {
            return Some(Known::Claude);
        }
        return match script_stem(script).as_str() {
            "omp" => Some(Known::Omp),
            "claude" => Some(Known::Claude),
            "codex" => Some(Known::Codex),
            "cursor-agent" => Some(Known::Cursor),
            _ => None,
        };
    }
    None
}

fn classify_terminal(p: &Proc) -> Option<&'static str> {
    let name = match stem(&p.exe).as_str() {
        "terminal" => "Terminal",
        "iterm2" | "iterm" => "iTerm2",
        "ghostty" => "Ghostty",
        "tern" => "Tern",
        "wezterm" | "wezterm-gui" => "WezTerm",
        "windowsterminal" => "Windows Terminal",
        _ => return None,
    };
    Some(name)
}

fn is_shell(p: &Proc) -> bool {
    SHELLS.contains(&stem(&p.exe).as_str())
}

/// The processes above `start`, nearest first. Stops at the root, at a cycle and after `MAX_DEPTH`.
fn ancestry(start: u32, lookup: &impl Fn(u32) -> Option<Proc>) -> Vec<Proc> {
    let mut chain = Vec::new();
    let mut seen = HashSet::new();
    let mut pid = start;
    while pid > 0 && chain.len() < MAX_DEPTH && seen.insert(pid) {
        let Some(process) = lookup(pid) else { break };
        pid = process.ppid;
        chain.push(process);
    }
    chain
}

fn clip(name: &str) -> String {
    name.trim().chars().take(NAME_LIMIT).collect()
}

/// The `client` of a request: `{ kind, name, pid, terminal? }`. `parent` is the pid of the process that started `hmb`; `agent_name` is
/// `HMB_AGENT`. The first known agent above `hmb` wins; without one, the nearest ancestor that is not a shell is reported as `other`.
pub fn detect(parent: u32, lookup: &impl Fn(u32) -> Option<Proc>, agent_name: Option<&str>) -> Value {
    let chain = ancestry(parent, lookup);
    let found = chain.iter().find_map(|p| classify_agent(p).map(|known| (known, p.pid)));
    let nearest = chain.iter().find(|p| !is_shell(p));
    let named = agent_name.map(str::trim).filter(|n| !n.is_empty());
    let (kind, name, pid) = match (named, found) {
        (Some(name), found) => match Known::parse(name) {
            Some(known) => (known.kind(), known.label().to_string(), found.map_or_else(|| nearest.map_or(parent, |p| p.pid), |(_, pid)| pid)),
            None => ("other", clip(name), found.map_or_else(|| nearest.map_or(parent, |p| p.pid), |(_, pid)| pid)),
        },
        (None, Some((known, pid))) => (known.kind(), known.label().to_string(), pid),
        (None, None) => match nearest {
            Some(p) => ("other", clip(&stem(&p.exe)), p.pid),
            None => ("other", "other".to_string(), parent),
        },
    };
    let mut client = Map::new();
    client.insert("kind".into(), json!(kind));
    client.insert("name".into(), json!(name));
    client.insert("pid".into(), json!(pid));
    if let Some(terminal) = chain.iter().find_map(classify_terminal) {
        client.insert("terminal".into(), json!(terminal));
    }
    Value::Object(client)
}

/// This process's own `client`, worked out once.
static CLIENT: LazyLock<Value> = LazyLock::new(|| {
    let lookup = platform::lookup();
    let agent = env::var("HMB_AGENT").ok();
    detect(platform::parent_pid(&lookup), &lookup, agent.as_deref())
});

pub fn client() -> &'static Value {
    &CLIENT
}

#[cfg(all(unix, not(target_os = "macos")))]
mod platform {
    use super::{Proc, RUNTIMES};
    use std::fs;

    pub fn parent_pid(_lookup: &impl Fn(u32) -> Option<Proc>) -> u32 {
        std::os::unix::process::parent_id()
    }

    /// `/proc/<pid>/stat` for the parent, `/proc/<pid>/exe` and `cmdline` for the program.
    pub fn lookup() -> impl Fn(u32) -> Option<Proc> {
        |pid| {
            let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
            // `pid (comm) state ppid …`: comm may hold spaces and parentheses, so split after the last ')'.
            let (head, rest) = stat.rsplit_once(')')?;
            let ppid = rest.split_whitespace().nth(1)?.parse().ok()?;
            let comm = head.split_once('(').map_or(String::new(), |(_, comm)| comm.to_string());
            let exe = fs::read_link(format!("/proc/{pid}/exe")).map_or(comm, |p| p.to_string_lossy().into_owned());
            let script = if RUNTIMES.contains(&super::stem(&exe).as_str()) {
                fs::read(format!("/proc/{pid}/cmdline")).ok().and_then(|raw| {
                    raw.split(|b| *b == 0).skip(1).map(|a| String::from_utf8_lossy(a).into_owned()).find(|a| !a.is_empty() && !a.starts_with('-'))
                })
            } else {
                None
            };
            Some(Proc { pid, ppid, exe, script })
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{Proc, RUNTIMES};
    use std::ffi::c_void;

    extern "C" {
        fn proc_pidinfo(pid: i32, flavor: i32, arg: u64, buffer: *mut c_void, size: i32) -> i32;
        fn proc_pidpath(pid: i32, buffer: *mut c_void, size: u32) -> i32;
        fn sysctl(name: *mut i32, namelen: u32, oldp: *mut c_void, oldlenp: *mut usize, newp: *mut c_void, newlen: usize) -> i32;
    }

    const PROC_PIDTBSDINFO: i32 = 3;
    /// `sizeof(struct proc_bsdinfo)`: 34 words; `pbi_ppid` is word 4 and `pbi_comm` (16 bytes) starts at byte 48.
    const BSDINFO_WORDS: usize = 34;
    const PATH_MAX_SIZE: usize = 4096;
    const CTL_KERN: i32 = 1;
    const KERN_PROCARGS2: i32 = 49;

    pub fn parent_pid(_lookup: &impl Fn(u32) -> Option<Proc>) -> u32 {
        std::os::unix::process::parent_id()
    }

    fn bsd_info(pid: u32) -> Option<[u32; BSDINFO_WORDS]> {
        let mut info = [0u32; BSDINFO_WORDS];
        let size = std::mem::size_of_val(&info) as i32;
        // SAFETY: `info` is a writable buffer of `size` bytes, the layout `PROC_PIDTBSDINFO` fills.
        let got = unsafe { proc_pidinfo(pid as i32, PROC_PIDTBSDINFO, 0, info.as_mut_ptr().cast(), size) };
        (got == size).then_some(info)
    }

    fn exe_path(pid: u32) -> Option<String> {
        let mut buf = vec![0u8; PATH_MAX_SIZE];
        // SAFETY: `buf` is writable for `PATH_MAX_SIZE` bytes.
        let len = unsafe { proc_pidpath(pid as i32, buf.as_mut_ptr().cast(), PATH_MAX_SIZE as u32) };
        (len > 0).then(|| String::from_utf8_lossy(&buf[..len as usize]).into_owned())
    }

    /// `KERN_PROCARGS2`: `argc` (i32), the executable path, NUL padding, then `argc` NUL-terminated arguments.
    fn script_arg(pid: u32) -> Option<String> {
        let mut mib = [CTL_KERN, KERN_PROCARGS2, pid as i32];
        let mut len = 0usize;
        // SAFETY: a null `oldp` only asks for the size.
        if unsafe { sysctl(mib.as_mut_ptr(), 3, std::ptr::null_mut(), &mut len, std::ptr::null_mut(), 0) } != 0 || len < 8 {
            return None;
        }
        let mut buf = vec![0u8; len];
        // SAFETY: `buf` is writable for `len` bytes.
        if unsafe { sysctl(mib.as_mut_ptr(), 3, buf.as_mut_ptr().cast(), &mut len, std::ptr::null_mut(), 0) } != 0 {
            return None;
        }
        buf.truncate(len);
        let argc = i32::from_ne_bytes(buf[..4].try_into().ok()?);
        let mut parts = buf[4..].split(|b| *b == 0);
        parts.next()?; // the executable path
        // Padding NULs show up as empty parts between the path and argv[0].
        let mut args = parts.skip_while(|p| p.is_empty()).take(argc.max(0) as usize);
        args.next()?; // argv[0]
        args.map(|a| String::from_utf8_lossy(a).into_owned()).find(|a| !a.is_empty() && !a.starts_with('-'))
    }

    pub fn lookup() -> impl Fn(u32) -> Option<Proc> {
        |pid| {
            let info = bsd_info(pid)?;
            let ppid = info[4];
            let comm_bytes: Vec<u8> = info[12..16].iter().flat_map(|w| w.to_ne_bytes()).take_while(|b| *b != 0).collect();
            let exe = exe_path(pid).unwrap_or_else(|| String::from_utf8_lossy(&comm_bytes).into_owned());
            let script = if RUNTIMES.contains(&super::stem(&exe).as_str()) { script_arg(pid) } else { None };
            Some(Proc { pid, ppid, exe, script })
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::Proc;
    use std::{collections::HashMap, ffi::c_void};

    #[repr(C)]
    struct ProcessEntry32W {
        size: u32,
        usage: u32,
        process_id: u32,
        default_heap_id: usize,
        module_id: u32,
        threads: u32,
        parent_process_id: u32,
        pri_class_base: i32,
        flags: u32,
        exe_file: [u16; 260],
    }

    extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> isize;
        fn Process32FirstW(snapshot: isize, entry: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(snapshot: isize, entry: *mut ProcessEntry32W) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    const TH32CS_SNAPPROCESS: u32 = 0x2;
    const INVALID_HANDLE_VALUE: isize = -1;

    /// One Toolhelp snapshot of every process. It names programs (`claude.exe`) but not their arguments, so a script run by `node.exe` stays `node`.
    fn snapshot() -> HashMap<u32, Proc> {
        let mut table = HashMap::new();
        // SAFETY: plain Win32 calls; `entry` is a correctly sized, writable PROCESSENTRY32W and the snapshot handle is closed below.
        unsafe {
            let handle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if handle == INVALID_HANDLE_VALUE {
                return table;
            }
            let mut entry: ProcessEntry32W = std::mem::zeroed();
            entry.size = std::mem::size_of::<ProcessEntry32W>() as u32;
            let mut more = Process32FirstW(handle, &mut entry);
            while more != 0 {
                let len = entry.exe_file.iter().position(|c| *c == 0).unwrap_or(entry.exe_file.len());
                let exe = String::from_utf16_lossy(&entry.exe_file[..len]);
                table.insert(entry.process_id, Proc { pid: entry.process_id, ppid: entry.parent_process_id, exe, script: None });
                more = Process32NextW(handle, &mut entry);
            }
            CloseHandle(handle as *mut c_void);
        }
        table
    }

    pub fn lookup() -> impl Fn(u32) -> Option<Proc> {
        let table = snapshot();
        move |pid| table.get(&pid).cloned()
    }

    pub fn parent_pid(lookup: &impl Fn(u32) -> Option<Proc>) -> u32 {
        lookup(std::process::id()).map_or(0, |p| p.ppid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn table(rows: &[(u32, u32, &str)]) -> HashMap<u32, Proc> {
        rows.iter().map(|&(pid, ppid, exe)| (pid, Proc { pid, ppid, exe: exe.into(), script: None })).collect()
    }

    fn run(table: &HashMap<u32, Proc>, parent: u32, name: Option<&str>) -> Value {
        detect(parent, &|pid| table.get(&pid).cloned(), name)
    }

    #[test]
    fn nearest_known_agent_wins() {
        // hmb ← zsh ← claude ← zsh ← omp ← zsh ← Ghostty ← launchd
        let t = table(&[
            (500, 400, "/bin/zsh"),
            (400, 300, "/usr/local/bin/claude"),
            (300, 200, "/bin/zsh"),
            (200, 100, "/Users/x/.bun/bin/omp"),
            (100, 90, "/bin/zsh"),
            (90, 1, "/Applications/Ghostty.app/Contents/MacOS/ghostty"),
            (1, 0, "/sbin/launchd"),
        ]);
        let client = run(&t, 500, None);
        assert_eq!(client["kind"], "claude");
        assert_eq!(client["name"], "Claude Code");
        assert_eq!(client["pid"], 400);
        assert_eq!(client["terminal"], "Ghostty");
    }

    #[test]
    fn recognises_each_agent_and_terminal() {
        for (exe, kind, name) in [
            ("/opt/omp", "omp", "omp"),
            ("C:\\Users\\x\\bin\\Codex.exe", "codex", "Codex"),
            ("/Applications/Cursor.app/Contents/MacOS/Cursor", "cursor", "Cursor"),
            ("/home/x/.local/share/claude/versions/2.1.5", "claude", "Claude Code"),
            ("/Users/x/Library/Application Support/Tern/omp/versions/19.0.1", "omp", "omp"),
        ] {
            let t = table(&[(20, 10, "/bin/bash"), (10, 1, exe)]);
            let client = run(&t, 20, None);
            assert_eq!((client["kind"].as_str(), client["name"].as_str(), client["pid"].as_u64()), (Some(kind), Some(name), Some(10)), "{exe}");
        }
        for (exe, name) in [
            ("/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal", "Terminal"),
            ("/Applications/iTerm.app/Contents/MacOS/iTerm2", "iTerm2"),
            ("/Applications/Tern.app/Contents/MacOS/Tern", "Tern"),
            ("/usr/bin/wezterm-gui", "WezTerm"),
            ("C:\\Program Files\\WindowsApps\\WindowsTerminal.exe", "Windows Terminal"),
        ] {
            let t = table(&[(20, 10, "/bin/bash"), (10, 1, exe)]);
            assert_eq!(run(&t, 20, None)["terminal"], name, "{exe}");
        }
    }

    #[test]
    fn cursor_helpers_are_not_the_agent() {
        let t = table(&[
            (30, 20, "/bin/zsh"),
            (20, 10, "/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Plugin).app/Contents/MacOS/Cursor Helper (Plugin)"),
            (10, 1, "/Applications/Cursor.app/Contents/MacOS/Cursor"),
        ]);
        let client = run(&t, 30, None);
        assert_eq!((client["kind"].as_str(), client["pid"].as_u64()), (Some("cursor"), Some(10)));
    }

    #[test]
    fn runtime_scripts_are_read_from_their_argument() {
        let mut t = table(&[(20, 10, "/bin/zsh"), (10, 1, "/usr/local/bin/node")]);
        t.get_mut(&10).unwrap().script = Some("/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js".into());
        assert_eq!(run(&t, 20, None)["kind"], "claude");
        t.get_mut(&10).unwrap().script = Some("/usr/lib/node_modules/@openai/codex/bin/codex.js".into());
        assert_eq!(run(&t, 20, None)["kind"], "codex");
        t.get_mut(&10).unwrap().script = Some("server.js".into());
        let client = run(&t, 20, None);
        assert_eq!((client["kind"].as_str(), client["name"].as_str()), (Some("other"), Some("node")));
    }

    #[test]
    fn hmb_agent_overrides_the_name_but_not_the_pid() {
        let t = table(&[(20, 10, "/bin/zsh"), (10, 1, "/usr/local/bin/codex")]);
        let client = run(&t, 20, Some("nightly-job"));
        assert_eq!((client["kind"].as_str(), client["name"].as_str(), client["pid"].as_u64()), (Some("other"), Some("nightly-job"), Some(10)));
        let client = run(&t, 20, Some("Claude"));
        assert_eq!((client["kind"].as_str(), client["name"].as_str()), (Some("claude"), Some("Claude Code")));
        let client = run(&t, 20, Some("  "));
        assert_eq!(client["kind"], "codex", "a blank override is ignored");
    }

    #[test]
    fn hmb_agent_without_an_agent_above_uses_the_nearest_program() {
        let t = table(&[(20, 10, "/bin/zsh"), (10, 1, "/usr/bin/python3")]);
        let client = run(&t, 20, Some("ci"));
        assert_eq!((client["kind"].as_str(), client["pid"].as_u64()), (Some("other"), Some(10)));
        let client = run(&HashMap::new(), 77, Some("ci"));
        assert_eq!(client["pid"], 77);
    }

    #[test]
    fn unknown_falls_back_to_the_nearest_non_shell() {
        let t = table(&[(30, 20, "-zsh"), (20, 10, "/usr/bin/tmux"), (10, 1, "/sbin/launchd")]);
        let client = run(&t, 30, None);
        assert_eq!((client["kind"].as_str(), client["name"].as_str(), client["pid"].as_u64()), (Some("other"), Some("tmux"), Some(20)));
        assert!(client.get("terminal").is_none());
    }

    #[test]
    fn only_shells_above_falls_back_to_the_parent() {
        let t = table(&[(20, 1, "/bin/bash")]);
        let client = run(&t, 20, None);
        assert_eq!((client["kind"].as_str(), client["name"].as_str(), client["pid"].as_u64()), (Some("other"), Some("other"), Some(20)));
    }

    #[test]
    fn a_parent_cycle_ends_the_walk() {
        let t = table(&[(2, 3, "/bin/sh"), (3, 2, "/bin/sh")]);
        assert_eq!(run(&t, 2, None)["kind"], "other");
    }

    #[test]
    fn the_real_process_table_answers() {
        let lookup = platform::lookup();
        let own = lookup(std::process::id()).expect("this process is in the table");
        assert!(!own.exe.is_empty());
        assert!(ancestry(platform::parent_pid(&lookup), &lookup).len() <= MAX_DEPTH);
    }
}
