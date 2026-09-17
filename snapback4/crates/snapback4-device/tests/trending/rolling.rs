use super::super::{apply, ok, on_both, query, snapshot_pages_at, stream_page_at, state};
use super::super::common::*;
use serde_json::json;
use snapback4_core::{Context, Value, WriteState};

const DAY: i64 = 86_400_000;

fn recipe() -> String {
    let card = snapback4_lang::guide::card("feeds").unwrap();
    snapback4_lang::guide::quarry(card).into_iter().find(|s| s.contains("query rollingLikes():")).unwrap()
        .replace("  read <- .principal = viewer", "  read <- allow")
        .replace("  sync to .principal", "  sync public")
        .replace("  online only\n", "")
}

fn post(name: &str, at: i64) -> (String, Value) {
    ("posts".into(), snapback4_core::value::object([
        ("id", id(name)), ("authorId", id("alice")), ("body", Value::String(name.into())), ("at", Value::Int(at)),
    ]))
}

fn like(name: &str, post: &str, until: i64) -> (String, Value) {
    ("likes".into(), snapback4_core::value::object([
        ("id", id(name)), ("postId", id(post)), ("principal", id(name)), ("at", Value::Int(until - DAY)), ("expiresAt", Value::Int(until)),
    ]))
}

// @ref LLP 3000.007#20.21 — rank all bounded live candidates before taking winners; clock expiry needs neither a sweep nor a writable score.
#[test]
fn w12a_live_ranking_and_partial_sweeps_on_both_stores() {
    on_both(|host| {
        let label = host.label();
        let (mut server, backend) = compile(&recipe());
        assert!(!server.schema().tables.contains_key("ranked"), "fresh ranking must have no principal-writable score table");
        assert!(server.schema().schedules.is_empty());
        let now = 2 * DAY;
        server.seed([post("old-winner", 1), post("new-winner", 1), post("edge", now - DAY + 1), post("zero", now), post("future", now + 1)]).unwrap();
        server.seed([like("a", "old-winner", now + 1), like("b", "old-winner", now + 1), like("c", "old-winner", now + 1),
            like("d", "new-winner", now + 100), like("e", "new-winner", now + 100)]).unwrap();
        let mut device = host.open("w12a-rolling", Some(backend)).unwrap();
        for (i, page) in snapshot_pages_at(&mut server, "bob", 100, now).iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
        let rank = |device: &mut dyn super::super::AnyDevice, name: &str, at| {
            let read = query(device, name, "bob", json!({}), at);
            assert_eq!(read["complete"], true, "{read}");
            read["data"].clone()
        };
        assert_eq!(rank(&mut *device, "trending", now), json!([
            {"postId":"zero","at":now,"score":0}, {"postId":"edge","at":now-DAY+1,"score":0},
        ]));
        assert_eq!(rank(&mut *device, "rollingLikes", now)[0]["postId"], "old-winner");
        let before = query(&mut *device, "rollingLikes", "bob", json!({}), now);
        assert_eq!(before["nextExpiry"], now + 1);
        let expected = json!([{"postId":"new-winner","score":2}]);
        assert_eq!(rank(&mut *device, "rollingLikes", now + 1), expected, "offline expiry changes the winner before a sweep");
        let post_window = rank(&mut *device, "trending", now + 1);
        assert_eq!(post_window[0]["postId"], "future");
        assert_eq!(post_window.as_array().unwrap().len(), 2, "the lower edge leaves and the upper edge enters exactly");
        for limit in [1, 1, 1] {
            let from = state(&mut *device).0;
            assert_eq!(server.sweep_expired(now + 1, limit).unwrap(), 1);
            let physical = server.store().rows("likeCounts").unwrap();
            let live = server.query("rollingLikes", Context::new("bob", args(&[])).at(now + 1)).unwrap();
            assert!(live.complete);
            assert_eq!(snapback4_core::wire::to_json(&live.data), expected);
            ok(apply(&mut *device, &stream_page_at(&mut server, "bob", from, now + 1), false));
            assert_eq!(rank(&mut *device, "rollingLikes", now + 1), expected, "a partial sweep cannot change the live answer");
            println!("W12a {}: physical={}; live={}; examined={}", label, serde_json::to_string(&physical).unwrap(), expected, live.metered.examined);
        }
        assert_eq!(server.sweep_expired(now + 1, 1).unwrap(), 0);
        for (i, liked) in [true, true, false, false].into_iter().enumerate() {
            let from = state(&mut *device).0;
            let write = server.mutate("setLike", Some(&format!("set-{i}")), Context::new("bob", args(&[("postId", id("zero")), ("liked", Value::Bool(liked))])).at(now + 2).with_ids([format!("l{i}")])).unwrap();
            assert!(matches!(write.state, WriteState::Sent { .. }), "{write:?}");
            ok(apply(&mut *device, &stream_page_at(&mut server, "bob", from, now + 2), false));
            let read = rank(&mut *device, "trending", now + 2);
            let edge = read.as_array().unwrap().iter().find(|r| r["postId"] == "zero").unwrap();
            assert_eq!(edge["score"], i64::from(liked));
        }
        println!("W12a {}: 3 partial sweeps; 4 immediate set/clear reads; lag=0 ms; score-table writes=0", label);
        device.close();
    });
}

#[test]
fn w12a_bounded_ranking_coverage_on_both_stores() {
    on_both(|host| {
        let label = host.label();
        let now = 2 * DAY;
        for count in [1500, 8193] {
            let (mut server, backend) = compile(&recipe());
            server.seed((0..count).map(|n| post(&format!("p{n:05}"), now))).unwrap();
            server.seed([like("winner", "p01250", now + DAY)]).unwrap();
            let name = format!("w12a-size-{count}");
            let mut device = host.open(&name, Some(backend)).unwrap();
            for (i, page) in snapshot_pages_at(&mut server, "bob", 1000, now).iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
            let read = query(&mut *device, "trending", "bob", json!({}), now);
            assert_eq!(read["complete"], count == 1500, "{label}: {read}");
            assert_eq!(read["data"].as_array().unwrap().len(), 10);
            if count == 1500 { assert_eq!(read["data"][0]["postId"], "p01250"); }
            println!("W12a {label} coverage: candidates={count}; likes=1; returned=10; complete={}", read["complete"]);
            device.close();
        }
        let source = recipe().replace("  sync public\n\nmaintain likeCounts", "  sync public last 1 by byExpiresAt\n\nmaintain likeCounts");
        let (mut server, backend) = compile(&source);
        server.seed([post("p", now), like("a", "p", now + 1), like("b", "p", now + 2)]).unwrap();
        let mut device = host.open("w12a-source-horizon", Some(backend)).unwrap();
        for (i, page) in snapshot_pages_at(&mut server, "bob", 100, now).iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
        assert_eq!(query(&mut *device, "rollingLikes", "bob", json!({}), now)["complete"], false, "a partial source cannot certify a count or ranking");
        device.close();
    });
}
