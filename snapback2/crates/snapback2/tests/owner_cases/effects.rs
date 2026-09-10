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

fn boot(root: &Path, binary: &str, compiler: &Path) -> (ChildGuard, u16, String, String) {
    let mut owner = ChildGuard::spawn(binary, compiler, root);
    let port = owner
        .ready_line()
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let engine_line = owner.ready_line();
    let info: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = info["secret"].as_str().unwrap().to_owned();
    (owner, port, secret, engine_line)
}

fn insert_outbox_row(root: &Path, id: &str, state: &str, attempts: u32) {
    let conn = rusqlite::Connection::open(root.join(".snapback/store.sqlite")).unwrap();
    conn.execute(
        "INSERT INTO _outbox (id,seq,effect,payload,state,attempts,next_at,created_at,updated_at)
         VALUES (?1,1,'delivery.notify','\"Null\"',?2,?3,0,0,0)",
        rusqlite::params![id, state, attempts],
    )
    .unwrap();
}

fn settle(port: u16, secret: &str, body: Value) -> Value {
    let response = request(
        port,
        "POST",
        "/control/effects/settle",
        &[("X-Snapback-Control", secret)],
        body,
    );
    assert_eq!(response.status, 200, "{}", response.body);
    response.body
}

fn cli_json(binary: &str, root: &Path, args: &[&str]) -> Value {
    let output = Command::new(binary)
        .args(args)
        .args(["--json", "--project"])
        .arg(root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[cfg(not(feature = "hermes"))]
#[test]
fn settle_reports_engine_none_for_every_queued_row_at_once() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    seed_paged_outbox(&root, binary, &compiler, "queued");
    let (mut owner, port, secret, engine_line) = boot(&root, binary, &compiler);
    assert!(
        engine_line.contains("effects: no engine in this build — 404 queued"),
        "{engine_line}"
    );
    let started = Instant::now();
    let settled = settle(port, &secret, json!({"upTo":2,"budgetMs":4000}));
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "no engine must return at once"
    );
    assert_eq!(settled["settled"], false);
    assert_eq!(settled["rows"].as_array().unwrap().len(), 405);
    let remaining = settled["remaining"].as_array().unwrap();
    assert_eq!(remaining.len(), 404);
    assert!(remaining.iter().all(|r| r["reason"] == "engine:none"));
    let limited = settle(port, &secret, json!({"upTo":1,"budgetMs":0}));
    assert_eq!(limited["rows"].as_array().unwrap().len(), 203);
    for body in [
        json!({"upTo":-1}),
        json!({"budgetMs":4001}),
        json!({"upTo":"2"}),
    ] {
        assert_eq!(
            request(
                port,
                "POST",
                "/control/effects/settle",
                &[("X-Snapback-Control", &secret)],
                body
            )
            .status,
            400
        );
    }
    assert_eq!(settle(port, &secret, json!({"upTo":0}))["settled"], true);
    stop_owner(port, &secret, &mut owner, "engine-none settle complete");
    fs::remove_dir_all(root).unwrap();
}

// @ref LLP 1021#2-journeys-see-and-settle-the-outbox — an engine-less owner still settles pending `then`s; only the queued row is reported `engine:none`.
#[cfg(not(feature = "hermes"))]
#[test]
fn settle_pumps_pending_thens_beside_an_engineless_queued_row() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    // The runner starts just before the ready line and may drain up to two
    // passes of pending `then`s at boot (initialize, then the first drain),
    // then one pass per one-second wait while nothing wakes it, so eight
    // passes leave rows pending when settle starts. The proof that settle
    // pumped them is that it moved more than an unwoken runner could have
    // inside settle's own wall time; a `then` commit emits nothing, so nothing
    // but settle wakes the runner here.
    let limit = snapback2_effects::DEFAULT_DRAIN_LIMIT as u64;
    let ids = (0..8 * limit)
        .map(|i| format!("pending-{i:03}"))
        .collect::<Vec<_>>();
    let rows = ids
        .iter()
        .map(|id| (id.as_str(), Some(json!({ "providerId": id }))))
        .collect::<Vec<_>>();
    let last_emit = *seed_effect_rows(&root, binary, &compiler, &rows)
        .last()
        .unwrap();
    insert_outbox_row(&root, "queued-beside", "queued", 0);
    let (mut owner, port, secret, _) = boot(&root, binary, &compiler);
    let started = Instant::now();
    let pending_before = status(port, &secret)["effects"]["thenPending"]
        .as_u64()
        .unwrap();
    assert!(
        pending_before > limit,
        "boot drained the fixture before settle: {pending_before} pending"
    );
    let settled = settle(port, &secret, json!({"upTo": last_emit, "budgetMs": 4000}));
    let elapsed = started.elapsed();
    assert_eq!(settled["settled"], false, "{settled}");
    let remaining = settled["remaining"].as_array().unwrap();
    assert!(
        remaining.contains(&json!({"id":"queued-beside","reason":"engine:none"})),
        "{settled}"
    );
    let pending_after = remaining
        .iter()
        .filter(|r| r["reason"] == "then_pending")
        .count() as u64;
    assert_eq!(remaining.len() as u64, pending_after + 1, "{settled}");
    let unwoken_ceiling = limit * (elapsed.as_secs() + 1);
    let pumped = pending_before - pending_after;
    assert!(
        pumped > unwoken_ceiling,
        "settle pumped {pumped} pending thens in {elapsed:?}; an unwoken runner drains at most {unwoken_ceiling}"
    );
    let sent = settled["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["state"] == "sent")
        .collect::<Vec<_>>();
    assert_eq!(sent.len() as u64, 8 * limit - pending_after, "{settled}");
    for row in sent {
        assert_eq!(row["then"]["op"], "notifications.recordNotified", "{row}");
        assert_eq!(row["then"]["state"], "committed", "{row}");
        assert!(row["then"]["seq"].as_u64().unwrap() > last_emit, "{row}");
    }
    stop_owner(port, &secret, &mut owner, "mixed settle complete");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn settle_reports_backoff_without_spinning_and_engine_none_once_the_clock_passes_next_at() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    seed_effect_row(&root, binary, &compiler, None);
    let next_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
        + 60_000;
    let conn = rusqlite::Connection::open(root.join(".snapback/store.sqlite")).unwrap();
    conn.execute(
        "UPDATE _outbox SET next_at = ?1 WHERE id = 'seeded-outbox'",
        [next_at],
    )
    .unwrap();
    drop(conn);
    let (mut owner, port, secret, _) = boot(&root, binary, &compiler);
    let started = Instant::now();
    let backoff = settle(port, &secret, json!({"upTo":1,"budgetMs":50}));
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "a backoff beyond the budget must not be waited on"
    );
    assert_eq!(backoff["settled"], false);
    assert_eq!(
        backoff["remaining"],
        json!([{"id":"seeded-outbox","reason":"backoff","nextAt":next_at}])
    );
    let ticked = request(
        port,
        "POST",
        "/control/clock",
        &[("X-Snapback-Control", &secret)],
        json!({"advanceMs":60_001}),
    );
    assert_eq!(ticked.status, 200, "{}", ticked.body);
    let due = settle(port, &secret, json!({"upTo":1,"budgetMs":50}));
    assert_eq!(
        due["remaining"],
        json!([{"id":"seeded-outbox","reason":"engine:none"}])
    );
    stop_owner(port, &secret, &mut owner, "backoff settle complete");
    fs::remove_dir_all(root).unwrap();
}

// @ref LLP 1021#1-the-lifecycle-is-in-the-log — acceptance 9: every transition, in order, and nothing else.
#[cfg(not(feature = "hermes"))]
#[test]
fn logs_effects_lists_every_transition_in_order_and_nothing_else() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    seed_effect_row(
        &root,
        binary,
        &compiler,
        Some(json!({ "providerId": "logged-provider" })),
    );
    insert_outbox_row(&root, "stale-running", "running", 1);
    let (mut owner, port, secret, _) = boot(&root, binary, &compiler);
    wait_for(Duration::from_secs(5), || {
        let status = status(port, &secret);
        (status["effects"]["sent"] == 1 && status["effects"]["sentUnknown"] == 1).then_some(())
    });
    let requeued = request(
        port,
        "POST",
        "/control/outbox/stale-running/requeue",
        &[("X-Snapback-Control", &secret)],
        json!({}),
    );
    assert_eq!(requeued.status, 200, "{}", requeued.body);
    let logs = cli_json(binary, &root, &["logs", "--effects"]);
    assert_eq!(logs["commits"], json!([]));
    let lines = logs["lines"].as_array().unwrap();
    assert!(lines.iter().all(|line| line["outbox"].is_object()), "{logs}");
    let transitions = lines
        .iter()
        .filter(|line| line["outbox"]["to"].is_string())
        .collect::<Vec<_>>();
    assert_eq!(
        transitions
            .iter()
            .map(|line| (
                line["outbox"]["id"].as_str().unwrap(),
                line["outbox"]["from"].as_str().unwrap(),
                line["outbox"]["to"].as_str().unwrap(),
            ))
            .collect::<Vec<_>>(),
        vec![
            ("stale-running", "running", "sent_unknown"),
            ("seeded-outbox", "then_pending", "sent"),
            ("stale-running", "sent_unknown", "queued"),
        ],
        "{logs}"
    );
    assert!(
        transitions
            .iter()
            .all(|line| line["outbox"]["effect"] == "delivery.notify" && line["outbox"]["seq"] == 1)
    );
    assert_eq!(
        transitions[1]["outbox"]["then"],
        json!({"op":"notifications.recordNotified","state":"committed","seq":2})
    );
    assert_eq!(transitions[2]["outbox"]["by"], "requeue");
    assert_eq!(
        lines
            .iter()
            .filter(|line| line["outbox"]["engine"] == "none")
            .map(|line| line["outbox"]["queued"].clone())
            .collect::<Vec<_>>(),
        vec![json!(0), json!(1)]
    );
    assert_eq!(lines.len(), transitions.len() + 2, "{logs}");
    stop_owner(port, &secret, &mut owner, "effects log complete");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn trace_reports_unavailable_history_when_the_log_tail_is_malformed_or_oversized() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    let seq = seed_effect_row(&root, binary, &compiler, None);
    let (mut owner, port, secret, _) = boot(&root, binary, &compiler);
    let headers = [("X-Snapback-Control", secret.as_str())];
    let path = format!("/control/trace?seq={seq}");
    let trace = request(port, "GET", &path, &headers, json!({}));
    assert!(trace.body["outbox"]["history"].is_array(), "{}", trace.body);
    let log = root.join(".snapback/log.jsonl");
    let mut file = fs::OpenOptions::new().append(true).open(&log).unwrap();
    file.write_all(b"not json\n").unwrap();
    drop(file);
    let malformed = request(port, "GET", &path, &headers, json!({}));
    assert!(
        malformed.body["outbox"]["history"]["unavailable"]
            .as_str()
            .is_some_and(|reason| reason.contains("malformed")),
        "{}",
        malformed.body
    );
    let cli = cli_json(binary, &root, &["trace", &seq.to_string()]);
    assert_eq!(
        cli["outboxHistory"],
        malformed.body["outbox"]["history"],
        "{cli}"
    );
    fs::OpenOptions::new()
        .write(true)
        .open(&log)
        .unwrap()
        .set_len(5 * 1024 * 1024)
        .unwrap();
    let oversized = request(port, "GET", &path, &headers, json!({}));
    assert!(
        oversized.body["outbox"]["history"]["unavailable"]
            .as_str()
            .is_some_and(|reason| reason.contains("bounded log read")),
        "{}",
        oversized.body
    );
    stop_owner(port, &secret, &mut owner, "history unavailable complete");
    fs::remove_dir_all(root).unwrap();
}
