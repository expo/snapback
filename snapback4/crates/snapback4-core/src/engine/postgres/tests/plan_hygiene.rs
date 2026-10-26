//! Schema, integrity and long-lived cold-plan witnesses for the managed tail.
// @ref LLP 3000.009.001.000.002#3.4 — engine-owned integrity replaces the redundant RI trigger.
use super::*;
use crate::{Engine, partition::PartitionRows, store_port::AnyStore};

fn connect() -> Client {
    Client::connect(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private Postgres"),
        postgres::NoTls,
    )
    .unwrap()
}
fn namespace(e: &mut PostgresEngine) -> String {
    e.store
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0)
}
fn assert_integrity(c: &mut Client) {
    assert_eq!(
        c.query_one(
            "SELECT count(*) FROM _log l LEFT JOIN _commits c USING(seq) WHERE c.seq IS NULL",
            &[]
        )
        .unwrap()
        .get::<_, i64>(0),
        0
    );
}
fn assert_no_fk(c: &mut Client) {
    assert_eq!(
        c.query_one(
            "SELECT count(*) FROM pg_constraint WHERE conrelid='_log'::regclass AND contype='f'",
            &[]
        )
        .unwrap()
        .get::<_, i64>(0),
        0
    );
}
const LEGACY: &str =
    "ALTER TABLE _log ADD CONSTRAINT \"legacy log seq\" FOREIGN KEY(seq) REFERENCES _commits(seq)";

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn log_schema_fresh_upgrade_recovery_and_lock_free_reopen() {
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let name = format!("sb4_ph_public_{:x}", crate::ids::seed());
    let mut e = Engine::new_at(
        AnyStore::create_postgres(&url, &name).unwrap(),
        Schema::default(),
        [],
        100,
    )
    .unwrap();
    let id = e.store_id.clone();
    let mut c = connect();
    c.batch_execute(&format!("SET search_path={name},pg_catalog"))
        .unwrap();
    assert_no_fk(&mut c);
    AnyStore::validate_postgres_bootstrap(&url, &name, &id).unwrap();
    c.batch_execute(LEGACY).unwrap();
    // Pending-bootstrap recovery accepts the old complete shape without DDL.
    AnyStore::validate_postgres_bootstrap(&url, &name, &id).unwrap();
    assert_eq!(
        c.query_one(
            "SELECT count(*) FROM pg_constraint WHERE conrelid='_log'::regclass AND contype='f'",
            &[]
        )
        .unwrap()
        .get::<_, i64>(0),
        1
    );
    drop(e);
    e = Engine::open(AnyStore::open_postgres(&url, &name).unwrap()).unwrap();
    assert_no_fk(&mut c);
    // No no-op ALTER on repeated open: a reader's AccessShareLock is held.
    c.batch_execute("BEGIN; SELECT * FROM _log").unwrap();
    drop(Engine::open(AnyStore::open_postgres(&url, &name).unwrap()).unwrap());
    c.batch_execute("ROLLBACK").unwrap();
    drop(e);
    c.batch_execute(&format!("DROP SCHEMA {name} CASCADE"))
        .unwrap();
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn log_schema_refuses_foreign_shapes_and_rolls_back_drops() {
    for ddl in [
        "ALTER TABLE _log ADD FOREIGN KEY(seq) REFERENCES _commits(seq) ON DELETE CASCADE",
        "ALTER TABLE _log ADD FOREIGN KEY(seq) REFERENCES _commits(seq) ON UPDATE CASCADE",
        "ALTER TABLE _log ADD FOREIGN KEY(seq) REFERENCES _commits(seq) DEFERRABLE",
        "ALTER TABLE _log ADD FOREIGN KEY(seq) REFERENCES _commits(seq) NOT VALID",
        "ALTER TABLE _log ADD FOREIGN KEY(seq) REFERENCES _commits(seq) MATCH FULL",
        "CREATE TABLE other(seq bigint PRIMARY KEY); ALTER TABLE _log ADD FOREIGN KEY(seq) REFERENCES other(seq)",
        "ALTER TABLE _log ADD FOREIGN KEY(ord) REFERENCES _commits(seq)",
        "ALTER TABLE _log ADD COLUMN surprise text",
        "ALTER TABLE _log ADD FOREIGN KEY(seq) REFERENCES _commits(seq); ALTER TABLE _log ADD FOREIGN KEY(seq) REFERENCES _commits(seq)",
    ] {
        let mut e = authority_engine();
        let name = namespace(&mut e);
        e.store.client.batch_execute(ddl).unwrap();
        let before = super::refusals::dump(&mut e.store.client);
        assert!(PostgresEngine::open(connect(), &name).is_err(), "{ddl}");
        assert_eq!(super::refusals::dump(&mut e.store.client), before, "{ddl}");
        e.store
            .client
            .batch_execute(&format!("DROP SCHEMA {name} CASCADE"))
            .unwrap();
    }
    let mut e = authority_engine();
    let name = namespace(&mut e);
    e.store.client.batch_execute(LEGACY).unwrap();
    e.store.client.batch_execute("ALTER TABLE _backend DROP COLUMN generation; ALTER TABLE _backend ADD COLUMN generation bigint NOT NULL DEFAULT -1").unwrap();
    let before = super::refusals::dump(&mut e.store.client);
    assert!(PostgresEngine::open(connect(), &name).is_err());
    assert_eq!(
        super::refusals::dump(&mut e.store.client),
        before,
        "later refusal restores the dropped FK"
    );
    e.store
        .client
        .batch_execute(&format!("DROP SCHEMA {name} CASCADE"))
        .unwrap();
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn log_integrity_commit_rollback_prune_and_legacy_conversion() {
    let mut e = authority_engine();
    let name = namespace(&mut e);
    // Reject attempts to buffer a log with no matching commit, before SQL.
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    assert!(
        tx.append_log("public", 1, 0, "notes", "del", "id", None)
            .is_err()
    );
    tx.rollback().unwrap();
    for rollback in [true, false] {
        let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
        for seq in 1..=1001 {
            tx.record_commit(seq, 100, "test", "alice", "mutation", &[], 1)
                .unwrap();
            assert!(
                tx.append_log("public", seq + 1, 0, "notes", "del", "id", None)
                    .is_err()
            );
            tx.append_log("public", seq, 0, "notes", "del", "id", None)
                .unwrap();
            tx.flush_tail().unwrap();
        }
        assert_eq!(tx.query("SELECT min(seq) FROM _change_evidence",&[]).unwrap()[0].get::<_,i64>(0),1,"tails retain evidence until head maintenance");
        tx.prune_evidence_for_test().unwrap();
        assert_eq!(
            tx.query("SELECT min(seq) FROM _change_evidence", &[])
                .unwrap()[0]
                .get::<_, i64>(0),
            2
        );
        assert_eq!(
            tx.query("SELECT count(*) FROM _commits", &[]).unwrap()[0].get::<_, i64>(0),
            1001
        );
        assert_eq!(
            tx.query("SELECT count(*) FROM _log", &[]).unwrap()[0].get::<_, i64>(0),
            1001
        );
        if rollback {
            tx.rollback().unwrap();
        } else {
            tx.commit().unwrap();
        }
        assert_integrity(&mut e.store.client);
        let count = if rollback { 0 } else { 1001 };
        assert_eq!(
            e.store
                .client
                .query_one("SELECT count(*) FROM _log", &[])
                .unwrap()
                .get::<_, i64>(0),
            count
        );
    }
    // A real pre-upgrade constraint on populated history, then ordinary attach.
    e.store.client.batch_execute(LEGACY).unwrap();
    drop(e);
    let mut e = PostgresEngine::open(connect(), &name).unwrap();
    assert_no_fk(&mut e.store.client);
    assert_integrity(&mut e.store.client);
    assert_eq!(
        e.store
            .client
            .query_one("SELECT count(*) FROM _log", &[])
            .unwrap()
            .get::<_, i64>(0),
        1001
    );
    e.store
        .client
        .batch_execute(&format!("DROP SCHEMA {name} CASCADE"))
        .unwrap();
}

// Five physical rows/member, one head update/batch. This is a tail cost model,
// not a group committer or a whole-request/throughput qualification. Both arms
// execute the identical SQL and durability settings on Engine-created shapes.
const BATCH: &str = "WITH head AS (
    UPDATE _head SET seq=$1+$2 WHERE singleton AND seq=$1 RETURNING seq
), committed AS (
    INSERT INTO _commits(seq,at,program,principal,kind,touched,writes)
    SELECT s,100,'put','alice','mutation','[\"notes\"]',1 FROM head,generate_series($1+1,$1+$2) s RETURNING seq
), written AS (
    UPDATE r SET data='{}' FROM head WHERE t='notes' RETURNING 1
), logged AS (
    INSERT INTO _log(partition,seq,ord,t,kind,id,data)
    SELECT 'public',seq,0,'notes','put',seq::text,'{}' FROM committed RETURNING 1
), receipts AS (
    INSERT INTO _ops(principal,id,seq,outcome,name,args_digest,at)
    SELECT 'alice',seq::text,seq,'{}','put','digest',100 FROM committed RETURNING 1
), evidence AS (
    INSERT INTO _change_evidence(seq,footprint) SELECT seq,'{}' FROM committed RETURNING 1
) SELECT (SELECT count(*) FROM committed),(SELECT count(*) FROM logged),
    (SELECT count(*) FROM receipts),(SELECT count(*) FROM evidence),(SELECT count(*) FROM written)";

fn scans(c: &mut Client) -> Vec<(String, i64, i64, i64)> {
    c.batch_execute("SELECT pg_stat_force_next_flush(); SELECT pg_stat_clear_snapshot()")
        .unwrap();
    c.query("SELECT relname::text,seq_scan,seq_tup_read,coalesce(idx_scan,0) FROM pg_stat_user_tables WHERE schemaname=current_schema() AND relname IN ('_commits','_log') ORDER BY relname", &[]).unwrap().iter().map(|r| (r.get(0),r.get(1),r.get(2),r.get(3))).collect()
}
fn delta(
    a: &[(String, i64, i64, i64)],
    b: &[(String, i64, i64, i64)],
) -> Vec<(String, i64, i64, i64)> {
    a.iter()
        .zip(b)
        .map(|(a, b)| (a.0.clone(), b.1 - a.1, b.2 - a.2, b.3 - a.3))
        .collect()
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh; ~45s tail cost witness"]
fn log_plan_hygiene_cold_backend_tail_scan_witness() {
    use std::time::{Duration, Instant};
    // Other adapter tests create/drop namespaces concurrently. Their catalog
    // invalidations can replace the RI plan and heal the negative control.
    // Own a separate database so this test can retain its planned catalog and
    // statistics lifetime even when the stock runner includes every test.
    let mut admin = connect();
    let database = format!("sb4_ph_plan_{:x}", crate::ids::seed());
    admin
        .batch_execute(&format!("CREATE DATABASE {database}"))
        .unwrap();
    let mut config: postgres::Config = std::env::var("SNAPBACK4_EVAL_POSTGRES")
        .unwrap()
        .parse()
        .unwrap();
    config.dbname(&database);
    let measure_connect = || config.connect(postgres::NoTls).unwrap();
    let mut fits = Vec::new();
    for arm in ["legacy_fk", "fresh", "upgraded"] {
        let mut points = Vec::new();
        for n in [1i64, 4, 16, 32, 64] {
            let mut e = PostgresEngine::create(
                measure_connect(),
                &format!("sb4_eval_ph_cell_{:x}", crate::ids::seed()),
                Schema::default(),
                [],
            )
            .unwrap();
            let name = namespace(&mut e);
            if arm != "fresh" {
                e.store.client.batch_execute(LEGACY).unwrap();
            }
            if arm == "upgraded" {
                drop(e);
                e = PostgresEngine::open(measure_connect(), &name).unwrap();
            }
            if arm != "legacy_fk" {
                assert_no_fk(&mut e.store.client);
            }
            let c = &mut e.store.client;
            let backend: i32 = c.query_one("SELECT pg_backend_pid()", &[]).unwrap().get(0);
            println!(
                "PH BACKEND arm={arm} n={n} pid={backend} plan_cache_mode=auto; same backend through seed/analyze/warm-up/window"
            );
            c.batch_execute("INSERT INTO _commits VALUES (0,0,'seed','alice','mutation','[]',0); ANALYZE _commits; ANALYZE _log").unwrap();
            for id in 0..n {
                c.execute(
                    "INSERT INTO r(t,id,data) VALUES ('notes',$1,'{}')",
                    &[&id.to_string()],
                )
                .unwrap();
            }
            c.batch_execute("ANALYZE r").unwrap();
            // Preserve the deliberately tiny analyzed population for this
            // mechanism witness. Autovacuum can otherwise ANALYZE mid-cell and
            // replace the legacy RI plan. This observer lock is compatible with
            // every writer/RI lock, applies equally to all arms, and changes no
            // durability or product setting. Other relations still auto-vacuum.
            let mut stats_guard = measure_connect();
            stats_guard.batch_execute(&format!("SET lock_timeout='5s'; BEGIN; LOCK TABLE {name}._commits IN SHARE UPDATE EXCLUSIVE MODE")).unwrap();
            let stmt = c.prepare(BATCH).unwrap();
            let mut base = 0i64;
            let before = scans(c);
            let mut periods = Vec::new();
            for millis in [1000, 2000] {
                let start = Instant::now();
                let mut batches = 0;
                while start.elapsed() < Duration::from_millis(millis) {
                    let mut tx = c.transaction().unwrap();
                    let counts = tx.query_one(&stmt, &[&base, &n]).unwrap();
                    for i in 0..5 {
                        assert_eq!(counts.get::<_, i64>(i), n);
                    }
                    tx.commit().unwrap();
                    base += n;
                    batches += 1;
                }
                periods.push((
                    start.elapsed().as_secs_f64() * 1e6 / batches as f64,
                    scans(c),
                ));
            }
            let warm_delta = delta(&before, &periods[0].1);
            let measure_delta = delta(&periods[0].1, &periods[1].1);
            println!(
                "PH arm={arm} n={n} batch_us={:.3} members={base} warm={warm_delta:?} measure={measure_delta:?}",
                periods[1].0
            );
            if arm == "legacy_fk" {
                assert!(
                    measure_delta[0].1 > 0 && measure_delta[0].2 > base,
                    "control must reproduce growing cached RI scans"
                );
            } else {
                for d in warm_delta.iter().chain(&measure_delta) {
                    assert_eq!((d.1, d.2), (0, 0), "{arm} n={n} {d:?}");
                }
            }
            stats_guard.batch_execute("ROLLBACK").unwrap();
            assert_integrity(c);
            points.push((n as f64, periods[1].0));
            c.batch_execute(&format!("DROP SCHEMA {name} CASCADE"))
                .unwrap();
        }
        let mean_x = points.iter().map(|p| p.0).sum::<f64>() / 5.;
        let mean_y = points.iter().map(|p| p.1).sum::<f64>() / 5.;
        let slope = points
            .iter()
            .map(|p| (p.0 - mean_x) * (p.1 - mean_y))
            .sum::<f64>()
            / points.iter().map(|p| (p.0 - mean_x).powi(2)).sum::<f64>();
        println!(
            "PH FIT arm={arm} fixed_us={:.3} marginal_us={slope:.3}",
            mean_y - slope * mean_x
        );
        if arm != "legacy_fk" {
            assert!(
                slope < 70.,
                "{arm}: outside margin-reserved warm band: {slope}"
            );
        }
        fits.push(slope);
    }
    assert!(
        fits[0] > fits[1] * 3. && fits[0] > fits[2] * 3.,
        "legacy control must show the cliff: {fits:?}"
    );
    admin
        .batch_execute(&format!("DROP DATABASE {database}"))
        .unwrap();
}
