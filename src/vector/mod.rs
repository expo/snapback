//! Numeric and storage-format authority for Accepted LLP 0132's
//! not-yet-published vector profile.
//!
//! This module deliberately contains no schema field, index, query, storage
//! adapter, capability, or runtime registration. It establishes the pinned
//! binary64 evaluator, committed profile corpus, and transaction-neutral
//! primitives later storage wiring must consume.

pub mod diagnostics;
pub mod profile;
pub mod storage;

pub use profile::{
    VECTOR_COMPONENT_ABS_MAX, VECTOR_DISTANCE_PROFILE_ID, VECTOR_ORDERING_PROFILE_ID,
    VectorMetricV1, admit_vector_components, strict_distance,
};
