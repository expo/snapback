//! Preserved historical-image counterexample. The positive SDK recovery
//! regression lives in packages/snapback4/test/timeline-delivery.test.mjs.
use snapback4_core::{Context, Engine, Value, WriteState, MutationOutcome};
#[path = "../src/sync_wire.rs"]
#[allow(dead_code)]
mod sync_wire;
#[path = "timeline/delivery_wire.rs"]
mod delivery_wire;
const CEILING: usize = 16 << 20;
fn engine() -> Engine {
    let b=snapback4_lang::compile(&[("schema.q".into(),include_str!("../../../packages/snapback4/test/helpers/timeline-recovery.q").into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap()
}
fn sent(out:MutationOutcome) { assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}"); }
fn encoded(e:&mut Engine,who:&str,from:u64)->usize {
    let p=e.stream(who,from,1).unwrap();
    assert!(p.events.iter().all(|ev|ev.seq==from+1),"only the requested historical commit");
    if from==1 {
        assert_eq!(p.events.iter().filter(|ev|ev.table=="notes").count(),1020);
        assert!(p.events.iter().any(|ev|ev.table=="feedPosts"));
    }
    serde_json::to_vec(&delivery_wire::reply(e,p)).unwrap().len()
}
#[test]
fn historical_commit_uses_later_images() {
    let mut e=engine();sent(e.mutate("register",None,Context::new("author",Default::default()).at(100)).unwrap());
    let before=e.seq().unwrap();
    let out=e.mutate("publish",None,Context::new("author",Default::default()).at(100)).unwrap();
    assert_eq!(out.metered.rows_written,1024);
    sent(out);
    let first=[encoded(&mut e,"reader",before),encoded(&mut e,"author",before)];
    assert!(first.iter().all(|bytes| *bytes<CEILING));
    let notes=e.store().rows("notes").unwrap();
    assert_eq!(notes.len(),1020);
    let body=Value::String("\n".repeat(9000));
    let mut largest_update=0;
    for note in notes {
        let from=e.seq().unwrap();
        let args=[("noteId".into(),note.field("id").unwrap().clone()),("body".into(),body.clone())].into();
        let out=e.mutate("grow",None,Context::new("author",args).at(101)).unwrap();
        assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
        largest_update=largest_update.max(encoded(&mut e,"reader",from));
    }
    for (who,first) in ["reader","author"].into_iter().zip(first) {
        let later=encoded(&mut e,who,before);
        println!("HISTORICAL partition={who} original_commit_bytes={first} largest_later_commit_bytes={largest_update} original_commit_after_updates_bytes={later} ceiling={CEILING} excess={}",later.saturating_sub(CEILING));
        assert!(later>CEILING,"the old commit was not bounded by its insertion images");
    }
    assert!(largest_update<CEILING);
}
