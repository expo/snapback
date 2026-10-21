//! One asset contract on both stores; attach, cache and head-fence witnesses here.
// @ref LLP 3000.009.001.000#9.1 — real adapter operations with observable physical contention.
use super::super::{
    PostgresEngine, WriteMode,
    store::{Store, Tx},
};
use crate::{
    RuntimeError,
    assets::{
        self, Asset, AssetIntentReader, AssetTransaction,
        test_cases::{self, Ledger},
    },
    schema::Schema,
    store::test_race::FenceRace,
};
use postgres::{Client, NoTls};
use std::{cell::RefCell, sync::Arc};

fn client() -> Client {
    let url=std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES; run scripts/test-postgres.sh");
    Client::connect(&url, NoTls).expect("connect to explicitly selected evaluation cluster")
}
fn engine() -> PostgresEngine {
    PostgresEngine::create(
        client(),
        &format!("sb4_eval_assets_{:x}", crate::ids::seed()),
        Schema::default(),
        [],
    )
    .unwrap()
}
fn name(store: &mut Store) -> String {
    store
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0)
}
fn run(case: impl FnOnce(&Tx<'_>)) {
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    case(&tx);
    tx.rollback().unwrap();
}
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
        self.query(
            "SELECT at FROM _asset_views WHERE asset=$1 AND principal=$2",
            &[&id, &p],
        )
        .unwrap()
        .first()
        .map(|r| r.get(0))
    }
    fn stale(&self, now: i64) -> Vec<Asset> {
        self.stale_assets(now).unwrap()
    }
    fn stage(&self, now: i64, b: std::time::Duration) -> Vec<Asset> {
        self.stage_stale_assets_for(now, b).unwrap()
    }
    fn forget(&self, id: &str) {
        self.forget_asset(id).unwrap();
    }
    fn executed(&self, owner: &str, id: &str) {
        self.record_applied(owner, id, 1, "{}", "save", "digest", 0)
            .unwrap();
    }
}

#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_shared_declarations_and_rollback() {
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.record(&test_cases::asset("upload")).unwrap();
    tx.declare_intent("alice", "declared", "original", "{}")
        .unwrap();
    tx.commit().unwrap();
    test_cases::reader_is_owner_scoped(&RefCell::new(&mut e.store));
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    test_cases::declarations_and_tombstones(&tx);
    tx.rollback().unwrap();
    let tx = e.store.transaction(None).unwrap();
    assert_eq!(
        tx.intent_declaration("alice", "declared")
            .unwrap()
            .unwrap()
            .state,
        "declared"
    );
    assert!(!tx.asset_intent_exists("alice", "tombstone").unwrap());
}
#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_shared_quota_recovery() {
    run(|tx| {
        test_cases::seed_quota_recovery(tx);
        test_cases::quota_and_recovery(tx);
    });
}
#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_shared_exact_quota_wide_integers() {
    run(|tx| test_cases::exact_quota_and_wide_integers(tx));
}
#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_shared_byte_order() {
    run(|tx| test_cases::inventory_byte_order(tx));
}
#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_shared_placement_replay() {
    run(|tx| test_cases::placement_and_replay(tx));
}
#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_shared_nulls_absence() {
    run(|tx| test_cases::nulls_and_absence(tx));
}
#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_shared_missing_required_state() {
    run(|tx| test_cases::missing_cancellation_state(tx));
}
#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_shared_nul_admission() {
    run(|tx| test_cases::nul_admission(tx));
}
#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_shared_collection_bounds() {
    run(|tx| test_cases::collection_bounds(tx));
}
#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_shared_statement_error_rolls_back() {
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    test_cases::duplicate_declaration_is_terminal(&tx);
    drop(tx);
    let tx = e.store.transaction(None).unwrap();
    assert!(!tx.asset_intent_exists("alice", "duplicate").unwrap());
}
#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_shared_aggregate_overflow_rolls_back() {
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    test_cases::aggregate_overflow_is_terminal(&tx);
    drop(tx);
    let tx = e.store.transaction(None).unwrap();
    assert!(tx.asset("max").unwrap().is_none());
    assert!(!tx.asset_intent_exists("alice", "max").unwrap());
}
#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_shared_partial_legacy_row() {
    run(|tx| {
        tx.record(&test_cases::asset("legacy")).unwrap();
        tx.batch("UPDATE _assets SET kind='future-kind',bytes=-1,width=-1,height=NULL,duration=-1,home_table='docs',home_id=NULL,home_column='doc' WHERE id='legacy'").unwrap();
        test_cases::partial_legacy_row(tx);
    });
}

fn race(cancel_first: bool) {
    let mut e = engine();
    let name = name(&mut e.store);
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.declare_intent("alice", "race", "fp", "{}").unwrap();
    tx.commit().unwrap();
    let mut engines = [
        PostgresEngine::open(client(), &name).unwrap(),
        PostgresEngine::open(client(), &name).unwrap(),
    ];
    let (holder, contender) = engines.split_at_mut(1);
    let race = Arc::new(FenceRace::postgres(
        &mut holder[0].store.client,
        &mut contender[0].store.client,
        client(),
    ));
    let handles: Vec<_> = engines
        .into_iter()
        .enumerate()
        .map(|(n, mut e)| {
            let race = race.clone();
            std::thread::spawn(move || {
                let tx = e
                    .store
                    .transaction_with_begin_hook(Some(WriteMode::Serialized), || {
                        race.after_begin(n == 0)
                    })
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
    let tx = e.store.transaction(None).unwrap();
    assert!(tx.intent_cancelled("alice", "race").unwrap());
    assert_eq!(tx.asset("race-asset").unwrap().is_some(), !cancel_first);
    assert!(tx.pending_intents("alice", "").unwrap().is_empty());
    assert_eq!(tx.pinned_asset_bytes("alice").unwrap(), 0);
}
#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_cancel_blocks_publication() {
    race(true);
}
#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_publication_then_cancel() {
    race(false);
}

#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_nul_lookups_do_not_query() {
    let mut e = engine();
    let tx = e.store.transaction(None).unwrap();
    let calls = tx.calls.get();
    assert!(!tx.asset_intent_exists("alice", "i\0d").unwrap());
    assert!(!tx.asset_intent_exists("a\0b", "id").unwrap());
    assert!(tx.intent_declaration("alice", "i\0d").unwrap().is_none());
    assert!(tx.intent_placement("a\0b", "id").unwrap().is_none());
    assert!(tx.replay_record("alice", "i\0d").unwrap().is_none());
    assert!(tx.placement_record("a\0b", "id").unwrap().is_none());
    assert!(tx.asset("a\0b").unwrap().is_none());
    assert!(!tx.asset_reserved("a\0b").unwrap());
    assert!(!tx.asset_viewed("ok", "a\0b").unwrap());
    assert!(!tx.mutation_executed("alice", "i\0d").unwrap());
    assert_eq!(tx.pinned_asset_bytes("a\0b").unwrap(), 0);
    assert!(tx.pending_intents("a\0b", "").unwrap().is_empty());
    assert!(matches!(
        tx.intent_cancelled("alice", "i\0d"),
        Err(RuntimeError::Sql(rusqlite::Error::QueryReturnedNoRows))
    ));
    assert_eq!(tx.calls.get(), calls);
    tx.rollback().unwrap();
    let calls = e.store.calls.get();
    assert!(
        !RefCell::new(&mut e.store)
            .asset_intent_exists("a\0b", "id")
            .unwrap()
    );
    assert_eq!(e.store.calls.get(), calls);
}

#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_writes_require_serialized_head() {
    let mut e = engine();
    for mode in [None, Some(WriteMode::Serializable)] {
        for operation in 0..9 {
            let tx = e.store.transaction(mode).unwrap();
            let error = match operation {
                0 => tx
                    .record_asset(&test_cases::asset("forbidden"))
                    .unwrap_err(),
                1 => tx
                    .declare_intent("alice", "forbidden", "fp", "{}")
                    .unwrap_err(),
                2 => tx
                    .record_uploaded_intent(&assets::UploadedIntent {
                        owner: "alice",
                        id: "forbidden",
                        fingerprint: "fp",
                        asset: "a",
                        facts: "{}",
                        placement: None,
                    })
                    .unwrap_err(),
                3 => tx.cancel_intent("alice", "forbidden").unwrap_err(),
                4 => tx.settle_intent("alice", "forbidden").unwrap_err(),
                5 => tx.place_asset("a", "t", "r", "c").unwrap_err(),
                6 => tx.release_asset("a", "t", "r", "c", 1).unwrap_err(),
                7 => tx.record_asset_view("a", "alice", 1).unwrap_err(),
                8 => tx
                    .stage_stale_assets_for(100, std::time::Duration::MAX)
                    .unwrap_err(),
                _ => unreachable!(),
            };
            assert!(
                error.to_string().contains("serialized shared-head fence"),
                "{error}"
            );
            tx.rollback().unwrap();
        }
        let tx = e.store.transaction(mode).unwrap();
        assert!(
            tx.forget_asset("a")
                .unwrap_err()
                .to_string()
                .contains("serialized shared-head fence")
        );
        tx.rollback().unwrap();
    }
}

#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_attach_installs_missing_tables_and_reopens_under_reader() {
    let mut e = engine();
    let name = name(&mut e.store);
    e.store
        .client
        .batch_execute("DROP TABLE _assets,_asset_intents,_asset_views,_asset_gc")
        .unwrap();
    drop(e);
    let mut e = PostgresEngine::open(client(), &name).unwrap();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.record(&test_cases::asset("kept")).unwrap();
    tx.declare_intent("alice", "kept", "fp", "{}").unwrap();
    tx.commit().unwrap();
    // A no-op ALTER in attach would block on this ordinary AccessShareLock.
    let reader = e.store.transaction(None).unwrap();
    assert!(reader.asset("kept").unwrap().is_some());
    assert!(reader.asset_intent_exists("alice", "kept").unwrap());
    assert!(!reader.asset_viewed("kept", "alice").unwrap());
    assert!(!reader.asset_reserved("kept").unwrap());
    let mut reopened = PostgresEngine::open(client(), &name).unwrap();
    assert!(
        RefCell::new(&mut reopened.store)
            .asset_intent_exists("alice", "kept")
            .unwrap()
    );
    reader.rollback().unwrap();
}

#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_cached_reads_survive_additive_columns() {
    let mut e = engine();
    let name = name(&mut e.store);
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.record(&test_cases::asset("cached")).unwrap();
    test_cases::upload(&tx, "alice", "cached", "cached", "{}");
    tx.view("cached", "alice", 1).unwrap();
    tx.stage(assets::UNCLAIMED_TTL_MS + 2, std::time::Duration::ZERO);
    tx.commit().unwrap();
    let tx = e.store.transaction(None).unwrap();
    test_cases::cached_read_contract(&tx);
    tx.rollback().unwrap();
    let mut peer = client();
    peer.batch_execute(&format!("SET search_path={name},pg_catalog; ALTER TABLE _assets ADD COLUMN future TEXT; ALTER TABLE _asset_intents ADD COLUMN future TEXT; ALTER TABLE _asset_views ADD COLUMN future TEXT; ALTER TABLE _asset_gc ADD COLUMN future TEXT")).unwrap();
    let tx = e.store.transaction(None).unwrap();
    test_cases::cached_read_contract(&tx);
    tx.rollback().unwrap();
}

#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_writers_take_no_ddl_locks() {
    let mut e = engine();
    let name = name(&mut e.store);
    let mut peer = PostgresEngine::open(client(), &name).unwrap();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.record(&test_cases::asset("held")).unwrap();
    test_cases::upload(&tx, "alice", "held", "held", "{}");
    tx.view("held", "alice", 1).unwrap();
    tx.record(&test_cases::asset("collected")).unwrap();
    assert_eq!(
        tx.stage(assets::UNCLAIMED_TTL_MS + 2, std::time::Duration::MAX)
            .len(),
        1
    );
    tx.forget("collected");
    tx.place_asset("held", "docs", "r", "doc").unwrap();
    tx.release_asset("held", "docs", "r", "doc", 2).unwrap();
    tx.declare_intent("alice", "declared", "fp", "{}").unwrap();
    tx.cancel_intent("alice", "declared").unwrap();
    tx.settle_intent("alice", "declared").unwrap();
    // Compatible relation locks must still be obtainable from another
    // connection while all four ledger operations retain their transaction.
    let mut reader = peer.store.client.transaction().unwrap();
    reader.batch_execute("SET LOCAL lock_timeout='250ms'; LOCK TABLE _assets,_asset_intents,_asset_views,_asset_gc IN ROW EXCLUSIVE MODE").unwrap();
    reader.rollback().unwrap();
    tx.rollback().unwrap();
}

#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_attach_refuses_incompatible_shapes_by_name() {
    for (table, ddl) in [
        (
            "_assets",
            "ALTER TABLE _assets ALTER COLUMN bytes TYPE INTEGER",
        ),
        (
            "_assets",
            "ALTER TABLE _assets ALTER COLUMN owner DROP NOT NULL",
        ),
        (
            "_assets",
            "ALTER TABLE _assets ALTER COLUMN id TYPE TEXT COLLATE \"POSIX\"",
        ),
        ("_assets", "ALTER TABLE _assets ADD COLUMN future TEXT"),
        (
            "_assets",
            "ALTER TABLE _assets ALTER COLUMN bytes SET DEFAULT 0",
        ),
        ("_assets", "ALTER TABLE _assets ADD CHECK(bytes>0)"),
        (
            "_assets",
            "CREATE UNIQUE INDEX wrong_unique ON _assets(owner)",
        ),
        ("_assets", "ALTER TABLE _assets ENABLE ROW LEVEL SECURITY"),
        (
            "_asset_intents",
            "ALTER TABLE _asset_intents DROP COLUMN placement",
        ),
        (
            "_asset_intents",
            "ALTER TABLE _asset_intents DROP CONSTRAINT _asset_intents_pkey; ALTER TABLE _asset_intents ADD PRIMARY KEY(intent,owner)",
        ),
        (
            "_asset_intents",
            "ALTER TABLE _asset_intents DROP CONSTRAINT _asset_intents_pkey; ALTER TABLE _asset_intents ADD PRIMARY KEY(owner,intent) DEFERRABLE",
        ),
        (
            "_asset_views",
            "ALTER TABLE _asset_views ALTER COLUMN at TYPE TEXT",
        ),
        (
            "_asset_views",
            "ALTER TABLE _asset_views RENAME TO old_views; CREATE VIEW _asset_views AS SELECT asset,principal,at FROM old_views",
        ),
        (
            "_asset_gc",
            "ALTER TABLE _asset_gc ALTER COLUMN asset TYPE TEXT COLLATE \"POSIX\"",
        ),
    ] {
        let mut e = engine();
        let name = name(&mut e.store);
        e.store.client.batch_execute(ddl).unwrap();
        drop(e);
        let error = PostgresEngine::open(client(), &name)
            .err()
            .expect("incompatible storage must refuse");
        assert!(
            error.to_string().contains("SNAPBACK_ASSET_SCHEMA"),
            "{ddl}: {error}"
        );
        assert!(error.to_string().contains(table), "{error}");
    }
}

#[test]
#[ignore = "SKIP_POSTGRES_ASSETS_DATABASE: requires private SNAPBACK4_EVAL_POSTGRES"]
fn asset_snapshot_and_committed_reopen() {
    let mut e = engine();
    let name = name(&mut e.store);
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.record(&test_cases::asset("snapshot")).unwrap();
    test_cases::upload(&tx, "alice", "snapshot", "snapshot", "{}");
    tx.commit().unwrap();
    let mut peer = PostgresEngine::open(client(), &name).unwrap();
    let reader = e.store.transaction(None).unwrap();
    assert_eq!(reader.pinned_asset_bytes("alice").unwrap(), 10);
    let tx = peer.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.cancel_intent("alice", "snapshot").unwrap();
    tx.commit().unwrap();
    assert!(!reader.intent_cancelled("alice", "snapshot").unwrap());
    assert_eq!(reader.pinned_asset_bytes("alice").unwrap(), 10);
    reader.rollback().unwrap();
    drop(peer);
    let mut reopened = PostgresEngine::open(client(), &name).unwrap();
    let tx = reopened.store.transaction(None).unwrap();
    assert!(tx.intent_cancelled("alice", "snapshot").unwrap());
    assert_eq!(tx.pinned_asset_bytes("alice").unwrap(), 0);
}
