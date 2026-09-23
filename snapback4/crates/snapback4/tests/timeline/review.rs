use super::common::*;
use snapback4_core::{Engine, Value, WriteState, schema::timeline::{owned_id, OWNED_SUFFIXES}, value::{identity_fits, object}};

#[test]
fn owned_ids_fit_maximum_id_principal_and_timeline_name() {
    let b = bound(true);
    // The portable label bound applies to table + index, including the
    // generated contribution index. Derive the longest accepted declaration.
    let length = b.schema.tables.iter().flat_map(|(table,t)| t.indexes.keys().map(move |index| (table,index)))
        .filter_map(|(table,index)| {
            let count = table.matches("feed").count() + index.matches("feed").count();
            (count > 0).then(|| (snapback4_core::rows::MAX_INDEX_LABEL_BYTES - table.len() - index.len() + 4 * count) / count)
        }).min().unwrap();
    let name = "t".repeat(length);
    let source = format!("{APP}{DECLARATION}").replace("feed", &name);
    let b = compile(&source);
    let too_long = source.replace(&name, &(name.clone() + "t"));
    assert!(snapback4_lang::compile(&[("schema.q".into(),too_long)]).diagnostics.iter().any(|d| d.code == "E_INDEX_KEY_BYTES"));
    let principal = "a".repeat(135); let post = "p".repeat(135);
    assert!(identity_fits(&principal) && identity_fits(&post));
    let key = [id(&principal), id(&post)];
    let mut ids = std::collections::BTreeSet::new();
    for timeline in [&name, &"other".into()] {
        for suffix in OWNED_SUFFIXES.into_iter().filter(|s| *s != "Posts") {
            let derived = owned_id(timeline, suffix, &key);
            assert_eq!(derived.len(),64); assert!(identity_fits(&derived));
            assert_eq!(derived, owned_id(timeline, suffix, &key));
            assert!(ids.insert(derived));
        }
    }
    assert_eq!(b.schema.timelines[0].name, name);
    let source = format!("{source}\nmutation register():\n  insert profiles {{ principal: viewer }}\nmutation publish():\n  insert posts {{ id: '{}', authorId: viewer, at: 7 }}\n", post);
    let b = compile(&source); let mut e = Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    for op in ["register","publish"] {
        let out=e.mutate(op,None,context(&principal,&[],1)).unwrap();
        assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
    }
    assert_eq!(rows(&e,&format!("{name}Posts"))[0].field("id").unwrap(), &id(&post));
    assert_eq!(rows(&e,&format!("{name}Feed"))[0].field("id").unwrap(), &id(&owned_id(&name,"Feed",&key)));
}

#[test]
fn unchanged_semantics_refresh_followed_index_without_reactivation() {
    let mut p=Pair::new(); p.register("a"); p.register("b"); p.publish("a","p"); p.follow("b","a");
    let mut e=p.declared;
    for (n,indexes) in ["by aFollowers: followedId, followerId\n  by byFollowed: followedId, followerId", "by byFollowed: followedId, followerId\n  by aFollowers: followedId, followerId", "by renamed: followedId, followerId"].into_iter().enumerate() {
        let before = snapshot(&e);
        let source=format!("{APP}{DECLARATION}").replace("  immutable principal", "  delete <- .principal = viewer\n  immutable principal").replace("  removed: bool default false", "  body: text <=4000 default ''\n  removed: bool default false").replace("by byFollowed: followedId, followerId",indexes);
        let mut b=compile(&source);
        // Preserve the mutation programs while adopting actual binder output.
        b.programs = bound(true).programs;
        e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
        assert_eq!(snapshot(&e),before);
        assert_eq!(e.schema().timelines[0].followed_index,if indexes.contains("aFollowers") {"aFollowers"} else {"renamed"});
        let reader = format!("new-{n}");
        for (op,args) in [("register",vec![]),("follow",vec![("authorId",id("a"))])] {
            let out=e.mutate(op,None,context(&reader,&args,100+n as i64*2+usize::from(op=="follow") as i64)).unwrap();
            assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
        }
        assert_eq!(rows(&e,"feedFeed").iter().filter(|r|r.field("readerId").unwrap()==&id(&reader)).count(),1);
    }

}

#[test]
fn promotion_counts_routes_once_and_totals_track_unfollow_refollow() {
    let mut p=Pair::new();p.register("a");
    for n in 0..51 {p.register(&format!("r{n}"));p.follow(&format!("r{n}"),"a");}
    for op in [None,Some("unfollow"),Some("follow")] {
        if let Some(op)=op {p.sent(op,"r50",&[("authorId",id("a"))]);}
        for e in [&p.recipe,&p.declared] {
            let routes=rows(e,"feedPulls"); let totals=rows(e,"feedPullTotals"); let counts=rows(e,"feedPullCounts");
            for reader in std::iter::once("a".to_string()).chain((0..51).map(|n|format!("r{n}"))) {
                let expected=if op==Some("unfollow") && reader=="r50" {0} else {1};
                assert_eq!(routes.iter().filter(|r|r.field("readerId").unwrap()==&id(&reader)).count(),expected);
                let total=totals.iter().filter(|r|r.field("readerId").unwrap()==&id(&reader)).collect::<Vec<_>>();
                assert_eq!(total.len(),expected); // count maintains delete their zero row
                if expected == 1 { assert_eq!(total[0].field("value").unwrap(),&Value::Int(1)); }
                let slots=counts.iter().filter(|r|r.field("readerId").unwrap()==&id(&reader)).collect::<Vec<_>>();
                assert_eq!(slots.len(),expected); // last unfollow deletes the slot row
                if expected == 1 { assert_eq!(slots[0].field("used").unwrap(),&Value::Int(1)); }
            }
        }
        p.equal();
    }
}

#[test]
fn unfollow_removes_all_1000_copies_at_the_reader_actor_cap() {
    let mut p=Pair::new();p.register("a");p.register("b");p.follow("b","a");
    for n in 0..1000 {p.publish("a",&format!("p{n:04}"));}
    assert_eq!(rows(&p.declared,"feedFeed").iter().filter(|r|r.field("readerId").unwrap()==&id("b")).count(),1000);
    p.equal();
    let overflow=p.step("publish","a",&[("postId",id("over-cap"))]);
    assert!(matches!(&overflow[1].state,WriteState::Failed{why,..} if why.code=="E_CONSTRAINT"));
    p.sent("unfollow","b",&[("authorId",id("a"))]);
    assert!(rows(&p.declared,"feedFeed").iter().all(|r|r.field("readerId").unwrap()!=&id("b")));
    p.equal();assert!(p.pages("b","following").is_empty());
}

#[test]
fn posting_without_a_profile_refuses_like_recipe() {
    let mut p=Pair::new();let out=p.step("publish","missing",&[("postId",id("p"))]);
    for out in out {assert!(matches!(out.state,WriteState::Failed{why,..} if why.code=="FEED_APP_NOT_FOUND"));}
    p.equal();
}

#[test]
fn original_removal_with_missing_event_still_hides_private_copies() {
    let mut p=Pair::new();p.register("a");p.register("c");p.follow("c","a");p.publish("a","p");
    let images=snapshot(&p.declared).into_iter().filter(|(t,_)|t!="feedPosts").flat_map(|(t,rows)|rows.into_iter().map(move |r|(t.clone(),r)));
    let mut e=engine(true);e.load_trusted(images).unwrap();
    assert_eq!(e.query("following",context("c",&[],20)).unwrap().data.as_array().unwrap()[0].field("id").unwrap(),&id("p"));
    assert_eq!(rows(&e,"feedFeed").len(),2);
    let before=snapshot(&e);
    let denied=e.mutate("remove",None,context("c",&[("postId",id("p"))],21)).unwrap();
    assert!(matches!(&denied.state,WriteState::Failed{why,..} if why.code=="E_RULE"));assert_eq!(snapshot(&e),before);
    let out=e.mutate("remove",None,context("a",&[("postId",id("p"))],22)).unwrap();
    assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
    assert_eq!(rows(&e,"feedRemovedEvents")[0].field("eventId").unwrap(),&id("p"));
    assert_eq!(rows(&e,"feedFeed").len(),2); // still pending purge, but unreadable in Following
    assert!(e.query("following",context("c",&[],23)).unwrap().data.as_array().unwrap().is_empty());
    super::identity::assert_placement(&e,&[]);
}

#[test]
fn mapped_write_does_not_leave_authority_for_a_later_owned_write() {
    use snapback4_core::ir::{Expr,Stmt};
    let mut b=bound(true);
    let program=b.programs.iter_mut().find(|p|p.program.name=="register").unwrap();
    program.program.body.push(Stmt::Insert{table:"feedAuthors".into(),row:Expr::Literal(object([("id",id("forged")),("principal",id("other")),("shared",Value::Bool(false))]))});
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();let before=snapshot(&e);
    let out=e.mutate("register",None,context("a",&[],1)).unwrap();
    assert!(matches!(out.state,WriteState::Failed{why,..} if why.code=="E_TIMELINE_OWNED"));assert_eq!(snapshot(&e),before);
}

#[test]
fn another_viewers_key_has_the_recipes_disclosure() {
    let mut answers=Vec::new();
    for declared in [false,true] {
        let mut sources=vec![("schema.q".into(),format!("{APP}{}",if declared {DECLARATION} else {""}))];
        let read=if declared {"feed['b'] last 20".to_string()} else {
            let recipe=snapback4_lang::recipe::following("feed","feed").unwrap();
            let (_, query)=recipe.split_once("query feedFollowing(c: cursor ?):\n  return ").unwrap();
            let read=query.split("\njob ").next().unwrap().trim().replace("after c ", "").replace("[viewer]", "['b']");
            sources.push(("feed.q".into(),recipe));
            read
        };
        let event=if declared {".id"} else {".eventId"};
        sources[0].1.push_str(&format!("\nquery other():\n  events = {read}\n  return events {{ id: {event}, postId, actorId, authorId, repost, at }}\n"));
        let b=snapback4_lang::compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
        let copy=|reader:&str,event:&str|object([("id",id(&owned_id("feed",if event=="shared" {"Broadcast"} else {"Feed"},&if event=="shared" {vec![id(event)]} else {vec![id(reader),id(event)]}))),("readerId",id(reader)),("eventId",id(event)),("postId",id(event)),("actorId",id("author")),("authorId",id("author")),("repost",Value::Bool(false)),("at",Value::Int(1))]);
        e.load_trusted([("feedFeed".into(),copy("b","private")),("feedBroadcast".into(),copy("author","shared")),("feedPulls".into(),object([("id",id(&owned_id("feed","Pulls",&[id("b"),id("author")]))),("readerId",id("b")),("authorId",id("author"))]))]).unwrap();
        let own=e.query("other",context("b",&[],10)).unwrap();
        assert_eq!(own.data.as_array().unwrap().iter().map(|r|r.field("id").unwrap().as_str().unwrap().to_string()).collect::<std::collections::BTreeSet<_>>(),["private".to_string(),"shared".to_string()].into());
        let answer=e.query("other",context("a",&[],10)).unwrap();
        assert!(answer.complete);assert!(answer.cut.is_none());assert!(answer.data.as_array().unwrap().is_empty(),"{answer:?}");
        answers.push((answer.data,answer.complete,answer.cut));
    }
    assert_eq!(answers[0],answers[1]);
}

#[test]
fn timeline_namespace_is_atomic_across_every_declaration_kind() {
    let base=format!("{APP}{DECLARATION}");
    for extra in [
        "query feed():\n  return null\n", "fn feed():\n  return null\n",
        "job feedPurgeRemoved():\n  chunk p in profiles first 1 by byId:\n    return null\n",
        "job someJob():\n  chunk p in profiles first 1 by byId:\n    return null\nschedule feed every 1m: someJob\n",
        "job someJob():\n  chunk p in profiles first 1 by byId:\n    return null\nschedule feedPurgeRemovedEvery every 1m: someJob\n",
        "query feedAuthors():\n  return null\n",
        "fn feedPullTotals():\n  return null\n",
    ] {
        for source in [format!("{base}\n{extra}"),format!("{extra}\n{base}")] {
            let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
            assert!(b.diagnostics.iter().any(|d|d.code=="E_TIMELINE_SHAPE"),"{extra}: {:?}",b.diagnostics);
            assert!(b.schema.timelines.is_empty());
        }
    }
    let duplicate=snapback4_lang::compile(&[("schema.q".into(),format!("{base}{DECLARATION}"))]);
    assert!(duplicate.schema.timelines.is_empty());assert!(duplicate.diagnostics.iter().any(|d|d.code=="E_TIMELINE_SHAPE"));
    for extra in [DECLARATION.replace("maintain feed:","maintain feedPurgeRemoved:"),DECLARATION.replace("maintain feed:","maintain feedFeed:")] {
        let b=snapback4_lang::compile(&[("schema.q".into(),format!("{base}\n{extra}"))]);
        assert!(b.diagnostics.iter().any(|d|d.code=="E_TIMELINE_SHAPE"));
        assert!(b.schema.timelines.is_empty());
    }
}

#[test]
fn purge_cannot_insert_update_or_delete_other_tables() {
    use snapback4_core::ir::{Expr,Stmt};
    for table in OWNED.into_iter().chain(["profiles","posts","reposts","follows","notes"]) {
        for kind in ["insert","update","delete"] {
            if kind=="delete" && matches!(table,"feedFeed"|"feedRemovedEvents") {continue;}
            let mut b=bound(true);
            let purge=b.schema.timelines[0].purge.clone();
            let p=b.programs.iter_mut().find(|p|p.program.name==purge).unwrap();
            let row=Expr::Literal(object([("id",id("forged"))]));
            let statement=match kind {
                "insert"=>Stmt::Insert{table:table.into(),row},
                "update"=>Stmt::Update{table:table.into(),key:Expr::Literal(id("forged")),patch:Expr::Literal(object([] as [(&str,Value);0]))},
                _=>Stmt::Delete{table:table.into(),key:Expr::Literal(id("forged"))},
            };
            let Stmt::For { body, .. } = &mut p.program.body[0] else { panic!("purge sweep") };
            body.insert(0,statement);
            let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
            e.load_trusted([("feedRemovedEvents".into(),object([("id",id(&owned_id("feed","RemovedEvents",&[id("removed")]))),("eventId",id("removed")),("actorId",id("a"))]))]).unwrap();
            let before=snapshot(&e);
            e.enqueue_job(&purge,Default::default(),1).unwrap();let run=e.run_job_chunk(2).unwrap().unwrap();
            assert!(matches!(run.state,snapback4_core::JobState::Parked),"{table}: {run:?}");
            assert!(run.error.as_deref().unwrap().contains("E_TIMELINE_OWNED"),"{run:?}");assert_eq!(snapshot(&e),before);
        }
    }
}

#[test]
fn structural_checks_still_run_inside_transition_authority() {
    use snapback4_core::schema::{Constraint,Index};
    // Restrict just the engine-owned target. App insert is valid and rolls
    // back when its derived write fails caps or uniqueness.
    for uniqueness in [false,true] {
        let mut b=bound(true);let feed=b.schema.tables.get_mut("feedFeed").unwrap();
        if uniqueness {feed.indexes.insert("uniqueReader".into(),Index::of(&["readerId"],true));}
        else {feed.constraints.push(Constraint::Cap{by:vec![],max:1});}
        let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
        e.mutate("register",None,context("a",&[],1)).unwrap();
        {let out=e.mutate("publish",None,context("a",&[("postId",id("first"))],2)).unwrap();assert!(matches!(out.state,WriteState::Sent{..}));}
        let before=snapshot(&e);let out=e.mutate("publish",None,context("a",&[("postId",id("second"))],3)).unwrap();
        assert!(matches!(&out.state,WriteState::Failed{why,..} if why.code=="E_CONSTRAINT"),"{out:?}");assert_eq!(snapshot(&e),before);
    }
}

#[test]
fn reinserting_removed_original_while_tombstone_exists_refuses() {
    let mut p=Pair::new();p.register("a");p.publish("a","removed");p.sent("remove","a",&[("postId",id("removed"))]);
    // A trusted partial history models a missing retained card; the tombstone
    // still forbids reusing the public event id in both implementations.
    for e in [&mut p.recipe,&mut p.declared] {
        let images=snapshot(e).into_iter().filter(|(t,_)|t!="posts").flat_map(|(t,rs)|rs.into_iter().map(move |r|(t.clone(),r)));
        let mut fresh=Engine::memory(e.schema().clone(),e.programs().cloned().collect::<Vec<_>>()).unwrap();fresh.load_trusted(images).unwrap();*e=fresh;
    }
    let out=p.step("publish","a",&[("postId",id("removed"))]);
    for out in out {assert!(matches!(out.state,WriteState::Failed{why,..} if why.code=="FEED_EVENT_REMOVED"));}
    p.equal();
}

#[test]
fn owned_source_writes_do_not_reenter_transitions_and_keep_immutability() {
    use snapback4_core::schema::Constraint;
    let mut b=bound(true);
    b.schema.tables.get_mut("feedAuthors").unwrap().constraints.push(Constraint::Immutable{fields:vec!["shared".into()]});
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    e.mutate("register",None,context("a",&[],1)).unwrap();
    for n in 0..51 {
        let reader=format!("r{n}");let out=e.mutate("register",None,context(&reader,&[],2+n*2)).unwrap();assert!(matches!(out.state,WriteState::Sent{..}));
        let before=snapshot(&e);let out=e.mutate("follow",None,context(&reader,&[("authorId",id("a"))],3+n*2)).unwrap();
        if n==50 {
            assert!(matches!(&out.state,WriteState::Failed{why,..} if why.code=="E_CONSTRAINT"),"{out:?}");assert_eq!(snapshot(&e),before);
        } else {assert!(matches!(out.state,WriteState::Sent{..}));}
    }
    // A normal promotion writes 52 routes + totals + slots exactly once.
    let mut p=Pair::new();p.register("a");
    for n in 0..51 {let reader=format!("r{n}");p.register(&reader);let out=p.sent("follow",&reader,&[("authorId",id("a"))]);
        if n==50 {assert_eq!(out[1].metered.rows_written,52*3+1+1,"F3: routes/totals/slots + shared mode + mapped edge");assert_eq!(out[0].metered.rows_written,52*3+1+2,"recipe also writes its duplicate edge");}}
    for table in ["feedPulls","feedPullTotals","feedPullCounts"] {
        assert_eq!(rows(&p.declared,table).len(),52);
        assert_eq!(rows(&p.declared,table).iter().map(|r|r.field("readerId").unwrap().as_str().unwrap().to_string()).collect::<std::collections::BTreeSet<_>>(), std::iter::once("a".to_string()).chain((0..51).map(|n|format!("r{n}"))).collect());
    }
    p.equal();
}

#[test]
fn a_purge_program_has_delete_authority_for_every_matching_timeline() {
    let b=compile(&format!("{APP}{DECLARATION}{}{}",DECLARATION.replace("maintain feed:","maintain second:"),DECLARATION.replace("maintain feed:","maintain unrelated:")));
    let mut schema=b.schema;let mut programs=b.programs.into_iter().map(|p|p.program).collect::<Vec<_>>();
    let second=programs.iter().find(|p|p.name=="secondPurgeRemoved").unwrap().body.clone();
    programs.iter_mut().find(|p|p.name=="feedPurgeRemoved").unwrap().body.extend(second);
    for t in &mut schema.timelines {if t.name!="unrelated" {t.purge="feedPurgeRemoved".into();}}
    let mut e=Engine::memory(schema,programs).unwrap();
    for name in ["feed","second","unrelated"] {
        e.load_trusted([(format!("{name}RemovedEvents"),object([("id",id(&owned_id(name,"RemovedEvents",&[id("removed")]))),("eventId",id("removed")),("actorId",id("a"))]))]).unwrap();
        for event in ["removed","live"] {
            e.load_trusted([(format!("{name}Feed"),object([("id",id(&owned_id(name,"Feed",&[id("b"),id(event)]))),("readerId",id("b")),("eventId",id(event)),("postId",id(event)),("actorId",id("a")),("authorId",id("a")),("repost",Value::Bool(false)),("at",Value::Int(1))]))]).unwrap();
        }
    }
    let before=snapshot(&e);
    let run=e.run_job("feedPurgeRemoved",Default::default(),2).unwrap();assert!(matches!(run.state,snapback4_core::JobState::Done),"{run:?}");
    for name in ["feed","second"] {
        assert!(rows(&e,&format!("{name}RemovedEvents")).is_empty());
        let live=rows(&e,&format!("{name}Feed"));assert_eq!(live.len(),1);assert_eq!(live[0].field("eventId").unwrap(),&id("live"));
    }
    for suffix in ["Feed","RemovedEvents"] {let table=format!("unrelated{suffix}");assert_eq!(rows(&e,&table),before[&table]);}
    super::identity::assert_placement(&e,&[]);
}

#[test]
fn digest_tombstones_keep_the_recipes_event_order_per_purge_chunk() {
    let mut p=Pair::new();p.register("a");p.register("b");p.follow("b","a");
    for n in 0..5 {let post=format!("removed-{n}");p.publish("a",&post);p.sent("remove","a",&[("postId",id(&post))]);}
    p.publish("a","live");
    for e in [&mut p.recipe,&mut p.declared] {let job=e.schema().schedules.iter().find(|s|s.target.ends_with("PurgeRemoved")).unwrap().target.clone();e.enqueue_job(&job,Default::default(),1000).unwrap();}
    for n in 0..5 {
        for e in [&mut p.recipe,&mut p.declared] {
            let run=e.run_job_chunk(1001+n).unwrap().unwrap();assert_eq!(run.rows_written,3*(n+1) as u64);
            assert_eq!(run.chunks,(n+1) as u64);
            assert_eq!(rows(e,"feedRemovedEvents").iter().map(|r|r.field("eventId").unwrap().as_str().unwrap().to_string()).collect::<std::collections::BTreeSet<_>>(),((n+1)..5).map(|i|format!("removed-{i}")).collect());
        }
        p.equal();
    }
    let cards=p.pages("b","following");assert_eq!(cards.len(),1);assert_eq!(cards[0].field("id").unwrap(),&id("live"));
}
