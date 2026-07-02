//! App config & secrets store — the LLP 0036 v1 `local-file-immediate`
//! backend.
//!
//! @ref LLP 0036#the-store-and-the-target-seam-d1-d2-d7 — deployment-owned
//! values live in a 0600 sibling file of the SQLite database, never inside it,
//! and survive `app.reset`; the file backend is single-instance by contract
//! (the database instance lock is the enforcement seam).
//! @ref LLP 0009#secrets — no read-back: this module exposes value material
//! only to the runtime grant path; every other consumer sees names and status.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const CONFIG_STORE_FORMAT_VERSION: u32 = 1;

/// Minimum interval between probe runs for one entry.
///
/// @ref LLP 0036#operations-and-projections-llp-0024 — probe rules: a probe is
/// a quota-burn tool pointed at a vendor, so verify is cooldown-limited. The
/// hard wall-clock timeout the RFC also wants is an honest gap in v1: the
/// local runtime has no handler timeout at all yet (`wall_clock_timeout`
/// reports `Missing` in the capability manifest).
pub const VERIFY_COOLDOWN_MS: u64 = 5_000;

/// The result a probe verification leaves behind. Never carries a value.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct VerificationRecord {
    pub ok: bool,
    #[serde(rename = "atMs", alias = "at_ms")]
    pub at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<String>,
}

/// One stored entry: an ordered member pool (a single-valued entry is a
/// one-member pool) plus names-and-status metadata. Values leave this struct
/// only through [`ConfigStore::values`].
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct StoredEntry {
    values: Vec<String>,
    #[serde(rename = "setAtMs", alias = "set_at_ms")]
    pub set_at_ms: u64,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified: Option<VerificationRecord>,
}

impl StoredEntry {
    pub fn member_count(&self) -> usize {
        self.values.len()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
struct ConfigFileState {
    version: u32,
    generation: u64,
    entries: BTreeMap<String, StoredEntry>,
}

impl Default for ConfigFileState {
    fn default() -> Self {
        Self {
            version: CONFIG_STORE_FORMAT_VERSION,
            generation: 0,
            entries: BTreeMap::new(),
        }
    }
}

/// Outcome facts of a write, for envelopes and the audit line — never values.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WriteOutcome {
    pub value_changed: bool,
    pub generation: u64,
}

/// The v1 `local-file-immediate` store. `path: None` is the in-memory flavor
/// used with `:memory:` databases and tests; identical semantics, no
/// persistence.
#[derive(Debug, Default)]
pub struct ConfigStore {
    path: Option<PathBuf>,
    state: ConfigFileState,
    /// Per-entry round-robin cursors for pool rotation. In-memory on purpose:
    /// rotation fairness does not warrant a file write per action invocation.
    rotation: BTreeMap<String, u64>,
    /// Per-entry last verify attempt, for the cooldown. In-memory on purpose:
    /// the cooldown protects vendors from *this* process's loops.
    verify_attempts: BTreeMap<String, u64>,
}

impl ConfigStore {
    pub fn in_memory() -> Self {
        Self::default()
    }

    /// The store file for a given database path: a mechanical sibling
    /// (`dev.sqlite3` → `dev.sqlite3.config.json`) so two databases in one
    /// directory can never share a store by accident.
    pub fn path_for_database(db_path: &Path) -> PathBuf {
        let mut name = db_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "snapback".to_owned());
        name.push_str(".config.json");
        db_path.with_file_name(name)
    }

    /// Load the store beside a database file, creating nothing until the first
    /// write. A malformed store file is a loud error, never a silent wipe.
    pub fn open_for_database(db_path: &Path) -> SnapbackResult<Self> {
        Self::open(Self::path_for_database(db_path))
    }

    pub fn open(path: PathBuf) -> SnapbackResult<Self> {
        let state = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<ConfigFileState>(&bytes).map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_CONFIG_STORE_INVALID",
                    "config",
                    format!(
                        "config store {} exists but could not be parsed; refusing to overwrite it",
                        path.display()
                    ),
                )
                .with_details(serde_json::json!({ "error": error.to_string() }))
            })?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                ConfigFileState::default()
            }
            Err(error) => {
                return Err(store_io_error(&path, "read", &error));
            }
        };
        Ok(Self {
            path: Some(path),
            state,
            rotation: BTreeMap::new(),
            verify_attempts: BTreeMap::new(),
        })
    }

    pub fn is_persistent(&self) -> bool {
        self.path.is_some()
    }

    pub fn generation(&self) -> u64 {
        self.state.generation
    }

    pub fn entry(&self, name: &str) -> Option<&StoredEntry> {
        self.state.entries.get(name)
    }

    /// Value material for the runtime grant path — the one value exit.
    ///
    /// @ref LLP 0036#runtime-exposure-d5-d8 — values reach handler code only
    /// through granted `ctx.secrets` handles; ops surfaces get names/status.
    pub fn values(&self, name: &str) -> Option<&[String]> {
        self.state
            .entries
            .get(name)
            .map(|entry| entry.values.as_slice())
    }

    /// Set an entry (replace) or add a pool member (append). Any value change
    /// resets verification: it attested the old values.
    pub fn set(
        &mut self,
        name: &str,
        values: Vec<String>,
        append: bool,
        source: &str,
        now_ms: u64,
    ) -> SnapbackResult<WriteOutcome> {
        if values.is_empty() || values.iter().any(|value| value.trim().is_empty()) {
            return Err(SnapbackError::error(
                "SNAPBACK_CONFIG_VALUE_INVALID",
                "config",
                format!("config entry {name} was given an empty value"),
            ));
        }
        let mut next = match (append, self.state.entries.get(name)) {
            (true, Some(existing)) => {
                let mut merged = existing.values.clone();
                merged.extend(values);
                merged
            }
            _ => values,
        };
        next.retain(|value| !value.is_empty());
        let value_changed = self
            .state
            .entries
            .get(name)
            .map(|existing| existing.values != next)
            .unwrap_or(true);
        let entry = StoredEntry {
            values: next,
            set_at_ms: now_ms,
            source: source.to_owned(),
            verified: None,
        };
        self.state.entries.insert(name.to_owned(), entry);
        self.state.generation += 1;
        self.persist()?;
        Ok(WriteOutcome {
            value_changed,
            generation: self.state.generation,
        })
    }

    /// Remove an entry entirely. Removing an entry that is not set is a no-op
    /// that still reports `value_changed: false`.
    pub fn unset(&mut self, name: &str) -> SnapbackResult<WriteOutcome> {
        let value_changed = self.state.entries.remove(name).is_some();
        if value_changed {
            self.state.generation += 1;
            self.persist()?;
        }
        Ok(WriteOutcome {
            value_changed,
            generation: self.state.generation,
        })
    }

    pub fn record_verification(
        &mut self,
        name: &str,
        record: VerificationRecord,
    ) -> SnapbackResult<()> {
        if let Some(entry) = self.state.entries.get_mut(name) {
            entry.verified = Some(record);
            self.persist()?;
        }
        Ok(())
    }

    /// One-time import from the deprecated `SNAPBACK_ACTION_SECRETS` blob:
    /// only runs while the store has never been written, only imports declared
    /// names, and reports what it ignored.
    ///
    /// @ref LLP 0036#implementation-order — v1 slice item 2: the env blob is
    /// an import *source*, after which it is deprecated.
    pub fn import_env_blob(
        &mut self,
        blob: &serde_json::Map<String, serde_json::Value>,
        declared: &[String],
        now_ms: u64,
    ) -> SnapbackResult<EnvImportOutcome> {
        let mut imported = Vec::new();
        let mut ignored = Vec::new();
        if self.state.generation != 0 || !self.state.entries.is_empty() {
            return Ok(EnvImportOutcome {
                imported,
                ignored,
                skipped_existing_store: true,
            });
        }
        for (name, value) in blob {
            if !declared.contains(name) {
                ignored.push(name.clone());
                continue;
            }
            let values = match value {
                serde_json::Value::String(single) if !single.trim().is_empty() => {
                    vec![single.clone()]
                }
                serde_json::Value::Array(members) => members
                    .iter()
                    .filter_map(|member| member.as_str())
                    .filter(|member| !member.trim().is_empty())
                    .map(ToOwned::to_owned)
                    .collect(),
                _ => Vec::new(),
            };
            if values.is_empty() {
                ignored.push(name.clone());
                continue;
            }
            self.state.entries.insert(
                name.clone(),
                StoredEntry {
                    values,
                    set_at_ms: now_ms,
                    source: "env-import".to_owned(),
                    verified: None,
                },
            );
            imported.push(name.clone());
        }
        if !imported.is_empty() {
            self.state.generation += 1;
            self.persist()?;
        }
        Ok(EnvImportOutcome {
            imported,
            ignored,
            skipped_existing_store: false,
        })
    }

    /// Bump and return the round-robin cursor for a pool entry — one bump per
    /// granted invocation, so `ctx.secrets.rotating()` walks the pool.
    pub fn next_rotation_cursor(&mut self, name: &str) -> u64 {
        let cursor = self.rotation.entry(name.to_owned()).or_insert(0);
        let current = *cursor;
        *cursor = cursor.wrapping_add(1);
        current
    }

    /// Enforce the per-entry verify cooldown; records the attempt on success.
    pub fn check_verify_cooldown(&mut self, name: &str, now_ms: u64) -> SnapbackResult<()> {
        if let Some(last) = self.verify_attempts.get(name) {
            let elapsed = now_ms.saturating_sub(*last);
            if elapsed < VERIFY_COOLDOWN_MS {
                return Err(SnapbackError::error(
                    "SNAPBACK_CONFIG_VERIFY_COOLDOWN",
                    "config",
                    format!(
                        "config entry {name} was verified {elapsed}ms ago; wait {}ms between probe runs",
                        VERIFY_COOLDOWN_MS
                    ),
                ));
            }
        }
        self.verify_attempts.insert(name.to_owned(), now_ms);
        Ok(())
    }

    /// Atomic replace with owner-only permissions: write a 0600 temp sibling,
    /// then rename over the store file.
    fn persist(&self) -> SnapbackResult<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let bytes = serde_json::to_vec_pretty(&self.state).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_CONFIG_STORE_IO",
                "config",
                "config store state could not be serialized",
            )
            .with_details(serde_json::json!({ "error": error.to_string() }))
        })?;
        let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
        write_owner_only(&tmp, &bytes).map_err(|error| store_io_error(&tmp, "write", &error))?;
        std::fs::rename(&tmp, path).map_err(|error| {
            let _ = std::fs::remove_file(&tmp);
            store_io_error(path, "rename", &error)
        })?;
        Ok(())
    }
}

/// Names-only facts of an env-blob import.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct EnvImportOutcome {
    pub imported: Vec<String>,
    pub ignored: Vec<String>,
    pub skipped_existing_store: bool,
}

fn store_io_error(path: &Path, op: &str, error: &std::io::Error) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_CONFIG_STORE_IO",
        "config",
        format!("config store {op} failed for {}", path.display()),
    )
    .with_details(serde_json::json!({ "error": error.to_string() }))
}

#[cfg(unix)]
fn write_owner_only(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(not(unix))]
fn write_owner_only(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store_in(dir: &tempfile::TempDir) -> ConfigStore {
        ConfigStore::open(dir.path().join("dev.sqlite3.config.json")).unwrap()
    }

    #[test]
    fn set_persists_atomically_and_reloads() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        let outcome = store
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 42)
            .unwrap();
        assert!(outcome.value_changed);
        assert_eq!(outcome.generation, 1);

        let reloaded = store_in(&dir);
        assert_eq!(reloaded.values("caltrainFeed"), Some(&["key-1".into()][..]));
        assert_eq!(reloaded.generation(), 1);
        assert_eq!(reloaded.entry("caltrainFeed").unwrap().source, "http");
    }

    #[cfg(unix)]
    #[test]
    fn store_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        store
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 42)
            .unwrap();
        let mode = std::fs::metadata(dir.path().join("dev.sqlite3.config.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn append_grows_the_pool_and_resets_verification() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        store
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 1)
            .unwrap();
        store
            .record_verification(
                "caltrainFeed",
                VerificationRecord {
                    ok: true,
                    at_ms: 2,
                    diagnostic: None,
                },
            )
            .unwrap();
        assert!(store.entry("caltrainFeed").unwrap().verified.is_some());

        let outcome = store
            .set("caltrainFeed", vec!["key-2".into()], true, "http", 3)
            .unwrap();
        assert!(outcome.value_changed);
        assert_eq!(
            store.values("caltrainFeed"),
            Some(&["key-1".into(), "key-2".into()][..])
        );
        // Any value change resets verification — it attested the old values.
        assert!(store.entry("caltrainFeed").unwrap().verified.is_none());
    }

    #[test]
    fn unchanged_set_reports_value_changed_false_but_still_bumps_generation() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        store
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 1)
            .unwrap();
        let outcome = store
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 2)
            .unwrap();
        assert!(!outcome.value_changed);
        assert_eq!(outcome.generation, 2);
    }

    #[test]
    fn unset_removes_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        store
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 1)
            .unwrap();
        let outcome = store.unset("caltrainFeed").unwrap();
        assert!(outcome.value_changed);
        assert_eq!(store.values("caltrainFeed"), None);
        let outcome = store.unset("caltrainFeed").unwrap();
        assert!(!outcome.value_changed);
    }

    #[test]
    fn empty_values_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        let error = store
            .set("caltrainFeed", vec!["  ".into()], false, "http", 1)
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_VALUE_INVALID");
        let error = store
            .set("caltrainFeed", Vec::new(), false, "http", 1)
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_VALUE_INVALID");
    }

    #[test]
    fn env_import_only_touches_a_never_written_store_and_only_declared_names() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        let blob = serde_json::json!({
            "caltrainFeed": ["key-1", "key-2"],
            "undeclaredThing": "value",
        });
        let outcome = store
            .import_env_blob(
                blob.as_object().unwrap(),
                &["caltrainFeed".to_owned()],
                7,
            )
            .unwrap();
        assert_eq!(outcome.imported, vec!["caltrainFeed".to_owned()]);
        assert_eq!(outcome.ignored, vec!["undeclaredThing".to_owned()]);
        assert!(!outcome.skipped_existing_store);
        assert_eq!(
            store.values("caltrainFeed"),
            Some(&["key-1".into(), "key-2".into()][..])
        );
        assert_eq!(store.entry("caltrainFeed").unwrap().source, "env-import");

        // A second import is a no-op: the store has been written.
        let outcome = store
            .import_env_blob(blob.as_object().unwrap(), &["caltrainFeed".to_owned()], 8)
            .unwrap();
        assert!(outcome.skipped_existing_store);
    }

    #[test]
    fn rotation_cursor_walks_per_entry() {
        let mut store = ConfigStore::in_memory();
        assert_eq!(store.next_rotation_cursor("caltrainFeed"), 0);
        assert_eq!(store.next_rotation_cursor("caltrainFeed"), 1);
        assert_eq!(store.next_rotation_cursor("other"), 0);
    }

    #[test]
    fn verify_cooldown_blocks_rapid_probes() {
        let mut store = ConfigStore::in_memory();
        store.check_verify_cooldown("caltrainFeed", 1_000).unwrap();
        let error = store
            .check_verify_cooldown("caltrainFeed", 1_000 + VERIFY_COOLDOWN_MS - 1)
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_VERIFY_COOLDOWN");
        store
            .check_verify_cooldown("caltrainFeed", 1_000 + VERIFY_COOLDOWN_MS)
            .unwrap();
    }

    #[test]
    fn malformed_store_file_is_a_loud_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dev.sqlite3.config.json");
        std::fs::write(&path, b"not json").unwrap();
        let error = ConfigStore::open(path).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_STORE_INVALID");
    }

    #[test]
    fn database_sibling_path_is_mechanical() {
        assert_eq!(
            ConfigStore::path_for_database(Path::new(".snapback/dev.sqlite3")),
            PathBuf::from(".snapback/dev.sqlite3.config.json")
        );
    }
}
