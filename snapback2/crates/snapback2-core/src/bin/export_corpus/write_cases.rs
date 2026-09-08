use super::*;

pub(super) fn add_write_cases(cases: &mut Vec<CorpusCase>) {
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
                            columns: vec!["id".to_owned()],
                            unique: true,
                        },
                    ),
                    (
                        "byLabel".to_owned(),
                        Index {
                            columns: vec!["label".to_owned()],
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
