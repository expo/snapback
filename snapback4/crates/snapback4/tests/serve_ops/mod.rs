use super::*;

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
