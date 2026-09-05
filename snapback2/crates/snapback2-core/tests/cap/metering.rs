use super::*;

fn two_caps() -> Schema {
    let mut schema = schema(Some(1000));
    let table = schema.tables.get_mut("memberships").unwrap();
    table.columns.insert("period".into(), ColumnType::Int);
    table.columns.insert(
        "secondary".into(),
        ColumnType::Optional(Box::new(ColumnType::Text { max: 64 })),
    );
    table.indexes.insert(
        "bySecondary".into(),
        Index {
            columns: vec!["secondary".into(), "id".into()],
            unique: false,
        },
    );
    table.constraints.push(Constraint::Cap {
        by: vec!["secondary".into()],
        max: 1,
    });
    schema
}

#[test]
fn update_reserves_only_caps_whose_group_fields_may_be_written() {
    let schema = two_caps();
    for (patch, expected) in [
        (
            Expr::Object(BTreeMap::from([(
                "period".into(),
                Expr::Literal(Value::Int(7)),
            )])),
            0,
        ),
        (Expr::Literal(object([("period", Value::Int(7))])), 0),
        (Expr::Literal(object([("group", Value::Null)])), 1000),
        (
            Expr::Literal(object([("secondary", Value::Null), ("group", Value::Null)])),
            1001,
        ),
        // Unknown shapes remain conservative, even if their values happen to preserve the group.
        (var("patch"), 1001),
    ] {
        let mut p = program(vec![Stmt::Update {
            table: "memberships".into(),
            key: Expr::Literal(id("m0")),
            patch,
        }]);
        p.args
            .insert("patch".into(), ArgType::Json { max_bytes: 128 });
        let cert = Checker::new(&schema, Ceilings::default())
            .check(&p)
            .unwrap();
        assert_eq!(cert.max_examined, expected);
        assert_eq!(cert.max_index_entries, expected);
    }
    for statement in [
        Stmt::Insert {
            table: "memberships".into(),
            row: Expr::Literal(row(0, None)),
        },
        Stmt::Upsert {
            table: "memberships".into(),
            key: Expr::Literal(id("m0")),
            row: Expr::Literal(row(0, None)),
        },
    ] {
        let cert = Checker::new(&schema, Ceilings::default())
            .check(&program(vec![statement]))
            .unwrap();
        assert_eq!(cert.max_examined, 1001);
    }
}

#[test]
fn fifty_row_group_preserving_backfill_certifies_and_executes() {
    let schema = two_caps();
    let mut scan = scan();
    scan.index = "byId".into();
    scan.prefix.clear();
    let p = program(vec![Stmt::For {
        binding: "m".into(),
        domain: LoopDomain::Page(scan),
        body: vec![Stmt::Update {
            table: "memberships".into(),
            key: field(var("m"), "id"),
            patch: Expr::Object(BTreeMap::from([(
                "period".into(),
                Expr::Literal(Value::Int(7)),
            )])),
        }],
    }]);
    let cert = Checker::new(&schema, Ceilings::default())
        .job_chunk()
        .check(&p)
        .unwrap();
    assert_eq!(cert.max_examined, 52);
    let mut engine = Engine::memory(schema).unwrap();
    for n in 0..50 {
        let mut row = row(n, None);
        if let Value::Row(fields) = &mut row {
            fields.insert("period".into(), Value::Int(0));
            fields.insert("secondary".into(), text(&format!("s{n}")));
        }
        engine.seed("memberships", row).unwrap();
    }
    let execution = engine.execute(&p, &cert, context()).unwrap();
    assert_eq!(execution.trace.examined, 50);
    assert!(execution.trace.examined <= cert.max_examined);
    assert!(
        engine
            .rows("memberships")
            .unwrap()
            .iter()
            .all(|r| r.field("period") == Ok(&Value::Int(7)))
    );
}

#[test]
fn only_reserved_cap_probes_exclude_nonuniform_scans() {
    let mut schema = two_caps();
    schema.tables.get_mut("memberships").unwrap().rules.read = RuleExpr::Eq(
        RuleTerm::Field("group".into()),
        RuleTerm::Literal(text("visible")),
    );
    let mut scan = scan();
    scan.index = "byId".into();
    scan.prefix.clear();
    for (statement, refused) in [
        (
            Stmt::Update {
                table: "memberships".into(),
                key: Expr::Literal(id("m0")),
                patch: Expr::Literal(object([("period", Value::Int(7))])),
            },
            false,
        ),
        (
            Stmt::Delete {
                table: "memberships".into(),
                key: Expr::Literal(id("m0")),
            },
            false,
        ),
        (
            Stmt::Update {
                table: "memberships".into(),
                key: Expr::Literal(id("m0")),
                patch: Expr::Literal(object([("group", Value::Null)])),
            },
            true,
        ),
    ] {
        let p = program(vec![
            Stmt::Let {
                name: "unused".into(),
                value: Expr::Scan(scan.clone()),
            },
            statement,
        ]);
        let result = Checker::new(&schema, Ceilings::default()).check_all(&p);
        assert_eq!(result.is_err(), refused, "{result:?}");
        if let Err(errors) = result {
            assert!(errors.iter().any(|e| e.code == "E_STRUCTURAL_FANOUT"));
        }
    }
}
