//! Non-promotable, same-app derived deployment forks.
//!
//! The parent is a compatibility facade: owner-aligned submodules are
//! re-exported so existing `crate::instance_fork::*` callers remain unchanged.
//!
//! The measured carve map attributed child-process supervision to this file,
//! but the production `Command`/spawn/readiness/kill loop lives in
//! `cli/fork.rs`. The server-aware code found here was confined to the inline
//! test module; it remains a test sibling because it exercises private fork
//! hooks. Production host-owned sidecars are isolated behind [`ForkHost`].

mod fork_host;
mod server_host;
mod service;

pub use snapback_types::instance_fork::contract;
pub use snapback_types::instance_fork::*;
pub use fork_host::ForkHost;
pub use server_host::*;
pub use service::*;
