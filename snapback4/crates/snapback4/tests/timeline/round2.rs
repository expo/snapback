use super::{common::*, identity::{assert_placement, natural_key}};
use snapback4_core::{Context, Engine, Value, WriteState, schema::timeline::{owned_id, OWNED_SUFFIXES},
    ir::{Expr, Stmt, Program, ProgramKind}, value::object};

#[test]
fn serialized_timeline_sets_cannot_weaken_ownership() {
    for mutation in 0..6 {
        let mut b = bound(true);
        let t = &mut b.schema.timelines[0];
        match mutation {
            0 => { t.owned.remove("feedFeed"); }
            1 => { t.mapped.remove("posts"); }
            2 => { t.mapped.insert("feedFeed".into()); }
            3 => { t.owned.insert("posts".into()); }
            4 => { t.owned.insert("callerOwned".into()); }
            _ => { let duplicate=t.clone();b.schema.timelines.push(duplicate); }
        }
        let serialized = snapback4_core::value::canonical_json(&b.schema);
        let schema = snapback4_core::json_codec::from_text(&serialized).unwrap();
        assert!(snapback4_core::schema::validate(&schema).iter().any(|i| i.path == "timelines.feed"));
        assert!(Engine::memory(schema, b.programs.into_iter().map(|p| p.program)).is_err());
    }
}

#[test]
fn every_generated_name_is_reserved_against_every_user_declaration_kind() {
    for name in OWNED_SUFFIXES.iter().map(|s|format!("feed{s}")).chain(["feedPurgeRemoved".into(), "feedPurgeRemovedEvery".into()]) {
        for extra in [format!("table {name}:\n  value: int\n"),
            format!("maintain {name}: count profiles by principal\n  read <- deny\n  online only\n"),
            format!("job {name}():\n  chunk p in profiles first 1 by byId:\n    return null\n"),
            format!("job innocent():\n  chunk p in profiles first 1 by byId:\n    return null\nschedule {name} every 1m: innocent\n")] {
            for source in [format!("{APP}{DECLARATION}\n{extra}"),format!("{extra}\n{APP}{DECLARATION}")] {
                let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
                assert!(b.diagnostics.iter().any(|d| d.code == "E_TIMELINE_SHAPE"), "{name}: {:?}", b.diagnostics);
                assert!(b.schema.timelines.is_empty());
            }
        }
    }
    // A colliding user job is not admitted as a timeline purge, even if a
    // caller ignores diagnostics and attempts to execute the partial program.
    let source = format!("{APP}{DECLARATION}\njob feedPurgeRemoved():\n  chunk p in profiles first 1 by byId:\n    delete profiles[p.id]\n");
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.schema.timelines.is_empty());
    assert!(!b.schema.tables.contains_key("feedFeed"));
}

#[test]
fn later_program_owned_writes_refuse_identically_on_digest_hit_and_miss() {
    let mut p = Pair::new(); for who in ["a", "b"] { p.register(who); } p.follow("b", "a"); p.publish("a", "old");
    let saved = snapshot(&p.declared);
    let row = rows(&p.declared, "feedFeed").into_iter().find(|r|r.field("readerId").unwrap()==&id("b")).unwrap();
    let target = row.field("id").unwrap().clone();
    for kind in ["insert", "if-absent", "update", "delete", "upsert"] {
        for system in [false, true] {
            let mut results = Vec::new();
            for present in [false, true] {
                let mut b = bound(true);
                let statement = match kind {
                    "insert" => Stmt::Insert { table: "feedFeed".into(), row: Expr::Literal(row.clone()) },
                    "if-absent" => Stmt::InsertIfAbsent { table: "feedFeed".into(), row: Expr::Literal(row.clone()), result: "inserted".into() },
                    "update" => Stmt::Update { table: "feedFeed".into(), key: Expr::Literal(target.clone()), patch: Expr::Literal(object([] as [(&str,Value);0])) },
                    "upsert" => Stmt::Upsert { table: "feedFeed".into(), key: Expr::Literal(target.clone()), row: Expr::Literal(row.clone()) },
                    _ => Stmt::Delete { table: "feedFeed".into(), key: Expr::Literal(target.clone()) },
                };
                let bad = Program { name: "bad".into(), kind: ProgramKind::Mutation, args: Default::default(), read_time_granularity_ms: None, body: vec![statement], returned_shapes: Default::default(), native: false };
                let mut programs = b.programs.drain(..).map(|p|p.program).collect::<Vec<_>>(); programs.push(bad);
                let mut e = Engine::memory(b.schema, programs).unwrap();
                e.load_trusted(saved.clone().into_iter().flat_map(|(t,rs)|rs.into_iter().filter(|r|present || t!="feedFeed" || r.field("id").unwrap()!=&target).map(|r|(t.clone(),r)).collect::<Vec<_>>())).unwrap();
                // A successful mapped mutation finishes first; its grant must not
                // leak to this second operation, under either execution context.
                assert!(matches!(e.mutate("register",None,context("later",&[],200)).unwrap().state,WriteState::Sent{..}));
                let before = snapshot(&e);
                let out = e.mutate("bad",None,if system {Context::system().at(201)} else {context("a",&[],201)}).unwrap();
                assert!(matches!(&out.state,WriteState::Failed{why,..} if why.code=="E_TIMELINE_OWNED"),"{kind}: {out:?}");
                assert_eq!(out.metered.rows_written,0); assert_eq!(snapshot(&e),before);
                assert_placement(&e,&[]);
                results.push((out.state,out.metered,out.tables));
            }
            assert_eq!(results[0],results[1],"{kind} system={system}");
        }
    }
    assert_eq!(row.field("id").unwrap(), &id(&owned_id("feed","Feed",&natural_key("Feed",&row))));
}

#[test]
fn overbudget_purge_deletes_park_and_rollback_the_entire_chunk() {
    for copies in [false, true] {
        let mut b = bound(true);
        let purge = b.programs.iter_mut().find(|p|p.program.name=="feedPurgeRemoved").unwrap();
        let Stmt::For { body, .. } = &mut purge.program.body[0] else { panic!("purge sweep") };
        let table = if copies { "feedFeed" } else { "feedRemovedEvents" };
        let count = if copies { 1002 } else { 2 };
        *body = (0..count).map(|n| Stmt::Delete { table: table.into(), key: Expr::Literal(id(&format!("row-{n}"))) }).collect();
        let mut e = Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
        let tombstone = |key:&str| object([("id",id(key)),("eventId",id(key)),("actorId",id("a"))]);
        let mut images = vec![];
        if copies { images.push(("feedRemovedEvents".into(),tombstone("removed"))); }
        for n in 0..count {
            let key=format!("row-{n}");
            let row = if copies { object([("id",id(&key)),("readerId",id(&key)),("eventId",id("removed")),("postId",id("removed")),("actorId",id("a")),("authorId",id("a")),("at",Value::Int(1)),("repost",Value::Bool(false))]) } else { tombstone(&key) };
            images.push((table.into(),row));
        }
        // Deliberately corrupt trusted history exceeds the admitted per-event
        // cap, solely to test the authority ceiling, not a new paging contract.
        e.load_trusted(images).unwrap();let before=snapshot(&e);
        e.enqueue_job("feedPurgeRemoved",Default::default(),1).unwrap();
        let run=e.run_job_chunk(2).unwrap().unwrap();
        assert!(matches!(run.state,snapback4_core::JobState::Parked),"{run:?}");
        assert!(run.error.unwrap().contains("E_TIMELINE_OWNED"));assert_eq!(snapshot(&e),before);
    }
}

#[test]
fn purge_replays_read_and_application_setup_without_owned_authority() {
    let mut b=bound(true);
    let p=b.programs.iter_mut().find(|p|p.program.name=="feedPurgeRemoved").unwrap();
    p.program.body.insert(0,Stmt::InsertIfAbsent { table:"notes".into(),row:Expr::Literal(object([("id",id("setup")),("owner",id("a"))])),result:"setup".into() });
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    for event in ["one","two"] {
        e.load_trusted([("feedRemovedEvents".into(),object([("id",id(&owned_id("feed","RemovedEvents",&[id(event)]))),("eventId",id(event)),("actorId",id("a"))]))]).unwrap();
    }
    e.enqueue_job("feedPurgeRemoved",Default::default(),1).unwrap();
    for time in [2,3] {
        let run=e.run_job_chunk(time).unwrap().unwrap();
        assert!(!matches!(run.state,snapback4_core::JobState::Parked),"{run:?}");
        assert_eq!(rows(&e,"notes").len(),1);
    }
    assert!(rows(&e,"feedRemovedEvents").is_empty());
}
