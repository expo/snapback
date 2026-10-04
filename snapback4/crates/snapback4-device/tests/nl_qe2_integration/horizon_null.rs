//! Grok's horizon reproduction: a null point is known without acquisition of
//! its key, including when `not` preserves a reference term's non-invariance.
use super::*;
use snapback4_core::RuntimeError;

fn scenario<H: Host>(host: &mut H) {
    for (case, guard) in [
        ("or", ".parent.low = null or"),
        ("not-and", "not (.parent.low = null) and"),
        ("ne-and", ".parent.low != null and"),
    ] {
        let source = format!("{PARENTS}
table conversations:
  low: principal ?
  high: principal ?
  at: time
  unique pair: low, high
  public
  sync public last 3 by .at
table children:
  parent: parents
  public
  sync public
  insert <- {guard} exists conversations[low = .parent.low, high = viewer]
mutation add(id: children, parent: parents):
  return insert children {{ id, parent }}
");
        let (mut server, backend) = compile(&source);
        let mut rows = Vec::new();
        for (name, low) in [("p-null", Value::Null), ("p-present", id("recent-2")), ("p-outside", id("alice"))] {
            rows.push(("parents".into(), object([("id", id(name)), ("owner", id("alice")), ("low", low), ("high", Value::Null)])));
        }
        for (at, low) in [Value::Null, id("alice"), id("recent-2"), id("recent-3"), id("recent-4")].into_iter().enumerate() {
            rows.push(("conversations".into(), object([("id", id(&format!("c-{at}"))), ("low", low), ("high", id("alice")), ("at", Value::Int(at as i64))])));
        }
        server.seed(rows).unwrap();
        let mut device = host.open(case, Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut server, "alice", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        let held = device.store().raw_rows("conversations");
        assert_eq!(held.len(), 3);
        assert!(held.iter().all(|row| row.field("low") != Ok(&Value::Null) && row.field("low") != Ok(&id("alice"))));
        for parent in ["p-null", "p-present", "p-outside"] {
            let input = [("id", id(&format!("child-{parent}"))), ("parent", id(parent))];
            let remote = server.mutate("add", None, context("alice", &input).at(1000)).unwrap();
            let local = device.predict("add", "alice", &snapback4_core::wire::to_json(&object(input)), 1000, vec![], 0);
            if parent == "p-null" && case != "or" {
                assert!(matches!(remote.state, WriteState::Failed { ref why, .. } if why.code == "E_RULE"), "{case}: {remote:?}");
                assert!(matches!(local, Err(RuntimeError::Rule { .. })), "{case}: {local:?}");
            } else {
                let WriteState::Sent { result, .. } = remote.state else { panic!("{case}/{parent}: {remote:?}"); };
                if parent == "p-outside" {
                    // A non-null key outside the horizon still needs evidence.
                    // The null miss must not turn unrelated unknowns into facts.
                    assert!(matches!(local, Err(RuntimeError::Prediction(_))), "{case}: {local:?}");
                } else {
                    assert_eq!(local.unwrap().result, snapback4_core::wire::to_json(&result), "{case}/{parent}");
                }
            }
        }
        host.close(case, device);
    }
}

#[test] fn null_hop_with_horizon_memory() { scenario(&mut Memory::new()); }
#[test] fn null_hop_with_horizon_sqlite() { scenario(&mut Sqlite::new("nl-hop-horizon")); }
