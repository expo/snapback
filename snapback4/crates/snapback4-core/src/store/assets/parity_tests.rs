//! The asset contract on SQLite, including pre-upgrade NUL rows.
// @ref LLP 3000.009.001.000#9.1 — shared cases and adapter-driven observable contention.
use super::*;
use crate::assets::{
    self, AssetIntentReader, AssetTransaction, UNCLAIMED_TTL_MS,
    test_cases::{self, Ledger},
};
use crate::store::test_race::FenceRace;
use std::sync::Arc;

impl Ledger for Tx<'_> {
    fn record(&self, a: &Asset) -> Result<(), RuntimeError> {
        self.record_asset(a)
    }
    fn release(&self, id: &str, t: &str, r: &str, c: &str, now: i64) -> Result<(), RuntimeError> {
        self.release_asset(id, t, r, c, now)
    }
    fn viewed(&self, id: &str, p: &str) -> Result<bool, RuntimeError> {
        self.asset_viewed(id, p)
    }
    fn view(&self, id: &str, p: &str, now: i64) -> Result<(), RuntimeError> {
        self.record_asset_view(id, p, now)
    }
    fn view_at(&self, id: &str, p: &str) -> Option<i64> {
        self.conn()
            .query_row(
                "SELECT at FROM _asset_views WHERE asset=?1 AND principal=?2",
                [id, p],
                |r| r.get(0),
            )
            .optional()
            .unwrap()
    }
    fn stale(&self, now: i64) -> Vec<Asset> {
        super::stale(self.conn(), now).unwrap()
    }
    fn stage(&self, now: i64, b: std::time::Duration) -> Vec<Asset> {
        self.stage_stale_assets_for(now, b).unwrap()
    }
    fn forget(&self, id: &str) {
        self.forget_asset(id).unwrap();
    }
    fn executed(&self, owner: &str, id: &str) {
        self.record_applied(owner, id, 1, "{}").unwrap();
    }
}

fn run(case: impl FnOnce(&Tx<'_>)) {
    let mut store = Store::memory().unwrap();
    let tx = store.transaction().unwrap();
    case(&tx);
    tx.rollback().unwrap();
}

#[test]
fn asset_shared_declarations_and_rollback() {
    let mut store = Store::memory().unwrap();
    let tx = store.transaction().unwrap();
    tx.record(&test_cases::asset("upload")).unwrap();
    tx.declare_intent("alice", "declared", "original", "{}")
        .unwrap();
    test_cases::declarations_and_tombstones(&tx);
    tx.rollback().unwrap();
    assert!(!store.asset_intent_exists("alice", "declared").unwrap());
    assert!(store.asset("upload").unwrap().is_none());
}
#[test]
fn asset_shared_quota_recovery() {
    run(|tx| {
        test_cases::seed_quota_recovery(tx);
        test_cases::quota_and_recovery(tx);
    });
}
#[test]
fn asset_shared_exact_quota_wide_integers() {
    run(|tx| test_cases::exact_quota_and_wide_integers(tx));
}
#[test]
fn asset_shared_byte_order() {
    run(|tx| test_cases::inventory_byte_order(tx));
}
#[test]
fn asset_shared_placement_replay() {
    run(|tx| test_cases::placement_and_replay(tx));
}
#[test]
fn asset_shared_nulls_absence() {
    run(|tx| test_cases::nulls_and_absence(tx));
}
#[test]
fn asset_shared_missing_required_state() {
    run(|tx| test_cases::missing_cancellation_state(tx));
}
#[test]
fn asset_shared_nul_admission() {
    run(|tx| test_cases::nul_admission(tx));
}
#[test]
fn asset_shared_collection_bounds() {
    run(|tx| test_cases::collection_bounds(tx));
}
#[test]
fn asset_shared_statement_error_rolls_back() {
    let mut store = Store::memory().unwrap();
    let tx = store.transaction().unwrap();
    test_cases::duplicate_declaration_is_terminal(&tx);
    drop(tx);
    assert!(!store.asset_intent_exists("alice", "duplicate").unwrap());
}
#[test]
fn asset_shared_aggregate_overflow_rolls_back() {
    let mut store = Store::memory().unwrap();
    let tx = store.transaction().unwrap();
    test_cases::aggregate_overflow_is_terminal(&tx);
    drop(tx);
    assert!(store.asset("max").unwrap().is_none());
    assert!(!store.asset_intent_exists("alice", "max").unwrap());
}

fn race(cancel_first: bool) {
    let dir = std::env::temp_dir().join(format!("sb4-assets-{:x}", crate::ids::seed()));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("assets.sqlite");
    let mut store = Store::open(&path).unwrap();
    let tx = store.transaction().unwrap();
    tx.declare_intent("alice", "race", "fp", "{}").unwrap();
    tx.commit().unwrap();
    let stores = [Store::open(&path).unwrap(), Store::open(&path).unwrap()];
    let race = Arc::new(FenceRace::sqlite());
    let handles: Vec<_> = stores
        .into_iter()
        .enumerate()
        .map(|(n, mut s)| {
            let race = race.clone();
            std::thread::spawn(move || {
                if n == 1 {
                    race.install_sqlite_busy_handler(s.conn());
                }
                let tx = s
                    .transaction_with_begin_hook(true, || race.after_begin(n == 0))
                    .unwrap();
                race.after_fence(n == 0).unwrap();
                let published =
                    test_cases::race_step(&tx, if n == 0 { cancel_first } else { !cancel_first });
                tx.commit().unwrap();
                published
            })
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(
        results,
        if cancel_first {
            vec![false, false]
        } else {
            vec![true, false]
        }
    );
    let tx = store.transaction().unwrap();
    assert!(tx.intent_cancelled("alice", "race").unwrap());
    assert_eq!(tx.asset("race-asset").unwrap().is_some(), !cancel_first);
    assert!(tx.pending_intents("alice", "").unwrap().is_empty());
    assert_eq!(tx.pinned_asset_bytes("alice").unwrap(), 0);
    tx.rollback().unwrap();
    drop(store);
    std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn asset_cancel_blocks_publication() {
    race(true);
}
#[test]
fn asset_publication_then_cancel() {
    race(false);
}

#[test]
fn asset_legacy_sqlite_nul_keys_remain_addressable() {
    let mut store = Store::memory().unwrap();
    let tx = store.transaction().unwrap();
    let (owner, id, asset_id) = ("ali\0ce", "in\0tent", "up\0load");
    let mut a = test_cases::asset(asset_id);
    a.owner = owner.into();
    let facts = crate::json_codec::to_text(&a).unwrap();
    tx.conn().execute("INSERT INTO _assets(id,owner,kind,content_type,bytes,created_at) VALUES(?1,?2,'file','application/pdf',10,1)",[asset_id,owner]).unwrap();
    tx.conn().execute("INSERT INTO _asset_intents(owner,intent,fingerprint,placement,state) VALUES(?1,?2,?3,'{}','declared')",[owner,id,"f\0p"]).unwrap();
    tx.record_uploaded_intent(&UploadedIntent {
        owner,
        id,
        fingerprint: "ignored",
        asset: asset_id,
        facts: &facts,
        placement: None,
    })
    .unwrap();
    assert!(tx.asset_intent_exists(owner, id).unwrap());
    assert_eq!(
        assets::replay_intent(&tx, owner, id, "f\0p").unwrap(),
        Some(a)
    );
    assert_eq!(tx.pinned_asset_bytes(owner).unwrap(), 10);
    let inventory = tx.pending_intents(owner, "").unwrap();
    assert_eq!(inventory[0].id, id);
    assert!(tx.pending_intents(owner, id).unwrap().is_empty());
    assert!(tx.stale(UNCLAIMED_TTL_MS + 2).is_empty());
    assets::claim_asset(&tx, asset_id, owner, "docs", "r", "doc").unwrap();
    tx.release_asset(asset_id, "docs", "r", "doc", 2).unwrap();
    tx.conn()
        .execute(
            "INSERT INTO _asset_views(asset,principal,at) VALUES(?1,?2,1)",
            [asset_id, owner],
        )
        .unwrap();
    assert!(tx.asset_viewed(asset_id, owner).unwrap());
    tx.record_asset_view(asset_id, owner, 99).unwrap();
    assert_eq!(tx.view_at(asset_id, owner), Some(1));
    tx.settle_intent(owner, id).unwrap();
    tx.cancel_intent(owner, id).unwrap();
    tx.settle_intent(owner, id).unwrap();
    assert!(tx.intent_cancelled(owner, id).unwrap());
    let staged = tx.stage(UNCLAIMED_TTL_MS + 2, std::time::Duration::MAX);
    assert_eq!(staged[0].id, asset_id);
    assert!(tx.asset_reserved(asset_id).unwrap());
    tx.forget_asset(asset_id).unwrap();
    assert!(tx.asset(asset_id).unwrap().is_none());
    assert!(!tx.asset_reserved(asset_id).unwrap());
    assert!(!tx.asset_viewed(asset_id, owner).unwrap());
    assert!(tx.asset_intent_exists(owner, id).unwrap());
    tx.commit().unwrap();
    assert!(store.asset_intent_exists(owner, id).unwrap());
}

#[test]
fn asset_shared_partial_legacy_row() {
    run(|tx| {
        tx.record(&test_cases::asset("legacy")).unwrap();
        tx.conn().execute_batch("UPDATE _assets SET kind='future-kind',bytes=-1,width=-1,height=NULL,duration=-1,home_table='docs',home_id=NULL,home_column='doc' WHERE id='legacy'").unwrap();
        test_cases::partial_legacy_row(tx);
    });
}

#[test]
fn asset_shared_reads_survive_additive_columns() {
    run(|tx| {
        tx.record(&test_cases::asset("cached")).unwrap();
        test_cases::upload(tx, "alice", "cached", "cached", "{}");
        tx.record_asset_view("cached", "alice", 1).unwrap();
        test_cases::cached_read_contract(tx);
        tx.conn().execute_batch("ALTER TABLE _assets ADD COLUMN future TEXT; ALTER TABLE _asset_intents ADD COLUMN future TEXT; ALTER TABLE _asset_views ADD COLUMN future TEXT; ALTER TABLE _asset_gc ADD COLUMN future TEXT").unwrap();
        test_cases::cached_read_contract(tx);
    });
}

#[test]
fn asset_shared_stale_cutoff_boundaries() {
    run(|tx| test_cases::stale_cutoff_boundaries(tx));
}

#[test]
fn asset_shared_intermediate_aggregate_overflow_rolls_back() {
    let mut store = Store::memory().unwrap();
    let tx = store.transaction().unwrap();
    test_cases::intermediate_aggregate_overflow_is_terminal(&tx);
    drop(tx);
    assert!(store.asset("a_max").unwrap().is_none());
    assert!(!store.asset_intent_exists("alice", "a_max").unwrap());
}

#[test]
fn asset_claim_accepts_an_existing_legacy_nul_home_key() {
    let mut store = Store::memory().unwrap();
    let table = crate::schema::public_table(Default::default(), Default::default());
    let schema = crate::schema::Schema { tables: [("docs".into(), table.clone())].into(), ..Default::default() };
    store.install(&schema).unwrap();
    let tx = store.transaction().unwrap();
    let row_id = "legacy\0row";
    let row = crate::value::object([("id", crate::Value::Id(row_id.into()))]);
    tx.put("docs", &table, &row, None).unwrap();
    tx.record_asset(&test_cases::asset("ordinary-upload")).unwrap();
    assets::claim_asset(&tx, "ordinary-upload", "alice", "docs", row_id, "doc").unwrap();
    assert_eq!(tx.asset("ordinary-upload").unwrap().unwrap().home, Some(("docs".into(), row_id.into(), "doc".into())));
    tx.release_asset("ordinary-upload", "docs", row_id, "doc", 2).unwrap();
    assert_eq!(tx.asset("ordinary-upload").unwrap().unwrap().released_at, Some(2));
    tx.record_asset(&test_cases::asset("new-upload")).unwrap();
    assert_eq!(assets::claim_asset(&tx, "new-upload", "alice", "docs", "new\0row", "doc").unwrap_err().code(), "E_INPUT");
}
