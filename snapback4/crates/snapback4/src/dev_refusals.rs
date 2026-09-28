//! Local developer evidence, deliberately absent from all HTTP envelopes.
// @ref LLP 3000.015#2.1 — dev only; no operator permission or caller detail is inferred.
use super::{Shared, lock};
use snapback4_core::engine::refusal_trace::RefusalTrace;
use serde_json::{Value, json};
use std::{collections::{BTreeMap, VecDeque}, io::Write, path::Path};

pub(crate) const FILE: &str = "dev-refusals.json";
#[derive(Default)]
pub(super) struct Recent { records: VecDeque<Value> }

pub(super) struct Capture<'a> {
    shared: &'a Shared,
    operation: &'a str,
    trace: RefusalTrace,
    sites: BTreeMap<(String, String), String>,
}
impl<'a> Capture<'a> {
    pub fn new(shared: &'a Shared, operation: &'a str) -> Option<Self> {
        if !shared.personas { return None; }
        let bound = lock(&shared.bound);
        Some(Self { shared, operation, trace: RefusalTrace::default(), sites: bound.refusal_sites.clone() })
    }
    pub fn context(&self, context: snapback4_core::Context) -> snapback4_core::Context { context.with_refusal_trace(self.trace.clone()) }
}
impl Drop for Capture<'_> {
    fn drop(&mut self) {
        let Some(cause) = self.trace.take() else { return };
        let site = self.sites.get(&(cause.table.clone(), cause.clause.clone()))
            .or_else(|| cause.clause.strip_prefix("authorization allowance (").and_then(|s| s.strip_suffix(')')).and_then(|effect| self.sites.get(&(cause.table.clone(), format!("{effect} rule")))))
            .or_else(|| self.sites.get(&(cause.table.clone(), "table".into())));
        let read_site = self.sites.get(&(cause.table.clone(), "read rule".into()));
        let record = json!({"operation":self.operation, "table":cause.table, "clause":cause.clause,
            "site":site, "executionSite":cause.site, "readRuleSite":read_site, "generation":cause.generation,
            "at":snapback4_core::now_ms()});
        eprintln!("dev refusal: {}: {} — {} at {}; execution site {}; read rule {}; `snapback4 why recent`", self.operation, cause.table, cause.clause, site.map(String::as_str).unwrap_or("<generated>"), cause.site, read_site.map(String::as_str).unwrap_or("<implicit>"));
        let mut recent = lock(&self.shared.refusals);
        if recent.records.len() == 32 { recent.records.pop_front(); }
        recent.records.push_back(record);
        if let Err(error) = save(&self.shared.project.join(".snapback4"), &recent.records) { eprintln!("dev refusal: could not save local record: {error}"); }
    }
}
fn save(dir: &Path, records: &VecDeque<Value>) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(format!("{FILE}.{}.tmp", std::process::id()));
    let mut options = std::fs::OpenOptions::new(); options.write(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let mut file = options.open(&path)?;
    let result = (|| { file.write_all(serde_json::to_string_pretty(records)?.as_bytes())?; std::fs::rename(&path, dir.join(FILE)) })();
    if result.is_err() { let _ = std::fs::remove_file(path); }
    result
}
