//! LLP 0036 v1 acceptance: declared config entries, per-action grants, the
//! opaque handle, the file store, and the gated `/_snapback/api/config/*` ops.
//!
//! @ref LLP 0036#implementation-order — the acceptance sketch's positive and
//! negative claims: grants rotate, every accidental materialization redacts,
//! queries/mutations get no config surface, reset preserves config, and no
//! operation or envelope ever contains a value.

fn test_app_state_from_snapback(
    snapback: snapback::local::LocalSnapback,
    context: snapback::admin::ServerContext,
) -> snapback::admin::AppState {
    snapback::admin::AppState::try_from_snapback(snapback, context).expect("test app state")
}

use serde_json::{Value, json};
use snapback::admin::ServerContext;
use snapback::local::LocalSnapback;
use snapback::manifest::{
    ConfigEntryDefinition, FieldManifest, FieldType, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, IbexModule, SchemaManifest, TableManifest,
};
use snapback_server::test_support::axum::body::Body;
use snapback_server::test_support::axum::http::{Request, StatusCode};
use tower::ServiceExt;

// --- Manifest fixtures --------------------------------------------------------

fn probe_schema() -> SchemaManifest {
    SchemaManifest {
        tables: vec![TableManifest {
            name: "probe".to_owned(),
            fields: vec![FieldManifest {
                name: "label".to_owned(),
                field_type: FieldType::String,
                optional: false,
            }],
            indexes: vec![],
            syncable: false,
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
        ..Default::default()
    }
}

const HANDLERS: &str = r#"
globalThis.__snapbackHandlers = {
  async useKeys(ctx) {
    var out = {};
    try {
      var handle = ctx.secrets.rotating('feedKeys');
      out.exposed = handle.expose();
      out.stringified = JSON.stringify(handle);
      out.template = "" + handle;
      out.bearer = handle.asBearer();
    } catch (error) {
      out.rotatingError = error.message;
    }
    try {
      ctx.secrets.get('somethingElse');
      out.undeclared = 'no error (BUG)';
    } catch (error) {
      out.undeclared = error.message;
    }
    return out;
  },
  async useKeysRaw(ctx) {
    // No catch: proves the structured diagnostic code mapping.
    return { got: ctx.secrets.get('feedKeys').expose() };
  },
  async useOther(ctx) {
    // Not granted feedKeys: proves CONFIG_UNDECLARED as a structured code.
    return { got: ctx.secrets.get('feedKeys').expose() };
  },
  async probeKeys(ctx) {
    // The probe: implicitly granted the entry it verifies.
    var handle = ctx.secrets.get('feedKeys');
    var value = handle.expose();
    if (value === 'force-handler-failure') {
      return { ok: false, message: 'HANDLER_CONTROLLED_CONFIG_DIAGNOSTIC_SENTINEL' };
    }
    return { ok: value.length > 0 };
  },
  async probeExact(ctx) {
    // A shared probe receives the entry being verified, not every entry that
    // happens to name this function as its probe.
    ctx.secrets.get('feedKeys').expose();
    try {
      ctx.secrets.get('otherKey').expose();
      return { ok: false, message: 'CONFIG_VERIFY_GRANT_WAS_NOT_EXACT' };
    } catch (_error) {
      return { ok: true };
    }
  }
};
"#;

fn ibex_action(name: &str, uses: &[&str]) -> FunctionDefinition {
    let mut definition = FunctionDefinition::new(
        name,
        FunctionKind::Action,
        FunctionRuntime::IbexModule(IbexModule {
            source: HANDLERS.to_owned(),
            export: name.to_owned(),
        }),
    );
    definition.uses = uses.iter().map(|s| (*s).to_owned()).collect();
    definition
}

fn entry(name: &str) -> ConfigEntryDefinition {
    ConfigEntryDefinition {
        name: name.to_owned(),
        description: Some("test entry".to_owned()),
        purpose: None,
        secret: true,
        required: true,
        pool: true,
        probe: None,
        how_to_get: None,
        acquisition: None,
        default: None,
        source_span: None,
    }
}

fn config_manifest() -> FunctionManifest {
    let mut feed = entry("feedKeys");
    feed.probe = Some("probeKeys".to_owned());
    FunctionManifest {
        functions: vec![
            ibex_action("useKeys", &["feedKeys"]),
            ibex_action("useKeysRaw", &["feedKeys"]),
            ibex_action("useOther", &[]),
            ibex_action("probeKeys", &[]),
        ],
        config: vec![feed],
        ..Default::default()
    }
}

fn configured() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(probe_schema()).expect("apply schema");
    let diagnostics = snapback.load_functions(config_manifest());
    assert!(
        !diagnostics
            .iter()
            .any(|d| d.severity == snapback::diagnostic::DiagnosticSeverity::Error),
        "unexpected load errors: {diagnostics:?}"
    );
    snapback
}

fn run_action(snapback: &mut LocalSnapback, name: &str) -> snapback::local::FunctionRunResult {
    snapback.run_function(
        name,
        HandlerInput {
            args: json!({}),
            auth: Default::default(),
            read_set: Vec::new(),
            correlation: None,
            ctx_ledger: None,
        },
    )
}

// --- Manifest validation (fail closed) -----------------------------------------

#[test]
fn non_secret_and_default_entries_are_rejected_fail_closed() {
    let mut snapback = LocalSnapback::memory().unwrap();
    snapback.apply_schema(probe_schema()).unwrap();
    let mut non_secret = entry("plainSetting");
    non_secret.secret = false;
    let mut with_default = entry("hasDefault");
    with_default.default = Some(json!("x"));
    for (invalid, expected_code) in [
        (non_secret, "SNAPBACK_CONFIG_NON_SECRET_UNIMPLEMENTED"),
        (with_default, "SNAPBACK_CONFIG_DEFAULT_UNIMPLEMENTED"),
    ] {
        let diagnostics = snapback.load_functions(FunctionManifest {
            config: vec![invalid],
            ..Default::default()
        });
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        assert_eq!(diagnostics[0].code, expected_code, "{diagnostics:?}");
        // A semantically invalid artifact is rejected as one generation; no
        // declaration from it becomes effective.
        assert!(snapback.config_status().entries.is_empty());
    }
}

#[test]
fn probe_validation_rejects_unknown_and_non_action_probes() {
    let mut snapback = LocalSnapback::memory().unwrap();
    snapback.apply_schema(probe_schema()).unwrap();
    let mut ghost = entry("ghostProbe");
    ghost.probe = Some("noSuchFunction".to_owned());
    let manifest = FunctionManifest {
        config: vec![ghost],
        ..Default::default()
    };
    let diagnostics = snapback.load_functions(manifest);
    assert!(
        diagnostics
            .iter()
            .any(|d| d.code == "SNAPBACK_CONFIG_PROBE_INVALID"),
        "{diagnostics:?}"
    );
    assert!(snapback.config_status().entries.is_empty());
}

#[test]
fn uses_naming_unknown_entries_and_missing_required_are_diagnosed() {
    let mut snapback = LocalSnapback::memory().unwrap();
    snapback.apply_schema(probe_schema()).unwrap();
    let invalid = FunctionManifest {
        functions: vec![ibex_action("useKeys", &["neverDeclared"])],
        config: vec![entry("feedKeys")],
        ..Default::default()
    };
    let diagnostics = snapback.load_functions(invalid);
    assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
    assert_eq!(diagnostics[0].code, "SNAPBACK_CONFIG_USES_UNKNOWN");
    assert!(snapback.required_missing_config().is_empty());

    // Required-missing is a status warning for a valid, installed generation;
    // it is not appended after an invalid generation has already failed.
    let diagnostics = snapback.load_functions(FunctionManifest {
        config: vec![entry("feedKeys")],
        ..Default::default()
    });
    let codes: Vec<&str> = diagnostics.iter().map(|d| d.code.as_str()).collect();
    assert!(
        codes.contains(&"SNAPBACK_CONFIG_REQUIRED_MISSING"),
        "{codes:?}"
    );
    assert_eq!(
        snapback.required_missing_config(),
        vec!["feedKeys".to_owned()]
    );
}

// --- Grants, handles, rotation, redaction ---------------------------------------

#[test]
fn granted_handles_rotate_the_pool_and_redact_every_materialization() {
    let mut snapback = configured();
    snapback
        .set_config_entry("feedKeys", vec!["k1".into(), "k2".into()], false, "cli")
        .expect("set pool");

    let first = run_action(&mut snapback, "useKeys");
    assert!(first.ok, "{:?}", first.diagnostic);
    let result = first.result.unwrap();
    assert_eq!(result["exposed"], "k1");
    let marker = "[snapback secret feedKeys]";
    assert_eq!(
        result["stringified"].as_str(),
        Some(format!("\"{marker}\"").as_str()),
        "JSON.stringify yields the quoted marker, never the value"
    );
    assert_eq!(result["template"], marker);
    assert_eq!(result["bearer"], "Bearer k1");
    assert!(
        result["undeclared"]
            .as_str()
            .unwrap()
            .contains("SNAPBACK_CONFIG_UNDECLARED"),
        "{result:?}"
    );

    let second = run_action(&mut snapback, "useKeys");
    assert_eq!(
        second.result.unwrap()["exposed"],
        "k2",
        "rotation walks the pool"
    );
}

#[test]
fn missing_and_undeclared_access_map_to_structured_codes() {
    let mut snapback = configured();
    // Declared but unset → SNAPBACK_CONFIG_MISSING.
    let missing = run_action(&mut snapback, "useKeysRaw");
    assert!(!missing.ok);
    assert_eq!(missing.diagnostic.unwrap().code, "SNAPBACK_CONFIG_MISSING");

    snapback
        .set_config_entry("feedKeys", vec!["k1".into()], false, "cli")
        .expect("set");
    let ok = run_action(&mut snapback, "useKeysRaw");
    assert!(ok.ok, "{:?}", ok.diagnostic);

    // Set, but outside this function's uses grant → SNAPBACK_CONFIG_UNDECLARED.
    let undeclared = run_action(&mut snapback, "useOther");
    assert!(!undeclared.ok);
    assert_eq!(
        undeclared.diagnostic.unwrap().code,
        "SNAPBACK_CONFIG_UNDECLARED"
    );
}

// --- Store semantics ------------------------------------------------------------

#[test]
fn config_survives_reset_and_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("dev.sqlite3");
    {
        let mut snapback = LocalSnapback::open(&db_path).unwrap();
        snapback.apply_schema(probe_schema()).unwrap();
        snapback.load_functions(config_manifest());
        snapback
            .set_config_entry("feedKeys", vec!["k1".into()], false, "cli")
            .unwrap();
        snapback.reset().expect("reset");
        let status = snapback.config_status();
        assert!(status.entries[0].set, "reset must not clear config (D2)");
    }
    // A fresh process over the same instance dir sees the value.
    let snapback = LocalSnapback::open(&db_path).unwrap();
    // Manifest is not persisted, so status has no declarations yet — but the
    // store itself must have survived; reloading declarations re-joins them.
    let mut snapback = snapback;
    snapback.apply_schema(probe_schema()).unwrap();
    snapback.load_functions(config_manifest());
    let status = snapback.config_status();
    assert!(status.entries[0].set, "store persists across reopen");
    assert_eq!(status.entries[0].source.as_deref(), Some("cli"));
}

#[test]
fn set_validation_rejects_undeclared_and_non_pool_shapes() {
    let mut snapback = configured();
    let error = snapback
        .set_config_entry("nope", vec!["x".into()], false, "cli")
        .unwrap_err();
    assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_UNDECLARED");

    // Make feedKeys a non-pool entry to prove the shape check.
    let mut manifest = config_manifest();
    manifest.config[0].pool = false;
    let mut single = LocalSnapback::memory().unwrap();
    single.apply_schema(probe_schema()).unwrap();
    single.load_functions(manifest);
    let error = single
        .set_config_entry("feedKeys", vec!["a".into(), "b".into()], false, "cli")
        .unwrap_err();
    assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_VALUE_INVALID");
    let error = single
        .set_config_entry("feedKeys", vec!["a".into()], true, "cli")
        .unwrap_err();
    assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_VALUE_INVALID");
    single
        .set_config_entry("feedKeys", vec!["a".into()], false, "cli")
        .expect("single value works");
}

#[test]
fn verify_runs_the_probe_records_the_outcome_and_cooldown_blocks() {
    let mut snapback = configured();
    let bindings = snapback
        .claim_app_state_graph(
            snapback::admin::ServerProfile::Test,
            snapback::auth::deployment::AuthDeploymentTarget::Local,
        )
        .expect("claim config verify composition graph");
    let operator = bindings
        .into_operator_authority_for_test(&snapback)
        .expect("bind config verify composition graph");
    // Unset → verify refuses before running any probe.
    let error = snapback
        .verify_config_entry(&operator, "feedKeys")
        .unwrap_err();
    assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_MISSING");

    snapback
        .set_config_entry("feedKeys", vec!["k1".into()], false, "cli")
        .unwrap();
    let outcome = snapback
        .verify_config_entry(&operator, "feedKeys")
        .expect("verify");
    assert!(outcome.ok, "{outcome:?}");
    let status = snapback.config_status();
    assert!(status.entries[0].verified.as_ref().unwrap().ok);

    // Immediately verifying again trips the cooldown.
    let error = snapback
        .verify_config_entry(&operator, "feedKeys")
        .unwrap_err();
    assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_VERIFY_COOLDOWN");

    // A value change resets verification: it attested the old values.
    snapback
        .set_config_entry("feedKeys", vec!["k2".into()], false, "cli")
        .unwrap();
    assert!(snapback.config_status().entries[0].verified.is_none());
}

#[test]
fn verify_rejects_an_authenticated_only_probe() {
    let mut manifest = config_manifest();
    manifest
        .functions
        .iter_mut()
        .find(|function| function.name == "probeKeys")
        .expect("probe function")
        .auth_requirement = Some(snapback::manifest::AuthRequirement::Authenticated);
    let mut snapback = LocalSnapback::memory().expect("memory config verify fixture");
    snapback.apply_schema(probe_schema()).expect("probe schema");
    let diagnostics = snapback.load_functions(manifest);
    assert!(
        diagnostics.iter().all(
            |diagnostic| diagnostic.severity != snapback::diagnostic::DiagnosticSeverity::Error
        ),
        "authenticated probe manifest loads so invocation policy can refuse it: {diagnostics:?}"
    );
    snapback
        .set_config_entry("feedKeys", vec!["k1".to_owned()], false, "test")
        .expect("set probe secret");
    let bindings = snapback
        .claim_app_state_graph(
            snapback::admin::ServerProfile::Test,
            snapback::auth::deployment::AuthDeploymentTarget::Local,
        )
        .expect("claim config verify composition graph");
    let operator = bindings
        .into_operator_authority_for_test(&snapback)
        .expect("bind config verify composition graph");

    let outcome = snapback
        .verify_config_entry(&operator, "feedKeys")
        .expect("authenticated-only probes record a closed verification failure");
    assert!(!outcome.ok);
    assert!(!outcome.verified.ok);
}

#[test]
fn verify_grants_only_the_exact_entry_to_a_shared_probe() {
    let mut feed = entry("feedKeys");
    feed.probe = Some("probeExact".to_owned());
    let mut other = entry("otherKey");
    other.probe = Some("probeExact".to_owned());
    let mut snapback = LocalSnapback::memory().expect("memory exact config verify fixture");
    snapback.apply_schema(probe_schema()).expect("probe schema");
    let diagnostics = snapback.load_functions(FunctionManifest {
        functions: vec![ibex_action("probeExact", &[])],
        config: vec![feed, other],
        ..FunctionManifest::default()
    });
    assert!(
        diagnostics.iter().all(
            |diagnostic| diagnostic.severity != snapback::diagnostic::DiagnosticSeverity::Error
        ),
        "shared probe manifest must load: {diagnostics:?}"
    );
    for name in ["feedKeys", "otherKey"] {
        snapback
            .set_config_entry(name, vec![format!("{name}-secret")], false, "test")
            .expect("set shared probe secret");
    }
    let bindings = snapback
        .claim_app_state_graph(
            snapback::admin::ServerProfile::Test,
            snapback::auth::deployment::AuthDeploymentTarget::Local,
        )
        .expect("claim config verify composition graph");
    let operator = bindings
        .into_operator_authority_for_test(&snapback)
        .expect("bind config verify composition graph");

    let outcome = snapback
        .verify_config_entry(&operator, "feedKeys")
        .expect("shared probe runs with an exact grant");
    assert!(
        outcome.ok,
        "shared probe observed a non-target grant: {outcome:?}"
    );
}

// --- HTTP surface ---------------------------------------------------------------

fn get(path: &str) -> Request<Body> {
    Request::builder().uri(path).body(Body::empty()).unwrap()
}

fn post(path: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(path)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn post_with_token(path: &str, body: Value, token: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(path)
        .header("content-type", "application/json")
        .header("x-snapback-admin-token", token)
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn body_json(resp: snapback_server::test_support::axum::response::Response) -> Value {
    let bytes = snapback_server::test_support::axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

fn context(loopback: bool, token: Option<&str>) -> ServerContext {
    let host = if loopback { "127.0.0.1" } else { "0.0.0.0" };
    let mut context = ServerContext::new(host, 4288, loopback);
    context.profile = snapback::admin::ServerProfile::Dev;
    context.admin_token = token.map(ToOwned::to_owned);
    context
}

fn app(snapback: LocalSnapback, ctx: ServerContext) -> snapback::server::SnapbackApp {
    snapback::server::app(test_app_state_from_snapback(snapback, ctx))
}

#[tokio::test]
async fn config_ops_follow_the_admin_gate() {
    // Loopback, no token: everything open (the local dev default).
    let open = app(configured(), context(true, None));
    let resp = open
        .clone()
        .oneshot(get("/_snapback/api/config/status"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = open
        .oneshot(post(
            "/_snapback/api/config/set",
            json!({ "entry": "feedKeys", "value": "k1" }),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Token configured: writes demand it, reads stay open on loopback.
    let gated = app(configured(), context(true, Some("sekrit")));
    let denied = gated
        .clone()
        .oneshot(post(
            "/_snapback/api/config/set",
            json!({ "entry": "feedKeys", "value": "k1" }),
        ))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
    let denied_verify = gated
        .clone()
        .oneshot(post(
            "/_snapback/api/config/verify",
            json!({ "entry": "feedKeys" }),
        ))
        .await
        .unwrap();
    assert_eq!(denied_verify.status(), StatusCode::UNAUTHORIZED);
    let allowed = gated
        .clone()
        .oneshot(post_with_token(
            "/_snapback/api/config/set",
            json!({ "entry": "feedKeys", "value": "k1" }),
            "sekrit",
        ))
        .await
        .unwrap();
    assert_eq!(allowed.status(), StatusCode::OK);
    let reads = gated
        .oneshot(get("/_snapback/api/config/status"))
        .await
        .unwrap();
    assert_eq!(reads.status(), StatusCode::OK);
}

#[tokio::test]
async fn transit_rule_refuses_value_writes_on_non_loopback_plaintext() {
    // Even a valid admin token does not carry a value over non-loopback
    // plaintext: the transit rule is about the transport, not the authority.
    let exposed = app(configured(), context(false, Some("sekrit")));
    let refused = exposed
        .clone()
        .oneshot(post_with_token(
            "/_snapback/api/config/set",
            json!({ "entry": "feedKeys", "value": "k1" }),
            "sekrit",
        ))
        .await
        .unwrap();
    assert_eq!(refused.status(), StatusCode::BAD_REQUEST);
    let body = body_json(refused).await;
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_CONFIG_TRANSIT_RULE");

    // unset carries no value; the admin gate alone governs it.
    let unset = exposed
        .clone()
        .oneshot(post_with_token(
            "/_snapback/api/config/unset",
            json!({ "entry": "feedKeys" }),
            "sekrit",
        ))
        .await
        .unwrap();
    assert_eq!(unset.status(), StatusCode::OK);

    // plan reports that this transport would refuse value writes.
    let plan = exposed
        .oneshot(
            Request::builder()
                .uri("/_snapback/api/config/plan")
                .header("x-snapback-admin-token", "sekrit")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(plan.status(), StatusCode::OK);
    let body = body_json(plan).await;
    assert_eq!(body["valueWritesAccepted"], json!(false));
}

#[tokio::test]
async fn envelopes_and_status_never_contain_values() {
    let open = app(configured(), context(true, None));
    let set = open
        .clone()
        .oneshot(post(
            "/_snapback/api/config/set",
            json!({ "entry": "feedKeys", "values": ["super-secret-value-1", "super-secret-value-2"] }),
        ))
        .await
        .unwrap();
    assert_eq!(set.status(), StatusCode::OK);
    let set_body = body_json(set).await.to_string();
    assert!(!set_body.contains("super-secret-value"), "{set_body}");

    let status = open
        .clone()
        .oneshot(get("/_snapback/api/config/status"))
        .await
        .unwrap();
    let status_body = body_json(status).await;
    let raw = status_body.to_string();
    assert!(!raw.contains("super-secret-value"), "{raw}");
    let entry = &status_body["entries"][0];
    assert_eq!(entry["name"], "feedKeys");
    assert_eq!(entry["set"], json!(true));
    assert_eq!(entry["memberCount"], json!(2));

    // The diagnostics ring (admin inspect) carries audit facts, not values.
    let inspect = open.oneshot(get("/_snapback/api/inspect")).await.unwrap();
    let inspect_raw = body_json(inspect).await.to_string();
    assert!(
        !inspect_raw.contains("super-secret-value"),
        "audit leaked a value"
    );
}

#[tokio::test]
async fn config_status_and_verify_drop_handler_controlled_probe_text() {
    const SENTINEL: &str = "HANDLER_CONTROLLED_CONFIG_DIAGNOSTIC_SENTINEL";
    let open = app(configured(), context(true, None));
    let set = open
        .clone()
        .oneshot(post(
            "/_snapback/api/config/set",
            json!({ "entry": "feedKeys", "value": "force-handler-failure" }),
        ))
        .await
        .unwrap();
    assert_eq!(set.status(), StatusCode::OK);

    let verify = open
        .clone()
        .oneshot(post(
            "/_snapback/api/config/verify",
            json!({ "entry": "feedKeys" }),
        ))
        .await
        .unwrap();
    assert_eq!(verify.status(), StatusCode::OK);
    let verify = body_json(verify).await;
    assert_eq!(verify["ok"], false);
    assert_eq!(verify["verified"]["ok"], false);
    assert!(verify["verified"]["atMs"].is_number(), "{verify}");
    assert!(verify["verified"].get("diagnostic").is_none(), "{verify}");
    assert!(!verify.to_string().contains(SENTINEL), "{verify}");

    let status = body_json(
        open.oneshot(get("/_snapback/api/config/status"))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(status["entries"][0]["verified"]["ok"], false);
    assert!(
        status["entries"][0]["verified"].get("diagnostic").is_none(),
        "{status}"
    );
    assert!(!status.to_string().contains(SENTINEL), "{status}");
}

#[tokio::test]
async fn setup_wizard_page_is_served_from_the_static_lane() {
    let open = app(configured(), context(true, None));
    let resp = open.oneshot(get("/_snapback/admin/setup")).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = snapback_server::test_support::axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let html = String::from_utf8_lossy(&bytes);
    assert!(html.contains("Set up this app"), "wizard page served");
    assert!(
        html.contains("/_snapback/api/config/"),
        "wizard drives the gated ops"
    );
    // ENG-22581: the ready banner must acknowledge unset optional entries and
    // cards must distinguish required from optional, or the page contradicts
    // itself ("app is ready" above a warning asking for a key).
    assert!(
        html.contains("the app runs without"),
        "ready banner mentions unset optional entries"
    );
    assert!(
        html.contains(r#"entry.required ? "required" : "optional""#),
        "cards label optional entries"
    );
    // ENG-22594: the value input has a show/hide toggle so the operator can
    // check what they pasted before committing it.
    assert!(
        html.contains(r#"input.setAttribute("type", show ? "text" : "password")"#),
        "value input has a show/hide toggle"
    );
    // ENG-22752: an empty entry list on a not-yet-provisioned instance must
    // say why the wizard is empty and what to do, not render nothing.
    assert!(
        html.contains("No app has booted on this instance yet"),
        "wizard explains the pre-provision empty state"
    );
    assert!(
        html.contains("status.appProvisioned"),
        "wizard branches on the appProvisioned status fact"
    );
    assert!(
        html.contains("This app declares no configuration"),
        "wizard still reports the provisioned-but-nothing-declared state"
    );
    assert!(
        html.contains("/_snapback/api/console/credential"),
        "wizard exchanges the master token for a derived browser credential"
    );
    assert!(
        html.contains("snapback_console_credential_v1"),
        "wizard persists only the expiring derived credential"
    );
    assert!(
        !html.contains("localStorage.setItem(\"snapback_admin_token\""),
        "wizard must never persist the master admin token"
    );
}

// ENG-22752: `config.status` distinguishes "no app has booted yet" from "the
// loaded app declares no config" so the wizard's empty state can say which.
#[test]
fn config_status_reports_whether_an_app_has_provisioned() {
    let mut snapback = LocalSnapback::memory().unwrap();
    let status = snapback.config_status();
    assert!(!status.app_provisioned, "fresh instance: no app booted yet");
    assert!(status.entries.is_empty());

    // Loading any functions manifest — even one declaring no config — flips
    // the fact: now empty entries mean "nothing to configure".
    let diagnostics = snapback.load_functions(FunctionManifest::default());
    assert!(
        !diagnostics
            .iter()
            .any(|d| d.severity == snapback::diagnostic::DiagnosticSeverity::Error),
        "unexpected load errors: {diagnostics:?}"
    );
    let status = snapback.config_status();
    assert!(
        status.app_provisioned,
        "manifest loaded: app has provisioned"
    );
    assert!(status.entries.is_empty(), "still no declared entries");
}

#[tokio::test]
async fn config_status_carries_app_provisioned_over_http() {
    // Fresh server, nothing provisioned (the ENG-22752 repro): the wire
    // payload must carry the fact the wizard branches on.
    let fresh = app(LocalSnapback::memory().unwrap(), context(true, None));
    let resp = fresh
        .oneshot(get("/_snapback/api/config/status"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["appProvisioned"], json!(false));
    assert_eq!(body["entries"], json!([]));

    // Once an app's manifest is loaded, the same payload says so.
    let provisioned = app(configured(), context(true, None));
    let resp = provisioned
        .oneshot(get("/_snapback/api/config/status"))
        .await
        .unwrap();
    let body = body_json(resp).await;
    assert_eq!(body["appProvisioned"], json!(true));
}
