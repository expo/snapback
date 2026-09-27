//! @ref LLP 3000.026#4-atomic-launch-adoption — launch history, isolation and recovery.
use snapback4_core::{Context, Engine, Store, Value, WriteState, value::object};
use std::{collections::BTreeSet, path::Path};
const Q: &str = include_str!("../../../experiments/following-adoption/probe.q");
fn bare() -> String {
    Q.replace("view following: activity where .actor = viewer or exists follows[viewer, .actor]\n", "")
        .replace("return following last", "return activity last")
}
fn bound(q: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), q.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics); b
}
fn engine(path: Option<&Path>, q: &str) -> Engine {
    let b = bound(q);
    Engine::new(path.map_or_else(Store::memory, Store::open).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn adopt(e: &mut Engine, q: &str) {
    let b = bound(q); e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
}
fn id(s: impl Into<String>) -> Value { Value::Id(s.into()) }
fn field(r: &Value, k: &str) -> Value { r.field(k).unwrap().clone() }
fn write(e: &mut Engine, op: &str, who: &str, args: &[(&str, Value)], at: i64) {
    let out = e.mutate(op, None, Context::new(who, args.iter().map(|(k,v)| (k.to_string(),v.clone())).collect()).at(at)).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
}
fn seed(e: &mut Engine, posts: usize, follows: usize) { seed_at(e, posts, follows, false); }
fn seed_at(e: &mut Engine, posts: usize, follows: usize, tied: bool) {
    for start in (0..posts).step_by(256) {
        e.seed((start..(start+256).min(posts)).map(|i| ("posts".into(), object([
            ("id", id(format!("p{i:05}"))), ("authorId", id("a")), ("parentId", Value::Null),
            ("body", Value::String("body".into())), ("at", Value::Int(if tied { 1 } else { i as i64 })), ("removed", Value::Bool(false)),
        ])))).unwrap();
    }
    for start in (0..follows).step_by(256) {
        e.seed((start..(start+256).min(follows)).map(|i| ("follows".into(), object([
            ("id", id(format!("f{i:05}"))), ("followerId", id(format!("r{i:05}"))), ("followedId", id("a")),
        ])))).unwrap();
    }
}
fn copies(e: &Engine, who: &str) -> BTreeSet<String> {
    e.store().rows("followingFeed").unwrap().iter().filter(|r| field(r,"readerId") == id(who))
        .map(|r| r.field("eventId").unwrap().as_str().unwrap().to_string()).collect()
}
fn page(e: &mut Engine, who: &str) -> snapback4_core::QueryOutcome {
    e.query("home", Context::new(who, [("c".into(),Value::Null)].into())).unwrap()
}
fn drain(e: &mut Engine) { while e.run_timeline_chunk(10000).unwrap().is_some() {} }
fn path(label: &str) -> std::path::PathBuf {
    let p = std::env::temp_dir().join(format!("fa-atomic-{label}-{}", std::process::id()));
    std::fs::create_dir_all(&p).unwrap(); p.join("store.sqlite")
}

#[test]
fn launch_is_all_own_and_newest_thousand_per_follow_without_refill() {
    let mut e = engine(None, &bare()); seed(&mut e, 1002, 2);
    write(&mut e,"post","r00000", &[("postId",id("own")),("parentId",Value::Null)], 2000);
    write(&mut e,"repost","r00000", &[("postId",id("p00000"))],2001);
    write(&mut e,"remove","a", &[("postId",id("p00000"))],2002);
    write(&mut e,"follow","r00001", &[("actor",id("r00000"))],2003);
    let b = bound(Q);
    let estimate = e.store_mut().timeline_launch_estimate(&b.schema).unwrap();
    assert_eq!(estimate[0].copies, 3005);
    adopt(&mut e,Q);
    assert_eq!(copies(&e,"a").len(),1001);
    let foreign: BTreeSet<_> = (2..1002).map(|i| format!("p{i:05}")).collect();
    let mut expected=foreign;
    expected.insert("own".into());
    expected.insert(e.store().rows("reposts").unwrap()[0].field("$timeline:following:repost").unwrap().as_str().unwrap().into());
    assert_eq!(copies(&e,"r00001"),expected);
    let own = copies(&e,"r00000"); assert_eq!(own.len(),1002); assert!(own.contains("own"));
    assert!(e.store().rows("followingWork").unwrap().iter().all(|r| field(r,"status") == Value::String("done".into())));
    assert_eq!(e.timeline_work_counts().unwrap(), [("following".into(),0,0)]);
    let home = page(&mut e,"r00000"); assert!(home.complete); assert_eq!(field(&home.data.as_array().unwrap()[0],"repost"),Value::Bool(true));
    write(&mut e,"remove","a", &[("postId",id("p01001"))],3000); drain(&mut e);
    assert_eq!(copies(&e,"r00001").len(),1001); assert!(!copies(&e,"r00001").contains("p00001"));
    // Initialized done births also permit an ordinary *later* follow to finish.
    write(&mut e,"follow","later", &[("actor",id("a"))],3001); drain(&mut e);
    assert_eq!(copies(&e,"later").len(),1000);
    write(&mut e,"unfollow","r00001", &[("actor",id("a"))],3002);
    write(&mut e,"follow","r00001", &[("actor",id("a"))],3003); drain(&mut e);
    assert_eq!(copies(&e,"r00001").len(),1002);
}

#[test]
fn fresh_launch_can_include_older_events_and_uses_new_repost_identity() {
    let mut historical = engine(None,Q);
    for n in 0..1001 { write(&mut historical,"post","a", &[("postId",id(format!("p{n:05}"))),("parentId",Value::Null)], n); }
    write(&mut historical,"follow","r00000", &[("actor",id("a"))],2000); drain(&mut historical);
    assert!(!copies(&historical,"r00000").contains("p00000"));
    write(&mut historical,"remove","a", &[("postId",id("p01000"))],2001); drain(&mut historical);
    assert!(!copies(&historical,"r00000").contains("p00000"));
    let mut launched = engine(None,&bare()); seed(&mut launched,1001,1);
    write(&mut launched,"remove","a", &[("postId",id("p01000"))],2001);
    write(&mut launched,"repost","r00000", &[("postId",id("p00000"))],2002);
    let mut other = engine(None,&bare()); seed(&mut other,1001,1);
    other.seed(launched.store().rows("reposts").unwrap().into_iter().map(|r|("reposts".into(),r))).unwrap();
    adopt(&mut launched,Q); adopt(&mut other,Q);
    assert!(copies(&launched,"r00000").contains("p00000"));
    let repost = |e: &Engine| field(&e.store().rows("reposts").unwrap()[0],"$timeline:following:repost");
    assert_ne!(repost(&launched),repost(&other));
    // Existing declarations' slots/ids survive another declaration's adoption.
    let before = repost(&launched);
    let two = Q.replace("query home", "view second: activity where .actor = viewer or exists follows[viewer, .actor]\nquery home");
    adopt(&mut launched,&two); assert_eq!(repost(&launched),before);
    adopt(&mut launched,&bare());
    let b=bound(Q); let err=launched.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap_err();
    assert_eq!(err.code(),"E_TIMELINE_ACTIVATE"); assert!(err.to_string().contains("first-use"));
}

#[test]
fn launch_uses_event_id_tiebreaks_and_builds_dependent_aggregates() {
    let mut e=engine(None,&bare()); seed_at(&mut e,1001,1,true);
    // An independently defined all-tied window must omit the lowest event id.
    let q=format!("{Q}\nview actorTotals: count followingPosts by .actorId\n  online only\n");
    adopt(&mut e,&q);
    assert_eq!(copies(&e,"r00000"),(1..1001).map(|i|format!("p{i:05}")).collect());
    let home=page(&mut e,"r00000");
    assert_eq!(field(&home.data.as_array().unwrap()[0],"id"),id("p01000"));
    assert_eq!(e.store().rows("actorTotals").unwrap()[0].field("value"),Ok(&Value::Int(1001)));
}

#[test]
fn retained_repost_of_a_filtered_card_survives_launch() {
    let mut e=engine(None,&bare());
    write(&mut e,"post","a",&[("postId",id("root")),("parentId",Value::Null)],1);
    write(&mut e,"post","a",&[("postId",id("reply")),("parentId",id("root"))],2);
    write(&mut e,"repost","b",&[("postId",id("reply"))],3);
    adopt(&mut e,Q);
    assert_eq!(e.store().count("followingPosts").unwrap(),2);
    let reply=e.store().rows("posts").unwrap().into_iter().find(|r|field(r,"id")==id("reply")).unwrap();
    assert_eq!(field(&reply,"$timeline:following:post"),Value::Bool(false));
    assert_eq!(field(&page(&mut e,"b").data.as_array().unwrap()[0],"post"),id("reply"));
}

#[test]
fn copy_ceiling_and_release_permission_refuse_before_candidate_writes() {
    let mut e=engine(None,&bare()); seed(&mut e,1001,5001);
    let before=e.generation(); let b=bound(Q);
    let writes=std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0)); let w=writes.clone();
    e.store().conn().update_hook(Some(move |_, _: &str, _: &str, _| { w.fetch_add(1,std::sync::atomic::Ordering::SeqCst); })).unwrap();
    let err=e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap_err();
    assert_eq!(err.code(),"E_TIMELINE_ACTIVATE"); assert!(err.to_string().contains("5002001"));
    assert!(err.to_string().contains("--allow-feed-adoption does not override this ceiling"));
    assert_eq!(writes.load(std::sync::atomic::Ordering::SeqCst),0);
    assert_eq!(e.generation(),before); assert!(e.store().rows("followingFeed").unwrap().is_empty());
    let p=path("release"); let mut e=engine(Some(&p),&bare()); seed(&mut e,2,1); drop(e);
    let b=bound(Q);
    let err=Engine::new_release(Store::open(&p).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program),1,None).err().unwrap();
    for text in ["--allow-feed-adoption","4 rows to copy","estimated writer lock","planned home query"] { assert!(err.to_string().contains(text),"{err}"); }
    let b=bound(Q);
    let e=Engine::new_release_with_feed_adoption(Store::open(&p).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program),1,None,true).unwrap();
    assert_eq!(copies(&e,"r00000").len(),2); drop(e); std::fs::remove_dir_all(p.parent().unwrap()).unwrap();
}

#[test]
fn predecessor_query_snapshot_and_log_normalization_are_isolated_until_commit() {
    let p=path("isolation"); let mut e=engine(Some(&p),&bare()); seed(&mut e,3,1);
    let mut reader=e.reader().unwrap(); let old=e.generation();
    let checked=std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)); let check=checked.clone();
    e.store().conn().commit_hook(Some(move || {
        let q=reader.query("exportPosts",Context::new("a",[("c".into(),Value::Null)].into())).unwrap();
        assert!(!q.unavailable); assert_eq!(q.data.as_array().unwrap().len(),3);
        let snapshot=reader.snapshot("a").unwrap();
        let log=reader.stream("a",0,100).unwrap();
        for text in [serde_json::to_string(&q.data).unwrap(),serde_json::to_string(&snapshot).unwrap(),serde_json::to_string(&log).unwrap()] {
            assert!(!text.contains("$timeline:"),"predecessor exposed slot: {text}");
        }
        assert_eq!(reader.generation(),old); check.store(true,std::sync::atomic::Ordering::SeqCst); false
    })).unwrap();
    adopt(&mut e,Q); assert!(checked.load(std::sync::atomic::Ordering::SeqCst));
    e.store().conn().commit_hook(None::<fn()->bool>).unwrap();
    assert!(e.store().rows("posts").unwrap().iter().all(|r| r.field("$timeline:following:post").is_ok()));
    drop(e); std::fs::remove_dir_all(p.parent().unwrap()).unwrap();
}

#[test]
fn process_death_before_commit_preserves_predecessor_and_retry_succeeds() {
    let p=path("crash"); let mut e=engine(Some(&p),&bare()); seed(&mut e,20,2);
    let generation=e.generation(); let rows=e.store().rows("posts").unwrap(); let seq=e.seq().unwrap(); drop(e);
    let status=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact","crash_before_launch_commit","--ignored"])
        .env("FA_ATOMIC_CRASH",&p).status().unwrap(); assert_eq!(status.code(),Some(73));
    let mut e=Engine::open(Store::open(&p).unwrap()).unwrap();
    assert_eq!(e.generation(),generation); assert_eq!(e.seq().unwrap(),seq); assert_eq!(e.store().rows("posts").unwrap(),rows);
    assert!(e.store().rows("followingFeed").unwrap().is_empty());
    let names: i64=e.store().conn().query_row("SELECT COUNT(*) FROM _catalog WHERE name LIKE 'following%'",[],|r|r.get(0)).unwrap();
    assert_eq!(names,0,"failed activation did not reserve its candidate catalog");
    adopt(&mut e,Q); assert_eq!(copies(&e,"r00000").len(),20); assert!(page(&mut e,"r00000").complete);
    drop(e); std::fs::remove_dir_all(p.parent().unwrap()).unwrap();
}
#[test]
#[ignore = "process-death child"]
fn crash_before_launch_commit() {
    let mut e=Engine::open(Store::open(Path::new(&std::env::var("FA_ATOMIC_CRASH").unwrap())).unwrap()).unwrap();
    e.store().conn().commit_hook(Some(|| { std::process::exit(73); })).unwrap(); adopt(&mut e,Q);
    panic!("commit hook did not run");
}

#[test]
#[ignore = "release-profile measurement: FA_SCALE=1 or 10, FA_ATOMIC_DIR is a fresh directory"]
fn calibration_atomic_launch_measurement() {
    let scale: usize = std::env::var("FA_SCALE").unwrap_or("1".into()).parse().unwrap();
    let dir = std::path::PathBuf::from(std::env::var("FA_ATOMIC_DIR").unwrap());
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("store.sqlite"); assert!(!path.exists());
    let (np,nr,nf,nu)=(48000*scale,1000*scale,6000*scale,1008*scale);
    let mut e=engine(Some(&path),&bare());
    for start in (0..np).step_by(256) {
        e.seed((start..(start+256).min(np)).map(|n| ("posts".into(), object([
            ("id",id(format!("p{:06}-{:06}",n%nu,n/nu))), ("authorId",id(format!("u{:06}",n%nu))),
            ("parentId",Value::Null), ("body",Value::String("x".repeat(200))),
            ("at",Value::Int((n%nu) as i64)), ("removed",Value::Bool(false)),
        ])))).unwrap();
    }
    for start in (0..nr).step_by(256) {
        e.seed((start..(start+256).min(nr)).map(|n| ("reposts".into(),object([
            ("id",id(format!("r{n:08}"))), ("actorId",id(format!("u{:06}",(n+7)%nu))),
            ("postId",id(format!("p{:06}-{:06}",n%nu,n/nu))), ("at",Value::Int(100+n as i64)),
        ])))).unwrap();
    }
    for start in (0..nf).step_by(256) {
        e.seed((start..(start+256).min(nf)).map(|n| ("follows".into(),object([
            ("id",id(format!("f{n:08}"))), ("followerId",id(format!("u{:06}",n%nu))),
            ("followedId",id(format!("u{:06}",(n%nu+1+n/nu)%nu))),
        ])))).unwrap();
    }
    let b=bound(Q);
    let expected=np+nr+(0..nf).map(|n| {
        let actor=(n%nu+1+n/nu)%nu;
        let posts=(np+nu-1-actor)/nu;
        let first=(actor+nu-7)%nu;
        (posts+if first<nr {(nr+nu-1-first)/nu} else {0}).min(1000)
    }).sum::<usize>();
    let estimates=e.store_mut().timeline_launch_estimate(&b.schema).unwrap(); assert_eq!(estimates[0].copies,expected as u64);
    e.store().conn().execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    let start=std::time::Instant::now();
    e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let elapsed=start.elapsed().as_secs_f64();
    let phases: Vec<_>=e.store().adoption_report.phases.iter().map(|(n,d)|(*n,d.as_secs_f64())).collect();
    let lock: f64=phases.iter().map(|(_,s)|s).sum();
    assert_eq!(e.store().count("followingFeed").unwrap(),expected as u64);
    assert_eq!(e.timeline_work_counts().unwrap(),[("following".into(),0,0)]);
    let result=serde_json::json!({"scale":scale,"posts":np,"reposts":nr,"follows":nf,"principals":nu,
        "copies":expected,"activation_wall_s":elapsed,"writer_lock_s":lock,"phases_s":phases,
        "estimated_row_writes":estimates[0].sources+2*estimates[0].events+estimates[0].copies,
        "sizes":e.store().sizes().unwrap()});
    std::fs::write(dir.join("result.json"),serde_json::to_string_pretty(&result).unwrap()).unwrap();
    println!("ATOMIC_RESULT {result}");
}
