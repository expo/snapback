//! @ref LLP 3000.028#3.3.1 — independent point reads and the bare page are the oracle.
use snapback4_core::{Context, Engine, Value, wire};
const SOURCE: &str = include_str!("decorated_search.q");
fn fixture(groups: usize) -> Engine { fixture_words(groups, false) }
fn fixture_words(groups: usize, words: bool) -> Engine {
    let b = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    for name in ["decorated", "projection", "pinned"] { assert!(b.schema.operations[name].search_decoration, "{name}"); }
    assert!(b.schema.operations["decorated"].search.is_some());
    let mut rows = Vec::new();
    for i in 0..groups {
        rows.push(("members", serde_json::json!({"id":format!("u{i}"),"room":format!("r{i}"),"principal":"alice"})));
        rows.push(("rooms", serde_json::json!({"id":format!("r{i}"),"title":format!("Room {i}")})));
    }
    rows.push(("profiles", serde_json::json!({"id":"p", "principal":"alice", "name":"Alice"})));
    for i in 0..60 { rows.push(("messages", serde_json::json!({"id":format!("m{i:03}"),"room":format!("r{}",i%groups),"author":"alice","body":if words {format!("coffee{i:03}")} else {"coffee".into()},"at":i}))); }
    let seed: Vec<(String, Value)> = rows.into_iter().map(|(t,v)| (t.into(), wire::row_from_json(&b.schema.tables[t], &v).unwrap())).collect();
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    engine.seed_at(seed, 100).unwrap(); engine
}
fn cx(c: Option<String>) -> Context { Context::new("alice", [("q".into(), Value::String("coffee".into())),("c".into(),c.map(Value::String).unwrap_or(Value::Null))].into()).at(100) }
#[test]
fn page_and_pinned_metadata_match_bare_and_points_are_deduplicated() {
    let mut e = fixture(3);
    for (bare, decorated) in [("bare","decorated"),("pinnedBare","pinned")] {
        let mut cursor = None;
        loop {
            let mut context = cx(cursor.clone());
            if bare == "pinnedBare" { context.args.insert("room".into(), Value::Id("r0".into())); }
            let a = e.query(bare,context.clone()).unwrap(); let b = e.query(decorated,context).unwrap();
            assert_eq!((&a.complete,&a.cut,&a.next),(&b.complete,&b.cut,&b.next));
            let mut keys = std::collections::BTreeSet::new();
            for (row, hit) in a.data.as_array().unwrap().iter().zip(b.data.as_array().unwrap()) {
                let room = row.field("room").unwrap().clone(); keys.insert(room.as_str().unwrap().to_owned());
                let title = e.query("roomTitle", Context::new("alice", [("room".into(),room)].into()).at(100)).unwrap().data;
                let sender = e.query("profile",Context::new("alice",[("author".into(), row.field("author").unwrap().clone())].into()).at(100)).unwrap().data;
                assert_eq!(hit.field("title").unwrap(),&title); assert_eq!(hit.field("sender").unwrap(),&sender);
                for (key,value) in row.as_object().unwrap().iter() { assert_eq!(hit.field(key).unwrap(),value); }
            }
            let added = if a.data.as_array().unwrap().is_empty() {0} else {keys.len() as u64+1};
            assert_eq!(b.metered.examined, a.metered.examined+added);
            println!("{bare}/{decorated}: bare={:?} decorated={:?}; distinct={added}",a.metered,b.metered);
            cursor = a.next; if cursor.is_none() {break;}
        }
    }
}
#[test]
fn projection_can_omit_id_and_order_without_losing_source_keys() {
    let mut e = fixture(3);
    let a=e.query("bare",cx(None)).unwrap(); let b=e.query("projection",cx(None)).unwrap();
    assert_eq!(a.next,b.next); assert_eq!(b.data.as_array().unwrap().len(),20);
    let keys=b.search_rows.unwrap();
    for (row,key) in a.data.as_array().unwrap().iter().zip(keys.as_array().unwrap()) {assert_eq!(row.field("id"),key.field("id"));assert_eq!(row.field("at"),key.field("at"));}
}
#[test]
fn scale_page_adds_only_distinct_decoration_reads() {
    let mut e=fixture(1000);
    let a=e.query("bare",cx(None)).unwrap();let b=e.query("decorated",cx(None)).unwrap();
    assert_eq!((&a.next,a.complete,&a.cut),(&b.next,b.complete,&b.cut));
    assert_eq!(b.metered.examined-a.metered.examined,21);
    println!("1000 scopes bare={:?} decorated={:?}; 20 distinct rooms + 1 sender",a.metered,b.metered);
}
#[test]
fn combined_page_only_decorates_selected_current_hits() {
    let mut e=fixture(3);
    // Retained candidates own this entire combined prefix. Their IDs are not
    // server rows; ordinary overlap authorizes no current replacement.
    let ids=(0..20).map(|i|format!("retained{i:03}")).collect::<Vec<_>>();
    let mut context=cx(None);context.search_retained_order=Some(((100..120).rev().collect(),true));
    let a=e.query_search_at("bare",context.clone(),Some(&ids)).0.unwrap();
    let b=e.query_search_at("decorated",context,Some(&ids)).0.unwrap();
    assert_eq!(a.metered.examined,b.metered.examined,"no decoration key was selected");
    assert!(b.data.as_array().unwrap().iter().all(|v|*v==Value::Null));
    assert_eq!(a.next,b.next);assert_eq!(a.complete,b.complete);
}
#[test]
fn generated_handles_only_mark_actual_source_identity() {
    let s=format!("{SOURCE}\nquery renamed(q: text, c: cursor ?):\n  return messages matching q last 20 by .at after c {{ id: .room, title: rooms[.room].title }}\n");
    let b=snapback4_lang::compile(&[("schema.q".into(),s)]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let ts=snapback4_lang::emit::typescript(&b);
    assert!(ts.lines().find(|s|s.contains("name: \"decorated\"")).unwrap().contains("rowKey: \"id\""));
    assert!(!ts.lines().find(|s|s.contains("name: \"renamed\"")).unwrap().contains("rowKey"));
}
#[test]
fn decoration_exhaustion_refuses_instead_of_changing_the_page() {
    let mut e=fixture(3);
    let bare=e.query("bare",cx(None)).unwrap();
    let mut ceilings=e.ceilings(); ceilings.examined=bare.metered.examined;
    e.set_ceilings(ceilings);
    let bare_again=e.query("bare",cx(None)).unwrap();
    assert_eq!(bare.next,bare_again.next);
    let error=e.query("decorated",cx(None)).unwrap_err();
    assert_eq!(error.code,"E_BOUND");
}

#[path = "search_global/fixture.rs"]
mod scale_fixture;
#[test]
fn established_w13_scale_corpus_adds_only_distinct_keys() {
    let mut seed=scale_fixture::seed(1000);
    // Keep the W13 1,000 visible + one hidden room, 30 messages each,
    // 24 coffee hits per room and equal timestamps; add presentation columns.
    for (table,row) in &mut seed {
        let Value::Row(fields)=row else {unreachable!()};
        let room=fields.remove("roomId").unwrap();fields.insert("room".into(),room);
        if table=="messages" { fields.insert("author".into(),Value::Id("dev:alice".into())); }
    }
    for room in 0..=1000 { seed.push(("rooms".into(),snapback4_core::value::object([
        ("id",Value::Id(format!("r{room:04}"))),("title",Value::String(format!("Room {room}")))]))); }
    seed.push(("profiles".into(),snapback4_core::value::object([
        ("id",Value::Id("p".into())),("principal",Value::Id("dev:alice".into())),("name",Value::String("Alice".into()))])));
    let b=snapback4_lang::compile(&[("schema.q".into(),SOURCE.into())]);
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();e.seed_at(seed,100).unwrap();
    let mut context=cx(None);context.viewer="dev:alice".into();
    let a=e.query("bare",context.clone()).unwrap();let b=e.query("decorated",context).unwrap();
    assert_eq!((&a.next,a.complete,&a.cut),(&b.next,b.complete,&b.cut));
    assert_eq!(a.data.as_array().unwrap().len(),20);
    assert_eq!(b.metered.examined-a.metered.examined,21);
    println!("W13 scale 1000 rooms/30030 messages: bare={:?} decorated={:?}; distinct=21",a.metered,b.metered);
}

#[test]
fn word_expansion_and_device_word_cut_are_owned_by_the_bare_page() {
    let mut e=fixture_words(1,true);
    for (bare,decorated) in [("bare","decorated"),("pinnedBare","pinned")] {
        let mut context=cx(None);if bare=="pinnedBare" {context.args.insert("room".into(),Value::Id("r0".into()));}
        let a=e.query(bare,context.clone()).unwrap();let b=e.query(decorated,context).unwrap();
        assert!(a.complete, "uniform server expansion remains complete");
        assert_eq!((&a.next,a.complete,&a.cut),(&b.next,b.complete,&b.cut));
        assert_eq!(a.data.as_array().unwrap().iter().map(|v|v.field("id").unwrap()).collect::<Vec<_>>(),b.data.as_array().unwrap().iter().map(|v|v.field("id").unwrap()).collect::<Vec<_>>());
    }
}

#[test]
fn device_word_cut_preserves_metadata_with_point_decorations() {
    let mut e=fixture_words(1,true);
    let schema=e.schema().clone();let bare=e.program("bare").unwrap().clone();let decorated=e.program("decorated").unwrap().clone();let ceilings=e.ceilings();
    let tx=e.store_mut().read_transaction().unwrap();
    let a=snapback4_core::engine::local::query(&tx,&schema,&bare,cx(None),ceilings).unwrap();
    let b=snapback4_core::engine::local::query(&tx,&schema,&decorated,cx(None),ceilings).unwrap();
    assert_eq!(a.cut,Some(snapback4_core::engine::ReadCut::Words));
    assert_eq!((&a.next,a.complete,&a.cut),(&b.next,b.complete,&b.cut));
    assert_eq!(a.data.as_array().unwrap().iter().map(|v|v.field("id").unwrap()).collect::<Vec<_>>(),b.data.as_array().unwrap().iter().map(|v|v.field("id").unwrap()).collect::<Vec<_>>());
}

#[test]
fn decoration_deadline_is_a_value_refresh_not_a_page_expiry() {
    let source = SOURCE.replace("  name: text", "  expires: time ?\n  expire at .expires\n  name: text");
    assert_ne!(source, SOURCE);
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let seed: Vec<(String,Value)> = [
        ("members", serde_json::json!({"id":"u","room":"r","principal":"alice"})),
        ("rooms", serde_json::json!({"id":"r","title":"Room"})),
        ("profiles", serde_json::json!({"id":"p","principal":"alice","name":"Alice","expires":200})),
        ("messages", serde_json::json!({"id":"m","room":"r","author":"alice","body":"coffee","at":1})),
    ].into_iter().map(|(table,row)| (table.into(),wire::row_from_json(&b.schema.tables[table],&row).unwrap())).collect();
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap(); e.seed_at(seed,100).unwrap();
    for now in [199,200,201] {
        let a=e.query("bare",cx(None).at(now)).unwrap();let b=e.query("decorated",cx(None).at(now)).unwrap();
        assert_eq!((a.complete,a.cut,a.next,a.next_expiry),(b.complete,b.cut,b.next,b.next_expiry));
        assert_eq!(b.next_expiry,None);
        assert_eq!(b.decoration_expiry,(now<200).then_some(200));
        let hit=&b.data.as_array().unwrap()[0];
        assert_eq!(hit.field("id").unwrap().as_str().unwrap(),"m");
        assert_eq!(hit.field("sender").unwrap(),&if now<200 {Value::String("Alice".into())} else {Value::Null});
    }
}

#[test]
fn unsafe_integer_order_keys_are_exact_in_selection_and_source_wire() {
    let source=SOURCE.replace("at: time", "at: int").replace("last 20", "last 1");
    let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let high=9_007_199_254_740_993_i64;
    let seed: Vec<(String,Value)>=[
        ("members",serde_json::json!({"id":"u","room":"r","principal":"alice"})),
        ("rooms",serde_json::json!({"id":"r","title":"Room"})),
        ("profiles",serde_json::json!({"id":"p","principal":"alice","name":"Alice"})),
        ("messages",serde_json::json!({"id":"a","room":"r","author":"alice","body":"coffee","at":high})),
    ].into_iter().map(|(t,r)| (t.into(),wire::row_from_json(&b.schema.tables[t],&r).unwrap())).collect();
    // Public writes remain restricted to signed 53-bit values. Exercise the
    // internal i64 protocol with a storage-level fixture, not a widened type.
    let schema=b.schema.clone();
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let tx=e.store_mut().transaction().unwrap();
    for (name,row) in seed { snapback4_core::Rows::put(&tx,&name,&schema.tables[&name],&row,None).unwrap(); }
    tx.commit().unwrap();
    let mut context=cx(None);context.search_retained_order=Some((vec![high-1],true));
    let out=e.query_search_at("decorated",context,Some(&["z".into()])).0.unwrap();
    assert_eq!(out.data.as_array().unwrap()[0].field("sender").unwrap().as_str().unwrap(),"Alice");
    assert_eq!(wire::to_json(&out.search_rows.unwrap())[0]["at"],high.to_string());
    let bare=e.query("bare",cx(None)).unwrap();
    assert_eq!(wire::to_json(&bare.search_rows.unwrap())[0]["at"],high.to_string());
    for key in [i64::MIN, -high, high, i64::MAX] {
        assert_eq!(snapback4_core::search_decoration::order_key(&serde_json::json!(key.to_string())),Some(key));
        assert_eq!(snapback4_core::search_decoration::order_key(&serde_json::json!(key)),None);
    }
}
