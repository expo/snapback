//! Service-owned manifest validation and target facts.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use std::collections::BTreeSet;

pub(crate) use snapback_types::contract_types::*;
pub(crate) use snapback_types::manifest::*;

use snapback_types::manifest::{
    unsupported_capability_error as leaf_unsupported_capability_error, validate_artifact_header,
    validate_known_v1_capabilities, vector_manifest_invalid as leaf_vector_manifest_invalid,
};

fn unsupported_capability_error(capability: &str, message: impl Into<String>) -> SnapbackError {
    leaf_unsupported_capability_error(capability, message).into()
}

fn vector_manifest_invalid(message: impl Into<String>) -> SnapbackError {
    leaf_vector_manifest_invalid(message).into()
}

mod push_assets;

pub use push_assets::*;
