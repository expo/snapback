//! Bounded, read-only evidence from the store's own commit clock.
use snapback4_core::{Engine, RuntimeError};
use std::collections::BTreeSet;

const SKIPPED_PREVIEW: usize = 32;
const TOLERANCE_MS: i64 = 5_000;
const RECENT_COMMITS: usize = 64;
const TABLE_BYTES: usize = 4096;
const TABLE_NAMES: usize = 8;
const REPORT_ERROR_BYTES: usize = 1024;
// Reserve one MiB for the outer clock/work envelope inside the host encoder.
// The reply retains `schedules` and its fired/held partition.
const REPORT_BYTE_BUDGET: usize = (crate::serve::JSON_RESPONSE_CEILING - (1 << 20)) / 2;

// @ref LLP 3000.007#20.12 — inspect a fixed recent commit window, never application row values.
pub fn ahead(engine: &Engine, now: i64) -> Result<Option<String>, RuntimeError> {
    // Reverse primary-key traversal: no full scan, sort, row payloads or retained
    // historical stamp set. octet_length(column) uses SQLite record metadata;
    // unlike a text length/cast/substr, it need not load oversized payloads.
    let mut lead = 0;
    let mut tables = BTreeSet::new();
    let mut omitted = false;
    engine.store().visit_recent_commit_clock(now.saturating_add(TOLERANCE_MS), TABLE_BYTES as i64, RECENT_COMMITS as i64, |record| {
        let at = record.at;
        if at <= now.saturating_add(TOLERANCE_MS) { return Ok(()); }
        lead = lead.max(at.saturating_sub(now));
        let length = record.length.ok_or_else(|| RuntimeError::Store("commit clock record is missing touched length".into()))?;
        if length > TABLE_BYTES as i64 { omitted = true; return Ok(()); }
        let bytes = record.touched.ok_or_else(|| RuntimeError::Store("commit clock record is missing touched bytes".into()))?;
        match serde_json::from_slice::<Vec<String>>(&bytes) {
            Ok(names) => for name in names {
                if tables.contains(&name) { continue; }
                if tables.len() < TABLE_NAMES && name.len() <= 128 { tables.insert(name); }
                else { omitted = true; }
            },
            Err(_) => omitted = true,
        }
        Ok(())
    })?;
    if lead == 0 { return Ok(None); }
    let mut names = tables.into_iter().collect::<Vec<_>>();
    if omitted { names.push("additional tables omitted".into()); }
    if names.is_empty() { names.push("no table names recorded".into()); }
    Ok(Some(format!(
        "N_CLOCK_STORE_AHEAD: recent commit stamps lead the current clock by up to {lead}ms (latest {RECENT_COMMITS} commits; tables: {}); use a fresh store per offset test ({}), or restart with the same --clock-offset (or dev --resume-clock) to continue",
        names.join(", "), crate::dev_clock::isolated_command())))
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
        .map(|schedule| {
            let shape = engine.store().schedule_shape(&schedule.name).ok().flatten();
            if shape.as_ref().is_some_and(|shape| *shape != snapback4_core::value::digest(schedule)) { return None; }
            engine.store().schedule_boundary(&schedule.name).ok().flatten()
        })
        .collect()
}

/// Preflight is bounded before the clock or worker leases change.
// @ref LLP 3000.007#20.12.1 — only explicit execution enumerates all crossed windows; coalesced reports keep a bounded preview.
pub fn crossed_boundaries(engine: &Engine, before: &[Option<i64>], now: i64, held: bool, each_boundary: bool) -> Result<Vec<(usize, i64)>, snapback4_core::Refusal> {
    let mut boundaries = Vec::new();
    let mut report_bytes = 0usize;
    for (index, schedule) in engine.schema().schedules.iter().enumerate() {
        // JSON may escape every error byte; count that bound per schedule.
        report_bytes = report_bytes.saturating_add(2048 + 6 * (REPORT_ERROR_BYTES + 3) + 8 * (schedule.name.len() + schedule.target.len()));
        if report_bytes > REPORT_BYTE_BUDGET { return Err(crate::dev_clock::input("schedule report exceeds its byte budget; reduce the declared schedules")); }
        if held { continue; }
        let Some(old) = before.get(index).copied().flatten() else { continue; };
        let end = schedule.boundary(now);
        if old >= end { continue; }
        let periods = schedule.periods_between(old, end);
        if each_boundary && periods > (10_000 - boundaries.len()) as i64 {
            return Err(crate::dev_clock::input("--each-boundary crosses more than 10000 schedule windows; use a smaller duration or omit --each-boundary to coalesce"));
        }
        report_bytes = report_bytes.saturating_add((if each_boundary { periods as usize } else { (periods as usize).min(SKIPPED_PREVIEW + 1) }).saturating_mul(1024 + 8 * schedule.target.len()));
        if report_bytes > REPORT_BYTE_BUDGET { return Err(crate::dev_clock::input("schedule window report exceeds its byte budget; use a smaller duration")); }
        if !each_boundary { continue; }
        let mut boundary = schedule.next(old);
        while boundary <= end {
            boundaries.push((index, boundary));
            boundary = schedule.next(boundary);
        }
    }
    boundaries.sort_by_key(|(index, at)| (*at, *index));
    Ok(boundaries)
}

// @ref LLP 3000.000.000.001#11-wave-22-loop-repairs-dx6 — no silent successful advance behind retained schedule markers.
pub fn refuse_held(engine: &Engine, before: &[Option<i64>], current_clock: i64, now: i64) -> Result<(), snapback4_core::Refusal> {
    for (schedule, saved) in engine.schema().schedules.iter().zip(before) {
        // Equality is the already processed current window, not a hold. The
        // authoritative requested clock defines the window, never wall time.
        if let Some(saved) = saved.filter(|saved| *saved > schedule.boundary(now)) {
            return Err(snapback4_core::Refusal::new("E_CLOCK_HELD", "clock", format!(
                "schedule {} already processed boundary {}; requested clock {} is in an earlier window; next unprocessed boundary is {}. Nothing advanced. Advance {} to reach the saved window or use a fresh staging deployment; allowHeld:true explicitly accepts this hold. Never rewind saved boundaries",
                schedule.name, utc(saved), utc(now), utc(schedule.next(saved)), format!("{}ms", saved.saturating_sub(current_clock)))).guide("clock"));
        }
    }
    Ok(())
}

fn period(schedule: &snapback4_core::schema::Schedule) -> String {
    schedule.describe()
}

/// What each schedule did on one clock advance, and why one did not fire.
/// The core fires each schedule at most once per advance, for the latest
/// boundary, and holds it while its saved boundary is ahead of the clock.
// @ref LLP 3000#7-decisions-during-execution — missed boundaries fire once; this only explains them.
pub fn schedule_report(engine: &Engine, before: &[Option<i64>], fired: &[String], now: i64, current_clock: i64, held: bool, each_boundary: bool, port: Option<u16>) -> Vec<serde_json::Value> {
    let after = saved_boundaries(engine);
    // Read only bounded summaries: job args/cursors and full error payloads
    // are irrelevant to this report and must not be loaded then replicated.
    let runs = job_summaries(engine).unwrap_or_default();
    engine.schema().schedules.iter().enumerate().map(|(index, schedule)| {
        let (old, saved) = (before.get(index).copied().flatten(), after.get(index).copied().flatten());
        let current = schedule.boundary(now);
        let next = schedule.next(current);
        let mut entry = serde_json::json!({ "name": schedule.name, "target": schedule.target, "period": period(schedule), "fired": false, "firedWindows": [], "skippedBoundaries": [], "nextBoundary": utc(next) });
        if fired.contains(&schedule.name) {
            let end = saved.unwrap_or(current);
            entry["fired"] = true.into();
            let start = schedule.previous(end);
            let window = |boundary| serde_json::json!({"periodStart": schedule.previous(boundary), "periodEnd": boundary});
            let mut windows = Vec::new();
            if each_boundary {
                if let Some(old) = old {
                    let mut at = schedule.next(old);
                    while at <= end { windows.push(window(at)); at = schedule.next(at); }
                }
            } else { windows.push(window(end)); }
            if each_boundary {
                entry["reason"] = format!("fired {} windows: {}", windows.len(), windows.iter().map(|window| format!("{} to {}", utc(window["periodStart"].as_i64().unwrap()), utc(window["periodEnd"].as_i64().unwrap()))).collect::<Vec<_>>().join("; ")).into();
            }
            entry["firedWindows"] = windows.into();
            entry["periodStart"] = start.into();
            entry["periodEnd"] = end.into();
            if !each_boundary { entry["reason"] = format!("fired for the period {} to {}", utc(start), utc(end)).into(); }
            if let Some(run) = runs.get(&schedule.target) { entry["run"] = run.clone(); }
            // @ref LLP 3000.040#24-monthly-and-yearly-schedules — calendar periods count boundaries, not milliseconds.
            let skipped = if each_boundary { 0 } else { old.map(|old| schedule.periods_between(old, end) - 1).unwrap_or(0) };
            if skipped > 0 {
                entry["skippedPeriods"] = skipped.into();
                let mut windows = Vec::new();
                let mut at = schedule.next(old.unwrap());
                while at < end && windows.len() < SKIPPED_PREVIEW {
                    let mut item = window(at);
                    let mut args = serde_json::Map::new();
                    if let Some(program) = engine.program(&schedule.target) {
                        if program.args.contains_key("periodStart") { args.insert("periodStart".into(), schedule.previous(at).into()); }
                        if program.args.contains_key("periodEnd") { args.insert("periodEnd".into(), at.into()); }
                    }
                    item["command"] = format!("snapback4 run {} '{}'{}", schedule.target, serde_json::Value::Object(args), port.map(|port| format!(" --port {port}")).unwrap_or_default()).into();
                    windows.push(item); at = schedule.next(at);
                }
                entry["skippedBoundariesOmitted"] = (skipped - windows.len() as i64).into();
                entry["skippedBoundaries"] = windows.into();
                entry["reason"] = format!("fired once, for the latest period {} to {}; {skipped} earlier period{} this advance crossed (from {}) did not run: missed boundaries fire once. Run {} with periodStart/periodEnd for an earlier period",
                    utc(start), utc(end), if skipped == 1 { "" } else { "s" }, utc(old.unwrap_or(end)), schedule.target).into();
            }
        } else if held {
            entry["holdCode"] = "disabled".into();
            entry["reason"] = "schedules are held by explicit maintenance control; clock drain resumes paused work (a staging pause survives restart); dev --hold-schedules/--replay require restarting without the flag".into();
        } else if let Some(saved) = saved.filter(|saved| old.is_some() && *saved > current) {
            let due = schedule.next(saved);
            entry["holdCode"] = "saved-boundary".into();
            entry["savedBoundary"] = saved.into();
            entry["heldUntil"] = utc(saved).into();
            entry["nextBoundary"] = utc(due).into();
            entry["reason"] = format!("held by the store: boundary {} was already processed and this clock {} is in an earlier window (an explicitly selected clock is behind the saved boundary). One fire per boundary. Advance {} more to reach the saved window, or use a fresh staging deployment/store for an independent test; keep the same --clock-offset when continuing a test across serve restarts",
                utc(saved), utc(now), span(saved.saturating_sub(current_clock))).into();
        } else if old != saved {
            entry["holdCode"] = "initialized".into();
            entry["reason"] = format!("{} started at boundary {}: a schedule fires at the boundary after the first one it sees, next {} ({} from now)",
                if old.is_none() { "this schedule" } else { "this changed schedule" }, utc(saved.unwrap_or(current)), utc(next), span(next - now)).into();
        } else {
            entry["holdCode"] = "not-due".into();
            entry["reason"] = format!("next boundary {} ({} from now; schedule times are UTC)", utc(next), span(next - now)).into();
        }
        entry
    }).collect()
}

// @ref LLP 3000.000.000.001#10-wave-20-loop-repairs-dx5 — every declared schedule has one reported outcome.
pub fn outcomes(schedules: &[serde_json::Value]) -> (Vec<serde_json::Value>, Vec<serde_json::Value>) {
    schedules.iter().cloned().partition(|schedule| schedule["fired"] == true)
}

/// The report never loads full error/argument payloads from retained jobs.
fn job_summaries(engine: &Engine) -> Result<std::collections::BTreeMap<String, serde_json::Value>, RuntimeError> {
    let mut summaries = std::collections::BTreeMap::new();
    for summary in engine.store().job_summaries(REPORT_ERROR_BYTES)? {
        let name = summary.name;
        if summaries.contains_key(&name) { continue; }
        let mut error = summary.error;
        let truncated = summary.error_truncated;
        if let Some(text) = &mut error && truncated {
            let mut end = REPORT_ERROR_BYTES.min(text.len());
            while !text.is_char_boundary(end) { end -= 1; }
            text.truncate(end); text.push('…');
        }
        summaries.insert(name, serde_json::json!({ "id":summary.id, "state":summary.state,
            "rowsWritten":summary.rows_written, "error":error, "errorTruncated":truncated }));
    }
    Ok(summaries)
}

/// Startup lines for schedules the store holds: their saved boundary leads the clock.
pub fn held_schedules(engine: &Engine, now: i64) -> Vec<String> {
    engine.schema().schedules.iter().zip(saved_boundaries(engine)).filter_map(|(schedule, saved)| {
        let saved = saved.filter(|saved| *saved > schedule.boundary(now))?;
        let due = schedule.next(saved);
        Some(format!("clock     schedule {} is held until {} ({} from now): catch up to its saved boundary; next unprocessed window {}; `clock advance {}` or restart with dev --resume-clock",
            schedule.name, utc(saved), span(saved - now), utc(due), format!("{}ms", saved - now)))
    }).collect()
}

/// The dev clock offset that continues a store's own time: its newest
/// recent commit stamp (or saved schedule boundary) less wall time, never negative.
pub fn resume_offset(store: &snapback4_core::store_port::AnyStore, wall: i64) -> Result<i64, RuntimeError> {
    let commit = store.recent_commit_max_at(RECENT_COMMITS as i64)?;
    let boundary = store.latest_schedule_boundary()?;
    let latest = commit.into_iter().chain(boundary).max().unwrap_or(wall);
    // Whole seconds, rounded up, so restarting twice does not drift backwards.
    Ok((latest.saturating_sub(wall).max(0) + 999) / 1_000 * 1_000)
}

pub fn has_data(engine: &Engine) -> bool {
    engine.store().inspection_has_data().unwrap_or(false)
}

pub fn offset_line(offset: i64, running: bool) -> String {
    format!("clock     offset from wall time: {offset:+}ms{}", if running { " (development process; staging persists with its store)" } else { " (no running dev; inspecting against wall time)" })
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(super) fn connection(engine: &Engine) -> &rusqlite::Connection { engine.store().test_support_conn() }
    pub(super) fn engine() -> Engine {
        let bound = snapback4_lang::compile(&[("schema.q".into(), "table alpha:\n  at: time\n  public\ntable beta:\n  at: time\n  public\n".into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        Engine::new_at(snapback4_core::store_port::AnyStore::memory().unwrap(), bound.schema,
            bound.programs.into_iter().map(|p| p.program), 100_000).unwrap()
    }
    fn seed(engine: &mut Engine, table: &str, commit_at: i64, row_at: i64) {
        engine.seed_at([(table.into(), snapback4_core::value::object([
            ("id", snapback4_core::Value::Id(snapback4_core::ids::mint(row_at, &mut snapback4_core::ids::Mint::default()).unwrap())),
            ("at", snapback4_core::Value::Int(row_at)),
        ]))], commit_at).unwrap();
    }
    #[test]
    fn clock_report_bounds_one_large_job_error_repeated_across_many_schedules() {
        let mut source = "table rows:\n  n: int\n  public 'fixture'\njob tick():\n  for row in rows:\n    update rows[row.id] {n:1}\n".to_owned();
        for n in 0..500 { source.push_str(&format!("schedule s{n} every 1m: tick\n")); }
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::new_at(snapback4_core::store_port::AnyStore::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p|p.program), 0).unwrap();
        engine.fire_schedules(0).unwrap();
        let before = saved_boundaries(&engine);
        assert_eq!(crossed_boundaries(&engine, &before, 60_000, false, true).unwrap().len(), 500);
        let fired = engine.fire_schedules(60_000).unwrap();
        let message = "🧪\n\\".repeat(30_000);
        connection(&engine).execute("UPDATE _jobs SET error = ?1 WHERE id = (SELECT id FROM _jobs ORDER BY created_at DESC, id DESC LIMIT 1)", [&message]).unwrap();
        let report = schedule_report(&engine, &before, &fired, 60_000, 60_000, false, false, None);
        assert_eq!(report.len(), 500);
        assert!(report.iter().all(|s| s["run"]["errorTruncated"] == true));
        assert!(report.iter().all(|s| s["run"]["error"].as_str().unwrap().len() <= REPORT_ERROR_BYTES + 3));
        assert!(serde_json::to_vec(&report).unwrap().len() < 2 << 20);
    }
    #[test]
    fn clock_report_refuses_before_the_host_encoder_limit() {
        let mut source = "table rows:\n  n: int\n  public 'fixture'\njob tick():\n  for row in rows:\n    update rows[row.id] {n:1}\n".to_owned();
        for n in 0..3000 { source.push_str(&format!("schedule s{n} every 1m: tick\n")); }
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::new_at(snapback4_core::store_port::AnyStore::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p|p.program), 0).unwrap();
        engine.fire_schedules(0).unwrap();
        let before = saved_boundaries(&engine);
        let refusal = crossed_boundaries(&engine, &before, 60_000, false, true).unwrap_err();
        assert_eq!(refusal.code, "E_CLOCK_INPUT");
        assert!(refusal.message.contains("byte budget"));
        assert_eq!(before, saved_boundaries(&engine));
        assert!(REPORT_BYTE_BUDGET < crate::serve::JSON_RESPONSE_CEILING);
    }
    #[test]
    fn startup_hold_instruction_catches_up_without_repeating_the_saved_window() {
        let source = "table rows:\n  n: int\n  public 'fixture'\njob tick():\n  for row in rows:\n    update rows[row.id] {n:1}\nschedule hourly every 1h: tick\n";
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::new_at(snapback4_core::store_port::AnyStore::memory().unwrap(), bound.schema,
            bound.programs.into_iter().map(|p|p.program), 0).unwrap();
        engine.fire_schedules(0).unwrap();
        let saved = 5 * 3_600_000;
        engine.fire_schedules(saved).unwrap();
        let raw = 1_234;
        let lines = held_schedules(&engine, raw);
        assert_eq!(lines.len(), 1);
        let line = &lines[0];
        assert!(line.contains(&format!("held until {}", utc(saved))), "{line}");
        assert!(line.contains(&format!("next unprocessed window {}", utc(saved + 3_600_000))), "{line}");
        let duration = line.split_once("`clock advance ").unwrap().1.split_once('`').unwrap().0;
        let delta = crate::dev_clock::duration(duration).unwrap();
        assert_eq!(delta, saved - raw);
        let before = saved_boundaries(&engine);
        refuse_held(&engine, &before, raw, raw + delta).unwrap();
        assert!(engine.fire_schedules(raw + delta).unwrap().is_empty());
        assert!(held_schedules(&engine, raw + delta).is_empty());
        let report = schedule_report(&engine, &before, &[], raw + delta, raw + delta, false, false, None);
        assert_eq!(report[0]["holdCode"], "not-due");
        assert_eq!(engine.fire_schedules(saved + 3_600_000).unwrap(), vec!["hourly"]);
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
        connection(&engine).execute("UPDATE r SET data = 'not json'", []).unwrap();
        assert!(ahead(&engine, 100_000).unwrap().is_none());
        connection(&engine).execute("UPDATE _commits SET at = 200000, touched = ?1 WHERE seq = (SELECT MAX(seq) FROM _commits)", ["x".repeat(TABLE_BYTES + 1)]).unwrap();
        let note = ahead(&engine, 100_000).unwrap().unwrap();
        assert!(note.contains("100000ms") && note.contains("additional tables omitted"), "{note}");
    }
}

// @ref LLP 3000.000.000.001#12-wave-24-loop-repairs-dx7 — staging owns time; legacy stores recover from retained evidence.
pub fn staging_clock(store: &snapback4_core::store_port::AnyStore, requested: i64, wall: i64) -> Result<snapback4_core::metadata::StagingClock, RuntimeError> {
    use snapback4_core::metadata::{DevMetadata, StagingClock};
    let saved = store.dev_value(DevMetadata::StagingClock)?
        .map(|text| serde_json::from_str::<StagingClock>(&text)
            .map_err(|_| RuntimeError::Input("invalid persisted staging clock; refusing to reset staging time".into())))
        .transpose()?;
    if let Some(saved) = &saved { saved.validate()?; }
    let floor = store.time_audience_clock_value()?.map(|text| text.parse::<i64>()
        .map_err(|_| RuntimeError::Input("invalid staging disclosure clock".into()))).transpose()?.unwrap_or(0);
    let legacy_floor = store.recent_commit_max_at(RECENT_COMMITS as i64)?.into_iter()
        .chain(store.latest_schedule_boundary()?).max().unwrap_or(wall);
    let recovered = if let Some(saved) = &saved { wall.checked_add(saved.offset).unwrap_or(i64::MAX).max(saved.now) }
        else { wall.saturating_add(resume_offset(store, wall)?) };
    let now = wall.checked_add(requested).unwrap_or(i64::MAX).max(recovered).max(floor).max(legacy_floor);
    let state = StagingClock { now, offset: now.saturating_sub(wall), paused: saved.is_some_and(|s| s.paused) };
    state.validate()?;
    Ok(state)
}

#[cfg(test)]
mod staging_tests {
    use super::*;
    use snapback4_core::metadata::{DevMetadata, StagingClock};
    #[test]
    fn staging_checkpoint_recovers_precise_time_pause_and_later_legacy_boundaries() {
        let bound = snapback4_lang::compile(&[("schema.q".into(), "table rows:\n  n: int\n  public 'fixture'\njob tick():\n  for row in rows:\n    update rows[row.id] {n:1}\nschedule hourly every 1h: tick\n".into())]);
        let mut engine = Engine::new_at(snapback4_core::store_port::AnyStore::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p|p.program),0).unwrap();
        engine.store().set_deployment_environment("staging").unwrap();
        let saved = StagingClock {offset:1000,now:2000,paused:true};
        engine.checkpoint_staging_clock_at(0,1000,false,&saved).unwrap();
        let resumed=staging_clock(engine.store(),0,1100).unwrap();
        assert_eq!(resumed.offset,1000);assert_eq!(resumed.now,2100);assert!(resumed.paused);
        let rollback=staging_clock(engine.store(),0,500).unwrap();assert_eq!(rollback.now,2000);
        engine.fire_schedules(0).unwrap();engine.fire_schedules(7_200_000).unwrap();
        let recovered=staging_clock(engine.store(),0,1100).unwrap();assert!(recovered.now>=7_200_000);assert!(recovered.paused);
        engine.store().set_dev_value(DevMetadata::StagingClock,"malformed").unwrap();
        assert!(staging_clock(engine.store(),0,1100).is_err());
    }
    #[test]
    fn failed_checkpoint_keeps_the_previous_time_and_pause_record() {
        let mut engine=super::tests::engine();
        engine.store().set_deployment_environment("staging").unwrap();
        let guest = snapback4_core::identity::guest(engine.store(), 100_000, &mut snapback4_core::ids::Mint::default()).unwrap();
        let expiry = guest.expires_at;
        let old=StagingClock {offset:10,now:100_010,paused:true};
        engine.checkpoint_staging_clock_at(0,100_000,false,&old).unwrap();
        super::tests::connection(&engine).execute_batch("CREATE TRIGGER refuse_clock BEFORE INSERT ON _meta WHEN NEW.key = 'dev:staging-clock' BEGIN SELECT RAISE(ABORT,'injected checkpoint failure'); END;").unwrap();
        for paused in [true,false] {
            let next=StagingClock {offset:1000,now:101_000,paused};
            assert!(engine.checkpoint_staging_clock_at(if paused {1000}else{0},100_000,true,&next).is_err());
            assert_eq!(snapback4_core::identity::resolve(engine.store(), &guest.token, 100_000).unwrap().unwrap().expires_at, expiry, "checkpoint failure rolls back credential preservation");
            assert_eq!(staging_clock(engine.store(),0,100_000).unwrap().now,old.now);
            assert!(staging_clock(engine.store(),0,100_000).unwrap().paused);
        }
        super::tests::connection(&engine).execute_batch("DROP TRIGGER refuse_clock").unwrap();
        let next = StagingClock {offset:1010,now:101_010,paused:true};
        engine.checkpoint_staging_clock_at(1000,100_010,true,&next).unwrap();
        assert_eq!(snapback4_core::identity::resolve(engine.store(), &guest.token, 100_010).unwrap().unwrap().expires_at, expiry + 1000);
        engine.checkpoint_staging_clock_at(0,101_010,false,&next).unwrap();
        assert_eq!(snapback4_core::identity::resolve(engine.store(), &guest.token, 101_010).unwrap().unwrap().expires_at, expiry + 1000, "startup does not shift a preserved credential twice");
    }
}
