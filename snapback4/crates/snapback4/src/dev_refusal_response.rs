//! A request scope plus a response-layer backstop, never a caller channel.
// @ref LLP 3000.000.000.000#5-fixtures-and-dev-evidence — empty viewer-roster advice is private dev evidence only.
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
    empty_rosters: std::collections::BTreeMap<(String, String), Vec<String>>,
    program_rosters: std::collections::BTreeMap<(String, String), Vec<String>>,
}
pub(in crate::serve) struct RequestScope;
impl Drop for RequestScope { fn drop(&mut self) { CURRENT.with(|c| c.borrow_mut().take()); } }
pub(in crate::serve) fn begin(shared: &crate::serve::Shared, path: &str) -> Option<RequestScope> {
    if !shared.personas { return None; }
    let recent = shared.refusals.clone();
    let request = recent.requests.fetch_add(1, Ordering::Relaxed) + 1;
    CURRENT.with(|c| *c.borrow_mut() = Some(Evidence { recent,
        operation: path.strip_prefix("/q/").or_else(|| path.strip_prefix("/m/")).unwrap_or(path).into(),
        request, query: path.starts_with("/q/"), trace: Default::default(), sites: Default::default(), generation: None, empty_rosters: Default::default(), program_rosters: Default::default() }));
    Some(RequestScope)
}
pub(in crate::serve) fn context(context: Context, sites: Arc<Sites>, engine: &snapback4_core::Engine) -> Context {
    CURRENT.with(|c| {
        let mut c = c.borrow_mut();
        let Some(evidence) = c.as_mut() else { return context };
        evidence.sites = sites;
        evidence.generation = Some(engine.generation());
        // One row at most, only on the private dev evidence path; never expose
        // physical roster emptiness to a caller or charge its query meter.
        let mut empty = std::collections::BTreeMap::new();
        for (table, definition) in engine.schema().visible_tables() {
            for (phase, rule) in [("read rule", &definition.rules.read), ("insert rule", &definition.rules.insert), ("update rule", &definition.rules.update), ("delete rule", &definition.rules.delete)] {
                let mut rosters = Vec::new();
                viewer_rosters(rule, &mut rosters);
                rosters.retain(|roster| *empty.entry(roster.clone()).or_insert_with(|| engine.store().rows_limited(roster, 0).is_ok_and(|(_, more)| !more)));
                evidence.empty_rosters.insert((table.clone(), phase.into()), rosters);
            }
        }
        if let Some(program) = engine.program(&evidence.operation) {
            program_rosters(&program.body, &mut Default::default(), &mut evidence.program_rosters);
            for rosters in evidence.program_rosters.values_mut() {
                rosters.retain(|roster| *empty.entry(roster.clone()).or_insert_with(|| engine.store().rows_limited(roster, 0).is_ok_and(|(_, more)| !more)));
            }
        }
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
        if evidence.query && evidence.trace.hidden() > 0 {
            eprintln!("dev query: {} hidden: {} (encountered row images filtered by read rules)", evidence.operation, evidence.trace.hidden());
        }
        let code = body.get("denied").or_else(|| body.get("why")).and_then(|v| v.get("code")).and_then(Value::as_str);
        let traced = evidence.trace.take();
        let why = body.get("denied").or_else(|| body.get("why"));
        // The one filtered read that is evidence about a program refusal: the
        // refusing `t[x] ! else CODE` lookup itself, whose read rule hid the row.
        let hidden = traced.as_ref().filter(|cause| !cause.terminal && cause.phase == "read rule").and_then(|cause| {
            let site = why?.get("site")?.as_str()?;
            evidence.sites.contains_key(&(cause.table.clone(), format!("lookup {site}"))).then(|| (cause.table.clone(), evidence.sites.get(&(cause.table.clone(), "read rule".into())).cloned()))
        });
        let program_hint = why.and_then(|why| Some((why.get("code")?.as_str()?.to_owned(), why.get("site")?.as_str()?.to_owned())))
            .and_then(|key| evidence.program_rosters.get(&key)).filter(|tables| !tables.is_empty());
        let roster_hint = program_hint.map(|tables| tables.iter().map(|table| format!("no rows in {table}: seed it with /dev/reset")).collect::<Vec<_>>().join("; ")).or_else(|| traced.as_ref().filter(|cause| cause.terminal).and_then(|cause| {
            evidence.empty_rosters.get(&(cause.table.clone(), cause.phase.clone())).filter(|tables| !tables.is_empty())
                .map(|tables| tables.iter().map(|table| format!("no rows in {table}: seed it with /dev/reset")).collect::<Vec<_>>().join("; "))
        }));
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
        let preflight = code == "E_AUTH" && evidence.generation.is_none() && why.and_then(|v| v.get("site")).is_none();
        let mut record = json!({"preflight":preflight,"operation":evidence.operation, "code":code, "requestId":evidence.request,
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
        if !empty_answer && let Some(hint) = roster_hint { record["seedHint"] = json!(hint); }
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

fn viewer_rosters(rule: &snapback4_core::schema::RuleExpr, out: &mut Vec<String>) {
    use snapback4_core::schema::{RuleExpr, RuleTerm};
    match rule {
        RuleExpr::Exists { table, key, equalities, .. } if key.iter().chain(equalities.iter().map(|(_, term)| term)).any(|term| matches!(term, RuleTerm::Viewer)) => { if !out.contains(table) { out.push(table.clone()); } }
        RuleExpr::And(parts) | RuleExpr::Or(parts) => { for part in parts { viewer_rosters(part, out); } }
        // A negated roster is not an admission gate.
        _ => {},
    }
}

fn expression_rosters(expression: &snapback4_core::ir::Expr, names: &std::collections::BTreeMap<String, Vec<String>>) -> Vec<String> {
    use snapback4_core::ir::{Expr, Input, BinaryOp};
    match expression {
        Expr::Exists(read) | Expr::Get(read) if read.key.iter().any(|key| matches!(key, Expr::Input(Input::Viewer))) => vec![read.table.clone()],
        Expr::Variable(name) => names.get(name).cloned().unwrap_or_default(),
        // Extra named equalities lower exists to a row temporary, a non-null
        // guard, then the residual comparisons. Track that positive guard.
        Expr::Binary { op: BinaryOp::Ne, left, right } if matches!(right.as_ref(), Expr::Literal(snapback4_core::Value::Null)) => expression_rosters(left,names),
        Expr::Binary { op: BinaryOp::Ne, left, right } if matches!(left.as_ref(), Expr::Literal(snapback4_core::Value::Null)) => expression_rosters(right,names),
        Expr::Binary { op: BinaryOp::And | BinaryOp::Or, left, right } => {
            let mut tables = expression_rosters(left,names);
            for table in expression_rosters(right,names) { if !tables.contains(&table) { tables.push(table); } }
            tables
        }
        _ => Vec::new(),
    }
}
fn program_rosters(body: &[snapback4_core::ir::Stmt], names: &mut std::collections::BTreeMap<String, Vec<String>>, out: &mut std::collections::BTreeMap<(String,String), Vec<String>>) {
    use snapback4_core::ir::Stmt;
    for statement in body {
        match statement {
            Stmt::Const { name, value } | Stmt::Let { name, value } | Stmt::Assign { name, value } => { names.insert(name.clone(), expression_rosters(value,names)); }
            Stmt::Require { condition, code, site: Some(site), .. } => { out.insert((code.clone(),site.clone()),expression_rosters(condition,names)); }
            Stmt::If { then_body, else_body, .. } => {
                program_rosters(then_body,&mut names.clone(),out);
                program_rosters(else_body,&mut names.clone(),out);
                // An assignment in either branch invalidates an older alias.
                forget_assignments(then_body,names); forget_assignments(else_body,names);
            }
            Stmt::For { body, .. } => { program_rosters(body,&mut names.clone(),out); forget_assignments(body,names); }
            _ => {},
        }
    }
}

fn forget_assignments(body: &[snapback4_core::ir::Stmt], names: &mut std::collections::BTreeMap<String, Vec<String>>) {
    use snapback4_core::ir::Stmt;
    for statement in body {
        match statement {
            Stmt::Assign { name, .. } => { names.remove(name); }
            Stmt::If { then_body, else_body, .. } => { forget_assignments(then_body,names); forget_assignments(else_body,names); }
            Stmt::For { body, .. } => forget_assignments(body,names),
            _ => {},
        }
    }
}

#[cfg(test)]
mod roster_tests {
    use super::*;
    #[test]
    fn program_gate_tracks_positive_viewer_probes_and_aliases_at_the_exact_require_site() {
        let source = "use personas alice\ntable admins:\n  principal: principal\n  role: text <=20\n  unique byPrincipal: principal\n  public\n  online only\nmutation direct():\n  require exists admins[viewer] else NOT_ADMIN\n  return true\nmutation alias():\n  admin = exists admins[viewer]\n  require admin else NOT_ADMIN\n  return true\nmutation role():\n  require exists admins[viewer, role = 'admin'] else NOT_ADMIN\n  return true\nmutation negative():\n  require not exists admins[viewer] else ALREADY_ADMIN\n  return true\n";
        let bound = snapback4_lang::compile(&[("schema.q".into(),source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}",bound.diagnostics);
        for program in &bound.programs {
            let mut gates = Default::default();
            program_rosters(&program.program.body,&mut Default::default(),&mut gates);
            let positive = gates.values().any(|tables| tables == &["admins"]);
            assert_eq!(positive, program.program.name != "negative", "{}: {:?}",program.program.name,program.program.body);
        }
    }
}
