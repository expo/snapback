//! Human and JSON explanations for one authoritative query execution.
// @ref LLP 1002#8-why-trace-guide — explanations join row verdicts, rule inputs, and certified reads.

use crate::client;
use crate::owner;
use crate::project::locate_root;
use crate::protocol::Refusal;
use crate::verbs;
use serde_json::{Map, Value as Json, json};
use std::fs;
use std::path::Path;
use std::process::ExitCode;

pub fn run(args: &[String]) -> ExitCode {
    let options = match verbs::parse_options(args, &["--as", "--project"], &["--json"]) {
        Ok(options) => options,
        Err(code) => return code,
    };
    let json_output = options.has("--json");
    let positional = options.positionals();
    if positional.len() < 2 || positional.len() > 3 {
        return usage();
    }
    let persona = match options.value("--as") {
        Some(persona) => persona,
        None => return usage(),
    };
    let arguments = match positional.get(2) {
        Some(value) => match serde_json::from_str(value) {
            Ok(value) => value,
            Err(error) => {
                return owner::print_refusal(
                    Refusal::input(
                        format!("invalid args JSON: {error}"),
                        "pass a JSON object such as '{}'",
                    ),
                    json_output,
                    2,
                );
            }
        },
        None => json!({}),
    };
    let root = match locate_root(options.value("--project").map(Path::new)) {
        Ok(root) => root,
        Err(error) => return owner::print_refusal(error, json_output, 2),
    };
    let attached = match owner::require_owner(&root) {
        Ok(owner) => owner,
        Err(error) => return owner::print_refusal(error, json_output, 1),
    };
    let response = match client::control(
        &attached,
        "POST",
        "/control/why",
        json!({ "op": positional[1], "args": arguments, "as": persona }),
    ) {
        Ok(response) if response.status < 400 => response.body,
        Ok(response) => {
            println!("{}", response.body);
            return ExitCode::from(1);
        }
        Err(error) => return owner::print_refusal(error, json_output, 1),
    };
    let latest = client::control(&attached, "GET", "/control/trace", json!({}))
        .ok()
        .map(|response| response.body)
        .unwrap_or_else(|| json!({}));
    let output = enrich(&root, &positional[1], response, latest);
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

fn enrich(root: &Path, op: &str, response: Json, latest: Json) -> Json {
    let trace = response.get("trace").cloned().unwrap_or_else(|| json!({}));
    let mut verdicts = Vec::new();
    if let Some(ranges) = trace.get("ranges").and_then(Json::as_array) {
        for range in ranges {
            let visible = string_array(range, "visible_ids", "visibleIds");
            for id in string_array(range, "examined_ids", "examinedIds") {
                verdicts.push(json!({
                    "row": id,
                    "site": range.get("site"),
                    "table": range.get("table"),
                    "verdict": if visible.iter().any(|visible| visible == &id) { "allow" } else { "deny" },
                }));
            }
        }
    }
    if let Some(points) = trace.get("points").and_then(Json::as_array) {
        for point in points {
            if point
                .get("examined")
                .and_then(Json::as_bool)
                .unwrap_or(false)
            {
                verdicts.push(json!({
                    "key": point.get("key"),
                    "site": point.get("site"),
                    "table": point.get("table"),
                    "verdict": if point.get("visible").and_then(Json::as_bool).unwrap_or(false) { "allow" } else { "deny" },
                }));
            }
        }
    }
    let certificate = fs::read(root.join(".snapback/build/certificates.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Json>(&bytes).ok())
        .and_then(|value| value.get(op).cloned())
        .unwrap_or(Json::Null);
    let invalidated = latest
        .get("invalidated")
        .and_then(Json::as_array)
        .cloned()
        .unwrap_or_default();
    let subscriptions = response
        .get("subscriptions")
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
        .map(|subscription| {
            let id = subscription.get("id").and_then(Json::as_u64);
            json!({
                "id": id,
                "principal": subscription.get("principal"),
                "lastDeliverySeq": subscription.get("lastSeq").or_else(|| subscription.get("last_seq")),
                "latestTouched": id.is_some_and(|id| invalidated.iter().any(|value| value.as_u64() == Some(id))),
            })
        })
        .collect::<Vec<_>>();
    let mut output = Map::new();
    output.insert("op".to_owned(), Json::String(op.to_owned()));
    output.insert(
        "result".to_owned(),
        response.get("result").cloned().unwrap_or(Json::Null),
    );
    output.insert("rowVerdicts".to_owned(), Json::Array(verdicts));
    output.insert(
        "ruleInputs".to_owned(),
        trace
            .get("rule_inputs")
            .or_else(|| trace.get("ruleInputs"))
            .cloned()
            .unwrap_or_else(|| json!([])),
    );
    output.insert(
        "readSites".to_owned(),
        certificate
            .get("read_sites")
            .or_else(|| certificate.get("readSites"))
            .cloned()
            .unwrap_or_else(|| json!([])),
    );
    output.insert("authoritativeTrace".to_owned(), trace);
    output.insert("subscriptions".to_owned(), Json::Array(subscriptions));
    Json::Object(output)
}

fn string_array(value: &Json, snake: &str, camel: &str) -> Vec<String> {
    value
        .get(snake)
        .or_else(|| value.get(camel))
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
        .filter_map(Json::as_str)
        .map(ToOwned::to_owned)
        .collect()
}

fn usage() -> ExitCode {
    eprintln!("usage: snapback2 why <query> [args-json] --as <persona> [--json]");
    ExitCode::from(2)
}
