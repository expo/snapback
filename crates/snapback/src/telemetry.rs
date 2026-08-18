//! Compatibility façade for the services-owned telemetry subsystem.

pub use snapback_services::telemetry::{
    BufferDiagnostics, DEFAULT_BATCH_SIZE, DEFAULT_BUFFER_CAPACITY, DEFAULT_DAILY_DAYS,
    DEFAULT_FILE_SIZE_CAP_BYTES, DEFAULT_HOURLY_DAYS, DEFAULT_MAX_AGE_MS, DEFAULT_MAX_DAYS,
    DEFAULT_PRIORITY_RESERVE, DEFAULT_ROLLUP_ROW_CAP, DEFAULT_SWEEP_INTERVAL_MS,
    DEFAULT_TOP_NAMES_PER_HOUR, MAX_MAX_DAYS, ObservationSpan, Phase, Priority, Telemetry,
    TelemetryConfig,
};
pub(crate) use snapback_services::telemetry::{
    CallerAttributionLocalExt, CallerAttributionV1, ObservationSpanLocalExt, TelemetryLocalExt,
    TelemetryStoreIdentity, TelemetryStoreIdentityLocalExt,
};

// This proof lane drives the engine and server, so it remains in the
// remainder instead of creating an upward services dependency.
#[cfg(feature = "telemetry-phase1-proof")]
#[path = "telemetry_bench.rs"]
mod phase1_bench;
#[cfg(feature = "telemetry-phase1-proof")]
pub use phase1_bench::{Phase1BenchmarkConfig, Phase1BenchmarkReport, run_phase1_benchmark};
