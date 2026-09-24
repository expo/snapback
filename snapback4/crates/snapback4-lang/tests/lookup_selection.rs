//! Cal18's ID/parent-reference confusion, through the binder, engine and emitted types.
//! @ref LLP 3000.011.000.001#4 — reproduce the lookup before adding an explanation.
use snapback4_core::{Context, Engine, Value, ir, wire};
use snapback4_lang::{Bound, bind::residency};
use serde_json::json;

const SOURCE: &str = r#"
table posts:
  public 'originals'
table replies:
  postId: posts
  body: text <=100
  by byPost: postId, id
  cap 10 by postId
  public 'replies'
query generic(k: id):
  return replies[k]
query typed(k: replies):
  return replies[k]
query parent(k: posts):
  return replies[postId = k] by byPost
query explicit(k: replies):
  return replies[id = k]
query nullable(k: replies ?):
  return replies[id = k]
query explicitBy(k: replies):
  return replies[k] by byId
query children(k: posts ?):
  return replies[postId = k] first 10 by byPost
"#;
fn bound(source: &str) -> Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty() && b.notes.is_empty(), "{:?} {:?}", b.diagnostics, b.notes);
    b
}

#[test]
fn paired_id_and_parent_lookups_keep_row_page_types_and_absence() {
    let b = bound(SOURCE);
    for (name, index, kind) in [("generic", "byId", "point"), ("typed", "byId", "point"),
        ("parent", "byPost", "scan"), ("explicit", "byId", "point"),
        ("nullable", "byId", "point"), ("explicitBy", "byId", "point"), ("children", "byPost", "scan")] {
        let program = b.programs.iter().find(|p| p.program.name == name).unwrap();
        let sites = ir::read_sites(&program.program);
        assert_eq!(sites.len(), 1);
        assert_eq!((sites[0].index.as_str(), sites[0].kind), (index, kind));
        let fact = &b.schema.operations[name].sites[0];
        let column = if index == "byId" { "id" } else { "postId" };
        let form = if kind == "point" { "row or null" } else { "page" };
        assert!(fact.reason.contains(&format!("selected {index} ({column} = k); result: {form};")), "{fact:?}");
        let reason = match name { "generic" | "typed" => "only declared unique key of this arity", "explicit" | "nullable" => "named equality columns", "explicitBy" | "children" | "parent" => "explicit by", _ => unreachable!() };
        assert!(fact.reason.ends_with(reason), "{fact:?}");
        assert_eq!(serde_json::to_value(fact).unwrap()["reason"], fact.reason);
        assert_eq!(program.result.name(), if kind == "point" { "a replies row ?" } else { "a page of at most 10 replies rows" });
        println!("{name}: result={}\n{}\nIR {}", program.result.name(), residency::operation_lines(name, &b.schema.operations[name]), serde_json::to_string(&program.program).unwrap());
    }
    let types = snapback4_lang::emit::typescript(&b);
    for name in ["generic", "typed", "explicit", "explicitBy"] {
        assert!(types.contains(&format!("{name}: Query<{{ k: string }}, Rows[\"replies\"] | null>;")),"{types}");
    }
    assert!(types.contains("parent: Query<{ k: string }, Rows[\"replies\"][]>;"));
    assert!(types.contains("nullable: Query<{ k?: string | null }, Rows[\"replies\"] | null>;"));
    assert!(types.contains("children: Query<{ k?: string | null }, Rows[\"replies\"][]>;"));
    println!("types:\n{types}");
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let row = wire::row_from_json(e.schema().table("replies").unwrap(), &json!({"id":"r","postId":"p","body":"reply"})).unwrap();
    e.seed_at(vec![("replies".into(), row.clone())], 1).unwrap();
    let query = |e: &mut Engine, name: &str, key: Value| e.query(name, Context::new("alice", [("k".into(), key)].into()).at(2)).unwrap();
    for name in ["generic", "typed", "explicit", "nullable", "explicitBy"] {
        assert_eq!(query(&mut e, name, Value::Id("r".into())).data, row);
        assert_eq!(query(&mut e, name, Value::Id("absent".into())).data, Value::Null);
    }
    assert_eq!(query(&mut e, "nullable", Value::Null).data, Value::Null);
    assert_eq!(query(&mut e, "children", Value::Null).data, Value::Array(vec![]));
    assert_eq!(query(&mut e, "parent", Value::Id("p".into())).data, Value::Array(vec![row]));
    assert_eq!(query(&mut e, "parent", Value::Id("absent".into())).data, Value::Array(vec![]));
}

#[test]
fn explicit_point_intent_refuses_a_different_table_identity() {
    for spelling in ["replies[id = k]", "replies[k] by byId"] {
        let b = snapback4_lang::compile(&[("schema.q".into(), format!("{SOURCE}\nquery wrong(k: posts):\n  return {spelling}\n"))]);
        assert!(!b.diagnostics.is_empty(), "a posts reference must not become a replies point key");
        for d in b.diagnostics { println!("{d}"); assert!(!d.mechanical); }
    }
}

#[test]
fn conflicting_compatible_indexes_require_an_explicit_choice() {
    let source = "table posts:\n  public 'posts'\ntable votes:\n  first: posts\n  second: posts\n  unique byFirst: first\n  unique bySecond: second\n  public 'votes'\nquery choose(k: posts):\n  return votes[k]\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert_eq!(b.diagnostics.len(), 1);
    let d = &b.diagnostics[0];
    assert_eq!(d.code, "E_QUARRY_POSITIONAL_SCAN");
    println!("{d}");
    bound(&source.replace("return votes[k]", "return votes[k] by byFirst"));
    bound(&source.replace("return votes[k]", "return votes[first = k]"));
}

#[test]
fn existence_keeps_its_lookup_and_implicit_maintained_group_is_not_authored_by() {
    let b = bound(&format!("{SOURCE}\nmaintain totals: count replies by postId\n  read <- allow\n  online only\nquery total(k: posts):\n  return totals[k]\nquery totalExplicit(k: posts):\n  return totals[k] by byGroup\nquery totalExists(k: id):\n  return exists totals[id = k]\nquery parentExists(k: posts):\n  return exists replies[postId = k] by byPost\n"));
    for (name,index,result,reason) in [
        ("total","byGroup","scalar","complete maintained group key"),
        ("totalExplicit","byGroup","scalar","explicit by"),
        ("totalExists","byId","exists","named equality columns"),
        ("parentExists","byPost","exists","explicit by"),
    ] {
        let fact = &b.schema.operations[name].sites[0];
        assert_eq!(fact.index,index);
        assert!(fact.reason.contains(&format!("result: {result};")),"{fact:?}");
        assert!(fact.reason.ends_with(reason),"{fact:?}");
        println!("{name}: {}",fact.reason);
    }
}
