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
  return connected[p]
query ping():
  return true
mutation gate(p: principal):
  require exists connected[p] else OFFLINE
  return { count: connected[p], again: connected[p], online: exists connected[p] }
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

fn with_connected_owner(run: impl FnOnce(&Path, u16, &str, &str, &str, &Path)) {
    let root = temp_root();
    fs::create_dir_all(root.join("snapback")).unwrap();
    fs::write(root.join("snapback/schema.q"), "use identity password\ntable notes:\n  body: text <=100\n  public\nchannel activity():\n  value: { ready: bool }\n  publish <- allow\n  subscribe <- allow\n  ttl 5s\n").unwrap();
    fs::write(
        root.join("snapback/presence.q"),
        "query count(p: principal):\n  return connected[p]\nquery ping():\n  return true\n",
    )
    .unwrap();
    let compiler = compiler(&root);
    let mut owner = ChildGuard::spawn(env!("CARGO_BIN_EXE_snapback2"), &compiler, &root);
    let port = owner
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
        json!({"email":"edges@example.com", "password":"password123"}),
        None,
    );
    run(
        &root,
        port,
        secret,
        signup["token"].as_str().unwrap(),
        signup["viewer"].as_str().unwrap(),
        &compiler,
    );
    stop_owner(port, secret, &mut owner, "connected edges");
    fs::remove_dir_all(root).unwrap();
}

fn count(port: u16, principal: &str) -> Value {
    call(
        port,
        "/api/query",
        json!({"op":"presence.count", "args":{"p":principal}}),
        None,
    )["data"]
        .clone()
}

fn observer(port: u16, principal: &str) -> Sse {
    let mut observer = Sse::open(
        port,
        &format!("/api/subscribe?op=presence.count&args=%7B%22p%22%3A%22{principal}%22%7D"),
        "alice",
    );
    assert_eq!(observer.event()["data"], 0);
    observer
}

#[test]
fn connected_batches_two_connects_with_lower_and_upper_time_bounds() {
    with_connected_owner(|_, port, _, token, principal, _| {
        let mut observer = observer(port, principal);
        // Drain the observer persona's own coalesce window before timing A.
        observer.assert_silent(Duration::from_millis(1100));
        let started = Instant::now();
        let mut a = Sse::live_bearer(port, token);
        let session_a = a.event()["session"].clone();
        thread::sleep(Duration::from_millis(100));
        let mut b = Sse::live_bearer(port, token);
        let session_b = b.event()["session"].clone();
        observer.assert_silent(Duration::from_millis(100));
        assert_eq!(observer.event()["data"], 2);
        let elapsed = started.elapsed();
        assert!(
            elapsed >= Duration::from_millis(800),
            "coalesce delivered too early: {elapsed:?}"
        );
        assert!(
            elapsed < Duration::from_millis(1600),
            "coalesce delivered too late: {elapsed:?}"
        );
        observer.assert_silent(Duration::from_millis(1100));
        for session in [session_a, session_b] {
            call(
                port,
                "/api/live/control",
                json!({"session":session,"close":true}),
                Some(token),
            );
        }
    });
}

#[test]
fn connected_close_ack_releases_each_sse_worker_before_the_next_open() {
    with_connected_owner(|_, port, _, token, _, _| {
        let mut retired = Vec::new();
        for attempt in 0..96 {
            let mut stream = Sse::live_bearer(port, token);
            let session = stream.event()["session"].clone();
            call(
                port,
                "/api/live/control",
                json!({"session":session,"close":true}),
                Some(token),
            );
            retired.push(stream);
            assert_eq!(retired.len(), attempt + 1);
        }
        for stream in &mut retired {
            stream.assert_closed();
        }
    });
}

#[test]
fn connected_counts_legacy_query_and_channel_transports_and_fences_both_on_logout() {
    with_connected_owner(|_, port, _, token, principal, _| {
        let mut query =
            Sse::open_bearer(port, "/api/subscribe?op=presence.ping&args=%7B%7D", token);
        assert_eq!(query.event()["data"], true);
        let mut channel =
            Sse::open_bearer(port, "/api/channel/activity/subscribe?args=%7B%7D", token);
        assert_eq!(channel.event()["entries"], json!([]));
        assert_eq!(count(port, principal), 2);
        call(port, "/api/auth/logout", json!({}), Some(token));
        for stream in [&mut query, &mut channel] {
            assert_eq!(stream.event()["code"], "E_AUTH_SESSION");
            stream.assert_closed();
        }
        assert_eq!(count(port, principal), 0);
    });
}

#[test]
fn connected_logout_fences_only_one_of_two_sessions_for_the_same_principal() {
    with_connected_owner(|_, port, _, token_a, principal, _| {
        let login = call(
            port,
            "/api/auth/login",
            json!({"email":"edges@example.com", "password":"password123"}),
            None,
        );
        assert_eq!(login["viewer"], principal);
        let token_b = login["token"].as_str().unwrap();
        assert_ne!(token_a, token_b);
        let mut a = Sse::live_bearer(port, token_a);
        a.event();
        let mut b = Sse::live_bearer(port, token_b);
        let session_b = b.event()["session"].clone();
        assert_eq!(count(port, principal), 2);
        call(port, "/api/auth/logout", json!({}), Some(token_a));
        let terminal = a.event();
        assert_eq!(terminal["terminal"], true);
        assert_eq!(terminal["data"]["code"], "E_AUTH_SESSION");
        a.assert_closed();
        assert_eq!(count(port, principal), 1);
        b.assert_silent(Duration::from_millis(100));
        call(
            port,
            "/api/live/control",
            json!({"session":session_b,"close":true}),
            Some(token_b),
        );
        b.assert_closed();
        assert_eq!(count(port, principal), 0);
    });
}

#[test]
fn connected_anonymous_stream_is_uncounted_and_authenticated_stream_counts() {
    with_connected_owner(|_, port, _, token, principal, _| {
        let refused = request(
            port,
            "GET",
            "/api/subscribe?op=presence.ping&args=%7B%7D",
            &[],
            json!({}),
        );
        assert_eq!(refused.status, 401);
        assert_eq!(refused.body["code"], "E_AUTH_REQUIRED");
        // The multiplexed transport may open anonymously; its public query
        // child still requires auth, and neither registration counts a user.
        let mut anonymous = Sse::live_anonymous(port);
        let anonymous_session = anonymous.event()["session"].clone();
        let added = request(
            port,
            "POST",
            "/api/live/control",
            &[],
            json!({"session":anonymous_session,
            "add":[{"id":"public","path":"/api/subscribe?op=presence.ping&args=%7B%7D"}]}),
        );
        assert_eq!(added.status, 200, "{}", added.body);
        let terminal = anonymous.event();
        assert_eq!(terminal["terminal"], true);
        assert_eq!(terminal["data"]["code"], "E_AUTH_REQUIRED");
        assert_eq!(count(port, principal), 0);
        assert_eq!(count(port, "dev:carol"), 0);
        let mut authenticated = Sse::live_bearer(port, token);
        let session = authenticated.event()["session"].clone();
        assert_eq!(count(port, principal), 1);
        let mut persona = Sse::live(port, "carol");
        let persona_session = persona.event()["session"].clone();
        assert_eq!(count(port, "dev:carol"), 1);
        let response = request(
            port,
            "POST",
            "/api/live/control",
            &[("X-Snapback-As", "carol")],
            json!({"session":persona_session,"close":true}),
        );
        assert_eq!(response.status, 200);
        call(
            port,
            "/api/live/control",
            json!({"session":session,"close":true}),
            Some(token),
        );
        assert_eq!(count(port, principal), 0);
        let closed = request(
            port,
            "POST",
            "/api/live/control",
            &[],
            json!({"session":anonymous_session,"close":true}),
        );
        assert_eq!(closed.status, 200);
    });
}

#[test]
fn connected_expiry_sweep_terminates_a_stream_with_short_remaining_session_life() {
    with_connected_owner(|_, port, secret, token, principal, _| {
        // Use the existing dev clock, leaving only a few seconds on the session.
        let advance = |ms| {
            let result = request(
                port,
                "POST",
                "/control/clock",
                &[("X-Snapback-Control", secret)],
                json!({"advanceMs":ms}),
            );
            assert_eq!(result.status, 200, "{}", result.body);
        };
        advance(24_i64 * 60 * 60 * 1000 - 5000);
        let mut stream = Sse::live_bearer(port, token);
        stream.event();
        assert_eq!(count(port, principal), 1);
        advance(6000);
        let terminal = stream.event();
        assert_eq!(terminal["terminal"], true);
        assert_eq!(terminal["data"]["code"], "E_AUTH_SESSION");
        stream.assert_closed();
        assert_eq!(count(port, principal), 0);
    });
}

#[test]
fn connected_survives_generation_succession_and_the_live_query_reruns() {
    with_connected_owner(|root, port, secret, token, principal, compiler| {
        let mut observer = observer(port, principal);
        let mut stream = Sse::live_bearer(port, token);
        let session = stream.event()["session"].clone();
        assert_eq!(observer.event()["data"], 1);
        let source = root.join("snapback/presence.q");
        let text = fs::read_to_string(&source).unwrap().replace(
            "return connected[p]",
            "return { count: connected[p], generation: 2 }",
        );
        fs::write(source, text).unwrap();
        let checked = Command::new(env!("CARGO_BIN_EXE_snapback2"))
            .args(["check", "--json", "--project"])
            .arg(root)
            .env("SNAPBACK2_COMPILER", compiler)
            .output()
            .unwrap();
        assert!(
            checked.status.success(),
            "{}",
            String::from_utf8_lossy(&checked.stdout)
        );
        let project: Value =
            serde_json::from_slice(&fs::read(root.join(".snapback/build/project.json")).unwrap())
                .unwrap();
        let applied = request(
            port,
            "POST",
            "/control/apply",
            &[("X-Snapback-Control", secret)],
            json!({"project":project}),
        );
        assert_eq!(applied.status, 200, "{}", applied.body);
        assert_eq!(observer.event()["data"], json!({"count":1,"generation":2}));
        assert_eq!(count(port, principal), json!({"count":1,"generation":2}));
        call(
            port,
            "/api/live/control",
            json!({"session":session,"close":true}),
            Some(token),
        );
    });
}

// Slow: exercise real 15 s heartbeat writes without a test-only timing knob.
#[test]
fn connected_silent_socket_shutdown_and_legacy_close_drop_counts_slow() {
    with_connected_owner(|_, port, _, token, principal, _| {
        let mut live = Sse::live_bearer(port, token);
        live.event();
        let mut query =
            Sse::open_bearer(port, "/api/subscribe?op=presence.ping&args=%7B%7D", token);
        query.event();
        let mut channel =
            Sse::open_bearer(port, "/api/channel/activity/subscribe?args=%7B%7D", token);
        assert_eq!(channel.event()["entries"], json!([]));
        assert_eq!(count(port, principal), 3);
        live.shutdown();
        query.shutdown();
        channel.shutdown();
        drop((live, query, channel));
        // TCP can acknowledge one buffered write before the reset is observed;
        // allow two heartbeats without turning that into a detection guarantee.
        thread::sleep(Duration::from_secs(16));
        wait_for(Duration::from_secs(20), || {
            (count(port, principal) == 0).then_some(())
        });
        assert_eq!(count(port, principal), 0);
    });
}
