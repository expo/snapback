//! ENG-23324 acceptance: actions no longer run under the global write mutex,
//! and a detached Ibex action is bounded by a coarse wall-clock watchdog.
//!
//! The wedge this protects against: an action stuck in a hung outbound fetch
//! used to hold the global mutex indefinitely, freezing all mutations, cron,
//! and (for in-memory instances) all queries. These tests use an in-memory
//! instance deliberately — its queries take the write mutex, so "the query
//! returns while an action runs" is the strongest form of the claim.
//!
//! Tests serialize action-runtime construction before setting the process-wide
//! watchdog posture, so a proof that is not about timeout timing may use a
//! wider budget without racing the timeout-focused cases.

fn test_detached_app_state(snapback: snapback::local::LocalSnapback) -> snapback::admin::AppState {
    snapback::admin::AppState::try_detached(snapback).expect("detached test app state")
}

use serde_json::{Value, json};
use snapback::cron::CronRunOutcome;
use snapback::local::LocalSnapback;
use snapback::manifest::{
    ConfigEntryDefinition, CronActivationPolicy, CronJitterPolicy, CronJobDefinition,
    CronOverlapPolicy, CronRetryMode, CronRetryPolicy, CronSchedule, FieldManifest, FieldType,
    FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime, IbexModule,
    SchemaManifest, TableManifest, TableVisibilityV1,
};
use snapback_server::test_support::axum::body::Body;
use snapback_server::test_support::axum::http::Request;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tower::ServiceExt;

/// Shared watchdog budget for timeout-focused cases (ms).
const WATCHDOG_MS: u64 = 800;
const NON_TIMEOUT_PROOF_WATCHDOG_MS: u64 = 30_000;
/// Cold native runtime/fetch startup is deliberately outside the mutex proof.
/// Keep this coarse bound below the non-timeout watchdog so a loaded proof host
/// cannot turn setup scheduling into a false lock regression.
const NATIVE_FETCH_START_BOUND: Duration = Duration::from_secs(12);
static ACTION_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn serial_action_test() -> tokio::sync::MutexGuard<'static, ()> {
    ACTION_TEST_LOCK.lock().await
}

fn set_watchdog_env_ms(timeout_ms: u64) {
    // SAFETY: every test holds ACTION_TEST_LOCK before changing this
    // process-global posture and keeps the guard through runtime teardown.
    unsafe { std::env::set_var("SNAPBACK_ACTION_TIMEOUT_MS", timeout_ms.to_string()) };
    // All tests in this binary set the same process-global host posture before
    // constructing a runtime. The generation regression uses a real native
    // fetch pause so it can prove a host-call-free completion fence.
    unsafe { std::env::set_var("SNAPBACK_OUTBOUND_ACTIONS", "1") };
}

fn set_watchdog_env() {
    set_watchdog_env_ms(WATCHDOG_MS);
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

  async leakingAction(ctx) {
    const secret = ctx.secrets.get('leakKey').expose();
    throw new Error(`public action leaked ${encodeURIComponent(secret)}`);
  },

  async rotatingSecretCron(ctx) {
    const secret = ctx.secrets.get('leakKey').expose();
    await fetch(secret);
    throw new Error(`rotated cron leaked ${encodeURIComponent(secret)}`);
  },

  async quickProbe(ctx) {
    return { ok: true };
  },

  async heldProbe(ctx, args) {
    const url = ctx.secrets.get(args.entry).expose();
    await fetch(url);
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
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            // This fixture exercises watchdog and lock behavior, not an
            // owner-policy write. Declare the phase-1a non-owner posture
            // explicitly so generic writes cannot rely on omitted policy.
            visibility: Some(TableVisibilityV1::PublicRead),
            history: None,
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

fn secret_entry(name: &str) -> ConfigEntryDefinition {
    ConfigEntryDefinition {
        name: name.to_owned(),
        description: Some("secret redaction test entry".to_owned()),
        purpose: None,
        secret: true,
        required: false,
        pool: false,
        probe: None,
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
    let mut leaking_action = ibex("leakingAction", FunctionKind::Action);
    leaking_action.uses = vec!["leakKey".to_owned()];
    let mut rotating_secret_cron = ibex("rotatingSecretCron", FunctionKind::Action);
    rotating_secret_cron.uses = vec!["leakKey".to_owned()];
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
            leaking_action,
            rotating_secret_cron,
            ibex("quickProbe", FunctionKind::Action),
            ibex("heldProbe", FunctionKind::Action),
            ibex("hungProbe", FunctionKind::Action),
        ],
        config: vec![
            secret_entry("leakKey"),
            config_entry("quickKey", "quickProbe"),
            config_entry("heldKey", "heldProbe"),
            config_entry("heldRecreateKey", "heldProbe"),
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

async fn watchdog_state_and_app() -> (
    snapback::server::SharedSnapback,
    snapback::server::SnapbackApp,
) {
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L7 applies to
    // integration-fixture schema activation too: item 6's authorization
    // interlock reads the durable commit version during `apply_schema`.
    tokio::task::spawn_blocking(|| {
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        let mut snapback = LocalSnapback::memory().expect("memory snapback");
        snapback
            .apply_schema(watchdog_schema())
            .expect("apply schema");
        let diagnostics = snapback.load_functions(watchdog_functions());
        assert!(
            diagnostics
                .iter()
                .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED")
        );
        let app_state = test_detached_app_state(snapback);
        let state = app_state.snapback.clone();
        (state, snapback::server::app(app_state))
    })
    .await
    .expect("watchdog fixture blocking setup")
}

async fn watchdog_app() -> snapback::server::SnapbackApp {
    watchdog_state_and_app().await.1
}

fn post_json(uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request")
}

async fn body_json(response: snapback_server::test_support::axum::response::Response) -> Value {
    let bytes =
        snapback_server::test_support::axum::body::to_bytes(response.into_body(), usize::MAX)
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

fn start_paused_action(
    app: snapback::server::SnapbackApp,
    url: String,
) -> tokio::task::JoinHandle<Value> {
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

async fn await_paused_action_fetch_start(
    label: &str,
    started: oneshot::Receiver<()>,
    action: &mut tokio::task::JoinHandle<Value>,
) {
    let started = tokio::time::timeout(NATIVE_FETCH_START_BOUND, started);
    tokio::pin!(started);
    tokio::select! {
        started = &mut started => {
            started
                .unwrap_or_else(|_| panic!("{label}: action reaches native fetch before the coarse setup bound"))
                .unwrap_or_else(|_| panic!("{label}: fetch-start signal"));
        }
        result = action => {
            let body = result.unwrap_or_else(|error| panic!("{label}: action task before native fetch: {error}"));
            panic!("{label}: action returned before reaching native fetch: {body}");
        }
    }
}

fn start_paused_mutation_action(
    app: snapback::server::SnapbackApp,
    url: String,
) -> tokio::task::JoinHandle<Value> {
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

/// ENG-24560 — diagnostics are scrubbed at the invocation boundary with the
/// staging-time secret set. Public action errors cannot expose a configured
/// value, and rotating that value while a detached cron action is in flight
/// cannot make the old value escape into the run ledger or inspect rings.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn detached_action_secret_redaction_survives_config_rotation() {
    let _serial = serial_action_test().await;
    set_watchdog_env_ms(NON_TIMEOUT_PROOF_WATCHDOG_MS);
    let (secret_a, fetch_started, release_fetch, fetch_server) = held_http_response().await;

    let mut manifest = watchdog_functions();
    manifest.cron_jobs = vec![CronJobDefinition {
        name: "rotatingSecret".to_owned(),
        schedule: CronSchedule {
            every_ms: Some(60_000),
            cron: None,
        },
        action: "rotatingSecretCron".to_owned(),
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
        required_capabilities: Vec::new(),
        target_wakeup: None,
        source_span: None,
    }];
    let fixture_secret = secret_a.clone();
    let (state, app) = tokio::task::spawn_blocking(move || {
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        let mut snapback = LocalSnapback::memory().expect("memory snapback");
        snapback.apply_schema(watchdog_schema()).expect("schema");
        let diagnostics = snapback.load_functions(manifest);
        assert!(diagnostics.iter().all(|diagnostic| {
            diagnostic.severity != snapback::diagnostic::DiagnosticSeverity::Error
        }));
        snapback
            .set_config_entry("leakKey", vec![fixture_secret], false, "test")
            .expect("set secret A");
        let app_state = test_detached_app_state(snapback);
        let state = app_state.snapback.clone();
        (state, snapback::server::app(app_state))
    })
    .await
    .expect("secret-redaction fixture blocking setup");

    let public_action = app
        .clone()
        .oneshot(post_json("/action/leakingAction", handler_body(json!({}))))
        .await
        .expect("public action response");
    let public_action = serde_json::to_string(&body_json(public_action).await).unwrap();
    assert!(!public_action.contains(&secret_a), "{public_action}");
    assert!(public_action.contains("[REDACTED]"), "{public_action}");

    let cron_app = app.clone();
    let mut cron = tokio::spawn(async move {
        let response = cron_app
            .oneshot(post_json(
                "/_snapback/api/cron/rotatingSecret/run",
                json!({}),
            ))
            .await
            .expect("manual cron response");
        body_json(response).await
    });
    await_paused_action_fetch_start("secret-rotation cron", fetch_started, &mut cron).await;
    state
        .lock()
        .await
        .set_config_entry(
            "leakKey",
            vec!["replacement-secret-B".to_owned()],
            false,
            "test",
        )
        .expect("rotate secret to B");
    release_fetch.send(()).expect("release held cron fetch");
    let cron_body = serde_json::to_string(
        &tokio::time::timeout(NATIVE_FETCH_START_BOUND, cron)
            .await
            .expect("cron settles")
            .expect("cron task"),
    )
    .unwrap();
    fetch_server.await.expect("held fetch server");
    assert!(!cron_body.contains(&secret_a), "{cron_body}");
    assert!(cron_body.contains("[REDACTED]"), "{cron_body}");

    let inspect = body_json(
        app.oneshot(
            Request::builder()
                .uri("/_snapback/api/inspect")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("gated inspect"),
    )
    .await;
    let inspect = serde_json::to_string(&inspect).unwrap();
    assert!(!inspect.contains(&secret_a), "{inspect}");
}

/// One host-call-free completion-fence cycle (ENG-24530): pause an action in a
/// held native fetch, advance the app generation while it is paused, release the
/// fetch, and require the stale completion to fail with the generation fence —
/// with an explicit fetch-start rendezvous instead of any timing threshold.
///
/// The vendored Ibex runtime closes the historical erase-before-enqueue
/// settlement window, while Snapback keeps the caller-side floor precedence as
/// defense in depth. A reload/reset that crossed the action's async span is the
/// precise cause and must not be masked by `SNAPBACK_HANDLER_DID_NOT_SETTLE`.
async fn assert_paused_action_generation_fence(
    state: &snapback::server::SharedSnapback,
    app: snapback::server::SnapbackApp,
    label: &str,
    advance_generation: impl FnOnce(&mut LocalSnapback),
) {
    let (url, started, release, server) = held_http_response().await;
    let mut action = start_paused_action(app, url);
    await_paused_action_fetch_start(label, started, &mut action).await;
    // Causal ordering, not a sleep: the fetch is proven active (its request
    // headers reached the fixture) before the generation advances.
    {
        let mut guard = state.lock().await;
        advance_generation(&mut guard);
    }
    release
        .send(())
        .unwrap_or_else(|_| panic!("{label}: release paused fetch"));
    let body = tokio::time::timeout(Duration::from_secs(2), action)
        .await
        .unwrap_or_else(|_| panic!("{label}: paused action settles"))
        .unwrap_or_else(|_| panic!("{label}: paused action task"));
    server
        .await
        .unwrap_or_else(|_| panic!("{label}: paused fetch server"));
    assert_eq!(body["ok"], false, "{label}: stale action must fail: {body}");
    assert_eq!(
        body["diagnostic"]["code"], "SNAPBACK_ACTION_GENERATION_CONFLICT",
        "{label}: host-call-free completion must observe the generation advance, \
         not a settlement-floor diagnostic: {body}"
    );
}

/// Assert `load_functions` over the watchdog manifest reports only the expected
/// positive embedded-runtime load event.
fn assert_watchdog_reload(snapback: &mut LocalSnapback) {
    let diagnostics = snapback.load_functions(watchdog_functions());
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED")
    );
}

/// A detached action can cross an app generation without another ctx host op:
/// native fetch/timer work settles inside Ibex. Completion itself is therefore
/// a generation fence, not merely every host call along the way.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn paused_host_call_free_action_rejects_reload_and_reset_drift() {
    let _serial = serial_action_test().await;
    // This proof exercises the completion-time generation fence, not timeout
    // timing. Function reload can spawn the Ibex CLI and exceed the 800ms
    // hostile-handler budget on a loaded full-suite host; keep that unrelated
    // watchdog from winning the race we are trying to observe.
    set_watchdog_env_ms(NON_TIMEOUT_PROOF_WATCHDOG_MS);
    let (state, app) = watchdog_state_and_app().await;

    assert_paused_action_generation_fence(&state, app.clone(), "reload", assert_watchdog_reload)
        .await;
    assert_paused_action_generation_fence(&state, app, "reset", |snapback| {
        snapback.reset().expect("reset while action is paused");
    })
    .await;
}

/// ENG-24530 stress proof: the completion-time generation fence must never be
/// masked by the settlement-floor diagnostic. Vendored Ibex now makes the
/// fetch handoff continuously visible as pending work; this repeats the exact
/// generation-fence assertion so either a runtime handoff regression or
/// caller-side masking regression is caught rather than tolerated.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn paused_host_call_free_action_generation_fence_survives_settlement_race() {
    let _serial = serial_action_test().await;
    set_watchdog_env_ms(NON_TIMEOUT_PROOF_WATCHDOG_MS);
    let (state, app) = watchdog_state_and_app().await;

    for iteration in 0..24 {
        assert_paused_action_generation_fence(
            &state,
            app.clone(),
            &format!("reload#{iteration}"),
            assert_watchdog_reload,
        )
        .await;
        assert_paused_action_generation_fence(
            &state,
            app.clone(),
            &format!("reset#{iteration}"),
            |snapback| {
                snapback.reset().expect("reset while action is paused");
            },
        )
        .await;
    }
}

/// A host call can reach the instance mutex after detached execution begins.
/// Even if that mutex is then held forever, the public watchdog must answer
/// and the action OS worker must drain while the lock remains unavailable.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn permanently_held_instance_mutex_does_not_leak_action_worker() {
    let _serial = serial_action_test().await;
    // Warm the process-global native fetch path outside this timeout-focused
    // proof. On a loaded host, first-use runtime/network initialization can
    // exceed the deliberately short watchdog before the request reaches the
    // fixture; that setup latency says nothing about lock-wait abandonment.
    set_watchdog_env_ms(NON_TIMEOUT_PROOF_WATCHDOG_MS);

    tokio::time::timeout(Duration::from_secs(5), async {
        while snapback::server::detached_action_worker_count() != 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("pre-existing action workers must drain");
    let baseline = snapback::server::detached_action_worker_count();

    let (state, app) = watchdog_state_and_app().await;
    let (warm_url, warm_started, release_warm, warm_server) = held_http_response().await;
    let mut warm_action = start_paused_action(app.clone(), warm_url);
    await_paused_action_fetch_start("held-lock warmup", warm_started, &mut warm_action).await;
    release_warm.send(()).expect("release held-lock warmup");
    let warm_body = tokio::time::timeout(NATIVE_FETCH_START_BOUND, warm_action)
        .await
        .expect("held-lock warmup settles")
        .expect("held-lock warmup task");
    warm_server.await.expect("held-lock warmup server");
    assert_eq!(warm_body["ok"], true, "held-lock warmup: {warm_body}");

    set_watchdog_env();
    let (url, fetch_started, release_fetch, fetch_server) = held_http_response().await;
    let started = Instant::now();
    let mut action = start_paused_mutation_action(app, url);
    await_paused_action_fetch_start("held-lock proof", fetch_started, &mut action).await;

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
    // The `tokio::time::timeout` above is the hard two-second response bound.
    // Do not add a second, tighter wall-clock ceiling here: a loaded host can
    // delay polling the already-completed watchdog future. The semantic proof
    // below is stronger — the response is not published until the detached OS
    // worker has drained while the instance mutex is still unavailable.
    assert!(
        elapsed >= Duration::from_millis(WATCHDOG_MS - 100),
        "the permanent mutex hold returned before the watchdog ({elapsed:?})"
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
    let app = watchdog_app().await;

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
        elapsed >= Duration::from_millis(WATCHDOG_MS - 100),
        "the nested handler returned before the watchdog ({elapsed:?})"
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

    let app = watchdog_app().await;
    let mut requests = Vec::new();
    for _ in 0..6 {
        let app = app.clone();
        requests.push(tokio::spawn(async move {
            let response = tokio::time::timeout(
                Duration::from_secs(5),
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
        // An inner Hermes deadline reports directly after the worker guard has
        // dropped and has no workerTerminated field. If the outer watchdog wins,
        // it must explicitly attest teardown rather than publish `false` for
        // this CPU-only case.
        assert_ne!(
            body["diagnostic"]["details"]["workerTerminated"].as_bool(),
            Some(false),
            "CPU-bound action workers must terminate before timeout publication: {body}"
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
    // This proof holds a native fetch open as a structural concurrency witness;
    // it is not testing watchdog timing.
    set_watchdog_env_ms(NON_TIMEOUT_PROOF_WATCHDOG_MS);
    let app = watchdog_app().await;

    let (url, fetch_started, release_fetch, fetch_server) = held_http_response().await;
    let mut action = start_paused_action(app.clone(), url);
    await_paused_action_fetch_start("mutex proof", fetch_started, &mut action).await;
    assert!(
        !action.is_finished(),
        "held fetch must keep the action active"
    );

    // The fixture will not answer until release_fetch is sent. If the detached
    // action still owned the instance mutex, these requests would hit their
    // coarse deadlock bounds instead of completing while the action is active.
    let mutation = tokio::time::timeout(
        Duration::from_secs(2),
        app.clone().oneshot(post_json(
            "/mutation/createTodo",
            handler_body(json!({ "title": "mid-action write" })),
        )),
    )
    .await
    .expect("mutation must not stall behind the held action")
    .expect("mutation response");
    let mutation_body = body_json(mutation).await;
    assert!(
        mutation_body.get("version").is_some(),
        "mid-action mutation must commit: {mutation_body}"
    );
    assert!(
        !action.is_finished(),
        "mutation must finish before the held action"
    );

    // In-memory instances have no read lane: this query takes the write
    // mutex, which is exactly why it used to wedge for the action's duration.
    let query = tokio::time::timeout(
        Duration::from_secs(2),
        app.clone()
            .oneshot(post_json("/query/listTodos", handler_body(json!({})))),
    )
    .await
    .expect("query must not stall behind the held action")
    .expect("query response");
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
        !action.is_finished(),
        "query must finish before the held action"
    );

    release_fetch.send(()).expect("release mutex-proof fetch");
    let action_body = tokio::time::timeout(Duration::from_secs(2), action)
        .await
        .expect("released action settles")
        .expect("action task");
    fetch_server.await.expect("mutex-proof fetch server");
    assert_eq!(
        action_body["ok"], true,
        "the released action itself must succeed: {action_body}"
    );
}

/// An action that exceeds the watchdog fails with SNAPBACK_ACTION_TIMEOUT in
/// bounded time, its post-timeout `ctx.runMutation` is rejected (no commit
/// after the caller saw failure), and the instance stays healthy.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn watchdog_abandons_a_stuck_action_and_rejects_late_commits() {
    let _serial = serial_action_test().await;
    set_watchdog_env();
    let app = watchdog_app().await;
    let worker_baseline = snapback::server::detached_action_worker_count();

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
        elapsed >= Duration::from_millis(WATCHDOG_MS - 100),
        "the caller returned before the watchdog ({elapsed:?})"
    );
    assert_eq!(
        snapback::server::detached_action_worker_count(),
        worker_baseline,
        "the interrupted action worker must drain before its result is published"
    );

    // The worker counter is decremented only after the native worker destroys
    // its runtime, and its result callback runs after that guard. Unlike the
    // old fixed sleep, this absence check therefore cannot run while a slow
    // abandoned handler still has a possible late-write path.
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
    let app = watchdog_app().await;

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
    // Separate the mutex proof from the timeout proof. A held native fetch is
    // a structural concurrency witness, so give it a deliberately wide
    // watchdog and release it explicitly after the concurrent mutation.
    set_watchdog_env_ms(NON_TIMEOUT_PROOF_WATCHDOG_MS);
    let app = watchdog_app().await;
    let (held_url, held_started, release_held, held_server) = held_http_response().await;
    let (recreate_url, recreate_started, release_recreate, recreate_server) =
        held_http_response().await;

    for (entry, value) in [
        ("quickKey", "k1".to_owned()),
        ("heldKey", held_url),
        ("heldRecreateKey", recreate_url),
        ("hungKey", "k1".to_owned()),
    ] {
        let set = app
            .clone()
            .oneshot(post_json(
                "/_snapback/api/config/set",
                json!({ "entry": entry, "value": value }),
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

    // Hold a probe in native fetch and wait for its explicit rendezvous before
    // issuing the mutation. This proves the probe is active without relying
    // on a scheduler-sensitive sleep or millisecond threshold.
    let mut held_verify = {
        let app = app.clone();
        tokio::spawn(async move {
            let response = app
                .oneshot(post_json(
                    "/_snapback/api/config/verify",
                    json!({ "entry": "heldKey" }),
                ))
                .await
                .expect("held verify response");
            body_json(response).await
        })
    };
    await_paused_action_fetch_start("held config probe", held_started, &mut held_verify).await;

    // Mid-probe, a mutation must not queue behind the probe run: the probe
    // holds no instance lock while it occupies its VM thread.
    let mutation = tokio::time::timeout(
        Duration::from_secs(2),
        app.clone().oneshot(post_json(
            "/mutation/createTodo",
            handler_body(json!({ "title": "mid-probe write" })),
        )),
    )
    .await
    .expect("mutation must not stall behind the held probe")
    .expect("mutation response");
    let mutation_body = body_json(mutation).await;
    assert!(
        mutation_body.get("version").is_some(),
        "mid-probe mutation must commit: {mutation_body}"
    );
    assert!(
        !held_verify.is_finished(),
        "the mutation must commit while the held probe is still active"
    );
    let replacement = app
        .clone()
        .oneshot(post_json(
            "/_snapback/api/config/set",
            json!({ "entry": "heldKey", "value": "replacement-value" }),
        ))
        .await
        .expect("replace held config response");
    assert_eq!(replacement.status(), 200);
    release_held.send(()).expect("release held config probe");
    let held_body = tokio::time::timeout(Duration::from_secs(2), held_verify)
        .await
        .expect("released held probe settles")
        .expect("held verify task");
    held_server.await.expect("held config-probe server");
    assert_eq!(
        held_body["diagnostic"]["code"], "SNAPBACK_CONFIG_VERIFY_STALE",
        "a probe for the replaced value must be discarded: {held_body}"
    );

    // Delete/recreate is a distinct entry identity even when it happens under
    // the same name. A staged probe for the deleted identity cannot attest the
    // replacement.
    let mut recreate_verify = {
        let app = app.clone();
        tokio::spawn(async move {
            let response = app
                .oneshot(post_json(
                    "/_snapback/api/config/verify",
                    json!({ "entry": "heldRecreateKey" }),
                ))
                .await
                .expect("recreated-entry verify response");
            body_json(response).await
        })
    };
    await_paused_action_fetch_start(
        "recreated-entry config probe",
        recreate_started,
        &mut recreate_verify,
    )
    .await;
    let unset = app
        .clone()
        .oneshot(post_json(
            "/_snapback/api/config/unset",
            json!({ "entry": "heldRecreateKey" }),
        ))
        .await
        .expect("unset held config response");
    assert_eq!(unset.status(), 200);
    let recreate = app
        .clone()
        .oneshot(post_json(
            "/_snapback/api/config/set",
            json!({ "entry": "heldRecreateKey", "value": "recreated-value" }),
        ))
        .await
        .expect("recreate held config response");
    assert_eq!(recreate.status(), 200);
    release_recreate
        .send(())
        .expect("release delete/recreate probe");
    let recreate_body = tokio::time::timeout(Duration::from_secs(2), recreate_verify)
        .await
        .expect("delete/recreate probe settles")
        .expect("delete/recreate verify task");
    recreate_server
        .await
        .expect("delete/recreate config-probe server");
    assert_eq!(
        recreate_body["diagnostic"]["code"], "SNAPBACK_CONFIG_VERIFY_STALE",
        "a probe for a deleted identity must not attest its replacement: {recreate_body}"
    );

    // Independently prove the config route's watchdog outcome. The timeout is
    // read per detached invocation, and the serial guard makes this posture
    // switch safe after the held probe has fully settled.
    set_watchdog_env();
    let verify_started = Instant::now();
    let verify = tokio::time::timeout(
        Duration::from_secs(3),
        app.clone().oneshot(post_json(
            "/_snapback/api/config/verify",
            json!({ "entry": "hungKey" }),
        )),
    )
    .await
    .expect("hung verify must answer under the watchdog")
    .expect("hung verify response");
    let verify_elapsed = verify_started.elapsed();
    let verify_body = body_json(verify).await;
    assert_eq!(
        verify_body["ok"], false,
        "timed-out probe must record failure: {verify_body}"
    );
    assert!(
        verify_body["verified"].get("diagnostic").is_none(),
        "handler/runtime diagnostics must not cross the AdminRead config projection: {verify_body}"
    );
    assert!(
        verify_elapsed >= Duration::from_millis(WATCHDOG_MS - 100),
        "verify returned before the watchdog ({verify_elapsed:?})"
    );

    // All three outcomes landed in verification state through the finish window.
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
    assert_eq!(verified_ok("heldKey"), Some(Value::Null), "{status_body}");
    assert_eq!(
        verified_ok("heldRecreateKey"),
        Some(Value::Null),
        "{status_body}"
    );
    assert_eq!(verified_ok("hungKey"), Some(json!(false)), "{status_body}");
}

/// The admin cron tick drives the detached claim → execute → finish flow end
/// to end: the claimed run executes off the lock and lands a Succeeded record
/// whose mutation committed.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cron_tick_executes_claims_through_the_detached_flow() {
    let _serial = serial_action_test().await;
    set_watchdog_env();
    let app = watchdog_app().await;

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
