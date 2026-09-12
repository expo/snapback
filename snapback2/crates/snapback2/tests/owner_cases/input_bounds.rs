use super::*;

#[test]
fn served_id_argument_matches_its_certificate_bound() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let messages = root.join("snapback/messages.q");
    let source =
        fs::read_to_string(&messages).unwrap() + "\nquery echoId(id: id):\n  return { id }\n";
    fs::write(messages, source).unwrap();

    let compiler = compiler(&root);
    let mut owner = ChildGuard::spawn(env!("CARGO_BIN_EXE_snapback2"), &compiler, &root);
    let port = owner
        .ready_line()
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = owner_json["secret"].as_str().unwrap();

    // @ref LLP 1001#maintained-addresses — ordinary Id arguments and the
    // certificate estimator share the 144-byte canonical tagged domain.
    let accepted = "a".repeat(135);
    let certificate: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/build/certificates.json")).unwrap())
            .unwrap();
    let output_bytes = serde_json::to_vec(&json!({
        "Row": { "id": { "Id": accepted } }
    }))
    .unwrap()
    .len() as u64;
    let output_bound = certificate["messages.echoId"]["max_output_bytes"]
        .as_u64()
        .expect("echoId output bound");
    assert!(
        output_bound >= output_bytes,
        "accepted output is not covered: bound {output_bound}, actual {output_bytes}"
    );

    let accepted_response = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        json!({ "op": "messages.echoId", "args": { "id": accepted } }),
    );
    assert_eq!(accepted_response.status, 200, "{}", accepted_response.body);
    assert_eq!(accepted_response.body["data"]["id"], accepted);

    let refused = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        json!({ "op": "messages.echoId", "args": { "id": "x".repeat(5_000) } }),
    );
    assert_eq!(refused.status, 400, "{}", refused.body);
    assert_eq!(refused.body["code"], "E_INPUT", "{}", refused.body);
    assert!(
        refused.body["message"]
            .as_str()
            .is_some_and(|message| message.contains("144 canonical tagged UTF-8 bytes")),
        "{}",
        refused.body
    );

    stop_owner(
        port,
        secret,
        &mut owner,
        "served Id argument bound verified",
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn request_lines_headers_and_browser_authority_are_bounded_before_dispatch() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let source = root.join("snapback/messages.q");
    fs::write(
        &source,
        fs::read_to_string(&source).unwrap() + "\nmutation securityProbe():\n  return true\n",
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
    let before = request(
        port,
        "GET",
        "/control/personas",
        &[("X-Snapback-Control", secret)],
        json!({}),
    )
    .body;
    for headers in [
        vec![
            ("Origin", "https://attacker.example"),
            ("X-Snapback-As", "attacker-new"),
        ],
        vec![
            ("Origin", "http://localhost:3000"),
            ("X-Snapback-As", "attacker-new"),
        ],
    ] {
        let response = request(
            port,
            "POST",
            "/api/query",
            &headers,
            json!({"op":"messages.list", "args":{}}),
        );
        assert_eq!(response.status, 403);
        assert!(
            !response
                .headers
                .to_lowercase()
                .contains("access-control-allow-origin: *")
        );
    }
    let preflight = request(
        port,
        "OPTIONS",
        "/api/query",
        &[
            ("Origin", "https://attacker.example"),
            ("Access-Control-Request-Headers", "X-Snapback-As"),
        ],
        json!({}),
    );
    assert_eq!(preflight.status, 403);
    assert!(
        !preflight
            .headers
            .to_lowercase()
            .contains("access-control-allow-origin:")
    );
    let after = request(
        port,
        "GET",
        "/control/personas",
        &[("X-Snapback-Control", secret)],
        json!({}),
    )
    .body;
    assert_eq!(before, after, "browser request minted a persona");
    let allowed = request(
        port,
        "GET",
        "/api/manifest",
        &[("Origin", "http://localhost:3000")],
        json!({}),
    );
    assert_eq!(allowed.status, 200);
    assert!(
        allowed
            .headers
            .to_lowercase()
            .contains("access-control-allow-origin: http://localhost:3000")
    );
    let query =
        json!({"op":"messages.thread", "args":{"conversationId":"conversation-1", "c":null}});
    let seq = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        query.clone(),
    )
    .body["seq"]
        .clone();
    let why = request(
        port,
        "POST",
        "/control/why",
        &[("X-Snapback-Control", secret)],
        json!({"op":"messages.securityProbe", "as":"alice"}),
    );
    assert_eq!(why.body["code"], "E_OP_KIND");
    assert_eq!(
        request(
            port,
            "POST",
            "/api/query",
            &[("X-Snapback-As", "alice")],
            query
        )
        .body["seq"],
        seq
    );
    let explicit = request(
        port,
        "POST",
        "/control/why",
        &[("X-Snapback-Control", secret)],
        json!({"op":"messages.securityProbe", "as":"alice", "queryOnly":false}),
    );
    assert_eq!(
        explicit.body["result"]["state"], "committed",
        "{}",
        explicit.body
    );
    for attempt in 0..9 {
        let response = request(
            port,
            "POST",
            "/api/auth/login",
            &[],
            json!({"email":"abuse@example.com", "password":"x".repeat(257)}),
        );
        assert_eq!(
            response.status,
            if attempt < 8 { 403 } else { 429 },
            "{}",
            response.body
        );
    }
    for (prefix, expected) in [("GET /", 414), ("GET / HTTP/1.1\r\nX-Large: ", 431)] {
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        stream
            .write_all(format!("{prefix}{}", "a".repeat(16 * 1024 + 1)).as_bytes())
            .unwrap();
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line).unwrap();
        assert!(line.contains(&format!(" {expected} ")), "{line}");
    }
    assert_eq!(status(port, secret)["status"], "ready");
    stop_owner(
        port,
        secret,
        &mut owner,
        "HTTP security boundaries verified",
    );
    fs::remove_dir_all(root).unwrap();
}
