//! Development doors beside the operation routes: `POST /seed`, `POST /dev/reset`, and the
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
    let typed = match typed_rows(shared, &rows) {
        Ok(typed) => typed,
        Err(refusal) => return refuse(request, refusal),
    };
    let outcome = lock(&shared.engine).seed_at(typed, shared.now());
    match outcome {
        Ok(count) => {
            shared.durable_committed(&lock(&shared.engine));
            respond_timed(request, shared, 200, json!({ "seeded": count }));
        }
        Err(error) => respond_timed(request, shared, 200, json!({ "denied": refusal_json(&seed_refusal(error)) })),
    }
}

/// `/seed` rows checked against the served schema and typed, or the first problem.
fn typed_rows(shared: &Shared, rows: &[Json]) -> Result<Vec<(String, snapback4_core::Value)>, Refusal> {
    let schema = lock(&shared.bound).schema.clone();
    let mut typed = Vec::new();
    for (index, entry) in rows.iter().enumerate() {
        let (Some(table), Some(row)) = (entry.get("table").and_then(Json::as_str), entry.get("row")) else {
            return Err(Refusal::new("E_INPUT", "input", "each seed entry is {table, row}"));
        };
        let Some(definition) = schema.table(table) else {
            return Err(Refusal::new("E_INPUT", "input", format!("unknown table {table}")));
        };
        if row.is_object() && row.get("id").is_none_or(|id| !id.is_string()) {
            return Err(missing_id(index, table));
        }
        if let Some(why) = wire::bare_principal(definition, row) {
            return Err(Refusal::new("E_INPUT", "input", format!("seed row {index} ({table}): {why}")));
        }
        match wire::row_from_json(definition, row) {
            Ok(value) => typed.push((table.to_owned(), value)),
            Err(why) => return Err(Refusal::new("E_INPUT", "input", format!("{table}: {why}"))),
        }
    }
    Ok(typed)
}

fn seed_refusal(error: snapback4_core::RuntimeError) -> Refusal {
    let mut refusal = error.refusal();
    // Reseeding with changed immutable values reads like a rule problem; say what happened.
    if refusal.code == "E_CONSTRAINT" && refusal.message.ends_with(" is immutable") {
        refusal.message.push_str("; /seed is an upsert by id, and a row with that id already exists with a different value in that column. Reseed it with its original value, give the row a new id, POST /dev/reset first, or restart dev with --memory for an empty store");
    }
    refusal
}

/// What `POST /dev/reset` was asked to do: the body is empty, a `/seed`
/// array, or `{"seed": [..], "clock": "reset"}` with either key optional.
#[derive(Debug, Default, PartialEq)]
struct ResetRequest { seed: Vec<Json>, clock: bool }

fn reset_request(body: &str) -> Result<ResetRequest, Refusal> {
    const SHAPE: &str = "reset takes no body, a /seed array [{table, row}, ..], or {\"seed\": [..], \"clock\": \"reset\"} with either key optional";
    if body.trim().is_empty() { return Ok(ResetRequest::default()); }
    match serde_json::from_str(body) {
        Ok(Json::Array(seed)) => Ok(ResetRequest { seed, clock: false }),
        Ok(Json::Object(fields)) => {
            let mut request = ResetRequest::default();
            for (key, value) in fields {
                match (key.as_str(), value) {
                    ("seed", Json::Array(seed)) => request.seed = seed,
                    ("clock", Json::String(clock)) if clock == "reset" => request.clock = true,
                    ("clock", Json::String(clock)) if clock == "keep" => request.clock = false,
                    ("clock", other) => return Err(crate::dev_clock::input(format!("reset's clock is \"reset\" (back to wall time) or \"keep\" (the default), not {other}"))),
                    (key, _) => return Err(Refusal::new("E_INPUT", "input", format!("{SHAPE}; got key {key:?}"))),
                }
            }
            Ok(request)
        }
        _ => Err(Refusal::new("E_INPUT", "input", SHAPE)),
    }
}

// @ref LLP 3000.007#20.25 — one transaction: empty, new identity, reseed; then the host's caches follow.
pub(super) fn reset(request: Request, shared: &Shared, body: &str) {
    if !shared.personas || !request.remote_addr().is_some_and(|a| a.ip().is_loopback()) {
        respond_timed(request, shared, 403, json!({ "denied": refusal_json(&reset_release()) }));
        return;
    }
    let started = std::time::Instant::now();
    let refuse = |request, refusal: Refusal| respond_timed(request, shared, 400, json!({ "denied": refusal_json(&refusal.guide("testing")) }));
    let asked = match reset_request(body) {
        Ok(asked) => asked,
        Err(refusal) => return refuse(request, refusal),
    };
    let typed = match typed_rows(shared, &asked.seed) {
        Ok(typed) => typed,
        Err(refusal) => return refuse(request, refusal),
    };
    // Serialize with clock advances, then take the engine before the clock:
    // the order clock advance and worker claims use.
    let advance = lock(&shared.maintenance).advance.clone();
    let _advance = lock(&advance);
    let mut engine = lock(&shared.engine);
    let mut clock = lock(&shared.clock).clone();
    if asked.clock && let Err(refusal) = clock.reset() { drop(engine); return refuse(request, refusal); }
    let now = clock.now();
    let reset = match engine.dev_reset_at(typed, now) {
        Ok(reset) => reset,
        Err(error) => {
            drop(engine);
            return respond_timed(request, shared, 200, json!({ "denied": refusal_json(&seed_refusal(error)) }));
        }
    };
    if asked.clock { *lock(&shared.clock) = clock; }
    // Detached readers reopen; the following registry, change answers and
    // `/dev/status` forget the old identity. Wake then names the new store,
    // so every held poll returns and each client sees the replacement.
    let sites = lock(&shared.bound).refusal_sites.clone();
    lock(&shared.readers).replace(&engine, &sites);
    lock(&shared.adoption).store_id = reset.store_id.clone();
    if let Ok(reader) = snapback4_core::engine::following_history::Reader::new() { *lock(&shared.following) = reader; }
    *lock(&shared.change_answers) = Default::default();
    shared.durable_committed(&engine);
    let generation = engine.generation();
    drop(engine);
    let assets = reset.assets.len();
    if let Err(error) = reset.assets.remove_files() { snapback4_core::diagnostic!("snapback4 dev: reset left asset bytes behind: {error}"); }
    let now = shared.now();
    snapback4_core::diagnostic!("snapback4 dev: store reset (store {} → {}, seeded {}) in {} ms", reset.previous_store_id, reset.store_id, reset.seeded, started.elapsed().as_millis());
    respond_timed(request, shared, 200, json!({
        "reset": true, "seeded": reset.seeded, "generation": generation, "storeId": reset.store_id,
        "previousStoreId": reset.previous_store_id, "head": reset.seq, "assetsRemoved": assets,
        "now": now, "clockOffsetMs": now - snapback4_core::now_ms(), "ms": started.elapsed().as_millis() as u64,
    }));
}

pub(super) fn reset_release() -> Refusal {
    Refusal::new("E_AUTH", "auth", "resetting the store is a development door; snapback4 serve never empties a store")
        .guide("testing")
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
