//! Served owner proofs for exact bearer-session fencing.
// @ref LLP 1002#5-the-owner — logout and expiry fence only the captured session epoch.

use super::owner_support::*;
use super::owner_wire::{Sse, request, status};
use super::*;

const SESSION_MILLIS: i64 = 24 * 60 * 60 * 1_000;
const THREAD_PATH: &str = "/api/subscribe?op=messages.thread&args=%7B%22conversationId%22%3A%22conversation-1%22%2C%22c%22%3Anull%7D";
const TYPING_PATH: &str =
    "/api/channel/typing/subscribe?args=%7B%22conversationId%22%3A%22conversation-1%22%7D";

#[cfg(not(feature = "hermes"))]
#[test]
fn exact_logout_fences_only_one_epoch_and_successors_cannot_resurrect_it() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    install_add_member_mutation(&root);
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    let (mut owner, port, secret) = start_owner(binary, &compiler, &root);

    let (first_token, first_viewer) = signup(port, "session-owner@example.com");
    add_conversation_member(port, &first_viewer);
    let second_token = login(port, "session-owner@example.com");
    assert!(
        first_token != second_token,
        "each login needs a distinct epoch"
    );

    let mut first_query = Sse::open_bearer(port, THREAD_PATH, &first_token);
    assert_eq!(first_query.event()["state"], "complete");
    let mut second_query = Sse::open_bearer(port, THREAD_PATH, &second_token);
    assert_eq!(second_query.event()["state"], "complete");
    let mut first_channel = Sse::open_bearer(port, TYPING_PATH, &first_token);
    let _first_channel_lease = first_channel.event()["lease"].clone();
    let mut second_channel = Sse::open_bearer(port, TYPING_PATH, &second_token);
    let second_channel_lease = second_channel.event()["lease"].clone();

    let before_refresh = bearer_request(port, "GET", "/api/auth/me", &second_token, json!({}));
    let refreshed = bearer_request(port, "POST", "/api/auth/refresh", &second_token, json!({}));
    assert_eq!(refreshed.status, 200, "{}", refreshed.body);
    assert_eq!(before_refresh.status, 200, "{}", before_refresh.body);
    assert_eq!(refreshed.body["viewer"], before_refresh.body["viewer"]);
    assert_eq!(refreshed.body["kind"], before_refresh.body["kind"]);
    assert_eq!(
        refreshed.body["authEpoch"],
        before_refresh.body["authEpoch"]
    );
    let rotated_token = refreshed.body["token"].as_str().unwrap().to_owned();
    assert_ne!(rotated_token, second_token);
    assert_auth_session(&bearer_request(
        port,
        "GET",
        "/api/auth/me",
        &second_token,
        json!({}),
    ));
    assert_auth_session(&bearer_request(
        port,
        "POST",
        "/api/auth/logout",
        &second_token,
        json!({}),
    ));
    assert_eq!(status(port, &secret)["subscriptions"], 2);
    assert_eq!(status(port, &secret)["channelSubscriptions"], 2);
    second_query.assert_silent(Duration::from_millis(100));
    second_channel.assert_silent(Duration::from_millis(100));
    let second_token = rotated_token;

    let logout = bearer_request(port, "POST", "/api/auth/logout", &first_token, json!({}));
    assert_eq!(logout.status, 200, "{}", logout.body);
    assert_session_terminal(&mut first_query);
    assert_session_terminal(&mut first_channel);
    assert_eq!(status(port, &secret)["subscriptions"], 1);
    assert_eq!(status(port, &secret)["channelSubscriptions"], 1);

    let retained_query = bearer_request(
        port,
        "POST",
        "/api/query",
        &second_token,
        json!({
            "op": "messages.thread",
            "args": { "conversationId": "conversation-1", "c": null },
        }),
    );
    assert_eq!(retained_query.status, 200, "{}", retained_query.body);
    assert_eq!(retained_query.body["state"], "complete");
    let publish = publish_typing(port, &second_token, &second_channel_lease);
    assert_eq!(publish.status, 200, "{}", publish.body);
    assert_eq!(
        second_channel.event()["entries"][0]["value"]["typing"],
        true
    );

    let revoked_query = bearer_request(
        port,
        "POST",
        "/api/query",
        &first_token,
        json!({
            "op": "messages.thread",
            "args": { "conversationId": "conversation-1", "c": null },
        }),
    );
    assert_auth_session(&revoked_query);
    let repeated_logout = bearer_request(port, "POST", "/api/auth/logout", &first_token, json!({}));
    assert_auth_session(&repeated_logout);
    let missing_logout = request(port, "POST", "/api/auth/logout", &[], json!({}));
    assert_auth_session(&missing_logout);

    let unrelated = bearer_request(
        port,
        "POST",
        "/api/mutation",
        &second_token,
        json!({
            "op": "profiles.createMyProfile",
            "args": {
                "displayName": "Session Owner",
                "handle": "session_owner",
                "bio": "",
                "location": "",
            },
        }),
    );
    assert_eq!(unrelated.body["state"], "committed", "{}", unrelated.body);
    second_query.assert_silent(Duration::from_millis(200));
    second_channel.assert_silent(Duration::from_millis(200));
    assert_eq!(status(port, &secret)["subscriptions"], 1);
    assert_eq!(status(port, &secret)["channelSubscriptions"], 1);

    let sent = bearer_request(
        port,
        "POST",
        "/api/mutation",
        &second_token,
        json!({
            "op": "messages.send",
            "args": {
                "conversationId": "conversation-1",
                "recipientId": "profile-bob",
                "body": "session fence",
            },
        }),
    );
    assert_eq!(sent.body["state"], "committed", "{}", sent.body);
    assert_eq!(second_query.event()["state"], "complete");
    assert_auth_session(&bearer_request(
        port,
        "POST",
        "/api/query",
        &first_token,
        json!({ "op": "messages.thread", "args": { "conversationId": "conversation-1", "c": null } }),
    ));

    let generation = status(port, &secret)["generation"]
        .as_str()
        .unwrap()
        .to_owned();
    let messages = root.join("snapback/messages.q");
    let mut source = fs::read_to_string(&messages).unwrap();
    source.push_str("\nquery authFenceSuccessor():\n  return true\n");
    fs::write(&messages, source).unwrap();
    let applied = wait_for(Duration::from_secs(6), || {
        let current = status(port, &secret);
        let manifest = request(port, "GET", "/api/manifest", &[], json!({}));
        (manifest.body["ops"]
            .get("messages.authFenceSuccessor")
            .is_some()
            && current["status"] == "ready")
            .then_some(current)
    });
    assert_eq!(applied["status"], "ready");
    assert_eq!(applied["generation"], generation);
    assert_eq!(second_channel.event()["code"], "E_CHANNEL_RESET");
    second_channel.assert_closed();
    second_channel = Sse::open_bearer(port, TYPING_PATH, &second_token);
    let successor_lease = second_channel.event()["lease"].clone();
    assert_eq!(second_query.event()["state"], "complete");
    assert_eq!(status(port, &secret)["subscriptions"], 1);
    assert_eq!(status(port, &secret)["channelSubscriptions"], 1);
    assert_auth_session(&bearer_request(
        port,
        "POST",
        "/api/channel/typing/set",
        &first_token,
        json!({
            "args": { "conversationId": "conversation-1", "c": null },
            "payload": { "phase": "revoked" },
        }),
    ));
    assert_eq!(
        publish_typing(port, &second_token, &successor_lease).status,
        200
    );
    assert_eq!(
        second_channel.event()["entries"][0]["value"]["typing"],
        true
    );

    for exposed in [
        status(port, &secret),
        request(
            port,
            "GET",
            &format!("/control/trace?seq={}", sent.body["seq"]),
            &[("X-Snapback-Control", secret.as_str())],
            json!({}),
        )
        .body,
        revoked_query.body,
    ] {
        assert_tokens_absent(&exposed.to_string(), [&first_token, &second_token]);
    }

    stop_owner(port, &secret, &mut owner, "exact session logout complete");
    let log = fs::read_to_string(root.join(".snapback/log.jsonl")).unwrap();
    assert_tokens_absent(&log, [&first_token, &second_token]);
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn idle_expiry_and_clock_boundary_terminally_fence_query_and_channel() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    install_add_member_mutation(&root);
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    let (mut owner, port, secret) = start_owner(binary, &compiler, &root);

    let (idle_token, idle_viewer) = signup(port, "expiring-owner@example.com");
    add_conversation_member(port, &idle_viewer);
    let mut idle_query = Sse::open_bearer(port, THREAD_PATH, &idle_token);
    assert_eq!(idle_query.event()["state"], "complete");
    let mut idle_channel = Sse::open_bearer(port, TYPING_PATH, &idle_token);
    let _idle_channel_lease = idle_channel.event()["lease"].clone();
    let near_expiry = request(
        port,
        "POST",
        "/control/clock",
        &[("X-Snapback-Control", secret.as_str())],
        json!({ "advanceMs": SESSION_MILLIS - 3_000 }),
    );
    assert_eq!(near_expiry.status, 200, "{}", near_expiry.body);
    let still_valid = bearer_request(port, "GET", "/api/auth/me", &idle_token, json!({}));
    assert_eq!(still_valid.status, 200, "{}", still_valid.body);
    assert_session_terminal(&mut idle_query);
    assert_session_terminal(&mut idle_channel);
    assert_auth_session(&bearer_request(
        port,
        "GET",
        "/api/auth/me",
        &idle_token,
        json!({}),
    ));

    let boundary_token = login(port, "expiring-owner@example.com");
    let mut boundary_query = Sse::open_bearer(port, THREAD_PATH, &boundary_token);
    assert_eq!(boundary_query.event()["state"], "complete");
    let mut boundary_channel = Sse::open_bearer(port, TYPING_PATH, &boundary_token);
    let _boundary_channel_lease = boundary_channel.event()["lease"].clone();
    let boundary = request(
        port,
        "POST",
        "/control/clock",
        &[("X-Snapback-Control", secret.as_str())],
        json!({ "advanceMs": SESSION_MILLIS }),
    );
    assert_eq!(boundary.status, 200, "{}", boundary.body);
    assert_session_terminal(&mut boundary_query);
    assert_session_terminal(&mut boundary_channel);
    assert_auth_session(&bearer_request(
        port,
        "POST",
        "/api/auth/logout",
        &boundary_token,
        json!({}),
    ));

    stop_owner(port, &secret, &mut owner, "session expiry complete");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn negative_clock_advance_preserves_offset_session_and_live_state() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    install_add_member_mutation(&root);
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    let (mut owner, port, secret) = start_owner(binary, &compiler, &root);

    let (token, viewer) = signup(port, "clock-owner@example.com");
    add_conversation_member(port, &viewer);
    let mut query = Sse::open_bearer(port, THREAD_PATH, &token);
    assert_eq!(query.event()["state"], "complete");
    let mut channel = Sse::open_bearer(port, TYPING_PATH, &token);
    let channel_lease = channel.event()["lease"].clone();

    let before = request(
        port,
        "POST",
        "/control/clock",
        &[("X-Snapback-Control", secret.as_str())],
        json!({ "advanceMs": 0 }),
    );
    assert_eq!(before.status, 200, "{}", before.body);
    let refused = request(
        port,
        "POST",
        "/control/clock",
        &[("X-Snapback-Control", secret.as_str())],
        json!({ "advanceMs": -1 }),
    );
    assert_eq!(refused.status, 400, "{}", refused.body);
    assert_eq!(refused.body["code"], "E_INPUT", "{}", refused.body);
    assert_eq!(refused.body["family"], "input", "{}", refused.body);

    let after = request(
        port,
        "POST",
        "/control/clock",
        &[("X-Snapback-Control", secret.as_str())],
        json!({ "advanceMs": 0 }),
    );
    assert_eq!(after.status, 200, "{}", after.body);
    assert_eq!(after.body["offsetMs"], before.body["offsetMs"]);
    let me = bearer_request(port, "GET", "/api/auth/me", &token, json!({}));
    assert_eq!(me.status, 200, "{}", me.body);
    assert_eq!(me.body["viewer"], viewer);
    assert_eq!(status(port, &secret)["subscriptions"], 1);
    assert_eq!(status(port, &secret)["channelSubscriptions"], 1);
    query.assert_silent(Duration::from_millis(200));
    assert_eq!(publish_typing(port, &token, &channel_lease).status, 200);
    assert_eq!(channel.event()["entries"][0]["value"]["typing"], true);

    stop_owner(port, &secret, &mut owner, "negative clock refused");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn startup_and_persona_headers_do_not_issue_sessions() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    let (mut owner, port, secret) = start_owner(binary, &compiler, &root);

    let persona_query = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        json!({
            "op": "messages.thread",
            "args": { "conversationId": "conversation-1", "c": null },
        }),
    );
    assert_eq!(
        persona_query.body["state"], "complete",
        "{}",
        persona_query.body
    );
    let mut typed_channel = Sse::open(port, TYPING_PATH, "alice");
    let lease = typed_channel.event()["lease"].clone();
    let channel = request(
        port,
        "POST",
        "/api/channel/typing/set",
        &[("X-Snapback-As", "alice")],
        json!({
            "args": { "conversationId": "conversation-1" },
            "value": { "typing": true }, "lease": lease, "version": 1,
        }),
    );
    assert_eq!(channel.status, 200, "{}", channel.body);
    stop_owner(port, &secret, &mut owner, "persona epoch zero inspection");

    let project: snapback2_core::ProjectJson =
        serde_json::from_slice(&fs::read(root.join(".snapback/build/project.json")).unwrap())
            .unwrap();
    let generation =
        snapback2_core::Generation::certify(&project, snapback2_core::Ceilings::default()).unwrap();
    let runtime = snapback2_core::Runtime::open(
        snapback2_core::Store::open(&root.join(".snapback/store.sqlite")).unwrap(),
        generation,
    )
    .unwrap();
    assert_eq!(runtime.next_session_expiry().unwrap(), None);
    assert_eq!(runtime.store().meta("id_namespace").unwrap(), None);
    assert_eq!(
        runtime.store().meta("id_high_water").unwrap(),
        None,
        "query and channel contexts must not reserve mutation ids"
    );
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn serve_rejects_and_revokes_a_persisted_dev_persona_bearer_after_restart() {
    let root = temp_root();
    let auth_fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/compiler/fixtures/quarry-todos/snapback");
    copy_tree(&auth_fixture, &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    let (mut owner, port, secret) = start_owner(binary, &compiler, &root);

    let persona = request(
        port,
        "POST",
        "/control/persona",
        &[("X-Snapback-Control", secret.as_str())],
        json!({ "name": "persisted" }),
    );
    assert_eq!(persona.status, 200, "{}", persona.body);
    let persona_token = persona.body["token"].as_str().unwrap().to_owned();
    let (user_token, _) = signup(port, "serve-restart@example.com");
    let guest = request(port, "POST", "/api/auth/guest", &[], json!({}));
    assert_eq!(guest.status, 200, "{}", guest.body);
    let guest_token = guest.body["token"].as_str().unwrap().to_owned();
    stop_owner(
        port,
        &secret,
        &mut owner,
        "persisted session setup complete",
    );

    let mut owner = ChildGuard::spawn_with(binary, &compiler, &root, true);
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

    for (token, kind) in [(&user_token, "user"), (&guest_token, "guest")] {
        let me = bearer_request(port, "GET", "/api/auth/me", token, json!({}));
        assert_eq!(me.status, 200, "{kind}: {}", me.body);
        assert_eq!(me.body["kind"], kind, "{}", me.body);
    }

    let refused = bearer_request(port, "GET", "/api/auth/me", &persona_token, json!({}));
    assert_eq!(refused.status, 403, "{}", refused.body);
    assert_eq!(refused.body["code"], "E_AUTH_PERSONA_NOT_DEV");
    assert_eq!(refused.body["family"], "auth");
    assert_eq!(
        refused.body["rewrite"],
        "use a user/guest session for served requests, or start a dev owner for personas"
    );

    let revoked = bearer_request(port, "GET", "/api/auth/me", &persona_token, json!({}));
    assert_auth_session(&revoked);

    stop_owner(port, &secret, &mut owner, "serve bearer boundary verified");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn generated_grant_incarnations_do_not_repeat_across_owner_restart() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    let (mut owner, port, secret) = start_owner(binary, &compiler, &root);

    let mutate = |port: u16, op: &str, args: Value| {
        request(
            port,
            "POST",
            "/api/mutation",
            &[("X-Snapback-As", "alice")],
            json!({ "op": op, "args": args }),
        )
    };
    let first = mutate(
        port,
        "groups.memberAdd",
        json!({
            "conversationId": "conversation-1",
            "principal": "dev:charlie",
        }),
    );
    assert_eq!(first.body["state"], "committed", "{}", first.body);
    let predecessor_id = first.body["data"]["id"].as_str().unwrap().to_owned();
    assert!(predecessor_id.starts_with("s2id-"));
    let removed = mutate(
        port,
        "groups.memberRemove",
        json!({
            "conversationId": "conversation-1",
            "membershipId": predecessor_id,
        }),
    );
    assert_eq!(removed.body["state"], "committed", "{}", removed.body);
    stop_owner(port, &secret, &mut owner, "predecessor grant removed");

    let (mut owner, port, secret) = start_owner(binary, &compiler, &root);
    let recreated = mutate(
        port,
        "groups.memberAdd",
        json!({
            "conversationId": "conversation-1",
            "principal": "dev:charlie",
        }),
    );
    assert_eq!(recreated.body["state"], "committed", "{}", recreated.body);
    let successor_id = recreated.body["data"]["id"].as_str().unwrap().to_owned();
    assert_ne!(successor_id, predecessor_id);

    let stale = mutate(
        port,
        "groups.memberPromote",
        json!({
            "conversationId": "conversation-1",
            "membershipId": predecessor_id,
        }),
    );
    assert_eq!(stale.body["state"], "rejected", "{}", stale.body);
    assert_eq!(stale.body["code"], "MEMBERSHIP_REQUIRED", "{}", stale.body);
    let current = mutate(
        port,
        "groups.memberPromote",
        json!({
            "conversationId": "conversation-1",
            "membershipId": successor_id,
        }),
    );
    assert_eq!(current.body["state"], "committed", "{}", current.body);

    stop_owner(
        port,
        &secret,
        &mut owner,
        "durable grant incarnation verified",
    );
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
fn start_owner(binary: &str, compiler: &Path, root: &Path) -> (ChildGuard, u16, String) {
    let mut owner = ChildGuard::spawn(binary, compiler, root);
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
    (owner, port, secret)
}

#[cfg(not(feature = "hermes"))]
fn install_add_member_mutation(root: &Path) {
    let messages = root.join("snapback/messages.q");
    let mut source = fs::read_to_string(&messages).unwrap();
    source.push_str(
        r#"
mutation addMemberForSessionTest(conversationId: conversations, principal: principal):
  insert memberships { conversationId, principal, role: 'member', joinedAt: now }
  return null
"#,
    );
    fs::write(messages, source).unwrap();
}

#[cfg(not(feature = "hermes"))]
fn signup(port: u16, email: &str) -> (String, String) {
    let response = request(
        port,
        "POST",
        "/api/auth/signup",
        &[],
        json!({ "email": email, "password": "correct horse" }),
    );
    assert_eq!(response.status, 200, "{}", response.body);
    (
        response.body["token"].as_str().unwrap().to_owned(),
        response.body["viewer"].as_str().unwrap().to_owned(),
    )
}

#[cfg(not(feature = "hermes"))]
fn login(port: u16, email: &str) -> String {
    let response = request(
        port,
        "POST",
        "/api/auth/login",
        &[],
        json!({ "email": email, "password": "correct horse" }),
    );
    assert_eq!(response.status, 200, "{}", response.body);
    response.body["token"].as_str().unwrap().to_owned()
}

#[cfg(not(feature = "hermes"))]
fn add_conversation_member(port: u16, principal: &str) {
    let response = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "alice")],
        json!({
            "op": "messages.addMemberForSessionTest",
            "args": {
                "conversationId": "conversation-1",
                "principal": principal,
            },
        }),
    );
    assert_eq!(response.body["state"], "committed", "{}", response.body);
}

#[cfg(not(feature = "hermes"))]
fn bearer_request(
    port: u16,
    method: &str,
    path: &str,
    token: &str,
    body: Value,
) -> super::owner_wire::Response {
    let authorization = format!("Bearer {token}");
    request(
        port,
        method,
        path,
        &[("Authorization", authorization.as_str())],
        body,
    )
}

#[cfg(not(feature = "hermes"))]
fn publish_typing(port: u16, token: &str, lease: &Value) -> super::owner_wire::Response {
    bearer_request(
        port,
        "POST",
        "/api/channel/typing/set",
        token,
        json!({
            "args": { "conversationId": "conversation-1" },
            "value": { "typing": true }, "lease": lease, "version": 1,
        }),
    )
}

#[cfg(not(feature = "hermes"))]
fn assert_session_terminal(stream: &mut Sse) {
    let refusal = stream.event();
    assert_eq!(refusal["state"], "refused", "{refusal}");
    assert_eq!(refusal["code"], "E_AUTH_SESSION", "{refusal}");
    assert_eq!(refusal["family"], "auth", "{refusal}");
    stream.assert_closed();
}

#[cfg(not(feature = "hermes"))]
fn assert_auth_session(response: &super::owner_wire::Response) {
    assert_eq!(response.status, 401, "{}", response.body);
    assert_eq!(response.body["code"], "E_AUTH_SESSION", "{}", response.body);
}

#[cfg(not(feature = "hermes"))]
fn assert_tokens_absent<'a>(text: &str, tokens: impl IntoIterator<Item = &'a String>) {
    for token in tokens {
        assert!(
            !text.contains(token),
            "bearer token leaked through a protected surface"
        );
    }
}
