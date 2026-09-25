//! Round 5 dimensions: compound ACLs, several hidden siblings, payload shapes,
//! allowed updates/deletes, ordinary-key upserts, and exhausted caller ledgers.
use crate::paired_worlds::*;
use crate::generated::{self, Principal, ReadRule, Write, Case};
use serde_json::{Value as Json, json};

pub const COMPOUND: &str = ".owner = viewer or exists grants[parent = .parent, who = viewer] or exists grants[parent = .parent, who = .owner]";
fn source(compound: bool, cap: usize, ordinary: bool) -> String {
    let mut s = generated::schema(Principal::SelfReadable, ReadRule::Owner, false, true)
        .replace("cap 1 by parent", &format!("cap {cap} by parent"))
        .replace("update <- deny", "update <- allow").replace("delete <- deny", "delete <- allow");
    if compound { s = s.replace(".owner = viewer", COMPOUND).replace("sync to .owner", "online only"); }
    if ordinary { s = s.replace("ordinal: sequence by parent", "ordinal: int default 0"); }
    s
}
fn payload(shape: usize, world: usize) -> (&'static str, Json) {
    match (shape, world) {
        (0, 0) => ("text <=4096 ?", Json::Null),
        (0, _) => ("text <=4096 ?", json!("z".repeat(4096))),
        (1, 0) => ("[text <=128] <=8 ?", json!([])),
        (1, _) => ("[text <=128] <=8 ?", json!(vec!["z".repeat(128); 8])),
        (2, 0) => ("json <=4096 ?", json!({})),
        (2, _) => ("json <=4096 ?", json!({"nested":[null, true, {"body":"z".repeat(2000)}]})),
        (3, 0) => ("bool ?", json!(false)),
        (3, _) => ("bool ?", json!(true)),
        (_, 0) => ("enum('low', 'high') ?", json!("low")),
        (_, _) => ("enum('low', 'high') ?", json!("high")),
    }
}

pub fn cases() -> Vec<Case> {
    let mut cases = vec![];
    for compound in [false, true] {
        for cap in [2, 4, 8] {
            for shape in 0..5 {
                for ordinary in [false, true] {
                    for op in [Write::Insert, Write::Absent, Write::Upsert, Write::Update, Write::Delete] {
                        let mut seeds: [Seed; 2] = [vec![], vec![]];
                        for (world, seed) in seeds.iter_mut().enumerate() {
                            seed.push(generated::row("own", "alice", 1, "own"));
                            for n in 1..cap {
                                let mut row = generated::row(&format!("hidden{n}"), "bob", n as i64 + 1, &format!("{}{n}", if world == 0 { "a" } else { "z" }));
                                row.1["payload"] = payload(shape, world).1;
                                seed.push(row);
                            }
                        }
                        let source = source(compound, cap, ordinary).replace("  body: text <=40\n", &format!("  payload: {}\n  body: text <=40\n", payload(shape, 0).0));
                        let mut pair = Pair::new(source, seeds, "alice", Operation::new(op.name(), json!({"parent":"p","body":"fresh","n":1}), "alice"))
                            .query("one", json!({"parent":"p","n":1})).query("page", json!({"parent":"p","c":null}));
                        pair.trusted = true;
                        cases.push(Case { label: format!("compound={compound}/cap={cap}/shape={shape}/ordinary={ordinary}/{op:?}"), pair });
                    }
                }
            }
        }
    }
    cases
}

pub fn cap_boundary(reads: usize, op: Write) -> Pair {
    let own = generated::row("own", "alice", 2, "own");
    let mut s = source(false, 2, false);
    let statement = match op {
        Write::Insert => "return insert messages { parent, body }",
        Write::Absent => "return insert messages { parent, body } if absent",
        Write::Upsert => "return upsert messages[parent = parent, body = body] {}",
        _ => unreachable!(),
    };
    s.push_str(&format!("mutation burn(parent: parents, body: text <=40):\n  for i in range(0, {reads}):\n    seen = messages[id = 'own']\n  {statement}\n"));
    let mut p = Pair::new(s, [vec![own.clone(), generated::row("hidden", "bob", 3, "a")], vec![own, generated::row("hidden", "bob", 3, "z")]], "alice", Operation::new("burn", json!({"parent":"p","body":"fresh"}), "alice"))
        .query("one", json!({"parent":"p","n":2})).query("page", json!({"parent":"p","c":null}));
    p.trusted = true;
    p
}

pub fn page_boundary(ordinary: bool, reads: usize, take: usize, hidden: usize) -> Pair {
    let s = source(true, hidden + 2, ordinary) + &format!("query burnPage(parent: parents, c: cursor ?):\n  for i in range(0, {reads}):\n    seen = messages[id = 'own']\n  return messages where .parent = parent after c first {take} by .ordinal\n");
    let own = generated::row("own", "alice", hidden as i64 + 1, "own");
    let mut seeds = [vec![own.clone()], vec![own]];
    for n in 0..hidden { seeds[1].push(generated::row(&format!("hidden{n}"), "bob", n as i64 + 1, &format!("hidden{n}"))); }
    let mut p = Pair::new(s, seeds, "alice", Operation::new("edit", json!({"parent":"p","body":"changed","n":hidden+1}), "alice"))
        .query("burnPage", json!({"parent":"p","c":null}))
        .query("one", json!({"parent":"p","n":hidden+1})).query("page", json!({"parent":"p","c":null}));
    p.trusted = true;
    p
}
