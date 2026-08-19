use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};
use snapback::auth::mode::DeploymentIdentity;
use snapback::host_ops::HostReadyDescriptor;
use snapback::manifest::AuthMode;
use snapback::operational_readiness::{
    APPLICATION_READY_FORMAT_V1, ApplicationIdentityV1, ApplicationReadyAuthV1,
    ApplicationReadyReceiptV1, DeclaredObligationV1, EXPECTED_ACTIVATION_TARGET_FORMAT_V1,
    ExpectedActivationTargetV1, OperationalReadinessV1, application_ready_sibling,
    declared_obligations_digest,
};
use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

const VISIBILITY_GOVERNANCE_TARGET_CONFIG_ENV: &str =
    "SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG";

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

fn mint_governance_config(destination: &Path) -> PathBuf {
    let repository = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let source_backend = repository.join("demos/todo/snapback");
    let output_path = destination.join("visibility-governance-dev-target-config.json");
    let output = Command::new("node")
        .arg(repository.join("scripts/mint-visibility-governance-dev-config.mjs"))
        .arg(source_backend)
        .arg("--out")
        .arg(&output_path)
        .current_dir(&repository)
        .output()
        .expect("mint wait-cli visibility-governance config");
    assert!(
        output.status.success(),
        "mint wait-cli visibility-governance config failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
    output_path
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

fn spawn_server(directory: &Path) -> (ServerGuard, HostReadyDescriptor, PathBuf) {
    let database = directory.join("wait.sqlite3");
    let ready_file = directory.join("host-ready.json");
    let governance_config = mint_governance_config(directory);
    let mut child = Command::new(env!("CARGO_BIN_EXE_snapback"))
        .args(["start", "--port", "0", "--db"])
        .arg(database)
        .arg("--ready-file")
        .arg(&ready_file)
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .env(VISIBILITY_GOVERNANCE_TARGET_CONFIG_ENV, governance_config)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn snapback start");
    let descriptor = wait_for_cli_ready(&mut child, &ready_file);
    (ServerGuard(child), descriptor, ready_file)
}

fn response_json(response: Result<ureq::Response, ureq::Error>) -> Value {
    let response = match response {
        Ok(response) => response,
        Err(ureq::Error::Status(_, response)) => response,
        Err(error) => panic!("transport failed: {error}"),
    };
    response.into_json().expect("JSON response")
}

fn post_json(server_url: &str, path: &str, token: &str, body: Value) -> Value {
    response_json(
        ureq::post(&format!("{}{path}", server_url.trim_end_matches('/')))
            .set("x-snapback-admin-token", token)
            .send_json(body),
    )
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

fn expected_target(schema: &Value, functions: &Value) -> ExpectedActivationTargetV1 {
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

fn run_wait(
    ready_file: &Path,
    level: &str,
    timeout_ms: u64,
    override_path: Option<&Path>,
    token: Option<&str>,
) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_snapback"));
    command
        .args(["wait", "--ready-file"])
        .arg(ready_file)
        .args(["--level", level, "--timeout-ms"])
        .arg(timeout_ms.to_string())
        .env_remove("SNAPBACK_ADMIN_TOKEN");
    if let Some(path) = override_path {
        command.arg("--application-ready-file").arg(path);
    }
    if let Some(token) = token {
        command.arg("--token").arg(token);
    }
    command.output().expect("run snapback wait")
}

fn envelope(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "wait stdout was not JSON: {error}\nstdout={}\nstderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

fn assert_timeout(output: &Output, condition: &str) -> Value {
    assert!(!output.status.success(), "wait unexpectedly succeeded");
    let value = envelope(output);
    assert_eq!(value["operation"], "host.wait", "{value}");
    assert_eq!(
        value["diagnostics"][0]["code"], "SNAPBACK_WAIT_TIMEOUT",
        "{value}"
    );
    assert_eq!(
        value["diagnostics"][0]["details"]["condition"], condition,
        "{value}"
    );
    value
}

fn descriptor_digest(ready_file: &Path) -> String {
    format!("sha256:{:x}", Sha256::digest(fs::read(ready_file).unwrap()))
}

fn receipt(ready_file: &Path, readiness: &OperationalReadinessV1) -> ApplicationReadyReceiptV1 {
    let target = readiness
        .target
        .as_ref()
        .expect("declared readiness target");
    ApplicationReadyReceiptV1 {
        format_version: APPLICATION_READY_FORMAT_V1.to_owned(),
        startup_nonce: readiness.startup_nonce.clone(),
        host_ready_descriptor_digest: descriptor_digest(ready_file),
        application: ApplicationIdentityV1::DevGenerated {
            deployment: target.deployment.clone(),
            obligations_digest: target.obligations_digest.clone(),
        },
        target_profile: target.target_profile.clone(),
        artifacts: readiness.artifacts.clone(),
        auth: ApplicationReadyAuthV1 {
            active_mode: readiness.auth.active,
            mode_state: readiness.auth.mode_state,
            session_activation_ready: readiness.auth.session_activation_ready,
        },
        capability_manifest_digest: readiness.capability_manifest_digest.clone(),
        network_profile: readiness.network_profile.clone(),
        settled_at_ms: readiness.evaluated_at_ms,
    }
}

fn write_receipt(path: &Path, receipt: &ApplicationReadyReceiptV1, mode: u32) {
    fs::write(path, serde_json::to_vec(receipt).unwrap()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
    }
}

#[test]
fn host_wait_succeeds_for_live_descriptor_and_times_out_when_missing() {
    let target_directory =
        PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../..")).join("target");
    let directory = tempfile::tempdir_in(target_directory).unwrap();
    let (_guard, descriptor, ready_file) = spawn_server(directory.path());

    let success = run_wait(&ready_file, "host", 2_000, None, None);
    assert!(
        success.status.success(),
        "host wait failed: {}",
        String::from_utf8_lossy(&success.stderr)
    );
    let success = envelope(&success);
    assert_eq!(success["ok"], true, "{success}");
    assert_eq!(success["data"]["level"], "host");
    assert_eq!(success["data"]["serverUrl"], descriptor.server_url);
    assert_eq!(
        success["data"]["startupNonce"],
        descriptor.startup_nonce.unwrap()
    );

    let missing = directory.path().join("does-not-exist.ready.json");
    assert_timeout(
        &run_wait(&missing, "host", 100, None, None),
        "ready-file-missing",
    );
}

#[test]
fn application_wait_requires_a_strict_current_receipt_and_live_matching_fact() {
    let target_directory =
        PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../..")).join("target");
    let directory = tempfile::tempdir_in(target_directory).unwrap();
    let (_guard, descriptor, ready_file) = spawn_server(directory.path());
    let token = fs::read_to_string(
        descriptor
            .admin_token_file
            .as_ref()
            .expect("admin token file"),
    )
    .unwrap()
    .trim()
    .to_owned();
    let schema = generated("schema.manifest.json");
    let functions = generated("functions.manifest.json");
    let provisioned = post_json(
        &descriptor.server_url,
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
    let target = expected_target(&schema, &functions);
    let declared = post_json(
        &descriptor.server_url,
        "/_snapback/api/host-ops",
        &token,
        json!({
            "operation": "app.readiness.v1",
            "input": { "expectedTarget": target },
        }),
    );
    assert_eq!(declared["ok"], true, "{declared}");
    let readiness: OperationalReadinessV1 =
        serde_json::from_value(declared["data"]["operationalReadiness"].clone()).unwrap();
    assert!(readiness.ready);

    let default_receipt = application_ready_sibling(&ready_file);
    assert_timeout(
        &run_wait(&ready_file, "application", 2_000, None, None),
        "application-ready-receipt-missing",
    );

    let correct = receipt(&ready_file, &readiness);
    write_receipt(&default_receipt, &correct, 0o600);
    let happy = run_wait(&ready_file, "application", 2_000, None, None);
    assert!(
        happy.status.success(),
        "application wait failed: {}",
        String::from_utf8_lossy(&happy.stderr)
    );
    let happy = envelope(&happy);
    assert_eq!(happy["data"]["operationalReadiness"]["ready"], true);
    assert_eq!(
        happy["data"]["applicationReadyFile"],
        default_receipt.display().to_string()
    );

    let mut stale_nonce = correct.clone();
    stale_nonce.startup_nonce = "stale-startup-nonce".to_owned();
    write_receipt(&default_receipt, &stale_nonce, 0o600);
    assert_timeout(
        &run_wait(&ready_file, "application", 150, None, None),
        "receipt-startup-nonce-mismatch",
    );

    let mut wrong_target = correct.clone();
    let ApplicationIdentityV1::DevGenerated {
        deployment,
        obligations_digest,
    } = &mut wrong_target.application;
    deployment.inputs_hash.push_str("-wrong-target");
    *obligations_digest = format!("sha256:{}", "0".repeat(64));
    write_receipt(&default_receipt, &wrong_target, 0o600);
    assert_timeout(
        &run_wait(&ready_file, "application", 150, None, None),
        "operational-readiness-target-mismatch",
    );

    let mut wrong_digest = correct.clone();
    wrong_digest.host_ready_descriptor_digest = format!("sha256:{}", "f".repeat(64));
    write_receipt(&default_receipt, &wrong_digest, 0o600);
    assert_timeout(
        &run_wait(&ready_file, "application", 150, None, None),
        "host-ready-descriptor-digest-mismatch",
    );

    fs::remove_file(&default_receipt).unwrap();
    let override_receipt = directory.path().join("chosen-app-ready.json");
    write_receipt(&override_receipt, &correct, 0o600);
    let override_success = run_wait(
        &ready_file,
        "application",
        2_000,
        Some(&override_receipt),
        Some(&token),
    );
    assert!(
        override_success.status.success(),
        "override wait failed: {}",
        String::from_utf8_lossy(&override_success.stderr)
    );
    assert_eq!(
        envelope(&override_success)["data"]["applicationReadyFile"],
        override_receipt.display().to_string()
    );
    assert_timeout(
        &run_wait(&ready_file, "application", 150, None, None),
        "application-ready-receipt-missing",
    );

    write_receipt(&default_receipt, &correct, 0o644);
    assert_timeout(
        &run_wait(&ready_file, "application", 150, None, None),
        "application-ready-receipt-unreadable",
    );
}
