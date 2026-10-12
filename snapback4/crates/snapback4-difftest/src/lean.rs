//! The engine against the Lean model (LLP 3000.035 §5.2).
//!
//! **The model side.** Each case's surface program goes through
//! `snapback4_lang::emit::lean` (the parsed tree, never the binder's IR) to
//! the model's case JSON, and through `quarry-oracle` (`snapback4/lean`,
//! `lake build`), one long-lived process per worker that answers one tagged
//! outcome per line. A case the emitter cannot translate is `Unsupported`
//! under the emitter's named reason, never a pass.
//!
//! **The engine side.** The engine over SQLite (the ordinary in-memory
//! server store) at `Ceilings::default()`, the ceilings a production server
//! runs, not the case's stored budget; the model runs unbounded (its meter is
//! abstract, OPEN M1).
//!
//! **Compared fields** (README, "How the harness compares"):
//!
//! - `kind`: answer, unavailable, refused, committed;
//! - `code`: the refusal code (sites are not modelled);
//! - `data` / `result`: exact, both sides as tagged values, so an id never
//!   compares equal to a text (OPEN V1); rows compare as field maps;
//! - `complete`: exact;
//! - `next`: presence only (OPEN C1). When both carry one, each side
//!   continues from its own cursor and the next page is compared
//!   (`continuation-*`), until both are exhausted;
//! - a mutation then runs `observe` on each side's resulting store
//!   (`post-*`): the engine's store, and the model's committed store (or the
//!   original store after a refusal).
//!
//! Meter fields, cut sites, `tables`, `seq` and expiry are not compared.
//!
//! **Signatures** are `lean--{field}--{engine}~{model}`, each side's stable
//! class (a refusal code, `unavailable`, `committed`, or the data's shape).
//! The finding's `left` is the engine's raw record, `right` the model's raw
//! outcome; the canonical forms compared are its `continuation`.
// @ref LLP 3000.035#52-stage-2-a-small-lean-core — the Lean model as a further oracle over the Stage 1 generator.
use crate::{
    ast::Body,
    campaign::Report,
    execute::{self, Outcome},
    generate::Case,
    oracle::{Finding, Oracle, Verdict},
};
use serde_json::{Map, Value as Json, json};
use snapback4_core::Ceilings;
use snapback4_lang::emit::lean::LeanModule;
use std::{
    cell::RefCell,
    collections::BTreeSet,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
};

/// The `quarry-oracle` executable: `SNAPBACK4_LEAN_ORACLE`, else the Lake
/// build in this checkout.
pub fn oracle_path() -> PathBuf {
    match std::env::var_os("SNAPBACK4_LEAN_ORACLE") {
        Some(p) => PathBuf::from(p),
        None => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../lean/.lake/build/bin/quarry-oracle"),
    }
}

/// Bring this checkout's `quarry-oracle` up to date with its model sources
/// (`lake build quarry-oracle`, under a second when current). A merge or
/// checkout that changes `lean/` leaves the previous executable in `.lake`,
/// and the harness would report that older model's choices as disagreements
/// (2026-10-12: a stale pre-guard oracle on the merged `sb4-loop` tree showed
/// `lean--complete--complete~incomplete`). Nothing is done when
/// `SNAPBACK4_LEAN_ORACLE` names the oracle (the caller vouches for it; a
/// campaign's workers inherit the refreshed path that way) or when `lake` is
/// not installed (a missing oracle still refuses at `LeanProcess::spawn`).
pub fn refresh() -> Result<(), String> {
    if std::env::var_os("SNAPBACK4_LEAN_ORACLE").is_some() {
        return Ok(());
    }
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../lean");
    match Command::new("lake").args(["build", "quarry-oracle"]).current_dir(&dir).stdin(Stdio::null()).output() {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(format!(
            "`lake build quarry-oracle` failed in {}: {}{}",
            dir.display(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            eprintln!("lake not found: using the Lean oracle as built at {}", oracle_path().display());
            Ok(())
        }
        Err(e) => Err(format!("lake: {e}")),
    }
}

/// One `quarry-oracle` process: a JSON case per line in, an outcome per line out.
pub struct LeanProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}
impl LeanProcess {
    pub fn spawn() -> Result<Self, String> {
        let path = oracle_path();
        if !path.is_file() {
            return Err(format!(
                "Lean oracle missing: {} (run `cd snapback4/lean && lake build`, or set SNAPBACK4_LEAN_ORACLE)",
                path.display()
            ));
        }
        let mut child = Command::new(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Lean oracle {}: {e}", path.display()))?;
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Ok(Self { child, stdin, stdout })
    }
    pub fn ask(&mut self, case: &Json) -> Result<Json, String> {
        writeln!(self.stdin, "{case}").map_err(|e| format!("Lean oracle write: {e}"))?;
        self.stdin.flush().map_err(|e| format!("Lean oracle flush: {e}"))?;
        let mut line = String::new();
        let n = self.stdout.read_line(&mut line).map_err(|e| format!("Lean oracle read: {e}"))?;
        if n == 0 {
            return Err("Lean oracle exited".into());
        }
        let answer: Json = serde_json::from_str(&line).map_err(|e| format!("Lean oracle answer {line:?}: {e}"))?;
        if answer["kind"] == "error" {
            // A case the model cannot decode is an emitter defect, never a verdict.
            return Err(format!("Lean oracle refused the case: {}", answer["error"]));
        }
        Ok(answer)
    }
}
impl Drop for LeanProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

thread_local! {
    static PROCESS: RefCell<Option<LeanProcess>> = const { RefCell::new(None) };
}

/// Ask this thread's oracle process, starting it on first use and once
/// more if it has died.
pub fn ask(case: &Json) -> Result<Json, String> {
    PROCESS.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            *slot = Some(LeanProcess::spawn()?);
        }
        match slot.as_mut().unwrap().ask(case) {
            Err(e) if e == "Lean oracle exited" => {
                *slot = Some(LeanProcess::spawn()?);
                slot.as_mut().unwrap().ask(case)
            }
            other => other,
        }
    })
}

/// The engine's value as the model's tagged value; rows as field maps.
pub fn engine_value(v: &snapback4_core::Value) -> Json {
    use snapback4_core::Value as V;
    match v {
        V::Null => json!({"null": null}),
        V::Bool(b) => json!({"bool": b}),
        V::Int(n) => json!({"int": n.to_string()}),
        V::String(s) => json!({"text": s}),
        V::Id(s) => json!({"id": s}),
        V::Bytes(b) => json!({"bytes": b.iter().map(|x| format!("{x:02x}")).collect::<String>()}),
        V::Row(fs) | V::Map(fs) => json!({"row": fs.iter().map(|(k, x)| (k.clone(), engine_value(x))).collect::<Map<_, _>>()}),
        V::Array(xs) => json!({"arr": xs.iter().map(engine_value).collect::<Vec<_>>()}),
    }
}

/// The model's tagged value with rows as field maps (its rows are ordered pairs).
pub fn model_value(v: &Json) -> Json {
    if let Some(xs) = v.get("arr").and_then(Json::as_array) {
        return json!({"arr": xs.iter().map(model_value).collect::<Vec<_>>()});
    }
    if let Some(fs) = v.get("row").and_then(Json::as_array) {
        let mut m = Map::new();
        for p in fs {
            m.insert(p[0].as_str().unwrap_or_default().to_owned(), model_value(&p[1]));
        }
        return json!({"row": m});
    }
    v.clone()
}

fn shape(v: &Json) -> String {
    v.as_object().and_then(|o| o.keys().next().cloned()).unwrap_or_else(|| "value".into())
}

/// One side's comparable record: `kind`, then `code` or `data`/`complete`/`next`.
#[derive(Clone, Debug, PartialEq)]
pub struct Canon {
    pub kind: String,
    pub code: Option<String>,
    pub data: Option<Json>,
    pub complete: Option<bool>,
    pub next: bool,
}
impl Canon {
    /// The side's stable class for a differing `field`: the field's own
    /// value where it is a flag, else a code, kind or data shape.
    pub fn class(&self, field: &str) -> String {
        if field.ends_with("complete") {
            return if self.complete == Some(true) { "complete" } else { "incomplete" }.into();
        }
        if field.ends_with("next") {
            return if self.next { "next" } else { "no-next" }.into();
        }
        match (&self.code, &self.data) {
            (Some(code), _) => code.clone(),
            (None, Some(d)) if self.kind == "answer" => shape(d),
            _ => self.kind.clone(),
        }
    }
    fn json(&self) -> Json {
        json!({"kind": self.kind, "code": self.code, "data": self.data, "complete": self.complete, "next": self.next})
    }
}

pub fn engine_canon(o: &Outcome) -> Canon {
    let blank = Canon { kind: String::new(), code: None, data: None, complete: None, next: false };
    if let Some(r) = o.refusal() {
        return Canon { kind: "refused".into(), code: r["code"].as_str().map(str::to_owned), ..blank };
    }
    if o.kind == "mutation" {
        let result = serde_json::from_value::<snapback4_core::Value>(o.value["result"].clone()).map(|v| engine_value(&v)).unwrap_or(Json::Null);
        return Canon { kind: "committed".into(), data: Some(result), ..blank };
    }
    if o.value.get("unavailable") == Some(&json!(true)) {
        return Canon { kind: "unavailable".into(), ..blank };
    }
    let data = serde_json::from_value::<snapback4_core::Value>(o.value["data"].clone()).map(|v| engine_value(&v)).unwrap_or(Json::Null);
    Canon { kind: "answer".into(), data: Some(data), complete: o.value["complete"].as_bool(), next: o.next().is_some(), ..blank }
}

pub fn model_canon(m: &Json) -> Canon {
    let blank = Canon { kind: m["kind"].as_str().unwrap_or("error").to_owned(), code: None, data: None, complete: None, next: false };
    match blank.kind.as_str() {
        "refused" => Canon { code: m["code"].as_str().map(str::to_owned), ..blank },
        "committed" => Canon { data: Some(model_value(&m["result"])), ..blank },
        "answer" => Canon {
            data: Some(model_value(&m["data"])),
            complete: m["complete"].as_bool(),
            next: m["next"] != json!({"null": null}),
            ..blank
        },
        _ => blank,
    }
}

/// The first differing field, in the order a reader wants it.
pub fn differ(e: &Canon, m: &Canon) -> Option<&'static str> {
    if e.kind != m.kind {
        return Some("kind");
    }
    if e.code != m.code {
        return Some("code");
    }
    if e.data != m.data {
        return Some(if e.kind == "committed" { "result" } else { "data" });
    }
    if e.complete != m.complete {
        return Some("complete");
    }
    if e.next != m.next {
        return Some("next");
    }
    None
}

/// `lean--{field}--{engine class}~{model class}`.
pub fn signature(field: &str, e: &Canon, m: &Canon) -> String {
    format!("lean--{}--{}~{}", field.replace('_', "-"), e.class(field), m.class(field))
}

fn finding(field: &str, e: &Canon, m: &Canon, engine: Outcome, model: &Json, trail: Vec<Outcome>) -> Verdict {
    Verdict::Disagree(Finding {
        signature: signature(field, e, m),
        oracle: Oracle::Lean,
        field: field.into(),
        left: engine,
        right: Outcome { kind: "lean".into(), value: model.clone() },
        continuation: trail,
        store_trace: None,
    })
}

fn trail_entry(e: &Canon, m: &Canon) -> Outcome {
    Outcome { kind: "canonical".into(), value: json!({"engine": e.json(), "model": m.json()}) }
}

/// What one case comes to; `executed` counts engine and model calls.
pub struct Checked {
    pub verdict: Verdict,
    pub executed: u64,
    pub pages: u64,
    pub mutation: bool,
    /// The first outcome's class on an agreeing case (`committed`, a code,
    /// `unavailable`, or the data's shape).
    pub class: String,
}

/// The module, or why the case is outside the fragment.
pub fn module(source: &str) -> Result<LeanModule, String> {
    let (document, diagnostics) = snapback4_lang::parse_document("schema.q", source);
    if !diagnostics.is_empty() {
        return Err("parse".into());
    }
    snapback4_lang::emit::lean::from_documents(&[document]).map_err(|u| u.reason)
}

/// Compare one case whose source compiles. `Err` is a harness or emitter
/// defect (never a verdict).
pub fn compare(case: &Case, source: &str) -> Result<Checked, String> {
    let unsupported = |reason: String| Ok(Checked { verdict: Verdict::Unsupported(reason), executed: 0, pages: 0, mutation: false, class: String::new() });
    let module = match module(source) {
        Ok(m) => m,
        Err(reason) => return unsupported(reason),
    };
    let mutation = case.program.mutation();
    if let Err(u) = module.program("run") {
        return unsupported(u.reason);
    }
    if mutation {
        if let Err(u) = module.program("observe") {
            return unsupported(format!("observe-{}", u.reason));
        }
    }
    let store = match module.store(&case.rows) {
        Ok(s) => s,
        Err(u) => return unsupported(u.reason),
    };
    let mut m_args = match module.tag_args("run", &case.args) {
        Ok(a) => a,
        Err(u) => return unsupported(u.reason),
    };
    // The prelude: each step on the engine and on the model's store, in order.
    for i in 0..case.steps.len() {
        if let Err(u) = module.program(&format!("prep{i}")) {
            return unsupported(format!("prelude-{}", u.reason));
        }
        if let Err(u) = module.tag_args(&format!("prep{i}"), &case.steps[i].args) {
            return unsupported(format!("prelude-{}", u.reason));
        }
    }
    let (mut engine, prelude) = execute::world(case, source)?;
    engine.set_ceilings(Ceilings::default());
    let mut executed = 0;
    let mut pages = 0;
    let mut store = store;
    let mut steps = prelude.iter().filter(|o| o.kind != "sweep");
    let mut trail = vec![];
    for (i, step) in case.steps.iter().enumerate() {
        let name = format!("prep{i}");
        let e_raw = steps.next().ok_or("prelude outcome missing")?.clone();
        let args = module.tag_args(&name, &step.args).map_err(|u| u.to_string())?;
        let viewer = step.viewer.as_deref().unwrap_or(&case.principal);
        let m_raw = ask(&module.case(&name, store.clone(), viewer, args, None).map_err(|u| u.to_string())?)?;
        executed += 2;
        let (e, m) = (engine_canon(&e_raw), model_canon(&m_raw));
        trail.push(trail_entry(&e, &m));
        if let Some(f) = differ(&e, &m) {
            return Ok(Checked { verdict: finding(&format!("prelude-{f}"), &e, &m, e_raw, &m_raw, trail), executed, pages, mutation, class: String::new() });
        }
        if m.kind == "committed" {
            store = m_raw["store"].clone();
        }
    }
    if mutation {
        let e_raw = execute::execute(&mut engine, case, "run", &case.args);
        let m_raw = ask(&module.case("run", store.clone(), &case.principal, m_args, None).map_err(|u| u.to_string())?)?;
        executed += 2;
        let (e, m) = (engine_canon(&e_raw), model_canon(&m_raw));
        let first_class = e.class("kind");
        let mut trail = vec![trail_entry(&e, &m)];
        if let Some(f) = differ(&e, &m) {
            return Ok(Checked { verdict: finding(f, &e, &m, e_raw, &m_raw, trail), executed, pages, mutation, class: String::new() });
        }
        // The resulting stores, seen through `observe`.
        let after = if m.kind == "committed" { m_raw["store"].clone() } else { store };
        let o_args = module.tag_args("observe", &case.args).map_err(|u| u.to_string())?;
        let eo_raw = execute::execute(&mut engine, case, "observe", &case.args);
        let mo_raw = ask(&module.case("observe", after, &case.principal, o_args, None).map_err(|u| u.to_string())?)?;
        executed += 2;
        let (eo, mo) = (engine_canon(&eo_raw), model_canon(&mo_raw));
        trail.push(trail_entry(&eo, &mo));
        if let Some(f) = differ(&eo, &mo) {
            return Ok(Checked { verdict: finding(&format!("post-{f}"), &eo, &mo, eo_raw, &mo_raw, trail), executed, pages, mutation, class: String::new() });
        }
        return Ok(Checked { verdict: Verdict::Pass, executed, pages, mutation, class: format!("{}-{}", if mutation { "mutation" } else { "query" }, first_class) });
    }
    let mut e_args = case.args.clone();
    let mut trail = Vec::new();
    let mut seen = BTreeSet::new();
    let mut first_class = String::new();
    loop {
        let e_raw = execute::execute(&mut engine, case, "run", &e_args);
        let m_raw = ask(&module.case("run", store.clone(), &case.principal, m_args.clone(), None).map_err(|u| u.to_string())?)?;
        executed += 2;
        pages += 1;
        let (e, m) = (engine_canon(&e_raw), model_canon(&m_raw));
        if pages == 1 {
            first_class = e.class("kind");
        }
        trail.push(trail_entry(&e, &m));
        let phase = if pages > 1 { "continuation-" } else { "" };
        if let Some(f) = differ(&e, &m) {
            return Ok(Checked { verdict: finding(&format!("{phase}{f}"), &e, &m, e_raw, &m_raw, trail), executed, pages, mutation, class: String::new() });
        }
        if !e.next {
            break;
        }
        let next = e_raw.next().unwrap().to_owned();
        if !seen.insert(next.clone()) || seen.len() > case.rows.len() + 2 {
            return Ok(Checked { verdict: finding("cursor-cycle", &e, &m, e_raw, &m_raw, trail), executed, pages, mutation, class: String::new() });
        }
        e_args["c"] = json!(next);
        m_args.insert("c".into(), m_raw["next"].clone());
    }
    Ok(Checked { verdict: Verdict::Pass, executed, pages, mutation, class: format!("query-{first_class}") })
}

/// The open points a case can exercise (`snapback4/lean/OPEN.md`), counted
/// over compared cases so a report shows each point's evidence.
pub fn features(case: &Case) -> Vec<String> {
    use crate::ast::{Read, Rule, Write};
    let mut out = Vec::new();
    let items = &case.program.tables[0];
    let rules: Vec<Rule> = items.effects.clone().unwrap_or_else(|| vec![items.rule.clone(); 4]);
    let access_hidden = case.program.tables.get(1).and_then(|t| t.effects.as_ref()).is_some_and(|e| e[0] == Rule::Deny);
    let body = &case.program.body;
    let write = match body {
        Body::Write(w, _) => Some(w),
        _ => None,
    };
    if items.effects.is_some() {
        out.push("items-effect-rules".into());
    }
    // LLP 3000.036.001: branch pages (the merged plan is decided by OPEN C8's branch rule).
    let where_branch = case.program.domain.as_deref().is_some_and(|domain| domain.contains(" or "));
    if let Some(domain) = case.program.domain.as_ref().filter(|_| where_branch) {
        out.push(format!("branch-where-{}", if domain.contains("helper") { "parties" } else { "buckets" }));
    }
    if rules[0] == Rule::TwoParty {
        out.push("branch-rule-two-party".into());
    }
    let membership_branch = rules[0] == Rule::OwnerOrWitness
        && matches!(body, Body::Read { kind: Read::Page | Read::Bounded, owner: false, .. });
    if membership_branch {
        out.push("branch-rule-membership".into());
    }
    if where_branch || rules[0] == Rule::TwoParty || membership_branch {
        let bound = snapback4_lang::compile(&[("schema.q".into(), case.program.source())]);
        let merged = bound.programs.iter().filter(|p| p.program.name == "run")
            .any(|p| snapback4_core::search_plan::merges(&p.program.body).iter().any(|m| m.branches()));
        out.push(format!("branch-{}", if merged { "merged" } else { "single-index" }));
}

    // @ref LLP 3000.039#9 — run-lean reports supported action cases by action (and, with `kind`, outcome).
    if let Some(kids) = &case.program.kids {
        let action = kids.action.as_deref().unwrap_or("undeclared").replace(' ', "-");
        let deletes = matches!(body, Body::Write(Write::Delete, _)) || case.program.prelude.iter().chain(match body { Body::Block(b) => Some(b), _ => None })
            .flat_map(|b| b.all()).any(|s| matches!(s, crate::ast::Stmt::Write { kind: Write::Delete, .. }));
        out.push(format!("references-{action}{}", if deletes { "-delete" } else { "" }));
        if kids.notes { out.push("references-restricting-notes".into()); }
    }
    // Widened shapes (`widen.rs`) inside the model's fragment.
    if matches!(body, Body::Block(_)) {
        out.push("block".into());
    }
    if !case.program.prelude.is_empty() {
        out.push(format!("prelude-{}-steps", case.program.prelude.len()));
        if case.steps.iter().any(|s| s.viewer.is_some()) {
            out.push("prelude-other-viewer".into());
        }
    }
    let blocks = case.program.prelude.iter().chain(match body {
        Body::Block(b) => Some(b),
        _ => None,
    });
    let stmts: Vec<_> = blocks.flat_map(|b| b.all()).collect();
    if stmts.iter().filter(|s| matches!(s, crate::ast::Stmt::Write { .. })).count() > 1 {
        out.push("multi-write".into());
    }
    if stmts.iter().any(|s| matches!(s, crate::ast::Stmt::Write { kind: Write::Insert | Write::Upsert, tag, .. } if tag == "tag0" || tag == "tag1")) {
        out.push("unique-tag-clash-candidate".into());
    }
    if let Some(w) = write {
        let rule = match w {
            Write::Insert => &rules[1],
            Write::Upsert | Write::Update => &rules[2],
            Write::Delete => &rules[3],
        };
        out.push(format!("write-{w:?}-under-{rule:?}").to_lowercase());
        if matches!(w, Write::Upsert | Write::Update) && rules[0] != Rule::Allow {
            out.push(format!("write-{w:?}-readable-by-{:?}", rules[0]).to_lowercase());
        }
    }
    if rules[0] == Rule::OwnerOrGrant {
        out.push("read-grant".into());
    }
    if let Some(guard) = &case.program.guard {
        out.push(format!("where-guard-{}", match guard.as_str() {
            "exists access[bucket, viewer]" => "probe",
            "not exists access[bucket, viewer]" => "not-probe",
            _ => "arguments",
        }));
    }
    let probing = |r: &Rule| matches!(r, Rule::Witness | Rule::OwnerOrWitness);
    if access_hidden && rules.iter().any(probing) {
        out.push("probe-of-hidden-access".into());
    }
    if let Body::Read { kind, owner, .. } = body {
        let uniform = match rules[0] {
            Rule::Owner | Rule::OwnerOrGrant => *owner,
            // The witness disjunct is pinned by `.bucket`: decided per caller (§16.3).
            Rule::OwnerOrWitness => *owner,
            _ => true,
        };
        if matches!(rules[0], Rule::OwnerOrWitness) && !*owner && matches!(kind, Read::Page | Read::Bounded | Read::Exists) {
            out.push(format!("parent-pinned-grant-{kind:?}").to_lowercase());
        }
        if matches!(kind, Read::Exists) {
            out.push(format!("search-exists-{}", if uniform { "decided" } else { "undecided" }));
        }
        if matches!(kind, Read::Page | Read::Bounded) {
            out.push(format!("{}-{kind:?}", if uniform { "uniform" } else { "non-uniform" }).to_lowercase());
            if uniform && matches!(kind, Read::Page) {
                // C2: whether the binder may keep a residual filter on the scan.
                out.push(format!("uniform-page-{}", if case.program.residual.is_some() { "with-residual" } else { "without-residual" }));
            }
        }
        if let Some(order) = &case.program.order {
            out.push(format!("order-{}", order.join("-")));
        }
        if let Some(residual) = &case.program.residual {
            out.push(format!("residual-{}", residual_name(residual)));
        }
    }
    out
}

/// A stable feature name for a residual conjunct of `generate`.
fn residual_name(residual: &str) -> &'static str {
    match residual {
        ".score >= 0" => "score-ge",
        ".label != ''" => "label-ne",
        ".maybe = null" => "nullable-eq-null",
        ".maybe = n" => "nullable-eq-arg",
        "(.score > 0 or .flag = false)" => "disjunction",
        _ => "other",
    }
}

/// One case, counted into `report`.
pub fn check(case: &Case, report: &mut Report, mut found: impl FnMut(crate::oracle::Finding)) -> Result<(), String> {
    report.generated += 1;
    for feature in crate::coverage::features(case) {
        *report.coverage.entry(feature).or_default() += 1;
    }
    let source = case.program.source();
    if let Err(e) = execute::compile(&source) {
        report.binder_refused_unexpected += 1;
        return Err(format!("binder: {e}"));
    }
    report.compiled += 1;
    let checked = compare(case, &source)?;
    report.executed += checked.executed;
    if let Verdict::Pass = &checked.verdict {
        // What agreed, by outcome class: evidence for the open points.
        *report.store_stats.entry(format!("lean-agreed/{}", checked.class)).or_default() += 1;
    }
    let stats = &mut report.store_stats;
    // @ref LLP 3000.040#25-the-lean-model — calendar evidence is counted where it is compared.
    if case.program.time_arg {
        *stats.entry("lean-calendar-generated".into()).or_default() += 1;
        let class = match &checked.verdict { Verdict::Unsupported(_) => "unsupported", Verdict::Pass => "agreed", Verdict::Disagree(_) => "disagreeing", _ => "other" };
        *stats.entry(format!("lean-calendar-{class}")).or_default() += 1;
    }
    match &checked.verdict {
        Verdict::Unsupported(_) => *stats.entry("lean-unsupported".into()).or_default() += 1,
        _ => {
            *stats.entry("lean-supported".into()).or_default() += 1;
            *stats.entry(format!("lean-supported-{}", if checked.mutation { "mutation" } else { "query" })).or_default() += 1;
            *stats.entry("lean-pages-compared".into()).or_default() += checked.pages;
            if checked.pages > 1 {
                *stats.entry("lean-continued-reads".into()).or_default() += 1;
            }
        }
    }
    if !matches!(checked.verdict, Verdict::Unsupported(_)) {
        let disagreed = matches!(checked.verdict, Verdict::Disagree(_));
        for feature in features(case) {
            *stats.entry(format!("lean-feature/{feature}/compared")).or_default() += 1;
            if disagreed {
                *stats.entry(format!("lean-feature/{feature}/disagreeing")).or_default() += 1;
            }
        }
    }
    report.by_oracle.entry("lean".into()).or_default().record(&checked.verdict);
    if let Verdict::Disagree(f) = checked.verdict {
        found(f);
    }
    Ok(())
}

pub fn reproduce(case: &Case, source: &str) -> Result<Verdict, String> {
    execute::compile(source).map_err(|e| format!("binder: {e}"))?;
    compare(case, source).map(|c| c.verdict)
}

/// The Lean campaign's case for `seed`: the Stage 1 generator's case, and
/// for about half the seeds a variant aimed at the model's open points
/// (`snapback4/lean/OPEN.md`), from an independent stream so the base case
/// is unchanged:
///
/// - per-effect rules on `items` (R2's named and unnamed update rules, W1–W4
///   precedence between rules, readability and clashes, C8's non-uniform
///   reads), with `online only` so any read rule is admissible;
/// - `access` unreadable to everyone (R1: whether a rule probe sees a row its
///   table hides);
/// - page orders over a nullable, a boolean or a unique id column (V2, V3);
/// - a further domain conjunct: residual filters (C2's lookahead) and a
///   null-valued equality (V5).
///
/// A third independent stream (so the draws above are unchanged) adds the
/// forms the engine decides per caller (OPEN C5, C8):
///
/// - half the unpaged totals become a search `exists` over the same domain
///   (LLP 3000.036 §15.12), which needs no decided rule and so draws every
///   read rule;
/// - a third of `Owner`/`OwnerOrWitness` read rules become
///   `.owner = viewer or exists access[0, viewer]`, a readable grant (§12.1);
///   `OwnerOrWitness` under the always-pinned `.bucket` is the parent-pinned
///   grant (§16.3);
/// - a third of pages and `exists` reads end their domain with a test that
///   reads no row (`exists access[bucket, viewer]`, its negation, `a < b`),
///   which the compiler lowers to an `if` around a returned page (§15.4).
pub fn generate(seed: u64) -> Case {
    use crate::ast::{Read, Rule};
    let mut case = crate::generate::generate(seed);
    unbound(&mut case);
    // Half the widened cases the model cannot run (projections, expiry) are
    // narrowed back into its fragment; the other half stay named unsupported.
    if crate::generate::Rng::new(seed ^ 0x4c45_414e_4e41_5257).next() % 2 == 0 {
        narrow(&mut case);
    }
    let mut extra = crate::generate::Rng::new(seed ^ 0x4c45_414e_4558_5354);
    if let Body::Read { kind: kind @ (Read::Count | Read::Sum | Read::Min | Read::Max), .. } = &mut case.program.body {
        if extra.pick(2) == 0 {
            *kind = Read::Exists;
        }
    }
    variants(&mut case, seed);
    if let Some(effects) = &mut case.program.tables[0].effects {
        if matches!(effects[0], Rule::Owner | Rule::OwnerOrWitness) && extra.pick(3) == 0 {
            effects[0] = Rule::OwnerOrGrant;
        }
    }
    if matches!(case.program.body, Body::Read { kind: Read::Page | Read::Bounded | Read::Exists, .. }) && extra.pick(3) == 0 {
        let guards = ["exists access[bucket, viewer]", "not exists access[bucket, viewer]", "a < b"];
        case.program.guard = Some(guards[extra.pick(3) as usize].to_owned());
    }
    membership_page(&mut case, seed);
    case
}

/// An unpinned owner-or-membership page. The membership roster has cap 16 by
/// its fixed principal and the inverse `(principal, bucket)` index, so the
/// compiler may discover every distinct bucket before merging target lanes.
fn membership_page(case: &mut Case, seed: u64) {
    use crate::ast::{Read, Residency, Rule};
    let mut rng = crate::generate::Rng::new(seed ^ 0x4d45_4d42_4552_5047);
    let Body::Read { kind: Read::Page | Read::Bounded, owner, .. } = &mut case.program.body else { return };
    if rng.pick(8) != 0 { return }
    *owner = false;
    let items = &mut case.program.tables[0];
    items.rule = Rule::OwnerOrWitness;
    items.effects = None;
    items.residency = Residency::Online;
    let access = case.program.tables.iter_mut().find(|table| table.name == "access").expect("generated access table");
    access.rule = Rule::Allow;
    access.effects = None;
    access.residency = Residency::Public;
    case.program.domain = Some("true".into());
    case.program.order = Some(vec!["id".into()]);
    case.program.guard = None;
}

/// The variants of the first two streams (`generate`).
fn variants(case: &mut Case, seed: u64) {
    use crate::ast::{Residency, Rule};
    let mut rng = crate::generate::Rng::new(seed ^ 0x4c45_414e_5641_5249);
    let mut pick = |n: u64| rng.next() % n;
    if pick(2) == 0 {
        return;
    }
    if pick(2) == 0 {
        // An unpaged total needs a read rule its pins decide (`E_QUARRY_BOUND`):
        // `.bucket` is always pinned, `.owner` only when the read pins it.
        let total = matches!(case.program.body, Body::Read { kind: crate::ast::Read::Count | crate::ast::Read::Sum | crate::ast::Read::Min | crate::ast::Read::Max, .. });
        let owner_pinned = matches!(case.program.body, Body::Read { owner: true, .. });
        let reads: &[Rule] = if total && !owner_pinned { &[Rule::Allow, Rule::Witness] } else { &[Rule::Allow, Rule::Owner, Rule::Witness, Rule::OwnerOrWitness] };
        let read = reads[pick(reads.len() as u64) as usize].clone();
        let insert = [Rule::Allow, Rule::Deny, Rule::Owner, Rule::Witness][pick(4) as usize].clone();
        let update = [Rule::Allow, Rule::Deny, Rule::Owner, Rule::Witness, Rule::NamedBoth, Rule::NamedNext, Rule::NamedOld][pick(7) as usize].clone();
        let delete = [Rule::Allow, Rule::Deny, Rule::Owner, Rule::Witness][pick(4) as usize].clone();
        case.program.tables[0].effects = Some(vec![read, insert, update, delete]);
        case.program.tables[0].residency = Residency::Online;
    }
    if pick(4) == 0 {
        case.program.tables[1].effects = Some(vec![Rule::Deny, Rule::Allow, Rule::Allow, Rule::Allow]);
        case.program.tables[1].residency = Residency::Online;
        // A hidden, open roster cannot carry a group audience (`E_SYNC`); the
        // model has no residency, so the group-synced branch shape reads online.
        if matches!(case.program.tables[0].residency, Residency::Group) {
            case.program.tables[0].residency = Residency::Online;
        }
    }
    if matches!(case.program.body, Body::Read { kind: crate::ast::Read::Page | crate::ast::Read::Bounded, .. }) && pick(2) == 0 {
        let orders: [&[&str]; 5] = [&["maybe"], &["maybe", "label"], &["flag", "score"], &["tag"], &["score"]];
        case.program.order = Some(orders[pick(5) as usize].iter().map(|c| c.to_string()).collect());
    }
    if matches!(case.program.body, Body::Read { .. }) && pick(3) == 0 {
        let residuals = [".score >= 0", ".label != ''", ".maybe = null", ".maybe = n", "(.score > 0 or .flag = false)"];
        case.program.residual = Some(residuals[pick(5) as usize].to_owned());
    }
}

/// Remove the widened dimensions outside the model's fragment (`widen.rs`):
/// page projections (`shape`) and expiry (`table-expiry`, and the `now` of
/// `until: now + ttl`). Blocks and the prelude are inside it.
pub fn narrow(case: &mut Case) {
    use crate::ast::Stmt;
    if let Body::Read { project, .. } = &mut case.program.body {
        *project = None;
    }
    if !matches!(case.program.body, Body::Read { kind: crate::ast::Read::Fold, .. }) {
        // The CUT generator can make tag a live reference used by a residual.
        // Narrow both the predicate and its type before dropping the target.
        for column in &mut case.program.tables[0].columns {
            if matches!(&column.ty, crate::ast::Type::Reference(target) if target == "tags") {
                column.ty = crate::ast::Type::Id;
            }
        }
        if case.program.residual.as_deref().is_some_and(|r| r.contains(".tag.rank")) {
            case.program.residual = None;
        }
        case.program.tables.retain(|t| t.name != "tags");
        case.rows.retain(|(t, _)| t != "tags");
    }
    for t in &mut case.program.tables {
        if t.expire.take().is_some() {
            t.columns.retain(|c| c.name != "until");
        }
    }
    for (_, row) in &mut case.rows {
        if let Some(o) = row.as_object_mut() {
            o.remove("until");
        }
    }
    fn plain(stmts: &mut [Stmt]) {
        for s in stmts {
            match s {
                Stmt::Write { ttl, .. } => *ttl = None,
                Stmt::If(_, a, b) => {
                    plain(a);
                    plain(b);
                }
                _ => {}
            }
        }
    }
    if let Body::Block(b) = &mut case.program.body {
        plain(&mut b.stmts);
    }
    for b in &mut case.program.prelude {
        plain(&mut b.stmts);
    }
    case.sweep = false;
    for s in &mut case.steps {
        s.sweep = false;
    }
}

/// Slot bounds are outside the model's fragment (LLP 3000.040 §1.8): every
/// Lean case drops them, so the campaign compares the rest of the case.
fn unbound(case: &mut Case) {
    case.program.arg_bound = None;
    for t in &mut case.program.tables {
        for c in &mut t.columns {
            if matches!(c.ty, crate::ast::Type::IntRange(..)) {
                c.ty = crate::ast::Type::Int;
            }
        }
    }
}

pub fn run_bounded(seed: u64, cases: u64, out: &std::path::Path, seconds: Option<f64>) -> Result<Report, String> {
    std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let started = std::time::Instant::now();
    let mut report = Report { seed, cases, ..Report::default() };
    let mut saved = BTreeSet::new();
    let mut failure = None;
    for i in 0..cases {
        if seconds.is_some_and(|limit| started.elapsed().as_secs_f64() >= limit) {
            report.time_limited_workers = 1;
            break;
        }
        let case_started = std::time::Instant::now();
        let case = generate(seed.wrapping_add(i));
        let mut findings = Vec::new();
        if let Err(error) = check(&case, &mut report, |f| {
            if saved.insert(f.signature.clone()) {
                findings.push(f);
            }
        }) {
            let path = out.join(format!("setup-{}", case.seed));
            std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            std::fs::write(path.join("case.q"), case.program.source()).map_err(|e| e.to_string())?;
            std::fs::write(path.join("case.json"), serde_json::to_vec_pretty(&case).unwrap()).map_err(|e| e.to_string())?;
            *report.generator_errors.entry(error.clone()).or_default() += 1;
            failure = Some(error);
            break;
        }
        for f in findings {
            let a = crate::shrink::shrink(case.clone(), f);
            crate::shrink::save(&out.join(&a.finding.signature), &a)?;
        }
        let elapsed = case_started.elapsed().as_secs_f64();
        if elapsed > report.slowest_case_seconds {
            report.slowest_case_seconds = elapsed;
            report.slowest_case_seed = Some(case.seed);
        }
        if (i + 1) % 1000 == 0 {
            eprintln!("{} cases in {:.1}s", i + 1, started.elapsed().as_secs_f64());
        }
    }
    report.seconds = started.elapsed().as_secs_f64();
    std::fs::write(out.join("report.json"), serde_json::to_vec_pretty(&report).unwrap()).map_err(|e| e.to_string())?;
    if let Some(error) = failure {
        return Err(error);
    }
    // A campaign large enough to qualify must have compared calendar cases (LLP 3000.040 §2.5).
    let compared = ["lean-calendar-agreed", "lean-calendar-disagreeing"].iter().map(|k| report.store_stats.get(*k).copied().unwrap_or(0)).sum::<u64>();
    if report.generated >= 5_000 && compared == 0 {
        return Err(format!("{} cases compared no calendar case: the calendar dimension was not drawn or not supported", report.generated));
    }
    Ok(report)
}
