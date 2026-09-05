//! Explicit ad hoc authoring requests use the bundled worker, then live-generation admission.
use crate::{
    control::{Context, control_identity},
    project::CompilerWorker,
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
    if matches!(path, "/control/job" | "/control/execute")
        && (body["dryRun"] == true || body["mode"] == "dry-run")
    {
        if body["plan"] == true || body["wait"] == true {
            return Some(Err((
                400,
                Refusal::input(
                    "--dry-run cannot combine with --wait or --plan",
                    "choose one run mode",
                )
                .with_site("mode"),
            )));
        }
        let name = body
            .get("name")
            .or_else(|| body.get("op"))
            .and_then(Json::as_str)
            .unwrap_or_default()
            .into();
        return Some(
            context
                .handle
                .rehearse(Target::Declared(name), args(body), control_identity(body))
                .map_err(|e| (400, e)),
        );
    }
    None
}

fn run_source(body: &Json, context: &Context) -> Result<Json, Refusal> {
    let mode = body.get("mode").and_then(Json::as_str).unwrap_or("");
    if !matches!(mode, "run" | "dry-run" | "plan") || mode == "dry-run" && body["wait"] == true {
        return Err(Refusal::input(
            "mode must be run, dry-run, or plan; dry-run excludes wait",
            "choose one run mode",
        )
        .with_site("mode"));
    }
    let source = source(body)?;
    // This is a submitted authoring operation, never background/restart compilation.
    // The persisted job executable is still the already-built IR (J1b).
    let compiled = CompilerWorker::spawn()?
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
    if (mode == "plan" || body["wait"] == true) && program.kind != ProgramKind::Job {
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
