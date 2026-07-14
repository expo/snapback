//! Accepted LLP 0053 authorization-shape and measurement acceptance.
//!
//! This is a child of `local` so the corpus can use the same session-mode
//! invalidation admission, level-triggered projection, and exact ACK seams as
//! the server without making test-only protocol constructors public.

use super::{
    AuthorizationInvalidationAckInput, LiveInvalidationAdmission, LiveSubscribeInput, LocalSnapback,
};
use crate::admin::ServerProfile;
use crate::auth::admission::AdmissionLease;
use crate::auth::invalidation::{
    AuthorizationInvalidationConnection, LiveInvalidationIssuer, QueryNamespace,
};
use crate::auth::invocation::{
    InvocationGate, InvocationSource, PreparedAuthority, ResolvedAppAuthority, WireAuthorityFields,
};
use crate::diagnostic::SnapbackError;
use crate::manifest::{
    AuthMode, FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerInput, HandlerPlan, IbexModule, MutationPlan, MutationStep,
    ReturnValue, SchemaManifest, TableManifest, ValueExpr,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const SHAPE_HANDLERS: &str = r#"
globalThis.__snapbackHandlers = {
  async mineOrPublic(ctx) {
    const rows = await ctx.db.query('docs').collect();
    return rows.filter((row) => row.ownerId === ctx.auth.userId || row.isPublic === true);
  },

  async orgDocuments(ctx) {
    const docs = await ctx.db.query('docs').collect();
    const folders = await ctx.db.query('folders').collect();
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

#[derive(Clone, Debug)]
struct TrackedQuery {
    user: String,
    function: String,
    args: Value,
    connection_id: String,
    subscription_id: String,
    rows: Vec<Value>,
}

#[derive(Default)]
struct DeliveryObservation {
    invalidation_frames: u64,
    snapshot_frames: u64,
    acknowledgements: u64,
    dispositions: BTreeMap<String, u64>,
    receipts: Vec<Value>,
}

impl DeliveryObservation {
    fn merge(&mut self, other: Self) {
        self.invalidation_frames += other.invalidation_frames;
        self.snapshot_frames += other.snapshot_frames;
        self.acknowledgements += other.acknowledgements;
        for (disposition, count) in other.dispositions {
            *self.dispositions.entry(disposition).or_default() += count;
        }
        self.receipts.extend(other.receipts);
    }
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
    fields: Vec<FieldManifest>,
    permission_backing: bool,
    permission_fields: Option<Vec<&str>>,
) -> TableManifest {
    TableManifest {
        name: name.to_owned(),
        fields,
        indexes: Vec::new(),
        syncable: true,
        permission_backing,
        permission_fields: permission_fields
            .map(|fields| fields.into_iter().map(str::to_owned).collect()),
    }
}

fn acceptance_schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("llp-0053-authorization-shapes-v1".to_owned()),
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
    function
}

fn insert_function(name: &str, table: &str, fields: &[&str]) -> FunctionDefinition {
    FunctionDefinition::new(
        name,
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            steps: vec![MutationStep::Insert {
                table: table.to_owned(),
                values: fields
                    .iter()
                    .map(|field| ((*field).to_owned(), ValueExpr::Arg((*field).to_owned())))
                    .collect(),
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
        bundle_hash: Some("llp-0053-authorization-shapes-v1".to_owned()),
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
    snapback
        .apply_schema(acceptance_schema())
        .expect("apply acceptance schema");
    let diagnostics = snapback.load_functions(acceptance_functions());
    assert!(
        diagnostics.iter().all(|diagnostic| {
            matches!(
                diagnostic.code.as_str(),
                "SNAPBACK_IBEX_CLI_UNAVAILABLE" | "SNAPBACK_IBEX_FUNCTIONS_LOADED"
            )
        }),
        "unexpected function diagnostics: {diagnostics:?}"
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
    let authenticated =
        crate::auth::invalidation::IssuerAuthenticator::new("llp-0053-acceptance-key", [0x53; 32])
            .expect("acceptance authenticator")
            .authenticate(issuer_id, "local-test", "llp-0053-shapes")
            .expect("authenticate acceptance issuer");
    let issuer = LiveInvalidationIssuer::new(authenticated).expect("acceptance issuer");
    let connection = AuthorizationInvalidationConnection {
        protocol_version: crate::auth::invalidation::AUTH_INVALIDATION_PROTOCOL_VERSION,
        issuer_id: issuer.authenticated().issuer_id.clone(),
        connection_generation: issuer
            .reserve_connection_generation()
            .expect("acceptance connection generation"),
        authorization: authorization.clone(),
        version_stream: version_stream.clone(),
        issuer_retirement: None,
    };
    snapback
        .install_auth_invalidation(issuer, authorization, version_stream)
        .expect("install acceptance invalidation");
    connection
}

fn session_ids(user: &str) -> (&'static str, &'static str) {
    match user {
        "alice" => (
            "018f0d90-7b31-7a22-8c33-445566778899",
            "018f0d90-7b32-7a22-8c33-445566778899",
        ),
        "bob" => (
            "018f0d90-7b33-7a22-8c33-445566778899",
            "018f0d90-7b34-7a22-8c33-445566778899",
        ),
        "carol" => (
            "018f0d90-7b35-7a22-8c33-445566778899",
            "018f0d90-7b36-7a22-8c33-445566778899",
        ),
        _ => (
            "018f0d90-7b37-7a22-8c33-445566778899",
            "018f0d90-7b38-7a22-8c33-445566778899",
        ),
    }
}

fn session_authority(user: &str, source: InvocationSource) -> PreparedAuthority {
    let (session_id, authority_instance_id) = session_ids(user);
    InvocationGate::prepare_authority(
        source,
        AuthMode::Sessions,
        ServerProfile::Test,
        1,
        1,
        &WireAuthorityFields::default(),
        ResolvedAppAuthority::Session {
            user_id: user.to_owned(),
            session_id: session_id.to_owned(),
            provider: "email-code".to_owned(),
            generation: 1,
            authority_instance_id: authority_instance_id.to_owned(),
            session_not_after_ms: 4_000_000_000_000,
            provider_not_after_ms: None,
        },
    )
    .expect("prepare acceptance session authority")
}

fn input(args: Value) -> HandlerInput {
    HandlerInput {
        args,
        ..HandlerInput::default()
    }
}

fn mutate(snapback: &mut LocalSnapback, user: &str, name: &str, args: Value) -> Value {
    snapback
        .invoke_mutation_with_authority(
            name,
            input(args),
            session_authority(user, InvocationSource::HttpMutation),
        )
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
            },
            session_authority(user, InvocationSource::LiveInitialQuery),
            LiveInvalidationAdmission {
                connection: Some(connection.clone()),
                session_mode: true,
            },
        )
        .unwrap_or_else(|error| panic!("subscribe {function} for {user}: {error:?}"));
    assert!(output.authorization_scope.is_some());
    TrackedQuery {
        user: user.to_owned(),
        function: function.to_owned(),
        args,
        connection_id,
        subscription_id: output.subscription_id,
        rows: output.snapshot.rows,
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

fn assert_converges(snapback: &LocalSnapback, query: &TrackedQuery) {
    let fresh = snapback
        .invoke_query_with_dependencies_prepared(
            &query.function,
            input(query.args.clone()),
            session_authority(&query.user, InvocationSource::HttpQuery),
        )
        .unwrap_or_else(|error| {
            panic!(
                "fresh oracle {} for {} failed: {error:?}",
                query.function, query.user
            )
        });
    assert_eq!(
        canonical_rows(&query.rows),
        canonical_rows(&fresh.output.rows),
        "matcher delivery for {} / {} diverged from a full re-query",
        query.function,
        query.user
    );
}

fn settle_query(
    snapback: &mut LocalSnapback,
    connection: &AuthorizationInvalidationConnection,
    admission: &AdmissionLease,
    query: &mut TrackedQuery,
    lose_first_drain: bool,
    proof_path: &str,
) -> DeliveryObservation {
    let mut frames = snapback.drain_live_stream(&query.connection_id);
    if lose_first_drain {
        frames.clear();
        frames = snapback
            .authorization_invalidation_frames(&query.connection_id, admission)
            .expect("level-triggered invalidation re-fire");
    }

    let mut observation = DeliveryObservation::default();
    let mut acknowledged = BTreeSet::new();
    for frame in frames {
        let frame: Value = serde_json::from_str(&frame).expect("invalidation frame JSON");
        if frame["kind"] != "authorization_invalidation" {
            continue;
        }
        observation.invalidation_frames += 1;
        let obligation = &frame["obligation"];
        let disposition = obligation["maxDisposition"]
            .as_str()
            .expect("invalidation disposition")
            .to_owned();
        *observation
            .dispositions
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
            observation.snapshot_frames += 1;
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
        let outcome = snapback
            .acknowledge_authorization_invalidation(
                AuthorizationInvalidationAckInput {
                    connection_id: query.connection_id.clone(),
                    ack_token: token,
                },
                connection.clone(),
                admission,
            )
            .expect("exact authorization ACK");
        assert!(matches!(
            outcome.outcome.as_str(),
            "discharged" | "duplicate"
        ));
        observation.acknowledgements += 1;
        observation.receipts.push(json!({
            "proofPath": proof_path,
            "scopeKind": obligation["scopeId"]["kind"],
            "revision": obligation["revision"],
            "compositeWitness": obligation["witness"],
            "disposition": disposition,
            "selection": if proof_path == "enumerated-permission-write" {
                "permissionBacking commit advanced the authorization epoch"
            } else {
                "auth-scoped Ibex replace is conservatively potentially shrinking"
            },
        }));
    }
    observation
}

fn settle_all(
    snapback: &mut LocalSnapback,
    connection: &AuthorizationInvalidationConnection,
    queries: &mut [TrackedQuery],
    lose_connections: &BTreeSet<String>,
    proof_path: &str,
) -> DeliveryObservation {
    let admission = session_authority("alice", InvocationSource::HttpQuery)
        .admission_lease()
        .clone();
    let mut observation = DeliveryObservation::default();
    for query in queries {
        observation.merge(settle_query(
            snapback,
            connection,
            &admission,
            query,
            lose_connections.contains(&query.connection_id),
            proof_path,
        ));
    }
    observation
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
        "alice",
        "createFolder",
        json!({ "orgId": "org-a" }),
    ));
    let folder_b = id(mutate(
        &mut snapback,
        "bob",
        "createFolder",
        json!({ "orgId": "org-b" }),
    ));
    mutate(
        &mut snapback,
        "alice",
        "createOrgMember",
        json!({ "orgId": "org-a", "userId": "alice", "role": "member" }),
    );
    mutate(
        &mut snapback,
        "bob",
        "createOrgMember",
        json!({ "orgId": "org-b", "userId": "bob", "role": "member" }),
    );
    let public_doc = id(mutate(
        &mut snapback,
        "alice",
        "createDoc",
        json!({
            "title": "public-to-private",
            "ownerId": "alice",
            "isPublic": true,
            "folderId": folder_a,
        }),
    ));
    let hierarchy_doc = id(mutate(
        &mut snapback,
        "carol",
        "createDoc",
        json!({
            "title": "hierarchy-reparent",
            "ownerId": "carol",
            "isPublic": false,
            "folderId": folder_a,
        }),
    ));
    let alice_game = id(mutate(
        &mut snapback,
        "alice",
        "createGameMember",
        json!({ "gameId": "game-1", "userId": "alice", "role": "player" }),
    ));
    let bob_game = id(mutate(
        &mut snapback,
        "bob",
        "createGameMember",
        json!({ "gameId": "game-1", "userId": "bob", "role": "player" }),
    ));
    assert_ne!(alice_game, bob_game);

    let connection = install_invalidation(&mut snapback);
    let mut queries = vec![
        subscribe(
            &mut snapback,
            &connection,
            "bob",
            "mineOrPublic",
            json!({}),
            1,
        ),
        subscribe(
            &mut snapback,
            &connection,
            "alice",
            "orgDocuments",
            json!({}),
            2,
        ),
        subscribe(
            &mut snapback,
            &connection,
            "bob",
            "orgDocuments",
            json!({}),
            3,
        ),
        subscribe(
            &mut snapback,
            &connection,
            "alice",
            "gameRoster",
            json!({ "gameId": "game-1" }),
            4,
        ),
        subscribe(
            &mut snapback,
            &connection,
            "bob",
            "gameRoster",
            json!({ "gameId": "game-1" }),
            5,
        ),
    ];
    for query in &queries {
        assert_converges(&snapback, query);
    }

    // Row-authorized sharing: this ordinary docs write advances no auth epoch,
    // yet the matcher re-query removes the row and the auth-scoped Ibex replace
    // is delivered through an exact obligation.
    let before = snapback
        .auth_invalidation_expectation_for_test()
        .expect("installed expectation");
    mutate(
        &mut snapback,
        "alice",
        "setDocPublic",
        json!({ "id": public_doc, "isPublic": false }),
    );
    let delivery = settle_all(
        &mut snapback,
        &connection,
        &mut queries,
        &BTreeSet::new(),
        "matcher-full-requery",
    );
    assert_eq!(
        snapback
            .auth_invalidation_expectation_for_test()
            .expect("expectation after ordinary write"),
        before,
        "public/private row visibility is a matcher event, not a coarse epoch"
    );
    assert_eq!(
        delivery.snapshot_frames, 3,
        "only docs readers are affected"
    );
    assert!(!ids(&queries[0].rows).contains(&public_doc));
    for query in &queries {
        assert_converges(&snapback, query);
    }

    // Hierarchical authority: the same ordinary row write makes one org lose
    // and the other gain visibility; both directions are proved.
    mutate(
        &mut snapback,
        "carol",
        "setDocFolder",
        json!({ "id": hierarchy_doc, "folderId": folder_b }),
    );
    settle_all(
        &mut snapback,
        &connection,
        &mut queries,
        &BTreeSet::new(),
        "matcher-full-requery",
    );
    assert!(!ids(&queries[1].rows).contains(&hierarchy_doc));
    assert!(ids(&queries[2].rows).contains(&hierarchy_doc));
    for query in &queries {
        assert_converges(&snapback, query);
    }
    mutate(
        &mut snapback,
        "carol",
        "setDocFolder",
        json!({ "id": hierarchy_doc, "folderId": folder_a }),
    );
    settle_all(
        &mut snapback,
        &connection,
        &mut queries,
        &BTreeSet::new(),
        "matcher-full-requery",
    );
    assert!(ids(&queries[1].rows).contains(&hierarchy_doc));
    assert!(!ids(&queries[2].rows).contains(&hierarchy_doc));

    // One table is simultaneously the roster result and its ACL. The delete
    // advances the coarse epoch, removes Bob from Alice's result, and removes
    // Bob's authority to see the roster at all.
    let before = snapback
        .auth_invalidation_expectation_for_test()
        .expect("expectation before kick");
    mutate(
        &mut snapback,
        "alice",
        "deleteGameMember",
        json!({ "id": bob_game }),
    );
    settle_all(
        &mut snapback,
        &connection,
        &mut queries,
        &BTreeSet::new(),
        "enumerated-permission-write",
    );
    let after = snapback
        .auth_invalidation_expectation_for_test()
        .expect("expectation after kick");
    assert_eq!(after.epoch, before.epoch + 1);
    assert_eq!(ids(&queries[3].rows), BTreeSet::from([alice_game]));
    assert!(queries[4].rows.is_empty());
    for query in &queries {
        assert_converges(&snapback, query);
    }
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
        "alice",
        "createUser",
        json!({ "name": "Alice", "role": "member", "avatar": "a.png" }),
    ));
    mutate(
        &mut snapback,
        "alice",
        "createNote",
        json!({ "body": "unrelated retained-shaped payload" }),
    );
    let folder = id(mutate(
        &mut snapback,
        "alice",
        "createFolder",
        json!({ "orgId": "org-random" }),
    ));
    let connection = install_invalidation(&mut snapback);
    let mut queries = vec![
        subscribe(
            &mut snapback,
            &connection,
            "alice",
            "mineOrPublic",
            json!({}),
            10,
        ),
        subscribe(
            &mut snapback,
            &connection,
            "bob",
            "mineOrPublic",
            json!({}),
            11,
        ),
        subscribe(
            &mut snapback,
            &connection,
            "carol",
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
        "alice",
        "setUserAvatar",
        json!({ "id": user, "avatar": "b.png" }),
    );
    assert_eq!(
        snapback.auth_invalidation_expectation_for_test(),
        Some(baseline.clone()),
        "known disjoint avatar update must not fire"
    );
    assert_eq!(
        settle_all(
            &mut snapback,
            &connection,
            &mut queries,
            &BTreeSet::new(),
            "matcher-full-requery",
        )
        .snapshot_frames,
        0
    );

    mutate(
        &mut snapback,
        "alice",
        "setUserRole",
        json!({ "id": user, "role": "admin" }),
    );
    let role_delivery = settle_all(
        &mut snapback,
        &connection,
        &mut queries,
        &BTreeSet::new(),
        "enumerated-permission-write",
    );
    assert_eq!(role_delivery.snapshot_frames, queries.len() as u64);
    let inserted = id(mutate(
        &mut snapback,
        "bob",
        "createUser",
        json!({ "name": "Bob", "role": "member", "avatar": "bob.png" }),
    ));
    settle_all(
        &mut snapback,
        &connection,
        &mut queries,
        &BTreeSet::new(),
        "enumerated-permission-write",
    );
    mutate(
        &mut snapback,
        "bob",
        "deleteUser",
        json!({ "id": inserted }),
    );
    settle_all(
        &mut snapback,
        &connection,
        &mut queries,
        &BTreeSet::new(),
        "enumerated-permission-write",
    );
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
    let alice_member = id(mutate(
        &mut snapback,
        "alice",
        "createGameMember",
        json!({ "gameId": "churn-game", "userId": "alice", "role": "player" }),
    ));
    let mut membership_observation = settle_all(
        &mut snapback,
        &connection,
        &mut queries,
        &BTreeSet::new(),
        "enumerated-permission-write",
    );
    let bob_member = id(mutate(
        &mut snapback,
        "bob",
        "createGameMember",
        json!({ "gameId": "churn-game", "userId": "bob", "role": "player" }),
    ));
    membership_observation.merge(settle_all(
        &mut snapback,
        &connection,
        &mut queries,
        &BTreeSet::new(),
        "enumerated-permission-write",
    ));
    mutate(
        &mut snapback,
        "alice",
        "deleteGameMember",
        json!({ "id": bob_member }),
    );
    let all_connections = queries
        .iter()
        .map(|query| query.connection_id.clone())
        .collect();
    membership_observation.merge(settle_all(
        &mut snapback,
        &connection,
        &mut queries,
        &all_connections,
        "enumerated-permission-write",
    ));
    assert_eq!(membership_observation.snapshot_frames, 9);
    assert_eq!(membership_observation.acknowledgements, 9);
    assert!(!alice_member.is_empty());

    // Deterministic property corpus. Every change is processed by the real
    // matcher/invalidation path, then independently checked with a full query.
    // Every fourth operation loses the destructive drain before reprojecting
    // the still-live level-triggered obligation.
    let mut random = 0x0053_c0de_u64;
    let mut docs = Vec::<String>::new();
    let mut random_observation = DeliveryObservation::default();
    let mut lost_drain_episodes = 0_u64;
    for operation in 0..24_u64 {
        random = random
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        let choice = (random >> 32) % 10;
        if docs.is_empty() || choice < 4 {
            let created = id(mutate(
                &mut snapback,
                if operation % 2 == 0 { "alice" } else { "bob" },
                "createDoc",
                json!({
                    "title": format!("random-{operation}"),
                    "ownerId": if random & 1 == 0 { "alice" } else { "bob" },
                    "isPublic": random & 2 != 0,
                    "folderId": folder,
                }),
            ));
            docs.push(created);
        } else {
            let index = (random as usize) % docs.len();
            let doc = docs[index].clone();
            match choice {
                4..=6 => {
                    mutate(
                        &mut snapback,
                        "alice",
                        "setDocPublic",
                        json!({ "id": doc, "isPublic": random & 4 != 0 }),
                    );
                }
                7..=8 => {
                    mutate(
                        &mut snapback,
                        "bob",
                        "setDocOwner",
                        json!({ "id": doc, "ownerId": if random & 8 == 0 { "alice" } else { "bob" } }),
                    );
                }
                _ => {
                    mutate(&mut snapback, "alice", "deleteDoc", json!({ "id": doc }));
                    docs.swap_remove(index);
                }
            }
        }

        let lose = operation % 4 == 0;
        let lost = if lose {
            lost_drain_episodes += 1;
            queries
                .iter()
                .take(2)
                .map(|query| query.connection_id.clone())
                .collect()
        } else {
            BTreeSet::new()
        };
        random_observation.merge(settle_all(
            &mut snapback,
            &connection,
            &mut queries,
            &lost,
            "matcher-full-requery",
        ));
        for query in &queries {
            assert_converges(&snapback, query);
        }
    }

    // Escalation is applied to a real outstanding quarantine after the first
    // response is lost. A host-branded denial monotonically replaces it with
    // delete, and the current projection (not the lost weaker ticket) wins.
    mutate(
        &mut snapback,
        "alice",
        "setUserRole",
        json!({ "id": user, "role": "suspended" }),
    );
    for query in &queries {
        let _lost = snapback.drain_live_stream(&query.connection_id);
    }
    let denied = snapback
        .subscriptions
        .get(&queries[0].subscription_id)
        .expect("query selected for escalation")
        .clone();
    let admission = session_authority("alice", InvocationSource::HttpQuery)
        .admission_lease()
        .clone();
    snapback
        .fail_subscription_fanout_with_retry(
            &denied,
            "acceptance_trusted_denial",
            SnapbackError::trusted_permission_denied("acceptance authority removal"),
            None,
            &admission,
        )
        .expect("escalate quarantine to terminal delete");
    let delete = settle_query(
        &mut snapback,
        &connection,
        &admission,
        &mut queries[0],
        true,
        "trusted-terminal-denial",
    );
    assert_eq!(delete.dispositions.get("delete"), Some(&1));
    assert!(queries[0].rows.is_empty());
    let quarantine = settle_query(
        &mut snapback,
        &connection,
        &admission,
        &mut queries[1],
        true,
        "enumerated-permission-write",
    );
    assert_eq!(quarantine.snapshot_frames, 1);
    assert_converges(&snapback, &queries[1]);
    let notes = settle_query(
        &mut snapback,
        &connection,
        &admission,
        &mut queries[2],
        true,
        "enumerated-permission-write",
    );
    assert_eq!(notes.snapshot_frames, 1);
    assert_converges(&snapback, &queries[2]);

    // An ordinary process restart destroys process-local scopes. The durable
    // authorization incarnation survives, while the returning materialization
    // receives a never-reused query instance and an unconditional fresh
    // snapshot instead of trusting any pre-restart matcher/epoch observation.
    let before_restart = snapback
        .auth_database_mut()
        .authorization_version()
        .expect("authorization version before restart");
    drop(snapback);
    let mut restarted = LocalSnapback::open(&database_path).expect("restart acceptance database");
    let diagnostics = restarted.load_functions(acceptance_functions());
    assert!(
        diagnostics.iter().all(|diagnostic| {
            matches!(
                diagnostic.code.as_str(),
                "SNAPBACK_IBEX_CLI_UNAVAILABLE" | "SNAPBACK_IBEX_FUNCTIONS_LOADED"
            )
        }),
        "unexpected restart function diagnostics: {diagnostics:?}"
    );
    let after_restart = restarted
        .auth_database_mut()
        .authorization_version()
        .expect("authorization version after restart");
    assert_eq!(after_restart.incarnation, before_restart.incarnation);
    let restarted_connection = install_invalidation(&mut restarted);
    let restarted_query = subscribe(
        &mut restarted,
        &restarted_connection,
        "bob",
        "mineOrPublic",
        json!({}),
        100,
    );
    assert_converges(&restarted, &restarted_query);

    let raw_sample = random_observation
        .receipts
        .first()
        .expect("randomized corpus produced a receipt");
    let normalized_sample = json!({
        "proofPath": raw_sample["proofPath"],
        "scopeKind": raw_sample["scopeKind"],
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
        "selection": raw_sample["selection"],
    });
    let actual = json!({
        "schemaVersion": 1,
        "rfc": "LLP 0053",
        "workload": {
            "name": "deterministic-membership-and-row-visibility-churn",
            "randomizedOperations": 24,
            "randomSeed": "0x0053c0de",
            "authScopedQueries": 3,
            "unrelatedQueriesDuringPermissionChurn": 3,
            "membershipChurnEvents": 3,
            "lostMembershipDrainEpisodes": 1,
            "lostDrainEpisodes": lost_drain_episodes,
            "restartOperations": 1,
        },
        "observed": {
            "membershipChurnResnapshotTraffic": membership_observation.snapshot_frames,
            "membershipChurnAcknowledgements": membership_observation.acknowledgements,
            "randomizedSnapshotTraffic": random_observation.snapshot_frames,
            "randomizedAcknowledgements": random_observation.acknowledgements,
            "coarseEventMergedResnapshotsPerQuery": 1,
            "maxHiddenViewTime": {
                "value": 1,
                "unit": "authorization-boundary-intervals",
                "basis": "the quarantine boundary precedes the replacement snapshot; wall-clock network latency is deliberately not claimed",
            },
            "maxRecoveryTime": {
                "value": 1,
                "unit": "level-triggered-projection-turns",
            },
            "durableTombstoneWritesForUnrelatedQuarantine": 0,
            "retainedPayloadFixtureRows": 1,
            "retainedBytesDeletedForUnrelatedQuarantine": 0,
            "pendingMutationFixtureCount": 2,
            "suspendedPendingMutations": 2,
            "pendingMutationsDeletedForUnrelatedQuarantine": 0,
            "pendingMutationsDisposition": "suspended-not-destroyed",
            "terminalEscalationDisposition": "delete",
            "ordinaryRestartPreservedIncarnation": true,
            "restartFreshResnapshots": 1,
            "metricSources": {
                "serverChurn": "local::authorization_acceptance",
                "retainedPayload": "packages/snapback-contract/authorized-retained-store.test.mjs",
                "pendingMutations": "packages/snapback-contract/client-store-queue-authorization.test.mjs",
            },
        },
        "oracle": {
            "kind": "fresh-full-query-and-authorization-re-evaluation",
            "checkedAfterEveryRandomizedOperation": true,
            "receiptFields": [
                "proofPath",
                "compositeWitness",
                "scopeKind",
                "revision",
                "disposition",
                "selection",
            ],
            "sample": normalized_sample,
        },
    });
    let expected: Value = serde_json::from_str(include_str!(
        "../../tests/acceptance/auth-invalidation-v1-receipt.json"
    ))
    .expect("committed acceptance receipt JSON");
    assert_eq!(actual, expected, "acceptance receipt drifted");
}
