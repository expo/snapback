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

use snapback::cron::{CronInspectState, CronRunOutcome, CronRunRecord, CronRunTrigger};
use snapback::data_tier::{
    DATA_TIER_CORPUS_FORMAT_VERSION, DATA_TIER_CORPUS_NAME, DATA_TIER_PROFILE_FILE,
    DataTierCaseExpectation, DataTierCaseSchema, DataTierCorpusCase, DataTierCorpusCaseEntry,
    DataTierCorpusManifest, DataTierProfile,
};
use snapback::diagnostic::Diagnostic;
use snapback::ephemeral::{EphemeralDiagnostics, EphemeralRoomDiagnostics, Scope};
use snapback::local::{
    InspectState, LiveDeliveryStats, LiveResumeInput, LiveSubscribeInput, LiveUnsubscribeInput,
    PublicInspect,
};
use snapback::manifest::{
    AuthInput, CLIENT_MUTATION_ACK_MAX_IDS, CTX_ANSWER_LEDGER_MAX_IDS, CapabilityManifest,
    ConfigEntryDefinition, CronJobDefinition, CronSchedule, FunctionManifest, HandlerInput,
    MutationAcknowledgementRequest, MutationAcknowledgementResponse, MutationPlan, MutationRequest,
    REPLAY_OPAQUE_ID_MAX_BYTES, REPLAY_OPAQUE_ID_PATTERN, SNAPBACK_SCHEMA_VERSION, SchemaManifest,
    SourceSpan, TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX,
};
use snapback::runtime::{
    CapabilityState, IbexCliCapability, IbexSubmoduleCapability, RuntimeCapabilities,
};
use snapback::schema_export::{SchemaArtifact, artifact_instances, artifact_schemas};
use snapback::storage::{ClientMutationRetentionInfo, StorageInfo};

fn retention_info() -> ClientMutationRetentionInfo {
    ClientMutationRetentionInfo {
        records: 2,
        bytes: 512,
        gc_total: 3,
        max_records: 10_000,
        max_bytes: 67_108_864,
        max_result_bytes: 65_536,
    }
}

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
    let acknowledged_ids = &schema["properties"]["acknowledgedClientMutationIds"];
    let ledger_ids = &schema["$defs"]["CtxAnswerLedger"]["properties"]["ids"];

    assert_eq!(client_id["minLength"], json!(1));
    assert_eq!(client_id["maxLength"], json!(REPLAY_OPAQUE_ID_MAX_BYTES));
    assert_eq!(client_id["pattern"], json!(REPLAY_OPAQUE_ID_PATTERN));
    assert_eq!(
        acknowledged_ids["maxItems"],
        json!(CLIENT_MUTATION_ACK_MAX_IDS)
    );
    assert_eq!(acknowledged_ids["items"]["minLength"], json!(1));
    assert_eq!(
        acknowledged_ids["items"]["maxLength"],
        json!(REPLAY_OPAQUE_ID_MAX_BYTES)
    );
    assert_eq!(
        acknowledged_ids["items"]["pattern"],
        json!(REPLAY_OPAQUE_ID_PATTERN)
    );
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
        acknowledged_client_mutation_ids: Vec::new(),
    })
    .unwrap();
    for invalid in [String::new(), "bad/id".to_owned(), "x".repeat(257)] {
        let mut request = base.clone();
        request["clientMutationId"] = json!(invalid);
        assert_rejects("mutation.input.schema.json", &request);
    }
    for invalid in [String::new(), "bad/id".to_owned(), "x".repeat(257)] {
        let mut request = base.clone();
        request["acknowledgedClientMutationIds"] = json!([invalid.clone()]);
        assert_rejects("mutation.input.schema.json", &request);

        let standalone = json!({
            "auth": {},
            "clientMutationIds": [invalid],
        });
        assert_rejects("client-mutation.ack.input.schema.json", &standalone);
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

/// @ref LLP 0054#routes-operations-and-dtos — provider and operator objects are closed wire contracts. Keep a
/// consumer-side fixture for every schema, not only the Rust schemars drift
/// check, so camelCase or `additionalProperties` drift is caught here too.
/// @ref LLP 0055#exact-response-dto — bootstrap discovery is an independently
/// closed, generated response rather than an ad hoc server object.
#[test]
fn auth_v1_wire_schemas_accept_exact_objects_and_reject_extensions() {
    let cases = [
        (
            "auth.request-code.input.schema.json",
            json!({ "email": "person@example.com" }),
        ),
        (
            "auth.request-code.output.schema.json",
            json!({ "challengeId": "sbc_AAAAAAAAAAAAAAAAAAAAAA", "expiresAt": 10 }),
        ),
        (
            "auth.session.output.schema.json",
            json!({
                "protocolVersion": 1,
                "serverStartupNonce": "startup-1",
                "authorizationStreamIncarnation": "01890f3c-9d5b-7000-8000-000000000001",
                "transitionGeneration": 0,
                "activeMode": "dev",
                "desiredMode": "dev",
                "modeState": "settled",
                "appDataAvailability": "available",
                "quarantineCode": null,
                "clientProtocols": {
                    "authClient": 1,
                    "authInvalidation": null,
                    "authorityDescriptor": null,
                    "authorizedLease": null
                },
                "availability": {
                    "onlineRequestResponse": { "available": true, "reason": null },
                    "authScopedLive": {
                        "available": true,
                        "minimumAuthInvalidationProtocol": null,
                        "reason": null
                    },
                    "retainedReads": {
                        "available": true,
                        "minimumAuthInvalidationProtocol": null,
                        "minimumAuthorizedLeaseProtocol": null,
                        "reason": null
                    },
                    "queuedReplay": {
                        "available": true,
                        "minimumAuthorityDescriptorProtocol": null,
                        "reason": null
                    }
                },
                "provider": { "key": "email-code", "available": false },
                "transports": ["bearer"],
                "authority": {
                    "userId": null,
                    "sessionId": null,
                    "isAuthenticated": false
                }
            }),
        ),
        (
            "auth.exchange.input.schema.json",
            json!({ "challengeId": "sbc_AAAAAAAAAAAAAAAAAAAAAA", "code": "012345" }),
        ),
        (
            "auth.credential.output.schema.json",
            json!({
                "tokenType": "Bearer",
                "token": "sbs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.190a55ad",
                "refreshAfter": 7,
                "session": {
                    "id": "019b0000-0000-7000-8000-000000000001",
                    "userId": "019b0000-0000-7000-8000-000000000002",
                    "provider": "email-code",
                    "createdAt": 1,
                    "expiresAt": 2,
                    "absoluteExpiresAt": 3
                }
            }),
        ),
        ("auth.empty.input.schema.json", json!({})),
        (
            "auth.family-alarm.output.schema.json",
            json!({ "accepted": true }),
        ),
        (
            "auth.mailbox.query.schema.json",
            json!({ "challengeId": "sbc_AAAAAAAAAAAAAAAAAAAAAA" }),
        ),
        (
            "auth.mailbox.output.schema.json",
            json!({
                "challengeId": "sbc_AAAAAAAAAAAAAAAAAAAAAA",
                "canonicalAddress": "person@example.com",
                "code": "012345",
                "expiresAt": 10
            }),
        ),
        (
            "auth.mint-session.input.schema.json",
            json!({ "email": "person@example.com" }),
        ),
        (
            "auth.rescue-colliding-table.input.schema.json",
            json!({ "sourceTable": "_auth_users", "targetTable": "legacy_auth_users" }),
        ),
    ];
    for (file, exact) in cases {
        assert_validates(file, &exact);
        let mut extended = exact;
        extended
            .as_object_mut()
            .expect("auth wire fixture is an object")
            .insert("unexpected".to_owned(), json!(true));
        assert_rejects(file, &extended);
    }

    use snapback::auth::wire::{
        EmptyAuthRequest, ExchangeRequest, MailboxQuery, MintSessionRequest, RequestCodeRequest,
        RescueCollidingTableRequest,
    };
    assert!(
        serde_json::from_str::<RequestCodeRequest>(r#"{"email":"a@b","email":"duplicate@b"}"#)
            .is_err()
    );
    assert!(
        serde_json::from_str::<ExchangeRequest>(
            r#"{"challengeId":"sbc_x","challengeId":"sbc_y","code":"012345"}"#
        )
        .is_err()
    );
    assert!(serde_json::from_str::<EmptyAuthRequest>(r#"{"x":1,"x":2}"#).is_err());
    assert!(
        serde_json::from_str::<MailboxQuery>(r#"{"challengeId":"sbc_x","challengeId":"sbc_y"}"#)
            .is_err()
    );
    assert!(
        serde_json::from_str::<MintSessionRequest>(r#"{"email":"a@b","email":"duplicate@b"}"#)
            .is_err()
    );
    assert!(
        serde_json::from_str::<RescueCollidingTableRequest>(
            r#"{"sourceTable":"_auth_users","targetTable":"legacy","targetTable":"other"}"#
        )
        .is_err()
    );
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
            client_mutation_retention: retention_info(),
        },
        runtime: RuntimeCapabilities {
            canonical_engine: "ibex".to_owned(),
            ibex_submodule: IbexSubmoduleCapability {
                present: true,
                path: Some(PathBuf::from("/secret/runtime/ibex-submodule")),
            },
            ibex_cli: IbexCliCapability {
                available: false,
                path: Some(PathBuf::from("/secret/runtime/ibex-cli")),
                version: None,
            },
            host_plan_runtime: true,
            ibex_ctx_db_host_bridge: CapabilityState::Available,
            async_handler_completion: CapabilityState::Available,
            sqlite_lock_held_across_async: CapabilityState::NotYetWired,
            mutation_dry_run: true,
        },
        schema: SchemaManifest {
            artifact_diagnostics: vec![
                Diagnostic::warning(
                    "SNAPBACK_SECRET_SCHEMA_ARTIFACT",
                    "schema",
                    "schema artifact diagnostic secret text",
                )
                .with_details(json!({ "sourcePath": "/secret/schema/artifact.ts" })),
            ],
            ..SchemaManifest::default()
        },
        functions: FunctionManifest {
            unsupported_dependency_diagnostics: vec![
                Diagnostic::error(
                    "SNAPBACK_SECRET_DEPENDENCY",
                    "codegen",
                    "raw diagnostic secret text",
                )
                .with_details(json!({ "sourcePath": "/secret/diagnostic/details.ts" })),
            ],
            cron_jobs: vec![CronJobDefinition {
                name: "publicCron".to_owned(),
                schedule: CronSchedule {
                    every_ms: Some(1_000),
                    cron: None,
                },
                action: "runPublicCron".to_owned(),
                enabled: true,
                activation: Default::default(),
                jitter_policy: Default::default(),
                overlap_policy: Default::default(),
                retry_policy: Default::default(),
                required_capabilities: vec![],
                target_wakeup: None,
                source_span: Some(SourceSpan {
                    file: "/secret/source/cron.ts".to_owned(),
                    line: 1,
                    column: 1,
                }),
            }],
            config: vec![ConfigEntryDefinition {
                name: "PUBLIC_CONFIG_DECLARATION".to_owned(),
                description: None,
                purpose: None,
                secret: true,
                required: false,
                pool: false,
                probe: None,
                how_to_get: None,
                acquisition: None,
                default: None,
                source_span: Some(SourceSpan {
                    file: "/secret/source/config.ts".to_owned(),
                    line: 2,
                    column: 3,
                }),
            }],
            ..FunctionManifest::default()
        },
        capability_manifest: CapabilityManifest::local_v0(vec!["postgres".to_owned()]),
        subscriptions: vec![],
        active_connections: 0,
        reaped_connections: 0,
        live_delivery: LiveDeliveryStats::default(),
        ephemeral: EphemeralDiagnostics {
            room_count: 1,
            entry_count: 1,
            subscriber_count: 1,
            value_bytes: 12,
            active_rooms: vec![EphemeralRoomDiagnostics {
                collection: "secretCursors".to_owned(),
                routing_key: "secret-routing-key".to_owned(),
                scope: Scope::from_pairs([("secretTenantId", "tenant-secret")]),
                scope_epoch: 9,
                entries: 1,
                subscribers: 1,
                value_bytes: 12,
                retained_bytes: 256,
            }],
            ..EphemeralDiagnostics::default()
        },
        cron: CronInspectState {
            artifact_kind: "cronInspectState".to_owned(),
            schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
            jobs: vec![],
            recent_runs: vec![CronRunRecord {
                run_id: "run-public-shape".to_owned(),
                job_name: "publicCron".to_owned(),
                scheduled_at_ms: Some(1),
                due_at_ms: 2,
                started_at_ms: 3,
                finished_at_ms: Some(4),
                trigger: CronRunTrigger::Scheduled,
                attempt: 1,
                outcome: CronRunOutcome::Failed,
                duration_ms: Some(1),
                idempotency_key: "public-idempotency-shape".to_owned(),
                slot_key: "public-slot-shape".to_owned(),
                diagnostic: Some(
                    Diagnostic::error(
                        "SNAPBACK_SECRET_CRON_RUN",
                        "cron",
                        "cron run diagnostic secret text",
                    )
                    .with_details(json!({ "sourcePath": "/secret/cron/run.ts" })),
                ),
                result: Some(json!({ "applicationSecret": "cron result secret value" })),
            }],
            diagnostics: vec![
                Diagnostic::warning(
                    "SNAPBACK_SECRET_CRON_STATE",
                    "cron",
                    "cron state diagnostic secret text",
                )
                .with_details(json!({ "sourcePath": "/secret/cron/state.ts" })),
            ],
        },
        recent_diagnostics: vec![
            Diagnostic::info("SNAPBACK_READY", "server", "recent diagnostic secret text")
                .with_details(json!({ "path": "/secret/recent/details.ts" })),
        ],
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
            client_mutation_retention: retention_info(),
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

#[test]
fn public_inspect_projection_drops_handler_controlled_diagnostic_text() {
    const SECRET_SENTINEL: &str = "configured-secret-must-not-be-public";
    let mut inspect = representative_inspect();
    inspect.recent_diagnostics.push(
        Diagnostic::error("SNAPBACK_HANDLER_FAILED", "runtime", SECRET_SENTINEL)
            .with_details(json!({ "vendorBody": SECRET_SENTINEL })),
    );
    inspect.cron.diagnostics.push(
        Diagnostic::error("SNAPBACK_CRON_FAILED", "cron", SECRET_SENTINEL)
            .with_details(json!({ "reason": SECRET_SENTINEL })),
    );
    assert!(
        serde_json::to_string(&inspect)
            .unwrap()
            .contains(SECRET_SENTINEL),
        "fixture must prove the gated source contains the sentinel"
    );
    let public = serde_json::to_string(&PublicInspect::from(inspect)).unwrap();
    assert!(!public.contains(SECRET_SENTINEL), "{public}");
    assert!(
        public.contains("SNAPBACK_HANDLER_FAILED"),
        "codes remain useful"
    );
}

#[test]
fn public_inspect_drops_private_storage_and_ephemeral_room_facts() {
    let public = serde_json::to_value(PublicInspect::from(representative_inspect())).unwrap();
    assert!(public.pointer("/storage/clientMutationRetention").is_none());
    assert!(public.pointer("/ephemeral/activeRooms").is_none());
    assert!(public.pointer("/runtime/ibexSubmodule/path").is_none());
    assert!(public.pointer("/runtime/ibexCli/path").is_none());
    assert!(public.pointer("/functions/cronJobs/0/sourceSpan").is_none());
    assert!(public.pointer("/functions/config/0/sourceSpan").is_none());
    assert!(
        public
            .pointer("/functions/unsupportedDependencyDiagnostics/0/message")
            .is_none()
    );
    assert!(
        public
            .pointer("/functions/unsupportedDependencyDiagnostics/0/details")
            .is_none()
    );
    assert!(public.pointer("/recentDiagnostics/0/message").is_none());
    assert!(public.pointer("/recentDiagnostics/0/details").is_none());
    assert!(
        public
            .pointer("/schema/artifactDiagnostics/0/message")
            .is_none()
    );
    assert!(
        public
            .pointer("/schema/artifactDiagnostics/0/details")
            .is_none()
    );
    assert!(public.pointer("/cron/jobs").is_none());
    assert!(public.pointer("/cron/recentRuns").is_none());
    assert!(public.pointer("/cron/diagnostics").is_none());
    assert_eq!(public.pointer("/cron/jobCount"), Some(&json!(0)));
    assert_eq!(public.pointer("/cron/failedJobCount"), Some(&json!(0)));
    assert_eq!(public.pointer("/cron/inFlightJobCount"), Some(&json!(0)));
    assert_eq!(
        public["functions"]["unsupportedDependencyDiagnostics"][0]["code"],
        "SNAPBACK_SECRET_DEPENDENCY"
    );

    let encoded = serde_json::to_string(&public).unwrap();
    for secret in [
        "secretCursors",
        "secret-routing-key",
        "secretTenantId",
        "tenant-secret",
        "/secret/runtime/ibex-submodule",
        "/secret/runtime/ibex-cli",
        "/secret/source/cron.ts",
        "/secret/source/config.ts",
        "raw diagnostic secret text",
        "/secret/diagnostic/details.ts",
        "recent diagnostic secret text",
        "/secret/recent/details.ts",
        "schema artifact diagnostic secret text",
        "/secret/schema/artifact.ts",
        "cron state diagnostic secret text",
        "/secret/cron/state.ts",
        "cron run diagnostic secret text",
        "/secret/cron/run.ts",
        "cron result secret value",
    ] {
        assert!(
            !encoded.contains(secret),
            "public inspect leaked ephemeral room sentinel {secret}"
        );
    }
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
                room_authority_generation: 0,
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
            room_authority_generation: 0,
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
            authorization_invalidation: None,
        })
        .unwrap(),
    );
    let open_request = serde_json::to_value(OpenConnectionRequest {
        connection_id: Some("conn_1".to_owned()),
        previous_token: Some("sct_prior_bearer".to_owned()),
        auth_invalidation_protocol: None,
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
            authorization_scope: None,
            authorization_invalidation: None,
            scope_retirements: Vec::new(),
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
            acknowledged_client_mutation_ids: vec!["cm_acknowledged".to_owned()],
        })
        .unwrap(),
    );
    assert_validates(
        "client-mutation.ack.input.schema.json",
        &serde_json::to_value(MutationAcknowledgementRequest {
            auth: input.auth.clone(),
            client_mutation_ids: vec!["cm_acknowledged".to_owned()],
        })
        .unwrap(),
    );
    assert_validates(
        "client-mutation.ack.output.schema.json",
        &serde_json::to_value(MutationAcknowledgementResponse { acknowledged: 1 }).unwrap(),
    );
    assert_validates(
        "live.subscribe.input.schema.json",
        &serde_json::to_value(LiveSubscribeInput {
            connection_id: "conn_1".to_owned(),
            input: input.clone(),
            authorization_namespace: None,
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
            authorization_scope: None,
            authorization_invalidation: None,
            scope_retirements: Vec::new(),
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
            scope_retirement: None,
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
