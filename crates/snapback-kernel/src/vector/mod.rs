//! Numeric, transactional storage, rebuild, runtime, and carrier authority for
//! Accepted LLP 0132's exact portable-vector profile.
//!
//! The local SQLite target publishes the qualified exact-scan capability;
//! derived and hosted targets remain fail-closed until their own evidence.
//!
//! @ref LLP 0132#capabilities-targets-and-staging — the local claim is an
//!   exact facts/implementation conjunction and never transfers to another
//!   target by carrier reuse.

pub mod diagnostics;
pub mod profile;
pub mod query;
pub mod rebuild;
pub mod sqlite;
pub mod storage;
pub use snapback_types::vector::types;

#[cfg(test)]
mod acceptance;

pub use profile::{
    VECTOR_COMPONENT_ABS_MAX, VECTOR_DISTANCE_PROFILE_ID, VECTOR_ORDERING_PROFILE_ID,
    VECTOR_PROFILE_DIMENSIONS_MAX, VECTOR_PROFILE_DIMENSIONS_MIN, admit_vector_components,
    strict_distance,
};
pub use query::*;
pub use rebuild::{
    VECTOR_REBUILD_EXECUTOR, VectorRebuildPlanBodyV1, VectorRebuildPlanV1, VectorRebuildProgressV1,
    VectorRebuildReceiptV1, VectorRebuildStateV1,
};
pub use types::*;
