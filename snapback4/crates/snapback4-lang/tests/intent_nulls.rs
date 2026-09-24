//! Nullable membership uses an authorized filtered lane, never a null prefix.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::compile;
use std::collections::BTreeMap;

const SOURCE: &str = "table posts:\n  owner: principal ?\n  reader: principal\n  at: time\n  body: text <=100\n  search body\n  read <- .reader = viewer\n  sync to .reader\nview events:\n  posts { owner, reader, at }\nquery page(owners: [principal] <=10, withNull: bool, c: cursor ?):\n  values = ([null, null, first(owners), last(owners)] if withNull else owners)\n  return posts where .reader = viewer and .owner in values first 1 by .at after c\nquery words(owners: [principal] <=10, withNull: bool, c: cursor ?):\n  values = ([null, null, first(owners), last(owners)] if withNull else owners)\n  return posts where .reader = viewer and .owner in values matching 'hello' first 1 by .at after c\nquery projected(owners: [principal] <=10, withNull: bool, c: cursor ?):\n  values = ([null, null, first(owners), last(owners)] if withNull else owners)\n  return events where .reader = viewer and .owner in values first 1 by .at after c\nquery all(owners: [principal] <=10, withNull: bool, c: cursor ?):\n  values = ([null, null, first(owners), last(owners)] if withNull else owners)\n  return posts where .reader = viewer and .owner in values first 10 by .at after c\nquery nonuniform(owners: [principal] <=10, withNull: bool, c: cursor ?):\n  values = ([null, null, first(owners), last(owners)] if withNull else owners)\n  return posts where .owner in values first 10 by .at after c\n";

fn bound(source: &str) -> snapback4_lang::Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}
fn seed() -> Vec<(String, Value)> {
    [("a", None, "alice", 1), ("b", Some("alice"), "alice", 1), ("c", None, "alice", 2),
        ("d", Some("alice"), "alice", 2), ("hidden", None, "bob", 0), ("other", Some("bob"), "alice", 0)]
        .into_iter().map(|(key, owner, reader, at)| ("posts".into(), object([
            ("id", Value::Id(key.into())), ("owner", owner.map(|v| Value::Id(v.into())).unwrap_or(Value::Null)),
            ("reader", Value::Id(reader.into())), ("at", Value::Int(at)), ("body", Value::String("hello".into())),
        ]))).collect()
}
fn engine(source: &str) -> Engine {
    let bound = bound(source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(seed()).unwrap();
    engine
}
fn context(owners: Vec<Value>, cursor: Option<String>) -> Context {
    let with_null = owners.contains(&Value::Null);
    let owners = owners.into_iter().filter(|value| *value != Value::Null).collect();
    Context::new("alice", BTreeMap::from([("withNull".into(), Value::Bool(with_null)), ("owners".into(), Value::Array(owners)), ("c".into(), cursor.map(Value::String).unwrap_or(Value::Null))]))
}
fn owners() -> Vec<Value> { vec![Value::Null, Value::Id("alice".into()), Value::Null, Value::Id("alice".into())] }
fn ids(data: &Value) -> Vec<String> { data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()).collect() }

#[test]
fn nullable_value_lanes_page_in_both_directions_with_words_and_projection() {
    for program in bound(SOURCE).programs {
        assert_eq!(snapback4_core::ir::scans(&program.program).len(), 2,
            "{} must exercise value and null lanes", program.program.name);
    }
    for direction in ["first", "last"] {
        let mut engine = engine(&SOURCE.replace("first 1 ", &format!("{direction} 1 ")));
        for query in ["page", "words", "projected"] {
            let mut cursor = None;
            let mut actual = Vec::new();
            for _ in 0..6 {
                let page = engine.query(query, context(owners(), cursor)).unwrap();
                assert!(page.complete, "{query}: {page:?}");
                actual.extend(ids(&page.data));
                cursor = page.next;
                if cursor.is_none() { break; }
            }
            assert_eq!(actual, if direction == "first" { vec!["a", "b", "c", "d"] } else { vec!["d", "c", "b", "a"] }, "{query}");
        }
    }
}

#[test]
fn nullable_value_discovery_cuts_never_publish_a_prefix_cursor() {
    let mut engine = engine(SOURCE);
    for steps in 1..160 {
        engine.set_ceilings(snapback4_core::Ceilings { steps, ..Default::default() });
        for query in ["page", "words", "projected"] {
            match engine.query(query, context(owners(), None)) {
                Ok(page) if !page.complete => assert!(page.next.is_none(), "{query}, {steps} steps: {page:?}"),
                Ok(_) => {},
                Err(error) => assert_eq!(error.code, "E_BOUND", "{query}, {steps} steps: {error:?}"),
            }
        }
    }
}

#[test]
fn nullable_lists_preserve_membership_deduplication_authorization_and_cuts() {
    let mut engine = engine(SOURCE);
    for (values, expected) in [(vec![], vec![]), (vec![Value::Null, Value::Null], vec!["a", "c"]),
        (vec![Value::Id("alice".into())], vec!["b", "d"]), (owners(), vec!["a", "b", "c", "d"])] {
        let page = engine.query("all", context(values, None)).unwrap();
        assert!(page.complete && page.next.is_none(), "{page:?}");
        assert_eq!(ids(&page.data), expected);
    }
    let repeated = engine.query("all", context(vec![Value::Id("alice".into()); 3], None)).unwrap();
    let distinct = engine.query("all", context(vec![Value::Id("alice".into())], None)).unwrap();
    assert_eq!(repeated.metered.examined, distinct.metered.examined, "duplicates cannot open extra scans");
    let private = engine.query("nonuniform", context(owners(), None)).unwrap();
    assert_eq!(ids(&private.data), ["a", "b", "c", "d"]);
    assert!(!private.complete && private.next.is_none(), "{private:?}");
    engine.set_ceilings(snapback4_core::Ceilings { examined: 1, ..Default::default() });
    let cut = engine.query("all", context(owners(), None)).unwrap();
    assert!(!cut.complete && cut.next.is_none(), "{cut:?}");
}

// Inspect the actual store boundary, including generated value prefixes.
struct NoNullPrefixes(snapback4_core::rows::MemoryRows);
use snapback4_core::{rows::{Rows, Bounds, Dir}, schema::{Index, Table}, error::RuntimeError, meter::Meter};
impl Rows for NoNullPrefixes {
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> { self.0.get(table, id) }
    fn lookup(&self, table: &str, name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> { self.0.lookup(table, name, index, key) }
    fn scan(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        assert!(!prefix.contains(&Value::Null), "null prefix for {table}.{index}: {prefix:?}");
        self.0.scan(table, index, prefix, bounds, dir, limit)
    }
    fn scan_metered(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize, meter: &mut Meter) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        assert!(!prefix.contains(&Value::Null), "null prefix for {table}.{index}: {prefix:?}");
        self.0.scan_metered(table, index, prefix, bounds, dir, limit, meter)
    }
    fn count_prefix(&self, table: &str, index: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> { self.0.count_prefix(table, index, prefix, limit) }
    fn put(&self, table: &str, schema: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> { self.0.put(table, schema, row, old) }
    fn delete(&self, table: &str, schema: &Table, row: &Value) -> Result<u64, RuntimeError> { self.0.delete(table, schema, row) }
}

#[test]
fn nullable_membership_never_sends_a_null_prefix_to_the_store() {
    let bound = bound(SOURCE);
    let rows = NoNullPrefixes(Default::default());
    for (table, row) in seed() { rows.put(&table, &bound.schema.tables[&table], &row, None).unwrap(); }
    for name in ["all", "words", "projected"] {
        let program = &bound.programs.iter().find(|p| p.program.name == name).unwrap().program;
        let meter = Meter::new(Default::default(), snapback4_core::meter::Cut::Cap);
        let mut runner = snapback4_core::engine::runner::Runner::new(&rows, &bound.schema, context(owners(), None), meter, 0);
        assert!(!runner.run(program).unwrap().as_array().unwrap().is_empty());
    }
}
