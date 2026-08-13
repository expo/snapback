//! Concurrency acceptance for the LLP 0032 L6+L7 arc and the L9 ephemeral
//! room authority: reads proceed on the lock-free WAL read lane while a write
//! holds the global mutex, version/rows pairs come from one pinned snapshot,
//! a busy-loop handler no longer stalls other endpoints, blocking work stays
//! off the tokio async workers, and ephemeral publish/subscribe/drain proceed
//! while a busy mutation holds the write lane (l9_*).
//!
//! These tests use a file-backed database (tempdir): the read lane requires
//! WAL, which in-memory SQLite cannot run. The in-memory fallback is asserted
//! separately.

fn test_detached_app_state(snapback: snapback::local::LocalSnapback) -> snapback::admin::AppState {
    snapback::admin::AppState::try_detached(snapback).expect("detached test app state")
}

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
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
/// mutation holds the write lane; after observing that lock directly,
/// read-lane queries complete before the writer and see the pre-write state.
#[test]
fn l6_concurrent_reads_proceed_during_a_long_write() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut snapback = LocalSnapback::open(dir.path().join("l6-reads.sqlite3")).expect("open");
    configure(&mut snapback);
    seed_todo(&mut snapback, "before the busy write");
    let lane = snapback.read_lane();
    assert!(
        lane.available(),
        "file-backed instance must have a read lane"
    );

    let busy_iters = busy_iters_for(&snapback, 900);
    let shared = Arc::new(Mutex::new(snapback));
    let (writer_acquired_tx, writer_acquired_rx) = std::sync::mpsc::channel();
    let writer = {
        let shared = shared.clone();
        thread::spawn(move || {
            let mut snapback = shared.lock().expect("writer lock");
            let started = Instant::now();
            writer_acquired_tx
                .send(started)
                .expect("report acquired write lane");
            snapback
                .invoke_mutation(
                    "busyCreate",
                    input(json!({ "iters": busy_iters }), "user_1"),
                )
                .expect("busy mutation");
            (started, Instant::now())
        })
    };

    // Synchronize on the writer's actual lock acquisition instead of probing
    // or guessing how long VM startup takes under host load.
    let write_started = writer_acquired_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("writer must acquire the write lane");
    let reads_started = Instant::now();
    for _ in 0..5 {
        let output = lane
            .invoke_query("listTodos", input(json!({}), "user_1"))
            .expect("read-lane query during busy write");
        assert_eq!(
            output.rows.len(),
            1,
            "reads during the busy write observe the pre-write snapshot"
        );
        assert_eq!(output.rows[0]["title"], "before the busy write");
    }
    let reads_finished = Instant::now();

    let (_, write_finished) = writer.join().expect("writer thread");
    assert!(
        reads_finished < write_finished,
        "reads must complete while the write still holds the write lane"
    );
    assert!(
        reads_started > write_started,
        "reads must start after the write began"
    );
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
    const MIN_READER_SAMPLES: usize = 8;
    let reader_deadline = Instant::now() + Duration::from_millis(1_200);
    // Run for a sustained window and complete at least four rounds across both
    // reader profiles. A heavily loaded debug CI runner can otherwise finish
    // only three valid rounds before the clock expires, turning this sampling
    // guard into a timing flake even though every observed snapshot is sound.
    while checked < MIN_READER_SAMPLES || Instant::now() < reader_deadline {
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
    assert!(
        checked >= MIN_READER_SAMPLES,
        "readers must have sampled (got {checked})"
    );
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
    let (snapback, busy_iters) = tokio::task::spawn_blocking(move || {
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        let mut snapback = LocalSnapback::open(db_path).expect("open");
        configure(&mut snapback);
        seed_todo(&mut snapback, "steady state");
        let busy_iters = busy_iters_for(&snapback, 900);
        (snapback, busy_iters)
    })
    .await
    .expect("setup");
    let state = test_detached_app_state(snapback);
    let write_lane = state.snapback.clone();
    let app = snapback::server::app(state);

    let busy = {
        let app = app.clone();
        tokio::spawn(async move {
            let response = app
                .oneshot(post_json(
                    "/mutation/busyCreate",
                    json!({ "args": { "iters": busy_iters }, "auth": { "user_id": "user_1" } }),
                ))
                .await
                .expect("busy mutation response");
            (response.status(), Instant::now())
        })
    };

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if write_lane.try_lock().is_err() {
                break;
            }
            assert!(
                !busy.is_finished(),
                "busy mutation finished before taking the lane"
            );
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("busy mutation must acquire the write lane");

    // We observed the writer holding the lane above. The completion-order
    // assertion below is the decisive lane proof and compares the reads to
    // the actual contending writer rather than to host wall-clock speed.
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
    let reads_finished = Instant::now();

    let (busy_status, busy_finished) = busy.await.expect("busy task");
    assert_eq!(busy_status, StatusCode::OK);
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
    let app = snapback::server::app(test_detached_app_state(snapback));

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
    let db_path = dir.path().join("l7-guard.sqlite3");
    let lane = tokio::task::spawn_blocking(move || {
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        let mut snapback = LocalSnapback::open(db_path).expect("open");
        configure(&mut snapback);
        snapback.read_lane()
    })
    .await
    .expect("setup");

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
    // ENG-23442: connection-scoped routes demand the /connection/open grant.
    let state = test_detached_app_state(snapback);
    let sweep_grant = state
        .connections
        .open(Some("conn_sweep".to_owned()), None, true)
        .expect("connection grant");
    let app = snapback::server::app(state);

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
            "POST /connection/open",
            post_json("/connection/open", json!({})),
        ),
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
            post_json_conn(
                "/live/listTodos/subscribe",
                json!({ "connection_id": "conn_sweep", "input": handler_body.clone() }),
                &sweep_grant.connection_token,
            ),
        ),
        (
            "GET /outbox",
            get(&format!(
                "/outbox/conn_sweep?connection_token={}",
                sweep_grant.connection_token
            )),
        ),
        ("GET admin health", get("/_snapback/api/health")),
        ("GET admin inspect", get("/_snapback/api/inspect")),
        ("GET admin data", get("/_snapback/api/data/todos")),
        (
            "POST admin function run",
            post_json(
                "/_snapback/api/functions/listTodos/run",
                handler_body.clone(),
            ),
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
        (
            "POST app reset",
            post_json("/_snapback/api/app/reset", json!({})),
        ),
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

/// LLP 0032 L9 (the payoff over L6/L7) — ephemeral operations proceed while a
/// long-running mutation holds the global write mutex. A generously calibrated
/// busy Ibex mutation occupies the write lane; HTTP ephemeral
/// subscribe/publish, the outbox drain, and a WebSocket socket-text publish all
/// complete in a small fraction of that, because the room authority no longer
/// takes the global mutex (LLP 0026 Phase 2). The test synchronizes on the
/// actual locked lane and requires every operation to finish before that lock
/// holder, so the proof does not depend on a fixed wall-clock duration.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn l9_ephemeral_ops_proceed_while_a_busy_mutation_holds_the_write_lane() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;

    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("l9-busy.sqlite3");
    let (snapback, busy_iters) = tokio::task::spawn_blocking(move || {
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        let mut snapback = LocalSnapback::open(db_path).expect("open");
        configure(&mut snapback);
        seed_todo(&mut snapback, "steady state");
        let busy_iters = busy_iters_for(&snapback, 900);
        (snapback, busy_iters)
    })
    .await
    .expect("setup");
    // ENG-23442: grants for the three connections this test exercises. The
    // registry is its own small lock, so verification cannot queue behind the
    // busy write lane — which the lock observation/completion ordering proves.
    let state = test_detached_app_state(snapback);
    let write_lane = state.snapback.clone();
    let observer_grant = state
        .connections
        .open(Some("l9-observer".to_owned()), None, true)
        .expect("observer grant");
    let publisher_grant = state
        .connections
        .open(Some("l9-publisher".to_owned()), None, true)
        .expect("publisher grant");
    let ws_grant = state
        .connections
        .open(Some("l9-ws".to_owned()), None, true)
        .expect("websocket grant");
    let app = snapback::server::app(state);

    // Serve the same app on a real listener for the WebSocket leg.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    let server = {
        let app = app.clone();
        tokio::spawn(async move {
            app.bind(listener)
                .expect("bind app")
                .serve()
                .await
                .expect("serve");
        })
    };

    let busy = {
        let app = app.clone();
        tokio::spawn(async move {
            let response = app
                .oneshot(post_json(
                    "/mutation/busyCreate",
                    json!({ "args": { "iters": busy_iters }, "auth": { "user_id": "user_1" } }),
                ))
                .await
                .expect("busy mutation response");
            (response.status(), Instant::now())
        })
    };

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if write_lane.try_lock().is_err() {
                break;
            }
            assert!(
                !busy.is_finished(),
                "busy mutation finished before taking the lane"
            );
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("busy mutation must acquire the write lane");

    let ephemeral_request = |connection: &str| {
        json!({
            "collection": "cursors",
            "scope": { "roomId": "room_l9" },
            "connection_id": connection,
            "auth": { "principal": null, "session_id": null, "user_id": null, "permissions": [] }
        })
    };

    // HTTP subscribe while the write lane is busy.
    let mut subscribe = ephemeral_request("l9-observer");
    let response = tokio::time::timeout(
        Duration::from_secs(2),
        app.clone().oneshot(post_json_conn(
            "/ephemeral/subscribe",
            subscribe.clone(),
            &observer_grant.connection_token,
        )),
    )
    .await
    .expect("subscribe must not stall behind the busy mutation")
    .expect("subscribe response");
    let status = response.status();
    let response_body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("subscribe body");
    assert_eq!(
        status,
        StatusCode::OK,
        "subscribe response: {}",
        String::from_utf8_lossy(&response_body)
    );
    // Reuse the request shape for an HTTP publish from another connection.
    subscribe = ephemeral_request("l9-publisher");
    subscribe["value"] = json!([123, 125]);
    subscribe["ttl_ms"] = json!(null);
    let response = tokio::time::timeout(
        Duration::from_secs(2),
        app.clone().oneshot(post_json_conn(
            "/ephemeral/publish",
            subscribe,
            &publisher_grant.connection_token,
        )),
    )
    .await
    .expect("publish must not stall behind the busy mutation")
    .expect("publish response");
    assert_eq!(response.status(), StatusCode::OK);

    // WebSocket socket-text publish while the write lane is still busy: the
    // pre-L9 handler locked the global mutex inline for these frames.
    let mut ws_request = format!("ws://{addr}/live/l9-ws/stream")
        .into_client_request()
        .expect("ws request");
    ws_request.headers_mut().insert(
        "sec-websocket-protocol",
        "snapback.v1".parse().expect("wire-version offer"),
    );
    ws_request.headers_mut().insert(
        "x-snapback-connection-token",
        ws_grant.connection_token.parse().expect("token header"),
    );
    let (mut socket, _) = tokio::time::timeout(
        Duration::from_secs(2),
        tokio_tungstenite::connect_async(ws_request),
    )
    .await
    .expect("ws connect must not stall behind the busy mutation")
    .expect("ws connect");
    let mut frame = json!({
        "type": "ephemeral_publish",
        "requestId": "l9-ws-1",
        "request": ephemeral_request("l9-ws")
    });
    frame["request"]["value"] = json!([120]);
    frame["request"]["ttl_ms"] = json!(null);
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            frame.to_string().into(),
        ))
        .await
        .expect("ws send");
    let reply = tokio::time::timeout(Duration::from_secs(2), socket.next())
        .await
        .expect("ws publish ack must not stall behind the busy mutation")
        .expect("ws open")
        .expect("ws message");
    let reply: Value = serde_json::from_str(&reply.into_text().expect("text")).expect("json");
    assert_eq!(reply["kind"], "ephemeral_ack", "unexpected reply: {reply}");

    // The observer's outbox drain also bypasses the write lane and already
    // holds the fanned-out upserts.
    let response = tokio::time::timeout(
        Duration::from_secs(2),
        app.clone().oneshot(
            Request::builder()
                .uri(format!(
                    "/outbox/l9-observer?connection_token={}",
                    observer_grant.connection_token
                ))
                .body(Body::empty())
                .expect("drain request"),
        ),
    )
    .await
    .expect("outbox drain must not stall behind the busy mutation")
    .expect("drain response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("drain body");
    let envelopes: Value = serde_json::from_slice(&body).expect("drain json");
    let upserts = envelopes
        .as_array()
        .expect("array")
        .iter()
        .filter(|envelope| envelope["Ephemeral"]["Upsert"].is_object())
        .count();
    assert!(
        upserts >= 2,
        "the observer must have received both publishes mid-busy-write: {envelopes}"
    );
    let ephemeral_finished = Instant::now();

    let (busy_status, busy_finished) = busy.await.expect("busy task");
    assert_eq!(busy_status, StatusCode::OK);
    assert!(
        ephemeral_finished < busy_finished,
        "every ephemeral operation must complete while the observed write-lane holder still runs"
    );
    server.abort();
}

/// LLP 0026 Phase 2 acceptance — a hot room does not block unrelated rooms or
/// the durable outbox path. Publisher threads hammer one room continuously;
/// meanwhile expiry cleanup of an unrelated room and a durable
/// enqueue-plus-drain for an unrelated connection complete within the
/// documented local threshold (250ms — generous for what are microsecond
/// memory operations; the bound exists to catch gross serialization behind
/// the hot room).
#[test]
fn l9_hot_room_publish_does_not_stall_unrelated_rooms_or_durable_drain() {
    use snapback::ephemeral::{
        AuthContext, EphemeralCollection, EphemeralMessage, LocalEphemeralBackend, PublishRequest,
        RealtimeEnvelope, RemoveReason, Scope, SubscribeRequest,
    };

    let backend = LocalEphemeralBackend::new();
    let mut cursors = EphemeralCollection::local_cursor("cursors", "roomId");
    cursors.sustained_hz = 10_000_000;
    cursors.burst = 10_000_000;
    backend.register_collection(cursors).unwrap();

    let publish = |connection: &str, room: &str, value: &[u8], ttl_ms: u64, now: u64| {
        (
            PublishRequest {
                collection: "cursors".to_owned(),
                scope: Scope::from_pairs([("roomId", room)]),
                connection_id: connection.to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                value: value.to_vec(),
                ttl_ms: Some(ttl_ms),
                auth: AuthContext::default(),
            },
            now,
        )
    };

    // A cold room with an already-expired entry and a subscriber to observe
    // the removal.
    backend
        .subscribe(
            SubscribeRequest {
                collection: "cursors".to_owned(),
                scope: Scope::from_pairs([("roomId", "cold")]),
                connection_id: "cold-observer".to_owned(),
                auth: AuthContext::default(),
                since_chunk: None,
            },
            1_000,
        )
        .expect("cold subscribe");
    let (request, now) = publish("cold-pub", "cold", b"cold", 5_000, 1_000);
    backend.publish(request, now).expect("cold publish");

    // Hot load: three threads republishing into one room. The fixed logical
    // clock keeps hot entries far from expiry and the huge budget keeps rate
    // limiting out of the way — the contention is real, the clock is not.
    let stop = Arc::new(AtomicBool::new(false));
    let published = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let mut hot_publishers = Vec::new();
    for publisher in 0..3 {
        let backend = backend.clone();
        let stop = stop.clone();
        let published_count = published.clone();
        hot_publishers.push(thread::spawn(move || {
            let connection = format!("hot-{publisher}");
            let mut local_published = 0u64;
            while !stop.load(Ordering::Relaxed) {
                let request = PublishRequest {
                    collection: "cursors".to_owned(),
                    scope: Scope::from_pairs([("roomId", "hot")]),
                    connection_id: connection.clone(),
                    session_id: None,
                    user_id: None,
                    custom_key: None,
                    value: local_published.to_le_bytes().to_vec(),
                    ttl_ms: Some(30_000),
                    auth: AuthContext::default(),
                };
                backend.publish(request, 2_000).expect("hot publish");
                local_published += 1;
                published_count.fetch_add(1, Ordering::Relaxed);
            }
            local_published
        }));
    }

    // Gate the measurement on observed work, not a guessed warm-up sleep.
    let heat_deadline = Instant::now() + Duration::from_secs(5);
    while published.load(Ordering::Relaxed) < 100 {
        assert!(
            Instant::now() < heat_deadline,
            "hot publishers did not establish the observed contention baseline"
        );
        assert!(
            hot_publishers
                .iter()
                .all(|publisher| !publisher.is_finished()),
            "a hot publisher exited before the contention baseline"
        );
        thread::yield_now();
    }
    let observed_before = published.load(Ordering::Relaxed);

    backend.cleanup_expired(6_500);

    backend.enqueue_durable("durable-conn", b"{\"kind\":\"live_replace\"}".to_vec());
    let drained = backend.drain_outbox("durable-conn");
    assert_eq!(drained.len(), 1);

    // The publishers remain live through both unrelated operations. Observe
    // another completed publish before stopping them so a scheduler pause
    // cannot turn this into a contention-free pass.
    let progress_deadline = Instant::now() + Duration::from_secs(5);
    while published.load(Ordering::Relaxed) == observed_before {
        assert!(
            Instant::now() < progress_deadline,
            "hot-room progress stopped during unrelated operations"
        );
        thread::yield_now();
    }

    stop.store(true, Ordering::Relaxed);
    let mut total_published = 0u64;
    for publisher in hot_publishers {
        total_published += publisher.join().expect("hot publisher");
    }
    assert!(
        total_published >= 100,
        "the hot room must have seen genuine continuous load (got {total_published})"
    );

    // The cold observer received the expiry removal produced mid-load.
    let removals = backend
        .drain_outbox("cold-observer")
        .into_iter()
        .filter(|envelope| {
            matches!(
                envelope,
                RealtimeEnvelope::Ephemeral(EphemeralMessage::Remove {
                    reason: RemoveReason::Expired,
                    ..
                })
            )
        })
        .count();
    assert_eq!(removals, 1, "the cold room's expiry must have fanned out");
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

  async busySpin(ctx, args) {
    // Calibration probe for busyCreate: burn args.iters and return.
    var sink = 0;
    for (var i = 0; i < args.iters; i++) { sink += (i * 31) % 97; }
    return [{ sink: sink % 1000 }];
  },

  async busyCreate(ctx, args) {
    // Clock-free busy spin: the deterministic tier denies Date.now at
    // runtime (LLP 0051 Increment 2). The iteration count is calibrated
    // host-side by busy_iters_for(), using fastest-of-five sampling plus a
    // 3x margin to absorb parallel-suite load swings (ENG-24384).
    var sink = 0;
    for (var i = 0; i < args.iters; i++) { sink += (i * 31) % 97; }
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
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED")
    );
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
    // The ephemeral collection gives the l9_* tests a cursor room; the huge
    // publish budget keeps rate limiting out of these timing tests.
    let mut cursors = snapback::ephemeral::EphemeralCollection::local_cursor("cursors", "roomId");
    cursors.sustained_hz = 10_000_000;
    cursors.burst = 10_000_000;
    SchemaManifest {
        schema_hash: Some("concurrency-v0".to_owned()),
        ephemeral_collections: vec![cursors],
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
                unique: false,
                where_applicable: false,
            }],
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
                    table_visibility: None,
                    table: "todos".to_owned(),
                    filters: vec![FilterExpr {
                        field: "userId".to_owned(),
                        op: FilterOp::Eq,
                        value: ValueExpr::AuthUserId,
                    }],
                    order: vec![OrderExpr {
                        field: "_createdAt".to_owned(),
                        direction: OrderDirection::Asc,
                        max_encoded_bytes: None,
                    }],
                    limit: None,
                    membership_filters: Vec::new(),
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
            ibex("busySpin", FunctionKind::Query),
            ibex("pairSet", FunctionKind::Mutation),
        ],
        ..FunctionManifest::default()
    }
}

/// Calibrate the clock-free busy spin (LLP 0051 Increment 2 denies Date.now
/// inside query/mutation handlers). Parallel test load can inflate one short
/// probe and make a later mutation much faster, so sample a larger probe five
/// times, take the fastest observation, and retain a 3x safety margin. That
/// margin preserves the actual lane-separation proof under host-load swings;
/// it does not loosen any measured assertion (ENG-24384).
fn busy_iters_for(snapback: &LocalSnapback, busy_ms: u64) -> u64 {
    let probe_iters: u64 = 1_000_000;
    let mut best_us = u64::MAX;
    for _ in 0..5 {
        let started = Instant::now();
        snapback
            .invoke_query("busySpin", input(json!({ "iters": probe_iters }), "user_1"))
            .expect("busy calibration probe");
        best_us = best_us.min(started.elapsed().as_micros().max(1) as u64);
    }
    busy_ms
        .saturating_mul(((probe_iters * 1_000) / best_us).max(100))
        .saturating_mul(3)
}

fn input(args: Value, user_id: &str) -> HandlerInput {
    HandlerInput {
        args,
        auth: snapback::manifest::AuthInput {
            user_id: Some(user_id.to_owned()),
            ..Default::default()
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

/// `post_json` carrying the ENG-23442 connection token.
fn post_json_conn(uri: &str, body: Value, connection_token: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .header("x-snapback-connection-token", connection_token)
        .body(Body::from(body.to_string()))
        .expect("request")
}
