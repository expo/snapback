use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, mpsc};
use std::time::Duration;

use serde_json::{Map, json};
use snapback_kernel::diagnostic::SnapbackResult;
use snapback_kernel::exec_guard::{LocalSnapbackWriteScope, run_after_local_batch};
use snapback_kernel::manifest::{
    FieldManifest, FieldType, SchemaManifest, SeedData, TableManifest,
};
use snapback_kernel::storage::{
    AuthorizationCommitPreflight, AuthorizationExpectationView,
    AuthorizationReservationCancellation, InvalidationBootIssuerReservation, LocalDatabase,
    ServingDatabase,
};
use snapback_sync::auth::crypto::OsRandom;
use snapback_sync::auth::invalidation::{InstalledInvalidationIssuer, ObligationRegistry};
use snapback_sync::auth::keyring::AuthKeyringStore;
use snapback_sync::auth::provider::AuthProvider;
use snapback_sync::ephemeral::{
    AuthContext, EphemeralCollection, EphemeralErrorCode, EphemeralMessage, EphemeralStoreLimits,
    LocalEphemeralBackend, PublishRequest, RemoveReason, RoomPermissionProjection, Scope,
    SubscribeRequest,
};

const BOARD_1: &str = "board-1";
const USER_A: &str = "user-a";
const USER_B: &str = "user-b";

fn schema() -> SchemaManifest {
    SchemaManifest {
        tables: vec![TableManifest {
            name: "memberships".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "boardId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "userId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
            ],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: true,
            permission_fields: Some(vec!["boardId".to_owned(), "userId".to_owned()]),
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
    }
}

fn collection() -> EphemeralCollection {
    EphemeralCollection::local_cursor("boardCursors", "boardId")
        .require_room_permission("board")
        .permission_backed_by(RoomPermissionProjection {
            table: "memberships".to_owned(),
            subject_field: "userId".to_owned(),
            scope_fields: BTreeMap::from([("boardId".to_owned(), "boardId".to_owned())]),
            role_field: None,
            allowed_roles: None,
        })
}

fn scope() -> Scope {
    Scope::from_pairs([("boardId", BOARD_1)])
}

fn membership(id: &str, board_id: &str, user_id: &str) -> Map<String, serde_json::Value> {
    Map::from_iter([
        ("_id".to_owned(), json!(id)),
        ("boardId".to_owned(), json!(board_id)),
        ("userId".to_owned(), json!(user_id)),
    ])
}

fn seed(rows: Vec<Map<String, serde_json::Value>>) -> SeedData {
    SeedData {
        tables: BTreeMap::from([("memberships".to_owned(), rows)]),
    }
}

fn auth(user_id: &str) -> AuthContext {
    AuthContext {
        user_id: Some(user_id.to_owned()),
        permissions: BTreeSet::new(),
        ..AuthContext::default()
    }
    .with_room_permission("board", &scope())
}

fn subscribe(connection_id: &str, user_id: &str) -> SubscribeRequest {
    SubscribeRequest {
        collection: "boardCursors".to_owned(),
        scope: scope(),
        connection_id: connection_id.to_owned(),
        auth: auth(user_id),
        since_chunk: None,
    }
}

fn publish(connection_id: &str, user_id: &str, value: &[u8]) -> PublishRequest {
    PublishRequest {
        collection: "boardCursors".to_owned(),
        scope: scope(),
        connection_id: connection_id.to_owned(),
        session_id: None,
        user_id: Some(user_id.to_owned()),
        custom_key: None,
        value: value.to_vec(),
        ttl_ms: None,
        auth: auth(user_id),
    }
}

fn authorization_issuer(
    reservation: InvalidationBootIssuerReservation,
    view: AuthorizationExpectationView,
) -> InstalledInvalidationIssuer {
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    keyring.load_or_mint_initial(0, &OsRandom).unwrap();
    let provider = AuthProvider::new(
        snapback_kernel::contract_types::AuthProviderProfile::Test,
        keyring,
    )
    .unwrap();
    let issuer = provider
        .authenticate_invalidation_boot_issuer(reservation, view, "test-target", "test-app")
        .unwrap();
    ObligationRegistry::new(issuer)
        .unwrap()
        .installed_issuer()
        .clone()
}

fn write_membership(
    backend: &LocalEphemeralBackend,
    issuer: &InstalledInvalidationIssuer,
    database: &mut ServingDatabase,
    row: Map<String, serde_json::Value>,
) -> SnapbackResult<()> {
    let reservation = backend.reserve_authorization_commit(
        AuthorizationCommitPreflight::AllProtectedRooms,
        Arc::new(AuthorizationReservationCancellation::new()),
    )?;
    let reservation_scope = reservation.install();
    let mut local_scope = LocalSnapbackWriteScope::enter();
    let write = database.schema_seed().seed(seed(vec![row]));
    let unused = reservation_scope.take_unused();
    let after_local = local_scope.take_after_local_batch();
    drop(local_scope);
    if let Some(unused) = unused {
        unused.cancel();
    }
    let write = write?;
    if write.authorization.event {
        let outcome =
            backend.committed_authorization_outcome(&write.authorization, write.output.version)?;
        issuer.project_authorization_expectation(&outcome)?;
    }
    run_after_local_batch(after_local).map_err(Into::into)
}

fn all_denied_fixture() -> (
    ServingDatabase,
    LocalEphemeralBackend,
    InstalledInvalidationIssuer,
) {
    let local = LocalDatabase::memory().expect("in-memory database");
    let mut database = ServingDatabase::adopt(local).expect("serving database");
    database
        .schema_seed()
        .apply_schema(schema())
        .expect("install permission-backing schema before participant activation");

    let boot = database
        .reserve_invalidation_boot_issuer()
        .expect("durable authorization snapshot");
    let backend =
        LocalEphemeralBackend::for_serving_database(EphemeralStoreLimits::default(), &mut database)
            .expect("database-bound room authority");
    let view = backend
        .authorization_expectation_view_for_install(&mut database)
        .expect("kernel authorization expectation view");
    let issuer = authorization_issuer(boot, view);
    backend.install_authorization_issuer(issuer.clone());
    backend
        .activate_authorization_commit_interlock(&mut database)
        .expect("ready authorization participant");
    backend
        .replace_collections(vec![collection()])
        .expect("install protected room collection");

    backend.subscribe(subscribe("a", USER_A), 1).unwrap();
    backend
        .publish(publish("a", USER_A, b"owned-a"), 2)
        .unwrap();
    backend.drain_outbox("a");
    assert_eq!(backend.diagnostics().subscriber_count, 1);
    assert_eq!(backend.diagnostics().entry_count, 1);
    assert_eq!(backend.connection_room_count_for_test("a"), 1);

    (database, backend, issuer)
}

#[test]
fn all_denied_pruning_reports_completed_settlement() {
    let (mut database, backend, issuer) = all_denied_fixture();
    write_membership(
        &backend,
        &issuer,
        &mut database,
        membership("member-c", BOARD_1, "user-c"),
    )
    .expect("an authorization-changing writer creates the denial obligation");
    let pending = backend.pending_room_reauthorizations();
    assert_eq!(pending.len(), 1);
    let batch = backend
        .resolve_pending_room_reauthorization(&database, pending.into_iter().next().unwrap())
        .expect("durable resolution denies the room's only subject");
    let completion_database = database
        .take_room_reauthorization_database()
        .expect("take exact off-Local completion database");

    assert!(
        backend
            .complete_room_reauthorization_off_local(&completion_database, batch)
            .expect("real all-denied settlement remains operational"),
        "completed settlement must remain observable after pruning"
    );
    assert_eq!(backend.diagnostics().subscriber_count, 0);
    assert_eq!(backend.diagnostics().entry_count, 0);
    assert_eq!(backend.diagnostics().room_count, 0);
    assert_eq!(backend.connection_room_count_for_test("a"), 0);
}

#[test]
fn dropped_reached_receiver_cannot_abort_real_settlement() {
    let (mut database, backend, issuer) = all_denied_fixture();
    write_membership(
        &backend,
        &issuer,
        &mut database,
        membership("member-c", BOARD_1, "user-c"),
    )
    .expect("an authorization-changing writer creates the denial obligation");
    let pending = backend.pending_room_reauthorizations();
    assert_eq!(pending.len(), 1);
    let batch = backend
        .resolve_pending_room_reauthorization(&database, pending.into_iter().next().unwrap())
        .expect("durable resolution denies the room's only subject");
    let completion_database = database
        .take_room_reauthorization_database()
        .expect("take exact off-Local completion database");

    let (reached_tx, reached_rx) = mpsc::channel();
    drop(reached_rx);
    let (release_tx, release_rx) = mpsc::channel();
    release_tx
        .send(())
        .expect("pre-release the disconnected reached observer");
    backend.install_room_reauthorization_before_mutation_hook_for_test(reached_tx, release_rx);

    assert!(
        backend
            .complete_room_reauthorization_off_local(&completion_database, batch)
            .expect("a disconnected reached observer cannot abort real settlement"),
        "real settlement remains complete after reached notification disconnects"
    );
    assert_eq!(backend.diagnostics().subscriber_count, 0);
    assert_eq!(backend.diagnostics().entry_count, 0);
    assert_eq!(backend.diagnostics().room_count, 0);
}

#[test]
fn all_denied_pruning_serializes_a_concurrent_fresh_grant() {
    let (mut database, backend, issuer) = all_denied_fixture();
    write_membership(
        &backend,
        &issuer,
        &mut database,
        membership("member-c", BOARD_1, "user-c"),
    )
    .expect("an authorization-changing writer creates the denial obligation");
    let pending = backend.pending_room_reauthorizations();
    assert_eq!(pending.len(), 1);
    let batch = backend
        .resolve_pending_room_reauthorization(&database, pending.into_iter().next().unwrap())
        .expect("durable resolution denies the room's only subject");
    let completion_database = database
        .take_room_reauthorization_database()
        .expect("take exact off-Local completion database");

    let (before_tx, before_rx) = mpsc::channel();
    let (before_release_tx, before_release_rx) = mpsc::sync_channel(0);
    backend
        .install_room_reauthorization_before_mutation_hook_for_test(before_tx, before_release_rx);
    let (after_tx, after_rx) = mpsc::channel();
    let (after_release_tx, after_release_rx) = mpsc::sync_channel(0);
    backend.install_room_reauthorization_after_mutation_hook_for_test(after_tx, after_release_rx);
    let (writer_waiting_tx, writer_waiting_rx) = mpsc::channel();
    backend.install_authorization_writer_settlement_wait_witness_for_test(writer_waiting_tx);

    let completion_backend = backend.clone();
    let (completion_done_tx, completion_done_rx) = mpsc::channel();
    let completion = std::thread::spawn(move || {
        completion_done_tx
            .send(
                completion_backend
                    .complete_room_reauthorization_off_local(&completion_database, batch),
            )
            .unwrap();
    });
    before_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("real sync settlement reaches its last side-effect-free point");

    let writer_backend = backend.clone();
    let writer_issuer = issuer.clone();
    let (writer_done_tx, writer_done_rx) = mpsc::channel();
    let writer = std::thread::spawn(move || {
        let result = write_membership(
            &writer_backend,
            &writer_issuer,
            &mut database,
            membership("member-a", BOARD_1, USER_A),
        )
        .map_err(|error| error.to_string());
        writer_done_tx.send(result).unwrap();
    });
    writer_waiting_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("the fresh grant writer waits for terminal settlement");
    assert!(writer_done_rx.try_recv().is_err());

    before_release_tx.send(()).unwrap();
    after_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("all-denied settlement removes indexes and prunes the room");
    assert_eq!(backend.diagnostics().subscriber_count, 0);
    assert_eq!(backend.diagnostics().entry_count, 0);
    assert_eq!(backend.diagnostics().room_count, 0);
    assert_eq!(backend.connection_room_count_for_test("a"), 0);
    assert!(writer_done_rx.try_recv().is_err());

    after_release_tx.send(()).unwrap();
    assert!(
        completion_done_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("real completion returns")
            .expect("real completion remains operational")
    );
    writer_done_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("serialized fresh grant writer returns")
        .expect("serialized fresh grant writer commits");
    completion.join().unwrap();
    writer.join().unwrap();
    assert_eq!(backend.pending_room_reauthorizations().len(), 0);
    assert_eq!(backend.diagnostics().room_count, 0);
}

#[test]
fn withheld_test_hook_cannot_keep_settlement_nonterminal() {
    let local = LocalDatabase::memory().expect("in-memory database");
    let mut database = ServingDatabase::adopt(local).expect("serving database");
    database
        .schema_seed()
        .apply_schema(schema())
        .expect("install permission-backing schema before participant activation");
    database
        .schema_seed()
        .seed(seed(vec![membership("member-b", BOARD_1, USER_B)]))
        .expect("install B's initial durable grant");

    let boot = database
        .reserve_invalidation_boot_issuer()
        .expect("durable authorization snapshot");
    let backend =
        LocalEphemeralBackend::for_serving_database(EphemeralStoreLimits::default(), &mut database)
            .expect("database-bound room authority");
    let view = backend
        .authorization_expectation_view_for_install(&mut database)
        .expect("kernel authorization expectation view");
    let issuer = authorization_issuer(boot, view);
    backend.install_authorization_issuer(issuer.clone());
    backend
        .activate_authorization_commit_interlock(&mut database)
        .expect("ready authorization participant");
    backend
        .replace_collections(vec![collection()])
        .expect("install protected room collection");

    backend.subscribe(subscribe("a", USER_A), 1).unwrap();
    backend.subscribe(subscribe("b", USER_B), 2).unwrap();
    backend
        .publish(publish("a", USER_A, b"owned-a"), 3)
        .unwrap();
    backend
        .publish(publish("b", USER_B, b"owned-b"), 4)
        .unwrap();
    backend.drain_outbox("a");
    backend.drain_outbox("b");

    write_membership(
        &backend,
        &issuer,
        &mut database,
        membership("member-c", BOARD_1, "user-c"),
    )
    .expect("an authorization-changing writer creates the denial obligation");
    let pending = backend.pending_room_reauthorizations();
    assert_eq!(pending.len(), 1);
    let batch = backend
        .resolve_pending_room_reauthorization(&database, pending.into_iter().next().unwrap())
        .expect("durable resolution denies A and retains B");
    let completion_database = database
        .take_room_reauthorization_database()
        .expect("take exact off-Local completion database");

    let (after_tx, after_rx) = mpsc::channel();
    let (withheld_release, after_release_rx) = mpsc::sync_channel(0);
    backend.install_room_reauthorization_after_mutation_hook_for_test(after_tx, after_release_rx);
    let (writer_waiting_tx, writer_waiting_rx) = mpsc::channel();
    backend.install_authorization_writer_settlement_wait_witness_for_test(writer_waiting_tx);

    let completion_backend = backend.clone();
    let (completion_done_tx, completion_done_rx) = mpsc::channel();
    let completion = std::thread::spawn(move || {
        completion_done_tx
            .send(
                completion_backend
                    .complete_room_reauthorization_off_local(&completion_database, batch),
            )
            .unwrap();
    });
    after_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("real settlement performs its mutations before the withheld hook");

    let writer_backend = backend.clone();
    let writer_issuer = issuer.clone();
    let (writer_done_tx, writer_done_rx) = mpsc::channel();
    let writer = std::thread::spawn(move || {
        let result = write_membership(
            &writer_backend,
            &writer_issuer,
            &mut database,
            membership("member-a", BOARD_1, USER_A),
        )
        .map_err(|error| error.to_string());
        writer_done_tx.send(result).unwrap();
    });
    writer_waiting_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("the fresh grant writer waits for terminal settlement");

    assert!(
        completion_done_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("the feature hook's bounded pause expires")
            .expect("real completion remains operational")
    );
    writer_done_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("writer resumes after bounded settlement")
        .expect("writer commits after bounded settlement");
    assert!(
        withheld_release.send(()).is_err(),
        "a release after expiry loses ownership of the terminal transition"
    );
    completion.join().unwrap();
    writer.join().unwrap();
}

#[test]
fn exact_fence_serializes_a_real_grant_writer_before_sync_settlement_mutates() {
    let local = LocalDatabase::memory().expect("in-memory database");
    let mut database = ServingDatabase::adopt(local).expect("serving database");
    database
        .schema_seed()
        .apply_schema(schema())
        .expect("install permission-backing schema before participant activation");
    database
        .schema_seed()
        .seed(seed(vec![membership("member-b", BOARD_1, USER_B)]))
        .expect("install B's initial durable grant");

    let boot = database
        .reserve_invalidation_boot_issuer()
        .expect("durable authorization snapshot");
    let backend =
        LocalEphemeralBackend::for_serving_database(EphemeralStoreLimits::default(), &mut database)
            .expect("database-bound room authority");
    let view = backend
        .authorization_expectation_view_for_install(&mut database)
        .expect("kernel authorization expectation view");
    let issuer = authorization_issuer(boot, view);
    backend.install_authorization_issuer(issuer.clone());
    backend
        .activate_authorization_commit_interlock(&mut database)
        .expect("ready authorization participant");
    backend
        .replace_collections(vec![collection()])
        .expect("install protected room collection");

    backend.subscribe(subscribe("a", USER_A), 1).unwrap();
    backend.subscribe(subscribe("b", USER_B), 2).unwrap();
    backend
        .publish(publish("a", USER_A, b"owned-a"), 3)
        .unwrap();
    backend
        .publish(publish("b", USER_B, b"owned-b"), 4)
        .unwrap();
    backend.drain_outbox("a");
    backend.drain_outbox("b");
    assert_eq!(backend.diagnostics().subscriber_count, 2);
    assert_eq!(backend.diagnostics().entry_count, 2);

    write_membership(
        &backend,
        &issuer,
        &mut database,
        membership("member-c", BOARD_1, "user-c"),
    )
    .expect("an authorization-changing writer creates the denial obligation");
    let pending = backend.pending_room_reauthorizations();
    assert_eq!(pending.len(), 1);
    let batch = backend
        .resolve_pending_room_reauthorization(&database, pending.into_iter().next().unwrap())
        .expect("durable resolution denies A and retains B");
    let completion_database = database
        .take_room_reauthorization_database()
        .expect("take exact off-Local completion database");

    let (before_tx, before_rx) = mpsc::channel();
    let (before_release_tx, before_release_rx) = mpsc::sync_channel(0);
    backend
        .install_room_reauthorization_before_mutation_hook_for_test(before_tx, before_release_rx);
    let (after_tx, after_rx) = mpsc::channel();
    let (after_release_tx, after_release_rx) = mpsc::sync_channel(0);
    backend.install_room_reauthorization_after_mutation_hook_for_test(after_tx, after_release_rx);
    let (writer_waiting_tx, writer_waiting_rx) = mpsc::channel();
    backend.install_authorization_writer_settlement_wait_witness_for_test(writer_waiting_tx);

    let completion_backend = backend.clone();
    let (completion_done_tx, completion_done_rx) = mpsc::channel();
    let completion = std::thread::spawn(move || {
        completion_done_tx
            .send(
                completion_backend
                    .complete_room_reauthorization_off_local(&completion_database, batch),
            )
            .unwrap();
    });
    before_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("real sync settlement reaches its last side-effect-free point");

    let writer_backend = backend.clone();
    let writer_issuer = issuer.clone();
    let (writer_done_tx, writer_done_rx) = mpsc::channel();
    let writer = std::thread::spawn(move || {
        let result = write_membership(
            &writer_backend,
            &writer_issuer,
            &mut database,
            membership("member-a", BOARD_1, USER_A),
        )
        .map_err(|error| error.to_string());
        writer_done_tx.send(result).unwrap();
    });
    writer_waiting_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("the real grant writer reaches the settlement serialization point");
    assert!(writer_done_rx.try_recv().is_err());

    before_release_tx.send(()).unwrap();
    after_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("real settlement performs all sync mutations");
    assert!(writer_done_rx.try_recv().is_err());
    assert_eq!(backend.diagnostics().subscriber_count, 1);
    assert_eq!(backend.diagnostics().entry_count, 1);

    let denied = backend.queued_resync_messages_for_test("a");
    assert!(denied.iter().any(|frame| matches!(
        frame,
        EphemeralMessage::Error { error, .. }
            if error.code == EphemeralErrorCode::PermissionDenied
    )));
    let survivor = backend.queued_resync_messages_for_test("b");
    assert!(survivor.iter().any(|frame| matches!(
        frame,
        EphemeralMessage::Remove {
            reason: RemoveReason::AuthRevoked,
            ..
        }
    )));
    assert!(survivor.iter().any(|frame| matches!(
        frame,
        EphemeralMessage::Snapshot { entries, .. }
            if entries.len() == 1 && entries[0].value == b"owned-b"
    )));

    after_release_tx.send(()).unwrap();
    assert!(
        completion_done_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("real completion returns")
            .expect("real completion remains operational")
    );
    writer_done_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("serialized grant writer returns")
        .expect("serialized grant writer commits");
    completion.join().unwrap();
    writer.join().unwrap();

    assert_eq!(backend.pending_room_reauthorizations().len(), 1);
    let pending = match backend.begin_server_authorized_room_act("boardCursors", &scope()) {
        Err(error) => error,
        Ok(_) => panic!("the grant writer must leave its fresh obligation pending"),
    };
    assert_eq!(pending.code, EphemeralErrorCode::AuthorityPending);
}
