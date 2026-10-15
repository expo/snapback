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

const EXPIRY_RESET: &str = "table aFree:
  until: time
  expire at .until
  public
table zBlocked:
  until: time
  expire at .until
  public
table zReferences:
  root: zBlocked on delete restrict
  public
";

fn expiry_engine() -> Engine {
    let bound = snapback4_lang::compile(&[("expiry-reset.q".into(), EXPIRY_RESET.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::new_at(Store::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program), 0).unwrap()
}

fn expiring(table: &str, id: &str) -> (String, Value) {
    (table.into(), object([("id", Value::Id(id.into())), ("until", Value::Int(10))]))
}

/// A successful reset creates a fresh store identity and therefore a fresh
/// bounded expiry walk. A refused reset leaves both the store and its walk
/// continuation untouched.
#[test]
fn reset_restarts_the_expiry_walk_only_after_commit() {
    let blocked_seed = || [
        expiring("aFree", "a"),
        expiring("zBlocked", "z"),
        ("zReferences".into(), object([
            ("id", Value::Id("w".into())),
            ("root", Value::Id("z".into())),
        ])),
    ];

    let mut refused = expiry_engine();
    refused.seed_at(blocked_seed(), 0).unwrap();
    assert_eq!(refused.sweep_expired(10, 1).unwrap(), 0, "the reverse table walk first retains zBlocked");
    assert!(refused.dev_reset_at(vec![("aFree".into(), Value::Null)], 0).is_err());
    assert_eq!(refused.sweep_expired(10, 1).unwrap(), 1, "a refused reset preserves the cursor that rotates next to aFree");
    assert!(refused.store().rows("aFree").unwrap().is_empty());
    assert_eq!(refused.store().rows("zBlocked").unwrap().len(), 1);

    let mut committed = expiry_engine();
    committed.seed_at(blocked_seed(), 0).unwrap();
    assert_eq!(committed.sweep_expired(10, 1).unwrap(), 0);
    committed.dev_reset_at(vec![expiring("aFree", "a"), expiring("zBlocked", "z")], 0).unwrap();
    assert_eq!(committed.sweep_expired(10, 1).unwrap(), 1);
    assert_eq!(committed.store().rows("aFree").unwrap().len(), 1, "the fresh reverse walk has not reached aFree");
    assert!(committed.store().rows("zBlocked").unwrap().is_empty(), "the fresh reverse walk starts at zBlocked");
}

/// A reset empties every table together, so no referential action runs and
/// no reference is left naming a removed row (LLP 3000.039 §6.5); the reseed
/// rebuilds the reference indexes, so the next delete cascades and restricts
/// over exactly the reseeded rows.
#[test]
fn a_reset_bypasses_referential_actions_and_the_reseed_feeds_them() {
    let source = "use personas alice
table boards:
  public 'boards'
  delete <- allow
table cards:
  board: boards on delete cascade
  cap 10 by board
  public 'cards'
  delete <- allow
table pins:
  card: cards
  public 'pins'
mutation drop(id: boards):
  delete boards[id]
";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::new_at(Store::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program), NOW).unwrap();
    let row = |table: &str, fields: &[(&str, &str)]| (table.to_owned(), object(fields.iter().map(|(k, v)| (*k, Value::Id((*v).into())))));
    // A pin restricts the board's cascade: an ordinary delete refuses.
    engine.seed_at([row("boards", &[("id", "B")]), row("cards", &[("id", "C"), ("board", "B")]), row("pins", &[("id", "P"), ("card", "C")])], NOW).unwrap();
    let drop = |engine: &mut Engine, board: &str| match engine.mutate("drop", None, Context::new("dev:alice", [("id".to_owned(), Value::Id(board.into()))].into()).at(NOW)).unwrap().state {
        WriteState::Sent { .. } => "ok".to_owned(),
        WriteState::Failed { why, .. } => why.code,
    };
    assert_eq!(drop(&mut engine, "B"), "E_REFERENCED");
    // The reset empties boards, cards and pins at once; it refuses nothing.
    engine.dev_reset_at(vec![row("boards", &[("id", "B2")]), row("cards", &[("id", "C2"), ("board", "B2")])], NOW).unwrap();
    assert_eq!(rows(&engine).iter().filter(|r| r.contains(" B ") || r.contains(" C ") || r.contains(" P ")).count(), 0);
    // The reseeded card is found through its reference index: the cascade takes it.
    assert_eq!(drop(&mut engine, "B2"), "ok");
    assert!(engine.store().rows("cards").unwrap().is_empty());
}

#[test]
fn reset_primes_the_next_schedule_boundary_and_rolls_back_on_a_bad_seed() {
    let source = format!("{SOURCE}\njob sweep():\n  for row in lists:\n    delete lists[row]\nschedule daily every 1d at 02:00: schedule.sweep\n");
    let bound = snapback4_lang::compile(&[("schedule.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::new_at(Store::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program), NOW).unwrap();
    engine.fire_schedules(NOW).unwrap();
    let next = NOW + 2 * 86_400_000;
    assert_eq!(engine.fire_schedules(next).unwrap(), ["daily"]);
    engine.dev_reset_at(vec![], NOW).unwrap();
    assert!(engine.fire_schedules(NOW).unwrap().is_empty());
    assert_eq!(engine.fire_schedules(next).unwrap(), ["daily"]);
    assert!(engine.fire_schedules(next).unwrap().is_empty(), "one fire per boundary");
    let before = dump(&engine, "SELECT key || '=' || value FROM _meta WHERE key LIKE 'schedule%' ORDER BY key");
    assert!(engine.dev_reset_at(vec![("lists".into(), Value::Null)], NOW).is_err());
    assert_eq!(dump(&engine, "SELECT key || '=' || value FROM _meta WHERE key LIKE 'schedule%' ORDER BY key"), before);
}
