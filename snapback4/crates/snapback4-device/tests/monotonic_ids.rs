//! P11: the same live host preserves mint order across separate mutations.
mod common;
use common::*;
use snapback4_core::{Context, Value, WriteState, wire};
use serde_json::json;

const SOURCE: &str = "table entries:\n  label: text\n  read <- allow\n  insert <- allow\n  sync\nmutation add(label: text):\n  return insert entries { label: label }\nquery ordered():\n  return entries first 10 by .id\n";

fn scenario<H: Host>(host: &mut H, admission: bool) {
    let (mut server, backend) = compile(SOURCE);
    let mut device = host.open("mint", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut server, "alice", 20).iter().enumerate() {
        device.apply(page, n == 0).unwrap();
    }
    let mut server_ids = Vec::new();
    let mut device_ids = Vec::new();
    // Separate mutations, no client-supplied ids, exactly the same clock.
    // Add a regression too: logical mint time never decreases.
    for (label, now) in [("first", 2_000), ("second", 2_000), ("rollback", 1_000)] {
        let outcome = server.mutate("add", None,
            Context::new("alice", args(&[("label", Value::String(label.into()))])).at(now)).unwrap();
        let WriteState::Sent { result, .. } = outcome.state else { panic!("{outcome:?}") };
        let result = wire::to_json(&result);
        server_ids.push(result["id"].as_str().unwrap().to_owned());
        let ids = if admission {
            let queued = serde_json::from_value(json!({"id":format!("write-{label}"),"seq":0,"op":"add","args":{"label":label},"viewer":"alice","now":now,"predictable":true})).unwrap();
            let admitted = device.admit(queued).unwrap();
            assert!(admitted.predictable, "{admitted:?}");
            admitted.new_ids
        } else {
            device.predict("add", "alice", &json!({"label":label}), now, vec![], 1).unwrap().new_ids
        };
        assert_eq!(ids.len(), 1);
        device_ids.push(ids[0].clone());
    }
    for ids in [&server_ids, &device_ids] {
        assert!(ids.windows(2).all(|pair| pair[0] < pair[1]), "{ids:?}");
        assert!(ids.iter().all(|id| snapback4_core::ids::minted_at(id) == Some(2_000)));
    }
    let remote = server.query("ordered", Context::new("alice", args(&[])).at(2_000)).unwrap();
    let local = device.query("ordered", "alice", &json!({}), 2_000).unwrap();
    let labels = |data: &Value| wire::to_json(data).as_array().unwrap().iter()
        .map(|row| row["label"].as_str().unwrap().to_owned()).collect::<Vec<_>>();
    assert_eq!(labels(&remote.data), ["first", "second", "rollback"]);
    assert_eq!(labels(&local.data), ["first", "second", "rollback"]);
}

#[test]
fn frozen_millisecond_mutation_order_memory() { for admission in [false, true] { scenario(&mut Memory::new(), admission); } }
#[test]
fn frozen_millisecond_mutation_order_sqlite() { for admission in [false, true] { scenario(&mut Sqlite::new("monotonic-ids"), admission); } }
