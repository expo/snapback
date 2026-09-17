//! Repeatable device diet hot paths. Keep the base test executable to pair
//! it with the candidate executable on the same machine, alternating order.
use serde_json::json;
use snapback4_device::{device::{Backend, Device}, memory::{Change, MemoryStore}};
use snapback4_core::value::{object, Value};
use std::time::Instant;

#[test]
#[ignore]
fn diet_hot_paths() {
    let compiled = snapback4_lang::compile(&[("chat.q".into(), include_str!("../../../apps/chat/snapback/schema.q").into())]);
    let backend = Backend { generation: 1, schema: compiled.schema, programs: compiled.programs.into_iter().map(|p| p.program).collect() };
    let fresh = Device::open_store(MemoryStore::new(), Some(backend.clone())).unwrap();
    let mut kept = fresh.store().drain();
    for n in 0..100_000 {
        let id = format!("msg{n:06}");
        let row = object([("id", Value::Id(id.clone())), ("conversationId", Value::Id("c1".into())), ("authorId", Value::Id("dev:alice".into())), ("body", Value::String(format!("message {n}"))), ("at", Value::Int(n))]);
        kept.push(Change { s: 'r', k: serde_json::to_string(&("messages", id)).unwrap(), v: Some(serde_json::to_string(&row).unwrap()) });
    }
    let kept = serde_json::to_string(&kept).unwrap();
    let request = json!({"op":"apply", "first":true, "page":{"snapshot":true,"events":(0..4000).map(|n| json!({"table":"messages","kind":"put","id":format!("msg{n:06}"),"data":{"id":format!("msg{n:06}"),"conversationId":"c1","authorId":"dev:alice","body":format!("message {n}"),"at":n}})).collect::<Vec<_>>(),"watermark":1,"generation":1,"more":false}}).to_string();
    let mut apply = Vec::new();
    let mut open = Vec::new();
    for _ in 0..7 {
        let mut device = Device::open_store(MemoryStore::new(), Some(backend.clone())).unwrap();
        let start = Instant::now();
        let reply = snapback4_device::call::call_text(&mut device, &request);
        assert!(reply.get("denied").is_none(), "{reply}");
        apply.push(start.elapsed().as_secs_f64() * 1000.0);
        let start = Instant::now();
        let changes: Vec<Change> = snapback4_core::json_codec::from_text(&kept).unwrap();
        let mut store = MemoryStore::new();
        store.load(changes).unwrap();
        let device = Device::open_store(store, None).unwrap();
        open.push(start.elapsed().as_secs_f64() * 1000.0);
        assert!(!device.store().drain().iter().any(|c| c.s == 'r'));
    }
    println!("apply_4000_ms={apply:?}; cold_open_100000_ms={open:?}");
    apply.sort_by(f64::total_cmp); open.sort_by(f64::total_cmp);
    println!("median N=7 apply_4000_ms={:.3} cold_open_100000_ms={:.3}", apply[3], open[3]);
}
