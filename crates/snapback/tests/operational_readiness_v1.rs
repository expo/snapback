use serde_json::{Value, json};
use snapback::admin::{ServerContext, ServerProfile};
use snapback::auth::mode::DeploymentIdentity;
use snapback::host_ops::HostReadyDescriptor;
use snapback::local::LocalSnapback;
use snapback::manifest::AuthMode;
use snapback::operational_readiness::{
    DeclaredObligationV1, EXPECTED_ACTIVATION_TARGET_FORMAT_V1, ExpectedActivationTargetV1,
    PendingMigrationDeclarationV1, READINESS_MIGRATION_UNRESOLVED_CODE,
    READINESS_OBLIGATIONS_DIGEST_MISMATCH_CODE, declared_obligations_digest,
};
use snapback_server::test_support::axum::body::{Body, to_bytes};
use snapback_server::test_support::axum::http::{Request, StatusCode, header};
use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tower::ServiceExt as _;

const ADMIN_TOKEN: &str = "operational-readiness-admin";

struct ServerGuard(Child);

impl Drop for ServerGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn generated(file: &str) -> Value {
    let path = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .join("demos/todo/snapback/generated")
        .join(file);
    serde_json::from_str(&fs::read_to_string(path).expect("read generated artifact"))
        .expect("parse generated artifact")
}

fn wait_for_cli_ready(child: &mut Child, path: &Path) -> HostReadyDescriptor {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if path.exists() {
            let value: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
            return HostReadyDescriptor::validate(&value).expect("valid CLI readiness descriptor");
        }
        if let Some(status) = child.try_wait().unwrap() {
            let mut stderr = String::new();
            if let Some(mut pipe) = child.stderr.take() {
                let _ = pipe.read_to_string(&mut stderr);
            }
            panic!("Snapback server exited before readiness: {status}\n{stderr}");
        }
        assert!(Instant::now() < deadline, "server readiness timed out");
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn response_json(response: Result<ureq::Response, ureq::Error>, operation: &str) -> Value {
    let response = match response {
        Ok(response) => response,
        Err(ureq::Error::Status(_, response)) => response,
        Err(error) => panic!("{operation} transport failed: {error}"),
    };
    response
        .into_json()
        .unwrap_or_else(|error| panic!("{operation} returned non-JSON: {error}"))
}

fn post_json(server_url: &str, path: &str, token: &str, body: Value) -> Value {
    response_json(
        ureq::post(&format!("{}{path}", server_url.trim_end_matches('/')))
            .set("x-snapback-admin-token", token)
            .send_json(body),
        path,
    )
}

fn host_op(server_url: &str, token: &str, body: Value) -> Value {
    post_json(server_url, "/_snapback/api/host-ops", token, body)
}

fn deployment(schema: &Value, functions: &Value) -> DeploymentIdentity {
    DeploymentIdentity {
        schema_version: schema["schemaVersion"].as_str().unwrap().to_owned(),
        auth_mode: AuthMode::Dev,
        app_id: schema["appId"].as_str().unwrap().to_owned(),
        schema_hash: schema["schemaHash"].as_str().unwrap().to_owned(),
        bundle_hash: functions["bundleHash"].as_str().unwrap().to_owned(),
        inputs_hash: schema["inputsHash"].as_str().unwrap().to_owned(),
    }
}

fn matching_target(schema: &Value, functions: &Value) -> ExpectedActivationTargetV1 {
    let deployment = deployment(schema, functions);
    let declared_obligations = vec![
        DeclaredObligationV1::Schema {
            schema_hash: deployment.schema_hash.clone(),
        },
        DeclaredObligationV1::Functions {
            bundle_hash: deployment.bundle_hash.clone(),
        },
    ];
    ExpectedActivationTargetV1 {
        format_version: EXPECTED_ACTIVATION_TARGET_FORMAT_V1.to_owned(),
        deployment,
        target_profile: "local-dev-sqlite-ibex".to_owned(),
        obligations_digest: declared_obligations_digest(&declared_obligations).unwrap(),
        declared_obligations,
        pending_migration: None,
    }
}

fn declare_body(target: &ExpectedActivationTargetV1) -> Value {
    json!({
        "operation": "app.readiness.v1",
        "input": { "expectedTarget": target },
    })
}

fn conditions(readiness: &Value) -> Vec<&str> {
    readiness["unsatisfied"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["condition"].as_str().unwrap())
        .collect()
}

fn router_post(path: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-snapback-admin-token", ADMIN_TOKEN)
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap()
}

async fn router_response_json(
    response: snapback_server::test_support::axum::response::Response,
) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}

#[tokio::test]
async fn in_process_router_serves_operational_readiness_authority() {
    let mut context = ServerContext::detached();
    context.profile = ServerProfile::Test;
    context.admin_token = Some(ADMIN_TOKEN.to_owned());
    let state = snapback::admin::AppState::try_from_snapback(
        LocalSnapback::memory().expect("readiness fixture"),
        context,
    )
    .unwrap()
    .with_server_startup_nonce("operational-readiness-router-nonce")
    .unwrap();
    let router = snapback::server::app(state);

    let schema = generated("schema.manifest.json");
    let functions = generated("functions.manifest.json");
    let provisioned = router
        .clone()
        .oneshot(router_post(
            "/app/ensure",
            json!({
                "intent": "provision",
                "requestedMode": "dev",
                "schema": schema,
                "functions": functions,
            }),
        ))
        .await
        .unwrap();
    assert_eq!(provisioned.status(), StatusCode::OK);
    let provisioned = router_response_json(provisioned).await;
    assert_eq!(provisioned["intent"], "provision", "{provisioned}");

    let unauthenticated = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/_snapback/api/host-ops")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({ "operation": "app.readiness.v1" })).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(matches!(
        unauthenticated.status(),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
    ));

    let public_inspect = router
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/inspect")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let public_inspect = router_response_json(public_inspect).await;
    assert!(
        !serde_json::to_string(&public_inspect)
            .unwrap()
            .contains("\"operationalReadiness\""),
        "public inspect must not expose operational readiness: {public_inspect}"
    );

    let undeclared = router
        .clone()
        .oneshot(router_post(
            "/_snapback/api/host-ops",
            json!({ "operation": "app.readiness.v1" }),
        ))
        .await
        .unwrap();
    assert_eq!(undeclared.status(), StatusCode::OK);
    let undeclared = router_response_json(undeclared).await;
    assert_eq!(
        conditions(&undeclared["data"]["operationalReadiness"]),
        vec!["expected-target-undeclared"]
    );

    let target = matching_target(&schema, &functions);
    let declared = router
        .clone()
        .oneshot(router_post(
            "/_snapback/api/host-ops",
            declare_body(&target),
        ))
        .await
        .unwrap();
    let declared = router_response_json(declared).await;
    assert_eq!(declared["ok"], true, "{declared}");
    assert_eq!(declared["data"]["operationalReadiness"]["ready"], true);
    assert_eq!(
        declared["data"]["operationalReadiness"]["startupNonce"],
        "operational-readiness-router-nonce"
    );

    let mut wrong_digest = target.clone();
    wrong_digest.obligations_digest = format!("sha256:{}", "0".repeat(64));
    let refused_digest = router
        .clone()
        .oneshot(router_post(
            "/_snapback/api/host-ops",
            declare_body(&wrong_digest),
        ))
        .await
        .unwrap();
    let refused_digest = router_response_json(refused_digest).await;
    assert_eq!(refused_digest["ok"], false, "{refused_digest}");
    assert_eq!(
        refused_digest["diagnostics"][0]["code"],
        READINESS_OBLIGATIONS_DIGEST_MISMATCH_CODE
    );

    let mut pending_migration = target.clone();
    pending_migration.pending_migration = Some(PendingMigrationDeclarationV1 {
        identifier: "migration-unresolved".to_owned(),
    });
    let refused_migration = router
        .clone()
        .oneshot(router_post(
            "/_snapback/api/host-ops",
            declare_body(&pending_migration),
        ))
        .await
        .unwrap();
    let refused_migration = router_response_json(refused_migration).await;
    assert_eq!(refused_migration["ok"], false, "{refused_migration}");
    assert_eq!(
        refused_migration["diagnostics"][0]["code"],
        READINESS_MIGRATION_UNRESOLVED_CODE
    );

    let still_matching = router
        .clone()
        .oneshot(router_post(
            "/_snapback/api/host-ops",
            json!({ "operation": "app.readiness.v1" }),
        ))
        .await
        .unwrap();
    let still_matching = router_response_json(still_matching).await;
    assert_eq!(
        still_matching["data"]["operationalReadiness"]["ready"], true,
        "rejected declarations must preserve prior authority: {still_matching}"
    );

    let inspected = router
        .clone()
        .oneshot(router_post(
            "/_snapback/api/host-ops",
            json!({ "operation": "app.inspect" }),
        ))
        .await
        .unwrap();
    let inspected = router_response_json(inspected).await;
    assert_eq!(
        inspected["data"]["operationalReadiness"]["ready"], true,
        "{inspected}"
    );

    let mut mismatched = target;
    mismatched.deployment.inputs_hash.push_str("-mismatch");
    let mismatched = router
        .oneshot(router_post(
            "/_snapback/api/host-ops",
            declare_body(&mismatched),
        ))
        .await
        .unwrap();
    let mismatched = router_response_json(mismatched).await;
    assert_eq!(mismatched["ok"], true, "{mismatched}");
    let readiness = &mismatched["data"]["operationalReadiness"];
    assert_eq!(readiness["ready"], false);
    assert!(conditions(readiness).contains(&"active-deployment-mismatch"));
}

#[test]
fn served_operational_readiness_declares_evaluates_and_splices() {
    let binary = env!("CARGO_BIN_EXE_snapback");
    let target_directory =
        PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../..")).join("target");
    let directory = tempfile::tempdir_in(target_directory).unwrap();
    let database = directory.path().join("operational-readiness.sqlite3");
    let ready_file = directory.path().join("host-ready.json");
    let mut child = Command::new(binary)
        .args(["start", "--port", "0", "--db"])
        .arg(&database)
        .arg("--ready-file")
        .arg(&ready_file)
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn snapback start");
    let ready = wait_for_cli_ready(&mut child, &ready_file);
    let _guard = ServerGuard(child);
    let server_url = ready.server_url.clone();
    let token = fs::read_to_string(ready.admin_token_file.as_ref().expect("admin token file"))
        .unwrap()
        .trim()
        .to_owned();

    let schema = generated("schema.manifest.json");
    let functions = generated("functions.manifest.json");
    let provisioned = post_json(
        &server_url,
        "/app/ensure",
        &token,
        json!({
            "intent": "provision",
            "requestedMode": "dev",
            "schema": schema,
            "functions": functions,
        }),
    );
    assert_eq!(provisioned["intent"], "provision", "{provisioned}");

    let undeclared = host_op(
        &server_url,
        &token,
        json!({ "operation": "app.readiness.v1" }),
    );
    assert_eq!(undeclared["ok"], true, "{undeclared}");
    let undeclared_readiness = &undeclared["data"]["operationalReadiness"];
    assert_eq!(undeclared_readiness["ready"], false);
    assert_eq!(
        conditions(undeclared_readiness),
        vec!["expected-target-undeclared"]
    );

    let matching = matching_target(&schema, &functions);
    let declared = host_op(&server_url, &token, declare_body(&matching));
    assert_eq!(declared["ok"], true, "{declared}");
    let readiness = &declared["data"]["operationalReadiness"];
    assert_eq!(readiness["ready"], true, "{readiness}");
    assert_eq!(readiness["startupNonce"], ready.startup_nonce.unwrap());
    let health = response_json(
        ureq::get(&format!("{}/health", server_url.trim_end_matches('/'))).call(),
        "health",
    );
    assert_eq!(readiness["startupNonce"], health["binary"]["startupNonce"]);
    assert!(
        readiness["capabilityManifestDigest"]
            .as_str()
            .is_some_and(|digest| digest.starts_with("sha256:") && digest.len() == 71)
    );
    assert_eq!(readiness["artifacts"]["schemaHash"], schema["schemaHash"]);
    assert_eq!(
        readiness["artifacts"]["bundleHash"],
        functions["bundleHash"]
    );
    assert!(readiness["artifacts"]["databaseVersion"].is_number());

    let mut wrong_digest = matching.clone();
    wrong_digest.obligations_digest = format!("sha256:{}", "0".repeat(64));
    let refused_digest = host_op(&server_url, &token, declare_body(&wrong_digest));
    assert_eq!(refused_digest["ok"], false, "{refused_digest}");
    assert_eq!(
        refused_digest["diagnostics"][0]["code"],
        READINESS_OBLIGATIONS_DIGEST_MISMATCH_CODE
    );

    let mut pending_migration = matching.clone();
    pending_migration.pending_migration = Some(PendingMigrationDeclarationV1 {
        identifier: "migration-unresolved".to_owned(),
    });
    let refused_migration = host_op(&server_url, &token, declare_body(&pending_migration));
    assert_eq!(refused_migration["ok"], false, "{refused_migration}");
    assert_eq!(
        refused_migration["diagnostics"][0]["code"],
        READINESS_MIGRATION_UNRESOLVED_CODE
    );
    let still_matching = host_op(
        &server_url,
        &token,
        json!({ "operation": "app.readiness.v1" }),
    );
    assert_eq!(
        still_matching["data"]["operationalReadiness"]["ready"], true,
        "rejected declarations must not replace target authority: {still_matching}"
    );
    assert_eq!(
        still_matching["data"]["operationalReadiness"]["target"]["obligationsDigest"],
        matching.obligations_digest
    );

    let inspect = host_op(&server_url, &token, json!({ "operation": "app.inspect" }));
    assert_eq!(inspect["ok"], true, "{inspect}");
    assert_eq!(inspect["data"]["operationalReadiness"]["ready"], true);

    let mut mismatched = matching.clone();
    mismatched.deployment.inputs_hash.push_str("-mismatch");
    let mismatched = host_op(&server_url, &token, declare_body(&mismatched));
    assert_eq!(mismatched["ok"], true, "{mismatched}");
    let mismatched_readiness = &mismatched["data"]["operationalReadiness"];
    assert_eq!(mismatched_readiness["ready"], false);
    assert!(
        conditions(mismatched_readiness).contains(&"active-deployment-mismatch"),
        "{mismatched_readiness}"
    );
}
