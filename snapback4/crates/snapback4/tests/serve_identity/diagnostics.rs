use super::*;

#[test]
fn dev_auth_explains_unknown_expired_and_revoked_bearers_serve_discloses_no_cause() {
    use snapback4_core::identity::{self, SessionScope};
    for dev in [true, false] {
        for read_only in [false, true] {
            let host = Host::new(dev);
            let (expired, revoked, rotated) = {
                let mut engine = lock(&host.shared.engine);
                identity::diagnostics::configure(engine.store(), dev).unwrap();
                let now = host.shared.now();
                let make = |engine: &mut Engine, at| {
                    let full = identity::open_session(engine.store(), "guest:alice", "guest", at).unwrap();
                    if read_only { identity::narrow_session(engine.store_mut(), &full.token, || identity::ServiceSample { now: at, supervisor_revision: 0 }).unwrap() } else { full }
                };
                let expired = make(&mut engine, now - 8 * 86_400_000);
                let revoked = make(&mut engine, now);
                let rotated = make(&mut engine, now);
                identity::logout_session(engine.store_mut(), &revoked.token, || now).unwrap();
                identity::rotate_session(engine.store(), &rotated.token, now).unwrap().unwrap();
                assert_eq!(revoked.scope, if read_only { SessionScope::Read } else { SessionScope::Full });
                (expired.token, revoked.token, rotated.token)
            };
            for (token, cause) in [("foreign-store-token".to_owned(), "unknown to this store"), (expired, "expired"), (revoked, "signed out, revoked"), (rotated, "replaced by refresh")] {
                for (method, path) in [("POST", "/q/who"), ("GET", "/schema"), ("GET", "/changes?wait=0"), ("POST", "/auth/refresh")] {
                    let response = host.request(method, path, &format!("Authorization: Bearer {token}\r\n"), r#"{"args":{}}"#);
                    let denied = body(&response)["denied"].clone();
                    assert_eq!(denied["code"], "E_AUTH", "{response}");
                    assert_eq!(denied["family"], "auth");
                    let message = denied["message"].as_str().unwrap();
                    if dev { assert!(message.contains(cause), "{cause}: {response}"); }
                    else { assert_eq!(message, "this session is not live; sign in again"); }
                    assert!(message.contains("sign in again"));
                    assert!(!denied.to_string().contains(&token));
                    assert!(denied.get("reason").is_none());
                }
            }
            let response = body(&host.request("POST", "/q/who", "", r#"{"args":{}}"#));
            assert!(response["denied"]["message"].as_str().unwrap().starts_with("sign in"));
        }
    }
}
