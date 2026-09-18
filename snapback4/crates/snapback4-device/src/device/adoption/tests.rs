use super::*;
use crate::memory::MemoryStore;

fn backend(literal: bool) -> Backend {
    let extra = if literal {
        "  flag: bool default false\n"
    } else {
        ""
    };
    let source = format!(
        "table notes:\n  body: text <=100\n{extra}  public 'fixture'\n  sync public\nquery all():\n  return notes first 10 by byId\n"
    );
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Backend {
        schema: bound.schema,
        programs: bound.programs.into_iter().map(|p| p.program).collect(),
        generation: if literal { 2 } else { 1 },
    }
}

// Compare the private authorization identity with the committed binding,
// independently of what the planner chose for the caller's requested viewer.
fn cached_binding<S: DeviceStore>(store: S, adopt: bool) {
    let backend = backend(false);
    let mut device = Device::open_store(store, Some(backend.clone()), "guest:caller").unwrap();
    if adopt {
        device
            .adopt_captured(backend, "password:caller", BTreeMap::new())
            .unwrap();
    }
    assert_eq!(
        Some(device.history_owner.as_str()),
        device.store.meta(HISTORY_OWNER).unwrap().as_deref()
    );
    device.sync_state().unwrap();
    assert_eq!(device.store.meta(HISTORY_OWNER).unwrap().as_deref(), Some(if adopt { "password:caller" } else { "guest:caller" }));
}

fn replacement_plan<S: DeviceStore>(mut store: S) {
    let old = backend(false);
    store
        .install(
            &old.schema,
            &BTreeMap::from([
                (BACKEND.into(), encoded(&old).unwrap()),
                (GENERATION.into(), "1".into()),
                (HISTORY_OWNER.into(), "guest:caller".into()),
                (ACQUIRED.into(), "1".into()),
                (BACKEND_REQUIRED.into(), "replacement".into()),
            ]),
            false,
        )
        .unwrap();
    let row = wire::row_from_json(
        &old.schema.tables["notes"],
        &serde_json::json!({"id":"n1","body":"kept"}),
    )
    .unwrap();
    let tx = store.transaction().unwrap();
    tx.put("notes", &old.schema.tables["notes"], &row, None)
        .unwrap();
    tx.commit().unwrap();
    for literal in [true, false] {
        let backend = backend(literal);
        let open = plan(
            &mut store,
            &backend,
            "guest:caller",
            Entry::Open,
            BTreeMap::new(),
        )
        .unwrap();
        assert!(
            !open.metadata.contains_key(BACKEND_REQUIRED),
            "opening cannot complete replacement adoption"
        );
        let adopt = plan(
            &mut store,
            &backend,
            "guest:caller",
            Entry::Adopt,
            BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(
            adopt.clear, !literal,
            "the established literal-default exception still keeps images"
        );
        assert_eq!(
            adopt.metadata.get(BACKEND_REQUIRED).map(String::as_str),
            Some(""),
            "the plan itself must complete adoption"
        );
        assert_eq!(
            adopt.expected[BACKEND_REQUIRED].as_deref(),
            Some("replacement")
        );
        assert_eq!(adopt.metadata[HISTORY_OWNER], "guest:caller");
        assert_eq!(adopt.expected[HISTORY_OWNER].as_deref(), Some("guest:caller"));
        assert!(adopt.invalidate_native);
        // Planning cannot discharge the obligation; only checked installation can.
        assert_eq!(
            store.meta(BACKEND_REQUIRED).unwrap().as_deref(),
            Some("replacement")
        );
        if literal {
            assert_eq!(adopt.install(&mut store, &backend.schema).unwrap(), "guest:caller");
            assert_eq!(store.meta(HISTORY_OWNER).unwrap().as_deref(), Some("guest:caller"));
            assert_eq!(store.meta(BACKEND_REQUIRED).unwrap().as_deref(), Some(""));
            let tx = store.read_transaction().unwrap();
            assert_eq!(
                tx.stored_rows_after("notes", None, 10).unwrap(),
                vec![row.clone()]
            );
            tx.rollback().unwrap();
            // Restore the original backend/marker to test the reset decision too.
            store
                .install(
                    &old.schema,
                    &BTreeMap::from([
                        (BACKEND.into(), encoded(&old).unwrap()),
                        (GENERATION.into(), "1".into()),
                        (HISTORY_OWNER.into(), "guest:caller".into()),
                        (ACQUIRED.into(), "1".into()),
                        (BACKEND_REQUIRED.into(), "replacement".into()),
                    ]),
                    false,
                )
                .unwrap();
        } else {
            assert_eq!(adopt.install(&mut store, &backend.schema).unwrap(), "guest:caller");
            assert_eq!(store.meta(HISTORY_OWNER).unwrap().as_deref(), Some("guest:caller"));
            assert_eq!(store.meta(BACKEND_REQUIRED).unwrap().as_deref(), Some(""));
            let tx = store.read_transaction().unwrap();
            assert!(tx.stored_rows_after("notes", None, 10).unwrap().is_empty());
            tx.rollback().unwrap();
        }
    }
}

fn changed_capture<S: DeviceStore>(store: S) {
    let old = backend(false);
    let mut device = Device::open_store(store, Some(old.clone()), "guest:caller").unwrap();
    device
        .store
        .set_meta(BACKEND_REQUIRED, "replacement")
        .unwrap();
    let backend = backend(true);
    let adopt = plan(
        &mut device.store,
        &backend,
        "guest:caller",
        Entry::Adopt,
        BTreeMap::new(),
    )
    .unwrap();
    device.store.set_meta(SEND_REVISION, "9").unwrap();
    let tx = device.store.read_transaction().unwrap();
    let before = tx.meta_prefix("device:").unwrap();
    tx.rollback().unwrap();
    assert_eq!(
        adopt
            .install(&mut device.store, &backend.schema)
            .unwrap_err()
            .code(),
        "E_GENERATION"
    );
    let tx = device.store.read_transaction().unwrap();
    assert_eq!(
        tx.meta_prefix("device:").unwrap(),
        before,
        "a failed CAS cannot clear the marker or publish a backend/binding"
    );
    tx.rollback().unwrap();
    assert_eq!(device.history_owner, "guest:caller");
    let retry = plan(
        &mut device.store,
        &backend,
        "guest:caller",
        Entry::Adopt,
        BTreeMap::new(),
    )
    .unwrap();
    retry.install(&mut device.store, &backend.schema).unwrap();
    assert_eq!(device.store.meta(HISTORY_OWNER).unwrap().as_deref(), Some("guest:caller"));
    assert_eq!(
        device.store.meta(BACKEND_REQUIRED).unwrap().as_deref(),
        Some("")
    );
}

#[test]
fn cached_binding_memory_open() {
    cached_binding(MemoryStore::new(), false);
}
#[test]
fn cached_binding_memory_adopt() {
    cached_binding(MemoryStore::new(), true);
}
#[test]
fn replacement_plan_memory() {
    replacement_plan(MemoryStore::new());
}
#[test]
fn changed_capture_memory() {
    changed_capture(MemoryStore::new());
}

#[cfg(feature = "native")]
fn sqlite() -> snapback4_core::Store {
    let store = snapback4_core::Store::memory().unwrap();
    store.conn().execute_batch(
        "CREATE TABLE _device_outbox (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, entry TEXT NOT NULL);
         CREATE TABLE _device_base (t TEXT NOT NULL, id TEXT NOT NULL, data TEXT, PRIMARY KEY(t, id)) WITHOUT ROWID;
         CREATE TABLE _device_snapshot (k TEXT PRIMARY KEY, t TEXT NOT NULL, data TEXT NOT NULL);
         CREATE INDEX _device_snapshot_by_table ON _device_snapshot(t, k);",
    ).unwrap();
    store
}
#[cfg(feature = "native")]
#[test]
fn cached_binding_sqlite_open() {
    cached_binding(sqlite(), false);
}
#[cfg(feature = "native")]
#[test]
fn cached_binding_sqlite_adopt() {
    cached_binding(sqlite(), true);
}
#[cfg(feature = "native")]
#[test]
fn replacement_plan_sqlite() {
    replacement_plan(sqlite());
}
#[cfg(feature = "native")]
#[test]
fn changed_capture_sqlite() {
    changed_capture(sqlite());
}
