//! The public refusal must precede owning an out-of-envelope parent payload.
use snapback4_core::{Engine, Store, Value, engine::release::ReleaseActivation, value::object};
use std::{alloc::{GlobalAlloc, Layout, System}, sync::atomic::{AtomicBool, AtomicUsize, Ordering}};
static SERIAL:std::sync::Mutex<()>=std::sync::Mutex::new(());
struct LargestAllocation;
static WATCH: AtomicBool=AtomicBool::new(false);
static LARGEST: AtomicUsize=AtomicUsize::new(0);
fn record(n:usize) {if WATCH.load(Ordering::Relaxed) {LARGEST.fetch_max(n,Ordering::Relaxed);}}
unsafe impl GlobalAlloc for LargestAllocation {
    unsafe fn alloc(&self,layout:Layout)->*mut u8 {record(layout.size());unsafe {System.alloc(layout)}}
    unsafe fn alloc_zeroed(&self,layout:Layout)->*mut u8 {record(layout.size());unsafe {System.alloc_zeroed(layout)}}
    unsafe fn dealloc(&self,p:*mut u8,layout:Layout) {unsafe {System.dealloc(p,layout)}}
    unsafe fn realloc(&self,p:*mut u8,layout:Layout,n:usize)->*mut u8 {record(n);unsafe {System.realloc(p,layout,n)}}
}
#[global_allocator]
static ALLOCATOR:LargestAllocation=LargestAllocation;
fn build(source:&str)->snapback4_lang::Bound {
    let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b
}
#[test]
fn dormant_column_forward_check_admits_parent_before_fetch() {
    let _serial=SERIAL.lock().unwrap();
    let manual="table projects:\n  owner: principal\n  payload: text <=21000000 default ''\n  read <- .owner = viewer\n  online only\ntable tasks:\n  project: projects\n  owner: principal\n  memo: text <=8 default ''\n  body: text <=80\n  immutable project\n  cap 1 by project\n  read <- .owner = viewer\n  online only\n";
    let b=build(manual);let mut e=Engine::new_release(Store::memory().unwrap(),b.schema,b.programs.into_iter().map(|p|p.program),1,None).unwrap();
    e.seed([("projects".into(),object([("id",Value::Id("p".into())),("owner",Value::Id("alice".into()))])),("tasks".into(),object([("id",Value::Id("c".into())),("project",Value::Id("p".into())),("owner",Value::Id("alice".into())),("memo",Value::String("hello".into())),("body",Value::String("tiny".into()))]))]).unwrap();
    let b=build(&manual.replace("  memo: text <=8 default ''\n",""));e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();
    e.seed([("projects".into(),object([("id",Value::Id("p".into())),("payload",Value::String("x".repeat(20*1024*1024)))]))]).unwrap();
    let live=manual.replace("  owner: principal\n  memo:","  memo:").replace("  cap 1 by project\n  read <- .owner = viewer","  cap 1 by project\n  read through live .project");let b=build(&live);
    LARGEST.store(0,Ordering::SeqCst);WATCH.store(true,Ordering::SeqCst);
    let result=e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false);
    WATCH.store(false,Ordering::SeqCst);
    assert_eq!(result.unwrap_err().code(),"E_BOUND");assert_eq!(e.generation(),2);
    let largest=LARGEST.load(Ordering::SeqCst);assert!(largest<=snapback4_core::Ceilings::job().heap_bytes as usize,"owned {largest} bytes before refusal");
}

#[test]
fn narrowed_manual_forward_check_admits_parent_before_fetch() {
    let _serial=SERIAL.lock().unwrap();
    let manual="table projects:\n  owner: principal\n  payload: text <=5000000 default ''\n  read <- .owner = viewer\n  online only\ntable tasks:\n  project: projects\n  owner: principal\n  status: enum('active', 'draft') default 'draft'\n  body: text <=300000\n  immutable project\n  cap 1 by project\n  read <- .owner = viewer\n  online only\n";
    let b=build(manual);let mut e=Engine::new_release(Store::memory().unwrap(),b.schema,b.programs.into_iter().map(|p|p.program),1,None).unwrap();
    e.seed([("projects".into(),object([("id",Value::Id("p".into())),("owner",Value::Id("alice".into()))])),("tasks".into(),object([("id",Value::Id("c".into())),("project",Value::Id("p".into())),("owner",Value::Id("alice".into())),("body",Value::String("x".repeat(200000)))]))]).unwrap();
    let b=build(&manual.replace("enum('active', 'draft') default 'draft'","enum('active') default 'active'"));e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();
    e.seed([("projects".into(),object([("id",Value::Id("p".into())),("payload",Value::String("x".repeat(4*1024*1024)))]))]).unwrap();
    let independent="\ntable independentParents:\n  owner: principal\n  read <- .owner = viewer\n  online only\ntable independentChildren:\n  parent: independentParents\n  immutable parent\n  cap 1 by parent\n  read through live .parent\n  online only\n";
    let captured=manual.replace("  owner: principal\n  payload:","  owner: principal\n  immutable owner\n  payload:").replace("  cap 1 by project\n  read <- .owner = viewer","  cap 1 by project\n  read through .project");let b=build(&format!("{captured}{independent}"));
    LARGEST.store(0,Ordering::SeqCst);WATCH.store(true,Ordering::SeqCst);
    let result=e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false);
    WATCH.store(false,Ordering::SeqCst);
    assert_eq!(result.unwrap_err().code(),"E_BOUND");assert_eq!(e.generation(),2);
    let largest=LARGEST.load(Ordering::SeqCst);assert!(largest<1024*1024,"fetched parent before admission: {largest} bytes");
}
