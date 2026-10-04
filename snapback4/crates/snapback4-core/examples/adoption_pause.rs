//! Reproduce an activation from persisted generation definitions on a disposable copy.
//! Usage: adoption_pause STORE SCHEMA_JSON PROGRAMS_JSON NOW_MS
use snapback4_core::{engine::Engine, ir::Program, schema::Schema, store::Store};
use std::{collections::BTreeMap, time::Instant};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    assert_eq!(args.len(), 5, "STORE SCHEMA_JSON PROGRAMS_JSON NOW_MS");
    let schema: Schema = serde_json::from_slice(&std::fs::read(&args[2])?)?;
    let programs: BTreeMap<String, Program> = serde_json::from_slice(&std::fs::read(&args[3])?)?;
    let now = args[4].parse()?;
    let mut engine = Engine::open_at(Store::open(std::path::Path::new(&args[1]))?, now)?;
    if let Ok(kib) = std::env::var("AP_CACHE_KIB") {
        engine
            .store()
            .conn()
            .pragma_update(None, "cache_size", -kib.parse::<i64>()?)?;
    }
    let start = Instant::now();
    let generation = engine.adopt_at(schema, programs.into_values(), now)?;
    let elapsed = start.elapsed();
    let report = &engine.store().adoption_report;
    println!(
        "{}",
        serde_json::json!({
            "generation": generation, "total_ms": elapsed.as_secs_f64() * 1000.0,
            "phases": report.phases.iter().map(|(name, time)| (*name, time.as_secs_f64() * 1000.0)).collect::<Vec<_>>(),
            "details": report.details.iter().map(|(name, time)| (name, time.as_secs_f64() * 1000.0)).collect::<Vec<_>>(),
            "views": report.views.iter().map(|v| serde_json::json!({"name": v.name, "rows": v.rows, "ms": v.elapsed.as_secs_f64() * 1000.0})).collect::<Vec<_>>()
        })
    );
    let start = Instant::now();
    engine
        .store()
        .conn()
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    eprintln!(
        "checkpoint_ms={:.3}",
        start.elapsed().as_secs_f64() * 1000.0
    );
    Ok(())
}
