//! LLP 0162/0163 proof composition at the served HTTP boundary.
//!
//! The storage corpus proves the fact evaluator and capability projector in
//! isolation. This test binds those pieces to production route registration,
//! a real generated owned-CRUD artifact, finite-range mutation transport, and
//! both public and administrative explanation transports.

fn test_app_state_from_snapback(
    snapback: snapback::local::LocalSnapback,
    context: snapback::admin::ServerContext,
) -> snapback::admin::AppState {
    snapback::admin::AppState::try_from_snapback(snapback, context).expect("test app state")
}

use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use snapback::admin::{ServerContext, ServerProfile};
use snapback::auth::mode::DeploymentIdentity;
use snapback::commit_envelope::{
    ExplanationDispositionV1, OperationCoverageActivationResponseV1, OperationExplanationRequestV1,
    OperationExplanationResponseV1, OperationIdentityRangeRequestV1,
    OperationIdentityRangeResponseV1, OperationIdentityV1, OperationIssuanceV1,
};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AgentSafeAggregateStateV1, AgentSafeEnvelopeCoverageV1, AgentSafeExplanationProfileV1,
    ArtifactGeneration, AuthInput, AuthMode, FunctionManifest, FunctionRuntime, HandlerInput,
    HandlerPlan, HistoryRetentionManifestV1, MutationSettlement, OwnerWriteAbsentDispositionV1,
    OwnerWriteCheckV1, SNAPBACK_SCHEMA_VERSION, SchemaManifest, TableVisibilityV1,
    TargetCapabilityId,
};
use snapback::operation_ledger::ORDINARY_MUTATION_LANE_V1;
use snapback::server::{SnapbackApp, app};
use snapback_kernel::storage::ClientMutationIdentity;
use snapback_server::test_support::axum::body::{Body, to_bytes};
use snapback_server::test_support::axum::http::{Method, Request, StatusCode, header};
use tower::ServiceExt;

const ADMIN_TOKEN: &str = "agent-safe-router-admin";
const OWNER: &str = "agent-safe-router-owner";
const CLIENT_AUDIENCE_ID: &str = "agent-safe-router-store";

fn generated_owned_crud_fixture() -> (SchemaManifest, FunctionManifest) {
    let mut schema: SchemaManifest = serde_json::from_str(include_str!(
        "../../../demos/competitive-checkpoint/acceptance/hosted-edge/app/generated/schema.manifest.json"
    ))
    .expect("generated owned-CRUD schema fixture");
    let mut functions: FunctionManifest = serde_json::from_str(include_str!(
        "../../../demos/competitive-checkpoint/acceptance/hosted-edge/app/generated/functions.manifest.json"
    ))
    .expect("generated owned-CRUD function fixture");

    // The checked-in fixture was generated for the sessions artifact grammar.
    // This integration test exercises the dev body-auth transport, so retain
    // the generated schema and exact HostPlan function bodies while assigning
    // them a coherent v0 deployment identity.
    schema.schema_version = SNAPBACK_SCHEMA_VERSION.to_owned();
    schema.auth = None;
    schema
        .required_capabilities
        .retain(|capability| capability != "auth.sessions.v1");
    let notes = schema
        .tables
        .iter_mut()
        .find(|table| table.name == "notes")
        .expect("generated notes table");
    notes.visibility = Some(TableVisibilityV1::Owner {
        field: "ownerId".to_owned(),
    });
    notes.history = Some(HistoryRetentionManifestV1 {
        retain_ms: 60_000,
        max_versions_per_record: 32,
    });
    schema.schema_hash = Some(format!("sha256:{}", "1".repeat(64)));
    schema.inputs_hash = Some("2".repeat(64));
    functions.schema_version = SNAPBACK_SCHEMA_VERSION.to_owned();
    functions.bundle_hash = Some(format!("sha256:{}", "3".repeat(64)));
    functions.inputs_hash = schema.inputs_hash.clone();
    functions
        .functions
        .retain(|function| matches!(function.name.as_str(), "createNote" | "updateNote"));
    let update = functions
        .functions
        .iter_mut()
        .find(|function| function.name == "updateNote")
        .expect("generated updateNote function");
    let FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan)) = &mut update.runtime else {
        panic!("generated updateNote stays a HostPlan mutation");
    };
    plan.owner_write_checks = vec![OwnerWriteCheckV1 {
        step_index: 2,
        // The generated Get/Guard pair below retains its stable identical-
        // absent refusal. This sealed preflight only prevents the Patch from
        // ever observing or mutating a foreign owner row.
        absent: OwnerWriteAbsentDispositionV1::NoEffect,
    }];
    (schema, functions)
}

fn loopback_dev_context() -> ServerContext {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback test server");
    let mut context = ServerContext::from_bound_listener(&listener).expect("derive server context");
    context.profile = ServerProfile::Dev;
    context.admin_token = Some(ADMIN_TOKEN.to_owned());
    context
}

async fn send_json(
    router: &SnapbackApp,
    method: Method,
    uri: &str,
    body: Option<Value>,
    admin: bool,
) -> (StatusCode, Vec<u8>) {
    let mut builder = Request::builder().method(method).uri(uri);
    let body = if let Some(body) = body {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
        Body::from(serde_json::to_vec(&body).expect("serialize request JSON"))
    } else {
        Body::empty()
    };
    if admin {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {ADMIN_TOKEN}"));
    }
    let response = router
        .clone()
        .oneshot(builder.body(body).expect("build HTTP request"))
        .await
        .expect("router response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .expect("read HTTP response")
        .to_vec();
    (status, bytes)
}

async fn successful_json<T: DeserializeOwned>(
    router: &SnapbackApp,
    method: Method,
    uri: &str,
    body: Option<Value>,
    admin: bool,
) -> T {
    let (status, bytes) = send_json(router, method, uri, body, admin).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "{uri} failed: {}",
        String::from_utf8_lossy(&bytes)
    );
    serde_json::from_slice(&bytes).unwrap_or_else(|error| {
        panic!(
            "decode {uri} response: {error}; body={}",
            String::from_utf8_lossy(&bytes)
        )
    })
}

fn raw_dev_auth() -> AuthInput {
    AuthInput {
        user_id: Some(OWNER.to_owned()),
        ..AuthInput::default()
    }
}

fn canonical_dev_input(args: Value) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            user_id: Some(OWNER.to_owned()),
            authorization_kind: Some("human".to_owned()),
            ..AuthInput::default()
        },
        ..HandlerInput::default()
    }
}

fn client_issuance(
    range: &snapback::commit_envelope::ClientIdentityRangeV1,
    counter: u64,
) -> OperationIssuanceV1 {
    assert!(counter >= range.range_start && counter < range.range_end_exclusive);
    OperationIssuanceV1::ClientRange {
        epoch_id: range.epoch_id.clone(),
        counter,
        range_start: range.range_start,
        range_end_exclusive: range.range_end_exclusive,
        authority_authenticator_digest: range.authority_authenticator_digest.clone(),
    }
}

fn operation_identity(
    stream_id: &str,
    range: &snapback::commit_envelope::ClientIdentityRangeV1,
    generation: &ArtifactGeneration,
    operation_id: &str,
    function: &str,
    args: Value,
    issuance: OperationIssuanceV1,
) -> OperationIdentityV1 {
    let identity = ClientMutationIdentity::for_authority_with_settlement(
        operation_id,
        function,
        &canonical_dev_input(args),
        range.authority_instance_id.clone(),
        &MutationSettlement::default(),
    )
    .with_artifact_generation(generation)
    .with_operation_issuance(issuance.clone());
    OperationIdentityV1::from_client_mutation(
        stream_id,
        range.audience.clone(),
        issuance,
        &identity,
        ORDINARY_MUTATION_LANE_V1,
    )
}

async fn public_explanation(
    router: &SnapbackApp,
    identity: OperationIdentityV1,
) -> OperationExplanationResponseV1 {
    successful_json(
        router,
        Method::POST,
        "/operations/explain",
        Some(
            serde_json::to_value(OperationExplanationRequestV1 {
                schema_version: 1,
                auth: raw_dev_auth(),
                client_audience_id: Some(CLIENT_AUDIENCE_ID.to_owned()),
                identity,
                authority_descriptor: None,
            })
            .expect("public explanation request"),
        ),
        false,
    )
    .await
}

async fn admin_explanation(
    router: &SnapbackApp,
    identity: OperationIdentityV1,
) -> OperationExplanationResponseV1 {
    successful_json(
        router,
        Method::POST,
        "/_snapback/api/operations/explain",
        Some(
            serde_json::to_value(OperationExplanationRequestV1 {
                schema_version: 1,
                auth: AuthInput::default(),
                client_audience_id: None,
                identity,
                authority_descriptor: None,
            })
            .expect("admin explanation request"),
        ),
        true,
    )
    .await
}

#[tokio::test]
async fn generated_owner_mutations_compose_public_admin_explanation_and_app_effective_projection() {
    let (schema, functions) = generated_owned_crud_fixture();
    let deployment = DeploymentIdentity::from_manifests(AuthMode::Dev, &schema, &functions)
        .expect("coherent generated dev deployment");
    let generation = ArtifactGeneration {
        schema_version: deployment.schema_version,
        app_id: deployment.app_id,
        schema_hash: deployment.schema_hash,
        bundle_hash: deployment.bundle_hash,
        inputs_hash: deployment.inputs_hash,
    };
    let mut snapback = LocalSnapback::memory().expect("memory router fixture");
    snapback
        .apply_schema(schema)
        .expect("apply generated owned-CRUD schema");
    snapback.load_functions(functions);
    let router = app(test_app_state_from_snapback(
        snapback,
        loopback_dev_context(),
    ));

    let activation: OperationCoverageActivationResponseV1 = successful_json(
        &router,
        Method::POST,
        "/_snapback/api/storage/operation-coverage/activate",
        Some(json!({
            "schemaVersion": 1,
            "targetProfileId": "local-dev-sqlite-ibex",
            "coverageProfile": "local-envelope-mapped-writers.v1",
        })),
        true,
    )
    .await;

    let range_response: OperationIdentityRangeResponseV1 = successful_json(
        &router,
        Method::POST,
        "/client-mutations/identity-range",
        Some(
            serde_json::to_value(OperationIdentityRangeRequestV1 {
                schema_version: 1,
                auth: raw_dev_auth(),
                client_audience_id: CLIENT_AUDIENCE_ID.to_owned(),
                authority_descriptor: None,
                previous_range: None,
            })
            .expect("range request"),
        ),
        false,
    )
    .await;
    let range = range_response.range;

    // @ref LLP 0162#acceptance — public mutation transport must reject both
    //   identity-without-retry-key and any attempt to occupy the host namespace.
    for (client_mutation_id, operation_issuance, expected_code) in [
        (
            None,
            client_issuance(&range, range.range_start),
            "SNAPBACK_OPERATION_IDENTITY_REQUIRES_CLIENT_MUTATION_ID",
        ),
        (
            Some("client-host-namespace-squat"),
            OperationIssuanceV1::HostIncarnation {
                epoch_id: "forged-host-epoch".to_owned(),
                upstream_identity: "forged-host-upstream".to_owned(),
                commit_ordinal: 0,
                authority_authenticator_digest: format!("sha256:{}", "f".repeat(64)),
            },
            "SNAPBACK_OPERATION_HOST_IDENTITY_FORBIDDEN",
        ),
    ] {
        let (status, bytes) = send_json(
            &router,
            Method::POST,
            "/mutation/createNote",
            Some(json!({
                "args": { "body": "must-not-run" },
                "auth": { "user_id": OWNER },
                "clientMutationId": client_mutation_id,
                "operationIssuance": operation_issuance,
            })),
            false,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{expected_code}");
        let refusal: Value = serde_json::from_slice(&bytes).unwrap_or_else(|error| {
            panic!(
                "decode {expected_code} response: {error}; body={}",
                String::from_utf8_lossy(&bytes)
            )
        });
        assert_eq!(refusal["diagnostic"]["code"], expected_code);
    }

    let create_id = "agent-safe-create-1";
    let create_args = json!({ "body": "created" });
    let create_issuance = client_issuance(&range, range.range_start);
    let create_response: Value = successful_json(
        &router,
        Method::POST,
        "/mutation/createNote",
        Some(json!({
            "args": create_args.clone(),
            "auth": { "user_id": OWNER },
            "clientMutationId": create_id,
            "operationIssuance": create_issuance,
        })),
        false,
    )
    .await;
    let note_id = create_response["result"]["_id"]
        .as_str()
        .expect("created note id")
        .to_owned();
    let create_identity = operation_identity(
        &activation.manifest.stream_id,
        &range,
        &generation,
        create_id,
        "createNote",
        create_args,
        client_issuance(&range, range.range_start),
    );

    let update_id = "agent-safe-update-1";
    let update_args = json!({ "id": note_id, "body": "updated" });
    let update_counter = range.range_start + 1;
    let update_response: Value = successful_json(
        &router,
        Method::POST,
        "/mutation/updateNote",
        Some(json!({
            "args": update_args.clone(),
            "auth": { "user_id": OWNER },
            "clientMutationId": update_id,
            "operationIssuance": client_issuance(&range, update_counter),
        })),
        false,
    )
    .await;
    assert_eq!(update_response["result"]["body"], "updated");
    let update_identity = operation_identity(
        &activation.manifest.stream_id,
        &range,
        &generation,
        update_id,
        "updateNote",
        update_args,
        client_issuance(&range, update_counter),
    );

    let public_create = public_explanation(&router, create_identity.clone()).await;
    let public_update = public_explanation(&router, update_identity.clone()).await;
    for (function, response) in [
        ("createNote", &public_create),
        ("updateNote", &public_update),
    ] {
        let explanation = response
            .explanation
            .as_ref()
            .unwrap_or_else(|| panic!("public explanation missing for {function}"));
        assert_eq!(explanation.disposition, ExplanationDispositionV1::Complete);
        assert_eq!(explanation.function_or_command.as_deref(), Some(function));
        assert!(explanation.detail.is_some());
    }
    let public_create_json =
        serde_json::to_value(&public_create).expect("serialize public create explanation");
    assert!(
        public_create_json["explanation"]["detail"]["receipt"]
            .get("_settlementMintObservations")
            .is_none(),
        "the private mint-site ledger must not cross public explanation transport"
    );
    assert!(
        !public_create_json
            .to_string()
            .contains("plan/steps/0/insert/row-id")
    );

    // A foreign bound identity and a wholly absent key have the same closed
    // public posture. The transport echoes only the caller-supplied key and
    // never exposes whether a retained operation occupied it.
    let mut foreign_existing = update_identity.clone();
    foreign_existing.bound_facts.principal_fingerprint = "foreign-principal".to_owned();
    foreign_existing.bound_facts.authority_instance_id = "foreign-authority".to_owned();
    let mut foreign_missing = foreign_existing.clone();
    foreign_missing.key.operation_id = "agent-safe-foreign-missing".to_owned();
    for (expected_key, response) in [
        (
            foreign_existing.key.clone(),
            public_explanation(&router, foreign_existing).await,
        ),
        (
            foreign_missing.key.clone(),
            public_explanation(&router, foreign_missing).await,
        ),
    ] {
        let explanation = response
            .explanation
            .expect("public foreign lookup returns one closed disposition");
        assert_eq!(explanation.key, expected_key);
        assert_eq!(
            explanation.disposition,
            ExplanationDispositionV1::AuthorizationUnprovable
        );
        assert_eq!(explanation.operation_kind, None);
        assert_eq!(explanation.function_or_command, None);
        assert_eq!(explanation.principal_fingerprint, None);
        assert_eq!(explanation.principal_session_or_invocation_id, None);
        assert_eq!(explanation.snapshot, None);
        assert_eq!(explanation.read_set_digest, None);
        assert_eq!(explanation.write_set_digest, None);
        assert_eq!(explanation.detail, None);
    }

    let admin_create = admin_explanation(&router, create_identity).await;
    let admin_update = admin_explanation(&router, update_identity).await;
    for (function, response) in [("createNote", &admin_create), ("updateNote", &admin_update)] {
        let explanation = response
            .explanation
            .as_ref()
            .unwrap_or_else(|| panic!("admin explanation missing for {function}"));
        assert_eq!(explanation.disposition, ExplanationDispositionV1::Complete);
        assert_eq!(explanation.function_or_command.as_deref(), Some(function));
    }
    let admin_create_json =
        serde_json::to_value(&admin_create).expect("serialize admin create explanation");
    assert_eq!(
        admin_create_json["explanation"]["detail"]["receipt"]["_settlementMintObservations"][0]["site"],
        "plan/steps/0/insert/row-id",
        "administrative transport retains the complete protected receipt"
    );

    let inspect: Value = successful_json(&router, Method::GET, "/inspect", None, false).await;
    let manifest: snapback::manifest::CapabilityManifest =
        serde_json::from_value(inspect["capabilityManifest"].clone())
            .expect("decode served capability manifest");
    let storage_published = manifest
        .supported_capabilities
        .contains(&TargetCapabilityId::AgentSafeStorageV1);
    let effective = &manifest.agent_safe.app_effective;
    if storage_published {
        assert_eq!(
            effective.envelope.ordinary_mutation.host_plan,
            AgentSafeEnvelopeCoverageV1::Covered
        );
        assert_eq!(
            effective.envelope.ordinary_mutation.ibex_buffered,
            AgentSafeEnvelopeCoverageV1::Missing
        );
        assert_eq!(
            effective.envelope.host_child_mutation.host_plan,
            AgentSafeEnvelopeCoverageV1::Missing
        );
        assert_eq!(
            effective.envelope.host_child_mutation.ibex_buffered,
            AgentSafeEnvelopeCoverageV1::Missing
        );
        assert_eq!(
            effective
                .explanation
                .scoped_facts
                .iter()
                .map(|fact| fact.scope.profile)
                .collect::<Vec<_>>(),
            vec![
                AgentSafeExplanationProfileV1::GeneratedOwnedCrudOwnerCreateV1,
                AgentSafeExplanationProfileV1::GeneratedOwnedCrudOwnerUpdateV1,
            ]
        );
    } else {
        assert!(
            manifest
                .capability_gaps
                .iter()
                .any(|gap| gap == "agent_safe_storage_v1"),
            "a provenance-withheld build must retain the explicit storage GAP"
        );
        assert_eq!(
            effective.envelope.ordinary_mutation.host_plan,
            AgentSafeEnvelopeCoverageV1::Missing
        );
        assert!(effective.explanation.scoped_facts.is_empty());
    }
    assert_eq!(effective.aggregate.core, AgentSafeAggregateStateV1::Missing);
    assert_eq!(
        effective.aggregate.history,
        AgentSafeAggregateStateV1::Missing
    );
}
