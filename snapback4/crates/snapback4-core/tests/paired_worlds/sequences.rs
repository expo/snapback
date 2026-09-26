use crate::paired_worlds::*;
use serde_json::json;
use snapback4_core::{rows::Rows, Ceilings};
pub const SOURCE: &str = r#"
table parents:
  public
  sync public
table messages:
  parent: parents
  owner: principal default 'bob'
  ordinal: sequence by parent
  body: text <=40
  unique parent, body
  unique parent, ordinal
  by byOwner: owner, ordinal, id
  read <- .owner = viewer
  insert <- viewer = 'inserter'
  update <- deny
  delete <- deny
  sync to .owner
mutation add(parent: parents, body: text <=40):
  return insert messages { parent, body }
mutation absent(parent: parents, body: text <=40):
  return insert messages { parent, body } if absent
mutation put(parent: parents, body: text <=40):
  return upsert messages[parent = parent, body = body] { owner: 'bob' }
mutation position(parent: parents, body: text <=40):
  return upsert messages[parent = parent, ordinal = 1] { body }
mutation edit(parent: parents, body: text <=40):
  return update messages[parent = parent, body = body] { body: 'edited' }
mutation remove(parent: parents, body: text <=40):
  delete messages[parent = parent, body = body]
query one(parent: parents, body: text <=40):
  return messages[parent = parent, body = body]
query page(c: cursor ?):
  return messages[owner = viewer] after c first 1 by .ordinal
"#;
fn seed(ordinal: i64, body: &str) -> Seed {
    vec![("messages".into(), json!({"id":"hidden","parent":"p","owner":"bob","ordinal":ordinal,"body":body}))]
}
fn counters(world: usize, e: &mut snapback4_core::Engine) {
    let tx = e.store_mut().transaction().unwrap();
    tx.set_sequence("parents", "p", if world == 0 { 0 } else { 5 }).unwrap();
    tx.commit().unwrap();
}
pub fn pairs() -> Vec<Pair> {
    let mut pairs = vec![];
    for who in ["alice", "inserter"] {
        for op in ["add", "absent", "put", "position", "edit", "remove"] {
            for key in ["target", "missing"] {
                for variant in 0..5 {
                    let mut seeds = match variant {
                        0 => [vec![], seed(1, "target")],
                        1 => [vec![], vec![]],
                        2 => [seed(1, "target"), seed(5, "target")],
                        3 => [vec![], seed(1, "sibling")],
                        _ => [vec![], seed(1, "occupant")],
                    };
                    for seed in &mut seeds {
                        for n in 1..=3 {
                            seed.push(("messages".into(), json!({"id":format!("visible{n}"),"parent":format!("visible{n}"),"owner":who,"ordinal":n,"body":format!("visible{n}")})));
                        }
                    }
                    let source = if variant == 4 { SOURCE.replace("  by byOwner:", "  cap 1 by parent\n  by byOwner:") } else { SOURCE.into() };
                    let mut pair = Pair::new(source, seeds, who, Operation::new(op, json!({"parent":"p","body":key}), who))
                        .query("one", json!({"parent":"p","body":"target"}))
                        .query("page", json!({"c":null}));
                    pair.trusted = true;
                    if variant == 1 { pair.prepare = Some(counters); }
                    pairs.push(pair);
                }
            }
        }
    }
    pairs
}
pub fn boundary(entries: u64) -> Pair {
    let mut pair = Pair::new(SOURCE.replace("{ owner: 'bob' }", "{ owner: 'alice' }"), [vec![], seed(1, "target")], "alice", Operation::new("put",json!({"parent":"p","body":"target"}),"alice"))
        .query("one",json!({"parent":"p","body":"target"})).query("page",json!({"c":null}));
    pair.trusted = true;
    pair.ceilings = Some(Ceilings { index_entries: entries, ..Default::default() });
    pair
}
