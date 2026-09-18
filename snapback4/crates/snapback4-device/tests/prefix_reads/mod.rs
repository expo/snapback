use super::*;
use snapback4_core::value::object;
use serde_json::json;

const PREFIX: &str = include_str!("../../../snapback4-sim/tests/fixtures/prefix-reads.q");
const SEEK: &str = include_str!("../../../snapback4-sim/tests/fixtures/lane-source.q");

fn member(room: &str, viewer: &str, unread: i64) -> (String, Value) {
    ("members".into(), object([("id", id(&format!("{room}-{viewer}"))), ("roomId", id(room)), ("principal", id(viewer)), ("unread", Value::Int(unread))]))
}
fn message(name: &str, room: &str, at: i64, expiry: Value) -> (String, Value) {
    ("messages".into(), object([("id", id(name)), ("roomId", id(room)), ("body", Value::String("coffee".into())), ("at", Value::Int(at)), ("expiresAt", expiry)]))
}

#[test]
fn w13c_capped_roster_predicts_and_prefix_existence_has_precise_horizon_coverage() {
    on_both(|host| {
        for horizon in [false, true] {
            let source = if horizon { PREFIX.replace("last 500", "last 1") } else { PREFIX.replace(" last 500 by byRoomTime", "") };
            let (mut engine, backend) = compile(&source);
            let now = snapback4_core::now_ms();
            engine.seed([member("r1", "dev:alice", 3), member("r1", "dev:bob", 5), member("empty", "dev:alice", 0), member("expired", "dev:alice", 0),
                message("a", "r1", 1, Value::Null), message("b", "r1", 2, Value::Null), message("old", "expired", 1, Value::Int(now + 1000)), message("hidden", "hidden", 1, Value::Null)]).unwrap();
            let mut device = host.open(if horizon { "prefix-horizon" } else { "prefix-full" }, Some(backend)).unwrap();
            for (i, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
            let roster = query(&mut *device, "roster", "dev:alice", json!({"roomId":"r1"}), now);
            assert_eq!(roster["complete"], true);
            assert!(roster["next"].is_null());
            assert_eq!(rows(&roster).len(), 2);
            let total = query(&mut *device, "unreadTotal", "dev:alice", json!({}), now);
            assert_eq!(total["data"], 3);
            assert_eq!(total["complete"], true);
            for (room, expected) in [("r1", true), ("empty", false), ("expired", false), ("hidden", false)] {
                for op in ["hasMessages", "hasMatches"] {
                    let answer = query(&mut *device, op, "dev:alice", if op == "hasMessages" { json!({"roomId":room}) } else { json!({"roomId":room,"q":"cof"}) }, now + 2000);
                    assert_eq!(answer["data"], expected, "{answer}");
                    assert_eq!(answer["complete"], expected || !horizon, "{answer}");
                    assert!(answer["next"].is_null());
                }
            }
            if !horizon {
                let grouped = query(&mut *device, "grouped", "dev:alice", json!({"q":"cof"}), now + 2000);
                assert_eq!(grouped["complete"], true, "{grouped}");
                assert_eq!(rows(&grouped).len(), 1);
                let merge = query(&mut *device, "everywhere", "dev:alice", json!({"q":"cof"}), now + 2000);
                assert_eq!(merge["complete"], true, "{merge}");
                assert_eq!(rows(&merge).len(), 2);
            }
            ok(device.call(json!({"op":"admit", "entry":Queued { id: "bump".into(), seq: 1, op: "bump".into(), args: json!({"roomId":"r1"}), new_ids: vec![], predicted: vec![], viewer: "dev:alice".into(), now, predictable: true, sent_seq: None, receipt_store: None, observed_seq: None }})));
            let roster = query(&mut *device, "roster", "dev:alice", json!({"roomId":"r1"}), now);
            assert_eq!(rows(&roster).iter().map(|m| m["unread"].as_i64().unwrap()).sum::<i64>(), 10);
            assert!(rows(&roster).iter().all(|m| m["pending"] == true), "{roster}");
            device.close();
        }
    });
}

#[test]
fn w13c_meter_loop_cuts_on_both_device_stores() {
    on_both(|host| {
        let (mut engine, backend) = compile(PREFIX);
        engine.seed((0..9000).map(|n| member(&format!("r{n:05}"), "dev:alice", 1))).unwrap();
        let mut device = host.open("prefix-meter", Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut engine, "dev:alice", 1000).iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
        let answer = query(&mut *device, "unreadTotal", "dev:alice", json!({}), 100);
        assert_eq!(answer["data"], snapback4_core::Ceilings::default().examined);
        assert_eq!(answer["complete"], false);
        assert_eq!(answer["cut"], "meter");
        assert!(answer["next"].is_null());
        device.close();
    });
}

#[test]
fn w13c_hidden_worlds_have_identical_existence_answers_on_both_stores() {
    on_both(|host| {
        let mut observations = Vec::new();
        for hidden in [false, true] {
            let (mut engine, backend) = compile(&PREFIX.replace(" last 500 by byRoomTime", ""));
            engine.seed([member("r1", "dev:alice", 0)]).unwrap();
            if hidden { engine.seed([message("secret", "hidden", 1, Value::Null)]).unwrap(); }
            let mut device = host.open(if hidden { "hidden-present" } else { "hidden-absent" }, Some(backend)).unwrap();
            for (i, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
            let mut answers = Vec::new();
            for op in ["hasMessages", "hasMatches"] {
                let answer = query(&mut *device, op, "dev:alice", if op == "hasMessages" { json!({"roomId":"hidden"}) } else { json!({"roomId":"hidden","q":"cof"}) }, 100);
                assert_eq!(answer["data"], false);
                assert_eq!(answer["complete"], true);
                answers.push(json!({"data":answer["data"], "metered":answer["metered"], "complete":answer["complete"], "next":answer["next"], "cut":answer["cut"]}));
            }
            observations.push(answers);
            device.close();
        }
        assert_eq!(observations[0], observations[1]);
    });
}

#[test]
fn w13c_lane_source_expressions_run_before_eager_and_lazy_discovery_on_both_stores() {
    on_both(|host| {
        for eager in [false, true] {
            let source = if eager { SEEK.replace("last 10 by byHourAt:", "last 10 by byHourAt where .authorId = viewer:") } else { SEEK.into() };
            let (mut engine, backend) = compile(&source);
            for hour in 0..30 {
                engine.seed([("hours".into(), object([("id", id(&format!("h{hour}"))), ("hourAt", Value::Int(hour)), ("bucketId", Value::Int(0))])),
                    ("posts".into(), object([("id", id(&format!("p{hour}"))), ("authorId", id("dev:alice")), ("at", Value::Int(hour * 3_600_000)), ("hourAt", Value::Int(hour))]))]).unwrap();
            }
            let mut device = host.open(if eager { "source-eager" } else { "source-lazy" }, Some(backend)).unwrap();
            for (i, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
            for (name, expected) in [("inline",10), ("bound",10), ("direct",25), ("keyExpression",10), ("sourceFilter",10)] {
                let server = engine.query(name, context("dev:alice", &[("at",Value::Int(29 * 3_600_000))])).unwrap();
                let local = query(&mut *device, name, "dev:alice", json!({"at":29 * 3_600_000}), 100);
                assert_eq!(local["data"], snapback4_core::wire::to_json(&server.data), "eager={eager} {name}");
                assert_eq!(rows(&local).len(), expected);
                assert_eq!(local["complete"], true, "{local}");
                assert_eq!(local["next"], serde_json::to_value(server.next).unwrap());
            }
            device.close();
        }
    });
}

mod first_witness;
