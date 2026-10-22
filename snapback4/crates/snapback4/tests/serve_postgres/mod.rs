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
}
