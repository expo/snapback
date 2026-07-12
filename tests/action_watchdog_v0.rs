//! ENG-23324 acceptance: actions no longer run under the global write mutex,
//! and a detached Ibex action is bounded by a coarse wall-clock watchdog.
//!
//! The wedge this protects against: an action stuck in a hung outbound fetch
//! used to hold the global mutex indefinitely, freezing all mutations, cron,
//! and (for in-memory instances) all queries. These tests use an in-memory
//! instance deliberately — its queries take the write mutex, so "the query
//! returns while an action runs" is the strongest form of the claim.
//!
//! Every test sets the same watchdog budget before starting its server, so
//! parallel tests in this binary never observe a conflicting value.

use axum::body::Body;
use axum::http::Request;
use serde_json::{Value, json};
use snapback::admin::AppState;
use snapback::cron::CronRunOutcome;
use snapback::local::LocalSnapback;
use snapback::manifest::{
    ConfigEntryDefinition, CronActivationPolicy, CronJitterPolicy, CronJobDefinition,
    CronOverlapPolicy, CronRetryMode, CronRetryPolicy, CronSchedule, FieldManifest, FieldType,
    FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime, IbexModule,
    SchemaManifest, TableManifest,
};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tower::ServiceExt;

/// One shared watchdog budget for the whole binary (ms).
const WATCHDOG_MS: u64 = 800;
static ACTION_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn serial_action_test() -> tokio::sync::MutexGuard<'static, ()> {
    ACTION_TEST_LOCK.lock().await
}

fn set_watchdog_env() {
    // SAFETY: every test in this binary writes the same values before starting
    // its server, so concurrent setters race only to store identical bytes.
    unsafe { std::env::set_var("SNAPBACK_ACTION_TIMEOUT_MS", WATCHDOG_MS.to_string()) };
    // All tests in this binary set the same process-global host posture before
    // constructing a runtime. The generation regression uses a real native
    // fetch pause so it can prove a host-call-free completion fence.
    unsafe { std::env::set_var("SNAPBACK_OUTBOUND_ACTIONS", "1") };
}

/// Most watchdog cases use the same deterministic busy-loop stand-in as L6/L7;
/// the generation regression below separately uses a held native fetch. The
/// watchdog and the mutex are indifferent to *why* the VM thread is occupied.
const WATCHDOG_HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async listTodos(ctx) {
    return await ctx.db.query('todos').order('_createdAt', 'asc').collect();
  },

  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', {
      title: args.title,
      completed: false,
      userId: 'watchdog',
    });
  },

  async busyAction(ctx, args) {
    const start = Date.now();
    while (Date.now() - start < args.busyMs) {}
    return { done: true };
  },

  async lateWriteAction(ctx, args) {
    const start = Date.now();
    while (Date.now() - start < args.busyMs) {}
    return await ctx.runMutation('createTodo', { title: 'late write' });
  },

  async pausedSuccessAction(_ctx, args) {
    await fetch(args.url);
    return { done: true };
  },

  async pausedMutationAction(ctx, args) {
    await fetch(args.url);
    return await ctx.runMutation('createTodo', { title: 'after held instance lock' });
  },

  async hungMutation(ctx) {
    while (true) {}
  },

  async nestedHungAction(ctx) {
    return await ctx.runMutation('hungMutation', {});
  },

  async readAction(ctx, args) {
    // ctx.db is deliberately denied to actions (they interact with data only
    // through ctx.runMutation); this must still fail closed after the
    // detached-execution refactor.
    const rows = await ctx.db.query('todos').collect();
    return { count: rows.length };
  },

  async cronAction(ctx) {
    return await ctx.runMutation('createTodo', { title: 'cron write' });
  },

  async quickProbe(ctx) {
    return { ok: true };
  },

  async hungProbe(ctx) {
    // The config-verify stand-in for a hung probe fetch (ENG-23493): longer
    // than the watchdog, shorter than the test's patience.
    const start = Date.now();
    while (Date.now() - start < 1600) {}
    return { ok: true };
  }
};
"#;

fn watchdog_schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("action-watchdog-v0".to_owned()),
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
                    name: "userId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
            ],
            indexes: Vec::new(),
            syncable: true,
        }],
        ..SchemaManifest::default()
    }
}

fn config_entry(name: &str, probe: &str) -> ConfigEntryDefinition {
    ConfigEntryDefinition {
        name: name.to_owned(),
        description: Some("watchdog test entry".to_owned()),
        purpose: None,
        secret: true,
        required: false,
        pool: false,
        probe: Some(probe.to_owned()),
        how_to_get: None,
        acquisition: None,
        default: None,
        source_span: None,
    }
}

fn watchdog_functions() -> FunctionManifest {
    let ibex = |export: &str, kind: FunctionKind| {
        FunctionDefinition::new(
            export,
            kind,
            FunctionRuntime::IbexModule(IbexModule {
                source: WATCHDOG_HANDLER_SOURCE.to_owned(),
                export: export.to_owned(),
            }),
        )
    };
    let mut manifest = FunctionManifest {
        bundle_hash: Some("action-watchdog-functions-v0".to_owned()),
        functions: vec![
            ibex("listTodos", FunctionKind::LiveQuery),
            ibex("createTodo", FunctionKind::Mutation),
            ibex("hungMutation", FunctionKind::Mutation),
            ibex("busyAction", FunctionKind::Action),
            ibex("lateWriteAction", FunctionKind::Action),
            ibex("pausedSuccessAction", FunctionKind::Action),
            ibex("pausedMutationAction", FunctionKind::Action),
            ibex("nestedHungAction", FunctionKind::Action),
            ibex("readAction", FunctionKind::Action),
            ibex("cronAction", FunctionKind::Action),
            ibex("quickProbe", FunctionKind::Action),
            ibex("hungProbe", FunctionKind::Action),
        ],
        config: vec![
            config_entry("quickKey", "quickProbe"),
            config_entry("hungKey", "hungProbe"),
        ],
        ..FunctionManifest::default()
    };
    manifest.cron_jobs = vec![CronJobDefinition {
        name: "cronWrite".to_owned(),
        schedule: CronSchedule {
            every_ms: Some(60_000),
            cron: None,
        },
        action: "cronAction".to_owned(),
        enabled: true,
        activation: CronActivationPolicy::default(),
        jitter_policy: CronJitterPolicy {
            enabled: false,
            max_offset_ms: 0,
        },
        overlap_policy: CronOverlapPolicy::NoOverlap,
        retry_policy: CronRetryPolicy {
            mode: CronRetryMode::NextTick,
        },
        required_capabilities: vec!["cron".to_owned(), "cron_action_run_mutation".to_owned()],
        target_wakeup: None,
        source_span: None,
    }];
    manifest
}

fn watchdog_state_and_app() -> (snapback::server::SharedSnapback, axum::Router) {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback
        .apply_schema(watchdog_schema())
        .expect("apply schema");
    let diagnostics = snapback.load_functions(watchdog_functions());
    assert!(diagnostics.iter().all(|diagnostic| {
        diagnostic.code == "SNAPBACK_IBEX_CLI_UNAVAILABLE"
            || diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED"
    }));
    let app_state = AppState::detached(snapback);
    let state = app_state.snapback.clone();
    (state, snapback::server::app(app_state))
}

fn watchdog_app() -> axum::Router {
    watchdog_state_and_app().1
}

fn post_json(uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request")
}

async fn body_json(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body bytes");
    serde_json::from_slice(&bytes).expect("body json")
}

fn handler_body(args: Value) -> Value {
    json!({ "args": args, "auth": { "user_id": "user_1" } })
}

async fn held_http_response() -> (
    String,
    oneshot::Receiver<()>,
    oneshot::Sender<()>,
    tokio::task::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind held response server");
    let address = listener.local_addr().expect("held response address");
    let (started_tx, started_rx) = oneshot::channel();
    let (release_tx, release_rx) = oneshot::channel();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("accept action fetch");
        let mut request = Vec::new();
        let mut chunk = [0_u8; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            let read = socket.read(&mut chunk).await.expect("read action fetch");
            assert!(read > 0, "action fetch closed before request headers");
            request.extend_from_slice(&chunk[..read]);
            assert!(
                request.len() < 64 * 1024,
                "action fetch headers are bounded"
            );
        }
        let _ = started_tx.send(());
        let _ = release_rx.await;
        socket
            .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok")
            .await
            .expect("release action fetch");
        socket.shutdown().await.expect("close action fetch");
    });
    (
        format!("http://{address}/pause"),
        started_rx,
        release_tx,
        task,
    )
}

fn start_paused_action(app: axum::Router, url: String) -> tokio::task::JoinHandle<Value> {
    tokio::spawn(async move {
        let response = app
            .oneshot(post_json(
                "/action/pausedSuccessAction",
                handler_body(json!({ "url": url })),
            ))
            .await
            .expect("paused action response");
        body_json(response).await
    })
}

fn start_paused_mutation_action(app: axum::Router, url: String) -> tokio::task::JoinHandle<Value> {
    tokio::spawn(async move {
        let response = app
            .oneshot(post_json(
                "/action/pausedMutationAction",
                handler_body(json!({ "url": url })),
            ))
            .await
            .expect("paused mutation action response");
        body_json(response).await
    })
}

/// A detached action can cross an app generation without another ctx host op:
/// native fetch/timer work settles inside Ibex. Completion itself is therefore
/// a generation fence, not merely every host call along the way.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn paused_host_call_free_action_rejects_reload_and_reset_drift() {
    let _serial = serial_action_test().await;
    set_watchdog_env();
    let (state, app) = watchdog_state_and_app();

    let (reload_url, reload_started, release_reload, reload_server) = held_http_response().await;
    let reload_action = start_paused_action(app.clone(), reload_url);
    tokio::time::timeout(Duration::from_secs(2), reload_started)
        .await
        .expect("action reaches native fetch before reload")
        .expect("reload fetch-start signal");
    let diagnostics = state.lock().await.load_functions(watchdog_functions());
    assert!(diagnostics.iter().all(|diagnostic| {
        diagnostic.code == "SNAPBACK_IBEX_CLI_UNAVAILABLE"
            || diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED"
    }));
    release_reload.send(()).expect("release reload fetch");
    let reload_body = tokio::time::timeout(Duration::from_secs(2), reload_action)
        .await
        .expect("reloaded action settles")
        .expect("reload action task");
    reload_server.await.expect("reload fetch server");
    assert_eq!(
        reload_body["ok"], false,
        "stale action must fail: {reload_body}"
    );
    assert_eq!(
        reload_body["diagnostic"]["code"], "SNAPBACK_ACTION_GENERATION_CONFLICT",
        "host-call-free completion must observe function reload: {reload_body}"
    );

    let (reset_url, reset_started, release_reset, reset_server) = held_http_response().await;
    let reset_action = start_paused_action(app, reset_url);
    tokio::time::timeout(Duration::from_secs(2), reset_started)
        .await
        .expect("action reaches native fetch before reset")
        .expect("reset fetch-start signal");
    state
        .lock()
        .await
        .reset()
        .expect("reset while action is paused");
    release_reset.send(()).expect("release reset fetch");
    let reset_body = tokio::time::timeout(Duration::from_secs(2), reset_action)
        .await
        .expect("reset action settles")
        .expect("reset action task");
    reset_server.await.expect("reset fetch server");
    assert_eq!(
        reset_body["ok"], false,
        "stale action must fail: {reset_body}"
    );
    assert_eq!(
        reset_body["diagnostic"]["code"], "SNAPBACK_ACTION_GENERATION_CONFLICT",
        "host-call-free completion must observe reset: {reset_body}"
    );
}

/// A host call can reach the instance mutex after detached execution begins.
/// Even if that mutex is then held forever, the public watchdog must answer
/// and the action OS worker must drain while the lock remains unavailable.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn permanently_held_instance_mutex_does_not_leak_action_worker() {
    let _serial = serial_action_test().await;
    set_watchdog_env();

    tokio::time::timeout(Duration::from_secs(5), async {
        while snapback::server::detached_action_worker_count() != 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("pre-existing action workers must drain");
    let baseline = snapback::server::detached_action_worker_count();

    let (state, app) = watchdog_state_and_app();
    let (url, fetch_started, release_fetch, fetch_server) = held_http_response().await;
    let started = Instant::now();
    let action = start_paused_mutation_action(app, url);
    tokio::time::timeout(Duration::from_secs(2), fetch_started)
        .await
        .expect("action reaches native fetch before instance lock is held")
        .expect("held-lock fetch-start signal");

    let held_instance = state.clone().lock_owned().await;
    release_fetch.send(()).expect("release held-lock fetch");
    let body = tokio::time::timeout(Duration::from_secs(2), action)
        .await
        .expect("watchdog answers while instance mutex remains held")
        .expect("held-lock action task");
    fetch_server.await.expect("held-lock fetch server");
    let elapsed = started.elapsed();

    assert_eq!(body["ok"], false, "timed-out action must fail: {body}");
    assert_eq!(
        body["diagnostic"]["code"], "SNAPBACK_ACTION_TIMEOUT",
        "held-lock timeout keeps the stable watchdog diagnostic: {body}"
    );
    assert!(
        elapsed >= Duration::from_millis(WATCHDOG_MS - 100)
            && elapsed < Duration::from_millis(1500),
        "the permanent mutex hold must not outlive the watchdog ({elapsed:?})"
    );
    assert_eq!(
        snapback::server::detached_action_worker_count(),
        baseline,
        "the response must publish only after the lock-waiting worker drains"
    );

    // Keep the mutex unavailable through every timeout/worker assertion; only
    // release it after the regression has proved no eventual acquisition was
    // needed to make progress.
    drop(held_instance);
}

/// ENG-24340: a mutation invoked by an action executes against a detached
/// snapshot/read lane. If its handler never returns, the action watchdog can
/// still answer and the instance lock remains available to healthy requests.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nested_hung_mutation_times_out_without_wedging_the_instance() {
    let _serial = serial_action_test().await;
    set_watchdog_env();
    let app = watchdog_app();

    let started = Instant::now();
    let response = tokio::time::timeout(
        Duration::from_secs(3),
        app.clone().oneshot(post_json(
            "/action/nestedHungAction",
            handler_body(json!({})),
        )),
    )
    .await
    .expect("the watchdog must answer while the nested mutation is hung")
    .expect("action response");
    let elapsed = started.elapsed();
    let body = body_json(response).await;

    assert_eq!(body["ok"], false, "timed-out action must fail: {body}");
    assert_eq!(
        body["diagnostic"]["code"], "SNAPBACK_ACTION_TIMEOUT",
        "diagnostic must be the watchdog code: {body}"
    );
    assert!(
        elapsed >= Duration::from_millis(WATCHDOG_MS - 100)
            && elapsed < Duration::from_millis(1500),
        "the nested handler must not delay the watchdog ({elapsed:?})"
    );

    let health = tokio::time::timeout(
        Duration::from_millis(500),
        app.clone().oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .expect("request"),
        ),
    )
    .await
    .expect("health must not queue behind the hung mutation")
    .expect("health response");
    assert_eq!(
        health.status(),
        200,
        "healthy instance must remain available"
    );

    let mutation = tokio::time::timeout(
        Duration::from_secs(1),
        app.clone().oneshot(post_json(
            "/mutation/createTodo",
            handler_body(json!({ "title": "after nested timeout" })),
        )),
    )
    .await
    .expect("healthy mutation must not queue behind the hung mutation")
    .expect("mutation response");
    let mutation_body = body_json(mutation).await;
    assert!(
        mutation_body.get("version").is_some(),
        "healthy mutation must still commit: {mutation_body}"
    );

    let query = tokio::time::timeout(
        Duration::from_secs(1),
        app.clone()
            .oneshot(post_json("/query/listTodos", handler_body(json!({})))),
    )
    .await
    .expect("healthy query must not queue behind the hung mutation")
    .expect("query response");
    let query_body = body_json(query).await;
    assert_eq!(
        query_body["rows"].as_array().map(Vec::len),
        Some(1),
        "query must observe the healthy commit: {query_body}"
    );
}

/// Repeated hostile handlers are actually interrupted, not merely detached.
/// This is the resource half of ENG-24340: every timed-out action worker (and
/// its nested Hermes runtime) must be gone before its response is published.
#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn repeated_nested_timeouts_do_not_accumulate_action_workers() {
    let _serial = serial_action_test().await;
    set_watchdog_env();

    // Establish an empty baseline defensively before creating the hostile
    // actions whose worker lifecycle this test measures.
    tokio::time::timeout(Duration::from_secs(5), async {
        while snapback::server::detached_action_worker_count() != 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("pre-existing action workers must drain");

    let app = watchdog_app();
    let mut requests = Vec::new();
    for _ in 0..6 {
        let app = app.clone();
        requests.push(tokio::spawn(async move {
            let response = tokio::time::timeout(
                Duration::from_secs(3),
                app.oneshot(post_json(
                    "/action/nestedHungAction",
                    handler_body(json!({})),
                )),
            )
            .await
            .expect("watchdog response")
            .expect("action response");
            body_json(response).await
        }));
    }

    for request in requests {
        let body = request.await.expect("request task");
        assert_eq!(body["ok"], false, "timed-out action must fail: {body}");
        assert_eq!(
            body["diagnostic"]["code"], "SNAPBACK_ACTION_TIMEOUT",
            "timed-out action must keep the stable watchdog code: {body}"
        );
    }

    assert_eq!(
        snapback::server::detached_action_worker_count(),
        0,
        "timeout responses must not leave action CPU threads alive"
    );
}

/// While an Ibex action occupies its VM thread, mutations and (write-lane,
/// in-memory) queries proceed: the action no longer holds the global mutex.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn action_run_does_not_hold_the_write_mutex() {
    let _serial = serial_action_test().await;
    set_watchdog_env();
    let app = watchdog_app();

    let action_started = Instant::now();
    let action = {
        let app = app.clone();
        tokio::spawn(async move {
            let response = app
                .oneshot(post_json(
                    "/action/busyAction",
                    handler_body(json!({ "busyMs": 600 })),
                ))
                .await
                .expect("busy action response");
            (body_json(response).await, Instant::now())
        })
    };

    tokio::time::sleep(Duration::from_millis(150)).await;

    // At ~150ms into a ~600ms busy action, a request that secretly queued on
    // the write mutex takes ≥450ms; a free write lane answers in milliseconds.
    let mutation_started = Instant::now();
    let mutation = tokio::time::timeout(
        Duration::from_secs(2),
        app.clone().oneshot(post_json(
            "/mutation/createTodo",
            handler_body(json!({ "title": "mid-action write" })),
        )),
    )
    .await
    .expect("mutation must not stall behind the busy action")
    .expect("mutation response");
    let mutation_elapsed = mutation_started.elapsed();
    let mutation_body = body_json(mutation).await;
    assert!(
        mutation_body.get("version").is_some(),
        "mid-action mutation must commit: {mutation_body}"
    );
    assert!(
        mutation_elapsed < Duration::from_millis(450),
        "the mutation must not queue behind the busy action ({mutation_elapsed:?})"
    );

    // In-memory instances have no read lane: this query takes the write
    // mutex, which is exactly why it used to wedge for the action's duration.
    let query_started = Instant::now();
    let query = tokio::time::timeout(
        Duration::from_secs(2),
        app.clone()
            .oneshot(post_json("/query/listTodos", handler_body(json!({})))),
    )
    .await
    .expect("query must not stall behind the busy action")
    .expect("query response");
    let query_elapsed = query_started.elapsed();
    let query_body = body_json(query).await;
    assert_eq!(
        query_body["rows"]
            .as_array()
            .map(Vec::len)
            .unwrap_or_default(),
        1,
        "mid-action query must see the mid-action write: {query_body}"
    );
    assert!(
        query_elapsed < Duration::from_millis(450),
        "the in-memory query must not queue behind the busy action ({query_elapsed:?})"
    );
    let reads_finished = Instant::now();

    let (action_body, action_finished) = action.await.expect("action task");
    assert_eq!(
        action_body["ok"], true,
        "the busy action itself must succeed: {action_body}"
    );
    assert!(
        action_finished - action_started >= Duration::from_millis(550),
        "the busy action must actually have been long"
    );
    assert!(
        reads_finished < action_finished,
        "mutation and query must complete while the action is still running"
    );
}

/// An action that exceeds the watchdog fails with SNAPBACK_ACTION_TIMEOUT in
/// bounded time, its post-timeout `ctx.runMutation` is rejected (no commit
/// after the caller saw failure), and the instance stays healthy.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn watchdog_abandons_a_stuck_action_and_rejects_late_commits() {
    let _serial = serial_action_test().await;
    set_watchdog_env();
    let app = watchdog_app();

    let started = Instant::now();
    let response = tokio::time::timeout(
        Duration::from_secs(3),
        app.clone().oneshot(post_json(
            "/action/lateWriteAction",
            handler_body(json!({ "busyMs": 1600 })),
        )),
    )
    .await
    .expect("the watchdog must answer well before the action would finish")
    .expect("action response");
    let elapsed = started.elapsed();
    let body = body_json(response).await;

    assert_eq!(body["ok"], false, "timed-out action must fail: {body}");
    assert_eq!(
        body["diagnostic"]["code"], "SNAPBACK_ACTION_TIMEOUT",
        "diagnostic must be the watchdog code: {body}"
    );
    assert!(
        elapsed >= Duration::from_millis(WATCHDOG_MS - 100)
            && elapsed < Duration::from_millis(1500),
        "the caller must get the timeout at ~{WATCHDOG_MS}ms, not at action end ({elapsed:?})"
    );

    // Let the abandoned VM thread run out: its busy loop ends at ~1600ms and
    // its late ctx.runMutation must be rejected, not committed.
    tokio::time::sleep(Duration::from_millis(1300)).await;
    let query = app
        .clone()
        .oneshot(post_json("/query/listTodos", handler_body(json!({}))))
        .await
        .expect("query response");
    let query_body = body_json(query).await;
    let titles: Vec<&str> = query_body["rows"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|row| row["title"].as_str())
                .collect()
        })
        .unwrap_or_default();
    assert!(
        !titles.contains(&"late write"),
        "a commit must never land after the caller was told the action failed: {titles:?}"
    );

    // The instance is not wedged: an ordinary mutation still commits.
    let mutation = app
        .clone()
        .oneshot(post_json(
            "/mutation/createTodo",
            handler_body(json!({ "title": "after timeout" })),
        ))
        .await
        .expect("mutation response");
    let mutation_body = body_json(mutation).await;
    assert!(
        mutation_body.get("version").is_some(),
        "post-timeout mutation must commit: {mutation_body}"
    );
}

/// The action capability posture survives the detached refactor: `ctx.db`
/// stays denied to actions (fail-closed), exactly as on the in-lock path.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn detached_action_ctx_db_stays_denied() {
    let _serial = serial_action_test().await;
    set_watchdog_env();
    let app = watchdog_app();

    let action = app
        .clone()
        .oneshot(post_json("/action/readAction", handler_body(json!({}))))
        .await
        .expect("action response");
    let action_body = body_json(action).await;
    assert_eq!(
        action_body["ok"], false,
        "action ctx.db access must fail closed: {action_body}"
    );
    let details = action_body["diagnostic"]["details"]["message"]
        .as_str()
        .unwrap_or_default();
    assert!(
        details.contains("SNAPBACK_HANDLER_WRITE_IN_QUERY"),
        "denial must be the readonly/action policy error: {action_body}"
    );
}

/// ENG-23493: the config-verify probe runs through the same staged flow —
/// a hung probe no longer wedges the instance, the caller gets the watchdog
/// timeout as a failed verification in bounded time, and the outcome is
/// recorded in verification state either way.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn config_verify_probe_runs_detached_under_the_watchdog() {
    let _serial = serial_action_test().await;
    set_watchdog_env();
    let app = watchdog_app();

    for entry in ["quickKey", "hungKey"] {
        let set = app
            .clone()
            .oneshot(post_json(
                "/_snapback/api/config/set",
                json!({ "entry": entry, "value": "k1" }),
            ))
            .await
            .expect("config set response");
        assert_eq!(set.status(), 200, "config set must succeed for {entry}");
    }

    // A well-behaved probe verifies over the route exactly as before.
    let quick = app
        .clone()
        .oneshot(post_json(
            "/_snapback/api/config/verify",
            json!({ "entry": "quickKey" }),
        ))
        .await
        .expect("quick verify response");
    let quick_body = body_json(quick).await;
    assert_eq!(
        quick_body["ok"], true,
        "quick probe must pass: {quick_body}"
    );
    assert_eq!(quick_body["verified"]["ok"], true, "{quick_body}");

    // Kick off a verify whose probe outlives the watchdog.
    let verify_started = Instant::now();
    let verify = {
        let app = app.clone();
        tokio::spawn(async move {
            let response = app
                .oneshot(post_json(
                    "/_snapback/api/config/verify",
                    json!({ "entry": "hungKey" }),
                ))
                .await
                .expect("hung verify response");
            (body_json(response).await, Instant::now())
        })
    };

    tokio::time::sleep(Duration::from_millis(150)).await;

    // Mid-probe, a mutation must not queue behind the probe run: the probe
    // holds no instance lock while it occupies its VM thread.
    let mutation_started = Instant::now();
    let mutation = tokio::time::timeout(
        Duration::from_secs(2),
        app.clone().oneshot(post_json(
            "/mutation/createTodo",
            handler_body(json!({ "title": "mid-probe write" })),
        )),
    )
    .await
    .expect("mutation must not stall behind the hung probe")
    .expect("mutation response");
    let mutation_elapsed = mutation_started.elapsed();
    let mutation_body = body_json(mutation).await;
    assert!(
        mutation_body.get("version").is_some(),
        "mid-probe mutation must commit: {mutation_body}"
    );
    assert!(
        mutation_elapsed < Duration::from_millis(450),
        "the mutation must not queue behind the hung probe ({mutation_elapsed:?})"
    );

    // The caller gets the watchdog outcome at ~WATCHDOG_MS, not at probe end,
    // recorded as a failed verification rather than an HTTP error.
    let (verify_body, verify_finished) = verify.await.expect("verify task");
    let verify_elapsed = verify_finished - verify_started;
    assert_eq!(
        verify_body["ok"], false,
        "timed-out probe must record failure: {verify_body}"
    );
    let diagnostic = verify_body["verified"]["diagnostic"]
        .as_str()
        .unwrap_or_default();
    assert!(
        diagnostic.contains("SNAPBACK_ACTION_TIMEOUT"),
        "the record must carry the watchdog code: {verify_body}"
    );
    assert!(
        verify_elapsed >= Duration::from_millis(WATCHDOG_MS - 100)
            && verify_elapsed < Duration::from_millis(1500),
        "verify must answer at ~{WATCHDOG_MS}ms, not at probe end ({verify_elapsed:?})"
    );

    // Both outcomes landed in verification state through the finish window.
    let status = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/_snapback/api/config/status")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("status response");
    let status_body = body_json(status).await;
    let verified_ok = |entry: &str| {
        status_body["entries"]
            .as_array()
            .and_then(|entries| entries.iter().find(|e| e["name"] == entry))
            .map(|e| e["verified"]["ok"].clone())
    };
    assert_eq!(verified_ok("quickKey"), Some(json!(true)), "{status_body}");
    assert_eq!(verified_ok("hungKey"), Some(json!(false)), "{status_body}");
}

/// The admin cron tick drives the detached claim → execute → finish flow end
/// to end: the claimed run executes off the lock and lands a Succeeded record
/// whose mutation committed.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cron_tick_executes_claims_through_the_detached_flow() {
    let _serial = serial_action_test().await;
    set_watchdog_env();
    let app = watchdog_app();

    let tick = app
        .clone()
        .oneshot(post_json("/_snapback/api/cron/tick", json!({})))
        .await
        .expect("cron tick response");
    let records = body_json(tick).await;
    let records = records.as_array().expect("run records").clone();
    assert_eq!(records.len(), 1, "one due cron run expected: {records:?}");
    assert_eq!(
        records[0]["outcome"],
        serde_json::to_value(CronRunOutcome::Succeeded).expect("outcome json"),
        "cron run must succeed through the detached flow: {records:?}"
    );

    let query = app
        .clone()
        .oneshot(post_json("/query/listTodos", handler_body(json!({}))))
        .await
        .expect("query response");
    let query_body = body_json(query).await;
    let titles: Vec<&str> = query_body["rows"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|row| row["title"].as_str())
                .collect()
        })
        .unwrap_or_default();
    assert!(
        titles.contains(&"cron write"),
        "the cron action's mutation must have committed: {titles:?}"
    );
}
