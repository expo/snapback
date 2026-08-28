//! Developer tools and benchmark harnesses outside the product dependency graph.

#![allow(clippy::result_large_err)]

#[used]
static BUILD_INPUT_LEAF_LINK_ANCHOR: fn() = || {
    let _ = snapback_build_identity::link_anchor();
};

use snapback_engine::{ephemeral, local, runtime};
use snapback_kernel::{diagnostic, live_matcher, storage};
use snapback_types::{bench_fixture, manifest};

#[doc(hidden)]
pub mod agent_safe_digest;
pub mod bench;
pub mod schema_export;
#[cfg(feature = "telemetry-phase1-proof")]
pub mod telemetry_bench;
