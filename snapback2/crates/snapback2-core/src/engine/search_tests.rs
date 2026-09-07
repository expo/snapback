use super::*;
use crate::ir::*;
use crate::schema::*;
use crate::{Actor, Ceilings, Checker};

fn fixture() -> (Engine, Vec<Program>) {
    let p = crate::certificate::search::tests::project(crate::certificate::search::tests::RECIPES);
    let mut schema = p.schema;
    for table in schema.tables.values_mut() {
        table.rules.insert = RuleExpr::Allow;
        table.rules.update = RuleExpr::Allow;
        table.rules.delete = RuleExpr::Allow;
    }
    (Engine::memory(schema).unwrap(), p.programs)
}
fn query(engine: &mut Engine, program: &Program, term: &str) -> Result<Execution, RuntimeError> {
    let mut args = BTreeMap::from([
        ("term".into(), Value::String(term.into())),
        ("c".into(), Value::Null),
    ]);
    if program.args.contains_key("conversation") {
        args.insert("conversation".into(), Value::Id("c1".into()));
    }
    let cert = Checker::new(&engine.schema, Ceilings::default())
        .check_all(program)
        .unwrap_or_else(|e| panic!("{e:#?}"));
    engine.execute(
        program,
        &cert,
        Context::query(Actor::user("alice").unwrap(), args),
    )
}
fn program(programs: &[Program], name: &str) -> Program {
    programs.iter().find(|p| p.name == name).unwrap().clone()
}
fn conversation(engine: &mut Engine, id: &str) {
    engine
        .seed(
            "conversations",
            object([
                ("id", Value::Id(id.into())),
                ("title", Value::String(id.into())),
            ]),
        )
        .unwrap();
    engine
        .seed(
            "memberships",
            object([
                ("id", Value::Id(format!("membership-{id}"))),
                ("conversation", Value::Id(id.into())),
                ("principal", Value::Id("alice".into())),
            ]),
        )
        .unwrap();
}
fn message(
    id: &str,
    conversation: &str,
    body: Option<&str>,
    caption: Option<&str>,
    at: i64,
) -> Value {
    object([
        ("id", Value::Id(id.into())),
        ("conversation", Value::Id(conversation.into())),
        (
            "body",
            body.map_or(Value::Null, |s| Value::String(s.into())),
        ),
        (
            "caption",
            caption.map_or(Value::Null, |s| Value::String(s.into())),
        ),
        ("at", Value::Int(at)),
    ])
}
fn write(engine: &mut Engine, stmt: Stmt) -> Execution {
    let p = Program {
        name: "search.write".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![stmt],
    };
    let cert = Checker::new(&engine.schema, Ceilings::default())
        .check_all(&p)
        .unwrap_or_else(|e| panic!("{e:#?}"));
    assert!(cert.max_steps <= 1_000_000);
    assert!(cert.max_heap_bytes <= 8 * 1024 * 1024);
    let execution = engine
        .execute(
            &p,
            &cert,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert!(
        matches!(execution.state, ExecutionState::Committed { .. }),
        "{execution:?}"
    );
    assert!(execution.trace.derived_steps <= cert.derived_steps);
    assert!(execution.trace.derived_scratch_bytes <= cert.derived_scratch_bytes);
    execution
}
fn ids(execution: &Execution) -> Vec<String> {
    execution
        .result
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.field("id").unwrap().as_str().unwrap().to_owned())
        .collect()
}
#[test]
fn unicode_postings_are_distinct_per_row_across_words_and_optional_fields() {
    let (mut engine, programs) = fixture();
    conversation(&mut engine, "c1");
    engine
        .seed(
            "messages",
            message("one", "c1", Some("CAFÉ café"), Some("Cafe\u{301}"), 1),
        )
        .unwrap();
    engine
        .seed("messages", message("two", "c1", None, Some("café"), 2))
        .unwrap();
    engine
        .seed("messages", message("none", "c1", None, None, 3))
        .unwrap();
    let p = program(&programs, "search.inConversation");
    for term in ["CA", "ca", "cafe\u{301}", "CAFÉ"] {
        assert_eq!(ids(&query(&mut engine, &p, term).unwrap()), ["two", "one"]);
    }
    let node = search_index::resolve(
        &engine.store.conn,
        "messages",
        "byConversationWords",
        Some("café"),
    )
    .unwrap()
    .unwrap();
    let refs: i64 = engine
        .store
        .conn
        .query_row(
            "SELECT refs FROM _search_nodes WHERE node=?1",
            [node],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(refs, 2);
    for term in ["", " -- "] {
        assert!(ids(&query(&mut engine, &p, term).unwrap()).is_empty());
    }
    assert_eq!(
        query(&mut engine, &p, "cat cat").unwrap_err().code(),
        "E_INPUT"
    );
    assert_eq!(query(&mut engine, &p, "a b").unwrap_err().code(), "E_INPUT");
}
#[test]
fn reverse_gc_edit_scope_move_and_reused_handles_keep_logical_receipts() {
    let (mut engine, programs) = fixture();
    conversation(&mut engine, "c1");
    conversation(&mut engine, "c2");
    let p = program(&programs, "search.inConversation");
    assert!(ids(&query(&mut engine, &p, "ca").unwrap()).is_empty());
    write(
        &mut engine,
        Stmt::Insert {
            table: "messages".into(),
            row: Expr::Literal(message("a", "c1", Some("cat cat"), Some("cat"), 1)),
        },
    );
    let first = query(&mut engine, &p, "CA").unwrap();
    assert_eq!(ids(&first), ["a"]);
    write(
        &mut engine,
        Stmt::Update {
            table: "messages".into(),
            key: Expr::Literal(Value::Id("a".into())),
            patch: Expr::Literal(object([
                ("body", Value::String("dog".into())),
                ("caption", Value::Null),
            ])),
        },
    );
    assert!(ids(&query(&mut engine, &p, "ca").unwrap()).is_empty());
    assert_eq!(ids(&query(&mut engine, &p, "do").unwrap()), ["a"]);
    let moved = write(
        &mut engine,
        Stmt::Update {
            table: "messages".into(),
            key: Expr::Literal(Value::Id("a".into())),
            patch: Expr::Literal(object([("conversation", Value::Id("c2".into()))])),
        },
    );
    assert_eq!(moved.trace.scope_touches.len(), 2);
    assert!(ids(&query(&mut engine, &p, "do").unwrap()).is_empty());
    write(
        &mut engine,
        Stmt::Delete {
            table: "messages".into(),
            key: Expr::Literal(Value::Id("a".into())),
        },
    );
    let nodes: i64 = engine
        .store
        .conn
        .query_row("SELECT count(*) FROM _search_nodes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(nodes, 0);
    write(
        &mut engine,
        Stmt::Upsert {
            table: "messages".into(),
            key: Expr::Literal(Value::Id("b".into())),
            row: Expr::Literal(message("b", "c1", Some("car"), None, 2)),
        },
    );
    assert_eq!(ids(&query(&mut engine, &p, "ca").unwrap()), ["b"]);
    let json = canonical_json(&first.receipt);
    assert!(json.contains("WordPrefix"));
    assert!(json.contains("\"source\":\"CA\""));
    assert!(!json.contains("_search"));
    assert!(
        first
            .receipt
            .ranges
            .iter()
            .all(|r| r.n2_suffix.as_ref().is_none_or(|s| s.len() == 2))
    );
    let commits = engine.store.commits_since(0, 100).unwrap();
    assert!(commits.iter().any(|c| c.scope_touches.len() == 2));
}
#[test]
fn max_width_writes_fit_the_unchanged_ledgers_and_rollback_together() {
    for n in [2000, 4000] {
        let (mut engine, _) = fixture();
        conversation(&mut engine, "c1");
        let text = "\u{0390}".repeat(n); // canonical expansion, long combining runs
        write(
            &mut engine,
            Stmt::Insert {
                table: "messages".into(),
                row: Expr::Literal(message("a", "c1", Some(&text), None, 1)),
            },
        );
        write(
            &mut engine,
            Stmt::Update {
                table: "messages".into(),
                key: Expr::Literal(Value::Id("a".into())),
                patch: Expr::Literal(object([("body", Value::String("a".repeat(n)))])),
            },
        );
        let before = engine.rows("messages").unwrap();
        let p = Program {
            name: "search.rollback".into(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![
                Stmt::Update {
                    table: "messages".into(),
                    key: Expr::Literal(Value::Id("a".into())),
                    patch: Expr::Literal(object([("body", Value::String("z".repeat(n)))])),
                },
                Stmt::Require {
                    condition: Expr::Literal(Value::Bool(false)),
                    code: "rollback".into(),
                },
            ],
        };
        let cert = Checker::new(&engine.schema, Ceilings::default())
            .check(&p)
            .unwrap();
        let result = engine.execute(
            &p,
            &cert,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
        );
        assert!(
            result.is_err() || matches!(result.unwrap().state, ExecutionState::Rejected { .. })
        );
        assert_eq!(engine.rows("messages").unwrap(), before);
        assert!(
            search_index::resolve(
                &engine.store.conn,
                "messages",
                "byConversationWords",
                Some("z")
            )
            .unwrap()
            .is_none()
        );
        write(
            &mut engine,
            Stmt::Delete {
                table: "messages".into(),
                key: Expr::Literal(Value::Id("a".into())),
            },
        );
    }
}
#[test]
fn global_hundred_lane_search_retains_shared_images_and_bounded_wire_closure() {
    let (mut engine, programs) = fixture();
    let p = program(&programs, "search.global");
    for i in 0..100 {
        let c = format!("c{i}");
        conversation(&mut engine, &c);
        for j in 0..2 {
            engine
                .seed(
                    "messages",
                    message(
                        &format!("m{i}-{j}"),
                        &c,
                        Some(&format!("a{}", "\u{10100}".repeat(3999))),
                        None,
                        (i * 2 + j) as i64,
                    ),
                )
                .unwrap();
        }
    }
    let cert = Checker::new(&engine.schema, Ceilings::default())
        .check(&p)
        .unwrap();
    let execution = query(&mut engine, &p, &format!("a{}", " ".repeat(1999))).unwrap();
    assert_eq!(ids(&execution).len(), 20);
    assert!(matches!(execution.state, ExecutionState::Capped));
    assert!(execution.next.is_some());
    assert!(execution.trace.examined <= 224);
    assert!(cert.max_closure_bytes < 4 * 1024 * 1024);
    assert!(canonical_json(&execution.receipt).len() as u64 <= cert.max_closure_bytes);
    for result in execution.result.as_array().unwrap() {
        let id = result.field("id").unwrap().as_str().unwrap();
        let pooled = &execution
            .receipt
            .rows
            .iter()
            .find(|r| r.table == "messages" && r.id == id)
            .unwrap()
            .row;
        let (Value::Row(a), Value::Row(b)) = (result, pooled) else {
            panic!("row")
        };
        assert!(a.shares_image(b));
    }
    for row in &execution.receipt.rows {
        let traced = &execution
            .trace
            .rows
            .iter()
            .find(|r| r.table == row.table && r.id == row.id)
            .unwrap()
            .row;
        let (Value::Row(a), Value::Row(b)) = (&row.row, traced) else {
            panic!("row")
        };
        assert!(a.shares_image(b));
    }
    for range in &execution.receipt.ranges {
        if let Some(halo) = &range.halo {
            assert!(
                execution
                    .receipt
                    .rows
                    .iter()
                    .any(|r| r.table == halo.table && r.id == halo.id)
            );
        }
        assert!(range.n2_suffix.as_ref().is_none_or(|s| s.len() <= 2));
    }
    println!(
        "SEARCH_STRESS {}",
        canonical_json(
            &serde_json::json!({"certificate":cert,"actual":{"steps":execution.trace.steps,"derived_steps":execution.trace.derived_steps,"derived_scratch_bytes":execution.trace.derived_scratch_bytes,"closure_bytes":canonical_json(&execution.receipt).len(),"rows":execution.receipt.rows.len()}})
        )
    );
}
#[test]
fn unicode_words_optional_null_uses_the_same_contract_and_bounds() {
    let (mut engine, programs) = fixture();
    let p = program(&programs, "search.tokenize");
    let cert = Checker::new(&engine.schema, Ceilings::default())
        .check(&p)
        .unwrap();
    for source in [
        Value::Null,
        Value::String("Straße STRASSE cafe\u{301} CAFÉ 漢字".into()),
    ] {
        let expected = crate::unicode::search_words(
            if source == Value::Null {
                None
            } else {
                Some(source.as_str().unwrap())
            },
            50,
        )
        .unwrap();
        let execution = engine
            .execute(
                &p,
                &cert,
                Context::query(
                    Actor::user("alice").unwrap(),
                    BTreeMap::from([("body".into(), source)]),
                ),
            )
            .unwrap();
        assert_eq!(
            execution.result,
            Value::Array(expected.into_iter().map(Value::String).collect())
        );
        assert!(canonical_json(&execution.result).len() as u64 <= cert.max_output_bytes);
    }
}

#[path = "search_boundaries.rs"]
mod boundaries;

#[path = "search_media_tests.rs"]
mod media;

#[path = "search_guide_tests.rs"]
mod guide;
