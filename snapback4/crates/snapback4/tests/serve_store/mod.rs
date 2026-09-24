use super::*;

#[test]
fn action_store_precondition_precedes_admission_and_replay() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(),
        "use server\nuse personas alice\naction work() returns { n: int } <- allow\n");
    let headers = "x-snapback-persona: alice\r\n";
    let identity = body(&host.request("GET", "/probe", headers, ""))["store_id"].clone();
    let payload = |store: Json| json!({ "id": "store-bound-action", "args": {}, "store_id": store }).to_string();
    let refused = body(&host.request("POST", "/a/work?wait=0", headers, &payload(json!("other-store"))));
    assert_eq!(refused["denied"]["code"], "E_STORE_REPLACED");
    let accepted = body(&host.request("POST", "/a/work?wait=0", headers, &payload(identity)));
    assert_eq!(accepted["state"], "pending", "the wrong-store request cannot reserve the action id");
    let wrong_replay = body(&host.request("POST", "/a/work?wait=0", headers, &payload(json!("other-store"))));
    assert_eq!(wrong_replay["denied"]["code"], "E_STORE_REPLACED");
}

#[test]
fn intent_store_precondition_fences_execution_and_replay_without_recording_a_refusal() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(),
        "use personas alice\nmutation change():\n  return 1\n");
    let headers = "x-snapback-persona: alice\r\n";
    let identity = body(&host.request("GET", "/probe", headers, ""))["store_id"].clone();
    let payload = |id: &str, store: Json| json!({ "id": id, "args": {}, "store_id": store }).to_string();
    let refused = body(&host.request("POST", "/m/change", headers, &payload("first", json!("another-store"))));
    assert_eq!(refused["why"]["code"], "E_STORE_REPLACED");
    assert_eq!(refused["head"], 0);
    let first = body(&host.request("POST", "/m/change", headers, &payload("first", identity.clone())));
    assert_eq!(first["state"], "sent", "wrong-store refusal did not reserve the id");
    assert_ne!(first["replayed"], true);
    let replay = body(&host.request("POST", "/m/change", headers, &payload("first", identity)));
    assert_eq!(replay["replayed"], true);
    assert_eq!(replay["seq"], first["seq"]);
    let wrong_replay = body(&host.request("POST", "/m/change", headers, &payload("first", json!("another-store"))));
    assert_eq!(wrong_replay["why"]["code"], "E_STORE_REPLACED", "the guard precedes receipt lookup too");
    assert_eq!(wrong_replay["head"], first["head"]);
}

#[test]
fn query_and_mutation_replies_identify_the_evaluated_store_and_replay_head() {
    for pooled in [false, true] {
        let directory = ReaderTestDirectory::new();
        let store = if pooled { snapback4_core::Store::open(&directory.0.join("store.sqlite")).unwrap() }
            else { snapback4_core::Store::memory().unwrap() };
        let host = Host::with_store(true, store, "use personas alice\nmutation change():\n  return 1\nmutation refuse():\n  require false else PRIVATE\nquery page():\n  return [1]\nquery refused():\n  require false else PRIVATE\n  return [1]\n");
        let headers = "x-snapback-persona: alice\r\n";
        let identity = body(&host.request("GET", "/probe", headers, ""))["store_id"].clone();
        assert!(identity.as_str().is_some_and(|id| !id.is_empty()));
        for (path, payload) in [("/q/missing", "{}"), ("/m/missing", "{}"), ("/q/page", "not JSON"), ("/q/page", r#"{"args":{"extra":1}}"#), ("/q/change", "{}"), ("/m/page", "{}")] {
            let refused = body(&host.request("POST", path, headers, payload));
            assert!(refused.get("denied").is_some(), "{path}: {refused}");
            assert_eq!(refused["store_id"], identity, "{path}: {refused}");
            assert_eq!(refused["head"], 0);
        }
        let first = body(&host.request("POST", "/m/change", headers, r#"{"id":"first","args":{}}"#));
        let second = body(&host.request("POST", "/m/change", headers, r#"{"id":"second","args":{}}"#));
        assert_eq!(first["state"], "sent");
        assert_eq!(first["store_id"], identity);
        assert!(second["seq"].as_u64().unwrap() > first["seq"].as_u64().unwrap());
        let replay = body(&host.request("POST", "/m/change", headers, r#"{"id":"first","args":{}}"#));
        assert_eq!(replay["replayed"], true);
        assert_eq!(replay["seq"], first["seq"]);
        assert_eq!(replay["head"], second["seq"]);
        assert_eq!(replay["store_id"], identity);
        let query = body(&host.request("POST", "/q/page", headers, "{}"));
        assert_eq!(query["data"], json!([1]));
        assert_eq!(query["store_id"], identity);
        assert_eq!(query["seq"], second["seq"]);
        let refused = body(&host.request("POST", "/q/refused", headers, "{}"));
        assert_eq!(refused["denied"]["code"], "PRIVATE");
        assert_eq!(refused["store_id"], identity);
        assert_eq!(refused["head"], second["seq"]);
        let failed = body(&host.request("POST", "/m/refuse", headers, r#"{"id":"failed","args":{}}"#));
        assert_eq!(failed["state"], "failed");
        assert_eq!(failed["store_id"], identity);
        let recollected = body(&host.request("POST", "/m/refuse", headers, r#"{"id":"failed","args":{}}"#));
        assert_eq!(recollected["replayed"], true);
        assert_eq!(recollected["store_id"], identity);
        assert_eq!(recollected["head"], failed["head"]);
    }
}

#[test]
fn an_idless_mutation_cannot_execute_on_the_wrong_store() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(),
        "use personas alice\nmutation change():\n  return 1\n");
    let headers = "x-snapback-persona: alice\r\n";
    let identity = body(&host.request("GET", "/probe", headers, ""))["store_id"].clone();
    let payload = |store: Json| json!({ "args": {}, "store_id": store }).to_string();
    let refused = body(&host.request("POST", "/m/change", headers, &payload(json!("another-store"))));
    assert_eq!(refused["why"]["code"], "E_STORE_REPLACED");
    assert_eq!(refused["head"], 0, "the idless request cannot commit on the replacement");
    let accepted = body(&host.request("POST", "/m/change", headers, &payload(identity)));
    assert_eq!(accepted["state"], "sent");
    assert!(accepted["seq"].as_u64().unwrap() > 0);
}
