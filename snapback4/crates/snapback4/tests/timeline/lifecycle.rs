use super::common::*;
use snapback4_core::{Engine, Store, Value, WriteState, value::object};

fn adopt(e: &mut Engine, b: snapback4_lang::Bound) -> Result<u64,snapback4_core::RuntimeError> {
    e.adopt(b.schema,b.programs.into_iter().map(|p|p.program))
}
fn bare() -> Engine { let b=compile(APP); Engine::memory(b.schema,[]).unwrap() }

#[test]
fn activation_does_not_register_or_bound_existing_profiles() {
    for n in [0,1,1000,1001] {
        let mut e=bare();
        e.load((0..n).map(|n|("profiles".into(),object([("id",id(&format!("p{n}"))),("principal",id(&format!("a{n}")))])))).unwrap();
        adopt(&mut e,bound(true)).unwrap();
        assert!(!e.schema().tables.contains_key("feedAuthors"));
        assert_eq!(rows(&e,"profiles").len(),n);
        assert!(OWNED.iter().all(|t|rows(&e,t).is_empty()));
        let before=snapshot(&e);adopt(&mut e,bound(true)).unwrap();assert_eq!(snapshot(&e),before);
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
        assert!(err.to_string().contains(table)); assert!(err.to_string().contains("planned view"));
        assert_eq!(snapshot(&e),before);assert_eq!(e.generation(),generation);
    }
}

struct TempDir(std::path::PathBuf);
impl TempDir {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let path=std::env::temp_dir().join(format!("sb4-timeline-{}-{}-{}",std::process::id(),snapback4_core::now_ms(),NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed)));
        std::fs::create_dir(&path).unwrap();Self(path)
    }
}
impl Drop for TempDir {fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
fn with_ping() -> snapback4_lang::Bound {
    let mut b=bound(true);b.programs.extend(compile("query ping():\n  return true\n").programs);b
}
fn page(e: &mut Engine) -> Value {e.query("following",context("r0",&[],10000)).unwrap().data}

#[test]
fn durable_history_survives_adoption_reopen_and_trusted_restore() {
    let dir=TempDir::new();let path=dir.0.join("store.sqlite");
    let b=bound(true);let mut e=Engine::new(Store::open(&path).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let mut at=0;
    let mut sent=|e:&mut Engine,op:&str,who:&str,args:&[(&str,Value)]| {
        at+=1;let out=e.mutate(op,None,context(who,args,at)).unwrap();assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
    };
    sent(&mut e,"register","a",&[]);
    sent(&mut e,"publish","a",&[("postId",id("removed"))]);
    sent(&mut e,"publish","a",&[("postId",id("live"))]);
    for n in 0..51 {let who=format!("r{n}");sent(&mut e,"register",&who,&[]);sent(&mut e,"follow",&who,&[("authorId",id("a"))]);}
    sent(&mut e,"repost","r0",&[("postId",id("live"))]);
    sent(&mut e,"remove","a",&[("postId",id("removed"))]);
    sent(&mut e,"publish","a",&[("postId",id("broadcast"))]);
    let before=snapshot(&e);let generation=e.generation();let following=page(&mut e);
    for table in OWNED {assert!(!before[table].is_empty(),"history must populate {table}");}
    let repost = rows(&e,"feedPosts").into_iter().find(|r|r.field("repost").unwrap()==&Value::Bool(true)).unwrap().field("id").unwrap().clone();
    assert_eq!(following.as_array().unwrap().iter().map(|r|r.field("id").unwrap().clone()).collect::<Vec<_>>(), vec![repost, id("live")]);
    for n in 1..51 {
        let page = e.query("following",context(&format!("r{n}"),&[],10000)).unwrap();
        assert_eq!(page.data.as_array().unwrap().iter().map(|r|r.field("id").unwrap().clone()).collect::<Vec<_>>(),vec![id("live")]);
    }
    assert_eq!(rows(&e,"feedRemovedEvents")[0].field("eventId").unwrap(),&id("removed"));
    assert!(following.as_array().unwrap().iter().all(|r|r.field("id").unwrap()!=&id("removed")));
    adopt(&mut e,bound(true)).unwrap();assert_eq!(snapshot(&e),before);assert_eq!(e.generation(),generation);assert_eq!(page(&mut e),following);
    adopt(&mut e,with_ping()).unwrap();assert_eq!(snapshot(&e),before);assert_eq!(e.generation(),generation+1);assert_eq!(page(&mut e),following);
    drop(e);let mut e=Engine::open(Store::open(&path).unwrap()).unwrap();assert_eq!(snapshot(&e),before);assert_eq!(e.generation(),generation+1);assert_eq!(page(&mut e),following);
    assert_eq!(e.query("ping",context("r0",&[],10001)).unwrap().data, Value::Bool(true));
    super::identity::assert_placement(&e,&(1..=at).flat_map(|at|(0..1100).map(move |n|format!("m{at:08}-{n:04}"))).collect::<Vec<_>>());
    let mut restored=engine(true);adopt(&mut restored,with_ping()).unwrap();
    restored.load_trusted(before.clone().into_iter().flat_map(|(t,rs)|rs.into_iter().map(move |r|(t.clone(),r)))).unwrap();
    assert_eq!(snapshot(&restored),before);assert_eq!(restored.generation(),generation+1);assert_eq!(page(&mut restored),following);
    for table in ["posts","reposts","follows"].into_iter().chain(OWNED) {
        let original = before[table][0].clone();
        let mut absent = original.clone();
        let Value::Row(fields) = &mut absent else { panic!("stored {table} is not a row") };
        let suffix = table.strip_prefix("feed");
        // A real natural-key digest, not a merely well-formed or tampered id.
        let natural = match suffix {
            Some("Feed" | "Work" | "Edges") => "readerId",
            Some("RemovedEvents") => "eventId",
            _ => "id",
        };
        fields.insert(natural.into(), id("never-stored"));
        let new_id = match suffix {
            Some(role) if role != "Posts" => snapback4_core::schema::timeline::owned_id("feed", role, &super::identity::natural_key(role, &absent)),
            _ => "never-stored".into(),
        };
        let Value::Row(fields) = &mut absent else { unreachable!("row above") };
        fields.insert("id".into(), id(&new_id));
        assert!(!before[table].iter().any(|r| r.field("id").unwrap() == &id(&new_id)));
        let mut refusals = Vec::new();
        for trusted in [false, true] {
            for seed in [false, true] {
                for row in [&original, &absent] {
                    let mut fresh = engine(true);
                    if trusted { fresh.load_trusted(before.clone().into_iter().flat_map(|(t,rs)|rs.into_iter().map(move |r|(t.clone(),r)))).unwrap(); }
                    let saved = snapshot(&fresh); let generation = fresh.generation();
                    let err = if seed { fresh.seed([(table.into(),row.clone())]) } else { fresh.load([(table.into(),row.clone())]) }.unwrap_err();
                    assert_eq!(err.code(), "E_TIMELINE_IMPORT");
                    let refusal = err.refusal(); assert_eq!(refusal.guide.as_deref(),Some("feeds")); assert!(refusal.rewrite.is_some());
                    refusals.push((refusal.code, refusal.guide, refusal.rewrite));
                    assert_eq!(snapshot(&fresh),saved); assert_eq!(fresh.generation(),generation);
                }
            }
        }
        assert!(refusals.windows(2).all(|pair| pair[0] == pair[1]), "{table}: {refusals:?}");
    }
    let mut removed=with_ping();
    removed.schema.timelines.clear();
    for table in OWNED { removed.schema.tables.remove(table); }
    removed.programs.clear();
    adopt(&mut e,removed).unwrap();
    for table in ["profiles", "posts", "reposts", "follows"] { assert_eq!(e.store().rows(table).unwrap(), before[table]); }
    assert!(e.schema().timelines.is_empty());
    assert_eq!(e.generation(),generation+2);
}

#[test]
fn sqlite_activation_refusals_leave_reopened_file_unchanged() {
    for table in ["posts","reposts","follows"] {
        let dir=TempDir::new();let path=dir.0.join("store.sqlite");let b=compile(APP);
        let mut e=Engine::new(Store::open(&path).unwrap(),b.schema,[]).unwrap();
        let images=match table {
            "profiles"=>(0..1001).map(|n|object([("id",id(&format!("p{n}"))),("principal",id(&format!("a{n}")))])).collect(),
            "posts"=>vec![object([("id",id("p")),("authorId",id("a")),("at",Value::Int(1)),("removed",Value::Bool(false))])],
            "reposts"=>vec![object([("id",id("r")),("actorId",id("a")),("postId",id("p")),("at",Value::Int(1))])],
            _=>vec![object([("id",id("f")),("followerId",id("a")),("followedId",id("b")),("at",Value::Int(1))])],
        };
        e.load(images.into_iter().map(|r|(table.into(),r))).unwrap();let before=snapshot(&e);let generation=e.generation();
        let schema=e.schema().clone();let programs=e.programs().cloned().collect::<Vec<_>>();
        let catalog=|e:&Engine|e.store().conn().prepare("SELECT name FROM _catalog ORDER BY name").unwrap().query_map([],|r|r.get::<_,String>(0)).unwrap().collect::<Result<Vec<_>,_>>().unwrap();
        let tables=catalog(&e);
        assert_eq!(adopt(&mut e,bound(true)).unwrap_err().code(),"E_TIMELINE_ACTIVATE");
        assert_eq!(snapshot(&e),before);assert_eq!(e.generation(),generation);assert_eq!(e.schema(),&schema);assert_eq!(e.programs().cloned().collect::<Vec<_>>(),programs);assert_eq!(catalog(&e),tables);
        drop(e);
        let e=Engine::open(Store::open(&path).unwrap()).unwrap();assert_eq!(snapshot(&e),before);assert_eq!(e.generation(),generation);assert!(e.schema().timelines.is_empty());
        assert_eq!(e.schema(),&schema);assert_eq!(e.programs().cloned().collect::<Vec<_>>(),programs);assert_eq!(catalog(&e),tables);
    }
}

#[test]
fn sqlite_activation_of_1000_profiles_survives_reopen() {
    let dir=TempDir::new();let path=dir.0.join("store.sqlite");let b=compile(APP);
    let mut e=Engine::new(Store::open(&path).unwrap(),b.schema,[]).unwrap();
    e.load((0..1000).map(|n|("profiles".into(),object([("id",id(&format!("p{n}"))),("principal",id(&format!("a{n}")))])))).unwrap();
    drop(e);let mut e=Engine::open(Store::open(&path).unwrap()).unwrap();
    adopt(&mut e,bound(true)).unwrap();assert!(!e.schema().tables.contains_key("feedAuthors"));
    assert_eq!(rows(&e,"profiles").len(),1000);
    let before=snapshot(&e);let generation=e.generation();drop(e);
    let e=Engine::open(Store::open(&path).unwrap()).unwrap();assert_eq!(snapshot(&e),before);assert_eq!(e.generation(),generation);
    super::identity::assert_placement(&e,&[]);
}

#[test]
fn legacy_timeline_store_refuses_before_open_or_adoption() {
    let dir=TempDir::new();let path=dir.0.join("legacy.sqlite");let b=bound(true);
    let e=Engine::new(Store::open(&path).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let mut legacy=e.schema().clone();legacy.timelines[0].version=1;
    // 0.3 serialized no version field and carried the original capability.
    let mut wire=serde_json::to_value(&legacy).unwrap();wire["timelines"][0].as_object_mut().unwrap().remove("version");
    e.store().conn().execute("UPDATE _generations SET schema = ?1",[wire.to_string()]).unwrap();drop(e);
    let error=match Engine::open(Store::open(&path).unwrap()) {Ok(_)=>panic!("legacy store opened"),Err(error)=>error};
    assert_eq!(error.code(),"E_TIMELINE_REDEFINE");assert!(error.to_string().contains("fresh store"));
}
