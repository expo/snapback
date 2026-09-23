//! Final-state authorization: later grants, revocations, rewrites and deletes.
use super::*;
use snapback4_core::{Ceilings, RuntimeError, Value, engine::local, rows::Rows};
use snapback4_device::store::DeviceTx;

const SOURCE: &str = r#"
table groups:
  public 'timing control groups'
  insert <- allow
  sync public
table notes:
  owner: principal
  groupId: groups
  body: text <=100
  by byGroup: groupId, id
  read <- exists grants[.groupId, viewer]
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to grants[.groupId] by .principal
table grants:
  groupId: groups
  principal: principal
  unique byGroupPrincipal: groupId, principal
  by byPrincipalGroup: principal, groupId, id
  read <- .principal = viewer
  insert <- .principal = viewer and created groups[.groupId]
  delete <- .principal = viewer
  sync to .principal
mutation grantLater():
  insert groups { id: 'group' }
  insert notes { id: 'note', owner: viewer, groupId: 'group', body: 'first' }
  update notes['note'] { body: 'middle' }
  update notes['note'] { body: 'final' }
  insert grants { id: 'grant', groupId: 'group', principal: viewer }
mutation grantOnce():
  insert groups { id: 'group' }
  insert notes { id: 'note', owner: viewer, groupId: 'group', body: 'final' }
  insert grants { id: 'grant', groupId: 'group', principal: viewer }
mutation revokeLater():
  insert groups { id: 'group' }
  insert grants { id: 'grant', groupId: 'group', principal: viewer }
  insert notes { id: 'note', owner: viewer, groupId: 'group', body: 'final' }
  delete grants['grant']
mutation transient():
  insert notes { id: 'note', owner: viewer, groupId: 'group', body: 'unreadable' }
  delete notes['note']
query note():
  return notes['note']
"#;

fn lifecycle<H: Host>(mut host: H, op: &str, predicts: bool, survives: bool) {
    let (mut engine, backend)=compile(SOURCE);
    let mut device=host.open("timing",Some(backend)).unwrap();
    for (n,page) in snapshot_pages(&mut engine,"alice",100).iter().enumerate() { device.apply(page,n==0).unwrap(); }
    let queued=admit(&mut device,op,json!({}));
    assert_eq!(queued.predictable,predicts,"{} {op}: {queued:?}",host.label());
    if !predicts { assert!(queued.predicted.is_empty()); }
    let pending=device.query("note","alice",&json!({}),100).unwrap().data;
    if survives { assert_eq!(pending.field("body").unwrap(),&Value::String("final".into())); }
    else { assert_eq!(pending,Value::Null); }
    host.close("timing",device);
    let mut device=host.open("timing",None).unwrap();
    assert_eq!(device.queued().unwrap()[0].predictable,predicts);
    assert_eq!(device.query("note","alice",&json!({}),100).unwrap().data,pending);
    let from=device.state().unwrap().0;
    device.apply(&stream_page(&mut engine,"alice",from),false).unwrap();
    assert_eq!(device.queued().unwrap()[0].predictable,predicts,"replay");
    assert_eq!(device.query("note","alice",&json!({}),100).unwrap().data,pending);
    let seq=sent(&mut engine,op,json!({}),queued.new_ids);
    device.settle(&queued.id,Some(seq)).unwrap();
    let from=device.state().unwrap().0;
    device.apply(&stream_page(&mut engine,"alice",from),false).unwrap();
    assert!(device.queued().unwrap().is_empty());
    let settled=device.query("note","alice",&json!({}),100).unwrap().data;
    if survives { assert_eq!(settled.field("body").unwrap(),&Value::String("final".into())); }
    else { assert_eq!(settled,Value::Null); }
    assert_eq!(engine.store().rows("notes").unwrap().len(),usize::from(op!="transient"));
}

#[test] fn grant_later_memory() { lifecycle(Memory::new(),"grantLater",true,true); }
#[test] fn grant_later_sqlite() { lifecycle(Sqlite::new("grant-later"),"grantLater",true,true); }
#[test] fn revoke_later_memory() { lifecycle(Memory::new(),"revokeLater",false,false); }
#[test] fn revoke_later_sqlite() { lifecycle(Sqlite::new("revoke-later"),"revokeLater",false,false); }
#[test] fn write_then_delete_memory() { lifecycle(Memory::new(),"transient",true,false); }
#[test] fn write_then_delete_sqlite() { lifecycle(Sqlite::new("write-delete"),"transient",true,false); }

fn probes<S: DeviceStore>(mut store: S) {
    let (_,backend)=compile(SOURCE);
    store.install(&backend.schema,&Default::default(),false).unwrap();
    for (op,budget,accepted) in [("grantOnce",0,false),("grantOnce",1,true),("grantLater",2,true),("transient",0,true)] {
        let tx=store.transaction().unwrap();
        let program=backend.programs.iter().find(|p|p.name==op).unwrap();
        let prediction=local::predict(&tx,&backend.schema,program,context("alice",&[]).at(100),Ceilings { rule_probes:budget,..Default::default() });
        assert_eq!(prediction.is_ok(),accepted,"{op}/{budget}: {prediction:?}");
        if !accepted { assert!(matches!(prediction,Err(RuntimeError::Prediction(_))),"probe exhaustion queues: {prediction:?}"); }
        if op=="transient" { assert!(tx.get("notes","note").unwrap().is_none()); }
        tx.rollback().unwrap();
    }
}
#[test] fn final_probes_once_memory() { probes(snapback4_device::memory::MemoryStore::new()); }
#[test] fn final_probes_once_sqlite() { probes(snapback4_core::Store::memory().unwrap()); }
