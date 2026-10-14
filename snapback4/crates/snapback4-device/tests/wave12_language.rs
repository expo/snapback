//! Wave 12 language parity on the web-memory and SQLite device stores.
mod common;
use common::{Host, Memory, Sqlite, compile, id, snapshot_pages, stream_page};
use serde_json::json;
use snapback4_core::{Context, Value, WriteState};

const SOURCE: &str = r#"
table entries:
  category: enum('coffee-shop', 'book_store', 'museum')
  contact: text 3..254 format email
  amount: decimal 2
  search category
  public 'wave 12 device fixture'
  insert <- allow
  sync public
view total: count entries
mutation add(id: id, category: enum('coffee-shop', 'book_store', 'museum'), contact: text 3..254 format email, amount: decimal 2):
  return insert entries { id, category, contact, amount }
query totalEntries():
  return total
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

fn parity<H: Host>(host: &mut H) {
    let (mut server, backend) = compile(SOURCE);
    server.seed([
        ("entries".into(), snapback4_core::value::object([
            ("id", id("a")), ("category", Value::String("coffee-shop".into())),
            ("contact", Value::String("a@example.com".into())), ("amount", Value::Int(5)),
        ])),
        ("entries".into(), snapback4_core::value::object([
            ("id", id("b")), ("category", Value::String("book_store".into())),
            ("contact", Value::String("b@example.com".into())), ("amount", Value::Int(-5)),
        ])),
    ]).unwrap();
    let mut device = host.open("alice", Some(backend)).unwrap();
    let pages = snapshot_pages(&mut server, "alice", 100);
    for (index, page) in pages.iter().enumerate() { device.apply(page, index == 0).unwrap(); }

    assert_eq!(device.query("totalEntries", "alice", &json!({}), 10).unwrap().data, Value::Int(2));
    assert_eq!(device.query("extrema", "alice", &json!({}), 10).unwrap().data,
        snapback4_core::value::object([("low", Value::Int(-5)), ("high", Value::Int(5)), ("sum", Value::Int(0))]));
    assert_eq!(device.query("rounded", "alice", &json!({"value":5}), 10).unwrap().data,
        Value::Array(vec![Value::Int(2), Value::Int(3)]));
    assert_eq!(device.query("average", "alice", &json!({"total":101,"count":2}), 10).unwrap().data, Value::Int(5050));
    assert_eq!(device.query("average", "alice", &json!({"total":-1,"count":8}), 10).unwrap().data, Value::Int(-12));
    assert_eq!(device.query("email", "alice", &json!({"value":"a@localhost"}), 10).unwrap().data,
        Value::String("a@localhost".into()));
    assert_eq!(device.query("email", "alice", &json!({"value":"a..b@example.com"}), 10).unwrap_err().code, "E_INPUT");
    let hits = device.query("search", "alice", &json!({"q":"cof","c":null}), 10).unwrap();
    assert_eq!(hits.data.as_array().unwrap().len(), 1);
    assert_eq!(hits.data.as_array().unwrap()[0].field("id").unwrap(), &id("a"));

    let watermark = pages.last().unwrap().watermark;
    let result = server.mutate("add", None, Context::new("alice", [
        ("id".into(), id("c")), ("category".into(), Value::String("museum".into())),
        ("contact".into(), Value::String("c@example.com".into())), ("amount".into(), Value::Int(9)),
    ].into_iter().collect())).unwrap();
    assert!(matches!(result.state, WriteState::Sent { .. }), "{result:?}");
    device.apply(&stream_page(&mut server, "alice", watermark), false).unwrap();
    assert_eq!(device.query("totalEntries", "alice", &json!({}), 10).unwrap().data, Value::Int(3));
    host.close("alice", device);
    let mut reopened = host.open("alice", None).unwrap();
    assert_eq!(reopened.query("totalEntries", "alice", &json!({}), 10).unwrap().data, Value::Int(3),
        "the compiler-owned global discriminator survives store reopen");
    host.close("alice", reopened);
}

#[test]
fn wave12_semantics_match_on_both_device_stores() {
    parity(&mut Memory::new());
    parity(&mut Sqlite::new("wave12-language"));
}
