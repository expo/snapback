//! One JSON call over a C ABI, for hosts that link the module: Expo's
//! Swift and Kotlin, Exact2's Apple host. `sb4_open` returns a device,
//! `sb4_call` takes `{"op": ..., ...}` and returns JSON the caller frees
//! with `sb4_free`, `sb4_close` closes. Every answer is `{"ok": ...}` or
//! `{"denied": {code, family, message, ...}}` when the call itself failed;
//! a query's or a prediction's refusal is the card's `denied` inside `ok`,
//! as a screen reads it. Nothing panics across the boundary. Ops: state, adopt, apply, query, predict, withdraw, enqueue,
//! queued, next_submission, dequeue, meta, set_meta, clear_rows.

#![allow(unsafe_code)]

use crate::native::{Backend, Device, Queued, StreamPage};
use serde_json::{Value as Json, json};
use snapback4_core::error::RuntimeError;
use std::ffi::{CStr, CString, c_char};

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

/// The dispatcher, callable from Rust hosts (Exact2) without the C layer.
pub fn call(device: &mut Device, request: &Json) -> Json {
    let op = match request.get("op").and_then(Json::as_str) {
        Some(op) => op,
        None => return answer(Err(RuntimeError::Input("the call needs op".into()))),
    };
    answer((|| -> Result<Json, RuntimeError> {
        Ok(match op {
            "state" => {
                let (watermark, generation) = device.state()?;
                json!({ "watermark": watermark, "generation": generation })
            }
            "adopt" => {
                device.adopt(parse::<Backend>(arg(request, "backend")?)?)?;
                Json::Null
            }
            "apply" => {
                let page: StreamPage = parse(arg(request, "page")?)?;
                let first = request.get("first").and_then(Json::as_bool).unwrap_or(true);
                json!({ "touched": device.apply(&page, first)? })
            }
            "query" => {
                let args = request.get("args").cloned().unwrap_or(json!({}));
                let now = request.get("now").and_then(Json::as_i64).unwrap_or(0);
                match device.query(text(request, "name")?, text(request, "viewer")?, &args, now) {
                    Ok(outcome) => json!({ "data": snapback4_core::wire::to_json(&outcome.data), "complete": outcome.complete, "next": outcome.next, "tables": outcome.tables }),
                    Err(refusal) => json!({ "denied": refusal }),
                }
            }
            "predict" => {
                let args = request.get("args").cloned().unwrap_or(json!({}));
                let now = request.get("now").and_then(Json::as_i64).unwrap_or(0);
                let new_ids: Vec<String> = request.get("newIds").map(parse).transpose()?.unwrap_or_default();
                let entropy = request.get("entropy").and_then(Json::as_u64).unwrap_or(1);
                match device.predict(text(request, "name")?, text(request, "viewer")?, &args, now, new_ids, entropy) {
                    Ok(predicted) => serde_json::to_value(predicted).map_err(|e| RuntimeError::Store(e.to_string()))?,
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
            "queued" => serde_json::to_value(device.queued()?).map_err(|e| RuntimeError::Store(e.to_string()))?,
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
            "clear_rows" => {
                device.clear_rows()?;
                Json::Null
            }
            other => return Err(RuntimeError::UnknownOp(other.to_owned())),
        })
    })())
}

fn c_text<'a>(pointer: *const c_char) -> Option<&'a str> {
    if pointer.is_null() {
        return None;
    }
    // SAFETY: the caller passes a NUL-terminated string that outlives the call.
    unsafe { CStr::from_ptr(pointer) }.to_str().ok()
}

fn c_string(json: Json) -> *mut c_char {
    CString::new(json.to_string()).map(CString::into_raw).unwrap_or(std::ptr::null_mut())
}

/// Open the device's store at `path` for the backend (`GET /schema`'s
/// JSON), or for the backend kept from last time when `backend` is null or
/// empty (a cold start offline). Null when the store refuses: ask
/// `sb4_open_reason` why.
#[unsafe(no_mangle)]
pub extern "C" fn sb4_open(path: *const c_char, backend: *const c_char) -> *mut Device {
    let Some(path) = c_text(path) else { return std::ptr::null_mut() };
    let backend = match c_text(backend) {
        None | Some("") | Some("null") => None,
        Some(text) => match serde_json::from_str::<Backend>(text) {
            Ok(backend) => Some(backend),
            Err(_) => return std::ptr::null_mut(),
        },
    };
    match Device::open(std::path::Path::new(path), backend) {
        Ok(device) => Box::into_raw(Box::new(device)),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Why `sb4_open` would refuse: the same call, answering JSON instead of
/// a device (`{"ok": true}` when it would open). Freed with `sb4_free`.
#[unsafe(no_mangle)]
pub extern "C" fn sb4_open_reason(path: *const c_char, backend: *const c_char) -> *mut c_char {
    let Some(path) = c_text(path) else { return c_string(json!({ "denied": { "code": "E_INPUT", "family": "input", "message": "path is text" } })) };
    let backend = match c_text(backend) {
        None | Some("") | Some("null") => None,
        Some(text) => match serde_json::from_str::<Backend>(text) {
            Ok(backend) => Some(backend),
            Err(error) => return c_string(json!({ "denied": { "code": "E_INPUT", "family": "input", "message": error.to_string() } })),
        },
    };
    c_string(match Device::open(std::path::Path::new(path), backend) {
        Ok(_) => json!({ "ok": true }),
        Err(error) => json!({ "denied": error.refusal() }),
    })
}

/// One call: `request` is JSON with an `op`; the answer is JSON to free
/// with `sb4_free`.
#[unsafe(no_mangle)]
pub extern "C" fn sb4_call(device: *mut Device, request: *const c_char) -> *mut c_char {
    if device.is_null() {
        return c_string(json!({ "denied": { "code": "E_INPUT", "family": "input", "message": "no device" } }));
    }
    // SAFETY: the pointer came from `sb4_open` and has not been closed.
    let device = unsafe { &mut *device };
    let request: Json = match c_text(request).map(serde_json::from_str) {
        Some(Ok(json)) => json,
        _ => return c_string(json!({ "denied": { "code": "E_INPUT", "family": "input", "message": "the request is JSON text" } })),
    };
    c_string(call(device, &request))
}

#[unsafe(no_mangle)]
pub extern "C" fn sb4_free(text: *mut c_char) {
    if !text.is_null() {
        // SAFETY: the pointer came from `c_string` in this module.
        drop(unsafe { CString::from_raw(text) });
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn sb4_close(device: *mut Device) {
    if !device.is_null() {
        // SAFETY: the pointer came from `sb4_open` and is closed once.
        drop(unsafe { Box::from_raw(device) });
    }
}
