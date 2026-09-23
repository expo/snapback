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
            assert_eq!(rows(&e,"feedAuthors").iter().map(|r|r.field("principal").unwrap().as_str().unwrap().to_string()).collect::<std::collections::BTreeSet<_>>(),(0..n).map(|n|format!("a{n}")).collect());
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
    assert_eq!(following.as_array().unwrap().len(),3);
    assert!(following.as_array().unwrap().iter().all(|r|r.field("id").unwrap()!=&id("removed")));
    adopt(&mut e,bound(true)).unwrap();assert_eq!(snapshot(&e),before);assert_eq!(e.generation(),generation);assert_eq!(page(&mut e),following);
    adopt(&mut e,with_ping()).unwrap();assert_eq!(snapshot(&e),before);assert_eq!(e.generation(),generation+1);assert_eq!(page(&mut e),following);
    drop(e);let mut e=Engine::open(Store::open(&path).unwrap()).unwrap();assert_eq!(snapshot(&e),before);assert_eq!(e.generation(),generation+1);assert_eq!(page(&mut e),following);
    let mut restored=engine(true);adopt(&mut restored,with_ping()).unwrap();
    restored.load_trusted(before.clone().into_iter().flat_map(|(t,rs)|rs.into_iter().map(move |r|(t.clone(),r)))).unwrap();
    assert_eq!(snapshot(&restored),before);assert_eq!(restored.generation(),generation+1);assert_eq!(page(&mut restored),following);
    for table in ["profiles","posts","reposts","follows"].into_iter().chain(OWNED) {
        for seed in [false,true] {
            let mut fresh=engine(true);let empty=snapshot(&fresh);
            let mut row=before[table][0].clone();
            if let Value::Row(fields)=&mut row {fields.insert("id".into(),id(&format!("import-{table}")));}
            let err=if seed {fresh.seed([(table.into(),row)])} else {fresh.load([(table.into(),row)])}.unwrap_err();
            assert_eq!(err.code(),"E_TIMELINE_IMPORT");let refusal=err.refusal();assert_eq!(refusal.guide.as_deref(),Some("feeds"));assert!(refusal.rewrite.is_some());
            assert_eq!(snapshot(&fresh),empty);
        }
    }
    let mut changed=bound(true);changed.schema.timelines[0].posts[3]="otherFlag".into();
    for b in [changed,compile(APP)] {
        assert_eq!(adopt(&mut e,b).unwrap_err().code(),"E_TIMELINE_REDEFINE");assert_eq!(snapshot(&e),before);assert_eq!(e.generation(),generation+1);
    }
}

#[test]
fn sqlite_activation_refusals_leave_reopened_file_unchanged() {
    for table in ["profiles","posts","reposts","follows"] {
        let dir=TempDir::new();let path=dir.0.join("store.sqlite");let b=compile(APP);
        let mut e=Engine::new(Store::open(&path).unwrap(),b.schema,[]).unwrap();
        let images=match table {
            "profiles"=>(0..1001).map(|n|object([("id",id(&format!("p{n}"))),("principal",id(&format!("a{n}")))])).collect(),
            "posts"=>vec![object([("id",id("p")),("authorId",id("a")),("at",Value::Int(1)),("removed",Value::Bool(false))])],
            "reposts"=>vec![object([("id",id("r")),("actorId",id("a")),("postId",id("p")),("at",Value::Int(1))])],
            _=>vec![object([("id",id("f")),("followerId",id("a")),("followedId",id("b")),("at",Value::Int(1))])],
        };
        e.load(images.into_iter().map(|r|(table.into(),r))).unwrap();let before=snapshot(&e);let generation=e.generation();
        assert_eq!(adopt(&mut e,bound(true)).unwrap_err().code(),"E_TIMELINE_ACTIVATE");drop(e);
        let e=Engine::open(Store::open(&path).unwrap()).unwrap();assert_eq!(snapshot(&e),before);assert_eq!(e.generation(),generation);assert!(e.schema().timelines.is_empty());
    }
}
