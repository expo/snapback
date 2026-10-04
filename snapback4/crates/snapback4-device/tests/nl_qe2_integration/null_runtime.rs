//! Exercise the production server and local runners over both physical stores.
use super::*;
use snapback4_core::{Ceilings, RuntimeError, engine::local, ir::ArgType, rows::Rows};
use snapback4_device::{memory::MemoryStore, store::{DeviceStore, DeviceTx}};
#[path = "../expiring_mutations/counted.rs"]
mod counted;
use counted::Counted;
use std::{cell::RefCell, collections::BTreeMap, rc::Rc};

const SOURCE: &str = include_str!("null-rule.q");

fn scenario<S: DeviceStore>(store: S) {
    let visits = Rc::new(RefCell::new(BTreeMap::new()));
    let mut store = Counted { inner: store, visits: visits.clone() };
    for (guard, conjunction) in [
        (".parent.key = null or", false),
        (".parent.key != null and", true),
        ("not (.parent.key = null) and", true),
    ] {
        let source = SOURCE.replace(".parent.key = null or", guard);
        for key in [Value::Null, id("alice"), id("missing")] {
            let mut baseline = None;
            for count in [8193, 0] {
                let (_, mut backend) = compile(&source);
                // Runtime defense is independently required below source
                // admission. Relax only these test argument types; the
                // compiled Get/Exists remains identical. Quarry still refuses
                // unguarded nullable arguments in these source queries.
                for program in &mut backend.programs {
                    if program.name == "point" || program.name == "probe" {
                        program.args.insert("key".into(), ArgType::Optional(Box::new(ArgType::Principal)));
                    }
                }
                let mut server = snapback4_core::Engine::memory(backend.schema.clone(), backend.programs.clone()).unwrap();
                let mut rows = vec![
                    ("parents".into(), object([("id", id("p")), ("key", key.clone()), ("until", Value::Int(3000))])),
                    ("keys".into(), object([("id", id("live")), ("key", id("alice")), ("until", Value::Int(2000))])),
                ];
                rows.extend((0..count).map(|n| ("keys".into(), object([
                    ("id", id(&format!("tie-{n}"))), ("key", Value::Null), ("until", Value::Int(500)),
                ]))));
                server.seed_at(rows.clone(), 0).unwrap();
                store.install(&backend.schema, &Default::default(), true).unwrap();
                let tx = store.transaction().unwrap();
                for (table, row) in &rows { tx.put(table, &backend.schema.tables[table], row, None).unwrap(); }
                visits.borrow_mut().clear();
                let program = backend.programs.iter().find(|p| p.name == "add").unwrap();
                let local = local::predict(&tx, &backend.schema, program, context("alice", &[]).at(1000), Ceilings::default());
                let sent = server.mutate("add", None, context("alice", &[]).at(1000)).unwrap();
                let allowed = key == id("alice") || (key == Value::Null && !conjunction);
                if allowed {
                    let predicted = local.unwrap();
                    let WriteState::Sent { result, .. } = sent.state else { panic!("{sent:?}"); };
                    assert_eq!(result, predicted.result);
                } else {
                    assert!(matches!(sent.state, WriteState::Failed { ref why, .. } if why.code == "E_RULE"), "{sent:?}");
                    assert!(matches!(local, Err(RuntimeError::Rule { .. })), "{local:?}");
                }
                if key == Value::Null {
                    assert!(visits.borrow().keys().all(|(table, _)| table != "keys"), "null probe accessed storage: {:?}", visits.borrow());
                }
                let evidence = (sent.metered, visits.borrow().clone());
                if let Some(previous) = &baseline { assert_eq!(&evidence, previous, "ties changed work for {key:?}/{guard}"); }
                else { baseline = Some(evidence); }

                for name in ["point", "probe"] {
                    let program = backend.programs.iter().find(|p| p.name == name).unwrap();
                    visits.borrow_mut().clear();
                    let out = local::query(&tx, &backend.schema, program, context("alice", &[("key", Value::Null)]).at(1000), Ceilings::default()).unwrap();
                    assert_eq!(out.data, if name == "point" { Value::Null } else { Value::Bool(false) });
                    assert!(out.complete && !out.unavailable, "{out:?}");
                    assert_eq!(out.next_expiry, None);
                    assert!(visits.borrow().is_empty(), "{name}: {:?}", visits.borrow());
                    let remote = server.query(name, context("alice", &[("key", Value::Null)]).at(1000)).unwrap();
                    assert_eq!(remote.data, out.data);
                    assert!(remote.complete && !remote.unavailable, "{remote:?}");
                    assert_eq!(remote.next_expiry, None);
                    assert_eq!(remote.metered, out.metered);
                    assert_eq!((remote.metered.examined, remote.metered.index_entries), (0, 0));
                }
                tx.rollback().unwrap();
            }
        }
    }
}

#[test] fn expired_null_ties_memory() { scenario(MemoryStore::new()); }
#[test] fn expired_null_ties_sqlite() {
    let host = Sqlite::new("nl-null-runtime");
    let (_, backend) = compile(SOURCE);
    drop(snapback4_device::device::Device::open(&host.path("device"), Some(backend)).unwrap());
    scenario(snapback4_core::store::Store::open(&host.path("device")).unwrap());
}
