mod common;

use common::Project;
use serde_json::{Value as Json, json};
use snapback2_core::engine::ClosureReceipt;
use snapback2_core::*;
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::process::{Command, Stdio};

fn rows(engine: &Engine, schema: &Schema) -> Json {
    schema
        .tables
        .keys()
        .map(|table| {
            let rows: BTreeMap<_, _> = engine
                .rows(table)
                .unwrap()
                .into_iter()
                .map(|row| (row.field("id").unwrap().as_str().unwrap().to_owned(), row))
                .collect();
            (table.clone(), serde_json::to_value(rows).unwrap())
        })
        .collect()
}

// Hydrate the actual compiled IR and the pre-execution rows; compare both results
// and committed rows against the engine, so a no-op mutation cannot pass parity.
fn twin(input: Json) {
    let mut child = Command::new("bun").args(["-e", r#"
        import { ClientStore } from './src/evaluator';
        import { canonicalJson } from './src/value-runtime';
        const input = await Bun.stdin.json();
        const store = new ClientStore(input.schema, input.receipt);
        let result;
        try {
            const local = input.program.kind === 'Mutation'
                ? store.applyMutation(input.program, input.context)
                : store.reexecute(input.program, input.context, input.certificate);
            if (!['predicted', 'fresh'].includes(local.state)) throw new Error(JSON.stringify(local));
            result = { value: local.execution.result };
        } catch (error) { result = { error: error.authoredCode ?? error.code ?? error.message }; }
        if (canonicalJson(result) !== canonicalJson(input.expected))
            throw new Error(`${input.program.name}: ${canonicalJson(result)} != ${canonicalJson(input.expected)}`);
        if (input.rows) {
            const rows = Object.fromEntries(Object.keys(input.schema.tables).map(table => [table,
                Object.fromEntries(store.rows(table).map(row => [row.Row.id.Id, row]))]));
            if (canonicalJson(rows) !== canonicalJson(input.rows)) throw new Error('engine/twin rows differ');
        }
    "#]).current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/evaluator"))
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn text(value: &str) -> Value {
    Value::String(value.into())
}

fn id(value: &str) -> Value {
    Value::Id(value.into())
}

fn dense_words_body() -> String {
    // ASCII lowercase dedupe admits only 36 distinct single-character words.
    // After those, distinct two-character runs maximize the remaining density.
    let alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    let mut terms: Vec<String> = alphabet.chars().map(|c| c.to_string()).collect();
    for a in alphabet.chars() {
        for b in alphabet.chars() {
            terms.push(format!("{a}{b}"));
        }
    }
    let dense = terms[..679].join(" ");
    assert_eq!(dense.chars().count(), 2000);
    dense
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
    let before: Vec<_> = schema.tables.keys().flat_map(|table| engine.rows(table).unwrap().into_iter()
        .map(move |row| json!({ "table": table, "id": row.field("id").unwrap().as_str().unwrap(), "row": row }))).collect();
    let result = engine
        .execute(program, &certificate, context.clone())
        .unwrap();
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
    // Retained-result size sanity check, not an engine peak/heap meter: neither
    // AuthoritativeTrace nor ClosureReceipt exposes measured held bytes.
    // Null/Bool/Int count as zero here, so this assertion is vacuous for the
    // recipe's Boolean index/edit results. Read receipts and transient write
    // inputs are outside retention.rs::statements' retained-value pricing.
    let held_bytes = match &result.result {
        Value::Null | Value::Bool(_) | Value::Int(_) => 0,
        value => canonical_json(value).len() as u64,
    };
    assert!(
        held_bytes <= certificate.max_closure_bytes,
        "held {held_bytes}, certificate {}",
        certificate.max_closure_bytes
    );
    let mut receipt = serde_json::to_value(&result.receipt).unwrap();
    receipt["rows"] = json!(before);
    twin(
        json!({ "schema": schema, "program": program, "context": context, "certificate": certificate,
        "receipt": receipt, "expected": { "value": result.result }, "rows": rows(engine, schema) }),
    );
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
    let reindexed = execute(&mut engine, &schema, program("index"), arguments(&body));
    assert_eq!(reindexed.trace.writes["searchWords"], 6);
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
    assert_eq!(search(&mut engine, "HELLO"), Value::Array(vec![]));
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
    for term in ["world", "caf", "na", "ve", "a", "b", "3"] {
        assert_eq!(search(&mut engine, term), Value::Array(vec![]));
    }
    // A pre-existing nonempty message has never been indexed.
    engine
        .seed(
            "messages",
            row([
                ("id", id("m2")),
                ("conversationId", id("c1")),
                ("author", id("alice")),
                ("body", text("Never indexed")),
                ("at", Value::Int(2)),
            ]),
        )
        .unwrap();
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(program("edit"))
        .unwrap();
    let error = engine
        .execute(
            program("edit"),
            &certificate,
            Context::mutation(
                Actor::user("alice").unwrap(),
                BTreeMap::from([
                    ("messageId".into(), id("m2")),
                    ("body".into(), text("changed")),
                ]),
            ),
        )
        .unwrap_err();
    assert!(
        matches!(error, RuntimeError::Require { ref code } if code == "NOT_FOUND"),
        "{error}"
    );
    assert_eq!(
        engine
            .rows("messages")
            .unwrap()
            .iter()
            .find(|r| r.field("id").unwrap() == &id("m2"))
            .unwrap()
            .field("body")
            .unwrap(),
        &text("Never indexed")
    );
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
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&program)
            .unwrap();
        let domain = Value::Array(vec![text(&"a".repeat(2000))]);
        // Reconstruct the known held list plus returned token. This checks the
        // certificate's reserve for that shape, not an observed engine peak.
        let held = canonical_json(&domain).len() + canonical_json(&result.result).len();
        assert!(
            held as u64 <= certificate.max_closure_bytes,
            "{held} > {}",
            certificate.max_closure_bytes
        );
    }
}

#[test]
fn words_dense_inputs_dedupe_and_stay_inside_output_and_closure_bounds() {
    let schema = Schema::default();
    let program = Program {
        name: "words.dense".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("body".into(), ArgType::Text { max: 2000 })]),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![Stmt::Return(Expr::Builtin {
            builtin: Builtin::Words,
            args: vec![Expr::Variable("body".into())],
        })],
    };
    let dense = dense_words_body();
    for (body, expected) in [("a ".repeat(1000), 1), (dense, 679)] {
        let mut engine = Engine::memory(schema.clone()).unwrap();
        let result = execute(
            &mut engine,
            &schema,
            &program,
            BTreeMap::from([("body".into(), text(&body))]),
        );
        assert_eq!(result.result.as_array().unwrap().len(), expected);
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&program)
            .unwrap();
        assert!(canonical_json(&result.result).len() as u64 <= certificate.max_closure_bytes);
    }
}

fn check_coalesced_words(maybe_max: u32, body_max: u32, argument: bool) {
    let project = Project::new();
    fs::create_dir(project.path.join("snapback")).unwrap();
    fs::write(
        project.path.join("snapback/schema.q"),
        format!(
            "table docs:\n  maybe: text <={maybe_max} ?\n  body: text <={body_max}\n  public\n"
        ),
    )
    .unwrap();
    let (args, left) = if argument {
        (format!(", maybe: text <={maybe_max} ?"), "maybe")
    } else {
        (String::new(), "row.maybe")
    };
    fs::write(project.path.join("snapback/probe.q"), format!(
        "query probe(doc: docs{args}):\n  row = docs[doc] !\n  terms = words({left} ?? row.body)\n  for term in terms:\n    require term != '' else EMPTY\n  return terms\n"
    )).unwrap();
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
    let program: Program = serde_json::from_value(compiled["programs"][0].clone()).unwrap();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let body = if body_max == 2000 {
        dense_words_body()
    } else {
        "a b c d e f g h i j ".into()
    };
    assert_eq!(body.chars().count(), body_max as usize);
    // maybe is absent in both the stored row and, when declared, the arguments.
    engine
        .seed("docs", row([("id", id("d1")), ("body", text(&body))]))
        .unwrap();
    let mut args = BTreeMap::from([("doc".into(), id("d1"))]);
    if argument {
        args.insert("maybe".into(), Value::Null);
    }
    let result = execute(&mut engine, &schema, &program, args);
    let expected = Value::Array(body.split_ascii_whitespace().map(text).collect());
    assert_eq!(result.result, expected);
    let max = program
        .body
        .iter()
        .find_map(|stmt| match stmt {
            Stmt::For {
                domain: LoopDomain::DerivedArray { max, .. },
                ..
            } => Some(*max),
            _ => None,
        })
        .unwrap();
    assert_eq!(max, maybe_max.max(body_max) / 2 + 1);
    assert!(result.result.as_array().unwrap().len() <= max as usize);
}

#[test]
fn words_wider_right_column_executes_when_left_column_is_absent() {
    check_coalesced_words(20, 2000, false);
}

#[test]
fn words_narrower_right_column_executes_when_left_column_is_absent() {
    check_coalesced_words(2000, 20, false);
}

#[test]
fn words_wider_right_column_executes_when_left_argument_is_absent() {
    check_coalesced_words(20, 2000, true);
}

#[test]
fn words_narrower_right_column_executes_when_left_argument_is_absent() {
    check_coalesced_words(2000, 20, true);
}

#[test]
fn words_text_plus_ir_refuses_identically_in_engine_and_twin() {
    let schema = Schema::default();
    let plus = Expr::Binary {
        op: BinaryOp::Add,
        left: Box::new(Expr::Variable("a".into())),
        right: Box::new(Expr::Variable("b".into())),
    };
    for value in [
        plus.clone(),
        Expr::Builtin {
            builtin: Builtin::Words,
            args: vec![plus],
        },
    ] {
        let program = Program {
            name: "words.plus".into(),
            kind: ProgramKind::Query,
            args: BTreeMap::from([
                ("a".into(), ArgType::Text { max: 4 }),
                ("b".into(), ArgType::Text { max: 4 }),
            ]),
            read_time_granularity_ms: None,
            result_page_site: None,
            body: vec![Stmt::Return(value)],
        };
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&program)
            .unwrap();
        let context = Context::query(
            Actor::user("alice").unwrap(),
            BTreeMap::from([("a".into(), text("a b ")), ("b".into(), text("c d"))]),
        );
        let error = Engine::memory(schema.clone())
            .unwrap()
            .execute(&program, &certificate, context.clone())
            .unwrap_err();
        assert!(error.to_string().contains("E_TYPE"), "{error}");
        twin(
            json!({ "schema": schema, "program": program, "certificate": certificate,
            "context": context, "receipt": ClosureReceipt::default(), "expected": { "error": "E_TYPE" } }),
        );
    }
}

#[test]
fn words_narrow_column_refuses_the_whole_token_and_rolls_back() {
    let project = Project::new();
    fs::create_dir(project.path.join("snapback")).unwrap();
    fs::write(
        project.path.join("snapback/schema.q"),
        "table terms:\n  term: text <=64\n  public\n  insert <- allow\n",
    )
    .unwrap();
    fs::write(project.path.join("snapback/probe.q"), "mutation probe(body: text <=2000):\n  for term in words(body):\n    insert terms { term }\n  return true\n").unwrap();
    let checked = project.run(&["check", "--json"]);
    assert!(
        checked.status.success(),
        "{}",
        String::from_utf8_lossy(&checked.stderr)
    );
    let compiled: Json = serde_json::from_slice(
        &fs::read(project.path.join(".snapback/build/project.json")).unwrap(),
    )
    .unwrap();
    let schema: Schema = serde_json::from_value(compiled["schema"].clone()).unwrap();
    let program: Program = serde_json::from_value(compiled["programs"][0].clone()).unwrap();
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let mut context = Context::mutation(
        Actor::user("alice").unwrap(),
        BTreeMap::from([("body".into(), text(&format!("ok {}", "A".repeat(70))))]),
    );
    context.new_ids = ["short".into(), "long".into()].into();
    let error = engine
        .execute(&program, &certificate, context.clone())
        .unwrap_err();
    assert!(
        matches!(error, RuntimeError::Input(ref message) if message == "terms.term violates Text { max: 64 }"),
        "{error}"
    );
    assert!(
        engine.rows("terms").unwrap().is_empty(),
        "partial insert or truncated token escaped rollback"
    );
    twin(
        json!({ "schema": schema, "program": program, "certificate": certificate, "context": context,
        "receipt": ClosureReceipt::default(), "expected": { "error": "E_INPUT" }, "rows": rows(&engine, &schema) }),
    );
}

#[test]
fn words_benchmark_upsert_certifies_the_6008_rule_probe_product() {
    let project = Project::new();
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/compiler/fixtures/quarry-words/snapback");
    fs::create_dir(project.path.join("snapback")).unwrap();
    let schema = fs::read_to_string(fixture.join("schema.q")).unwrap()
        .replace("  public\n  insert <- allow\n  update <- allow\n  delete <- allow", "  read <- exists memberships[.conversationId, viewer]\n  insert <- exists memberships[.conversationId, viewer]\n  update <- exists memberships[.conversationId, viewer]\n  delete <- exists memberships[.conversationId, viewer]");
    let schema = schema.replace(
        "  public\n  insert <- .author = viewer",
        "  read <- exists memberships[.conversationId, viewer]\n  insert <- .author = viewer",
    );
    fs::write(project.path.join("snapback/schema.q"), format!("{schema}\ntable memberships:\n  conversationId: conversations\n  principal: principal\n  unique byConversationPrincipal: conversationId, principal\n  read <- exists memberships[.conversationId, viewer]\n")).unwrap();
    // Only the benchmark's index mutation; edit has a different probe product.
    let source = fs::read_to_string(fixture.join("search.q")).unwrap();
    fs::write(
        project.path.join("snapback/search.q"),
        source.split("mutation edit").next().unwrap(),
    )
    .unwrap();
    let checked = project.run(&["check", "--json"]);
    assert!(
        checked.status.success(),
        "{}",
        String::from_utf8_lossy(&checked.stderr)
    );
    let compiled: Json = serde_json::from_slice(
        &fs::read(project.path.join(".snapback/build/project.json")).unwrap(),
    )
    .unwrap();
    let schema: Schema = serde_json::from_value(compiled["schema"].clone()).unwrap();
    let program: Program = serde_json::from_value(compiled["programs"][0].clone()).unwrap();
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    // 1001 × (4 + 2) + 2. Each exists-membership rule costs two probes:
    // the membership lookup and its read rule's self-exists visibility probe.
    // Per upsert: 4 = max(insert's 2, update's old/new image rules at 2 each);
    // 2 = the searchWords address lookup's read rule before the upsert.
    // The trailing +2 is the messages[messageId] read rule outside the loop.
    assert_eq!(certificate.max_rule_probes, 6008);
}
