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

use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{Value, json};

use crate::ephemeral::{AuthContext, EphemeralCollection, PublishRequest, Scope, SubscribeRequest};
use crate::local::{LiveSubscribeInput, LocalSnapback};
use crate::manifest::{
    AuthInput, FieldManifest, FieldType, FilterExpr, FilterOp, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, IbexModule, QueryPlan, ReadDependency,
    SchemaManifest, TableManifest, ValueExpr,
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
    /// How long the busy write runs in the read-during-write measurement (the
    /// L6 before/after A/B).
    pub busy_write_ms: u64,
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
            busy_write_ms: 400,
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
            // The busy window must dominate one read's own cost or the
            // read-during-write assertions cannot discriminate queueing from
            // slowness. Debug-build fresh-VM reads have ranged from ~90ms to
            // 262ms on 2-core CI runners; 800ms left less than a 2x gap after
            // writer calibration and the quarter-window entry delay. A 1600ms
            // window restores decisive headroom while keeping this smoke-only
            // proof bounded; the full research profile remains 400ms.
            busy_write_ms: 1_600,
        }
    }
}

/// Every named metric, each a number with its unit in the field name.
#[derive(Clone, Debug, Serialize)]
pub struct BenchReport {
    pub iterations: usize,
    /// Per-invocation VM cost: create + eval of a trivial handler that touches
    /// no data. Isolates the **fresh**-VM-per-invocation overhead (the warm
    /// pool is disabled inside this measurement so the metric keeps its
    /// definition). Drives DK-4.
    pub vm_cost_us: f64,
    /// Of the VM cost, the *creation* portion (`ex_hermes_create` + wiring +
    /// drop, host install cached). What a warm VM avoids; the remainder is
    /// eval (the handler run itself, which a warm VM still does but without
    /// re-parsing the module).
    pub vm_create_us: f64,
    /// Per-invocation cost on the DK-4 warm path (default-on): eval of the
    /// small invoke IIFE plus the per-invocation reset sweep, no VM create,
    /// no module re-parse. Compare against `vm_cost_us` for the warm win.
    ///
    /// @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 — proof: re-measure.
    pub warm_invoke_us: f64,
    /// Single-writer throughput: sequential `createTodo` mutations per second.
    /// Because every mutation serializes on the global instance mutex, this is
    /// the single-writer breaking point.
    pub single_writer_mutations_per_sec: f64,
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
    /// Read latency while a long write holds the write lane, reading through
    /// the global mutex — the pre-L6 path, where every read queues behind the
    /// write. Expected ≈ the write's remaining duration.
    pub read_during_write_via_lock_us: f64,
    /// Read latency during the same long write through the L6 read lane
    /// (pooled WAL reader, pinned snapshot). Expected ≈ a standalone read.
    pub read_during_write_via_read_lane_us: f64,
}

const HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async noop(ctx) { return []; },
  async listTodos(ctx) {
    return await ctx.db.query('todos').order('_createdAt', 'asc').collect();
  },
  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', { title: args.title, done: false });
  },
  async touchTodo(ctx, args) {
    return (await ctx.db.patch('todos', args.id, { title: args.title })) ? args.id : null;
  },
  async listOthers(ctx) {
    return await ctx.db.query('others').order('_createdAt', 'asc').collect();
  },
  async createOther(ctx, args) {
    return await ctx.db.insert('others', { label: args.label });
  },
  async busySpin(ctx, args) {
    // Calibration probe for busyCreate: burn args.iters and return quickly.
    var sink = 0;
    for (var i = 0; i < args.iters; i++) { sink += (i * 31) % 97; }
    return [{ sink: sink % 1000 }];
  },
  async busyCreate(ctx, args) {
    // Clock-free busy spin: the deterministic tier denies Date.now at
    // runtime (LLP 0051 Increment 2), so the writer burns a host-calibrated
    // iteration count instead of busy-waiting on a wall clock. The bench
    // only needs the write lock held for roughly the requested window.
    var sink = 0;
    for (var i = 0; i < args.iters; i++) { sink += (i * 31) % 97; }
    return await ctx.db.insert('todos', { title: 'busy-' + (sink % 10), done: false });
  }
};
"#;

/// Run the whole harness and return the report.
pub fn run(config: &BenchConfig) -> crate::diagnostic::SnapbackResult<BenchReport> {
    let vm_cost_us = measure_vm_cost(config)?;
    let vm_create_us = crate::runtime::bench_runtime_create_us(config.iterations);
    let warm_invoke_us = measure_warm_invoke(config)?;
    let single_writer_mutations_per_sec = measure_single_writer(config)?;
    let (matcher_skip_us_per_sub, fanout_us_per_affected_sub) = measure_fanout(config)?;
    let fanout_delta_us_per_affected_sub = measure_fanout_delta_projection(config);
    let read_set_validation_us_per_dep = measure_read_set_validation(config)?;
    let spurious_conflict_rate = measure_spurious_conflict(config)?;
    let (ephemeral_publishes_per_sec, ephemeral_publish_us) = measure_ephemeral(config)?;
    let (read_during_write_via_lock_us, read_during_write_via_read_lane_us) =
        measure_read_during_write(config)?;

    Ok(BenchReport {
        iterations: config.iterations,
        vm_cost_us,
        vm_create_us,
        warm_invoke_us,
        single_writer_mutations_per_sec,
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
    })
}

fn schema() -> SchemaManifest {
    let string_field = |name: &str| FieldManifest {
        name: name.to_owned(),
        field_type: FieldType::String,
        optional: false,
    };
    SchemaManifest {
        schema_hash: Some("bench-v0".to_owned()),
        tables: vec![
            TableManifest {
                name: "todos".to_owned(),
                fields: vec![
                    string_field("title"),
                    FieldManifest {
                        name: "done".to_owned(),
                        field_type: FieldType::Boolean,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
                syncable: true,
            },
            TableManifest {
                name: "others".to_owned(),
                fields: vec![string_field("label")],
                indexes: Vec::new(),
                syncable: true,
            },
        ],
        ..SchemaManifest::default()
    }
}

fn functions() -> FunctionManifest {
    let query = |name: &str, table: &str| {
        let mut def = FunctionDefinition::new(
            name,
            FunctionKind::LiveQuery,
            FunctionRuntime::IbexModule(IbexModule {
                source: HANDLER_SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        );
        def.required_capabilities = vec![
            "live_subscriptions".to_owned(),
            "ibex_ctx_db_host_bridge".to_owned(),
        ];
        def.read_set_summary.primary_table = Some(table.to_owned());
        def.read_set_summary.tables = vec![table.to_owned()];
        def.read_set_summary.mode = Some("handlerDeclared".to_owned());
        def
    };
    let mutation = |name: &str, table: &str| {
        let mut def = FunctionDefinition::new(
            name,
            FunctionKind::Mutation,
            FunctionRuntime::IbexModule(IbexModule {
                source: HANDLER_SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        );
        def.required_capabilities = vec![
            "ibex_ctx_db_host_bridge".to_owned(),
            "mutation_read_set_validation".to_owned(),
        ];
        def.write_set_summary.primary_table = Some(table.to_owned());
        def.write_set_summary.tables = vec![table.to_owned()];
        def.write_set_summary.mode = Some("handlerDeclared".to_owned());
        def
    };
    FunctionManifest {
        functions: vec![
            query("noop", "todos"),
            query("listTodos", "todos"),
            query("listOthers", "others"),
            mutation("createTodo", "todos"),
            mutation("touchTodo", "todos"),
            mutation("createOther", "others"),
            mutation("busyCreate", "todos"),
            query("busySpin", "todos"),
        ],
        ..FunctionManifest::default()
    }
}

fn configured() -> crate::diagnostic::SnapbackResult<LocalSnapback> {
    let mut snapback = LocalSnapback::memory()?;
    snapback.apply_schema(schema())?;
    snapback.load_functions(functions());
    Ok(snapback)
}

fn auth() -> AuthInput {
    AuthInput {
        principal: Some("bench".to_owned()),
        session_id: None,
        user_id: Some("bench".to_owned()),
    }
}

fn args(value: Value) -> HandlerInput {
    HandlerInput {
        args: value,
        auth: auth(),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

fn measure_vm_cost(config: &BenchConfig) -> crate::diagnostic::SnapbackResult<f64> {
    let snapback = configured()?;
    // This metric is defined as the *fresh* per-invocation cost; keep that
    // definition by forcing the fresh path (the warm path has its own metric).
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

/// The DK-4 warm-path per-invocation cost: the same trivial no-data query as
/// `vm_cost_us`, but through the default warm pool — invoke-IIFE eval plus
/// the reset sweep, no create, no module re-parse. The warm-up pays the
/// one-time VM setup so the steady state is what live fan-out and repeat
/// invocations actually cost.
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

fn measure_single_writer(config: &BenchConfig) -> crate::diagnostic::SnapbackResult<f64> {
    let mut snapback = configured()?;
    for _ in 0..4 {
        snapback.invoke_mutation("createTodo", args(json!({ "title": "warm" })))?;
    }
    let start = Instant::now();
    for n in 0..config.iterations {
        snapback.invoke_mutation("createTodo", args(json!({ "title": n.to_string() })))?;
    }
    let elapsed = start.elapsed().as_secs_f64();
    Ok(if elapsed > 0.0 {
        config.iterations as f64 / elapsed
    } else {
        f64::INFINITY
    })
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
                supersedes: None,
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
                supersedes: None,
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
/// LLP 0008 §Reactivity). Today's fan-out re-runs the whole query in a (warm) VM
/// per affected subscription (`fanout_us_per_affected_sub`); an op-log delta
/// instead classifies each committed `ChangedRow` against the subscription's
/// captured predicate with the live matcher — no VM, no re-query — and ships
/// just the changed rows. This measures that classify+serialize cost using the
/// real matcher (`row_matches_query_filters`), so the number is a faithful
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
        table: "todos".to_owned(),
        filters: vec![FilterExpr {
            field: "userId".to_owned(),
            op: FilterOp::Eq,
            value: ValueExpr::Arg("userId".to_owned()),
        }],
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
            table: "todos".to_owned(),
            filters: vec![FilterExpr {
                field: "done".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Literal(json!(true)),
            }],
            order: Vec::new(),
            limit: None,
            indexed_by: None,
        })
        .unwrap_or(Value::Null)
    };
    let mut conflicts = 0usize;
    for trial in 0..config.conflict_trials {
        let mut db = LocalDatabase::memory()?;
        db.apply_schema(schema())?;
        commit_insert(&mut db, "todos", json!({ "title": "match", "done": true }))?;

        let captured_version = db.table_change_version("todos")?;
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
        let result = db.commit_buffered_writes(
            &input,
            vec![BufferedWrite::Insert {
                table: "todos".to_owned(),
                id: db.generate_id(),
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
    db.commit_buffered_writes(
        &input,
        vec![BufferedWrite::Insert {
            table: table.to_owned(),
            id: db.generate_id(),
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
    snapback.register_ephemeral_collection(collection);
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

/// The L6 before/after A/B on one build: a busy mutation holds the write lane
/// for `busy_write_ms` while a read runs (a) through the global mutex — the
/// pre-L6 shape, which queues behind the write — and (b) through the read lane
/// (pooled WAL reader, pinned snapshot), which does not. File-backed database:
/// the read lane requires WAL.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6.
fn measure_read_during_write(
    config: &BenchConfig,
) -> crate::diagnostic::SnapbackResult<(f64, f64)> {
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
    let result = measure_read_during_write_at(&dir.join("bench.sqlite3"), config);
    let _ = std::fs::remove_dir_all(&dir);
    result
}

fn measure_read_during_write_at(
    path: &std::path::Path,
    config: &BenchConfig,
) -> crate::diagnostic::SnapbackResult<(f64, f64)> {
    let mut snapback = LocalSnapback::open(path)?;
    snapback.apply_schema(schema())?;
    snapback.load_functions(functions());
    snapback.invoke_mutation("createTodo", args(json!({ "title": "seed" })))?;
    // Warm the reader-pool connection and the query path.
    let lane = snapback.read_lane();
    lane.invoke_query("listTodos", args(json!({})))?;

    let shared = std::sync::Arc::new(std::sync::Mutex::new(snapback));
    // Calibrate the clock-free busy spin (the deterministic tier denies
    // Date.now inside handlers — LLP 0051 Increment 2): time a fixed
    // iteration count, take the best of two runs (the second is warm), and
    // scale to the requested window. Rounding down inflates the window,
    // which only makes the queued-mutex lower bound safer.
    let probe_iters: u64 = 200_000;
    let mut best_probe_us = u64::MAX;
    for _ in 0..2 {
        let start = Instant::now();
        shared
            .lock()
            .expect("bench probe lock")
            .invoke_query("busySpin", args(json!({ "iters": probe_iters })))?;
        best_probe_us = best_probe_us.min(start.elapsed().as_micros().max(1) as u64);
    }
    let iters_per_ms = ((probe_iters * 1_000) / best_probe_us).max(100);
    let busy_ms = config.busy_write_ms;
    let busy_iters = busy_ms * iters_per_ms;
    let spawn_busy_writer = |shared: std::sync::Arc<std::sync::Mutex<LocalSnapback>>| {
        std::thread::spawn(move || {
            let mut snapback = shared.lock().expect("bench writer lock");
            snapback
                .invoke_mutation("busyCreate", args(json!({ "iters": busy_iters })))
                .expect("bench busy mutation");
        })
    };
    // Wait long enough for the writer to be inside the busy handler (VM
    // creation is a few ms; a quarter of the busy window is far past it).
    let entered = Duration::from_millis(busy_ms / 4);

    // (a) The read lane: reads proceed while the write runs.
    let writer = spawn_busy_writer(shared.clone());
    std::thread::sleep(entered);
    let start = Instant::now();
    lane.invoke_query("listTodos", args(json!({})))?;
    let via_read_lane_us = start.elapsed().as_micros() as f64;
    writer.join().expect("bench writer thread");

    // (b) The global mutex: the read queues behind the write's remainder.
    let writer = spawn_busy_writer(shared.clone());
    std::thread::sleep(entered);
    let start = Instant::now();
    {
        let snapback = shared.lock().expect("bench reader lock");
        snapback.invoke_query("listTodos", args(json!({})))?;
    }
    let via_lock_us = start.elapsed().as_micros() as f64;
    writer.join().expect("bench writer thread");

    Ok((via_lock_us, via_read_lane_us))
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
        // DK-4: the warm path must be meaningfully cheaper than a fresh VM —
        // if it regressed to fresh (silent fallback, broken reset burning
        // every VM) the ratio collapses toward 1.0 and this catches it. The
        // 0.75 bound is loose; the architectural gap (no create, no module
        // re-parse) is several-fold. Compare against the full fresh path
        // envelope measured in this run (creation plus fresh invocation), so
        // host contention in a tiny smoke sample does not make the warm path
        // look falsely regressed (ENG-23488).
        let fresh_path_us = report.vm_create_us + report.vm_cost_us;
        ensure!(
            report.warm_invoke_us > 0.0 && report.warm_invoke_us < fresh_path_us * 0.75,
            "warm invocation must beat the fresh path decisively: {report:?}"
        );
        ensure!(report.single_writer_mutations_per_sec > 1.0, "{report:?}");
        ensure!(report.matcher_skip_us_per_sub >= 0.0, "{report:?}");
        ensure!(report.fanout_us_per_affected_sub >= 0.0, "{report:?}");
        // DK-3: the op-log-delta projection must be positive and decisively
        // cheaper than the warm re-query path (both measured this run, so the
        // comparison is machine-independent). This is the number the revisit
        // trigger is decided on; if deltas ever stopped beating the re-query
        // the lever would be gone.
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
        // L6: during the same busy write, the read lane (a pooled reader that
        // does not queue) must decisively beat the mutex path (which waits out
        // the write). This is asserted *relative* — both are measured on the
        // same runner in the same run — which reduces machine dependence and
        // avoids a fixed lane ceiling. The smoke busy window is still sized to
        // dominate a cold concurrent read on slow shared runners. The lock
        // path's own lower bound confirms it genuinely queued behind the
        // wall-clock busy window.
        let busy_us = (BenchConfig::smoke().busy_write_ms * 1_000) as f64;
        ensure!(
            report.read_during_write_via_read_lane_us * 2.0 < report.read_during_write_via_lock_us,
            "read lane must decisively beat the queued mutex path: {report:?}"
        );
        ensure!(
            report.read_during_write_via_lock_us > busy_us / 4.0,
            "the mutex path should have queued behind the busy write: {report:?}"
        );
        Ok(())
    }
}
