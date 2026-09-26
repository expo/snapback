//! LLP 3000.020 §6: the same scenarios run on memory, SQLite and wasm.
mod common;
use common::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Value, wire};
use snapback4_device::{call, device::Device, store::DeviceStore};
const SOURCE: &str = include_str!("unread_range/schema.q");
const CASES: &str = include_str!("unread_range/cases.json");

fn member(mark: Json, joined: Json) -> Json {
    json!({"id":"b","conversationId":"c","principal":"bob","readUpTo":mark,"joinedAt":joined})
}
fn message(n: i64) -> Json {
    json!({"id":format!("m{n:02}"),"conversationId":"c","ordinal":n,"at":n,"senderId":"alice","tombstone":false,"until":null})
}
fn put(table: &str, data: Json) -> Json {
    json!({"table":table,"id":data["id"],"kind":"put","data":data})
}
fn check<S: DeviceStore>(d: &mut Device<S>, spec: &Json, name: &str) {
    let now = spec["now"].as_i64().unwrap_or(1);
    let result = call::call(
        d,
        json!({"op":"query","name":"badge","viewer":"bob","args":{"member":"b"},"now":now}),
    );
    let q = &result["ok"];
    assert_eq!(q["complete"], spec["complete"], "{name}: {result}");
    assert_eq!(q["unknown"], spec["unknown"], "{name}: {result}");
    assert_ne!(q["speculative"], true, "{name}: {result}");
    if let Some(deadline) = spec.get("nextExpiry") { assert_eq!(&q["nextExpiry"], deadline, "{name}: {result}"); }
    if spec["value"] == "partial" {
        let n = q["data"].as_i64().expect("partial count");
        assert!(n > 0 && n < 8300, "{name}: {result}");
    } else {
        assert_eq!(q["data"], spec["value"], "{name}: {result}");
    }
    let rows = call::call(
        d,
        json!({"op":"query","name":"badgeRows","viewer":"bob","now":now}),
    );
    assert_eq!(
        rows["ok"]["data"][0]["recountPending"],
        !spec["complete"].as_bool().unwrap(),
        "{name}: {rows}"
    );
}
fn page<S: DeviceStore>(d: &mut Device<S>, events: Vec<Json>, joined: Json, acquisitions: Json) {
    let from = d.sync_state().unwrap().watermark;
    let generation = d.backend().generation;
    let page = serde_json::from_value(json!({"snapshot":false,"generation":generation,
        "requested_watermark":from,"images_at":from+1,"watermark":from+1,"more":false,
        "events":events,"joined":joined,"acquisitions":acquisitions}))
    .unwrap();
    d.apply(&page, false).unwrap();
}
fn run<H: Host>(h: &mut H, spec: &Json) {
    let name = spec["name"].as_str().unwrap();
    let mut source = SOURCE.to_owned();
    for pair in spec["replace"].as_array().into_iter().flatten() {
        source = source.replace(pair[0].as_str().unwrap(), pair[1].as_str().unwrap());
    }
    let (mut server, mut backend) = compile(&source);
    let mut m = member(
        spec.get("mark").cloned().unwrap_or(json!(4)),
        spec.get("joinedAt").cloned().unwrap_or(json!(0)),
    );
    if source.contains("joinedAt: sequence") { m.as_object_mut().unwrap().remove("joinedAt"); }
    let n = spec["n"].as_i64().unwrap_or(6);
    let mut rows = vec![
        ("conversations", json!({"id":"c","title":"chat"})),
        ("members", m.clone()),
    ];
    for i in 1..=n {
        let mut row = message(i);
        if i <= spec["expireFirst"].as_i64().unwrap_or(0) { row["until"] = json!(4102444800000_i64); }
        if source.contains("ordinal: sequence") {
            row.as_object_mut().unwrap().remove("ordinal");
        }
        if let Some(fields) = spec["overrides"][i.to_string()].as_object() {
            row.as_object_mut().unwrap().extend(fields.clone());
        }
        rows.push(("messages", row));
    }
    for extra in spec["extra"].as_array().into_iter().flatten() {
        let mut row = message(0);
        row.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        rows.push(("messages", row));
    }
    for seed in spec["seed"].as_array().into_iter().flatten() {
        rows.insert(0, (seed["table"].as_str().unwrap(), seed["row"].clone()));
    }
    server
        .seed(
            rows.into_iter()
                .map(|(table, row)| {
                    (
                        table.to_owned(),
                        wire::row_from_json(&server.schema().tables[table], &row).unwrap(),
                    )
                })
                .collect::<Vec<_>>(),
        )
        .unwrap();
    backend.schema = backend.schema.public_projection();
    let horizon = backend.schema.tables["messages"]
        .sync
        .as_ref()
        .unwrap()
        .horizon
        .as_ref()
        .unwrap()
        .by
        .clone();
    let mut d = h.open(name, Some(backend)).unwrap();
    for (i, mut p) in snapshot_pages(&mut server, "bob", 512)
        .into_iter()
        .enumerate()
    {
        if spec["omitBoundaries"] == true {
            p.acquisitions.clear();
        }
        d.apply(&p, i == 0).unwrap();
    }
    check(&mut d, spec, name);
    if spec["complete"] == true {
        let remote = server
            .query(
                "badge",
                Context::new("bob", args(&[("member", id("b"))])).at(1),
            )
            .unwrap();
        assert_eq!(
            wire::to_json(&remote.data),
            spec["value"],
            "{name}: server parity"
        );
    }
    h.close(name, d);
    let mut d = h.open(name, None).unwrap();
    check(&mut d, spec, name);
    for (i, action) in spec["actions"].as_array().into_iter().flatten().enumerate() {
        match action["kind"].as_str().unwrap() {
            "query" => {
                check(&mut d, action, name);
                h.close(name, d);
                d = h.open(name, None).unwrap();
                check(&mut d, action, name);
            }
            "view" => page(
                &mut d,
                vec![put(
                    "unread",
                    json!({"id":"b","member":"b","principal":"bob","value":action["value"],"recountPending":true}),
                )],
                json!({}),
                json!([]),
            ),
            "member" => {
                m["readUpTo"] = action["readUpTo"].clone();
                page(
                    &mut d,
                    vec![put("members", m.clone())],
                    json!({}),
                    json!([]),
                );
            }
            "delete" => page(
                &mut d,
                vec![
                    json!({"table":action.get("table").cloned().unwrap_or(json!("messages")),"id":action["id"],"kind":"del"}),
                ],
                json!({}),
                json!([]),
            ),
            "message" => {
                let mut row = message(action["ordinal"].as_i64().unwrap());
                row["id"] = action["id"].clone();
                page(&mut d, vec![put("messages", row)], json!({}), json!([]));
            }
            "predict" => {
                let result = call::call(
                    &mut d,
                    json!({"op":"admit","entry":{"id":format!("mark-{i}"),"seq":i+1,"op":"mark","viewer":"bob","args":{"member":"b","readUpTo":action["mark"]},"now":1,"predictable":true}}),
                );
                assert_eq!(
                    result["ok"]["predictable"], action["predictable"],
                    "{name}: {result}"
                );
                if action["predictable"] == false {
                    assert_eq!(result["ok"]["predicted"], json!([]));
                }
            }
            "send" | "refuse" | "succeed" => {
                let send = action["kind"] == "send";
                let result = call::call(
                    &mut d,
                    json!({"op":"admit","entry":{"id":format!("intent-{i}"),"seq":i+1,"op":if send{"send"}else if action["kind"] == "succeed" {"depend"} else {"countThenRefuse"},"viewer":"bob","args":if send{json!({"conversationId":"c"})}else{json!({"member":"b"})},"now":1,"new_ids":if send{vec!["pred"]}else{vec![]},"predictable":true}}),
                );
                assert_eq!(result["ok"]["predictable"], action["kind"] != "refuse", "{name}: {result}");
            }
            "server-accept" => {
                let backlog = (0..action["advance"].as_i64().unwrap()).map(|n| {
                    let row = json!({"id":format!("ahead-{n}"),"conversationId":"c","at":0,"senderId":"alice","tombstone":false,"until":null});
                    ("messages".into(), wire::row_from_json(&server.schema().tables["messages"], &row).unwrap())
                }).collect::<Vec<_>>();
                server.seed(backlog).unwrap();
                let sent = server.mutate("send", None, Context::new("bob", args(&[("conversationId", id("c"))])).at(1)).unwrap();
                assert!(matches!(sent.state, snapback4_core::WriteState::Sent { ref result, .. } if result.field("ordinal") == Ok(&Value::Int(10007))), "{sent:?}");
                let accepted = server.mutate("countThenRefuse", None, Context::new("bob", args(&[("member", id("b"))])).at(1)).unwrap();
                assert!(matches!(accepted.state, snapback4_core::WriteState::Sent { result: Value::Int(1), .. }), "{accepted:?}");
            }
            "acquiring" => page(
                &mut d,
                vec![],
                json!({}),
                json!([{ "at":0,"table":"messages","index":horizon,"group":["c"] }]),
            ),
            "leave" => page(
                &mut d,
                vec![json!({"table":"messages","id":"","kind":"scope","data":["c"]})],
                json!({}),
                json!([]),
            ),
            "rejoin" => page(
                &mut d,
                vec![put("messages", message(6))],
                json!({"messages":[["c"]]}),
                json!([
                    {"at":0,"table":"messages","index":horizon,"group":["c"]},
                    {"at":1,"table":"messages","index":horizon,"group":["c"],"floor":"whole"}
                ]),
            ),
            other => panic!("unknown action {other}"),
        }
    }
}
#[test]
fn native_memory_scenarios() {
    let mut h = Memory::new();
    for spec in serde_json::from_str::<Vec<Json>>(CASES).unwrap() {
        if std::env::var("SNAPBACK4_UNREAD_CASE").is_ok_and(|name| spec["name"] != name) {
            continue;
        }
        run(&mut h, &spec);
    }
}
#[test]
fn native_sqlite_scenarios() {
    let mut h = Sqlite::new("unread-range");
    for spec in serde_json::from_str::<Vec<Json>>(CASES).unwrap() {
        if std::env::var("SNAPBACK4_UNREAD_CASE").is_ok_and(|name| spec["name"] != name) {
            continue;
        }
        run(&mut h, &spec);
    }
}

fn guide_clique_unread_reloads_and_expires<H: Host>(h: &mut H) {
    let guide = snapback4_lang::guide::card("maintains").unwrap();
    let example = snapback4_lang::guide::quarry(
        guide
            .split("## A value per member: Clique unread")
            .nth(1)
            .unwrap(),
    )
    .remove(0);
    let bound = snapback4_lang::compile(&[("guide.q".into(), example.clone())]);
    assert!(
        bound.diagnostics.is_empty() && bound.notes.is_empty(),
        "{:?} {:?}",
        bound.diagnostics,
        bound.notes
    );
    let (mut e, mut backend) = compile(&example);
    let now = snapback4_core::now_ms();
    e.seed(
        [
            (
                "conversations",
                json!({"id":"c","title":"Chat","timer":10000}),
            ),
            (
                "members",
                json!({"id":"b","conversationId":"c","principal":"bob","readUpTo":501}),
            ),
            (
                "members",
                json!({"id":"a","conversationId":"c","principal":"alice","readUpTo":0}),
            ),
        ]
        .into_iter()
        .map(|(t, r)| {
            (
                t.into(),
                wire::row_from_json(&e.schema().tables[t], &r).unwrap(),
            )
        })
        .collect::<Vec<_>>(),
    )
    .unwrap();
    // Sending uses the conversation timer and engine-assigned sequence, as the card teaches.
    for _ in 0..503 {
        let out = e
            .mutate(
                "send",
                None,
                Context::new("alice", args(&[("conversationId", id("c"))])).at(now),
            )
            .unwrap();
        assert!(
            matches!(out.state, snapback4_core::WriteState::Sent { .. }),
            "{out:?}"
        );
    }
    backend.schema = backend.schema.public_projection();
    let mut d = h.open("guide", Some(backend)).unwrap();
    for (i, p) in snapshot_pages(&mut e, "bob", 500).iter().enumerate() {
        d.apply(p, i == 0).unwrap();
    }
    for cold in [false, true] {
        if cold {
            h.close("guide", d);
            d = h.open("guide", None).unwrap();
        }
        let q = d
            .query("myUnread", "bob", &json!({"member":"b"}), now)
            .unwrap();
        assert!(q.complete, "{q:?}");
        assert_eq!(q.data, Value::Int(2));
    }
    let q = d
        .query("myUnread", "bob", &json!({"member":"b"}), now + 10000)
        .unwrap();
    assert!(q.complete, "{q:?}");
    assert_eq!(q.data, Value::Int(0));
}

#[test]
fn guide_memory() {
    guide_clique_unread_reloads_and_expires(&mut Memory::new());
}
#[test]
fn guide_sqlite() {
    guide_clique_unread_reloads_and_expires(&mut Sqlite::new("guide-unread"));
}

#[path = "unread_range/measured.rs"] mod measured;
