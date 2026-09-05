//! Human and JSON explanations for one authoritative query execution.
// @ref LLP 1002#8-why-trace-guide — explanations join row verdicts, rule inputs, and certified reads.

use crate::client;
use crate::owner;
use crate::project::locate_root;
use crate::protocol::Refusal;
use crate::verbs;
use serde_json::{Map, Value as Json, json};
use snapback2_core::Certificate;
use std::collections::BTreeMap;
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
    let mut certificate = match read_certificate(&root, &positional[1]) {
        Ok(certificate) => certificate,
        Err(error) => return owner::print_refusal(error, json_output, 1),
    };
    let response = match client::control(
        &attached,
        "POST",
        "/control/why",
        json!({ "op": positional[1], "args": arguments, "as": persona, "queryOnly": true }),
    ) {
        Ok(response) if response.status < 400 => response.body,
        Ok(response) => {
            println!("{}", response.body);
            return ExitCode::from(1);
        }
        Err(error) => return owner::print_refusal(error, json_output, 1),
    };
    let Some(active_plan_hash) = response.get("certificatePlanHash").and_then(Json::as_str) else {
        return owner::print_refusal(
            why_stale("the owner did not identify the active operation certificate"),
            json_output,
            1,
        );
    };
    if certificate.plan_hash != active_plan_hash {
        certificate = match read_certificate(&root, &positional[1]) {
            Ok(certificate) => certificate,
            Err(error) => return owner::print_refusal(error, json_output, 1),
        };
        if certificate.plan_hash != active_plan_hash {
            return owner::print_refusal(
                why_stale(format!(
                    "the cached certificate for {} does not match the active owner operation",
                    positional[1]
                )),
                json_output,
                1,
            );
        }
    }
    let latest = client::control(&attached, "GET", "/control/trace", json!({}))
        .ok()
        .map(|response| response.body)
        .unwrap_or_else(|| json!({}));
    let output = enrich(&positional[1], response, latest, certificate);
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

fn read_certificate(root: &Path, op: &str) -> Result<Certificate, Refusal> {
    let path = root.join(".snapback/build/certificates.json");
    let bytes = fs::read(&path)
        .map_err(|error| why_stale(format!("cannot read {}: {error}", path.display())))?;
    let certificates: BTreeMap<String, Certificate> = serde_json::from_slice(&bytes)
        .map_err(|error| why_stale(format!("cannot parse {}: {error}", path.display())))?;
    certificates
        .get(op)
        .cloned()
        .ok_or_else(|| why_stale(format!("certificates.json is missing operation {op}")))
}

fn why_stale(message: impl Into<String>) -> Refusal {
    Refusal::owner("E_WHY_STALE", message, "run snapback2 check")
}

fn enrich(op: &str, response: Json, latest: Json, certificate: Certificate) -> Json {
    let system = response.get("principal").and_then(Json::as_str) == Some("system");
    let trace = response.get("trace").cloned().unwrap_or_else(|| json!({}));
    let mut verdicts = Vec::new();
    if let Some(ranges) = trace.get("ranges").and_then(Json::as_array) {
        for range in ranges {
            let visible = string_array(range, "visible_ids", "visibleIds");
            let returned = string_array(range, "returned_ids", "returnedIds");
            for id in string_array(range, "examined_ids", "examinedIds") {
                let admitted = visible.iter().any(|visible| visible == &id);
                verdicts.push(json!({
                    "row": id,
                    "site": range.get("site"),
                    "table": range.get("table"),
                    "verdict": if system { "system-visible" } else if admitted { "allow" } else { "deny" },
                    "cut": admitted && !returned.iter().any(|returned| returned == &id),
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
                    "verdict": if system { "system-visible" } else if point.get("visible").and_then(Json::as_bool).unwrap_or(false) { "allow" } else { "deny" },
                    "cut": false,
                }));
            }
        }
    }
    // @ref LLP 1002#8-why-trace-guide — denied-read details stay in local owner diagnostics.
    // In particular, never attach this existence-sensitive hint to execution_json.
    let diagnostics = verdicts
        .iter()
        .filter(|verdict| verdict["verdict"] == "deny")
        .map(|verdict| {
            let site = verdict["site"].clone();
            let diagnostic = json!({
                "code": "E_RULE",
                "family": "rule",
                "site": site,
                "table": verdict["table"],
                "message": "The table read rule denied this lookup. Reads inside mutations use the same viewer authority; write permission does not grant read permission.",
                "rewrite": "Inspect the table read rule for this persona. For group administration, admit the intended scoped roster audience and keep admin checks on writes; run snapback2 guide auth.",
                "guide": "auth",
            });
            (site.to_string(), diagnostic)
        })
        .collect::<BTreeMap<_, _>>()
        .into_values()
        .collect::<Vec<_>>();
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
    if system {
        output.insert("principal".to_owned(), json!("system"));
    }
    output.insert("op".to_owned(), Json::String(op.to_owned()));
    output.insert(
        "result".to_owned(),
        response.get("result").cloned().unwrap_or(Json::Null),
    );
    output.insert("rowVerdicts".to_owned(), Json::Array(verdicts));
    output.insert("diagnostics".to_owned(), Json::Array(diagnostics));
    output.insert(
        "ruleInputs".to_owned(),
        trace
            .get("rule_inputs")
            .or_else(|| trace.get("ruleInputs"))
            .cloned()
            .unwrap_or_else(|| json!([])),
    );
    output.insert("readSites".to_owned(), json!(certificate.read_sites));
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
