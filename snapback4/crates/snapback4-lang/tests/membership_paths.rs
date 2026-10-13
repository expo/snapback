mod membership_paths { pub mod fixture; }
use membership_paths::fixture::source;
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;
fn bind(text: &str) -> Bound { compile(&[("schema.q".into(), text.into())]) }
fn clean(text: &str) -> Bound { let b=bind(text); assert!(b.diagnostics.is_empty(),"{:?}\n{text}",b.diagnostics); b }

#[test]
fn generated_paths_have_identical_schema_programs_and_residency() {
    for depth in [2,3] { for keep in [false,true] { for horizon in [false,true] { for field in ["group","conversation","room"] {
        let a=clean(&source(depth,false,keep,horizon,field));
        let b=clean(&source(depth,true,keep,horizon,field));
        assert_eq!(serde_json::to_value(&a.schema).unwrap(),serde_json::to_value(&b.schema).unwrap());
        for (a,b) in a.programs.iter().zip(&b.programs) {
            assert_eq!(serde_json::to_value(&a.program).unwrap(),serde_json::to_value(&b.program).unwrap());
        }
    }}}}
}

#[test]
fn explicit_through_can_name_its_authored_sync_path() {
    let text=source(3,false,false,false,"group");
    let mixed=text.replacen("  sync\n\nquery page", "  sync to members[.parent.message.group]\n\nquery page",1);
    assert_eq!(serde_json::to_value(clean(&text).schema).unwrap(),serde_json::to_value(clean(&mixed).schema).unwrap());
    let rule_only=source(3,true,false,false,"group").replace("sync to members[.parent.message.group]", "sync");
    assert_eq!(serde_json::to_value(clean(&text).schema).unwrap(),serde_json::to_value(clean(&rule_only).schema).unwrap());
}

#[test]
fn path_refusals_are_targeted_and_repairs_compile() {
    let base=source(2,true,false,false,"group");
    for (from,to,reason) in [
        ("parent: messages","parent: messages ?","required reference"),
        ("immutable parent, principal","immutable principal","must be immutable"),
        ("immutable group\n","-- mutable scope\n","captured by reactions"),
        ("exists members[.parent.group, viewer]","exists members[.parent.group, viewer] and .principal = viewer","whole parent's read rule"),
        ("sync to members[.parent.group]","sync to members[.parent.missing]","not an audience field"),
        (".parent.group, viewer]",".parent.missing, viewer]","whole parent's read rule"),
    ] {
        let text=base.replacen(from,to,1);let b=bind(&text);
        let d=b.diagnostics.iter().find(|d|d.code=="E_READ_THROUGH" && d.message.contains(reason)).unwrap_or_else(||panic!("{reason}: {:?}",b.diagnostics));
        assert!(!d.rewrite.is_empty(),"{d:?}");
        // Repair the declaration identified by each refusal, then exercise its exact suggested lines.
        let repaired=if reason=="required reference" { text.replace("parent: messages ?", &d.rewrite.replace("\n", "\n  ")).replace("  immutable parent, principal\n", "  immutable principal\n").replace("  read <- exists members[.parent.group, viewer]\n", "") }
        else if reason=="must be immutable" { text.replace("immutable principal",&d.rewrite) }
        else if reason=="captured by reactions" { text.replace("-- mutable scope",&d.rewrite) }
        else { let begin=text.find("  read <- exists members[.parent.").unwrap(); let end=text[begin..].find("\n  insert").unwrap()+begin;
            let mut s=text.clone();s.replace_range(begin..end,&format!("  {}",d.rewrite.split("\nsync").next().unwrap()));
            let sync=s.find("  sync to members[.parent.").unwrap();let end=s[sync..].find('\n').unwrap()+sync;s.replace_range(sync..end,"  sync");s };
        clean(&repaired);
    }
}

#[test]
fn mismatched_audiences_keep_sync_code_and_schema_specific_repair() {
    for horizon in [false,true] { for audience in ["sync public", "sync to groups[.parent.group]"] {
        let base=source(2,true,false,horizon,"group");
        let bad=base.replace("sync to members[.parent.group]",audience);
        let b=bind(&bad);
        let d=b.diagnostics.iter().find(|d|d.code=="E_SYNC").unwrap_or_else(||panic!("{:?}",b.diagnostics));
        let expected=format!("read through .parent\nsync{}",if horizon {" last 2 by .id"} else {""});
        assert_eq!(d.rewrite,expected,"{d}");
        let repaired=bad.replace("read <- exists members[.parent.group, viewer]","read through .parent").replace(audience,"sync");
        clean(&repaired);
    }}
}

const SINGLE_MEMBERSHIP: &str = "table groups:
  principal: principal
  until: time ?
  unique principal
  cap 16 by principal
  by byExpiry: until
  expire at .until
  read <- .principal = viewer
  online only
table documents:
  owner: principal
  parent: groups
  at: int
  read <- .owner = viewer or exists groups[id = .parent, principal = viewer]
  online only
query documents(c: cursor ?):
  return documents last 10 by .at after c
";

fn single_membership_engine(bound: &Bound, include_group: bool) -> Engine {
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|program| program.program.clone())).unwrap();
    let mut rows = vec![
        ("groups".into(), object([("id", Value::Id("g0".into())), ("principal", Value::Id("bob".into())), ("until", Value::Null)])),
        ("documents".into(), object([("id", Value::Id("owned".into())), ("owner", Value::Id("alice".into())), ("parent", Value::Id("g0".into())), ("at", Value::Int(1))])),
    ];
    if include_group { rows.extend([
        ("groups".into(), object([("id", Value::Id("g1".into())), ("principal", Value::Id("alice".into())), ("until", Value::Int(5))])),
        ("documents".into(), object([("id", Value::Id("shared".into())), ("owner", Value::Id("bob".into())), ("parent", Value::Id("g1".into())), ("at", Value::Int(2))])),
    ]); }
    engine.seed(rows).unwrap(); engine
}

// @ref LLP 3000.036.001#14 — a total one-row source key may return its implicit row id as the parent lane.
#[test]
fn total_unique_membership_source_uses_its_implicit_row_id() {
    let positional = SINGLE_MEMBERSHIP.replace("  unique principal\n", "  unique principal\n  unique id, principal\n")
        .replace("exists groups[id = .parent, principal = viewer]", "exists groups[.parent, viewer]");
    for source in [SINGLE_MEMBERSHIP.to_owned(), positional] {
        let bound = clean(&source);
        assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body).into_iter().any(|merge| merge.lanes.iter().any(|lane| lane.membership())));
        assert!(bound.schema.required_capabilities().contains("branch-membership-v1"));
        let ask = |engine: &mut Engine, at| engine.query("documents", Context::new("alice", BTreeMap::from([("c".into(), Value::Null)])).at(at)).unwrap();
        let mut live = single_membership_engine(&bound, true);
        let before = ask(&mut live, 4); assert!(before.complete); assert_eq!(before.data.as_array().unwrap().len(), 2);
        let after = ask(&mut live, 6); assert!(after.complete); assert_eq!(after.data.as_array().unwrap().len(), 1);
        let mut missing = single_membership_engine(&bound, false);
        let absent = ask(&mut missing, 4); assert!(absent.complete); assert_eq!(absent.data.as_array().unwrap().len(), 1);
    }
}

#[test]
fn nullable_unique_membership_source_keeps_the_original_scan() {
    let named = SINGLE_MEMBERSHIP.replace("principal: principal\n", "principal: principal ?\n");
    let positional = named.replace("  unique principal\n", "  unique principal\n  unique id, principal\n")
        .replace("exists groups[id = .parent, principal = viewer]", "exists groups[.parent, viewer]");
    for (source, source_indexes) in [(named, 3), (positional, 4)] {
        let bound = clean(&source);
        assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body).into_iter().all(|merge| !merge.branches()));
        assert!(bound.schema.tables["documents"].indexes.iter().all(|(name, index)| !name.starts_with("$intent")
            || !matches!(index.columns().as_slice(), [first, ..] if first == "owner" || first == "parent")));
        assert_eq!(bound.schema.tables["groups"].indexes.values().filter(|index| index.columns() == ["principal"]).count(), 1);
        assert_eq!(bound.schema.tables["groups"].indexes.len(), source_indexes, "only authored source indexes remain");
        assert!(bound.notes.iter().any(|note| note.code == "N_NEVER_COMPLETE"));
        assert!(!bound.schema.required_capabilities().contains("branch-membership-v1"));
    }
}

#[test]
fn eight_component_source_unique_omits_its_logical_id_suffix() {
    let source = "table groups:
  a: int
  b: int
  c: int
  d: int
  e: int
  f: int
  g: int
  principal: principal
  unique a, b, c, d, e, f, g, principal
  cap 16 by principal
  read <- .principal = viewer
  online only
table documents:
  owner: principal
  parent: groups
  at: int
  read <- .owner = viewer or exists groups[id = .parent, principal = viewer, a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0]
  online only
query documents(c: cursor ?):
  return documents last 10 by .at after c
";
    let bound = clean(source);
    assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body).into_iter()
        .any(|merge| merge.lanes.iter().any(|lane| lane.membership())));
    assert!(bound.schema.required_capabilities().contains("branch-membership-v1"));
    let source_indexes = &bound.schema.tables["groups"].indexes;
    assert!(source_indexes.values().any(|index| index.unique && index.components.len() == 8));
    assert!(source_indexes.values().all(|index| index.components.len() <= 8));

    let group = |id: &str, principal: &str| ("groups".into(), object([
        ("id", Value::Id(id.into())), ("a", Value::Int(0)), ("b", Value::Int(0)),
        ("c", Value::Int(0)), ("d", Value::Int(0)), ("e", Value::Int(0)),
        ("f", Value::Int(0)), ("g", Value::Int(0)), ("principal", Value::Id(principal.into())),
    ]));
    let document = |id: &str, owner: &str, parent: &str, at| ("documents".into(), object([
        ("id", Value::Id(id.into())), ("owner", Value::Id(owner.into())),
        ("parent", Value::Id(parent.into())), ("at", Value::Int(at)),
    ]));
    for (witness, expected) in [(false, 1), (true, 2)] {
        let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|program| program.program.clone())).unwrap();
        let mut rows = vec![group("g0", "bob"), document("owned", "alice", "g0", 1),
            document("denied", "bob", "g0", 3)];
        if witness { rows.extend([group("g1", "alice"), document("shared", "bob", "g1", 2)]); }
        engine.seed(rows).unwrap();
        let page = engine.query("documents", Context::new("alice", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
        assert!(page.complete && page.next.is_none(), "{page:?}");
        assert_eq!(page.data.as_array().unwrap().len(), expected);
    }
}

#[test]
fn one_row_source_unique_projects_an_ordinary_parent_field() {
    for nullable in [false, true] {
        let optional = if nullable { " ?" } else { "" };
        let source = format!("table members:
  parent: text <=40{optional}
  slot: int ?
  principal: principal
  unique principal
  cap 16 by principal
  read <- .principal = viewer
  online only
table documents:
  owner: principal
  parent: text <=40{optional}
  at: int
  read <- .owner = viewer or exists members[parent = .parent, slot = 0, principal = viewer]
  online only
query documents(c: cursor ?):
  return documents last 10 by .at after c
");
        let bound = clean(&source);
        let merge = snapback4_core::ir::body_merges(&bound.programs[0].program.body).into_iter()
            .find(|merge| merge.lanes.iter().any(|lane| lane.membership())).expect("membership merge");
        let lane = merge.lanes.iter().find(|lane| lane.membership()).unwrap();
        let source_scan = lane.source.as_ref().and_then(snapback4_core::ir::LaneSource::scan).unwrap();
        let source_index = &bound.schema.tables["members"].indexes[&source_scan.index];
        assert!(source_index.unique);
        assert_eq!(source_index.columns(), ["principal"]);
        assert_eq!(source_scan.prefix.len(), source_index.components.len());
        assert!(!bound.schema.tables["members"].indexes.values().any(|index|
            index.columns() == ["principal", "slot", "parent", "id"]));

        let parent = if nullable { Value::Null } else { Value::String("p1".into()) };
        for (slot, expected) in [(None, 1), (Some(Value::Int(0)), 2), (Some(Value::Null), 1), (Some(Value::Int(1)), 1)] {
            let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|program| program.program.clone())).unwrap();
            let mut rows = vec![
                ("members".into(), object([("id", Value::Id("m0".into())), ("parent", Value::String("p0".into())), ("slot", Value::Int(0)), ("principal", Value::Id("bob".into()))])),
                ("documents".into(), object([("id", Value::Id("owned".into())), ("owner", Value::Id("alice".into())), ("parent", Value::String("p0".into())), ("at", Value::Int(1))])),
                ("documents".into(), object([("id", Value::Id("shared".into())), ("owner", Value::Id("bob".into())), ("parent", parent.clone()), ("at", Value::Int(2))])),
            ];
            if let Some(value) = slot.clone() { rows.push(("members".into(), object([("id", Value::Id("m1".into())), ("parent", parent.clone()), ("slot", value), ("principal", Value::Id("alice".into()))]))); }
            engine.seed(rows).unwrap();
            let page = engine.query("documents", Context::new("alice", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
            assert!(page.complete && page.next.is_none(), "nullable={nullable} slot={slot:?}: {page:?}");
            assert_eq!(page.data.as_array().unwrap().len(), expected);
        }
    }
}

#[test]
fn one_row_source_selects_an_admitted_unique_before_residuals() {
    let source = "table members:
  parent: text <=40
  a: int
  principal: principal
  unique aa: a
  unique zz: principal
  cap 16 by principal
  read <- .principal = viewer
  online only
table documents:
  owner: principal
  parent: text <=40
  at: int
  read <- .owner = viewer or exists members[parent = .parent, principal = viewer, a = 0]
  online only
query documents(c: cursor ?):
  return documents last 10 by .at after c
";
    let bound = clean(source);
    let merge = snapback4_core::ir::body_merges(&bound.programs[0].program.body).into_iter()
        .find(|merge| merge.lanes.iter().any(|lane| lane.membership())).expect("membership merge");
    let lane = merge.lanes.iter().find(|lane| lane.membership()).unwrap();
    let source_scan = lane.source.as_ref().and_then(snapback4_core::ir::LaneSource::scan).unwrap();
    assert_eq!(bound.schema.tables["members"].indexes[&source_scan.index].columns(), ["principal"]);
    assert!(!bound.schema.tables["members"].indexes.values().any(|index|
        index.columns() == ["a", "principal", "parent", "id"]));

    for (member, expected) in [(Some(("alice", 0)), 2), (Some(("alice", 1)), 1), (Some(("bob", 0)), 1), (None, 1)] {
        let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|program| program.program.clone())).unwrap();
        let mut rows = vec![
            ("documents".into(), object([("id", Value::Id("owned".into())), ("owner", Value::Id("alice".into())), ("parent", Value::String("p0".into())), ("at", Value::Int(1))])),
            ("documents".into(), object([("id", Value::Id("shared".into())), ("owner", Value::Id("bob".into())), ("parent", Value::String("p1".into())), ("at", Value::Int(2))])),
        ];
        if let Some((principal, a)) = member { rows.push(("members".into(), object([
            ("id", Value::Id("m1".into())), ("parent", Value::String("p1".into())),
            ("a", Value::Int(a)), ("principal", Value::Id(principal.into())),
        ]))); }
        engine.seed(rows).unwrap();
        let page = engine.query("documents", Context::new("alice", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
        assert!(page.complete && page.next.is_none(), "member={member:?}: {page:?}");
        assert_eq!(page.data.as_array().unwrap().len(), expected);
    }
}
