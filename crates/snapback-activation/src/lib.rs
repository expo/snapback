//! Function-generation composition and atomic successor activation.
//!
//! The storage kernel retains transaction authority. This crate owns the
//! ordering that composes kernel commits with process-local publication.

#![allow(clippy::result_large_err)]

pub use snapback_auth::auth;
pub use snapback_kernel::{diagnostic, storage};
pub use snapback_types::manifest;

pub mod generation_activation;
