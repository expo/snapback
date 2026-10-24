//! S1 closure differential: intermediate outcomes and complete serial history.
use crate::{Context,Engine,Program,Schema,Value,engine::program::Invocation,store_port::AnyStore};
use std::time::{Duration,Instant};
const S1:&str=include_str!("../../../../experiments/scale-controls/snapback-app/snapback/schema.q");
const EXTRA:&str=r#"
mutation guarded(counter: counters, delta: int, reject: bool):
  c = counters[counter] ! else NOT_FOUND
  update counters[c.id] { n: c.n + delta }
  require reject = false else NO
  return counters[counter]
mutation chain(source: counters, target: counters):
  c = counters[source] ! else NOT_FOUND
  update counters[target] { n: c.n + 1 }
  return { before: c, after: counters[target], again: counters[source] }
mutation clocked(counter: counters):
  return update counters[counter] { n: now }
mutation uniqueEdit(room: rooms):
  return update memberships[room, viewer] { last_read: 2 }
"#;
pub(super) fn fixture(pg:bool)->Engine{
    let source=format!("{S1}\n{EXTRA}");
    let bound=snapback4_lang::compile(&[("schema.q".into(),source)]);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let schema:Schema=serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
    let programs:Vec<Program>=bound.programs.into_iter().map(|p|serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect();
    let store=if pg {
        #[cfg(feature="postgres")]
        {AnyStore::create_postgres(&std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private PG16"),&format!("sb4_g3b_{:x}",crate::ids::seed())).unwrap()}
        #[cfg(not(feature="postgres"))] {panic!("postgres feature")}
    } else {AnyStore::memory().unwrap()};
    let mut engine=Engine::new_at(store,schema,programs,1000).unwrap();
    let row=|json:serde_json::Value| Value::Row(json.as_object().unwrap().iter().map(|(k,v)| (k.clone(),match v {serde_json::Value::String(s)=>Value::Id(s.clone()),serde_json::Value::Number(n)=>Value::Int(n.as_i64().unwrap()),serde_json::Value::Null=>Value::Null,_=>panic!("fixture scalar")})).collect::<std::collections::BTreeMap<_,_>>().into());
    let mut seed=vec![("rooms".into(),row(serde_json::json!({"id":"r"}))),
        ("memberships".into(),row(serde_json::json!({"id":"ma","room":"r","principal":"alice","last_read":0})))];
    for id in ["a","b","shared"].into_iter().map(String::from).chain((0..32).map(|n|format!("k{n}"))){
        seed.push(("counters".into(),row(serde_json::json!({"id":id,"owner":if id=="shared" {serde_json::Value::Null}else{serde_json::json!("alice")},"room":"r","n":0}))));
    }
    engine.seed_at(seed,1000).unwrap();engine
}
fn member(seed:u64,n:usize)->Invocation{
    let x=seed.wrapping_mul(6364136223846793005).rotate_left((n%63) as u32).wrapping_add(n as u64*797);
    let key=match x%9{0=>"missing".into(),1=>"shared".into(),2=>"a".into(),3=>"b".into(),_=>format!("k{}",x%32)};
    let mut invocation=Invocation::new("guarded",(n%3!=0).then(||format!("op-{n}")),Context::new(if x%11==0{"bob"}else{"alice"},[("counter".into(),Value::Id(key)),("delta".into(),Value::Int((x%17)as i64-8)),("reject".into(),Value::Bool(x%7==0))].into()).at(1000+n as i64));
    invocation.deadline=Instant::now()+Duration::from_secs(10);invocation
}
fn outcome(result:Result<crate::engine::MutationAcknowledgement,crate::Refusal>)->serde_json::Value{
    match result {Ok(ack)=>serde_json::to_value(ack.outcome).unwrap(),Err(why)=>serde_json::json!({"error":why})}
}
fn oracle(pg:bool){
    for seed in [1,19,0xdecaf]{
        let mut reference=fixture(pg);
        let expected=(0..192).map(|i|outcome(reference.invoke_program(&mut member(seed,i)))).collect::<Vec<_>>();
        for size in [8,32]{
            let mut engine=fixture(pg);let mut actual=Vec::new();let mut buffered=0;
            for start in (0..192).step_by(size){
                let mut batch=(start..start+size).map(|i|member(seed,i)).collect::<Vec<_>>();
                actual.extend(engine.invoke_program_batch(&mut batch).into_iter().map(outcome));
                for i in &batch {buffered+=usize::from(i.attempts.last().unwrap().buffered);}
            }
            assert_eq!(actual,expected,"seed={seed},N={size},pg={pg}");
            assert_eq!(super::tests::snapshot(&mut engine),super::tests::snapshot(&mut reference));
            assert_eq!(buffered,192,"all bounded members must use the overlay");
        }
    }
}
#[test]fn overlay_serial_history_sqlite(){oracle(false);}
#[cfg(feature="postgres")]#[test]#[ignore="private PG16"]fn overlay_serial_history_postgres(){oracle(true);}
fn chains(pg:bool){
    let mut reference=fixture(pg);let mut engine=fixture(pg);
    let intent=|n|{let(source,target)=match n{0=>("a".into(),"b".into()),1=>("b".into(),"k0".into()),_=> (format!("k{}",n-2),format!("k{}",n-1))};Invocation::new("chain",Some(format!("chain-{n}")),Context::new("alice",[("source".into(),Value::Id(source)),("target".into(),Value::Id(target))].into()).at(1000))};
    let expected=(0..16).map(|n|outcome(reference.invoke_program(&mut intent(n)))).collect::<Vec<_>>();
    let mut batch=(0..16).map(intent).collect::<Vec<_>>();
    let actual=engine.invoke_program_batch(&mut batch).into_iter().map(outcome).collect::<Vec<_>>();
    assert_eq!(actual,expected);assert_eq!(super::tests::snapshot(&mut engine),super::tests::snapshot(&mut reference));
    assert_eq!(batch.iter().filter(|i|i.attempts.last().unwrap().conflict_rerun).count(),15);
}
#[test]fn overlay_read_after_write_chain_sqlite(){chains(false);}
#[cfg(feature="postgres")]#[test]#[ignore="private PG16"]fn overlay_read_after_write_chain_postgres(){chains(true);}
#[test]fn bounded_selector_and_fallbacks(){
    let engine=fixture(false);
    for name in ["increment","guarded","chain"]{
        let mut context=member(19,1).context;
        context.args.insert("source".into(),Value::Id("a".into()));context.args.insert("target".into(),Value::Id("b".into()));
        let p=&engine.programs[ name ];
        context.args.retain(|name,_|p.args.contains_key(name));
        let plan=crate::engine::committer::closure::Closure::new(&engine.schema,p,&context,engine.generation);
        assert!(plan.is_some(),"{name}: {p:#?}");
    }
    for name in ["clocked","post","uniqueEdit"]{
        let mut context=Context::new("alice",[("counter".into(),Value::Id("a".into())),("room".into(),Value::Id("r".into())),("body".into(),Value::String("hi".into()))].into());
        let p=&engine.programs[name];context.args.retain(|name,_|p.args.contains_key(name));
        assert!(crate::engine::committer::closure::Closure::new(&engine.schema,p,&context,engine.generation).is_none(),"{name}");
    }
}
fn boundaries(pg:bool){
    use super::fault::{self,Point::*};
    let intent=|n|{let mut i=member(19,n);i.context.args.insert("counter".into(),Value::Id("shared".into()));i.context.args.insert("reject".into(),Value::Bool(n==3));i.context.viewer="alice".into();i};
    for point in [BeforeFacts,AfterFacts,BeforeLevel,AfterLevel,BeforeMember,MemberSavepoint,ProgramSavepoint,ProgramRelease,MemberRelease,AfterMember,BeforeTail,AfterTail,BeforeCommit,AfterCommit]{
        let positions=if matches!(point,BeforeLevel|AfterLevel){vec![0,1]}else if matches!(point,BeforeMember|MemberSavepoint|ProgramSavepoint|ProgramRelease|MemberRelease|AfterMember){(0..8).filter(|n|*n!=3 || point!=ProgramRelease).collect()}else{vec![usize::MAX]};
        for position in positions {
            let mut engine=fixture(pg);let mut reference=fixture(pg);let mut batch=(0..8).map(intent).collect::<Vec<_>>();
            let actual=fault::inject(point,position,||engine.invoke_program_batch(&mut batch));
            let named=matches!(point,BeforeMember|MemberSavepoint|ProgramSavepoint|ProgramRelease|MemberRelease|AfterMember);
            for n in 0..8{
                if named && n==position {assert!(actual[n].is_err(),"{point:?}/{position}");continue;}
                let expected=reference.invoke_program(&mut intent(n));
                if point==AfterCommit {assert_eq!(actual[n].as_ref().unwrap_err().code,"E_COMMIT_OUTCOME_UNKNOWN");}
                else {assert_eq!(outcome(actual[n].clone()),outcome(expected),"{point:?}/{position}/{n}");}
            }
            assert_eq!(super::tests::snapshot(&mut engine),super::tests::snapshot(&mut reference),"{point:?}/{position}");
            if point==AfterCommit {assert!(batch.iter().all(|i|i.attempts.len()==1));}
        }
    }
}
#[test]fn overlay_flight_and_member_boundaries_sqlite(){boundaries(false);}
#[cfg(feature="postgres")]#[test]#[ignore="private PG16"]fn overlay_flight_and_member_boundaries_postgres(){boundaries(true);}
fn mixed_and_receipts(pg:bool){
    let mut engine=fixture(pg);let mut reference=fixture(pg);
    let mut batch=(0..8).map(|n|{let mut i=member(19,n);i.context.viewer="alice".into();i.context.args.insert("counter".into(),Value::Id("a".into()));i.context.args.insert("reject".into(),Value::Bool(false));i}).collect::<Vec<_>>();
    batch[2]=Invocation::new("clocked",None,Context::new("alice",[("counter".into(),Value::Id("a".into()))].into()).at(1007));
    batch[4]=Invocation::new("uniqueEdit",None,Context::new("alice",[("room".into(),Value::Id("r".into()))].into()).at(1008));
    batch[5]=member(19,0);batch[5].id=Some("duplicate".into());batch[6]=member(19,0);batch[6].id=Some("duplicate".into());
    let mut expected=Vec::new();
    for i in &batch {let mut copy=Invocation::new(i.name.clone(),i.id.clone(),i.context.clone());expected.push(outcome(reference.invoke_program(&mut copy)));}
    let actual=engine.invoke_program_batch(&mut batch).into_iter().map(outcome).collect::<Vec<_>>();
    assert_eq!(actual,expected);assert_eq!(super::tests::snapshot(&mut engine),super::tests::snapshot(&mut reference));
    assert!(!batch[2].attempts.last().is_some_and(|a|a.buffered));assert!(!batch[4].attempts.last().is_some_and(|a|a.buffered));
}
#[test]fn overlay_mixed_fallback_and_duplicate_receipts_sqlite(){mixed_and_receipts(false);}
#[cfg(feature="postgres")]#[test]#[ignore="private PG16"]fn overlay_mixed_fallback_and_duplicate_receipts_postgres(){mixed_and_receipts(true);}

#[cfg(feature="postgres")]
#[test]
#[ignore="private PG16; real COMMIT kill and ownership transfer"]
fn overlay_owned_commit_loss_and_takeover(){
    use crate::engine::command::{Queue,ProgramCommand,Command};
    use crate::{metadata::MetadataReader,store_port::{StoreLease,LeasePolicy}};
    use postgres::{Client,NoTls};
    use std::sync::{Arc,atomic::{AtomicUsize,Ordering},mpsc};
    let mut initial=fixture(true);
    let tx=initial.store_mut().transaction().unwrap();
    let namespace:String=tx.test_postgres_tx().query("SELECT current_schema()::text",&[]).unwrap()[0].get(0);tx.rollback().unwrap();
    let id=initial.store().store_identity().unwrap().unwrap();drop(initial);
    let connection=std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut lease=StoreLease::connect(&connection,&namespace,&id,"b001",LeasePolicy::default()).unwrap();assert!(lease.acquire().unwrap().is_some());
    let engine=Engine::open(AnyStore::open_postgres_owned(&connection,&namespace,&lease).unwrap()).unwrap();
    let head=engine.seq().unwrap();let mut queue=Queue::start_fixed(engine,64,32).unwrap();queue.hold_lease(lease,Duration::from_millis(500)).unwrap();
    let mut control=Client::connect(&connection,NoTls).unwrap();control.batch_execute(&format!("SET search_path={namespace},pg_catalog;SET statement_timeout='10s'")).unwrap();
    let key=crate::ids::seed() as i64;control.query_one("SELECT pg_advisory_lock($1)",&[&key]).unwrap();
    control.batch_execute(&format!("CREATE FUNCTION overlay_commit_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('statement_timeout')<>'0' THEN RAISE EXCEPTION 'cancellable COMMIT';END IF;PERFORM pg_advisory_xact_lock({key});RETURN NEW;END $$;CREATE CONSTRAINT TRIGGER overlay_commit_barrier AFTER UPDATE ON r DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION overlay_commit_barrier()")).unwrap();
    let(entered,started)=mpsc::channel();let(release,resume)=mpsc::channel();let held=queue.submit(Command::new(move |_|{entered.send(()).unwrap();resume.recv_timeout(Duration::from_secs(10)).unwrap();})).unwrap();started.recv_timeout(Duration::from_secs(10)).unwrap();
    let invocation=|n|Invocation::new("increment",Some(format!("owned-{n}")),Context::new("alice",[("counter".into(),Value::Id("a".into()))].into()).at(1000));
    let callbacks=Arc::new(AtomicUsize::new(0));
    let replies=(0..8).map(|n|{let callbacks=callbacks.clone();queue.submit_program(ProgramCommand::new(invocation(n),move |_,out|{callbacks.fetch_add(1,Ordering::SeqCst);out})).unwrap()}).collect::<Vec<_>>();
    release.send(()).unwrap();held.wait().unwrap();
    let until=Instant::now()+Duration::from_secs(10);
    let pid=loop{if let Some(row)=control.query_opt("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND query='COMMIT' AND wait_event='advisory'",&[&format!("sb:{id}:b001:1")]).unwrap(){break row.get::<_,i32>(0);}assert!(Instant::now()<until);std::thread::sleep(Duration::from_millis(5));};
    eprintln!("overlay witness owns writer backend PID {pid}");
    assert_eq!(callbacks.load(Ordering::SeqCst),0);assert_eq!(control.query_one("SELECT seq FROM _head",&[]).unwrap().get::<_,i64>(0),head as i64);
    assert!(control.query_one("SELECT pg_terminate_backend($1)",&[&pid]).unwrap().get::<_,bool>(0));
    for reply in replies {assert_eq!(reply.wait().unwrap().unwrap_err().code,"E_COMMIT_OUTCOME_UNKNOWN");}
    drop(queue);control.query_one("SELECT pg_advisory_unlock($1)",&[&key]).unwrap();control.batch_execute("DROP TRIGGER overlay_commit_barrier ON r;DROP FUNCTION overlay_commit_barrier()").unwrap();
    let mut successor=StoreLease::connect(&connection,&namespace,&id,"b002",LeasePolicy::default()).unwrap();assert!(successor.acquire().unwrap().is_some());
    let mut engine=Engine::open(AnyStore::open_postgres_owned(&connection,&namespace,&successor).unwrap()).unwrap();assert_eq!(engine.seq().unwrap(),head);
    for n in 0..8 {assert!(!engine.invoke_program(&mut invocation(n)).unwrap().outcome.replayed);}
    for n in 0..8 {assert!(engine.invoke_program(&mut invocation(n)).unwrap().outcome.replayed);}
    assert_eq!(engine.seq().unwrap(),head+8);drop(engine);assert!(successor.release().unwrap());
    assert!(control.query_opt("SELECT pid FROM pg_stat_activity WHERE pid=$1",&[&pid]).unwrap().is_none());
}
