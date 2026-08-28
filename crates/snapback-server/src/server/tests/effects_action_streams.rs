// Complete test items included at `server::tests` module scope.

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn watchdog_abandonment_cancels_held_room_reservation_without_publication() {
    const ROOM: &str = "room-watchdog-reservation";
    const MEMBER: &str = "member-watchdog-reservation";
    let (state, _directory) = tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        protected_room_server_fixture()
    })
    .await
    .expect("construct watchdog protected-room fixture");
    let seed = SeedData {
        tables: BTreeMap::from([(
            "roomMembers".to_owned(),
            vec![Map::from_iter([
                ("_id".to_owned(), json!(MEMBER)),
                ("roomId".to_owned(), json!(ROOM)),
                ("userId".to_owned(), json!("watchdog-user")),
            ])],
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
    .expect("reserve watchdog fixture seed")
    .expect("seed watchdog fixture membership");
    let before = with_snapback(&state.snapback, |snapback| {
        Ok::<_, SnapbackError>((
            snapback.authorization_reservation_snapshot()?,
            snapback.receipts_snapshot(None),
        ))
    })
    .await
    .expect("capture pre-watchdog durable/receipt state");

    let action = with_snapback(&state.snapback, |snapback| {
        snapback.stage_cron_action_invocation("heldRoomAction")
    })
    .await
    .expect("stage watchdog action");
    let StagedAction::Detached(action) = action else {
        panic!("watchdog fixture action must detach");
    };
    let scope = Scope::from_pairs([("roomId", ROOM)]);
    let held_permit = state
        .ephemeral
        .begin_server_authorized_room_act("protectedPresence", &scope)
        .expect("admit held watchdog room act")
        .expect("protected watchdog room returns a permit");
    // Drive the same production watchdog transition only after causally
    // observing the exact dependency. The former 300ms end-to-end timer
    // raced cold Hermes startup on Linux and could expire before the host
    // call began, which tested startup scheduling rather than reservation
    // cancellation. Timer enforcement and VM teardown are covered by the
    // action-watchdog integration suite; this proof isolates the room cut.
    let mut host = held_action_host(state.snapback.clone(), &action);
    host.deadline = Instant::now() + Duration::from_secs(30);
    let abandoned = host.abandoned.clone();
    let commit_gate = host.commit_gate.clone();
    let active_reservation = host.active_reservation.clone();
    let counters = isolated_worker_counters();
    let baseline_workers = counters.active.load(Ordering::SeqCst);
    let worker_permit =
        reserve_detached_action_worker_with_counters(Arc::new(Semaphore::new(1)), 1, counters)
            .expect("admit watchdog room-reservation worker");
    let (result_sender, mut result_receiver) = tokio::sync::oneshot::channel();
    spawn_detached_action_worker(
        worker_permit,
        counters,
        move || {
            host.run_mutation(
                "kickRoomMember",
                HandlerInput {
                    args: json!({ "id": MEMBER }),
                    ..HandlerInput::default()
                },
            )
        },
        move |result| {
            let _ = result_sender.send(result);
        },
    )
    .expect("spawn watchdog room-reservation worker");

    let dependency_installed = async {
        loop {
            match state
                .ephemeral
                .begin_server_authorized_room_act("protectedPresence", &scope)
            {
                Err(error) if error.code == EphemeralErrorCode::AuthorityPending => break,
                Ok(permit) => drop(permit),
                Err(error) => panic!("unexpected watchdog room admission: {error:?}"),
            }
            tokio::task::yield_now().await;
        }
    };
    tokio::select! {
        result = &mut result_receiver => {
            panic!("watchdog worker ended before installing its exact room dependency: {result:?}");
        }
        installed = tokio::time::timeout(Duration::from_secs(10), dependency_installed) => {
            installed.expect("watchdog worker installs its exact room dependency");
        }
    }
    assert!(state.snapback.try_lock().is_ok());

    tokio::task::spawn_blocking(move || {
        let writer_cancellation = ManagedWriterCancellation::default();
        let terminal_latch = ActionTerminalLatch::default();
        linearize_detached_action_abandonment(
            commit_gate.as_ref(),
            abandoned.as_ref(),
            active_reservation.as_ref(),
            &writer_cancellation,
            &terminal_latch,
        );
    })
    .await
    .expect("watchdog abandonment transition completes");
    let error = tokio::time::timeout(Duration::from_secs(2), result_receiver)
        .await
        .expect("watchdog cancels the room wait within its bound")
        .expect("watchdog room-reservation worker reports")
        .expect_err("held-room action must time out");
    assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
    assert_eq!(
        counters.active.load(Ordering::SeqCst),
        baseline_workers,
        "watchdog response waits for the detached worker to return"
    );

    let fresh_permit = state
        .ephemeral
        .begin_server_authorized_room_act("protectedPresence", &scope)
        .expect("cancelled exact ticket no longer leaves authority pending")
        .expect("room accepts a fresh act after watchdog cancellation");
    drop(fresh_permit);
    drop(held_permit);
    let after = with_snapback(&state.snapback, |snapback| {
        Ok::<_, SnapbackError>((
            snapback.authorization_reservation_snapshot()?,
            snapback.receipts_snapshot(None),
        ))
    })
    .await
    .expect("capture post-watchdog durable/receipt state");
    assert_eq!(after.0, before.0, "timed-out reservation must not commit");
    assert_eq!(
        after.1, before.1,
        "timed-out reservation emits neither a receipt nor live publication"
    );
}

/// A successful exact-token release must settle the process publication from
/// the same transaction that durably revokes the carrier.
///
/// @ref LLP 0303#the-fix-inherits-the-defect-and-the-test-that-guards-it-usually-doesnt-try
///   — the boundary test observes both the consumed gate and its durable row.
#[tokio::test]
async fn token_release_consumes_terminal_gate_and_commits_durable_revocation() {
    let fixture = finite_authority_matrix_fixture().await;
    let opened = fixture
        .router
        .clone()
        .oneshot(connection_open_request(
            Some(&fixture.token),
            json!({
                "connectionId": "token-release-terminal-transaction",
                "authInvalidationProtocol": 1,
            }),
        ))
        .await
        .expect("open released-token service connection");
    assert_eq!(opened.status(), StatusCode::OK);
    let opened = response_json(opened).await;
    let connection_id = opened["connectionId"]
        .as_str()
        .expect("released-token connection id");
    let service_publication = {
        let registry = fixture.state.connections.lock();
        let record = registry
            .grants
            .get(connection_id)
            .expect("released-token connection grant");
        let BoundGrantAuthority::ServicePrincipal {
            service_publication,
            ..
        } = &record.authority
        else {
            panic!("scoped token must retain a service publication")
        };
        service_publication.clone()
    };

    let release_at_ms = fixture.start_ms + 1;
    fixture.clock.set(release_at_ms);
    let released_token = fixture.token.clone();
    let mut release = auth_http_request(
        "POST",
        "/auth/agents/token/release",
        serde_json::to_vec(&json!({ "token": released_token })).unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut release);
    let released = fixture
        .router
        .clone()
        .oneshot(release)
        .await
        .expect("token release response");
    assert_eq!(released.status(), StatusCode::NO_CONTENT);

    assert_eq!(
        service_publication
            .resolve_act(fixture.clock.epoch_ms(), fixture.clock.monotonic_now())
            .expect("resolve released-token publication"),
        ServiceAuthorityActResolution::Terminal(ServiceAuthorityDisposition::Carrier),
        "204 requires the exact carrier gate to have committed"
    );
    let durable_error = with_snapback(&fixture.state.snapback, move |snapback| {
        let token = ScopedToken::parse(&released_token).expect("parse released scoped token");
        snapback
            .remainder_auth_fixture()
            .resolve_scoped_token(&token, release_at_ms)
    })
    .await
    .expect_err("204 requires durable token revocation");
    assert_eq!(
        durable_error.diagnostic.code,
        "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID"
    );
    assert_eq!(
        durable_error.diagnostic.details["authorityDisposition"],
        "carrier"
    );
}

/// T1: the real HTTP action route must bind every detached child mutation to
/// the finite caller that launched the action. The pause is after a non-empty
/// child preview and before its durable commit. Terminalize the real caller,
/// snapshot every durable surface, then prove neither child runtime can move
/// any surface after the terminal cut.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn t1_detached_nested_mutation_terminal_wins_real_http_route() {
    const CALLERS: [DetachedNestedMutationCaller; 2] = [
        DetachedNestedMutationCaller::Session,
        DetachedNestedMutationCaller::ScopedService,
    ];
    const CHILDREN: [DetachedNestedMutationRuntime; 2] = [
        DetachedNestedMutationRuntime::HostPlan,
        DetachedNestedMutationRuntime::Ibex,
    ];

    for caller in CALLERS {
        for child in CHILDREN {
            let fixture = finite_authority_matrix_fixture_with_functions(
                detached_nested_mutation_fence_functions(child),
            )
            .await;
            let (request, session_bearer) = match caller {
                DetachedNestedMutationCaller::Session => {
                    let credential = mint_test_credential(
                        &fixture.state,
                        &format!("detached-fence-{}@example.test", child.label()),
                    )
                    .await;
                    let bearer = credential["token"]
                        .as_str()
                        .expect("detached fence session bearer")
                        .to_owned();
                    (
                        session_auth_http_request(
                            "/action/writeAction",
                            br#"{"args":{}}"#.to_vec(),
                            &bearer,
                        ),
                        Some(bearer),
                    )
                }
                DetachedNestedMutationCaller::ScopedService => {
                    let FiniteAuthorityMatrixRequest { request, .. } =
                        finite_authority_matrix_request(
                            &fixture,
                            FiniteAuthorityMatrixRoute::Action,
                        )
                        .await;
                    (request, None)
                }
            };
            let pause = install_detached_nested_mutation_test_pause(&fixture.state.snapback);
            let action_router = fixture.router.clone();
            let action = tokio::spawn(async move {
                action_router
                    .oneshot(request)
                    .await
                    .expect("detached fence action response")
            });
            tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
                .await
                .unwrap_or_else(|_| panic!("{caller:?} x {child:?} did not stage its child"));
            assert_eq!(
                pause.reached_count(),
                1,
                "{caller:?} x {child:?} reaches the exact child barrier once"
            );
            assert!(
                pause.staged_effect_count() > 0,
                "{caller:?} x {child:?} must stage a non-empty durable effect"
            );
            assert_eq!(
                pause.child_runtime(),
                Some(child.label()),
                "{caller:?} x {child:?} must exercise the requested production runtime"
            );

            match (caller, session_bearer.as_deref()) {
                (DetachedNestedMutationCaller::Session, Some(bearer)) => {
                    let logout = fixture
                        .router
                        .clone()
                        .oneshot(session_auth_http_request(
                            "/auth/logout",
                            br#"{}"#.to_vec(),
                            bearer,
                        ))
                        .await
                        .expect("detached fence logout response");
                    assert_eq!(
                        logout.status(),
                        StatusCode::NO_CONTENT,
                        "the real session terminal commits before child release"
                    );
                }
                (DetachedNestedMutationCaller::ScopedService, None) => {
                    commit_finite_authority_matrix_ending(
                        &fixture,
                        FiniteAuthorityMatrixEnding::GrantRevoke,
                    )
                    .await;
                }
                _ => unreachable!("caller and bearer fixture agree"),
            }
            let terminal = detached_nested_mutation_durable_evidence(&fixture.state).await;
            pause.release();
            let response = tokio::time::timeout(Duration::from_secs(5), action)
                .await
                .unwrap_or_else(|_| panic!("{caller:?} x {child:?} action did not settle"))
                .expect("detached fence action task");
            let after = detached_nested_mutation_durable_evidence(&fixture.state).await;

            assert_eq!(
                after, terminal,
                "{caller:?} x {child:?} committed a durable child effect after caller terminalization"
            );
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            let response = response_json(response).await;
            let expected = match caller {
                DetachedNestedMutationCaller::Session => "SNAPBACK_AUTH_SESSION_EXPIRED",
                DetachedNestedMutationCaller::ScopedService => "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
            };
            assert_eq!(response["diagnostic"]["code"], expected);
        }
    }
}

/// T2: an ordinary app-table insert has `NoAuthorizationEvent`, but a managed
/// HostPlan action must still release Local and reserve its exact caller before
/// the durable child turn.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn t2_managed_host_plan_neutral_child_forces_caller_bound_split() {
    let fixture = finite_authority_matrix_fixture().await;
    let credential = mint_test_credential(&fixture.state, "managed-neutral@example.test").await;
    let bearer = credential["token"]
        .as_str()
        .expect("managed neutral session bearer")
        .to_owned();
    let pause = super::install_managed_nested_mutation_test_pause(&fixture.state.snapback);
    let router = fixture.router.clone();
    let action_bearer = bearer.clone();
    let action = tokio::spawn(async move {
        router
            .oneshot(session_auth_http_request(
                "/action/writeAction",
                br#"{"args":{}}"#.to_vec(),
                &action_bearer,
            ))
            .await
            .expect("managed neutral action response")
    });
    tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
        .await
        .expect("managed neutral child reaches the forced split");
    assert!(
        pause.no_authorization_event(),
        "the fixture must stay on the neutral preflight path"
    );
    assert!(
        fixture.state.snapback.try_lock().is_ok(),
        "managed staging must release Local before caller reservation"
    );

    let logout = fixture
        .router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &bearer,
        ))
        .await
        .expect("managed neutral logout response");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    let terminal = detached_nested_mutation_durable_evidence(&fixture.state).await;
    pause.release();
    let response = tokio::time::timeout(Duration::from_secs(5), action)
        .await
        .expect("managed neutral action settles")
        .expect("managed neutral action joins");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let response = response_json(response).await;
    assert_eq!(
        response["diagnostic"]["code"],
        "SNAPBACK_AUTH_SESSION_EXPIRED"
    );
    assert_eq!(
        detached_nested_mutation_durable_evidence(&fixture.state).await,
        terminal,
        "the neutral ordinary insert must not commit after logout"
    );
}

/// T3: once the exact child reservation exists, terminalization must drain
/// behind that reservation while new work refuses. Releasing the uniquely
/// identified child lets its commit win before the terminal transaction.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn t3_exact_child_reservation_wins_then_terminal_drains() {
    for caller in [
        DetachedNestedMutationCaller::Session,
        DetachedNestedMutationCaller::ScopedService,
    ] {
        for child in [
            DetachedNestedMutationRuntime::HostPlan,
            DetachedNestedMutationRuntime::Ibex,
        ] {
            let fixture = finite_authority_matrix_fixture_with_functions(
                detached_nested_mutation_fence_functions(child),
            )
            .await;
            let (request, bearer) = match caller {
                DetachedNestedMutationCaller::Session => {
                    let credential = mint_test_credential(
                        &fixture.state,
                        &format!("reservation-wins-{}@example.test", child.label()),
                    )
                    .await;
                    let bearer = credential["token"]
                        .as_str()
                        .expect("reservation-wins session bearer")
                        .to_owned();
                    (
                        session_auth_http_request(
                            "/action/writeAction",
                            br#"{"args":{}}"#.to_vec(),
                            &bearer,
                        ),
                        bearer,
                    )
                }
                DetachedNestedMutationCaller::ScopedService => {
                    let FiniteAuthorityMatrixRequest { request, .. } =
                        finite_authority_matrix_request(
                            &fixture,
                            FiniteAuthorityMatrixRoute::Action,
                        )
                        .await;
                    (request, fixture.token.clone())
                }
            };
            let pause =
                super::install_nested_effect_reservation_test_pause(&fixture.state.snapback);
            let service_terminal_plan = match caller {
                DetachedNestedMutationCaller::Session => None,
                DetachedNestedMutationCaller::ScopedService => {
                    let token = crate::auth::crypto::ScopedToken::parse(&fixture.token)
                        .expect("parse reservation-wins scoped token");
                    Some(
                        with_snapback(&fixture.state.snapback, move |snapback| {
                            snapback.plan_scoped_token_release(&token)
                        })
                        .await
                        .expect("prepare reservation-wins service terminal plan"),
                    )
                }
            };
            let action_router = fixture.router.clone();
            let action = tokio::spawn(async move {
                action_router
                    .oneshot(request)
                    .await
                    .expect("reservation-wins action response")
            });
            tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
                .await
                .unwrap_or_else(|_| panic!("{caller:?} x {child:?} did not reserve its child"));
            assert_ne!(
                pause.reservation_identity(),
                0,
                "the pause identifies the exact caller reservation"
            );
            assert_eq!(pause.child_runtime(), Some(child.label()));
            assert_eq!(
                pause.has_service_permit(),
                matches!(caller, DetachedNestedMutationCaller::ScopedService),
                "the exact child reservation retains the caller's finite-service permit"
            );
            pause.require_exact_commit_guard();

            let terminal_state = fixture.state.clone();
            let terminal_router = fixture.router.clone();
            let terminal_bearer = bearer.clone();
            let terminal = match caller {
                DetachedNestedMutationCaller::Session => tokio::spawn(async move {
                    let response = terminal_router
                        .oneshot(session_auth_http_request(
                            "/auth/logout",
                            br#"{}"#.to_vec(),
                            &terminal_bearer,
                        ))
                        .await
                        .expect("reservation-wins logout response");
                    assert_eq!(response.status(), StatusCode::NO_CONTENT);
                }),
                DetachedNestedMutationCaller::ScopedService => {
                    let token = crate::auth::crypto::ScopedToken::parse(&fixture.token)
                        .expect("parse reservation-wins scoped token");
                    let token_id = fixture.token_id.clone();
                    let now_ms = fixture.start_ms + 1;
                    fixture.clock.set(now_ms);
                    let service_terminal_plan = service_terminal_plan
                        .expect("scoped-service caller has an exact terminal plan");
                    tokio::spawn(async move {
                        let service_terminal_gate = service_terminal_plan
                            .acquire_gate()
                            .await
                            .expect("reservation-wins exact service terminal gate");
                        let revoked = with_snapback(&terminal_state.snapback, move |snapback| {
                            with_service_authority_terminal_gate(service_terminal_gate, || {
                                snapback.release_scoped_token(&token, now_ms)
                            })
                        })
                        .await
                        .expect("reservation-wins grant revocation");
                        assert_eq!(revoked.token_id, token_id);
                    })
                }
            };

            // Give the real terminal writer enough turns to install its
            // pending intent; it must remain in drain behind this child.
            for _ in 0..20 {
                tokio::task::yield_now().await;
            }
            assert!(
                !terminal.is_finished(),
                "{caller:?} x {child:?} terminalization must drain behind the child permit"
            );
            let fresh = match caller {
                DetachedNestedMutationCaller::Session => session_auth_http_request(
                    "/action/writeAction",
                    br#"{"args":{}}"#.to_vec(),
                    &bearer,
                ),
                DetachedNestedMutationCaller::ScopedService => Request::builder()
                    .method("POST")
                    .uri("/action/writeAction")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
                    .header("x-snapback-auth-client-protocol", "1")
                    .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                    .body(Body::from(r#"{"args":{}}"#))
                    .expect("reservation-wins fresh service request"),
            };
            let fresh = tokio::time::timeout(
                Duration::from_secs(2),
                fixture.router.clone().oneshot(fresh),
            )
            .await
            .expect("new reservation refuses without waiting for drain")
            .expect("fresh reservation response");
            assert_ne!(
                fresh.status(),
                StatusCode::OK,
                "the pending terminal intent closes every fresh reservation"
            );

            pause.release();
            let response = tokio::time::timeout(Duration::from_secs(5), action)
                .await
                .expect("reserved child action settles")
                .expect("reserved child action joins");
            let response_status = response.status();
            let response = response_json(response).await;
            assert_eq!(
                response_status,
                StatusCode::UNAUTHORIZED,
                "final result publication observes the terminal caller even though the already-reserved child won its commit: {response:#}"
            );
            tokio::time::timeout(Duration::from_secs(5), terminal)
                .await
                .expect("terminal drain completes after child commit")
                .expect("terminal task joins");
            assert_eq!(
                finite_authority_matrix_item_count(&fixture.state).await,
                2,
                "{caller:?} x {child:?} reserved child commits before terminal completion: {response:#}"
            );
        }
    }
}

/// T4: observe the production action-gate callback, authorized pre-guard, and
/// the kernel's actual app-storage pre-COMMIT cut for both child runtimes.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn t4_action_then_mode_guards_are_retained_at_both_storage_cuts() {
    for child in [
        DetachedNestedMutationRuntime::HostPlan,
        DetachedNestedMutationRuntime::Ibex,
    ] {
        let fixture = finite_authority_matrix_fixture_with_functions(
            detached_nested_mutation_fence_functions(child),
        )
        .await;
        let credential = mint_test_credential(
            &fixture.state,
            &format!("commit-order-{}@example.test", child.label()),
        )
        .await;
        let bearer = credential["token"]
            .as_str()
            .expect("commit-order session bearer")
            .to_owned();
        let probe = super::install_nested_commit_order_test_probe(&fixture.state.snapback, true);
        let router = fixture.router.clone();
        let action_bearer = bearer.clone();
        let action = tokio::spawn(async move {
            router
                .oneshot(session_auth_http_request(
                    "/action/writeAction",
                    br#"{"args":{}}"#.to_vec(),
                    &action_bearer,
                ))
                .await
                .expect("commit-order action response")
        });
        tokio::time::timeout(Duration::from_secs(5), probe.wait_for_storage())
            .await
            .unwrap_or_else(|_| panic!("{child:?} never reached actual storage pre-COMMIT"));
        assert_eq!(probe.counts(), (1, 1, 1), "{child:?} production callbacks");
        assert_eq!(probe.orders(), (1, 2, 3), "{child:?} guard order");

        let logout_router = fixture.router.clone();
        let logout_bearer = bearer.clone();
        let logout = tokio::spawn(async move {
            logout_router
                .oneshot(session_auth_http_request(
                    "/auth/logout",
                    br#"{}"#.to_vec(),
                    &logout_bearer,
                ))
                .await
                .expect("commit-order logout response")
        });
        for _ in 0..20 {
            tokio::task::yield_now().await;
        }
        assert!(
            !logout.is_finished(),
            "{child:?} logout must drain while storage retains both guards"
        );
        probe.release_storage();
        let response = tokio::time::timeout(Duration::from_secs(5), action)
            .await
            .expect("commit-order action settles")
            .expect("commit-order action joins");
        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "the final result fence observes the queued terminal caller after the already-reserved commit"
        );
        let logout = tokio::time::timeout(Duration::from_secs(5), logout)
            .await
            .expect("commit-order logout drains")
            .expect("commit-order logout joins");
        assert_eq!(logout.status(), StatusCode::NO_CONTENT);
        assert_eq!(probe.counts(), (1, 1, 1));
        assert_eq!(
            finite_authority_matrix_item_count(&fixture.state).await,
            2,
            "{child:?} child commits while both guards are retained"
        );
    }
}

/// A completed child no longer owns caller authority once its real after-Local
/// phase starts. This covers managed HostPlan and both detached child runtimes
/// and observes the exact reservation identity, not action completion. A live
/// subscriber proves a production notifier is already in the batch before the
/// synthetic pause joins it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn child_caller_permit_releases_before_after_local_work() {
    for (query_instance_id, runtime) in [
        NestedAfterLocalRuntime::ManagedHostPlan,
        NestedAfterLocalRuntime::DetachedHostPlan,
        NestedAfterLocalRuntime::DetachedIbex,
    ]
    .into_iter()
    .enumerate()
    {
        let functions = match runtime {
            NestedAfterLocalRuntime::ManagedHostPlan => finite_authority_matrix_functions(),
            NestedAfterLocalRuntime::DetachedHostPlan => {
                detached_nested_mutation_fence_functions(DetachedNestedMutationRuntime::HostPlan)
            }
            NestedAfterLocalRuntime::DetachedIbex => {
                detached_nested_mutation_fence_functions(DetachedNestedMutationRuntime::Ibex)
            }
        };
        let fixture = finite_authority_matrix_fixture_with_functions(functions).await;
        let credential = mint_test_credential(
            &fixture.state,
            &format!("after-local-{runtime:?}@example.test"),
        )
        .await;
        let bearer = credential["token"]
            .as_str()
            .expect("after-Local session bearer")
            .to_owned();
        let connection_id = format!("after-local-production-{runtime:?}");
        let production_waker = install_after_local_production_subscription(
            &fixture.state,
            &bearer,
            &connection_id,
            92_000 + query_instance_id as u64,
        )
        .await;
        let pause = super::install_nested_after_local_test_pause(&fixture.state.snapback);
        let action_router = fixture.router.clone();
        let action_bearer = bearer.clone();
        let action = tokio::spawn(async move {
            action_router
                .oneshot(session_auth_http_request(
                    "/action/writeAction",
                    br#"{"args":{}}"#.to_vec(),
                    &action_bearer,
                ))
                .await
                .expect("after-Local action response")
        });
        tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
            .await
            .unwrap_or_else(|_| panic!("{runtime:?} never reached its after-Local effect"));
        assert!(
            pause.production_notifier_reached(),
            "{runtime:?} production notifier did not inspect the child caller permit"
        );
        assert!(
            pause.production_notifier_caller_permit_released(),
            "{runtime:?} production notifier ran while retaining the child caller permit"
        );
        assert!(
            pause.caller_permit_released(),
            "{runtime:?} entered after-Local work while retaining the child caller permit"
        );
        assert!(
            pause.production_effects_before_hook() > 0,
            "{runtime:?} synthetic pause was the first after-Local effect"
        );
        assert!(
            futures_util::FutureExt::now_or_never(production_waker.notified()).is_some(),
            "{runtime:?} production subscriber notifier did not run before the synthetic pause"
        );
        assert!(
            !action.is_finished(),
            "{runtime:?} action remains held during real after-Local work"
        );

        pause.release();
        tokio::time::timeout(
            Duration::from_secs(5),
            pause.wait_until_after_batch_reached(),
        )
        .await
        .unwrap_or_else(|_| panic!("{runtime:?} did not complete its after-Local batch"));
        assert_eq!(
            finite_authority_matrix_item_count(&fixture.state).await,
            2,
            "{runtime:?} child commit survived the real after-Local batch"
        );
        let logout = tokio::time::timeout(
            Duration::from_secs(2),
            fixture.router.clone().oneshot(session_auth_http_request(
                "/auth/logout",
                br#"{}"#.to_vec(),
                &bearer,
            )),
        )
        .await
        .unwrap_or_else(|_| panic!("{runtime:?} completed child kept logout draining"))
        .expect("after-Local logout response");
        assert_eq!(logout.status(), StatusCode::NO_CONTENT);
        assert!(
            !action.is_finished(),
            "{runtime:?} post-batch hold remains independent of logout"
        );

        pause.release_after_batch();
        let response = tokio::time::timeout(Duration::from_secs(5), action)
            .await
            .unwrap_or_else(|_| panic!("{runtime:?} after-Local action did not settle"))
            .expect("after-Local action joins");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}

/// T5: authored code catches both host errors and returns success, but the
/// first typed terminal cause remains authoritative, both distinct durable
/// sentinels stay absent, and the worker result cannot become success.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn t5_caught_refusal_latches_once_blocks_durable_effects_and_overrides_success() {
    let fixture =
        finite_authority_matrix_fixture_with_functions(caught_nested_refusal_functions(false))
            .await;
    let credential = mint_test_credential(&fixture.state, "caught-refusal@example.test").await;
    let bearer = credential["token"]
        .as_str()
        .expect("caught-refusal session bearer")
        .to_owned();
    let pause = install_detached_nested_mutation_test_pause(&fixture.state.snapback);
    let observation = super::install_nested_latch_test_observation(&fixture.state.snapback);
    let router = fixture.router.clone();
    let action_bearer = bearer.clone();
    let action = tokio::spawn(async move {
        router
            .oneshot(session_auth_http_request(
                "/action/caughtRefusalAction",
                br#"{"args":{}}"#.to_vec(),
                &action_bearer,
            ))
            .await
            .expect("caught-refusal action response")
    });
    tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
        .await
        .expect("first non-empty mutation reaches pre-reservation pause");
    assert!(pause.staged_effect_count() > 0);
    let logout = fixture
        .router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &bearer,
        ))
        .await
        .expect("caught-refusal logout response");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    let terminal = detached_nested_mutation_durable_evidence(&fixture.state).await;
    pause.release();
    let response = tokio::time::timeout(Duration::from_secs(5), action)
        .await
        .expect("caught-refusal action settles")
        .expect("caught-refusal action joins");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let response = response_json(response).await;
    assert_eq!(
        response["diagnostic"]["code"],
        "SNAPBACK_AUTH_SESSION_EXPIRED"
    );
    assert_eq!(observation.latch_wins(), 1);
    assert_eq!(
        observation.worker_outcomes(),
        vec![Some("SNAPBACK_AUTH_SESSION_EXPIRED".to_owned())],
        "the production worker result, before the outer HTTP fence, is the latched caller cause"
    );
    let after = detached_nested_mutation_durable_evidence(&fixture.state).await;
    assert_eq!(after, terminal);
    assert!(
        after.rows.iter().all(|row| {
            !row.to_string().contains("first-caught-sentinel")
                && !row.to_string().contains("second-caught-sentinel")
        }),
        "both distinct durable sentinels remain absent"
    );
}

/// T6: a Hermes loop after the first caught refusal forces the real watchdog
/// linearizer and async interruption path, while the earlier caller cause
/// remains the final outcome.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn t6_authority_cause_survives_watchdog_and_worker_teardown() {
    let fixture =
        finite_authority_matrix_fixture_with_functions(caught_nested_refusal_functions(true)).await;
    let credential = mint_test_credential(&fixture.state, "caught-watchdog@example.test").await;
    let bearer = credential["token"]
        .as_str()
        .expect("caught-watchdog session bearer")
        .to_owned();
    let watchdog = super::install_detached_watchdog_test_config(&fixture.state.snapback, 1_500);
    assert_eq!(watchdog.worker_active_count(), 0);
    let pause = install_detached_nested_mutation_test_pause(&fixture.state.snapback);
    let observation = super::install_nested_latch_test_observation(&fixture.state.snapback);
    let router = fixture.router.clone();
    let action_bearer = bearer.clone();
    let action = tokio::spawn(async move {
        router
            .oneshot(session_auth_http_request(
                "/action/caughtRefusalAction",
                br#"{"args":{}}"#.to_vec(),
                &action_bearer,
            ))
            .await
            .expect("caught-watchdog action response")
    });
    tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
        .await
        .expect("caught-watchdog first mutation stages");
    let logout = fixture
        .router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &bearer,
        ))
        .await
        .expect("caught-watchdog logout response");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    let terminal = detached_nested_mutation_durable_evidence(&fixture.state).await;
    pause.release();
    let response = tokio::time::timeout(Duration::from_secs(6), action)
        .await
        .expect("watchdog interrupts the known-busy Hermes loop")
        .expect("caught-watchdog action joins");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let response = response_json(response).await;
    assert_eq!(
        response["diagnostic"]["code"], "SNAPBACK_AUTH_SESSION_EXPIRED",
        "the typed caller cause must win over ACTION_TIMEOUT"
    );
    assert_eq!(watchdog.linearizer_count(), 1);
    assert_eq!(watchdog.worker_completed_count(), 1);
    assert_eq!(
        watchdog.worker_active_count(),
        0,
        "the action worker counter returns to its exact baseline before response"
    );
    assert_eq!(observation.latch_wins(), 1);
    assert_eq!(
        observation.worker_outcomes(),
        vec![Some("SNAPBACK_AUTH_SESSION_EXPIRED".to_owned())],
        "the production worker result, before the outer HTTP fence, is the latched caller cause"
    );
    assert_eq!(
        detached_nested_mutation_durable_evidence(&fixture.state).await,
        terminal
    );
}

/// T9: the five-second writer budget starts only after the exact caller
/// reservation. A timed-out FIFO waiter drops that permit and its room binder,
/// allowing logout to drain; surviving writers keep FIFO order.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn t9_reserved_child_writer_timeout_drains_permit_and_preserves_fifo() {
    const ROOM: &str = "writer-timeout-room";
    const MEMBER: &str = "writer-timeout-member";
    let (state, _directory) = tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        protected_room_server_fixture()
    })
    .await
    .expect("construct writer-timeout protected-room fixture");
    let credential = mint_test_credential(&state, "writer-timeout@example.test").await;
    let bearer = credential["token"]
        .as_str()
        .expect("writer-timeout session bearer")
        .to_owned();
    let user_id = credential["session"]["userId"]
        .as_str()
        .expect("writer-timeout session user")
        .to_owned();
    let seed = SeedData {
        tables: BTreeMap::from([(
            "roomMembers".to_owned(),
            vec![Map::from_iter([
                ("_id".to_owned(), json!(MEMBER)),
                ("roomId".to_owned(), json!(ROOM)),
                ("userId".to_owned(), json!(user_id)),
            ])],
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
    .expect("reserve writer-timeout seed impact")
    .expect("seed writer-timeout room membership");
    let before = with_snapback(&state.snapback, |snapback| {
        Ok::<_, SnapbackError>((
            snapback.scan_table("roomMembers", 100, 0)?.rows,
            snapback.durable_version()?,
            snapback.change_journal_len()?,
            snapback.jobs_inspect(100)?,
        ))
    })
    .await
    .expect("capture writer-timeout durable evidence");

    let router = app(state.clone());
    let pause = super::install_nested_effect_reservation_test_pause(&state.snapback);
    let action_bearer = bearer.clone();
    let action_router = router.clone();
    let action = tokio::spawn(async move {
        action_router
            .oneshot(session_auth_http_request(
                "/action/heldRoomAction",
                serde_json::to_vec(&json!({
                    "args": { "target": "kickRoomMember", "id": MEMBER }
                }))
                .expect("serialize writer-timeout action"),
                &action_bearer,
            ))
            .await
            .expect("writer-timeout action response")
    });
    tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
        .await
        .expect("writer-timeout child reserves before queueing");
    let reservation_identity = pause.reservation_identity();
    assert_ne!(reservation_identity, 0);
    assert!(
        crate::auth::invocation::authorized_effect_reservation_active_for_test(
            reservation_identity
        ),
        "the exact authority-work permit is nonzero before queueing"
    );
    assert_eq!(
        pause.writer_budget_started(),
        0,
        "the writer budget must not be armed before the exact reservation proof seam releases"
    );

    // Keep the production after-reservation seam open longer than the full
    // writer budget. A mutant that arms the deadline before this seam will
    // expire as soon as it is released; the correct path has not started its
    // five-second Local-acquisition clock yet.
    tokio::time::sleep(Duration::from_millis(5_100)).await;
    assert!(
        !action.is_finished(),
        "writer budget armed before reservation proof"
    );

    let held_local = state.snapback.clone().lock_owned().await;
    pause.release();
    tokio::time::timeout(Duration::from_secs(1), async {
        while pause.writer_budget_started() == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("writer budget arms after exact reservation proof");
    assert_eq!(pause.writer_budget_started(), 1);
    assert!(
        pause.writer_budget_started_with_active_reservation(),
        "writer budget starts while the exact authority-work permit remains active"
    );
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        !action.is_finished(),
        "a fresh post-reservation writer budget cannot expire immediately"
    );

    tokio::time::timeout(Duration::from_secs(7), async {
        while crate::auth::invocation::authorized_effect_reservation_active_for_test(
            reservation_identity,
        ) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("writer timeout drops the exact authority-work permit");
    drop(held_local);
    let response = tokio::time::timeout(Duration::from_secs(5), action)
        .await
        .expect("timed-out action publishes after Local is released")
        .expect("writer-timeout action joins");
    let response = response_json(response).await;
    assert_eq!(response["diagnostic"]["code"], "SNAPBACK_ACTION_TIMEOUT");
    assert_eq!(response["diagnostic"]["details"]["effectCommitted"], false);

    let scope = Scope::from_pairs([("roomId", ROOM)]);
    let room = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            match state
                .ephemeral
                .begin_server_authorized_room_act("protectedPresence", &scope)
            {
                Ok(Some(permit)) => break permit,
                Ok(None) => panic!("protected writer-timeout room must return a permit"),
                Err(error) if error.code == EphemeralErrorCode::AuthorityPending => {
                    tokio::task::yield_now().await;
                }
                Err(error) => panic!("unexpected writer-timeout room state: {error:?}"),
            }
        }
    })
    .await
    .expect("room reservation cancellation removes the exact dependency ticket");
    drop(room);

    let held_local = state.snapback.clone().lock_owned().await;
    let logout_router = router.clone();
    let logout_bearer = bearer.clone();
    let logout = tokio::spawn(async move {
        logout_router
            .oneshot(session_auth_http_request(
                "/auth/logout",
                br#"{}"#.to_vec(),
                &logout_bearer,
            ))
            .await
            .expect("writer-timeout logout response")
    });
    let fifo = Arc::new(StdMutex::new(Vec::new()));
    let first_queued = super::writer_gate::install_managed_writer_queue_test_hook(&state.snapback);
    let first_state = state.snapback.clone();
    let first_fifo = fifo.clone();
    let first = tokio::spawn(async move {
        with_snapback(&first_state, move |_| {
            first_fifo
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push("first");
        })
        .await;
    });
    tokio::time::timeout(Duration::from_secs(2), first_queued.notified())
        .await
        .expect("first surviving writer enters the production FIFO queue");
    let second_queued = super::writer_gate::install_managed_writer_queue_test_hook(&state.snapback);
    let second_state = state.snapback.clone();
    let second_fifo = fifo.clone();
    let second = tokio::spawn(async move {
        with_snapback(&second_state, move |_| {
            second_fifo
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push("second");
        })
        .await;
    });
    tokio::time::timeout(Duration::from_secs(2), second_queued.notified())
        .await
        .expect("second surviving writer enters behind the first");
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    assert!(
        !logout.is_finished(),
        "Local still holds the terminal writer"
    );
    assert!(!first.is_finished() && !second.is_finished());
    drop(held_local);

    let logout = tokio::time::timeout(Duration::from_secs(5), logout)
        .await
        .expect("logout drain completes after Local and permit release")
        .expect("writer-timeout logout joins");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    tokio::time::timeout(Duration::from_secs(5), first)
        .await
        .expect("first surviving writer completes")
        .expect("first surviving writer joins");
    tokio::time::timeout(Duration::from_secs(5), second)
        .await
        .expect("second surviving writer completes")
        .expect("second surviving writer joins");
    assert_eq!(
        *fifo
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
        vec!["first", "second"]
    );
    let after = with_snapback(&state.snapback, |snapback| {
        Ok::<_, SnapbackError>((
            snapback.scan_table("roomMembers", 100, 0)?.rows,
            snapback.durable_version()?,
            snapback.change_journal_len()?,
            snapback.jobs_inspect(100)?,
        ))
    })
    .await
    .expect("capture post-timeout durable evidence");
    assert_eq!(
        after, before,
        "the timed-out child leaves every durable app surface unchanged"
    );
}

#[tokio::test]
async fn finite_service_authority_real_route_by_terminal_ending_pause_matrix() {
    const ROUTES: [FiniteAuthorityMatrixRoute; 6] = [
        FiniteAuthorityMatrixRoute::Query,
        FiniteAuthorityMatrixRoute::Mutation,
        FiniteAuthorityMatrixRoute::Action,
        FiniteAuthorityMatrixRoute::AuthSession,
        FiniteAuthorityMatrixRoute::ConnectionInsert,
        FiniteAuthorityMatrixRoute::ConnectionAct,
    ];
    const ENDINGS: [FiniteAuthorityMatrixEnding; 6] = [
        FiniteAuthorityMatrixEnding::GrantRevoke,
        FiniteAuthorityMatrixEnding::CredentialRotate,
        FiniteAuthorityMatrixEnding::CredentialRevoke,
        FiniteAuthorityMatrixEnding::PrincipalDeactivate,
        FiniteAuthorityMatrixEnding::TokenExpiry,
        FiniteAuthorityMatrixEnding::TokenCapEviction,
    ];

    for route in ROUTES {
        for ending in ENDINGS {
            let fixture = finite_authority_matrix_fixture().await;
            assert_eq!(
                finite_authority_matrix_item_count(&fixture.state).await,
                1,
                "{route:?} x {ending:?} begins with only the seed row"
            );
            let FiniteAuthorityMatrixRequest {
                mut request,
                pending_connection_id,
                queued_connection_id,
            } = finite_authority_matrix_request(&fixture, route).await;
            let pause = install_test_finite_authority_pause(route.pause_point());
            request.headers_mut().insert(
                HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
                HeaderValue::from_str(pause.id()).expect("matrix pause header"),
            );
            let router = fixture.router.clone();
            let request_task = tokio::spawn(async move {
                router
                    .oneshot(request)
                    .await
                    .expect("matrix route response")
            });
            tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
                .await
                .unwrap_or_else(|_| panic!("{route:?} x {ending:?} never reached its pause"));
            if matches!(
                route,
                FiniteAuthorityMatrixRoute::Query | FiniteAuthorityMatrixRoute::AuthSession
            ) {
                if pause.response_status() != Some(StatusCode::OK) {
                    pause.release().await;
                    let response = request_task.await.unwrap_or_else(|error| {
                        panic!("{route:?} x {ending:?} task failed before terminal: {error}")
                    });
                    let status = response.status();
                    let body = response_json(response).await;
                    panic!(
                        "{route:?} x {ending:?} did not compute a predecessor response: {status} {body}"
                    );
                }
                assert_eq!(
                    pause.response_status(),
                    Some(StatusCode::OK),
                    "{route:?} x {ending:?} must compute its predecessor response before terminal publication"
                );
            }

            commit_finite_authority_matrix_ending(&fixture, ending).await;
            pause.release().await;
            let response = request_task
                .await
                .unwrap_or_else(|error| panic!("{route:?} x {ending:?} task failed: {error}"));
            assert_eq!(
                response.status(),
                StatusCode::UNAUTHORIZED,
                "{route:?} x {ending:?} must not publish a predecessor response"
            );
            let response = response_json(response).await;
            assert_eq!(
                response["diagnostic"]["code"], "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
                "{route:?} x {ending:?} must fail with the scoped-token terminal diagnostic"
            );
            assert_eq!(
                response["diagnostic"]["details"]["authorityDisposition"],
                ending.expected_disposition(),
                "{route:?} x {ending:?} must preserve the exact terminal axis"
            );

            if matches!(
                route,
                FiniteAuthorityMatrixRoute::Mutation | FiniteAuthorityMatrixRoute::Action
            ) {
                assert_eq!(
                    finite_authority_matrix_item_count(&fixture.state).await,
                    1,
                    "{route:?} x {ending:?} must not commit its app-data effect"
                );
            }
            if let Some(connection_id) = pending_connection_id.as_deref() {
                assert!(
                    !fixture
                        .state
                        .connections
                        .lock()
                        .grants
                        .contains_key(connection_id),
                    "{route:?} x {ending:?} must not insert a stale connection grant"
                );
            }
            if queued_connection_id.is_some() {
                assert_eq!(
                    finite_authority_matrix_pending_durable(&fixture.state).await,
                    1,
                    "{route:?} x {ending:?} must leave the queued frame unleased and unconsumed"
                );
            }
        }
    }
}

/// Scoped-token resolution must belong to the stream which admitted the
/// lookup, even though the lookup and service-witness registration run
/// under Local/SQLite and stream publication cannot overlap that lock.
/// Exercise both reset cuts: reset after the predecessor stream capture
/// makes the durable lookup fail, while reset after a successful durable
/// lookup leaves only a stale predecessor publication/grant preparation.
///
/// @ref LLP 0059#reset-restore-and-stream-publication — a predecessor
///   token resolution can neither publish nor mint under reset's successor
///   authorization stream.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn scoped_token_handshake_and_connection_open_cannot_cross_stream_reset() {
    const ROUTES: [FiniteAuthorityMatrixRoute; 2] = [
        FiniteAuthorityMatrixRoute::AuthSession,
        FiniteAuthorityMatrixRoute::ConnectionInsert,
    ];
    const CUTS: [TestFiniteAuthorityPausePoint; 2] = [
        TestFiniteAuthorityPausePoint::AfterScopedTokenStreamCapture,
        TestFiniteAuthorityPausePoint::AfterScopedTokenDurableResolve,
    ];

    for route in ROUTES {
        for cut in CUTS {
            let fixture = finite_authority_matrix_fixture().await;
            let predecessor = fixture
                .state
                .auth_coordinator
                .as_ref()
                .expect("reset coordinator")
                .authorization_stream_incarnation()
                .expect("predecessor stream");
            let FiniteAuthorityMatrixRequest {
                mut request,
                pending_connection_id,
                queued_connection_id,
            } = finite_authority_matrix_request(&fixture, route).await;
            assert!(
                queued_connection_id.is_none(),
                "reset crossing matrix uses no predecessor outbox"
            );
            let pause = install_test_finite_authority_pause(cut);
            request.headers_mut().insert(
                HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
                HeaderValue::from_str(pause.id()).expect("reset crossing pause header"),
            );
            let router = fixture.router.clone();
            let request_task = tokio::spawn(async move {
                router
                    .oneshot(request)
                    .await
                    .expect("reset crossing route response")
            });
            tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
                .await
                .unwrap_or_else(|_| panic!("{route:?} x {cut:?} never reached its pause"));

            let reset_admission = test_route_admission(&fixture.state).0;
            tokio::time::timeout(
                Duration::from_secs(5),
                coordinated_app_reset(&fixture.state, &reset_admission, None),
            )
            .await
            .unwrap_or_else(|_| panic!("{route:?} x {cut:?} reset timed out"))
            .unwrap_or_else(|error| panic!("{route:?} x {cut:?} reset failed: {error:?}"));
            let successor = fixture
                .state
                .auth_coordinator
                .as_ref()
                .expect("reset coordinator")
                .authorization_stream_incarnation()
                .expect("successor stream");
            assert_ne!(
                successor, predecessor,
                "{route:?} x {cut:?} must commit a successor stream"
            );

            pause.release().await;
            let response = tokio::time::timeout(Duration::from_secs(5), request_task)
                .await
                .unwrap_or_else(|_| panic!("{route:?} x {cut:?} request timed out"))
                .unwrap_or_else(|error| panic!("{route:?} x {cut:?} task failed: {error}"));
            assert_eq!(
                response.status(),
                StatusCode::UNAUTHORIZED,
                "{route:?} x {cut:?} must not cross reset"
            );
            let body = response_json(response).await;
            assert_eq!(
                body["diagnostic"]["code"], "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
                "{route:?} x {cut:?} must fail as stale scoped authority: {body}"
            );
            if let Some(connection_id) = pending_connection_id.as_deref() {
                let grants = fixture.state.connections.lock();
                assert!(
                    grants.grants.is_empty(),
                    "{route:?} x {cut:?} must not insert any successor grant from predecessor resolution; proposed id was {connection_id}"
                );
            }
        }
    }
}

/// A terminal service handler must install its process-wide intent before
/// it enters LocalSnapback. Otherwise it can take Local while an already-
/// admitted staged finalizer retains the exact service permit and is
/// queued behind it, producing a permanent reverse-edge deadlock.
///
/// @ref LLP 0059#finite-service-authority-fence — process premark and
/// async permit drain precede the exact-token durable transaction.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn service_terminal_gate_does_not_hold_local_while_staged_work_drains() {
    let fixture = finite_authority_matrix_fixture().await;
    let opened = fixture
        .router
        .clone()
        .oneshot(connection_open_request(
            Some(&fixture.token),
            json!({
                "connectionId": "service-terminal-local-contention",
                "authInvalidationProtocol": 1,
            }),
        ))
        .await
        .expect("open service connection");
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
    let (epoch_now_ms, monotonic_now) = super::auth_runtime_now(&fixture.state);
    let mut connection_act = fixture
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
        .expect("prepare exact service connection act");
    assert!(connection_act.authorization_invalidation.is_some());
    let service_publication = connection_act
        .bound
        .service_publication()
        .expect("service connection retains its exact publication")
        .clone();
    let service_route_authority = connection_act
        .service_route_authority
        .clone()
        .expect("service connection retains its database-bound route authority");
    let admission = test_route_admission(&fixture.state).0;
    let authority_admission = admission.clone();
    let authority = with_snapback(&fixture.state.snapback, {
        let profile = fixture.state.server.profile;
        move |snapback| {
            snapback.prepare_connection_service_authority(
                service_route_authority,
                InvocationSource::LiveInitialQuery,
                AuthMode::Sessions,
                profile,
                authority_admission,
                &WireAuthorityFields::default(),
                epoch_now_ms,
            )
        }
    })
    .await
    .expect("prepare staged database-bound service authority")
    .with_fenced_publication(connection_act.bound.publication().clone());
    connection_act.route_authority = Some(authority);
    let effect_fence = connection_act.effect_fence();
    let staging_act = connection_act.clone();
    let staged = with_snapback(&fixture.state.snapback, {
        let connection_id = connection_id.clone();
        move |snapback| {
            staging_act.prepare_live_subscribe(
                snapback,
                "liveItems".to_owned(),
                LiveSubscribeInput {
                    connection_id,
                    input: HandlerInput::default(),
                    authorization_namespace: Some(QueryNamespace {
                        client_store_id: "service_terminal_contention_store".to_owned(),
                        query_key: "liveItems:{}".to_owned(),
                        query_instance_id: 9_002,
                    }),
                    supersedes: None,
                    resume_from_token: None,
                },
                None,
            )
        }
    })
    .await
    .expect("reserve staged service subscription");
    let authority_work = connection_act
        .reserve_authority_work(epoch_now_ms, monotonic_now)
        .expect("retain service authority through Local finalization");
    let committed_stage = staged.clone();
    connection_act
        .try_act(
            &fixture.state.connections,
            epoch_now_ms,
            monotonic_now,
            || {
                let _effect = admission.effect_guard("service contention stage CAS")?;
                committed_stage
                    .try_commit(&connection_id, &effect_fence)
                    .map_err(super::ApiError::from)
            },
        )
        .expect("commit exact service stage");

    // The retained live rerun advances the durable service clock from the
    // host wall clock. Put the injected provider just ahead of that sample
    // so the later revoke transaction cannot look like clock rollback.
    fixture
        .clock
        .set(super::now_millis().saturating_add(10_000));

    // The terminal request first performs its bounded Local plan, releases
    // Local, and closes the exact token while it waits for
    // `authority_work`. Only then does the test take Local to control the
    // finalizer/terminal writer queue order.
    let mut revoke = auth_http_request(
        "POST",
        "/auth/agents/revoke-self",
        serde_json::to_vec(&json!({ "credential": fixture.credential })).unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut revoke);
    let terminal_router = fixture.router.clone();
    let terminal = tokio::spawn(async move {
        terminal_router
            .oneshot(revoke)
            .await
            .expect("terminal route response")
    });
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
    .expect("terminal handler closes later work before entering Local");
    assert!(
        !terminal.is_finished(),
        "terminal waits for the admitted staged predecessor"
    );
    let local_blocker = fixture.state.snapback.clone().lock_owned().await;

    let (finalizer_started_tx, finalizer_started_rx) = tokio::sync::oneshot::channel();
    let finalize_state = fixture.state.snapback.clone();
    let finalizer = tokio::spawn(async move {
        finalizer_started_tx
            .send(())
            .expect("report finalizer queue attempt");
        with_snapback(&finalize_state, move |snapback| {
            authority_work.with_retained_service_authority(|| {
                snapback.finalize_subscribe_live_for_transport(&staged)
            })
        })
        .await
    });
    finalizer_started_rx
        .await
        .expect("finalizer reaches the Local queue");
    tokio::task::yield_now().await;
    drop(local_blocker);

    let publication = tokio::time::timeout(Duration::from_secs(5), finalizer)
        .await
        .expect("staged finalizer is not excluded by terminal work")
        .expect("finalizer task")
        .expect("staged service work publishes");
    assert!(!publication.output.subscription_id.is_empty());
    let terminal = tokio::time::timeout(Duration::from_secs(5), terminal)
        .await
        .expect("durable terminal proceeds after staged permit release")
        .expect("terminal task");
    assert_eq!(terminal.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        service_publication
            .resolve_act(epoch_now_ms, monotonic_now)
            .expect("resolve committed service terminal"),
        ServiceAuthorityActResolution::Terminal(ServiceAuthorityDisposition::DurableDelete)
    );
}

/// Once the drained service-domain gate is returned, request cancellation
/// must abandon only the response waiter. The gate and exact durable
/// transaction stay independently owned while queued for Local, so no new
/// service act can enter across the eventual commit.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancelled_service_terminal_waiter_stays_closed_until_owned_local_commit() {
    let fixture = finite_authority_matrix_fixture().await;
    let opened = fixture
        .router
        .clone()
        .oneshot(connection_open_request(
            Some(&fixture.token),
            json!({
                "connectionId": "cancelled-service-terminal-waiter",
                "authInvalidationProtocol": 1,
            }),
        ))
        .await
        .expect("open service connection");
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
    let (epoch_now_ms, monotonic_now) = super::auth_runtime_now(&fixture.state);
    let connection_act = fixture
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
        .expect("prepare exact service connection act");
    let service_publication = connection_act
        .bound
        .service_publication()
        .expect("service connection retains its exact publication")
        .clone();

    fixture
        .clock
        .set(super::now_millis().saturating_add(10_000));
    let predecessor = connection_act
        .reserve_authority_work(epoch_now_ms, monotonic_now)
        .expect("retain one predecessor while the request plans its exact token set");
    let pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterServiceTerminalOwnedSpawn,
    );
    let mut revoke = auth_http_request(
        "POST",
        "/auth/agents/revoke-self",
        serde_json::to_vec(&json!({ "credential": fixture.credential.clone() })).unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut revoke);
    revoke.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(pause.id()).expect("owned terminal pause header"),
    );
    let terminal_router = fixture.router.clone();
    let terminal_waiter = tokio::spawn(async move {
        terminal_router
            .oneshot(revoke)
            .await
            .expect("terminal route response")
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
    .expect("terminal request plans under Local, then closes exact service work");
    let local_blocker = fixture.state.snapback.clone().lock_owned().await;
    drop(predecessor);
    tokio::time::timeout(Duration::from_secs(2), pause.wait_until_reached())
        .await
        .expect("request transfers the drained gate into its owned transaction");
    assert!(!terminal_waiter.is_finished());
    terminal_waiter.abort();
    assert!(terminal_waiter.await.unwrap_err().is_cancelled());
    assert!(
        connection_act
            .reserve_authority_work(epoch_now_ms, monotonic_now)
            .is_err(),
        "dropping the request waiter must not drop the owned terminal gate"
    );

    drop(local_blocker);
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let (epoch_now_ms, monotonic_now) = super::auth_runtime_now(&fixture.state);
            if service_publication
                .resolve_act(epoch_now_ms, monotonic_now)
                .is_ok_and(|resolution| {
                    resolution
                        == ServiceAuthorityActResolution::Terminal(
                            ServiceAuthorityDisposition::DurableDelete,
                        )
                })
                && !fixture
                    .state
                    .connections
                    .lock()
                    .grants
                    .contains_key(&connection_id)
            {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("owned terminal transaction commits and propagates after Local reopens");
}

#[tokio::test]
async fn settlement_acknowledgement_uses_prepared_authority_not_body_identity() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let prepared = |user_id: &str| {
        InvocationGate::prepare_admitted_subjectless_authority(
            InvocationSource::MutationSettlementAcknowledgement,
            AuthMode::Dev,
            ServerProfile::Test,
            state.auth_admission_controller().admit_dev().unwrap(),
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::DevImpersonation {
                user_id: user_id.to_owned(),
                roles: Vec::new(),
                local_dev_only: true,
            },
            None,
        )
        .unwrap()
    };
    let retained_auth = AuthInput {
        principal: None,
        session_id: None,
        user_id: Some("settlement-owner".to_owned()),
        ..AuthInput::default()
    };
    let retained_input = HandlerInput {
        auth: retained_auth.clone(),
        ..HandlerInput::default()
    };
    let retained_authority = prepared("settlement-owner");
    let retained_admission = state.auth_admission_controller();
    let authority_instance_id = super::with_snapback(&state.snapback, move |snapback| {
        let incarnation = snapback
            .remainder_auth_fixture()
            .ensure_authorization_stream_incarnation()
            .expect("authorization stream incarnation");
        let retained_authority = retained_authority
            .bind_authorization_stream(&retained_admission, incarnation.as_str().to_owned())
            .expect("bind authorization stream");
        snapback
            .prepare_authority_descriptor(retained_authority)
            .expect("prepared authority descriptor")
            .authority_descriptor()
            .authority_instance_id
            .clone()
    })
    .await;
    let identity = ClientMutationIdentity::for_authority(
        "cm_prepared_authority_ack",
        "settlement-test",
        &retained_input,
        authority_instance_id,
    );
    let retained_id = identity.id.clone();
    super::with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .mutation_writes()
            .execute_mutation_idempotent(
                &MutationPlan {
                    owner_write_checks: Vec::new(),
                    steps: Vec::new(),
                    return_value: Some(ReturnValue::ChangedCount),
                },
                &retained_input,
                &identity,
            )
            .expect("retain settlement for authority A");
    })
    .await;

    let Json(wrong) = super::acknowledge_mutations(
        State(state.snapback.clone()),
        Extension(prepared("different-owner")),
        HeaderMap::new(),
        Ok(Json(MutationAcknowledgementRequest {
            auth: retained_auth.clone(),
            authority_descriptor: None,
            client_mutation_ids: vec![retained_id.clone()],
        })),
    )
    .await
    .unwrap();
    assert_eq!(wrong.acknowledged, 0);

    let Json(owner) = super::acknowledge_mutations(
        State(state.snapback.clone()),
        Extension(prepared("settlement-owner")),
        HeaderMap::new(),
        Ok(Json(MutationAcknowledgementRequest {
            auth: AuthInput {
                principal: None,
                session_id: None,
                user_id: Some("different-owner".to_owned()),
                ..AuthInput::default()
            },
            authority_descriptor: None,
            client_mutation_ids: vec![retained_id],
        })),
    )
    .await
    .unwrap();
    assert_eq!(owner.acknowledged, 1);
}

#[tokio::test]
async fn pre_item7_queued_replay_is_refused_before_mutation_lookup() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let item5 = AuthProgramReadiness::new(true, true, true, true, false, false, false);
    let state = state
        .with_auth_runtime_facts(settled_sessions_state(), item5)
        .expect("install item-5 sessions fixture");
    let response = app(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mutation/does-not-exist")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .body(Body::from(r#"{"args":{},"clientMutationId":"queued-1"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = response_json(response).await;
    assert_eq!(
        body["diagnostic"]["code"],
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
    );
    assert_eq!(body["diagnostic"]["details"]["capability"], "queuedReplay");
}

#[tokio::test]
async fn hosted_sender_issuance_outcome_matrix_is_transactional() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let mut state = state
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, false, false, false),
        )
        .expect("install hosted sender sessions posture");
    Arc::make_mut(&mut state.server).auth_deployment =
        crate::auth::deployment::AuthDeploymentTarget::Hosted;
    let provider = state
        .auth_provider
        .as_ref()
        .expect("hosted fixture provider")
        .clone();
    let now_ms = provider.now_ms();
    let state = state
        .with_hosted_serving_authority(hosted_serving_authority(now_ms))
        .expect("install hosted sender authority");
    let router = app(state.clone());
    let sender_key = HostedSenderProofKey::generate();
    let issued_at_seconds = provider.now_ms() / 1_000;

    let (challenge_id, code) =
        request_hosted_sender_challenge(&router, &provider, "sender-matrix@example.com").await;
    let valid_shape = sender_key.issuance_proof(&challenge_id, issued_at_seconds, [50_u8; 16]);
    let mut compact: Vec<_> = valid_shape.split('.').map(str::to_owned).collect();
    assert_eq!(compact.len(), 3);
    compact[2] = URL_SAFE_NO_PAD.encode([0_u8; 64]);
    let invalid_signature = compact.join(".");
    let invalid = hosted_sender_exchange_response(
        &router,
        &challenge_id,
        &code,
        sender_key.public_jwk(),
        &invalid_signature,
    )
    .await;
    assert_ne!(invalid.status(), StatusCode::OK);
    assert_eq!(
        sender_issuance_durable_counts(&state, &challenge_id),
        (0, 0, 0, 0, 0),
        "crypto-invalid proof consumes neither code attempt nor sender authority",
    );

    let wrong_code = if code == "000000" { "000001" } else { "000000" };
    let rejected_proof = sender_key.issuance_proof(&challenge_id, issued_at_seconds, [51_u8; 16]);
    let wrong = hosted_sender_exchange_response(
        &router,
        &challenge_id,
        wrong_code,
        sender_key.public_jwk(),
        &rejected_proof,
    )
    .await;
    assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        sender_issuance_durable_counts(&state, &challenge_id),
        (1, 1, 0, 0, 0),
        "wrong code and valid proof consume one attempt and the proof atomically",
    );

    let replay = hosted_sender_exchange_response(
        &router,
        &challenge_id,
        &code,
        sender_key.public_jwk(),
        &rejected_proof,
    )
    .await;
    assert_ne!(replay.status(), StatusCode::OK);
    assert_eq!(
        sender_issuance_durable_counts(&state, &challenge_id),
        (1, 1, 0, 0, 0),
        "replayed rejected proof cannot spend a second code guess",
    );

    let accepted_proof = sender_key.issuance_proof(&challenge_id, issued_at_seconds, [52_u8; 16]);
    let accepted = hosted_sender_exchange_response(
        &router,
        &challenge_id,
        &code,
        sender_key.public_jwk(),
        &accepted_proof,
    )
    .await;
    assert_eq!(accepted.status(), StatusCode::OK);
    assert_eq!(
        sender_issuance_durable_counts(&state, &challenge_id),
        (2, 2, 1, 1, 1),
        "correct code installs replay, binding, session, and initial nonce together",
    );

    let (locked_challenge, locked_code) =
        request_hosted_sender_challenge(&router, &provider, "sender-locked@example.com").await;
    let locked_wrong_code = if locked_code == "000000" {
        "000001"
    } else {
        "000000"
    };
    for attempt in 0..crate::auth::provider::AUTH_MAXIMUM_ATTEMPTS {
        let proof = sender_key.issuance_proof(
            &locked_challenge,
            issued_at_seconds,
            [60_u8 + attempt as u8; 16],
        );
        let response = hosted_sender_exchange_response(
            &router,
            &locked_challenge,
            locked_wrong_code,
            sender_key.public_jwk(),
            &proof,
        )
        .await;
        assert!(
            response.status().is_client_error(),
            "wrong code must remain a typed client refusal",
        );
    }
    assert_eq!(
        sender_issuance_durable_counts(&state, &locked_challenge),
        (5, 7, 1, 1, 1),
        "each rejected guess consumes its unique valid proof",
    );
    let locked_proof = sender_key.issuance_proof(&locked_challenge, issued_at_seconds, [70_u8; 16]);
    let locked = hosted_sender_exchange_response(
        &router,
        &locked_challenge,
        &locked_code,
        sender_key.public_jwk(),
        &locked_proof,
    )
    .await;
    assert!(locked.status().is_client_error());
    assert_eq!(
        sender_issuance_durable_counts(&state, &locked_challenge),
        (5, 8, 1, 1, 1),
        "an already exhausted challenge still consumes a fresh valid proof",
    );

    let (failure_challenge, failure_code) =
        request_hosted_sender_challenge(&router, &provider, "sender-authority-failure@example.com")
            .await;
    let failure_proof =
        sender_key.issuance_proof(&failure_challenge, issued_at_seconds, [53_u8; 16]);
    {
        let mut snapback = state
            .snapback
            .try_lock()
            .expect("borrow sender authority for issuance failure injection");
        snapback
            .make_sender_proof_replay_unavailable_for_test()
            .expect("make issuance replay authority unavailable");
    }
    let unavailable = hosted_sender_exchange_response(
        &router,
        &failure_challenge,
        &failure_code,
        sender_key.public_jwk(),
        &failure_proof,
    )
    .await;
    assert!(
        unavailable.status().is_server_error(),
        "sender replay-authority failure must fail closed",
    );
    {
        let snapback = state
            .snapback
            .try_lock()
            .expect("borrow sender authority for issuance repair");
        snapback
            .restore_sender_proof_after_test_outage()
            .expect("repair issuance replay authority");
    }
    assert_eq!(
        sender_issuance_durable_counts(&state, &failure_challenge),
        (0, 0, 1, 1, 1),
        "authority failure rolls back proof, challenge, binding, nonce, and session creation",
    );
}

/// @ref LLP 0146#d1-declarationobservation-conformance — coordinated
/// `function.run` mutation conformance is derived in generation A's commit
/// turn. A same-name generation B installed before envelope assembly cannot
/// conceal A's undeclared tableB write with B's broader declaration.
/// @ref LLP 0012#call-time-generation-binding — every fact derived from the
/// invocation stays bound to the selected function/schema generation.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn coordinated_function_run_mutation_conformance_is_bound_to_executing_generation() {
    const FUNCTION: &str = "generationBoundMutation";

    let table = |name: &str| TableManifest {
        name: name.to_owned(),
        fields: vec![FieldManifest {
            name: "value".to_owned(),
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
    };
    let manifest = |declared: &str| {
        let mut function = FunctionDefinition::new(
            FUNCTION,
            FunctionKind::Mutation,
            FunctionRuntime::IbexModule(IbexModule {
                source: "globalThis.__snapbackHandlers = { async generationBoundMutation(ctx, args) { return await ctx.db.insert('tableB', { value: args.value }); } };".to_owned(),
                export: FUNCTION.to_owned(),
            }),
        );
        function.write_set_summary.tables = vec![declared.to_owned()];
        FunctionManifest {
            functions: vec![function],
            ..FunctionManifest::default()
        }
    };
    let tables = vec![table("tableA"), table("tableB")];
    let generation_a = manifest("tableA");
    let generation_b = manifest("tableB");
    let (state, _) = tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        auth_runtime_fixture_with(PolicyAuthMode::Dev, move |snapback| {
            snapback
                .apply_schema(SchemaManifest {
                    tables,
                    ..SchemaManifest::default()
                })
                .expect("apply generation-binding schema");
            let diagnostics = snapback.load_functions(generation_a);
            assert!(
                diagnostics.iter().all(|diagnostic| {
                    diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error
                }),
                "generation A must load: {diagnostics:?}"
            );
        })
    })
    .await
    .expect("construct generation-binding fixture off async workers");
    let pause = super::install_test_coordinated_mutation_pause(FUNCTION);
    let router = app(state.clone());
    let request = auth_http_request(
        "POST",
        "/_snapback/api/host-ops",
        serde_json::to_vec(&json!({
            "operation": "function.run",
            "function": FUNCTION,
            "args": { "value": "generation-a" },
        }))
        .expect("serialize generation-A function.run"),
        true,
        Some("auth-http-admin"),
        None,
    );
    let run = tokio::spawn(async move {
        router
            .oneshot(request)
            .await
            .expect("generation-A function.run response")
    });

    tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
        .await
        .expect("generation A commits before its envelope turn");
    let diagnostics = with_snapback(&state.snapback, move |snapback| {
        snapback.load_functions(generation_b)
    })
    .await;
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error),
        "generation B must install in the post-commit/pre-envelope window: {diagnostics:?}"
    );
    pause.release();

    let response = tokio::time::timeout(Duration::from_secs(5), run)
        .await
        .expect("generation-A response completes")
        .expect("generation-A response task joins");
    assert_eq!(response.status(), StatusCode::OK);
    let response = response_json(response).await;
    assert_eq!(response["ok"], true, "{response}");
    assert_eq!(
        response["data"]["conformance"]["missingWrites"],
        json!(["tableB"]),
        "generation B must not launder generation A's undeclared write: {response}"
    );
    assert_eq!(
        response["data"]["conformance"]["extraWrites"],
        json!(["tableA"])
    );
    assert_eq!(
        response["data"]["conformance"]["writeProvenance"], "complete",
        "the fix must preserve authoritative non-raced/fresh capture"
    );
}

/// @ref LLP 0146#d1-declarationobservation-conformance — an admitted action
/// that throws executed only partially, so its unconditional ring report is
/// incomplete rather than the successful action lane's unsupported verdict.
#[tokio::test]
async fn admitted_throwing_action_records_incomplete_provenance() {
    let (state, _) = auth_runtime_fixture_with(PolicyAuthMode::Dev, |snapback| {
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![FunctionDefinition::new(
                "throwingAction",
                FunctionKind::Action,
                FunctionRuntime::IbexModule(IbexModule {
                    source: "globalThis.__snapbackHandlers = { async throwingAction() { throw new Error('admitted action failed'); } };".to_owned(),
                    export: "throwingAction".to_owned(),
                }),
            )],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics.iter().all(|diagnostic| {
                diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error
            }),
            "throwing action fixture must load: {diagnostics:?}"
        );
    });
    let ring = state.recent_invocations.clone();
    let response = app(state)
        .oneshot(auth_http_request(
            "POST",
            "/action/throwingAction",
            br#"{"args":{}}"#.to_vec(),
            true,
            None,
            None,
        ))
        .await
        .expect("admitted throwing action response");
    assert_eq!(response.status(), StatusCode::OK);
    let response = response_json(response).await;
    assert_eq!(response["ok"], false, "{response}");

    let recent = ring.snapshot();
    assert_eq!(recent.len(), 1, "exactly the action invocation is recorded");
    assert_eq!(recent[0].operation, "action");
    assert_eq!(recent[0].function_id.as_deref(), Some("throwingAction"));
    assert_eq!(
        recent[0].conformance,
        Some(json!({
            "missingReads": [],
            "missingWrites": [],
            "extraReads": [],
            "extraWrites": [],
            "readProvenance": "incomplete",
            "writeProvenance": "incomplete",
        }))
    );
}

/// @ref LLP 0146#d1-declarationobservation-conformance — publishing a stream
/// attempt token is not terminal success: the ring waits for the streaming
/// worker and records a later throw as six-field incomplete evidence.
#[tokio::test]
async fn streaming_action_throw_after_attempt_token_records_terminal_incomplete() {
    let (state, _) = auth_runtime_fixture_with(PolicyAuthMode::Sessions, |snapback| {
        let mut function = FunctionDefinition::new(
            "streamingThrow",
            FunctionKind::Action,
            FunctionRuntime::IbexModule(IbexModule {
                source: "globalThis.__snapbackHandlers = { async streamingThrow() { throw new Error('stream terminal failure'); } };".to_owned(),
                export: "streamingThrow".to_owned(),
            }),
        );
        function.stream = true;
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![function],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics.iter().all(|diagnostic| {
                diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error
            }),
            "streaming throw fixture must load: {diagnostics:?}"
        );
    });
    let state = state
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, false, false, false),
        )
        .expect("install streaming-action sessions fixture");
    let credential = mint_test_credential(&state, "stream-ring@example.test").await;
    let bearer = credential["token"].as_str().expect("session bearer");
    let ring = state.recent_invocations.clone();

    let response = app(state)
        .oneshot(session_auth_http_request(
            "/action/streamingThrow",
            br#"{"args":{}}"#.to_vec(),
            bearer,
        ))
        .await
        .expect("streaming action initiation response");
    assert_eq!(response.status(), StatusCode::OK);
    let response = response_json(response).await;
    assert!(
        response["result"]["attemptToken"].is_string(),
        "the initiation acknowledgement must precede the throw: {response}"
    );

    let recent = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let recent = ring.snapshot();
            if !recent.is_empty() {
                break recent;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("streaming terminal ring record arrives");
    assert_eq!(recent.len(), 1, "only the terminal disposition is recorded");
    assert_eq!(recent[0].operation, "action");
    assert_eq!(recent[0].function_id.as_deref(), Some("streamingThrow"));
    assert_eq!(recent[0].outcome, "SNAPBACK_HANDLER_FAILED");
    assert_eq!(
        recent[0].conformance,
        Some(json!({
            "missingReads": [],
            "missingWrites": [],
            "extraReads": [],
            "extraWrites": [],
            "readProvenance": "incomplete",
            "writeProvenance": "incomplete",
        }))
    );
}

/// @ref LLP 0146#d1-declarationobservation-conformance — an exact settlement
/// replay did not execute the handler or capture dependencies for this call,
/// so the losing same-ID ring entry must never claim complete provenance.
/// @ref LLP 0043#milestone-2-queued-mutation-replay — the concurrent loser
/// returns the winner's exact durable result without executing twice.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_same_id_mutation_loser_records_incomplete_provenance() {
    const MUTATION_ID: &str = "cm_conformance_race";

    let state = sessions_activation_server_fixture_async().await;
    let credential = mint_test_credential(&state, "conformance-race@example.test").await;
    let bearer = credential["token"]
        .as_str()
        .expect("fixture session bearer")
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
                .header("x-snapback-authority-descriptor-protocol", "1")
                .body(Body::empty())
                .expect("authority handshake request"),
        )
        .await
        .expect("authority handshake response");
    assert_eq!(handshake.status(), StatusCode::OK);
    let authority_descriptor = response_json(handshake).await["authorityDescriptor"].clone();

    let request = || {
        let mut request = session_auth_http_request(
            "/mutation/queuedWrite",
            serde_json::to_vec(&json!({
                "args": { "value": "same-id-conformance-race" },
                "clientMutationId": MUTATION_ID,
                "authorityDescriptor": authority_descriptor,
            }))
            .expect("same-id request body"),
            &bearer,
        );
        request.headers_mut().insert(
            HeaderName::from_static("x-snapback-authority-descriptor-protocol"),
            HeaderValue::from_static("1"),
        );
        request
    };
    let first = tokio::spawn({
        let router = router.clone();
        let request = request();
        async move {
            router
                .oneshot(request)
                .await
                .expect("first same-id response")
        }
    });
    let second = tokio::spawn({
        let router = router.clone();
        let request = request();
        async move {
            router
                .oneshot(request)
                .await
                .expect("second same-id response")
        }
    });

    let mut responses = Vec::new();
    for response in [first, second] {
        let response = tokio::time::timeout(Duration::from_secs(5), response)
            .await
            .expect("same-id request settles")
            .expect("same-id task joins");
        let status = response.status();
        responses.push((status, response_json(response).await));
    }
    assert!(
        responses
            .iter()
            .all(|(status, _)| *status == StatusCode::OK),
        "winner and exact replay both return the durable result: {responses:?}"
    );

    let mutation_entries = state
        .recent_invocations
        .snapshot()
        .into_iter()
        .filter(|entry| {
            entry.operation == "mutation" && entry.function_id.as_deref() == Some("queuedWrite")
        })
        .collect::<Vec<_>>();
    assert_eq!(
        mutation_entries.len(),
        2,
        "winner and replay both enter the ring"
    );
    let provenances = mutation_entries
        .iter()
        .map(|entry| {
            let conformance = entry
                .conformance
                .as_ref()
                .expect("same-id conformance report");
            (
                conformance["readProvenance"].as_str().unwrap(),
                conformance["writeProvenance"].as_str().unwrap(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        provenances
            .iter()
            .filter(|provenance| **provenance == ("complete", "complete"))
            .count(),
        1,
        "only the execution that captured dependencies is complete: {provenances:?}"
    );
    assert_eq!(
        provenances
            .iter()
            .filter(|provenance| **provenance == ("incomplete", "incomplete"))
            .count(),
        1,
        "the reconstructed loser is explicitly incomplete: {provenances:?}"
    );
}

#[tokio::test]
async fn rejected_host_ops_reset_does_not_wait_for_exclusive_auth_maintenance() {
    let (router, _, provider) = auth_http_fixture_with_provider(PolicyAuthMode::Sessions);
    let admission = provider.admit().await;
    let response = tokio::time::timeout(
        Duration::from_millis(100),
        router.oneshot(auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            serde_json::to_vec(&serde_json::json!({"operation": "app.reset"})).unwrap(),
            true,
            None,
            None,
        )),
    )
    .await
    .expect("authorization rejects without waiting for exclusive maintenance")
    .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    drop(admission);
}

#[tokio::test]
async fn hosted_guest_claim_attempt_requires_a_real_effective_source() {
    let mut state = guest_sessions_activation_server_fixture_async(
        true,
        GuestCleanupContractV1::Declarative {
            default: GuestCleanupActionV1::Tombstone,
            tables: BTreeMap::new(),
        },
    )
    .await;
    Arc::make_mut(&mut state.server).auth_deployment =
        crate::auth::deployment::AuthDeploymentTarget::Hosted;
    let spec = super::core_route_registrations()
        .into_iter()
        .find(|route| route.spec.path == "/auth/guest/claim/password")
        .expect("guest claim registration")
        .spec;
    let body = json!({
        "email": "hosted-source-required@example.com",
        "password": "hosted-source-required-password-123!",
    });
    let response = super::charge_hosted_body_auth_attempt(spec, &state, None, Some(&body))
        .await
        .expect_err("hosted claim accounting must not synthesize loopback");
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response_json(response).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_EFFECTIVE_SOURCE_UNAVAILABLE",
    );
}

#[tokio::test]
async fn guest_entry_http_refuses_csprng_failure_before_identity_effect() {
    let state = guest_sessions_activation_server_fixture_async(
        true,
        GuestCleanupContractV1::Declarative {
            default: GuestCleanupActionV1::Tombstone,
            tables: BTreeMap::new(),
        },
    )
    .await;
    let now_ms = super::now_millis();
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    keyring
        .load_or_mint_initial(now_ms, &OsRandom)
        .expect("CSPRNG failure keyring");
    let random = Arc::new(ToggleServerRandom {
        unavailable: AtomicBool::new(false),
    });
    let provider = Arc::new(
        AuthProvider::new_with_dependencies(
            AuthProviderProfile::Test,
            keyring,
            random.clone(),
            Arc::new(ManualServerAuthClock::new(now_ms)),
        )
        .expect("provider initializes before injected failure"),
    );
    random.unavailable.store(true, Ordering::SeqCst);
    let response = app(state
        .try_with_auth_provider(provider)
        .expect("CSPRNG failure guest state"))
    .oneshot(password_auth_http_request("/auth/guest", json!({})))
    .await
    .expect("CSPRNG failure response");
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response_json(response).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_RANDOM_UNAVAILABLE"
    );
}

/// @ref LLP 0055#re-credentialing-recovery-and-the-production-profile-invariant — authority-creating consent consumes
/// one operation/target/session-bound proof in the grant transaction;
/// ordinary consent remains frictionless.
#[tokio::test]
async fn grant_step_up_is_domain_separated_target_bound_and_single_effect() {
    let state = sessions_activation_server_fixture_with_agents_async(agent_policy(
        AgentsMode::Open,
        InvitedBy::Operators,
    ))
    .await;
    let provider = state.auth_provider.clone().unwrap();
    let credential = mint_test_credential(&state, "step-up@example.com").await;
    let bearer = credential["token"].as_str().unwrap().to_owned();
    let second_credential = mint_test_credential(&state, "step-up@example.com").await;
    let second_bearer = second_credential["token"].as_str().unwrap().to_owned();
    let user_id = credential["session"]["userId"].as_str().unwrap().to_owned();
    let now_ms = provider.now_ms();
    let request_ids = with_snapback(&state.snapback, {
        let user_id = user_id.clone();
        move |snapback| {
            let mut db = snapback.remainder_auth_fixture();
            let issued = db.register_agent_principal(
                None,
                Some("Step-up Agent".to_owned()),
                None,
                ServerProfile::Test,
                now_ms,
                &OsRandom,
            )?;
            let agent_credential = issued.secret;
            db.auth_catalog().insert_step_up_scope_bases_for_test()?;

            let mut present = |function_id: &str,
                               kind: crate::storage::auth_grants::ScopedFunctionKind|
             -> crate::diagnostic::SnapbackResult<String> {
                let pairing = db.mint_pairing_code(&user_id, now_ms, &OsRandom)?;
                db.present_pairing_code(
                    &agent_credential,
                    &pairing.request_id,
                    &pairing.secret,
                    &[crate::storage::auth_grants::GrantScopeRequest::Exact {
                        function_id: function_id.to_owned(),
                        kind,
                    }],
                    now_ms,
                )?;
                Ok(pairing.request_id)
            };
            Ok::<_, SnapbackError>((
                present(
                    "fn:seatRole",
                    crate::storage::auth_grants::ScopedFunctionKind::Mutation,
                )?,
                present(
                    "fn:seatRole",
                    crate::storage::auth_grants::ScopedFunctionKind::Mutation,
                )?,
                present(
                    "fn:listItems",
                    crate::storage::auth_grants::ScopedFunctionKind::Query,
                )?,
            ))
        }
    })
    .await
    .unwrap();
    let (bound_request, other_request, ordinary_request) = request_ids;
    let router = app(state.clone());

    let ordinary = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/auth/grant-requests/{ordinary_request}/approve"),
            br#"{}"#.to_vec(),
            &bearer,
        ))
        .await
        .unwrap();
    assert_eq!(ordinary.status(), StatusCode::OK);

    let missing = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/auth/grant-requests/{bound_request}/approve"),
            br#"{}"#.to_vec(),
            &bearer,
        ))
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(missing).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_STEP_UP_REQUIRED"
    );

    let login_admission = provider.admit_email("step-up@example.com").await.unwrap();
    let login_now_ms = provider.now_ms();
    let login_challenge = with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .request_code(&login_admission, login_now_ms)
            .map(|response| response.challenge_id)
    })
    .await
    .unwrap();
    let login_mailbox =
        serde_json::to_value(provider.mailbox_entry(&login_challenge).await.unwrap()).unwrap();
    let login_code = login_mailbox["code"].as_str().unwrap().to_owned();
    let login_as_step_up = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/auth/grant-requests/{bound_request}/approve"),
            serde_json::to_vec(&json!({
                "stepUp": {"challengeId": login_challenge, "code": login_code}
            }))
            .unwrap(),
            &bearer,
        ))
        .await
        .unwrap();
    assert_eq!(login_as_step_up.status(), StatusCode::UNAUTHORIZED);

    let challenge_response = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/step-up/request",
            serde_json::to_vec(&json!({
                "operation": "grantApproval",
                "requestId": bound_request,
            }))
            .unwrap(),
            &bearer,
        ))
        .await
        .unwrap();
    assert_eq!(challenge_response.status(), StatusCode::OK);
    assert_eq!(
        challenge_response.headers()[header::CACHE_CONTROL],
        "no-store, private"
    );
    let challenge = response_json(challenge_response).await;
    let challenge_id = challenge["challengeId"].as_str().unwrap().to_owned();
    let expires_at = challenge["expiresAt"].as_u64().unwrap();
    assert!(expires_at >= now_ms + crate::auth::provider::AUTH_STEP_UP_TTL_MS);
    assert!(expires_at <= now_ms + crate::auth::provider::AUTH_STEP_UP_TTL_MS + 1_000);
    let mailbox =
        serde_json::to_value(provider.mailbox_entry(&challenge_id).await.unwrap()).unwrap();
    let code = mailbox["code"].as_str().unwrap().to_owned();

    let substituted = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/auth/grant-requests/{other_request}/approve"),
            serde_json::to_vec(&json!({
                "stepUp": {"challengeId": challenge_id, "code": code}
            }))
            .unwrap(),
            &bearer,
        ))
        .await
        .unwrap();
    assert_eq!(substituted.status(), StatusCode::UNAUTHORIZED);
    let substituted_json = response_json(substituted).await;
    assert_eq!(
        substituted_json["diagnostic"]["code"],
        "SNAPBACK_AUTH_STEP_UP_REQUIRED"
    );
    assert!(!substituted_json.to_string().contains(&code));

    let wrong_session = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/auth/grant-requests/{bound_request}/approve"),
            serde_json::to_vec(&json!({
                "stepUp": {"challengeId": challenge_id, "code": code}
            }))
            .unwrap(),
            &second_bearer,
        ))
        .await
        .unwrap();
    assert_eq!(wrong_session.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(wrong_session).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_STEP_UP_REQUIRED"
    );

    let approval_body = serde_json::to_vec(&json!({
        "stepUp": {"challengeId": challenge_id, "code": code}
    }))
    .unwrap();
    // Simulate a lost SQLite COMMIT acknowledgement after the first
    // concurrent transaction actually commits. Exact request/grant/proof
    // reconciliation must still publish one successful immutable grant.
    crate::storage::auth_grants::inject_next_grant_commit_uncertain(&bound_request);
    let first = router.clone().oneshot(session_auth_http_request(
        &format!("/auth/grant-requests/{bound_request}/approve"),
        approval_body.clone(),
        &bearer,
    ));
    let second = router.clone().oneshot(session_auth_http_request(
        &format!("/auth/grant-requests/{bound_request}/approve"),
        approval_body,
        &bearer,
    ));
    let (first, second) = tokio::join!(first, second);
    assert_eq!(first.unwrap().status(), StatusCode::OK);
    assert_eq!(second.unwrap().status(), StatusCode::OK);

    let replay_for_other = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/auth/grant-requests/{other_request}/approve"),
            serde_json::to_vec(&json!({
                "stepUp": {"challengeId": challenge_id, "code": code}
            }))
            .unwrap(),
            &bearer,
        ))
        .await
        .unwrap();
    assert_eq!(replay_for_other.status(), StatusCode::UNAUTHORIZED);

    let second_challenge_response = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/step-up/request",
            serde_json::to_vec(&json!({
                "operation": "grantApproval",
                "requestId": other_request,
            }))
            .unwrap(),
            &bearer,
        ))
        .await
        .unwrap();
    assert_eq!(second_challenge_response.status(), StatusCode::OK);
    let second_challenge = response_json(second_challenge_response).await;
    let second_challenge_id = second_challenge["challengeId"].as_str().unwrap().to_owned();
    let second_mailbox =
        serde_json::to_value(provider.mailbox_entry(&second_challenge_id).await.unwrap()).unwrap();
    let second_code = second_mailbox["code"].as_str().unwrap().to_owned();
    crate::storage::auth_grants::inject_next_grant_reconciliation_failure(&other_request);
    let unavailable = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/auth/grant-requests/{other_request}/approve"),
            serde_json::to_vec(&json!({
                "stepUp": {
                    "challengeId": second_challenge_id,
                    "code": second_code,
                }
            }))
            .unwrap(),
            &bearer,
        ))
        .await
        .unwrap();
    assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response_json(unavailable).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_GRANT_COMMIT_UNCERTAIN"
    );
    let reconciled_retry = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/auth/grant-requests/{other_request}/approve"),
            br#"{}"#.to_vec(),
            &bearer,
        ))
        .await
        .unwrap();
    assert_eq!(reconciled_retry.status(), StatusCode::OK);

    with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .auth_catalog()
            .assert_step_up_consumption_for_test(&bound_request, &challenge_id, &code)
    })
    .await
    .unwrap();
}

#[test]
fn cron_autonomy_disabled_accepts_only_explicit_switch_values() {
    assert!(super::cron_autonomy_disabled(Some("1")));
    assert!(super::cron_autonomy_disabled(Some("true")));
    assert!(super::cron_autonomy_disabled(Some("TRUE")));
    assert!(super::cron_autonomy_disabled(Some(" true ")));
    // Anything else — including empty, zero, and typos — keeps the
    // scheduler on; a malformed value must not silently disarm crons.
    assert!(!super::cron_autonomy_disabled(None));
    assert!(!super::cron_autonomy_disabled(Some("")));
    assert!(!super::cron_autonomy_disabled(Some("0")));
    assert!(!super::cron_autonomy_disabled(Some("false")));
    assert!(!super::cron_autonomy_disabled(Some("yes")));
    assert!(!super::cron_autonomy_disabled(Some("disabled")));
}

#[test]
fn detached_action_admission_rejects_at_capacity_and_recovers() {
    let limiter = Arc::new(Semaphore::new(1));
    let permit = reserve_detached_action_worker(limiter.clone(), 1).expect("first worker");
    let error = reserve_detached_action_worker(limiter.clone(), 1)
        .expect_err("second worker must be rejected");
    assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_CAPACITY_EXCEEDED");
    assert_eq!(
        status_for_diagnostic_code(&error.diagnostic.code),
        StatusCode::SERVICE_UNAVAILABLE
    );

    drop(permit);
    assert!(reserve_detached_action_worker(limiter, 1).is_ok());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn detached_action_execution_stays_bounded_under_repeated_saturation() {
    let state = slow_cron_state(CronOverlapPolicy::Allow);
    let counters = isolated_worker_counters();
    let mut staged = Vec::new();
    for _ in 0..10 {
        let action = super::with_snapback(&state, |snapback| {
            snapback.stage_cron_action_invocation("slowCron")
        })
        .await
        .expect("stage slow action");
        let StagedAction::Detached(action) = action else {
            panic!("Ibex action must detach");
        };
        staged.push(action);
    }

    let admission = Arc::new(Semaphore::new(2));
    let first = staged.remove(0);
    let second = staged.remove(0);
    let first_run = {
        let state = state.clone();
        let admission = admission.clone();
        tokio::spawn(async move {
            run_detached_ibex_action_with_admission_and_counters(
                &state,
                first,
                HandlerInput::default(),
                crate::local::manual_action_metadata("test", "first"),
                admission,
                2,
                counters,
            )
            .await
        })
    };
    let second_run = {
        let state = state.clone();
        let admission = admission.clone();
        tokio::spawn(async move {
            run_detached_ibex_action_with_admission_and_counters(
                &state,
                second,
                HandlerInput::default(),
                crate::local::manual_action_metadata("test", "second"),
                admission,
                2,
                counters,
            )
            .await
        })
    };
    wait_for_dispatcher_permits(&admission, 0).await;
    tokio::time::timeout(Duration::from_secs(2), async {
        while counters.active.load(Ordering::SeqCst) < 2 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("both admitted actions enter their native VM workers");
    assert_eq!(
        counters.active.load(Ordering::SeqCst),
        2,
        "the injected N=2 ceiling must bound actual native workers"
    );

    for action in staged {
        let error = run_detached_ibex_action_with_admission_and_counters(
            &state,
            action,
            HandlerInput::default(),
            crate::local::manual_action_metadata("test", "rejected"),
            admission.clone(),
            2,
            counters,
        )
        .await
        .expect_err("work beyond the configured ceiling must fail closed");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_CAPACITY_EXCEEDED");
        assert_eq!(admission.available_permits(), 0);
    }
    assert!(
        counters.rejections.load(Ordering::SeqCst) == 8,
        "every rejected N+1 attempt must reach the exported overload metric"
    );

    first_run
        .await
        .expect("first task joins")
        .expect("first action");
    second_run
        .await
        .expect("second task joins")
        .expect("second action");
    assert_eq!(admission.available_permits(), 2);
    assert_eq!(counters.active.load(Ordering::SeqCst), 0);
}

#[test]
fn stuck_native_workers_retain_capacity_until_they_actually_exit() {
    let counters = isolated_worker_counters();
    let admission = Arc::new(Semaphore::new(2));
    let release = Arc::new((StdMutex::new(false), Condvar::new()));
    let mut workers = Vec::new();
    for _ in 0..2 {
        let permit = reserve_detached_action_worker_with_counters(admission.clone(), 2, counters)
            .expect("worker admitted below N");
        let release = release.clone();
        workers.push(
            spawn_detached_action_worker(
                permit,
                counters,
                move || {
                    let (released, wake) = &*release;
                    let mut released = released.lock().expect("release lock");
                    while !*released {
                        released = wake.wait(released).expect("release wait");
                    }
                },
                |()| (),
            )
            .expect("spawn blocking native worker"),
        );
    }
    while counters.active.load(Ordering::SeqCst) != 2 {
        std::thread::yield_now();
    }

    // Model the period after an outer watchdog has returned but a native
    // call cannot yet unwind. Admission remains exhausted throughout;
    // repeated callers fail rather than allocating additional OS threads.
    std::thread::sleep(Duration::from_millis(25));
    for _ in 0..8 {
        let error = reserve_detached_action_worker_with_counters(admission.clone(), 2, counters)
            .expect_err("N+1 stuck worker must be rejected");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_CAPACITY_EXCEEDED");
    }
    assert_eq!(admission.available_permits(), 0);
    assert_eq!(counters.active.load(Ordering::SeqCst), 2);
    assert_eq!(counters.rejections.load(Ordering::SeqCst), 8);

    let (released, wake) = &*release;
    *released.lock().expect("release lock") = true;
    wake.notify_all();
    for worker in workers {
        worker.join().expect("native worker exits after release");
    }
    assert_eq!(admission.available_permits(), 2);
    assert_eq!(counters.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn detached_ctx_push_send_durable_reservation_returns_without_admission_reentry() {
    let mut snapback = LocalSnapback::memory().expect("push deadlock regression state");
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    snapback
        .remainder_auth_fixture()
        .activate_catalog(keyring.as_ref(), super::now_millis(), &OsRandom)
        .expect("activate push deadlock auth catalog");
    let provider = Arc::new(
        AuthProvider::new(AuthProviderProfile::Test, keyring)
            .expect("construct push deadlock auth provider"),
    );
    let mut context = ServerContext::detached();
    context.profile = ServerProfile::Test;
    let state = activate_test_sessions(
        test_app_state_from_snapback(snapback, context)
            .with_policy_auth_mode(PolicyAuthMode::Sessions)
            .try_with_auth_provider(provider)
            .expect("install push deadlock auth provider"),
    );
    with_snapback(&state.snapback, |snapback| {
        snapback
            .remainder_auth_fixture()
            .activate_push_registry_for_test(crate::push::PushSeamDeclarationV1 {
                app_scope: crate::push::PushAppScopeV1 {
                    eas_project_id: "eas-deadlock-regression".into(),
                    application_id: "com.example.deadlock-regression".into(),
                    environment: "test".into(),
                },
                registry: crate::push::PushRegistryDeclarationV1 {
                    idle_retention_ms: 86_400_000,
                },
                audiences: BTreeMap::from([(
                    "empty".into(),
                    crate::push::PushAudienceDeclarationV1 {
                        resolve: crate::push::PushAudienceResolverV1::ExplicitPrincipals {
                            principals_arg: "principalIds".into(),
                            max_items: 1,
                        },
                        authorize: crate::push::PushAudienceAuthorizeV1::System,
                    },
                )]),
                uses: Vec::new(),
                ledger: Some(crate::push::PushLedgerDeclarationV1 {
                    retention_ms: 86_400_000,
                }),
            })?;
        let diagnostics = snapback.load_functions(generation_test_manifest());
        assert!(
            diagnostics.iter().all(|diagnostic| {
                diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error
            }),
            "push deadlock regression functions load: {diagnostics:?}"
        );
        Ok::<_, SnapbackError>(())
    })
    .await
    .expect("activate push seam and action");
    let staged = stage_held_action(&state.snapback);
    let mut host = held_action_host(state.snapback.clone(), &staged);
    let unregistered_principal =
        crate::ids::mint(crate::ids::Kind::User).expect("unregistered push principal");
    let request = crate::push::PushSendRequestV1 {
        to: crate::contract_types::PushAudienceReferenceV1 {
            audience: "empty".into(),
            args: Map::from_iter([("principalIds".into(), json!([unregistered_principal]))]),
        },
        title: "deadlock regression".into(),
        body: "no targets".into(),
        data: None,
        dedupe_key: "deadlock-regression".into(),
        redrive_ambiguous: false,
    };

    // Run the synchronous host call on a plain thread. Before the fix it
    // blocks forever while re-entering the admission mutex; dropping the
    // JoinHandle after the bounded assertion lets the failing test exit.
    let (result_tx, result_rx) = tokio::sync::oneshot::channel();
    let worker = std::thread::spawn(move || {
        let _ = result_tx.send(host.push_send(request));
    });
    let response = tokio::time::timeout(Duration::from_secs(2), result_rx)
        .await
        .expect("ctx.push.send must return within 2s without admission re-entry deadlock")
        .expect("ctx.push.send worker must report its result")
        .expect("zero-target push reservation");
    worker.join().expect("ctx.push.send worker exits");
    assert_eq!(response.target_count, 0);
    assert_eq!(response.batch_count, 0);
}

#[tokio::test]
async fn watch_reaction_ctx_push_send_without_caller_publication_commits() {
    let state = sessions_activation_server_fixture_with_integrations_async().await;
    let credential = mint_test_credential(&state, "watch-reaction-push@example.test").await;
    let watch_owner = credential["session"]["userId"]
        .as_str()
        .expect("watch-reaction push owner principal")
        .to_owned();
    let watch_authority_instance_id = credential["session"]["id"]
        .as_str()
        .expect("watch-reaction push owner authority instance")
        .to_owned();
    let watch_id = crate::ids::mint_time_ordered(crate::ids::Kind::Watch);
    let principal = with_snapback(&state.snapback, {
        let watch_owner = watch_owner.clone();
        let watch_authority_instance_id = watch_authority_instance_id.clone();
        let watch_id = watch_id.clone();
        move |snapback| {
            let declaration = immediate_push_declaration();
            let mut database = snapback.remainder_auth_fixture();
            database.activate_push_registry_for_test(declaration.clone())?;
            let mut schema = database.schema().clone();
            schema.push_seam = Some(declaration);
            schema.tables.push(TableManifest {
                name: "app_members".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "principal".to_owned(),
                        field_type: FieldType::Principal,
                        optional: false,
                    },
                    FieldManifest {
                        name: "role".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: Some(crate::manifest::MembershipManifest {
                    id: Some("app_members".to_owned()),
                    principal: "principal".to_owned(),
                    resource: None,
                    role: "role".to_owned(),
                    roles: vec!["sender".to_owned()],
                    pending_roles: None,
                    bootstrap_role: None,
                    last_holder: None,
                    expiry: None,
                    incidental: None,
                    provenance: None,
                    transitions: Vec::new(),
                    principal_addressed_writes: None,
                    scope: crate::manifest::MembershipScope::App,
                    resource_table: None,
                }),
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            });
            database
                .push_registry()
                .install_immediate_sender_for_test(schema, &watch_owner)?;
            let now_ms = super::now_millis();
            database.create_watch(crate::storage::watches::CreateWatchRecord {
                id: watch_id.clone(),
                owner_kind: crate::watches::WatchOwnerKind::User,
                owner_principal_id: watch_owner,
                owner_authority_instance_id: watch_authority_instance_id,
                authority_mode: crate::watches::WatchAuthorityMode::RevalidatePrincipal,
                anchor_grant_id: None,
                installation_grant_id: None,
                anchor_effective_user_id: None,
                anchor_scopes: Vec::new(),
                anchor_expires_at_ms: 0,
                query_function_id: "watch-reaction-push-query".to_owned(),
                query_function_name: "liveItems".to_owned(),
                query_basis: 1,
                query_args_json: "{}".to_owned(),
                query_args_digest: "watch-reaction-push-query-args".to_owned(),
                read_dependencies: Vec::new(),
                predicate_json: "{\"path\":\"/rows\",\"op\":\"exists\"}".to_owned(),
                reaction_kind: crate::watches::WatchReactionKind::Function,
                reaction_function_id: "watch-reaction-push-reaction".to_owned(),
                reaction_function_name: "heldAction".to_owned(),
                reaction_function_kind: crate::watches::WatchFunctionKind::Action,
                reaction_basis: 1,
                reaction_args_json: "{}".to_owned(),
                reaction_args_digest: "watch-reaction-push-reaction-args".to_owned(),
                webhook_url: None,
                webhook_secret_ref: None,
                daily_firing_budget: crate::watches::DEFAULT_DAILY_FIRING_BUDGET,
                debounce_ms: crate::watches::DEFAULT_DEBOUNCE_MS,
                initial_predicate_state: false,
                now_ms,
            })?;
            let principal = database
                .revalidate_watch_principal(&watch_id)?
                .expect("active protected watch owner revalidates");
            let mut manifest = generation_test_manifest();
            manifest.functions.push(FunctionDefinition::new(
                "listItems",
                FunctionKind::Query,
                FunctionRuntime::IbexModule(IbexModule {
                    source: "globalThis.__snapbackHandlers = { async listItems() { return []; } };"
                        .to_owned(),
                    export: "listItems".to_owned(),
                }),
            ));
            manifest.functions.push(FunctionDefinition::new(
                "liveItems",
                FunctionKind::LiveQuery,
                FunctionRuntime::IbexModule(IbexModule {
                    source: "globalThis.__snapbackHandlers = { async liveItems() { return []; } };"
                        .to_owned(),
                    export: "liveItems".to_owned(),
                }),
            ));
            for function in &mut manifest.functions {
                function.api_exposure = Some(ApiFunctionExposure::default());
            }
            for function in manifest
                .functions
                .iter_mut()
                .filter(|function| matches!(function.name.as_str(), "listItems" | "liveItems"))
            {
                function.api_exposure = Some(ApiFunctionExposure {
                    expose: true,
                    since: None,
                    approval: None,
                });
            }
            let diagnostics = snapback.load_functions(manifest);
            assert!(
                diagnostics.iter().all(|diagnostic| {
                    diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error
                }),
                "watch-reaction push functions load: {diagnostics:?}"
            );
            Ok::<_, SnapbackError>(principal)
        }
    })
    .await
    .expect("activate watch-reaction push seam and action");

    let foreign_database =
        crate::storage::LocalDatabase::memory().expect("open foreign watch-principal database");
    let foreign_admission =
        crate::auth::admission::AdmissionController::from_mode_state_with_database_binding(
            &state.auth_mode_state(),
            foreign_database.binding(),
        )
        .expect("build foreign watch-principal admission graph")
        .admit_for_mode(state.auth_mode_state().active)
        .expect("admit foreign watch-principal graph");
    let mismatch = InvocationGate::prepare_admitted_revalidated_principal(
        InvocationSource::WatchReaction,
        state.server.profile,
        foreign_admission,
        principal.clone(),
    )
    .expect_err("a protected-catalog principal cannot move to another database graph");
    assert_eq!(mismatch.diagnostic.code, "SNAPBACK_AUTH_POLICY_UNAVAILABLE");

    let staged = stage_held_action(&state.snapback);
    let mut host = held_action_host(state.snapback.clone(), &staged);
    host.authority = InvocationGate::prepare_admitted_revalidated_principal(
        InvocationSource::WatchReaction,
        state.server.profile,
        test_route_admission(&state).0,
        principal,
    )
    .expect("prepare credential-free watch-reaction authority");
    assert!(
        !host.authority.has_fenced_publication(),
        "watch reactions must not synthesize a caller publication"
    );
    let unregistered_principal = crate::ids::mint(crate::ids::Kind::User)
        .expect("unregistered watch-reaction push principal");
    let response = host
        .push_send(crate::push::PushSendRequestV1 {
            to: crate::contract_types::PushAudienceReferenceV1 {
                audience: "selectedMembers".into(),
                args: Map::from_iter([("principalIds".into(), json!([unregistered_principal]))]),
            },
            title: "watch reaction".into(),
            body: "credential-free send still commits".into(),
            data: None,
            dedupe_key: "watch-reaction-credential-free".into(),
            redrive_ambiguous: false,
        })
        .expect("credential-free watch-reaction ctx.push.send commits");
    assert_eq!(response.target_count, 0);
    assert_eq!(response.batch_count, 0);
    let intent_id = response.intent_id.clone();
    let durable_state = with_snapback(&state.snapback, move |snapback| {
        snapback.push_intent_state(&intent_id)
    })
    .await
    .expect("watch-reaction push intent is durably readable after send");
    assert_eq!(durable_state, response.state);
}

#[tokio::test]
async fn llp0163_managed_host_action_retries_reuse_one_host_child_envelope() {
    let mut snapback = LocalSnapback::memory().expect("managed host identity state");
    let app_id = "operation-carrier-fixture";
    let inputs_hash = "sha256:carrier-inputs";
    snapback
        .apply_schema(SchemaManifest {
            app_id: app_id.to_owned(),
            schema_hash: Some("sha256:carrier-schema".to_owned()),
            inputs_hash: Some(inputs_hash.to_owned()),
            tables: vec![TableManifest {
                name: "items".to_owned(),
                fields: vec![FieldManifest {
                    name: "value".to_owned(),
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
        })
        .expect("apply managed host identity schema");
    let mut values = BTreeMap::new();
    values.insert("value".to_owned(), ValueExpr::Literal(json!("carrier")));
    let mut insert = FunctionDefinition::new(
        "insertCarrier",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Insert {
                table: "items".to_owned(),
                values,
                bind_id_as: None,
            }],
            return_value: Some(ReturnValue::ChangedCount),
        })),
    );
    insert.write_set_summary.tables = vec!["items".to_owned()];
    let mut action = FunctionDefinition::new(
        "carrierAction",
        FunctionKind::Action,
        FunctionRuntime::HostPlan(HandlerPlan::Action(ActionPlan {
            steps: vec![ActionStep::RunMutation {
                name: "insertCarrier".to_owned(),
                args: BTreeMap::new(),
                bind_result_as: None,
            }],
            return_value: Some(ActionReturnValue::ChangedCount),
        })),
    );
    action.write_set_summary.tables = vec!["items".to_owned()];
    let diagnostics = snapback.load_functions(FunctionManifest {
        app_id: app_id.to_owned(),
        bundle_hash: Some("sha256:carrier-functions".to_owned()),
        inputs_hash: Some(inputs_hash.to_owned()),
        functions: vec![insert, action],
        ..FunctionManifest::default()
    });
    assert!(
        diagnostics.iter().all(|diagnostic| {
            diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error
        }),
        "managed host identity functions load: {diagnostics:?}"
    );
    snapback
        .remainder_auth_fixture()
        .install_operation_coverage_for_test(
            vec![crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1.to_owned()],
            crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1
                .iter()
                .map(|writer| (*writer).to_owned())
                .collect(),
        )
        .expect("activate test-only host child coverage");

    let prepared = |snapback: &mut LocalSnapback| match snapback
        .stage_cron_action_invocation("carrierAction")
        .expect("stage production managed action")
    {
        StagedAction::HostPlan(prepared) => prepared,
        StagedAction::Detached(_) => panic!("HostPlan action must use managed runner"),
    };
    let first_prepared = prepared(&mut snapback);
    let second_prepared = prepared(&mut snapback);
    let mut first_metadata = crate::local::manual_action_metadata("test", "carrierAction");
    first_metadata.run_id = "carrier-run-1".to_owned();
    first_metadata.attempt = 1;
    let mut retry_metadata = first_metadata.clone();
    retry_metadata.run_id = "carrier-run-2".to_owned();
    retry_metadata.attempt = 2;
    let state = Arc::new(Mutex::new(snapback));

    let first = super::run_managed_host_plan_action(
        &state,
        "carrierAction".to_owned(),
        HandlerInput::default(),
        first_metadata,
        first_prepared,
    )
    .await
    .expect("first managed action attempt");
    let retry = super::run_managed_host_plan_action(
        &state,
        "carrierAction".to_owned(),
        HandlerInput::default(),
        retry_metadata,
        second_prepared,
    )
    .await
    .expect("managed action retry replays committed child");
    assert_eq!(first, retry);

    let mut snapback = state.lock().await;
    assert_eq!(
        snapback
            .remainder_auth_fixture()
            .query_reads_read()
            .scan_table("items", 10, 0)
            .expect("scan carrier rows")
            .total,
        1,
        "attempt-local run ids must not duplicate a committed child"
    );
    let envelopes = snapback
        .remainder_auth_fixture()
        .settlement_read()
        .operation_envelopes_for_test()
        .expect("load retained host envelopes");
    assert_eq!(envelopes.len(), 1);
    let envelope = &envelopes[0];
    assert_eq!(
        envelope.identity.key.originator_class,
        crate::commit_envelope::OperationOriginatorClassV1::Host
    );
    assert_eq!(
        envelope.coverage.covered_lanes,
        vec![crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1.to_owned()]
    );
    let crate::commit_envelope::OperationIssuanceV1::HostIncarnation {
        upstream_identity,
        commit_ordinal,
        ..
    } = &envelope.identity.issuance
    else {
        panic!("managed action child must retain host-incarnation issuance");
    };
    assert!(upstream_identity.starts_with("host-parent:sha256:"));
    assert_eq!(*commit_ordinal, 0);
}

#[test]
fn llp0163_host_child_inventory_routes_both_server_action_runtime_tiers() {
    assert_eq!(
        crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1,
        [
            "LocalDatabase::execute_host_mutation_guarded_with_settlement_time",
            "LocalDatabase::commit_buffered_host_writes_guarded",
        ]
    );

    let server = include_str!("../../server.rs");
    let start = server
        .find("impl IbexActionHost for DetachedActionHost")
        .expect("production action host remains present");
    let end = server[start..]
        .find("\n    fn open_response_stream")
        .expect("runMutation inventory boundary");
    let run_mutation = &server[start..start + end];
    let identity = run_mutation
        .find("covered_host_child_identity")
        .expect("action host derives one covered child identity");
    let host_plan = run_mutation
        .find("invoke_host_plan_mutation_guarded")
        .expect("HostPlan production adapter remains inventoried");
    let buffered = run_mutation
        .find("commit_detached_ibex_mutation_guarded")
        .expect("detached Ibex production adapter remains inventoried");
    assert!(identity < host_plan && identity < buffered);
}

#[test]
fn snapshot_nested_mutation_observation_covers_handler_through_commit() {
    let mut snapback = LocalSnapback::memory().expect("snapshot nested telemetry state");
    let diagnostics = snapback.load_functions(generation_test_manifest());
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error),
        "snapshot nested telemetry functions load: {diagnostics:?}"
    );
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let telemetry = staged.telemetry.clone();
    let mut host = held_action_host(state, &staged);

    host.run_mutation(
        "snapshotNestedSuccess",
        HandlerInput {
            correlation: Some(json!("snapshot-success")),
            ..HandlerInput::default()
        },
    )
    .expect("snapshot nested mutation commits");
    let error = host
        .run_mutation(
            "snapshotNestedCommitFailure",
            HandlerInput {
                correlation: Some(json!("snapshot-failure")),
                ..HandlerInput::default()
            },
        )
        .expect_err("post-handler preview rejects unknown table");
    assert_eq!(error.diagnostic.code, "SNAPBACK_UNKNOWN_TABLE");
    let handler_error = host
        .run_mutation(
            "snapshotNestedHandlerFailure",
            HandlerInput {
                correlation: Some(json!("snapshot-handler-failure")),
                ..HandlerInput::default()
            },
        )
        .expect_err("nested handler throw fails");
    assert_eq!(handler_error.diagnostic.code, "SNAPBACK_HANDLER_FAILED");
    assert!(
        handler_error.private_failure_context().is_none(),
        "the detached server observation consumes its private carrier"
    );

    telemetry
        .force_flush()
        .expect("flush snapshot nested observations");
    assert_eq!(
        telemetry.event_outcomes_for_test("function_run", "snapshotNestedSuccess", "joined"),
        vec![(Some(200), None)],
    );
    assert_eq!(
        telemetry.event_outcomes_for_test("function_run", "snapshotNestedCommitFailure", "joined"),
        vec![(Some(500), Some("SNAPBACK_UNKNOWN_TABLE".to_owned()))],
        "the post-handler refusal replaces, rather than follows, a false success"
    );
    let handler_details = telemetry
        .event_details_for_test("function_run", "snapshotNestedHandlerFailure")
        .into_iter()
        .flatten()
        .next()
        .expect("classified handler failure details");
    assert_eq!(handler_details["failure_disposition"], "fault");
    assert_eq!(handler_details["issue_eligible"], true);
    assert_eq!(handler_details["fp_branch"], "exception");
    assert_eq!(handler_details["errorClass"], "TypeError");
    assert_eq!(
        handler_details["messageTemplate"],
        "nested value <digits> failed"
    );
    assert!(handler_details["fp_hash"].as_str().is_some());
    assert_eq!(telemetry.event_count_for_test("log", "log", "point"), 2);
}

#[test]
fn bounded_action_stream_pulls_multiple_chunks_and_closes_idempotently() {
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").expect("bind deterministic stream fixture");
    let address = listener.local_addr().expect("stream fixture address");
    let upstream = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept stream request");
        socket
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("bound request read");
        let mut request = [0_u8; 2_048];
        let _ =
            std::io::Read::read(&mut socket, &mut request).expect("read stream request headers");
        socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                )
                .expect("write stream response headers");
        socket.flush().expect("flush response headers");
        for index in 0..16 {
            let chunk = format!("chunk-{index:02}\n");
            write!(socket, "{:X}\r\n{}\r\n", chunk.len(), chunk)
                .expect("write deterministic stream chunk");
            socket.flush().expect("flush deterministic stream chunk");
            std::thread::sleep(Duration::from_millis(60));
        }
        socket
            .write_all(b"0\r\n\r\n")
            .expect("finish deterministic stream");
    });

    let mut snapback = LocalSnapback::memory().expect("stream host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    host.deadline = Instant::now() + Duration::from_secs(10);
    let opened = host
        .open_response_stream(ActionStreamRequest {
            url: format!("http://{address}/sixteen-chunks"),
            method: "GET".to_owned(),
            headers: BTreeMap::new(),
            body: None,
            idempotency_key: None,
            attempt_token: None,
            secret_slots: Vec::new(),
        })
        .expect("open bounded response stream");
    assert_eq!(opened.status, 200);

    let mut received = Vec::new();
    let mut progress_reads = 0;
    loop {
        let chunk = host
            .read_response_stream(&opened.stream_id)
            .expect("pull bounded response chunk");
        if chunk.done {
            break;
        }
        progress_reads += 1;
        received.extend_from_slice(&chunk.bytes);
    }
    let expected = (0..16)
        .map(|index| format!("chunk-{index:02}\n"))
        .collect::<String>();
    assert_eq!(received, expected.as_bytes());
    assert!(
        progress_reads >= 3,
        "pull-driven fixture must expose multiple intermediate reads, got {progress_reads}"
    );
    host.cancel_response_stream(&opened.stream_id)
        .expect("cancel after EOF is idempotent");
    host.cancel_response_stream(&opened.stream_id)
        .expect("repeat cancel after EOF is idempotent");
    upstream.join().expect("stream fixture joins");

    let secret_path = "never-log-this-private-prompt";
    let error = host
        .open_response_stream(ActionStreamRequest {
            url: format!("file:///{secret_path}"),
            method: "GET".to_owned(),
            headers: BTreeMap::new(),
            body: None,
            idempotency_key: None,
            attempt_token: None,
            secret_slots: Vec::new(),
        })
        .expect_err("non-http stream URL fails closed");
    assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_STREAM_INVALID");
    assert!(
        !serde_json::to_string(&error)
            .expect("serialize stream diagnostic")
            .contains(secret_path),
        "stream diagnostics must not retain URL path data"
    );
}

#[test]
fn both_action_fetch_lanes_refuse_non_public_destinations() {
    let mut snapback = LocalSnapback::memory().expect("destination-policy host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    host.deadline = Instant::now() + Duration::from_secs(10);

    for url in [
        "https://localhost/private",
        "https://metadata.google.internal/latest/meta-data",
        "https://169.254.169.254/latest/meta-data",
        "https://10.0.0.1/private",
        "https://[fe80::a9fe:a9fe]/latest/meta-data",
    ] {
        let buffered = host
            .host_fetch(HostFetchRequest {
                url: url.to_owned(),
                method: "GET".to_owned(),
                headers: BTreeMap::new(),
                body: None,
                timeout_ms: Some(100),
                secret_slots: Vec::new(),
            })
            .expect_err("buffered fetch must refuse non-public destination");
        assert_eq!(
            buffered.diagnostic.code, "SNAPBACK_HOST_FETCH_SSRF_REFUSED",
            "buffered destination: {url}"
        );

        let streamed = host
            .open_response_stream(ActionStreamRequest {
                url: url.to_owned(),
                method: "GET".to_owned(),
                headers: BTreeMap::new(),
                body: None,
                idempotency_key: None,
                attempt_token: None,
                secret_slots: Vec::new(),
            })
            .expect_err("streamed fetch must refuse non-public destination");
        assert_eq!(
            streamed.diagnostic.code, "SNAPBACK_ACTION_STREAM_SSRF_REFUSED",
            "streamed destination: {url}"
        );
        let serialized = serde_json::to_string(&streamed).expect("serialize stream refusal");
        assert!(
            !serialized.contains(url),
            "stream refusal must not echo the authored URL"
        );
    }
}

#[test]
fn both_action_fetch_lanes_refuse_authority_and_hop_by_hop_headers_before_send() {
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").expect("bind no-send action-header witness");
    listener
        .set_nonblocking(true)
        .expect("make no-send witness nonblocking");
    let authored_url = format!("http://{}/must-not-receive", listener.local_addr().unwrap());

    let mut snapback = LocalSnapback::memory().expect("header-policy host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    host.deadline = Instant::now() + Duration::from_secs(10);

    for name in [
        "Host",
        ":AUTHORITY",
        "Transfer-Encoding",
        "content-length",
        "Connection",
        "KEEP-ALIVE",
        "upgrade",
        "TE",
        "Trailer",
        "Proxy-Authorization",
        "X-Forwarded-For",
        "x-forwarded-host",
        "Forwarded",
    ] {
        let headers = BTreeMap::from([(name.to_owned(), "handler-value".to_owned())]);
        let buffered = host
            .host_fetch(HostFetchRequest {
                url: authored_url.clone(),
                method: "GET".to_owned(),
                headers: headers.clone(),
                body: None,
                timeout_ms: Some(100),
                secret_slots: Vec::new(),
            })
            .expect_err("buffered forbidden header must fail before send");
        assert_eq!(
            buffered.diagnostic.code, "SNAPBACK_HOST_FETCH_INVALID",
            "{name}"
        );

        let streamed = host
            .open_response_stream(ActionStreamRequest {
                url: authored_url.clone(),
                method: "GET".to_owned(),
                headers,
                body: None,
                idempotency_key: None,
                attempt_token: None,
                secret_slots: Vec::new(),
            })
            .expect_err("streamed forbidden header must fail before send");
        assert_eq!(
            streamed.diagnostic.code, "SNAPBACK_ACTION_STREAM_INVALID",
            "{name}"
        );
    }

    assert!(
        matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock),
        "a forbidden handler header must never reach the upstream listener"
    );
}

#[test]
fn both_action_fetch_lanes_forward_ordinary_end_to_end_headers() {
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").expect("bind ordinary-header fixture");
    let address = listener.local_addr().expect("ordinary-header address");
    let upstream = std::thread::spawn(move || {
        let mut captured = Vec::new();
        for _ in 0..2 {
            let (mut socket, _) = listener.accept().expect("accept ordinary-header request");
            let mut request = [0_u8; 4_096];
            let read = std::io::Read::read(&mut socket, &mut request)
                .expect("read ordinary-header request");
            captured.push(String::from_utf8_lossy(&request[..read]).to_ascii_lowercase());
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .expect("write ordinary-header response");
        }
        captured
    });

    let mut snapback = LocalSnapback::memory().expect("ordinary-header host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    host.deadline = Instant::now() + Duration::from_secs(10);
    let headers = BTreeMap::from([
        (
            "Authorization".to_owned(),
            "Bearer ordinary-token".to_owned(),
        ),
        ("Accept".to_owned(), "application/json".to_owned()),
        ("X-Custom-Request".to_owned(), "custom-value".to_owned()),
    ]);
    let authored_url = format!("http://{address}/ordinary");

    host.host_fetch(HostFetchRequest {
        url: authored_url.clone(),
        method: "GET".to_owned(),
        headers: headers.clone(),
        body: None,
        timeout_ms: Some(2_000),
        secret_slots: Vec::new(),
    })
    .expect("buffered ordinary headers pass");
    let streamed = host
        .open_response_stream(ActionStreamRequest {
            url: authored_url,
            method: "GET".to_owned(),
            headers,
            body: None,
            idempotency_key: None,
            attempt_token: None,
            secret_slots: Vec::new(),
        })
        .expect("streamed ordinary headers pass");
    host.cancel_response_stream(&streamed.stream_id)
        .expect("close ordinary-header stream");

    for request in upstream.join().expect("ordinary-header fixture joins") {
        assert!(request.contains("authorization: bearer ordinary-token\r\n"));
        assert!(request.contains("accept: application/json\r\n"));
        assert!(request.contains("x-custom-request: custom-value\r\n"));
    }
}

#[test]
fn both_action_fetch_lanes_refuse_redirects_and_echo_the_authored_url() {
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").expect("bind action redirect fixture");
    let address = listener.local_addr().expect("action redirect address");
    let upstream = std::thread::spawn(move || {
        for _ in 0..2 {
            let (mut socket, _) = listener.accept().expect("accept action redirect request");
            let mut request = [0_u8; 2_048];
            let _ = std::io::Read::read(&mut socket, &mut request)
                .expect("read action redirect request");
            socket
                .write_all(
                    b"HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .expect("write action redirect response");
        }
    });
    let authored_url = format!("http://{address}/authored");

    let mut snapback = LocalSnapback::memory().expect("redirect-policy host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    host.deadline = Instant::now() + Duration::from_secs(10);

    let buffered = host
        .host_fetch(HostFetchRequest {
            url: authored_url.clone(),
            method: "GET".to_owned(),
            headers: BTreeMap::new(),
            body: None,
            timeout_ms: Some(2_000),
            secret_slots: Vec::new(),
        })
        .expect("buffered redirect is returned to the handler");
    assert_eq!(buffered.status, 302);
    assert_eq!(buffered.url, authored_url);

    let streamed = host
        .open_response_stream(ActionStreamRequest {
            url: authored_url.clone(),
            method: "GET".to_owned(),
            headers: BTreeMap::new(),
            body: None,
            idempotency_key: None,
            attempt_token: None,
            secret_slots: Vec::new(),
        })
        .expect("stream redirect is returned to the handler");
    assert_eq!(streamed.status, 302);
    assert_eq!(streamed.url, authored_url);
    host.cancel_response_stream(&streamed.stream_id)
        .expect("close redirect response stream");
    upstream.join().expect("action redirect fixture joins");
}

#[test]
fn bounded_action_stream_refuses_the_first_byte_past_the_total_limit() {
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").expect("bind oversized stream fixture");
    let address = listener.local_addr().expect("oversized stream address");
    let upstream = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept oversized request");
        let mut request = [0_u8; 2_048];
        let _ = std::io::Read::read(&mut socket, &mut request);
        let response_bytes = super::ACTION_STREAM_TOTAL_BYTES_MAX + 1;
        write!(
            socket,
            "HTTP/1.1 200 OK\r\nContent-Length: {response_bytes}\r\nConnection: close\r\n\r\n"
        )
        .expect("write oversized response headers");
        let block = vec![b'x'; 64 * 1024];
        let mut remaining = response_bytes;
        while remaining > 0 {
            let visible =
                usize::try_from(remaining.min(block.len() as u64)).expect("bounded write size");
            if socket.write_all(&block[..visible]).is_err() {
                break;
            }
            remaining -= visible as u64;
        }
    });

    let mut snapback = LocalSnapback::memory().expect("oversized stream host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    host.deadline = Instant::now() + Duration::from_secs(10);
    let opened = host
        .open_response_stream(ActionStreamRequest {
            url: format!("http://{address}/one-byte-too-many"),
            method: "GET".to_owned(),
            headers: BTreeMap::new(),
            body: None,
            idempotency_key: None,
            attempt_token: None,
            secret_slots: Vec::new(),
        })
        .expect("open oversized response stream");

    let mut delivered = 0_u64;
    let refusal = loop {
        match host.read_response_stream(&opened.stream_id) {
            Ok(chunk) if !chunk.done => delivered += chunk.bytes.len() as u64,
            Ok(_) => panic!("oversized response reached EOF without a typed refusal"),
            Err(error) => break error,
        }
    };
    assert_eq!(delivered, super::ACTION_STREAM_TOTAL_BYTES_MAX);
    assert_eq!(
        refusal.diagnostic.code,
        "SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED"
    );
    host.cancel_response_stream(&opened.stream_id)
        .expect("cancel after limit refusal is idempotent");
    upstream.join().expect("oversized stream fixture joins");
}

#[test]
fn bounded_action_stream_enforces_wall_idle_and_progress_rate_codes() {
    let mut snapback = LocalSnapback::memory().expect("bounded stream limit host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    host.deadline = Instant::now() + Duration::from_secs(60);

    let stream_fixture =
        |host: &DetachedActionHost, wall_deadline: Instant, last_byte_at: Instant| {
            let (pull_tx, chunk_rx) = super::spawn_stream_reader_thread(
                Box::new(std::io::Cursor::new(vec![b'x'])),
                host.stream_buffered_bytes.clone(),
                host.stream_buffered_peak.clone(),
            );
            super::OpenActionResponseStream {
                pull_tx,
                chunk_rx,
                opened_at: Instant::now(),
                wall_deadline,
                last_byte_at,
                total_bytes: 0,
            }
        };
    let wall_id = "wall-limit".to_owned();
    let expired_wall = Instant::now()
        .checked_sub(Duration::from_millis(1))
        .expect("wall fixture instant");
    let wall_stream = stream_fixture(&host, expired_wall, Instant::now());
    host.response_streams.insert(wall_id.clone(), wall_stream);
    assert_eq!(
        host.read_response_stream(&wall_id)
            .expect_err("wall limit refuses read")
            .diagnostic
            .code,
        "SNAPBACK_ACTION_STREAM_TIMEOUT"
    );

    let idle_id = "idle-limit".to_owned();
    let idle_last_byte = Instant::now()
        .checked_sub(Duration::from_millis(super::ACTION_STREAM_IDLE_MS + 1))
        .expect("idle fixture instant");
    let idle_stream = stream_fixture(
        &host,
        Instant::now() + Duration::from_millis(super::ACTION_STREAM_WALL_MS),
        idle_last_byte,
    );
    host.response_streams.insert(idle_id.clone(), idle_stream);
    assert_eq!(
        host.read_response_stream(&idle_id)
            .expect_err("idle limit refuses read")
            .diagnostic
            .code,
        "SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT"
    );

    let progress_stream = stream_fixture(
        &host,
        Instant::now() + Duration::from_millis(super::ACTION_STREAM_WALL_MS),
        Instant::now(),
    );
    host.response_streams
        .insert("progress-rate".to_owned(), progress_stream);
    host.last_stream_progress_commit = Some(Instant::now());
    assert_eq!(
        host.run_mutation("hostPlanWrite", HandlerInput::default())
            .expect_err("progress commits above ten per second fail closed")
            .diagnostic
            .code,
        "SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED"
    );
}

#[test]
fn descriptor_secret_slots_are_refused_on_the_value_mode_profile() {
    // @ref LLP 0036#runtime-exposure-d5-d8 — the local profile stages
    // secret values (with the staged-value redactor at the envelope), so
    // an opaque descriptor slot has nothing to resolve and must fail
    // closed instead of sending a request without its secret.
    let mut snapback = LocalSnapback::memory().expect("slot refusal host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    let refusal = host
        .open_response_stream(ActionStreamRequest {
            url: "https://api.example.test/v1/stream".to_owned(),
            method: "POST".to_owned(),
            headers: BTreeMap::new(),
            body: Some("{}".to_owned()),
            idempotency_key: None,
            attempt_token: None,
            secret_slots: vec![crate::runtime::StreamSecretSlot {
                placement: Some("header".to_owned()),
                name: Some("authorization".to_owned()),
                secret: Some(json!({ "capabilityId": "cap_1" })),
            }],
        })
        .expect_err("descriptor slots cannot resolve on the value-mode profile");
    assert_eq!(refusal.diagnostic.code, "SNAPBACK_ACTION_STREAM_INVALID");
    assert!(
        !serde_json::to_string(&refusal)
            .expect("serialize slot refusal")
            .contains("cap_1"),
        "the refusal must not echo descriptor contents"
    );
}

#[test]
fn automatically_retried_invocations_cannot_open_response_streams() {
    let mut snapback = LocalSnapback::memory().expect("retry exclusion host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    host.automatic_retry_invocation = true;
    let refusal = host
        .open_response_stream(ActionStreamRequest {
            url: "http://127.0.0.1:9/never".to_owned(),
            method: "GET".to_owned(),
            headers: BTreeMap::new(),
            body: None,
            idempotency_key: None,
            attempt_token: None,
            secret_slots: Vec::new(),
        })
        .expect_err("automatic retries are excluded from streamed actions");
    assert_eq!(refusal.diagnostic.code, "SNAPBACK_ACTION_STREAM_INVALID");
}

#[test]
fn stream_attempt_lease_fences_second_runner_progress_and_cursor_retry() {
    let mut snapback = LocalSnapback::memory().expect("lease host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut holder = held_action_host(state.clone(), &staged);
    let mut second = held_action_host(state, &staged);

    let started = holder
        .start_stream_attempt("lease-fence")
        .expect("first runner starts the attempt");
    assert!(started.lease_held);
    let joined = second
        .start_stream_attempt("lease-fence")
        .expect("second runner joins the attempt");
    assert_eq!(joined.attempt_token, started.attempt_token);
    assert!(!joined.lease_held, "a live holder keeps the lease");

    // The lease-less runner cannot commit progress at all.
    assert_eq!(
        second
            .run_mutation("hostPlanWrite", HandlerInput::default())
            .expect_err("a runner without the lease cannot commit")
            .diagnostic
            .code,
        "SNAPBACK_ACTION_STREAM_INVALID"
    );
    // The holder still can.
    holder
        .run_mutation("hostPlanWrite", HandlerInput::default())
        .expect("the lease holder commits progress");

    // Retry fencing: bind one cursor, commit progress, and a reopen under
    // the same attempt is refused.
    let holder_origin = holder.authority.stream_attempt_origin();
    holder_origin
        .stage_cursor_premark(
            crate::stream_attempt::global_stream_attempt_registry(),
            &started.attempt_token,
            "lease-cursor",
            &holder.stream_runner,
        )
        .expect("first upstream bind");
    holder
        .run_mutation("hostPlanWrite", HandlerInput::default())
        .expect("progress while the cursor is open");
    assert_eq!(
        holder_origin
            .stage_cursor_premark(
                crate::stream_attempt::global_stream_attempt_registry(),
                &started.attempt_token,
                "lease-cursor-2",
                &holder.stream_runner
            )
            .expect_err("retry after the first durable progress commit")
            .diagnostic
            .code,
        "SNAPBACK_ACTION_STREAM_INVALID"
    );

    // Authored settle under the lease wins; the second runner's settle
    // receives the committed winner verbatim.
    let winner = holder
        .settle_stream_attempt(
            &started.attempt_token,
            crate::stream_attempt::StreamAttemptCause::Cancelled,
        )
        .expect("authored settle");
    let observed = second
        .settle_stream_attempt(
            &started.attempt_token,
            crate::stream_attempt::StreamAttemptCause::Complete,
        )
        .expect("terminal attempt returns the winner");
    assert_eq!(observed, winner);
    assert_eq!(
        observed.cause,
        crate::stream_attempt::StreamAttemptCause::Cancelled
    );
    assert!(
        observed.effect_may_have_executed,
        "an in-flight cursor folds into the effect fact"
    );
}

#[test]
fn detached_host_provider_settlement_method_differs_from_authored_settlement() {
    let mut snapback = LocalSnapback::memory().expect("provider settlement host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);

    let provider = host
        .start_stream_attempt("r1-provider-complete")
        .expect("provider attempt starts");
    let provider_terminal = host
        .settle_provider_stream_attempt_host(
            &provider.attempt_token,
            crate::stream_attempt::StreamAttemptCause::Complete,
        )
        .expect("provider completes through the host-only entry");

    let authored = host
        .start_stream_attempt("r1-authored-complete")
        .expect("authored attempt starts");
    let authored_terminal = host
        .settle_stream_attempt(
            &authored.attempt_token,
            crate::stream_attempt::StreamAttemptCause::Complete,
        )
        .expect("authored completion uses the JS-facing entry");

    assert_eq!(
        provider_terminal.cause,
        crate::stream_attempt::StreamAttemptCause::Complete
    );
    assert_eq!(
        authored_terminal.cause,
        crate::stream_attempt::StreamAttemptCause::Complete
    );
    assert_eq!(
        provider_terminal.settled_by,
        crate::stream_attempt::StreamAttemptSettledBy::Terminalizer
    );
    assert_eq!(
        authored_terminal.settled_by,
        crate::stream_attempt::StreamAttemptSettledBy::Authored
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn t8_terminalization_after_abandonment_invokes_refusal_fallback_cas_and_flush() {
    for authority_latch_first in [false, true] {
        provider_settlement_abandonment_case(authority_latch_first).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn service_principal_terminalization_fences_stream_open_and_discards_late_bytes() {
    // @ref LLP 0076#authority-and-lifecycle — the ServicePrincipal tier
    // of the per-read fence, end to end: a REAL prepared scoped-token
    // authority (sessions-mode admission, HttpAction source, registered
    // service publication), a real terminal-gate commit racing a blocked
    // pull, and the late bytes discarded with the exact authority code.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind service fence fixture");
    let address = listener.local_addr().expect("service fence address");
    let upstream = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept service fence request");
        let mut request = [0_u8; 2_048];
        let _ = std::io::Read::read(&mut socket, &mut request);
        socket
            .write_all(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            )
            .expect("write headers");
        socket.write_all(b"7\r\nearly-1\r\n").expect("early chunk");
        socket.flush().expect("flush early chunk");
        // The late byte arrives only after the terminal gate below has
        // committed while the second pull is already blocked.
        std::thread::sleep(Duration::from_millis(900));
        let _ = socket.write_all(b"6\r\nlate-1\r\n0\r\n\r\n");
    });

    // Build the authority only through durable scoped-token resolution and
    // database-bound registration. The test must not rely on a detached
    // registry or a synthetic publication.
    let fixture =
        finite_authority_matrix_fixture_with_functions(finite_authority_held_action_functions())
            .await;
    let authority = prepared_test_service_route_authority(
        &fixture.state,
        InvocationSource::HttpAction,
        &fixture.token,
    )
    .await;
    let state = fixture.state.snapback.clone();
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state.clone(), &staged);
    host.deadline = Instant::now() + Duration::from_secs(10);
    host.authority = authority;
    let stream_runner_host = host.authority.stream_runner_host(host.abandoned.clone());
    host.commit_gate = stream_runner_host.runner().commit_gate();
    host.stream_runner = stream_runner_host.runner().clone();
    host.stream_runner_host = stream_runner_host;
    host.output_stream_function_id = Some("heldAction".to_owned());
    host.output_stream_initiator = Some(crate::stream_attempt::StreamInitiator::ServiceCredential(
        fixture.credential.clone(),
    ));
    host.initialize_output_stream()
        .expect("scoped-service streaming action opens its durable attempt");
    let attempt_token = host
        .output_stream_attempt
        .clone()
        .expect("output attempt token");
    let terminal_runtime = tokio::runtime::Handle::current();

    let (opened, discarded) = tokio::task::block_in_place(|| {
        let opened = host
            .open_response_stream(ActionStreamRequest {
                url: format!("http://{address}/service-fence"),
                method: "GET".to_owned(),
                headers: BTreeMap::new(),
                body: None,
                idempotency_key: None,
                attempt_token: None,
                secret_slots: Vec::new(),
            })
            .expect("open under live scoped-token authority");
        let first = host
            .read_response_stream(&opened.stream_id)
            .expect("first chunk under live authority");
        assert_eq!(first.bytes, b"early-1");

        // Terminalize the service authority 200 ms into the ~900 ms
        // stall, while the second pull is already blocked awaiting bytes.
        let terminal_state = state.clone();
        let terminal_token = fixture.token.clone();
        let terminal_now_ms = fixture.start_ms + 1;
        let (terminal_tx, terminal_rx) = std::sync::mpsc::sync_channel(1);
        terminal_runtime.spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            let result = async {
                let token_for_plan = crate::auth::crypto::ScopedToken::parse(&terminal_token)
                    .expect("parse service-fence terminal plan token");
                let plan = with_snapback(&terminal_state, move |snapback| {
                    snapback.plan_scoped_token_release(&token_for_plan)
                })
                .await
                .expect("plan exact scoped-token release");
                let gate = plan
                    .acquire_gate()
                    .await
                    .expect("close and drain service domain");
                let token = crate::auth::crypto::ScopedToken::parse(&terminal_token)
                    .expect("parse service-fence terminal token");
                with_snapback(&terminal_state, move |snapback| {
                    with_service_authority_terminal_gate(gate, || {
                        snapback.release_scoped_token(&token, terminal_now_ms)
                    })
                })
                .await
            }
            .await;
            terminal_tx
                .send(result)
                .expect("report service-fence terminal result");
        });
        let discarded = host
            .read_response_stream(&opened.stream_id)
            .expect_err("late bytes must be discarded after terminalization");
        terminal_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("terminal task completes")
            .expect("commit exact scoped-token release");
        (opened, discarded)
    });
    assert_eq!(
        discarded.diagnostic.code, "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
        "the exact durable terminal must reject late bytes with the typed carrier refusal"
    );
    assert!(
        host.closed_response_streams.contains(&opened.stream_id),
        "the fail-closed read must discard late bytes and close the cursor"
    );

    // The next cut remains typed and latched for stream settlement.
    let refused = tokio::task::block_in_place(|| {
        host.open_response_stream(ActionStreamRequest {
            url: format!("http://{address}/service-fence-2"),
            method: "GET".to_owned(),
            headers: BTreeMap::new(),
            body: None,
            idempotency_key: None,
            attempt_token: None,
            secret_slots: Vec::new(),
        })
        .expect_err("terminalized authority cannot open a stream")
    });
    assert_eq!(
        refused.diagnostic.code,
        "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID"
    );
    assert!(
        matches!(
            host.terminal_latch.cause(),
            Some(crate::local::ActionTerminalCause::CallerAuthority(
                crate::auth::invocation::CallerAuthorityTerminalCause::ScopedServiceRetired {
                    disposition: ServiceAuthorityDisposition::Carrier,
                    ..
                }
            ))
        ),
        "the real per-read service fence must latch its typed caller subtype"
    );

    // Exercise the same provider-settlement/fallback sequence as the worker.
    // The typed scoped-service latch must survive both layers as `cancelled`;
    // a subtype-specific mapping that recognizes only admission retirement is
    // intentionally insufficient.
    let terminal_cause = super::detached_action_stream_terminal_cause(
        &Err(discarded.clone()),
        true,
        &host.terminal_latch,
    );
    assert_eq!(
        terminal_cause,
        crate::stream_attempt::StreamAttemptCause::Cancelled
    );
    let provider_refusal = host
        .settle_provider_stream_attempt_host(&attempt_token, terminal_cause)
        .expect_err("the latched authority loss refuses the ordinary provider settle");
    assert_eq!(
        provider_refusal.diagnostic.code,
        "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID"
    );
    let registry = crate::stream_attempt::global_stream_attempt_registry();
    let terminalized =
        registry.terminalize_invocation_host(&host.stream_runner_host, terminal_cause);
    assert_eq!(terminalized.len(), 1, "the trusted fallback wins once");
    host.flush_stream_attempts_trusted();
    let terminal = registry
        .terminal(&attempt_token)
        .expect("scoped-service output attempt has a durable winner");
    assert_eq!(
        terminal.cause,
        crate::stream_attempt::StreamAttemptCause::Cancelled
    );
    assert_eq!(
        terminal.settled_by,
        crate::stream_attempt::StreamAttemptSettledBy::Terminalizer
    );

    registry.release_invocation(&host.stream_runner);
    upstream.join().expect("service fence fixture joins");
}

#[tokio::test]
async fn scoped_service_retirement_eventually_latches_cancelled_before_child_commit() {
    // This fixture proves eventual pre-commit terminal latching after scoped-
    // service retirement, not which observer latches the cause. The current
    // staging observer and the later reserve_nested_effect cut can detect the
    // same retirement. Its operation-coverage lane returns Ok(None), so
    // covered_host_child_identity_classified is not reached. The scoped
    // service retires after output initialization and no assertion here pins
    // the classified staging observer, whose coverage remains inspection-only.
    let functions = finite_authority_held_action_functions();
    let fixture = finite_authority_matrix_fixture_with_functions(functions).await;
    let authority = prepared_test_service_route_authority(
        &fixture.state,
        InvocationSource::HttpAction,
        &fixture.token,
    )
    .await;
    let state = fixture.state.snapback.clone();
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state.clone(), &staged);
    host.authority = authority;
    let stream_runner_host = host.authority.stream_runner_host(host.abandoned.clone());
    host.commit_gate = stream_runner_host.runner().commit_gate();
    host.stream_runner = stream_runner_host.runner().clone();
    host.stream_runner_host = stream_runner_host;
    host.output_stream_function_id = Some("heldAction".to_owned());
    host.output_stream_initiator = Some(crate::stream_attempt::StreamInitiator::ServiceCredential(
        fixture.credential.clone(),
    ));
    host.initialize_output_stream()
        .expect("pre-reservation action initializes its durable output attempt");
    let attempt_token = host
        .output_stream_attempt
        .clone()
        .expect("pre-reservation output attempt token");

    let token_for_plan = crate::auth::crypto::ScopedToken::parse(&fixture.token)
        .expect("parse pre-reservation plan token");
    let plan = with_snapback(&state, move |snapback| {
        snapback.plan_scoped_token_release(&token_for_plan)
    })
    .await
    .expect("plan exact pre-reservation scoped-token release");
    let gate = plan
        .acquire_gate()
        .await
        .expect("close and drain pre-reservation service domain");
    let token = crate::auth::crypto::ScopedToken::parse(&fixture.token)
        .expect("parse pre-reservation terminal token");
    with_snapback(&state, move |snapback| {
        with_service_authority_terminal_gate(gate, || {
            snapback.release_scoped_token(&token, fixture.start_ms + 1)
        })
    })
    .await
    .expect("commit pre-reservation service terminal");

    let refused = host
        .run_mutation(
            "queuedWrite",
            HandlerInput {
                args: json!({ "value": "must-not-commit-after-service-retirement" }),
                ..HandlerInput::default()
            },
        )
        .expect_err("pre-reservation staging observes retired scoped service");
    assert_eq!(
        refused.diagnostic.code,
        "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID"
    );
    assert!(matches!(
        host.terminal_latch.cause(),
        Some(crate::local::ActionTerminalCause::CallerAuthority(
            crate::auth::invocation::CallerAuthorityTerminalCause::ScopedServiceRetired {
                disposition: ServiceAuthorityDisposition::Carrier,
                ..
            }
        ))
    ));

    let terminal_cause = super::detached_action_stream_terminal_cause(
        &Err(refused.clone()),
        true,
        &host.terminal_latch,
    );
    assert_eq!(
        terminal_cause,
        crate::stream_attempt::StreamAttemptCause::Cancelled
    );
    let provider_refusal = host
        .settle_provider_stream_attempt_host(&attempt_token, terminal_cause)
        .expect_err("typed pre-reservation loss refuses ordinary provider settlement");
    assert_eq!(
        provider_refusal.diagnostic.code,
        "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID"
    );
    let attempts = crate::stream_attempt::global_stream_attempt_registry();
    assert_eq!(
        attempts
            .terminalize_invocation_host(&host.stream_runner_host, terminal_cause)
            .len(),
        1
    );
    host.flush_stream_attempts_trusted();
    assert_eq!(
        attempts
            .terminal(&attempt_token)
            .expect("pre-reservation output attempt has a durable winner")
            .cause,
        crate::stream_attempt::StreamAttemptCause::Cancelled
    );
    attempts.release_invocation(&host.stream_runner);
}

#[test]
fn slow_consumer_buffering_stays_within_the_profile_bound_across_four_cursors() {
    // @ref LLP 0076#surface — 64 KiB application-visible buffering: the
    // accounting domain is host-materialized bytes (queued chunk +
    // handoff copy) per invocation; one in-flight 16 KiB pull per cursor
    // times the 4-cursor cap is the structural ceiling, witnessed here by
    // the real high-water-mark counter under deliberately slow reads.
    const PER_STREAM_BYTES: usize = 128 * 1024;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind slow-consumer fixture");
    let address = listener.local_addr().expect("slow-consumer address");
    let upstream = std::thread::spawn(move || {
        let mut served = 0;
        while served < 4 {
            let Ok((mut socket, _)) = listener.accept() else {
                return;
            };
            served += 1;
            std::thread::spawn(move || {
                let mut request = [0_u8; 2_048];
                let _ = std::io::Read::read(&mut socket, &mut request);
                let _ = write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Length: {PER_STREAM_BYTES}\r\nConnection: close\r\n\r\n"
                );
                // Serve the whole body as fast as the socket accepts it:
                // the host must stay bounded regardless of upstream pace.
                let block = vec![b'y'; 32 * 1024];
                let mut remaining = PER_STREAM_BYTES;
                while remaining > 0 {
                    let visible = remaining.min(block.len());
                    if socket.write_all(&block[..visible]).is_err() {
                        return;
                    }
                    remaining -= visible;
                }
            });
        }
    });

    let mut snapback = LocalSnapback::memory().expect("slow-consumer host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    host.deadline = Instant::now() + Duration::from_secs(30);

    let mut streams = Vec::new();
    for index in 0..4 {
        let opened = host
            .open_response_stream(ActionStreamRequest {
                url: format!("http://{address}/slow-{index}"),
                method: "GET".to_owned(),
                headers: BTreeMap::new(),
                body: None,
                idempotency_key: None,
                attempt_token: None,
                secret_slots: Vec::new(),
            })
            .expect("open slow-consumer stream");
        streams.push((opened.stream_id, 0_usize, false));
    }
    // Interleave slow pulls across all four cursors until EOF.
    let mut remaining = 4;
    while remaining > 0 {
        for (stream_id, received, done) in &mut streams {
            if *done {
                continue;
            }
            std::thread::sleep(Duration::from_millis(2));
            let chunk = host
                .read_response_stream(stream_id)
                .expect("slow-consumer pull");
            if chunk.done {
                *done = true;
                remaining -= 1;
                assert_eq!(*received, PER_STREAM_BYTES, "ordered complete body");
            } else {
                *received += chunk.bytes.len();
                assert!(chunk.bytes.len() <= super::ACTION_STREAM_CHUNK_BYTES_MAX);
            }
        }
    }
    let peak = host.stream_buffered_peak.load(Ordering::SeqCst);
    assert!(
        peak > 0,
        "the counter must actually observe materialization"
    );
    assert!(
        peak <= 64 * 1024,
        "application-visible buffering exceeded the 64 KiB profile bound: {peak}"
    );
    assert_eq!(
        host.stream_buffered_bytes.load(Ordering::SeqCst),
        0,
        "every materialized byte is released at handoff"
    );
    upstream.join().expect("slow-consumer fixture joins");
}

#[test]
fn wall_ceiling_bounds_a_blocked_read_absolutely() {
    // A source that produces headers and then nothing: the pull blocks,
    // and the absolute wall ceiling must fire mid-read rather than
    // waiting for the socket's idle timeout.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind blocked-read fixture");
    let address = listener.local_addr().expect("blocked-read address");
    let upstream = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept blocked-read request");
        let mut request = [0_u8; 2_048];
        let _ = std::io::Read::read(&mut socket, &mut request);
        let _ = socket.write_all(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
        );
        std::thread::sleep(Duration::from_secs(2));
    });

    let mut snapback = LocalSnapback::memory().expect("blocked-read host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    host.deadline = Instant::now() + Duration::from_secs(30);
    let opened = host
        .open_response_stream(ActionStreamRequest {
            url: format!("http://{address}/blocked"),
            method: "GET".to_owned(),
            headers: BTreeMap::new(),
            body: None,
            idempotency_key: None,
            attempt_token: None,
            secret_slots: Vec::new(),
        })
        .expect("open blocked-read stream");
    // Pin this stream's wall deadline 300 ms out; the idle window is
    // 5 s, so only the absolute mid-read ceiling can end the pull early.
    host.response_streams
        .get_mut(&opened.stream_id)
        .expect("stream present")
        .wall_deadline = Instant::now() + Duration::from_millis(300);
    let started = Instant::now();
    let refusal = host
        .read_response_stream(&opened.stream_id)
        .expect_err("the wall ceiling ends the blocked pull");
    assert_eq!(refusal.diagnostic.code, "SNAPBACK_ACTION_STREAM_TIMEOUT");
    let elapsed = started.elapsed();
    assert!(
        elapsed >= Duration::from_millis(250) && elapsed < Duration::from_millis(1_500),
        "the ceiling must bound the read itself, got {elapsed:?}"
    );
    upstream.join().expect("blocked-read fixture joins");
}

#[test]
fn stream_wall_deadline_reserves_settlement_grace_before_the_watchdog() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind grace fixture");
    let address = listener.local_addr().expect("grace fixture address");
    let upstream = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept grace request");
        let mut request = [0_u8; 2_048];
        let _ = std::io::Read::read(&mut socket, &mut request);
        let _ = socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
    });

    let mut snapback = LocalSnapback::memory().expect("grace host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    // A watchdog tighter than the 30 s stream wall: the per-stream
    // deadline must leave the settle grace unspent.
    host.deadline = Instant::now() + Duration::from_secs(10);
    let opened = host
        .open_response_stream(ActionStreamRequest {
            url: format!("http://{address}/grace"),
            method: "GET".to_owned(),
            headers: BTreeMap::new(),
            body: None,
            idempotency_key: None,
            attempt_token: None,
            secret_slots: Vec::new(),
        })
        .expect("open grace stream");
    let stream = host
        .response_streams
        .get(&opened.stream_id)
        .expect("stream present");
    let latest_allowed =
        host.deadline - Duration::from_millis(super::ACTION_STREAM_SETTLE_GRACE_MS - 50);
    assert!(
        stream.wall_deadline < latest_allowed,
        "the stream wall must reserve settlement grace ahead of the watchdog"
    );
    upstream.join().expect("grace fixture joins");
}

#[test]
fn terminalization_during_read_discards_late_bytes_and_closes_the_cursor() {
    // @ref LLP 0076#authority-and-lifecycle — a read revalidates AFTER
    // awaiting bytes and discards late bytes if authority was lost. The
    // generation fence stands in for the terminalization class; the
    // service-authority tier shares the same revalidation seam.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind late-byte fixture");
    let address = listener.local_addr().expect("late-byte fixture address");
    let upstream = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept late-byte request");
        let mut request = [0_u8; 2_048];
        let _ = std::io::Read::read(&mut socket, &mut request);
        socket
            .write_all(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            )
            .expect("write headers");
        socket.write_all(b"7\r\nearly-1\r\n").expect("early chunk");
        socket.flush().expect("flush early chunk");
        // The late byte arrives only after the terminalization below has
        // landed; the blocked pull must return it to the host, which
        // discards it.
        std::thread::sleep(Duration::from_millis(900));
        let _ = socket.write_all(b"6\r\nlate-1\r\n");
        let _ = socket.write_all(b"0\r\n\r\n");
    });

    let mut snapback = LocalSnapback::memory().expect("late-byte host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    host.deadline = Instant::now() + Duration::from_secs(10);
    let opened = host
        .open_response_stream(ActionStreamRequest {
            url: format!("http://{address}/late"),
            method: "GET".to_owned(),
            headers: BTreeMap::new(),
            body: None,
            idempotency_key: None,
            attempt_token: None,
            secret_slots: Vec::new(),
        })
        .expect("open late-byte stream");
    let first = host
        .read_response_stream(&opened.stream_id)
        .expect("first chunk before terminalization");
    assert_eq!(first.bytes, b"early-1");

    // Terminalize while the next pull is blocked: flip the generation
    // fence from a sibling thread 200 ms into the ~900 ms stall.
    let fence = host.app_generation_fence.clone();
    let flipper = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(200));
        fence.fetch_add(1, Ordering::SeqCst);
    });
    let discarded = host
        .read_response_stream(&opened.stream_id)
        .expect_err("late bytes must be discarded after terminalization");
    assert_eq!(
        discarded.diagnostic.code,
        "SNAPBACK_ACTION_GENERATION_CONFLICT"
    );
    flipper.join().expect("fence flipper joins");
    upstream.join().expect("late-byte fixture joins");

    // The cursor is closed: a subsequent read observes end-of-stream.
    // (validate_host_call would already refuse at dispatch; the closed
    // set is defense in depth at the reader itself.)
    let after = host.closed_response_streams.contains(&opened.stream_id);
    assert!(after, "the discarding read must close the cursor");
}

#[test]
fn attempt_settlement_signals_the_cursor_without_a_progress_mutation() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind signal fixture");
    let address = listener.local_addr().expect("signal fixture address");
    let upstream = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept signal request");
        let mut request = [0_u8; 2_048];
        let _ = std::io::Read::read(&mut socket, &mut request);
        socket
            .write_all(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            )
            .expect("write headers");
        socket.write_all(b"7\r\nchunk-1\r\n").expect("first chunk");
        socket.flush().expect("flush first chunk");
        // Keep the connection open; more bytes would be available, but
        // the settled attempt must close the cursor first.
        std::thread::sleep(Duration::from_millis(500));
        let _ = socket.write_all(b"7\r\nchunk-2\r\n0\r\n\r\n");
    });

    let mut snapback = LocalSnapback::memory().expect("signal host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    host.deadline = Instant::now() + Duration::from_secs(10);
    let started = host
        .start_stream_attempt("signal-attempt")
        .expect("start signal attempt");
    let opened = host
        .open_response_stream(ActionStreamRequest {
            url: format!("http://{address}/signal"),
            method: "GET".to_owned(),
            headers: BTreeMap::new(),
            body: None,
            idempotency_key: None,
            attempt_token: Some(started.attempt_token.clone()),
            secret_slots: Vec::new(),
        })
        .expect("open signal stream");
    let first = host
        .read_response_stream(&opened.stream_id)
        .expect("first chunk");
    assert_eq!(first.bytes, b"chunk-1");

    // Durable terminal settlement — no progress mutation involved.
    host.settle_stream_attempt(
        &started.attempt_token,
        crate::stream_attempt::StreamAttemptCause::Cancelled,
    )
    .expect("authored cancel settle");

    // The very next pull observes closure via the direct
    // attempt-to-cursor signal.
    let closed = host
        .read_response_stream(&opened.stream_id)
        .expect("post-settle read returns EOF, not an error");
    assert!(closed.done, "the settled attempt closes its cursor");
    assert!(closed.bytes.is_empty(), "no late bytes are delivered");
    upstream.join().expect("signal fixture joins");
}

#[test]
fn cancel_physically_closes_the_upstream_socket_of_an_indefinite_source() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind indefinite fixture");
    let address = listener.local_addr().expect("indefinite fixture address");
    let upstream = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept indefinite request");
        let mut request = [0_u8; 2_048];
        let _ = std::io::Read::read(&mut socket, &mut request);
        socket
            .write_all(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            )
            .expect("write headers");
        socket.flush().expect("flush headers");
        // An indefinite no-more-bytes source: never send another byte.
        // The only way this read completes quickly is the peer closing.
        socket
            .set_read_timeout(Some(Duration::from_secs(10)))
            .expect("bound observation read");
        let mut probe = [0_u8; 16];
        match std::io::Read::read(&mut socket, &mut probe) {
            Ok(0) => (), // orderly close observed
            Ok(_) => panic!("indefinite source received unexpected bytes"),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::ConnectionReset
                        | std::io::ErrorKind::ConnectionAborted
                        | std::io::ErrorKind::BrokenPipe
                ) => {}
            Err(error) => panic!("upstream socket was not closed by cancel: {error}"),
        }
    });

    let mut snapback = LocalSnapback::memory().expect("indefinite host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    host.deadline = Instant::now() + Duration::from_secs(10);
    let opened = host
        .open_response_stream(ActionStreamRequest {
            url: format!("http://{address}/indefinite"),
            method: "GET".to_owned(),
            headers: BTreeMap::new(),
            body: None,
            idempotency_key: None,
            attempt_token: None,
            secret_slots: Vec::new(),
        })
        .expect("open indefinite stream");
    host.cancel_response_stream(&opened.stream_id)
        .expect("explicit cancel");

    // The fixture thread completes only when the upstream socket is
    // physically closed; a leaked reader would hold it for 10 s.
    let started = Instant::now();
    upstream.join().expect("indefinite fixture joins");
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "cancel must close the upstream socket promptly"
    );
}

#[test]
fn stream_attempt_rows_survive_process_death_and_reconcile_conservatively() {
    let dir = tempfile::tempdir().expect("stream attempt tempdir");
    let path = dir.path().join("attempts.sqlite");

    // First process life: start an attempt and durably pre-mark a cursor,
    // then "crash" (drop everything without settling — the registry
    // entries become unreachable because the reopened instance has a new
    // namespace, exactly like a new process).
    {
        let mut snapback = LocalSnapback::open(&path).expect("open stream attempt db");
        snapback.load_functions(generation_test_manifest());
        let state = Arc::new(Mutex::new(snapback));
        let staged = stage_held_action(&state);
        let mut host = held_action_host(state, &staged);
        let started = host
            .start_stream_attempt("crash-key")
            .expect("start durable attempt");
        assert!(started.lease_held);
        host.authority
            .stream_attempt_origin()
            .stage_cursor_premark(
                crate::stream_attempt::global_stream_attempt_registry(),
                &started.attempt_token,
                "crash-cursor",
                &host.stream_runner,
            )
            .expect("bind pre-marked cursor");
        host.flush_stream_attempts_required("test.premark")
            .expect("write-ahead pre-mark commits before the send");
    }

    // Second process life: the startup reconciler settles the orphaned
    // row `failed` with the conservative effect fact, and a new runner
    // observes that durable winner verbatim.
    let mut snapback = LocalSnapback::open(&path).expect("reopen stream attempt db");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    let recovered = host
        .start_stream_attempt("crash-key")
        .expect("start against the recovered attempt");
    assert!(!recovered.lease_held, "a settled attempt has no lease");
    let terminal = recovered.terminal.expect("a durable winner always exists");
    assert_eq!(
        terminal.cause,
        crate::stream_attempt::StreamAttemptCause::Failed
    );
    assert_eq!(
        terminal.settled_by,
        crate::stream_attempt::StreamAttemptSettledBy::Terminalizer
    );
    assert!(
        terminal.effect_may_have_executed,
        "a crash after the pre-mark leaves initiation_possible — the conservative reading"
    );

    // A fresh client key on the recovered instance still starts cleanly.
    let fresh = host
        .start_stream_attempt("crash-key-2")
        .expect("fresh attempt after recovery");
    assert!(fresh.lease_held);
    assert!(fresh.terminal.is_none());
}

#[test]
fn output_stream_transcripts_survive_process_death_and_cover_terminal_insert_gaps() {
    let dir = tempfile::tempdir().expect("output stream transcript tempdir");
    let path = dir.path().join("output-streams.sqlite");
    let stream_manifest = || {
        let mut conversation = FunctionDefinition::new(
            "conversation",
            FunctionKind::Action,
            FunctionRuntime::IbexModule(IbexModule {
                source:
                    "globalThis.__snapbackHandlers = { async conversation() { return null; } };"
                        .to_owned(),
                export: "conversation".to_owned(),
            }),
        );
        conversation.stream = true;
        FunctionManifest {
            functions: vec![conversation],
            ..FunctionManifest::default()
        }
    };

    // First process life: activate the manifest-gated table and persist one
    // live output attempt plus one terminal whose transcript insert did not
    // happen before process death.
    {
        let mut snapback = LocalSnapback::open(&path).expect("open output stream db");
        snapback.load_functions(stream_manifest());
        let orphan = crate::stream_attempt::PersistedStreamAttempt {
            token: "output-orphan".to_owned(),
            client_key: "output:orphan".to_owned(),
            runner_generation: 1,
            progress_commits: 0,
            cursors_opened: 0,
            cursors: BTreeMap::new(),
            terminal: None,
            function_id: Some("conversation".to_owned()),
            initiator: Some(crate::stream_attempt::StreamInitiator::SessionUser(
                "user-a".to_owned(),
            )),
            started_at_ms: 100,
            settled_at_ms: None,
            emitted_bytes: 12,
            chunk_count: 2,
        };
        let terminal_gap = crate::stream_attempt::PersistedStreamAttempt {
            token: "output-terminal-gap".to_owned(),
            client_key: "output:terminal-gap".to_owned(),
            runner_generation: 1,
            progress_commits: 0,
            cursors_opened: 0,
            cursors: BTreeMap::new(),
            terminal: Some(crate::stream_attempt::StreamAttemptTerminal {
                cause: crate::stream_attempt::StreamAttemptCause::Cancelled,
                effect_may_have_executed: false,
                settled_by: crate::stream_attempt::StreamAttemptSettledBy::Authored,
            }),
            function_id: Some("conversation".to_owned()),
            initiator: Some(crate::stream_attempt::StreamInitiator::ServiceCredential(
                "credential-a".to_owned(),
            )),
            started_at_ms: 200,
            settled_at_ms: Some(300),
            emitted_bytes: 7,
            chunk_count: 1,
        };
        snapback
            .persist_stream_attempts_for_test(&[
                orphan.to_row().expect("serialize orphan"),
                terminal_gap.to_row().expect("serialize terminal gap"),
            ])
            .expect("persist output attempts before process death");
    }

    // Second process life: startup settles the orphan conservatively and
    // repairs both missing transcript inserts without inventing final values
    // or token accounting.
    let snapback = LocalSnapback::open(&path).expect("reopen output stream db");
    let orphan = snapback
        .stream_transcript("output-orphan")
        .expect("read orphan transcript")
        .expect("orphan transcript was reconciled");
    assert_eq!(
        orphan.terminal_cause,
        crate::stream_attempt::StreamAttemptCause::Failed
    );
    assert_eq!(orphan.chunk_count, 2);
    assert_eq!(orphan.final_text, None);
    assert_eq!(orphan.prompt_tokens, None);
    assert_eq!(orphan.completion_tokens, None);

    let terminal_gap = snapback
        .stream_transcript("output-terminal-gap")
        .expect("read terminal-gap transcript")
        .expect("terminal-gap transcript was reconciled");
    assert_eq!(
        terminal_gap.terminal_cause,
        crate::stream_attempt::StreamAttemptCause::Cancelled
    );
    assert_eq!(terminal_gap.chunk_count, 1);
    assert_eq!(terminal_gap.final_text, None);
}

#[test]
fn keyed_non_get_transport_loss_settles_ambiguous_and_pre_send_failures_stay_failed() {
    // @ref LLP 0076#author-decisions--2026-07-23 — decision 5: a bare
    // idempotency key no longer downgrades ambiguity; only a safe method
    // or a provable pre-send failure settles `failed`.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind mid-handshake fixture");
    let address = listener.local_addr().expect("fixture address");
    let upstream = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept keyed request");
        let mut request = [0_u8; 512];
        let _ = std::io::Read::read(&mut socket, &mut request);
        drop(socket); // destroy after initiation, before response metadata
    });

    let mut snapback = LocalSnapback::memory().expect("classification host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    host.deadline = Instant::now() + Duration::from_secs(10);

    let keyed_loss = host
        .open_response_stream(ActionStreamRequest {
            url: format!("http://{address}/keyed"),
            method: "POST".to_owned(),
            headers: BTreeMap::new(),
            body: Some("{}".to_owned()),
            idempotency_key: Some("provider-key-1".to_owned()),
            attempt_token: None,
            secret_slots: Vec::new(),
        })
        .expect_err("mid-handshake loss cannot succeed");
    assert_eq!(
        keyed_loss.diagnostic.code, "SNAPBACK_ACTION_STREAM_UPSTREAM_AMBIGUOUS",
        "a bare key no longer proves provider idempotency"
    );
    upstream.join().expect("fixture joins");

    // Connection refused is provably pre-send: still `failed`, and an
    // attempt-bound cursor narrows to definitely_not_initiated so the
    // terminal carries no effect uncertainty.
    let refused_port = {
        let probe = std::net::TcpListener::bind("127.0.0.1:0").expect("probe port");
        let port = probe.local_addr().expect("probe address").port();
        drop(probe);
        port
    };
    let started = host
        .start_stream_attempt("pre-send-key")
        .expect("start pre-send attempt");
    let refused = host
        .open_response_stream(ActionStreamRequest {
            url: format!("http://127.0.0.1:{refused_port}/refused"),
            method: "POST".to_owned(),
            headers: BTreeMap::new(),
            body: Some("{}".to_owned()),
            idempotency_key: Some("provider-key-2".to_owned()),
            attempt_token: Some(started.attempt_token.clone()),
            secret_slots: Vec::new(),
        })
        .expect_err("connection refused cannot succeed");
    assert_eq!(
        refused.diagnostic.code,
        "SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED"
    );
    let settled = host
        .settle_stream_attempt(
            &started.attempt_token,
            crate::stream_attempt::StreamAttemptCause::Failed,
        )
        .expect("settle pre-send failure");
    assert!(
        !settled.effect_may_have_executed,
        "a provable pre-send failure carries no effect uncertainty"
    );
}

#[test]
fn cancelled_and_timed_out_after_initiation_carry_the_effect_fact() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind effect fixture");
    let address = listener.local_addr().expect("effect fixture address");
    let upstream = std::thread::spawn(move || {
        for _ in 0..2 {
            let Ok((mut socket, _)) = listener.accept() else {
                return;
            };
            let mut request = [0_u8; 512];
            let _ = std::io::Read::read(&mut socket, &mut request);
            let _ = socket.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nbody",
            );
        }
    });

    let mut snapback = LocalSnapback::memory().expect("effect host state");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state, &staged);
    host.deadline = Instant::now() + Duration::from_secs(10);

    // Cancelled after initiation: response metadata observed, explicit
    // cancel, then a cancelled settle — the effect fact must survive.
    let cancelled = host
        .start_stream_attempt("effect-cancel")
        .expect("start cancel attempt");
    let opened = host
        .open_response_stream(ActionStreamRequest {
            url: format!("http://{address}/cancel"),
            method: "GET".to_owned(),
            headers: BTreeMap::new(),
            body: None,
            idempotency_key: None,
            attempt_token: Some(cancelled.attempt_token.clone()),
            secret_slots: Vec::new(),
        })
        .expect("open cancel stream");
    host.cancel_response_stream(&opened.stream_id)
        .expect("explicit cancel");
    let terminal = host
        .settle_stream_attempt(
            &cancelled.attempt_token,
            crate::stream_attempt::StreamAttemptCause::Cancelled,
        )
        .expect("settle cancelled");
    assert!(
        terminal.effect_may_have_executed,
        "cancelled-after-initiation must carry the effect fact"
    );

    // Timed out after initiation: same shape, timed_out cause.
    let timed = host
        .start_stream_attempt("effect-timeout")
        .expect("start timeout attempt");
    let opened = host
        .open_response_stream(ActionStreamRequest {
            url: format!("http://{address}/timeout"),
            method: "GET".to_owned(),
            headers: BTreeMap::new(),
            body: None,
            idempotency_key: None,
            attempt_token: Some(timed.attempt_token.clone()),
            secret_slots: Vec::new(),
        })
        .expect("open timeout stream");
    host.cancel_response_stream(&opened.stream_id)
        .expect("close cursor before settle");
    let terminal = host
        .settle_stream_attempt(
            &timed.attempt_token,
            crate::stream_attempt::StreamAttemptCause::TimedOut,
        )
        .expect("settle timed_out");
    assert!(
        terminal.effect_may_have_executed,
        "timed-out-after-initiation must carry the effect fact"
    );
    upstream.join().expect("effect fixture joins");
}

#[tokio::test]
async fn watchdog_abandonment_terminalizes_stream_attempts_with_timed_out() {
    let manifest = FunctionManifest {
        functions: vec![FunctionDefinition::new(
            "hungAttempt",
            FunctionKind::Action,
            FunctionRuntime::IbexModule(IbexModule {
                source: r#"globalThis.__snapbackHandlers = {
  async hungAttempt(ctx, args) {
    const started = await ctx.streamAttempt.start(args.clientKey);
    if (!started.terminal) {
      const begun = Date.now();
      while (Date.now() - begun < 30000) {}
    }
    return { started: started };
  }
};"#
                .to_owned(),
                export: "hungAttempt".to_owned(),
            }),
        )],
        ..FunctionManifest::default()
    };
    let mut snapback = LocalSnapback::memory().expect("hung attempt state");
    snapback.load_functions(manifest);
    let state = Arc::new(Mutex::new(snapback));
    let counters = isolated_worker_counters();

    let stage = |state: &SharedSnapback| {
        let state = state.clone();
        async move {
            let action = super::with_snapback(&state, |snapback| {
                snapback.stage_cron_action_invocation("hungAttempt")
            })
            .await
            .expect("stage hung attempt action");
            let StagedAction::Detached(action) = action else {
                panic!("Ibex action must detach");
            };
            action
        }
    };

    let action = stage(&state).await;
    let timed_out = super::run_detached_ibex_action_with_admission_counters_and_timeout(
        &state,
        action,
        HandlerInput {
            args: json!({ "clientKey": "watchdog-attempt" }),
            ..HandlerInput::default()
        },
        crate::local::manual_action_metadata("test", "hungAttempt"),
        Arc::new(Semaphore::new(1)),
        1,
        counters,
        5_000,
    )
    .await
    .expect_err("the watchdog abandons the hung action");
    assert_eq!(timed_out.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");

    // The trusted terminalizer wrote the durable winner while the hung
    // worker was still spinning: a later runner observes timed_out from
    // the terminalizer and takes the lease over.
    let action = stage(&state).await;
    let observed = super::run_detached_ibex_action_with_admission_counters_and_timeout(
        &state,
        action,
        HandlerInput {
            args: json!({ "clientKey": "watchdog-attempt" }),
            ..HandlerInput::default()
        },
        crate::local::manual_action_metadata("test", "hungAttempt2"),
        Arc::new(Semaphore::new(1)),
        1,
        counters,
        5_000,
    )
    .await
    .expect("the follow-up runner completes");
    assert_eq!(observed["started"]["terminal"]["cause"], json!("timed_out"));
    assert_eq!(
        observed["started"]["terminal"]["settledBy"],
        json!("terminalizer")
    );
}

#[tokio::test]
async fn stream_attempt_control_plane_settles_verbatim_through_the_real_action_path() {
    let manifest = FunctionManifest {
            functions: vec![FunctionDefinition::new(
                "attemptAction",
                FunctionKind::Action,
                FunctionRuntime::IbexModule(IbexModule {
                    source: r#"globalThis.__snapbackHandlers = {
  async attemptAction(ctx, args) {
    const started = await ctx.streamAttempt.start(args.clientKey);
    if (args.settle) {
      const settled = await ctx.streamAttempt.settle(started.attemptToken, args.cause || "complete");
      return { started: started, settled: settled };
    }
    return { started: started };
  }
};"#
                    .to_owned(),
                    export: "attemptAction".to_owned(),
                }),
            )],
            ..FunctionManifest::default()
        };
    let mut snapback = LocalSnapback::memory().expect("attempt action state");
    snapback.load_functions(manifest);
    let state = Arc::new(Mutex::new(snapback));

    let run = |args: Value| {
        let state = state.clone();
        async move {
            let action = super::with_snapback(&state, |snapback| {
                snapback.stage_cron_action_invocation("attemptAction")
            })
            .await
            .expect("stage attempt action");
            let StagedAction::Detached(action) = action else {
                panic!("Ibex action must detach");
            };
            super::run_detached_ibex_action(
                &state,
                action,
                HandlerInput {
                    args,
                    ..HandlerInput::default()
                },
                crate::local::manual_action_metadata("test", "attemptAction"),
            )
            .await
            .expect("attempt action completes")
        }
    };

    // First runner starts and settles `complete` under its lease.
    let first = run(json!({ "clientKey": "e2e-attempt", "settle": true })).await;
    assert_eq!(first["started"]["leaseHeld"], json!(true));
    assert_eq!(first["started"]["terminal"], Value::Null);
    assert_eq!(first["settled"]["cause"], json!("complete"));
    assert_eq!(first["settled"]["settledBy"], json!("authored"));

    // A later invocation with the same client key observes the durable
    // winner verbatim — its own divergent settle cause is ignored.
    let second =
        run(json!({ "clientKey": "e2e-attempt", "settle": true, "cause": "failed" })).await;
    assert_eq!(second["started"]["leaseHeld"], json!(false));
    assert_eq!(second["started"]["terminal"]["cause"], json!("complete"));
    assert_eq!(second["settled"]["cause"], json!("complete"));
    assert_eq!(second["settled"]["settledBy"], json!("authored"));

    // An action that returns WITHOUT settling forfeits the authored path:
    // the trusted terminalizer writes the durable winner.
    let unsettled = run(json!({ "clientKey": "e2e-forfeit", "settle": false })).await;
    assert_eq!(unsettled["started"]["leaseHeld"], json!(true));
    let observed = run(json!({ "clientKey": "e2e-forfeit", "settle": false })).await;
    assert_eq!(observed["started"]["terminal"]["cause"], json!("failed"));
    assert_eq!(
        observed["started"]["terminal"]["settledBy"],
        json!("terminalizer")
    );
}

#[tokio::test]
async fn detached_action_host_closes_begin_to_native_initiated_revocation_race() {
    let fixture =
        finite_authority_matrix_fixture_with_functions(finite_authority_held_action_functions())
            .await;
    let authority = prepared_test_service_route_authority(
        &fixture.state,
        InvocationSource::HttpAction,
        &fixture.token,
    )
    .await;
    let probe_authority = authority.clone();
    let state = fixture.state.snapback.clone();
    let staged = stage_held_action(&state);
    let mut host = held_action_host(state.clone(), &staged);
    host.authority = authority;

    host.validate_host_call("action.externalEffectBegin")
        .expect("reserve exact native-enqueue cut");
    let terminal_state = state.clone();
    let terminal_token = fixture.token.clone();
    let terminal_now_ms = fixture.start_ms + 1;
    let terminal = tokio::spawn(async move {
        let token_for_plan = crate::auth::crypto::ScopedToken::parse(&terminal_token)
            .expect("parse external-effect terminal plan token");
        let plan = with_snapback(&terminal_state, move |snapback| {
            snapback.plan_scoped_token_release(&token_for_plan)
        })
        .await
        .expect("plan exact external-effect scoped-token release");
        let gate = plan
            .acquire_gate()
            .await
            .expect("close and drain service domain");
        let token = crate::auth::crypto::ScopedToken::parse(&terminal_token)
            .expect("parse external-effect terminal token");
        with_snapback(&terminal_state, move |snapback| {
            with_service_authority_terminal_gate(gate, || {
                snapback.release_scoped_token(&token, terminal_now_ms)
            })
        })
        .await
        .expect("commit exact terminal after native initiation closes");
    });
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            match probe_authority.reserve_authorized_effect("external effect premark probe") {
                Ok(extra) => drop(extra),
                Err(_) => break,
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("terminal transaction reaches the process precommit marker");
    assert!(
        !terminal.is_finished(),
        "terminal commit must wait until native initiation is acknowledged"
    );
    host.validate_host_call("action.externalEffectInitiated")
        .expect("native initiation acknowledgement releases the cut");
    tokio::time::timeout(Duration::from_secs(1), terminal)
        .await
        .expect("terminal commits after native initiation")
        .expect("terminal task joins");
    let stale = host
        .validate_host_call("action.externalEffectBegin")
        .expect_err("a later native effect cannot start after revocation");
    assert_eq!(stale.diagnostic.code, "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID");
}

/// ENG-24340 review follow-up: holding an outer detached action across an
/// app reload/reset cannot let that old action use any later host power.
/// The host-plan leg is important: it executes under the instance lock and
/// therefore bypassed the detached-Ibex mutation's commit-time binding.
#[test]
fn detached_action_rejects_every_host_call_after_reload_or_reset() {
    let mut snapback = LocalSnapback::memory().expect("memory instance");
    snapback.load_functions(generation_test_manifest());
    let state = Arc::new(Mutex::new(snapback));

    let staged_before_reload = stage_held_action(&state);
    state
        .try_lock()
        .expect("test owns instance lock")
        .load_functions(generation_test_manifest());
    let mut stale_after_reload = held_action_host(state.clone(), &staged_before_reload);
    let runtime_error = stale_after_reload
        .validate_host_call("runtime.id")
        .expect_err("ordinary action host calls reject function reload drift");
    assert_eq!(
        runtime_error.diagnostic.code,
        "SNAPBACK_ACTION_GENERATION_CONFLICT"
    );
    let host_plan_error = stale_after_reload
        .run_mutation("hostPlanWrite", HandlerInput::default())
        .expect_err("host-plan mutation rejects outer action generation drift");
    assert_eq!(
        host_plan_error.diagnostic.code,
        "SNAPBACK_ACTION_GENERATION_CONFLICT"
    );

    let staged_before_reset = stage_held_action(&state);
    state
        .try_lock()
        .expect("test owns instance lock")
        .reset()
        .expect("reset app state");
    let mut stale_after_reset = held_action_host(state.clone(), &staged_before_reset);
    let reset_error = stale_after_reset
        .validate_host_call("runtime.now")
        .expect_err("ordinary action host calls reject reset drift");
    assert_eq!(
        reset_error.diagnostic.code,
        "SNAPBACK_ACTION_GENERATION_CONFLICT"
    );

    let staged_before_schema = stage_held_action(&state);
    state
        .try_lock()
        .expect("test owns instance lock")
        .apply_schema(SchemaManifest {
            schema_hash: Some("held-action-schema-reload".to_owned()),
            ..SchemaManifest::default()
        })
        .expect("reload schema");
    let mut stale_after_schema = held_action_host(state, &staged_before_schema);
    let schema_error = stale_after_schema
        .validate_host_call("action.metadata")
        .expect_err("ordinary action host calls reject schema drift");
    assert_eq!(
        schema_error.diagnostic.code,
        "SNAPBACK_ACTION_GENERATION_CONFLICT"
    );
}

#[tokio::test]
async fn streaming_action_emits_through_runtime_and_reserved_live_room() {
    let mut function = FunctionDefinition::new(
        "outputStream",
        FunctionKind::Action,
        FunctionRuntime::IbexModule(IbexModule {
            source: r#"globalThis.__snapbackHandlers = {
  async outputStream(ctx) {
    await ctx.stream.emit("first");
    await ctx.stream.emit({ kind: "second" });
    return "done";
  }
};"#
            .to_owned(),
            export: "outputStream".to_owned(),
        }),
    );
    function.stream = true;
    let mut snapback = LocalSnapback::memory().expect("stream output state");
    let diagnostics = snapback.load_functions(FunctionManifest {
        functions: vec![function],
        ..FunctionManifest::default()
    });
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code != "SNAPBACK_FUNCTION_STREAM_KIND_INVALID"),
        "streaming action manifest should activate: {diagnostics:?}"
    );
    let state = Arc::new(Mutex::new(snapback));
    let staged = state
        .try_lock()
        .expect("stage stream output")
        .stage_cron_action_invocation("outputStream")
        .expect("stream output action");
    let StagedAction::Detached(mut action) = staged else {
        panic!("Ibex streaming action must detach")
    };
    let initiator = crate::stream_attempt::StreamInitiator::SessionUser("user-a".to_owned());
    action.stream_initiator = Some(initiator.clone());
    let (started, attempt_token) = tokio::sync::oneshot::channel();
    action.stream_started = Some(started);

    let result = super::run_detached_ibex_action(
        &state,
        action,
        HandlerInput::default(),
        crate::local::manual_action_metadata("test", "outputStream"),
    )
    .await
    .expect("streaming action completes");
    assert_eq!(result, json!("done"));
    let attempt_token = attempt_token
        .await
        .expect("attempt token published at start");
    let terminal = crate::stream_attempt::global_stream_attempt_registry()
        .terminal(&attempt_token)
        .expect("production worker terminalizes the output attempt");
    assert_eq!(
        terminal.cause,
        crate::stream_attempt::StreamAttemptCause::Complete
    );
    assert_eq!(
        terminal.settled_by,
        crate::stream_attempt::StreamAttemptSettledBy::Terminalizer,
        "automatic output completion must use the worker's host settlement call site"
    );

    let scope = Scope::from_pairs([("attemptToken", attempt_token.as_str())]);
    let message = state
        .try_lock()
        .expect("subscribe to retained output")
        .subscribe_ephemeral(
            SubscribeRequest {
                collection: crate::ephemeral::STREAM_COLLECTION_NAME.to_owned(),
                scope,
                connection_id: "same-user-second-connection".to_owned(),
                auth: crate::ephemeral::AuthContext {
                    stream_initiator: Some(initiator),
                    ..Default::default()
                },
                since_chunk: None,
            },
            super::now_millis(),
        )
        .expect("initiator subscribes through the reserved room");
    let EphemeralMessage::Snapshot {
        entries,
        stream_resume: Some(resume),
        ..
    } = message
    else {
        panic!("stream subscription returns its retained snapshot")
    };
    assert_eq!(entries.len(), 2);
    let chunks = entries
        .iter()
        .map(|entry| serde_json::from_slice::<Value>(&entry.value).expect("chunk envelope"))
        .collect::<Vec<_>>();
    assert_eq!(chunks[0]["chunkIndex"], json!(0));
    assert_eq!(chunks[0]["chunk"], json!("first"));
    assert_eq!(chunks[1]["chunkIndex"], json!(1));
    assert_eq!(chunks[1]["chunk"], json!({ "kind": "second" }));
    assert_eq!(resume.next_chunk, 2);
    assert!(!resume.truncated);

    let transcript = state
        .try_lock()
        .expect("read settled transcript")
        .stream_transcript(&attempt_token)
        .expect("transcript read")
        .expect("completed transcript");
    assert_eq!(transcript.final_text.as_deref(), Some("done"));
    assert_eq!(transcript.chunk_count, 2);
    assert_eq!(transcript.prompt_tokens, None);
    assert_eq!(transcript.completion_tokens, None);
}

#[tokio::test]
async fn stream_transcript_route_is_initiator_private_with_exact_403_and_404() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = state
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, false, false, false),
        )
        .expect("install transcript-route sessions fixture");
    let initiator_credential = mint_test_credential(&state, "stream-owner@example.com").await;
    let outsider_credential = mint_test_credential(&state, "stream-outsider@example.com").await;
    let initiator_user = initiator_credential["session"]["userId"]
        .as_str()
        .expect("initiator user id")
        .to_owned();

    let mut function = FunctionDefinition::new(
        "transcriptSource",
        FunctionKind::Action,
        FunctionRuntime::IbexModule(IbexModule {
            source:
                "globalThis.__snapbackHandlers = { async transcriptSource() { return 'done'; } };"
                    .to_owned(),
            export: "transcriptSource".to_owned(),
        }),
    );
    function.stream = true;
    state
        .snapback
        .try_lock()
        .expect("activate transcript fixture")
        .load_functions(FunctionManifest {
            functions: vec![function],
            ..FunctionManifest::default()
        });
    state
        .snapback
        .try_lock()
        .expect("settle transcript fixture")
        .settle_stream_transcript(
            &crate::storage::stream_transcripts::StreamTranscriptRecord {
                attempt_token: "private-transcript".to_owned(),
                function_id: "transcriptSource".to_owned(),
                initiator: crate::stream_attempt::StreamInitiator::SessionUser(initiator_user),
                started_at_ms: 100,
                settled_at_ms: 200,
                terminal_cause: crate::stream_attempt::StreamAttemptCause::Complete,
                final_text: Some("done".to_owned()),
                chunk_count: 2,
                prompt_tokens: None,
                completion_tokens: None,
            },
        )
        .expect("settle route transcript");

    let router = super::app(state);
    let request = |token: &str, bearer: &str| {
        Request::builder()
            .method("GET")
            .uri(format!("/streams/{token}"))
            .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
            .header("x-snapback-auth-client-protocol", "1")
            .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
            .body(Body::empty())
            .expect("transcript request")
    };
    let initiator = router
        .clone()
        .oneshot(request(
            "private-transcript",
            initiator_credential["token"].as_str().expect("owner token"),
        ))
        .await
        .expect("initiator transcript response");
    assert_eq!(initiator.status(), StatusCode::OK);
    assert_eq!(
        initiator.headers()[header::CACHE_CONTROL],
        HeaderValue::from_static("no-store, private")
    );
    assert_eq!(response_json(initiator).await["finalText"], json!("done"));

    let outsider = router
        .clone()
        .oneshot(request(
            "private-transcript",
            outsider_credential["token"]
                .as_str()
                .expect("outsider token"),
        ))
        .await
        .expect("outsider transcript response");
    assert_eq!(outsider.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(outsider).await["diagnostic"]["code"],
        json!("SNAPBACK_STREAM_TRANSCRIPT_FORBIDDEN")
    );

    let unknown = router
        .oneshot(request(
            "unknown-transcript",
            initiator_credential["token"].as_str().expect("owner token"),
        ))
        .await
        .expect("unknown transcript response");
    assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(unknown).await["diagnostic"]["code"],
        json!("SNAPBACK_STREAM_TRANSCRIPT_NOT_FOUND")
    );
}

macro_rules! mode_only_migration_authorized_effect_race_tests {
    ($logout_test:ident, $reservation_test:ident, $site:expr) => {
        #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
        async fn $logout_test() {
            mode_only_migration_logout_wins($site).await;
        }

        #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
        async fn $reservation_test() {
            mode_only_migration_reservation_wins($site).await;
        }
    };
}

mode_only_migration_authorized_effect_race_tests!(
    capability_link_mint_logout_wins_before_authorized_effect_reservation,
    capability_link_mint_authorized_effect_reservation_wins_before_logout,
    ModeOnlyMigrationAuthorizedEffectSite::CapabilityLinkMint
);

mode_only_migration_authorized_effect_race_tests!(
    capability_link_revoke_logout_wins_before_authorized_effect_reservation,
    capability_link_revoke_authorized_effect_reservation_wins_before_logout,
    ModeOnlyMigrationAuthorizedEffectSite::CapabilityLinkRevoke
);

mode_only_migration_authorized_effect_race_tests!(
    client_mutation_acknowledgement_logout_wins_before_authorized_effect_reservation,
    client_mutation_acknowledgement_authorized_effect_reservation_wins_before_logout,
    ModeOnlyMigrationAuthorizedEffectSite::ClientMutationAcknowledgement
);

mode_only_migration_authorized_effect_race_tests!(
    agent_invitation_mint_logout_wins_before_authorized_effect_reservation,
    agent_invitation_mint_authorized_effect_reservation_wins_before_logout,
    ModeOnlyMigrationAuthorizedEffectSite::AgentInvitationMint
);

mode_only_migration_authorized_effect_race_tests!(
    pairing_code_mint_logout_wins_before_authorized_effect_reservation,
    pairing_code_mint_authorized_effect_reservation_wins_before_logout,
    ModeOnlyMigrationAuthorizedEffectSite::PairingCodeMint
);

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pairing_code_mint_final_mode_guard_refusal_rolls_back_complete_auth_transaction() {
    let control = mode_only_migration_authorized_effect_fixture(
        ModeOnlyMigrationAuthorizedEffectSite::PairingCodeMint,
    )
    .await;
    let control_before = mode_only_migration_durable_marker(
        &control.state,
        ModeOnlyMigrationAuthorizedEffectSite::PairingCodeMint,
        &control.principal_id,
    )
    .await;
    let control_response = control
        .router
        .clone()
        .oneshot(control.request)
        .await
        .expect("pairing-code nonempty control response");
    assert_eq!(control_response.status(), StatusCode::OK);
    assert!(
        mode_only_migration_durable_marker(
            &control.state,
            ModeOnlyMigrationAuthorizedEffectSite::PairingCodeMint,
            &control.principal_id,
        )
        .await
            != control_before,
        "the final-guard fixture must exercise a nonempty pairing transaction"
    );

    let fixture = mode_only_migration_authorized_effect_fixture(
        ModeOnlyMigrationAuthorizedEffectSite::PairingCodeMint,
    )
    .await;
    let marker_before = mode_only_migration_durable_marker(
        &fixture.state,
        ModeOnlyMigrationAuthorizedEffectSite::PairingCodeMint,
        &fixture.principal_id,
    )
    .await;
    let authority = prepared_test_session_route_authority(
        &fixture.state,
        InvocationSource::AgentGrantManagement,
        &fixture.bearer,
    );
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    headers.insert(
        HeaderName::from_static(TEST_PAIRING_COMMIT_GUARD_RETIRE_HEADER),
        HeaderValue::from_static("1"),
    );
    let error = match super::auth_pairing_code(
        State(fixture.state.clone()),
        Extension(authority),
        headers,
        Ok(Bytes::from_static(br#"{}"#)),
    )
    .await
    {
        Ok(_) => panic!("retired final pairing guard must refuse"),
        Err(error) => error,
    };
    let response = error.into_response();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let response = response_json(response).await;
    assert_eq!(response["diagnostic"]["code"], "SNAPBACK_AUTH_MODE_PENDING");
    assert!(
        mode_only_migration_durable_marker(
            &fixture.state,
            ModeOnlyMigrationAuthorizedEffectSite::PairingCodeMint,
            &fixture.principal_id,
        )
        .await
            == marker_before,
        "final mode-guard refusal must roll back both the clock and pairing row"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pairing_code_mint_stages_clock_and_row_under_exact_guard_before_one_commit() {
    let fixture = mode_only_migration_authorized_effect_fixture(
        ModeOnlyMigrationAuthorizedEffectSite::PairingCodeMint,
    )
    .await;
    let authority = prepared_test_session_route_authority(
        &fixture.state,
        InvocationSource::AgentGrantManagement,
        &fixture.bearer,
    );
    let authorized_effect = authority
        .reserve_authorized_effect("pairing-code mint transaction")
        .expect("reserve exact pairing-code authority");
    let reservation_identity = authorized_effect.identity_for_test();
    let probe = crate::storage::auth_grants::PairingCodeMintCommitProbeForTest::new(move || {
        crate::auth::invocation::current_thread_holds_authorized_effect_commit_guard_for_test(
            reservation_identity,
        )
    });
    let receipt = probe.receipt();
    let _probe_registration = probe.register_production_entry_for_test(reservation_identity);
    let effect_authority = authority.clone();
    let user_id = fixture.principal_id.clone();
    let provider = fixture
        .state
        .auth_provider
        .clone()
        .expect("pairing-code probe provider");
    let now_ms = provider.now_ms();
    let minted = super::with_snapback_until(
        &fixture.state.snapback,
        Instant::now() + Duration::from_secs(5),
        move |snapback| {
            snapback.mint_pairing_code_with_authorized_effect(
                &effect_authority,
                &user_id,
                now_ms,
                &OsRandom,
                authorized_effect,
            )
        },
    )
    .await
    .expect("pairing-code probe enters its bounded writer")
    .expect("pairing-code probe commits");
    assert!(!minted.request_id.is_empty());
    assert_eq!(
        receipt.events(),
        vec![
            crate::storage::auth_grants::PairingCodeMintCommitEventForTest::Staged {
                clock_value_matches: true,
                pairing_row_matches: true,
                clock_writes: 1,
                pairing_writes: 1,
                exact_guard_held: true,
            },
            crate::storage::auth_grants::PairingCodeMintCommitEventForTest::Commit {
                exact_guard_held: true,
            },
        ],
        "the exact guarded transaction must stage both durable facts before its sole real commit"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pairing_code_mint_releases_caller_permit_at_commit_before_response_work() {
    let mut fixture = mode_only_migration_authorized_effect_fixture(
        ModeOnlyMigrationAuthorizedEffectSite::PairingCodeMint,
    )
    .await;
    let marker_before = mode_only_migration_durable_marker(
        &fixture.state,
        ModeOnlyMigrationAuthorizedEffectSite::PairingCodeMint,
        &fixture.principal_id,
    )
    .await;
    let pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectCommit,
    );
    fixture.request.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(pause.id()).expect("post-commit response pause header"),
    );
    let target_router = fixture.router.clone();
    let target = tokio::spawn(async move {
        target_router
            .oneshot(fixture.request)
            .await
            .expect("post-commit paused pairing response")
    });
    tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
        .await
        .expect("pairing route reaches post-commit response work");
    assert!(
        mode_only_migration_durable_marker(
            &fixture.state,
            ModeOnlyMigrationAuthorizedEffectSite::PairingCodeMint,
            &fixture.principal_id,
        )
        .await
            != marker_before,
        "the observed participant must be the nonempty pairing commit"
    );

    let logout = tokio::time::timeout(
        Duration::from_secs(5),
        fixture.router.clone().oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &fixture.bearer,
        )),
    )
    .await
    .expect("post-commit response work does not pin logout")
    .expect("post-commit logout response");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);

    pause.release().await;
    let response = tokio::time::timeout(Duration::from_secs(5), target)
        .await
        .expect("post-commit pairing response does not hang")
        .expect("post-commit pairing task");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pairing_code_mint_bounds_fifo_local_wait() {
    let fixture = mode_only_migration_authorized_effect_fixture(
        ModeOnlyMigrationAuthorizedEffectSite::PairingCodeMint,
    )
    .await;
    let authority = prepared_test_session_route_authority(
        &fixture.state,
        InvocationSource::AgentGrantManagement,
        &fixture.bearer,
    );
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    headers.insert(
        HeaderName::from_static(TEST_PAIRING_WRITER_BUDGET_HEADER),
        HeaderValue::from_static("50"),
    );
    let local = fixture.state.snapback.clone().lock_owned().await;
    let queued =
        super::writer_gate::install_managed_writer_queue_test_hook(&fixture.state.snapback);
    let target_state = fixture.state.clone();
    let target = tokio::spawn(async move {
        match super::auth_pairing_code(
            State(target_state),
            Extension(authority),
            headers,
            Ok(Bytes::from_static(br#"{}"#)),
        )
        .await
        {
            Ok(response) => response.into_response(),
            Err(error) => error.into_response(),
        }
    });
    tokio::time::timeout(Duration::from_secs(5), queued.notified())
        .await
        .expect("pairing request enters the real managed FIFO queue");
    let response = tokio::time::timeout(Duration::from_secs(2), target)
        .await
        .expect("pairing writer wait obeys its test-shortened absolute deadline")
        .expect("bounded pairing writer task");
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let response = response_json(response).await;
    assert_eq!(
        response["diagnostic"]["code"],
        "SNAPBACK_AUTH_PAIRING_COMMIT_TIMEOUT"
    );
    assert_eq!(
        response["diagnostic"]["details"]["phase"],
        "writerAdmission"
    );
    assert!(
        response["diagnostic"]["details"]
            .get("capsuleOutcome")
            .is_none()
    );

    drop(local);
    let logout = tokio::time::timeout(
        Duration::from_secs(5),
        fixture.router.clone().oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &fixture.bearer,
        )),
    )
    .await
    .expect("bounded FIFO wait does not pin logout after Local release")
    .expect("bounded-wait logout response");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
}

/// @ref LLP 0058#split-phase-authorized-effect-fence — blocking-pool admission
/// is part of the absolute pairing deadline: saturation must drop the already
/// reserved caller permit so logout's exact terminal premark can drain without
/// waiting for a queued worker to start.
///
/// Evidence limit: this fixture observes the timeout and permit drain while the
/// pool stays saturated, but it does not directly observe the pairing worker
/// enter Tokio's blocking queue. That causal admission fact is established by
/// static tracing of `with_snapback_until`.
#[test]
fn pairing_code_mint_saturated_blocking_pool_times_out_and_logout_premark_drains() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .max_blocking_threads(1)
        .enable_all()
        .build()
        .expect("single-blocking-worker pairing runtime");
    runtime.block_on(async {
        let fixture = mode_only_migration_authorized_effect_fixture(
            ModeOnlyMigrationAuthorizedEffectSite::PairingCodeMint,
        )
        .await;
        let provider = fixture
            .state
            .auth_provider
            .clone()
            .expect("saturated pairing provider");
        let coordinator = fixture
            .state
            .auth_coordinator
            .clone()
            .expect("saturated pairing coordinator");
        let admission = provider.admit().await;
        let plan_bearer = fixture.bearer.clone();
        let plan_now_ms = provider.now_ms();
        let planned = with_snapback(&fixture.state.snapback, move |snapback| {
            snapback.execute_auth_plan(admission.plan_logout_plan(&plan_bearer, plan_now_ms))
        })
        .await
        .expect("plan saturated-pool logout");
        let crate::auth::provider::PlannedLogout::Revoke(logout_plan) = planned else {
            panic!("saturated-pool logout must plan exact revocation");
        };

        let (blocking_started_sender, blocking_started_receiver) = tokio::sync::oneshot::channel();
        let (blocking_release_sender, blocking_release_receiver) = std::sync::mpsc::sync_channel(1);
        let saturator = tokio::task::spawn_blocking(move || {
            let _ = blocking_started_sender.send(());
            let _ = blocking_release_receiver.recv();
        });
        blocking_started_receiver
            .await
            .expect("blocking-pool saturator starts");

        let authority = prepared_test_session_route_authority(
            &fixture.state,
            InvocationSource::AgentGrantManagement,
            &fixture.bearer,
        );
        let reservation_pause = install_test_finite_authority_pause(
            TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
        );
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        headers.insert(
            HeaderName::from_static(TEST_PAIRING_WRITER_BUDGET_HEADER),
            HeaderValue::from_static("100"),
        );
        headers.insert(
            HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
            HeaderValue::from_str(reservation_pause.id())
                .expect("saturated-pool reservation pause header"),
        );
        let target_state = fixture.state.clone();
        let target = tokio::spawn(async move {
            match super::auth_pairing_code(
                State(target_state),
                Extension(authority),
                headers,
                Ok(Bytes::from_static(br#"{}"#)),
            )
            .await
            {
                Ok(response) => response.into_response(),
                Err(error) => error.into_response(),
            }
        });
        tokio::time::timeout(
            Duration::from_secs(5),
            reservation_pause.wait_until_reached(),
        )
        .await
        .expect("pairing reserves caller authority before blocking admission");

        let premark_coordinator = coordinator.clone();
        let mut premark =
            tokio::spawn(async move { premark_coordinator.premark_revocation(logout_plan).await });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            !premark.is_finished(),
            "logout premark must initially drain behind the reserved pairing caller"
        );
        reservation_pause.release().await;

        let response = tokio::time::timeout(Duration::from_secs(2), target)
            .await
            .expect("saturated pairing obeys its blocking-admission deadline")
            .expect("saturated pairing task");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let response = response_json(response).await;
        assert_eq!(
            response["diagnostic"]["code"],
            "SNAPBACK_AUTH_PAIRING_COMMIT_TIMEOUT"
        );
        assert!(
            response["diagnostic"]["details"]
                .get("capsuleOutcome")
                .is_none()
        );

        let carrier = tokio::time::timeout(Duration::from_secs(1), &mut premark)
            .await
            .expect("logout premark drains while the blocking pool remains saturated")
            .expect("logout premark task")
            .expect("logout premark succeeds after pairing timeout");
        let cleanup_error = SnapbackError::error(
            "SNAPBACK_TEST_ROLLBACK",
            "test",
            "clean up saturated-pool logout premark",
        );
        let (cleanup, committed_revocations) = coordinator
            .finish_revocation(carrier, AuthTransactionAttempt::RolledBack(cleanup_error))
            .into_parts();
        assert_eq!(
            cleanup
                .expect_err("test rollback reopens the premarked session")
                .diagnostic
                .code,
            "SNAPBACK_TEST_ROLLBACK"
        );
        assert!(committed_revocations.is_empty());

        blocking_release_sender
            .send(())
            .expect("release saturated blocking pool");
        saturator.await.expect("blocking-pool saturator exits");
    });
}

mode_only_migration_authorized_effect_race_tests!(
    ask_spend_reservation_logout_wins_before_authorized_effect_reservation,
    ask_spend_reservation_authorized_effect_reservation_wins_before_logout,
    ModeOnlyMigrationAuthorizedEffectSite::AskSpendReservation
);

#[tokio::test]
async fn client_mutation_acknowledgement_service_branch_stays_mode_only() {
    let fixture = finite_authority_matrix_fixture().await;
    let handshake = fixture
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .header(header::AUTHORIZATION, format!("Bearer {}", fixture.token))
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .header("x-snapback-authority-descriptor-protocol", "1")
                .body(Body::empty())
                .expect("service ACK handshake request"),
        )
        .await
        .expect("service ACK handshake response");
    assert_eq!(handshake.status(), StatusCode::OK);
    let authority_descriptor = response_json(handshake).await["authorityDescriptor"].clone();
    let mutation_id = format!("cm_service_ack_{}", Uuid::new_v4().simple());
    let seeded = fixture
        .router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mutation/queuedWrite")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {}", fixture.token))
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .header("x-snapback-authority-descriptor-protocol", "1")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "args": { "value": "service-ack-mode-only" },
                        "clientMutationId": mutation_id,
                        "authorityDescriptor": authority_descriptor,
                    }))
                    .expect("serialize service ACK seed mutation"),
                ))
                .expect("service ACK seed mutation request"),
        )
        .await
        .expect("service ACK seed mutation response");
    let status = seeded.status();
    let seeded = response_json(seeded).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "service ACK seed mutation: {seeded}"
    );

    let authority = prepared_test_service_route_authority(
        &fixture.state,
        InvocationSource::MutationSettlementAcknowledgement,
        &fixture.token,
    )
    .await;
    assert!(matches!(
        authority.resolved(),
        ResolvedAppAuthority::ServicePrincipal(_)
    ));
    let pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::BeforeAuthorizedEffectReservation,
    );
    let mut headers = HeaderMap::new();
    headers.insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(pause.id()).expect("service ACK reservation pause header"),
    );
    let Json(response) = super::acknowledge_mutations(
        State(fixture.state.snapback.clone()),
        Extension(authority),
        headers,
        Ok(Json(MutationAcknowledgementRequest {
            auth: AuthInput::default(),
            authority_descriptor: serde_json::from_value(authority_descriptor)
                .expect("decode service ACK authority descriptor"),
            client_mutation_ids: vec![mutation_id],
        })),
    )
    .await
    .expect("service ACK mode-only branch succeeds");
    assert_eq!(response.acknowledged, 1);
    assert!(
        !pause.has_reached(),
        "service acknowledgement unexpectedly entered the session reservation branch"
    );
}

macro_rules! immediate_push_authorized_effect_race_tests {
    ($logout_test:ident, $reservation_test:ident, $site:expr) => {
        #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
        async fn $logout_test() {
            immediate_push_logout_wins($site).await;
        }

        #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
        async fn $reservation_test() {
            immediate_push_reservation_wins($site).await;
        }
    };
}

immediate_push_authorized_effect_race_tests!(
    immediate_push_reservation_logout_wins_before_authorized_effect_reservation,
    immediate_push_authorized_effect_reservation_wins_before_logout,
    ImmediatePushAuthorizedEffectSite::Reservation
);

immediate_push_authorized_effect_race_tests!(
    immediate_push_batch_claim_logout_wins_before_authorized_effect_reservation,
    immediate_push_batch_claim_authorized_effect_reservation_wins_before_logout,
    ImmediatePushAuthorizedEffectSite::BatchClaim
);

immediate_push_authorized_effect_race_tests!(
    immediate_push_transmitting_marker_logout_wins_before_authorized_effect_reservation,
    immediate_push_transmitting_marker_authorized_effect_reservation_wins_before_logout,
    ImmediatePushAuthorizedEffectSite::TransmittingMarker
);

/// The complementary ordering for the split-phase fence: once the mutation
/// reserves authority, logout may close new work but must drain this permit
/// before its durable terminal write. The mutation therefore commits first;
/// its later response publication is still refused by the pending logout.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn authorized_effect_reservation_commits_before_logout_terminal_write() {
    let state = sessions_activation_server_fixture_async().await;
    let credential = mint_test_credential(&state, "logout-reserved-race@example.test").await;
    let bearer = credential["token"]
        .as_str()
        .expect("ordinary session bearer")
        .to_owned();
    let session_id = credential["session"]["id"]
        .as_str()
        .expect("ordinary session id")
        .to_owned();
    let router = app(state.clone());
    let item_count_before = finite_authority_matrix_item_count(&state).await;

    let mutation_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
    );
    let mut mutation_request = session_auth_http_request(
        "/mutation/queuedWrite",
        serde_json::to_vec(&json!({
            "args": { "value": "commits-before-logout" },
        }))
        .expect("serialize reservation-winning mutation"),
        &bearer,
    );
    mutation_request.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(mutation_pause.id()).expect("mutation reservation pause header"),
    );
    let mutation_router = router.clone();
    let mutation = tokio::spawn(async move {
        mutation_router
            .oneshot(mutation_request)
            .await
            .expect("reservation-winning mutation response")
    });
    tokio::time::timeout(Duration::from_secs(5), mutation_pause.wait_until_reached())
        .await
        .expect("mutation reserves authority before Local");

    let logout_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterSessionTerminalPremark,
    );
    let mut logout_request = session_auth_http_request("/auth/logout", br#"{}"#.to_vec(), &bearer);
    logout_request.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(logout_pause.id()).expect("logout premark pause header"),
    );
    let logout_router = router.clone();
    let logout = tokio::spawn(async move {
        logout_router
            .oneshot(logout_request)
            .await
            .expect("permit-draining logout response")
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        !logout.is_finished(),
        "logout cannot finish while predecessor authority work is reserved"
    );

    mutation_pause.release().await;
    let mutation_response = tokio::time::timeout(Duration::from_secs(5), mutation)
        .await
        .expect("reservation-winning mutation does not hang")
        .expect("reservation-winning mutation task");
    assert_eq!(mutation_response.status(), StatusCode::UNAUTHORIZED);
    let mutation_response = response_json(mutation_response).await;
    assert_eq!(
        mutation_response["diagnostic"]["code"],
        "SNAPBACK_AUTH_SESSION_EXPIRED"
    );
    assert_eq!(
        mutation_response["diagnostic"]["details"]["authorityDisposition"], "carrier",
        "the response is refused while logout is pending but not durable"
    );

    tokio::time::timeout(Duration::from_secs(5), logout_pause.wait_until_reached())
        .await
        .expect("logout premark drains after the mutation commit");
    assert_eq!(
        finite_authority_matrix_item_count(&state).await,
        item_count_before + 1,
        "the pre-reserved authorized effect commits before logout"
    );
    let precommit_session_facts = with_snapback(&state.snapback, {
        let session_id = session_id.clone();
        move |snapback| {
            snapback
                .remainder_auth_fixture()
                .auth_catalog()
                .session_lifetime_facts_for_test(&session_id)
        }
    })
    .await
    .expect("read pre-logout-commit session facts");
    assert_eq!(precommit_session_facts.2, 1);
    assert!(!precommit_session_facts.3);

    logout_pause.release().await;
    let logout_response = tokio::time::timeout(Duration::from_secs(5), logout)
        .await
        .expect("drained logout does not hang")
        .expect("drained logout task");
    assert_eq!(logout_response.status(), StatusCode::NO_CONTENT);
    let terminal_session_facts = with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .auth_catalog()
            .session_lifetime_facts_for_test(&session_id)
    })
    .await
    .expect("read committed logout session facts");
    assert_eq!(terminal_session_facts.2, 2);
    assert!(terminal_session_facts.3);
}

#[tokio::test]
async fn dormant_dev_reset_rotates_stream_without_installing_a_session_issuer() {
    // Match the production startup graph: even a dormant dev database has
    // one inspected provider and one rebuilt stream coordinator. The old
    // provider/coordinator-absent compatibility fast path is intentionally
    // unreachable in this fixture.
    let state = dormant_dev_reset_fixture_with_context(ServerContext::detached());
    assert!(!state.auth_catalog_ready);
    assert!(state.auth_provider.is_some());
    let coordinator = state
        .auth_coordinator
        .as_ref()
        .expect("dormant stream coordinator");
    let mut predecessor = coordinator
        .authorization_stream_incarnation()
        .expect("initial dormant incarnation");
    let route_admission = test_route_admission(&state).0;

    for reset_index in 0..2 {
        let reset = coordinated_app_reset(&state, &route_admission, None)
            .await
            .expect("dormant dev reset succeeds");
        assert!(reset.is_none());

        let successor = coordinator
            .authorization_stream_incarnation()
            .expect("dormant successor remains available");
        assert_ne!(successor, predecessor, "reset {reset_index} rotates stream");
        let durable = with_snapback(&state.snapback, |snapback| {
            snapback
                .remainder_auth_fixture()
                .authorization_version()
                .expect("durable dormant successor")
        })
        .await;
        assert_eq!(durable.incarnation, successor);
        assert_eq!(durable.epoch, 0);
        predecessor = successor;

        assert!(
            state
                .auth_invalidation
                .read()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .is_none(),
            "dev router has no sessions issuer",
        );
        assert!(
            state
                .connections
                .invalidation_expectation_for_test()
                .is_none(),
            "dev connections have no sessions issuer",
        );
        assert!(
            state
                .ephemeral
                .authorization_expectation_for_test()
                .is_none(),
            "dev rooms have no sessions issuer",
        );
        assert!(
            with_snapback(&state.snapback, |snapback| {
                snapback.auth_invalidation_expectation_for_test()
            })
            .await
            .is_none(),
            "dev queries have no sessions issuer",
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_rejects_preclaimed_graph_a_with_shared_snapback_b() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let directory = tempfile::tempdir().expect("AppState splice fixture directory");
    let authority_directory = directory.path().join("authority-a");
    let durable_directory = directory.path().join("durable-b");
    fs::create_dir_all(&authority_directory).expect("create graph A directory");
    fs::create_dir_all(&durable_directory).expect("create graph B directory");
    let authority_path = authority_directory.join("app.sqlite3");
    let durable_path = durable_directory.join("app.sqlite3");
    let (_authority_graph, authority_bindings, durable_graph) =
        tokio::task::spawn_blocking(move || {
            let _sanction = crate::exec_guard::BlockingSanction::acquire();
            // Copy a closed seed so A and B have identical durable bytes and
            // authorization-incarnation text but distinct process graphs and
            // commit-authority roots. A string/id comparison must not make
            // this splice legitimate.
            drop(LocalSnapback::open(&authority_path).expect("seed graph A database"));
            fs::copy(&authority_path, &durable_path).expect("copy graph A bytes to graph B");
            let mut authority_graph =
                LocalSnapback::open(&authority_path).expect("open authority graph A");
            let durable_graph = LocalSnapback::open(&durable_path).expect("open durable graph B");
            assert_ne!(
                authority_graph.database_path(),
                durable_graph.database_path(),
                "the copied-database case must not also be the equal-path case"
            );
            assert_eq!(
                authority_graph
                    .auth_rehearsal_instance_id()
                    .expect("graph A durable incarnation"),
                durable_graph
                    .auth_rehearsal_instance_id()
                    .expect("graph B durable incarnation"),
                "the adversarial graphs must share the copied durable incarnation identifier"
            );
            let authority_bindings = authority_graph
                .claim_app_state_graph(
                    ServerProfile::Test,
                    crate::auth::deployment::AuthDeploymentTarget::Local,
                )
                .expect("claim graph A before the splice attempt");
            (authority_graph, authority_bindings, durable_graph)
        })
        .await
        .expect("join same-identity A/B graph construction");
    assert_preclaimed_app_state_splice_refused(
        authority_bindings,
        durable_graph,
        "same-copied-incarnation",
    )
    .await;

    let (_memory_authority_graph, memory_bindings, memory_durable_graph) =
        tokio::task::spawn_blocking(|| {
            let _sanction = crate::exec_guard::BlockingSanction::acquire();
            let mut authority_graph = LocalSnapback::memory().expect("memory authority graph A");
            let durable_graph = LocalSnapback::memory().expect("memory durable graph B");
            assert_eq!(
                authority_graph.database_path(),
                durable_graph.database_path(),
                "the in-memory case must share the absent path identity"
            );
            assert_ne!(
                authority_graph
                    .auth_rehearsal_instance_id()
                    .expect("memory graph A durable incarnation"),
                durable_graph
                    .auth_rehearsal_instance_id()
                    .expect("memory graph B durable incarnation"),
                "the in-memory case must complement the copied-incarnation case"
            );
            let authority_bindings = authority_graph
                .claim_app_state_graph(
                    ServerProfile::Test,
                    crate::auth::deployment::AuthDeploymentTarget::Local,
                )
                .expect("claim memory graph A before the splice attempt");
            (authority_graph, authority_bindings, durable_graph)
        })
        .await
        .expect("join same-path A/B graph construction");
    assert_preclaimed_app_state_splice_refused(
        memory_bindings,
        memory_durable_graph,
        "same-absent-path",
    )
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_rejects_authority_against_a_wholly_replaced_destination_bundle() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let authority_database = CommitCapsulePrototypeDatabase::new().await;
    let durable_database = CommitCapsulePrototypeDatabase::new().await;
    let caller =
        CommitCapsuleCallerFixture::new(&authority_database.app_state, "foreign-destination").await;

    // This replaces both the state and its binding, producing destination
    // {state B, admission B, authority B} against caller authority A. It
    // proves the admission comparison rejects a wholly foreign destination.
    // The construction-origin splice {state B, admission A, authority A} is
    // covered separately at the AppState constructor that now refuses it.
    let mut hybrid = authority_database.app_state.clone();
    hybrid.snapback = durable_database.app_state.snapback.clone();
    hybrid.commit_capsule_runtime = durable_database.app_state.commit_capsule_runtime.clone();
    let Err(error) = super::CommitCapsuleDestination::bind(&hybrid, caller.authority()) else {
        panic!("an authority must not bind against a wholly foreign destination bundle")
    };
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_COMMIT_CAPSULE_DESTINATION_MISMATCH"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_rejects_committed_decoy_rows() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let decoy = commit_capsule_intent("lying-reconciliation-decoy");
    let decoy_caller =
        CommitCapsuleCallerFixture::new(&database.app_state, "lying-reconciliation-decoy").await;
    let decoy_retention = commit_capsule_retention(&decoy)
        .expect("reserve decoy uncertainty retention")
        .0;
    let decoy_outcome = run_commit_capsule_prototype(
        decoy_caller.destination(),
        tokio::time::Instant::now() + Duration::from_secs(3),
        (),
        decoy.clone(),
        CommitCapsuleInjection::Success,
        CommitCapsuleHooks::default(),
        decoy_caller.expected_guard(),
        Arc::new(StdMutex::new(None)),
        decoy_retention,
    )
    .await;
    assert!(matches!(
        decoy_outcome,
        super::CommitCapsuleOutcome::Committed {
            reconciled: false,
            ..
        }
    ));

    let intent = commit_capsule_intent("lying-reconciliation-target");
    let caller =
        CommitCapsuleCallerFixture::new(&database.app_state, "lying-reconciliation-target").await;
    let (terminal, gate) = CommitCapsuleTerminalFixture::new().await;
    let (retention, retained) =
        commit_capsule_retention(&intent).expect("reserve target uncertainty retention");
    let outcome = run_commit_capsule_prototype(
        caller.destination(),
        tokio::time::Instant::now() + Duration::from_secs(3),
        gate,
        intent.clone(),
        CommitCapsuleInjection::CommitErrorRowsAbsent,
        // Reconciliation derives its query subject from the private intended-
        // rows carrier. The already committed decoy therefore cannot be
        // supplied as a replacement query subject.
        CommitCapsuleHooks::default(),
        caller.expected_guard(),
        Arc::new(StdMutex::new(None)),
        retention,
    )
    .await;

    let super::CommitCapsuleOutcome::Uncertain(error) = outcome else {
        panic!("a reconciliation witness for another operation must remain uncertain")
    };
    assert_eq!(
        error.diagnostic.details["causeCode"],
        "SNAPBACK_COMMIT_INTENDED_ROWS_ABSENT"
    );
    assert_eq!(error.diagnostic.details["effectMayHaveCommitted"], true);
    assert!(!database.facts(&intent).await.exact_intended_rows);
    assert_eq!(
        retained.snapshot().unwrap().state,
        super::CommitUncertainRetentionState::Recoverable
    );
    assert!(terminal.is_fail_closed());
    drop(
        retained
            .remove_after_recovery(&intent.operation_id)
            .expect("remove lying-reconciliation uncertainty after exact recovery"),
    );
    terminal.assert_reopened();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_final_cut_is_one_shot_after_exact_existing() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let intent = commit_capsule_intent("exact-existing-consumes-final-cut");
    let caller =
        CommitCapsuleCallerFixture::new(&database.app_state, "exact-existing-consumes-final-cut")
            .await;
    let first = run_commit_capsule_prototype(
        caller.destination(),
        tokio::time::Instant::now() + Duration::from_secs(3),
        (),
        intent.clone(),
        CommitCapsuleInjection::Success,
        CommitCapsuleHooks::default(),
        caller.expected_guard(),
        Arc::new(StdMutex::new(None)),
        commit_capsule_retention(&intent)
            .expect("reserve first exact-existing retention")
            .0,
    )
    .await;
    assert!(matches!(
        first,
        super::CommitCapsuleOutcome::Committed {
            reconciled: false,
            ..
        }
    ));

    let destination = caller.destination();
    let expected_guard = caller.expected_guard();
    let retry_intent = intent.clone();
    let task = tokio::spawn(async move {
        run_commit_capsule_prototype(
            destination,
            tokio::time::Instant::now() + Duration::from_secs(3),
            (),
            retry_intent.clone(),
            CommitCapsuleInjection::Success,
            CommitCapsuleHooks {
                reuse_final_cut: true,
                ..CommitCapsuleHooks::default()
            },
            expected_guard,
            Arc::new(StdMutex::new(None)),
            commit_capsule_retention(&retry_intent)
                .expect("reserve exact-existing retry retention")
                .0,
        )
        .await
    });
    let panic = task
        .await
        .expect_err("a second use of FinalCommitCut must panic before COMMIT");
    assert!(panic.is_panic());
    let second_facts = database
        .facts(&commit_capsule_intent(
            "second-operation-after-exact-existing",
        ))
        .await;
    assert_eq!(
        second_facts.operation_rows, 1,
        "only the predecessor exists"
    );
    assert_eq!(
        second_facts.proof_rows, 1,
        "only the predecessor proof exists"
    );
}

#[test]
fn bounded_commit_capsule_diagnostics_are_typed_503s_with_effect_facts() {
    for (phase, code, phase_name) in [
        (
            super::CommitTimeoutPhase::WriterAcquire,
            "SNAPBACK_WRITER_ACQUIRE_TIMEOUT",
            "writerAcquire",
        ),
        (
            super::CommitTimeoutPhase::FinalCut,
            "SNAPBACK_COMMIT_DEADLINE_EXCEEDED",
            "finalCut",
        ),
    ] {
        let error = phase.diagnostic();
        assert_eq!(error.diagnostic.code, code);
        assert_eq!(error.diagnostic.details["phase"], phase_name);
        assert_eq!(error.diagnostic.details["effectCommitted"], false);
        assert_eq!(error.diagnostic.details["effectMayHaveCommitted"], false);
        assert_eq!(error.diagnostic.details["retryable"], true);
        assert_eq!(
            status_for_diagnostic_code(code),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
    assert_eq!(
        status_for_diagnostic_code("SNAPBACK_COMMIT_OUTCOME_UNCERTAIN"),
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bounded_commit_capsule_retention_exhaustion_is_typed_and_effect_free() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let intent = commit_capsule_intent("retention-registry-exhaustion");
    let mut reservations =
        Vec::with_capacity(super::commit_capsule::MAX_COMMIT_UNCERTAIN_RETENTIONS);
    for _ in 0..super::commit_capsule::MAX_COMMIT_UNCERTAIN_RETENTIONS {
        reservations.push(
            commit_capsule_retention::<()>(&intent)
                .expect("every slot through the declared retention bound is available"),
        );
    }

    let snapshots = super::CommitUncertainRetentionHandle::<CommitCapsuleUncertain<()>>::
        snapshots_by_operation_identity(&intent.operation_id);
    assert_eq!(
        snapshots.len(),
        super::commit_capsule::MAX_COMMIT_UNCERTAIN_RETENTIONS
    );
    assert!(snapshots.iter().all(|snapshot| {
        snapshot.operation_identity == intent.operation_id.as_ref()
            && snapshot.state == super::CommitUncertainRetentionState::Reserved
    }));

    let error = match commit_capsule_retention::<()>(&intent) {
        Ok(_) => panic!("the retention registry must refuse its first over-bound reservation"),
        Err(error) => error,
    };
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_EXHAUSTED"
    );
    assert_eq!(
        error.diagnostic.details["maxEntries"],
        super::commit_capsule::MAX_COMMIT_UNCERTAIN_RETENTIONS
    );
    assert_eq!(error.diagnostic.details["effectCommitted"], false);
    assert_eq!(error.diagnostic.details["effectMayHaveCommitted"], false);
    assert_eq!(error.diagnostic.details["retryable"], false);

    drop(reservations);
    assert!(
        super::CommitUncertainRetentionHandle::<CommitCapsuleUncertain<()>>::
            snapshots_by_operation_identity(&intent.operation_id)
            .is_empty()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_unpolled_future_owns_no_authority_permit() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let intent = commit_capsule_intent("unpolled-reservation");
    let caller = CommitCapsuleCallerFixture::new(&database.app_state, "unpolled-reservation").await;
    let deadline = tokio::time::Instant::now() + Duration::from_millis(200);
    let (retention, _retained) = commit_capsule_retention(&intent)
        .expect("reserve bounded commit capsule uncertainty retention");

    // Constructing the future transfers only prepared authority. Until the
    // capsule is polled, no reservation exists that can pin terminal logout.
    let capsule = run_commit_capsule_prototype(
        caller.destination(),
        deadline,
        (),
        intent.clone(),
        CommitCapsuleInjection::Success,
        CommitCapsuleHooks::default(),
        caller.expected_guard(),
        Arc::new(StdMutex::new(None)),
        retention,
    );
    assert_commit_capsule_logout_completes(caller.spawn_logout_drain()).await;
    tokio::time::sleep_until(deadline + Duration::from_millis(25)).await;

    let outcome = capsule.await;
    assert!(matches!(
        outcome,
        super::CommitCapsuleOutcome::TimedOut {
            phase: super::CommitTimeoutPhase::WriterAcquire
        }
    ));
    let facts = database.facts(&intent).await;
    assert_eq!(facts.operation_rows, 0);
    assert_eq!(facts.proof_rows, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_live_reservation_refusal_is_not_timeout() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let intent = commit_capsule_intent("entry-refusal");
    let caller = CommitCapsuleCallerFixture::new(&database.app_state, "entry-refusal").await;
    let authority = caller.authority();
    let destination = super::CommitCapsuleDestination::bind(&caller.state, authority)
        .expect("bind the pre-logout authority to its database");
    let expected_guard = caller.expected_guard();

    // End the prepared caller authority before the capsule is first polled.
    // The still-live deadline must not hide that terminal refusal as a 503.
    assert_commit_capsule_logout_completes(caller.spawn_logout_drain()).await;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    let (retention, retained) = commit_capsule_retention(&intent)
        .expect("reserve bounded commit capsule uncertainty retention");
    let outcome = run_commit_capsule_prototype(
        destination,
        deadline,
        (),
        intent.clone(),
        CommitCapsuleInjection::Success,
        CommitCapsuleHooks::default(),
        expected_guard,
        Arc::new(StdMutex::new(None)),
        retention,
    )
    .await;

    assert!(tokio::time::Instant::now() < deadline);
    let super::CommitCapsuleOutcome::Refused(error) = outcome else {
        panic!("a live capsule-entry refusal must remain Refused")
    };
    assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_SESSION_EXPIRED");
    assert_eq!(
        error.diagnostic.details["capsuleOutcome"],
        "authorityRefused"
    );
    assert_eq!(error.diagnostic.details["effectCommitted"], false);
    assert_eq!(error.diagnostic.details["effectMayHaveCommitted"], false);
    assert_eq!(error.diagnostic.details["retryable"], false);
    assert!(retained.is_empty());
    let facts = database.facts(&intent).await;
    assert_eq!(facts.operation_rows, 0);
    assert_eq!(facts.proof_rows, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_queue_timeout_preserves_fifo_and_drains_logout() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let intent = commit_capsule_intent("queue-timeout");
    let caller = CommitCapsuleCallerFixture::new(&database.app_state, "queue-timeout").await;
    let reservation_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
    );
    let reservation_pause_id = reservation_pause.id().to_owned();
    let deadline = tokio::time::Instant::now() + Duration::from_millis(1_200);
    let destination = caller.destination();
    let expected_guard = caller.expected_guard();
    let (terminal, gate) = CommitCapsuleTerminalFixture::new().await;
    let order = Arc::new(StdMutex::new(Vec::new()));

    let receipt = Arc::new(StdMutex::new(None));
    let (retention, retained) = commit_capsule_retention(&intent)
        .expect("reserve bounded commit capsule uncertainty retention");
    let capsule_receipt = receipt.clone();
    let capsule = tokio::spawn(async move {
        run_commit_capsule_prototype(
            destination,
            deadline,
            gate,
            intent,
            CommitCapsuleInjection::Success,
            CommitCapsuleHooks {
                reservation_pause_id: Some(reservation_pause_id),
                ..CommitCapsuleHooks::default()
            },
            expected_guard,
            capsule_receipt,
            retention,
        )
        .await
    });
    reservation_pause.wait_until_reached().await;
    let logout = caller.start_logout_drain().await;
    let initial_writer = database.state.clone().lock_owned().await;

    let a_state = database.state.clone();
    let a_order = order.clone();
    let waiter_a = tokio::spawn(async move {
        let _guard = super::writer_gate::lock_managed_snapback(&a_state).await;
        a_order
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push('A');
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    reservation_pause.release().await;
    tokio::time::sleep(Duration::from_millis(20)).await;

    let c_state = database.state.clone();
    let c_order = order.clone();
    let waiter_c = tokio::spawn(async move {
        let _guard = super::writer_gate::lock_managed_snapback(&c_state).await;
        c_order
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push('C');
    });

    let outcome = tokio::time::timeout(Duration::from_secs(2), capsule)
        .await
        .expect("queued capsule expires")
        .expect("queued capsule task joins");
    assert!(matches!(
        outcome,
        super::CommitCapsuleOutcome::TimedOut {
            phase: super::CommitTimeoutPhase::WriterAcquire
        }
    ));
    assert!(receipt.lock().unwrap().is_none());
    assert!(retained.is_empty());
    terminal.assert_reopened();

    drop(initial_writer);
    tokio::time::timeout(Duration::from_secs(2), async {
        waiter_a.await.expect("waiter A joins");
        waiter_c.await.expect("waiter C joins");
    })
    .await
    .expect("ordinary waiters are not starved");
    assert_commit_capsule_logout_completes(logout).await;
    assert_eq!(*order.lock().unwrap(), vec!['A', 'C']);
    let facts = database
        .facts(&commit_capsule_intent("queue-timeout"))
        .await;
    assert_eq!(facts.operation_rows, 0);
    assert_eq!(facts.proof_rows, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_handoff_timeout_drops_only_its_waiter_and_drains_logout() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let intent = commit_capsule_intent("handoff-timeout");
    let managed_handoff =
        with_snapback(&database.state, |local| local.managed_local_handoff()).await;
    let caller = CommitCapsuleCallerFixture::new(&database.app_state, "handoff-timeout").await;
    let reservation_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
    );
    let reservation_pause_id = reservation_pause.id().to_owned();
    let deadline = tokio::time::Instant::now() + Duration::from_millis(400);
    let destination = caller.destination();
    let expected_guard = caller.expected_guard();
    let (terminal, gate) = CommitCapsuleTerminalFixture::new().await;
    let receipt = Arc::new(StdMutex::new(None));
    let (retention, retained) = commit_capsule_retention(&intent)
        .expect("reserve bounded commit capsule uncertainty retention");
    let capsule = tokio::spawn({
        let receipt = receipt.clone();
        async move {
            run_commit_capsule_prototype(
                destination,
                deadline,
                gate,
                intent,
                CommitCapsuleInjection::Success,
                CommitCapsuleHooks {
                    reservation_pause_id: Some(reservation_pause_id),
                    ..CommitCapsuleHooks::default()
                },
                expected_guard,
                receipt,
                retention,
            )
            .await
        }
    });
    reservation_pause.wait_until_reached().await;
    let logout = caller.start_logout_drain().await;
    managed_handoff.close();
    let waiter_reached =
        super::writer_gate::install_managed_handoff_waiter_test_hook(&managed_handoff);
    reservation_pause.release().await;
    tokio::time::timeout(Duration::from_secs(2), waiter_reached.notified())
        .await
        .expect("capsule reaches the closed handoff wait");
    let outcome = tokio::time::timeout(Duration::from_secs(2), capsule)
        .await
        .expect("handoff capsule expires")
        .expect("handoff capsule task joins");
    assert!(matches!(
        outcome,
        super::CommitCapsuleOutcome::TimedOut {
            phase: super::CommitTimeoutPhase::WriterAcquire
        }
    ));
    assert!(
        managed_handoff.is_closed(),
        "the capsule never reopens another owner's handoff"
    );
    let raw_guard = database
        .state
        .clone()
        .try_lock_owned()
        .expect("timed-out handoff waiter owns no Local guard");
    drop(raw_guard);
    assert!(receipt.lock().unwrap().is_none());
    assert!(retained.is_empty());
    terminal.assert_reopened();
    managed_handoff.reopen();
    assert_commit_capsule_logout_completes(logout).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_post_staging_barrier_is_invisible_and_unwind_safe() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let intent = commit_capsule_intent("post-staging-success");
    let caller = CommitCapsuleCallerFixture::new(&database.app_state, "post-staging-success").await;
    let reservation_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
    );
    let reservation_pause_id = reservation_pause.id().to_owned();
    let barrier = Arc::new(CommitCapsuleBarrier::default());
    let receipt = Arc::new(StdMutex::new(None));
    let (retention, _retained) = commit_capsule_retention(&intent)
        .expect("reserve bounded commit capsule uncertainty retention");
    let destination = caller.destination();
    let capsule = tokio::spawn({
        let barrier = barrier.clone();
        let receipt = receipt.clone();
        let intent = intent.clone();
        let expected_guard = caller.expected_guard();
        async move {
            run_commit_capsule_prototype(
                destination,
                tokio::time::Instant::now() + Duration::from_secs(3),
                (),
                intent,
                CommitCapsuleInjection::Success,
                CommitCapsuleHooks {
                    reservation_pause_id: Some(reservation_pause_id),
                    post_staging: Some(barrier),
                    ..CommitCapsuleHooks::default()
                },
                expected_guard,
                receipt,
                retention,
            )
            .await
        }
    });
    reservation_pause.wait_until_reached().await;
    let logout = caller.start_logout_drain().await;
    reservation_pause.release().await;
    barrier.wait_until_reached().await;
    let path = database.path.clone();
    let staged_intent = intent.clone();
    let staged = tokio::task::spawn_blocking(move || {
        crate::storage::commit_capsule_prototype::facts_from_path(&path, &staged_intent)
            .expect("inspect staged rows from a separate connection")
    })
    .await
    .unwrap();
    assert_eq!(staged.operation_rows, 0);
    assert_eq!(staged.proof_rows, 0);
    barrier.release();
    let outcome = capsule.await.expect("post-staging capsule task joins");
    assert!(matches!(
        outcome,
        super::CommitCapsuleOutcome::Committed {
            reconciled: false,
            ..
        }
    ));
    let observed = receipt.lock().unwrap().clone().expect("commit observation");
    assert_eq!(observed.matching_commits(), 1);
    assert_eq!(observed.mismatched_commits(), 0);
    assert_commit_capsule_logout_completes(logout).await;
    let facts = database.facts(&intent).await;
    assert_eq!(facts.operation_rows, 1);
    assert_eq!(facts.proof_rows, 1);
    assert!(facts.exact_intended_rows);

    let panic_database = CommitCapsulePrototypeDatabase::new().await;
    let panic_intent = commit_capsule_intent("post-staging-panic");
    let panic_caller =
        CommitCapsuleCallerFixture::new(&panic_database.app_state, "post-staging-panic").await;
    let panic_reservation_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
    );
    let panic_reservation_pause_id = panic_reservation_pause.id().to_owned();
    let (terminal, gate) = CommitCapsuleTerminalFixture::new().await;
    let panic_barrier = Arc::new(CommitCapsuleBarrier::default());
    let panic_destination = panic_caller.destination();
    let panic_task = tokio::spawn({
        let barrier = panic_barrier.clone();
        let intent = panic_intent.clone();
        let receipt = Arc::new(StdMutex::new(None));
        let retention = commit_capsule_retention(&intent)
            .expect("reserve bounded commit capsule uncertainty retention")
            .0;
        let expected_guard = panic_caller.expected_guard();
        async move {
            run_commit_capsule_prototype(
                panic_destination,
                tokio::time::Instant::now() + Duration::from_secs(3),
                gate,
                intent,
                CommitCapsuleInjection::Success,
                CommitCapsuleHooks {
                    reservation_pause_id: Some(panic_reservation_pause_id),
                    post_staging: Some(barrier),
                    panic_post_staging: true,
                    ..CommitCapsuleHooks::default()
                },
                expected_guard,
                receipt,
                retention,
            )
            .await
        }
    });
    panic_reservation_pause.wait_until_reached().await;
    let panic_logout = panic_caller.start_logout_drain().await;
    panic_reservation_pause.release().await;
    panic_barrier.wait_until_reached().await;
    panic_barrier.release();
    let panicked = panic_task
        .await
        .expect_err("post-staging panic reaches the caller task");
    assert!(panicked.is_panic());
    terminal.assert_reopened();
    assert_commit_capsule_logout_completes(panic_logout).await;
    let facts = panic_database.facts(&panic_intent).await;
    assert_eq!(facts.operation_rows, 0);
    assert_eq!(facts.proof_rows, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_final_cut_timeout_rolls_back_and_drains_every_carrier() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let intent = commit_capsule_intent("final-cut-timeout");
    let caller = CommitCapsuleCallerFixture::new(&database.app_state, "final-cut-timeout").await;
    let reservation_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
    );
    let reservation_pause_id = reservation_pause.id().to_owned();
    let destination = caller.destination();
    let expected_guard = caller.expected_guard();
    let (terminal, gate) = CommitCapsuleTerminalFixture::new().await;
    let barrier = Arc::new(CommitCapsuleBarrier::default());
    let receipt = Arc::new(StdMutex::new(None));
    let (retention, retained) = commit_capsule_retention(&intent)
        .expect("reserve bounded commit capsule uncertainty retention");
    let deadline = tokio::time::Instant::now() + Duration::from_millis(350);
    let capsule = tokio::spawn({
        let barrier = barrier.clone();
        let receipt = receipt.clone();
        let intent = intent.clone();
        async move {
            run_commit_capsule_prototype(
                destination,
                deadline,
                gate,
                intent,
                CommitCapsuleInjection::Success,
                CommitCapsuleHooks {
                    reservation_pause_id: Some(reservation_pause_id),
                    pre_guard: Some(barrier),
                    ..CommitCapsuleHooks::default()
                },
                expected_guard,
                receipt,
                retention,
            )
            .await
        }
    });
    reservation_pause.wait_until_reached().await;
    let logout = caller.start_logout_drain().await;
    reservation_pause.release().await;
    barrier.wait_until_reached().await;
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert!(
        !capsule.is_finished(),
        "the synchronous pre-guard barrier owns the capsule until released"
    );
    barrier.release();
    let outcome = capsule.await.expect("final-cut timeout task joins");
    assert!(matches!(
        outcome,
        super::CommitCapsuleOutcome::TimedOut {
            phase: super::CommitTimeoutPhase::FinalCut
        }
    ));
    let observed = receipt
        .lock()
        .unwrap()
        .clone()
        .expect("final-cut observation");
    assert_eq!(observed.matching_commits(), 0);
    assert_eq!(observed.mismatched_commits(), 0);
    assert!(retained.is_empty());
    terminal.assert_reopened();
    assert_commit_capsule_logout_completes(logout).await;

    drop(caller);
    let CommitCapsulePrototypeDatabase {
        _directory: directory,
        path,
        state,
        app_state,
    } = database;
    drop(state);
    drop(app_state);
    let reopen_intent = intent.clone();
    let reopened = tokio::task::spawn_blocking(move || {
        crate::storage::commit_capsule_prototype::facts_from_path(&path, &reopen_intent)
            .expect("reopen final-cut timeout database")
    })
    .await
    .unwrap();
    assert_eq!(reopened.operation_rows, 0);
    assert_eq!(reopened.proof_rows, 0);
    assert!(!reopened.exact_intended_rows);
    drop(directory);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_final_guard_refusal_rolls_back_and_drains_logout() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let intent = commit_capsule_intent("final-guard-refusal");
    let caller = CommitCapsuleCallerFixture::new(&database.app_state, "final-guard-refusal").await;
    let reservation_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
    );
    let reservation_pause_id = reservation_pause.id().to_owned();
    let destination = caller.destination();
    let expected_guard = caller.expected_guard();
    let (terminal, gate) = CommitCapsuleTerminalFixture::new().await;
    let barrier = Arc::new(CommitCapsuleBarrier::default());
    let receipt = Arc::new(StdMutex::new(None));
    let (retention, retained) = commit_capsule_retention(&intent)
        .expect("reserve bounded commit capsule uncertainty retention");
    let capsule = tokio::spawn({
        let barrier = barrier.clone();
        let receipt = receipt.clone();
        let intent = intent.clone();
        async move {
            run_commit_capsule_prototype(
                destination,
                tokio::time::Instant::now() + Duration::from_secs(3),
                gate,
                intent,
                CommitCapsuleInjection::Success,
                CommitCapsuleHooks {
                    reservation_pause_id: Some(reservation_pause_id),
                    pre_guard: Some(barrier),
                    commit_guard_failure: Some(SnapbackError::error(
                        "SNAPBACK_AUTH_SESSION_EXPIRED",
                        "auth",
                        "injected bounded commit capsule final-guard refusal",
                    )),
                    ..CommitCapsuleHooks::default()
                },
                expected_guard,
                receipt,
                retention,
            )
            .await
        }
    });
    reservation_pause.wait_until_reached().await;
    let logout = caller.start_logout_drain().await;
    reservation_pause.release().await;
    barrier.wait_until_reached().await;
    barrier.release();
    let outcome = capsule.await.expect("final-guard refusal task joins");
    let super::CommitCapsuleOutcome::Refused(error) = outcome else {
        panic!("final-guard injection must return Refused")
    };
    assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_SESSION_EXPIRED");
    assert_eq!(
        error.diagnostic.details["capsuleOutcome"],
        "authorityRefused"
    );
    assert_eq!(error.diagnostic.details["effectCommitted"], false);
    assert_eq!(error.diagnostic.details["effectMayHaveCommitted"], false);
    let observed = receipt
        .lock()
        .unwrap()
        .clone()
        .expect("refusal observation");
    assert_eq!(observed.matching_commits(), 0);
    assert_eq!(observed.mismatched_commits(), 0);
    assert!(retained.is_empty());
    terminal.assert_reopened();
    assert_commit_capsule_logout_completes(logout).await;
    let facts = database.facts(&intent).await;
    assert_eq!(facts.operation_rows, 0);
    assert_eq!(facts.proof_rows, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_known_rollback_drops_reservation_and_terminal_gate() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let intent = commit_capsule_intent("known-rollback");
    let caller = CommitCapsuleCallerFixture::new(&database.app_state, "known-rollback").await;
    let reservation_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
    );
    let reservation_pause_id = reservation_pause.id().to_owned();
    let (terminal, gate) = CommitCapsuleTerminalFixture::new().await;
    let barrier = Arc::new(CommitCapsuleBarrier::default());
    let destination = caller.destination();
    let retention = commit_capsule_retention(&intent)
        .expect("reserve bounded commit capsule uncertainty retention")
        .0;
    let capsule = tokio::spawn({
        let barrier = barrier.clone();
        let intent = intent.clone();
        let expected_guard = caller.expected_guard();
        async move {
            run_commit_capsule_prototype(
                destination,
                tokio::time::Instant::now() + Duration::from_secs(3),
                gate,
                intent,
                CommitCapsuleInjection::RollbackBeforeCommit,
                CommitCapsuleHooks {
                    reservation_pause_id: Some(reservation_pause_id),
                    post_staging: Some(barrier),
                    ..CommitCapsuleHooks::default()
                },
                expected_guard,
                Arc::new(StdMutex::new(None)),
                retention,
            )
            .await
        }
    });
    reservation_pause.wait_until_reached().await;
    let logout = caller.start_logout_drain().await;
    reservation_pause.release().await;
    barrier.wait_until_reached().await;
    barrier.release();
    let outcome = capsule.await.expect("known-rollback capsule task joins");
    let super::CommitCapsuleOutcome::RolledBack(error) = outcome else {
        panic!("rollback-before-COMMIT injection must remain a known rollback")
    };
    assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
    assert_eq!(error.diagnostic.details["effectCommitted"], false);
    assert_eq!(error.diagnostic.details["effectMayHaveCommitted"], false);
    terminal.assert_reopened();
    assert_commit_capsule_logout_completes(logout).await;
    let facts = database.facts(&intent).await;
    assert_eq!(facts.operation_rows, 0);
    assert_eq!(facts.proof_rows, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_pre_guard_panic_rolls_back_and_releases_every_owner() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let intent = commit_capsule_intent("pre-guard-panic");
    let caller = CommitCapsuleCallerFixture::new(&database.app_state, "pre-guard-panic").await;
    let reservation_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
    );
    let reservation_pause_id = reservation_pause.id().to_owned();
    let destination = caller.destination();
    let expected_guard = caller.expected_guard();
    let (terminal, gate) = CommitCapsuleTerminalFixture::new().await;
    let barrier = Arc::new(CommitCapsuleBarrier::default());
    let retention = commit_capsule_retention(&intent)
        .expect("reserve bounded commit capsule uncertainty retention")
        .0;
    let capsule = tokio::spawn({
        let barrier = barrier.clone();
        let intent = intent.clone();
        async move {
            run_commit_capsule_prototype(
                destination,
                tokio::time::Instant::now() + Duration::from_secs(3),
                gate,
                intent,
                CommitCapsuleInjection::Success,
                CommitCapsuleHooks {
                    reservation_pause_id: Some(reservation_pause_id),
                    pre_guard: Some(barrier),
                    panic_pre_guard: true,
                    ..CommitCapsuleHooks::default()
                },
                expected_guard,
                Arc::new(StdMutex::new(None)),
                retention,
            )
            .await
        }
    });
    reservation_pause.wait_until_reached().await;
    let logout = caller.start_logout_drain().await;
    reservation_pause.release().await;
    barrier.wait_until_reached().await;
    barrier.release();
    let panicked = capsule
        .await
        .expect_err("pre-guard panic reaches the caller task");
    assert!(panicked.is_panic());
    terminal.assert_reopened();
    assert_commit_capsule_logout_completes(logout).await;
    let facts = database.facts(&intent).await;
    assert_eq!(facts.operation_rows, 0);
    assert_eq!(facts.proof_rows, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_during_commit_never_times_out_and_reconciles_exact_rows_only() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    for (injection, suffix, expected_operations, expected_proofs, committed) in [
        (
            CommitCapsuleInjection::SuccessWithLostAcknowledgement,
            "lost-ack",
            1,
            1,
            true,
        ),
        (
            CommitCapsuleInjection::CommitErrorRowsPresent,
            "rows-present",
            1,
            1,
            true,
        ),
        (
            CommitCapsuleInjection::CommitErrorRowsAbsent,
            "rows-absent",
            0,
            0,
            false,
        ),
        (
            CommitCapsuleInjection::CommitErrorRowsPartial,
            "rows-partial",
            1,
            0,
            false,
        ),
    ] {
        let database = CommitCapsulePrototypeDatabase::new().await;
        let intent = commit_capsule_intent(&format!("during-commit-{suffix}"));
        let caller = CommitCapsuleCallerFixture::new(&database.app_state, suffix).await;
        let destination = caller.destination();
        let expected_guard = caller.expected_guard();
        let (terminal, gate) = CommitCapsuleTerminalFixture::new().await;
        let barrier = Arc::new(CommitCapsuleBarrier::default());
        let receipt = Arc::new(StdMutex::new(None));
        let (retention, retained) = commit_capsule_retention(&intent)
            .expect("reserve bounded commit capsule uncertainty retention");
        let capsule = tokio::spawn({
            let barrier = barrier.clone();
            let receipt = receipt.clone();
            let intent = intent.clone();
            async move {
                run_commit_capsule_prototype(
                    destination,
                    tokio::time::Instant::now() + Duration::from_millis(350),
                    gate,
                    intent,
                    injection,
                    CommitCapsuleHooks {
                        during_commit: Some(barrier),
                        ..CommitCapsuleHooks::default()
                    },
                    expected_guard,
                    receipt,
                    retention,
                )
                .await
            }
        });
        barrier.wait_until_reached().await;
        let logout = caller.spawn_logout_drain();
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(
            !logout.is_finished(),
            "{suffix}: logout must wait while COMMIT holds admission and the caller permit"
        );
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert!(
            !capsule.is_finished(),
            "{suffix}: deadline expiry after CommitStarted cannot finish as timeout"
        );
        barrier.release();
        let outcome = capsule
            .await
            .unwrap_or_else(|error| panic!("{suffix}: capsule task failed: {error}"));
        let observed = receipt
            .lock()
            .unwrap()
            .clone()
            .expect("during-COMMIT observation");
        assert_eq!(observed.matching_commits(), 1, "{suffix}");
        assert_eq!(observed.mismatched_commits(), 0, "{suffix}");
        assert_commit_capsule_logout_completes(logout).await;
        let facts = database.facts(&intent).await;
        assert_eq!(facts.operation_rows, expected_operations, "{suffix}");
        assert_eq!(facts.proof_rows, expected_proofs, "{suffix}");

        if committed {
            assert!(matches!(
                outcome,
                super::CommitCapsuleOutcome::Committed {
                    reconciled: true,
                    ..
                }
            ));
            assert!(facts.exact_intended_rows, "{suffix}");
            assert!(retained.is_empty(), "{suffix}");
            terminal.assert_reopened();
        } else {
            let super::CommitCapsuleOutcome::Uncertain(error) = outcome else {
                panic!("{suffix}: absent/partial intended rows must remain uncertain")
            };
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_COMMIT_OUTCOME_UNCERTAIN",
                "{suffix}"
            );
            assert_eq!(error.diagnostic.details["retryable"], false, "{suffix}");
            assert_eq!(
                error.diagnostic.details["effectCommitted"],
                Value::Null,
                "{suffix}"
            );
            assert_eq!(
                error.diagnostic.details["effectMayHaveCommitted"], true,
                "{suffix}"
            );
            assert!(!facts.exact_intended_rows, "{suffix}");
            assert_eq!(
                retained.snapshot().unwrap().state,
                super::CommitUncertainRetentionState::Recoverable,
                "{suffix}"
            );
            assert!(terminal.is_fail_closed(), "{suffix}");
            drop(
                retained
                    .remove_after_recovery(&intent.operation_id)
                    .expect("remove exact recovered uncertainty"),
            );
            terminal.assert_reopened();
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_reconciliation_panic_retains_terminal_domain() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let intent = commit_capsule_intent("reconciliation-panic");
    let caller = CommitCapsuleCallerFixture::new(&database.app_state, "reconciliation-panic").await;
    let expected_guard = caller.expected_guard();
    let (terminal, gate) = CommitCapsuleTerminalFixture::new().await;
    let barrier = Arc::new(CommitCapsuleBarrier::default());
    let receipt = Arc::new(StdMutex::new(None));
    let (retention, retained) = commit_capsule_retention(&intent)
        .expect("reserve bounded commit capsule uncertainty retention");
    let destination = caller.destination();
    let capsule = tokio::spawn({
        let barrier = barrier.clone();
        let receipt = receipt.clone();
        let intent = intent.clone();
        async move {
            run_commit_capsule_prototype(
                destination,
                tokio::time::Instant::now() + Duration::from_secs(3),
                gate,
                intent,
                CommitCapsuleInjection::CommitErrorRowsPresent,
                CommitCapsuleHooks {
                    reconcile: Some(barrier),
                    panic_reconcile: true,
                    ..CommitCapsuleHooks::default()
                },
                expected_guard,
                receipt,
                retention,
            )
            .await
        }
    });

    barrier.wait_until_reached().await;
    assert!(terminal.is_fail_closed());
    assert!(
        !capsule.is_finished(),
        "reconciliation barrier keeps the capsule live"
    );
    // The caller permit is released before reconciliation. The same durable
    // destination is intentionally used by the fixture now, so logout may
    // queue on Local until reconciliation unwinds even though it no longer
    // waits on the caller permit.
    let logout = caller.spawn_logout_drain();

    barrier.release();
    let panicked = capsule
        .await
        .expect_err("reconciliation panic reaches the caller task");
    assert!(panicked.is_panic());
    let observed = receipt
        .lock()
        .unwrap()
        .clone()
        .expect("reconciliation panic commit observation");
    assert_eq!(observed.matching_commits(), 1);
    assert_eq!(observed.mismatched_commits(), 0);
    assert_commit_capsule_logout_completes(logout).await;
    assert_eq!(
        retained.snapshot().unwrap().state,
        super::CommitUncertainRetentionState::Recoverable
    );
    assert!(terminal.is_fail_closed());
    drop(
        retained
            .remove_after_recovery(&intent.operation_id)
            .expect("remove exact reconciled panic uncertainty"),
    );
    terminal.assert_reopened();
    let facts = database.facts(&intent).await;
    assert_eq!(facts.operation_rows, 1);
    assert_eq!(facts.proof_rows, 1);
    assert!(facts.exact_intended_rows);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_retain_panic_is_safe_without_caller_storage_owner() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let intent = commit_capsule_intent("retain-panic");
    let caller = CommitCapsuleCallerFixture::new(&database.app_state, "retain-panic").await;
    let expected_guard = caller.expected_guard();
    let (terminal, gate) = CommitCapsuleTerminalFixture::new().await;
    let barrier = Arc::new(CommitCapsuleBarrier::default());
    let receipt = Arc::new(StdMutex::new(None));
    // The moved owner is the only typed storage owner. `retained` is an
    // identity-only handle; the process registry supplies the independent
    // fail-closed owner that caller discipline previously had to provide.
    let (retention, retained) = commit_capsule_retention(&intent)
        .expect("reserve bounded commit capsule uncertainty retention");
    let destination = caller.destination();
    let capsule = tokio::spawn({
        let barrier = barrier.clone();
        let receipt = receipt.clone();
        let intent = intent.clone();
        async move {
            run_commit_capsule_prototype(
                destination,
                tokio::time::Instant::now() + Duration::from_secs(3),
                gate,
                intent,
                CommitCapsuleInjection::CommitErrorRowsAbsent,
                CommitCapsuleHooks {
                    retain: Some(barrier),
                    panic_retain: true,
                    ..CommitCapsuleHooks::default()
                },
                expected_guard,
                receipt,
                retention,
            )
            .await
        }
    });

    barrier.wait_until_reached().await;
    let retaining = retained
        .snapshot()
        .expect("process-owned retention is visible by identity");
    assert_eq!(retaining.id, retained.id());
    assert_eq!(retaining.operation_identity, intent.operation_id.as_ref());
    assert_eq!(
        retaining.state,
        super::CommitUncertainRetentionState::Retaining
    );
    let active_removal = retained
        .remove_after_recovery(&intent.operation_id)
        .expect_err("active retention cannot be removed between storage and unwind");
    assert_eq!(
        active_removal.diagnostic.code,
        "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_ACTIVE"
    );
    assert!(terminal.is_fail_closed());
    assert!(
        !capsule.is_finished(),
        "retain barrier keeps the capsule live"
    );
    let logout = caller.spawn_logout_drain();

    barrier.release();
    let panicked = capsule
        .await
        .expect_err("retain-step panic reaches the caller task");
    assert!(panicked.is_panic());
    let observed = receipt
        .lock()
        .unwrap()
        .clone()
        .expect("retain panic commit observation");
    assert_eq!(observed.matching_commits(), 1);
    assert_eq!(observed.mismatched_commits(), 0);
    assert_commit_capsule_logout_completes(logout).await;
    assert_eq!(
        retained.snapshot().unwrap().state,
        super::CommitUncertainRetentionState::Recoverable
    );
    assert!(terminal.is_fail_closed());
    let facts = database.facts(&intent).await;
    assert_eq!(facts.operation_rows, 0);
    assert_eq!(facts.proof_rows, 0);
    assert!(!facts.exact_intended_rows);
    drop(
        retained
            .remove_after_recovery(&intent.operation_id)
            .expect("remove exact retain-panic uncertainty after unwind"),
    );
    terminal.assert_reopened();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_cancelled_request_is_recoverable_by_operation_identity() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let intent = commit_capsule_intent("cancelled-request-recovery");
    let operation_identity = intent.operation_id.as_ref().to_owned();
    let caller =
        CommitCapsuleCallerFixture::new(&database.app_state, "cancelled-request-recovery").await;
    let expected_guard = caller.expected_guard();
    let (terminal, gate) = CommitCapsuleTerminalFixture::new().await;
    let barrier = Arc::new(CommitCapsuleBarrier::default());
    let receipt = Arc::new(StdMutex::new(None));
    let destination = caller.destination();
    let request = tokio::spawn({
        let barrier = barrier.clone();
        let intent = intent.clone();
        let receipt = receipt.clone();
        async move {
            let (retention, request_owned_handle) = commit_capsule_retention(&intent)
                .expect("reserve cancelled request uncertainty retention");
            assert_eq!(
                request_owned_handle
                    .snapshot()
                    .expect("cancelled request retention is registered")
                    .operation_identity,
                intent.operation_id.as_ref()
            );
            run_commit_capsule_prototype(
                destination,
                tokio::time::Instant::now() + Duration::from_secs(3),
                gate,
                intent,
                CommitCapsuleInjection::CommitErrorRowsAbsent,
                CommitCapsuleHooks {
                    during_commit: Some(barrier),
                    ..CommitCapsuleHooks::default()
                },
                expected_guard,
                receipt,
                retention,
            )
            .await
        }
    });

    barrier.wait_until_reached().await;
    assert!(terminal.is_fail_closed());
    request.abort();
    let cancelled = request
        .await
        .expect_err("the request future is cancelled while blocking COMMIT continues");
    assert!(cancelled.is_cancelled());

    let logout = caller.spawn_logout_drain();
    barrier.release();
    assert_commit_capsule_logout_completes(logout).await;

    let snapshot = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let snapshots = super::CommitUncertainRetentionHandle::<
                CommitCapsuleTerminalUncertain,
            >::snapshots_by_operation_identity(&operation_identity);
            if let [snapshot] = snapshots.as_slice()
                && snapshot.state == super::CommitUncertainRetentionState::Recoverable
            {
                break snapshot.clone();
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("cancelled request retention becomes recoverable without its original handle");
    assert_eq!(snapshot.operation_identity, operation_identity);
    let observed = receipt
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
        .expect("cancelled request reached the COMMIT observer");
    assert_eq!(observed.matching_commits(), 1);
    assert_eq!(observed.mismatched_commits(), 0);

    let lookup_mismatch = super::CommitUncertainRetentionHandle::<
        CommitCapsuleTerminalUncertain,
    >::lookup_by_operation_identity("different-operation-identity", snapshot.id)
    .expect_err("registry lookup exact-checks the operation identity");
    assert_eq!(
        lookup_mismatch.diagnostic.code,
        "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_IDENTITY_MISMATCH"
    );
    let recovered = super::CommitUncertainRetentionHandle::<CommitCapsuleTerminalUncertain>::
        lookup_by_operation_identity(&operation_identity, snapshot.id)
        .expect("rediscover cancelled request recovery authority by operation identity");
    let mismatch = recovered
        .remove_after_recovery("different-operation-identity")
        .expect_err("recovery removal exact-checks the operation identity");
    assert_eq!(
        mismatch.diagnostic.code,
        "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_IDENTITY_MISMATCH"
    );
    assert!(terminal.is_fail_closed());

    let facts = database.facts(&intent).await;
    assert_eq!(facts.operation_rows, 0);
    assert_eq!(facts.proof_rows, 0);
    assert!(!facts.exact_intended_rows);
    drop(
        recovered
            .remove_after_recovery(&operation_identity)
            .expect("remove cancelled request retention after exact predecessor proof"),
    );
    terminal.assert_reopened();
    assert!(
        super::CommitUncertainRetentionHandle::<CommitCapsuleTerminalUncertain>::
            snapshots_by_operation_identity(&operation_identity)
            .is_empty()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_during_commit_panics_retain_ambiguity_and_drain_logout() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    for (injection, suffix, expected_operations, expected_proofs) in [
        (
            CommitCapsuleInjection::PanicDuringCommitBeforeStorage,
            "panic-before-storage-return",
            0,
            0,
        ),
        (
            CommitCapsuleInjection::PanicAfterCommit,
            "panic-after-storage-commit",
            1,
            1,
        ),
    ] {
        let database = CommitCapsulePrototypeDatabase::new().await;
        let intent = commit_capsule_intent(&format!("during-commit-{suffix}"));
        let caller = CommitCapsuleCallerFixture::new(&database.app_state, suffix).await;
        let destination = caller.destination();
        let expected_guard = caller.expected_guard();
        let (terminal, gate) = CommitCapsuleTerminalFixture::new().await;
        let barrier = Arc::new(CommitCapsuleBarrier::default());
        let receipt = Arc::new(StdMutex::new(None));
        let (retention, retained) = commit_capsule_retention(&intent)
            .expect("reserve bounded commit capsule uncertainty retention");
        let capsule = tokio::spawn({
            let barrier = barrier.clone();
            let receipt = receipt.clone();
            let intent = intent.clone();
            async move {
                run_commit_capsule_prototype(
                    destination,
                    tokio::time::Instant::now() + Duration::from_millis(350),
                    gate,
                    intent,
                    injection,
                    CommitCapsuleHooks {
                        during_commit: Some(barrier),
                        ..CommitCapsuleHooks::default()
                    },
                    expected_guard,
                    receipt,
                    retention,
                )
                .await
            }
        });
        barrier.wait_until_reached().await;
        let logout = caller.spawn_logout_drain();
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(
            !logout.is_finished(),
            "{suffix}: logout must wait while COMMIT holds admission and the caller permit"
        );
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert!(!capsule.is_finished(), "{suffix}");
        barrier.release();
        let panicked = capsule
            .await
            .expect_err("during-COMMIT panic reaches the caller task");
        assert!(panicked.is_panic(), "{suffix}");
        let observed = receipt
            .lock()
            .unwrap()
            .clone()
            .expect("during-COMMIT panic observation");
        assert_eq!(observed.matching_commits(), 1, "{suffix}");
        assert_eq!(observed.mismatched_commits(), 0, "{suffix}");
        assert_commit_capsule_logout_completes(logout).await;
        let facts = database.facts(&intent).await;
        assert_eq!(facts.operation_rows, expected_operations, "{suffix}");
        assert_eq!(facts.proof_rows, expected_proofs, "{suffix}");
        assert_eq!(
            retained.snapshot().unwrap().state,
            super::CommitUncertainRetentionState::Recoverable,
            "{suffix}"
        );
        assert!(terminal.is_fail_closed(), "{suffix}");
        drop(
            retained
                .remove_after_recovery(&intent.operation_id)
                .expect("remove exact during-COMMIT panic uncertainty"),
        );
        terminal.assert_reopened();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_post_commit_response_loss_and_retry_cannot_duplicate_effect() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let intent = commit_capsule_intent("post-commit-response-loss");
    let caller =
        CommitCapsuleCallerFixture::new(&database.app_state, "post-commit-response-loss").await;
    let first_receipt = Arc::new(StdMutex::new(None));
    let destination = caller.destination();
    let (reached_tx, reached_rx) = tokio::sync::oneshot::channel();
    let release_response = Arc::new(tokio::sync::Notify::new());
    let response_waiter = release_response.clone();
    let first = tokio::spawn({
        let receipt = first_receipt.clone();
        let intent = intent.clone();
        let expected_guard = caller.expected_guard();
        async move {
            let retention = commit_capsule_retention(&intent)
                .expect("reserve bounded commit capsule uncertainty retention")
                .0;
            let outcome = run_commit_capsule_prototype(
                destination,
                tokio::time::Instant::now() + Duration::from_secs(3),
                (),
                intent,
                CommitCapsuleInjection::Success,
                CommitCapsuleHooks::default(),
                expected_guard,
                receipt,
                retention,
            )
            .await;
            reached_tx
                .send(())
                .expect("signal post-COMMIT/pre-response barrier");
            response_waiter.notified().await;
            outcome
        }
    });
    tokio::time::timeout(Duration::from_secs(5), reached_rx)
        .await
        .expect("first operation reaches post-COMMIT/pre-response")
        .expect("post-COMMIT signal owner remains live");
    let observed = first_receipt
        .lock()
        .unwrap()
        .clone()
        .expect("first response-loss commit observation");
    assert_eq!(observed.matching_commits(), 1);
    assert_eq!(observed.mismatched_commits(), 0);

    // The capsule released its reservation before this after-Local response
    // barrier, so logout must complete even while the response is withheld.
    let logout = tokio::time::timeout(
        Duration::from_secs(5),
        app(caller.state.clone()).oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &caller.bearer,
        )),
    )
    .await
    .expect("logout completes behind post-COMMIT response loss")
    .expect("post-COMMIT response-loss logout response");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    assert!(
        !first.is_finished(),
        "the transport response is still withheld after logout drains"
    );
    first.abort();
    let lost = first
        .await
        .expect_err("aborted response models transport loss");
    assert!(lost.is_cancelled());
    let facts_after_loss = database.facts(&intent).await;
    assert_eq!(facts_after_loss.operation_rows, 1);
    assert_eq!(facts_after_loss.proof_rows, 1);
    assert!(facts_after_loss.exact_intended_rows);

    // Explicit replay under fresh authority uses the same immutable operation
    // identity. The storage adapter returns the exact existing result before
    // opening a second pending COMMIT.
    let retry_caller =
        CommitCapsuleCallerFixture::new(&database.app_state, "post-commit-retry").await;
    let retry_receipt = Arc::new(StdMutex::new(None));
    let retry_retention = commit_capsule_retention(&intent)
        .expect("reserve bounded commit capsule uncertainty retention")
        .0;
    let retry = run_commit_capsule_prototype(
        retry_caller.destination(),
        tokio::time::Instant::now() + Duration::from_secs(3),
        (),
        intent.clone(),
        CommitCapsuleInjection::Success,
        CommitCapsuleHooks::default(),
        retry_caller.expected_guard(),
        retry_receipt.clone(),
        retry_retention,
    )
    .await;
    let super::CommitCapsuleOutcome::Committed {
        value,
        reconciled: false,
    } = retry
    else {
        panic!("exact operation replay must return the existing committed result")
    };
    assert_eq!(value.operation_id, intent.operation_id.as_ref());
    assert_eq!(value.response, intent.response);
    assert!(
        retry_receipt.lock().unwrap().is_none(),
        "an exact replay does not invoke a second COMMIT"
    );
    let facts_after_retry = database.facts(&intent).await;
    assert_eq!(facts_after_retry.operation_rows, 1);
    assert_eq!(facts_after_retry.proof_rows, 1);
    assert!(facts_after_retry.exact_intended_rows);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_post_commit_panic_has_one_durable_effect_and_no_permit() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    let database = CommitCapsulePrototypeDatabase::new().await;
    let intent = commit_capsule_intent("post-commit-response-panic");
    let caller =
        CommitCapsuleCallerFixture::new(&database.app_state, "post-commit-response-panic").await;
    let destination = caller.destination();
    let task = tokio::spawn({
        let intent = intent.clone();
        let expected_guard = caller.expected_guard();
        async move {
            let retention = commit_capsule_retention(&intent)
                .expect("reserve bounded commit capsule uncertainty retention")
                .0;
            let outcome = run_commit_capsule_prototype(
                destination,
                tokio::time::Instant::now() + Duration::from_secs(3),
                (),
                intent,
                CommitCapsuleInjection::Success,
                CommitCapsuleHooks::default(),
                expected_guard,
                Arc::new(StdMutex::new(None)),
                retention,
            )
            .await;
            assert!(matches!(
                outcome,
                super::CommitCapsuleOutcome::Committed { .. }
            ));
            panic!("injected panic at post-COMMIT/pre-response")
        }
    });
    let panicked = task
        .await
        .expect_err("post-COMMIT response panic reaches the caller");
    assert!(panicked.is_panic());
    let logout = tokio::time::timeout(
        Duration::from_secs(5),
        app(caller.state.clone()).oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &caller.bearer,
        )),
    )
    .await
    .expect("post-COMMIT panic leaves no reservation for logout to drain")
    .expect("post-COMMIT panic logout response");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    let facts = database.facts(&intent).await;
    assert_eq!(facts.operation_rows, 1);
    assert_eq!(facts.proof_rows, 1);
    assert!(facts.exact_intended_rows);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_commit_capsule_queue_and_handoff_unwinds_release_reservation_and_gate() {
    let _registry_test_guard = lock_commit_capsule_registry_tests().await;
    // Queue-wait unwind variant: cancelling the queued future drops the exact
    // reservation and gate captured alongside its FIFO queue position.
    let queue_database = CommitCapsulePrototypeDatabase::new().await;
    let queue_intent = commit_capsule_intent("queue-panic");
    let queue_caller =
        CommitCapsuleCallerFixture::new(&queue_database.app_state, "queue-panic").await;
    let queue_reservation_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
    );
    let queue_reservation_pause_id = queue_reservation_pause.id().to_owned();
    let (queue_terminal, queue_gate) = CommitCapsuleTerminalFixture::new().await;
    let queue_destination = queue_caller.destination();
    let queue_task = tokio::spawn({
        let intent = queue_intent.clone();
        let expected_guard = queue_caller.expected_guard();
        async move {
            let retention = commit_capsule_retention(&intent)
                .expect("reserve bounded commit capsule uncertainty retention")
                .0;
            run_commit_capsule_prototype(
                queue_destination,
                tokio::time::Instant::now() + Duration::from_secs(3),
                queue_gate,
                intent,
                CommitCapsuleInjection::Success,
                CommitCapsuleHooks {
                    reservation_pause_id: Some(queue_reservation_pause_id),
                    panic_post_staging: true,
                    ..CommitCapsuleHooks::default()
                },
                expected_guard,
                Arc::new(StdMutex::new(None)),
                retention,
            )
            .await
        }
    });
    queue_reservation_pause.wait_until_reached().await;
    let queue_logout = queue_caller.start_logout_drain().await;
    let queue_writer = queue_database.state.clone().lock_owned().await;
    queue_reservation_pause.release().await;
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(
        !queue_task.is_finished(),
        "queue-wait unwind remains blocked behind the predecessor writer"
    );
    queue_task.abort();
    let queue_cancelled = queue_task
        .await
        .expect_err("queue-wait cancellation reaches the caller task");
    assert!(queue_cancelled.is_cancelled());
    queue_terminal.assert_reopened();
    drop(queue_writer);
    assert_commit_capsule_logout_completes(queue_logout).await;
    let queue_facts = queue_database.facts(&queue_intent).await;
    assert_eq!(queue_facts.operation_rows, 0);
    assert_eq!(queue_facts.proof_rows, 0);

    // Closed-handoff unwind variant: cancellation drops the Local guard and
    // both external owners, while only the handoff owner may reopen it.
    let handoff_database = CommitCapsulePrototypeDatabase::new().await;
    let handoff_intent = commit_capsule_intent("handoff-panic");
    let handoff_caller =
        CommitCapsuleCallerFixture::new(&handoff_database.app_state, "handoff-panic").await;
    let handoff_reservation_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
    );
    let handoff_reservation_pause_id = handoff_reservation_pause.id().to_owned();
    let handoff = with_snapback(&handoff_database.state, |local| {
        local.managed_local_handoff()
    })
    .await;
    let (handoff_terminal, handoff_gate) = CommitCapsuleTerminalFixture::new().await;
    let handoff_destination = handoff_caller.destination();
    let handoff_task = tokio::spawn({
        let intent = handoff_intent.clone();
        let expected_guard = handoff_caller.expected_guard();
        async move {
            let retention = commit_capsule_retention(&intent)
                .expect("reserve bounded commit capsule uncertainty retention")
                .0;
            run_commit_capsule_prototype(
                handoff_destination,
                tokio::time::Instant::now() + Duration::from_secs(3),
                handoff_gate,
                intent,
                CommitCapsuleInjection::Success,
                CommitCapsuleHooks {
                    reservation_pause_id: Some(handoff_reservation_pause_id),
                    panic_post_staging: true,
                    ..CommitCapsuleHooks::default()
                },
                expected_guard,
                Arc::new(StdMutex::new(None)),
                retention,
            )
            .await
        }
    });
    handoff_reservation_pause.wait_until_reached().await;
    let handoff_logout = handoff_caller.start_logout_drain().await;
    handoff.close();
    let handoff_waiter = super::writer_gate::install_managed_handoff_waiter_test_hook(&handoff);
    handoff_reservation_pause.release().await;
    tokio::time::timeout(Duration::from_secs(2), handoff_waiter.notified())
        .await
        .expect("unwind variant reaches closed handoff");
    assert!(handoff.is_closed());
    handoff_task.abort();
    let handoff_cancelled = handoff_task
        .await
        .expect_err("handoff-wait cancellation reaches the caller task");
    assert!(handoff_cancelled.is_cancelled());
    assert!(
        handoff.is_closed(),
        "a cancelled handoff waiter never reopens another owner's handoff"
    );
    let raw_guard = handoff_database
        .state
        .clone()
        .try_lock_owned()
        .expect("cancelled handoff waiter owns no Local guard");
    drop(raw_guard);
    handoff_terminal.assert_reopened();
    handoff.reopen();
    assert_commit_capsule_logout_completes(handoff_logout).await;
    let handoff_facts = handoff_database.facts(&handoff_intent).await;
    assert_eq!(handoff_facts.operation_rows, 0);
    assert_eq!(handoff_facts.proof_rows, 0);
}

/// Regression for `issues/20260821-effect-guard-does-not-fence-logout.md`
/// and `issues/closed/20260821-authorized-effect-fence-design.md`: a real logout,
/// without a mode-epoch retirement, must defeat authority prepared before the
/// handler reserves its authorized work.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn logout_wins_after_preparation_before_authority_work_reservation() {
    let state = sessions_activation_server_fixture_async().await;
    let credential = mint_test_credential(&state, "logout-prepared-race@example.test").await;
    let bearer = credential["token"]
        .as_str()
        .expect("ordinary session bearer")
        .to_owned();
    let session_id = credential["session"]["id"]
        .as_str()
        .expect("ordinary session id")
        .to_owned();
    let router = app(state.clone());
    let item_count_before = finite_authority_matrix_item_count(&state).await;
    let controller = state.auth_admission_controller();
    let mode_before = controller.snapshot();

    let pause = install_test_finite_authority_pause(TestFiniteAuthorityPausePoint::BeforeHandler);
    let mut request = session_auth_http_request(
        "/mutation/queuedWrite",
        serde_json::to_vec(&json!({
            "args": { "value": "must-not-commit-after-logout" },
        }))
        .expect("serialize logout-racing mutation"),
        &bearer,
    );
    request.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(pause.id()).expect("logout-race pause header"),
    );
    let request_router = router.clone();
    let crossing = tokio::spawn(async move {
        request_router
            .oneshot(request)
            .await
            .expect("logout-racing mutation response")
    });
    tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
        .await
        .expect("mutation reaches the post-authority-resolution pause");

    let logout = tokio::time::timeout(
        Duration::from_secs(5),
        router.oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &bearer,
        )),
    )
    .await
    .expect("logout does not hang")
    .expect("logout response");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    let session_facts = with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .auth_catalog()
            .session_lifetime_facts_for_test(&session_id)
    })
    .await
    .expect("read logged-out session facts");
    assert_eq!(session_facts.2, 2, "logout advances the session generation");
    assert!(session_facts.3, "logout makes the session terminal");
    let mode_after_logout = controller.snapshot();
    assert_eq!(
        mode_after_logout.transition_generation, mode_before.transition_generation,
        "ordinary logout must not retire the global mode generation"
    );
    assert_eq!(
        mode_after_logout.admission_epoch, mode_before.admission_epoch,
        "ordinary logout must not retire the global admission epoch"
    );
    let version_after_logout = super::inspect_snapback(&state.snapback)
        .await
        .expect("inspect durable state after logout")
        .storage
        .version;

    tokio::time::timeout(Duration::from_secs(5), pause.release())
        .await
        .expect("release the logout-racing mutation pause");
    let response = tokio::time::timeout(Duration::from_secs(5), crossing)
        .await
        .expect("logout-racing mutation does not hang")
        .expect("logout-racing mutation task");
    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "authority prepared before logout must be refused before durable work"
    );
    let response = response_json(response).await;
    assert_eq!(
        response["diagnostic"]["code"],
        "SNAPBACK_AUTH_SESSION_EXPIRED"
    );
    assert_eq!(
        response["diagnostic"]["details"]["authorityDisposition"],
        "durableDelete"
    );
    assert_eq!(
        finite_authority_matrix_item_count(&state).await,
        item_count_before,
        "the logged-out authority must not add a durable row"
    );
    assert_eq!(
        super::inspect_snapback(&state.snapback)
            .await
            .expect("inspect post-race durable state")
            .storage
            .version,
        version_after_logout,
        "no target-data commit observation may fire for the refused mutation"
    );
}
