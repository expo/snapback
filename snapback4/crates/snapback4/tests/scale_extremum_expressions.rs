#[path = "../src/scale.rs"]
mod scale;
use scale::{Class, analyze};
use snapback4_core::{Context, Engine, Value, value::object};
use std::collections::BTreeMap;

#[test]
fn capped_expression_is_a_scan_and_uncapped_expression_grows() {
    let source = include_str!("../../snapback4-lang/tests/extremum_expressions/schema.q");
    for (cap, expected) in [(true, Class::Constant), (false, Class::Grows)] {
        let source = if cap { source.to_owned() } else { source.replace("  cap 50 by conversation\n", "") };
        // The explicit loop intentionally needs a cap; only test the aggregates.
        let source = source.split("query loop(").next().unwrap();
        let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        for p in &b.programs {
            let c = analyze(&b.schema, &p.program);
            assert_eq!(c.class, expected, "{}: {c:?}", p.program.name);
            assert!(c.aggregates.iter().any(|a| a.contains("metered scan") && !a.contains("ordered-index")), "{c:?}");
            if cap { assert!(c.bounds.rows_examined <= 102, "{c:?}"); }
        }
    }
}

#[test]
fn per_row_expression_reads_are_multiplied_by_the_cap() {
    let source = "table t:\n  target: id\n  cap 3\n  public\n  sync public\ntable details:\n  n: int\n  public\n  online only\nquery q():\n  return min(t, details[.target].n ?? 0)\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let c = analyze(&b.schema, &b.programs[0].program);
    assert_eq!(c.class, Class::Constant);
    assert_eq!(c.bounds.rows_examined, 7, "four scan candidates plus three point reads: {c:?}");
}

#[test]
fn physical_caps_bound_hidden_candidates_and_keep_rule_probes() {
    for probed in [false, true] {
        let rule = if probed { ".owner = viewer and exists details[.target]" } else { ".owner = viewer" };
        let source = format!("table t:\n  owner: principal\n  target: id\n  n: int\n  cap 3\n  read <- {rule}\n  online only\ntable details:\n  n: int\n  public\n  online only\nquery q():\n  return min(t where .n != 0, .n + 1)\n");
        let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        let c = analyze(&b.schema, &b.programs[0].program);
        assert_eq!(c.class, Class::Constant, "{c:?}");
        assert_eq!(c.bounds.rows_examined, 4, "{c:?}");
        assert_eq!(c.bounds.probes, if probed { 8 } else { 0 }, "{c:?}");
    }
}

#[test]
fn enclosing_iterations_multiply_projection_reads() {
    let source = "table t:\n  target: id\n  cap 3\n  public\n  sync public\ntable details:\n  n: int\n  public\n  online only\nquery q():\n  result = 0\n  for i in range(0, 4):\n    result = min(t, details[.target].n ?? 0) ?? 0\n  return result\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let c = analyze(&b.schema, &b.programs[0].program);
    assert_eq!(c.class, Class::Constant);
    assert_eq!(c.bounds.rows_examined, 28, "four iterations of (four candidates + three projections): {c:?}");
}

fn non_domain_fixture_certificates() -> std::collections::BTreeMap<String, scale::Certificate> {
    let source = include_str!("../../snapback4-lang/tests/extremum_expressions/schema.q")
        .replace("max(rows, .n + ordinal if .n != null else null)", "max(rows, details['r'].n ?? 0)")
        .replace("min(rows, .n + 1 if .n != null else null)", "min(rows, details['r'].n ?? 0)")
        .replace("max(rows, .n ?? 0)", "max(rows, details['r'].n ?? 0)");
    let source = format!("table details:\n  n: int\n  public\n  online only\n{source}\nquery argument(values: [int] <=4):\n  copy = values\n  return max(copy, details['r'].n ?? 0)\nquery direct():\n  return min([1, 2], details['r'].n ?? 0)\nquery directPage(conversation: id):\n  return min((members where .conversation = conversation first 2 by .id), details['r'].n ?? 0)\n");
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b.programs.iter().map(|p| (p.program.name.clone(), analyze(&b.schema, &p.program))).collect()
}

#[test]
fn page_fixtures_price_every_projection_at_the_source_bound() {
    let certificates = non_domain_fixture_certificates();
    for name in ["page", "directPage"] {
        let c = &certificates[name];
        assert_eq!(c.class, Class::Constant, "{name}: {c:?}");
        assert_eq!(c.bounds.rows_examined, 5, "{name}: {c:?}");
    }
}

#[test]
fn list_fixtures_price_every_projection_at_the_source_bound() {
    let certificates = non_domain_fixture_certificates();
    for (name, rows) in [("list", 8), ("argument", 4), ("direct", 2)] {
        let c = &certificates[name];
        assert_eq!(c.class, Class::Constant, "{name}: {c:?}");
        assert_eq!(c.bounds.rows_examined, rows, "{name}: {c:?}");
        if name == "argument" { assert_eq!(c.bounds.arguments["values"], 4); }
    }
}

const COLLECTION_TABLES: &str = "table t:\n  n: int\n  target: id\n  public\n  sync public\ntable secrets:\n  n: int\n  public\n  online only\n";

fn check_collections(queries: &str, expected: &[(&str, u64)]) {
    let b = snapback4_lang::compile(&[("schema.q".into(), format!("{COLLECTION_TABLES}{queries}"))]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut engine = Engine::memory(b.schema.clone(), b.programs.iter().map(|p| p.program.clone())).unwrap();
    engine.seed(["a", "b", "c"].map(|id| ("t".into(), object([
        ("id", Value::Id(id.into())), ("n", Value::Int(1)), ("target", Value::Id("g".into())),
    ]))).into_iter().chain([("secrets".into(), object([("id", Value::Id("g".into())), ("n", Value::Int(9))]))])).unwrap();
    for &(name, examinations) in expected {
        let program = &b.programs.iter().find(|p| p.program.name == name).unwrap().program;
        let certificate = analyze(&b.schema, program);
        assert_eq!(certificate.class, Class::Constant, "{name}: {certificate:?}");
        assert_eq!(certificate.bounds.rows_examined, examinations, "{name}: {certificate:?}");
        let args = program.args.keys().map(|name| (name.clone(), if name == "n" { Value::Int(3) }
            else { Value::Array(vec![Value::Int(1); 4]) })).collect::<BTreeMap<_, _>>();
        let result = engine.query(name, Context::new("alice", args)).unwrap();
        assert_eq!(result.data, Value::Int(9), "{name}: {result:?}");
        assert!(result.metered.examined <= examinations, "{name}: {result:?} exceeds {certificate:?}");
        if examinations < 1_000_000 { assert_eq!(result.metered.examined, examinations, "{name}: {result:?}"); }
    }
}

#[test]
fn shaped_page_prices_the_same_five_examinations_as_its_unshaped_twin() {
    check_collections("query shaped():\n  rows = t where .target = 'g' first 2 by .id { n, target }\n  return min(rows, secrets[.target].n ?? 0)\nquery unshaped():\n  rows = t where .target = 'g' first 2 by .id\n  return min(rows, secrets[.target].n ?? 0)\n", &[("shaped", 5), ("unshaped", 5)]);
}

#[test]
fn bounded_pushes_multiply_nested_iterations_and_count_each_push() {
    check_collections(r#"query ranges():
  rows = []
  for i in range(0, 2):
    for j in range(0, 3):
      rows = rows + [i]
      rows = rows + [j]
  copy = rows
  return max(copy, secrets['g'].n ?? 0)
query argument(values: [int] <=4):
  rows = []
  for value in values:
    rows = rows + [value]
    rows = rows + [value]
  return min(rows, secrets['g'].n ?? 0)
query derived():
  input = [{ n: 1 }, { n: 2 }]
  rows = input { n }
  return max(rows, secrets['g'].n ?? 0)
query sequential():
  rows = []
  for i in range(0, 2):
    rows = rows + [i]
  for i in range(0, 3):
    rows = rows + [i]
  return min(rows, secrets['g'].n ?? 0)
query reset():
  result = 0
  for i in range(0, 2):
    rows = []
    for j in range(0, 3):
      rows = rows + [j]
    result = min(rows, secrets['g'].n ?? 0) ?? 0
  return result
"#, &[("ranges", 12), ("argument", 8), ("derived", 2), ("sequential", 5), ("reset", 6)]);
}

#[test]
fn reassigned_and_open_pushed_lists_keep_the_step_ceiling_even_through_aliases() {
    let steps = snapback4_core::Ceilings::default().steps;
    check_collections(r#"query reassigned():
  rows = []
  rows = [1, 2]
  copy = rows
  return max(copy, secrets['g'].n ?? 0)
query appended():
  rows = [1]
  rows = rows + [2]
  copy = rows
  return min(copy, secrets['g'].n ?? 0)
query openRange(n: int):
  rows = []
  for i in range(0, n):
    rows = rows + [i]
  copy = rows
  return min(copy, secrets['g'].n ?? 0)
"#, &[("reassigned", steps), ("appended", 2), ("openRange", steps)]);
}

#[test]
fn loops_and_shapes_over_append_built_lists_use_recovered_push_bounds() {
    check_collections(r#"query copied():
  rows = []
  for i in range(0, 2):
    rows = rows + [i]
  copy = []
  for n in rows:
    copy = copy + [n]
  return max(copy, secrets['g'].n ?? 0)
query shaped():
  rows = []
  for i in range(0, 2):
    rows = rows + [i]
  shaped = rows { n: . }
  return max(shaped, secrets['g'].n ?? 0)
query nested():
  rows = []
  for i in range(0, 2):
    rows = rows + [i]
  alias = rows
  copy = []
  for n in alias:
    for m in rows:
      copy = copy + [n]
  shaped = copy { n: . }
  return min(shaped, secrets['g'].n ?? 0)
query loopReads():
  rows = []
  for i in range(0, 2):
    rows = rows + [i]
  result = 0
  for n in rows:
    result = secrets['g'].n ?? 0
  return result
"#, &[("copied", 2), ("shaped", 2), ("nested", 4), ("loopReads", 2)]);
}

#[test]
fn derived_heap_sentinels_without_recovered_lengths_keep_the_step_ceiling() {
    let steps = snapback4_core::Ceilings::default().steps;
    check_collections(r#"query copied(n: int):
  rows = []
  for i in range(0, n):
    rows = rows + [i]
  copy = []
  for value in rows:
    copy = copy + [value]
  return max(copy, secrets['g'].n ?? 0)
query shaped():
  rows = [1]
  rows = rows + [2]
  shaped = rows { n: . }
  return min(shaped, secrets['g'].n ?? 0)
query selfAppend():
  rows = []
  for i in range(0, 2):
    rows = rows + [i]
  for n in rows:
    rows = rows + [n]
  return max(rows, secrets['g'].n ?? 0)
query loopReads(n: int):
  rows = []
  for i in range(0, n):
    rows = rows + [i]
  result = 0
  for value in rows:
    result = secrets['g'].n ?? 0
  return result
"#, &[("copied", steps), ("shaped", 2), ("selfAppend", steps), ("loopReads", steps)]);
}

#[test]
fn declared_argument_maximum_is_a_contract_even_at_u32_max() {
    check_collections("query argument(values: [int] <=4294967295):\n  rows = []\n  for n in values:\n    rows = rows + [n]\n  return max(rows, secrets['g'].n ?? 0)\n", &[("argument", u64::from(u32::MAX))]);
}

#[test]
fn prepend_and_bulk_append_certificates_cover_the_actual_examinations() {
    check_collections(r#"query prepended():
  rows = [0]
  for i in range(0, 5):
    rows = [i] + rows
  return max(rows, secrets['g'].n ?? 0)
query bulk():
  rows = []
  for i in range(0, 2):
    for j in range(0, 3):
      rows = rows + [i, j]
  return min(rows, secrets['g'].n ?? 0)
"#, &[("prepended", 6), ("bulk", 12)]);
}
