//! Engine work shares the author's ordinary mutation ceiling.
#[path="timeline/common.rs"] #[allow(dead_code)] mod fixture;
use snapback4_core::{Context,Engine,WriteState};

#[test]
fn background_record_and_source_share_the_1024_write_ceiling() {
    let mut source=format!("{}{}",fixture::APP,fixture::DECLARATION);
    for extra in [1020,1021] { source.push_str(&format!("\nmutation publish{extra}():\n  for i in range(0, {extra}):\n    insert notes {{ owner: viewer }}\n  insert posts {{ id: 'p', authorId: viewer, at: now }}\n")); }
    let b=fixture::compile(&source);let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let before=fixture::snapshot(&e);
    let run=|e:&mut Engine,extra|e.mutate(&format!("publish{extra}"),None,Context::new("unregistered",Default::default()).at(1)).unwrap();
    let out=run(&mut e,1021);
    assert!(matches!(&out.state,WriteState::Failed{why,..} if why.code=="E_BOUND"),"{out:?}");
    assert_eq!(fixture::snapshot(&e),before,"source, own copy and queued work all roll back");
    let out=run(&mut e,1020);assert!(matches!(out.state,WriteState::Sent{..}));assert_eq!(out.metered.rows_written,1024);
    assert_eq!(fixture::rows(&e,"feedWork").len(),1);
    assert_eq!(fixture::rows(&e,"feedFeed").len(),1);
    assert!(fixture::rows(&e,"profiles").is_empty(),"posting needs no author registration");
}

#[test]
fn size_and_authors_are_ignored_compatibility_clauses() {
    let legacy=fixture::sized_bound(true,Some((1008,5921)));
    assert!(legacy.notes.iter().any(|n|n.code=="N_TIMELINE_COMPAT"));
    let source=format!("{}{}",fixture::APP,fixture::DECLARATION.replace("  authors profiles by principal\n", ""));
    let current=fixture::compile(&source);
    assert!(current.schema.timelines[0].same_declaration(&legacy.schema.timelines[0]));
    assert_eq!(current.schema.timelines[0].backfill(),50);
    assert!(current.schema.required_capabilities().contains("timeline-v2"));
}
