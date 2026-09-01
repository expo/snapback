//! Constraint coverage corpus fixtures.
use super::*;

pub(super) fn add_incomplete_constraint_cases(cases: &mut Vec<CorpusCase>) {
    let public = RuleExpr::Public {
        reason: "constraint coverage fixture".to_owned(),
    };
    let rules = Rules {
        read: public.clone(),
        insert: public.clone(),
        update: public.clone(),
        delete: public,
    };
    let indexes = BTreeMap::from([
        (
            "byId".to_owned(),
            Index {
                columns: vec!["id".to_owned()],
                unique: true,
            },
        ),
        (
            "bySlug".to_owned(),
            Index {
                columns: vec!["slug".to_owned()],
                unique: true,
            },
        ),
    ]);
    let unique_schema = Schema {
        tables: BTreeMap::from([(
            "items".to_owned(),
            Table {
                columns: BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("slug".to_owned(), ColumnType::Text { max: 32 }),
                ]),
                indexes,
                rules: rules.clone(),
                constraints: Vec::new(),
            },
        )]),
        ..Schema::default()
    };
    let insert = Program {
        name: "items.insert".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("slug".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Insert {
            table: "items".to_owned(),
            row: Expr::Object(BTreeMap::from([
                ("id".to_owned(), Expr::Input(Input::NewId)),
                ("slug".to_owned(), var("slug")),
            ])),
        }],
    };
    cases.push(case_from_parts(
        "scenario-incomplete-unique",
        "scenario",
        unique_schema,
        insert,
        mutation_context([("slug", text("held-elsewhere"))], ["local-item"]),
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    ));

    let capped_schema = Schema {
        tables: BTreeMap::from([(
            "members".to_owned(),
            Table {
                columns: BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("group".to_owned(), ColumnType::Id),
                ]),
                indexes: BTreeMap::from([
                    (
                        "byGroup".to_owned(),
                        Index {
                            columns: vec!["group".to_owned(), "id".to_owned()],
                            unique: false,
                        },
                    ),
                    (
                        "byId".to_owned(),
                        Index {
                            columns: vec!["id".to_owned()],
                            unique: true,
                        },
                    ),
                ]),
                rules,
                constraints: vec![Constraint::Cap {
                    by: vec!["group".to_owned()],
                    max: 1,
                }],
            },
        )]),
        ..Schema::default()
    };
    let capped_insert = Program {
        name: "members.insert".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Insert {
            table: "members".to_owned(),
            row: Expr::Object(BTreeMap::from([
                ("id".to_owned(), Expr::Input(Input::NewId)),
                ("group".to_owned(), Expr::Literal(id("g1"))),
            ])),
        }],
    };
    cases.push(case_from_parts(
        "scenario-incomplete-cap",
        "scenario",
        capped_schema,
        capped_insert,
        mutation_context([], ["local-member"]),
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    ));
}
