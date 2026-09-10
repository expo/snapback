use super::*;

// LLP 1021 §6: the chat template seeds fixture handles, so a real signup can
// take `alice`, and `charlie` still has the absent-row profile path. Engine-free,
// so it runs on the default and Hermes builds alike.
#[test]
fn seeded_chat_leaves_alice_for_a_real_signup_and_charlie_without_a_profile() {
    let root = temp_root();
    copy_tree(
        &Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/snapback2/templates/chat/snapback"),
        &root.join("snapback"),
    );
    let compiler = compiler(&root);
    let mut owner = ChildGuard::spawn(env!("CARGO_BIN_EXE_snapback2"), &compiler, &root);
    let port: u16 = owner
        .ready_line()
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let record: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = record["secret"].as_str().unwrap().to_owned();
    let signup = request(
        port,
        "POST",
        "/api/auth/signup",
        &[],
        json!({"email":"alice@example.com", "password":"correct horse"}),
    );
    assert_eq!(signup.status, 200, "{}", signup.body);
    let token = format!("Bearer {}", signup.body["token"].as_str().unwrap());
    let profile = request(
        port,
        "POST",
        "/api/mutation",
        &[("Authorization", &token)],
        json!({"op":"profiles.createMyProfile", "args":{"displayName":"Alice", "handle":"alice", "bio":"", "location":""}}),
    );
    assert_eq!(profile.body["state"], "committed", "{}", profile.body);
    assert_eq!(profile.body["data"]["handle"], "alice", "{}", profile.body);
    let charlie = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "charlie")],
        json!({"op":"profiles.mine", "args":{}}),
    );
    assert_eq!(charlie.body["data"], Value::Null, "{}", charlie.body);
    let created = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "charlie")],
        json!({"op":"profiles.createMyProfile", "args":{"displayName":"Charlie", "handle":"charlie", "bio":"", "location":""}}),
    );
    assert_eq!(created.body["state"], "committed", "{}", created.body);
    assert_eq!(created.body["data"]["handle"], "charlie", "{}", created.body);
    stop_owner(port, &secret, &mut owner, "fixture handles");
    fs::remove_dir_all(root).unwrap();
}
