use snapback3_core::engine::ClosureReceipt;
use snapback3_core::*;
use std::collections::BTreeMap;

fn fixture(lanes: u32, take: u32) -> (Schema, Program) {
    let frozen: serde_json::Value = serde_json::from_str(include_str!(
        "../../../corpus/merge-for-lane-domain-limit.json"
    ))
    .unwrap();
    let schema = serde_json::from_value(frozen["schema"].clone()).unwrap();
    let mut program: Program = serde_json::from_value(frozen["program"].clone()).unwrap();
    let Stmt::Return(Expr::Merge(merge)) = &mut program.body[0] else {
        panic!("lazy merge IR")
    };
    merge.lanes[0].source.as_mut().unwrap().take = Bound::Literal(lanes);
    merge.lanes[0].scan.take = Bound::Literal(take);
    merge.lanes[0].scan.order = Order::Desc;
    merge.lanes[0].scan.opaque_cursor = true;
    merge.lanes[0].scan.after = Some(Box::new(var("c")));
    let mut own = merge.lanes[0].clone();
    own.scan.site = "self".into();
    own.scan.prefix = vec![IndexKeyExpr::Scalar(Expr::Input(Input::Viewer))];
    own.source = None;
    own.binding.clear();
    merge.lanes.insert(0, own);

    program
        .args
        .insert("c".into(), ArgType::Optional(Box::new(ArgType::Cursor)));
    (schema, program)
}
fn ctx(cursor: Option<String>) -> Context {
    Context::query(
        Actor::new("u1", "user").unwrap(),
        BTreeMap::from([("c".into(), cursor.map(Value::String).unwrap_or(Value::Null))]),
    )
}
fn entry(id: &str, author: &str, at: i64) -> Value {
    object([
        ("id", Value::Id(id.into())),
        ("author", Value::Id(author.into())),
        ("at", Value::Int(at)),
    ])
}
fn seed_follow(engine: &mut Engine, n: u32, author: &str) {
    engine
        .seed(
            "follows",
            object([
                ("id", Value::Id(format!("f{n:04}"))),
                ("follower", Value::Id("u1".into())),
                ("followed", Value::Id(author.into())),
                ("at", Value::Int(n as i64)),
            ]),
        )
        .unwrap();
}
fn ids(value: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row.field("id").unwrap().as_str().unwrap().to_owned())
        .collect()
}
fn check_trace(execution: &Execution, certificate: &Certificate) {
    assert!(execution.trace.examined <= certificate.max_examined);
    assert!(execution.trace.examined <= certificate.max_index_entries);
    assert!(execution.trace.steps <= certificate.max_steps);
    assert!(execution.trace.rule_probes <= certificate.max_rule_probes);
    assert_eq!(
        execution.trace.examined,
        execution
            .trace
            .ranges
            .iter()
            .map(|r| r.examined_ids.len() as u64)
            .sum::<u64>()
    );
}

#[test]
fn following_twenty_over_five_hundred_follows_is_additive_and_matches_sorted_union() {
    let (schema, program) = fixture(500, 20);
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    assert_eq!(certificate.max_examined, 502 + 501 + 20 + 2);
    // Receipt descriptors, keys and row/halo references participate alongside
    // the pooled row images. A row-only constant did not bound that wire form.
    assert!(certificate.max_closure_bytes < Ceilings::default().closure_bytes);
    assert!(
        certificate.max_closure_bytes
            >= (501 + 20 + 2) * declared_serialized_row_max(&schema, "posts")
                + 501 * declared_serialized_row_max(&schema, "follows")
    );
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let mut all = Vec::new();
    for n in 0..500 {
        let author = format!("actor{n:04}");
        seed_follow(&mut engine, n, &author);
        // Deliberate ties and lanes with multiple candidates: eager concat/sort is the oracle.
        for k in 0..3 {
            let row = entry(
                &format!("p{n:04}-{k}"),
                &author,
                ((n * 17 + k * 37) % 101) as i64,
            );
            engine.seed("posts", row.clone()).unwrap();
            all.push(row);
        }
    }
    let row = entry("own", "u1", 100);
    engine.seed("posts", row.clone()).unwrap();
    all.push(row);
    all.sort_by(|a, b| {
        b.field("at")
            .unwrap()
            .total_cmp(a.field("at").unwrap())
            .then_with(|| b.field("id").unwrap().total_cmp(a.field("id").unwrap()))
    });
    let expected = all
        .iter()
        .take(40)
        .map(|row| row.field("id").unwrap().as_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    let first = engine.execute(&program, &certificate, ctx(None)).unwrap();
    assert_eq!(ids(&first.result), expected[..20]);
    assert_eq!(first.state, ExecutionState::Capped);
    check_trace(&first, &certificate);
    let Stmt::Return(Expr::Merge(merge)) = &program.body[0] else {
        unreachable!()
    };
    let posts_budget = merge.max_lanes() + merge.take() + 2;
    let follows_budget = merge.lanes[1].source.as_ref().unwrap().take.maximum() + 1;
    let check_receipt = |execution: &Execution| {
        assert!(canonical_json(&execution.receipt).len() as u64 <= certificate.max_closure_bytes);
        for (table, budget) in [("posts", posts_budget), ("follows", follows_budget)] {
            let held = execution
                .receipt
                .rows
                .iter()
                .filter(|row| row.table == table)
                .count();
            assert!(
                held <= budget as usize,
                "{table}: retained {held} rows, priced {budget}"
            );
        }
    };
    check_receipt(&first);
    let second = engine
        .execute(&program, &certificate, ctx(first.next))
        .unwrap();
    assert_eq!(ids(&second.result), expected[20..40]);
    check_trace(&second, &certificate);
    check_receipt(&second);
}

#[test]
fn wide_shaped_merge_prices_page_values_separately_from_receipt_heads() {
    let (mut schema, mut program) = fixture(500, 20);
    schema
        .tables
        .get_mut("posts")
        .unwrap()
        .columns
        .insert("body".into(), ColumnType::Text { max: 800 });
    let Stmt::Return(page) = program.body.remove(0) else {
        unreachable!()
    };
    program.body = vec![
        Stmt::Const {
            name: "page".into(),
            value: page,
        },
        Stmt::Const {
            name: "alias".into(),
            value: var("page"),
        },
        Stmt::Let {
            name: "rows".into(),
            value: Expr::Array(vec![]),
        },
        Stmt::For {
            binding: "entry".into(),
            domain: LoopDomain::DerivedArray {
                value: var("alias"),
                max: 20,
                bound_source: "alias".into(),
            },
            body: vec![Stmt::Push {
                target: "rows".into(),
                value: Expr::Object(BTreeMap::from([
                    ("post".into(), var("entry")),
                    (
                        "id".into(),
                        Expr::Field {
                            base: Box::new(var("entry")),
                            name: "id".into(),
                        },
                    ),
                ])),
            }],
        },
        Stmt::Return(var("rows")),
    ];
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    assert!(certificate.max_closure_bytes < Ceilings::default().closure_bytes);
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let body = "\u{10000}".repeat(800);
    for n in 0..500 {
        let author = format!("{n:04}{}", "a".repeat(131));
        seed_follow(&mut engine, n, &author);
        for k in 0..3 {
            engine
                .seed(
                    "posts",
                    object([
                        ("id", Value::Id(format!("p{n:04}-{k}{}", "x".repeat(128)))),
                        ("author", Value::Id(author.clone())),
                        ("at", Value::Int(((n * 17 + k * 37) % 101) as i64)),
                        ("body", Value::String(body.clone())),
                    ]),
                )
                .unwrap();
        }
    }
    let mut cursor = None;
    let mut seen = std::collections::BTreeSet::new();
    for _ in 0..2 {
        let result = engine.execute(&program, &certificate, ctx(cursor)).unwrap();
        assert_eq!(result.result.as_array().unwrap().len(), 20);
        for row in result.result.as_array().unwrap() {
            assert_eq!(
                row.field("post")
                    .unwrap()
                    .field("body")
                    .unwrap()
                    .as_str()
                    .unwrap(),
                body.as_str()
            );
            assert!(seen.insert(row.field("id").unwrap().as_str().unwrap().to_owned()));
        }
        check_trace(&result, &certificate);
        assert!(canonical_json(&result.receipt).len() as u64 <= certificate.max_closure_bytes);
        assert!(canonical_json(&result.result).len() as u64 <= certificate.max_output_bytes);
        cursor = result.next;
        assert!(cursor.is_some());
    }
    // The correction does not admit an actually oversized row pool.
    schema
        .tables
        .get_mut("posts")
        .unwrap()
        .columns
        .insert("body".into(), ColumnType::Text { max: 4_000 });
    assert!(
        Checker::new(&schema, Ceilings::default())
            .check_all(&program)
            .unwrap_err()
            .iter()
            .any(|error| error.message.starts_with("closure bytes"))
    );
}

#[test]
fn merge_empty_discovery_is_complete_for_literal_and_argument_take() {
    for take in [
        Bound::Literal(20),
        Bound::Arg {
            name: "n".into(),
            max: 20,
        },
    ] {
        let (schema, mut program) = fixture(500, 20);
        let Stmt::Return(Expr::Merge(merge)) = &mut program.body[0] else {
            unreachable!()
        };
        merge.lanes.remove(0);
        merge.lanes[0].scan.take = take;
        program.args.insert("n".into(), ArgType::Int);
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&program)
            .unwrap();
        let mut engine = Engine::memory(schema).unwrap();
        engine.seed("posts", entry("unfollowed", "u2", 1)).unwrap();
        let mut context = ctx(None);
        context.args.insert("n".into(), Value::Int(2));
        let result = engine.execute(&program, &certificate, context).unwrap();
        assert!(ids(&result.result).is_empty());
        assert_eq!(result.state, ExecutionState::Complete);
        assert_eq!(result.next, None);
        assert_eq!(result.trace.merges[0].deduplicated_union_len, 0);
        assert_eq!(result.trace.ranges.len(), 1);
        assert_eq!(result.trace.ranges[0].table, "follows");
        assert_eq!(result.trace.ranges[0].stop, StopReason::Exhausted);
        assert_eq!(result.trace.examined, 0);
        assert!(result.receipt.rows.is_empty());
        check_trace(&result, &certificate);
    }
}

#[test]
fn duplicate_prefixes_open_one_cursor_and_empty_lanes_do_not_hide_ties() {
    let (schema, program) = fixture(500, 3);
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let mut engine = Engine::memory(schema).unwrap();
    for n in 0..500 {
        seed_follow(&mut engine, n, if n % 2 == 0 { "u1" } else { "empty" });
    }
    for id in ["a", "b", "c", "d"] {
        engine.seed("posts", entry(id, "u1", 1)).unwrap();
    }
    let result = engine.execute(&program, &certificate, ctx(None)).unwrap();
    assert_eq!(ids(&result.result), ["d", "c", "b"]);
    let prefix_count = result
        .trace
        .ranges
        .iter()
        .filter(|r| r.table == "posts")
        .count();
    assert_eq!(prefix_count, 2);
    assert_eq!(result.trace.examined, 504);
    check_trace(&result, &certificate);
}

#[test]
fn nonuniform_hidden_rows_remain_capped_and_revocation_between_pages_rechecks_lanes() {
    let (mut schema, program) = fixture(2, 2);
    schema.tables.get_mut("posts").unwrap().rules.read = RuleExpr::Eq(
        RuleTerm::Field("at".into()),
        RuleTerm::Literal(Value::Int(1)),
    );
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    assert!(!certificate.merge_sites[0].uniform);
    assert!(
        certificate
            .bound_product
            .as_ref()
            .unwrap()
            .contains("lanes × (2 + 2)")
    );
    let mut engine = Engine::memory(schema).unwrap();
    seed_follow(&mut engine, 0, "u2");
    for (id, author, at) in [
        ("a", "u1", 1),
        ("b", "u2", 1),
        ("c", "u1", 1),
        ("hidden", "u2", 2),
    ] {
        engine.seed("posts", entry(id, author, at)).unwrap();
    }
    let first = engine.execute(&program, &certificate, ctx(None)).unwrap();
    assert_eq!(ids(&first.result), ["c", "b"]);
    assert_eq!(first.state, ExecutionState::Capped);
    assert!(!first.receipt.rows.iter().any(|r| r.id == "hidden"));
    check_trace(&first, &certificate);
    // A new page always consults current policy. Replace the remaining row with a hidden one.
    engine.seed("posts", entry("a", "u1", 0)).unwrap();
    let second = engine
        .execute(&program, &certificate, ctx(first.next))
        .unwrap();
    assert!(ids(&second.result).is_empty());
    assert_eq!(second.state, ExecutionState::Capped);
    assert!(
        second
            .trace
            .ranges
            .iter()
            .any(|r| r.examined_ids.contains(&"a".into()))
    );
    check_trace(&second, &certificate);
}

#[test]
fn merge_rejects_mismatched_stream_descriptors() {
    let (schema, mut program) = fixture(2, 2);
    let Stmt::Return(Expr::Merge(merge)) = &mut program.body[0] else {
        unreachable!()
    };
    merge.lanes[1].scan.order = Order::Asc;
    assert!(
        Checker::new(&schema, Ceilings::default())
            .check(&program)
            .is_err()
    );
}

#[test]
fn merge_lookahead_preserves_capped_state_after_one_local_deletion() {
    let (schema, program) = fixture(1, 2);
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    seed_follow(&mut engine, 0, "u2");
    for (n, id) in ["a", "b", "c", "d", "e", "f"].into_iter().enumerate() {
        engine
            .seed("posts", entry(id, if n % 2 == 0 { "u1" } else { "u2" }, 1))
            .unwrap();
    }
    let first = engine.execute(&program, &certificate, ctx(None)).unwrap();
    let mut client = ClientStore::hydrate(schema.clone(), &first.receipt).unwrap();
    let mutation = Program {
        name: "remove".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Delete {
            table: "posts".into(),
            key: Expr::Literal(Value::Id("f".into())),
        }],
    };
    let mutation_certificate = Checker::new(&schema, Ceilings::default())
        .check(&mutation)
        .unwrap();
    client
        .apply_mutation(
            &mutation,
            &mutation_certificate,
            Context::mutation(Actor::new("u1", "user").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    let (state, replay) = client.reexecute(&program, &certificate, ctx(None)).unwrap();
    assert_eq!(state, LocalState::Fresh);
    assert_eq!(ids(&replay.result), ["e", "d"]);
    assert_eq!(replay.state, ExecutionState::Capped);
    assert!(replay.next.is_some());
}

#[test]
fn duplicate_prefixes_at_scale_match_two_pages_and_exact_work() {
    let (schema, program) = fixture(500, 20);
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let mut engine = Engine::memory(schema).unwrap();
    let authors = ["u1", "u2", "u3"];
    for n in 0..500 {
        seed_follow(&mut engine, n, authors[n as usize % 3]);
    }
    for n in 0..90 {
        engine
            .seed(
                "posts",
                entry(&format!("p{n:03}"), authors[n % 3], n as i64),
            )
            .unwrap();
    }
    let mut cursor = None;
    for page in 0..2 {
        let result = engine.execute(&program, &certificate, ctx(cursor)).unwrap();
        let expected: Vec<_> = (0..90)
            .rev()
            .skip(page * 20)
            .take(20)
            .map(|n| format!("p{n:03}"))
            .collect();
        assert_eq!(ids(&result.result), expected);
        assert_eq!(
            result
                .trace
                .ranges
                .iter()
                .filter(|r| r.table == "posts")
                .count(),
            3
        );
        assert_eq!(result.trace.examined, 500 + 3 + 22);
        check_trace(&result, &certificate);
        cursor = Some(result.next.expect("more union rows"));
    }
}

#[test]
fn nonuniform_five_hundred_lanes_with_hidden_majority_stop_at_certificate() {
    // N=17 keeps the conservative 500 × (N+2) plus discovery below 10240.
    let (mut schema, mut program) = fixture(500, 17);
    let Stmt::Return(Expr::Merge(merge)) = &mut program.body[0] else {
        unreachable!()
    };
    merge.lanes.remove(0);
    schema.tables.get_mut("posts").unwrap().rules.read = RuleExpr::Eq(
        RuleTerm::Field("at".into()),
        RuleTerm::Literal(Value::Int(1)),
    );
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    assert!(
        certificate
            .bound_product
            .as_ref()
            .unwrap()
            .contains("500 lanes × (17 + 2)")
    );
    let mut engine = Engine::memory(schema).unwrap();
    for n in 0..500 {
        let author = format!("actor{n:04}");
        seed_follow(&mut engine, n, &author);
        for k in 0..30 {
            let hidden = k % 10 != 0;
            engine
                .seed(
                    "posts",
                    entry(
                        &format!(
                            "{}-{n:04}-{k:02}",
                            if hidden { "hidden" } else { "visible" }
                        ),
                        &author,
                        if hidden { 2 } else { 1 },
                    ),
                )
                .unwrap();
        }
    }
    let result = engine.execute(&program, &certificate, ctx(None)).unwrap();
    assert_eq!(result.state, ExecutionState::Capped);
    assert_eq!(result.trace.examined, certificate.max_examined);
    assert!(
        !result
            .trace
            .rows
            .iter()
            .chain(&result.receipt.rows)
            .any(|r| r.id.starts_with("hidden"))
    );
    check_trace(&result, &certificate);
}

#[test]
fn merge_argument_take_uses_evaluated_page_size_and_completeness() {
    let (schema, mut program) = fixture(1, 20);
    let Stmt::Return(Expr::Merge(merge)) = &mut program.body[0] else {
        unreachable!()
    };
    for lane in &mut merge.lanes {
        lane.scan.take = Bound::Arg {
            name: "n".into(),
            max: 20,
        };
    }
    program.args.insert("n".into(), ArgType::Int);
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let mut engine = Engine::memory(schema).unwrap();
    seed_follow(&mut engine, 0, "u2");
    for (n, author) in ["u1", "u2", "u1"].into_iter().enumerate() {
        engine
            .seed("posts", entry(&format!("p{n}"), author, n as i64))
            .unwrap();
    }
    for (take, expected_state) in [(2, ExecutionState::Capped), (3, ExecutionState::Complete)] {
        let mut context = ctx(None);
        context.args.insert("n".into(), Value::Int(take));
        let result = engine.execute(&program, &certificate, context).unwrap();
        assert_eq!(ids(&result.result).len(), take as usize);
        assert_eq!(result.trace.merges[0].deduplicated_union_len, 3);
        assert_eq!(result.state, expected_state);
        assert_eq!(result.next.is_some(), take == 2);
        check_trace(&result, &certificate);
    }
}

#[test]
fn merge_prefix_collapse_includes_evaluated_after_before_and_range() {
    for bound in ["after", "before", "range"] {
        let (schema, mut program) = fixture(2, 3);

        let Stmt::Return(Expr::Merge(merge)) = &mut program.body[0] else {
            unreachable!()
        };
        merge.lanes.remove(0);
        let lane = &mut merge.lanes[0];
        let at = Expr::Field {
            base: Box::new(var(&lane.binding)),
            name: "at".into(),
        };
        let cursor = Box::new(Expr::Array(vec![
            at.clone(),
            Expr::Literal(Value::Id("boundary".into())),
        ]));
        lane.scan.after = None;
        lane.scan.opaque_cursor = false;
        match bound {
            "after" => lane.scan.after = Some(cursor),
            "before" => lane.scan.before = Some(cursor),
            _ => {
                lane.scan.range = Some(Range {
                    gt: Some(Box::new(at)),
                    gte: None,
                    lt: None,
                    lte: None,
                })
            }
        }
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&program)
            .unwrap();
        let mut engine = Engine::memory(schema).unwrap();
        for n in 0..2 {
            seed_follow(&mut engine, n, "u2");
        }
        for n in 0..3 {
            engine
                .seed("posts", entry(&format!("p{n}"), "u2", n))
                .unwrap();
        }
        let result = engine.execute(&program, &certificate, ctx(None)).unwrap();
        assert_eq!(
            result
                .trace
                .ranges
                .iter()
                .filter(|r| r.table == "posts")
                .count(),
            2,
            "{bound}"
        );
        check_trace(&result, &certificate);
    }
}

#[test]
fn partial_reexecute_clears_next_for_plain_scan() {
    let frozen: serde_json::Value = serde_json::from_str(include_str!(
        "../../../corpus/local-pagination-partial-clears-next.json"
    ))
    .unwrap();
    let schema: Schema = serde_json::from_value(frozen["schema"].clone()).unwrap();
    let program: Program = serde_json::from_value(frozen["program"].clone()).unwrap();
    let receipt: ClosureReceipt = serde_json::from_value(frozen["receipt"].clone()).unwrap();
    let context = ctx(None);
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let mut client = ClientStore::hydrate(schema.clone(), &receipt).unwrap();
    assert!(
        client
            .reexecute(&program, &certificate, context.clone())
            .unwrap()
            .1
            .next
            .is_some()
    );
    for step in frozen["prelude"].as_array().unwrap() {
        let mutation: Program = serde_json::from_value(step["program"].clone()).unwrap();
        let context = Context::mutation(Actor::new("u1", "user").unwrap(), BTreeMap::new());
        let cert = Checker::new(&schema, Ceilings::default())
            .check(&mutation)
            .unwrap();
        assert_eq!(
            client.apply_mutation(&mutation, &cert, context).unwrap().0,
            LocalState::Predicted
        );
    }
    let mut raw = Engine::memory(schema).unwrap();
    for row in client.rows("posts").unwrap() {
        raw.seed("posts", row).unwrap();
    }
    assert!(
        raw.execute(&program, &certificate, context.clone())
            .unwrap()
            .next
            .is_some()
    );
    let (state, replay) = client.reexecute(&program, &certificate, context).unwrap();
    assert!(matches!(state, LocalState::Partial(_)));
    assert_eq!(ids(&replay.result), ["p2", "p3"]);
    assert_eq!(replay.next, None);
}

#[test]
fn page_provenance_is_derived_and_requires_an_unmodified_ordered_collector() {
    let (schema, program) = fixture(2, 3);
    let Stmt::Return(page) = &program.body[0] else {
        unreachable!()
    };
    let push = Stmt::Push {
        target: "rows".into(),
        value: var("entry"),
    };
    for (name, initial, body, expected) in [
        ("shape", Expr::Array(vec![]), vec![push.clone()], true),
        (
            "double-push",
            Expr::Array(vec![]),
            vec![push.clone(), push.clone()],
            false,
        ),
        (
            "truncated",
            Expr::Array(vec![]),
            vec![push.clone(), Stmt::Break],
            false,
        ),
        (
            "conditional-push",
            Expr::Array(vec![]),
            vec![Stmt::If {
                condition: Expr::Literal(Value::Bool(true)),
                then_body: vec![push.clone()],
                else_body: vec![],
            }],
            false,
        ),
        (
            "prepopulated",
            Expr::Array(vec![Expr::Literal(Value::Null)]),
            vec![push.clone()],
            false,
        ),
        (
            "overwritten",
            Expr::Array(vec![]),
            vec![
                Stmt::Assign {
                    name: "rows".into(),
                    value: Expr::Array(vec![]),
                },
                push,
            ],
            false,
        ),
    ] {
        let mut shaped = program.clone();
        shaped.name = name.into();
        shaped.body = vec![
            Stmt::Const {
                name: "page".into(),
                value: page.clone(),
            },
            Stmt::Let {
                name: "rows".into(),
                value: initial,
            },
            Stmt::For {
                binding: "entry".into(),
                domain: LoopDomain::DerivedArray {
                    value: var("page"),
                    max: 3,
                    bound_source: "page".into(),
                },
                body,
            },
            Stmt::Return(var("rows")),
        ];
        // A raw IR client cannot bless a lossy collector with the removed hint.
        let mut encoded = serde_json::to_value(&shaped).unwrap();
        encoded["result_page_site"] = serde_json::json!("merge.for-limit");
        let forged: Program = serde_json::from_value(encoded).unwrap();
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&forged)
            .unwrap();
        assert_eq!(!certificate.result_pages.is_empty(), expected, "{name}");
    }
}

#[test]
fn repeated_page_site_cannot_select_an_auxiliary_scan_or_merge() {
    let (schema, mut program) = fixture(2, 3);
    let Stmt::Return(page) = &program.body[0] else {
        unreachable!()
    };
    program.body = vec![
        Stmt::Const {
            name: "returned".into(),
            value: page.clone(),
        },
        Stmt::Const {
            name: "auxiliary".into(),
            value: page.clone(),
        },
        Stmt::Return(var("returned")),
    ];
    let errors = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap_err();
    assert_eq!(errors.code, "E_TRACE_SUBSET");
}

fn nested_auxiliary_page(operand: &str, duplicate: bool) -> (Schema, Program) {
    let (mut schema, mut program) = fixture(2, 2);
    schema.tables.get_mut("posts").unwrap().indexes.insert(
        "byUniqueAt".into(),
        Index {
            components: (vec!["at".into()])
                .into_iter()
                .map(snapback3_core::search_key::IndexComponent::Column)
                .collect(),
            unique: true,
        },
    );
    let Stmt::Return(Expr::Merge(merge)) = &program.body[0] else {
        unreachable!()
    };
    let mut page = merge.lanes[0].scan.clone();
    page.site = "page".into();
    page.merge_site = None;
    page.prefix = vec![IndexKeyExpr::Scalar(var("who"))];
    page.order = Order::Asc;
    let mut nested = page.clone();
    if !duplicate {
        nested.site = "nested".into();
    }
    let count = Expr::Builtin {
        builtin: Builtin::Len,
        args: vec![Expr::Scan(nested)],
    };
    let point = Read {
        site: "point".into(),
        table: "posts".into(),
        index: "byUniqueAt".into(),
        key: vec![count.clone()],
        provenance: KeyProvenance::Computed,
    };
    let mut outer = page.clone();
    outer.site = "outer".into();
    outer.index = "byAt".into();
    outer.prefix.clear();
    outer.opaque_cursor = false;
    outer.after = None;
    let position = Expr::Array(vec![count.clone(), lit(Value::Id("boundary".into()))]);
    let field = operand.rsplit('-').next().unwrap();
    match field {
        "prefix" => outer.prefix = vec![IndexKeyExpr::Scalar(count.clone())],
        "after" => outer.after = Some(Box::new(position.clone())),
        "before" => outer.before = Some(Box::new(position)),
        "gt" | "gte" | "lt" | "lte" => {
            let mut range = Range {
                gt: None,
                gte: None,
                lt: None,
                lte: None,
            };
            *match field {
                "gt" => &mut range.gt,
                "gte" => &mut range.gte,
                "lt" => &mut range.lt,
                _ => &mut range.lte,
            } = Some(Box::new(count));
            outer.range = Some(range);
        }
        _ => {}
    }
    let auxiliary = if operand == "loop-prefix" {
        Stmt::For {
            binding: "unused".into(),
            domain: LoopDomain::Page(outer),
            body: vec![],
        }
    } else {
        let value = if operand == "get" {
            Expr::Get(point)
        } else if operand == "exists" {
            Expr::Exists(point)
        } else if operand.starts_with("merge-") {
            let mut lane = merge.lanes[0].clone();
            lane.scan = if operand.starts_with("merge-scan-") {
                outer.clone()
            } else {
                let mut scan = page.clone();
                scan.site = "lane".into();
                scan
            };
            lane.scan.merge_site = Some("auxiliary-merge".into());
            lane.binding = "source".into();
            lane.source = operand.starts_with("merge-source-").then_some(outer);
            if operand == "merge-setup-get" {
                lane.setup = vec![Stmt::Const {
                    name: "point".into(),
                    value: Expr::Get(point),
                }];
            }
            Expr::Merge(Merge {
                held_search: None,
                site: "auxiliary-merge".into(),
                lanes: vec![lane],
            })
        } else {
            Expr::Scan(outer)
        };
        Stmt::Const {
            name: "auxiliary".into(),
            value,
        }
    };
    program.args.insert("a".into(), ArgType::Principal);
    program.args.insert("b".into(), ArgType::Principal);
    program.body = vec![
        Stmt::Let {
            name: "who".into(),
            value: var("a"),
        },
        Stmt::Const {
            name: "returned".into(),
            value: Expr::Scan(page),
        },
        Stmt::Assign {
            name: "who".into(),
            value: var("b"),
        },
        auxiliary,
        Stmt::Return(var("returned")),
    ];
    (schema, program)
}

#[test]
fn nested_auxiliary_page_sites_are_refused_in_every_read_operand() {
    let mut failures = Vec::new();
    for operand in [
        "get",
        "exists",
        "prefix",
        "after",
        "before",
        "gt",
        "gte",
        "lt",
        "lte",
        "loop-prefix",
        "merge-source-prefix",
        "merge-source-after",
        "merge-source-before",
        "merge-source-gt",
        "merge-source-gte",
        "merge-source-lt",
        "merge-source-lte",
        "merge-scan-prefix",
        "merge-scan-after",
        "merge-scan-before",
        "merge-scan-gt",
        "merge-scan-gte",
        "merge-scan-lt",
        "merge-scan-lte",
        "merge-setup-get",
    ] {
        let (schema, program) = nested_auxiliary_page(operand, true);
        match Checker::new(&schema, Ceilings::default()).check_all(&program) {
            Err(errors)
                if errors.iter().any(|e| {
                    e.code == "E_TRACE_SUBSET" && e.message.contains("result-page site page")
                }) => {}
            Ok(certificate) => {
                let mut evidence = String::new();
                if matches!(operand, "get" | "exists") {
                    let mut engine = Engine::memory(schema.clone()).unwrap();
                    for (author, base) in [("A", 0), ("B", 99)] {
                        for n in 1..=3 {
                            engine
                                .seed("posts", entry(&format!("{author}{n}"), author, base + n))
                                .unwrap();
                        }
                    }
                    let mut context = ctx(None);
                    context.args.extend([
                        ("a".into(), Value::Id("A".into())),
                        ("b".into(), Value::Id("B".into())),
                    ]);
                    let result = engine.execute(&program, &certificate, context).unwrap();
                    evidence = format!(
                        "; returned {:?}, cursor {:?}",
                        ids(&result.result),
                        cursor::decode_cursor(&schema, result.next.as_ref().unwrap())
                            .unwrap()
                            .values
                    );
                }
                failures.push(format!("{operand}: accepted duplicate page site{evidence}"));
            }
            Err(errors) => failures.push(format!("{operand}: {errors:?}")),
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn distinct_nested_auxiliary_page_preserves_returned_cursor_and_cross_operation_reuse() {
    for operand in ["get", "exists"] {
        let (schema, program) = nested_auxiliary_page(operand, false);
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&program)
            .unwrap();
        let mut engine = Engine::memory(schema.clone()).unwrap();
        for (author, base) in [("A", 0), ("B", 99)] {
            for n in 1..=3 {
                engine
                    .seed("posts", entry(&format!("{author}{n}"), author, base + n))
                    .unwrap();
            }
        }
        let context = |cursor| {
            let mut context = ctx(cursor);
            context.args.extend([
                ("a".into(), Value::Id("A".into())),
                ("b".into(), Value::Id("B".into())),
            ]);
            context
        };
        let first = engine
            .execute(&program, &certificate, context(None))
            .unwrap();
        assert_eq!(ids(&first.result), ["A1", "A2"]);
        assert_eq!(
            cursor::decode_cursor(&schema, first.next.as_ref().unwrap())
                .unwrap()
                .values,
            vec![Value::Int(2), Value::Id("A2".into())]
        );
        // The token is a position, so another operation and site can continue it.
        let mut successor = program.clone();
        successor.name = "other-operation".into();
        let Stmt::Const {
            value: Expr::Scan(scan),
            ..
        } = &mut successor.body[1]
        else {
            unreachable!()
        };
        scan.site = "other-page".into();
        let other = Checker::new(&schema, Ceilings::default())
            .check(&successor)
            .unwrap();
        let second = engine
            .execute(&successor, &other, context(first.next))
            .unwrap();
        assert_eq!(ids(&second.result), ["A3"]);
        assert_eq!(
            cursor::decode_cursor(&schema, second.next.as_ref().unwrap())
                .unwrap()
                .values,
            vec![Value::Int(3), Value::Id("A3".into())]
        );
        let terminal = engine
            .execute(&successor, &other, context(second.next))
            .unwrap();
        assert!(ids(&terminal.result).is_empty());
        assert_eq!(terminal.next, None);
    }
}

#[test]
fn malformed_opaque_page_prefix_returns_accumulated_diagnostics() {
    let frozen: serde_json::Value = serde_json::from_str(include_str!(
        "../../../corpus/opaque-cursor-complete-next-null.json"
    ))
    .unwrap();
    let schema: Schema = serde_json::from_value(frozen["schema"].clone()).unwrap();
    let mut program: Program = serde_json::from_value(frozen["program"].clone()).unwrap();
    let Stmt::Return(Expr::Scan(scan)) = &mut program.body[0] else {
        unreachable!()
    };
    scan.prefix = vec![IndexKeyExpr::Scalar(lit(Value::Int(1))); 3];
    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&program)
        .unwrap_err();
    assert!(
        errors
            .iter()
            .any(|e| e.code == "E_ARGS_TYPE" && e.message.contains("prefix supplies 3 components")),
        "{errors:?}"
    );
    assert!(
        errors
            .iter()
            .any(|e| e.code == "E_TRACE_SUBSET" && e.message.contains("result-page site")),
        "{errors:?}"
    );
}

// Run alone with --ignored --nocapture to compare retained Rust allocations.
#[test]
#[ignore = "allocation profile; runs alone to exclude concurrent test allocations"]
fn overlapping_merge_retention_profile() {
    let (mut schema, mut program) = fixture(32, 3);
    schema
        .tables
        .get_mut("posts")
        .unwrap()
        .columns
        .insert("body".into(), ColumnType::Text { max: 2048 });
    schema.tables.get_mut("posts").unwrap().rules.read = RuleExpr::Ne(
        RuleTerm::Field("at".into()),
        RuleTerm::Literal(Value::Int(0)),
    );
    let Stmt::Return(Expr::Merge(merge)) = &mut program.body[0] else {
        unreachable!()
    };
    merge.lanes.remove(0);
    let lane = &mut merge.lanes[0];
    lane.scan.after = None;
    lane.scan.opaque_cursor = false;
    lane.scan.before = Some(Box::new(Expr::Array(vec![
        field(var(&lane.binding), "at"),
        lit(Value::Id("low".into())),
    ])));
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let mut engine = Engine::memory(schema).unwrap();
    for n in 0..32 {
        seed_follow(&mut engine, n, "u1");
    }
    for n in 0..2000 {
        let mut row = entry(&format!("p{n:05}"), "u1", 1000 + n);
        if let Value::Row(ref mut fields) = row {
            fields.insert("body".into(), Value::String("x".repeat(2048)));
        }
        engine.seed("posts", row).unwrap();
    }
    let started = std::time::Instant::now();
    PROFILE_LIVE.store(0, std::sync::atomic::Ordering::Relaxed);
    PROFILE_PEAK.store(0, std::sync::atomic::Ordering::Relaxed);
    PROFILE_ENABLED.store(true, std::sync::atomic::Ordering::Relaxed);
    let result = engine.execute(&program, &certificate, ctx(None)).unwrap();
    PROFILE_ENABLED.store(false, std::sync::atomic::Ordering::Relaxed);
    assert!(
        PROFILE_PEAK.load(std::sync::atomic::Ordering::Relaxed) < 300_000,
        "overlapping lanes retained duplicate row bodies"
    );
    eprintln!(
        "overlap: elapsed_us={} peak_bytes={} examined={} rows={} take=3 lanes=32",
        started.elapsed().as_micros(),
        PROFILE_PEAK.load(std::sync::atomic::Ordering::Relaxed),
        result.trace.examined,
        result.receipt.rows.len()
    );
    assert_eq!(ids(&result.result).len(), 3);
    assert!(
        result
            .receipt
            .rows
            .iter()
            .filter(|row| row.table == "posts")
            .count()
            <= 3 + 32 + 2
    );
    check_trace(&result, &certificate);
}

struct ProfileAllocator;
#[global_allocator]
static PROFILE_ALLOCATOR: ProfileAllocator = ProfileAllocator;
static PROFILE_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static PROFILE_LIVE: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
static PROFILE_PEAK: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
unsafe impl std::alloc::GlobalAlloc for ProfileAllocator {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        let ptr = unsafe { std::alloc::System.alloc(layout) };
        if !ptr.is_null() && PROFILE_ENABLED.load(std::sync::atomic::Ordering::Relaxed) {
            let live = PROFILE_LIVE
                .fetch_add(layout.size() as isize, std::sync::atomic::Ordering::Relaxed)
                + layout.size() as isize;
            PROFILE_PEAK.fetch_max(live, std::sync::atomic::Ordering::Relaxed);
        }
        ptr
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        if PROFILE_ENABLED.load(std::sync::atomic::Ordering::Relaxed) {
            PROFILE_LIVE.fetch_sub(layout.size() as isize, std::sync::atomic::Ordering::Relaxed);
        }
        unsafe { std::alloc::System.dealloc(ptr, layout) }
    }
}

#[test]
fn constructed_merge_output_and_receipt_obey_their_separate_byte_bounds() {
    let (schema, mut program) = fixture(500, 20);
    let Stmt::Return(page) = program.body.remove(0) else { unreachable!() };
    program.args.insert("note".into(), ArgType::Text { max: 12_000, min: 0, format: None });
    program.body = vec![
        Stmt::Const { name: "page".into(), value: page },
        Stmt::Let { name: "rows".into(), value: Expr::Array(vec![]) },
        Stmt::For {
            binding: "entry".into(),
            domain: LoopDomain::DerivedArray { value: var("page"), max: 20, bound_source: "page".into() },
            body: vec![Stmt::Push { target: "rows".into(), value: Expr::Object(BTreeMap::from([
                ("post".into(), var("entry")), ("note".into(), var("note")),
            ])) }],
        },
        Stmt::Return(var("rows")),
    ];
    let certificate = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    for n in 0..500 {
        let author = format!("{n:04}{}", "a".repeat(131));
        seed_follow(&mut engine, n, &author);
        for k in 0..3 {
            engine.seed("posts", entry(&format!("p{n:04}-{k}{}", "x".repeat(128)), &author,
                ((n * 17 + k * 37) % 101) as i64)).unwrap();
        }
    }
    let note = "\u{10000}".repeat(12_000);
    let mut cursor = None;
    for _ in 0..2 {
        let mut context = ctx(cursor);
        context.args.insert("note".into(), Value::String(note.clone()));
        let result = engine.execute(&program, &certificate, context).unwrap();
        let receipt_bytes = canonical_json(&result.receipt).len() as u64;
        let result_bytes = canonical_json(&result.result).len() as u64;
        eprintln!("constructed merge: receipt={receipt_bytes}/{} output={result_bytes}/{} combined={} heap={}",
            certificate.max_closure_bytes, certificate.max_output_bytes, receipt_bytes + result_bytes, certificate.max_heap_bytes);
        assert!(receipt_bytes <= certificate.max_closure_bytes);
        assert!(result_bytes <= certificate.max_output_bytes);
        // Each serialized product has its own ceiling. A wide constructed
        // result cannot hide behind a sufficiently large receipt allowance.
        for (product, ceilings) in [
            ("output bytes", Ceilings { output_bytes: result_bytes - 1, ..Ceilings::default() }),
            ("closure bytes", Ceilings { closure_bytes: receipt_bytes - 1, ..Ceilings::default() }),
        ] {
            let errors = Checker::new(&schema, ceilings).check_all(&program).unwrap_err();
            assert!(errors.iter().any(|error| error.message.starts_with(product)), "{product}: {errors:?}");
        }
        assert_eq!(result.result.as_array().unwrap().len(), 20);
        for row in result.result.as_array().unwrap() {
            assert_eq!(row.field("note").unwrap().as_str().unwrap(), note);
        }
        check_trace(&result, &certificate);
        cursor = result.next;
        assert!(cursor.is_some());
    }
}


// @ref LLP 1023.001#c--choose-a-complete-form-in-this-order — pooled receipt
// diagnostics keep the executed smaller-page repair only for one owning merge.
#[test]
fn pooled_merge_refusal_keeps_continuation_only_for_an_unambiguous_page() {
    let (mut schema, program) = fixture(100, 20);
    schema.tables.get_mut("posts").unwrap().columns
        .insert("body".into(), ColumnType::Text { max: 3000 });
    for extra in ["none", "scan", "merge", "noncursor", "summary"] {
        let mut candidate = program.clone();
        let Stmt::Return(Expr::Merge(first)) = &mut candidate.body[0] else { unreachable!() };
        match extra {
            "scan" => {
                let mut scan = first.lanes[0].scan.clone();
                scan.site = "other".into();
                scan.merge_site = None;
                candidate.body.insert(0, Stmt::Const { name: "other".into(), value: Expr::Scan(scan) });
            }
            "merge" => {
                let mut second = first.clone();
                second.site = "other".into();
                for lane in &mut second.lanes {
                    lane.scan.site = format!("other-{}", lane.scan.site);
                    lane.scan.merge_site = Some(second.site.clone());
                    if let Some(source) = &mut lane.source { source.site = format!("other-{}", source.site); }
                }
                candidate.body.insert(0, Stmt::Const { name: "other".into(), value: Expr::Merge(second) });
            }
            "noncursor" => {
                for lane in &mut first.lanes { lane.scan.opaque_cursor = false; lane.scan.after = None; }
            }
            "summary" => {
                let page = Expr::Merge(first.clone());
                candidate.body = vec![
                    Stmt::Const { name: "page".into(), value: page },
                    Stmt::Return(Expr::Builtin { builtin: Builtin::Count, args: vec![var("page")] }),
                ];
            }
            _ => {}
        }
        let certificate = Checker::new(&schema, Ceilings::default()).check(&candidate).unwrap();
        let refused = Checker::new(&schema, Ceilings {
            closure_bytes: certificate.max_closure_bytes - 1, ..Ceilings::default()
        }).inspect(&candidate);
        let refusal = refused.errors.iter().find(|e| e.message.starts_with("closure bytes")).unwrap();
        assert_eq!(refusal.rewrite.contains("valid continuation that the client follows"), extra == "none", "{extra}: {refusal:?}");
        for term in &certificate.cost_terms {
            if term.meter == "closure bytes" && term.source.contains("posts.body") {
                assert!(term.site.is_none(), "pooled field acquired an invented read site: {term:?}");
            }
        }
    }
}
