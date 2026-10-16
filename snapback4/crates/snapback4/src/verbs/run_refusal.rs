//! `run` names the refusing clause in development (LLP 3000.036 §3 B): the
//! dev-only refusal trace already records the table, the clause and its
//! site; `run` prints it under the refusal, locally and when forwarded to a
//! live dev. The wire refusal is unchanged and never names the clause.
// @ref LLP 3000.015#2.1 — the clause is developer evidence, separate from Refusal.
use serde_json::{Value as Json, json};
use snapback4_core::engine::refusal_trace::{RefusalTrace, RefusingClause};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::{Duration, Instant};

/// A local run's trace, in the shape of a dev refusal record.
pub(super) fn local(trace: &RefusalTrace, sites: &BTreeMap<(String, String), String>) -> Option<Json> {
    trace.take().filter(|cause| cause.terminal).map(|cause| record(&cause, sites))
}

/// One recorded cause in the shape of a dev refusal record (`test` cases too).
pub(super) fn record(cause: &RefusingClause, sites: &BTreeMap<(String, String), String>) -> Json {
    let clause = sites.get(&(cause.table.clone(), cause.phase.clone()))
        .or_else(|| sites.get(&(cause.table.clone(), cause.clause.clone())));
    let site = clause.or_else(|| sites.get(&(cause.table.clone(), "table".into())));
    json!({"table": cause.table, "clause": cause.clause, "phase": cause.phase, "viewer": cause.viewer, "terminal": cause.terminal, "site": site,
        "siteKind": if clause.is_some() { "clause" } else if site.is_some() { "table" } else { "" }, "executionSite": cause.site})
}

/// The live dev's instance and newest response sequence, read before sending,
/// so the reply's record can be told from earlier ones.
pub(super) fn baseline(data: &Path) -> Option<(Json, u64)> {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if let Ok(envelope) = crate::serve::dev_refusals::recent(data, None, None) {
            let latest = envelope["records"].as_array().and_then(|records| records.iter().filter_map(|r| r["responseSequence"].as_u64()).max()).unwrap_or(0);
            return Some((envelope["instance"].clone(), latest));
        }
        if Instant::now() >= deadline { return None; }
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// The record that dev wrote for this reply. The dev sequences a record before
/// sending its response, and `recent` answers only when its newest sequence is
/// persisted; so once the reply is in hand, its record lies in (baseline,
/// newest]. Select only when that whole interval is present (no delayed,
/// dropped or evicted record) and exactly one record in it is this
/// operation's refusal with this code; otherwise print nothing.
pub(super) fn forwarded(data: &Path, baseline: Option<(Json, u64)>, op: &str, code: &str) -> Option<Json> {
    let (instance, before) = baseline?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if let Ok(envelope) = crate::serve::dev_refusals::recent(data, None, None) {
            if envelope["instance"] != instance { return None; }
            match select(envelope["records"].as_array()?, before, op, code) {
                Selection::Unique(record) => return Some(record),
                Selection::Ambiguous => return None,
                Selection::Incomplete => {}
            }
        }
        if Instant::now() >= deadline { return None; }
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[derive(Debug, PartialEq)]
enum Selection { Unique(Json), Ambiguous, Incomplete }

fn select(records: &[Json], before: u64, op: &str, code: &str) -> Selection {
    let after: Vec<&Json> = records.iter().filter(|r| r["responseSequence"].as_u64().is_some_and(|n| n > before)).collect();
    let mut sequences: Vec<u64> = after.iter().filter_map(|r| r["responseSequence"].as_u64()).collect();
    sequences.sort_unstable();
    let contiguous = !sequences.is_empty() && sequences.iter().enumerate().all(|(i, n)| *n == before + 1 + i as u64);
    if !contiguous { return Selection::Incomplete; }
    let mut matches = after.into_iter().filter(|r| r["operation"] == op && r["code"] == code);
    match (matches.next(), matches.next()) {
        (Some(record), None) => Selection::Unique(record.clone()),
        (Some(_), Some(_)) => Selection::Ambiguous,
        (None, _) => Selection::Ambiguous,
    }
}

/// Print the explanation, if the record names a clause, to stderr (stdout
/// stays the refusal and its JSON). `sources` are the exact files that ran
/// (a local run's captured sources); a forwarded run's dev may be on another
/// generation than the files on disk, so it quotes no source text.
pub(super) fn print(record: Option<Json>, sources: Option<&[(String, String)]>) {
    let sources: Option<BTreeMap<&str, &str>> = sources.map(|files| files.iter().map(|(name, text)| (name.as_str(), text.as_str())).collect());
    let lookup = |file: &str| sources.as_ref().and_then(|files| files.get(file).map(|text| (*text).to_owned()));
    if let Some(text) = record.and_then(|record| explain(&record, &lookup)) { eprintln!("{text}"); }
}

/// Strip a trailing `--` comment outside quotes.
fn code(line: &str) -> &str {
    let mut quote = None;
    let mut escaped = false;
    for (at, c) in line.char_indices() {
        match quote {
            Some(q) => { if escaped { escaped = false } else if c == '\\' { escaped = true } else if c == q { quote = None } }
            None if c == '\'' || c == '"' => quote = Some(c),
            None if line[at..].starts_with("--") => return line[..at].trim_end(),
            None => {}
        }
    }
    line
}

/// The source line a `file:line:col` site points at, without its comment.
pub(super) fn quote(site: &str, source: &dyn Fn(&str) -> Option<String>) -> Option<String> { source_line(site, source) }

fn source_line(site: &str, source: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    let mut parts = site.rsplitn(3, ':');
    let (_col, line, file) = (parts.next()?, parts.next()?.parse::<usize>().ok()?, parts.next()?);
    let text = source(file)?;
    let line = code(text.lines().nth(line.checked_sub(1)?)?.trim());
    (!line.is_empty()).then(|| line.to_owned())
}

pub(super) fn explain(record: &Json, source: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    let table = record["table"].as_str()?;
    let clause = record["clause"].as_str()?;
    if clause == "cause not instrumented" || clause == "no-candidate" { return None; }
    let site = record["site"].as_str();
    let at = record["executionSite"].as_str().map(|s| format!(", at {s}")).unwrap_or_default();
    // Only a table rule's own clause is the rule line; any other recorded cause
    // (an authorization allowance, a unique key, sequence read authority) is
    // named as recorded, beside the line its site points at.
    let effect = ["read", "insert", "update", "delete"].into_iter().find(|effect| clause == format!("{effect} rule"));
    let table_site = record["siteKind"] == "table";
    let generation = record["generation"].as_u64().map(|g| format!(", generation {g}")).unwrap_or_default();
    let text = match (effect, site, site.and_then(|site| source_line(site, source))) {
        // An omitted rule binds to deny; its record points at the table.
        (Some(effect), Some(site), _) if table_site => format!("no `{effect}` rule, so {effect} is deny (table at {site}{generation})"),
        (Some(_), Some(site), Some(line)) => format!("`{line}` ({site})"),
        (None, Some(site), Some(line)) => format!("{clause}, at `{line}` ({site})"),
        (_, site, _) => format!("{clause} ({}{generation})", site.unwrap_or("<generated>")),
    };
    let text = if let Some(phase) = record["phase"].as_str().filter(|phase| phase.starts_with("table authorization layer:")) {
        format!("{text}; {phase}")
    } else { text };
    let viewer = record["viewer"].as_str().unwrap_or("this viewer");
    let mut out = if effect == Some("read") && record["terminal"] == false {
        format!("dev: hidden from {viewer} by {table}'s read rule: {text}{at} — development evidence only; the refusal a client sees never names the clause")
    } else {
        format!("dev: {table} refused it: {text}{at} — development evidence only; the refusal a client sees never names the clause")
    };
    if matches!(effect, Some("insert" | "update" | "delete")) {
        out.push_str("\n  a mutation's writes pass the table's insert, update and delete rules as the caller; only a job runs as the system (guide rules)");
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: &str = "table orders:\n  author: principal\n  read <- .author = viewer\n  update <- deny   -- frozen\n";

    #[test]
    fn names_the_written_clause_and_its_line() {
        let record = json!({"table":"orders","clause":"update rule","phase":"update rule","site":"schema.q:4:3","siteKind":"clause","executionSite":"submit:2"});
        let text = explain(&record, &|file| (file == "schema.q").then(|| SCHEMA.to_owned())).unwrap();
        assert!(text.starts_with("dev: orders refused it: `update <- deny` (schema.q:4:3), at submit:2 — "), "{text}");
        assert!(text.contains("only a job runs as the system"), "{text}");
    }

    #[test]
    fn a_service_lookup_names_the_read_rule_hiding_it() {
        let record = json!({"table":"scenes","viewer":"service:ops","terminal":false,"clause":"read rule","phase":"read rule","site":"schema.q:3:3","executionSite":"bootstrap:2"});
        let source = "table scenes:\n  owner: principal\n  read <- .owner = viewer\n";
        let text = explain(&record, &|_| Some(source.into())).unwrap();
        assert!(text.starts_with("dev: hidden from service:ops by scenes's read rule"), "{text}");
        assert!(text.contains("read <- .owner = viewer"));
    }

    #[test]
    fn an_omitted_rule_is_named_as_deny_at_the_table() {
        let record = json!({"table":"orders","clause":"delete rule","phase":"delete rule","site":"schema.q:1:1","siteKind":"table","executionSite":"drop:1","generation":2});
        let text = explain(&record, &|_| Some(SCHEMA.to_owned())).unwrap();
        assert!(text.starts_with("dev: orders refused it: no `delete` rule, so delete is deny (table at schema.q:1:1, generation 2), at drop:1"), "{text}");
        // Without the source that ran (a forwarded run), the record is still named.
        assert_eq!(explain(&record, &|_| None).unwrap(), text);
    }

    #[test]
    fn a_forwarded_record_is_named_without_quoting_disk_source() {
        let record = json!({"table":"orders","clause":"update rule","phase":"update rule","site":"schema.q:4:3","siteKind":"clause","executionSite":"submit:2","generation":3});
        let text = explain(&record, &|_| None).unwrap();
        assert!(text.starts_with("dev: orders refused it: update rule (schema.q:4:3, generation 3), at submit:2"), "{text}");
    }

    #[test]
    fn comments_are_stripped_outside_quotes_only() {
        assert_eq!(code("update <- .status = 'needs--review'   -- triage"), "update <- .status = 'needs--review'");
        assert_eq!(code(r"read <- .t = 'it\'s -- x'"), r"read <- .t = 'it\'s -- x'");
        assert_eq!(code("update <- deny -- frozen"), "update <- deny");
    }

    #[test]
    fn a_forwarded_record_is_chosen_only_from_a_complete_unambiguous_interval() {
        let r = |n: u64, op: &str| json!({"operation": op, "code": "E_RULE", "responseSequence": n, "clause": "update rule"});
        assert_eq!(select(&[r(10, "submit"), r(11, "submit")], 10, "submit", "E_RULE"), Selection::Unique(r(11, "submit")));
        // Ours (11) delayed while a later one (12) persisted: wait, never guess.
        assert_eq!(select(&[r(10, "submit"), r(12, "submit")], 10, "submit", "E_RULE"), Selection::Incomplete);
        // Nothing after the baseline yet.
        assert_eq!(select(&[r(10, "submit")], 10, "submit", "E_RULE"), Selection::Incomplete);
        // Two refusals of this operation in the interval: ambiguous.
        assert_eq!(select(&[r(11, "submit"), r(12, "submit")], 10, "submit", "E_RULE"), Selection::Ambiguous);
        // An interleaved other operation leaves ours unique.
        assert_eq!(select(&[r(11, "other"), r(12, "submit")], 10, "submit", "E_RULE"), Selection::Unique(r(12, "submit")));
        // Eviction (the window starts after baseline + 1) is incomplete.
        assert_eq!(select(&[r(13, "submit"), r(14, "other")], 10, "submit", "E_RULE"), Selection::Incomplete);
    }

    #[test]
    fn other_causes_keep_their_recorded_name() {
        let record = json!({"table":"orders","clause":"authorization allowance (update)","phase":"update rule","site":"schema.q:4:3","executionSite":"submit:2"});
        let text = explain(&record, &|_| Some(SCHEMA.to_owned())).unwrap();
        assert!(text.starts_with("dev: orders refused it: authorization allowance (update), at `update <- deny` (schema.q:4:3), at submit:2"), "{text}");
        assert!(!text.contains("only a job runs as the system"), "{text}");
        let through = json!({"table":"orders","clause":"read through parent read rule","site":"schema.q:3:3"});
        assert!(explain(&through, &|_| Some(SCHEMA.to_owned())).unwrap().contains("read through parent read rule, at `read <- .author = viewer`"));
    }

    #[test]
    fn uninstrumented_records_print_nothing() {
        assert!(explain(&json!({"table":"orders","clause":"cause not instrumented"}), &|_| None).is_none());
        assert!(explain(&json!({"code":"E_RULE","clause":"cause not instrumented"}), &|_| None).is_none());
    }
}
