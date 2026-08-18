//! VM lifecycle policy for Ibex handlers.
//!
//! Current upstream Ibex runtimes are permanently bound to the OS thread that
//! creates them. Snapback executes local queries and mutations on blocking
//! workers that may change between invocations, so a runtime cannot safely
//! enter a process-wide pool: later evaluation and even destruction could
//! happen off its owner thread. The local target therefore uses a fresh
//! runtime per invocation until execution is pinned to stable owner threads.
//!
//! @ref LLP 0009#dk-4-retired--upstream-ibex-owner-thread-contract-2026-07-27 —
//! fresh-per-invocation is the safe and honestly reported lifecycle.

/// Per-instance lifecycle policy handle. It intentionally contains no
/// runtimes, which makes sharing it across Snapback worker threads safe.
#[derive(Default)]
#[doc(hidden)]
pub struct WarmVmPool;

impl WarmVmPool {
    pub fn from_env() -> Self {
        Self
    }

    /// Warm reuse is unavailable while Ibex runtimes are owner-thread-affine.
    pub fn enabled(&self) -> bool {
        false
    }

    /// Retained as the benchmark/test control seam. Enabling is deliberately a
    /// no-op rather than an unsafe escape hatch.
    pub fn set_enabled(&self, _enabled: bool) {}

    /// There are no retained runtimes to invalidate.
    pub fn clear(&self) {}
}
