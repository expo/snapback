//! Core Snapback runtime components.

// SnapbackResult intentionally carries structured diagnostic details across the
// public API; narrowing it is a larger compatibility decision than clippy's
// result-size heuristic.
#![allow(clippy::result_large_err)]

pub mod admin;
pub mod admin_impersonation;
pub mod admin_secret_read;
pub mod assets;
pub mod assets_image;
pub mod auth;
pub mod bench;
pub(crate) mod bounded_children_cursor;
pub mod branches;
pub mod bundle;
pub mod cli;
pub mod config;
pub mod contract_exact;
pub mod cron;
pub mod data_tier;
pub mod deploy;
pub mod diagnostic;
pub mod ephemeral;
pub mod exec_guard;
pub mod guide;
pub mod guide_mcp;
pub mod handler_wire;
pub mod host_ops;
pub mod identity;
pub mod instance_lock;
pub mod jobs;
pub(crate) mod live_matcher;
pub mod live_wire;
pub mod local;
pub mod manifest;
pub(crate) mod membership_rules;
pub mod migration;
pub mod args_contract;
pub mod result_contract;
pub mod rqs;
pub mod runtime;
pub mod schema_export;
pub mod search;
pub(crate) mod secure_file;
pub mod seed_identity;
pub mod server;
pub mod service_profile;
pub mod storage;
pub mod stream_attempt;
pub mod value_expr;
pub(crate) mod warm_vm;
pub mod wire_fixtures;
pub mod wire_version;
pub mod workerd_exec;
