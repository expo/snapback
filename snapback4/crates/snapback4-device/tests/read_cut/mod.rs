use super::*;
#[path = "../../../snapback4-sim/tests/read_cut/fixture.rs"] mod fixture;
use serde_json::json;
#[path = "../../../snapback4-sim/tests/read_cut/point.rs"] mod point;
#[path = "../../../snapback4-sim/tests/read_cut/disclosure.rs"] mod disclosure;

fn partition_sweep<S: snapback4_device::store::DeviceStore>(mut store: S, label: &str) {
    use snapback4_core::rows::Rows;
    use snapback4_device::store::DeviceTx;
    let (mut engine, backend) = common::compile(&disclosure::source());
    store.install(&backend.schema, &Default::default(), false).unwrap();
    let mut worlds = Vec::new();
    for hidden in [0, 32, 33] {
        engine.seed(disclosure::rows(hidden)).unwrap();
        let tx = store.transaction().unwrap();
        // Seed the actual delivered partition, never hidden server rows.
        for page in common::snapshot_pages(&mut engine, "dev:alice", 1000) {
            for event in page.events {
                if let Some(data) = event.data {
                    let table = &backend.schema.tables[&event.table];
                    tx.put(&event.table, table, &snapback4_core::wire::row_from_json(table, &data).unwrap(), None).unwrap();
                }
            }
        }
        let run = |name: &str, q: &str, ceilings| {
            let program = backend.programs.iter().find(|p| p.name == name).unwrap();
            snapback4_core::engine::local::query_with_coverage(&tx, &backend.schema, program, disclosure::context(q), ceilings)
        };
        worlds.push(disclosure::sweep(|name, ceilings| {
            let (page, unknown, retained) = run(name, "secret", ceilings);
            let page = page.unwrap();
            json!({"data":snapback4_core::wire::to_json(&page.data), "complete":page.complete, "cut":page.cut,
                "next":page.next, "nextExpiry":page.next_expiry, "tables":page.tables, "unknown":unknown, "retained":retained})
        }));
        let visible = run("all", "coffee", Default::default()).0.unwrap();
        assert_eq!(visible.data.as_array().unwrap().len(), 5);
        assert!(visible.complete && visible.cut.is_none());
        disclosure::merge_cuts(label, |q, ceilings| run("merged", q, ceilings).0.unwrap());
        tx.rollback().unwrap();
    }
    assert_eq!(worlds[0], worlds[1]);
    assert_eq!(worlds[0], worlds[2]);
    println!("W8R1a disclosure host={label} hidden_words=32,33 identical_pairs={} positive_controls=3", worlds[0].len() * 2);
}

#[test]
fn full_partition_response_sweep_memory() { partition_sweep(snapback4_device::memory::MemoryStore::new(), "memory"); }
#[test]
fn full_partition_response_sweep_sqlite() { partition_sweep(snapback4_core::Store::memory().unwrap(), "sqlite"); }

fn point_probes<S: snapback4_device::store::DeviceStore>(mut store: S, label: &str) {
    use snapback4_core::rows::Rows;
    let (_, backend) = common::compile(point::SOURCE);
    store.install(&backend.schema, &Default::default(), false).unwrap();
    let tx = store.transaction().unwrap();
    // Adversarial online-only contents exercise authorization on each Rows
    // implementation. Real acquisition never delivers these hidden rows.
    for (table, row) in point::rows() { tx.put(&table, &backend.schema.tables[&table], &row, None).unwrap(); }
    let program = backend.programs.iter().find(|p| p.name == "point").unwrap();
    point::check(label, |count, key, ceilings| snapback4_core::engine::local::query(&tx, &backend.schema, program, point::context(count, key), ceilings).unwrap());
}

#[test]
fn point_probe_cut_memory() { point_probes(snapback4_device::memory::MemoryStore::new(), "memory"); }
#[test]
fn point_probe_cut_sqlite() { point_probes(snapback4_core::Store::memory().unwrap(), "sqlite"); }

#[test]
fn cut_reasons_cross_both_device_wires() {
    on_both(|host| {
        let source = format!("{}\nquery top():\n  return messages['readable'] first 1 by byTime\n", fixture::SOURCE);
        let (mut engine, backend) = common::compile(&source);
        engine.seed(fixture::seed(8_200, 0)).unwrap();
        let mut device = host.open("cuts", Some(backend)).unwrap();
        for (n, page) in common::snapshot_pages(&mut engine, "dev:alice", 4000).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        let top = query(&mut *device, "top", "dev:alice", json!({}), 10000);
        assert_eq!(rows(&top).len(), 1); assert_eq!(top["complete"], false);
        assert_eq!(top["unknown"], false, "a cursorless top-N is not a missing fact");
        let cut = query(&mut *device, "filtered", "dev:alice", json!({"roomId":"readable"}), 10000);
        assert_eq!(cut["complete"], false);
        assert_eq!(cut["cut"], "meter");
        assert_eq!(cut["unknown"], false, "a meter cut is not a missing fact");
        assert!(rows(&cut).is_empty());
        let words = query(&mut *device, "scoped", "dev:alice", json!({"roomId":"words", "q":"cof"}), 10000);
        assert_eq!(words["cut"], "words");
        assert_eq!(words["unknown"], false, "a word cut is not a missing fact");
        assert_eq!(words["complete"], false);
        assert!(!rows(&words).is_empty());
        for (term, size) in [("coffee", 10), ("absent", 0)] {
            let page = query(&mut *device, "scoped", "dev:alice", json!({"roomId":"readable", "q":term}), 10000);
            assert_eq!(rows(&page).len(), size);
            assert_eq!(page["complete"], true);
            assert_eq!(page.get("cut"), Some(&serde_json::Value::Null));
        }
    });
}

#[test]
fn held_query_answers_on_both_devices() {
    on_both(|host| {
        let source = fixture::SOURCE.replace("query all(q: text <=100, c: cursor ?):", "query all(q: text <=100, c: cursor ?) held:");
        let (mut engine, backend) = common::compile(&source);
        engine.seed(fixture::seed(20, 40)).unwrap();
        let mut device = host.open("held", Some(backend)).unwrap();
        for (n, page) in common::snapshot_pages(&mut engine, "dev:alice", 4000).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        let page = query(&mut *device, "all", "dev:alice", json!({"q":"coffee"}), 10000);
        assert_eq!(rows(&page).len(), 10);
        assert_eq!(page["complete"], true);
        assert_eq!(page.get("cut"), Some(&serde_json::Value::Null));
    });
}
