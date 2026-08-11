//! In-repo benchmark harness for the canonical local target (LLP 0032 M1).
//!
//! This produces the named numbers the corpus refuses to decide certain things
//! without: per-invocation VM cost, single-writer throughput, live fan-out /
//! matcher cost, read-set validation cost, the spurious-conflict rate under
//! table-granularity validation (the number DK-1/E4 turns on), and ephemeral
//! publish cost. Each metric documents its method inline; results are committed
//! as a Research LLP and a smoke-scale variant runs in CI to catch
//! order-of-magnitude regressions.
//!
//! Everything runs in-process against `LocalSnapback`/`LocalDatabase` (no HTTP)
//! so the numbers isolate compute, not transport. Timing uses `Instant`.
//!
//! @ref LLP 0032#phase-4--measurement — M1.

use std::path::Path;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::bench_fixture::{args, auth, functions, schema};
use crate::ephemeral::{AuthContext, EphemeralCollection, PublishRequest, Scope, SubscribeRequest};
use crate::local::{LiveSubscribeInput, LocalSnapback};
use crate::manifest::{
    FilterExpr, FilterOp, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime,
    HandlerInput, IbexModule, QueryPlan, ReadDependency, ValueExpr,
};
use crate::storage::{BufferedWrite, CapturedReadDependency, CapturedReadKind, LocalDatabase};

/// Dials for the harness. The bin runs a full-scale config; the smoke test runs
/// a tiny one and asserts order-of-magnitude bounds.
#[derive(Clone, Copy, Debug)]
pub struct BenchConfig {
    /// Timed iterations per compute measurement (after warm-up).
    pub iterations: usize,
    /// Live subscriptions for the fan-out / matcher measurements.
    pub subscriptions: usize,
    /// Row dependencies carried in the read-set-validation measurement.
    pub read_set_size: usize,
    /// Trials for the spurious-conflict rate.
    pub conflict_trials: usize,
    /// Publishes for the ephemeral throughput measurement.
    pub ephemeral_publishes: usize,
}

impl BenchConfig {
    /// Full-scale defaults for a real run whose numbers go in the Research LLP.
    pub fn full() -> Self {
        Self {
            iterations: 400,
            subscriptions: 200,
            read_set_size: 50,
            conflict_trials: 200,
            ephemeral_publishes: 2_000,
        }
    }

    /// Tiny scale for the CI smoke lane: still exercises every metric, fast and
    /// timing-noise tolerant.
    pub fn smoke() -> Self {
        Self {
            iterations: 8,
            subscriptions: 8,
            read_set_size: 4,
            conflict_trials: 8,
            ephemeral_publishes: 40,
        }
    }

    /// Statistically repeated step-0 fixture for LLP 0162. Each invocation
    /// builds fresh databases and runtime fixtures; the artifact runner does
    /// one unrecorded whole-run warm-up followed by eleven recorded runs.
    pub fn agent_safe_step0() -> Self {
        Self {
            iterations: 60,
            subscriptions: 16,
            read_set_size: 32,
            conflict_trials: 32,
            ephemeral_publishes: 400,
        }
    }
}

/// Every named metric, each a number with its unit in the field name.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BenchReport {
    pub iterations: usize,
    /// Per-invocation VM cost: create + eval of a trivial handler that touches
    /// no data. Isolates the **fresh**-VM-per-invocation overhead (the warm
    /// pool is disabled inside this measurement so the metric keeps its
    /// definition). Drives DK-4.
    pub vm_cost_us: f64,
    /// Of the VM cost, the *creation* portion (`ex_hermes_create` + wiring +
    /// drop, host install cached). Retained to make the cost of the required
    /// fresh-runtime lifecycle visible.
    pub vm_create_us: f64,
    /// A second steady-state sample of the ordinary finite-query invocation
    /// path. The field name is retained for benchmark JSON compatibility after
    /// DK-4 retirement; it now includes fresh runtime creation just like
    /// `vm_cost_us`.
    ///
    /// @ref LLP 0009#dk-4-retired--upstream-ibex-owner-thread-contract-2026-07-27 — compatibility metric.
    pub warm_invoke_us: f64,
    /// Single-writer throughput: sequential `createTodo` mutations per second.
    /// Because every mutation serializes on the global instance mutex, this is
    /// the single-writer breaking point.
    pub single_writer_mutations_per_sec: f64,
    /// Individually timed samples of the same warm single-writer fixture.
    pub single_writer_mutation_p50_us: f64,
    pub single_writer_mutation_p95_us: f64,
    /// Current-state storage reads over a fixed 512-row fixture. The point
    /// path is `LocalDatabase::get`, the range path is `scan_table(limit=50)`,
    /// and the query-plan path is `LocalDatabase::query(limit=50)`.
    pub current_point_read_p50_us: f64,
    pub current_point_read_p95_us: f64,
    pub current_range_read_p50_us: f64,
    pub current_range_read_p95_us: f64,
    pub current_query_plan_read_p50_us: f64,
    pub current_query_plan_read_p95_us: f64,
    /// Allocated database plus WAL growth for one fresh logical row/operation,
    /// and retained database growth after close/checkpoint. The dated artifact
    /// records this exact physical-size definition; it is not an OS I/O claim.
    pub allocated_write_bytes_per_changed_row: u64,
    pub allocated_write_bytes_per_operation: u64,
    pub retained_bytes_per_changed_row: u64,
    pub retained_bytes_per_operation: u64,
    /// Matcher cost per commit per subscription on the *skip* path: subscriptions
    /// watch a table the commit does not touch, so the matcher evaluates each and
    /// skips it (no re-query).
    pub matcher_skip_us_per_sub: f64,
    /// Full live-delivery cost per commit per *affected* subscription: re-run the
    /// query, serialize, enqueue. Drives the fan-out ceiling.
    pub fanout_us_per_affected_sub: f64,
    /// Derived fan-out ceiling: affected subscriptions one commit can fan out to
    /// within a 10 ms budget (`10 ms / fanout_us_per_affected_sub`).
    pub fanout_ceiling_subs_at_10ms: f64,
    /// **DK-3 / M3 projection.** Per affected subscription, the cost of the
    /// op-log-delta path for the analyzable subset: classify each committed
    /// `ChangedRow` against the subscription's captured predicate with the live
    /// matcher (no VM, no re-query) and serialize a small delta, instead of
    /// re-running the whole query. This is the lever the DK-3 revisit trigger
    /// names once warm VM (DK-4) makes the re-query cost row-bound.
    pub fanout_delta_us_per_affected_sub: f64,
    /// Derived: the op-log-delta fan-out ceiling within a 10 ms budget — the
    /// number the DK-3 revisit is decided against.
    pub fanout_delta_ceiling_subs_at_10ms: f64,
    /// Read-set validation cost per row dependency at commit.
    pub read_set_validation_us_per_dep: f64,
    /// Spurious-conflict rate: fraction of concurrent writers that DON'T match a
    /// filtered query's predicate yet conflict with a reader of that query. 1.0
    /// under table-granularity validation (every non-matching writer spuriously
    /// conflicts); 0.0 under E4's predicate-granularity validation.
    pub spurious_conflict_rate: f64,
    /// Ephemeral publish throughput (publishes/sec) and per-publish cost.
    pub ephemeral_publishes_per_sec: f64,
    pub ephemeral_publish_us: f64,
    /// Read latency while a synchronized writer holds the write lane, reading
    /// through the global mutex — the pre-L6 path, where every read queues.
    /// The hold interval is causally bounded by read-lane control work rather
    /// than a calibrated wall-clock delay.
    pub read_during_write_via_lock_us: f64,
    /// Mean read latency during the same synchronized hold through the L6 read
    /// lane (pooled WAL reader, pinned snapshot).
    pub read_during_write_via_read_lane_us: f64,
    /// Move 2 same-file helper sharing (LLP 0118 OQ1): per-invocation
    /// evaluation latency and memory for splice-emitted runtime modules under
    /// the fresh-per-invocation lifecycle, as a function of helper count and
    /// module size.
    pub helper_splice: HelperSpliceBench,
}

/// One fixed no-request observation for the step-0 idle guard. The dated
/// baseline runner records eleven independent five-second observations after
/// all active measurements finish.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleObservation {
    pub duration_ms: u64,
    pub cpu_user_us: u64,
    pub cpu_system_us: u64,
    pub output_block_operations: u64,
    pub resident_kb_before: f64,
    pub resident_kb_after: f64,
    pub database_family_bytes_before: u64,
    pub database_family_bytes_after: u64,
}

#[derive(Clone, Copy)]
struct ProcessUsage {
    user_us: u64,
    system_us: u64,
    output_blocks: u64,
}

/// The three helper-splice module shapes the OQ1 measurement compares. Each
/// variant computes the same civil-date result (the Streak Lab shape that
/// motivated the mechanism); only the module's splice factoring differs.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct HelperSpliceBench {
    /// The logic inlined in the handler expression — zero-helper emission,
    /// byte-identical to the v1 module shape.
    pub helper_free: HelperVariantBench,
    /// The same logic factored through one spliced sibling helper.
    pub one_helper: HelperVariantBench,
    /// A three-helper chain (helper-calls-helper), the deepest shape the
    /// same-file slice admits without cycles.
    pub three_helpers: HelperVariantBench,
}

/// Per-variant numbers: module size (the splice-duplication cost in artifact
/// bytes), per-invocation latency distribution over individually timed fresh
/// invocations, and the resident-memory delta across the timed loop (KiB via
/// `ps -o rss`; ~0 expected because every invocation drops its VM).
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct HelperVariantBench {
    pub module_bytes: usize,
    pub invoke_p50_us: f64,
    pub invoke_p95_us: f64,
    pub invoke_mean_us: f64,
    pub rss_delta_kb: f64,
}

// The helper-splice benchmark modules (LLP 0118 OQ1). Each is the exact
// byte shape `renderInlineOperationModule` emits for one operation: the v1
// registration line, then the operation's reachable-helper subset as hoisted
// function declarations in sorted-name order. All three compute the same
// civil-date record for `args.epochMs` so the latency comparison isolates the
// splice factoring, not the work.
const HELPER_FREE_MODULE: &str = r#"globalThis.__snapbackHandlers = { "helperFree": (async (ctx, args) => {
  const day = Math.floor(args.epochMs / 86400000);
  const z = day + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = m <= 2 ? yoe + era * 400 + 1 : yoe + era * 400;
  return [{ y: y, m: m, d: d }];
}) };
"#;

const HELPER_ONE_MODULE: &str = r#"globalThis.__snapbackHandlers = { "helperOne": (async (ctx, args) => {
  return [civilFromDay(Math.floor(args.epochMs / 86400000))];
}) };
function civilFromDay(day) {
  const z = day + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = m <= 2 ? yoe + era * 400 + 1 : yoe + era * 400;
  return { y: y, m: m, d: d };
}
"#;

const HELPER_THREE_MODULE: &str = r#"globalThis.__snapbackHandlers = { "helperThree": (async (ctx, args) => {
  return [streakKey(args.epochMs)];
}) };
function civilFromDay(day) {
  const z = day + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = m <= 2 ? yoe + era * 400 + 1 : yoe + era * 400;
  return { y: y, m: m, d: d };
}
function dayNumber(epochMs) {
  return Math.floor(epochMs / 86400000);
}
function streakKey(epochMs) {
  const civil = civilFromDay(dayNumber(epochMs));
  return { y: civil.y, m: civil.m, d: civil.d, key: String(civil.y) + "-" + String(civil.m) + "-" + String(civil.d) };
}
"#;

/// A fixed instant (2026-07-30T00:00:00Z-ish) so every variant computes the
/// same civil date and the cross-variant equality check is deterministic.
const HELPER_BENCH_EPOCH_MS: i64 = 1_785_456_000_000;

/// Run the whole harness and return the report.
pub fn run(config: &BenchConfig) -> crate::diagnostic::SnapbackResult<BenchReport> {
    run_with_active_covered_lane(config, false)
}

/// Run the fixed step-0 fixture with the ordinary mutation metric routed
/// through authenticated client-range issuance and an active coverage
/// manifest. The paired recorder is the only caller; this does not expose a
/// runtime profile toggle.
///
/// @ref LLP 0162#measurement-gate — comparable candidate evidence exercises
///   the active public covered lane.
pub fn run_agent_safe_active_covered(
    config: &BenchConfig,
) -> crate::diagnostic::SnapbackResult<BenchReport> {
    run_with_active_covered_lane(config, true)
}

fn run_with_active_covered_lane(
    config: &BenchConfig,
    active_covered_lane: bool,
) -> crate::diagnostic::SnapbackResult<BenchReport> {
    let vm_cost_us = measure_vm_cost(config)?;
    let vm_create_us = crate::runtime::bench_runtime_create_us(config.iterations);
    let warm_invoke_us = measure_warm_invoke(config)?;
    let single_writer = if active_covered_lane {
        measure_single_writer_active_covered(config)?
    } else {
        measure_single_writer(config)?
    };
    let current_reads = measure_current_reads(config)?;
    let write_bytes = if active_covered_lane {
        measure_write_bytes_active_covered()?
    } else {
        measure_write_bytes()?
    };
    let (matcher_skip_us_per_sub, fanout_us_per_affected_sub) = measure_fanout(config)?;
    let fanout_delta_us_per_affected_sub = measure_fanout_delta_projection(config);
    let read_set_validation_us_per_dep = measure_read_set_validation(config)?;
    let spurious_conflict_rate = measure_spurious_conflict(config)?;
    let (ephemeral_publishes_per_sec, ephemeral_publish_us) = measure_ephemeral(config)?;
    let (read_during_write_via_lock_us, read_during_write_via_read_lane_us) =
        measure_read_during_write()?;
    let helper_splice = measure_helper_splice(config)?;

    Ok(BenchReport {
        iterations: config.iterations,
        vm_cost_us,
        vm_create_us,
        warm_invoke_us,
        single_writer_mutations_per_sec: single_writer.mutations_per_sec,
        single_writer_mutation_p50_us: single_writer.p50_us,
        single_writer_mutation_p95_us: single_writer.p95_us,
        current_point_read_p50_us: current_reads.point_p50_us,
        current_point_read_p95_us: current_reads.point_p95_us,
        current_range_read_p50_us: current_reads.range_p50_us,
        current_range_read_p95_us: current_reads.range_p95_us,
        current_query_plan_read_p50_us: current_reads.query_plan_p50_us,
        current_query_plan_read_p95_us: current_reads.query_plan_p95_us,
        allocated_write_bytes_per_changed_row: write_bytes.allocated,
        allocated_write_bytes_per_operation: write_bytes.allocated,
        retained_bytes_per_changed_row: write_bytes.retained,
        retained_bytes_per_operation: write_bytes.retained,
        matcher_skip_us_per_sub,
        fanout_us_per_affected_sub,
        fanout_ceiling_subs_at_10ms: if fanout_us_per_affected_sub > 0.0 {
            10_000.0 / fanout_us_per_affected_sub
        } else {
            f64::INFINITY
        },
        fanout_delta_us_per_affected_sub,
        fanout_delta_ceiling_subs_at_10ms: if fanout_delta_us_per_affected_sub > 0.0 {
            10_000.0 / fanout_delta_us_per_affected_sub
        } else {
            f64::INFINITY
        },
        read_set_validation_us_per_dep,
        spurious_conflict_rate,
        ephemeral_publishes_per_sec,
        ephemeral_publish_us,
        read_during_write_via_lock_us,
        read_during_write_via_read_lane_us,
        helper_splice,
    })
}

pub(crate) fn configured() -> crate::diagnostic::SnapbackResult<LocalSnapback> {
    let mut snapback = LocalSnapback::memory()?;
    snapback.apply_schema(schema())?;
    snapback.load_functions(functions());
    Ok(snapback)
}

/// File-backed acceptance twin for the agent-safe active-lane byte and idle
/// observations. Unlike the feature-gated telemetry fixture (which lives with
/// the phase-1 evidence harness and shares `crate::bench_fixture`), this is
/// compiled only as a private input to the dated paired recorder.
fn configured_file_agent_safe(
    path: impl AsRef<std::path::Path>,
) -> crate::diagnostic::SnapbackResult<LocalSnapback> {
    let mut snapback = LocalSnapback::open(path)?;
    snapback.apply_schema(schema())?;
    snapback.load_functions(functions());
    Ok(snapback)
}

fn open_configured_file_agent_safe(
    path: impl AsRef<Path>,
) -> crate::diagnostic::SnapbackResult<LocalSnapback> {
    let mut snapback = LocalSnapback::open(path)?;
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
pub struct AgentSafeActiveContentionWriter {
    snapback: LocalSnapback,
    range: crate::commit_envelope::ClientIdentityRangeV1,
    next_counter: u64,
}

/// Create the shared production-shaped database and return its server-owned
/// canonical stream. Reservation admission and the writer transaction compare
/// this exact durable identity; the recorder never substitutes `"canonical"`.
pub fn prepare_agent_safe_active_contention_database(
    path: impl AsRef<Path>,
) -> crate::diagnostic::SnapbackResult<String> {
    let mut snapback = configured_file_agent_safe(path)?;
    let (stream_id, _) = snapback.prepare_agent_safe_active_lane_benchmark_for_client(
        &args(json!({ "title": "contention setup" })),
        "agent-safe-contention-setup",
    )?;
    Ok(stream_id)
}

impl AgentSafeActiveContentionWriter {
    pub fn open(
        path: impl AsRef<Path>,
        worker: usize,
        expected_stream_id: &str,
    ) -> crate::diagnostic::SnapbackResult<Self> {
        let mut snapback = open_configured_file_agent_safe(path)?;
        let client_audience_id = format!("agent-safe-contention-worker-{worker}");
        let (stream_id, range) = snapback.prepare_agent_safe_active_lane_benchmark_for_client(
            &args(json!({ "title": "contention writer setup" })),
            &client_audience_id,
        )?;
        if stream_id != expected_stream_id {
            return Err(crate::diagnostic::SnapbackError::error(
                "SNAPBACK_BENCH_STREAM_DIVERGED",
                "bench",
                "concurrent ordinary writer reopened on a different canonical stream",
            ));
        }
        let next_counter = range.range_start;
        Ok(Self {
            snapback,
            range,
            next_counter,
        })
    }

    pub fn commit_next(
        &mut self,
        worker: usize,
        ordinal: usize,
    ) -> crate::diagnostic::SnapbackResult<()> {
        let counter = self.next_counter;
        self.snapback
            .invoke_agent_safe_active_lane_benchmark_mutation(
                "createTodo",
                args(json!({
                    "title": format!("contention-{worker}-{ordinal}")
                })),
                &self.range,
                counter,
            )?;
        self.next_counter = self.next_counter.checked_add(1).ok_or_else(|| {
            crate::diagnostic::SnapbackError::error(
                "SNAPBACK_BENCH_RANGE_EXHAUSTED",
                "bench",
                "contention benchmark counter overflowed",
            )
        })?;
        Ok(())
    }
}

fn measure_vm_cost(config: &BenchConfig) -> crate::diagnostic::SnapbackResult<f64> {
    let snapback = configured()?;
    // This metric is defined as the fresh per-invocation cost.
    snapback.set_warm_vms_enabled(false);
    // Warm up (first eval pays one-time costs the steady state should not).
    for _ in 0..4 {
        snapback.invoke_query("noop", args(json!({})))?;
    }
    let start = Instant::now();
    for _ in 0..config.iterations {
        snapback.invoke_query("noop", args(json!({})))?;
    }
    Ok(micros_per(start, config.iterations))
}

/// Compatibility sample for the former DK-4 metric. Current Ibex requires
/// owner-thread-affine runtimes, so this measures the same fresh-runtime
/// finite-query path without forcing any lifecycle toggle.
fn measure_warm_invoke(config: &BenchConfig) -> crate::diagnostic::SnapbackResult<f64> {
    let snapback = configured()?;
    for _ in 0..4 {
        snapback.invoke_query("noop", args(json!({})))?;
    }
    let start = Instant::now();
    for _ in 0..config.iterations {
        snapback.invoke_query("noop", args(json!({})))?;
    }
    Ok(micros_per(start, config.iterations))
}

struct SingleWriterBench {
    mutations_per_sec: f64,
    p50_us: f64,
    p95_us: f64,
}

struct CurrentReadBench {
    point_p50_us: f64,
    point_p95_us: f64,
    range_p50_us: f64,
    range_p95_us: f64,
    query_plan_p50_us: f64,
    query_plan_p95_us: f64,
}

struct WriteBytesBench {
    allocated: u64,
    retained: u64,
}

fn measure_single_writer(
    config: &BenchConfig,
) -> crate::diagnostic::SnapbackResult<SingleWriterBench> {
    let mut snapback = configured()?;
    for _ in 0..4 {
        snapback.invoke_mutation("createTodo", args(json!({ "title": "warm" })))?;
    }
    let mut samples = Vec::with_capacity(config.iterations);
    for n in 0..config.iterations {
        let start = Instant::now();
        snapback.invoke_mutation("createTodo", args(json!({ "title": n.to_string() })))?;
        samples.push(start.elapsed().as_secs_f64() * 1_000_000.0);
    }
    let elapsed_us = samples.iter().sum::<f64>();
    samples.sort_by(|left, right| left.total_cmp(right));
    Ok(SingleWriterBench {
        mutations_per_sec: if elapsed_us > 0.0 {
            config.iterations as f64 * 1_000_000.0 / elapsed_us
        } else {
            f64::INFINITY
        },
        p50_us: percentile_sorted(&samples, 0.50),
        p95_us: percentile_sorted(&samples, 0.95),
    })
}

fn measure_single_writer_active_covered(
    config: &BenchConfig,
) -> crate::diagnostic::SnapbackResult<SingleWriterBench> {
    let mut snapback = configured()?;
    let input = args(json!({ "title": "warm" }));
    let range = snapback.prepare_agent_safe_active_lane_benchmark(&input)?;
    let mut counter = range.range_start;
    for _ in 0..4 {
        snapback.invoke_agent_safe_active_lane_benchmark_mutation(
            "createTodo",
            input.clone(),
            &range,
            counter,
        )?;
        counter += 1;
    }
    let mut samples = Vec::with_capacity(config.iterations);
    for n in 0..config.iterations {
        let started = Instant::now();
        snapback.invoke_agent_safe_active_lane_benchmark_mutation(
            "createTodo",
            args(json!({ "title": n.to_string() })),
            &range,
            counter,
        )?;
        samples.push(started.elapsed().as_secs_f64() * 1_000_000.0);
        counter += 1;
    }
    let elapsed_us = samples.iter().sum::<f64>();
    samples.sort_by(|left, right| left.total_cmp(right));
    Ok(SingleWriterBench {
        mutations_per_sec: if elapsed_us > 0.0 {
            config.iterations as f64 * 1_000_000.0 / elapsed_us
        } else {
            f64::INFINITY
        },
        p50_us: percentile_sorted(&samples, 0.50),
        p95_us: percentile_sorted(&samples, 0.95),
    })
}

fn measure_current_reads(
    config: &BenchConfig,
) -> crate::diagnostic::SnapbackResult<CurrentReadBench> {
    let mut database = LocalDatabase::memory()?;
    database.schema_seed().apply_schema(schema())?;
    let writes = (0..512)
        .map(|index| BufferedWrite::Insert {
            table: "todos".to_owned(),
            id: format!("bench-read-{index:04}"),
            values: serde_json::Map::from_iter([
                ("title".to_owned(), json!(format!("todo-{index:04}"))),
                ("done".to_owned(), json!(false)),
            ]),
        })
        .collect();
    database.mutation_writes().commit_buffered_writes(
        &HandlerInput::default(),
        writes,
        Vec::new(),
        Value::Null,
    )?;

    let plan = QueryPlan {
        table_visibility: None,
        table: "todos".to_owned(),
        filters: Vec::new(),
        membership_filters: Vec::new(),
        order: Vec::new(),
        limit: Some(50),
        indexed_by: None,
    };
    for _ in 0..4 {
        database
            .query_reads_read()
            .get("todos", "bench-read-0256")?;
        database.query_reads_read().scan_table("todos", 50, 200)?;
        database
            .query_reads_read()
            .query(&plan, &HandlerInput::default())?;
    }

    let mut point = Vec::with_capacity(config.iterations);
    let mut range = Vec::with_capacity(config.iterations);
    let mut query_plan = Vec::with_capacity(config.iterations);
    for _ in 0..config.iterations {
        let started = Instant::now();
        database
            .query_reads_read()
            .get("todos", "bench-read-0256")?;
        point.push(started.elapsed().as_secs_f64() * 1_000_000.0);

        let started = Instant::now();
        database.query_reads_read().scan_table("todos", 50, 200)?;
        range.push(started.elapsed().as_secs_f64() * 1_000_000.0);

        let started = Instant::now();
        database
            .query_reads_read()
            .query(&plan, &HandlerInput::default())?;
        query_plan.push(started.elapsed().as_secs_f64() * 1_000_000.0);
    }
    point.sort_by(|left, right| left.total_cmp(right));
    range.sort_by(|left, right| left.total_cmp(right));
    query_plan.sort_by(|left, right| left.total_cmp(right));
    Ok(CurrentReadBench {
        point_p50_us: percentile_sorted(&point, 0.50),
        point_p95_us: percentile_sorted(&point, 0.95),
        range_p50_us: percentile_sorted(&range, 0.50),
        range_p95_us: percentile_sorted(&range, 0.95),
        query_plan_p50_us: percentile_sorted(&query_plan, 0.50),
        query_plan_p95_us: percentile_sorted(&query_plan, 0.95),
    })
}

fn measure_write_bytes() -> crate::diagnostic::SnapbackResult<WriteBytesBench> {
    let directory = std::env::temp_dir().join(format!(
        "snapback-agent-safe-step0-write-{}",
        uuid::Uuid::now_v7()
    ));
    std::fs::create_dir(&directory).map_err(bench_io_error)?;
    let path = directory.join("fixture.sqlite3");
    let result = (|| {
        let mut database = LocalDatabase::open(&path)?;
        database.schema_seed().apply_schema(schema())?;
        drop(database);
        let before = file_family_bytes(&path)?;

        let mut database = LocalDatabase::open(&path)?;
        database.mutation_writes().commit_buffered_writes(
            &HandlerInput::default(),
            vec![BufferedWrite::Insert {
                table: "todos".to_owned(),
                id: "bench-write-0001".to_owned(),
                values: serde_json::Map::from_iter([
                    ("title".to_owned(), json!("step-0 write amplification")),
                    ("done".to_owned(), json!(false)),
                ]),
            }],
            Vec::new(),
            Value::Null,
        )?;
        let during = file_family_bytes(&path)?;
        drop(database);
        let after = file_family_bytes(&path)?;
        Ok(WriteBytesBench {
            allocated: during.saturating_sub(before),
            retained: after.saturating_sub(before),
        })
    })();
    let _ = std::fs::remove_dir_all(&directory);
    result
}

fn measure_write_bytes_active_covered() -> crate::diagnostic::SnapbackResult<WriteBytesBench> {
    let directory = std::env::temp_dir().join(format!(
        "snapback-agent-safe-active-write-{}",
        uuid::Uuid::now_v7()
    ));
    std::fs::create_dir(&directory).map_err(bench_io_error)?;
    let path = directory.join("fixture.sqlite3");
    let result = (|| {
        let mut snapback = configured_file_agent_safe(&path)?;
        let input = args(json!({ "title": "agent-safe active write amplification" }));
        let range = snapback.prepare_agent_safe_active_lane_benchmark(&input)?;
        let before = file_family_bytes(&path)?;
        snapback.invoke_agent_safe_active_lane_benchmark_mutation(
            "createTodo",
            input,
            &range,
            range.range_start,
        )?;
        let during = file_family_bytes(&path)?;
        drop(snapback);
        let after = file_family_bytes(&path)?;
        Ok(WriteBytesBench {
            allocated: during.saturating_sub(before),
            retained: after.saturating_sub(before),
        })
    })();
    let _ = std::fs::remove_dir_all(&directory);
    result
}

fn file_family_bytes(path: &std::path::Path) -> crate::diagnostic::SnapbackResult<u64> {
    let mut total = std::fs::metadata(path)
        .map(|metadata| metadata.len())
        .map_err(bench_io_error)?;
    for suffix in ["-wal", "-shm"] {
        let mut sidecar = path.as_os_str().to_owned();
        sidecar.push(suffix);
        if let Ok(metadata) = std::fs::metadata(std::path::PathBuf::from(sidecar)) {
            total = total.saturating_add(metadata.len());
        }
    }
    Ok(total)
}

pub fn measure_idle(duration: Duration) -> crate::diagnostic::SnapbackResult<IdleObservation> {
    let directory = std::env::temp_dir().join(format!(
        "snapback-agent-safe-step0-idle-{}",
        uuid::Uuid::now_v7()
    ));
    std::fs::create_dir(&directory).map_err(bench_io_error)?;
    let path = directory.join("fixture.sqlite3");
    let result = (|| {
        let mut database = LocalDatabase::open(&path)?;
        database.schema_seed().apply_schema(schema())?;
        let database_family_bytes_before = file_family_bytes(&path)?;
        let resident_kb_before = resident_kb();
        let usage_before = process_usage()?;
        std::thread::sleep(duration);
        let usage_after = process_usage()?;
        let resident_kb_after = resident_kb();
        let database_family_bytes_after = file_family_bytes(&path)?;
        drop(database);
        Ok(IdleObservation {
            duration_ms: duration.as_millis().try_into().unwrap_or(u64::MAX),
            cpu_user_us: usage_after.user_us.saturating_sub(usage_before.user_us),
            cpu_system_us: usage_after.system_us.saturating_sub(usage_before.system_us),
            output_block_operations: usage_after
                .output_blocks
                .saturating_sub(usage_before.output_blocks),
            resident_kb_before,
            resident_kb_after,
            database_family_bytes_before,
            database_family_bytes_after,
        })
    })();
    let _ = std::fs::remove_dir_all(&directory);
    result
}

/// Observe an otherwise-idle file-backed instance after the agent-safe public
/// carrier has installed real ordinary-mutation coverage and a server-issued
/// finite client range. The range and coverage state stay live for the entire
/// interval; setup work is outside the observation window.
///
/// @ref LLP 0162#measurement-gate — idle evidence must measure the active
///   profile, not a dormant manifest or a runtime profile toggle.
pub fn measure_idle_agent_safe_active_covered(
    duration: Duration,
) -> crate::diagnostic::SnapbackResult<IdleObservation> {
    let directory = std::env::temp_dir().join(format!(
        "snapback-agent-safe-active-idle-{}",
        uuid::Uuid::now_v7()
    ));
    std::fs::create_dir(&directory).map_err(bench_io_error)?;
    let path = directory.join("fixture.sqlite3");
    let result = (|| {
        let mut snapback = configured_file_agent_safe(&path)?;
        let input = args(json!({ "title": "agent-safe active idle fixture" }));
        let range = snapback.prepare_agent_safe_active_lane_benchmark(&input)?;
        // Range issuance and coverage activation above are the production
        // setup being qualified. Consume the carrier before sampling so its
        // asynchronous telemetry flush cannot leak setup CPU/RSS into the
        // otherwise-idle storage interval. The returned connection remains
        // armed with the exact durable coverage manifest.
        let database = snapback.into_agent_safe_active_idle_database();
        let database_family_bytes_before = file_family_bytes(&path)?;
        let resident_kb_before = resident_kb();
        let usage_before = process_usage()?;
        std::thread::sleep(duration);
        let usage_after = process_usage()?;
        let resident_kb_after = resident_kb();
        let database_family_bytes_after = file_family_bytes(&path)?;
        std::hint::black_box((&database, &range));
        drop(database);
        Ok(IdleObservation {
            duration_ms: duration.as_millis().try_into().unwrap_or(u64::MAX),
            cpu_user_us: usage_after.user_us.saturating_sub(usage_before.user_us),
            cpu_system_us: usage_after.system_us.saturating_sub(usage_before.system_us),
            output_block_operations: usage_after
                .output_blocks
                .saturating_sub(usage_before.output_blocks),
            resident_kb_before,
            resident_kb_after,
            database_family_bytes_before,
            database_family_bytes_after,
        })
    })();
    let _ = std::fs::remove_dir_all(&directory);
    result
}

fn process_usage() -> crate::diagnostic::SnapbackResult<ProcessUsage> {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
    // SAFETY: `getrusage` initializes the caller-owned structure on success.
    let status = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) };
    if status != 0 {
        return Err(crate::diagnostic::SnapbackError::error(
            "SNAPBACK_BENCH_PROCESS_USAGE_UNAVAILABLE",
            "bench",
            std::io::Error::last_os_error().to_string(),
        ));
    }
    // SAFETY: the successful call above initialized every field.
    let usage = unsafe { usage.assume_init() };
    let micros = |value: libc::timeval| {
        (value.tv_sec.max(0) as u64)
            .saturating_mul(1_000_000)
            .saturating_add(value.tv_usec.max(0) as u64)
    };
    Ok(ProcessUsage {
        user_us: micros(usage.ru_utime),
        system_us: micros(usage.ru_stime),
        output_blocks: usage.ru_oublock.max(0) as u64,
    })
}

fn bench_io_error(error: std::io::Error) -> crate::diagnostic::SnapbackError {
    crate::diagnostic::SnapbackError::error("SNAPBACK_BENCH_IO_FAILED", "bench", error.to_string())
}

fn measure_fanout(config: &BenchConfig) -> crate::diagnostic::SnapbackResult<(f64, f64)> {
    // Skip path: subscriptions watch `todos`, but we commit to `others`, so the
    // matcher evaluates each subscription and skips it (not affected).
    let mut skip = configured()?;
    for i in 0..config.subscriptions {
        skip.subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: format!("skip-{i}"),
                input: args(json!({})),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )?;
    }
    let start = Instant::now();
    for n in 0..config.iterations {
        skip.invoke_mutation("createOther", args(json!({ "label": n.to_string() })))?;
    }
    let skip_per_commit = micros_per(start, config.iterations);
    // Subtract the baseline single-commit cost measured with no subscriptions.
    let baseline = single_commit_baseline(config, "createOther", "label")?;
    let matcher_skip_us_per_sub =
        ((skip_per_commit - baseline).max(0.0)) / config.subscriptions.max(1) as f64;

    // Full path: subscriptions watch `todos` and we commit to `todos`, so every
    // subscription is affected (re-query + serialize + enqueue). Keep the
    // result set fixed across iterations: this metric is fan-out cost at a
    // stated result size, not "query N growing rows".
    let mut affected = configured()?;
    let affected_ids = seed_fanout_todos(&mut affected)?;
    for i in 0..config.subscriptions {
        affected.subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: format!("aff-{i}"),
                input: args(json!({})),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )?;
    }
    let start = Instant::now();
    for n in 0..config.iterations {
        let id = &affected_ids[n % affected_ids.len()];
        affected.invoke_mutation(
            "touchTodo",
            args(json!({ "id": id, "title": format!("fanout-{n}") })),
        )?;
        // Drain so outboxes do not grow unbounded and skew later commits.
        for i in 0..config.subscriptions {
            affected.drain_outbox(&format!("aff-{i}"));
        }
    }
    let affected_per_commit = micros_per(start, config.iterations);
    let baseline_todos = single_touch_baseline(config)?;
    let fanout_us_per_affected_sub =
        ((affected_per_commit - baseline_todos).max(0.0)) / config.subscriptions.max(1) as f64;

    Ok((matcher_skip_us_per_sub, fanout_us_per_affected_sub))
}

/// DK-3 / M3: the projected op-log-delta cost per affected subscription for the
/// analyzable subset (single-table filtered query — the syncable-live subset of
/// LLP 0008 §Reactivity). Today's fan-out re-runs the protected live query in a
/// fresh realm per affected subscription (`fanout_us_per_affected_sub`); an
/// op-log delta instead classifies each committed `ChangedRow` against the
/// subscription's captured predicate with the live matcher — no VM, no
/// re-query — and ships just the changed rows. This measures that
/// classify+serialize cost using the real matcher
/// (`row_matches_query_filters`), so the number is a faithful
/// projection of the server-side delta cost, not a stub.
///
/// Scenario: a filtered live query (`todos WHERE userId = <sub>`), a commit of
/// one changed row, evaluated per affected subscription. Ordered/limited
/// queries carry extra boundary work (the matcher already has the primitives);
/// this measures the common unordered-filter case the trigger is decided on.
///
/// @ref LLP 0008#decision-dk-3--delta-shape-and-read-lane-2026-07-01 — the
/// op-log-delta lever, gated on this post-DK-4 re-measurement (the named
/// revisit trigger, which this M3 measurement fires).
fn measure_fanout_delta_projection(config: &BenchConfig) -> f64 {
    use crate::storage::{ChangeOp, ChangedRow};

    // The analyzable predicate a syncable-live subscription captures.
    let plan = QueryPlan {
        table_visibility: None,
        table: "todos".to_owned(),
        filters: vec![FilterExpr {
            field: "userId".to_owned(),
            op: FilterOp::Eq,
            value: ValueExpr::Arg("userId".to_owned()),
        }],
        membership_filters: Vec::new(),
        order: Vec::new(),
        limit: None,
        indexed_by: None,
    };
    // One committed insert — the row that fans out.
    let change = ChangedRow {
        table: "todos".to_owned(),
        id: "todo_bench".to_owned(),
        op: ChangeOp::Insert,
        row: Some(json!({
            "_id": "todo_bench",
            "_version": 1,
            "title": "delta bench",
            "done": false,
            "userId": "u-match",
        })),
        changed_fields: Vec::new(),
    };
    let changes = [change];

    // Warm up the matcher + serializer paths.
    for _ in 0..4 {
        delta_fanout_round(&plan, &changes, config.subscriptions);
    }
    let start = Instant::now();
    for _ in 0..config.iterations {
        delta_fanout_round(&plan, &changes, config.subscriptions);
    }
    let per_commit = micros_per(start, config.iterations);
    per_commit / config.subscriptions.max(1) as f64
}

/// One commit's worth of op-log-delta fan-out over `subscriptions` affected
/// subscribers: per subscriber, run the **real** delta core
/// (`compute_live_delta`) to classify the commit against the subscription's
/// predicate, then serialize the resulting `live_delta` payload. Using the
/// production function (not a bench replica) makes the M3 projection a
/// faithful measurement of the shipped server cost. `black_box` keeps the
/// optimizer from eliding the work.
fn delta_fanout_round(
    plan: &QueryPlan,
    changes: &[crate::storage::ChangedRow],
    subscriptions: usize,
) {
    use crate::live_matcher::{LiveDeltaKind, LiveDeltaOutcome, compute_live_delta};
    use std::collections::BTreeSet;

    // The metric is explicitly per affected subscriber, so every subscriber
    // uses the matching predicate. Non-member reject cost is covered by the
    // skip-path matcher metric above; mixing it in here would understate the
    // affected delivery cost and overstate the derived fan-out ceiling.
    let prior_ids: BTreeSet<String> = BTreeSet::new();
    for _ in 0..subscriptions {
        let input = args(json!({ "userId": "u-match" }));
        let ops = match compute_live_delta(plan, &input, &prior_ids, changes) {
            LiveDeltaOutcome::Delta(ops) => ops,
            LiveDeltaOutcome::Replace => Vec::new(),
        };
        // Serialize the `live_delta` payload the subscriber would receive
        // (empty when the commit does not affect this subscriber — still a
        // real classify through the production core).
        let deltas: Vec<Value> = ops
            .iter()
            .map(|op| {
                let kind = match op.kind {
                    LiveDeltaKind::Add => "add",
                    LiveDeltaKind::Update => "update",
                    LiveDeltaKind::Remove => "remove",
                };
                json!({ "op": kind, "id": op.id, "row": op.row })
            })
            .collect();
        let payload = json!({ "kind": "live_delta", "version": 1, "deltas": deltas });
        let encoded = serde_json::to_vec(&payload).unwrap_or_default();
        std::hint::black_box(&encoded);
    }
}

const FANOUT_RESULT_ROWS: usize = 16;

fn seed_fanout_todos(
    snapback: &mut LocalSnapback,
) -> crate::diagnostic::SnapbackResult<Vec<String>> {
    let mut ids = Vec::with_capacity(FANOUT_RESULT_ROWS);
    for n in 0..FANOUT_RESULT_ROWS {
        let commit = snapback
            .invoke_mutation("createTodo", args(json!({ "title": format!("seed-{n}") })))?;
        if let Some(id) = commit.result.as_str() {
            ids.push(id.to_owned());
        }
    }
    Ok(ids)
}

fn single_touch_baseline(config: &BenchConfig) -> crate::diagnostic::SnapbackResult<f64> {
    let mut snapback = configured()?;
    let ids = seed_fanout_todos(&mut snapback)?;
    for n in 0..4 {
        let id = &ids[n % ids.len()];
        snapback.invoke_mutation(
            "touchTodo",
            args(json!({ "id": id, "title": format!("warm-{n}") })),
        )?;
    }
    let start = Instant::now();
    for n in 0..config.iterations {
        let id = &ids[n % ids.len()];
        snapback.invoke_mutation(
            "touchTodo",
            args(json!({ "id": id, "title": format!("baseline-{n}") })),
        )?;
    }
    Ok(micros_per(start, config.iterations))
}

fn single_commit_baseline(
    config: &BenchConfig,
    mutation: &str,
    field: &str,
) -> crate::diagnostic::SnapbackResult<f64> {
    let mut snapback = configured()?;
    for _ in 0..4 {
        snapback.invoke_mutation(mutation, args(json!({ field: "warm" })))?;
    }
    let start = Instant::now();
    for n in 0..config.iterations {
        snapback.invoke_mutation(mutation, args(json!({ field: n.to_string() })))?;
    }
    Ok(micros_per(start, config.iterations))
}

fn measure_read_set_validation(config: &BenchConfig) -> crate::diagnostic::SnapbackResult<f64> {
    let mut snapback = configured()?;
    // Seed rows and capture each one's current version for a matching read-set.
    let mut deps = Vec::new();
    for n in 0..config.read_set_size {
        let commit =
            snapback.invoke_mutation("createTodo", args(json!({ "title": n.to_string() })))?;
        let id = commit.result.as_str().unwrap_or_default().to_owned();
        deps.push(ReadDependency {
            table: "todos".to_owned(),
            id,
            version: commit.version,
        });
    }
    let with_read_set = |title: &str, read_set: Vec<ReadDependency>| HandlerInput {
        correlation: None,
        ctx_ledger: None,
        args: json!({ "title": title }),
        auth: auth(),
        read_set,
    };
    // Warm up.
    for _ in 0..4 {
        snapback.invoke_mutation("createTodo", with_read_set("warm", deps.clone()))?;
    }
    let start = Instant::now();
    for n in 0..config.iterations {
        snapback.invoke_mutation("createTodo", with_read_set(&n.to_string(), deps.clone()))?;
    }
    let with = micros_per(start, config.iterations);
    // Baseline: same mutation with an empty read-set.
    let start = Instant::now();
    for n in 0..config.iterations {
        snapback.invoke_mutation("createTodo", args(json!({ "title": n.to_string() })))?;
    }
    let without = micros_per(start, config.iterations);
    Ok(((with - without).max(0.0)) / config.read_set_size.max(1) as f64)
}

fn measure_spurious_conflict(config: &BenchConfig) -> crate::diagnostic::SnapbackResult<f64> {
    // The current model serializes mutations under the global mutex, so
    // concurrent writers never actually interleave in normal operation. To
    // measure the property E4 targets, we simulate the interleaving at the
    // storage layer: a reader captures a *filtered* query read of `todos`
    // (`done = true`) at version V; a concurrent, **non-matching** write commits
    // (`done = false`, bumping the table version); then the reader validates a
    // second write carrying the V read. Under table-granularity validation this
    // conflicts every time (rate 1.0); under E4's predicate-granularity
    // validation the non-matching write does not affect the query, so the rate
    // drops to 0.0.
    let filtered_query = || {
        serde_json::to_value(QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: vec![FilterExpr {
                field: "done".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Literal(json!(true)),
            }],
            membership_filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            indexed_by: None,
        })
        .unwrap_or(Value::Null)
    };
    let mut conflicts = 0usize;
    for trial in 0..config.conflict_trials {
        let mut db = LocalDatabase::memory()?;
        db.schema_seed().apply_schema(schema())?;
        commit_insert(&mut db, "todos", json!({ "title": "match", "done": true }))?;

        let captured_version = db.versions_read().table_change_version("todos")?;
        let query_read = CapturedReadDependency {
            kind: CapturedReadKind::Query,
            table: Some("todos".to_owned()),
            id: None,
            version: Some(captured_version),
            predicate: Some(filtered_query()),
            rows: Vec::new(),
            field: None,
            value: None,
            order: None,
            limit: None,
            result_count: Some(1),
            boundary: None,
        };

        // Concurrent writer inserts a row that does NOT match `done = true`.
        commit_insert(
            &mut db,
            "todos",
            json!({ "title": format!("other-{trial}"), "done": false }),
        )?;

        let input = HandlerInput {
            args: json!({}),
            auth: auth(),
            read_set: Vec::new(),
            correlation: None,
            ctx_ledger: None,
        };
        let row_id = db.generate_id();
        let result = db.mutation_writes().commit_buffered_writes(
            &input,
            vec![BufferedWrite::Insert {
                table: "todos".to_owned(),
                id: row_id,
                values: json!({ "title": format!("reader-{trial}"), "done": false })
                    .as_object()
                    .cloned()
                    .unwrap_or_default(),
            }],
            vec![query_read],
            Value::Null,
        );
        if let Err(error) = result
            && error.diagnostic.code == "SNAPBACK_MUTATION_CONFLICT"
        {
            conflicts += 1;
        }
    }
    Ok(conflicts as f64 / config.conflict_trials.max(1) as f64)
}

fn commit_insert(
    db: &mut LocalDatabase,
    table: &str,
    values: Value,
) -> crate::diagnostic::SnapbackResult<()> {
    let input = HandlerInput {
        args: json!({}),
        auth: auth(),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    };
    let row_id = db.generate_id();
    db.mutation_writes().commit_buffered_writes(
        &input,
        vec![BufferedWrite::Insert {
            table: table.to_owned(),
            id: row_id,
            values: values.as_object().cloned().unwrap_or_default(),
        }],
        Vec::new(),
        Value::Null,
    )?;
    Ok(())
}

fn measure_ephemeral(config: &BenchConfig) -> crate::diagnostic::SnapbackResult<(f64, f64)> {
    let mut snapback = LocalSnapback::memory()?;
    // Raise the rate limit far above the measurement rate: we are measuring raw
    // per-publish cost, not the throttle policy (whose 20 Hz default the
    // 20–60 Hz cursor target sits under).
    let mut collection = EphemeralCollection::local_cursor("cursors", "roomId");
    collection.sustained_hz = 10_000_000;
    collection.burst = 10_000_000;
    snapback
        .register_ephemeral_collection(collection)
        .expect("valid benchmark ephemeral collection");
    let scope = Scope::from_pairs([("roomId", "room-1")]);
    // A few subscribers so publishes fan out.
    for i in 0..4 {
        snapback
            .subscribe_ephemeral(
                SubscribeRequest {
                    collection: "cursors".to_owned(),
                    scope: scope.clone(),
                    connection_id: format!("watcher-{i}"),
                    auth: AuthContext::default(),
                    since_chunk: None,
                },
                1_000,
            )
            .map_err(ephemeral_err)?;
    }
    let publish = |connection: &str, value: Vec<u8>| PublishRequest {
        collection: "cursors".to_owned(),
        scope: scope.clone(),
        connection_id: connection.to_owned(),
        session_id: None,
        user_id: None,
        custom_key: None,
        value,
        ttl_ms: None,
        auth: AuthContext::default(),
    };
    // Warm up.
    for n in 0..4u64 {
        snapback
            .publish_ephemeral(publish("pub", b"warm".to_vec()), 2_000 + n)
            .map_err(ephemeral_err)?;
    }
    let start = Instant::now();
    for n in 0..config.ephemeral_publishes as u64 {
        let now = 3_000 + n;
        snapback
            .publish_ephemeral(publish("pub", n.to_le_bytes().to_vec()), now)
            .map_err(ephemeral_err)?;
    }
    let publish_us = micros_per(start, config.ephemeral_publishes);
    let per_sec = if publish_us > 0.0 {
        1_000_000.0 / publish_us
    } else {
        f64::INFINITY
    };
    Ok((per_sec, publish_us))
}

/// The L6 before/after A/B on one build. A writer acquires the global instance
/// mutex, signals that acquisition, and holds it across a causally synchronized
/// interval. A global-mutex reader begins waiting before four read-lane control
/// queries run; only then is the writer released to commit. The global reader's
/// timer therefore encloses the same work whose per-query mean is reported for
/// the read lane. This proves the queueing topology without sleeps, calibrated
/// spin loops, or machine-dependent absolute timing. File-backed database: the
/// read lane requires WAL.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6.
fn measure_read_during_write() -> crate::diagnostic::SnapbackResult<(f64, f64)> {
    let dir = std::env::temp_dir().join(format!(
        "snapback-bench-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).map_err(|error| {
        crate::diagnostic::SnapbackError::error(
            "SNAPBACK_BENCH_TEMPDIR",
            "bench",
            format!("bench tempdir could not be created: {error}"),
        )
    })?;
    let result = measure_read_during_write_at(&dir.join("bench.sqlite3"));
    let _ = std::fs::remove_dir_all(&dir);
    result
}

fn measure_read_during_write_at(
    path: &std::path::Path,
) -> crate::diagnostic::SnapbackResult<(f64, f64)> {
    let mut snapback = LocalSnapback::open(path)?;
    snapback.apply_schema(schema())?;
    snapback.load_functions(functions());
    snapback.invoke_mutation("createTodo", args(json!({ "title": "seed" })))?;
    // Warm the reader-pool connection and the query path.
    let lane = snapback.read_lane();
    lane.invoke_query("listTodos", args(json!({})))?;

    let shared = std::sync::Arc::new(std::sync::Mutex::new(snapback));
    let (writer_acquired_tx, writer_acquired_rx) = std::sync::mpsc::sync_channel(0);
    let (release_writer_tx, release_writer_rx) = std::sync::mpsc::sync_channel(0);
    let writer_shared = shared.clone();
    let writer = std::thread::spawn(move || {
        let mut snapback = writer_shared.lock().expect("bench writer lock");
        writer_acquired_tx
            .send(())
            .expect("bench writer-acquired signal");
        release_writer_rx
            .recv()
            .expect("bench writer-release signal");
        snapback
            .invoke_mutation("createTodo", args(json!({ "title": "held-writer" })))
            .expect("bench synchronized mutation");
    });
    writer_acquired_rx
        .recv()
        .expect("bench writer-acquired acknowledgement");

    // Start the pre-L6 reader while the writer definitely owns the mutex. The
    // rendezvous send happens after its timer starts and before it attempts the
    // lock, so everything the main thread does after `recv` is causally inside
    // the reader's queued interval.
    let (reader_ready_tx, reader_ready_rx) = std::sync::mpsc::sync_channel(0);
    let reader_shared = shared.clone();
    let queued_reader = std::thread::spawn(move || {
        let start = Instant::now();
        reader_ready_tx
            .send(())
            .expect("bench queued-reader signal");
        let snapback = reader_shared.lock().expect("bench reader lock");
        snapback
            .invoke_query("listTodos", args(json!({})))
            .expect("bench queued read");
        start.elapsed().as_micros() as f64
    });
    reader_ready_rx
        .recv()
        .expect("bench queued-reader acknowledgement");

    // These reads are both the L6 measurement and the deterministic unit of
    // work that keeps the writer held while the pre-L6 reader queues. Four
    // samples leave a decisive relative gap without defining a wall-clock
    // target; the global-reader timer necessarily encloses their total.
    const READ_LANE_CONTROL_SAMPLES: usize = 4;
    let (lane_done_tx, lane_done_rx) = std::sync::mpsc::sync_channel(1);
    let lane_worker = std::thread::spawn(move || {
        let lane_start = Instant::now();
        let lane_result = (|| {
            for _ in 0..READ_LANE_CONTROL_SAMPLES {
                lane.invoke_query("listTodos", args(json!({})))?;
            }
            Ok::<(), crate::diagnostic::SnapbackError>(())
        })();
        let via_read_lane_us = micros_per(lane_start, READ_LANE_CONTROL_SAMPLES);
        lane_done_tx
            .send((lane_result, via_read_lane_us))
            .expect("bench read-lane completion signal");
    });
    // This timeout is only a deadlock fail-safe: it is not reported as a
    // metric or used to size the writer hold. A lane that accidentally starts
    // taking the global mutex must fail instead of wedging the test process.
    let lane_outcome = lane_done_rx.recv_timeout(Duration::from_secs(30));

    // Always release and join both threads before propagating a lane error, so
    // a failed benchmark invocation cannot strand a lock holder.
    release_writer_tx
        .send(())
        .expect("bench writer-release acknowledgement");
    writer.join().expect("bench writer thread");
    let via_lock_us = queued_reader.join().expect("bench reader thread");
    lane_worker.join().expect("bench read-lane thread");
    let (lane_result, via_read_lane_us) = lane_outcome.map_err(|error| {
        crate::diagnostic::SnapbackError::error(
            "SNAPBACK_BENCH_READ_LANE_STALLED",
            "bench",
            format!("read lane did not complete during synchronized writer hold: {error}"),
        )
    })?;
    lane_result?;

    Ok((via_lock_us, via_read_lane_us))
}

/// The move-2 helper-splice measurement (LLP 0118 OQ1): does resolve-and-splice
/// helper duplication cost anything material per invocation under the shipped
/// fresh-per-invocation lifecycle? Each variant registers its own per-operation
/// runtime module in the exact splice-emitted byte shape and is invoked through
/// the same real Hermes create+eval path as `vm_cost_us` (pooling disabled so
/// the fresh definition holds). Invocations are timed individually for a
/// p50/p95 distribution; resident memory is sampled around each timed loop.
///
/// @ref LLP 0118#open-questions — OQ1: per-invocation evaluation latency and
/// memory as a function of runtime module size and helper-duplication factor,
/// against LLP 0035's fresh-invocation baseline.
fn measure_helper_splice(
    config: &BenchConfig,
) -> crate::diagnostic::SnapbackResult<HelperSpliceBench> {
    let query = |name: &str, source: &str| {
        FunctionDefinition::new(
            name,
            FunctionKind::Query,
            FunctionRuntime::IbexModule(IbexModule {
                source: source.to_owned(),
                export: name.to_owned(),
            }),
        )
    };
    let mut snapback = LocalSnapback::memory()?;
    snapback.apply_schema(schema())?;
    snapback.load_functions(FunctionManifest {
        functions: vec![
            query("helperFree", HELPER_FREE_MODULE),
            query("helperOne", HELPER_ONE_MODULE),
            query("helperThree", HELPER_THREE_MODULE),
        ],
        ..FunctionManifest::default()
    });
    // This metric is defined as the fresh per-invocation cost, like
    // `vm_cost_us`.
    snapback.set_warm_vms_enabled(false);

    // Cross-variant correctness gate: all three factorings must compute the
    // same civil date, or the latency comparison would be comparing different
    // work (e.g. a variant short-circuiting through an error path).
    let civil = |name: &str| -> crate::diagnostic::SnapbackResult<Value> {
        let output =
            snapback.invoke_query(name, args(json!({ "epochMs": HELPER_BENCH_EPOCH_MS })))?;
        Ok(output.rows.first().cloned().unwrap_or(Value::Null))
    };
    let reference = civil("helperFree")?;
    for name in ["helperOne", "helperThree"] {
        let row = civil(name)?;
        for field in ["y", "m", "d"] {
            if row.get(field) != reference.get(field) {
                return Err(crate::diagnostic::SnapbackError::error(
                    "SNAPBACK_BENCH_HELPER_SPLICE_MISMATCH",
                    "bench",
                    format!(
                        "helper-splice variant {name} disagrees with the inline reference on \
                         {field}: {row:?} vs {reference:?}"
                    ),
                ));
            }
        }
    }

    Ok(HelperSpliceBench {
        helper_free: measure_helper_variant(&snapback, "helperFree", HELPER_FREE_MODULE, config)?,
        one_helper: measure_helper_variant(&snapback, "helperOne", HELPER_ONE_MODULE, config)?,
        three_helpers: measure_helper_variant(
            &snapback,
            "helperThree",
            HELPER_THREE_MODULE,
            config,
        )?,
    })
}

fn measure_helper_variant(
    snapback: &LocalSnapback,
    name: &str,
    module: &str,
    config: &BenchConfig,
) -> crate::diagnostic::SnapbackResult<HelperVariantBench> {
    // Warm up (first eval pays one-time costs the steady state should not).
    for _ in 0..4 {
        snapback.invoke_query(name, args(json!({ "epochMs": HELPER_BENCH_EPOCH_MS })))?;
    }
    let rss_before = resident_kb();
    let mut samples = Vec::with_capacity(config.iterations);
    for _ in 0..config.iterations {
        let start = Instant::now();
        snapback.invoke_query(name, args(json!({ "epochMs": HELPER_BENCH_EPOCH_MS })))?;
        samples.push(start.elapsed().as_micros() as f64);
    }
    let rss_after = resident_kb();
    let invoke_mean_us = samples.iter().sum::<f64>() / samples.len().max(1) as f64;
    samples.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    Ok(HelperVariantBench {
        module_bytes: module.len(),
        invoke_p50_us: percentile_sorted(&samples, 0.50),
        invoke_p95_us: percentile_sorted(&samples, 0.95),
        invoke_mean_us,
        rss_delta_kb: rss_after - rss_before,
    })
}

/// Nearest-rank percentile over an ascending-sorted sample vector.
fn percentile_sorted(sorted: &[f64], fraction: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let rank = ((sorted.len() as f64 - 1.0) * fraction).round() as usize;
    sorted[rank.min(sorted.len() - 1)]
}

/// Resident set size of this process in KiB (`ps -o rss`, the same probe LLP
/// 0035's idle-cost section used). 0.0 when the probe is unavailable.
fn resident_kb() -> f64 {
    std::process::Command::new("ps")
        .args(["-o", "rss=", "-p"])
        .arg(std::process::id().to_string())
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|text| text.trim().parse::<f64>().ok())
        .unwrap_or(0.0)
}

fn micros_per(start: Instant, iterations: usize) -> f64 {
    start.elapsed().as_micros() as f64 / iterations.max(1) as f64
}

fn ephemeral_err(error: crate::ephemeral::EphemeralError) -> crate::diagnostic::SnapbackError {
    crate::diagnostic::SnapbackError::error("SNAPBACK_BENCH_EPHEMERAL", "bench", error.message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn benchmark_function_profiles_match_the_measurement_contract() {
        let manifest = functions();
        let noop = manifest
            .functions
            .iter()
            .find(|function| function.name == "noop")
            .expect("noop benchmark function");
        assert_eq!(noop.kind, FunctionKind::Query);
        assert!(!noop.is_protected_query());

        let live = manifest
            .functions
            .iter()
            .find(|function| function.name == "listTodos")
            .expect("live benchmark function");
        assert_eq!(live.kind, FunctionKind::LiveQuery);
        assert!(live.is_protected_query());
    }

    /// LLP 0032 M1 smoke lane: the harness runs at tiny scale, emits every
    /// metric, and each is within a generous order-of-magnitude bound. Timing
    /// thresholds are deliberately loose (10x headroom) so shared-runner noise
    /// does not flake; they only catch order-of-magnitude regressions.
    #[test]
    fn m1_bench_smoke() {
        match run_and_check_smoke() {
            Ok(_) => {}
            Err(first_failure) => {
                // Shared CI can briefly saturate cores while parallel cargo
                // tests run. Retry once before reporting a benchmark smoke
                // regression; a real order-of-magnitude regression repeats.
                if let Err(second_failure) = run_and_check_smoke() {
                    panic!(
                        "m1_bench_smoke failed after retry\nfirst: {first_failure}\nretry: {second_failure}"
                    );
                }
            }
        }
    }

    #[test]
    fn agent_safe_active_covered_worker_exercises_issuance_bearing_commits() {
        let report = run_agent_safe_active_covered(&BenchConfig::smoke())
            .expect("active covered acceptance worker");
        assert!(report.single_writer_mutations_per_sec > 0.0);
        assert!(report.single_writer_mutation_p50_us > 0.0);
        assert!(report.single_writer_mutation_p95_us > 0.0);
        assert!(report.allocated_write_bytes_per_operation > 0);
        let idle = measure_idle_agent_safe_active_covered(Duration::from_millis(5))
            .expect("active covered idle acceptance worker");
        assert_eq!(idle.duration_ms, 5);
        assert!(idle.resident_kb_before > 0.0);
    }

    fn run_and_check_smoke() -> Result<(), String> {
        let report = run(&BenchConfig::smoke()).map_err(|error| error.to_string())?;
        check_smoke_report(&report)
    }

    // The negated float comparisons inside `ensure!` are deliberate assertion
    // spellings; newer clippy (1.94+) flags them via neg_cmp_op_on_partial_ord.
    #[allow(clippy::neg_cmp_op_on_partial_ord)]
    fn check_smoke_report(report: &BenchReport) -> Result<(), String> {
        macro_rules! ensure {
            ($condition:expr, $($arg:tt)+) => {
                if !($condition) {
                    return Err(format!($($arg)+));
                }
            };
        }
        // Order-of-magnitude ceiling only: a healthy debug VM is single-digit
        // ms on a dev machine and ~180 ms on the slowest observed 2-core
        // shared CI runner, so 1 s still catches a true order-of-magnitude
        // regression without flaking on runner contention.
        ensure!(
            report.vm_cost_us > 0.0 && report.vm_cost_us < 1_000_000.0,
            "{report:?}"
        );
        ensure!(report.vm_create_us >= 0.0, "{report:?}");
        ensure!(
            report.warm_invoke_us > 0.0 && report.warm_invoke_us < 1_000_000.0,
            "{report:?}"
        );
        ensure!(report.single_writer_mutations_per_sec > 1.0, "{report:?}");
        ensure!(
            report.single_writer_mutation_p50_us > 0.0
                && report.single_writer_mutation_p95_us >= report.single_writer_mutation_p50_us,
            "{report:?}"
        );
        for (p50, p95) in [
            (
                report.current_point_read_p50_us,
                report.current_point_read_p95_us,
            ),
            (
                report.current_range_read_p50_us,
                report.current_range_read_p95_us,
            ),
            (
                report.current_query_plan_read_p50_us,
                report.current_query_plan_read_p95_us,
            ),
        ] {
            ensure!(p50 > 0.0 && p95 >= p50, "{report:?}");
        }
        ensure!(
            report.allocated_write_bytes_per_changed_row > 0
                && report.allocated_write_bytes_per_operation > 0,
            "{report:?}"
        );
        ensure!(report.matcher_skip_us_per_sub >= 0.0, "{report:?}");
        ensure!(report.fanout_us_per_affected_sub >= 0.0, "{report:?}");
        // DK-3: the op-log-delta projection must be positive and decisively
        // cheaper than the protected live re-query path (both measured this
        // run, so the comparison is machine-independent). This is the number
        // the revisit trigger is decided on; if deltas ever stopped beating
        // the re-query the lever would be gone.
        ensure!(report.fanout_delta_us_per_affected_sub > 0.0, "{report:?}");
        ensure!(
            report.fanout_delta_us_per_affected_sub * 2.0 < report.fanout_us_per_affected_sub,
            "op-log delta must decisively beat the re-query fan-out: {report:?}"
        );
        ensure!(report.read_set_validation_us_per_dep >= 0.0, "{report:?}");
        // E4 landed: a non-matching concurrent writer no longer conflicts a
        // reader of a filtered query.
        ensure!(report.spurious_conflict_rate == 0.0, "{report:?}");
        ensure!(
            report.ephemeral_publishes_per_sec > 60.0,
            "ephemeral must sustain >60 Hz: {report:?}"
        );
        // L6: while a synchronized writer owns the mutex, the read lane (a
        // pooled WAL reader that does not queue) must decisively beat the
        // global-mutex reader. The queued reader's timer causally encloses four
        // read-lane samples, so this relative assertion proves the topology
        // without a sleep, calibrated busy loop, or fixed wall-clock floor.
        ensure!(
            report.read_during_write_via_read_lane_us * 2.0 < report.read_during_write_via_lock_us,
            "read lane must decisively beat the queued mutex path: {report:?}"
        );
        // Move 2 helper splice (LLP 0118 OQ1): every variant must invoke, the
        // splice-duplicated modules are strictly larger by construction, and a
        // spliced module must stay within the same order of magnitude as the
        // helper-free one — under the fresh-per-invocation lifecycle the VM
        // create+eval dominates, so a large ratio means splice emission
        // regressed into something material.
        let splice = &report.helper_splice;
        for variant in [
            &splice.helper_free,
            &splice.one_helper,
            &splice.three_helpers,
        ] {
            ensure!(
                variant.invoke_p50_us > 0.0 && variant.invoke_p50_us < 1_000_000.0,
                "{report:?}"
            );
            ensure!(
                variant.invoke_p95_us >= variant.invoke_p50_us
                    && variant.invoke_p95_us < 1_000_000.0,
                "{report:?}"
            );
        }
        ensure!(
            splice.helper_free.module_bytes < splice.one_helper.module_bytes
                && splice.one_helper.module_bytes < splice.three_helpers.module_bytes,
            "{report:?}"
        );
        ensure!(
            splice.one_helper.invoke_p50_us < 5.0 * splice.helper_free.invoke_p50_us,
            "one spliced helper must not blow up per-invocation cost: {report:?}"
        );
        ensure!(
            splice.three_helpers.invoke_p50_us < 5.0 * splice.helper_free.invoke_p50_us,
            "three spliced helpers must not blow up per-invocation cost: {report:?}"
        );
        Ok(())
    }
}
