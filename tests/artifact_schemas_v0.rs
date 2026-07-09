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
use std::fs;
use std::path::PathBuf;

use snapback::cron::CronInspectState;
use snapback::diagnostic::Diagnostic;
use snapback::ephemeral::EphemeralDiagnostics;
use snapback::local::{InspectState, LiveDeliveryStats, PublicInspect};
use snapback::manifest::{
    CapabilityManifest, FunctionManifest, SNAPBACK_SCHEMA_VERSION, SchemaManifest,
    TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX,
};
use snapback::runtime::{
    CapabilityState, IbexCliCapability, IbexSubmoduleCapability, RuntimeCapabilities,
};
use snapback::schema_export::{SchemaArtifact, artifact_schemas};
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
        "capability.manifest.schema.json",
        &serde_json::to_value(CapabilityManifest::local_v0(vec!["postgres".to_owned()])).unwrap(),
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
    use snapback::server::{ConnectionGrant, ErrorResponse};

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
    assert_validates(
        "error.response.schema.json",
        &serde_json::to_value(ErrorResponse {
            diagnostic: Diagnostic::error("SNAPBACK_TEST", "realtime", "boom"),
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
        "live.unsubscribe.output.schema.json",
        &serde_json::to_value(LiveUnsubscribeOutput {
            subscription_id: "sub_1".to_owned(),
            disposed: true,
            receipt: None,
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
