//! Physical work and scratch ownership measured independently of the logical meter.
use snapback4_core::{Context, Engine, Value, Ceilings, WriteState};
use snapback4_core::engine::runner::Runner;
use snapback4_core::error::RuntimeError;
use snapback4_core::meter::{Cut, Meter};
use snapback4_core::rows::{Rows, Bounds, Dir};
use snapback4_core::schema::{Index, Table};
use snapback4_core::value::object;
use std::cell::Cell;
use std::collections::BTreeMap;

struct Allocator;
thread_local! {
    static MEASURING: Cell<bool> = const { Cell::new(false) };
    static LIVE: Cell<i64> = const { Cell::new(0) };
    static PEAK: Cell<i64> = const { Cell::new(0) };
}
fn allocation(delta: i64) {
    let _ = MEASURING.try_with(|on| if on.get() { LIVE.with(|live| { let n=live.get()+delta; live.set(n); PEAK.with(|p| p.set(p.get().max(n))); }); });
}
unsafe impl std::alloc::GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        let p=unsafe { std::alloc::System.alloc(layout) }; if !p.is_null() { allocation(layout.size() as i64); } p
    }
    unsafe fn dealloc(&self, p: *mut u8, layout: std::alloc::Layout) { allocation(-(layout.size() as i64)); unsafe { std::alloc::System.dealloc(p,layout) }; }
    unsafe fn realloc(&self, p: *mut u8, layout: std::alloc::Layout, size: usize) -> *mut u8 {
        let out=unsafe { std::alloc::System.realloc(p,layout,size) }; if !out.is_null() { allocation(size as i64-layout.size() as i64); } out
    }
}
#[global_allocator] static ALLOCATOR: Allocator = Allocator;

struct Counted<'a> { inner: &'a dyn Rows, source_rows: Cell<usize>, max_buffer_rows: Cell<usize>, buffer_bytes: Cell<u64>, occupancy_calls: Cell<usize> }
impl Rows for Counted<'_> {
    fn get(&self,t:&str,id:&str)->Result<Option<Value>,RuntimeError> { self.inner.get(t,id) }
    fn lookup(&self,t:&str,n:&str,i:&Index,k:&[Value])->Result<Option<Value>,RuntimeError> { self.inner.lookup(t,n,i,k) }
    fn scan(&self,t:&str,n:&str,p:&[Value],b:&Bounds,d:Dir,l:usize)->Result<Vec<(Value,Vec<u8>)>,RuntimeError> {
        let rows=self.inner.scan(t,n,p,b,d,l)?;
        if t=="posts" {
            self.source_rows.set(self.source_rows.get()+rows.len());
            self.max_buffer_rows.set(self.max_buffer_rows.get().max(rows.len()));
            self.buffer_bytes.set(self.buffer_bytes.get().max(rows.iter().map(|(r,k)|r.heap_bytes(&snapback4_core::Context::system().system_access().unwrap())+k.len() as u64).sum()));
        }
        Ok(rows)
    }
    fn count_prefix(&self,t:&str,n:&str,p:&[Value],l:u64)->Result<u64,RuntimeError> {
        let count=self.inner.count_prefix(t,n,p,l)?;
        if t=="posts" { self.source_rows.set(self.source_rows.get()+count as usize); self.occupancy_calls.set(self.occupancy_calls.get()+1); }
        Ok(count)
    }
    fn put(&self,t:&str,s:&Table,r:&Value,o:Option<&Value>)->Result<u64,RuntimeError> { self.inner.put(t,s,r,o) }
    fn delete(&self,t:&str,s:&Table,r:&Value)->Result<u64,RuntimeError> { self.inner.delete(t,s,r) }
}
const TEXT: &str = r#"
table posts:
  owner: principal
  selected: bool
  score: int
  until: time
  by byUntil: until
  expire at .until
  read <- .owner = viewer
  update <- allow
  online only
maintain totals: sum posts of score where .selected by owner
  read <- deny
  online only
mutation blind():
  update posts['hidden'] {selected: false, score: 0}
  return null
query total():
  return totals['owner']
"#;
fn world(selected: bool, present: bool, denied: bool, excluded: usize, filter: bool) -> Engine {
    let text=if denied { TEXT.replace("update <- allow","update <- deny") } else { TEXT.into() };
    let text=if filter { text } else { text.replace(" where .selected","") };
    let b=snapback4_lang::compile(&[("schema.q".into(),text)]); assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let row=|name:String,selected,score| ("posts".into(),object([("id",Value::Id(name)),("owner",Value::Id("owner".into())),("selected",Value::Bool(selected)),("score",Value::Int(score)),("until",Value::Int(3000))]));
    // One seed transaction in every world for identical watermarks.
    e.seed(std::iter::once(row(if present {"hidden"} else {"other"}.into(),selected,1)).chain((0..excluded).map(|n|row(format!("x{n:05}"),false,0)))).unwrap(); e
}
#[test]
fn review2_hidden_occupancy_has_bounded_physical_work_and_scratch() {
    for filter in [true,false] {
        for excluded in [9000,0] {
            let mut e=world(true,true,false,excluded,filter);
            let schema=e.schema().clone(); let program=e.program("blind").unwrap().clone();
            let tx=e.store_mut().transaction().unwrap();
            let rows=Counted { inner:&tx,source_rows:Cell::new(0),max_buffer_rows:Cell::new(0),buffer_bytes:Cell::new(0),occupancy_calls:Cell::new(0) };
            LIVE.with(|n|n.set(0)); PEAK.with(|n|n.set(0)); MEASURING.with(|on|on.set(true));
            let mut runner=Runner::new(&rows,&schema,Context::new("writer",BTreeMap::new()).at(1000),Meter::new(Ceilings::default(),Cut::Abort),2);
            let result=runner.run(&program); drop(runner);
            MEASURING.with(|on|on.set(false)); let peak=PEAK.with(Cell::get);
            println!("PHYSICAL filter={filter} excluded={excluded} source_rows={} max_buffer_rows={} buffer_bytes={} peak_allocated_bytes={peak} occupancy_calls={} result={result:?}",rows.source_rows.get(),rows.max_buffer_rows.get(),rows.buffer_bytes.get(),rows.occupancy_calls.get());
            assert!(result.is_ok(),"{result:?}");
            assert!(rows.source_rows.get()<=3,"source rows scanned {}",rows.source_rows.get());
            assert!(rows.max_buffer_rows.get()<=1);
            assert!(peak<65_536,"bounded interpreter allocation, independently measured: {peak}");
        }
    }
}

#[path="common/write_observation.rs"] mod observation;
#[test]
fn review2_hidden_and_absent_worlds_keep_identical_observations() {
    let run=|selected,present,denied,ceilings| {
        let mut e=world(selected,present,denied,9000,true); e.set_ceilings(ceilings);
        observation::observe(&mut e,"blind","writer",serde_json::json!({}),"blind",("total",serde_json::json!({}))).1
    };
    for limit in [None,Some(0),Some(4)] {
        let mut c=Ceilings::default(); if let Some(limit)=limit {c.examined=limit;}
        let a=run(true,true,false,c); let b=run(false,true,false,c);
        same(&a,&b);
        let absent=run(false,false,true,c); same(&absent,&run(true,true,true,c));
    }
    let mut e=world(true,true,false,9000,true);
    let out=e.mutate("blind",None,Context::new("writer",BTreeMap::new()).at(1000)).unwrap();
    assert!(matches!(out.state,WriteState::Sent {..}));
    println!("PREPAY {}",serde_json::to_string(&out.metered).unwrap());
}

fn same(a:&observation::Observation,b:&observation::Observation) {
    assert_eq!(a.first_http_body,b.first_http_body); assert_eq!(a.receipt,b.receipt); assert_eq!(a.retry_http_body,b.retry_http_body);
    assert_eq!(a.meter,b.meter); assert_eq!(a.effects,b.effects); assert_eq!(a.stream,b.stream); assert_eq!(a.snapshot,b.snapshot); assert_eq!(a.devices,b.devices);
}
