use super::*;

pub(super) fn add_write_cases(cases: &mut Vec<CorpusCase>) {
    add_guarded_write_cases(cases);
    add_maintain_value_cases(cases);
    add_numeric_maintain_value_cases(cases);
    let schema = write_schema();
    let absent = |index: &str, key: Value| ClosureReceipt {
        schema_hash: None,
        rows: Vec::new(),
        ranges: Vec::new(),
        absences: vec![("items".to_owned(), index.to_owned(), vec![key])],
        verdicts: Vec::new(),
    };

    cases.push(case_from_parts(
        "write-by-id-update-missing",
        "write",
        schema.clone(),
        update_program("writeByIdUpdateMissing", "missing"),
        mutation_context([], Vec::<String>::new()),
        absent("byId", id("missing")),
        Vec::new(),
        None,
        None,
    ));
    cases.push(case_from_parts(
        "write-by-id-delete-missing",
        "write",
        schema.clone(),
        delete_program("writeByIdDeleteMissing", "missing"),
        mutation_context([], Vec::<String>::new()),
        absent("byId", id("missing")),
        Vec::new(),
        None,
        None,
    ));
    cases.push(case_from_parts(
        "write-alternate-key-missing",
        "write",
        schema.clone(),
        alternate_missing_program(),
        mutation_context([], Vec::<String>::new()),
        absent("byLabel", text("missing")),
        Vec::new(),
        None,
        None,
    ));
    let mut upsert_absence = absent("byId", id("upserted"));
    upsert_absence.absences.push((
        "items".to_owned(),
        "byLabel".to_owned(),
        vec![text("inserted")],
    ));
    cases.push(case_from_parts(
        "write-upsert-absent-inserts",
        "write",
        schema.clone(),
        upsert_program(),
        mutation_context([], Vec::<String>::new()),
        upsert_absence,
        Vec::new(),
        None,
        None,
    ));
    cases.push(case_from_parts(
        "write-by-id-update-unheld-partial",
        "write",
        schema,
        update_program("writeByIdUpdateUnheld", "unheld"),
        mutation_context([], Vec::<String>::new()),
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    ));
}

// @ref LLP 1011#one-spelling — the point-read value is zero on absence and
// observes earlier writes. The compiler runs its actual lowering against these receipts too.
fn add_maintain_value_cases(cases: &mut Vec<CorpusCase>) {
    let schema = maintain_value_schema();
    let count_id = canonical_json(&vec![id("u1")]);
    let held_count = row([
        ("id", id(&count_id)), ("owner", id("u1")), ("value", Value::Int(1)),
    ]);
    let receipt = ClosureReceipt {
        rows: vec![RowRecord { table: "counts".into(), id: count_id, row: held_count.clone() }],
        absences: vec![
            ("counts".into(), "byId".into(), vec![id(canonical_json(&vec![id("u2")]))]),
            ("ledger".into(), "byId".into(), vec![id("new-entry")]),
        ],
        ..ClosureReceipt::default()
    };
    for mutation in [false, true] {
        let (name, kind, context, present) = if mutation {
            ("maintain-value-after-write", ProgramKind::Mutation,
                mutation_context([("other", id(canonical_json(&vec![id("u2")])))], ["new-entry"]), 2)
        } else {
            ("maintain-value-query", ProgramKind::Query,
                query_context([("other", id(canonical_json(&vec![id("u2")])))]), 1)
        };
        let mut body = Vec::new();
        if mutation {
            body.push(Stmt::Insert { table: "ledger".into(), row: Expr::Object(BTreeMap::from([
                ("id".into(), Expr::Input(Input::NewId)), ("owner".into(), Expr::Input(Input::Viewer)),
            ])) });
        }
        // Exercise group-key resolution on a hit and the intrinsic key on a miss.
        // Primary absences are the public persistent store's supported receipt form.
        for (label, index, key, provenance) in [
            ("present", "byOwner", Expr::Input(Input::Viewer), KeyProvenance::Viewer),
            ("absent", "byId", var("other"), KeyProvenance::Arg),
        ] {
            let binding = format!("{label}Row");
            body.extend([
                Stmt::Let { name: binding.clone(), value: Expr::Get(Read {
                    site: label.into(), table: "counts".into(), index: index.into(), key: vec![key], provenance,
                }) },
                Stmt::Let { name: label.into(), value: Expr::Literal(Value::Int(0)) },
                Stmt::If {
                    condition: Expr::Binary { op: BinaryOp::Ne,
                        left: Box::new(var(&binding)), right: Box::new(Expr::Literal(Value::Null)) },
                    then_body: vec![Stmt::Assign { name: label.into(), value: Expr::Field {
                        base: Box::new(var(&binding)), name: "value".into(),
                    } }], else_body: Vec::new(),
                },
            ]);
        }
        body.push(Stmt::Return(Expr::Object(BTreeMap::from([
            ("present".into(), var("present")), ("absent".into(), var("absent")),
        ]))));
        let program = Program { name: name.into(), kind,
            args: BTreeMap::from([("other".into(), ArgType::Ref { table: "counts".into() })]),
            read_time_granularity_ms: None, body };
        let expected = row([("present", Value::Int(present)), ("absent", Value::Int(0))]);
        let mut engine = Engine::memory(schema.clone()).unwrap();
        engine.seed("ledger", row([("id", id("old-entry")), ("owner", id("u1"))])).unwrap();
        engine.seed("counts", held_count.clone()).unwrap();
        let execution = authoritative(&mut engine, &schema, &program, context.clone());
        assert_eq!(execution.result, expected);
        let case = case_from_parts(name, "maintain", schema.clone(), program, context,
            receipt.clone(), Vec::new(), None, None);
        assert_eq!(case.expected.local_result, Some(expected.clone()));
        assert_eq!(case.expected.local_state, if mutation { "predicted" } else { "fresh" });
        if !mutation {
            let name = "maintain-value-group-query";
            let mut grouped = case.program.clone();
            grouped.name = name.into();
            grouped.args.insert("other".into(), ArgType::Principal);
            for statement in &mut grouped.body {
                if let Stmt::Let { value: Expr::Get(read), .. } = statement {
                    if read.index == "byId" { read.index = "byOwner".into(); }
                }
            }
            let context = query_context([("other", id("u2"))]);
            let execution = authoritative(&mut engine, &schema, &grouped, context.clone());
            assert_eq!(execution.result, expected);
            assert!(execution.receipt.absences.contains(&("counts".into(), "byOwner".into(), vec![id("u2")])));
            let grouped = case_from_parts(name, "maintain", schema.clone(), grouped, context,
                execution.receipt, Vec::new(), None, None);
            assert_eq!(grouped.expected.local_state, "fresh");
            assert_eq!(grouped.expected.local_result, Some(expected));
            cases.push(grouped);
        }
        cases.push(case);
    }
}

fn maintain_value_schema() -> Schema {
    serde_json::from_value(json!({
        "tables": {
            "ledger": {
                "columns": { "id": "Id", "owner": "Principal" },
                "indexes": { "byId": { "components": [{"Column": "id"}], "unique": true } },
                "rules": { "read": {"Public": {"reason": "maintain value corpus"}},
                    "insert": "Allow", "update": "Deny", "delete": "Deny" }, "constraints": []
            },
            "counts": {
                "columns": { "id": "Id", "owner": "Principal", "value": "Int" },
                "indexes": {
                    "byId": { "components": [{"Column": "id"}], "unique": true },
                    "byOwner": { "components": [{"Column": "owner"}], "unique": true }
                },
                "rules": { "read": "Allow", "insert": "Deny", "update": "Deny", "delete": "Deny" },
                "constraints": [{"Unique": {"index": "byOwner"}}]
            }
        },
        "maintains": [{"kind": "Count", "source": "ledger", "by": ["owner"], "target": "counts", "readable": null}]
    })).unwrap()
}

fn maintain_value_read(label: &str, table: &str, index: &str, key: Expr, provenance: KeyProvenance) -> Vec<Stmt> {
    let binding = format!("{label}Row");
    vec![
        Stmt::Let { name: binding.clone(), value: Expr::Get(Read {
            site: label.into(), table: table.into(), index: index.into(), key: vec![key], provenance,
        }) },
        Stmt::Let { name: label.into(), value: Expr::Literal(Value::Int(0)) },
        Stmt::If {
            condition: Expr::Binary { op: BinaryOp::Ne,
                left: Box::new(var(&binding)), right: Box::new(Expr::Literal(Value::Null)) },
            then_body: vec![Stmt::Assign { name: label.into(), value: Expr::Field {
                base: Box::new(var(&binding)), name: "value".into(),
            } }], else_body: Vec::new(),
        },
    ]
}

// The schema carries the brands; exact Money/Decimal values use scaled Ints in IR.
// Authoritative reads supply the receipts used by the native and TypeScript twins.
fn add_numeric_maintain_value_cases(cases: &mut Vec<CorpusCase>) {
    let mut schema = maintain_value_schema();
    let money = ColumnType::Money { currency: "USD".into(), scale: 2 };
    let decimal = ColumnType::Decimal { scale: 3 };
    let ledger = schema.tables.get_mut("ledger").unwrap();
    ledger.rules.read = RuleExpr::Public { reason: "ledger is public in Quarry".into() };
    ledger.columns.extend([("amount".into(), money.clone()), ("decimal".into(), decimal.clone()), ("value".into(), ColumnType::Int)]);
    for (name, column, descriptor) in [("balances", "amount", money), ("decimals", "decimal", decimal)] {
        let mut target = schema.tables["counts"].clone();
        target.columns.insert("value".into(), descriptor);
        schema.tables.insert(name.into(), target);
        schema.maintains.push(Maintain { kind: MaintainKind::Sum { of: column.into() },
            source: "ledger".into(), by: vec!["owner".into()], target: name.into(), readable: None });
    }
    for target in ["counts", "balances", "decimals"] {
        schema.tables.get_mut(target).unwrap().rules.read = RuleExpr::Eq(RuleTerm::Field("owner".into()), RuleTerm::Viewer);
    }
    let fields = [("count", "counts"), ("money", "balances"), ("decimal", "decimals")];
    let read = |owner: Expr, provenance: KeyProvenance| fields.iter().flat_map(|(label, table)|
        maintain_value_read(label, table, "byOwner", owner.clone(), provenance)).collect::<Vec<_>>();
    let result = || Expr::Object(fields.iter().map(|(label, _)| ((*label).into(), var(label))).collect());
    let seed = |engine: &mut Engine, owner: &str| {
        engine.seed("ledger", row([("id", id("old-entry")), ("owner", id(owner)),
            ("amount", Value::Int(250)), ("decimal", Value::Int(1125)), ("value", Value::Int(9))])).unwrap();
        for (target, value) in [("counts", 1), ("balances", 250), ("decimals", 1125)] {
            engine.seed(target, row([("id", id(canonical_json(&vec![id(owner)]))),
                ("owner", id(owner)), ("value", Value::Int(value))])).unwrap();
        }
    };
    let query = |name: &str, owner: Expr, args, provenance| {
        let mut body = read(owner, provenance);
        // Give these point-only queries the same stable site names as native
        // coverage misses; the public Twin reports certificate site names.
        for statement in &mut body {
            if let Stmt::Let { value: Expr::Get(read), .. } = statement {
                read.site = format!("{}.{}", read.table, read.index);
            }
        }
        body.push(Stmt::Return(result()));
        Program { name: name.into(), kind: ProgramKind::Query, args, read_time_granularity_ms: None, body }
    };
    let value_query = query("values", Expr::Input(Input::Viewer), BTreeMap::new(), KeyProvenance::Viewer);
    // Prediction needs custody at the maintained write address as well as the
    // grouping read. Obtain both from real reads, including primary absences.
    let mut custody_query = value_query.clone();
    for (_, target) in fields {
        custody_query.body.insert(0, Stmt::Let { name: format!("{target}Address"), value: Expr::Get(Read {
            site: format!("{target}Address"), table: target.into(), index: "byId".into(),
            key: vec![Expr::Literal(id(canonical_json(&vec![id("u1")])))], provenance: KeyProvenance::Const,
        }) });
    }
    for present in [false, true] {
        let name = if present { "maintain-numeric-after-write-present" } else { "maintain-numeric-after-write-absent" };
        let mut engine = Engine::memory(schema.clone()).unwrap();
        if present { seed(&mut engine, "u1"); }
        let before = authoritative(&mut engine, &schema, &custody_query, query_context([]));
        let mut receipt = before.receipt;
        receipt.absences.push(("ledger".into(), "byId".into(), vec![id("new-entry")]));
        let mut body = maintain_value_read("before", "counts", "byOwner", Expr::Input(Input::Viewer), KeyProvenance::Viewer);
        body.push(Stmt::Insert { table: "ledger".into(), row: Expr::Object(BTreeMap::from([
            ("id".into(), Expr::Input(Input::NewId)), ("owner".into(), Expr::Input(Input::Viewer)),
            ("amount".into(), Expr::Literal(Value::Int(250))), ("decimal".into(), Expr::Literal(Value::Int(1125))),
            ("value".into(), Expr::Literal(Value::Int(9))),
        ])) });
        body.extend(read(Expr::Input(Input::Viewer), KeyProvenance::Viewer));
        body.push(Stmt::Return(Expr::Object(BTreeMap::from([
            ("before".into(), var("before")), ("after".into(), var("count")),
            ("money".into(), var("money")), ("decimal".into(), var("decimal")),
        ]))));
        let program = Program { name: name.into(), kind: ProgramKind::Mutation,
            args: BTreeMap::new(), read_time_granularity_ms: None, body };
        let context = mutation_context([], ["new-entry"]);
        let execution = authoritative(&mut engine, &schema, &program, context.clone());
        let n = if present { 2 } else { 1 };
        assert_eq!(execution.result, row([("before", Value::Int(n - 1)), ("after", Value::Int(n)),
            ("money", Value::Int(250 * n)), ("decimal", Value::Int(1125 * n))]));
        let case = case_from_parts(name, "maintain", schema.clone(), program, context, receipt, Vec::new(), None, None);
        assert_eq!(case.expected.local_state, "predicted");
        assert_eq!(case.expected.local_result, Some(execution.result));
        cases.push(case);
    }
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let program = query("valuesFor", var("owner"), BTreeMap::from([("owner".into(), ArgType::Principal)]), KeyProvenance::Arg);
    let context = query_context([("owner", id("u2"))]);
    let absent = authoritative(&mut engine, &schema, &program, context.clone());
    seed(&mut engine, "u2");
    let hidden = authoritative(&mut engine, &schema, &program, context.clone());
    let zero = row([("count", Value::Int(0)), ("money", Value::Int(0)), ("decimal", Value::Int(0))]);
    assert_eq!(absent.result, zero);
    assert_eq!(hidden.result, zero);
    // An unreadable group's payload and existence never enter the closure;
    // only genuine absence may supply a negative fact (LLP 1001 §3).
    assert!(hidden.receipt.rows.is_empty() && hidden.receipt.absences.is_empty());
    assert_eq!(hidden.trace.points.len(), 3);
    assert!(hidden.trace.points.iter().all(|point| point.examined && !point.visible && point.index == "byOwner"));
    for (name, execution, state) in [("maintain-numeric-group-absent", absent, "fresh"),
        ("maintain-numeric-group-unreadable", hidden, "partial")] {
        let case = case_from_parts(name, "maintain", schema.clone(), program.clone(), context.clone(), execution.receipt, Vec::new(), None, None);
        assert_eq!(case.expected.local_state, state);
        if state == "partial" { assert_eq!(case.expected.partial_sites.len(), 3); }
        assert_eq!(case.expected.local_result, Some(zero.clone()));
        cases.push(case);
    }
}

fn write_schema() -> Schema {
    let public = RuleExpr::Public {
        reason: "write corpus fixture".to_owned(),
    };
    Schema {
        tables: BTreeMap::from([(
            "items".to_owned(),
            Table {
                columns: BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("label".to_owned(), ColumnType::Text { max: 40 }),
                ]),
                indexes: BTreeMap::from([
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
                        "byLabel".to_owned(),
                        Index {
                            components: (vec!["label".to_owned()])
                                .into_iter()
                                .map(snapback2_core::search_key::IndexComponent::Column)
                                .collect(),
                            unique: true,
                        },
                    ),
                ]),
                rules: Rules {
                    read: public.clone(),
                    insert: public.clone(),
                    update: public.clone(),
                    delete: public,
                },
                constraints: Vec::new(),
                retain: Default::default(),
                tombstones: Vec::new(),
            },
        )]),
        ..Schema::default()
    }
}

fn update_program(name: &str, row_id: &str) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Update {
            table: "items".to_owned(),
            key: Expr::Literal(id(row_id)),
            patch: Expr::Object(BTreeMap::from([(
                "label".to_owned(),
                Expr::Literal(text("changed")),
            )])),
        }],
    }
}

fn delete_program(name: &str, row_id: &str) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Delete {
            table: "items".to_owned(),
            key: Expr::Literal(id(row_id)),
        }],
    }
}

fn alternate_missing_program() -> Program {
    Program {
        name: "writeAlternateKeyMissing".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "current".to_owned(),
                value: Expr::Get(Read {
                    site: "write.alternate.lookup".to_owned(),
                    table: "items".to_owned(),
                    index: "byLabel".to_owned(),
                    key: vec![Expr::Literal(text("missing"))],
                    provenance: KeyProvenance::Const,
                }),
            },
            Stmt::Require {
                site: None,
                condition: Expr::Binary {
                    op: BinaryOp::Ne,
                    left: Box::new(var("current")),
                    right: Box::new(Expr::Literal(Value::Null)),
                },
                code: "NOT_FOUND".to_owned(),
            },
        ],
    }
}

fn upsert_program() -> Program {
    Program {
        name: "writeUpsertAbsentInserts".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Upsert {
            table: "items".to_owned(),
            key: Expr::Literal(id("upserted")),
            row: Expr::Object(BTreeMap::from([
                ("id".to_owned(), Expr::Literal(id("upserted"))),
                ("label".to_owned(), Expr::Literal(text("inserted"))),
            ])),
        }],
    }
}

fn add_guarded_write_cases(cases: &mut Vec<CorpusCase>) {
    let schema = write_schema();
    let program = Program { name: "guarded.insert".into(), kind: ProgramKind::Mutation,
        args: BTreeMap::new(), read_time_granularity_ms: None, body: vec![
            Stmt::InsertIfAbsent { table: "items".into(), result: "created".into(),
                row: Expr::Object(BTreeMap::from([("id".into(), Expr::Literal(id("new"))),
                    ("label".into(), Expr::Literal(text("same")))])) }, Stmt::Return(var("created"))] };
    let absent = ClosureReceipt { absences: vec![("items".into(), "byId".into(), vec![id("new")]),
        ("items".into(), "byLabel".into(), vec![text("same")])], ..ClosureReceipt::default() };
    let held = ClosureReceipt { rows: vec![RowRecord { table: "items".into(), id: "old".into(),
        row: row([("id", id("old")), ("label", text("same"))]) }], ..absent.clone() };
    for (name, receipt, state) in [("write-insert-if-absent-created", absent, "predicted"),
        ("write-insert-if-absent-conflicting-key", held.clone(), "predicted"),
        ("write-insert-if-absent-unheld", ClosureReceipt::default(), "partial")] {
        let case = case_from_parts(name, "write", schema.clone(), program.clone(), mutation_context([], Vec::<String>::new()),
            receipt, Vec::new(), None, None);
        assert_eq!(case.expected.local_state, state);
        cases.push(case);
    }
    let current = Read { site: "current".into(), table: "items".into(), index: "byId".into(),
        key: vec![Expr::Literal(id("old"))], provenance: KeyProvenance::Const };
    let guarded = Program { name: "guarded.update".into(), body: vec![
        Stmt::Check { condition: Expr::Literal(Value::Bool(false)), current },
        Stmt::Delete { table: "items".into(), key: Expr::Literal(id("old")) }], ..program };
    let case = case_from_parts("write-update-condition-rejected", "write", schema, guarded,
        mutation_context([], Vec::<String>::new()), held, Vec::new(), None, None);
    assert_eq!(case.expected.local_state, "rejected");
    assert_eq!(case.expected.error_code.as_deref(), Some("E_CONFLICT"));
    cases.push(case);
}
