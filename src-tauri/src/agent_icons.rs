//! The Lottie icons the user assigned to agent kinds (Settings › Agent control › Icons). A file is checked, then copied into
//! `agent-icons/` beside the state file under a name this module picks; `state.json` maps each kind to that name. The page never
//! names a file: it sends the text of a file it was handed and asks for the assignments back by kind.

use crate::state::{now, Store};
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashMap, fs, io::Write, path::PathBuf, sync::{Arc, Mutex}};
use tauri::{AppHandle, Manager, State};

/// The most an icon file may weigh. src/agent-appearance.ts (`ICON_MAX_BYTES`) says the same to the user.
pub const MAX_ICON_BYTES: u64 = 512 * 1024;
const STATES: [&str; 4] = ["idle", "listening", "acting", "arriving"];
const KIND_LIMIT: usize = 64;

fn finite(value: Option<&Value>) -> bool {
    value.and_then(Value::as_f64).is_some_and(f64::is_finite)
}

fn too_big(bytes: u64) -> String {
    format!("The file is {} KB; an icon may be at most {} KB.", bytes.div_ceil(1024), MAX_ICON_BYTES / 1024)
}

/// Why `text` cannot be an agent icon, or `Ok`: at most 512 KB, a Lottie animation, images only as embedded PNG or WebP data
/// (nothing external), and all four state markers. The page checks the same before it asks; this is the gate in front of the disk.
pub fn check_icon(text: &str) -> Result<(), String> {
    if text.len() as u64 > MAX_ICON_BYTES {
        return Err(too_big(text.len() as u64));
    }
    let data: Value = serde_json::from_str(text).map_err(|_| "The file is not valid JSON.".to_string())?;
    if !data.get("layers").is_some_and(Value::is_array) || !["w", "h", "fr", "op"].iter().all(|key| finite(data.get(key))) {
        return Err("The file is not a Lottie animation (it needs layers, a size and a frame rate).".into());
    }
    let mut reasons: Vec<String> = Vec::new();
    for asset in data.get("assets").and_then(Value::as_array).into_iter().flatten() {
        if asset.get("p").is_none() && asset.get("u").is_none() {
            continue;
        }
        let uri = asset.get("p").and_then(Value::as_str).and_then(|p| p.strip_prefix("data:")).and_then(|rest| rest.split_once(','));
        let embedded = asset.get("e").and_then(Value::as_i64) == Some(1);
        match uri {
            Some((head, _)) if embedded => {
                let mut parts = head.split(';');
                let kind = parts.next().unwrap_or("").to_ascii_lowercase();
                if !(kind == "image/png" || kind == "image/webp") || !parts.any(|part| part.eq_ignore_ascii_case("base64")) {
                    reasons.push("An asset is not a base64 PNG or WebP image.".into());
                }
            }
            _ => reasons.push("An asset refers to a file outside the animation. Images must be embedded as PNG or WebP data.".into()),
        }
    }
    let fonts = data.pointer("/fonts/list").and_then(Value::as_array);
    if fonts.into_iter().flatten().any(|font| font.get("fPath").and_then(Value::as_str).is_some_and(|path| !path.is_empty())) {
        reasons.push("A font loads from outside the animation.".into());
    }
    let markers: &[Value] = data.get("markers").and_then(Value::as_array).map_or(&[], Vec::as_slice);
    let named = |name: &str| -> Vec<&Value> { markers.iter().filter(|m| m.get("cm").and_then(Value::as_str).is_some_and(|cm| cm.trim() == name)).collect() };
    let missing: Vec<&str> = STATES.into_iter().filter(|name| named(name).is_empty()).collect();
    if !missing.is_empty() {
        reasons.push(format!("Missing marker(s): {}.", missing.join(", ")));
    }
    for name in STATES {
        let found = named(name);
        if found.len() > 1 {
            reasons.push(format!("Marker \"{name}\" appears more than once."));
        }
        if found.first().is_some_and(|m| !m.get("dr").and_then(Value::as_f64).is_some_and(|d| d > 0.0) || !finite(m.get("tm"))) {
            reasons.push(format!("Marker \"{name}\" has no length."));
        }
    }
    if reasons.is_empty() { Ok(()) } else { Err(reasons.join(" ")) }
}

fn clean_kind(kind: &str) -> Result<String, String> {
    let kind = kind.trim();
    if kind.is_empty() || kind.chars().count() > KIND_LIMIT || kind.chars().any(char::is_control) {
        return Err("That is not an agent kind.".into());
    }
    Ok(kind.to_string())
}

impl Store {
    fn agent_icon_dir(&self) -> Result<PathBuf, String> {
        Ok(self.file.parent().ok_or("Invalid application-data directory")?.join("agent-icons"))
    }

    /// Checks `text` and keeps it as the icon of `kind`, replacing the one it had.
    pub fn set_agent_icon(&mut self, kind: &str, text: &str) -> Result<(), String> {
        let kind = clean_kind(kind)?;
        check_icon(text)?;
        if !self.writable {
            return Err(self.warning.clone().unwrap_or_else(|| "The icon could not be saved.".into()));
        }
        let dir = self.agent_icon_dir()?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut stamp = now();
        let name = loop {
            let name = format!("icon-{stamp}.json");
            if !dir.join(&name).exists() {
                break name;
            }
            stamp += 1;
        };
        let mut temporary = tempfile::NamedTempFile::new_in(&dir).map_err(|e| e.to_string())?;
        temporary.write_all(text.as_bytes()).and_then(|()| temporary.as_file().sync_all()).map_err(|e| e.to_string())?;
        temporary.persist(dir.join(&name)).map_err(|e| e.error.to_string())?;
        let old = self.saved.agent_icons.insert(kind, name);
        self.persist()?;
        if let Some(old) = old {
            let _ = fs::remove_file(dir.join(old));
        }
        Ok(())
    }

    /// Forgets the icon of `kind` and deletes its file.
    pub fn reset_agent_icon(&mut self, kind: &str) -> Result<(), String> {
        let dir = self.agent_icon_dir()?;
        if let Some(old) = self.saved.agent_icons.remove(kind.trim()) {
            self.persist()?;
            let _ = fs::remove_file(dir.join(old));
        }
        Ok(())
    }

    /// The text of every assigned icon, by kind. A file that has gone missing, grown past the limit or is not text is left out.
    pub fn agent_icons(&self) -> HashMap<String, String> {
        let Ok(dir) = self.agent_icon_dir() else { return HashMap::new() };
        self.saved.agent_icons.iter().filter_map(|(kind, name)| {
            // The name is ours; a hand-edited state file must not point outside the folder.
            let name = std::path::Path::new(name).file_name().filter(|file| *file == std::ffi::OsStr::new(name))?;
            let path = dir.join(name);
            if fs::metadata(&path).ok()?.len() > MAX_ICON_BYTES {
                return None;
            }
            Some((kind.clone(), fs::read_to_string(path).ok()?))
        }).collect()
    }
}

#[derive(Serialize)]
pub struct ChosenIcon {
    pub name: String,
    pub text: String,
}

/// Asks for a Lottie file and reads it, refusing one over the limit before reading it. `None` when the dialog is cancelled.
#[tauri::command]
pub async fn choose_agent_icon(app: AppHandle) -> Result<Option<ChosenIcon>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new().set_title("Choose a Lottie icon").add_filter("Lottie animation (JSON)", &["json"]);
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let Some(chosen) = dialog.pick_file() else { return Ok(None) };
        let name = chosen.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let metadata = fs::metadata(&chosen).map_err(|e| format!("Could not open {name}: {e}"))?;
        if !metadata.is_file() {
            return Err("Choose a Lottie JSON file, not a folder.".into());
        }
        if metadata.len() > MAX_ICON_BYTES {
            return Err(too_big(metadata.len()));
        }
        let text = fs::read_to_string(&chosen).map_err(|_| "The file is not valid JSON.".to_string())?;
        Ok(Some(ChosenIcon { name, text }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn set_agent_icon(kind: String, text: String, state: State<'_, Arc<Mutex<Store>>>) -> Result<(), String> {
    state.lock().map_err(|_| "Reading state is unavailable")?.set_agent_icon(&kind, &text)
}

#[tauri::command]
pub fn reset_agent_icon(kind: String, state: State<'_, Arc<Mutex<Store>>>) -> Result<(), String> {
    state.lock().map_err(|_| "Reading state is unavailable")?.reset_agent_icon(&kind)
}

#[tauri::command]
pub fn agent_icons(state: State<'_, Arc<Mutex<Store>>>) -> Result<HashMap<String, String>, String> {
    Ok(state.lock().map_err(|_| "Reading state is unavailable")?.agent_icons())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn icon() -> Value {
        let markers: Vec<Value> = STATES.iter().enumerate().map(|(i, name)| json!({ "cm": name, "tm": i * 30, "dr": 30 })).collect();
        json!({ "v": "5.7.0", "w": 96, "h": 96, "fr": 30, "ip": 0, "op": 120, "layers": [], "markers": markers })
    }
    fn refusal(value: &Value) -> String {
        check_icon(&value.to_string()).unwrap_err()
    }
    fn store(dir: &std::path::Path) -> Store {
        Store::load(dir.join("state.json"))
    }

    #[test]
    fn a_complete_icon_passes_and_each_refusal_says_why() {
        assert!(check_icon(&icon().to_string()).is_ok());
        assert!(check_icon(&" ".repeat(MAX_ICON_BYTES as usize + 1)).unwrap_err().contains("512 KB"));
        assert!(check_icon("{").unwrap_err().contains("not valid JSON"));
        assert!(check_icon("[]").unwrap_err().contains("not a Lottie"));

        let mut missing = icon();
        missing["markers"].as_array_mut().unwrap().retain(|m| m["cm"] != "acting");
        assert!(refusal(&missing).contains("Missing marker(s): acting"));

        let mut linked = icon();
        linked["assets"] = json!([{ "id": "image_0", "w": 4, "h": 4, "u": "images/", "p": "img_0.png", "e": 0 }]);
        assert!(refusal(&linked).contains("outside the animation"));
        linked["assets"] = json!([{ "id": "image_0", "u": "", "p": "https://example.test/a.png", "e": 1 }]);
        assert!(refusal(&linked).contains("outside the animation"));
        linked["assets"] = json!([{ "id": "image_0", "u": "", "p": "data:image/svg+xml;base64,PHN2Zy8+", "e": 1 }]);
        assert!(refusal(&linked).contains("not a base64 PNG or WebP"));
        linked["assets"] = json!([{ "id": "image_0", "u": "", "p": "data:image/webp;base64,AAAA", "e": 1 }, { "id": "precomp", "layers": [] }]);
        assert!(check_icon(&linked.to_string()).is_ok());

        let mut font = icon();
        font["fonts"] = json!({ "list": [{ "fName": "X", "fPath": "https://example.test/x.woff" }] });
        assert!(refusal(&font).contains("font loads from outside"));

        let mut empty = icon();
        empty["markers"][0]["dr"] = json!(0);
        assert!(refusal(&empty).contains("\"idle\" has no length"));
    }

    #[test]
    fn an_icon_is_kept_by_kind_replaced_and_reset_with_its_file() {
        let dir = tempfile::tempdir().unwrap();
        let mut one = store(dir.path());
        let first = icon().to_string();
        one.set_agent_icon("claude", &first).unwrap();
        let mut second = icon();
        second["nm"] = json!("second");
        one.set_agent_icon("claude", &second.to_string()).unwrap();
        let files = |d: &std::path::Path| fs::read_dir(d.join("agent-icons")).unwrap().count();
        assert_eq!(files(dir.path()), 1, "the replaced file is deleted");
        assert!(one.agent_icons()["claude"].contains("second"));

        // It survives a restart, and a bad kind or file is refused without touching what is kept.
        let mut again = store(dir.path());
        assert!(again.agent_icons()["claude"].contains("second"));
        assert!(again.set_agent_icon("  ", &first).is_err());
        assert!(again.set_agent_icon("codex", "{}").is_err());
        assert_eq!(again.agent_icons().len(), 1);

        again.reset_agent_icon("claude").unwrap();
        assert!(again.agent_icons().is_empty());
        assert_eq!(files(dir.path()), 0);
        assert!(store(dir.path()).agent_icons().is_empty());
    }

    #[test]
    fn a_hand_edited_state_file_cannot_point_outside_the_icon_folder() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("secret.json"), icon().to_string()).unwrap();
        let mut store = store(dir.path());
        store.saved.agent_icons.insert("omp".into(), "../secret.json".into());
        assert!(store.agent_icons().is_empty());
    }
}
