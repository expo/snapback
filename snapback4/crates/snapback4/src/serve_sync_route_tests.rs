//! Round four: exercise /sync's public defaults through the HTTP dispatcher.
use super::*;

fn with_host(file: bool, run: impl FnOnce(&Host)) {
    with_schema(file, SCHEMA, run);
}

fn with_schema(file: bool, schema: &str, run: impl FnOnce(&Host)) {
    let dir = std::env::temp_dir().join(format!("sb4-round4-{}-{:?}", std::process::id(), thread::current().id()));
    let store = if file {
        std::fs::create_dir_all(&dir).unwrap();
        snapback4_core::Store::open(&dir.join("store.sqlite")).unwrap()
    } else { snapback4_core::Store::memory().unwrap() };
    let host = Host::with_store(true, store, schema);
    run(&host);
    drop(host);
    if file { std::fs::remove_dir_all(dir).unwrap(); }
}

fn sync(host: &Host, input: Json) -> Json {
    let response = host.request("POST", "/sync", "X-Snapback-Persona: alice\r\n", &input.to_string());
    assert_eq!(status(&response), 200, "{response}");
    reply_body(&response)
}

fn reply_body(response: &str) -> Json {
    let (headers, body) = response.split_once("\r\n\r\n").unwrap();
    if !headers.to_ascii_lowercase().contains("transfer-encoding: chunked") {
        return serde_json::from_str(body).unwrap();
    }
    // These fixtures cross tiny_http's chunking threshold as well as the JSON
    // ceiling; the ordinary short-response Host helper does not decode chunks.
    let mut wire = body.as_bytes();
    let mut decoded = Vec::new();
    loop {
        let end = wire.windows(2).position(|p| p == b"\r\n").unwrap();
        let size = usize::from_str_radix(std::str::from_utf8(&wire[..end]).unwrap(), 16).unwrap();
        wire = &wire[end + 2..];
        if size == 0 { break; }
        decoded.extend_from_slice(&wire[..size]);
        wire = &wire[size + 2..];
    }
    serde_json::from_slice(&decoded).unwrap()
}

fn default_recovery(file: bool) {
    with_host(file, |host| {
        let initial = sync(host, json!({}));
        assert_eq!(initial["snapshot"], true);
        assert!(initial.get("recovery").is_none());
        // No metadata flag: this used to fall through to the snapshot handler,
        // silently discarding recover and generation instead of checking them.
        for extra in [json!({}), json!({"from":0,"stream":false,"limit":1,"pending":[]})] {
            let mut input = extra;
            input["recover"] = json!(true);
            input["generation"] = json!(999_999);
            input["store_id"] = initial["store_id"].clone();
            let reply = sync(host, input);
            assert_eq!(reply["metadata"], true, "F1: default recovery bypassed the typed discovery path: {reply}");
            assert!(reply.get("snapshot").is_none());
            assert!(reply.get("events").is_none());
            assert!(reply.get("recovery").is_none());
            assert_eq!(reply["generation"], initial["generation"]);
        }
    });
}

#[test] fn round4_f1_default_recovery_memory() { default_recovery(false); }
#[test] fn round4_f1_default_recovery_sqlite() { default_recovery(true); }

fn measured_routes(file: bool) {
    let schema = "use personas alice\ntable items:\n  body: text <=400000\n  read <- allow\n  sync public\n";
    with_schema(file, schema, |host| {
        use snapback4_core::value::{object, Value};
        let seed = |engine: &mut Engine, start, count, body: &str| {
            engine.seed((start..start+count).map(|i| ("items".into(), object([
                ("id", Value::Id(format!("row-{i:03}"))), ("body", Value::String(body.into()))])))).unwrap();
        };
        {
            let mut engine = lock(&host.shared.engine);
            seed(&mut engine, 0, 1, "small");
            seed(&mut engine, 1, 48, "small");
            for i in (1..49).step_by(4) { seed(&mut engine, i, 4, &"x".repeat(400000)); }
        }
        let first = sync(host, json!({"from":0,"stream":false,"limit":1,"pending":[]}));
        assert_eq!(first["snapshot"], true);
        assert_eq!(first["events"].as_array().unwrap().len(), 1);
        assert!(first["next"].is_string());
        let store = first["store_id"].clone();
        let generation = first["generation"].clone();
        let head = first["watermark"].clone();
        let continuation = sync(host, json!({"after":first["next"],"limit":1,"store_id":store}));
        assert_eq!(continuation["after"], first["next"]);
        assert_ne!(continuation["events"], first["events"]);
        let foreign = sync(host, json!({"after":"invalid-foreign-cursor","limit":1,"store_id":"other-store"}));
        assert_eq!(foreign["after"], Json::Null);
        assert_eq!(foreign["events"], first["events"]);
        assert_eq!(foreign["store_id"], store);

        // Defaults and explicit zero are acquisition data, never a grant. A
        // whole oversized snapshot answers only the ordinary bounded refusal.
        for input in [json!({}), json!({"from":0,"stream":false,"limit":100,"pending":[]}), json!({"from":1,"limit":1})] {
            let response = host.request("POST", "/sync", "X-Snapback-Persona: alice\r\n", &input.to_string());
            let denied = reply_body(&response);
            assert_eq!(denied["denied"]["code"], "E_BOUND", "{denied}");
            assert_eq!(denied.as_object().unwrap().len(), 1, "a refusal has no identity or recovery authority");
        }
        // A forged request really could reach an overflowing stream here. Its
        // arbitrary generation still produces no grant, with or without the
        // metadata flag, and at default zero or nonzero stream positions.
        for metadata in [false, true] {
            for (from, stream) in [(0, false), (0, true), (1, false), (1, true)] {
                let reply = sync(host, json!({"metadata":metadata,"recover":true,"generation":999_999,
                    "store_id":store,"from":from,"stream":stream,"limit":1,"pending":[]}));
                assert_eq!(reply["metadata"], true);
                assert_eq!(reply["store_id"], store);
                assert_eq!(reply["generation"], generation);
                assert!(reply.get("recovery").is_none());
                assert!(reply.get("events").is_none());
            }
        }
        let eligible = json!({"recover":true,"generation":generation,"store_id":store,"from":1,"limit":1});
        assert_eq!(sync(host, eligible.clone())["recovery"]["snapshot"], true, "the counter really measures this reply");
        for stream in [false, true] {
            let mut tip = eligible.clone();
            tip["from"] = head.clone(); tip["stream"] = json!(stream);
            assert!(sync(host, tip).get("recovery").is_none(), "from == head must not grant through handle");
            let ordinary = sync(host, json!({"from":head,"stream":stream,"store_id":"foreign"}));
            assert_eq!(ordinary["store_id"], store, "stream always names its actual store");
            assert_eq!(ordinary["snapshot"], false);
            assert!(ordinary.get("recovery").is_none());
        }
    });
}

#[test] fn round4_all_routes_memory() { measured_routes(false); }
#[test] fn round4_all_routes_sqlite() { measured_routes(true); }
