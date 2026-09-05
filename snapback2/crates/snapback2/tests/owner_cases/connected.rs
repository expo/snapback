use super::*;

fn call(port: u16, path: &str, body: Value, token: Option<&str>) -> Value {
    let bearer = token.map(|token| format!("Bearer {token}"));
    let headers = bearer
        .as_deref()
        .map_or(vec![("X-Snapback-As", "alice")], |token| {
            vec![("Authorization", token)]
        });
    let response = request(port, "POST", path, &headers, body);
    assert_eq!(response.status, 200, "{}", response.body);
    response.body
}

#[test]
fn connected_tracks_transports_coalesces_keys_and_fences_revoked_sessions() {
    let root = temp_root();
    fs::create_dir_all(root.join("snapback")).unwrap();
    fs::write(
        root.join("snapback/schema.q"),
        "use identity password\ntable notes:\n  body: text <=100\n  public\n",
    )
    .unwrap();
    fs::write(
        root.join("snapback/presence.q"),
        r#"
query count(p: principal):
  return #connected[p]
query ping():
  return true
mutation gate(p: principal):
  require exists connected[p] else OFFLINE
  return { count: #connected[p], again: #connected[p], online: exists connected[p] }
"#,
    )
    .unwrap();
    let compiler = compiler(&root);
    let mut owner = ChildGuard::spawn(env!("CARGO_BIN_EXE_snapback2"), &compiler, &root);
    let port: u16 = owner
        .ready_line()
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let info: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = info["secret"].as_str().unwrap();
    let signup = call(
        port,
        "/api/auth/signup",
        json!({ "email": "connected@example.com", "password": "password123" }),
        None,
    );
    let token = signup["token"].as_str().unwrap();
    let principal = signup["viewer"].as_str().unwrap();
    let args = json!({ "p": principal });
    let query_path =
        format!("/api/subscribe?op=presence.count&args=%7B%22p%22%3A%22{principal}%22%7D");
    let mut observer = Sse::open(port, &query_path, "alice");
    assert_eq!(observer.event()["data"], 0);
    let envelope = call(
        port,
        "/api/query",
        json!({"op":"presence.count", "args":args, "receipt":true}),
        None,
    );
    assert_eq!(envelope["connected"], true);
    let conditional = call(
        port,
        "/api/query",
        json!({"op":"presence.count", "args":args, "receipt":true, "validator":envelope["validator"]}),
        None,
    );
    assert_eq!(
        conditional["state"], "complete",
        "connected answers cannot be cached conditionally"
    );
    let mut unrelated = Sse::open(
        port,
        "/api/subscribe?op=presence.count&args=%7B%22p%22%3A%22dev:carol%22%7D",
        "alice",
    );
    assert_eq!(unrelated.event()["data"], 0);
    assert_eq!(
        call(
            port,
            "/api/mutation",
            json!({"op":"presence.gate", "args":args}),
            None
        )["code"],
        "OFFLINE"
    );

    let started = Instant::now();
    let mut first = Sse::live_bearer(port, token);
    let session = first.event()["session"].clone();
    // Opening and two independent subscriptions share one transport count.
    call(
        port,
        "/api/live/control",
        json!({ "session": session, "add": [
        { "id": "one", "path": "/api/subscribe?op=presence.ping&args=%7B%7D" },
        { "id": "two", "path": "/api/subscribe?op=presence.ping&args=%7B%7D" }
    ] }),
        Some(token),
    );
    first.event();
    first.event();
    assert_eq!(
        call(
            port,
            "/api/mutation",
            json!({"op":"presence.gate", "args":args}),
            None
        )["data"],
        json!({"count":1,"again":1,"online":true})
    );
    assert_eq!(observer.event()["data"], 1);
    assert!(
        started.elapsed() < Duration::from_millis(1600),
        "connect missed the one-second coalesce"
    );
    unrelated.assert_silent(Duration::from_millis(50));

    let mut second = Sse::live_bearer(port, token);
    second.event();
    assert_eq!(observer.event()["data"], 2);
    let started = Instant::now();
    call(
        port,
        "/api/live/control",
        json!({ "session": session, "close": true }),
        Some(token),
    );
    assert_eq!(observer.event()["data"], 1);
    assert!(
        started.elapsed() < Duration::from_millis(1600),
        "close missed the one-second coalesce"
    );
    let started = Instant::now();
    call(port, "/api/auth/logout", json!({}), Some(token));
    let terminal = second.event();
    assert_eq!(terminal["terminal"], true);
    assert_eq!(terminal["data"]["code"], "E_AUTH_SESSION");
    assert_eq!(observer.event()["data"], 0);
    assert!(
        started.elapsed() < Duration::from_millis(1600),
        "revocation missed the one-second coalesce"
    );
    assert_eq!(
        call(
            port,
            "/api/mutation",
            json!({"op":"presence.gate", "args":args}),
            None
        )["code"],
        "OFFLINE"
    );
    drop((first, second, observer, unrelated));
    stop_owner(port, secret, &mut owner, "connected test");
    fs::remove_dir_all(root).unwrap();
}
