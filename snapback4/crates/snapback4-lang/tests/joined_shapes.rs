//! Differing row kinds refuse early; only provably simple joins offer source edits.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{Bound, compile, diag::Diagnostic, types::Ty};
use std::collections::BTreeMap;

const TABLE: &str = "table notes:\n  title: text\n  owner: principal\n  public\n";
const DIRECT: &str = "query direct(key: notes):\n  record = notes[key] ! else NOT_FOUND\n  return { ...record } { title: 'override', * }\n";
const KINDS: [(&str, &str); 4] = [
    ("Row", "record"),
    ("RowShape", "record { * }"),
    ("RowObject", "{ ...record }"),
    ("Object", "{ id: record.id, owner: record.owner, title: record.title }"),
];

fn checked(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{source}\n{:?}", bound.diagnostics);
    bound
}

fn refusal(source: &str) -> Diagnostic {
    let bound = compile(&[("schema.q".into(), source.into())]);
    bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_SHAPE_JOIN")
        .unwrap_or_else(|| panic!("{source}\n{:?}", bound.diagnostics)).clone()
}

fn engine(source: &str) -> Engine {
    let bound = checked(source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("notes".into(), object([("id", Value::Id("note".into())), ("owner", Value::Id("alice".into())), ("title", Value::String("original".into()))]))]).unwrap();
    engine
}

fn context(ready: bool) -> Context {
    Context::new("alice", BTreeMap::from([("key".into(), Value::Id("note".into())), ("ready".into(), Value::Bool(ready))]))
}

// Paste the conditional rewrite exactly, including any branch-local setup.
fn conditional_rewrite(source: &str, original: &str, diagnostic: &Diagnostic) -> String {
    let (_, plan) = diagnostic.rewrite.split_once('\n').unwrap();
    let (setup, value) = plan.rsplit_once("use: ").unwrap();
    let mut lines = vec![];
    for line in source.lines() {
        if line.contains(original) {
            let indent = " ".repeat(line.len() - line.trim_start().len());
            lines.extend(setup.lines().map(|s| format!("{indent}{s}")));
            lines.push(line.replace(original, value));
        } else { lines.push(line.to_owned()); }
    }
    lines.join("\n") + "\n"
}

// Apply each source-located operand edit without substituting any invented
// condition or operand name. Two array items may share the same source line.
fn pair_rewrite(source: &str, diagnostic: &Diagnostic) -> String {
    let mut edits = BTreeMap::<usize, Vec<(String, String, String)>>::new();
    for part in diagnostic.rewrite.split("\nat ").skip(1) {
        let (header, plan) = part.split_once('\n').unwrap();
        let (site, original) = header.split_once(" replace `").unwrap();
        let line: usize = site.rsplit(':').nth(1).unwrap().parse().unwrap();
        let original = original.strip_suffix("`:").unwrap().to_owned();
        let (setup, value) = plan.rsplit_once("use: ").unwrap();
        edits.entry(line).or_default().push((original, setup.to_owned(), value.to_owned()));
    }
    let mut lines = vec![];
    for (index, line) in source.lines().enumerate() {
        let mut replaced = line.to_owned();
        if let Some(edits) = edits.get(&(index + 1)) {
            let indent = " ".repeat(line.len() - line.trim_start().len());
            for (original, setup, value) in edits {
                lines.extend(setup.lines().map(|s| format!("{indent}{s}")));
                replaced = replaced.replacen(original, value, 1);
            }
        }
        lines.push(replaced);
    }
    lines.join("\n") + "\n"
}

fn same_as_direct(source: &str, list: bool) {
    let mut engine = engine(source);
    let direct = engine.query("direct", Context::new("alice", BTreeMap::from([("key".into(), Value::Id("note".into()))]))).unwrap().data;
    for ready in [true, false] {
        let data = engine.query("run", context(ready)).unwrap().data;
        let expected = if list { Value::Array(vec![direct.clone(), direct.clone()]) } else { direct.clone() };
        assert_eq!(data, expected, "ready={ready}\n{source}");
    }
}

#[test]
fn every_differing_kind_is_refused_and_only_simple_row_joins_offer_rewrites() {
    for (left_kind, left) in KINDS {
        for (right_kind, right) in KINDS {
            if left_kind == right_kind { continue; }
            let locals = format!("  record = notes[key] ! else NOT_FOUND\n  leftValue = {left}\n  rightValue = {right}\n");
            for form in ["conditional", "assignment", "helper", "list", "container"] {
                let original = if form == "container" { "{ item: leftValue } if ready else { item: rightValue }" }
                    else { "leftValue if ready else rightValue" };
                let body = match form {
                    "conditional" | "container" => format!("  chosen = {original}\n  return chosen{} {{ title: 'override', * }}\n", if form == "container" { ".item" } else { "" }),
                    "assignment" => "  chosen = leftValue\n  if ready:\n    chosen = rightValue\n  return chosen { title: 'override', * }\n".into(),
                    "helper" => "  if ready:\n    return leftValue\n  return rightValue\n".into(),
                    _ => "  chosen = [leftValue, rightValue]\n  return chosen { title: 'override', * }\n".into(),
                };
                let source = if form == "helper" {
                    format!("{TABLE}{DIRECT}fn choose(key: notes, ready: bool):\n{locals}{body}query run(key: notes, ready: bool):\n  chosen = choose(key, ready)\n  return chosen {{ title: 'override', * }}\n")
                } else { format!("{TABLE}{DIRECT}query run(key: notes, ready: bool):\n{locals}{body}") };
                let error = refusal(&source);
                assert!(error.message.contains(left_kind) && error.message.contains(right_kind), "{form}: {error:?}");
                assert!(!error.rewrite.contains("flag") && !error.rewrite.contains("spreadArm") && !error.rewrite.contains("shapeArm"), "{error:?}");
                if !matches!(form, "conditional" | "assignment") || left_kind == "Object" || right_kind == "Object" {
                    explanation_only(&error);
                    if form == "container" { assert!(error.message.contains("field path item")); }
                    if form == "list" { assert!(error.message.contains("field path []")); }
                    continue;
                }
                let rewritten = if form == "conditional" {
                    assert!(error.rewrite.contains("ready"));
                    conditional_rewrite(&source, original, &error)
                } else { pair_rewrite(&source, &error) };
                same_as_direct(&rewritten, false);
            }
        }
    }
}

#[test]
fn both_astra_sequences_are_refused_at_the_first_join_even_without_a_shape() {
    for other in ["record", "1"] {
        for ending in ["return chosen { title: 'override', * }", "return chosen.title"] {
            let first_join = format!("{{ ...record }} if ready else {other}");
            let second_join = "spread if ready else record { * }";
            let source = format!("{TABLE}{DIRECT}query run(key: notes, ready: bool):\n  record = notes[key] ! else NOT_FOUND\n  spread = {first_join}\n  chosen = {second_join}\n  {ending}\n");
            let error = refusal(&source);
            assert_eq!(error.site.line as usize, source.lines().position(|line| line.contains("spread =")).unwrap() + 1);
            assert!(error.message.contains("RowObject"));
            explanation_only(&error);
        }
    }
}

fn explanation_only(error: &Diagnostic) {
    assert!(error.rewrite.is_empty(), "{error:?}");
    assert!(error.message.contains("arm A") && error.message.contains("arm B") && error.message.contains("make both arms the same kind"), "{error:?}");
    assert!(!error.to_string().contains("rewrite:"), "{error}");
    assert_eq!(serde_json::to_value(error).unwrap()["rewrite"], "");
}

#[test]
fn shaped_collections_and_complex_arms_explain_without_source_edits() {
    for expression in [
        "projected if ready else copied",
        "maybe if ready else copied",
        "{ title: (notes['missing'] ! else MISSING).title } if ready else (record { title })",
    ] {
        let source = format!("{TABLE}query run(key: notes, ready: bool):\n  record = notes[key] ! else NOT_FOUND\n  projected = notes first 1 by .id {{ * }}\n  maybe = projected if ready else null\n  copied = [{{ ...record }}]\n  return {expression}\n");
        let error = refusal(&source);
        explanation_only(&error);
        if !expression.starts_with('{') { assert!(error.message.contains("field path []")); }
    }
}

#[test]
fn identical_kinds_keep_their_wildcard_rule_types_and_pending_metadata() {
    let source = include_str!("fixtures/spread-metadata.q");
    let bound = checked(source);
    for name in ["shapedArms", "shapedConditional", "shapedReassignment"] {
        let Ty::RowObject(fields) = &bound.programs.iter().find(|p| p.program.name == name).unwrap().result else { panic!("{name}") };
        assert_eq!(fields["title"], Ty::Text(10000));
    }
    let ts = snapback4_lang::emit::typescript(&bound);
    assert!(ts.lines().find(|line| line.contains("shapedArms: Query<")).unwrap().contains("pending?: boolean"));
    let mut engine = engine(source);
    for flag in [true, false] {
        let ctx = Context::new("alice", BTreeMap::from([("key".into(), Value::Id("note".into())), ("flag".into(), Value::Bool(flag))]));
        for name in ["shapedArms", "shapedConditional", "shapedReassignment"] {
            assert_eq!(engine.query(name, ctx.clone()).unwrap().data.field("title").unwrap(), &Value::String(if flag { "original" } else { "override" }.into()));
        }
    }
}

#[test]
fn multiple_assignments_returns_and_appends_explain_without_source_edits() {
    let locals = "  record = notes[key] ! else NOT_FOUND\n  firstValue = record { * }\n  secondValue = record { * }\n  thirdValue = { ...record }\n";
    for body in [
        "  chosen = firstValue\n  chosen = secondValue\n  chosen = thirdValue\n  return chosen { title: 'override', * }\n",
        "  chosen = firstValue\n  if ready:\n    chosen = secondValue\n  chosen = thirdValue\n  return chosen { title: 'override', * }\n",
        "  chosen = firstValue\n  for number in [1]:\n    chosen = secondValue\n  chosen = thirdValue\n  return chosen { title: 'override', * }\n",
        "  if ready:\n    return firstValue\n  if not ready:\n    return secondValue\n  return thirdValue\n",
        "  chosen = [firstValue, secondValue, thirdValue]\n  return first(chosen) ! else EMPTY\n",
        "  chosen = []\n  chosen = chosen + [firstValue]\n  chosen = chosen + [secondValue]\n  chosen = chosen + [thirdValue]\n  return first(chosen) ! else EMPTY\n",
    ] {
        let source = format!("{TABLE}{DIRECT}query run(key: notes, ready: bool):\n{locals}{body}");
        let error = refusal(&source);
        explanation_only(&error);
    }
}

#[test]
fn no_row_kind_can_disappear_into_unknown_including_through_containers() {
    let fields = BTreeMap::from([("title".into(), Ty::Text(10000))]);
    let rows = [Ty::Row("notes".into()), Ty::WriteRow("notes".into()), Ty::RowShape(fields.clone()), Ty::RowObject(fields.clone())];
    for (i, row) in rows.iter().enumerate() {
        for (j, other) in rows.iter().enumerate() {
            assert_eq!(row.join(other).is_err(), i != j, "{row:?}, {other:?}");
        }
        for non_row in [Ty::Int, Ty::Text(8), Ty::Bool, Ty::Json, Ty::Unknown, Ty::Object(fields.clone())] {
            for (left, right) in [(row, &non_row), (&non_row, row)] {
                assert!(left.join(right).is_err(), "{left:?}, {right:?}");
                assert!(Ty::List(Box::new(left.clone()), 1).join(&Ty::List(Box::new(right.clone()), 1)).is_err());
                assert!(Ty::Object(BTreeMap::from([("item".into(), left.clone())])).join(&Ty::Object(BTreeMap::from([("item".into(), right.clone())]))).is_err());
            }
        }
        for container in [Ty::List(Box::new(row.clone()), 1), Ty::Collection(Box::new(row.clone()), 1), Ty::Object(BTreeMap::from([("item".into(), row.clone())])), Ty::Object(BTreeMap::from([("item".into(), row.clone().optional())]))] {
            assert!(container.join(&Ty::Int).is_err());
            assert!(Ty::Int.join(&container).is_err());
            assert!(container.join(&Ty::Unknown).is_err());
            assert!(Ty::Unknown.join(&container).is_err());
        }
        assert_eq!(row.join(&Ty::Null).unwrap(), row.clone().optional());
        assert_eq!(Ty::List(Box::new(Ty::Unknown), 0).join(&Ty::List(Box::new(row.clone()), 1)).unwrap(), Ty::List(Box::new(row.clone()), 1));
    }
}

#[test]
fn identical_kinds_and_nullable_rows_keep_their_existing_rules() {
    for (kind, expression) in &KINDS[..3] {
        let source = format!("{TABLE}query run(key: notes, ready: bool):\n  record = notes[key] ! else NOT_FOUND\n  leftValue = {expression}\n  rightValue = {expression}\n  chosen = leftValue if ready else rightValue\n  return chosen {{ title: 'override', * }}\n");
        let bound = checked(&source);
        let result = &bound.programs[0].result;
        let fields = match result { Ty::RowShape(fields) | Ty::RowObject(fields) => fields, _ => panic!("{result:?}") };
        assert_eq!(fields["title"], Ty::Text(if *kind == "RowShape" { 8 } else { 10000 }));
        let mut engine = engine(&source);
        for ready in [true, false] {
            assert_eq!(engine.query("run", context(ready)).unwrap().data.field("title").unwrap(), &Value::String(if *kind == "RowShape" { "override" } else { "original" }.into()));
        }
    }
    let source = format!("{TABLE}query run(key: notes, ready: bool):\n  record = notes[key]\n  chosen = record if ready else null\n  return chosen {{ * }}\n");
    let mut engine = engine(&source);
    assert_eq!(engine.query("run", context(false)).unwrap().data, Value::Null);
    assert_eq!(engine.query("run", context(true)).unwrap().data.field("title").unwrap(), &Value::String("original".into()));
}

#[test]
fn coalescing_order_helpers_and_view_fields_use_the_same_refusal() {
    let locals = "  record = notes[key] ! else NOT_FOUND\n  leftValue = { ...record }\n  rightValue = record { * }\n";
    for body in ["return leftValue ?? rightValue", "return min(leftValue, rightValue)", "return max(leftValue, rightValue)", "(firstValue, secondValue) = sorted(leftValue, rightValue)\n  return firstValue"] {
        let source = format!("{TABLE}query run(key: notes, ready: bool):\n{locals}  {body}\n");
        let error = refusal(&source);
        assert!(error.message.contains("RowObject") && error.message.contains("RowShape"));
        explanation_only(&error);
    }
    let source = format!("{TABLE}view both:\n  notes {{ id, item: . {{ * }} }}\n  notes {{ id, item: {{ ... . }} }}\nquery run():\n  return both first 2 by .id\n");
    let error = refusal(&source);
    assert!(error.message.contains("RowObject") && error.message.contains("RowShape"));
    explanation_only(&error);
    assert!(error.message.contains("field path item"));
}


#[test]
fn coalescing_nullability_and_untaken_work_get_explanations_only() {
    let locals = "  record = notes['note'] ! else NOT_FOUND\n  shaped = notes[key] { * }\n  copied = { ...record }\n";
    for expression in [
        "shaped ?? { ...record }",
        "shaped ?? copied",
        "(record { title }) ?? { title: (notes['missing'] ! else MISSING).title }",
        "copied ?? { title: (notes['missing'] ! else MISSING).title }",
    ] {
        let source = format!("{TABLE}query run(key: notes):\n{locals}  return {expression}\n");
        explanation_only(&refusal(&source));
    }
    // Existing matching-kind coalescing still preserves null and skips work.
    let source = format!("{TABLE}query run(key: notes):\n  left = notes[key] {{ * }}\n  right = notes['missing'] {{ * }}\n  return left ?? right\nquery lazy():\n  left = notes['note'] {{ * }}\n  return left ?? (notes['missing'] ! else MISSING) {{ * }}\n");
    let mut engine = engine(&source);
    assert_eq!(engine.query("run", Context::new("alice", [("key".into(), Value::Id("missing".into()))].into())).unwrap().data, Value::Null);
    assert_eq!(engine.query("lazy", Context::new("alice", BTreeMap::new())).unwrap().data.field("title").unwrap(), &Value::String("original".into()));
}

#[test]
fn nested_kind_conflicts_name_the_path_without_repeating_a_rewrite() {
    for (left, right, path) in [
        ("record { item: (record { * }) }", "record { item: { ...record } }", "item"),
        ("{ item: { child: { ...record } } }", "{ item: { child: record { * } } }", "item.child"),
        ("{ item: [{ ...record }] }", "{ item: [record { * }] }", "item[]"),
        ("record { nested: { ...record } }", "{ ...record, nested: record { * } }", "nested"),
    ] {
        let source = format!("{TABLE}query run(key: notes, ready: bool):\n  record = notes[key] ! else NOT_FOUND\n  left = {left}\n  right = {right}\n  return left if ready else right\n");
        let error = refusal(&source);
        explanation_only(&error);
        assert!(error.message.contains(&format!("field path {path}:")), "{error:?}");
        assert!(error.message.contains("spread object") && error.message.contains("row shape"));
    }
}

#[test]
fn simple_nullable_locals_and_row_reads_keep_nullability_and_laziness() {
    for left in ["maybe", "notes[key]", "notes['it\\'s missing'] ! else MISSING"] {
        for form in ["conditional", "assignment"] {
            let original = format!("{left} if ready else shaped");
            let tail = if form == "conditional" { format!("  chosen = {original}\n") }
                else { format!("  chosen = shaped\n  if ready:\n    chosen = {left}\n") };
            let source = format!("{TABLE}query run(key: notes, ready: bool):\n  maybe = notes[key]\n  shaped = notes['note'] {{ * }}\n{tail}  return chosen\n");
            let error = refusal(&source);
            assert!(!error.rewrite.is_empty(), "{error:?}");
            let fixed = if form == "conditional" { conditional_rewrite(&source, &original, &error) } else { pair_rewrite(&source, &error) };
            assert!(checked(&fixed).programs[0].result.is_optional(), "{fixed}");
            let mut engine = engine(&fixed);
            for ready in [true, false] { for key in ["note", "missing"] {
                let args = [("key".into(), Value::Id(key.into())), ("ready".into(), Value::Bool(ready))].into();
                let answer = engine.query("run", Context::new("alice", args));
                if ready && left.contains("MISSING") { assert_eq!(answer.unwrap_err().code, "MISSING"); }
                else {
                    let answer = answer.unwrap();
                    assert_eq!(answer.metered.examined, 2 + u64::from(ready && left == "notes[key]"), "read each selected operand once: {fixed}");
                    let data = answer.data;
                    if ready && key == "missing" { assert_eq!(data, Value::Null); }
                    else { assert_eq!(data.field("title").unwrap(), &Value::String("original".into())); }
                }
            } }
        }
    }
}

#[test]
fn an_empty_row_collector_can_be_reset_inside_a_loop() {
    // Audit direct reset, conditional assignment and an empty alias, including
    // a collector that already held a row before the loop starts.
    for initial in ["[]", "[record]"] { for reset in ["[]", "empty", "[] if ready else []"] {
        let source = format!("{TABLE}query run(key: notes, ready: bool):\n  record = notes[key] ! else NOT_FOUND\n  empty = []\n  bag = {initial}\n  for n in [1, 2]:\n    bag = {reset}\n    bag = bag + [record]\n  return bag\n");
        let mut engine = engine(&source);
        for ready in [true, false] {
            let answer = engine.query("run", context(ready)).unwrap();
            let rows = answer.data.as_array().unwrap();
            assert_eq!(rows.len(), 1, "reset each iteration: {source}");
            assert_eq!(rows[0].field("title").unwrap(), &Value::String("original".into()));
        }
    } }
}

#[test]
fn empty_collections_meet_rows_in_helpers_coalescing_and_conditional_assignment() {
    for reset in ["empty(key)", "[] ?? [record]", "[record] ?? []", "[] if ready else [record]", "[record] if ready else []"] {
        let source = format!("{TABLE}fn empty(key: notes):\n  for n in [1, 2]:\n    bag = [notes[key] ! else NOT_FOUND]\n    bag = []\n    return bag\n  return []\nquery run(key: notes, ready: bool):\n  record = notes[key] ! else NOT_FOUND\n  bag = []\n  for n in [1, 2]:\n    bag = {reset}\n    bag = bag + [record]\n  return bag\n");
        let mut engine = engine(&source);
        for ready in [true, false] {
            let rows = engine.query("run", context(ready)).unwrap().data;
            let expected = match reset {
                "[record] ?? []" => 2,
                "[] if ready else [record]" if !ready => 2,
                "[record] if ready else []" if ready => 2,
                _ => 1,
            };
            assert_eq!(rows.as_array().unwrap().len(), expected, "{source}");
        }
    }
    let source = format!("{TABLE}fn choose(key: notes, ready: bool):\n  if ready:\n    return []\n  return [notes[key] ! else NOT_FOUND]\nquery run(key: notes, ready: bool):\n  return choose(key, ready)\n");
    let mut engine = engine(&source);
    for ready in [true, false] { assert_eq!(engine.query("run", context(ready)).unwrap().data.as_array().unwrap().len(), usize::from(!ready)); }

    let source = format!("{TABLE}query run(key: notes):\n  record = notes[key] ! else NOT_FOUND\n  bag = [1 if true else 'unknown']\n  bag = bag + [record]\n  return bag\n");
    let error = refusal(&source);
    assert!(error.message.contains("unknown value") && error.message.contains("Row"));
    explanation_only(&error);
}

#[test]
fn reassignment_with_intervening_observations_only_explains_the_conflict() {
    for middle in [
        "  observed = chosen { title: 'changed', * }\n  chosen = copied\n",
        "  if chosen.title = 'original':\n    chosen = copied\n",
    ] {
        let source = format!("{TABLE}query run(key: notes):\n  record = notes[key] ! else NOT_FOUND\n  shaped = record {{ * }}\n  copied = {{ ...record }}\n  chosen = shaped\n{middle}  return chosen\n");
        explanation_only(&refusal(&source));
    }
}
