use super::*;
use snapback4_core::engine::local;
use snapback4_core::rows::Rows;
use snapback4_device::store::{DeviceStore, DeviceTx};
#[path = "../../../snapback4-sim/tests/common/merge_cursor.rs"] mod fixture;

fn cut<S: DeviceStore>(mut store: S, cross: bool) {
    let (_, backend) = compile(&fixture::source(cross, false));
    store.install(&backend.schema, &Default::default(), false).unwrap();
    let tx = store.transaction().unwrap();
    // Online-only rows deliberately exercise per-row authority on each real
    // store; synced devices receive only readable rows and cannot hold this run.
    for (table, row) in fixture::seed(cross, fixture::CEILING + 1, Some(15)) { tx.put(&table, &backend.schema.tables[&table], &row, None).unwrap(); }
    fixture::check_cut(|cursor| local::query(&tx, &backend.schema, &backend.programs[0], fixture::context(cursor), snapback4_core::Ceilings::default()).unwrap());
}

#[test] fn cross_table_hidden_cut_memory() { cut(snapback4_device::memory::MemoryStore::new(), true); }
#[test] fn cross_table_hidden_cut_sqlite() { cut(snapback4_core::Store::memory().unwrap(), true); }
#[test] fn single_table_hidden_cut_memory() { cut(snapback4_device::memory::MemoryStore::new(), false); }
#[test] fn single_table_hidden_cut_sqlite() { cut(snapback4_core::Store::memory().unwrap(), false); }

fn uniform_cuts<S: DeviceStore>(mut store: S) {
    for cross in [false, true] {
        let (_, backend) = compile(&fixture::expiring_source(cross));
        store.install(&backend.schema, &Default::default(), false).unwrap();
        let tx = store.transaction().unwrap();
        for (table, row) in fixture::expired_seed(cross) { tx.put(&table, &backend.schema.tables[&table], &row, None).unwrap(); }
        fixture::check_cut(|cursor| local::query(&tx, &backend.schema, &backend.programs[0], fixture::context(cursor), snapback4_core::Ceilings::default()).unwrap());
        tx.rollback().unwrap();
    }
}

#[test] fn uniform_eager_and_lazy_cuts_memory() { uniform_cuts(snapback4_device::memory::MemoryStore::new()); }
#[test] fn uniform_eager_and_lazy_cuts_sqlite() { uniform_cuts(snapback4_core::Store::memory().unwrap()); }

fn pairs<S: DeviceStore>(mut store: S) {
    let mut pairs = 0;
    for cross in [false, true] {
        let (_, backend) = compile(&fixture::source(cross, false));
        store.install(&backend.schema, &Default::default(), false).unwrap();
        for competing in [None, Some(5)] {
            let mut expected = None;
            for hidden in [0, fixture::CEILING - 2, fixture::CEILING - 1, fixture::CEILING, fixture::CEILING + 1] {
                let tx = store.transaction().unwrap();
                for (table, row) in fixture::seed(cross, hidden, competing) { tx.put(&table, &backend.schema.tables[&table], &row, None).unwrap(); }
                let (read, unknown, retained) = local::query_with_coverage(&tx, &backend.schema, &backend.programs[0], fixture::context(None), snapback4_core::Ceilings::default());
                let read = read.unwrap();
                // All fields from the device query dispatcher, including null
                // next, expiry, dependencies and coverage; no data-only projection.
                let body = serde_json::to_vec(&serde_json::json!({"ok":{"data":snapback4_core::wire::to_json(&read.data),"complete":read.complete,"next":read.next,"nextExpiry":read.next_expiry,"tables":read.tables,"unknown":unknown,"retained":retained}})).unwrap();
                if let Some(expected) = &expected { assert_eq!(&body, expected, "cross={cross} hidden={hidden} competing={competing:?}"); pairs += 1; }
                else { expected = Some(body); }
                tx.rollback().unwrap();
            }
        }
    }
    println!("merge device wire pairs: {pairs}");
}

#[test] fn hidden_absent_wire_pairs_memory() { pairs(snapback4_device::memory::MemoryStore::new()); }
#[test] fn hidden_absent_wire_pairs_sqlite() { pairs(snapback4_core::Store::memory().unwrap()); }

#[test]
fn equal_keys_and_cross_generation_cursor_on_both_devices() {
    on_both(|host| {
        for cross in [false, true] {
            let (mut engine, backend) = compile(&fixture::source(cross, true));
            engine.seed(fixture::equal_rows(cross)).unwrap();
            let generation = engine.generation();
            let backend = snapback4_device::device::Backend { generation, ..backend };
            let mut device = host.open(&format!("merge-{cross}"), Some(backend)).unwrap();
            for (i, page) in snapshot_pages(&mut engine, "alice", 100).iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
            let mut cursor = serde_json::Value::Null;
            for expected in ["z", "y", "x"] {
                let page = query(&mut *device, "feed", "alice", serde_json::json!({"c":cursor}), 100_000);
                assert_eq!(page["complete"], true);
                assert_eq!(rows(&page).iter().map(|r| r["id"].as_str().unwrap()).collect::<Vec<_>>(), [expected]);
                cursor = page["next"].clone();
                assert_eq!(!cursor.is_null(), expected != "x");
            }
            let first = query(&mut *device, "feed", "alice", serde_json::json!({}), 100_000);
            let next_source = fixture::source(cross, true).replace("  owner: principal", "  owner: principal\n  label: text <=10 default 'new'");
            let (_, mut next) = compile(&next_source);
            engine.adopt(next.schema.clone(), next.programs.clone()).unwrap();
            assert_eq!(engine.generation(), generation + 1);
            next.generation = engine.generation();
            ok(device.call(serde_json::json!({"op":"adopt", "viewer": "dev:bob", "backend":next})));
            for (i, page) in snapshot_pages(&mut engine, "alice", 100).iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
            let second = query(&mut *device, "feed", "alice", serde_json::json!({"c":first["next"]}), 100_000);
            assert_eq!(rows(&second)[0]["id"], "y");
            let (_, mut changed) = compile(&next_source.replace("last 1 by", "first 1 by"));
            engine.adopt(changed.schema.clone(), changed.programs.clone()).unwrap();
            changed.generation = engine.generation();
            ok(device.call(serde_json::json!({"op":"adopt", "viewer": "dev:bob", "backend":changed})));
            for (i, page) in snapshot_pages(&mut engine, "alice", 100).iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
            let refusal = device.call(serde_json::json!({"op":"query","name":"feed","viewer":"alice","args":{"c":first["next"]},"now":100_000}));
            assert_eq!(refusal["ok"]["denied"]["code"], "E_INPUT", "{refusal}");
            device.close();
        }
    });
}
