#[path = "../src/scale.rs"]
mod scale;
use scale::{Class, analyze};
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/intent-variants.q");
#[test]
fn certificates_classify_each_presence_choice_and_name_residual_probes() {
    let b = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let certificate = |name| analyze(&b.schema, &b.programs.iter().find(|p| p.program.name == name).unwrap().program);
    let board = certificate("board");
    assert_eq!(board.class, Class::Constant);
    assert_eq!(board.variants.len(), 4, "{board:?}");
    assert!(board.variants.iter().all(|variant| variant.class == Class::Constant && variant.indexes.len() == 1));
    assert!(board.variants.iter().any(|variant| variant.when == "status and assignee are both absent"), "{board:?}");
    assert!(board.line().contains("when status and assignee are both absent: constant"));
    let total = certificate("total");
    assert_eq!(total.variants.len(), 2); assert_eq!(total.class, Class::Grows);
    assert!(total.line().contains("when status is absent: grows with issues"), "{}", total.line());
    for name in ["withLabel", "withNamedLabel"] {
        let c = certificate(name);
        assert_eq!(c.class, Class::Grows);
        assert!(c.line().contains("issues skipped by `exists issueLabels[.id, label]`"), "{}", c.line());
    }
    let search = certificate("people");
    assert_eq!(search.variants.len(), 2); assert_eq!(search.class, Class::Grows);
    assert!(search.variants.iter().any(|v| v.when == "search q is absent" && v.class == Class::Constant));
    assert!(search.line().contains("when search q is present: grows with matching words"), "{}", search.line());
    let local = certificate("local");
    assert!(local.line().contains("when selected is absent: constant"), "{}", local.line());
}

#[test]
fn one_growing_presence_variant_prevents_a_constant_certificate() {
    let source = "table t:\n  assignee: principal\n  status: enum('todo', 'done')\n  at: time\n  read <- .assignee = viewer\nquery q(status: enum('todo', 'done') ?, assignee: principal ?, c: cursor ?):\n  return t where (status = null or .status = status) and (assignee = null or .assignee = assignee) first 2 by .at after c\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let c = analyze(&b.schema, &b.programs[0].program);
    assert_eq!(c.class, Class::Grows);
    assert_eq!(c.variants.len(), 4);
    assert_eq!(c.variants.iter().filter(|v| v.class == Class::Constant).count(), 2);
    assert!(c.line().contains("when status and assignee are both absent: grows with t skipped by its per-row read rule"), "{}", c.line());
}

#[test]
fn a_variant_whose_only_extra_work_is_cleanup_says_so_inside_a_growing_certificate() {
    // The same fixture on an expiring table: where the assignee is pinned, only unswept
    // expired rows add work; where it is absent, the per-row rule still grows.
    let source = "table t:\n  assignee: principal\n  status: enum('todo', 'done')\n  at: time\n  until: time\n  expire at .until\n  read <- .assignee = viewer\nquery q(status: enum('todo', 'done') ?, assignee: principal ?, c: cursor ?):\n  return t where (status = null or .status = status) and (assignee = null or .assignee = assignee) first 2 by .at after c\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let c = analyze(&b.schema, &b.programs[0].program);
    assert_eq!(c.class, Class::Grows);
    let cleanup: Vec<_> = c.variants.iter().filter(|v| v.class == Class::Backlog).collect();
    assert_eq!(cleanup.len(), 2, "{:?}", c.variants);
    assert_eq!(c.variants.iter().filter(|v| v.class == Class::Grows).count(), 2, "{:?}", c.variants);
    let line = c.line();
    let json = serde_json::to_value(&c).unwrap();
    for variant in cleanup {
        assert!(line.contains(&format!("when {}: constant once background cleanup catches up (expired t rows not yet swept", variant.when)), "{line}");
        assert!(!line.contains(&format!("when {}: grows with", variant.when)), "{line}");
        assert!(json["growth_sites"].as_array().unwrap().iter().any(|g| g["when"] == variant.when.as_str() && g["backlog"] == true), "{json}");
    }
    assert!(line.contains("when status and assignee are both absent: grows with t skipped by its per-row read rule"), "{line}");
    assert!(line.contains("when status and assignee are both absent: also, until background cleanup catches up, expired t rows"), "{line}");
}
