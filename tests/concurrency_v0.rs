//! Concurrency acceptance for the LLP 0032 L6+L7 arc: reads proceed on the
//! lock-free WAL read lane while a write holds the global mutex, version/rows
//! pairs come from one pinned snapshot, a busy-loop handler no longer stalls
//! other endpoints, and blocking work stays off the tokio async workers.
//!
//! These tests use a file-backed database (tempdir): the read lane requires
//! WAL, which in-memory SQLite cannot run. The in-memory fallback is asserted
//! separately.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use snapback::admin::AppState;
use snapback::local::LocalSnapback;
use snapback::manifest::{
    FieldManifest, FieldType, FilterExpr, FilterOp, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, IbexModule, IndexManifest,
    MutationPlan, MutationStep, OrderDirection, OrderExpr, QueryPlan, ReturnValue, SchemaManifest,
    TableManifest, ValueExpr,
};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tower::ServiceExt;

/// LLP 0032 L6 — concurrent reads proceed during a long-running write. A busy
/// mutation holds the write lane for ~900ms; read-lane queries issued while it
/// runs complete in a small fraction of that and observe the pre-write state.
#[test]
fn l6_concurrent_reads_proceed_during_a_long_write() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut snapback = LocalSnapback::open(dir.path().join("l6-reads.sqlite3")).expect("open");
    configure(&mut snapback);
    seed_todo(&mut snapback, "before the busy write");
    let lane = snapback.read_lane();
    assert!(lane.available(), "file-backed instance must have a read lane");

    let shared = Arc::new(Mutex::new(snapback));
    let writer = {
        let shared = shared.clone();
        thread::spawn(move || {
            let started = Instant::now();
            let mut snapback = shared.lock().expect("writer lock");
            snapback
                .invoke_mutation("busyCreate", input(json!({ "busyMs": 900 }), "user_1"))
                .expect("busy mutation");
            (started, Instant::now())
        })
    };

    // Give the writer time to enter the busy handler (VM create + eval start
    // is a few ms even in debug builds), then read while it holds the lock.
    thread::sleep(Duration::from_millis(250));
    let mut read_latencies = Vec::new();
    let reads_started = Instant::now();
    for _ in 0..5 {
        let read_started = Instant::now();
        let output = lane
            .invoke_query("listTodos", input(json!({}), "user_1"))
            .expect("read-lane query during busy write");
        read_latencies.push(read_started.elapsed());
        assert_eq!(
            output.rows.len(),
            1,
            "reads during the busy write observe the pre-write snapshot"
        );
        assert_eq!(output.rows[0]["title"], "before the busy write");
    }
    let reads_finished = Instant::now();

    let (write_started, write_finished) = writer.join().expect("writer thread");
    let write_elapsed = write_finished - write_started;
    assert!(
        write_elapsed >= Duration::from_millis(800),
        "the busy mutation must actually have been long ({write_elapsed:?})"
    );
    assert!(
        reads_finished < write_finished,
        "reads must complete while the write still holds the write lane"
    );
    assert!(
        reads_started > write_started,
        "reads must start after the write began"
    );
    for latency in read_latencies {
        assert!(
            latency < Duration::from_millis(500),
            "a read-lane query must not queue behind the busy write ({latency:?})"
        );
    }

    // After the writer commits, the lane observes the new row.
    let after = lane
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect("read after commit");
    assert_eq!(after.rows.len(), 2);
}

/// LLP 0032 L6 — the version/rows pair is a single snapshot under concurrent
/// writes. Every commit in this test stamps *all* rows of the table with the
/// commit version, so any read whose reported `version` differs from a row's
/// `_version` — or whose two rows disagree with each other — is a torn
/// snapshot. The pre-arc code read rows and version in two autocommit
/// statements and was consistent only under the global mutex.
#[test]
fn l6_version_and_rows_come_from_one_snapshot_under_concurrent_writes() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut snapback = LocalSnapback::open(dir.path().join("l6-snapshot.sqlite3")).expect("open");
    configure(&mut snapback);
    let a = seed_todo(&mut snapback, "a");
    let b = seed_todo(&mut snapback, "b");
    // Bring both rows onto one commit version so the invariant below holds
    // from the start.
    snapback
        .invoke_mutation(
            "pairSet",
            input(json!({ "a": a, "b": b, "k": 0 }), "user_1"),
        )
        .expect("initial pairSet");
    let lane = snapback.read_lane();

    let stop = Arc::new(AtomicBool::new(false));
    let shared = Arc::new(Mutex::new(snapback));
    let writer = {
        let shared = shared.clone();
        let stop = stop.clone();
        let (a, b) = (a.clone(), b.clone());
        thread::spawn(move || {
            let mut k = 1i64;
            while !stop.load(Ordering::Relaxed) {
                let mut snapback = shared.lock().expect("writer lock");
                snapback
                    .invoke_mutation(
                        "pairSet",
                        input(json!({ "a": a, "b": b, "k": k }), "user_1"),
                    )
                    .expect("pairSet");
                k += 1;
            }
            k - 1
        })
    };

    // Two reader profiles: the host-plan path in a tight loop (narrow windows,
    // many samples) and the Ibex path (the whole eval pinned to one snapshot).
    let mut checked = 0usize;
    let reader_deadline = Instant::now() + Duration::from_millis(1_200);
    while Instant::now() < reader_deadline {
        for function in ["listTodos", "listTodosIbex"] {
            let output = lane
                .invoke_query(function, input(json!({}), "user_1"))
                .expect("read-lane query under write churn");
            assert_eq!(output.rows.len(), 2);
            for row in &output.rows {
                assert_eq!(
                    row["_version"].as_u64(),
                    Some(output.version),
                    "torn snapshot: {function} reported version {} but a row is at {:?}",
                    output.version,
                    row["_version"]
                );
            }
            assert_eq!(
                output.rows[0]["rank"], output.rows[1]["rank"],
                "torn snapshot: {function} saw two halves of one commit"
            );
            checked += 1;
        }
    }
    stop.store(true, Ordering::Relaxed);
    let commits = writer.join().expect("writer thread");
    // Loose floors: debug-build VM cost on a slow CI runner caps the loop
    // counts; the invariant assertions above are the test, the floors only
    // prove genuine churn and sampling happened.
    assert!(
        commits >= 5,
        "the writer must have churned commits under the readers (got {commits})"
    );
    assert!(checked >= 8, "readers must have sampled (got {checked})");
}

/// LLP 0032 L7 (requires L6) — a busy-loop handler occupies the write lane and
/// one blocking thread, but other endpoints — `/health` and `/query/*` on the
/// read lane — respond while it runs. Runs on a multi-thread runtime, so the
/// exec-guard assertions also verify no Hermes eval or rusqlite call lands on
/// an async worker anywhere in these paths.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn l7_busy_mutation_does_not_stall_other_endpoints() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("l7-busy.sqlite3");
    // Setup runs blocking work (schema apply, a seed mutation), so on this
    // multi-thread runtime it must live on a blocking thread — the exec guard
    // enforces that for the test itself, not just the server.
    let snapback = tokio::task::spawn_blocking(move || {
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        let mut snapback = LocalSnapback::open(db_path).expect("open");
        configure(&mut snapback);
        seed_todo(&mut snapback, "steady state");
        snapback
    })
    .await
    .expect("setup");
    let app = snapback::server::app(AppState::detached(snapback));

    let busy_started = Instant::now();
    let busy = {
        let app = app.clone();
        tokio::spawn(async move {
            let response = app
                .oneshot(post_json(
                    "/mutation/busyCreate",
                    json!({ "args": { "busyMs": 900 }, "auth": { "user_id": "user_1" } }),
                ))
                .await
                .expect("busy mutation response");
            (response.status(), Instant::now())
        })
    };

    tokio::time::sleep(Duration::from_millis(250)).await;

    // Latency bounds discriminate the lanes: at ~250ms into a ~900ms busy
    // write, a request that secretly queued on the write mutex takes ≥650ms;
    // a read-lane request takes milliseconds. 500ms splits them with margin
    // on both sides.
    let health_started = Instant::now();
    let health = tokio::time::timeout(
        Duration::from_secs(2),
        app.clone().oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .expect("health request"),
        ),
    )
    .await
    .expect("health must not stall behind the busy mutation")
    .expect("health response");
    assert_eq!(health.status(), StatusCode::OK);
    let health_elapsed = health_started.elapsed();
    assert!(
        health_elapsed < Duration::from_millis(500),
        "health must not queue behind the busy write ({health_elapsed:?})"
    );

    let query_started = Instant::now();
    let query = tokio::time::timeout(
        Duration::from_secs(2),
        app.clone().oneshot(post_json(
            "/query/listTodos",
            json!({ "args": {}, "auth": { "user_id": "user_1" } }),
        )),
    )
    .await
    .expect("read-lane query must not stall behind the busy mutation")
    .expect("query response");
    assert_eq!(query.status(), StatusCode::OK);
    let query_elapsed = query_started.elapsed();
    assert!(
        query_elapsed < Duration::from_millis(500),
        "the read-lane query must not queue behind the busy write ({query_elapsed:?})"
    );
    let reads_finished = Instant::now();

    let (busy_status, busy_finished) = busy.await.expect("busy task");
    assert_eq!(busy_status, StatusCode::OK);
    assert!(
        busy_finished - busy_started >= Duration::from_millis(800),
        "the busy mutation must actually have been long"
    );
    assert!(
        reads_finished < busy_finished,
        "health and query must complete while the busy mutation is still running"
    );
}

/// LLP 0032 L6 — an in-memory instance has no WAL and therefore no read lane;
/// `/query` falls back to the serialized write lane and still works.
#[tokio::test]
async fn l6_memory_instance_falls_back_to_the_write_lane() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    configure(&mut snapback);
    seed_todo(&mut snapback, "in memory");
    assert!(
        !snapback.read_lane().available(),
        "in-memory instances must report the read lane unavailable"
    );
    let app = snapback::server::app(AppState::detached(snapback));

    let response = app
        .oneshot(post_json(
            "/query/listTodos",
            json!({ "args": {}, "auth": { "user_id": "user_1" } }),
        ))
        .await
        .expect("query response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let output: Value = serde_json::from_slice(&body).expect("query output json");
    assert_eq!(output["rows"].as_array().expect("rows").len(), 1);
}

/// LLP 0032 L7 — the exec guard fails loudly (debug builds) when blocking work
/// is invoked directly on a multi-thread tokio worker instead of through the
/// offload helpers.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn l7_exec_guard_refuses_blocking_work_on_async_workers() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut snapback = LocalSnapback::open(dir.path().join("l7-guard.sqlite3")).expect("open");
    configure(&mut snapback);
    let lane = snapback.read_lane();

    let result = tokio::spawn(async move {
        // Deliberately wrong: read-lane work on an async worker.
        lane.invoke_query("listTodos", input(json!({}), "user_1"))
    })
    .await;
    assert!(
        result.expect_err("must panic").is_panic(),
        "the exec guard must reject blocking work on a tokio worker"
    );
}

/// LLP 0032 L7 — every rusqlite/Hermes-touching route survives on a
/// multi-thread runtime, i.e. runs its blocking work through the offload
/// helpers. The exec guard panics any handler that reaches SQLite or an eval
/// on an async worker, and a handler panic fails this test. This sweep exists
/// because the review of this arc found a route (`GET /`) that the suite
/// missed: current-thread test runtimes are exactly the environment where the
/// guard is silent.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn l7_every_blocking_route_passes_the_exec_guard() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("l7-sweep.sqlite3");
    let snapback = tokio::task::spawn_blocking(move || {
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        let mut snapback = LocalSnapback::open(db_path).expect("open");
        configure(&mut snapback);
        seed_todo(&mut snapback, "sweep");
        snapback
    })
    .await
    .expect("setup");
    let app = snapback::server::app(AppState::detached(snapback));

    let get = |uri: &str| {
        Request::builder()
            .uri(uri)
            .body(Body::empty())
            .expect("get request")
    };
    let handler_body = json!({ "args": {}, "auth": { "user_id": "user_1" } });
    let requests: Vec<(&str, Request<Body>)> = vec![
        ("GET /", get("/")),
        ("GET /health", get("/health")),
        ("GET /inspect", get("/inspect")),
        (
            "POST /query (host plan)",
            post_json("/query/listTodos", handler_body.clone()),
        ),
        (
            "POST /query (ibex)",
            post_json("/query/listTodosIbex", handler_body.clone()),
        ),
        (
            "POST /mutation",
            post_json(
                "/mutation/createTodo",
                json!({ "args": { "title": "sweep" }, "auth": { "user_id": "user_1" } }),
            ),
        ),
        (
            "POST /live/subscribe",
            post_json(
                "/live/listTodos/subscribe",
                json!({ "connection_id": "conn_sweep", "input": handler_body.clone() }),
            ),
        ),
        ("GET /outbox", get("/outbox/conn_sweep")),
        ("GET admin health", get("/_snapback/api/health")),
        ("GET admin inspect", get("/_snapback/api/inspect")),
        ("GET admin data", get("/_snapback/api/data/todos")),
        (
            "POST admin function run",
            post_json("/_snapback/api/functions/listTodos/run", handler_body.clone()),
        ),
        (
            "POST admin cron tick",
            post_json("/_snapback/api/cron/tick", json!({})),
        ),
        (
            "POST schema load",
            post_json(
                "/_snapback/api/schema/load",
                serde_json::to_value(concurrency_schema()).expect("schema json"),
            ),
        ),
        (
            "POST functions load",
            post_json(
                "/_snapback/api/functions/load",
                serde_json::to_value(concurrency_functions()).expect("functions json"),
            ),
        ),
        ("POST app reset", post_json("/_snapback/api/app/reset", json!({}))),
        (
            "POST disconnect",
            post_json(
                "/_snapback/api/connections/conn_sweep/disconnect",
                json!({}),
            ),
        ),
    ];

    for (label, request) in requests {
        let response = app
            .clone()
            .oneshot(request)
            .await
            .unwrap_or_else(|error| panic!("{label} failed to produce a response: {error:?}"));
        assert!(
            response.status().is_success(),
            "{label} must succeed on a multi-thread runtime, got {}",
            response.status()
        );
    }
}

/* ---------- harness ---------- */

const CONCURRENCY_HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async listTodosIbex(ctx) {
    return await ctx.db
      .query('todos')
      .order('_createdAt', 'asc')
      .collect();
  },

  async busyCreate(ctx, args) {
    const start = Date.now();
    while (Date.now() - start < args.busyMs) {}
    return await ctx.db.insert('todos', {
      title: 'busy insert',
      completed: false,
      userId: ctx.auth.userId,
    });
  },

  async pairSet(ctx, args) {
    await ctx.db.patch('todos', args.a, { rank: args.k });
    await ctx.db.patch('todos', args.b, { rank: args.k });
    return args.k;
  }
};
"#;

fn configure(snapback: &mut LocalSnapback) {
    snapback
        .apply_schema(concurrency_schema())
        .expect("apply schema");
    let diagnostics = snapback.load_functions(concurrency_functions());
    assert!(diagnostics.iter().all(|diagnostic| {
        diagnostic.code == "SNAPBACK_IBEX_CLI_UNAVAILABLE"
            || diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED"
    }));
}

fn seed_todo(snapback: &mut LocalSnapback, title: &str) -> String {
    snapback
        .invoke_mutation("createTodo", input(json!({ "title": title }), "user_1"))
        .expect("create todo")
        .result
        .as_str()
        .expect("inserted id")
        .to_owned()
}

fn concurrency_schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("concurrency-v0".to_owned()),
        tables: vec![TableManifest {
            name: "todos".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "title".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "completed".to_owned(),
                    field_type: FieldType::Boolean,
                    optional: false,
                },
                FieldManifest {
                    name: "rank".to_owned(),
                    field_type: FieldType::Integer,
                    optional: true,
                },
                FieldManifest {
                    name: "userId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
            ],
            indexes: vec![IndexManifest {
                name: "by_user".to_owned(),
                fields: vec!["userId".to_owned()],
            }],
            syncable: true,
        }],
        ..SchemaManifest::default()
    }
}

fn concurrency_functions() -> FunctionManifest {
    let ibex = |export: &str, kind: FunctionKind| {
        FunctionDefinition::new(
            export,
            kind,
            FunctionRuntime::IbexModule(IbexModule {
                source: CONCURRENCY_HANDLER_SOURCE.to_owned(),
                export: export.to_owned(),
            }),
        )
    };

    FunctionManifest {
        bundle_hash: Some("concurrency-functions-v0".to_owned()),
        functions: vec![
            FunctionDefinition::new(
                "listTodos",
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table: "todos".to_owned(),
                    filters: vec![FilterExpr {
                        field: "userId".to_owned(),
                        op: FilterOp::Eq,
                        value: ValueExpr::AuthUserId,
                    }],
                    order: vec![OrderExpr {
                        field: "_createdAt".to_owned(),
                        direction: OrderDirection::Asc,
                    }],
                    limit: None,
                    indexed_by: Some("by_user".to_owned()),
                })),
            ),
            FunctionDefinition::new(
                "createTodo",
                FunctionKind::Mutation,
                FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                    steps: vec![MutationStep::Insert {
                        table: "todos".to_owned(),
                        values: BTreeMap::from([
                            ("title".to_owned(), ValueExpr::Arg("title".to_owned())),
                            (
                                "completed".to_owned(),
                                ValueExpr::Literal(Value::Bool(false)),
                            ),
                            ("userId".to_owned(), ValueExpr::AuthUserId),
                        ]),
                        bind_id_as: Some("todoId".to_owned()),
                    }],
                    return_value: Some(ReturnValue::Binding("todoId".to_owned())),
                })),
            ),
            ibex("listTodosIbex", FunctionKind::LiveQuery),
            ibex("busyCreate", FunctionKind::Mutation),
            ibex("pairSet", FunctionKind::Mutation),
        ],
        ..FunctionManifest::default()
    }
}

fn input(args: Value, user_id: &str) -> HandlerInput {
    HandlerInput {
        args,
        auth: snapback::manifest::AuthInput {
            user_id: Some(user_id.to_owned()),
            ..Default::default()
        },
        read_set: Vec::new(),
    }
}

fn post_json(uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request")
}
