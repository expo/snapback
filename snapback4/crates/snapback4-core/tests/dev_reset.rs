//! A development reset leaves the store a new store would be: no rows, no
//! derived data, no queues, no accounts, a new identity, and a head that
//! keeps counting. A reseed is part of the same transaction.
use snapback4_core::{Context, Engine, Value, WriteState, identity, store::Store, value::object};

const SOURCE: &str = "use personas alice
table lists:
  title: text <=40
  public 'reset lists'
  insert <- allow
  sync public
table items:
  list: lists
  n: sequence by list
  text: text <=40
  unique list, text
  public 'reset items'
  insert <- allow
  sync public
view itemCount: count items by .list
mutation add(list: lists, text: text <=40):
  return insert items { list, text }
query count(list: lists):
  return itemCount[list]
";

const NOW: i64 = 1_000_000;

fn engine() -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::new_at(Store::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program), NOW).unwrap()
}

fn list(id: &str) -> (String, Value) {
    ("lists".into(), object([("id", Value::Id(id.into())), ("title", Value::String(id.into()))]))
}

fn add(engine: &mut Engine, list: &str, text: &str) -> Value {
    let context = Context::new("dev:alice", [("list".to_owned(), Value::Id(list.into())), ("text".to_owned(), Value::String(text.into()))].into()).at(NOW);
    match engine.mutate("add", None, context).unwrap().state {
        WriteState::Sent { result, .. } => result,
        other => panic!("{other:?}"),
    }
}

fn count(engine: &mut Engine, list: &str) -> Value {
    let context = Context::new("dev:alice", [("list".to_owned(), Value::Id(list.into()))].into()).at(NOW);
    engine.query("count", context).unwrap().data
}

fn dump(engine: &Engine, sql: &str) -> Vec<String> {
    let mut statement = engine.store().conn().prepare(sql).unwrap();
    statement.query_map([], |row| row.get::<_, String>(0)).unwrap().collect::<Result<_, _>>().unwrap()
}

fn rows(engine: &Engine) -> Vec<String> { dump(engine, "SELECT t || ' ' || id || ' ' || data FROM r ORDER BY t, id") }
fn index(engine: &Engine) -> Vec<String> { dump(engine, "SELECT ti || ' ' || hex(k) || ' ' || id FROM i ORDER BY ti, k") }

#[test]
fn a_reset_store_answers_like_a_new_store_under_a_new_identity() {
    let mut engine = engine();
    engine.seed_at([list("L1"), list("L2")], NOW).unwrap();
    for text in ["a", "b", "c"] { add(&mut engine, "L1", text); }
    assert_eq!(count(&mut engine, "L1"), Value::Int(3));
    let member = identity::custom_session(engine.store(), "member:1", "member", NOW, 1).unwrap();
    let worker = identity::service_session(engine.store(), "worker", NOW, 1).unwrap();
    engine.store().set_meta("schedule:nightly", "123").unwrap();
    let head = engine.store().seq().unwrap();
    let previous = engine.store().meta("store_id").unwrap().unwrap();

    let reset = engine.dev_reset_at(vec![list("L1")], NOW).unwrap();
    assert_eq!(reset.previous_store_id, previous);
    assert_ne!(reset.store_id, previous, "devices must see a new store identity");
    assert_eq!(engine.store().meta("store_id").unwrap().as_deref(), Some(reset.store_id.as_str()));
    assert_eq!(reset.seeded, 1);
    assert_eq!(reset.seq, head + 2, "the reset and its reseed are two commits above the old head");
    assert_eq!(engine.store().seq().unwrap(), reset.seq);
    assert!(reset.assets.is_empty());

    // Derived data restarts: the view counts only new writes and the sequence restarts at 1.
    assert_eq!(count(&mut engine, "L1"), Value::Int(0));
    let added = add(&mut engine, "L1", "a");
    assert_eq!(added.field("n"), Ok(&Value::Int(1)), "the unique key and the sequence restart");
    assert_eq!(count(&mut engine, "L1"), Value::Int(1));

    // The same writes on a store that never held anything leave the same rows and index entries.
    let mut fresh = self::engine();
    fresh.seed_at([list("L1")], NOW).unwrap();
    let fresh_added = add(&mut fresh, "L1", "a");
    // Minted ids differ run to run; name each by its role.
    let minted = |value: &Value| value.field("id").unwrap().as_str().unwrap().to_owned();
    let named = |lines: Vec<String>, id: String| {
        let hex: String = id.bytes().map(|b| format!("{b:02X}")).collect();
        lines.into_iter().map(|line| line.replace(&hex, "ITEM").replace(&id, "ITEM")).collect::<Vec<_>>()
    };
    assert_eq!(named(rows(&engine), minted(&added)), named(rows(&fresh), minted(&fresh_added)));
    assert_eq!(named(index(&engine), minted(&added)), named(index(&fresh), minted(&fresh_added)));

    // Accounts and their sessions go; a service seat (the dev worker, a `token`) stays.
    assert!(identity::resolve(engine.store(), &member.token, NOW).unwrap().is_none());
    assert!(identity::resolve(engine.store(), &worker.token, NOW).unwrap().is_some());
    assert_eq!(engine.store().meta("schedule:nightly").unwrap(), None, "a fresh store has no schedule boundary");
    // Nothing from before the reset remains in the commit log or the partition log.
    assert_eq!(dump(&engine, &format!("SELECT CAST(count(*) AS TEXT) FROM _commits WHERE seq <= {head}")), ["0"]);
    assert_eq!(dump(&engine, &format!("SELECT CAST(count(*) AS TEXT) FROM _log WHERE seq <= {head}")), ["0"]);
    assert_eq!(dump(&engine, &format!("SELECT kind FROM _commits WHERE seq = {}", head + 1)), ["reset"]);
}

#[test]
fn a_refused_reseed_leaves_the_store_untouched() {
    let mut engine = engine();
    engine.seed_at([list("L1")], NOW).unwrap();
    add(&mut engine, "L1", "a");
    let before = (rows(&engine), engine.store().seq().unwrap(), engine.store().meta("store_id").unwrap());
    let item = |id: &str| ("items".to_owned(), object([("id", Value::Id(id.into())), ("list", Value::Id("L1".into())), ("text", Value::String("same".into()))]));
    let refused = engine.dev_reset_at(vec![list("L1"), item("I1"), item("I2")], NOW).unwrap_err();
    assert!(refused.to_string().contains("unique") || refused.refusal().code == "E_CONSTRAINT", "{refused}");
    assert_eq!((rows(&engine), engine.store().seq().unwrap(), engine.store().meta("store_id").unwrap()), before);
    assert_eq!(count(&mut engine, "L1"), Value::Int(1));
}
