use super::*;

#[test]
fn http_mutation_nul_id_is_refused_without_a_receipt_or_commit() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(),
        "use personas alice\nmutation ping():\n  return 1\n");
    let changes = (match lock(&host.shared.engine).store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes();
    let response = host.request("POST", "/m/ping", "x-snapback-persona: alice\r\n", r#"{"id":"op\u0000id","args":{}}"#);
    assert_eq!(body(&response)["state"], "failed", "{response}");
    assert_eq!(body(&response)["why"]["code"], "E_INPUT", "{response}");
    let engine = lock(&host.shared.engine);
    assert_eq!((match engine.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes(), changes);
    for table in ["_ops", "_commits"] {
        assert_eq!((match engine.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }
}

#[test]
fn production_auth_refusals_use_http_auth_statuses_and_keep_the_body() {
    let host = Host::with_store(false, snapback4_core::Store::memory().unwrap(),
        "use identity password\nquery who():\n  return viewer\nmutation ping():\n  return { ok: true }\n");
    for (route, payload) in [
        ("/auth/guest", "{}"),
        ("/auth/login", r#"{"email":"nobody@example.test","password":"wrong-password"}"#),
    ] {
        let response = host.request("POST", route, "", payload);
        assert_eq!(status(&response), 401, "{response}");
        assert_eq!(body(&response)["denied"]["code"], "E_AUTH", "{response}");
    }
    let response = host.request("POST", "/seed", "", "[]");
    assert_eq!(status(&response), 403, "{response}");
    assert_eq!(status(&host.request("POST", "/q/who", "x-snapback-persona: alice\r\n", "{}")), 401);
    let payload = r#"{"email":"ops@example.test","password":"private-test-password"}"#;
    let response = host.request("POST", "/auth/signup", "", payload);
    assert_eq!(status(&response), 200, "{response}");
    let token = body(&response)["session"]["token"].as_str().unwrap().to_owned();
    let headers = format!("Authorization: Bearer {token}\r\n");
    assert_eq!(status(&host.request("POST", "/auth/login", "", payload)), 200);
    let write = r#"{"id":"replay-test","args":{}}"#;
    let first = body(&host.request("POST", "/m/ping", &headers, write));
    assert_eq!(first["result"], json!({"ok":true}));
    let replay = body(&host.request("POST", "/m/ping", &headers, write));
    assert_eq!(replay["replayed"], true);
    assert!(replay.get("result").is_none(), "durable receipts do not retain historical results: {replay}");
    assert!(replay.get("current").is_none());
    let service = {
        let engine = lock(&host.shared.engine);
        snapback4_core::identity::service_session(engine.store(), "ops", host.shared.now(), 1).unwrap()
    };
    let headers = format!("Authorization: Bearer {}\r\n", service.token);
    for payload in [
        json!({"principal":"user:reserved"}),
        json!({"principal":"user:reserved", "binding":{"invocationId":"grant", "intent":"identity-session/v1"}}),
    ] {
        let response = host.request("POST", "/auth/session", &headers, &payload.to_string());
        assert_eq!(status(&response), 401, "{response}");
        assert_eq!(body(&response)["denied"]["code"], "E_AUTH");
    }
}
