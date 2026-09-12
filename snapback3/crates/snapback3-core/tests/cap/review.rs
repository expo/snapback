use super::*;

#[test]
fn unused_nonuniform_scan_refuses_but_uniform_scan_leaves_cap_reserve_at_49_and_50() {
    let mut schema = schema(Some(50));
    let mut other = schema.tables["memberships"].clone();
    other.constraints.clear();
    other
        .columns
        .insert("principal".into(), ColumnType::Principal);
    other.indexes.insert(
        "byPrincipal".into(),
        Index {
            components: (vec!["principal".into(), "id".into()])
                .into_iter()
                .map(snapback3_core::search_key::IndexComponent::Column)
                .collect(),
            unique: false,
        },
    );
    other.rules.read = RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer);
    schema.tables.insert("other".into(), other);
    let mut read = scan();
    read.table = "other".into();
    read.index = "byPrincipal".into();
    read.prefix.clear();
    let mut p = program(vec![
        Stmt::Let {
            name: "unused".into(),
            value: Expr::Scan(read),
        },
        Stmt::Insert {
            table: "memberships".into(),
            row: Expr::Literal(row(49, None)),
        },
    ]);
    let error = Checker::new(&schema, Ceilings::default())
        .check(&p)
        .unwrap_err();
    assert_eq!(error.code, "E_STRUCTURAL_FANOUT");
    assert!(
        error
            .message
            .contains("can spend the budget the cap check on memberships needs")
    );
    if let Stmt::Let {
        value: Expr::Scan(scan),
        ..
    } = &mut p.body[0]
    {
        scan.prefix
            .push(IndexKeyExpr::Scalar(Expr::Input(Input::Viewer)));
        scan.provenance = KeyProvenance::Viewer;
    }
    let mut engine = Engine::memory(schema.clone()).unwrap();
    // Hidden candidates would exhaust the old 10,240 ceiling; a pinned scan skips all.
    for n in 0..10_240 {
        engine
            .seed(
                "other",
                object([("id", id(&format!("h{n}"))), ("principal", id("hidden"))]),
            )
            .unwrap();
    }
    for n in 0..49 {
        engine.seed("memberships", row(n, None)).unwrap();
    }
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&p)
        .unwrap();
    assert_eq!(cert.max_examined, 102); // take + 2 plus the mandatory fifty-row probe
    assert_eq!(
        engine.execute(&p, &cert, context()).unwrap().trace.examined,
        49
    );
    if let Stmt::Insert { row: value, .. } = &mut p.body[1] {
        *value = Expr::Literal(row(50, None));
    }
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&p)
        .unwrap();
    let error = engine.execute(&p, &cert, context()).unwrap_err();
    assert_eq!(error.code(), "E_CONSTRAINT");
    println!("uniform reserve boundary: {error}");
    assert_eq!(engine.rows("memberships").unwrap().len(), 50);
}

#[test]
fn group_moves_probe_destination_delete_never_probes_and_seed_reupsert_is_free() {
    let schema = schema(Some(50));
    let mut engine = Engine::memory(schema.clone()).unwrap();
    for n in 0..50 {
        engine
            .seed("memberships", row(n, Some(text("full"))))
            .unwrap();
    }
    engine
        .seed("memberships", row(50, Some(text("other"))))
        .unwrap();
    let move_to = |n, group| {
        program(vec![Stmt::Update {
            table: "memberships".into(),
            key: Expr::Literal(id(&format!("m{n}"))),
            patch: Expr::Literal(object([("group", text(group))])),
        }])
    };
    let p = move_to(50, "full");
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&p)
        .unwrap();
    assert_eq!(
        engine.execute(&p, &cert, context()).unwrap_err().code(),
        "E_CONSTRAINT"
    );
    let p = move_to(0, "other");
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&p)
        .unwrap();
    assert_eq!(
        engine.execute(&p, &cert, context()).unwrap().trace.examined,
        1
    );
    let p = program(vec![Stmt::Delete {
        table: "memberships".into(),
        key: Expr::Literal(id("m1")),
    }]);
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&p)
        .unwrap();
    assert_eq!(cert.max_examined, 0);
    assert_eq!(cert.max_index_entries, 0);
    let trace = engine.execute(&p, &cert, context()).unwrap().trace;
    assert_eq!(trace.examined, 0);
    assert!(trace.constraint_inputs.is_empty());
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(schema.clone())).unwrap();
    let rows: Vec<_> = (0..50)
        .map(|n| ("memberships".into(), row(n, None)))
        .collect();
    runtime.seed(&rows).unwrap();
    // Product seed re-upserts every row in a full group without counting it twice.
    runtime.seed(&rows).unwrap();
    let p = program(vec![Stmt::Upsert {
        table: "memberships".into(),
        key: Expr::Literal(id("m2")),
        row: Expr::Literal(row(2, Some(text("full")))),
    }]);
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&p)
        .unwrap();
    assert_eq!(
        engine.execute(&p, &cert, context()).unwrap().trace.examined,
        0
    );
}

#[test]
fn two_caps_over_different_tuples_reserve_and_enforce_both() {
    let mut schema = schema(Some(2));
    let table = schema.tables.get_mut("memberships").unwrap();
    table
        .columns
        .insert("role".into(), ColumnType::Text { max: 32 });
    table.indexes.insert(
        "byRole".into(),
        Index {
            components: (vec!["role".into(), "id".into()])
                .into_iter()
                .map(snapback3_core::search_key::IndexComponent::Column)
                .collect(),
            unique: false,
        },
    );
    table.constraints.push(Constraint::Cap {
        by: vec!["role".into()],
        max: 1,
    });
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let insert = |n, group, role| {
        program(vec![Stmt::Insert {
            table: "memberships".into(),
            row: Expr::Literal(object([
                ("id", id(&format!("m{n}"))),
                ("group", text(group)),
                ("role", text(role)),
            ])),
        }])
    };
    for (n, group, role, error) in [
        (0, "a", "owner", false),
        (1, "b", "owner", true),
        (2, "a", "member", false),
        (3, "a", "guest", true),
    ] {
        let p = insert(n, group, role);
        let cert = Checker::new(&schema, Ceilings::default())
            .check(&p)
            .unwrap();
        assert_eq!(cert.max_examined, 3);
        assert_eq!(cert.max_index_entries, 3);
        let result = engine.execute(&p, &cert, context());
        if error {
            assert_eq!(result.unwrap_err().code(), "E_CONSTRAINT");
        } else {
            result.unwrap();
        }
    }
    assert_eq!(engine.rows("memberships").unwrap().len(), 2);
}
