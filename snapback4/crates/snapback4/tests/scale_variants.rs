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
    // Unconditional growth runs in every variant: none of them is only a cleanup backlog then.
    let grown = source.replace("  return t where", "  extra = t first 2 by .at after c\n  return t where");
    let b = snapback4_lang::compile(&[("schema.q".into(), grown.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let c = analyze(&b.schema, &b.programs[0].program);
    assert!(c.variants.len() == 4 && c.variants.iter().all(|v| v.class == Class::Grows), "{:?}", c.variants);
    assert!(!c.line().contains("constant once background cleanup catches up") && !c.line().contains(": constant"), "{}", c.line());
    // So does growth under a condition the variant shares: status present or absent covers every variant.
    let shared = source.replace("  return t where", "  extra = t where (status = null or .status = status) first 2 by .at after c\n  return t where");
    let b = snapback4_lang::compile(&[("schema.q".into(), shared.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let c = analyze(&b.schema, &b.programs[0].program);
    assert!(c.variants.iter().filter(|v| v.when.contains("assignee")).all(|v| v.class == Class::Grows), "{:?}", c.variants);
    assert!(!c.line().contains("constant once background cleanup catches up"), "{}", c.line());
}

#[test]
fn a_coarser_variant_takes_the_growth_of_every_site_that_can_run_with_it() {
    // `byAssignee` varies only with the assignee; `both`, which grows by its residual filter,
    // varies with status too. When the assignee is present, `both` runs whatever the status.
    let source = "table t:\n  assignee: principal\n  status: enum('todo', 'done')\n  note: text <=20\n  at: time\n  public\n  online only\nquery q(status: enum('todo', 'done') ?, assignee: principal ?, c: cursor ?):\n  byAssignee = t where (assignee = null or .assignee = assignee) first 2 by .at after c\n  both = t where (status = null or .status = status) and (assignee = null or .assignee = assignee) and .note != 'x' first 2 by .at after c\n  return byAssignee\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let c = analyze(&b.schema, &b.programs[0].program);
    let coarse: Vec<_> = c.variants.iter().filter(|v| v.when == "assignee is present").collect();
    assert_eq!(coarse.len(), 1, "{:?}", c.variants);
    assert_eq!(coarse[0].class, Class::Grows, "{:?}", c.variants);
    assert!(!c.line().contains("when assignee is present: constant"), "{}", c.line());
    // Growth under an unrelated input runs beside every variant too (Grok, scale round 2).
    let orthogonal = "table notes:\n  owner: principal\n  tag: text <=40\n  read <- .owner = viewer\ntable t:\n  assignee: principal\n  status: enum('todo', 'done')\n  at: time\n  until: time\n  expire at .until\n  read <- .assignee = viewer\nquery ortho(status: enum('todo', 'done') ?, assignee: principal ?, label: text <=40 ?, c: cursor ?):\n  extra = notes where (label = null or .tag = label) first 2 by .id after c\n  return t where (status = null or .status = status) and (assignee = null or .assignee = assignee) first 2 by .at after c\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), orthogonal.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let c = analyze(&b.schema, &b.programs[0].program);
    assert!(c.variants.iter().all(|v| v.class == Class::Grows), "{:?}", c.variants);
    assert!(!c.line().contains("constant once background cleanup catches up"), "{}", c.line());
}

#[test]
fn unconditional_cleanup_makes_otherwise_constant_variants_a_backlog() {
    // A public expiring scan runs in every call; beside it, the optional-assignee scan is
    // constant where the assignee is pinned, and grows by its read rule where it is not.
    let source = "table e:\n  at: time\n  until: time\n  expire at .until\n  public\n  online only\ntable t:\n  assignee: principal\n  status: enum('todo', 'done')\n  at: time\n  read <- .assignee = viewer\nquery q(status: enum('todo', 'done') ?, assignee: principal ?, c: cursor ?):\n  early = e first 2 by .at\n  return t where (status = null or .status = status) and (assignee = null or .assignee = assignee) first 2 by .at after c\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let c = analyze(&b.schema, &b.programs[0].program);
    assert_eq!(c.class, Class::Grows);
    let json = serde_json::to_value(&c).unwrap();
    assert!(c.variants.iter().all(|v| v.class != Class::Constant), "{:?}", c.variants);
    assert_eq!(c.variants.iter().filter(|v| v.class == Class::Backlog).count(), 2, "{:?}", c.variants);
    assert!(json["variants"].as_array().unwrap().iter().filter(|v| v["class"] == "backlog").count() == 2, "{json}");
    assert!(!c.line().contains(": constant"), "{}", c.line());
}
