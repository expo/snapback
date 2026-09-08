//! Product seeding through the shipped chat schema, boot and reset.
use super::*;

fn seed(groups: usize, members: usize) -> String {
    let mut personas = vec!["alice".to_owned()];
    personas.extend((1..members).map(|n| format!("member{n}")));
    let conversations: Vec<_> = (0..groups).map(|g| json!({
        "id": format!("cap-conversation-{g}"), "title": format!("Group {g}"), "creatorId": "dev:alice",
    })).collect();
    let memberships: Vec<_> = (0..groups)
        .flat_map(|g| {
            (0..members).map(move |n| json!({
        "id": format!("cap-membership-{g}-{n}"), "conversationId": format!("cap-conversation-{g}"),
        "principal": if n == 0 { "dev:alice".to_owned() } else { format!("dev:member{n}") },
        "role": if n == 0 { "admin" } else { "member" }, "joinedAt": 0,
    }))
        })
        .collect();
    format!(
        "import {{ seed }} from 'snapback2';\nexport default seed({});\n",
        json!({
            "personas": personas, "rows": { "conversations": conversations, "memberships": memberships },
        })
    )
}

#[test]
fn chat_seed_205_memberships_applies_and_reset_51_in_one_group_refuses_atomically() {
    let root = temp_root();
    let template = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/snapback2/templates/chat/snapback");
    copy_tree(&template, &root.join("snapback"));
    let seed_path = root.join("snapback/seed.ts");
    fs::write(&seed_path, seed(5, 41)).unwrap();
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
    let data = |group: usize| {
        request(
            port,
            "POST",
            "/control/data",
            &[("X-Snapback-Control", secret)],
            json!({
                "table": "memberships", "index": "byConversationPrincipal", "prefix": [format!("cap-conversation-{group}")], "limit": 100, "as": "alice",
            }),
        )
    };
    let before = data(0);
    assert_eq!(before.status, 200, "{}", before.body);
    assert_eq!(before.body["data"].as_array().unwrap().len(), 41);
    for group in 1..5 {
        let stored = data(group);
        assert_eq!(stored.status, 200, "{}", stored.body);
        assert_eq!(stored.body["data"].as_array().unwrap().len(), 41);
    }
    // The watcher owns the active seed; wait for it to observe the edit before reset.
    thread::sleep(Duration::from_millis(300));
    let log_path = root.join(".snapback/log.jsonl");
    let log_start = fs::metadata(&log_path).unwrap().len() as usize;
    fs::write(&seed_path, seed(1, 51)).unwrap();
    wait_for(Duration::from_secs(6), || {
        let log = fs::read_to_string(&log_path).ok()?;
        log.get(log_start..)?
            .contains("\"successor\":\"applied\"")
            .then_some(())
    });
    let reset = request(
        port,
        "POST",
        "/control/reset",
        &[("X-Snapback-Control", secret)],
        json!({}),
    );
    assert_eq!(reset.status, 400, "{}", reset.body);
    assert_eq!(reset.body["code"], "E_CONSTRAINT");
    assert!(
        reset.body["message"]
            .as_str()
            .unwrap()
            .contains("memberships cap 50 reached")
    );
    println!("chat seed refusal: {}", reset.body);
    assert_eq!(
        data(0).body,
        before.body,
        "refused reset changed stored membership rows"
    );
    assert_eq!(status(port, secret)["status"], "ready");
    let stop = request(
        port,
        "POST",
        "/control/stop",
        &[("X-Snapback-Control", secret)],
        json!({ "cause": "cap seed proof" }),
    );
    assert_eq!(stop.status, 200);
    owner.wait();
    fs::remove_dir_all(root).unwrap();
}
