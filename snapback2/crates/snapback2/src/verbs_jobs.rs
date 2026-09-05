//! Operator job adapters; the owner remains the only store writer.
use crate::{client, owner, project::CompilerWorker, protocol::Refusal, verbs::*};
use serde_json::{Value as Json, json};
use snapback2_core::ProgramKind;
use std::{fs, process::ExitCode, thread, time::Duration};

pub fn run(args: &[String]) -> ExitCode {
    let options = match parse_options(
        args,
        &["--project", "--as", "--file", "--cancel", "--resume"],
        &["--json", "--wait", "--plan"],
    ) {
        Ok(o) => o,
        Err(c) => return c,
    };
    let json_output = options.has("--json");
    let positional = options.positionals();
    let file = options.value("--file");
    let control = options.value("--cancel").or(options.value("--resume"));
    let exclusive = [
        file.is_some(),
        options.value("--cancel").is_some(),
        options.value("--resume").is_some(),
    ]
    .iter()
    .filter(|x| **x)
    .count();
    if exclusive > 1
        || (options.has("--wait") && options.has("--plan"))
        || (control.is_some()
            && (positional.len() != 1 || options.has("--wait") || options.has("--plan")))
        || (control.is_none()
            && !(if file.is_some() { 1..=2 } else { 2..=3 }).contains(&positional.len()))
    {
        return usage(
            "usage: snapback2 run <op> [args-json] --as persona|system [--wait|--plan]; run --file path.q [args-json] --as system; run --cancel|--resume job_id --as system",
        );
    }
    let persona = options.value("--as").unwrap_or("");
    if (file.is_some() || control.is_some() || options.has("--wait") || options.has("--plan"))
        && persona != "system"
    {
        return refused(operator_required(), json_output, 1);
    }
    let args_json = match positional.get(if file.is_some() { 1 } else { 2 }) {
        Some(arg) => match serde_json::from_str::<Json>(arg) {
            Ok(j) => j,
            Err(e) => {
                return refused(
                    Refusal::input(format!("invalid args JSON: {e}"), "pass a JSON object"),
                    json_output,
                    2,
                );
            }
        },
        None => json!({}),
    };
    let (root, attached) = match attached(&options) {
        Ok(o) => o,
        Err(e) => return refused(e, json_output, 1),
    };
    if let Some(id) = control {
        let operation = if options.value("--resume").is_some() {
            "resume"
        } else {
            "cancel"
        };
        return response(
            client::control(
                &attached,
                "POST",
                &format!("/control/job/{id}/{operation}"),
                json!({"as":persona}),
            ),
            json_output,
        );
    }
    let result = if let Some(file) = file {
        let source = match fs::read(file) {
            Ok(s) => s,
            Err(e) => {
                return refused(
                    Refusal::input(e.to_string(), "pass a readable Quarry file"),
                    json_output,
                    2,
                );
            }
        };
        if source.len() > 65536 {
            return refused(
                Refusal::new(
                    "E_ADHOC_SIZE",
                    "operator",
                    "ad hoc source exceeds 64 KiB",
                    "declare it as a job",
                    "job",
                )
                .with_site(file),
                json_output,
                1,
            );
        }
        let source = match String::from_utf8(source) {
            Ok(s) => s,
            Err(e) => {
                return refused(
                    Refusal::input(e.to_string(), "use UTF-8 Quarry"),
                    json_output,
                    2,
                );
            }
        };
        let mut worker = match CompilerWorker::spawn() {
            Ok(w) => w,
            Err(e) => return refused(e, json_output, 1),
        };
        let compiled = match worker.compile_source(&root, Some(&source)) {
            Ok(c) => c,
            Err(e) => {
                return refused(
                    Refusal::from_refusals(
                        e,
                        Refusal::input("ad hoc compilation failed", "fix the Quarry source"),
                    ),
                    json_output,
                    1,
                );
            }
        };
        let programs: Vec<_> = compiled
            .project
            .programs
            .iter()
            .filter(|p| p.name.starts_with("__adhoc."))
            .collect();
        if programs.len() != 1 {
            return refused(
                Refusal::input(
                    "--file requires exactly one query, mutation, or job",
                    "put one declaration in the file",
                ),
                json_output,
                2,
            );
        }
        let program = programs[0];
        if (options.has("--wait") || options.has("--plan")) && program.kind != ProgramKind::Job {
            return usage("--wait and --plan require a job");
        }
        client::control(
            &attached,
            "POST",
            if program.kind == ProgramKind::Job {
                "/control/job"
            } else {
                "/control/execute"
            },
            json!({"program":program,"source":source,"args":args_json,"as":"system","plan":options.has("--plan")}),
        )
    } else {
        let requested = positional[1];
        let manifest = match client::api(&attached, "GET", "/api/manifest", &[], json!({})) {
            Ok(r) if r.status < 400 => r.body,
            Ok(r) => return print_response(r.status, r.body, json_output),
            Err(e) => return refused(e, json_output, 1),
        };
        let ops = &manifest["ops"];
        let names: Vec<_> = ops
            .as_object()
            .into_iter()
            .flat_map(|o| o.keys())
            .filter(|n| n.as_str() == requested || n.rsplit('.').next() == Some(requested))
            .collect();
        let name = if ops.get(requested).is_some() {
            requested
        } else if names.len() == 1 {
            names[0]
        } else {
            return refused(
                Refusal::new(
                    "E_OP_UNKNOWN",
                    "op",
                    format!("unknown or ambiguous operation {requested}"),
                    "use a qualified name from /api/manifest",
                    "op/manifest",
                ),
                json_output,
                1,
            );
        };
        let kind = ops[name]["kind"].as_str().unwrap_or("");
        if kind == "job" && persona != "system" {
            return refused(operator_required(), json_output, 1);
        }
        if (options.has("--plan") || options.has("--wait")) && kind != "job" {
            return usage("--plan and --wait require a job");
        }
        if kind == "job" {
            client::control(
                &attached,
                "POST",
                "/control/job",
                json!({"name":name,"args":args_json,"as":"system","plan":options.has("--plan")}),
            )
        } else if persona == "system" {
            client::control(
                &attached,
                "POST",
                "/control/execute",
                json!({"op":name,"args":args_json,"as":"system"}),
            )
        } else {
            if persona.is_empty() {
                return usage("run requires --as persona|system");
            }
            client::api(
                &attached,
                "POST",
                if kind == "mutation" {
                    "/api/mutation"
                } else {
                    "/api/query"
                },
                &[("X-Snapback-As", persona)],
                json!({"op":name,"args":args_json}),
            )
        }
    };
    match result {
        Ok(r) if r.status < 400 && options.has("--wait") => {
            let Some(id) = r.body["id"].as_str() else {
                return print_response(r.status, r.body, json_output);
            };
            wait(&attached, id, json_output)
        }
        result => response(result, json_output),
    }
}
fn response(result: Result<client::HttpResponse, Refusal>, json_output: bool) -> ExitCode {
    match result {
        Ok(r) => {
            let rejected = r.body["state"] == "rejected" || r.body["state"] == "parked";
            let code = print_response(r.status, r.body, json_output);
            if rejected { ExitCode::from(1) } else { code }
        }
        Err(e) => refused(e, json_output, 1),
    }
}
fn operator_required() -> Refusal {
    Refusal::new(
        "E_OPERATOR_REQUIRED",
        "operator",
        "jobs require the operator seat",
        "--as system, or an admin token",
        "job",
    )
    .with_site("run")
}
// @ref LLP 1016#d6--the-operator-seat-ad-hoc-programs-and-rehearsal — polling drains committed chunks; a parked job exits with its refusal.
fn wait(attached: &owner::OwnerInfo, id: &str, json_output: bool) -> ExitCode {
    let mut after = 0;
    let mut chunk = 0;
    loop {
        let r = match client::control(
            attached,
            "GET",
            &format!("/control/job/{id}?after={after}"),
            json!({}),
        ) {
            Ok(r) if r.status < 400 => r,
            other => return response(other, json_output),
        };
        if let Some(commits) = r.body["commits"].as_array() {
            for commit in commits {
                after = commit["seq"].as_u64().unwrap_or(after);
                chunk += 1;
                if json_output {
                    println!("{}", json!({"job":id,"chunk":chunk,"commit":commit}));
                } else {
                    println!("{id} chunk {chunk} · seq {after} · {}", commit["writes"]);
                }
            }
        }
        if r.body["hasMoreCommits"] == true {
            continue;
        }
        match r.body["state"].as_str() {
            Some("done") => {
                print_response(200, r.body, json_output);
                return ExitCode::SUCCESS;
            }
            Some("parked" | "cancelled") => {
                print_response(200, r.body, json_output);
                return ExitCode::from(1);
            }
            _ => thread::sleep(Duration::from_millis(20)),
        }
    }
}
