mod common;

use common::Project;
use serde_json::Value as Json;
use snapback2_core::*;
use std::collections::BTreeMap;
use std::fs;

fn text(value: &str) -> Value {
    Value::String(value.into())
}

fn id(value: &str) -> Value {
    Value::Id(value.into())
}

fn row<const N: usize>(fields: [(&str, Value); N]) -> Value {
    Value::Row(
        fields
            .into_iter()
            .map(|(key, value)| (key.into(), value))
            .collect(),
    )
}

fn execute(
    engine: &mut Engine,
    schema: &Schema,
    program: &Program,
    args: BTreeMap<String, Value>,
) -> Execution {
    let certificate = Checker::new(schema, Ceilings::default())
        .check(program)
        .unwrap();
    let actor = Actor::user("alice").unwrap();
    let mut context = match program.kind {
        ProgramKind::Mutation => Context::mutation(actor, args),
        _ => Context::query(actor, args),
    };
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let batch = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    context.new_ids = (0..1001).map(|n| format!("word-{batch}-{n}")).collect();
    let result = engine.execute(program, &certificate, context).unwrap();
    assert!(
        matches!(
            result.state,
            ExecutionState::Complete | ExecutionState::Committed { .. }
        ),
        "{:?}",
        result.state
    );
    assert!(result.trace.examined <= certificate.max_examined);
    assert!(result.trace.rule_probes <= certificate.max_rule_probes);
    assert!(result.trace.steps <= certificate.max_steps);
    assert!(canonical_json(&result.result).len() as u64 <= certificate.max_output_bytes);
    result
}

#[test]
fn quarry_words_recipe_indexes_edits_and_searches_inside_its_certificate() {
    let project = Project::new();
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/compiler/fixtures/quarry-words/snapback");
    fs::create_dir(project.path.join("snapback")).unwrap();
    for file in ["schema.q", "search.q"] {
        fs::copy(fixture.join(file), project.path.join("snapback").join(file)).unwrap();
    }
    let checked = project.run(&["check", "--json"]);
    assert!(
        checked.status.success(),
        "{}{}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr)
    );
    let compiled: Json = serde_json::from_slice(
        &fs::read(project.path.join(".snapback/build/project.json")).unwrap(),
    )
    .unwrap();
    let schema: Schema = serde_json::from_value(compiled["schema"].clone()).unwrap();
    let programs: Vec<Program> = serde_json::from_value(compiled["programs"].clone()).unwrap();
    let program = |name: &str| {
        programs
            .iter()
            .find(|p| p.name == format!("search.{name}"))
            .unwrap()
    };
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let long = "A".repeat(70);
    let body = format!("Hello, HELLO world! 42 foo_bar foo-bar {long}");
    engine
        .seed(
            "conversations",
            row([("id", id("c1")), ("title", text("chat"))]),
        )
        .unwrap();
    engine
        .seed(
            "messages",
            row([
                ("id", id("m1")),
                ("conversationId", id("c1")),
                ("author", id("alice")),
                ("body", text(&body)),
                ("at", Value::Int(1)),
            ]),
        )
        .unwrap();
    let arguments =
        |body: &str| BTreeMap::from([("messageId".into(), id("m1")), ("body".into(), text(body))]);
    let indexed = execute(&mut engine, &schema, program("index"), arguments(&body));
    assert_eq!(indexed.trace.writes["searchWords"], 6);
    // Repeated indexing upserts the same six keys.
    execute(&mut engine, &schema, program("index"), arguments(&body));
    let search = |engine: &mut Engine, term: &str| {
        execute(
            engine,
            &schema,
            program("search"),
            BTreeMap::from([
                ("conversationId".into(), id("c1")),
                ("term".into(), text(term)),
            ]),
        )
        .result
    };
    let found = Value::Array(vec![row([("messageId", id("m1"))])]);
    for term in [
        "hello",
        "world",
        "42",
        "foo",
        "bar",
        &long.to_ascii_lowercase(),
    ] {
        assert_eq!(search(&mut engine, term), found);
    }
    assert_eq!(search(&mut engine, "hel"), Value::Array(vec![]));
    let edited = execute(
        &mut engine,
        &schema,
        program("edit"),
        arguments("WORLD café CAFÉ naïve 中文 AéB １２3 ß İ"),
    );
    assert_eq!(edited.trace.writes["searchWords"], 13); // six deletes + seven distinct new terms
    assert_eq!(search(&mut engine, "hello"), Value::Array(vec![]));
    assert_eq!(
        search(&mut engine, &long.to_ascii_lowercase()),
        Value::Array(vec![])
    );
    for term in ["world", "caf", "na", "ve", "a", "b", "3"] {
        assert_eq!(search(&mut engine, term), found);
    }
    execute(&mut engine, &schema, program("edit"), arguments(""));
    assert_eq!(search(&mut engine, "world"), Value::Array(vec![]));
}

#[test]
fn words_corpus_has_exact_order_whole_tokens_and_safe_output_bounds() {
    let case: Json =
        serde_json::from_str(include_str!("../../../corpus/edge-ascii-words.json")).unwrap();
    let schema: Schema = serde_json::from_value(case["schema"].clone()).unwrap();
    let program: Program = serde_json::from_value(case["program"].clone()).unwrap();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let result = execute(&mut engine, &schema, &program, BTreeMap::new());
    let words = |items: &[&str]| Value::Array(items.iter().map(|value| text(value)).collect());
    assert_eq!(
        result.result,
        Value::Array(vec![
            words(&["hello", "world", "42", "foo", "bar", &"a".repeat(70)]),
            words(&[]),
            words(&["caf", "na", "ve", "a", "b", "3"]),
        ])
    );
}

#[test]
fn words_loop_elements_keep_the_whole_input_width_through_aliases() {
    let schema = Schema::default();
    let words = Expr::Builtin {
        builtin: Builtin::Words,
        args: vec![Expr::Variable("body".into())],
    };
    for alias in 0..3 {
        let mut program = Program {
            name: "firstWord".into(),
            kind: ProgramKind::Query,
            args: BTreeMap::from([("body".into(), ArgType::Text { max: 2000 })]),
            read_time_granularity_ms: None,
            result_page_site: None,
            body: vec![],
        };
        if alias > 0 {
            program.body.push(Stmt::Let {
                name: "terms".into(),
                value: if alias == 1 {
                    words.clone()
                } else {
                    Expr::Array(vec![])
                },
            });
        }
        if alias == 2 {
            program.body.push(Stmt::If {
                condition: Expr::Literal(Value::Bool(true)),
                then_body: vec![Stmt::Assign {
                    name: "terms".into(),
                    value: words.clone(),
                }],
                else_body: vec![],
            });
        }
        program.body.push(Stmt::For {
            binding: "term".into(),
            domain: LoopDomain::DerivedArray {
                value: if alias > 0 {
                    Expr::Variable("terms".into())
                } else {
                    words.clone()
                },
                max: 1001,
                bound_source: "words(body: text <=2000)".into(),
            },
            body: vec![Stmt::Return(Expr::Variable("term".into()))],
        });
        program.body.push(Stmt::Return(Expr::Literal(text(""))));
        let mut engine = Engine::memory(schema.clone()).unwrap();
        let result = execute(
            &mut engine,
            &schema,
            &program,
            BTreeMap::from([("body".into(), text(&"A".repeat(2000)))]),
        );
        assert_eq!(result.result, text(&"a".repeat(2000)));
    }
}
