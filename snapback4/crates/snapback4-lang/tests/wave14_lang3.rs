use snapback4_lang::{compile, bind::Bound};
fn checked(source: &str) -> Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{source}\n{:#?}", b.diagnostics);
    b
}
fn refuses(source: &str, code: &str) {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.iter().any(|d| d.code == code), "{source}\n{:?}", b.diagnostics);
}
#[test]
fn enum_guards_narrow_alternatives_and_surviving_paths() {
    let base = "table t:\n  status: enum('a', 'b')\n  public\n  insert <- allow\n  online only\n";
    for guard in ["require x = 'a' or x = 'b' else NO", "if x = 'c':\n    return null", "if not (x = 'a' or x = 'b'):\n    return null"] {
        checked(&format!("{base}mutation m(x: enum('a', 'b', 'c')):\n  {guard}\n  return insert t {{ status: x }}\n"));
    }
    refuses(&format!("{base}mutation m(x: enum('a', 'b', 'c'), ok: bool):\n  require x = 'a' or ok else NO\n  return insert t {{ status: x }}\n"), "E_QUARRY_TYPE");
    refuses(&format!("{base}mutation m(x: enum('a', 'b', 'c')):\n  y = x\n  require y = 'a' or y = 'b' else NO\n  y = x\n  return insert t {{ status: y }}\n"), "E_QUARRY_TYPE");
}
#[test]
fn private_immutable_clock_conflicts_require_proven_readability() {
    let base = "table t:\n  owner: principal\n  at: time\n  n: int\n  unique owner\n  immutable owner, at\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  online only\n";
    refuses(&format!("{base}mutation m():\n  return upsert t[viewer] {{ at: now, n: 1 }}\n"), "E_QUARRY_IMMUTABLE");
    for (args,key,value) in [("other: principal", "other", "now"), ("at: time", "viewer", "at")] {
        let b = checked(&format!("{base}mutation m({args}):\n  return upsert t[{key}] {{ at: {value}, n: 1 }}\n"));
        assert!(b.notes.iter().any(|n| n.code == "N_IMMUTABLE_PATCH"));
    }
}
#[test]
fn immutable_parent_derivation_is_an_intentional_equality_guard() {
    let base = "table parents:\n  frozen: int\n  immutable frozen\n  public\n  online only\ntable children:\n  parent: parents\n  frozen: int\n  n: int\n  unique parent\n  immutable parent, frozen\n  public\n  insert <- allow\n  update <- allow\n  online only\nmutation m(p: parents):\n  row = parents[p] ! else NOT_FOUND\n  return upsert children[p] { frozen: row.frozen, n: 1 }\n";
    assert!(!checked(base).notes.iter().any(|n| n.code == "N_IMMUTABLE_PATCH"));
    assert!(checked(&base.replace("  immutable frozen\n", "")).notes.iter().any(|n| n.code == "N_IMMUTABLE_PATCH"));
}
#[test]
fn reserved_words_are_named_at_the_declaration() {
    for word in ["by", "update"] {
        let b = compile(&[("schema.q".into(),format!("table t:\n  {word}: text\n"))]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_RESERVED" && d.message.contains(&format!("`{word}`"))));
    }
    let b = compile(&[("schema.q".into(), "query q(device: text):\n  return device\n".into())]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_RESERVED" && d.message.contains("`device`")));
    let sheet = snapback4_lang::guide::card("cheatsheet").unwrap();
    for word in ["by", "update", "device", "commit", "now", "new"] { assert!(sheet.contains(word)); }
}
const HELD: &str = "table observations:\n  observer: principal\n  teacher: principal\n  held: bool\n  read <- .observer = viewer or (.teacher = viewer and .held = true)\n  online only\ntable followUps:\n  observation: observations\n  observer: principal\n  teacher: principal\n  note: text\n  read <- .observer = viewer or (.teacher = viewer and exists observations[.observation, held = true])\n  online only\nquery page(observationId: observations):\n  o = observations[observationId]\n  if o != null and o.observer = viewer:\n    return followUps where .observation = observationId and .observer = viewer first 50 by .id\n  if o != null and o.held = true:\n    return followUps where .observation = o.id and .teacher = o.teacher first 50 by .id\n  return followUps where .observation = observationId and .observer = viewer and .teacher = viewer first 50 by .id\n";
#[test]
fn held_parent_and_surviving_audience_branch_prove_the_page() {
    use snapback4_core::{Context, Engine, Value, value::object};
    let b = checked(HELD);
    assert!(!b.notes.iter().any(|n| matches!(n.code.as_str(),"N_NEVER_COMPLETE"|"N_CONDITIONAL_COMPLETE")), "{:?}", b.notes);
    let mut e = Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let id = |s:&str| Value::Id(s.into());
    e.seed([("observations".into(),object([("id",id("o")),("observer",id("alice")),("teacher",id("bob")),("held",Value::Bool(true))])),
        ("followUps".into(),object([("id",id("f")),("observation",id("o")),("observer",id("alice")),("teacher",id("bob")),("note",Value::String("visible".into()))])),
        ("followUps".into(),object([("id",id("hidden")),("observation",id("o")),("observer",id("other")),("teacher",id("other")),("note",Value::String("private".into()))]))]).unwrap();
    for viewer in ["alice","bob","stranger"] {
        let answer=e.query("page",Context::new(viewer,[("observationId".into(),id("o"))].into())).unwrap();
        assert!(answer.complete,"{viewer}: {answer:?}");
        assert_eq!(answer.data.as_array().unwrap().len(),usize::from(viewer!="stranger"));
    }
}
#[test]
fn a_readable_parent_alone_never_proves_a_copied_child_audience() {
    let no_guard=HELD.replace("  if o != null and o.observer = viewer:\n    return followUps where .observation = observationId and .observer = viewer first 50 by .id\n","");
    assert!(checked(&no_guard).notes.iter().any(|n| n.code=="N_NEVER_COMPLETE"),"an observer can hold the parent while its teacher is someone else");
    let wrong_key=HELD.replace(".observation = o.id and .teacher = o.teacher", ".observation = observationId and .teacher = o.observer");
    assert!(checked(&wrong_key).notes.iter().any(|n| n.code=="N_NEVER_COMPLETE"));
}
#[test]
fn sorted_complete_capped_groups_preserve_population_but_slices_do_not() {
    let source="table rows:\n  owner: principal\n  n: int\n  cap 3 by owner\n  read <- .owner = viewer\n  update <- .owner = viewer\n  sync to .owner\nmutation m():\n  population = rows where .owner = viewer\n  ordered = sort(population, 'n')\n  for row in ordered:\n    update rows[row.id] { n: 1 }\n  return null\n";
    checked(source);
    refuses(&source.replace("sort(population, 'n')","slice(sort(population, 'n'), 0, 1)"),"E_STRUCTURAL_FANOUT");
}
#[test]
fn proven_rosters_survive_unrelated_writes_but_not_roster_changes() {
    let source="table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  delete <- allow\n  online only\ntable docs:\n  owner: principal\n  n: int\n  read <- .owner = viewer or exists staff[viewer]\n  update <- exists staff[viewer]\n  online only\ntable pictures:\n  doc: docs\n  unique doc\n  read <- exists staff[viewer]\n  online only\nmutation m(d: docs):\n  require exists staff[viewer] else NO\n  update docs[d] { n: 1 }\n  if exists pictures[doc = d]:\n    return true\n  return false\n";
    let b=checked(source);
    assert!(!b.notes.iter().any(|n|matches!(n.code.as_str(),"N_UNREADABLE_PROBE"|"N_LOOKUP_HIDDEN")),"{:?}",b.notes);
    let role=source.replace("  unique principal\n", "  role: enum('clerk','other')\n  unique principal\n")
        .replace("exists staff[viewer]", "exists staff[viewer, role = 'clerk']");
    assert!(!checked(&role).notes.iter().any(|n|matches!(n.code.as_str(),"N_UNREADABLE_PROBE"|"N_LOOKUP_HIDDEN")));
    let after_delete=source.replace("  update <- exists staff[viewer]\n", "  update <- exists staff[viewer]\n  delete <- exists staff[viewer]\n")
        .replace("  update docs[d] { n: 1 }", "  update docs[d] { n: 1 }\n  if exists docs[d]:\n    delete docs[d]");
    assert!(!checked(&after_delete).notes.iter().any(|n|n.code=="N_UNREADABLE_PROBE"));
    let b=checked(&source.replace("  update docs[d] { n: 1 }","  delete staff[viewer]"));
    assert!(b.notes.iter().any(|n|n.code=="N_UNREADABLE_PROBE"));
    for revoke in ["base revoke", "base { ...revoke }"] {
        let shaped=source.replace("mutation m(d: docs):", "shape revoke = { gone: delete staff[viewer] }\nmutation m(d: docs):")
            .replace("  update docs[d] { n: 1 }", &format!("  base = {{ n: 1 }}\n  revoked = {revoke}"));
        assert!(checked(&shaped).notes.iter().any(|n|n.code=="N_UNREADABLE_PROBE"));
    }
}
#[test]
fn private_parent_cap_rewrite_keeps_all_original_audiences() {
    let source="table listings:\n  public\n  online only\ntable applications:\n  listing: listings\n  applicant: principal\n  status: enum('pending','finalist')\n  unique listing, applicant\n  read <- .applicant = viewer\n  online only\ntable visits:\n  listing: listings\n  owner: principal\n  landlord: principal\n  applicant: principal\n  read <- .owner = viewer or .landlord = viewer or (.applicant = viewer and exists applications[.listing, .applicant, status = 'finalist'])\n  online only\nquery visitsFor(listing: listings):\n  return visits where .listing = listing first 100 by .id\n";
    let b=checked(source);
    let note=b.notes.iter().find(|n|n.code=="N_NEVER_COMPLETE").unwrap();
    assert!(note.rewrite.contains("cap 100 by listing")&&note.rewrite.contains("same audience"),"{note}");
    let fixed=source.replace("table visits:\n","table visits:\n  cap 100 by listing\n");
    let b=checked(&fixed);
    assert!(!b.notes.iter().any(|n|matches!(n.code.as_str(),"N_NEVER_COMPLETE"|"N_CONDITIONAL_COMPLETE")),"{:?}",b.notes);
    use snapback4_core::{Context,Engine,Value,value::object};
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let id=|s:&str|Value::Id(s.into());
    e.seed([("listings".into(),object([("id",id("l"))])),
        ("applications".into(),object([("id",id("a")),("listing",id("l")),("applicant",id("applicant")),("status",Value::String("finalist".into()))])),
        ("visits".into(),object([("id",id("v")),("listing",id("l")),("owner",id("owner")),("landlord",id("landlord")),("applicant",id("applicant"))]))]).unwrap();
    for viewer in ["owner","landlord","applicant","outsider"] {
        let answer=e.query("visitsFor",Context::new(viewer,[("listing".into(),id("l"))].into())).unwrap();
        assert!(answer.complete,"{viewer}: {answer:?}");
        assert_eq!(answer.data.as_array().unwrap().len(),usize::from(viewer!="outsider"));
    }
}
#[test]
fn mixed_key_and_sync_repairs_are_literal_source() {
    let b=compile(&[("schema.q".into(),"table roles:\n  team: text <=40\n  principal: principal\n  unique team, principal\n  public\nquery q(team: text <=40):\n  return exists roles[team, principal = viewer]\n".into())]);
    let d=b.diagnostics.iter().find(|d|d.code=="E_QUARRY_POSITIONAL_SCAN").unwrap();
    assert!(d.message.contains("do not mix positional and named keys"),"{d}");
    assert_eq!(d.source_rewrite.as_deref(),Some("roles[team = team, principal = viewer]"));
    let fixed="table roles:\n  team: text <=40\n  principal: principal\n  unique team, principal\n  public\nquery q(team: text <=40):\n  return exists roles[team = team, principal = viewer]\n";
    checked(fixed);
    let b=compile(&[("schema.q".into(),"table t:\n  owner: principal\n  helper: principal\n  at: time\n  read <- .owner = viewer or .helper = viewer\n  sync last 10 by .at\n".into())]);
    let d=b.diagnostics.iter().find(|d|d.code=="E_SYNC").unwrap();
    assert!(d.rewrite.contains("replace the whole sync line with:\n  sync\n"),"{d}");
    checked("table t:\n  owner: principal\n  helper: principal\n  at: time\n  read <- .owner = viewer or .helper = viewer\n  sync\n");
}

#[test]
fn effectful_rebinding_drops_the_old_roster_key() {
    let source="table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable docs:\n  owner: principal\n  n: int\n  public\n  update <- allow\n  online only\ntable pictures:\n  principal: principal\n  unique principal\n  read <- exists staff[.principal]\n  online only\nmutation m(d: docs):\n  who = viewer\n  require exists staff[principal = who] else NO\n  who = (update docs[d] { n: 1 }).owner ! else NOT_FOUND\n  if not exists pictures[principal = who]:\n    return true\n  return false\n";
    assert!(checked(source).notes.iter().any(|n|n.code=="N_UNREADABLE_PROBE"));
}
#[test]
fn captured_child_pages_decline_straight_line_and_branch_rebinding() {
    let declarations=HELD.split("query page").next().unwrap();
    for assign in ["t = other", "if change:\n    t = other"] {
        let source=format!("{declarations}query page(observationId: observations, other: principal, change: bool):\n  o = observations[observationId]\n  t = viewer\n  require t = viewer else NO\n  {assign}\n  if o != null and o.held = true:\n    return followUps where .observation = o.id and .teacher = t first 50 by .id\n  return followUps where .observation = observationId and .observer = viewer first 50 by .id\n");
        assert!(checked(&source).notes.iter().any(|n|matches!(n.code.as_str(),"N_NEVER_COMPLETE"|"N_CONDITIONAL_COMPLETE")),"{source}");
    }
}
#[test]
fn staff_union_audience_repair_unambiguously_prints_bare_sync() {
    let source="table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable harvests:\n  grower: principal\n  read <- .grower = viewer or exists staff[viewer]\n  sync to .grower\n";
    let b=compile(&[("schema.q".into(),source.into())]);
    let d=b.diagnostics.iter().find(|d|d.code=="E_SYNC").unwrap();
    assert!(d.rewrite.starts_with("replace the whole sync line with:\n  sync\n"),"{d}");
    checked(&source.replace("sync to .grower","sync"));
}
#[test]
fn second_cascading_parent_names_the_edge_design_alternative() {
    let b=compile(&[("schema.q".into(),"table a:\n  public\n  delete <- allow\n  online only\ntable b:\n  public\n  delete <- allow\n  online only\ntable children:\n  a: a on delete cascade\n  b: b on delete cascade\n  public\n  online only\n".into())]);
    let d=b.diagnostics.iter().find(|d|d.code=="E_CASCADE_BOUND").unwrap();
    assert!(d.rewrite.contains("make one edge `restrict` or drop the column"),"{d}");
    assert!(!d.rewrite.contains("Heap =")&&d.details.as_deref().is_some_and(|s|s.contains("Heap =")));
}
#[test]
fn the_actual_pre_wave_private_composite_upsert_refuses_only_the_changing_clock() {
    let source=include_str!("fixtures/wave14-p18.q");
    refuses(source,"E_QUARRY_IMMUTABLE");
    let mutable_only=source.replace("emoji, at: now", "emoji");
    assert!(!checked(&mutable_only).notes.iter().any(|n|n.code=="N_IMMUTABLE_PATCH"));
    let uncertain=source.replace("mutation react(post: posts, emoji: text 1..20)","mutation react(post: posts, emoji: text 1..20, at: time)")
        .replace("emoji, at: now", "emoji, at");
    assert!(checked(&uncertain).notes.iter().any(|n|n.code=="N_IMMUTABLE_PATCH"));
}

#[test]
fn lookup_and_reference_advice_follow_the_exact_successful_point() {
    let source="table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable docs:\n  owner: principal\n  n: int\n  read <- .owner = viewer\n  update <- exists staff[viewer]\n  online only\nmutation m(d: docs):\n  require exists staff[viewer] else NO\n  update docs[d] { n: 1 }\n  return null\n";
    assert!(checked(source).notes.iter().any(|n|n.code=="N_LOOKUP_HIDDEN"));
    let guarded=source.replace("  update docs[d]", "  require exists docs[d] else NOT_FOUND\n  update docs[d]");
    assert!(!checked(&guarded).notes.iter().any(|n|n.code=="N_LOOKUP_HIDDEN"));
    for guard in ["row = docs[d] ! else NOT_FOUND", "require exists docs[id = d, owner = viewer] else NOT_FOUND"] {
        let exact=guarded.replace("require exists docs[d] else NOT_FOUND",guard);
        assert!(!checked(&exact).notes.iter().any(|n|n.code=="N_LOOKUP_HIDDEN"));
    }
    let wrong=guarded.replace("m(d: docs)", "m(d: docs, other: docs)")
        .replace("require exists docs[d]", "require exists docs[other]");
    assert!(checked(&wrong).notes.iter().any(|n|n.code=="N_LOOKUP_HIDDEN"));
    let rebound=guarded.replace("m(d: docs)", "m(d: docs, other: docs)")
        .replace("  require exists docs[d]", "  key = d\n  require exists docs[key]")
        .replace("  update docs[d]", "  key = other\n  update docs[key]");
    assert!(checked(&rebound).notes.iter().any(|n|n.code=="N_LOOKUP_HIDDEN"));
    let nested=guarded.replace("update docs[d] { n: 1 }", "update docs[d] { n: (update docs[d] { n: 2 }).n ?? 0 }");
    assert!(checked(&nested).notes.iter().any(|n|n.code=="N_LOOKUP_HIDDEN"));
    for later in ["update docs[other] { n: 2 }", "key = other\n  update docs[key] { n: 2 }", "update docs[other] { n: (update docs[other] { n: 2 }).n ?? 0 }"] {
        let two=guarded.replace("m(d: docs)", "m(d: docs, other: docs)")
            .replace("  require exists docs[d]", "  key = d\n  require exists docs[key]")
            .replace("  update docs[d]", "  update docs[key]")
            .replace("  return null", &format!("  {later}\n  return null"));
        let b=checked(&two);
        let notes=b.notes.iter().filter(|n|n.code=="N_LOOKUP_HIDDEN").collect::<Vec<_>>();
        assert_eq!(notes.len(),1,"{two}\n{:?}",b.notes);
        let line=two.lines().enumerate().filter(|(_,line)|line.contains("update docs[")).last().unwrap().0+1;
        assert_eq!(notes[0].site.line as usize,line,"the note must name the later unguarded write");
    }
    let refs="table parents:\n  n: int\n  public\n  update <- allow\n  online only\ntable children:\n  parent: parents\n  public\n  insert <- allow\n  online only\nmutation m(p: parents):\n  return insert children { parent: p }\n";
    assert!(checked(refs).notes.iter().any(|n|n.code=="N_REFERENCE_UNCHECKED"));
    let updated=refs.replace("  return insert", "  update parents[p] { n: 1 }\n  return insert");
    assert!(!checked(&updated).notes.iter().any(|n|n.code=="N_REFERENCE_UNCHECKED"));
    let helper=refs.replace("mutation m(p: parents):", "fn touch(p: parents):\n  update parents[p] { n: 1 }\n  return null\nmutation m(p: parents):")
        .replace("  return insert", "  touch(p)\n  return insert");
    assert!(!checked(&helper).notes.iter().any(|n|n.code=="N_REFERENCE_UNCHECKED"));
    let conditional=helper.replace("touch(p: parents)","touch(p: parents, ok: bool)")
        .replace("  update parents[p] { n: 1 }", "  if ok:\n    update parents[p] { n: 1 }")
        .replace("m(p: parents)","m(p: parents, ok: bool)").replace("  touch(p)","  touch(p, ok)");
    assert!(checked(&conditional).notes.iter().any(|n|n.code=="N_REFERENCE_UNCHECKED"));
}
