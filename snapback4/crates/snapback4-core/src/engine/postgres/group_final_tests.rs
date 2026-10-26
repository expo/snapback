//! G7.3 checks actual server suppression, the dispatch window and cancellation.
use super::*;
use super::super::{group_commit, group_tail, tail};
use crate::engine::committer::overlay::Image;
use postgres::{Client,NoTls};

fn fixture() -> crate::Engine { crate::engine::program_batch::tests::fixture(true) }
fn observer(engine: &mut crate::Engine) -> Client {
    let store=engine.store_mut().test_postgres_handle_mut().store.get_mut();
    let schema:String=store.client.query_one("SELECT current_schema()",&[]).unwrap().get(0);
    let mut client=Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),NoTls).unwrap();
    client.batch_execute(&format!("SET search_path={schema},pg_catalog")).unwrap();client
}
fn stage(store: &mut Store) -> Tx<'_> {
    let tx=store.batch_transaction().unwrap();
    let ticket=tx.batch_ticket.unwrap();
    let mut sets=tx.flight(&[(group_commit::TICKET,&[&ticket]),(group_commit::HEAD,&[])],"").unwrap();
    tx.accept_batch_head(&sets.remove(1).rows[0]).unwrap();
    let seq=tx.group_head.get().unwrap()+1;
    let image=crate::Value::Row([("id".into(),crate::Value::Id("a".into())),("n".into(),crate::Value::Int(1))].into_iter().collect());
    tx.group_images.borrow_mut().push(Image{table:"counters".into(),old:image.clone(),new:image});
    tx.group_tails.borrow_mut().push(tail::Tail {
        commit:Some(tail::Commit{seq,at:1000,program:"wf".into(),principal:"alice".into(),kind:"mutation".into(),touched:"[]".into(),writes:1,footprint:"[]".into()}),
        partitions:vec!["public".into()],ords:vec![0],tables:vec!["counters".into()],kinds:vec!["put".into()],ids:vec!["a".into()],data:vec![Some("{}".into())],
        receipts:vec![group_tail::Receipt{principal:"alice".into(),id:"wf-op".into(),seq,outcome:"{}".into(),name:Some("wf".into()),args_digest:None,at:1000}],
        effects:vec![tail::Effect{id:"wf-effect".into(),effect:"notify".into(),payload:"{}".into(),next_at:None,work:"{}".into(),deadline:None,contract:"{}".into(),presence:vec![("alice".into(),5000)],release:None}],
    });tx
}
fn status(client: &mut Client,xid: &str) -> String {client.query_one("SELECT pg_xact_status($1::text::xid8)",&[&xid]).unwrap().get(0)}
#[test]
#[ignore="private Postgres"]
fn g73_every_suppressed_tail_count_raises_and_skips_commit() {
    for (table,event) in [("_head","UPDATE"),("r","UPDATE"),("_commits","INSERT"),("_change_evidence","INSERT"),("_log","INSERT"),("_outbox","INSERT"),("_effect_presence","INSERT"),("_ops","INSERT")] {
        let mut engine=fixture();let mut client=observer(&mut engine);
        client.batch_execute(&format!("CREATE FUNCTION wf_suppress() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$;CREATE TRIGGER wf_suppress BEFORE {event} ON {table} FOR EACH ROW EXECUTE FUNCTION wf_suppress()")).unwrap();
        let before:i64=client.query_one("SELECT seq FROM _head WHERE singleton",&[]).unwrap().get(0);
        let store=engine.store_mut().test_postgres_handle_mut().store.get_mut();
        let tx=stage(store);let xid=tx.batch_base.borrow().as_ref().unwrap().xid.clone();
        let failure=tx.commit_group_final().expect_err(table);
        drop(tx);
        assert_eq!(status(&mut client,&xid),"aborted","{table}: COMMIT must have been skipped");
        assert!(failure.aborted,"{table}: {}",failure.error);
        assert!(matches!(&failure.error,RuntimeError::Postgres(e) if e.code().is_some_and(|c|c.code()=="S4003")),"{table}: {}",failure.error);
        assert_eq!(client.query_one("SELECT seq FROM _head WHERE singleton",&[]).unwrap().get::<_,i64>(0),before);
        let counts=client.query_one("SELECT (SELECT count(*) FROM _ops WHERE id='wf-op'),(SELECT count(*) FROM _outbox WHERE id='wf-effect')",&[]).unwrap();assert_eq!((counts.get::<_,i64>(0),counts.get::<_,i64>(1)),(0,0));
    }
}
#[test]
#[ignore="private Postgres"]
fn g73_ticket_timeout_skips_commit_and_slow_commit_survives_reset() {
    let mut engine=fixture();let mut client=observer(&mut engine);
    let ticket=919230743i64;client.query_one("SELECT pg_advisory_lock($1)",&[&ticket]).unwrap();
    let store=engine.store_mut().test_postgres_handle_mut().store.get_mut();let mut tx=stage(store);
    let xid=tx.batch_base.borrow().as_ref().unwrap().xid.clone();
    tx.predecessor_ticket=Some(ticket);tx.program_deadline.set(Some(std::time::Instant::now()+std::time::Duration::from_millis(40)));
    let failure=tx.commit_group_final().unwrap_err();assert!(failure.aborted);assert!(format!("{}",failure.error).contains("ticket deadline"));drop(tx);
    assert_eq!(status(&mut client,&xid),"aborted");client.query_one("SELECT pg_advisory_unlock($1)",&[&ticket]).unwrap();
    client.batch_execute("CREATE FUNCTION wf_slow() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END $f$; CREATE CONSTRAINT TRIGGER wf_slow AFTER UPDATE ON _head DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wf_slow()").unwrap();
    let version:i32=client.query_one("SELECT current_setting('server_version_num')::int",&[]).unwrap().get(0);
    let store=engine.store_mut().test_postgres_handle_mut().store.get_mut();
    if version>=170000 {store.client.batch_execute("SET transaction_timeout='80ms'").unwrap();}
    let tx=stage(store);let xid=tx.batch_base.borrow().as_ref().unwrap().xid.clone();
    tx.program_deadline.set(Some(std::time::Instant::now()+std::time::Duration::from_millis(60)));
    let started=std::time::Instant::now();tx.commit_group_final().map_err(|f|f.error).unwrap();assert!(started.elapsed()>=std::time::Duration::from_millis(150));drop(tx);assert_eq!(status(&mut client,&xid),"committed");
    if version>=170000 {assert_eq!(store.client.query_one("SHOW transaction_timeout",&[]).unwrap().get::<_,String>(0),"80ms");store.client.batch_execute("RESET transaction_timeout").unwrap();}
}
#[test]
#[ignore="private Postgres"]
fn g73_identity_raises_before_any_tail_or_commit() {
    for change in ["UPDATE _backend SET generation=generation+1 WHERE singleton", "UPDATE _meta SET value='replaced' WHERE key='store_id'"] {
        let mut engine=fixture();let mut client=observer(&mut engine);
        let store=engine.store_mut().test_postgres_handle_mut().store.get_mut();let tx=stage(store);let xid=tx.batch_base.borrow().as_ref().unwrap().xid.clone();client.batch_execute(change).unwrap();
        let failure=tx.commit_group_final().unwrap_err();assert!(failure.aborted);assert!(matches!(failure.error,RuntimeError::Generation(_)|RuntimeError::Structural{code:"E_STORE_REPLACED",..}));drop(tx);assert_eq!(status(&mut client,&xid),"aborted");
    }
}

#[test]
#[ignore="private Postgres"]
fn g73_backend_termination_during_trailing_commit_is_unknown() {
    let mut engine=fixture();let mut control=observer(&mut engine);let key=91237941i64;
    control.query_one("SELECT pg_advisory_lock($1)",&[&key]).unwrap();
    control.batch_execute(&format!("CREATE FUNCTION wf_hold_commit() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock({key}); RETURN NEW; END $f$; CREATE CONSTRAINT TRIGGER wf_hold_commit AFTER UPDATE ON _head DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wf_hold_commit()")).unwrap();
    let (send,receive)=std::sync::mpsc::channel();
    let worker=std::thread::spawn(move || {
        let store=engine.store_mut().test_postgres_handle_mut().store.get_mut();
        let pid:i32=store.client.query_one("SELECT pg_backend_pid()",&[]).unwrap().get(0);
        let tx=stage(store);let xid=tx.batch_base.borrow().as_ref().unwrap().xid.clone();
        send.send((pid,xid)).unwrap();tx.commit_group_final().unwrap_err()
    });
    let (pid,xid)=receive.recv_timeout(std::time::Duration::from_secs(10)).unwrap();
    let until=std::time::Instant::now()+std::time::Duration::from_secs(10);
    while !control.query_one("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND backend_xid::text=$2 AND state='active' AND wait_event='advisory')",&[&pid,&xid]).unwrap().get::<_,bool>(0) {
        assert!(std::time::Instant::now()<until);std::thread::sleep(std::time::Duration::from_millis(1));
    }
    eprintln!("G73 owned backend PID {pid}");
    assert!(control.query_one("SELECT pg_terminate_backend($1)",&[&pid]).unwrap().get::<_,bool>(0));
    let failure=worker.join().unwrap();assert!(!failure.aborted);assert!(matches!(failure.error,RuntimeError::CommitOutcomeUnknown(_)));
    while control.query_one("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1)",&[&pid]).unwrap().get::<_,bool>(0) {
        assert!(std::time::Instant::now()<until);std::thread::sleep(std::time::Duration::from_millis(1));
    }
    assert_eq!(status(&mut control,&xid),"aborted");
    assert_eq!(control.query_one("SELECT count(*) FROM _ops WHERE id='wf-op'",&[]).unwrap().get::<_,i64>(0),0);
}
