//! The widest Clique parent (4,000 Unicode characters), at the source-attempt
//! ceiling, with distinct old/new parents so event coalescing saves no bytes.
use snapback4_core::{Context, Engine, Value, WriteState, value::object};
#[path = "../src/sync_wire.rs"]
#[allow(dead_code)]
mod sync_wire;
#[path = "../src/column_cost.rs"]
#[allow(dead_code)]
mod cost;

#[test]
fn largest_composed_column_commit_at_the_row_ceiling_fits_and_next_attempt_rolls_back() {
    let mut source = String::from("table posts:\n  body: text <=4000\n  likeCount: count likes by postId\n  public\n  sync public\ntable likes:\n  postId: posts\n  public\n  update <- allow\n  sync public\nmutation largest():\n");
    for n in 0..204 { source.push_str(&format!("  update likes['l{n}'] {{ postId: 'q{n}' }}\n")); }
    source.push_str("mutation overflow():\n");
    for n in 0..205 { source.push_str(&format!("  update likes['l{n}'] {{ postId: 'p{n}' }}\n")); }
    let bound = snapback4_lang::compile(&[("schema.q".into(),source)]);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let mut engine=Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    let mut rows=Vec::new();
    for n in 0..205 {
        for prefix in ["p","q"] {
            rows.push(("posts".into(),object([("id",Value::Id(format!("{prefix}{n}"))),("body",Value::String("\u{1f600}".repeat(4000)))])));
        }
        rows.push(("likes".into(),object([("id",Value::Id(format!("l{n}"))),("postId",Value::Id(format!("p{n}")))])));
    }
    engine.seed(rows).unwrap();
    let from=engine.seq().unwrap();
    let result=engine.mutate("largest",None,Context::new("alice",Default::default()).at(1000)).unwrap();
    assert!(matches!(result.state,WriteState::Sent {..}),"{result:?}");
    assert_eq!(result.metered.rows_written,1020);
    let page=engine.stream("alice",from,1).unwrap();
    let parents:Vec<_>=page.events.iter().filter(|e|e.table=="posts").collect();
    assert_eq!(parents.len(),408);
    assert_eq!(page.events.len(),612);
    let derived:usize=parents.iter().map(|e|serde_json::to_vec(&sync_wire::SyncEvent {
        data:e.data.as_ref().map(snapback4_core::wire::Plain),id:&e.id,kind:&e.kind,seq:Some(e.seq),table:&e.table,
    }).unwrap().len()+1).sum();
    let derived_bound=408*cost::event_bytes("posts",&engine.schema().tables["posts"]).unwrap();
    assert!(derived as u64<=derived_bound,"{derived} > {derived_bound}");
    assert!(derived as u64*100>derived_bound*95,"exercise near-maximal schema images");
    let reply=sync_wire::StreamReply {acquisitions:page.acquisitions,acknowledged:Default::default(),committed_above:Default::default(),
        images_at:page.images_at,events:sync_wire::SyncEvents::Stream(page.events),generation:engine.generation(),joined:page.joined,
        more:page.more,snapshot:false,store_id:engine.store().meta("store_id").unwrap().unwrap(),watermark:page.watermark};
    let bytes=serde_json::to_vec(&reply).unwrap().len();
    assert!(bytes<16<<20,"{bytes}");
    println!("largest column commit: 204 source moves + 408 parent images; derived={derived} B, derived bound={derived_bound} B, composed={bytes} B, margin={} B",(16<<20)-bytes);
    let before=engine.store().rows("posts").unwrap();
    let seq=engine.seq().unwrap();
    let result=engine.mutate("overflow",None,Context::new("alice",Default::default()).at(1000)).unwrap();
    assert!(matches!(&result.state,WriteState::Failed {why,..} if why.code=="E_BOUND"),"{result:?}");
    assert_eq!(engine.store().rows("posts").unwrap(),before);
    assert_eq!(engine.seq().unwrap(),seq);
}
