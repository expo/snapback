use super::common::*;
use snapback4_core::{Value, WriteState};

#[test]
fn clique_trace_posts_reposts_removals_refollow_purge_and_profiles() {
    let mut p = Pair::new();
    for who in ["author","reader","third"] { p.register(who); }
    p.follow("reader","author");
    p.equal();
    p.follow("reader","author");
    for n in 0..25 { p.publish("author", &format!("p{n:03}")); }
    p.sent("repost","reader",&[("postId",id("p000"))]);
    p.sent("repost","reader",&[("postId",id("p000"))]);
    p.sent("repost","author",&[("postId",id("p001"))]);
    p.sent("unrepost","author",&[("postId",id("p001"))]);
    p.sent("repost","author",&[("postId",id("p001"))]);
    p.equal();
    assert_eq!(p.pages("reader","following").len(),27);
    p.pages("reader","cards");
    p.sent("remove","author",&[("postId",id("p000"))]);
    p.sent("remove","author",&[("postId",id("p000"))]);
    let failed = p.step("repost","third",&[("postId",id("p000"))]);
    assert!(matches!(&failed[0].state, WriteState::Failed {why,..} if why.code == "FEED_POST_NOT_FOUND"));
    p.equal();
    assert_eq!(p.pages("reader","following").len(),26);
    p.sent("unrepost","reader",&[("postId",id("p000"))]);
    p.sent("unrepost","reader",&[("postId",id("p000"))]);
    p.sent("refollow","reader",&[("authorId",id("author"))]);
    p.equal();
    assert_eq!(p.pages("reader","following").len(),25);
    for e in [&mut p.recipe,&mut p.declared] {
        let name = e.schema().schedules.iter().find(|s| s.target.ends_with("PurgeRemoved")).unwrap().target.clone();
        let run = e.run_job(&name,Default::default(),10000).unwrap();
        assert!(matches!(run.state,snapback4_core::JobState::Done),"{run:?}");
    }
    p.equal();
    assert!(rows(&p.declared,"feedRemovedEvents").is_empty());
    p.sent("deleteProfile","author",&[]);
    p.equal();
    assert_eq!(rows(&p.declared,"feedAuthors").len(),3);
    p.register("author");
    p.equal();
    p.pages("reader","following");
}

#[test]
fn backfill_visits_900_pushed_then_100_shared_and_keeps_765() {
    let mut p = Pair::new();
    p.register("author"); p.register("late");
    for n in 0..51 { p.register(&format!("f{n}")); }
    for n in 0..900 { p.publish("author",&format!("p{n:04}")); }
    for n in 0..51 { p.follow(&format!("f{n}"),"author"); }
    for n in 900..1000 { p.publish("author",&format!("p{n:04}")); }
    p.follow("late","author");
    let full = p.step("publish","author",&[("postId",id("overflow"))]);
    assert!(matches!(&full[0].state,WriteState::Failed{why,..} if why.code=="E_CONSTRAINT"));
    p.equal();
    let copies = rows(&p.declared,"feedFeed").into_iter().filter(|r| r.field("readerId").unwrap()==&id("late")).count();
    assert_eq!(copies,765);
    assert_eq!(p.pages("late","following").len(),865);
    p.sent("unfollow","late",&[("authorId",id("author"))]);
    p.follow("late","author");
    p.equal(); p.pages("late","following");
    // An established-head drain cut and an opening cut use the same merge.
    for examined in [3,25] {
        for e in [&mut p.recipe,&mut p.declared] {
            let mut ceilings = snapback4_core::Ceilings::default(); ceilings.examined=examined; e.set_ceilings(ceilings);
        }
        let a=p.recipe.query("following",context("late",&[],p.at)).unwrap();
        let b=p.declared.query("following",context("late",&[],p.at)).unwrap();
        assert_eq!((&a.data,a.complete,&a.next,&a.cut),(&b.data,b.complete,&b.next,&b.cut));
        assert!(!a.complete,"{a:?}");
    }
}

#[test]
fn pull_caps_refuse_atomically_and_promotion_is_permanent() {
    let mut p = Pair::new();
    for n in 0..51 { p.register(&format!("f{n}")); }
    for n in 0..33 { p.register(&format!("a{n}")); }
    p.register("trigger");
    for n in 0..32 {
        for f in 0..51 { p.follow(&format!("f{f}"),&format!("a{n}")); }
    }
    for f in 0..50 { p.follow(&format!("f{f}"),"a32"); }
    for (who,code) in [("f50","FEED_PULL_CAP"),("trigger","FEED_PROMOTION_PULL_CAP")] {
        let before = normalized(&p.declared);
        let out = p.step("follow",who,&[("authorId",id("a32"))]);
        assert!(matches!(&out[0].state,WriteState::Failed{why,..} if why.code==code),"{:?}",out[0]);
        assert_eq!(normalized(&p.declared),before); p.equal();
    }
    for f in 0..50 { p.sent("unfollow",&format!("f{f}"),&[("authorId",id("a0"))]); }
    p.follow("trigger","a32");
    // Drop below 51; future posts still broadcast and mode survives profile deletion.
    p.sent("unfollow","trigger",&[("authorId",id("a32"))]);
    p.sent("deleteProfile","a32",&[]); p.register("a32");
    p.publish("a32","shared-after-delete");
    p.equal();
    assert_eq!(rows(&p.declared,"feedBroadcast").len(),1);
    for n in 0..51 {p.register(&format!("g{n}"));p.follow(&format!("g{n}"),"f0");}
    let out=p.sent("publish","f0",&[("postId",id("saturated-own"))]);
    assert_eq!(out[1].metered.rows_written,4);
    assert_eq!(rows(&p.declared,"feedFeed").iter().filter(|r|r.field("readerId").unwrap()==&id("f0") && r.field("eventId").unwrap()==&id("saturated-own")).count(),1);
    p.equal();p.pages("f0","following");
    assert!(rows(&p.declared,"feedAuthors").iter().any(|r| r.field("principal").unwrap()==&id("a32") && r.field("shared").unwrap()==&Value::Bool(true)));
}

#[test]
fn missing_pull_count_in_trusted_history_refuses_like_recipe() {
    let mut p=Pair::new();
    p.register("author");
    for n in 0..51 {p.register(&format!("f{n}"));p.follow(&format!("f{n}"),"author");}
    for e in [&mut p.recipe,&mut p.declared] {
        let before=snapshot(e);
        let b=e.schema().clone();let programs=e.programs().cloned().collect::<Vec<_>>();
        let mut fresh=snapback4_core::Engine::memory(b,programs).unwrap();
        let images=before.into_iter().flat_map(|(t,rs)| {
            rs.into_iter().filter(|r| t!="feedPullCounts" || r.field("readerId").unwrap()!=&id("f0")).map(|r|(t.clone(),r)).collect::<Vec<_>>()
        });
        fresh.load_trusted(images).unwrap();
        *e=fresh;
    }
    let before=normalized(&p.declared);
    let out=p.step("unfollow","f0",&[("authorId",id("author"))]);
    assert!(matches!(&out[0].state,WriteState::Failed{why,..} if why.code=="FEED_PULL_COUNT_MISSING"));
    assert_eq!(normalized(&p.declared),before);p.equal();
}

#[test]
fn ordinary_follow_refusals_match_without_partial_edges() {
    let mut p=Pair::new();p.register("a");
    for (target,code) in [("a","FEED_CANNOT_FOLLOW_SELF"),("missing","FEED_APP_NOT_FOUND")] {
        let before=normalized(&p.declared);let out=p.step("follow","a",&[("authorId",id(target))]);
        assert!(matches!(&out[0].state,WriteState::Failed{why,..} if why.code==code),"{:?}",out[0]);
        assert_eq!(normalized(&p.declared),before);p.equal();
    }
}

#[test]
fn time_ties_page_by_event_id_and_tombstones_fill_the_page() {
    let mut p=Pair::new();p.register("a");p.register("r");p.follow("r","a");
    for n in 0..45 {p.sent("publishAt","a",&[("postId",id(&format!("tie{n:02}"))),("at",Value::Int(10))]);}
    let page=p.pages("r","following");assert_eq!(page[0].field("id").unwrap(),&id("tie44"));assert_eq!(page[44].field("id").unwrap(),&id("tie00"));
    for n in 20..45 {p.sent("remove","a",&[("postId",id(&format!("tie{n:02}")))]);}
    p.equal();let page=p.pages("r","following");assert_eq!(page.len(),20);assert_eq!(page[0].field("id").unwrap(),&id("tie19"));
}
