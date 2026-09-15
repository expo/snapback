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
        Err(error) => json!({ "denied": error.refusal() }),
    }
}

fn arg<'a>(request: &'a Json, name: &str) -> Result<&'a Json, RuntimeError> {
    request.get(name).ok_or_else(|| RuntimeError::Input(format!("the call needs {name}")))
}

fn text<'a>(request: &'a Json, name: &str) -> Result<&'a str, RuntimeError> {
    arg(request, name)?.as_str().ok_or_else(|| RuntimeError::Input(format!("{name} is text")))
}

fn parse<T: serde::de::DeserializeOwned>(value: &Json) -> Result<T, RuntimeError> {
    serde_json::from_value(value.clone()).map_err(|e| RuntimeError::Input(e.to_string()))
}

fn encoded<T: serde::Serialize>(value: &T) -> Result<Json, RuntimeError> {
    serde_json::to_value(value).map_err(|e| RuntimeError::Store(e.to_string()))
}

/// The dispatcher: the same call on every host.
pub fn call<S: DeviceStore>(device: &mut Device<S>, request: &Json) -> Json {
    let op = match request.get("op").and_then(Json::as_str) {
        Some(op) => op,
        None => return answer(Err(RuntimeError::Input("the call needs op".into()))),
    };
    answer((|| -> Result<Json, RuntimeError> {
        Ok(match op {
            "state" => {
                let (watermark, generation) = device.state()?;
                json!({ "watermark": watermark, "generation": generation, "native": device.native_digest() })
            }
            "install_native" => {
                // The app's module from `/native.wasm`, as hex, with the digest
                // the server named (LLP 3000.005 §9).
                let bytes = snapback4_core::value::decode_bytes_hex(text(request, "wasm")?).ok_or_else(|| RuntimeError::Input("wasm is the module's bytes as lowercase base16".into()))?;
                let generation = arg(request, "generation")?.as_u64().ok_or_else(|| RuntimeError::Input("generation is an unsigned integer".into()))?;
                let (jobs, reads) = device.install_native(&bytes, text(request, "digest")?, generation)?;
                json!({ "jobs": jobs, "reads": reads })
            }
            "sync_state" => encoded(&device.sync_state()?)?,
            "observe_store" => encoded(&device.observe_store(&parse::<StreamPage>(arg(request, "page")?)?)?)?,
            "begin_send" => json!({ "send_revision": device.begin_send()? }),
            "adopt" => {
                let mut expected = std::collections::BTreeMap::new();
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
                device.adopt_captured(parse::<Backend>(arg(request, "backend")?)?, expected)?;
                Json::Null
            }
            "apply" => {
                let page: StreamPage = parse(arg(request, "page")?)?;
                // A missing marker is a continuation. Starting a snapshot is
                // destructive to its private staging area and must be explicit.
                let first = request.get("first").and_then(Json::as_bool).unwrap_or(false);
                json!({ "touched": device.apply(&page, first)? })
            }
            "query" => {
                let args = request.get("args").cloned().unwrap_or(json!({}));
                let now = request.get("now").and_then(Json::as_i64).unwrap_or(0);
                let (result, unknown, retained) = device.query_with_coverage(text(request, "name")?, text(request, "viewer")?, &args, now);
                match result {
                    Ok(outcome) => json!({ "data": snapback4_core::wire::to_json(&outcome.data), "complete": outcome.complete, "next": outcome.next, "nextExpiry": outcome.next_expiry, "tables": outcome.tables, "unknown": unknown, "retained": retained }),
                    Err(refusal) => json!({ "denied": refusal, "unknown": unknown, "retained": retained }),
                }
            }
            "backend" => encoded(&device.backend())?,
            "upload_facts" => {
                device.upload_facts(text(request, "viewer")?, arg(request, "asset")?)?;
                Json::Null
            }
            "asset_home" => device.asset_home(text(request, "id")?, text(request, "viewer")?, request.get("now").and_then(Json::as_i64).unwrap_or(0))?,
            "admit" => {
                let entry = arg(request, "entry")?;
                encoded(&device.admit_with_replay(parse::<Queued>(entry)?, entry.get("replay_candidate").and_then(Json::as_bool).unwrap_or(false))?)?
            }
            "settle" => {
                device.settle(text(request, "id")?, request.get("seq").and_then(Json::as_u64))?;
                Json::Null
            }
            "predict" => {
                let args = request.get("args").cloned().unwrap_or(json!({}));
                let now = request.get("now").and_then(Json::as_i64).unwrap_or(0);
                let new_ids: Vec<String> = request.get("newIds").map(parse).transpose()?.unwrap_or_default();
                let entropy = request.get("entropy").and_then(Json::as_u64).unwrap_or(1);
                match device.predict(text(request, "name")?, text(request, "viewer")?, &args, now, new_ids, entropy) {
                    Ok(predicted) => encoded(&predicted)?,
                    Err(error) if error.is_refusal() => json!({ "denied": error.refusal() }),
                    Err(error) => return Err(error),
                }
            }
            "withdraw" => {
                let keys: Vec<String> = parse(arg(request, "predicted")?)?;
                device.withdraw(&keys)?;
                Json::Null
            }
            "enqueue" => {
                device.enqueue(&parse::<Queued>(arg(request, "entry")?)?)?;
                Json::Null
            }
            "queued" => encoded(&device.queued()?)?,
            "next_submission" => json!(device.next_submission()?),
            "dequeue" => {
                device.dequeue(text(request, "id")?)?;
                Json::Null
            }
            "meta" => json!(device.meta(text(request, "key")?)?),
            "set_meta" => {
                device.set_meta(text(request, "key")?, text(request, "value")?)?;
                Json::Null
            }
            "keep_write" => {
                device.keep_write(text(request, "value")?)?;
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
