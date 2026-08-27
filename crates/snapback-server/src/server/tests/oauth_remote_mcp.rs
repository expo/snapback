// Complete test items included at `server::tests` module scope.

#[tokio::test]
async fn capability_link_one_use_mint_without_function_approval_returns() {
    let state = capability_link_server_fixture().await;
    let router = app(state.clone());
    let owner = mint_test_credential(&state, "one-use-link-owner@example.test").await;
    let minted = bounded_oneshot_for_deadlock_regression(
        router,
        session_auth_http_request(
            "/capability-links",
            serde_json::to_vec(&json!({
                "function": "queuedWrite",
                "pinnedArgs": { "value": "one-use" },
                "uses": 1,
            }))
            .unwrap(),
            owner["token"].as_str().unwrap(),
        ),
        "capability-link mint must return within 2s without admission re-entry deadlock",
    )
    .await;
    let status = minted.status();
    let minted = response_json(minted).await;
    assert_eq!(status, StatusCode::OK, "{minted}");
    assert_eq!(minted["approvalPerUse"], false);
    assert_eq!(minted["remainingUses"], 1);
}

#[tokio::test]
async fn capability_link_revoke_returns_after_directly_seeded_link() {
    let state = capability_link_server_fixture().await;
    let router = app(state.clone());
    let owner = mint_test_credential(&state, "revoke-link-owner@example.test").await;
    let bearer = owner["token"].as_str().unwrap().to_owned();
    let minter_principal_id = owner["session"]["userId"].as_str().unwrap().to_owned();
    let minter_session_id = owner["session"]["id"].as_str().unwrap().to_owned();
    let minter_authority_instance_id = owner["authorityDescriptor"]["authorityInstanceId"]
        .as_str()
        .unwrap()
        .to_owned();
    let now_ms = super::now_millis();
    let minted = with_snapback(&state.snapback, move |snapback| {
        snapback.remainder_auth_fixture().mint_capability_link(
            crate::storage::capability_links::MintCapabilityLink {
                minter_principal_id,
                minter_session_id,
                minter_authority_instance_id,
                function_id: "fn:queuedWrite".to_owned(),
                function_name: "queuedWrite".to_owned(),
                function_kind:
                    crate::storage::capability_links::CapabilityLinkFunctionKind::Mutation,
                pinned_args_json: r#"{"value":"revoke-seeded"}"#.to_owned(),
                caller_args: Vec::new(),
                expires_at_ms: now_ms + 60_000,
                remaining_uses: Some(1),
                approval_per_use: false,
                now_ms,
            },
        )
    })
    .await
    .expect("seed capability link outside the transport guard path");
    let mut revoke = session_auth_http_request(
        &format!("/capability-links/{}", minted.record.id),
        Vec::new(),
        &bearer,
    );
    *revoke.method_mut() = axum::http::Method::DELETE;
    let revoked = bounded_oneshot_for_deadlock_regression(
        router,
        revoke,
        "capability-link revoke must return within 2s without admission re-entry deadlock",
    )
    .await;
    assert_eq!(revoked.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn approval_gate_returns_one_pending_shape_on_bare_api_mcp_and_link_ingress() {
    let state = approval_effect_server_fixture(ApiFunctionApproval::Required).await;
    let router = app(state.clone());
    let mutation_request = |uri: &str, value: &str| {
        let mut request = Request::builder()
            .method("POST")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "args": { "value": value },
                }))
                .unwrap(),
            ))
            .unwrap();
        offer_auth_client_protocol(&mut request);
        request
    };
    for (uri, value) in [
        ("/mutation/queuedWrite", "bare-pending"),
        ("/api/v1/mutation/queuedWrite", "api-pending"),
    ] {
        let response = router
            .clone()
            .oneshot(mutation_request(uri, value))
            .await
            .unwrap();
        let status = response.status();
        let body = response_json(response).await;
        assert_eq!(status, StatusCode::ACCEPTED, "{body}");
        assert_eq!(
            body["diagnostic"]["code"],
            "SNAPBACK_EFFECT_APPROVAL_PENDING"
        );
        assert!(
            body["diagnostic"]["details"]["effectId"]
                .as_str()
                .unwrap()
                .starts_with("pfx_")
        );
        assert_eq!(
            body["diagnostic"]["details"]["preview"]["kind"],
            "disclosed"
        );
    }

    let mcp = router
        .clone()
        .oneshot(mcp_protocol_request(
            "POST",
            json!({
                "jsonrpc": "2.0",
                "id": 41,
                "method": "tools/call",
                "params": {
                    "name": "snapback_fn_fn_queuedwrite",
                    "arguments": { "args": { "value": "mcp-pending" } }
                }
            }),
            None,
            None,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(mcp.status(), StatusCode::OK);
    assert!(
        serde_json::to_string(&response_json(mcp).await)
            .unwrap()
            .contains("SNAPBACK_EFFECT_APPROVAL_PENDING")
    );

    let owner = mint_test_credential(&state, "effect-link-owner@example.test").await;
    let bearer = owner["token"].as_str().unwrap();
    let minted = router
        .clone()
        .oneshot(session_auth_http_request(
            "/capability-links",
            serde_json::to_vec(&json!({
                "function": "queuedWrite",
                "pinnedArgs": { "value": "link-pending" },
                "uses": 2,
            }))
            .unwrap(),
            bearer,
        ))
        .await
        .unwrap();
    let minted_status = minted.status();
    let minted = response_json(minted).await;
    assert_eq!(minted_status, StatusCode::OK, "{minted}");
    assert_eq!(minted["approvalPerUse"], true);
    let link_url = minted["url"].as_str().unwrap();
    let invoked = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("{link_url}/invoke"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"args":{}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invoked.status(), StatusCode::ACCEPTED);
    let invoked = response_json(invoked).await;
    assert_eq!(
        invoked["diagnostic"]["code"],
        "SNAPBACK_EFFECT_APPROVAL_PENDING",
    );
    let link_effect_id = invoked["diagnostic"]["details"]["effectId"]
        .as_str()
        .unwrap();
    let approved = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/effects/{link_effect_id}/approve"),
            br#"{}"#.to_vec(),
            bearer,
        ))
        .await
        .unwrap();
    assert_eq!(approved.status(), StatusCode::OK);
}

#[tokio::test]
async fn external_gate_keeps_first_party_direct_and_approval_executes_or_denies_once() {
    let external_state = approval_effect_server_fixture(ApiFunctionApproval::External).await;
    let external_router = app(external_state.clone());
    let mut anonymous_request = Request::builder()
        .method("POST")
        .uri("/mutation/queuedWrite")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"args":{"value":"external-pending"}}"#))
        .unwrap();
    offer_auth_client_protocol(&mut anonymous_request);
    let anonymous = external_router
        .clone()
        .oneshot(anonymous_request)
        .await
        .unwrap();
    assert_eq!(anonymous.status(), StatusCode::ACCEPTED);
    let user = mint_test_credential(&external_state, "effect-first-party@example.test").await;
    let direct = external_router
        .clone()
        .oneshot(session_auth_http_request(
            "/mutation/queuedWrite",
            br#"{"args":{"value":"first-party-direct"}}"#.to_vec(),
            user["token"].as_str().unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(direct.status(), StatusCode::OK);

    let state = approval_effect_server_fixture(ApiFunctionApproval::Required).await;
    let router = app(state.clone());
    let approver = mint_test_credential(&state, "effect-approver@example.test").await;
    let bearer = approver["token"].as_str().unwrap();
    let create = |value: &'static str| {
        let mut request = Request::builder()
            .method("POST")
            .uri("/mutation/queuedWrite")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "args": { "value": value },
                }))
                .unwrap(),
            ))
            .unwrap();
        offer_auth_client_protocol(&mut request);
        request
    };
    let pending = response_json(
        router
            .clone()
            .oneshot(create("approved-effect"))
            .await
            .unwrap(),
    )
    .await;
    let effect_id = pending["diagnostic"]["details"]["effectId"]
        .as_str()
        .unwrap()
        .to_owned();

    let mut inbox = Request::builder()
        .method("GET")
        .uri("/effects")
        .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
        .body(Body::empty())
        .unwrap();
    offer_auth_client_protocol(&mut inbox);
    let inbox = response_json(router.clone().oneshot(inbox).await.unwrap()).await;
    assert!(
        inbox
            .as_array()
            .unwrap()
            .iter()
            .any(|effect| effect["id"] == effect_id)
    );

    let approved = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/effects/{effect_id}/approve"),
            br#"{}"#.to_vec(),
            bearer,
        ))
        .await
        .unwrap();
    assert_eq!(approved.status(), StatusCode::OK);
    assert_eq!(approved.headers()["x-snapback-effect-id"], effect_id);
    let _approved_body = response_json(approved).await;
    let lookup_id = effect_id.clone();
    let stored = with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .pending_effect(&lookup_id, super::now_millis())
    })
    .await
    .unwrap();
    assert_eq!(
        stored.status,
        crate::storage::pending_effects::PendingEffectStatus::Executed
    );
    assert_eq!(
        stored
            .journal
            .iter()
            .map(|entry| entry.transition.as_str())
            .collect::<Vec<_>>(),
        ["created", "approved", "executed"],
    );
    state.telemetry.force_flush().unwrap();
    assert!(
        state
            .telemetry
            .event_details_for_test("function_run", "queuedWrite")
            .into_iter()
            .flatten()
            .any(|details| {
                details["callerLane"] == "anonymous"
                    && details["callerKey"] == "anonymous"
                    && details["approverKey"] == approver["session"]["userId"]
            })
    );

    let denied = response_json(
        router
            .clone()
            .oneshot(create("denied-effect"))
            .await
            .unwrap(),
    )
    .await;
    let denied_id = denied["diagnostic"]["details"]["effectId"]
        .as_str()
        .unwrap();
    let denied = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/effects/{denied_id}/deny"),
            br#"{}"#.to_vec(),
            bearer,
        ))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::OK);
    assert_eq!(response_json(denied).await["status"], "refused");
}

#[tokio::test]
async fn authority_creating_effect_requires_operation_bound_step_up() {
    let state =
        approval_effect_server_fixture_with_authority_creation(ApiFunctionApproval::Required, true)
            .await;
    let provider = state.auth_provider.clone().expect("effect auth provider");
    let router = app(state.clone());
    let approver = mint_test_credential(&state, "effect-step-up@example.test").await;
    let bearer = approver["token"].as_str().unwrap();
    let mut invoke = Request::builder()
        .method("POST")
        .uri("/mutation/queuedWrite")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"args":{"value":"step-up-effect"}}"#))
        .unwrap();
    offer_auth_client_protocol(&mut invoke);
    let pending = response_json(router.clone().oneshot(invoke).await.unwrap()).await;
    let effect_id = pending["diagnostic"]["details"]["effectId"]
        .as_str()
        .unwrap()
        .to_owned();

    let missing = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/effects/{effect_id}/approve"),
            br#"{}"#.to_vec(),
            bearer,
        ))
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(missing).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_STEP_UP_REQUIRED",
    );

    let challenge = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/step-up/request",
            serde_json::to_vec(&json!({
                "operation": "effectApproval",
                "effectId": effect_id,
            }))
            .unwrap(),
            bearer,
        ))
        .await
        .unwrap();
    assert_eq!(challenge.status(), StatusCode::OK);
    let challenge_id = response_json(challenge).await["challengeId"]
        .as_str()
        .unwrap()
        .to_owned();
    let mailbox =
        serde_json::to_value(provider.mailbox_entry(&challenge_id).await.unwrap()).unwrap();
    let code = mailbox["code"].as_str().unwrap();
    let approved = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/effects/{effect_id}/approve"),
            serde_json::to_vec(&json!({
                "stepUp": { "challengeId": challenge_id, "code": code },
            }))
            .unwrap(),
            bearer,
        ))
        .await
        .unwrap();
    assert_eq!(approved.status(), StatusCode::OK);
}

#[tokio::test]
async fn effect_approval_refuses_generation_rotation() {
    let state = approval_effect_server_fixture(ApiFunctionApproval::Required).await;
    let router = app(state.clone());
    let approver = mint_test_credential(&state, "effect-revalidation@example.test").await;
    let bearer = approver["token"].as_str().unwrap();
    let pending_request = |value: &'static str| {
        let mut request = Request::builder()
            .method("POST")
            .uri("/mutation/queuedWrite")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "args": { "value": value },
                }))
                .unwrap(),
            ))
            .unwrap();
        offer_auth_client_protocol(&mut request);
        request
    };
    let rotated = response_json(
        router
            .clone()
            .oneshot(pending_request("rotate-before-approval"))
            .await
            .unwrap(),
    )
    .await;
    let rotated_id = rotated["diagnostic"]["details"]["effectId"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut successor = activation_functions('4', false);
    for function in &mut successor.functions {
        function.api_exposure = Some(ApiFunctionExposure::default());
    }
    let queued_write = successor
        .functions
        .iter_mut()
        .find(|function| function.name == "queuedWrite")
        .unwrap();
    queued_write.api_exposure = Some(ApiFunctionExposure {
        expose: true,
        since: None,
        approval: Some(ApiFunctionApproval::Required),
    });
    let queued_write_id = queued_write.id.clone();
    let queued_write_name = queued_write.name.clone();
    assert_eq!(queued_write_id, "fn:queuedWrite");
    let args_schema = json!({ "type": "object", "additionalProperties": true });
    let operations = BTreeMap::from([(
        queued_write_id.clone(),
        crate::api_envelope::ApiEnvelopeOperationV1 {
            name: queued_write_name,
            args_schema: args_schema.clone(),
        },
    )]);
    let app_bindings = "export {};".to_owned();
    let api_envelope = crate::api_envelope::ApiEnvelopeMembersV1 {
        operations,
        declarations: crate::api_envelope::ApiEnvelopeDeclarationsV1 {
            app_bindings: app_bindings.clone(),
        },
        member_digests: BTreeMap::from([
            (
                crate::api_envelope::operation_member_key(&queued_write_id),
                crate::api_envelope::member_digest(
                    &crate::api_envelope::canonicalize(&args_schema)
                        .expect("successor args schema canonicalizes"),
                ),
            ),
            (
                crate::api_envelope::DECLARATION_MEMBER_KEY.to_owned(),
                crate::api_envelope::member_digest(&app_bindings),
            ),
        ]),
    };
    let activated = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/app/ensure",
            serde_json::to_vec(&json!({
                "intent": "provision",
                "requestedMode": "sessions",
                "functions": successor,
                "apiEnvelope": api_envelope,
            }))
            .unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(
        activated.status(),
        StatusCode::OK,
        "{}",
        response_json(activated).await
    );
    let refused = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/effects/{rotated_id}/approve"),
            br#"{}"#.to_vec(),
            bearer,
        ))
        .await
        .unwrap();
    assert_eq!(refused.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(refused).await["diagnostic"]["code"],
        "SNAPBACK_EFFECT_BINDING_STALE",
    );
}

#[tokio::test]
async fn effect_approval_refuses_a_revoked_original_session() {
    let state = approval_effect_server_fixture(ApiFunctionApproval::Required).await;
    let router = app(state.clone());
    let original = mint_test_credential(&state, "effect-original@example.test").await;
    let original_bearer = original["token"].as_str().unwrap();
    let approver = mint_test_credential(&state, "effect-successor@example.test").await;
    let approver_bearer = approver["token"].as_str().unwrap();
    let pending = response_json(
        router
            .clone()
            .oneshot(session_auth_http_request(
                "/mutation/queuedWrite",
                br#"{"args":{"value":"revoked-original"}}"#.to_vec(),
                original_bearer,
            ))
            .await
            .unwrap(),
    )
    .await;
    let effect_id = pending["diagnostic"]["details"]["effectId"]
        .as_str()
        .unwrap()
        .to_owned();
    let logout = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            original_bearer,
        ))
        .await
        .unwrap();
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    let refused = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/effects/{effect_id}/approve"),
            br#"{}"#.to_vec(),
            approver_bearer,
        ))
        .await
        .unwrap();
    assert!(!refused.status().is_success());
    assert!(
        response_json(refused).await["diagnostic"]["code"]
            .as_str()
            .unwrap()
            .starts_with("SNAPBACK_AUTH_")
    );
    let lookup_id = effect_id.clone();
    let stored = with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .pending_effect(&lookup_id, super::now_millis())
    })
    .await
    .unwrap();
    assert_eq!(
        stored.status,
        crate::storage::pending_effects::PendingEffectStatus::Refused,
    );
}

#[tokio::test]
async fn effect_approval_reprepares_original_session_with_catalog_claims() {
    let state = approval_effect_server_fixture(ApiFunctionApproval::Required).await;
    let router = app(state.clone());
    let original = mint_test_credential(&state, "effect-claims-original@example.test").await;
    let original_bearer = original["token"].as_str().unwrap();
    let pending = response_json(
        router
            .clone()
            .oneshot(session_auth_http_request(
                "/mutation/queuedWrite",
                br#"{"args":{"value":"claims-original"}}"#.to_vec(),
                original_bearer,
            ))
            .await
            .unwrap(),
    )
    .await;
    let effect_id = pending["diagnostic"]["details"]["effectId"]
        .as_str()
        .unwrap()
        .to_owned();
    let lookup_id = effect_id.clone();
    let effect = with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .pending_effect(&lookup_id, super::now_millis())
    })
    .await
    .unwrap();

    let approver = mint_test_credential(&state, "effect-claims-approver@example.test").await;
    let approver_bearer = approver["token"].as_str().unwrap();
    let provider = state.auth_provider.as_ref().expect("effect provider");
    let coordinator = state.auth_coordinator.as_ref().expect("effect coordinator");
    let prepared = coordinator
        .resolve_required_bearer(approver_bearer, provider.now_ms(), provider.monotonic_now())
        .expect("resolve effect approver session");
    let (resolved, publication) = prepared.into_parts();
    let ResolvedAppAuthority::Session(subject) = &resolved else {
        panic!("effect approver must resolve to session authority")
    };
    let session_id = subject.session_id().to_owned();
    let profile = state.server.profile;
    let claims_now_ms = provider.now_ms();
    let claims = with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .identity_claims(&session_id, claims_now_ms, profile)
    })
    .await
    .unwrap();
    let management = InvocationGate::prepare_admitted_subjectless_authority(
        InvocationSource::EffectManagement,
        AuthMode::Sessions,
        state.server.profile,
        test_route_admission(&state).0,
        &WireAuthorityFields::default(),
        resolved,
        Some(claims),
    )
    .unwrap()
    .with_fenced_publication(publication);

    let approval_management = management.clone();
    let approval_effect_id = effect.id.clone();
    let approval_now_ms = provider.now_ms();
    let approval = with_snapback(&state.snapback, move |snapback| {
        snapback.prepare_pending_effect_approval(
            &approval_management,
            &approval_effect_id,
            approval_now_ms,
        )
    })
    .await
    .expect("prepare exact pending effect for the derived approver");
    let execution = super::effects::prepare_original_authority(&state, &approval)
        .await
        .expect("effect approval must re-prepare original session authority");
    assert_eq!(execution.source(), InvocationSource::EffectExecution);
    let projection = serde_json::to_value(execution.projection()).unwrap();
    assert_eq!(
        projection["claims"]["identities"][0]["value"],
        "effect-claims-original@example.test"
    );
    drop(execution);

    let (before_version, before_change_count) = with_snapback(&state.snapback, |snapback| {
        Ok::<_, SnapbackError>((
            snapback.migrate_head_version()?,
            snapback.change_journal_len()?,
        ))
    })
    .await
    .expect("read the durable application head before approval execution");
    let expected_approver = approver["session"]["userId"]
        .as_str()
        .expect("approver user id")
        .to_owned();
    let approved = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/effects/{effect_id}/approve"),
            br#"{}"#.to_vec(),
            approver_bearer,
        ))
        .await
        .expect("approve the exact pending effect through the HTTP route");
    assert_eq!(approved.status(), StatusCode::OK);
    assert_eq!(approved.headers()["x-snapback-effect-id"], effect_id);
    let _approved_body = response_json(approved).await;

    let durable_effect_id = effect_id.clone();
    let (durable, items, version_row, changes, after_change_count) =
        with_snapback(&state.snapback, move |snapback| {
            let durable = snapback
                .remainder_auth_fixture()
                .pending_effect(&durable_effect_id, super::now_millis())?;
            Ok::<_, SnapbackError>((
                durable,
                snapback.scan_table("items", 100, 0)?,
                snapback.storage_version_physical_row_for_test()?,
                snapback.physical_change_journal_rows_for_test("items", before_version)?,
                snapback.change_journal_len()?,
            ))
        })
        .await
        .expect("read every durable approval and application projection");

    // All 23 pending-effect columns are sourced by this durable read. The
    // immutable expectations come from the row read before approval; the
    // approver expectation comes from the independently minted A session.
    assert_eq!(durable.id, effect.id);
    assert_eq!(durable.function_id, effect.function_id);
    assert_eq!(durable.function_name, effect.function_name);
    assert_eq!(durable.function_kind, effect.function_kind);
    assert_eq!(durable.args, effect.args);
    assert_eq!(durable.args_digest, effect.args_digest);
    assert_eq!(durable.caller_lane(), effect.caller_lane());
    assert_eq!(durable.caller_key(), effect.caller_key());
    assert_eq!(durable.authority(), effect.authority());
    assert_eq!(durable.generation, effect.generation);
    assert_eq!(durable.effect_class, effect.effect_class);
    assert_eq!(durable.link_origin_id, effect.link_origin_id);
    assert_eq!(
        durable.approver_principal_id(),
        effect.approver_principal_id()
    );
    assert_eq!(durable.created_at_ms, effect.created_at_ms);
    assert_eq!(durable.expires_at_ms, effect.expires_at_ms);
    assert_eq!(
        durable.status,
        crate::storage::pending_effects::PendingEffectStatus::Executed
    );
    assert_eq!(
        durable.approver_identity.as_deref(),
        Some(expected_approver.as_str())
    );
    assert_eq!(durable.preview, effect.preview);
    let decided_at_ms = durable
        .decided_at_ms
        .expect("approved effect stores its decision timestamp");
    let executed_at_ms = durable
        .executed_at_ms
        .expect("executed effect stores its settlement timestamp");
    assert!(decided_at_ms >= durable.created_at_ms);
    assert!(executed_at_ms >= decided_at_ms);
    assert_eq!(durable.outcome_code.as_deref(), Some("ok"));
    assert_eq!(
        durable
            .journal
            .iter()
            .map(|entry| (
                entry.transition.as_str(),
                entry.actor.as_deref(),
                entry.outcome_code.as_deref(),
            ))
            .collect::<Vec<_>>(),
        [
            (
                "created",
                Some(effect.caller_key()),
                Some("SNAPBACK_EFFECT_APPROVAL_PENDING"),
            ),
            ("approved", Some(expected_approver.as_str()), None),
            ("executed", None, Some("ok")),
        ]
    );

    assert_eq!(
        items.columns,
        ["_id", "value", "_version", "_createdAt", "_updatedAt"]
    );
    let approved_rows = items
        .rows
        .iter()
        .filter(|row| row["value"] == "claims-original")
        .collect::<Vec<_>>();
    assert_eq!(approved_rows.len(), 1);
    let approved_row = approved_rows[0];
    let after_version = before_version + 1;
    assert_eq!(approved_row["_version"], after_version);
    assert_eq!(approved_row["_createdAt"], approved_row["_updatedAt"]);
    assert_eq!(version_row, (1, after_version as i64));
    assert_eq!(after_change_count, before_change_count + 1);
    assert_eq!(changes.len(), 1);
    let change = &changes[0];
    assert!(change.id > 0);
    assert_eq!(change.version, after_version as i64);
    assert_eq!(change.table_name, "items");
    assert_eq!(change.row_id, approved_row["_id"].as_str().unwrap());
    assert_eq!(change.op, "insert");
    let change_row_json =
        serde_json::from_str::<Value>(change.row_json.as_deref().unwrap()).unwrap();
    assert_eq!(&change_row_json, approved_row);
    assert_eq!(
        change.changed_at_ms,
        approved_row["_createdAt"].as_i64().unwrap()
    );
}

#[tokio::test]
async fn remote_mcp_refuses_when_the_external_api_is_not_enabled() {
    let refused = app(sessions_activation_server_fixture_async().await)
        .oneshot(mcp_protocol_request(
            "POST",
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }),
            None,
            None,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(refused).await["diagnostic"]["code"],
        "SNAPBACK_API_NOT_ENABLED"
    );
}

#[tokio::test]
async fn oauth_dynamic_registration_reuses_open_invited_and_disabled_agent_policy() {
    let register = |body: Value| {
        oauth_protocol_request(
            "POST",
            "/auth/oauth/register",
            Some("application/json"),
            serde_json::to_vec(&body).unwrap(),
            None,
        )
    };

    let open_state = sessions_activation_server_fixture_with_oauth_async().await;
    let open_router = app(open_state.clone());
    let invalid_redirect = open_router
        .clone()
        .oneshot(register(json!({
            "redirect_uris": ["http://public.example/callback"]
        })))
        .await
        .unwrap();
    assert_eq!(invalid_redirect.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(invalid_redirect).await["error"],
        "invalid_redirect_uri"
    );
    let open = open_router
        .clone()
        .oneshot(register(json!({
            "redirect_uris": ["https://open.example/callback"],
            "client_name": "Open OAuth"
        })))
        .await
        .unwrap();
    assert_eq!(open.status(), StatusCode::OK);
    let open = response_json(open).await;
    assert!(open.get("client_secret").is_none());
    assert!(
        open["token_endpoint"]
            .as_str()
            .unwrap()
            .ends_with("/auth/oauth/token")
    );
    let open_client_id = open["client_id"].as_str().unwrap().to_owned();
    let lookup_client_id = open_client_id.clone();
    let open_facts = with_snapback(&open_state.snapback, move |snapback| {
        let mut database = snapback.remainder_auth_fixture();
        let (principal, claim, redirects) =
            database.oauth_registration_facts_for_test(&lookup_client_id)?;
        let principal_facts = database
            .auth_catalog()
            .agent_registration_facts_for_test(&principal)?;
        Ok::<_, SnapbackError>((principal, principal_facts, claim, redirects))
    })
    .await
    .unwrap();
    assert_eq!(open_facts.1.0.1, None);
    assert_eq!(open_facts.2, "provisional");
    assert_eq!(
        serde_json::from_str::<Value>(&open_facts.3).unwrap(),
        json!(["https://open.example/callback"])
    );
    let open_provenance = serde_json::from_str::<Value>(&open_facts.1.0.2).unwrap();
    assert_eq!(open_provenance["class"], "integration");
    assert_eq!(open_provenance["mode"], "open");
    let suspended_principal = open_facts.0;
    let suspension_at = open_state.auth_provider.as_ref().unwrap().now_ms();
    with_snapback(&open_state.snapback, move |snapback| {
        snapback.remainder_auth_fixture().set_integration_suspended(
            &suspended_principal,
            true,
            suspension_at,
        )
    })
    .await
    .unwrap();
    let suspended_reregistration = open_router
        .oneshot(register(json!({
            "client_id": open_client_id,
            "redirect_uris": ["https://open.example/callback"]
        })))
        .await
        .unwrap();
    assert_eq!(suspended_reregistration.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(suspended_reregistration).await["error"],
        "invalid_client_metadata"
    );

    let invited_state = sessions_activation_server_fixture_with_oauth_policy_async(agent_policy(
        AgentsMode::Invited,
        InvitedBy::Users,
    ))
    .await;
    let inviter = mint_test_credential(&invited_state, "oauth-inviter@example.com").await;
    let inviter_id = inviter["session"]["userId"].as_str().unwrap().to_owned();
    let invited_router = app(invited_state.clone());
    let invitation = mint_user_agent_invitation(
        &invited_state,
        &invited_router,
        inviter["token"].as_str().unwrap(),
    )
    .await;
    let invitation_id = invitation["invitationId"].as_str().unwrap().to_owned();
    let invitation_secret = invitation["invitation"].as_str().unwrap().to_owned();
    let invited = invited_router
        .clone()
        .oneshot(register(json!({
            "redirect_uris": ["http://[::1]:8765/callback"],
            "client_name": "Invited OAuth",
            "invitation": invitation_secret,
        })))
        .await
        .unwrap();
    assert_eq!(invited.status(), StatusCode::OK);
    let invited = response_json(invited).await;
    let invited_client_id = invited["client_id"].as_str().unwrap().to_owned();
    let invited_facts = with_snapback(&invited_state.snapback, move |snapback| {
        let mut database = snapback.remainder_auth_fixture();
        let (principal, claim, _) =
            database.oauth_registration_facts_for_test(&invited_client_id)?;
        let principal_facts = database
            .auth_catalog()
            .agent_registration_facts_for_test(&principal)?;
        let consumption = database
            .auth_catalog()
            .invitation_consumption_for_test(&invitation_id)?;
        Ok::<_, SnapbackError>((principal, principal_facts, claim, consumption))
    })
    .await
    .unwrap();
    assert_eq!(invited_facts.1.0.1, None);
    assert_eq!(invited_facts.2, "unclaimed");
    assert_eq!(
        invited_facts.3,
        (inviter_id.clone(), Some(invited_facts.0.clone()))
    );
    let invited_provenance = serde_json::from_str::<Value>(&invited_facts.1.0.2).unwrap();
    assert_eq!(invited_provenance["inviter"], inviter_id);
    let replay = invited_router
        .oneshot(register(json!({
            "redirect_uris": ["https://replay.example/callback"],
            "invitation": invitation["invitation"],
        })))
        .await
        .unwrap();
    assert_eq!(replay.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(replay).await["details"]["code"],
        "SNAPBACK_AUTH_AGENT_INVITATION_INVALID"
    );

    let disabled_state = sessions_activation_server_fixture_with_oauth_policy_async(agent_policy(
        AgentsMode::Disabled,
        InvitedBy::Operators,
    ))
    .await;
    let disabled = app(disabled_state)
        .oneshot(register(json!({
            "redirect_uris": ["https://disabled.example/callback"]
        })))
        .await
        .unwrap();
    assert_eq!(disabled.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(disabled).await["details"]["code"],
        "SNAPBACK_AUTH_AGENT_REGISTRATION_DISABLED"
    );
}

#[tokio::test]
async fn oauth_facade_is_wholesale_absent_on_hosted_targets() {
    let mut state = sessions_activation_server_fixture_with_oauth_async().await;
    Arc::make_mut(&mut state.server).auth_deployment =
        crate::auth::deployment::AuthDeploymentTarget::Hosted;
    let router = app(state);
    for (method, path) in [
        ("GET", "/.well-known/oauth-authorization-server"),
        ("GET", "/.well-known/oauth-protected-resource"),
        ("POST", "/auth/oauth/register"),
        ("GET", "/auth/oauth/authorize"),
        ("POST", "/auth/oauth/authorize"),
        ("POST", "/auth/oauth/token"),
        ("POST", "/auth/oauth/revoke"),
    ] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{method} {path}");
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
        assert!(to_bytes(response.into_body(), 64).await.unwrap().is_empty());
    }
}

#[tokio::test]
async fn oauth_authorization_http_enforces_session_class_and_durable_shared_capacity() {
    let state = sessions_activation_server_fixture_with_oauth_async().await;
    let router = app(state.clone());
    let registered = router
        .clone()
        .oneshot(oauth_protocol_request(
            "POST",
            "/auth/oauth/register",
            Some("application/json"),
            serde_json::to_vec(&json!({
                "redirect_uris": ["http://127.0.0.1:4321/callback"],
                "client_name": "OAuth Capacity",
                "token_endpoint_auth_method": "none"
            }))
            .unwrap(),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(registered.status(), StatusCode::OK);
    let client_id = response_json(registered).await["client_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let user = mint_test_credential(&state, "oauth-capacity@example.com").await;
    let user_id = user["session"]["userId"].as_str().unwrap().to_owned();
    let bearer = user["token"].as_str().unwrap().to_owned();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest("v".repeat(43).as_bytes()));
    let authorize_uri = format!(
        "/auth/oauth/authorize?response_type=code&client_id={client_id}&redirect_uri=http%3A%2F%2F127.0.0.1%3A4321%2Fcallback&scope=items.read&code_challenge={challenge}&code_challenge_method=S256"
    );

    let unauthenticated = router
        .clone()
        .oneshot(oauth_protocol_request(
            "GET",
            &authorize_uri,
            None,
            Body::empty(),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);
    let wrong_class = AgentCredential::generate(&OsRandom)
        .unwrap()
        .expose_secret()
        .to_owned();
    let wrong_class_response = router
        .clone()
        .oneshot(oauth_protocol_request(
            "GET",
            &authorize_uri,
            None,
            Body::empty(),
            Some(&wrong_class),
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(wrong_class_response).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH"
    );
    let zero_user_id = user_id.clone();
    let zero = with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .oauth_proposal_counts_for_test(&zero_user_id)
    })
    .await
    .unwrap();
    assert_eq!(zero, (0, 0));

    for _ in 0..10 {
        let consent = router
            .clone()
            .oneshot(oauth_protocol_request(
                "GET",
                &authorize_uri,
                None,
                Body::empty(),
                Some(&bearer),
            ))
            .await
            .unwrap();
        assert_eq!(consent.status(), StatusCode::OK);
    }
    let refused = router
        .clone()
        .oneshot(oauth_protocol_request(
            "GET",
            &authorize_uri,
            None,
            Body::empty(),
            Some(&bearer),
        ))
        .await
        .unwrap();
    assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);
    let refused = response_json(refused).await;
    assert_eq!(refused["error"], "temporarily_unavailable");
    assert_eq!(
        refused["details"]["code"],
        "SNAPBACK_AUTH_PAIRING_REQUEST_CAP"
    );
    let counted_user_id = user_id.clone();
    let counts = with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .oauth_proposal_counts_for_test(&counted_user_id)
    })
    .await
    .unwrap();
    assert_eq!(counts, (10, 10));
}

#[tokio::test]
async fn oauth_metadata_and_full_authorization_code_journey_are_enabled_only_and_no_store() {
    let absent = app(sessions_activation_server_fixture_async().await)
        .oneshot(
            Request::builder()
                .uri("/.well-known/oauth-authorization-server")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(absent.status(), StatusCode::NOT_FOUND);

    let state = sessions_activation_server_fixture_with_oauth_async().await;
    let router = app(state.clone());
    for path in [
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-protected-resource",
    ] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(path)
                    .header(header::HOST, "attacker.example:8443")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
        let metadata = response_json(response).await;
        assert_eq!(
            metadata["scopes_supported"],
            json!(["items.read", "items.write"])
        );
        if path.ends_with("authorization-server") {
            assert_eq!(metadata["issuer"], json!("http://127.0.0.1:43621"));
            assert_eq!(
                metadata["authorization_endpoint"],
                json!("http://127.0.0.1:43621/auth/oauth/authorize")
            );
            assert_eq!(
                metadata["token_endpoint"],
                json!("http://127.0.0.1:43621/auth/oauth/token")
            );
            assert_eq!(
                metadata["registration_endpoint"],
                json!("http://127.0.0.1:43621/auth/oauth/register")
            );
            assert_eq!(
                metadata["code_challenge_methods_supported"],
                json!(["S256"])
            );
            assert_eq!(
                metadata["grant_types_supported"],
                json!(["authorization_code"])
            );
            assert!(
                metadata["registration_endpoint"]
                    .as_str()
                    .unwrap()
                    .ends_with("/auth/oauth/register")
            );
        } else {
            assert_eq!(metadata["resource"], json!("http://127.0.0.1:43621"));
            assert_eq!(
                metadata["authorization_servers"],
                json!(["http://127.0.0.1:43621"])
            );
            assert_eq!(metadata["bearer_methods_supported"], json!(["header"]));
        }
    }

    let mut registration_request = oauth_protocol_request(
        "POST",
        "/auth/oauth/register",
        Some("application/json"),
        serde_json::to_vec(&json!({
            "redirect_uris": ["http://127.0.0.1:4321/callback"],
            "client_name": "OAuth Journey",
            "token_endpoint_auth_method": "none"
        }))
        .unwrap(),
        None,
    );
    registration_request.headers_mut().insert(
        header::HOST,
        HeaderValue::from_static("attacker.example:8443"),
    );
    let registered = router.clone().oneshot(registration_request).await.unwrap();
    assert_eq!(registered.status(), StatusCode::OK);
    assert_eq!(
        registered.headers()[header::CACHE_CONTROL],
        "no-store, private"
    );
    let registered = response_json(registered).await;
    assert_eq!(
        registered["authorization_endpoint"],
        json!("http://127.0.0.1:43621/auth/oauth/authorize")
    );
    assert_eq!(
        registered["token_endpoint"],
        json!("http://127.0.0.1:43621/auth/oauth/token")
    );
    let client_id = registered["client_id"].as_str().unwrap().to_owned();
    assert!(client_id.starts_with("intg_"));
    assert!(registered.get("client_secret").is_none());

    let user = mint_test_credential(&state, "oauth-user@example.com").await;
    let bearer = user["token"].as_str().unwrap();
    let verifier = "v".repeat(43);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let authorize_uri = format!(
        "/auth/oauth/authorize?response_type=code&client_id={client_id}&redirect_uri=http%3A%2F%2F127.0.0.1%3A4321%2Fcallback&scope=items.read&state=journey-state&code_challenge={challenge}&code_challenge_method=S256"
    );
    let consent = router
        .clone()
        .oneshot(oauth_protocol_request(
            "GET",
            &authorize_uri,
            None,
            Body::empty(),
            Some(bearer),
        ))
        .await
        .unwrap();
    if consent.status() != StatusCode::OK {
        let status = consent.status();
        let refusal = String::from_utf8(
            to_bytes(consent.into_body(), 64 * 1024)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        panic!("OAuth consent failed with {status}: {refusal}");
    }
    assert_eq!(
        consent.headers()[header::CACHE_CONTROL],
        "no-store, private"
    );
    let consent = String::from_utf8(
        to_bytes(consent.into_body(), 64 * 1024)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(consent.contains("OAuth Journey"));
    assert!(consent.contains("items.read"));
    assert!(consent.contains("query fn:listItems"));
    let marker = "name=request_id value=\"";
    let request_id = consent
        .split_once(marker)
        .and_then(|(_, rest)| rest.split_once('\"'))
        .map(|(id, _)| id.to_owned())
        .expect("consent page carries opaque request id");
    let decision = format!("request_id={request_id}&decision=approve");
    let approval = router
        .clone()
        .oneshot(oauth_protocol_request(
            "POST",
            "/auth/oauth/authorize",
            Some("application/x-www-form-urlencoded"),
            decision,
            Some(bearer),
        ))
        .await
        .unwrap();
    assert_eq!(approval.status(), StatusCode::FOUND);
    let location = approval.headers()[header::LOCATION]
        .to_str()
        .unwrap()
        .to_owned();
    assert!(location.contains("state=journey-state"));
    let code = location
        .split_once("code=")
        .and_then(|(_, rest)| rest.split('&').next())
        .unwrap()
        .to_owned();

    let token_form = |proof: &str| {
        format!(
            "grant_type=authorization_code&code={code}&redirect_uri=http%3A%2F%2F127.0.0.1%3A4321%2Fcallback&client_id={client_id}&code_verifier={proof}"
        )
    };
    let wrong = router
        .clone()
        .oneshot(oauth_protocol_request(
            "POST",
            "/auth/oauth/token",
            Some("application/x-www-form-urlencoded"),
            token_form(&"x".repeat(43)),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(wrong.status(), StatusCode::BAD_REQUEST);
    assert_eq!(response_json(wrong).await["error"], "invalid_grant");

    let token = router
        .clone()
        .oneshot(oauth_protocol_request(
            "POST",
            "/auth/oauth/token",
            Some("application/x-www-form-urlencoded"),
            token_form(&verifier),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(token.status(), StatusCode::OK);
    assert_eq!(token.headers()[header::CACHE_CONTROL], "no-store, private");
    let token = response_json(token).await;
    assert_eq!(token["token_type"], "Bearer");
    assert_eq!(token["expires_in"], 900);
    assert_eq!(token["scope"], "items.read");
    let access_token = token["access_token"].as_str().unwrap().to_owned();

    let reused = router
        .clone()
        .oneshot(oauth_protocol_request(
            "POST",
            "/auth/oauth/token",
            Some("application/x-www-form-urlencoded"),
            token_form(&verifier),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response_json(reused).await["error"], "invalid_grant");

    let invocation = router
        .clone()
        .oneshot(oauth_protocol_request(
            "POST",
            "/api/v1/query/listItems",
            Some("application/json"),
            br#"{"args":{}}"#.to_vec(),
            Some(&access_token),
        ))
        .await
        .unwrap();
    assert_eq!(invocation.status(), StatusCode::OK);

    let mcp_tools = router
        .clone()
        .oneshot(mcp_protocol_request(
            "POST",
            json!({ "jsonrpc": "2.0", "id": 20, "method": "tools/list" }),
            Some(&access_token),
            None,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(mcp_tools.status(), StatusCode::OK);
    let mcp_tools = response_json(mcp_tools).await;
    let mcp_tool_names = mcp_tools["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        mcp_tool_names,
        BTreeSet::from([
            "describe_api",
            "run_code",
            "snapback_fn_fn_authenticateditems",
            "snapback_fn_fn_listitems",
            "snapback_fn_fn_queuedwrite",
        ])
    );

    let authenticated_call = router
        .clone()
        .oneshot(mcp_protocol_request(
            "POST",
            json!({
                "jsonrpc": "2.0",
                "id": 21,
                "method": "tools/call",
                "params": {
                    "name": "snapback_fn_fn_authenticateditems",
                    "arguments": { "args": {} }
                }
            }),
            Some(&access_token),
            None,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(authenticated_call.status(), StatusCode::OK);
    assert_eq!(
        response_json(authenticated_call).await["result"]["isError"],
        false
    );

    let hidden_credentialed = router
        .clone()
        .oneshot(mcp_protocol_request(
            "POST",
            json!({
                "jsonrpc": "2.0",
                "id": 22,
                "method": "tools/call",
                "params": {
                    "name": "snapback_fn_fn_liveitems",
                    "arguments": { "args": {} }
                }
            }),
            Some(&access_token),
            None,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(hidden_credentialed.status(), StatusCode::OK);
    let hidden_credentialed = response_json(hidden_credentialed).await;
    assert_eq!(hidden_credentialed["result"]["isError"], true);
    assert_eq!(
        hidden_credentialed["result"]["structuredContent"]["error"]["diagnostic"]["code"],
        "SNAPBACK_API_EXPOSURE_DENIED"
    );

    let lookup_client_id = client_id.clone();
    let integration_principal = with_snapback(&state.snapback, move |snapback| {
        let (principal, _, _) = snapback
            .remainder_auth_fixture()
            .oauth_registration_facts_for_test(&lookup_client_id)?;
        Ok::<_, SnapbackError>(principal)
    })
    .await
    .unwrap();
    let suspended_principal = integration_principal.clone();
    let suspension_at = state.auth_provider.as_ref().unwrap().now_ms();
    with_snapback(&state.snapback, move |snapback| {
        snapback.remainder_auth_fixture().set_integration_suspended(
            &suspended_principal,
            true,
            suspension_at,
        )
    })
    .await
    .unwrap();
    let suspended_call = router
        .clone()
        .oneshot(mcp_protocol_request(
            "POST",
            json!({
                "jsonrpc": "2.0",
                "id": 23,
                "method": "tools/call",
                "params": {
                    "name": "snapback_fn_fn_listitems",
                    "arguments": { "args": {} }
                }
            }),
            Some(&access_token),
            None,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(suspended_call.status(), StatusCode::OK);
    let suspended_call = response_json(suspended_call).await;
    assert_eq!(suspended_call["result"]["isError"], true);
    assert_eq!(
        suspended_call["result"]["structuredContent"]["error"]["diagnostic"]["code"],
        "SNAPBACK_API_INTEGRATION_SUSPENDED"
    );
    let resumed_principal = integration_principal;
    let resumed_at = state.auth_provider.as_ref().unwrap().now_ms();
    with_snapback(&state.snapback, move |snapback| {
        snapback.remainder_auth_fixture().set_integration_suspended(
            &resumed_principal,
            false,
            resumed_at,
        )
    })
    .await
    .unwrap();

    let opened = router
        .clone()
        .oneshot(connection_open_request(
            Some(&access_token),
            json!({
                "connectionId": "oauth-revoke-terminal-drain",
                "authInvalidationProtocol": 1,
            }),
        ))
        .await
        .expect("open OAuth service connection before revocation");
    assert_eq!(opened.status(), StatusCode::OK);
    let opened = response_json(opened).await;
    let connection_id = opened["connectionId"]
        .as_str()
        .expect("OAuth connection id");
    let service_publication = {
        let registry = state.connections.lock();
        let record = registry
            .grants
            .get(connection_id)
            .expect("OAuth connection grant");
        let BoundGrantAuthority::ServicePrincipal {
            service_publication,
            ..
        } = &record.authority
        else {
            panic!("OAuth token must retain a service publication")
        };
        service_publication.clone()
    };
    let (epoch_now_ms, monotonic_now) = super::auth_runtime_now(&state);
    let predecessor = service_publication
        .begin_authority_work(epoch_now_ms, monotonic_now)
        .expect("retain an OAuth predecessor before revocation");
    let revoke_router = router.clone();
    let revoke_token = access_token.clone();
    let revoked = tokio::spawn(async move {
        revoke_router
            .oneshot(oauth_protocol_request(
                "POST",
                "/auth/oauth/revoke",
                Some("application/x-www-form-urlencoded"),
                format!("token={revoke_token}&token_type_hint=access_token"),
                None,
            ))
            .await
            .expect("OAuth revoke response")
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if service_publication
                .resolve_act(epoch_now_ms, monotonic_now)
                .is_ok_and(|resolution| resolution == ServiceAuthorityActResolution::Unavailable)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("OAuth revoke must premark its exact live publication");
    assert!(
        !revoked.is_finished(),
        "OAuth revoke must drain the predecessor before its durable write"
    );
    drop(predecessor);
    let revoked = tokio::time::timeout(Duration::from_secs(5), revoked)
        .await
        .expect("OAuth revoke must finish after its predecessor drains")
        .expect("OAuth revoke task");
    assert_eq!(revoked.status(), StatusCode::OK);
    assert_eq!(
        service_publication
            .resolve_act(epoch_now_ms, monotonic_now)
            .expect("resolve committed OAuth terminal publication"),
        ServiceAuthorityActResolution::Terminal(ServiceAuthorityDisposition::Carrier),
        "OAuth revoke must publish its transaction-produced carrier terminal"
    );

    let refused = router
        .oneshot(oauth_protocol_request(
            "POST",
            "/api/v1/query/listItems",
            Some("application/json"),
            br#"{"args":{}}"#.to_vec(),
            Some(&access_token),
        ))
        .await
        .unwrap();
    assert_eq!(refused.status(), StatusCode::UNAUTHORIZED);
}

/// @ref LLP 0204#d8--authority-acquisition-the-ceremony-and-the-facade — OAuth consent is the ordinary grant approval surface, including its operation-bound step-up requirement.
#[tokio::test]
async fn oauth_authority_creating_consent_reuses_operation_bound_step_up() {
    let state = sessions_activation_server_fixture_with_oauth_async().await;
    let provider = state.auth_provider.clone().expect("OAuth auth provider");
    let router = app(state.clone());
    let registered = router
        .clone()
        .oneshot(oauth_protocol_request(
            "POST",
            "/auth/oauth/register",
            Some("application/json"),
            serde_json::to_vec(&json!({
                "redirect_uris": ["https://step-up.example/callback"],
                "client_name": "Step-up OAuth"
            }))
            .unwrap(),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(registered.status(), StatusCode::OK);
    let client_id = response_json(registered).await["client_id"]
        .as_str()
        .unwrap()
        .to_owned();

    let user = mint_test_credential(&state, "oauth-step-up@example.com").await;
    let bearer = user["token"].as_str().unwrap();
    let verifier = "s".repeat(43);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let authorize_uri = format!(
        "/auth/oauth/authorize?response_type=code&client_id={client_id}&redirect_uri=https%3A%2F%2Fstep-up.example%2Fcallback&scope=items.write&code_challenge={challenge}&code_challenge_method=S256"
    );
    let consent = router
        .clone()
        .oneshot(oauth_protocol_request(
            "GET",
            &authorize_uri,
            None,
            Body::empty(),
            Some(bearer),
        ))
        .await
        .unwrap();
    assert_eq!(consent.status(), StatusCode::OK);
    let consent = String::from_utf8(
        to_bytes(consent.into_body(), 64 * 1024)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(consent.contains("mutation fn:queuedWrite"));
    assert!(consent.contains("fresh authentication required"));
    let request_id = consent
        .split_once("name=request_id value=\"")
        .and_then(|(_, rest)| rest.split_once('\"'))
        .map(|(id, _)| id.to_owned())
        .expect("authority-creating consent carries its request id");

    let missing = router
        .clone()
        .oneshot(oauth_protocol_request(
            "POST",
            "/auth/oauth/authorize",
            Some("application/x-www-form-urlencoded"),
            format!("request_id={request_id}&decision=approve"),
            Some(bearer),
        ))
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);
    let missing = response_json(missing).await;
    assert_eq!(missing["error"], "access_denied");
    assert_eq!(missing["details"]["code"], "SNAPBACK_AUTH_STEP_UP_REQUIRED");

    let step_up = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/step-up/request",
            serde_json::to_vec(&json!({
                "operation": "grantApproval",
                "requestId": request_id,
            }))
            .unwrap(),
            bearer,
        ))
        .await
        .unwrap();
    assert_eq!(step_up.status(), StatusCode::OK);
    let challenge_id = response_json(step_up).await["challengeId"]
        .as_str()
        .unwrap()
        .to_owned();
    let mailbox =
        serde_json::to_value(provider.mailbox_entry(&challenge_id).await.unwrap()).unwrap();
    let code = mailbox["code"].as_str().unwrap();
    let approved = router
        .oneshot(oauth_protocol_request(
            "POST",
            "/auth/oauth/authorize",
            Some("application/x-www-form-urlencoded"),
            format!(
                "request_id={request_id}&decision=approve&challenge_id={challenge_id}&code={code}"
            ),
            Some(bearer),
        ))
        .await
        .unwrap();
    assert_eq!(approved.status(), StatusCode::FOUND);
    assert!(
        approved.headers()[header::LOCATION]
            .to_str()
            .unwrap()
            .contains("code=sboac_")
    );
}

#[tokio::test]
async fn external_api_v1_is_opt_in_unpinned_disclosed_and_exact_origin_cors() {
    let mut functions = activation_functions('2', false);
    for function in &mut functions.functions {
        function.api_exposure = Some(ApiFunctionExposure::default());
    }
    functions
        .functions
        .iter_mut()
        .find(|function| function.name == "listItems")
        .unwrap()
        .api_exposure = Some(ApiFunctionExposure {
        expose: true,
        since: Some("v1".to_owned()),
        approval: None,
    });
    let api = ApiManifest {
        enabled: true,
        disclosure: ApiDisclosure::ExposedOnly,
        functions: BTreeMap::from([(
            "listItems".to_owned(),
            ApiFunctionExposure {
                expose: true,
                since: Some("v1".to_owned()),
                approval: None,
            },
        )]),
        origins: Some(vec!["https://integration.example:8443".to_owned()]),
        oauth: None,
        ask: None,
        budgets: None,
    };
    let state = tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        sessions_activation_server_fixture_with_api(
            functions,
            None,
            Some(AgentsManifest::explicit(
                AgentsMode::Disabled,
                InvitedBy::Operators,
            )),
            Some(api),
        )
    })
    .await
    .unwrap();
    let runtime = state.clone();
    let router = app(state);

    let exposed = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/query/listItems")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-auth-client-protocol", "1")
                .header(header::ORIGIN, "https://integration.example:8443")
                .body(Body::from(r#"{"args":{}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(exposed.status(), StatusCode::OK);
    assert_eq!(
        exposed.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
        "https://integration.example:8443"
    );
    assert_eq!(exposed.headers()[header::VARY], "Origin");
    assert!(
        exposed.headers()[header::ACCESS_CONTROL_EXPOSE_HEADERS]
            .to_str()
            .unwrap()
            .split(',')
            .any(|name| name.trim() == super::SNAPBACK_CLIENT_ID_STATUS_HEADER)
    );
    assert!(
        exposed
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_CREDENTIALS)
            .is_none()
    );

    let declared = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/query/listItems")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-auth-client-protocol", "1")
                .header(
                    super::SNAPBACK_CLIENT_ID_HEADER,
                    "crawler-7f3a9c/ops@example.com",
                )
                .body(Body::from(r#"{"args":{}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(declared.status(), StatusCode::OK);
    assert_eq!(
        declared.headers()[super::SNAPBACK_CLIENT_ID_STATUS_HEADER],
        "accepted"
    );
    let declared_id = "crawler-7f3a9c/ops@example.com".to_owned();
    let declared_record = with_snapback(&runtime.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .declared_client_for_admission(&declared_id, super::now_millis())
    })
    .await
    .unwrap()
    .expect("accepted declaration creates its bounded attribution row");
    assert_eq!(declared_record.request_count, 1);

    let declared_caller_key = super::declared_client_caller_key(&declared_record.normalized_id);
    let first_party = mint_test_credential(&runtime, "first-party-api@example.test").await;
    let first_party = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/query/listItems")
                .header(header::CONTENT_TYPE, "application/json")
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", first_party["token"].as_str().unwrap()),
                )
                .header("x-snapback-auth-client-protocol", "1")
                .body(Body::from(r#"{"args":{}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first_party.status(), StatusCode::OK);

    let caller_stats = runtime
        .telemetry
        .query_stats(&crate::telemetry_query::TelemetryStatsRequestV1 {
            filter: crate::telemetry_query::TelemetryStatsFilterV1 {
                kind: Some("function_run".to_owned()),
                name: Some("listItems".to_owned()),
                ..Default::default()
            },
            group_by_caller: true,
        })
        .unwrap();
    for (lane, caller_key) in [
        ("anonymous", "anonymous"),
        ("declared", declared_caller_key.as_str()),
        ("first-party", ""),
    ] {
        assert!(
            caller_stats
                .caller_counts
                .iter()
                .any(|row| row.lane == lane && row.caller_key == caller_key && row.count >= 1),
            "missing {lane} caller attribution: {:?}",
            caller_stats.caller_counts
        );
    }
    let stats_endpoint = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/_snapback/api/telemetry/stats?kind=function_run&callerKey={declared_caller_key}&lane=declared&groupByCaller=true"
                ))
                .header("x-snapback-admin-token", "auth-http-admin")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stats_endpoint.status(), StatusCode::OK);
    let stats_endpoint = response_json(stats_endpoint).await;
    assert_eq!(stats_endpoint["callerCounts"][0]["lane"], "declared");
    assert_eq!(
        stats_endpoint["callerCounts"][0]["callerKey"],
        declared_caller_key
    );
    let telemetry_rows = runtime
        .telemetry
        .query_events(&crate::telemetry_query::TelemetryEventsRequestV1 {
            filter: crate::telemetry_query::TelemetryFilterV1 {
                kind: Some("function_run".to_owned()),
                name: Some("listItems".to_owned()),
                ..Default::default()
            },
            limit: crate::telemetry_query::MAX_EVENT_LIMIT,
            ..Default::default()
        })
        .unwrap();
    assert!(
        !serde_json::to_string(&telemetry_rows)
            .unwrap()
            .contains("crawler-7f3a9c/ops@example.com")
    );

    let declared_listing = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/_snapback/api/auth/declared-clients")
                .header("x-snapback-admin-token", "auth-http-admin")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(declared_listing.status(), StatusCode::OK);
    let declared_listing = response_json(declared_listing).await;
    let declared_listing = declared_listing["declaredClients"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["normalizedId"].as_str() == Some(declared_record.normalized_id.as_str()))
        .unwrap();
    assert_eq!(declared_listing["callerKey"], declared_caller_key);
    assert!(declared_listing["recentUsage"]["count"].as_u64().unwrap() >= 1);

    let suspended_id = declared_record.normalized_id.clone();
    with_snapback(&runtime.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .set_declared_client_status(
                &suspended_id,
                crate::storage::declared_clients::DeclaredClientStatus::Suspended,
            )
    })
    .await
    .unwrap();
    let suspended = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/query/listItems")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-auth-client-protocol", "1")
                .header(
                    super::SNAPBACK_CLIENT_ID_HEADER,
                    "crawler-7f3a9c/ops@example.com",
                )
                .body(Body::from(r#"{"args":{}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(suspended.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        suspended.headers()[super::SNAPBACK_CLIENT_ID_STATUS_HEADER],
        "suspended"
    );
    let suspended = response_json(suspended).await;
    assert_eq!(
        suspended["diagnostic"]["code"],
        "SNAPBACK_API_DECLARED_CLIENT_SUSPENDED"
    );
    assert!(
        suspended["diagnostic"]["message"]
            .as_str()
            .unwrap()
            .contains("suspended")
    );
    assert!(
        !suspended["diagnostic"]["message"]
            .as_str()
            .unwrap()
            .contains("revoked")
    );
    let resumed_id = declared_record.normalized_id;
    with_snapback(&runtime.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .set_declared_client_status(
                &resumed_id,
                crate::storage::declared_clients::DeclaredClientStatus::Active,
            )
    })
    .await
    .unwrap();

    for ordinal in 0..(super::EXTERNAL_API_DECLARED_CREATION_LIMIT - 1) {
        let id = format!("crawler-{ordinal:02}/ops{ordinal:02}@example.test");
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/query/listItems")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-snapback-auth-client-protocol", "1")
                    .header(super::SNAPBACK_CLIENT_ID_HEADER, id)
                    .body(Body::from(r#"{"args":{}}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[super::SNAPBACK_CLIENT_ID_STATUS_HEADER],
            "accepted"
        );
    }
    let blocked_id = "crawler-blocked/ops-blocked@example.test";
    let blocked_creation = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/query/listItems")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-auth-client-protocol", "1")
                .header(super::SNAPBACK_CLIENT_ID_HEADER, blocked_id)
                .body(Body::from(r#"{"args":{}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(blocked_creation.status(), StatusCode::OK);
    assert_eq!(
        blocked_creation.headers()[super::SNAPBACK_CLIENT_ID_STATUS_HEADER],
        "ignored-creation-throttled"
    );
    let blocked_id = blocked_id.to_owned();
    let blocked_row = with_snapback(&runtime.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .declared_client_for_admission(&blocked_id, super::now_millis())
    })
    .await
    .unwrap();
    assert!(
        blocked_row.is_none(),
        "a rejected creation does not allocate or refresh a row"
    );

    let malformed_declaration = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/query/listItems")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-auth-client-protocol", "1")
                .header(super::SNAPBACK_CLIENT_ID_HEADER, "not-an-email-declaration")
                .body(Body::from(r#"{"args":{}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(malformed_declaration.status(), StatusCode::OK);
    assert_eq!(
        malformed_declaration.headers()[super::SNAPBACK_CLIENT_ID_STATUS_HEADER],
        "ignored-no-email"
    );

    let bare_unexposed = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/query/liveItems")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-auth-client-protocol", "1")
                .header(
                    super::SNAPBACK_CLIENT_ID_HEADER,
                    "crawler-first-party/ops@example.com",
                )
                .body(Body::from(r#"{"args":{}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bare_unexposed.status(), StatusCode::OK);
    assert!(
        bare_unexposed
            .headers()
            .get(super::SNAPBACK_CLIENT_ID_STATUS_HEADER)
            .is_none(),
        "first-party app-data routes ignore the external declaration carrier"
    );

    let external_unexposed = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/query/liveItems")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-auth-client-protocol", "1")
                .body(Body::from(r#"{"args":{}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(external_unexposed.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(external_unexposed).await["diagnostic"]["code"],
        "SNAPBACK_API_EXPOSURE_DENIED"
    );

    let pinned = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/query/listItems")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-auth-client-protocol", "1")
                .body(Body::from(format!(
                    r#"{{"args":{{}},"expectedGeneration":{{"schemaVersion":"snapback.v1","appId":"auth-activation-fixture","schemaHash":"{SCHEMA_V1_PREFIX}{}","bundleHash":"{FUNCTION_V1_PREFIX}{}","inputsHash":"{INPUTS_V1_PREFIX}{}"}}}}"#,
                    "1".repeat(64),
                    "2".repeat(64),
                    "3".repeat(64),
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(pinned.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(pinned).await["diagnostic"]["code"],
        "SNAPBACK_API_GENERATION_PIN_UNSUPPORTED"
    );

    let inspect = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/inspect")
                .header("x-snapback-auth-client-protocol", "1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let inspect = response_json(inspect).await;
    assert_eq!(
        inspect["functions"]["functions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|function| function["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["listItems"]
    );

    let undeclared_origin = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/query/listItems")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-auth-client-protocol", "1")
                .header(header::ORIGIN, "https://other.example")
                .body(Body::from(r#"{"args":{}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        undeclared_origin
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none()
    );

    let preflight = router
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/api/v1/query/listItems")
                .header(header::ORIGIN, "https://integration.example:8443")
                .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(preflight.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        preflight.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
        "https://integration.example:8443"
    );
    assert!(
        preflight.headers()[header::ACCESS_CONTROL_ALLOW_HEADERS]
            .to_str()
            .unwrap()
            .split(',')
            .any(|name| name.trim() == super::SNAPBACK_CLIENT_ID_HEADER)
    );

    let mut full_functions = activation_functions('3', false);
    for function in &mut full_functions.functions {
        function.api_exposure = Some(ApiFunctionExposure::default());
    }
    full_functions
        .functions
        .iter_mut()
        .find(|function| function.name == "listItems")
        .unwrap()
        .api_exposure = Some(ApiFunctionExposure {
        expose: true,
        since: None,
        approval: None,
    });
    let full_api = ApiManifest {
        enabled: true,
        disclosure: ApiDisclosure::Full,
        functions: BTreeMap::from([(
            "listItems".to_owned(),
            ApiFunctionExposure {
                expose: true,
                since: None,
                approval: None,
            },
        )]),
        origins: None,
        oauth: None,
        ask: None,
        budgets: None,
    };
    let full_state = tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        sessions_activation_server_fixture_with_api(
            full_functions,
            None,
            Some(AgentsManifest::explicit(
                AgentsMode::Disabled,
                InvitedBy::Operators,
            )),
            Some(full_api),
        )
    })
    .await
    .unwrap();
    let full_inspect = app(full_state)
        .oneshot(
            Request::builder()
                .uri("/inspect")
                .header("x-snapback-auth-client-protocol", "1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let full_inspect = response_json(full_inspect).await;
    let full_names = full_inspect["functions"]["functions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|function| function["name"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert!(full_names.contains(&"listItems"));
    assert!(full_names.contains(&"liveItems"));
}

#[tokio::test]
#[allow(clippy::await_holding_lock)] // Serializes process-global egress environment for this whole async fixture.
async fn external_ask_is_granted_read_only_receipted_stream_settled_and_mcp_mirrored() {
    let _environment_lock = ASK_EGRESS_ENV_TEST_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .unwrap();
    let _environment_restore = AskEgressEnvRestore(std::env::var_os("SNAPBACK_OUTBOUND_ACTIONS"));
    unsafe { std::env::set_var("SNAPBACK_OUTBOUND_ACTIONS", "1") };

    let query_call = json!({
        "choices": [{ "message": {
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "call-query",
                "type": "function",
                "function": {
                    "name": "snapback_fn_fn_listitems",
                    "arguments": "{}"
                }
            }]
        } }],
        "usage": { "prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5 }
    });
    let final_call = |id: &str, answer: &str| {
        json!({
            "choices": [{ "message": {
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": id,
                    "type": "function",
                    "function": {
                        "name": crate::ask::FINAL_TOOL_NAME,
                        "arguments": serde_json::to_string(&json!({ "answer": answer })).unwrap()
                    }
                }]
            } }],
            "usage": { "prompt_tokens": 4, "completion_tokens": 2, "total_tokens": 6 }
        })
    };
    let (provider_base, captured, provider_task) = ask_provider_stub(vec![
        query_call,
        final_call("call-final", "summarized"),
        final_call("call-mcp-final", "mcp summarized"),
        json!({
            "choices": [{ "message": {
                "role": "assistant", "content": null,
                "tool_calls": [{
                    "id": "call-schema-invalid", "type": "function",
                    "function": {
                        "name": crate::ask::FINAL_TOOL_NAME,
                        "arguments": "{\"wrong\":true}"
                    }
                }]
            } }],
            "usage": { "prompt_tokens": 2, "completion_tokens": 2, "total_tokens": 4 }
        }),
        json!({
            "choices": [{ "message": {
                "role": "assistant", "content": null,
                "tool_calls": [{
                    "id": "call-schema-valid", "type": "function",
                    "function": {
                        "name": crate::ask::FINAL_TOOL_NAME,
                        "arguments": "{\"summary\":\"schema summarized\"}"
                    }
                }]
            } }],
            "usage": { "prompt_tokens": 2, "completion_tokens": 2, "total_tokens": 4 }
        }),
        json!({ "providerEcho": "redaction-sentinel-provider-key" }),
    ])
    .await;
    let expected_provider_identity = format!("openai-compatible:{provider_base}");
    let anonymous_state =
        sessions_activation_server_fixture_with_ask_async(provider_base.clone(), 64 * 1024).await;
    let anonymous = app(anonymous_state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/ask")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-auth-client-protocol", "1")
                .header(crate::ask::PROVIDER_KEY_HEADER, "anonymous-secret")
                .body(Body::from(r#"{"task":"read data","stream":false}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let anonymous_status = anonymous.status();
    let anonymous_body = response_json(anonymous).await;
    assert_eq!(anonymous_status, StatusCode::FORBIDDEN, "{anonymous_body}");
    assert_eq!(
        anonymous_body["diagnostic"]["code"],
        "SNAPBACK_API_ASK_AUTHORITY_REQUIRED"
    );

    let declared_state =
        sessions_activation_server_fixture_with_ask_async(provider_base.clone(), 64 * 1024).await;
    let declared = app(declared_state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/ask")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-auth-client-protocol", "1")
                .header(
                    super::SNAPBACK_CLIENT_ID_HEADER,
                    "ask-crawler/ops@example.test",
                )
                .header(crate::ask::PROVIDER_KEY_HEADER, "declared-secret")
                .body(Body::from(r#"{"task":"read data","stream":false}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(declared.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(declared).await["diagnostic"]["code"],
        "SNAPBACK_API_ASK_AUTHORITY_REQUIRED"
    );

    let state = sessions_activation_server_fixture_with_ask_async(provider_base, 64 * 1024).await;
    let credential = mint_test_credential(&state, "ask-reader@example.test").await;
    let bearer = credential["token"].as_str().unwrap().to_owned();
    let router = app(state.clone());

    let mut request = session_auth_http_request(
        "/api/v1/ask",
        serde_json::to_vec(&json!({ "task": "summarize items" })).unwrap(),
        &bearer,
    );
    request.headers_mut().insert(
        HeaderName::from_static(crate::ask::PROVIDER_KEY_HEADER),
        HeaderValue::from_static("caller-provider-secret"),
    );
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let response = response_json(response).await;
    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(response["result"], "summarized");
    assert_eq!(response["stream"], true);
    assert_eq!(response["provider"], expected_provider_identity);
    assert_eq!(response["model"], "stub-model");
    assert_eq!(response["tokenAccounting"]["totalTokens"], 11);
    assert_eq!(
        response["provenanceNotProof"]["calls"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(
        response["provenanceNotProof"]["calls"][0]["argsDigest"]
            .as_str()
            .unwrap()
            .starts_with("hmac-sha256:")
    );
    let attempt_token = response["attemptToken"].as_str().unwrap();
    let transcript = router
        .clone()
        .oneshot(session_auth_get_request(
            &format!("/streams/{attempt_token}"),
            &bearer,
        ))
        .await
        .unwrap();
    assert_eq!(transcript.status(), StatusCode::OK);
    let transcript = response_json(transcript).await;
    assert_eq!(transcript["terminalCause"], "complete");
    assert!(
        transcript["finalText"]
            .as_str()
            .unwrap()
            .contains("provenanceNotProof")
    );

    let first_provider_request = captured.lock().unwrap()[0].clone();
    let tool_names = first_provider_request["tools"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str))
        .collect::<BTreeSet<_>>();
    assert!(tool_names.contains("snapback_fn_fn_listitems"));
    assert!(tool_names.contains(crate::ask::FINAL_TOOL_NAME));
    assert!(!tool_names.iter().any(|name| name.contains("queuedwrite")));

    let listed = router
        .clone()
        .oneshot(mcp_protocol_request(
            "POST",
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
            Some(&bearer),
            None,
            None,
        ))
        .await
        .unwrap();
    assert!(
        response_json(listed).await["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == "ask")
    );
    let mut mcp = mcp_protocol_request(
        "POST",
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": { "name": "ask", "arguments": { "task": "summarize over MCP" } }
        }),
        Some(&bearer),
        None,
        None,
    );
    mcp.headers_mut().insert(
        HeaderName::from_static(crate::ask::PROVIDER_KEY_HEADER),
        HeaderValue::from_static("mcp-provider-secret"),
    );
    let mcp = router.oneshot(mcp).await.unwrap();
    let mcp = response_json(mcp).await;
    assert_eq!(mcp["result"]["isError"], false);
    assert_eq!(
        mcp["result"]["structuredContent"]["result"],
        "mcp summarized"
    );
    assert_eq!(mcp["result"]["structuredContent"]["stream"], false);

    let mut schema_request = session_auth_http_request(
        "/api/v1/ask",
        serde_json::to_vec(&json!({
            "task": "return structured summary",
            "resultSchema": {
                "type": "object",
                "required": ["summary"],
                "properties": { "summary": { "type": "string" } },
                "additionalProperties": false
            },
            "stream": false
        }))
        .unwrap(),
        &bearer,
    );
    schema_request.headers_mut().insert(
        HeaderName::from_static(crate::ask::PROVIDER_KEY_HEADER),
        HeaderValue::from_static("schema-provider-secret"),
    );
    let schema_response = app(state.clone()).oneshot(schema_request).await.unwrap();
    assert_eq!(schema_response.status(), StatusCode::OK);
    assert_eq!(
        response_json(schema_response).await["result"]["summary"],
        "schema summarized"
    );

    let mut redaction_request = session_auth_http_request(
        "/api/v1/ask",
        serde_json::to_vec(&json!({ "task": "provider failure", "stream": false })).unwrap(),
        &bearer,
    );
    redaction_request.headers_mut().insert(
        HeaderName::from_static(crate::ask::PROVIDER_KEY_HEADER),
        HeaderValue::from_static("redaction-sentinel-provider-key"),
    );
    let redaction_response = app(state.clone()).oneshot(redaction_request).await.unwrap();
    assert_eq!(redaction_response.status(), StatusCode::BAD_GATEWAY);
    let redaction_body = response_json(redaction_response).await;
    assert_eq!(
        redaction_body["diagnostic"]["code"],
        "SNAPBACK_API_ASK_UPSTREAM_INVALID"
    );
    assert!(
        !serde_json::to_string(&redaction_body)
            .unwrap()
            .contains("redaction-sentinel-provider-key")
    );
    let telemetry = state
        .telemetry
        .query_events(&crate::telemetry_query::TelemetryEventsRequestV1 {
            filter: Default::default(),
            limit: crate::telemetry_query::MAX_EVENT_LIMIT,
            ..Default::default()
        })
        .unwrap();
    assert!(
        !serde_json::to_string(&telemetry)
            .unwrap()
            .contains("redaction-sentinel-provider-key")
    );
    provider_task.await.unwrap();

    let volume_call = json!({
        "choices": [{ "message": {
            "role": "assistant", "content": null,
            "tool_calls": [{
                "id": "call-volume", "type": "function",
                "function": { "name": "snapback_fn_fn_listitems", "arguments": "{}" }
            }]
        } }],
        "usage": { "prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2 }
    });
    let (volume_base, _, volume_task) = ask_provider_stub(vec![volume_call]).await;
    let volume_state = sessions_activation_server_fixture_with_ask_async(volume_base, 1).await;
    let volume_credential = mint_test_credential(&volume_state, "ask-volume@example.test").await;
    let mut volume_request = session_auth_http_request(
        "/api/v1/ask",
        serde_json::to_vec(&json!({ "task": "read too much", "stream": false })).unwrap(),
        volume_credential["token"].as_str().unwrap(),
    );
    volume_request.headers_mut().insert(
        HeaderName::from_static(crate::ask::PROVIDER_KEY_HEADER),
        HeaderValue::from_static("volume-provider-secret"),
    );
    let volume_response = app(volume_state).oneshot(volume_request).await.unwrap();
    assert_eq!(volume_response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        response_json(volume_response).await["diagnostic"]["code"],
        "SNAPBACK_API_ASK_RESULT_VOLUME_EXHAUSTED"
    );
    volume_task.await.unwrap();
}

#[tokio::test]
async fn external_api_v1_refuses_when_the_app_did_not_enable_it() {
    let state = sessions_activation_server_fixture_async().await;
    let response = app(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/query/listItems")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-auth-client-protocol", "1")
                .header(
                    super::SNAPBACK_CLIENT_ID_HEADER,
                    "crawler-disabled/ops@example.test",
                )
                .body(Body::from(r#"{"args":{}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response.headers()[super::SNAPBACK_CLIENT_ID_STATUS_HEADER],
        "ignored-api-disabled"
    );
    assert_eq!(
        response_json(response).await["diagnostic"]["code"],
        "SNAPBACK_API_NOT_ENABLED"
    );
}

#[tokio::test]
async fn external_run_refusal_order_is_surface_shape_digest_then_capability() {
    let request = |body: Vec<u8>| {
        Request::builder()
            .method("POST")
            .uri("/api/v1/run")
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-snapback-auth-client-protocol", "1")
            .body(Body::from(body))
            .unwrap()
    };

    let disabled = app(sessions_activation_server_fixture_async().await)
        .oneshot(request(br#"{"#.to_vec()))
        .await
        .unwrap();
    assert_eq!(disabled.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(disabled).await["diagnostic"]["code"],
        "SNAPBACK_API_NOT_ENABLED"
    );

    let state = sessions_activation_server_fixture_with_integrations_async().await;
    let current_digest = with_snapback(&state.snapback, |snapback| {
        snapback.current_app_api_envelope()
    })
    .await
    .unwrap()
    .0;
    let router = app(state);

    let malformed = router
        .clone()
        .oneshot(request(serde_json::to_vec(&json!({})).unwrap()))
        .await
        .unwrap();
    assert_eq!(malformed.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(malformed).await["diagnostic"]["code"],
        "SNAPBACK_REQUEST_JSON_INVALID"
    );

    let oversized = router
        .clone()
        .oneshot(request(
            serde_json::to_vec(&json!({
                "program": "x".repeat(super::RUN_PROGRAM_MAX_BYTES + 1),
                "envelopeDigest": "stale-on-purpose",
                "args": {}
            }))
            .unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(oversized.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(
        response_json(oversized).await["diagnostic"]["code"],
        "SNAPBACK_API_RUN_PROGRAM_TOO_LARGE"
    );

    let stale = router
        .clone()
        .oneshot(request(
            serde_json::to_vec(&json!({
                "program": "return null",
                "envelopeDigest": "stale-on-purpose",
                "args": {}
            }))
            .unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    let stale = response_json(stale).await;
    assert_eq!(
        stale["diagnostic"]["code"],
        "SNAPBACK_API_RUN_ENVELOPE_STALE"
    );
    assert_eq!(
        stale["diagnostic"]["details"]["currentEnvelopeDigest"],
        current_digest
    );

    let unsupported = router
        .oneshot(request(
            serde_json::to_vec(&json!({
                "program": "return null",
                "envelopeDigest": current_digest,
                "args": { "question": "kept opaque until execution exists" }
            }))
            .unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(unsupported.status(), StatusCode::NOT_IMPLEMENTED);
    let unsupported = response_json(unsupported).await;
    assert_eq!(
        unsupported["diagnostic"]["code"],
        "SNAPBACK_API_RUN_UNTRUSTED_CODE_UNSUPPORTED"
    );
    assert_eq!(unsupported["diagnostic"]["details"]["gapDeclared"], true);
}
