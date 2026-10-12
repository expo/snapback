//! The call over a C ABI, for hosts that link the module: Expo's Swift and
//! Kotlin, Exact2's Apple host. `sb4_open` returns a device, `sb4_call`
//! takes `{"op": ..., ...}` and returns JSON the caller frees with
//! `sb4_free`, `sb4_close` closes. A Rust host calls `call` directly.

#![allow(unsafe_code)]

use crate::native::Device;
use serde_json::{Value as Json, json};
use std::any::Any;
use std::cell::RefCell;
use std::ffi::{CStr, CString, c_char};
use std::panic::{AssertUnwindSafe, catch_unwind};

pub use crate::call::call;

thread_local! {
    /// The refusal belongs to the exact open attempt. Keeping it on the
    /// calling thread lets Swift ask why without opening the store again.
    static LAST_OPEN_REFUSAL: RefCell<Option<Json>> = const { RefCell::new(None) };
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

fn panic_message(payload: Box<dyn Any + Send>) -> String {
    match payload.downcast::<String>() {
        Ok(message) => *message,
        Err(payload) => match payload.downcast::<&'static str>() {
            Ok(message) => (*message).to_owned(),
            Err(_) => "non-text panic".to_owned(),
        },
    }
}

fn panic_denial(entry: &str, payload: Box<dyn Any + Send>) -> Json {
    let error = snapback4_core::error::RuntimeError::Store(format!("native {entry} panicked: {}", panic_message(payload)));
    json!({ "denied": error.refusal() })
}

fn guarded_json(entry: &str, action: impl FnOnce() -> Json) -> Json {
    // Native libraries unwind in development, where this maps a panic to
    // the ordinary refusal envelope. The production profile uses
    // panic=abort and terminates before anything can unwind across C.
    match catch_unwind(AssertUnwindSafe(action)) {
        Ok(answer) => answer,
        Err(payload) => panic_denial(entry, payload),
    }
}

fn remember_open_refusal(refusal: Json) {
    LAST_OPEN_REFUSAL.with(|last| *last.borrow_mut() = Some(refusal));
}

/// Open the device's store at `path` for the backend (`GET /schema`'s
/// JSON), or for the backend kept from last time when `backend` is null or
/// empty (a cold start offline). Null when the store refuses: ask
/// `sb4_open_reason` why.
#[unsafe(no_mangle)]
pub extern "C" fn sb4_open(path: *const c_char, backend: *const c_char) -> *mut Device {
    let _ = LAST_OPEN_REFUSAL.with(|last| last.borrow_mut().take());
    let opened = catch_unwind(AssertUnwindSafe(|| -> Result<Device, Json> {
        let path = c_text(path).ok_or_else(|| json!({ "denied": { "code": "E_INPUT", "family": "input", "message": "path is text" } }))?;
        let opening = crate::opening::Opening::parse(c_text(backend)).map_err(|error| json!({ "denied": error.refusal() }))?;
        Device::open_with(std::path::Path::new(path), opening).map_err(|error| json!({ "denied": error.refusal() }))
    }));
    match opened {
        Ok(Ok(device)) => Box::into_raw(Box::new(device)),
        Ok(Err(refusal)) => { remember_open_refusal(refusal); std::ptr::null_mut() }
        Err(payload) => { remember_open_refusal(panic_denial("open", payload)); std::ptr::null_mut() }
    }
}

/// Take the refusal from the most recent failed `sb4_open` on this thread.
/// The parameters remain for ABI compatibility and are deliberately not
/// inspected: diagnosis must not mutate or contend for the store again.
#[unsafe(no_mangle)]
pub extern "C" fn sb4_open_reason(_path: *const c_char, _backend: *const c_char) -> *mut c_char {
    c_string(guarded_json("open reason", || LAST_OPEN_REFUSAL.with(|last| last.borrow_mut().take().unwrap_or_else(|| json!({ "denied": { "code": "E_INPUT", "family": "input", "message": "there is no failed sb4_open on this thread" } })))))
}

/// One call: `request` is JSON with an `op`; the answer is JSON to free
/// with `sb4_free`.
#[unsafe(no_mangle)]
pub extern "C" fn sb4_call(device: *mut Device, request: *const c_char) -> *mut c_char {
    c_string(guarded_json("call", || {
        if device.is_null() {
            return json!({ "denied": { "code": "E_INPUT", "family": "input", "message": "no device" } });
        }
        // SAFETY: the pointer came from `sb4_open` and has not been closed.
        let device = unsafe { &mut *device };
        match c_text(request) {
            Some(request) => crate::call::call_text(device, request),
            None => json!({ "denied": { "code": "E_INPUT", "family": "input", "message": "the request is JSON text" } }),
        }
    }))
}

#[unsafe(no_mangle)]
pub extern "C" fn sb4_free(text: *mut c_char) {
    let _ = catch_unwind(AssertUnwindSafe(|| if !text.is_null() {
        // SAFETY: the pointer came from `c_string` in this module.
        drop(unsafe { CString::from_raw(text) });
    }));
}

#[unsafe(no_mangle)]
pub extern "C" fn sb4_close(device: *mut Device) {
    let _ = catch_unwind(AssertUnwindSafe(|| if !device.is_null() {
        // SAFETY: the pointer came from `sb4_open` and is closed once.
        drop(unsafe { Box::from_raw(device) });
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native::Backend;

    #[test]
    fn first_install_envelope_preserves_a_backend_installed_by_another_owner() {
        let dir = std::env::temp_dir().join(format!("sb4-ffi-initial-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = CString::new(dir.join("device.sqlite").to_string_lossy().as_bytes()).unwrap();
        let backend = |generation| json!({"generation":generation,"schema":{"tables":{}},"programs":[]});
        let initial = CString::new(json!({"initial_backend":backend(2)}).to_string()).unwrap();
        let device = sb4_open(path.as_ptr(), initial.as_ptr());
        assert!(!device.is_null(), "the ABI accepts a fresh conditional install");
        sb4_close(device);
        let stale = CString::new(json!({"initial_backend":backend(1)}).to_string()).unwrap();
        let device = sb4_open(path.as_ptr(), stale.as_ptr());
        assert!(!device.is_null(), "the ABI opens the winner of an overlapping install");
        let request = CString::new(r#"{"op":"state"}"#).unwrap();
        let response = sb4_call(device, request.as_ptr());
        let state: Json = serde_json::from_str(c_text(response).unwrap()).unwrap();
        sb4_free(response);
        sb4_close(device);
        assert_eq!(state["ok"]["generation"], 2);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_unwinding_entry_point_panic_becomes_a_refusal() {
        let answer = guarded_json("test", || panic!("boundary probe"));
        assert_eq!(answer["denied"]["code"], "E_STORE");
        assert!(answer["denied"]["message"].as_str().unwrap().contains("boundary probe"));
    }

    #[test]
    fn open_reason_reports_the_attempt_without_trying_again() {
        let compiled = snapback4_lang::compile(&[("schema.q".into(), "table rows:\n  read <- allow\n".into())]);
        assert!(compiled.diagnostics.is_empty(), "{:?}", compiled.diagnostics);
        let backend = Backend { generation: 1, schema: compiled.schema, programs: compiled.programs.into_iter().map(|program| program.program).collect() };
        let dir = std::env::temp_dir().join(format!("sb4-ffi-open-reason-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = CString::new(dir.join("device.sqlite").to_string_lossy().as_bytes()).unwrap();
        let valid = CString::new(serde_json::to_string(&backend).unwrap()).unwrap();
        let device = sb4_open(path.as_ptr(), valid.as_ptr());
        assert!(!device.is_null());
        sb4_close(device);

        let invalid = CString::new("{").unwrap();
        assert!(sb4_open(path.as_ptr(), invalid.as_ptr()).is_null());
        // Supplying valid arguments here proves diagnosis returns the
        // recorded failure rather than attempting another successful open.
        let reason = sb4_open_reason(path.as_ptr(), valid.as_ptr());
        assert!(!reason.is_null());
        let parsed: Json = serde_json::from_str(c_text(reason).unwrap()).unwrap();
        sb4_free(reason);
        assert_eq!(parsed["denied"]["code"], "E_INPUT");
        let absent = sb4_open_reason(path.as_ptr(), valid.as_ptr());
        let parsed: Json = serde_json::from_str(c_text(absent).unwrap()).unwrap();
        sb4_free(absent);
        assert_eq!(parsed["denied"]["message"], "there is no failed sb4_open on this thread");
        std::fs::remove_dir_all(dir).unwrap();
    }
}

/// Engine build stamp without opening or mutating a store. Free with sb4_free.
#[unsafe(no_mangle)]
pub extern "C" fn sb4_engine_info() -> *mut c_char {
    c_string(serde_json::to_value(snapback4_core::device_protocol::DeviceEngine::current()).expect("engine stamp"))
}

#[cfg(test)]
#[test]
fn engine_stamp_is_available_without_opening_any_store() {
    let ptr = sb4_engine_info();
    let value: serde_json::Value = serde_json::from_str(c_text(ptr).unwrap()).unwrap();
    sb4_free(ptr);
    assert_eq!(value["format"], 1);
    assert_eq!(value["version"], env!("CARGO_PKG_VERSION"));
    assert!(value["capabilities"].as_array().unwrap().iter().any(|v| v == "sync-generation-v1"));
}
