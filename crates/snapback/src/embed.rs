//! Supported Rust embedding API.
//!
//! The rank-7 façade re-exports the opaque builder implemented beside the
//! rank-6 CLI lifecycle. Keeping the builder and its private startup entry in
//! one crate preserves the pre-carve capability boundary: callers can use the
//! supported builder, but cannot invoke the raw embedded-start composition.

pub use snapback_cli::embed::*;
