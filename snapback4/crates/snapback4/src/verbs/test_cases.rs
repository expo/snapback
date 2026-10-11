//! `test.cases.jsonl` beside the fixture tables: the application's own
//! operations, in order, as named viewers, each with the outcome it expects.
//! One line is `{"as": "alice", "op": "addCard", "args": {..}, "expect": "sent"}`;
//! `expect` is `sent` (a mutation's default), `complete`, `capped`, `ok` (any
//! answer), or a refusal code (`E_RULE`, `NOT_FOUND`, a program's own `require`
//! code). A query's default is its `check` verdict: `complete`, or either
//! answer when `check` notes the query is never complete (N_NEVER_COMPLETE).
//! Optional `data` must equal the answer; `count` is the answer's length; `save`
//! names the answer so a later string argument `"$name"` or `"$name.field"`
//! reuses it. `as` is a declared persona, as on dev: an undeclared one is
//! refused E_AUTH.
use crate::project::persona_principal;
use snapback4_core::engine::refusal_trace::RefusalTrace;
use snapback4_core::ir::ProgramKind;
use snapback4_core::{Context, Engine, Refusal, WriteState, wire};
use snapback4_lang::Bound;
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;
use std::path::Path;

pub const FILE: &str = "test.cases.jsonl";

/// Dev's cast check, for `test` and a local `run`: with `use personas`
/// declared, a bare name (or `dev:<name>`) outside the cast is refused as dev
/// refuses its header (E_AUTH); a principal id such as `user:…` passes as itself.
pub fn undeclared_persona(name: &str, declared: &[String]) -> Option<String> {
    if declared.is_empty() { return None; }
    let bare = match name.split_once(':') { None => name, Some(("dev", bare)) => bare, Some(_) => return None };
    (!declared.iter().any(|p| p == bare)).then(|| format!(
        "persona {bare} is not declared; `use personas {}` is this project's cast, and dev refuses {bare} with E_AUTH (401). Add {bare} to it, or use a declared persona (an outsider is a declared persona with no rows)",
        declared.join(", ")))
}

/// The persona a case without `as` runs as: alice when she is in the cast (or
/// there is none), else the first declared persona.
pub fn default_persona(declared: &[String]) -> &str {
    if declared.is_empty() || declared.iter().any(|p| p == "alice") { "alice" } else { &declared[0] }
}

/// Runs every case; prints one line each and returns (passed, failed).
/// `sources` are the compiled files, to quote a refusing clause's line.
pub fn run(engine: &mut Engine, bound: &Bound, fixture: &str, sources: &[(String, String)]) -> Result<(usize, usize), String> {
    let path = Path::new(fixture).join(FILE);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok((0, 0)),
        Err(error) => return Err(format!("cannot read {}: {error}", path.display())),
    };
    let mut saved = BTreeMap::<String, Json>::new();
    let (mut passed, mut failed) = (0, 0);
    let mut verdicts_shown = std::collections::BTreeSet::new();
    println!("test: cases from {FILE}");
    for (index, line) in text.lines().enumerate().filter(|(_, line)| !line.trim().is_empty() && !line.trim_start().starts_with("//")) {
        let at = format!("{FILE}:{}", index + 1);
        let case: Json = serde_json::from_str(line).map_err(|error| format!("{at}: {error}"))?;
        let Some(op) = case.get("op").and_then(Json::as_str) else { return Err(format!("{at}: each case names \"op\" (a query or mutation)")) };
        let Some(bound_program) = bound.programs.iter().find(|p| p.program.name == op) else {
            return Err(format!("{at}: unknown operation {op}"));
        };
        let program = bound_program.program.clone();
        let persona = case.get("as").and_then(Json::as_str).unwrap_or_else(|| default_persona(&bound.personas));
        let principal = if persona.contains(':') { persona.to_owned() } else { persona_principal(persona) };
        // A query's default expectation is check's verdict: a noted never-complete page passes capped.
        let never_complete = (program.kind == ProgramKind::Query).then(|| never_complete(bound, bound_program)).flatten();
        let explicit = case.get("expect").and_then(Json::as_str);
        let expect = explicit.unwrap_or(match program.kind { ProgramKind::Query if never_complete.is_some() => "ok", ProgramKind::Query => "complete", _ => "sent" });
        let label = case.get("label").and_then(Json::as_str).map(|l| format!(" — {l}")).unwrap_or_default();
        let raw_args = substitute(case.get("args").cloned().unwrap_or_else(|| json!({})), &saved).map_err(|why| format!("{at}: {why}"))?;
        let mut args = BTreeMap::new();
        if let Json::Object(fields) = &raw_args {
            for (name, value) in fields {
                let Some(kind) = program.args.get(name) else { return Err(format!("{at}: {op} takes no argument {name}")) };
                args.insert(name.clone(), wire::from_json(kind, value).map_err(|why| format!("{at}: argument {name}: {why}"))?);
            }
        } else { return Err(format!("{at}: \"args\" is an object")); }
        let trace = RefusalTrace::default();
        let context = Context::new(principal, args).with_refusal_trace(trace.clone());
        // (outcome word, answer) or a refusal
        let got: Result<(&str, Json), Refusal> = if let Some(why) = undeclared_persona(persona, &bound.personas) {
            Err(Refusal::new("E_AUTH", "auth", why))
        } else { match program.kind {
            ProgramKind::Query => match engine.query(op, context) {
                Ok(outcome) => Ok((if outcome.complete { "complete" } else { "capped" }, wire::to_json(&outcome.data))),
                Err(refusal) => Err(refusal),
            },
            ProgramKind::Job => return Err(format!("{at}: {op} is a job; cases run queries and mutations")),
            _ => match engine.mutate(op, None, context) {
                Ok(outcome) => match outcome.state {
                    WriteState::Sent { result, .. } => Ok(("sent", wire::to_json(&result))),
                    WriteState::Failed { why, .. } => Err(why),
                },
                Err(error) => Err(error.refusal()),
            },
        } };
        let mut problems = Vec::new();
        let mut notes = Vec::new();
        let shown = match &got {
            Ok((word, answer)) => {
                let admitted = *word == expect || expect == "ok" || (expect == "complete" && *word == "sent");
                if !admitted { problems.push(format!("expected {expect}, got {word}")); }
                if *word == "capped" && let Some(note) = &never_complete {
                    if admitted && explicit.is_none() && verdicts_shown.insert(op.to_owned()) { notes.push(format!("capped is this query's check verdict: {note}")); }
                    if !admitted { notes.push(format!("hint: {note}; a capped answer still holds every row you may read: add \"expect\":\"capped\" (or drop \"expect\"), or pin the page as the note's rewrite says (snapback4 check --verbose)")); }
                }
                if let Some(data) = case.get("data") && data != answer { problems.push(format!("data differs: got {answer}")); }
                if let Some(count) = case.get("count").and_then(Json::as_u64) {
                    let length = answer.as_array().map(|a| a.len()).or_else(|| answer.get("items").and_then(Json::as_array).map(|a| a.len()));
                    if length != Some(count as usize) { problems.push(format!("expected {count} rows, got {}", length.map(|n| n.to_string()).unwrap_or_else(|| "a non-list".into()))); }
                }
                if let Some(name) = case.get("save").and_then(Json::as_str) { saved.insert(name.to_owned(), answer.clone()); }
                (*word).to_owned()
            }
            Err(refusal) => {
                let code = &refusal.code;
                if code != expect && !(expect == "denied" || expect == "refused" || expect == "failed") {
                    problems.push(format!("expected {expect}, got {code}: {}", refusal.message));
                    notes.extend(refusal_evidence(&trace, refusal, bound, sources, explicit));
                }
                code.clone()
            }
        };
        if problems.is_empty() {
            passed += 1;
            println!("      ok   {at} {op} ({persona}) → {shown}{label}");
        } else {
            failed += 1;
            println!("      FAIL {at} {op} ({persona}) → {shown}{label}: {}", problems.join("; "));
        }
        for note in notes { println!("           {note}"); }
    }
    Ok((passed, failed))
}

/// The query's N_NEVER_COMPLETE note, as `N_NEVER_COMPLETE at schema.q:L`.
fn never_complete(bound: &Bound, program: &snapback4_lang::BoundProgram) -> Option<String> {
    bound.notes.iter().chain(&program.notes)
        .find(|note| note.code == "N_NEVER_COMPLETE" && note.site == program.site)
        .map(|note| format!("{} is never complete (N_NEVER_COMPLETE at {}:{})", program.program.name, note.site.file, note.site.line))
}

/// Development evidence under a failing refusal: which layer refused, at which
/// line (LLP 3000.036 §3 B; the refusal itself never names the clause).
fn refusal_evidence(trace: &RefusalTrace, refusal: &Refusal, bound: &Bound, sources: &[(String, String)], explicit: Option<&str>) -> Vec<String> {
    let lookup = |file: &str| sources.iter().find(|(name, _)| name == file).map(|(_, text)| text.clone());
    let cause = trace.take();
    let mut out = Vec::new();
    match cause {
        Some(cause) if cause.terminal => {
            let record = super::run_refusal::record(&cause, &bound.refusal_sites);
            if let Some(text) = super::run_refusal::explain(&record, &lookup) { out.push(text.trim_start_matches("dev: ").to_owned()); }
            if refusal.code == "E_RULE" && (cause.clause.starts_with("unique ") || cause.clause.starts_with("cap ")) {
                let held = if cause.clause.starts_with("unique ") { format!("a row with this `{}` key exists that this viewer cannot read", cause.clause) } else { format!("the `{}` group holds rows this viewer cannot read", cause.clause) };
                out.push(format!("hint: {held}; your own code would disclose it, so the engine refuses E_RULE: expect E_RULE here, or make those rows readable to the viewer (guide rules)"));
            }
        }
        // A program's own `! else CODE` or `require … else CODE`, at its
        // source line. When that site is a `t[x] !` lookup and t's read rule
        // hid a row in this operation, the row exists but reads as absent to
        // this viewer: a later `require` never ran.
        cause => if let Some(site) = refusal.site.as_deref().filter(|_| refusal.rule.as_deref() == Some(refusal.code.as_str())) {
            let line = super::run_refusal::quote(site, &lookup);
            let shown = line.as_ref().map(|line| format!("`{line}` ({site})")).unwrap_or_else(|| site.to_owned());
            let hidden = cause.filter(|cause| !cause.terminal && cause.phase == "read rule"
                && bound.refusal_sites.contains_key(&(cause.table.clone(), format!("lookup {site}"))));
            match hidden {
                Some(cause) => {
                    let rule = bound.refusal_sites.get(&(cause.table.clone(), "read rule".into()));
                    let quoted = rule.map(|rule| match super::run_refusal::quote(rule, &lookup) { Some(text) => format!("`{text}` ({rule})"), None => rule.clone() }).unwrap_or_else(|| "its read rule".into());
                    let later = explicit.filter(|code| *code != refusal.code && sources.iter().any(|(_, text)| text.contains(&format!("else {code}")))).map(|code| format!("; a later `require … else {code}` never ran")).unwrap_or_default();
                    out.push(format!("{} is the program's own refusal at {shown}: the {} read rule {quoted} hid a row from this viewer, and a hidden row reads as absent to a lookup{later}", refusal.code, cause.table));
                    out.push("hint: no code after the lookup can tell \"not yours\" from \"missing\": expect NOT_FOUND here, admit the viewer in the read rule, or write by id with no lookup so the table's update/delete rule decides (snapback4 guide testing, guide refusals)".into());
                }
                None => out.push(format!("{} is the program's own refusal at {shown}", refusal.code)),
            }
        },
    }
    out
}

/// `"$name"` is a saved answer (a saved row's id); `"$name.field"` (any depth) one of its fields.
fn substitute(value: Json, saved: &BTreeMap<String, Json>) -> Result<Json, String> {
    Ok(match value {
        Json::String(text) if text.starts_with('$') && text.len() > 1 => {
            let mut parts = text[1..].split('.');
            let name = parts.next().unwrap_or_default();
            let mut current = saved.get(name).ok_or_else(|| format!("{text}: nothing was saved as {name} (add \"save\": \"{name}\" to an earlier case)"))?;
            let mut fields = 0;
            for part in parts {
                current = current.get(part).ok_or_else(|| format!("{text}: the saved answer has no field {part}"))?;
                fields += 1;
            }
            // An argument names a row by its id: a bare `$name` for a saved
            // row (an insert's answer) means that row's id.
            match current.get("id").and_then(Json::as_str) { Some(id) if fields == 0 => Json::String(id.to_owned()), _ => current.clone() }
        }
        Json::Array(items) => Json::Array(items.into_iter().map(|item| substitute(item, saved)).collect::<Result<_, _>>()?),
        Json::Object(fields) => Json::Object(fields.into_iter().map(|(k, v)| Ok((k, substitute(v, saved)?))).collect::<Result<_, String>>()?),
        other => other,
    })
}
