use snapback4_core::{Context, Engine, Value};
use snapback4_lang::{compile, parser::parse_document, types::Ty};
use std::collections::BTreeMap;

fn checked(source: &str) -> snapback4_lang::Bound {
    let result = compile(&[("schema.q".into(), source.into())]);
    assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
    result
}

#[test]
fn object_spreads_merge_rows_objects_and_types_left_to_right() {
    let source = "table profiles:\n  principal: principal\n  handle: text 3..20\n  bio: text\n  public\nquery row(h: profiles):\n  p = profiles[h] ! else NOT_FOUND\n  return { ...p, bio: 42, extra: true }\nquery objects():\n  a = { n: 1, keep: true }\n  b = { n: 'second', tail: 2 }\n  return { n: false, ...a, ...b, tail: 3, n: 'last' }\nquery duplicate():\n  return { x: 1, x: 'last' }\n";
    let compiled = checked(source);
    let types = &compiled.programs.iter().find(|p| p.program.name == "row").unwrap().result;
    assert_eq!(types, &Ty::Object(BTreeMap::from([
        ("id".into(), Ty::Ref("profiles".into())), ("principal".into(), Ty::Principal),
        ("handle".into(), Ty::Text(20)), ("bio".into(), Ty::Int), ("extra".into(), Ty::Bool),
    ])));
    let ts = snapback4_lang::emit::typescript(&compiled);
    for field in ["bio: number", "extra: boolean", "handle: string", "principal: string", "n: string"] {
        assert!(ts.contains(field), "{field}: {ts}");
    }
    let mut engine = Engine::memory(compiled.schema, compiled.programs.into_iter().map(|p| p.program)).unwrap();
    let objects = engine.query("objects", Context::new("alice", BTreeMap::new())).unwrap();
    assert_eq!(snapback4_core::wire::to_json(&objects.data), serde_json::json!({"n":"last", "keep":true, "tail":3}));
    assert_eq!(engine.query("duplicate", Context::new("alice", BTreeMap::new())).unwrap().data.field("x").unwrap(), &Value::String("last".into()));
}

#[test]
fn nullable_spread_has_a_presence_rewrite_and_narrowing_accepts_it() {
    let source = "table profiles:\n  handle: text 3..20\n  unique handle\n  public\nquery one(h: text 3..20):\n  p = profiles[handle = h]\n  return { ...p }\n";
    let bad = compile(&[("schema.q".into(), source.into())]);
    let diagnostic = bad.diagnostics.iter().find(|d| d.code == "E_QUARRY_SPREAD").unwrap();
    assert_eq!(diagnostic.site.line, 7);
    assert!(diagnostic.rewrite.contains("! else NOT_FOUND"));
    assert!(diagnostic.rewrite.contains("return { ...p }"));
    checked(&source.replace("p = profiles[handle = h]", "p = profiles[handle = h] ! else NOT_FOUND"));
    checked(&source.replace("  return { ...p }", "  if p != null:\n    return { ...p }\n  return null"));
}

#[test]
fn spread_refuses_scalars_dynamic_json_and_pages() {
    for source in [
        "query bad():\n  return { ...42 }\n",
        "query bad(value: json <=100):\n  return { ...value }\n",
        "table profiles:\n  public\nquery bad():\n  return { ...profiles first 2 }\n",
    ] {
        let compiled = compile(&[("schema.q".into(), source.into())]);
        assert!(compiled.diagnostics.iter().any(|d| d.code == "E_QUARRY_SPREAD"), "{:?}", compiled.diagnostics);
    }
}

#[test]
fn default_text_normalizes_to_the_existing_type_schema_ir_and_generated_types() {
    let source = "table notes:\n  title: text\n  optional: text ?\n  public\n  insert <- allow\nfn echo(value: text): value\nquery one(value: text):\n  return echo(value)\nmutation add(title: text):\n  return insert notes { title }\n";
    let explicit = source.replace(": text", ": text <=10000");
    let a = checked(source);
    let b = checked(&explicit);
    assert_eq!(serde_json::to_value(&a.schema).unwrap(), serde_json::to_value(&b.schema).unwrap());
    assert_eq!(snapback4_lang::emit::typescript(&a), snapback4_lang::emit::typescript(&b));
    for (a, b) in a.programs.iter().zip(&b.programs) {
        assert_eq!(a.program, b.program);
        assert_eq!(a.result, b.result);
    }
    let (doc, errors) = parse_document("schema.q", source);
    assert!(errors.is_empty());
    assert_eq!(doc.functions[0].args[0].type_, doc.programs[0].args[0].type_);
    let too_wide = compile(&[("schema.q".into(), source.replace("query one(value: text)", "query one(value: text <=10001)"))]);
    assert!(too_wide.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"));
}

#[test]
fn default_index_key_diagnostic_names_read_unique_and_sweep_sites() {
    for (declaration, line, unique) in [
        ("query byBody(body: text, c: cursor ?):\n  return notes where .body = body first 20 after c\n", 6, false),
        ("job sweep():\n  for n in notes by .body:\n    delete notes[n.id]\n", 6, false),
        ("", 5, true),
    ] {
        let source = if unique { "table notes:\n  body: text\n  immutable body\n  public\n  unique body\n".to_owned() }
            else { format!("table notes:\n  body: text\n  immutable body\n  public\n{declaration}") };
        let result = compile(&[("schema.q".into(), source.clone())]);
        let diagnostic = result.diagnostics.iter().find(|d| d.code == "E_INDEX_KEY_BYTES").unwrap();
        assert_eq!(diagnostic.site.line, line, "{diagnostic}");
        assert!(diagnostic.message.contains(&format!("schema.q:{line}:")), "{diagnostic}");
        assert!(diagnostic.message.contains("notes.body"));
        assert!(diagnostic.rewrite.contains("body: text <="));
        assert!(!diagnostic.to_string().contains("$intent:"));
        assert!(!diagnostic.rewrite.contains("remove components"));
        checked(&source.replace("body: text", "body: text <=100"));
    }
    let declared = compile(&[("schema.q".into(), "table notes:\n  body: text\n  by authored: body\n  public\n".into())]);
    assert!(declared.diagnostics.iter().any(|d| d.code == "E_INDEX_KEY_BYTES" && d.message.contains("notes.authored")));
}

#[test]
fn guessed_table_rules_name_the_canonical_spelling_without_accepting_aliases() {
    for (guessed, expected) in [("select", "read"), ("view", "read"), ("create", "insert"), ("modify", "update"), ("edit", "update"), ("remove", "delete"), ("write", "insert")] {
        let (_, errors) = parse_document("schema.q", &format!("table notes:\n  owner: principal\n  {guessed} <- .owner = viewer\n"));
        assert_eq!(errors.len(), 1, "{errors:?}");
        let d = &errors[0];
        assert_eq!(d.code, "E_QUARRY_RULE_SPELLING");
        assert_eq!(d.site.line, 3);
        assert!(d.message.contains(expected) && d.rewrite.contains(&format!("{expected} <-")));
        assert!(!d.rewrite.contains("column"));
        assert!(!d.mechanical);
        // The same words remain valid column names.
        checked(&format!("table notes:\n  {guessed}: text\n  public\n"));
    }
}

#[test]
fn job_every_rewrite_preserves_the_period_and_clock_offset() {
    for period in ["every 1h", "every 2m", "every 1d at 08:00"] {
        let (_, errors) = parse_document("schema.q", &format!("job sweep {period}:\n  for n in notes:\n    delete notes[n.id]\n"));
        let d = errors.iter().find(|d| d.code == "E_QUARRY_JOB_SCHEDULE").unwrap();
        assert_eq!(d.site.line, 1);
        assert!(d.rewrite.contains("job sweep():"));
        assert!(d.rewrite.contains(&format!("schedule sweepEvery {period}: sweep")), "{d}");
        checked(&format!("table notes:\n  public\njob sweep():\n  for n in notes:\n    delete notes[n.id]\nschedule sweepEvery {period}: sweep\n"));
    }
}

#[test]
fn job_every_rewrite_qualifies_a_module_job() {
    let (_, errors) = parse_document("jobs.q", "job sweep every 1h:\n  for n in notes:\n    delete notes[n.id]\n");
    let d = errors.iter().find(|d| d.code == "E_QUARRY_JOB_SCHEDULE").unwrap();
    let schedule = d.rewrite.lines().nth(1).unwrap();
    assert_eq!(schedule, "schedule sweepEvery every 1h: jobs.sweep");
    let fixed = compile(&[
        ("schema.q".into(), "table notes:\n  public\n".into()),
        ("jobs.q".into(), format!("job sweep():\n  for n in notes:\n    delete notes[n.id]\n{schedule}\n")),
    ]);
    assert!(fixed.diagnostics.is_empty(), "{:?}", fixed.diagnostics);
}

#[test]
fn new_codes_have_why_entries_and_cards() {
    for code in ["E_QUARRY_SPREAD", "E_QUARRY_RULE_SPELLING", "E_QUARRY_JOB_SCHEDULE"] {
        let why = snapback4_lang::guide::explain_code(code).unwrap();
        assert!(why.contains(code) && why.contains("snapback4 guide"));
        assert!(!why.contains("No dedicated section"), "{why}");
    }
}

#[test]
fn spread_operands_and_overridden_fields_execute_once_in_source_order() {
    let source = "table logs:\n  label: text\n  public\n  insert <- allow\nfn record(label: text):\n  insert logs { label }\n  return { label, twice: label }\nmutation run():\n  return { ...record('first'), ...record('second'), label: 'last' }\nquery rows(c: cursor ?):\n  return logs first 10 after c\nquery fail(n: int):\n  return { x: 1 / n, ...{ x: 2 } }\nquery failPlain(n: int):\n  return { x: 1 / n, x: 2 }\n";
    let compiled = checked(source);
    let mut engine = Engine::memory(compiled.schema, compiled.programs.into_iter().map(|p| p.program)).unwrap();
    let result = engine.mutate("run", None, Context::new("alice", BTreeMap::new()).with_ids(["a".into(), "b".into()])).unwrap();
    let snapback4_core::WriteState::Sent { result, .. } = result.state else { panic!("{result:?}") };
    assert_eq!(snapback4_core::wire::to_json(&result), serde_json::json!({"label":"last", "twice":"second"}));
    let rows = engine.query("rows", Context::new("alice", BTreeMap::new())).unwrap();
    let rows = rows.data.as_array().unwrap();
    assert_eq!(rows.len(), 2, "each helper operand ran once");
    assert_eq!(rows[0].field("label").unwrap(), &Value::String("first".into()));
    assert_eq!(rows[1].field("label").unwrap(), &Value::String("second".into()));
    for name in ["fail", "failPlain"] {
        let error = engine.query(name, Context::new("alice", BTreeMap::from([("n".into(), Value::Int(0))]))).unwrap_err();
        assert_eq!(error.code, "E_DIV_ZERO", "overridden work must still run");
    }
}

#[test]
fn spread_payloads_keep_maintained_columns_and_ids_protected() {
    let source = "table posts:\n  body: text\n  likes: count likes\n  public\n  insert <- allow\n  update <- allow\ntable likes:\n  post: posts\n  public\nmutation bad():\n  fields = { body: 'hello', likes: 2 }\n  return insert posts { ...fields }\n";
    let bad = compile(&[("schema.q".into(), source.into())]);
    assert!(bad.diagnostics.iter().any(|d| d.code == "E_MAINTAINED_COLUMN"), "{:?}", bad.diagnostics);
    for op in ["update", "upsert"] {
        let source = format!("table notes:\n  title: text\n  public\nmutation bad(key: notes):\n  fields = {{ id: key, title: 'hello' }}\n  return {op} notes[key] {{ ...fields }}\n");
        let bad = compile(&[("schema.q".into(), source)]);
        assert!(bad.diagnostics.iter().any(|d| d.message.contains("cannot change id") || d.message.contains("cannot spell id")), "{:?}", bad.diagnostics);
    }
}

#[test]
fn other_generated_index_diagnostics_use_columns_and_source_sites() {
    for source in [
        "table notes:\n  body: text <=100\n  public\njob sweep():\n  for n in notes by .body:\n    delete notes[n.id]\n",
        "table notes:\n  body: text <=100\n  unique body\n  public\nquery wrong():\n  return notes[body = 42]\n",
    ] {
        let bad = compile(&[("schema.q".into(), source.into())]);
        assert!(!bad.diagnostics.is_empty());
        for d in &bad.diagnostics { assert!(!d.to_string().contains("$intent:"), "{d}"); }
        assert!(bad.diagnostics.iter().any(|d| d.message.contains("body") && d.to_string().contains("schema.q:")), "{:?}", bad.diagnostics);
    }
}

#[test]
fn default_text_keeps_hidden_write_reservations_and_meter_costs() {
    let source = "table notes:\n  owner: principal\n  title: text\n  read <- .owner = viewer\n  update <- .owner = viewer\nmutation edit(key: notes, title: text):\n  return update notes[key] { title }\n";
    let execute = |source: &str, key: &str, heap_bytes: u64| {
        let compiled = checked(source);
        let mut engine = Engine::memory(compiled.schema, compiled.programs.into_iter().map(|p| p.program)).unwrap();
        engine.seed([("notes".into(), snapback4_core::value::object([
            ("id", Value::Id("hidden".into())), ("owner", Value::Id("bob".into())), ("title", Value::String("secret".into())),
        ]))]).unwrap();
        engine.set_ceilings(snapback4_core::Ceilings { heap_bytes, ..Default::default() });
        engine.mutate("edit", None, Context::new("alice", BTreeMap::from([
            ("key".into(), Value::Id(key.into())), ("title".into(), Value::String("small".into())),
        ])).at(10)).unwrap()
    };
    for ceiling in [1024, snapback4_core::Ceilings::default().heap_bytes] {
        let mut results = Vec::new();
        for key in ["hidden", "absent"] {
            let a = execute(source, key, ceiling);
            let b = execute(&source.replace(": text", ": text <=10000"), key, ceiling);
            assert_eq!(a.state, b.state);
            assert_eq!(a.metered, b.metered);
            let snapback4_core::WriteState::Failed { why, .. } = &a.state else { panic!("{a:?}") };
            assert_eq!(why.code, if ceiling == 1024 { "E_BOUND" } else { "NOT_FOUND" });
            results.push(a);
        }
        assert_eq!(results[0].state, results[1].state);
        assert_eq!(results[0].metered, results[1].metered);
    }
}

#[test]
fn identical_generated_names_on_two_tables_keep_the_right_source() {
    let source = "table a:\n  body: text <=100\n  public\ntable b:\n  body: text <=100\n  public\njob sweepA():\n  for row in a by .body:\n    delete a[row.id]\njob sweepB():\n  for row in b by .body:\n    delete b[row.id]\n";
    let bad = compile(&[("schema.q".into(), source.into())]);
    let errors = bad.diagnostics.iter().filter(|d| d.code == "E_JOB_CURSOR_INDEX").collect::<Vec<_>>();
    assert_eq!(errors.len(), 2);
    assert!(errors[0].message.contains("on a (body, id) at schema.q:8:"), "{}", errors[0]);
    assert!(errors[1].message.contains("on b (body, id) at schema.q:11:"), "{}", errors[1]);
}

#[test]
fn clique_target_accepts_the_natural_profile_projection() {
    let source = include_str!("fixtures/intent-clique.q")
        .replace("bio: text <=200", "bio: text")
        .replace("location: text <=50", "location: text");
    checked(&format!("{source}\nquery naturalProfile(h: text 3..20 format handle):\n  p = profiles[handle = h] ! else NOT_FOUND\n  return {{ ...p, following: exists follows[viewer, p.principal] }}\n"));
}
