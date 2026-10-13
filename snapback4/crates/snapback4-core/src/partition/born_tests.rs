//! Compare partition accounting against the original scanning implementation.
use super::*;
use crate::engine::Context;
use crate::meter::{Ceilings, Cut, Meter};
use crate::store::Store;
use crate::value::object;

const SOURCE: &str = r#"
table public_rows:
  n: int
  public 'rows'
  sync public
table personal_rows:
  person: principal
  n: int
  by byPerson: person, id
  read <- .person = viewer
  sync
table members:
  group: int
  person: principal
  until: time ?
  expire at .until
  unique byGroupPerson: group, person
  by byPerson: person, group
  by byExpiry: until
  read <- .person = viewer
  sync
table messages:
  group: int
  by byGroup: group, id
  read <- exists members[.group, viewer]
  sync to members[.group]
table other_messages:
  group: int
  by byGroup: group, id
  read <- exists members[.group, viewer]
  sync to members[.group]
"#;

struct Random(u64);
impl Random {
    fn next(&mut self, n: u64) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0 % n
    }
}

fn member(id: &str, group: i64, person: &str, until: i64) -> Value {
    object([("id", Value::Id(id.into())), ("group", Value::Int(group)),
        ("person", Value::Id(person.into())), ("until", Value::Int(until))])
}

#[test]
fn randomized_commits_match_original_events_and_meter() {
    // An online-only target exercises birth bookkeeping without row events.
    let source = format!("{SOURCE}\n{}", SOURCE[SOURCE.find("table members:").unwrap()..]
        .replace("members", "private_members").replace("messages", "private_messages")
        .replace("  sync\n", "  online only\n"));
    let bound = snapback4_lang::compile(&[("born-equivalence.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    // The compiler's dev-dependency links the non-test instance of core.
    let schema: Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&bound.schema).unwrap()).unwrap();
    for seed in 1..=64 {
        let mut random = Random(seed);
        let mut store = Store::memory().unwrap();
        store.install(&schema).unwrap();
        for commit in 0..8 {
            let tx = store.transaction().unwrap();
            let now = 1_000 + commit * 100;
            let make_runner = || Runner::new(&tx, &schema, Context::system().at(now),
                Meter::new(Ceilings::unbounded(), Cut::Abort), commit as u64);
            let mut actual = make_runner();
            let mut reference = make_runner();
            let mut expected = Vec::new();
            let mut step = 0;
            let mut change = |table_name: &str, id: &str, new: Option<Value>, origin: Origin| {
                let old = tx.get(table_name, id).unwrap();
                if old.is_none() && new.is_none() { return; }
                let table = schema.table(table_name).unwrap();
                if let Some(new) = &new { tx.put(table_name, table, new, old.as_ref()).unwrap(); }
                else { tx.delete(table_name, table, old.as_ref().unwrap()).unwrap(); }
                account_row_change::<true>(&mut actual, table_name, old.as_ref(), new.as_ref(), origin).unwrap();
                born_reference::account_row_change::<true>(&mut reference, &mut expected, table_name, old.as_ref(), new.as_ref(), origin).unwrap();
                assert_eq!(actual.events.iter().collect::<Vec<_>>(), expected.iter().collect::<Vec<_>>(),
                    "seed {seed}, commit {commit}, step {step}, table {table_name}, id {id}");
                assert_eq!(actual.meter.used, reference.meter.used, "meter at seed {seed}, commit {commit}, step {step}");
                assert_eq!(actual.born_rows, reference.born_rows);
                // Timed publication can visit an empty audience before it has
                // a grant. Missing and zero counters denote the same birth count.
                let nonzero = |grants: &std::collections::HashMap<(String, String, String), usize>| grants.iter()
                    .filter(|(_, count)| **count != 0).map(|(key, count)| (key.clone(), *count)).collect::<std::collections::BTreeMap<_, _>>();
                assert_eq!(nonzero(&actual.born_grants), nonzero(&reference.born_grants));
                step += 1;
            };
            // Across commits this pins a preexisting renewal, revoke, rebirth,
            // renew and undo: the joins before the birth must survive.
            for until in [Some(now + 10), None, Some(now + 20), Some(now + 30), None, Some(now + 40)] {
                change("members", "fixed", until.map(|until| member("fixed", 99, "dev:alice", until)), Origin::Source);
            }
            // The same id exists in a different table; deleting/reinserting
            // an old row must retain the events before its new birth.
            for n in [None, Some(1), Some(2), None, Some(3)] {
                change("public_rows", "fixed", n.map(|n| object([("id", Value::Id("fixed".into())), ("n", Value::Int(n))])), Origin::Source);
            }
            // A content id may equal a grant's canonical group id in the
            // same table. Put/Del counts must still exclude those joins.
            let group_id = canonical_json(&[Value::Int(99)]);
            for group in [None, Some(99), Some(98), None, Some(99)] {
                change("messages", &group_id, group.map(|group| object([
                    ("id", Value::Id(group_id.clone())), ("group", Value::Int(group)),
                ])), Origin::Source);
            }
            for _ in 0..128 {
                let table = ["public_rows", "personal_rows", "members", "private_members", "messages", "private_messages"][random.next(6) as usize];
                let id = if table.ends_with("messages") { canonical_json(&[Value::Int(random.next(4) as i64)]) }
                    else { format!("r{}", random.next(12)) };
                let new = if random.next(4) == 0 { None } else {
                    let person = ["dev:alice", "dev:bob", "public"][random.next(3) as usize];
                    Some(match table {
                        "public_rows" => object([("id", Value::Id(id.clone())), ("n", Value::Int(random.next(10) as i64))]),
                        "personal_rows" => object([("id", Value::Id(id.clone())), ("person", Value::Id(person.into())), ("n", Value::Int(random.next(10) as i64))]),
                        "messages" | "private_messages" => object([("id", Value::Id(id.clone())), ("group", Value::Int(random.next(4) as i64))]),
                        _ => member(&id, random.next(4) as i64, person, now + [0, -1, 50, 200][random.next(4) as usize]),
                    })
                };
                let origin = if random.next(4) == 0 { Origin::Maintained } else { Origin::Source };
                change(table, &id, new, origin);
            }
            assert_eq!(actual.events.take(), expected, "final events: seed {seed}, commit {commit}");
            assert!(actual.events.is_empty());
            drop(actual);
            drop(reference);
            tx.commit().unwrap();
        }
    }
}
