//! JavaScript runtime split by architectural owner.
//!
//! The parent preserves the pre-split `crate::runtime::*` surface. The runtime
//! core is the Hermes/Ibex VM boundary, host glue composes application owners,
//! and proof shapes are dependency-light carriers for the contract leaf.

mod host_glue;
pub use host_glue::*;
pub(crate) use snapback_runtime::runtime::*;
pub use snapback_runtime::runtime::{
    CapabilityState, IbexCliCapability, IbexSubmoduleCapability, RuntimeCapabilities,
    RuntimeManager, bench_runtime_create_us, qualify_handler_vm,
};
pub(crate) use snapback_types::runtime::*;
