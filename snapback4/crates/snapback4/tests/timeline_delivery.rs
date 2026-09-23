//! Derived-only bounds and actual encoded recipient pages (RFC revision 7).
#[path = "timeline/common.rs"]
#[allow(dead_code)]
mod fixture;
#[path = "../src/timeline_cost.rs"]
#[allow(dead_code)]
mod cost;
use fixture::id;
use snapback4_core::{Engine, Value, WriteState};
use serde_json::json;
const CEILING: usize = 16_777_216;

fn mutate(e: &mut Engine, op: &str, viewer: &str, args: &[(&str,Value)], now: i64) -> u64 {
    let out=e.mutate(op,None,snapback4_core::Context::new(viewer,args.iter().map(|(k,v)|(k.to_string(),v.clone())).collect()).at(now)).unwrap();
    assert!(matches!(out.state,WriteState::Sent{..}),"{op}: {out:?}");
    out.metered.rows_written
}

#[test]
fn largest_derived_contribution_is_maximum_backfill_promotion_with_margin() {
    let mut e=fixture::engine(true);
    let t=e.schema().timelines[0].clone();
    let bounds=cost::stream_bounds(e.schema(),&t).unwrap();
    let (name,bound)=bounds.iter().max_by_key(|(_,bytes)|bytes).unwrap();
    assert_eq!(*name,"maximum-backfill promotion");
    assert!(*bound+512<CEILING,"derived contribution plus reply framing must fit");
    for (op,bytes) in &bounds {println!("DERIVED_BOUND {op}: bytes={bytes} ceiling={CEILING} margin={}",CEILING-bytes);}
    // Longest admitted declaration names are bounded by index labels. Even a
    // MAX_INDEX_LABEL_BYTES-byte name (wider than admission allows) retains headroom.
    let mut wide=fixture::compile(&format!("{}{}",fixture::APP,fixture::DECLARATION)).schema;
    let mut long=t.clone();long.name="f".repeat(snapback4_core::rows::MAX_INDEX_LABEL_BYTES);
    for suffix in snapback4_core::schema::timeline::OWNED_SUFFIXES {
        let row=wide.tables[&t.table(suffix)].clone();wide.tables.insert(long.table(suffix),row);
    }
    let long_bounds=cost::stream_bounds(&wide,&long).unwrap();
    assert!(long_bounds.iter().all(|(_,bytes)|bytes+512<CEILING));
    println!("DERIVED_BOUND long-name promotion={} margin={}",long_bounds[5].1,CEILING-long_bounds[5].1);
    let author="a".repeat(135);let reader="r".repeat(135);
    let followers:Vec<_>=(0..50).map(|n|format!("{}f{n:03}","x".repeat(131))).collect();
    for who in [&author,&reader].into_iter().chain(followers.iter()) {mutate(&mut e,"register",who,&[],1);}
    for n in 0..1000 {mutate(&mut e,"publish",&author,&[("postId",id(&format!("{}p{n:04}","p".repeat(130))))],n+2);}
    for who in &followers {mutate(&mut e,"follow",who,&[("authorId",id(&author))],1100);}
    let from=e.seq().unwrap();
    assert_eq!(mutate(&mut e,"follow",&reader,&[("authorId",id(&author))],1200),1023);
    for (class,who) in [("triggering reader",&reader),("author",&author),("existing follower",&followers[0]),("public only",&"outsider".into())] {
        let p=e.stream(who,from,1).unwrap();
        let events:Vec<_>=p.events.iter().map(|ev|json!({"data":ev.data.as_ref().map(snapback4_core::wire::to_json),"id":ev.id,"kind":ev.kind,"seq":ev.seq,"table":ev.table})).collect();
        let derived:usize=p.events.iter().zip(&events).filter(|(ev,_)|t.owns(&ev.table)).map(|(_,ev)|serde_json::to_vec(ev).unwrap().len()+1).sum();
        assert!(derived<=*bound,"{class}: derived={derived}, bound={bound}");
        let bytes=serde_json::to_vec(&json!({"acknowledged":{},"events":events,"generation":e.generation(),"images_at":p.images_at,"joined":p.joined,"more":p.more,"snapshot":false,"store_id":e.store().meta("store_id").unwrap().unwrap(),"watermark":p.watermark})).unwrap().len();
        assert!(bytes<CEILING);
        println!("PROMOTION partition={class} actual_reply={bytes} derived={derived} ceiling={CEILING} margin={}",CEILING-bytes);
    }
}
