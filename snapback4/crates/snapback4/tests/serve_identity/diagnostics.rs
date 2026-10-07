use super::*;
use snapback4_core::identity::{self, SessionScope};

fn refused_tokens(host: &Host, read_only: bool) -> Vec<(String, &'static str)> {
    let mut engine = lock(&host.shared.engine);
    let now = host.shared.now();
    let make = |engine: &mut Engine, at| {
        let full = identity::open_session(engine.store(), "guest:alice", "guest", at).unwrap();
        if read_only { identity::narrow_session(engine.store_mut(), &full.token, || identity::ServiceSample { now: at, supervisor_revision: 0 }).unwrap() } else { full }
    };
    let revoked = make(&mut engine, now);
    let rotated = make(&mut engine, now);
    identity::logout_session(engine.store_mut(), &revoked.token, || now).unwrap();
    identity::rotate_session(engine.store(), &rotated.token, now).unwrap().unwrap();
    // Issue last: issuance prunes older expired records, which then become unknown.
    let expired = make(&mut engine, now - 8 * 86_400_000);
    assert_eq!(revoked.scope, if read_only { SessionScope::Read } else { SessionScope::Full });
    vec![("foreign-store-token".to_owned(), "unknown to this store"),
         (expired.token, "expired on the server clock"),
         (revoked.token, "unknown to this store"), (rotated.token, "unknown to this store")]
}

fn assert_refusal(response: &str, token: &str, cause: &str, trusted_dev: bool) {
    let denied = body(response)["denied"].clone();
    assert_eq!(denied["code"], "E_AUTH", "{response}");
    assert_eq!(denied["family"], "auth");
    let message = denied["message"].as_str().unwrap();
    if trusted_dev {
        assert!(message.contains(cause), "{cause}: {response}");
        if cause == "unknown to this store" {
            for hint in ["earlier or replaced store", "expired or been signed out", "before this server started", "discard saved tokens from an earlier store"] {
                assert!(message.contains(hint), "{hint}: {response}");
            }
        }
    } else { assert_eq!(message, "this session is not live; sign in again"); }
    assert!(message.contains("sign in again"));
    assert!(!denied.to_string().contains(token));
    assert!(denied.get("reason").is_none());
}

#[test]
fn dev_auth_explains_refused_bearers_without_history_serve_discloses_no_cause() {
    for dev in [true, false] {
        for read_only in [false, true] {
            let host = Host::new(dev);
            for (token, cause) in refused_tokens(&host, read_only) {
                for (method, path) in [("POST", "/q/who"), ("GET", "/schema"), ("GET", "/changes?wait=0"), ("POST", "/auth/refresh")] {
                    let response = host.request(method, path, &format!("Authorization: Bearer {token}\r\n"), r#"{"args":{}}"#);
                    assert_refusal(&response, &token, cause, dev);
                }
            }
            let response = body(&host.request("POST", "/q/who", "", r#"{"args":{}}"#));
            assert!(response["denied"]["message"].as_str().unwrap().starts_with("sign in"));
        }
    }
}

#[test]
fn public_routes_disclose_no_token_standing_outside_the_dev_trust_boundary() {
    for dev in [true, false] {
        for read_only in [false, true] {
            let host = Host::with_store(dev, snapback4_core::Store::memory().unwrap(),
                "use identity\nuse server\nroute declared: post \"/declared\" wait 1ms\n");
            for (token, cause) in refused_tokens(&host, read_only) {
                for (authority, origin, trusted) in [
                    ("localhost", "", true),
                    ("localhost", "Origin: http://127.0.0.1:4402\r\n", true),
                    ("untrusted.example", "", false),
                    ("localhost", "Origin: https://untrusted.example\r\n", false),
                    ("untrusted.example", "Origin: https://untrusted.example\r\n", false),
                    ("localhost", "Origin: null\r\n", false),
                    ("localhost", "Origin: http://localhost\r\nOrigin: http://localhost\r\n", false),
                ] {
                    let response = exchange(host.address, &format!(
                        "POST /declared HTTP/1.1\r\nHost: {authority}\r\n{origin}Authorization: Bearer {token}\r\nConnection: close\r\nContent-Length: 2\r\n\r\n{{}}"));
                    assert_refusal(&response, &token, cause, dev && trusted);
                }
            }
        }
    }
}
