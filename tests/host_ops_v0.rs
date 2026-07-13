//! LLP 0032 P6: the host-ops first slice. One operation endpoint
//! (`POST /_snapback/api/host-ops`), one `hostOpsResult` envelope per call,
//! served ops app.inspect / app.reset / schema.load / functions.load /
//! function.run / function.explain; pinned-not-built ops fail closed with a
//! structured diagnostic; the readiness descriptor validates for LLP 0030
//! attach. The mutationDryRun explain kind has its own suite in
//! `tests/dry_run_v0.rs`.

use serde_json::{Value, json};
use snapback::host_ops::{HostOpsRequest, HostReadyDescriptor, execute_host_op};
use snapback::local::LocalSnapback;
use std::fs;
use std::path::PathBuf;

fn generated(file: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("demos/todo/snapback/generated")
        .join(file);
    serde_json::from_str(&fs::read_to_string(path).expect("read generated artifact"))
        .expect("parse generated artifact")
}

fn request(body: Value) -> HostOpsRequest {
    serde_json::from_value(body).expect("host-ops request parses")
}

fn envelope(snapback: &mut LocalSnapback, body: Value) -> Value {
    let result = execute_host_op(
        snapback,
        request(body),
        Some("http://127.0.0.1:0".to_owned()),
    );
    serde_json::to_value(&result).expect("envelope serializes")
}

#[test]
fn p6_served_ops_round_trip_through_envelopes() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");

    // schema.load
    let loaded = envelope(
        &mut snapback,
        json!({ "operation": "schema.load", "schema": generated("schema.manifest.json") }),
    );
    assert_eq!(loaded["ok"], json!(true), "schema.load: {loaded}");
    assert_eq!(loaded["resultKind"], json!("hostOpsResult"));
    assert_eq!(loaded["operation"], json!("schema.load"));
    assert!(
        loaded["artifacts"]["schemaHash"].is_string(),
        "schema hash reported"
    );
    assert_eq!(loaded["target"]["appId"], json!("todo"));
    assert_eq!(
        loaded["target"]["targetProfile"],
        json!("local-dev-sqlite-ibex")
    );

    // functions.load
    let functions = envelope(
        &mut snapback,
        json!({ "operation": "functions.load", "functions": generated("functions.manifest.json") }),
    );
    assert_eq!(functions["ok"], json!(true), "functions.load: {functions}");
    assert!(
        functions["artifacts"]["bundleHash"].is_string(),
        "bundle hash reported"
    );
    assert!(functions["data"]["functionCount"].as_u64().unwrap() >= 4);

    // app.reset with a seed
    let seed_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("demos/todo/snapback/seed.json");
    let seed: Value =
        serde_json::from_str(&fs::read_to_string(seed_path).expect("read seed")).expect("seed");
    let reset = envelope(
        &mut snapback,
        json!({ "operation": "app.reset", "seed": seed }),
    );
    assert_eq!(reset["ok"], json!(true), "app.reset: {reset}");
    assert_eq!(reset["data"]["seeded"], json!(true));
    assert_eq!(reset["authority"]["mode"], json!("devAdminBypass"));

    // function.run — a query as a dev user
    let query = envelope(
        &mut snapback,
        json!({ "operation": "function.run", "function": "listTodos", "userId": "user_ada" }),
    );
    assert_eq!(query["ok"], json!(true), "function.run query: {query}");
    assert_eq!(query["authority"]["mode"], json!("devUser"));
    assert!(
        query["data"]["functionResult"]["rows"].is_array(),
        "query rows present"
    );

    // function.run — a mutation, then observe the version advance
    let before = query["artifacts"]["databaseVersion"].as_u64().unwrap();
    let mutation = envelope(
        &mut snapback,
        json!({
            "operation": "function.run",
            "function": "createTodo",
            "args": { "title": "from host-ops" },
            "userId": "user_ada",
        }),
    );
    assert_eq!(
        mutation["ok"],
        json!(true),
        "function.run mutation: {mutation}"
    );
    assert!(mutation["data"]["mutationCommit"].is_object());
    assert!(mutation["artifacts"]["databaseVersion"].as_u64().unwrap() > before);

    // app.inspect
    let inspect = envelope(&mut snapback, json!({ "operation": "app.inspect" }));
    assert_eq!(inspect["ok"], json!(true));
    assert_eq!(
        inspect["data"]["runtimeState"]["artifactKind"],
        json!("runtimeState"),
        "runtime state rides data.runtimeState"
    );
    assert!(
        inspect["data"]["runtimeState"]["capabilityManifest"].is_object(),
        "capability manifest rides the runtime state"
    );
}

#[test]
fn host_ops_reset_and_seed_roll_back_as_one_operation() {
    let mut snapback = LocalSnapback::memory().unwrap();
    let loaded = envelope(
        &mut snapback,
        json!({ "operation": "schema.load", "schema": generated("schema.manifest.json") }),
    );
    assert_eq!(loaded["ok"], true);
    let initial_seed: Value = serde_json::from_str(
        &fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("demos/todo/snapback/seed.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        envelope(
            &mut snapback,
            json!({ "operation": "app.reset", "seed": initial_seed })
        )["ok"],
        true
    );
    let before = snapback.scan_table("todos", 100, 0).unwrap();
    assert!(!before.rows.is_empty());

    let rejected = envelope(
        &mut snapback,
        json!({
            "operation": "app.reset",
            "seed": { "tables": { "todos": [
                { "_id": "valid-prefix", "title": "valid", "completed": false, "userId": "user_1" },
                { "_id": "bad", "title": null, "completed": false, "userId": "user_1" }
            ] } }
        }),
    );
    assert_eq!(rejected["ok"], false, "{rejected}");
    assert_eq!(
        snapback.scan_table("todos", 100, 0).unwrap().rows,
        before.rows,
        "host-ops must preserve the pre-reset database on seed failure"
    );
}

#[test]
fn p6_unserved_ops_fail_closed_with_structured_envelopes() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");

    let unknown = envelope(&mut snapback, json!({ "operation": "app.nonsense" }));
    assert_eq!(unknown["ok"], json!(false));
    assert_eq!(
        unknown["diagnostics"][0]["code"],
        json!("SNAPBACK_HOST_OP_UNKNOWN")
    );

    let pinned = envelope(&mut snapback, json!({ "operation": "schema.reload" }));
    assert_eq!(pinned["ok"], json!(false));
    assert_eq!(
        pinned["diagnostics"][0]["code"],
        json!("SNAPBACK_HOST_OP_UNIMPLEMENTED")
    );

    // function.explain is served since ENG-23896, but only for the
    // mutationDryRun kind: a missing kind and the unbuilt kinds fail closed.
    let no_kind = envelope(&mut snapback, json!({ "operation": "function.explain" }));
    assert_eq!(no_kind["ok"], json!(false));
    assert_eq!(
        no_kind["diagnostics"][0]["code"],
        json!("SNAPBACK_HOST_OP_INPUT_MISSING")
    );

    let unbuilt_kind = envelope(
        &mut snapback,
        json!({ "operation": "function.explain", "kind": "queryPlan" }),
    );
    assert_eq!(unbuilt_kind["ok"], json!(false));
    assert_eq!(
        unbuilt_kind["diagnostics"][0]["code"],
        json!("SNAPBACK_EXPLAIN_KIND_UNIMPLEMENTED")
    );

    let unknown_kind = envelope(
        &mut snapback,
        json!({ "operation": "function.explain", "kind": "vibeCheck" }),
    );
    assert_eq!(unknown_kind["ok"], json!(false));
    assert_eq!(
        unknown_kind["diagnostics"][0]["code"],
        json!("SNAPBACK_EXPLAIN_KIND_UNKNOWN")
    );

    let cli_only = envelope(&mut snapback, json!({ "operation": "host.start" }));
    assert_eq!(cli_only["ok"], json!(false));
    assert_eq!(
        cli_only["diagnostics"][0]["code"],
        json!("SNAPBACK_HOST_OP_CLI_ONLY")
    );

    let missing_input = envelope(&mut snapback, json!({ "operation": "schema.load" }));
    assert_eq!(missing_input["ok"], json!(false));
    assert_eq!(
        missing_input["diagnostics"][0]["code"],
        json!("SNAPBACK_HOST_OP_INPUT_MISSING")
    );

    let unknown_function = envelope(
        &mut snapback,
        json!({ "operation": "function.run", "function": "nope" }),
    );
    assert_eq!(unknown_function["ok"], json!(false));
    assert_eq!(
        unknown_function["diagnostics"][0]["code"],
        json!("SNAPBACK_HOST_OP_FUNCTION_UNKNOWN")
    );

    // A request id supplied by the caller is echoed.
    let echoed = envelope(
        &mut snapback,
        json!({ "operation": "app.inspect", "requestId": "hop_fixed" }),
    );
    assert_eq!(echoed["requestId"], json!("hop_fixed"));
}

#[tokio::test]
async fn p6_ready_file_descriptor_is_written_and_validates() {
    let dir = tempfile::tempdir().expect("tempdir");
    let ready_path = dir.path().join("ready.json");
    let args = snapback::cli::Args {
        host: "127.0.0.1".to_owned(),
        port: Some(0),
        db: PathBuf::from(".snapback/unused.sqlite3"),
        memory: true,
        ready_file: Some(ready_path.clone()),
    };
    let server = tokio::spawn(snapback::cli::run(args));

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !ready_path.exists() {
        assert!(
            std::time::Instant::now() < deadline,
            "ready file never appeared"
        );
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    let value: Value =
        serde_json::from_str(&fs::read_to_string(&ready_path).expect("read ready file"))
            .expect("ready file is JSON");
    let descriptor =
        HostReadyDescriptor::validate(&value).expect("descriptor validates for attach");
    assert_eq!(descriptor.descriptor_kind, "snapbackHostReady");
    assert!(descriptor.ready);
    assert_eq!(descriptor.pid, std::process::id());
    assert!(descriptor.server_url.starts_with("http://127.0.0.1:"));
    assert_eq!(descriptor.database.mode, "memory");
    // The stop-verification identity (ENG-23366): the descriptor carries the
    // same per-process nonce this process reports on /health, so `snapback
    // stop` can confirm the pid still belongs to this server before signaling.
    assert_eq!(
        descriptor.startup_nonce.as_deref(),
        Some(snapback::identity::binary_identity().startup_nonce.as_str())
    );

    // The attach validation actually rejects: a tampered descriptor fails.
    let mut tampered = value.clone();
    tampered["ready"] = json!(false);
    assert!(HostReadyDescriptor::validate(&tampered).is_err());

    server.abort();
}
