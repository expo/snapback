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
        "N_CLOCK_STORE_AHEAD: recent commit stamps lead the current clock by up to {lead}ms (latest {RECENT_COMMITS} commits; tables: {}); use a fresh store per offset test (dev --fresh --port 4401), or restart with the same --clock-offset (or dev --resume-clock) to continue",
        names.join(", "))))
}

/// UTC calendar text for Unix milliseconds: schedule boundaries are UTC.
pub fn utc(ms: i64) -> String {
    let (days, rem) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    // Civil-from-days (proleptic Gregorian), exact for the I53 range.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", rem / 3_600_000, rem % 3_600_000 / 60_000, rem % 60_000 / 1_000)
}

/// A positive duration in the units `clock advance` accepts, rounded up to a second.
pub fn span(ms: i64) -> String {
    let seconds = (ms.max(0) + 999) / 1_000;
    let (d, h, m, s) = (seconds / 86_400, seconds % 86_400 / 3_600, seconds % 3_600 / 60, seconds % 60);
    let parts: Vec<String> = [(d, "d"), (h, "h"), (m, "m"), (s, "s")].into_iter().filter(|(n, _)| *n > 0).map(|(n, unit)| format!("{n}{unit}")).collect();
    if parts.is_empty() { "0s".into() } else { parts.join("") }
}

/// Each schedule's saved boundary, in declaration order.
pub fn saved_boundaries(engine: &Engine) -> Vec<Option<i64>> {
    engine.schema().schedules.iter()
        .map(|schedule| engine.store().meta(&format!("schedule:{}", schedule.name)).ok().flatten().and_then(|value| value.parse().ok()))
        .collect()
}

fn period(schedule: &snapback4_core::schema::Schedule) -> String {
    schedule.describe()
}

/// What each schedule did on one clock advance, and why one did not fire.
/// The core fires each schedule at most once per advance, for the latest
/// boundary, and holds it while its saved boundary is ahead of the clock.
// @ref LLP 3000#7-decisions-during-execution — missed boundaries fire once; this only explains them.
pub fn schedule_report(engine: &Engine, before: &[Option<i64>], fired: &[String], now: i64, held: bool) -> Vec<serde_json::Value> {
    let after = saved_boundaries(engine);
    let runs = engine.jobs(64).unwrap_or_default();
    engine.schema().schedules.iter().enumerate().map(|(index, schedule)| {
        let (old, saved) = (before.get(index).copied().flatten(), after.get(index).copied().flatten());
        let current = schedule.boundary(now);
        let next = schedule.next(current);
        let mut entry = serde_json::json!({ "name": schedule.name, "target": schedule.target, "period": period(schedule), "fired": false, "nextBoundary": utc(next) });
        if fired.contains(&schedule.name) {
            let end = saved.unwrap_or(current);
            entry["fired"] = true.into();
            let start = schedule.previous(end);
            entry["periodStart"] = start.into();
            entry["periodEnd"] = end.into();
            entry["reason"] = format!("fired for the period {} to {}", utc(start), utc(end)).into();
            if let Some(run) = runs.iter().find(|run| run.name == schedule.target) {
                entry["run"] = serde_json::json!({ "state": run.state, "rowsWritten": run.rows_written, "error": run.error });
            }
            // @ref LLP 3000.040#24-monthly-and-yearly-schedules — calendar periods count boundaries, not milliseconds.
            let skipped = old.map(|old| schedule.periods_between(old, end) - 1).unwrap_or(0);
            if skipped > 0 {
                entry["skippedPeriods"] = skipped.into();
                entry["reason"] = format!("fired once, for the latest period {} to {}; {skipped} earlier period{} this advance crossed (from {}) did not run: missed boundaries fire once. Run {} with periodStart/periodEnd for an earlier period",
                    utc(start), utc(end), if skipped == 1 { "" } else { "s" }, utc(old.unwrap_or(end)), schedule.target).into();
            }
        } else if held {
            entry["reason"] = "schedules are held (dev --hold-schedules or --replay); a restart without the flag resumes at the next boundary".into();
        } else if let Some(saved) = saved.filter(|saved| *saved > current) {
            let due = schedule.next(saved);
            entry["heldUntil"] = utc(due).into();
            entry["nextBoundary"] = utc(due).into();
            entry["reason"] = format!("held by the store: its saved boundary {} is ahead of the clock {} (a dev restart resets the clock offset; the store keeps the boundary). Advance {} more, restart with dev --resume-clock, or test on dev --fresh",
                utc(saved), utc(now), span(due - now)).into();
        } else if old != saved {
            entry["reason"] = format!("{} started at boundary {}: a schedule fires at the boundary after the first one it sees, next {} ({} from now)",
                if old.is_none() { "this schedule" } else { "this changed schedule" }, utc(saved.unwrap_or(current)), utc(next), span(next - now)).into();
        } else {
            entry["reason"] = format!("next boundary {} ({} from now; schedule times are UTC)", utc(next), span(next - now)).into();
        }
        entry
    }).collect()
}

/// Startup lines for schedules the store holds: their saved boundary leads the clock.
pub fn held_schedules(engine: &Engine, now: i64) -> Vec<String> {
    engine.schema().schedules.iter().zip(saved_boundaries(engine)).filter_map(|(schedule, saved)| {
        let saved = saved.filter(|saved| *saved > schedule.boundary(now))?;
        let due = schedule.next(saved);
        Some(format!("clock     schedule {} is held until {} ({} from now): its saved boundary {} is ahead of this clock; `clock advance {}` or restart with dev --resume-clock",
            schedule.name, utc(due), span(due - now), utc(saved), span(due - now)))
    }).collect()
}

/// The dev clock offset that continues a store's own time: its newest
/// recent commit stamp (or saved schedule boundary) less wall time, never negative.
pub fn resume_offset(store: &snapback4_core::Store, wall: i64) -> Result<i64, RuntimeError> {
    let commit: Option<i64> = store.conn().query_row(
        "SELECT MAX(at) FROM (SELECT at FROM _commits ORDER BY seq DESC LIMIT ?1)", [RECENT_COMMITS as i64], |row| row.get(0))?;
    let mut statement = store.conn().prepare("SELECT value FROM _meta WHERE key LIKE 'schedule:%'")?;
    let boundary = statement.query_map([], |row| row.get::<_, String>(0))?.flatten().filter_map(|value| value.parse::<i64>().ok()).max();
    let latest = commit.into_iter().chain(boundary).max().unwrap_or(wall);
    // Whole seconds, rounded up, so restarting twice does not drift backwards.
    Ok((latest.saturating_sub(wall).max(0) + 999) / 1_000 * 1_000)
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
            ("id", snapback4_core::Value::Id(snapback4_core::ids::mint(row_at, &mut snapback4_core::ids::Mint::default()).unwrap())),
            ("at", snapback4_core::Value::Int(row_at)),
        ]))], commit_at).unwrap();
    }
    #[test]
    fn utc_text_and_spans_match_the_calendar() {
        assert_eq!(utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(utc(951_782_400_000), "2000-02-29T00:00:00Z");
        assert_eq!(utc(-1), "1969-12-31T23:59:59Z");
        assert_eq!(utc(1_791_468_000_000), "2026-10-08T14:00:00Z");
        assert_eq!(span(12_633_000), "3h30m33s");
        assert_eq!(span(86_400_001), "1d1s");
        assert_eq!(span(0), "0s");
    }
    #[test]
    fn resume_offset_follows_the_newest_commit_and_is_never_negative() {
        let mut engine = engine();
        assert_eq!(resume_offset(engine.store(), 100_000).unwrap(), 0);
        seed(&mut engine, "alpha", 3_700_500, 1);
        assert_eq!(resume_offset(engine.store(), 100_000).unwrap(), 3_601_000);
        assert_eq!(resume_offset(engine.store(), 9_000_000).unwrap(), 0);
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
