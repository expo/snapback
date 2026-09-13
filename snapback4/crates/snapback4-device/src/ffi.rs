//! The call over a C ABI, for hosts that link the module: Expo's Swift and
//! Kotlin, Exact2's Apple host. `sb4_open` returns a device, `sb4_call`
//! takes `{"op": ..., ...}` and returns JSON the caller frees with
//! `sb4_free`, `sb4_close` closes. A Rust host calls `call` directly.

#![allow(unsafe_code)]

use crate::native::{Backend, Device};
use serde_json::{Value as Json, json};
use std::ffi::{CStr, CString, c_char};

pub use crate::call::call;

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
