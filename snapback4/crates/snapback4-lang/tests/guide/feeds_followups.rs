//! Historical Global writes and the current published Trending read.
use super::{assert_stream_note, id, text, write};
use snapback4_core::{Context, Engine, Value, WriteState, wire};
use snapback4_lang::guide::{card, quarry};

fn engine(source: &str, synced: bool) -> Engine {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    if synced { assert_stream_note(&b); }
    else { assert!(b.diagnostics.is_empty() && b.notes.is_empty(), "{:?} {:?}",b.diagnostics,b.notes); }
    Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap()
}
fn page(e: &mut Engine, op: &str, now: i64, cursor: Value) -> snapback4_core::QueryOutcome {
    e.query(op,Context::new("reader",[("c".into(),cursor)].into()).at(now)).unwrap()
}
fn all(e: &mut Engine, op: &str, now: i64) -> Vec<Value> {
    let mut cursor = Value::Null;
    let mut rows = Vec::new();
    for _ in 0..100 {
        let read = page(e,op,now,cursor);
        assert!(read.complete && read.cut.is_none(), "{read:?}");
        rows.extend(read.data.as_array().unwrap().iter().cloned());
        match read.next { Some(next) => cursor = text(&next), None => return rows }
    }
    panic!("did not exhaust pages")
}

#[test]
fn published_global_filters_originals_and_preserves_independent_reposts() {
    let source = quarry(card("feeds").unwrap()).into_iter().find(|s| s.contains("query global(")).unwrap();
    let mut e = engine(&source, false);
    for (table, json) in [
        ("posts", serde_json::json!({"id":"shared","authorId":"author","at":10,"removed":false})),
        ("posts", serde_json::json!({"id":"removed","authorId":"author","at":20,"removed":true})),
        ("reposts", serde_json::json!({"id":"shared","actorId":"fan","postId":"removed","at":30})),
    ] {
        let row = wire::row_from_json(e.schema().table(table).unwrap(), &json).unwrap();
        e.seed_at(vec![(table.into(), row)], 100).unwrap();
    }
    let rows = all(&mut e, "global", 100);
    assert_eq!(rows.len(), 2, "only the live original and the independent repost belong to Global");
    for row in &rows { assert_eq!(row.field("id").unwrap(), &id("shared")); }
    assert_eq!(rows[0].field("post").unwrap(), &id("removed"));
    assert_eq!(rows[0].field("actor").unwrap(), &id("fan"));
    assert_eq!(rows[0].field("repost").unwrap(), &Value::Bool(true));
    assert_eq!(rows[0].field("card").unwrap().field("removed").unwrap(), &Value::Bool(true));
    assert_eq!(rows[1].field("post").unwrap(), &id("shared"));
    assert_eq!(rows[1].field("actor").unwrap(), &id("author"));
    assert_eq!(rows[1].field("repost").unwrap(), &Value::Bool(false));
    assert_eq!(rows[1].field("card").unwrap().field("removed").unwrap(), &Value::Bool(false));
}

#[test]
fn legacy_global_projection_retries_removal_and_rollback_are_atomic() {
    let source = quarry(include_str!("../fixtures/legacy-feed-recipes.md")).remove(1);
    let mut e = engine(&source,true);
    let mut clock = 0;
    for viewer in ["author","actor"] { write(&mut e,&mut clock,"register",viewer,&[("name",text(viewer))]); }
    let create = Context::new("author",[("body".into(),text("original"))].into()).at(3).with_ids(["post".into(),"global-original".into()]);
    let initial = e.mutate("post",Some("retry-post"),create.clone()).unwrap();
    assert!(matches!(initial.state,WriteState::Sent {..}),"{initial:?}");
    let retry = e.mutate("post",Some("retry-post"),create).unwrap();
    let WriteState::Sent { seq: first_seq,.. } = initial.state else { unreachable!() };
    assert!(matches!(retry.state,WriteState::Sent { seq,.. } if seq == first_seq),"{retry:?}");
    assert_eq!(e.store().rows("events").unwrap().len(),1);
    assert_eq!(e.store().rows("feedPosts").unwrap().len(),1);
    clock = 3;
    let repost = write(&mut e,&mut clock,"repost","actor",&[("postId",id("post"))]);
    assert_ne!(repost,Value::Null);
    let before = all(&mut e,"global",100);
    assert_eq!(before.len(),2);
    assert_ne!(before[0].field("id").unwrap(),before[1].field("id").unwrap());
    assert_eq!(before[0].field("repost").unwrap(),&Value::Bool(true));
    assert_eq!(before[0].field("actorId").unwrap(),&id("actor"));
    assert_eq!(write(&mut e,&mut clock,"repost","actor",&[("postId",id("post"))]),Value::Null);
    assert_eq!(all(&mut e,"global",100),before);
    write(&mut e,&mut clock,"setLike","actor",&[("postId",id("post")),("liked",Value::Bool(true))]);
    let rank = all(&mut e,"trending",100);
    assert_eq!(rank[0].field("score").unwrap(),&Value::Int(1));
    write(&mut e,&mut clock,"remove","author",&[("postId",id("post"))]);
    let after = all(&mut e,"global",100);
    assert_eq!(after.len(),1);
    assert_eq!(after[0].field("id").unwrap(),before[0].field("id").unwrap());
    assert_eq!(after[0].field("post").unwrap().field("removed").unwrap(),&Value::Bool(true));
    assert!(all(&mut e,"trending",100).is_empty());
    write(&mut e,&mut clock,"unrepost","actor",&[("postId",id("post"))]);
    assert!(all(&mut e,"global",100).is_empty());

    // The Global cap is deliberately smaller than the source/timeline caps.
    // A refusal after their writes must roll back all three representations.
    let capped = source.replace("  cap 60000\n  immutable postId, actorId", "  cap 1\n  immutable postId, actorId");
    assert_ne!(capped,source);
    let mut e = engine(&capped,true);
    write(&mut e,&mut clock,"register","author",&[("name",text("Author"))]);
    write(&mut e,&mut clock,"post","author",&[("body",text("one"))]);
    let before: Vec<_> = ["posts","events","feedPosts","feed"].into_iter().map(|t| (t,e.store().rows(t).unwrap())).collect();
    let refused = e.mutate("post",None,Context::new("author",[("body".into(),text("two"))].into()).at(clock+1)).unwrap();
    assert!(matches!(refused.state,WriteState::Failed { ref why,.. } if why.code == "E_CONSTRAINT"),"{refused:?}");
    for (table,rows) in before { assert_eq!(e.store().rows(table).unwrap(),rows, "{table}"); }
}

#[test]
fn every_rolling_rank_page_matches_sort_filter_oracle() {
    let source = quarry(card("feeds").unwrap()).into_iter().find(|s|s.contains("likeCount: count likes\n")).unwrap();
    let mut e = engine(&source,false);
    let now = 100 * 86_400_000 + 1_800_000;
    let mut expected = Vec::new();
    for n in 0..85 {
        let name = format!("p{n:03}");
        let at = match n { 0 => now - 86_400_000, 1 => now - 86_400_000 + 1, 2 => now, 3 => now + 1,
            _ => now - (n % 25) * 3_600_000 - (n % 3) };
        let count = n % 5;
        let post = wire::row_from_json(e.schema().table("posts").unwrap(),&serde_json::json!({"id":name,"authorId":"author","body":name,"at":at})).unwrap();
        e.seed_at(vec![("posts".into(),post)],now).unwrap();
        for like in 0..count {
            let row = wire::row_from_json(e.schema().table("likes").unwrap(),&serde_json::json!({"id":format!("l{n}-{like}"),"postId":name,"principal":format!("fan{like}")})).unwrap();
            e.seed_at(vec![("likes".into(),row)],now).unwrap();
        }
        expected.push((name,at,count,false,true));
    }
    let verify = |e: &mut Engine, expected: &[(String,i64,i64,bool,bool)], clock| {
        let mut oracle: Vec<_> = expected.iter().filter(|(_,at,_,removed,present)| *present && !removed && *at > clock-86_400_000 && *at <= clock).collect();
        oracle.sort_by(|a,b| (b.2,b.1,&b.0).cmp(&(a.2,a.1,&a.0)));
        let actual = all(e,"trending",clock);
        assert_eq!(actual.len(),oracle.len());
        for (row,expected) in actual.iter().zip(&oracle) {
            assert_eq!(row.field("id").unwrap().as_str().unwrap(),expected.0);
            assert_eq!(row.field("likeCount").unwrap(),&Value::Int(expected.2));
        }
        assert!(actual.iter().any(|r|r.field("likeCount") == Ok(&Value::Int(0))));
    };
    verify(&mut e,&expected,now);
    let mut clock = now;
    write(&mut e,&mut clock,"setLike","newFan",&[("postId",id("p010")),("liked",Value::Bool(true))]);
    expected[10].2 += 1;
    write(&mut e,&mut clock,"remove","author",&[("postId",id("p014"))]);
    expected[14].3 = true;
    e.seed_delete("posts","p024").unwrap();
    expected[24].4 = false;
    verify(&mut e,&expected,now);
    verify(&mut e,&expected,now+1);
    let b = snapback4_lang::compile(&[("schema.q".into(),source)]);
    let why = snapback4_lang::bind::residency::operation_lines("trending",&b.schema.operations["trending"]);
    assert!(why.contains("$intent:") && why.contains("hour"),"{why}");
    let read = page(&mut e,"trending",now,Value::Null);
    println!("rolling 25 lanes: first page examined={} entries={} steps={} heap={} complete={} cut={:?}",read.metered.examined,read.metered.index_entries,read.metered.steps,read.metered.heap_bytes,read.complete,read.cut);
}
