use super::*;

#[test]
fn following_http_binding_replay_refusals_and_independent_cancellation() {
    let source = format!(
        "use identity\n{}",
        include_str!("../../../snapback4-lang/tests/fixtures/following-view.q")
    );
    let h = Host::with_store(true, snapback4_core::Store::memory().unwrap(), &source);
    let auth = "x-snapback-persona: reader\r\n";
    assert_eq!(
        status(&h.request("POST", "/following/cards", "", "{}")),
        401
    );
    assert_eq!(
        status(&h.request("POST", "/following/cards", auth, "{")),
        400
    );
    let call = |op: &str, value: Json| {
        body(&h.request(
            "POST",
            &format!("/following/{op}"),
            auth,
            &value.to_string(),
        ))
    };
    let open = || call("cards", json!({"action":"open","args":{"c":null}}))["opening"].clone();
    let a = open();
    let b = open();
    assert_ne!(a, b);
    let unit = |opening: Json| json!({"action":"unit","opening":opening,"args":{"c":null}});
    call(
        "home",
        json!({"action":"cancel","opening":a,"args":{"c":null}}),
    );
    let first = call("cards", unit(a.clone()));
    assert_eq!(first["phase"], "page");
    call(
        "home",
        json!({"action":"cancel","opening":a,"args":{"c":null}}),
    );
    assert_eq!(call("cards", unit(a.clone())), first);
    assert_eq!(
        call(
            "cards",
            json!({"action":"refresh","opening":a,"args":{"c":null},"mounted":[]})
        )["phase"],
        "page"
    );
    assert_eq!(
        call(
            "cards",
            json!({"action":"refresh","opening":a,"args":{"c":null},"seen":42})
        )["code"],
        "E_FOLLOWING_INPUT"
    );
    call(
        "cards",
        json!({"action":"cancel","opening":a,"args":{"c":null}}),
    );
    assert_eq!(call("cards", unit(a))["phase"], "restart");
    assert_eq!(call("cards", unit(b))["phase"], "page");
}
