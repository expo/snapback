//! Non-promotable, same-app derived deployment fork service.

mod service;

pub use service::*;
pub(crate) use snapback_kernel::instance_fork::*;
pub(crate) use snapback_kernel::instance_fork::{inspect_boot, inspect_boot_at};
pub(crate) use snapback_types::instance_fork::contract;
pub(crate) use snapback_types::instance_fork::*;
