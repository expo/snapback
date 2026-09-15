use super::common::*;
#[path = "../../../snapback4-sim/tests/search_global/fixture.rs"] mod fixture;
use fixture::{source, seed, Walk};

fn held_search<H: Host>(host: &mut H) {
    for memberships in [100, 500, 1000] {
        for horizon in [false, true] {
            let source = if horizon { source().replace("  sync to members[.roomId]\n\nquery searchHeld", "  sync to members[.roomId] last 10 by byRoomTime\n\nquery searchHeld") } else { source().into() };
            let (mut engine, backend) = compile(&source);
            engine.seed(seed(memberships)).unwrap();
            let name = format!("global-{memberships}-{horizon}");
            let mut device = host.open(&name, Some(backend)).unwrap();
            let pages = snapshot_pages(&mut engine, "dev:alice", 4000);
            let acquired = pages.iter().flat_map(|p| &p.events).filter(|e| e.table == "messages").count();
            assert_eq!(acquired, memberships * if horizon { 10 } else { 30 });
            for (n, page) in pages.iter().enumerate() { device.apply(page, n == 0).unwrap(); }
            // Reopen first: this is the same durable-held form warm and cold offline.
            host.close(&name, device);
            let mut device = host.open(&name, None).unwrap();
            let mut walk = Walk::new();
            let mut cursor = None;
            loop {
                let (page, unknown, retained) = device.query_with_coverage("searchHeld", "dev:alice", &serde_json::json!({"q":"cof", "c":cursor}), 2000);
                let page = page.unwrap();
                assert_eq!(page.complete, !horizon);
                assert_eq!(unknown, horizon);
                assert!(!retained);
                cursor = page.next.clone();
                walk.add(&page);
                if cursor.is_none() { break; }
            }
            walk.assert_matches(memberships, if horizon { 4 } else { 24 });
            assert_eq!((walk.first_examined, walk.max_examined), (22, 22));
            assert_eq!(walk.examined, walk.pages as u64 * 22 - 2);
            walk.print(&format!("device-{}-{}", host.label(), if horizon { "horizon10" } else { "full" }), memberships);
            println!("W7d acquisition: store={} memberships={memberships} horizon={horizon} messages={acquired}", host.label());
            let empty = device.query("searchHeld", "dev:alice", &serde_json::json!({"q":"absent"}), 2000).unwrap();
            assert!(empty.data.as_array().unwrap().is_empty());
            assert_eq!(empty.complete, !horizon, "empty held search cannot prove a horizon complete");
            host.close(&name, device);
        }
    }
}

#[test]
fn w7d_every_chat_word_search_measures_full_and_horizon_holdings_on_both_stores() {
    held_search(&mut Sqlite::new("w7d-search"));
    held_search(&mut Memory::new());
}

#[test]
fn w7d_global_word_scope_can_cut_when_each_chat_scope_fits() {
    fn run<H: Host>(host: &mut H) {
        let (mut engine, backend) = compile(source());
        let rows = seed(100).into_iter().map(|(table, mut row)| {
            if table == "messages" {
                let room = row.field("roomId").unwrap().as_str().unwrap().to_owned();
                if let snapback4_core::Value::Row(ref mut fields) = row { fields.insert("body".into(), snapback4_core::Value::String(format!("coffee{room}"))); }
            }
            (table, row)
        });
        engine.seed(rows).unwrap();
        let mut device = host.open("word-cut", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "dev:alice", 4000).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
        let global = device.query("searchHeld", "dev:alice", &serde_json::json!({"q":"cof"}), 2000).unwrap();
        assert!(!global.complete && global.word_cut_at.is_some() && global.next.is_none());
        let scoped = device.query("searchChatBatch", "dev:alice", &serde_json::json!({"q":"cof"}), 2000).unwrap();
        assert!(scoped.complete && scoped.word_cut_at.is_none() && scoped.next.is_some());
        assert_eq!(scoped.data.as_array().unwrap().len(), 20);
        host.close("word-cut", device);
    }
    run(&mut Sqlite::new("w7d-word-cut"));
    run(&mut Memory::new());
}
