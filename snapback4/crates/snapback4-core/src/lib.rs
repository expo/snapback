#![cfg_attr(not(test), forbid(unsafe_code))]
#![cfg_attr(test, deny(unsafe_code))]
//! Snapback 4's core (LLP 3000 §5, week 2): the value model, the schema
//! with `sync`, the program IR, the SQLite store with one key encoding, rule
//! evaluation with hoisting, the runtime meter, the interpreter, and the
//! partition log. Nothing here knows about HTTP, files, or a device.

// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — the native web-policy witness stays out of the published profiles (`production`, `wasm`); `scripts/check-release-guard.sh` builds this refusal.
#[cfg(all(feature = "web-device-check", not(debug_assertions)))]
compile_error!("web-device-check is only for debug test witnesses of the web device policy; it cannot be enabled in release, production, or wasm profiles");

#[cfg(test)]
extern crate self as snapback4_core;

pub mod assets;
pub(crate) mod authority;
pub mod cursor;
pub mod engine;
pub mod error;
#[cfg(feature = "sqlite")]
pub mod identity;
pub mod ids;
pub mod ir;
pub mod key;
pub mod json_codec;
pub mod meter;
pub mod maintain;
pub mod partition;
pub mod rows;
pub mod revocation;
pub mod schema;
pub mod small_map;
#[cfg(feature = "server-search")]
pub mod search_plan;
pub mod search_decoration;
#[cfg(feature = "sqlite")]
pub mod store;
pub mod successor;
pub mod value;
pub mod wire;
pub mod words;

#[cfg(feature = "sqlite")]
pub use engine::effects::{EffectRun, EffectStep, Settled};
#[cfg(feature = "sqlite")]
pub use engine::job::{JobRun, JobState};
pub use engine::Presence;
#[cfg(feature = "sqlite")]
pub use engine::{AssetGrant, Engine};
pub use engine::{Context, MutationOutcome, QueryOutcome, WriteState};
pub use error::{MeterKind, Refusal, RuntimeError};
pub use ir::{Program, ProgramKind};
pub use meter::{Ceilings, Metered};
pub use schema::Schema;
#[cfg(feature = "sqlite")]
pub use store::Store;
pub use rows::Rows;
pub use value::Value;

/// The engine-private principal that owns the store; no caller can be it.
pub const SYSTEM_PRINCIPAL: &str = "system";

/// Wall-clock milliseconds. The simulator pins `now` on every context, so
/// this is only the default for a real server.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[cfg(feature = "sqlite")]
pub mod private_fs;

#[cfg(not(target_arch = "wasm32"))]
pub mod diagnostics;
