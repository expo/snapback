//! The public refusal must precede owning an out-of-envelope parent payload.
use snapback4_core::{Engine, Store, Value, engine::release::ReleaseActivation, value::object};
use std::{alloc::{GlobalAlloc, Layout, System}, sync::atomic::{AtomicBool, AtomicUsize, Ordering}};
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
