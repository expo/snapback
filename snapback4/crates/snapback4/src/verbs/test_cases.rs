//! `test.cases.jsonl` beside the fixture tables: the application's own
//! operations, in order, as named viewers, each with the outcome it expects.
//! One line is `{"as": "alice", "op": "addCard", "args": {..}, "expect": "sent"}`;
//! `expect` is `sent`/`complete` (the default), `capped`, or a refusal code
//! (`E_RULE`, `NOT_FOUND`, a program's own `require` code). Optional `data`
//! must equal the answer; `count` is the answer's length; `save` names the
//! answer so a later string argument `"$name"` or `"$name.field"` reuses it.
use crate::project::persona_principal;
use snapback4_core::ir::ProgramKind;
use snapback4_core::{Context, Engine, WriteState, wire};
use snapback4_lang::Bound;
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;
use std::path::Path;

pub const FILE: &str = "test.cases.jsonl";

/// Runs every case; prints one line each and returns (passed, failed).
pub fn run(engine: &mut Engine, bound: &Bound, fixture: &str) -> Result<(usize, usize), String> {
    let path = Path::new(fixture).join(FILE);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok((0, 0)),
        Err(error) => return Err(format!("cannot read {}: {error}", path.display())),
    };
    let mut saved = BTreeMap::<String, Json>::new();
    let (mut passed, mut failed) = (0, 0);
    println!("test: cases from {FILE}");
    for (index, line) in text.lines().enumerate().filter(|(_, line)| !line.trim().is_empty() && !line.trim_start().starts_with("//")) {
        let at = format!("{FILE}:{}", index + 1);
        let case: Json = serde_json::from_str(line).map_err(|error| format!("{at}: {error}"))?;
        let Some(op) = case.get("op").and_then(Json::as_str) else { return Err(format!("{at}: each case names \"op\" (a query or mutation)")) };
        let Some(program) = bound.programs.iter().find(|p| p.program.name == op).map(|p| p.program.clone()) else {
            return Err(format!("{at}: unknown operation {op}"));
        };
        let persona = case.get("as").and_then(Json::as_str).unwrap_or("alice");
        let principal = if persona.contains(':') { persona.to_owned() } else { persona_principal(persona) };
        let expect = case.get("expect").and_then(Json::as_str).unwrap_or(if program.kind == ProgramKind::Query { "complete" } else { "sent" });
        let label = case.get("label").and_then(Json::as_str).map(|l| format!(" — {l}")).unwrap_or_default();
        let raw_args = substitute(case.get("args").cloned().unwrap_or_else(|| json!({})), &saved).map_err(|why| format!("{at}: {why}"))?;
        let mut args = BTreeMap::new();
        if let Json::Object(fields) = &raw_args {
            for (name, value) in fields {
                let Some(kind) = program.args.get(name) else { return Err(format!("{at}: {op} takes no argument {name}")) };
                args.insert(name.clone(), wire::from_json(kind, value).map_err(|why| format!("{at}: argument {name}: {why}"))?);
            }
        } else { return Err(format!("{at}: \"args\" is an object")); }
        let context = Context::new(principal, args);
        // (outcome word, answer) or a refusal code
        let got: Result<(&str, Json), (String, String)> = match program.kind {
            ProgramKind::Query => match engine.query(op, context) {
                Ok(outcome) => Ok((if outcome.complete { "complete" } else { "capped" }, wire::to_json(&outcome.data))),
                Err(refusal) => Err((refusal.code, refusal.message)),
            },
            ProgramKind::Job => return Err(format!("{at}: {op} is a job; cases run queries and mutations")),
            _ => match engine.mutate(op, None, context) {
                Ok(outcome) => match outcome.state {
                    WriteState::Sent { result, .. } => Ok(("sent", wire::to_json(&result))),
                    WriteState::Failed { why, .. } => Err((why.code, why.message)),
                },
                Err(error) => { let refusal = error.refusal(); Err((refusal.code, refusal.message)) }
            },
        };
        let mut problems = Vec::new();
        let shown = match &got {
            Ok((word, answer)) => {
                if *word != expect && !(expect == "ok" || (expect == "complete" && *word == "sent")) { problems.push(format!("expected {expect}, got {word}")); }
                if let Some(data) = case.get("data") && data != answer { problems.push(format!("data differs: got {answer}")); }
                if let Some(count) = case.get("count").and_then(Json::as_u64) {
                    let length = answer.as_array().map(|a| a.len()).or_else(|| answer.get("items").and_then(Json::as_array).map(|a| a.len()));
                    if length != Some(count as usize) { problems.push(format!("expected {count} rows, got {}", length.map(|n| n.to_string()).unwrap_or_else(|| "a non-list".into()))); }
                }
                if let Some(name) = case.get("save").and_then(Json::as_str) { saved.insert(name.to_owned(), answer.clone()); }
                (*word).to_owned()
            }
            Err((code, message)) => {
                if code != expect && !(expect == "denied" || expect == "refused" || expect == "failed") { problems.push(format!("expected {expect}, got {code}: {message}")); }
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
    }
    Ok((passed, failed))
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
