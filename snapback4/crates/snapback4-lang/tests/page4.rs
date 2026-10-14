use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::compile;
use std::collections::BTreeMap;

const UNION: &str = include_str!("fixtures/page4-union.q");
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn setup() -> Engine {
    let b = compile(&[("schema.q".into(), UNION.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(!b.notes.iter().any(|n| n.code == "N_NEVER_COMPLETE"), "{:?}", b.notes);
    assert!(b.programs.iter().all(|p| snapback4_core::ir::body_merges(&p.program.body).iter().any(|m| m.branches())), "{:?}", b.programs);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let mut rows = vec![("members".into(), object([("id",id("m")), ("group",Value::Int(2)), ("principal",id("alice"))]))];
    for (at,(name,owner,group,open)) in [("a", "alice", 1, false), ("b", "bob", 2, false), ("c", "alice", 2, true), ("d", "bob", 3, true), ("e", "bob", 3, false)].into_iter().enumerate() {
        rows.push(("docs".into(),object([("id",id(name)),("owner",id(owner)),("group",Value::Int(group)),("open",Value::Bool(open)),("at",Value::Int(at as i64))])));
    }
    e.seed(rows).unwrap();
    e
}
fn walk(e: &mut Engine, query: &str, viewer: &str) -> Vec<String> {
    let mut cursor=Value::Null; let mut out=Vec::new();
    for _ in 0..20 {
        let r=e.query(query,Context::new(viewer,BTreeMap::from([("c".into(),cursor)]))).unwrap();
        assert!(r.complete,"{r:?}");
        out.extend(r.data.as_array().unwrap().iter().map(|r| match r.field("id").unwrap() { Value::Id(s)=>s.clone(), _=>panic!() }));
        match r.next {Some(c)=>cursor=Value::String(c), None=>return out}
    }
    panic!("cursor did not terminate")
}
#[test]
fn owner_public_member_union_orders_and_deduplicates_every_audience() {
    let mut e=setup();
    assert_eq!(walk(&mut e,"list","alice"),["a","b","c","d"]);
    assert_eq!(walk(&mut e,"list","bob"),["b","c","d","e"]);
    assert_eq!(walk(&mut e,"list","outsider"),["c","d"]);
}
#[test]
fn exact_where_witness_keeps_only_its_scope_even_for_the_system() {
    let mut e=setup();
    assert_eq!(walk(&mut e,"scoped","alice"),["b","c"]);
    assert!(walk(&mut e,"scoped","outsider").is_empty());
    let mut cx=Context::system();cx.args.insert("c".into(),Value::Null);
    let r=e.query("scoped",cx).unwrap(); assert!(r.complete);assert_eq!(r.data,Value::Array(vec![]));
}

#[test]
fn two_party_exact_parent_witness_fixes_one_component_per_lane() {
    let source = "table reporting:
  manager: principal
  report: principal
  unique report
  read <- .manager = viewer or .report = viewer
  online only
table agendas:
  manager: principal
  report: principal
  at: int
  read <- (.manager = viewer or .report = viewer) and exists reporting[report = .report, manager = .manager]
  online only
query list(c: cursor ?):
  return agendas first 1 by .at after c
";
    let b=compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    assert!(!b.notes.iter().any(|n|n.code=="N_NEVER_COMPLETE"),"{:?}",b.notes);
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    e.seed([("reporting", "r1", "alice", "bob", 0), ("reporting", "r2", "carol", "alice", 0),
            ("agendas", "a", "alice", "bob", 1), ("agendas", "b", "carol", "alice", 2),
            ("agendas", "hidden", "alice", "erin", 3)].into_iter().map(|(table,name,manager,report,at)| {
        let mut fields=vec![("id",id(name)),("manager",id(manager)),("report",id(report))];
        if table=="agendas" {fields.push(("at",Value::Int(at)));}
        (table.into(),object(fields))
    })).unwrap();
    assert_eq!(walk(&mut e,"list","alice"),["a","b"]);
    assert_eq!(walk(&mut e,"list","bob"),["a"]);
    assert!(walk(&mut e,"list","erin").is_empty());
}

#[test]
fn online_membership_word_search_uses_exact_discovery_without_replication() {
    let source=UNION.replace("  read <- .owner = viewer or .open = true or exists members[.group, viewer]", "  body: text <=100\n  search body\n  read <- exists members[.group, viewer]").replace("query list(c: cursor ?):\n  return docs first 1 by .at after c\nquery scoped(c: cursor ?):\n  return docs where exists members[.group, viewer] first 1 by .at after c", "query search(q: text <=100, c: cursor ?):\n  return docs matching q first 1 by .at after c");
    let b=compile(&[("schema.q".into(),source)]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let p=&b.programs[0].program;
    assert!(snapback4_core::search_plan::ordinary::plan(&b.schema,p).is_some(),"{p:?}");
    assert!(b.schema.tables.values().all(|t|t.sync.is_none()));
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    e.seed([("members".into(),object([("id",id("m")),("group",Value::Int(2)),("principal",id("alice"))])),
            ("docs".into(),object([("id",id("a")),("group",Value::Int(2)),("owner",id("bob")),("open",Value::Bool(false)),("at",Value::Int(1)),("body",Value::String("granite core".into()))])),
            ("docs".into(),object([("id",id("hidden")),("group",Value::Int(3)),("owner",id("bob")),("open",Value::Bool(false)),("at",Value::Int(2)),("body",Value::String("granite core".into()))]))]).unwrap();
    for (who, count) in [("alice",1),("bob",0)] {
        let r=e.query("search",Context::new(who,BTreeMap::from([("q".into(),Value::String("gran".into())),("c".into(),Value::Null)]))).unwrap();
        assert!(r.complete,"{r:?}");assert_eq!(r.data.as_array().unwrap().len(),count);
    }
}

#[test]
fn required_parent_snapshot_key_is_total_but_never_proves_a_copied_audience() {
    let source="table parents:
  band: int
  public 'readable parent'
  sync public
table members:
  group: int
  principal: principal
  unique group, principal
  read <- .principal = viewer
  sync to .principal
table children:
  parent: parents
  band: int
  read <- exists members[.band, viewer]
  sync to members[.band]
query list(parent: parents, c: cursor ?):
  p = parents[parent] ! else NOT_FOUND
  return children where .parent = p.id first 1 by .id after c
";
    let b=compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    assert!(!b.notes.iter().any(|n|n.code=="N_NEVER_COMPLETE"),"{:?}",b.notes);
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    e.seed([("parents".into(),object([("id",id("p")),("band",Value::Int(9))])),
            ("members".into(),object([("id",id("m")),("group",Value::Int(1)),("principal",id("alice"))])),
            ("children".into(),object([("id",id("a")),("parent",id("p")),("band",Value::Int(1))])),
            ("children".into(),object([("id",id("b")),("parent",id("p")),("band",Value::Int(9))]))]).unwrap();
    let r=e.query("list",Context::new("alice",BTreeMap::from([("parent".into(),id("p")),("c".into(),Value::Null)]))).unwrap();
    assert!(r.complete); assert_eq!(r.data.as_array().unwrap().len(),1);
    assert_eq!(r.data.as_array().unwrap()[0].field("id").unwrap(),&id("a"));
}

#[test]
fn negative_readable_static_grant_and_finite_status_ranges_are_complete() {
    let source="table roles:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable docs:\n  status: enum('proposed', 'approved', 'ordered')\n  read <- not exists roles[viewer] or .status != 'proposed'\n  online only\nquery list(c: cursor ?):\n  return docs first 1 by .id after c\n";
    let b=compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    assert!(!b.notes.iter().any(|n|n.code=="N_NEVER_COMPLETE"),"{:?}",b.notes);
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    e.seed([("roles".into(),object([("id",id("role")),("principal",id("alice"))])),("docs".into(),object([("id",id("a")),("status",Value::String("proposed".into()))])),("docs".into(),object([("id",id("b")),("status",Value::String("approved".into()))]))]).unwrap();
    assert_eq!(walk(&mut e,"list","alice"),["b"]);assert_eq!(walk(&mut e,"list","bob"),["a","b"]);
    let hidden=compile(&[("schema.q".into(),source.replace("read <- .principal = viewer","read <- deny"))]);
    assert!(hidden.notes.iter().any(|n|n.code=="N_NEVER_COMPLETE"));
}

#[test]
fn author_id_scope_is_complete_and_discovery_cut_publishes_nothing() {
    let source="table authors:\n  post: posts\n  principal: principal\n  unique post, principal\n  read <- .principal = viewer\n  online only\ntable posts:\n  open: bool\n  at: int\n  read <- .open = true or exists authors[.id, viewer]\n  online only\nquery mine(c: cursor ?):\n  return posts where exists authors[.id, viewer] first 1 by .at after c\n";
    let b=compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    assert!(!b.notes.iter().any(|n|n.code=="N_NEVER_COMPLETE"),"{:?}",b.notes);
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    e.seed([("authors".into(),object([("id",id("s1")),("post",id("a")),("principal",id("alice"))])),("authors".into(),object([("id",id("s2")),("post",id("b")),("principal",id("alice"))])),("posts".into(),object([("id",id("a")),("open",Value::Bool(false)),("at",Value::Int(1))])),("posts".into(),object([("id",id("b")),("open",Value::Bool(true)),("at",Value::Int(2))])),("posts".into(),object([("id",id("public")),("open",Value::Bool(true)),("at",Value::Int(3))]))]).unwrap();
    assert_eq!(walk(&mut e,"mine","alice"),["a","b"]);assert!(walk(&mut e,"mine","bob").is_empty());
    e.set_ceilings(snapback4_core::Ceilings{examined:1,..Default::default()});
    let r=e.query("mine",Context::new("alice",BTreeMap::from([("c".into(),Value::Null)]))).unwrap();
    assert!(!r.complete&&r.next.is_none()&&r.data.as_array().unwrap().is_empty(),"{r:?}");
}

#[test]
fn parent_snapshot_keys_keep_completeness_when_the_page_is_assigned_and_cut_is_not_absence() {
    let source="table parents:\n  public 'parents'\n  sync public\ntable members:\n  group: int\n  principal: principal\n  unique group, principal\n  read <- .principal = viewer\n  sync to .principal\ntable children:\n  parent: parents\n  group: int\n  read <- exists members[.group, viewer]\n  sync to members[.group]\nquery direct(parent: parents, c: cursor ?):\n  p = parents[parent] ! else PARENT_MISSING\n  return children where .parent = p.id first 1 by .id after c\nquery assigned(parent: parents, c: cursor ?):\n  p = parents[parent] ! else PARENT_MISSING\n  page = children where .parent = p.id first 1 by .id after c\n  return page\n";
    let b=compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(b.schema.required_capabilities().contains("branch-pages-v3"));
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();e.seed([("parents".into(),object([("id",id("p"))]))]).unwrap();
    let args=BTreeMap::from([("parent".into(),id("p")),("c".into(),Value::Null)]);
    for query in ["direct","assigned"] {
        let r=e.query(query,Context::new("alice",args.clone())).unwrap();assert!(r.complete&&r.data.as_array().unwrap().is_empty());
        e.set_ceilings(snapback4_core::Ceilings {examined:0,..Default::default()});
        let cut=e.query(query,Context::new("alice",args.clone())).unwrap();
        assert!(!cut.complete && cut.unavailable && cut.data==Value::Null && cut.next.is_none());
        e.set_ceilings(Default::default());
        let mut missing=args.clone();missing.insert("parent".into(),id("missing"));
        assert_eq!(e.query(query,Context::new("alice",missing)).unwrap_err().code,"PARENT_MISSING");
    }
}

#[test]
fn negative_covering_grant_requires_the_new_capability_and_local_negation_is_analyzer_only() {
    let source="table roles:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable docs:\n  owner: principal\n  at: int\n  read <- .owner = viewer or not exists roles[viewer]\n  online only\nquery list(c: cursor ?):\n  return docs first 1 by .at after c\n";
    let b=compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty());assert!(b.schema.required_capabilities().contains("branch-pages-v3"));
    let b=compile(&[("schema.q".into(),"table docs:\n  flag: bool\n  read <- not .flag\n  online only\nquery list():\n  return docs first 10 by .id\n".into())]);
    let note=b.notes.iter().find(|n|n.code=="N_NEVER_COMPLETE").unwrap();assert!(note.message.contains("analyzer limitation"));assert!(!note.message.contains("truly partial"));assert!(note.rewrite.contains(".flag = false"),"{note:?}");
    let repaired=compile(&[("schema.q".into(),"table docs:\n  flag: bool\n  read <- not .flag\n  online only\nquery list():\n  return docs where .flag = false first 10 by .id\n".into())]);assert!(repaired.diagnostics.is_empty());assert!(!repaired.notes.iter().any(|n|n.code=="N_NEVER_COMPLETE"));
}

#[test]
fn existing_scoped_word_index_can_gain_only_the_missing_reverse_source_index() {
    let source="table members:\n  group: int\n  principal: principal\n  unique group, principal\n  read <- .principal = viewer\n  online only\ntable docs:\n  group: int\n  body: text <=100\n  at: int\n  by scoped: group, words(body), at, id\n  read <- exists members[.group, viewer]\n  online only\nquery search(q: text <=100, c: cursor ?):\n  return docs matching q first 1 by .at after c\n";
    let b=compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    assert!(snapback4_core::search_plan::ordinary::plan(&b.schema,&b.programs[0].program).is_some());
    assert_eq!(b.schema.tables["docs"].indexes.keys().filter(|name|name.as_str()=="scoped").count(),1);
    assert!(b.schema.tables["members"].indexes.values().any(|index|index.columns().starts_with(&["principal".into(),"group".into()])));
}

#[test]
fn named_plain_page_and_pinned_membership_keep_every_party_complete() {
    let source=UNION.replace("  at: int", "  at: int\n  by named: at, id").replace("first 1 by .at", "first 1 by named");
    let b=compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty());assert!(!b.notes.iter().any(|n|n.code=="N_NEVER_COMPLETE"));
    let source=UNION.replace(".owner = viewer or .open = true or exists members[.group, viewer]", ".owner = viewer or exists members[.group, viewer]")
        .replace("query list(c: cursor ?):\n  return docs first 1", "query list(g: int, c: cursor ?):\n  return docs where .group = g first 1");
    let b=compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(!b.notes.iter().any(|n|n.code=="N_NEVER_COMPLETE"),"{:?}",b.notes);
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    e.seed([("docs".into(),object([("id",id("a")),("owner",id("alice")),("group",Value::Int(1)),("open",Value::Bool(false)),("at",Value::Int(1))]))]).unwrap();
    let r=e.query("list",Context::new("alice",BTreeMap::from([("g".into(),Value::Int(1)),("c".into(),Value::Null)]))).unwrap();assert!(r.complete&&r.data.as_array().unwrap().len()==1);
}

#[test]
fn asserted_maintained_row_keeps_output_type_and_never_becomes_computation() {
    let schema=include_str!("fixtures/row-keyed-view.q");
    let good=format!("{schema}\nquery status():\n  row = first(unread first 1) ! else NOT_FOUND\n  return {{ value: row.value, recountPending: row.recountPending }}\n");
    let b=compile(&[("schema.q".into(),good.clone())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(b.schema.required_capabilities().contains("branch-pages-v3"));
    let bad=good.replace("return { value: row.value, recountPending: row.recountPending }", "return row.recountPending = true");
    assert!(snapback4_lang::compile(&[("schema.q".into(),bad)]).diagnostics.iter().any(|d|d.code=="E_VIEW_KEY"));
}

#[test]
fn compound_prefix_conditional_note_names_the_guard_for_its_admitted_callers() {
    let source="table members:\n  group: int\n  principal: principal\n  unique group, principal\n  read <- .principal = viewer\n  online only\ntable seals:\n  question: int\n  unique question\n  read <- deny\n  online only\ntable docs:\n  group: int\n  principal: principal\n  question: int\n  read <- (exists members[.group, viewer] and .principal = viewer) or not exists seals[.question]\n  online only\nquery table(g: int):\n  return docs where .group = g and .principal = viewer first 10 by .id\n";
    let b=compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let note=b.notes.iter().find(|n|n.code=="N_CONDITIONAL_COMPLETE").unwrap();
    assert!(note.message.contains("for callers `exists members[") && note.message.contains("and otherwise remains capped"),"{note:?}");
}

#[test]
fn two_principal_status_scope_and_fixed_plus_per_row_grants_are_complete() {
    let escorts = "table roles:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable escorts:\n  student: principal\n  volunteerOne: principal ?\n  volunteerTwo: principal ?\n  status: enum('requested', 'assigned', 'arrived', 'walking', 'completed')\n  at: int\n  read <- .student = viewer or exists roles[viewer] or ((.volunteerOne = viewer or .volunteerTwo = viewer) and (.status = 'assigned' or .status = 'arrived' or .status = 'walking'))\n  online only\nquery walks(c: cursor ?):\n  return escorts where (.volunteerOne = viewer or .volunteerTwo = viewer) and (.status = 'assigned' or .status = 'arrived' or .status = 'walking') first 1 by .at after c\n";
    let b = compile(&[("schema.q".into(), escorts.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(!b.notes.iter().any(|n| n.code == "N_NEVER_COMPLETE"), "{:?}", b.notes);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([
        ("escorts".into(), object([("id", id("a")), ("student", id("s")), ("volunteerOne", id("alice")), ("volunteerTwo", Value::Null), ("status", Value::String("assigned".into())), ("at", Value::Int(1))])),
        ("escorts".into(), object([("id", id("b")), ("student", id("s")), ("volunteerOne", id("alice")), ("volunteerTwo", id("alice")), ("status", Value::String("walking".into())), ("at", Value::Int(2))])),
        ("escorts".into(), object([("id", id("hidden")), ("student", id("s")), ("volunteerOne", id("alice")), ("volunteerTwo", Value::Null), ("status", Value::String("completed".into())), ("at", Value::Int(3))])),
    ]).unwrap();
    assert_eq!(walk(&mut e, "walks", "alice"), ["a", "b"]);

    let grants = "table chapterAccess:\n  chapter: int\n  principal: principal\n  unique chapter, principal\n  read <- .principal = viewer\n  online only\ntable versionAccess:\n  version: id\n  principal: principal\n  unique version, principal\n  read <- .principal = viewer\n  online only\ntable versions:\n  chapter: int\n  at: int\n  read <- exists chapterAccess[.chapter, viewer] and exists versionAccess[.id, viewer]\n  online only\nquery versionsOf(chapter: int, c: cursor ?):\n  return versions where .chapter = chapter first 1 by .at after c\n";
    let b = compile(&[("schema.q".into(), grants.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(!b.notes.iter().any(|n| matches!(n.code.as_str(), "N_NEVER_COMPLETE" | "N_CONDITIONAL_COMPLETE")), "{:?}", b.notes);
    assert!(b.schema.required_capabilities().contains("branch-pages-v4"));
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([
        ("chapterAccess".into(), object([("id", id("ca")), ("chapter", Value::Int(1)), ("principal", id("alice"))])),
        ("versionAccess".into(), object([("id", id("va")), ("version", id("a")), ("principal", id("alice"))])),
        ("versions".into(), object([("id", id("a")), ("chapter", Value::Int(1)), ("at", Value::Int(1))])),
        ("versions".into(), object([("id", id("b")), ("chapter", Value::Int(1)), ("at", Value::Int(2))])),
    ]).unwrap();
    let args = |chapter| BTreeMap::from([("chapter".into(), Value::Int(chapter)), ("c".into(), Value::Null)]);
    let r = e.query("versionsOf", Context::new("alice", args(1))).unwrap();
    assert!(r.complete, "{r:?}");
    assert_eq!(r.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap()).collect::<Vec<_>>(), ["a"]);
    let r = e.query("versionsOf", Context::new("bob", args(1))).unwrap();
    assert!(r.complete && r.data.as_array().unwrap().is_empty(), "{r:?}");

    // A rule probe sees its target with system authority, while the residual
    // query probe uses ordinary read authority.  Keep PAGE out unless those
    // observations are equivalent for a timeless readable exact point.
    for unsafe_grant in [
        grants.replacen("  read <- .principal = viewer", "  read <- deny", 1),
        grants.replacen("  read <- .principal = viewer", "  until: time ?\n  expire at .until\n  read <- .principal = viewer", 1),
        grants.replacen("  principal: principal\n  unique chapter, principal", "  principal: principal\n  active: bool\n  unique chapter, principal", 1)
            .replace("exists chapterAccess[.chapter, viewer]", "exists chapterAccess[chapter = .chapter, principal = viewer, active = true]"),
    ] {
        let declined = compile(&[("schema.q".into(), unsafe_grant)]);
        assert!(declined.diagnostics.is_empty(), "{:?}", declined.diagnostics);
        assert!(declined.notes.iter().any(|n| n.code == "N_NEVER_COMPLETE"), "{:?}", declined.notes);
    }
}

#[test]
fn equality_filter_note_prints_one_matching_index_and_query() {
    let source = "table skippers:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable watches:\n  crew: principal\n  starts: time\n  by byStart: starts, id\n  read <- .crew = viewer or exists skippers[viewer]\n  online only\nquery myWatches():\n  return watches where .crew = viewer first 240 by byStart\n";
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let note = b.notes.iter().find(|note| note.code == "N_NEVER_COMPLETE").unwrap();
    assert!(note.rewrite.contains("by byCrewStarts: crew, starts, id"), "{note}");
    assert!(note.rewrite.contains("return watches where .crew = viewer first 240 by byCrewStarts"), "{note}");

    let repaired = source.replace("  by byStart: starts, id", "  by byStart: starts, id\n  by byCrewStarts: crew, starts, id")
        .replace("first 240 by byStart", "first 240 by byCrewStarts");
    let b = compile(&[("schema.q".into(), repaired)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(!b.notes.iter().any(|note| note.code == "N_NEVER_COMPLETE"), "{:?}", b.notes);
}

#[test]
fn exact_vacancy_pages_publish_only_rule_visible_exhaustion() {
    let source = "table artists:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable designs:\n  oneOfKind: bool\n  at: int\n  read <- exists artists[viewer] or not .oneOfKind or not exists holds[design = .id] or exists holds[design = .id, owner = viewer]\n  online only\ntable holds:\n  design: designs\n  owner: principal\n  expiresAt: time ?\n  unique design\n  read <- .owner = viewer or exists artists[viewer]\n  expire at .expiresAt\n  online only\nquery available(c: cursor ?):\n  return designs first 1 by .at after c\nquery availableAssigned(c: cursor ?):\n  page = designs first 1 by .at after c\n  return page\n";
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(!b.notes.iter().any(|note| note.code == "N_NEVER_COMPLETE"), "{:?}", b.notes);
    assert!(b.schema.required_capabilities().contains("branch-pages-v4"));
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([
        ("artists".into(), object([("id", id("artist")), ("principal", id("art"))])),
        ("designs".into(), object([("id", id("a")), ("oneOfKind", Value::Bool(false)), ("at", Value::Int(1))])),
        ("designs".into(), object([("id", id("b")), ("oneOfKind", Value::Bool(true)), ("at", Value::Int(2))])),
        ("designs".into(), object([("id", id("c")), ("oneOfKind", Value::Bool(true)), ("at", Value::Int(3))])),
        ("holds".into(), object([("id", id("h")), ("design", id("c")), ("owner", id("alice")), ("expiresAt", Value::Null)])),
    ]).unwrap();
    for ceilings in [
        snapback4_core::Ceilings { examined: 0, ..Default::default() },
        snapback4_core::Ceilings { rule_probes: 0, ..Default::default() },
    ] {
        e.set_ceilings(ceilings);
        let cut = e.query("available", Context::new("bob", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
        assert!(!cut.complete, "a cut before private vacancy exhaustion must stay incomplete: {cut:?}");
    }
    e.set_ceilings(Default::default());
    assert_eq!(walk(&mut e, "available", "bob"), ["a", "b"]);
    assert_eq!(walk(&mut e, "availableAssigned", "bob"), ["a", "b"]);
    assert_eq!(walk(&mut e, "available", "alice"), ["a", "b", "c"]);
    assert_eq!(walk(&mut e, "available", "art"), ["a", "b", "c"]);

    let non_point = source.replace("  design: designs\n", "  design: designs ?\n")
        .replace(" or exists holds[design = .id, owner = viewer]", "");
    let declined = compile(&[("schema.q".into(), non_point)]);
    assert!(declined.diagnostics.is_empty(), "{:?}", declined.diagnostics);
    assert!(declined.notes.iter().any(|note| note.code == "N_NEVER_COMPLETE"));
}
