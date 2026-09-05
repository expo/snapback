use snapback2_core::*;
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
    own.scan.prefix = vec![Expr::Input(Input::Viewer)];
    own.source = None;
    own.binding.clear();
    merge.lanes.insert(0, own);
    program.result_page_site = Some(merge.site.clone());
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
    assert_eq!(
        certificate.max_closure_bytes,
        20 * declared_serialized_row_max(&schema, "posts")
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
    let second = engine
        .execute(&program, &certificate, ctx(first.next))
        .unwrap();
    assert_eq!(ids(&second.result), expected[20..40]);
    check_trace(&second, &certificate);
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
    let (schema, program) = fixture(0, 2);
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    for id in ["a", "b", "c", "d", "e", "f"] {
        engine.seed("posts", entry(id, "u1", 1)).unwrap();
    }
    let first = engine.execute(&program, &certificate, ctx(None)).unwrap();
    let mut client = ClientStore::hydrate(schema.clone(), &first.receipt).unwrap();
    let mutation = Program {
        name: "remove".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        result_page_site: None,
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
