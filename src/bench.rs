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
        measure_read_during_write()?;

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
                permission_backing: false,
                permission_fields: None,
                membership: None,
            },
            TableManifest {
                name: "others".to_owned(),
                fields: vec![string_field("label")],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                membership: None,
            },
        ],
        ..SchemaManifest::default()
    }
}

fn functions() -> FunctionManifest {
    let live_query = |name: &str, table: &str| {
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
    // DK-4 measures the reusable finite-query profile. Auth-scoped live
    // queries intentionally use a protected fresh realm, so registering this
    // no-data probe as LiveQuery would make the "warm" and forced-fresh
    // measurements exercise the same path.
    let noop = FunctionDefinition::new(
        "noop",
        FunctionKind::Query,
        FunctionRuntime::IbexModule(IbexModule {
            source: HANDLER_SOURCE.to_owned(),
            export: "noop".to_owned(),
        }),
    );
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
            noop,
            live_query("listTodos", "todos"),
            live_query("listOthers", "others"),
            mutation("createTodo", "todos"),
            mutation("touchTodo", "todos"),
            mutation("createOther", "others"),
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
        ..AuthInput::default()
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
        Ok(())
    }
}
