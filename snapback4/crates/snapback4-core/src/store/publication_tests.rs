//! Commit facts versus the old re-reads, at the worker's publication boundary.
use crate::{Context, Engine, Program, Schema, Value, WriteState, store_port::AnyStore};
use crate::engine::{DurablePublication, command::{Command, Queue}};
use std::sync::{Arc, Barrier};

const SOURCE: &str = "table notes:\n  n: int\n  public\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public\nmutation put(key: id, n: int):\n  upsert notes[key] { n }\n  return n\nquery peek(key: id):\n  return notes[key]\nmutation refuse():\n  require false else NO\n";
fn bound(source: &str) -> (Schema, Vec<Program>) {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    (serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap(), b.programs.into_iter().map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect())
}
fn context(n: i64) -> Context {
    Context::new("alice", [("key".into(), Value::Id("n1".into())), ("n".into(), Value::Int(n))].into()).at(1000)
}
fn compare(engine: &Engine, carried: &DurablePublication) {
    assert_eq!(carried.head, engine.seq().unwrap());
    assert_eq!(Some(&carried.store_id), engine.store().store_identity().unwrap().as_ref());
    assert_eq!(carried.generation, engine.generation());
    assert_eq!(carried.preserved, engine.store().preserved_between(engine.schema(), carried.head - 1, carried.head));
}
pub(crate) fn check_store(store: AnyStore) {
    let (schema, programs) = bound(SOURCE);
    let engine = Engine::new_at(store, schema, programs, 1000).unwrap();
    let queue = Arc::new(Queue::start(engine, 32).unwrap());
    let start = Arc::new(Barrier::new(17));
    let handles: Vec<_> = (0..16).map(|n| {
        let (queue, start) = (queue.clone(), start.clone());
        std::thread::spawn(move || {
            start.wait();
            queue.submit(Command::new(move |engine| {
                let ack = engine.mutate_acknowledged("put", Some(&format!("op-{n}")), context(n)).unwrap();
                let carried = ack.publication.unwrap();
                // This synchronous stage precedes acknowledgement and the next command.
                compare(engine, &carried);
                let mut read = context(0); read.args.remove("n");
                assert_eq!(engine.query("peek", read).unwrap().data.field("n").unwrap(), &Value::Int(n));
                assert!(matches!(ack.outcome.state, WriteState::Sent { seq, .. } if seq == carried.head));
                carried.head
            })).unwrap().wait().unwrap()
        })
    }).collect();
    start.wait();
    let mut heads: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    heads.sort(); assert_eq!(heads, (1..=16).collect::<Vec<_>>());
    queue.call(Command::new(|engine| {
        let replay = engine.mutate_acknowledged("put", Some("op-0"), context(0)).unwrap();
        assert!(replay.outcome.replayed); assert!(replay.publication.is_none());
        let (schema, programs) = bound(&SOURCE.replace("return notes[key]", "return notes[key] ! else MISSING"));
        let previous = engine.generation();
        engine.adopt_at(schema, programs, 1000).unwrap();
        assert!(engine.generation() > previous);
        let ack = engine.mutate_acknowledged("put", Some("after-adoption"), context(99)).unwrap();
        compare(engine, ack.publication.as_ref().unwrap());
        let refusal = engine.mutate_acknowledged("refuse", Some("refusal"), Context::new("alice", Default::default()).at(1000)).unwrap();
        assert!(matches!(refusal.outcome.state, WriteState::Failed { .. }));
        assert!(refusal.publication.is_none());
    })).unwrap();
}
#[test]
fn publication_sqlite_concurrent_commands_and_adoption_match_rereads() {
    check_store(AnyStore::memory().unwrap());
}
#[test]
fn publication_sqlite_reset_uses_new_incarnation() {
    let (schema, programs) = bound(SOURCE);
    let mut engine = Engine::new_at(AnyStore::memory().unwrap(), schema, programs, 1000).unwrap();
    let before = engine.mutate_acknowledged("put", None, context(1)).unwrap().publication.unwrap();
    let reset = engine.dev_reset_at(Vec::new(), 1000).unwrap();
    let after = engine.mutate_acknowledged("put", None, context(2)).unwrap().publication.unwrap();
    compare(&engine, &after);
    assert_ne!(before.store_id, after.store_id);
    assert_eq!(after.store_id, reset.store_id);
}

#[cfg(unix)]
#[test]
fn publication_sqlite_ownership_loss_exposes_no_new_commit_facts() {
    let directory = std::env::temp_dir().join(format!("sb4-rt1-owner-{:x}", crate::ids::seed()));
    std::fs::create_dir(&directory).unwrap();
    let path = directory.join("store.db");
    let (schema, programs) = bound(SOURCE);
    let mut store = AnyStore::open(&path).unwrap();
    store.retain_ownership(Arc::new(std::fs::File::create(directory.join("owner")).unwrap())).unwrap();
    let mut engine = Engine::new_at(store, schema, programs, 1000).unwrap();
    let ack = engine.mutate_acknowledged("put", None, context(1)).unwrap();
    compare(&engine, ack.publication.as_ref().unwrap());
    std::fs::hard_link(&path, directory.join("alias.db")).unwrap();
    assert!(engine.mutate_acknowledged("put", None, context(2)).is_err());
    assert!(engine.seq().is_err());
    drop(engine);
    std::fs::remove_dir_all(directory).unwrap();
}
