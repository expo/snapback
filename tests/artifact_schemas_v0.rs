//! DK-7 / LLP 0037: the Rust serde types are the single source of truth for the
//! Snapback-owned shared artifact shapes. The JSON Schemas under `schemas/` are
//! generated from those types (`snapback::schema_export::artifact_schemas`) and
//! committed. These tests are:
//!   1. the drift gate — committed `schemas/*` byte/value-match the schema the
//!      Rust types generate right now (fails CI on an unregenerated type change);
//!   2. the round-trip gate — a representative value of each artifact serializes
//!      via serde_json and validates against the committed schema, proving the
//!      generated schema matches the actual serde representation;
//!   3. the demo-artifact gate — every committed generated demo manifest
//!      validates against the schema and parses back through the runtime struct.
//!
//! Regenerate the committed schemas with:
//!   DYLD_FRAMEWORK_PATH="$PWD/vendor/ibex/ios/Frameworks" \
//!     cargo run --bin snapback-schemagen
//!
//! @ref LLP 0037#decision-ratified-2026-07-02 — generated, committed,
//!   drift-gated schemas instead of hand-synced shape definitions.
//! @ref LLP 0032#decision-docket — DK-7 / P3(c): schemars-derived schemas + Rust drift gate.

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

use snapback::cron::CronInspectState;
use snapback::data_tier::{
    DATA_TIER_CORPUS_FORMAT_VERSION, DATA_TIER_CORPUS_NAME, DATA_TIER_PROFILE_FILE,
    DataTierCaseExpectation, DataTierCaseSchema, DataTierCorpusCase, DataTierCorpusCaseEntry,
    DataTierCorpusManifest, DataTierProfile,
};
use snapback::diagnostic::Diagnostic;
use snapback::ephemeral::EphemeralDiagnostics;
use snapback::local::{
    InspectState, LiveDeliveryStats, LiveResumeInput, LiveSubscribeInput, LiveUnsubscribeInput,
    PublicInspect,
};
use snapback::manifest::{
    AuthInput, CTX_ANSWER_LEDGER_MAX_IDS, CapabilityManifest, FunctionManifest, HandlerInput,
    MutationPlan, MutationRequest, REPLAY_OPAQUE_ID_MAX_BYTES, REPLAY_OPAQUE_ID_PATTERN,
    SNAPBACK_SCHEMA_VERSION, SchemaManifest, TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX,
};
use snapback::runtime::{
    CapabilityState, IbexCliCapability, IbexSubmoduleCapability, RuntimeCapabilities,
};
use snapback::schema_export::{SchemaArtifact, artifact_instances, artifact_schemas};
use snapback::service_profile::{
    PublishedArtifactRef, RemoteAuthCapabilityManifest, RemoteCredentialPolicy,
    RemoteDataCapabilityManifest, RemoteEndpointPolicy, RemoteServiceDataTierIdentity,
    RemoteServiceGitPublication, RemoteServiceOperation, RemoteServiceProfile,
};
use snapback::storage::StorageInfo;

fn schemas_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("schemas")
}

fn committed(file: &str) -> Value {
    let path = schemas_dir().join(file);
    let text = fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "{file} is missing; regenerate with `cargo run --bin snapback-schemagen` \
             (LLP 0037 / LLP 0032 P3c)"
        )
    });
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("parse committed {file}: {error}"))
}

fn assert_validates(file: &str, value: &Value) {
    let schema = committed(file);
    let validator = jsonschema::validator_for(&schema)
        .unwrap_or_else(|error| panic!("compile committed {file}: {error}"));
    let errors: Vec<String> = validator
        .iter_errors(value)
        .map(|error| format!("  {}: {error}", error.instance_path()))
        .collect();
    assert!(
        errors.is_empty(),
        "a representative value does not validate against the committed {file} — \
         the generated schema does not match the serde representation (schemars/serde \
         mismatch):\n{}",
        errors.join("\n")
    );
}

fn assert_rejects(file: &str, value: &Value) {
    let schema = committed(file);
    let validator = jsonschema::validator_for(&schema)
        .unwrap_or_else(|error| panic!("compile committed {file}: {error}"));
    assert!(
        !validator.is_valid(value),
        "an out-of-contract value unexpectedly validates against {file}: {value}"
    );
}

#[test]
fn mutation_replay_bounds_match_the_public_data_tier_profile() {
    let schema = committed("mutation.input.schema.json");
    let profile = DataTierProfile::current();
    let client_id = &schema["properties"]["clientMutationId"];
    let ledger_ids = &schema["$defs"]["CtxAnswerLedger"]["properties"]["ids"];

    assert_eq!(client_id["minLength"], json!(1));
    assert_eq!(client_id["maxLength"], json!(REPLAY_OPAQUE_ID_MAX_BYTES));
    assert_eq!(client_id["pattern"], json!(REPLAY_OPAQUE_ID_PATTERN));
    assert_eq!(ledger_ids["maxItems"], json!(profile.bounds.max_ledger_ids));
    assert_eq!(
        ledger_ids["items"]["maxLength"],
        json!(profile.bounds.max_ledger_id_bytes)
    );
    assert_eq!(
        ledger_ids["items"]["pattern"],
        json!(profile.bounds.opaque_id_pattern)
    );
    assert_eq!(profile.bounds.max_ledger_ids, CTX_ANSWER_LEDGER_MAX_IDS);

    let base = serde_json::to_value(MutationRequest {
        input: HandlerInput::default(),
        client_mutation_id: Some("cm_valid".to_owned()),
    })
    .unwrap();
    for invalid in [String::new(), "bad/id".to_owned(), "x".repeat(257)] {
        let mut request = base.clone();
        request["clientMutationId"] = json!(invalid);
        assert_rejects("mutation.input.schema.json", &request);
    }

    let mut too_many = base.clone();
    too_many["ctx_ledger"] = json!({
        "version": 1,
        "ids": vec!["id"; CTX_ANSWER_LEDGER_MAX_IDS + 1],
        "now": 1,
    });
    assert_rejects("mutation.input.schema.json", &too_many);

    let mut bad_ledger_id = base;
    bad_ledger_id["ctx_ledger"] = json!({
        "version": 1,
        "ids": ["bad/id"],
        "now": 1,
    });
    assert_rejects("mutation.input.schema.json", &bad_ledger_id);
}

/// Drift gate: what the Rust types generate now must equal what is committed.
#[test]
fn dk7_committed_schemas_match_rust_types() {
    for SchemaArtifact { file, schema } in artifact_schemas() {
        let on_disk = committed(file);
        assert_eq!(
            on_disk, schema,
            "{file} drifted from the Rust types; regenerate with \
             `cargo run --bin snapback-schemagen` (LLP 0037 / LLP 0032 P3c)"
        );
    }
}

#[test]
fn dk7_committed_public_instances_match_rust_types() {
    for SchemaArtifact { file, schema } in artifact_instances() {
        let on_disk = committed(file);
        assert_eq!(
            on_disk, schema,
            "{file} drifted from the Rust authority; regenerate with `cargo run --bin snapback-schemagen`"
        );
    }
}

/// Every committed schema file has a corresponding generated artifact and vice
/// versa — a new artifact type without a committed schema (or a stray file) is a
/// failure, not a silent gap.
#[test]
fn dk7_every_artifact_has_a_committed_schema_file() {
    let generated: std::collections::BTreeSet<String> = artifact_schemas()
        .into_iter()
        .map(|a| a.file.to_owned())
        .collect();
    let committed: std::collections::BTreeSet<String> = fs::read_dir(schemas_dir())
        .expect("read schemas/ dir")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".schema.json"))
        .collect();
    assert_eq!(
        generated, committed,
        "schemas/ is out of sync with the generator; regenerate with \
         `cargo run --bin snapback-schemagen`"
    );
}

/// A representative InspectState literal exercising the full runtime/inspect
/// closure (manifests, runtime capabilities, cron, ephemeral, diagnostics).
fn representative_inspect() -> InspectState {
    InspectState {
        artifact_kind: "inspectState".to_owned(),
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        target_profile_id: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
        target: "local".to_owned(),
        storage: StorageInfo {
            sqlite_path: None,
            version: 7,
            tables: vec!["todos".to_owned()],
        },
        runtime: RuntimeCapabilities {
            canonical_engine: "ibex".to_owned(),
            ibex_submodule: IbexSubmoduleCapability {
                present: true,
                path: None,
            },
            ibex_cli: IbexCliCapability {
                available: false,
                path: None,
                version: None,
            },
            host_plan_runtime: true,
            ibex_ctx_db_host_bridge: CapabilityState::Available,
            async_handler_completion: CapabilityState::Available,
            sqlite_lock_held_across_async: CapabilityState::NotYetWired,
            mutation_dry_run: true,
        },
        schema: SchemaManifest::default(),
        functions: FunctionManifest::default(),
        capability_manifest: CapabilityManifest::local_v0(vec!["postgres".to_owned()]),
        subscriptions: vec![],
        active_connections: 0,
        reaped_connections: 0,
        live_delivery: LiveDeliveryStats::default(),
        ephemeral: EphemeralDiagnostics::default(),
        cron: CronInspectState {
            artifact_kind: "cronInspectState".to_owned(),
            schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
            jobs: vec![],
            recent_runs: vec![],
            diagnostics: vec![],
        },
        recent_diagnostics: vec![Diagnostic::info("SNAPBACK_READY", "server", "ready")],
        capability_gaps: vec!["postgres".to_owned()],
    }
}

/// Round-trip gate: a representative value of every artifact serializes and
/// validates against its committed schema — the direct proof that the generated
/// schema matches the serde output.
#[test]
fn dk7_representative_values_validate_against_committed_schemas() {
    assert_validates(
        "schema.manifest.schema.json",
        &serde_json::to_value(SchemaManifest::default()).unwrap(),
    );
    assert_validates(
        "functions.manifest.schema.json",
        &serde_json::to_value(FunctionManifest::default()).unwrap(),
    );
    assert_validates(
        "data-tier.profile.schema.json",
        &serde_json::to_value(DataTierProfile::current()).unwrap(),
    );
    assert_validates(
        "data-tier.corpus.schema.json",
        &serde_json::to_value(DataTierCorpusManifest {
            artifact_kind: "dataTierCorpusManifest".to_owned(),
            corpus: DATA_TIER_CORPUS_NAME.to_owned(),
            corpus_format_version: DATA_TIER_CORPUS_FORMAT_VERSION,
            profile_version: snapback::value_expr::DATA_TIER_PROFILE_VERSION,
            ledger_version: snapback::manifest::CTX_ANSWER_LEDGER_VERSION,
            profile_path: DATA_TIER_PROFILE_FILE.to_owned(),
            cases: vec![DataTierCorpusCaseEntry {
                name: "empty".to_owned(),
                path: "empty.case.json".to_owned(),
                sha256: "sha256:test".to_owned(),
                required_capabilities: vec!["irEvaluator".to_owned()],
                minimum_profile_version: 1,
            }],
        })
        .unwrap(),
    );
    assert_validates(
        "data-tier.case.schema.json",
        &serde_json::to_value(DataTierCorpusCase {
            corpus: DATA_TIER_CORPUS_NAME.to_owned(),
            corpus_version: DATA_TIER_CORPUS_FORMAT_VERSION,
            name: "empty".to_owned(),
            notes: None,
            required_capabilities: vec!["irEvaluator".to_owned()],
            minimum_profile_version: 1,
            schema: DataTierCaseSchema { tables: Vec::new() },
            seed: Default::default(),
            plan: MutationPlan {
                steps: Vec::new(),
                return_value: None,
            },
            args: json!({}),
            auth_user_id: None,
            ctx_ledger: None,
            expect: DataTierCaseExpectation::default(),
        })
        .unwrap(),
    );
    assert_validates(
        "capability.manifest.schema.json",
        &serde_json::to_value(CapabilityManifest::local_v0(vec!["postgres".to_owned()])).unwrap(),
    );
    let artifact_ref = PublishedArtifactRef {
        path: "schemas/example.json".to_owned(),
        sha256: format!("sha256:{}", "0".repeat(64)),
    };
    let auth_manifest = RemoteAuthCapabilityManifest {
        artifact_kind: "remoteAuthCapabilityManifest".to_owned(),
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        manifest_version: 1,
        capability_id: "snapback.auth.todo-v2".to_owned(),
        app_id: "todo-v2".to_owned(),
        target_profile_id: "remote-service-sqlite-ibex".to_owned(),
        credential_policy: RemoteCredentialPolicy {
            presentation: "authorization-bearer".to_owned(),
            authority: "host-private".to_owned(),
            value_in_artifacts: false,
            value_in_arguments: false,
            value_in_environment: false,
            value_in_info_plist: false,
            supports_rotation: true,
        },
    };
    assert_validates(
        "remote-service.auth-capability.manifest.schema.json",
        &serde_json::to_value(&auth_manifest).unwrap(),
    );
    let operation = RemoteServiceOperation {
        name: "createTodo".to_owned(),
        function_id: "todo-v2:createTodo".to_owned(),
        kind: "Mutation".to_owned(),
        auth_requirement: "optional-user".to_owned(),
        arguments_schema: artifact_ref.clone(),
        request_schema: artifact_ref.clone(),
        response_schema: artifact_ref.clone(),
        receipt_schema: artifact_ref.clone(),
        error_schema: artifact_ref.clone(),
    };
    let data_manifest = RemoteDataCapabilityManifest {
        artifact_kind: "remoteDataCapabilityManifest".to_owned(),
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        manifest_version: 1,
        capability_id: "snapback.data.todo-v2".to_owned(),
        app_id: "todo-v2".to_owned(),
        target_profile_id: "remote-service-sqlite-ibex".to_owned(),
        schema_manifest: artifact_ref.clone(),
        function_manifest: artifact_ref.clone(),
        capability_manifest: artifact_ref.clone(),
        wire_schemas: std::collections::BTreeMap::from([(
            "mutationInput".to_owned(),
            artifact_ref.clone(),
        )]),
        operations: vec![operation],
    };
    assert_validates(
        "remote-service.data-capability.manifest.schema.json",
        &serde_json::to_value(&data_manifest).unwrap(),
    );
    let profile = RemoteServiceProfile {
        artifact_kind: "remoteServiceProfile".to_owned(),
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        profile_version: 1,
        profile_id: "remote-service-sqlite-ibex".to_owned(),
        app_id: "todo-v2".to_owned(),
        target_profile_id: "remote-service-sqlite-ibex".to_owned(),
        local_server_lifecycle: false,
        publication: RemoteServiceGitPublication {
            kind: "gitPinnedCheckout".to_owned(),
            addressing: "commitSha".to_owned(),
            repository: "https://github.com/ccheever/snapback.git".to_owned(),
            profile_path:
                "demos/todo-v2/snapback/generated-remote-service/remote-service.profile.json"
                    .to_owned(),
        },
        endpoint_policy: RemoteEndpointPolicy {
            scheme: "https".to_owned(),
            authority: "host-private".to_owned(),
            value_in_artifacts: false,
            value_in_arguments: false,
            value_in_environment: false,
            value_in_info_plist: false,
            allow_redirects: false,
            allow_ambient_proxy: false,
        },
        server_capability_manifest: artifact_ref.clone(),
        auth_capability_manifest: artifact_ref.clone(),
        data_capability_manifest: artifact_ref.clone(),
        data_tier: RemoteServiceDataTierIdentity {
            corpus: DATA_TIER_CORPUS_NAME.to_owned(),
            profile_version: 1,
            corpus_format_version: 1,
            ledger_version: 1,
            case_count: 29,
            profile: artifact_ref.clone(),
            corpus_manifest: artifact_ref,
        },
    };
    assert_validates(
        "remote-service.profile.schema.json",
        &serde_json::to_value(&profile).unwrap(),
    );
    assert_validates(
        "diagnostic.schema.json",
        &serde_json::to_value(
            Diagnostic::error("SNAPBACK_TEST", "storage", "boom")
                .with_details(json!({ "table": "todos" })),
        )
        .unwrap(),
    );
    assert_validates(
        "storage-info.schema.json",
        &serde_json::to_value(StorageInfo {
            sqlite_path: Some(PathBuf::from("/tmp/app.sqlite")),
            version: 3,
            tables: vec!["todos".to_owned()],
        })
        .unwrap(),
    );
    let inspect = representative_inspect();
    assert_validates(
        "inspect.schema.json",
        &serde_json::to_value(&inspect).unwrap(),
    );
    assert_validates(
        "inspect.public.schema.json",
        &serde_json::to_value(PublicInspect::from(inspect)).unwrap(),
    );
}

/// ENG-23964 publication gate: a clean consumer can trust the committed
/// profile + corpus manifest + cases without compiling Rust.
#[test]
fn data_tier_publication_validates_against_committed_schemas() {
    assert_validates(
        "data-tier.profile.schema.json",
        &committed("data-tier.profile.json"),
    );

    let corpus_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("conformance")
        .join("data-tier");
    let manifest: Value = serde_json::from_str(
        &fs::read_to_string(corpus_dir.join("corpus.manifest.json")).expect("read corpus manifest"),
    )
    .expect("parse corpus manifest");
    assert_validates("data-tier.corpus.schema.json", &manifest);

    for entry in manifest["cases"].as_array().expect("manifest cases") {
        let path = corpus_dir.join(entry["path"].as_str().expect("case path"));
        let case: Value = serde_json::from_str(&fs::read_to_string(&path).expect("read case"))
            .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()));
        assert_validates("data-tier.case.schema.json", &case);
    }
}

#[test]
fn remote_service_publication_is_closed_digest_bound_and_host_private() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let generated = root.join("demos/todo-v2/snapback/generated-remote-service");
    let read_json = |path: &std::path::Path| -> Value {
        serde_json::from_str(
            &fs::read_to_string(path)
                .unwrap_or_else(|_| panic!("missing remote publication {}", path.display())),
        )
        .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()))
    };
    let profile_value = read_json(&generated.join("remote-service.profile.json"));
    let auth_value = read_json(&generated.join("remote-auth-capability.manifest.json"));
    let data_value = read_json(&generated.join("remote-data-capability.manifest.json"));
    assert_validates("remote-service.profile.schema.json", &profile_value);
    assert_validates(
        "remote-service.auth-capability.manifest.schema.json",
        &auth_value,
    );
    assert_validates(
        "remote-service.data-capability.manifest.schema.json",
        &data_value,
    );

    let profile: RemoteServiceProfile =
        serde_json::from_value(profile_value).expect("parse remote service profile type");
    let auth: RemoteAuthCapabilityManifest =
        serde_json::from_value(auth_value).expect("parse remote auth manifest type");
    let data: RemoteDataCapabilityManifest =
        serde_json::from_value(data_value).expect("parse remote data manifest type");
    assert!(!profile.local_server_lifecycle);
    assert_eq!(profile.endpoint_policy.scheme, "https");
    assert_eq!(profile.endpoint_policy.authority, "host-private");
    assert!(!profile.endpoint_policy.value_in_artifacts);
    assert!(!profile.endpoint_policy.value_in_arguments);
    assert!(!profile.endpoint_policy.value_in_environment);
    assert!(!profile.endpoint_policy.value_in_info_plist);
    assert!(!profile.endpoint_policy.allow_redirects);
    assert!(!profile.endpoint_policy.allow_ambient_proxy);
    assert_eq!(auth.credential_policy.authority, "host-private");
    assert!(auth.credential_policy.supports_rotation);
    assert!(!auth.credential_policy.value_in_artifacts);
    assert!(!auth.credential_policy.value_in_arguments);
    assert!(!auth.credential_policy.value_in_environment);
    assert!(!auth.credential_policy.value_in_info_plist);

    let verify_ref = |reference: &PublishedArtifactRef| {
        let bytes = fs::read(root.join(&reference.path))
            .unwrap_or_else(|_| panic!("missing published ref {}", reference.path));
        let actual = format!("sha256:{:x}", Sha256::digest(bytes));
        assert_eq!(
            reference.sha256, actual,
            "digest mismatch for {}",
            reference.path
        );
    };
    verify_ref(&profile.server_capability_manifest);
    verify_ref(&profile.auth_capability_manifest);
    verify_ref(&profile.data_capability_manifest);
    verify_ref(&profile.data_tier.profile);
    verify_ref(&profile.data_tier.corpus_manifest);
    verify_ref(&data.schema_manifest);
    verify_ref(&data.function_manifest);
    verify_ref(&data.capability_manifest);
    for reference in data.wire_schemas.values() {
        verify_ref(reference);
    }
    for operation in &data.operations {
        verify_ref(&operation.arguments_schema);
        verify_ref(&operation.request_schema);
        verify_ref(&operation.response_schema);
        verify_ref(&operation.receipt_schema);
        verify_ref(&operation.error_schema);
    }

    let operation_names = data
        .operations
        .iter()
        .map(|operation| operation.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        operation_names,
        ["createTodo", "setCompleted", "deleteTodo"]
    );
    let corpus = read_json(&root.join(&profile.data_tier.corpus_manifest.path));
    assert_eq!(
        profile.data_tier.case_count,
        corpus["cases"].as_array().expect("corpus cases").len()
    );
    assert!(profile.data_tier.case_count >= 29);
}

/// Live-wire round trips (LLP 0051 D4 / ENG-23891): a representative value of
/// every client-visible live-wire shape — as the SERVER actually constructs
/// it — validates against its committed schema.
#[test]
fn dk7_live_wire_values_validate_against_committed_schemas() {
    use snapback::ephemeral::{
        DeleteRequest, DurableMessage, EphemeralMessage, RealtimeEnvelope, ResyncReason, Scope,
        SubscribeRequest,
    };
    use snapback::live_wire::{
        LiveDeltaOpKind, LiveDeltaWireOp, LiveEnvelope, LiveSocketClientMessage,
        LiveSocketServerFrame, MutationReceiptOutcome, Receipt, SubscriptionReceiptEvent,
    };
    use snapback::local::{LiveResumeOutput, LiveSubscribeOutput, LiveUnsubscribeOutput};
    use snapback::manifest::QueryOutput;
    use snapback::server::{
        ConnectionGrant, ErrorResponse, MutationResponse, OpenConnectionRequest,
    };

    for envelope in [
        LiveEnvelope::LiveReplace {
            subscription_id: "sub_1".to_owned(),
            function: "listTodos".to_owned(),
            version: 7,
            rows: vec![json!({ "_id": "a", "title": "x" })],
        },
        LiveEnvelope::LiveDelta {
            subscription_id: "sub_1".to_owned(),
            function: "listTodos".to_owned(),
            version: 8,
            ops: vec![
                LiveDeltaWireOp {
                    op: LiveDeltaOpKind::Add,
                    id: "b".to_owned(),
                    row: Some(json!({ "_id": "b" })),
                },
                LiveDeltaWireOp {
                    op: LiveDeltaOpKind::Remove,
                    id: "a".to_owned(),
                    row: None,
                },
            ],
        },
        LiveEnvelope::ResyncRequired {
            reason: "outbox_overflow".to_owned(),
            subscription_id: None,
            scope: None,
            epoch: None,
            clear_retained: true,
        },
        LiveEnvelope::ResyncRequired {
            reason: "permission_epoch_changed".to_owned(),
            subscription_id: Some("sub_1".to_owned()),
            scope: Some("user:alice".to_owned()),
            epoch: Some(2),
            clear_retained: true,
        },
    ] {
        assert_validates(
            "live.envelope.schema.json",
            &serde_json::to_value(&envelope).unwrap(),
        );
    }

    for frame in [
        LiveSocketServerFrame::Pong {
            request_id: Some("r1".to_owned()),
            server_time_ms: 123,
        },
        LiveSocketServerFrame::EphemeralAck {
            request_id: None,
            operation: "publish".to_owned(),
            body: json!({ "outcome": { "entry_version": 1 } })
                .as_object()
                .unwrap()
                .clone(),
        },
        LiveSocketServerFrame::EphemeralError {
            request_id: Some("r2".to_owned()),
            operation: "subscribe".to_owned(),
            diagnostic: Diagnostic::error("SNAPBACK_TEST", "realtime", "boom"),
        },
        LiveSocketServerFrame::Ephemeral {
            message: EphemeralMessage::ResyncRequired {
                room: snapback::ephemeral::RoomId {
                    collection: "cursors".to_owned(),
                    scope: Scope::from_pairs([("doc", "d1")]),
                    routing_key: "cursors|3:doc=2:d1".to_owned(),
                },
                scope_epoch: 1,
                reason: ResyncReason::Restarted,
            },
        },
    ] {
        assert_validates(
            "live.socket-server.schema.json",
            &serde_json::to_value(&frame).unwrap(),
        );
    }

    for message in [
        LiveSocketClientMessage::Ping {
            request_id: Some("p1".to_owned()),
        },
        LiveSocketClientMessage::EphemeralSubscribe {
            request_id: None,
            request: SubscribeRequest {
                collection: "cursors".to_owned(),
                scope: Scope::from_pairs([("doc", "d1")]),
                connection_id: "conn_1".to_owned(),
                auth: Default::default(),
            },
        },
        LiveSocketClientMessage::EphemeralDelete {
            request_id: Some("d1".to_owned()),
            request: DeleteRequest {
                collection: "cursors".to_owned(),
                scope: Scope::from_pairs([("doc", "d1")]),
                connection_id: "conn_1".to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                auth: Default::default(),
            },
        },
    ] {
        assert_validates(
            "live.socket-client.schema.json",
            &serde_json::to_value(&message).unwrap(),
        );
    }

    for receipt in [
        Receipt::Mutation {
            mutation_id: "mut_1".to_owned(),
            mutation: "addTodo".to_owned(),
            outcome: MutationReceiptOutcome::Confirmed,
            rollback_reason: None,
            affected_tables: Some(vec!["todos".to_owned()]),
            snapshot_version: 9,
            transport: "http".to_owned(),
            correlation: Value::Null,
            received_at_ms: 1,
        },
        Receipt::Subscription {
            event: SubscriptionReceiptEvent::Established,
            reason: None,
            subscription_id: Some("sub_1".to_owned()),
            superseded_by: None,
            lane: None,
            binding_id: None,
            collection: None,
            removed: None,
            scope: json!({ "listId": "l1" }),
            snapshot_version: Some(7),
            correlation: Some(Value::Null),
            received_at_ms: 2,
        },
        Receipt::Subscription {
            event: SubscriptionReceiptEvent::Disposed,
            reason: Some("unsubscribed".to_owned()),
            subscription_id: None,
            superseded_by: None,
            lane: Some("ephemeral".to_owned()),
            binding_id: Some("cursors".to_owned()),
            collection: Some("cursors".to_owned()),
            removed: Some(true),
            scope: json!({ "doc": "d1" }),
            snapshot_version: None,
            correlation: None,
            received_at_ms: 3,
        },
    ] {
        assert_validates("receipt.schema.json", &receipt.into_value());
    }

    for envelope in [
        RealtimeEnvelope::Durable(DurableMessage {
            payload: b"{\"kind\":\"live_replace\"}".to_vec(),
        }),
        RealtimeEnvelope::Ephemeral(EphemeralMessage::ResyncRequired {
            room: snapback::ephemeral::RoomId {
                collection: "cursors".to_owned(),
                scope: Scope::from_pairs([("doc", "d1")]),
                routing_key: "cursors|3:doc=2:d1".to_owned(),
            },
            scope_epoch: 1,
            reason: ResyncReason::QueueOverflow,
        }),
    ] {
        assert_validates(
            "realtime.envelope.schema.json",
            &serde_json::to_value(&envelope).unwrap(),
        );
    }

    assert_validates(
        "connection.grant.schema.json",
        &serde_json::to_value(ConnectionGrant {
            connection_id: "conn_1".to_owned(),
            connection_token: "tok_1".to_owned(),
        })
        .unwrap(),
    );
    let open_request = serde_json::to_value(OpenConnectionRequest {
        connection_id: Some("conn_1".to_owned()),
        previous_token: Some("sct_prior_bearer".to_owned()),
    })
    .unwrap();
    assert_validates("connection.open.input.schema.json", &open_request);
    assert_validates("connection.open.input.schema.json", &json!({}));
    let mut unknown_open_field = open_request.clone();
    unknown_open_field["logPreviousToken"] = json!(true);
    assert_rejects("connection.open.input.schema.json", &unknown_open_field);
    assert_rejects(
        "connection.open.input.schema.json",
        &json!({ "previousToken": 7 }),
    );

    let mutation_response = MutationResponse {
        version: 9,
        changed_count: 1,
        result: json!({ "id": "todo_1" }),
        ctx_ledger: None,
        receipt: Receipt::Mutation {
            mutation_id: "mut_direct_1".to_owned(),
            mutation: "addTodo".to_owned(),
            outcome: MutationReceiptOutcome::Confirmed,
            rollback_reason: None,
            affected_tables: Some(vec!["todos".to_owned()]),
            snapshot_version: 9,
            transport: "http".to_owned(),
            correlation: json!({ "actionInvocationId": "act_1" }),
            received_at_ms: 1,
        },
    };
    let mutation_response = serde_json::to_value(mutation_response).unwrap();
    assert_validates("mutation.output.schema.json", &mutation_response);
    assert!(mutation_response.get("previousToken").is_none());
    assert!(mutation_response.get("connectionToken").is_none());
    let mut missing_receipt = mutation_response.clone();
    missing_receipt.as_object_mut().unwrap().remove("receipt");
    assert_rejects("mutation.output.schema.json", &missing_receipt);
    let mut unknown_output_field = mutation_response;
    unknown_output_field["connectionToken"] = json!("must-not-appear");
    assert_rejects("mutation.output.schema.json", &unknown_output_field);

    assert_validates(
        "error.response.schema.json",
        &serde_json::to_value(ErrorResponse {
            diagnostic: Diagnostic::error("SNAPBACK_TEST", "realtime", "boom"),
            receipt: None,
        })
        .unwrap(),
    );
    assert_validates(
        "error.response.schema.json",
        &serde_json::to_value(ErrorResponse {
            diagnostic: Diagnostic::error("SNAPBACK_REJECTED", "mutation", "rejected"),
            receipt: Some(Receipt::Mutation {
                mutation_id: "mut_rejected_1".to_owned(),
                mutation: "addTodo".to_owned(),
                outcome: MutationReceiptOutcome::Rejected,
                rollback_reason: Some("SNAPBACK_REJECTED".to_owned()),
                affected_tables: Some(vec!["todos".to_owned()]),
                snapshot_version: 9,
                transport: "http".to_owned(),
                correlation: Value::Null,
                received_at_ms: 2,
            }),
        })
        .unwrap(),
    );

    let snapshot = QueryOutput {
        version: 7,
        rows: vec![json!({ "_id": "a" })],
    };
    assert_validates(
        "live.subscribe.output.schema.json",
        &serde_json::to_value(LiveSubscribeOutput {
            subscription_id: "sub_1".to_owned(),
            snapshot: snapshot.clone(),
            permission_epochs: std::collections::BTreeMap::new(),
            receipt: Some(json!({ "kind": "subscription" })),
        })
        .unwrap(),
    );
    let input = HandlerInput {
        args: json!({ "listId": "l1" }),
        auth: AuthInput {
            principal: Some("user_1".to_owned()),
            session_id: None,
            user_id: Some("user_1".to_owned()),
        },
        ..HandlerInput::default()
    };
    assert_validates(
        "query.input.schema.json",
        &serde_json::to_value(&input).unwrap(),
    );
    assert_validates(
        "mutation.input.schema.json",
        &serde_json::to_value(MutationRequest {
            input: input.clone(),
            client_mutation_id: Some("cm_schema_roundtrip".to_owned()),
        })
        .unwrap(),
    );
    assert_validates(
        "live.subscribe.input.schema.json",
        &serde_json::to_value(LiveSubscribeInput {
            connection_id: "conn_1".to_owned(),
            input: input.clone(),
            supersedes: None,
        })
        .unwrap(),
    );
    assert_validates(
        "live.resume.output.schema.json",
        &serde_json::to_value(LiveResumeOutput {
            subscription_id: "sub_1".to_owned(),
            mode: "retained".to_owned(),
            reason: None,
            snapshot: Some(snapshot),
            permission_epochs: std::collections::BTreeMap::new(),
        })
        .unwrap(),
    );
    assert_validates(
        "live.resume.input.schema.json",
        &serde_json::to_value(LiveResumeInput {
            subscription_id: "sub_1".to_owned(),
            connection_id: "conn_1".to_owned(),
            auth: input.auth.clone(),
            recorded_permission_epochs: Default::default(),
        })
        .unwrap(),
    );
    assert_validates(
        "live.unsubscribe.output.schema.json",
        &serde_json::to_value(LiveUnsubscribeOutput {
            subscription_id: "sub_1".to_owned(),
            disposed: true,
            receipt: None,
        })
        .unwrap(),
    );
    assert_validates(
        "live.unsubscribe.input.schema.json",
        &serde_json::to_value(LiveUnsubscribeInput {
            subscription_id: "sub_1".to_owned(),
            connection_id: "conn_1".to_owned(),
            auth: input.auth,
        })
        .unwrap(),
    );
}

const GENERATED_BACKENDS: [&str; 6] = [
    "demos/todo/snapback/generated",
    "demos/todo-v2/snapback/generated",
    "demos/all-aboard/snapback/generated",
    "demos/all-aboard/tests/egress-probe/generated",
    "demos/cursors-web/snapback/generated",
    "demos/graffiti/snapback/generated",
];

/// Demo-artifact gate: every committed generated demo manifest validates against
/// the Rust-derived schema (the codegen output the schema is meant to describe).
#[test]
fn dk7_committed_demo_manifests_validate_against_schemas() {
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let pairs = [
        ("schema.manifest.schema.json", "schema.manifest.json"),
        ("functions.manifest.schema.json", "functions.manifest.json"),
        (
            "capability.manifest.schema.json",
            "capability.manifest.json",
        ),
    ];
    for (schema_file, manifest_file) in pairs {
        let schema = committed(schema_file);
        let validator = jsonschema::validator_for(&schema)
            .unwrap_or_else(|error| panic!("compile {schema_file}: {error}"));
        for backend in GENERATED_BACKENDS {
            let path = repo.join(backend).join(manifest_file);
            let text = fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
            let manifest: Value = serde_json::from_str(&text)
                .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()));
            let errors: Vec<String> = validator
                .iter_errors(&manifest)
                .map(|error| format!("  {}: {error}", error.instance_path()))
                .collect();
            assert!(
                errors.is_empty(),
                "{backend}/{manifest_file} does not validate against {schema_file}:\n{}",
                errors.join("\n")
            );
        }
    }
}

/// The committed demo manifests also parse back through the runtime structs and
/// pass their artifact-header validation — the schema and the parser agree.
#[test]
fn dk7_committed_demo_manifests_parse_through_runtime_structs() {
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for backend in GENERATED_BACKENDS {
        let dir = repo.join(backend);
        let schema: SchemaManifest = serde_json::from_str(
            &fs::read_to_string(dir.join("schema.manifest.json")).expect("read schema manifest"),
        )
        .unwrap_or_else(|error| panic!("{backend}: schema manifest rejected: {error}"));
        schema.validate_artifact().expect("schema artifact header");
        let functions: FunctionManifest = serde_json::from_str(
            &fs::read_to_string(dir.join("functions.manifest.json"))
                .expect("read functions manifest"),
        )
        .unwrap_or_else(|error| panic!("{backend}: functions manifest rejected: {error}"));
        functions
            .validate_artifact()
            .expect("functions artifact header");
        let _capability: CapabilityManifest = serde_json::from_str(
            &fs::read_to_string(dir.join("capability.manifest.json"))
                .expect("read capability manifest"),
        )
        .unwrap_or_else(|error| panic!("{backend}: capability manifest rejected: {error}"));
    }
}
