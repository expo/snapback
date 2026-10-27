//! Wave31 frozen-client lanes 003/005/023; actual interpreter and emitted API.
use snapback4_core::{Engine, Store, Value, engine::Context};
fn bound(source:&str)->snapback4_lang::Bound {
    let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b
}
const TABLE:&str="table items:\n  title: text <=80\n  public\n  online only\n";
#[test]
fn wave31_005_023_frozen_result_aliases_survive_rows_pages_nulls_and_export_aliases() {
    let source=format!("{TABLE}query list(c: cursor ?):\n  return items first 2 by .id after c\nquery one(id: items):\n  return items[id]\nalias result list.label = title\nalias result one.label = title\nalias oldList = list\n");
    let b=bound(&source);
    let generated=snapback4_lang::emit::typescript(&b); // also checks the frozen property is typed
    assert!(generated.contains("label"),"{generated}");
    let schema=b.schema.clone();let mut engine=Engine::new(Store::memory().unwrap(),b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    engine.seed(["one","two","three"].into_iter().map(|id|("items".into(),snapback4_core::wire::row_from_json(&schema.tables["items"],&serde_json::json!({"id":id,"title":"kept"})).unwrap()))).unwrap();
    for name in ["list","oldList"] {
        let result=engine.query(name,Context::new("alice",std::collections::BTreeMap::from([("c".into(),Value::Null)]))).unwrap();
        let json=snapback4_core::wire::to_json(&result.data);
        assert_eq!(json[0]["id"],"one");assert_eq!(json[0]["title"],"kept");assert_eq!(json[0]["label"],"kept");assert!(result.complete);
        assert_eq!(json.as_array().unwrap().len(),2);
        let cursor=result.next.expect("the aliased page retains its continuation");
        let tail=engine.query(name,Context::new("alice",std::collections::BTreeMap::from([("c".into(),Value::String(cursor))]))).unwrap();
        let tail=snapback4_core::wire::to_json(&tail.data);assert_eq!(tail.as_array().unwrap().len(),1);assert_eq!(tail[0]["label"],"kept");
    }
    assert_eq!(engine.query("one",Context::new("alice",std::collections::BTreeMap::from([("id".into(),Value::Id("missing".into()))]))).unwrap().data,Value::Null);
    let row=engine.query("one",Context::new("alice",std::collections::BTreeMap::from([("id".into(),Value::Id("one".into()))]))).unwrap();
    assert_eq!(snapback4_core::wire::to_json(&row.data)["label"],"kept");
}
#[test]
fn wave31_005_frozen_review_names_the_property_and_alias_without_erasing_other_breaks() {
    let old=bound(&format!("{}query list():\n  return items first 2 by .id\n",TABLE.replace("title:","label:")));
    let new=bound(&format!("{TABLE}query list():\n  return items first 2 by .id\nalias result list.label = title\n"));
    let report=snapback4_lang::client_contracts::compare(&old,&new,"frozen v1 UI").join("\n");
    assert!(report.contains("[].label"),"{report}");assert!(report.contains("covered by alias list.label = title"),"{report}");
    assert!(report.contains("missing fields []"),"{report}");
}
#[test]
fn result_aliases_refuse_unknown_fields_collisions_and_non_row_results() {
    for body in ["return 4", "return {title:'a',label:'b'}", "return items first 2 by .id {id}"] {
        let source=format!("{TABLE}query list():\n  {body}\nalias result list.label = title\n");
        let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
        assert!(!b.diagnostics.is_empty(),"{body}");
    }
}

#[test]
fn wave31_017_scalar_extract_refuses_with_asset_only_boundary_and_repair() {
    let source="table items:\n  label: text <=80\n  public\n  online only\ntable parts:\n  item: items on delete cascade\n  label: text <=80\n  immutable item\n  read through .item\n  online only\nextract parts from items via item: {label:label}\n";
    let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.iter().any(|d|d.message.contains("asset-only")&&d.message.contains("backfill/down")),"{:?}",b.diagnostics);
}

#[test]
fn frozen_aliases_keep_private_field_omission_and_evaluate_a_write_result_once(){
    let source="table items:\n  owner: principal\n  title: text <=80 read <- .owner = viewer\n  public\n  insert <- allow\n  online only\nquery list():\n  return items first 20 by .id\nmutation add(title: text <=80):\n  return insert items {owner:viewer,title}\nalias result list.label = title\nalias result add.label = title\n";
    let b=bound(source);let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let c=Context::new("alice",std::collections::BTreeMap::from([("title".into(),Value::String("private-original".into()))]));
    let written=e.mutate("add",None,c).unwrap();assert!(matches!(written.state,snapback4_core::WriteState::Sent{..}));
    let mine=snapback4_core::wire::to_json(&e.query("list",Context::new("alice",Default::default())).unwrap().data);
    assert_eq!(mine.as_array().unwrap().len(),1,"the write result is evaluated once");assert_eq!(mine[0]["label"],"private-original");
    let other=snapback4_core::wire::to_json(&e.query("list",Context::new("bob",Default::default())).unwrap().data);
    assert_eq!(other[0].get("label"),other[0].get("title"),"alias omission follows its canonical field: {other}");
    assert!(!other.to_string().contains("private-original"));
}

#[test]
fn wave31_005_frozen_alias_preserves_explicit_null_branch() {
    let source=format!("{TABLE}query one(id: items):\n  item = items[id]\n  if item = null:\n    return null\n  return item\nalias result one.label = title\n");
    let b=bound(&source);let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let result=e.query("one",Context::new("alice",std::collections::BTreeMap::from([("id".into(),Value::Id("missing".into()))]))).unwrap();assert_eq!(result.data,Value::Null);
    let b=snapback4_lang::compile(&[("schema.q".into(),format!("{TABLE}query one():\n  return null\nalias result one.label = title\n"))]);assert!(!b.diagnostics.is_empty());
}

#[test]
fn frozen_alias_coverage_never_claims_a_different_nested_property() {
    let old=bound("query list():\n  return {details:{label:'old'}}\n");
    let new=bound("query list():\n  return {title:'new'}\nalias result list.label = title\n");
    let review=snapback4_lang::client_contracts::compare(&old,&new,"frozen nested UI").join("\n");
    assert!(review.contains("missing fields [details.label]"),"{review}");assert!(!review.contains("covered by alias"),"{review}");
}
#[test]
fn rollback_photos_never_infer_parent_identity_from_an_object_or_replaced_id() {
    let old="table items:\n  owner: principal\n  photo: image <=1000\n  public\n  online only\nquery list():\n  return items first 20 by .id\n";
    let table="table items:\n  owner: principal\n  public\n  online only\ntable photos:\n  item: items on delete cascade\n  photo: image <=1000\n  immutable item\n  read through .item\n  online only\nextract photos from items via item: {photo:photo}\n";
    for expression in ["{id:'made-up',owner:'alice'}","(items first 20 by .id) {id:'made-up',owner}"] {
        let current=format!("{table}query list():\n  return {expression}\n");
        bound(&current);let bridge=snapback4_lang::release_bridge::loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]);
        assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);assert!(!bridge.sources[0].1.contains("rollbackResult_"),"{}",bridge.sources[0].1);
    }
}
