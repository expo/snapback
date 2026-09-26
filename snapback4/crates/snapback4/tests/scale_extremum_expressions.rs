#[path = "../src/scale.rs"]
mod scale;
use scale::{Class, analyze};

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
