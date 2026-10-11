//! A request scope plus a response-layer backstop, never a caller channel.
// @ref LLP 3000.015#2.1 — missing instrumentation must supersede older evidence.
use super::{Recent, Sites};
use serde_json::{Value, json};
use snapback4_core::{Context, engine::refusal_trace::RefusalTrace};
use std::{cell::RefCell, sync::{Arc, atomic::Ordering}};

thread_local! { static CURRENT: RefCell<Option<Evidence>> = const { RefCell::new(None) }; }
struct Evidence {
    recent: Recent,
    operation: String,
    request: u64,
    query: bool,
    trace: RefusalTrace,
    sites: Arc<Sites>,
    generation: Option<u64>,
}
pub(in crate::serve) struct RequestScope;
impl Drop for RequestScope { fn drop(&mut self) { CURRENT.with(|c| c.borrow_mut().take()); } }
pub(in crate::serve) fn begin(shared: &crate::serve::Shared, path: &str) -> Option<RequestScope> {
    if !shared.personas { return None; }
    let recent = shared.refusals.clone();
    let request = recent.requests.fetch_add(1, Ordering::Relaxed) + 1;
    CURRENT.with(|c| *c.borrow_mut() = Some(Evidence { recent,
        operation: path.strip_prefix("/q/").or_else(|| path.strip_prefix("/m/")).unwrap_or(path).into(),
        request, query: path.starts_with("/q/"), trace: Default::default(), sites: Default::default(), generation: None }));
    Some(RequestScope)
}
pub(in crate::serve) fn context(context: Context, sites: Arc<Sites>, generation: u64) -> Context {
    CURRENT.with(|c| {
        let mut c = c.borrow_mut();
        let Some(evidence) = c.as_mut() else { return context };
        evidence.sites = sites;
        evidence.generation = Some(generation);
        context.with_refusal_trace(evidence.trace.clone())
    })
}
pub(in crate::serve) struct Pending { recent: Recent, record: Value }
impl Drop for Pending {
    fn drop(&mut self) { self.recent.submit(std::mem::take(&mut self.record)); }
}
// Inspect the actual encoded envelope, after overflow substitution. This covers
// every responder using the shared JSON response layer, including receipt replay,
// static admission and future paths with no attached collector. No user data is
// copied into the record. Unknown empty answers enter only the opt-in local
// trace; successful visibility filtering is never a refusal.
pub(in crate::serve) fn response(bytes: &[u8]) -> Option<Pending> {
    CURRENT.with(|c| {
        let mut c = c.borrow_mut();
        let evidence = c.as_mut()?;
        let body: Value = serde_json::from_slice(bytes).ok()?;
        let code = body.get("denied").or_else(|| body.get("why")).and_then(|v| v.get("code")).and_then(Value::as_str);
        let traced = evidence.trace.take();
        let why = body.get("denied").or_else(|| body.get("why"));
        // The one filtered read that is evidence about a program refusal: the
        // refusing `t[x] ! else CODE` lookup itself, whose read rule hid the row.
        let hidden = traced.as_ref().filter(|cause| !cause.terminal && cause.phase == "read rule").and_then(|cause| {
            let site = why?.get("site")?.as_str()?;
            evidence.sites.contains_key(&(cause.table.clone(), format!("lookup {site}"))).then(|| (cause.table.clone(), evidence.sites.get(&(cause.table.clone(), "read rule".into())).cloned()))
        });
        let cause = traced.filter(|cause| {
            // A filtered read earlier in a program is not evidence about a
            // later uninstrumented terminal refusal in that same request.
            code.is_none() || cause.terminal
        });
        let empty_answer = code.is_none();
        let code = match code {
            Some(code) => code,
            None if evidence.query && body.get("data").is_some() && body.get("loading") != Some(&Value::Bool(true)) => {
                // Visibility filtering is a successful read, not a refusal.
                if cause.as_ref().is_some_and(|cause| !cause.terminal && !cause.no_candidate) { return None; }
                if evidence.recent.trace_empty && empty(&body["data"]) { "EMPTY_READ" }
                else { return None; }
            }
            None => return None,
        };
        let mut record = json!({"operation":evidence.operation, "code":code, "requestId":evidence.request,
            "generation":evidence.generation, "clause":"cause not instrumented", "at":snapback4_core::now_ms()});
        // A program's own `require … else CODE` (or `! else CODE`) carries
        // its source site in the refusal itself: the response's own
        // evidence, not an older trace, so the log can name the line.
        if cause.is_none() && let Some(why) = why
            && why.get("rule").and_then(Value::as_str) == Some(code) && let Some(site) = why.get("site").and_then(Value::as_str) {
            record["clause"] = json!("program refusal");
            record["site"] = json!(site);
            record["siteKind"] = json!("program");
            if let Some((table, rule)) = &hidden {
                record["hiddenBy"] = json!({"table": table, "readRuleSite": rule});
            }
        }
        if empty_answer {
            record["emptyRead"] = json!(true);
            record["cause"] = json!(if cause.as_ref().is_some_and(|cause| cause.no_candidate) { "no-candidate" } else { "unrecorded" });
            record["clause"] = json!("no probe miss and no rule cause were recorded");
        }
        if let Some(cause) = cause {
            let clause = evidence.sites.get(&(cause.table.clone(), cause.phase.clone()))
                .or_else(|| evidence.sites.get(&(cause.table.clone(), cause.clause.clone())));
            let site = clause.or_else(|| evidence.sites.get(&(cause.table.clone(), "table".into())));
            // Whether the site is the clause's own line or the table's (an omitted rule).
            record["siteKind"] = json!(if clause.is_some() { "clause" } else if site.is_some() { "table" } else { "" });
            record["table"] = json!(cause.table);
            record["clause"] = json!(cause.clause);
            record["phase"] = json!(cause.phase);
            record["site"] = json!(site);
            record["executionSite"] = json!(cause.site);
            record["generation"] = json!(cause.generation);
            record["readRuleSite"] = json!(evidence.sites.get(&(cause.table, "read rule".into())));
        }
        // Published before sending: why refuses an old disk snapshot even when
        // the writer is blocked, this handoff drops, or responses finish out of order.
        Some(Pending { recent: evidence.recent.clone(), record: evidence.recent.sequence(record) })
    })
}
fn empty(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Array(values) => values.is_empty(),
        _ => false,
    }
}
