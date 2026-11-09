use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    pub id: String,
    pub path: String,
    pub name: String,
    pub format: String,
    pub last_opened: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Provenance {
    pub source_id: String,
    pub record_id: String,
    pub repository: String,
    pub source_path: String,
    pub revision: String,
    pub root_id: Option<String>,
    pub relative_path: Option<String>,
    pub removed: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDocument {
    pub path: String,
    pub name: String,
    pub format: String,
    pub last_opened: u64,
    pub collection_ids: Vec<String>,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub notes: String,
    pub source: Option<Provenance>,
    pub availability: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_seed: Option<u32>,
}

#[cfg(test)]
mod cover_seed_tests {
    use super::*;

    #[test]
    fn cover_seed_round_trips_and_is_optional() {
        let plain: LibraryDocument = serde_json::from_str(r#"{"path":"a.pdf"}"#).unwrap();
        assert_eq!(plain.cover_seed, None);
        assert!(!serde_json::to_string(&plain).unwrap().contains("coverSeed"));
        let seeded: LibraryDocument = serde_json::from_str(r#"{"path":"a.pdf","coverSeed":99}"#).unwrap();
        assert_eq!(seeded.cover_seed, Some(99));
        assert!(serde_json::to_string(&seeded).unwrap().contains(r#""coverSeed":99"#));
    }

    #[test]
    fn set_cover_seed_change_sets_and_clears() {
        let mut library = Library::default();
        library.documents.push(LibraryDocument { path: "a.pdf".into(), ..LibraryDocument::default() });
        let set: LibraryChange = serde_json::from_str(r#"{"action":"setCoverSeed","path":"a.pdf","coverSeed":5}"#).unwrap();
        library.apply(&set).unwrap();
        assert_eq!(library.documents[0].cover_seed, Some(5));
        let clear: LibraryChange = serde_json::from_str(r#"{"action":"setCoverSeed","path":"a.pdf","coverSeed":null}"#).unwrap();
        library.apply(&clear).unwrap();
        assert_eq!(library.documents[0].cover_seed, None);
        let missing: LibraryChange = serde_json::from_str(r#"{"action":"setCoverSeed","path":"x","coverSeed":1}"#).unwrap();
        assert!(library.apply(&missing).is_err());
    }
}

impl<'de> Deserialize<'de> for LibraryDocument {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Default, Deserialize)]
        #[serde(default, rename_all = "camelCase")]
        struct Input {
            path: String, name: String, format: String, last_opened: u64,
            collection_id: Option<String>, collection_ids: Vec<String>, favorite: bool,
            tags: Vec<String>, notes: String, source: Option<Provenance>, availability: Option<String>, cover_seed: Option<u32>,
        }
        let mut input = Input::deserialize(deserializer)?;
        if let Some(id) = input.collection_id {
            if !input.collection_ids.contains(&id) { input.collection_ids.push(id); }
        }
        Ok(Self {
            path: input.path, name: input.name, format: input.format, last_opened: input.last_opened,
            collection_ids: input.collection_ids, favorite: input.favorite, tags: input.tags,
            notes: input.notes, source: input.source, availability: input.availability, cover_seed: input.cover_seed,
        })
    }
}

impl From<&Recent> for LibraryDocument {
    fn from(recent: &Recent) -> Self {
        Self { path: recent.path.clone(), name: recent.name.clone(), format: recent.format.clone(),
            last_opened: recent.last_opened, ..Self::default() }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub source_id: Option<String>,
    pub removed: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SourceRoot {
    pub id: String, pub name: String, pub path: Option<String>, pub managed: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ImportReceipt {
    pub source_id: String, pub repository: String, pub revision: String,
    pub sections: Vec<String>, pub collection_ids: Vec<String>, pub imported_at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Library {
    pub documents: Vec<LibraryDocument>,
    pub collections: Vec<Collection>,
    pub roots: Vec<SourceRoot>,
    pub imports: Vec<ImportReceipt>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum LibraryChange {
    CreateCollection { id: String, name: String, #[serde(rename = "parentId")] parent_id: Option<String> },
    RenameCollection { id: String, name: String },
    MoveCollection { id: String, #[serde(rename = "parentId")] parent_id: Option<String> },
    DeleteCollection { id: String },
    UpdateDocument {
        path: String,
        #[serde(rename = "collectionIds")]
        collection_ids: Vec<String>,
        favorite: bool, tags: Vec<String>, notes: String,
    },
    RemoveDocument { path: String },
    /// `Some(seed)` sets, `None` clears the generated-cover seed.
    SetCoverSeed {
        path: String,
        #[serde(rename = "coverSeed")]
        cover_seed: Option<u32>,
    },
}

impl Library {
    pub fn validate_collection(&self, id: Option<&str>) -> Result<(), String> {
        if id.is_some_and(|id| !self.collections.iter().any(|c| c.id == id)) {
            return Err("Collection no longer exists.".into());
        }
        Ok(())
    }

    pub fn validate_local_collection(&self, id: Option<&str>) -> Result<(), String> {
        self.validate_collection(id)?;
        if id.is_some_and(|id| self.collections.iter().any(|c| c.id == id && c.source_id.is_some())) {
            return Err("Indexed folder collections are maintained by their source folder.".into());
        }
        Ok(())
    }

    fn collection_name(&self, name: &str, except: Option<&str>) -> Result<String, String> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 120 {
            return Err("Use a collection name between 1 and 120 characters.".into());
        }
        let folded = name.to_lowercase();
        if self.collections.iter().any(|c| c.source_id.is_none() && Some(c.id.as_str()) != except && c.name.to_lowercase() == folded) {
            return Err("A collection with this name already exists.".into());
        }
        Ok(name.to_string())
    }

    fn apply(&mut self, change: &LibraryChange) -> Result<(), String> {
        match change {
            LibraryChange::CreateCollection { id, name, parent_id } => {
                if id.trim().is_empty() || id.len() > 120 || self.collections.iter().any(|c| c.id == *id) {
                    return Err("Collection ID must be unique and nonempty.".into());
                }
                self.validate_local_collection(parent_id.as_deref())?;
                let name = self.collection_name(name, None)?;
                self.collections.push(Collection { id: id.clone(), name, parent_id: parent_id.clone(), ..Collection::default() });
            }
            LibraryChange::RenameCollection { id, name } => {
                self.validate_local_collection(Some(id))?;
                let name = self.collection_name(name, Some(id))?;
                self.collections.iter_mut().find(|c| c.id == *id).unwrap().name = name;
            }
            LibraryChange::MoveCollection { id, parent_id } => {
                self.validate_local_collection(Some(id))?;
                self.validate_local_collection(parent_id.as_deref())?;
                let mut cursor = parent_id.as_deref();
                let mut seen = HashSet::new();
                while let Some(parent) = cursor {
                    if parent == id || !seen.insert(parent) { return Err("Collection moves must not create a cycle.".into()); }
                    cursor = self.collections.iter().find(|c| c.id == parent).and_then(|c| c.parent_id.as_deref());
                }
                self.collections.iter_mut().find(|c| c.id == *id).unwrap().parent_id = parent_id.clone();
            }
            LibraryChange::DeleteCollection { id } => {
                self.validate_local_collection(Some(id))?;
                let parent = self.collections.iter().find(|c| c.id == *id).unwrap().parent_id.clone();
                self.collections.retain(|c| c.id != *id);
                for collection in &mut self.collections {
                    if collection.parent_id.as_ref() == Some(id) { collection.parent_id = parent.clone(); }
                }
                for document in &mut self.documents { document.collection_ids.retain(|member| member != id); }
            }
            LibraryChange::UpdateDocument { path, collection_ids, favorite, tags, notes } => {
                for id in collection_ids { self.validate_collection(Some(id))?; }
                if notes.len() > 65536 || tags.len() > 100 || tags.iter().any(|t| t.len() > 120) {
                    return Err("Notes or tags exceed their supported size.".into());
                }
                let imported: HashSet<_> = self.collections.iter().filter(|c| c.source_id.is_some()).map(|c| c.id.clone()).collect();
                let document = self.documents.iter_mut().find(|d| d.path == *path).ok_or("Document is no longer in the library.")?;
                document.collection_ids.retain(|id| imported.contains(id));
                for id in collection_ids {
                    if !imported.contains(id) && !document.collection_ids.contains(id) { document.collection_ids.push(id.clone()); }
                }
                document.favorite = *favorite;
                document.tags = tags.clone();
                document.notes = notes.clone();
            }
            LibraryChange::RemoveDocument { path } => {
                if !self.documents.iter().any(|d| d.path == *path) { return Err("Document is no longer in the library.".into()); }
                self.documents.retain(|d| d.path != *path);
            }
            LibraryChange::SetCoverSeed { path, cover_seed } => {
                let document = self.documents.iter_mut().find(|d| d.path == *path).ok_or("Document is no longer in the library.")?;
                document.cover_seed = *cover_seed;
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingState {
    pub locator: Value,
    pub options: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WindowState {
    // Dimensions are outer logical pixels. Position is physical desktop coordinates.
    pub width: f64,
    pub height: f64,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub monitor: Option<String>,
    pub pinned: bool,
    pub locked: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: 420.0,
            height: 620.0,
            x: None,
            y: None,
            monitor: None,
            pinned: false,
            locked: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedState {
    pub version: u32,
    pub recents: Vec<Recent>,
    pub window: WindowState,
    pub documents: HashMap<String, ReadingState>,
    pub path_ids: HashMap<String, String>,
    #[serde(skip_serializing)]
    pub library: Library,
}

impl Default for SavedState {
    fn default() -> Self {
        Self {
            version: 1,
            recents: vec![],
            window: WindowState::default(),
            documents: HashMap::new(),
            path_ids: HashMap::new(),
            library: Library::default(),
        }
    }
}

impl<'de> Deserialize<'de> for SavedState {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // Only an absent property migrates recents; an explicit empty library stays empty.
        fn present_library<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<Library>, D::Error> {
            Library::deserialize(deserializer).map(Some)
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Input {
            version: u32,
            recents: Vec<Recent>,
            window: WindowState,
            documents: HashMap<String, ReadingState>,
            path_ids: HashMap<String, String>,
            #[serde(default, deserialize_with = "present_library")]
            library: Option<Library>,
        }
        let input = Input::deserialize(deserializer)?;
        let library = input.library.unwrap_or_else(|| {
            let mut library = Library::default();
            for recent in &input.recents {
                if !library.documents.iter().any(|d| d.path == recent.path) {
                    library.documents.push(LibraryDocument::from(recent));
                }
            }
            library
        });
        Ok(Self {
            version: input.version,
            recents: input.recents,
            window: input.window,
            documents: input.documents,
            path_ids: input.path_ids,
            library,
        })
    }
}

pub struct Store {
    pub saved: SavedState,
    pub file: PathBuf,
    pub warning: Option<String>,
    pub writable: bool,
    pub dirty: bool,
    pub authorized: HashSet<PathBuf>,
    pub opened: HashMap<String, Recent>,
    pub opened_aliases: HashMap<(String, String), Recent>,
    pub pending: Option<String>,
    pub catalog: Option<crate::catalog::Catalog>,
    pub catalog_error: Option<String>,
}


impl Store {
    pub fn load(file: PathBuf) -> Self {
        let mut warning = None;
        let mut writable = true;
        let mut saved = match fs::read(&file) {
            Ok(bytes) => match serde_json::from_slice::<SavedState>(&bytes) {
                Ok(mut state)
                    if state.version == 1
                        && state.window.width.is_finite()
                        && state.window.height.is_finite()
                        && state.window.width > 0.0
                        && state.window.height > 0.0 =>
                {
                    state.recents.truncate(20);
                    state
                }
                _ => {
                    // Preserve the exact unreadable bytes before ever replacing the state file.
                    let backup = file.with_file_name(format!("state-unreadable-{}.json", now()));
                    match fs::rename(&file, &backup) {
                        Ok(()) => warning = Some(format!("Saved reading data was unreadable. A recovery copy was preserved at {}. New reading data starts empty.", backup.display())),
                        Err(error) => {
                            writable = false;
                            warning = Some(format!("Saved reading data was unreadable and could not be preserved ({error}). The original remains untouched; progress cannot be saved."));
                        }
                    }
                    SavedState::default()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => SavedState::default(),
            Err(error) => {
                writable = false;
                warning = Some(format!("Saved reading data could not be read ({error}). The original remains untouched; progress cannot be saved."));
                SavedState::default()
            }
        };
        let catalog_result = crate::catalog::Catalog::open(&file.with_file_name("library.sqlite3"), &saved.library);
        let (catalog, catalog_error) = match catalog_result {
            Ok(catalog) => match catalog.load() {
                Ok(library) => { saved.library = library; (Some(catalog), None) }
                Err(error) => (None, Some(error)),
            },
            Err(error) => (None, Some(error)),
        };
        if let Some(error) = &catalog_error {
            // Do not remove the legacy JSON library until its database migration is durable.
            writable = false;
            warning = Some(format!("Library database is unavailable: {error}. Existing files are untouched; restart after resolving the error."));
        }
        let authorized = saved
            .library
            .documents
            .iter()
            .map(|d| d.path.as_str())
            .chain(saved.recents.iter().map(|r| r.path.as_str()))
            .filter_map(|path| fs::canonicalize(path).ok())
            .collect();
        Self {
            saved,
            file,
            warning,
            writable,
            dirty: false,
            authorized,
            opened: HashMap::new(),
            opened_aliases: HashMap::new(),
            pending: None,
            catalog,
            catalog_error,
        }
    }

    pub fn persist(&mut self) -> Result<(), String> {
        self.dirty = true;
        if !self.writable {
            return Err(self
                .warning
                .clone()
                .unwrap_or_else(|| "Progress could not be saved.".into()));
        }
        let result = self.write_atomic();
        if let Err(error) = &result {
            self.warning = Some(format!("Progress could not be saved: {error}. Reading data is kept in memory. Retry saving."));
        } else {
            self.dirty = false;
            if self
                .warning
                .as_deref()
                .is_some_and(|w| w.starts_with("Progress could not be saved:"))
            {
                self.warning = None;
            }
        }
        result
    }

    fn write_atomic(&self) -> Result<(), String> {
        let parent = self
            .file
            .parent()
            .ok_or("Invalid application-data directory")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut temporary, &self.saved).map_err(|e| e.to_string())?;
        temporary.flush().map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        // tempfile uses atomic replacement on Windows and rename on Unix. No delete-first gap.
        temporary
            .persist(&self.file)
            .map_err(|e| e.error.to_string())?;
        Ok(())
    }

    pub fn library(&self) -> Result<Library, String> {
        if let Some(error) = &self.catalog_error { return Err(error.clone()); }
        Ok(self.saved.library.clone())
    }

    pub fn commit_library(&mut self, library: Library, removed: Option<&str>) -> Result<Library, String> {
        let catalog = self.catalog.as_mut().ok_or_else(|| self.catalog_error.clone().unwrap_or_else(|| "Library database is unavailable.".into()))?;
        catalog.save(&library)?;
        self.saved.library = library;
        if let Some(path) = removed {
            self.saved.recents.retain(|r| r.path != path);
            // JSON reading state is independent: a failed save does not roll back a committed catalog.
            let _ = self.persist();
        }
        Ok(self.saved.library.clone())
    }

    pub fn edit_library(&mut self, change: LibraryChange) -> Result<Library, String> {
        let mut library = self.saved.library.clone();
        library.apply(&change)?;
        let removed = match &change {
            LibraryChange::RemoveDocument { path } => Some(path.as_str()),
            _ => None,
        };
        self.commit_library(library, removed)
    }

    pub fn add_documents(&mut self, documents: Vec<LibraryDocument>, collection_id: Option<&str>) -> Result<Library, String> {
        self.saved.library.validate_local_collection(collection_id)?;
        let mut library = self.saved.library.clone();
        for mut document in documents {
            if let Some(existing) = library.documents.iter_mut().find(|existing| existing.path == document.path) {
                if let Some(id) = collection_id {
                    if !existing.collection_ids.iter().any(|member| member == id) { existing.collection_ids.push(id.to_string()); }
                }
            } else {
                document.collection_ids = collection_id.map(|id| vec![id.to_string()]).unwrap_or_default();
                library.documents.push(document);
            }
        }
        self.commit_library(library, None)
    }

    pub fn save_position(&mut self, id: String, path: String, reading: ReadingState) -> Result<(), String> {
        self.saved.documents.insert(id.clone(), reading);
        self.saved.path_ids.insert(path, id);
        self.persist()
    }

    pub fn promote(&mut self, id: &str) -> Result<(), String> {
        let mut recent = self.opened.get(id).cloned().ok_or("Document is not open")?;
        recent.last_opened = now();
        let mut library = self.library()?;
        if let Some(document) = library.documents.iter_mut().find(|d| d.path == recent.path) {
            if document.source.is_none() {
                document.name.clone_from(&recent.name);
                document.format.clone_from(&recent.format);
            }
            document.last_opened = recent.last_opened;
        } else {
            library.documents.push(LibraryDocument::from(&recent));
        }
        self.commit_library(library, None)?;
        self.saved.recents.retain(|r| r.path != recent.path);
        self.saved
            .path_ids
            .insert(recent.path.clone(), id.to_string());
        self.saved.recents.insert(0, recent);
        self.saved.recents.truncate(20);
        self.persist()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unreadable_state_is_preserved_exactly() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("state.json");
        fs::write(&file, b"broken state { original").unwrap();
        let mut store = Store::load(file.clone());
        assert!(store.warning.is_some());
        store.persist().unwrap();
        let backup = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().path())
            .find(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("state-unreadable-")
            })
            .unwrap();
        assert_eq!(fs::read(backup).unwrap(), b"broken state { original");
        assert_eq!(Store::load(file).saved.version, 1);
    }

    #[test]
    fn replacement_preserves_document_state_and_bounds_recents() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("state.json");
        let mut store = Store::load(file.clone());
        for i in 0..25 {
            let id = i.to_string();
            store.opened.insert(
                id.clone(),
                Recent {
                    id: id.clone(),
                    path: id.clone(),
                    name: id.clone(),
                    format: "txt".into(),
                    last_opened: 0,
                },
            );
            store.saved.documents.insert(
                id.clone(),
                ReadingState {
                    locator: serde_json::json!({ "line": i }),
                    options: Value::Null,
                },
            );
            store.promote(&id).unwrap();
        }
        let loaded = Store::load(file);
        assert_eq!(loaded.saved.recents.len(), 20);
        assert_eq!(loaded.saved.documents.len(), 25);
        assert_eq!(loaded.saved.library.documents.len(), 25);
        assert_eq!(loaded.saved.recents[0].id, "24");
    }

    #[test]
    fn failed_write_retains_last_good_state_and_memory() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("state.json");
        let mut store = Store::load(file.clone());
        store.persist().unwrap();
        let original = fs::read(&file).unwrap();
        store.saved.window.pinned = true;
        store.file = dir.path().join("missing-parent").join("state.json");
        fs::write(dir.path().join("missing-parent"), b"not a directory").unwrap();
        assert!(store.persist().is_err());
        assert!(store.saved.window.pinned);
        assert!(store.dirty);
        assert_eq!(fs::read(file).unwrap(), original);
    }

    fn recent(path: &str) -> Recent {
        Recent { id: "digest".into(), path: path.into(), name: "book.txt".into(), format: "txt".into(), last_opened: 7 }
    }

    #[test]
    fn legacy_recents_migrate_only_when_library_is_absent() {
        // A v1 state file has no library key: loading migrates recents into the
        // catalog-backed library exactly once, preserving favorites and reading state.
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("state.json");
        let mut saved = SavedState::default();
        saved.recents.push(recent("book.txt"));
        saved.documents.insert("digest".into(), ReadingState { locator: serde_json::json!({"line": 9}), options: Value::Null });
        saved.path_ids.insert("book.txt".into(), "digest".into());
        let mut legacy = serde_json::to_value(&saved).unwrap();
        legacy.as_object_mut().unwrap().remove("library");
        fs::write(&file, serde_json::to_vec(&legacy).unwrap()).unwrap();
        let store = Store::load(file.clone());
        assert_eq!(store.library().unwrap().documents.len(), 1);
        assert_eq!(store.library().unwrap().documents[0].last_opened, 7);
        assert_eq!(store.saved.documents["digest"].locator["line"], 9);
        assert_eq!(store.saved.path_ids["book.txt"], "digest");

        // Explicit persisted state keeps its exact contents; a catalog that has
        // already adopted the legacy records does not resurrect deleted recents.
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("explicit-state.json");
        let mut explicit = serde_json::to_value(&saved).unwrap();
        explicit.as_object_mut().unwrap().insert("library".into(), serde_json::json!({}));
        fs::write(&file, serde_json::to_vec(&explicit).unwrap()).unwrap();
        assert!(Store::load(file).saved.library.documents.is_empty());
    }

    #[test]
    fn removal_keeps_source_and_resume_and_progress_cannot_reinsert() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("book.txt");
        fs::write(&source, b"original source").unwrap();
        let path = fs::canonicalize(&source).unwrap().to_string_lossy().into_owned();
        let file = dir.path().join("state.json");
        let mut store = Store::load(file.clone());
        store.opened.insert("digest".into(), recent(&path));
        store.promote("digest").unwrap();
        store.edit_library(LibraryChange::RemoveDocument { path: path.clone() }).unwrap();
        store.save_position("digest".into(), path.clone(), ReadingState {
            locator: serde_json::json!({"line": 17}), options: Value::Null,
        }).unwrap();
        let loaded = Store::load(file);
        assert!(loaded.saved.library.documents.is_empty());
        assert!(loaded.saved.recents.is_empty());
        assert_eq!(loaded.saved.documents["digest"].locator["line"], 17);
        assert_eq!(loaded.saved.path_ids[&path], "digest");
        assert_eq!(fs::read(source).unwrap(), b"original source");
    }

    #[test]
    fn library_restores_authorization_without_recents_and_preserves_organization() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("book.txt");
        fs::write(&source, b"source").unwrap();
        let canonical = fs::canonicalize(source).unwrap();
        let path = canonical.to_string_lossy().into_owned();
        let file = dir.path().join("state.json");
        let mut store = Store::load(file.clone());
        store.edit_library(LibraryChange::CreateCollection { id: "collection".into(), name: "  Reading  ".into(), parent_id: None }).unwrap();
        store.add_documents(vec![LibraryDocument::from(&recent(&path))], Some("collection")).unwrap();
        store.edit_library(LibraryChange::UpdateDocument { path: path.clone(), collection_ids: vec![], favorite: true, tags: vec![], notes: String::new() }).unwrap();
        let mut loaded = Store::load(file.clone());
        assert!(loaded.authorized.contains(&canonical));
        assert!(loaded.saved.recents.is_empty());
        assert_eq!(loaded.saved.library.collections[0].name, "Reading");
        assert!(loaded.saved.library.documents[0].favorite);

        loaded.opened.insert("digest".into(), recent(&path));
        loaded.promote("digest").unwrap();
        loaded.add_documents(vec![LibraryDocument::from(&recent(&path))], None).unwrap();
        assert_eq!(loaded.saved.library.documents.len(), 1);
        assert!(loaded.saved.library.documents[0].favorite);
        loaded.edit_library(LibraryChange::DeleteCollection { id: "collection".into() }).unwrap();
        let loaded = Store::load(file);
        assert!(loaded.saved.library.collections.is_empty());
        assert!(loaded.saved.library.documents[0].favorite);
        assert!(canonical.exists());
    }

    #[test]
    fn library_validation_and_failed_persistence_leave_library_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("state.json");
        let mut store = Store::load(file.clone());
        store.edit_library(LibraryChange::CreateCollection { id: "one".into(), name: "One".into(), parent_id: None }).unwrap();
        assert!(store.edit_library(LibraryChange::CreateCollection { id: "two".into(), name: " ONE ".into(), parent_id: None }).is_err());
        assert!(store.edit_library(LibraryChange::CreateCollection { id: "one".into(), name: "Two".into(), parent_id: None }).is_err());
        assert!(store.edit_library(LibraryChange::CreateCollection { id: "two".into(), name: " ".into(), parent_id: None }).is_err());
        assert!(store.edit_library(LibraryChange::CreateCollection { id: "two".into(), name: "x".repeat(121), parent_id: None }).is_err());
        assert!(store.edit_library(LibraryChange::RenameCollection { id: "missing".into(), name: "Two".into() }).is_err());
        assert!(store.edit_library(LibraryChange::DeleteCollection { id: "missing".into() }).is_err());
        assert!(store.add_documents(vec![LibraryDocument::from(&recent("book.txt"))], Some("missing")).is_err());
        assert!(store.edit_library(LibraryChange::UpdateDocument { path: "missing".into(), collection_ids: vec![], favorite: true, tags: vec![], notes: String::new() }).is_err());
        store.add_documents(vec![LibraryDocument::from(&recent("book.txt"))], Some("one")).unwrap();
        assert!(store.edit_library(LibraryChange::UpdateDocument { path: "book.txt".into(), collection_ids: vec!["missing".into()], favorite: true, tags: vec![], notes: String::new() }).is_err());
        store.edit_library(LibraryChange::RenameCollection { id: "one".into(), name: " New name ".into() }).unwrap();
        assert_eq!(Store::load(file.clone()).saved.library.collections[0].name, "New name");
        store.persist().unwrap();
        // The SQLite catalog is authoritative: an edit commits there even when the
        // legacy JSON state file cannot be rewritten. The JSON file keeps its last
        // good contents, and the in-memory library still reflects the edit.
        let original_json = fs::read(&file).unwrap();
        fs::write(dir.path().join("blocked"), b"file").unwrap();
        store.file = dir.path().join("blocked").join("state.json");
        store.edit_library(LibraryChange::RemoveDocument { path: "book.txt".into() }).unwrap();
        assert!(store.saved.library.documents.is_empty());
        assert_eq!(fs::read(file).unwrap(), original_json);
    }
}
