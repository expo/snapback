//! The device on a native host — Expo's Swift and Kotlin, Exact2's Apple
//! and Linux hosts: the partition in the core's own SQLite, reached through
//! one JSON call over a C ABI (`ffi`), or through `call` from a Rust host.

use crate::device;
use snapback4_core::error::RuntimeError;
use snapback4_core::store::Store;
use std::path::Path;

pub use crate::device::{Backend, Predicted, Queued, StreamEvent, StreamPage, SyncState};

/// The device over the core's SQLite.
pub type Device = device::Device<Store>;

impl device::Device<Store> {
    /// Open the device's store at `path` (created when absent) for the
    /// backend the server sent — or, with none, for the backend kept from
    /// last time, so a device that starts with no network opens on what it
    /// holds.
    pub fn open(path: &Path, backend: Option<Backend>, viewer: &str) -> Result<Self, RuntimeError> {
        Self::open_store(crate::sqlite::open(path)?, backend, viewer)
    }
}
