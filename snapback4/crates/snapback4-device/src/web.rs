//! The device on the web: the same device, as wasm, over the memory store.
//! The host opens it with the backend and whatever it kept from last
//! time, makes the same JSON call as every other host, and after each call
//! takes the changes to persist (IndexedDB, behind the call) — so a cold
//! start with no network opens on what it holds.

use crate::device::{Backend, Device};
use crate::memory::{Change, MemoryStore};
use serde_json::json;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WebDevice {
    device: Device<MemoryStore>,
}

fn refused(error: &snapback4_core::error::RuntimeError) -> JsError {
    JsError::new(&json!({ "denied": snapback4_core::json_codec::to_value(&error.refusal()).expect("a refusal is serializable") }).to_string())
}

#[wasm_bindgen]
impl WebDevice {
    /// Open on `backend` (`GET /schema`'s JSON text, or null to open on the
    /// backend kept) with `kept`: a JSON array of the changes the host
    /// persisted, in order. Throws the refusal as JSON text.
    #[wasm_bindgen(constructor)]
    pub fn new(backend: Option<String>, kept: &str) -> Result<WebDevice, JsError> {
        let backend = match backend {
            Some(text) if !text.is_empty() && text != "null" => Some(snapback4_core::json_codec::from_text::<Backend>(&text).map_err(|e| JsError::new(&json!({ "denied": { "code": "E_INPUT", "family": "input", "message": e.to_string() } }).to_string()))?),
            _ => None,
        };
        let changes: Vec<Change> = if kept.is_empty() { Vec::new() } else { snapback4_core::json_codec::from_text(kept).map_err(|e| JsError::new(&json!({ "denied": { "code": "E_STORE", "family": "store", "message": format!("the kept changes do not parse: {e}") } }).to_string()))? };
        let mut store = MemoryStore::new();
        store.load(changes).map_err(|e| refused(&e))?;
        // What the open installed (the backend, the generation, a reset) is
        // the host's to keep too: the first drain carries it.
        let device = Device::open_store(store, backend).map_err(|e| refused(&e))?;
        Ok(WebDevice { device })
    }

    /// S3 differential witness: the exact fold used by word index keys.
    /// Kept on the candidate so the witness tests the shipped wasm path.
    pub fn word_fold(text: &str) -> String {
        snapback4_core::words::fold(text)
    }

    /// One call: JSON text in, JSON text out.
    pub fn call(&mut self, request: &str) -> String {
        crate::call::call_text(&mut self.device, request).to_string()
    }

    /// The changes since the last drain, a JSON array of `{s, k, v}`, for
    /// the host to persist in one transaction.
    pub fn drain(&mut self) -> String {
        snapback4_core::json_codec::to_text(&self.device.store().drain()).unwrap_or_else(|_| "[]".into())
    }
}
