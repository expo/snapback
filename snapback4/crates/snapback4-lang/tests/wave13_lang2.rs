use snapback4_lang::{compile, bind::Bound};
use snapback4_core::{Context, Engine, Value, value::object};

fn checked(source: &str) -> Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{source}\n{:#?}", b.diagnostics);
    b
}
fn refusal(source: &str, code: &str) -> snapback4_lang::Diagnostic {
    let b = compile(&[("schema.q".into(), source.into())]);
    b.diagnostics.iter().find(|d| d.code == code).cloned().unwrap_or_else(|| panic!("missing {code}: {:#?}", b.diagnostics))
}
fn immutable_note(source: &str) -> snapback4_lang::Diagnostic {
    checked(source).notes.into_iter().find(|d| d.code == "N_IMMUTABLE_PATCH").expect("immutable equality note")
}
fn quiet(source: &str) {
    let b = checked(source);
    assert!(!b.notes.iter().any(|d| d.code == "N_IMMUTABLE_PATCH"), "{:?}", b.notes);
}
fn engine(source: &str) -> Engine {
    let b = checked(source);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn query(engine: &mut Engine, name: &str, viewer: &str, args: &[(&str, Value)]) -> snapback4_core::engine::QueryOutcome {
    engine.query(name, Context::new(viewer, args.iter().map(|(k,v)| ((*k).into(),v.clone())).collect())).unwrap()
}

const MEMBERSHIP: &str = "table judges:\n  principal: principal\n  story: stories\n  unique story, principal\n  read <- .principal = viewer\n  online only\ntable stories:\n  winner: bool\n  read <- exists judges[story = .id, principal = viewer]\n  online only\nquery winners(c: cursor ?):\n  return stories where .winner = true first 1 by .id after c\n";
#[test]
fn unique_membership_lanes_filter_one_point_and_continue_in_merge_order() {
    let b = checked(MEMBERSHIP);
    assert!(!b.notes.iter().any(|n| n.code == "N_NEVER_COMPLETE"), "{:?}", b.notes);
    let mut e = engine(MEMBERSHIP);
    e.seed([("stories".into(), object([("id", id("a")), ("winner",Value::Bool(false))])),
        ("stories".into(), object([("id", id("b")), ("winner",Value::Bool(true))])),
        ("stories".into(), object([("id", id("c")), ("winner",Value::Bool(true))])),
        ("stories".into(), object([("id", id("hidden")), ("winner",Value::Bool(true))]))]).unwrap();
    e.seed(["a","b","c"].into_iter().map(|s| ("judges".into(), object([
        ("id",id(&format!("j{s}"))), ("story",id(s)), ("principal",id("alice"))])))).unwrap();
    let a = query(&mut e,"winners","alice", &[("c",Value::Null)]);
    assert!(a.complete, "{a:?}");
    assert_eq!(a.data.as_array().unwrap()[0].field("id").unwrap(), &id("b"));
    let b = query(&mut e,"winners","alice", &[("c", Value::String(a.next.unwrap()))]);
    assert!(b.complete, "{b:?}");
    assert_eq!(b.data.as_array().unwrap()[0].field("id").unwrap(), &id("c"));
}

#[test]
fn dormant_cascades_need_bounds_only_after_a_delete_source_appears() {
    let source = "table parents:\n  public\n  online only\ntable children:\n  parent: parents on delete cascade\n  public\n  online only\n";
    let b = checked(source);
    assert!(b.notes.iter().any(|note| note.code == "N_CASCADE_DORMANT"));
    Engine::memory(b.schema, []).unwrap();
    for active in [source.replace("table parents:\n", "table parents:\n  delete <- allow\n"),
        source.replace("table parents:\n", "table parents:\n  until: time\n  expire at .until\n"),
        format!("{source}mutation remove(p: parents):\n  delete parents[p]\n  return null\n"),
        format!("{source}job remove():\n  for p in parents:\n    delete parents[p.id]\n")] {
        let d = refusal(&active, "E_CASCADE_BOUND");
        assert!(d.rewrite.contains("product limit") && d.rewrite.contains("Heap ="), "{d}");
    }
    let active = source.replace("table parents:\n", "table parents:\n  delete <- allow\n").replace("  parent: parents on delete cascade\n", "  parent: parents on delete cascade\n  cap 3 by parent\n");
    checked(&active);
}

#[test]
fn immutable_patches_split_proven_changes_notes_and_proven_equality() {
    let base = "table entries:\n  owner: principal\n  at: time\n  body: text\n  unique owner\n  immutable owner, at\n  public\n  insert <- allow\n  update <- allow\n  online only\n";
    for write in ["update entries[e] { at: now }", "upsert entries[viewer] { at: now, body: 'x' }"] {
        refusal(&format!("{base}mutation bad(e: entries):\n  {write}\n  return null\n"), "E_QUARRY_IMMUTABLE");
    }
    quiet(&format!("{base}mutation key():\n  upsert entries[viewer] {{ owner: viewer, body: 'x' }}\n  return null\n"));
    quiet(&format!("{base}mutation snapshot(e: entries):\n  r = entries[e] ! else NOT_FOUND\n  update entries[e] {{ at: r.at }}\n  return null\n"));
    immutable_note(&format!("{base}mutation stale(e: entries):\n  r = entries[e] ! else NOT_FOUND\n  update entries[e] {{ body: 'x' }}\n  update entries[e] {{ at: r.at }}\n  return null\n"));
    immutable_note(&format!("{base}mutation spread(e: entries, at: time):\n  patch = {{ at }}\n  update entries[e] {{ ...patch }}\n  return null\n"));
}

#[test]
fn non_null_filter_refines_loop_and_shape_snapshots_but_not_other_rows_or_phase() {
    let base = "table entries:\n  x: int ?\n  public\n  cap 4\n  online only\n";
    checked(&format!("{base}query loop():\n  values = []\n  for row in entries where .x != null:\n    values = values + [row.x + 1]\n  return values\n"));
    checked(&format!("{base}query shape():\n  return entries where .x != null first 4 by .id {{ value: .x + 1 }}\n"));
    refusal(&format!("{base}query disjunction():\n  return entries where .x != null or true first 4 by .id {{ value: .x + 1 }}\n"), "E_QUARRY_TYPE");
}

#[test]
fn opening_boundary_index_is_inferred_without_an_authored_index() {
    let b = checked("table messages:\n  opens: time ?\n  not before .opens\n  public\n  online only\nquery list(c: cursor ?):\n  return messages first 10 by .id after c\n");
    assert!(b.schema.tables["messages"].opening_index().is_some());
}

#[test]
fn finite_parent_and_child_policy_walks_exhaust_without_claiming_uncapped_reads() {
    let base = "table parents:\n  public\n  online only\ntable grants:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable children:\n  parent: parents\n  owner: principal\n  open: bool\n  cap 2 by parent\n  read <- .owner = viewer or (exists grants[viewer] and .open = true)\n  online only\nquery list(parent: parents, c: cursor ?):\n  return children where .parent = parent first 2 by .id after c\n";
    let b = checked(base);
    assert!(b.schema.required_capabilities().contains("branch-pages-v5"));
    assert!(!b.notes.iter().any(|n| n.code == "N_NEVER_COMPLETE"), "{:?}", b.notes);
    let mut e = engine(base);
    e.seed([("parents".into(),object([("id",id("p"))])),
        ("children".into(),object([("id",id("a")),("parent",id("p")),("owner",id("bob")),("open",Value::Bool(true))])),
        ("children".into(),object([("id",id("b")),("parent",id("p")),("owner",id("bob")),("open",Value::Bool(false))]))]).unwrap();
    let hidden = query(&mut e,"list","alice", &[("parent",id("p")),("c",Value::Null)]);
    assert!(hidden.complete && hidden.data.as_array().unwrap().is_empty(), "{hidden:?}");
    e.seed([("grants".into(),object([("id",id("g")),("principal",id("alice"))]))]).unwrap();
    let visible = query(&mut e,"list","alice", &[("parent",id("p")),("c",Value::Null)]);
    assert!(visible.complete && visible.data.as_array().unwrap().len() == 1, "{visible:?}");
    let uncapped = checked(&base.replace("  cap 2 by parent\n", ""));
    assert!(!uncapped.schema.required_capabilities().contains("branch-pages-v5"));
}

#[test]
fn compound_negative_membership_keeps_extra_equalities_and_all_callers() {
    let source = "table listings:\n  owner: principal\n  read <- .owner = viewer or not exists applications[listing = .id, applicant = viewer, status = 'declined']\n  online only\ntable applications:\n  listing: listings\n  applicant: principal\n  status: enum('declined', 'pending')\n  unique listing, applicant\n  read <- deny\n  online only\nquery board(c: cursor ?):\n  return listings first 10 by .id after c\n";
    let b = checked(source);
    assert!(b.schema.required_capabilities().contains("branch-pages-v5"));
    let mut e = engine(source);
    e.seed([("listings".into(),object([("id",id("a")),("owner",id("bob"))])),
        ("listings".into(),object([("id",id("b")),("owner",id("bob"))])),
        ("listings".into(),object([("id",id("c")),("owner",id("bob"))])),
        ("applications".into(),object([("id",id("x")),("listing",id("a")),("applicant",id("alice")),("status",Value::String("declined".into()))])),
        ("applications".into(),object([("id",id("y")),("listing",id("b")),("applicant",id("alice")),("status",Value::String("pending".into()))]))]).unwrap();
    let a = query(&mut e,"board","alice", &[("c",Value::Null)]);
    assert!(a.complete, "{a:?}");
    assert_eq!(a.data.as_array().unwrap().len(), 2);
    let b = query(&mut e,"board","bob", &[("c",Value::Null)]);
    assert!(b.complete && b.data.as_array().unwrap().len() == 3, "{b:?}");
}

#[test]
fn boolean_errors_name_nullable_operand_source_and_statement_position_has_own_code() {
    let source = "table flags:\n  active: bool\n  public\nquery bad(id: flags):\n  return true and flags[id].active\n";
    let d = refusal(source,"E_QUARRY_TYPE");
    assert!(d.message.contains("flags[id].active") && d.message.contains("nullable operand") && d.message.contains("schema.q:"), "{d}");
    refusal("table flags:\n  public\nmutation bad(id: flags):\n  flags[id] ! else NOT_FOUND\n  return null\n", "E_QUARRY_STATEMENT");
}

#[test]
fn private_count_uses_the_proved_immutable_parent_field_without_turning_hidden_into_zero() {
    let source = "table vendors:\n  lead: principal\n  immutable lead\n  read <- allow\n  online only\ntable badges:\n  vendor: vendors\n  public\n  online only\nview used: count badges by .vendor\n  read <- exists vendors[.vendor, lead = viewer]\n  online only\nquery capacity(vendor: vendors):\n  v = vendors[vendor] ! else NOT_FOUND\n  require v.lead = viewer else NOT_LEAD\n  return used[vendor] + 1\n";
    checked(source);
    refusal(&source.replace("  immutable lead\n", ""), "E_QUARRY_TYPE");
    refusal(&source.replace("  require v.lead = viewer else NOT_LEAD\n", ""), "E_QUARRY_TYPE");
}

#[test]
fn ordered_whole_child_deletes_silence_restrict_but_previews_and_hidden_populations_do_not() {
    let source = "table parents:\n  public\n  delete <- allow\n  online only\ntable children:\n  parent: parents\n  public\n  delete <- allow\n  cap 3 by parent\n  online only\nmutation remove(parent: parents):\n  for row in children where .parent = parent:\n    delete children[row.id]\n  delete parents[parent]\n  return null\n";
    let b = checked(source);
    assert!(!b.notes.iter().any(|n|n.code=="N_DELETE_RESTRICTED"), "{:?}", b.notes);
    let preview = checked(&source.replace("children where .parent = parent:","children where .parent = parent first 2 by .id:"));
    assert!(preview.notes.iter().any(|n|n.code=="N_DELETE_RESTRICTED"), "{:?}", preview.notes);
}

#[test]
fn capped_private_walk_admission_is_independent_of_hidden_occupancy() {
    let source = "table entries:\n  a: int\n  b: int\n  cap 9000\n  read <- .a = .b\n  online only\nquery list(c: cursor ?):\n  return entries first 10 by .id after c\n";
    let mut empty = engine(source);
    let mut hidden = engine(source);
    hidden.seed((0..20).map(|n| ("entries".into(),object([("id",id(&format!("h{n}"))), ("a",Value::Int(1)),("b",Value::Int(2))])))).unwrap();
    let a = query(&mut empty,"list","alice", &[("c",Value::Null)]);
    let b = query(&mut hidden,"list","alice", &[("c",Value::Null)]);
    assert!(!a.complete && !b.complete, "{a:?}\n{b:?}");
    assert_eq!(a.data,b.data);
    assert_eq!(a.next,b.next);
    assert_eq!(a.metered,b.metered);
}

#[test]
fn whole_caps_and_unique_enum_alternatives_do_not_ask_for_cursors() {
    for (decl, read) in [
        ("  cap 4\n", "entries first 4 by .id"),
        ("  unique owner, status\n", "entries where .owner = viewer and (.status = 'open' or .status = 'closed') first 4 by .id"),
    ] {
        let b = checked(&format!("table entries:\n  owner: principal\n  status: enum('open', 'closed')\n{decl}  public\n  online only\nquery list():\n  return {read}\n"));
        assert!(!b.notes.iter().any(|n|n.code=="N_NO_CURSOR"), "{:?}", b.notes);
    }
}

#[test]
fn unsupported_copied_scopes_print_the_same_caller_query_instead_of_a_viewer_pin() {
    let source = "table parents:\n  owner: principal\n  immutable owner\n  public\n  online only\ntable children:\n  parent: parents\n  owner: principal\n  read <- .owner = viewer\n  online only\nquery list(parent: parents, c: cursor ?):\n  return children where .parent = parent first 10 by .id after c\n";
    let b = checked(source);
    let note = b.notes.iter().find(|note|note.code=="N_NEVER_COMPLETE").unwrap();
    assert!(note.rewrite.starts_with("nearest supported query, preserving every authorized caller"),"{note}");
    let code = note.rewrite.split_once('\n').unwrap().1.split("\nHandle complete:").next().unwrap();
    checked(&format!("{}{}",source.split("query list").next().unwrap(),code));
}

#[test]
fn private_count_proof_cannot_be_reacquired_for_an_old_snapshot_after_parent_rebirth() {
    let source = "table vendors:\n  lead: principal\n  immutable lead\n  public\n  delete <- allow\n  insert <- allow\n  online only\ntable badges:\n  vendor: vendors on delete keep\n  public\n  online only\nview used: count badges by .vendor\n  read <- exists vendors[.vendor, lead = viewer]\n  online only\nmutation stale(vendor: vendors):\n  v = vendors[vendor] ! else NOT_FOUND\n  require v.lead = viewer else NOT_LEAD\n  delete vendors[vendor]\n  insert vendors { id: vendor, lead: 'bob' }\n  require exists vendors[vendor] else NOT_FOUND\n  return used[vendor] + 1\n";
    refusal(source,"E_QUARRY_TYPE");
}

#[test]
fn immutable_volatile_captures_keep_assignment_versions() {
    let source = "table entries:\n  owner: id\n  unique owner\n  immutable owner\n  public\n  insert <- allow\n  update <- allow\n  online only\nmutation change():\n  a = new\n  insert entries { owner: a }\n  old = a\n  a = new\n  update entries[owner = old] { owner: a }\n  return null\n";
    refusal(source,"E_QUARRY_IMMUTABLE");
}

#[test]
fn bounded_reservation_precedes_even_a_readable_points_private_rule_probe() {
    let source = "table secrets:\n  card: cards\n  unique card\n  read <- deny\n  online only\ntable cards:\n  owner: principal\n  read <- exists secrets[card = .id] or .owner = viewer\n  online only\ntable entries:\n  a: int\n  b: int\n  cap 8189\n  read <- .a = .b\n  online only\nquery both(card: cards, c: cursor ?):\n  selected = cards[card] ! else NOT_FOUND\n  return entries first 10 by .id after c\n";
    let mut a = engine(source);
    let mut b = engine(source);
    for e in [&mut a,&mut b] { e.seed([("cards".into(),object([("id",id("card")),("owner",id("alice"))]))]).unwrap(); }
    b.seed([("secrets".into(),object([("id",id("secret")),("card",id("card"))]))]).unwrap();
    let left = query(&mut a,"both","alice", &[("card",id("card")),("c",Value::Null)]);
    let right = query(&mut b,"both","alice", &[("card",id("card")),("c",Value::Null)]);
    assert_eq!(left.complete,right.complete);
    assert_eq!(left.data,right.data);
    assert_eq!(left.next,right.next);
}

#[test]
fn external_ir_deletes_cannot_activate_unbounded_dormant_actions() {
    use snapback4_core::ir::*;
    let b = checked("table parents:\n  public\n  online only\ntable children:\n  parent: parents on delete cascade\n  public\n  online only\n");
    let delete = Stmt::Delete { table: "parents".into(), key: Expr::Literal(id("p")) };
    let program: Program = serde_json::from_value(serde_json::json!({"name":"external","kind":"job","args":{},"body":[]})).unwrap();
    let program = Program { body: vec![Stmt::Return(Expr::Block { body: vec![delete], value: Box::new(Expr::Literal(Value::Null)) })], ..program };
    let error = snapback4_core::engine::admission::check(&b.schema,&program).unwrap_err();
    assert!(error.to_string().contains("E_CASCADE_BOUND"),"{error}");
}

#[test]
fn external_bounded_predicates_cannot_smuggle_reads_into_the_fixed_draw() {
    use snapback4_core::ir::*;
    let b = checked("table entries:\n  a: int\n  b: int\n  cap 2\n  read <- .a = .b\n  online only\nquery list(c: cursor ?):\n  return entries first 2 by .id after c\n");
    let merges = body_merges(&b.programs[0].program.body);
    let mut lane = merges[0].lanes[0].clone();
    assert!(snapback4_core::engine::rules::bounded_branch(&b.schema,&lane));
    lane.scan.filter = Some(Box::new(Expr::Exists(Read { site: "external".into(), table: "entries".into(), index: "byId".into(), key: vec![Expr::Literal(id("hidden"))], provenance: KeyProvenance::Shape })));
    assert!(!snapback4_core::engine::rules::bounded_branch(&b.schema,&lane));
}

#[test]
fn immutable_compound_operands_resolve_in_their_capture_time_environment() {
    let source = "table entries:\n  code: int\n  unique code\n  immutable code\n  public\n  update <- allow\n  online only\nmutation change():\n  n = 1\n  saved = n + 1\n  n = 2\n  update entries[code = saved] { code: n + 1 }\n  return null\n";
    refusal(source,"E_QUARRY_IMMUTABLE");
}

#[test]
fn snapshot_identity_cannot_resolve_an_opaque_branch_key_again_at_the_write() {
    let source = "table entries:\n  frozen: int\n  immutable frozen\n  public\n  update <- allow\n  online only\nmutation change(a: entries, b: entries, flag: bool):\n  k = a\n  if flag:\n    k = b\n  s = entries[k] ! else NOT_FOUND\n  k = a\n  update entries[k] { frozen: s.frozen }\n  return null\n";
    immutable_note(source);
}

#[test]
fn historical_vacancy_admission_requires_the_actual_unique_point() {
    let source = "table old:\n  item: entries\n  unique item\n  read <- deny\n  online only\ntable holds:\n  item: entries\n  principal: principal\n  copied: entries\n  unique item, principal\n  read <- deny\n  online only\ntable entries:\n  read <- not exists old[item = .id] or not exists holds[item = .id, principal = viewer, copied = .id]\n  online only\nquery available(c: cursor ?):\n  return entries first 10 by .id after c\n";
    let mut b = checked(source);
    let lane = snapback4_core::ir::body_merges(&b.programs[0].program.body)[0].lanes.iter().find(|lane|lane.vacancy()).unwrap().clone();
    assert!(snapback4_core::engine::rules::legacy_vacancy_branch(&b.schema,&lane));
    // Source refuses a nonunique rule point already. Core compatibility must
    // independently decline the same externally supplied schema shape.
    for index in b.schema.tables.get_mut("old").unwrap().indexes.values_mut().filter(|index|index.columns()==vec!["item".to_owned()]) { index.unique = false; }
    assert!(!snapback4_core::engine::rules::legacy_vacancy_branch(&b.schema,&lane));
    let compound = checked(&source.replace("not exists old[item = .id] or ",""));
    assert!(compound.schema.required_capabilities().contains("branch-pages-v5"));
    assert!(!compound.notes.iter().any(|note|note.code=="N_NEVER_COMPLETE"));
}

#[test]
fn admitted_capped_private_walks_hide_candidate_and_witness_meter_counts() {
    for rule in [".a = .b and exists grants[viewer]", "exists grants[viewer]"] {
        let source = format!("table grants:\n  who: principal\n  unique who\n  read <- deny\n  online only\ntable entries:\n  a: int\n  b: int\n  cap 20\n  read <- {rule}\n  online only\nquery list(c: cursor ?):\n  return entries first 5 by .id after c\n");
        let mut empty = engine(&source);
        let mut hidden = engine(&source);
        hidden.seed((0..20).map(|n| ("entries".into(),object([("id",id(&format!("h{n}"))),("a",Value::Int(1)),("b",Value::Int(1))])))).unwrap();
        let a = query(&mut empty,"list","alice", &[("c",Value::Null)]);
        let b = query(&mut hidden,"list","alice", &[("c",Value::Null)]);
        assert_eq!(a.data,b.data,"{rule}");
        assert_eq!(a.complete,b.complete,"{rule}");
        assert_eq!(a.next,b.next,"{rule}");
        assert_eq!(a.metered,b.metered,"{rule}");
    }
}

#[test]
fn future_opening_caps_do_not_supply_a_physical_population_bound() {
    let source = "table entries:\n  opens: time ?\n  a: int\n  b: int\n  not before .opens\n  cap 2\n  read <- .a = .b\n  online only\nquery list(c: cursor ?):\n  return entries first 2 by .id after c\n";
    let b = checked(source);
    assert!(!b.schema.required_capabilities().contains("branch-pages-v5"));
    assert!(b.notes.iter().any(|note|note.code=="N_NEVER_COMPLETE"));
}

#[test]
fn oversized_caps_do_not_shadow_existing_uniform_grants() {
    let source = "table grants:\n  who: principal\n  unique who\n  read <- .who = viewer\n  online only\ntable entries:\n  cap 5000\n  read <- exists grants[viewer]\n  online only\nquery list(c: cursor ?):\n  return entries first 10 by .id after c\n";
    let b = checked(source);
    assert!(!b.schema.required_capabilities().contains("branch-pages-v5"));
    let mut e = engine(source);
    e.seed([("grants".into(),object([("id",id("g")),("who",id("alice"))]))]).unwrap();
    assert!(query(&mut e,"list","alice", &[("c",Value::Null)]).complete);
}

#[test]
fn lean_keeps_sync_presence_and_names_unmodelled_readthrough() {
    use snapback4_lang::emit::lean::{lean,LeanError};
    let source = "table entries:\n  owner: principal\n  cap 2\n  read <- .owner = viewer\n  sync\n  online only\nquery list(c: cursor ?):\n  return entries first 2 by .owner after c\n";
    assert!(compile(&[("schema.q".into(),source.into())]).diagnostics.iter().any(|why|why.code=="E_SYNC"),"dual residency is already refused");
    let module = lean(&[("schema.q".into(),source.replace("  online only\n", ""))]).unwrap();
    assert_eq!(module.schema["tables"][0]["onlineOnly"],false);
    let source = "table parents:\n  public\n  online only\ntable children:\n  parent: parents\n  immutable parent\n  read through .parent\n  online only\nquery child(id: children):\n  return children[id]\n";
    match lean(&[("schema.q".into(),source.into())]) {
        Err(LeanError::Unsupported(why)) => assert_eq!(why.reason,"table-through"),
        Err(why) => panic!("read-through must be named unsupported: {why:?}"),
        Ok(module) => panic!("read-through was silently accepted: {}",module.schema),
    }
}

#[test]
fn lifetime_free_external_rule_ties_still_fetch_one_raw_witness() {
    use snapback4_core::schema::Constraint;
    let source = "table logs:\n  msg: int\n  unique msg\n  read <- deny\ntable entries:\n  msg: int\n  a: int\n  b: int\n  cap 2\n  read <- .a = .b and exists logs[msg = .msg]\nquery list(c: cursor ?):\n  return entries first 2 by .id after c\n";
    // Source points require replica-independent identity.
    refusal(&source.replace("  unique msg", "  by byMsg: msg"), "E_QUARRY_POINT_KEY");
    let mut b = checked(source);
    // Raw rule IR also permits a full plain nonunique existence key. It
    // checks a single raw witness, not each tied row's read rule.
    assert!(!b.schema.tables["entries"].residency.online_only);
    let logs = b.schema.tables.get_mut("logs").unwrap();
    for index in logs.indexes.values_mut().filter(|i| i.columns() == ["msg"]) { index.unique = false; }
    logs.constraints.retain(|c| !matches!(c, Constraint::Unique { index } if logs.indexes[index].columns() == ["msg"]));
    let lane = snapback4_core::ir::body_merges(&b.programs[0].program.body)[0].lanes[0].clone();
    assert!(snapback4_core::engine::rules::bounded_branch(&b.schema, &lane));
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed((0..1000).map(|n| ("logs".into(), object([("id",id(&format!("w{n}"))), ("msg",Value::Int(1))]))).chain([
        ("entries".into(),object([("id",id("a")),("msg",Value::Int(1)),("a",Value::Int(1)),("b",Value::Int(1))])),
        ("entries".into(),object([("id",id("b")),("msg",Value::Int(2)),("a",Value::Int(1)),("b",Value::Int(2))])),
    ])).unwrap();
    // Fixed price 6 plus sentinel: enumerating the thousand hidden witnesses
    // would exhaust this pool. One indexed raw witness completes.
    e.set_ceilings(snapback4_core::Ceilings { examined: 7, ..Default::default() });
    let r = query(&mut e,"list","alice", &[("c",Value::Null)]);
    assert!(r.complete && r.data.as_array().unwrap().len() == 1, "{r:?}");
}

#[test]
fn dormant_descendants_are_not_misreported_as_cycles_below_capped_edges() {
    use snapback4_core::ir::*;
    for edge in ["child: children on delete cascade", "child: children ? on delete set null"] {
        let source = format!("table parents:\n  public\n  online only\ntable children:\n  parent: parents on delete cascade\n  cap 2 by parent\n  public\n  online only\ntable grandchildren:\n  {edge}\n  public\n  online only\n");
        let b = checked(&source);
        assert!(b.notes.iter().any(|n| n.code == "N_CASCADE_DORMANT"));
        assert!(b.schema.deletion_cycle().is_none());
        assert!(b.schema.delete_reservation("parents").is_none());
        assert!(snapback4_core::schema::validate(&b.schema).is_empty());
        Engine::memory(b.schema.clone(), []).unwrap();
        refusal(&source.replace("table parents:\n", "table parents:\n  delete <- allow\n"), "E_CASCADE_BOUND");
        let mut program: Program = serde_json::from_value(serde_json::json!({"name":"external","kind":"job","args":{},"body":[]})).unwrap();
        program.body.push(Stmt::Delete { table: "parents".into(), key: Expr::Literal(id("p")) });
        assert!(snapback4_core::engine::admission::check(&b.schema, &program).unwrap_err().to_string().contains("E_CASCADE_BOUND"));
    }
    let cycle = "table a:\n  b: b on delete cascade\n  public\n  online only\ntable b:\n  a: a on delete cascade\n  public\n  online only\n";
    refusal(cycle,"E_REFERENCE_ACTION");
}

const IMMUTABLE: &str = "table entries:\n  owner: principal\n  frozen: text\n  token: id\n  at: time\n  body: text\n  immutable owner, frozen, token, at\n  public\n  insert <- allow\n  update <- allow\n  online only\n";

#[test]
fn uncertain_immutable_values_keep_runtime_equality_and_name_the_column() {
    let source = format!("{IMMUTABLE}mutation save(e: entries, frozen: text, token: id, at: time):\n  upsert entries[e] {{ owner: viewer, frozen, token, at, body: 'saved' }}\n  return null\n");
    let b = checked(&source);
    let notes = b.notes.iter().filter(|d|d.code == "N_IMMUTABLE_PATCH").collect::<Vec<_>>();
    assert_eq!(notes.len(),4);
    let owner = notes.iter().find(|d|d.message.contains("entries.owner")).unwrap();
    assert!(owner.message.contains("on conflict, this upsert") && owner.message.contains("viewer must be the original owner"),"{owner}");
    assert!(owner.rewrite.contains("omit owner from the patch"));
    let mut e = engine(&source);
    e.seed([("entries".into(),object([("id",id("e")),("owner",id("alice")),("frozen",Value::String("fixed".into())),("token",id("t")),("at",Value::Int(5)),("body",Value::String("old".into()))]))]).unwrap();
    let args = || [("e".into(),id("e")),("frozen".into(),Value::String("fixed".into())),("token".into(),id("t")),("at".into(),Value::Int(5))].into();
    let same = e.mutate("save",Some("same"),Context::new("alice",args())).unwrap();
    assert!(matches!(same.state,snapback4_core::WriteState::Sent { .. }),"{same:?}");
    let different = e.mutate("save",Some("different"),Context::new("bob",args())).unwrap();
    assert!(matches!(different.state,snapback4_core::WriteState::Failed { .. }),"{different:?}");
}

#[test]
fn clocks_and_fresh_ids_refuse_but_reused_insert_values_are_quiet() {
    for body in ["update entries[e] { token: new }", "token = new\n  update entries[e] { token }", "at = now\n  update entries[e] { at }", "update entries[e] { at: now + 1s }"] {
        refusal(&format!("{IMMUTABLE}mutation bad(e: entries):\n  {body}\n  return null\n"),"E_QUARRY_IMMUTABLE");
    }
    for value in ["'first'", "'second'"] {
        let source = format!("{IMMUTABLE}mutation local():\n  e = insert entries {{ owner: viewer, frozen: 'first', token: new, at: now, body: 'x' }}\n  update entries[e.id] {{ frozen: {value} }}\n  return null\n");
        if value == "'first'" { quiet(&source); } else { refusal(&source,"E_QUARRY_IMMUTABLE"); }
    }
    quiet(&format!("{IMMUTABLE}mutation local():\n  token = new\n  at = now\n  e = insert entries {{ owner: viewer, frozen: 'first', token, at, body: 'x' }}\n  update entries[e.id] {{ token, at }}\n  return null\n"));
}

#[test]
fn other_writers_and_conditional_inserts_do_not_constrain_historical_storage() {
    let writer = "mutation add():\n  return insert entries { owner: viewer, frozen: 'first', token: new, at: now, body: 'x' }\n";
    immutable_note(&format!("{IMMUTABLE}{writer}mutation change(e: entries):\n  update entries[e] {{ frozen: 'second' }}\n  return null\n"));
    immutable_note(&format!("{IMMUTABLE}mutation conditional(e: id):\n  insert entries {{ id: e, owner: viewer, frozen: 'first', token: new, at: now, body: 'x' }} if absent\n  update entries[e] {{ frozen: 'second' }}\n  return null\n"));
    immutable_note(&format!("{IMMUTABLE}mutation reuse(e: entries):\n  token = new\n  insert entries {{ owner: viewer, frozen: 'first', token, at: now, body: 'x' }}\n  update entries[e] {{ token }}\n  return null\n"));
}

#[test]
fn immutable_changes_against_always_hidden_targets_are_notes_not_false_refusals() {
    let hidden = IMMUTABLE.replace("  public\n", "  read <- deny\n");
    for patch in ["at: now", "token: new", "owner: viewer"] {
        immutable_note(&format!("{hidden}mutation change(e: entries):\n  update entries[e] {{ {patch} }}\n  return null\n"));
    }
    // Jobs bypass the read rule and still have to preserve immutable values.
    refusal(&format!("{hidden}job change():\n  for e in entries:\n    update entries[e.id] {{ at: now }}\n"),"E_QUARRY_IMMUTABLE");
}

#[test]
fn prior_writes_may_already_have_stored_the_invocations_clock() {
    immutable_note(&format!("{IMMUTABLE}mutation local():\n  e = insert entries {{ owner: viewer, frozen: 'first', token: new, at: now, body: 'x' }}\n  update entries[e.id] {{ body: 'changed' }}\n  update entries[e.id] {{ at: now }}\n  return null\n"));
}

#[test]
fn opaque_mutable_insert_fields_do_not_erase_immutable_equality() {
    for target in ["key", "e.id"] {
        let source = format!("{IMMUTABLE}mutation local(body: text <=100):\n  key = new\n  e = insert entries {{ id: key, owner: viewer, frozen: 'first', token: new, at: now, body: lower(body) }}\n  update entries[{target}] {{ at: now }}\n  return null\n");
        quiet(&source);
        refusal(&source.replace("{ at: now }", "{ frozen: 'second' }"),"E_QUARRY_IMMUTABLE");
    }
}

#[test]
fn enclosing_writes_prevent_false_clock_refusals_in_branches_loops_and_helpers() {
    let insert = "insert entries { id: key, owner: viewer, frozen: 'first', token: new, at: now, body: 'x' }";
    for nested in ["if flag:\n    update entries[key] { at: now }", "for i in range(0, 2):\n    update entries[key] { at: now }", "resave(key)"] {
        let source = format!("{IMMUTABLE}fn resave(e: entries):\n  update entries[e] {{ at: now }}\n  return null\nmutation local(key: id, flag: bool):\n  {insert}\n  {nested}\n  return null\n");
        immutable_note(&source);
    }
}

#[test]
fn opaque_compound_key_siblings_do_not_erase_a_pinned_column_proof() {
    let base = "table entries:\n  code: int\n  slot: text <=30\n  unique code, slot\n  immutable code\n  public\n  update <- allow\n  online only\n";
    for code in ["1", "1 + 0", "2"] {
        let source = format!("{base}mutation change(slot: text <=30):\n  update entries[code = 1, slot = lower(slot)] {{ code: {code} }}\n  return null\n");
        if code == "2" { refusal(&source,"E_QUARRY_IMMUTABLE"); } else { quiet(&source); }
    }
}
