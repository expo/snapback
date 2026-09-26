#[path = "../src/scale.rs"]
mod scale;
use scale::{Class, analyze};

#[test]
fn capped_expression_is_a_scan_and_uncapped_expression_grows() {
    let source = include_str!("../../snapback4-lang/tests/fixtures/extremum-expressions.q");
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
