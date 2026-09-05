//! Explicit ad hoc authoring requests use the owner's compiler worker, then live-generation admission.
//!
//! `POST /control/run` and `POST /control/job` are the operator seat by definition, so
//! `control::route` fills `as: system` when a body omits it. `POST /control/execute` is
//! not defaulted: it also serves explicit personas, so a `dryRun` there needs `as: system`.
use crate::{
    control::{Context, control_identity},
    project::lock_compiler,
    protocol::Refusal,
    rehearsal::Target,
    writer::Action,
};
use serde_json::{Value as Json, json};
use snapback2_core::ProgramKind;

pub fn route(
    method: &str,
    path: &str,
    body: &Json,
    context: &Context,
) -> Option<Result<Json, (u16, Refusal)>> {
    if method != "POST" {
        return None;
    }
    if path == "/control/run" {
        return Some(run_source(body, context).map_err(|e| (400, e)));
    }
    if !matches!(path, "/control/job" | "/control/execute") {
        return None;
    }
    match rehearsal_requested(body) {
        Ok(false) => None,
        Ok(true) => Some(rehearse_declared(body, context).map_err(|e| (400, e))),
        Err(refusal) => Some(Err((400, refusal))),
    }
}

/// A rehearsal is requested by a JSON boolean and nothing else: `"dryRun": "true"`
/// is refused rather than falling through to a real run.
fn rehearsal_requested(body: &Json) -> Result<bool, Refusal> {
    let dry_run = flag(body, "dryRun")?;
    let mode = match body.get("mode") {
        None => None,
        Some(Json::String(mode)) if matches!(mode.as_str(), "run" | "dry-run") => {
            Some(mode == "dry-run")
        }
        Some(_) => {
            return Err(
                Refusal::input("mode must be run or dry-run", "choose one run mode")
                    .with_site("mode"),
            );
        }
    };
    if body.get("dryRun").is_some() && mode.is_some_and(|rehearse| rehearse != dry_run) {
        return Err(Refusal::input(
            "dryRun and mode disagree",
            "send dryRun: true, or mode: \"dry-run\", not both",
        )
        .with_site("mode"));
    }
    Ok(dry_run || mode == Some(true))
}

/// A boolean request field: absent is false; anything but `true`/`false` is refused.
pub(crate) fn flag(body: &Json, name: &str) -> Result<bool, Refusal> {
    match body.get(name) {
        None => Ok(false),
        Some(Json::Bool(value)) => Ok(*value),
        Some(_) => Err(Refusal::input(
            format!("{name} must be true or false"),
            format!("send {name}: true, or omit it"),
        )
        .with_site(name)),
    }
}

fn rehearse_declared(body: &Json, context: &Context) -> Result<Json, Refusal> {
    if flag(body, "plan")? || flag(body, "wait")? {
        return Err(Refusal::input(
            "--dry-run cannot combine with --wait or --plan",
            "choose one run mode",
        )
        .with_site("mode"));
    }
    let name = body
        .get("name")
        .or_else(|| body.get("op"))
        .and_then(Json::as_str)
        .unwrap_or_default()
        .into();
    context
        .handle
        .rehearse(Target::Declared(name), args(body), control_identity(body))
}

fn run_source(body: &Json, context: &Context) -> Result<Json, Refusal> {
    let mode = body.get("mode").and_then(Json::as_str).unwrap_or("");
    let wait = flag(body, "wait")?;
    if !matches!(mode, "run" | "dry-run" | "plan") || mode == "dry-run" && wait {
        return Err(Refusal::input(
            "mode must be run, dry-run, or plan; dry-run excludes wait",
            "choose one run mode",
        )
        .with_site("mode"));
    }
    let source = source(body)?;
    // This is a submitted authoring operation, never background/restart compilation.
    // The persisted job executable is still the already-built IR (J1b). The owner's
    // one worker is shared with the source watcher; the lock caps compilation at one.
    let compiled = lock_compiler(&context.compiler)
        .compile_source(&context.root, Some(&source))
        .map_err(|errors| {
            Refusal::from_refusals(
                errors,
                Refusal::input("ad hoc compilation failed", "fix the Quarry source"),
            )
        })?;
    let mut programs = compiled
        .project
        .programs
        .into_iter()
        .filter(|p| p.name.starts_with("__adhoc."));
    let program = programs
        .next()
        .filter(|_| programs.next().is_none())
        .ok_or_else(|| {
            Refusal::input(
                "source requires exactly one query, mutation, or job",
                "submit one declaration",
            )
            .with_site("source")
        })?;
    if (mode == "plan" || wait) && program.kind != ProgramKind::Job {
        return Err(Refusal::new(
            "E_OP_KIND",
            "op",
            "--plan and --wait require a job",
            "use a job or omit --plan/--wait",
            "job",
        )
        .with_site("mode"));
    }
    if mode == "dry-run" {
        context.handle.rehearse(
            Target::Adhoc { program, source },
            args(body),
            control_identity(body),
        )
    } else {
        context.handle.call(Action::Adhoc {
            program,
            source,
            args: args(body),
            identity: control_identity(body),
            plan: mode == "plan",
        })
    }
}

fn args(body: &Json) -> Json {
    body.get("args").cloned().unwrap_or_else(|| json!({}))
}
fn source(body: &Json) -> Result<String, Refusal> {
    let source = body.get("source").and_then(Json::as_str).ok_or_else(|| {
        Refusal::input(
            "source must be Quarry text",
            "submit one Quarry declaration",
        )
        .with_site("source")
    })?;
    if source.len() > 65536 {
        return Err(Refusal::new(
            "E_ADHOC_SIZE",
            "operator",
            "ad hoc source exceeds 64 KiB",
            "declare it as a job",
            "job",
        )
        .with_site("source"));
    }
    Ok(source.into())
}
