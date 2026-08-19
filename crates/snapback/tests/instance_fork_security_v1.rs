//! Upward-composition coverage moved out of the services owner crate after
//! cross-crate `#[path]` compilation was removed. The services crate owns copy
//! and publication; these assertions deliberately compose kernel, engine, and
//! server operations only from this top-rank integration target.

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use rusqlite::Connection;
use snapback::admin::{AppState, ServerContext};
use snapback::admin_secret_read::{
    SECRET_READ_LEASE_HEADER, SecretReadLeaseRequest, SecretReadScope,
};
use snapback::contract_types::ServerProfile;
use snapback::instance_fork::{EgressFamily, inspect_boot};
use snapback::local::{DiagnosticBoundary, LocalSnapback};
use snapback::push::{
    PushAppScopeV1, PushAudienceAuthorizeV1, PushAudienceDeclarationV1, PushAudienceResolverV1,
    PushLedgerDeclarationV1, PushRegistryDeclarationV1, PushSeamDeclarationV1,
};
use snapback_kernel::instance_fork::{DerivedForkRuntimeExt as _, SIDECAR_CUSTODY};
use snapback_kernel::storage::LocalDatabase;
use snapback_server::test_support::axum;
use snapback_services::assets_store::AssetStoreBackend;
use snapback_services::instance_fork::publish;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tower::ServiceExt as _;

fn source_database(directory: &Path) -> PathBuf {
    let path = directory.join("app.sqlite3");
    drop(LocalDatabase::open(&path).expect("source database"));
    path
}

fn published_fork(directory: &Path) -> (PathBuf, PathBuf) {
    let source = source_database(directory);
    let destination = directory.join("fork");
    publish(&source, &destination, "app-a", "parent-a", 42, None).expect("publish derived fork");
    (source, destination.join("app.sqlite3"))
}

#[test]
fn scrub_mints_non_promotable_identity_and_payload_free_marker() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let destination = directory.path().join("fork");
    let receipt = publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
    assert!(!receipt.lineage.promotable);
    for rule in SIDECAR_CUSTODY {
        assert_eq!(
            receipt.custody[&format!("sidecar:{}", rule.name)],
            rule.disposition,
            "{}",
            rule.name,
        );
    }

    let database = destination.join("app.sqlite3");
    let runtime = inspect_boot(&database)
        .unwrap()
        .expect("fork boot evidence");
    let denied = runtime.deny(EgressFamily::Fetch, 43);
    assert_eq!(denied.diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED");
    let conn = Connection::open(&database).unwrap();
    let marker: (String, u64) = conn
        .query_row(
            "SELECT family, attempts FROM _snapback_fork_egress_attempts_v1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(marker, ("fetch".to_owned(), 1));
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('_snapback_fork_egress_attempts_v1')",
            [],
            |row| row.get::<_, u64>(0),
        )
        .unwrap(),
        4,
        "the denial marker remains bounded and payload-free",
    );
    drop(conn);

    let mut served = LocalSnapback::open(&database).unwrap();
    assert!(served.is_derived_fork());
    let cron = match served.claim_due_cron_runs(44) {
        Ok(_) => panic!("a fork must not claim cron work"),
        Err(error) => error,
    };
    assert_eq!(cron.diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED");
    let jobs = match served.claim_due_jobs(45, 1, "fork-test", DiagnosticBoundary::Standalone) {
        Ok(_) => panic!("a fork must not claim job work"),
        Err(error) => error,
    };
    assert_eq!(jobs.diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED");
}

#[test]
fn parent_credential_corpus_is_refused_by_minted_fork() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let parent_admin = "sbat_parent_must_not_survive";
    let admin_path = snapback::admin::admin_token_sibling(&source);
    fs::write(&admin_path, format!("{parent_admin}\n")).unwrap();

    let parent = Connection::open(&source).unwrap();
    parent
        .execute_batch(
            "CREATE TABLE _auth_sessions(id TEXT PRIMARY KEY, token_hash TEXT);
             CREATE TABLE _auth_agent_credentials(id TEXT PRIMARY KEY, token_hash TEXT);
             CREATE TABLE _auth_grants(id TEXT PRIMARY KEY, subject TEXT, revoked_at_ms INTEGER);
             CREATE TABLE _auth_grant_tokens(id TEXT PRIMARY KEY, grant_id TEXT, token_hash TEXT);
             INSERT INTO _auth_sessions VALUES('session-a','parent-session-token-hash');
             INSERT INTO _auth_agent_credentials VALUES('agent-a','parent-agent-token-hash');
             INSERT INTO _auth_grants VALUES('grant-live','agent-a',NULL);
             INSERT INTO _auth_grants VALUES('grant-revoked','agent-a',900);
             INSERT INTO _auth_grant_tokens VALUES('gtok-live','grant-live','live-hash');
             INSERT INTO _auth_grant_tokens VALUES('gtok-revoked','grant-revoked','revoked-hash');",
        )
        .unwrap();
    drop(parent);

    let destination = directory.path().join("fork");
    publish(&source, &destination, "app-a", "parent-a", 2_000, None).unwrap();
    let database = destination.join("app.sqlite3");
    let child = Connection::open(&database).unwrap();
    for table in [
        "_auth_sessions",
        "_auth_agent_credentials",
        "_auth_grants",
        "_auth_grant_tokens",
    ] {
        assert_eq!(
            child
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get::<_, u64>(0)
                })
                .unwrap(),
            0,
            "{table} retained parent authority",
        );
    }
    let child_admin = fs::read_to_string(snapback::admin::admin_token_sibling(&database)).unwrap();
    assert_ne!(child_admin.trim(), parent_admin);
}

#[test]
fn host_op_gate_denies_every_egress_family_and_names_unclassified_ops() {
    let directory = tempfile::tempdir().unwrap();
    let (_source, database) = published_fork(directory.path());
    let fork = LocalSnapback::open(&database).unwrap();
    for (op, family) in [
        ("host.fetch", "fetch"),
        ("action.externalEffectBegin", "fetch"),
        ("push.send", "push_send"),
        ("action.streamOpen", "stream_open"),
        ("action.streamRead", "stream_read"),
        ("action.streamCancel", "stream_cancel"),
        ("jobs.enqueue", "jobs_enqueue"),
    ] {
        let error = fork.deny_derived_fork_host_op(op, 43).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED");
        assert_eq!(error.diagnostic.details["family"], family);
        assert_eq!(error.diagnostic.details["hostOp"], op);
    }
    let future = fork
        .deny_derived_fork_host_op("future.networkDial", 44)
        .unwrap_err();
    assert_eq!(
        future.diagnostic.details["family"],
        "unclassified_host_operation",
    );
    fork.deny_derived_fork_host_op("db.query", 45).unwrap();
}

#[test]
fn manual_cron_and_asset_provider_paths_deny_on_a_fork() {
    let directory = tempfile::tempdir().unwrap();
    let (_source, database) = published_fork(directory.path());
    let mut fork =
        LocalSnapback::open_with_asset_store_backend_for_test(&database, AssetStoreBackend::S3)
            .unwrap();
    let cron = match fork.claim_manual_cron_run("any-job", 43) {
        Ok(_) => panic!("a fork must not claim manual cron work"),
        Err(error) => error,
    };
    assert_eq!(cron.diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED");
    let denied = match snapback_engine::test_support::asset_store_obj(&fork) {
        Ok(_) => panic!("a fork must never construct a provider asset store"),
        Err(error) => error,
    };
    assert_eq!(denied.diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED");
    assert_eq!(denied.diagnostic.details["family"], "asset_provider");
}

#[test]
fn every_deny_all_family_has_one_bounded_payload_free_row() {
    let directory = tempfile::tempdir().unwrap();
    let (_source, database) = published_fork(directory.path());
    let runtime = inspect_boot(&database).unwrap().unwrap();
    for family in EgressFamily::ALL {
        assert_eq!(
            runtime.deny(family, 43).diagnostic.code,
            "SNAPBACK_FORK_EGRESS_DENIED",
        );
    }
    let conn = Connection::open(&database).unwrap();
    let rows: u64 = conn
        .query_row(
            "SELECT COUNT(*) FROM _snapback_fork_egress_attempts_v1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let total: u64 = conn
        .query_row(
            "SELECT SUM(attempts) FROM _snapback_fork_egress_attempts_v1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(rows, EgressFamily::ALL.len() as u64);
    assert_eq!(total, rows);
}

#[tokio::test]
async fn direct_telemetry_export_route_refuses_before_export_read() {
    let directory = tempfile::tempdir().unwrap();
    let (_source, database) = published_fork(directory.path());
    let snapback = LocalSnapback::open(&database).unwrap();
    let (state, operator) =
        AppState::try_from_snapback_with_secret_read_operator(snapback, ServerContext::detached())
            .unwrap();
    let lease = operator
        .mint(SecretReadLeaseRequest {
            scopes: BTreeSet::from([SecretReadScope::TelemetryExport]),
            ttl: Duration::from_secs(60),
            row_budget: 100,
            byte_budget: 1024 * 1024,
        })
        .unwrap();
    let response = snapback::server::app(state)
        .oneshot(
            Request::builder()
                .uri("/_snapback/api/telemetry/export?kind=log")
                .header(SECRET_READ_LEASE_HEADER, lease.bearer())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_FORK_EGRESS_DENIED");
}

#[tokio::test]
async fn push_receipt_maintenance_refuses_on_a_ledger_bearing_fork_before_provider_io() {
    let directory = tempfile::tempdir().unwrap();
    let (_source, database) = published_fork(directory.path());
    let mut snapback = LocalSnapback::open(&database).unwrap();
    let declaration = PushSeamDeclarationV1 {
        app_scope: PushAppScopeV1 {
            eas_project_id: "eas-fork".into(),
            application_id: "com.example.fork".into(),
            environment: "test".into(),
        },
        registry: PushRegistryDeclarationV1 {
            idle_retention_ms: 86_400_000,
        },
        audiences: BTreeMap::from([(
            "everyone".to_owned(),
            PushAudienceDeclarationV1 {
                resolve: PushAudienceResolverV1::ExplicitPrincipals {
                    principals_arg: "principals".into(),
                    max_items: 10,
                },
                authorize: PushAudienceAuthorizeV1::System,
            },
        )]),
        uses: Vec::new(),
        ledger: Some(PushLedgerDeclarationV1 {
            retention_ms: 2_592_000_000,
        }),
    };
    let database_owner = snapback_engine::test_support::auth_database_mut(&mut snapback);
    database_owner.activate_current_auth_catalog().unwrap();
    database_owner
        .activate_push_registry_for_test(declaration)
        .unwrap();
    let state = AppState::try_from_snapback(snapback, ServerContext::detached()).unwrap();
    let error = snapback_server::test_support::drive_push_maintenance_once_for_test(
        &state,
        ServerProfile::Test,
        43,
    )
    .await
    .unwrap_err();
    assert_eq!(error.diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED");
    assert_eq!(error.diagnostic.details["family"], "push_receipt");
}
