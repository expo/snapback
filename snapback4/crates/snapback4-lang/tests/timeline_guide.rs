//! The language card's timeline is part of its single executable program.
use snapback4_core::{Context,Engine,Value,WriteState};

#[test]
fn maintained_columns_refuse_timeline_parents_and_sources_in_the_binder() {
    let base = snapback4_lang::guide::language();
    for (source, role, table) in [
        (base.replace("table timelineCards:", "table timelineCards:\n  score: count votes by postId")
            + "\ntable votes:\n  postId: timelineCards\n  public\n  online only\n", "parent", "timelineCards"),
        (base.replace("table timelineCards:", "table timelineCards:\n  parentId: ordinaryParents ?")
            + "\ntable ordinaryParents:\n  score: count timelineCards by parentId\n  public\n  online only\n", "source", "timelineCards"),
        (base.replace("table timelineCards:", "table timelineCards:\n  score: count timelineFeed by postId"), "source", "timelineFeed"),
    ] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_MAINTAINED_COLUMN"
            && d.message.contains(&format!("timeline-governed {role} {table}"))
            && d.message.contains("ordinary parent and source tables")), "{:?}", bound.diagnostics);
    }
}
#[test]
fn language_timeline_registers_delivers_and_removes_without_helpers() {
    let b=snapback4_lang::compile(&[("schema.q".into(),snapback4_lang::guide::language())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(b.notes.is_empty(),"{:?}",b.notes);
    let names:Vec<_>=b.programs.iter().map(|p|p.program.name.as_str()).filter(|name|name.starts_with("timeline")).collect();
    assert_eq!(names,["timelineRegister","timelinePublish","timelineFollow","timelineRemove","timelineHome","timelinePurgeRemoved"]);
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    for (op,viewer,args,ids) in [
        ("timelineRegister","a",vec![],vec!["pa","ma"]),
        ("timelineRegister","b",vec![],vec!["pb","mb"]),
        ("timelinePublish","a",vec![],vec!["post","own"]),
        ("timelineFollow","b",vec![("authorId".into(),Value::Id("a".into()))],vec!["edge","copy"]),
    ] {
        let out=e.mutate(op,None,Context::new(viewer,args.into_iter().collect()).at(1).with_ids(ids.into_iter().map(str::to_owned))).unwrap();
        assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
    }
    let page=e.query("timelineHome",Context::new("b",Default::default()).at(2)).unwrap();
    assert!(page.complete);assert_eq!(page.data.as_array().unwrap().len(),1);
    assert_eq!(page.data.as_array().unwrap()[0].field("id").unwrap(),&Value::Id("post".into()));
    let out=e.mutate("timelineRemove",None,Context::new("a",[("postId".into(),Value::Id("post".into()))].into()).at(3)).unwrap();
    assert!(matches!(out.state,WriteState::Sent{..}));
    assert!(e.query("timelineHome",Context::new("b",Default::default()).at(4)).unwrap().data.as_array().unwrap().is_empty());
}
