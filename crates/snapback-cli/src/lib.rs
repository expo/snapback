//! Snapback command-line adapters and process lifecycle ownership.
//!
//! This crate owns the Clap surface, guide command, MCP stdio transport,
//! lifecycle commands, and production child-process supervision.

#![allow(clippy::result_large_err)]

pub use snapback_server::*;
pub use snapback_kernel::{
    fork_promotion, instance_lock, migration, migration_presentation, operation_detail,
};
pub use snapback_services::replication;

#[doc(hidden)]
pub mod cli;
#[doc(hidden)]
pub mod guide_mcp;
#[doc(hidden)]
pub mod store_state;
