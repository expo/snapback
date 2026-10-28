//! Real PG witnesses; no environment mutation or simulated database snapshots.
use super::*;
use std::{sync::mpsc, thread};

fn enable(e: &Engine) { e.revision_cache.read_index.enabled.store(true, Ordering::Relaxed); }

#[test]
#[ignore = "private PG16"]
fn read_index_exact_hits_and_authority_and_ryw() {
    let (mut writer,d,v)=fixture(true); enable(&writer);
    let mut reader=writer.reader().unwrap();
    for name in ["W1","W2","W3"] {
        let expected=warm(&mut reader,&d,&v,name,SessionScope::Full);
        let before=reader.revision_cache_stats();
        let scope=Scope::begin();
        assert_eq!(read(&mut reader,&d,&v,name,true,SessionScope::Full,1001).unwrap(),expected);
        assert_eq!(scope.counts().postgres,1); drop(scope);
        assert_eq!(reader.revision_cache_stats().read_index_hits,before.read_index_hits+1);
    }
    let before=warm(&mut reader,&d,&v,"W1",SessionScope::Full);
    let mut row=before.data.clone(); let Value::Row(fields)=&mut row else {panic!()};
    fields.insert("body".into(),Value::String("acknowledged own write".into()));
    sql(&mut writer,"UPDATE r SET data=$1 WHERE t='messages' AND id='m0000-0'",&[&crate::value::canonical_json(&row)]);
    assert_eq!(read(&mut reader,&d,&v,"W1",true,SessionScope::Full,1001).unwrap().data,row);
    warm(&mut reader,&d,&v,"W1",SessionScope::Full);
    sql(&mut writer,"DELETE FROM _sessions WHERE token_digest=$1",&[&d]);
    assert!(read(&mut reader,&d,&v,"W1",true,SessionScope::Full,1001).is_err());
}

#[test]
#[ignore = "private PG16"]
fn read_index_foreign_commit_after_old_snapshot_cannot_join_that_round() {
    let (writer,d,v)=fixture(true); enable(&writer);
    let mut reader=writer.reader().unwrap();
    let old=warm(&mut reader,&d,&v,"W1",SessionScope::Full);
    let ri=writer.revision_cache.clone();
    let mut proof_reader=writer.reader().unwrap();
    let (sent,received)=mpsc::channel(); let (release,held)=mpsc::channel();
    let leader={let cache=ri.clone();thread::spawn(move||cache.read_index.validate(std::time::Instant::now()+std::time::Duration::from_secs(10),|| {
        let proof=proof_reader.store.read_index_validation();
        assert!(proof.is_some());sent.send(()).unwrap(); held.recv().unwrap();proof
    }))};
    received.recv().unwrap(); // real old database snapshot has returned
    // A separately attached engine commits, then explicitly acknowledges.
    let mut writer=writer;
    let namespace:String=writer.store_mut().test_postgres_handle_mut().store.get_mut().client.query_one("SELECT current_schema()",&[]).unwrap().get(0);
    let url=std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut foreign=Engine::open_at(crate::store_port::AnyStore::open_postgres(&url,&namespace).unwrap(),1000).unwrap();
    let mut row=old.data;let Value::Row(fields)=&mut row else {panic!()};fields.insert("body".into(),Value::String("foreign ACK before invocation".into()));
    sql(&mut foreign,"UPDATE r SET data=$1 WHERE t='messages' AND id='m0000-0'",&[&crate::value::canonical_json(&row)]);
    let expected=row.clone();
    let read=thread::spawn(move||read(&mut reader,&d,&v,"W1",true,SessionScope::Full,1001).unwrap());
    let deadline=std::time::Instant::now()+std::time::Duration::from_secs(5);
    loop {
        if ri.read_index.pending_for_test() {break;}
        assert!(std::time::Instant::now()<deadline);thread::yield_now();
    }
    release.send(()).unwrap();leader.join().unwrap();
    assert_eq!(read.join().unwrap().data,expected);
}

#[test]
#[ignore = "private PG16"]
fn read_index_takeover_and_uncertainty_keep_existing_g5_policy() {
    use crate::store_port::{AnyStore,StoreLease,LeasePolicy};
    let (mut bootstrap,d,v)=fixture(true);
    let namespace:String=bootstrap.store_mut().test_postgres_handle_mut().store.get_mut().client.query_one("SELECT current_schema()",&[]).unwrap().get(0);
    let id=bootstrap.store_id.clone(); drop(bootstrap);
    let url=std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut lease=StoreLease::connect(&url,&namespace,&id,"6666",LeasePolicy{lease:std::time::Duration::from_secs(30),..Default::default()}).unwrap();
    assert!(lease.acquire().unwrap().is_some());
    let writer=Engine::open_at(AnyStore::open_postgres_owned(&url,&namespace,&lease).unwrap(),1000).unwrap();
    enable(&writer);
    let mut reader=writer.reader().unwrap();
    warm(&mut reader,&d,&v,"W1",SessionScope::Full);
    assert!(reader.revision_cache_stats().read_index_hits>0);
    let mut control=postgres::Client::connect(&url,postgres::NoTls).unwrap();
    // Deliberately corrupt only this private fixture's catalog as well: the
    // admitted production owner layout correctly declares holder NOT NULL.
    control.batch_execute(&format!("ALTER TABLE \"{namespace}\"._owner ALTER COLUMN holder DROP NOT NULL; UPDATE \"{namespace}\"._owner SET holder=NULL WHERE singleton")).unwrap();
    let before=reader.revision_cache_stats().read_index_hits;
    read(&mut reader,&d,&v,"W1",true,SessionScope::Full,1001).unwrap();
    assert_eq!(reader.revision_cache_stats().read_index_hits,before,"missing owner identity takes ordinary G5 without panicking");
    control.batch_execute(&format!("UPDATE \"{namespace}\"._owner SET holder='6666' WHERE singleton; ALTER TABLE \"{namespace}\"._owner ALTER COLUMN holder SET NOT NULL")).unwrap();
    let grant=reader.store.read_grant().unwrap();
    grant.uncertain.store(true,Ordering::Release);
    let before=reader.revision_cache_stats();
    read(&mut reader,&d,&v,"W1",true,SessionScope::Full,1001).unwrap();
    assert_eq!(reader.revision_cache_stats().read_index_hits,before.read_index_hits);
    assert_eq!(reader.revision_cache_stats().read_index_rounds,before.read_index_rounds);
    drop((reader,writer)); assert!(lease.release().unwrap());
    // The full existing takeover witness also runs with RI enabled in the
    // process-wide private-PG suite, including a successor's session revocation.
}

#[test]
#[ignore = "private PG16"]
fn g5r2_detached_candidate_ryw_and_uncertainty_recheck() {
    let (mut bootstrap,d,v)=fixture(true);
    let namespace:String=bootstrap.store_mut().test_postgres_handle_mut().store.get_mut().client.query_one("SELECT current_schema()",&[]).unwrap().get(0);
    let id=bootstrap.store_id.clone();drop(bootstrap);
    let url=std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut lease=crate::store_port::StoreLease::connect(&url,&namespace,&id,"a001",Default::default()).unwrap();
    lease.acquire().unwrap().unwrap();
    let mut writer=Engine::open_at(crate::store_port::AnyStore::open_postgres_owned(&url,&namespace,&lease).unwrap(),1000).unwrap();
    enable(&writer);
    let mut reader=writer.reader().unwrap();
    let old=warm(&mut reader,&d,&v,"W1",SessionScope::Full);
    let context=||Context::new(&v,args("W1")).at(1001).with_request_credential("account").with_revision_cache(true);
    let candidate=reader.prepare_read_index("W1",&context(),None,DeliveryManifest::Build,&d).unwrap();
    // The enrollee's reader is actually gone throughout the parked interval.
    drop(reader);
    let mut row=old.data;let Value::Row(fields)=&mut row else {panic!()};
    fields.insert("body".into(),Value::String("ACK while caller is parked".into()));
    sql(&mut writer,"UPDATE r SET data=$1 WHERE t='messages' AND id='m0000-0'",&[&crate::value::canonical_json(&row)]);
    let mut validator=writer.reader().unwrap();
    let validation=validator.validate_read_index();drop(validator);
    let mut reader=writer.reader().unwrap();
    let proof=candidate.complete(validation);
    let (out,_,_)=reader.query_materialized_search_with_read_index("W1",context(),None,DeliveryManifest::Build,&d,proof,|snapshot,_| {
        assert!(snapshot.request_authority(&d,identity::ServiceSample {now:1001,supervisor_revision:0}).unwrap().capability.is_some());Ok(())
    });
    assert_eq!(out.unwrap().data,row);
    warm(&mut reader,&d,&v,"W1",SessionScope::Full);
    let candidate=reader.prepare_read_index("W1",&context(),None,DeliveryManifest::Build,&d).unwrap();
    let validation=reader.validate_read_index();
    let grant=reader.store.read_grant().unwrap();
    grant.uncertain.store(true,Ordering::Release);
    let before=reader.revision_cache_stats().read_index_hits;
    let (out,_,_)=reader.query_materialized_search_with_read_index("W1",context(),None,DeliveryManifest::Build,&d,candidate.complete(validation),|_,_|Ok(()));
    assert!(out.is_ok(),"ordinary G5 retains its uncertainty policy");
    assert_eq!(reader.revision_cache_stats().read_index_hits,before,"a completed proof cannot reopen an uncertain cache epoch");
}


#[test]
#[ignore="private PG16"]
fn g5r2_completed_proof_cannot_certify_a_later_enrollment() {
    let (writer,d,v)=fixture(true);enable(&writer);
    let mut reader=writer.reader().unwrap();warm(&mut reader,&d,&v,"W1",SessionScope::Full);
    let completed=reader.validate_read_index().unwrap();
    let context=Context::new(&v,args("W1")).at(1001).with_request_credential("account").with_revision_cache(true);
    let later=reader.prepare_read_index("W1",&context,None,DeliveryManifest::Build,&d).unwrap();
    let proof=later.complete(Some(completed));
    let before=reader.revision_cache_stats().read_index_hits;
    let trips=Scope::begin();
    let (out,_,_)=reader.query_materialized_search_with_read_index("W1",context,None,DeliveryManifest::Build,&d,proof,|_,_|Ok(()));
    assert!(out.is_ok());
    assert_eq!(reader.revision_cache_stats().read_index_hits,before);
    assert_eq!(trips.counts().postgres,1,"a late enrollee needs an ordinary fresh G5 validation");
}


#[test]
#[ignore="private PG16"]
fn g5r2_candidate_probe_preserves_cold_probation() {
    let (writer,d,v)=fixture(true);enable(&writer);
    let mut reader=writer.reader().unwrap();
    let context=Context::new(&v,args("W1")).at(1001).with_request_credential("account").with_revision_cache(true);
    assert!(reader.prepare_read_index("W1",&context,None,DeliveryManifest::Build,&d).is_none());
    read(&mut reader,&d,&v,"W1",true,SessionScope::Full,1001).unwrap();
    assert_eq!(reader.revision_cache_stats().entries,0,"one real observation cannot admit a fill");
    read(&mut reader,&d,&v,"W1",true,SessionScope::Full,1001).unwrap();
    assert_eq!(reader.revision_cache_stats().entries,1,"the second real observation admits the ordinary fill");
}
