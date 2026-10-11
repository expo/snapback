//! Console aggregation stays on the evidence writer, outside request paths.
// @ref LLP 3000.015#2.1 — one counted line per cause in a fixed one-second window.
use serde_json::Value;
use std::{collections::VecDeque, io::Write, time::{Duration, Instant}};

const WINDOW: Duration = Duration::from_secs(1);
const LIMIT: usize = 32;
struct Entry { record: Value, count: u64, until: Instant }
#[derive(Default)]
pub(super) struct Console { entries: VecDeque<Entry> }

fn same_cause(a: &Value, b: &Value) -> bool {
    ["operation", "code", "table", "clause", "phase", "site", "executionSite", "generation", "hiddenBy"]
        .iter().all(|key| a[key] == b[key])
}
impl Console {
    pub fn wait(&self, now: Instant) -> Duration {
        self.entries.front().map_or(WINDOW, |entry| entry.until.saturating_duration_since(now))
    }
    pub fn push(&mut self, record: Value, identity: &Value, out: &mut impl Write) {
        self.push_at(record, Instant::now(), identity, out);
    }
    fn push_at(&mut self, record: Value, now: Instant, identity: &Value, out: &mut impl Write) {
        self.flush_due(now, identity, out);
        if let Some(entry) = self.entries.iter_mut().find(|entry| same_cause(&entry.record, &record)) {
            entry.count = entry.count.saturating_add(1);
            return;
        }
        // Bounded even under distinct operations/causes: end the oldest window
        // early rather than losing its count or growing memory without bound.
        if self.entries.len() == LIMIT { self.emit_first(identity, out); }
        self.entries.push_back(Entry { record, count: 1, until: now + WINDOW });
    }
    pub fn flush_due(&mut self, now: Instant, identity: &Value, out: &mut impl Write) {
        while self.entries.front().is_some_and(|entry| entry.until <= now) { self.emit_first(identity, out); }
    }
    pub fn flush_all(&mut self, identity: &Value, out: &mut impl Write) {
        while !self.entries.is_empty() { self.emit_first(identity, out); }
    }
    fn emit_first(&mut self, identity: &Value, out: &mut impl Write) {
        let entry = self.entries.pop_front().unwrap();
        let r = entry.record;
        // @ref LLP 3000.015#2.1 — a counted refusal remains one line beside lifecycle diagnostics.
        // Raw signal/thread-exit writes do not share Rust's stderr lock. Format
        // the complete line before touching the descriptor, so they cannot
        // splice themselves between this message's formatting fragments.
        let table = r["table"].as_str().filter(|t| !t.is_empty()).map(|t| format!(" {t}")).unwrap_or_default();
        // A lookup refusal whose row the read rule hid: name that layer, since the author's later `require` never ran.
        let hidden = r["hiddenBy"]["table"].as_str().map(|t| format!("; the lookup's {t} row is hidden by its read rule at {} (a hidden row reads as absent at a lookup, before any later require)", r["hiddenBy"]["readRuleSite"].as_str().unwrap_or("<generated>"))).unwrap_or_default();
        let line = format!("dev refusal: {}:{table} — {} at {}{hidden}; execution site {}; phase {}; generation {}; store {}; instance {}; code {}; count {}; window 1s; first request {}; first job {}; first time {}; first response {}; `snapback4 why recent --instance {}`\n",
            r["operation"].as_str().unwrap_or(""), r["clause"].as_str().unwrap_or(""), r["site"].as_str().unwrap_or("<generated>"), r["executionSite"], r["phase"], r["generation"], identity["storeId"], identity["instance"], r["code"], entry.count, r["requestId"], r["jobId"], r["at"], r["responseSequence"], identity["instance"].as_str().unwrap_or(""));
        let _ = out.write_all(line.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn shutdown_diagnostic_cannot_split_a_counted_refusal_line() {
        // Lifecycle diagnostics bypass Rust's stderr mutex. Simulate one
        // arriving after the writer's first fragment, as observed at shutdown.
        struct Interrupted { bytes: Vec<u8>, inserted: bool }
        impl std::io::Write for Interrupted {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.bytes.extend_from_slice(bytes);
                if !self.inserted {
                    self.inserted = true;
                    self.bytes.extend_from_slice(b"SNAPBACK4_THREAD_EXIT verb=dev generation=1 thread=\"worker\" reason=\"shutdown\"\n");
                }
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        let mut out = Interrupted { bytes: Vec::new(), inserted: false };
        let mut console = Console::default();
        let now = Instant::now();
        let identity = json!({"storeId":"store", "instance":"instance"});
        let record = json!({"operation":"add", "code":"E_RULE", "table":"rows",
            "clause":"insert rule", "phase":"insert rule", "site":"schema.q:5:3",
            "executionSite":"add:3", "generation":1, "requestId":2});
        for _ in 0..8 { console.push_at(record.clone(), now, &identity, &mut out); }
        assert!(out.bytes.is_empty(), "the aggregation window is still open");
        console.flush_all(&identity, &mut out);
        let text = String::from_utf8(out.bytes).unwrap();
        let lines: Vec<_> = text.lines().collect();
        assert_eq!(lines.len(), 2, "{text}");
        assert!(lines[0].starts_with("dev refusal: add: rows — insert rule at schema.q:5:3;"), "{text}");
        assert!(lines[0].contains("code \"E_RULE\"; count 8; window 1s; first request 2;"), "{text}");
        assert!(lines[0].ends_with("`snapback4 why recent --instance instance`"), "{text}");
        assert_eq!(lines[1], "SNAPBACK4_THREAD_EXIT verb=dev generation=1 thread=\"worker\" reason=\"shutdown\"", "{text}");
    }
    #[test]
    fn counted_line_stays_intact_between_uncoordinated_writes() {
        // Lifecycle diagnostics bypass Rust's stderr lock. Model another
        // complete diagnostic arriving after every underlying writer call.
        struct Interleaved(Vec<u8>);
        impl Write for Interleaved {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0.extend_from_slice(bytes);
                self.0.extend_from_slice(b"SNAPBACK4_THREAD_EXIT reason=shutdown\n");
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        let mut console = Console::default();
        let mut out = Interleaved(Vec::new());
        let now = Instant::now();
        let identity = json!({"instance":"test"});
        let record = json!({"operation":"add","code":"E_RULE","clause":"insert rule"});
        for _ in 0..8 { console.push_at(record.clone(), now, &identity, &mut out); }
        console.flush_all(&identity, &mut out);
        let text = String::from_utf8(out.0).unwrap();
        let lines: Vec<_> = text.lines().collect();
        assert_eq!(lines.len(), 2, "{text}");
        assert!(lines[0].starts_with("dev refusal: add:"), "{text}");
        assert!(lines[0].contains("code \"E_RULE\"; count 8; window 1s;"), "{text}");
        assert_eq!(lines[1], "SNAPBACK4_THREAD_EXIT reason=shutdown");
    }
    #[test]
    fn counts_repeats_without_sliding_and_separates_causes() {
        let mut console = Console::default();
        let mut out = Vec::new();
        let now = Instant::now();
        let identity = json!({"instance":"test"});
        let record = json!({"operation":"add","code":"E_RULE","clause":"insert rule"});
        for n in 0..1000 {
            let mut r = record.clone(); r["requestId"] = json!(n);
            console.push_at(r, now + Duration::from_micros(n), &identity, &mut out);
        }
        assert!(out.is_empty());
        console.flush_due(now + WINDOW, &identity, &mut out);
        let text = String::from_utf8(out.clone()).unwrap();
        assert_eq!(text.lines().count(), 1);
        assert!(text.contains("count 1000; window 1s; first request 0"));
        console.push_at(record, now + WINDOW, &identity, &mut out);
        console.flush_due(now + 2 * WINDOW, &identity, &mut out);
        assert_eq!(String::from_utf8(out).unwrap().lines().count(), 2);
    }
    #[test]
    fn every_cause_field_separates_identified_counts() {
        let identity = json!({"storeId":"store", "instance":"instance"});
        let record = json!({"operation":"add", "code":"E_RULE", "table":"rows",
            "clause":"insert rule", "phase":"insert", "site":"schema.q:5:3",
            "executionSite":"add:1", "generation":1, "requestId":11});
        for (key, different) in [
            ("operation", json!("update")), ("code", json!("E_FIELD_AUTHORITY")),
            ("table", json!("otherRows")), ("clause", json!("update rule")),
            ("phase", json!("read through capture")), ("site", json!("schema.q:9:3")),
            ("executionSite", json!("add:2")), ("generation", json!(2)),
        ] {
            let mut console = Console::default();
            let mut out = Vec::new();
            let now = Instant::now();
            let mut other = record.clone();
            other[key] = different;
            other["requestId"] = json!(22);
            for _ in 0..2 { console.push_at(record.clone(), now, &identity, &mut out); }
            for _ in 0..3 { console.push_at(other.clone(), now, &identity, &mut out); }
            console.flush_all(&identity, &mut out);
            let text = String::from_utf8(out).unwrap();
            let lines: Vec<_> = text.lines().collect();
            assert_eq!(lines.len(), 2, "grouping field {key}: {text}");
            for (line, expected, count, request) in [(lines[0], &record, 2, 11), (lines[1], &other, 3, 22)] {
                assert!(line.starts_with(&format!("dev refusal: {}: {} — {} at {};", expected["operation"].as_str().unwrap(), expected["table"].as_str().unwrap(), expected["clause"].as_str().unwrap(), expected["site"].as_str().unwrap())), "{key}: {line}");
                for field in ["code", "phase", "generation"] {
                    assert!(line.contains(&format!("{field} {};", expected[field])), "{key}: {line}");
                }
                assert!(line.contains(&format!("execution site {};", expected["executionSite"])), "{key}: {line}");
                assert!(line.contains(&format!("count {count}; window 1s; first request {request};")), "{key}: {line}");
                assert!(line.contains("store \"store\"; instance \"instance\";"), "{key}: {line}");
            }
        }
    }
    #[test]
    fn distinct_causes_are_bounded_and_counts_flush_on_disconnect() {
        let mut console = Console::default();
        let mut out = Vec::new();
        let now = Instant::now();
        for n in 0..100 {
            console.push_at(json!({"operation":n}), now, &Value::Null, &mut out);
            assert!(console.entries.len() <= LIMIT);
        }
        console.flush_all(&Value::Null, &mut out);
        assert_eq!(String::from_utf8(out).unwrap().lines().count(), 100);
    }
}
