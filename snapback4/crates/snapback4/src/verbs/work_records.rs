//! Operator inspection, never an application result-collection endpoint.
use super::*;
use snapback4_core::{inspection::WorkRecordKind, store::inspect::Inspection};
use snapback4_core::store::{canonical_payload, payload_digest};

pub(super) fn store_path(options: &Options) -> std::path::PathBuf {
    options.flags.get("release").map(|dir| Path::new(dir).join("store.sqlite"))
        .unwrap_or_else(|| project_or_exit().store_path())
}

pub(super) fn project(options: &Options) -> Result<Project, String> {
    let Some(dir) = options.flags.get("release") else { return Ok(project_or_exit()); };
    let conn = Inspection::open(&store_path(options)).map_err(|(_, e)| e)?;
    let release: String = conn.required_release().map_err(|(_, e)| e)?;
    Ok(Project { root: Path::new(dir).join("releases").join(release) })
}


fn plain(record: &Json, key: &str, tagged: bool) -> Option<Json> {
    let text = record[key].as_str()?;
    if tagged {
        serde_json::from_str::<snapback4_core::Value>(text).ok().map(|value| wire::to_json(&value))
    } else { serde_json::from_str(text).ok() }
}

fn describe_payload(label: &str, value: Option<Json>, values: bool) {
    match value {
        Some(value) => {
            println!("  {label}: {} bytes, sha256 {}", canonical_payload(&value).len(), payload_digest(&value));
            if values { println!("  {label} value: {}", canonical_payload(&value)); }
        }
        None => println!("  {label}: not recorded"),
    }
}

fn show(value: &Json) -> String {
    if value.is_null() { "not recorded".into() } else { value.to_string() }
}

// @ref LLP 3000.009#9-one-release-evolution-and-recovery — correlation reveals metadata, with payloads opt-in.
pub(super) fn explain(options: &Options, id: &str) -> Result<bool, String> {
    let path = store_path(options);
    if !path.is_file() { return Ok(false); }
    let conn = Inspection::open(&path).map_err(|(_, e)| e)?;
    conn.begin_snapshot().map_err(|(_, e)| e)?;
    let values = options.flags.contains_key("values");
    let mut found = false;
    for (record_kind, kind) in [(WorkRecordKind::Action, "action"), (WorkRecordKind::Mutation, "mutation"), (WorkRecordKind::Effect, "effect")] {
        for record in conn.work_records(record_kind, id)? {
            found = true;
            let commit: Option<(String, String, i64)> = if kind != "action" && !record["seq"].is_null() {
                conn.work_commit(record["seq"].as_i64())?
            } else { None };
            let receipt = plain(&record, "outcome", false).unwrap_or(Json::Null);
            let operation = if kind == "effect" { record["effect"].clone() } else if !record["name"].is_null() { record["name"].clone() }
                else if kind == "mutation" && receipt["state"] == "sent" { commit.as_ref().map(|c| json!(c.0)).unwrap_or(Json::Null) } else { Json::Null };
            let principal = if kind == "effect" { commit.as_ref().map(|c| json!(c.1)).unwrap_or(Json::Null) } else { record["principal"].clone() };
            let at = if !record["at"].is_null() { record["at"].clone() } else if kind == "mutation" && receipt["state"] == "sent" { commit.as_ref().map(|c| json!(c.2)).unwrap_or(Json::Null) } else { Json::Null };
            println!("{kind} {id}");
            println!("  operation: {}\n  principal: {}\n  admitted at: {}", show(&operation), show(&principal), show(&at));
            if let Some(family) = record["family"].as_str() {
                println!("  binding: family {}, generation {}, admitted expiry {}", family.chars().take(12).collect::<String>(), show(&record["principal_generation"]), show(&record["admitted_expires_at"]));
            } else { println!("  binding: not recorded"); }
            let state = if kind == "mutation" { &receipt["state"] } else { &record["state"] };
            let attempts = if kind == "mutation" { json!(1) } else { record["attempts"].clone() };
            println!("  state: {}\n  attempts: {}\n  lease until: {}\n  claimed by: {}", show(state), show(&attempts), show(&record["lease_until"]), show(&record["claimed_by"]));
            let error = if kind == "mutation" { &receipt["why"] } else { &record["error"] };
            println!("  last error: {}\n  error code: {}", show(error), show(&record["error_code"]));
            println!("  settled at: {}", show(if kind == "mutation" { &at } else { &record["settled_at"] }));
            if kind != "mutation" {
                println!("  release: {}\n  deadline: {}\n  cancelled: {}", show(&record["release"]), show(&record["deadline"]), show(&record["cancelled"]));
            }
            if kind != "action" { println!("  commit sequence: {}", if kind == "mutation" && receipt["state"] != "sent" { "none (refused)".into() } else { show(&record["seq"]) }); }
            let args = match kind {
                "action" => record["args"].as_str().and_then(|s| serde_json::from_str::<BTreeMap<String, snapback4_core::Value>>(s).ok()).map(|args| Json::Object(wire::map_to_json(&args))),
                "effect" => plain(&record, "payload", true),
                _ => None,
            };
            describe_payload("arguments", args, values);
            describe_payload("result", if kind == "mutation" { None } else { plain(&record, "result", kind == "effect") }, values);
            if kind == "action" {
                println!("  contract: {}", show(&record["contract"]));
                for step in conn.work_records(WorkRecordKind::ActionStep, id)? {
                    println!("  step {}: {}\n    input digest: {}\n    provider key: {}\n    admitted at: {}\n    settled at: {}", show(&step["name"]), show(&step["state"]), show(&step["input_digest"]), show(&step["provider_key"]), show(&step["at"]), show(&step["settled_at"]));
                    describe_payload("step result", plain(&step, "result", false), values);
                }
            }
        }
    }
    Ok(found)
}

/// Keep successfully settled attempts visible even when they requeued for retry.
pub(super) fn handler_failures(store: &snapback4_core::Store) -> Result<Vec<String>, String> {
    Ok(store.handler_failure_records()?.into_iter().map(|r| format!("{}    {} {} {} after {} attempt(s): {}", r.kind, r.name, r.id, r.state, r.attempts, serde_json::to_string(&r.error).unwrap_or_default())).collect())
}
