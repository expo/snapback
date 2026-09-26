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
    assert!(board.variants.iter().any(|variant| variant.when == "assignee and status are both absent"), "{board:?}");
    assert!(board.line().contains("when assignee and status are both absent: constant"));
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
    assert!(c.line().contains("when assignee and status are both absent: grows with t skipped by its per-row read rule"), "{}", c.line());
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
    assert!(line.contains("when assignee and status are both absent: grows with t skipped by its per-row read rule"), "{line}");
    assert!(line.contains("when assignee and status are both absent: also, until background cleanup catches up, expired t rows"), "{line}");
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
    assert_eq!(c.variants.len(), 1, "{:?}", c.variants);
    assert_eq!((c.class, c.variants[0].when.as_str(), c.variants[0].class), (Class::Backlog, "assignee is present", Class::Backlog), "{}", c.line());
    assert!(c.growth_sites.len() == 1 && c.growth_sites[0].backlog, "only the reachable pinned scan's cleanup: {:?}", c.growth_sites);
    // The mirror: tested inside `assignee = null`, the copy is absent too, so the unpinned scan runs and grows.
    let mirrored = format!("{EXPIRING}query q(assignee: principal ?):\n  selected = assignee\n  if assignee = null:\n    return t where (selected = null or .assignee = selected) first 2 by .at\n  return []\n");
    let c = certificate(&mirrored);
    assert_eq!(c.variants.len(), 1, "{:?}", c.variants);
    assert_eq!((c.class, c.variants[0].when.as_str(), c.variants[0].class), (Class::Grows, "assignee is absent", Class::Grows), "{}", c.line());
    // Searching one argument twice is one condition.
    let searched = "table notes:\n  title: text <=100\n  search title\n  public\n  online only\nquery q(needle: text <=100):\n  extra = notes matching needle first 2 by .id\n  return notes matching needle first 2 by .id\n";
    let c = certificate(searched);
    assert_eq!(c.variants.len(), 2, "{:?}", c.variants);
    assert!(c.line().contains("when search needle is absent: constant"), "{}", c.line());
}

#[test]
fn what_follows_a_branch_that_leaves_runs_only_in_the_other_case() {
    // Grok, scale round 5: the second `return` runs only when the assignee is absent, as if
    // it were written under `else:`.
    let unpinned = "    return t first 2 by .at\n";
    let pinned = "    return t where (assignee = null or .assignee = assignee) first 2 by .at\n";
    let after = format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee != null:\n{pinned}  return t first 2 by .at\n");
    let within = format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee != null:\n{pinned}  else:\n{unpinned}");
    let (after, within) = (certificate(&after), certificate(&within));
    let classes = |c: &scale::Certificate| c.variants.iter().map(|v| (v.when.clone(), v.class)).collect::<Vec<_>>();
    assert_eq!(classes(&after), vec![("assignee is present".to_owned(), Class::Backlog), ("assignee is absent".to_owned(), Class::Grows)], "{}", after.line());
    assert_eq!(classes(&after), classes(&within));
    // The same work either way, not only the same classes (Astra, scale round 6).
    let work = |c: &scale::Certificate| (c.bounds.rows_examined, c.bounds.probes, c.bounds.lanes);
    assert_eq!(work(&after), work(&within));
    assert!(after.line().contains("when assignee is present: constant once background cleanup catches up"), "{}", after.line());
    let json = serde_json::to_value(&after).unwrap();
    assert!(json["growth_sites"].as_array().unwrap().iter().all(|g| g["when"].is_string()), "no site runs in every call: {json}");
    // The mirror: after `if assignee = null: return …`, what follows has the assignee.
    let mirrored = format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee = null:\n{unpinned}  return t where (assignee = null or .assignee = assignee) first 2 by .at\n");
    assert_eq!(classes(&certificate(&mirrored)), vec![("assignee is absent".to_owned(), Class::Grows), ("assignee is present".to_owned(), Class::Backlog)]);
    // A branch leaves through a nested test its own condition decides (Astra, scale round 6).
    let redundant = format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee != null:\n    if assignee != null:\n  {pinned}  return t first 2 by .at\n");
    assert_eq!(classes(&certificate(&redundant)), classes(&within));
    // A copy made inside the branch reads through as one made before it (Astra, scale round 7).
    let inside = format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee != null:\n    selected = assignee\n    if selected != null:\n  {pinned}  return t first 2 by .at\n");
    let before = format!("{EXPIRING}query q(assignee: principal ?):\n  selected = assignee\n  if assignee != null:\n    if selected != null:\n  {pinned}  return t first 2 by .at\n");
    assert_eq!(classes(&certificate(&inside)), classes(&within));
    assert_eq!(classes(&certificate(&before)), classes(&within));
    // Inside a decided test, what follows a branch that leaves never runs.
    let decided = format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee != null:\n    if assignee != null:\n  {pinned}    return t first 2 by .at\n  return []\n");
    let c = certificate(&decided);
    assert_eq!(classes(&c), vec![("assignee is present".to_owned(), Class::Backlog)], "{}", c.line());
}

#[test]
fn every_way_out_of_a_body_conditions_what_follows() {
    let pinned = "return t where (assignee = null or .assignee = assignee) first 2 by .at";
    // Both branches return: what follows never runs, whether the test is of an argument or not.
    let both = format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee != null:\n    {pinned}\n  else:\n    return []\n  return t first 3 by .at\n");
    let c = certificate(&both);
    assert_eq!((c.class, c.growth_sites.len()), (Class::Backlog, 1), "{}", c.line());
    let computed = format!("{EXPIRING}query q():\n  x = 1\n  if x = 1:\n    return []\n  else:\n    return []\n  return t first 3 by .at\n");
    assert_eq!(certificate(&computed).class, Class::Constant);
    // `continue` leaves a loop's body: what follows it there runs only in the other case.
    let skipped = format!("{EXPIRING}query q(assignee: principal ?):\n  for k in [1, 2]:\n    if assignee = null:\n      continue\n    extra = t first 2 by .at\n  {pinned}\n");
    let c = certificate(&skipped);
    assert!(c.growth_sites.iter().all(|g| g.when.is_some()), "no site runs in every call: {:?}", c.growth_sites);
    assert!(c.growth_sites.iter().any(|g| g.when.as_deref() == Some("assignee is present") && !g.backlog), "{:?}", c.growth_sites);
    // A test whose branches both return leaves too.
    let nested = format!("{EXPIRING}query q(assignee: principal ?, status: enum('todo', 'done') ?):\n  if assignee != null:\n    if status != null:\n      {pinned}\n    else:\n      return []\n  return t first 2 by .at\n");
    let c = certificate(&nested);
    assert!(c.growth_sites.iter().all(|g| g.when.is_some()), "no site runs in every call: {:?}", c.growth_sites);
    assert!(c.growth_sites.iter().any(|g| g.when.as_deref() == Some("assignee is absent") && !g.backlog), "{:?}", c.growth_sites);
}

#[test]
fn a_refusal_or_a_return_ends_what_it_leaves() {
    let pinned = "return t where (assignee = null or .assignee = assignee) first 2 by .at";
    // A refusal no call can pass leaves as a return does (Grok, scale round 6).
    for refusal in ["require false else STOP", "require 1 = 0 else STOP", "require 1 != 1 else STOP"] {
        let source = format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee != null:\n    {pinned}\n  else:\n    {refusal}\n  return t first 3 by .at\n");
        let c = certificate(&source);
        assert_eq!(c.class, Class::Backlog, "{refusal}: {}", c.line());
    }
    // A refusal a call can pass does not, a comparison of literals that holds included.
    for passing in ["require assignee != null else STOP", "require 1 = 1 else STOP", "require 1 != 0 else STOP"] {
        let source = format!("{EXPIRING}query q(assignee: principal ?):\n  {passing}\n  return t first 3 by .at\n");
        assert_eq!(certificate(&source).class, Class::Grows, "{passing}");
    }
    // What follows a return in the same body never runs.
    let dead = format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee != null:\n    {pinned}\n  return []\n  return t first 4 by .at\n");
    let c = certificate(&dead);
    assert_eq!(c.class, Class::Backlog, "{}", c.line());
    // Inside one body too: nothing after a certain refusal, `continue` or `break` runs.
    for exit in ["require false else STOP", "continue", "break"] {
        let source = format!("{EXPIRING}query q():\n  for k in [1, 2]:\n    {exit}\n    extra = t first 2 by .at\n  return []\n");
        let c = certificate(&source);
        assert_eq!(c.class, Class::Constant, "{exit}: {}", c.line());
    }
    // A loop whose body returns can run no times, so it does not leave.
    let looped = format!("{EXPIRING}query q(assignee: principal ?, xs: [int] <=4):\n  if assignee != null:\n    for k in xs:\n      {pinned}\n  return t first 2 by .at\n");
    let c = certificate(&looped);
    assert!(c.variants.iter().any(|v| v.when == "assignee is present") && c.variants.iter().filter(|v| v.when == "assignee is present").all(|v| v.class == Class::Grows), "{:?}", c.variants);
}

#[test]
fn one_presence_state_has_one_spelling() {
    // Grok, scale round 5: the same two conditions tested in opposite orders are one state.
    let source = "table t:\n  assignee: principal\n  status: enum('todo', 'done')\n  at: time\n  until: time\n  expire at .until\n  read <- .assignee = viewer\nquery q(status: enum('todo', 'done') ?, assignee: principal ?, c: cursor ?):\n  a = t where (status = null or .status = status) and (assignee = null or .assignee = assignee) first 2 by .at after c\n  return t where (assignee = null or .assignee = assignee) and (status = null or .status = status) first 2 by .at after c\n";
    let c = certificate(source);
    let states: std::collections::BTreeSet<_> = c.variants.iter().map(|v| v.when.clone()).collect();
    assert_eq!(states.len(), c.variants.len(), "{:?}", c.variants);
    assert!(c.growth_sites.iter().all(|g| g.when.as_ref().is_none_or(|when| states.contains(when))), "every site's condition is a variant: {:?} {:?}", c.growth_sites, states);
    assert!(c.line().contains("when assignee and status are both present: constant once background cleanup catches up"), "{}", c.line());
}

#[test]
fn a_value_computed_from_an_argument_is_not_the_argument() {
    // Grok, scale round 5: `needle ?? 'x'` searches 'x' when the needle is absent, so the search
    // runs in every call; its binding is reassigned only inside an expression block.
    let source = "table notes:\n  title: text <=100\n  search title\n  public\n  online only\nquery q(needle: text <=100 ?):\n  return notes matching (needle ?? 'x') first 2 by .id\n";
    let c = certificate(source);
    assert_eq!(c.class, Class::Grows, "{}", c.line());
    assert!(c.variants.iter().all(|v| v.class == Class::Grows), "{:?}", c.variants);
    assert!(!c.line().contains("search needle is absent: constant"), "{}", c.line());
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

const STATUSED: &str = "table t:\n  assignee: principal\n  status: enum('todo', 'done')\n  at: time\n  until: time\n  expire at .until\n  read <- .assignee = viewer\n";
const PINNED: &str = "return t where (assignee = null or .assignee = assignee) first 2 by .at";
const BOTH_PINNED: &str = "return t where (assignee = null or .assignee = assignee) and (status = null or .status = status) first 2 by .at";

fn classes(c: &scale::Certificate) -> Vec<(String, Class)> {
    c.variants.iter().map(|v| (v.when.clone(), v.class)).collect()
}

#[test]
fn facts_hold_in_order_inside_a_branch() {
    // Grok, scale round 7: a present call returns by one of two tests in turn, so the closing
    // scan runs only when the assignee is absent.
    let source = format!("{STATUSED}query q(assignee: principal ?, status: enum('todo', 'done') ?):\n  if assignee != null:\n    if status != null:\n      {PINNED}\n    if status = null:\n      return []\n  return t first 2 by .at\n");
    let c = certificate(&source);
    assert!(c.growth_sites.iter().all(|g| g.when.is_some()), "no site runs in every call: {:?}", c.growth_sites);
    assert_eq!(classes(&c), vec![("assignee and status are both present".to_owned(), Class::Backlog), ("assignee is absent".to_owned(), Class::Grows)], "{}", c.line());
}

#[test]
fn a_decided_test_runs_only_its_matching_branch() {
    // Grok, scale round 7: inside `assignee != null`, the `else` of `assignee = null` runs and
    // the other branch's scan never does.
    let source = format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee != null:\n    if assignee = null:\n      return t first 2 by .at\n    else:\n      {PINNED}\n  return t first 3 by .at\n");
    let c = certificate(&source);
    assert_eq!(classes(&c), vec![("assignee is present".to_owned(), Class::Backlog), ("assignee is absent".to_owned(), Class::Grows)], "{}", c.line());
    assert!(!c.growth_sites.iter().any(|g| g.when.as_deref() == Some("assignee is present") && !g.backlog), "{:?}", c.growth_sites);
}

#[test]
fn every_program_finds_what_never_runs() {
    // Grok, scale round 7: no scan here is a planner variant, yet the only scan never runs: a
    // present call refuses and an absent one returns.
    let source = format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee != null:\n    if assignee != null:\n      require false else STOP\n    return t first 2 by .at\n  return []\n");
    let c = certificate(&source);
    assert_eq!((c.class, c.growth_sites.len(), c.variants.len()), (Class::Constant, 0, 0), "{}", c.line());
    // The facts decide what runs, but only a planner variant scan names a variant.
    let live = format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee != null:\n    return t first 2 by .at\n  return []\n");
    let c = certificate(&live);
    assert_eq!(c.class, Class::Grows, "{}", c.line());
    assert!(c.variants.is_empty() && c.growth_sites.iter().all(|g| g.when.is_none()), "{c:?}");
}

#[test]
fn a_refusal_leaves_where_its_test_fails() {
    // Grok, scale round 7: ordered comparisons of literals and `not` decide a refusal too.
    for refusal in ["require 1 > 2 else STOP", "require 1 < 1 else STOP", "require 2 <= 1 else STOP", "require 1 >= 2 else STOP",
        "require not true else STOP", "require not (1 = 1) else STOP", "require false or 1 > 2 else STOP"] {
        let source = format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee != null:\n    {PINNED}\n  else:\n    {refusal}\n  return t first 3 by .at\n");
        let c = certificate(&source);
        assert_eq!(c.class, Class::Backlog, "{refusal}: {}", c.line());
    }
    // Astra, scale precision round 0: `or` with a true operand holds and `and` with a false one
    // fails, whatever the other operand.
    for refusal in ["require not (flag or true) else STOP", "require not (true or flag) else STOP", "require flag and false else STOP", "require false and flag else STOP"] {
        let source = format!("{EXPIRING}query q(flag: bool):\n  {refusal}\n  return t first 2 by .at\n");
        let c = certificate(&source);
        assert_eq!((c.class, c.growth_sites.len()), (Class::Constant, 0), "{refusal}: {}", c.line());
    }
    for passing in ["require 2 > 1 else STOP", "require 1 <= 1 else STOP", "require not false else STOP", "require 1 < 2 and 2 >= 2 else STOP"] {
        let source = format!("{EXPIRING}query q(assignee: principal ?):\n  {passing}\n  return t first 3 by .at\n");
        assert_eq!(certificate(&source).class, Class::Grows, "{passing}");
    }
    // A presence refusal the facts in force contradict always refuses.
    let contradicted = format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee = null:\n    require assignee != null else STOP\n    return t first 2 by .at\n  {PINNED}\n");
    let c = certificate(&contradicted);
    assert_eq!(classes(&c), vec![("assignee is present".to_owned(), Class::Backlog)], "{}", c.line());
    // One a call can pass states its facts for what follows.
    let required = format!("{EXPIRING}query q(assignee: principal ?):\n  require assignee != null else STOP\n  {PINNED}\n");
    let c = certificate(&required);
    assert_eq!(classes(&c), vec![("assignee is present".to_owned(), Class::Backlog)], "{}", c.line());
}

#[test]
fn not_and_and_or_state_presence_facts() {
    let reference = certificate(&format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee != null:\n    {PINNED}\n  return t first 2 by .at\n"));
    // Grok, scale round 7: `not (assignee = null)` is `assignee != null`, and a binding holds its test.
    for (setup, test) in [("", "not (assignee = null)"), ("  known = assignee != null\n", "known"), ("  known = assignee != null\n  copy = known\n", "copy")] {
        let source = format!("{EXPIRING}query q(assignee: principal ?):\n{setup}  if {test}:\n    {PINNED}\n  return t first 2 by .at\n");
        let c = certificate(&source);
        assert_eq!(classes(&c), classes(&reference), "{test}: {}", c.line());
    }
    // A test that contradicts itself never holds.
    let never = certificate(&format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee != null and assignee = null:\n    return t first 2 by .at\n  {PINNED}\n"));
    assert_eq!(classes(&never), classes(&reference), "{}", never.line());
    let mirrored = certificate(&format!("{EXPIRING}query q(assignee: principal ?):\n  if not (assignee != null):\n    return t first 2 by .at\n  {PINNED}\n"));
    assert_eq!(classes(&mirrored), vec![("assignee is absent".to_owned(), Class::Grows), ("assignee is present".to_owned(), Class::Backlog)], "{}", mirrored.line());
    // `and` and `or`, which the compiler binds to a temporary, and `not` of them.
    let args = "query q(assignee: principal ?, status: enum('todo', 'done') ?):\n";
    let both = vec![("assignee and status are both present".to_owned(), Class::Backlog)];
    for body in [
        format!("  if assignee != null and status != null:\n    {BOTH_PINNED}\n  return []\n"),
        format!("  if assignee = null or status = null:\n    return []\n  {BOTH_PINNED}\n"),
        format!("  if not (assignee != null and status != null):\n    return []\n  {BOTH_PINNED}\n"),
        format!("  require assignee != null and status != null else STOP\n  {BOTH_PINNED}\n"),
        format!("  known = assignee != null and status != null\n  if known:\n    {BOTH_PINNED}\n  return []\n"),
    ] {
        let c = certificate(&format!("{STATUSED}{args}{body}"));
        assert_eq!(classes(&c), both, "{body}: {}", c.line());
    }
}

#[test]
fn a_binding_holds_its_test_only_where_the_walk_knows_it() {
    let args = "query q(assignee: principal ?, status: enum('todo', 'done') ?, limit: int):\n";
    // Read before an `and` step, a binding holds its first test, not its last.
    let early = format!("{STATUSED}{args}  known = assignee != null\n  if known:\n    extra = t where (assignee = null or .assignee = assignee) first 2 by .at\n  if known:\n    known = status != null\n  return []\n");
    let c = certificate(&early);
    assert_eq!(classes(&c), vec![("assignee is present".to_owned(), Class::Backlog)], "{}", c.line());
    // A second pass of a loop reads what the first assigned: the pinned scan can run with the
    // assignee absent, so it grows.
    let looped = format!("{STATUSED}{args}  known = assignee != null\n  for k in [1, 2]:\n    if known:\n      extra = t where (assignee = null or .assignee = assignee) first 2 by .at\n    known = status != null\n  return []\n");
    let c = certificate(&looped);
    assert_eq!(c.class, Class::Grows, "{}", c.line());
    // After a branch that may not run, a step inside it may not have happened: the status-pinned
    // scan can run with the status absent.
    let branched = format!("{STATUSED}{args}  known = assignee != null\n  if limit > 2:\n    if known:\n      known = status != null\n  if known:\n    extra = t where (status = null or .status = status) first 2 by .at\n  return []\n");
    let c = certificate(&branched);
    assert!(c.variants.iter().any(|v| v.when.contains("status is absent") && v.class == Class::Grows), "{}", c.line());
}

#[test]
fn code_that_never_runs_keeps_the_lane_bound() {
    // Grok, scale round 7: a search after the `return` never runs, so the merge keeps its lanes.
    let schema = "table posts:\n  author: principal\n  by byAuthor: author, id\n  public\n  online only\ntable notes:\n  title: text <=100\n  search title\n  public\n  online only\n";
    let live = format!("{schema}query q(people: [principal] <=4, needle: text <=100, c: cursor ?):\n  page = merge posts after c first 3 by byAuthor:\n    [p] for p in people\n  return page\n");
    let dead = format!("{live}  extra = notes matching needle first 2 by .id\n");
    let (live, dead) = (certificate(&live), certificate(&dead));
    assert_eq!(live.bounds.lanes, Some(4), "{}", live.line());
    assert_eq!(dead.bounds.lanes, live.bounds.lanes, "{}", dead.line());
    assert_eq!(dead.class, Class::Constant, "{}", dead.line());
}

#[test]
fn a_sweep_the_job_never_reaches_is_not_the_whole_job() {
    // Grok, scale round 7.
    let schema = "table posts:\n  amount: int\n  public\n  online only\n";
    let sweep = "  for p in posts:\n    update posts[p.id] { amount: p.amount + 1 }\n";
    let reached = certificate(&format!("{schema}job q():\n{sweep}"));
    assert!(reached.whole_job.iter().any(|s| s.contains("posts")), "{:?}", reached.whole_job);
    let skipped = certificate(&format!("{schema}job q():\n  return\n{sweep}"));
    assert!(skipped.whole_job.is_empty(), "{:?}", skipped.whole_job);
}

#[test]
fn each_branch_starts_from_the_tests_before_it() {
    // Astra, scale precision round 0: the `then` arm's step must not decide the `else` arm, where
    // `known` is still true and the scan runs.
    let arms = "  known = true\n  if flag:\n    if known:\n      known = false\n  else:\n    if known:\n      return t first 2 by .at\n  return []\n";
    let c = certificate(&format!("{EXPIRING}query q(flag: bool):\n{arms}"));
    assert_eq!(c.class, Class::Grows, "{}", c.line());
    // The same inside a helper, which the compiler expands into an expression block.
    let c = certificate(&format!("{EXPIRING}fn pick(flag: bool):\n{arms}query q(flag: bool):\n  return pick(flag)\n"));
    assert_eq!(c.class, Class::Grows, "{}", c.line());
    // Nor narrow a site: the `else` arm's scan runs whenever the assignee is present, whatever the status.
    let narrowed = format!("{STATUSED}query q(flag: bool, assignee: principal ?, status: enum('todo', 'done') ?):\n  known = assignee != null\n  if flag:\n    if known:\n      known = status != null\n  else:\n    if known:\n      {PINNED}\n  return []\n");
    let c = certificate(&narrowed);
    assert_eq!(classes(&c), vec![("assignee is present".to_owned(), Class::Backlog)], "{}", c.line());
    // After the `if`, a binding an arm reassigned may hold either value: with `flag` true, `known`
    // is true and the scan runs with the assignee absent.
    let either = format!("{EXPIRING}query q(flag: bool, assignee: principal ?):\n  known = assignee != null\n  if flag:\n    known = true\n  if known:\n    {PINNED}\n  return []\n");
    let c = certificate(&either);
    assert_eq!(c.class, Class::Grows, "{}", c.line());
    // Grok, scale precision round 0: an assignment in an arm or a loop that never runs leaves
    // `known` as it was.
    for dead in ["  if 1 > 2:\n    known = false\n", "  if 1 > 2:\n    for k in [1, 2]:\n      known = false\n"] {
        let source = format!("{EXPIRING}query q(assignee: principal ?):\n  known = assignee != null\n{dead}  if known:\n    {PINNED}\n  return t first 2 by .at\n");
        let c = certificate(&source);
        assert_eq!(classes(&c), vec![("assignee is present".to_owned(), Class::Backlog), ("assignee is absent".to_owned(), Class::Grows)], "{dead}: {}", c.line());
        assert!(c.growth_sites.iter().all(|g| g.when.is_some()), "{dead}: {:?}", c.growth_sites);
    }
}

#[test]
fn a_loop_may_run_no_times() {
    // Astra, scale precision round 0: with no iterations `known` keeps its value from before the
    // loop, so the unpinned scan runs with the assignee absent.
    let source = format!("{EXPIRING}query q(xs: [int] <=2, assignee: principal ?):\n  known = true\n  for k in xs:\n    known = true\n    if known:\n      known = assignee != null\n  if known:\n    {PINNED}\n  return []\n");
    let c = certificate(&source);
    assert_eq!(c.class, Class::Grows, "{}", c.line());
    assert!(c.variants.iter().any(|v| v.when == "assignee is absent" && v.class == Class::Grows), "{}", c.line());
    // Nor may a loop that assigns `false` hide a scan after it.
    let cleared = format!("{EXPIRING}query q(xs: [int] <=2):\n  known = true\n  for k in xs:\n    known = true\n    if known:\n      known = false\n  if known:\n    return t first 2 by .at\n  return []\n");
    assert_eq!(certificate(&cleared).class, Class::Grows);
}

#[test]
fn a_constant_side_of_and_or_or_leaves_the_other_to_decide() {
    // Grok, scale precision round 0: `(assignee = null or false)` is `assignee = null`, so the `and`
    // never holds.
    let never = format!("{EXPIRING}query q(assignee: principal ?):\n  if assignee != null and (assignee = null or false):\n    return t first 2 by .at\n  return []\n");
    let c = certificate(&never);
    assert_eq!((c.class, c.growth_sites.len()), (Class::Constant, 0), "{}", c.line());
    let present = vec![("assignee is present".to_owned(), Class::Backlog)];
    for test in ["false or assignee != null", "assignee != null or false", "not true or assignee != null"] {
        let c = certificate(&format!("{EXPIRING}query q(assignee: principal ?):\n  if {test}:\n    {PINNED}\n  return []\n"));
        assert_eq!(classes(&c), present, "{test}: {}", c.line());
    }
    let required = certificate(&format!("{EXPIRING}query q(assignee: principal ?):\n  require false or assignee != null else STOP\n  {PINNED}\n"));
    assert_eq!(classes(&required), present, "{}", required.line());
    // Where `not (assignee != null and true)` holds, the assignee is absent.
    let negated = certificate(&format!("{EXPIRING}query q(assignee: principal ?):\n  if not (assignee != null and true):\n    return []\n  {PINNED}\n"));
    assert_eq!(classes(&negated), present, "{}", negated.line());
    // But an `or` of two presence tests states neither: a call with one present runs the unpinned arm.
    let either = certificate(&format!("{STATUSED}query q(assignee: principal ?, status: enum('todo', 'done') ?):\n  if assignee != null or status != null:\n    {BOTH_PINNED}\n  return []\n"));
    assert_eq!(either.class, Class::Grows, "{}", either.line());
}

#[test]
fn facts_an_arm_establishes_hold_after_it() {
    // Grok, scale precision round 0: a refusal inside an arm that always runs, or inside both arms,
    // conditions what follows the `if`.
    for arms in ["  if 1 < 2:\n    require assignee != null else STOP\n", "  if true:\n    require assignee != null else STOP\n",
        "  if false:\n    return []\n  else:\n    require assignee != null else STOP\n",
        "  if flag:\n    require assignee != null else STOP\n  else:\n    require assignee != null else STOP\n"] {
        let c = certificate(&format!("{EXPIRING}query q(flag: bool, assignee: principal ?):\n{arms}  {PINNED}\n"));
        assert_eq!(classes(&c), vec![("assignee is present".to_owned(), Class::Backlog)], "{arms}: {}", c.line());
    }
    // A refusal in one arm leaves the other arm's calls free.
    let one = certificate(&format!("{EXPIRING}query q(flag: bool, assignee: principal ?):\n  if flag:\n    require assignee != null else STOP\n  {PINNED}\n"));
    assert_eq!(one.class, Class::Grows, "{}", one.line());
}
