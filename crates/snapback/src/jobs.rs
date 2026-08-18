//! Compatibility façade for services-owned durable jobs.

pub use snapback_kernel::storage::jobs::*;
pub(crate) use snapback_kernel::storage::jobs::{
    canonical_push_grant, canonical_rehearsal_provenance,
};
