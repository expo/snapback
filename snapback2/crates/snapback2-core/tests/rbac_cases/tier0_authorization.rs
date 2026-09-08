use snapback2_core::*;
use std::collections::BTreeMap;

const ADMIN: &str = "admin";
const MEMBER: &str = "member";

fn role(value: &str) -> RuleTerm {
    RuleTerm::Literal(Value::String(value.to_owned()))
}

fn groups_table() -> Table {
    let mut table = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("creator".to_owned(), ColumnType::Principal),
        ]),
        BTreeMap::from([(
            "byId".to_owned(),
            Index {
                components: (vec!["id".to_owned()])
                    .into_iter()
                    .map(snapback2_core::search_key::IndexComponent::Column)
                    .collect(),
                unique: true,
            },
        )]),
    );
    table.rules.insert = RuleExpr::Eq(RuleTerm::Field("creator".to_owned()), RuleTerm::Viewer);
    table.rules.update = RuleExpr::Deny;
    table.rules.delete = RuleExpr::Deny;
    table.constraints.push(Constraint::FinalExistsOnInsert {
        table: "memberships".to_owned(),
        index: "byGroupPrincipalRole".to_owned(),
        key: vec![
            RuleTerm::Field("id".to_owned()),
            RuleTerm::Field("creator".to_owned()),
            role(ADMIN),
        ],
    });
    table
}

fn memberships_table() -> Table {
    let mut table = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            (
                "group".to_owned(),
                ColumnType::Ref {
                    table: "groups".to_owned(),
                },
            ),
            ("principal".to_owned(), ColumnType::Principal),
            (
                "role".to_owned(),
                ColumnType::Enum {
                    variants: vec![MEMBER.to_owned(), ADMIN.to_owned()],
                },
            ),
        ]),
        BTreeMap::from([
            (
                "byId".to_owned(),
                Index {
                    components: (vec!["id".to_owned()])
                        .into_iter()
                        .map(snapback2_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byGroupPrincipal".to_owned(),
                Index {
                    components: (vec!["group".to_owned(), "principal".to_owned()])
                        .into_iter()
                        .map(snapback2_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byGroupPrincipalRole".to_owned(),
                Index {
                    components: (vec![
                        "group".to_owned(),
                        "principal".to_owned(),
                        "role".to_owned(),
                    ])
                    .into_iter()
                    .map(snapback2_core::search_key::IndexComponent::Column)
                    .collect(),
                    unique: true,
                },
            ),
        ]),
    );
    let viewer_is_current_admin = |group: RuleTerm| RuleExpr::Exists {
        table: "memberships".to_owned(),
        index: "byGroupPrincipalRole".to_owned(),
        key: vec![group, RuleTerm::Viewer, role(ADMIN)],
        provenance: KeyProvenance::Shape,
    };
    table.rules.insert = RuleExpr::Or(vec![
        RuleExpr::And(vec![
            RuleExpr::Eq(RuleTerm::Field("principal".to_owned()), RuleTerm::Viewer),
            RuleExpr::Eq(RuleTerm::Field("role".to_owned()), role(ADMIN)),
            RuleExpr::Created {
                table: "groups".to_owned(),
                index: "byId".to_owned(),
                key: vec![RuleTerm::Field("group".to_owned())],
                provenance: KeyProvenance::Shape,
            },
        ]),
        viewer_is_current_admin(RuleTerm::Field("group".to_owned())),
    ]);
    table.rules.update = RuleExpr::And(vec![
        viewer_is_current_admin(RuleTerm::OldField("group".to_owned())),
        RuleExpr::Eq(RuleTerm::OldField("role".to_owned()), role(MEMBER)),
        RuleExpr::Eq(RuleTerm::Field("role".to_owned()), role(ADMIN)),
        RuleExpr::Eq(
            RuleTerm::OldField("group".to_owned()),
            RuleTerm::NextField("group".to_owned()),
        ),
        RuleExpr::Eq(
            RuleTerm::OldField("principal".to_owned()),
            RuleTerm::NextField("principal".to_owned()),
        ),
    ]);
    table.rules.delete = RuleExpr::Or(vec![
        RuleExpr::Eq(RuleTerm::Field("principal".to_owned()), RuleTerm::Viewer),
        viewer_is_current_admin(RuleTerm::Field("group".to_owned())),
    ]);
    table.constraints.push(Constraint::Unique {
        index: "byGroupPrincipal".to_owned(),
    });
    table
}

fn schema() -> Schema {
    Schema {
        schedules: Vec::new(),
        tables: BTreeMap::from([
            ("groups".to_owned(), groups_table()),
            ("memberships".to_owned(), memberships_table()),
        ]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    }
}

fn program(name: &str, args: BTreeMap<String, ArgType>, body: Vec<Stmt>) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Mutation,
        args,
        read_time_granularity_ms: None,
        body,
    }
}

fn bootstrap_program() -> Program {
    program(
        "groups.bootstrap",
        BTreeMap::from([
            ("group".to_owned(), ArgType::Id),
            ("seat".to_owned(), ArgType::Id),
        ]),
        vec![
            Stmt::Insert {
                table: "groups".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), var("group")),
                    ("creator".to_owned(), Expr::Input(Input::Viewer)),
                ])),
            },
            Stmt::Insert {
                table: "memberships".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), var("seat")),
                    ("group".to_owned(), var("group")),
                    ("principal".to_owned(), Expr::Input(Input::Viewer)),
                    (
                        "role".to_owned(),
                        Expr::Literal(Value::String(ADMIN.to_owned())),
                    ),
                ])),
            },
        ],
    )
}

fn group_only_program(name: &str, upsert: bool) -> Program {
    let row = Expr::Object(BTreeMap::from([
        ("id".to_owned(), var("group")),
        ("creator".to_owned(), Expr::Input(Input::Viewer)),
    ]));
    let statement = if upsert {
        Stmt::Upsert {
            table: "groups".to_owned(),
            key: var("group"),
            row,
        }
    } else {
        Stmt::Insert {
            table: "groups".to_owned(),
            row,
        }
    };
    program(
        name,
        BTreeMap::from([("group".to_owned(), ArgType::Id)]),
        vec![statement],
    )
}

fn add_member_program(self_admin: bool) -> Program {
    let (name, args, principal, membership_role) = if self_admin {
        (
            "memberships.selfAdmin",
            BTreeMap::from([
                ("id".to_owned(), ArgType::Id),
                (
                    "group".to_owned(),
                    ArgType::Ref {
                        table: "groups".to_owned(),
                    },
                ),
            ]),
            Expr::Input(Input::Viewer),
            ADMIN,
        )
    } else {
        (
            "memberships.addMember",
            BTreeMap::from([
                ("id".to_owned(), ArgType::Id),
                (
                    "group".to_owned(),
                    ArgType::Ref {
                        table: "groups".to_owned(),
                    },
                ),
                ("principal".to_owned(), ArgType::Principal),
            ]),
            var("principal"),
            MEMBER,
        )
    };
    program(
        name,
        args,
        vec![Stmt::Insert {
            table: "memberships".to_owned(),
            row: Expr::Object(BTreeMap::from([
                ("id".to_owned(), var("id")),
                ("group".to_owned(), var("group")),
                ("principal".to_owned(), principal),
                (
                    "role".to_owned(),
                    Expr::Literal(Value::String(membership_role.to_owned())),
                ),
            ])),
        }],
    )
}

fn promote_program(cross_scope: bool) -> Program {
    let mut patch = BTreeMap::from([(
        "role".to_owned(),
        Expr::Literal(Value::String(ADMIN.to_owned())),
    )]);
    let mut args = BTreeMap::from([("id".to_owned(), ArgType::Id)]);
    let name = if cross_scope {
        patch.insert("group".to_owned(), var("group"));
        args.insert(
            "group".to_owned(),
            ArgType::Ref {
                table: "groups".to_owned(),
            },
        );
        "memberships.moveAndPromote"
    } else {
        "memberships.promote"
    };
    program(
        name,
        args,
        vec![Stmt::Update {
            table: "memberships".to_owned(),
            key: var("id"),
            patch: Expr::Object(patch),
        }],
    )
}

fn leave_program() -> Program {
    program(
        "memberships.leave",
        BTreeMap::from([("id".to_owned(), ArgType::Id)]),
        vec![Stmt::Delete {
            table: "memberships".to_owned(),
            key: var("id"),
        }],
    )
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

fn programs() -> Vec<Program> {
    vec![
        bootstrap_program(),
        group_only_program("groups.only", false),
        group_only_program("groups.upsertOnly", true),
        add_member_program(false),
        add_member_program(true),
        promote_program(false),
        promote_program(true),
        leave_program(),
        get_program("groups.get", "groups"),
        get_program("memberships.get", "memberships"),
    ]
}

fn project(schema: Schema, programs: Vec<Program>) -> ProjectJson {
    ProjectJson {
        version: 1,
        schema,
        programs,
        effects: Vec::new(),
        auth: Auth::default(),
    }
}

fn generation() -> Generation {
    Generation::certify(&project(schema(), programs()), Ceilings::default()).unwrap()
}

fn runtime() -> Runtime {
    Runtime::open(Store::memory().unwrap(), generation()).unwrap()
}

fn id(value: &str) -> Value {
    Value::Id(value.to_owned())
}

fn actor(value: &str) -> Actor {
    Actor::user(value).unwrap()
}

fn mutation(viewer: &str, args: impl IntoIterator<Item = (&'static str, Value)>) -> Context {
    Context::mutation(
        actor(viewer),
        args.into_iter()
            .map(|(name, value)| (name.to_owned(), value))
            .collect(),
    )
}

fn query(viewer: &str, row_id: &str) -> Context {
    Context::query(
        actor(viewer),
        BTreeMap::from([("id".to_owned(), id(row_id))]),
    )
}

fn assert_committed(execution: &Execution) {
    assert!(
        matches!(execution.state, ExecutionState::Committed { .. }),
        "unexpected execution: {execution:#?}"
    );
}

fn assert_rejected(execution: &Execution, code: &str) {
    assert!(
        matches!(&execution.state, ExecutionState::Rejected { code: actual, .. } if actual == code),
        "unexpected execution: {execution:#?}"
    );
}

fn get(runtime: &mut Runtime, op: &str, viewer: &str, row_id: &str) -> Value {
    runtime.execute(op, query(viewer, row_id)).unwrap().result
}

fn bootstrap(runtime: &mut Runtime, viewer: &str, group: &str, seat: &str) {
    let execution = runtime
        .execute(
            "groups.bootstrap",
            mutation(viewer, [("group", id(group)), ("seat", id(seat))]),
        )
        .unwrap();
    assert_committed(&execution);
}

fn add_member(runtime: &mut Runtime, viewer: &str, membership: &str, group: &str, principal: &str) {
    let execution = runtime
        .execute(
            "memberships.addMember",
            mutation(
                viewer,
                [
                    ("id", id(membership)),
                    ("group", id(group)),
                    ("principal", id(principal)),
                ],
            ),
        )
        .unwrap();
    assert_committed(&execution);
}

#[test]
fn update_policy_relates_old_and_next_once_and_blocks_self_promotion_and_scope_moves() {
    let mut runtime = runtime();
    bootstrap(&mut runtime, "alice", "group-a", "alice-a");
    bootstrap(&mut runtime, "alice", "group-b", "alice-b");
    add_member(&mut runtime, "alice", "bob-a", "group-a", "bob");

    let self_promotion = runtime
        .execute(
            "memberships.promote",
            mutation("bob", [("id", id("bob-a"))]),
        )
        .unwrap();
    assert_rejected(&self_promotion, "E_RULE");
    assert_eq!(
        get(&mut runtime, "memberships.get", "alice", "bob-a")
            .field("role")
            .unwrap(),
        &Value::String(MEMBER.to_owned())
    );

    let promotion = runtime
        .execute(
            "memberships.promote",
            mutation("alice", [("id", id("bob-a"))]),
        )
        .unwrap();
    assert_committed(&promotion);
    assert_eq!(promotion.trace.rule_probes, 1);
    assert_eq!(
        get(&mut runtime, "memberships.get", "alice", "bob-a")
            .field("role")
            .unwrap(),
        &Value::String(ADMIN.to_owned())
    );

    let repeated = runtime
        .execute(
            "memberships.promote",
            mutation("alice", [("id", id("bob-a"))]),
        )
        .unwrap();
    assert_rejected(&repeated, "E_RULE");

    add_member(&mut runtime, "alice", "carol-a", "group-a", "carol");
    let cross_scope = runtime
        .execute(
            "memberships.moveAndPromote",
            mutation("alice", [("id", id("carol-a")), ("group", id("group-b"))]),
        )
        .unwrap();
    assert_rejected(&cross_scope, "E_RULE");
    let carol = get(&mut runtime, "memberships.get", "alice", "carol-a");
    assert_eq!(carol.field("group").unwrap(), &id("group-a"));
    assert_eq!(
        carol.field("role").unwrap(),
        &Value::String(MEMBER.to_owned())
    );
}

#[test]
fn bootstrap_requires_created_scope_and_final_creator_seat_without_half_commits() {
    let mut runtime = runtime();
    bootstrap(&mut runtime, "alice", "new-group", "alice-seat");
    assert_ne!(
        get(&mut runtime, "groups.get", "alice", "new-group"),
        Value::Null
    );
    let seat = get(&mut runtime, "memberships.get", "alice", "alice-seat");
    assert_eq!(seat.field("principal").unwrap(), &id("alice"));
    assert_eq!(
        seat.field("role").unwrap(),
        &Value::String(ADMIN.to_owned())
    );

    let before = runtime.store().commit_seq().unwrap();
    let missing = runtime
        .execute(
            "groups.only",
            mutation("charlie", [("group", id("missing-seat"))]),
        )
        .unwrap();
    assert_rejected(&missing, "E_CONSTRAINT");
    assert_eq!(runtime.store().commit_seq().unwrap(), before);
    assert_eq!(
        get(&mut runtime, "groups.get", "charlie", "missing-seat"),
        Value::Null
    );

    let missing_upsert = runtime
        .execute(
            "groups.upsertOnly",
            mutation("charlie", [("group", id("missing-upsert-seat"))]),
        )
        .unwrap();
    assert_rejected(&missing_upsert, "E_CONSTRAINT");
    assert_eq!(
        get(&mut runtime, "groups.get", "charlie", "missing-upsert-seat",),
        Value::Null
    );

    let old_scope = runtime
        .execute(
            "memberships.selfAdmin",
            mutation(
                "outsider",
                [("id", id("outsider-seat")), ("group", id("new-group"))],
            ),
        )
        .unwrap();
    assert_rejected(&old_scope, "E_RULE");
    assert_eq!(
        get(&mut runtime, "memberships.get", "alice", "outsider-seat",),
        Value::Null
    );

    let leave = runtime
        .execute(
            "memberships.leave",
            mutation("alice", [("id", id("alice-seat"))]),
        )
        .unwrap();
    assert_committed(&leave);
    let reseat = runtime
        .execute(
            "memberships.selfAdmin",
            mutation(
                "alice",
                [("id", id("alice-reseat")), ("group", id("new-group"))],
            ),
        )
        .unwrap();
    assert_rejected(&reseat, "E_RULE");
    assert_eq!(
        get(&mut runtime, "memberships.get", "alice", "alice-reseat",),
        Value::Null
    );
}

#[test]
fn final_exists_binds_seed_and_certificates_for_insert_and_upsert_writers() {
    let generation = generation();
    for op in ["groups.only", "groups.upsertOnly"] {
        let certificate = &generation.programs().get(op).unwrap().1;
        assert_eq!(certificate.max_rule_probes, 1, "{op}");
        assert!(
            certificate
                .indexes_required
                .contains(&"memberships.byGroupPrincipalRole".to_owned()),
            "{op}: {certificate:#?}"
        );
        assert!(certificate.constraint_checks.iter().any(|check| {
            check.starts_with(
                "memberships:FinalExistsOnInsert(groups->memberships.byGroupPrincipalRole",
            )
        }));
    }
    let bootstrap = &generation.programs().get("groups.bootstrap").unwrap().1;
    assert_eq!(bootstrap.max_rule_probes, 3);
    assert!(
        bootstrap
            .indexes_required
            .contains(&"groups.byId".to_owned())
    );

    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let group = object([("id", id("seed-group")), ("creator", id("seed-owner"))]);
    let error = runtime
        .seed(&[("groups".to_owned(), group.clone())])
        .unwrap_err();
    assert!(matches!(error, RuntimeError::Constraint(_)), "{error:#?}");
    assert_eq!(
        get(&mut runtime, "groups.get", "seed-owner", "seed-group"),
        Value::Null
    );

    runtime
        .seed(&[
            ("groups".to_owned(), group),
            (
                "memberships".to_owned(),
                object([
                    ("id", id("seed-seat")),
                    ("group", id("seed-group")),
                    ("principal", id("seed-owner")),
                    ("role", Value::String(ADMIN.to_owned())),
                ]),
            ),
        ])
        .unwrap();
    assert_ne!(
        get(&mut runtime, "groups.get", "seed-owner", "seed-group"),
        Value::Null
    );
}

#[test]
fn created_and_final_exists_bind_program_triggered_maintained_inserts() {
    let events = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("bucket".to_owned(), ColumnType::Id),
        ]),
        BTreeMap::from([(
            "byId".to_owned(),
            Index {
                components: (vec!["id".to_owned()])
                    .into_iter()
                    .map(snapback2_core::search_key::IndexComponent::Column)
                    .collect(),
                unique: true,
            },
        )]),
    );
    let mut counts = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("bucket".to_owned(), ColumnType::Id),
            ("value".to_owned(), ColumnType::Int),
        ]),
        BTreeMap::from([
            (
                "byId".to_owned(),
                Index {
                    components: (vec!["id".to_owned()])
                        .into_iter()
                        .map(snapback2_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byBucket".to_owned(),
                Index {
                    components: (vec!["bucket".to_owned()])
                        .into_iter()
                        .map(snapback2_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: false,
                },
            ),
        ]),
    );
    counts.constraints.push(Constraint::FinalExistsOnInsert {
        table: "guards".to_owned(),
        index: "byBucket".to_owned(),
        key: vec![RuleTerm::Field("bucket".to_owned())],
    });
    let guards = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("bucket".to_owned(), ColumnType::Id),
        ]),
        BTreeMap::from([
            (
                "byId".to_owned(),
                Index {
                    components: (vec!["id".to_owned()])
                        .into_iter()
                        .map(snapback2_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byBucket".to_owned(),
                Index {
                    components: (vec!["bucket".to_owned()])
                        .into_iter()
                        .map(snapback2_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
        ]),
    );
    let mut claims = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("bucket".to_owned(), ColumnType::Id),
        ]),
        BTreeMap::from([(
            "byId".to_owned(),
            Index {
                components: (vec!["id".to_owned()])
                    .into_iter()
                    .map(snapback2_core::search_key::IndexComponent::Column)
                    .collect(),
                unique: true,
            },
        )]),
    );
    claims.rules.insert = RuleExpr::Created {
        table: "counts".to_owned(),
        index: "byBucket".to_owned(),
        key: vec![RuleTerm::Field("bucket".to_owned())],
        provenance: KeyProvenance::Shape,
    };
    let schema = Schema {
        schedules: Vec::new(),
        tables: BTreeMap::from([
            ("events".to_owned(), events),
            ("counts".to_owned(), counts),
            ("guards".to_owned(), guards),
            ("claims".to_owned(), claims),
        ]),
        maintains: vec![Maintain {
            kind: MaintainKind::Count,
            source: "events".to_owned(),
            by: vec!["bucket".to_owned()],
            target: "counts".to_owned(),
            readable: None,
        }],
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    };
    let insert = program(
        "events.insert",
        BTreeMap::from([
            ("id".to_owned(), ArgType::Id),
            ("bucket".to_owned(), ArgType::Id),
        ]),
        vec![
            Stmt::Insert {
                table: "events".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), var("id")),
                    ("bucket".to_owned(), var("bucket")),
                ])),
            },
            Stmt::Insert {
                table: "claims".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), var("id")),
                    ("bucket".to_owned(), var("bucket")),
                ])),
            },
        ],
    );
    let generation =
        Generation::certify(&project(schema, vec![insert]), Ceilings::default()).unwrap();
    let certificate = &generation.programs().get("events.insert").unwrap().1;
    assert_eq!(certificate.max_rule_probes, 2);
    assert!(
        certificate
            .indexes_required
            .contains(&"guards.byBucket".to_owned())
    );
    assert!(
        certificate
            .indexes_required
            .contains(&"counts.byBucket".to_owned())
    );
    assert!(
        certificate.constraint_checks.iter().any(|check| {
            check.starts_with("guards:FinalExistsOnInsert(counts->guards.byBucket")
        })
    );

    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let rejected = runtime
        .execute(
            "events.insert",
            mutation("alice", [("id", id("event-1")), ("bucket", id("bucket-1"))]),
        )
        .unwrap();
    assert_rejected(&rejected, "E_CONSTRAINT");
    assert!(
        runtime
            .read_rule_verdicts("events", Context::query(actor("alice"), BTreeMap::new()))
            .unwrap()
            .is_empty()
    );
    assert!(
        runtime
            .read_rule_verdicts("counts", Context::query(actor("alice"), BTreeMap::new()))
            .unwrap()
            .is_empty()
    );
    assert!(
        runtime
            .read_rule_verdicts("claims", Context::query(actor("alice"), BTreeMap::new()))
            .unwrap()
            .is_empty()
    );

    runtime
        .seed(&[
            (
                "guards".to_owned(),
                object([("id", id("guard-1")), ("bucket", id("bucket-1"))]),
            ),
            (
                "counts".to_owned(),
                object([
                    ("id", id("!preexisting-count")),
                    ("bucket", id("bucket-1")),
                    ("value", Value::Int(99)),
                ]),
            ),
        ])
        .unwrap();
    let admitted = runtime
        .execute(
            "events.insert",
            mutation("alice", [("id", id("event-2")), ("bucket", id("bucket-1"))]),
        )
        .unwrap();
    assert_committed(&admitted);
    assert_eq!(admitted.trace.rule_probes, 2);
}

fn errors(schema: Schema) -> Vec<(String, CheckError)> {
    Generation::certify(&project(schema, Vec::new()), Ceilings::default()).unwrap_err()
}

fn assert_rule_error(errors: &[(String, CheckError)], site: &str, message_fragment: &str) {
    assert!(
        errors.iter().any(|(actual_site, error)| {
            actual_site == site
                && error.code == "E_RULE_INVALID"
                && error.message.contains(message_fragment)
        }),
        "missing {site:?} / {message_fragment:?}: {errors:#?}"
    );
}

#[test]
fn raw_certification_scopes_relational_terms_and_created_to_their_exact_effects() {
    Generation::certify(&project(schema(), Vec::new()), Ceilings::default()).unwrap();

    for (side, rule, message) in [
        (
            "read",
            RuleExpr::Eq(RuleTerm::OldField("role".to_owned()), role(MEMBER)),
            "old-row fields are valid only",
        ),
        (
            "insert",
            RuleExpr::Eq(RuleTerm::NextField("role".to_owned()), role(MEMBER)),
            "next-row fields are valid only",
        ),
        (
            "delete",
            RuleExpr::Eq(RuleTerm::OldField("role".to_owned()), role(MEMBER)),
            "old-row fields are valid only",
        ),
    ] {
        let mut invalid = schema();
        let rules = &mut invalid.tables.get_mut("memberships").unwrap().rules;
        match side {
            "read" => rules.read = rule,
            "insert" => rules.insert = rule,
            "delete" => rules.delete = rule,
            _ => unreachable!(),
        }
        assert_rule_error(
            &errors(invalid),
            &format!("schema.tables.memberships.rules.{side}.left"),
            message,
        );
    }

    for side in ["read", "update", "delete"] {
        let mut invalid = schema();
        let created = RuleExpr::Created {
            table: "groups".to_owned(),
            index: "byId".to_owned(),
            key: vec![RuleTerm::Field("group".to_owned())],
            provenance: KeyProvenance::Shape,
        };
        let rules = &mut invalid.tables.get_mut("memberships").unwrap().rules;
        match side {
            "read" => rules.read = created,
            "update" => rules.update = created,
            "delete" => rules.delete = created,
            _ => unreachable!(),
        }
        assert_rule_error(
            &errors(invalid),
            &format!("schema.tables.memberships.rules.{side}"),
            "created-row probes are valid only in table insert rules",
        );
    }

    let mut invalid = schema();
    invalid.channels.insert(
        "presence".to_owned(),
        Channel {
            value: BTreeMap::from([("typing".to_owned(), ArgType::Bool)]),
            args: BTreeMap::from([(
                "role".to_owned(),
                ArgType::Enum {
                    variants: vec![MEMBER.to_owned(), ADMIN.to_owned()],
                },
            )]),
            publish: RuleExpr::Eq(RuleTerm::OldField("role".to_owned()), role(MEMBER)),
            subscribe: RuleExpr::Allow,
            ttl_ms: 1_000,
        },
    );
    assert_rule_error(
        &errors(invalid),
        "schema.channels.presence.publish.left",
        "old-row fields are valid only",
    );

    let mut invalid = schema();
    invalid.tables.get_mut("memberships").unwrap().rules.insert = RuleExpr::Created {
        table: "groups".to_owned(),
        index: "byId".to_owned(),
        key: vec![RuleTerm::Viewer],
        provenance: KeyProvenance::Viewer,
    };
    assert_rule_error(
        &errors(invalid),
        "schema.tables.memberships.rules.insert.created.key[0]",
        "is Principal; expected Id",
    );
}

#[test]
fn raw_certification_resolves_every_final_exists_target_index_arity_and_key_term() {
    let constraint =
        |table: &str, index: &str, key: Vec<RuleTerm>| Constraint::FinalExistsOnInsert {
            table: table.to_owned(),
            index: index.to_owned(),
            key,
        };
    let replace = |schema: &mut Schema, constraint| {
        schema.tables.get_mut("groups").unwrap().constraints = vec![constraint];
    };
    let site = "schema.tables.groups.constraints[0].finalExistsOnInsert";

    let mut invalid = schema();
    replace(
        &mut invalid,
        constraint("missing", "byId", vec![RuleTerm::Field("id".to_owned())]),
    );
    assert_rule_error(&errors(invalid), site, "references unknown table missing");

    let mut invalid = schema();
    replace(
        &mut invalid,
        constraint(
            "memberships",
            "missing",
            vec![RuleTerm::Field("id".to_owned())],
        ),
    );
    assert_rule_error(
        &errors(invalid),
        site,
        "references unknown index memberships.missing",
    );

    let mut invalid = schema();
    replace(
        &mut invalid,
        constraint(
            "memberships",
            "byGroupPrincipalRole",
            vec![RuleTerm::Field("id".to_owned()), RuleTerm::Viewer],
        ),
    );
    assert_rule_error(&errors(invalid), site, "has 2 terms; expected 3");

    let mut invalid = schema();
    replace(
        &mut invalid,
        constraint(
            "memberships",
            "byGroupPrincipalRole",
            vec![RuleTerm::Viewer, RuleTerm::Viewer, role(ADMIN)],
        ),
    );
    assert_rule_error(
        &errors(invalid),
        &format!("{site}.key[0]"),
        "is Principal; expected Ref<groups>",
    );

    let mut invalid = schema();
    replace(
        &mut invalid,
        constraint(
            "memberships",
            "byGroupPrincipalRole",
            vec![
                RuleTerm::OldField("id".to_owned()),
                RuleTerm::Viewer,
                role(ADMIN),
            ],
        ),
    );
    assert_rule_error(
        &errors(invalid),
        &format!("{site}.key[0]"),
        "old-row fields are valid only",
    );
}
