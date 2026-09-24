//! Materialized views retain the timeline contract under the planned syntax.
use snapback4_core::{Context, Engine, Value, WriteState};
use std::collections::BTreeMap;
const SOURCE: &str = include_str!("fixtures/following-view.q");
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:#?}", b.diagnostics); b
}
fn engine(source: &str) -> Engine { let b = bound(source); Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap() }
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn write(e: &mut Engine, op: &str, who: &str, args: &[(&str, Value)], at: i64) {
    let out = e.mutate(op, None, Context::new(who, args.iter().map(|(k,v)|(k.to_string(),v.clone())).collect()).at(at)).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{op}: {out:?}");
}
fn post(e: &mut Engine, name: &str, at: i64) { write(e, "post", "alice", &[("postId", id(name)), ("parentId", Value::Null)], at); }
fn drain(e: &mut Engine) { let mut chunks=0; while e.run_timeline_chunk(5000).unwrap().is_some() { chunks+=1; assert!(chunks<10000); } }
fn page(e: &mut Engine, op: &str, who: &str, c: Option<String>) -> snapback4_core::QueryOutcome {
    e.query(op, Context::new(who, BTreeMap::from([("c".into(), c.map(Value::String).unwrap_or(Value::Null))]))).unwrap()
}
#[test]
fn viewer_pages_map_event_fields_then_apply_shapes_and_keep_pending_completeness() {
    let mut e=engine(SOURCE);
    write(&mut e,"follow","bob",&[("actor",id("alice"))],1);
    for n in 0..65 { post(&mut e,&format!("p{n:03}"),n+2); }
    write(&mut e,"post","alice",&[("postId",id("reply")),("parentId",id("p000"))],100);
    assert_eq!(page(&mut e,"home","alice",None).data.as_array().unwrap().len(),20);
    assert!(page(&mut e,"home","bob",None).data.as_array().unwrap().is_empty());
    drain(&mut e);
    let mut cursor=None; let mut ids=Vec::new();
    loop {
        let p=page(&mut e,"cards","bob",cursor); assert!(p.complete);
        for row in p.data.as_array().unwrap() {
            assert_eq!(row.field("actor").unwrap(),&id("alice"));
            assert_eq!(row.field("post").unwrap().field("id").unwrap(),row.field("id").unwrap());
            assert_eq!(row.field("repost").unwrap(),&Value::Bool(false));
            ids.push(row.field("id").unwrap().as_str().unwrap().to_string());
        }
        cursor=p.next; if cursor.is_none(){break;}
    }
    assert_eq!(ids,(0..65).rev().map(|n|format!("p{n:03}")).collect::<Vec<_>>());
    let row=page(&mut e,"home","bob",None).data.as_array().unwrap()[0].clone();
    let Value::Row(fields)=row else{panic!("row")};
    assert_eq!(fields.keys().map(String::as_str).collect::<Vec<_>>(),["actor","at","id","post","repost"]);
    write(&mut e,"repost","bob",&[("postId",id("p000"))],101);
    let repost=page(&mut e,"home","bob",None).data.as_array().unwrap()[0].clone();
    assert_eq!(repost.field("repost").unwrap(),&Value::Bool(true));
    assert_ne!(repost.field("id").unwrap(),repost.field("post").unwrap());
    write(&mut e,"remove","alice",&[("postId",id("p064"))],102);
    assert_ne!(page(&mut e,"home","bob",None).data.as_array().unwrap()[1].field("id").unwrap(),&id("p064"));
    write(&mut e,"unfollow","bob",&[("actor",id("alice"))],103);
    assert_eq!(page(&mut e,"home","bob",None).data.as_array().unwrap().len(),1);
    write(&mut e,"follow","bob",&[("actor",id("alice"))],104);
    assert!(!page(&mut e,"home","bob",None).complete);
    drain(&mut e);assert!(page(&mut e,"home","bob",None).complete);
}
#[test]
fn recognition_uses_structure_including_renamed_projected_fields() {
    let source=SOURCE.replace("posts","entries").replace("reentries","boosts").replace("follows","links")
        .replace("authorId","writer").replace("actorId","booster").replace("followerId","reader").replace("followedId","creator")
        .replace("post: .","entry: .").replace("actor: .","who: .").replace(".actor", ".who").replace(".post]", ".entry]")
        .replace(" at, repost:"," clock: .at, boosted:").replace("by .at after", "by .clock after")
        .replace("activity","events").replace("view feed:","view inbox:").replace("return feed ","return inbox ");
    let b=bound(&source);assert_eq!(b.schema.timelines[0].posts[0],"entries");
    assert!(b.view_types.contains_key("inbox"));
    let mut e=engine(&source);post(&mut e,"p",1);
    let p=page(&mut e,"home","alice",None);
    assert_eq!(p.data.as_array().unwrap()[0].field("entry").unwrap(),&id("p"));
    assert_eq!(p.data.as_array().unwrap()[0].field("who").unwrap(),&id("alice"));
}
#[test]
fn removal_flag_is_optional_and_immutable_filters_still_apply() {
    let source=SOURCE.replace("  removed: bool default false\n","").replace(" and not .removed","")
        .replace("mutation remove(postId: posts):\n  update posts[postId] { removed: true }\n","");
    let mut e=engine(&source);assert!(e.schema().timelines[0].posts[3].is_empty());
    post(&mut e,"p",1);write(&mut e,"post","alice",&[("postId",id("reply")),("parentId",id("p"))],2);
    assert_eq!(page(&mut e,"home","alice",None).data.as_array().unwrap().len(),1);
}
#[test]
fn private_mutable_horizon_and_wrong_structures_refuse_at_the_declaration() {
    let cases=[
        (SOURCE.replace("public 'public posts and replies'", "read <- .authorId = viewer").replacen("sync public", "sync to .authorId", 1),"E_TIMELINE_SHAPE"),
        (SOURCE.replace("public 'public reposts'", "read <- deny"),"E_TIMELINE_SHAPE"),
        (SOURCE.replace("insert <- .authorId = viewer", "insert <- allow"),"E_TIMELINE_SHAPE"),
        (SOURCE.replace("immutable authorId, parentId, at", "immutable parentId, at"),"E_TIMELINE_SHAPE"),
        (SOURCE.replace("not .removed", ".removed = true"),"E_TIMELINE_FILTER"),
        (format!("{SOURCE}\nview feedFeed:\n  posts {{ at }}\n"),"E_TIMELINE_SHAPE"),
        (SOURCE.replace("public 'public edges'", "read <- .followerId = viewer").replace("  sync public\n\nview activity", "  sync to .followerId\n\nview activity"),"E_TIMELINE_SHAPE"),
        (SOURCE.replace("immutable authorId, parentId, at", "immutable authorId, at"),"E_TIMELINE_FILTER"),
        (SOURCE.replace("sync public", "sync public last 20 by .id"),"E_TIMELINE_SHAPE"),
        (SOURCE.replace("unique byPair: followerId, followedId", "by byPair: followerId, followedId"),"E_VIEW_FEED_SHAPE"),
        (SOURCE.replace("exists follows[viewer, .actor]", "exists follows[.actor, viewer]"),"E_VIEW_FEED_SHAPE"),
        (SOURCE.replace("post: .postId", "post: .id"),"E_VIEW_FEED_SHAPE"),
        (SOURCE.replace("reposts { post:", "reposts where .actorId = viewer { post:"),"E_VIEW_FEED_SHAPE"),
        (SOURCE.replace("view feed: activity", "view feed: posts"),"E_VIEW_FEED_SHAPE"),
    ];
    for (source,code) in cases { let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
        assert!(b.diagnostics.iter().any(|d| d.code==code && !d.rewrite.is_empty()),"{code}: {:?}",b.diagnostics);
    }
}

#[test]
fn branch_and_predicate_order_do_not_choose_the_strategy() {
    let a="  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }";
    let b="  reposts { post: .postId, actor: .actorId, at, repost: true }";
    let source=SOURCE.replace(&format!("{a}\n{b}"),&format!("{b}\n{a}"))
        .replace(".actor = viewer or exists follows[viewer, .actor]", "exists follows[viewer, .actor] or viewer = .actor");
    assert_eq!(bound(&source).schema.timelines,bound(SOURCE).schema.timelines);
}

#[test]
fn unsupported_feed_read_order_has_a_located_rewrite() {
    for replacement in ["first 20 by .at", "last 20"] {
        let b=snapback4_lang::compile(&[("schema.q".into(), SOURCE.replace("last 20 by .at", replacement))]);
        assert!(b.diagnostics.iter().any(|d|d.code=="E_TIMELINE_READ" && d.site.file=="schema.q" && d.rewrite=="feed last 20 by .at after c"), "{:?}", b.diagnostics);
    }
}
