//! Read-time authorization: final state and the reading operation's meter.
use super::*;
use snapback4_core::{Ceilings, RuntimeError, Value, engine::local, rows::{Rows, Bounds, Dir}, schema::{Table, Index}};
use snapback4_device::store::DeviceTx;

const SOURCE: &str = r#"
table ticks:
  public 'replay witness'
  insert <- allow
  sync public
mutation tick():
  insert ticks { id: new }
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
  insert grants { id: 'grant', groupId: 'group', principal: viewer }
  update notes['note'] { body: 'middle' }
  update notes['note'] { body: 'final' }
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
    sent(&mut engine,"tick",json!({}),vec![]);
    let page=stream_page(&mut engine,"alice",from);
    assert!(!page.events.is_empty() && page.watermark>from);
    device.apply(&page,false).unwrap();
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
#[test] fn grant_once_memory() { lifecycle(Memory::new(),"grantOnce",true,true); }
#[test] fn grant_once_sqlite() { lifecycle(Sqlite::new("grant-once"),"grantOnce",true,true); }
#[test] fn revoke_later_memory() { lifecycle(Memory::new(),"revokeLater",true,false); }
#[test] fn revoke_later_sqlite() { lifecycle(Sqlite::new("revoke-later"),"revokeLater",true,false); }
#[test] fn write_then_delete_memory() { lifecycle(Memory::new(),"transient",true,false); }
#[test] fn write_then_delete_sqlite() { lifecycle(Sqlite::new("write-delete"),"transient",true,false); }

// A local query's provenance comes from its host; exercise the same query
// against both underlying stores with a zero/one-probe ceiling.
pub(super) struct Overlay<'a>(pub(super) &'a dyn Rows);
impl Rows for Overlay<'_> {
    fn provisional_row(&self,_:&str,_:&Value)->Result<bool,RuntimeError>{Ok(true)}
    fn get(&self,t:&str,id:&str)->Result<Option<Value>,RuntimeError>{self.0.get(t,id)}
    fn lookup(&self,t:&str,n:&str,i:&Index,k:&[Value])->Result<Option<Value>,RuntimeError>{self.0.lookup(t,n,i,k)}
    fn scan(&self,t:&str,n:&str,k:&[Value],b:&Bounds,d:Dir,l:usize)->Result<Vec<(Value,Vec<u8>)>,RuntimeError>{self.0.scan(t,n,k,b,d,l)}
    fn count_prefix(&self,t:&str,n:&str,k:&[Value],l:u64)->Result<u64,RuntimeError>{self.0.count_prefix(t,n,k,l)}
    fn put(&self,t:&str,d:&Table,r:&Value,o:Option<&Value>)->Result<u64,RuntimeError>{self.0.put(t,d,r,o)}
    fn delete(&self,t:&str,d:&Table,r:&Value)->Result<u64,RuntimeError>{self.0.delete(t,d,r)}
}
fn probes<S:DeviceStore>(mut store:S) {
    let (_,b)=compile(super::regressions::SOURCE);
    store.install(&b.schema,&Default::default(),false).unwrap();
    let program=|name:&str| b.programs.iter().find(|p|p.name==name).unwrap();
    let tx=store.transaction().unwrap();
    // Five unique-key authorization reservations precede occupant lookup,
    // even for a miss. No output-read authorization is added.
    local::predict(&tx,&b.schema,program("publish"),context("alice",&[]).at(100),Ceilings{rule_probes:5,..Default::default()}).unwrap();
    let mut engine=Engine::memory(b.schema.clone(),b.programs.clone()).unwrap();
    let mut rows=Vec::new();
    for (name,table) in &b.schema.tables {
        rows.extend(tx.scan(name,"byId",&[],&Default::default(),Dir::Asc,100).unwrap().into_iter().map(|(row,_)|(name.clone(),row)));
        assert!(table.index("byId").is_some());
    }
    engine.seed(rows).unwrap();
    for name in ["point","scan","merged","page","total","probe"] {
        for budget in [0,1,2] {
            let out=local::query(&Overlay(&tx),&b.schema,program(name),context("alice",if name=="page" {&[("c",Value::Null)]} else {&[]}).at(100),Ceilings{rule_probes:budget,..Default::default()});
            let out=out.unwrap();
            engine.set_ceilings(Ceilings{rule_probes:budget,..Default::default()});
            let server=engine.query(name,context("alice",if name=="page" {&[("c",Value::Null)]} else {&[]}).at(100)).unwrap();
            assert_eq!(out.data,server.data,"{name}/{budget}");
            assert_eq!(out.complete,server.complete,"{name}/{budget}");
            assert_eq!(out.cut,server.cut,"{name}/{budget}");
            assert_eq!(out.metered.rule_probes,server.metered.rule_probes,"{name}/{budget}");
            if !server.complete {
                assert!(out.capped_at.is_some(),"{name}: {out:?}");
            }
        }
    }
    // Delivered and provisional point reads reserve the same declared witness
    // count; trusting delivery avoids physical re-evaluation, not admission.
    let out=local::query(&tx,&b.schema,program("point"),context("alice",&[]).at(100),Ceilings{rule_probes:1,..Default::default()}).unwrap();
    assert!(out.complete && out.data!=Value::Null);
    assert_eq!(out.metered.rule_probes,1);
    // @ref LLP 3000.007#20.24.6 — one uniform prefix admission covers several
    // provisional candidates, while each still checks current physical authority.
    let second = snapback4_core::value::object([
        ("id", id("second")), ("groupId", id("group")), ("owner", id("bob")),
        ("body", Value::String("other pending row".into())),
    ]);
    tx.put("notes", &b.schema.tables["notes"], &second, None).unwrap();
    for name in ["scan", "page"] {
        let out=local::query(&Overlay(&tx),&b.schema,program(name),context("alice",if name=="page" {&[("c",Value::Null)]} else {&[]}).at(100),Ceilings{rule_probes:1,..Default::default()}).unwrap();
        assert!(out.complete && out.cut.is_none(), "{name}: {out:?}");
        assert_eq!(out.metered.rule_probes,1);
        assert_eq!(out.data.as_array().unwrap().len(),2);
    }
    tx.rollback().unwrap();
}
#[test] fn reading_probe_meter_memory(){probes(snapback4_device::memory::MemoryStore::new());}
#[test] fn reading_probe_meter_sqlite(){
    let host=Sqlite::new("reading-probes");
    probes(snapback4_core::Store::open(&host.path("meter")).unwrap());
}
