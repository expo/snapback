mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Context, Value, engine::QueryOutcome, value::object};

fn recipe() -> String {
    snapback4_lang::guide::quarry(snapback4_lang::guide::card("search").unwrap()).into_iter()
        .find(|source| source.contains("ordinal: sequence by")).unwrap()
}

fn ids(page: &QueryOutcome) -> Vec<String> {
    page.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()).collect()
}

fn scenario<H: Host>(host: &mut H, sequence: bool, horizon: Option<usize>) {
    let mut source = recipe().replace("last 20 by .ordinal", "last 2 by byConversationOrdinal");
    if !sequence { source = source.replace("sequence by conversation", "int"); }
    source = source.replace(" last 500 by byConversationOrdinal", &horizon.map(|n| format!(" last {n} by byConversationOrdinal")).unwrap_or_default());
    // Execute the actual printed repair, rather than a separately maintained spelling.
    let refused = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
    assert_eq!(refused.diagnostics.len(), 1, "{:?}", refused.diagnostics);
    let read = "messages[conversation = conversation] matching q last 2 by byConversationOrdinal after c";
    let rewrite = &refused.diagnostics[0].rewrite;
    assert!(!rewrite.is_empty());
    source = source.replace(read, rewrite).replace("  body: text <=2000", "  at: time\n  body: text <=2000");
    let (mut server, backend) = compile(&source);
    server.seed(["chat", "hidden"].map(|key| ("conversations".into(), object([("id", id(key))])))).unwrap();
    server.seed([("m1", "chat", "alice"), ("m2", "hidden", "bob")].map(|(key, chat, who)| (
        "members".into(), object([("id", id(key)), ("conversation", id(chat)), ("principal", id(who))])
    ))).unwrap();
    // Seed order allocates sequence positions. IDs and timestamps run backwards
    // so a timestamp/id workaround cannot accidentally satisfy this oracle.
    for (n, body) in ["oldonly coffee car", "coffee", "nothing", "coffers car", "coffee coffers car", "cofounder car", "coffee car"].into_iter().enumerate() {
        let mut row = args(&[("id", id(&format!("row{}", 7 - n))), ("conversation", id("chat")), ("body", Value::String(body.into())), ("at", Value::Int(100 - n as i64))]);
        if !sequence { row.insert("ordinal".into(), Value::Int((n as i64 + 1) * 10)); }
        server.seed([("messages".into(), Value::Row(row.into()))]).unwrap();
    }
    let mut hidden = args(&[("id", id("secret")), ("conversation", id("hidden")), ("body", Value::String("coffee car".into())), ("at", Value::Int(999))]);
    if !sequence { hidden.insert("ordinal".into(), Value::Int(999)); }
    server.seed([("messages".into(), Value::Row(hidden.into()))]).unwrap();
    let name = format!("ordered-{sequence}-{horizon:?}");
    let mut device = host.open(&name, Some(backend)).unwrap();
    let pages = snapshot_pages(&mut server, "alice", 2);
    let acquired = pages.iter().flat_map(|page| &page.events).filter(|event| event.table == "messages").count();
    assert_eq!(acquired, if horizon == Some(3) { 3 } else { 7 });
    for (i, page) in pages.iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    host.close(&name, device);
    let mut device = host.open(&name, None).unwrap();
    for (q, expected) in [
        ("cof", vec!["row1", "row2", "row3", "row4", "row6", "row7"]),
        ("cof car", vec!["row1", "row2", "row3", "row4", "row7"]),
        ("...", vec!["row1", "row2", "row3", "row4", "row5", "row6", "row7"]),
        ("absent", vec![]),
        ("oldonly", vec!["row7"]),
    ] {
        let mut cursor = None;
        let mut server_pages = Vec::new();
        let mut seen = Vec::new();
        for _ in 0..8 {
            let page = server.query("searchChat", Context::new("alice", args(&[("conversation", id("chat")), ("q", Value::String(q.into())), ("c", cursor.clone().map(Value::String).unwrap_or(Value::Null))]))).unwrap();
            assert!(page.complete && page.cut.is_none(), "{page:?}");
            seen.extend(ids(&page));
            cursor = page.next.clone();
            server_pages.push(page);
            if cursor.is_none() { break; }
        }
        assert!(cursor.is_none());
        assert_eq!(seen, expected);
        let mut local_seen = Vec::new();
        let mut terminal_complete = true;
        for i in 0..8 {
            // Device::query uses only the reopened store; no online fallback.
            let page = device.query("searchChat", "alice", &json!({"conversation":"chat", "q":q, "c":cursor}), snapback4_core::now_ms()).unwrap();
            assert!(page.cut.is_none(), "{page:?}");
            if horizon.is_none() {
                assert!(page.complete, "{page:?}");
                assert_eq!(page.data, server_pages[i].data);
                assert_eq!(page.next, server_pages[i].next, "server and device cursors interchange");
            }
            terminal_complete = page.complete;
            local_seen.extend(ids(&page));
            cursor = page.next;
            if cursor.is_none() { break; }
        }
        assert!(cursor.is_none());
        let local_expected: Vec<_> = expected.into_iter().filter(|id| horizon != Some(3) || ["row1", "row2", "row3"].contains(id)).collect();
        assert_eq!(local_seen, local_expected);
        // Empty-term browsing uses the ordinary ordinal index. Its 500-row
        // window covers this fixture; word-order coverage remains conservative.
        let complete = horizon.is_none() || (horizon == Some(500) && q == "...");
        assert_eq!(terminal_complete, complete, "window={horizon:?}, needle={q}");
    }
    let denied = server.query("searchChat", Context::new("alice", args(&[("conversation", id("hidden")), ("q", Value::String("cof".into()))]))).unwrap();
    assert!(ids(&denied).is_empty() && denied.complete && denied.next.is_none());
    let local = device.query("searchChat", "alice", &json!({"conversation":"hidden", "q":"cof"}), snapback4_core::now_ms()).unwrap();
    assert!(ids(&local).is_empty());
    host.close(&name, device);
}

#[test]
fn ordered_search_offline_memory() {
    for sequence in [false, true] { for horizon in [None, Some(500), Some(3)] { scenario(&mut Memory::new(), sequence, horizon); } }
}

#[test]
fn ordered_search_offline_sqlite() {
    for sequence in [false, true] { for horizon in [None, Some(500), Some(3)] { scenario(&mut Sqlite::new("matching-order"), sequence, horizon); } }
}
