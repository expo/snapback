//! Causal commit tracing through the owner control plane.
// @ref LLP 1002#8-why-trace-guide — trace joins intent, commit, outbox, invalidation, and delivery.

use crate::client;
use crate::owner;
use crate::project::locate_root;
use crate::verbs;
use serde_json::{Map, Value as Json, json};
use snapback2_core::{Program, ProjectJson, Stmt};
use std::fs;
use std::path::Path;
use std::process::ExitCode;

pub fn run(args: &[String]) -> ExitCode {
    let json_output = verbs::has(args, "--json");
    let positional = positionals(args);
    if positional.len() != 2 {
        return usage();
    }
    let seq = if positional[1] == "latest" {
        None
    } else {
        match positional[1].parse::<u64>() {
            Ok(seq) => Some(seq),
            Err(_) => return usage(),
        }
    };
    let root = match locate_root(verbs::flag(args, "--project").map(Path::new)) {
        Ok(root) => root,
        Err(error) => return owner::print_refusal(error, json_output, 2),
    };
    let attached = match owner::require_owner(&root) {
        Ok(owner) => owner,
        Err(error) => return owner::print_refusal(error, json_output, 1),
    };
    let path = seq
        .map(|seq| format!("/control/trace?seq={seq}"))
        .unwrap_or_else(|| "/control/trace".to_owned());
    let trace = match client::control(&attached, "GET", &path, json!({})) {
        Ok(response) if response.status < 400 => response.body,
        Ok(response) => {
            println!("{}", response.body);
            return ExitCode::from(1);
        }
        Err(error) => return owner::print_refusal(error, json_output, 1),
    };
    let subscriptions = client::control(&attached, "GET", "/control/subscriptions", json!({}))
        .ok()
        .map(|response| response.body)
        .unwrap_or_else(|| json!([]));
    let status = client::control(&attached, "GET", "/control/status", json!({}))
        .ok()
        .map(|response| response.body)
        .unwrap_or_else(|| json!({}));
    let output = enrich(&root, trace, subscriptions, status);
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

fn enrich(root: &Path, trace: Json, subscriptions: Json, status: Json) -> Json {
    let commit = trace.get("commit").cloned().unwrap_or(Json::Null);
    let seq = commit.get("seq").and_then(Json::as_u64).unwrap_or(0);
    let program = commit
        .get("program")
        .and_then(Json::as_str)
        .unwrap_or_default();
    let emit_count = commit.get("emits").and_then(Json::as_u64).unwrap_or(0);
    let effects = emitted_effects(root, program);
    let engine = status
        .get("effects")
        .and_then(|effects| effects.get("engine"))
        .and_then(Json::as_str)
        .unwrap_or("none");
    let mut outbox_rows = Vec::new();
    for index in 0..emit_count {
        outbox_rows.push(json!({
            "seq": seq,
            "ordinal": index,
            "effect": effects.get(index as usize).cloned().unwrap_or_else(|| "<unknown>".to_owned()),
            "state": if engine == "none" { "queued" } else { "runner-owned" },
        }));
    }
    let invalidated = trace
        .get("invalidated")
        .and_then(Json::as_array)
        .cloned()
        .unwrap_or_default();
    let known = subscriptions.as_array().cloned().unwrap_or_default();
    let deliveries = invalidated
        .iter()
        .filter_map(Json::as_u64)
        .map(|id| {
            let subscription = known
                .iter()
                .find(|subscription| subscription.get("id").and_then(Json::as_u64) == Some(id));
            json!({
                "subscriptionId": id,
                "deliverySeq": subscription.and_then(|subscription| subscription.get("lastSeq").or_else(|| subscription.get("last_seq"))).cloned().unwrap_or(Json::Null),
            })
        })
        .collect::<Vec<_>>();
    let mut output = Map::new();
    output.insert("intent".to_owned(), Json::String(program.to_owned()));
    output.insert("commit".to_owned(), commit);
    output.insert("outboxRows".to_owned(), Json::Array(outbox_rows));
    output.insert("invalidated".to_owned(), Json::Array(invalidated));
    output.insert("deliveries".to_owned(), Json::Array(deliveries));
    Json::Object(output)
}

fn emitted_effects(root: &Path, program_name: &str) -> Vec<String> {
    let project = fs::read(root.join(".snapback/build/project.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ProjectJson>(&bytes).ok());
    let Some(project) = project else {
        return Vec::new();
    };
    let Some(program) = project
        .programs
        .iter()
        .find(|program| program.name == program_name)
    else {
        return Vec::new();
    };
    let mut effects = Vec::new();
    collect_emits(program, &mut effects);
    effects
}

fn collect_emits(program: &Program, output: &mut Vec<String>) {
    collect_statements(&program.body, output);
}

fn collect_statements(statements: &[Stmt], output: &mut Vec<String>) {
    for statement in statements {
        match statement {
            Stmt::Emit { effect, .. } => output.push(effect.clone()),
            Stmt::If {
                then_body,
                else_body,
                ..
            } => {
                collect_statements(then_body, output);
                collect_statements(else_body, output);
            }
            Stmt::For { body, .. } => collect_statements(body, output),
            _ => {}
        }
    }
}

fn positionals(args: &[String]) -> Vec<String> {
    let mut output = Vec::new();
    let mut skip = false;
    for arg in args {
        if skip {
            skip = false;
        } else if arg == "--project" {
            skip = true;
        } else if !arg.starts_with("--") {
            output.push(arg.clone());
        }
    }
    output
}

fn usage() -> ExitCode {
    eprintln!("usage: snapback2 trace <seq|latest> [--json]");
    ExitCode::from(2)
}
