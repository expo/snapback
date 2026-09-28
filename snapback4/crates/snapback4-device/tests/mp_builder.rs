mod common;
use common::*;
use snapback4_device::{device::Device, memory::MemoryStore};
use serde_json::json;

#[test]
fn builder_ordinary_own_state_before_and_after_owner_coverage() {
    let source = include_str!("../../../experiments/p19-one-query/builder.q")
        .replace("ownLikes[viewer, post] > 0", "exists likes[post, viewer]")
        .replace("ownReposts[viewer, post] > 0", "exists reposts[viewer, post]");
    for enabled in [false, true] {
        let source = if enabled { source.replace("sync public last 2000 by .at", "sync public last 2000 by .at with own keys .principal").replace("sync public last 1000 by .at\n\ntable follows:", "sync public last 1000 by .at with own keys .actor\n\ntable follows:") } else { source.clone() };
        let (mut e, b) = compile(&source);
        let mut d = Device::open_store(MemoryStore::new(), Some(b)).unwrap();
        for (n, p) in snapshot_pages(&mut e, "alice", 100).iter().enumerate() { d.apply(p, n == 0).unwrap(); }
        let (q, unknown, _) = d.query_with_coverage("postState", "alice", &json!({"post":"missing"}), 100);
        let q = q.unwrap();
        println!("own keys={enabled}, unknown={unknown}, result={q:?}");
        assert_eq!(unknown, !enabled);
        if enabled { assert!(q.complete); assert_eq!(snapback4_core::wire::to_json(&q.data), json!({"liked":false,"reposted":false})); }
    }
}

const BUILDER: &str = include_str!("../../snapback4-lang/tests/fixtures/mp/builder.q");
fn load(e: &mut snapback4_core::Engine, table: &str, value: serde_json::Value) {
    let row = snapback4_core::wire::row_from_json(&e.schema().tables[table], &value).unwrap();
    e.seed(vec![(table.into(), row)]).unwrap();
}
fn rewritten_offline<H: Host>(host: &mut H) {
    let (mut e,b) = compile(BUILDER);
    let publish = |e: &mut snapback4_core::Engine| {
        let out=e.mutate("publish",None,context("alice",&[("id",id("old")),("text",snapback4_core::Value::String("hello".into()))]).at(0)).unwrap();
        assert!(matches!(out.state,snapback4_core::WriteState::Sent{..}),"{out:?}");
    };
    publish(&mut e);
    // Push the viewer's interactions outside both public windows, using the
    // builder's own operations so timeline custody is exercised too.
    for n in 0..2002 {
        let viewer=if n==0 {"alice".into()} else {format!("other{n}")};
        for op in ["setLike","setRepost"] {
            let out=e.mutate(op,None,context(&viewer,&[("post",id("old")),("active",snapback4_core::Value::Bool(true))]).at(n)).unwrap();
            assert!(matches!(out.state,snapback4_core::WriteState::Sent{..}),"{out:?}");
        }
    }
    let mut d=host.open("own",Some(b)).unwrap();
    for (n,p) in snapshot_pages(&mut e,"alice",500).iter().enumerate() { d.apply(p,n==0).unwrap(); }
    assert!(!d.store().raw_rows("likes").iter().any(|r|r.field("principal").unwrap()==&id("alice")));
    assert!(!d.store().raw_rows("reposts").iter().any(|r|r.field("actor").unwrap()==&id("alice")));
    host.close("own",d);
    let mut d=host.open("own",None).unwrap();
    for (post,expected) in [("old",true),("never",false)] {
        let (q,unknown,_) = d.query_with_coverage("postState","alice",&json!({"post":post}),10000);
        let q=q.unwrap(); assert!(!unknown,"{}: {q:?}",host.label()); assert!(q.complete);
        assert_eq!(snapback4_core::wire::to_json(&q.data),json!({"liked":expected,"reposted":expected}));
    }
}
#[test] fn rewritten_builder_own_state_memory_reopen() { rewritten_offline(&mut Memory::new()); }
#[test] fn rewritten_builder_own_state_sqlite_reopen() { rewritten_offline(&mut Sqlite::new("mp-own")); }

const TOTALS: &str = "table messages:\n  owner: principal\n  deadline: time\n  immutable owner, deadline\n  read <- .owner = viewer\n  expire at .deadline\n  sync to .owner\ntable reactions:\n  message: messages\n  emoji: text <=20\n  cap 50 by message\n  immutable message\n  read through .message\n  sync\nview totals: count reactions by .message, .emoji\nquery totalsFor(message: messages):\n  return totals[message = message] by .emoji\n";
fn parent_totals<H: Host>(host: &mut H) {
    for horizon in [false,true] {
        let source=if horizon {TOTALS.replace("  sync\n","  sync last 1 by .id\n")} else {TOTALS.into()};
        let (mut e,b)=compile(&source);
        let now=snapback4_core::now_ms();
        load(&mut e,"messages",json!({"id":"m","owner":"alice","deadline":now+10000}));
        load(&mut e,"reactions",json!({"id":"r1","message":"m","emoji":"heart"}));
        load(&mut e,"reactions",json!({"id":"r2","message":"m","emoji":"laugh"}));
        let mut d=host.open(if horizon {"window"} else {"full"},Some(b)).unwrap();
        let (_,unknown,_) = d.query_with_coverage("totalsFor","alice",&json!({"message":"m"}),now);
        assert!(unknown);
        for (n,p) in snapshot_pages(&mut e,"alice",100).iter().enumerate() {d.apply(p,n==0).unwrap();}
        let (q,unknown,_) = d.query_with_coverage("totalsFor","alice",&json!({"message":"m"}),now);
        let q=q.unwrap();
        // The server owns the aggregate group-key index. A scalar keyed total
        // can recount held children; enumerating these keys needs fallback.
        assert!(unknown && !q.complete,"{} {q:?}",host.label());
        let server=e.query("totalsFor",context("alice",&[("message",id("m"))]).at(now)).unwrap();
        assert!(server.complete); assert_eq!(server.data.as_array().unwrap().len(),2);
        assert_eq!(server.next_expiry,Some(now+10000));
        let expired=e.query("totalsFor",context("alice",&[("message",id("m"))]).at(now+10001)).unwrap();
        assert!(expired.complete); assert_eq!(expired.data.as_array().unwrap().len(),0);

    }
}
#[test] fn parent_totals_memory_coverage_and_expiry() {parent_totals(&mut Memory::new());}
#[test] fn parent_totals_sqlite_coverage_and_expiry() {parent_totals(&mut Sqlite::new("mp-totals"));}
