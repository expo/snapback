//! Engine-owned support for the agent-safe fork/promotion benchmark.

use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::json;
use snapback_types::bench_fixture::{args, functions, schema};
use snapback_types::commit_envelope::ClientIdentityRangeV1;

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::local::LocalSnapback;

/// File-backed acceptance twin for the agent-safe active-lane byte and idle
/// observations. Unlike the feature-gated telemetry fixture (which lives with
/// the phase-1 evidence harness), this is compiled only as a private input to
/// the dated paired recorder.
#[doc(hidden)]
pub fn configured_file_agent_safe(path: impl AsRef<Path>) -> SnapbackResult<LocalSnapback> {
    let mut snapback = LocalSnapback::open(path)?;
    snapback.apply_schema(schema())?;
    snapback.load_functions(functions());
    Ok(snapback)
}

/// One real file-backed ordinary-mutation writer for the dated LLP 0162
/// contention recorder. Construction installs a distinct server-issued range;
/// every timed call runs the same issuance-bearing carrier as the paired
/// active-lane fixture and returns only after its storage transaction commits.
///
/// @ref LLP 0162#measurement-gate — contention p99 measures the covered writer,
///   not a raw SQL stand-in that bypasses envelope and write-authority costs.
#[doc(hidden)]
pub struct AgentSafeActiveContentionWriter {
    database: AgentSafeActiveContentionDatabase,
    range: ClientIdentityRangeV1,
    next_counter: u64,
}

/// One engine-owned database graph shared by every concurrent request in the
/// recorder. Clones share the engine mutex; they do not reopen SQLite or mint
/// another kernel commit authority.
#[derive(Clone)]
#[doc(hidden)]
pub struct AgentSafeActiveContentionDatabase {
    snapback: Arc<Mutex<LocalSnapback>>,
    canonical_stream_id: String,
}

/// Create the shared production-shaped database and return its server-owned
/// canonical stream. Reservation admission and the writer transaction compare
/// this exact durable identity; the recorder never substitutes `"canonical"`.
#[doc(hidden)]
pub fn prepare_agent_safe_active_contention_database(
    path: impl AsRef<Path>,
) -> SnapbackResult<AgentSafeActiveContentionDatabase> {
    let mut snapback = configured_file_agent_safe(path)?;
    snapback.ensure_promotion_contention_infra_for_bench()?;
    let (stream_id, _) = snapback.prepare_agent_safe_active_lane_benchmark_for_client(
        &args(json!({ "title": "contention setup" })),
        "agent-safe-contention-setup",
    )?;
    Ok(AgentSafeActiveContentionDatabase {
        snapback: Arc::new(Mutex::new(snapback)),
        canonical_stream_id: stream_id,
    })
}

impl AgentSafeActiveContentionDatabase {
    pub fn canonical_stream_id(&self) -> &str {
        &self.canonical_stream_id
    }

    pub fn prepare_reservation(
        &self,
        workers: usize,
        issued_at_ms: i64,
    ) -> SnapbackResult<snapback_kernel::fork_promotion_bench::PromotionContentionReservation> {
        self.lock()?
            .prepare_promotion_contention_reservation_for_bench(
                &self.canonical_stream_id,
                workers,
                issued_at_ms,
            )
    }

    pub fn activate_reservation(
        &self,
        reservation: snapback_kernel::fork_promotion_bench::PromotionContentionReservation,
        now_ms: i64,
    ) -> SnapbackResult<snapback_kernel::fork_promotion_bench::PromotionContentionPolicy> {
        self.lock()?
            .activate_promotion_contention_reservation_for_bench(reservation, now_ms)
    }

    pub fn committed_rows(&self) -> SnapbackResult<usize> {
        self.lock()?.committed_promotion_contention_rows_for_bench()
    }

    fn lock(&self) -> SnapbackResult<std::sync::MutexGuard<'_, LocalSnapback>> {
        self.snapback.lock().map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_BENCH_WRITER_POISONED",
                "bench",
                "contention benchmark engine lock was poisoned",
            )
        })
    }
}

impl AgentSafeActiveContentionWriter {
    pub fn open(
        database: AgentSafeActiveContentionDatabase,
        worker: usize,
        expected_stream_id: &str,
    ) -> SnapbackResult<Self> {
        let mut snapback = database.lock()?;
        let client_audience_id = format!("agent-safe-contention-worker-{worker}");
        let (stream_id, range) = snapback.prepare_agent_safe_active_lane_benchmark_for_client(
            &args(json!({ "title": "contention writer setup" })),
            &client_audience_id,
        )?;
        if stream_id != expected_stream_id {
            return Err(SnapbackError::error(
                "SNAPBACK_BENCH_STREAM_DIVERGED",
                "bench",
                "concurrent ordinary writer reopened on a different canonical stream",
            ));
        }
        let next_counter = range.range_start;
        drop(snapback);
        Ok(Self {
            database,
            range,
            next_counter,
        })
    }

    pub fn commit_next(&mut self, worker: usize, ordinal: usize) -> SnapbackResult<()> {
        let counter = self.next_counter;
        self.database
            .lock()?
            .invoke_agent_safe_active_lane_benchmark_mutation(
                "createTodo",
                args(json!({
                    "title": format!("contention-{worker}-{ordinal}")
                })),
                &self.range,
                counter,
            )?;
        self.next_counter = self.next_counter.checked_add(1).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_BENCH_RANGE_EXHAUSTED",
                "bench",
                "contention benchmark counter overflowed",
            )
        })?;
        Ok(())
    }
}
