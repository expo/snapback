//! Numeric authority for Accepted LLP 0132's not-yet-published vector profile.
//!
//! This module deliberately contains no schema field, index, query, storage,
//! capability, or runtime registration. It establishes only the pinned
//! binary64 evaluator and the independently checked committed profile corpus.

pub mod profile;

pub use profile::{
    VECTOR_COMPONENT_ABS_MAX, VECTOR_DISTANCE_PROFILE_ID, VECTOR_ORDERING_PROFILE_ID,
    VectorMetricV1, admit_vector_components, strict_distance,
};
