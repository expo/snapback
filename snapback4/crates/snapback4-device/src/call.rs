//! One JSON call into the device, for every host: `{"op": ..., ...}` in,
//! `{"ok": ...}` or `{"denied": {code, family, message, ...}}` out when
//! the call itself failed; a query's or a prediction's refusal is the
//! card's `denied` inside `ok`, as a screen reads it. Nothing panics.
//! Ops: state, sync_state, observe_store, begin_send, adopt, apply, query, backend,
//! admit, settle, predict, withdraw, enqueue, queued, next_submission,
//! dequeue, meta, set_meta, clear_rows, install_native.

use crate::device::{Backend, Device, Queued, StreamPage};
use crate::store::DeviceStore;
use serde_json::{Value as Json, json};
use snapback4_core::error::RuntimeError;

fn answer(result: Result<Json, RuntimeError>) -> Json {
    match result {
        Ok(value) => json!({ "ok": value }),
        Err(error) => json!({ "denied": snapback4_core::json_codec::to_value(&error.refusal()).expect("a refusal is serializable") }),
    }
}

fn arg<'a>(request: &'a Json, name: &str) -> Result<&'a Json, RuntimeError> {
    request.get(name).ok_or_else(|| RuntimeError::Input(format!("the call needs {name}")))
}

fn text<'a>(request: &'a Json, name: &str) -> Result<&'a str, RuntimeError> {
    arg(request, name)?.as_str().ok_or_else(|| RuntimeError::Input(format!("{name} is text")))
}

fn parse<T: serde::de::DeserializeOwned>(value: Json) -> Result<T, RuntimeError> {
    #[cfg(test)]
    OWNED_DECODES.set(OWNED_DECODES.get() + 1);
    snapback4_core::json_codec::from_value(value).map_err(|e| RuntimeError::Input(e.to_string()))
}

fn encoded<T: serde::Serialize>(value: &T) -> Result<Json, RuntimeError> { #[cfg(test)] OWNED_ENCODES.set(OWNED_ENCODES.get() + 1);
    snapback4_core::json_codec::to_value(value).map_err(|e| RuntimeError::Store(e.to_string()))
}

fn take(request: &mut Json, name: &str) -> Result<Json, RuntimeError> {
    request.get_mut(name).map(Json::take).ok_or_else(|| RuntimeError::Input(format!("the call needs {name}")))
}

/// The dispatcher consumes the request so decoding never clones a page.
pub fn call<S: DeviceStore>(device: &mut Device<S>, mut request: Json) -> Json {
    let op = match request.get("op").and_then(Json::as_str) {
        Some(op) => op.to_owned(),
        None => return answer(Err(RuntimeError::Input("the call needs op".into()))),
    };
    answer((|| -> Result<Json, RuntimeError> {
        Ok(match op.as_str() {
            "state" => {
                let (watermark, generation) = device.state()?;
                json!({ "watermark": watermark, "generation": generation, "native": device.native_digest() })
            }
            "install_native" => {
                // The app's module from `/native.wasm`, as hex, with the digest
                // the server named (LLP 3000.005 §9).
                let bytes = snapback4_core::value::decode_bytes_hex(text(&request, "wasm")?).ok_or_else(|| RuntimeError::Input("wasm is the module's bytes as lowercase base16".into()))?;
                let generation = arg(&request, "generation")?.as_u64().ok_or_else(|| RuntimeError::Input("generation is an unsigned integer".into()))?;
                let (jobs, reads) = device.install_native(&bytes, text(&request, "digest")?, generation)?;
                json!({ "jobs": jobs, "reads": reads })
            }
            "sync_state" => encoded(&device.sync_state()?)?,
            "sync_metadata" => {
                let metadata = parse(take(&mut request, "metadata")?)?;
                let capture = parse(take(&mut request, "capture")?)?;
                json!(device.sync_metadata(metadata, capture)?)
            }
            "begin_send" => json!({ "send_revision": device.begin_send()? }),
            "adopt" => {
                let mut expected = std::collections::BTreeMap::new();
                // @ref LLP 3000.007#18.2 — keep the request-local acquisition fence through the later
                // schema fetch as well as the initial store observation.
                for (field, key) in [("store_id", "device:store_id"), ("send_revision", "device:send_revision"), ("captured_watermark", "device:watermark")] {
                    if let Some(value) = request.get(field) {
                        let value = if field != "store_id" {
                            let revision = value.as_u64().ok_or_else(|| RuntimeError::Input(format!("{field} is an unsigned integer")))?;
                            if revision == 0 && device.store().meta(key)?.is_none() { None } else { Some(revision.to_string()) }
                        } else if value.is_null() { None } else {
                            Some(value.as_str().ok_or_else(|| RuntimeError::Input("store_id is text or null".into()))?.to_owned())
                        };
                        expected.insert(key.to_owned(), value);
                    }
                }
                device.adopt_captured(parse::<Backend>(take(&mut request, "backend")?)?, expected)?;
                Json::Null
            }
            "apply" | "observe_store" => {
                arg(&request, "page")?; // Preserve the missing-argument diagnostic.
                page_call(device, parse(request)?)?
            }
            "query" => {
                let args = request.get("args").cloned().unwrap_or(json!({}));
                let now = request.get("now").and_then(Json::as_i64).unwrap_or(0);
                // `unknown` names server-only knowledge (missing facts or presence), not every incomplete answer.
                let (result, unknown, retained, components) = device.query_with_components(text(&request, "name")?, text(&request, "viewer")?, &args, now);
                match result {
                    Ok(outcome) => {
                        let mut reply = json!({ "data": snapback4_core::wire::to_json(&outcome.data), "complete": outcome.complete, "cut": encoded(&outcome.cut)?, "next": outcome.next, "nextExpiry": outcome.next_expiry, "tables": outcome.tables, "unknown": unknown, "retained": retained });
                        if !components.is_empty() { reply["components"] = encoded(&components)?; }
                        reply
                    },
                    Err(refusal) => json!({ "denied": encoded(&refusal)?, "unknown": unknown, "retained": retained }),
                }
            }
            "backend" => encoded(&device.backend())?,
            "upload_facts" => {
                device.upload_facts(text(&request, "viewer")?, arg(&request, "asset")?)?;
                Json::Null
            }
            "asset_home" => device.asset_home(text(&request, "id")?, text(&request, "viewer")?, request.get("now").and_then(Json::as_i64).unwrap_or(0))?,
            "admit" => {
                let entry = take(&mut request, "entry")?;
                let replay = entry.get("replay_candidate").and_then(Json::as_bool).unwrap_or(false);
                encoded(&device.admit_with_replay(parse::<Queued>(entry)?, replay)?)?
            }
            "settle" => {
                device.settle(text(&request, "id")?, request.get("seq").and_then(Json::as_u64))?;
                Json::Null
            }
            "predict" => {
                let args = request.get("args").cloned().unwrap_or(json!({}));
                let now = request.get("now").and_then(Json::as_i64).unwrap_or(0);
                let new_ids: Vec<String> = request.get_mut("newIds").map(Json::take).map(parse).transpose()?.unwrap_or_default();
                let entropy = request.get("entropy").and_then(Json::as_u64).unwrap_or(1);
                match device.predict(text(&request, "name")?, text(&request, "viewer")?, &args, now, new_ids, entropy) {
                    Ok(predicted) => encoded(&predicted)?,
                    Err(error) if error.is_refusal() => json!({ "denied": snapback4_core::json_codec::to_value(&error.refusal()).expect("a refusal is serializable") }),
                    Err(error) => return Err(error),
                }
            }
            "withdraw" => {
                let keys: Vec<String> = parse(take(&mut request, "predicted")?)?;
                device.withdraw(&keys)?;
                Json::Null
            }
            "enqueue" => {
                device.enqueue(&parse::<Queued>(take(&mut request, "entry")?)?)?;
                Json::Null
            }
            "queued" => encoded(&device.queued()?)?,
            "next_submission" => json!(device.next_submission()?),
            "dequeue" => {
                device.dequeue(text(&request, "id")?)?;
                Json::Null
            }
            "meta" => json!(device.meta(text(&request, "key")?)?),
            "set_meta" => {
                device.set_meta(text(&request, "key")?, text(&request, "value")?)?;
                Json::Null
            }
            "keep_write" => {
                device.keep_write(text(&request, "value")?)?;
                Json::Null
            }
            "clear_rows" => {
                device.clear_rows()?;
                Json::Null
            }
            other => return Err(RuntimeError::UnknownOp(other.to_owned())),
        })
    })())
}


/// Decode the complete page command from its original text. Nonmatching envelopes
/// (including duplicate fields) use the owned dispatcher's existing rules.
/// Other commands keep the dispatcher above; no command has a second model.
pub fn call_text<S: DeviceStore>(device: &mut Device<S>, request: &str) -> Json {
    try_call_text(device, request).unwrap_or_else(|_| json!({ "denied": { "code": "E_INPUT", "family": "input", "message": "the request is JSON text" } }))
}

pub fn try_call_text<S: DeviceStore>(device: &mut Device<S>, request: &str) -> Result<Json, serde_json::Error> {
    use snapback4_core::json_codec;
    if let Ok(command) = json_codec::from_text::<PageArgument>(request) {
        if matches!(command.op.as_str(), "apply" | "observe_store") {
            json_codec::validate_text(request)?;
            return Ok(answer(page_call(device, command)));
        }
    }
    #[cfg(test)]
    OWNED_FALLBACKS.set(OWNED_FALLBACKS.get() + 1);
    Ok(call(device, json_codec::from_text(request)?))
}

// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — one page envelope for text and owned dispatch.
#[derive(serde::Deserialize)]
struct PageArgument {
    op: String,
    page: StreamPage,
    #[serde(default)]
    first: Json,
}

fn page_call<S: DeviceStore>(device: &mut Device<S>, command: PageArgument) -> Result<Json, RuntimeError> {
    #[cfg(test)]
    PAGE_CALLS.set(PAGE_CALLS.get() + 1);
    if command.op == "observe_store" { return encoded(&device.observe_store(&command.page)?); }
    // A missing marker is a continuation; starting a snapshot must be explicit.
    Ok(json!({ "touched": device.apply(&command.page, command.first.as_bool().unwrap_or(false))? }))
}

#[cfg(test)]
std::thread_local! {
    static PAGE_CALLS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static OWNED_FALLBACKS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static OWNED_ENCODES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static OWNED_DECODES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}
#[cfg(test)]
#[path = "../tests/codec/route.rs"]
mod route_tests;
