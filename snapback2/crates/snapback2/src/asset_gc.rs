//! Fork-aware deletion of server-owned asset bytes.

use crate::blob_store::BlobStore;
use crate::protocol::Refusal;
use rusqlite::{Connection, OpenFlags};
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

/// Sweep immutable originals and variants in one enumeration. Active-ledger
/// reclamation candidates survive only while a read-only fork still names
/// them; keys absent from every ledger are orphans by definition. The returned
/// ids remain candidates for a later sweep.
// @ref LLP 1006#9a-where-bytes-live-author-ruling-2026-09-03 — immutable
// blobs are shared by fork snapshots, so every fork ledger is a referrer.
pub fn sweep_asset_blobs(
    root: &Path,
    blobs: &dyn BlobStore,
    live_ids: &BTreeSet<String>,
    reclaimed_ids: &BTreeSet<String>,
) -> Result<BTreeSet<String>, Refusal> {
    let fork_ids = fork_all_references(root)?;
    let remaining = reclaimed_ids
        .intersection(&fork_ids)
        .cloned()
        .collect::<BTreeSet<_>>();
    blobs.enumerate("", &mut |key| {
        let id = key.split_once(".w").map_or(key, |(id, _)| id);
        let fork_referenced = fork_ids.contains(id);
        if !fork_referenced && (reclaimed_ids.contains(id) || !live_ids.contains(id)) {
            blobs.delete(key)?;
        }
        Ok(())
    })?;
    Ok(remaining)
}

fn fork_all_references(root: &Path) -> Result<BTreeSet<String>, Refusal> {
    let directory = root.join(".snapback/forks");
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(BTreeSet::new());
        }
        Err(error) => {
            return Err(asset_io(format!(
                "cannot inspect fork ledgers in {}: {error}",
                directory.display()
            )));
        }
    };
    let mut referenced = BTreeSet::new();
    for entry in entries {
        let entry = entry.map_err(|error| asset_io(format!("cannot inspect a fork: {error}")))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("sqlite") {
            continue;
        }
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| asset_io(format!("cannot inspect {}: {error}", path.display())))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(asset_io(format!(
                "fork ledger {} is not a regular file",
                path.display()
            )));
        }
        let connection = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| {
            asset_io(format!(
                "cannot open fork {} read-only: {error}",
                path.display()
            ))
        })?;
        let has_assets = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '_assets')",
                [],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| asset_io(format!("cannot inspect fork {}: {error}", path.display())))?;
        if !has_assets {
            continue;
        }
        let mut statement = connection
            .prepare("SELECT id FROM _assets")
            .map_err(|error| asset_io(format!("cannot read fork {}: {error}", path.display())))?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| asset_io(format!("cannot read fork {}: {error}", path.display())))?;
        for row in rows {
            referenced.insert(row.map_err(|error| {
                asset_io(format!("cannot decode fork {}: {error}", path.display()))
            })?);
        }
    }
    Ok(referenced)
}

fn asset_io(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_OWNER_ASSET_IO",
        "owner",
        message,
        "make .snapback/forks and .snapback/blobs readable and writable by the owner",
        "assets/reclaim",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blob_store::{BlobStore, FileBlobStore};
    use snapback2_core::{
        ASSET_RECLAIM_GRACE_MS, Actor, AssetKind, AssetReadyFacts, Auth, Ceilings, Generation,
        ProjectJson, Runtime, Schema, Store,
    };
    use std::io::Cursor;
    use std::time::{SystemTime, UNIX_EPOCH};

    const ID: &str = "s2id-00000000000000000000000000000006-0000000000000001";

    /// The raw ledger mint is crate-private to core; a tableless generation is
    /// enough to open the typed `Runtime` entry over a real store file.
    fn empty_generation() -> Generation {
        Generation::certify(
            &ProjectJson {
                version: 1,
                schema: Schema::default(),
                programs: Vec::new(),
                effects: Vec::new(),
                auth: Auth::default(),
            },
            Ceilings::default(),
        )
        .unwrap()
    }

    #[test]
    fn fork_ledgers_keep_shared_originals_and_rungs() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("snapback2-asset-gc-{stamp}"));
        fs::create_dir_all(root.join(".snapback/forks")).unwrap();
        let blobs = FileBlobStore::open(&root).unwrap();
        blobs.put(ID, &mut Cursor::new(b"original")).unwrap();
        blobs
            .put(&format!("{ID}.w256"), &mut Cursor::new(b"rung"))
            .unwrap();
        let fork = Connection::open(root.join(".snapback/forks/kept.sqlite")).unwrap();
        fork.execute("CREATE TABLE _assets (id TEXT PRIMARY KEY)", [])
            .unwrap();
        fork.execute("INSERT INTO _assets (id) VALUES (?1)", [ID])
            .unwrap();
        drop(fork);

        let candidates = BTreeSet::from([ID.to_owned()]);
        assert_eq!(
            sweep_asset_blobs(&root, &blobs, &candidates, &candidates).unwrap(),
            candidates
        );
        assert!(blobs.path_for_key(ID).unwrap().exists());
        assert!(blobs.path_for_key(&format!("{ID}.w256")).unwrap().exists());

        fs::remove_file(root.join(".snapback/forks/kept.sqlite")).unwrap();
        assert!(
            sweep_asset_blobs(&root, &blobs, &candidates, &candidates)
                .unwrap()
                .is_empty()
        );
        assert!(!blobs.path_for_key(ID).unwrap().exists());
        assert!(!blobs.path_for_key(&format!("{ID}.w256")).unwrap().exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reclaiming_tombstone_survives_crash_boundary_and_next_boot_finishes() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("snapback2-asset-restart-gc-{stamp}"));
        fs::create_dir_all(root.join(".snapback")).unwrap();
        let guest = Actor::user("guest-crash").unwrap();
        let id = {
            let mut ledger = Runtime::open(
                Store::open(&root.join(".snapback/store.sqlite")).unwrap(),
                empty_generation(),
            )
            .unwrap();
            let id = ledger
                .begin_asset_charged(AssetKind::Image, &guest, 0, 8)
                .unwrap();
            ledger.reserve_asset_finalized_bytes(&id, 8).unwrap();
            ledger
                .mark_asset_ready(
                    &id,
                    &AssetReadyFacts {
                        media_type: "image/png".to_owned(),
                        bytes: 8,
                        width: 1,
                        height: 1,
                        duration: None,
                    },
                )
                .unwrap();
            let blobs = FileBlobStore::open(&root).unwrap();
            blobs.put(&id, &mut Cursor::new(b"12345678")).unwrap();
            assert_eq!(
                ledger.reclaim_assets(ASSET_RECLAIM_GRACE_MS).unwrap(),
                vec![id.clone()]
            );
            assert!(ledger.store().asset(&id).unwrap().unwrap().reclaiming);
            id
        };

        let mut ledger = Runtime::open(
            Store::open(&root.join(".snapback/store.sqlite")).unwrap(),
            empty_generation(),
        )
        .unwrap();
        let blobs = FileBlobStore::open(&root).unwrap();
        let resumed = ledger.reclaim_assets(0).unwrap();
        assert_eq!(resumed, vec![id.clone()]);
        assert!(
            sweep_asset_blobs(
                &root,
                &blobs,
                &BTreeSet::from([id.clone()]),
                &BTreeSet::from([id.clone()]),
            )
            .unwrap()
            .is_empty()
        );
        ledger.finish_asset_reclaims(&resumed).unwrap();
        assert!(ledger.store().asset(&id).unwrap().is_none());
        assert!(blobs.get(&id, None).is_err());
        drop(ledger);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn one_enumeration_deletes_unreferenced_originals_and_rungs() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("snapback2-asset-orphan-gc-{stamp}"));
        fs::create_dir_all(root.join(".snapback")).unwrap();
        let blobs = FileBlobStore::open(&root).unwrap();
        blobs.put(ID, &mut Cursor::new(b"orphan")).unwrap();
        blobs
            .put(&format!("{ID}.w256"), &mut Cursor::new(b"rung"))
            .unwrap();
        sweep_asset_blobs(&root, &blobs, &BTreeSet::new(), &BTreeSet::new()).unwrap();
        let mut found = Vec::new();
        blobs
            .enumerate("", &mut |key| {
                found.push(key.to_owned());
                Ok(())
            })
            .unwrap();
        assert!(found.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn finalized_growth_reservation_survives_publish_to_ready_crash_window() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("snapback2-asset-quota-crash-{stamp}"));
        fs::create_dir_all(root.join(".snapback")).unwrap();
        let path = root.join(".snapback/store.sqlite");
        let guest = Actor::user("guest-growth-crash").unwrap();
        let id = {
            let mut ledger =
                Runtime::open(Store::open(&path).unwrap(), empty_generation()).unwrap();
            let id = ledger
                .begin_asset_charged(AssetKind::Image, &guest, 0, 1)
                .unwrap();
            ledger.reserve_asset_finalized_bytes(&id, 7).unwrap();
            let blobs = FileBlobStore::open(&root).unwrap();
            assert_eq!(blobs.put(&id, &mut Cursor::new(b"1234567")).unwrap(), 7);
            id
        };

        let mut reopened = Runtime::open(Store::open(&path).unwrap(), empty_generation()).unwrap();
        let row = reopened.store().asset(&id).unwrap().unwrap();
        assert_eq!(row.state, snapback2_core::AssetState::Receiving);
        assert_eq!(row.bytes, Some(7));
        assert_eq!(
            reopened.asset_staging_usage(&guest).unwrap().creator.bytes,
            7
        );
        assert_eq!(
            reopened
                .begin_asset_charged(
                    AssetKind::Image,
                    &guest,
                    1,
                    snapback2_core::STAGING_PER_PRINCIPAL_BYTES - 1,
                )
                .unwrap_err()
                .code(),
            "E_ASSET_TOO_LARGE"
        );
        let blobs = FileBlobStore::open(&root).unwrap();
        assert_eq!(blobs.get(&id, None).unwrap().total, 7);
        fs::remove_dir_all(root).unwrap();
    }
}
