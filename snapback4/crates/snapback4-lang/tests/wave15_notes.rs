use snapback4_lang::{compile, Bound};
fn checked(source: &str) -> Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn has(b: &Bound, code: &str) -> bool { b.notes.iter().any(|n| n.code == code) }
const REFS: &str = "table parents:\n  public\ntable kids:\n  parent: parents on delete keep\n  public\n  insert <- allow\n";

#[test]
fn declared_cursor_pages_are_quiet_while_cursorless_pages_keep_advice() {
    for direction in ["first", "last"] {
        let source = format!("table rows:\n  at: time\n  public\nquery page(c: cursor ?):\n  return rows {direction} 50 by .at after c\n");
        assert!(!has(&checked(&source), "N_NO_CURSOR"));
        assert!(has(&checked(&source.replace(" after c", "")), "N_NO_CURSOR"));
    }
}

#[test]
fn declining_an_authority_branch_plan_keeps_the_cursor_and_reaches_later_rows() {
    use snapback4_core::{Context, Engine, Value, value::object};
    use std::collections::BTreeMap;
    let source = "table adults:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable medicines:\n  expiresAt: time\n  read <- exists adults[viewer] or (exists grants[guest = viewer] and exists shortlist[medicine = .id])\n  cap 200\n  online only\ntable shortlist:\n  medicine: medicines on delete keep\n  unique medicine\n  read <- exists adults[viewer] or exists grants[guest = viewer]\n  cap 50\n  online only\ntable grants:\n  guest: principal\n  endsAt: time\n  unique guest\n  immutable guest\n  read <- exists adults[viewer] or .guest = viewer\n  expire at .endsAt\n  cap 10\n  online only\nquery cabinet(c: cursor ?):\n  return medicines first 1 by .expiresAt after c\n";
    let b = checked(source);
    assert!(!has(&b, "N_NO_CURSOR"), "{:?}", b.notes);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([
        ("adults".into(), object([("id", Value::Id("a".into())), ("principal", Value::Id("user:alice".into()))])),
        ("medicines".into(), object([("id", Value::Id("m1".into())), ("expiresAt", Value::Int(100))])),
        ("medicines".into(), object([("id", Value::Id("m2".into())), ("expiresAt", Value::Int(200))])),
    ]).unwrap();
    let first = engine.query("cabinet", Context::new("user:alice", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
    assert_eq!(first.data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id("m1".into()));
    let second = engine.query("cabinet", Context::new("user:alice", BTreeMap::from([("c".into(), Value::String(first.next.expect("declared continuation must be reachable")))]))).unwrap();
    assert_eq!(second.data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id("m2".into()));
}

#[test]
fn later_exact_lookup_covers_only_the_writes_committing_paths() {
    let cases = [
        ("  insert kids { parent }\n  p = parents[parent] ! else NOT_FOUND\n", false),
        ("  if flag:\n    insert kids { parent }\n    p = parents[parent] ! else NOT_FOUND\n", false),
        ("  insert kids { parent }\n  if flag:\n    p = parents[parent] ! else NOT_FOUND\n", true),
        ("  insert kids { parent }\n  if flag:\n    return null\n  p = parents[parent] ! else NOT_FOUND\n", true),
        ("  if flag:\n    insert kids { parent }\n    return null\n  p = parents[parent] ! else NOT_FOUND\n", true),
        ("  insert kids { parent }\n  p = parents[other] ! else NOT_FOUND\n", true),
        ("  insert kids { parent }\n  for v in flags:\n    p = parents[parent] ! else NOT_FOUND\n", true),
        ("  insert kids { parent }\n  p = parents[parent]\n", false),
        ("  for item in flags:\n    if item:\n      return null\n    insert kids { parent }\n  p = parents[parent]\n", true),
        ("  for item in flags:\n    insert kids { parent }\n    p = parents[parent]\n", false),
    ];
    for (body, note) in cases {
        let source = format!("{REFS}mutation create(parent: parents, other: parents, flag: bool, flags: [bool] <=2):\n{body}");
        assert_eq!(has(&checked(&source), "N_REFERENCE_UNCHECKED"), note, "{source}");
    }
}

#[test]
fn incompatible_row_join_names_both_tables_even_in_a_container() {
    for expression in ["a if flag else b", "{ nested: a } if flag else { nested: b }"] {
        let source = format!("table apples:\n  public\ntable berries:\n  public\nquery joined(aid: apples, bid: berries, flag: bool):\n  a = apples[aid]\n  b = berries[bid]\n  return {expression}\n");
        let b = compile(&[("schema.q".into(), source)]);
        let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_SHAPE_JOIN").unwrap();
        assert!(d.message.contains("apples") && d.message.contains("berries"), "{d:?}");
    }
}

#[test]
fn duplicate_rule_retains_the_table_and_uses_its_own_card() {
    let b = compile(&[("schema.q".into(), "table parents:\n  read <- allow\n  insert <- allow\n  insert <- deny\ntable kids:\n  parent: parents on delete keep\n  public\nquery parent(id: parents):\n  return parents[id]\n".into())]);
    assert_eq!(b.diagnostics.len(), 1, "{:?}", b.diagnostics);
    let d = &b.diagnostics[0];
    assert_eq!(d.code, "E_QUARRY_DUPLICATE_RULE");
    assert!(d.message.contains("schema.q:3"), "{d:?}");
    assert!(d.explanation().unwrap().contains("Keep one rule"));
}

#[test]
fn maintained_membership_uses_existing_equality_semantics() {
    let schema = "table rows:\n  status: enum('waiting', 'delivering', 'done')\n  lane: int\n  public\n";
    let b = checked(&format!("{schema}view counts: count rows where .status in ['waiting', 'delivering'] by .lane\n"));
    let equivalent = checked(&format!("{schema}view counts: count rows where .status = 'waiting' or .status = 'delivering' by .lane\n"));
    assert_eq!(b.schema, equivalent.schema);
    checked(&format!("{schema}view counts: count rows where .status in [] by .lane\n"));
    for ty in ["json <=1000", "bytes <=1000"] {
        let source = format!("table rows:\n  payload: {ty}\n  public\nview counts: count rows where .payload in []\n");
        let b = compile(&[("schema.q".into(), source)]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_MAINTAIN"), "{ty}: {:?}", b.diagnostics);
    }
    for values in ["['bad']", "['waiting', 3]", "42"] {
        let b = compile(&[("schema.q".into(), format!("{schema}view counts: count rows where .status in {values} by .lane\n"))]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_MAINTAIN"), "{values}: {:?}", b.diagnostics);
    }
}

#[test]
fn bound_locals_equal_to_unique_keys_do_not_warn_on_immutable_upserts() {
    let schema = "table rows:\n  week: int\n  name: text <=80\n  unique week\n  immutable week\n  public\n  insert <- allow\n  update <- allow\n";
    let b = checked(&format!("{schema}mutation put(name: text <=80):\n  week = day(now) - (day(now) + 3) % 7\n  return upsert rows[week] {{ week, name }}\n"));
    assert!(!has(&b, "N_IMMUTABLE_PATCH"), "{:?}", b.notes);
    let b = checked(&format!("{schema}mutation put(name: text <=80):\n  week = day(now)\n  other = day(now)\n  return upsert rows[week] {{ week: other, name }}\n"));
    assert!(has(&b, "N_IMMUTABLE_PATCH"));
}

const AUTH: &str = "table staff:\n  principal: principal\n  role: enum('manager', 'assistant')\n  unique principal\n  read <- .principal = viewer\n  online only\ntable rows:\n  owner: principal\n  read <- .owner = viewer or exists staff[viewer, role = 'manager']\n  insert <- exists staff[viewer] or viewer = 'service:ops'\n  online only\n";
#[test]
fn service_alternative_does_not_discharge_the_human_authority_branch() {
    let source = format!("{AUTH}mutation add(owner: principal):\n  require owner = viewer or exists staff[viewer] else NO_ROLE\n  return insert rows {{ owner }}\n");
    assert!(has(&checked(&source), "N_REQUIRE_REFUSED"));
    let service = source.replace("owner = viewer or exists staff[viewer]", "viewer = 'service:ops' or exists staff[viewer]");
    assert!(!has(&checked(&service), "N_REQUIRE_REFUSED"));
}

#[test]
fn explicit_query_branch_names_a_narrower_table_rule_without_changing_it() {
    let source = format!("{AUTH}query listing(c: cursor ?):\n  if exists staff[viewer]:\n    return rows first 20 by .id after c\n  return rows where .owner = viewer first 20 by .id after c\n");
    let b = checked(&source);
    assert!(has(&b, "N_QUERY_FILTERED"), "{:?}", b.notes);
    assert!(!has(&checked(&source.replace("if exists staff[viewer]:", "if exists staff[viewer, role = 'manager']:")), "N_QUERY_FILTERED"));
    for result in ["    page = rows first 20 by .id after c\n    return page", "    return { page: rows first 20 by .id after c }", "    box = { page: rows first 20 by .id after c }\n    return box.page", "    page = rows first 20 by .id after c\n    alias = page\n    return { nested: [alias] }"] {
        let indirect = source.replace("    return rows first 20 by .id after c", result).replace("  return rows where .owner = viewer first 20 by .id after c", "  return null");
        assert!(has(&checked(&indirect), "N_QUERY_FILTERED"), "{indirect}");
        assert!(!has(&checked(&indirect.replace("if exists staff[viewer]:", "if exists staff[viewer, role = 'manager']:")), "N_QUERY_FILTERED"));
    }
    let assigned = format!("{AUTH}query listing(c: cursor ?):\n  page = []\n  if exists staff[viewer]:\n    page = rows first 20 by .id after c\n  return page\n");
    assert!(has(&checked(&assigned), "N_QUERY_FILTERED"));
    assert!(!has(&checked(&assigned.replace("if exists staff[viewer]:", "if exists staff[viewer, role = 'manager']:")), "N_QUERY_FILTERED"));
    for expression in ["rows first 20 by .id after c", "{ page: rows first 20 by .id after c }"] {
        let implicit = format!("{AUTH}query listing(c: cursor ?):\n  require exists staff[viewer] else NO_ROLE\n  {expression}\n");
        assert!(has(&checked(&implicit), "N_QUERY_FILTERED"));
        assert!(!has(&checked(&implicit.replace("require exists staff[viewer]", "require exists staff[viewer, role = 'manager']")), "N_QUERY_FILTERED"));
    }
    for transfer in ["break", "continue"] {
        let looped = format!("{AUTH}query listing(c: cursor ?):\n  page = []\n  for item in [true, false]:\n    if exists staff[viewer]:\n      page = rows first 20 by .id after c\n      {transfer}\n  return page\n");
        assert!(has(&checked(&looped), "N_QUERY_FILTERED"));
        assert!(!has(&checked(&looped.replace("if exists staff[viewer]:", "if exists staff[viewer, role = 'manager']:")), "N_QUERY_FILTERED"));
    }
}

#[test]
fn bounds_name_enabling_rules_and_never_page_atomic_fanout() {
    let source = "table parents:\n  public\n  delete <- allow\ntable kids:\n  parent: parents on delete cascade\n  public\n";
    let b = compile(&[("schema.q".into(), source.into())]);
    let d = b.diagnostics.iter().find(|d| d.code == "E_CASCADE_BOUND").unwrap();
    assert!(d.message.contains("delete <- allow") && d.message.contains("schema.q:3"), "{d:?}");
    assert!(d.rewrite.contains("delete <- deny"));
    let b = compile(&[("schema.q".into(), "table rows:\n  public\n  delete <- allow\nmutation clean():\n  for r in rows:\n    delete rows[r.id]\n".into())]);
    let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_FANOUT").unwrap();
    assert!(!d.rewrite.contains("cursor") && !d.rewrite.contains("page with"), "{d:?}");
}

#[test]
fn unreadable_guard_cites_its_backing_unique_key() {
    let b = checked("table rows:\n  owner: principal\n  name: text <=40\n  unique name\n  read <- .owner = viewer\n  insert <- .owner = viewer\nmutation add(name: text <=40):\n  require not exists rows[name = name] else TAKEN\n  return insert rows { owner: viewer, name }\n");
    let n = b.notes.iter().find(|n| n.code == "N_UNREADABLE_PROBE").unwrap();
    assert!(n.message.contains("Backing unique index: rows(name)"), "{n:?}");
    let by_id = checked("table rows:\n  owner: principal\n  read <- .owner = viewer\n  online only\nmutation absent(row: rows):\n  require not exists rows[row] else PRESENT\n  return true\n");
    let n = by_id.notes.iter().find(|n| n.code == "N_UNREADABLE_PROBE").unwrap();
    assert!(n.message.contains("Backing unique index: rows(id)"), "{n:?}");
}

#[test]
fn caller_absence_cannot_discharge_a_physical_negative_read_rule() {
    let bans = "table bans:\n  principal: principal\n  unique principal\n  read <- deny\n  online only\n";
    let auth = AUTH.replace("read <- .owner = viewer or exists staff[viewer, role = 'manager']", "read <- exists staff[viewer] and not exists bans[viewer]");
    let query = "query listing(c: cursor ?):\n  require exists staff[viewer] and not exists bans[viewer] else NO_ROLE\n  return rows first 20 by .id after c\n";
    assert!(has(&checked(&format!("{bans}{auth}{query}")), "N_QUERY_FILTERED"));
    assert!(!has(&checked(&format!("{}{auth}{query}", bans.replace("read <- deny", "read <- allow"))), "N_QUERY_FILTERED"));
}

#[test]
fn complex_query_branch_analysis_stops_with_an_honest_review_note() {
    let args = (0..14).map(|i| format!("b{i}: bool")).collect::<Vec<_>>().join(", ");
    let branches = (0..14).map(|i| format!("  if b{i}:\n    ignored{i} = true\n")).collect::<String>();
    let source = format!("{AUTH}query complex({args}, c: cursor ?):\n{branches}  return rows first 20 by .id after c\n");
    let b = checked(&source);
    assert!(b.notes.iter().any(|n| n.code == "N_QUERY_FILTERED" && n.message.contains("source-analysis limit") && n.message.contains("rows")));
}

#[test]
fn concatenation_and_loop_append_keep_only_returned_page_origins() {
    for result in [
        "  return [page] + []\n",
        "  return [] + [page]\n",
        "  pages = []\n  for item in [true, false]:\n    pages = pages + [page]\n  return pages\n",
    ] {
        let source = format!("{AUTH}query listing(c: cursor ?):\n  require exists staff[viewer] else NO_ROLE\n  page = rows first 20 by .id after c\n{result}");
        assert!(has(&checked(&source), "N_QUERY_FILTERED"), "{source}");
        assert!(!has(&checked(&source.replace("require exists staff[viewer]", "require exists staff[viewer, role = 'manager']")), "N_QUERY_FILTERED"));
    }
    let unused = format!("{AUTH}query listing(c: cursor ?):\n  require exists staff[viewer] else NO_ROLE\n  page = rows first 20 by .id after c\n  discarded = [page] + []\n  return []\n");
    assert!(!has(&checked(&unused), "N_QUERY_FILTERED"));
}

#[test]
fn a_caller_probe_inside_where_is_part_of_the_authority_proof() {
    for body in [
        "  page = rows where exists staff[viewer] first 20 by .id after c\n  return { page }\n",
        "  page = rows where .owner = viewer or exists staff[viewer] first 20 by .id after c\n  return { page }\n",
        "  rows where exists staff[viewer] first 20 by .id after c\n",
    ] {
        let source = format!("{AUTH}query listing(c: cursor ?):\n{body}");
        assert!(has(&checked(&source), "N_QUERY_FILTERED"), "{source}");
        assert!(!has(&checked(&source.replace("exists staff[viewer] first", "exists staff[viewer, role = 'manager'] first")), "N_QUERY_FILTERED"));
    }
}
