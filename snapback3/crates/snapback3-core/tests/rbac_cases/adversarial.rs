use snapback3_core::ir::IndexKeyExpr;
use snapback3_core::*;
use std::collections::{BTreeMap, VecDeque};

fn actor(value: &str) -> Actor {
    Actor::user(value).unwrap()
}

fn schema(tables: BTreeMap<String, Table>) -> Schema {
    Schema {
        schedules: Vec::new(),
        tables,
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    }
}

fn generation(schema: Schema, programs: Vec<Program>) -> Generation {
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema,
            programs,
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap()
}

fn documents(read: RuleExpr) -> Table {
    let mut table = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("group".to_owned(), ColumnType::Id),
            ("owner".to_owned(), ColumnType::Principal),
        ]),
        BTreeMap::from([
            (
                "byId".to_owned(),
                Index {
                    components: (vec!["id".to_owned()])
                        .into_iter()
                        .map(snapback3_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byGroup".to_owned(),
                Index {
                    components: (vec!["group".to_owned(), "id".to_owned()])
                        .into_iter()
                        .map(snapback3_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: false,
                },
            ),
        ]),
    );
    table.rules.read = read;
    table
}

fn protected_read() -> RuleExpr {
    RuleExpr::Eq(RuleTerm::Field("owner".to_owned()), RuleTerm::Viewer)
}

fn rule_input_table(read: RuleExpr) -> Table {
    let mut table = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("scope".to_owned(), ColumnType::Id),
            ("principal".to_owned(), ColumnType::Principal),
        ]),
        BTreeMap::from([
            (
                "byId".to_owned(),
                Index {
                    components: (vec!["id".to_owned()])
                        .into_iter()
                        .map(snapback3_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byScopePrincipal".to_owned(),
                Index {
                    components: (vec!["scope".to_owned(), "principal".to_owned()])
                        .into_iter()
                        .map(snapback3_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
        ]),
    );
    table.rules.read = read;
    table
}

#[test]
fn rule_input_visibility_is_structural_exact_and_fails_closed() {
    // @ref LLP 1001#9-schema-additions — target policy, not an authored flag,
    // decides whether the exact indexed rule input may be disclosed.
    let exact_self_read = RuleExpr::Exists {
        table: "memberships".to_owned(),
        index: "byScopePrincipal".to_owned(),
        key: vec![RuleTerm::Field("scope".to_owned()), RuleTerm::Viewer],
        provenance: KeyProvenance::Shape,
    };
    let rules = schema(BTreeMap::from([
        (
            "publicGrants".to_owned(),
            rule_input_table(RuleExpr::Public {
                reason: "fixture grants are public".to_owned(),
            }),
        ),
        ("memberships".to_owned(), rule_input_table(exact_self_read)),
        (
            "protectedGrants".to_owned(),
            rule_input_table(RuleExpr::Eq(
                RuleTerm::Field("principal".to_owned()),
                RuleTerm::Viewer,
            )),
        ),
        ("deniedGrants".to_owned(), rule_input_table(RuleExpr::Deny)),
    ]));
    let exact_key = vec![RuleTerm::Field("scope".to_owned()), RuleTerm::Viewer];
    assert!(rules.rule_input_is_readable("publicGrants", "byScopePrincipal", &exact_key,));
    assert!(rules.rule_input_is_readable("memberships", "byScopePrincipal", &exact_key,));
    assert!(rules.rule_input_is_readable("protectedGrants", "byScopePrincipal", &exact_key,));
    assert!(!rules.rule_input_is_readable(
        "protectedGrants",
        "byScopePrincipal",
        &[
            RuleTerm::Field("scope".to_owned()),
            RuleTerm::Field("target".to_owned()),
        ],
    ));
    assert!(!rules.rule_input_is_readable("deniedGrants", "byScopePrincipal", &exact_key,));
}

fn scan_program(name: &str, table: &str, take: u32) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("group".to_owned(), ArgType::Id)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: name.to_owned(),
            table: table.to_owned(),
            index: "byGroup".to_owned(),
            prefix: (vec![var("group")])
                .into_iter()
                .map(IndexKeyExpr::Scalar)
                .collect(),
            order: Order::Asc,
            take: Bound::Literal(take),
            after: None,
            before: None,
            range: None,
            opaque_cursor: false,
            merge_site: None,
            provenance: KeyProvenance::Arg,
        }))],
    }
}

fn point(site: &str, index: &str) -> Expr {
    Expr::Get(Read {
        site: site.to_owned(),
        table: "documents".to_owned(),
        index: index.to_owned(),
        key: vec![Expr::Literal(Value::Id("key".to_owned()))],
        provenance: KeyProvenance::Const,
    })
}

fn owner_scan(site: &str, prefix: Vec<Expr>) -> Expr {
    Expr::Scan(Scan {
        site: site.to_owned(),
        table: "documents".to_owned(),
        index: "byOwner".to_owned(),
        prefix: prefix
            .into_iter()
            .map(snapback3_core::ir::IndexKeyExpr::Scalar)
            .collect(),
        order: Order::Asc,
        take: Bound::Literal(2),
        after: None,
        before: None,
        range: None,
        opaque_cursor: false,
        merge_site: None,
        provenance: KeyProvenance::Viewer,
    })
}

fn owner_scan_program(
    first_site: &str,
    first_prefix: Vec<Expr>,
    second_site: &str,
    second_prefix: Vec<Expr>,
) -> Program {
    Program {
        name: "documents.ownerCollision".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "narrow".to_owned(),
                value: owner_scan(first_site, first_prefix),
            },
            Stmt::Return(owner_scan(second_site, second_prefix)),
        ],
    }
}

fn owner_scan_schema() -> Schema {
    let mut table = documents(protected_read());
    table.indexes.insert(
        "byOwner".to_owned(),
        Index {
            components: (vec!["owner".to_owned(), "id".to_owned()])
                .into_iter()
                .map(snapback3_core::search_key::IndexComponent::Column)
                .collect(),
            unique: false,
        },
    );
    schema(BTreeMap::from([("documents".to_owned(), table)]))
}

#[test]
fn certificate_refuses_incompatible_duplicate_read_sites_but_aggregates_equal_shapes() {
    let schema = schema(BTreeMap::from([(
        "documents".to_owned(),
        documents(RuleExpr::Public {
            reason: "certificate fixture".to_owned(),
        }),
    )]));
    let program = |second_index: &str| Program {
        name: "documents.collidingReads".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "first".to_owned(),
                value: point("documents.row", "byId"),
            },
            Stmt::Return(point("documents.row", second_index)),
        ],
    };

    let error = Checker::new(&schema, Ceilings::default())
        .check(&program("byGroup"))
        .unwrap_err();
    assert_eq!(error.code, "E_TRACE_SUBSET");
    assert!(error.message.contains("documents.row"), "{error:?}");

    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program("byId"))
        .unwrap();
    assert_eq!(certificate.read_sites.len(), 1);
    assert_eq!(certificate.read_sites[0].max_calls, 2);
}

#[test]
fn duplicate_scan_site_cannot_reuse_a_hoist_for_a_broader_prefix() {
    // Raw IR used to give these scans the same partial identity because their
    // table/index/take/provenance agree. Summary then retained the first
    // scan's uniform-rule hoist for the empty-prefix scan, which could admit
    // rows owned by another principal after probing one viewer-owned row.
    let schema = owner_scan_schema();
    let viewer_prefix = vec![Expr::Input(Input::Viewer)];
    let collision = owner_scan_program(
        "documents.byOwner",
        viewer_prefix.clone(),
        "documents.byOwner",
        Vec::new(),
    );
    let project = ProjectJson {
        version: 1,
        schema: schema.clone(),
        programs: vec![collision],
        effects: Vec::new(),
        auth: Auth::default(),
    };
    let errors = Generation::certify(&project, Ceilings::default()).unwrap_err();
    assert!(
        errors.iter().any(|(program, error)| {
            program == "documents.ownerCollision"
                && error.code == "E_TRACE_SUBSET"
                && error.message.contains("documents.byOwner")
        }),
        "{errors:#?}"
    );

    // Equal prefix widths are not enough either: the full access expression
    // is part of the site identity.
    let same_width_collision = owner_scan_program(
        "documents.byOwner",
        viewer_prefix.clone(),
        "documents.byOwner",
        vec![Expr::Literal(Value::Id("a-viewer".to_owned()))],
    );
    let error = Checker::new(&schema, Ceilings::default())
        .check(&same_width_collision)
        .unwrap_err();
    assert_eq!(error.code, "E_TRACE_SUBSET");

    // Repeating one exact access remains valid and aggregates its call meter.
    let identical = owner_scan_program(
        "documents.byOwner",
        viewer_prefix.clone(),
        "documents.byOwner",
        viewer_prefix.clone(),
    );
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&identical)
        .unwrap();
    assert_eq!(certificate.read_sites.len(), 1);
    assert_eq!(certificate.read_sites[0].max_calls, 2);
    assert!(certificate.read_sites[0].hoist);

    // Distinct labels preserve both shapes. The runtime therefore filters the
    // broad scan per row even when its first indexed candidate is visible.
    let distinct = owner_scan_program(
        "documents.viewerOwner",
        viewer_prefix,
        "documents.allOwners",
        Vec::new(),
    );
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&distinct)
        .unwrap();
    assert!(
        certificate
            .read_sites
            .iter()
            .find(|site| site.site == "documents.viewerOwner")
            .unwrap()
            .hoist
    );
    assert!(
        !certificate
            .read_sites
            .iter()
            .find(|site| site.site == "documents.allOwners")
            .unwrap()
            .hoist
    );
    let mut runtime =
        Runtime::open(Store::memory().unwrap(), generation(schema, vec![distinct])).unwrap();
    let visible = document("visible", "group", "a-viewer");
    runtime
        .seed(&[
            ("documents".to_owned(), visible.clone()),
            (
                "documents".to_owned(),
                document("hidden", "group", "z-other"),
            ),
        ])
        .unwrap();
    let execution = runtime
        .execute(
            "documents.ownerCollision",
            Context::query(actor("a-viewer"), BTreeMap::new()),
        )
        .unwrap();
    assert_eq!(execution.result, Value::Array(vec![visible]));
    assert_eq!(execution.trace.ranges.len(), 2);
    assert_eq!(execution.trace.ranges[0].site, "documents.viewerOwner");
    assert_eq!(execution.trace.ranges[1].site, "documents.allOwners");
    assert_eq!(execution.trace.ranges[1].examined_ids.len(), 2);
    assert_eq!(execution.trace.ranges[1].visible_ids, vec!["visible"]);
}

fn document(id: &str, group: &str, owner: &str) -> Value {
    object([
        ("id", Value::Id(id.to_owned())),
        ("group", Value::Id(group.to_owned())),
        ("owner", Value::Id(owner.to_owned())),
    ])
}

fn group_context(group: &str) -> Context {
    Context::query(
        actor("viewer"),
        BTreeMap::from([("group".to_owned(), Value::Id(group.to_owned()))]),
    )
}

#[test]
fn protected_nonuniform_scan_hides_empty_vs_hidden_occupancy_in_opaque_state() {
    // @ref LLP 1001#3-read-and-write-states-no-silent-states — production state cannot
    // distinguish an empty protected partition from one occupied only by hidden rows.
    let query = scan_program("documents.first", "documents", 1);
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(
            schema(BTreeMap::from([(
                "documents".to_owned(),
                documents(protected_read()),
            )])),
            vec![query],
        ),
    )
    .unwrap();
    runtime
        .seed(&[
            (
                "documents".to_owned(),
                document("hidden-1", "occupied", "someone-else"),
            ),
            (
                "documents".to_owned(),
                document("hidden-2", "occupied", "someone-else"),
            ),
        ])
        .unwrap();

    let empty = runtime
        .execute("documents.first", group_context("empty"))
        .unwrap();
    let hidden = runtime
        .execute("documents.first", group_context("occupied"))
        .unwrap();

    assert_eq!(empty.result, Value::Array(Vec::new()));
    assert_eq!(hidden.result, Value::Array(Vec::new()));
    assert_eq!(empty.trace.ranges[0].stop, StopReason::Exhausted);
    assert!(empty.trace.ranges[0].examined_ids.is_empty());
    assert_eq!(hidden.trace.ranges[0].stop, StopReason::Exhausted);
    assert!(!hidden.trace.ranges[0].examined_ids.is_empty());
    assert!(hidden.trace.ranges[0].visible_ids.is_empty());

    let opaque = ExecutionState::Capped;
    assert_eq!(empty.state, opaque);
    assert_eq!(hidden.state, opaque);
    let public_empty = serde_json::to_value(&empty.state).unwrap();
    let public_hidden = serde_json::to_value(&hidden.state).unwrap();
    assert_eq!(public_empty, serde_json::json!({ "state": "capped" }));
    assert_eq!(public_hidden, public_empty);
    assert!(public_hidden.get("site").is_none());
    assert!(public_hidden.get("take").is_none());
}

#[test]
fn later_nonuniform_scan_makes_an_earlier_detailed_cap_opaque() {
    // A detailed cap from a public range must not win merely because it was
    // recorded before a protected, non-uniform range in the same execution.
    // @ref LLP 1001#3-read-and-write-states-no-silent-states — one hidden dependency
    // makes the production disclosure opaque for the whole query.
    let program = Program {
        name: "documents.mixed".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "publicPage".to_owned(),
                value: Expr::Scan(Scan {
                    site: "documents.publicFirst".to_owned(),
                    table: "publicDocuments".to_owned(),
                    index: "byGroup".to_owned(),
                    prefix: (vec![Expr::Literal(Value::Id("group".to_owned()))])
                        .into_iter()
                        .map(IndexKeyExpr::Scalar)
                        .collect(),
                    order: Order::Asc,
                    take: Bound::Literal(1),
                    after: None,
                    before: None,
                    range: None,
                    opaque_cursor: false,
                    merge_site: None,
                    provenance: KeyProvenance::Const,
                }),
            },
            Stmt::Return(Expr::Scan(Scan {
                site: "documents.protectedLater".to_owned(),
                table: "protectedDocuments".to_owned(),
                index: "byGroup".to_owned(),
                prefix: (vec![Expr::Literal(Value::Id("group".to_owned()))])
                    .into_iter()
                    .map(IndexKeyExpr::Scalar)
                    .collect(),
                order: Order::Asc,
                take: Bound::Literal(1),
                after: None,
                before: None,
                range: None,
                opaque_cursor: false,
                merge_site: None,
                provenance: KeyProvenance::Const,
            })),
        ],
    };
    let public = RuleExpr::Public {
        reason: "fixture is public".to_owned(),
    };
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(
            schema(BTreeMap::from([
                ("publicDocuments".to_owned(), documents(public)),
                ("protectedDocuments".to_owned(), documents(protected_read())),
            ])),
            vec![program],
        ),
    )
    .unwrap();
    runtime
        .seed(&[
            (
                "publicDocuments".to_owned(),
                document("public-1", "group", "viewer"),
            ),
            (
                "publicDocuments".to_owned(),
                document("public-2", "group", "viewer"),
            ),
            (
                "protectedDocuments".to_owned(),
                document("hidden-1", "group", "someone-else"),
            ),
            (
                "protectedDocuments".to_owned(),
                document("hidden-2", "group", "someone-else"),
            ),
        ])
        .unwrap();

    let execution = runtime
        .execute(
            "documents.mixed",
            Context::query(actor("viewer"), BTreeMap::new()),
        )
        .unwrap();

    assert_eq!(execution.trace.ranges.len(), 2);
    assert_eq!(execution.trace.ranges[0].site, "documents.publicFirst");
    assert_eq!(execution.trace.ranges[0].stop, StopReason::Limit);
    assert!(!execution.trace.ranges[0].visible_ids.is_empty());
    assert_eq!(execution.trace.ranges[1].site, "documents.protectedLater");
    assert_eq!(execution.trace.ranges[1].stop, StopReason::Exhausted);
    assert!(execution.trace.ranges[1].visible_ids.is_empty());
    assert_eq!(execution.state, ExecutionState::Capped);
    assert_eq!(
        serde_json::to_value(&execution.state).unwrap(),
        serde_json::json!({ "state": "capped" })
    );
}

fn get_program(name: &str, table: &str) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("id".to_owned(), ArgType::Id)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: name.to_owned(),
            table: table.to_owned(),
            index: "byId".to_owned(),
            key: vec![var("id")],
            provenance: KeyProvenance::Arg,
        }))],
    }
}

fn required_get_program(name: &str, table: &str) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("id".to_owned(), ArgType::Id)]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "document".to_owned(),
                value: Expr::Get(Read {
                    site: name.to_owned(),
                    table: table.to_owned(),
                    index: "byId".to_owned(),
                    key: vec![var("id")],
                    provenance: KeyProvenance::Arg,
                }),
            },
            Stmt::Require {
                site: None,
                condition: Expr::Binary {
                    op: BinaryOp::Ne,
                    left: Box::new(var("document")),
                    right: Box::new(Expr::Literal(Value::Null)),
                },
                code: "POLICY_DENIED".to_owned(),
            },
            Stmt::Return(var("document")),
        ],
    }
}

fn id_context(id: &str) -> Context {
    Context::query(
        actor("viewer"),
        BTreeMap::from([("id".to_owned(), Value::Id(id.to_owned()))]),
    )
}

#[test]
fn successor_rebinds_named_handle_and_rejects_predecessor_certificate() {
    // @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — a predecessor program
    // handle must use the active policy, and its captured certificate cannot run.
    let query = required_get_program("documents.get", "documents");
    let base_schema = schema(BTreeMap::from([(
        "documents".to_owned(),
        documents(RuleExpr::Public {
            reason: "initially visible".to_owned(),
        }),
    )]));
    let base = generation(base_schema, vec![query.clone()]);
    let (stale_program, stale_certificate) = base
        .programs()
        .get("documents.get")
        .expect("base query was certified")
        .clone();
    let handle = stale_program.name.clone();
    let mut runtime = Runtime::open(Store::memory().unwrap(), base).unwrap();
    runtime
        .seed(&[(
            "documents".to_owned(),
            document("document-1", "group", "viewer"),
        )])
        .unwrap();
    assert_eq!(
        runtime
            .execute(&handle, id_context("document-1"))
            .unwrap()
            .state,
        ExecutionState::Complete
    );

    let next_schema = schema(BTreeMap::from([(
        "documents".to_owned(),
        documents(RuleExpr::Deny),
    )]));
    let next = generation(next_schema.clone(), vec![query]);
    runtime.apply_successor(next).unwrap();

    let current = runtime.execute(&handle, id_context("document-1")).unwrap();
    assert_eq!(
        current.state,
        ExecutionState::Denied {
            rule: "POLICY_DENIED".to_owned(),
        }
    );
    assert_eq!(current.result, Value::Null);
    assert_ne!(stale_certificate.schema_hash, next_schema.hash());

    let mut successor_engine = Engine::memory(next_schema).unwrap();
    let refusal = successor_engine
        .execute(&stale_program, &stale_certificate, id_context("document-1"))
        .unwrap_err();
    assert!(matches!(
        refusal,
        RuntimeError::TraceSubset(ref reason) if reason == "schema hash mismatch"
    ));
}

fn grant_table() -> Table {
    let mut table = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("scope".to_owned(), ColumnType::Id),
            ("principal".to_owned(), ColumnType::Principal),
            (
                "role".to_owned(),
                ColumnType::Enum {
                    variants: vec!["member".to_owned(), "admin".to_owned()],
                },
            ),
        ]),
        BTreeMap::from([
            (
                "byId".to_owned(),
                Index {
                    components: (vec!["id".to_owned()])
                        .into_iter()
                        .map(snapback3_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byScopePrincipal".to_owned(),
                Index {
                    components: (vec!["scope".to_owned(), "principal".to_owned()])
                        .into_iter()
                        .map(snapback3_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
        ]),
    );
    table.constraints = vec![
        Constraint::Unique {
            index: "byScopePrincipal".to_owned(),
        },
        Constraint::Immutable {
            fields: vec!["scope".to_owned(), "principal".to_owned()],
        },
    ];
    table
}

fn create_grant_program() -> Program {
    Program {
        name: "grants.create".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("scope".to_owned(), ArgType::Id),
            ("principal".to_owned(), ArgType::Principal),
        ]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "grantId".to_owned(),
                value: Expr::Input(Input::NewId),
            },
            Stmt::Insert {
                table: "grants".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), var("grantId")),
                    ("scope".to_owned(), var("scope")),
                    ("principal".to_owned(), var("principal")),
                    (
                        "role".to_owned(),
                        Expr::Literal(Value::String("member".to_owned())),
                    ),
                ])),
            },
            Stmt::Return(var("grantId")),
        ],
    }
}

fn grant_handle_program(name: &str, statement: Stmt) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("grantId".to_owned(), ArgType::Id)]),
        read_time_granularity_ms: None,
        body: vec![statement, Stmt::Return(Expr::Literal(Value::Null))],
    }
}

fn grant_args() -> BTreeMap<String, Value> {
    BTreeMap::from([
        ("scope".to_owned(), Value::Id("scope-1".to_owned())),
        ("principal".to_owned(), Value::Id("principal-1".to_owned())),
    ])
}

fn grant_handle_args(id: &str) -> BTreeMap<String, Value> {
    BTreeMap::from([("grantId".to_owned(), Value::Id(id.to_owned()))])
}

fn create_context(id: &str) -> Context {
    let mut context = Context::mutation(actor("admin"), grant_args());
    context.new_ids = VecDeque::from([id.to_owned()]);
    context
}

fn grant_role(runtime: &mut Runtime, id: &str) -> Option<String> {
    let execution = runtime.execute("grants.get", id_context(id)).unwrap();
    execution
        .result
        .field("role")
        .ok()
        .and_then(|value| value.as_str().ok())
        .map(ToOwned::to_owned)
}

#[test]
fn stale_grant_row_handle_cannot_hit_remove_then_recreate_incarnation() {
    // @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — a queued grant intent
    // binds the immutable row id, not the logical scope/principal pair.
    let create = create_grant_program();
    let promote = grant_handle_program(
        "grants.promote",
        Stmt::Update {
            table: "grants".to_owned(),
            key: var("grantId"),
            patch: Expr::Literal(object([("role", Value::String("admin".to_owned()))])),
        },
    );
    let remove = grant_handle_program(
        "grants.remove",
        Stmt::Delete {
            table: "grants".to_owned(),
            key: var("grantId"),
        },
    );
    let get = get_program("grants.get", "grants");
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(
            schema(BTreeMap::from([("grants".to_owned(), grant_table())])),
            vec![create, promote, remove, get],
        ),
    )
    .unwrap();

    let first = runtime
        .execute("grants.create", create_context("grant-v1"))
        .unwrap();
    assert_eq!(first.result, Value::Id("grant-v1".to_owned()));
    runtime
        .execute(
            "grants.remove",
            Context::mutation(actor("admin"), grant_handle_args("grant-v1")),
        )
        .unwrap();
    let second = runtime
        .execute("grants.create", create_context("grant-v2"))
        .unwrap();
    assert_eq!(second.result, Value::Id("grant-v2".to_owned()));
    assert_eq!(
        grant_role(&mut runtime, "grant-v2").as_deref(),
        Some("member")
    );

    let stale_promote = runtime
        .execute(
            "grants.promote",
            Context::mutation(actor("admin"), grant_handle_args("grant-v1")),
        )
        .unwrap();
    assert!(matches!(
        stale_promote.state,
        ExecutionState::Rejected { ref code, .. } if code == "NOT_FOUND"
    ));
    assert_eq!(
        grant_role(&mut runtime, "grant-v2").as_deref(),
        Some("member")
    );

    let stale_remove = runtime
        .execute(
            "grants.remove",
            Context::mutation(actor("admin"), grant_handle_args("grant-v1")),
        )
        .unwrap();
    assert!(matches!(
        stale_remove.state,
        ExecutionState::Rejected { ref code, .. } if code == "NOT_FOUND"
    ));
    assert_eq!(
        grant_role(&mut runtime, "grant-v2").as_deref(),
        Some("member")
    );

    let current_promote = runtime
        .execute(
            "grants.promote",
            Context::mutation(actor("admin"), grant_handle_args("grant-v2")),
        )
        .unwrap();
    assert!(matches!(
        current_promote.state,
        ExecutionState::Committed { .. }
    ));
    assert_eq!(
        grant_role(&mut runtime, "grant-v2").as_deref(),
        Some("admin")
    );
}
