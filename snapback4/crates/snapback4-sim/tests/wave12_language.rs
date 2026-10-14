//! Wave 12 language surfaces through the real server engine.
use snapback4_core::{Context, Engine, Value, WriteState};
use std::collections::BTreeMap;

const SOURCE: &str = r#"
table entries:
  category: enum('coffee-shop', 'book_store', 'museum')
  contact: text 3..254 format email
  amount: decimal 2
  search category
  public 'wave 12 fixture'
  insert <- allow
  delete <- allow
  online only
table staff:
  principal: principal
  role: enum('finance')
  unique principal, role
  read <- .principal = viewer
  online only
view total: count entries
  online only
view categoryTotals: count entries by .category
  read <- exists staff[principal = viewer, role = 'finance']
  online only
mutation add(id: id, category: enum('coffee-shop', 'book_store', 'museum'), contact: text 3..254 format email, amount: decimal 2):
  return insert entries { id, category, contact, amount }
mutation remove(id: entries):
  delete entries[id]
  return null
query totalEntries():
  return total
query categoryTotal(category: enum('coffee-shop', 'book_store', 'museum')):
  return categoryTotals[category]
query guardedCategoryTotal(category: enum('coffee-shop', 'book_store', 'museum')):
  require exists staff[principal = viewer, role = 'finance'] else NOT_FINANCE
  return categoryTotals[category] + 1
query search(q: text <=40, c: cursor ?):
  return entries matching q first 20 by .id after c
query extrema():
  n = count(entries)
  require n > 0 else EMPTY
  return { low: min(entries, .amount), high: max(entries, .amount), sum: sum(entries, .amount) }
query rounded(value: decimal 2):
  return [divide(value, 2, 'half-even'), divide(value, 2, 'half-away-from-zero')]
query average(total: int, count: int):
  return divide(total, count, 2, 'half-even')
query email(value: text 3..254 format email):
  return value
"#;

fn args(values: &[(&str, Value)]) -> BTreeMap<String, Value> {
    values.iter().map(|(name, value)| ((*name).into(), value.clone())).collect()
}

#[test]
fn server_executes_all_wave12_semantic_surfaces_together() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|program| program.program)).unwrap();
    let call = |engine: &mut Engine, name, values: &[(&str, Value)]| {
        engine.query(name, Context::new("dev:alice", args(values))).unwrap().data
    };

    assert_eq!(call(&mut engine, "totalEntries", &[]), Value::Int(0));
    for (id, category, amount) in [("a", "coffee-shop", 5), ("b", "book_store", -5)] {
        let result = engine.mutate("add", None, Context::new("dev:alice", args(&[
            ("id", Value::Id(id.into())),
            ("category", Value::String(category.into())),
            ("contact", Value::String(format!("{id}@example.com"))),
            ("amount", Value::Int(amount)),
        ]))).unwrap();
        assert!(matches!(result.state, WriteState::Sent { .. }), "{result:?}");
    }
    assert_eq!(call(&mut engine, "totalEntries", &[]), Value::Int(2));
    assert_eq!(call(&mut engine, "categoryTotal", &[("category", Value::String("coffee-shop".into()))]), Value::Null,
        "a hidden keyed hit is indistinguishable from a hidden miss");
    engine.seed([("staff".into(), snapback4_core::value::object([
        ("id", Value::Id("finance".into())), ("principal", Value::Id("dev:alice".into())),
        ("role", Value::String("finance".into())),
    ]))]).unwrap();
    assert_eq!(call(&mut engine, "guardedCategoryTotal", &[("category", Value::String("coffee-shop".into()))]), Value::Int(2));
    assert_eq!(call(&mut engine, "guardedCategoryTotal", &[("category", Value::String("museum".into()))]), Value::Int(1));
    assert_eq!(call(&mut engine, "extrema", &[]), snapback4_core::value::object([
        ("low", Value::Int(-5)), ("high", Value::Int(5)), ("sum", Value::Int(0)),
    ]));
    assert_eq!(call(&mut engine, "rounded", &[("value", Value::Int(5))]), Value::Array(vec![Value::Int(2), Value::Int(3)]));
    assert_eq!(call(&mut engine, "average", &[("total", Value::Int(101)), ("count", Value::Int(2))]), Value::Int(5050));
    assert_eq!(call(&mut engine, "average", &[("total", Value::Int(-1)), ("count", Value::Int(8))]), Value::Int(-12));
    assert_eq!(call(&mut engine, "email", &[("value", Value::String("a@localhost".into()))]), Value::String("a@localhost".into()));
    assert_eq!(engine.query("email", Context::new("dev:alice", args(&[("value", Value::String("a..b@example.com".into()))]))).unwrap_err().code, "E_INPUT");
    let hits = call(&mut engine, "search", &[("q", Value::String("cof".into())), ("c", Value::Null)]);
    assert_eq!(hits.as_array().unwrap().len(), 1);
    assert_eq!(hits.as_array().unwrap()[0].field("id").unwrap(), &Value::Id("a".into()));

    engine.mutate("remove", None, Context::new("dev:alice", args(&[("id", Value::Id("a".into()))]))).unwrap();
    engine.mutate("remove", None, Context::new("dev:alice", args(&[("id", Value::Id("b".into()))]))).unwrap();
    assert_eq!(call(&mut engine, "totalEntries", &[]), Value::Int(0));
}
