use super::*;
use crate::{Ceilings, Checker, Constraint, Index, public_table};

#[test]
fn omitted_parent_rows_share_the_null_cap_group_and_remain_visible_after_refusal() {
    // @ref LLP 1011#null-keys-and-id-literals-2026-09-05 — omission and literal-null probes address the same capped group.
    let mut table = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            (
                "parent".into(),
                ColumnType::Optional(Box::new(ColumnType::Id)),
            ),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    columns: vec!["id".into()],
                    unique: true,
                },
            ),
            (
                "byParent".into(),
                Index {
                    columns: vec!["parent".into()],
                    unique: false,
                },
            ),
        ]),
    );
    table.constraints.push(Constraint::Cap {
        by: vec!["parent".into()],
        max: 2,
    });
    let schema = Schema {
        tables: BTreeMap::from([("buckets".into(), table)]),
        ..Schema::default()
    };
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let mut insert = Program {
        name: "buckets.insert".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Insert {
            table: "buckets".into(),
            row: Expr::Object(BTreeMap::from([("id".into(), Expr::Input(Input::NewId))])),
        }],
    };
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&insert)
        .unwrap();
    let context = |key: &str| {
        let mut context = Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new());
        context.new_ids.push_back(key.into());
        context
    };
    engine.execute(&insert, &cert, context("one")).unwrap();
    engine.execute(&insert, &cert, context("two")).unwrap();
    let error = engine
        .execute(&insert, &cert, context("three"))
        .unwrap_err();
    assert_eq!(error.code(), "E_CONSTRAINT");
    let message = error.to_string();
    assert!(
        message.contains("cap 2") && message.contains("parent") && message.contains("Null"),
        "{message}"
    );
    let probe = Program {
        name: "buckets.exists".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Exists(Read {
            site: "buckets.null".into(),
            table: "buckets".into(),
            index: "byParent".into(),
            key: vec![Expr::Literal(Value::Null)],
            provenance: KeyProvenance::Const,
        }))],
    };
    let probe_cert = Checker::new(&schema, Ceilings::default())
        .check(&probe)
        .unwrap();
    assert_eq!(
        engine
            .execute(&probe, &probe_cert, context("unused"))
            .unwrap()
            .result,
        Value::Bool(true)
    );
    assert_eq!(engine.rows("buckets").unwrap().len(), 2);
    if let Stmt::Insert {
        row: Expr::Object(fields),
        ..
    } = &mut insert.body[0]
    {
        fields.insert("parent".into(), Expr::Literal(Value::Id("post".into())));
    }
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&insert)
        .unwrap();
    engine
        .execute(&insert, &cert, context("present-one"))
        .unwrap();
    engine
        .execute(&insert, &cert, context("present-two"))
        .unwrap();
    assert_eq!(engine.rows("buckets").unwrap().len(), 4);
}

#[test]
fn refusing_cap_probe_is_charged_before_returning_constraint_error() {
    let mut table = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            (
                "group".into(),
                ColumnType::Optional(Box::new(ColumnType::Id)),
            ),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    columns: vec!["id".into()],
                    unique: true,
                },
            ),
            (
                "byGroup".into(),
                Index {
                    columns: vec!["group".into(), "id".into()],
                    unique: false,
                },
            ),
        ]),
    );
    table.constraints.push(Constraint::Cap {
        by: vec!["group".into()],
        max: 50,
    });
    let schema = Schema {
        tables: BTreeMap::from([("memberships".into(), table)]),
        ..Schema::default()
    };
    let mut engine = Engine::memory(schema.clone()).unwrap();
    for n in 0..50 {
        engine
            .seed(
                "memberships",
                crate::object([("id", Value::Id(format!("m{n}")))]),
            )
            .unwrap();
    }
    let program = Program {
        name: "cap.refusing".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Insert {
            table: "memberships".into(),
            row: Expr::Literal(crate::object([("id", Value::Id("over".into()))])),
        }],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let tx = engine.store.conn.transaction().unwrap();
    let hashes = hashes::PolicyHashes::new(&schema);
    let mut runner = Runner::new(
        &tx,
        &schema,
        &hashes,
        &certificate,
        Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new()),
        &[],
        &[],
        RuleAuthority::StoreAuthoritative,
        1,
    );
    assert_eq!(
        runner.statements(&program.body).unwrap_err().code(),
        "E_CONSTRAINT"
    );
    assert_eq!(runner.trace.examined, 50);
    assert_eq!(
        runner
            .trace
            .constraint_inputs
            .iter()
            .find(|c| c.check.starts_with("Cap("))
            .unwrap()
            .examined_ids
            .len(),
        50
    );
    runner.assert_bounds().unwrap();
}

#[test]
fn same_key_count_tracks_writes_inside_one_program_and_refuses_after_max() {
    let mut memberships = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("principal".into(), ColumnType::Principal),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    columns: vec!["id".into()],
                    unique: true,
                },
            ),
            (
                "byPrincipal".into(),
                Index {
                    columns: vec!["principal".into(), "id".into()],
                    unique: false,
                },
            ),
        ]),
    );
    memberships.constraints.push(Constraint::Cap {
        by: vec!["principal".into()],
        max: 3,
    });
    let counts = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("principal".into(), ColumnType::Principal),
            ("value".into(), ColumnType::Int),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    columns: vec!["id".into()],
                    unique: true,
                },
            ),
            (
                "byPrincipal".into(),
                Index {
                    columns: vec!["principal".into()],
                    unique: true,
                },
            ),
        ]),
    );
    let schema = Schema {
        tables: BTreeMap::from([
            ("memberships".into(), memberships),
            ("membershipCounts".into(), counts),
        ]),
        maintains: vec![Maintain {
            kind: MaintainKind::Count,
            source: "memberships".into(),
            by: vec!["principal".into()],
            target: "membershipCounts".into(),
            readable: None,
        }],
        ..Schema::default()
    };
    let insert = |id: &str| Stmt::Insert {
        table: "memberships".into(),
        row: Expr::Literal(crate::object([
            ("id", Value::Id(id.into())),
            ("principal", Value::Id("alice".into())),
        ])),
    };
    let fill = Program {
        name: "memberships.fill".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![insert("m1"), insert("m2"), insert("m3")],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&fill)
        .unwrap();
    assert_eq!(certificate.max_examined, 3);
    assert_eq!(certificate.max_index_entries, 3);
    assert!(
        certificate
            .indexes_required
            .contains(&"memberships.byPrincipal".to_owned())
    );
    assert!(
        certificate
            .indexes_required
            .contains(&"membershipCounts.byId".to_owned())
    );
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let execution = engine
        .execute(
            &fill,
            &certificate,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert_eq!(execution.trace.examined, 3);
    let cap_inputs: Vec<_> = execution
        .trace
        .constraint_inputs
        .iter()
        .filter(|input| input.check.starts_with("Cap("))
        .collect();
    assert_eq!(cap_inputs.len(), 3);
    assert!(cap_inputs.iter().all(|input| {
        input.table == "membershipCounts"
            && input.index == "byId"
            && matches!(input.prefix.as_slice(), [Value::Id(_)])
    }));
    let count_id = canonical_json(&vec![Value::Id("alice".into())]);
    assert_eq!(
        engine.rows("membershipCounts").unwrap()[0]
            .field("value")
            .unwrap(),
        &Value::Int(3)
    );
    assert_eq!(
        engine.rows("membershipCounts").unwrap()[0]
            .field("id")
            .unwrap(),
        &Value::Id(count_id)
    );

    let over = Program {
        name: "memberships.over".into(),
        body: vec![insert("m4")],
        ..fill
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&over)
        .unwrap();
    assert_eq!(
        engine
            .execute(
                &over,
                &certificate,
                Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
            )
            .unwrap_err()
            .code(),
        "E_CONSTRAINT"
    );
    assert_eq!(engine.rows("memberships").unwrap().len(), 3);
}
