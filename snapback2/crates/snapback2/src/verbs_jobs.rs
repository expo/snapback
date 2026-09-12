//! Operator job adapters; the owner remains the only store writer.
use crate::{client, owner, protocol::Refusal, verbs::*};
use serde_json::{Value as Json, json};
use std::{fs, process::ExitCode, thread, time::Duration};

pub fn run(args: &[String]) -> ExitCode {
    let options = match parse_options(
        args,
        &["--project", "--as", "--file", "--cancel", "--resume"],
        &["--json", "--wait", "--plan", "--dry-run"],
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
        || (options.has("--dry-run")
            && (options.has("--wait") || options.has("--plan") || control.is_some()))
        || (control.is_some()
            && (positional.len() != 1 || options.has("--wait") || options.has("--plan")))
        || (control.is_none()
            && !(if file.is_some() { 1..=2 } else { 2..=3 }).contains(&positional.len()))
    {
        return usage(
            "usage: snapback2 run <op> [args-json] --as persona|system [--wait|--plan|--dry-run]; run --file path.q [args-json] --as system [--wait|--plan|--dry-run]; run --cancel|--resume job_id --as system. --wait prints one line per chunk, then the job's final envelope (its receipt)",
        );
    }
    let persona = options.value("--as").unwrap_or("");
    if (file.is_some()
        || control.is_some()
        || options.has("--wait")
        || options.has("--plan")
        || options.has("--dry-run"))
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
    let (_, attached) = match attached(&options) {
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
        client::control(
            &attached,
            "POST",
            "/control/run",
            json!({"source":source,"args":args_json,"as":"system","wait":options.has("--wait"),
                "mode":if options.has("--dry-run") { "dry-run" } else if options.has("--plan") { "plan" } else { "run" }}),
        )
    } else {
        let requested = positional[1];
        // The public manifest omits schedule-only system targets. The same route, with
        // the already-required loopback control credential, exposes the complete map
        // to the operator seat without creating a second registry.
        let manifest = match client::control(&attached, "GET", "/api/manifest", json!({})) {
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
                Refusal::unknown_operation(
                    requested,
                    ops.as_object()
                        .into_iter()
                        .flat_map(|o| o.keys().map(String::as_str)),
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
                json!({"name":name,"args":args_json,"as":"system","plan":options.has("--plan"),"dryRun":options.has("--dry-run")}),
            )
        } else if persona == "system" {
            client::control(
                &attached,
                "POST",
                "/control/execute",
                json!({"op":name,"args":args_json,"as":"system","dryRun":options.has("--dry-run")}),
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
            if r.body["id"].as_str().is_none() {
                return print_response(r.status, r.body, json_output);
            }
            wait(&attached, &r.body, json_output)
        }
        result => response(result, json_output),
    }
}
fn response(result: Result<client::HttpResponse, Refusal>, json_output: bool) -> ExitCode {
    match result {
        Ok(r) => {
            // A rehearsal that completed is exit 0 even when it reports refusals:
            // it succeeded at telling the truth about the run it did not make.
            if r.status < 400 && r.body["dryRun"] == true {
                return print_response(r.status, r.body, json_output);
            }
            // The owner compiled the file and found a usage error in what this verb built
            // from its flags: --plan/--wait on a non-job, or not exactly one declaration.
            if r.status >= 400
                && (r.body["code"] == "E_OP_KIND"
                    || (r.body["code"] == "E_INPUT" && r.body["site"] == "source"))
            {
                print_response(r.status, r.body, json_output);
                return ExitCode::from(2);
            }
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
        "operator/seat",
    )
    .with_site("run")
}
// @ref LLP 1016#d6--the-operator-seat-ad-hoc-programs-and-rehearsal — polling drains committed chunks; a parked job exits with its refusal.
fn wait(attached: &owner::OwnerInfo, initial: &Json, json_output: bool) -> ExitCode {
    let id = initial["id"].as_str().unwrap();
    let result = wait_receipt(
        initial,
        |after| {
            client::control(
                attached,
                "GET",
                &format!("/control/job/{id}?after={after}"),
                json!({}),
            )
        },
        |chunk, commit| {
            if json_output {
                println!("{}", json!({"job":id,"chunk":chunk,"commit":commit}));
            } else {
                println!(
                    "{id} chunk {chunk} · seq {} · {}",
                    commit["seq"], commit["writes"]
                );
            }
        },
        thread::sleep,
    )
    .map_err(|error| observation_recovery(error, attached, id));
    match result {
        Ok(r) if r.status < 400 && r.body["state"] == "cancelled" => {
            print_response(r.status, r.body, json_output);
            ExitCode::from(1)
        }
        result => response(result, json_output),
    }
}

// Only this observer retries. The enqueue POST above is never replayed.
fn wait_receipt(
    initial: &Json,
    mut poll: impl FnMut(u64) -> Result<client::HttpResponse, Refusal>,
    mut progress: impl FnMut(u64, &Json),
    mut pause: impl FnMut(Duration),
) -> Result<client::HttpResponse, Refusal> {
    let id = initial["id"].as_str().unwrap();
    let mut last_state = initial["state"].clone();
    let mut after = 0;
    let mut chunk = 0;
    let mut failures = 0;
    loop {
        let r = match poll(after) {
            Ok(r) if r.status < 400 => r,
            Err(e) if e.code == "E_OWNER_TRANSPORT" && failures < 3 => {
                pause(Duration::from_millis(100 << failures));
                failures += 1;
                continue;
            }
            Err(e) => return Err(observation_context(e, id, &last_state, after)),
            other => return other,
        };
        failures = 0;
        if let Err(error) = advance_page(&r.body, after) {
            return Err(observation_context(error, id, &last_state, after));
        }
        last_state = r.body["state"].clone();
        if let Some(commits) = r.body["commits"].as_array() {
            for commit in commits {
                after = commit["seq"].as_u64().unwrap_or(after);
                chunk += 1;
                progress(chunk, commit);
            }
        }
        if r.body["hasMoreCommits"] == true {
            pause(Duration::from_millis(20));
            continue;
        }
        match r.body["state"].as_str() {
            Some("done" | "parked" | "cancelled") => return Ok(r),
            _ => pause(Duration::from_millis(20)),
        }
    }
}

fn observation_context(error: Refusal, id: &str, state: &Json, after: u64) -> Refusal {
    error
        .with_detail("job", json!(id))
        .with_detail("lastObservedState", state.clone())
        .with_detail("lastObservedSeq", json!(after))
}

fn observation_recovery(mut error: Refusal, attached: &owner::OwnerInfo, id: &str) -> Refusal {
    let quote = |text: &str| format!("'{}'", text.replace('\'', "'\\''"));
    let project = quote(&attached.project.to_string_lossy());
    let trace = format!("snapback2 trace {} --project {project} --json", quote(id));
    error.rewrite = Some(if error.code == "E_OWNER_NOT_RUNNING" {
        format!(
            "run snapback2 dev --project {project}, then {trace}; observe this job without enqueueing it again"
        )
    } else {
        format!("retry {trace}; observation does not enqueue another job")
    });
    error.guide = "job".into();
    error
}

// Validate the whole page before printing it or advancing its cursor.
fn advance_page(page: &Json, mut after: u64) -> Result<(), Refusal> {
    let before = after;
    let invalid = || {
        Refusal::owner(
            "E_OWNER_PROTOCOL",
            "job commit page did not advance its sequence",
            "retry snapback2 trace <job_id>; observation does not enqueue another job",
        )
    };
    for commit in page["commits"].as_array().into_iter().flatten() {
        let seq = commit["seq"]
            .as_u64()
            .filter(|seq| *seq > after)
            .ok_or_else(invalid)?;
        after = seq;
    }
    if page["hasMoreCommits"] == true && after == before {
        return Err(invalid());
    }
    Ok(())
}

#[cfg(test)]
#[test]
fn job_commit_pages_require_strict_progress() {
    for page in [
        json!({"hasMoreCommits":true}),
        json!({"hasMoreCommits":true,"commits":[{"seq":4}]}),
        json!({"commits":[{"seq":"5"}]}),
        json!({"commits":[{"seq":6},{"seq":5}]}),
    ] {
        assert!(advance_page(&page, 4).is_err());
    }
    assert!(
        advance_page(
            &json!({"hasMoreCommits":true,"commits":[{"seq":5},{"seq":6}]}),
            4
        )
        .is_ok()
    );
    assert!(advance_page(&json!({"state":"done","commits":[]}), 4).is_ok());
}

#[cfg(test)]
mod wait_tests {
    use super::*;

    fn transient() -> Refusal {
        Refusal::new(
            "E_OWNER_TRANSPORT",
            "owner",
            "Resource temporarily unavailable",
            "inspect",
            "operator",
        )
    }

    fn page(state: &str, seq: u64) -> client::HttpResponse {
        client::HttpResponse {
            status: 200,
            body: json!({"id":"job_pressure", "state":state,
                "hasMoreCommits":state != "done", "commits":[{"seq":seq,"writes":1}]}),
        }
    }

    #[test]
    fn sustained_progress_with_transport_failures_keeps_the_observation_cursor() {
        let mut calls = 0;
        let mut printed = Vec::new();
        let mut delays = Vec::new();
        let result = wait_receipt(
            &json!({"id":"job_pressure","state":"queued"}),
            |after| {
                calls += 1;
                // One pressure failure between every committed page. Successful
                // pages reset the retry budget; failed polls must keep their cursor.
                assert_eq!(after, (calls / 2) as u64);
                if calls % 2 == 0 {
                    return Err(transient());
                }
                let seq = (calls / 2 + 1) as u64;
                Ok(page(if seq == 128 { "done" } else { "running" }, seq))
            },
            |chunk, commit| printed.push((chunk, commit["seq"].as_u64().unwrap())),
            |delay| delays.push(delay),
        )
        .unwrap();
        assert_eq!(result.body["state"], "done");
        assert_eq!(calls, 255);
        assert_eq!(printed, (1..=128).map(|seq| (seq, seq)).collect::<Vec<_>>());
        assert_eq!(delays.len(), 254);
        assert_eq!(
            delays
                .iter()
                .filter(|d| **d == Duration::from_millis(20))
                .count(),
            127
        );
        assert_eq!(
            delays
                .iter()
                .filter(|d| **d == Duration::from_millis(100))
                .count(),
            127
        );
    }

    #[test]
    fn exhausted_observation_preserves_job_and_status_even_before_the_first_page() {
        for reached_page in [false, true] {
            let mut calls = 0;
            let mut delays = Vec::new();
            let error = wait_receipt(
                &json!({"id":"job_pressure","state":"queued"}),
                |after| {
                    calls += 1;
                    if reached_page && calls == 1 {
                        return Ok(page("running", 42));
                    }
                    assert_eq!(after, if reached_page { 42 } else { 0 });
                    Err(transient())
                },
                |_, _| {},
                |delay| delays.push(delay),
            )
            .unwrap_err();
            assert_eq!(calls, if reached_page { 5 } else { 4 });
            assert_eq!(error.code, "E_OWNER_TRANSPORT");
            assert_eq!(error.detail["job"], "job_pressure");
            assert_eq!(
                error.detail["lastObservedState"],
                if reached_page { "running" } else { "queued" }
            );
            assert_eq!(
                error.detail["lastObservedSeq"],
                if reached_page { 42 } else { 0 }
            );
            assert!(delays.ends_with(&[100, 200, 400].map(Duration::from_millis)));
        }
    }

    #[test]
    fn stopped_owner_and_malformed_pages_stop_with_observation_only_recovery() {
        let attached = owner::OwnerInfo {
            pid: std::process::id(),
            port: 1234,
            url: String::new(),
            secret: String::new(),
            generation: String::new(),
            started_at: 0,
            mode: "dev".into(),
            project: "/tmp/job wait's project".into(),
        };
        for code in [
            "E_OWNER_NOT_RUNNING",
            "E_OWNER_PROTOCOL",
            "E_OWNER_TRANSPORT",
        ] {
            let error = observation_recovery(
                Refusal::owner(code, "lost observation", "restart and rerun"),
                &attached,
                "job_pressure",
            );
            let rewrite = error.rewrite.unwrap();
            assert!(
                rewrite.contains(
                    "snapback2 trace 'job_pressure' --project '/tmp/job wait'\\''s project' --json"
                ),
                "{rewrite}"
            );
            assert_eq!(
                rewrite.contains("snapback2 dev"),
                code == "E_OWNER_NOT_RUNNING"
            );
            assert!(!rewrite.contains("snapback2 run"));
            assert_eq!(error.guide, "job");
        }
        for malformed in [false, true] {
            let error = wait_receipt(
                &json!({"id":"job_pressure","state":"queued"}),
                |_| {
                    if malformed {
                        Ok(client::HttpResponse {
                            status: 200,
                            body: json!({"state":"running","hasMoreCommits":true,"commits":[]}),
                        })
                    } else {
                        Err(Refusal::owner(
                            "E_OWNER_NOT_RUNNING",
                            "connection refused",
                            "run snapback2 dev",
                        ))
                    }
                },
                |_, _| panic!("no valid progress"),
                |_| panic!("definite refusal/protocol failure must not retry"),
            )
            .unwrap_err();
            assert_eq!(error.detail["job"], "job_pressure");
            assert_eq!(error.detail["lastObservedState"], "queued");
        }
    }
}
