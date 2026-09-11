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
