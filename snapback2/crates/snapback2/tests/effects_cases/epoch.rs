//! Epoch close and restart through a real Hermes owner.
use super::*;

fn post(port: u16, secret: &str, path: &str, body: Value) -> Response {
    request(port, "POST", path, &[("X-Snapback-Control", secret)], body)
}

fn emit(port: u16, body: &str) -> Value {
    let reply = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "alice")],
        json!({"op":"messages.send","args":{"conversationId":"conversation-1","recipientId":"profile-bob","body":body}}),
    );
    assert_eq!(reply.body["state"], "committed", "{}", reply.body);
    reply.body
}

fn setup() -> (PathBuf, PathBuf) {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    prepare_effect_fixture(&root, "https://api.example.com");
    let compiler = compiler(&root);
    (root, compiler)
}

fn bind(port: u16, secret: &str, epoch: &str, provider: &Provider) {
    let opened = post(
        port,
        secret,
        "/control/effects/epoch",
        json!({"epoch":epoch}),
    );
    assert_eq!(opened.status, 200, "{}", opened.body);
    let bound = post(
        port,
        secret,
        "/control/effects/bind",
        json!({"epoch":epoch,"origin":"https://api.example.com","to":provider.origin()}),
    );
    assert_eq!(bound.status, 200, "{}", bound.body);
}

#[test]
fn epoch_close_waits_for_its_claim_and_post_close_emissions_are_unbound() {
    let provider = Provider::start();
    let next = Provider::start();
    next.release_first();
    let (root, compiler) = setup();
    let mut owner = ChildGuard::spawn_test(env!("CARGO_BIN_EXE_snapback2"), &compiler, &root);
    let (port, secret) = owner.ready(&root);
    bind(port, &secret, "old", &provider);
    let sent = emit(port, "held at close");
    let seq = sent["seq"].as_u64().unwrap();
    wait_for(Duration::from_secs(8), || {
        (provider.hits() == 1).then_some(())
    });
    let (send, receive) = std::sync::mpsc::channel();
    let closer = thread::spawn({
        let secret = secret.clone();
        move || {
            send.send(post(
                port,
                &secret,
                "/control/effects/epoch",
                json!({"epoch":null}),
            ))
            .unwrap();
        }
    });
    wait_for(Duration::from_secs(2), || {
        (post(
            port,
            &secret,
            "/control/effects/bind",
            json!({"epoch":"old","origin":"https://api.example.com","to":provider.origin()}),
        )
        .status
            == 400)
            .then_some(())
    });
    assert!(
        receive.recv_timeout(Duration::from_millis(150)).is_err(),
        "close returned while the old provider still held the request"
    );
    assert_eq!(
        post(
            port,
            &secret,
            "/control/effects/epoch",
            json!({"epoch":"too-soon"})
        )
        .status,
        400
    );
    let unbound = emit(port, "after close");
    provider.release_first();
    let closed = receive.recv_timeout(Duration::from_secs(8)).unwrap();
    closer.join().unwrap();
    assert_eq!(closed.status, 200, "{}", closed.body);
    assert_eq!(closed.body["running"], json!([]));
    assert_eq!(
        trace(port, &secret, seq)["outbox"]["rows"][0]["state"],
        "sent"
    );
    bind(port, &secret, "next", &next);
    let mine = emit(port, "next journey");
    let remaining = wait_for(Duration::from_secs(8), || {
        let row =
            trace(port, &secret, unbound["seq"].as_u64().unwrap())["outbox"]["rows"][0].clone();
        (row["state"] == "failed").then_some(row)
    });
    assert!(
        remaining["lastError"]
            .as_str()
            .unwrap()
            .contains("E_EFFECT_UNBOUND"),
        "{remaining}"
    );
    wait_for(Duration::from_secs(8), || {
        (trace(port, &secret, mine["seq"].as_u64().unwrap())["outbox"]["rows"][0]["state"]
            == "sent")
            .then_some(())
    });
    assert_eq!(provider.hits(), 1);
    assert_eq!(next.hits(), 1);
    post(
        port,
        &secret,
        "/control/effects/epoch",
        json!({"epoch":null}),
    );
    post(port, &secret, "/control/stop", json!({}));
    owner.wait();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_test_owner_restart_requeues_without_an_epoch_and_never_hits_the_provider_twice() {
    let provider = Provider::start();
    let (root, compiler) = setup();
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let mut owner = ChildGuard::spawn_test(binary, &compiler, &root);
    let (port, secret) = owner.ready(&root);
    bind(port, &secret, "before-death", &provider);
    let sent = emit(port, "kill during running");
    let seq = sent["seq"].as_u64().unwrap();
    wait_for(Duration::from_secs(8), || {
        (provider.hits() == 1).then_some(())
    });
    let row = trace(port, &secret, seq)["outbox"]["rows"][0].clone();
    assert_eq!(row["state"], "running");
    owner.kill();
    provider.release_first();
    let mut restarted = ChildGuard::spawn_test(binary, &compiler, &root);
    let (port, secret) = restarted.ready(&root);
    wait_for(Duration::from_secs(5), || {
        (trace(port, &secret, seq)["outbox"]["rows"][0]["state"] == "sent_unknown").then_some(())
    });
    bind(port, &secret, "after-death", &provider);
    let id = row["id"].as_str().unwrap();
    assert_eq!(
        post(
            port,
            &secret,
            &format!("/control/outbox/{id}/requeue"),
            json!({})
        )
        .status,
        200
    );
    let recovered = wait_for(Duration::from_secs(8), || {
        let row = trace(port, &secret, seq)["outbox"]["rows"][0].clone();
        (row["state"] == "failed").then_some(row)
    });
    assert_eq!(recovered["id"], id);
    assert_eq!(recovered["attempts"], 1);
    assert!(
        recovered["lastError"]
            .as_str()
            .unwrap()
            .contains("E_EFFECT_UNBOUND"),
        "{recovered}"
    );
    assert_eq!(provider.hits(), 1);
    post(
        port,
        &secret,
        "/control/effects/epoch",
        json!({"epoch":null}),
    );
    post(port, &secret, "/control/stop", json!({}));
    restarted.wait();
    fs::remove_dir_all(root).unwrap();
}
