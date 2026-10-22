//! Internal in-process host only: no public serve selector, lease or worker claim.
// @ref LLP 3000.009.001.000#3.4 — identified mutations and queries use the common engine over Postgres.
use super::*;
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn s10c_postgres_internal_http_host_witness() {
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private scripts/test-postgres.sh database");
    let namespace = format!("sb4_eval_http_{:x}", snapback4_core::ids::seed());
    let source = "use identity\ntable notes:\n  n: int\n  public\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public\nmutation put(key: id, n: int):\n  upsert notes[key] { n }\n  return n\nquery peek(key: id):\n  return notes[key]\nmutation refuse():\n  require false else NO\n";
    let host = Host::with_store(false, snapback4_core::store_port::AnyStore::create_postgres(&connection, &namespace).unwrap(), source);
    let session = body(&host.request("POST", "/auth/guest", "", "{}"));
    let token = session["session"]["token"].as_str().expect("guest session");
    let headers = format!("Authorization: Bearer {token}\r\n");
    let probe = host.request("GET", "/probe", &headers, "");
    assert_eq!(status(&probe), 200, "{probe}");
    let identity = body(&probe)["store_id"].clone();
    assert!(identity.as_str().is_some_and(|id| !id.is_empty()));
    let request = |id: &str, n: i64| json!({ "id": id, "args": { "key": "n1", "n": n }, "store_id": identity }).to_string();
    let sent = body(&host.request("POST", "/m/put", &headers, &request("first", 7)));
    assert_eq!(sent["state"], "sent", "{sent}"); assert_eq!(sent["seq"], 1); assert!(sent["preserved"].is_null());
    let replay = body(&host.request("POST", "/m/put", &headers, &request("first", 7)));
    assert_eq!(replay["replayed"], true); assert_eq!(replay["seq"], 1); assert!(replay.get("result").is_none());
    let reused = body(&host.request("POST", "/m/put", &headers, &request("first", 8)));
    assert_eq!(reused["why"]["code"], "E_ID_REUSED");
    let page = body(&host.request("POST", "/q/peek", &headers, r#"{"args":{"key":"n1"}}"#));
    assert_eq!(page["data"]["n"], 7, "{page}"); assert_eq!(page["seq"], 1); assert_eq!(page["store_id"], identity);
    let refused = body(&host.request("POST", "/m/refuse", &headers, r#"{"id":"failed","args":{}}"#));
    assert_eq!(refused["state"], "failed"); assert_eq!(refused["why"]["code"], "NO");
    let replay = body(&host.request("POST", "/m/refuse", &headers, r#"{"id":"failed","args":{}}"#));
    assert_eq!(replay["replayed"], true);
    { let engine = lock(&host.shared.engine); assert!(engine.store().preserved_between(engine.schema(), 0, 1).is_none()); }
    let response = host.request("POST", "/auth/logout", &headers, "{}");
    assert_eq!(status(&response), 200, "{response}");
    let logged_out = body(&response);
    assert!(!logged_out.to_string().contains("E_STORE_UNSUPPORTED"), "{logged_out}");
    let denied = host.request("POST", "/q/peek", &headers, r#"{"args":{"key":"n1"}}"#);
    assert_ne!(status(&denied), 200, "{denied}");
    admitted_identity_members(&host);
}

// Exercise the shared-port identity writers, rather than only the legacy
// concrete-adapter parity fixtures. These operations take no public sequence.
fn admitted_identity_members(host: &Host) {
    let signed_in = |path: &str, headers: &str, payload: &str| {
        let response = host.request("POST", path, headers, payload);
        assert_eq!(status(&response), 200, "{path}: {response}");
        body(&response)["session"].clone()
    };
    let headers = |session: &serde_json::Value| format!("Authorization: Bearer {}\r\n", session["token"].as_str().expect("session token"));
    let allowed = |session: &serde_json::Value| {
        let response = host.request("POST", "/q/peek", &headers(session), r#"{"args":{"key":"n1"}}"#);
        assert_eq!(status(&response), 200, "{response}");
        assert_eq!(body(&response)["seq"], 1);
        assert_eq!(body(&response)["data"]["n"], 7);
    };
    let denied = |session: &serde_json::Value| {
        let response = host.request("POST", "/q/peek", &headers(session), r#"{"args":{"key":"n1"}}"#);
        assert_ne!(status(&response), 200, "{response}");
        assert!(!response.contains("E_STORE_UNSUPPORTED"), "{response}");
    };
    for scope in ["full", "read"] {
        let payload = json!({"email": format!("{scope}@s10d.test"), "password": "s10d-test-password", "scope": scope}).to_string();
        let signup = signed_in("/auth/signup", "", &payload);
        assert_eq!(signup["scope"], scope);
        allowed(&signup);
        let duplicate = host.request("POST", "/auth/signup", "", &payload);
        assert_ne!(status(&duplicate), 200, "{duplicate}");
        assert_eq!(body(&duplicate)["denied"]["code"], "E_AUTH");
        let login = signed_in("/auth/login", "", &payload);
        assert_eq!(login["principal"], signup["principal"]);
        allowed(&login);
        let refreshed = signed_in("/auth/refresh", &headers(&signup), "{}");
        denied(&signup);
        allowed(&refreshed);
        if scope == "read" {
            assert!(signup["capExpiresAt"].as_i64().is_some());
            assert_eq!(refreshed["capExpiresAt"], signup["capExpiresAt"]);
        } else {
            let narrow = signed_in("/auth/narrow", &headers(&refreshed), "{}");
            assert_eq!(narrow["scope"], "read");
            assert!(narrow["capExpiresAt"].as_i64().is_some());
            allowed(&narrow);
            let rotated = signed_in("/auth/refresh", &headers(&narrow), "{}");
            assert_eq!(rotated["capExpiresAt"], narrow["capExpiresAt"]);
            denied(&narrow);
            allowed(&rotated);
            let response = host.request("POST", "/auth/logout", &headers(&rotated), "{}");
            assert_eq!(status(&response), 200, "{response}");
            denied(&rotated);
            allowed(&refreshed);
        }
        let response = host.request("POST", "/auth/logout", &headers(&refreshed), "{}");
        assert_eq!(status(&response), 200, "{response}");
        denied(&refreshed);
        // Logout of one family leaves the separately minted login live.
        allowed(&login);
        if scope == "full" {
            let response = host.request("POST", "/auth/logout-all", &headers(&login), "{}");
            assert_eq!(status(&response), 200, "{response}");
            denied(&login);
        }
    }
    let guest = signed_in("/auth/guest", "", r#"{"scope":"read"}"#);
    assert_eq!(guest["scope"], "read");
    allowed(&guest);
    let engine = lock(&host.shared.engine);
    let expired = snapback4_core::identity::open_session(engine.store(), "member:expired", "account", 1).unwrap();
    assert!(snapback4_core::identity::resolve(engine.store(), &expired.token, host.shared.now()).unwrap().is_none());
    let session = snapback4_core::identity::open_session(engine.store(), "member:close", "account", host.shared.now()).unwrap();
    assert!(snapback4_core::identity::resolve(engine.store(), &session.token, host.shared.now()).unwrap().is_some());
    snapback4_core::identity::close_session(engine.store(), &session.token).unwrap();
    assert!(snapback4_core::identity::resolve(engine.store(), &session.token, host.shared.now()).unwrap().is_none());
    snapback4_core::identity::clear_worker_families(engine.store()).unwrap();
    assert_eq!(engine.seq().unwrap(), 1);
}
