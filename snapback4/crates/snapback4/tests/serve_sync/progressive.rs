use super::*;

fn exercise(reader: bool) {
    let path = std::env::temp_dir().join(format!("sb4-progressive-http-{}-{}", std::process::id(), NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)));
    std::fs::create_dir(&path).unwrap();
    let directory = ReaderTestDirectory(path);
    let store = if reader { snapback4_core::Store::open(&directory.0.join("store.sqlite")).unwrap() }
        else { snapback4_core::Store::memory().unwrap() };
    let host = Host::with_store(true, store, SOURCE);
    assert_eq!(lock(&host.shared.engine).reader().is_ok(), reader);
    let seed = host.request("POST", "/seed", "", r#"[{"table":"items","row":{"id":"one","n":1}}]"#);
    assert_eq!(body(&seed)["seeded"], 1);
    let before = lock(&host.shared.engine).seq().unwrap();
    let committed = body(&host.request("POST", "/m/bump", PERSONA, r#"{"id":"own-bump","args":{}}"#));
    assert_eq!(committed["state"], "sent");

    let capability = snapback4_core::device_protocol::PROGRESSIVE_ACQUISITION;
    let old = snapback4_core::device_protocol::DeviceEngine::current();
    assert!(!old.capabilities.iter().any(|c| c == capability));
    let headers = format!("{PERSONA}x-snapback-device: {}\r\n", serde_json::to_string(&old).unwrap());
    for path in ["/", "/schema"] {
        let response = host.request("GET", path, &headers, "");
        assert_eq!(status(&response), 200, "{response}");
        let compatibility = &body(&response)["device_compatibility"];
        assert!(compatibility["advertised"].as_array().unwrap().contains(&json!(capability)));
        assert!(!compatibility["capabilities"].as_array().unwrap().contains(&json!(capability)));
    }
    let request = json!({"generation": 1, "from": before, "pending": ["own-bump"], "acquire": {"cursor": null}});
    let response = host.request("POST", "/sync", &headers, &request.to_string());
    assert_eq!(status(&response), 200, "{response}");
    let p = body(&response);
    assert!(p.get("denied").is_none(), "{p}");
    assert_eq!(p["snapshot"], false);
    assert_eq!(p["watermark"], before);
    assert_eq!(p["images_at"], committed["seq"]);
    assert_eq!(p["committed_above"]["own-bump"], committed["seq"]);
    assert_eq!(p["acknowledged"], json!({}));
    assert_eq!(p["events"][0]["data"]["n"], 2);
    assert_eq!(p["acquire"]["whole_tables"], json!(["items"]));
    assert_eq!(p["acquire"]["unit"], json!({"tier": 1, "table": "items"}));
    assert_eq!(p["acquire"]["exhausted"], true);
    assert!(p["acquire"]["cursor"].is_null());

    // Literal old-shaped requests retain the byte-exact legacy reply shape.
    let legacy = host.request("POST", "/sync", &headers, r#"{"from":0,"pending":["own-bump"]}"#);
    let legacy_body = body(&legacy);
    let expected = json!({"acknowledged": {"own-bump": committed["seq"]}, "after": null,
        "events": [{"data": {"id": "one", "n": 2}, "id": "one", "kind": "put", "table": "items"}],
        "generation": 1, "held": {}, "more": false, "next": null, "now": legacy_body["now"],
        "sent": {"own-bump": committed["seq"]}, "snapshot": true,
        "store_id": p["store_id"], "watermark": committed["seq"]});
    assert_eq!(legacy.split_once("\r\n\r\n").unwrap().1, expected.to_string());
    let legacy_stream = host.request("POST", "/sync", &headers, &json!({"from": committed["seq"], "stream": true}).to_string());
    let stream = body(&legacy_stream);
    assert!(stream.get("acquire").is_none());
    assert_eq!(stream["events"], json!([]));

    let stale = host.request("POST", "/sync", &headers, &json!({"generation": 0, "acquire": {"cursor": "bad"}}).to_string());
    assert_eq!(body(&stale)["denied"]["code"], "E_SYNC_GENERATION");
    assert!(body(&stale).get("acquire").is_none());
    let bad = host.request("POST", "/sync", &headers, r#"{"acquire":{"cursor":"bad"}}"#);
    assert_eq!(status(&bad), 400);
    let replaced = host.request("POST", "/sync", &headers,
        r#"{"store_id":"replaced","acquire":{"cursor":"bad","skip":[{"table":"items","group":[]}]}}"#);
    assert_eq!(body(&replaced)["acquire"]["exhausted"], true, "old-store cursor and skip set are discarded");
    for request in [json!({"acquire": {"cursor": null, "extra": true}}),
        json!({"acquire": {"cursor": null, "skip": vec![json!({"table":"items","group":[]}); 33]}}),
        json!({"after": "legacy", "acquire": {"cursor": null}})] {
        let response = host.request("POST", "/sync", &headers, &request.to_string());
        assert_eq!(status(&response), 400, "{response}");
    }
    // Invalid identities still refuse before decoding the new request form.
    let bad_header = format!("{PERSONA}x-snapback-device: {{}}\r\n");
    let response = host.request("POST", "/sync", &bad_header, "not-json");
    assert_eq!(status(&response), 409);
    assert_eq!(body(&response)["denied"]["code"], "E_DEVICE_VERSION");
    let unauthenticated = host.request("POST", "/sync", "", &request.to_string());
    assert_eq!(status(&unauthenticated), 401);
}

#[test] fn progressive_acquisition_memory_http() { exercise(false); }
#[test] fn progressive_acquisition_reader_http() { exercise(true); }
