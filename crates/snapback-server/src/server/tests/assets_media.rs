// Complete test items included at `server::tests` module scope.

#[test]
fn asset_delivery_window_refuses_oversized_store_chunks() {
    let error = super::advance_asset_delivery_window(10, 4, 5)
        .expect_err("an oversized store chunk must not wrap remaining");
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    assert_eq!(
        super::advance_asset_delivery_window(10, 4, 4).expect("exact window"),
        (14, 0)
    );
}

#[test]
fn asset_signed_url_request_accepts_empty_defaults_and_types_parse_refusals() {
    let empty = super::parse_asset_signed_url_issue_request(Ok(Bytes::new()))
        .expect("empty issuance body is the default request");
    let omitted = super::parse_asset_signed_url_issue_request(Ok(Bytes::from_static(b"{}")))
        .expect("omitted variant is valid");
    assert_eq!(empty, omitted);
    assert_eq!(empty.variant, None);
    assert_eq!(empty.ttl_ms, None);
    assert_eq!(empty.width_px, None);

    let malformed = super::parse_asset_signed_url_issue_request(Ok(Bytes::from_static(
        br#"{"ttlMs":"forever"}"#,
    )))
    .expect_err("a malformed field refuses through the typed asset diagnostic");
    assert_eq!(
        malformed.0.diagnostic.code,
        "SNAPBACK_ASSET_REQUEST_INVALID"
    );
    assert_eq!(malformed.0.diagnostic.details["field"], "ttlMs");
    assert_eq!(
        malformed.into_response().status(),
        StatusCode::BAD_REQUEST,
        "malformed issuance never escapes as a framework 422"
    );

    let invalid_json = super::parse_asset_signed_url_issue_request(Ok(Bytes::from_static(b"{")))
        .expect_err("invalid JSON refuses through the same typed diagnostic");
    assert_eq!(
        invalid_json.0.diagnostic.code,
        "SNAPBACK_ASSET_REQUEST_INVALID"
    );
    assert_eq!(invalid_json.0.diagnostic.details["field"], "body");
    assert_eq!(
        invalid_json.into_response().status(),
        StatusCode::BAD_REQUEST
    );

    let unknown = super::parse_asset_signed_url_issue_request(Ok(Bytes::from_static(
        br#"{"surprise":true}"#,
    )))
    .expect_err("an unknown field refuses through the typed diagnostic");
    assert_eq!(unknown.0.diagnostic.details["field"], "surprise");
    assert_eq!(unknown.into_response().status(), StatusCode::BAD_REQUEST);

    let trailing = super::parse_asset_signed_url_issue_request(Ok(Bytes::from_static(b"{} {}")))
        .expect_err("trailing JSON refuses through the typed diagnostic");
    assert_eq!(trailing.0.diagnostic.details["field"], "body");
    assert_eq!(trailing.into_response().status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn asset_signed_url_route_empty_and_omitted_body_issue_primary() {
    let snapback_engine::test_support::SignedAssetFixture {
        snapback,
        asset_id,
        authority,
    } = snapback_engine::test_support::signed_asset_fixture("user_a", b"signed-route-defaults");
    let state = Arc::new(Mutex::new(snapback));

    for body in [Bytes::new(), Bytes::from_static(b"{}")] {
        let issued = super::asset_signed_url_issue_route(
            State(state.clone()),
            Extension(authority.clone()),
            AxumPath(asset_id.clone()),
            HeaderMap::new(),
            Ok(body),
        )
        .await
        .expect("empty/default issuance succeeds");
        assert_eq!(issued.0.variant, "primary");
        assert!(
            issued
                .0
                .url
                .contains(&format!("/{asset_id}/primary?token="))
        );
        assert_eq!(issued.into_response().status(), StatusCode::OK);
    }
}

#[tokio::test]
async fn tus_upload_cors_headers_cover_the_protocol() {
    let state = test_app_state_from_snapback(
        LocalSnapback::memory().expect("TUS CORS fixture"),
        bound_loopback_context(),
    );
    let router = app(state);
    let preflight = |origin: &'static str| {
        Request::builder()
            .method("OPTIONS")
            .uri("/assets/tus/some-attempt-id")
            .header(header::ORIGIN, origin)
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "PATCH")
            .header(
                header::ACCESS_CONTROL_REQUEST_HEADERS,
                "tus-resumable,upload-offset,upload-checksum,content-type",
            )
            .body(Body::empty())
            .unwrap()
    };

    let allowed = router
        .clone()
        .oneshot(preflight("http://localhost:5173"))
        .await
        .unwrap();
    assert!(allowed.status().is_success());
    assert_eq!(
        allowed
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .and_then(|value| value.to_str().ok()),
        Some("http://localhost:5173")
    );
    let allow_headers = allowed
        .headers()
        .get(header::ACCESS_CONTROL_ALLOW_HEADERS)
        .and_then(|value| value.to_str().ok())
        .expect("preflight exposes the allowed request headers")
        .to_ascii_lowercase();
    for expected in [
        "tus-resumable",
        "upload-offset",
        "upload-length",
        "upload-checksum",
    ] {
        assert!(
            allow_headers
                .split(',')
                .any(|header_name| header_name.trim() == expected),
            "allow-headers omits {expected}: {allow_headers}"
        );
    }

    let head = router
        .clone()
        .oneshot(
            Request::builder()
                .method("HEAD")
                .uri("/assets/tus/some-attempt-id")
                .header(header::ORIGIN, "http://localhost:5173")
                .header("tus-resumable", crate::assets::ASSET_TUS_VERSION)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let expose_headers = head
        .headers()
        .get(header::ACCESS_CONTROL_EXPOSE_HEADERS)
        .and_then(|value| value.to_str().ok())
        .expect("TUS errors still expose the protocol response headers")
        .to_ascii_lowercase();
    for expected in [
        "upload-offset",
        "upload-length",
        "tus-resumable",
        "tus-version",
        "tus-extension",
        "tus-checksum-algorithm",
        "upload-expires-ms",
        "snapback-max-chunk-bytes",
    ] {
        assert!(
            expose_headers
                .split(',')
                .any(|header_name| header_name.trim() == expected),
            "expose-headers omits {expected}: {expose_headers}"
        );
    }

    let hostile = router
        .oneshot(preflight("http://attacker.invalid"))
        .await
        .unwrap();
    assert!(
        hostile
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none(),
        "an unadmitted origin must not receive CORS admission"
    );
}

#[test]
fn tus_patch_route_runs_durable_append_between_writer_windows() {
    let source = include_str!("../asset_routes.rs");
    let route = source
        .split("pub(super) async fn asset_tus_patch_route")
        .nth(1)
        .and_then(|tail| {
            tail.split("pub(super) async fn asset_tus_delete_route")
                .next()
        })
        .expect("asset TUS PATCH route source");
    let preflight = route
        .find("asset_tus_patch_preflight")
        .expect("lock-held TUS preflight");
    let blocking = route
        .find("tokio::task::spawn_blocking")
        .expect("blocking-pool staging append");
    let append = route.find("ticket.append").expect("durable staging append");
    let guard_return = route
        .find("(ticket, attempt_guard)")
        .expect("owned attempt guard returned from the blocking append");
    let commit = route
        .rfind("asset_tus_patch_commit")
        .expect("lock-held TUS offset CAS");
    assert!(
        preflight < blocking && blocking < append && append < guard_return && guard_return < commit,
        "write/flush/sync and its cancellation-safe guard must remain outside and between the two Local writer windows"
    );
    assert_eq!(
        route.matches("with_snapback(&state").count(),
        2,
        "the route has one preflight and one CAS writer window"
    );
}

/// A buffered JavaScript mutation must be able to read an already-projected
/// media row through `ctx.db.query`, preserve its host-private provenance, and
/// return that same row through commit-egress materialization.
/// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
#[tokio::test]
async fn served_http_buffered_mutation_reprojects_stored_media_result() {
    let mut asset_id = None;
    let (state, _) = auth_runtime_fixture_with(PolicyAuthMode::Dev, |snapback| {
        let schema: SchemaManifest = serde_json::from_str(include_str!(
            "../../../../../tests/acceptance/fixtures/media-reprojection/snapback/generated/schema.manifest.json"
        ))
        .expect("parse media re-projection schema");
        snapback
            .apply_schema(schema)
            .expect("load media re-projection schema");
        let functions: FunctionManifest = serde_json::from_str(include_str!(
            "../../../../../tests/acceptance/fixtures/media-reprojection/snapback/generated/functions.manifest.json"
        ))
        .expect("parse media re-projection functions");
        let diagnostics = snapback.load_functions(functions);
        assert!(
            !diagnostics.iter().any(|diagnostic| matches!(
                diagnostic.severity,
                crate::diagnostic::DiagnosticSeverity::Error
                    | crate::diagnostic::DiagnosticSeverity::Fatal
            )),
            "media re-projection fixture loads: {diagnostics:?}",
        );
        let png = include_bytes!("../../../../../brand/favicon-16.png");
        let uploaded = snapback_engine::test_support::asset_host_op(
            snapback,
            "asset.put",
            Some(&json!({
                "upload": "profileImageUpload",
                "bytesBase64": base64::engine::general_purpose::STANDARD.encode(png),
                "fileName": "stored-profile.png",
                "contentType": "image/png",
            })),
            Some("media-reprojection-user"),
            ServerProfile::Test,
        )
        .expect("finalize media re-projection asset");
        asset_id = Some(
            uploaded["task"]["assetId"]
                .as_str()
                .expect("uploaded profile asset id")
                .to_owned(),
        );
    });
    let asset_id = asset_id.expect("profile asset captured");
    let router = app(state);
    let request = |mutation: &str, attempt: &str, args: Value| {
        Request::builder()
            .method("POST")
            .uri(format!("/mutation/{mutation}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "args": args,
                    "auth": { "user_id": "media-reprojection-user" },
                    "clientMutationId": attempt,
                    "wireVersion": "snapback.v1",
                }))
                .expect("serialize media re-projection request"),
            ))
            .expect("media re-projection request")
    };

    let created = router
        .clone()
        .oneshot(request(
            "createProfile",
            "media-reprojection-create",
            json!({ "displayName": "Ada" }),
        ))
        .await
        .expect("create profile response");
    let created_status = created.status();
    let created = response_json(created).await;
    assert_eq!(created_status, StatusCode::OK, "{created}");
    let profile_id = created["result"]
        .as_str()
        .expect("created profile id")
        .to_owned();

    let attached = router
        .clone()
        .oneshot(request(
            "setProfileImage",
            "media-reprojection-attach",
            json!({ "profileId": profile_id, "image": asset_id }),
        ))
        .await
        .expect("attach profile image response");
    let attached_status = attached.status();
    let attached = response_json(attached).await;
    assert_eq!(attached_status, StatusCode::OK, "{attached}");
    assert_eq!(attached["result"]["_id"], profile_id);
    assert_eq!(attached["result"]["image"]["assetId"], asset_id);
    assert_eq!(attached["result"]["image"]["kind"], "image");

    let returned = router
        .oneshot(request(
            "returnStoredProfile",
            "media-reprojection-return",
            json!({ "displayName": "Ada Lovelace" }),
        ))
        .await
        .expect("stored profile mutation response");
    let returned_status = returned.status();
    let returned = response_json(returned).await;
    assert_eq!(returned_status, StatusCode::OK, "{returned}");
    assert_eq!(returned["result"]["_id"], profile_id);
    assert_eq!(returned["result"]["displayName"], "Ada Lovelace");
    assert_eq!(returned["result"]["image"]["assetId"], asset_id);
    assert_eq!(returned["result"]["image"]["kind"], "image");
}

/// A media-bearing single-table LiveQuery must re-run its authoritative result
/// projection after an out-of-band route commit. Publishing a raw-row DK-3
/// delta would leak the stored asset id in place of the declared `MediaRef`.
/// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
#[tokio::test]
async fn served_http_media_commit_pushes_projected_live_replace() {
    let mut asset_id = None;
    let (state, _) = auth_runtime_fixture_with(PolicyAuthMode::Dev, |snapback| {
        let schema: SchemaManifest = serde_json::from_str(include_str!(
            "../../../../../tests/acceptance/fixtures/media-reprojection/snapback/generated/schema.manifest.json"
        ))
        .expect("parse media live-push schema");
        snapback
            .apply_schema(schema)
            .expect("load media live-push schema");
        let mut functions: FunctionManifest = serde_json::from_str(include_str!(
            "../../../../../tests/acceptance/fixtures/media-reprojection/snapback/generated/functions.manifest.json"
        ))
        .expect("parse media live-push functions");

        // Reuse the generated owner-scoped LiveQuery declaration from the
        // charter's protected demo, but bind its result contract to this
        // compact Phase-F fixture's equivalent `profiles.image` field.
        let live_functions_source = read_generated_demo_fixture(
            "../../../../demos/media-happy-post/snapback/generated/functions.manifest.json",
            "media-happy-post",
        );
        let live_functions: FunctionManifest = serde_json::from_str(&live_functions_source)
            .expect("parse generated media-happy live query");
        let mut list_profiles = live_functions
            .functions
            .iter()
            .find(|function| function.name == "listProfiles")
            .expect("generated owner-scoped listProfiles")
            .clone();
        let document = functions
            .functions
            .iter()
            .find_map(
                |function| match (&*function.name, &function.result_contract) {
                    (
                        "setProfileImage",
                        crate::manifest::FunctionResultContract::Document { document, .. },
                    ) => Some(document.clone()),
                    _ => None,
                },
            )
            .expect("fixture profile document contract");
        list_profiles.id = "media-reprojection-fixture:listProfiles".to_owned();
        list_profiles.result_contract = crate::manifest::FunctionResultContract::Documents {
            table: "profiles".to_owned(),
            document,
        };
        list_profiles.result_contract_hash = Some(
            crate::manifest::result_contract_hash(&list_profiles.result_contract)
                .expect("hash media live result contract"),
        );
        functions.functions.push(list_profiles);

        let diagnostics = snapback.load_functions(functions);
        assert!(
            !diagnostics.iter().any(|diagnostic| matches!(
                diagnostic.severity,
                crate::diagnostic::DiagnosticSeverity::Error
                    | crate::diagnostic::DiagnosticSeverity::Fatal
            )),
            "media live-push fixture loads: {diagnostics:?}",
        );
        let uploaded = snapback_engine::test_support::asset_host_op(
            snapback,
            "asset.put",
            Some(&json!({
                "upload": "profileImageUpload",
                "bytesBase64": base64::engine::general_purpose::STANDARD
                    .encode(include_bytes!("../../../../../brand/favicon-16.png")),
                "fileName": "live-push-profile.png",
                "contentType": "image/png",
            })),
            Some("media-live-user"),
            ServerProfile::Test,
        )
        .expect("finalize media live-push asset");
        asset_id = Some(
            uploaded["task"]["assetId"]
                .as_str()
                .expect("uploaded media live-push asset id")
                .to_owned(),
        );
    });
    let asset_id = asset_id.expect("media live-push asset captured");
    let router = app(state.clone());
    let request = |mutation: &str, attempt: &str, args: Value| {
        Request::builder()
            .method("POST")
            .uri(format!("/mutation/{mutation}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "args": args,
                    "auth": { "user_id": "media-live-user" },
                    "clientMutationId": attempt,
                    "wireVersion": "snapback.v1",
                }))
                .expect("serialize media live-push request"),
            ))
            .expect("media live-push request")
    };

    let created = router
        .clone()
        .oneshot(request(
            "createProfile",
            "media-live-push-create",
            json!({ "displayName": "Ada" }),
        ))
        .await
        .expect("create live-push profile response");
    let created_status = created.status();
    let created = response_json(created).await;
    assert_eq!(created_status, StatusCode::OK, "{created}");
    let profile_id = created["result"]
        .as_str()
        .expect("created live-push profile id")
        .to_owned();

    let connection_id = "media-live-push-connection".to_owned();
    let subscribed = with_snapback(&state.snapback, {
        let connection_id = connection_id.clone();
        move |snapback| {
            snapback.subscribe_live(
                "listProfiles",
                LiveSubscribeInput {
                    connection_id,
                    input: HandlerInput {
                        auth: AuthInput {
                            user_id: Some("media-live-user".to_owned()),
                            ..AuthInput::default()
                        },
                        ..HandlerInput::default()
                    },
                    authorization_namespace: None,
                    supersedes: None,
                    resume_from_token: None,
                },
            )
        }
    })
    .await
    .expect("subscribe to media-bearing profile list");
    let initial = subscribed.snapshot.expect("initial profile snapshot");
    assert_eq!(initial.rows.len(), 1);
    assert_eq!(initial.rows[0]["image"], Value::Null);

    let attached = router
        .oneshot(request(
            "setProfileImage",
            "media-live-push-attach",
            json!({ "profileId": profile_id, "image": asset_id }),
        ))
        .await
        .expect("attach live-push profile image response");
    let attached_status = attached.status();
    let attached = response_json(attached).await;
    assert_eq!(attached_status, StatusCode::OK, "{attached}");

    let frames = with_snapback(&state.snapback, move |snapback| {
        snapback
            .drain_outbox_for_send(&connection_id)
            .into_iter()
            .filter_map(|admitted| {
                let (envelope, _publication) = admitted.into_parts();
                let crate::ephemeral::RealtimeEnvelope::Durable(message) = envelope else {
                    return None;
                };
                serde_json::from_slice::<crate::live_wire::LiveEnvelope>(&message.payload).ok()
            })
            .collect::<Vec<_>>()
    })
    .await;
    assert_eq!(frames.len(), 1, "one row commit produces one live frame");
    let crate::live_wire::LiveEnvelope::LiveReplace { rows, .. } = &frames[0] else {
        panic!(
            "media-bearing raw-row delta must be ineligible: {:?}",
            frames[0]
        )
    };
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["_id"], profile_id);
    assert_eq!(rows[0]["image"]["assetId"], asset_id);
    assert_eq!(rows[0]["image"]["kind"], "image");
}

/// The served mutation route must carry the command's one replay-stable
/// attempt through the buffered-Ibex authorization preview as well as commit.
/// @ref LLP 0239#d3-one-mediacommand-owns-multi-upload-plus-atomic-commit
#[tokio::test]
async fn served_http_buffered_media_command_reuses_attempt_for_preview_commit_and_replay() {
    let mut asset_id = None;
    let (state, _) = auth_runtime_fixture_with(PolicyAuthMode::Dev, |snapback| {
        let schema: SchemaManifest = serde_json::from_str(include_str!(
            "../../../../../tests/acceptance/fixtures/media-profile/snapback/generated/schema.manifest.json"
        ))
        .expect("parse served media-command schema");
        snapback
            .apply_schema(schema)
            .expect("load served media-command schema");
        let functions: FunctionManifest = serde_json::from_str(include_str!(
            "../../../../../tests/acceptance/fixtures/media-profile/snapback/generated/functions.manifest.json"
        ))
        .expect("parse served media-command functions");
        let diagnostics = snapback.load_functions(functions);
        assert!(
            !diagnostics.iter().any(|diagnostic| matches!(
                diagnostic.severity,
                crate::diagnostic::DiagnosticSeverity::Error
                    | crate::diagnostic::DiagnosticSeverity::Fatal
            )),
            "served media-command fixture loads: {diagnostics:?}",
        );
        let png = include_bytes!("../../../../../brand/favicon-16.png");
        let uploaded = snapback_engine::test_support::asset_host_op(
            snapback,
            "asset.put",
            Some(&json!({
                "upload": "sharedMediaUpload",
                "bytesBase64": base64::engine::general_purpose::STANDARD.encode(png),
                "fileName": "served-route.png",
                "contentType": "image/png",
            })),
            Some("media-route-user"),
            ServerProfile::Test,
        )
        .expect("finalize served media-command asset");
        asset_id = Some(
            uploaded["task"]["assetId"]
                .as_str()
                .expect("uploaded media asset id")
                .to_owned(),
        );
    });
    let asset_id = asset_id.expect("served media asset captured");
    let binding = with_snapback(&state.snapback, |snapback| {
        snapback
            .function("createPostMutation")
            .expect("served media target")
            .media_command_bindings[0]
            .clone()
    })
    .await;
    let router = app(state.clone());
    let attempt_id = "served-media-command-attempt-1";
    let request = || {
        Request::builder()
            .method("POST")
            .uri("/mutation/createPostMutation")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "args": { "body": "served route", "assetIds": [asset_id] },
                    "auth": { "user_id": "media-route-user" },
                    "clientMutationId": attempt_id,
                    "wireVersion": "snapback.v1",
                    "mediaCommand": {
                        "bindingIdentity": binding.identity,
                        "commandIdentity": binding.command.id,
                        "attemptId": attempt_id,
                        "items": [{ "ordinal": 0, "assetId": asset_id }],
                    },
                }))
                .expect("serialize media command request"),
            ))
            .expect("served media command request")
    };

    let first = router
        .clone()
        .oneshot(request())
        .await
        .expect("first served media command response");
    assert_eq!(first.status(), StatusCode::OK);
    let first = response_json(first).await;
    let parent_id = first["result"]["_id"]
        .as_str()
        .expect("media command returns its inserted parent")
        .to_owned();

    let replay = router
        .oneshot(request())
        .await
        .expect("replayed served media command response");
    assert_eq!(replay.status(), StatusCode::OK);
    let replay = response_json(replay).await;
    assert_eq!(replay["result"]["_id"], parent_id);

    let posts = with_snapback(&state.snapback, |snapback| {
        snapback.scan_table("posts", 10, 0)
    })
    .await
    .expect("scan served media-command posts");
    assert_eq!(
        posts.total, 1,
        "same attempt must not insert a second parent"
    );
}

#[test]
fn pasteable_asset_delivery_is_cross_origin_without_weakening_static_pages() {
    let spec_for = |method, path| {
        super::route_registry()
            .into_iter()
            .find(|spec| spec.method == method && spec.path == path)
            .unwrap_or_else(|| panic!("registered route {method} {path}"))
    };

    for path in [
        "/assets/public/{id}/{variant}",
        "/assets/signed/{id}/{variant}",
    ] {
        let response = super::apply_registered_response_controls(
            spec_for("GET", path).effective_for(PolicyAuthMode::Sessions),
            axum::response::Response::new(Body::empty()),
        );
        assert_eq!(
            response.headers()["cross-origin-resource-policy"],
            "cross-origin",
            "{path} must remain pasteable from another origin"
        );
    }

    let response = super::apply_registered_response_controls(
        spec_for("GET", "/_snapback/admin/setup").effective_for(PolicyAuthMode::Dev),
        axum::response::Response::new(Body::empty()),
    );
    assert_eq!(
        response.headers()["cross-origin-resource-policy"],
        "same-origin",
        "a non-delivery StaticPublic route keeps LLP 0060's isolation"
    );
}

#[tokio::test]
async fn asset_gc_sweep_host_operation_is_admin_gated_and_clock_explicit() {
    let (router, _) = auth_http_fixture(PolicyAuthMode::Dev);
    let host_op = |body: serde_json::Value, admin: Option<&str>| {
        auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            serde_json::to_vec(&body).unwrap(),
            true,
            admin,
            None,
        )
    };

    let unauthorized = router
        .clone()
        .oneshot(host_op(
            json!({ "operation": "asset.gcSweep", "input": { "nowMs": 42 } }),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let authorized = router
        .clone()
        .oneshot(host_op(
            json!({
                "operation": "asset.gcSweep",
                "requestId": "gc-sweep-42",
                "input": { "nowMs": 42 },
            }),
            Some("auth-http-admin"),
        ))
        .await
        .unwrap();
    assert_eq!(authorized.status(), StatusCode::OK);
    let authorized = response_json(authorized).await;
    assert_eq!(authorized["ok"], true, "{authorized}");
    assert_eq!(authorized["requestId"], "gc-sweep-42");
    assert_eq!(authorized["data"]["nowMs"], 42);
    assert_eq!(authorized["data"]["report"]["referenceReclaimed"], 0);
    assert_eq!(authorized["authority"]["adminBypass"], true);

    let missing_clock = router
        .oneshot(host_op(
            json!({ "operation": "asset.gcSweep" }),
            Some("auth-http-admin"),
        ))
        .await
        .unwrap();
    assert_eq!(missing_clock.status(), StatusCode::OK);
    let missing_clock = response_json(missing_clock).await;
    assert_eq!(missing_clock["ok"], false);
    assert_eq!(
        missing_clock["diagnostics"][0]["code"],
        "SNAPBACK_HOST_OP_INPUT_MISSING"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn asset_http_finalize_revalidates_moved_witness_and_retries_under_fresh_reservation() {
    let fixture = asset_authorized_effect_fixture(AssetAuthorizedEffectSite::Finalize).await;
    let attempt_id = fixture
        .target
        .attempt_id
        .as_deref()
        .expect("finalize witness attempt")
        .to_owned();
    with_snapback(&fixture.state.snapback, {
        let attempt_id = attempt_id.clone();
        move |snapback| {
            snapback_engine::test_support::asset_move_finalize_witness(snapback, &attempt_id)
        }
    })
    .await
    .expect("move finalize admission witness");

    let response = fixture
        .router
        .clone()
        .oneshot(asset_session_request(
            "POST",
            &format!("/assets/attempts/{attempt_id}/finalize"),
            serde_json::to_vec(&json!({
                "attemptId": attempt_id,
                "lifecycleGeneration": fixture.target.lifecycle_generation,
            }))
            .expect("serialize moved-witness finalize"),
            Some("application/json"),
            &fixture.bearer,
        ))
        .await
        .expect("moved-witness finalize response");
    let status = response.status();
    let body = response_json(response).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "a still-authorized caller must not loop on admission conflict: {body}"
    );
    assert_eq!(body["task"]["availability"], "ready", "{body}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn asset_http_finalize_fresh_retry_guard_refusal_prevents_phase_d() {
    let fixture = asset_authorized_effect_fixture(AssetAuthorizedEffectSite::Finalize).await;
    let before = asset_durable_witness(&fixture, AssetAuthorizedEffectSite::Finalize).await;
    let attempt_id = fixture
        .target
        .attempt_id
        .as_deref()
        .expect("finalize witness attempt")
        .to_owned();
    with_snapback(&fixture.state.snapback, {
        let attempt_id = attempt_id.clone();
        move |snapback| {
            snapback_engine::test_support::asset_move_finalize_witness(snapback, &attempt_id)
        }
    })
    .await
    .expect("move finalize admission witness");

    let retry_guard = install_test_asset_retry_guard(TestAssetRetryGuardAction::Refuse);
    let mut request = asset_session_request(
        "POST",
        &format!("/assets/attempts/{attempt_id}/finalize"),
        serde_json::to_vec(&json!({
            "attemptId": attempt_id,
            "lifecycleGeneration": fixture.target.lifecycle_generation,
        }))
        .expect("serialize moved-witness finalize"),
        Some("application/json"),
        &fixture.bearer,
    );
    request.headers_mut().insert(
        HeaderName::from_static(TEST_ASSET_RETRY_GUARD_HEADER),
        HeaderValue::from_str(retry_guard.id()).expect("retry-guard refusal header"),
    );
    let response = fixture
        .router
        .clone()
        .oneshot(request)
        .await
        .expect("retry-guard refusal response");
    let status = response.status();
    let body = response_json(response).await;
    assert_ne!(
        status,
        StatusCode::OK,
        "retry guard refusal was bypassed: {body}"
    );
    assert_eq!(
        body["diagnostic"]["code"], "SNAPBACK_ACTION_TIMEOUT",
        "the exact retry reservation must surface its typed guard refusal: {body}",
    );

    let after = asset_durable_witness(&fixture, AssetAuthorizedEffectSite::Finalize).await;
    match (before, after) {
        (
            AssetDurableWitness::Finalize {
                publication_count: before_publications,
                attempt_state: before_attempt,
                availability: before_availability,
                rendition_count: before_renditions,
                settled_bytes: before_settled,
                receipt_count: before_receipts,
            },
            AssetDurableWitness::Finalize {
                publication_count: after_publications,
                attempt_state: after_attempt,
                availability: after_availability,
                rendition_count: after_renditions,
                settled_bytes: after_settled,
                receipt_count: after_receipts,
            },
        ) => {
            assert_eq!(before_attempt, "transferring");
            assert_eq!(after_attempt, "finalizing");
            assert_eq!(before_availability, "pending");
            assert_eq!(after_availability, before_availability);
            assert_eq!(after_publications, before_publications + 1);
            assert_eq!(after_renditions, before_renditions);
            assert_eq!(after_settled, before_settled);
            assert_eq!(after_receipts, before_receipts);
        }
        witnesses => panic!("unexpected finalize refusal witnesses: {witnesses:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn asset_http_finalize_completion_and_retry_guards_cover_required_stage_and_phase_d() {
    let fixture = asset_authorized_effect_fixture_with_upload(
        AssetAuthorizedEffectSite::Finalize,
        "requiredImageUpload",
        include_bytes!("../../../../../brand/favicon-16.png"),
        "image/png",
    )
    .await;
    let attempt_id = fixture
        .target
        .attempt_id
        .as_deref()
        .expect("finalize witness attempt")
        .to_owned();
    with_snapback(&fixture.state.snapback, {
        let attempt_id = attempt_id.clone();
        move |snapback| {
            snapback_engine::test_support::asset_move_finalize_witness(snapback, &attempt_id)
        }
    })
    .await
    .expect("move finalize admission witness");

    let completion_marker = format!("finalize-completion-{}", uuid::Uuid::now_v7().simple());
    let completion_scope =
        crate::auth::invocation::AuthorizedEffectScopeProbeForTest::new(completion_marker.clone());
    assert_eq!(completion_scope.marker(), completion_marker);
    let retry_marker = format!("finalize-retry-{}", uuid::Uuid::now_v7().simple());
    let retry_scope =
        crate::auth::invocation::AuthorizedEffectScopeProbeForTest::new(retry_marker.clone());
    assert_eq!(retry_scope.marker(), retry_marker);

    // Required staging precedes witness revalidation. Bind its one real
    // Planned -> Staged transition to the original completion reservation;
    // the fresh retry's already-Staged no-op cannot satisfy this observer.
    let required_phase_c_scope = completion_scope.clone();
    let after_required_phase_c_commit =
        snapback_kernel::storage::install_asset_attempts_after_commit_observer_for_test(
            move |publication_transitioned_from_planned| {
                publication_transitioned_from_planned
                    && required_phase_c_scope
                        .is_active_for("asset finalize required-rendition staged transaction")
            },
        );
    let phase_d_scope = retry_scope.clone();
    let after_phase_d_commit =
        snapback_kernel::storage::install_asset_attempts_after_commit_observer_for_test(
            move |_| phase_d_scope.is_active_for("asset finalize publication/quota transaction"),
        );
    let retry_guard = install_test_asset_retry_guard(TestAssetRetryGuardAction::Probe {
        completion: completion_scope.clone(),
        retry: retry_scope.clone(),
    });
    let mut request = asset_session_request(
        "POST",
        &format!("/assets/attempts/{attempt_id}/finalize"),
        serde_json::to_vec(&json!({
            "attemptId": attempt_id,
            "lifecycleGeneration": fixture.target.lifecycle_generation,
        }))
        .expect("serialize moved-witness finalize"),
        Some("application/json"),
        &fixture.bearer,
    );
    request.headers_mut().insert(
        HeaderName::from_static(TEST_ASSET_RETRY_GUARD_HEADER),
        HeaderValue::from_str(retry_guard.id()).expect("retry-guard scope header"),
    );
    let response = fixture
        .router
        .clone()
        .oneshot(request)
        .await
        .expect("retry-guard scope response");
    let status = response.status();
    let body = response_json(response).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "moved-witness finalize failed: {body}"
    );
    assert_eq!(body["task"]["availability"], "ready", "{body}");
    assert!(
        after_required_phase_c_commit.observed(),
        "the original completion guard was not active for the required-rendition Planned-to-Staged COMMIT",
    );
    assert!(
        after_phase_d_commit.observed(),
        "the marked fresh retry guard was not active after the Phase-D COMMIT",
    );
    assert!(
        completion_scope.is_inactive(),
        "the marked original completion guard remained active after Local returned",
    );
    assert!(
        retry_scope.is_inactive(),
        "the marked fresh retry guard remained active after Local returned",
    );
}

macro_rules! asset_authorized_effect_race_tests {
    ($logout_test:ident, $reservation_test:ident, $site:expr) => {
        #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
        async fn $logout_test() {
            asset_logout_wins_before_reservation($site).await;
        }

        #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
        async fn $reservation_test() {
            asset_reservation_wins_before_logout($site).await;
        }
    };
}

asset_authorized_effect_race_tests!(
    asset_attempt_creation_logout_wins_before_reservation,
    asset_attempt_creation_reservation_wins_before_logout,
    AssetAuthorizedEffectSite::AttemptCreation
);

asset_authorized_effect_race_tests!(
    asset_cancellation_logout_wins_before_reservation,
    asset_cancellation_reservation_wins_before_logout,
    AssetAuthorizedEffectSite::AttemptCancellation
);

asset_authorized_effect_race_tests!(
    asset_attempt_inspect_lazy_expiry_logout_wins_before_reservation,
    asset_attempt_inspect_lazy_expiry_reservation_wins_before_logout,
    AssetAuthorizedEffectSite::AttemptInspectLazyExpiry
);

asset_authorized_effect_race_tests!(
    asset_tus_head_lazy_expiry_logout_wins_before_reservation,
    asset_tus_head_lazy_expiry_reservation_wins_before_logout,
    AssetAuthorizedEffectSite::TusHeadLazyExpiry
);

asset_authorized_effect_race_tests!(
    asset_tus_patch_acknowledgement_logout_wins_before_reservation,
    asset_tus_patch_acknowledgement_reservation_wins_before_logout,
    AssetAuthorizedEffectSite::TusPatchAcknowledgement
);

asset_authorized_effect_race_tests!(
    asset_finalize_logout_wins_before_reservation,
    asset_finalize_reservation_wins_before_logout,
    AssetAuthorizedEffectSite::Finalize
);

asset_authorized_effect_race_tests!(
    asset_explicit_delete_logout_wins_before_reservation,
    asset_explicit_delete_reservation_wins_before_logout,
    AssetAuthorizedEffectSite::ExplicitDelete
);

asset_authorized_effect_race_tests!(
    asset_signed_url_receipt_logout_wins_before_reservation,
    asset_signed_url_receipt_reservation_wins_before_logout,
    AssetAuthorizedEffectSite::SignedUrlReceipt
);

asset_authorized_effect_race_tests!(
    asset_strict_delivery_receipt_logout_wins_before_reservation,
    asset_strict_delivery_receipt_reservation_wins_before_logout,
    AssetAuthorizedEffectSite::StrictDeliveryReceipt
);

asset_authorized_effect_race_tests!(
    asset_signed_url_width_materialization_logout_wins_before_reservation,
    asset_signed_url_width_materialization_reservation_wins_before_logout,
    AssetAuthorizedEffectSite::SignedUrlWidthMaterialization
);

asset_authorized_effect_race_tests!(
    asset_strict_delivery_width_materialization_logout_wins_before_reservation,
    asset_strict_delivery_width_materialization_reservation_wins_before_logout,
    AssetAuthorizedEffectSite::StrictDeliveryWidthMaterialization
);
