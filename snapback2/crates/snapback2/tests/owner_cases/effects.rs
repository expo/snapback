use super::*;

#[cfg(not(feature = "hermes"))]
#[test]
fn default_owner_replays_then_pending_without_an_engine() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    let seq = seed_effect_row(
        &root,
        binary,
        &compiler,
        Some(json!({ "providerId": "replayed-provider" })),
    );

    let mut owner = ChildGuard::spawn(binary, &compiler, &root);
    let port = owner
        .ready_line()
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = owner_json["secret"].as_str().unwrap().to_owned();
    let settled = wait_for(Duration::from_secs(5), || {
        let status = status(port, &secret);
        (status["effects"]["sent"] == 1).then_some(status)
    });
    assert_eq!(settled["effects"]["engine"], "none");
    assert_eq!(settled["effects"]["thenPending"], 0);
    assert_eq!(settled["seq"], 2, "then mutation committed");
    let trace = request(
        port,
        "GET",
        &format!("/control/trace?seq={seq}"),
        &[("X-Snapback-Control", &secret)],
        json!({}),
    );
    assert_eq!(trace.body["outbox"]["rows"][0]["state"], "sent");
    assert_eq!(trace.body["outbox"]["rows"][0]["lastError"], Value::Null);

    stop_owner(port, &secret, &mut owner, "default runner replay complete");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn then_writes_deny_ruled_bookkeeping_and_settles_sent() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    let seq = seed_effect_row(
        &root,
        binary,
        &compiler,
        Some(json!({ "providerId": "denied-provider" })),
    );

    let mut owner = ChildGuard::spawn(binary, &compiler, &root);
    let port = owner
        .ready_line()
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = owner_json["secret"].as_str().unwrap().to_owned();
    let settled = wait_for(Duration::from_secs(5), || {
        let status = status(port, &secret);
        (status["effects"]["sent"] == 1).then_some(status)
    });
    assert_eq!(
        settled["seq"], 2,
        "system then commits despite deny insert rule"
    );
    let trace = request(
        port,
        "GET",
        &format!("/control/trace?seq={seq}"),
        &[("X-Snapback-Control", &secret)],
        json!({}),
    );
    assert_eq!(trace.body["outbox"]["rows"][0]["state"], "sent");
    assert_eq!(trace.body["outbox"]["rows"][0]["lastError"], Value::Null);
    let latest = request(
        port,
        "GET",
        "/control/trace",
        &[("X-Snapback-Control", &secret)],
        json!({}),
    );
    assert_eq!(latest.body["commit"]["kind"], "system");
    assert_eq!(latest.body["commit"]["writes"]["notifications"], 1);
    let rows = request(
        port,
        "POST",
        "/control/data",
        &[("X-Snapback-Control", &secret)],
        json!({ "table": "notifications", "as": "system" }),
    );
    assert!(
        rows.body["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["providerId"] == "denied-provider")
    );

    stop_owner(port, &secret, &mut owner, "system then complete");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn fractional_effect_result_rejects_then_and_still_settles_sent() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    let seq = seed_effect_row(&root, binary, &compiler, Some(json!({ "ratio": 1.5 })));

    let mut owner = ChildGuard::spawn(binary, &compiler, &root);
    let port = owner
        .ready_line()
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = owner_json["secret"].as_str().unwrap().to_owned();
    let settled = wait_for(Duration::from_secs(5), || {
        let status = status(port, &secret);
        (status["effects"]["sent"] == 1).then_some(status)
    });
    assert_eq!(settled["effects"]["running"], 0);
    assert_eq!(settled["effects"]["thenPending"], 0);
    assert_eq!(settled["seq"], 1, "rejected then writes no commit");
    let trace = request(
        port,
        "GET",
        &format!("/control/trace?seq={seq}"),
        &[("X-Snapback-Control", &secret)],
        json!({}),
    );
    assert_eq!(trace.body["outbox"]["rows"][0]["state"], "sent");
    assert!(
        trace.body["outbox"]["rows"][0]["lastError"]
            .as_str()
            .is_some_and(|error| error.contains("E_INPUT")),
        "{}",
        trace.body
    );

    stop_owner(port, &secret, &mut owner, "fractional result complete");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn doctor_counts_queued_rows_from_store_without_an_owner() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    seed_effect_row(&root, binary, &compiler, None);

    let doctor = Command::new(binary)
        .arg("doctor")
        .current_dir(&root)
        .env("SNAPBACK2_COMPILER", &compiler)
        .output()
        .unwrap();
    assert!(doctor.status.success());
    assert!(
        String::from_utf8_lossy(&doctor.stdout)
            .contains("effects: no engine in this build — 1 queued"),
        "{}",
        String::from_utf8_lossy(&doctor.stdout)
    );
    let store = Store::open(&root.join(".snapback/store.sqlite")).unwrap();
    assert_eq!(store.outbox_counts().unwrap().queued, 1);
    drop(store);
    fs::remove_dir_all(root).unwrap();
}
