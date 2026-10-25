//! RT6 witnesses over the serving adapter, not the RT5 statement model.
#[path = "serving_regressions.rs"]
mod regressions;
// @ref LLP 3000.009.001.000.001#35-each-command-keeps-its-own-place — every folded flight fails before COMMIT and retains post-lock visibility.
use crate::{Context, Engine, Value, identity, engine::DeliveryManifest, store_port::AnyStore};
use postgres::{Client, NoTls};
use std::{cell::RefCell, sync::mpsc, thread, time::{Duration,Instant}};

thread_local! { static ADOPTION_HOOK: RefCell<Option<Box<dyn FnOnce()>>> = RefCell::new(None); static FAULT: RefCell<Option<(usize,usize,bool)>> = const { RefCell::new(None) }; }
pub(in crate::engine::postgres) fn after_head() {
    let hook=ADOPTION_HOOK.with(|s|s.borrow_mut().take());
    if let Some(hook)=hook {hook();}
}
pub(in crate::engine::postgres) fn inject(sql: &mut String) {
    FAULT.with(|slot| {
        let mut slot = slot.borrow_mut();
        let Some((remaining,at,fired)) = slot.as_mut() else {return;};
        if *fired {return;}
        if *remaining != 0 { *remaining -= 1; return; }
        let tail = sql.rsplit_once(';').map_or(sql.as_str(), |(_,tail)|tail);
        let commands = sql.bytes().filter(|b| *b == b';').count() + usize::from(!tail.trim().is_empty());
        assert!(*at <= commands, "fault boundary {at} exceeds {commands} commands");
        let offset = if *at == 0 {0} else if *at == commands {sql.len()} else {sql.match_indices(';').nth(*at-1).unwrap().0+1};
        sql.insert_str(offset,"; SELECT 1/0; SELECT nextval('_rt6_after_failure');");
        *fired = true;
    });
}
fn fail<T>(flight: usize, at: usize, run: impl FnOnce()->T) -> T {
    struct Reset;
    impl Drop for Reset { fn drop(&mut self) {FAULT.with(|s|{s.borrow_mut().take();});} }
    FAULT.with(|s|*s.borrow_mut()=Some((flight,at,false)));
    let _reset = Reset;
    let result=run();
    assert!(FAULT.with(|s|s.borrow().as_ref().unwrap().2),"flight {flight} was never sent");
    result
}
fn url() -> String {std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private PG16")}
fn fixture() -> (Engine,Client,String,String) { fixture_for_reads(false) }
fn fixture_for_reads(fallback:bool) -> (Engine,Client,String,String) {
    let name=format!("rt6_serving_{:x}",crate::ids::seed());
    // An unrelated, empty lifetime table is a real conservative fallback,
    // without changing the read program or bypassing either planner in tests.
    let source=format!("{}{}",include_str!("../../../../../reports/20261022-rt-a-round-trips/admitted-s1.q"),if fallback {"\ntable unusedTimed:\n  at: time\n  expire at .at\n  public\n"}else{""});
    let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let schema=serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap();
    let programs:Vec<crate::Program>=b.programs.into_iter().map(|p|serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect();
    let mut e=Engine::new_at(AnyStore::create_postgres(&url(),&name).unwrap(),schema,programs,1000).unwrap();
    let session=identity::open_session(e.store(),"alice","guest",1000).unwrap();
    e.mutate("setup",None,Context::new("alice",Default::default()).at(1000)).unwrap();
    for n in 0..25 {e.mutate("seedMessage",None,Context::new("alice",[("key".into(),Value::Id(format!("m{n}"))),("at".into(),Value::Int(n))].into()).at(1000)).unwrap();}
    let mut c=Client::connect(&url(),NoTls).unwrap();
    c.batch_execute(&format!("SET search_path={name},pg_catalog; CREATE SEQUENCE _rt6_after_failure")).unwrap();
    (e,c,name,identity::session_digest(&session.token))
}
fn context() -> Context {Context::new("alice",[("counter".into(),Value::Id("c0000".into()))].into()).at(1000).with_request_credential("guest")}
fn sample() -> identity::ServiceSample {identity::ServiceSample{now:1000,supervisor_revision:0}}
fn mutate(e:&mut Engine,d:&str,id:Option<&str>) -> Result<crate::engine::MutationAcknowledgement,crate::Refusal> {
    e.mutate_authorized("increment",id,context(),d,sample,|a| {assert_eq!(a.capability.unwrap().0,"alice");Ok(())})
}
fn census(c:&mut Client) -> Vec<Vec<String>> {
    ["SELECT seq::pg_catalog.text FROM _head ORDER BY singleton", "SELECT json_build_array(t,id,data)::pg_catalog.text FROM r ORDER BY t,id",
    "SELECT json_build_array(principal,id,seq,outcome,name,args_digest,at)::pg_catalog.text FROM _ops ORDER BY principal,id",
    "SELECT json_build_array(seq,at,program,principal,kind,touched,writes)::pg_catalog.text FROM _commits ORDER BY seq",
    "SELECT json_build_array(partition,seq,ord,t,kind,id,data)::pg_catalog.text FROM _log ORDER BY partition,seq,ord",
    "SELECT json_build_array(seq,footprint)::pg_catalog.text FROM _change_evidence ORDER BY seq"]
    .iter().map(|sql|c.query(*sql,&[]).unwrap().iter().map(|r|r.get(0)).collect()).collect()
}
fn no_later(c:&mut Client) {assert!(!c.query_one("SELECT is_called FROM _rt6_after_failure",&[]).unwrap().get::<_,bool>(0));}

#[test]
#[ignore="private PG16; scripts/test-postgres.sh"]
fn rt6_statement_failure_inside_every_serving_fold() {
    let (mut e,mut c,_,digest)=fixture();
    let before=census(&mut c);
    // BEGIN/raising owner/head/generation/authority/receipt/placement; savepoints/read;
    // UPDATE; post-update read; release/receipt insert/bind/tail/member release/settings. Every command
    // boundary includes an error plus a nontransactional later-command sentinel.
    for (flight,commands) in [(0,6),(1,3),(2,1),(3,1),(4,7)] {
        for at in 0..=commands {
            assert!(fail(flight,at,||mutate(&mut e,&digest,Some("faulted"))).is_err(),"flight {flight}, at {at}");
            assert_eq!(census(&mut c),before,"flight {flight}, at {at}"); no_later(&mut c);
        }
    }
    let check_reads=|e:&mut Engine,c:&mut Client,digest:&str,fallback:bool| {
    let before=census(c);
    let reads: Vec<(&str,usize,usize,std::collections::BTreeMap<String,Value>)> = if fallback {vec![
        ("W1",0,3,[("message".into(),Value::Id("m24".into()))].into()),
        ("W1",1,2,[("message".into(),Value::Id("m24".into()))].into()),
        ("W2",0,5,[("room".into(),Value::Id("r0001".into()))].into()),
    ]}else{vec![
        ("W1",0,3,[("message".into(),Value::Id("m24".into()))].into()),
        ("W2",0,3,[("room".into(),Value::Id("r0001".into()))].into()),
    ]};
    for (op,flight,commands,args) in reads {
        for at in 0..=commands {
            let ctx=Context::new("alice",args.clone()).at(1000).with_request_credential("guest");
            let plan=super::super::read_plan::Plan::new(e.schema(),e.program(op).unwrap(),&ctx).unwrap();
            assert_eq!(matches!(plan,super::super::read_plan::Plan::Composed(_)),!fallback);
            let expected=e.query_materialized_search_with_request(op,ctx.clone().with_request_credential("reference"),None,DeliveryManifest::Skip,&digest,|snap,_|{snap.request_authority(&digest,sample())?;Ok(())}).0;
            assert!(expected.is_ok());
            let (out,_,_)=fail(flight,at,||e.query_materialized_search_with_request(op,ctx,None,DeliveryManifest::Skip,&digest,|snap,_|{snap.request_authority(&digest,sample())?;Ok(())}));
            if fallback { assert!(out.is_err(),"{op} fallback={fallback}, flight {flight}, at {at}"); }
            else { assert_eq!(out,expected,"failed composition must reopen ordinary access: {op}, flight {flight}, at {at}"); }
            assert_eq!(census(c),before);no_later(c);
        }
    }
    };
    check_reads(&mut e,&mut c,&digest,false);
    let(mut fallback,mut fallback_c,_,fallback_digest)=fixture_for_reads(true);
    check_reads(&mut fallback,&mut fallback_c,&fallback_digest,true);
    for at in 0..=4 {
        let result=fail(0,at,||identity::with_request_preflight(e.store(),&digest,sample(),true,Some(("alice","faulted")),|s|s.replay_bound("alice","faulted","increment",&serde_json::json!({"counter":"c0000"}))));
        assert!(result.is_err());assert_eq!(census(&mut c),before);no_later(&mut c);
    }
}

#[test]
#[ignore="private PG16; scripts/test-postgres.sh"]
fn rt6_zero_row_tail_refuses_before_commit() {
    let (mut e,mut c,_,digest)=fixture();let before=census(&mut c);
    c.batch_execute("CREATE FUNCTION _rt6_zero() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL; END$$; CREATE TRIGGER _rt6_zero BEFORE INSERT ON _commits FOR EACH ROW EXECUTE FUNCTION _rt6_zero()").unwrap();
    let error=mutate(&mut e,&digest,Some("zero-tail")).unwrap_err();
    assert_eq!(error.code,"E_STORE");assert_eq!(census(&mut c),before);
}
fn pid(e:&mut Engine) -> i32 {e.store_mut().test_postgres_handle_mut().store.get_mut().client.query_one("SELECT pg_backend_pid()",&[]).unwrap().get(0)}
fn wait_for(c:&mut Client,waiter:i32,holder:i32) {
    let until=Instant::now()+Duration::from_secs(10);
    loop {
        if c.query_one("SELECT $2=ANY(pg_blocking_pids($1))",&[&waiter,&holder]).unwrap().get::<_,bool>(0) {break;}
        assert!(Instant::now()<until,"contender was not observed waiting on holder");thread::sleep(Duration::from_millis(5));
    }
}
#[test]
#[ignore="private PG16; scripts/test-postgres.sh"]
fn rt6_generation_refreshes_after_observed_head_wait() {
    let (mut holder,mut c,name,digest)=fixture();
    let mut waiter=Engine::open_at(AnyStore::open_postgres(&url(),&name).unwrap(),1000).unwrap();
    let holder_pid=pid(&mut holder);let waiter_pid=pid(&mut waiter);
    let before=c.query_one("SELECT data FROM r WHERE t='counters' AND id='c0000'",&[]).unwrap().get::<_,String>(0);
    let source=format!("{}\nquery nextGeneration():\n  return 1\n",include_str!("../../../../../reports/20261022-rt-a-round-trips/admitted-s1.q"));
    let b=snapback4_lang::compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty());
    let (ready_tx,ready_rx)=mpsc::channel();let (release_tx,release_rx)=mpsc::channel();
    let adoption=thread::spawn(move||{
        ADOPTION_HOOK.with(|s|*s.borrow_mut()=Some(Box::new(move||{ready_tx.send(()).unwrap();release_rx.recv().unwrap();})));
        let schema=serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap();
        let programs:Vec<crate::Program>=b.programs.into_iter().map(|p|serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect();
        holder.adopt(schema,programs)
    });
    ready_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    let task=thread::spawn(move||mutate(&mut waiter,&digest,Some("old-generation")));
    wait_for(&mut c,waiter_pid,holder_pid);
    // Cold setup preparation must not retain session relation locks ahead of
    // the head. A physical upgrade remains possible while the waiter waits.
    c.batch_execute("BEGIN; LOCK TABLE _sessions IN ACCESS EXCLUSIVE MODE NOWAIT; ROLLBACK").unwrap();
    release_tx.send(()).unwrap();
    assert_eq!(adoption.join().unwrap().unwrap(),2);
    assert_eq!(task.join().unwrap().unwrap_err().code,"E_GENERATION");
    assert_eq!(c.query_one("SELECT data FROM r WHERE t='counters' AND id='c0000'",&[]).unwrap().get::<_,String>(0),before);
    assert_eq!(c.query_one("SELECT count(*) FROM _ops WHERE id='old-generation'",&[]).unwrap().get::<_,i64>(0),0);
    assert_eq!(c.query_one("SELECT count(*) FROM _commits WHERE program='increment'",&[]).unwrap().get::<_,i64>(0),0);

}
#[test]
#[ignore="private PG16; scripts/test-postgres.sh"]
fn rt6_receipt_refreshes_after_observed_head_wait() {
    let (mut holder,mut c,name,digest)=fixture();
    let mut waiter=Engine::open_at(AnyStore::open_postgres(&url(),&name).unwrap(),1000).unwrap();
    let holder_pid=pid(&mut holder);let waiter_pid=pid(&mut waiter);
    let (ready_tx,ready_rx)=mpsc::channel();let (release_tx,release_rx)=mpsc::channel();let d=digest.clone();
    let first=thread::spawn(move||holder.mutate_authorized("increment",Some("concurrent"),context(),&d,sample,|_|{ready_tx.send(()).unwrap();release_rx.recv().unwrap();Ok(())}));
    ready_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    let second=thread::spawn(move||mutate(&mut waiter,&digest,Some("concurrent")));
    wait_for(&mut c,waiter_pid,holder_pid);release_tx.send(()).unwrap();
    let first=first.join().unwrap().unwrap();let second=second.join().unwrap().unwrap();
    assert!(!first.outcome.replayed);assert!(second.outcome.replayed);assert_eq!(first.outcome.receipt(Some("concurrent")),second.outcome.receipt(Some("concurrent")));
    assert_eq!(c.query_one("SELECT count(*) FROM _ops WHERE id='concurrent'",&[]).unwrap().get::<_,i64>(0),1);
    assert_eq!(c.query_one("SELECT count(*) FROM _commits WHERE program='increment'",&[]).unwrap().get::<_,i64>(0),1);
    assert_eq!(c.query_one("SELECT count(*) FROM _change_evidence WHERE seq=(SELECT seq FROM _head)",&[]).unwrap().get::<_,i64>(0),1);
}
#[test]
#[ignore="private PG16; scripts/test-postgres.sh"]
fn rt6_owner_is_first_lock_and_failed_fence_never_reaches_head() {
    let (mut e,mut c,_,digest)=fixture();let waiter=pid(&mut e);
    let holder_pid=c.query_one("SELECT pg_backend_pid()",&[]).unwrap().get::<_,i32>(0);
    let mut lock=c.transaction().unwrap();lock.query("SELECT token FROM _owner WHERE singleton FOR UPDATE",&[]).unwrap();
    let task=thread::spawn(move||mutate(&mut e,&digest,Some("stale-owner")));
    let mut observer=Client::connect(&url(),NoTls).unwrap();wait_for(&mut observer,waiter,holder_pid);
    // Use the holder's same namespace without taking a writer opener/head.
    lock.query("SELECT seq FROM _head WHERE singleton FOR UPDATE NOWAIT",&[]).unwrap();
    lock.execute("UPDATE _owner SET token=token+1 WHERE singleton",&[]).unwrap();lock.commit().unwrap();
    let why=task.join().unwrap().unwrap_err();assert_eq!(why.code,"E_STORE_OWNERSHIP");assert!(why.retryable);
    assert_eq!(c.query_one("SELECT count(*) FROM _ops WHERE id='stale-owner'",&[]).unwrap().get::<_,i64>(0),0);
}

#[test]
#[ignore="private PG16; scripts/test-postgres.sh"]
fn rt6_connection_settings_are_pinned_on_every_connection_path() {
    let (_e,_c,name,_digest)=fixture();
    for owned in [false,true] {
        let mut config: postgres::Config=url().parse().unwrap();
        config.options("-c client_encoding=SQL_ASCII -c extra_float_digits=0 -c bytea_output=escape -c default_transaction_read_only=on");
        let mut client=if owned {super::super::ownership::connect(config).unwrap().0} else {config.connect(NoTls).unwrap()};
        client.batch_execute(&format!("SET search_path={name},pg_catalog")).unwrap();
        let mut store=super::super::store::Store::new(client);
        let tx=store.transaction(None).unwrap();
        let r=tx.query("SELECT pg_catalog.current_setting('client_encoding'),pg_catalog.current_setting('extra_float_digits'),pg_catalog.current_setting('bytea_output')",&[]).unwrap();
        assert_eq!((r[0].get::<_,&str>(0),r[0].get::<_,&str>(1),r[0].get::<_,&str>(2)),("UTF8","3","hex"));
        tx.rollback().unwrap();
        for mode in [super::super::store::WriteMode::Serialized,super::super::store::WriteMode::Serializable] {
            let tx=store.transaction(Some(mode)).unwrap();
            let r=tx.query("SELECT pg_catalog.current_setting('transaction_read_only')",&[]).unwrap();
            assert_eq!(r[0].get::<_,&str>(0),"off");
            assert_eq!(tx.execute("UPDATE _head SET seq=seq WHERE singleton",&[]).unwrap(),1);
            tx.rollback().unwrap();
        }
    }
}
#[test]
#[ignore="private PG16; scripts/test-postgres.sh"]
fn rt6_encoder_bind_difftest_uses_serving_statements_and_full_tail() {
    use super::super::{literal::{self,Prepared,Datum},read_plan,receipts,assets,authority,tail};
    let (mut e,mut c,namespace,digest)=fixture();
    // The qualified session must repair these hostile settings before decoding.
    c.batch_execute("SET client_encoding='SQL_ASCII'; SET extra_float_digits=0; SET bytea_output='escape'; SET standard_conforming_strings=off").unwrap();
    literal::configure(&mut c).unwrap();
    c.batch_execute(super::super::store::READ_SESSIONS_DDL).unwrap();
    let shadow=super::shadows(&mut c);
    c.batch_execute(&format!("SET search_path={shadow},{namespace},pg_catalog")).unwrap();
    c.batch_execute("BEGIN").unwrap();
    for (n,sql) in [authority::session_facts_sql(false),authority::session_facts_sql(true)].into_iter().enumerate() {
        let p=Prepared::new(&mut c,&format!("rt6_authority_{n}"),sql).unwrap();super::check(&mut c,&p,&[&digest]);
    }
    for (n,sql) in ["SELECT seq FROM _head WHERE singleton FOR UPDATE","SELECT generation FROM _backend WHERE singleton"].into_iter().enumerate() {
        let p=Prepared::new(&mut c,&format!("rt6_meta_{n}"),sql).unwrap();super::check(&mut c,&p,&[]);
    }
    let p=Prepared::new(&mut c,"rt6_point",read_plan::GET).unwrap();super::check(&mut c,&p,&[&"messages",&"m24"]);
    let p=Prepared::new(&mut c,"rt6_receipt",receipts::LOOKUP).unwrap();super::check(&mut c,&p,&[&"alice",&"absent"]);
    let p=Prepared::new(&mut c,"rt6_placement",assets::PLACEMENT).unwrap();super::check(&mut c,&p,&[&"alice",&"absent"]);
    for (n,(table,columns,key,sql)) in [
        ("memberships",vec!["room","principal"],vec![Value::Id("r0001".into()),Value::Id("alice".into())],read_plan::ASC),
        ("messages",vec!["room","at","id"],vec![Value::Id("r0001".into())],read_plan::DESC),
    ].into_iter().enumerate() {
        let index=e.schema().tables[table].indexes.iter().find(|(_,i)|i.columns().iter().map(String::as_str).eq(columns.iter().copied())).unwrap().0;
        let lo=crate::key::encode(&key);let hi=crate::key::upper_bound(&lo);
        let p=Prepared::new(&mut c,&format!("rt6_scan_{n}"),sql).unwrap();super::check(&mut c,&p,&[&table,index,&lo,&hi,&21i64]);
    }
    let p=Prepared::new(&mut c,"rt6_update","UPDATE r SET data = $3 WHERE t = $1 AND id = $2").unwrap();
    let data=c.query_one("SELECT data FROM r WHERE t='counters' AND id='c0000'",&[]).unwrap().get::<_,String>(0);
    super::check(&mut c,&p,&[&"counters",&"c0000",&data]);
    let p=Prepared::new(&mut c,"rt6_tail",tail::SQL).unwrap();
    assert_eq!(p.bind.params().len(),27,"includes current change-evidence arguments");
    let seq=c.query_one("SELECT seq+1 FROM _head WHERE singleton",&[]).unwrap().get::<_,i64>(0);
    let text="O'Reilly \\ π e\u{301}\n";
    let partitions=vec!["rt6/p"];let ords=vec![0i64];let tables=vec!["counters"];let kinds=vec!["put"];let ids=vec!["c0000"];let images=vec![Some(data.as_str())];
    let effects=vec!["effect1"];let names=vec!["notify"];let payloads=vec!["{}"];
    let next=vec![None::<i64>];let work=vec!["{}"];let deadlines=vec![Some(i64::MAX)];let contracts=vec![text];
    let principals=vec!["alice"];let presence=vec!["effect1"];let expires=vec![2000i64];let explicit=vec![true];let releases=vec![None::<&str>];
    let args:&[&(dyn postgres::types::ToSql+Sync)]=&[&seq,&1000i64,&text,&"alice",&"mutation",&"[]",&1i64,&partitions,&ords,&tables,&kinds,&ids,&images,&effects,&names,&payloads,&next,&work,&deadlines,&contracts,&principals,&presence,&expires,&explicit,&releases,&"{}",&0i64];
    c.batch_execute("SAVEPOINT native_tail").unwrap();
    let native=c.query(&p.bind,args).unwrap();assert_eq!(native.len(),1);
    let counts:Vec<_>=(0..5).map(|column|native[0].get::<_,i64>(column)).collect();
    assert_eq!(counts,vec![1;5],"commit, evidence, log, effect and presence counts");let expected=census(&mut c);
    c.batch_execute("ROLLBACK TO native_tail; RELEASE native_tail; SAVEPOINT literal_tail").unwrap();
    let messages=c.simple_query(&p.command(args).unwrap()).unwrap();assert_eq!(p.rows(&messages).unwrap(),vec![counts.into_iter().map(Datum::Int).collect::<Vec<_>>()]);
    assert_eq!(census(&mut c),expected,"head, rows, receipts, commits, logs and change evidence");
    c.batch_execute("ROLLBACK").unwrap();
    // Native execute ignores result payloads, including excluded output types.
    // Keep that behavior through Bind instead of trying the text decoder.
    let tx=e.store_mut().read_transaction().unwrap();
    assert_eq!(tx.test_postgres_tx().execute("SELECT 1::pg_catalog.numeric",&[]).unwrap(),1);
    tx.rollback().unwrap();
}
#[test]
#[ignore="private PG16; scripts/test-postgres.sh"]
fn rt6_nul_poison_is_terminal_in_folded_commands_and_tail_arrays() {
    use crate::{partition::PartitionRows,rows::Rows};
    let (mut e,mut c,_,digest)=fixture();let before=census(&mut c);
    let bad="bad\0text";let low=vec![1u8];let high=vec![2u8];let limit=1i64;
    let cases:Vec<(&str,&'static str,Vec<&(dyn postgres::types::ToSql+Sync)>)>=vec![
        ("authority",super::super::authority::session_facts_sql(false),vec![&bad]),
        ("receipt",super::super::receipts::LOOKUP,vec![&bad,&"id"]),
        ("placement",super::super::assets::PLACEMENT,vec![&bad,&"id"]),
        ("point",super::super::read_plan::GET,vec![&bad,&"id"]),
        ("membership",super::super::read_plan::ASC,vec![&bad,&"index",&low,&high,&limit]),
        ("page",super::super::read_plan::DESC,vec![&bad,&"index",&low,&high,&limit]),
        ("update","UPDATE r SET data = $3 WHERE t = $1 AND id = $2",vec![&"counters",&"c0000",&bad]),
    ];
    // Covers each parameterized serving-flight template. Owner/head/generation
    // and transaction controls have only adapter constants or integer values.
    for (name,sql,params) in cases {
        let owner=e.store_mut().transaction().unwrap();let tx=owner.test_postgres_tx();
        tx.execute("UPDATE r SET data=data WHERE t='counters'",&[]).unwrap();
        let safe:&[&(dyn postgres::types::ToSql+Sync)]=&[&digest];
        let error=tx.flight(&[(sql,&params),(super::super::authority::session_facts_sql(false),safe)],"").err().unwrap();assert_eq!(error.code(),"E_INPUT","{name}");
        assert_eq!(tx.rollback_program().unwrap_err().code(),"E_INPUT");assert_eq!(owner.commit().unwrap_err().code(),"E_INPUT");assert_eq!(census(&mut c),before);
    }
    let owner=e.store_mut().transaction().unwrap();let tx=owner.test_postgres_tx();let seq=owner.next_seq().unwrap();
    let row=Rows::get(&owner,"counters","c0000").unwrap().unwrap();
    tx.record_commit(seq,1000,"increment","alice","mutation",&["counters".into()],1).unwrap();
    tx.append_log("bad\0partition",seq,0,"counters","put","c0000",Some(&crate::value::canonical_json(&row))).unwrap();
    assert_eq!(tx.flush_tail().unwrap_err().code(),"E_INPUT");assert_eq!(owner.commit().unwrap_err().code(),"E_INPUT");assert_eq!(census(&mut c),before);
}

#[test]
#[ignore="private PG16; scripts/test-postgres.sh"]
fn rt6_serving_parity_with_sqlite_rows_receipts_and_change_evidence() {
    let (mut pg,_,_,pg_digest)=fixture();
    let mut sqlite=Engine::new_at(AnyStore::memory().unwrap(),pg.schema.clone(),pg.programs.values().cloned(),1000).unwrap();
    let session=identity::open_session(sqlite.store(),"alice","guest",1000).unwrap();let digest=identity::session_digest(&session.token);
    sqlite.mutate("setup",None,Context::new("alice",Default::default()).at(1000)).unwrap();
    for n in 0..25 {sqlite.mutate("seedMessage",None,Context::new("alice",[("key".into(),Value::Id(format!("m{n}"))),("at".into(),Value::Int(n))].into()).at(1000)).unwrap();}
    for n in 0..4 {
        let id=format!("parity-{n}");let left=mutate(&mut sqlite,&digest,Some(&id)).unwrap();let right=mutate(&mut pg,&pg_digest,Some(&id)).unwrap();
        assert_eq!(left.outcome,right.outcome);assert_eq!(left.publication.unwrap().preserved,right.publication.unwrap().preserved);
        let receipt=|e:&Engine,d:&str|identity::with_request_preflight(e.store(),d,sample(),true,Some(("alice",&id)),|s|s.replay_bound("alice",&id,"increment",&serde_json::json!({"counter":"c0000"}))).unwrap().unwrap();
        assert_eq!(receipt(&sqlite,&digest),receipt(&pg,&pg_digest));
        for (op,arg,value) in [("W1","message","m24"),("W2","room","r0001")] {
            let query=|e:&mut Engine,d:&str|{
                let context=Context::new("alice",[(arg.into(),Value::Id(value.into()))].into()).at(1000).with_request_credential("guest");
                e.query_materialized_search_with_request(op,context,None,DeliveryManifest::Skip,d,|s,_|{s.request_authority(d,sample())?;Ok(())}).0.unwrap()
            };
            assert_eq!(query(&mut sqlite,&digest),query(&mut pg,&pg_digest),"{op} data and logical meters");
        }
    }
    for t in ["users","rooms","memberships","messages","counters"] {assert_eq!(sqlite.store().rows(t).unwrap(),pg.store().rows(t).unwrap());}
    assert_eq!(serde_json::to_value(sqlite.store().footprint_between(26,30)).unwrap(),serde_json::to_value(pg.store().footprint_between(26,30)).unwrap());
}

#[test]
#[ignore="private PG16; scripts/test-postgres.sh"]
fn rt6_encoder_scratch_refusal_poison_rolls_back_prior_writes() {
    use super::super::{literal,flight};
    let (mut e,mut c,_,_)=fixture();let before=census(&mut c);
    let text="x".repeat(flight::ENCODED_LIMIT/2);
    assert_eq!(literal::encode(&literal::Datum::Text(text.clone()),&postgres::types::Type::TEXT).unwrap_err().code(),"E_INPUT");
    assert_eq!(literal::parameter(&vec![true;2_000_000],&postgres::types::Type::BOOL_ARRAY).unwrap_err().code(),"E_INPUT");
    let owner=e.store_mut().transaction().unwrap();let tx=owner.test_postgres_tx();
    tx.execute("UPDATE r SET data=data WHERE t='counters'",&[]).unwrap();
    let error=tx.flight(&[(super::super::authority::session_facts_sql(false),&[&text])],"").err().unwrap();
    assert_eq!(error.code(),"E_INPUT");assert_eq!(owner.commit().unwrap_err().code(),"E_INPUT");assert_eq!(census(&mut c),before);
}


#[test]
fn rt6_planner_rejects_arguments_shadowed_by_local_bindings() {
    use crate::ir::{Stmt,Expr};
    let b=snapback4_lang::compile(&[("schema.q".into(),include_str!("../../../../../reports/20261022-rt-a-round-trips/admitted-s1.q").into())]);
    let schema=serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap();
    let programs:Vec<crate::Program>=b.programs.into_iter().map(|p|serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect();
    for (name,arg,value) in [("W1","message","m24"),("W2","room","r0001")] {
        let context=Context::new("alice",[(arg.into(),Value::Id(value.into()))].into()).with_request_credential("guest");
        let mut program=programs.iter().find(|p|p.name.ends_with(name)).unwrap().clone();
        assert!(super::super::read_plan::Plan::new(&schema,&program,&context).is_some(),"{name} fits the unchanged physical prefetch bound");
        program.body.insert(0,Stmt::Let{name:arg.into(),value:Expr::Literal(Value::Id("different".into()))});
        assert!(super::super::read_plan::Plan::new(&schema,&program,&context).is_none(),"{name}: use the ordinary interpreter/store path after shadowing");
    }
}

#[test]
#[ignore = "private PG16"]
fn r1_raising_owner_check_cannot_use_a_shadow_text_comparison() {
    let (mut engine, mut observer, name, digest) = fixture();
    observer.batch_execute(&format!("CREATE FUNCTION {name}.r1_equal(pg_catalog.text,pg_catalog.text) RETURNS pg_catalog.bool LANGUAGE sql AS 'SELECT true'; CREATE OPERATOR {name}.= (LEFTARG=pg_catalog.text,RIGHTARG=pg_catalog.text,FUNCTION={name}.r1_equal); UPDATE _owner SET store_id='11111111111111111111111111111111' WHERE singleton")).unwrap();
    let before = census(&mut observer);
    let outcome = mutate(&mut engine, &digest, Some("shadow-owner"));
    assert_eq!(outcome.unwrap_err().code, "E_STORE_OWNERSHIP");
    assert_eq!(census(&mut observer), before, "a refused owner cannot reach application commands");
}

#[test]
#[ignore = "private PG16"]
fn r1_fused_owner_wait_uses_the_remaining_program_budget() {
    let (mut engine, mut observer, _, digest) = fixture();
    let waiter = pid(&mut engine);
    let holder = observer.query_one("SELECT pg_backend_pid()", &[]).unwrap().get::<_, i32>(0);
    let mut held = observer.transaction().unwrap();
    held.query("SELECT token FROM _owner WHERE singleton FOR UPDATE", &[]).unwrap();
    let (sent, received) = mpsc::channel();
    let worker = thread::spawn(move || {
        let store = engine.store_mut().test_postgres_handle_mut().store.get_mut();
        store.next_program_deadline = Some(Instant::now() + Duration::from_millis(100));
        let refused = store.request_transaction(&digest, "alice", None).is_err();
        sent.send(refused).unwrap();
    });
    let mut census = Client::connect(&url(), NoTls).unwrap();
    wait_for(&mut census, waiter, holder);
    // The owner remains locked: a refusal must come from the original budget,
    // not from releasing the lock or a timing-only slow-query assumption.
    let bounded = received.recv_timeout(Duration::from_secs(1));
    held.rollback().unwrap(); worker.join().unwrap();
    assert_eq!(bounded.ok(), Some(true), "the fused owner fence ignored the program's remaining budget");
}
