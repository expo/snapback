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
    let mut source = recipe().replace("last 20 by byConversationOrdinal", "last 2 by byConversationOrdinal");
    if !sequence { source = source.replace("sequence by conversation", "int"); }
    source = source.replace(" last 500 by byConversationOrdinal", &horizon.map(|n| format!(" last {n} by byConversationOrdinal")).unwrap_or_default());
    source = source.replace("  body: text <=2000", "  at: time\n  body: text <=2000");
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

// Shared with the HTTP/process/wasm client oracle. Equal buckets have ordinal
// order opposite to id order, including a tie that crosses a page boundary.
fn composite_order<H: Host>(host: &mut H) {
    let (mut server, backend) = compile(include_str!("matching_order/composite.q"));
    let fixture: serde_json::Value = serde_json::from_str(include_str!("matching_order/composite.json")).unwrap();
    server.seed(["chat", "hidden"].map(|key| ("conversations".into(), object([("id", id(key))])))).unwrap();
    server.seed([("m1", "chat", "dev:alice"), ("m2", "hidden", "dev:bob")].map(|(key, chat, who)| (
        "members".into(), object([("id", id(key)), ("conversation", id(chat)), ("principal", id(who))])
    ))).unwrap();
    server.seed(fixture["messages"].as_array().unwrap().iter().map(|row| (
        "messages".into(), snapback4_core::wire::row_from_json(&backend.schema.tables["messages"], row).unwrap()
    ))).unwrap();
    let mut device = host.open("composite-order", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "dev:alice", 2).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    host.close("composite-order", device);
    let mut device = host.open("composite-order", None).unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let name = case["query"].as_str().unwrap();
        let q = case["needle"].as_str().unwrap();
        let expected = case["pages"].as_array().unwrap();
        let mut cursor = None;
        for (n, want) in expected.iter().enumerate() {
            let arguments = args(&[("conversation", id("chat")), ("q", Value::String(q.into())), ("c", cursor.clone().map(Value::String).unwrap_or(Value::Null))]);
            let page = server.query(name, Context::new("dev:alice", arguments.clone())).unwrap();
            assert!(page.complete && page.cut.is_none(), "{name}: {page:?}");
            assert_eq!(json!(ids(&page)), *want, "{name} {q} page {n}");
            if let Some(control) = case["control"].as_str() {
                let other = server.query(control, Context::new("dev:alice", arguments)).unwrap();
                assert_eq!(page.data, other.data);
                assert_eq!(page.next, other.next);
            }
            let local = device.query(name, "dev:alice", &json!({"conversation":"chat", "q":q, "c":cursor}), snapback4_core::now_ms()).unwrap();
            assert!(local.complete && local.cut.is_none(), "{name}: {local:?}");
            assert_eq!(local.data, page.data);
            assert_eq!(local.next, page.next);
            cursor = local.next;
            if n + 1 < expected.len() { assert!(cursor.is_some(), "{name} ended early"); }
        }
        // A full terminal page can have a final empty continuation.
        if cursor.is_some() {
            let arguments = args(&[("conversation", id("chat")), ("q", Value::String(q.into())), ("c", Value::String(cursor.clone().unwrap()))]);
            let page = server.query(name, Context::new("dev:alice", arguments)).unwrap();
            let local = device.query(name, "dev:alice", &json!({"conversation":"chat", "q":q, "c":cursor}), snapback4_core::now_ms()).unwrap();
            for end in [page, local] { assert!(ids(&end).is_empty() && end.complete && end.cut.is_none() && end.next.is_none(), "{name}: {end:?}"); }
        }
    }
    host.close("composite-order", device);
}

#[test]
fn composite_order_offline_memory() { composite_order(&mut Memory::new()); }
#[test]
fn composite_order_offline_sqlite() { composite_order(&mut Sqlite::new("composite-order")); }

// @ref LLP 3000.007#18.1 — the named order has exactly the existing search
// boundary: a cut is never certified exhaustion, even when it returns no hits.
fn meter_boundary<S: snapback4_device::store::DeviceStore>(mut store: S, label: &str) {
    use snapback4_core::{Ceilings, engine::local};
    use snapback4_core::rows::Rows;
    let source = recipe().replace("sequence by conversation", "int")
        .replace(" last 500 by byConversationOrdinal", "");
    let (mut server, backend) = compile(&source);
    let mut seed = vec![("conversations".into(), object([("id", id("chat"))])),
        ("members".into(), object([("id", id("member")), ("conversation", id("chat")), ("principal", id("alice"))]))];
    seed.extend((1..=41).map(|n| ("messages".into(), object([
        ("id", id(&format!("m{n}"))), ("conversation", id("chat")), ("ordinal", Value::Int(n)),
        ("body", Value::String("coffee coffers".into()))]))));
    server.seed(seed.clone()).unwrap();
    let program = backend.programs.iter().find(|p| p.name == "searchChat").unwrap().clone();
    store.install(&backend.schema, &Default::default(), false).unwrap();
    let tx = store.transaction().unwrap();
    for (table, row) in seed { tx.put(&table, &backend.schema.tables[&table], &row, None).unwrap(); }
    let ctx = || context("alice", &[("conversation", id("chat")), ("q", Value::String("cof absent".into())), ("c", Value::Null)]);
    let full_server = server.query("searchChat", ctx()).unwrap();
    let full_device = local::query(&tx, &backend.schema, &program, ctx(), Ceilings::default()).unwrap();
    for (authority, full) in [("server", full_server), ("device", full_device)] {
        assert!(full.complete && full.cut.is_none() && full.next.is_none(), "{authority}: {full:?}");
        assert!(ids(&full).is_empty());
        for meter in ["examined", "index_entries", "heap_bytes"] {
            let mut used = match meter { "examined" => full.metered.examined, "index_entries" => full.metered.index_entries, _ => full.metered.heap_bytes };
            assert!(used > 0);
            // Heap admission may reserve more than the observed live peak.
            // Find that host's admission boundary, rather than treating its
            // reported use as permission to bypass the reservation.
            if meter == "heap_bytes" {
                let (mut low, mut high) = (0, Ceilings::default().heap_bytes);
                while low < high {
                    let middle = low + (high - low) / 2;
                    let ceilings = Ceilings { heap_bytes: middle, ..Default::default() };
                    server.set_ceilings(ceilings);
                    let page = if authority == "server" { server.query("searchChat", ctx()).unwrap() }
                        else { local::query(&tx, &backend.schema, &program, ctx(), ceilings).unwrap() };
                    if page.complete { high = middle; } else { low = middle + 1; }
                }
                used = low;
            }
            for limit in [used - 1, used, used + 1] {
                let mut ceilings = Ceilings::default();
                match meter { "examined" => ceilings.examined = limit, "index_entries" => ceilings.index_entries = limit, _ => ceilings.heap_bytes = limit }
                server.set_ceilings(ceilings);
                let page = if authority == "server" { server.query("searchChat", ctx()).unwrap() }
                    else { local::query(&tx, &backend.schema, &program, ctx(), ceilings).unwrap() };
                assert_eq!(page.complete, limit >= used, "{} {authority} {meter}={limit}/{used}: {page:?}", label);
                assert_eq!(page.cut.is_some(), limit < used, "{authority} {meter}={limit}/{used}: {page:?}");
                assert!(page.next.is_none(), "no continuation past a cut");
            }
            println!("IS {} {authority}: {meter} complete at {used}, incomplete at {}", label, used - 1);
        }
    }
    drop(tx);
}

#[test]
fn named_order_meter_boundary_memory() { meter_boundary(snapback4_device::memory::MemoryStore::new(), "memory"); }
#[test]
fn named_order_meter_boundary_sqlite() { meter_boundary(snapback4_core::Store::memory().unwrap(), "sqlite"); }
