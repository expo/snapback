//! Cell 3: the raw Postgres control for the same work (H1's "raw PG").
//! A typed `counters(id text primary key, n bigint)` table; each writer runs
//! `UPDATE counters SET n = n + 1 WHERE id = $1` in autocommit (one round
//! trip, one implicit transaction). Concurrent writers serialize only on the
//! same row, and Postgres group-commits their flushes.
use crate::{Args, common::*, slot};
use serde_json::{Value as Json, json};
use std::sync::Arc;

pub fn run(args: &Args) -> Json {
    let net = Arc::new(Net::parse(args.req("--net")));
    let writers = args.num("--writers", 4);
    let disjoint = args.req("--counters") == "disjoint";
    assert!(writers <= 256);
    let timing = Timing::from_env();
    let schema = format!("cp_raw_{}_{:x}", std::process::id(), snapback4_core::ids::seed() & 0xffff_ffff);
    let mut a = admin();
    a.batch_execute(&format!(
        "CREATE SCHEMA {schema}; CREATE TABLE {schema}.counters (id text COLLATE \"C\" PRIMARY KEY, n bigint NOT NULL);
         INSERT INTO {schema}.counters SELECT 'c' || g, 0 FROM generate_series(0, 255) g; ANALYZE {schema}.counters;"
    ))
    .unwrap();
    let mut runs = Vec::new();
    let mut total = 0i64;
    for _ in 0..args.runs() {
        let (n2, s2) = (net.clone(), schema.clone());
        let result = closed_loop(
            writers,
            &timing,
            Some(true),
            move |_| {
                let mut c = n2.connect();
                c.batch_execute("SET statement_timeout = '5s'; SET lock_timeout = '5s';").unwrap();
                let st = c.prepare(&format!("UPDATE {s2}.counters SET n = n + 1 WHERE id = $1")).unwrap();
                (c, st)
            },
            move |(c, st), w, _| {
                let n = c.execute(st, &[&slot(disjoint, w)]).map_err(|e| format!("{e:?}"))?;
                if n != 1 {
                    return Err("row missing".into());
                }
                Ok(1)
            },
        );
        total += result["total_ops"].as_i64().unwrap();
        runs.push(result);
    }
    let sum: i64 = a.query_one(&format!("SELECT sum(n)::bigint FROM {schema}.counters"), &[]).unwrap().get(0);
    json!({"cell": "raw", "label": "raw Postgres control: typed table, autocommit UPDATE n = n + 1",
        "net": net.describe(), "writers": writers, "counters": if disjoint {"disjoint"} else {"same"}, "schema": schema,
        "counter_check": {"acknowledged": total, "counter_sum": sum, "ok": total == sum},
        "summary": aggregate(&runs), "runs": runs})
}
