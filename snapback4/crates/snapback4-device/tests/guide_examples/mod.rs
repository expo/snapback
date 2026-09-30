//! Execute the published typing and directory queries over both replica stores.
use super::*;
use serde_json::json;
use snapback4_core::{value::object, wire};

#[test]
fn w10r1_typing_card_extends_and_expires_on_both_stores() {
    // LLP 3000.017 section 2.5 replaces the durable typing recipe: the server
    // renews it; replicas keep this read unknown instead of holding its rows.
    let source = snapback4_lang::guide::quarry(snapback4_lang::guide::card("ephemeral").unwrap())
        .into_iter().find(|block| block.contains("table typing:")).unwrap();
    on_both(|host| {
        let label = host.label();
        let (mut engine, backend) = compile(&source);
        engine.seed([
            ("rooms".into(), object([("id", id("room")), ("name", Value::String("Chat".into()))])),
            ("members".into(), object([("id", id("a")), ("roomId", id("room")), ("principal", id("alice"))])),
            ("members".into(), object([("id", id("b")), ("roomId", id("room")), ("principal", id("bob"))])),
        ]).unwrap();
        let typing = |who, now| context(who, &[("roomId", id("room"))]).at(now);
        assert!(matches!(engine.mutate("setTyping", None, typing("alice", 1000)).unwrap().state, WriteState::Sent { .. }));
        let mut device = host.open("typing", Some(backend)).unwrap();
        for (n, page) in snapshot_pages_at(&mut engine, "bob", 100, 1000).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        let first = engine.query("typingIn", typing("bob", 1000)).unwrap();
        assert_eq!(wire::to_json(&first.data), json!([{"principal":"alice"}]));
        assert_eq!(first.next_expiry, Some(5000));
        let before = engine.seq().unwrap();
        assert!(matches!(engine.mutate("setTyping", None, typing("alice", 4000)).unwrap().state, WriteState::Sent { .. }));
        assert_eq!(engine.seq().unwrap(), before);
        for now in [4000, 5000, 7999, 8000] {
            let local = query(&mut *device, "typingIn", "bob", json!({"roomId":"room"}), now);
            assert_eq!(local["unknown"], true, "{label}: ephemeral reads are unknown locally: {local}");
            assert_ne!(local["complete"], true, "{label}: no authoritative local ephemeral answer: {local}");
            if let Some(data) = local.get("data") { assert_eq!(data, &json!([]), "{label}: no replicated typing rows"); }
            let server = engine.query("typingIn", typing("bob", now)).unwrap();
            assert_eq!(server.data.as_array().unwrap().len(), usize::from(now < 8000));
            assert_eq!(server.next_expiry, if now < 8000 { Some(8000) } else { None });
        }
        println!("E1 typing {label}: device unknown; initial_deadline=5000 renewed_deadline=8000; no durable sequence change");
        device.close();
    });
}

#[test]
fn w10r1_directory_card_pages_and_searches_on_both_stores() {
    let source = snapback4_lang::guide::quarry(snapback4_lang::guide::card("search").unwrap()).into_iter().find(|block| block.contains("table profiles:")).unwrap();
    // The card also declares unrelated room queries. Only the directory's public
    // profiles need acquisition for these two operations; keep their query text verbatim.
    let source = source.replace("  public 'profiles are public'", "  public 'profiles are public'\n  sync public");
    on_both(|host| {
        let label = host.label();
        let (mut engine, backend) = compile(&source);
        engine.seed((0..25).map(|n| ("profiles".into(), object([
            ("id", id(&format!("p{n:02}"))), ("principal", id(&format!("person{n}"))),
            ("displayName", Value::String(if n == 24 { "Dave".into() } else { format!("Person {n}") })),
            ("handle", Value::String(format!("person{n:02}"))),
        ])))).unwrap();
        let mut device = host.open("directory", Some(backend)).unwrap();
        let pages = snapshot_pages(&mut engine, "alice", 10);
        assert_eq!(pages.iter().map(|page| page.events.len()).sum::<usize>(), 25);
        for (n, page) in pages.iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        for needle in ["", "   ", "!!!"] {
            let page = query(&mut *device, "people", "alice", json!({"q":needle}), 1000);
            assert_eq!(rows(&page).len(), 20, "{label}: {page}");
            assert_eq!(page["complete"], true);
            assert!(page["next"].is_string());
        }
        for needle in ["", "   ", "!!!", "person"] {
            let mut cursor = json!(null);
            let mut ids = Vec::new();
            let mut sizes = Vec::new();
            loop {
                let args = json!({"q":needle, "c":cursor});
                let page = query(&mut *device, "people", "alice", args, 1000);
                assert_eq!(page["complete"], true, "{label}: {page}");
                sizes.push(rows(&page).len());
                ids.extend(rows(&page).iter().map(|row| row["id"].as_str().unwrap().to_owned()));
                cursor = page["next"].clone();
                if cursor.is_null() { break; }
                assert!(sizes.len() < 3, "{label}: directory cursor did not finish");
            }
            assert_eq!(ids, (0..25).map(|n| format!("p{n:02}")).collect::<Vec<_>>());
            assert_eq!(sizes, [20, 5]);
        }
        // Switching query/needle resets the cursor: Dave lies beyond the browse first page.
        let typed = query(&mut *device, "people", "alice", json!({"q":"dav", "c":null}), 1000);
        assert_eq!(rows(&typed).len(), 1);
        assert_eq!(typed["data"][0]["id"], "p24");
        assert_eq!(typed["complete"], true);
        assert!(typed["next"].is_null());
        println!("W10R1 directory {label}: acquired_rows=25 empty_needles=3 empty_matches=0 browse_pages=20+5 search_pages=20+5 dav_matches=1");
        device.close();
    });
}
