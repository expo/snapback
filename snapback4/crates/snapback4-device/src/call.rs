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

fn prediction_clock(request: &Json) -> Result<i64, RuntimeError> {
    arg(request, "now")?.as_i64().ok_or_else(|| RuntimeError::Input("now is an integer prediction clock".into()))
}

fn queued_entry(mut value: Json) -> Result<Queued, RuntimeError> {
    let has_clock = value.get("now").and_then(Json::as_i64).is_some();
    if !has_clock {
        if let Some(now) = value.get_mut("now") {
            *now = json!(0);
        }
    }
    let mut entry: Queued = parse(value)?;
    if !has_clock {
        // Persisted intents may predate clocks. Keep them sendable, but
        // never use Queued's default clock to predict or replay their rows.
        entry.predictable = false;
        entry.predicted.clear();
    }
    Ok(entry)
}

fn parse<T: serde::de::DeserializeOwned>(value: Json) -> Result<T, RuntimeError> {
    #[cfg(test)]
    OWNED_DECODES.set(OWNED_DECODES.get() + 1);
    snapback4_core::json_codec::from_value(value).map_err(|e| RuntimeError::decode(e, RuntimeError::Input))
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
            // @ref LLP 3000.019#3.4 — local physical counts, never server data or query authority.
            #[cfg(feature = "native")]
            "residency" => device.store().residency(device.schema())?,
            // @ref LLP 3000.011.005.000#2 — native smoke records counts, never row contents.
            #[cfg(not(target_arch = "wasm32"))]
            "witness_state" => {
                let rows = device.schema().tables.iter().filter(|(_, table)| table.sync.is_some())
                    .map(|(name, _)| device.store().witness_count(name).map(|count| (name.clone(), count)))
                    .collect::<Result<std::collections::BTreeMap<_, _>, _>>()?;
                let state = device.sync_state_read()?;
                json!({ "rows": rows, "watermark": state.watermark, "generation": state.generation,
                    "storeId": state.store_id, "acquired": state.acquired, "backendRequired": state.backend_required })
            }
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
            "sync_state" => encoded(&if request.get("capture").and_then(Json::as_bool) == Some(false) { device.sync_state_read()? } else { device.sync_state()? })?,
            "begin_send" => json!({ "send_revision": device.begin_send()? }),
            "adopt" => {
                let mut expected = request.get("adoption_capture").cloned().map(parse::<std::collections::BTreeMap<String, Option<String>>>).transpose()?.unwrap_or_default();
                for (field, key) in [("store_id", "device:store_id"), ("send_revision", "device:send_revision")] {
                    if let Some(value) = request.get(field) {
                        let value = if field == "send_revision" {
                            let revision = value.as_u64().ok_or_else(|| RuntimeError::Input("send_revision is an unsigned integer".into()))?;
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
                let (result, unknown, retained, components, provenance) = device.query_observation(text(&request, "name")?, text(&request, "viewer")?, &args, now, true);
                let mut reply = match result {
                    Ok(outcome) => {
                        let mut reply = json!({ "complete": outcome.complete, "cut": encoded(&outcome.cut)?, "nextExpiry": outcome.next_expiry, "tables": outcome.tables });
                        if !outcome.unavailable && outcome.data.has_retained_rows() {
                            reply["retainedRows"] = snapback4_core::wire::to_json(&outcome.data.retained_rows_mask());
                        }
                        if outcome.unavailable {
                            reply["loading"] = Json::Bool(true);
                        } else {
                            reply["data"] = snapback4_core::wire::to_json(&outcome.data);
                            reply["next"] = outcome.next.map(Json::String).unwrap_or(Json::Null);
                        }
                        if !components.is_empty() { reply["components"] = encoded(&components)?; }
                        reply
                    },
                    Err(refusal) => json!({ "denied": encoded(&refusal)? }),
                };
                for (field, value) in [("unknown", unknown), ("retained", retained)] {
                    reply[field] = Json::Bool(value);
                }
                // Absence means false; ordinary replies retain the published 0.2.33 wire.
                if provenance.speculative { reply["speculative"] = Json::Bool(true); }
                reply
            }
            "backend" => encoded(&device.backend())?,
            "upload_facts" => {
                device.upload_facts(text(&request, "viewer")?, arg(&request, "asset")?)?;
                Json::Null
            }
            "forget_upload_facts" => {
                device.forget_upload_facts(text(&request, "viewer")?, text(&request, "id")?)?;
                Json::Null
            }
            "asset_home" => device.asset_home(text(&request, "id")?, text(&request, "viewer")?, request.get("now").and_then(Json::as_i64).unwrap_or(0))?,
            "admit" => {
                let entry = take(&mut request, "entry")?;
                let replay = entry.get("replay_candidate").and_then(Json::as_bool).unwrap_or(false);
                encoded(&device.admit_with_replay(queued_entry(entry)?, replay)?)?
            }
            "settle" => {
                device.settle(text(&request, "id")?, request.get("seq").and_then(Json::as_u64))?;
                Json::Null
            }
            "predict" => {
                let args = request.get("args").cloned().unwrap_or(json!({}));
                let now = prediction_clock(&request)?;
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
                let entry = take(&mut request, "entry")?;
                device.enqueue(&queued_entry(entry)?)?;
                Json::Null
            }
            "queued" => encoded(&device.queued_with_clock_floor(request.get("restore_clock_floor").and_then(Json::as_bool).unwrap_or(false))?)?,
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
    let (touched, published) = device.apply_publication(&command.page, command.first.as_bool().unwrap_or(false))?;
    Ok(json!({ "touched": touched, "published": published }))
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
