#![allow(dead_code)]
use crate::disclosure::*;
use serde_json::{Value as Json, json};
pub const RECORDS: &str = r#"
table records:
  owner: principal
  reader: principal default 'bob'
  secret: int default 0 written by .owner
  label: int default 0
  read <- allow
  insert <- deny
  update <- deny
  delete <- deny
  sync public
mutation insertRow(id: id):
  return insert records { id, owner: 'bob', secret: 7 }
mutation insertAbsent(id: id):
  return insert records { id, owner: 'bob', secret: 7 } if absent
mutation upsertRow(id: records):
  upsert records[id] { owner: 'bob', secret: 7 }
mutation updateRow(id: records):
  update records[id] { secret: 7 }
mutation deleteRow(id: records):
  delete records[id]
mutation refresh(id: records):
  update records[id] { label: 1 }
mutation noop():
  return true
query one(id: records):
  return records[id]
query scalar(id: records):
  return records[id].secret
query shaped(id: records):
  return records[id] { id, secret, label }
query page(c: cursor ?):
  return records after c first 1 by .id { * }
query grouped():
  rows = records first 20
  return group(rows, 'secret')
query sorted():
  rows = records first 20
  return sort(rows, 'secret', 'id')
"#;
pub const WRITES: [&str; 7] = [
    "insertRow",
    "insertAbsent",
    "upsertRow",
    "updateRow",
    "deleteRow",
    "refresh",
    "noop",
];
pub fn seed(secret: Json) -> Seed {
    vec![(
        "records".into(),
        json!({"id":"target","owner":"bob","secret":secret}),
    )]
}
pub fn records(source: String, seeds: [Seed; 2], op: &str, key: &str) -> Pair {
    Pair::new(
        source,
        seeds,
        "alice",
        Operation::new(op, json!({"id":key}), "alice"),
    )
    .query("one", json!({"id":"target"}))
    .query("scalar", json!({"id":"target"}))
    .query("shaped", json!({"id":"target"}))
    .query("page", json!({"c":null}))
}
pub fn payload_pairs() -> Vec<Pair> {
    let mut pairs = Vec::new();
    for insert in ["deny", "allow"] {
        for op in WRITES {
            for key in ["target", "absent"] {
                pairs.push(records(
                    RECORDS.replace("insert <- deny", &format!("insert <- {insert}")),
                    [seed(json!(0)), seed(json!(10))],
                    op,
                    key,
                ));
            }
        }
    }
    let text = RECORDS
        .replace(
            "secret: int default 0",
            "secret: text <=10000000 default ''",
        )
        .replace("secret: 7", "secret: 'guess'");
    for op in WRITES {
        pairs.push(records(
            text.clone(),
            [seed(json!("")), seed(json!("x".repeat(10_000_000)))],
            op,
            "target",
        ));
    }
    pairs
}
pub fn hidden_pairs() -> Vec<Pair> {
    let mut pairs = Vec::new();
    for insert in ["deny", "allow"] {
        for op in WRITES {
            let source = RECORDS
                .replace("read <- allow", "read <- .reader = viewer")
                .replace("sync public", "sync to .reader")
                .replace("insert <- deny", &format!("insert <- {insert}"));
            // Both seed transactions advance once; no visible table is added to hide setup differences.
            pairs.push(records(
                source.clone(),
                [vec![], seed(json!(10))],
                op,
                "target",
            ));
            let mut same = seed(json!(10));
            same[0].1["owner"] = json!("alice");
            // Only ordinary-field writes: changing the writer's own authority is not a hidden input.
            if ["deleteRow", "refresh", "noop"].contains(&op) {
                pairs.push(records(source, [same, seed(json!(10))], op, "target"));
            }
        }
    }
    pairs
}
pub fn following(private: &str, compat: bool) -> Pair {
    let mut source =
        include_str!("../../../snapback4-lang/tests/fixtures/following-view.q").to_string();
    if compat {
        source=source.replace("view activity:\n  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }\n  reposts { post: .postId, actor: .actorId, at, repost: true }\nview feed: activity where .actor = viewer or exists follows[viewer, .actor]", "table profiles:\n  principal: principal\n  unique principal\n  immutable principal\n  public\n  sync public\nmaintain feed: timeline\n  authors profiles by principal\n  events posts by authorId, at removed by removed\n  reposts reposts by actorId, postId, at\n  edges follows by followerId, followedId");
        source = source
            .replace(
                "return feed last 20 by .at after c",
                "return feed[viewer] after c last 20",
            )
            .replace("post: posts[.post]", "post: posts[.postId]");
    }
    source = source
        .replacen(
            private,
            &format!(
                "{private} default {} written by .authorId",
                if private == "at: time" { "0" } else { "false" }
            ),
            1,
        )
        .replace("bool default false default false", "bool default false");
    let seeds = [0, 10].map(|secret| {
        let mut p = json!({"id":"p","authorId":"bob","parentId":null,"at":5,"removed":false});
        if private == "at: time" {
            p["at"] = json!(secret);
        } else {
            p["removed"] = json!(secret != 0);
        }
        vec![
            ("posts".into(), p),
            (
                "follows".into(),
                json!({"id":"f","followerId":"alice","followedId":"bob"}),
            ),
        ]
    });
    source
        .push_str("\nmutation noop():\n  return true\nquery source():\n  return posts first 10\n");
    Pair::new(
        source,
        seeds,
        "alice",
        Operation::new("noop", json!({}), "alice"),
    )
    .query("home", json!({"c":null}))
    .query("cards", json!({"c":null}))
}

/// A reader observes successful public patches, refreshed puts and tombstones
/// while the other owner's private value differs throughout.
pub fn delivery_pairs() -> Vec<Pair> {
    let source = RECORDS
        .replace("update <- deny", "update <- .owner = viewer")
        .replace("delete <- deny", "delete <- .owner = viewer");
    [false, true]
        .map(|hidden_owner| {
            let mut source = source.clone();
            if hidden_owner {
                source = source
                    .replace("read <- allow", "read <- .reader = viewer")
                    .replace("sync public", "sync to .reader");
            }
            records(source, [seed(json!(0)), seed(json!(10))], "noop", "target")
                .then(Operation::new("refresh", json!({"id":"target"}), "bob"))
                .then(Operation::new("deleteRow", json!({"id":"target"}), "bob"))
        })
        .into()
}
pub fn derivations() -> Vec<Pair> {
    let mut pairs = Vec::new();
    let source = RECORDS.to_owned()
        + "\nview totals: sum records of .secret by .owner\n  read <- allow\n  online only\nquery total():\n  return totals['bob']\n";
    pairs.push(records(
        source,
        [seed(json!(0)), seed(json!(10))],
        "noop",
        "target",
    ));
    let source =
        include_str!("../../../snapback4-lang/tests/fixtures/maintained-columns.q").replace(
            "  amount: int",
            "  owner: principal default 'bob'\n  amount: int default 0 written by .owner",
        ) + "\nmutation noop():\n  return true\n";
    let seeds = [0, 10].map(|value| {
        vec![
            ("posts".into(), json!({"id":"p","at":1})),
            (
                "likes".into(),
                json!({"id":"l","postId":"p","active":true,"amount":value,"owner":"bob"}),
            ),
        ]
    });
    pairs.push(
        Pair::new(
            source,
            seeds,
            "alice",
            Operation::new("noop", json!({}), "alice"),
        )
        .query("postRow", json!({"id":"p"}))
        .query("ranked", json!({"c":null})),
    );
    let source = "table posts:\n  owner: principal\n  secret: int default 0 written by .owner\n  immutable secret\n  public\n  online only\ntable likes:\n  postId: posts\n  immutable postId\n  public\n  online only\nmaintain leaked: count likes by postId.secret\n  read <- allow\n  online only\nquery leaks():\n  return leaked first 20\nmutation noop():\n  return true\n";
    let seeds = [0, 10].map(|value| {
        vec![
            (
                "posts".into(),
                json!({"id":"p","owner":"bob","secret":value}),
            ),
            ("likes".into(), json!({"id":"l","postId":"p"})),
        ]
    });
    pairs.push(Pair::new(
        source,
        seeds,
        "alice",
        Operation::new("noop", json!({}), "alice"),
    ));
    pairs
}

pub fn safe_following() -> Pair {
    let mut pair = following("at: time", false);
    pair.source = pair.source.replace(
        "at: time default 0 written by .authorId",
        "at: time\n  secret: int default 0 written by .authorId",
    );
    for (world, seed) in pair.seeds.iter_mut().enumerate() {
        seed[0].1["at"] = json!(5);
        seed[0].1["secret"] = json!(world * 10);
    }
    pair.then(Operation::new("remove", json!({"postId":"p"}), "bob"))
}

pub fn ordinary_patch() -> Pair {
    let source = RECORDS
        .replace("secret: int default 0", "secret: text <=1000000 default ''")
        .replace("secret: 7", "secret: 'guess'")
        .replace("update <- deny", "update <- allow");
    records(
        source,
        [seed(json!("")), seed(json!("x".repeat(1_000_000)))],
        "refresh",
        "target",
    )
}
