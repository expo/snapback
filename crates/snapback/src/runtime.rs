//! JavaScript runtime split by architectural owner.
//!
//! The parent preserves the pre-split `crate::runtime::*` surface. The runtime
//! core is the Hermes/Ibex VM boundary, host glue composes application owners,
//! and proof shapes are dependency-light carriers for the contract leaf.

mod core;
mod host_glue;
pub use core::*;
pub use host_glue::*;
pub(crate) use snapback_types::runtime::*;
