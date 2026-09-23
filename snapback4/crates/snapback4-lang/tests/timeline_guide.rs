//! The language card's timeline is part of its single executable program.
use snapback4_core::{Context,Engine,Value,WriteState};

// @ref LLP 3000.007.003#33-f3-the-following-recipes-contract-as-a-declaration — mapped tables are ordinary column parents and sources; owned tables are not.
#[test]
fn maintained_columns_refuse_timeline_owned_sources_in_the_binder() {
    let base = snapback4_lang::guide::language();
    for (source, role, table) in [
        (base.replace("table timelineCards:", "table timelineCards:\n  score: count timelineFeed by postId"), "source", "timelineFeed"),
    ] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_MAINTAINED_COLUMN"
            && d.message.contains(&format!("timeline-owned {role} {table}"))
            && d.message.contains("use a table it maps")), "{:?}", bound.diagnostics);
    }
}

#[test]
fn maintained_columns_compose_with_mapped_timeline_tables() {
    // A mapped parent (cards) with an ordinary source (votes), and a mapped source (reposts).
    let source = snapback4_lang::guide::language().replace("table timelineCards:\n", "table timelineCards:\n  votes: count timelineVotes by postId\n  reposts: count timelineReposts by postId\n")
        + "\ntable timelineVotes:\n  postId: timelineCards\n  voter: principal\n  unique byPair: postId, voter\n  immutable postId, voter\n  public 'votes'\n  insert <- .voter = viewer\n  delete <- .voter = viewer\n"
        + "\nmutation timelineVote(postId: timelineCards):\n  insert timelineVotes { postId, voter: viewer }\n"
        + "\nmutation timelineUnvote(postId: timelineCards):\n  delete timelineVotes[postId, viewer]\n"
        + "\nmutation timelineRepost(postId: timelineCards):\n  insert timelineReposts { actorId: viewer, postId, at: now }\n"
        + "\nquery timelineCard(id: timelineCards):\n  return timelineCards[id]\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let run = |e: &mut Engine, op: &str, viewer: &str, args: Vec<(String, Value)>, ids: &[&str], at: i64| {
        let out = e.mutate(op, None, Context::new(viewer, args.into_iter().collect()).at(at).with_ids(ids.iter().map(|s| s.to_string()))).unwrap();
        assert!(matches!(out.state, WriteState::Sent { .. }), "{op}: {out:?}");
    };
    run(&mut e, "timelineRegister", "a", vec![], &["pa", "ma"], 1);
    run(&mut e, "timelineRegister", "b", vec![], &["pb", "mb"], 1);
    run(&mut e, "timelineFollow", "b", vec![("authorId".into(), Value::Id("a".into()))], &["edge", "copy"], 1);
    run(&mut e, "timelinePublish", "a", vec![], &["post", "own"], 2);
    let card = |e: &mut Engine| e.query("timelineCard", Context::new("b", [("id".into(), Value::Id("post".into()))].into()).at(9)).unwrap().data;
    assert_eq!((card(&mut e).field("votes").unwrap(), card(&mut e).field("reposts").unwrap()), (&Value::Int(0), &Value::Int(0)));
    run(&mut e, "timelineRepost", "b", vec![("postId".into(), Value::Id("post".into()))], &["repost"], 3);
    assert_eq!(card(&mut e).field("reposts").unwrap(), &Value::Int(1), "a mapped source counts through its transition");
    let owned: Vec<String> = e.schema().timelines[0].owned.iter().cloned().collect();
    let snapshot = |e: &Engine| owned.iter().map(|t| (t.clone(), e.store().rows(t).unwrap())).collect::<Vec<_>>();
    let before = snapshot(&e);
    run(&mut e, "timelineVote", "b", vec![("postId".into(), Value::Id("post".into()))], &["vote"], 4);
    assert_eq!(card(&mut e).field("votes").unwrap(), &Value::Int(1));
    assert_eq!(snapshot(&e), before, "the mirror onto a mapped card writes no timeline-owned row");
    assert!(!e.query("timelineHome", Context::new("b", Default::default()).at(5)).unwrap().data.as_array().unwrap().is_empty());
    run(&mut e, "timelineRemove", "a", vec![("postId".into(), Value::Id("post".into()))], &[], 6);
    assert_eq!(card(&mut e).field("votes").unwrap(), &Value::Int(1), "removal is not a vote");
    run(&mut e, "timelineUnvote", "b", vec![("postId".into(), Value::Id("post".into()))], &[], 7);
    assert_eq!(card(&mut e).field("votes").unwrap(), &Value::Int(0));
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
