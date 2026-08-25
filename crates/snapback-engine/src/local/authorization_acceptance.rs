//! Accepted LLP 0053 authorization-shape and measurement acceptance.
//!
//! This is a child of `local` so the corpus can use the same session-mode
//! invalidation admission, level-triggered projection, and exact ACK seams as
//! the server without making test-only protocol constructors public.

use super::{
    AuthorizationInvalidationAckInput, LiveInvalidationAdmission, LiveSubscribeInput,
    LocalSnapback, live_stream_text,
};
use crate::auth::admission::AdmissionLease;
use crate::auth::invalidation::{
    AuthorizationInvalidationConnection, LiveInvalidationIssuer, QueryNamespace,
};
use crate::auth::invocation::{InvocationSource, PreparedAuthority, ResolvedAppAuthority};
use crate::diagnostic::SnapbackError;
use crate::manifest::{
    AuthMode, ElevatedReadCapabilityV1, ElevatedReadFormV1, ElevatedReadTableCeilingV1,
    FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime,
    HandlerInput, HandlerPlan, IbexModule, MutationPlan, MutationStep,
    OwnerWriteAbsentDispositionV1, OwnerWriteCheckV1, ReturnValue, SchemaManifest, TableManifest,
    TableVisibilityV1, ValueExpr,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const SHAPE_HANDLERS: &str = r#"
globalThis.__snapbackHandlers = {
  async mineOrPublic(ctx) {
    const rows = await ctx.db.elevated.query('docs').collect();
    return rows.filter((row) => row.ownerId === ctx.auth.userId || row.isPublic === true);
  },

  async orgDocuments(ctx) {
    const docs = await ctx.db.elevated.query('docs').collect();
    const folders = await ctx.db.elevated.query('folders').collect();
    const memberships = await ctx.db.query('orgMembers').collect();
    const allowed = new Set(
      memberships
        .filter((membership) => membership.userId === ctx.auth.userId)
        .map((membership) => membership.orgId),
    );
    const folderOrg = new Map(folders.map((folder) => [folder._id, folder.orgId]));
    return docs.filter((doc) => allowed.has(folderOrg.get(doc.folderId)));
  },

  async gameRoster(ctx, args) {
    const members = await ctx.db.query('gameMembers').eq('gameId', args.gameId).collect();
    if (!members.some((member) => member.userId === ctx.auth.userId)) return [];
    return members;
  },

  async allNotes(ctx) {
    return await ctx.db.query('notes').collect();
  },
};
"#;

const CLIENT_REPLAY_APP_ID: &str = "llp-0053-composed-acceptance";
const CLIENT_REPLAY_TARGET_PROFILE_ID: &str = "local-dev-sqlite-ibex";
const CLIENT_REPLAY_SCHEMA_HASH: &str = "llp-0053-authorization-shapes-v1";
const CLIENT_REPLAY_BUNDLE_HASH: &str = "llp-0053-authorization-shapes-v1";
const CLIENT_REPLAY_INPUTS_HASH: &str = "llp-0053-authorization-inputs-v1";
const CLIENT_REPLAY_DATABASE_ID: &str = "llp-0053-composed-acceptance-db";
const CLIENT_REPLAY_ACTIVATION_HASH: &str = "snapback.authorized-lease.activation.v1:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PROPERTY_PRINCIPAL: &str = "018f0d90-7b14-7a22-8c33-445566778899";

#[derive(Clone, Debug)]
struct TrackedQuery {
    user: String,
    function: String,
    args: Value,
    connection_id: String,
    subscription_id: String,
    query_instance_id: u64,
    rows: Vec<Value>,
    version: u64,
    admission: AdmissionLease,
    authority_instance_id: String,
}

#[derive(Default)]
struct DeliveryObservation {
    generated_invalidation_frames: u64,
    generated_snapshot_frames: u64,
    delivered_invalidation_frames: u64,
    delivered_snapshot_frames: u64,
    discarded_invalidation_frames: u64,
    discarded_snapshot_frames: u64,
    reprojected_invalidation_frames: u64,
    reprojected_snapshot_frames: u64,
    discarded_response_drains: u64,
    max_generated_snapshot_frames_per_query_settlement: u64,
    max_delivered_snapshot_frames_per_query_settlement: u64,
    max_explicit_reprojection_calls_per_query_settlement: u64,
    acknowledgements: u64,
    delivered_dispositions: BTreeMap<String, u64>,
    observed_receipts: Vec<Value>,
}

impl DeliveryObservation {
    fn merge(&mut self, other: Self) {
        self.generated_invalidation_frames += other.generated_invalidation_frames;
        self.generated_snapshot_frames += other.generated_snapshot_frames;
        self.delivered_invalidation_frames += other.delivered_invalidation_frames;
        self.delivered_snapshot_frames += other.delivered_snapshot_frames;
        self.discarded_invalidation_frames += other.discarded_invalidation_frames;
        self.discarded_snapshot_frames += other.discarded_snapshot_frames;
        self.reprojected_invalidation_frames += other.reprojected_invalidation_frames;
        self.reprojected_snapshot_frames += other.reprojected_snapshot_frames;
        self.discarded_response_drains += other.discarded_response_drains;
        self.max_generated_snapshot_frames_per_query_settlement = self
            .max_generated_snapshot_frames_per_query_settlement
            .max(other.max_generated_snapshot_frames_per_query_settlement);
        self.max_delivered_snapshot_frames_per_query_settlement = self
            .max_delivered_snapshot_frames_per_query_settlement
            .max(other.max_delivered_snapshot_frames_per_query_settlement);
        self.max_explicit_reprojection_calls_per_query_settlement = self
            .max_explicit_reprojection_calls_per_query_settlement
            .max(other.max_explicit_reprojection_calls_per_query_settlement);
        self.acknowledgements += other.acknowledgements;
        for (disposition, count) in other.delivered_dispositions {
            *self.delivered_dispositions.entry(disposition).or_default() += count;
        }
        self.observed_receipts.extend(other.observed_receipts);
    }

    fn record_generated(&mut self, frames: &[Value], reprojected: bool) {
        let invalidations = frames.len() as u64;
        let snapshots = frames
            .iter()
            .filter(|frame| frame.get("snapshot").is_some_and(|value| !value.is_null()))
            .count() as u64;
        self.generated_invalidation_frames += invalidations;
        self.generated_snapshot_frames += snapshots;
        if reprojected {
            self.reprojected_invalidation_frames += invalidations;
            self.reprojected_snapshot_frames += snapshots;
        }
    }

    fn record_discarded(&mut self, frames: &[Value]) {
        if frames.is_empty() {
            return;
        }
        self.discarded_response_drains += 1;
        self.discarded_invalidation_frames += frames.len() as u64;
        self.discarded_snapshot_frames += frames
            .iter()
            .filter(|frame| frame.get("snapshot").is_some_and(|value| !value.is_null()))
            .count() as u64;
    }
}

#[derive(Clone, Copy)]
enum DeliveryMode {
    DeliverDrain,
    DropDrainAndReproject,
    ReprojectAfterPriorDrop,
}

fn field(name: &str, field_type: FieldType) -> FieldManifest {
    FieldManifest {
        name: name.to_owned(),
        field_type,
        optional: false,
    }
}

fn table(
    name: &str,
    mut fields: Vec<FieldManifest>,
    permission_backing: bool,
    permission_fields: Option<Vec<&str>>,
) -> TableManifest {
    // @ref LLP 0264#d3-owner-inserts-are-host-stamped — principal-bearing
    // ordinary acceptance rows use a dedicated host-stamped write owner so
    // the tested ownerId/folder transitions remain application data.
    let write_owned = matches!(name, "docs" | "folders");
    if write_owned {
        fields.push(field("rowOwner", FieldType::Principal));
    }
    TableManifest {
        name: name.to_owned(),
        fields,
        indexes: Vec::new(),
        syncable: true,
        permission_backing,
        permission_fields: permission_fields
            .map(|fields| fields.into_iter().map(str::to_owned).collect()),
        search_indexes: Vec::new(),
        vector_indexes: Vec::new(),
        search_live_limits: None,
        membership: None,
        authority_profile: None,
        asset_sharing: None,
        visibility: if write_owned {
            Some(TableVisibilityV1::Owner {
                field: "rowOwner".to_owned(),
            })
        } else if permission_backing {
            None
        } else {
            // `notes` is deliberately principal-free synthetic payload used
            // only as a disjoint public-read control.
            Some(TableVisibilityV1::PublicRead)
        },
        history: None,
    }
}

fn acceptance_schema() -> SchemaManifest {
    SchemaManifest {
        app_id: CLIENT_REPLAY_APP_ID.to_owned(),
        schema_hash: Some(CLIENT_REPLAY_SCHEMA_HASH.to_owned()),
        inputs_hash: Some(CLIENT_REPLAY_INPUTS_HASH.to_owned()),
        tables: vec![
            table(
                "docs",
                vec![
                    field("title", FieldType::String),
                    field("ownerId", FieldType::String),
                    field("isPublic", FieldType::Boolean),
                    field("folderId", FieldType::String),
                ],
                false,
                None,
            ),
            table(
                "folders",
                vec![field("orgId", FieldType::String)],
                false,
                None,
            ),
            table(
                "orgMembers",
                vec![
                    field("orgId", FieldType::String),
                    field("userId", FieldType::String),
                    field("role", FieldType::String),
                ],
                true,
                Some(vec!["role"]),
            ),
            table(
                "gameMembers",
                vec![
                    field("gameId", FieldType::String),
                    field("userId", FieldType::String),
                    field("role", FieldType::String),
                ],
                true,
                Some(vec!["role"]),
            ),
            table(
                "users",
                vec![
                    field("name", FieldType::String),
                    field("role", FieldType::String),
                    field("avatar", FieldType::String),
                ],
                true,
                Some(vec!["role"]),
            ),
            table("notes", vec![field("body", FieldType::String)], false, None),
        ],
        ..SchemaManifest::default()
    }
}

fn live_ibex(name: &str, tables: &[&str]) -> FunctionDefinition {
    let mut function = FunctionDefinition::new(
        name,
        FunctionKind::LiveQuery,
        FunctionRuntime::IbexModule(IbexModule {
            source: SHAPE_HANDLERS.to_owned(),
            export: name.to_owned(),
        }),
    );
    function.required_capabilities = vec![
        "live_subscriptions".to_owned(),
        "ibex_ctx_db_host_bridge".to_owned(),
    ];
    function.read_set_summary.primary_table = tables.first().map(|table| (*table).to_owned());
    function.read_set_summary.tables = tables.iter().map(|table| (*table).to_owned()).collect();
    function.read_set_summary.mode = Some("handlerDeclared".to_owned());
    let elevated_tables = match name {
        "mineOrPublic" => vec!["docs".to_owned()],
        "orgDocuments" => vec!["docs".to_owned(), "folders".to_owned()],
        _ => Vec::new(),
    };
    if !elevated_tables.is_empty() {
        function.elevated_db_capabilities = vec![ElevatedReadCapabilityV1 {
            form: ElevatedReadFormV1::Query,
            tables: ElevatedReadTableCeilingV1::Tables(elevated_tables),
        }];
    }
    function
}

fn insert_function(name: &str, table: &str, fields: &[&str]) -> FunctionDefinition {
    let mut values = fields
        .iter()
        .map(|field| ((*field).to_owned(), ValueExpr::Arg((*field).to_owned())))
        .collect::<BTreeMap<_, _>>();
    if matches!(table, "docs" | "folders") {
        values.insert("rowOwner".to_owned(), ValueExpr::AuthUserId);
    }
    FunctionDefinition::new(
        name,
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Insert {
                table: table.to_owned(),
                values,
                bind_id_as: Some("id".to_owned()),
            }],
            return_value: Some(ReturnValue::Binding("id".to_owned())),
        })),
    )
}

fn patch_function(name: &str, table: &str, field: &str) -> FunctionDefinition {
    FunctionDefinition::new(
        name,
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: (table == "docs")
                .then_some(OwnerWriteCheckV1 {
                    step_index: 0,
                    absent: OwnerWriteAbsentDispositionV1::NoEffect,
                })
                .into_iter()
                .collect(),
            steps: vec![MutationStep::Patch {
                table: table.to_owned(),
                id: ValueExpr::Arg("id".to_owned()),
                values: BTreeMap::from([(field.to_owned(), ValueExpr::Arg(field.to_owned()))]),
            }],
            return_value: Some(ReturnValue::ChangedCount),
        })),
    )
}

fn delete_function(name: &str, table: &str) -> FunctionDefinition {
    FunctionDefinition::new(
        name,
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: (table == "docs")
                .then_some(OwnerWriteCheckV1 {
                    step_index: 0,
                    absent: OwnerWriteAbsentDispositionV1::NoEffect,
                })
                .into_iter()
                .collect(),
            steps: vec![MutationStep::Delete {
                table: table.to_owned(),
                id: ValueExpr::Arg("id".to_owned()),
            }],
            return_value: Some(ReturnValue::ChangedCount),
        })),
    )
}

fn acceptance_functions() -> FunctionManifest {
    FunctionManifest {
        app_id: CLIENT_REPLAY_APP_ID.to_owned(),
        bundle_hash: Some(CLIENT_REPLAY_BUNDLE_HASH.to_owned()),
        inputs_hash: Some(CLIENT_REPLAY_INPUTS_HASH.to_owned()),
        functions: vec![
            live_ibex("mineOrPublic", &["docs"]),
            live_ibex("orgDocuments", &["docs", "folders", "orgMembers"]),
            live_ibex("gameRoster", &["gameMembers"]),
            live_ibex("allNotes", &["notes"]),
            insert_function(
                "createDoc",
                "docs",
                &["title", "ownerId", "isPublic", "folderId"],
            ),
            patch_function("setDocPublic", "docs", "isPublic"),
            patch_function("setDocFolder", "docs", "folderId"),
            patch_function("setDocOwner", "docs", "ownerId"),
            delete_function("deleteDoc", "docs"),
            insert_function("createFolder", "folders", &["orgId"]),
            insert_function(
                "createOrgMember",
                "orgMembers",
                &["orgId", "userId", "role"],
            ),
            insert_function(
                "createGameMember",
                "gameMembers",
                &["gameId", "userId", "role"],
            ),
            delete_function("deleteGameMember", "gameMembers"),
            insert_function("createUser", "users", &["name", "role", "avatar"]),
            patch_function("setUserAvatar", "users", "avatar"),
            patch_function("setUserRole", "users", "role"),
            delete_function("deleteUser", "users"),
            insert_function("createNote", "notes", &["body"]),
        ],
        ..FunctionManifest::default()
    }
}

fn configured_memory() -> LocalSnapback {
    configure(LocalSnapback::memory().expect("memory Snapback"))
}

fn configured_file(path: &Path) -> LocalSnapback {
    configure(LocalSnapback::open(path).expect("file-backed Snapback"))
}

fn configure(mut snapback: LocalSnapback) -> LocalSnapback {
    let schema = acceptance_schema();
    assert_eq!(schema.app_id, CLIENT_REPLAY_APP_ID);
    assert_eq!(
        schema.target_profile.as_deref(),
        Some(CLIENT_REPLAY_TARGET_PROFILE_ID)
    );
    assert_eq!(
        schema.schema_hash.as_deref(),
        Some(CLIENT_REPLAY_SCHEMA_HASH)
    );
    assert_eq!(
        schema.inputs_hash.as_deref(),
        Some(CLIENT_REPLAY_INPUTS_HASH)
    );
    snapback
        .apply_schema(schema)
        .expect("apply acceptance schema");
    snapback
        .auth_database_mut()
        .activate_current_auth_catalog()
        .expect("install acceptance auth catalog");
    for (index, user) in [
        "usr_00000000000000000000000000",
        "usr_00000000000000000000000001",
        "usr_00000000000000000000000002",
    ]
    .into_iter()
    .enumerate()
    {
        let (session_id, authority_instance_id) = session_ids(user);
        snapback
            .auth_database_mut()
            .auth_catalog()
            .insert_email_session_for_test(
                user,
                &crate::ids::mint_time_ordered(crate::ids::Kind::Identity),
                session_id,
                authority_instance_id,
                &format!("{user}@acceptance.test"),
                &[index as u8 + 1; 32],
                1,
                1,
                4_000_000_000_000,
                4_000_000_000_000,
            )
            .expect("insert acceptance session");
    }
    let functions = acceptance_functions();
    assert_eq!(functions.app_id, CLIENT_REPLAY_APP_ID);
    assert_eq!(
        functions.bundle_hash.as_deref(),
        Some(CLIENT_REPLAY_BUNDLE_HASH)
    );
    assert_eq!(
        functions.inputs_hash.as_deref(),
        Some(CLIENT_REPLAY_INPUTS_HASH)
    );
    let installed_schema = snapback.db.schema().clone();
    snapback
        .auth_database_mut()
        .reconcile_auth_scope_bases_with_schema(&functions, &installed_schema)
        .expect("install acceptance function scope bases");
    let diagnostics = snapback.load_functions(functions);
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED"),
        "unexpected function diagnostics: {diagnostics:?}"
    );
    assert_eq!(snapback.loaded_app_id(), CLIENT_REPLAY_APP_ID);
    assert_eq!(
        snapback.loaded_schema_hash().as_deref(),
        Some(CLIENT_REPLAY_SCHEMA_HASH)
    );
    assert_eq!(
        snapback.loaded_bundle_hash().as_deref(),
        Some(CLIENT_REPLAY_BUNDLE_HASH)
    );
    snapback
}

fn install_invalidation(snapback: &mut LocalSnapback) -> AuthorizationInvalidationConnection {
    let (authorization, version_stream, boot_sequence) = snapback
        .auth_database_mut()
        .reserve_invalidation_boot_issuer()
        .expect("reserve acceptance issuer");
    let issuer_id = crate::auth::invalidation::IssuerId::fresh(
        authorization.incarnation.clone(),
        boot_sequence,
    )
    .expect("fresh acceptance issuer id");
    let authenticator =
        crate::auth::invalidation::IssuerAuthenticator::new("llp-0053-acceptance-key", [0x53; 32])
            .expect("acceptance authenticator");
    let authenticated = authenticator
        .authenticate(issuer_id, "local-test", "llp-0053-shapes")
        .expect("authenticate acceptance issuer");
    let issuer = LiveInvalidationIssuer::with_authenticator(
        authenticated,
        authenticator,
        "local-test",
        "llp-0053-shapes",
    )
    .expect("acceptance issuer");
    let binding = snapback
        .install_auth_invalidation(issuer, authorization.clone(), version_stream)
        .expect("install acceptance invalidation");
    binding
        .prepare_connection(crate::ephemeral::ConnectionEffectFence::anonymous(
            authorization.incarnation,
            "llp-0053-acceptance-grant",
        ))
        .expect("acceptance connection reservation")
}

fn session_ids(user: &str) -> (&'static str, &'static str) {
    match user {
        "usr_00000000000000000000000000" => (
            "018f0d90-7b31-7a22-8c33-445566778899",
            "018f0d90-7b32-7a22-8c33-445566778899",
        ),
        "usr_00000000000000000000000001" => (
            "018f0d90-7b33-7a22-8c33-445566778899",
            "018f0d90-7b34-7a22-8c33-445566778899",
        ),
        "usr_00000000000000000000000002" => (
            "018f0d90-7b35-7a22-8c33-445566778899",
            "018f0d90-7b36-7a22-8c33-445566778899",
        ),
        _ => (
            "018f0d90-7b37-7a22-8c33-445566778899",
            "018f0d90-7b38-7a22-8c33-445566778899",
        ),
    }
}

fn session_authority(
    snapback: &mut LocalSnapback,
    user: &str,
    source: InvocationSource,
) -> PreparedAuthority {
    let session_id = crate::ids::mint(crate::ids::Kind::Session)
        .expect("mint an independently resolved acceptance session");
    let authority_instance_id = crate::ids::mint(crate::ids::Kind::AuthorityInstance)
        .expect("mint an independently resolved acceptance authority instance");
    snapback.prepare_resolved_session_for_test(
        source,
        user,
        &session_id,
        &authority_instance_id,
        1,
        4_000_000_000_000,
    )
}

fn input(args: Value) -> HandlerInput {
    HandlerInput {
        args,
        ..HandlerInput::default()
    }
}

fn mutate(snapback: &mut LocalSnapback, user: &str, name: &str, args: Value) -> Value {
    let authority = session_authority(snapback, user, InvocationSource::HttpMutation);
    snapback
        .invoke_mutation_with_authority(name, input(args), authority)
        .unwrap_or_else(|error| panic!("{name} failed: {error:?}"))
        .result
}

fn subscribe(
    snapback: &mut LocalSnapback,
    connection: &AuthorizationInvalidationConnection,
    user: &str,
    function: &str,
    args: Value,
    instance: u64,
) -> TrackedQuery {
    let connection_id = format!("acceptance-{user}-{function}-{instance}");
    let authority = session_authority(snapback, user, InvocationSource::LiveInitialQuery);
    let admission = authority.admission_lease().clone();
    let authority_instance_id = match authority.resolved() {
        ResolvedAppAuthority::Session(subject) => subject.authority_instance_id().to_owned(),
        other => panic!("acceptance subscription requires session authority, got {other:?}"),
    };
    let output = snapback
        .subscribe_live_prepared_with_invalidation(
            function,
            LiveSubscribeInput {
                connection_id: connection_id.clone(),
                input: input(args.clone()),
                authorization_namespace: Some(QueryNamespace {
                    client_store_id: format!("store_{user}"),
                    query_key: format!(
                        "{function}:{}",
                        serde_json::to_string(&args).expect("query args JSON")
                    ),
                    query_instance_id: instance,
                }),
                supersedes: None,
                resume_from_token: None,
            },
            authority,
            LiveInvalidationAdmission::new(connection.clone()).with_session_mode(true),
        )
        .unwrap_or_else(|error| panic!("subscribe {function} for {user}: {error:?}"));
    assert!(output.authorization_scope.is_some());
    TrackedQuery {
        user: user.to_owned(),
        function: function.to_owned(),
        args,
        connection_id,
        subscription_id: output.subscription_id,
        query_instance_id: instance,
        rows: output.snapshot.clone().unwrap().rows,
        version: output.snapshot.as_ref().unwrap().version,
        admission,
        authority_instance_id,
    }
}

fn canonical_rows(rows: &[Value]) -> Vec<Value> {
    let mut rows = rows.to_vec();
    rows.sort_by(|left, right| {
        left.get("_id")
            .and_then(Value::as_str)
            .cmp(&right.get("_id").and_then(Value::as_str))
    });
    rows
}

fn converges_with_fresh_query(snapback: &mut LocalSnapback, query: &TrackedQuery) -> bool {
    let authority = session_authority(snapback, &query.user, InvocationSource::HttpQuery);
    let fresh = snapback
        .invoke_query_with_dependencies_prepared(
            &query.function,
            input(query.args.clone()),
            authority,
        )
        .unwrap_or_else(|error| {
            panic!(
                "fresh oracle {} for {} failed: {error:?}",
                query.function, query.user
            )
        });
    canonical_rows(&query.rows) == canonical_rows(&fresh.output.rows)
}

fn assert_converges(snapback: &mut LocalSnapback, query: &TrackedQuery) {
    assert!(
        converges_with_fresh_query(snapback, query),
        "matcher delivery for {} / {} diverged from a full re-query",
        query.function,
        query.user
    );
}

fn parse_invalidation_frames(frames: Vec<String>) -> Vec<Value> {
    frames
        .into_iter()
        .map(|frame| serde_json::from_str::<Value>(&frame).expect("live frame JSON"))
        .filter(|frame| frame["kind"] == "authorization_invalidation")
        .collect()
}

fn parse_direct_invalidation_frames(frames: Vec<crate::ephemeral::DurableMessage>) -> Vec<Value> {
    frames
        .into_iter()
        .map(|frame| serde_json::from_slice::<Value>(&frame.payload).expect("live frame JSON"))
        .filter(|frame| frame["kind"] == "authorization_invalidation")
        .collect()
}

// @ref LLP 0094#0c8-sessions-live-update-envelope-and-delivery-multiplicity —
// retained obligation projection is the only sessions auth-snapshot lane.
fn assert_no_physical_invalidation_snapshots(frames: &[Value]) {
    assert!(
        frames
            .iter()
            .all(|frame| frame.get("snapshot").is_none_or(Value::is_null)),
        "the physical outbox must not duplicate a projected authorization snapshot"
    );
}

fn drain_live_stream_through_test_sink(
    snapback: &mut LocalSnapback,
    connection_id: &str,
) -> Vec<String> {
    snapback
        .drain_outbox_for_send(connection_id)
        .into_iter()
        .filter_map(|admitted| {
            let (envelope, permit) = admitted.into_parts();
            let frame = live_stream_text(envelope);
            drop(permit);
            frame
        })
        .collect()
}

fn settle_query(
    snapback: &mut LocalSnapback,
    connection: &AuthorizationInvalidationConnection,
    query: &mut TrackedQuery,
    mode: DeliveryMode,
) -> DeliveryObservation {
    let admission = query.admission.clone();
    let predecessor_rows = query.rows.clone();
    let predecessor_version = query.version;
    let primary_projection = matches!(
        mode,
        DeliveryMode::DeliverDrain | DeliveryMode::DropDrainAndReproject
    )
    .then(|| {
        parse_direct_invalidation_frames(
            snapback
                .authorization_invalidation_frames(&query.connection_id, &admission)
                .expect("primary level-triggered invalidation projection"),
        )
    });
    let drained = parse_invalidation_frames(drain_live_stream_through_test_sink(
        snapback,
        &query.connection_id,
    ));
    assert_no_physical_invalidation_snapshots(&drained);
    let mut observation = DeliveryObservation::default();
    observation.record_generated(&drained, false);
    if let Some(primary_projection) = primary_projection.as_ref() {
        observation.record_generated(primary_projection, false);
    }

    let frames = match mode {
        DeliveryMode::DeliverDrain => {
            let mut delivered = drained;
            delivered.extend(primary_projection.expect("delivery projection was prepared"));
            delivered
        }
        DeliveryMode::DropDrainAndReproject | DeliveryMode::ReprojectAfterPriorDrop => {
            match mode {
                DeliveryMode::DropDrainAndReproject => {
                    let mut discarded = drained;
                    discarded.extend(primary_projection.expect("loss projection was prepared"));
                    assert!(
                        !discarded.is_empty(),
                        "a requested response-loss schedule must discard a generated frame"
                    );
                    observation.record_discarded(&discarded);
                }
                DeliveryMode::ReprojectAfterPriorDrop => assert!(
                    drained.is_empty(),
                    "prior-drop recovery must not silently discard a newly queued frame"
                ),
                DeliveryMode::DeliverDrain => unreachable!(),
            }
            let reprojected = parse_direct_invalidation_frames(
                snapback
                    .authorization_invalidation_frames(&query.connection_id, &admission)
                    .expect("level-triggered invalidation re-fire"),
            );
            assert!(
                !reprojected.is_empty(),
                "one explicit level-triggered projection call must recover the current obligation"
            );
            observation.record_generated(&reprojected, true);
            observation.max_explicit_reprojection_calls_per_query_settlement += 1;
            reprojected
        }
    };

    let mut acknowledged = BTreeSet::new();
    for frame in frames {
        observation.delivered_invalidation_frames += 1;
        let obligation = &frame["obligation"];
        let disposition = obligation["maxDisposition"]
            .as_str()
            .expect("invalidation disposition")
            .to_owned();
        *observation
            .delivered_dispositions
            .entry(disposition.clone())
            .or_default() += 1;
        if matches!(disposition.as_str(), "quarantine" | "delete") {
            // Mirror the shipped client's synchronous authorization boundary:
            // old rows become non-renderable before any async queue/store work.
            query.rows.clear();
        }
        if let Some(snapshot) = frame.get("snapshot").filter(|value| !value.is_null()) {
            assert_eq!(snapshot["subscriptionId"], query.subscription_id);
            query.rows = snapshot["rows"].as_array().expect("snapshot rows").clone();
            query.version = snapshot["version"].as_u64().expect("snapshot version");
            observation.delivered_snapshot_frames += 1;
        }
        let Some(resolution) = frame.get("resolution").filter(|value| !value.is_null()) else {
            continue;
        };
        let token = resolution["ackToken"]
            .as_str()
            .expect("resolution ACK token")
            .to_owned();
        if !acknowledged.insert(token.clone()) {
            continue;
        }
        let ack_input = AuthorizationInvalidationAckInput {
            connection_id: query.connection_id.clone(),
            ack_token: token,
        };
        let outcome = snapback
            .acknowledge_authorization_invalidation(
                ack_input.clone(),
                connection.clone(),
                &admission,
            )
            .expect("exact authorization ACK");
        assert!(matches!(
            outcome.outcome.as_str(),
            "discharged" | "duplicate"
        ));
        observation.acknowledgements += 1;
        let authorization_incarnation = obligation["witness"]["authorization"]["incarnation"]
            .as_str()
            .expect("authorization incarnation");
        let version_stream = obligation["witness"]["data"]["versionStream"]
            .as_str()
            .expect("version stream");
        observation.observed_receipts.push(json!({
            "scope": {
                "kind": obligation["scopeId"]["kind"],
                "queryKey": obligation["scopeId"]["namespace"]["queryKey"],
                "queryInstanceId": obligation["scopeId"]["namespace"]["queryInstanceId"],
            },
            "query": {
                "user": query.user,
                "function": query.function,
            },
            "revision": obligation["revision"],
            "compositeWitness": obligation["witness"],
            "disposition": disposition,
            "snapshot": frame.get("snapshot").filter(|value| !value.is_null()).map(|snapshot| json!({
                "commitVersion": snapshot["version"],
                "rowCount": snapshot["rows"].as_array().expect("snapshot rows").len(),
            })),
            "resolutionKind": resolution["kind"],
            "acknowledgementOutcome": outcome.outcome,
            "rawReplay": {
                "scopeId": obligation["scopeId"],
                "issuerId": obligation["scopeId"]["issuerId"],
                "principalScope": {
                    "authMode": "sessions",
                    "authorizationStreamIncarnation": authorization_incarnation,
                    "userId": query.user,
                },
                "authorityDescriptor": {
                    "descriptorVersion": 1,
                    "authorityInstanceId": query.authority_instance_id,
                    "sessionGeneration": 1,
                },
                "artifactScope": {
                    "appId": CLIENT_REPLAY_APP_ID,
                    "targetProfileId": CLIENT_REPLAY_TARGET_PROFILE_ID,
                    "schemaHash": CLIENT_REPLAY_SCHEMA_HASH,
                    "inputsHash": CLIENT_REPLAY_INPUTS_HASH,
                    "databaseId": CLIENT_REPLAY_DATABASE_ID,
                    "versionStreamId": version_stream,
                    "activationHash": CLIENT_REPLAY_ACTIVATION_HASH,
                },
                "initialSnapshot": {
                    "version": predecessor_version,
                    "rows": predecessor_rows.clone(),
                },
                "obligation": obligation,
                "snapshot": frame.get("snapshot").filter(|value| !value.is_null()),
                "resolution": resolution,
                "serverAcknowledgement": {
                    "input": ack_input,
                    "connection": connection,
                    "output": outcome,
                },
                "serverAcknowledgementOutcome": outcome.outcome,
            },
        }));
    }
    observation.max_generated_snapshot_frames_per_query_settlement =
        observation.generated_snapshot_frames;
    observation.max_delivered_snapshot_frames_per_query_settlement =
        observation.delivered_snapshot_frames;
    observation
}

fn normalize_membership_receipts(
    observation: &DeliveryObservation,
    event_index: u64,
    event_kind: &str,
) -> Vec<Value> {
    assert_eq!(
        observation.observed_receipts.len(),
        3,
        "each membership event must resolve every unrelated auth-scoped query"
    );
    observation
        .observed_receipts
        .iter()
        .enumerate()
        .map(|(query_index, receipt)| {
            let user = match receipt["query"]["user"].as_str() {
                Some("usr_00000000000000000000000000") => "alice",
                Some("usr_00000000000000000000000001") => "bob",
                Some("usr_00000000000000000000000002") => "carol",
                Some(user) => user,
                None => panic!("receipt query user"),
            };
            json!({
                "eventIndex": event_index,
                "eventKind": event_kind,
                "queryIndex": query_index,
                "query": {
                    "user": user,
                    "function": receipt["query"]["function"],
                },
                "scope": receipt["scope"],
                "revision": receipt["revision"],
                "compositeWitness": {
                    "authorization": {
                        "incarnation": "<authenticated-uuid-v7>",
                        "epoch": receipt["compositeWitness"]["authorization"]["epoch"],
                    },
                    "data": {
                        "versionStream": "<authenticated-version-stream>",
                        "minCommitVersion": receipt["compositeWitness"]["data"]["minCommitVersion"],
                    },
                },
                "disposition": receipt["disposition"],
                "dispositionReason": {
                    "value": "permission-backing-membership-write",
                    "source": "executed-mutation-kind",
                },
                "proofPath": [
                    "production-permission-backing-mutation",
                    "production-obligation-registry",
                    "production-live-projection",
                    "production-fresh-full-query",
                    "production-exact-ack",
                ],
                "snapshot": receipt["snapshot"],
                "resolutionKind": receipt["resolutionKind"],
                "acknowledgementOutcome": receipt["acknowledgementOutcome"],
                "fullRequeryAndAuthorizationMatched": true,
            })
        })
        .collect()
}

fn raw_membership_replay(
    observation: &DeliveryObservation,
    event_index: u64,
    event_kind: &str,
) -> Vec<Value> {
    assert_eq!(
        observation.observed_receipts.len(),
        3,
        "each membership event must expose three replayable production transitions"
    );
    observation
        .observed_receipts
        .iter()
        .enumerate()
        .map(|(query_index, receipt)| {
            json!({
                "eventIndex": event_index,
                "eventKind": event_kind,
                "queryIndex": query_index,
                "productionQuery": receipt["query"],
                "productionScope": receipt["scope"],
                "rawReplay": receipt["rawReplay"],
            })
        })
        .collect()
}

fn settle_all(
    snapback: &mut LocalSnapback,
    connection: &AuthorizationInvalidationConnection,
    queries: &mut [TrackedQuery],
    lose_connections: &BTreeSet<String>,
) -> DeliveryObservation {
    let mut observation = DeliveryObservation::default();
    for query in queries {
        observation.merge(settle_query(
            snapback,
            connection,
            query,
            if lose_connections.contains(&query.connection_id) {
                DeliveryMode::DropDrainAndReproject
            } else {
                DeliveryMode::DeliverDrain
            },
        ));
    }
    observation
}

fn single_delivered_disposition(observation: &DeliveryObservation, label: &str) -> String {
    assert_eq!(
        observation.delivered_dispositions.len(),
        1,
        "{label} must deliver exactly one disposition class: {:?}",
        observation.delivered_dispositions
    );
    observation
        .delivered_dispositions
        .keys()
        .next()
        .expect("one delivered disposition")
        .clone()
}

fn assert_delivery_accounting(observation: &DeliveryObservation, label: &str) {
    assert_eq!(
        observation.generated_invalidation_frames,
        observation.delivered_invalidation_frames + observation.discarded_invalidation_frames,
        "{label} invalidation generation must equal delivered plus discarded frames"
    );
    assert_eq!(
        observation.generated_snapshot_frames,
        observation.delivered_snapshot_frames + observation.discarded_snapshot_frames,
        "{label} snapshot generation must equal delivered plus discarded frames"
    );
}

fn id(value: Value) -> String {
    value.as_str().expect("mutation returned row id").to_owned()
}

fn ids(rows: &[Value]) -> BTreeSet<String> {
    rows.iter()
        .filter_map(|row| row.get("_id").and_then(Value::as_str).map(str::to_owned))
        .collect()
}

#[test]
// @ref LLP 0053#worked-classifications — exercise the three shapes that made
//   result dependence and authorization dependence orthogonal.
fn named_shapes_and_matcher_deliveries_converge_with_full_requery() {
    let mut snapback = configured_memory();

    let folder_a = id(mutate(
        &mut snapback,
        "usr_00000000000000000000000000",
        "createFolder",
        json!({ "orgId": "org-a" }),
    ));
    let folder_b = id(mutate(
        &mut snapback,
        "usr_00000000000000000000000001",
        "createFolder",
        json!({ "orgId": "org-b" }),
    ));
    mutate(
        &mut snapback,
        "usr_00000000000000000000000000",
        "createOrgMember",
        json!({ "orgId": "org-a", "userId": "usr_00000000000000000000000000", "role": "member" }),
    );
    mutate(
        &mut snapback,
        "usr_00000000000000000000000001",
        "createOrgMember",
        json!({ "orgId": "org-b", "userId": "usr_00000000000000000000000001", "role": "member" }),
    );
    let public_doc = id(mutate(
        &mut snapback,
        "usr_00000000000000000000000000",
        "createDoc",
        json!({
            "title": "public-to-private",
            "ownerId": "usr_00000000000000000000000000",
            "isPublic": true,
            "folderId": folder_a,
        }),
    ));
    let hierarchy_doc = id(mutate(
        &mut snapback,
        "usr_00000000000000000000000002",
        "createDoc",
        json!({
            "title": "hierarchy-reparent",
            "ownerId": "usr_00000000000000000000000002",
            "isPublic": false,
            "folderId": folder_a,
        }),
    ));
    let alice_game = id(mutate(
        &mut snapback,
        "usr_00000000000000000000000000",
        "createGameMember",
        json!({ "gameId": "game-1", "userId": "usr_00000000000000000000000000", "role": "player" }),
    ));
    let bob_game = id(mutate(
        &mut snapback,
        "usr_00000000000000000000000001",
        "createGameMember",
        json!({ "gameId": "game-1", "userId": "usr_00000000000000000000000001", "role": "player" }),
    ));
    assert_ne!(alice_game, bob_game);

    let connection = install_invalidation(&mut snapback);
    let mut queries = vec![
        subscribe(
            &mut snapback,
            &connection,
            "usr_00000000000000000000000001",
            "mineOrPublic",
            json!({}),
            1,
        ),
        subscribe(
            &mut snapback,
            &connection,
            "usr_00000000000000000000000000",
            "orgDocuments",
            json!({}),
            2,
        ),
        subscribe(
            &mut snapback,
            &connection,
            "usr_00000000000000000000000001",
            "orgDocuments",
            json!({}),
            3,
        ),
        subscribe(
            &mut snapback,
            &connection,
            "usr_00000000000000000000000000",
            "gameRoster",
            json!({ "gameId": "game-1" }),
            4,
        ),
        subscribe(
            &mut snapback,
            &connection,
            "usr_00000000000000000000000001",
            "gameRoster",
            json!({ "gameId": "game-1" }),
            5,
        ),
    ];
    for query in &queries {
        assert_converges(&mut snapback, query);
    }

    // Row-authorized sharing: this ordinary docs write advances no auth epoch,
    // yet the matcher re-query removes the row and the auth-scoped Ibex replace
    // is delivered through an exact obligation.
    let before = snapback
        .auth_invalidation_expectation_for_test()
        .expect("installed expectation");
    mutate(
        &mut snapback,
        "usr_00000000000000000000000000",
        "setDocPublic",
        json!({ "id": public_doc, "isPublic": false }),
    );
    let delivery = settle_all(&mut snapback, &connection, &mut queries, &BTreeSet::new());
    assert_eq!(
        snapback
            .auth_invalidation_expectation_for_test()
            .expect("expectation after ordinary write"),
        before,
        "public/private row visibility is a matcher event, not a coarse epoch"
    );
    assert_eq!(
        delivery.delivered_snapshot_frames, 3,
        "only docs readers are affected"
    );
    assert!(!ids(&queries[0].rows).contains(&public_doc));
    for query in &queries {
        assert_converges(&mut snapback, query);
    }

    // Hierarchical authority: the same ordinary row write makes one org lose
    // and the other gain visibility; both directions are proved.
    mutate(
        &mut snapback,
        "usr_00000000000000000000000002",
        "setDocFolder",
        json!({ "id": hierarchy_doc, "folderId": folder_b }),
    );
    settle_all(&mut snapback, &connection, &mut queries, &BTreeSet::new());
    assert!(!ids(&queries[1].rows).contains(&hierarchy_doc));
    assert!(ids(&queries[2].rows).contains(&hierarchy_doc));
    for query in &queries {
        assert_converges(&mut snapback, query);
    }
    mutate(
        &mut snapback,
        "usr_00000000000000000000000002",
        "setDocFolder",
        json!({ "id": hierarchy_doc, "folderId": folder_a }),
    );
    settle_all(&mut snapback, &connection, &mut queries, &BTreeSet::new());
    assert!(ids(&queries[1].rows).contains(&hierarchy_doc));
    assert!(!ids(&queries[2].rows).contains(&hierarchy_doc));
    for query in &queries {
        assert_converges(&mut snapback, query);
    }

    // One table is simultaneously the roster result and its ACL. The delete
    // advances the coarse epoch, removes Bob from Alice's result, and removes
    // Bob's authority to see the roster at all.
    let before = snapback
        .auth_invalidation_expectation_for_test()
        .expect("expectation before kick");
    mutate(
        &mut snapback,
        "usr_00000000000000000000000000",
        "deleteGameMember",
        json!({ "id": bob_game }),
    );
    settle_all(&mut snapback, &connection, &mut queries, &BTreeSet::new());
    let after = snapback
        .auth_invalidation_expectation_for_test()
        .expect("expectation after kick");
    assert_eq!(after.epoch, before.epoch + 1);
    assert_eq!(ids(&queries[3].rows), BTreeSet::from([alice_game]));
    assert!(queries[4].rows.is_empty());
    for query in &queries {
        assert_converges(&mut snapback, query);
    }
}

fn property_query_ids(snapback: &mut LocalSnapback) -> Vec<String> {
    let authority = session_authority(snapback, PROPERTY_PRINCIPAL, InvocationSource::HttpQuery);
    let output = snapback
        .invoke_query_with_dependencies_prepared("mineOrPublic", input(json!({})), authority)
        .expect("production property query");
    let mut ids = output
        .output
        .rows
        .iter()
        .map(|row| {
            row["title"]
                .as_str()
                .expect("property row title is the shared logical id")
                .to_owned()
        })
        .collect::<Vec<_>>();
    ids.sort();
    ids
}

#[test]
// @ref LLP 0053#acceptance — use one deterministic corpus to compare real
//   production Ibex results with the independent Contract-side oracle.
fn shared_property_corpus_emits_production_fresh_query_receipt() {
    let config: Value = serde_json::from_str(include_str!(
        "../../../../tests/acceptance/auth-invalidation-v1-property-corpus.json"
    ))
    .expect("shared property corpus config");
    assert_eq!(config["schemaVersion"], 1);
    let trials_per_event = config["trialsPerEvent"]
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .expect("bounded property trials");
    let rows_per_case = config["rowsPerCase"]
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .expect("bounded property rows");
    let event_universe = config["eventUniverse"]
        .as_array()
        .expect("property event universe")
        .iter()
        .map(|value| value.as_str().expect("event name").to_owned())
        .collect::<Vec<_>>();
    let input_cases = config["cases"].as_array().expect("shared property cases");
    assert_eq!(input_cases.len(), event_universe.len() * trials_per_event);
    assert_eq!(input_cases.len(), 36);
    let schedule = input_cases
        .iter()
        .map(|case| {
            case["scenario"]
                .as_str()
                .expect("property scenario")
                .to_owned()
        })
        .collect::<Vec<_>>();
    let mut event_counts = BTreeMap::new();
    for scenario in &schedule {
        assert!(event_universe.contains(scenario));
        *event_counts.entry(scenario.clone()).or_insert(0_usize) += 1;
    }
    for event in &event_universe {
        assert_eq!(event_counts.get(event), Some(&trials_per_event));
    }

    let mut cases = Vec::new();
    let mut production_fresh_query_comparisons = 0_u64;
    let mut production_mutations = 0_u64;
    for (case_index, case) in input_cases.iter().enumerate() {
        assert_eq!(case["caseIndex"], case_index);
        let scenario = case["scenario"].as_str().expect("property scenario");
        let source_rows = case["sourceRows"]
            .as_array()
            .expect("shared property source rows")
            .clone();
        assert_eq!(source_rows.len(), rows_per_case);
        let revision = case["revision"].as_u64().expect("property revision");
        let random_state = case["randomState"].as_str().expect("property random state");
        let write_kind = case["writeKind"].as_str();
        assert_eq!(write_kind.is_some(), scenario == "randomized-writes");

        let mut snapback = configured_memory();
        let mut database_ids = BTreeMap::new();
        for row in &source_rows {
            let logical_id = row["id"].as_str().expect("property logical id");
            let database_id = id(mutate(
                &mut snapback,
                PROPERTY_PRINCIPAL,
                "createDoc",
                json!({
                    "title": logical_id,
                    "ownerId": row["ownerId"],
                    "isPublic": row["isPublic"],
                    "folderId": "property-folder",
                }),
            ));
            database_ids.insert(logical_id.to_owned(), database_id);
        }
        let production_initial_authorized_row_ids = property_query_ids(&mut snapback);
        production_fresh_query_comparisons += 1;

        if let Some(write_kind) = write_kind {
            let target_index = if write_kind == "owner-revoke" { 0 } else { 1 };
            let logical_id = source_rows[target_index]["id"]
                .as_str()
                .expect("property target id");
            let database_id = database_ids
                .get(logical_id)
                .expect("property target database id");
            match write_kind {
                "public-grant" => {
                    mutate(
                        &mut snapback,
                        PROPERTY_PRINCIPAL,
                        "setDocPublic",
                        json!({ "id": database_id, "isPublic": true }),
                    );
                }
                "owner-grant" => {
                    mutate(
                        &mut snapback,
                        PROPERTY_PRINCIPAL,
                        "setDocOwner",
                        json!({ "id": database_id, "ownerId": PROPERTY_PRINCIPAL }),
                    );
                }
                "owner-revoke" => {
                    mutate(
                        &mut snapback,
                        PROPERTY_PRINCIPAL,
                        "setDocOwner",
                        json!({ "id": database_id, "ownerId": "another-principal" }),
                    );
                }
                _ => unreachable!("shared property corpus owns the write universe"),
            }
            production_mutations += 1;
        }
        let production_relevant_authorized_row_ids = if write_kind.is_some() {
            production_fresh_query_comparisons += 1;
            property_query_ids(&mut snapback)
        } else {
            production_initial_authorized_row_ids.clone()
        };

        cases.push(json!({
            "caseIndex": case_index,
            "scenario": scenario,
            "randomState": random_state,
            "revision": revision,
            "sourceRows": source_rows,
            "writeKind": write_kind,
            "productionInitialAuthorizedRowIds": production_initial_authorized_row_ids,
            "productionRelevantAuthorizedRowIds": production_relevant_authorized_row_ids,
        }));
    }
    assert_eq!(cases.len(), event_universe.len() * trials_per_event);
    assert_eq!(cases.len(), 36);

    println!(
        "SNAPBACK_AUTH_ACCEPTANCE_PROPERTY_RECEIPT={}",
        json!({
            "schemaVersion": 1,
            "seed": config["seed"],
            "trialsPerEvent": trials_per_event,
            "rowsPerCase": rows_per_case,
            "eventUniverse": event_universe,
            "randomizedSchedule": schedule,
            "totalCases": cases.len(),
            "productionFreshQueryComparisons": production_fresh_query_comparisons,
            "productionMutations": production_mutations,
            "cases": cases,
        })
    );
}

#[test]
// @ref LLP 0053#acceptance — run the required membership-churn measurement and
//   randomized full-requery oracle through the production invalidation seams.
fn permission_fields_churn_and_randomized_oracle_emit_the_committed_receipt() {
    let directory = tempfile::tempdir().expect("acceptance tempdir");
    let database_path = directory.path().join("authorization-acceptance.sqlite");
    let mut snapback = configured_file(&database_path);
    let user = id(mutate(
        &mut snapback,
        "usr_00000000000000000000000000",
        "createUser",
        json!({ "name": "Alice", "role": "member", "avatar": "a.png" }),
    ));
    mutate(
        &mut snapback,
        "usr_00000000000000000000000000",
        "createNote",
        json!({ "body": "unrelated retained-shaped payload" }),
    );
    let folder = id(mutate(
        &mut snapback,
        "usr_00000000000000000000000000",
        "createFolder",
        json!({ "orgId": "org-random" }),
    ));
    let connection = install_invalidation(&mut snapback);
    let mut queries = vec![
        subscribe(
            &mut snapback,
            &connection,
            "usr_00000000000000000000000000",
            "mineOrPublic",
            json!({}),
            10,
        ),
        subscribe(
            &mut snapback,
            &connection,
            "usr_00000000000000000000000001",
            "mineOrPublic",
            json!({}),
            11,
        ),
        subscribe(
            &mut snapback,
            &connection,
            "usr_00000000000000000000000002",
            "allNotes",
            json!({}),
            12,
        ),
    ];

    // Mixed permissionFields production writes. The exact unknown/empty-field
    // classification is separately pinned in
    // storage::authorization::tests::permission_fields_suppress_only_known_nonempty_disjoint_updates.
    let baseline = snapback
        .auth_invalidation_expectation_for_test()
        .expect("baseline authorization version");
    mutate(
        &mut snapback,
        "usr_00000000000000000000000000",
        "setUserAvatar",
        json!({ "id": user, "avatar": "b.png" }),
    );
    assert_eq!(
        snapback.auth_invalidation_expectation_for_test(),
        Some(baseline.clone()),
        "known disjoint avatar update must not fire"
    );
    assert_eq!(
        settle_all(&mut snapback, &connection, &mut queries, &BTreeSet::new(),)
            .delivered_snapshot_frames,
        0
    );

    mutate(
        &mut snapback,
        "usr_00000000000000000000000000",
        "setUserRole",
        json!({ "id": user, "role": "admin" }),
    );
    let role_delivery = settle_all(&mut snapback, &connection, &mut queries, &BTreeSet::new());
    assert_eq!(
        role_delivery.delivered_snapshot_frames,
        queries.len() as u64
    );
    let inserted = id(mutate(
        &mut snapback,
        "usr_00000000000000000000000001",
        "createUser",
        json!({ "name": "Bob", "role": "member", "avatar": "bob.png" }),
    ));
    settle_all(&mut snapback, &connection, &mut queries, &BTreeSet::new());
    mutate(
        &mut snapback,
        "usr_00000000000000000000000001",
        "deleteUser",
        json!({ "id": inserted }),
    );
    settle_all(&mut snapback, &connection, &mut queries, &BTreeSet::new());
    assert_eq!(
        snapback
            .auth_invalidation_expectation_for_test()
            .expect("mixed-field final version")
            .epoch,
        baseline.epoch + 3,
        "role, insert, and delete each fire; avatar does not"
    );

    // The blast-radius workload is membership churn, not a generic permission
    // surrogate: two lobby joins followed by a kick. None of these three
    // queries reads `gameMembers`, so every observed resnapshot is unrelated
    // disruption from the v1 global epoch. Lose the kick response for all
    // connections; the same three obligations must reproject exactly once.
    let membership_version_before = snapback
        .auth_invalidation_expectation_for_test()
        .expect("authorization version before membership churn");
    let alice_member = id(mutate(
        &mut snapback,
        "usr_00000000000000000000000000",
        "createGameMember",
        json!({ "gameId": "churn-game", "userId": "usr_00000000000000000000000000", "role": "player" }),
    ));
    let first_membership_observation =
        settle_all(&mut snapback, &connection, &mut queries, &BTreeSet::new());
    for query in &queries {
        assert_converges(&mut snapback, query);
    }
    let mut membership_raw_replay =
        raw_membership_replay(&first_membership_observation, 1, "join-alice");
    let mut membership_lifecycle_replay =
        normalize_membership_receipts(&first_membership_observation, 1, "join-alice");
    let mut membership_observation = first_membership_observation;
    let bob_member = id(mutate(
        &mut snapback,
        "usr_00000000000000000000000001",
        "createGameMember",
        json!({ "gameId": "churn-game", "userId": "usr_00000000000000000000000001", "role": "player" }),
    ));
    let second_membership_observation =
        settle_all(&mut snapback, &connection, &mut queries, &BTreeSet::new());
    for query in &queries {
        assert_converges(&mut snapback, query);
    }
    membership_raw_replay.extend(raw_membership_replay(
        &second_membership_observation,
        2,
        "join-bob",
    ));
    membership_lifecycle_replay.extend(normalize_membership_receipts(
        &second_membership_observation,
        2,
        "join-bob",
    ));
    membership_observation.merge(second_membership_observation);
    mutate(
        &mut snapback,
        "usr_00000000000000000000000000",
        "deleteGameMember",
        json!({ "id": bob_member }),
    );
    let all_connections = queries
        .iter()
        .map(|query| query.connection_id.clone())
        .collect();
    let third_membership_observation =
        settle_all(&mut snapback, &connection, &mut queries, &all_connections);
    for query in &queries {
        assert_converges(&mut snapback, query);
    }
    membership_raw_replay.extend(raw_membership_replay(
        &third_membership_observation,
        3,
        "kick-bob",
    ));
    membership_lifecycle_replay.extend(normalize_membership_receipts(
        &third_membership_observation,
        3,
        "kick-bob",
    ));
    membership_observation.merge(third_membership_observation);
    let membership_version_after = snapback
        .auth_invalidation_expectation_for_test()
        .expect("authorization version after membership churn");
    let membership_epoch_advance = membership_version_after
        .epoch
        .checked_sub(membership_version_before.epoch)
        .expect("membership epoch must be monotone");
    assert_eq!(membership_epoch_advance, 3);
    assert_delivery_accounting(&membership_observation, "membership churn");
    assert_eq!(membership_observation.generated_snapshot_frames, 12);
    assert_eq!(membership_observation.delivered_snapshot_frames, 9);
    assert_eq!(membership_observation.discarded_snapshot_frames, 3);
    assert_eq!(membership_observation.reprojected_snapshot_frames, 3);
    assert_eq!(membership_observation.generated_invalidation_frames, 21);
    assert_eq!(membership_observation.delivered_invalidation_frames, 15);
    assert_eq!(membership_observation.discarded_invalidation_frames, 6);
    assert_eq!(membership_observation.reprojected_invalidation_frames, 3);
    assert_eq!(membership_observation.discarded_response_drains, 3);
    assert_eq!(
        membership_observation.max_generated_snapshot_frames_per_query_settlement,
        2
    );
    assert_eq!(
        membership_observation.max_delivered_snapshot_frames_per_query_settlement,
        1
    );
    assert_eq!(
        membership_observation.max_explicit_reprojection_calls_per_query_settlement,
        1
    );
    assert_eq!(membership_observation.acknowledgements, 9);
    assert_eq!(membership_lifecycle_replay.len(), 9);
    assert!(!alice_member.is_empty());

    // Deterministic property corpus. Every change is processed by the real
    // matcher/invalidation path, then independently checked with a full query.
    // Every fourth operation loses the destructive drain before reprojecting
    // the still-live level-triggered obligation.
    let mut random = 0x0053_c0de_u64;
    let mut docs = Vec::<(String, String)>::new();
    let mut random_observation = DeliveryObservation::default();
    let mut scheduled_randomized_loss_rounds = 0_u64;
    let mut randomized_all_query_convergence_rounds = 0_u64;
    let mut randomized_fresh_query_comparisons = 0_u64;
    let randomized_version_before = snapback
        .auth_invalidation_expectation_for_test()
        .expect("authorization version before randomized writes");
    for operation in 0..24_u64 {
        random = random
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        let choice = (random >> 32) % 10;
        if docs.is_empty() || choice < 4 {
            let writer = if operation % 2 == 0 {
                "usr_00000000000000000000000000"
            } else {
                "usr_00000000000000000000000001"
            };
            let created = id(mutate(
                &mut snapback,
                writer,
                "createDoc",
                json!({
                    "title": format!("random-{operation}"),
                    "ownerId": if random & 1 == 0 { "usr_00000000000000000000000000" } else { "usr_00000000000000000000000001" },
                    "isPublic": random & 2 != 0,
                    "folderId": folder,
                }),
            ));
            docs.push((created, writer.to_owned()));
        } else {
            let index = (random as usize) % docs.len();
            let (doc, writer) = docs[index].clone();
            match choice {
                4..=6 => {
                    mutate(
                        &mut snapback,
                        &writer,
                        "setDocPublic",
                        json!({ "id": doc, "isPublic": random & 4 != 0 }),
                    );
                }
                7..=8 => {
                    mutate(
                        &mut snapback,
                        &writer,
                        "setDocOwner",
                        json!({ "id": doc, "ownerId": if random & 8 == 0 { "usr_00000000000000000000000000" } else { "usr_00000000000000000000000001" } }),
                    );
                }
                _ => {
                    mutate(&mut snapback, &writer, "deleteDoc", json!({ "id": doc }));
                    docs.swap_remove(index);
                }
            }
        }

        let lose = operation % 4 == 0;
        let lost = if lose {
            scheduled_randomized_loss_rounds += 1;
            queries
                .iter()
                .take(2)
                .map(|query| query.connection_id.clone())
                .collect()
        } else {
            BTreeSet::new()
        };
        random_observation.merge(settle_all(&mut snapback, &connection, &mut queries, &lost));
        for query in &queries {
            assert_converges(&mut snapback, query);
            randomized_fresh_query_comparisons += 1;
        }
        randomized_all_query_convergence_rounds += 1;
    }
    let randomized_version_after = snapback
        .auth_invalidation_expectation_for_test()
        .expect("authorization version after randomized writes");
    let randomized_epoch_advance = randomized_version_after
        .epoch
        .checked_sub(randomized_version_before.epoch)
        .expect("randomized epoch must be monotone");
    assert_eq!(randomized_epoch_advance, 0);
    assert_eq!(randomized_all_query_convergence_rounds, 24);
    assert_eq!(randomized_fresh_query_comparisons, 72);
    assert_delivery_accounting(&random_observation, "randomized writes");
    // Byte-identical patch attempts are now true storage no-ops. The fixed
    // random schedule contains four such attempts, so they create no commit
    // and therefore no live settlement obligation.
    assert_eq!(random_observation.generated_snapshot_frames, 52);
    assert_eq!(random_observation.delivered_snapshot_frames, 40);
    assert_eq!(random_observation.discarded_snapshot_frames, 12);
    assert_eq!(random_observation.reprojected_snapshot_frames, 12);
    assert_eq!(random_observation.generated_invalidation_frames, 52);
    assert_eq!(random_observation.delivered_invalidation_frames, 40);
    assert_eq!(random_observation.discarded_invalidation_frames, 12);
    assert_eq!(random_observation.reprojected_invalidation_frames, 12);
    assert_eq!(random_observation.discarded_response_drains, 12);
    assert_eq!(
        random_observation.max_generated_snapshot_frames_per_query_settlement,
        2
    );
    assert_eq!(
        random_observation.max_delivered_snapshot_frames_per_query_settlement,
        1
    );
    assert_eq!(
        random_observation.max_explicit_reprojection_calls_per_query_settlement,
        1
    );

    // Escalation is applied to a real outstanding quarantine after the first
    // response is lost. A host-branded denial monotonically replaces it with
    // delete, and the current projection (not the lost weaker ticket) wins.
    mutate(
        &mut snapback,
        "usr_00000000000000000000000000",
        "setUserRole",
        json!({ "id": user, "role": "suspended" }),
    );
    for query in &queries {
        let lost = parse_direct_invalidation_frames(
            snapback
                .authorization_invalidation_frames(&query.connection_id, &query.admission)
                .expect("lost primary invalidation projection"),
        );
        assert!(
            !lost.is_empty(),
            "the prior-drop schedule must discard a projected response"
        );
        let physically_drained = parse_invalidation_frames(drain_live_stream_through_test_sink(
            &mut snapback,
            &query.connection_id,
        ));
        assert_no_physical_invalidation_snapshots(&physically_drained);
    }
    let denied = snapback
        .subscriptions
        .get(&queries[0].subscription_id)
        .expect("query selected for escalation")
        .clone();
    snapback.fail_subscription_fanout_with_retry(
        &denied,
        "acceptance_trusted_denial",
        SnapbackError::trusted_permission_denied("acceptance authority removal"),
        None,
        None,
        &queries[0].admission,
    );
    let delete = settle_query(
        &mut snapback,
        &connection,
        &mut queries[0],
        DeliveryMode::DropDrainAndReproject,
    );
    assert_eq!(delete.delivered_dispositions.get("delete"), Some(&1));
    let terminal_escalation_disposition =
        single_delivered_disposition(&delete, "terminal escalation");
    assert!(queries[0].rows.is_empty());
    let quarantine = settle_query(
        &mut snapback,
        &connection,
        &mut queries[1],
        DeliveryMode::ReprojectAfterPriorDrop,
    );
    assert_eq!(quarantine.delivered_snapshot_frames, 1);
    assert_converges(&mut snapback, &queries[1]);
    let notes = settle_query(
        &mut snapback,
        &connection,
        &mut queries[2],
        DeliveryMode::ReprojectAfterPriorDrop,
    );
    assert_eq!(notes.delivered_snapshot_frames, 1);
    assert_converges(&mut snapback, &queries[2]);

    // An ordinary process restart destroys process-local scopes. The durable
    // authorization incarnation survives. The harness then supplies a query
    // instance distinct from every pre-restart fixture and observes the initial
    // snapshot returned by a new subscription instead of claiming that this
    // acceptance helper introspected the store allocator.
    let pre_restart_query_instances = queries
        .iter()
        .map(|query| query.query_instance_id)
        .collect::<BTreeSet<_>>();
    let before_restart = snapback
        .auth_database_mut()
        .authorization_version()
        .expect("authorization version before restart");
    drop(snapback);
    let mut restarted = LocalSnapback::open(&database_path).expect("restart acceptance database");
    let diagnostics = restarted.load_functions(acceptance_functions());
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED"),
        "unexpected restart function diagnostics: {diagnostics:?}"
    );
    let after_restart = restarted
        .auth_database_mut()
        .authorization_version()
        .expect("authorization version after restart");
    let ordinary_restart_preserved_incarnation =
        after_restart.incarnation == before_restart.incarnation;
    assert!(ordinary_restart_preserved_incarnation);
    let restarted_connection = install_invalidation(&mut restarted);
    let restarted_query = subscribe(
        &mut restarted,
        &restarted_connection,
        "usr_00000000000000000000000001",
        "mineOrPublic",
        json!({}),
        100,
    );
    let restart_installed_new_issuer = restarted_connection.issuer_id() != connection.issuer_id();
    assert!(restart_installed_new_issuer);
    let restart_accepted_distinct_caller_supplied_query_instance =
        !pre_restart_query_instances.contains(&restarted_query.query_instance_id);
    assert!(restart_accepted_distinct_caller_supplied_query_instance);
    let restart_initial_snapshot_converged =
        converges_with_fresh_query(&mut restarted, &restarted_query);
    assert!(restart_initial_snapshot_converged);

    let membership_disposition =
        single_delivered_disposition(&membership_observation, "membership churn");
    let randomized_disposition =
        single_delivered_disposition(&random_observation, "randomized writes");
    let raw_sample = random_observation
        .observed_receipts
        .first()
        .expect("randomized corpus produced a receipt");
    let normalized_sample = json!({
        "scopeKind": raw_sample["scope"]["kind"],
        "revision": raw_sample["revision"],
        "compositeWitness": {
            "authorization": {
                "incarnation": "<authenticated-uuid-v7>",
                "epoch": raw_sample["compositeWitness"]["authorization"]["epoch"],
            },
            "data": {
                "versionStream": "<authenticated-version-stream>",
                "minCommitVersion": raw_sample["compositeWitness"]["data"]["minCommitVersion"],
            },
        },
        "disposition": raw_sample["disposition"],
    });
    let actual = json!({
        "schemaVersion": 2,
        "rfc": "LLP 0053",
        "scenario": {
            "name": "deterministic-membership-and-row-visibility-churn",
            "randomizedOperations": 24,
            "randomSeed": "0x0053c0de",
            "authScopedQueries": 3,
            "unrelatedQueriesDuringPermissionChurn": 3,
            "membershipChurnEvents": 3,
            "scheduledMembershipLossRounds": 1,
            "scheduledRandomizedLossRounds": scheduled_randomized_loss_rounds,
            "restartOperations": 1,
        },
        "runtimeMeasurements": {
            "membershipChurn": {
                "generatedInvalidationFrames": membership_observation.generated_invalidation_frames,
                "generatedSnapshotFrames": membership_observation.generated_snapshot_frames,
                "deliveredInvalidationFrames": membership_observation.delivered_invalidation_frames,
                "deliveredSnapshotFrames": membership_observation.delivered_snapshot_frames,
                "discardedInvalidationFrames": membership_observation.discarded_invalidation_frames,
                "discardedSnapshotFrames": membership_observation.discarded_snapshot_frames,
                "reprojectedInvalidationFrames": membership_observation.reprojected_invalidation_frames,
                "reprojectedSnapshotFrames": membership_observation.reprojected_snapshot_frames,
                "discardedResponseDrains": membership_observation.discarded_response_drains,
                "acknowledgements": membership_observation.acknowledgements,
                "maxGeneratedSnapshotFramesPerQuerySettlement": membership_observation.max_generated_snapshot_frames_per_query_settlement,
                "maxDeliveredSnapshotFramesPerQuerySettlement": membership_observation.max_delivered_snapshot_frames_per_query_settlement,
                "maxExplicitReprojectionCallsPerQuerySettlement": membership_observation.max_explicit_reprojection_calls_per_query_settlement,
                "deliveredDisposition": membership_disposition,
            },
            "randomizedWrites": {
                "generatedInvalidationFrames": random_observation.generated_invalidation_frames,
                "generatedSnapshotFrames": random_observation.generated_snapshot_frames,
                "deliveredInvalidationFrames": random_observation.delivered_invalidation_frames,
                "deliveredSnapshotFrames": random_observation.delivered_snapshot_frames,
                "discardedInvalidationFrames": random_observation.discarded_invalidation_frames,
                "discardedSnapshotFrames": random_observation.discarded_snapshot_frames,
                "reprojectedInvalidationFrames": random_observation.reprojected_invalidation_frames,
                "reprojectedSnapshotFrames": random_observation.reprojected_snapshot_frames,
                "discardedResponseDrains": random_observation.discarded_response_drains,
                "acknowledgements": random_observation.acknowledgements,
                "maxGeneratedSnapshotFramesPerQuerySettlement": random_observation.max_generated_snapshot_frames_per_query_settlement,
                "maxDeliveredSnapshotFramesPerQuerySettlement": random_observation.max_delivered_snapshot_frames_per_query_settlement,
                "maxExplicitReprojectionCallsPerQuerySettlement": random_observation.max_explicit_reprojection_calls_per_query_settlement,
                "deliveredDisposition": randomized_disposition,
            },
        },
        "runtimeAssertions": {
            "membershipAuthorizationEpochAdvance": membership_epoch_advance,
            "membershipFreshQueryComparisons": membership_lifecycle_replay.len(),
            "randomizedAuthorizationEpochAdvance": randomized_epoch_advance,
            "randomizedAllQueryConvergenceRounds": randomized_all_query_convergence_rounds,
            "randomizedFreshQueryComparisons": randomized_fresh_query_comparisons,
            "terminalEscalationDisposition": terminal_escalation_disposition,
            "ordinaryRestartPreservedIncarnation": ordinary_restart_preserved_incarnation,
            "restartInstalledNewIssuer": restart_installed_new_issuer,
            "restartAcceptedDistinctCallerSuppliedQueryInstance": restart_accepted_distinct_caller_supplied_query_instance,
            "restartInitialSnapshotConverged": restart_initial_snapshot_converged,
        },
        "membershipLifecycleReplay": membership_lifecycle_replay,
        "serverObligation": {
            "normalizedFieldSources": {
                "compositeWitness": "obligation.witness",
                "scopeKind": "obligation.scopeId.kind",
                "revision": "obligation.revision",
                "disposition": "obligation.maxDisposition",
            },
            "identifierNormalizations": {
                "compositeWitness.authorization.incarnation": "<authenticated-uuid-v7>",
                "compositeWitness.data.versionStream": "<authenticated-version-stream>",
            },
            "sample": normalized_sample,
        },
        "harnessExpectedAssertions": {
            "membershipClassification": {
                "expectedPath": "enumerated-permission-write",
                "basis": {
                    "permissionBackingWrites": 3,
                    "authorizationEpochAdvance": membership_epoch_advance,
                },
                "productionFrameReportsPath": false,
            },
            "randomizedClassification": {
                "expectedPath": "matcher-full-requery",
                "basis": {
                    "authorizationEpochAdvance": randomized_epoch_advance,
                    "allQueryConvergenceRounds": randomized_all_query_convergence_rounds,
                    "freshQueryComparisons": randomized_fresh_query_comparisons,
                },
                "productionFrameReportsPath": false,
            },
        },
        "independentFixtureAssertions": {
            "authorizedRetainedStore": {
                "sourceTest": "packages/snapback-contract/authorized-retained-store.test.mjs",
                "expectedOutcomes": {
                    "authorizedReadDuringQuarantine": null,
                    "physicallyRetainedRowsDuringQuarantine": [{ "card": "ace-updated" }],
                },
            },
            "mutationQueueAuthorization": {
                "sourceTest": "packages/snapback-contract/client-store-queue-authorization.test.mjs",
                "expectedOutcomes": {
                    "suspendedAfterOneOfTwoQuarantineRootsResolves": true,
                    "pendingMutationIdsAfterBothQuarantineRootsResolve": [
                        "cm_queue_a",
                        "cm_queue_b",
                    ],
                },
            },
        },
        "oracle": {
            "kind": "fresh-full-query-and-authorization-re-evaluation",
            "randomizedAllQueryConvergenceRounds": randomized_all_query_convergence_rounds,
            "randomizedFreshQueryComparisons": randomized_fresh_query_comparisons,
        },
        "coverageBoundaries": {
            "clientVisibleTimingMeasuredByThisHarness": false,
            "durableByteOrTombstoneCountsMeasuredByThisHarness": false,
            "clientFixtureAssertionsAreRuntimeMeasurementsFromThisHarness": false,
            "queryInstanceAllocatorIntrospectedByThisHarness": false,
        },
    });
    println!("SNAPBACK_AUTH_ACCEPTANCE_SERVER_RECEIPT={actual}");
    println!(
        "SNAPBACK_AUTH_ACCEPTANCE_SERVER_REPLAY={}",
        json!({
            "schemaVersion": 1,
            "transitions": membership_raw_replay,
        })
    );
    let expected: Value = serde_json::from_str(include_str!(
        "../../../../tests/acceptance/auth-invalidation-v1-receipt.json"
    ))
    .expect("committed acceptance receipt JSON");
    assert_eq!(actual, expected, "acceptance receipt drifted");
}
