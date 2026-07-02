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

use std::time::Instant;

use serde::Serialize;
use serde_json::{Value, json};

use crate::ephemeral::{AuthContext, EphemeralCollection, PublishRequest, Scope, SubscribeRequest};
use crate::local::{LiveSubscribeInput, LocalSnapback};
use crate::manifest::{
    AuthInput, FieldManifest, FieldType, FilterExpr, FilterOp, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, IbexModule, QueryPlan, ReadDependency,
    SchemaManifest, TableManifest, ValueExpr,
};
use crate::storage::{
    BufferedWrite, CapturedReadDependency, CapturedReadKind, LocalDatabase,
};

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
    /// no data. Isolates the fresh-VM-per-invocation overhead. Drives DK-4.
    pub vm_cost_us: f64,
    /// Of the VM cost, the *creation* portion (`ex_hermes_create` + wiring +
    /// drop, host install cached). What a warm VM would avoid; the remainder is
    /// eval (the handler run itself, which a warm VM must still do but without
    /// re-parsing the module).
    pub vm_create_us: f64,
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
  async listOthers(ctx) {
    return await ctx.db.query('others').order('_createdAt', 'asc').collect();
  },
  async createOther(ctx, args) {
    return await ctx.db.insert('others', { label: args.label });
  }
};
"#;

/// Run the whole harness and return the report.
pub fn run(config: &BenchConfig) -> crate::diagnostic::SnapbackResult<BenchReport> {
    let vm_cost_us = measure_vm_cost(config)?;
    let vm_create_us = crate::runtime::bench_runtime_create_us(config.iterations);
    let single_writer_mutations_per_sec = measure_single_writer(config)?;
    let (matcher_skip_us_per_sub, fanout_us_per_affected_sub) = measure_fanout(config)?;
    let read_set_validation_us_per_dep = measure_read_set_validation(config)?;
    let spurious_conflict_rate = measure_spurious_conflict(config)?;
    let (ephemeral_publishes_per_sec, ephemeral_publish_us) = measure_ephemeral(config)?;

    Ok(BenchReport {
        iterations: config.iterations,
        vm_cost_us,
        vm_create_us,
        single_writer_mutations_per_sec,
        matcher_skip_us_per_sub,
        fanout_us_per_affected_sub,
        fanout_ceiling_subs_at_10ms: if fanout_us_per_affected_sub > 0.0 {
            10_000.0 / fanout_us_per_affected_sub
        } else {
            f64::INFINITY
        },
        read_set_validation_us_per_dep,
        spurious_conflict_rate,
        ephemeral_publishes_per_sec,
        ephemeral_publish_us,
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
    }
}

fn args(value: Value) -> HandlerInput {
    HandlerInput {
        args: value,
        auth: auth(),
        read_set: Vec::new(),
    }
}

fn measure_vm_cost(config: &BenchConfig) -> crate::diagnostic::SnapbackResult<f64> {
    let snapback = configured()?;
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
    let matcher_skip_us_per_sub = ((skip_per_commit - baseline).max(0.0))
        / config.subscriptions.max(1) as f64;

    // Full path: subscriptions watch `todos` and we commit to `todos`, so every
    // subscription is affected (re-query + serialize + enqueue).
    let mut affected = configured()?;
    for i in 0..config.subscriptions {
        affected.subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: format!("aff-{i}"),
                input: args(json!({})),
            },
        )?;
    }
    let start = Instant::now();
    for n in 0..config.iterations {
        affected.invoke_mutation("createTodo", args(json!({ "title": n.to_string() })))?;
        // Drain so outboxes do not grow unbounded and skew later commits.
        for i in 0..config.subscriptions {
            affected.drain_outbox(&format!("aff-{i}"));
        }
    }
    let affected_per_commit = micros_per(start, config.iterations);
    let baseline_todos = single_commit_baseline(config, "createTodo", "title")?;
    let fanout_us_per_affected_sub = ((affected_per_commit - baseline_todos).max(0.0))
        / config.subscriptions.max(1) as f64;

    Ok((matcher_skip_us_per_sub, fanout_us_per_affected_sub))
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
        if let Err(error) = result {
            if error.diagnostic.code == "SNAPBACK_MUTATION_CONFLICT" {
                conflicts += 1;
            }
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
        let report = run(&BenchConfig::smoke()).expect("bench runs");

        assert!(report.vm_cost_us > 0.0 && report.vm_cost_us < 100_000.0, "{report:?}");
        assert!(report.vm_create_us >= 0.0, "{report:?}");
        assert!(report.single_writer_mutations_per_sec > 1.0, "{report:?}");
        assert!(report.matcher_skip_us_per_sub >= 0.0, "{report:?}");
        assert!(report.fanout_us_per_affected_sub >= 0.0, "{report:?}");
        assert!(report.read_set_validation_us_per_dep >= 0.0, "{report:?}");
        // E4 landed: a non-matching concurrent writer no longer conflicts a
        // reader of a filtered query.
        assert_eq!(report.spurious_conflict_rate, 0.0, "{report:?}");
        assert!(
            report.ephemeral_publishes_per_sec > 60.0,
            "ephemeral must sustain >60 Hz: {report:?}"
        );
    }
}
