//! LLP 0200 Phase 1 Stage 1 acceptance for the serving evaluation scheduler.
//! These tests use a clock-free Ibex spin so settlement ordering is observable
//! without adding a production test hook to the fan-out loop.

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use snapback::admin::AppState;
use snapback::ephemeral::RealtimeEnvelope;
use snapback::live_coalesce::{LiveCoalesceTunables, LiveFanoutCoalescer};
use snapback::local::{LiveSubscribeInput, LocalSnapback};
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerInput, HandlerPlan, IbexModule, MutationPlan, MutationStep,
    OrderDirection, OrderExpr, QueryPlan, ReturnValue, SchemaManifest, TableManifest, ValueExpr,
};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tower::ServiceExt;

// These acceptance cases deliberately saturate one Hermes evaluator. Running
// them against one another makes their wall-clock ordering assertion measure
// test-harness CPU contention instead of scheduler turns.
static LIVE_SCHEDULER_TEST_SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

const SLOW_LIVE_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async spinProbe(ctx, args) {
    var sink = 0;
    for (var i = 0; i < args.iters; i++) { sink += (i * 31) % 97; }
    return [{ sink: sink % 1000 }];
  },

  async slowTodos(ctx, args) {
    var sink = 0;
    for (var i = 0; i < args.iters; i++) { sink += (i * 31) % 97; }
    return await ctx.db.query('todos').order('_createdAt', 'asc').collect();
  }
};
"#;

/// A commit queued behind one evaluation turn settles before the remaining
/// observers, and a refused mutation in the same backlog creates no scheduler
/// work. The file-backed read lane proves the second commit is already durable
/// even while later subscriber turns remain.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[allow(clippy::await_holding_lock)] // Serializes this process-global scheduler stress fixture.
async fn settlement_and_refusal_are_isolated_from_fanout_backlog() {
    let _serial = LIVE_SCHEDULER_TEST_SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("live-scheduler.sqlite3");
    let (mut snapback, iters, one_turn) = tokio::task::spawn_blocking(move || {
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        let mut snapback = LocalSnapback::open(path).expect("open scheduler fixture");
        configure(&mut snapback);
        let iters = calibrated_iters(&snapback, 350);
        let one_turn = measured_slow_query(&snapback, iters);
        for observer in 0..3 {
            snapback
                .subscribe_live(
                    "slowTodos",
                    LiveSubscribeInput {
                        connection_id: format!("scheduler-observer-{observer}"),
                        input: input(json!({ "iters": iters }), "user_1"),
                        authorization_namespace: None,
                        supersedes: None,
                        resume_from_token: None,
                    },
                )
                .expect("install slow observer");
        }
        (snapback, iters, one_turn)
    })
    .await
    .expect("scheduler fixture setup");
    let coalescer = Arc::new(LiveFanoutCoalescer::with_tunables(LiveCoalesceTunables {
        max_eval_turn: Duration::from_secs(10),
        ..LiveCoalesceTunables::default()
    }));
    snapback.install_live_fanout_coalescer(coalescer.clone());
    let state = AppState::try_detached(snapback).expect("construct detached app state");
    let shared = state.snapback.clone();
    let scheduler = snapback::server::spawn_live_fanout_backstop(shared.clone(), coalescer);
    let app = snapback::server::app(state);

    let first = app
        .clone()
        .oneshot(post_json(
            "/mutation/createTodo",
            json!({ "args": { "title": "first" }, "auth": { "user_id": "user_1" } }),
        ))
        .await
        .expect("first mutation response");
    assert_eq!(first.status(), StatusCode::OK);
    wait_until_turn_holds_lock(&shared).await;

    let settle_started = Instant::now();
    let second = app
        .clone()
        .oneshot(post_json(
            "/mutation/createTodo",
            json!({ "args": { "title": "durable-second" }, "auth": { "user_id": "user_1" } }),
        ))
        .await
        .expect("second mutation response");
    let settle_elapsed = settle_started.elapsed();
    assert_eq!(second.status(), StatusCode::OK);
    assert_one_turn_not_full_fanout("applied mutation", settle_elapsed, one_turn);
    // §2.1 settlement decomposition: writing the mutation response body is
    // the settlement milestone, and it records the commit-ack→settlement gap
    // on the permanent counter (LLP 0200 §3).
    let second_body = to_bytes(second.into_body(), usize::MAX)
        .await
        .expect("second mutation body");
    assert!(!second_body.is_empty());
    {
        let inspect_shared = shared.clone();
        let stats = tokio::task::spawn_blocking(move || {
            let _sanction = snapback::exec_guard::BlockingSanction::acquire();
            inspect_shared
                .blocking_lock()
                .inspect()
                .expect("inspect state")
                .live_settlement
        })
        .await
        .expect("inspect offload");
        assert!(
            stats.last_commit_ack_to_settlement_ms > 0.0,
            "an applied mutation records its commit-ack→settlement gap"
        );
        assert!(
            stats.cumulative_commit_ack_to_settlement_ms >= stats.last_commit_ack_to_settlement_ms
        );
    }

    // This query uses the file-backed WAL read lane. It does not need the
    // scheduler's Local lock and therefore proves durability immediately.
    let durable = app
        .clone()
        .oneshot(post_json(
            "/query/listTodos",
            json!({ "args": {}, "auth": { "user_id": "user_1" } }),
        ))
        .await
        .expect("durable read response");
    assert_eq!(durable.status(), StatusCode::OK);
    let body = to_bytes(durable.into_body(), usize::MAX)
        .await
        .expect("durable query body");
    let body: Value = serde_json::from_slice(&body).expect("durable query JSON");
    assert!(
        body["rows"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| { row["title"] == "durable-second" })
    );

    wait_until_turn_holds_lock(&shared).await;
    let refusal_started = Instant::now();
    let refused = app
        .clone()
        .oneshot(post_json(
            "/mutation/createTodo",
            json!({ "args": {}, "auth": { "user_id": "user_1" } }),
        ))
        .await
        .expect("refused mutation response");
    let refusal_elapsed = refusal_started.elapsed();
    assert!(!refused.status().is_success());
    assert_one_turn_not_full_fanout("refused mutation", refusal_elapsed, one_turn);

    let deferred = shared.lock().await.live_coalesce_stats().deferred_commits;
    assert_eq!(
        deferred, 2,
        "the refusal creates no commit frame and never touches the scheduler"
    );
    scheduler.abort();
    let _ = iters; // retained in failure diagnostics through setup calibration.
}

/// A timed-out turn publishes nothing, collapses to one refresh retry, and a
/// second consecutive timeout tears the subscription down with the existing
/// resync-required signal.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[allow(clippy::await_holding_lock)] // Serializes this process-global scheduler stress fixture.
async fn evaluation_timeout_retries_once_then_tears_down() {
    let _serial = LIVE_SCHEDULER_TEST_SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (mut snapback, iters) = tokio::task::spawn_blocking(|| {
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        let mut snapback = LocalSnapback::memory().expect("memory timeout fixture");
        configure(&mut snapback);
        let iters = calibrated_iters(&snapback, 250);
        snapback
            .subscribe_live(
                "slowTodos",
                LiveSubscribeInput {
                    connection_id: "timeout-observer".to_owned(),
                    input: input(json!({ "iters": iters }), "user_1"),
                    authorization_namespace: None,
                    supersedes: None,
                    resume_from_token: None,
                },
            )
            .expect("install timeout observer");
        (snapback, iters)
    })
    .await
    .expect("timeout fixture setup");
    let coalescer = Arc::new(LiveFanoutCoalescer::with_tunables(LiveCoalesceTunables {
        max_eval_turn: Duration::from_millis(25),
        ..LiveCoalesceTunables::default()
    }));
    snapback.install_live_fanout_coalescer(coalescer.clone());
    let state = AppState::try_detached(snapback).expect("construct timeout app state");
    let shared = state.snapback.clone();
    let scheduler = snapback::server::spawn_live_fanout_backstop(shared.clone(), coalescer);
    let response = snapback::server::app(state)
        .oneshot(post_json(
            "/mutation/createTodo",
            json!({ "args": { "title": "timeout" }, "auth": { "user_id": "user_1" } }),
        ))
        .await
        .expect("timeout mutation response");
    assert_eq!(response.status(), StatusCode::OK);

    let resync = tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            tokio::time::sleep(Duration::from_millis(20)).await;
            let mut guard = shared.lock().await;
            let found = guard
                .drain_outbox("timeout-observer")
                .into_iter()
                .filter_map(|envelope| match envelope {
                    RealtimeEnvelope::Durable(message) => {
                        serde_json::from_slice::<Value>(&message.payload).ok()
                    }
                    RealtimeEnvelope::Ephemeral(_) => None,
                })
                .find(|frame| {
                    frame["kind"] == "resync_required"
                        && frame["reason"] == "SNAPBACK_LIVE_EVALUATION_TIMEOUT"
                });
            if let Some(found) = found {
                return found;
            }
        }
    })
    .await
    .expect("second timeout must tear the subscription down");
    assert_eq!(resync["clear_retained"], true);
    scheduler.abort();
    let _ = iters;
}

/// The environment kill switch selects the absent-scheduler compatibility
/// path. With three slow observers, the mutation response waits for all three
/// inline evaluations and each observer has a frame before invoke returns.
#[test]
fn scheduler_kill_switch_restores_inline_settlement() {
    let _serial = LIVE_SCHEDULER_TEST_SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    assert!(snapback::server::live_scheduler_disabled(Some("1")));
    assert!(snapback::server::live_scheduler_disabled(Some("true")));
    assert!(!snapback::server::live_scheduler_disabled(None));

    let mut snapback = LocalSnapback::memory().expect("memory scheduler fixture");
    configure(&mut snapback);
    let iters = calibrated_iters(&snapback, 300);
    let one_turn = measured_slow_query(&snapback, iters);
    for observer in 0..3 {
        snapback
            .subscribe_live(
                "slowTodos",
                LiveSubscribeInput {
                    connection_id: format!("inline-observer-{observer}"),
                    input: input(json!({ "iters": iters }), "user_1"),
                    authorization_namespace: None,
                    supersedes: None,
                    resume_from_token: None,
                },
            )
            .expect("install inline observer");
    }

    let started = Instant::now();
    snapback
        .invoke_mutation("createTodo", input(json!({ "title": "inline" }), "user_1"))
        .expect("inline mutation");
    let elapsed = started.elapsed();
    assert!(
        elapsed >= one_turn.saturating_mul(2),
        "kill-switched settlement must wait for the full inline fan-out; one turn {one_turn:?}, mutation {elapsed:?}"
    );
    for observer in 0..3 {
        assert_eq!(
            snapback
                .drain_outbox(&format!("inline-observer-{observer}"))
                .len(),
            1,
            "inline fan-out completes before mutation settlement"
        );
    }
    assert_eq!(snapback.live_coalesce_stats().deferred_commits, 0);
}

async fn wait_until_turn_holds_lock(state: &snapback::server::SharedSnapback) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if state.try_lock().is_err() {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("scheduler evaluation must acquire the Local lock");
}

fn assert_one_turn_not_full_fanout(label: &str, elapsed: Duration, one_turn: Duration) {
    let upper = one_turn
        .saturating_mul(2)
        .saturating_add(Duration::from_millis(500));
    assert!(
        elapsed < upper,
        "{label} waited for multiple fan-out turns: elapsed {elapsed:?}, measured turn {one_turn:?}, upper {upper:?}"
    );
}

fn measured_slow_query(snapback: &LocalSnapback, iters: u64) -> Duration {
    let started = Instant::now();
    snapback
        .invoke_query("slowTodos", input(json!({ "iters": iters }), "user_1"))
        .expect("measure one slow evaluation");
    started.elapsed()
}

fn calibrated_iters(snapback: &LocalSnapback, target_ms: u64) -> u64 {
    let probe_iters = 1_000_000u64;
    let mut best_us = u64::MAX;
    for _ in 0..5 {
        let started = Instant::now();
        snapback
            .invoke_query(
                "spinProbe",
                input(json!({ "iters": probe_iters }), "user_1"),
            )
            .expect("spin calibration");
        best_us = best_us.min(started.elapsed().as_micros().max(1) as u64);
    }
    target_ms
        .saturating_mul(((probe_iters * 1_000) / best_us).max(100))
        .saturating_mul(3)
}

fn configure(snapback: &mut LocalSnapback) {
    snapback
        .apply_schema(schema())
        .expect("apply scheduler schema");
    let diagnostics = snapback.load_functions(functions());
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED")
    );
}

fn schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("live-scheduler-v0".to_owned()),
        tables: vec![TableManifest {
            name: "todos".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "title".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "userId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
            ],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        }],
        ..SchemaManifest::default()
    }
}

fn functions() -> FunctionManifest {
    let ibex = |export: &str, kind: FunctionKind| {
        FunctionDefinition::new(
            export,
            kind,
            FunctionRuntime::IbexModule(IbexModule {
                source: SLOW_LIVE_SOURCE.to_owned(),
                export: export.to_owned(),
            }),
        )
    };
    FunctionManifest {
        bundle_hash: Some("live-scheduler-functions-v0".to_owned()),
        functions: vec![
            FunctionDefinition::new(
                "listTodos",
                FunctionKind::Query,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table_visibility: None,
                    table: "todos".to_owned(),
                    filters: Vec::new(),
                    membership_filters: Vec::new(),
                    order: vec![OrderExpr {
                        field: "_createdAt".to_owned(),
                        direction: OrderDirection::Asc,
                        max_encoded_bytes: None,
                    }],
                    limit: None,
                    indexed_by: None,
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
                            ("userId".to_owned(), ValueExpr::AuthUserId),
                        ]),
                        bind_id_as: Some("todoId".to_owned()),
                    }],
                    return_value: Some(ReturnValue::Binding("todoId".to_owned())),
                })),
            ),
            ibex("spinProbe", FunctionKind::Query),
            ibex("slowTodos", FunctionKind::LiveQuery),
        ],
        ..FunctionManifest::default()
    }
}

fn input(args: Value, user_id: &str) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            user_id: Some(user_id.to_owned()),
            ..AuthInput::default()
        },
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
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
