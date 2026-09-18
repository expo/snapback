//! B2a independently: replay refreshes the durable write set used by withdrawal.
mod common;
use common::*;
use snapback4_core::value::{Value, object};
use snapback4_device::device::{Device, Queued};
use snapback4_device::store::DeviceStore;

const SOURCE: &str = r#"
use personas alice, bob
table counters:
  n: int
  read <- allow
  update <- allow
  sync public
table selectors:
  target: counters
  read <- allow
  update <- allow
  sync public
query counter(counterId: counters):
  return counters[counterId]
mutation bumpSelected():
  s = selectors['selected'] ! else NOT_FOUND
  c = counters[s.target] ! else NOT_FOUND
  update counters[s.target] {n: c.n + 1}
mutation retargetAndBump():
  update selectors['selected'] {target: 'b'}
  c = counters['b'] ! else NOT_FOUND
  update counters['b'] {n: c.n + 1}
"#;

fn value<S: DeviceStore>(device: &mut Device<S>, row: &str) -> i64 {
    device.query("counter", "dev:alice", &serde_json::json!({"counterId":row}), 1000)
        .unwrap().data.field("n").unwrap().as_int().unwrap()
}

fn refresh<H: Host>(host: &mut H) {
    let (mut e, backend) = compile(SOURCE);
    e.seed([
        ("counters".into(), object([("id", id("a")), ("n", Value::Int(0))])),
        ("counters".into(), object([("id", id("b")), ("n", Value::Int(0))])),
        ("selectors".into(), object([("id", id("selected")), ("target", id("a"))])),
    ]).unwrap();
    let mut d = host.open("refresh", Some(backend)).unwrap();
    for (i,p) in snapshot_pages(&mut e, "dev:alice",100).iter().enumerate() { d.apply(p,i==0).unwrap(); }
    d.admit(Queued {id:"q".into(),seq:0,op:"bumpSelected".into(),args:serde_json::json!({}),new_ids:vec![],predicted:vec![],viewer:"dev:alice".into(),now:1000,predictable:true,sent_seq:None,observed_seq:None}).unwrap();
    assert_eq!(d.queued().unwrap()[0].predicted, ["counters/a"]);
    e.mutate("retargetAndBump",Some("bob"),context("dev:bob",&[]).at(1000)).unwrap();
    let capture=d.sync_state().unwrap();
    let p=stream_page(&mut e,"dev:alice",capture.watermark);
    assert_eq!(p.images_at,Some(p.watermark));
    d.apply(&p,false).unwrap();
    assert_eq!(d.queued().unwrap()[0].predicted,["counters/b"]);
    assert_eq!((value(&mut d,"a"),value(&mut d,"b")),(0,2));
    host.close("refresh",d);
    let mut d=host.open("refresh",None).unwrap();
    assert_eq!(d.queued().unwrap()[0].predicted,["counters/b"]);
    assert_eq!((value(&mut d,"a"),value(&mut d,"b")),(0,2));
    d.settle("q",None).unwrap();
    assert_eq!((value(&mut d,"a"),value(&mut d,"b")),(0,1));
}
#[test] fn replay_refreshes_predicted_memory() { refresh(&mut Memory::new()); }
#[test] fn replay_refreshes_predicted_sqlite() { refresh(&mut Sqlite::new("predicted-refresh")); }
