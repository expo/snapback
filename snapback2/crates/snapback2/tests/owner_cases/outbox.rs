//! `GET /control/outbox` paging, caps, and admission — the same on every build;
//! what an engine does with the rows is `effects.rs`' business.
use super::*;

fn percent_encode(text: &str) -> String {
    text.bytes().map(|b| format!("%{b:02X}")).collect()
}

fn stop(port: u16, secret: &str, owner: &mut ChildGuard, cause: &str) {
    let stopped = request(
        port,
        "POST",
        "/control/stop",
        &[("X-Snapback-Control", secret)],
        json!({ "cause": cause }),
    );
    assert_eq!(stopped.status, 200, "{}", stopped.body);
    owner.wait();
}

#[test]
fn outbox_pages_over_two_hundred_rows_by_seq_and_id_and_caps_results_under_dev_admission() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    seed_paged_outbox(&root, binary, &compiler);
    let mut owner = ChildGuard::spawn(binary, &compiler, &root);
    let port = owner
        .ready_line()
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let engine_line = owner.ready_line();
    assert!(
        engine_line.starts_with("effects: ") && engine_line.contains(" queued"),
        "{engine_line}"
    );
    let info: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = info["secret"].as_str().unwrap();
    let headers = [("X-Snapback-Control", secret)];
    let refused = request(port, "GET", "/control/outbox", &[], json!({}));
    assert_eq!(refused.status, 403);
    assert_eq!(refused.body["code"], "E_OWNER_CONTROL_SECRET");
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
        after = format!("&after={}", percent_encode(cursor));
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
    assert!(all.iter().all(|r| r["effect"] == "delivery.notify"));
    assert_eq!(all[404]["state"], "sent");
    assert_eq!(all[404]["result"], Value::Null);
    assert_eq!(
        all[404]["resultCapped"],
        json!({"bytes":17002,"limit":16384})
    );
    let filtered = request(
        port,
        "GET",
        "/control/outbox?state=sent&limit=5",
        &headers,
        json!({}),
    );
    assert_eq!(filtered.body["rows"].as_array().unwrap().len(), 1);
    assert_eq!(filtered.body["after"], Value::Null);
    stop(port, secret, &mut owner, "outbox paging complete");

    // Serve mode keeps the secret gate and refuses both routes as the operator seat.
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
        let anonymous = request(port, method, path, &[], json!({}));
        assert_eq!(anonymous.status, 403, "{path}");
        assert_eq!(anonymous.body["code"], "E_OWNER_CONTROL_SECRET", "{path}");
        let response = request(
            port,
            method,
            path,
            &[("X-Snapback-Control", secret)],
            json!({}),
        );
        assert_eq!(response.status, 400, "{path}: {}", response.body);
        assert_eq!(response.body["code"], "E_OPERATOR_REQUIRED", "{path}");
        assert_eq!(response.body["family"], "operator", "{path}");
    }
    stop(port, secret, &mut served, "serve admission complete");
    fs::remove_dir_all(root).unwrap();
}
