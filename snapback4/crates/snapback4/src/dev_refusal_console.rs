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
    ["operation", "code", "table", "clause", "phase", "site", "executionSite", "generation"]
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
        let _ = writeln!(out, "dev refusal: {}: {} — {} at {}; execution site {}; store {}; instance {}; code {}; count {}; window 1s; first request {}; first job {}; first time {}; first response {}; `snapback4 why recent --instance {}`",
            r["operation"].as_str().unwrap_or(""), r["table"].as_str().unwrap_or(""), r["clause"].as_str().unwrap_or(""), r["site"].as_str().unwrap_or("<generated>"), r["executionSite"], identity["storeId"], identity["instance"], r["code"], entry.count, r["requestId"], r["jobId"], r["at"], r["responseSequence"], identity["instance"].as_str().unwrap_or(""));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
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
        for key in ["operation", "code", "clause", "site", "generation"] {
            let mut r = record.clone(); r[key] = json!("different");
            console.push_at(r, now, &identity, &mut out);
        }
        assert!(out.is_empty());
        console.flush_due(now + WINDOW, &identity, &mut out);
        let text = String::from_utf8(out.clone()).unwrap();
        assert_eq!(text.lines().count(), 6);
        assert!(text.contains("count 1000; window 1s; first request 0"));
        console.push_at(record, now + WINDOW, &identity, &mut out);
        console.flush_due(now + 2 * WINDOW, &identity, &mut out);
        assert_eq!(String::from_utf8(out).unwrap().lines().count(), 7);
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
