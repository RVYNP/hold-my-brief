//! Read-ahead: reads documents the reader is likely to open next, to the end, and drops the bytes.
//! The only effect is a warm OS file cache, so the first open of a document on a slow share is as quick as the second.
//! Nothing is copied, kept or sent anywhere, and a path is only read when `read_document_bytes` would serve it.

use std::{
    collections::{HashSet, VecDeque},
    fs,
    io::Read,
    path::PathBuf,
    sync::{Arc, Mutex},
};

/// One read call; the bytes are dropped by the next call overwriting them.
const CHUNK: usize = 1024 * 1024;
/// Everything one session may read ahead, however many calls ask.
pub const SESSION_BUDGET: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Default)]
struct State {
    queue: VecDeque<String>,
    /// Resolved files already started this session (read, skipped as too large, or unreadable): never asked for again.
    started: HashSet<PathBuf>,
    read: u64,
    running: bool,
}

pub struct Prefetch {
    state: Mutex<State>,
    budget: u64,
    chunk: usize,
}

impl Default for Prefetch {
    fn default() -> Self {
        Self::new(SESSION_BUDGET, CHUNK)
    }
}

impl Prefetch {
    pub fn new(budget: u64, chunk: usize) -> Self {
        Self { state: Mutex::new(State::default()), budget, chunk: chunk.max(1) }
    }

    /// Replaces the pending queue: the newest intent wins. The file being read is not part of the queue and finishes.
    /// True when the caller must start a worker (none is running and there is something to read).
    pub fn enqueue(&self, paths: Vec<String>) -> bool {
        let Ok(mut state) = self.state.lock() else { return false };
        state.queue = paths.into();
        if state.running || state.queue.is_empty() || state.read >= self.budget {
            return false;
        }
        state.running = true;
        true
    }

    #[cfg(test)]
    pub fn bytes_read(&self) -> u64 {
        self.state.lock().map(|state| state.read).unwrap_or(0)
    }

    /// Reads the queue empty, one file at a time. `resolve` is asked just before each file, so a document the reader
    /// has lost access to since the call is skipped. A path that does not resolve, is not a file or is larger than
    /// `limit` is skipped silently.
    pub fn drain(&self, resolve: impl Fn(&str) -> Result<PathBuf, String>, limit: u64) {
        let mut buffer = vec![0u8; self.chunk];
        loop {
            let next = {
                let Ok(mut state) = self.state.lock() else { return };
                if state.read >= self.budget {
                    state.queue.clear();
                }
                let next = state.queue.pop_front();
                if next.is_none() {
                    state.running = false;
                }
                next
            };
            let Some(path) = next else { return };
            let Ok(resolved) = resolve(&path) else { continue };
            let remaining = {
                let Ok(mut state) = self.state.lock() else { return };
                if !state.started.insert(resolved.clone()) {
                    continue;
                }
                self.budget.saturating_sub(state.read)
            };
            let read = read_to_end(&resolved, limit, remaining, &mut buffer);
            if let Ok(mut state) = self.state.lock() {
                state.read += read;
            }
        }
    }

    /// Starts the background worker. Returns at once; the thread exits when the queue is empty.
    pub fn submit(
        self: &Arc<Self>,
        paths: Vec<String>,
        resolve: impl Fn(&str) -> Result<PathBuf, String> + Send + 'static,
        limit: u64,
    ) {
        if !self.enqueue(paths) {
            return;
        }
        let prefetch = self.clone();
        let spawned = std::thread::Builder::new().name("read-ahead".into()).spawn(move || {
            lower_priority();
            prefetch.drain(resolve, limit);
        });
        if spawned.is_err() {
            if let Ok(mut state) = self.state.lock() {
                state.queue.clear();
                state.running = false;
            }
        }
    }
}

/// Reads a regular file of at most `limit` bytes to its end, at most `remaining` bytes, and drops what it read.
/// Returns the bytes read.
fn read_to_end(path: &std::path::Path, limit: u64, remaining: u64, buffer: &mut [u8]) -> u64 {
    let Ok(mut file) = fs::File::open(path) else { return 0 };
    match file.metadata() {
        Ok(metadata) if metadata.is_file() && metadata.len() <= limit => {}
        _ => return 0,
    }
    let mut total = 0u64;
    while total < remaining && total <= limit {
        let want = buffer.len().min((remaining - total) as usize);
        match file.read(&mut buffer[..want]) {
            Ok(0) | Err(_) => break,
            Ok(count) => total += count as u64,
        }
    }
    total
}

#[cfg(target_os = "macos")]
fn lower_priority() {
    extern "C" {
        fn pthread_set_qos_class_self_np(qos_class: u32, relative_priority: i32) -> i32;
    }
    const QOS_CLASS_BACKGROUND: u32 = 0x09;
    // Best effort: a failure leaves the thread at its default priority.
    unsafe {
        pthread_set_qos_class_self_np(QOS_CLASS_BACKGROUND, 0);
    }
}

#[cfg(not(target_os = "macos"))]
fn lower_priority() {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn file(dir: &Path, name: &str, size: usize) -> String {
        let path = dir.join(name);
        fs::write(&path, vec![7u8; size]).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn found(path: &str) -> Result<PathBuf, String> {
        Ok(PathBuf::from(path))
    }

    #[test]
    fn a_file_is_read_to_its_end_in_fixed_chunks() {
        let dir = tempfile::tempdir().unwrap();
        let a = file(dir.path(), "a.pdf", 1000);
        let prefetch = Prefetch::new(SESSION_BUDGET, 64);
        assert!(prefetch.enqueue(vec![a]));
        prefetch.drain(found, 5000);
        assert_eq!(prefetch.bytes_read(), 1000);
    }

    #[test]
    fn missing_unresolved_oversized_and_non_file_paths_are_skipped_without_error() {
        let dir = tempfile::tempdir().unwrap();
        let big = file(dir.path(), "big.pdf", 1000);
        let ok = file(dir.path(), "ok.pdf", 100);
        let folder = dir.path().join("folder.pdf");
        fs::create_dir(&folder).unwrap();
        let missing = dir.path().join("missing.pdf").to_string_lossy().into_owned();
        let refused = file(dir.path(), "refused.pdf", 100);
        let prefetch = Prefetch::new(SESSION_BUDGET, 64);
        assert!(prefetch.enqueue(vec![missing, folder.to_string_lossy().into_owned(), big, refused.clone(), ok]));
        prefetch.drain(|path| if path == refused { Err("not authorized".into()) } else { found(path) }, 500);
        assert_eq!(prefetch.bytes_read(), 100, "only the small, resolvable file was read");
    }

    #[test]
    fn the_session_budget_stops_the_batch_exactly_and_later_calls() {
        let dir = tempfile::tempdir().unwrap();
        let paths: Vec<String> = ["a", "b", "c"].iter().map(|name| file(dir.path(), name, 1000)).collect();
        let prefetch = Prefetch::new(2500, 300);
        assert!(prefetch.enqueue(paths.clone()));
        prefetch.drain(found, 5000);
        assert_eq!(prefetch.bytes_read(), 2500);
        let later = file(dir.path(), "later", 10);
        assert!(!prefetch.enqueue(vec![later]), "no worker is started once the budget is spent");
        assert_eq!(prefetch.bytes_read(), 2500);
    }

    #[test]
    fn a_path_is_read_once_per_session_however_it_is_asked_for() {
        let dir = tempfile::tempdir().unwrap();
        let a = file(dir.path(), "a.pdf", 300);
        let b = file(dir.path(), "b.pdf", 200);
        let prefetch = Prefetch::new(SESSION_BUDGET, 64);
        assert!(prefetch.enqueue(vec![a.clone(), b.clone(), a.clone()]));
        prefetch.drain(found, 5000);
        assert_eq!(prefetch.bytes_read(), 500);
        assert!(prefetch.enqueue(vec![b, a]), "a worker may start again once the first has finished");
        prefetch.drain(found, 5000);
        assert_eq!(prefetch.bytes_read(), 500, "neither file was read a second time");
    }

    #[test]
    fn a_new_call_replaces_the_pending_queue_and_the_file_being_read_finishes() {
        let dir = tempfile::tempdir().unwrap();
        let a = file(dir.path(), "a.pdf", 100);
        let b = file(dir.path(), "b.pdf", 200);
        let c = file(dir.path(), "c.pdf", 400);
        let prefetch = Arc::new(Prefetch::new(SESSION_BUDGET, 64));
        assert!(prefetch.enqueue(vec![a.clone(), b.clone()]));
        // The second call arrives while `a` is the file in hand: it starts no second worker, and `b` is dropped.
        let during = prefetch.clone();
        let replacement = vec![c.clone()];
        prefetch.drain(
            |path| {
                if path == a {
                    assert!(!during.enqueue(replacement.clone()));
                }
                found(path)
            },
            5000,
        );
        assert_eq!(prefetch.bytes_read(), 100 + 400, "a finished, c replaced b");
        // b was never started, so it can still be asked for.
        assert!(prefetch.enqueue(vec![b]));
        prefetch.drain(found, 5000);
        assert_eq!(prefetch.bytes_read(), 700);
    }

    #[test]
    fn an_empty_call_clears_the_queue_without_starting_a_worker() {
        let dir = tempfile::tempdir().unwrap();
        let a = file(dir.path(), "a.pdf", 100);
        let prefetch = Prefetch::new(SESSION_BUDGET, 64);
        assert!(prefetch.enqueue(vec![a]));
        assert!(!prefetch.enqueue(Vec::new()));
        prefetch.drain(found, 5000);
        assert_eq!(prefetch.bytes_read(), 0);
    }
}
