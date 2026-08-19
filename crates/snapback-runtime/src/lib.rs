//! JavaScript execution substrate for Snapback.
//!
//! This crate owns the Hermes/Ibex FFI, VM lifecycle, and the workerd/V8
//! conformance executor. Host-call implementations remain in the higher-layer
//! engine and enter through narrow invocation-local ports.

pub mod elevated_read_trace;
pub mod runtime;
pub mod warm_vm;
pub mod workerd_exec;
