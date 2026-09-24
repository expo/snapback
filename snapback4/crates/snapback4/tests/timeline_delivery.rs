#[path = "timeline/identity.rs"]
#[allow(dead_code)]
mod identity;
// Derived-only bounds and actual encoded recipient pages (RFC revision 7).
#[path = "timeline/common.rs"]
#[allow(dead_code)]
mod fixture;
#[path = "../src/timeline_cost.rs"]
#[allow(dead_code)]
mod cost;
use fixture::id;
use snapback4_core::{Engine, Value, WriteState};
#[path = "../src/sync_wire.rs"]
#[allow(dead_code)]
mod sync_wire;
#[path = "timeline/delivery_wire.rs"]
mod delivery_wire;
use snapback4_core::schema::timeline::{FOLLOW_BACKFILL, PUSH_FOLLOWERS};
const CEILING: usize = 16_777_216;

fn mutate(e: &mut Engine, op: &str, viewer: &str, args: &[(&str,Value)], now: i64) -> u64 {
    let out=e.mutate(op,None,snapback4_core::Context::new(viewer,args.iter().map(|(k,v)|(k.to_string(),v.clone())).collect()).at(now)).unwrap();
    assert!(matches!(out.state,WriteState::Sent{..}),"{op}: {out:?}");
    out.metered.rows_written
}

#[test]
fn follow_preview_and_delivery_have_bounded_bytes_and_private_partitions() {
    let mut e=fixture::engine(true);
    let t=e.schema().timelines[0].clone();
    let bounds=cost::stream_bounds(e.schema(),&t).unwrap();
    let (_,bound)=bounds.iter().find(|(name,_)|*name=="follow preview").unwrap();
    assert!(bounds.iter().all(|(_,bytes)|bytes+512<CEILING));
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
    let long_promotion=long_bounds.iter().find(|(name,_)|*name=="follow preview").unwrap().1;
    assert!(long_promotion>*bound);
    let author="a".repeat(135);let reader="r".repeat(135);
    let followers:Vec<_>=(0..PUSH_FOLLOWERS).map(|n|format!("{}f{n:03}","x".repeat(131))).collect();
    for who in [&author,&reader].into_iter().chain(followers.iter()) {mutate(&mut e,"register",who,&[],1);}
    for n in 0..1000 {mutate(&mut e,"publish",&author,&[("postId",id(&format!("{}p{n:04}","p".repeat(130))))],n+2);}
    for who in &followers {mutate(&mut e,"follow",who,&[("authorId",id(&author))],1100);}
    let from=e.seq().unwrap();
    assert_eq!(mutate(&mut e,"follow",&reader,&[("authorId",id(&author))],1200),53);
    for (class,who) in [("triggering reader",&reader),("author",&author),("existing follower",&followers[0]),("public only",&"outsider".into())] {
        let p=e.stream(who,from,1).unwrap();
        let seq=e.seq().unwrap();
        assert_eq!(p.watermark,seq); assert!(!p.more);
        assert!(p.events.iter().all(|ev|ev.seq==seq));
        let copies=p.events.iter().filter(|ev|ev.table==t.table("Feed")).collect::<Vec<_>>();
        assert_eq!(copies.len(),if class=="triggering reader" {FOLLOW_BACKFILL} else {0});
        for ev in &p.events {
            if matches!(ev.table.as_str(),"feedFeed"|"feedWork"|"feedEdges") {
                assert_ne!(class,"public only");
                assert_eq!(ev.data.as_ref().unwrap().field("readerId").unwrap(),&id(who));
            } else if class=="public only" {
                assert!(e.schema().tables[&ev.table].rules.read.is_uniformly_readable());
            }
        }
        assert_eq!(p.events.len(),match class {"triggering reader"=>FOLLOW_BACKFILL+3,"public only"=>1,_=>1});
        let derived:usize=p.events.iter().filter(|ev|t.owns(&ev.table)).map(|ev|serde_json::to_vec(&sync_wire::SyncEvent {
            data:ev.data.as_ref().map(snapback4_core::wire::Plain),id:&ev.id,kind:&ev.kind,seq:Some(ev.seq),table:&ev.table
        }).unwrap().len()+1).sum();
        assert!(derived<=*bound,"{class}: derived={derived}, bound={bound}");
        let bytes=serde_json::to_vec(&delivery_wire::reply(&e,p)).unwrap().len();
        let framing=bytes-derived;
        assert!(bytes<=*bound+framing && bytes<CEILING);
        println!("PROMOTION partition={class} actual_reply={bytes} derived={derived} ceiling={CEILING} margin={}",CEILING-bytes);
    }
}
