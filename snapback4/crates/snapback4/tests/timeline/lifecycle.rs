use super::common::*;
use snapback4_core::{Engine, Store, Value, WriteState, value::object};

fn adopt(e: &mut Engine, b: snapback4_lang::Bound) -> Result<u64,snapback4_core::RuntimeError> {
    e.adopt(b.schema,b.programs.into_iter().map(|p|p.program))
}
fn bare() -> Engine { let b=compile(APP); Engine::memory(b.schema,[]).unwrap() }

#[test]
fn activation_registers_existing_profiles_atomically_up_to_1000() {
    for n in [0,1,1000,1001] {
        let mut e=bare();
        e.load((0..n).map(|n|("profiles".into(),object([("id",id(&format!("p{n}"))),("principal",id(&format!("a{n}")))])))).unwrap();
        let before=snapshot(&e); let generation=e.generation();
        let result=adopt(&mut e,bound(true));
        if n>1000 {
            assert_eq!(result.unwrap_err().code(),"E_TIMELINE_ACTIVATE");
            assert_eq!(e.generation(),generation); assert_eq!(snapshot(&e),before);
        } else {
            result.unwrap();
            assert_eq!(rows(&e,"feedAuthors").len(),n);
            assert!(rows(&e,"feedAuthors").iter().all(|r|r.field("shared").unwrap()==&Value::Bool(false)));
            let before=snapshot(&e);
            adopt(&mut e,bound(true)).unwrap(); assert_eq!(snapshot(&e),before);
        }
    }
}

#[test]
fn activation_refuses_each_populated_event_or_edge_table() {
    for (table,row) in [
        ("posts",object([("id",id("post")),("authorId",id("a")),("at",Value::Int(1)),("removed",Value::Bool(false))])),
        ("reposts",object([("id",id("repost")),("actorId",id("a")),("postId",id("post")),("at",Value::Int(1))])),
        ("follows",object([("id",id("edge")),("followerId",id("a")),("followedId",id("b")),("at",Value::Int(1))])),
    ] {
        let mut e=bare();e.load([(table.into(),row)]).unwrap();
        let before=snapshot(&e); let generation=e.generation();
        let err=adopt(&mut e,bound(true)).unwrap_err();assert_eq!(err.code(),"E_TIMELINE_ACTIVATE");
        assert_eq!(snapshot(&e),before);assert_eq!(e.generation(),generation);
    }
}

#[test]
fn durable_history_survives_adoption_reopen_and_trusted_restore() {
    let dir=std::env::temp_dir().join(format!("sb4-timeline-{}",std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path=dir.join("store.sqlite");
    let b=bound(true);let mut e=Engine::new(Store::open(&path).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    for (op,who,args,at) in [
        ("register","a",vec![],1),("register","b",vec![],2),
        ("publish","a",vec![("postId",id("p"))],3),
        ("follow","b",vec![("authorId",id("a"))],4),
        ("remove","a",vec![("postId",id("p"))],5),
    ] { let out=e.mutate(op,None,context(who,&args,at)).unwrap();assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}"); }
    let before=snapshot(&e);adopt(&mut e,bound(true)).unwrap();assert_eq!(snapshot(&e),before);
    // An unrelated program change takes a generation barrier, without rebuilding history.
    let mut b=bound(true);let extra=compile("query ping():\n  return true\n");b.programs.extend(extra.programs);
    adopt(&mut e,b).unwrap();assert_eq!(snapshot(&e),before);
    drop(e);let mut e=Engine::open(Store::open(&path).unwrap()).unwrap();assert_eq!(snapshot(&e),before);
    let mut restored=engine(true);restored.load_trusted(before.clone().into_iter().flat_map(|(t,rs)|rs.into_iter().map(move |r|(t.clone(),r)))).unwrap();
    assert_eq!(snapshot(&restored),before);
    for table in ["profiles","posts","reposts","follows"].into_iter().chain(OWNED) {
        let row=before.get(table).and_then(|rs|rs.first()).cloned().unwrap_or_else(||object([("id",id("unused"))]));
        let err=restored.load([(table.into(),row.clone())]).unwrap_err();assert_eq!(err.code(),"E_TIMELINE_IMPORT");
        let refusal=err.refusal();assert_eq!(refusal.guide.as_deref(),Some("feeds"));assert!(refusal.rewrite.is_some());
        assert_eq!(restored.seed([(table.into(),row)]).unwrap_err().code(),"E_TIMELINE_IMPORT");
    }
    assert_eq!(snapshot(&restored),before);
    let mut changed=bound(true); changed.schema.timelines[0].posts[3]="otherFlag".into();
    assert_eq!(adopt(&mut e,changed).unwrap_err().code(),"E_TIMELINE_REDEFINE");
    assert_eq!(adopt(&mut e,compile(APP)).unwrap_err().code(),"E_TIMELINE_REDEFINE");
    assert_eq!(snapshot(&e),before);
    drop(e);std::fs::remove_dir_all(dir).unwrap();
}
