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
    let key = [id(&principal), id(&post), Value::Null];
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
    let mut e=engine(true); sent(&mut e,"publish","a",&[("postId",id("p"))],1); sent(&mut e,"follow","b",&[("authorId",id("a"))],2);
    for (n,indexes) in ["by aFollowers: followedId, followerId\n  by byFollowed: followedId, followerId", "by byFollowed: followedId, followerId\n  by aFollowers: followedId, followerId", "by renamed: followedId, followerId"].into_iter().enumerate() {
        let before = snapshot(&e);
        let source=format!("{APP}{DECLARATION}").replace("  immutable principal", "  delete <- .principal = viewer\n  immutable principal").replace("  removed: bool default false", "  body: text <=4000 default ''\n  removed: bool default false").replace("by byFollowed: followedId, followerId",indexes);
        let mut b=compile(&source);
        // Preserve the mutation programs while adopting actual binder output.
        b.programs = bound(true).programs;
        e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
        assert_eq!(snapshot(&e),before);
        assert_eq!(e.schema().timelines[0].followed_index,"$timeline:feed:followers");
        let reader = format!("new-{n}");
        for (op,args) in [("register",vec![]),("follow",vec![("authorId",id("a"))])] {
            let out=e.mutate(op,None,context(&reader,&args,100+n as i64*2+usize::from(op=="follow") as i64)).unwrap();
            assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
        }
        assert_eq!(rows(&e,"feedFeed").iter().filter(|r|r.field("readerId").unwrap()==&id(&reader)).count(),1);
    }

}

#[test]
fn unfollow_hides_then_cleans_more_than_the_old_copy_cap() {
    let mut e=engine(true);sent(&mut e,"follow","b",&[("authorId",id("a"))],1);
    for n in 0..1001 {sent(&mut e,"publish","a",&[("postId",id(&format!("p{n:04}")))],n+2);}
    drain(&mut e);assert_eq!(rows(&e,"feedFeed").len(),2002);
    let out=sent(&mut e,"unfollow","b",&[("authorId",id("a"))],2000);assert_eq!(out.metered.rows_written,259);
    assert_eq!(rows(&e,"feedFeed").len(),1746);
    assert!(e.query("following",context("b",&[],2001)).unwrap().data.as_array().unwrap().is_empty());
    drain(&mut e);assert_eq!(rows(&e,"feedFeed").len(),1001);
}

#[test]
fn original_removal_with_missing_event_still_hides_private_copies() {
    let mut initial=engine(true);sent(&mut initial,"follow","c",&[("authorId",id("a"))],1);sent(&mut initial,"publish","a",&[("postId",id("p"))],2);drain(&mut initial);
    let images=snapshot(&initial).into_iter().filter(|(t,_)|t!="feedPosts").flat_map(|(t,rows)|rows.into_iter().map(move |mut r| {
        // A trusted image with an absent event must carry the same filled slot.
        // This preserves the missing-event cleanup witness under LLP 3000.016.
        if t == "posts" && let Value::Row(fields) | Value::Map(fields) = &mut r { fields.insert("$timeline:feed:post".into(), Value::Bool(false)); }
        (t.clone(),r)
    }));
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
    program.program.body.push(Stmt::Insert{table:"feedFeed".into(),row:Expr::Literal(object([("id",id("forged")),("principal",id("other")),("shared",Value::Bool(false))]))});
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();let before=snapshot(&e);
    let out=e.mutate("register",None,context("a",&[],1)).unwrap();
    assert!(matches!(out.state,WriteState::Failed{why,..} if why.code=="E_TIMELINE_OWNED"));assert_eq!(snapshot(&e),before);
}

#[test]
fn another_viewers_inbox_never_discloses() {
    let mut b=bound(true);
    b.programs.extend(compile(&format!("{APP}{DECLARATION}\nquery other():\n  return feed['b'] last 20\n")).programs);
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    sent(&mut e,"follow","b",&[("authorId",id("a"))],1);sent(&mut e,"publish","a",&[("postId",id("p"))],2);drain(&mut e);
    assert_eq!(e.query("other",context("b",&[],10)).unwrap().data.as_array().unwrap().len(),1);
    for who in ["a","c"] {assert!(e.query("other",context(who,&[],10)).unwrap().data.as_array().unwrap().is_empty());}
}

#[test]
fn timeline_namespace_is_atomic_across_every_declaration_kind() {
    let base=format!("{APP}{DECLARATION}");
    for extra in [
        "query feed():\n  return null\n", "fn feed():\n  return null\n",
        "job feedPosts():\n  chunk p in profiles first 1 by byId:\n    return null\n",
        "job someJob():\n  chunk p in profiles first 1 by byId:\n    return null\nschedule feed every 1m: someJob\n",
        "job someJob():\n  chunk p in profiles first 1 by byId:\n    return null\nschedule feedRemovedEvents every 1m: someJob\n",
        "query feedWork():\n  return null\n",
        "fn feedRemovedEvents():\n  return null\n",
    ] {
        for source in [format!("{base}\n{extra}"),format!("{extra}\n{base}")] {
            let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
            assert!(b.diagnostics.iter().any(|d|d.code=="E_TIMELINE_SHAPE"),"{extra}: {:?}",b.diagnostics);
            assert!(b.schema.timelines.is_empty());
        }
    }
    let duplicate=snapback4_lang::compile(&[("schema.q".into(),format!("{base}{DECLARATION}"))]);
    assert!(duplicate.schema.timelines.is_empty());assert!(duplicate.diagnostics.iter().any(|d|d.code=="E_TIMELINE_SHAPE"));
    for extra in [DECLARATION.replace("maintain feed:","maintain feedPosts:"),DECLARATION.replace("maintain feed:","maintain feedFeed:")] {
        let b=snapback4_lang::compile(&[("schema.q".into(),format!("{base}\n{extra}"))]);
        assert!(b.diagnostics.iter().any(|d|d.code=="E_TIMELINE_SHAPE"));
        assert!(b.schema.timelines.is_empty());
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
    let mut e=engine(true);sent(&mut e,"publish","a",&[("postId",id("removed"))],1);sent(&mut e,"remove","a",&[("postId",id("removed"))],2);
    let images=snapshot(&e).into_iter().filter(|(t,_)|t!="posts").flat_map(|(t,rs)|rs.into_iter().map(move |r|(t.clone(),r)));
    let mut fresh=engine(true);fresh.load_trusted(images).unwrap();
    let out=fresh.mutate("publish",None,context("a",&[("postId",id("removed"))],3)).unwrap();
    assert!(matches!(out.state,WriteState::Failed{why,..} if why.code=="FEED_EVENT_REMOVED"));
}

#[test]
fn background_refusal_rolls_back_chunk_and_parks_work() {
    let mut b=bound(true);b.schema.tables.get_mut("feedFeed").unwrap().constraints.push(snapback4_core::schema::Constraint::Cap{by:vec![],max:2});
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    for (n,who) in ["b","c"].into_iter().enumerate() {sent(&mut e,"follow",who,&[("authorId",id("a"))],n as i64);}
    drain(&mut e);sent(&mut e,"publish","a",&[("postId",id("p"))],2);
    drain(&mut e);assert_eq!(rows(&e,"feedFeed").len(),1,"first follower copy rolls back when the second exceeds the cap");
    assert_eq!(e.timeline_work_counts().unwrap(),[("feed".into(),0,1)]);
    assert!(!rows(&e,"feedWork")[0].field("error").unwrap().as_str().unwrap().is_empty());
}
