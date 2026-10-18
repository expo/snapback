//! Live transfers through the actual snapshot/catch-up and stream applicator.
mod common;
use common::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, WriteState, wire};
use snapback4_device::{device::Device, store::DeviceStore};
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/live-parent.q");
fn setup() -> (Engine, snapback4_device::device::Backend) {
    let (mut e, b) = compile(SOURCE);
    let rows = [
        ("projects", json!({"id":"p","owner":"alice"})),
        ("tasks", json!({"id":"c","project":"p","body":"private"})),
    ]
    .into_iter()
    .map(|(t, row)| {
        (
            t.into(),
            wire::row_from_json(&e.schema().tables[t], &row).unwrap(),
        )
    })
    .collect::<Vec<_>>();
    e.seed(rows).unwrap();
    (e, b)
}
fn acquire<S: DeviceStore>(e: &mut Engine, d: &mut Device<S>, who: &str) {
    let mut first = true;
    for mut page in snapshot_pages(e, who, 1) {
        page.stage_snapshot = true;
        d.apply(&page, first).unwrap();
        first = false;
    }
    let at = d.sync_state().unwrap().transfer_watermark;
    let mut page = stream_page(e, who, at);
    page.snapshot_catchup = true;
    d.apply(&page, false).unwrap();
}
fn query<S: DeviceStore>(d: &mut Device<S>, who: &str) -> Json {
    snapback4_device::call::call(d,json!({"op":"query","name":"all","viewer":who,"args":{"project":"p"},"now":snapback4_core::now_ms()}))["ok"].clone()
}
fn transfer(e: &mut Engine, to: &str) {
    let out = e
        .mutate(
            "transfer",
            None,
            Context::new("alice", args(&[("project", id("p")), ("owner", id(to))])),
        )
        .unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
}
fn run<H: Host>(h: &mut H) {
    let (mut e, b) = setup();
    let mut a = h.open("alice", Some(b.clone())).unwrap();
    let mut b = h.open("bob", Some(b)).unwrap();
    acquire(&mut e, &mut a, "alice");
    acquire(&mut e, &mut b, "bob");
    assert!(query(&mut a, "alice").to_string().contains("private"));
    assert!(!query(&mut b, "bob").to_string().contains("private"));
    let predicted = a
        .predict(
            "transfer",
            "alice",
            &json!({"project":"p","owner":"bob"}),
            snapback4_core::now_ms(),
            vec![],
            1,
        )
        .unwrap_err();
    assert_eq!(predicted.code(), "E_PREDICT");
    assert!(query(&mut a, "alice").to_string().contains("private"));
    let am = a.sync_state().unwrap().watermark;
    let bm = b.sync_state().unwrap().watermark;
    transfer(&mut e, "bob");
    let ap = stream_page(&mut e, "alice", am);
    let bp = stream_page(&mut e, "bob", bm);
    a.apply(&ap, false).unwrap();
    b.apply(&bp, false).unwrap();
    assert!(!query(&mut a, "alice").to_string().contains("private"));
    let fresh = query(&mut b, "bob");
    assert!(fresh.to_string().contains("private"), "{fresh}");
    assert_eq!(fresh["complete"], true, "{fresh}");
    // Persist exactly the transferred state on each store.
    h.close("alice", a);
    let mut a = h.open("alice", None).unwrap();
    h.close("bob", b);
    let mut b = h.open("bob", None).unwrap();
    assert!(!query(&mut a, "alice").to_string().contains("private"));
    assert!(query(&mut b, "bob").to_string().contains("private"));
    transfer(&mut e, "alice");
    let p = stream_page(&mut e, "bob", b.sync_state().unwrap().watermark);
    b.apply(&p, false).unwrap();
    // A delayed pre-revoke page cannot resurrect the old authority.
    let _ = b.apply(&bp, false);
    assert!(!query(&mut b, "bob").to_string().contains("private"));
}
#[test]
fn transfer_memory() {
    run(&mut Memory::new());
}
#[test]
fn transfer_sqlite() {
    run(&mut Sqlite::new("live"));
}

fn interrupted<H: Host>(h: &mut H) {
    let (mut e, b) = setup();
    let mut d = h.open("staging", Some(b)).unwrap();
    let mut pages = snapshot_pages(&mut e, "alice", 1).into_iter();
    let mut first = pages.next().unwrap();
    first.stage_snapshot = true;
    assert!(first.more);
    d.apply(&first, true).unwrap();
    transfer(&mut e, "bob");
    h.close("staging", d);
    let mut d = h.open("staging", None).unwrap();
    // The SDK restarts an unfinished paged snapshot after reopening. A
    // continuation owned by the previous instance cannot publish it.
    let mut stale = pages.next().unwrap();
    stale.stage_snapshot = true;
    assert!(d.apply(&stale, false).is_err());
    acquire(&mut e, &mut d, "alice");
    assert!(!query(&mut d, "alice").to_string().contains("private"));
}
#[test]
fn interrupted_acquisition_memory() {
    interrupted(&mut Memory::new());
}
#[test]
fn interrupted_acquisition_sqlite() {
    interrupted(&mut Sqlite::new("live-stage"));
}

#[test]
fn authoritative_memory_seed_admits_before_collecting_and_rolls_back() {
    use snapback4_core::rows::Rows;
    let (_, backend) = compile(SOURCE);
    let mut store = snapback4_device::memory::MemoryStore::new();
    store.activate_server_at(backend.schema, 0).unwrap();
    let consumed = std::cell::Cell::new(0);
    let rows = (0..100_000).map(|n| {
        consumed.set(n + 1);
        (
            "projects".into(),
            snapback4_core::value::object([("id", id(&format!("p{n}"))), ("owner", id("alice"))]),
        )
    });
    let error = store.seed_server_at(rows, 1).unwrap_err();
    assert_eq!(error.code(), "E_BOUND");
    assert!(consumed.get() < 100_000);
    let tx = store.transaction().unwrap();
    assert!(Rows::get(&tx, "projects", "p0").unwrap().is_none());
}

#[test]
fn authoritative_memory_restore_recaptures_and_admits_the_whole_call() {
    use snapback4_core::rows::Rows;
    let (_,backend)=compile(SOURCE);let schema=backend.schema.clone();let mut store=snapback4_device::memory::MemoryStore::new();store.activate_server_at(backend.schema,0).unwrap();
    let rows=[("projects",json!({"id":"p","owner":"alice"})),("tasks",json!({"id":"c","project":"p","body":"private"}))].into_iter().map(|(n,row)|(n.into(),wire::row_from_json(&schema.tables[n],&row).unwrap())).collect::<Vec<_>>();store.seed_server_at(rows,1).unwrap();
    let parent=wire::row_from_json(&schema.tables["projects"],&json!({"id":"p","owner":"bob"})).unwrap();store.restore_server_at([("projects".into(),parent)],2).unwrap();
    {let tx=store.transaction().unwrap();let row=Rows::get(&tx,"tasks","c").unwrap().unwrap();assert_eq!(row.field("$project.owner").unwrap(),&id("bob"));}
    let consumed=std::cell::Cell::new(0);let rows=(0..100_000).map(|n|{consumed.set(n+1);("projects".into(),snapback4_core::value::object([("id",id(&format!("x{n}"))),("owner",id("mallory"))]))});let error=store.restore_server_at(rows,3).unwrap_err();assert_eq!(error.code(),"E_BOUND");assert!(consumed.get()<100_000);let tx=store.transaction().unwrap();assert!(Rows::get(&tx,"projects","x0").unwrap().is_none());
}

#[test]
fn authoritative_memory_seed_prepays_all_source_index_vectors() {
    use snapback4_core::{Value,rows::Rows,schema::{Index,ColumnType,public_table}};
    let (_,backend)=compile(SOURCE);let mut schema=backend.schema;
    let mut t=public_table([("id".into(),ColumnType::Id),("body".into(),ColumnType::Bytes{max:900})].into(),[("byId".into(),Index::of(&["id"],true))].into());for n in 0..10_000 {t.indexes.insert(format!("byBody{n}"),Index::of(&["body"],false));}schema.tables.insert("wideIndexes".into(),t);
    let mut store=snapback4_device::memory::MemoryStore::new();store.activate_server_at(schema,0).unwrap();
    let row=snapback4_core::value::object([("id",id("r")),("body",Value::Bytes(vec![0;900]))]);assert_eq!(store.seed_server_at([("wideIndexes".into(),row)],1).unwrap_err().code(),"E_BOUND");let tx=store.transaction().unwrap();assert!(Rows::get(&tx,"wideIndexes","r").unwrap().is_none());
}
