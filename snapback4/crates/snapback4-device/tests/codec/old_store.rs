use super::*;
use snapback4_core::rows::Rows;
use snapback4_device::store::{DeviceStore, DeviceTx};

// Compatibility evidence, not evidence that S1 production calls use the funnel.
// Frozen 0.2.27 texts, produced once on 2026-09-17 with plain serde_json:
// compile schema.q = "table notes:\n  body: text <=100\n  public 'fixture'\n  sync public\nquery all():\n  return notes first 10 by byId\n";
// to_string(Backend { generation: 1, schema, programs }); SHA256(to_string(schema));
// SHA256(to_string((&schema, programs sorted by name, 1u64))) for identity;
// to_string(("notes", "n1")) for the row key; to_string(tagged row) for r;
// to_string(Queued decoded from {id:q1,seq:1,op:add,args:{}}) for o;
// to_string(Some(row_text)) for b; to_string(("notes", staged_text)) for s,
// where staged_text = {"row":<tagged row>,"acquired":true} (baseline snapshot form).
// Each envelope is to_string(Change {s,k,v}), mirroring baseline memory::stored,
// row_key, device::encoded and store_identity. No funnel or live fixture generator.
const OLD: &[&str] = &[
    r#"{"s":"m","k":"memory:schema","v":"b8373a4f1d72bc592c0395b4308deaaf9b82f05e24b2a9b13f92b427b771384b"}"#,
    r#"{"s":"m","k":"device:backend-identity","v":"11540dcf1182a321637b340388029b84f34519a98c70708ba43d2d2305cf7ab0"}"#,
    r#"{"s":"m","k":"device:backend","v":"{\"generation\":1,\"schema\":{\"tables\":{\"notes\":{\"columns\":{\"body\":{\"Text\":{\"max\":100}},\"id\":\"Id\"},\"indexes\":{\"byId\":{\"components\":[{\"Column\":\"id\"}],\"unique\":true}},\"rules\":{\"read\":{\"Public\":{\"reason\":\"fixture\"}},\"insert\":\"Deny\",\"update\":\"Deny\",\"delete\":\"Deny\"},\"constraints\":[],\"leave\":\"until-revoked\",\"sync\":{\"audience\":\"Public\"}}},\"maintains\":[],\"operations\":{\"all\":{\"runs\":\"device\",\"sites\":[{\"site\":\"schema.q:6:10 (notes[])\",\"table\":\"notes\",\"index\":\"byId\",\"kind\":\"scan\",\"class\":\"held\",\"reason\":\"scan notes by byId: held, no horizon\",\"rewrite\":\"\"}],\"requires\":[]}}},\"programs\":[{\"name\":\"all\",\"kind\":\"Query\",\"args\":{},\"read_time_granularity_ms\":null,\"body\":[{\"Return\":{\"Scan\":{\"site\":\"programs.all.0\",\"table\":\"notes\",\"index\":\"byId\",\"prefix\":[],\"order\":\"Asc\",\"take\":{\"Literal\":10},\"after\":null,\"before\":null,\"range\":null,\"merge_site\":null,\"provenance\":\"Shape\"}}}]}]}"}"#,
    r#"{"s":"m","k":"device:generation","v":"1"}"#,
    r#"{"s":"r","k":"[\"notes\",\"n1\"]","v":"{\"Row\":{\"body\":{\"String\":\"kept\"},\"id\":{\"Id\":\"n1\"}}}"}"#,
    r#"{"s":"m","k":"device:acquired-generation","v":"1"}"#,
    r#"{"s":"o","k":"q1","v":"{\"id\":\"q1\",\"seq\":1,\"op\":\"add\",\"args\":{},\"new_ids\":[],\"predicted\":[],\"viewer\":\"\",\"now\":0,\"predictable\":false,\"sent_seq\":null,\"observed_seq\":null}"}"#,
    r#"{"s":"b","k":"[\"notes\",\"n1\"]","v":"\"{\\\"Row\\\":{\\\"body\\\":{\\\"String\\\":\\\"kept\\\"},\\\"id\\\":{\\\"Id\\\":\\\"n1\\\"}}}\""}"#,
    r#"{"s":"s","k":"[\"notes\",\"n1\"]","v":"[\"notes\",\"{\\\"row\\\":{\\\"Row\\\":{\\\"body\\\":{\\\"String\\\":\\\"kept\\\"},\\\"id\\\":{\\\"Id\\\":\\\"n1\\\"}}},\\\"acquired\\\":true}\"]"}"#,
];

fn changes() -> Vec<Change> { OLD.iter().map(|text| serde_json::from_str(text).unwrap()).collect() }
fn kept(changes: &[Change], key: &str) -> String { changes.iter().find(|c| c.k == key).unwrap().v.clone().unwrap() }
fn record(changes: &[Change], store: char) -> &Change { changes.iter().find(|c| c.s == store).unwrap() }
fn fixture_backend(changes: &[Change]) -> Backend { serde_json::from_str(&kept(changes, "device:backend")).unwrap() }

trait FrozenOutbox {
    fn raw_outbox(&self) -> Vec<String>;
}
impl FrozenOutbox for MemoryStore {
    fn raw_outbox(&self) -> Vec<String> { self.export().into_iter().filter(|c| c.s == 'o').map(|c| c.v.unwrap()).collect() }
}
impl FrozenOutbox for snapback4_core::Store {
    fn raw_outbox(&self) -> Vec<String> {
        self.conn().prepare("SELECT entry FROM _device_outbox ORDER BY seq").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap()
    }
}

fn fenced_old_outbox<S: DeviceStore + FrozenOutbox>(device: &mut Device<S>) {
    assert!(device.queued().unwrap().is_empty(), "the frozen unlabelled write is not executable");
    assert_eq!(device.store().raw_outbox(), vec![record(&changes(), 'o').v.clone().unwrap()], "the frozen bytes stay intact behind the ownership fence");
    assert_eq!(device.begin_send().unwrap_err().code(), "E_INPUT");
}

fn answers<S: DeviceStore + FrozenOutbox>(device: &mut Device<S>) {
    let answer = device.query("all", "alice", &json!({}), 0).unwrap();
    assert_eq!(snapback4_core::wire::to_json(&answer.data), json!([{"id":"n1","body":"kept"}]));
    fenced_old_outbox(device);
}

#[test]
fn literal_old_memory_store_opens_without_record_rewrites() {
    let old = changes();
    let mut store = MemoryStore::new(); store.load(old.clone()).unwrap();
    let mut device = Device::open_store(store, None, "dev:bob").unwrap();
    answers(&mut device);
    let exported = device.store().export();
    for change in &old { assert!(exported.contains(change), "lost or changed: {change:?}"); }
    let first = device.store().drain();
    // Opening binds this legacy store without retained history and fences older captures.
    assert_eq!(first.iter().map(|c| (c.s, c.k.as_str())).collect::<Vec<_>>(), vec![
        ('m', "device:backend"), ('m', "device:backend-identity"), ('m', "device:generation"), ('m', "device:history-owner"), ('m', "device:send_revision"),
    ]);
    for change in first { if change.k == "device:history-owner" { assert_eq!(change.v.as_deref(), Some("dev:bob")); } else if change.k == "device:send_revision" { assert_eq!(change.v.as_deref(), Some("1")); } else { assert!(old.contains(&change)); } }
}

#[test]
fn newly_written_records_decode_with_the_old_plain_serde_apis() {
    let old = changes();
    let backend = fixture_backend(&old);
    let mut store = MemoryStore::new();
    store.install(&backend.schema, &old.iter().filter(|c| c.s == 'm' && c.k != "memory:schema").map(|c| (c.k.clone(), c.v.clone().unwrap())).collect(), false).unwrap();
    let row: Value = serde_json::from_str(record(&old, 'r').v.as_deref().unwrap()).unwrap();
    let queued: Queued = serde_json::from_str(record(&old, 'o').v.as_deref().unwrap()).unwrap();
    let staged: (String, String) = serde_json::from_str(record(&old, 's').v.as_deref().unwrap()).unwrap();
    let tx = store.transaction().unwrap();
    tx.put("notes", &backend.schema.tables["notes"], &row, None).unwrap();
    tx.outbox_insert(queued.seq, &queued.id, &codec::to_text(&queued).unwrap()).unwrap();
    tx.base_remember("notes", "n1", Some(&codec::to_text(&row).unwrap())).unwrap();
    tx.staged_put(&codec::to_text(&("notes", "n1")).unwrap(), &staged.0, &staged.1).unwrap();
    tx.commit().unwrap();
    let writes = store.drain();
    assert_eq!(writes.iter().filter(|c| ['r', 'o', 'b', 's'].contains(&c.s)).count(), 4);
    for change in writes {
        let text = codec::to_text(&change).unwrap();
        let plain: Change = serde_json::from_str(&text).unwrap();
        assert_eq!(plain, change);
        let expected = old.iter().find(|c| c.s == plain.s && c.k == plain.k).unwrap();
        assert_eq!(&plain, expected); // also declaration-order bytes, not just JSON equality
        let value = plain.v.as_deref().unwrap();
        match plain.s {
            'r' => {
                assert_eq!(serde_json::from_str::<(String, String)>(&plain.k).unwrap(), ("notes".into(), "n1".into()));
                assert_eq!(serde_json::from_str::<Value>(value).unwrap(), row);
            }
            'o' => assert_eq!(serde_json::from_str::<Queued>(value).unwrap(), queued),
            'b' => {
                let image: Option<String> = serde_json::from_str(value).unwrap();
                assert_eq!(serde_json::from_str::<Value>(&image.unwrap()).unwrap(), row);
            }
            's' => {
                let pair: (String, String) = serde_json::from_str(value).unwrap();
                assert_eq!(pair, staged);
                let image: Json = serde_json::from_str(&pair.1).unwrap();
                assert_eq!(serde_json::from_value::<Value>(image["row"].clone()).unwrap(), row);
                assert_eq!(image["acquired"], true);
            }
            'm' if plain.k == "device:backend" => {
                let decoded: Backend = serde_json::from_str(value).unwrap();
                assert_eq!(serde_json::to_value(decoded).unwrap(), serde_json::to_value(&backend).unwrap());
            }
            'm' => {},
            _ => panic!("unknown record: {plain:?}"),
        }
    }
    // Exercise the device writers as well as MemoryTx's record envelope: the
    // staged image and queued entry come from production's private derives.
    let mut device = Device::open_store(MemoryStore::new(), Some(backend), "dev:bob").unwrap();
    assert_eq!(device.enqueue(&queued).unwrap_err().code(), "E_INPUT");
    let owned = Queued { viewer: "dev:bob".into(), ..queued };
    device.enqueue(&owned).unwrap();
    let page = json!({"snapshot":true,"events":[{"table":"notes","kind":"put","id":"n1","data":{"id":"n1","body":"kept"}}],"watermark":1,"more":true,"next":"next","generation":1});
    let result = snapback4_device::call::call_text(&mut device, &json!({"op":"apply","page":page,"first":true}).to_string());
    assert!(result.get("ok").is_some(), "{result}");
    let emitted = device.store().drain();
    for kind in ['o', 's'] {
        let written = record(&emitted, kind);
        let plain: Change = serde_json::from_str(&codec::to_text(written).unwrap()).unwrap();
        let mut expected = record(&old, kind).clone();
        if kind == 'o' {
            // The frozen raw encoding above remains byte-for-byte checked.
            // New admission requires an owner, and changes only that field.
            expected.v = expected.v.map(|text| text.replace("\"viewer\":\"\"", "\"viewer\":\"dev:bob\""));
        }
        assert_eq!(plain, expected);
    }
    assert_eq!(kept(&emitted, "device:backend"), kept(&old, "device:backend"));
}

#[test]
fn old_sqlite_store_opens_from_pre_funnel_values() {
    let old = changes();
    let row: Value = serde_json::from_str(record(&old, 'r').v.as_deref().unwrap()).unwrap();
    let staged: (String, String) = serde_json::from_str(record(&old, 's').v.as_deref().unwrap()).unwrap();
    let dir = std::env::temp_dir().join(format!("sb4-codec-old-{}-{}", std::process::id(), snapback4_core::now_ms()));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("old.sqlite");
    let store = old_sqlite_fixture(&path);
    let before = raw_records(&store);
    drop(store);
    let mut device = Device::open(&path, None, "dev:bob").unwrap();
    answers(&mut device);
    assert_eq!(device.store().meta("schema_hash").unwrap().unwrap(), kept(&old, "memory:schema"));
    let mut store = old_sqlite_open(&path);
    assert_eq!(raw_records(&store), before, "open must preserve all old raw record bytes");
    assert_eq!(store.meta("device:history-owner").unwrap().as_deref(), Some("dev:bob"));
    assert_eq!(store.meta("device:send_revision").unwrap().as_deref(), Some("1"));
    let tx = store.transaction().unwrap();
    assert_eq!(tx.base_entries().unwrap(), vec![("notes".into(), "n1".into(), Some(serde_json::to_string(&row).unwrap()))]);
    assert_eq!(tx.staged_after("", 10).unwrap(), vec![(record(&old, 's').k.clone(), staged.0, staged.1)]);
    tx.rollback().unwrap();
    drop(store); drop(device); std::fs::remove_dir_all(dir).unwrap();
}

fn old_sqlite_fixture(path: &Path) -> snapback4_core::store::Store {
    let old = changes();
    let backend = fixture_backend(&old);
    let mut store = old_sqlite_open(path);
    let metadata = old.iter().filter(|c| c.s == 'm' && c.k != "memory:schema").map(|c| (c.k.clone(), c.v.clone().unwrap())).collect();
    DeviceStore::install(&mut store, &backend.schema, &metadata, false).unwrap();
    let row: Value = serde_json::from_str(record(&old, 'r').v.as_deref().unwrap()).unwrap();
    let entry: Queued = serde_json::from_str(record(&old, 'o').v.as_deref().unwrap()).unwrap();
    let staged: (String, String) = serde_json::from_str(record(&old, 's').v.as_deref().unwrap()).unwrap();
    let tx = store.transaction().unwrap();
    tx.put("notes", &backend.schema.tables["notes"], &row, None).unwrap();
    // Install indexes through Rows, then explicitly write the old row encoding.
    tx.conn().execute("UPDATE r SET data = ?1", [serde_json::to_string(&row).unwrap()]).unwrap();
    tx.outbox_insert(entry.seq, &entry.id, &serde_json::to_string(&entry).unwrap()).unwrap();
    tx.base_remember("notes", "n1", Some(&serde_json::to_string(&row).unwrap())).unwrap();
    tx.staged_put(&serde_json::to_string(&("notes", "n1")).unwrap(), &staged.0, &staged.1).unwrap();
    tx.commit().unwrap();
    store
}

// Start from the frozen pre-change records, not an open through today's Device.
// The expected map must accept absent owner/revision/snapshot/marker keys even
// while SQLite projects the schema in the same installation transaction.
fn old_in_place_adoption<S: DeviceStore + FrozenOutbox>(store: S, reopen: bool) {
    for key in ["device:history-owner", "device:send_revision", "device:backend-required", "device:snapshot:owner", "device:snapshot:next"] {
        assert_eq!(store.meta(key).unwrap(), None, "the fixture predates {key}");
    }
    let source = "table notes:\n  body: text <=100\n  flag: bool default false\n  public 'fixture'\n  sync public\nquery all():\n  return notes first 10 by byId\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let backend = Backend { generation: 2, schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
    assert!(snapback4_core::successor::keeps_literal_default_images(&fixture_backend(&changes()).schema, &backend.schema));
    let mut device = if reopen {
        Device::open_store(store, Some(backend), "dev:bob").unwrap()
    } else {
        let mut device = Device::open_store(store, None, "dev:bob").unwrap();
        device.adopt_captured(backend, "dev:bob", Default::default()).unwrap();
        device
    };
    assert!(device.sync_state().unwrap().acquired);
    assert_eq!(device.state().unwrap().1, 2);
    let answer = device.query("all", "dev:bob", &json!({}), 0).unwrap();
    assert_eq!(snapback4_core::wire::to_json(&answer.data), json!([{"id":"n1","body":"kept","flag":false}]));
    fenced_old_outbox(&mut device);
}

#[test]
fn old_memory_store_adopts_in_place_with_capture_cas() {
    for reopen in [true, false] {
        let mut store = MemoryStore::new();
        store.load(changes()).unwrap();
        old_in_place_adoption(store, reopen);
    }
}

#[test]
fn old_sqlite_store_adopts_in_place_with_capture_cas() {
    for reopen in [true, false] {
        let dir = std::env::temp_dir().join(format!("sb4-old-cas-{}-{}-{reopen}", std::process::id(), snapback4_core::now_ms()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("old.sqlite");
        drop(old_sqlite_fixture(&path));
        old_in_place_adoption(old_sqlite_open(&path), reopen);
        std::fs::remove_dir_all(dir).unwrap();
    }
}

fn old_sqlite_open(path: &Path) -> snapback4_core::store::Store {
    let store = snapback4_core::store::Store::open(path).unwrap();
    store.conn().execute_batch("CREATE TABLE IF NOT EXISTS _device_outbox (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, entry TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS _device_base (t TEXT NOT NULL, id TEXT NOT NULL, data TEXT, PRIMARY KEY(t, id)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS _device_snapshot (k TEXT PRIMARY KEY, t TEXT NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS _device_snapshot_by_table ON _device_snapshot(t, k);").unwrap();
    store
}

fn raw_records(store: &snapback4_core::store::Store) -> Vec<Vec<Vec<rusqlite::types::Value>>> {
    ["SELECT * FROM r ORDER BY t, id", "SELECT * FROM _device_outbox ORDER BY seq",
     "SELECT * FROM _device_base ORDER BY t, id", "SELECT * FROM _device_snapshot ORDER BY k",
     "SELECT * FROM _meta WHERE key NOT IN ('device:history-owner', 'device:send_revision') ORDER BY key"].iter().map(|sql| {
        let mut statement = store.conn().prepare(sql).unwrap();
        let columns = statement.column_count();
        statement.query_map([], |row| (0..columns).map(|i| row.get(i)).collect()).unwrap().collect::<Result<Vec<_>, _>>().unwrap()
    }).collect()
}
