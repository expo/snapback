//! Core Snapback runtime components.

// SnapbackResult intentionally carries structured diagnostic details across the
// public API; narrowing it is a larger compatibility decision than clippy's
// result-size heuristic.
#![allow(clippy::result_large_err)]

pub mod admin;
pub mod bench;
pub mod cli;
pub mod config;
pub mod contract_exact;
pub mod cron;
pub mod diagnostic;
pub mod ephemeral;
pub mod exec_guard;
pub mod host_ops;
pub mod identity;
pub mod instance_lock;
pub(crate) mod live_matcher;
pub mod local;
pub mod manifest;
pub mod runtime;
pub mod schema_export;
pub mod server;
pub mod storage;
pub mod value_expr;
pub(crate) mod warm_vm;
pub mod workerd_exec;
