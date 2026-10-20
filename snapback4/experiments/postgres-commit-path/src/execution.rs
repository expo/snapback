//! S1a execution-stage MODEL: the captured increment's reads, no writes.
use crate::{Args, common::*, create_engine, model::Conn, slot};
use serde_json::{Value as Json, json};
use std::sync::Arc;

pub fn run(args: &Args) -> Json {
    let net = Arc::new(Net::parse(args.req("--net")));
    let connections = args.num("--connections", 32);
    assert!((1..=256).contains(&connections));
    let (schema, engine) = create_engine("cpexec");
    drop(engine);
    let timing = Timing::from_env();
    let mut runs = Vec::new();
    for run in 0..args.runs() {
        let (net, schema) = (net.clone(), schema.clone());
        let mut result = closed_loop(connections, &timing, Some(true), move |_| Conn::new(&net, &schema), move |conn, w, i| {
            conn.execution(&slot(true, w), &format!("exec-{run}-{w}-{i}"))
        });
        result["executions_per_s"] = result["commits_per_s"].clone();
        runs.push(result);
    }
    let mut summary = aggregate(&runs);
    summary["executions_per_s_median"] = summary["commits_per_s_median"].clone();
    let unchanged: bool = admin().query_one(&format!(
        "SELECT bool_and((data::jsonb #>> '{{Row,value,Int}}')::bigint = 0) FROM {schema}.r WHERE t='counters'"), &[]).unwrap().get(0);
    assert!(unchanged, "execution model wrote a counter");
    json!({"cell":"pg-execution", "label":"MODEL: eight captured read-only SELECTs in one REPEATABLE READ READ ONLY transaction; no head lock, writes, overlay, validation or reruns",
        "connections":connections, "net":net.describe(), "schema":schema, "reads_per_execution":8,
        "counters_unchanged":unchanged, "summary":summary, "runs":runs})
}
