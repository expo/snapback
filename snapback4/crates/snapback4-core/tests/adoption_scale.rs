//! Reproduce calibration #22 directly through the engine. Deliberately outside
//! the blocking suite: SNAPBACK4_ADOPTION_SCALE=1 cargo test -p snapback4-core
//! --test adoption_scale -- --ignored --nocapture. The database is reusable.
use snapback4_core::{Context, Engine, Store, Value, value::object};
use std::{path::PathBuf, sync::{Arc, Mutex, mpsc, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};

const NOW: i64 = 1_790_000_000_000;
const SOURCE: &str = include_str!("../../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/source/snapback/schema.q");
const WINDOWS: &str = include_str!("../../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/source/snapback/windows.q");
fn bound(m8: bool) -> snapback4_lang::Bound {
    let m7 = format!("{}{}", SOURCE.split("view originalTotals:").next().unwrap(), &SOURCE[SOURCE.find("query trending():").unwrap()..]);
    let source = if m8 { SOURCE } else { &m7 };
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into()), ("windows.q".into(), WINDOWS.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn id(value: impl ToString) -> Value { Value::Id(value.to_string()) }
fn text(value: impl ToString) -> Value { Value::String(value.to_string()) }
fn user(n: usize) -> Value { id(format!("u{n:04}")) }
fn seed(engine: &mut Engine, table: &str, n: usize, make: impl Fn(usize) -> Value) {
    let started = Instant::now();
    for first in (0..n).step_by(64) {
        if matches!(table, "follows" | "posts" | "reposts") {
            for i in first..(first+64).min(n) {
                let row=make(i);
                let (op,viewer,args)=match table {
                    "follows" => ("setFollow",row.field("follower").unwrap(),object([("target",row.field("followed").unwrap().clone()),("active",Value::Bool(true))])),
                    "reposts" => ("setRepost",row.field("actor").unwrap(),object([("postId",row.field("post").unwrap().clone()),("active",Value::Bool(true))])),
                    _ => ("createPost",row.field("author").unwrap(),object([("postId",row.field("id").unwrap().clone()),("body",row.field("body").unwrap().clone()),("parent",row.field("parent").unwrap().clone()),("images",Value::Null),("video",Value::Null)])),
                };
                let result=engine.mutate(op,None,Context::new(viewer.as_str().unwrap(),args.as_object().unwrap().clone()).at(NOW)).unwrap();
                assert!(matches!(result.state,snapback4_core::WriteState::Sent { .. }),"{result:?}");
            }
        } else { engine.seed_at((first..(first+64).min(n)).map(|i| (table.into(), make(i))), NOW).unwrap(); }
    }
    eprintln!("seed {table}: {n} rows {} ms", started.elapsed().as_millis());
}
fn build(path: &std::path::Path) {
    let b = bound(false);
    let mut e = Engine::new_at(Store::open(path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program), NOW).unwrap();
    e.store().conn().execute_batch("PRAGMA cache_size = -131072").unwrap();
    if std::env::var("SNAPBACK4_RESUME_SEED").as_deref()!=Ok("1") {
    seed(&mut e, "profiles", 1008, |n| object([("id", user(n)), ("principal",user(n)), ("handle",text(format!("user{n:04}"))), ("displayName",text("Scale user")), ("bio",text("")), ("location",text(""))]));
    // 23 readers follow the prolific author. Remaining edges are disjoint;
    // each post therefore materializes 24 Following rows, including its author.
    seed(&mut e, "follows", 5921, |n| object([("id",id(format!("f{n:06}"))), ("follower",user(1+n%1007)), ("followed",user(if n<23 {0} else {1+((n%1007)+1+n/1007)%1007})), ("at",Value::Int(NOW))]));
    seed(&mut e, "posts", 48224, |n| object([("id",id(format!("p{n:06}"))), ("author",user(0)), ("body",text("Scale original")), ("parent",Value::Null), ("at",Value::Int(NOW-(n%7) as i64*86_400_000))]));
    seed(&mut e, "posts", 2004, |n| object([("id",id(format!("r{n:06}"))), ("author",user(1+n%1007)), ("body",text("Scale reply")), ("parent",id(format!("p{:06}",n%48224))), ("at",Value::Int(NOW))]));
    seed(&mut e, "likes", 5008, |n| object([("id",id(format!("l{n:06}"))), ("post",id(format!("p{:06}",n%48224))), ("principal",user(1+n%1007)), ("at",Value::Int(NOW))]));
    seed(&mut e, "reposts", 1004, |n| object([("id",id(format!("b{n:06}"))), ("post",id(format!("p{:06}",n))), ("actor",user(1+n%1007)), ("at",Value::Int(NOW))]));
    // One transaction establishes each chat with the membership required by
    // its after-insert rule; imports still run ordinary engine maintenance.
    for n in 0..1002 {
        let chat=id(format!("c{n:04}"));
        e.seed_at(vec![("chats".into(),object([("id",chat.clone()),("kind",text("dm")),("title",text("Scale chat")),("description",text("")),("creator",user(0)),("at",Value::Int(NOW))])),
            ("members".into(),object([("id",id(format!("m{n:04}a"))),("chat",chat.clone()),("principal",user(0)),("role",text("admin"))])),
            ("members".into(),object([("id",id(format!("m{n:04}b"))),("chat",chat),("principal",user(n+1)),("role",text("member"))]))],NOW).unwrap();
    }
    seed(&mut e,"messages",99105,|n|object([("id",id(format!("s{n:06}"))),("chat",id(format!("c{:04}",n%1002))),("sender",user(0)),("ordinal",Value::Int((n/1002+1) as i64)),("body",text("Scale message")),("at",Value::Int(NOW)),("expiresAt",Value::Null)]));
    }
    let settle=Instant::now(); let mut chunks=0;
    while e.run_timeline_chunk_for(NOW, std::time::Duration::from_secs(1)).unwrap().is_some() { chunks+=1; if chunks%5000==0 {eprintln!("settled {chunks} chunks in {} ms",settle.elapsed().as_millis());} }
    e.store().conn().execute_batch("PRAGMA cache_size = -2000").unwrap();
    e.store().conn().execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
}

#[test]
#[ignore = "scale fixture: about 1.4 million rows; explicit opt-in"]
fn m7_to_m8() {
    assert_eq!(std::env::var("SNAPBACK4_ADOPTION_SCALE").as_deref(),Ok("1"));
    let root=PathBuf::from(std::env::var("SNAPBACK4_ADOPTION_DIR").unwrap_or_else(|_|"target/adoption-scale".into()));
    std::fs::create_dir_all(&root).unwrap();
    let baseline=root.join("m7.db");
    if !root.join("m7.ready").exists() {
        if std::env::var("SNAPBACK4_RESUME_SEED").as_deref()!=Ok("1") {
            for suffix in ["", "-wal", "-shm"] { let _=std::fs::remove_file(format!("{}{suffix}",baseline.display())); }
        }
        build(&baseline); std::fs::write(root.join("m7.ready"),"ready").unwrap();
    }
    // The retained M7 program removes only the six views and insights; trending
    // and digest do not depend on them and stay present in both generations.
    let b = bound(false);
    let prepared = Engine::new_at(Store::open(&baseline).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program),NOW).unwrap();
    prepared.store().conn().execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    drop(prepared);
    let working=root.join("adopt.db");
    for suffix in ["", "-wal", "-shm"] { let _=std::fs::remove_file(format!("{}{suffix}",working.display())); }
    std::fs::copy(&baseline,&working).unwrap();
    let engine=Engine::open_at(Store::open(&working).unwrap(),NOW).unwrap();
    let counts:(i64,i64)=engine.store().conn().query_row("SELECT (SELECT count(*) FROM r), (SELECT count(*) FROM i)",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
    eprintln!("fixture rows={} indexes={}",counts.0,counts.1);
    let key_cost = std::env::var("SNAPBACK4_ADOPTION_KEY_GUARD_COST").as_deref() == Ok("1");
    if key_cost {
        // Collect the actual insertion workload separately from normal timings.
        engine.store().conn().execute_batch("CREATE TEMP TABLE rebuilt_keys (ti INTEGER, k BLOB, id TEXT);
            CREATE TEMP TRIGGER collect_rebuilt_keys AFTER INSERT ON main.i
            BEGIN INSERT INTO rebuilt_keys VALUES (NEW.ti, NEW.k, NEW.id); END;").unwrap();
    }
    let mut detached = std::env::var("SNAPBACK4_ADOPTION_DETACHED").ok().map(|_|engine.reader().unwrap());
    let hold_inside = detached.is_some();
    let inside = Arc::new(AtomicBool::new(false));
    let building = inside.clone();
    let shared=Arc::new(Mutex::new(engine));
    let (send,recv)=mpsc::channel();
    let (resume,resumed)=mpsc::channel();
    let owner=shared.clone();
    let adoption=std::thread::spawn(move||{
        let b=bound(true);
        let mut e=owner.lock().unwrap();
        let once=AtomicBool::new(false);
        e.store().conn().authorizer(Some(move |ctx: rusqlite::hooks::AuthContext<'_>| {
            // The identity SELECT has already pinned this BEGIN IMMEDIATE
            // transaction. Hold its first index read until the query finishes.
            if matches!(ctx.action,rusqlite::hooks::AuthAction::Read {table_name:"i",..})
                && !once.swap(true,Ordering::SeqCst) {
                building.store(true,Ordering::SeqCst);
                send.send(()).unwrap();
                if hold_inside {
                    let pause=Instant::now();
                    resumed.recv_timeout(Duration::from_secs(10)).unwrap();
                    eprintln!("injected_hold_us={}",pause.elapsed().as_micros());
                }
                building.store(false,Ordering::SeqCst);
            }
            rusqlite::hooks::Authorization::Allow
        })).unwrap();
        let started=Instant::now();
        e.adopt_at(b.schema,b.programs.into_iter().map(|p|p.program),NOW).unwrap();
        eprintln!("adoption_ms={} report={:#?}",started.elapsed().as_millis(),e.store().adoption_report);
    });
    recv.recv_timeout(Duration::from_secs(30)).unwrap();
    let started=Instant::now();
    let mut held = if detached.is_none() {Some(shared.lock().unwrap())} else {None};
    let e=match detached.as_mut() {Some(reader)=>reader,None=>held.as_deref_mut().unwrap()};
    let result=e.query_at("myProfile",Context::new("u0000",Default::default()).at(NOW)).0.unwrap();
    assert!(result.complete);
    let waited=started.elapsed();
    if hold_inside {
        assert!(inside.load(Ordering::SeqCst),"query must finish inside adoption's transaction");
        assert!(waited<Duration::from_secs(2),"detached query waited {waited:?}");
        resume.send(()).unwrap();
    }
    eprintln!("read_wait_us={} inside_transaction={hold_inside}",waited.as_micros());
    drop(detached);
    // End a mutex loan before joining its writer.
    drop(held); adoption.join().unwrap();
    if key_cost { measure_key_guards(&shared.lock().unwrap()); }
}

// Replay the fixture's exact rebuilt keys with identical prepared INSERTs,
// alternating guarded/unguarded runs. Every sample rolls back its index edits.
// This measures per-insert trigger cost, separately from evaluation and fsync.
fn measure_key_guards(engine: &Engine) {
    use rusqlite::{config::DbConfig, params};
    let conn = engine.store().conn();
    conn.authorizer(None::<fn(rusqlite::hooks::AuthContext<'_>) -> rusqlite::hooks::Authorization>).unwrap();
    conn.execute_batch("DROP TRIGGER collect_rebuilt_keys;").unwrap();
    let keys: Vec<(i64, Vec<u8>, String)> = conn.prepare("SELECT ti, k, id FROM rebuilt_keys ORDER BY rowid").unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().collect::<Result<_, _>>().unwrap();
    assert!(!keys.is_empty());
    // M8 inserts only twelve grouped-view keys. Repeat the same rebuild keys
    // to amortize clock noise; both variants include identical deletion work.
    let repeats = 1000;
    let inserts = keys.len() * repeats;
    let mut off = Vec::new();
    let mut on = Vec::new();
    for round in 0..6 {
        for enabled in if round % 2 == 0 { [false, true] } else { [true, false] } {
            conn.set_db_config(DbConfig::SQLITE_DBCONFIG_ENABLE_TRIGGER, enabled).unwrap();
            conn.execute_batch("BEGIN IMMEDIATE; DELETE FROM i WHERE (ti, k) IN (SELECT ti, k FROM rebuilt_keys);").unwrap();
            let elapsed = {
                let mut insert = conn.prepare("INSERT INTO i(ti, k, id) VALUES (?1, ?2, ?3)").unwrap();
                let mut clear = conn.prepare("DELETE FROM i WHERE (ti, k) IN (SELECT ti, k FROM rebuilt_keys)").unwrap();
                let start = Instant::now();
                for _ in 0..repeats {
                    clear.execute([]).unwrap();
                    for (ti, key, id) in &keys { insert.execute(params![ti, key, id]).unwrap(); }
                }
                start.elapsed().as_nanos()
            };
            conn.execute_batch("ROLLBACK;").unwrap();
            eprintln!("key_guard_sample enabled={enabled} rebuilt_keys={} inserts={inserts} elapsed_ns={elapsed}", keys.len());
            if enabled { on.push(elapsed); } else { off.push(elapsed); }
        }
    }
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_ENABLE_TRIGGER, true).unwrap();
    on.sort(); off.sort();
    let median = |v: &[u128]| (v[2] + v[3]) / 2;
    let delta = median(&on) as i128 - median(&off) as i128;
    eprintln!("key_guard_cost rebuilt_keys={} inserts={inserts} off_median_ns={} on_median_ns={} delta_ns_per_insert={:.1}",
        keys.len(), median(&off), median(&on), delta as f64 / inserts as f64);
}
