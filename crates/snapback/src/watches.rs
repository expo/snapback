pub use snapback_types::watches::*;

use crate::diagnostic::{SnapbackError, SnapbackResult};
use serde_json::Value;

pub fn parse_predicate(value: &Value) -> SnapbackResult<(Predicate, String)> {
    snapback_types::watches::parse_predicate(value).map_err(Into::into)
}

pub fn canonical_json(value: &Value) -> SnapbackResult<String> {
    snapback_types::watches::canonical_json(value).map_err(Into::into)
}

pub fn canonical_args(value: &Value) -> SnapbackResult<(String, String)> {
    snapback_types::watches::canonical_args(value).map_err(Into::into)
}

pub fn input_invalid(message: impl Into<String>) -> SnapbackError {
    snapback_types::watches::input_invalid(message).into()
}

pub fn catalog_corrupt() -> SnapbackError {
    snapback_types::watches::catalog_corrupt().into()
}
