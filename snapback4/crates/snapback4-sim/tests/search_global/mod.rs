mod fixture;
mod cursors;
use fixture::{source, seed, Walk};
use snapback4_core::{Context, Engine, Value, engine::QueryOutcome};

fn query(engine: &mut Engine, name: &str, batch: Option<String>, cursor: Option<String>, term: &str) -> QueryOutcome {
    let mut args = std::collections::BTreeMap::from([("c".into(), cursor.map_or(Value::Null, Value::String))]);
    if name != "searchChats" { args.insert("q".into(), Value::String(term.into())); }
    if name == "searchChatBatch" { args.insert("batch".into(), batch.map_or(Value::Null, Value::String)); }
    engine.query(name, Context::new("dev:alice", args).at(2000)).unwrap()
}

#[test]
fn w7d_server_search_walks_every_membership_and_measures_the_wide_alternative() {
    for memberships in [100, 500, 1000] {
        let wide = "\nquery wide(q: text <=100, c: cursor ?):\n  return merge messages matching q after c last 20 by byRoomWords:\n    [m.roomId] for m in members[viewer] first 1000 by byPrincipalRoom\n";
        let bound = snapback4_lang::compile(&[("schema.q".into(), format!("{}{wide}", source()))]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        engine.seed(seed(memberships)).unwrap();
        let first = query(&mut engine, "wide", None, None, "cof");
        println!("W7d wide: memberships={memberships} hits={} examined={} complete={} next={} capped={:?}", first.data.as_array().unwrap().len(), first.metered.examined, first.complete, first.next.is_some(), first.capped_at);
        assert_eq!(first.complete, memberships == 100, "the cursor alone does not fix a meter-cut merge");
        assert_eq!(first.next.is_some(), memberships == 100);
        assert_eq!(first.metered.examined, match memberships { 100 => 2400, 500 => 8358, _ => 8880 });

        let mut batch = None;
        let mut walk = Walk::new();
        let mut discovery_examined = 0;
        let mut batches = 0;
        loop {
            let chats = query(&mut engine, "searchChats", None, batch.clone(), "cof");
            assert!(chats.complete, "membership discovery must itself be complete");
            discovery_examined += chats.metered.examined;
            batches += 1;
            walk.start_batch();
            let mut cursor = None;
            loop {
                let page = query(&mut engine, "searchChatBatch", batch.clone(), cursor, "cof");
                assert!(page.complete, "{page:?}");
                cursor = page.next.clone();
                walk.add(&page);
                if cursor.is_none() { break; }
            }
            batch = chats.next;
            if batch.is_none() { break; }
        }
        walk.assert_matches(memberships, 24, 50);
        walk.print("server-batches", memberships);
        println!("W7d discovery: memberships={memberships} batches={batches} examined_total={discovery_examined}");
        assert_eq!(batches, memberships / 50);
        assert_eq!(walk.pages, memberships * 24 / 20);
        assert_eq!((walk.first_examined, walk.max_examined), (1201, 1201));
        assert_eq!(walk.examined, match memberships { 100 => 79080, 500 => 395640, _ => 791340 });
        assert_eq!(discovery_examined, memberships as u64 + batches as u64 - 1);
    }
}

#[test]
fn w7d_empty_batches_do_not_end_discovery_and_cursors_are_not_interchangeable() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source().into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let mut rows = seed(100);
    rows.retain(|(table, row)| table == "members" || row.field("roomId").unwrap().as_str().unwrap() >= "r0050");
    engine.seed(rows).unwrap();
    let chats = query(&mut engine, "searchChats", None, None, "cof");
    let empty = query(&mut engine, "searchChatBatch", None, None, "cof");
    assert!(empty.complete && empty.next.is_none() && empty.data.as_array().unwrap().is_empty());
    assert!(chats.next.is_some());
    let found = query(&mut engine, "searchChatBatch", chats.next.clone(), None, "cof");
    assert!(found.complete && found.next.is_some());
    assert_eq!(found.data.as_array().unwrap().len(), 20);
    let error = engine.query("searchChatBatch", Context::new("dev:alice", [("q".into(), Value::String("cof".into())), ("c".into(), Value::String(chats.next.unwrap()))]).at(2000)).unwrap_err();
    assert!(error.to_string().contains("cursor"), "{error}");
}

#[test]
fn w7r1b_server_search_cursor_positions_and_descriptors() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), cursors::source())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(cursors::seed()).unwrap();
    for op in ["searchLane", "searchPair", "searchChatBatch"] {
        let first = query(&mut engine, op, None, None, "cof");
        let next = first.next.unwrap();
        for (name, token, mut expected) in cursors::positions(&bound.schema, &next) {
            if op == "searchLane" { expected.retain(|id| id.starts_with("r0000")); }
            let mut cursor = Some(token);
            let mut actual = Vec::new();
            let mut pages = 0;
            loop {
                let page = query(&mut engine, op, None, cursor, "cof");
                actual.extend(cursors::ids(&page));
                cursor = page.next;
                pages += 1;
                assert!(pages < 10);
                if cursor.is_none() { break; }
            }
            assert_eq!(actual, expected, "{op} {name}");
        }
        for (name, token) in cursors::malformed(&bound.schema, &next) {
            let error = engine.query(op, Context::new("dev:alice", [("q".into(), Value::String("cof".into())), ("c".into(), Value::String(token))]).at(2000)).unwrap_err();
            assert_eq!(error.code, "E_INPUT", "{op} {name}: {error}");
            assert!(error.to_string().contains("cursor"));
        }
        println!("W7R1b cursor host=server op={op} valid_positions=3 malformed_descriptors=8 exact_order=true");
    }
}
