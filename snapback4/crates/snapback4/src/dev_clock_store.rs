//! Bounded, read-only evidence from the store's own commit clock.
use snapback4_core::{Engine, RuntimeError};
use std::collections::BTreeSet;

const TOLERANCE_MS: i64 = 5_000;
const RECENT_COMMITS: usize = 64;
const TABLE_BYTES: usize = 4096;
const TABLE_NAMES: usize = 8;

// @ref LLP 3000.007#20.12 — inspect a fixed recent commit window, never application row values.
pub fn ahead(engine: &Engine, now: i64) -> Result<Option<String>, RuntimeError> {
    // Reverse primary-key traversal: no full scan, sort, row payloads or retained
    // historical stamp set. octet_length(column) uses SQLite record metadata;
    // unlike a text length/cast/substr, it need not load oversized payloads.
    let mut query = engine.store().conn().prepare(
        "SELECT at, CASE WHEN at > ?1 AND octet_length(touched) <= ?2 THEN CAST(touched AS BLOB) END,
         octet_length(touched) FROM _commits ORDER BY seq DESC LIMIT ?3")?;
    let mut rows = query.query(rusqlite::params![now.saturating_add(TOLERANCE_MS), TABLE_BYTES as i64, RECENT_COMMITS as i64])?;
    let mut lead = 0;
    let mut tables = BTreeSet::new();
    let mut omitted = false;
    while let Some(row) = rows.next()? {
        let at: i64 = row.get(0)?;
        if at <= now.saturating_add(TOLERANCE_MS) { continue; }
        lead = lead.max(at.saturating_sub(now));
        let length: i64 = row.get(2)?;
        if length > TABLE_BYTES as i64 { omitted = true; continue; }
        let bytes: Vec<u8> = row.get(1)?;
        match serde_json::from_slice::<Vec<String>>(&bytes) {
            Ok(names) => for name in names {
                if tables.contains(&name) { continue; }
                if tables.len() < TABLE_NAMES && name.len() <= 128 { tables.insert(name); }
                else { omitted = true; }
            },
            Err(_) => omitted = true,
        }
    }
    if lead == 0 { return Ok(None); }
    let mut names = tables.into_iter().collect::<Vec<_>>();
    if omitted { names.push("additional tables omitted".into()); }
    if names.is_empty() { names.push("no table names recorded".into()); }
    Ok(Some(format!(
        "N_CLOCK_STORE_AHEAD: recent commit stamps lead the current clock by up to {lead}ms (latest {RECENT_COMMITS} commits; tables: {}); use a fresh store per offset test (dev --fresh --port 4401), or restart with the same --clock-offset to continue",
        names.join(", "))))
}

pub fn has_data(engine: &Engine) -> bool {
    engine.store().conn().query_row("SELECT EXISTS(SELECT 1 FROM r)", [], |r| r.get(0)).unwrap_or(false)
}

pub fn offset_line(offset: i64, running: bool) -> String {
    format!("clock     offset from wall time: {offset:+}ms{}", if running { " (lasts until restart)" } else { " (no running dev; inspecting against wall time)" })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn engine() -> Engine {
        let bound = snapback4_lang::compile(&[("schema.q".into(), "table alpha:\n  at: time\n  public\ntable beta:\n  at: time\n  public\n".into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        Engine::new_at(snapback4_core::Store::memory().unwrap(), bound.schema,
            bound.programs.into_iter().map(|p| p.program), 100_000).unwrap()
    }
    fn seed(engine: &mut Engine, table: &str, commit_at: i64, row_at: i64) {
        engine.seed_at([(table.into(), snapback4_core::value::object([
            ("id", snapback4_core::Value::Id(snapback4_core::ids::mint(row_at, &mut 0).unwrap())),
            ("at", snapback4_core::Value::Int(row_at)),
        ]))], commit_at).unwrap();
    }
    #[test]
    fn commit_tolerance_and_largest_lead_ignore_future_application_values() {
        let mut engine = engine();
        seed(&mut engine, "alpha", 100_000, 1_000_000);
        assert!(ahead(&engine, 100_000).unwrap().is_none());
        seed(&mut engine, "alpha", 105_000, 2_000_000);
        seed(&mut engine, "beta", 107_000, 3_000_000);
        let note = ahead(&engine, 100_000).unwrap().unwrap();
        assert!(note.contains("up to 7000ms (latest 64 commits; tables: beta)"), "{note}");
        let note = ahead(&engine, 99_999).unwrap().unwrap();
        assert!(note.contains("up to 7001ms (latest 64 commits; tables: alpha, beta)"), "{note}");
        assert!(ahead(&engine, 102_000).unwrap().is_none());
    }
    #[test]
    fn recent_window_does_not_claim_older_commits_or_read_row_payloads() {
        let mut engine = engine();
        seed(&mut engine, "alpha", 200_000, 200_000);
        for n in 0..RECENT_COMMITS { seed(&mut engine, "beta", 100_000, 300_000 + n as i64); }
        // Deliberately unreadable images: metadata inspection must not deserialize them.
        engine.store().conn().execute("UPDATE r SET data = 'not json'", []).unwrap();
        assert!(ahead(&engine, 100_000).unwrap().is_none());
        engine.store().conn().execute("UPDATE _commits SET at = 200000, touched = ?1 WHERE seq = (SELECT MAX(seq) FROM _commits)", ["x".repeat(TABLE_BYTES + 1)]).unwrap();
        let note = ahead(&engine, 100_000).unwrap().unwrap();
        assert!(note.contains("100000ms") && note.contains("additional tables omitted"), "{note}");
    }
}
