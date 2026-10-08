//! Development doors beside the operation routes: `POST /seed`, and the
//! `--no-watch` hint that names a schema edited on disk after adoption.
use super::{Shared, lock, refusal_json, respond_timed};
use crate::project::{Project, SourceStamp};
use serde_json::{Value as Json, json};
use snapback4_core::error::Refusal;
use snapback4_core::wire;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tiny_http::Request;

/// The source stamp each `--no-watch` dev host adopted, by project root.
static PINNED: Mutex<BTreeMap<PathBuf, SourceStamp>> = Mutex::new(BTreeMap::new());

pub(super) fn pin(project: &Path, stamp: SourceStamp) {
    PINNED.lock().unwrap_or_else(|e| e.into_inner()).insert(project.to_owned(), stamp);
}

/// A `--no-watch` host serves the schema it started with. When a request
/// names an operation or argument that host does not know and the `.q` files
/// changed on disk since, say so: the edit is real, it was just never adopted.
pub(super) fn stale(shared: &Shared, refusal: Refusal) -> Refusal {
    let Some(adopted) = PINNED.lock().unwrap_or_else(|e| e.into_inner()).get(&shared.project).copied() else { return refusal };
    if (Project { root: shared.project.clone() }).sources_stamp() == adopted { return refusal; }
    let message = format!("{}; this dev host runs with --no-watch and snapback/ changed on disk after it adopted its schema, so the edit is not served", refusal.message);
    Refusal { message, rewrite: Some("restart `snapback4 dev` (or drop --no-watch so saves re-adopt), then retry".into()), ..refusal }
}

// Rows are written as the system principal; each names its id because seed is an upsert by id.
pub(super) fn seed(request: Request, shared: &Shared, body: &str) {
    if !shared.personas || !request.remote_addr().is_some_and(|a| a.ip().is_loopback()) {
        respond_timed(request, shared, 403, json!({ "denied": refusal_json(&Refusal::new("E_AUTH", "auth", "seeding is a development door")) }));
        return;
    }
    let refuse = |request, refusal: Refusal| respond_timed(request, shared, 400, json!({ "denied": refusal_json(&refusal.guide("personas")) }));
    let rows: Vec<Json> = match serde_json::from_str(body) {
        Ok(Json::Array(rows)) => rows,
        _ => return refuse(request, Refusal::new("E_INPUT", "input", "seed takes a JSON array of {table, row}")),
    };
    let schema = lock(&shared.bound).schema.clone();
    let mut typed = Vec::new();
    for (index, entry) in rows.iter().enumerate() {
        let (Some(table), Some(row)) = (entry.get("table").and_then(Json::as_str), entry.get("row")) else {
            return refuse(request, Refusal::new("E_INPUT", "input", "each seed entry is {table, row}"));
        };
        let Some(definition) = schema.table(table) else {
            return refuse(request, Refusal::new("E_INPUT", "input", format!("unknown table {table}")));
        };
        if row.is_object() && row.get("id").is_none_or(|id| !id.is_string()) {
            return refuse(request, missing_id(index, table));
        }
        match wire::row_from_json(definition, row) {
            Ok(value) => typed.push((table.to_owned(), value)),
            Err(why) => return refuse(request, Refusal::new("E_INPUT", "input", format!("{table}: {why}"))),
        }
    }
    let outcome = lock(&shared.engine).seed_at(typed, shared.now());
    match outcome {
        Ok(count) => {
            shared.durable_committed(&lock(&shared.engine));
            respond_timed(request, shared, 200, json!({ "seeded": count }));
        }
        Err(error) => respond_timed(request, shared, 200, json!({ "denied": refusal_json(&error.refusal()) })),
    }
}

fn missing_id(index: usize, table: &str) -> Refusal {
    Refusal::new("E_FIELD", "input", format!(
        "missing field id: seed row {index} ({table}) has no string id. /seed is an upsert by id, so every row names its own; \
         rerunning the same seed then updates those rows instead of duplicating them"))
        .rewrite("give each row a 26-character id in Crockford base32 (digits and capital letters except I, L, O, U), \
                  e.g. \"row\": {\"id\": \"0000000000000000000000SEED\", ..}; in JavaScript `idFrom(\"seed:alice\")` from \
                  snapback4/client derives the same valid id from a label every time, and a reference column takes that id")
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_missing_id_example_is_a_valid_id() {
        let refusal = super::missing_id(0, "notes");
        let rewrite = refusal.rewrite.unwrap();
        let example = rewrite.split("\"id\": \"").nth(1).unwrap().split('"').next().unwrap();
        assert_eq!(example.len(), 26, "{example}");
        assert!(snapback4_core::ids::minted_at(example).is_some(), "{example} is Crockford base32");
        assert!(refusal.message.starts_with("missing field id"), "{}", refusal.message);
    }
}
