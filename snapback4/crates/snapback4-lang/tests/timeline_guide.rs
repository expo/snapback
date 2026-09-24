//! Execute the language card's compatibility block and mapped-table invariants.
use snapback4_core::{Context,Engine,Value,WriteState};

// @ref LLP 3000.007.003#31-f1-maintained-columns — mapped tables are ordinary column parents and sources; owned tables are not.
#[test]
fn maintained_columns_refuse_timeline_owned_sources_in_the_binder() {
    let base = snapback4_lang::guide::quarry(snapback4_lang::guide::LANGUAGE).pop().unwrap();
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
    let source = snapback4_lang::guide::quarry(snapback4_lang::guide::LANGUAGE).pop().unwrap().replace("table timelineCards:\n", "table timelineCards:\n  votes: count timelineVotes by postId\n  reposts: count timelineReposts by postId\n")
        + "\ntable timelineVotes:\n  postId: timelineCards\n  voter: principal\n  unique byPair: postId, voter\n  immutable postId, voter\n  public 'votes'\n  insert <- .voter = viewer\n  delete <- .voter = viewer\n"
        + "\nmutation timelineVote(postId: timelineCards):\n  insert timelineVotes { postId, voter: viewer }\n"
        + "\nmutation timelineUnvote(postId: timelineCards):\n  delete timelineVotes[postId, viewer]\n"
        + "\nmutation timelineRepost(postId: timelineCards):\n  return insert timelineReposts { actorId: viewer, postId, at: now }\n"
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
    assert_eq!(card(&mut e).field("reposts").unwrap(), &Value::Int(1), "a mapped source updates its parent's count");
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

/// The language card's timeline with votes, reposts and unfollows. With `counted`, the mapped
/// cards also carry two maintained columns and an index over one of them.
fn voting_timeline(counted: bool) -> Engine {
    let columns = if counted { "table timelineCards:\n  votes: count timelineVotes by postId\n  reposts: count timelineReposts by postId\n  by byVotes: votes, at, id\n" } else { "table timelineCards:\n" };
    let source = snapback4_lang::guide::quarry(snapback4_lang::guide::LANGUAGE).pop().unwrap().replace("table timelineCards:\n", columns)
        + "\ntable timelineVotes:\n  postId: timelineCards\n  voter: principal\n  unique byPair: postId, voter\n  immutable postId, voter\n  public 'votes'\n  insert <- .voter = viewer\n  delete <- .voter = viewer\n"
        + "\nmutation timelineVote(postId: timelineCards):\n  insert timelineVotes { postId, voter: viewer }\n"
        + "\nmutation timelineUnvote(postId: timelineCards):\n  delete timelineVotes[postId, viewer]\n"
        + "\nmutation timelineRepost(postId: timelineCards):\n  return insert timelineReposts { actorId: viewer, postId, at: now }\n"
        + "\nmutation timelineUnfollow(authorId: principal):\n  if exists timelineFollows[viewer, authorId]:\n    delete timelineFollows[viewer, authorId]\n"
        + "\nquery timelineCard(id: timelineCards):\n  return timelineCards[id]\n"
        + "\nquery timelineMostVoted():\n  return timelineCards last 10 by byVotes\n";
    let source = if counted { source } else { source.replace("\nquery timelineMostVoted():\n  return timelineCards last 10 by byVotes\n", "") };
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}

// The narrowing's safety claim, as a differential oracle: counts on mapped tables change no
// timeline-owned relationship or home page, through delivery, reposts, removal and unfollow.
// Admission tokens differ because counts add writes/commits; compare their total
// order and references after canonical renaming, including derived ids/cursors.
#[test]
fn maintained_columns_on_mapped_tables_leave_timeline_state_identical() {
    let (mut plain, mut counted) = (voting_timeline(false), voting_timeline(true));
    let owned: Vec<String> = plain.schema().timelines[0].owned.iter().cloned().collect();
    let state = |e: &mut Engine| {
        let rows = canonical_owned(e, &owned);
        let homes: Vec<Vec<Value>> = ["a", "b", "c"].iter().map(|viewer| {
            let page = e.query("timelineHome", Context::new(*viewer, Default::default()).at(50)).unwrap();
            page.data.as_array().unwrap().iter().map(|entry| entry.field("id").unwrap().clone()).collect()
        }).collect();
        (rows, homes)
    };
    let id = |s: &str| Value::Id(s.into());
    let steps: Vec<(&str, &str, Vec<(String, Value)>, Vec<&str>)> = vec![
        ("timelineRegister", "a", vec![], vec!["pa", "ma"]),
        ("timelineRegister", "b", vec![], vec!["pb", "mb"]),
        ("timelineRegister", "c", vec![], vec!["pc", "mc"]),
        ("timelineFollow", "b", vec![("authorId".into(), id("a"))], vec!["edge-b", "copy-b"]),
        ("timelineFollow", "c", vec![("authorId".into(), id("b"))], vec!["edge-c", "copy-c"]),
        ("timelinePublish", "a", vec![], vec!["post", "own"]),
        // A repost's event takes its own fresh id after the repost row's.
        ("timelineRepost", "b", vec![("postId".into(), id("post"))], vec!["repost", "repost-event"]),
        ("timelineVote", "c", vec![("postId".into(), id("post"))], vec!["vote-c"]),
        ("timelineVote", "b", vec![("postId".into(), id("post"))], vec!["vote-b"]),
        ("timelinePublish", "a", vec![], vec!["post2", "own2"]),
        ("timelineRemove", "a", vec![("postId".into(), id("post"))], vec![]),
        ("timelineUnvote", "c", vec![("postId".into(), id("post"))], vec![]),
        ("timelineUnfollow", "c", vec![("authorId".into(), id("b"))], vec![]),
    ];
    for (at, (op, viewer, args, ids)) in steps.into_iter().enumerate() {
        for e in [&mut plain, &mut counted] {
            let ctx = Context::new(viewer, args.clone().into_iter().collect()).at(at as i64 + 1).with_ids(ids.iter().map(|s| s.to_string()));
            let out = e.mutate(op, None, ctx).unwrap();
            assert!(matches!(out.state, WriteState::Sent { .. }), "{op}: {out:?}");
        }
        // Delivery is asynchronous; compare both pending work and converged state.
        assert_eq!(state(&mut plain), state(&mut counted), "pending state after {op}");
        for e in [&mut plain, &mut counted] { while e.run_timeline_chunk(50).unwrap().is_some() {} }
        assert_eq!(state(&mut plain), state(&mut counted), "timeline state diverged after {op} by {viewer}");
        if (op, viewer) == ("timelineVote", "b") {
            let card = counted.query("timelineCard", Context::new("b", [("id".into(), id("post"))].into()).at(50)).unwrap().data;
            assert_eq!((card.field("votes").unwrap(), card.field("reposts").unwrap()), (&Value::Int(2), &Value::Int(1)));
        }
    }
    assert!(state(&mut plain).1[1].contains(&id("post2")), "b still receives a's posts");
    let card = counted.query("timelineCard", Context::new("b", [("id".into(), id("post"))].into()).at(50)).unwrap().data;
    assert_eq!(card.field("votes").unwrap(), &Value::Int(1), "removal is not a vote; the unvote is");
    let ranked = counted.query("timelineMostVoted", Context::new("b", Default::default()).at(50)).unwrap();
    let ids: Vec<_> = ranked.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().clone()).collect();
    assert_eq!(ids, [id("post"), id("post2")], "the index over a mapped count orders by votes");
}

#[test]
fn language_timeline_registers_delivers_and_removes_without_helpers() {
    let b=snapback4_lang::compile(&[("schema.q".into(),snapback4_lang::guide::quarry(snapback4_lang::guide::LANGUAGE).pop().unwrap())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(b.notes.is_empty(),"{:?}",b.notes);
    let names:Vec<_>=b.programs.iter().map(|p|p.program.name.as_str()).filter(|name|name.starts_with("timeline")).collect();
    assert_eq!(names,["timelineRegister","timelinePublish","timelineFollow","timelineRemove","timelineHome"]);
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

fn canonical_owned(e: &Engine, tables: &[String]) -> Vec<(String, Vec<Value>)> {
    use std::collections::{BTreeMap, BTreeSet};
    let mut rows: Vec<_> = tables.iter().map(|t|(t.clone(), e.store().rows(t).unwrap())).collect();
    let orders: BTreeSet<_> = rows.iter().flat_map(|(_, rs)|rs).flat_map(|r|["epoch", "admitted"].into_iter().filter_map(|f|r.field(f).ok().and_then(|v|v.as_str().ok()))).collect();
    let mut rename: BTreeMap<String, String> = orders.into_iter().enumerate().map(|(n, order)|(order.into(), format!("{n:032x}"))).collect();
    // Preserve the relationship between each copy/task identity and its epoch.
    for (table, rs) in &rows {
        let suffix = table.strip_prefix("timeline").unwrap();
        let fields: &[&str] = match suffix {
            "Feed" => &["readerId", "eventId", "epoch"],
            "Work" => &["kind", "actorId", "readerId", "eventId", "epoch"],
            _ => continue,
        };
        for row in rs {
            let key: Vec<_> = fields.iter().map(|f| {
                let value = row.field(f).unwrap();
                if *f == "epoch" && let Ok(epoch) = value.as_str() { Value::Id(rename[epoch].clone()) }
                else { value.clone() }
            }).collect();
            rename.insert(row.field("id").unwrap().as_str().unwrap().into(), snapback4_core::schema::timeline::owned_id("timeline", suffix, &key));
        }
    }
    for (_, rs) in &mut rows {
        for row in rs.iter_mut() {
            let Value::Row(fields) = row else { panic!("owned row") };
            for key in ["epoch", "admitted", "id"] {
                if let Some(Value::Id(value)) = fields.get(key) {
                    if let Some(next) = rename.get(value) { fields.insert(key.into(), Value::Id(next.clone())); }
                }
            }
            if let Some(Value::String(cursor)) = fields.get("cursor") {
                let bytes = snapback4_core::value::decode_bytes_hex(cursor).unwrap();
                let mut key = snapback4_core::key::decode(&bytes).unwrap();
                for value in &mut key {
                    if let Value::Id(id) = value { if let Some(next) = rename.get(id) { *id = next.clone(); } }
                }
                fields.insert("cursor".into(), Value::String(snapback4_core::value::encode_bytes_hex(&snapback4_core::key::encode(&key))));
            }
        }
        rs.sort_by_key(snapback4_core::value::canonical_json);
    }
    rows
}
