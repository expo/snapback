use super::fake_expo::{FakeExpo, FakeExpoStep};
use super::*;
use crate::auth::invocation::{
    InvocationGate, InvocationSource, PreparedAuthority, ResolvedAppAuthority, WireAuthorityFields,
};
use crate::contract_types::ServerProfile;
use crate::diagnostic::SnapbackError;
use crate::ids::{self, Kind};
use crate::manifest::{AuthMode, MembershipManifest, MembershipScope, TableManifest};
use crate::storage::{DbRead, LocalDatabase, ServingDatabase};
use serde_json::{Map, Value, json};
use snapback_kernel::push::test_support::PushAuthorizationTestFixture;
use std::collections::BTreeMap;

trait PreparedPushRegistryTestExt {
    #[allow(clippy::too_many_arguments)]
    fn reserve_send(
        &mut self,
        declaration: &PushSeamDeclarationV1,
        schema: &crate::manifest::SchemaManifest,
        authority: impl FnOnce() -> PreparedAuthority,
        trigger_mode: PushTriggerModeV1,
        deferred_grant: Option<&PushDeferredGrantV1>,
        request: &PushSendRequestV1,
        now_ms: u64,
    ) -> SnapbackResult<ReservedPushAttemptV1>;
}

impl PreparedPushRegistryTestExt for crate::local::LocalSnapback {
    fn reserve_send(
        &mut self,
        declaration: &PushSeamDeclarationV1,
        schema: &crate::manifest::SchemaManifest,
        authority: impl FnOnce() -> PreparedAuthority,
        trigger_mode: PushTriggerModeV1,
        deferred_grant: Option<&PushDeferredGrantV1>,
        request: &PushSendRequestV1,
        now_ms: u64,
    ) -> SnapbackResult<ReservedPushAttemptV1> {
        let authority = authority();
        self.reserve_push_send_with_schema_for_test(
            &authority,
            declaration,
            schema,
            trigger_mode,
            deferred_grant,
            request,
            now_ms,
        )
    }
}

fn authorize_send_for_prepared(
    fixture: &PushAuthorizationTestFixture,
    schema: &crate::manifest::SchemaManifest,
    audience: &PushAudienceDeclarationV1,
    authority: &PreparedAuthority,
    trigger_mode: PushTriggerModeV1,
    deferred_grant: Option<&PushDeferredGrantV1>,
    request: &PushSendRequestV1,
) -> SnapbackResult<()> {
    authority.validate_admission("push send authorization")?;
    if matches!(authority.resolved(), ResolvedAppAuthority::System) {
        fixture.authorize_system_send(schema, audience, trigger_mode, deferred_grant, request)
    } else if let Some(user_id) = authority.projection().user_id() {
        fixture.authorize_user_send(
            user_id,
            schema,
            audience,
            trigger_mode,
            deferred_grant,
            request,
        )
    } else {
        Err(SnapbackError::error(
            "SNAPBACK_AUTH_PERMISSION_DENIED",
            "auth",
            "the current authority cannot use this push audience",
        ))
    }
}

fn declaration(environment: &str, idle_retention_ms: u64) -> PushSeamDeclarationV1 {
    PushSeamDeclarationV1 {
        app_scope: PushAppScopeV1 {
            eas_project_id: "eas-fixture".into(),
            application_id: "com.example.fixture".into(),
            environment: environment.into(),
        },
        registry: PushRegistryDeclarationV1 { idle_retention_ms },
        audiences: BTreeMap::new(),
        uses: Vec::new(),
        ledger: None,
    }
}

fn send_declaration() -> PushSeamDeclarationV1 {
    let mut declaration = declaration("test", 86_400_000);
    declaration.audiences.insert(
        "guests".into(),
        PushAudienceDeclarationV1 {
            resolve: PushAudienceResolverV1::Membership {
                declaration: "event_members".into(),
                resource_arg: Some("eventId".into()),
                roles: vec!["guest".into()],
            },
            authorize: PushAudienceAuthorizeV1::System,
        },
    );
    declaration.ledger = Some(PushLedgerDeclarationV1 {
        retention_ms: 2_592_000_000,
    });
    declaration
}

fn system_ledger_declaration() -> PushSeamDeclarationV1 {
    let mut declaration = declaration("test", 86_400_000);
    declaration.audiences.insert(
        "selectedGuests".into(),
        PushAudienceDeclarationV1 {
            resolve: PushAudienceResolverV1::ExplicitPrincipals {
                principals_arg: "principalIds".into(),
                max_items: 10,
            },
            authorize: PushAudienceAuthorizeV1::System,
        },
    );
    declaration.ledger = Some(PushLedgerDeclarationV1 {
        retention_ms: 2_592_000_000,
    });
    declaration
}

fn app_membership_schema() -> crate::manifest::SchemaManifest {
    let mut schema = crate::manifest::SchemaManifest::default();
    schema.tables.push(TableManifest {
        name: "app_members".into(),
        fields: Vec::new(),
        indexes: Vec::new(),
        search_indexes: Vec::new(),
        vector_indexes: Vec::new(),
        search_live_limits: None,
        syncable: true,
        permission_backing: false,
        permission_fields: None,
        membership: Some(MembershipManifest {
            id: Some("app_members".into()),
            principal: "principal".into(),
            resource: None,
            role: "role".into(),
            roles: vec!["sender".into()],
            pending_roles: None,
            bootstrap_role: None,
            last_holder: None,
            expiry: None,
            incidental: None,
            provenance: None,
            transitions: Vec::new(),
            principal_addressed_writes: None,
            scope: MembershipScope::App,
            resource_table: None,
        }),
        authority_profile: None,
        asset_sharing: None,
        visibility: None,
        history: None,
    });
    schema
}

fn push_acceptance_schema(declaration: PushSeamDeclarationV1) -> crate::manifest::SchemaManifest {
    let mut schema = crate::manifest::SchemaManifest {
        push_seam: Some(declaration),
        ..Default::default()
    };
    for (table_name, declaration_id, roles) in [
        ("event_members", "event_members", vec!["guest".to_owned()]),
        ("event_senders", "event_senders", vec!["sender".to_owned()]),
    ] {
        schema.tables.push(TableManifest {
            name: table_name.into(),
            fields: Vec::new(),
            indexes: Vec::new(),
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            membership: Some(MembershipManifest {
                id: Some(declaration_id.into()),
                principal: "principal".into(),
                resource: Some("event_id".into()),
                role: "role".into(),
                roles,
                pending_roles: None,
                bootstrap_role: None,
                last_holder: None,
                expiry: None,
                incidental: None,
                provenance: None,
                transitions: Vec::new(),
                principal_addressed_writes: None,
                scope: MembershipScope::Resource,
                resource_table: Some("events".into()),
            }),
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        });
    }
    schema
}

fn acceptance_request(audience: &str, event_id: &str, dedupe_key: &str) -> PushSendRequestV1 {
    PushSendRequestV1 {
        to: PushAudienceReferenceV1 {
            audience: audience.into(),
            args: Map::from_iter([("eventId".into(), Value::String(event_id.into()))]),
        },
        title: "Fixture title".into(),
        body: "Fixture body".into(),
        data: Some(Map::from_iter([("route".into(), json!("/fixture"))])),
        dedupe_key: dedupe_key.into(),
        redrive_ambiguous: false,
    }
}

fn session_authority(user_id: &str) -> crate::auth::invocation::PreparedAuthority {
    let mut snapback = crate::local::LocalSnapback::memory().expect("push authority fixture");
    snapback.prepare_resolved_session_for_test(
        InvocationSource::HttpAction,
        user_id,
        &ids::mint(Kind::Session).expect("session id"),
        &ids::mint(Kind::AuthorityInstance).expect("authority instance id"),
        1,
        4_000_000_000_000,
    )
}

fn system_authority() -> crate::auth::invocation::PreparedAuthority {
    let deployment = crate::auth::mode::DeploymentIdentity {
        schema_version: "snapback.v1".to_owned(),
        auth_mode: AuthMode::Sessions,
        app_id: "push-authority-fixture".to_owned(),
        schema_hash: format!("snapback.v1:sessions:schema:sha256:{}", "1".repeat(64)),
        bundle_hash: format!("snapback.v1:sessions:function:sha256:{}", "2".repeat(64)),
        inputs_hash: format!("snapback.v1:sessions:inputs:sha256:{}", "3".repeat(64)),
    };
    let mut mode = crate::auth::mode::AuthModeStateRecord::initial_dev(Some(deployment.clone()));
    mode.transition_generation = 1;
    mode.active = AuthMode::Sessions;
    mode.desired = AuthMode::Sessions;
    mode.sessions_ever_activated = true;
    mode.active_deployment = Some(deployment);
    mode.validate_shape().expect("settled sessions mode");
    let admission = crate::auth::admission::AdmissionController::from_mode_state(&mode)
        .expect("sessions admission controller")
        .admit_for_mode(AuthMode::Sessions)
        .expect("managed sessions admission");
    InvocationGate::prepare_admitted_subjectless_authority(
        InvocationSource::Cron,
        AuthMode::Sessions,
        ServerProfile::Test,
        admission,
        &WireAuthorityFields::default(),
        ResolvedAppAuthority::System,
        None,
    )
    .expect("prepared system authority")
}

#[test]
fn ledger_projection_is_authorized_and_never_releases_payload_or_token_bytes() {
    let mut db = LocalDatabase::memory().expect("database");
    db.push_registry()
        .activate_current_auth_catalog()
        .expect("auth catalog");
    let declaration = system_ledger_declaration();
    db.push_registry()
        .activate_push_registry_for_test(declaration.clone())
        .expect("push ledger");
    let intent_id = ids::mint_time_ordered(Kind::PushIntent);
    let batch_id = ids::mint_time_ordered(Kind::PushBatch);
    let message_id = ids::mint_time_ordered(Kind::PushMessage);
    let token_id = ids::mint_time_ordered(Kind::PushToken);
    let principal_id = ids::mint(Kind::User).expect("principal id");
    let audience_args = serde_json::to_string(&json!({
        "principalIds": [principal_id],
    }))
    .unwrap();
    db.push_registry()
        .seed_ledger_projection_for_test(
            &declaration,
            &intent_id,
            &batch_id,
            &message_id,
            &token_id,
            &audience_args,
        )
        .expect("ledger fixture");

    let system = system_authority();
    let db = ServingDatabase::adopt(db).expect("test database mints one serving owner");
    let (rows, dependency) = read_ledger_projection_for_prepared(
        &db,
        &DbRead::Live(&db),
        &declaration,
        db.schema(),
        &system,
        &intent_id,
    )
    .expect("system ledger read");
    assert!(dependency.is_none());
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].message_id.as_deref(), Some(message_id.as_str()));
    assert_eq!(rows[0].token_id.as_deref(), Some(token_id.as_str()));
    assert_eq!(rows[0].message_state.as_deref(), Some("handed-to-expo"));
    let wire = serde_json::to_string(&rows[0].to_row_value()).unwrap();
    assert!(!wire.contains("payload-secret"));
    assert!(!wire.contains("token-secret"));
    assert!(!wire.contains("dedupe-secret"));

    let user = session_authority(&principal_id);
    assert_eq!(
        read_ledger_projection_for_prepared(
            &db,
            &DbRead::Live(&db),
            &declaration,
            db.schema(),
            &user,
            &intent_id,
        )
        .expect_err("system audience is not session-readable")
        .diagnostic
        .code,
        "SNAPBACK_AUTH_PERMISSION_DENIED",
    );
}

#[test]
fn fake_expo_acceptance_covers_tickets_receipts_dedupe_ambiguity_and_authorization() {
    const SEND_PATH: &str = "/--/api/v2/push/send";
    const RECEIPT_PATH: &str = "/--/api/v2/push/getReceipts";
    const ACCESS_TOKEN: &str = "fixture-secret";

    let mut declaration = send_declaration();
    declaration.audiences.insert(
        "authorizedGuests".into(),
        PushAudienceDeclarationV1 {
            resolve: PushAudienceResolverV1::Membership {
                declaration: "event_members".into(),
                resource_arg: Some("eventId".into()),
                roles: vec!["guest".into()],
            },
            authorize: PushAudienceAuthorizeV1::Membership {
                declaration: "event_senders".into(),
                resource_arg: Some("eventId".into()),
                roles: vec!["sender".into()],
            },
        },
    );
    let schema = push_acceptance_schema(declaration.clone());
    let mut snapback = crate::local::LocalSnapback::memory().expect("database");
    snapback
        .auth_database_mut()
        .push_registry()
        .activate_current_auth_catalog()
        .expect("auth catalog");
    snapback
        .auth_database_mut()
        .push_registry()
        .activate_push_registry_for_test(declaration.clone())
        .expect("push ledger");

    let principal_ok = ids::mint(Kind::User).expect("ok principal");
    let principal_ticket_dnr = ids::mint(Kind::User).expect("ticket DNR principal");
    let principal_receipt_dnr = ids::mint(Kind::User).expect("receipt DNR principal");
    let (token_ok, token_ticket_dnr, token_receipt_dnr) = snapback
        .auth_database_mut()
        .push_registry()
        .seed_acceptance_audience_and_tokens_for_test(
            &declaration,
            &principal_ok,
            &principal_ticket_dnr,
            &principal_receipt_dnr,
        )
        .expect("acceptance audience and token custody");

    let request = acceptance_request("guests", "event-main", "acceptance-main");
    let attempt = snapback
        .reserve_send(
            &declaration,
            &schema,
            system_authority,
            PushTriggerModeV1::System,
            None,
            &request,
            100,
        )
        .expect("reserve fixture send");
    assert_eq!(attempt.response.target_count, 3);
    assert_eq!(attempt.response.batch_count, 1);
    let claim = snapback
        .auth_database_mut()
        .push_registry()
        .claim_batch(&attempt.batches[0].batch_id, 101)
        .expect("claim fixture batch")
        .expect("fixture batch exists");
    snapback
        .auth_database_mut()
        .push_registry()
        .mark_batch_transmitting(&claim, 102)
        .expect("durable fixture transmit cut");

    let tickets = claim
        .messages
        .iter()
        .map(|message| {
            if message.token_id == token_ok {
                json!({"status": "ok", "id": "ticket-ok"})
            } else if message.token_id == token_ticket_dnr {
                json!({
                    "status": "error",
                    "message": "secret-provider-prose-must-not-persist",
                    "details": {"error": "DeviceNotRegistered"}
                })
            } else {
                assert_eq!(message.token_id, token_receipt_dnr);
                json!({"status": "ok", "id": "ticket-receipt-dnr"})
            }
        })
        .collect::<Vec<_>>();
    let mut receipts = Map::new();
    receipts.insert("ticket-ok".into(), json!({"status": "ok"}));
    receipts.insert(
        "ticket-receipt-dnr".into(),
        json!({
            "status": "error",
            "message": "different-secret-provider-prose-must-not-persist",
            "details": {"error": "DeviceNotRegistered"}
        }),
    );
    let provider = FakeExpo::start(vec![
        FakeExpoStep::Json {
            path: SEND_PATH,
            status: 200,
            body: json!({"data": tickets}),
            bearer: Some(ACCESS_TOKEN),
        },
        FakeExpoStep::Json {
            path: RECEIPT_PATH,
            status: 200,
            body: json!({"data": receipts}),
            bearer: Some(ACCESS_TOKEN),
        },
    ]);
    let send_response = post_expo_json(
        &provider.endpoint(SEND_PATH),
        Some(ACCESS_TOKEN),
        expo_send_payload(&claim, &request),
        std::time::Duration::from_secs(5),
    )
    .expect("fixture ticket response");
    let settlement = classify_expo_send_response(send_response.status, &send_response.body, 60_000);
    snapback
        .auth_database_mut()
        .push_registry()
        .settle_batch(&claim, &settlement, 103)
        .expect("settle fixture tickets");

    let receipt_due = 103 + PUSH_RECEIPT_FIRST_POLL_MS;
    let receipt_claim = snapback
        .auth_database_mut()
        .push_registry()
        .claim_due_receipts(receipt_due)
        .expect("claim fixture receipts");
    assert_eq!(receipt_claim.entries.len(), 2);
    let receipt_response = post_expo_json(
        &provider.endpoint(RECEIPT_PATH),
        Some(ACCESS_TOKEN),
        expo_receipt_payload(&receipt_claim),
        std::time::Duration::from_secs(5),
    )
    .expect("fixture receipt response");
    assert_eq!(receipt_response.status, 200);
    let receipt_outcomes =
        parse_expo_receipt_response(&receipt_response.body).expect("closed receipt response");
    snapback
        .auth_database_mut()
        .push_registry()
        .settle_receipt_poll(&receipt_claim, &receipt_outcomes, receipt_due + 1)
        .expect("settle fixture receipts");

    snapback
        .auth_database_mut()
        .push_registry()
        .assert_acceptance_ledger_outcomes_for_test(&[
            (&token_ok, "expo-accepted", false),
            (&token_ticket_dnr, "failed-permanent", true),
            (&token_receipt_dnr, "expo-error", true),
        ])
        .expect("fixture ledger outcomes");

    let requests = provider.finish();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].path, SEND_PATH);
    assert_eq!(requests[0].body.as_array().map(Vec::len), Some(3));
    assert_eq!(requests[1].path, RECEIPT_PATH);
    let mut receipt_ids = requests[1].body["ids"]
        .as_array()
        .expect("fixture receipt ids")
        .iter()
        .map(|value| value.as_str().expect("ticket id").to_owned())
        .collect::<Vec<_>>();
    receipt_ids.sort();
    assert_eq!(receipt_ids, ["ticket-ok", "ticket-receipt-dnr"]);

    let duplicate = snapback
        .reserve_send(
            &declaration,
            &schema,
            system_authority,
            PushTriggerModeV1::System,
            None,
            &request,
            receipt_due + 2,
        )
        .expect("duplicate intent lookup");
    assert!(duplicate.response.deduplicated);
    assert!(duplicate.batches.is_empty());

    let zero_target = acceptance_request("guests", "event-empty", "acceptance-zero");
    let zero_attempt = snapback
        .reserve_send(
            &declaration,
            &schema,
            system_authority,
            PushTriggerModeV1::System,
            None,
            &zero_target,
            receipt_due + 3,
        )
        .expect("zero-target intent");
    assert_eq!(zero_attempt.response.state, "zero-target");
    assert_eq!(zero_attempt.response.target_count, 0);
    assert!(zero_attempt.batches.is_empty());

    let unauthorized = ids::mint(Kind::User).expect("unauthorized principal");
    let unauthorized_request =
        acceptance_request("authorizedGuests", "event-main", "acceptance-unauthorized");
    let authorization_error = match snapback.reserve_send(
        &declaration,
        &schema,
        || session_authority(&unauthorized),
        PushTriggerModeV1::Immediate,
        None,
        &unauthorized_request,
        receipt_due + 4,
    ) {
        Ok(_) => panic!("unauthorized push send must refuse"),
        Err(error) => error,
    };
    assert_eq!(
        authorization_error.diagnostic.code,
        "SNAPBACK_AUTH_PERMISSION_DENIED"
    );

    let drop_principal = ids::mint(Kind::User).expect("drop principal");
    snapback
        .auth_database_mut()
        .push_registry()
        .seed_drop_audience_for_test(&declaration, &drop_principal)
        .expect("drop fixture audience");
    let drop_request = acceptance_request("guests", "event-drop", "acceptance-drop");
    let drop_attempt = snapback
        .reserve_send(
            &declaration,
            &schema,
            system_authority,
            PushTriggerModeV1::System,
            None,
            &drop_request,
            2_000_000,
        )
        .expect("reserve drop fixture");
    let drop_claim = snapback
        .auth_database_mut()
        .push_registry()
        .claim_batch(&drop_attempt.batches[0].batch_id, 2_000_001)
        .expect("claim drop fixture")
        .expect("drop batch exists");
    snapback
        .auth_database_mut()
        .push_registry()
        .mark_batch_transmitting(&drop_claim, 2_000_002)
        .expect("drop fixture transmit cut");
    let dropping_provider =
        FakeExpo::start(vec![FakeExpoStep::DropAfterRequest { path: SEND_PATH }]);
    let uncertainty = post_expo_json(
        &dropping_provider.endpoint(SEND_PATH),
        None,
        expo_send_payload(&drop_claim, &drop_request),
        std::time::Duration::from_secs(5),
    )
    .err()
    .expect("lost response is transport uncertainty");
    assert_eq!(uncertainty, ExpoHttpUncertaintyV1::Transport);
    snapback
        .auth_database_mut()
        .push_registry()
        .settle_batch(
            &drop_claim,
            &PushBatchSettlementV1::Ambiguous {
                code: "transport-error".into(),
            },
            2_000_003,
        )
        .expect("settle response-loss ambiguity");
    assert_eq!(dropping_provider.finish().len(), 1);
    snapback
        .auth_database_mut()
        .push_registry()
        .assert_no_expired_batch_recovery_for_test(2_100_000)
        .expect("ambiguous settlement has no automatic redrive");

    let implicit_retry = snapback
        .reserve_send(
            &declaration,
            &schema,
            system_authority,
            PushTriggerModeV1::System,
            None,
            &drop_request,
            2_100_001,
        )
        .expect("same key remains a deduplicated lookup");
    assert!(implicit_retry.response.deduplicated);
    assert!(implicit_retry.batches.is_empty());

    let mut explicit_redrive = drop_request.clone();
    explicit_redrive.redrive_ambiguous = true;
    let redriven = snapback
        .reserve_send(
            &declaration,
            &schema,
            system_authority,
            PushTriggerModeV1::System,
            None,
            &explicit_redrive,
            2_100_002,
        )
        .expect("explicit duplicate-risk redrive");
    assert_eq!(redriven.response.attempt, 2);
    assert!(!redriven.response.deduplicated);
    assert_eq!(redriven.batches.len(), 1);
    snapback
        .auth_database_mut()
        .push_registry()
        .redrive_previous_ambiguous_for_test(&redriven.batches[0].batch_id)
        .expect("redrive provenance marker");
}

#[test]
fn deferred_grant_binds_request_and_revalidates_producer_membership() {
    let producer = ids::mint(Kind::User).expect("producer id");
    let audience = PushAudienceDeclarationV1 {
        resolve: PushAudienceResolverV1::Membership {
            declaration: "app_members".into(),
            resource_arg: None,
            roles: vec!["sender".into()],
        },
        authorize: PushAudienceAuthorizeV1::Membership {
            declaration: "app_members".into(),
            resource_arg: None,
            roles: vec!["sender".into()],
        },
    };
    let schema = app_membership_schema();
    let fixture = PushAuthorizationTestFixture::app_members().expect("membership fixture");
    fixture
        .grant_app_sender(&producer)
        .expect("producer membership");
    let request = PushSendRequestV1 {
        to: PushAudienceReferenceV1 {
            audience: "members".into(),
            args: Map::new(),
        },
        title: "title".into(),
        body: "body".into(),
        data: None,
        dedupe_key: "deferred-1".into(),
        redrive_ambiguous: false,
    };
    let grant = PushDeferredGrantV1 {
        producer_principal: producer.clone(),
        to: request.to.clone(),
        dedupe_key: request.dedupe_key.clone(),
    };
    let authority = system_authority();
    authorize_send_for_prepared(
        &fixture,
        &schema,
        &audience,
        &authority,
        PushTriggerModeV1::Deferred,
        Some(&grant),
        &request,
    )
    .expect("exact grant and current membership authorize");

    let mut divergent = request.clone();
    divergent.dedupe_key = "deferred-2".into();
    assert_eq!(
        authorize_send_for_prepared(
            &fixture,
            &schema,
            &audience,
            &authority,
            PushTriggerModeV1::Deferred,
            Some(&grant),
            &divergent,
        )
        .expect_err("grant is bound to one exact dedupe key")
        .diagnostic
        .code,
        "SNAPBACK_AUTH_PERMISSION_DENIED"
    );
    fixture
        .revoke_app_sender(&producer)
        .expect("revoke producer membership");
    assert_eq!(
        authorize_send_for_prepared(
            &fixture,
            &schema,
            &audience,
            &authority,
            PushTriggerModeV1::Deferred,
            Some(&grant),
            &request,
        )
        .expect_err("execution revalidates current producer membership")
        .diagnostic
        .code,
        "SNAPBACK_AUTH_PERMISSION_DENIED"
    );
}

#[test]
fn explicit_principals_and_membership_authorize_consume_their_declared_argument_union() {
    let sender = ids::mint(Kind::User).expect("sender id");
    let recipient = ids::mint(Kind::User).expect("recipient id");
    let audience = PushAudienceDeclarationV1 {
        resolve: PushAudienceResolverV1::ExplicitPrincipals {
            principals_arg: "principalIds".into(),
            max_items: 12,
        },
        authorize: PushAudienceAuthorizeV1::Membership {
            declaration: "app_members".into(),
            resource_arg: None,
            roles: vec!["sender".into()],
        },
    };
    let mut args = Map::new();
    args.insert("principalIds".into(), json!([recipient]));
    validate_audience_args(&audience, &args).expect("exact declared union");

    let fixture = PushAuthorizationTestFixture::app_members().expect("membership fixture");
    let authority = session_authority(&sender);
    let resolved_sender = authority
        .projection()
        .user_id()
        .expect("production session resolves one user")
        .to_owned();
    fixture
        .grant_app_sender(&resolved_sender)
        .expect("sender membership");
    let schema = app_membership_schema();
    authorize_send_for_prepared(
        &fixture,
        &schema,
        &audience,
        &authority,
        PushTriggerModeV1::Immediate,
        None,
        &PushSendRequestV1 {
            to: PushAudienceReferenceV1 {
                audience: "explicitAudience".into(),
                args: args.clone(),
            },
            title: "title".into(),
            body: "body".into(),
            data: None,
            dedupe_key: "dedupe".into(),
            redrive_ambiguous: false,
        },
    )
    .expect("immediate explicit-principal send is membership-authorized");
    assert_eq!(
        fixture
            .resolve_audience(&schema, &audience.resolve, &args)
            .expect("explicit-principal resolution"),
        vec![recipient]
    );

    let mut extra_args = args.clone();
    extra_args.insert("escapeHatch".into(), json!([sender]));
    assert_eq!(
        validate_audience_args(&audience, &extra_args)
            .expect_err("extra argument refuses")
            .diagnostic
            .code,
        "SNAPBACK_PUSH_SEND_INVALID"
    );
    assert_eq!(
        authorize_send_for_prepared(
            &fixture,
            &schema,
            &audience,
            &authority,
            PushTriggerModeV1::Deferred,
            None,
            &PushSendRequestV1 {
                to: PushAudienceReferenceV1 {
                    audience: "explicitAudience".into(),
                    args,
                },
                title: "title".into(),
                body: "body".into(),
                data: None,
                dedupe_key: "dedupe".into(),
                redrive_ambiguous: false,
            },
        )
        .expect_err("deferred raw principal list refuses")
        .diagnostic
        .code,
        "SNAPBACK_AUTH_PERMISSION_DENIED"
    );
}
