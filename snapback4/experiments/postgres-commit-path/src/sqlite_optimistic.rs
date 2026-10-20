//! S1a's SQLite models, over an engine-created store, without engine edits.
use crate::{
    Args,
    common::*,
    sqlite::{create, fresh, pragmas},
};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde_json::{Value as Json, json};
use snapback4_core::{Value, key};
use std::{collections::HashMap, time::Instant};

fn catalog(conn: &Connection, name: &str) -> i64 {
    conn.query_row("SELECT num FROM _catalog WHERE name=?1", [name], |r| {
        r.get(0)
    })
    .unwrap()
}

/// Eight SELECTs, matching the PG model's metadata/receipt and size/fetch
/// reads, translated to SQLite's actual catalog and metadata layout.
pub fn execution(args: &Args) -> Json {
    let threads = args.num("--threads", 32);
    assert!((1..=256).contains(&threads));
    let path = fresh(args.req("--dir"), "optimistic-read");
    let engine = create(&path, "FULL");
    let settings = pragmas(&engine);
    let (t, ti) = (
        catalog(engine.store().conn(), "counters"),
        catalog(engine.store().conn(), "counters.byId"),
    );
    let timing = Timing::from_env();
    let mut runs = Vec::new();
    for run in 0..args.runs() {
        let path = path.clone();
        let mut r = closed_loop(
            threads,
            &timing,
            None,
            move |w| {
                let conn =
                    Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
                conn.busy_timeout(std::time::Duration::from_secs(5))
                    .unwrap();
                conn.execute_batch("PRAGMA query_only=ON").unwrap();
                let lo = key::encode(&[Value::Id(format!("c{w}"))]);
                let hi = key::upper_bound(&lo);
                (conn, lo, hi)
            },
            move |(conn, lo, hi), w, i| {
                let result = (|| -> rusqlite::Result<()> {
                    conn.execute_batch("BEGIN DEFERRED")?;
                    let _: (String, i64) = conn.prepare_cached("SELECT (SELECT value FROM _meta WHERE key='generation'), (SELECT COALESCE(MAX(seq),0) FROM _commits)")?
                    .query_row([], |r| Ok((r.get(0)?,r.get(1)?)))?;
                    let op = format!("read-{run}-{w}-{i}");
                    let receipt =
                        "SELECT outcome,name,args_digest FROM _ops WHERE principal=?1 AND id=?2";
                    let _: Option<(String, String, String)> = conn
                        .prepare_cached(receipt)?
                        .query_row(params!["alice", op], |r| {
                            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
                        })
                        .optional()?;
                    let _: String = conn
                        .prepare_cached("SELECT value FROM _meta WHERE key='generation'")?
                        .query_row([], |r| r.get(0))?;
                    let _: Option<(String, String, String)> = conn
                        .prepare_cached(receipt)?
                        .query_row(params!["alice", op], |r| {
                            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
                        })
                        .optional()?;
                    for _ in 0..2 {
                        let _: (i64, i64) = conn.prepare_cached("SELECT octet_length(r.data),length(i.k) FROM i JOIN r ON r.t=?1 AND r.id=i.id WHERE i.ti=?2 AND i.k>=?3 AND i.k<?4 ORDER BY i.k ASC LIMIT ?5")?
                        .query_row(params![t,ti,lo.as_slice(),hi.as_slice(),1i64], |r| Ok((r.get(0)?,r.get(1)?)))?;
                        let _: (String, Vec<u8>) = conn.prepare_cached("SELECT r.data,i.k FROM i JOIN r ON r.t=?1 AND r.id=i.id WHERE i.ti=?2 AND i.k>=?3 AND i.k<?4 ORDER BY i.k ASC LIMIT ?5")?
                        .query_row(params![t,ti,lo.as_slice(),hi.as_slice(),1i64], |r| Ok((r.get(0)?,r.get(1)?)))?;
                    }
                    conn.execute_batch("ROLLBACK")
                })();
                result.map(|_| 10).map_err(|e| e.to_string())
            },
        );
        r["executions_per_s"] = r["commits_per_s"].clone();
        runs.push(r);
    }
    let unchanged: bool = engine
        .store()
        .conn()
        .query_row(
            "SELECT min(json_extract(data,'$.Row.value.Int')=0) FROM r WHERE t=?1",
            [t],
            |r| r.get(0),
        )
        .unwrap();
    assert!(unchanged);
    let mut summary = aggregate(&runs);
    summary["executions_per_s_median"] = summary["commits_per_s_median"].clone();
    json!({"cell":"sqlite-execution", "label":"MODEL: eight increment SELECTs on separate read-only WAL connections; no interpreter/overlay/validation/reruns",
        "threads":threads,"store":path,"pragmas":settings,"counters_unchanged":unchanged,"summary":summary,"runs":runs})
}

struct Writer {
    conn: Connection,
    values: HashMap<String, i64>,
    seq: i64,
    t: i64,
}

impl Writer {
    fn batch(&mut self, n: usize, run: usize, batch_id: u64) -> Result<(), String> {
        // Precompute images, receipts and log payloads before opening the
        // durable transaction. The stage timer includes this client work.
        let mut members = Vec::new();
        for member in 0..n {
            let id = format!("c{member}");
            let value = self.values.entry(id.clone()).or_default();
            *value += 1;
            let seq = self.seq + member as i64 + 1;
            let image =
                format!("{{\"Row\":{{\"id\":{{\"Id\":\"{id}\"}},\"value\":{{\"Int\":{value}}}}}}}");
            let op = format!("batch-{run}-{batch_id}-{member}");
            let receipt = json!({"id":op,"replayed":true,"seq":seq,"state":"sent"}).to_string();
            members.push((id, seq, image, op, receipt));
        }
        let last = self.seq + n as i64;
        let result = (|| -> rusqlite::Result<()> {
            let tx = self
                .conn
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            for (id, seq, image, op, receipt) in &members {
                assert_eq!(
                    tx.prepare_cached("UPDATE r SET data=?3 WHERE t=?1 AND id=?2")?
                        .execute(params![self.t, id, image])?,
                    1
                );
                tx.prepare_cached("INSERT INTO _commits VALUES (?1,1000,'increment','alice','mutation','[\"counters\"]',1)")?.execute([seq])?;
                tx.prepare_cached(
                    "INSERT INTO _log VALUES ('public',?1,0,'counters','put',?2,?3)",
                )?
                .execute(params![seq, id, image])?;
                tx.prepare_cached("INSERT INTO _ops(principal,id,seq,outcome,name,args_digest,at) VALUES ('alice',?1,?2,?3,'increment','s1a-model',1000)")?.execute(params![op,seq,receipt])?;
                tx.prepare_cached("INSERT INTO _s1a_footprints VALUES (?1,?2,'session:alice;principal-generation:alice;owner-lease')")?.execute(params![seq,format!("r:counters:{id};receipt:alice:{op}")])?;
            }
            tx.execute("INSERT INTO _meta VALUES ('s1a_revision',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [last.to_string()])?;
            tx.execute("INSERT INTO _meta VALUES ('time_audience_clock',?1) ON CONFLICT(key) DO UPDATE SET value=max(cast(value AS INTEGER),cast(excluded.value AS INTEGER))", [last.to_string()])?;
            tx.commit()
        })();
        result.map_err(|e| e.to_string())?;
        self.seq = last;
        Ok(())
    }
}

// @ref LLP 3000.009.001.002#9-phases — optimistic SQLite commit-stage model, not Engine::mutate batching
pub fn commit(args: &Args) -> Json {
    let n = args.num("--batch", 16);
    assert!((1..=256).contains(&n));
    let path = fresh(args.req("--dir"), "optimistic-commit");
    let engine = create(&path, "FULL");
    let settings = pragmas(&engine);
    let t = catalog(engine.store().conn(), "counters");
    let initial_seq: i64 = engine
        .store()
        .conn()
        .query_row("SELECT COALESCE(MAX(seq),0) FROM _commits", [], |r| {
            r.get(0)
        })
        .unwrap();
    drop(engine);
    let conn = Connection::open(&path).unwrap();
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")
        .unwrap();
    let mut writer = Writer {
        conn,
        values: HashMap::new(),
        seq: initial_seq,
        t,
    };
    writer.conn.execute_batch("CREATE TABLE _s1a_footprints(revision INTEGER PRIMARY KEY, keys TEXT NOT NULL, authority TEXT NOT NULL)").unwrap();
    let timing = Timing::from_env();
    let mut runs = Vec::new();
    let mut total = 0i64;
    for run in 0..args.runs() {
        // One timed Op per member, sharing the batch's start/end. This
        // measures durable precomputed batches without producer starvation.
        let begin = Instant::now();
        let t0 = begin + timing.warmup;
        let t1 = t0 + timing.measure;
        let mut ops = Vec::new();
        let mut errors = Vec::new();
        let mut i = 0;
        while Instant::now() < t1 {
            let start = Instant::now();
            if let Err(e) = writer.batch(n, run, i) {
                errors.push(e);
                break;
            }
            let end = Instant::now();
            ops.extend(std::iter::repeat_n(
                Op {
                    end,
                    latency_us: (end - start).as_secs_f64() * 1e6,
                    calls: 0,
                },
                n,
            ));
            total += n as i64;
            i += 1;
        }
        runs.push(summarize(
            &ops,
            t0,
            t1,
            None,
            None,
            vec![ops.iter().filter(|o| o.end >= t0 && o.end <= t1).count()],
            errors,
            None,
        ));
    }
    let sum: i64 = writer
        .conn
        .query_row(
            "SELECT sum(json_extract(data,'$.Row.value.Int')) FROM r WHERE t=?1",
            [t],
            |r| r.get(0),
        )
        .unwrap();
    let receipts: i64 = writer
        .conn
        .query_row("SELECT count(*) FROM _ops", [], |r| r.get(0))
        .unwrap();
    let logged: i64 = writer
        .conn
        .query_row(
            "SELECT count(*) FROM _log WHERE t='counters' AND seq>?1",
            [initial_seq],
            |r| r.get(0),
        )
        .unwrap();
    let footprints: i64 = writer
        .conn
        .query_row("SELECT count(*) FROM _s1a_footprints", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        (total, total, total, total),
        (sum, receipts, logged, footprints)
    );
    let revision: String = writer.conn.query_row("SELECT value FROM _meta WHERE key='s1a_revision'", [], |r| r.get(0)).unwrap();
    let pin: String = writer.conn.query_row("SELECT value FROM _meta WHERE key='time_audience_clock'", [], |r| r.get(0)).unwrap();
    assert_eq!(revision.parse::<i64>().unwrap(), writer.seq);
    assert_eq!(pin.parse::<i64>().unwrap(), writer.seq);
    assert_eq!(writer.conn.query_row("PRAGMA synchronous", [], |r|r.get::<_,i64>(0)).unwrap(), 2);
    json!({"cell":"sqlite-commit","label":"MODEL: N precomputed disjoint increments per WAL write transaction, synchronous=FULL; latency excludes external queue/fill",
        "batch":n,"store":path,"pragmas":settings,"counter_check":{"acknowledged":total,"counter_sum":sum,"ok":total==sum},
        "receipts":receipts,"log_rows":logged,"footprints":footprints,"revision":revision,"pin":pin,"summary":aggregate(&runs),"runs":runs})
}
