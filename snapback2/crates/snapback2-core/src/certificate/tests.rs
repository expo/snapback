use super::*;
use crate::ir::IndexKeyExpr;
use crate::{ColumnType, Index, RuleTerm, Value, public_table};

fn schema() -> Schema {
    let table = |cols: &[(&str, ColumnType)]| {
        public_table(
            std::iter::once(("id".into(), ColumnType::Id))
                .chain(cols.iter().map(|(n, t)| ((*n).into(), t.clone())))
                .collect(),
            BTreeMap::from([(
                "byId".into(),
                Index {
                    components: (vec!["id".into()])
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            )]),
        )
    };
    Schema {
        tables: BTreeMap::from([
            (
                "follows".into(),
                table(&[("follower", ColumnType::Principal)]),
            ),
            (
                "messages".into(),
                table(&[("body", ColumnType::Text { max: 1000 })]),
            ),
            (
                "reactions".into(),
                table(&[("emoji", ColumnType::Text { max: 2000 })]),
            ),
            (
                "receipts".into(),
                table(&[("detail", ColumnType::Text { max: 2000 })]),
            ),
        ]),
        ..Schema::default()
    }
}
fn scan(table: &str, take: u32) -> Scan {
    Scan {
        site: format!("{table}.page"),
        table: table.into(),
        index: "byId".into(),
        prefix: (vec![]).into_iter().map(IndexKeyExpr::Scalar).collect(),
        order: Order::Asc,
        take: Bound::Literal(take),
        after: None,
        before: None,
        range: None,
        opaque_cursor: false,
        merge_site: None,
        provenance: KeyProvenance::Const,
    }
}
fn program(body: Vec<Stmt>) -> Program {
    Program {
        name: "diagnostic.test".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body,
    }
}
#[test]
fn merge_refusal_names_lanes_discovery_and_structural_repairs() {
    let schema = schema();
    let mut lane = scan("messages", 20);
    lane.merge_site = Some("feed.merge".into());
    let p = program(vec![Stmt::Return(Expr::Merge(Merge {
        held_search: None,
        site: "feed.merge".into(),
        lanes: vec![MergeLane {
            setup: Vec::new(),
            scan: lane,
            source: Some(scan("follows", 500)),
            binding: "f".into(),
        }],
    }))]);
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&p)
        .unwrap();
    assert_eq!(certificate.max_examined, 1024);
    assert_eq!(certificate.merge_sites[0].max_lanes, 500);
    let errors = Checker::new(
        &schema,
        Ceilings {
            examined: 1000,
            index_entries: 1000,
            ..Ceilings::default()
        },
    )
    .check_all(&p)
    .unwrap_err();
    for meter in ["examined entries", "index entries"] {
        let error = errors
            .iter()
            .find(|e| e.message.starts_with(meter))
            .unwrap();
        assert!(error.message.contains("500 lanes heads"), "{error}");
        assert!(
            error
                .message
                .contains("follows.page take 500 (+2 reserve) × 1 calls"),
            "{error}"
        );
        assert!(
            error.message.find("500 lanes").unwrap()
                < error.message.find("follows.page take 500").unwrap()
        );
        for repair in [
            "structural repair",
            "smaller lane bound",
            "smaller page",
            "two reads",
            "two snapshots",
            "maintained feed",
        ] {
            assert!(error.rewrite.contains(repair), "{error}");
        }
        assert!(!error.rewrite.contains("maintain.count"));
    }
}
#[test]
fn cap_reserve_refusal_names_cap_and_fitting_chunk() {
    let mut schema = schema();
    schema
        .tables
        .get_mut("follows")
        .unwrap()
        .constraints
        .push(Constraint::Cap {
            by: vec!["follower".into()],
            max: 1000,
        });
    // Construct the former backfill reserve directly: an unknown update patch must still reserve it.
    let mut analyzer = Analyzer::new(&schema);
    let summary = analyzer
        .scan(&scan("follows", 50), 1, &[])
        .unwrap()
        .add(analyzer.write(
            "follows",
            WriteKind::Update,
            None,
            50,
            &[("fill.chunk take".into(), 50)],
        ));
    let error = Checker::new(&schema, Ceilings::default())
        .check_ceiling("examined entries", summary.examined, 10240, &summary, None)
        .unwrap_err();
    assert!(
        error
            .message
            .contains("50 calls × cap 1000 by follower on follows"),
        "{error}"
    );
    assert!(error.message.contains("follows.page take 50 (+2 reserve)"));
    assert!(
        error.rewrite.contains("chunk from 50 to at most 10"),
        "{error}"
    );
    assert!(error.rewrite.contains("cap 1000 by follower on follows"));
    assert!(
        error
            .rewrite
            .contains("maintain followsCounts = count follows by follower:\n  read <- deny"),
        "{error}"
    );
    assert!(error.rewrite.contains("prices at one row per write"));
}
#[test]
fn nested_output_names_both_sublists_and_their_wide_fields() {
    let schema = schema();
    let p = program(vec![
        Stmt::Let {
            name: "result".into(),
            value: Expr::Array(vec![]),
        },
        Stmt::For {
            binding: "m".into(),
            domain: LoopDomain::Page(scan("messages", 20)),
            body: vec![Stmt::Push {
                target: "result".into(),
                value: Expr::Object(BTreeMap::from([
                    ("body".into(), crate::field(crate::var("m"), "body")),
                    ("reactions".into(), Expr::Scan(scan("reactions", 50))),
                    ("receipts".into(), Expr::Scan(scan("receipts", 50))),
                ])),
            }],
        },
        Stmt::Return(crate::var("result")),
    ]);
    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&p)
        .unwrap_err();
    for meter in ["output bytes", "closure bytes"] {
        let e = errors
            .iter()
            .find(|e| e.message.starts_with(meter))
            .unwrap();
        for label in ["reactions", "receipts", "emoji", "detail"] {
            assert!(e.message.contains(label), "{e}");
        }
        assert!(e.rewrite.contains("widest nested collection"), "{e}");
        assert!(
            e.rewrite.contains("emoji") || e.rewrite.contains("detail"),
            "{e}"
        );
        assert!(!e.rewrite.contains("return null"));
    }
    let e = errors
        .iter()
        .find(|e| e.message.starts_with("output bytes"))
        .unwrap();
    assert!(e.message.contains("messages first 20"), "{e}");
    assert!(e.message.contains("reactions first 50"), "{e}");
}
#[test]
fn branch_products_follow_each_meters_winning_arm() {
    let mut schema = schema();
    schema.tables.get_mut("messages").unwrap().rules.read = RuleExpr::Exists {
        table: "follows".into(),
        index: "byId".into(),
        key: vec![RuleTerm::Literal(Value::Id("f".into()))],
        provenance: KeyProvenance::Const,
    };
    let p = program(vec![Stmt::If {
        condition: Expr::Literal(Value::Bool(true)),
        then_body: vec![Stmt::Return(Expr::Scan(scan("messages", 20)))],
        else_body: vec![Stmt::Return(Expr::Scan(scan("receipts", 50)))],
    }]);
    let errors = Checker::new(
        &schema,
        Ceilings {
            examined: 1,
            rule_probes: 0,
            ..Ceilings::default()
        },
    )
    .check_all(&p)
    .unwrap_err();
    let examined = errors
        .iter()
        .find(|e| e.message.starts_with("examined entries"))
        .unwrap();
    assert!(examined.message.contains("receipts.page"));
    assert!(!examined.message.contains("messages.page"));
    let probes = errors
        .iter()
        .find(|e| e.message.starts_with("rule probes"))
        .unwrap();
    assert!(
        probes
            .message
            .contains("messages.page: 1 calls × 1 rule probes")
    );
}

#[test]
fn output_merge_scan_names_the_structural_repair() {
    let schema = schema();
    let mut lane = scan("messages", 500);
    lane.merge_site = Some("wide.merge".into());
    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&program(vec![Stmt::Return(Expr::Merge(Merge {
            held_search: None,
            site: "wide.merge".into(),
            lanes: vec![MergeLane {
                setup: Vec::new(),
                scan: lane,
                source: None,
                binding: String::new(),
            }],
        }))]))
        .unwrap_err();
    let error = errors
        .iter()
        .find(|e| e.message.starts_with("output bytes"))
        .unwrap();
    assert!(error.message.contains("merge wide.merge"), "{error}");
    assert!(error.rewrite.contains("structural repair"), "{error}");
    assert!(error.rewrite.contains("two snapshots"), "{error}");
    assert!(!error.rewrite.contains("return null"));
}

#[test]
fn simultaneous_merge_work_and_output_refusals_keep_their_own_products() {
    let schema = schema();
    let mut lane = scan("messages", 20);
    lane.merge_site = Some("feed.merge".into());
    let p = program(vec![Stmt::Return(Expr::Merge(Merge {
        held_search: None,
        site: "feed.merge".into(),
        lanes: vec![MergeLane {
            setup: Vec::new(),
            scan: lane,
            source: Some(scan("follows", 500)),
            binding: "f".into(),
        }],
    }))]);
    // Isolate these two meters; the default ceilings also refuse index/closure bytes.
    let errors = Checker::new(
        &schema,
        Ceilings {
            examined: 1000,
            output_bytes: 80_000,
            index_entries: u64::MAX,
            closure_bytes: u64::MAX,
            ..Ceilings::default()
        },
    )
    .check_all(&p)
    .unwrap_err();
    assert_eq!(errors.len(), 2, "{errors:?}");
    let examined = errors
        .iter()
        .find(|e| e.message.starts_with("examined entries"))
        .unwrap();
    let output = errors
        .iter()
        .find(|e| e.message.starts_with("output bytes"))
        .unwrap();
    assert!(
        examined
            .message
            .contains("merge feed.merge: 500 lanes heads"),
        "{examined}"
    );
    assert!(!examined.message.contains("row width"));
    assert!(
        output
            .message
            .contains("product: merge feed.merge: emitted page"),
        "{output}"
    );
    assert!(
        output.message.contains("messages row width [messages.body"),
        "{output}"
    );
    assert!(output.message.contains("merge feed.merge"), "{output}");
    assert!(
        examined.rewrite.starts_with("structural repair"),
        "{examined}"
    );
    assert!(!examined.rewrite.contains("widest nested collection"));
    assert!(
        output.rewrite.contains("widest nested collection"),
        "{output}"
    );
    assert!(output.rewrite.contains("messages.body"), "{output}");
    assert_ne!(examined.rewrite, output.rewrite);
    assert!(errors.iter().all(|e| !e.rewrite.contains("return null")));
}

#[test]
fn nonuniform_budget_filler_has_a_uniformity_repair() {
    let mut schema = schema();
    schema.tables.get_mut("messages").unwrap().rules.read = RuleExpr::Eq(
        RuleTerm::Field("body".into()),
        RuleTerm::Literal(Value::String("visible".into())),
    );
    let errors = Checker::new(
        &schema,
        Ceilings {
            steps: 1000,
            heap_bytes: 1000,
            ..Ceilings::default()
        },
    )
    .check_all(&program(vec![Stmt::Return(Expr::Scan(scan(
        "messages", 5,
    )))]))
    .unwrap_err();
    assert_eq!(errors.len(), 2, "{errors:?}");
    for meter in ["steps", "heap bytes"] {
        let error = errors
            .iter()
            .find(|e| e.message.starts_with(meter))
            .unwrap();
        assert!(
            error
                .message
                .contains("product: rule evaluation / non-uniform budget reserve"),
            "{error}"
        );
        assert!(error.rewrite.contains("uniform"), "{error}");
        assert!(error.rewrite.contains("prefix"), "{error}");
        assert!(!error.rewrite.contains("rule-probe"), "{error}");
    }
}

#[test]
fn retained_merge_page_keeps_the_structural_closure_repair() {
    let schema = schema();
    let mut lane = scan("messages", 1100);
    lane.merge_site = Some("retained.merge".into());
    let scan_shaped = program(vec![Stmt::Return(Expr::Scan(lane.clone()))]);
    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&scan_shaped)
        .unwrap_err();
    let closure = errors
        .iter()
        .find(|e| e.message.starts_with("closure bytes"))
        .unwrap();
    assert!(
        !closure.message.contains("lanes ×"),
        "scan-shaped retention revived the eager merge label: {closure}"
    );
    let p = program(vec![
        Stmt::Let {
            name: "page".into(),
            value: Expr::Merge(Merge {
                held_search: None,
                site: "retained.merge".into(),
                lanes: vec![MergeLane {
                    setup: vec![],
                    scan: lane,
                    source: None,
                    binding: String::new(),
                }],
            }),
        },
        Stmt::Return(Expr::Builtin {
            builtin: Builtin::Count,
            args: vec![crate::var("page")],
        }),
    ]);
    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&p)
        .unwrap_err();
    let closure = errors
        .iter()
        .find(|e| e.message.starts_with("closure bytes"))
        .unwrap();
    assert!(
        closure
            .message
            .contains("merge retained.merge: emitted page"),
        "{closure}"
    );
    assert!(
        closure.rewrite.starts_with("structural repair"),
        "{closure}"
    );
}
