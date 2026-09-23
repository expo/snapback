//! Preserved historical-image counterexample. The positive SDK recovery
//! regression lives in packages/snapback4/test/timeline-delivery.test.mjs.
use snapback4_core::{Context, Engine, Value, WriteState, MutationOutcome};
use serde_json::json;
const CEILING: usize = 16 << 20;
fn engine() -> Engine {
    let b=snapback4_lang::compile(&[("schema.q".into(),include_str!("../../../experiments/f3b-deliverability/schema.q").into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap()
}
fn sent(out:MutationOutcome) { assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}"); }
fn encoded(e:&mut Engine,who:&str,from:u64)->usize {
    let p=e.stream(who,from,1).unwrap();
    // Exact serve::StreamReply fields with no request acknowledgements. Byte
    // lengths use plain wire values, not tagged storage or estimated row widths.
    serde_json::to_vec(&json!({"acknowledged":{},"events":p.events.iter().map(|ev|json!({"data":ev.data.as_ref().map(snapback4_core::wire::to_json),"id":ev.id,"kind":ev.kind,"seq":ev.seq,"table":ev.table})).collect::<Vec<_>>(),"generation":e.generation(),"images_at":p.images_at,"joined":p.joined,"more":p.more,"snapshot":false,"store_id":e.store().meta("store_id").unwrap().unwrap(),"watermark":p.watermark})).unwrap().len()
}
#[test]
#[ignore = "historical-image byte measurement; SDK recovery is covered by the package regression"]
fn historical_commit_uses_later_images() {
    let mut e=engine();sent(e.mutate("register",None,Context::new("author",Default::default()).at(100)).unwrap());
    let before=e.seq().unwrap();
    let out=e.mutate("publish",None,Context::new("author",Default::default()).at(100)).unwrap();
    assert_eq!(out.metered.rows_written,1024);
    sent(out);
    let first=[encoded(&mut e,"reader",before),encoded(&mut e,"author",before)];
    assert!(first.iter().all(|bytes| *bytes<CEILING));
    let notes=e.store().rows("notes").unwrap();
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
        println!("HISTORICAL partition={who} original_commit_bytes={first} largest_later_commit_bytes={largest_update} original_commit_after_updates_bytes={later} ceiling={CEILING} excess={}",later-CEILING);
        assert!(later>CEILING,"the old commit was not bounded by its insertion images");
    }
    assert!(largest_update<CEILING);
}
