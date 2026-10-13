//! Device identity and transport metadata, available before opening a partition.
// @ref LLP 3000.001.000#protocol — adapters forward crate-owned metadata, never an app's package pin.
use snapback4_core::device_protocol::DeviceEngine;
use std::collections::BTreeMap;

// Rust treats link_section as unsafe; this inert wasm custom section contains only JSON.
#[cfg(target_arch = "wasm32")]
#[allow(unsafe_code)]
mod embedded {
    include!(concat!(env!("OUT_DIR"), "/engine_stamp.rs"));
}

pub fn info() -> DeviceEngine {
    DeviceEngine::current()
}
pub fn headers() -> BTreeMap<String, String> {
    BTreeMap::from([(
        "x-snapback-device".into(),
        snapback4_core::json_codec::to_text(&info()).expect("engine identity"),
    )])
}
