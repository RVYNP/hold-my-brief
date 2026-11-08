use crate::state::{now, ImportReceipt, Library, LibraryDocument};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{de::DeserializeOwned, Serialize};
use std::{collections::{HashMap, HashSet}, fs, path::{Component, Path, PathBuf}, time::Duration};

pub struct Catalog { connection: Connection }

impl Catalog {
    pub fn open(path: &Path, legacy: &Library) -> Result<Self, String> {
        fs::create_dir_all(path.parent().ok_or("Invalid catalog directory")?).map_err(|e| e.to_string())?;
        let mut connection = Connection::open(path).map_err(|e| e.to_string())?;
        connection.busy_timeout(Duration::from_secs(5)).map_err(|e| e.to_string())?;
        connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;").map_err(|e| e.to_string())?;
        let version: i64 = connection.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        if version > 1 { return Err("This library was created by a newer Hold My Brief. It has not been changed.".into()); }
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS memberships (item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, PRIMARY KEY(item_id,collection_id));
             CREATE TABLE IF NOT EXISTS tags (item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY(item_id,tag));
             CREATE TABLE IF NOT EXISTS provenance (item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE, payload TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS source_roots (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS import_receipts (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS local_overrides (item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE, path TEXT NOT NULL);")
            .map_err(|e| e.to_string())?;
        let migrated: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM catalog_meta WHERE key='legacy_migrated')", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !migrated {
            Self::write_library(&transaction, legacy)?;
            transaction.execute("INSERT INTO catalog_meta(key,value) VALUES('legacy_migrated','1')", []).map_err(|e| e.to_string())?;
        }
        transaction.execute_batch("PRAGMA user_version=1;").map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(Self { connection })
    }

    pub fn load(&self) -> Result<Library, String> {
        let mut documents: Vec<LibraryDocument> = read_payloads(&self.connection, "SELECT payload FROM items ORDER BY rowid")?;
        let indexes: HashMap<String, usize> = documents.iter().enumerate().map(|(i,d)| (d.path.clone(),i)).collect();
        for (table, column) in [("memberships", "collection_id"), ("tags", "tag"), ("provenance", "payload")] {
            let mut statement = self.connection.prepare(&format!("SELECT item_id,{column} FROM {table} ORDER BY rowid")).map_err(|e| e.to_string())?;
            let rows = statement.query_map([], |r| Ok((r.get::<_, String>(0)?,r.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
            for row in rows {
                let (id, value) = row.map_err(|e| e.to_string())?;
                let document = &mut documents[*indexes.get(&id).ok_or("Orphan catalog record")?];
                match table {
                    "memberships" => document.collection_ids.push(value),
                    "tags" => document.tags.push(value),
                    _ => document.source = Some(serde_json::from_str(&value).map_err(|e| format!("Invalid provenance: {e}"))?),
                }
            }
        }
        Ok(Library {
            documents,
            collections: read_payloads(&self.connection, "SELECT payload FROM collections ORDER BY rowid")?,
            roots: read_payloads(&self.connection, "SELECT payload FROM source_roots ORDER BY rowid")?,
            imports: read_payloads(&self.connection, "SELECT payload FROM import_receipts ORDER BY rowid")?,
        })
    }

    pub fn save(&mut self, library: &Library) -> Result<(), String> {
        let transaction = self.connection.transaction().map_err(|e| e.to_string())?;
        Self::write_library(&transaction, library)?;
        transaction.commit().map_err(|e| e.to_string())
    }

    fn write_library(transaction: &Transaction<'_>, library: &Library) -> Result<(), String> {
        // Associations are a transactionally replaced snapshot. Item upserts retain per-item local overrides.
        transaction.execute_batch("DELETE FROM memberships; DELETE FROM tags; DELETE FROM provenance;").map_err(|e| e.to_string())?;
        sync_payloads(transaction, "collections", library.collections.iter().map(|c| (c.id.as_str(), c)))?;
        sync_payloads(transaction, "source_roots", library.roots.iter().map(|r| (r.id.as_str(), r)))?;
        sync_payloads(transaction, "import_receipts", library.imports.iter().map(|r| (r.source_id.as_str(), r)))?;
        let mut item_statement = transaction.prepare("INSERT INTO items(id,payload) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE payload<>excluded.payload").map_err(|e| e.to_string())?;
        let mut membership_statement = transaction.prepare("INSERT OR IGNORE INTO memberships(item_id,collection_id) VALUES(?1,?2)").map_err(|e| e.to_string())?;
        let mut tag_statement = transaction.prepare("INSERT OR IGNORE INTO tags(item_id,tag) VALUES(?1,?2)").map_err(|e| e.to_string())?;
        let mut source_statement = transaction.prepare("INSERT INTO provenance(item_id,payload) VALUES(?1,?2)").map_err(|e| e.to_string())?;
        let collection_ids: HashSet<_> = library.collections.iter().map(|c| c.id.as_str()).collect();
        let mut item_ids = HashSet::new();
        for document in &library.documents {
            if !item_ids.insert(document.path.as_str()) { return Err("Duplicate library item identity".into()); }
            let mut payload = serde_json::to_value(document).map_err(|e| e.to_string())?;
            let object = payload.as_object_mut().ok_or("Invalid item payload")?;
            object.remove("collectionIds"); object.remove("tags"); object.remove("source");
            item_statement.execute(params![document.path, payload.to_string()]).map_err(|e| e.to_string())?;
            for id in &document.collection_ids {
                if !collection_ids.contains(id.as_str()) { return Err(format!("Unknown collection {id}")); }
                membership_statement.execute(params![document.path,id]).map_err(|e| e.to_string())?;
            }
            for tag in &document.tags { tag_statement.execute(params![document.path,tag]).map_err(|e| e.to_string())?; }
            if let Some(source) = &document.source {
                source_statement.execute(params![document.path,serde_json::to_string(source).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
            }
        }
        prune_ids(transaction, "items", &item_ids)?;
        Ok(())
    }

    pub fn override_path(&self, id: &str) -> Result<Option<PathBuf>, String> {
        self.connection.query_row("SELECT path FROM local_overrides WHERE item_id=?1", [id], |row| row.get::<_, String>(0))
            .optional().map(|path| path.map(PathBuf::from)).map_err(|e| e.to_string())
    }

    pub fn locate(&mut self, library: &Library, id: &str, path: &Path) -> Result<(), String> {
        let transaction = self.connection.transaction().map_err(|e| e.to_string())?;
        Self::write_library(&transaction, library)?;
        transaction.execute("INSERT INTO local_overrides(item_id,path) VALUES(?1,?2) ON CONFLICT(item_id) DO UPDATE SET path=excluded.path", params![id,path.to_string_lossy()]).map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())
    }

    /// Where an item's original is, worked out from the catalog alone (no file system access), so a caller
    /// can drop the store lock before touching a possibly slow volume. `resolve` is `plan` then `open`.
    pub fn plan(&self, library: &Library, id: &str) -> Result<Original, String> {
        let document = library.documents.iter().find(|d| d.path == id).ok_or("Item is not in the library")?;
        if let Some(path) = self.override_path(id)? { return Ok(Original::Direct(path)); }
        if let Some(source) = &document.source {
            let root_id = source.root_id.as_deref().ok_or("This item has no local original. Use Locate.")?;
            let root = library.roots.iter().find(|r| r.id == root_id).and_then(|r| r.path.as_deref()).ok_or("This source root is not linked. Choose its storage folder first.")?;
            let relative = source.relative_path.as_deref().ok_or("This item has no recorded original path. Use Locate.")?;
            Ok(Original::UnderRoot { root: PathBuf::from(root), relative: relative.to_string() })
        } else { Ok(Original::Direct(PathBuf::from(&document.path))) }
    }

    pub fn resolve(&self, library: &Library, id: &str) -> Result<PathBuf, String> {
        self.plan(library, id)?.open()
    }
}

/// An original's location before it is checked on disk.
pub enum Original {
    Direct(PathBuf),
    UnderRoot { root: PathBuf, relative: String },
}

impl Original {
    /// Canonicalises and validates the file; this is the part that touches the file system.
    pub fn open(self) -> Result<PathBuf, String> {
        match self {
            Original::Direct(path) => canonical_file(&path),
            Original::UnderRoot { root, relative } => resolve_under_root(&root, &relative),
        }
    }
}

fn read_payloads<T: DeserializeOwned>(connection: &Connection, sql: &str) -> Result<Vec<T>, String> {
    let mut statement = connection.prepare(sql).map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.map(|row| serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| format!("Invalid catalog record: {e}"))).collect()
}

fn sync_payloads<'a, T: Serialize + 'a>(transaction: &Transaction<'_>, table: &str, values: impl Iterator<Item=(&'a str, &'a T)>) -> Result<(), String> {
    let mut statement = transaction.prepare(&format!("INSERT INTO {table}(id,payload) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE payload<>excluded.payload")).map_err(|e| e.to_string())?;
    let mut ids = HashSet::new();
    for (id, value) in values {
        if !ids.insert(id) { return Err(format!("Duplicate {table} identity: {id}")); }
        statement.execute(params![id, serde_json::to_string(value).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    }
    prune_ids(transaction, table, &ids)
}

fn prune_ids(transaction: &Transaction<'_>, table: &str, ids: &HashSet<&str>) -> Result<(), String> {
    let mut statement = transaction.prepare(&format!("SELECT id FROM {table}")).map_err(|e| e.to_string())?;
    let old = statement.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    let mut delete = transaction.prepare(&format!("DELETE FROM {table} WHERE id=?1")).map_err(|e| e.to_string())?;
    for id in old { if !ids.contains(id.as_str()) { delete.execute([id]).map_err(|e| e.to_string())?; } }
    Ok(())
}

fn canonical_file(path: &Path) -> Result<PathBuf, String> {
    let path = fs::canonicalize(path).map_err(|e| format!("Original is unavailable: {e}. Connect its storage or use Locate."))?;
    if !path.is_file() { return Err("The original is not a regular file.".into()); }
    Ok(path)
}

pub fn resolve_under_root(root: &Path, relative: &str) -> Result<PathBuf, String> {
    // Reject Windows prefixes/ADS even when tests or imports run on another platform.
    if relative.is_empty() || relative.contains(':') || relative.starts_with(['/', '\\']) || relative.contains('\0') {
        return Err("Original path must be relative to the authorized root.".into());
    }
    let normalized = relative.replace('\\', "/");
    if Path::new(&normalized).components().any(|c| !matches!(c, Component::Normal(_) | Component::CurDir)) {
        return Err("Original path must not traverse outside its root.".into());
    }
    let root = fs::canonicalize(root).map_err(|e| format!("Source root is unavailable: {e}"))?;
    let candidate = canonical_file(&root.join(normalized))?;
    if !candidate.starts_with(&root) { return Err("Original resolves outside the authorized root.".into()); }
    Ok(candidate)
}

pub fn selected_scope(old: &Library, incoming: &Library, selected: &[String]) -> Result<HashSet<String>, String> {
    if selected.is_empty() { return Err("Select at least one source collection.".into()); }
    let known: HashMap<_,_> = old.collections.iter().chain(&incoming.collections).filter(|c| c.source_id.is_some()).map(|c| (c.id.clone(), c)).collect();
    if selected.iter().any(|id| !known.contains_key(id)) { return Err("The selected source collection is no longer available.".into()); }
    let mut scope: HashSet<_> = selected.iter().cloned().collect();
    loop {
        let additions: Vec<_> = known.values().filter(|c| c.parent_id.as_ref().is_some_and(|id| scope.contains(id)) && !scope.contains(&c.id)).map(|c| c.id.clone()).collect();
        if additions.is_empty() { break; }
        scope.extend(additions);
    }
    Ok(scope)
}

pub fn merge_import(old: &Library, incoming: &Library, repository: &str, revision: &str, sections: &[String], selected: &[String]) -> Result<Library, String> {
    let scope = selected_scope(old, incoming, selected)?;
    let mut result = old.clone();
    let imported_ids: HashSet<_> = old.collections.iter().chain(&incoming.collections).filter(|c| c.source_id.is_some()).map(|c| c.id.as_str()).collect();
    let mut retained = scope.clone();
    for id in &scope {
        let mut cursor = incoming.collections.iter().chain(&old.collections).find(|c| &c.id == id).and_then(|c| c.parent_id.as_ref());
        let mut visited = HashSet::new();
        while let Some(parent) = cursor {
            if !visited.insert(parent) { return Err("Source collection hierarchy contains a cycle.".into()); }
            retained.insert(parent.clone());
            cursor = incoming.collections.iter().chain(&old.collections).find(|c| &c.id == parent).and_then(|c| c.parent_id.as_ref());
        }
    }
    for collection in &mut result.collections {
        if scope.contains(&collection.id) && !incoming.collections.iter().any(|c| c.id == collection.id) { collection.removed = true; }
    }
    for collection in incoming.collections.iter().filter(|c| retained.contains(&c.id)) {
        if let Some(existing) = result.collections.iter_mut().find(|c| c.id == collection.id) { *existing = collection.clone(); }
        else { result.collections.push(collection.clone()); }
    }
    let incoming_documents: HashMap<_,_> = incoming.documents.iter().filter(|d| d.collection_ids.iter().any(|id| scope.contains(id))).map(|d| (d.path.as_str(),d)).collect();
    for existing in &mut result.documents {
        let previously_selected = existing.collection_ids.iter().any(|id| scope.contains(id));
        if let Some(document) = incoming_documents.get(existing.path.as_str()) {
            let mut replacement = (*document).clone();
            replacement.favorite = existing.favorite;
            replacement.tags = existing.tags.clone();
            replacement.notes = existing.notes.clone();
            replacement.last_opened = existing.last_opened;
            // Keep personal memberships and source memberships outside the refreshed scope.
            replacement.collection_ids.retain(|id| scope.contains(id));
            for id in &existing.collection_ids {
                if (!imported_ids.contains(id.as_str()) || !scope.contains(id)) && !replacement.collection_ids.contains(id) { replacement.collection_ids.push(id.clone()); }
            }
            *existing = replacement;
        } else if previously_selected && existing.source.as_ref().is_some_and(|s| s.repository == repository) {
            existing.collection_ids.retain(|id| !scope.contains(id));
            if !existing.collection_ids.iter().any(|id| imported_ids.contains(id.as_str())) {
                if let Some(source) = &mut existing.source { source.removed = true; source.revision = revision.to_string(); }
                existing.availability = Some("missing".into());
            }
        }
    }
    let existing_ids: HashSet<_> = old.documents.iter().map(|d| d.path.as_str()).collect();
    for document in incoming.documents.iter().filter(|d| incoming_documents.contains_key(d.path.as_str()) && !existing_ids.contains(d.path.as_str())) {
        let mut document = document.clone();
        document.collection_ids.retain(|id| scope.contains(id));
        result.documents.push(document);
    }
    for root in &incoming.roots {
        if let Some(existing) = result.roots.iter_mut().find(|r| r.id == root.id) {
            // Cache roots are native-owned. User root assignments survive every refresh.
            if root.managed { *existing = root.clone(); }
        } else { result.roots.push(root.clone()); }
    }
    if let Some(receipt) = result.imports.iter_mut().find(|r| r.repository == repository) {
        receipt.revision = revision.to_string();
        receipt.imported_at = now();
        for section in sections { if !receipt.sections.contains(section) { receipt.sections.push(section.clone()); } }
        for id in selected { if !receipt.collection_ids.contains(id) { receipt.collection_ids.push(id.clone()); } }
    } else {
        result.imports.push(ImportReceipt { source_id: repository.to_string(), repository: repository.to_string(), revision: revision.to_string(), sections: sections.to_vec(), collection_ids: selected.to_vec(), imported_at: now() });
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{Collection, Provenance, SourceRoot};

    fn imported() -> Library {
        Library {
            collections: vec![Collection { id: "source:board".into(), source_id: Some("repo:gallery".into()), ..Collection::default() }],
            documents: vec![LibraryDocument { path: "source:repo:item".into(), collection_ids: vec!["source:board".into()], source: Some(Provenance { repository: "repo".into(), ..Provenance::default() }), ..LibraryDocument::default() }],
            ..Library::default()
        }
    }

    #[test]
    fn migration_is_once_and_memberships_are_normalized() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite3");
        let legacy: Library = serde_json::from_value(serde_json::json!({"collections":[{"id":"one","name":"One"}],"documents":[{"path":"book.txt","collectionId":"one","favorite":true}]})).unwrap();
        let mut catalog = Catalog::open(&path, &legacy).unwrap();
        let loaded = catalog.load().unwrap();
        assert_eq!(loaded.documents[0].collection_ids, vec!["one"]);
        assert!(loaded.documents[0].favorite);
        catalog.save(&Library::default()).unwrap();
        drop(catalog);
        assert!(Catalog::open(&path, &legacy).unwrap().load().unwrap().documents.is_empty());
    }

    #[test]
    fn records_from_retired_importers_still_load() {
        // Earlier builds stored saved views, remote links and metadata. Unknown fields are
        // ignored; such items stay listed and simply have no openable original.
        let dir = tempfile::tempdir().unwrap();
        let legacy: Library = serde_json::from_value(serde_json::json!({
            "collections":[{"id":"view","name":"View","sourceId":"owner/repo:gallery","kind":"smart","query":"project=x","warning":"partial"}],
            "documents":[{"path":"source:owner/repo:link","name":"Link","format":"link","collectionIds":["view"],"description":"d","metadata":{"a":1},"availability":"remote",
                "source":{"sourceId":"owner/repo:gallery","repository":"owner/repo","url":"https://example.test/x","sha256":"00","rootId":"retired"}}],
            "roots":[{"id":"retired","name":"Retired root","path":null,"managed":false}],
            "imports":[{"sourceId":"owner/repo","repository":"owner/repo","revision":"abc","sections":["gallery"],"collectionIds":["view"],"importedAt":1}]
        })).unwrap();
        let catalog = Catalog::open(&dir.path().join("db"), &legacy).unwrap();
        let loaded = catalog.load().unwrap();
        assert_eq!(loaded.documents[0].format, "link");
        assert_eq!(loaded.documents[0].collection_ids, vec!["view"]);
        assert!(catalog.resolve(&loaded, "source:owner/repo:link").unwrap_err().contains("not linked"));
    }

    #[test]
    fn failed_transaction_does_not_replace_library() {
        let dir = tempfile::tempdir().unwrap();
        let mut catalog = Catalog::open(&dir.path().join("db"), &imported()).unwrap();
        let mut invalid = imported();
        invalid.documents[0].collection_ids.push("missing".into());
        assert!(catalog.save(&invalid).is_err());
        assert_eq!(catalog.load().unwrap().documents[0].collection_ids, vec!["source:board"]);
    }

    #[test]
    fn reimport_preserves_personal_overlay_and_other_scopes() {
        let incoming = imported();
        let mut old = incoming.clone();
        old.collections.push(Collection { id: "personal".into(), ..Collection::default() });
        old.collections.push(Collection { id: "other".into(), source_id: Some("repo:gallery".into()), ..Collection::default() });
        old.documents[0].collection_ids.extend(["personal".into(), "other".into()]);
        old.documents[0].favorite = true; old.documents[0].tags = vec!["mine".into()]; old.documents[0].notes = "private notes".into(); old.documents[0].last_opened = 42;
        let selected = vec!["source:board".into()];
        let first = merge_import(&old, &incoming, "repo", "sha", &["gallery".into()], &selected).unwrap();
        let second = merge_import(&first, &incoming, "repo", "sha", &["gallery".into()], &selected).unwrap();
        assert_eq!(second.documents.len(), 1);
        assert!(second.documents[0].favorite);
        assert_eq!(second.documents[0].tags, vec!["mine"]);
        assert_eq!(second.documents[0].notes, "private notes");
        assert_eq!(second.documents[0].last_opened, 42);
        assert_eq!(second.documents[0].collection_ids.len(), 3);
        assert_eq!(second.imports[0].collection_ids, selected);
    }

    #[test]
    fn removed_scope_is_marked_without_deleting_local_reference() {
        let old = imported();
        let result = merge_import(&old, &Library::default(), "repo", "next", &["gallery".into()], &["source:board".into()]).unwrap();
        assert_eq!(result.documents.len(), 1);
        assert!(result.documents[0].source.as_ref().unwrap().removed);
        assert!(result.collections[0].removed);
    }

    #[test]
    fn local_override_survives_refresh_and_restart() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("original.txt"); fs::write(&original, b"kept").unwrap();
        let path = dir.path().join("db");
        let mut library = imported();
        library.roots.push(SourceRoot { id: "local-root".into(), path: Some("user-root".into()), ..SourceRoot::default() });
        let mut catalog = Catalog::open(&path, &library).unwrap();
        catalog.locate(&library, &library.documents[0].path, &original).unwrap();
        let refreshed = merge_import(&library, &imported(), "repo", "sha", &["gallery".into()], &["source:board".into()]).unwrap();
        catalog.save(&refreshed).unwrap(); drop(catalog);
        let catalog = Catalog::open(&path, &Library::default()).unwrap();
        let loaded = catalog.load().unwrap();
        assert_eq!(catalog.resolve(&loaded, &loaded.documents[0].path).unwrap(), fs::canonicalize(&original).unwrap());
        assert_eq!(loaded.roots[0].path.as_deref(), Some("user-root"));
        assert_eq!(fs::read(original).unwrap(), b"kept");
    }

    #[test]
    fn roots_reject_traversal_prefixes_and_streams() {
        let dir = tempfile::tempdir().unwrap(); fs::create_dir(dir.path().join("root")).unwrap();
        fs::write(dir.path().join("outside.txt"), b"x").unwrap();
        fs::write(dir.path().join("root/inside.txt"), b"x").unwrap();
        let root = dir.path().join("root");
        assert!(resolve_under_root(&root, "inside.txt").is_ok());
        for path in ["../outside.txt", "..\\outside.txt", "/outside.txt", "C:\\outside.txt", "\\\\server\\file", "inside.txt:stream"] { assert!(resolve_under_root(&root, path).is_err(), "{path}"); }
    }

    #[cfg(unix)]
    #[test]
    fn root_rejects_symlink_escape() {
        let dir = tempfile::tempdir().unwrap(); fs::create_dir(dir.path().join("root")).unwrap();
        fs::write(dir.path().join("outside"), b"x").unwrap();
        std::os::unix::fs::symlink(dir.path().join("outside"), dir.path().join("root/link")).unwrap();
        assert!(resolve_under_root(&dir.path().join("root"), "link").is_err());
    }
}
