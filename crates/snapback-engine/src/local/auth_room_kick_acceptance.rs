//! ENG-24604 integrated acceptance for the card-game membership-kick trace.
//! @ref LLP 0053#ephemeral-room-authority-invalidation — a membership kick must
//! fence storage, protected-room admission, queued work, and final send as one
//! authority transition.
//!
//! The lower-level race matrix remains next to the room authority in
//! `ephemeral.rs`; this module proves those primitives compose through a real
//! permission-backing SQLite commit, durable invalidation, and fresh room
//! reauthorization. The clause map is recorded in
//! `tests/eng-24604-protected-room-kick.acceptance.md`.

use super::*;
use crate::auth::mode::{
    AuthProgramReadiness, DeploymentIdentity, FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX,
    SCHEMA_V1_PREFIX,
};
use crate::ephemeral::{
    AccessPolicy, AdmittedRealtimeEnvelope, CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_JSON,
    EphemeralErrorCode, RemoveReason, ResyncReason, RoomAuthorityPermit,
};
use crate::manifest::{
    AuthManifest, AuthRequirement, FieldManifest, FieldType, FilterExpr, FilterOp, IbexModule,
    IndexManifest, ReturnValue, SNAPBACK_SESSIONS_SCHEMA_VERSION, TableManifest,
    TargetCapabilityId,
};
use crate::storage::{
    AuthorizationCommitFaultForTest, AuthorizationCommitPreflight, AuthorizationVersion,
    MembershipWriter, inject_authorization_commit_fault_for_test,
};
use serde_json::{Map, Value, json};
use std::sync::{Arc, Mutex, PoisonError, mpsc};
use std::time::{Duration, Instant};

const BOARD_ID: &str = "board-acceptance";
const UNRELATED_BOARD_ID: &str = "board-unrelated";
const CONNECTION_A: &str = "player-a";
const CONNECTION_B: &str = "player-b";
const CONNECTION_UNRELATED: &str = "player-b-unrelated-room";
const USER_A: &str = "018f0d90-7b31-7a22-8c33-445566778899";
const USER_B: &str = "018f0d90-7b32-7a22-8c33-445566778899";
const USER_C: &str = "018f0d90-7b37-7a22-8c33-445566778899";
const USER_D: &str = "018f0d90-7b38-7a22-8c33-445566778899";
const SESSION_A: &str = "018f0d90-7b33-7a22-8c33-445566778899";
const SESSION_B: &str = "018f0d90-7b34-7a22-8c33-445566778899";
const AUTHORITY_A: &str = "018f0d90-7b35-7a22-8c33-445566778899";
const AUTHORITY_B: &str = "018f0d90-7b36-7a22-8c33-445566778899";
const MUTATION_SESSION_B: &str = "018f0d90-7b39-7a22-8c33-445566778899";
const MUTATION_AUTHORITY_B: &str = "018f0d90-7b3a-7a22-8c33-445566778899";
const MEMBER_A: &str = "member-a";
const MEMBER_B: &str = "member-b";
const MEMBER_B_UNRELATED: &str = "member-b-unrelated";
const OPPONENT_MOVE: &str = "B:queen-of-spades";
const OPPONENT_PRESENCE: &[u8] = b"B:opponent-private-presence";
const APP_ID: &str = "card-game-acceptance";

struct KickFixture {
    snapback: Arc<Mutex<LocalSnapback>>,
    ephemeral: EphemeralApi,
    room_auth_a: AuthContext,
    room_auth_b: AuthContext,
    unrelated_room_auth_b: AuthContext,
    unrelated_room_observed: AuthorizationVersion,
    opponent_presence_entry_version: u64,
    mutation_authority_b: PreparedAuthority,
}

#[derive(Debug)]
struct KickBoundaryObservations {
    lookup_to_room_mutation_refused: bool,
    affected_registration_refused: bool,
    unrelated_registration_completed: bool,
    unrelated_publish_drained: bool,
    commit_waited_for_drained_send: bool,
    commit_waited_for_durable_board_send: bool,
    drained_old_generation_send_refused: bool,
    drained_old_board_send_refused: bool,
}

fn drain_through_test_sink(ephemeral: &EphemeralApi, connection_id: &str) -> Vec<RealtimeEnvelope> {
    ephemeral
        .drain_outbox_for_send(connection_id)
        .into_iter()
        .map(AdmittedRealtimeEnvelope::into_parts)
        .map(|(envelope, permit)| {
            drop(permit);
            envelope
        })
        .collect()
}

fn is_authorization_snapshot(envelope: &RealtimeEnvelope) -> bool {
    matches!(envelope, RealtimeEnvelope::Durable(message)
    if serde_json::from_slice::<Value>(&message.payload).is_ok_and(|frame| {
        frame["kind"] == "authorization_invalidation"
            && frame.get("snapshot").is_some_and(|snapshot| !snapshot.is_null())
    }))
}

fn is_authorization_snapshot_for(envelope: &RealtimeEnvelope, function: &str) -> bool {
    matches!(envelope, RealtimeEnvelope::Durable(message)
    if serde_json::from_slice::<Value>(&message.payload).is_ok_and(|frame| {
        frame["kind"] == "authorization_invalidation"
            && frame["snapshot"]["function"] == function
    }))
}

// @ref LLP 0094#0c8-sessions-live-update-envelope-and-delivery-multiplicity —
// direct retained projection is the sole auth-snapshot lane.
fn assert_no_physical_authorization_snapshot(envelope: &RealtimeEnvelope) {
    assert!(
        !is_authorization_snapshot(envelope),
        "the physical outbox must not duplicate a projected authorization snapshot"
    );
}

fn project_authorization_envelopes(
    snapback: &mut LocalSnapback,
    connection_id: &str,
) -> Vec<RealtimeEnvelope> {
    let admission = snapback
        .admission
        .admit_for_mode(AuthMode::Sessions)
        .expect("project authorization frames under the target engine admission");
    snapback
        .authorization_invalidation_frames(connection_id, &admission)
        .expect("project pending authorization frames")
        .into_iter()
        .map(RealtimeEnvelope::Durable)
        .collect()
}

impl KickFixture {
    fn new() -> Self {
        let mut snapback = LocalSnapback::memory().expect("memory snapback");
        let schema = game_schema();
        snapback
            .auth_database_mut()
            .stage_auth_mode(game_deployment(), schema.clone(), Some(game_members()))
            .expect("stage complete sessions game deployment and seed");
        let settled = snapback
            .auth_database_mut()
            .consume_sessions_auth_mode(&AuthProgramReadiness::new(
                true, true, true, true, true, true, false,
            ))
            .expect("consume staged sessions game deployment");
        snapback
            .synchronize_auth_mode_admission(&settled)
            .expect("bind local admission to settled sessions mode");
        let session_created_at_ms = now_millis();
        for (user_id, session_id, authority_instance_id, address, token_byte) in [
            (USER_A, SESSION_A, AUTHORITY_A, "a@example.test", 0xa1),
            (USER_B, SESSION_B, AUTHORITY_B, "b@example.test", 0xb2),
        ] {
            let identity_id = crate::ids::mint_time_ordered(crate::ids::Kind::Identity);
            snapback
                .auth_database_mut()
                .auth_catalog()
                .insert_nonprincipal_email_session_for_test(
                    user_id,
                    &identity_id,
                    session_id,
                    authority_instance_id,
                    address,
                    &[token_byte; 32],
                    session_created_at_ms,
                    session_created_at_ms,
                    9_007_199_254_740_991,
                    9_007_199_254_740_991,
                )
                .expect("install the durable acceptance session");
        }
        snapback
            .ephemeral
            .replace_collections(schema.ephemeral_collections)
            .expect("publish the staged protected room definition");
        let diagnostics = snapback.load_functions(game_functions());
        assert!(
            diagnostics
                .iter()
                .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED"),
            "game functions load without error diagnostics: {diagnostics:?}"
        );
        let durable_a_authority = snapback.prepare_resolved_session_for_test(
            InvocationSource::LiveInitialQuery,
            USER_A,
            SESSION_A,
            AUTHORITY_A,
            1,
            9_007_199_254_740_991,
        );
        let durable_b_authority = snapback.prepare_resolved_session_for_test(
            InvocationSource::LiveInitialQuery,
            USER_B,
            SESSION_B,
            AUTHORITY_B,
            1,
            9_007_199_254_740_991,
        );
        let mutation_authority_b = snapback.prepare_resolved_session_for_test(
            InvocationSource::HttpMutation,
            USER_B,
            MUTATION_SESSION_B,
            MUTATION_AUTHORITY_B,
            1,
            9_007_199_254_740_991,
        );
        let [connection_a, connection_b] = install_invalidation(&mut snapback);

        let durable_a = snapback
            .subscribe_live_prepared_with_invalidation(
                "currentMembership",
                durable_subscribe(CONNECTION_A, "store-a", 1),
                durable_a_authority.clone(),
                LiveInvalidationAdmission::new(connection_a.clone()).with_session_mode(true),
            )
            .expect("A subscribes to its durable membership");
        let durable_b = snapback
            .subscribe_live_prepared_with_invalidation(
                "currentMembership",
                durable_subscribe(CONNECTION_B, "store-b", 1),
                durable_b_authority.clone(),
                LiveInvalidationAdmission::new(connection_b.clone()).with_session_mode(true),
            )
            .expect("B subscribes to its durable membership");
        assert_eq!(durable_a.snapshot.as_ref().unwrap().rows.len(), 1);
        assert_eq!(
            durable_a.snapshot.as_ref().unwrap().rows[0]["_id"],
            MEMBER_A
        );
        assert_eq!(durable_b.snapshot.as_ref().unwrap().rows.len(), 1);
        assert_eq!(
            durable_b.snapshot.as_ref().unwrap().rows[0]["_id"],
            MEMBER_B
        );
        let board_a = snapback
            .subscribe_live_prepared_with_invalidation(
                "board",
                board_subscribe(CONNECTION_A, "store-a", 2),
                durable_a_authority,
                LiveInvalidationAdmission::new(connection_a).with_session_mode(true),
            )
            .expect("A subscribes to the durable board while a member");
        let board_b = snapback
            .subscribe_live_prepared_with_invalidation(
                "board",
                board_subscribe(CONNECTION_B, "store-b", 2),
                durable_b_authority,
                LiveInvalidationAdmission::new(connection_b).with_session_mode(true),
            )
            .expect("B subscribes to the durable board while a member");
        for board in [&board_a, &board_b] {
            assert_eq!(board.snapshot.as_ref().unwrap().rows.len(), 1);
            assert_eq!(
                board.snapshot.as_ref().unwrap().rows[0]["move"],
                OPPONENT_MOVE
            );
        }
        // Drive the real durable fanout path before the kick so A's retained
        // obligation projects an authorization-stamped board snapshot that can
        // be paused at final send alongside the protected presence frame.
        snapback.notify_live_subscriptions(&[]);

        let ephemeral = snapback.ephemeral_api();
        let room_auth_a = register_room(&snapback, &ephemeral, CONNECTION_A, USER_A, 10);
        let room_auth_b = register_room(&snapback, &ephemeral, CONNECTION_B, USER_B, 11);
        let (unrelated_room_auth_b, unrelated_room_observed) = snapback
            .authorize_ephemeral_room_observed(
                "gamePresence",
                &room_scope_for(UNRELATED_BOARD_ID),
                base_room_auth(USER_B),
            )
            .expect("lookup for an unrelated protected room completes before the kick");
        publish_presence(&snapback, &ephemeral, CONNECTION_A, USER_A, b"A:ready", 12)
            .expect("A publishes its pre-kick presence");
        let opponent_presence = publish_presence(
            &snapback,
            &ephemeral,
            CONNECTION_B,
            USER_B,
            OPPONENT_PRESENCE,
            13,
        )
        .expect("B publishes opponent presence before the kick");

        Self {
            snapback: Arc::new(Mutex::new(snapback)),
            ephemeral,
            room_auth_a,
            room_auth_b,
            unrelated_room_auth_b,
            unrelated_room_observed,
            opponent_presence_entry_version: opponent_presence.entry_version,
            mutation_authority_b,
        }
    }

    fn kick_while_holding_final_send(
        &self,
    ) -> (
        MutationOutput,
        RealtimeEnvelope,
        RealtimeEnvelope,
        KickBoundaryObservations,
    ) {
        let old_board_envelope = {
            let mut snapback = self.snapback.lock().unwrap_or_else(PoisonError::into_inner);
            project_authorization_envelopes(&mut snapback, CONNECTION_A)
                .into_iter()
                .find(|envelope| is_authorization_snapshot_for(envelope, "board"))
                .expect("A's private board snapshot reached direct projection")
        };
        let old_board_send_permit = self
            .ephemeral
            .begin_final_send(&old_board_envelope)
            .expect("pre-kick board projection reaches final send")
            .expect("auth-scoped projected board carries publication permit");
        let admitted = self
            .ephemeral
            .drain_outbox_for_send_if_active(CONNECTION_A)
            .expect("A is an active room connection");
        let mut old_room = None;
        for admitted in admitted {
            let (envelope, permit) = admitted.into_parts();
            assert_no_physical_authorization_snapshot(&envelope);
            if matches!(
                &envelope,
                RealtimeEnvelope::Ephemeral(EphemeralMessage::Upsert { entry, .. })
                    if entry.value == OPPONENT_PRESENCE
            ) {
                old_room = Some((
                    envelope,
                    permit.expect("protected frame carries send permit"),
                ));
                continue;
            }
        }
        let (old_room_envelope, old_room_send_permit) =
            old_room.expect("A's pre-kick opponent-presence frame reached destructive drain");

        let snapback = self.snapback.clone();
        let mutation_authority_b = self.mutation_authority_b.clone();
        let (started_tx, started_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let kick = std::thread::spawn(move || {
            started_tx.send(()).expect("signal kick start");
            let result = snapback
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .invoke_mutation_with_authority(
                    "kickMember",
                    HandlerInput {
                        args: json!({ "id": MEMBER_A }),
                        ..HandlerInput::default()
                    },
                    mutation_authority_b,
                );
            done_tx.send(result).expect("return kick result");
        });
        started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("kick thread started");

        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            match self
                .ephemeral
                .begin_server_authorized_room_act("gamePresence", &room_scope())
            {
                Err(error) if error.code == EphemeralErrorCode::AuthorityPending => break,
                Ok(permit) => drop(permit),
                Err(error) => panic!("unexpected room admission result: {error:?}"),
            }
            assert!(
                Instant::now() < deadline,
                "kick did not install its dependency ticket"
            );
            std::thread::yield_now();
        }
        assert!(
            done_rx.try_recv().is_err(),
            "the SQLite kick must wait for the drained final-send permit"
        );

        let late = self
            .ephemeral
            .subscribe(
                room_subscribe("late-registration", self.room_auth_b.clone()),
                13,
            )
            .expect_err("pending dependency ticket closes racing registration");
        let affected_registration_refused = late.code == EphemeralErrorCode::AuthorityPending;
        assert!(affected_registration_refused);
        let stale_publish = self
            .ephemeral
            .publish(
                room_publish(
                    CONNECTION_A,
                    USER_A,
                    self.room_auth_a.clone(),
                    b"A:after-lookup",
                ),
                14,
            )
            .expect_err("pending barrier rejects old-authority mutation/enqueue");
        let lookup_to_room_mutation_refused =
            stale_publish.code == EphemeralErrorCode::AuthorityPending;
        assert!(lookup_to_room_mutation_refused);

        // L9 is room-selective, not a global protected-room pause. This
        // registration performed its durable lookup before the write, then
        // races admission/snapshot against the dependency ticket. Because the
        // deleted row names BOARD_ID exactly, the unrelated room may register,
        // publish, and drain while the affected room remains quiesced.
        let unrelated_permit = self
            .ephemeral
            .begin_server_authorized_room_act("gamePresence", &room_scope_for(UNRELATED_BOARD_ID))
            .expect("unrelated room admission remains live")
            .expect("protected unrelated room returns a permit");
        assert_eq!(
            self.ephemeral.authorization_expectation_for_test(),
            Some(self.unrelated_room_observed.clone())
        );
        let unrelated_snapshot = self
            .ephemeral
            .subscribe(
                room_subscribe_for(
                    CONNECTION_UNRELATED,
                    self.unrelated_room_auth_b.clone(),
                    UNRELATED_BOARD_ID,
                ),
                15,
            )
            .expect("unrelated room registers while affected room is pending");
        let unrelated_registration_completed = matches!(
            unrelated_snapshot,
            EphemeralMessage::Snapshot {
                room_authority_generation: 1,
                ..
            }
        );
        assert!(unrelated_registration_completed);
        drop(unrelated_permit);
        self.ephemeral
            .publish(
                room_publish_for(
                    CONNECTION_UNRELATED,
                    USER_B,
                    self.unrelated_room_auth_b.clone(),
                    b"B:unrelated-live",
                    UNRELATED_BOARD_ID,
                ),
                16,
            )
            .expect("unrelated room publishes while affected room is pending");
        let unrelated_frames = drain_through_test_sink(&self.ephemeral, CONNECTION_UNRELATED);
        let unrelated_publish_drained = unrelated_frames.iter().any(|frame| {
            matches!(
                frame,
                RealtimeEnvelope::Ephemeral(EphemeralMessage::Upsert {
                    room_authority_generation: 1,
                    entry,
                    ..
                }) if entry.value == b"B:unrelated-live"
            )
        });
        assert!(unrelated_publish_drained);
        let commit_waited_for_drained_send = done_rx.try_recv().is_err();
        assert!(
            commit_waited_for_drained_send,
            "unrelated progress occurs while the affected permit still holds commit"
        );

        drop(old_room_send_permit);
        let commit_waited_for_durable_board_send = done_rx.try_recv().is_err();
        assert!(
            commit_waited_for_durable_board_send,
            "the auth-scoped durable board permit independently holds the commit boundary"
        );
        drop(old_board_send_permit);
        let output = done_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("kick completes after quiescence")
            .expect("kick mutation commits");
        kick.join().expect("kick thread joins");

        let rejected = match self.ephemeral.begin_final_send(&old_room_envelope) {
            Err(error) => error,
            Ok(_) => panic!("generation-1 frame crossed final send after commit"),
        };
        let drained_old_generation_send_refused =
            rejected.code == EphemeralErrorCode::AuthorityPending;
        assert!(drained_old_generation_send_refused);
        let rejected = match self.ephemeral.begin_final_send(&old_board_envelope) {
            Err(error) => error,
            Ok(_) => panic!("pre-kick board snapshot crossed final send after commit"),
        };
        let drained_old_board_send_refused = rejected.code == EphemeralErrorCode::AuthorityPending;
        assert!(drained_old_board_send_refused);
        (
            output,
            old_room_envelope,
            old_board_envelope,
            KickBoundaryObservations {
                lookup_to_room_mutation_refused,
                affected_registration_refused,
                unrelated_registration_completed,
                unrelated_publish_drained,
                commit_waited_for_drained_send,
                commit_waited_for_durable_board_send,
                drained_old_generation_send_refused,
                drained_old_board_send_refused,
            },
        )
    }

    fn drain_composed_delivery(
        &self,
        connection_id: &str,
        _user_id: &str,
    ) -> Vec<RealtimeEnvelope> {
        let projections = {
            let mut snapback = self.snapback.lock().unwrap_or_else(PoisonError::into_inner);
            project_authorization_envelopes(&mut snapback, connection_id)
        };
        let admitted = self
            .ephemeral
            .drain_outbox_for_send_if_active(connection_id)
            .expect("connection remains active");
        let mut frames = admitted
            .into_iter()
            .map(AdmittedRealtimeEnvelope::into_parts)
            .map(|(envelope, permit)| {
                assert_no_physical_authorization_snapshot(&envelope);
                drop(permit);
                envelope
            })
            .collect::<Vec<_>>();
        frames.extend(projections.into_iter().map(|envelope| {
            let permit = self
                .ephemeral
                .begin_final_send(&envelope)
                .expect("projected authorization frame reaches final send");
            if is_authorization_snapshot(&envelope) {
                assert!(
                    permit.is_some(),
                    "projected auth snapshot carries a final-send permit"
                );
            }
            drop(permit);
            envelope
        }));
        frames
    }
}

#[test]
fn codegen_manifest_enforces_anonymous_pending_and_active_role_room_grants() {
    let snapback = codegen_membership_snapback();
    let scope = codegen_membership_scope();

    let anonymous = snapback
        .authorize_ephemeral_room_observed("typing", &scope, codegen_membership_auth(None))
        .expect_err("anonymous authority cannot satisfy a membership projection");
    assert_eq!(anonymous.diagnostic.code, "SNAPBACK_AUTH_PERMISSION_DENIED");

    let pending = snapback
        .authorize_ephemeral_room_observed("typing", &scope, codegen_membership_auth(Some(USER_C)))
        .expect_err("an invited pending row cannot satisfy the active-role projection");
    assert_eq!(pending.diagnostic.code, "SNAPBACK_AUTH_PERMISSION_DENIED");

    let (member, observed) = snapback
        .authorize_ephemeral_room_observed("typing", &scope, codegen_membership_auth(Some(USER_A)))
        .expect("the codegen-emitted projection grants a current member");
    assert!(
        member.permissions.contains(&format!(
            "m_conversation_members:{}",
            scope.normalized_key()
        )),
        "the grant uses the generated membership prefix"
    );
    assert_eq!(
        snapback.ephemeral.authorization_expectation_for_test(),
        Some(observed),
        "the durable grant observes the installed sessions invalidation authority"
    );
}

#[test]
fn serialized_membership_projection_omission_denies_pending_subscribe_and_publish() {
    let mut serialized: Value = serde_json::from_str(CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_JSON)
        .expect("codegen membership artifact is serialized JSON");
    let projection = serialized["ephemeralCollections"][0]["permissionBacking"]
        .as_object_mut()
        .expect("serialized artifact carries a permission projection");
    assert!(projection.remove("roleField").is_some());
    assert!(projection.remove("allowedRoles").is_some());
    let schema: SchemaManifest = serde_json::from_value(serialized)
        .expect("direct serialized artifact accepts omitted additive fields");
    let omitted = schema.ephemeral_collections[0]
        .permission_backing
        .as_ref()
        .expect("direct artifact retains its projection");
    assert_eq!(
        (omitted.role_field.as_ref(), omitted.allowed_roles.as_ref()),
        (None, None)
    );

    let (snapback, _) = codegen_membership_snapback_from_schema(schema);
    let scope = codegen_membership_scope();
    for operation in ["subscribe", "publish"] {
        let denial = snapback
            .authorize_ephemeral_room_observed(
                "typing",
                &scope,
                codegen_membership_auth(Some(USER_C)),
            )
            .expect_err("an omitted pair must canonicalize before granting a pending row");
        assert_eq!(
            denial.diagnostic.code, "SNAPBACK_AUTH_PERMISSION_DENIED",
            "{operation}"
        );
    }

    let ephemeral = snapback.ephemeral_api();
    let subscribe = ephemeral
        .subscribe(
            SubscribeRequest {
                collection: "typing".to_owned(),
                scope: scope.clone(),
                connection_id: "omitted-pending".to_owned(),
                auth: codegen_membership_auth(Some(USER_C)),
                since_chunk: None,
            },
            10,
        )
        .expect_err("the pending row receives no subscribe permission token");
    assert_eq!(subscribe.code, EphemeralErrorCode::Unauthorized);
    let publish = ephemeral
        .publish(
            PublishRequest {
                collection: "typing".to_owned(),
                scope,
                connection_id: "omitted-pending".to_owned(),
                session_id: None,
                user_id: Some(USER_C.to_owned()),
                custom_key: None,
                value: b"pending-must-not-publish".to_vec(),
                ttl_ms: None,
                auth: codegen_membership_auth(Some(USER_C)),
            },
            11,
        )
        .expect_err("the pending row receives no publish permission token");
    assert_eq!(publish.code, EphemeralErrorCode::Unauthorized);
}

#[test]
fn direct_artifact_refuses_non_principal_membership_projection_subject_axis() {
    let mut serialized: Value = serde_json::from_str(CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_JSON)
        .expect("codegen membership artifact is serialized JSON");
    serialized["ephemeralCollections"][0]["permissionBacking"]["subjectField"] = json!("role");
    let schema: SchemaManifest =
        serde_json::from_value(serialized).expect("doctored direct artifact parses");

    let mut activation = LocalSnapback::memory().expect("subject-axis activation fixture");
    let refused = activation
        .apply_schema(schema)
        .expect_err("membership projection must bind the declared principal axis");
    assert_eq!(
        refused.diagnostic.code,
        "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION"
    );
    assert!(refused.diagnostic.message.contains("subjectField"));
}

#[test]
fn direct_artifact_refuses_non_resource_membership_projection_scope_axis() {
    let mut serialized: Value = serde_json::from_str(CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_JSON)
        .expect("codegen membership artifact is serialized JSON");
    serialized["ephemeralCollections"][0]["permissionBacking"]["scopeFields"]["conversationId"] =
        json!("role");
    let schema: SchemaManifest =
        serde_json::from_value(serialized).expect("doctored direct artifact parses");

    let mut activation = LocalSnapback::memory().expect("scope-axis activation fixture");
    let refused = activation
        .apply_schema(schema)
        .expect_err("membership projection must bind the declared resource axis");
    assert_eq!(
        refused.diagnostic.code,
        "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION"
    );
    assert!(refused.diagnostic.message.contains("scopeFields"));
}

#[test]
fn legacy_room_permission_without_backing_refuses_sessions_activation() {
    let mut schema = codegen_membership_schema();
    let collection = schema
        .ephemeral_collections
        .first_mut()
        .expect("codegen fixture collection");
    collection.publish = AccessPolicy::RequireRoomPermission {
        prefix: "legacy_room".to_owned(),
    };
    collection.subscribe = AccessPolicy::RequireRoomPermission {
        prefix: "legacy_room".to_owned(),
    };
    collection.permission_backing = None;

    let mut activation = LocalSnapback::memory().expect("legacy activation fixture");
    let refused = activation
        .apply_schema(schema.clone())
        .expect_err("sessions activation must reject an unbacked protected collection");
    assert_eq!(
        refused.diagnostic.code,
        "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION"
    );
    assert!(refused.diagnostic.message.contains("permissionBacking"));

    let snapback = codegen_membership_snapback();
    snapback
        .ephemeral
        .replace_collections(schema.ephemeral_collections)
        .expect("direct embedder can expose the legacy runtime compatibility shape");
    let unavailable = snapback
        .authorize_ephemeral_room_observed(
            "typing",
            &codegen_membership_scope(),
            codegen_membership_auth(Some(USER_A)),
        )
        .expect_err("the runtime compatibility path also fails closed without backing");
    assert_eq!(
        unavailable.diagnostic.code,
        "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE"
    );
}

fn commit_codegen_membership_role_change(
    snapback: &mut LocalSnapback,
    member_id: &str,
    role: &str,
) -> MutationOutput {
    let writer = MembershipWriter::User {
        effective_principal: USER_B.to_owned(),
    };
    let transition = snapback
        .db
        .membership_plans()
        .plan_membership_set_role(&writer, "conversationMembers", member_id, role)
        .expect("the emitted owner transition authorizes the role change");
    let admission = snapback
        .admission
        .admit_for_mode(AuthMode::Sessions)
        .expect("membership role change holds sessions publication admission");
    snapback
        .try_with_direct_authorization_write(
            AuthorizationCommitPreflight::AllProtectedRooms,
            move |snapback| {
                let committed = snapback
                    .db
                    .membership_plans()
                    .commit_membership_plan(&writer, transition)?;
                if let Some(authorization) = committed
                    .authorization
                    .as_ref()
                    .filter(|authorization| authorization.event)
                {
                    snapback.notify_authorization_event_in_frame(
                        authorization,
                        committed.output.version,
                        &admission,
                    )?;
                }
                Ok::<_, crate::diagnostic::SnapbackError>(committed)
            },
        )
        .expect("the direct embedder installs the room reservation")
        .require_finalized()
        .expect("the direct embedder observes authorization finalization")
        .expect("membership role change commits through the authorization interlock")
        .output
}

#[test]
fn codegen_membership_allowed_role_change_preserves_the_live_subscriber() {
    let mut schema = codegen_membership_schema();
    schema.ephemeral_collections[0]
        .permission_backing
        .as_mut()
        .expect("codegen fixture carries a membership projection")
        .allowed_roles = Some(vec![
        "owner".to_owned(),
        "member".to_owned(),
        "moderator".to_owned(),
    ]);
    let (mut snapback, _) = codegen_membership_snapback_from_schema(schema);
    let ephemeral = snapback.ephemeral_api();
    let scope = codegen_membership_scope();
    let (member_auth, observed) = snapback
        .authorize_ephemeral_room_observed("typing", &scope, codegen_membership_auth(Some(USER_A)))
        .expect("member receives the codegen-backed room grant");
    let subscribe_permit = ephemeral
        .begin_server_authorized_room_act("typing", &scope)
        .expect("room authority is available")
        .expect("protected collection returns a room permit");
    assert_eq!(
        ephemeral.authorization_expectation_for_test(),
        Some(observed)
    );
    ephemeral
        .subscribe(
            SubscribeRequest {
                collection: "typing".to_owned(),
                scope: scope.clone(),
                connection_id: "codegen-member-a".to_owned(),
                auth: member_auth,
                since_chunk: None,
            },
            10,
        )
        .expect("member registers in the role-aware room");
    drop(subscribe_permit);

    let (publish_auth, _) = snapback
        .authorize_ephemeral_room_observed("typing", &scope, codegen_membership_auth(Some(USER_A)))
        .expect("member may publish before the allowed role change");
    let publish_permit = ephemeral
        .begin_server_authorized_room_act("typing", &scope)
        .expect("room authority is available")
        .expect("protected collection returns a room permit");
    ephemeral
        .publish(
            PublishRequest {
                collection: "typing".to_owned(),
                scope: scope.clone(),
                connection_id: "codegen-member-a".to_owned(),
                session_id: None,
                user_id: Some(USER_A.to_owned()),
                custom_key: None,
                value: b"member-before-allowed-change".to_vec(),
                ttl_ms: None,
                auth: publish_auth,
            },
            11,
        )
        .expect("member publication enters before the allowed role change");
    drop(publish_permit);
    let before = ephemeral.diagnostics().subscriber_count;

    let committed = commit_codegen_membership_role_change(&mut snapback, MEMBER_A, "moderator");
    assert_eq!(committed.changed_count, 1);
    let before_reauthorization = drain_through_test_sink(&ephemeral, "codegen-member-a");
    assert_auth_changed(&before_reauthorization, 2);
    let completed = snapback
        .reauthorize_pending_ephemeral_rooms(|connection_id, previous| {
            assert_eq!(connection_id, "codegen-member-a");
            Ok(Some(previous.clone()))
        })
        .expect("the admitted owner role reauthorizes the existing subscriber");
    assert_eq!(completed, 1);
    assert_eq!(
        ephemeral.diagnostics().subscriber_count,
        before,
        "allowed-to-allowed role changes retain the live subscriber"
    );
    let after_reauthorization = drain_through_test_sink(&ephemeral, "codegen-member-a");
    assert!(after_reauthorization.iter().all(|frame| !matches!(
        frame,
        RealtimeEnvelope::Ephemeral(EphemeralMessage::Error { error, .. })
            if error.code == EphemeralErrorCode::PermissionDenied
    )));
    assert!(after_reauthorization.iter().all(|frame| !matches!(
        frame,
        RealtimeEnvelope::Ephemeral(EphemeralMessage::Remove {
            key: crate::ephemeral::EntryKey(key),
            reason: RemoveReason::AuthRevoked,
            ..
        }) if key == "codegen-member-a"
    )));
}

#[test]
fn codegen_membership_role_downgrade_kicks_and_scrubs_the_room_subscriber() {
    let mut snapback = codegen_membership_snapback();
    let ephemeral = snapback.ephemeral_api();
    let scope = codegen_membership_scope();
    let (member_auth, observed_a) = snapback
        .authorize_ephemeral_room_observed("typing", &scope, codegen_membership_auth(Some(USER_A)))
        .expect("current member receives the codegen-backed room grant");
    let permit_a = ephemeral
        .begin_server_authorized_room_act("typing", &scope)
        .expect("room authority is available")
        .expect("protected collection returns a room permit");
    assert_eq!(
        ephemeral.authorization_expectation_for_test(),
        Some(observed_a)
    );
    ephemeral
        .subscribe(
            SubscribeRequest {
                collection: "typing".to_owned(),
                scope: scope.clone(),
                connection_id: "codegen-member-a".to_owned(),
                auth: member_auth,
                since_chunk: None,
            },
            10,
        )
        .expect("member registers in the codegen-backed room");
    drop(permit_a);

    let (owner_auth, observed_b) = snapback
        .authorize_ephemeral_room_observed("typing", &scope, codegen_membership_auth(Some(USER_B)))
        .expect("owner is also in the explicit allowed role subset");
    let permit_b = ephemeral
        .begin_server_authorized_room_act("typing", &scope)
        .expect("room authority is available")
        .expect("protected collection returns a room permit");
    assert_eq!(
        ephemeral.authorization_expectation_for_test(),
        Some(observed_b)
    );
    ephemeral
        .subscribe(
            SubscribeRequest {
                collection: "typing".to_owned(),
                scope: scope.clone(),
                connection_id: "codegen-owner-b".to_owned(),
                auth: owner_auth.clone(),
                since_chunk: None,
            },
            11,
        )
        .expect("owner registers as the survivor");
    drop(permit_b);
    assert_eq!(ephemeral.diagnostics().subscriber_count, 2);

    let (publish_auth, _) = snapback
        .authorize_ephemeral_room_observed("typing", &scope, codegen_membership_auth(Some(USER_A)))
        .expect("member may publish before the downgrade");
    let publish_permit = ephemeral
        .begin_server_authorized_room_act("typing", &scope)
        .expect("room authority is available")
        .expect("protected collection returns a room permit");
    ephemeral
        .publish(
            PublishRequest {
                collection: "typing".to_owned(),
                scope: scope.clone(),
                connection_id: "codegen-member-a".to_owned(),
                session_id: None,
                user_id: Some(USER_A.to_owned()),
                custom_key: None,
                value: b"member-before-downgrade".to_vec(),
                ttl_ms: None,
                auth: publish_auth,
            },
            12,
        )
        .expect("member publication enters the room before downgrade");
    drop(publish_permit);

    let committed = commit_codegen_membership_role_change(&mut snapback, MEMBER_A, "moderator");
    assert_eq!(committed.changed_count, 1);
    let pending = ephemeral.pending_room_reauthorizations();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].obligation.min_commit_version, committed.version);

    let pre_reauthorization_a = drain_through_test_sink(&ephemeral, "codegen-member-a");
    let pre_reauthorization_b = drain_through_test_sink(&ephemeral, "codegen-owner-b");
    assert_auth_changed(&pre_reauthorization_a, 2);
    assert_auth_changed(&pre_reauthorization_b, 2);
    for frames in [&pre_reauthorization_a, &pre_reauthorization_b] {
        assert!(
            frames.iter().all(|frame| !matches!(
                frame,
                RealtimeEnvelope::Ephemeral(EphemeralMessage::Upsert {
                    room_authority_generation: 1,
                    ..
                })
            )),
            "the barrier quiesces the queued old-generation publication at every sink"
        );
    }

    let completed = snapback
        .reauthorize_pending_ephemeral_rooms(|connection_id, previous| {
            assert!(matches!(
                connection_id,
                "codegen-member-a" | "codegen-owner-b"
            ));
            Ok(Some(previous.clone()))
        })
        .expect("the committed role change is re-read through the emitted projection");
    assert_eq!(completed, 1);
    assert_eq!(
        ephemeral.diagnostics().subscriber_count,
        1,
        "the disallowed moderator is unregistered while the allowed owner survives"
    );
    let denied = drain_through_test_sink(&ephemeral, "codegen-member-a");
    assert!(denied.iter().any(|frame| matches!(
        frame,
        RealtimeEnvelope::Ephemeral(EphemeralMessage::Error {
            error,
            room_authority_generation: Some(2),
            ..
        }) if error.code == EphemeralErrorCode::PermissionDenied
    )));
    let survivor = drain_through_test_sink(&ephemeral, "codegen-owner-b");
    assert!(
        survivor.iter().any(|frame| matches!(
            frame,
            RealtimeEnvelope::Ephemeral(EphemeralMessage::Remove {
                key: crate::ephemeral::EntryKey(key),
                reason: RemoveReason::AuthRevoked,
                room_authority_generation: 2,
                ..
            }) if key == "codegen-member-a"
        )),
        "survivor receives removal of the downgraded member's entry"
    );

    let denied_publish = snapback
        .authorize_ephemeral_room_observed("typing", &scope, codegen_membership_auth(Some(USER_A)))
        .expect_err("the downgraded moderator cannot authorize a later publication");
    assert_eq!(
        denied_publish.diagnostic.code,
        "SNAPBACK_AUTH_PERMISSION_DENIED"
    );
}

#[test]
fn frame_construction_before_first_enqueue_is_commit_ordered() {
    let fixture = KickFixture::new();
    let (room_auth, room_permit) = {
        let snapback = fixture
            .snapback
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        server_room_grant(&snapback, &fixture.ephemeral, USER_B)
    };

    let (frame_reached_tx, frame_reached_rx) = mpsc::sync_channel(0);
    let (frame_release_tx, frame_release_rx) = mpsc::sync_channel(0);
    fixture
        .ephemeral
        .install_frame_before_first_enqueue_hook_for_test(frame_reached_tx, frame_release_rx);

    let publish_ephemeral = fixture.ephemeral.clone();
    let (enqueue_completed_tx, enqueue_completed_rx) = mpsc::sync_channel(0);
    let (permit_release_tx, permit_release_rx) = mpsc::sync_channel(0);
    let publisher = std::thread::spawn(move || {
        let result = publish_ephemeral.publish_with_room_authority(
            room_publish(CONNECTION_B, USER_B, room_auth, b"B:paused-before-enqueue"),
            17,
            Some(&room_permit),
        );
        enqueue_completed_tx
            .send(result)
            .expect("report completed enqueue while retaining its permit");
        permit_release_rx
            .recv()
            .expect("test releases the admitted room permit");
        drop(room_permit);
    });

    let constructed_frame = frame_reached_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("publish paused after frame construction and before first enqueue");
    let hook_observed_constructed_predecessor = matches!(
        &constructed_frame,
        EphemeralMessage::Upsert {
            room_authority_generation: 1,
            entry,
            ..
        } if entry.value == b"B:paused-before-enqueue"
    );
    assert!(hook_observed_constructed_predecessor);

    let snapback = fixture.snapback.clone();
    let mutation_authority_b = fixture.mutation_authority_b.clone();
    let (kick_started_tx, kick_started_rx) = mpsc::channel();
    let (kick_done_tx, kick_done_rx) = mpsc::channel();
    let kick = std::thread::spawn(move || {
        kick_started_tx.send(()).expect("signal kick start");
        let result = snapback
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .invoke_mutation_with_authority(
                "kickMember",
                HandlerInput {
                    args: json!({ "id": MEMBER_A }),
                    ..HandlerInput::default()
                },
                mutation_authority_b,
            );
        kick_done_tx.send(result).expect("report kick result");
    });
    kick_started_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("kick thread started");

    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        match fixture
            .ephemeral
            .begin_server_authorized_room_act("gamePresence", &room_scope())
        {
            Err(error) if error.code == EphemeralErrorCode::AuthorityPending => break,
            Ok(permit) => drop(permit),
            Err(error) => panic!("unexpected room admission result: {error:?}"),
        }
        assert!(
            Instant::now() < deadline,
            "kick did not install its dependency ticket"
        );
        std::thread::yield_now();
    }
    let pending_commit_blocked_before_first_enqueue = kick_done_rx.try_recv().is_err();
    assert!(
        pending_commit_blocked_before_first_enqueue,
        "the pending commit crossed a frame paused before its first enqueue"
    );

    frame_release_tx
        .send(())
        .expect("release the frame into its first enqueue");
    let publish_outcome = enqueue_completed_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("publish completed its enqueue while retaining the admitted permit")
        .expect("the pre-prepare room permit admits the ordered enqueue");
    let enqueue_completed_while_permit_held = publish_outcome.entry_version > 0;
    assert!(enqueue_completed_while_permit_held);
    let commit_blocked_after_enqueue_while_permit_held = kick_done_rx.try_recv().is_err();
    assert!(
        commit_blocked_after_enqueue_while_permit_held,
        "enqueue completion does not release the caller-retained room permit"
    );

    permit_release_tx
        .send(())
        .expect("release the admitted permit after observing enqueue completion");
    publisher.join().expect("publisher joins");
    let committed = kick_done_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("kick commits after the admitted permit drops")
        .expect("kick mutation commits");
    kick.join().expect("kick thread joins");
    let commit_completed_after_permit_drop = committed.changed_count == 1;
    assert!(commit_completed_after_permit_drop);

    let predecessor_frame_rejected_after_commit = fixture
        .ephemeral
        .begin_final_send(&RealtimeEnvelope::Ephemeral(constructed_frame))
        .is_err_and(|error| error.code == EphemeralErrorCode::AuthorityPending);
    assert!(
        predecessor_frame_rejected_after_commit,
        "the constructed generation-1 frame cannot acquire a post-commit send permit"
    );

    println!(
        "SNAPBACK_AUTH_ACCEPTANCE_ROOM_FRAME_ENQUEUE_RECEIPT={}",
        json!({
            "schedule": "frame-construction-before-first-enqueue",
            "hookObservedConstructedPredecessor": hook_observed_constructed_predecessor,
            "pendingCommitBlockedBeforeFirstEnqueue": pending_commit_blocked_before_first_enqueue,
            "enqueueCompletedWhilePermitHeld": enqueue_completed_while_permit_held,
            "commitBlockedAfterEnqueueWhilePermitHeld": commit_blocked_after_enqueue_while_permit_held,
            "commitCompletedAfterPermitDrop": commit_completed_after_permit_drop,
            "predecessorFrameRejectedAfterCommit": predecessor_frame_rejected_after_commit,
            "causingCommitVersion": committed.version,
        })
    );
}

#[test]
fn card_game_kick_composes_durable_and_room_authority_boundaries() {
    let fixture = KickFixture::new();
    let (kick, old_room_envelope, old_board_envelope, boundary_observations) =
        fixture.kick_while_holding_final_send();
    drop((old_room_envelope, old_board_envelope));

    let pending = fixture
        .snapback
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .ephemeral
        .pending_room_reauthorizations();
    assert_eq!(pending.len(), 1, "one protected game room is pending");
    assert_eq!(
        pending[0].room.scope,
        room_scope(),
        "the exact delete selector must not suspend the unrelated game room"
    );
    assert_eq!(pending[0].obligation.min_commit_version, kick.version);
    let expectation = fixture
        .snapback
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .auth_invalidation_expectation_for_test()
        .expect("installed authorization expectation");
    assert_eq!(pending[0].obligation.authorization, expectation);

    let frames_a = fixture.drain_composed_delivery(CONNECTION_A, USER_A);
    let frames_b = fixture.drain_composed_delivery(CONNECTION_B, USER_B);
    assert_durable_kick_snapshot(&frames_a, "currentMembership", kick.version, 0);
    assert_durable_kick_snapshot(&frames_b, "currentMembership", kick.version, 1);
    let board_a = assert_durable_kick_snapshot(&frames_a, "board", kick.version, 0);
    let board_b = assert_durable_kick_snapshot(&frames_b, "board", kick.version, 1);
    assert_eq!(board_b["snapshot"]["rows"][0]["move"], OPPONENT_MOVE);
    let kicked_opponent_presence_frames = frames_a
        .iter()
        .filter(|frame| {
            matches!(
                frame,
                RealtimeEnvelope::Ephemeral(EphemeralMessage::Upsert { entry, .. })
                    if entry.value == OPPONENT_PRESENCE
            )
        })
        .count();
    let kicked_durable_board_rows = board_a["snapshot"]["rows"]
        .as_array()
        .expect("kicked board rows")
        .len();
    assert!(
        kicked_durable_board_rows == 0
            && !serde_json::to_string(&frames_a)
                .expect("A post-kick frames serialize")
                .contains(OPPONENT_MOVE)
            && kicked_opponent_presence_frames == 0,
        "the kicked player receives no durable board or ephemeral opponent state"
    );
    let queued_old_generation_discarded = frames_b.iter().all(|frame| {
        !matches!(
            frame,
            RealtimeEnvelope::Ephemeral(EphemeralMessage::Upsert {
                room_authority_generation: 1,
                ..
            })
        )
    });
    assert!(
        queued_old_generation_discarded,
        "B's queued generation-1 presence is discarded after the kick"
    );
    assert_auth_changed(&frames_a, 2);
    assert_auth_changed(&frames_b, 2);
    fixture
        .ephemeral
        .publish(
            room_publish_for(
                CONNECTION_UNRELATED,
                USER_B,
                fixture.unrelated_room_auth_b.clone(),
                b"B:unrelated-after-commit",
                UNRELATED_BOARD_ID,
            ),
            19,
        )
        .expect("unrelated room keeps generation-1 continuity after the kick");
    assert!(
        drain_through_test_sink(&fixture.ephemeral, CONNECTION_UNRELATED)
            .iter()
            .any(|frame| matches!(
                frame,
                RealtimeEnvelope::Ephemeral(EphemeralMessage::Upsert {
                    room_authority_generation: 1,
                    entry,
                    ..
                }) if entry.value == b"B:unrelated-after-commit"
            ))
    );
    let dropped_refires = drain_through_test_sink(&fixture.ephemeral, CONNECTION_B);
    assert_auth_changed(&dropped_refires, 2);

    let completed = fixture
        .snapback
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .reauthorize_pending_ephemeral_rooms(|connection_id, previous| {
            assert!(matches!(connection_id, CONNECTION_A | CONNECTION_B));
            Ok(Some(previous.clone()))
        })
        .expect("fresh durable membership reauthorizes the room");
    assert_eq!(completed, 1);

    let denied_a = drain_through_test_sink(&fixture.ephemeral, CONNECTION_A);
    let typed_denial_delivered = denied_a.iter().any(|frame| {
        matches!(
            frame,
            RealtimeEnvelope::Ephemeral(EphemeralMessage::Error {
                error,
                room_authority_generation: Some(2),
                ..
            }) if error.code == EphemeralErrorCode::PermissionDenied
        )
    });
    assert!(typed_denial_delivered);
    let survivor_b = drain_through_test_sink(&fixture.ephemeral, CONNECTION_B);
    assert!(survivor_b.iter().any(|frame| matches!(
        frame,
        RealtimeEnvelope::Ephemeral(EphemeralMessage::Remove {
            reason: RemoveReason::AuthRevoked,
            room_authority_generation: 2,
            ..
        })
    )));
    let survivor_snapshot_delivered = survivor_b.iter().any(|frame| {
        matches!(
            frame,
            RealtimeEnvelope::Ephemeral(EphemeralMessage::Snapshot {
                room_authority_generation: 2,
                entries,
                ..
            }) if entries.len() == 1 && entries[0].value == OPPONENT_PRESENCE
        )
    });
    assert!(survivor_snapshot_delivered);

    let denied = fixture
        .snapback
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .authorize_ephemeral_room_observed("gamePresence", &room_scope(), base_room_auth(USER_A))
        .expect_err("A cannot regain a room grant after its membership is deleted");
    assert_eq!(denied.diagnostic.code, "SNAPBACK_AUTH_PERMISSION_DENIED");

    publish_presence_locked(
        &fixture.snapback,
        &fixture.ephemeral,
        CONNECTION_B,
        USER_B,
        b"B:still-here",
        20,
    )
    .expect("B can publish under the fresh generation");
    assert!(
        drain_through_test_sink(&fixture.ephemeral, CONNECTION_A).is_empty(),
        "A was unregistered before B's fresh-generation fanout"
    );
    println!(
        "SNAPBACK_AUTH_ACCEPTANCE_ROOM_ENQUEUE_DRAIN_RECEIPT={}",
        json!({
            "schedule": "enqueue-before-destructive-drain",
            "predecessorFrameEnqueueCompleted": fixture.opponent_presence_entry_version > 0,
            "predecessorFrameEntryVersion": fixture.opponent_presence_entry_version,
            "predecessorGeneration": 1,
            "postCommitDrainDiscardedPredecessor": queued_old_generation_discarded,
            "causingCommitVersion": kick.version,
        })
    );
    println!(
        "SNAPBACK_AUTH_ACCEPTANCE_ROOM_DRAIN_SEND_RECEIPT={}",
        json!({
            "schedule": "destructive-drain-before-final-send",
            "commitBlockedByProtectedRoomSendPermit": boundary_observations.commit_waited_for_drained_send,
            "commitBlockedByDurableBoardSendPermit": boundary_observations.commit_waited_for_durable_board_send,
            "predecessorProtectedRoomFrameRejectedAfterCommit": boundary_observations.drained_old_generation_send_refused,
            "predecessorDurableBoardFrameRejectedAfterCommit": boundary_observations.drained_old_board_send_refused,
            "causingCommitVersion": kick.version,
        })
    );
    println!(
        "SNAPBACK_AUTH_ACCEPTANCE_ROOM_RECEIPT={}",
        json!({
            "causingCommitVersion": kick.version,
            "affectedRoomCount": pending.len(),
            "admissionPausePoints": {
                "lookupBeforeRoomMutation": boundary_observations.lookup_to_room_mutation_refused,
                "registrationAndInitialSnapshot": boundary_observations.affected_registration_refused,
            },
            "unrelatedRoomProgressWhileAffectedPending": {
                "registration": boundary_observations.unrelated_registration_completed,
                "publishAndDrain": boundary_observations.unrelated_publish_drained,
            },
            "postCommit": {
                "kickedDurableBoardRows": kicked_durable_board_rows,
                "kickedOpponentPresenceFrames": kicked_opponent_presence_frames,
                "reauthorizedRoomCount": completed,
                "typedDenialDelivered": typed_denial_delivered,
                "survivorSnapshotDelivered": survivor_snapshot_delivered,
            },
        })
    );
}

#[test]
fn lost_commit_ack_proves_successor_and_finalizes_the_exact_room_ticket() {
    let fixture = KickFixture::new();
    inject_authorization_commit_fault_for_test(AuthorizationCommitFaultForTest::AfterCommit);

    let mutation_authority_b = fixture.mutation_authority_b.clone();
    let kick = fixture
        .snapback
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .invoke_mutation_with_authority(
            "kickMember",
            HandlerInput {
                args: json!({ "id": MEMBER_A }),
                ..HandlerInput::default()
            },
            mutation_authority_b,
        )
        .expect("durable successor proves the lost COMMIT acknowledgement succeeded");
    assert_eq!(kick.changed_count, 1);

    let pending = fixture
        .snapback
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .ephemeral
        .pending_room_reauthorizations();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].room.scope, room_scope());
    assert_eq!(pending[0].obligation.min_commit_version, kick.version);
    let denied = fixture
        .snapback
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .authorize_ephemeral_room_observed("gamePresence", &room_scope(), base_room_auth(USER_A))
        .expect_err("the reconciled commit durably removed A's membership");
    assert_eq!(denied.diagnostic.code, "SNAPBACK_AUTH_PERMISSION_DENIED");
}

#[test]
fn commit_error_with_durable_rollback_removes_only_its_exact_room_ticket() {
    let fixture = KickFixture::new();
    inject_authorization_commit_fault_for_test(AuthorizationCommitFaultForTest::AfterRollback);

    let mutation_authority_b = fixture.mutation_authority_b.clone();
    let error = fixture
        .snapback
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .invoke_mutation_with_authority(
            "kickMember",
            HandlerInput {
                args: json!({ "id": MEMBER_A }),
                ..HandlerInput::default()
            },
            mutation_authority_b,
        )
        .expect_err("the injected COMMIT error has durably rolled back");
    assert_eq!(error.diagnostic.code, "TEST_AUTHORIZATION_COMMIT_FAILURE");
    assert!(
        fixture
            .snapback
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .ephemeral
            .pending_room_reauthorizations()
            .is_empty(),
        "confirmed rollback compare-removes the exact prepared ticket"
    );
    fixture
        .snapback
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .authorize_ephemeral_room_observed("gamePresence", &room_scope(), base_room_auth(USER_A))
        .expect("rollback preserves A's durable room permission");
    publish_presence_locked(
        &fixture.snapback,
        &fixture.ephemeral,
        CONNECTION_A,
        USER_A,
        b"A:rollback-kept-authority",
        31,
    )
    .expect("the exact room reopens after confirmed rollback");
}

fn codegen_membership_schema() -> SchemaManifest {
    let mut schema: SchemaManifest = serde_json::from_str(CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_JSON)
        .expect("slice-1 codegen membership manifest parses");
    schema.tables.push(TableManifest {
        name: "versionedMemberships".to_owned(),
        fields: vec![FieldManifest {
            name: "subject".to_owned(),
            field_type: FieldType::String,
            optional: false,
        }],
        indexes: Vec::new(),
        syncable: true,
        permission_backing: true,
        permission_fields: Some(vec!["subject".to_owned()]),
        search_indexes: Vec::new(),
        vector_indexes: Vec::new(),
        search_live_limits: None,
        membership: None,
        authority_profile: None,
        asset_sharing: None,
        visibility: None,
        history: None,
    });
    schema
}

fn codegen_membership_scope() -> crate::ephemeral::Scope {
    crate::ephemeral::Scope::from_pairs([("conversationId", BOARD_ID)])
}

fn codegen_membership_auth(user_id: Option<&str>) -> AuthContext {
    AuthContext {
        principal: user_id.map(str::to_owned),
        session_id: None,
        user_id: user_id.map(str::to_owned),
        permissions: BTreeSet::new(),
        stream_initiator: None,
    }
}

fn codegen_membership_snapback_from_schema(
    schema: SchemaManifest,
) -> (LocalSnapback, EngineInvalidationBinding) {
    let schema_hash = schema.schema_hash.clone().expect("generated schema hash");
    let inputs_hash = schema.inputs_hash.clone().expect("generated inputs hash");
    let deployment = DeploymentIdentity {
        schema_version: schema.schema_version.clone(),
        auth_mode: schema.effective_auth_mode(),
        app_id: schema.app_id.clone(),
        schema_hash,
        bundle_hash: format!("{FUNCTION_V1_PREFIX}{}", "d".repeat(64)),
        inputs_hash,
    };
    let mut snapback = LocalSnapback::memory().expect("codegen membership memory snapback");
    snapback
        .auth_database_mut()
        .stage_auth_mode(
            deployment,
            schema.clone(),
            Some(SeedData {
                tables: BTreeMap::from([(
                    "conversations".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), json!(BOARD_ID)),
                        ("title".to_owned(), json!("Codegen conformance")),
                    ])],
                )]),
            }),
        )
        .expect("stage the codegen-emitted sessions schema");
    let settled = snapback
        .auth_database_mut()
        .consume_sessions_auth_mode(&AuthProgramReadiness::new(
            true, true, true, true, true, true, false,
        ))
        .expect("consume the codegen-emitted sessions schema");
    snapback
        .synchronize_auth_mode_admission(&settled)
        .expect("bind codegen fixture sessions admission");
    snapback
        .seed(SeedData {
            tables: BTreeMap::from([(
                "conversationMembers".to_owned(),
                vec![
                    Map::from_iter([
                        ("_id".to_owned(), json!(MEMBER_A)),
                        ("userId".to_owned(), json!(USER_A)),
                        ("conversationId".to_owned(), json!(BOARD_ID)),
                        ("role".to_owned(), json!("member")),
                    ]),
                    Map::from_iter([
                        ("_id".to_owned(), json!(MEMBER_B)),
                        ("userId".to_owned(), json!(USER_B)),
                        ("conversationId".to_owned(), json!(BOARD_ID)),
                        ("role".to_owned(), json!("owner")),
                    ]),
                    Map::from_iter([
                        ("_id".to_owned(), json!("member-c")),
                        ("userId".to_owned(), json!(USER_C)),
                        ("conversationId".to_owned(), json!(BOARD_ID)),
                        ("role".to_owned(), json!("invited")),
                    ]),
                ],
            )]),
        })
        .expect("seed current membership rows after their resource exists");
    snapback
        .ephemeral
        .replace_collections(schema.ephemeral_collections)
        .expect("publish the codegen-emitted membership-backed collection");
    let (_, binding) = install_invalidation_with_binding(&mut snapback);
    (snapback, binding)
}

fn codegen_membership_snapback_with_binding() -> (LocalSnapback, EngineInvalidationBinding) {
    codegen_membership_snapback_from_schema(codegen_membership_schema())
}

fn codegen_membership_snapback() -> LocalSnapback {
    codegen_membership_snapback_with_binding().0
}

#[test]
fn authorization_affecting_seed_projects_issuer_before_kernel_finalizer() {
    let (mut snapback, binding) = codegen_membership_snapback_with_binding();
    let before = snapback
        .authorization_reservation_snapshot()
        .expect("capture predecessor authorization frontier");

    let output = snapback
        .seed(SeedData {
            tables: BTreeMap::from([(
                "conversationMembers".to_owned(),
                vec![Map::from_iter([
                    ("_id".to_owned(), json!("member-d")),
                    ("userId".to_owned(), json!(USER_D)),
                    ("conversationId".to_owned(), json!(BOARD_ID)),
                    ("role".to_owned(), json!("member")),
                ])],
            )]),
        })
        .expect("authorization-affecting seed commits and settles");

    let after = snapback
        .authorization_reservation_snapshot()
        .expect("capture settled authorization frontier");
    assert_eq!(output.changed_count, 1);
    assert_eq!(after.0, before.0 + 1, "seed advances the data frontier");
    assert_eq!(after.1.incarnation, before.1.incarnation);
    assert_eq!(after.1.epoch, before.1.epoch + 1);
    assert_eq!(
        binding
            .authorization_expectation()
            .expect("bound issuer reads its projected authorization successor"),
        after.1,
        "the bound issuer projection reaches the committed successor"
    );
}

#[test]
fn authorization_affecting_versioned_seed_projects_issuer_before_kernel_finalizer() {
    use crate::seed_identity::{
        InstallSeedRequestV1, SEED_ARTIFACT_FORMAT_V1, SEED_INSTALL_REQUEST_FORMAT_V1,
        SeedArtifactV1, SeedEnsureResultV1, artifact_digest,
    };

    let (mut snapback, binding) = codegen_membership_snapback_with_binding();
    let before = snapback
        .authorization_reservation_snapshot()
        .expect("capture predecessor authorization frontier");
    let mut artifact = SeedArtifactV1 {
        format_version: SEED_ARTIFACT_FORMAT_V1.to_owned(),
        app_id: codegen_membership_schema().app_id,
        seed_version: "authorization-witness-v1".to_owned(),
        seed_digest: String::new(),
        tables: BTreeMap::from([(
            "versionedMemberships".to_owned(),
            vec![Map::from_iter([
                ("_id".to_owned(), json!("versioned-member-c")),
                ("subject".to_owned(), json!(USER_C)),
            ])],
        )]),
    };
    artifact.seed_digest = artifact_digest(&artifact).expect("canonical seed artifact digest");

    let outcome = snapback
        .ensure_versioned_seed(InstallSeedRequestV1 {
            format_version: SEED_INSTALL_REQUEST_FORMAT_V1.to_owned(),
            operation_id: "01982c7a-7c00-7000-8000-00000000face".to_owned(),
            artifact,
            requested_mode: AuthMode::Sessions,
            asset_fixtures: None,
        })
        .expect("authorization-affecting versioned seed commits and settles");
    assert!(matches!(outcome, SeedEnsureResultV1::Installed { .. }));

    let after = snapback
        .authorization_reservation_snapshot()
        .expect("capture settled authorization frontier");
    assert_eq!(after.0, before.0 + 1);
    assert_eq!(after.1.incarnation, before.1.incarnation);
    assert_eq!(after.1.epoch, before.1.epoch + 1);
    assert_eq!(
        binding
            .authorization_expectation()
            .expect("bound issuer reads the versioned seed successor"),
        after.1,
        "the versioned ensure adapter cannot discard the authorization witness"
    );
}

fn assert_postcommit_seed_finalization_failure_is_caller_visible(
    inject: impl FnOnce(&crate::local::EphemeralApi),
    row_id: &str,
    expected_cause: &str,
) {
    let (mut snapback, _binding) = codegen_membership_snapback_with_binding();
    let ephemeral = snapback.ephemeral_api();
    inject(&ephemeral);

    let error = snapback
        .seed(SeedData {
            tables: BTreeMap::from([(
                "conversationMembers".to_owned(),
                vec![Map::from_iter([
                    ("_id".to_owned(), json!(row_id)),
                    ("userId".to_owned(), json!(USER_D)),
                    ("conversationId".to_owned(), json!(BOARD_ID)),
                    ("role".to_owned(), json!("member")),
                ])],
            )]),
        })
        .expect_err("the durable commit must not be reported as finalized");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
    );
    assert!(
        error.diagnostic.message.contains(expected_cause),
        "the initiating refusal retains the exact finalization cause: {}",
        error.diagnostic.message
    );

    let refusal = snapback
        .authorization_commit_reservation_required()
        .expect_err("the same failure leaves subsequent authorization writes closed");
    assert_eq!(
        refusal.diagnostic.code,
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
    );
}

#[test]
fn outcome_observation_failure_fails_closed_for_the_initiating_seed() {
    assert_postcommit_seed_finalization_failure_is_caller_visible(
        |ephemeral| ephemeral.inject_authorization_outcome_observation_failure(),
        "member-outcome-observation-failure",
        "injected committed authorization outcome observation failure",
    );
}

#[test]
fn issuer_projection_failure_fails_closed_for_the_initiating_seed() {
    assert_postcommit_seed_finalization_failure_is_caller_visible(
        |ephemeral| ephemeral.inject_authorization_issuer_projection_failure(),
        "member-issuer-projection-failure",
        "injected authorization issuer projection failure",
    );
}

#[test]
fn initiating_mutation_refuses_finalization_without_relabeling_the_durable_commit() {
    let fixture = KickFixture::new();
    fixture
        .ephemeral
        .inject_authorization_issuer_projection_failure();

    let mutation_authority_b = fixture.mutation_authority_b.clone();
    let (result, receipt) = fixture
        .snapback
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .invoke_mutation_recording_with_authority_descriptor(
            "kickMember",
            HandlerInput {
                args: json!({ "id": MEMBER_A }),
                ..HandlerInput::default()
            },
            None,
            None,
            "test",
            mutation_authority_b,
        );
    let error = result.expect_err("the initiating mutation must not report finalized success");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
    );
    match receipt {
        crate::live_wire::Receipt::Mutation {
            outcome,
            snapshot_version,
            rollback_reason,
            ..
        } => {
            assert_eq!(
                outcome,
                crate::live_wire::MutationReceiptOutcome::Confirmed,
                "the caller refusal must not relabel a durable commit as rolled back"
            );
            assert!(snapshot_version.is_some());
            assert_eq!(rollback_reason, None);
        }
        _ => panic!("expected mutation receipt"),
    }
}

#[test]
fn authorization_affecting_seed_refuses_after_installed_issuer_is_cleared() {
    let (mut snapback, binding) = codegen_membership_snapback_with_binding();
    let before = snapback
        .authorization_reservation_snapshot()
        .expect("capture authorization frontier before issuer clear");

    snapback
        .clear_installed_auth_invalidation(&binding)
        .expect("clear the exact installed invalidation issuer");
    let error = snapback
        .seed(SeedData {
            tables: BTreeMap::from([(
                "conversationMembers".to_owned(),
                vec![Map::from_iter([
                    ("_id".to_owned(), json!("member-after-clear")),
                    ("userId".to_owned(), json!(USER_D)),
                    ("conversationId".to_owned(), json!(BOARD_ID)),
                    ("role".to_owned(), json!("member")),
                ])],
            )]),
        })
        .expect_err("authorization-affecting seed must refuse before commit");

    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
    );
    assert_eq!(
        snapback
            .authorization_reservation_snapshot()
            .expect("refused seed preserves both durable frontiers"),
        before,
        "typed refusal occurs before SQLite commits"
    );
}

#[test]
fn postcommit_projection_after_issuer_clear_does_not_reopen_or_panic() {
    let (mut snapback, binding) = codegen_membership_snapback_with_binding();
    let reservation = snapback
        .ephemeral
        .reserve_authorization_commit(
            AuthorizationCommitPreflight::AllProtectedRooms,
            Arc::new(crate::storage::AuthorizationReservationCancellation::new()),
        )
        .expect("reserve the authorization-affecting seed");

    let mut local_scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
    let reservation_scope = reservation.install();
    snapback
        .seed(SeedData {
            tables: BTreeMap::from([(
                "conversationMembers".to_owned(),
                vec![Map::from_iter([
                    ("_id".to_owned(), json!("member-projection-failure")),
                    ("userId".to_owned(), json!(USER_D)),
                    ("conversationId".to_owned(), json!(BOARD_ID)),
                    ("role".to_owned(), json!("member")),
                ])],
            )]),
        })
        .expect("seed reaches a known durable commit");
    assert!(reservation_scope.take_unused().is_none());
    let batch = local_scope.take_after_local_batch();
    drop(local_scope);

    snapback
        .clear_installed_auth_invalidation(&binding)
        .expect("suspend the issuer before its queued projection runs");
    let finalization_error = crate::exec_guard::run_after_local_batch(batch)
        .expect_err("suspended issuer makes the initiating finalization fail closed");
    assert_eq!(
        finalization_error.diagnostic.code,
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
    );

    let error = snapback
        .authorization_commit_reservation_required()
        .expect_err("the queued predecessor projection must not undo issuer-clear suspension");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
    );
}

// @ref LLP 0303#move-semantics-protect-the-handle-not-the-fact — clearing all
// process-local projections does not turn the same database-open lifetime into
// a successor boot producer.
#[test]
fn suspended_local_projection_refuses_a_second_boot_producer_before_reopening() {
    let (mut snapback, predecessor) = codegen_membership_snapback_with_binding();
    snapback
        .clear_installed_auth_invalidation(&predecessor)
        .expect("suspend and clear the predecessor issuer");
    drop(predecessor);

    let replay = match snapback
        .install_authenticated_auth_invalidation(&invalidation_provider_for_test(), None)
    {
        Ok(_) => panic!("one database-open lifetime minted a successor boot issuer"),
        Err(error) => error,
    };
    assert_eq!(
        replay.diagnostic.code,
        "SNAPBACK_AUTH_INVALIDATION_BOOT_ALREADY_ACTIVE"
    );
    let still_unavailable = snapback
        .authorization_commit_reservation_required()
        .expect_err("the refused replay cannot rebuild the suspended projection");
    assert_eq!(
        still_unavailable.diagnostic.code,
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
    );
}

fn game_schema() -> SchemaManifest {
    SchemaManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        app_id: APP_ID.to_owned(),
        auth: Some(AuthManifest {
            mode: AuthMode::Sessions,
            agents: None,
            password_identifier_mode: None,
            password_minimum_length: None,
        }),
        required_capabilities: vec![TargetCapabilityId::AuthSessionsV1.to_string()],
        schema_hash: Some(game_schema_hash()),
        inputs_hash: Some(game_inputs_hash()),
        tables: vec![
            TableManifest {
                name: "gameMembers".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "gameId".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "userId".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: vec![IndexManifest {
                    name: "by_game_user".to_owned(),
                    fields: vec!["gameId".to_owned(), "userId".to_owned()],
                    unique: false,
                    where_applicable: false,
                }],
                syncable: true,
                permission_backing: true,
                permission_fields: Some(vec!["gameId".to_owned(), "userId".to_owned()]),
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            },
            TableManifest {
                name: "moves".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "gameId".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "playerId".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "move".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: vec![IndexManifest {
                    name: "by_game".to_owned(),
                    fields: vec!["gameId".to_owned()],
                    unique: false,
                    where_applicable: false,
                }],
                syncable: true,
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
            },
        ],
        ephemeral_collections: vec![
            EphemeralCollection::local_cursor("gamePresence", "gameId")
                .require_room_permission("game")
                .permission_backed_by(RoomPermissionProjection {
                    table: "gameMembers".to_owned(),
                    subject_field: "userId".to_owned(),
                    scope_fields: BTreeMap::from([("gameId".to_owned(), "gameId".to_owned())]),
                    role_field: None,
                    allowed_roles: None,
                }),
        ],
        ..SchemaManifest::default()
    }
}

fn game_functions() -> FunctionManifest {
    let mut current_membership = FunctionDefinition::new(
        "currentMembership",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table_visibility: None,
            table: "gameMembers".to_owned(),
            filters: vec![
                FilterExpr {
                    field: "gameId".to_owned(),
                    op: FilterOp::Eq,
                    value: ValueExpr::Arg("gameId".to_owned()),
                },
                FilterExpr {
                    field: "userId".to_owned(),
                    op: FilterOp::Eq,
                    value: ValueExpr::AuthUserId,
                },
            ],
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: Some("by_game_user".to_owned()),
        })),
    );
    current_membership.auth_requirement = Some(AuthRequirement::Authenticated);
    current_membership.read_set_summary.primary_table = Some("gameMembers".to_owned());
    current_membership.read_set_summary.tables = vec!["gameMembers".to_owned()];
    current_membership.read_set_summary.mode = Some("singleTable".to_owned());
    current_membership.read_set_summary.auth_scope_field = Some("userId".to_owned());

    let mut board = FunctionDefinition::new(
        "board",
        FunctionKind::LiveQuery,
        FunctionRuntime::IbexModule(IbexModule {
            source: GAME_HANDLER_SOURCE.to_owned(),
            export: "board".to_owned(),
        }),
    );
    board.auth_requirement = Some(AuthRequirement::Authenticated);
    board.required_capabilities = vec![
        TargetCapabilityId::LiveSubscriptions.to_string(),
        TargetCapabilityId::IbexCtxDbHostBridge.to_string(),
    ];
    board.read_set_summary.primary_table = Some("moves".to_owned());
    board.read_set_summary.tables = vec!["gameMembers".to_owned(), "moves".to_owned()];
    board.read_set_summary.mode = Some("handlerDeclared".to_owned());

    let mut kick_member = FunctionDefinition::new(
        "kickMember",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(crate::manifest::MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Delete {
                table: "gameMembers".to_owned(),
                id: ValueExpr::Arg("id".to_owned()),
            }],
            return_value: Some(ReturnValue::ChangedCount),
        })),
    );
    kick_member.auth_requirement = Some(AuthRequirement::Authenticated);
    kick_member.write_set_summary.primary_table = Some("gameMembers".to_owned());
    kick_member.write_set_summary.tables = vec!["gameMembers".to_owned()];

    FunctionManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        app_id: APP_ID.to_owned(),
        bundle_hash: Some(game_function_hash()),
        inputs_hash: Some(game_inputs_hash()),
        functions: vec![current_membership, board, kick_member],
        ..FunctionManifest::default()
    }
}

fn game_deployment() -> DeploymentIdentity {
    DeploymentIdentity {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        auth_mode: AuthMode::Sessions,
        app_id: APP_ID.to_owned(),
        schema_hash: game_schema_hash(),
        bundle_hash: game_function_hash(),
        inputs_hash: game_inputs_hash(),
    }
}

fn game_schema_hash() -> String {
    format!("{SCHEMA_V1_PREFIX}{}", "a".repeat(64))
}

fn game_function_hash() -> String {
    format!("{FUNCTION_V1_PREFIX}{}", "b".repeat(64))
}

fn game_inputs_hash() -> String {
    format!("{INPUTS_V1_PREFIX}{}", "c".repeat(64))
}

fn game_members() -> SeedData {
    SeedData {
        tables: BTreeMap::from([
            (
                "gameMembers".to_owned(),
                vec![
                    Map::from_iter([
                        ("_id".to_owned(), json!(MEMBER_A)),
                        ("gameId".to_owned(), json!(BOARD_ID)),
                        ("userId".to_owned(), json!(USER_A)),
                    ]),
                    Map::from_iter([
                        ("_id".to_owned(), json!(MEMBER_B)),
                        ("gameId".to_owned(), json!(BOARD_ID)),
                        ("userId".to_owned(), json!(USER_B)),
                    ]),
                    Map::from_iter([
                        ("_id".to_owned(), json!(MEMBER_B_UNRELATED)),
                        ("gameId".to_owned(), json!(UNRELATED_BOARD_ID)),
                        ("userId".to_owned(), json!(USER_B)),
                    ]),
                ],
            ),
            (
                "moves".to_owned(),
                vec![Map::from_iter([
                    ("_id".to_owned(), json!("move-opponent-private")),
                    ("gameId".to_owned(), json!(BOARD_ID)),
                    ("playerId".to_owned(), json!(USER_B)),
                    ("move".to_owned(), json!(OPPONENT_MOVE)),
                ])],
            ),
        ]),
    }
}

const GAME_HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async board(ctx, args) {
    const membership = await ctx.db
      .query('gameMembers')
      .withIndex('by_game_user')
      .eq('gameId', args.gameId)
      .eq('userId', ctx.auth.userId)
      .first();
    if (!membership) return [];
    return await ctx.db
      .query('moves')
      .withIndex('by_game')
      .eq('gameId', args.gameId)
      .collect();
  }
};
"#;

fn install_invalidation(snapback: &mut LocalSnapback) -> [AuthorizationInvalidationConnection; 2] {
    install_invalidation_with_binding(snapback).0
}

fn install_invalidation_with_binding(
    snapback: &mut LocalSnapback,
) -> (
    [AuthorizationInvalidationConnection; 2],
    EngineInvalidationBinding,
) {
    let binding = snapback
        .install_authenticated_auth_invalidation(&invalidation_provider_for_test(), None)
        .expect("install acceptance invalidation");
    let authorization = binding
        .authorization_expectation()
        .expect("acceptance authorization expectation");
    let connection_a = binding
        .prepare_connection(crate::ephemeral::ConnectionEffectFence::anonymous(
            authorization.incarnation.clone(),
            "eng-24604-grant-a",
        ))
        .expect("A connection reservation");
    let connection_b = binding
        .prepare_connection(crate::ephemeral::ConnectionEffectFence::anonymous(
            authorization.incarnation,
            "eng-24604-grant-b",
        ))
        .expect("B connection reservation");
    ([connection_a, connection_b], binding)
}

fn durable_subscribe(
    connection_id: &str,
    client_store_id: &str,
    query_instance_id: u64,
) -> LiveSubscribeInput {
    LiveSubscribeInput {
        connection_id: connection_id.to_owned(),
        input: HandlerInput {
            args: json!({ "gameId": BOARD_ID }),
            ..HandlerInput::default()
        },
        authorization_namespace: Some(QueryNamespace {
            client_store_id: client_store_id.to_owned(),
            query_key: format!("currentMembership:{{gameId:{BOARD_ID}}}"),
            query_instance_id,
        }),
        supersedes: None,
        resume_from_token: None,
    }
}

fn board_subscribe(
    connection_id: &str,
    client_store_id: &str,
    query_instance_id: u64,
) -> LiveSubscribeInput {
    LiveSubscribeInput {
        connection_id: connection_id.to_owned(),
        input: HandlerInput {
            args: json!({ "gameId": BOARD_ID }),
            ..HandlerInput::default()
        },
        authorization_namespace: Some(QueryNamespace {
            client_store_id: client_store_id.to_owned(),
            query_key: format!("board:{{gameId:{BOARD_ID}}}"),
            query_instance_id,
        }),
        supersedes: None,
        resume_from_token: None,
    }
}

fn room_scope() -> crate::ephemeral::Scope {
    room_scope_for(BOARD_ID)
}

fn room_scope_for(game_id: &str) -> crate::ephemeral::Scope {
    crate::ephemeral::Scope::from_pairs([("gameId", game_id)])
}

fn base_room_auth(user_id: &str) -> AuthContext {
    AuthContext {
        principal: None,
        session_id: Some(
            if user_id == USER_A {
                SESSION_A
            } else {
                SESSION_B
            }
            .to_owned(),
        ),
        user_id: Some(user_id.to_owned()),
        permissions: BTreeSet::new(),
        stream_initiator: None,
    }
}

fn server_room_grant(
    snapback: &LocalSnapback,
    ephemeral: &EphemeralApi,
    user_id: &str,
) -> (AuthContext, RoomAuthorityPermit) {
    let (auth, observed) = snapback
        .authorize_ephemeral_room_observed("gamePresence", &room_scope(), base_room_auth(user_id))
        .expect("durable membership grants the protected room");
    let permit = ephemeral
        .begin_server_authorized_room_act("gamePresence", &room_scope())
        .expect("room authority is available")
        .expect("protected room returns a permit");
    assert_eq!(
        ephemeral.authorization_expectation_for_test(),
        Some(observed),
        "durable lookup and room permit bind one authorization expectation"
    );
    (auth, permit)
}

fn register_room(
    snapback: &LocalSnapback,
    ephemeral: &EphemeralApi,
    connection_id: &str,
    user_id: &str,
    now_ms: u64,
) -> AuthContext {
    let (auth, permit) = server_room_grant(snapback, ephemeral, user_id);
    let snapshot = ephemeral
        .subscribe(room_subscribe(connection_id, auth.clone()), now_ms)
        .expect("protected room registration and snapshot");
    assert!(matches!(
        snapshot,
        EphemeralMessage::Snapshot {
            room_authority_generation: 1,
            ..
        }
    ));
    drop(permit);
    auth
}

fn publish_presence(
    snapback: &LocalSnapback,
    ephemeral: &EphemeralApi,
    connection_id: &str,
    user_id: &str,
    value: &[u8],
    now_ms: u64,
) -> Result<PublishOutcome, crate::ephemeral::EphemeralError> {
    let (auth, permit) = server_room_grant(snapback, ephemeral, user_id);
    let result = ephemeral.publish(room_publish(connection_id, user_id, auth, value), now_ms);
    drop(permit);
    result
}

fn publish_presence_locked(
    snapback: &Arc<Mutex<LocalSnapback>>,
    ephemeral: &EphemeralApi,
    connection_id: &str,
    user_id: &str,
    value: &[u8],
    now_ms: u64,
) -> Result<PublishOutcome, crate::ephemeral::EphemeralError> {
    let snapback = snapback.lock().unwrap_or_else(PoisonError::into_inner);
    publish_presence(&snapback, ephemeral, connection_id, user_id, value, now_ms)
}

fn room_subscribe(connection_id: &str, auth: AuthContext) -> SubscribeRequest {
    room_subscribe_for(connection_id, auth, BOARD_ID)
}

fn room_subscribe_for(connection_id: &str, auth: AuthContext, game_id: &str) -> SubscribeRequest {
    SubscribeRequest {
        collection: "gamePresence".to_owned(),
        scope: room_scope_for(game_id),
        connection_id: connection_id.to_owned(),
        auth,
        since_chunk: None,
    }
}

fn room_publish(
    connection_id: &str,
    user_id: &str,
    auth: AuthContext,
    value: &[u8],
) -> PublishRequest {
    room_publish_for(connection_id, user_id, auth, value, BOARD_ID)
}

fn room_publish_for(
    connection_id: &str,
    user_id: &str,
    auth: AuthContext,
    value: &[u8],
    game_id: &str,
) -> PublishRequest {
    PublishRequest {
        collection: "gamePresence".to_owned(),
        scope: room_scope_for(game_id),
        connection_id: connection_id.to_owned(),
        session_id: Some(
            if user_id == USER_A {
                SESSION_A
            } else {
                SESSION_B
            }
            .to_owned(),
        ),
        user_id: Some(user_id.to_owned()),
        custom_key: None,
        value: value.to_vec(),
        ttl_ms: None,
        auth,
    }
}

fn assert_durable_kick_snapshot(
    frames: &[RealtimeEnvelope],
    function: &str,
    version: u64,
    row_count: usize,
) -> Value {
    let frame = frames
        .iter()
        .filter_map(|frame| match frame {
            RealtimeEnvelope::Durable(message) => {
                serde_json::from_slice::<Value>(&message.payload).ok()
            }
            RealtimeEnvelope::Ephemeral(_) => None,
        })
        .find(|frame| {
            frame["kind"] == "authorization_invalidation"
                && frame["snapshot"]["function"] == function
        })
        .unwrap_or_else(|| panic!("durable authorization invalidation snapshot for {function}"));
    assert_eq!(
        frame["obligation"]["witness"]["data"]["minCommitVersion"],
        version
    );
    assert_eq!(frame["snapshot"]["version"], version);
    assert_eq!(
        frame["snapshot"]["rows"]
            .as_array()
            .expect("snapshot rows")
            .len(),
        row_count
    );
    frame
}

fn assert_auth_changed(frames: &[RealtimeEnvelope], generation: u64) {
    assert!(frames.iter().any(|frame| matches!(
        frame,
        RealtimeEnvelope::Ephemeral(EphemeralMessage::ResyncRequired {
            room_authority_generation,
            reason: ResyncReason::AuthChanged,
            ..
        }) if *room_authority_generation == generation
    )));
}
