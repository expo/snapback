//! Current query dependencies must travel with a selective guarded bridge.
use snapback4_core::{Context, Engine, Value};
fn source(text: &str) -> Vec<(String, String)> { vec![("schema.q".into(), text.into())] }
fn rows(bridge: &crate::release_bridge::Bridge, values: &[(&str, i64, i64)], query: &str) -> Vec<String> {
    let bound = crate::compile(&bridge.sources);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(values.iter().map(|(id, n, rank)| ("notes".into(), Value::Row([
        ("id".into(), Value::Id((*id).into())), ("n".into(), Value::Int(*n)),
        ("rank".into(), Value::Int(*rank)), ("amount".into(), Value::Int(5)),
    ].into_iter().collect())))).unwrap();
    let result = engine.query(query, Context::new("alice", Default::default())).unwrap();
    let Value::Array(rows) = result.data else { panic!("expected rows") };
    rows.into_iter().map(|r| match r.field("id").unwrap() { Value::Id(id) => id.clone(), _ => panic!("id") }).collect()
}
#[test]
fn current_index_is_carried_with_its_endpoint() {
    let old = "table notes:\n  n: int\n  memo: text <=20 ?\n  by byN: n, id\n  public\n  online only\ntable retired:\n  value: int\n  public\n  online only\nquery ordered():\n  return notes first 10 by byN\n";
    let current = "table notes:\n  n: int\n  count: int default 7\n  by byCount: count, id\n  public\n  online only\ntable added:\n  value: int\n  public\n  online only\nquery ordered():\n  return notes where .count = 7 first 10 by byCount\n";
    let bridge = crate::release_bridge::loosen(&source(old), &source(current));
    assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
    let bound = crate::compile(&bridge.sources);
    assert!(bound.schema.tables["notes"].indexes.contains_key("byN"));
    assert_eq!(bound.schema.tables["notes"].indexes["byCount"].columns(), ["count", "id"]);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("a", 2), ("b", 1)].map(|(id, n)| ("notes".into(), Value::Row([
        ("id".into(), Value::Id(id.into())), ("n".into(), Value::Int(n)),
    ].into_iter().collect())))).unwrap();
    let result = engine.query("ordered", Context::new("alice", Default::default())).unwrap();
    let Value::Array(rows) = result.data else { panic!("expected rows") };
    assert_eq!(rows.iter().map(|r| r.field("n").unwrap().clone()).collect::<Vec<_>>(), [Value::Int(2), Value::Int(1)]);
}
#[test]
fn same_named_changed_index_uses_current_context() {
    let old = "table notes:\n  n: int\n  rank: int\n  amount: int\n  by byOrder: n, id\n  public\n  online only\nquery ordered():\n  return notes first 10 by byOrder\n";
    let current = old.replace("amount: int", "amount: int ?").replace("byOrder: n", "byOrder: rank");
    let bridge = crate::release_bridge::loosen(&source(old), &source(&current));
    assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
    assert_eq!(rows(&bridge, &[("a", 1, 9), ("b", 2, 0)], "ordered"), ["b", "a"]);
}
#[test]
fn same_named_word_index_uses_current_field_selection() {
    let old = "table notes:\n  title: text <=40\n  body: text <=40\n  amount: int\n  by bySearch: words(title), id\n  public\n  online only\nquery find(q: text <=40):\n  return notes matching q first 10 by bySearch\n";
    let current = old.replace("amount: int", "amount: int ?").replace("words(title)", "words(body)");
    let bridge = crate::release_bridge::loosen(&source(old), &source(&current));
    assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
    let bound = crate::compile(&bridge.sources);
    assert_eq!(bound.schema.tables["notes"].indexes["bySearch"].word_component().unwrap().1, ["body"]);
}

#[test]
fn equivalent_unique_key_name_is_not_a_current_index_alias() {
    let old = "table notes:\n  owner: principal\n  memo: text <=20 ?\n  unique byOwner: owner\n  public\n  online only\ntable retired:\n  value: int\n  public\n  online only\nquery ordered():\n  return notes first 10 by byOwner\n";
    let current = "table notes:\n  owner: principal\n  count: int default 7\n  unique byCurrentOwner: owner\n  public\n  online only\nquery ordered():\n  return notes first 10 by byCurrentOwner\n";
    let bridge = crate::release_bridge::loosen(&source(old), &source(current));
    assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
    let bound = crate::compile(&bridge.sources);
    assert!(bound.schema.tables["notes"].indexes["byCurrentOwner"].unique);
}
#[test]
fn declared_plain_column_identity_is_not_an_index_meaning_change() {
    let old = "table notes:\n  owner: principal\n  by byOwner: owner, id\n  public\n  online only\nquery ordered():\n  return notes first 10 by byOwner\n";
    let current = old.replace("owner: principal", "customer: principal renamed from owner").replace("byOwner: owner", "byOwner: customer");
    let before = crate::compile(&source(old));
    let after = crate::compile(&source(&current));
    assert!(before.diagnostics.is_empty(), "{:?}", before.diagnostics);
    assert!(after.diagnostics.is_empty(), "{:?}", after.diagnostics);
    let old_doc = crate::parser::parse_document("schema.q", old).0;
    let new_doc = crate::parser::parse_document("schema.q", &current).0;
    assert!(!crate::release_bridge_indexes::current_context_needed(&[old_doc], &[new_doc], &before.schema, &after.schema, &Default::default()));
}

#[test]
fn new_plain_index_uses_declared_predecessor_column_identity() {
    let old = "table notes:\n  n: int\n  owner: principal\n  memo: text <=20 ?\n  by byN: n, id\n  public\n  online only\ntable retired:\n  value: int\n  public\n  online only\nquery ordered():\n  return notes first 10 by byN\n";
    let current = "table notes:\n  n: int ?\n  customer: principal renamed from owner\n  count: int default 7\n  by byCount: count, customer, id\n  public\n  online only\nquery ordered():\n  return notes where .count = 7 first 10 by byCount\n";
    let bridge = crate::release_bridge::loosen(&source(old), &source(current));
    assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
    let bound = crate::compile(&bridge.sources);
    assert_eq!(bound.schema.tables["notes"].indexes["byCount"].columns(), ["count", "owner", "id"]);
}

#[test]
fn plain_index_transport_keeps_index_label_and_business_literals() {
    let old = crate::parser::parse_document("schema.q", "table notes:\n  owner: principal\n  online only\n").0;
    let raw = "  unique customer: customer else TAKEN 'customer stays customer'";
    let text = format!("table notes:\n  customer: principal renamed from owner\n{raw}\n  online only\n");
    let current = crate::parser::parse_document("schema.q", &text).0;
    let next = &current.tables[0];
    let result = crate::release_bridge_indexes::plain_declaration("schema.q", raw, &next.indexes[0], &old.tables[0], next);
    assert_eq!(result, "  unique customer: owner else TAKEN 'customer stays customer'");
}
#[test]
fn plain_column_transport_never_collapses_independent_current_fields() {
    let old = crate::parser::parse_document("schema.q", "table notes:\n  owner: principal\n  online only\n").0;
    let current = crate::parser::parse_document("schema.q", "table notes:\n  customer: principal renamed from owner\n  owner: principal\n  online only\n").0;
    assert!(crate::release_bridge_indexes::column_names(&old.tables[0], &current.tables[0]).is_none());
}

#[test]
fn current_unique_index_replaces_same_named_predecessor_nonunique_index() {
    let old = "table notes:\n  n: int\n  code: text <=20\n  memo: text <=20 ?\n  by byN: n, id\n  by byCustomer: code\n  public\n  online only\ntable retired:\n  value: int\n  public\n  online only\nquery ordered():\n  return notes first 10 by byN\n";
    let current = "table notes:\n  n: int ?\n  label: text <=20 renamed from code\n  count: int default 7\n  by byCount: count, label, id\n  unique byCustomer: label\n  public\n  online only\nquery ordered():\n  return notes where .count = 7 first 10 by byCount\n";
    let bridge = crate::release_bridge::loosen(&source(old), &source(current));
    assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
    let bound = crate::compile(&bridge.sources);
    let index = &bound.schema.tables["notes"].indexes["byCustomer"];
    assert!(index.unique);
    assert_eq!(index.columns(), ["code"]);
}

#[test]
fn unused_equivalent_unique_names_do_not_make_implicit_old_lookups_ambiguous() {
    let old="table notes:\n  n: int\n  code: text <=20\n  unique byCode: code\n  public\n  online only\ntable retired:\n  value: int\n  public\n  online only\nquery lookup(code: text <=20):\n  return notes[code]\n";
    let current=old.replace("n: int", "n: int ?").replace("unique byCode:","unique byCurrentCode:")
        .replace("table retired:\n  value: int\n  public\n  online only\n", "");
    let bridge=crate::release_bridge::loosen(&source(old),&source(&current));
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    let bound=crate::compile(&bridge.sources);
    let mut engine=Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    engine.seed([("notes".into(),Value::Row([("id".into(),Value::Id("kept".into())),("n".into(),Value::Int(1)),("code".into(),Value::String("a".into()))].into_iter().collect()))]).unwrap();
    let answer=engine.query("lookup",Context::new("alice",[("code".into(),Value::String("a".into()))].into_iter().collect())).unwrap();
    assert_eq!(answer.data.field("id").unwrap(),&Value::Id("kept".into()));
}

#[test]
fn explicitly_used_equivalent_unique_names_keep_both_workflows() {
    let text="table notes:\n  code: text <=20\n  unique byA: code\n  unique byB: code\n  public\n  online only\nquery a(code: text <=20):\n  return notes[code] by byA\nquery b(code: text <=20):\n  return notes[code] by byB\n";
    let mut view=source(text);
    crate::release_bridge_indexes::prune_unused_equivalent_keys(&mut view,&source(text),&mut Vec::new());
    let bound=crate::compile(&view);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    assert!(bound.schema.tables["notes"].indexes.contains_key("byA"));
    assert!(bound.schema.tables["notes"].indexes.contains_key("byB"));
    let mut engine=Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    engine.seed([("notes".into(),Value::Row([("id".into(),Value::Id("kept".into())),("code".into(),Value::String("a".into()))].into_iter().collect()))]).unwrap();
    for op in ["a","b"] {
        let answer=engine.query(op,Context::new("alice",[("code".into(),Value::String("a".into()))].into_iter().collect())).unwrap();
        assert_eq!(answer.data.field("id").unwrap(),&Value::Id("kept".into()));
    }
}

#[test]
fn unused_keys_with_different_ordered_meanings_remain_ambiguous() {
    for key in ["a", "b, a"] {
        let pair=key.contains(',');
        let text=format!("table notes:\n  a: text <=20\n  b: text <=20\n  unique byA: {}\n  unique byB: {key}\n  public\n  online only\nquery lookup(a: text <=20, b: text <=20):\n  return notes[{}]\n",if pair {"a, b"}else{"b"},if pair {"a, b"}else{"a"});
        let mut view=source(&text);
        crate::release_bridge_indexes::prune_unused_equivalent_keys(&mut view,&source(&text),&mut Vec::new());
        assert!(crate::compile(&view).diagnostics.iter().any(|d|d.code=="E_QUARRY_POSITIONAL_SCAN"));
        assert_eq!(view,source(&text));
    }
}
