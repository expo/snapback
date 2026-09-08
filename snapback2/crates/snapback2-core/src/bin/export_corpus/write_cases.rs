use super::*;

pub(super) fn add_write_cases(cases: &mut Vec<CorpusCase>) {
    add_maintain_value_cases(cases);
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
    let schema: Schema = serde_json::from_value(json!({
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
    })).unwrap();
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
        assert_eq!(case.expected.local_result, Some(expected));
        assert_eq!(case.expected.local_state, if mutation { "predicted" } else { "fresh" });
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
