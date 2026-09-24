//! The published nested-attribution example, against an enumerated contribution oracle.
//! @ref LLP 3000.011.000.001#5 — deletion, missing targets and backfill are part of the example's policy.
use snapback4_core::{Context, Engine, Value, WriteState, wire};
use serde_json::json;

fn source() -> String {
    snapback4_lang::guide::quarry(snapback4_lang::guide::card("maintains").unwrap()).into_iter()
        .find(|s| s.contains("maintain originalLikesReceived:")).unwrap()
}
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty() && b.notes.is_empty(), "{:?} {:?}", b.diagnostics, b.notes); b
}
fn engine(source: &str) -> Engine {
    let b = bound(source); Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn text(s: &str) -> Value { Value::String(s.into()) }
fn write(e: &mut Engine, op: &str, viewer: &str, fresh: &str, args: &[(&str, Value)]) -> Value {
    let outcome = e.mutate(op, None, Context::new(viewer, args.iter().map(|(k,v)| (k.to_string(),v.clone())).collect()).at(10).with_ids([fresh.into()])).unwrap();
    match outcome.state { WriteState::Sent { result, .. } => result, other => panic!("{op}: {other:?}") }
}
fn seed(e: &mut Engine, table: &str, row: serde_json::Value) {
    let row = wire::row_from_json(e.schema().table(table).unwrap(), &row).unwrap();
    e.seed_at(vec![(table.into(), row)], 10).unwrap();
}
fn oracle(e: &mut Engine, likes: &[(&str, &str)], replies: &[(&str, &str)]) {
    for author in ["alice", "bob", "carol", "dana", "replacement"] {
        let expected = json!({"likes": likes.iter().filter(|(_,a)| *a == author).count(), "replies": replies.iter().filter(|(_,a)| *a == author).count()});
        let actual = e.query("received", Context::new("viewer", [("authorId".into(), id(author))].into()).at(20)).unwrap();
        assert!(actual.complete && actual.cut.is_none(), "{actual:?}");
        assert_eq!(wire::to_json(&actual.data), expected, "{author}");
    }
}

#[test]
fn nested_credit_follows_immediate_targets_and_surviving_contributions() {
    let mut e = engine(&source());
    write(&mut e,"original","alice","post",&[("body",text("Original"))]);
    for (name,author,target) in [("r1","bob",Value::Null),("r2","carol",id("r1")),("r3","dana",id("r2"))] {
        write(&mut e,"reply",author,name,&[("postId",id("post")),("replyTarget",target),("body",text(name))]);
    }
    write(&mut e,"likePost","fan","lp",&[("postId",id("post"))]);
    for (target,name) in [("r1","l1"),("r2","l2"),("r3","l3")] {
        write(&mut e,"likeReply","fan",name,&[("replyId",id(target))]);
        assert_eq!(write(&mut e,"likeReply","fan","unused",&[("replyId",id(target))]), Value::Null);
    }
    let mut likes = vec![("lp","alice"),("l1","bob"),("l2","carol"),("l3","dana")];
    let mut replies = vec![("r1","alice"),("r2","bob"),("r3","carol")];
    oracle(&mut e,&likes,&replies);
    let nulls = e.recorded_nulls().unwrap();
    assert_eq!(nulls.captures["replies"]["replyTarget.authorId"],1);
    assert_eq!(nulls.contributions["nestedRepliesReceived"],0,"a direct reply's nullable target is unselected");
    write(&mut e,"deleteReply","bob","none",&[("replyId",id("r1"))]);
    replies.retain(|(name,_)| *name != "r1");
    oracle(&mut e,&likes,&replies);
    let refused = e.mutate("likeReply",None,Context::new("late",[("replyId".into(),id("r1"))].into()).at(20)).unwrap();
    assert!(matches!(refused.state,WriteState::Failed { ref why,.. } if why.code == "REPLY_NOT_FOUND"));
    seed(&mut e,"replies",json!({"id":"r1","postId":"post","replyTarget":null,"authorId":"replacement","body":"new identity"}));
    replies.push(("r1-new","alice"));
    write(&mut e,"likeReply","newFan","l-new",&[("replyId",id("r1"))]);
    likes.push(("l-new","replacement"));
    oracle(&mut e,&likes,&replies);
    write(&mut e,"unlikeReply","fan","none",&[("replyId",id("r1"))]);
    likes.retain(|(name,_)| *name != "l1");
    write(&mut e,"deletePost","alice","none",&[("postId",id("post"))]);
    oracle(&mut e,&likes,&replies);
    seed(&mut e,"posts",json!({"id":"post","authorId":"replacement","body":"replacement original"}));
    oracle(&mut e,&likes,&replies);
    write(&mut e,"deleteReply","carol","none",&[("replyId",id("r2"))]);
    replies.retain(|(name,_)| *name != "r2");
    oracle(&mut e,&likes,&replies);
}

#[test]
fn explicit_reference_backfill_precedes_capture_and_doctor_distinguishes_missing_credit() {
    let source = source();
    let bare = source.split("maintain originalLikesReceived:").next().unwrap().replace("immutable postId, replyTarget, authorId", "immutable postId, authorId");
    let mut e = engine(&format!("{bare}\njob repair(target: replies):\n  chunk r in replies first 10 by byId:\n    if r.id = 'nested':\n      update replies[id = r.id] {{ replyTarget: target }}\n"));
    seed(&mut e,"posts",json!({"id":"post","authorId":"alice","body":"original"}));
    for (name,author,target) in [("direct","bob",None),("nested","carol",None),("missing","dana",Some("absent"))] {
        seed(&mut e,"replies",json!({"id":name,"postId":"post","replyTarget":target,"authorId":author,"body":"legacy"}));
    }
    let run = e.run_job("repair",[("target".into(),id("direct"))].into(),20).unwrap();
    assert_eq!(run.state,snapback4_core::JobState::Done);
    let b = bound(&source); e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    oracle(&mut e,&[],&[("direct","alice"),("nested","bob")]);
    let nulls = e.recorded_nulls().unwrap();
    assert_eq!(nulls.captures["replies"]["replyTarget.authorId"],2);
    assert_eq!(nulls.contributions["nestedRepliesReceived"],1);
    seed(&mut e,"replies",json!({"id":"absent","postId":"post","replyTarget":null,"authorId":"replacement","body":"too late"}));
    oracle(&mut e,&[],&[("direct","alice"),("nested","bob"),("late-target","alice")]);
    assert_eq!(e.recorded_nulls().unwrap().contributions["nestedRepliesReceived"],1,"creating a target does not backfill captured nulls");
    let b = bound(&source.replace("where .replyTarget != null by", "where .replyTarget != null and true by"));
    e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    oracle(&mut e,&[],&[("direct","alice"),("nested","bob"),("late-target","alice")]);
}
