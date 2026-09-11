//! Fork-aware deletion of server-owned asset bytes.

use crate::asset_http::IMAGE_WIDTH_RUNGS;
use crate::blob_store::BlobStore;
use crate::protocol::Refusal;
use rusqlite::{Connection, OpenFlags};
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

pub struct AssetSweep {
    pub remaining: BTreeSet<String>,
    pub refusal: Option<Refusal>,
}

pub struct BlobPage {
    pub keys: Vec<String>,
    pub continuation: Option<String>,
}

// @ref LLP 1006#9a-where-bytes-live-author-ruling-2026-09-03 — fork
// referrers are checked in bounded directory pages against bounded id pages.
pub struct ForkReferenceScan {
    entries: Option<fs::ReadDir>,
    candidates: BTreeSet<String>,
    referenced: BTreeSet<String>,
}

/// Delete every possible immutable key for one bounded reclaim page. Candidates
/// survive while an active media job or the completed fork page names them.
// @ref LLP 1006#9a-where-bytes-live-author-ruling-2026-09-03 — immutable
// blobs are shared by fork snapshots, so every fork ledger is a referrer.
pub fn sweep_reclaimed_asset_blobs(
    blobs: &dyn BlobStore,
    reclaimed_ids: &BTreeSet<String>,
    active_ids: &BTreeSet<String>,
    fork_ids: &BTreeSet<String>,
) -> Result<AssetSweep, Refusal> {
    let mut remaining = BTreeSet::new();
    let mut refusal = None;
    for id in reclaimed_ids {
        if active_ids.contains(id) || fork_ids.contains(id) {
            remaining.insert(id.clone());
            continue;
        }
        for key in std::iter::once(id.clone()).chain(
            IMAGE_WIDTH_RUNGS
                .iter()
                .map(|width| format!("{id}.w{width}")),
        ) {
            if let Err(error) = blobs.delete(&key) {
                remaining.insert(id.clone());
                refusal.get_or_insert(error);
            }
        }
    }
    Ok(AssetSweep { remaining, refusal })
}

/// Inspect one bounded physical-store page. The blob store's opaque
/// continuation owns the directory iterator, so each call inspects at most
/// `limit` entries without materializing the directory.
pub fn enumerate_blob_page(
    blobs: &dyn BlobStore,
    continuation: Option<&str>,
    limit: usize,
) -> Result<BlobPage, Refusal> {
    let mut keys = Vec::new();
    let continuation = blobs.enumerate_page("", continuation, limit, &mut |key| {
        keys.push(key.to_owned());
        Ok(())
    })?;
    Ok(BlobPage { keys, continuation })
}

pub fn delete_orphan_blob_keys(
    blobs: &dyn BlobStore,
    keys: &[String],
    active_ids: &BTreeSet<String>,
    fork_ids: &BTreeSet<String>,
) -> Option<Refusal> {
    let mut refusal = None;
    for key in keys {
        let id = key.split_once(".w").map_or(key.as_str(), |(id, _)| id);
        if !active_ids.contains(id)
            && !fork_ids.contains(id)
            && let Err(error) = blobs.delete(key)
        {
            refusal.get_or_insert(error);
        }
    }
    refusal
}

impl ForkReferenceScan {
    pub fn open(root: &Path, candidates: BTreeSet<String>) -> Result<Self, Refusal> {
        let directory = root.join(".snapback/forks");
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => Some(entries),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                return Err(asset_io(format!(
                    "cannot inspect fork ledgers in {}: {error}",
                    directory.display()
                )));
            }
        };
        Ok(Self {
            entries,
            candidates,
            referenced: BTreeSet::new(),
        })
    }

    /// Inspect at most `limit` fork-directory entries. Each candidate page is
    /// fixed-size, so point queries per entry are bounded too.
    pub fn advance(&mut self, limit: usize) -> Result<Option<BTreeSet<String>>, Refusal> {
        if limit == 0 {
            return Err(asset_io("fork reference page limit must be positive"));
        }
        let Some(_) = &self.entries else {
            return Ok(Some(self.referenced.clone()));
        };
        for _ in 0..limit {
            let next = self.entries.as_mut().expect("fork entries").next();
            let Some(entry) = next else {
                self.entries = None;
                return Ok(Some(self.referenced.clone()));
            };
            let entry =
                entry.map_err(|error| asset_io(format!("cannot inspect a fork: {error}")))?;
            self.inspect(&entry.path())?;
        }
        Ok(None)
    }

    fn inspect(&mut self, path: &Path) -> Result<(), Refusal> {
        if path.extension().and_then(|value| value.to_str()) != Some("sqlite") {
            return Ok(());
        }
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| asset_io(format!("cannot inspect {}: {error}", path.display())))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(asset_io(format!(
                "fork ledger {} is not a regular file",
                path.display()
            )));
        }
        let connection = Connection::open_with_flags(
            path,
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
            return Ok(());
        }
        for id in &self.candidates {
            let referenced = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM _assets WHERE id = ?1)",
                    [id],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(|error| {
                    asset_io(format!("cannot read fork {}: {error}", path.display()))
                })?;
            if referenced {
                self.referenced.insert(id.clone());
            }
        }
        Ok(())
    }
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
    const SIBLING_ID: &str = "s2id-00000000000000000000000000000006-0000000000000002";

    fn fork_ids(root: &Path, candidates: BTreeSet<String>) -> BTreeSet<String> {
        let mut scan = ForkReferenceScan::open(root, candidates).unwrap();
        loop {
            if let Some(ids) = scan.advance(2).unwrap() {
                return ids;
            }
        }
    }

    struct FirstDeleteFails {
        deleted: std::sync::Mutex<Vec<String>>,
    }

    impl BlobStore for FirstDeleteFails {
        fn put(&self, _key: &str, _source: &mut dyn std::io::Read) -> Result<u64, Refusal> {
            unreachable!("deletion test does not publish")
        }

        fn get(
            &self,
            _key: &str,
            _range: Option<crate::blob_store::ByteRange>,
        ) -> Result<crate::blob_store::BlobRead, Refusal> {
            unreachable!("deletion test does not read")
        }

        fn delete(&self, key: &str) -> Result<(), Refusal> {
            if key == ID {
                return Err(asset_io("injected first deletion failure"));
            }
            self.deleted.lock().unwrap().push(key.to_owned());
            Ok(())
        }

        fn enumerate_page(
            &self,
            _prefix: &str,
            _continuation: Option<&str>,
            _limit: usize,
            visitor: &mut dyn FnMut(&str) -> Result<(), Refusal>,
        ) -> Result<Option<String>, Refusal> {
            visitor(ID)?;
            visitor(SIBLING_ID)?;
            Ok(None)
        }
    }

    #[test]
    fn one_delete_failure_retains_that_id_but_settles_later_siblings() {
        let blobs = FirstDeleteFails {
            deleted: std::sync::Mutex::new(Vec::new()),
        };
        let ids = BTreeSet::from([ID.to_owned(), SIBLING_ID.to_owned()]);
        let result =
            sweep_reclaimed_asset_blobs(&blobs, &ids, &BTreeSet::new(), &BTreeSet::new()).unwrap();
        assert_eq!(result.refusal.unwrap().code, "E_OWNER_ASSET_IO");
        assert_eq!(result.remaining, BTreeSet::from([ID.to_owned()]));
        assert!(
            blobs
                .deleted
                .lock()
                .unwrap()
                .contains(&SIBLING_ID.to_owned())
        );
    }

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
        let referenced = fork_ids(&root, candidates.clone());
        assert_eq!(
            sweep_reclaimed_asset_blobs(&blobs, &candidates, &BTreeSet::new(), &referenced,)
                .unwrap()
                .remaining,
            candidates
        );
        assert!(blobs.path_for_key(ID).unwrap().exists());
        assert!(blobs.path_for_key(&format!("{ID}.w256")).unwrap().exists());

        fs::remove_file(root.join(".snapback/forks/kept.sqlite")).unwrap();
        assert!(
            sweep_reclaimed_asset_blobs(
                &blobs,
                &candidates,
                &BTreeSet::new(),
                &fork_ids(&root, candidates.clone()),
            )
            .unwrap()
            .remaining
            .is_empty()
        );
        assert!(!blobs.path_for_key(ID).unwrap().exists());
        assert!(!blobs.path_for_key(&format!("{ID}.w256")).unwrap().exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fork_reference_scan_has_a_fixed_directory_page() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("snapback2-fork-page-{stamp}"));
        fs::create_dir_all(root.join(".snapback/forks")).unwrap();
        for index in 0..17 {
            let fork = Connection::open(
                root.join(".snapback/forks")
                    .join(format!("fork-{index:02}.sqlite")),
            )
            .unwrap();
            fork.execute("CREATE TABLE _assets (id TEXT PRIMARY KEY)", [])
                .unwrap();
            if index == 16 {
                fork.execute("INSERT INTO _assets (id) VALUES (?1)", [ID])
                    .unwrap();
            }
        }
        let mut scan = ForkReferenceScan::open(&root, BTreeSet::from([ID.to_owned()])).unwrap();
        assert!(scan.advance(8).unwrap().is_none());
        assert!(scan.advance(8).unwrap().is_none());
        assert_eq!(
            scan.advance(8).unwrap(),
            Some(BTreeSet::from([ID.to_owned()]))
        );
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
            sweep_reclaimed_asset_blobs(
                &blobs,
                &BTreeSet::from([id.clone()]),
                &BTreeSet::new(),
                &BTreeSet::new(),
            )
            .unwrap()
            .remaining
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
        let mut continuation = None;
        loop {
            let page = enumerate_blob_page(&blobs, continuation.as_deref(), 1).unwrap();
            let candidates = page
                .keys
                .iter()
                .map(|key| {
                    key.split_once(".w")
                        .map_or(key.as_str(), |(id, _)| id)
                        .to_owned()
                })
                .collect();
            delete_orphan_blob_keys(
                &blobs,
                &page.keys,
                &BTreeSet::new(),
                &fork_ids(&root, candidates),
            );
            continuation = page.continuation;
            if continuation.is_none() {
                break;
            }
        }
        let mut found = Vec::new();
        let mut continuation = None;
        loop {
            continuation = blobs
                .enumerate_page("", continuation.as_deref(), 1, &mut |key| {
                    found.push(key.to_owned());
                    Ok(())
                })
                .unwrap();
            if continuation.is_none() {
                break;
            }
        }
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
