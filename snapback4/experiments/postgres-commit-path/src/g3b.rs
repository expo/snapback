//! G3b/G8 statement and durable-tail cost models. No semantic executor.
//! Design: LLP 3000.009.001.000.002 §3.3–3.5 and G3b/G8, read from the
//! perf-rfc worktree; see the result README for its revision/digest.
// @ref LLP 3000.009.001.002#9-phases — separate statement models bound commit work, not engine capacity
use crate::{Args, common::*, create_engine};
use postgres::{
    Client, Row, Statement,
    types::{ToSql, Type},
};
use serde_json::{Value as Json, json};
use std::{collections::BTreeMap, time::Instant};

const DIGEST: &str = "9acc01a1b8d6d1476070406c156e19349f53cf23b10a42535ccb17cd923f8a22";
const READ: &str =
    "SELECT id,data FROM r WHERE t=$1::text AND id=ANY($2::text[]) ORDER BY id COLLATE \"C\"";
const WRITE: &str =
    "WITH w AS (UPDATE r SET data=u.data FROM unnest($2::text[],$3::text[]) u(id,data)
    WHERE r.t=$1::text AND r.id=u.id RETURNING r.id,r.data)
    SELECT id,data FROM w ORDER BY id COLLATE \"C\"";

/// Refuse new work if this shared filesystem has less than 25 GiB available.
fn space_guard() {
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    assert_eq!(
        unsafe { libc::statvfs(c"/home".as_ptr(), stat.as_mut_ptr()) },
        0
    );
    let stat = unsafe { stat.assume_init() };
    assert!(
        stat.f_bavail as u128 * stat.f_frsize as u128 >= 25 * 1024u128.pow(3),
        "G3b stop: /home has less than 25 GiB available"
    );
}

fn summary(xs: &[f64]) -> Json {
    let mut xs = xs.to_vec();
    xs.sort_by(f64::total_cmp);
    assert!(!xs.is_empty());
    json!({"n":xs.len(), "mean":xs.iter().sum::<f64>()/xs.len() as f64,
        "p50":xs[xs.len()/2], "p99":xs[(xs.len()*99/100).min(xs.len()-1)],
        "min":xs[0], "max":xs[xs.len()-1]})
}

fn prepare(c: &mut Client, sql: &str, types: &[Type]) -> (Statement, Statement) {
    (
        c.prepare_typed(sql, types).unwrap(),
        c.prepare_typed(
            &format!("EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) {sql}"),
            types,
        )
        .unwrap(),
    )
}

fn images(ids: &[String], value: i64) -> Vec<String> {
    ids.iter()
        .map(|id| {
            format!("{{\"Row\":{{\"id\":{{\"Id\":\"{id}\"}},\"value\":{{\"Int\":{value}}}}}}}")
        })
        .collect()
}

fn verify_images(rows: &[Row], ids: &[String], expected: &[String]) {
    let mut want: Vec<_> = ids.iter().zip(expected).collect();
    want.sort_by(|a, b| a.0.cmp(b.0));
    assert_eq!(rows.len(), want.len());
    for (row, (id, data)) in rows.iter().zip(want) {
        assert_eq!(row.get::<_, String>(0), *id);
        let actual: Json = serde_json::from_str(row.get::<_, &str>(1)).unwrap();
        let expected: Json = serde_json::from_str(data).unwrap();
        assert_eq!(actual, expected);
    }
}

fn level(c: &mut Client, args: &Args, n: usize) -> Json {
    let kind = args.req("--kind");
    assert!(["read", "write"].contains(&kind));
    let ids: Vec<_> = (0..n).map(|i| format!("c{i}")).collect();
    let data = images(&ids, 1);
    // Seed through the normal row shape so both cells return identical bytes.
    c.execute(WRITE, &[&"counters", &ids, &data]).unwrap();
    c.batch_execute("VACUUM (ANALYZE) r").unwrap();
    let (sql, types) = if kind == "read" {
        (READ, vec![Type::TEXT, Type::TEXT_ARRAY])
    } else {
        (WRITE, vec![Type::TEXT, Type::TEXT_ARRAY, Type::TEXT_ARRAY])
    };
    let (plain, explain) = prepare(c, sql, &types);
    let mut params: Vec<&(dyn ToSql + Sync)> = vec![&"counters", &ids];
    if kind == "write" {
        params.push(&data);
    }
    let iterations = args.num("--iterations", 1000);
    let explains = args.num("--explains", 200);
    assert!(iterations > 0 && explains > 0);
    let mut runs = Vec::new();
    for run in 0..args.runs() {
        space_guard();
        let before = loadavg();
        let mut wall = vec![];
        let mut transaction = vec![];
        for i in 0..iterations + 100 {
            if i % 64 == 0 {
                space_guard();
            }
            let start = Instant::now();
            c.batch_execute("BEGIN").unwrap();
            let stmt = Instant::now();
            let rows = c.query(&plain, &params).unwrap();
            let elapsed = stmt.elapsed().as_secs_f64() * 1e6;
            // Flush is excluded from statement wall, included in transaction wall.
            c.batch_execute("COMMIT").unwrap();
            let total = start.elapsed().as_secs_f64() * 1e6;
            verify_images(&rows, &ids, &data);
            if i >= 100 {
                wall.push(elapsed);
                transaction.push(total);
            }
        }
        let mut execution = vec![];
        let mut planning = vec![];
        let mut plan = Json::Null;
        for _ in 0..explains {
            c.batch_execute("BEGIN").unwrap();
            let row = c.query_one(&explain, &params).unwrap();
            plan = row.get::<_, Json>(0);
            execution.push(plan[0]["Execution Time"].as_f64().unwrap() * 1000.);
            planning.push(plan[0]["Planning Time"].as_f64().unwrap() * 1000.);
            c.batch_execute("COMMIT").unwrap();
        }
        runs.push(
            json!({"run":run, "loadavg_before":before, "loadavg_after":loadavg(),
            "statement_wall_us":summary(&wall), "transaction_wall_us":summary(&transaction),
            "server_execution_us":summary(&execution), "server_planning_us":summary(&planning),
            "last_explain":plan, "checks":"every plain result: N ordered ids and exact images"}),
        );
    }
    json!({"mode":"level", "kind":kind, "batch":n, "sql":sql,
        "returned_image_bytes":data.iter().map(String::len).sum::<usize>(), "runs":runs})
}

/// The baseline has S1b's pure-counter full write set, including revision and
/// max-folded pin updates. Batch metadata packs all footprint keys and retains
/// every ordered log image, but changes public sequence representation: a cost
/// bound requiring a new history/replay/retention reader design, not a drop-in.
fn stage_sql(variant: &str) -> (String, Vec<Type>) {
    let types = vec![
        Type::INT8,
        Type::INT8,
        Type::TEXT_ARRAY,
        Type::TEXT_ARRAY,
        Type::INT8,
        Type::INT8_ARRAY,
        Type::TEXT_ARRAY,
        Type::INT8,
        Type::INT8,
        Type::INT8,
    ];
    if variant == "r_only" {
        return (
            "WITH w AS (UPDATE r SET data=u.data FROM unnest($1::text[],$2::text[]) u(id,data)
            WHERE r.t='counters' AND r.id=u.id RETURNING 1) SELECT count(*) FROM w"
                .into(),
            vec![Type::TEXT_ARRAY, Type::TEXT_ARRAY],
        );
    }
    let batch = variant == "batch_tail";
    let commits = if batch {
        "SELECT $2,$5,'increment','alice','mutation','[\"counters\"]',cardinality($3) FROM head"
    } else {
        "SELECT c.seq,$5,'increment','alice','mutation','[\"counters\"]',1 FROM head,unnest($6::bigint[]) c(seq)"
    };
    let log_seq = if batch { "$2" } else { "l.seq" };
    let log_ord = if batch { "l.ord-1" } else { "0" };
    let footprints = if batch {
        "SELECT $8,array_to_string($7::text[],';'),'session:alice;principal-generation:alice;owner-lease' FROM head"
    } else {
        "SELECT f.revision,f.keys,'session:alice;principal-generation:alice;owner-lease'
            FROM head,unnest($6::bigint[],$7::text[]) f(revision,keys)"
    };
    let ops = if variant == "full" {
        "INSERT INTO _ops SELECT 'alice',o.id,o.seq,o.outcome,'increment',$13,$5
            FROM head,unnest($11::text[],$6::bigint[],$12::text[]) o(id,seq,outcome) RETURNING 1"
    } else {
        "SELECT 1 WHERE false"
    };
    let sql = format!("WITH head AS (
        UPDATE _head SET seq=$2 WHERE singleton AND seq=$1 RETURNING seq
    ), w AS (
        UPDATE r SET data=u.data FROM unnest($3::text[],$4::text[]) u(id,data),head
        WHERE r.t='counters' AND r.id=u.id RETURNING 1
    ), committed AS (INSERT INTO _commits {commits} RETURNING seq
    ), logged AS (
        INSERT INTO _log SELECT 'public',{log_seq},{log_ord},'counters','put',l.id,l.data
        FROM head,unnest($6::bigint[],$3::text[],$4::text[]) WITH ORDINALITY l(seq,id,data,ord) RETURNING 1
    ), ops AS ({ops}
    ), footprints AS (INSERT INTO _s1a_footprints {footprints} RETURNING 1
    ), revision AS (
        UPDATE _s1a_meta SET value=$8 WHERE key='revision' AND value=$9 RETURNING 1
    ), pin AS (
        UPDATE _s1a_meta SET value=greatest(value,$10) WHERE key='time_audience_clock' RETURNING 1
    ) SELECT (SELECT count(*) FROM head),(SELECT count(*) FROM w),
        (SELECT count(*) FROM committed),(SELECT count(*) FROM logged),
        (SELECT count(*) FROM ops),(SELECT count(*) FROM footprints),
        (SELECT count(*) FROM revision),(SELECT count(*) FROM pin)");
    let mut types = types;
    if variant == "full" {
        types.extend([Type::TEXT_ARRAY, Type::TEXT_ARRAY, Type::TEXT]);
    }
    (sql, types)
}

struct Payload {
    old: i64,
    next: i64,
    ids: Vec<String>,
    data: Vec<String>,
    at: i64,
    seqs: Vec<i64>,
    keys: Vec<String>,
    pin: i64,
    ops: Vec<String>,
    outcomes: Vec<String>,
}

impl Payload {
    fn new(n: usize, ordinal: i64, head: i64, variant: &str) -> Self {
        let ids: Vec<_> = (0..n).map(|i| format!("c{i}")).collect();
        let data = images(&ids, ordinal);
        let seqs: Vec<_> = (1..=n).map(|i| head + i as i64).collect();
        let ops: Vec<_> = seqs.iter().map(|seq| format!("g3b-{seq}")).collect();
        let outcomes = if variant == "full" {
            ops.iter()
                .zip(&seqs)
                .map(|(op, seq)| {
                    format!(
                        "{{\"id\":\"{op}\",\"replayed\":true,\"seq\":{seq},\"state\":\"sent\"}}"
                    )
                })
                .collect()
        } else {
            vec![]
        };
        let keys = ids
            .iter()
            .zip(&ops)
            .map(|(id, op)| {
                if variant == "full" {
                    format!("r:counters:{id};receipt:alice:{op}")
                } else {
                    format!("r:counters:{id}")
                }
            })
            .collect();
        Self {
            old: head,
            next: head + n as i64,
            ids,
            data,
            at: 1000,
            seqs,
            keys,
            pin: 1000 + ordinal,
            ops,
            outcomes,
        }
    }
    fn params(&self, variant: &str) -> Vec<&(dyn ToSql + Sync)> {
        if variant == "r_only" {
            return vec![&self.ids, &self.data];
        }
        let mut params: Vec<&(dyn ToSql + Sync)> = vec![
            &self.old, &self.next, &self.ids, &self.data, &self.at, &self.seqs, &self.keys,
            &self.next, &self.old, &self.pin,
        ];
        if variant == "full" {
            params.push(&self.ops);
            params.push(&self.outcomes);
            params.push(&DIGEST);
        }
        params
    }
}

fn stage_counts(row: &Row, n: usize, variant: &str) {
    let expected = if variant == "r_only" {
        vec![n as i64]
    } else {
        let packed = if variant == "batch_tail" { 1 } else { n as i64 };
        vec![
            1,
            n as i64,
            packed,
            n as i64,
            if variant == "full" { n as i64 } else { 0 },
            packed,
            1,
            1,
        ]
    };
    for (i, count) in expected.into_iter().enumerate() {
        assert_eq!(row.get::<_, i64>(i), count);
    }
}

fn counts(c: &mut Client) -> BTreeMap<String, i64> {
    ["_commits", "_log", "_ops", "_s1a_footprints"]
        .into_iter()
        .map(|name| {
            (
                name.to_string(),
                c.query_one(&format!("SELECT count(*) FROM {name}"), &[])
                    .unwrap()
                    .get(0),
            )
        })
        .collect()
}

fn commit(c: &mut Client, args: &Args, n: usize) -> Json {
    let variant = args.req("--variant");
    assert!(["full", "no_ops", "batch_tail", "r_only"].contains(&variant));
    let head0: i64 = c
        .query_one("SELECT seq FROM _head WHERE singleton", &[])
        .unwrap()
        .get(0);
    // S1a's revision starts at zero. Use the existing head as its baseline so
    // member revision and sequence arrays are identical for this all-head cell.
    c.batch_execute(&format!("CREATE TABLE _s1a_meta(key text PRIMARY KEY,value bigint NOT NULL);
        INSERT INTO _s1a_meta VALUES('revision',{head0}),('time_audience_clock',0);
        CREATE TABLE _s1a_footprints(revision bigint PRIMARY KEY,keys text NOT NULL,authority text NOT NULL);")).unwrap();
    let initial = counts(c);
    let (sql, types) = stage_sql(variant);
    let schema: String = c.query_one("SELECT current_schema()", &[]).unwrap().get(0);
    let timing = Timing::from_env();
    let mut ordinal = 0i64;
    let mut head = head0;
    let mut runs = vec![];
    for run in 0..args.runs() {
        space_guard();
        // Like S1b's committer thread, every repetition opens a fresh backend.
        // PostgreSQL RI trigger plans otherwise retain the one-row seed's
        // sequential _commits scan as that table grows across repetitions.
        *c = Net::parse("tcp").connect();
        c.batch_execute(&format!(
            "SET search_path=\"{schema}\",pg_catalog;
            SET statement_timeout='5s'; SET lock_timeout='5s';"
        ))
        .unwrap();
        let (plain, _) = prepare(c, &sql, &types);
        let backend: i32 = c.query_one("SELECT pg_backend_pid()", &[]).unwrap().get(0);
        let before = loadavg();
        let mut samples: Vec<[f64; 3]> = vec![];
        let mut measured = false;
        let mut lsn0 = 0;
        let mut measure_start = Instant::now();
        let warm_start = Instant::now();
        loop {
            if ordinal % 64 == 0 {
                space_guard();
            }
            if !measured && warm_start.elapsed() >= timing.warmup {
                lsn0 = wal_lsn(c);
                measure_start = Instant::now();
                measured = true;
            }
            if measured && measure_start.elapsed() >= timing.measure {
                break;
            }
            ordinal += 1;
            // Image/receipt generation deliberately outside the timed SQL stage,
            // matching S1b. The window average also records this driver work.
            let payload = Payload::new(n, ordinal, head, variant);
            let params = payload.params(variant);
            let start = Instant::now();
            c.batch_execute("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE")
                .unwrap();
            let apply = Instant::now();
            let row = c.query_one(&plain, &params).unwrap();
            let apply_us = apply.elapsed().as_secs_f64() * 1e6;
            let flush = Instant::now();
            c.batch_execute("COMMIT").unwrap();
            let flush_us = flush.elapsed().as_secs_f64() * 1e6;
            let total_us = start.elapsed().as_secs_f64() * 1e6;
            stage_counts(&row, n, variant);
            head += n as i64;
            if measured {
                samples.push([total_us, apply_us, flush_us]);
            }
        }
        let window_us = measure_start.elapsed().as_secs_f64() * 1e6;
        let wal = wal_lsn(c) - lsn0;
        assert!(!samples.is_empty() && wal > 0);
        c.batch_execute("SELECT pg_stat_force_next_flush(); SELECT pg_stat_clear_snapshot();")
            .unwrap();
        let scans = c
            .query_one(
                "SELECT seq_scan,seq_tup_read,idx_scan,idx_tup_fetch FROM pg_stat_user_tables
            WHERE schemaname=$1 AND relname='_commits'",
                &[&schema],
            )
            .unwrap();
        let scans: Vec<i64> = (0..4).map(|i| scans.get(i)).collect();
        let mut metrics = BTreeMap::new();
        for (i, name) in ["transaction_us", "apply_wall_us", "commit_wall_us"]
            .iter()
            .enumerate()
        {
            metrics.insert(
                *name,
                summary(&samples.iter().map(|s| s[i]).collect::<Vec<_>>()),
            );
        }
        runs.push(json!({"run":run, "backend_pid":backend,
            "commits_scan_totals_seq_scans_seq_tuples_index_scans_index_tuples":scans,
            "loadavg_before":before, "loadavg_after":loadavg(),
            "batches":samples.len(), "members":samples.len()*n, "window_us":window_us,
            "window_us_per_batch":window_us/samples.len() as f64, "metrics":metrics,
            "wal_lsn_before":lsn0, "wal_lsn_after":lsn0+wal, "wal_bytes":wal,
            "wal_bytes_per_member":wal as f64/(samples.len()*n) as f64}));
    }
    let final_counts = counts(c);
    let members = ordinal * n as i64;
    for (name, actual) in &final_counts {
        let expected = if variant == "r_only" || (name == "_ops" && variant != "full") {
            0
        } else if variant == "batch_tail"
            && ["_commits", "_s1a_footprints"].contains(&name.as_str())
        {
            ordinal
        } else {
            members
        };
        assert_eq!(actual - initial[name], expected, "durable count {name}");
    }
    let ids: Vec<_> = (0..n).map(|i| format!("c{i}")).collect();
    let result = c.query(READ, &[&"counters", &ids]).unwrap();
    verify_images(&result, &ids, &images(&ids, ordinal));
    let final_head: i64 = c
        .query_one("SELECT seq FROM _head WHERE singleton", &[])
        .unwrap()
        .get(0);
    assert_eq!(final_head, if variant == "r_only" { head0 } else { head });
    let final_revision: i64 = c
        .query_one("SELECT value FROM _s1a_meta WHERE key='revision'", &[])
        .unwrap()
        .get(0);
    let final_pin: i64 = c
        .query_one(
            "SELECT value FROM _s1a_meta WHERE key='time_audience_clock'",
            &[],
        )
        .unwrap()
        .get(0);
    assert_eq!(final_revision, final_head);
    assert_eq!(
        final_pin,
        if variant == "r_only" {
            0
        } else {
            1000 + ordinal
        }
    );
    let last = Payload::new(n, ordinal, head - n as i64, variant);
    if variant != "r_only" {
        let logs = c.query("SELECT id,data,seq,ord FROM _log WHERE partition='public' AND seq>$1 ORDER BY seq,ord",
            &[&(head-n as i64)]).unwrap();
        assert_eq!(logs.len(), n);
        for (i, row) in logs.iter().enumerate() {
            assert_eq!(row.get::<_, String>(0), last.ids[i]);
            assert_eq!(row.get::<_, String>(1), last.data[i]);
            assert_eq!(
                row.get::<_, i64>(2),
                if variant == "batch_tail" {
                    head
                } else {
                    last.seqs[i]
                }
            );
            assert_eq!(
                row.get::<_, i64>(3),
                if variant == "batch_tail" { i as i64 } else { 0 }
            );
        }
        let expected_keys = if variant == "batch_tail" {
            vec![last.keys.join(";")]
        } else {
            last.keys.clone()
        };
        let keys: Vec<String> = c
            .query(
                "SELECT keys FROM _s1a_footprints WHERE revision>$1 ORDER BY revision",
                &[&(head - n as i64)],
            )
            .unwrap()
            .iter()
            .map(|r| r.get(0))
            .collect();
        assert_eq!(keys, expected_keys);
        if variant == "full" {
            let receipts = c
                .query(
                    "SELECT id,outcome FROM _ops WHERE seq>$1 ORDER BY seq",
                    &[&(head - n as i64)],
                )
                .unwrap();
            assert_eq!(receipts.len(), n);
            for (i, row) in receipts.iter().enumerate() {
                assert_eq!(row.get::<_, String>(0), last.ops[i]);
                assert_eq!(row.get::<_, String>(1), last.outcomes[i]);
            }
        }
    }
    // Inspect apply execution separately; EXPLAIN instrumentation and rollback
    // WAL are outside all reported durable transaction windows and WAL deltas.
    let payload = Payload::new(n, ordinal + 1, head, variant);
    let (_, explain) = prepare(c, &sql, &types);
    c.batch_execute("BEGIN").unwrap();
    let plan: Json = c
        .query_one(&explain, &payload.params(variant))
        .unwrap()
        .get(0);
    c.batch_execute("ROLLBACK").unwrap();
    json!({"mode":"commit", "variant":variant, "batch":n, "sql":sql, "runs":runs,
        "last_payload_bytes":{"images":last.data.iter().map(String::len).sum::<usize>(),
            "footprint_keys":last.keys.iter().map(String::len).sum::<usize>(),
            "receipts":last.outcomes.iter().map(String::len).sum::<usize>()},
        "apply_explain_after_windows":plan, "checks":{"ok":true,"warm_and_measured_batches":ordinal,
        "initial_counts":initial,"final_counts":final_counts,"final_head":final_head,
        "final_revision":final_revision,"final_pin":final_pin,"final_counter_value":ordinal}})
}

pub fn run(args: &Args) -> Json {
    assert!(!cfg!(debug_assertions), "measure release binaries only");
    space_guard();
    assert_eq!(args.req("--net"), "tcp", "G3b uses direct loopback TCP");
    let n = args.num("--batch", 32);
    assert!([1, 4, 8, 16, 32, 64].contains(&n));
    let (schema, engine) = create_engine("g3b");
    drop(engine);
    let net = Net::parse("tcp");
    let mut c = net.connect();
    c.batch_execute(&format!(
        "SET search_path=\"{schema}\",pg_catalog;
        SET statement_timeout='5s'; SET lock_timeout='5s';"
    ))
    .unwrap();
    let settings: BTreeMap<String, String> = c
        .query(
            "SELECT name,setting FROM pg_settings
        WHERE name IN ('server_version','fsync','synchronous_commit','full_page_writes',
        'wal_sync_method','commit_delay','shared_buffers','max_connections','checkpoint_timeout',
        'max_wal_size','autovacuum','track_io_timing','track_wal_io_timing',
        'statement_timeout','lock_timeout','jit','plan_cache_mode') ORDER BY name",
            &[],
        )
        .unwrap()
        .into_iter()
        .map(|r| (r.get(0), r.get(1)))
        .collect();
    for key in ["fsync", "synchronous_commit", "full_page_writes"] {
        assert_eq!(settings[key], "on");
    }
    let backend: i32 = c.query_one("SELECT pg_backend_pid()", &[]).unwrap().get(0);
    let mut result = match args.req("--mode") {
        "level" => level(&mut c, args, n),
        "commit" => commit(&mut c, args, n),
        other => panic!("--mode level|commit, got {other}"),
    };
    drop(c);
    // Only this invocation's fresh namespace is removed. Cluster teardown is
    // owned by the runner, with its recorded master/child PID receipt.
    admin()
        .batch_execute(&format!("DROP SCHEMA \"{schema}\" CASCADE"))
        .unwrap();
    result["cell"] = json!("g3b");
    result["settings"] = json!(settings);
    result["schema_dropped"] = json!(schema);
    result["backend_pid"] = json!(backend);
    result
}
