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
    lock(&sync::MATERIALIZATIONS).remove(&store_id);
    let count = || *lock(&sync::MATERIALIZATIONS).get(&store_id).unwrap_or(&0);
    let request = |generation: Option<u64>| {
        let mut input = json!({ "from": 0, "limit": 4000, "stream": stream, "pending": ["unknown-write"], "store_id": store_id });
        if let Some(generation) = generation { input["generation"] = json!(generation); }
        let response = host.request("POST", "/sync", PERSONA, &input.to_string());
        assert_eq!(status(&response), 200, "{response}");
        body(&response)
    };
    let stale = request(Some(1));
    assert_eq!(lock(&host.shared.engine).seq().unwrap(), watermark, "stale pending ids cannot write");
    assert_eq!(count(), 0, "a stale request must never call the snapshot/stream materializer");
    assert_eq!(stale["denied"]["code"], "E_SYNC_GENERATION");
    assert_eq!(stale["denied"]["family"], "generation");
    assert_eq!(stale["generation"], generation);
    assert_eq!(stale["store_id"], store_id);
    assert_eq!(stale["watermark"], watermark);
    assert_early_keys(&stale);
    assert!(stale.to_string().len() < 1024);

    let ahead = request(Some(generation + 1));
    assert_eq!(ahead, stale);
    assert_eq!(count(), 0, "a client ahead of the server also skips materialization");

    let current = request(Some(generation));
    assert_eq!(count(), 1);
    assert!(current.get("denied").is_none(), "{current}");
    assert_eq!(current["snapshot"], !stream);
    assert_eq!(current["watermark"], watermark, "engine.seq equals the caught-up page head");
    assert_eq!(current["events"].as_array().unwrap().len(), 1);
    assert_eq!(current["events"][0]["data"]["added"], 0);
    let absent = request(None);
    assert_eq!(count(), 2);
    assert_eq!(absent, current, "omitting generation returns the same page as a matching generation");

    // Both snapshot and stream continuations stop before page materialization.
    let input = if stream {
        json!({ "generation": 1, "from": watermark, "stream": true, "pending": ["unknown-write"] })
    } else {
        json!({ "generation": 1, "after": "retired-generation-cursor", "pending": ["unknown-write"] })
    };
    let response = host.request("POST", "/sync", PERSONA, &input.to_string());
    assert_eq!(status(&response), 200, "{response}");
    assert_eq!(body(&response), stale);
    assert_early_keys(&body(&response));
    assert!(body(&response).to_string().len() < 1024);
    assert_eq!(count(), 2);
    assert_eq!(lock(&host.shared.engine).seq().unwrap(), watermark);
    lock(&sync::MATERIALIZATIONS).remove(&store_id);
}

#[test]
fn stale_generation_engine_snapshot() { generation_case(false, false); }
#[test]
fn stale_generation_engine_stream() { generation_case(false, true); }
#[test]
fn stale_generation_reader_snapshot() { generation_case(true, false); }
#[test]
fn stale_generation_reader_stream() { generation_case(true, true); }


fn assert_early_keys(reply: &Json) {
    let mut keys: Vec<_> = reply.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort();
    assert_eq!(keys, ["denied", "generation", "store_id", "watermark"]);
}

#[test]
fn generation_discovery_keeps_page_authorization() {
    for dev in [false, true] {
        let host = Host::new(dev);
        let store_id = lock(&host.shared.engine).store().meta("store_id").unwrap().unwrap();
        lock(&sync::MATERIALIZATIONS).remove(&store_id);
        for headers in ["", "Authorization: Bearer dead-token\r\n", "x-snapback-persona: bad!\r\n",
            "x-snapback-persona: alice\r\nAuthorization: Bearer dead-token\r\n"] {
            for stream in [false, true] {
                let request = |generation| host.request("POST", "/sync", headers,
                    &json!({ "generation": generation, "stream": stream }).to_string());
                let ordinary = request(1);
                let stale = request(0);
                assert_eq!(status(&ordinary), 401);
                assert_eq!(status(&stale), 401);
                assert_eq!(body(&stale), body(&ordinary));
                assert_eq!(body(&stale)["denied"]["code"], "E_AUTH");
                assert_eq!(body(&stale).as_object().unwrap().keys().collect::<Vec<_>>(), ["denied"]);
            }
        }
        if !dev {
            let response = host.request("POST", "/sync", PERSONA, r#"{"generation":0}"#);
            assert_eq!(status(&response), 401);
            assert!(body(&response).get("store_id").is_none());
            assert!(body(&response).get("watermark").is_none());
        }
        assert_eq!(*lock(&sync::MATERIALIZATIONS).get(&store_id).unwrap_or(&0), 0);
        lock(&sync::MATERIALIZATIONS).remove(&store_id);
    }
}

#[test]
fn failed_materialization_is_not_counted_and_unreadable_head_still_discovers_generation() {
    let host = Host::new(true);
    let store_id = lock(&host.shared.engine).store().meta("store_id").unwrap().unwrap();
    lock(&sync::MATERIALIZATIONS).remove(&store_id);
    let bad = host.request("POST", "/sync", PERSONA, r#"{"generation":1,"after":"bad-cursor"}"#);
    assert_eq!(status(&bad), 400);
    assert_eq!(body(&bad)["denied"]["code"], "E_INPUT");
    assert_eq!(*lock(&sync::MATERIALIZATIONS).get(&store_id).unwrap_or(&0), 0);
    lock(&host.shared.engine).store().conn().execute("DROP TABLE _commits", []).unwrap();
    for stream in [false, true] {
        let response = host.request("POST", "/sync", PERSONA, &json!({ "generation": 0, "stream": stream }).to_string());
        assert_eq!(status(&response), 200);
        let reply = body(&response);
        assert_eq!(reply["denied"]["code"], "E_SYNC_GENERATION");
        assert_eq!(reply["generation"], 1);
        assert_eq!(reply["store_id"], store_id);
        assert!(reply.get("watermark").is_none());
        assert_eq!(reply.as_object().unwrap().len(), 3);
    }
    assert_eq!(*lock(&sync::MATERIALIZATIONS).get(&store_id).unwrap_or(&0), 0);
    lock(&sync::MATERIALIZATIONS).remove(&store_id);
}
