//! Expiry is an observable channel even when the witness table is unreadable.
use crate::paired_worlds::*;
use serde_json::json;

pub const ADMIN: &str = "exists grants[parent = .parent, who = viewer, kind = 'admin']";
pub fn expiry_source(rule: &str, ordinary: bool) -> String {
    format!(
        "table parents:\n  public\n  online only\ntable grants:\n  parent: parents\n  who: principal\n  kind: text <=20\n  until: time ?\n  expire at .until\n  unique parent, who\n  read <- deny\n  online only\ntable otherGrants:\n  parent: parents\n  who: principal\n  until: time ?\n  expire at .until\n  unique parent, who\n  read <- deny\n  online only\ntable messages:\n  parent: parents\n  owner: principal\n  ordinal: {}\n  until: time ?\n  expire at .until\n  read <- {rule}\n  online only\nquery one():\n  return messages['own']\nquery page():\n  return messages where .parent = 'p' first 2 by .ordinal\nquery reverse():\n  return messages where .parent = 'p' last 2 by .ordinal\n",
        if ordinary {
            "int"
        } else {
            "sequence by parent"
        }
    )
}
pub fn expiry_pair(
    rule: &str,
    ordinary: bool,
    kind: &str,
    deadlines: [Option<i64>; 2],
    owner: &str,
) -> Pair {
    let seeds = deadlines.map(|deadline| {
        let mut rows = vec![
            (
                "messages".into(),
                json!({"id":"own","parent":"p","owner":owner,"ordinal":1,"until":null}),
            ),
            (
                "otherGrants".into(),
                json!({"id":"stable","parent":"p","who":"alice","until":8000}),
            ),
        ];
        if let Some(until) = deadline {
            rows.push((
                "grants".into(),
                json!({"id":"hidden","parent":"p","who":"alice","kind":kind,"until":until}),
            ));
        }
        rows
    });
    let mut pair = Pair::new(
        expiry_source(rule, ordinary),
        seeds,
        "alice",
        Operation::new("unused", json!({}), "alice"),
    );
    pair.trusted = true;
    pair.operations.clear();
    pair
}
pub fn expiry_cases() -> Vec<(String, Pair)> {
    let mut cases = vec![];
    for ordinary in [false, true] {
        for kind in ["guest", "admin"] {
            for deadlines in [[Some(2000), Some(3000)], [None, Some(5000)]] {
                let mut rules = vec![
                    format!("{ADMIN} or .owner = viewer"),
                    format!("{ADMIN} or not {ADMIN}"),
                    format!("not ({ADMIN} and not {ADMIN})"),
                    format!("({ADMIN} and not {ADMIN}) or .owner = viewer"),
                    format!("({ADMIN} and .owner != viewer) or .owner = viewer"),
                    format!("not ({ADMIN} and .owner != viewer)"),
                    format!("not {ADMIN} or .owner = viewer"),
                    format!("{ADMIN} or exists otherGrants[parent = .parent, who = viewer]"),
                ];
                if kind == "guest" { rules.push(format!("not {ADMIN}")); }
                for rule in rules {
                    cases.push((
                        format!("ordinary={ordinary}/kind={kind}/deadlines={deadlines:?}/{rule}"),
                        expiry_pair(&rule, ordinary, kind, deadlines, "alice"),
                    ));
                }
            }
        }
    }
    // Legacy physical ties injected through Pair::trusted: preserve the
    // engine's privacy/expiry defenses even for old or inconsistent stores.
    // Quarry points now require uniqueness; ordinary writes cannot make
    // these simultaneously live duplicates.
    for ordinary in [false, true] {
        for permanent in [false, true] {
            for copies in [1, 2, 33] {
                for rule in [ADMIN.to_string(), format!("{ADMIN} or not {ADMIN}"), format!("not ({ADMIN} and not {ADMIN})"), format!("{ADMIN} or .owner = viewer")] {
                    let mut pair = expiry_pair(&rule, ordinary, "admin", [Some(2000), Some(3000)], "alice");
                    pair.source = pair.source.replacen("unique parent, who", "unique byParentWho: parent, who", 1);
                    for seed in &mut pair.seeds {
                        for n in 0..copies {
                            seed.push(("grants".into(), json!({"id":format!("later{n}"),"parent":"p","who":"alice","kind":"admin","until":if permanent { None } else { Some(8000) }})));
                        }
                    }
                    cases.push((format!("multiple/{ordinary}/{permanent}/{copies}/{rule}"), pair));
                }
            }
        }
    }
    // Grok: returned-row lifetime remains independent of redundant grants;
    // matching witnesses can sit behind expired physical versions.
    for expired in [0, 100, 8000] {
        for rule in [format!("{ADMIN} or .owner = viewer"), format!("not {ADMIN} or .owner = viewer")] {
            let mut pair = expiry_pair(&rule, false, "admin", [Some(2000), Some(3000)], "alice");
            pair.source = pair.source.replacen("unique parent, who", "unique byParentWho: parent, who", 1);
            for seed in &mut pair.seeds {
                seed[0].1["until"] = json!(7000);
                seed.extend((0..expired).map(|n| ("grants".into(), json!({"id":format!("expired{n:05}"),"parent":"p","who":"alice","kind":"admin","until":500}))));
            }
            cases.push((format!("row-lifetime/expired-prefix={expired}/{rule}"), pair));
        }
    }
    cases
}

pub fn cap_cases() -> Vec<Pair> {
    let mut cases = vec![];
    for ordinary in [false, true] {
        for cap in [1, 4] {
            for populations in [[0, 31], [8191, 8191], [8192, 20000]] {
                let source = format!(
                    "table parents:\n  public\n  online only\ntable floor:\n  parent: parents\n  ordinal: sequence by parent\n  read <- deny\n  online only\ntable messages:\n  parent: parents\n  owner: principal default viewer\n  ordinal: {}\n  until: time ?\n  expire at .until\n  cap {cap} by parent\n  read <- .owner = viewer\n  insert <- allow\n  online only\nmutation send(parent: parents):\n  return insert messages {{ parent }}\n",
                    if ordinary {
                        "int default 0"
                    } else {
                        "sequence by parent"
                    }
                );
                let seeds = populations.map(|count| (0..count).map(|n| ("messages".into(), json!({"id":format!("expired{n}"),"parent":"p","owner":"bob","ordinal":n + 1,"until":500})))
                    .chain([("floor".into(), json!({"id":"same-counter","parent":"p","ordinal":30000}))]).collect());
                let mut pair = Pair::new(
                    source,
                    seeds,
                    "alice",
                    Operation::new("send", json!({"parent":"p"}), "alice"),
                );
                pair.trusted = true;
                cases.push(pair);
            }
        }
    }
    cases
}

pub fn nested_cap_cases() -> Vec<Pair> {
    let source = "table parents:\n  public\n  online only\ntable grants:\n  parent: parents\n  who: principal\n  until: time ?\n  expire at .until\n  unique byParentWho: parent, who\n  read <- deny\n  online only\ntable messages:\n  parent: parents\n  owner: principal default viewer\n  ordinal: sequence by parent\n  fresh: bool\n  until: time ?\n  expire at .until\n  cap 2 by parent\n  read <- .fresh = true or exists grants[parent = .parent, who = viewer] or .owner = viewer\n  insert <- allow\n  online only\nmutation send(parent: parents):\n  return insert messages { parent, fresh: true }\n";
    let seeds = [8193, 20000].map(|count| (0..count).map(|n| ("grants".into(), json!({"id":format!("expired{n}"),"parent":"p","who":"alice","until":500})))
        .chain([("messages".into(), json!({"id":"old","parent":"p","owner":"alice","ordinal":1,"fresh":false,"until":null}))]).collect());
    let mut pair = Pair::new(source, seeds, "alice", Operation::new("send", json!({"parent":"p"}), "alice"));
    pair.trusted = true;
    vec![pair]
}
