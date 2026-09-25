#[path = "../../../snapback4-sim/tests/uniform_word_expansion/fixture.rs"]
mod fixture;
use fixture::*;
use super::common::{compile, snapshot_pages, Host, Memory, Sqlite};

fn on_host<H: Host>(mut host: H) {
    for n in COUNTS {
        let (mut engine, backend) = compile(SOURCE);
        engine.seed(seed(n, 0)).unwrap();
        let name = format!("words-{n}");
        let mut device = host.open(&name, Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut engine, "dev:alice", 4000).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        measure(host.label(), n, &mut |op, cursor| device.query(op, "dev:alice", &serde_json::json!({"q":"kx", "c":cursor}), 100_000));
        if n == 45 {
            let page = device.query("nonuniform", "dev:alice", &serde_json::json!({"q":"kx"}), 100_000).unwrap();
            assert_eq!((page.metered.index_entries, page.metered.examined, ids(&page).len()), (33, 32, 20));
            assert!(!page.complete && page.word_cut_at.is_some() && page.next.is_none());
            assert_eq!(page.cut, Some(snapback4_core::engine::ReadCut::Words));
        }
        host.close(&name, device);
    }
    let mut worlds = Vec::new();
    for hidden in [0, 9000] {
        let (mut engine, backend) = compile(SOURCE);
        engine.seed(seed(45, hidden)).unwrap();
        let name = format!("world-{hidden}");
        let mut device = host.open(&name, Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut engine, "dev:alice", 4000).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        let mut replies = Vec::new();
        for op in ["search", "pair", "nonuniform"] {
            let mut cursor = serde_json::Value::Null;
            loop {
                let reply = snapback4_device::call::call(&mut device, serde_json::json!({"op":"query", "name":op, "viewer":"dev:alice", "args":{"q":"kx","c":cursor}, "now":100_000}));
                cursor = reply["ok"]["next"].clone();
                assert!(reply["ok"]["data"].is_array(), "{reply}");
                replies.push(serde_json::to_vec(&reply).unwrap());
                if cursor.is_null() { break; }
            }
        }
        worlds.push(replies);
        host.close(&name, device);
    }
    assert_eq!(worlds[0], worlds[1]);
    emit("worlds", host.label(), serde_json::json!({"equal":true, "replies":worlds[0].len(), "bytes":worlds[0].iter().map(Vec::len).sum::<usize>(), "hidden":9000}));
}

#[test]
fn search_uniform_word_counts_and_worlds_on_both_stores() {
    on_host(Memory::new());
    on_host(Sqlite::new("uniform-word-expansion"));
}

fn reduced_on<S: snapback4_device::store::DeviceStore>(mut store: S) {
    use snapback4_core::{Context, Value, meter::Ceilings, rows::Rows, engine::local};
    use snapback4_device::store::DeviceTx;
    let (_, backend) = compile(SOURCE);
    store.install(&backend.schema, &Default::default(), false).unwrap();
    let tx = store.transaction().unwrap();
    for (table, row) in seed(45, 0) { tx.put(&table, &backend.schema.tables[&table], &row, None).unwrap(); }
    let program = backend.programs.iter().find(|p| p.name == "search").unwrap();
    for (case, ceilings) in [
        ("discovery-index", Ceilings { index_entries: 32, ..Default::default() }),
        ("opening-examined", Ceilings { examined: 10, ..Default::default() }),
        ("heap", Ceilings { heap_bytes: 10_000, ..Default::default() }),
    ] {
        let context = Context::new("dev:alice", [("q".into(), Value::String("kx".into())), ("c".into(), Value::Null)].into()).at(100_000);
        assert_cut(case, &local::query(&tx, &backend.schema, program, context, ceilings).unwrap());
    }
    for bytes in [8, 1_000_000] {
        let mut programs = backend.programs.clone();
        nested_cursor(&mut programs, bytes);
        let program = programs.iter().find(|p| p.name == "search").unwrap();
        let context = Context::new("dev:alice", [("q".into(), Value::String("kx".into())), ("c".into(), Value::Null)].into()).at(100_000);
        let page = local::query(&tx, &backend.schema, program, context, Default::default()).unwrap();
        // Borrowed dead IR costs no per-lane allocation on either store.
        assert!(page.complete && page.next.is_some()); assert_eq!(ids(&page).len(), 20);
    }
    tx.rollback().unwrap();
}

#[test]
fn search_reduced_ceilings_on_both_stores() {
    reduced_on(snapback4_device::memory::MemoryStore::new());
    reduced_on(snapback4_core::Store::memory().unwrap());
}

fn snapshot_at_zero(engine: &mut snapback4_core::Engine) -> Vec<snapback4_device::device::StreamPage> {
    let page = engine.snapshot_acquisition_page_at("dev:alice", None, 4000, 0).unwrap();
    assert!(page.next.is_none());
    vec![serde_json::from_value(serde_json::json!({"snapshot":true, "held":page.held, "acquisitions":page.acquisitions,
        "events":page.events.iter().map(|e| serde_json::json!({"table":e.table,"kind":e.kind.word(),"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),
        "watermark":page.watermark,"more":false,"generation":engine.generation()})).unwrap()]
}

fn dispatcher_walk<S: snapback4_device::store::DeviceStore>(device: &mut snapback4_device::device::Device<S>, op: &str) -> Vec<String> {
    let mut cursor = serde_json::Value::Null;
    let mut replies = Vec::new();
    loop {
        let reply = snapback4_device::call::call_text(device, &serde_json::json!({"op":"query", "name":op,"viewer":"dev:alice","args":{"q":"kx","c":cursor},"now":100_000}).to_string());
        let text = reply.to_string();
        assert!(reply["ok"]["data"].is_array(), "{text}");
        cursor = reply["ok"]["next"].clone();
        replies.push(text);
        assert!(replies.len() < 100);
        if cursor.is_null() { return replies; }
    }
}

fn expired_on<H: Host>(mut host: H) {
    let mut worlds = Vec::new();
    for extra in [false, true] {
        let (mut engine, backend) = compile(&expired_source());
        engine.seed(expired_seed(extra)).unwrap();
        let name = format!("expired-{extra}");
        let mut device = host.open(&name, Some(backend)).unwrap();
        for (i, page) in snapshot_at_zero(&mut engine).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        worlds.push(["search", "pair"].into_iter().flat_map(|op| dispatcher_walk(&mut device, op)).collect::<Vec<_>>());
        host.close(&name, device);
    }
    assert_eq!(worlds[0], worlds[1]);
    assert_eq!(worlds[0].len(), 6);
}

#[test]
fn search_expired_word_pairs_on_both_stores() {
    expired_on(Memory::new());
    expired_on(Sqlite::new("word-expiry"));
}

#[test]
fn search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots() {
    let mut fixtures = serde_json::Map::new();
    for (n, hidden) in COUNTS.into_iter().map(|n| (n, 0)).chain([(45, 9000)]) {
        let (mut engine, backend) = compile(SOURCE);
        engine.seed(seed(n, hidden)).unwrap();
        fixtures.insert(format!("{n}-{hidden}"), serde_json::json!({"backend":backend,"pages":snapshot_at_zero(&mut engine)}));
    }
    for extra in [false, true] {
        let (mut engine, backend) = compile(&expired_source());
        engine.seed(expired_seed(extra)).unwrap();
        fixtures.insert(format!("expired-{extra}"), serde_json::json!({"backend":backend,"pages":snapshot_at_zero(&mut engine)}));
    }
    for population in [0, 33] {
        let (mut engine, backend) = compile(ROUND3);
        engine.seed(round3_seed(population)).unwrap();
        let rows = round3_seed(population).into_iter().map(|(table, row)| serde_json::json!({"table":table,"id":row.field("id").unwrap().as_str().unwrap(),"data":row})).collect::<Vec<_>>();
        fixtures.insert(format!("round3-{population}"), serde_json::json!({"backend":backend,"rows":rows,"pages":snapshot_at_zero(&mut engine)}));
    }
    let fixtures = serde_json::Value::Object(fixtures);
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/snapback4/test/fixtures/word-expansion.json");
    if std::env::var_os("WORD_EXPANSION_UPDATE_FIXTURE").is_some() { std::fs::write(&path, fixtures.to_string()).unwrap(); }
    let recorded: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert_eq!(recorded, fixtures);
}

fn expired_boundary_on<H: Host>(mut host: H) {
    const PRELUDE: u64 = 16_384 - 46;
    let source = expired_source().replace("  return messages['room']", &format!("  for i in range(0, {PRELUDE}):\n    unused = messages matching 'absent' first 1 by byWords\n  return messages['room']"));
    let mut worlds = Vec::new();
    let mut wires = Vec::new();
    for extra in [false, true] {
        let (mut engine, backend) = compile(&source);
        engine.seed(expired_seed(extra)).unwrap();
        let name = format!("expired-boundary-{extra}");
        let mut device = host.open(&name, Some(backend)).unwrap();
        // Acquire the population while live, then advance only the query clock.
        for (i, page) in snapshot_at_zero(&mut engine).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        let mut page = device.query("search", "dev:alice", &serde_json::json!({"q":"kx", "c":null}), 100_000).unwrap();
        assert_eq!(page.metered.index_entries, PRELUDE + if extra { 47 } else { 46 });
        // The device boundary has no ceiling override. Remove only the known
        // prelude from the private counter before the shared 46/47 assertion.
        page.metered.index_entries -= PRELUDE;
        worlds.push(page);
        wires.push(snapback4_device::call::call_text(&mut device, &serde_json::json!({"op":"query","name":"search","viewer":"dev:alice","args":{"q":"kx","c":null},"now":100_000}).to_string()));
        host.close(&name, device);
    }
    assert_expired_boundary(&worlds[0], &worlds[1]);
    assert_eq!(wires[0]["ok"]["held"], true, "the complete control read held rows");
    assert_eq!(wires[1]["ok"]["held"], false, "the examined prefix stopped before a held row");
    let mut expected = wires[0].clone();
    // Like the existing data/complete/cut/next differences, provenance follows
    // the actual prefix: the cut returned no row, the complete control did.
    expected["ok"]["held"] = serde_json::json!(false);
    expected["ok"]["data"] = serde_json::json!([]);
    expected["ok"]["complete"] = serde_json::json!(false);
    expected["ok"]["cut"] = serde_json::json!("meter");
    expected["ok"]["next"] = serde_json::Value::Null;
    assert_eq!(wires[1], expected, "full device envelopes, including expiry and coverage");
}
#[test]
fn search_expired_meter_boundary_memory() { expired_boundary_on(Memory::new()); }
#[test]
fn search_expired_meter_boundary_sqlite() { expired_boundary_on(Sqlite::new("expired-boundary")); }

fn regression_45<H: Host>(mut host: H) {
    let (mut engine, backend) = compile(SOURCE);
    engine.seed(seed(45, 0)).unwrap();
    let mut device = host.open("regression45", Some(backend)).unwrap();
    for (i, page) in snapshot_at_zero(&mut engine).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let (rows, pages) = walk(&mut |op, cursor| device.query(op, "dev:alice", &serde_json::json!({"q":"kx","c":cursor}), 100_000), "search", true);
    assert_eq!(rows, (0..45).rev().map(|i| format!("room-{i:05}")).collect::<Vec<_>>());
    assert_eq!(pages, 3);
    host.close("regression45", device);
}
#[test]
fn search_45_words_memory_walks_20_20_5() { regression_45(Memory::new()); }
#[test]
fn search_45_words_sqlite_walks_20_20_5() { regression_45(Sqlite::new("word-regression45")); }

fn admitted_nonuniform_on<S: snapback4_device::store::DeviceStore>(mut store: S) {
    use snapback4_core::{Context, Value, rows::Rows, engine::{local, ReadCut}};
    use snapback4_device::store::DeviceTx;
    let (_, backend) = compile(ROUND3);
    store.install(&backend.schema, &Default::default(), false).unwrap();
    let tx = store.transaction().unwrap();
    let mut worlds = Vec::new();
    for population in [0, 33] {
        // Adversarial online-only rows are inserted by hand. Legitimate acquisition
        // delivers neither world's online-only messages; the denied-snapshot pair
        // above separately compares full production envelopes after acquisition.
        for (table, row) in round3_seed(population) { if tx.get(&table, row.field("id").unwrap().as_str().unwrap()).unwrap().is_none() { tx.put(&table, &backend.schema.tables[&table], &row, None).unwrap(); } }
        let program = backend.programs.iter().find(|p| p.name == "matching").unwrap();
        let page = local::query(&tx, &backend.schema, program, Context::new("dev:alice", [("c".into(), Value::Null)].into()), Default::default()).unwrap();
        assert_eq!(ids(&page), ["shown"]);
        assert_eq!(page.word_cut_at.is_some(), population != 0);
        assert_eq!(page.cut, if population == 0 { None } else { Some(ReadCut::Words) });
        worlds.push(page);
    }
    // read_cut suppresses a non-uniform reason on the server only. Deliberately
    // compare data/completeness/continuation, not the device's public cut field.
    assert_eq!((&worlds[0].data, worlds[0].complete, &worlds[0].next), (&worlds[1].data, worlds[1].complete, &worlds[1].next));
    assert!(!worlds[0].complete && worlds[0].next.is_none());
    tx.rollback().unwrap();
}
#[test]
fn search_admitted_nonuniform_pair_on_both_stores() {
    admitted_nonuniform_on(snapback4_device::memory::MemoryStore::new());
    admitted_nonuniform_on(snapback4_core::Store::memory().unwrap());
}

fn legitimate_nonuniform<H: Host>(mut host: H) {
    let mut worlds = Vec::new();
    for population in [0, 33] {
        let (mut engine, backend) = compile(ROUND3);
        engine.seed(round3_seed(population)).unwrap();
        let name = format!("legitimate-{population}");
        let mut device = host.open(&name, Some(backend)).unwrap();
        for (i, page) in snapshot_at_zero(&mut engine).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        let reply = snapback4_device::call::call_text(&mut device, &serde_json::json!({"op":"query","name":"matching","viewer":"dev:alice","args":{},"now":100_000}).to_string());
        assert_eq!(reply["ok"]["data"], serde_json::json!([]), "online-only rows are not acquired");
        worlds.push(reply.to_string());
        host.close(&name, device);
    }
    assert_eq!(worlds[0], worlds[1], "legitimate acquisition yields identical full envelopes");
}
#[test]
fn search_nonuniform_legitimate_acquisition_envelopes_on_both_stores() {
    legitimate_nonuniform(Memory::new());
    legitimate_nonuniform(Sqlite::new("word-legitimate"));
}
