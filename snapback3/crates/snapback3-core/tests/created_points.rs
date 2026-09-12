//! Transaction-local creation authority must follow the current indexed row image.
use snapback3_core::*;
use std::collections::BTreeMap;

fn text(value: &str) -> Value {
    Value::String(value.into())
}

fn value(id: &str, group: &str) -> Expr {
    Expr::Literal(object([
        ("id", Value::Id(id.into())),
        ("group", text(group)),
    ]))
}
fn insert(table: &str, id: &str, group: &str) -> Stmt {
    Stmt::Insert {
        table: table.into(),
        row: value(id, group),
    }
}
fn change(group: &str) -> Stmt {
    Stmt::Update {
        table: "parents".into(),
        key: Expr::Literal(Value::Id("one".into())),
        patch: Expr::Literal(object([("group", text(group))])),
    }
}
fn remove(id: &str) -> Stmt {
    Stmt::Delete {
        table: "parents".into(),
        key: Expr::Literal(Value::Id(id.into())),
    }
}

#[test]
fn created_authority_tracks_key_changes_deletes_and_nonunique_peers() {
    let parents = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("group".into(), ColumnType::Text { max: 20 }),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    components: vec![IndexComponent::Column("id".into())],
                    unique: true,
                },
            ),
            (
                "byGroup".into(),
                Index {
                    components: vec![IndexComponent::Column("group".into())],
                    unique: false,
                },
            ),
        ]),
    );
    let mut claims = parents.clone();
    claims.rules.insert = RuleExpr::Created {
        table: "parents".into(),
        index: "byGroup".into(),
        key: vec![RuleTerm::Field("group".into())],
        provenance: KeyProvenance::Shape,
    };
    let schema = Schema {
        tables: BTreeMap::from([("parents".into(), parents), ("claims".into(), claims)]),
        ..Schema::default()
    };
    for (label, edits, group, allowed) in [
        ("remaining peer", vec![change("b")], "a", true),
        (
            "removed last peer",
            vec![change("b"), remove("two")],
            "a",
            false,
        ),
        ("new key", vec![change("b")], "b", true),
        (
            "twice changed old key",
            vec![change("b"), change("c")],
            "b",
            false,
        ),
        (
            "twice changed new key",
            vec![change("b"), change("c")],
            "c",
            true,
        ),
        (
            "deleted changed row",
            vec![change("c"), remove("one")],
            "c",
            false,
        ),
    ] {
        let mut body = vec![insert("parents", "one", "a"), insert("parents", "two", "a")];
        body.extend(edits);
        body.push(insert("claims", "claim", group));
        body.push(Stmt::Return(Expr::Literal(Value::Null)));
        let project = ProjectJson {
            version: 1,
            schema: schema.clone(),
            auth: Auth::default(),
            effects: vec![],
            programs: vec![Program {
                name: "claim".into(),
                kind: ProgramKind::Mutation,
                args: BTreeMap::new(),
                read_time_granularity_ms: None,
                body,
            }],
        };
        let generation = Generation::certify(&project, Ceilings::default()).unwrap();
        let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
        // Existing matches never provide transaction-local creation authority.
        runtime
            .seed(&[(
                "parents".into(),
                object([("id", Value::Id("existing".into())), ("group", text(group))]),
            )])
            .unwrap();
        let execution = runtime
            .execute(
                "claim",
                Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
            )
            .unwrap();
        assert_eq!(
            matches!(execution.state, ExecutionState::Committed { .. }),
            allowed,
            "{label}: {:?}",
            execution.state
        );
        assert_eq!(
            runtime.store().commit_seq().unwrap(),
            if allowed { 2 } else { 1 },
            "{label}"
        );
    }
}
