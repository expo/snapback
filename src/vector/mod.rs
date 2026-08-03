//! Numeric, transaction-neutral storage, and static carrier authority for
//! Accepted LLP 0132's not-yet-published vector profile.
//!
//! This module deliberately registers no database adapter or executor. Target
//! capability predicates remain false until separate implementation and
//! qualification evidence land.
//!
//! @ref LLP 0132#capabilities-targets-and-staging — carriers and primitives
//!   precede target support and never imply it.

pub mod diagnostics;
pub mod profile;
pub mod storage;
pub mod types;

pub use profile::{
    VECTOR_COMPONENT_ABS_MAX, VECTOR_DISTANCE_PROFILE_ID, VECTOR_ORDERING_PROFILE_ID,
    VECTOR_PROFILE_DIMENSIONS_MAX, VECTOR_PROFILE_DIMENSIONS_MIN, admit_vector_components,
    strict_distance,
};
pub use types::*;
