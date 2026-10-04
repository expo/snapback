use super::*;
use snapback4_core::{Ceilings, Context, Presence, engine::local, rows::Rows};
use snapback4_device::store::{DeviceStore, DeviceTx};

#[derive(Debug)]
pub(super) struct Poll(pub(super) u64, pub(super) i64);
impl Presence for Poll {
    fn connections(&self, _: &str) -> u64 { self.0 }
    fn effect_presence(&self, _: &str) -> (u64, Option<i64>) { (self.0, Some(self.1)) }
}

#[test]
fn w15a6_composition_inherits_only_conjunction_excess_on_both_stores() {
    presence_meter::inherited_excess_witness(snapback4_core::Store::memory().unwrap(), "sqlite");
    presence_meter::inherited_excess_witness(snapback4_device::memory::MemoryStore::new(), "memory");
}

fn composition<S: DeviceStore>(mut store: S, label: &str, op: &str) {
    let source = include_str!("../../../snapback4-sim/tests/grace_effects/compositions.q");
    let (_, backend) = compile(source);
    assert_eq!(backend.schema.operations[op].predicts.as_deref(), Some("eligible"));
    store.install(&backend.schema, &Default::default(), false).unwrap();
    let ctx = || Context::new("alice", [("p".into(), id("bob"))].into()).at(11_000).with_ids(["note".into()]);
    let program = backend.programs.iter().find(|p| p.name == op).unwrap();
    let predicted = w15a_prediction_meter(&mut store, &backend.schema, program, ctx());
    let expected = if op == "complementary" { [0, 1, 0, 25, 2737, 9, 1] } else { [0, 1, 0, 28, 3863, 9, 1] };
    assert_eq!(predicted.iter().map(|(_, n)| *n).collect::<Vec<_>>(), expected, "R1 {op}/{label}");
    let tx = store.transaction().unwrap();
    let prediction = local::predict(&tx, &backend.schema, program, ctx(), Ceilings::default()).unwrap();
    let rows = vec![tx.get("notes", "note").unwrap().unwrap()];
    tx.rollback().unwrap();
    let mut meters = Vec::new();
    for (state, live, deadline) in [("held", 1, 16_000), ("graced", 0, 36_000)] {
        let (mut engine, _) = compile(source);
        engine.set_presence(Some(std::sync::Arc::new(Poll(live, deadline))));
        let sent = engine.mutate(op, None, ctx()).unwrap();
        assert!(matches!(&sent.state, WriteState::Sent { result, .. } if *result == prediction.result), "{sent:?}");
        assert_eq!(engine.store().rows("notes").unwrap(), rows, "{op}/{label}/{state}: prediction rows");
        let effects = engine.effects(None, 10).unwrap();
        assert_eq!(effects.len(), if op == "complementary" && live > 0 { 2 } else { 1 });
        assert_eq!(effects.iter().filter(|e| e.next_at == Some(deadline)).count(), 1);
        assert_eq!(effects.iter().filter(|e| e.next_at.is_none()).count(), usize::from(op == "complementary" && live > 0));
        if op == "sharedPayload" { assert_eq!(effects[0].payload.field("online").unwrap(), &Value::Bool(live > 0)); }
        let used = w15a_meter_fields(sent.metered);
        if state == "graced" {
            let expected = if op == "complementary" { [0, 1, 0, 23, 2630, 9, 1] } else { [0, 1, 0, 26, 3656, 9, 1] };
            assert_eq!(used, expected, "R2 {op}/{label}");
        }
        meters.push((state, used));
    }
    println!("w15a4 {op} {label}: server={meters:?} prediction={predicted:?}");
    assert_i1(&format!("{op}/{label}"), meters[0].1, meters[1].1, std::array::from_fn(|i| predicted[i].1));
}

#[test]
fn w15a4_complementary_guards_fit_prediction_on_both_stores() {
    composition(snapback4_core::Store::memory().unwrap(), "sqlite", "complementary");
    composition(snapback4_device::memory::MemoryStore::new(), "memory", "complementary");
}

#[test]
fn w15a4_shared_payload_fits_prediction_on_both_stores() {
    composition(snapback4_core::Store::memory().unwrap(), "sqlite", "sharedPayload");
    composition(snapback4_device::memory::MemoryStore::new(), "memory", "sharedPayload");
}

#[test]
fn w15a5_conjunction_fits_final_i1_on_both_stores() {
    fn scenario<S: DeviceStore>(mut store: S, label: &str) {
        let source = "effect notify\nmutation push(p: principal, q: principal):\n  if not exists connected[p] and not exists connected[q]:\n    emit notify {}\n";
        let (_, backend) = compile(source);
        assert_eq!(backend.schema.operations["push"].predicts.as_deref(), Some("eligible"));
        store.install(&backend.schema, &Default::default(), false).unwrap();
        let ctx = || context("alice", &[("p", id("bob")), ("q", id("carol"))]).at(11_000);
        let program = backend.programs.iter().find(|p| p.name == "push").unwrap();
        let prediction = w15a_prediction_meter(&mut store, &backend.schema, program, ctx());
        let mut meters = Vec::new();
        for (live, deadline) in [(1, 16_000), (0, 36_000)] {
            let (mut engine, _) = compile(source);
            engine.set_presence(Some(std::sync::Arc::new(Poll(live, deadline))));
            let sent = engine.mutate("push", None, ctx()).unwrap();
            assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
            let effects = engine.effects(None, 10).unwrap();
            assert_eq!(effects.len(), 1);
            assert_eq!(effects[0].next_at, Some(deadline));
            meters.push(w15a_meter_fields(sent.metered));
        }
        assert_i1(&format!("conjunction/{label}"), meters[0], meters[1], std::array::from_fn(|i| prediction[i].1));
    }
    scenario(snapback4_core::Store::memory().unwrap(), "sqlite");
    scenario(snapback4_device::memory::MemoryStore::new(), "memory");
}
