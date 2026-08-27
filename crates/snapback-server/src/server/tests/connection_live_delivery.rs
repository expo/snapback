// Complete test items included at `server::tests` module scope.

#[tokio::test]
async fn live_scheduler_defers_turn_until_visible_writer_releases() {
    let coalescer = Arc::new(crate::live_coalesce::LiveFanoutCoalescer::with_tunables(
        crate::live_coalesce::LiveCoalesceTunables {
            max_hold: Duration::from_secs(4),
            ..crate::live_coalesce::LiveCoalesceTunables::default()
        },
    ));
    let writer = coalescer.writer_turn_guard();
    let deferred = tokio::spawn({
        let coalescer = coalescer.clone();
        async move { super::defer_live_evaluation_for_writers(&coalescer).await }
    });

    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(
        !deferred.is_finished(),
        "the scheduler must not enter its lock turn while a writer is visible"
    );
    drop(writer);
    tokio::time::timeout(Duration::from_millis(200), deferred)
        .await
        .expect("writer release wakes the deferred scheduler")
        .expect("scheduler deferral task joins");
    assert_eq!(coalescer.writers_waiting(), 0);
}

#[tokio::test]
async fn live_scheduler_writer_deferral_is_capped_at_max_hold_quarter() {
    let coalescer = Arc::new(crate::live_coalesce::LiveFanoutCoalescer::with_tunables(
        crate::live_coalesce::LiveCoalesceTunables {
            max_hold: Duration::from_millis(80),
            ..crate::live_coalesce::LiveCoalesceTunables::default()
        },
    ));
    let writer = coalescer.writer_turn_guard();
    tokio::time::timeout(
        Duration::from_secs(1),
        super::defer_live_evaluation_for_writers(&coalescer),
    )
    .await
    .expect("the max_hold / 4 cap releases the scheduler turn");
    assert_eq!(
        coalescer.writers_waiting(),
        1,
        "cap expiry, not writer release, ended the deferral"
    );
    drop(writer);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn staged_authorization_writer_gate_drains_after_completion_refusal_and_panic() {
    let state = Arc::new(Mutex::new(
        LocalSnapback::memory().expect("writer-gate fixture"),
    ));
    let coalescer = Arc::new(crate::live_coalesce::LiveFanoutCoalescer::new());

    let fast_stage_gate = coalescer.clone();
    let fast_commit_gate = coalescer.clone();
    let completed = with_snapback_staged_authorization_write(
        &state,
        Some(coalescer.clone()),
        move |_| {
            assert_eq!(fast_stage_gate.writers_waiting(), 1);
            Ok((
                crate::storage::AuthorizationCommitPreflight::NoAuthorizationEvent,
                (),
            ))
        },
        move |_, ()| {
            assert_eq!(fast_commit_gate.writers_waiting(), 1);
            3_u8
        },
    )
    .await
    .expect("single-turn staged write completes");
    assert_eq!(completed, 3);
    assert_eq!(coalescer.writers_waiting(), 0);

    let stage_gate = coalescer.clone();
    let commit_gate = coalescer.clone();
    let completed = with_snapback_staged_authorization_write(
        &state,
        Some(coalescer.clone()),
        move |_| {
            assert_eq!(stage_gate.writers_waiting(), 1);
            Ok((
                crate::storage::AuthorizationCommitPreflight::AllProtectedRooms,
                (),
            ))
        },
        move |_, ()| {
            assert_eq!(
                commit_gate.writers_waiting(),
                1,
                "the split path retains writer visibility through its second lock turn"
            );
            7_u8
        },
    )
    .await
    .expect("split staged write completes");
    assert_eq!(completed, 7);
    assert_eq!(coalescer.writers_waiting(), 0);

    let refusal_gate = coalescer.clone();
    let refused = with_snapback_staged_authorization_write(
        &state,
        Some(coalescer.clone()),
        move |_| -> crate::diagnostic::SnapbackResult<(
            crate::storage::AuthorizationCommitPreflight,
            (),
        )> {
            assert_eq!(refusal_gate.writers_waiting(), 1);
            Err(SnapbackError::error(
                "SNAPBACK_AUTH_RESERVATION_STALE",
                "auth",
                "writer-gate refusal",
            ))
        },
        |_, ()| (),
    )
    .await
    .expect_err("staging refusal propagates");
    assert_eq!(refused.diagnostic.code, "SNAPBACK_AUTH_RESERVATION_STALE");
    assert_eq!(coalescer.writers_waiting(), 0);

    let panic_state = state.clone();
    let panic_coalescer = coalescer.clone();
    let panic_gate = coalescer.clone();
    let panicked = tokio::spawn(async move {
        with_snapback_staged_authorization_write::<(), (), _, _>(
            &panic_state,
            Some(panic_coalescer),
            move |_| -> crate::diagnostic::SnapbackResult<(
                crate::storage::AuthorizationCommitPreflight,
                (),
            )> {
                assert_eq!(panic_gate.writers_waiting(), 1);
                panic!("writer-gate unwind proof");
            },
            |_, ()| (),
        )
        .await
    })
    .await
    .expect_err("the staged panic reaches the caller task");
    assert!(panicked.is_panic());
    assert_eq!(coalescer.writers_waiting(), 0);
}

/// A fresh serving database intentionally keeps its room-authority participant
/// dormant until an invalidation issuer is installed. Ordinary dev setup must
/// therefore preserve the former disabled-interlock behavior while the exact
/// registry is `ParticipantBound`; it is neither replacement nor retirement.
///
/// @ref LLP 0290#step-8--switch-production-composition-and-transactions — native
/// reservations begin only after auth-time activation.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dormant_serving_schema_load_does_not_report_registry_retirement() {
    let mut context = ServerContext::detached();
    context.profile = ServerProfile::Test;
    context.admin_token = Some("dormant-serving-admin".to_owned());
    let state = test_app_state_from_snapback(
        LocalSnapback::memory().expect("dormant serving database"),
        context,
    );
    let manifest = SchemaManifest {
        app_id: "dormant-serving-regression".to_owned(),
        schema_hash: Some("dormant-serving-schema".to_owned()),
        tables: vec![TableManifest {
            name: "todos".to_owned(),
            fields: vec![FieldManifest {
                name: "title".to_owned(),
                field_type: FieldType::String,
                optional: false,
            }],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: Some(crate::manifest::TableVisibilityV1::PublicRead),
            history: None,
        }],
        ..SchemaManifest::default()
    };

    let response = app(state.clone())
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/schema/load",
            serde_json::to_vec(&manifest).expect("serialize dormant serving schema"),
            true,
            Some("dormant-serving-admin"),
            None,
        ))
        .await
        .expect("schema-load serving response");

    let status = response.status();
    let response = response_json(response).await;
    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(response["diagnostics"], json!([]));
    assert_eq!(
        with_snapback(&state.snapback, |snapback| snapback.loaded_schema_hash()).await,
        Some("dormant-serving-schema".to_owned()),
    );
}

#[test]
fn authority_preparation_writer_priority_is_limited_to_mutation_writers() {
    let mutation_sources = InvocationSource::ALL
        .into_iter()
        .filter(|source| super::mutation_writer_invocation_source(*source))
        .collect::<Vec<_>>();
    assert_eq!(
        mutation_sources,
        vec![
            InvocationSource::HttpMutation,
            InvocationSource::LocalMutation,
            InvocationSource::AssetCallback,
            InvocationSource::NestedMutation,
        ]
    );
    assert!(!super::mutation_writer_invocation_source(
        InvocationSource::HttpQuery
    ));
    assert!(!super::mutation_writer_invocation_source(
        InvocationSource::LiveInitialQuery
    ));
    assert!(!super::mutation_writer_invocation_source(
        InvocationSource::HostOperationMutationDryRun
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn authorization_neutral_staged_write_commits_before_its_shared_batch_flushes() {
    let state = tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        auth_projection_http_fixture("neutral-stage-turn", 0, 0)
    })
    .await
    .expect("construct authorization-neutral fixture");
    let after_batch_runs = Arc::new(AtomicUsize::new(0));
    let stage_after_batch_runs = Arc::clone(&after_batch_runs);
    let work_after_batch_runs = Arc::clone(&after_batch_runs);
    let seed = SeedData {
        tables: BTreeMap::from([(
            "items".to_owned(),
            vec![Map::from_iter([
                (
                    "_id".to_owned(),
                    json!("0198a2aa-32b0-7000-8000-000000000001"),
                ),
                ("value".to_owned(), json!("single-turn")),
            ])],
        )]),
    };

    let committed = with_snapback_staged_authorization_write(
        &state.snapback,
        None,
        move |snapback| {
            let preflight = snapback_engine::test_support::authorization_commit_preflight_for_seed(
                snapback, &seed,
            )?;
            assert!(matches!(
                preflight,
                crate::storage::AuthorizationCommitPreflight::NoAuthorizationEvent
            ));
            let stage_after_batch_runs = Arc::clone(&stage_after_batch_runs);
            crate::exec_guard::run_or_defer_after_local(move || {
                stage_after_batch_runs.fetch_add(1, Ordering::SeqCst);
            });
            Ok((preflight, seed.clone()))
        },
        move |snapback, seed| {
            assert_eq!(
                work_after_batch_runs.load(Ordering::SeqCst),
                0,
                "the stage batch must remain deferred through the neutral commit"
            );
            snapback.seed(seed)
        },
    )
    .await
    .expect("authorization-neutral staging turn completes")
    .expect("authorization-neutral seed commits");

    assert_eq!(committed.changed_count, 1);
    assert_eq!(
        after_batch_runs.load(Ordering::SeqCst),
        1,
        "the combined stage/commit batch flushes exactly once after Local drops"
    );
    let rows = with_snapback(&state.snapback, |snapback| {
        snapback.scan_table("items", 10, 0).map(|scan| scan.total)
    })
    .await
    .expect("scan the authorization-neutral commit");
    assert_eq!(rows, 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn authorization_neutral_stage_mispreview_still_fails_closed() {
    let (state, _directory) = tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        protected_room_server_fixture()
    })
    .await
    .expect("construct protected-room mispreview fixture");
    let before = with_snapback(&state.snapback, |snapback| {
        Ok::<_, SnapbackError>((
            snapback.authorization_reservation_snapshot()?,
            snapback
                .scan_table("roomMembers", 10, 0)
                .map(|scan| scan.total)?,
        ))
    })
    .await
    .expect("capture pre-mispreview state");
    let seed = SeedData {
        tables: BTreeMap::from([(
            "roomMembers".to_owned(),
            vec![Map::from_iter([
                (
                    "_id".to_owned(),
                    json!("0198a2aa-32b0-7000-8000-000000000002"),
                ),
                ("roomId".to_owned(), json!("mispreview-room")),
                ("userId".to_owned(), json!("mispreview-user")),
            ])],
        )]),
    };

    let error = with_snapback_staged_authorization_write(
        &state.snapback,
        None,
        move |_| {
            Ok((
                crate::storage::AuthorizationCommitPreflight::NoAuthorizationEvent,
                seed.clone(),
            ))
        },
        move |snapback, seed| snapback.seed(seed),
    )
    .await
    .expect("mispreview staging turn completes")
    .expect_err("authorization-producing neutral preview must roll back");
    assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_RESERVATION_STALE");

    let after = with_snapback(&state.snapback, |snapback| {
        Ok::<_, SnapbackError>((
            snapback.authorization_reservation_snapshot()?,
            snapback
                .scan_table("roomMembers", 10, 0)
                .map(|scan| scan.total)?,
        ))
    })
    .await
    .expect("capture post-mispreview state");
    assert_eq!(after, before, "mispreview commits no data or auth witness");
}

/// @ref LLP 0053#ephemeral-room-authority-invalidation — L9 requires an
/// unrelated protected room to register, publish, and drain over both HTTP
/// and WebSocket while an affected authorization commit is pending, with
/// no writer-mutex hop on the room path.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn protected_room_server_fast_paths_progress_during_affected_commit() {
    const AFFECTED_ROOM: &str = "room-affected";
    const UNRELATED_ROOM: &str = "room-unrelated";
    const UNRELATED_WS_ROOM: &str = "room-unrelated-ws";
    const AFFECTED_MEMBER: &str = "member-affected";

    let (state, _directory) = tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        protected_room_server_fixture()
    })
    .await
    .expect("construct protected-room fixture off the async workers");
    let credential = mint_test_credential(&state, "room-l9@example.com").await;
    let bearer = credential["token"]
        .as_str()
        .expect("fixture session bearer")
        .to_owned();
    let user_id = credential["session"]["userId"]
        .as_str()
        .expect("fixture user id")
        .to_owned();
    let seed = SeedData {
        tables: BTreeMap::from([(
            "roomMembers".to_owned(),
            vec![
                Map::from_iter([
                    ("_id".to_owned(), json!(AFFECTED_MEMBER)),
                    ("roomId".to_owned(), json!(AFFECTED_ROOM)),
                    ("userId".to_owned(), json!(user_id)),
                ]),
                Map::from_iter([
                    ("_id".to_owned(), json!("member-unrelated")),
                    ("roomId".to_owned(), json!(UNRELATED_ROOM)),
                    ("userId".to_owned(), json!(user_id)),
                ]),
                Map::from_iter([
                    ("_id".to_owned(), json!("member-unrelated-ws")),
                    ("roomId".to_owned(), json!(UNRELATED_WS_ROOM)),
                    ("userId".to_owned(), json!(user_id)),
                ]),
            ],
        )]),
    };
    with_snapback_staged_authorization_write(
        &state.snapback,
        None,
        move |snapback| {
            Ok((
                snapback_engine::test_support::authorization_commit_preflight_for_seed(
                    snapback, &seed,
                )?,
                seed.clone(),
            ))
        },
        move |snapback, seed| snapback.seed(seed),
    )
    .await
    .expect("reserve exact seed authorization impact")
    .expect("seed both room memberships");

    let router = app(state.clone());
    let opened = router
        .clone()
        .oneshot(connection_open_request(
            Some(&bearer),
            json!({
                "connectionId": "l9-unrelated-http",
                "authInvalidationProtocol": 1,
            }),
        ))
        .await
        .expect("open unrelated protected-room connection");
    assert_eq!(opened.status(), StatusCode::OK);
    let opened = response_json(opened).await;
    let connection_id = opened["connectionId"]
        .as_str()
        .expect("connection id")
        .to_owned();
    let connection_token = opened["connectionToken"]
        .as_str()
        .expect("connection token")
        .to_owned();

    let affected_scope = Scope::from_pairs([("roomId", AFFECTED_ROOM)]);
    let affected_permit = state
        .ephemeral
        .begin_server_authorized_room_act("protectedPresence", &affected_scope)
        .expect("admit affected precommit sink")
        .expect("protected room returns a permit");
    let kick_router = router.clone();
    let kick_bearer = bearer.clone();
    let kick = tokio::spawn(async move {
        kick_router
            .oneshot(session_auth_http_request(
                "/action/kickTwoRoomMembers",
                serde_json::to_vec(&json!({
                    "args": {
                        "firstId": AFFECTED_MEMBER,
                        "secondId": "member-unrelated"
                    }
                }))
                .expect("serialize two-step kick action"),
                &kick_bearer,
            ))
            .await
            .expect("kick response")
    });

    let pending_deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match state
            .ephemeral
            .begin_server_authorized_room_act("protectedPresence", &affected_scope)
        {
            Err(error) if error.code == EphemeralErrorCode::AuthorityPending => break,
            Ok(permit) => drop(permit),
            Err(error) => panic!("unexpected affected-room admission: {error:?}"),
        }
        assert!(
            Instant::now() < pending_deadline,
            "kick did not install its affected-room dependency ticket"
        );
        tokio::task::yield_now().await;
    }
    assert!(
        state.snapback.try_lock().is_ok(),
        "room quiescence must finish before the affected mutation acquires the writer lane"
    );

    let connection_request = |method: &str, uri: String, body: Option<Value>| {
        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header("x-snapback-auth-client-protocol", "1")
            .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
            .header("x-snapback-auth-invalidation-protocol", "1")
            .header("x-snapback-connection-token", &connection_token);
        let body = if let Some(body) = body {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            Body::from(serde_json::to_vec(&body).expect("serialize connection request"))
        } else {
            Body::empty()
        };
        builder.body(body).expect("connection request")
    };
    let unrelated_scope = json!({ "roomId": UNRELATED_ROOM });
    let subscribe = tokio::time::timeout(
        Duration::from_secs(1),
        router.clone().oneshot(connection_request(
            "POST",
            "/ephemeral/subscribe".to_owned(),
            Some(json!({
                "collection": "protectedPresence",
                "scope": unrelated_scope,
                "connection_id": connection_id,
            })),
        )),
    )
    .await
    .expect("unrelated protected subscribe must not queue on the writer")
    .expect("unrelated subscribe response");
    let subscribe_status = subscribe.status();
    let subscribe_body = response_json(subscribe).await;
    assert_eq!(
        subscribe_status,
        StatusCode::OK,
        "unexpected subscribe response: {subscribe_body}"
    );
    assert!(
        subscribe_body.get("Snapshot").is_some(),
        "unrelated registration publishes its initial protected snapshot: {subscribe_body}"
    );
    assert!(state.snapback.try_lock().is_ok());

    let publish = tokio::time::timeout(
        Duration::from_secs(1),
        router.clone().oneshot(connection_request(
            "POST",
            "/ephemeral/publish".to_owned(),
            Some(json!({
                "collection": "protectedPresence",
                "scope": { "roomId": UNRELATED_ROOM },
                "connection_id": connection_id,
                "value": [117, 110, 114, 101, 108, 97, 116, 101, 100],
                "ttl_ms": 5_000,
            })),
        )),
    )
    .await
    .expect("unrelated protected publish must not queue on the writer")
    .expect("unrelated publish response");
    assert_eq!(publish.status(), StatusCode::OK);
    let _ = response_json(publish).await;
    assert!(state.snapback.try_lock().is_ok());

    let drain = tokio::time::timeout(
        Duration::from_secs(1),
        router.clone().oneshot(connection_request(
            "GET",
            format!("/outbox/{connection_id}"),
            None,
        )),
    )
    .await
    .expect("unrelated protected drain must not queue on the writer")
    .expect("unrelated drain response");
    assert_eq!(drain.status(), StatusCode::OK);
    let drained = response_json(drain).await;
    assert!(
        drained.as_array().is_some_and(|frames| !frames.is_empty()),
        "the unrelated publish is destructively drained while the affected commit waits"
    );
    assert!(state.snapback.try_lock().is_ok());

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind protected-room WebSocket server");
    let address = listener.local_addr().expect("WebSocket server address");
    let ws_server_state = state.clone();
    let server = tokio::spawn(async move {
        app(ws_server_state)
            .bind(listener)
            .expect("bind protected-room WebSocket app")
            .serve()
            .await
            .expect("serve protected-room WebSocket test");
    });
    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    let mut ws_request = format!("ws://{address}/live/{connection_id}/stream")
        .into_client_request()
        .expect("protected-room WebSocket request");
    ws_request.headers_mut().insert(
        header::SEC_WEBSOCKET_PROTOCOL,
        super::LIVE_STREAM_SUBPROTOCOL
            .parse()
            .expect("wire-version subprotocol offer"),
    );
    ws_request.headers_mut().insert(
        "x-snapback-connection-token",
        connection_token.parse().expect("connection token header"),
    );
    ws_request.headers_mut().insert(
        "x-snapback-auth-client-protocol",
        "1".parse().expect("client protocol header"),
    );
    ws_request.headers_mut().insert(
        "x-snapback-auth-invalidation-protocol",
        "1".parse().expect("invalidation protocol header"),
    );
    let (mut socket, _) = tokio::time::timeout(
        Duration::from_secs(1),
        tokio_tungstenite::connect_async(ws_request),
    )
    .await
    .expect("unrelated protected WebSocket upgrade must not queue on the writer")
    .expect("connect protected-room WebSocket");

    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "ephemeral_subscribe",
                "requestId": "l9-ws-subscribe",
                "request": {
                    "collection": "protectedPresence",
                    "scope": { "roomId": UNRELATED_WS_ROOM },
                    "connection_id": connection_id,
                },
            })
            .to_string()
            .into(),
        ))
        .await
        .expect("send unrelated protected WebSocket subscribe");
    let subscribe_ack = tokio::time::timeout(Duration::from_secs(1), socket.next())
        .await
        .expect("unrelated protected WebSocket subscribe must make progress")
        .expect("subscribe acknowledgement frame")
        .expect("read subscribe acknowledgement");
    let tokio_tungstenite::tungstenite::Message::Text(subscribe_ack) = subscribe_ack else {
        panic!("expected protected-room subscribe text acknowledgement");
    };
    let subscribe_ack: Value =
        serde_json::from_str(&subscribe_ack).expect("subscribe acknowledgement JSON");
    assert_eq!(subscribe_ack["kind"], "ephemeral_ack");
    assert_eq!(subscribe_ack["requestId"], "l9-ws-subscribe");
    assert_eq!(subscribe_ack["operation"], "subscribe");
    assert!(state.snapback.try_lock().is_ok());

    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "ephemeral_publish",
                "requestId": "l9-ws-publish",
                "request": {
                    "collection": "protectedPresence",
                    "scope": { "roomId": UNRELATED_WS_ROOM },
                    "connection_id": connection_id,
                    "value": [119, 115],
                    "ttl_ms": 5_000,
                },
            })
            .to_string()
            .into(),
        ))
        .await
        .expect("send unrelated protected WebSocket publish");
    tokio::time::timeout(Duration::from_secs(1), async {
        let mut saw_publish_ack = false;
        let mut saw_drained_message = false;
        while !saw_publish_ack || !saw_drained_message {
            let frame = socket
                .next()
                .await
                .expect("publish response frame")
                .expect("read publish response");
            let tokio_tungstenite::tungstenite::Message::Text(frame) = frame else {
                continue;
            };
            let frame: Value = serde_json::from_str(&frame).expect("publish response JSON");
            saw_publish_ack |= frame["kind"] == "ephemeral_ack"
                && frame["requestId"] == "l9-ws-publish"
                && frame["operation"] == "publish";
            saw_drained_message |=
                frame["kind"] == "ephemeral" && frame["message"].get("Upsert").is_some();
        }
    })
    .await
    .expect("unrelated protected WebSocket publish/drain must not queue on the writer");
    assert!(state.snapback.try_lock().is_ok());
    let _ = socket.close(None).await;
    server.abort();

    drop(affected_permit);
    let kick = tokio::time::timeout(Duration::from_secs(2), kick)
        .await
        .expect("kick completes after affected sink quiesces")
        .expect("kick task joins");
    assert_eq!(kick.status(), StatusCode::OK);
    let kick = response_json(kick).await;
    assert_eq!(
        kick["result"],
        json!(1),
        "the first step's binding survives the off-Local reservation boundary"
    );
    let remaining = with_snapback(&state.snapback, |snapback| {
        snapback
            .remainder_auth_fixture()
            .query_reads_read()
            .scan_table("roomMembers", 10, 0)
            .map(|scan| scan.total)
    })
    .await
    .expect("scan memberships after two-step action");
    assert_eq!(
        remaining, 1,
        "both independently reserved RunMutation steps must commit"
    );
}

/// Detached Ibex actions have two nested mutation shapes: a stored
/// HostPlan target and an Ibex target that executes outside Local. Both
/// must preview first, release Local while the affected room drains, and
/// bind the exact reservation only in the final SQLite window.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn detached_action_nested_mutations_reserve_rooms_off_local() {
    const HOST_ROOM: &str = "room-detached-host-plan";
    const IBEX_ROOM: &str = "room-detached-ibex";
    const HOST_MEMBER: &str = "member-detached-host-plan";
    const IBEX_MEMBER: &str = "member-detached-ibex";

    let (state, _directory) = tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        protected_room_server_fixture()
    })
    .await
    .expect("construct detached protected-room fixture");
    let seed = SeedData {
        tables: BTreeMap::from([(
            "roomMembers".to_owned(),
            vec![
                Map::from_iter([
                    ("_id".to_owned(), json!(HOST_MEMBER)),
                    ("roomId".to_owned(), json!(HOST_ROOM)),
                    ("userId".to_owned(), json!("detached-user")),
                ]),
                Map::from_iter([
                    ("_id".to_owned(), json!(IBEX_MEMBER)),
                    ("roomId".to_owned(), json!(IBEX_ROOM)),
                    ("userId".to_owned(), json!("detached-user")),
                ]),
            ],
        )]),
    };
    with_snapback_staged_authorization_write(
        &state.snapback,
        None,
        move |snapback| {
            Ok((
                snapback_engine::test_support::authorization_commit_preflight_for_seed(
                    snapback, &seed,
                )?,
                seed.clone(),
            ))
        },
        move |snapback, seed| snapback.seed(seed),
    )
    .await
    .expect("reserve detached fixture seed")
    .expect("seed detached fixture memberships");

    for (target, room, member) in [
        ("kickRoomMember", HOST_ROOM, HOST_MEMBER),
        ("ibexKickRoomMember", IBEX_ROOM, IBEX_MEMBER),
    ] {
        let action = with_snapback(&state.snapback, |snapback| {
            snapback.stage_cron_action_invocation("heldRoomAction")
        })
        .await
        .expect("stage held detached action");
        let StagedAction::Detached(action) = action else {
            panic!("Ibex action must use the detached worker shape");
        };
        let mut host = held_action_host(state.snapback.clone(), &action);
        let scope = Scope::from_pairs([("roomId", room)]);
        let permit = state
            .ephemeral
            .begin_server_authorized_room_act("protectedPresence", &scope)
            .expect("admit affected room act")
            .expect("protected room returns a permit");
        let target = target.to_owned();
        let member = member.to_owned();
        let nested = tokio::task::spawn_blocking(move || {
            let _sanction = crate::exec_guard::BlockingSanction::acquire();
            host.run_mutation(
                &target,
                HandlerInput {
                    args: json!({ "id": member }),
                    ..HandlerInput::default()
                },
            )
        });

        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match state
                .ephemeral
                .begin_server_authorized_room_act("protectedPresence", &scope)
            {
                Err(error) if error.code == EphemeralErrorCode::AuthorityPending => break,
                Ok(permit) => drop(permit),
                Err(error) => panic!("unexpected room admission while reserving: {error:?}"),
            }
            assert!(
                Instant::now() < deadline,
                "detached nested mutation did not install its room ticket"
            );
            tokio::task::yield_now().await;
        }
        assert!(
            state.snapback.try_lock().is_ok(),
            "detached room wait must not retain Local"
        );
        drop(permit);
        let output = tokio::time::timeout(Duration::from_secs(2), nested)
            .await
            .expect("nested mutation completes after room permit release")
            .expect("nested worker joins")
            .expect("nested mutation commits");
        assert_eq!(output.changed_count, 1);
    }
}

#[tokio::test]
async fn handshake_holds_one_root_through_body_including_stable_pending_epochs() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let controller = state.auth_admission_controller();
    let response = app(state)
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(controller.snapshot().in_flight, 1);
    let authority = response
        .extensions()
        .get::<PreparedAuthority>()
        .expect("stable handshake carries exact authority");
    assert_eq!(
        authority.source(),
        crate::auth::invocation::InvocationSource::BootstrapHandshake
    );
    assert_eq!(
        response
            .extensions()
            .get::<AdmissionLease>()
            .expect("stable handshake carries its counted root")
            .admission_epoch(),
        authority.admission_epoch()
    );
    let _ = response_json(response).await;
    assert_eq!(controller.snapshot().in_flight, 0);

    let (pending, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    pending
        .publish_auth_mode_state(pending_sessions_state(false))
        .unwrap();
    let pending_controller = pending.auth_admission_controller();
    let response = app(pending)
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(response.extensions().get::<PreparedAuthority>().is_some());
    assert!(
        response
            .extensions()
            .get::<PreparedAuthority>()
            .unwrap()
            .admission_lease()
            .is_diagnostic()
    );
    assert!(response.extensions().get::<AdmissionLease>().is_some());
    assert!(
        response
            .extensions()
            .get::<AdmissionLease>()
            .unwrap()
            .is_diagnostic()
    );
    assert_eq!(pending_controller.snapshot().in_flight, 1);
    let pending_body = response_json(response).await;
    assert_eq!(
        pending_body["modeState"], "pendingRestart",
        "{pending_body:?}"
    );
    assert_eq!(pending_controller.snapshot().in_flight, 0);
}

#[tokio::test]
async fn retired_handshake_body_emits_no_frame_after_transition_cut() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let controller = state.auth_admission_controller();
    let response = app(state)
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let lease = response
        .extensions()
        .get::<AdmissionLease>()
        .expect("stable handshake root")
        .clone();
    assert_eq!(controller.snapshot().in_flight, 1);
    let transition = {
        let controller = controller.clone();
        tokio::task::spawn_blocking(move || {
            controller.begin_transition_for_test(Duration::from_millis(10))
        })
    };
    let error = transition.await.unwrap().unwrap_err();
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT"
    );
    assert!(lease.is_cancelled());
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert!(bytes.is_empty(), "retired response body must be suppressed");
    assert!(controller.snapshot().accepting);
}

#[tokio::test]
async fn pending_and_quarantined_modes_refuse_ordinary_app_data_but_serve_handshake() {
    for quarantined in [false, true] {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        let state = state
            .with_auth_runtime_facts(
                pending_sessions_state(quarantined),
                AuthProgramReadiness::item4(false),
            )
            .expect("install pending mode");
        let router = app(state);
        let inspect = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/inspect")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(inspect.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response_json(inspect).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_MODE_PENDING"
        );

        let handshake = router
            .oneshot(
                Request::builder()
                    .uri("/auth/session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(handshake.status(), StatusCode::OK);
        let body = response_json(handshake).await;
        assert_eq!(
            body["modeState"],
            if quarantined {
                "quarantined"
            } else {
                "pendingRestart"
            }
        );
        assert_eq!(
            body["quarantineCode"],
            if quarantined {
                json!("SNAPBACK_AUTH_POLICY_UNAVAILABLE")
            } else {
                Value::Null
            }
        );
        assert_eq!(
            body["availability"]["onlineRequestResponse"]["reason"],
            "SNAPBACK_AUTH_MODE_PENDING"
        );
    }
}

/// Mode-transition terminal propagation must run after the committing
/// Local scope is released, while the committed transition carrier still
/// keeps admission closed. A real live grant exercises the registry,
/// ephemeral notifier, and Local topology purge phases that previously
/// formed the forbidden Local -> registry edge.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn committed_mode_transition_terminalizes_live_grant_before_successor_publication() {
    let state = sessions_activation_server_fixture_async().await;
    let credential = mint_test_credential(&state, "mode-transition-live@example.com").await;
    let bearer = credential["token"].as_str().expect("session bearer");
    let (connection_id, registration_generation, waker) =
        open_registered_session_connection(&state, bearer, "mode-transition-live-grant");
    let controller = state.auth_admission_controller();

    let (schema, functions) = dev_downgrade_pair();
    let prepared = with_snapback(&state.snapback, move |snapback| {
        snapback.prepare_auth_provision(EnsureAppMode::Dev, Some(schema), Some(functions), None)
    })
    .await
    .expect("preflight sessions-to-dev transition");

    let committed = super::commit_prepared_auth_provision(
        &state,
        prepared,
        ServerProfile::Test.as_str().to_owned(),
    )
    .await
    .expect("commit mode transition and terminalize live grants off Local");
    assert_eq!(committed.state().active, AuthMode::Sessions);
    assert_eq!(committed.state().desired, AuthMode::Dev);
    assert_eq!(committed.state().mode_state, AuthModeStatus::PendingRestart);
    assert_eq!(state.auth_mode_state().as_ref(), committed.state());
    assert!(
        !controller.snapshot().accepting,
        "pending successor remains closed after terminal propagation"
    );

    tokio::time::timeout(Duration::from_secs(1), waker.notified())
        .await
        .expect("mode transition wakes the exact live grant");
    let event = state
        .ephemeral
        .delivery_notifier()
        .terminal_if_current(&connection_id, registration_generation)
        .expect("mode transition installs a terminal event before returning");
    assert_eq!(event.code, crate::live_wire::LiveAuthErrorCode::ModePending);
    assert_eq!(
        event.reason,
        crate::live_wire::LiveAuthErrorReason::Downgrade
    );
    assert_eq!(
        event.authority_disposition,
        crate::live_wire::LiveAuthorityDisposition::DurableDelete
    );
    assert!(
        !state.connections.lock().grants.contains_key(&connection_id),
        "terminal lifecycle removes the predecessor grant"
    );
    assert!(
        state.snapback.try_lock().is_ok(),
        "mode publication returns with no Local guard retained"
    );
    let refused = app(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/query/listItems")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .body(Body::from(r#"{"args":{}}"#))
                .expect("predecessor bearer query"),
        )
        .await
        .expect("pending-mode bearer refusal response");
    assert_eq!(refused.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response_json(refused).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_MODE_PENDING"
    );
}

#[tokio::test]
async fn sessions_online_and_live_are_fenced_until_item5_then_require_protocol_v1() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = state
        .with_auth_runtime_facts(settled_sessions_state(), AuthProgramReadiness::item4(true))
        .expect("install pre-item-5 sessions fixture");
    let router = app(state);
    for uri in ["/inspect", "/live/guessed/subscribe"] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(if uri.starts_with("/live/") {
                        "POST"
                    } else {
                        "GET"
                    })
                    .uri(uri)
                    .header("x-snapback-auth-client-protocol", "1")
                    .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response_json(response).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );
    }

    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let item5 = AuthProgramReadiness::new(true, true, true, true, false, false, false);
    let state = state
        .with_auth_runtime_facts(settled_sessions_state(), item5)
        .expect("install item-5 sessions fixture");
    let router = app(state);
    let missing = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/inspect")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::BAD_REQUEST);
    let missing = response_json(missing).await;
    assert_eq!(
        missing["diagnostic"]["code"],
        "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED"
    );
    assert!(
        missing["diagnostic"]["message"]
            .as_str()
            .expect("actionable protocol message")
            .contains("x-snapback-auth-client-protocol: 1")
    );
    let supported = router
        .oneshot(
            Request::builder()
                .uri("/inspect")
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(supported.status(), StatusCode::OK);
}

#[tokio::test]
async fn sessions_live_stream_accepts_browser_subprotocol_offer_only_on_upgrade_route() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = state
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, false, false, false),
        )
        .expect("install item-5 sessions fixture");
    let stream = route_registry()
        .into_iter()
        .find(|spec| spec.method == "GET" && spec.path == "/live/{connection_id}/stream")
        .expect("registered live-stream route");
    let ordinary_http = route_registry()
        .into_iter()
        .find(|spec| spec.method == "GET" && spec.path == "/inspect")
        .expect("registered inspect route");
    let mut headers = HeaderMap::new();
    headers.insert(
        header::SEC_WEBSOCKET_PROTOCOL,
        "snapback.v1, snapback.auth-client.1"
            .parse()
            .expect("valid subprotocol header"),
    );

    assert!(super::session_online_protocol_refusal(stream, &state, &headers).is_none());
    let refusal = super::session_online_protocol_refusal(ordinary_http, &state, &headers)
        .expect("ordinary HTTP must ignore WebSocket protocol tokens");
    assert_eq!(
        refusal.diagnostic.code,
        "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED"
    );
    assert_eq!(
        refusal.diagnostic.message,
        "add the request header `x-snapback-auth-client-protocol: 1`: this request \
             does not offer the exact supported auth-client protocol (on a WebSocket \
             upgrade, offer the `snapback.auth-client.1` subprotocol instead; a \
             non-session SnapbackClient passes both `authClientProtocol: 1` and \
             `custody: 'anonymous-public'`)"
    );
}

#[tokio::test]
async fn item5_live_gate_preserves_only_manifest_proved_independent_exception() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let item5 = AuthProgramReadiness::new(true, true, true, true, false, false, false);
    let state = state
        .with_auth_runtime_facts(settled_sessions_state(), item5)
        .expect("install item-5 sessions fixture");
    let mut independent = FunctionDefinition::new(
        "publicFeed",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table_visibility: None,
            table: "items".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        })),
    );
    independent.authority_independent = true;
    independent.auth_requirement = Some(crate::manifest::AuthRequirement::Public);
    let scoped = FunctionDefinition::new(
        "privateFeed",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table_visibility: None,
            table: "items".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        })),
    );
    super::with_snapback(&state.snapback, move |snapback| {
        snapback
            .apply_schema(SchemaManifest {
                ephemeral_collections: vec![
                    EphemeralCollection::local_cursor("public_cursors", "room"),
                    EphemeralCollection::local_cursor("private_cursors", "room")
                        .require_room_permission("room_read"),
                ],
                tables: vec![crate::manifest::TableManifest {
                    name: "items".to_owned(),
                    fields: Vec::new(),
                    indexes: Vec::new(),
                    syncable: false,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                }],
                ..SchemaManifest::default()
            })
            .expect("install live-gate schema");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![independent, scoped],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics
                .iter()
                .all(|diagnostic| diagnostic.severity
                    != crate::diagnostic::DiagnosticSeverity::Error),
            "live-gate manifest must load: {diagnostics:?}"
        );
    })
    .await;
    let spec = super::core_route_registrations()
        .into_iter()
        .find(|route| route.spec.path == "/live/{name}/subscribe")
        .expect("registered live subscribe")
        .spec;
    let headers = HeaderMap::from_iter([(
        HeaderName::from_static("x-snapback-auth-client-protocol"),
        HeaderValue::from_static("1"),
    )]);

    assert!(
        super::session_live_protocol_refusal(
            spec,
            &state,
            &headers,
            "/live/publicFeed/subscribe",
            None,
        )
        .await
        .is_none()
    );
    let refusal = super::session_live_protocol_refusal(
        spec,
        &state,
        &headers,
        "/live/privateFeed/subscribe",
        None,
    )
    .await
    .expect("auth-scoped live must fail before item 6");
    assert_eq!(
        refusal.diagnostic.code,
        "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE"
    );

    let ephemeral_spec = super::core_route_registrations()
        .into_iter()
        .find(|route| route.spec.path == "/ephemeral/subscribe")
        .expect("registered ephemeral subscribe")
        .spec;
    assert!(
        super::session_live_protocol_refusal(
            ephemeral_spec,
            &state,
            &headers,
            "/ephemeral/subscribe",
            Some(&json!({ "collection": "public_cursors" })),
        )
        .await
        .is_none()
    );
    assert_eq!(
        super::session_live_protocol_refusal(
            ephemeral_spec,
            &state,
            &headers,
            "/ephemeral/subscribe",
            Some(&json!({ "collection": "private_cursors" })),
        )
        .await
        .expect("protected room must fail before item 6")
        .diagnostic
        .code,
        "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE"
    );

    let socket_subscribe = |collection: &str| {
        json!({
            "type": "ephemeral_subscribe",
            "requestId": format!("subscribe-{collection}"),
            "request": {
                "collection": collection,
                "scope": { "room": "one" },
                "connection_id": "conn-item5"
            }
        })
        .to_string()
    };
    let public_socket: Value = serde_json::from_str(
        &super::handle_live_socket_text(
            &state.ephemeral,
            "conn-item5",
            &socket_subscribe("public_cursors"),
            PolicyAuthMode::Sessions,
            false,
            &ResolvedAppAuthority::Anonymous,
        )
        .text,
    )
    .expect("public socket response");
    assert_eq!(
        public_socket["kind"], "ephemeral_ack",
        "session-mode authority-independent registration must not require body auth"
    );
    let protected_socket: Value = serde_json::from_str(
        &super::handle_live_socket_text(
            &state.ephemeral,
            "conn-item5",
            &socket_subscribe("private_cursors"),
            PolicyAuthMode::Sessions,
            false,
            &ResolvedAppAuthority::Anonymous,
        )
        .text,
    )
    .expect("protected socket refusal");
    assert_eq!(
        protected_socket["diagnostic"]["code"], "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
        "the WebSocket registration twin must share the HTTP item-5 gate"
    );

    let mut planted: Value =
        serde_json::from_str(&socket_subscribe("public_cursors")).expect("socket frame");
    planted["request"]["auth"] = json!({
        "principal": "planted",
        "session_id": null,
        "user_id": null,
        "permissions": []
    });
    let planted: Value = serde_json::from_str(
        &super::handle_live_socket_text(
            &state.ephemeral,
            "conn-item5",
            &planted.to_string(),
            PolicyAuthMode::Sessions,
            false,
            &ResolvedAppAuthority::Anonymous,
        )
        .text,
    )
    .expect("planted-auth refusal");
    assert_eq!(
        planted["diagnostic"]["code"],
        "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED"
    );

    let dev_missing_auth: Value = serde_json::from_str(
        &super::handle_live_socket_text(
            &state.ephemeral,
            "conn-item5",
            &socket_subscribe("public_cursors"),
            PolicyAuthMode::Dev,
            false,
            &ResolvedAppAuthority::Anonymous,
        )
        .text,
    )
    .expect("dev closed-shape refusal");
    assert_eq!(
        dev_missing_auth["diagnostic"]["code"], "SNAPBACK_WEBSOCKET_MESSAGE_INVALID",
        "the legacy dev DTO must still require its auth member"
    );
}

/// LLP 0096 §8.1 P-3 regression: the invalidation-ack routes are owned by
/// the authorization-invalidation program (LLP 0059 item 6). In the
/// readiness interval where item 6 is ready but the authority-descriptor
/// program (item 7) is not, a client offering only the invalidation
/// protocol — no `x-snapback-authority-descriptor-protocol` header — must
/// still discharge invalidation obligations; only mutation settlement
/// remains descriptor-bound.
#[tokio::test]
async fn invalidation_ack_routes_do_not_require_the_authority_descriptor_plane() {
    let state = sessions_activation_server_fixture_async().await;
    let settled = state.auth_mode_state().as_ref().clone();
    let state = state
        .with_auth_runtime_facts(
            settled,
            AuthProgramReadiness::new(true, true, true, true, true, false, false),
        )
        .expect("install item-6 sessions posture");
    let credential = mint_test_credential(&state, "invalidation-ack-item6@example.com").await;
    let bearer = credential["token"].as_str().expect("bearer").to_owned();
    let router = app(state.clone());

    let opened = router
        .clone()
        .oneshot(connection_open_request(
            Some(&bearer),
            json!({ "authInvalidationProtocol": 1 }),
        ))
        .await
        .expect("open invalidation-negotiated connection");
    assert_eq!(opened.status(), StatusCode::OK);
    let opened = response_json(opened).await;
    let connection_id = opened["connectionId"].as_str().expect("connection id");
    let connection_token = opened["connectionToken"]
        .as_str()
        .expect("connection token");
    assert_eq!(opened["authorizationInvalidation"]["protocolVersion"], 1);

    let invalidation_only_request = |uri: &str, body: Value| {
        Request::builder()
            .method("POST")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-snapback-auth-client-protocol", "1")
            .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
            .header("x-snapback-auth-invalidation-protocol", "1")
            .header(super::CONNECTION_TOKEN_HEADER, connection_token)
            .body(Body::from(serde_json::to_vec(&body).expect("body")))
            .expect("invalidation-only request")
    };

    let acknowledged = router
        .clone()
        .oneshot(invalidation_only_request(
            "/live/authorization-invalidation/acknowledge",
            json!({ "connectionId": connection_id, "ackToken": "no_pending_obligation" }),
        ))
        .await
        .expect("acknowledge without descriptor offer");
    let acknowledged_status = acknowledged.status();
    let acknowledged = response_json(acknowledged).await;
    assert_eq!(
        acknowledged_status,
        StatusCode::OK,
        "item-6 clients must reach the acknowledge handler without the \
             descriptor plane: {acknowledged}"
    );
    assert_eq!(acknowledged["outcome"], "stale");

    let retried = router
        .clone()
        .oneshot(invalidation_only_request(
            "/live/authorization-invalidation/manual-retry",
            json!({
                "connectionId": connection_id,
                "subscriptionId": "missing_subscription",
                "manualRetryId": "item6_retry",
            }),
        ))
        .await
        .expect("manual retry without descriptor offer");
    let retried = response_json(retried).await;
    assert_eq!(
        retried["diagnostic"]["code"], "SNAPBACK_AUTH_RESNAPSHOT_REQUIRED",
        "manual retry must pass the policy gate and fail only on the \
             unknown subscription: {retried}"
    );

    // Mutation settlement stays descriptor-bound: the same
    // invalidation-only client is refused on the queued-replay plane.
    let settlement = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/client-mutations/acknowledge")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .header("x-snapback-auth-invalidation-protocol", "1")
                .body(Body::from(
                    serde_json::to_vec(&json!({ "clientMutationIds": [] })).expect("body"),
                ))
                .unwrap(),
        )
        .await
        .expect("settlement acknowledgement without descriptor offer");
    assert_eq!(settlement.status(), StatusCode::SERVICE_UNAVAILABLE);
    let settlement = response_json(settlement).await;
    assert_eq!(
        settlement["diagnostic"]["code"],
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
    );
    assert_eq!(
        settlement["diagnostic"]["details"]["capability"],
        "queuedReplay"
    );
}

#[tokio::test]
async fn plaintext_handshake_fence_precedes_bearer_resolution_for_active_and_desired_sessions() {
    const BEARER_SENTINEL: &str = "sbs_PLAINTEXT_HANDSHAKE_SENTINEL_MUST_NOT_BE_CONSUMED";

    async fn handshake(router: SnapbackApp, bearer: Option<&str>) -> (StatusCode, Value) {
        let mut request = Request::builder().uri("/auth/session");
        if let Some(bearer) = bearer {
            request = request.header(header::AUTHORIZATION, format!("Bearer {bearer}"));
        }
        let response = router
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        (status, response_json(response).await)
    }

    let (mut active, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    Arc::make_mut(&mut active.server)
        .record_bound_address("0.0.0.0:4287".parse().expect("non-loopback address"));
    let active = active.with_insecure_dev_auth_override(true);
    assert_eq!(
        active
            .validate_auth_transport()
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_AUTH_TRANSPORT_INSECURE"
    );
    let (status, body) = handshake(app(active), Some(BEARER_SENTINEL)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        body["diagnostic"]["code"],
        "SNAPBACK_AUTH_TRANSPORT_INSECURE"
    );
    assert!(!body.to_string().contains(BEARER_SENTINEL));

    let (mut desired, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    desired
        .publish_auth_mode_state(pending_sessions_state(false))
        .unwrap();
    Arc::make_mut(&mut desired.server)
        .record_bound_address("0.0.0.0:4287".parse().expect("non-loopback address"));
    let desired = desired.with_insecure_dev_auth_override(true);
    assert_eq!(
        desired
            .validate_auth_transport()
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_AUTH_TRANSPORT_INSECURE"
    );
    let desired_router = app(desired);
    let health = desired_router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(health.status(), StatusCode::OK);
    let (status, body) = handshake(desired_router, Some(BEARER_SENTINEL)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        body["diagnostic"]["code"],
        "SNAPBACK_AUTH_TRANSPORT_INSECURE"
    );
    assert!(!body.to_string().contains(BEARER_SENTINEL));

    let (mut dev, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    Arc::make_mut(&mut dev.server)
        .record_bound_address("0.0.0.0:4287".parse().expect("non-loopback address"));
    let dev = dev.with_insecure_dev_auth_override(true);
    let (status, body) = handshake(app(dev), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["activeMode"], "dev");
    assert_eq!(body["authority"]["isAuthenticated"], false);
}

#[tokio::test]
async fn hosted_anonymous_connection_open_consumes_shared_source_admission() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let mut state = state
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, false, false, false),
        )
        .expect("install hosted connection sessions posture");
    Arc::make_mut(&mut state.server).auth_deployment =
        crate::auth::deployment::AuthDeploymentTarget::Hosted;
    let now_ms = state
        .auth_provider
        .as_ref()
        .expect("hosted fixture provider")
        .now_ms();
    let generous = AuthenticationBucketPolicy {
        interval_ms: 1,
        burst: 10_000,
        maximum_denial_debt_attempts: 100,
    };
    let state = state
        .with_hosted_serving_authority(hosted_serving_authority_with_throttle(
            now_ms,
            SharedAuthenticationThrottleConfig {
                retention_ms: 900_000,
                maximum_key_count: 100_000,
                global: generous,
                source: AuthenticationBucketPolicy {
                    interval_ms: 1_000,
                    burst: 1,
                    maximum_denial_debt_attempts: 4,
                },
                subject: generous,
                source_subject: generous,
                family: generous,
            },
        ))
        .expect("install hosted source throttle authority");
    let router = app(state);
    let request = || {
        // The SAME source both times: the second open must be denied by
        // the per-source admission bucket the first one consumed.
        via_hosted_terminator(connection_open_request(None, json!({})), "192.0.2.30")
    };

    let admitted = router
        .clone()
        .oneshot(request())
        .await
        .expect("first anonymous connection open");
    assert_eq!(admitted.status(), StatusCode::OK);

    let denied = router
        .oneshot(request())
        .await
        .expect("second anonymous connection open");
    assert_eq!(denied.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        response_json(denied).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_THROTTLED",
    );
}

#[tokio::test]
async fn connection_open_binds_only_a_verified_dev_identity_witness() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let (registry, capability) = dev_identity_capability_fixture();
    let (_other_registry, other_capability) = dev_identity_capability_fixture();
    let warning_witness = registry.clone();
    let state = state.with_dev_identity_capabilities(registry);
    let router = app(state.clone());
    let request = |presented: Option<&str>, body: Value| {
        let mut request = connection_open_request(None, body);
        request
            .headers_mut()
            .remove("x-snapback-auth-client-protocol");
        request
            .headers_mut()
            .remove(crate::auth::effective_source::FORWARDED_HEADER);
        if let Some(presented) = presented {
            request.headers_mut().insert(
                crate::dev_identity::DEV_IDENTITY_CAPABILITY_HEADER,
                HeaderValue::from_str(presented).unwrap(),
            );
        }
        request
    };

    let refused = router
        .clone()
        .oneshot(request(Some(&other_capability), json!({})))
        .await
        .unwrap();
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);
    let refused = response_json(refused).await;
    assert_eq!(
        refused["diagnostic"]["code"],
        "SNAPBACK_DEV_IDENTITY_REFUSED"
    );
    assert_eq!(
        refused["diagnostic"]["message"],
        "developer identity capability refused"
    );
    assert!(
        !refused.to_string().contains("/operator/"),
        "custody-path remediation remains server-local"
    );

    let opened = router
        .clone()
        .oneshot(request(Some(&capability), json!({})))
        .await
        .unwrap();
    assert_eq!(opened.status(), StatusCode::OK);
    let opened = response_json(opened).await;
    assert_eq!(opened["devIdentityCapabilityWitnessed"], true);
    let prepared = state
        .connections
        .prepare_act(
            opened["connectionId"].as_str().unwrap(),
            opened["connectionToken"].as_str(),
            state.auth_coordinator.as_deref(),
            true,
            super::now_millis(),
            Instant::now(),
        )
        .unwrap();
    assert!(prepared.dev_identity_witnessed);

    let connection_id = opened["connectionId"].as_str().unwrap();
    let connection_token = opened["connectionToken"].as_str().unwrap();
    let reopened = router
        .clone()
        .oneshot(request(
            None,
            json!({
                "connectionId": connection_id,
                "previousToken": connection_token,
            }),
        ))
        .await
        .unwrap();
    assert_eq!(reopened.status(), StatusCode::OK);
    let reopened = response_json(reopened).await;
    assert_eq!(reopened["devIdentityCapabilityWitnessed"], false);
    assert_eq!(reopened["connectionId"], connection_id);
    assert_eq!(reopened["connectionToken"], connection_token);
    let prepared = state
        .connections
        .prepare_act(
            connection_id,
            Some(connection_token),
            state.auth_coordinator.as_deref(),
            true,
            super::now_millis(),
            Instant::now(),
        )
        .unwrap();
    assert!(
        !prepared.dev_identity_witnessed,
        "an exact-token reopen must replace the prior capability witness"
    );

    let identity_frame = json!({
        "type": "ephemeral_subscribe",
        "requestId": "reopen-witness",
        "request": {
            "collection": "missing-is-fine-for-witness-test",
            "scope": { "room": "one" },
            "connection_id": connection_id,
            "auth": {
                "principal": "asserted",
                "session_id": null,
                "user_id": "asserted",
                "permissions": []
            }
        }
    })
    .to_string();
    let _ = super::handle_live_socket_text_authorized(
        &state.ephemeral,
        connection_id,
        &identity_frame,
        PolicyAuthMode::Dev,
        false,
        &prepared.resolved,
        super::LiveSocketEffectContext {
            dev_identity_capabilities: state.dev_identity_capabilities.as_ref(),
            dev_identity_witnessed: prepared.dev_identity_witnessed,
            ..Default::default()
        },
    );
    assert!(
        !warning_witness.warn_unwitnessed_assertion_once(),
        "the headerless reopen makes the stage-2 missing-capability warning reachable again"
    );

    let restored = router
        .oneshot(request(
            Some(&capability),
            json!({
                "connectionId": connection_id,
                "previousToken": connection_token,
            }),
        ))
        .await
        .unwrap();
    assert_eq!(restored.status(), StatusCode::OK);
    assert_eq!(
        response_json(restored).await["devIdentityCapabilityWitnessed"],
        true
    );
    let prepared = state
        .connections
        .prepare_act(
            connection_id,
            Some(connection_token),
            state.auth_coordinator.as_deref(),
            true,
            super::now_millis(),
            Instant::now(),
        )
        .unwrap();
    assert!(
        prepared.dev_identity_witnessed,
        "re-presenting the capability restores the connection witness"
    );
}

/// The LLP 0062 live attribution wire seam over the real routes:
/// establishment answers the server-derived block, a renewal resume
/// re-answers the establishment block byte-identically, credential
/// rotation terminates the old watch, and a subscription restarted fresh
/// under the successor generation carries that generation's
/// server-derived block.
///
/// @ref LLP 0055#audit — attribution is server-derived and identical
///   across projections of the same function; wrappers never synthesize.
#[tokio::test]
async fn live_attribution_is_immutable_across_renewal_and_regenerated_after_rotation() {
    fn live_request(path: &str, connection_token: &str, body: Value) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(path)
            .header(header::CONTENT_TYPE, "application/json")
            .header(super::CONNECTION_TOKEN_HEADER, connection_token)
            .header("x-snapback-auth-client-protocol", "1")
            .header("x-snapback-auth-invalidation-protocol", "1")
            .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap()
    }
    async fn open_service_connection(router: &SnapbackApp, bearer: &str) -> (String, String) {
        let opened = router
            .clone()
            .oneshot(connection_open_request(
                Some(bearer),
                json!({ "authInvalidationProtocol": 1 }),
            ))
            .await
            .unwrap();
        assert_eq!(opened.status(), StatusCode::OK);
        let opened = response_json(opened).await;
        (
            opened["connectionId"].as_str().unwrap().to_owned(),
            opened["connectionToken"].as_str().unwrap().to_owned(),
        )
    }
    async fn subscribe_live_items(
        router: &SnapbackApp,
        connection_id: &str,
        connection_token: &str,
        query_instance_id: u64,
    ) -> Value {
        let subscribed = router
            .clone()
            .oneshot(live_request(
                "/live/liveItems/subscribe",
                connection_token,
                json!({
                    "connection_id": connection_id,
                    "input": { "args": {} },
                    "authorizationNamespace": {
                        "clientStoreId": "attribution-store",
                        "queryKey": "liveItems:{}",
                        "queryInstanceId": query_instance_id,
                    },
                }),
            ))
            .await
            .unwrap();
        let status = subscribed.status();
        let subscribed = response_json(subscribed).await;
        assert_eq!(status, StatusCode::OK, "live subscribe: {subscribed}");
        subscribed
    }

    let effective_user_id = "018f0d90-7b30-7a22-8c33-445566778899";
    let grant_id = "018f0d90-7b32-7a22-8c33-445566778899";
    let state = sessions_activation_server_fixture_with_agents_async(agent_policy(
        AgentsMode::Open,
        InvitedBy::Operators,
    ))
    .await;
    let provider = state.auth_provider.clone().unwrap();
    let now_ms = provider.now_ms();
    let seed_provider = provider.clone();
    let (agent_user_id, token, agent_credential) =
        with_snapback(&state.snapback, move |snapback| {
            let mut db = snapback.remainder_auth_fixture();
            db.auth_catalog()
                .insert_live_carrier_prerequisites_for_test(now_ms)?;
            let credential = db.register_agent_principal(
                None,
                Some("Live Attribution Agent".to_owned()),
                None,
                ServerProfile::Test,
                now_ms,
                &OsRandom,
            )?;
            db.auth_catalog()
                .insert_live_carrier_grant_for_test(&credential.user_id, now_ms)?;
            let issued = db.mint_scoped_token(
                &credential.secret,
                "018f0d90-7b32-7a22-8c33-445566778899",
                None,
                now_ms,
                &OsRandom,
            )?;
            Ok::<_, SnapbackError>((
                credential.user_id,
                issued.secret.expose_secret().to_owned(),
                credential.secret.expose_secret().to_owned(),
            ))
        })
        .await
        .unwrap();
    let router = super::app(state.clone());
    let expected_attribution = json!({
        "actorUserId": agent_user_id,
        "effectiveUserId": effective_user_id,
        "grantId": grant_id,
        "dryRun": false,
    });

    let (connection_id, connection_token) = open_service_connection(&router, &token).await;
    let subscribed = subscribe_live_items(&router, &connection_id, &connection_token, 1).await;
    assert_eq!(subscribed["attribution"], expected_attribution);
    let subscription_id = subscribed["subscription_id"].as_str().unwrap().to_owned();

    // Renewal resubscribe: the resume answers the establishment block
    // unchanged — immutable subscription metadata, byte-identical.
    let resumed = router
        .clone()
        .oneshot(live_request(
            "/live/liveItems/resume",
            &connection_token,
            json!({
                "subscription_id": subscription_id,
                "connection_id": connection_id,
            }),
        ))
        .await
        .unwrap();
    let resumed_status = resumed.status();
    let resumed = response_json(resumed).await;
    assert_eq!(resumed_status, StatusCode::OK, "live resume: {resumed}");
    assert_eq!(
        serde_json::to_string(&resumed["attribution"]).unwrap(),
        serde_json::to_string(&subscribed["attribution"]).unwrap(),
        "renewal must carry the establishment attribution verbatim"
    );

    // Rotation terminates the old watch (LLP 0055 item-6 fences): the
    // exact bound carrier receives a durable-delete terminal and the
    // auth-scoped live topology for the connection is purged.
    let bound_grant_id = state
        .connections
        .lock()
        .grants
        .get(&connection_id)
        .expect("service connection grant")
        .grant_id
        .clone();
    let notifier = state.ephemeral.delivery_notifier();
    let (registration, waker) = notifier
        .register_bound(&connection_id, bound_grant_id)
        .expect("register exact service socket");
    with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .auth_catalog()
            .set_agent_credential_rotated_at_for_test(&agent_user_id, 0)
    })
    .await
    .unwrap();
    let mut rotate = auth_http_request(
        "POST",
        "/auth/agents/rotate",
        serde_json::to_vec(&json!({ "credential": agent_credential })).unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut rotate);
    let rotated = router.clone().oneshot(rotate).await.unwrap();
    assert_eq!(rotated.status(), StatusCode::OK);
    let successor_credential = response_json(rotated).await["credential"]
        .as_str()
        .unwrap()
        .to_owned();
    tokio::time::timeout(Duration::from_secs(1), waker.notified())
        .await
        .expect("credential rotation wakes the exact service socket");
    let terminal = notifier
        .terminal_if_current(&connection_id, registration)
        .expect("credential rotation installs a terminal frame");
    assert_eq!(
        terminal.code,
        crate::live_wire::LiveAuthErrorCode::ScopedTokenInvalid
    );
    assert_eq!(
        terminal.authority_disposition,
        crate::live_wire::LiveAuthorityDisposition::DurableDelete
    );
    tokio::time::timeout(Duration::from_secs(1), async {
        while state.read.connection_has_auth_scoped_live(&connection_id) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("rotation purges the old watch's subscription topology");

    // A fresh subscription restarted under the successor generation
    // carries the new generation's server-derived block; the terminated
    // predecessor watch is gone, not resumable.
    let mut mint = auth_http_request(
        "POST",
        "/auth/agents/token",
        serde_json::to_vec(&json!({
            "credential": successor_credential,
            "grantId": grant_id,
        }))
        .unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut mint);
    let minted = router.clone().oneshot(mint).await.unwrap();
    assert_eq!(minted.status(), StatusCode::OK);
    let successor_token = response_json(minted).await["token"]
        .as_str()
        .unwrap()
        .to_owned();
    let (successor_connection_id, successor_connection_token) =
        open_service_connection(&router, &successor_token).await;
    let stale_resume = router
        .clone()
        .oneshot(live_request(
            "/live/liveItems/resume",
            &successor_connection_token,
            json!({
                "subscription_id": subscription_id,
                "connection_id": successor_connection_id,
            }),
        ))
        .await
        .unwrap();
    assert_ne!(
        stale_resume.status(),
        StatusCode::OK,
        "the rotated-away watch must not be resumable"
    );
    let restarted = subscribe_live_items(
        &router,
        &successor_connection_id,
        &successor_connection_token,
        2,
    )
    .await;
    assert_eq!(restarted["attribution"], expected_attribution);
    assert_ne!(
        restarted["subscription_id"].as_str().unwrap(),
        subscription_id,
        "the successor watch is a fresh establishment, not the old one"
    );
}

#[tokio::test]
async fn unpolled_http_batch_is_suppressed_and_requeued_after_authority_mismatch() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("mismatch HTTP fixture"));
    let opened = state
        .connections
        .open(Some("mismatch-http".to_owned()), None, true)
        .expect("open predecessor grant");
    let act = state
        .connections
        .prepare_act(
            &opened.connection_id,
            Some(&opened.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare predecessor HTTP act");
    let response = leased_outbox_http_response(&state, act, b"mismatch-preserved");

    let (replacement_incarnation, replacement_publication) =
        FencedPublication::anonymous_for_unmanaged_dev_connection();
    let mismatch_authority = synthetic_session_bound(
        &replacement_incarnation,
        "mismatch-session",
        "mismatch-user",
        "email-code",
        1,
        u64::MAX,
        replacement_publication,
    );
    let mismatch = state
        .connections
        .open_prepared(ConnectionOpenAttempt::new(
            Some(opened.connection_id.clone()),
            Some(&opened.connection_token),
            true,
            synthetic_connection_authority(mismatch_authority),
            super::now_millis(),
            Instant::now(),
            None,
        ))
        .expect_err("different immutable authority retires the predecessor");
    assert_eq!(
        mismatch.diagnostic.code,
        "SNAPBACK_CONNECTION_AUTHORITY_MISMATCH"
    );

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("poll retired leased body");
    assert!(body.is_empty(), "retired HTTP ownership publishes no bytes");
    let retry = state.ephemeral.drain_outbox(&opened.connection_id);
    assert!(matches!(
        retry.as_slice(),
        [RealtimeEnvelope::Durable(message)] if message.payload == b"mismatch-preserved"
    ));
}

#[tokio::test]
async fn no_lease_projection_still_revalidates_exact_grant_at_first_poll() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("direct HTTP fixture"));
    let opened = state
        .connections
        .open(Some("direct-http".to_owned()), None, true)
        .expect("open direct-projection grant");
    let act = state
        .connections
        .prepare_act(
            &opened.connection_id,
            Some(&opened.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare direct-projection act");
    let mut response = Json(vec![RealtimeEnvelope::Durable(
        crate::ephemeral::DurableMessage::new(b"direct-projection".to_vec()),
    )])
    .into_response();
    super::retain_realtime_handoff_in(
        &mut response,
        Vec::new(),
        Vec::new(),
        Some(super::RetainedConnectionHandoff {
            connections: state.connections.clone(),
            ephemeral: state.ephemeral.clone(),
            connection_act: act,
            auth_provider: None,
        }),
    );
    let admission = test_route_admission(&state).0;
    let policy = super::route_registry()
        .into_iter()
        .find(|spec| spec.path == "/outbox/{connection_id}")
        .unwrap()
        .effective_for(PolicyAuthMode::Dev);
    let response = finish_registered_response(policy, response, Some(&admission), None);

    let (incarnation, publication) = FencedPublication::anonymous_for_unmanaged_dev_connection();
    let mismatch = synthetic_session_bound(
        &incarnation,
        "direct-session",
        "direct-user",
        "email-code",
        1,
        u64::MAX,
        publication,
    );
    state
        .connections
        .open_prepared(ConnectionOpenAttempt::new(
            Some(opened.connection_id),
            Some(&opened.connection_token),
            true,
            synthetic_connection_authority(mismatch),
            super::now_millis(),
            Instant::now(),
            None,
        ))
        .expect_err("mismatch retires no-lease response owner");
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("poll direct response");
    assert!(body.is_empty());
}

#[tokio::test]
async fn projection_only_http_body_loses_to_marker_installed_after_selection() {
    let state =
        test_detached_app_state(LocalSnapback::memory().expect("projection marker fixture"));
    let opened = state
        .connections
        .open(Some("projection-marker-http".to_owned()), None, true)
        .expect("open projection response grant");
    let act = state
        .connections
        .prepare_act(
            &opened.connection_id,
            Some(&opened.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare projection response act");
    let fence = act.effect_fence();
    state.ephemeral.touch_connection(&opened.connection_id);
    let mut response = Json(vec![RealtimeEnvelope::Durable(
        crate::ephemeral::DurableMessage::new(b"direct-projection".to_vec()),
    )])
    .into_response();
    super::retain_realtime_handoff_in(
        &mut response,
        Vec::new(),
        Vec::new(),
        Some(super::RetainedConnectionHandoff {
            connections: state.connections.clone(),
            ephemeral: state.ephemeral.clone(),
            connection_act: act,
            auth_provider: None,
        }),
    );
    let admission = test_route_admission(&state).0;
    let policy = super::route_registry()
        .into_iter()
        .find(|spec| spec.path == "/outbox/{connection_id}")
        .unwrap()
        .effective_for(PolicyAuthMode::Dev);
    let response = finish_registered_response(policy, response, Some(&admission), None);

    state
        .ephemeral
        .overflow_outbox_for_test(&opened.connection_id, Some(fence.clone()));
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("poll projection response after marker installation");
    assert!(
        body.is_empty(),
        "projection cannot overtake recovery marker"
    );

    let retry = state
        .ephemeral
        .drain_outbox_for_send_bound_if_active(&opened.connection_id, &fence)
        .expect("connection activity remains live");
    assert_eq!(retry.len(), 1);
    assert!(retry[0].is_recovery_marker());
}

#[tokio::test]
async fn http_unbound_ordinary_lease_loses_to_later_exact_marker() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("HTTP marker fixture"));
    let opened = state
        .connections
        .open(Some("unbound-exact-marker-http".to_owned()), None, true)
        .expect("open HTTP response grant");
    let act = state
        .connections
        .prepare_act(
            &opened.connection_id,
            Some(&opened.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare HTTP response act");
    let fence = act.effect_fence();
    let response = leased_outbox_http_response(&state, act, b"unbound-ordinary");
    state
        .ephemeral
        .overflow_outbox_for_test(&opened.connection_id, Some(fence.clone()));

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("poll ordinary response after exact overflow");
    assert!(
        body.is_empty(),
        "ordinary bytes cannot overtake exact recovery"
    );
    let retry = state
        .ephemeral
        .drain_outbox_for_send_bound_if_active(&opened.connection_id, &fence)
        .expect("connection activity remains live");
    assert_eq!(retry.len(), 1);
    assert!(retry[0].is_recovery_marker());
}

#[tokio::test]
async fn http_exact_ordinary_lease_loses_to_later_unbound_marker() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("HTTP marker fixture"));
    let opened = state
        .connections
        .open(Some("exact-unbound-marker-http".to_owned()), None, true)
        .expect("open HTTP response grant");
    let act = state
        .connections
        .prepare_act(
            &opened.connection_id,
            Some(&opened.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare HTTP response act");
    let fence = act.effect_fence();
    let response = leased_bound_outbox_http_response(&state, act, b"exact-ordinary");
    state
        .ephemeral
        .overflow_outbox_for_test(&opened.connection_id, None);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("poll ordinary response after global overflow");
    assert!(
        body.is_empty(),
        "ordinary bytes cannot overtake global recovery"
    );
    let retry = state
        .ephemeral
        .drain_outbox_for_send_bound_if_active(&opened.connection_id, &fence)
        .expect("connection activity remains live");
    assert_eq!(retry.len(), 1);
    assert!(retry[0].is_recovery_marker());
}

#[tokio::test]
async fn http_exact_marker_lease_loses_to_later_unbound_marker() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("HTTP marker rank fixture"));
    let opened = state
        .connections
        .open(Some("exact-marker-rank-http".to_owned()), None, true)
        .expect("open HTTP response grant");
    let act = state
        .connections
        .prepare_act(
            &opened.connection_id,
            Some(&opened.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare HTTP response act");
    let fence = act.effect_fence();
    state
        .ephemeral
        .overflow_outbox_for_test(&opened.connection_id, Some(fence.clone()));
    let response = leased_queued_outbox_http_response(&state, act);
    state
        .ephemeral
        .overflow_outbox_for_test(&opened.connection_id, None);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("poll exact marker response after global overflow");
    assert!(
        body.is_empty(),
        "a selected exact marker cannot overtake broader recovery"
    );
    let retry = state
        .ephemeral
        .drain_outbox_for_send_bound_if_active(&opened.connection_id, &fence)
        .expect("connection activity remains live");
    assert_eq!(retry.len(), 1);
    let RealtimeEnvelope::Durable(marker) = retry[0].envelope() else {
        panic!("expected global durable recovery marker");
    };
    let marker = serde_json::from_slice::<Value>(&marker.payload).expect("marker JSON");
    assert_eq!(marker["kind"], "resync_required");
}

#[tokio::test]
async fn websocket_projection_offer_loses_to_marker_installed_after_selection() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("WS marker fixture"));
    let opened = state
        .connections
        .open(Some("projection-marker-ws".to_owned()), None, true)
        .expect("open WS projection grant");
    let act = state
        .connections
        .prepare_act(
            &opened.connection_id,
            Some(&opened.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare WS projection act");
    let fence = act.effect_fence();
    state.ephemeral.touch_connection(&opened.connection_id);
    let notifier = state.ephemeral.delivery_notifier();
    let (generation, _waker) = notifier
        .register_bound(&opened.connection_id, act.grant_id.clone())
        .expect("register exact WS projection owner");
    // Projection computation/selection happened before this point. The
    // final writer offer must still observe this newly installed marker.
    state
        .ephemeral
        .overflow_outbox_for_test(&opened.connection_id, Some(fence.clone()));
    let admission = test_route_admission(&state).0;
    let (writer, mut writes) = tokio::sync::mpsc::channel(1);
    let outcome = super::send_live_with_admission(
        super::LiveHandoffCut {
            writer: &writer,
            notify: &notifier,
            connection_id: &opened.connection_id,
            generation,
            connections: &state.connections,
            connection_act: &act,
        },
        super::Message::Text("direct-projection".into()),
        &admission,
        None,
        None,
        Some(&state.ephemeral),
    )
    .await;
    assert_eq!(outcome, super::LiveHandoffOutcome::Superseded);
    assert!(
        writes.try_recv().is_err(),
        "projection never crosses the bounded writer cut"
    );
    let retry = state
        .ephemeral
        .drain_outbox_for_send_bound_if_active(&opened.connection_id, &fence)
        .expect("connection activity remains live");
    assert_eq!(retry.len(), 1);
    assert!(retry[0].is_recovery_marker());
}

/// @ref LLP 0094#0c8-sessions-live-update-envelope-and-delivery-multiplicity —
/// one sessions mutation publishes one obligation-backed snapshot source, so
/// the exact stream drain must hand off one frame for that subscription/version.
#[tokio::test]
async fn sessions_live_update_stream_sends_one_frame_per_subscription_version() {
    let connection_id = "sessions-one-frame-per-version";
    let state = auth_projection_http_fixture(connection_id, 0, 0);
    let credential = mint_test_credential(&state, "one-frame@example.test").await;
    let bearer = credential["token"].as_str().expect("credential token");
    let (_opened, connection_act) =
        prepare_invalidation_session_connection_act(&state, bearer, connection_id);
    state.ephemeral.touch_connection(connection_id);
    let notifier = state.ephemeral.delivery_notifier();
    let (generation, waker) = notifier
        .register_bound(connection_id, connection_act.grant_id.clone())
        .expect("register exact sessions stream owner");
    let admission = test_route_admission(&state).0;

    let subscribe_authority = InvocationGate::prepare_admitted_subjectless_authority(
        InvocationSource::LiveInitialQuery,
        AuthMode::Sessions,
        state.server.profile,
        admission.clone(),
        &WireAuthorityFields::default(),
        connection_act.resolved.clone(),
        test_session_claims_for(&connection_act.resolved),
    )
    .expect("prepare sessions live authority")
    .with_fenced_publication(connection_act.bound.publication().clone());
    let effect_fence = connection_act.effect_fence();
    let invalidation = connection_act.authorization_invalidation.clone();
    let subscribed = with_snapback(&state.snapback, {
        let connection_id = connection_id.to_owned();
        move |snapback| {
            snapback_engine::test_support::subscribe_live_prepared_with_invalidation(
                snapback,
                "listItems",
                LiveSubscribeInput {
                    connection_id,
                    input: HandlerInput::default(),
                    authorization_namespace: Some(QueryNamespace {
                        client_store_id: "sessions_one_frame_store".to_owned(),
                        query_key: "listItems:{}".to_owned(),
                        query_instance_id: 91_001,
                    }),
                    supersedes: None,
                    resume_from_token: None,
                },
                subscribe_authority,
                snapback_engine::test_support::live_invalidation_admission(
                    invalidation.expect("negotiated invalidation descriptor"),
                    true,
                ),
            )
        }
    })
    .await
    .expect("install one sessions subscription");

    let mutation_response = app(state.clone())
        .oneshot(session_auth_http_request(
            "/mutation/insertItem",
            serde_json::to_vec(&json!({
                "args": { "value": "one committed change" },
            }))
            .expect("serialize sessions mutation"),
            bearer,
        ))
        .await
        .expect("invoke one sessions mutation through the production route");
    let mutation_status = mutation_response.status();
    let mutation = response_json(mutation_response).await;
    assert_eq!(mutation_status, StatusCode::OK, "{mutation}");
    tokio::time::timeout(Duration::from_secs(1), waker.notified())
        .await
        .expect("mutation wakes the sessions stream");

    let (writer, mut writes) = tokio::sync::mpsc::channel(4);
    let capture = tokio::spawn(async move {
        let mut frames = Vec::new();
        while let Some(write) = writes.recv().await {
            let super::AdmittedLiveWrite {
                message,
                admission: _write_admission,
                _publication_authority,
                completed,
            } = write;
            if let super::Message::Text(text) = message {
                frames.push(text.to_string());
            }
            let _ = completed.send(true);
        }
        frames
    });
    let outcome = super::drain_and_send(super::LiveDrain {
        state: &state.snapback,
        ephemeral: &state.ephemeral,
        connection_id,
        generation,
        writer: &writer,
        notify: &notifier,
        admission: &admission,
        connections: &state.connections,
        connection_act: &connection_act,
        reproject_authorization: true,
    })
    .await;
    assert_eq!(outcome, std::ops::ControlFlow::Continue(()));
    drop(writer);
    let frames = capture.await.expect("frame capture task");
    assert_eq!(frames.len(), 1, "one mutation must hand off one frame");
    assert!(
        futures_util::FutureExt::now_or_never(waker.notified()).is_none(),
        "the handoff must not schedule an immediate duplicate drain"
    );
    let frame = serde_json::from_str::<Value>(&frames[0]).expect("sessions frame JSON");
    assert_eq!(frame["kind"], "authorization_invalidation");
    assert_eq!(
        frame["snapshot"]["subscriptionId"],
        subscribed.subscription_id
    );
    assert_eq!(frame["snapshot"]["version"], mutation["version"]);
}

#[test]
fn websocket_selected_marker_defers_precomputed_projections_and_emits_alone() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("WS marker-alone fixture"));
    let opened = state
        .connections
        .open(Some("marker-alone-ws".to_owned()), None, true)
        .expect("open WS marker owner");
    let act = state
        .connections
        .prepare_act(
            &opened.connection_id,
            Some(&opened.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare WS marker owner");
    state.ephemeral.touch_connection(&opened.connection_id);
    state
        .ephemeral
        .overflow_outbox_for_test(&opened.connection_id, Some(act.effect_fence()));
    let messages = state
        .ephemeral
        .drain_outbox_for_send_bound_if_active(&opened.connection_id, &act.effect_fence())
        .expect("active WS marker drain");
    let mut projections = vec![crate::ephemeral::DurableMessage::new(
        b"precomputed-projection".to_vec(),
    )];

    super::defer_ws_projections_for_recovery_marker(&mut projections, &messages);
    assert!(projections.is_empty());
    assert_eq!(messages.len(), 1);
    assert!(messages[0].is_recovery_marker());
}

#[tokio::test]
async fn oversized_http_projection_returns_503_before_outbox_lease_and_stays_pending() {
    let connection_id = "oversized-projection-http";
    let state = auth_projection_http_fixture(connection_id, 1, 0)
        .with_projection_handoff_limit_for_test(1_000);
    let credential = mint_test_credential(&state, "oversized-projection@example.com").await;
    let bearer = credential["token"].as_str().expect("credential token");
    let (_opened, act) = prepare_invalidation_session_connection_act(&state, bearer, connection_id);
    state.ephemeral.touch_connection(connection_id);
    state.ephemeral.enqueue_durable_bound_for_test(
        connection_id,
        b"ordinary-after-projection-error".to_vec(),
        act.effect_fence(),
    );

    let error = direct_outbox_http_response(&state, &act)
        .await
        .expect_err("unsplittable server projection must fail closed");
    assert_eq!(
        error.0.diagnostic.code,
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
    );
    assert_eq!(
        error.into_response().status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    let queued = state
        .ephemeral
        .drain_outbox_for_send_bound_if_active(connection_id, &act.effect_fence())
        .expect("connection activity remains live");
    assert!(queued.iter().any(|admitted| {
        matches!(
            admitted.envelope(),
            RealtimeEnvelope::Durable(message)
                if message.payload == b"ordinary-after-projection-error"
        )
    }));
    drop(queued);
    let repeated = direct_outbox_http_response(&state, &act)
        .await
        .expect_err("failed projection obligation remains pending");
    assert_eq!(
        repeated.0.diagnostic.code,
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
    );
}

#[tokio::test]
async fn leased_marker_suppresses_http_projection_then_marker_emits_alone_before_retry() {
    let connection_id = "leased-marker-projection-http";
    let state = auth_projection_http_fixture(connection_id, 1, 0);
    let credential = mint_test_credential(&state, "marker-projection@example.com").await;
    let bearer = credential["token"].as_str().expect("credential token");
    let (_opened, act) = prepare_invalidation_session_connection_act(&state, bearer, connection_id);
    state.ephemeral.touch_connection(connection_id);
    state
        .ephemeral
        .overflow_outbox_for_test(connection_id, Some(act.effect_fence()));
    let leased_marker = state
        .ephemeral
        .drain_outbox_for_send_bound_if_active(connection_id, &act.effect_fence())
        .expect("active marker lease");
    assert_eq!(leased_marker.len(), 1);
    assert!(leased_marker[0].is_recovery_marker());

    let suppressed = direct_outbox_http_response(&state, &act)
        .await
        .expect("leased marker suppresses handler projections");
    let suppressed = to_bytes(suppressed.into_body(), usize::MAX)
        .await
        .expect("poll suppressed projection body");
    assert!(
        suppressed.is_empty(),
        "another response's leased marker remains the publication owner"
    );
    for marker in leased_marker {
        marker.release_handoff();
    }

    let marker_response = direct_outbox_http_response(&state, &act)
        .await
        .expect("retry selects recovery marker");
    let marker_response = to_bytes(marker_response.into_body(), usize::MAX)
        .await
        .expect("poll recovery marker body");
    let marker_response = serde_json::from_slice::<Vec<RealtimeEnvelope>>(&marker_response)
        .expect("marker response JSON");
    assert_eq!(marker_response.len(), 1, "marker is emitted alone");
    let RealtimeEnvelope::Durable(marker) = &marker_response[0] else {
        panic!("expected durable recovery marker");
    };
    let marker = serde_json::from_slice::<Value>(&marker.payload).expect("marker payload");
    assert_eq!(marker["kind"], "resync_required");

    let projection_response = direct_outbox_http_response(&state, &act)
        .await
        .expect("post-marker poll regenerates pending projection");
    let projection_response = to_bytes(projection_response.into_body(), usize::MAX)
        .await
        .expect("poll regenerated projection body");
    let projection_response = serde_json::from_slice::<Vec<RealtimeEnvelope>>(&projection_response)
        .expect("projection response JSON");
    assert!(projection_response.iter().any(|envelope| {
        let RealtimeEnvelope::Durable(message) = envelope else {
            return false;
        };
        serde_json::from_slice::<Value>(&message.payload)
            .is_ok_and(|payload| payload["kind"] == "authorization_invalidation")
    }));
}

#[tokio::test]
async fn cancelled_mode_root_releases_http_batch_at_eof_while_body_is_retained() {
    use http_body::Body as _;

    let state = test_detached_app_state(LocalSnapback::memory().expect("cancelled HTTP fixture"));
    let opened = state
        .connections
        .open(Some("cancelled-http".to_owned()), None, true)
        .expect("open cancelled-response grant");
    let act = state
        .connections
        .prepare_act(
            &opened.connection_id,
            Some(&opened.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare cancelled-response act");
    let response = leased_outbox_http_response(&state, act, b"cancelled-preserved");
    state
        .auth_admission_controller()
        .retire_current_epoch_for_test()
        .expect_err("retirement cancels the retained response root at zero timeout");

    let mut body = response.into_body();
    let first =
        std::future::poll_fn(|context| std::pin::Pin::new(&mut body).poll_frame(context)).await;
    assert!(first.is_none(), "cancelled root exposes EOF without bytes");
    assert!(
        body.is_end_stream(),
        "the latched authority failure is a terminal body state"
    );
    let retry = state.ephemeral.drain_outbox(&opened.connection_id);
    assert!(matches!(
        retry.as_slice(),
        [RealtimeEnvelope::Durable(message)] if message.payload == b"cancelled-preserved"
    ));
    drop(body);
}

#[tokio::test]
async fn unpolled_http_batch_is_suppressed_and_whole_id_cleaned_after_pressure_eviction() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("pressure HTTP fixture"));
    let opened = state
        .connections
        .open(Some("pressure-http".to_owned()), None, true)
        .expect("open pressure victim");
    let act = state
        .connections
        .prepare_act(
            &opened.connection_id,
            Some(&opened.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare pressure-victim HTTP act");
    let response = leased_outbox_http_response(&state, act, b"pressure-preserved");

    for index in 0..(MAX_CONNECTION_GRANTS - 1) {
        state
            .connections
            .open(Some(format!("pressure_http_{index}")), None, true)
            .expect("fill bounded connection registry");
    }
    {
        let mut grants = state.connections.lock();
        let ids = grants.grants.keys().cloned().collect::<Vec<_>>();
        grants.unused.clear();
        grants.used.clear();
        for id in ids {
            let last_use_ms = u64::from(id != opened.connection_id);
            let record = grants.grants.get_mut(&id).expect("grant record");
            record.used = true;
            record.last_use_ms = last_use_ms;
            grants.used.insert((last_use_ms, id));
        }
    }
    state
        .connections
        .open(Some("after-http-pressure".to_owned()), None, true)
        .expect("idle pressure victim makes bounded room");
    assert!(
        state
            .connections
            .verify(&opened.connection_id, Some(&opened.connection_token))
            .is_err(),
        "the response owner is the pressure victim"
    );

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("poll pressure-retired leased body");
    assert!(
        body.is_empty(),
        "pressure-retired HTTP ownership publishes no bytes"
    );
    tokio::time::timeout(Duration::from_secs(2), async {
        while state.ephemeral.active_connection_count_for_test() != 0
            || state
                .ephemeral
                .has_connection_residue_for_test(&opened.connection_id)
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("pressure-retired whole-ID cleanup removes activity");
    assert!(
        !state
            .ephemeral
            .has_connection_residue_for_test(&opened.connection_id),
        "mint-only pressure retirement removes the retired id's complete outbox"
    );
}

#[tokio::test]
async fn first_http_poll_uses_provider_clock_and_cannot_ack_expired_session_leaf() {
    let start_ms = 1_000_000;
    let (state, clock) = manual_clock_sessions_fixture(start_ms);
    let credential = mint_test_credential(&state, "leased-expiry@example.com").await;
    let bearer = credential["token"].as_str().expect("session bearer");
    let (opened, act) = prepare_session_connection_act(&state, bearer, "leased-expiry");
    let deadline_ms = match &act.bound {
        BoundGrantAuthority::Session { deadline_ms, .. } => *deadline_ms,
        BoundGrantAuthority::Anonymous { .. } | BoundGrantAuthority::ServicePrincipal { .. } => {
            panic!("expected session-bound act")
        }
    };
    let response = leased_outbox_http_response(&state, act, b"expiry-preserved");

    clock.set(deadline_ms.saturating_add(1));
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("poll fake-clock-expired leased body");
    assert!(
        body.is_empty(),
        "expired leaf cannot expose or acknowledge bytes"
    );
    let retry = state.ephemeral.drain_outbox(&opened.grant.connection_id);
    assert!(matches!(
        retry.as_slice(),
        [RealtimeEnvelope::Durable(message)] if message.payload == b"expiry-preserved"
    ));
}

#[tokio::test]
async fn finalized_revocation_between_http_selection_and_first_poll_suppresses_batch() {
    let (state, _clock) = manual_clock_sessions_fixture(2_000_000);
    let credential = mint_test_credential(&state, "leased-revoke@example.com").await;
    let bearer = credential["token"].as_str().expect("session bearer");
    let (opened, act) = prepare_session_connection_act(&state, bearer, "leased-revoke");
    let (incarnation, session_id, generation) = match &act.bound {
        BoundGrantAuthority::Session {
            authorization_stream_incarnation,
            session_id,
            generation,
            ..
        } => (
            authorization_stream_incarnation.clone(),
            session_id.clone(),
            *generation,
        ),
        BoundGrantAuthority::Anonymous { .. } | BoundGrantAuthority::ServicePrincipal { .. } => {
            panic!("expected session-bound act")
        }
    };
    let response = leased_outbox_http_response(&state, act, b"revoke-preserved");

    state.auth_terminal_lifecycle.terminate_session_generation(
        &incarnation,
        &session_id,
        generation,
        crate::live_wire::LiveAuthErrorReason::Revoked,
        Instant::now() + Duration::from_secs(5),
    );
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("poll revoked leased HTTP body");
    assert!(body.is_empty(), "revoked grant cannot publish or ack bytes");
    let retry = state.ephemeral.drain_outbox(&opened.grant.connection_id);
    assert!(matches!(
        retry.as_slice(),
        [RealtimeEnvelope::Durable(message)] if message.payload == b"revoke-preserved"
    ));
}

#[tokio::test]
async fn committed_reset_between_http_selection_and_first_poll_suppresses_batch() {
    let (state, _clock) = manual_clock_sessions_fixture(3_000_000);
    let credential = mint_test_credential(&state, "leased-reset@example.com").await;
    let bearer = credential["token"].as_str().expect("session bearer");
    let (opened, act) = prepare_session_connection_act(&state, bearer, "leased-reset");
    let response = leased_outbox_http_response(&state, act, b"reset-preserved");

    state.auth_terminal_lifecycle.committed_stream_reset(
        crate::live_wire::LiveAuthErrorReason::Reset,
        Instant::now() + Duration::from_secs(5),
    );
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("poll reset leased HTTP body");
    assert!(body.is_empty(), "reset grant cannot publish or ack bytes");
    let retry = state.ephemeral.drain_outbox(&opened.grant.connection_id);
    assert!(matches!(
        retry.as_slice(),
        [RealtimeEnvelope::Durable(message)] if message.payload == b"reset-preserved"
    ));
}

#[tokio::test]
async fn coalescing_replacement_between_http_selection_and_first_poll_retries_latest() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("coalesce HTTP fixture"));
    let opened = state
        .connections
        .open(Some("coalesce-http".to_owned()), None, true)
        .expect("open coalesce grant");
    let act = state
        .connections
        .prepare_act(
            &opened.connection_id,
            Some(&opened.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare coalesce HTTP act");
    let upsert = |value: &[u8], entry_version| crate::ephemeral::EphemeralMessage::Upsert {
        ephemeral_authority_instance: None,
        room: crate::ephemeral::RoomId {
            collection: "cursors".to_owned(),
            scope: crate::ephemeral::Scope::default(),
            routing_key: "room".to_owned(),
        },
        room_authority_generation: 0,
        entry: crate::ephemeral::EphemeralEntry {
            key: crate::ephemeral::EntryKey("cursor".to_owned()),
            value: value.to_vec(),
            received_at_ms: 1,
            expires_at_ms: 10_000,
            scope_epoch: 1,
            entry_version,
        },
    };
    state
        .ephemeral
        .enqueue_ephemeral_for_test(&opened.connection_id, upsert(b"old", 1), None);
    let response = leased_queued_outbox_http_response(&state, act.clone());
    state
        .ephemeral
        .enqueue_ephemeral_for_test(&opened.connection_id, upsert(b"new", 2), None);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("poll superseded coalesced HTTP body");
    assert!(
        body.is_empty(),
        "superseded lease cannot acknowledge old state"
    );
    let retry = state
        .ephemeral
        .drain_outbox_for_send_bound_if_active(&opened.connection_id, &act.effect_fence())
        .expect("connection activity remains live");
    assert_eq!(retry.len(), 1);
    assert!(matches!(
        retry[0].envelope(),
        RealtimeEnvelope::Ephemeral(crate::ephemeral::EphemeralMessage::Upsert {
            entry,
            ..
        }) if entry.value == b"new" && entry.entry_version == 2
    ));
}

#[test]
fn prepared_handoff_linearizes_before_concurrent_mismatch_retirement() {
    use std::sync::mpsc;

    let registry = ConnectionRegistry::default();
    let (incarnation, publication) = FencedPublication::anonymous_for_unmanaged_dev_connection();
    let opened = registry
        .open_prepared(ConnectionOpenAttempt::new(
            Some("paused-handoff".to_owned()),
            None,
            true,
            synthetic_connection_authority(BoundGrantAuthority::Anonymous {
                authorization_stream_incarnation: incarnation,
                publication,
            }),
            1,
            Instant::now(),
            None,
        ))
        .expect("open handoff grant");
    let act = registry
        .prepare_act(
            &opened.grant.connection_id,
            Some(&opened.grant.connection_token),
            None,
            true,
            2,
            Instant::now(),
        )
        .expect("prepare handoff act");
    let sink_registry = registry.clone();
    let (capture_tx, capture_rx) = mpsc::channel();
    registry.install_retirement_sink(move |capture| {
        assert!(
            sink_registry.grants.try_lock().is_ok(),
            "retirement sink runs after the registry guard is released"
        );
        capture_tx.send(capture).unwrap();
    });

    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let act_registry = registry.clone();
    let handoff = std::thread::spawn(move || {
        act.try_act(&act_registry, 2, Instant::now(), || {
            entered_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            Ok(())
        })
    });
    entered_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("handoff pauses after exact grant validation");

    let (mismatch_incarnation, mismatch_publication) =
        FencedPublication::anonymous_for_unmanaged_dev_connection();
    let retirement_registry = registry.clone();
    let retirement_connection_id = opened.grant.connection_id.clone();
    let retirement_connection_token = opened.grant.connection_token.clone();
    let (retired_tx, retired_rx) = mpsc::channel();
    let retirement = std::thread::spawn(move || {
        let mismatch_authority = synthetic_session_bound(
            &mismatch_incarnation,
            "paused-session",
            "paused-user",
            "email-code",
            1,
            u64::MAX,
            mismatch_publication,
        );
        let result = retirement_registry.open_prepared(ConnectionOpenAttempt::new(
            Some(retirement_connection_id),
            Some(&retirement_connection_token),
            true,
            synthetic_connection_authority(mismatch_authority),
            3,
            Instant::now(),
            None,
        ));
        retired_tx.send(result.map(|_| ())).unwrap();
    });
    assert!(
        retired_rx.recv_timeout(Duration::from_millis(30)).is_err(),
        "mismatch retirement waits while the bounded handoff owns the registry cut"
    );
    release_tx.send(()).unwrap();
    handoff
        .join()
        .expect("handoff thread joins")
        .expect("validated handoff wins before retirement");
    let retired = retired_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("retirement completes after handoff")
        .expect_err("mismatch still rejects reuse");
    assert_eq!(
        retired.diagnostic.code,
        "SNAPBACK_CONNECTION_AUTHORITY_MISMATCH"
    );
    let capture = capture_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("mismatch publishes the exact retirement capture");
    assert_eq!(capture.connection_id, opened.grant.connection_id);
    assert_eq!(capture.grant_id, opened.grant_id);
    retirement.join().expect("retirement thread joins");
}

/// A logout waiting for one already-admitted session predecessor must not
/// retain its provider planning admission across projection Begin. Once
/// that predecessor drains, cancellation may abandon only the HTTP waiter:
/// the independently owned durable transaction still settles the exact
/// carrier and propagates terminal lifecycle state.
///
/// @ref LLP 0059#plan-begin-commit-finalize — provider coordination is
/// released at the Begin handoff and a drained carrier is owned through
/// durable Commit and Finalize independently of the initiating request.
#[tokio::test]
async fn logout_begin_releases_provider_and_cancelled_waiter_cannot_cancel_finish() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = activate_test_sessions(state);
    let credential = mint_test_credential(&state, "logout-owned-finish@example.com").await;
    let bearer = credential["token"]
        .as_str()
        .expect("logout bearer")
        .to_owned();
    let (opened, connection_act) =
        prepare_session_connection_act(&state, &bearer, "logout-owned-finish");
    let (registration_generation, waker) = state
        .ephemeral
        .delivery_notifier()
        .register_bound(&opened.grant.connection_id, opened.grant_id)
        .expect("register exact session-bound socket");
    let provider = state.auth_provider.clone().expect("logout provider");
    let coordinator = state.auth_coordinator.clone().expect("logout coordinator");
    let epoch_now_ms = provider.now_ms();
    let monotonic_now = provider.monotonic_now();
    let predecessor = connection_act
        .reserve_authority_work(epoch_now_ms, monotonic_now)
        .expect("retain one session predecessor while logout begins");

    let pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterSessionTerminalOwnedSpawn,
    );
    let mut request = session_auth_http_request("/auth/logout", br#"{}"#.to_vec(), &bearer);
    request.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(pause.id()).expect("owned logout pause header"),
    );
    let router = app(state.clone());
    let logout_waiter = tokio::spawn(async move {
        router
            .oneshot(request)
            .await
            .expect("logout route response")
    });

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            match connection_act.reserve_authority_work(epoch_now_ms, monotonic_now) {
                Ok(probe) => drop(probe),
                Err(_) => return,
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("logout installs its exact pending projection marker");
    assert!(
        !logout_waiter.is_finished(),
        "logout still waits for its admitted session predecessor"
    );

    let maintenance =
        tokio::time::timeout(Duration::from_secs(1), provider.exclusive_maintenance())
            .await
            .expect("projection Begin does not retain provider planning admission");
    drop(maintenance);

    let local_blocker = state.snapback.clone().lock_owned().await;
    drop(predecessor);
    tokio::time::timeout(Duration::from_secs(2), pause.wait_until_reached())
        .await
        .expect("logout transfers the drained carrier into owned work");
    assert!(!logout_waiter.is_finished());
    logout_waiter.abort();
    assert!(logout_waiter.await.unwrap_err().is_cancelled());
    assert!(
        connection_act
            .reserve_authority_work(epoch_now_ms, monotonic_now)
            .is_err(),
        "dropping the HTTP waiter must not reopen the owned session carrier"
    );

    drop(local_blocker);
    assert_revocation_terminalized(
        &state,
        &opened.grant.connection_id,
        registration_generation,
        waker.as_ref(),
        crate::live_wire::LiveAuthorityDisposition::DurableDelete,
    )
    .await;
    let error = match coordinator.resolve_family_bearer(
        &bearer,
        provider.now_ms(),
        provider.monotonic_now(),
    ) {
        Ok(_) => panic!("owned logout transaction left the bearer current"),
        Err(error) => error,
    };
    assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_SESSION_EXPIRED");
}

/// @ref LLP 0059#plan-begin-commit-finalize — a known logout commit must
/// propagate terminal authority loss even when projection Finalize fails;
/// the original projection diagnostic remains the request outcome.
#[tokio::test]
async fn postcommit_logout_finalize_failure_still_terminalizes_exact_grant() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = activate_test_sessions(state);
    let credential = mint_test_credential(&state, "logout-finalize@example.com").await;
    let bearer = credential["token"].as_str().expect("logout bearer");
    let session_id = credential["session"]["id"]
        .as_str()
        .expect("logout session id")
        .to_owned();
    let generation = credential["authorityDescriptor"]["sessionGeneration"]
        .as_u64()
        .expect("logout session generation");
    let incarnation = state
        .auth_coordinator
        .as_ref()
        .expect("logout coordinator")
        .authorization_stream_incarnation()
        .expect("logout incarnation");
    let (connection_id, registration_generation, waker) =
        open_registered_session_connection(&state, bearer, "logout-finalize");
    let authority = prepared_provider_route_authority(&state, InvocationSource::AuthLogout, bearer);
    let coordinator = state.auth_coordinator.clone().expect("logout coordinator");
    coordinator.inject_finalize_failure();

    let error = super::auth_logout(
        State(state.clone()),
        authority,
        auth_provider_headers(Some(bearer)),
        Ok(Bytes::from_static(br#"{}"#)),
    )
    .await
    .expect_err("injected logout projection finalize failure");
    assert_eq!(
        error.0.diagnostic.code, "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
        "terminal propagation must not mask the projection diagnostic"
    );
    assert!(coordinator.requires_rebuild(&session_id).unwrap());
    assert_revocation_terminalized(
        &state,
        &connection_id,
        registration_generation,
        waker.as_ref(),
        crate::live_wire::LiveAuthorityDisposition::DurableDelete,
    )
    .await;

    state.auth_terminal_lifecycle.terminate_session_generation(
        &incarnation,
        &session_id,
        generation,
        crate::live_wire::LiveAuthErrorReason::Revoked,
        Instant::now() + crate::auth::session_projection::TERMINAL_CLOSE_GRACE,
    );
    assert!(
        state
            .ephemeral
            .delivery_notifier()
            .terminal_if_current(&connection_id, registration_generation)
            .is_some(),
        "duplicate propagation is idempotent and preserves the first terminal event"
    );
}

/// Admin/host minting shares this coordinator path. The twenty-first
/// committed session must terminalize the evicted predecessor even when
/// successor projection finalization fails and globally closes admission.
///
/// @ref LLP 0059#operation-specific-publication — cap eviction propagates
/// the exact predecessor terminal event after its joint durable commit.
#[tokio::test]
async fn postcommit_admin_mint_cap_finalize_failure_still_terminalizes_eviction() {
    let start_ms = super::now_millis();
    let clock = Arc::new(ManualServerAuthClock::new(start_ms));
    let mut snapback = LocalSnapback::memory().expect("manual-clock cap fixture");
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    snapback
        .remainder_auth_fixture()
        .activate_catalog(keyring.as_ref(), start_ms, &OsRandom)
        .expect("activate cap auth catalog");
    let provider = Arc::new(
        AuthProvider::new_with_dependencies(
            AuthProviderProfile::Test,
            keyring,
            Arc::new(OsRandom),
            clock.clone(),
        )
        .expect("construct manual-clock cap provider"),
    );
    let mut context = bound_loopback_context();
    context.profile = ServerProfile::Test;
    let state = activate_test_sessions(
        test_app_state_from_snapback(snapback, context)
            .with_policy_auth_mode(PolicyAuthMode::Sessions)
            .try_with_auth_provider(provider.clone())
            .expect("auth provider app state"),
    );
    let email = "admin-cap-finalize@example.com";
    let first = mint_test_credential(&state, email).await;
    for offset in 1..crate::auth::provider::AUTH_SESSION_LIVE_LIMIT {
        clock.set(start_ms + u64::try_from(offset).unwrap());
        let _ = mint_test_credential(&state, email).await;
    }
    let first_bearer = first["token"].as_str().expect("oldest cap bearer");
    let (connection_id, registration_generation, waker) =
        open_registered_session_connection(&state, first_bearer, "admin-cap-finalize");
    let coordinator = state.auth_coordinator.clone().expect("cap coordinator");
    coordinator.inject_finalize_failure();
    clock.set(start_ms + u64::try_from(crate::auth::provider::AUTH_SESSION_LIVE_LIMIT).unwrap());
    let admission = provider.admit_email(email).await.expect("admit cap email");
    let route_admission = test_route_admission(&state).0;

    let error =
        super::coordinated_mint_session(&state, &provider, admission, &route_admission, None)
            .await
            .expect_err("injected postcommit issuance finalize failure");
    assert_eq!(
        error.diagnostic.code, "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
        "terminal propagation must not mask the issuance diagnostic"
    );
    assert_eq!(
        coordinator
            .authorization_stream_incarnation()
            .expect_err("issuance failure keeps the coordinator globally closed")
            .diagnostic
            .code,
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
    );
    assert_revocation_terminalized(
        &state,
        &connection_id,
        registration_generation,
        waker.as_ref(),
        crate::live_wire::LiveAuthorityDisposition::Carrier,
    )
    .await;
}

/// Expiry already arrives as an authoritative projection result. Repeated
/// sink delivery must be harmless while the first delivery invalidates the
/// reverse-indexed grant and schedules terminal close.
#[tokio::test]
async fn authoritative_expiry_terminal_sink_is_idempotent() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = activate_test_sessions(state);
    let credential = mint_test_credential(&state, "expiry-terminal@example.com").await;
    let bearer = credential["token"].as_str().expect("expiry bearer");
    let session_id = credential["session"]["id"]
        .as_str()
        .expect("expiry session id")
        .to_owned();
    let generation = credential["authorityDescriptor"]["sessionGeneration"]
        .as_u64()
        .expect("expiry generation");
    let incarnation = state
        .auth_coordinator
        .as_ref()
        .expect("expiry coordinator")
        .authorization_stream_incarnation()
        .expect("expiry incarnation");
    let (connection_id, registration_generation, waker) =
        open_registered_session_connection(&state, bearer, "expiry-terminal");
    let expired = crate::auth::session_projection::ExpiredSession {
        authorization_stream_incarnation: incarnation,
        session_id,
        generation,
        close_by: Instant::now() + crate::auth::session_projection::TERMINAL_CLOSE_GRACE,
    };

    let terminal_sink = state.auth_terminal_lifecycle.expiry_sink();
    terminal_sink.consume_for_test(vec![expired.clone()]);
    terminal_sink.consume_for_test(vec![expired]);
    tokio::time::timeout(Duration::from_secs(1), waker.notified())
        .await
        .expect("expiry wakes the exact socket once");
    let notifier = state.ephemeral.delivery_notifier();
    let event = notifier
        .terminal_if_current(&connection_id, registration_generation)
        .expect("expiry terminal event installed");
    assert_eq!(event.reason, crate::live_wire::LiveAuthErrorReason::Expired);
    assert_eq!(
        event.authority_disposition,
        crate::live_wire::LiveAuthorityDisposition::Carrier
    );
    assert!(!notifier.is_deliverable(&connection_id, registration_generation));
    let registry = state.connections.lock();
    assert!(!registry.grants.contains_key(&connection_id));
    registry.assert_grant_indexes_consistent();
}

/// @ref LLP 0057#host-operation-dtos — ordinary dormant collisions use the
/// shared rescue core and exact six-field metadata projection; unlike the
/// stored-manifest recovery router, ordinary service remains live.
#[tokio::test]
async fn auth_rescue_host_op_returns_pinned_metadata_and_keeps_service_live() {
    let directory = tempfile::tempdir().unwrap();
    let database_path = directory.path().join("rescue.sqlite3");
    install_auth_collision_fixtures_for_test(
        &database_path,
        &[
            AuthCollisionFixtureTableForTest {
                name: "_auth_legacy_first".to_owned(),
                row: AuthCollisionFixtureRowForTest::Text(Some((
                    "one".to_owned(),
                    "first".to_owned(),
                ))),
                index: AuthCollisionFixtureIndexForTest::TextValue("legacy_first_value".to_owned()),
            },
            AuthCollisionFixtureTableForTest {
                name: "_auth_legacy_second".to_owned(),
                row: AuthCollisionFixtureRowForTest::Text(Some((
                    "two".to_owned(),
                    "second".to_owned(),
                ))),
                index: AuthCollisionFixtureIndexForTest::None,
            },
        ],
        None,
    )
    .unwrap();
    let snapback = LocalSnapback::open(&database_path).expect("open dormant collision");
    let provider = Arc::new(
        AuthProvider::new(
            AuthProviderProfile::Test,
            Arc::new(AuthKeyringStore::in_memory()),
        )
        .expect("construct rescue provider"),
    );
    let (registry, operator) =
        ImpersonationCapabilityRegistry::generate("auth-rescue-fixture".to_owned(), &OsRandom)
            .unwrap();
    let mut impersonation = None;
    operator
        .emit_once_to_terminal(|value| {
            impersonation = Some(value.to_owned());
            Ok(())
        })
        .unwrap();
    let impersonation = impersonation.unwrap();
    let mut context = bound_loopback_context();
    context.profile = ServerProfile::Test;
    context.admin_token = Some("auth-rescue-admin".to_owned());
    let state = test_app_state_from_snapback(snapback, context)
        .with_policy_auth_mode(PolicyAuthMode::Dev)
        .with_impersonation_capabilities(registry)
        .try_with_auth_provider(provider)
        .expect("auth provider app state");
    let router = app(state);

    let rescue = |source: &str, target: &str| {
        auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            serde_json::to_vec(&serde_json::json!({
                "operation": "auth.rescueCollidingTable",
                "args": { "sourceTable": source, "targetTable": target },
            }))
            .unwrap(),
            true,
            Some("auth-rescue-admin"),
            Some(&impersonation),
        )
    };
    let first = router
        .clone()
        .oneshot(rescue("_auth_legacy_first", "legacy_auth_first"))
        .await
        .expect("first collision rescue");
    assert_eq!(first.status(), StatusCode::OK);
    let first = response_json(first).await;
    assert_eq!(first["ok"], true, "{first}");
    assert_eq!(
        first["data"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            "catalogCollisionCleared".to_owned(),
            "copiedExplicitIndexCount".to_owned(),
            "copiedRowCount".to_owned(),
            "manifestUpdated".to_owned(),
            "source".to_owned(),
            "target".to_owned(),
        ])
    );
    assert_eq!(first["data"]["source"], "_auth_legacy_first");
    assert_eq!(first["data"]["target"], "legacy_auth_first");
    assert_eq!(first["data"]["copiedRowCount"], 1);
    assert_eq!(first["data"]["copiedExplicitIndexCount"], 1);

    let inspect = router
        .clone()
        .oneshot(auth_http_request(
            "GET",
            "/inspect",
            Vec::new(),
            false,
            None,
            None,
        ))
        .await
        .expect("ordinary app service remains live");
    assert_eq!(inspect.status(), StatusCode::OK);
    let health = router
        .clone()
        .oneshot(auth_http_request(
            "GET",
            "/health",
            Vec::new(),
            false,
            None,
            None,
        ))
        .await
        .expect("health remains available");
    assert_eq!(health.status(), StatusCode::OK);

    let second = router
        .oneshot(rescue("_auth_legacy_second", "legacy_auth_second"))
        .await
        .expect("repeated collision rescue");
    assert_eq!(second.status(), StatusCode::OK);
    let second = response_json(second).await;
    assert_eq!(second["ok"], true, "{second}");
    assert!(second["data"].get("restartRequired").is_none());
}

#[test]
fn connection_credential_debug_is_redacted() {
    const SENTINEL: &str = "CONNECTION_CREDENTIAL_SENTINEL_MUST_NOT_ESCAPE";
    let grant = ConnectionGrant {
        connection_id: "conn_debug".to_owned(),
        connection_token: SENTINEL.to_owned(),
        dev_identity_capability_witnessed: Some(true),
        authorization_invalidation: None,
        wire_version: Some(crate::wire_version::WIRE_VERSION_V1.to_owned()),
        ephemeral_authority_protocol: Some(crate::ephemeral::EPHEMERAL_AUTHORITY_PROTOCOL_V1),
        ephemeral_authority_instance: Some(format!("eai1.{}", "a".repeat(43))),
        hosted_ephemeral_authority_required: true,
        ephemeral_expiry_protocol: Some(crate::ephemeral::EPHEMERAL_EXPIRY_PROTOCOL_V1),
    };
    let grant_debug = format!("{grant:?}");
    assert!(!grant_debug.contains(SENTINEL), "{grant_debug}");
    assert!(grant_debug.contains("[REDACTED]"), "{grant_debug}");

    let open = OpenConnectionRequest {
        connection_id: Some("conn_debug".to_owned()),
        previous_token: Some(SENTINEL.to_owned()),
        auth_invalidation_protocol: None,
        wire_version: Some(crate::wire_version::WIRE_VERSION_V1.to_owned()),
        ephemeral_authority_protocol: Some(crate::ephemeral::EPHEMERAL_AUTHORITY_PROTOCOL_V1),
        ephemeral_expiry_protocol: Some(crate::ephemeral::EPHEMERAL_EXPIRY_PROTOCOL_V1),
    };
    let open_debug = format!("{open:?}");
    assert!(!open_debug.contains(SENTINEL), "{open_debug}");
    assert!(open_debug.contains("[REDACTED]"), "{open_debug}");
}

#[test]
fn anonymous_stream_reset_refusal_is_retryable_carrier() {
    let (authorization_stream_incarnation, publication) =
        FencedPublication::anonymous_for_unmanaged_dev_connection();
    let error = BoundGrantAuthority::Anonymous {
        authorization_stream_incarnation,
        publication,
    }
    .stale_error_at(super::now_millis());

    assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_STREAM_RESET");
    assert_eq!(error.diagnostic.details["retryable"], json!(true));
    assert_eq!(
        error.diagnostic.details["authorityDisposition"],
        json!("carrier")
    );
}

#[test]
fn hosted_sender_binding_mints_and_rotates_only_sct2_grants() {
    let state = test_detached_app_state(
        LocalSnapback::memory().expect("in-memory hosted sender registry state"),
    );
    let registry = state.connections.clone();
    let (incarnation, publication) = FencedPublication::anonymous_for_unmanaged_dev_connection();
    let mut prepared = synthetic_connection_authority(BoundGrantAuthority::Anonymous {
        authorization_stream_incarnation: incarnation,
        publication,
    });
    let binding = super::HostedSenderGrantBinding {
        jwk_thumbprint: "test-jwk-thumbprint".to_owned(),
        sender_replay_epoch_at_issuance: 9,
    };
    prepared.hosted_sender = Some(binding.clone());
    let opened = registry
        .open_prepared(ConnectionOpenAttempt::new(
            None,
            None,
            false,
            prepared,
            super::now_millis(),
            Instant::now(),
            None,
        ))
        .expect("open sender-bound grant");
    assert!(opened.grant.connection_token.starts_with("sct2_"));
    assert_eq!(
        registry.hosted_sender_for_presented_grant(Some(&opened.grant.connection_token)),
        Some(binding),
    );

    let rotated = registry
        .rotate_grant_token(&opened.grant.connection_id, &opened.grant_id)
        .expect("rotate sender-bound grant");
    assert!(rotated.starts_with("sct2_"));
    assert!(
        registry
            .hosted_sender_for_presented_grant(Some(&opened.grant.connection_token))
            .is_none(),
        "the predecessor token is dead after rotation",
    );
}

/// ENG-23442 — grant semantics: adopted suggestions, collision minting,
/// prod minting, and token verification outcomes.
#[test]
fn connection_registry_grants_and_verifies() {
    let registry = ConnectionRegistry::default();

    let adopted = registry
        .open(Some("readable".to_owned()), None, true)
        .expect("adopt grant");
    assert_eq!(adopted.connection_id, "readable");
    assert!(adopted.connection_token.starts_with("sct_"));

    // A colliding suggestion mints instead of rotating the live grant.
    let collided = registry
        .open(Some("readable".to_owned()), None, true)
        .expect("mint collision grant");
    assert_ne!(collided.connection_id, "readable");
    assert!(collided.connection_id.starts_with("conn_"));
    assert!(
        registry
            .verify("readable", Some(&adopted.connection_token))
            .is_ok(),
        "the original grant must survive a colliding open"
    );

    // Idempotent re-open: presenting the current token returns the same
    // grant (any profile) — a wrong previous token mints instead.
    let reopened = registry
        .open(
            Some("readable".to_owned()),
            Some(&adopted.connection_token),
            false,
        )
        .expect("reopen grant");
    assert_eq!(reopened.connection_id, "readable");
    assert_eq!(reopened.connection_token, adopted.connection_token);
    let stolen = registry
        .open(Some("readable".to_owned()), Some("sct_wrong"), true)
        .expect("wrong bearer mints");
    assert_ne!(stolen.connection_id, "readable");

    // Prod never adopts caller-selected ids.
    let minted = registry
        .open(Some("chosen".to_owned()), None, false)
        .expect("prod mint");
    assert!(minted.connection_id.starts_with("conn_"));

    // Verification: missing token, unknown connection, mismatched token.
    assert!(registry.verify("readable", None).is_err());
    assert!(registry.verify("never_opened", Some("sct_x")).is_err());
    assert!(
        registry
            .verify("readable", Some(&collided.connection_token))
            .is_err()
    );
    assert!(
        registry
            .verify(&collided.connection_id, Some(&collided.connection_token))
            .is_ok()
    );

    registry.clear_after_committed_reset();
    assert!(
        registry
            .verify("readable", Some(&adopted.connection_token))
            .is_err(),
        "a committed stream reset invalidates every predecessor grant"
    );
    assert!(
        registry
            .verify(&collided.connection_id, Some(&collided.connection_token))
            .is_err()
    );
    registry.lock().assert_grant_indexes_consistent();
}

/// @ref LLP 0059#reuse-and-mismatch — previous-token reuse is exact over
/// every immutable authority field; the cached deadline alone is mutable.
#[test]
fn connection_previous_token_reuse_compares_every_authority_field() {
    let (incarnation, publication) =
        crate::auth::session_projection::FencedPublication::anonymous_for_unmanaged_dev_connection(
        );
    let session_id = Uuid::now_v7().to_string();
    let user_id = Uuid::now_v7().to_string();
    let base = synthetic_session_bound(
        &incarnation,
        &session_id,
        &user_id,
        "email-code",
        7,
        10_000,
        publication.clone(),
    );
    let mismatches = [
        BoundGrantAuthority::Anonymous {
            authorization_stream_incarnation: incarnation.clone(),
            publication: publication.clone(),
        },
        synthetic_session_bound(
            &Uuid::now_v7().to_string(),
            &session_id,
            &user_id,
            "email-code",
            7,
            10_000,
            publication.clone(),
        ),
        synthetic_session_bound(
            &incarnation,
            &Uuid::now_v7().to_string(),
            &user_id,
            "email-code",
            7,
            10_000,
            publication.clone(),
        ),
        synthetic_session_bound(
            &incarnation,
            &session_id,
            &Uuid::now_v7().to_string(),
            "email-code",
            7,
            10_000,
            publication.clone(),
        ),
        synthetic_session_bound(
            &incarnation,
            &session_id,
            &user_id,
            "different-provider",
            7,
            10_000,
            publication.clone(),
        ),
        synthetic_session_bound(
            &incarnation,
            &session_id,
            &user_id,
            "email-code",
            8,
            10_000,
            publication.clone(),
        ),
    ];
    for mismatch in mismatches {
        let registry = ConnectionRegistry::default();
        let opened = registry
            .open_prepared(ConnectionOpenAttempt::new(
                Some("exact-authority".to_owned()),
                None,
                true,
                synthetic_connection_authority(base.clone()),
                1,
                Instant::now(),
                None,
            ))
            .expect("seed exact grant");
        let error = registry
            .open_prepared(ConnectionOpenAttempt::new(
                Some(opened.grant.connection_id.clone()),
                Some(&opened.grant.connection_token),
                true,
                synthetic_connection_authority(mismatch),
                2,
                Instant::now(),
                None,
            ))
            .expect_err("identity drift must invalidate and refuse reuse");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CONNECTION_AUTHORITY_MISMATCH"
        );
        let state = registry.lock();
        assert!(state.grants.is_empty());
        assert!(
            state.pressure_mint_only,
            "non-exact previousToken retirement immediately disables readable-id adoption"
        );
        state.assert_grant_indexes_consistent();
    }

    let registry = ConnectionRegistry::default();
    let opened = registry
        .open_prepared(ConnectionOpenAttempt::new(
            Some("deadline-only".to_owned()),
            None,
            true,
            synthetic_connection_authority(base.clone()),
            1,
            Instant::now(),
            None,
        ))
        .expect("seed deadline grant");
    let later = synthetic_session_bound(
        &incarnation,
        &session_id,
        &user_id,
        "email-code",
        7,
        20_000,
        publication,
    );
    let reused = registry
        .open_prepared(ConnectionOpenAttempt::new(
            Some(opened.grant.connection_id.clone()),
            Some(&opened.grant.connection_token),
            false,
            synthetic_connection_authority(later),
            2,
            Instant::now(),
            None,
        ))
        .expect("deadline-only change reuses exact grant");
    assert_eq!(reused.grant, opened.grant);
    assert_eq!(reused.grant_id, opened.grant_id);
    assert!(!reused.newly_minted);
    let state = registry.lock();
    assert!(matches!(
        state
            .grants
            .get(&reused.grant.connection_id)
            .map(|record| &record.authority),
        Some(BoundGrantAuthority::Session {
            deadline_ms: 20_000,
            ..
        })
    ));
    state.assert_grant_indexes_consistent();
}

#[test]
fn connection_registry_negotiates_exact_invalidation_v1_with_bound_authority() {
    let registry = ConnectionRegistry::default();
    let directory = tempfile::tempdir().expect("connection registry fixture directory");
    let path = directory.path().join("connection-registry.sqlite3");
    let mut predecessor =
        LocalSnapback::open(&path).expect("file-backed connection registry fixture");
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    predecessor
        .remainder_auth_fixture()
        .activate_catalog(keyring.as_ref(), super::now_millis(), &OsRandom)
        .expect("activate connection registry auth catalog");
    let provider = AuthProvider::new(AuthProviderProfile::Test, keyring)
        .expect("construct connection registry auth provider");
    // Boot 1 has no predecessor. End that database-open lifetime before
    // reopening the same durable store: only a real restart may reserve boot
    // 2 and authenticate boot 1's retirement.
    predecessor
        .install_authenticated_auth_invalidation(&provider, None)
        .expect("install predecessor database-bound invalidation issuer");
    drop(predecessor);
    let mut snapback = LocalSnapback::open(&path).expect("reopen connection registry fixture");
    let binding = snapback
        .install_authenticated_auth_invalidation(&provider, None)
        .expect("install a successor database-bound invalidation issuer");
    let expected_authorization = binding.authorization_expectation().unwrap();
    registry.install_invalidation_binding(binding);

    let (incarnation, publication) = FencedPublication::anonymous_for_unmanaged_dev_connection();
    let prepared = || {
        synthetic_connection_authority(BoundGrantAuthority::Anonymous {
            authorization_stream_incarnation: incarnation.clone(),
            publication: publication.clone(),
        })
    };
    let legacy = registry
        .open_prepared(ConnectionOpenAttempt::new(
            Some("legacy".to_owned()),
            None,
            true,
            prepared(),
            1,
            Instant::now(),
            None,
        ))
        .expect("legacy grant");
    assert!(legacy.grant.authorization_invalidation.is_none());
    let negotiated = registry
        .open_prepared(ConnectionOpenAttempt::new(
            Some("negotiated".to_owned()),
            None,
            true,
            prepared(),
            2,
            Instant::now(),
            Some(crate::auth::invalidation::AUTH_INVALIDATION_PROTOCOL_VERSION),
        ))
        .expect("negotiated grant");
    let descriptor = negotiated
        .grant
        .authorization_invalidation
        .as_ref()
        .expect("v1 descriptor");
    assert_eq!(descriptor.protocol_version(), 1);
    assert_eq!(descriptor.connection_generation(), 1);
    assert_eq!(descriptor.authorization(), &expected_authorization);
    assert!(crate::ids::is_minted_identifier(
        descriptor.version_stream()
    ));
    assert_eq!(descriptor.issuer_id().boot_sequence, 2);
    assert_eq!(
        descriptor
            .issuer_retirement()
            .expect("prior issuer retirement")
            .retire_through_boot_sequence,
        descriptor.issuer_id().boot_sequence - 1
    );
    let reopened = registry
        .open_prepared(ConnectionOpenAttempt::new(
            Some(negotiated.grant.connection_id.clone()),
            Some(&negotiated.grant.connection_token),
            false,
            prepared(),
            3,
            Instant::now(),
            Some(1),
        ))
        .expect("idempotent reopen");
    assert_eq!(
        reopened.grant.authorization_invalidation,
        negotiated.grant.authorization_invalidation
    );
}

/// @ref LLP 0059#connection-bound-authority — the three closed source
/// buckets have exact independent limits and an inclusive 60-second drop.
#[test]
fn connection_open_throttle_has_exact_closed_bucket_boundaries() {
    let mut state = ConnectionRegistryState::default();
    let start = Instant::now();
    let first = BoundSessionKey {
        authorization_stream_incarnation: "incarnation-a".to_owned(),
        session_id: "session-a".to_owned(),
        generation: 1,
    };
    for _ in 0..super::CONNECTION_OPEN_SESSION_LIMIT {
        state
            .consume_session_open(first.clone(), start)
            .expect("attempts one through sixty are admitted");
    }
    assert_eq!(state.consume_session_open(first.clone(), start), Err(60));
    assert_eq!(
        state.consume_session_open(first.clone(), start + Duration::from_secs(59)),
        Err(1)
    );
    let second = BoundSessionKey {
        session_id: "session-b".to_owned(),
        ..first.clone()
    };
    state
        .consume_session_open(second, start)
        .expect("one session cannot exhaust another session's bucket");
    state
        .consume_session_open(first, start + Duration::from_secs(60))
        .expect("the exact window boundary drops predecessor attempts");

    for _ in 0..super::CONNECTION_OPEN_COARSE_LIMIT {
        state
            .consume_anonymous_open("incarnation-a", start)
            .expect("anonymous attempts one through 240 are admitted");
    }
    assert_eq!(
        state.consume_anonymous_open("incarnation-a", start),
        Err(60)
    );
    state
        .consume_unknown_open("incarnation-a", start)
        .expect("canonical-unknown has a separate coarse budget");
    state
        .consume_anonymous_open("incarnation-b", start)
        .expect("a successor incarnation has a fresh coarse budget");
    for _ in 1..super::CONNECTION_OPEN_COARSE_LIMIT {
        state
            .consume_unknown_open("incarnation-a", start)
            .expect("unknown attempts through 240 are admitted");
    }
    assert_eq!(
        state.consume_unknown_open("incarnation-a", start + Duration::from_millis(1)),
        Err(60),
        "Retry-After rounds the remaining fractional minute up"
    );
    state
        .consume_unknown_open("incarnation-a", start + Duration::from_secs(60))
        .expect("unknown bucket also opens at the exact boundary");

    let survivor = BoundSessionKey {
        authorization_stream_incarnation: "incarnation-a".to_owned(),
        session_id: "session-survivor".to_owned(),
        generation: 2,
    };
    state
        .consume_session_open(survivor.clone(), start + Duration::from_secs(121))
        .expect("new session source admitted after old buckets expire");
    assert_eq!(state.session_open_attempts.len(), 1);
    assert!(state.session_open_attempts.contains_key(&survivor));
}

/// @ref LLP 0055#routes-and-credential-classes — every agent-management
/// route has a closed, independent budget, including malformed attempts.
#[test]
fn agent_management_routes_have_independent_exact_throttle_budgets() {
    let agent_paths = super::core_route_registrations()
        .into_iter()
        .filter_map(|route| {
            super::agent_route_throttle_limit(route.spec.path).map(|limit| (route.spec.path, limit))
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    assert_eq!(
        agent_paths.keys().copied().collect::<Vec<_>>(),
        vec![
            "/auth/agent-invitations",
            "/auth/agents/pair",
            "/auth/agents/register",
            "/auth/agents/revoke-self",
            "/auth/agents/rotate",
            "/auth/agents/token",
            "/auth/agents/token/release",
            "/auth/grant-requests",
            "/auth/grant-requests/{id}/approve",
            "/auth/grant-requests/{id}/deny",
            "/auth/grants",
            "/auth/grants/by-actor/{actor_id}",
            "/auth/grants/{id}",
            "/auth/oauth/authorize",
            "/auth/oauth/register",
            "/auth/oauth/revoke",
            "/auth/oauth/token",
            "/auth/pairing-codes",
            "/effects",
            "/effects/{id}/approve",
            "/effects/{id}/deny",
        ]
    );
    assert_eq!(agent_paths["/auth/agents/token"], 600);
    assert_eq!(agent_paths["/auth/agents/token/release"], 240);
    assert_eq!(agent_paths["/auth/agents/register"], 10);
    assert_eq!(agent_paths["/auth/agent-invitations"], 10);

    let mut state = ConnectionRegistryState::default();
    let start = Instant::now();
    let path = "/auth/agents/rotate";
    let limit = agent_paths[path];
    let first = super::AgentRouteThrottleSource::Credential([1; 32]);
    for _ in 0..limit {
        state
            .consume_agent_route(path, first.clone(), limit, start)
            .expect("attempts through the exact route limit are admitted");
    }
    assert_eq!(
        state.consume_agent_route(path, first.clone(), limit, start),
        Err(60)
    );
    assert_eq!(
        state.consume_agent_route(path, first.clone(), limit, start + Duration::from_secs(59)),
        Err(1)
    );

    state
        .consume_agent_route(
            path,
            super::AgentRouteThrottleSource::Credential([2; 32]),
            limit,
            start,
        )
        .expect("one credential cannot exhaust another credential's bucket");

    let sibling = "/auth/agents/revoke-self";
    state
        .consume_agent_route(sibling, first.clone(), agent_paths[sibling], start)
        .expect("one route cannot exhaust another route's bucket");
    state
        .consume_agent_route(path, first, limit, start + Duration::from_secs(60))
        .expect("the exact window boundary drops predecessor attempts");

    let user_a = super::AgentRouteThrottleSource::Session("user-a".to_owned());
    let user_b = super::AgentRouteThrottleSource::Session("user-b".to_owned());
    let session_path = "/auth/grants";
    let session_limit = agent_paths[session_path];
    for _ in 0..session_limit {
        state
            .consume_agent_route(session_path, user_a.clone(), session_limit, start)
            .expect("user A reaches its exact limit");
    }
    assert_eq!(
        state.consume_agent_route(session_path, user_a, session_limit, start),
        Err(60)
    );
    state
        .consume_agent_route(session_path, user_b, session_limit, start)
        .expect("one user cannot exhaust another user's bucket");
}

#[test]
fn external_client_id_header_profile_is_duplicate_safe_and_external_only() {
    let external = super::core_route_registrations()
        .into_iter()
        .find(|route| route.spec.path == "/api/v1/query/{name}")
        .unwrap()
        .spec;
    let first_party = super::core_route_registrations()
        .into_iter()
        .find(|route| route.spec.path == "/query/{name}")
        .unwrap()
        .spec;
    let context = |spec, values: &[&str]| {
        let mut headers = HeaderMap::new();
        for value in values {
            headers.append(
                super::SNAPBACK_CLIENT_ID_HEADER,
                HeaderValue::from_str(value).unwrap(),
            );
        }
        super::declared_client_id_context(spec, &headers)
    };

    let valid = context(external, &["crawler-7f3a9c/OPS@Example.COM"]).expect("external context");
    assert_eq!(valid.status(), Some("accepted"));
    assert_eq!(
        valid.declared.unwrap().value,
        "crawler-7f3a9c/ops@example.com"
    );
    assert_eq!(
        context(external, &["ops@example.com"]).unwrap().status(),
        Some("ignored-too-short")
    );
    assert_eq!(
        context(external, &["crawler-without-contact-address"])
            .unwrap()
            .status(),
        Some("ignored-no-email")
    );
    assert_eq!(
        context(
            external,
            &["crawler-a/ops@example.com", "crawler-b/ops@example.com"]
        )
        .unwrap()
        .status(),
        Some("ignored-duplicate")
    );
    assert!(
        context(first_party, &["crawler-a/ops@example.com"]).is_none(),
        "first-party routes ignore the declaration entirely"
    );
}

/// @ref LLP 0071#declared-tier — the low-cardinality floor is reserved first,
/// declared/integration buckets are independent siblings, and blessing changes
/// only cooperative treatment.
#[test]
fn external_api_buckets_compose_without_declared_sybil_amplification() {
    let mut state = ConnectionRegistryState::default();
    let now = Instant::now();
    let network = [7; 32];
    for minted in 0..super::EXTERNAL_API_ANONYMOUS_FLOOR_LIMIT {
        state
            .consume_external_api(
                super::ExternalApiThrottleSource::NetworkFloor(network),
                super::EXTERNAL_API_ANONYMOUS_FLOOR_LIMIT,
                now,
            )
            .expect("network floor admits its exact allowance");
        state
            .consume_external_api(
                super::ExternalApiThrottleSource::Declared([minted as u8; 32]),
                super::EXTERNAL_API_DECLARED_LIMIT,
                now,
            )
            .expect("fresh declared id cannot weaken the separately charged floor");
    }
    assert_eq!(
        state.consume_external_api(
            super::ExternalApiThrottleSource::NetworkFloor(network),
            super::EXTERNAL_API_ANONYMOUS_FLOOR_LIMIT,
            now,
        ),
        Err(60)
    );

    let mut declared = ConnectionRegistryState::default();
    for _ in 0..super::EXTERNAL_API_DECLARED_LIMIT {
        declared
            .consume_external_api(
                super::ExternalApiThrottleSource::Declared([1; 32]),
                super::EXTERNAL_API_DECLARED_LIMIT,
                now,
            )
            .unwrap();
    }
    assert_eq!(
        declared.consume_external_api(
            super::ExternalApiThrottleSource::Declared([1; 32]),
            super::EXTERNAL_API_DECLARED_LIMIT,
            now,
        ),
        Err(60)
    );
    const {
        assert!(super::EXTERNAL_API_DECLARED_LIMIT > super::EXTERNAL_API_ANONYMOUS_FLOOR_LIMIT);
    }

    let mut integrations = ConnectionRegistryState::default();
    for _ in 0..super::EXTERNAL_API_INTEGRATION_LIMIT {
        integrations
            .consume_external_api(
                super::ExternalApiThrottleSource::Integration("intg-a".to_owned()),
                super::EXTERNAL_API_INTEGRATION_LIMIT,
                now,
            )
            .unwrap();
    }
    assert_eq!(
        integrations.consume_external_api(
            super::ExternalApiThrottleSource::Integration("intg-a".to_owned()),
            super::EXTERNAL_API_INTEGRATION_LIMIT,
            now,
        ),
        Err(60)
    );
    integrations
        .consume_external_api(
            super::ExternalApiThrottleSource::Integration("intg-b".to_owned()),
            super::EXTERNAL_API_INTEGRATION_LIMIT,
            now,
        )
        .expect("one integration cannot exhaust another integration's bucket");

    let blessed_limit = super::EXTERNAL_API_DECLARED_LIMIT * super::EXTERNAL_API_BLESSED_MULTIPLIER;
    assert!(blessed_limit > super::EXTERNAL_API_DECLARED_LIMIT);
    let mut blessed = ConnectionRegistryState::default();
    for _ in 0..=super::EXTERNAL_API_DECLARED_LIMIT {
        blessed
            .consume_external_api(
                super::ExternalApiThrottleSource::Declared([4; 32]),
                blessed_limit,
                now,
            )
            .expect("blessing raises the per-id bucket above the fresh-id ceiling");
    }
    let maximum_aged_limit = super::EXTERNAL_API_DECLARED_LIMIT
        * crate::storage::declared_clients::DECLARED_CLIENT_MAX_AGE_POLICY_GENERATION as usize;
    assert!(maximum_aged_limit > super::EXTERNAL_API_DECLARED_LIMIT);
}

#[test]
fn declared_creation_gate_is_low_cardinality_and_exact() {
    let mut state = ConnectionRegistryState::default();
    let now = Instant::now();
    for _ in 0..super::EXTERNAL_API_DECLARED_CREATION_LIMIT {
        state
            .consume_external_api(
                super::ExternalApiThrottleSource::DeclaredCreation([9; 32]),
                super::EXTERNAL_API_DECLARED_CREATION_LIMIT,
                now,
            )
            .unwrap();
    }
    assert_eq!(
        state.consume_external_api(
            super::ExternalApiThrottleSource::DeclaredCreation([9; 32]),
            super::EXTERNAL_API_DECLARED_CREATION_LIMIT,
            now,
        ),
        Err(60)
    );
    state
        .consume_external_api(
            super::ExternalApiThrottleSource::DeclaredCreation([8; 32]),
            super::EXTERNAL_API_DECLARED_CREATION_LIMIT,
            now,
        )
        .expect("creation gates are keyed only by bounded network evidence");
}

#[test]
fn external_api_overflow_stays_lane_specific_and_fail_closed() {
    for (source, expected_source, expected_limit) in [
        (
            super::ExternalApiThrottleSource::NetworkFloor([1; 32]),
            super::ExternalApiThrottleSource::OverflowNetworkFloor,
            super::EXTERNAL_API_ANONYMOUS_FLOOR_LIMIT,
        ),
        (
            super::ExternalApiThrottleSource::DeclaredCreation([2; 32]),
            super::ExternalApiThrottleSource::OverflowDeclaredCreation,
            super::EXTERNAL_API_DECLARED_CREATION_LIMIT,
        ),
        (
            super::ExternalApiThrottleSource::Declared([3; 32]),
            super::ExternalApiThrottleSource::OverflowDeclared,
            super::EXTERNAL_API_DECLARED_LIMIT,
        ),
        (
            super::ExternalApiThrottleSource::Integration("integration".to_owned()),
            super::ExternalApiThrottleSource::OverflowIntegration,
            super::EXTERNAL_API_INTEGRATION_LIMIT,
        ),
    ] {
        let (overflow, limit) = source.overflow();
        assert_eq!(overflow, expected_source);
        assert_eq!(limit, expected_limit);
    }
}

#[tokio::test]
async fn external_refusal_names_lane_and_escalation() {
    let response = super::external_api_throttle_error(
        "SNAPBACK_API_DECLARED_LIMIT_EXCEEDED",
        "declared",
        "declared budget exhausted",
        9,
    )
    .into_response();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.headers()[header::RETRY_AFTER], "9");
    let body = response_json(response).await;
    assert_eq!(body["diagnostic"]["details"]["lane"], "declared");
    assert_eq!(
        body["diagnostic"]["details"]["escalation"]["nextLane"],
        "integration"
    );
    assert_eq!(
        body["diagnostic"]["details"]["escalation"]["path"],
        "/auth/agents/register"
    );

    let floor = super::external_api_throttle_error(
        "SNAPBACK_API_NETWORK_FLOOR_EXCEEDED",
        "network-floor",
        "network floor exhausted",
        3,
    )
    .into_response();
    let floor = response_json(floor).await;
    assert_eq!(floor["diagnostic"]["details"]["lane"], "network-floor");
    assert!(floor["diagnostic"]["details"]["escalation"]["nextLane"].is_null());
}

/// @ref LLP 0059#connection-bound-authority — exact generation
/// invalidation cleans both LRU and reverse indexes without touching a
/// sibling session or anonymous grant.
#[test]
fn connection_reverse_indexes_do_not_leave_ghosts() {
    let registry = ConnectionRegistry::default();
    let (incarnation, publication) =
        crate::auth::session_projection::FencedPublication::anonymous_for_unmanaged_dev_connection(
        );
    let user_id = Uuid::now_v7().to_string();
    let first_session = Uuid::now_v7().to_string();
    let second_session = Uuid::now_v7().to_string();
    for connection_id in ["session-a-1", "session-a-2"] {
        registry
            .open_prepared(ConnectionOpenAttempt::new(
                Some(connection_id.to_owned()),
                None,
                true,
                synthetic_connection_authority(synthetic_session_bound(
                    &incarnation,
                    &first_session,
                    &user_id,
                    "email-code",
                    3,
                    10_000,
                    publication.clone(),
                )),
                1,
                Instant::now(),
                None,
            ))
            .expect("session grant");
    }
    registry
        .open_prepared(ConnectionOpenAttempt::new(
            Some("session-b".to_owned()),
            None,
            true,
            synthetic_connection_authority(synthetic_session_bound(
                &incarnation,
                &second_session,
                &user_id,
                "email-code",
                1,
                10_000,
                publication.clone(),
            )),
            1,
            Instant::now(),
            None,
        ))
        .expect("sibling session grant");
    registry
        .open_prepared(ConnectionOpenAttempt::new(
            Some("anonymous".to_owned()),
            None,
            true,
            synthetic_connection_authority(BoundGrantAuthority::Anonymous {
                authorization_stream_incarnation: incarnation.clone(),
                publication,
            }),
            1,
            Instant::now(),
            None,
        ))
        .expect("anonymous grant");
    registry.lock().assert_grant_indexes_consistent();

    let captures = registry.invalidate_session_generation(&incarnation, &first_session, 3);
    assert_eq!(captures.len(), 2);
    let state = registry.lock();
    assert!(!state.grants.contains_key("session-a-1"));
    assert!(!state.grants.contains_key("session-a-2"));
    assert!(state.grants.contains_key("session-b"));
    assert!(state.grants.contains_key("anonymous"));
    assert!(state.pressure_mint_only);
    state.assert_grant_indexes_consistent();
    drop(state);

    let captures = registry.clear_after_committed_reset();
    assert_eq!(captures.len(), 2);
    let state = registry.lock();
    assert!(state.grants.is_empty());
    assert!(state.anonymous_grants.is_empty());
    assert!(state.session_grants.is_empty());
    state.assert_grant_indexes_consistent();
}

/// @ref LLP 0059#act-time-validation — a prepared predecessor cannot
/// destructively drain data after its grant id is replaced under the same
/// public connection id.
#[test]
fn stale_prepared_connection_act_cannot_drain_reused_connection_outbox() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("memory fixture"));
    let registry = state.connections.clone();
    let first = registry
        .open(Some("reused-wire-id".to_owned()), None, true)
        .expect("first grant");
    let stale = registry
        .prepare_act(
            &first.connection_id,
            Some(&first.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare predecessor act");
    registry.clear_after_committed_reset();
    // Force the historical reuse shape after asserting production's
    // mint-only containment, so this test continues to exercise the
    // independent act-time grant-id fence.
    {
        let mut grants = registry.lock();
        assert!(grants.pressure_mint_only);
        grants.pressure_mint_only = false;
    }
    let replacement = registry
        .open(Some(first.connection_id.clone()), None, true)
        .expect("reuse wire id after reset");
    assert_eq!(replacement.connection_id, first.connection_id);
    state
        .ephemeral
        .enqueue_durable_for_test(&replacement.connection_id, br#"{"private":true}"#.to_vec());

    let drained = AtomicBool::new(false);
    let error = stale
        .try_act(&registry, super::now_millis(), Instant::now(), || {
            drained.store(true, Ordering::SeqCst);
            Ok(state.ephemeral.drain_outbox(&replacement.connection_id))
        })
        .expect_err("stale grant id must fail before destructive drain");
    assert_eq!(error.0.diagnostic.code, "SNAPBACK_CONNECTION_TOKEN_INVALID");
    assert!(!drained.load(Ordering::SeqCst));

    let current = registry
        .prepare_act(
            &replacement.connection_id,
            Some(&replacement.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare replacement act");
    let messages = current
        .try_act(&registry, super::now_millis(), Instant::now(), || {
            Ok(state.ephemeral.drain_outbox(&replacement.connection_id))
        })
        .expect("replacement owns queued data");
    assert_eq!(messages.len(), 1);
}

/// HTTP polling is not allowed to adopt delayed frames merely because a
/// local profile reused the readable id. Production containment mints;
/// this forced-reuse seam proves the exact drain remains safe anyway.
#[test]
fn polling_id_reuse_drops_predecessor_effects_and_delivers_successor() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("memory fixture"));
    let registry = state.connections.clone();
    let first = registry
        .open(Some("poll-reuse".to_owned()), None, true)
        .expect("predecessor grant");
    let predecessor = registry
        .prepare_act(
            &first.connection_id,
            Some(&first.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("predecessor act");
    state.ephemeral.enqueue_durable_bound_for_test(
        &first.connection_id,
        b"predecessor".to_vec(),
        predecessor.effect_fence(),
    );

    registry.clear_after_committed_reset();
    {
        let mut grants = registry.lock();
        assert!(grants.pressure_mint_only);
        grants.pressure_mint_only = false;
    }
    let replacement = registry
        .open(Some(first.connection_id.clone()), None, true)
        .expect("forced same-id replacement");
    assert_eq!(replacement.connection_id, first.connection_id);
    let current = registry
        .prepare_act(
            &replacement.connection_id,
            Some(&replacement.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("replacement act");
    state.ephemeral.enqueue_durable_bound_for_test(
        &replacement.connection_id,
        b"successor".to_vec(),
        current.effect_fence(),
    );
    state.ephemeral.touch_connection(&replacement.connection_id);
    let payloads = state
        .ephemeral
        .drain_outbox_for_send_bound_if_active(&replacement.connection_id, &current.effect_fence())
        .expect("active poll connection")
        .into_iter()
        .filter_map(|admitted| match admitted.into_parts().0 {
            RealtimeEnvelope::Durable(message) => Some(message.payload),
            RealtimeEnvelope::Ephemeral(_) => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(payloads, vec![b"successor".to_vec()]);
}

#[tokio::test]
async fn slow_socket_write_releases_its_handoff_at_the_monotonic_deadline() {
    struct Release(Arc<AtomicBool>);
    impl Drop for Release {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    let released = Arc::new(AtomicBool::new(false));
    let held = Release(released.clone());
    let blocked = async move {
        let _held = held;
        std::future::pending::<Result<(), ()>>().await
    };
    assert!(
        !super::bounded_live_write(blocked, tokio::time::Instant::now()).await,
        "a non-reading peer may not hold auth quiescence indefinitely"
    );
    assert!(
        released.load(Ordering::SeqCst),
        "timeout cancellation releases admission/publication ownership"
    );
}

/// @ref LLP 0059#fenced-effects-and-live-closure — a stream premark wins
/// the final grant act even when verification cloned the predecessor first.
#[tokio::test]
async fn prepared_connection_act_loses_to_concurrent_stream_premark() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let coordinator = state.auth_coordinator.clone().expect("coordinator");
    let prepared = state
        .connections
        .prepare_open_authority(
            coordinator.as_ref(),
            super::PresentedSessionBearer::Absent,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare anonymous connection");
    let opened = state
        .connections
        .open_prepared(ConnectionOpenAttempt::new(
            Some("premark-race".to_owned()),
            None,
            true,
            prepared,
            super::now_millis(),
            Instant::now(),
            None,
        ))
        .expect("open managed grant");
    let act = state
        .connections
        .prepare_act(
            &opened.grant.connection_id,
            Some(&opened.grant.connection_token),
            Some(coordinator.as_ref()),
            false,
            super::now_millis(),
            Instant::now(),
        )
        .expect("clone act before premark");
    let reset = coordinator
        .premark_stream_reset()
        .await
        .expect("premark reset");
    let ran = AtomicBool::new(false);
    let error = act
        .try_act(
            &state.connections,
            super::now_millis(),
            Instant::now(),
            || {
                ran.store(true, Ordering::SeqCst);
                Ok(())
            },
        )
        .expect_err("pending stream mutation closes predecessor act");
    assert_eq!(error.0.diagnostic.code, "SNAPBACK_AUTH_STREAM_RESET");
    assert_eq!(error.0.diagnostic.details["retryable"], json!(true));
    assert_eq!(
        error.0.diagnostic.details["authorityDisposition"],
        json!("carrier")
    );
    assert!(!ran.load(Ordering::SeqCst));
    let rollback = SnapbackError::error("TEST_ROLLBACK", "test", "known rollback");
    assert_eq!(
        coordinator
            .finish_stream_reset::<()>(reset, AuthTransactionAttempt::RolledBack(rollback))
            .expect_err("test rollback propagates")
            .diagnostic
            .code,
        "TEST_ROLLBACK"
    );
}

/// @ref LLP 0031#connection-capability-grants — ordinary socket close
/// preserves the reusable grant, but the exact generation owns a
/// fail-closed suspension until physical cleanup finishes.
#[test]
fn ordinary_socket_teardown_suspends_exact_grant_until_finish() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("teardown fixture"));
    let opened = state
        .connections
        .open(Some("ordinary-teardown".to_owned()), None, true)
        .expect("open reusable connection grant");
    let prepared = state
        .connections
        .prepare_act(
            &opened.connection_id,
            Some(&opened.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare exact socket act");
    let notifier = state.ephemeral.delivery_notifier();
    let (generation, _waker) = notifier
        .register_bound(&opened.connection_id, prepared.grant_id.clone())
        .expect("register exact socket generation");

    let teardown = prepared
        .begin_socket_teardown(&state.connections, &notifier, generation)
        .expect("current generation owns teardown");
    assert!(teardown.suspended_current_grant());
    {
        let registry = state.connections.lock();
        let retained = registry
            .grants
            .get(&opened.connection_id)
            .expect("ordinary close preserves its grant");
        assert_eq!(retained.grant_id, prepared.grant_id);
        assert_eq!(retained.socket_teardown, Some(generation));
    }

    let prepare_error = state
        .connections
        .prepare_act(
            &opened.connection_id,
            Some(&opened.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect_err("new acts wait for exact socket cleanup");
    assert_eq!(
        prepare_error.0.diagnostic.code,
        "SNAPBACK_CONNECTION_TEARDOWN_PENDING"
    );
    let ran = AtomicBool::new(false);
    let act_error = prepared
        .try_act(
            &state.connections,
            super::now_millis(),
            Instant::now(),
            || {
                ran.store(true, Ordering::SeqCst);
                Ok(())
            },
        )
        .expect_err("a previously prepared act also observes suspension");
    assert_eq!(
        act_error.0.diagnostic.code,
        "SNAPBACK_CONNECTION_TOKEN_INVALID"
    );
    assert!(!ran.load(Ordering::SeqCst));
    let registration_error = notifier
        .register_bound(&opened.connection_id, prepared.grant_id.clone())
        .expect_err("same-id socket registration waits for cleanup");
    assert_eq!(
        registration_error.diagnostic.code,
        "SNAPBACK_CONNECTION_TEARDOWN_PENDING"
    );

    teardown.finish();
    state
        .connections
        .verify(&opened.connection_id, Some(&opened.connection_token))
        .expect("ordinary cleanup releases the preserved grant");
    let (successor_generation, _waker) = notifier
        .register_bound(&opened.connection_id, prepared.grant_id.clone())
        .expect("socket registration reopens after cleanup");
    assert!(successor_generation > generation);
}

/// A delayed predecessor socket may still own the notifier generation
/// after terminal registry replacement. Its teardown must use the old
/// effect fence and leave a forced same-readable-id successor untouched.
#[tokio::test]
async fn stale_exact_socket_teardown_does_not_erase_same_id_replacement() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("reuse teardown fixture"));
    let opened = state
        .connections
        .open(Some("teardown-reuse".to_owned()), None, true)
        .expect("open predecessor grant");
    let predecessor = state
        .connections
        .prepare_act(
            &opened.connection_id,
            Some(&opened.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare predecessor socket act");
    let notifier = state.ephemeral.delivery_notifier();
    let (generation, _waker) = notifier
        .register_bound(&opened.connection_id, predecessor.grant_id.clone())
        .expect("register predecessor socket");

    state.connections.clear_after_committed_reset();
    {
        let mut registry = state.connections.lock();
        assert!(registry.pressure_mint_only);
        registry.pressure_mint_only = false;
    }
    let replacement = state
        .connections
        .open(Some(opened.connection_id.clone()), None, true)
        .expect("force same-readable-id successor");
    assert_eq!(replacement.connection_id, opened.connection_id);
    let successor = state
        .connections
        .prepare_act(
            &replacement.connection_id,
            Some(&replacement.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare successor act");
    state.ephemeral.touch_connection(&replacement.connection_id);
    state.ephemeral.enqueue_durable_bound_for_test(
        &replacement.connection_id,
        b"successor-survives-stale-teardown".to_vec(),
        successor.effect_fence(),
    );

    super::teardown_live_stream(
        &state,
        &notifier,
        &predecessor,
        &opened.connection_id,
        generation,
    )
    .await;

    state
        .connections
        .verify(
            &replacement.connection_id,
            Some(&replacement.connection_token),
        )
        .expect("predecessor teardown leaves successor grant current");
    let queued = state
        .ephemeral
        .drain_outbox_for_send_bound_if_active(
            &replacement.connection_id,
            &successor.effect_fence(),
        )
        .expect("successor activity survives exact predecessor cleanup");
    assert!(matches!(
        queued.as_slice(),
        [admitted]
            if matches!(
                admitted.envelope(),
                RealtimeEnvelope::Durable(message)
                    if message.payload == b"successor-survives-stale-teardown"
            )
    ));
    drop(queued);
    notifier
        .register_bound(&replacement.connection_id, successor.grant_id.clone())
        .expect("successor socket registers after predecessor cleanup");
}

#[tokio::test]
async fn admin_disconnect_route_retires_bearer_and_awaits_whole_id_cleanup() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("admin disconnect state"));
    let opened = state
        .connections
        .open(Some("admin-disconnect-route".to_owned()), None, true)
        .expect("open admin disconnect target");
    state.ephemeral.touch_connection(&opened.connection_id);
    state
        .ephemeral
        .enqueue_durable_for_test(&opened.connection_id, b"admin-disconnect-residue".to_vec());

    let response = super::app(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/_snapback/api/connections/{}/disconnect",
                    opened.connection_id
                ))
                .body(Body::empty())
                .expect("admin disconnect request"),
        )
        .await
        .expect("admin disconnect response");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(
        state
            .connections
            .prepare_act(
                &opened.connection_id,
                Some(&opened.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .is_err(),
        "the route retires the old bearer before acknowledging success"
    );
    assert!(
        !state
            .ephemeral
            .has_connection_residue_for_test(&opened.connection_id),
        "204 means whole-ID ephemeral cleanup completed"
    );
}

/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L2 bulk
/// retirement transfers every capture into owned cleanup before awaiting
/// the first task; cancelling maintenance cannot orphan later grants.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn maintenance_bulk_retirement_spawns_all_cleanup_before_first_await() {
    let state =
        test_detached_app_state(LocalSnapback::memory().expect("maintenance cleanup state"));
    let ids = ["maintenance-first", "maintenance-second"];
    for connection_id in ids {
        state
            .connections
            .open(Some(connection_id.to_owned()), None, true)
            .expect("open idle cleanup target");
        state.ephemeral.touch_connection(connection_id);
        state
            .ephemeral
            .enqueue_durable_for_test(connection_id, b"residue".to_vec());
    }

    let local_guard = state.snapback.clone().lock_owned().await;
    let captures = state.connections.retire_idle_for_cleanup(u64::MAX);
    assert_eq!(captures.len(), ids.len());
    let cleanup_tasks = super::spawn_retired_connection_cleanup_batch(&state, captures);
    assert_eq!(cleanup_tasks.len(), ids.len());
    let child_status = cleanup_tasks
        .iter()
        .map(|cleanup| cleanup.task.abort_handle())
        .collect::<Vec<_>>();
    let cleanup_telemetry = state.telemetry.clone();
    let maintenance_waiter = tokio::spawn(async move {
        let retry =
            super::join_retired_connection_cleanup_batch(cleanup_tasks, &cleanup_telemetry).await;
        assert!(retry.is_empty(), "successful cleanup has no retry capture");
    });

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if ids.iter().all(|connection_id| {
                !state
                    .ephemeral
                    .has_connection_residue_for_test(connection_id)
            }) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("both cleanup children reach the blocked Local phase");
    assert!(!maintenance_waiter.is_finished());
    assert!(
        child_status.iter().all(|child| !child.is_finished()),
        "both independently owned children remain blocked on Local"
    );

    maintenance_waiter.abort();
    assert!(maintenance_waiter.await.unwrap_err().is_cancelled());
    drop(local_guard);
    tokio::time::timeout(Duration::from_secs(2), async {
        while child_status.iter().any(|child| !child.is_finished()) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("all cleanup children outlive the cancelled maintenance waiter");
}

/// A retired idle grant is already mint-only contained before cleanup.
/// If its owned child panics, maintenance must retain the same exact
/// capture, refuse readable-id reuse, and retry the idempotent whole-id
/// cleanup rather than silently discarding the JoinError.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L2 cleanup
/// ownership remains fail-closed and retryable after child failure.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn maintenance_cleanup_join_failure_retains_exact_retry_capture() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("cleanup retry state"));
    let telemetry_dir = tempfile::tempdir().expect("cleanup telemetry directory");
    let telemetry_app = telemetry_dir.path().join("cleanup.sqlite3");
    let telemetry = crate::telemetry::Telemetry::open_for_database(
        &telemetry_app,
        "01900000-0000-7000-8000-000000000001",
        crate::telemetry::TelemetryConfig::default(),
    )
    .expect("cleanup telemetry");
    let connection_id = "maintenance-panic-retry";
    state
        .connections
        .open(Some(connection_id.to_owned()), None, true)
        .expect("open idle cleanup target");
    state.ephemeral.touch_connection(connection_id);
    state
        .ephemeral
        .enqueue_durable_for_test(connection_id, b"residue".to_vec());

    let mut captures = state.connections.retire_idle_for_cleanup(u64::MAX);
    assert_eq!(captures.len(), 1);
    let capture = captures.pop().expect("one exact retired capture");
    let failed = super::RetiredConnectionCleanupTask {
        retry_capture: capture.clone(),
        task: tokio::spawn(async { panic!("injected retired cleanup panic") }),
    };
    let retry = super::join_retired_connection_cleanup_batch(vec![failed], &telemetry).await;
    assert_eq!(retry, vec![capture.clone()]);
    let replacement = state
        .connections
        .open(Some(connection_id.to_owned()), None, true)
        .expect("mint-only containment redirects a requested retired id");
    assert_ne!(
        replacement.connection_id, connection_id,
        "mint-only containment forbids readable-id reuse while cleanup retries"
    );
    assert!(
        state
            .ephemeral
            .has_connection_residue_for_test(connection_id),
        "the injected pre-cleanup panic leaves observable retry work"
    );

    let retried = super::spawn_retired_connection_cleanup_batch(&state, retry);
    assert!(
        super::join_retired_connection_cleanup_batch(retried, &telemetry)
            .await
            .is_empty(),
        "the exact retained capture completes its idempotent retry"
    );
    assert!(
        !state
            .ephemeral
            .has_connection_residue_for_test(connection_id),
        "retry removes the retired connection's whole-id residue"
    );
    state.connections.lock().assert_grant_indexes_consistent();
    telemetry.force_flush().expect("flush cleanup diagnostic");
    let count = physical_telemetry_events_for_test(
        &telemetry,
        Some("diagnostic"),
        Some("SNAPBACK_CONNECTION_CLEANUP_FAILED"),
    )
    .into_iter()
    .filter(|event| event.code.as_deref() == Some("SNAPBACK_CONNECTION_CLEANUP_FAILED"))
    .count();
    assert_eq!(count, 1, "the emission boundary records exactly once");
}

/// @ref LLP 0059#locking-and-linearization — once the exact stage CAS
/// commits, the request owns only a join handle. The independently owned
/// finalizer keeps both the stage and authority-work permit through Local
/// publication even when its request-side waiter is cancelled.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn committed_live_stage_finalize_outlives_request_cancellation_and_retains_work() {
    let state = tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        auth_projection_http_fixture("owned-finalize-fixture", 0, 0)
    })
    .await
    .expect("build SQLite-backed fixture off the async worker");
    let coordinator = state.auth_coordinator.clone().expect("coordinator");
    let (epoch_now_ms, monotonic_now) = super::auth_runtime_now(&state);
    let prepared_open = state
        .connections
        .prepare_open_authority(
            coordinator.as_ref(),
            super::PresentedSessionBearer::Absent,
            epoch_now_ms,
            monotonic_now,
        )
        .expect("prepare managed anonymous connection");
    let opened = state
        .connections
        .open_prepared(ConnectionOpenAttempt::new(
            Some("owned-finalize".to_owned()),
            None,
            true,
            prepared_open,
            epoch_now_ms,
            monotonic_now,
            Some(crate::auth::invalidation::AUTH_INVALIDATION_PROTOCOL_VERSION),
        ))
        .expect("open managed staged connection");
    let mut connection_act = state
        .connections
        .prepare_act(
            &opened.grant.connection_id,
            Some(&opened.grant.connection_token),
            Some(coordinator.as_ref()),
            false,
            epoch_now_ms,
            monotonic_now,
        )
        .expect("prepare exact staged connection act");
    assert!(connection_act.authorization_invalidation.is_some());

    let admission = test_route_admission(&state).0;
    let authority = InvocationGate::prepare_admitted_subjectless_authority(
        InvocationSource::LiveInitialQuery,
        AuthMode::Sessions,
        state.server.profile,
        admission.clone(),
        &WireAuthorityFields::default(),
        connection_act.resolved.clone(),
        test_session_claims_for(&connection_act.resolved),
    )
    .expect("prepare staged live authority")
    .with_fenced_publication(connection_act.bound.publication().clone());
    connection_act.route_authority = Some(authority);
    let connection_id = opened.grant.connection_id.clone();
    let effect_fence = connection_act.effect_fence();
    let staging_act = connection_act.clone();
    let staged = with_snapback(&state.snapback, move |snapback| {
        staging_act.prepare_live_subscribe(
            snapback,
            "listItems".to_owned(),
            LiveSubscribeInput {
                connection_id: "wire-selected-other-connection".to_owned(),
                input: HandlerInput::default(),
                authorization_namespace: Some(QueryNamespace {
                    client_store_id: "owned_finalize_store".to_owned(),
                    query_key: "listItems:{}".to_owned(),
                    query_instance_id: 9_001,
                }),
                supersedes: None,
                resume_from_token: None,
            },
            None,
        )
    })
    .await
    .expect("reserve Local stage without running the query");
    let authority_work = connection_act
        .reserve_authority_work(epoch_now_ms, monotonic_now)
        .expect("reserve retained authority work");
    assert_eq!(
        staged
            .try_commit("wire-selected-other-connection", &effect_fence)
            .expect_err("the wire connection id is not retained by the stage")
            .diagnostic
            .code,
        "SNAPBACK_LIVE_STAGE_BINDING_MISMATCH"
    );
    let committed_stage = staged.clone();
    connection_act
        .try_act(&state.connections, epoch_now_ms, monotonic_now, || {
            let _effect = admission.effect_guard("owned-finalize test stage CAS")?;
            committed_stage
                .try_commit(&connection_id, &effect_fence)
                .map_err(super::ApiError::from)
        })
        .expect("exact connection act commits the stage");

    let (child_started_tx, child_started_rx) = tokio::sync::oneshot::channel();
    let (allow_finalize_tx, allow_finalize_rx) = tokio::sync::oneshot::channel();
    let (local_finished_tx, local_finished_rx) = tokio::sync::oneshot::channel();
    let (allow_permit_drop_tx, allow_permit_drop_rx) = tokio::sync::oneshot::channel();
    let (child_done_tx, child_done_rx) = tokio::sync::oneshot::channel();
    let finalize_state = state.snapback.clone();
    let request_waiter = tokio::spawn(async move {
        let owned_finalizer = tokio::spawn(async move {
            child_started_tx
                .send(())
                .expect("request observes owned child spawn");
            allow_finalize_rx
                .await
                .expect("test releases owned Local finalize");
            let publication = with_snapback(&finalize_state, move |snapback| {
                snapback.finalize_subscribe_live_for_transport(&staged)
            })
            .await;
            local_finished_tx
                .send(())
                .expect("test observes Local finalize completion");
            allow_permit_drop_rx
                .await
                .expect("test releases retained authority work");
            drop(authority_work);
            let _ = child_done_tx.send(publication);
        });
        owned_finalizer.await
    });
    tokio::time::timeout(Duration::from_secs(2), child_started_rx)
        .await
        .expect("owned finalizer starts")
        .expect("owned finalizer start signal");
    request_waiter.abort();
    assert!(
        request_waiter
            .await
            .expect_err("request-side waiter is cancelled")
            .is_cancelled()
    );

    let reset_coordinator = coordinator.clone();
    let reset_waiter = tokio::spawn(async move { reset_coordinator.premark_stream_reset().await });
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            match connection_act.reserve_authority_work(epoch_now_ms, monotonic_now) {
                Ok(extra) => drop(extra),
                Err(_) => break,
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("stream premark closes new authority-work reservations");
    assert!(
        !reset_waiter.is_finished(),
        "stream premark drains rather than rejecting existing work"
    );
    allow_finalize_tx
        .send(())
        .expect("release owned Local finalize");
    tokio::time::timeout(Duration::from_secs(2), local_finished_rx)
        .await
        .expect("owned Local finalize completes after request cancellation")
        .expect("Local finalize completion signal");
    assert!(
        !reset_waiter.is_finished(),
        "permit remains active through Local finalize completion"
    );

    allow_permit_drop_tx
        .send(())
        .expect("release retained authority permit");
    let publication = tokio::time::timeout(Duration::from_secs(2), child_done_rx)
        .await
        .expect("owned child finishes")
        .expect("owned child result")
        .expect("Local stage publishes successfully");
    assert!(!publication.output.subscription_id.is_empty());

    let reset = tokio::time::timeout(Duration::from_secs(2), reset_waiter)
        .await
        .expect("terminal premark drains after owned finalizer drops its permit")
        .expect("terminal premark task joins")
        .expect("terminal premark succeeds after drain");
    let rollback = SnapbackError::error("TEST_ROLLBACK", "test", "known rollback");
    assert_eq!(
        coordinator
            .finish_stream_reset::<()>(reset, AuthTransactionAttempt::RolledBack(rollback))
            .expect_err("test rollback propagates")
            .diagnostic
            .code,
        "TEST_ROLLBACK"
    );
}

/// @ref LLP 0059#locking-and-linearization — route orchestration must
/// abandon a Local reservation when exact-grant validation refuses the
/// final bounded act; no query, subscription, or obligation may publish.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn refused_connection_act_abandons_staged_subscribe_without_publication() {
    let state = tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        auth_projection_http_fixture("refused-stage-fixture", 0, 0)
    })
    .await
    .expect("build SQLite-backed fixture off the async worker");
    let coordinator = state.auth_coordinator.clone().expect("coordinator");
    let (epoch_now_ms, monotonic_now) = super::auth_runtime_now(&state);
    let prepared_open = state
        .connections
        .prepare_open_authority(
            coordinator.as_ref(),
            super::PresentedSessionBearer::Absent,
            epoch_now_ms,
            monotonic_now,
        )
        .expect("prepare managed anonymous connection");
    let opened = state
        .connections
        .open_prepared(ConnectionOpenAttempt::new(
            Some("refused-stage".to_owned()),
            None,
            true,
            prepared_open,
            epoch_now_ms,
            monotonic_now,
            Some(crate::auth::invalidation::AUTH_INVALIDATION_PROTOCOL_VERSION),
        ))
        .expect("open managed staged connection");
    let mut connection_act = state
        .connections
        .prepare_act(
            &opened.grant.connection_id,
            Some(&opened.grant.connection_token),
            Some(coordinator.as_ref()),
            false,
            epoch_now_ms,
            monotonic_now,
        )
        .expect("prepare exact staged connection act");
    let admission = test_route_admission(&state).0;
    let authority = InvocationGate::prepare_admitted_subjectless_authority(
        InvocationSource::LiveInitialQuery,
        AuthMode::Sessions,
        state.server.profile,
        admission.clone(),
        &WireAuthorityFields::default(),
        connection_act.resolved.clone(),
        test_session_claims_for(&connection_act.resolved),
    )
    .expect("prepare staged live authority")
    .with_fenced_publication(connection_act.bound.publication().clone());
    connection_act.route_authority = Some(authority);

    // Stage preparation still succeeds, but the exact act must observe
    // that retirement removed this grant before invoking its closure.
    let capture = state
        .connections
        .retire_connection_for_cleanup(&opened.grant.connection_id)
        .expect("retire the prepared grant before the route act");
    let error = super::subscribe_live(
        State(state.clone()),
        Extension(connection_act),
        Extension(admission),
        axum::extract::Path("listItems".to_owned()),
        Ok(Json(crate::local::LiveSubscribeRequest {
            input: LiveSubscribeInput {
                connection_id: opened.grant.connection_id.clone(),
                input: HandlerInput::default(),
                authorization_namespace: Some(QueryNamespace {
                    client_store_id: "refused_stage_store".to_owned(),
                    query_key: "listItems:{}".to_owned(),
                    query_instance_id: 9_002,
                }),
                supersedes: None,
                resume_from_token: None,
            },
            expected_generation: None,
        })),
    )
    .await
    .expect_err("the retired exact grant refuses the route act");
    assert_eq!(error.0.diagnostic.code, "SNAPBACK_CONNECTION_TOKEN_INVALID");

    let counts = with_snapback(&state.snapback, |snapback| {
        Ok::<_, SnapbackError>(snapback.staged_live_effect_counts_for_test())
    })
    .await
    .expect("inspect staged Local state");
    assert_eq!(counts, (0, 0), "refusal abandons without publication");

    super::cleanup_retired_connection(state, capture).await;
}

/// The global LocalSnapback owner must never contain a reverse auth edge
/// or invoke the compatibility teardown orchestration. Parse production
/// source rather than relying on a brittle whitespace substring check.
#[test]
fn production_with_snapback_closures_exclude_auth_acts_and_compat_teardown() {
    #[derive(Default)]
    struct ForbiddenCallVisitor {
        calls: Vec<String>,
    }

    impl<'ast> Visit<'ast> for ForbiddenCallVisitor {
        fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
            let method = call.method.to_string();
            if method == "try_act"
                || matches!(
                    method.as_str(),
                    "disconnect" | "disconnect_guarded" | "reap_stale_connections"
                )
            {
                self.calls.push(method);
            }
            syn::visit::visit_expr_method_call(self, call);
        }

        fn visit_expr_call(&mut self, call: &'ast syn::ExprCall) {
            if let syn::Expr::Path(function) = call.func.as_ref()
                && let Some(method) = function.path.segments.last()
            {
                let method = method.ident.to_string();
                if method == "try_act"
                    || matches!(
                        method.as_str(),
                        "disconnect" | "disconnect_guarded" | "reap_stale_connections"
                    )
                {
                    self.calls.push(method);
                }
            }
            syn::visit::visit_expr_call(self, call);
        }
    }

    #[derive(Default)]
    struct WithSnapbackClosureVisitor {
        closure_count: usize,
        violations: Vec<String>,
    }

    impl<'ast> Visit<'ast> for WithSnapbackClosureVisitor {
        fn visit_item_mod(&mut self, module: &'ast syn::ItemMod) {
            if module.ident == "tests" {
                return;
            }
            syn::visit::visit_item_mod(self, module);
        }

        fn visit_expr_call(&mut self, call: &'ast syn::ExprCall) {
            let is_with_snapback = matches!(
                call.func.as_ref(),
                syn::Expr::Path(function)
                    if function
                        .path
                        .segments
                        .last()
                        .is_some_and(|segment| segment.ident == "with_snapback")
            );
            if is_with_snapback {
                for argument in &call.args {
                    if let syn::Expr::Closure(closure) = argument {
                        self.closure_count += 1;
                        let mut forbidden = ForbiddenCallVisitor::default();
                        forbidden.visit_expr(closure.body.as_ref());
                        self.violations.extend(forbidden.calls);
                    }
                }
            }
            syn::visit::visit_expr_call(self, call);
        }
    }

    let source_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/server.rs");
    let source = fs::read_to_string(&source_path).expect("read production server source");
    let syntax = syn::parse_file(&source).expect("parse production server source");
    let mut visitor = WithSnapbackClosureVisitor::default();
    visitor.visit_file(&syntax);
    assert!(
        visitor.closure_count >= 50,
        "source guard must inspect the production with_snapback closure population"
    );
    assert!(
        visitor.violations.is_empty(),
        "with_snapback closures contain forbidden auth/compatibility calls: {:?}",
        visitor.violations
    );
}

#[test]
fn t10_source_inventory_pins_legacy_host_type_and_split_executor_routing() {
    #[derive(Default)]
    struct CallInventory {
        current: Option<String>,
        calls: BTreeMap<String, BTreeSet<String>>,
    }

    impl<'ast> Visit<'ast> for CallInventory {
        fn visit_item_mod(&mut self, module: &'ast syn::ItemMod) {
            if module.ident == "tests" {
                return;
            }
            syn::visit::visit_item_mod(self, module);
        }

        fn visit_item_fn(&mut self, function: &'ast syn::ItemFn) {
            let previous = self.current.replace(function.sig.ident.to_string());
            syn::visit::visit_item_fn(self, function);
            self.current = previous;
        }

        fn visit_expr_call(&mut self, call: &'ast syn::ExprCall) {
            if let Some(current) = self.current.as_ref()
                && let syn::Expr::Path(path) = call.func.as_ref()
                && let Some(callee) = path.path.segments.last()
            {
                self.calls
                    .entry(current.clone())
                    .or_default()
                    .insert(callee.ident.to_string());
            }
            syn::visit::visit_expr_call(self, call);
        }

        fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
            if let Some(current) = self.current.as_ref() {
                self.calls
                    .entry(current.clone())
                    .or_default()
                    .insert(call.method.to_string());
            }
            syn::visit::visit_expr_method_call(self, call);
        }
    }

    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let server_source =
        fs::read_to_string(root.join("src/server.rs")).expect("read production server source");
    let admin_source =
        fs::read_to_string(root.join("src/admin.rs")).expect("read production admin source");
    let engine_source = fs::read_to_string(root.join("../snapback-engine/src/local/engine.rs"))
        .expect("read production engine source");
    let mut inventory = CallInventory::default();
    inventory.visit_file(&syn::parse_file(&server_source).expect("parse production server source"));
    inventory.visit_file(&syn::parse_file(&admin_source).expect("parse production admin source"));

    for function in [
        "run_staged_app_action",
        "execute_cron_claim_detached",
        "config_verify",
    ] {
        assert!(
            inventory
                .calls
                .get(function)
                .is_some_and(|calls| calls.contains("run_managed_host_plan_action")),
            "{function} must route HostPlan actions through the per-step authorization reservation executor"
        );
    }
    assert!(
        inventory
            .calls
            .get("invoke_action_inner")
            .is_some_and(|calls| calls.contains("run_staged_app_action")),
        "the HTTP action route must reach the shared managed action executor"
    );
    assert!(
        inventory
            .calls
            .get("admin_run_function")
            .is_some_and(|calls| calls.contains("run_staged_app_action")),
        "the admin function runner must reach the shared managed action executor"
    );
    assert!(
        inventory
            .calls
            .values()
            .all(|calls| !calls.contains("invoke_action_prepared")),
        "managed server/admin source must not invoke a nested-writing action while holding Local"
    );
    let engine = syn::parse_file(&engine_source).expect("parse production engine source");
    let local_host = engine
        .items
        .iter()
        .find_map(|item| match item {
            syn::Item::Struct(item) if item.ident == "LocalIbexActionHost" => Some(item),
            _ => None,
        })
        .expect("legacy local action host remains explicit");
    let authority = local_host
        .fields
        .iter()
        .find(|field| {
            field
                .ident
                .as_ref()
                .is_some_and(|ident| ident == "authority")
        })
        .expect("legacy host authority field");
    let syn::Type::Path(authority) = &authority.ty else {
        panic!("legacy host authority must be a closed nominal type")
    };
    assert_eq!(
        authority
            .path
            .segments
            .last()
            .expect("authority type")
            .ident,
        "LegacyLocalActionAuthority",
        "the source inventory requires LocalIbexActionHost's nominal legacy authority type"
    );
    assert!(
        engine_source.contains("ResolvedAppAuthority::Session(_)")
            && engine_source.contains("ResolvedAppAuthority::ServicePrincipal(_)")
            && engine_source.contains(
                "finite caller actions must use the managed or detached split-phase executor"
            ),
        "the source inventory requires explicit finite-posture refusal arms"
    );
}

/// @ref LLP 0059#connection-bound-authority — current-bearer opens resolve
/// solely through the projection, store only the closed grant authority,
/// record one qualifying use, and reject a superseded predecessor.
#[tokio::test]
async fn connection_open_uses_projected_current_bearer_and_records_sliding_use() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = state
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, false, false, false),
        )
        .expect("install item-5 sessions posture");
    let credential = mint_test_credential(&state, "connection-open@example.com").await;
    let predecessor = credential["token"]
        .as_str()
        .expect("credential token")
        .to_owned();
    let (projected, before_deadline) = projected_connection_deadline(&state, &predecessor);
    tokio::time::sleep(Duration::from_millis(5)).await;
    let router = app(state.clone());
    let response = router
        .clone()
        .oneshot(connection_open_request(Some(&predecessor), json!({})))
        .await
        .expect("connection open response");
    let status = response.status();
    let opened = response_json(response).await;
    assert_eq!(status, StatusCode::OK, "unexpected open response: {opened}");
    let connection_id = opened["connectionId"].as_str().unwrap().to_owned();
    let connection_token = opened["connectionToken"].as_str().unwrap().to_owned();
    let (_after_authority, after_deadline) = projected_connection_deadline(&state, &predecessor);
    assert!(
        after_deadline > before_deadline,
        "a successful current-bearer open is a qualifying sliding use"
    );
    {
        let state_guard = state.connections.lock();
        let record = state_guard
            .grants
            .get(&connection_id)
            .expect("stored grant");
        let BoundGrantAuthority::Session {
            session_id,
            user_id,
            provider,
            generation,
            deadline_ms,
            ..
        } = &record.authority
        else {
            panic!("current bearer must mint a session grant")
        };
        let ResolvedAppAuthority::Session(subject) = projected else {
            panic!("fixture bearer must project session authority")
        };
        assert_eq!(session_id, subject.session_id());
        assert_eq!(user_id, subject.user_id());
        assert_eq!(provider, subject.provider());
        assert_eq!(*generation, subject.generation());
        assert_eq!(*deadline_ms, after_deadline);
        assert!(!format!("{:?}", record.authority).contains(&predecessor));
        state_guard.assert_grant_indexes_consistent();
    }

    let reopened = router
        .clone()
        .oneshot(connection_open_request(
            Some(&predecessor),
            json!({
                "connectionId": connection_id,
                "previousToken": connection_token,
            }),
        ))
        .await
        .expect("exact reopen response");
    assert_eq!(reopened.status(), StatusCode::OK);
    let reopened = response_json(reopened).await;
    assert_eq!(reopened, opened);

    let rotated = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/refresh",
            br#"{}"#.to_vec(),
            &predecessor,
        ))
        .await
        .expect("rotate bearer after grant");
    assert_eq!(rotated.status(), StatusCode::OK);
    let rotated = response_json(rotated).await;
    let successor = rotated["token"]
        .as_str()
        .expect("successor token")
        .to_owned();
    let refused = router
        .clone()
        .oneshot(connection_open_request(Some(&predecessor), json!({})))
        .await
        .expect("superseded open response");
    assert_eq!(refused.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(refused).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED"
    );

    let successor_reuse = router
        .oneshot(connection_open_request(
            Some(&successor),
            json!({
                "connectionId": opened["connectionId"],
                "previousToken": opened["connectionToken"],
            }),
        ))
        .await
        .expect("successor exact-authority reuse response");
    assert_eq!(successor_reuse.status(), StatusCode::OK);
    assert_eq!(response_json(successor_reuse).await, opened);
}

/// @ref LLP 0059#connection-bound-authority — even a semantically rejected
/// body consumes the exact projected session source before returning.
#[tokio::test]
async fn rejected_connection_open_bodies_still_consume_session_budget() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = state
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, false, false, false),
        )
        .expect("install item-5 sessions posture");
    let credential = mint_test_credential(&state, "rejected-open@example.com").await;
    let bearer = credential["token"].as_str().expect("credential token");
    let router = app(state);
    let mut missing_protocol =
        connection_open_request(Some(bearer), json!({ "userId": "client-asserted" }));
    missing_protocol
        .headers_mut()
        .remove("x-snapback-auth-client-protocol");
    let missing_protocol = router
        .clone()
        .oneshot(missing_protocol)
        .await
        .expect("missing-protocol open response");
    assert_eq!(missing_protocol.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(missing_protocol).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED"
    );
    for attempt in 1..super::CONNECTION_OPEN_SESSION_LIMIT {
        let response = router
            .clone()
            .oneshot(connection_open_request(
                Some(bearer),
                json!({ "userId": "client-asserted" }),
            ))
            .await
            .expect("rejected open response");
        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "rejected attempt {attempt} should reach semantic body refusal"
        );
        assert_eq!(
            response_json(response).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED"
        );
    }
    let throttled = router
        .oneshot(connection_open_request(
            Some(bearer),
            json!({ "userId": "client-asserted" }),
        ))
        .await
        .expect("throttled rejected open response");
    assert_eq!(throttled.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(throttled.headers()[header::RETRY_AFTER], "60");
    assert_eq!(
        response_json(throttled).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_THROTTLED"
    );
}

#[tokio::test]
async fn service_token_terminalization_is_carrier_exact_within_one_durable_grant() {
    let fixture = finite_authority_matrix_fixture().await;
    let (second_bearer, second_token_id) =
        mint_same_grant_sibling_and_set_deadline(&fixture, fixture.start_ms + 48 * 60 * 60 * 1_000)
            .await;
    let (epoch_now_ms, monotonic_now) = super::auth_runtime_now(&fixture.state);
    let first_authority = super::prepare_connection_open_authority_with_scoped_token(
        &fixture.state,
        super::PresentedSessionBearer::Candidate(&fixture.token),
        epoch_now_ms,
        monotonic_now,
        None,
    )
    .await
    .expect("resolve first genuine service carrier");
    let second_authority = super::prepare_connection_open_authority_with_scoped_token(
        &fixture.state,
        super::PresentedSessionBearer::Candidate(&second_bearer),
        epoch_now_ms,
        monotonic_now,
        None,
    )
    .await
    .expect("resolve sibling genuine service carrier");
    let first = fixture
        .state
        .connections
        .open_prepared(super::ConnectionOpenAttempt::new(
            Some("service-carrier-a".to_owned()),
            None,
            true,
            first_authority,
            epoch_now_ms,
            monotonic_now,
            None,
        ))
        .expect("open first genuine service carrier");
    let second = fixture
        .state
        .connections
        .open_prepared(super::ConnectionOpenAttempt::new(
            Some("service-carrier-b".to_owned()),
            None,
            true,
            second_authority,
            epoch_now_ms,
            monotonic_now,
            None,
        ))
        .expect("open sibling genuine service carrier");
    let state = &fixture.state;
    let notifier = state.ephemeral.delivery_notifier();
    let (first_generation, first_waker) = notifier
        .register_bound(&first.grant.connection_id, first.grant_id.clone())
        .unwrap();
    let (second_generation, second_waker) = notifier
        .register_bound(&second.grant.connection_id, second.grant_id.clone())
        .unwrap();

    state.auth_terminal_lifecycle.evict_service_tokens(
        std::slice::from_ref(&fixture.token_id),
        Instant::now() + Duration::from_secs(5),
    );
    tokio::time::timeout(Duration::from_secs(1), first_waker.notified())
        .await
        .expect("exact carrier wakes");
    let terminal = notifier
        .terminal_if_current(&first.grant.connection_id, first_generation)
        .expect("evicted carrier receives a terminal event");
    assert_eq!(
        terminal.authority_disposition,
        crate::live_wire::LiveAuthorityDisposition::Carrier
    );
    assert!(
        notifier
            .terminal_if_current(&second.grant.connection_id, second_generation)
            .is_none(),
        "sibling token on the same durable grant remains live"
    );
    let (epoch_now_ms, monotonic_now) = super::auth_runtime_now(&fixture.state);
    let second_act = fixture
        .state
        .connections
        .prepare_act(
            &second.grant.connection_id,
            Some(&second.grant.connection_token),
            fixture.state.auth_coordinator.as_deref(),
            false,
            epoch_now_ms,
            monotonic_now,
        )
        .expect("sibling carrier remains current");
    assert!(matches!(
        second_act.resolved,
        ResolvedAppAuthority::ServicePrincipal(ref subject)
            if subject.token_id() == second_token_id
    ));

    state.auth_terminal_lifecycle.expire_service_tokens(
        std::slice::from_ref(&second_token_id),
        Instant::now() + Duration::from_secs(5),
    );
    tokio::time::timeout(Duration::from_secs(1), second_waker.notified())
        .await
        .expect("expired carrier wakes");
    let expired = notifier
        .terminal_if_current(&second.grant.connection_id, second_generation)
        .expect("expired carrier receives a terminal event");
    assert_eq!(
        expired.reason,
        crate::live_wire::LiveAuthErrorReason::Expired
    );
    assert_eq!(
        expired.authority_disposition,
        crate::live_wire::LiveAuthorityDisposition::Carrier
    );
    fixture
        .state
        .connections
        .lock()
        .assert_grant_indexes_consistent();
}

/// The live-stream deadline observer owns the same all-token fanout as the
/// finite HTTP path. A quiet sibling socket must not wait to observe its own
/// deadline before receiving the grant-scoped terminal event.
///
/// @ref LLP 0059#typed-terminal-auth-error — authoritative grant expiry
/// wakes every affected socket with expired/durableDelete.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn delayed_live_observer_grant_expiry_preserves_close_budget_and_fanout() {
    let fixture = finite_authority_matrix_fixture().await;
    let grant_deadline_ms = fixture.start_ms + 1_000;
    let (second_token, second_token_id) =
        mint_same_grant_sibling_and_set_deadline(&fixture, grant_deadline_ms).await;
    let tokens = [
        (fixture.token.clone(), fixture.token_id.clone()),
        (second_token, second_token_id),
    ];
    let notifier = fixture.state.ephemeral.delivery_notifier();
    let mut sockets = Vec::new();
    let mut observing_act = None;
    for (index, (token, expected_token_id)) in tokens.iter().enumerate() {
        let opened = fixture
            .router
            .clone()
            .oneshot(connection_open_request(
                Some(token),
                json!({
                    "connectionId": format!("live-grant-expiry-{index}"),
                    "authInvalidationProtocol": 1,
                }),
            ))
            .await
            .expect("open same-grant service socket");
        let status = opened.status();
        let opened = response_json(opened).await;
        assert_eq!(status, StatusCode::OK, "unexpected open response: {opened}");
        let connection_id = opened["connectionId"]
            .as_str()
            .expect("connection id")
            .to_owned();
        let connection_token = opened["connectionToken"]
            .as_str()
            .expect("connection token")
            .to_owned();
        let (connection_grant_id, publication) = {
            let registry = fixture.state.connections.lock();
            let record = registry
                .grants
                .get(&connection_id)
                .expect("stored service grant");
            let BoundGrantAuthority::ServicePrincipal {
                token_id,
                service_publication,
                ..
            } = &record.authority
            else {
                panic!("scoped token must mint service authority")
            };
            assert_eq!(token_id, expected_token_id);
            (record.grant_id.clone(), service_publication.clone())
        };
        let (generation, waker) = notifier
            .register_bound(&connection_id, connection_grant_id)
            .expect("register exact service socket");
        if index == 0 {
            let (epoch_now_ms, monotonic_now) = super::auth_runtime_now(&fixture.state);
            observing_act = Some(
                fixture
                    .state
                    .connections
                    .prepare_act(
                        &connection_id,
                        Some(&connection_token),
                        fixture.state.auth_coordinator.as_deref(),
                        false,
                        epoch_now_ms,
                        monotonic_now,
                    )
                    .expect("prepare the observing service socket"),
            );
        }
        sockets.push((connection_id, generation, waker, publication));
    }

    let expected_close_by = fixture.clock.monotonic_at(grant_deadline_ms)
        + crate::auth::session_projection::TERMINAL_CLOSE_GRACE;
    let delayed_observation_ms = grant_deadline_ms
        + crate::auth::session_projection::TERMINAL_CLOSE_GRACE.as_millis() as u64
        + 1_000;
    fixture.clock.set(delayed_observation_ms);
    let observing_act = observing_act.expect("one observing service act");
    super::inject_test_live_service_terminal_failure(
        &fixture.token_id,
        super::TestLiveServiceTerminalFailure::Planning,
    );
    let error = super::observe_service_connection_terminal_once(&fixture.state, &observing_act)
        .await
        .expect_err("the injected planning failure must remain visible");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_TEST_LIVE_SERVICE_TERMINAL_FAILURE"
    );
    for (connection_id, generation, _, publication) in &sockets {
        assert!(
            notifier
                .terminal_if_current(connection_id, *generation)
                .is_none(),
            "a failed attempt cannot infer a durable typed terminal"
        );
        assert_eq!(
            publication
                .resolve_act(fixture.clock.epoch_ms(), fixture.clock.monotonic_now())
                .expect("resolve fail-closed deadline publication"),
            ServiceAuthorityActResolution::Unavailable,
            "the due publication stays fail-closed after observer failure"
        );
        assert!(
            fixture
                .state
                .connections
                .lock()
                .grants
                .contains_key(connection_id),
            "failed durable observation cannot report premature retirement"
        );
    }

    for failure in [
        super::TestLiveServiceTerminalFailure::Gate,
        super::TestLiveServiceTerminalFailure::Transaction,
        super::TestLiveServiceTerminalFailure::OwnedTaskPanic,
    ] {
        super::inject_test_live_service_terminal_failure(&fixture.token_id, failure);
    }
    let error = super::observe_service_connection_terminal(&fixture.state, &observing_act)
        .await
        .expect_err("the first observer failure must remain visible to its socket owner");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_TEST_LIVE_SERVICE_TERMINAL_FAILURE"
    );

    for (connection_id, generation, waker, publication) in &sockets {
        tokio::time::timeout(Duration::from_secs(1), waker.notified())
            .await
            .unwrap_or_else(|_| panic!("live grant expiry did not wake {connection_id}"));
        let terminal = notifier
            .terminal_if_current(connection_id, *generation)
            .unwrap_or_else(|| panic!("live grant expiry did not terminalize {connection_id}"));
        assert_eq!(
            terminal.reason,
            crate::live_wire::LiveAuthErrorReason::Expired
        );
        assert_eq!(
            terminal.authority_disposition,
            crate::live_wire::LiveAuthorityDisposition::DurableDelete
        );
        assert_eq!(
            terminal.close_by, expected_close_by,
            "grant observer latency must consume the projected close budget"
        );
        assert!(
            terminal.close_by < fixture.clock.monotonic_at(delayed_observation_ms),
            "a delayed observer cannot grant a fresh terminal-close grace"
        );
        assert_eq!(
            publication
                .resolve_act(fixture.clock.epoch_ms(), fixture.clock.monotonic_now())
                .expect("resolve committed live-observed grant expiry"),
            ServiceAuthorityActResolution::Terminal(ServiceAuthorityDisposition::DurableDelete,)
        );
        assert!(
            !fixture
                .state
                .connections
                .lock()
                .grants
                .contains_key(connection_id),
            "live-observed grant expiry retires every same-grant connection"
        );
    }
    assert!(
        super::test_live_service_terminal_failures_drained(&fixture.token_id),
        "the owned retry consumed every deterministic failure before terminal fanout"
    );
    fixture
        .state
        .connections
        .lock()
        .assert_grant_indexes_consistent();
}

/// Grant expiry ends the durable authority axis, not merely the carrier
/// that first notices the deadline. Crossing the deadline after middleware
/// has resolved a direct scoped bearer also proves that managed Local work
/// cannot steal the terminal write from the owned all-token fanout.
///
/// @ref LLP 0055#ending-authority-revocation-expiry-deactivation — grant
/// expiry deletes every carrier on the durable grant axis.
/// @ref LLP 0059#finite-service-authority-fence — the read-only planned
/// token set is retained through commit and lifecycle propagation.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn grant_deadline_crossing_direct_bearer_expires_every_same_grant_socket() {
    let fixture = finite_authority_matrix_fixture().await;
    // Retained live validation deliberately samples the host wall clock,
    // while service publications carry the injected provider clock. Keep
    // the grant live in both domains during setup, then advance the manual
    // epoch/monotonic pair directly to this future deadline.
    let grant_deadline_ms = super::now_millis().saturating_add(60_000);
    let (second_token, second_token_id) =
        mint_same_grant_sibling_and_set_deadline(&fixture, grant_deadline_ms).await;

    let notifier = fixture.state.ephemeral.delivery_notifier();
    let tokens = [
        (fixture.token.clone(), fixture.token_id.clone()),
        (second_token, second_token_id),
    ];
    let mut opened_sockets = Vec::new();
    for (index, (token, expected_token_id)) in tokens.iter().enumerate() {
        let readable_connection_id = format!("grant-expiry-carrier-{index}");
        let opened = fixture
            .router
            .clone()
            .oneshot(connection_open_request(
                Some(token),
                json!({
                    "connectionId": readable_connection_id,
                    "authInvalidationProtocol": 1,
                }),
            ))
            .await
            .expect("open same-grant service socket");
        let status = opened.status();
        let opened = response_json(opened).await;
        assert_eq!(status, StatusCode::OK, "unexpected open response: {opened}");
        let connection_id = opened["connectionId"]
            .as_str()
            .expect("connection id")
            .to_owned();
        let connection_token = opened["connectionToken"]
            .as_str()
            .expect("connection token")
            .to_owned();
        let (connection_grant_id, publication) = {
            let registry = fixture.state.connections.lock();
            let record = registry
                .grants
                .get(&connection_id)
                .expect("stored service grant");
            let BoundGrantAuthority::ServicePrincipal {
                token_id,
                service_publication,
                ..
            } = &record.authority
            else {
                panic!("scoped token must mint service authority")
            };
            assert_eq!(token_id, expected_token_id);
            (record.grant_id.clone(), service_publication.clone())
        };
        opened_sockets.push((
            index,
            connection_id,
            connection_token,
            connection_grant_id,
            publication,
        ));
    }

    // Both tokens must resolve before retained live validation advances the
    // durable clock from the host wall. Then keep the injected clock ahead
    // of that host sample, but strictly before the shared grant deadline,
    // while both subscriptions are constructed.
    fixture.clock.set(grant_deadline_ms - 30_000);
    let mut sockets = Vec::new();
    for (index, connection_id, connection_token, connection_grant_id, publication) in opened_sockets
    {
        let subscribed = fixture
            .router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/live/liveItems/subscribe")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(super::CONNECTION_TOKEN_HEADER, connection_token.as_str())
                    .header("x-snapback-auth-client-protocol", "1")
                    .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                    .header("x-snapback-auth-invalidation-protocol", "1")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "connection_id": connection_id.clone(),
                            "input": { "args": {} },
                            "authorizationNamespace": {
                                "clientStoreId": format!("grant-expiry-store-{index}"),
                                "queryKey": "liveItems:{}",
                                "queryInstanceId": index + 1,
                            },
                        }))
                        .expect("serialize service subscription"),
                    ))
                    .expect("service subscribe request"),
            )
            .await
            .expect("subscribe same-grant service socket");
        let status = subscribed.status();
        let subscribed = response_json(subscribed).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "unexpected service subscription: {subscribed}"
        );
        assert!(
            fixture
                .state
                .read
                .connection_has_auth_scoped_live(&connection_id),
            "fixture must retain grant-scoped topology before expiry"
        );
        let (generation, waker) = notifier
            .register_bound(&connection_id, connection_grant_id)
            .expect("register exact service socket");
        sockets.push((connection_id, generation, waker, publication));
    }

    let pause = install_test_finite_authority_pause(TestFiniteAuthorityPausePoint::BeforeHandler);
    let mut request = Request::builder()
        .method("POST")
        .uri("/mutation/queuedWrite")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {}", fixture.token))
        .header("x-snapback-auth-client-protocol", "1")
        .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
        .body(Body::from(
            r#"{"args":{"value":"must-not-cross-grant-expiry"}}"#,
        ))
        .expect("direct scoped-bearer mutation request");
    request.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(pause.id()).expect("grant-expiry pause header"),
    );
    let router = fixture.router.clone();
    let crossing = tokio::spawn(async move {
        router
            .oneshot(request)
            .await
            .expect("deadline-crossing direct-bearer response")
    });
    tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
        .await
        .expect("direct bearer reaches the post-resolution pause");
    fixture.clock.set(grant_deadline_ms);
    pause.release().await;

    let response = tokio::time::timeout(Duration::from_secs(5), crossing)
        .await
        .expect("owned expiry transaction does not strand the request")
        .expect("deadline-crossing request task");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let response = response_json(response).await;
    assert_eq!(
        response["diagnostic"]["code"],
        "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID"
    );
    assert_eq!(
        response["diagnostic"]["details"]["authorityDisposition"],
        "durableDelete"
    );
    assert_eq!(
        finite_authority_matrix_item_count(&fixture.state).await,
        1,
        "the Local handler cannot commit after the crossed grant deadline"
    );

    for (connection_id, generation, waker, publication) in &sockets {
        tokio::time::timeout(Duration::from_secs(1), waker.notified())
            .await
            .unwrap_or_else(|_| panic!("grant expiry did not wake {connection_id}"));
        let terminal = notifier
            .terminal_if_current(connection_id, *generation)
            .unwrap_or_else(|| panic!("grant expiry did not terminalize {connection_id}"));
        assert_eq!(
            terminal.code,
            crate::live_wire::LiveAuthErrorCode::ScopedTokenInvalid
        );
        assert_eq!(
            terminal.reason,
            crate::live_wire::LiveAuthErrorReason::Expired
        );
        assert_eq!(
            terminal.authority_disposition,
            crate::live_wire::LiveAuthorityDisposition::DurableDelete
        );
        assert_eq!(
            publication
                .resolve_act(fixture.clock.epoch_ms(), fixture.clock.monotonic_now())
                .expect("resolve committed grant expiry"),
            ServiceAuthorityActResolution::Terminal(ServiceAuthorityDisposition::DurableDelete)
        );
        assert!(
            !fixture
                .state
                .connections
                .lock()
                .grants
                .contains_key(connection_id),
            "grant expiry retires every same-grant connection"
        );
    }
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if sockets.iter().all(|(connection_id, ..)| {
                !fixture
                    .state
                    .read
                    .connection_has_auth_scoped_live(connection_id)
            }) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("owned grant-expiry cleanup purges every service topology");
    fixture
        .state
        .connections
        .lock()
        .assert_grant_indexes_consistent();
}

#[tokio::test]
async fn committed_reset_terminalizes_only_the_exact_bound_socket() {
    let state = auth_invalidation_reset_fixture();
    let registry = state.connections.clone();
    assert!(
        registry.invalidation_expectation_for_test().is_some(),
        "fixture begins with the predecessor connection issuer",
    );
    let grant = registry
        .open(Some("terminal-reset".to_owned()), None, true)
        .expect("open predecessor grant");
    let grant_id = registry
        .lock()
        .grants
        .get(&grant.connection_id)
        .expect("stored predecessor grant")
        .grant_id
        .clone();
    let notifier = state.ephemeral.delivery_notifier();
    let (generation, waker) = notifier
        .register_bound(&grant.connection_id, grant_id)
        .expect("register exact socket grant");
    let close_by = Instant::now() + Duration::from_secs(5);

    state
        .auth_terminal_lifecycle
        .committed_stream_reset(crate::live_wire::LiveAuthErrorReason::Reset, close_by);
    tokio::time::timeout(Duration::from_secs(1), waker.notified())
        .await
        .expect("committed reset wakes exact socket");
    let event = notifier
        .terminal_if_current(&grant.connection_id, generation)
        .expect("terminal event installed");
    assert_eq!(event.code, crate::live_wire::LiveAuthErrorCode::StreamReset);
    assert_eq!(event.reason, crate::live_wire::LiveAuthErrorReason::Reset);
    assert_eq!(
        event.authority_disposition,
        crate::live_wire::LiveAuthorityDisposition::DurableDelete
    );
    assert_eq!(event.close_by, close_by);
    assert!(!notifier.is_deliverable(&grant.connection_id, generation));
    assert!(
        registry
            .verify(&grant.connection_id, Some(&grant.connection_token))
            .is_err(),
        "grant invalidation linearizes before the terminal wake"
    );
    assert!(
        registry.invalidation_expectation_for_test().is_none(),
        "terminal reset clears the predecessor connection issuer",
    );
}

#[tokio::test]
async fn committed_reset_rebuilds_every_invalidation_projection_before_reopening() {
    let state = auth_invalidation_reset_fixture();
    let predecessor = state
        .auth_coordinator
        .as_ref()
        .expect("reset coordinator")
        .authorization_stream_incarnation()
        .expect("predecessor incarnation");
    let old_grant = state
        .connections
        .open(Some("reset-predecessor".to_owned()), None, true)
        .expect("open predecessor connection");
    let route_admission = test_route_admission(&state).0;

    let reset = coordinated_app_reset(&state, &route_admission, None)
        .await
        .expect("committed reset returns success");
    assert!(reset.is_none());

    let successor = state
        .auth_coordinator
        .as_ref()
        .expect("reset coordinator")
        .authorization_stream_incarnation()
        .expect("successor incarnation");
    assert_ne!(successor, predecessor);
    let durable = with_snapback(&state.snapback, |snapback| {
        snapback
            .remainder_auth_fixture()
            .authorization_version()
            .expect("durable reset authorization")
    })
    .await;
    assert_eq!(durable.incarnation, successor);
    assert_eq!(durable.epoch, 0);
    assert!(
        state
            .connections
            .verify(&old_grant.connection_id, Some(&old_grant.connection_token),)
            .is_err(),
        "predecessor connection is terminal after reset",
    );

    let router_projection = state
        .auth_invalidation
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_ref()
        .expect("router successor issuer")
        .authorization_expectation()
        .expect("router authorization expectation");
    assert_eq!(router_projection, durable);
    assert_eq!(
        state
            .connections
            .invalidation_expectation_for_test()
            .expect("connection successor issuer"),
        durable,
    );
    assert_eq!(
        state
            .ephemeral
            .authorization_expectation_for_test()
            .expect("room successor issuer"),
        durable,
    );
    let query_projection = with_snapback(&state.snapback, |snapback| {
        snapback
            .auth_invalidation_expectation_for_test()
            .expect("query successor expectation")
    })
    .await;
    assert_eq!(query_projection, durable);

    let credential = mint_test_credential(&state, "reset-successor@example.com").await;
    let bearer = credential["token"]
        .as_str()
        .expect("fresh successor bearer")
        .to_owned();
    let router = app(state.clone());
    let handshake = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .header("x-snapback-auth-invalidation-protocol", "1")
                .header("x-snapback-authority-descriptor-protocol", "1")
                .header("x-snapback-authorized-lease-protocol", "1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("successor handshake response");
    assert_eq!(handshake.status(), StatusCode::OK);
    let handshake = response_json(handshake).await;
    assert_eq!(handshake["authorizationStreamIncarnation"], successor);
    assert_eq!(
        handshake["availability"]["retainedReads"]["available"],
        true
    );
    assert_eq!(handshake["clientProtocols"]["authorizedLease"], 1);
    assert_eq!(handshake["authorizedLease"]["protocolVersion"], 1);

    let lease_admission = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/query/missing_function/authorized-lease")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .header("x-snapback-auth-invalidation-protocol", "1")
                .header("x-snapback-authorized-lease-protocol", "1")
                .body(Body::from(
                    r#"{
                            "args": {},
                            "leaseRequestId": "reset_successor_request",
                            "clientStoreId": "reset_successor_store",
                            "queryKey": "missing_function:{}",
                            "queryInstanceId": 1
                        }"#,
                ))
                .unwrap(),
        )
        .await
        .expect("successor lease admission response");
    assert_eq!(
        response_json(lease_admission).await["diagnostic"]["code"],
        "SNAPBACK_UNKNOWN_FUNCTION",
        "the successor query and lease gates must reach function lookup",
    );
}

#[test]
fn connection_registry_pressure_evicts_lru_instead_of_permanently_wedging() {
    let registry = ConnectionRegistry::default();
    let first = registry
        .open(Some("first".to_owned()), None, true)
        .expect("first grant");
    let mut second = None;
    for index in 0..(MAX_CONNECTION_GRANTS - 1) {
        let grant = registry
            .open(Some(format!("bulk_{index}")), None, true)
            .expect("bounded grant admission");
        if index == 0 {
            second = Some(grant);
        }
    }
    registry
        .verify(&first.connection_id, Some(&first.connection_token))
        .expect("touch first grant");
    let after_pressure = registry
        .open(Some("after_pressure".to_owned()), None, true)
        .expect("the cap must not wedge future opens");
    assert_eq!(after_pressure.connection_id, "after_pressure");
    assert!(
        registry
            .verify(&first.connection_id, Some(&first.connection_token))
            .is_ok(),
        "recently used grants survive pressure"
    );
    let second = second.expect("second grant");
    assert!(
        registry
            .verify(&second.connection_id, Some(&second.connection_token))
            .is_err(),
        "the least recently used grant is the bounded eviction victim"
    );

    // Mark every remaining grant used and current: admission must refuse
    // instead of revoking live authority.
    {
        let mut state = registry.lock();
        let now = super::now_millis();
        let ids = state.grants.keys().cloned().collect::<Vec<_>>();
        state.unused.clear();
        state.used.clear();
        for id in ids {
            let record = state.grants.get_mut(&id).expect("grant record");
            record.used = true;
            record.last_use_ms = now;
            state.used.insert((now, id));
        }
    }
    let full = registry
        .open(Some("must_wait".to_owned()), None, true)
        .expect_err("current used leases cannot be displaced");
    assert_eq!(
        full.diagnostic.code,
        "SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED"
    );

    // Once those leases are idle-expired, pressure can retire one. The
    // retired readable id is never re-adopted by the new bearer: pressure
    // permanently switches this process to minted ids.
    {
        let mut state = registry.lock();
        let ids = state.grants.keys().cloned().collect::<Vec<_>>();
        state.used.clear();
        for id in ids {
            let record = state.grants.get_mut(&id).expect("grant record");
            record.last_use_ms = 0;
            state.used.insert((0, id));
        }
    }
    assert!(registry.touch_verified_socket(&first.connection_id));
    let retired_id = registry
        .lock()
        .used
        .first()
        .expect("oldest used grant")
        .1
        .clone();
    assert_ne!(retired_id, first.connection_id);
    let replacement = registry
        .open(Some(retired_id.clone()), None, true)
        .expect("expired lease makes bounded room");
    assert_ne!(replacement.connection_id, retired_id);
    assert!(replacement.connection_id.starts_with("conn_"));
    assert!(
        !registry.touch_verified_socket(&retired_id),
        "a pressure-retired socket must fail renewal before its next frame is processed"
    );
    assert!(
        registry
            .verify(&first.connection_id, Some(&first.connection_token))
            .is_ok(),
        "authenticated socket traffic renews the active grant past the idle cutoff"
    );
}

/// LLP 0094 §0B.3: the registry half of the offer matrix — a known offer
/// binds the lineage and every open/re-open response of that lineage
/// echoes the bound version; a legacy lineage never echoes, and a
/// confirming v1 re-open offer does not upgrade it; a changed offer under
/// `previousToken` refuses `SNAPBACK_WIRE_VERSION_MISMATCH` and leaves
/// the grant undisturbed.
#[test]
fn wire_version_binding_echo_and_reopen_immutability() {
    let state = test_detached_app_state(
        LocalSnapback::memory().expect("in-memory wire-version registry state"),
    );
    let registry = state.connections.clone();
    fn anonymous_attempt<'a>(
        suggested: &str,
        previous: Option<&'a str>,
    ) -> ConnectionOpenAttempt<'a> {
        let (incarnation, publication) =
            FencedPublication::anonymous_for_unmanaged_dev_connection();
        ConnectionOpenAttempt::new(
            Some(suggested.to_owned()),
            previous,
            true,
            PreparedConnectionOpenAuthority {
                resolved: ResolvedAppAuthority::Anonymous,
                session_route_authority: None,
                service_route_authority: None,
                managed_authority: false,
                hosted_sender: None,
                bound: BoundGrantAuthority::Anonymous {
                    authorization_stream_incarnation: incarnation,
                    publication,
                },
            },
            super::now_millis(),
            Instant::now(),
            None,
        )
    }
    let v1 = crate::wire_version::WIRE_VERSION_V1;

    // Known offer binds and the fresh-open response echoes it.
    let bound = registry
        .open_prepared(anonymous_attempt("wire_bound", None).with_wire_version(Some(v1.to_owned())))
        .expect("open explicitly bound lineage");
    assert_eq!(bound.grant.wire_version.as_deref(), Some(v1));

    // Offerless re-open of an explicit lineage: admitted, echo emitted.
    let reopened = registry
        .open_prepared(anonymous_attempt(
            "wire_bound",
            Some(&bound.grant.connection_token),
        ))
        .expect("offerless re-open keeps the explicit binding");
    assert!(!reopened.newly_minted);
    assert_eq!(reopened.grant.wire_version.as_deref(), Some(v1));

    // Equal-offer re-open: admitted, echo emitted.
    let confirmed = registry
        .open_prepared(
            anonymous_attempt("wire_bound", Some(&bound.grant.connection_token))
                .with_wire_version(Some(v1.to_owned())),
        )
        .expect("equal-offer re-open is admitted");
    assert_eq!(confirmed.grant.wire_version.as_deref(), Some(v1));

    // Changed offer under previousToken: MISMATCH, grant undisturbed.
    // (The handler refuses *unknown* candidates before the registry runs;
    // the registry equality arm is what a hypothetical second supported
    // token would reach, so it is exercised directly here.)
    let changed = registry
        .open_prepared(
            anonymous_attempt("wire_bound", Some(&bound.grant.connection_token))
                .with_wire_version(Some("snapback.v2".to_owned())),
        )
        .expect_err("a changed offer must not rebind the lineage");
    assert_eq!(changed.diagnostic.code, "SNAPBACK_WIRE_VERSION_MISMATCH");
    assert!(
        registry
            .verify(
                &bound.grant.connection_id,
                Some(&bound.grant.connection_token)
            )
            .is_ok(),
        "a refused re-open must leave the existing grant undisturbed"
    );

    // Legacy lineage: no echo at open, no echo on offerless re-open, and
    // a confirming v1 offer stays legacy (confirmation is not upgrade).
    let legacy = registry
        .open_prepared(anonymous_attempt("wire_legacy", None))
        .expect("open legacy lineage");
    assert_eq!(legacy.grant.wire_version, None);
    let legacy_reopen = registry
        .open_prepared(anonymous_attempt(
            "wire_legacy",
            Some(&legacy.grant.connection_token),
        ))
        .expect("offerless legacy re-open stays admitted (B4 exemption)");
    assert_eq!(legacy_reopen.grant.wire_version, None);
    let legacy_confirmed = registry
        .open_prepared(
            anonymous_attempt("wire_legacy", Some(&legacy.grant.connection_token))
                .with_wire_version(Some(v1.to_owned())),
        )
        .expect("a confirming v1 offer on a legacy lineage is admitted");
    assert_eq!(
        legacy_confirmed.grant.wire_version, None,
        "confirmation is not upgrade: the legacy lineage never echoes"
    );

    // A known-but-different offer against the implicit v1 binding is a
    // mismatch (the legacy row of the re-open matrix).
    let legacy_changed = registry
        .open_prepared(
            anonymous_attempt("wire_legacy", Some(&legacy.grant.connection_token))
                .with_wire_version(Some("snapback.v2".to_owned())),
        )
        .expect_err("legacy lineages are implicitly v1 for the equality rules");
    assert_eq!(
        legacy_changed.diagnostic.code,
        "SNAPBACK_WIRE_VERSION_MISMATCH"
    );
}

#[test]
fn ephemeral_expiry_binding_echo_and_reopen_immutability() {
    let state =
        test_detached_app_state(LocalSnapback::memory().expect("in-memory expiry registry state"));
    let registry = state.connections.clone();
    fn attempt<'a>(suggested: &str, previous: Option<&'a str>) -> ConnectionOpenAttempt<'a> {
        let (incarnation, publication) =
            FencedPublication::anonymous_for_unmanaged_dev_connection();
        ConnectionOpenAttempt::new(
            Some(suggested.to_owned()),
            previous,
            true,
            PreparedConnectionOpenAuthority {
                resolved: ResolvedAppAuthority::Anonymous,
                session_route_authority: None,
                service_route_authority: None,
                managed_authority: false,
                hosted_sender: None,
                bound: BoundGrantAuthority::Anonymous {
                    authorization_stream_incarnation: incarnation,
                    publication,
                },
            },
            super::now_millis(),
            Instant::now(),
            None,
        )
    }
    let v1 = crate::ephemeral::EPHEMERAL_EXPIRY_PROTOCOL_V1;
    let bound = registry
        .open_prepared(attempt("expiry_bound", None).with_ephemeral_expiry_protocol(Some(v1)))
        .expect("bind expiry protocol");
    assert_eq!(bound.grant.ephemeral_expiry_protocol, Some(v1));
    let reopened = registry
        .open_prepared(attempt("expiry_bound", Some(&bound.grant.connection_token)))
        .expect("offerless reopen retains expiry binding");
    assert_eq!(reopened.grant.ephemeral_expiry_protocol, Some(v1));
    let changed = registry
        .open_prepared(
            attempt("expiry_bound", Some(&bound.grant.connection_token))
                .with_ephemeral_expiry_protocol(Some(v1 + 1)),
        )
        .expect_err("changed expiry protocol must refuse");
    assert_eq!(
        changed.diagnostic.code,
        "SNAPBACK_EPHEMERAL_EXPIRY_PROTOCOL_MISMATCH"
    );
    let legacy = registry
        .open_prepared(attempt("expiry_legacy", None))
        .expect("legacy expiry lineage");
    let upgrade = registry
        .open_prepared(
            attempt("expiry_legacy", Some(&legacy.grant.connection_token))
                .with_ephemeral_expiry_protocol(Some(v1)),
        )
        .expect_err("legacy expiry lineage cannot upgrade in place");
    assert_eq!(
        upgrade.diagnostic.code,
        "SNAPBACK_EPHEMERAL_EXPIRY_PROTOCOL_MISMATCH"
    );
}

#[test]
fn hosted_ephemeral_four_way_enforcement_is_lineage_owned() {
    let state = test_detached_app_state(
        LocalSnapback::memory().expect("in-memory authority-instance registry state"),
    );
    let registry = state.connections.clone();
    fn attempt<'a>(suggested: &str, previous: Option<&'a str>) -> ConnectionOpenAttempt<'a> {
        let (incarnation, publication) =
            FencedPublication::anonymous_for_unmanaged_dev_connection();
        ConnectionOpenAttempt::new(
            Some(suggested.to_owned()),
            previous,
            true,
            PreparedConnectionOpenAuthority {
                resolved: ResolvedAppAuthority::Anonymous,
                session_route_authority: None,
                service_route_authority: None,
                managed_authority: false,
                hosted_sender: None,
                bound: BoundGrantAuthority::Anonymous {
                    authorization_stream_incarnation: incarnation,
                    publication,
                },
            },
            super::now_millis(),
            Instant::now(),
            None,
        )
    }
    let protocol = crate::ephemeral::EPHEMERAL_AUTHORITY_PROTOCOL_V1;
    let instance = format!("eai1.{}", "a".repeat(43));

    // Old client × local server: the compatibility lineage has no hosted
    // requirement and `(None, None)` remains legal.
    let legacy_local = registry
        .open_prepared(attempt("authority_legacy_local", None))
        .expect("offerless local open");
    assert!(!legacy_local.grant.hosted_ephemeral_authority_required);
    let legacy_local_act = registry
        .prepare_act(
            &legacy_local.grant.connection_id,
            Some(&legacy_local.grant.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare local legacy act");
    assert!(
        legacy_local_act
            .verify_ephemeral_authority_instance(None)
            .is_ok()
    );

    // New client × local server: protocol 1 binds an instance without
    // manufacturing the hosted-required fact.
    let bound = registry
        .open_prepared(
            attempt("authority_bound", None)
                .with_ephemeral_authority_protocol(Some(protocol))
                .with_ephemeral_authority_instance(Some(instance.clone())),
        )
        .expect("bind authority instance");
    assert!(!bound.grant.hosted_ephemeral_authority_required);
    assert_eq!(
        bound.grant.ephemeral_authority_instance.as_deref(),
        Some(instance.as_str())
    );
    let prepared = registry
        .prepare_act(
            &bound.grant.connection_id,
            Some(&bound.grant.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare bound act");
    assert!(
        prepared
            .verify_ephemeral_authority_instance(Some(&instance))
            .is_ok()
    );
    assert_eq!(
        prepared
            .verify_ephemeral_authority_instance(None)
            .expect_err("missing instance refuses")
            .0
            .diagnostic
            .code,
        "SNAPBACK_EPHEMERAL_AUTHORITY_INSTANCE_REQUIRED"
    );
    assert_eq!(
        prepared
            .verify_ephemeral_authority_instance(Some("eai1.stale"))
            .expect_err("stale instance refuses")
            .0
            .diagnostic
            .code,
        "SNAPBACK_EPHEMERAL_AUTHORITY_INSTANCE_CHANGED"
    );

    let reopened = registry
        .open_prepared(attempt(
            "authority_bound",
            Some(&bound.grant.connection_token),
        ))
        .expect("offerless reopen retains authority instance");
    assert_eq!(
        reopened.grant.ephemeral_authority_instance.as_deref(),
        Some(instance.as_str())
    );
    let changed = registry
        .open_prepared(
            attempt("authority_bound", Some(&bound.grant.connection_token))
                .with_ephemeral_authority_protocol(Some(protocol))
                .with_ephemeral_authority_instance(Some(format!("eai1.{}", "b".repeat(43)))),
        )
        .expect_err("authority instance cannot change within a lineage");
    assert_eq!(
        changed.diagnostic.code,
        "SNAPBACK_EPHEMERAL_AUTHORITY_INSTANCE_CHANGED"
    );

    // Old client × hosted-required server: the registry itself refuses
    // offerless open; capability discovery is not the enforcement gate.
    let hosted_offerless = registry
        .open_prepared(
            attempt("authority_hosted_offerless", None)
                .with_ephemeral_authority_instance(Some(instance.clone()))
                .with_hosted_ephemeral_authority_required(true),
        )
        .expect_err("hosted-required open cannot omit protocol 1");
    assert_eq!(
        hosted_offerless.diagnostic.code,
        "SNAPBACK_EPHEMERAL_AUTHORITY_UNSUPPORTED"
    );

    // New client × hosted-required server: exact offer/instance succeeds,
    // the fact is projected, and both request and reopen enforcement are
    // independent of discovery.
    let hosted = registry
        .open_prepared(
            attempt("authority_hosted", None)
                .with_ephemeral_authority_protocol(Some(protocol))
                .with_ephemeral_authority_instance(Some(instance.clone()))
                .with_hosted_ephemeral_authority_required(true),
        )
        .expect("hosted-required open with exact protocol and instance");
    assert!(hosted.grant.hosted_ephemeral_authority_required);
    let hosted_act = registry
        .prepare_act(
            &hosted.grant.connection_id,
            Some(&hosted.grant.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare hosted act");
    assert!(
        hosted_act
            .verify_ephemeral_authority_instance(Some(&instance))
            .is_ok()
    );
    let missing = hosted_act
        .verify_ephemeral_authority_instance(None)
        .expect_err("hosted request must present the instance");
    assert_eq!(
        missing.0.diagnostic.code,
        "SNAPBACK_EPHEMERAL_AUTHORITY_INSTANCE_REQUIRED"
    );
    assert_eq!(
        super::status_for_diagnostic_code(&missing.0.diagnostic.code),
        StatusCode::BAD_REQUEST
    );
    let stale = hosted_act
        .verify_ephemeral_authority_instance(Some(&format!("eai1.{}", "b".repeat(43))))
        .expect_err("hosted request cannot present a different instance");
    assert_eq!(
        stale.0.diagnostic.code,
        "SNAPBACK_EPHEMERAL_AUTHORITY_INSTANCE_CHANGED"
    );
    assert_eq!(
        super::status_for_diagnostic_code(&stale.0.diagnostic.code),
        StatusCode::CONFLICT
    );
    let hosted_offerless_reopen = registry
        .open_prepared(attempt(
            "authority_hosted",
            Some(&hosted.grant.connection_token),
        ))
        .expect_err("hosted-required reopen cannot omit the offer");
    assert_eq!(
        hosted_offerless_reopen.diagnostic.code,
        "SNAPBACK_EPHEMERAL_AUTHORITY_UNSUPPORTED"
    );
    let hosted_reopen = registry
        .open_prepared(
            attempt("authority_hosted", Some(&hosted.grant.connection_token))
                .with_ephemeral_authority_protocol(Some(protocol))
                .with_ephemeral_authority_instance(Some(instance.clone()))
                .with_hosted_ephemeral_authority_required(true),
        )
        .expect("hosted-required exact reopen");
    assert!(hosted_reopen.grant.hosted_ephemeral_authority_required);

    let mut http_headers = HeaderMap::new();
    http_headers.insert(
        super::EPHEMERAL_AUTHORITY_INSTANCE_HEADER,
        HeaderValue::from_str(&instance).expect("authority HTTP header"),
    );
    assert_eq!(
        super::presented_ephemeral_authority_instance(&http_headers).as_deref(),
        Some(instance.as_str())
    );
    let mut socket_headers = HeaderMap::new();
    socket_headers.insert(
        header::SEC_WEBSOCKET_PROTOCOL,
        HeaderValue::from_str(&format!(
            "snapback.v1, snapback.ephemeral-authority-instance.{instance}"
        ))
        .expect("authority socket subprotocol"),
    );
    let socket_instance = super::presented_ephemeral_authority_instance(&socket_headers);
    assert_eq!(socket_instance.as_deref(), Some(instance.as_str()));
    assert!(
        hosted_act
            .verify_ephemeral_authority_instance(socket_instance.as_deref())
            .is_ok(),
        "the WebSocket upgrade carrier enforces the same lineage instance"
    );

    let stamped = super::stamp_ephemeral_socket_response(
        super::socket_ack(None, "publish", json!({ "accepted": true })).into(),
        Some(123),
        Some(&instance),
    );
    let stamped: Value = serde_json::from_str(&stamped.text).expect("stamped ack JSON");
    assert_eq!(stamped["serverObservedAtMs"], 123);
    assert_eq!(stamped["ephemeralAuthorityInstance"], instance);
}

#[tokio::test]
async fn ephemeral_publish_http_timing_separates_accept_from_dispatch() {
    let response = super::ephemeral_http_json_with_dispatch_timing(
        json!({ "entry_version": 7 }),
        Some(100),
        Some(104),
        None,
    );
    let body = to_bytes(response.into_body(), 4 * 1024)
        .await
        .expect("ephemeral publish timing response body");
    let body: Value = serde_json::from_slice(&body).expect("ephemeral publish timing JSON");
    assert_eq!(body["serverObservedAtMs"], 100);
    assert_eq!(body["serverDispatchedAtMs"], 104);
    assert_eq!(body["entry_version"], 7);

    let ordinary = super::ephemeral_http_json(json!({ "removed": false }), Some(200), None);
    let ordinary = to_bytes(ordinary.into_body(), 4 * 1024)
        .await
        .expect("ordinary ephemeral response body");
    let ordinary: Value =
        serde_json::from_slice(&ordinary).expect("ordinary ephemeral response JSON");
    assert_eq!(ordinary["serverObservedAtMs"], 200);
    assert!(ordinary.get("serverDispatchedAtMs").is_none());
}

#[tokio::test]
async fn hosted_ephemeral_post_verification_errors_repeat_the_instance() {
    let state =
        test_detached_app_state(LocalSnapback::memory().expect("post-verification error state"));
    let instance = format!("eai1.{}", "c".repeat(43));
    let (incarnation, publication) = FencedPublication::anonymous_for_unmanaged_dev_connection();
    let opened = state
        .connections
        .open_prepared(
            ConnectionOpenAttempt::new(
                Some("hosted_error_stamp".to_owned()),
                None,
                true,
                PreparedConnectionOpenAuthority {
                    resolved: ResolvedAppAuthority::Anonymous,
                    session_route_authority: None,
                    service_route_authority: None,
                    managed_authority: false,
                    hosted_sender: None,
                    bound: BoundGrantAuthority::Anonymous {
                        authorization_stream_incarnation: incarnation,
                        publication,
                    },
                },
                super::now_millis(),
                Instant::now(),
                None,
            )
            .with_ephemeral_authority_protocol(Some(
                crate::ephemeral::EPHEMERAL_AUTHORITY_PROTOCOL_V1,
            ))
            .with_ephemeral_authority_instance(Some(instance.clone()))
            .with_hosted_ephemeral_authority_required(true),
        )
        .expect("open hosted-required error-test lineage");
    let connection_act = state
        .connections
        .prepare_act(
            &opened.grant.connection_id,
            Some(&opened.grant.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare hosted-required error-test act");
    let admission = state
        .auth_admission_controller()
        .admit_for_mode(AuthMode::Dev)
        .expect("admit dev ephemeral request");
    let authority = InvocationGate::prepare_admitted_subjectless_authority(
        InvocationSource::EphemeralPublish,
        AuthMode::Dev,
        state.server.profile,
        admission.clone(),
        &WireAuthorityFields::default(),
        ResolvedAppAuthority::Anonymous,
        None,
    )
    .expect("prepare anonymous dev authority");
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    let error = super::publish_ephemeral(
        State(state),
        headers,
        Extension(authority),
        Extension(connection_act),
        Extension(admission),
        Ok(Bytes::from_static(b"{malformed")),
    )
    .await
    .expect_err("malformed body refuses after instance verification");
    let response = error.into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response_json(response).await;
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_REQUEST_JSON_INVALID");
    assert_eq!(body["ephemeralAuthorityInstance"], instance);
}

#[test]
fn hosted_ephemeral_requirement_needs_current_single_instance_admission() {
    let now_ms = super::now_millis();
    let mut authority = hosted_serving_authority(now_ms);
    assert_eq!(
        authority
            .hosted_target_authority_instance_at(now_ms, "auth-incarnation", "boot-nonce")
            .expect("base hosted authority is current"),
        None,
        "hosted auth alone must not publish the sticky-memory requirement"
    );
    authority.install_hosted_target_admission(Some(crate::deploy::HostedAdmissionV2 {
        schema_version: crate::deploy::HostedAdmissionV2Version::V2,
        target_id: "target-hosted-ephemeral".to_owned(),
        deployment_id: "deployment-hosted-test".to_owned(),
        binding_generation: 3,
        target_binding_sha256: format!("sha256:{}", "a".repeat(64)),
        control_head_sha256: format!("sha256:{}", "b".repeat(64)),
        supervisor_incarnation: "supervisor-hosted-ephemeral".to_owned(),
        exact_roster_sha256: format!("sha256:{}", "c".repeat(64)),
        routed_machine_id: "machine-hosted-ephemeral".to_owned(),
        hosted_auth_expires_at_ms: now_ms + 60_000,
        routed_machine_expires_at_ms: now_ms + 60_000,
        replay_floor: 0,
        admission_generation: 7,
        issued_at_ms: now_ms.saturating_sub(1),
        signature: "authenticated-by-test-control-plane".to_owned(),
    }));
    let current = authority
        .hosted_target_authority_instance_at(now_ms, "auth-incarnation", "boot-nonce")
        .expect("single-instance target admission is current");
    assert!(
        current
            .as_deref()
            .is_some_and(|instance| instance.starts_with("eai1.")),
        "only current target evidence supplies the required lineage instance"
    );
}

/// LLP 0094 §0B.3 / §0C.5: the HTTP half of the open offer matrix — the
/// classification (known/unknown/absent) runs in the handler with
/// precedence over the registry equality check, and both open-time offer
/// fields follow one matrix (unknown refuses, absent degrades).
#[tokio::test]
async fn connection_open_http_wire_version_offer_matrix() {
    let state = test_detached_app_state(
        LocalSnapback::memory().expect("in-memory wire-version HTTP state"),
    );
    let router = app(state);
    let open = |body: Value| {
        Request::builder()
            .method("POST")
            .uri("/connection/open")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_vec(&body).expect("serialize open body"),
            ))
            .expect("wire-version open request")
    };

    // Known offer: binds and echoes.
    let bound = router
        .clone()
        .oneshot(open(json!({
            "connectionId": "wire_http",
            "wireVersion": "snapback.v1",
            "ephemeralExpiryProtocol": 1,
        })))
        .await
        .expect("known-offer open");
    assert_eq!(bound.status(), StatusCode::OK);
    let bound = response_json(bound).await;
    assert_eq!(bound["wireVersion"], "snapback.v1");
    assert_eq!(bound["ephemeralExpiryProtocol"], 1);
    let previous_token = bound["connectionToken"]
        .as_str()
        .expect("bound grant token")
        .to_owned();

    // The snake_case alias is the DTO convention.
    let aliased = router
        .clone()
        .oneshot(open(json!({
            "connectionId": "wire_http_alias",
            "wire_version": "snapback.v1",
        })))
        .await
        .expect("aliased-offer open");
    assert_eq!(aliased.status(), StatusCode::OK);
    assert_eq!(response_json(aliased).await["wireVersion"], "snapback.v1");

    // Unknown offer: refused, never silently degraded.
    let unknown = router
        .clone()
        .oneshot(open(json!({ "wireVersion": "snapback.v2" })))
        .await
        .expect("unknown-offer open");
    assert_eq!(unknown.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(unknown).await["diagnostic"]["code"],
        "SNAPBACK_WIRE_VERSION_UNSUPPORTED"
    );

    // LLP 0107: the additive expiry clock offer is exact. Version 1
    // echoes; unknown values refuse rather than negotiating down.
    let unknown_expiry = router
        .clone()
        .oneshot(open(json!({
            "wireVersion": "snapback.v1",
            "ephemeralExpiryProtocol": 2,
        })))
        .await
        .expect("unknown expiry offer");
    assert_eq!(unknown_expiry.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(unknown_expiry).await["diagnostic"]["code"],
        "SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED"
    );

    // Classification precedes equality: an unknown candidate on a
    // previousToken re-open refuses UNSUPPORTED, never MISMATCH.
    let unknown_reopen = router
        .clone()
        .oneshot(open(json!({
            "connectionId": "wire_http",
            "previousToken": previous_token,
            "wireVersion": "snapback.v1.0",
        })))
        .await
        .expect("unknown-candidate re-open");
    assert_eq!(unknown_reopen.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(unknown_reopen).await["diagnostic"]["code"],
        "SNAPBACK_WIRE_VERSION_UNSUPPORTED"
    );

    // Absent: a legacy open with no echo member.
    let legacy = router
        .clone()
        .oneshot(open(json!({ "connectionId": "wire_http_legacy" })))
        .await
        .expect("absent-offer open");
    assert_eq!(legacy.status(), StatusCode::OK);
    let legacy = response_json(legacy).await;
    assert!(
        legacy.get("wireVersion").is_none(),
        "legacy grants must not echo: {legacy}"
    );
    assert!(
        legacy.get("ephemeralExpiryProtocol").is_none(),
        "legacy grants must omit the expiry protocol: {legacy}"
    );

    // The Rust Option<String> authority and generated input schema admit
    // null as the absent class; the hosted arm mirrors this exactly.
    let nullable_legacy = router
        .clone()
        .oneshot(open(json!({
            "connectionId": "wire_http_null",
            "wireVersion": null,
        })))
        .await
        .expect("nullable-absent open");
    assert_eq!(nullable_legacy.status(), StatusCode::OK);
    assert!(
        response_json(nullable_legacy)
            .await
            .get("wireVersion")
            .is_none(),
        "a null offer opens a legacy lineage without an echo"
    );

    // §0C.5 alignment: an unknown authInvalidationProtocol refuses.
    let invalidation = router
        .clone()
        .oneshot(open(json!({ "authInvalidationProtocol": 2 })))
        .await
        .expect("unknown invalidation-protocol open");
    assert_eq!(invalidation.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(invalidation).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED"
    );
}

/// LLP 0094 §0B.4: the kit-stream upgrade refuses per the classification
/// matrix pre-upgrade — unknown candidates refuse UNSUPPORTED, absent
/// offers refuse REQUIRED (B3), and the bound version present wins over
/// duplicates and extra candidates.
#[tokio::test]
async fn stream_upgrade_enforces_the_wire_version_offer_matrix() {
    let state = test_detached_app_state(
        LocalSnapback::memory().expect("in-memory wire-version socket state"),
    );
    let registry = state.connections.clone();
    let grant = registry
        .open(Some("wire_socket".to_owned()), None, true)
        .expect("wire-version socket grant");
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind wire-version socket server");
    let address = listener.local_addr().expect("wire-version socket address");
    let server = tokio::spawn(async move {
        super::app(state)
            .bind(listener)
            .expect("bind wire-version socket app")
            .serve()
            .await
            .expect("serve wire-version socket app");
    });

    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    let request = |protocols: Option<&str>| {
        let mut request = format!("ws://{address}/live/{}/stream", grant.connection_id)
            .into_client_request()
            .expect("wire-version websocket request");
        request.headers_mut().insert(
            "x-snapback-connection-token",
            grant
                .connection_token
                .parse()
                .expect("connection token header"),
        );
        if let Some(protocols) = protocols {
            request.headers_mut().insert(
                header::SEC_WEBSOCKET_PROTOCOL,
                protocols.parse().expect("subprotocol offer"),
            );
        }
        request
    };
    let refusal = |error: tokio_tungstenite::tungstenite::Error| {
        let tokio_tungstenite::tungstenite::Error::Http(response) = error else {
            panic!("expected a pre-upgrade HTTP refusal, got {error:?}");
        };
        let status = response.status().as_u16();
        let code = response
            .body()
            .as_ref()
            .and_then(|body| serde_json::from_slice::<Value>(body).ok())
            .and_then(|body| body["diagnostic"]["code"].as_str().map(str::to_owned))
            .unwrap_or_default();
        (status, code)
    };

    // Absent offer set (B3): refused REQUIRED.
    let absent = tokio_tungstenite::connect_async(request(None))
        .await
        .expect_err("offerless upgrades are refused from B3");
    assert_eq!(
        refusal(absent),
        (400, "SNAPBACK_WIRE_VERSION_REQUIRED".to_owned())
    );

    // A bearer carrier alone is not a version offer (§0B.4 step 1).
    let bearer_only = tokio_tungstenite::connect_async(request(Some(
        "snapback.connection-token.sct_rides_alone",
    )))
    .await
    .expect_err("the bearer carrier is excluded before classification");
    assert_eq!(
        refusal(bearer_only),
        (400, "SNAPBACK_WIRE_VERSION_REQUIRED".to_owned())
    );

    // Unknown candidates refuse UNSUPPORTED (classification precedes
    // equality — never MISMATCH).
    let unknown = tokio_tungstenite::connect_async(request(Some("snapback.v2, snapback.v1.0")))
        .await
        .expect_err("unknown candidates are refused");
    assert_eq!(
        refusal(unknown),
        (400, "SNAPBACK_WIRE_VERSION_UNSUPPORTED".to_owned())
    );

    // The bound version present wins, whatever rides along; duplicates
    // are harmless; the server selects and echoes the bound version.
    let (socket, response) = tokio_tungstenite::connect_async(request(Some(
        "snapback.v2, snapback.v1, snapback.v1, snapback.auth-client.1",
    )))
    .await
    .expect("bound-version-present offer set is admitted");
    assert_eq!(
        response.headers().get(header::SEC_WEBSOCKET_PROTOCOL),
        Some(&HeaderValue::from_static(super::LIVE_STREAM_SUBPROTOCOL)),
    );
    drop(socket);
    server.abort();
}

#[tokio::test]
async fn pressure_evicted_socket_cannot_receive_notifier_delivery() {
    let state =
        test_detached_app_state(LocalSnapback::memory().expect("in-memory socket test state"));
    let registry = state.connections.clone();
    let ephemeral = state.ephemeral.clone();
    let grant = registry
        .open(Some("retired_socket".to_owned()), None, true)
        .expect("socket grant");

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test server");
    let address = listener.local_addr().expect("test server address");
    let server = tokio::spawn(async move {
        super::app(state)
            .bind(listener)
            .expect("bind socket test app")
            .serve()
            .await
            .expect("serve socket test");
    });

    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    let mut request = format!("ws://{address}/live/{}/stream", grant.connection_id)
        .into_client_request()
        .expect("websocket request");
    request.headers_mut().insert(
        header::SEC_WEBSOCKET_PROTOCOL,
        super::LIVE_STREAM_SUBPROTOCOL
            .parse()
            .expect("wire-version subprotocol offer"),
    );
    request.headers_mut().insert(
        "x-snapback-connection-token",
        grant
            .connection_token
            .parse()
            .expect("connection token header"),
    );
    let (mut socket, _) = tokio_tungstenite::connect_async(request)
        .await
        .expect("connect authorized socket");

    let notifier = ephemeral.delivery_notifier();
    tokio::time::timeout(Duration::from_secs(2), async {
        while !notifier.is_registered(&grant.connection_id) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("live stream registered its notifier");

    for index in 0..(MAX_CONNECTION_GRANTS - 1) {
        registry
            .open(Some(format!("pressure_{index}")), None, true)
            .expect("fill bounded registry");
    }
    {
        let mut grants = registry.lock();
        let ids = grants.grants.keys().cloned().collect::<Vec<_>>();
        grants.unused.clear();
        grants.used.clear();
        for id in ids {
            let last_use_ms = u64::from(id != grant.connection_id);
            let record = grants.grants.get_mut(&id).expect("grant record");
            record.used = true;
            record.last_use_ms = last_use_ms;
            grants.used.insert((last_use_ms, id));
        }
    }
    registry
        .open(Some("after_retirement".to_owned()), None, true)
        .expect("expired socket grant makes bounded room");
    assert!(
        registry
            .verify(&grant.connection_id, Some(&grant.connection_token))
            .is_err(),
        "the connected socket grant was the pressure victim"
    );

    ephemeral.enqueue_durable_for_test(
        &grant.connection_id,
        br#"{"kind":"private-after-retirement"}"#.to_vec(),
    );
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            match socket.next().await {
                Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                    panic!("retired socket received queued data: {text}");
                }
                Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_)))
                | Some(Err(_))
                | None => break,
                Some(Ok(_)) => {}
            }
        }
    })
    .await
    .expect("retired socket must terminate instead of draining");
    server.abort();
}

/// Accepted-socket transport regression: every connection the bound
/// server accepts must carry TCP_NODELAY. With Nagle left enabled, a
/// small live frame written while an earlier small frame (here the
/// `live_ping` pong) is still unACKed waits in the kernel for the peer's
/// delayed-ACK timer — ~40ms on Linux even over loopback. That stall is
/// exactly the linux-x64 qualified-package-staging failure: the packaged
/// comparator's presence witness was published and written to the wire
/// ~2ms after publish, but arrived ~38ms later, after the post-drain
/// assertion had already run (macOS delayed-ACK behavior let identical
/// bytes pass). Each sample re-arms the unACKed-write condition with a
/// ping/pong, then measures enqueue→arrival for a pushed frame; the
/// median must stay far below the delayed-ACK floor. On the defective
/// listener the median sits at the ~40ms delayed-ACK floor on Linux; a
/// scheduling hiccup can slow one sample, never the median.
#[tokio::test]
async fn accepted_live_socket_delivers_small_frames_without_nagle_delay() {
    let state =
        test_detached_app_state(LocalSnapback::memory().expect("in-memory nodelay socket state"));
    let registry = state.connections.clone();
    let ephemeral = state.ephemeral.clone();
    let grant = registry
        .open(Some("nodelay_socket".to_owned()), None, true)
        .expect("socket grant");

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind nodelay test server");
    let address = listener.local_addr().expect("nodelay test server address");
    let server = tokio::spawn(async move {
        super::app(state)
            .bind(listener)
            .expect("bind nodelay socket test app")
            .serve()
            .await
            .expect("serve nodelay socket test");
    });

    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    let mut request = format!("ws://{address}/live/{}/stream", grant.connection_id)
        .into_client_request()
        .expect("websocket request");
    request.headers_mut().insert(
        header::SEC_WEBSOCKET_PROTOCOL,
        super::LIVE_STREAM_SUBPROTOCOL
            .parse()
            .expect("wire-version subprotocol offer"),
    );
    request.headers_mut().insert(
        "x-snapback-connection-token",
        grant
            .connection_token
            .parse()
            .expect("connection token header"),
    );
    let (mut socket, _) = tokio_tungstenite::connect_async(request)
        .await
        .expect("connect authorized socket");
    // Quiet the client side so only the server's socket posture is
    // measured: with the client's own Nagle disabled, each ping segment
    // leaves immediately and the sole delay candidate is the server's
    // pushed frame stalling behind its unACKed pong.
    if let tokio_tungstenite::MaybeTlsStream::Plain(stream) = socket.get_mut() {
        stream.set_nodelay(true).expect("client TCP_NODELAY");
    }
    let notifier = ephemeral.delivery_notifier();
    tokio::time::timeout(Duration::from_secs(2), async {
        while !notifier.is_registered(&grant.connection_id) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("live stream registered its notifier");

    let mut samples = Vec::new();
    for index in 0..8_u32 {
        // Arm the Nagle condition: elicit one small server write (the
        // pong) that the client will not ACK until its delayed-ACK timer
        // fires, because the trigger below arrives in-process rather
        // than over this socket.
        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                json!({ "type": "ping", "requestId": format!("nagle_{index}") })
                    .to_string()
                    .into(),
            ))
            .await
            .expect("send live_ping");
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let frame = socket
                    .next()
                    .await
                    .expect("pong frame present")
                    .expect("pong frame readable");
                if let tokio_tungstenite::tungstenite::Message::Text(text) = frame
                    && text.contains(&format!("nagle_{index}"))
                {
                    break;
                }
            }
        })
        .await
        .expect("live_ping answered");

        let started = Instant::now();
        ephemeral.enqueue_durable_for_test(
            &grant.connection_id,
            format!(r#"{{"kind":"nagle-probe-{index}"}}"#).into_bytes(),
        );
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let frame = socket
                    .next()
                    .await
                    .expect("probe frame present")
                    .expect("probe frame readable");
                if let tokio_tungstenite::tungstenite::Message::Text(text) = frame
                    && text.contains(&format!("nagle-probe-{index}"))
                {
                    break;
                }
            }
        })
        .await
        .expect("pushed probe frame delivered");
        samples.push(started.elapsed());
    }
    samples.sort();
    let median = samples[samples.len() / 2];
    assert!(
        median < Duration::from_millis(25),
        "small pushed frames stalled behind Nagle/delayed-ACK; \
             accepted sockets must set TCP_NODELAY (samples: {samples:?})"
    );
    server.abort();
}

#[tokio::test]
async fn terminal_socket_sends_closed_auth_error_then_4401() {
    let directory = tempfile::tempdir().expect("terminal socket telemetry directory");
    let database_path = directory.path().join("terminal-socket.sqlite3");
    let state = test_detached_app_state(
        LocalSnapback::open(&database_path).expect("file-backed terminal socket state"),
    );
    let telemetry = state.telemetry.clone();
    let registry = state.connections.clone();
    let ephemeral = state.ephemeral.clone();
    let lifecycle = state.auth_terminal_lifecycle.clone();
    let grant = registry
        .open(Some("terminal_socket".to_owned()), None, true)
        .expect("socket grant");
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test server");
    let address = listener.local_addr().expect("test server address");
    let server = tokio::spawn(async move {
        super::app(state)
            .bind(listener)
            .expect("bind socket test app")
            .serve()
            .await
            .expect("serve socket test");
    });

    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    let mut request = format!("ws://{address}/live/{}/stream", grant.connection_id)
        .into_client_request()
        .expect("websocket request");
    request.headers_mut().insert(
        header::SEC_WEBSOCKET_PROTOCOL,
        super::LIVE_STREAM_SUBPROTOCOL
            .parse()
            .expect("wire-version subprotocol offer"),
    );
    request.headers_mut().insert(
        "x-snapback-connection-token",
        grant
            .connection_token
            .parse()
            .expect("connection token header"),
    );
    let (mut socket, _) = tokio_tungstenite::connect_async(request)
        .await
        .expect("connect authorized socket");
    let notifier = ephemeral.delivery_notifier();
    tokio::time::timeout(Duration::from_secs(2), async {
        while !notifier.is_registered(&grant.connection_id) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("live stream registered its notifier");

    lifecycle.committed_stream_reset(
        crate::live_wire::LiveAuthErrorReason::Reset,
        Instant::now() + Duration::from_secs(5),
    );
    let terminal = tokio::time::timeout(Duration::from_secs(2), socket.next())
        .await
        .expect("terminal frame deadline")
        .expect("terminal frame present")
        .expect("terminal frame readable");
    let tokio_tungstenite::tungstenite::Message::Text(terminal) = terminal else {
        panic!("expected typed terminal text frame");
    };
    let terminal: Value = serde_json::from_str(&terminal).expect("typed terminal JSON");
    assert_eq!(
        terminal,
        json!({
            "kind": "auth_error",
            "code": "SNAPBACK_AUTH_STREAM_RESET",
            "reason": "reset",
            "authorityDisposition": "durableDelete",
        })
    );
    let close = tokio::time::timeout(Duration::from_secs(2), socket.next())
        .await
        .expect("terminal close deadline")
        .expect("terminal close present")
        .expect("terminal close readable");
    let tokio_tungstenite::tungstenite::Message::Close(Some(close)) = close else {
        panic!("expected terminal close frame");
    };
    assert_eq!(u16::from(close.code), super::TERMINAL_AUTH_CLOSE_CODE);
    assert_eq!(close.reason, "auth_error");
    tokio::time::timeout(Duration::from_secs(2), async {
        while notifier.is_registered(&grant.connection_id) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("typed socket teardown completes");
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            telemetry.force_flush().expect("flush typed socket path");
            if telemetry.event_count_for_test(
                "ws_connect",
                "/live/{connection_id}/stream",
                "terminal",
            ) == 1
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("typed socket observation completes");
    let terminals = physical_telemetry_events_for_test(&telemetry, Some("ws_connect"), None)
        .into_iter()
        .filter(|event| event.phase == "terminal")
        .collect::<Vec<_>>();
    assert_eq!(terminals.len(), 1);
    let terminal = &terminals[0];
    assert_eq!(terminal.status, Some(500));
    assert_eq!(terminal.code.as_deref(), Some("SNAPBACK_AUTH_STREAM_RESET"));
    assert_eq!(terminal.details.as_ref().unwrap()["cause"], "reset");
    server.abort();
}

#[tokio::test]
async fn aborted_live_stream_task_records_reserved_cancellation() {
    let directory = tempfile::tempdir().expect("aborted socket telemetry directory");
    let database_path = directory.path().join("aborted-socket.sqlite3");
    let state = test_detached_app_state(
        LocalSnapback::open(&database_path).expect("file-backed aborted socket state"),
    );
    let telemetry = state.telemetry.clone();
    let ephemeral = state.ephemeral.clone();
    let grant = state
        .connections
        .open(Some("aborted_socket".to_owned()), None, true)
        .expect("aborted socket grant");
    let abort_receiver = super::install_test_live_stream_abort(grant.connection_id.clone());
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind aborted socket server");
    let address = listener.local_addr().expect("aborted socket address");
    let server = tokio::spawn(async move {
        super::app(state)
            .bind(listener)
            .expect("bind aborted socket app")
            .serve()
            .await
            .expect("serve aborted socket app");
    });

    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    let mut request = format!("ws://{address}/live/{}/stream", grant.connection_id)
        .into_client_request()
        .expect("aborted websocket request");
    request.headers_mut().insert(
        header::SEC_WEBSOCKET_PROTOCOL,
        super::LIVE_STREAM_SUBPROTOCOL
            .parse()
            .expect("wire-version subprotocol offer"),
    );
    request.headers_mut().insert(
        "x-snapback-connection-token",
        grant
            .connection_token
            .parse()
            .expect("connection token header"),
    );
    let (socket, _) = tokio_tungstenite::connect_async(request)
        .await
        .expect("connect abortable socket");
    let notifier = ephemeral.delivery_notifier();
    tokio::time::timeout(Duration::from_secs(2), async {
        while !notifier.is_registered(&grant.connection_id) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("abortable live stream registers");
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            telemetry
                .force_flush()
                .expect("flush socket admission before abort");
            if telemetry.event_count_for_test(
                "ws_connect",
                "/live/{connection_id}/stream",
                "admission",
            ) == 1
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("live-stream admission follows managed-client registration");
    assert_eq!(
        telemetry.event_count_for_test("ws_connect", "/live/{connection_id}/stream", "admission"),
        1
    );
    let abort = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Ok(abort) = abort_receiver.try_recv() {
                break abort;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("capture real live-stream abort handle");
    abort.abort();
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            tokio::task::yield_now().await;
            telemetry
                .force_flush()
                .expect("flush aborted socket terminal");
            if telemetry.event_count_for_test(
                "ws_connect",
                "/live/{connection_id}/stream",
                "terminal",
            ) == 1
            {
                break;
            }
        }
    })
    .await
    .expect("aborted live-stream span falls back");
    assert_eq!(
        telemetry.event_outcomes_for_test("ws_connect", "/live/{connection_id}/stream", "terminal"),
        vec![(Some(499), None)]
    );
    assert_eq!(
        telemetry.event_details_for_test("ws_connect", "/live/{connection_id}/stream")[1]
            .as_ref()
            .and_then(|details| details.get("cause")),
        Some(&json!("cancelled"))
    );
    drop(socket);
    server.abort();
}

/// Administrative and idle teardown retire the exact capability before
/// asynchronous physical cleanup. Mint-only containment prevents a new
/// bearer from adopting the retired readable id during that interval.
#[test]
fn admin_and_idle_retirement_immediately_invalidate_old_bearers() {
    let admin_registry = ConnectionRegistry::default();
    let admin = admin_registry
        .open(Some("admin-retired".to_owned()), None, true)
        .expect("open admin retirement target");
    let admin_capture = admin_registry
        .retire_connection_for_cleanup(&admin.connection_id)
        .expect("retire exact admin target");
    assert_eq!(admin_capture.connection_id, admin.connection_id);
    let admin_error = admin_registry
        .prepare_act(
            &admin.connection_id,
            Some(&admin.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect_err("admin-retired bearer is unusable before cleanup");
    assert_eq!(
        admin_error.0.diagnostic.code,
        "SNAPBACK_CONNECTION_TOKEN_INVALID"
    );
    admin_registry.clear_after_committed_reset();
    let after_admin = admin_registry
        .open(Some(admin.connection_id.clone()), None, true)
        .expect("mint after admin retirement and an empty reset");
    assert_ne!(after_admin.connection_id, admin.connection_id);
    assert!(after_admin.connection_id.starts_with("conn_"));

    let idle_registry = ConnectionRegistry::default();
    let (incarnation, publication) = FencedPublication::anonymous_for_unmanaged_dev_connection();
    let open_at = |connection_id: &str, now_ms: u64| {
        idle_registry
            .open_prepared(ConnectionOpenAttempt::new(
                Some(connection_id.to_owned()),
                None,
                true,
                synthetic_connection_authority(BoundGrantAuthority::Anonymous {
                    authorization_stream_incarnation: incarnation.clone(),
                    publication: publication.clone(),
                }),
                now_ms,
                Instant::now(),
                None,
            ))
            .expect("open deterministic idle grant")
    };
    let idle = open_at("idle-retired", 10);
    let active = open_at("idle-active", 11);
    let captures = idle_registry.retire_idle_for_cleanup(10);
    assert_eq!(captures.len(), 1);
    assert_eq!(captures[0].connection_id, idle.grant.connection_id);
    let idle_error = idle_registry
        .prepare_act(
            &idle.grant.connection_id,
            Some(&idle.grant.connection_token),
            None,
            false,
            12,
            Instant::now(),
        )
        .expect_err("idle-retired bearer is unusable before cleanup");
    assert_eq!(
        idle_error.0.diagnostic.code,
        "SNAPBACK_CONNECTION_TOKEN_INVALID"
    );
    idle_registry
        .prepare_act(
            &active.grant.connection_id,
            Some(&active.grant.connection_token),
            None,
            false,
            12,
            Instant::now(),
        )
        .expect("newer grant survives exact idle cutoff");
    let after_idle = idle_registry
        .open(Some(idle.grant.connection_id.clone()), None, true)
        .expect("mint after idle retirement");
    assert_ne!(after_idle.connection_id, idle.grant.connection_id);
    assert!(after_idle.connection_id.starts_with("conn_"));
    idle_registry.lock().assert_grant_indexes_consistent();
}
