//! The device on the web: the same device, as wasm, over the memory store.
//! The host opens it with the backend and whatever it kept from last
//! time, makes the same JSON call as every other host, and after each call
//! takes the changes to persist (IndexedDB, behind the call) — so a cold
//! start with no network opens on what it holds.

use crate::device::{BackendImage, Device};
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
    /// Open from the server image and opaque host JSON; empty bytes reopen
    /// the image kept by the host. No backend JSON is decoded in this module.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8], identity: &str, host_json: &str, kept: &str) -> Result<WebDevice, JsError> {
        let image = if bytes.is_empty() { None } else { Some(BackendImage { bytes: bytes.to_vec(), identity: identity.into(), host_json: host_json.into() }) };
        let changes: Vec<Change> = if kept.is_empty() { Vec::new() } else { snapback4_core::json_codec::from_text(kept).map_err(|e| JsError::new(&json!({ "denied": { "code": "E_STORE", "family": "store", "message": format!("the kept changes do not parse: {e}") } }).to_string()))? };
        let mut store = MemoryStore::new();
        store.load(changes).map_err(|e| refused(&e))?;
        // What the open installed (the backend, the generation, a reset) is
        // the host's to keep too: the first drain carries it.
        let device = Device::open_image(store, image).map_err(|e| refused(&e))?;
        Ok(WebDevice { device })
    }

    /// Adopt while preserving the capture checks of the JSON host protocol.
    pub fn adopt_image(&mut self, bytes: &[u8], identity: &str, host_json: &str, capture: &str) -> String {
        let result = (|| {
            let expected = snapback4_core::json_codec::from_text(capture).map_err(|e| crate::device::backend_image::image_error(format!("invalid adoption capture: {e}")))?;
            self.device.adopt_image(BackendImage { bytes: bytes.to_vec(), identity: identity.into(), host_json: host_json.into() }, expected)
        })();
        match result {
            Ok(()) => json!({ "ok": null }).to_string(),
            Err(error) => json!({ "denied": snapback4_core::json_codec::to_value(&error.refusal()).expect("a refusal is serializable") }).to_string(),
        }
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
