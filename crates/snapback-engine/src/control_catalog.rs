//! Compatibility projection of the lower-owned build-bound control catalog.

// @ref LLP 0276#phases — the engine may consume and re-export the lower
//   catalog owner, but must not retain a search definition of its own.
pub use snapback_kernel::control_catalog::*;
