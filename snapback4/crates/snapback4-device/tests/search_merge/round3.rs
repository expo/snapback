use super::*;

const SOURCE: &str = include_str!("../../../snapback4-sim/tests/search_merge/round3.q");

fn admitted_words<S: snapback4_device::store::DeviceStore>(mut store: S) {
    use snapback4_core::{engine::{local, runner::Runner}, meter::{Ceilings, Cut, Meter}, rows::Rows};
    let (_, backend) = compile(SOURCE);
    store.install(&backend.schema, &Default::default(), true).unwrap();
    let tx = store.transaction().unwrap();
    let member = |room: &str| snapback4_core::value::object([("id", id(room)), ("roomId", id(room)), ("principal", id("alice"))]);
    let message = |name: &str, room: &str, author: &str, body: &str| snapback4_core::value::object([("id", id(name)), ("roomId", id(room)), ("authorId", id(author)), ("body", Value::String(body.into()))]);
    for room in ["r1", "r2"] { tx.put("members", &backend.schema.tables["members"], &member(room), None).unwrap(); }
    tx.put("messages", &backend.schema.tables["messages"], &message("shown", "r2", "alice", "coffee"), None).unwrap();
    // Online-only candidates exercise per-row authority on both real stores,
    // as in the membership and R2 suites; this is not a sync audience claim.
    let program = &backend.programs[0];
    let mut worlds = Vec::new();
    let mut cuts = Vec::new();
    for population in [0, 33] {
        for n in 0..population { tx.put("messages", &backend.schema.tables["messages"], &message(&format!("hidden{n}"), "r1", "bob", &format!("cof{n:02}")), None).unwrap(); }
        worlds.push(local::query(&tx, &backend.schema, program, context("alice", &[("c", Value::Null)]).at(100), Ceilings::default()).unwrap());
        for cut in [Cut::Cap, Cut::Abort] {
            let mut runner = Runner::new(&tx, &backend.schema, context("alice", &[("c", Value::Null)]).at(100), Meter::new(Ceilings::default(), cut), 0);
            cuts.push(runner.run(program).map(|data| snapback4_core::wire::to_json(&data)).map_err(|error| error.refusal()));
        }
    }
    println!("R3 device: W0={} W1={}", serde_json::to_string(&worlds[0]).unwrap(), serde_json::to_string(&worlds[1]).unwrap());
    assert_eq!(worlds[0].data.as_array().unwrap().len(), 1);
    assert!(worlds[0].next.is_none(), "non-uniform merges withhold the shared continuation in both worlds");
    assert_eq!((&worlds[0].data, &worlds[0].next, worlds[0].complete), (&worlds[1].data, &worlds[1].next, worlds[1].complete));
    assert!(!worlds[0].complete);
    assert!(worlds.iter().all(|page| page.capped_at.is_none()));
    for result in cuts { assert_eq!(result.unwrap(), snapback4_core::wire::to_json(&worlds[0].data)); }
}

#[test]
fn r3_admitted_hidden_words_memory() { admitted_words(snapback4_device::memory::MemoryStore::new()); }

#[test]
fn r3_admitted_hidden_words_sqlite() {
    let host = Sqlite::new("r3-words");
    let path = host.path("words");
    let (_, backend) = compile(SOURCE);
    drop(snapback4_device::device::Device::open(&path, Some(backend)).unwrap());
    admitted_words(snapback4_core::Store::open(&path).unwrap());
}
