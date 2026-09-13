//! The device-side twin (LLP 3000.005 §9): the app's native module, the one
//! the server runs, installed on a device and answering a native read over
//! the rows the device holds — on both stores, and the same answer the
//! server gives the same viewer.

mod common;

use common::*;
use serde_json::{Value as Json, json};
use snapback4_core::engine::{Context, Engine, WriteState};
use snapback4_core::value::Value;
use snapback4_device::call::call;
use snapback4_device::device::{Backend, Device};
use snapback4_device::memory::MemoryStore;
use snapback4_device::store::DeviceStore;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::OnceLock;

const SCHEMA: &str = include_str!("../../../native-fixtures/rescore/schema.q");
const NOW: i64 = 1_789_300_000_000;

struct RejectPostAdoptTransactions {
    inner: MemoryStore,
    installs: usize,
}

impl DeviceStore for RejectPostAdoptTransactions {
    type Tx<'a> = <MemoryStore as DeviceStore>::Tx<'a>;

    fn install(&mut self, schema: &snapback4_core::schema::Schema, metadata: &BTreeMap<String, String>, reset: bool) -> Result<(), snapback4_core::error::RuntimeError> {
        self.inner.install(schema, metadata, reset)?;
        self.installs += 1;
        Ok(())
    }
    fn meta(&self, key: &str) -> Result<Option<String>, snapback4_core::error::RuntimeError> {
        self.inner.meta(key)
    }
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(), snapback4_core::error::RuntimeError> {
        self.inner.set_meta(key, value)
    }
    fn transaction(&mut self) -> Result<Self::Tx<'_>, snapback4_core::error::RuntimeError> {
        if self.installs >= 2 {
            return Err(snapback4_core::error::RuntimeError::Store("post-adopt transaction rejected".into()));
        }
        self.inner.transaction()
    }
}

/// The fixture module, built once for wasm (see `snapback4-sim/tests/native.rs`).
fn module() -> &'static [u8] {
    static MODULE: OnceLock<Vec<u8>> = OnceLock::new();
    MODULE.get_or_init(|| {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("the snapback4 directory");
        let fixture = root.join("native-fixtures/rescore");
        let bound = snapback4_lang::compile(&[("schema.q".to_owned(), SCHEMA.to_owned())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        std::fs::write(fixture.join("src/schema.rs"), snapback4_lang::emit::rust(&bound)).expect("write the fixture's schema.rs");
        let target = root.join("target/native-fixture");
        let output = std::process::Command::new("cargo")
            .args(["build", "--release", "--quiet", "--target", "wasm32-unknown-unknown", "--manifest-path"])
            .arg(fixture.join("Cargo.toml"))
            .arg("--target-dir")
            .arg(&target)
            .env_remove("CARGO_TARGET_DIR")
            .output()
            .expect("cargo on PATH");
        assert!(output.status.success(), "the fixture did not build; is the target installed? `rustup target add wasm32-unknown-unknown`\n{}", String::from_utf8_lossy(&output.stderr));
        std::fs::read(target.join("wasm32-unknown-unknown/release/sb4_fixture_rescore.wasm")).expect("the built module")
    })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn mutate(engine: &mut Engine, name: &str, viewer: &str, fields: &[(&str, Value)], at: i64) -> Value {
    match engine.mutate(name, None, Context::new(viewer, args(fields)).at(at)).unwrap().state {
        WriteState::Sent { result, .. } => result,
        WriteState::Failed { why, .. } => panic!("refused: {why}"),
    }
}

/// The server with the module installed: three posts, votes, a comment,
/// bob has seen marc's post and the ranker likes the model's for bob; the
/// scoring job has run.
fn server() -> (Engine, Backend, BTreeMap<&'static str, String>) {
    let (mut engine, backend) = compile(SCHEMA);
    engine.install_native(module()).unwrap();
    let prompt = mutate(&mut engine, "createPrompt", "dev:alice", &[("title", Value::String("Humans should stop reviewing code".into()))], NOW).field("id").unwrap().as_str().unwrap().to_owned();
    let mut post = |engine: &mut Engine, viewer: &str, summary: &str, provider: Value| mutate(engine, "writePost", viewer, &[("promptId", id(&prompt)), ("summary", Value::String(summary.into())), ("provider", provider)], NOW).field("id").unwrap().as_str().unwrap().to_owned();
    let bobs = post(&mut engine, "dev:bob", "Review less, more carefully.", Value::Null);
    let marcs = post(&mut engine, "dev:marc", "No: review everything.", Value::Null);
    let models = post(&mut engine, "dev:alice", "A model's take.", Value::String("Claude".into()));
    for (voter, target, direction) in [("dev:alice", &marcs, 1), ("dev:bob", &marcs, 1), ("dev:marc", &bobs, -1)] {
        mutate(&mut engine, "vote", voter, &[("postId", id(target)), ("direction", Value::Int(direction))], NOW);
    }
    mutate(&mut engine, "comment", "dev:bob", &[("postId", id(&models)), ("body", Value::String("Interesting.".into()))], NOW);
    mutate(&mut engine, "markSeen", "dev:bob", &[("postId", id(&marcs))], NOW);
    mutate(&mut engine, "setAffinity", "dev:alice", &[("readerId", id("dev:bob")), ("postId", id(&models)), ("score", Value::Int(3))], NOW);
    let run = engine.run_job("rescore", BTreeMap::new(), NOW + 1_000).unwrap();
    assert_eq!(run.state, snapback4_core::JobState::Done, "{run:?}");
    let backend = Backend { generation: engine.generation(), ..backend };
    (engine, backend, BTreeMap::from([("bobs", bobs), ("marcs", marcs), ("models", models)]))
}

fn order(read: &Json) -> Vec<(String, i64)> {
    read.as_array().unwrap().iter().map(|item| (item["postId"].as_str().unwrap().to_owned(), item["weight"].as_i64().unwrap())).collect()
}

/// A device of either store, snapshotted from the server as bob.
fn snapshotted<S: snapback4_device::store::DeviceStore>(mut device: Device<S>, engine: &mut Engine) -> Device<S> {
    for (n, page) in snapshot_pages(engine, "dev:bob", 1_000).iter().enumerate() {
        device.apply(page, n == 0).unwrap();
    }
    device
}

#[test]
fn the_same_module_answers_the_same_on_the_server_and_on_both_devices() {
    let (mut engine, backend, posts) = server();
    // The server, as bob: the personalizer runs as the viewer under the read meter.
    let on_server = engine.query("personalize", Context::new("dev:bob", args(&[("first", Value::Int(10))])).at(NOW + 2_000)).unwrap();
    assert!(on_server.complete, "{on_server:?}");
    let expected = snapback4_core::wire::to_json(&on_server.data);
    let ranking = order(&expected);
    // The model's post leads (affinity 3 × 5 + 2), marc's sinks (seen), bob's own (-10) sits between.
    assert_eq!(ranking[0].0, posts["models"], "{ranking:?}");
    assert_eq!(ranking[1].0, posts["bobs"], "{ranking:?}");
    assert_eq!(ranking[2].0, posts["marcs"], "{ranking:?}");
    assert_eq!(ranking[0].1, 17);
    assert_eq!(ranking[2].1, 20 - 1000);
    assert!(expected[0]["mine"].is_null() && expected[1]["mine"].is_null() && expected[2]["mine"] == json!(1), "{expected}");
    assert!(on_server.tables.iter().any(|t| t == "ranked") && on_server.tables.iter().any(|t| t == "seen"), "{:?}", on_server.tables);
    // Both devices, over the rows bob holds, with no server in the call.
    let digest = hex(&sha256(module()));
    let mut memory = snapshotted(Device::open_store(MemoryStore::new(), Some(backend.clone())).unwrap(), &mut engine);
    let mut host = Sqlite::new("native");
    let mut sqlite = snapshotted(Host::open(&mut host, "bob", Some(backend.clone())).unwrap(), &mut engine);
    let devices: Vec<(&str, &mut dyn AnyCall)> = vec![("memory", &mut memory), ("sqlite", &mut sqlite)];
    for (label, device) in devices {
        // Before the module: the device says it does not know, so a host asks the server.
        let before = device.call_json(json!({ "op": "query", "name": "personalize", "viewer": "dev:bob", "args": { "first": 10 }, "now": NOW + 2_000 }));
        assert_eq!(before["ok"]["denied"]["code"], "E_NATIVE", "{label}: {before}");
        assert_eq!(before["ok"]["unknown"], true, "{label}: {before}");
        let installed = device.call_json(json!({ "op": "install_native", "wasm": hex(module()), "digest": digest, "generation": backend.generation }));
        assert_eq!(installed["ok"]["reads"], json!(["personalize"]), "{label}: {installed}");
        assert_eq!(device.call_json(json!({ "op": "state" }))["ok"]["native"], json!(digest), "{label}");
        let read = device.call_json(json!({ "op": "query", "name": "personalize", "viewer": "dev:bob", "args": { "first": 10 }, "now": NOW + 2_000 }));
        assert!(read["ok"]["denied"].is_null(), "{label}: {read}");
        assert_eq!(read["ok"]["data"], expected, "{label}: the device's answer is the server's");
        assert_eq!(read["ok"]["tables"], json!(["affinity", "ranked", "seen", "votes"]), "{label}: {read}");
        // The device's words: a page of 10 over 3 held rows of a table with a
        // horizon (`ranked`, last 500) may continue on the server, so the
        // read is `complete: false` here and the client asks the server
        // when online; the viewer's own tables sync without a horizon, so
        // a miss there is definitive.
        assert_eq!(read["ok"]["complete"], false, "{label}: {read}");
        assert_eq!(read["ok"]["unknown"], true, "{label}: {read}");
        // A page that fills from held rows is complete on the device.
        let filled = device.call_json(json!({ "op": "query", "name": "personalize", "viewer": "dev:bob", "args": { "first": 2 }, "now": NOW + 2_000 }));
        assert_eq!(filled["ok"]["complete"], true, "{label}: {filled}");
        assert_eq!(filled["ok"]["unknown"], false, "{label}: {filled}");
        assert_eq!(filled["ok"]["data"].as_array().unwrap().len(), 2, "{label}: {filled}");
        assert_eq!(filled["ok"]["data"][0], expected[0], "{label}");
    }
}

#[test]
fn a_device_keeps_the_module_across_a_reopen() {
    let (mut engine, backend, _) = server();
    let digest = hex(&sha256(module()));
    let kept = {
        let mut device = snapshotted(Device::open_store(MemoryStore::new(), Some(backend.clone())).unwrap(), &mut engine);
        device.install_native(module(), &digest, backend.generation).unwrap();
        device.store().export()
    };
    // A cold start with no backend from the server: the kept one, and the kept module.
    let mut reopened = MemoryStore::new();
    reopened.load(kept).unwrap();
    let mut device = Device::open_store(reopened, None).unwrap();
    assert_eq!(device.native_digest(), Some(digest.as_str()));
    let read = call(&mut device, &json!({ "op": "query", "name": "personalize", "viewer": "dev:bob", "args": { "first": 10 }, "now": NOW + 2_000 }));
    assert!(read["ok"]["denied"].is_null(), "{read}");
    assert_eq!(read["ok"]["data"].as_array().unwrap().len(), 3);
}

#[test]
fn native_cache_is_bound_to_its_digest_and_backend_generation() {
    let (_, backend, _) = server();
    let digest = hex(&sha256(module()));
    let mut device = Device::open_store(MemoryStore::new(), Some(backend.clone())).unwrap();

    let refused = device.install_native(module(), &"0".repeat(64), backend.generation).unwrap_err();
    assert_eq!(refused.code(), "E_NATIVE", "{refused}");
    assert_eq!(device.native_digest(), None, "mismatched bytes must not be kept");

    device.install_native(module(), &digest, backend.generation).unwrap();
    let mut next = backend.clone();
    next.generation += 1;
    device.adopt(next).unwrap();
    assert_eq!(device.native_digest(), None, "a new generation must not retain the old module");
    let stale = device.install_native(module(), &digest, backend.generation).unwrap_err();
    assert_eq!(stale.code(), "E_GENERATION", "an obsolete fetch must not repopulate the cleared cache");
    let reopened = Device::open_store({
        let mut store = MemoryStore::new();
        store.load(device.store().export()).unwrap();
        store
    }, None).unwrap();
    assert_eq!(reopened.native_digest(), None, "the old digest must be removed from durable metadata");
}

#[test]
fn a_bad_cached_module_is_removed_instead_of_advertised() {
    let (_, backend, _) = server();
    let mut kept = Device::open_store(MemoryStore::new(), Some(backend)).unwrap().store().export();
    kept.push(snapback4_device::memory::Change { s: 'm', k: "device:native".into(), v: Some("00".into()) });
    kept.push(snapback4_device::memory::Change { s: 'm', k: "device:native:digest".into(), v: Some(hex(&sha256(&[0]))) });
    let mut store = MemoryStore::new();
    store.load(kept).unwrap();
    let device = Device::open_store(store, None).unwrap();
    assert_eq!(device.native_digest(), None);
    assert_eq!(device.store().meta("device:native").unwrap(), None);
    assert_eq!(device.store().meta("device:native:digest").unwrap(), None);
    assert_eq!(device.store().meta("device:native:generation").unwrap(), None);
}

#[test]
fn an_interrupted_adopt_and_a_legacy_cache_fail_closed_on_reopen() {
    let (_, backend, _) = server();
    let digest = hex(&sha256(module()));
    let kept = {
        let mut device = Device::open_store(MemoryStore::new(), Some(backend.clone())).unwrap();
        device.install_native(module(), &digest, backend.generation).unwrap();
        device.store().export()
    };

    // Simulate a crash after the new backend/generation transaction commits
    // but before adopt's best-effort cache deletion transaction begins.
    let mut interrupted = kept.clone();
    let mut next = backend.clone();
    next.generation += 1;
    interrupted.push(snapback4_device::memory::Change { s: 'm', k: "device:backend".into(), v: Some(serde_json::to_string(&next).unwrap()) });
    interrupted.push(snapback4_device::memory::Change { s: 'm', k: "device:generation".into(), v: Some(next.generation.to_string()) });
    let mut store = MemoryStore::new();
    store.load(interrupted).unwrap();
    let reopened = Device::open_store(store, None).unwrap();
    assert_eq!(reopened.state().unwrap().1, next.generation);
    assert_eq!(reopened.native_digest(), None, "an old generation's valid module must not load");

    // Caches written before the generation binding existed are untrusted.
    let mut legacy = kept;
    legacy.push(snapback4_device::memory::Change { s: 'm', k: "device:native:generation".into(), v: None });
    let mut store = MemoryStore::new();
    store.load(legacy).unwrap();
    let reopened = Device::open_store(store, None).unwrap();
    assert_eq!(reopened.native_digest(), None, "a pre-binding cache must be repaired from the server");
}

#[test]
fn adopt_needs_no_fallible_cache_cleanup_after_install() {
    let (_, backend, _) = server();
    let digest = hex(&sha256(module()));
    let store = RejectPostAdoptTransactions { inner: MemoryStore::new(), installs: 0 };
    let mut device = Device::open_store(store, Some(backend.clone())).unwrap();
    device.install_native(module(), &digest, backend.generation).unwrap();
    let mut next = backend;
    next.generation += 1;

    device.adopt(next.clone()).unwrap();
    assert_eq!(device.state().unwrap().1, next.generation);
    assert_eq!(device.native_digest(), None);
    for key in ["device:native", "device:native:digest", "device:native:generation"] {
        assert_eq!(device.store().inner.meta(key).unwrap().as_deref(), Some(""), "{key} is invalidated in the install transaction");
    }
}

#[test]
fn a_native_read_cannot_write_and_a_missing_read_is_named() {
    let (mut engine, _, _) = server();
    // The fixture has no read named `nope`: the server's engine refuses with the module's word.
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), format!("{SCHEMA}\nquery nope(): native\n"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    engine.adopt(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let refused = engine.query("nope", Context::new("dev:bob", BTreeMap::new()).at(NOW)).unwrap_err();
    assert_eq!(refused.code, "E_NATIVE", "{refused}");
    assert!(refused.message.contains("implements no read nope"), "{refused}");
}

/// One JSON call, on either device.
trait AnyCall {
    fn call_json(&mut self, request: Json) -> Json;
}

impl<S: snapback4_device::store::DeviceStore> AnyCall for Device<S> {
    fn call_json(&mut self, request: Json) -> Json {
        call(self, &request)
    }
}

fn sha256(bytes: &[u8]) -> Vec<u8> {
    use sha2::Digest;
    sha2::Sha256::digest(bytes).to_vec()
}
