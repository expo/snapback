//! Ordinary columns use the same interpreter, including all rollback scopes.
// @ref LLP 3000.009.001.000#9.1 — exact outcomes and observable adapter contention.
use super::super::*;
use crate::{Engine, store_port::AnyStore};
pub(in crate::engine) const SOURCE: &str = include_str!("../../../../../snapback4-lang/tests/fixtures/maintained-columns.q");
pub(in crate::engine) fn bound(source: &str) -> (Schema, Vec<Program>) {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    (serde_json::from_str(&serde_json::to_string(&b.schema).unwrap()).unwrap(),
     b.programs.into_iter().map(|p| serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap()).collect())
}
fn connection() -> String { std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private scripts/test-postgres.sh database") }
fn namespace() -> String { format!("sb4_eval_mc_{:x}", crate::ids::seed()) }
pub(in crate::engine) fn pg(schema: Schema, programs: Vec<Program>) -> Engine {
    Engine::new_at(AnyStore::create_postgres(&connection(), &namespace()).unwrap(), schema, programs, 1000).unwrap()
}
pub(in crate::engine) fn id(s: &str) -> Value { Value::Id(s.into()) }
pub(in crate::engine) fn ctx(args: &[(&str, Value)]) -> Context { Context::new("alice", args.iter().map(|(k,v)| ((*k).into(), v.clone())).collect()).at(1000) }
pub(in crate::engine) fn like(key: &str, parent: Value, amount: i64, active: bool) -> Context {
    ctx(&[("id",id(key)),("postId",parent),("amount",Value::Int(amount)),("active",Value::Bool(active))])
}
pub(in crate::engine) fn equal_rows(sqlite: &Engine, postgres: &Engine) {
    for name in sqlite.schema().tables.keys() {
        assert_eq!(sqlite.store().rows(name).unwrap(), postgres.store().rows(name).unwrap(), "{name}");
    }
}
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn maintained_columns_exact_store_oracle() {
    let source = format!("{SOURCE}\nmutation abort(id: likes, postId: posts ?, active: bool, amount: int):\n  update likes[id] {{postId, active, amount}}\n  require false else NO\n");
    let (schema, programs) = bound(&source);
    for prefetch in [false, true] {
        let mut sqlite = Engine::new_at(AnyStore::memory().unwrap(), schema.clone(), programs.clone(), 1000).unwrap();
        let mut postgres = pg(schema.clone(), programs.clone());
        postgres.store_mut().test_postgres_handle_mut().store.get_mut().prefetch = prefetch;
        let steps = [
            ("post", ctx(&[("id",id("a")),("at",Value::Int(1))])),
            ("post", ctx(&[("id",id("b")),("at",Value::Int(2))])),
            ("post", ctx(&[("id",id("zero")),("at",Value::Int(3))])),
            ("like", like("l1",id("a"),7,true)),
            ("like", like("l2",id("a"),-7,true)), // zero sum with nonzero count
            ("change", like("l1",id("b"),12,true)), // both parents change
            ("abort", like("l1",id("a"),99,true)), // writes precede refusal
            ("change", like("l2",Value::Null,4,true)),
            ("change", like("l1",id("b"),12,false)),
            ("unlike",ctx(&[("id",id("l1"))])),
            ("like",like("hi",id("a"),crate::value::I53_MAX,true)),
            ("like",like("overflow",id("a"),1,true)),
            ("unlike",ctx(&[("id",id("hi"))])),
            ("like",like("lo",id("a"),crate::value::I53_MIN,true)),
            ("like",like("underflow",id("a"),-1,true)),
            ("deletePost",ctx(&[("id",id("a"))])), // retained private total
            ("post",ctx(&[("id",id("a")),("at",Value::Int(4))])), // birth from private truth
        ];
        for (n,(op,context)) in steps.into_iter().enumerate() {
            let op_id = format!("mc{n}");
            let a = sqlite.mutate(op,Some(&op_id),context.clone()).unwrap();
            let b = postgres.mutate(op,Some(&op_id),context.clone()).unwrap();
            assert_eq!(a.reply(Some(&op_id)),b.reply(Some(&op_id)),"{op}/{n}");
            assert_eq!(a,b,"complete outcome {op}/{n}");
            if matches!(n,11|14) { assert!(matches!(&a.state,WriteState::Failed {why,..} if why.code=="E_OVERFLOW"),"{a:?}"); }
            let replay=sqlite.mutate(op,Some(&op_id),context.clone()).unwrap();
            assert_eq!(replay,postgres.mutate(op,Some(&op_id),context).unwrap());
            assert!(replay.replayed);
            equal_rows(&sqlite,&postgres);
            for key in ["a","b","zero"] {
                let context = ctx(&[("id",id(key))]);
                let a = sqlite.query("postRow",context.clone()).unwrap();
                assert_eq!(a,postgres.query("postRow",context.clone()).unwrap());
            }
            let a=sqlite.query("ranked",ctx(&[("c",Value::Null)])).unwrap();
            assert_eq!(a,postgres.query("ranked",ctx(&[("c",Value::Null)])).unwrap());
        }
        let a=sqlite.store_mut().read_transaction().unwrap();
        let b=postgres.store_mut().read_transaction().unwrap();
        assert_eq!(a.commits_after(0,usize::MAX).unwrap(),b.commits_after(0,usize::MAX).unwrap());
        a.rollback().unwrap(); b.rollback().unwrap();
    }
}

fn without_columns() -> String {
    SOURCE.lines().filter(|line| !line.contains("likeCount:") && !line.contains("selected:") && !line.contains("total:") && !line.contains("by byLikes:")).collect::<Vec<_>>().join("\n").split("query ranked").next().unwrap().into()
}
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn maintained_columns_release_backfill_redefine_drop_readd_and_atomic_failure() {
    use crate::engine::release::ReleaseActivation;
    let base=without_columns(); let (schema,programs)=bound(&base);
    let mut sqlite=Engine::new_at(AnyStore::memory().unwrap(),schema.clone(),programs.clone(),1000).unwrap();
    let mut postgres=pg(schema,programs);
    for engine in [&mut sqlite,&mut postgres] {
        for (key,at) in [("a",1),("zero",2)] {engine.mutate("post",None,ctx(&[("id",id(key)),("at",Value::Int(at))])).unwrap();}
        engine.mutate("like",None,like("l1",id("a"),7,true)).unwrap();
        engine.mutate("like",None,like("l2",id("a"),5,false)).unwrap();
    }
    for (i,source) in [SOURCE.into(),SOURCE.replace("where .active", "where not .active"),base.clone(),SOURCE.into()].into_iter().enumerate() {
        let (schema,programs)=bound(&source);
        let options=ReleaseActivation::new(i as u64+1,if i==0 {None} else {Some(i as u64)});
        let a=sqlite.adopt_release_at(schema.clone(),programs.clone(),&options,false,1000).unwrap();
        let b=postgres.adopt_release_at(schema,programs,&options,false,1000).unwrap();
        assert_eq!(a,b);
        if i != 3 { equal_rows(&sqlite,&postgres); }
        // SQLite may restore explicit zero fields from dormant column custody
        // on re-add. Postgres discards derived fields and recounts them. Compare
        // every logical image, and the complete public query outcome below.
        for (name,table) in &sqlite.schema().tables {
            let images=|engine:&Engine| engine.store().rows(name).unwrap().iter().map(|row|crate::schema::row_image(row,table).into_owned()).collect::<Vec<_>>();
            assert_eq!(images(&sqlite),images(&postgres),"evolution round {i}: {name}");
        }
        if i==0 {
            for engine in [&sqlite,&postgres] {
                let rows=engine.store().rows("posts").unwrap();
                let zero=rows.iter().find(|row|row.field("id").unwrap()==&id("zero")).unwrap();
                assert!(zero.field("likeCount").is_err(),"first zero addition stays sparse");
            }
        }
        if i==2 {
            let tx=postgres.store_mut().transaction().unwrap();
            assert_eq!(tx.test_postgres_tx().query("SELECT count(*) FROM r WHERE t LIKE '$column:%'",&[]).unwrap()[0].get::<_,i64>(0),0);
            assert_eq!(tx.test_postgres_tx().query("SELECT count(*) FROM i WHERE t LIKE '$column:%'",&[]).unwrap()[0].get::<_,i64>(0),0);
            tx.rollback().unwrap();
        }
        for key in ["a","zero"] {
            assert_eq!(sqlite.query("postRow",ctx(&[("id",id(key))])).unwrap(),postgres.query("postRow",ctx(&[("id",id(key))])).unwrap(),"round {i}/{key}");
        }
        if i!=2 { assert_eq!(sqlite.query("ranked",ctx(&[("c",Value::Null)])).unwrap(),postgres.query("ranked",ctx(&[("c",Value::Null)])).unwrap()); }
    }
    let before=postgres.store().rows("posts").unwrap(); let generation=postgres.generation();
    // Unrelated evolution cannot acquire this narrow admission by also editing a column.
    let bad=SOURCE.replace("  at: time", "  at: time\n  extra: int default 0");
    let (schema,programs)=bound(&bad);
    assert!(matches!(postgres.adopt_at(schema,programs,1000),Err(RuntimeError::StoreUnsupported {family:"release-activation"})));
    assert_eq!(postgres.generation(),generation);assert_eq!(postgres.store().rows("posts").unwrap(),before);
    // Existing rows overflow only when a new aggregate is backfilled. The entire
    // release (projection, private rows, selection and generation) must roll back.
    let (schema,programs)=bound(&base); postgres.adopt_at(schema,programs,1000).unwrap();
    postgres.mutate("like",None,like("huge",id("a"),crate::value::I53_MAX,true)).unwrap();
    let before=postgres.store().rows("posts").unwrap();let generation=postgres.generation();
    let selected=postgres.store().release_value().unwrap();
    let (schema,programs)=bound(SOURCE);
    let targets=schema.maintains.iter().map(|m|m.target.clone()).collect::<Vec<_>>();
    assert_eq!(postgres.adopt_release_at(schema,programs,&ReleaseActivation::new(5,Some(4)),false,1000).unwrap_err().code(),"E_OVERFLOW");
    assert_eq!(postgres.generation(),generation);assert_eq!(postgres.store().rows("posts").unwrap(),before);
    assert_eq!(postgres.store().release_value().unwrap(),selected);
    for target in targets {assert!(postgres.store().rows(&target).unwrap().is_empty());}
    let tx=postgres.store_mut().transaction().unwrap();
    assert_eq!(tx.test_postgres_tx().query("SELECT count(*) FROM i WHERE ix='byLikes'",&[]).unwrap()[0].get::<_,i64>(0),0);
    tx.rollback().unwrap();
    let connection=connection(); let namespace=postgres.store().test_postgres_handle().connection.1.clone();
    drop(postgres);
    let reopened=Engine::open_at(AnyStore::open_postgres(&connection,&namespace).unwrap(),1000).unwrap();
    assert_eq!(reopened.generation(),generation);assert_eq!(reopened.store().rows("posts").unwrap(),before);
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn maintained_columns_two_writers_same_parent_observably_block() {
    use crate::store::test_race::FenceRace;
    use std::sync::Arc;
    let (schema,programs)=bound(SOURCE);
    let mut engine=pg(schema.clone(),programs.clone());
    engine.mutate("post",None,ctx(&[("id",id("a")),("at",Value::Int(1))])).unwrap();
    let namespace=engine.store().test_postgres_handle().connection.1.clone();
    let mut peer=Engine::open_at(AnyStore::open_postgres(&connection(),&namespace).unwrap(),1000).unwrap();
    let race={
        let a=engine.store_mut().test_postgres_handle_mut().store.get_mut();
        let b=peer.store_mut().test_postgres_handle_mut().store.get_mut();
        Arc::new(FenceRace::postgres(&mut a.client,&mut b.client,Client::connect(&connection(),postgres::NoTls).unwrap()))
    };
    let other=race.clone();let peer_schema=engine.schema().clone();
    let schema=engine.schema().clone();let program=engine.programs["like"].clone();let peer_program=program.clone();
    let join=std::thread::spawn(move || {
        let store=peer.store_mut().test_postgres_handle_mut().store.get_mut();
        let tx=store.transaction_with_begin_hook(Some(WriteMode::Serialized),||other.after_begin(false)).unwrap();
        let mut runner=Runner::new(&tx,&peer_schema,like("l2",id("a"),5,true),Meter::new(Ceilings::unbounded(),Cut::Abort),0);
        let result=runner.run(&peer_program).unwrap();drop(runner);tx.commit().unwrap();result
    });
    let store=engine.store_mut().test_postgres_handle_mut().store.get_mut();
    let tx=store.transaction_with_begin_hook(Some(WriteMode::Serialized),||race.after_begin(true)).unwrap();
    race.after_fence(true).unwrap();
    let mut runner=Runner::new(&tx,&schema,like("l1",id("a"),7,true),Meter::new(Ceilings::unbounded(),Cut::Abort),0);
    let first=runner.run(&program).unwrap();drop(runner);tx.commit().unwrap();
    let second=join.join().unwrap();
    let mut sqlite=Engine::new_at(AnyStore::memory().unwrap(),schema,programs,1000).unwrap();
    sqlite.mutate("post",None,ctx(&[("id",id("a")),("at",Value::Int(1))])).unwrap();
    let a=sqlite.mutate("like",Some("first"),like("l1",id("a"),7,true)).unwrap();
    let b=sqlite.mutate("like",Some("second"),like("l2",id("a"),5,true)).unwrap();
    assert!(matches!(a.state,WriteState::Sent { .. }));assert!(matches!(b.state,WriteState::Sent { .. }));
    let WriteState::Sent {result:a,..}=a.state else {panic!("first writer refused")};
    let WriteState::Sent {result:b,..}=b.state else {panic!("second writer refused")};
    assert_eq!(first,a);assert_eq!(second,b);
    equal_rows(&sqlite,&engine);
    let rows=engine.store().rows("posts").unwrap();
    assert_eq!(rows[0].field("likeCount").unwrap(),&Value::Int(2));
    assert_eq!(rows[0].field("total").unwrap(),&Value::Int(12));
}

#[test]
fn maintained_columns_sqlite_writers_observably_block() {
    use crate::store::test_race::FenceRace;
    use std::sync::Arc;
    let (schema,programs)=bound(SOURCE);
    let dir=std::env::temp_dir().join(format!("p1mc-sqlite-{:x}",crate::ids::seed()));
    std::fs::create_dir(&dir).unwrap(); let path=dir.join("store.sqlite");
    let mut engine=Engine::new_at(crate::Store::open(&path).unwrap(),schema.clone(),programs.clone(),1000).unwrap();
    engine.mutate("post",None,ctx(&[("id",id("a")),("at",Value::Int(1))])).unwrap();
    drop(engine);
    let mut holder=crate::Store::open(&path).unwrap();let mut contender=crate::Store::open(&path).unwrap();
    let race=Arc::new(FenceRace::sqlite());let other=race.clone();
    let program=programs.iter().find(|p|p.name=="like").unwrap().clone();
    let peer_program=program.clone();let peer_schema=schema.clone();
    let join=std::thread::spawn(move || {
        other.install_sqlite_busy_handler(contender.conn());
        let tx=contender.transaction_with_begin_hook(true,||other.after_begin(false)).unwrap();
        let mut runner=Runner::new(&tx,&peer_schema,like("l2",id("a"),5,true),Meter::new(Ceilings::unbounded(),Cut::Abort),0);
        runner.run(&peer_program).unwrap();drop(runner);tx.commit().unwrap();
    });
    let tx=holder.transaction_with_begin_hook(true,||race.after_begin(true)).unwrap();
    race.after_fence(true).unwrap();
    let mut runner=Runner::new(&tx,&schema,like("l1",id("a"),7,true),Meter::new(Ceilings::unbounded(),Cut::Abort),0);
    runner.run(&program).unwrap();drop(runner);tx.commit().unwrap();join.join().unwrap();drop(holder);
    let mut engine=Engine::open_at(crate::Store::open(&path).unwrap(),1000).unwrap();
    let expected=engine.query("postRow",ctx(&[("id",id("a"))])).unwrap();
    assert_eq!(expected.data.field("likeCount").unwrap(),&Value::Int(2));
    assert_eq!(expected.data.field("total").unwrap(),&Value::Int(12));
    drop(engine);std::fs::remove_dir_all(dir).unwrap();
}
