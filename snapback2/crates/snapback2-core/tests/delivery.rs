//! `deliver` at the trust boundary and through succession (LLP 1019 D1):
//! schema identity, the generated shapes, raw-schema admission, the static
//! refusal of program writes to a generated table, install-empty, bootstrap,
//! destructive removal and retarget, and the audience bound's rule.
use snapback2_core::delivery::{self, Deliver};
use snapback2_core::ir::IndexKeyExpr;
use snapback2_core::*;
use std::collections::{BTreeMap, BTreeSet};

fn index(columns: &[&str], unique: bool) -> Index {
    Index {
        components: columns
            .iter()
            .map(|column| IndexComponent::Column((*column).to_owned()))
            .collect(),
        unique,
    }
}

fn table(columns: &[(&str, ColumnType)], indexes: &[(&str, &[&str], bool)]) -> Table {
    public_table(
        columns
            .iter()
            .map(|(name, kind)| ((*name).to_owned(), kind.clone()))
            .collect(),
        indexes
            .iter()
            .map(|(name, columns, unique)| ((*name).to_owned(), index(columns, *unique)))
            .collect(),
    )
}

fn reference(table: &str) -> ColumnType {
    ColumnType::Ref {
        table: table.to_owned(),
    }
}

fn deliver(cap: u32, bootstrap: bool) -> Deliver {
    Deliver {
        target: "memberships".to_owned(),
        prefix: vec!["conversationId".to_owned()],
        principal: "principal".to_owned(),
        log: "deliveries".to_owned(),
        receipts: false,
        audience: cap,
        bootstrap,
    }
}

/// The chat shape: conversations, capped memberships with two principal
/// columns (so a retarget can keep the log's shape), and messages.
fn schema(cap: u32, deliver: Option<Deliver>) -> Schema {
    let mut memberships = table(
        &[
            ("id", ColumnType::Id),
            ("conversationId", reference("conversations")),
            ("principal", ColumnType::Principal),
            ("invitedBy", ColumnType::Principal),
        ],
        &[
            ("byId", &["id"], true),
            (
                "byConversationPrincipal",
                &["conversationId", "principal"],
                false,
            ),
        ],
    );
    memberships.constraints.push(Constraint::Cap {
        by: vec!["conversationId".to_owned()],
        max: cap,
    });
    let mut messages = table(
        &[
            ("id", ColumnType::Id),
            ("conversationId", reference("conversations")),
            ("authorId", ColumnType::Principal),
            ("body", ColumnType::Text { max: 100 }),
        ],
        &[("byId", &["id"], true)],
    );
    messages.deliver = deliver;
    let mut schema = Schema::default();
    schema.tables.insert(
        "conversations".to_owned(),
        table(&[("id", ColumnType::Id)], &[("byId", &["id"], true)]),
    );
    schema.tables.insert("memberships".to_owned(), memberships);
    schema.tables.insert("messages".to_owned(), messages);
    if let Some(deliver) = &schema.tables["messages"].deliver.clone() {
        let log = delivery::log_table(&schema, "messages", deliver).expect("log shape");
        schema.tables.insert(deliver.log.clone(), log);
        if let Some(name) = deliver.receipts_table() {
            let receipts =
                delivery::receipts_table(&schema, "messages", deliver).expect("receipts shape");
            schema.tables.insert(name, receipts);
        }
    }
    schema
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

fn generation(schema: Schema) -> Generation {
    Generation::certify(&project(schema, Vec::new()), Ceilings::default()).unwrap()
}

fn certify_errors(schema: Schema, programs: Vec<Program>) -> Vec<(String, CheckError)> {
    Generation::certify(&project(schema, programs), Ceilings::default()).unwrap_err()
}

fn row<const N: usize>(entries: [(&str, Value); N]) -> Value {
    object(entries)
}

fn id(value: &str) -> Value {
    Value::Id(value.to_owned())
}

fn member(id_value: &str, conversation: &str, principal: &str) -> (String, Value) {
    (
        "memberships".to_owned(),
        row([
            ("id", id(id_value)),
            ("conversationId", id(conversation)),
            ("principal", id(principal)),
            ("invitedBy", id("alice")),
        ]),
    )
}

fn message(id_value: &str, conversation: &str) -> (String, Value) {
    (
        "messages".to_owned(),
        row([
            ("id", id(id_value)),
            ("conversationId", id(conversation)),
            ("authorId", id("alice")),
            ("body", Value::String("hello".to_owned())),
        ]),
    )
}

/// A populated runtime without custody: two members of `c1`, one of `c2`,
/// one message in each conversation, and a bob duplicate row to deduplicate.
fn populated(cap: u32) -> Runtime {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(schema(cap, None))).unwrap();
    runtime
        .seed(&[
            ("conversations".to_owned(), row([("id", id("c1"))])),
            ("conversations".to_owned(), row([("id", id("c2"))])),
            member("m-alice", "c1", "alice"),
            member("m-bob", "c1", "bob"),
            member("m-bob-again", "c1", "bob"),
            member("m-carol", "c2", "carol"),
            message("msg-1", "c1"),
            message("msg-2", "c2"),
        ])
        .unwrap();
    runtime
}

fn scan(table: &str) -> Program {
    Program {
        name: format!("scan.{table}"),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: table.to_owned(),
            table: table.to_owned(),
            index: "byId".to_owned(),
            prefix: Vec::<IndexKeyExpr>::new(),
            take: Bound::Literal(50),
            order: Order::Asc,
            after: None,
            before: None,
            range: None,
            opaque_cursor: false,
            merge_site: None,
            provenance: KeyProvenance::Const,
        }))],
    }
}

fn rows(runtime: &mut Runtime, table: &str) -> Vec<Value> {
    let result = runtime
        .read_operator(&scan(table), BTreeMap::new(), OperatorId("op".into()), 10)
        .unwrap()
        .result;
    let page = match &result {
        Value::Array(items) => items.clone(),
        other => other
            .field("data")
            .and_then(|data| data.as_array().map(<[Value]>::to_vec))
            .unwrap_or_else(|_| panic!("unexpected page shape: {other:?}")),
    };
    page
}

fn field<'a>(row: &'a Value, name: &str) -> &'a Value {
    row.field(name).unwrap()
}

#[test]
fn deliver_is_part_of_schema_identity_and_absent_bytes_are_unchanged() {
    let bare = schema(3, None);
    let json = serde_json::to_value(&bare).unwrap();
    assert!(
        json["tables"]["messages"].get("deliver").is_none(),
        "a table without the declaration must not carry the key"
    );
    let declared = schema(3, Some(deliver(3, false)));
    assert_ne!(bare.hash(), declared.hash());
    let round_trip: Schema =
        serde_json::from_str(&serde_json::to_string(&declared).unwrap()).unwrap();
    assert_eq!(round_trip, declared);
    assert_eq!(round_trip.hash(), declared.hash());
    let declared_json = serde_json::to_value(&declared).unwrap();
    assert_eq!(
        declared_json["tables"]["messages"]["deliver"],
        serde_json::json!({
            "target": "memberships", "prefix": ["conversationId"], "principal": "principal",
            "log": "deliveries", "audience": 3,
        }),
        "false flags are absent from the bytes"
    );
    let novel: Result<Deliver, _> = serde_json::from_value(serde_json::json!({
        "target": "memberships", "prefix": ["conversationId"], "principal": "principal",
        "log": "deliveries", "audience": 3, "shard": 1,
    }));
    assert!(novel.is_err(), "an unknown descriptor field is refused, not hashed");
}

#[test]
fn generated_log_has_the_canonical_shape() {
    let schema = schema(3, Some(deliver(3, false)));
    let log = &schema.tables["deliveries"];
    assert_eq!(
        log.columns.keys().cloned().collect::<Vec<_>>(),
        ["at", "audience", "conversationId", "id", "incarnation", "kind", "recipient", "row", "seq"]
    );
    assert_eq!(log.columns["row"], reference("messages"));
    assert_eq!(log.columns["conversationId"], reference("conversations"));
    assert_eq!(
        log.columns["kind"],
        ColumnType::Enum {
            variants: vec!["delivered".into(), "changed".into(), "removed".into()]
        }
    );
    assert_eq!(
        log.indexes["byRow"].scalar_columns().unwrap(),
        ["row", "kind", "recipient"]
    );
    assert_eq!(
        log.indexes["byRecipientGroup"].scalar_columns().unwrap(),
        ["recipient", "conversationId", "kind", "seq", "id"]
    );
    assert_eq!(
        log.indexes["byRecipient"].scalar_columns().unwrap(),
        ["recipient", "seq", "id"]
    );
    assert_eq!(
        log.rules.read,
        RuleExpr::Eq(RuleTerm::Field("recipient".into()), RuleTerm::Viewer)
    );
    assert_eq!(log.rules.insert, RuleExpr::Deny);
    assert_eq!(log.rules.update, RuleExpr::Deny);
    assert_eq!(log.rules.delete, RuleExpr::Deny);
    assert_eq!(
        log.constraints,
        vec![Constraint::Immutable {
            fields: ["at", "audience", "conversationId", "incarnation", "kind", "recipient", "row", "seq"]
                .map(str::to_owned)
                .to_vec()
        }]
    );
    assert_eq!(
        log.tombstones,
        vec![Tombstone {
            table: "messages".into(),
            column: "row".into(),
            when: RuleExpr::Eq(
                RuleTerm::Field("kind".into()),
                RuleTerm::Literal(Value::String("removed".into()))
            ),
        }]
    );
    assert_eq!(log.retain, RetentionPolicy::UntilRevoked);
    assert!(log.deliver.is_none());
    assert_eq!(
        delivery::owner(&schema, "deliveries").map(|(content, _, kind)| (content, kind)),
        Some(("messages", delivery::Generated::Log))
    );
    assert!(delivery::owner(&schema, "messages").is_none());
    assert!(validate_schema(&schema).is_ok());
    generation(schema);
}

#[test]
fn receipts_table_inherits_the_content_read_rule_over_row() {
    let mut declared = deliver(3, false);
    declared.receipts = true;
    let mut schema = schema(3, Some(declared.clone()));
    let read = RuleExpr::And(vec![
        RuleExpr::Exists {
            table: "memberships".into(),
            index: "byConversationPrincipal".into(),
            key: vec![RuleTerm::Field("conversationId".into()), RuleTerm::Viewer],
            provenance: KeyProvenance::Shape,
        },
        RuleExpr::Exists {
            table: "messages".into(),
            index: "byId".into(),
            key: vec![RuleTerm::Field("id".into())],
            provenance: KeyProvenance::Shape,
        },
    ]);
    schema.tables.get_mut("messages").unwrap().rules.read = read;
    let receipts = delivery::receipts_table(&schema, "messages", &declared).unwrap();
    assert_eq!(
        receipts.columns.keys().cloned().collect::<Vec<_>>(),
        ["conversationId", "id", "received", "recipient", "row", "seq"]
    );
    assert_eq!(
        receipts.rules.read,
        RuleExpr::And(vec![
            RuleExpr::Exists {
                table: "memberships".into(),
                index: "byConversationPrincipal".into(),
                key: vec![RuleTerm::Field("conversationId".into()), RuleTerm::Viewer],
                provenance: KeyProvenance::Shape,
            },
            RuleExpr::Exists {
                table: "messages".into(),
                index: "byId".into(),
                key: vec![RuleTerm::Field("row".into())],
                provenance: KeyProvenance::Shape,
            },
        ])
    );
    assert!(receipts.indexes["byRow"].unique);
    assert_eq!(
        receipts.constraints,
        vec![
            Constraint::Unique {
                index: "byRow".into()
            },
            Constraint::Immutable {
                fields: vec!["recipient".into(), "row".into()]
            }
        ]
    );
    schema.tables.insert("deliveriesReceipts".into(), receipts);
    assert!(validate_schema(&schema).is_ok());
    assert_eq!(
        delivery::owner(&schema, "deliveriesReceipts").map(|(_, _, kind)| kind),
        Some(delivery::Generated::Receipts)
    );
    generation(schema);
}

#[test]
fn raw_schema_admission_refuses_each_declaration_fault() {
    let faults: Vec<(&str, Box<dyn Fn(&mut Schema)>, &str, &str)> = vec![
        (
            "unknown target",
            Box::new(|schema| schema.tables.get_mut("messages").unwrap().deliver.as_mut().unwrap().target = "members".into()),
            delivery::SHAPE,
            "unknown target table members",
        ),
        (
            "uncapped target",
            Box::new(|schema| schema.tables.get_mut("memberships").unwrap().constraints.clear()),
            delivery::UNBOUNDED,
            "pins no capped group",
        ),
        (
            "text principal",
            Box::new(|schema| schema.tables.get_mut("messages").unwrap().deliver.as_mut().unwrap().principal = "conversationId".into()),
            delivery::PRINCIPAL,
            "memberships.conversationId is Ref(conversations), not principal",
        ),
        (
            "missing principal",
            Box::new(|schema| schema.tables.get_mut("messages").unwrap().deliver.as_mut().unwrap().principal = "who".into()),
            delivery::PRINCIPAL,
            "memberships has no such column",
        ),
        (
            "audience below cap",
            Box::new(|schema| schema.tables.get_mut("messages").unwrap().deliver.as_mut().unwrap().audience = 2),
            delivery::SHAPE,
            "audience bound 2 is below cap 3",
        ),
        (
            "missing log",
            Box::new(|schema| {
                schema.tables.remove("deliveries");
            }),
            delivery::SHAPE,
            "generated table deliveries is missing",
        ),
        (
            "authored column on the log",
            Box::new(|schema| {
                schema.tables.get_mut("deliveries").unwrap().columns.insert("note".into(), ColumnType::Int);
            }),
            delivery::SHAPE,
            "columns differs",
        ),
        (
            "opened read rule",
            Box::new(|schema| schema.tables.get_mut("deliveries").unwrap().rules.read = RuleExpr::Allow),
            delivery::SHAPE,
            "rules differs",
        ),
        (
            "unknown prefix column",
            Box::new(|schema| schema.tables.get_mut("messages").unwrap().deliver.as_mut().unwrap().prefix = vec!["threadId".into()]),
            delivery::SHAPE,
            "prefix key .threadId is not a column of messages",
        ),
        (
            "log named like the content table",
            Box::new(|schema| schema.tables.get_mut("messages").unwrap().deliver.as_mut().unwrap().log = "messages".into()),
            delivery::SHAPE,
            "names the content or target table",
        ),
        (
            "two declarations sharing one log",
            Box::new(|schema| {
                let mut posts = schema.tables["messages"].clone();
                posts.deliver = Some(deliver(3, false));
                schema.tables.insert("posts".into(), posts);
            }),
            delivery::SHAPE,
            "generated by both messages and posts",
        ),
    ];
    for (name, fault, code, fragment) in faults {
        let mut schema = schema(3, Some(deliver(3, false)));
        fault(&mut schema);
        let errors = certify_errors(schema.clone(), Vec::new());
        let matched = errors.iter().find(|(site, error)| {
            error.code == code && error.message.contains(fragment) && site.ends_with(".deliver")
        });
        assert!(
            matched.is_some(),
            "{name}: expected {code} containing {fragment:?}, got {errors:?}"
        );
        assert!(
            !matched.unwrap().1.rewrite.is_empty(),
            "{name}: refusal without a rewrite"
        );
        let runtime_errors = validate_schema(&schema).unwrap_err();
        assert!(
            runtime_errors
                .iter()
                .any(|error| error.to_string().contains(code) && error.to_string().contains(fragment)),
            "{name}: validate_schema did not refuse: {runtime_errors:?}"
        );
    }
}

#[test]
fn unbounded_refusal_pastes_the_cap_and_principal_refusal_pastes_the_line() {
    let mut uncapped = schema(3, Some(deliver(3, false)));
    uncapped.tables.get_mut("memberships").unwrap().constraints.clear();
    let (_, error) = certify_errors(uncapped, Vec::new()).remove(0);
    assert_eq!(error.code, delivery::UNBOUNDED);
    assert_eq!(error.rewrite, "cap 50 by conversationId");
    let mut ambiguous = schema(3, Some(deliver(3, false)));
    ambiguous.tables.get_mut("messages").unwrap().deliver.as_mut().unwrap().principal = "who".into();
    let (_, error) = certify_errors(ambiguous, Vec::new()).remove(0);
    assert_eq!(error.code, delivery::PRINCIPAL);
    assert_eq!(
        error.rewrite,
        "deliver to memberships[.conversationId] by .invitedBy as deliveries"
    );
}

#[test]
fn programs_cannot_write_a_generated_table_whatever_their_kind() {
    let schema = schema(3, Some(deliver(3, false)));
    let event = || {
        Expr::Literal(row([
            ("id", id("e1")),
            ("recipient", id("alice")),
            ("row", id("msg-1")),
            ("incarnation", Value::Int(1)),
            ("conversationId", id("c1")),
            ("kind", Value::String("delivered".into())),
            ("audience", Value::Int(1)),
            ("seq", Value::Int(1)),
            ("at", Value::Int(1)),
        ]))
    };
    for (kind, statement) in [
        (
            ProgramKind::Mutation,
            Stmt::Insert {
                table: "deliveries".into(),
                row: event(),
            },
        ),
        (
            ProgramKind::Job,
            Stmt::For {
                binding: "row".into(),
                domain: LoopDomain::Page(Scan {
                    site: "sweep".into(),
                    table: "messages".into(),
                    index: "byId".into(),
                    prefix: Vec::<IndexKeyExpr>::new(),
                    take: Bound::Literal(100),
                    order: Order::Asc,
                    after: None,
                    before: None,
                    range: None,
                    opaque_cursor: false,
                    merge_site: None,
                    provenance: KeyProvenance::Const,
                }),
                body: vec![Stmt::Upsert {
                    table: "deliveries".into(),
                    key: Expr::Literal(id("e1")),
                    row: event(),
                }],
            },
        ),
        (
            ProgramKind::Mutation,
            Stmt::Delete {
                table: "deliveries".into(),
                key: Expr::Literal(id("e1")),
            },
        ),
    ] {
        let program = Program {
            name: "ops.write".into(),
            kind,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: if kind == ProgramKind::Job {
                vec![statement]
            } else {
                vec![statement, Stmt::Return(Expr::Literal(Value::Null))]
            },
        };
        let errors = Checker::new(&schema, Ceilings::default())
            .check(&program)
            .unwrap_err();
        assert_eq!(errors.code, delivery::SHAPE, "{kind:?}");
        assert!(
            errors.message.contains("engine-owned table deliveries")
                && errors.rewrite.contains("write messages"),
            "{errors:?}"
        );
    }
    Checker::new(&schema, Ceilings::default())
        .check(&scan("deliveries"))
        .expect("reads of the log are ordinary");
}

#[test]
fn deliver_installs_an_empty_log_over_existing_rows() {
    let mut runtime = populated(3);
    let report = runtime
        .apply_successor(generation(schema(3, Some(deliver(3, false)))))
        .unwrap();
    assert_eq!(report.added_tables, ["deliveries"]);
    assert!(report.bootstrapped_deliveries.is_empty());
    assert!(rows(&mut runtime, "deliveries").is_empty());
    assert_eq!(rows(&mut runtime, "messages").len(), 2);
}

#[test]
fn bootstrap_fans_out_to_current_members_once_and_says_so() {
    let mut runtime = populated(3);
    let report = runtime
        .apply_successor(generation(schema(3, Some(deliver(3, true)))))
        .unwrap();
    assert_eq!(
        report.bootstrapped_deliveries,
        ["deliveries: 3 delivered event(s) over 2 messages row(s) to current memberships members; bootstrap approximates send-time audiences"]
    );
    let events = rows(&mut runtime, "deliveries");
    assert_eq!(events.len(), 3, "{events:?}");
    let recipients = events
        .iter()
        .map(|event| field(event, "recipient").as_str().unwrap().to_owned())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        recipients,
        BTreeSet::from(["alice".to_owned(), "bob".to_owned(), "carol".to_owned()]),
        "bob's duplicate membership row is one recipient"
    );
    let ids = events
        .iter()
        .map(|event| field(event, "id").as_str().unwrap().to_owned())
        .collect::<BTreeSet<_>>();
    assert_eq!(ids.len(), 3);
    for event in &events {
        let (conversation, audience) = if field(event, "row") == &id("msg-1") {
            ("c1", 2)
        } else {
            assert_eq!(field(event, "row"), &id("msg-2"));
            ("c2", 1)
        };
        assert_eq!(field(event, "conversationId"), &id(conversation));
        assert_eq!(field(event, "kind"), &Value::String("delivered".into()));
        assert_eq!(field(event, "audience"), &Value::Int(audience));
        assert_eq!(field(event, "seq"), field(event, "incarnation"));
    }
    // The word acts once, when the log is installed; a later successor leaves history alone.
    let mut later = schema(3, Some(deliver(3, true)));
    later
        .tables
        .get_mut("messages")
        .unwrap()
        .columns
        .insert("editedAt".into(), ColumnType::Optional(Box::new(ColumnType::Time)));
    let report = runtime.apply_successor(generation(later)).unwrap();
    assert!(report.bootstrapped_deliveries.is_empty());
    assert_eq!(rows(&mut runtime, "deliveries").len(), 3);
}

#[test]
fn removing_deliver_is_a_destructive_plan_even_when_the_log_table_survives() {
    for keep_table in [false, true] {
        let mut runtime = populated(3);
        runtime
            .apply_successor(generation(schema(3, Some(deliver(3, true)))))
            .unwrap();
        let mut next = schema(3, None);
        if keep_table {
            let log = delivery::log_table(&schema(3, Some(deliver(3, false))), "messages", &deliver(3, false)).unwrap();
            next.tables.insert("deliveries".into(), log);
        }
        let refusal = runtime.apply_successor(generation(next.clone())).unwrap_err();
        assert_eq!(refusal.code, "E_SUCCESSOR_DESTRUCTIVE", "keep_table={keep_table}");
        assert_eq!(
            refusal.plan.drops,
            vec![Drop::Table {
                name: "deliveries".into(),
                rows: 3
            }],
            "keep_table={keep_table}"
        );
        runtime
            .apply_migration(generation(next), &refusal.plan, 0)
            .unwrap();
        assert_eq!(rows(&mut runtime, "messages").len(), 2);
        if keep_table {
            assert!(rows(&mut runtime, "deliveries").is_empty());
        }
    }
}

#[test]
fn retargeting_deliver_is_a_destructive_plan_even_when_the_shape_matches() {
    let mut runtime = populated(3);
    runtime
        .apply_successor(generation(schema(3, Some(deliver(3, true)))))
        .unwrap();
    let mut retargeted = deliver(3, false);
    retargeted.principal = "invitedBy".into();
    let next = schema(3, Some(retargeted));
    assert_eq!(
        next.tables["deliveries"],
        schema(3, Some(deliver(3, false))).tables["deliveries"],
        "the log's shape is unchanged by the principal column"
    );
    let refusal = runtime.apply_successor(generation(next.clone())).unwrap_err();
    assert_eq!(refusal.code, "E_SUCCESSOR_DESTRUCTIVE");
    assert_eq!(
        refusal.plan.drops,
        vec![Drop::Table {
            name: "deliveries".into(),
            rows: 3
        }]
    );
    runtime
        .apply_migration(generation(next), &refusal.plan, 0)
        .unwrap();
    assert!(rows(&mut runtime, "deliveries").is_empty());

    let mut renamed = deliver(3, false);
    renamed.log = "custody".into();
    let refusal = runtime
        .apply_successor(generation(schema(3, Some(renamed.clone()))))
        .unwrap_err();
    assert_eq!(
        refusal.plan.drops,
        vec![Drop::Table {
            name: "deliveries".into(),
            rows: 0
        }]
    );
    runtime
        .apply_migration(generation(schema(3, Some(renamed))), &refusal.plan, 0)
        .unwrap();
    assert!(rows(&mut runtime, "custody").is_empty());
}

#[test]
fn audience_may_only_rise_while_a_stored_audience_exceeds_it() {
    let mut runtime = populated(3);
    runtime
        .apply_successor(generation(schema(3, Some(deliver(3, true)))))
        .unwrap();
    let lowered = |cap: u32| generation(schema(cap, Some(deliver(cap, true))));
    let refusal = runtime.apply_successor(lowered(1)).unwrap_err();
    assert_eq!(refusal.code, "E_SUCCESSOR_AUDIENCE");
    assert!(
        refusal.message.contains("stored audience of 2")
            && refusal.message.contains("declared 1, installed 3"),
        "{refusal}"
    );
    assert_eq!(refusal.site.as_deref(), Some("schema.tables.messages.deliver"));
    assert!(refusal.rewrite.contains("keep cap 3 by conversationId on memberships"));
    // Departed members do not shrink the history: bob leaves, the bound still holds.
    bob_leaves(&mut runtime);
    assert_eq!(
        runtime.apply_successor(lowered(1)).unwrap_err().code,
        "E_SUCCESSOR_AUDIENCE"
    );
    // Down to the largest stored audience, and up, are ordinary successors.
    runtime.apply_successor(lowered(2)).unwrap();
    runtime.apply_successor(lowered(5)).unwrap();
    assert_eq!(rows(&mut runtime, "deliveries").len(), 3);

    // An empty log has no stored audience: the same lowering is ordinary.
    let mut empty = populated(3);
    empty
        .apply_successor(generation(schema(3, Some(deliver(3, false)))))
        .unwrap();
    bob_leaves(&mut empty);
    empty.apply_successor(lowered(1)).unwrap();
}

fn bob_leaves(runtime: &mut Runtime) {
    let leave = Program {
        name: "ops.leave".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Delete {
                table: "memberships".into(),
                key: Expr::Literal(id("m-bob")),
            },
            Stmt::Delete {
                table: "memberships".into(),
                key: Expr::Literal(id("m-bob-again")),
            },
            Stmt::Return(Expr::Literal(Value::Null)),
        ],
    };
    runtime
        .execute_adhoc_operator(&leave, BTreeMap::new(), OperatorId("op".into()), || 3)
        .unwrap();
}
