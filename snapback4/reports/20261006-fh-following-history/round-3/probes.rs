#![cfg(test)]
use snapback4_core::{Engine, Context, Ceilings, Value};
use snapback4_core::engine::following_history::{Reader, Response};
use std::collections::BTreeMap;

const SOURCE: &str = include_str!("/home/ccheever/sb4-intent/review-fh-r1-astra/snapback4/crates/snapback4-lang/tests/fixtures/following-view.q");
fn engine() -> Engine {
    let b = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    for n in 0..8 {
        let out = e.mutate("post", None, Context::new("reader",BTreeMap::from([
            ("postId".into(),Value::Id(format!("p{n}{}", "x".repeat(120)))),
            ("parentId".into(),Value::Null)
        ])).at(n)).unwrap();
        assert!(matches!(out.state,snapback4_core::WriteState::Sent{..}),"{out:?}");
    }
    e
}
fn ctx() -> Context { Context::new("reader",BTreeMap::new()).at(1000) }

#[test]
fn shrink_output_between_preparation_and_publication() {
    let mut e = engine();
    e.set_ceilings(Ceilings { examined: 50, ..Default::default() });
    let mut r = Reader::new().unwrap();
    let mut q = r.opening("reader","feed",4,1000,Ceilings::default()).unwrap().request;
    let first = r.request(&mut e,q.clone(),ctx()).unwrap();
    println!("first={} meters={:?}",first.answer.bytes(),first.metered);
    assert!(matches!(first.answer.response,Response::Preparing{..}));
    q.token = first.answer.response.next().map(str::to_owned);
    let retained = r.accounted_bytes();
    e.set_ceilings(Ceilings { output_bytes: 1024, ..Default::default() });
    let attempt = std::panic::catch_unwind(std::panic::AssertUnwindSafe(||r.request(&mut e,q.clone(),ctx())));
    assert_eq!(r.accounted_bytes(),retained,"refusal changed session");
    match attempt {
        Ok(Ok(out)) => println!("resume={} meters={:?}",out.answer.bytes(),out.metered),
        Ok(Err(err)) => panic!("expected named refusal, got {err}"),
        Err(_) => {
            e.set_ceilings(Ceilings::default());
            let recovery=r.request(&mut e,q,ctx()).unwrap();
            assert!(matches!(recovery.answer.response,Response::Page{..}));
            println!("same token recovers after restoring allowance: {}", recovery.answer.bytes());
            panic!("publication panicked after request output allowance shrank");
        },
    }
}

#[test]
fn post_bound_follow_additions_use_stalled() {
    let mut e=engine();
    let follow=|e:&mut Engine,actor:String| {
        let out=e.mutate("follow",None,Context::new("reader",BTreeMap::from([
            ("actor".into(),Value::Id(actor))
        ])).at(1000)).unwrap();
        assert!(matches!(out.state,snapback4_core::WriteState::Sent{..}),"{out:?}");
    };
    for n in 0..8 { follow(&mut e,format!("a{n}")); }
    let mut r=Reader::new().unwrap();
    let mut q=r.opening("reader","feed",1,1000,Ceilings::default()).unwrap().request;
    let mut stalled=0;
    for wave in 0..8 {
        e.set_ceilings(Ceilings{examined:20,..Default::default()});
        let out=r.request(&mut e,q.clone(),ctx()).unwrap();
        println!("follow churn wave {wave}: {}",out.answer.bytes());
        assert!(matches!(out.answer.response,Response::Preparing{..}|Response::Stalled{..}));
        stalled+=usize::from(matches!(out.answer.response,Response::Stalled{..}));
        q.token=out.answer.response.next().map(str::to_owned);
        e.set_ceilings(Ceilings::default());
        for n in 0..30 { follow(&mut e,format!("z{wave:02}-{n:02}")); }
    }
    let mut ids=Vec::new();
    for _ in 0..20 {
        let out=r.request(&mut e,q.clone(),ctx()).unwrap();
        match &out.answer.response {
            Response::Page{items,next}=>{
                ids.extend(items.iter().map(|i|i.id().to_owned()));
                if next.is_none(){break;}
            }
            Response::Preparing{..}|Response::Stalled{..}=>{},
            other=>panic!("unexpected {other:?}"),
        }
        q.token=out.answer.response.next().map(str::to_owned);
    }
    assert_eq!(ids.len(),8,"frozen own history did not finish after churn stopped");
    println!("after follow additions stopped, all 8 frozen events completed; stalled count={stalled}");
    assert!(stalled>0,"post-B follow obstruction never reported stalled");
}
