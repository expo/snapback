//! Observe physical witness work, independently of its one-probe public meter.
mod common;
use common::*;
use std::cell::Cell;
use snapback4_core::{Ceilings, RuntimeError, Value, engine::{local, runner::Runner}, meter::{Cut, Meter}, rows::{Rows, Bounds, Dir}, schema::{Index, Table}, value::object};
use snapback4_device::{memory::MemoryStore, store::{DeviceStore, DeviceTx}};

struct Counted<'a> { rows: &'a dyn Rows, fetched: Cell<usize>, scans: Cell<usize> }
impl Counted<'_> {
    fn observed(&self, table: &str, rows: &[(Value, Vec<u8>)]) {
        if table == "receipts" { self.fetched.set(self.fetched.get()+rows.len()); self.scans.set(self.scans.get()+1); }
    }
}
impl Rows for Counted<'_> {
    fn get(&self,t:&str,id:&str)->Result<Option<Value>,RuntimeError>{self.rows.get(t,id)}
    fn lookup(&self,t:&str,n:&str,i:&Index,k:&[Value])->Result<Option<Value>,RuntimeError>{self.rows.lookup(t,n,i,k)}
    fn scan(&self,t:&str,n:&str,k:&[Value],b:&Bounds,d:Dir,l:usize)->Result<Vec<(Value,Vec<u8>)>,RuntimeError>{
        let rows=self.rows.scan(t,n,k,b,d,l)?; self.observed(t,&rows); Ok(rows)
    }
    fn scan_metered(&self,t:&str,n:&str,k:&[Value],b:&Bounds,d:Dir,l:usize,m:&mut Meter)->Result<Vec<(Value,Vec<u8>)>,RuntimeError>{
        let rows=self.rows.scan_metered(t,n,k,b,d,l,m)?; self.observed(t,&rows); Ok(rows)
    }
    fn count_prefix(&self,t:&str,n:&str,k:&[Value],l:u64)->Result<u64,RuntimeError>{self.rows.count_prefix(t,n,k,l)}
    fn put(&self,t:&str,s:&Table,r:&Value,o:Option<&Value>)->Result<u64,RuntimeError>{self.rows.put(t,s,r,o)}
    fn delete(&self,t:&str,s:&Table,r:&Value)->Result<u64,RuntimeError>{self.rows.delete(t,s,r)}
}

const SOURCE: &str = "table receipts:\n  group: id\n  principal: principal\n  selected: bool\n  expiresAt: time ?\n  expire at .expiresAt\n  read <- allow\n  sync public\nview counts: count receipts where .selected by .group, .principal\n  by byPrincipal: principal, group\ntable notes:\n  group: id\n  read <- exists counts[.group, viewer]\n  insert <- allow\n  sync to counts[.group] by .principal\nquery note():\n  return notes['note']\nmutation inspect():\n  insert notes { id: 'probe', group: 'group' }\n  return notes['probe']\n";

fn probe<S: DeviceStore>(mut store: S) {
    for backlog in [0,9000] {
        for live in [None,Some(Value::Int(200)),Some(Value::Null)] {
            let (mut server,backend)=compile(SOURCE);
            let receipt=|name: String, principal: &str, selected: bool, expiry: Value|("receipts".into(),object([
                ("id",id(&name)),("group",id("group")),("principal",id(principal)),("selected",Value::Bool(selected)),("expiresAt",expiry),
            ]));
            server.seed((0..backlog).map(|n|receipt(format!("expired{n:05}"),"alice",true,Value::Int(100)))
                .chain(live.clone().map(|expiry|receipt("live".into(),"alice",true,expiry)))
                .chain([receipt("other-group".into(),"bob",true,Value::Null),receipt("unselected".into(),"alice",false,Value::Null),
                    ("notes".into(),object([("id",id("note")),("group",id("group"))]))])).unwrap();
            store.install(&backend.schema,&Default::default(),false).unwrap();
            let tx=store.transaction().unwrap();
            for name in ["receipts","counts","notes"] {
                for row in server.store().rows(name).unwrap() {tx.put(name,&backend.schema.tables[name],&row,None).unwrap();}
            }
            let counted=Counted {rows:&tx,fetched:Cell::new(0),scans:Cell::new(0)};
            let program=backend.programs.iter().find(|p|p.name=="note").unwrap();
            for device in [false,true] {
                counted.fetched.set(0); counted.scans.set(0);
                let result=if device {
                    let mutation=backend.programs.iter().find(|p|p.name=="inspect").unwrap();
                    local::predict(&counted,&backend.schema,mutation,context("alice",&[]).at(100),Ceilings::default()).unwrap().result
                } else {
                    let mut runner=Runner::new(&counted,&backend.schema,context("alice",&[]).at(100),Meter::new(Ceilings::default(),Cut::Cap),0);
                    let result=runner.run(program).unwrap();
                    result
                };
                assert_eq!(result!=Value::Null,live.is_some(),"backlog={backlog} device={device}");
                assert_eq!(counted.fetched.get(),usize::from(live.is_some()),"physical backlog work, not just reported examination counts");
                assert!(counted.scans.get()<=1);
            }
            tx.rollback().unwrap();
        }
    }
}

#[test] fn probe_seeks_live_witness_memory() {probe(MemoryStore::new());}
#[test] fn probe_seeks_live_witness_sqlite() {probe(snapback4_core::Store::memory().unwrap());}
