//! Repair C: the same durable lifetime on memory/SQLite and open/adopt.
mod common;
#[path = "common/native_fixture.rs"]
mod native_fixture;
use common::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Engine, error::RuntimeError, schema::Schema, wire};
use snapback4_device::{
    device::{Backend, Device, Queued, StreamPage},
    memory::{Change, MemoryStore},
    store::{DeviceStore, DeviceTx},
};
use std::{cell::Cell, collections::BTreeMap};

const OWNER: &str = "device:history-owner";
const GROUPS: &str = "device:history:groups";
const SOURCE: &str = r#"use identity guests
table members:
  room: text <=40
  principal: principal
  unique byRoomPrincipal: room, principal
  by byPrincipal: principal, room
  immutable room, principal
  read <- exists members[.room, viewer]
  delete <- exists members[.room, viewer]
  sync to members[.room]
table messages:
  room: text <=40
  at: time
  body: text <=40
  by byTime: room, at, id
  by byWords: room, words(body), at, id
  read <- exists members[.room, viewer]
  update <- exists members[.room, viewer]
  delete <- exists members[.room, viewer]
  retain delivered-history
  sync to members[.room] last 25 by byTime
query both():
  return {left: messages['left'] last 50 by byTime, held: messages['held'] last 50 by byTime}
query point():
  return messages['left-25']
query matching():
  return messages['left'] matching 'old' last 50 by byWords
query existsPoint():
  return exists messages['left-25']
query marker():
  return 1
mutation leave():
  delete members[room = 'left', principal = viewer]
mutation edit():
  update messages['held-25'] {body: 'predicted'}
mutation eraseLeft():
  delete messages['left-25']
"#;

// These controls alter only the next install/read; neither adapter's production
// semantics is replaced. The legacy fixture removes the actual durable key.
struct Checked<S> {
    inner: S,
    fail: Cell<bool>,
    legacy: Cell<bool>,
    missing_backend: Cell<bool>,
    edit: Cell<Option<(&'static str, &'static str)>>,
}
impl<S: DeviceStore> DeviceStore for Checked<S> {
    type Tx<'a>
        = S::Tx<'a>
    where
        S: 'a;
    fn install(
        &mut self,
        schema: &Schema,
        metadata: &BTreeMap<String, String>,
        reset: bool,
    ) -> Result<(), RuntimeError> {
        self.inner.install(schema, metadata, reset)
    }
    fn install_checked(
        &mut self,
        schema: &Schema,
        metadata: &BTreeMap<String, String>,
        reset: bool,
        expected: &BTreeMap<String, Option<String>>,
    ) -> Result<(), RuntimeError> {
        if self.fail.get() {
            return Err(RuntimeError::Store("injected adoption failure".into()));
        }
        self.inner
            .install_checked(schema, metadata, reset, expected)
    }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        self.inner.meta(key)
    }
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> {
        self.inner.set_meta(key, value)
    }
    fn transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> {
        if self.legacy.replace(false) {
            let tx = self.inner.transaction()?;
            tx.delete_meta(&[OWNER])?;
            if self.missing_backend.get() { tx.delete_meta(&["device:backend"])?; }
            tx.commit()?;
        }
        if let Some((key, value)) = self.edit.take() {
            self.inner.set_meta(key, value)?;
        }
        self.inner.transaction()
    }
}

trait Inspect {
    fn records(&self) -> Json;
    fn row_count(&self) -> usize;
}
impl Inspect for MemoryStore {
    fn row_count(&self) -> usize { self.export().iter().filter(|c| c.s == 'r').count() }
    fn records(&self) -> Json {
        json!(self.export())
    }
}
impl Inspect for snapback4_core::Store {
    fn row_count(&self) -> usize { self.conn().query_row("SELECT count(*) FROM r", [], |row| row.get::<_, i64>(0)).unwrap() as usize }
    fn records(&self) -> Json {
        json!(
            [
                "SELECT * FROM r ORDER BY t,id",
                "SELECT * FROM i ORDER BY ti,k",
                "SELECT * FROM _meta ORDER BY key",
                "SELECT * FROM _device_base ORDER BY t,id",
                "SELECT * FROM _device_outbox ORDER BY seq",
                "SELECT * FROM _device_snapshot ORDER BY k"
            ]
            .map(|sql| {
                let mut statement = self.conn().prepare(sql).unwrap();
                let columns = statement.column_count();
                statement
                    .query_map([], |row| {
                        (0..columns)
                            .map(|i| {
                                row.get::<_, rusqlite::types::Value>(i)
                                    .map(|v| format!("{v:?}"))
                            })
                            .collect::<Result<Vec<_>, _>>()
                    })
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap()
            })
        )
    }
}
trait RepairHost: Host<Store: Inspect> {
    fn raw(&self, name: &str) -> Self::Store;
    fn forget_owner(&mut self, name: &str);
}
impl RepairHost for Sqlite {
    fn raw(&self, name: &str) -> Self::Store {
        snapback4_core::Store::open(&self.path(name)).unwrap()
    }
    fn forget_owner(&mut self, name: &str) {
        let mut s = self.raw(name);
        let tx = s.transaction().unwrap();
        tx.delete_meta(&[OWNER]).unwrap();
        tx.commit().unwrap();
    }
}
impl RepairHost for Memory {
    fn raw(&self, name: &str) -> Self::Store {
        let mut s = MemoryStore::new();
        s.load(
            self.held(name)
                .into_iter()
                .map(|((s, k), v)| Change { s, k, v }),
        )
        .unwrap();
        s
    }
    fn forget_owner(&mut self, name: &str) {
        self.remove_metadata(name, OWNER);
    }
}

fn fixture<H: RepairHost>(
    host: &mut H,
    viewer: &str,
    left: bool,
) -> (Engine, Backend, Device<H::Store>) {
    fixture_source(host, viewer, left, SOURCE)
}
fn fixture_source<H: RepairHost>(
    host: &mut H,
    viewer: &str,
    left: bool,
    source: &str,
) -> (Engine, Backend, Device<H::Store>) {
    let (mut engine, backend) = compile(source);
    let mut rows = Vec::new();
    for room in ["held", "left"] {
        rows.push((
            "members".into(),
            wire::row_from_json(
                &backend.schema.tables["members"],
                &json!({"id":format!("{room}-member"),"room":room,"principal":viewer}),
            )
            .unwrap(),
        ));
        for at in 0..26 {
            rows.push((
                "messages".into(),
                wire::row_from_json(
                    &backend.schema.tables["messages"],
                    &json!({"id":format!("{room}-{at}"),"room":room,"at":at,"body":"old"}),
                )
                .unwrap(),
            ));
        }
    }
    engine.seed(rows).unwrap();
    let mut device = host
        .open_as("store", Some(backend.clone()), viewer)
        .unwrap();
    acquire(&mut device, &mut engine, viewer);
    if left {
        let watermark = device.state().unwrap().0;
        let outcome = engine
            .mutate("leave", Some("leave"), context(viewer, &[]).at(100))
            .unwrap();
        assert!(matches!(
            outcome.state,
            snapback4_core::engine::WriteState::Sent { .. }
        ));
        let mut page = stream_page(&mut engine, viewer, watermark);
        page.store_id = Some("incarnation-a".into());
        device.apply(&page, false).unwrap();
    }
    (engine, backend, device)
}
fn acquire<S: DeviceStore>(device: &mut Device<S>, engine: &mut Engine, viewer: &str) {
    for (i, mut page) in snapshot_pages(engine, viewer, 17).into_iter().enumerate() {
        page.store_id = Some("incarnation-a".into());
        device.apply(&page, i == 0).unwrap();
    }
}
fn next(engine: &mut Engine, source: &str) -> Backend {
    let (_, mut backend) = compile(source);
    backend.generation = engine
        .adopt(backend.schema.clone(), backend.programs.clone())
        .unwrap();
    backend
}
fn adopt<H: RepairHost>(
    host: &mut H,
    device: Device<H::Store>,
    backend: Backend,
    viewer: &str,
    reopen: bool,
) -> Result<Device<H::Store>, RuntimeError> {
    if reopen {
        host.close("store", device);
        host.open_as("store", Some(backend), viewer)
    } else {
        let mut device = device;
        device.adopt_captured(backend, viewer, BTreeMap::new())?;
        Ok(device)
    }
}
fn read<S: DeviceStore>(d: &mut Device<S>, viewer: &str) -> Json {
    let (read, _, _, components) = d.query_with_components("both", viewer, &json!({}), 100);
    json!({"data":wire::to_json(&read.unwrap().data),"components":components})
}
fn durable<S: DeviceStore>(store: &mut S) -> Json {
    let tx = store.read_transaction().unwrap();
    let mut rows = Vec::new();
    for name in ["members", "messages"] {
        rows.push((name, tx.stored_rows_after(name, None, 1000).unwrap()));
    }
    let result = json!({"meta":tx.meta_prefix("device:").unwrap(),"rows":rows,"base":tx.base_entries().unwrap(),"staged":tx.staged_after("",1000).unwrap(),"outbox":tx.outbox_entries().unwrap()});
    tx.rollback().unwrap();
    result
}
fn assert_foreign_reads_empty<S: DeviceStore>(d: &mut Device<S>, viewer: &str) {
    for name in ["both", "point", "matching", "existsPoint"] {
        if let Ok(answer) = d.query(name, viewer, &json!({}), 100) {
            let value = wire::to_json(&answer.data);
            assert!(!value.to_string().contains("old"), "{name}: {value}");
            match name {
                "both" => assert_eq!(value, json!({"left":[],"held":[]})),
                "matching" => assert_eq!(value, json!([])),
                "existsPoint" => assert_eq!(value, json!(false)),
                _ => assert!(value.is_null()),
            }
        }
    }
}

fn program_only<H: RepairHost>(host: &mut H, reopen: bool) {
    let viewer = "guest:original";
    let (mut engine, before_backend, mut device) = fixture(host, viewer, true);
    let before = read(&mut device, viewer);
    assert_eq!(before["data"]["left"].as_array().unwrap().len(), 25);
    let groups = device.store().meta(GROUPS).unwrap();
    let boundaries = device.store().boundary_entries();
    assert!(!boundaries.is_empty());
    let backend = next(&mut engine, &SOURCE.replace("return 1", "return 2"));
    assert_eq!(
        before_backend.schema, backend.schema,
        "positive rule is whole-schema equality"
    );
    device = adopt(host, device, backend, viewer, reopen).unwrap();
    assert_eq!(device.store().meta(GROUPS).unwrap(), groups);
    assert_eq!(device.store().boundary_entries(), boundaries);
    assert!(device.sync_state().unwrap().acquired);
    assert_eq!(device.state().unwrap().0, 0, "reacquisition starts at zero but stages local left history");
    assert_eq!(read(&mut device, viewer), before);
    acquire(&mut device, &mut engine, viewer);
    let after = read(&mut device, viewer);
    assert_eq!(after, before);
    assert_eq!(device.store().meta(GROUPS).unwrap(), groups);
    let authority = wire::to_json(&engine.query("both", context(viewer, &[])).unwrap().data);
    // The device component remains 25 exact retained rows; the held component
    // still routes to the server's 26. This is the client's composition rule.
    assert_eq!(authority["left"], json!([]));
    assert_eq!(authority["held"].as_array().unwrap().len(), 26);
    assert_eq!(after["components"]["left"]["retained"], true);
    assert_eq!(after["components"]["held"]["unknown"], true);
    let composed = json!({"left":after["data"]["left"],"held":authority["held"]});
    let expected = |room: &str, start| {
        Json::Array(
            (start..26)
                .rev()
                .map(|at| json!({"id":format!("{room}-{at}"),"room":room,"at":at,"body":"old"}))
                .collect(),
        )
    };
    assert_eq!(
        composed,
        json!({"left":expected("left",1),"held":expected("held",0)})
    );
    host.close("store", device);
    let mut reopened = host.open_as("store", None, viewer).unwrap();
    assert_eq!(read(&mut reopened, viewer), before);
    assert_foreign_reads_empty(&mut reopened, "password:foreign");
    assert_eq!(
        read(&mut reopened, snapback4_core::SYSTEM_PRINCIPAL)["data"],
        before["data"]
    );
}

fn identity<H: RepairHost>(host: &mut H, reopen: bool) {
    let (identity_engine, _) = compile(SOURCE);
    let guest = snapback4_core::identity::guest(identity_engine.store(), 1, &mut 1).unwrap();
    let password = snapback4_core::identity::signup(
        identity_engine.store(),
        "p@example.test",
        "password-test",
        2,
        &mut 2,
    )
    .unwrap();
    let (mut engine, previous, mut device) = fixture(host, &guest.principal, true);
    assert_foreign_reads_empty(&mut device, &password.principal);
    let backend = next(
        &mut engine,
        &SOURCE.replace("use identity guests", "use identity password"),
    );
    assert_eq!(previous.schema.tables, backend.schema.tables);
    assert_eq!(previous.schema.maintains, backend.schema.maintains);
    assert_ne!(previous.schema, backend.schema);
    host.close("store", device);
    let before = durable(&mut host.raw("store"));
    if reopen {
        let result = host.open_as("store", Some(backend), &password.principal);
        assert!(matches!(result, Err(ref e) if e.code() == "SNAPBACK_HISTORY_OWNER"));
    } else {
        let mut old = host.open_as("store", None, &guest.principal).unwrap();
        let error = old
            .adopt_captured(backend, &password.principal, BTreeMap::new())
            .unwrap_err();
        assert_eq!(error.code(), "SNAPBACK_HISTORY_OWNER");
        assert!(error.to_string().contains("open a different device store"));
        assert_foreign_reads_empty(&mut old, &password.principal);
        host.close("store", old);
    }
    assert_eq!(
        durable(&mut host.raw("store")),
        before,
        "refusal preserves all durable state"
    );
    let mut original = host.open_as("store", None, &guest.principal).unwrap();
    assert_eq!(
        read(&mut original, &guest.principal)["data"]["left"]
            .as_array()
            .unwrap()
            .len(),
        25
    );
    assert_foreign_reads_empty(&mut original, &password.principal);
}

fn rotation<H: RepairHost>(host: &mut H, reopen: bool) {
    let (auth, _) = compile(SOURCE);
    let original = snapback4_core::identity::guest(auth.store(), 1, &mut 7).unwrap();
    let rotated = snapback4_core::identity::rotate_session(auth.store(), &original.token, 2)
        .unwrap()
        .unwrap();
    assert_ne!(original.token, rotated.token);
    assert_eq!(original.principal, rotated.principal);
    let (mut engine, original_backend, mut device) = fixture(host, &original.principal, true);
    let before = read(&mut device, &original.principal);
    device = adopt(host, device, original_backend, &rotated.principal, reopen).unwrap();
    assert_eq!(read(&mut device, &rotated.principal), before);
    let backend = next(&mut engine, &SOURCE.replace("return 1", "return 2"));
    device = adopt(host, device, backend, &rotated.principal, reopen).unwrap();
    acquire(&mut device, &mut engine, &rotated.principal);
    assert_eq!(read(&mut device, &rotated.principal), before);
}

fn signin<H: RepairHost>(host: &mut H, reopen: bool) {
    let (mut empty_engine, empty_backend) = compile(SOURCE);
    let mut empty = host.open_as("empty-signin", Some(empty_backend.clone()), "dev:alice").unwrap();
    acquire(&mut empty, &mut empty_engine, "dev:alice");
    let capture = empty.sync_state().unwrap();
    assert_eq!(capture.watermark, 0);
    let mut delayed: StreamPage = serde_json::from_value(json!({
        "snapshot":true,"events":[{"table":"messages","kind":"put","id":"private",
        "data":{"id":"private","room":"left","at":1,"body":"ALICE_PRIVATE"}}],
        "held":{"messages":[["left"]]},"watermark":0,"more":false,"store_id":"incarnation-a",
        "generation":empty_backend.generation,"send_revision":capture.send_revision,"captured_watermark":0
    })).unwrap();
    if reopen {
        host.close("empty-signin", empty);
        empty = host.open_as("empty-signin", Some(empty_backend.clone()), "dev:bob").unwrap();
    } else {
        empty.adopt_captured(empty_backend.clone(), "dev:bob", BTreeMap::new()).unwrap();
    }
    let before = empty.store().records();
    assert_eq!(empty.observe_store(&delayed).unwrap_err().code(), "E_GENERATION");
    assert_eq!(empty.apply(&delayed, true).unwrap_err().code(), "E_GENERATION");
    assert_eq!(empty.store().records(), before);
    // Even a delayed replacement observation must not clear the rebound store.
    delayed.store_id = Some("obsolete-store".into());
    assert!(empty.observe_store(&delayed).is_err());
    assert_eq!(empty.store().records(), before);
    let expected = BTreeMap::from([("device:send_revision".into(), Some(capture.send_revision.to_string()))]);
    assert!(empty.adopt_captured(empty_backend, "dev:alice", expected).is_err());
    acquire(&mut empty, &mut empty_engine, "dev:bob");
    assert_eq!(read(&mut empty, "dev:bob")["data"], json!({"left":[],"held":[]}));
    let (_, backend, device) = fixture(host, "guest:first", false);
    let mut device = adopt(host, device, backend, "password:second", reopen).unwrap();
    assert!(!device.sync_state().unwrap().acquired);
    assert_eq!(
        device.store().meta(OWNER).unwrap().as_deref(),
        Some("password:second")
    );
    assert_eq!(device.store().meta(GROUPS).unwrap().as_deref(), Some("{}"));
    host.close("store", device);
    assert!(
        host.raw("store")
            .read_transaction()
            .unwrap()
            .stored_rows_after("messages", None, 100)
            .unwrap()
            .is_empty()
    );
}

fn legacy<H: RepairHost>(host: &mut H, reopen: bool) {
    for left in [false, true] {
        let (_, backend, device) = fixture(host, "guest:old", left);
        host.close("store", device);
        host.forget_owner("store");
        let before = durable(&mut host.raw("store"));
        if reopen {
            let result = host.open_as("store", Some(backend), "guest:opener");
            if left {
                assert!(matches!(result, Err(ref e) if e.code()=="SNAPBACK_HISTORY_OWNER"));
            } else {
                let d = result.unwrap();
                assert_eq!(
                    d.store().meta(OWNER).unwrap().as_deref(),
                    Some("guest:opener")
                );
                host.close("store", d);
            }
        } else {
            // Open with the original binding, then reproduce an old store on
            // disk while the old device handle is alive, before adoption.
            let mut raw = host.raw("store");
            raw.set_meta(OWNER, "guest:old").unwrap();
            let checked = Checked {
                inner: raw,
                fail: Cell::new(false),
                legacy: Cell::new(false),
                missing_backend: Cell::new(false),
                edit: Cell::new(None),
            };
            let mut d = Device::open_store(checked, Some(backend.clone()), "guest:old").unwrap();
            d.store().legacy.set(true);
            assert!(d.query("marker", "guest:old", &json!({}), 100).is_err());
            let old_records = d.store().inner.records();
            let result = d.adopt_captured(backend, "guest:opener", BTreeMap::new());
            if left {
                assert_eq!(result.unwrap_err().code(), "SNAPBACK_HISTORY_OWNER");
                assert_eq!(d.store().inner.records(), old_records);
                assert_foreign_reads_empty(&mut d, "guest:opener");
            } else {
                result.unwrap();
                assert_eq!(
                    d.store().meta(OWNER).unwrap().as_deref(),
                    Some("guest:opener")
                );
            }
        }
        if left {
            assert_eq!(durable(&mut host.raw("store")), before);
        }
    }
}

fn negatives<H: RepairHost>(host: &mut H, reopen: bool) {
    for change in ["optional", "auth", "retention", "operation", "backend"] {
        let (mut engine, _, device) = fixture(host, "guest:original", true);
        let source = match change {
            "optional" => SOURCE.replace("  body: text", "  extra: int ?\n  body: text"),
            "auth" => SOURCE.replace("use identity guests", "use identity password"),
            "operation" => format!("{SOURCE}\nquery added():\n  return 42\n"),
            "retention" => SOURCE.replace("retain delivered-history", "retain until-revoked"),
            _ => SOURCE.replace("return 1", "return 2"),
        };
        let backend = next(&mut engine, &source);
        let mut device = device;
        if change == "backend" {
            let page: StreamPage = serde_json::from_value(
                json!({"snapshot":false,"events":[],"store_id":"incarnation-b","watermark":0,"more":false}),
            )
            .unwrap();
            assert!(device.observe_store(&page).unwrap().reset);
        }
        device = adopt(host, device, backend, "guest:original", reopen).unwrap();
        assert!(!device.sync_state().unwrap().acquired, "{change}");
        assert_eq!(device.store().meta(GROUPS).unwrap().as_deref(), Some("{}"));
        host.close("store", device);
        assert!(
            host.raw("store")
                .read_transaction()
                .unwrap()
                .stored_rows_after("messages", None, 100)
                .unwrap()
                .is_empty(),
            "{change}"
        );
    }
}

fn literal_defaults<H: RepairHost>(host: &mut H, reopen: bool) {
    for added_table in [false, true] {
        let (mut engine, previous, device) = fixture(host, "guest:original", true);
        let boundaries = device.store().boundary_entries();
        let mut source = SOURCE.replace("  body: text", "  flag: bool default false\n  body: text");
        if added_table {
            source.push_str("\ntable extra:\n  read <- allow\n  sync public\n");
        }
        let backend = next(&mut engine, &source);
        assert!(snapback4_core::successor::keeps_literal_default_images(
            &previous.schema,
            &backend.schema
        ));
        let mut device = adopt(host, device, backend, "guest:original", reopen).unwrap();
        assert_eq!(device.sync_state().unwrap().acquired, !added_table);
        // Established literal-default behavior: rows survive, the group map
        // clears, and boundaries survive only if acquisition remains valid.
        assert_eq!(device.store().meta(GROUPS).unwrap().as_deref(), Some("{}"));
        assert_eq!(
            device.store().boundary_entries(),
            if added_table { vec![] } else { boundaries }
        );
        if !added_table {
            let rows = read(&mut device, "guest:original");
            assert_eq!(rows["data"]["left"].as_array().unwrap().len(), 25);
            assert!(
                rows["data"]["left"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|row| row["flag"] == false)
            );
        } else {
            assert_eq!(
                device
                    .query("both", "guest:original", &json!({}), 100)
                    .unwrap_err()
                    .code,
                "E_PREDICT"
            );
        }
        host.close("store", device);
        let mut stored = host.raw("store");
        let tx = stored.read_transaction().unwrap();
        assert_eq!(tx.stored_rows_after("messages", None, 100).unwrap().len(), 50);
        tx.rollback().unwrap();
    }
}

fn cross_product<H: RepairHost>(host: &mut H, reopen: bool) {
    let viewer = "guest:original";
    // The already-built fixture's native personalizer scans ranked. An empty
    // public ranking still executes the real module's scan and return path.
    let source = format!(
        "{SOURCE}\ntable ranked:\n  score: int\n  by byScore: score, id\n  read <- allow\n  sync public\nquery personalize(first: int): native\n"
    );
    let (mut engine, _, mut device) = fixture_source(host, viewer, true, &source);
    let queued: Queued = serde_json::from_value(
        json!({"id":"pending-edit","seq":1,"op":"edit","args":{},"viewer":viewer,"now":100,"predictable":true}),
    )
    .unwrap();
    let queued = device.admit(queued).unwrap();
    assert!(queued.predictable);
    let bytes = native_fixture::module();
    use sha2::Digest;
    let digest = sha2::Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    device.install_native(&bytes, &digest, 1).unwrap();
    assert_eq!(
        wire::to_json(
            &device
                .query("personalize", viewer, &json!({"first": 10}), 100)
                .unwrap()
                .data
        ),
        json!([])
    );
    let mut pages = snapshot_pages(&mut engine, viewer, 7);
    for p in &mut pages {
        p.store_id = Some("incarnation-a".into());
        p.stage_snapshot = true;
    }
    device.apply(&pages[0], true).unwrap();
    assert!(pages[0].more);
    let backend = next(
        &mut engine,
        &source
            .replace("'predicted'", "'replayed'")
            .replace("return 1", "return 2"),
    );
    device = adopt(host, device, backend, viewer, reopen).unwrap();
    assert!(device.native_digest().is_none());
    assert_eq!(
        device
            .query("personalize", viewer, &json!({"first":10}), 100)
            .unwrap_err()
            .code,
        "E_NATIVE"
    );
    assert!(
        device.apply(&pages[1], false).is_err(),
        "old snapshot continuation must not publish"
    );
    acquire(&mut device, &mut engine, viewer);
    let after = read(&mut device, viewer);
    assert_eq!(after["data"]["left"].as_array().unwrap().len(), 25);
    assert_eq!(after["data"]["held"][0]["body"], "replayed");
    assert_eq!(after["data"]["held"][0]["pending"], true);
    let pending = device.queued().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, queued.id);
    assert_eq!(pending[0].seq, queued.seq);
    assert_eq!(pending[0].new_ids, queued.new_ids);
    device.install_native(&bytes, &digest, 2).unwrap();
    assert_eq!(device.native_digest(), Some(digest.as_str()));
    assert_eq!(
        wire::to_json(
            &device
                .query("personalize", viewer, &json!({"first": 10}), 100)
                .unwrap()
                .data
        ),
        json!([])
    );
    device.settle("pending-edit", None).unwrap();
    let settled = read(&mut device, viewer);
    assert_eq!(settled["data"]["held"][0]["body"], "old");
    assert!(settled["data"]["held"][0].get("pending").is_none());
    assert_eq!(settled["data"]["left"], after["data"]["left"]);
}

fn failed_install<H: RepairHost>(host: &mut H, reopen: bool) {
    let (mut engine, _, device) = fixture(host, "guest:original", true);
    host.close("store", device);
    let backend = next(&mut engine, &SOURCE.replace("return 1", "return 2"));
    let before = durable(&mut host.raw("store"));
    let checked = Checked {
        inner: host.raw("store"),
        fail: Cell::new(reopen),
        legacy: Cell::new(false),
                missing_backend: Cell::new(false),
                edit: Cell::new(None),
    };
    if reopen {
        assert!(matches!(
            Device::open_store(checked, Some(backend), "guest:original"),
            Err(RuntimeError::Store(_))
        ));
    } else {
        let mut d = Device::open_store(checked, None, "guest:original").unwrap();
        d.store().fail.set(true);
        let old_records = d.store().inner.records();
        assert!(matches!(
            d.adopt_captured(backend, "guest:original", BTreeMap::new()),
            Err(RuntimeError::Store(_))
        ));
        assert_eq!(d.store().inner.records(), old_records);
        assert_eq!(
            read(&mut d, "guest:original")["data"]["left"]
                .as_array()
                .unwrap()
                .len(),
            25
        );
    }
    assert_eq!(durable(&mut host.raw("store")), before);
}

macro_rules! both_paths {
    ($name:ident,$scenario:ident) => {
        mod $name {
            use super::*;
            #[test]
            fn memory_open() {
                $scenario(&mut Memory::new(), true);
            }
            #[test]
            fn memory_adopt() {
                $scenario(&mut Memory::new(), false);
            }
            #[test]
            fn sqlite_open() {
                $scenario(&mut Sqlite::new(stringify!($name)), true);
            }
            #[test]
            fn sqlite_adopt() {
                $scenario(&mut Sqlite::new(stringify!($name)), false);
            }
        }
    };
}
both_paths!(program_only_preserves_retained_components, program_only);
both_paths!(identity_mode_refuses_foreign_history, identity);
both_paths!(same_principal_credential_rotation, rotation);
both_paths!(signin_without_retained_history_resets, signin);
both_paths!(legacy_owner, legacy);
both_paths!(negative_adoption, negatives);
both_paths!(prediction_snapshot_native_cross_product, cross_product);
both_paths!(failed_adoption_preserves_durable_state, failed_install);

both_paths!(literal_default_lifecycle_unchanged, literal_defaults);

#[path = "history_owner/review.rs"]
mod review;

#[path = "history_owner/independent.rs"]
mod independent;

#[path = "history_owner/round3.rs"]
mod round3;

#[path = "history_owner/round4.rs"]
mod round4;

#[path = "history_owner/round6.rs"]
mod round6;
