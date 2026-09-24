//! Regression promoted from the saved round-1 late-follow counterexample.
use snapback4_core::{Context, Engine, Value, WriteState};

#[test]
fn late_follow_can_receive_only_the_history_window_from_pending_deliveries() {
    let source = include_str!("fixtures/timeline-v2.q");
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    for n in 0..1100 {
        let out = e.mutate("post", None, Context::new("a", [
            ("postId".into(), Value::Id(format!("p{n:04}"))), ("parentId".into(), Value::Null),
        ].into()).at(n + 1)).unwrap();
        assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
    }
    let out = e.mutate("follow", None, Context::new("reader", [("actor".into(), Value::Id("a".into()))].into()).at(1200)).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
    let mut chunks = 0;
    while e.run_timeline_chunk(5000).unwrap().is_some() { chunks += 1; assert!(chunks < 2000); }
    let events = e.store().rows("feedFeed").unwrap().into_iter()
        .filter(|r|r.field("readerId").unwrap() == &Value::Id("reader".into()))
        .map(|r|r.field("eventId").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>();
    println!("REGRESSION pending_events_before_follow=1100 backfill_window=1000 reader_copies_after_drain={}", events.len());
    assert_eq!(events.len(), 1000);
    assert_eq!(events.into_iter().collect::<std::collections::BTreeSet<_>>(), (100..1100).map(|n|format!("p{n:04}")).collect());
    assert_eq!(e.timeline_work_counts().unwrap(), [("feed".into(), 0, 0)]);
}
