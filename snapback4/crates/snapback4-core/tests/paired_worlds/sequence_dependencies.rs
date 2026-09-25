//! Author-directed lookup consumers crossed with a fresh or historical counter.
use crate::paired_worlds::*;
use serde_json::json;
use snapback4_core::{rows::Rows, Engine};
#[derive(Clone, Copy, Debug)]
pub enum Consumer { Upsert, Postcondition, Require }
pub struct Dependency { pub label: String, pub pair: Pair, pub ordinal: i64 }
fn history(_: usize, e: &mut Engine) {
    let tx = e.store_mut().transaction().unwrap();
    tx.set_sequence("parents", "p", 5).unwrap();
    tx.commit().unwrap();
}
pub fn cases() -> Vec<Dependency> {
    let mut cases = vec![];
    for consumer in [Consumer::Upsert, Consumer::Postcondition, Consumer::Require] {
        for ordinal in [1, 6] {
            let suffix = match consumer {
                Consumer::Upsert => format!("  upsert messages[parent = parent, ordinal = {ordinal}] {{ body: 'updated' }}\n"),
                Consumer::Postcondition => "  insert gates { id: 'gate', parent }\n".into(),
                Consumer::Require => format!("  require exists messages[parent = parent, ordinal = {ordinal}] else NO_MESSAGE\n"),
            };
            let source = format!("table parents:\n  public\n  sync public\ntable messages:\n  parent: parents\n  ordinal: sequence by parent\n  body: text <=40\n  unique parent, ordinal\n  public\n  insert <- allow\n  update <- allow\n  sync public\ntable gates:\n  parent: parents\n  public\n  insert <- allow\n  sync public\n  after insert <- exists messages[parent = .parent, ordinal = {ordinal}]\nmutation send(parent: parents):\n  row = insert messages {{ parent, body: 'new' }}\n{suffix}  return row\nquery one():\n  return messages['new-0']\nquery page(c: cursor ?):\n  return messages where .parent = 'p' after c first 1 by .ordinal\n");
            let mut pair = Pair::new(source, [vec![], vec![]], "alice", Operation::new("send", json!({"parent":"p"}), "alice")).query("page", json!({"c":null}));
            pair.trusted = true;
            if ordinal == 6 { pair.prepare = Some(history); }
            cases.push(Dependency { label: format!("{consumer:?}/ordinal={ordinal}"), pair, ordinal });
        }
    }
    cases
}
