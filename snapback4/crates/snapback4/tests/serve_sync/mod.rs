use super::*;

const SOURCE: &str = "use personas alice\ntable items:\n  n: int\n  public 'generation fixture'\n  sync public\n";
const PERSONA: &str = "x-snapback-persona: alice\r\n";
static NEXT_DIRECTORY: AtomicUsize = AtomicUsize::new(0);

fn generation_case(reader: bool, stream: bool) {
    let unique = NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("sb4-sync-generation-{}-{unique}", std::process::id()));
    std::fs::create_dir(&path).unwrap();
    let directory = ReaderTestDirectory(path);
    let store = if reader { snapback4_core::Store::open(&directory.0.join("store.sqlite")).unwrap() }
        else { snapback4_core::Store::memory().unwrap() };
    let host = Host::with_store(true, store, SOURCE);
    assert_eq!(lock(&host.shared.engine).reader().is_ok(), reader, "exercise the intended owner");
    let seed = host.request("POST", "/seed", "", r#"[{"table":"items","row":{"id":"one","n":1}}]"#);
    assert_eq!(body(&seed)["seeded"], 1);
    let (generation, store_id, watermark) = {
        let mut engine = lock(&host.shared.engine);
        let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.replace("n: int", "n: int\n  added: int default 0"))]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let generation = engine.adopt(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
        *lock(&host.shared.generation) = generation;
        *lock(&host.shared.bound) = bound;
        (generation, engine.store().meta("store_id").unwrap().unwrap(), engine.seq().unwrap())
    };
    assert_eq!(generation, 2);
    let count = || *lock(&sync::MATERIALIZATIONS).get(&store_id).unwrap_or(&0);
    let request = |generation: Option<u64>| {
        let mut input = json!({ "from": 0, "limit": 4000, "stream": stream, "pending": ["unknown-write"], "store_id": store_id });
        if let Some(generation) = generation { input["generation"] = json!(generation); }
        let response = host.request("POST", "/sync", PERSONA, &input.to_string());
        assert_eq!(status(&response), 200, "{response}");
        body(&response)
    };
    let stale = request(Some(1));
    assert_eq!(count(), 0, "a stale request must never call the snapshot/stream materializer");
    assert_eq!(stale["denied"]["code"], "E_SYNC_GENERATION");
    assert_eq!(stale["denied"]["family"], "generation");
    assert_eq!(stale["generation"], generation);
    assert_eq!(stale["store_id"], store_id);
    assert_eq!(stale["watermark"], watermark);
    assert_eq!(stale.as_object().unwrap().len(), 4, "identity only, no events, receipts or page cursor");
    assert!(stale.to_string().len() < 1024);

    let current = request(Some(generation));
    assert_eq!(count(), 1);
    assert!(current.get("denied").is_none(), "{current}");
    assert_eq!(current["snapshot"], !stream);
    assert_eq!(current["events"].as_array().unwrap().len(), 1);
    assert_eq!(current["events"][0]["data"]["added"], 0);
    let absent = request(None);
    assert_eq!(count(), 2);
    assert_eq!(absent, current, "0.2.32 requests receive the unchanged page form");

    // A snapshot continuation is also stopped before cursor decoding, even
    // if the previous generation's cursor cannot be interpreted now.
    if !stream {
        let response = host.request("POST", "/sync", PERSONA, r#"{"generation":1,"after":"retired-generation-cursor"}"#);
        assert_eq!(body(&response)["denied"]["code"], "E_SYNC_GENERATION");
        assert_eq!(count(), 2);
    }
}

#[test]
fn stale_generation_engine_snapshot() { generation_case(false, false); }
#[test]
fn stale_generation_engine_stream() { generation_case(false, true); }
#[test]
fn stale_generation_reader_snapshot() { generation_case(true, false); }
#[test]
fn stale_generation_reader_stream() { generation_case(true, true); }
