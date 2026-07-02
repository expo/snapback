//! Core Snapback runtime components.

pub mod admin;
pub mod bench;
pub mod cli;
pub mod config;
pub mod contract_exact;
pub mod cron;
pub mod diagnostic;
pub mod ephemeral;
pub mod exec_guard;
pub mod instance_lock;
pub(crate) mod live_matcher;
pub mod local;
pub mod manifest;
pub mod runtime;
pub mod schema_export;
pub mod server;
pub mod storage;
pub(crate) mod warm_vm;
