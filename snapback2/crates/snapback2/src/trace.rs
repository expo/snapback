//! Causal commit tracing through the owner control plane.
// @ref LLP 1002#8-why-trace-guide — trace joins intent, commit, outbox, invalidation, and delivery.

use crate::client;
use crate::owner;
use crate::project::locate_root;
use crate::verbs;
use serde_json::{Map, Value as Json, json};
use std::path::Path;
use std::process::ExitCode;

pub fn run(args: &[String]) -> ExitCode {
    let options = match verbs::parse_options(args, &["--project"], &["--json"]) {
        Ok(options) => options,
        Err(code) => return code,
    };
    let json_output = options.has("--json");
    let positional = options.positionals();
    if positional.len() != 2 {
        return usage();
    }
    let timer = positional[1].strip_prefix("timer:");
    let job = positional[1].starts_with("job_");
    let seq = if positional[1] == "latest" || job || timer.is_some() {
        None
    } else {
        match positional[1].parse::<u64>() {
            Ok(seq) => Some(seq),
            Err(_) => return usage(),
        }
    };
    let root = match locate_root(options.value("--project").map(Path::new)) {
        Ok(root) => root,
        Err(error) => return owner::print_refusal(error, json_output, 2),
    };
    let attached = match owner::require_owner(&root) {
        Ok(owner) => owner,
        Err(error) => return owner::print_refusal(error, json_output, 1),
    };
    let path = if let Some(id) = timer {
        // Timer ids are `t_<digest>`; anything else is not a timer id.
        if id.is_empty()
            || !id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return usage();
        }
        format!("/control/trace?timer={id}")
    } else if job {
        format!("/control/job/{}", positional[1])
    } else {
        seq.map(|seq| format!("/control/trace?seq={seq}"))
            .unwrap_or_else(|| "/control/trace".to_owned())
    };
    let trace = match client::control(&attached, "GET", &path, json!({})) {
        Ok(response) if response.status < 400 => response.body,
        Ok(response) => {
            println!("{}", response.body);
            return ExitCode::from(1);
        }
        Err(error) => return owner::print_refusal(error, json_output, 1),
    };
    let output = if job || timer.is_some() {
        trace
    } else {
        enrich(trace)
    };
    if json_output {
        println!("{}", serde_json::to_string(&output).unwrap_or_default());
    } else {
        println!(
            "{}",
            serde_json::to_string_pretty(&output).unwrap_or_default()
        );
    }
    ExitCode::SUCCESS
}

fn enrich(trace: Json) -> Json {
    // Rejected operator traces are the retained envelope, not enriched commit traces.
    if trace["kind"] == "operator" && trace["result"]["state"] == "rejected" {
        return trace;
    }
    let commit = trace.get("commit").cloned().unwrap_or(Json::Null);
    let program = commit
        .get("program")
        .and_then(Json::as_str)
        .unwrap_or_default();
    let outbox_rows = trace
        .get("outboxRows")
        .and_then(Json::as_array)
        .cloned()
        .unwrap_or_default();
    let mut output = Map::new();
    output.insert("intent".to_owned(), Json::String(program.to_owned()));
    output.insert("commit".to_owned(), commit);
    output.insert("outboxRows".to_owned(), Json::Array(outbox_rows));
    if let Some(ledger) = trace.get("ledger") {
        output.insert("ledger".to_owned(), ledger.clone());
    } else {
        output.insert(
            "invalidated".to_owned(),
            trace
                .get("invalidated")
                .cloned()
                .unwrap_or_else(|| Json::Array(Vec::new())),
        );
        output.insert(
            "deliveries".to_owned(),
            trace
                .get("deliveries")
                .cloned()
                .unwrap_or_else(|| Json::Array(Vec::new())),
        );
    }
    Json::Object(output)
}

fn usage() -> ExitCode {
    eprintln!("usage: snapback2 trace <seq|latest|job_id|timer:id> [--json]");
    ExitCode::from(2)
}
