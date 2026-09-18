//! Repair B's publication and declaration invariants, on both production stores.
mod common;
use common::*;
use snapback4_core::{Engine, Value};
use snapback4_core::engine::WriteState;
use snapback4_core::value::object;
use snapback4_device::device::{Device, Queued, StreamPage};
use snapback4_device::store::DeviceStore;
use serde_json::json;

const SOURCE: &str = r#"
use personas alice, bob
table counters:
  n: int
  by byN: n, id
  read <- allow
  update <- allow
  delete <- allow
  insert <- allow
  sync public
query one(k: counters):
  return counters[k]
query ordered():
  return counters first 100 by byN {id, n}
mutation bump(k: counters):
  c = counters[k] ! else NOT_FOUND
  update counters[k] {n: c.n + 1}
mutation pair():
  a = counters['a'] ! else NOT_FOUND
  b = counters['b'] ! else NOT_FOUND
  update counters['a'] {n: a.n + 1}
  update counters['b'] {n: b.n + 1}
mutation remove(k: counters):
  delete counters[k]
mutation replace(k: counters, n: int):
  insert counters {id: k, n}
"#;

fn setup<H: Host>(host: &mut H) -> (Engine, Device<H::Store>) {
    let (mut engine, backend) = compile(SOURCE);
    engine.seed(["a", "b"].map(|k| ("counters".into(), object([("id", id(k)), ("n", Value::Int(0))])))).unwrap();
    let mut device = host.open("repair", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    (engine, device)
}
fn value<S: DeviceStore>(d: &mut Device<S>, k: &str) -> Option<i64> {
    let row = d.query("one", "dev:alice", &json!({"k":k}), 100).unwrap().data;
    if row == Value::Null { None } else { Some(row.field("n").unwrap().as_int().unwrap()) }
}
fn admit<S: DeviceStore>(d: &mut Device<S>, id: &str, op: &str, args: serde_json::Value) {
    d.admit(Queued { id:id.into(), seq:0, op:op.into(), args, new_ids:vec![], predicted:vec![], viewer:"dev:alice".into(), now:100,
        predictable:true, sent_seq: None, receipt_store: None, observed_seq:None }).unwrap();
}
fn bump(e: &mut Engine, write: &str, k: &str, viewer: &str) -> u64 {
    let r = e.mutate("bump", Some(write), context(viewer, &[("k", id(k))]).at(100)).unwrap();
    let WriteState::Sent {seq, ..} = r.state else {panic!("not committed")}; seq
}
fn next<S: DeviceStore>(e: &mut Engine, d: &mut Device<S>, limit: usize) -> StreamPage {
    let capture = d.sync_state().unwrap();
    let p = e.stream("dev:alice", capture.transfer_watermark, limit).unwrap();
    let (ack, above) = e.acknowledged_at("dev:alice", &capture.pending_ids, p.watermark, p.images_at.unwrap()).unwrap();
    serde_json::from_value(json!({"snapshot":false,"events":p.events.iter().map(|ev| json!({"table":ev.table,"kind":ev.kind,"id":ev.id,"data":ev.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),
        "acquisitions":p.acquisitions,"joined":p.joined,"watermark":p.watermark,"more":p.more,"images_at":p.images_at,"acknowledged":ack,"committed_above":above,
        "requested_watermark":capture.transfer_watermark,"captured_watermark":capture.watermark,"send_revision":capture.send_revision,
        "pending_through":capture.pending_through,"pending_complete":capture.pending_complete,"pending_bound":capture.pending_bound})).unwrap()
}
macro_rules! stores { ($name:ident, $f:ident) => {
    #[test] fn $name() { $f(&mut Memory::new()); $f(&mut Sqlite::new(stringify!($name))); }
} }

fn plain<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    e.mutate("pair", Some("bob"), context("dev:bob", &[])).unwrap();
    admit(&mut d, "alice", "bump", json!({"k":"a"}));
    let committed = bump(&mut e, "alice", "a", "dev:alice");
    let old = d.state().unwrap().0;
    let p = next(&mut e, &mut d, 1);
    assert!(p.more && p.watermark < p.images_at.unwrap());
    assert!(d.apply(&p, false).unwrap().is_empty());
    assert_eq!(value(&mut d, "a"), Some(1));
    assert_eq!(d.state().unwrap().0, old);
    h.close("repair", d);
    let mut d = h.open("repair", None).unwrap();
    assert_eq!(value(&mut d, "a"), Some(1));
    assert_eq!(d.state().unwrap().0, old);
    assert_eq!(value(&mut d, "b"), Some(0));
    assert_eq!(d.sync_state().unwrap().transfer_watermark, p.watermark);
    let covering = next(&mut e, &mut d, 1);
    assert!(!covering.more);
    assert_eq!(covering.images_at, Some(covering.watermark));
    assert!(covering.events.iter().all(|e| e.id != "b"));
    d.apply(&covering, false).unwrap();
    assert_eq!(value(&mut d, "b"), Some(1), "the covering page cannot supply the deferred row");
    assert_eq!(value(&mut d, "a"), Some(2));
    assert_eq!(d.queued().unwrap()[0].observed_seq, Some(committed));
}
stores!(plain_counter_and_crash_and_termination, plain);

fn multirow<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    bump(&mut e, "bob", "a", "dev:bob");
    admit(&mut d, "pair", "pair", json!({}));
    e.mutate("pair", Some("pair"), context("dev:alice", &[])).unwrap();
    let p = next(&mut e, &mut d, 1);
    assert_eq!(p.events.len(), 1);
    assert!(p.committed_above.contains_key("pair"));
    assert!(d.apply(&p, false).unwrap().is_empty());
    assert_eq!((value(&mut d, "a"), value(&mut d, "b")), (Some(1), Some(1)));
    loop {
        let p = next(&mut e, &mut d, 1);
        d.apply(&p, false).unwrap();
        if !p.more { assert_eq!(p.images_at, Some(p.watermark)); break; }
    }
    assert_eq!((value(&mut d, "a"), value(&mut d, "b")), (Some(2), Some(1)));
}
stores!(multirow_prediction_survives_partial_page, multirow);

fn several<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    for i in 0..4 {
        let write = format!("w{i}");
        admit(&mut d, &write, "bump", json!({"k":"a"}));
        bump(&mut e, &write, "a", "dev:alice");
    }
    let published = d.state().unwrap().0;
    for _ in 0..3 {
        let p = next(&mut e, &mut d, 1);
        assert!(p.more);
        d.apply(&p, false).unwrap();
        assert_eq!(d.state().unwrap().0, published);
        assert_eq!(value(&mut d, "a"), Some(4));
        assert!(d.queued().unwrap().iter().all(|q| q.observed_seq.is_none()));
    }
    let p = next(&mut e, &mut d, 1);
    d.apply(&p, false).unwrap();
    let q = d.queued().unwrap();
    assert_eq!(q.len(), 4);
    assert!(q.windows(2).all(|q| q[0].observed_seq < q[1].observed_seq));
    for q in q { d.settle(&q.id, q.observed_seq).unwrap(); assert_eq!(value(&mut d, "a"), Some(4)); }
    assert!(d.queued().unwrap().is_empty());
    let ordered = d.query("ordered", "dev:alice", &json!({}), 100).unwrap();
    assert_eq!(snapback4_core::wire::to_json(&ordered.data), json!([{"id":"b","n":0},{"id":"a","n":4}]));
}
stores!(several_deferred_receipts_and_indexes, several);

fn tombstones<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    admit(&mut d, "pending", "bump", json!({"k":"a"}));
    let w = d.state().unwrap().0;
    // A known intersecting image holds these effects private until refusal.
    d.sync_state().unwrap();
    let mut p: StreamPage = serde_json::from_value(json!({"snapshot":false,"events":[{"table":"counters","id":"a","kind":"del"}],"watermark":w+1,"more":true,"images_at":w+10,"committed_above":{"pending":w+10}})).unwrap();
    p.requested_watermark = Some(d.sync_state_read().unwrap().transfer_watermark);
    d.apply(&p, false).unwrap();
    assert_eq!(value(&mut d, "a"), Some(1));
    p.events = serde_json::from_value(json!([{"table":"counters","id":"a","kind":"put","data":{"id":"a","n":7}}])).unwrap();
    p.watermark += 1;
    p.requested_watermark = Some(d.sync_state_read().unwrap().transfer_watermark);
    d.apply(&p, false).unwrap();
    assert_eq!(value(&mut d, "a"), Some(1));
    d.settle("pending", None).unwrap();
    assert_eq!(value(&mut d, "a"), Some(0));
    p.events.clear(); p.more = false; p.images_at = Some(p.watermark); p.committed_above.clear();
    p.requested_watermark = Some(d.sync_state_read().unwrap().transfer_watermark);
    d.apply(&p, false).unwrap();
    assert_eq!(value(&mut d, "a"), Some(7));
    // A second deferred tombstone survives reopen and is actually installed.
    admit(&mut d, "pending2", "bump", json!({"k":"a"}));
    d.sync_state().unwrap();
    p.events = serde_json::from_value(json!([{"table":"counters","id":"a","kind":"del"}])).unwrap();
    p.watermark += 1; p.more = true; p.images_at = Some(w+10); p.committed_above.insert("pending2".into(),w+10);
    p.requested_watermark = Some(d.sync_state_read().unwrap().transfer_watermark);
    d.apply(&p, false).unwrap();
    h.close("repair", d);
    let mut d = h.open("repair", None).unwrap();
    assert_eq!(value(&mut d, "a"), Some(8));
    d.settle("pending2", None).unwrap();
    assert_eq!(value(&mut d, "a"), Some(7));
    assert_eq!(d.state().unwrap().0, w + 2);
    assert_eq!(d.sync_state().unwrap().transfer_watermark, w + 3);
    p.events.clear(); p.more = false; p.images_at = Some(p.watermark); p.committed_above.clear();
    p.requested_watermark = Some(d.sync_state_read().unwrap().transfer_watermark);
    d.apply(&p, false).unwrap();
    assert_eq!(value(&mut d, "a"), None);
    assert_eq!(d.query("ordered", "dev:alice", &json!({}), 100).unwrap().data.as_array().unwrap().len(), 1);
    // Avoid an unused Engine binding obscuring the real fixture's origin.
    assert_eq!(e.stream("dev:alice", 0, 100).unwrap().images_at, Some(w));
}
stores!(known_gap_refusal_delete_recreate_and_reopen, tombstones);

fn cap_reentry<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    for i in 0..257 { admit(&mut d, &format!("w{i}"), "bump", json!({"k":if i==256 {"a"} else {"b"}})); }
    let p = next(&mut e, &mut d, 100);
    assert!(!p.pending_complete.unwrap());
    d.apply(&p, false).unwrap();
    assert_eq!(value(&mut d, "a"), Some(0));
    assert_eq!(d.queued().unwrap().len(), 257);
    h.close("repair", d);
    let mut d = h.open("repair", None).unwrap();
    d.withdraw(&[]).unwrap();
    assert_eq!(value(&mut d, "a"), Some(0));
    // Terminal responses free the declared prefix; batching itself stays out of scope.
    for i in 0..256 { d.dequeue(&format!("w{i}")).unwrap(); }
    let p = next(&mut e, &mut d, 100);
    assert!(p.pending_complete.unwrap());
    d.apply(&p, false).unwrap();
    assert_eq!(value(&mut d, "a"), Some(1));
    assert_eq!(d.queued().unwrap()[0].id, "w256");
}
stores!(undeclared_is_kept_and_predicts_when_declared, cap_reentry);

fn validation<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    admit(&mut d, "q", "bump", json!({"k":"a"}));
    let mut p = next(&mut e, &mut d, 100);
    let before = d.state().unwrap();
    for seq in [p.watermark, p.watermark + 1] {
        p.committed_above.insert("q".into(), seq);
        assert!(d.apply(&p, false).unwrap_err().to_string().contains("committed_above"));
        assert_eq!(d.state().unwrap(), before);
    }
    p.images_at = None;
    assert!(d.apply(&p, false).unwrap_err().to_string().contains("committed_above"));
    p.images_at = Some(p.watermark);
    p.committed_above.clear(); p.acknowledged.insert("q".into(), p.watermark + 1);
    assert!(d.apply(&p, false).unwrap_err().to_string().contains("acknowledgement"));
    assert_eq!(d.state().unwrap(), before);
    assert!(d.queued().unwrap()[0].observed_seq.is_none());
    assert_eq!(d.sync_state().unwrap().transfer_watermark, before.0);
    assert_eq!(value(&mut d, "a"), Some(1));
}
stores!(malformed_bounds_roll_back, validation);

fn redeclared_commit<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    for i in 0..257 { admit(&mut d, &format!("w{i}"), "bump", json!({"k":if i==256 {"a"} else {"b"}})); }
    let p = next(&mut e, &mut d, 100);
    d.apply(&p, false).unwrap();
    assert_eq!(value(&mut d, "a"), Some(0));
    for i in 0..256 { d.dequeue(&format!("w{i}")).unwrap(); }
    bump(&mut e, "bob", "a", "dev:bob");
    bump(&mut e, "w256", "a", "dev:alice");
    // The old guard excluded w256. Its new declaration would enable replay,
    // so its committed_above entry must participate in this publication too.
    let p = next(&mut e, &mut d, 1);
    assert!(p.committed_above.contains_key("w256"));
    assert!(d.apply(&p, false).unwrap().is_empty());
    assert_eq!(value(&mut d, "a"), Some(0));
    let p = next(&mut e, &mut d, 1);
    d.apply(&p, false).unwrap();
    assert_eq!(value(&mut d, "a"), Some(2));
}
stores!(newly_declared_commit_participates_in_deferral, redeclared_commit);

fn capture_overlap<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    for i in 0..257 { admit(&mut d, &format!("w{i}"), "bump", json!({"k":if i==256 {"a"} else {"b"}})); }
    let mut old = next(&mut e, &mut d, 100);
    // Model a direct host omitting the additive local echo fields.
    old.pending_through = None; old.pending_complete = None;
    for i in 0..256 { d.dequeue(&format!("w{i}")).unwrap(); }
    let newer = d.sync_state().unwrap();
    assert_eq!(newer.pending_ids.len(), 256, "an in-flight declaration is immutable even if the outbox shrinks");
    d.apply(&old, false).unwrap();
    assert_eq!(value(&mut d, "a"), Some(0), "a later capture cannot widen an older response");
    let p = next(&mut e, &mut d, 100);
    d.apply(&p, false).unwrap();
    assert_eq!(value(&mut d, "a"), Some(1));
}
stores!(overlapping_captures_do_not_change_the_answered_declaration, capture_overlap);

fn legacy_terminal<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    bump(&mut e, "bob", "b", "dev:bob");
    admit(&mut d, "q", "bump", json!({"k":"a"}));
    bump(&mut e, "q", "a", "dev:alice");
    let mut p = next(&mut e, &mut d, 1);
    p.images_at = None; p.committed_above.clear();
    assert!(d.apply_publication(&p,false).unwrap().1);
    let mut p = next(&mut e, &mut d, 1);
    p.images_at = None; p.committed_above.clear();
    assert!(!p.more && p.acknowledged.contains_key("q"));
    d.apply(&p,false).unwrap();
    assert_eq!(d.state().unwrap().0,p.watermark);
    assert_eq!((value(&mut d,"a"),value(&mut d,"b")),(Some(1),Some(1)));
    assert_eq!(d.queued().unwrap()[0].observed_seq,Some(p.watermark));
}
stores!(legacy_terminal_releases_private_effects_and_receipts, legacy_terminal);

fn admitted_during_request<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    bump(&mut e,"bob","b","dev:bob");
    admit(&mut d,"q1","bump",json!({"k":"a"}));
    bump(&mut e,"q1","a","dev:alice");
    let first = next(&mut e,&mut d,1);
    assert!(d.apply(&first,false).unwrap().is_empty());
    let p = next(&mut e,&mut d,100);
    assert_eq!(p.pending_bound,Some(1));
    admit(&mut d,"q2","bump",json!({"k":"b"}));
    d.apply(&p,false).unwrap();
    assert_eq!((value(&mut d,"a"),value(&mut d,"b")),(Some(1),Some(2)));
    assert!(d.store().meta("device:declaration:capture").unwrap().is_none());
    let capture=d.sync_state().unwrap();
    assert_eq!((capture.pending_through,capture.pending_complete,capture.pending_bound),(2,true,2));
    h.close("repair",d);
    let mut d=h.open("repair",None).unwrap();
    d.withdraw(&[]).unwrap();
    assert_eq!(value(&mut d,"b"),Some(2));
}
stores!(request_bound_does_not_swallow_new_admissions, admitted_during_request);

fn adoption_guard<H: Host>(h: &mut H, reopen: bool) {
    let (mut e,mut d)=setup(h);
    let (_,mut backend)=compile(&SOURCE.replace("  n: int","  n: int\n  added: int default 0"));
    backend.generation=d.state().unwrap().1+1;
    for i in 0..257 {
        let k=if i==256 {"a"} else {"b"};
        admit(&mut d,&format!("w{i}"),"bump",json!({"k":k}));
        bump(&mut e,&format!("w{i}"),k,"dev:alice");
    }
    let p=next(&mut e,&mut d,1000);
    d.apply(&p,false).unwrap();
    assert_eq!(value(&mut d,"a"),Some(1));
    let guard=d.store().meta("device:declaration:published").unwrap();
    d.sync_state().unwrap();
    if reopen { h.close("repair",d); d=h.open("repair",Some(backend)).unwrap(); }
    else { d.adopt(backend).unwrap(); }
    assert_eq!(d.store().meta("device:declaration:published").unwrap(),guard);
    d.settle("w256",Some(p.watermark)).unwrap();
    assert_eq!(value(&mut d,"a"),Some(1));
    assert_eq!(value(&mut d,"b"),Some(256), "already published observations must stay confirmed after adoption");
}
#[test] fn retained_images_retain_published_replay_guard() {
    for reopen in [false,true] { adoption_guard(&mut Memory::new(),reopen); adoption_guard(&mut Sqlite::new("adopt-guard"),reopen); }
}

fn replacing<H: Host>(h: &mut H, catchup: bool) {
    let (mut e,mut d)=setup(h);
    admit(&mut d,"q","bump",json!({"k":"a"}));
    let w=d.state().unwrap().0;
    let mut p=snapshot_pages(&mut e,"dev:alice",100).remove(0);
    p.stage_snapshot=catchup;
    if catchup { d.apply(&p,true).unwrap(); }
    p.snapshot=!catchup; p.snapshot_catchup=catchup; p.stage_snapshot=false; p.more=true;
    if !catchup { p.next=Some("next".into()); }
    p.images_at=Some(w+2); p.committed_above.insert("q".into(),w+2);
    p.events.iter_mut().find(|e| e.id=="a").unwrap().data=Some(json!({"id":"a","n":2}));
    let state=d.sync_state().unwrap();
    p.pending_through=Some(state.pending_through); p.pending_complete=Some(state.pending_complete); p.pending_bound=Some(state.pending_bound);
    let response=snapback4_device::call::call(&mut d,json!({"op":"apply","page":page_json(&p),"first":!catchup}));
    assert_eq!(response["ok"]["published"],false,"{response}");
    assert_eq!(d.state().unwrap().0,w);
    assert_eq!(value(&mut d,"a"),Some(1));
    assert!(d.queued().unwrap()[0].observed_seq.is_none());
    if !catchup {
        let mut terminal_snapshot = p.clone();
        terminal_snapshot.after = p.next.clone(); terminal_snapshot.next = None; terminal_snapshot.more = false;
        terminal_snapshot.images_at = Some(w); terminal_snapshot.committed_above.clear(); terminal_snapshot.events.clear();
        terminal_snapshot.stage_snapshot = true;
        d.apply(&terminal_snapshot, false).unwrap();
    }
    p.requested_watermark = Some(w);
    p.snapshot=false; p.snapshot_catchup=true; p.more=false; p.watermark=w+2; p.images_at=Some(w+2); p.committed_above.clear(); p.acknowledged.insert("q".into(),w+2);
    p.events.clear();
    d.apply(&p,false).unwrap();
    assert_eq!(value(&mut d,"a"),Some(2));
    assert_eq!(d.queued().unwrap()[0].observed_seq,Some(w+2));
}
#[test] fn replacing_pages_use_the_same_publication_predicate() {
    for catchup in [false,true] { replacing(&mut Memory::new(),catchup); replacing(&mut Sqlite::new("replacing"),catchup); }
}

fn folds<H: Host>(h: &mut H) {
    let (_e,mut d)=setup(h);
    admit(&mut d,"q","bump",json!({"k":"a"}));
    let w=d.state().unwrap().0;
    d.sync_state().unwrap();
    let make=|n,events| serde_json::from_value::<StreamPage>(json!({"snapshot":false,"requested_watermark":n-1,"events":events,"watermark":n,"more":true,"images_at":w+3,"committed_above":{"q":w+3}})).unwrap();
    let put=|k,n| json!({"table":"counters","kind":"put","id":k,"data":{"id":k,"n":n}});
    let p=make(w+1,vec![put("new",4),json!({"table":"counters","kind":"del","id":"b"}),put("b",5)]);
    assert!(d.apply(&p,false).unwrap().is_empty());
    d.sync_state().unwrap();
    let p=make(w+2,vec![put("new",6)]);
    d.apply(&p,false).unwrap();
    h.close("repair",d);
    let mut d=h.open("repair",None).unwrap();
    assert_eq!(value(&mut d,"new"),None);
    assert_eq!(value(&mut d,"b"),Some(0));
    let mut p=make(w+3,vec![put("a",1)]); p.committed_above.clear();p.more=false;p.acknowledged.insert("q".into(),w+3);
    d.apply(&p,false).unwrap();
    assert_eq!((value(&mut d,"new"),value(&mut d,"b")),(Some(6),Some(5)));
    let ordered=d.query("ordered","dev:alice",&json!({}),100).unwrap();
    assert_eq!(snapback4_core::wire::to_json(&ordered.data),json!([{"id":"a","n":1},{"id":"b","n":5},{"id":"new","n":6}]));
}
stores!(folded_create_update_and_delete_recreate_preserve_indexes, folds);

fn identity_private<H: Host>(h: &mut H) {
    let (mut e,mut d)=setup(h);
    admit(&mut d,"q","bump",json!({"k":"a"}));
    bump(&mut e,"bob","b","dev:bob"); bump(&mut e,"q","a","dev:alice");
    let mut p=next(&mut e,&mut d,1); p.store_id=Some("first".into());
    // First identity on an already-acquired store means replacement. Start by
    // registering it, reacquiring, then exercise a reset of occupied state.
    let observed=d.observe_store(&p).unwrap(); assert!(observed.reset);
    assert!(d.store().meta("device:declaration:published").unwrap().is_none());
    assert!(d.store().meta("device:declaration:capture").unwrap().is_none());
    let (_,b)=compile(SOURCE); d.adopt(b).unwrap();
    let mut initial=snapshot_pages(&mut e,"dev:alice",100).remove(0);initial.store_id=Some("first".into());
    d.apply(&initial,true).unwrap();
    admit(&mut d,"q2","bump",json!({"k":"a"}));
    bump(&mut e,"bob2","b","dev:bob");bump(&mut e,"q2","a","dev:alice");
    let mut p=next(&mut e,&mut d,1);p.store_id=Some("first".into());
    d.apply(&p,false).unwrap();
    let mut reset=p;reset.store_id=Some("second".into());reset.send_revision=None;reset.captured_watermark=None;
    let observed=d.observe_store(&reset).unwrap();
    assert!(observed.retired.is_empty());
    assert!(d.queued().unwrap().iter().any(|q|q.id=="q2"));
}
stores!(identity_reset_clears_declarations_without_retiring_private_receipts, identity_private);

fn private_identity<H: Host>(h: &mut H) {
    let (mut e,b)=compile(SOURCE);
    e.seed([("counters".into(),object([("id",id("a")),("n",Value::Int(0))]))]).unwrap();
    let mut d=h.open("identity",Some(b)).unwrap();
    let mut p=snapshot_pages(&mut e,"dev:alice",100).remove(0);
    p.store_id=Some("first".into());p.stage_snapshot=true;
    let preflight = d.observe_store(&p).unwrap();
    assert!(!preflight.reset);
    assert!(d.store().meta("device:store_id").unwrap().is_none(), "preflight cannot publish first identity");
    d.apply(&p,true).unwrap();
    let capture=d.sync_state().unwrap();
    assert!(capture.store_id.is_none());
    assert_eq!(capture.transfer_store_id.as_deref(), Some("first"), "continuations bind the staged identity without publishing it");
    assert!(!capture.backend_required, "a private identity must not obsolete the in-memory owner");
    assert!(d.store().meta("device:store_id").unwrap().is_none());
    let mut terminal=stream_page(&mut e,"dev:alice",p.watermark);
    terminal.store_id=Some("first".into());terminal.snapshot_catchup=true;
    d.apply(&terminal,false).unwrap();
    assert_eq!(d.sync_state().unwrap().store_id.as_deref(),Some("first"));
    assert_eq!(value(&mut d,"a"),Some(0));
}
stores!(staged_identity_publishes_with_the_snapshot, private_identity);

fn capture_progress<H: Host>(h: &mut H) {
    let (mut e,mut d)=setup(h);
    bump(&mut e,"bob","b","dev:bob");
    admit(&mut d,"q1","bump",json!({"k":"a"}));
    bump(&mut e,"q1","a","dev:alice");
    let first=next(&mut e,&mut d,1);
    assert!(d.apply(&first,false).unwrap().is_empty());
    assert!(d.store().meta("device:declaration:capture").unwrap().is_none());
    admit(&mut d,"q2","bump",json!({"k":"b"}));
    let mut final_page=next(&mut e,&mut d,100);
    assert_eq!((final_page.pending_through,final_page.pending_complete),(Some(2),Some(true)));
    let stored: serde_json::Value=serde_json::from_str(&d.store().meta("device:declaration:capture").unwrap().unwrap()).unwrap();
    assert_eq!(stored["declaration"],json!([2,true,2]));
    // A legacy/direct caller omits the echo. A previous applied page must not
    // leave an intersected declaration that excludes this request's new write.
    final_page.pending_through=None;final_page.pending_complete=None;final_page.pending_bound=None;
    d.apply(&final_page,false).unwrap();
    assert_eq!((value(&mut d,"a"),value(&mut d,"b")),(Some(1),Some(2)));
    assert!(d.store().meta("device:declaration:capture").unwrap().is_none());
}
stores!(captures_follow_each_request_and_end_on_deferred_apply, capture_progress);

#[path = "repair_b/lifecycle.rs"]
mod lifecycle;

#[path = "repair_b/resumption.rs"]
mod resumption;

#[path = "repair_b/round4.rs"]
mod round4;

#[path = "repair_b/round5.rs"]
mod round5;

#[path = "repair_b/round6.rs"]
mod round6;
