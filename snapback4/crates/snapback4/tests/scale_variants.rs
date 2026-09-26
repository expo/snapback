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
    // `selected` copies `status`, so its condition reads as the argument a caller passes.
    assert!(local.line().contains("when status is absent: constant"), "{}", local.line());
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

const EXPIRING: &str = "table t:\n  assignee: principal\n  at: time\n  until: time\n  expire at .until\n  read <- .assignee = viewer\n";

fn certificate(source: &str) -> scale::Certificate {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let program = &b.programs.iter().find(|p| p.program.name == "q").unwrap().program;
    analyze(&b.schema, program)
}

#[test]
fn a_helper_parameter_is_its_own_condition_whatever_its_name() {
    // The helper's `assignee` is the query's `a`, not the query's `assignee`: with `a` absent and
    // `assignee` present, the helper's scan grows by its read rule.
    let source = format!("{EXPIRING}fn page(assignee: principal ?):\n  return t where (assignee = null or .assignee = assignee) first 2 by .at\nquery q(a: principal ?, assignee: principal ?):\n  extra = page(a)\n  return t where (assignee = null or .assignee = assignee) first 2 by .at\n");
    let c = certificate(&source);
    assert!(c.variants.iter().filter(|v| v.when.contains("present")).all(|v| v.class == Class::Grows), "{:?}", c.variants);
    assert!(!c.line().contains("constant once background cleanup catches up"), "{}", c.line());
    let json = serde_json::to_value(&c).unwrap();
    assert!(json["variants"].as_array().unwrap().iter().all(|v| v["class"] == "grows"), "{json}");
    // The same helper called in a loop over the argument and null.
    let looped = format!("{EXPIRING}fn page(assignee: principal ?):\n  return t where (assignee = null or .assignee = assignee) first 2 by .at\nquery q(assignee: principal ?):\n  for who in [assignee, null]:\n    extra = page(who)\n  return t where (assignee = null or .assignee = assignee) first 2 by .at\n");
    let c = certificate(&looped);
    assert!(c.variants.iter().all(|v| v.class == Class::Grows), "{:?}", c.variants);
    // The helper's parameter reads as the argument it copies.
    let c = certificate(&source);
    assert!(c.variants.iter().any(|v| v.when == "a is present") && c.variants.iter().any(|v| v.when == "assignee is present"), "{:?}", c.variants);
    // Bound to an expression, the parameter is no argument: both its branches can run in any
    // call, so the argument's own variants take the growth of the unpinned one.
    let valued = format!("{EXPIRING}fn page(assignee: principal ?):\n  return t where (assignee = null or .assignee = assignee) first 2 by .at\nquery q(a: principal ?, assignee: principal ?):\n  extra = page(a ?? assignee)\n  return t where (assignee = null or .assignee = assignee) first 2 by .at\n");
    let c = certificate(&valued);
    assert_eq!(c.variants.iter().filter(|v| v.when == "assignee is present").count(), 1, "{:?}", c.variants);
    assert!(c.variants.iter().all(|v| v.class == Class::Grows), "{:?}", c.variants);
}

#[test]
fn only_an_arguments_presence_defines_a_variant() {
    // A loop variable takes both values in one call: the absent iteration grows whatever the argument.
    let looped = format!("{EXPIRING}fn page(assignee: principal ?):\n  return t where (assignee = null or .assignee = assignee) first 2 by .at\nquery q(assignee: principal ?):\n  for who in [assignee, null]:\n    extra = page(who)\n  return null\n");
    let c = certificate(&looped);
    assert_eq!(c.class, Class::Grows);
    assert!(c.variants.iter().all(|v| v.class == Class::Grows), "{:?}", c.variants);
    assert!(!c.line().contains("constant once background cleanup catches up"), "{}", c.line());
    // A copy reassigned inside a loop is not its source after the loop: a test of it runs
    // either way, so the argument's pinned variant takes the unpinned branch's growth.
    let cleared = format!("{EXPIRING}query q(assignee: principal ?):\n  selected = assignee\n  for k in [1, 2]:\n    selected = null\n  extra = t where (assignee = null or .assignee = assignee) first 2 by .at\n  if selected != null:\n    return t where .assignee = selected first 2 by .at\n  else:\n    return t first 2 by .at\n");
    let c = certificate(&cleared);
    let present: Vec<_> = c.variants.iter().filter(|v| v.when == "assignee is present").collect();
    assert!(!present.is_empty() && present.iter().all(|v| v.class == Class::Grows), "{:?}", c.variants);
    // An enclosing test of the same argument decides a copy's test: one fact, and the other
    // branch never runs.
    let nested = format!("{EXPIRING}query q(assignee: principal ?):\n  selected = assignee\n  if assignee != null:\n    return t where (selected = null or .assignee = selected) first 2 by .at\n  return []\n");
    let c = certificate(&nested);
    assert!(c.variants.iter().all(|v| !v.when.contains(" and ")), "{:?}", c.variants);
    assert!(c.variants.iter().filter(|v| v.when == "assignee is present").all(|v| v.class == Class::Backlog), "{:?}", c.variants);
    // Searching one argument twice is one condition.
    let searched = "table notes:\n  title: text <=100\n  search title\n  public\n  online only\nquery q(needle: text <=100):\n  extra = notes matching needle first 2 by .id\n  return notes matching needle first 2 by .id\n";
    let c = certificate(searched);
    assert_eq!(c.variants.len(), 2, "{:?}", c.variants);
    assert!(c.line().contains("when search needle is absent: constant"), "{}", c.line());
}

#[test]
fn a_reassigned_copy_is_not_an_alias() {
    // `selected` starts as `assignee` but is cleared when the assignee is present, so with the
    // assignee present the scan over `selected` is unpinned and grows.
    let source = format!("{EXPIRING}query q(assignee: principal ?):\n  selected = assignee\n  if assignee != null:\n    selected = null\n  extra = t where (selected = null or .assignee = selected) first 2 by .at\n  return t where (assignee = null or .assignee = assignee) first 2 by .at\n");
    let c = certificate(&source);
    let present: Vec<_> = c.variants.iter().filter(|v| v.when == "assignee is present").collect();
    assert!(!present.is_empty() && present.iter().all(|v| v.class == Class::Grows), "{:?}", c.variants);
}

#[test]
fn an_alias_tests_the_same_presence_as_its_source() {
    // `selected` is `assignee`: with `assignee` present, `selected` cannot be absent, so both
    // pinned scans are a cleanup backlog, not growth.
    let source = format!("{EXPIRING}query q(assignee: principal ?):\n  selected = assignee\n  extra = t where (selected = null or .assignee = selected) first 2 by .at\n  return t where (assignee = null or .assignee = assignee) first 2 by .at\n");
    let c = certificate(&source);
    let present: Vec<_> = c.variants.iter().filter(|v| v.when.contains("present")).collect();
    assert!(!present.is_empty() && present.iter().all(|v| v.class == Class::Backlog), "{:?}", c.variants);
}

#[test]
fn conditional_cleanup_beside_constant_variants_makes_them_a_backlog() {
    // Both branches of the optional-label scan skip unswept expired rows; beside it the public,
    // non-expiring optional-assignee scan is constant either way.
    let source = "table e:\n  tag: text <=20\n  at: time\n  until: time\n  expire at .until\n  public\n  online only\ntable p:\n  assignee: principal\n  at: time\n  public\n  online only\nquery q(label: text <=20 ?, assignee: principal ?):\n  early = e where (label = null or .tag = label) first 2 by .at\n  return p where (assignee = null or .assignee = assignee) first 2 by .at\n";
    let c = certificate(source);
    assert_eq!(c.class, Class::Backlog, "{}", c.line());
    assert!(c.variants.iter().all(|v| v.class == Class::Backlog), "{:?}", c.variants);
    let json = serde_json::to_value(&c).unwrap();
    assert!(json["variants"].as_array().unwrap().iter().all(|v| v["class"] == "backlog"), "{json}");
    assert!(!c.line().contains("assignee is present: constant") && !c.line().contains("assignee is absent: constant"), "{}", c.line());
}
