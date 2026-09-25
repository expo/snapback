use super::*;
use snapback4_device::store::{DeviceStore, DeviceTx};
use snapback4_core::{Ceilings, engine::local, rows::Rows};

fn fifty<S: DeviceStore>(mut store: S, label: &str, boundary: bool, failures: &mut Vec<String>) {
    let source = include_str!("../../../snapback4-sim/tests/grace_effects/presence_cost.q");
    let (_, backend) = compile(source);
    assert_eq!(backend.schema.operations["send"].predicts.as_deref(), Some("eligible"));
    store.install(&backend.schema, &Default::default(), false).unwrap();
    let tx = store.transaction().unwrap();
    let room = snapback4_core::value::object([("id", id("c1")), ("title", Value::String("General".into()))]);
    tx.put("conversations", &backend.schema.tables["conversations"], &room, None).unwrap();
    let mut seed = vec![("conversations".into(), room)];
    for n in 0..50 {
        let p = match n { 0 => "dev:alice".into(), 1 => "dev:bob".into(), 2 => "dev:carol".into(), _ => format!("dev:recipient{n}") };
        let row = snapback4_core::value::object([
            ("id", id(&if n < 3 { format!("m{}", n + 1) } else { format!("member{n}") })), ("conversationId", id("c1")), ("principal", id(&p)),
        ]);
        tx.put("memberships", &backend.schema.tables["memberships"], &row, None).unwrap();
        seed.push(("memberships".into(), row));
    }
    tx.commit().unwrap();
    let program = backend.programs.iter().find(|p| p.name == "send").unwrap();
    let ctx = context("dev:alice", &[("conversationId", id("c1")), ("body", Value::String("hello".into()))]).at(11_000).with_ids(["msg".into()]);
    let meter = w15a_prediction_meter(&mut store, &backend.schema, program, ctx.clone());
    println!("w15a fifty prediction {label}: {meter:?}");
    // The membership point read reserves its server-equivalent probe even
    // when the device trusts its delivered image, in addition to insertion.
    assert_eq!(meter.iter().map(|(_, n)| *n).collect::<Vec<_>>(), [52, 2, 2, 1367, 70161, 27, 1]);
    let mut meters = Vec::new();
    for (state, live, deadline) in [("held", 1, 16_000), ("graced", 0, 36_000)] {
        let (mut engine, _) = compile(source);
        engine.seed(seed.clone()).unwrap();
        engine.set_presence(Some(std::sync::Arc::new(super::review::Poll(live, deadline))));
        let sent = engine.mutate("send", None, ctx.clone()).unwrap();
        assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
        assert_eq!(engine.effects(None, 100).unwrap().len(), 49);
        meters.push(w15a_meter_fields(sent.metered));
        if boundary {
            for ceiling in [3, 2] {
                let limits = Ceilings { rule_probes: ceiling, ..Default::default() };
                let tx = store.transaction().unwrap();
                let prediction = local::predict(&tx, &backend.schema, program, ctx.clone(), limits);
                tx.rollback().unwrap();
                assert!(prediction.is_ok(), "{label}/{ceiling}: {prediction:?}");
                let (mut engine, _) = compile(source);
                engine.seed(seed.clone()).unwrap();
                engine.set_presence(Some(std::sync::Arc::new(super::review::Poll(live, deadline))));
                engine.set_ceilings(limits);
                let sent = engine.mutate("send", None, ctx.clone()).unwrap();
                println!("w15a5 probe boundary {label}/{state} ceiling={ceiling}: prediction=accepted server={:?}", sent.state);
                if ceiling == 3 { assert!(matches!(sent.state, WriteState::Sent { .. })); }
                else if !matches!(sent.state, WriteState::Sent { .. }) {
                    assert!(matches!(&sent.state, WriteState::Failed { why, .. } if why.code == "E_BOUND"));
                    assert!(engine.effects(None, 100).unwrap().is_empty());
                    failures.push(format!("{label}/{state}: prediction accepts at rule_probes=2, server {:?}", sent.state));
                }
            }
        }
    }
    assert_i1(&format!("fifty/{label}"), meters[0], meters[1], std::array::from_fn(|i| meter[i].1));
}

#[test]
fn w15a_fifty_member_prediction_includes_read_authorization_on_both_stores() {
    fifty(snapback4_core::Store::memory().unwrap(), "sqlite", false, &mut Vec::new());
    fifty(snapback4_device::memory::MemoryStore::new(), "memory", false, &mut Vec::new());
}

#[test]
#[ignore = "pre-existing: issues/20260917-snapback4-presence-conjunction-server-charges-more-heap-than-prediction-reserves.md"]
fn w15a5_fifty_member_server_fits_prediction_rule_probe_boundary_on_both_stores() {
    let mut failures = Vec::new();
    fifty(snapback4_core::Store::memory().unwrap(), "sqlite", true, &mut failures);
    fifty(snapback4_device::memory::MemoryStore::new(), "memory", true, &mut failures);
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
