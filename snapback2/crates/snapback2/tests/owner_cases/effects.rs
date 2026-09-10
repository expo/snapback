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
    assert_eq!(
        trace.body["outbox"]["rows"][0]["then"],
        json!({"op":"notifications.recordNotified","state":"committed","seq":2})
    );
    assert_eq!(
        trace.body["outbox"]["history"][0]["outbox"]["then"]["state"],
        "committed"
    );

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

    assert_eq!(
        trace.body["outbox"]["rows"][0]["then"],
        json!({"op":"notifications.recordNotified","state":"rejected","code":"E_INPUT"})
    );
    assert_eq!(
        trace.body["outbox"]["history"][0]["outbox"]["then"]["state"],
        "rejected"
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

#[test]
fn outbox_pages_over_two_hundred_rows_and_settle_reports_every_engine_block() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    seed_effect_row(&root, binary, &compiler, None);
    let conn = rusqlite::Connection::open(root.join(".snapback/store.sqlite")).unwrap();
    conn.execute("DELETE FROM _outbox", []).unwrap();
    for i in 0..405 {
        conn.execute("INSERT INTO _outbox (id,seq,effect,payload,state,attempts,next_at,created_at,updated_at,result)
            VALUES (?1,?2,'delivery.notify','\"Null\"',?3,0,0,0,0,?4)", rusqlite::params![
                format!("paged-{i:04}"), 1 + i / 203, if i == 404 { "sent" } else { "queued" },
                if i == 404 { Some(json!("x".repeat(17000)).to_string()) } else { None }
            ]).unwrap();
    }
    drop(conn);
    let mut owner = ChildGuard::spawn(binary, &compiler, &root);
    let ready = owner.ready_line();
    let port = ready
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    assert!(
        owner
            .ready_line()
            .contains("effects: no engine in this build — 404 queued")
    );
    let info: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = info["secret"].as_str().unwrap();
    let headers = [("X-Snapback-Control", secret)];
    assert_eq!(
        request(port, "GET", "/control/outbox", &[], json!({})).status,
        403
    );
    for path in [
        "/control/outbox?limit=201",
        "/control/outbox?limit=0",
        "/control/outbox?limit=oops",
        "/control/outbox?state=oops",
        "/control/outbox?after=oops",
    ] {
        assert_eq!(
            request(port, "GET", path, &headers, json!({})).status,
            400,
            "{path}"
        );
    }
    let mut all = Vec::new();
    let mut after = String::new();
    let mut lengths = Vec::new();
    loop {
        let response = request(
            port,
            "GET",
            &format!("/control/outbox?limit=200{after}"),
            &headers,
            json!({}),
        );
        assert_eq!(response.status, 200, "{}", response.body);
        let rows = response.body["rows"].as_array().unwrap();
        lengths.push(rows.len());
        all.extend(rows.iter().cloned());
        let Some(cursor) = response.body["after"].as_str() else {
            break;
        };
        after = format!(
            "&after={}",
            cursor
                .bytes()
                .map(|b| format!("%{b:02X}"))
                .collect::<String>()
        );
    }
    assert_eq!(lengths, vec![200, 200, 5]);
    assert_eq!(
        all.iter()
            .map(|r| r["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        (0..405)
            .map(|i| format!("paged-{i:04}"))
            .collect::<Vec<_>>()
    );
    assert_eq!(all[404]["result"], Value::Null);
    assert_eq!(
        all[404]["resultCapped"],
        json!({"bytes":17002,"limit":16384})
    );
    let started = Instant::now();
    let settled = request(
        port,
        "POST",
        "/control/effects/settle",
        &headers,
        json!({"upTo":2,"budgetMs":4000}),
    );
    assert_eq!(settled.status, 200, "{}", settled.body);
    assert_eq!(settled.body["settled"], false);
    assert_eq!(settled.body["rows"].as_array().unwrap().len(), 405);
    assert_eq!(settled.body["remaining"].as_array().unwrap().len(), 404);
    assert!(
        settled.body["remaining"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["reason"] == "engine:none")
    );
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "no engine must return at once"
    );
    let limited = request(
        port,
        "POST",
        "/control/effects/settle",
        &headers,
        json!({"upTo":1,"budgetMs":0}),
    );
    assert_eq!(limited.body["rows"].as_array().unwrap().len(), 203);
    for body in [
        json!({"upTo":-1}),
        json!({"budgetMs":4001}),
        json!({"upTo":"2"}),
    ] {
        assert_eq!(
            request(port, "POST", "/control/effects/settle", &headers, body).status,
            400
        );
    }
    let empty = request(
        port,
        "POST",
        "/control/effects/settle",
        &headers,
        json!({"upTo":0}),
    );
    assert_eq!(empty.body["settled"], true);
    stop_owner(port, secret, &mut owner, "outbox paging complete");
    let mut served = ChildGuard::spawn_with(binary, &compiler, &root, true);
    let port = served
        .ready_line()
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let info: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = info["secret"].as_str().unwrap();
    for (method, path) in [
        ("GET", "/control/outbox"),
        ("POST", "/control/effects/settle"),
    ] {
        let response = request(
            port,
            method,
            path,
            &[("X-Snapback-Control", secret)],
            json!({}),
        );
        assert_ne!(response.status, 200, "{path}");
    }
    stop_owner(port, secret, &mut served, "serve admission complete");
    fs::remove_dir_all(root).unwrap();
}
