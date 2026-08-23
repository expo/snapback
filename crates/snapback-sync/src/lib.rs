//! Snapback's durable sync and realtime engine.
//!
//! This crate owns subscriptions, version streams, live coalescing, resumable
//! query state, invalidation delivery, fan-out, and ephemeral rooms. Durable
//! commits remain confined to `snapback-kernel`, while authorization policy
//! and published auth substrate surfaces remain in `snapback-auth`.

#![allow(clippy::result_large_err)]

pub(crate) use snapback_kernel::{conformance, diagnostic, secure_file, storage};
pub(crate) use snapback_types::{
    contract_types, exec_guard, ids, live_wire, manifest, network_profile, remediation,
    rqs_contract,
};

pub mod auth;
pub mod bounded_children_cursor;
pub mod connected_clients;
pub mod ephemeral;
pub mod graph_captured_read;
pub mod live_coalesce;
pub mod local;
pub mod realtime;
pub mod rqs;
pub mod schema_export;
pub mod snapshot_batch_cursor;
pub mod snapshot_batch_cursor_v2;
pub mod spike_trace;
pub mod stream_attempt;
