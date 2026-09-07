//! Adversarial raw IR from the blind CAP2 review, plus proof boundary witnesses.
use super::*;

pub(super) fn add(cases: &mut Vec<CorpusCase>) {
    for mode in [
        "arglist",
        "assign-in-loop",
        "assign-in-branch",
        "loop-binding-escapes",
        "shape-redeclared",
        "before",
        "range",
        "missing-table",
        "missing-index",
        "missing-table-elsewhere",
        "missing-index-elsewhere",
    ] {
        let name = format!("fanout-refused-{mode}");
        let mut schema = schema(50);
        let mut read = scan("members.page");
        let mut body = vec![];
        let domain = match mode {
            "arglist" => {
                schema
                    .tables
                    .get_mut("memberships")
                    .unwrap()
                    .constraints
                    .clear();
                body.push(Stmt::Let {
                    name: "page".into(),
                    value: Expr::Scan(read),
                });
                LoopDomain::ArgList {
                    name: "page".into(),
                    max: 50,
                }
            }
            "assign-in-loop" | "assign-in-branch" | "loop-binding-escapes" => {
                schema
                    .tables
                    .get_mut("memberships")
                    .unwrap()
                    .constraints
                    .clear();
                body.push(Stmt::Let {
                    name: "page".into(),
                    value: Expr::Array(vec![]),
                });
                let assign = Stmt::Assign {
                    name: "page".into(),
                    value: Expr::Scan(read),
                };
                body.push(if mode == "assign-in-branch" {
                    Stmt::If {
                        condition: Expr::Literal(Value::Bool(true)),
                        then_body: vec![assign],
                        else_body: vec![],
                    }
                } else {
                    let writes = if mode == "assign-in-loop" {
                        vec![
                            assign,
                            Stmt::Break,
                            Stmt::Assign {
                                name: "page".into(),
                                value: Expr::Array(vec![]),
                            },
                        ]
                    } else {
                        vec![assign]
                    };
                    Stmt::For {
                        binding: if mode == "loop-binding-escapes" {
                            "page"
                        } else {
                            "i"
                        }
                        .into(),
                        domain: LoopDomain::LiteralRange {
                            start: 0,
                            end_exclusive: 1,
                        },
                        body: writes,
                    }
                });
                derived("page")
            }
            "shape-redeclared" => {
                body.push(Stmt::Let {
                    name: "page".into(),
                    value: Expr::Scan(read),
                });
                body.push(Stmt::Let {
                    name: "shaped".into(),
                    value: Expr::Array(vec![]),
                });
                body.push(Stmt::For {
                    binding: "row".into(),
                    domain: derived("page"),
                    body: vec![
                        Stmt::Let {
                            name: "shaped".into(),
                            value: Expr::Array(vec![]),
                        },
                        Stmt::Push {
                            target: "shaped".into(),
                            value: Expr::Object(BTreeMap::from([(
                                "id".into(),
                                field(var("row"), "id"),
                            )])),
                        },
                    ],
                });
                derived("shaped")
            }
            "before" => {
                read.before = Some(Box::new(Expr::Literal(id("m2"))));
                LoopDomain::Page(read)
            }
            "range" => {
                read.range = Some(Range {
                    gt: Some(Box::new(Expr::Literal(id("u0")))),
                    gte: None,
                    lt: None,
                    lte: None,
                });
                LoopDomain::Page(read)
            }
            _ => {
                let mut ghost = read.clone();
                ghost.site = "ghost.page".into();
                if mode.contains("missing-table") {
                    ghost.table = "ghost".into();
                } else {
                    ghost.index = "ghost".into();
                }
                if mode.ends_with("elsewhere") {
                    body.push(Stmt::Let {
                        name: "unused".into(),
                        value: Expr::Scan(ghost),
                    });
                    LoopDomain::Page(read)
                } else {
                    LoopDomain::Page(ghost)
                }
            }
        };
        body.push(fanout(domain));
        let (code, reason) = match mode {
            "arglist" => ("E_STRUCTURAL_FANOUT", "has no cap over conversationId"),
            "shape-redeclared" => ("E_STRUCTURAL_FANOUT", "`shaped` is not a single page scan"),
            "before" => ("E_STRUCTURAL_FANOUT", "the loop reads before a cursor"),
            "range" => ("E_STRUCTURAL_FANOUT", "the loop reads a key range"),
            "missing-table" => ("E_STRUCTURAL_FANOUT", "missing table ghost"),
            "missing-index" => ("E_STRUCTURAL_FANOUT", "missing index memberships.ghost"),
            "missing-table-elsewhere" | "missing-index-elsewhere" => {
                ("E_UNBOUND_SCAN", "read requires missing index")
            }
            _ => ("E_STRUCTURAL_FANOUT", "`page` is not a single page scan"),
        };
        cases.push(refused(&name, schema, program(&name, body), code, reason));
    }
    let mut schema = schema(50);
    let mut other = schema.tables["memberships"].clone();
    other.rules.read = RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer);
    schema.tables.insert("other".into(), other);
    let mut read = scan("other.page");
    read.table = "other".into();
    let name = "cap-refused-nonuniform-elsewhere";
    cases.push(refused(name, schema, program(name, vec![
        Stmt::Let { name: "unused".into(), value: Expr::Scan(read) },
        Stmt::Insert { table: "memberships".into(), row: Expr::Literal(member(49, false)) },
    ]), "E_STRUCTURAL_FANOUT", "the non-uniform scan at other.page can spend the budget the cap check on memberships needs"));
    reordered(cases);
    quarry_lowered(cases);
}

fn reordered(cases: &mut Vec<CorpusCase>) {
    for tuple in [false, true] {
        let name = if tuple {
            "fanout-complete-reordered-tuple"
        } else {
            "fanout-complete-nonleading-group"
        };
        let mut schema = schema(50);
        let table = schema.tables.get_mut("memberships").unwrap();
        table.indexes.insert(
            "byRoleConversation".into(),
            index(&["role", "conversationId", "id"], false),
        );
        if tuple {
            table.constraints = vec![Constraint::Cap {
                by: vec!["conversationId".into(), "role".into()],
                max: 50,
            }];
        }
        let mut read = scan("members.reordered");
        read.index = "byRoleConversation".into();
        read.prefix = vec![Expr::Literal(text("member")), Expr::Literal(id("c1"))]
            .into_iter()
            .map(IndexKeyExpr::Scalar)
            .collect();
        let p = program(name, vec![fanout(LoopDomain::Page(read.clone()))]);
        let mut engine = Engine::memory(schema.clone()).unwrap();
        for n in 0..3 {
            engine.seed("memberships", member(n, false)).unwrap();
        }
        let receipt = snapshot(&mut engine, &schema, read);
        let cert = Checker::new(&schema, Ceilings::default())
            .check(&p)
            .unwrap();
        assert!(cert.read_sites[0].complete);
        engine.execute(&p, &cert, context()).unwrap();
        assert_eq!(engine.rows("deliveries").unwrap().len(), 3);
        cases.push(case_from_parts(
            name,
            "fanout",
            schema,
            p,
            context(),
            receipt,
            vec![],
            None,
            None,
        ));
    }
}

fn quarry_lowered(cases: &mut Vec<CorpusCase>) {
    let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    // Regeneration calls the actual source compiler, not a hand-transcribed schema.
    let output = std::process::Command::new("bun")
        .arg("packages/compiler/src/worker.ts")
        .arg("--project")
        .arg(workspace.join("packages/compiler/fixtures/quarry-fanout"))
        .current_dir(&workspace)
        .output()
        .expect("run Quarry compiler");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let lowered: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let schema: Schema = serde_json::from_value(lowered["project"]["schema"].clone()).unwrap();
    assert!(
        schema.tables["memberships"]
            .constraints
            .iter()
            .any(|c| matches!(c, Constraint::Cap { max: 50, .. }))
    );
    let name = "cap-quarry-lowered-metered-insert";
    let p = program(
        name,
        vec![Stmt::Insert {
            table: "memberships".into(),
            row: Expr::Literal(member(49, false)),
        }],
    );
    let mut engine = Engine::memory(schema.clone()).unwrap();
    for n in 0..49 {
        engine.seed("memberships", member(n, false)).unwrap();
    }
    let mut receipt = snapshot(&mut engine, &schema, scan("members.quarry"));
    // The Quarry fixture also declares a unique key. Supply its exact absence,
    // so both clients can predict the insert from the same authority footprint.
    let mut absent = program(
        "unique.absent",
        vec![Stmt::Return(Expr::Get(Read {
            site: "unique.absent".into(),
            table: "memberships".into(),
            index: "byConversationPrincipal".into(),
            key: vec![Expr::Literal(id("c1")), Expr::Literal(id("u49"))],
            provenance: KeyProvenance::Const,
        }))],
    );
    absent.kind = ProgramKind::Query;
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&absent)
        .unwrap();
    receipt.absences.extend(
        engine
            .execute(&absent, &cert, context())
            .unwrap()
            .receipt
            .absences,
    );
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&p)
        .unwrap();
    assert_eq!(cert.max_examined, 50);
    assert_eq!(
        engine.execute(&p, &cert, context()).unwrap().trace.examined,
        49
    );
    cases.push(case_from_parts(
        name,
        "cap",
        schema,
        p,
        context(),
        receipt,
        vec![],
        None,
        None,
    ));
}
