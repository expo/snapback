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
    // @ref LLP 1016#d8--surface-and-diagnostics — every supplied mode flag is
    // either honoured by this route or refused; direct owner requests never
    // acquire CLI-only polling semantics by sending `wait`.
    if path == "/control/job" {
        match flag(body, "wait") {
            Err(refusal) => return Some(Err((400, refusal))),
            Ok(true) => return Some(Err((400, owner_wait()))),
            Ok(false) => {}
        }
    }
    match requested_mode(body) {
        Ok(Mode::DryRun) => Some(rehearse_declared(body, context).map_err(|e| (400, e))),
        Ok(Mode::Plan) if path == "/control/execute" => Some(Err((400, op_kind()))),
        Ok(Mode::Run | Mode::Plan) => None,
        Err(refusal) => Some(Err((400, refusal))),
    }
}

fn owner_wait() -> Refusal {
    Refusal::input(
        "wait is CLI-side polling, not an owner job mode",
        "enqueue the job without wait and poll its id, or use snapback2 run <job> --wait",
    )
    .with_site("wait")
}

/// How a body asks to run. `mode` names it; `dryRun: true` or `plan: true` alone chooses it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    Run,
    DryRun,
    Plan,
}

/// The one reading of `mode`, `dryRun`, and `plan`, shared by every operator route and by
/// the CLI client's timeout choice, so nothing a body says is ignored: a flag is a JSON
/// boolean or refused (`"dryRun": "true"` never falls through to a real run), and a flag
/// that disagrees with `mode`, or with the other flag, refuses `E_INPUT` at the flag's site.
pub(crate) fn requested_mode(body: &Json) -> Result<Mode, Refusal> {
    let dry_run = flag(body, "dryRun")?;
    let plan = flag(body, "plan")?;
    let mode = match body.get("mode") {
        None => None,
        Some(Json::String(mode)) => Some(match mode.as_str() {
            "run" => Mode::Run,
            "dry-run" => Mode::DryRun,
            "plan" => Mode::Plan,
            _ => return Err(bad_mode()),
        }),
        Some(_) => return Err(bad_mode()),
    };
    if body.get("dryRun").is_some() && mode.is_some_and(|mode| (mode == Mode::DryRun) != dry_run) {
        return Err(Refusal::input(
            "dryRun and mode disagree",
            "send dryRun: true, or mode: \"dry-run\", not both",
        )
        .with_site("dryRun"));
    }
    if body.get("plan").is_some() && mode.is_some_and(|mode| (mode == Mode::Plan) != plan) {
        return Err(Refusal::input(
            "plan and mode disagree",
            "send plan: true, or mode: \"plan\", not both",
        )
        .with_site("plan"));
    }
    if dry_run && plan {
        return Err(Refusal::input(
            "dryRun and plan disagree",
            "a rehearsal runs the job; a plan estimates it: send one",
        )
        .with_site("plan"));
    }
    Ok(mode.unwrap_or(if dry_run {
        Mode::DryRun
    } else if plan {
        Mode::Plan
    } else {
        Mode::Run
    }))
}
fn bad_mode() -> Refusal {
    Refusal::input("mode must be run, dry-run, or plan", "choose one run mode").with_site("mode")
}
fn op_kind() -> Refusal {
    Refusal::new(
        "E_OP_KIND",
        "op",
        "--plan and --wait require a job",
        "use a job or omit --plan/--wait",
        "job",
    )
    .with_site("mode")
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
    if flag(body, "wait")? {
        return Err(Refusal::input(
            "--dry-run cannot combine with --wait",
            "choose one run mode",
        )
        .with_site("wait"));
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
    let mode = requested_mode(body)?;
    let wait = flag(body, "wait")?;
    if mode == Mode::DryRun && wait {
        return Err(Refusal::input(
            "--dry-run cannot combine with --wait",
            "choose one run mode",
        )
        .with_site("wait"));
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
    if (mode == Mode::Plan || wait) && program.kind != ProgramKind::Job {
        return Err(op_kind());
    }
    if mode == Mode::DryRun {
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
            plan: mode == Mode::Plan,
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
