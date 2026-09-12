//! Lane O1b (LLP 1012 §7): replay grants, the replay envelope, the intent
//! ledger, and trace-validated commits.

use super::offline_resume::{append_source, boot, generation_pair, resume_body, thread_args};
use super::*;
use crate::owner_wire::Response;
use snapback2_core::{Value as CoreValue, rule_inputs_digest};

const GRANT_COUNT: u64 = 8_192;
const THIRTY_DAYS_MS: i64 = 30 * 24 * 60 * 60 * 1_000;

fn persona(name: &'static str) -> [(&'static str, &'static str); 1] {
    [("X-Snapback-As", name)]
}

/// A resume with no log and nothing mounted, used only for the grant it returns.
fn resume_grant(port: u16, headers: &[(&str, &str)]) -> Value {
    let (generation, schema_hash) = generation_pair(port);
    let body = resume_body(&generation, &schema_hash, Value::Null, json!([]));
    let response = request(port, "POST", "/api/resume", headers, body);
    assert_eq!(response.status, 200, "{}", response.body);
    response.body["grant"].clone()
}

fn envelope(grant: &Value, offset: u64, count: u64, trace: Value) -> Value {
    let id = grant["id"].as_str().unwrap();
    json!({
        "grant": id,
        "offset": offset,
        "count": count,
        "intent": format!("{id}:{offset}"),
        "trace": trace,
    })
}

fn empty_trace() -> Value {
    json!({ "points": [], "verdicts": [] })
}

fn send_args(recipient: &str, body: &str) -> Value {
    json!({ "conversationId": "conversation-1", "recipientId": recipient, "body": body })
}

fn mutation(port: u16, headers: &[(&str, &str)], op: &str, args: Value, replay: Value) -> Response {
    let mut body = json!({ "op": op, "args": args });
    if !replay.is_null() {
        body["replay"] = replay;
    }
    request(port, "POST", "/api/mutation", headers, body)
}

fn engine_sequence(id: &str) -> u64 {
    let (namespace, sequence) = id.strip_prefix("s2id-").unwrap().rsplit_once('-').unwrap();
    assert_eq!(namespace.len(), 32, "{id}");
    assert_eq!(sequence.len(), 16, "{id}");
    u64::from_str_radix(sequence, 16).unwrap()
}

fn assert_grant_shape(grant: &Value) -> (u64, u64) {
    assert_eq!(grant["count"], GRANT_COUNT, "{grant}");
    let from = grant["from"].as_str().unwrap();
    assert_eq!(grant["id"], grant["from"]);
    let minted_at = grant["mintedAt"].as_i64().unwrap();
    assert_eq!(
        grant["expiresAt"].as_i64().unwrap() - minted_at,
        THIRTY_DAYS_MS
    );
    let start = engine_sequence(from);
    (start, start + GRANT_COUNT)
}

fn thread_bodies(port: u16, headers: &[(&str, &str)]) -> Vec<(String, String)> {
    let thread = request(
        port,
        "POST",
        "/api/query",
        headers,
        json!({ "op": "messages.thread", "args": thread_args("conversation-1") }),
    );
    assert_eq!(thread.status, 200, "{}", thread.body);
    thread.body["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            (
                row["id"].as_str().unwrap().to_owned(),
                row["body"].as_str().unwrap_or_default().to_owned(),
            )
        })
        .collect()
}

/// The digest a client computes for a row it holds: SHA-256 over the canonical
/// wire row exactly as the envelope's pool delivered it.
fn pool_digest(port: u16, headers: &[(&str, &str)], table: &str, id: &str) -> String {
    let thread = request(
        port,
        "POST",
        "/api/query",
        headers,
        json!({ "op": "messages.thread", "args": thread_args("conversation-1"), "receipt": true }),
    );
    assert_eq!(thread.status, 200, "{}", thread.body);
    let row = thread.body["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["table"] == table && row["id"] == id)
        .unwrap_or_else(|| panic!("{table}/{id} is not in the pool: {}", thread.body["rows"]));
    snapback2_core::digest(&row["row"])
}

/// Turn the owner's authoritative trace (from `/control/why`) into the replay
/// trace a twin would send: points as wire keys plus digests, verdicts as
/// (ruleHash, inputsDigest, result).
fn replay_trace_from(trace: &Value) -> Value {
    fn plain(value: &Value) -> Value {
        match value {
            Value::Object(tagged) if tagged.len() == 1 => {
                let (tag, inner) = tagged.iter().next().unwrap();
                match tag.as_str() {
                    "Id" | "String" | "Int" | "Bool" => inner.clone(),
                    _ => panic!("unexpected key value {value}"),
                }
            }
            Value::String(tag) if tag == "Null" => Value::Null,
            _ => panic!("unexpected key value {value}"),
        }
    }
    let points = trace["points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|point| {
            json!({
                "table": point["table"],
                "index": point["index"],
                "key": point["key"].as_array().unwrap().iter().map(plain).collect::<Vec<_>>(),
                "digest": if point["visible"] == true { point["digest"].clone() } else { Value::Null },
            })
        })
        .collect::<Vec<_>>();
    let verdicts = trace["rule_inputs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|verdict| {
            json!({
                "ruleHash": verdict["rule_hash"],
                "inputsDigest": verdict["pinned_inputs_digest"],
                "result": verdict["result"],
            })
        })
        .collect::<Vec<_>>();
    json!({ "points": points, "verdicts": verdicts })
}

fn why_trace(port: u16, secret: &str, op: &str, args: Value, as_persona: &str) -> Value {
    why_trace_in_state(port, secret, op, args, as_persona, "committed")
}

/// The owner's authoritative trace of one run of `op` as `as_persona`, which
/// must settle in `state` (`committed` for a mutation, `complete` for a query).
fn why_trace_in_state(
    port: u16,
    secret: &str,
    op: &str,
    args: Value,
    as_persona: &str,
    state: &str,
) -> Value {
    let why = request(
        port,
        "POST",
        "/control/why",
        &[("X-Snapback-Control", secret)],
        json!({ "op": op, "args": args, "as": as_persona, "queryOnly": false }),
    );
    assert_eq!(why.status, 200, "{}", why.body);
    assert_eq!(why.body["result"]["state"], state, "{}", why.body);
    why.body["trace"].clone()
}

#[test]
fn offline_grants_are_principal_bound_engine_ids_disjoint_from_the_allocator() {
    let (root, mut owner, port, secret) = boot(|_| {});
    let signup = request(
        port,
        "POST",
        "/api/auth/signup",
        &[],
        json!({ "email": "grants@example.com", "password": "correct horse" }),
    );
    assert_eq!(signup.status, 200, "{}", signup.body);
    let login = |port| {
        let login = request(
            port,
            "POST",
            "/api/auth/login",
            &[],
            json!({ "email": "grants@example.com", "password": "correct horse" }),
        );
        assert_eq!(login.status, 200, "{}", login.body);
        login.body
    };
    let first = login(port);
    let second = login(port);
    let first_range = assert_grant_shape(&first["grant"]);
    let second_range = assert_grant_shape(&second["grant"]);
    assert!(
        first_range.1 <= second_range.0 || second_range.1 <= first_range.0,
        "two grants overlap: {first_range:?} {second_range:?}"
    );
    let guest = request(port, "POST", "/api/auth/guest", &[], json!({}));
    assert_eq!(guest.status, 200, "{}", guest.body);
    assert!(guest.body["viewer"].as_str().unwrap().starts_with("guest:"));
    assert_grant_shape(&guest.body["grant"]);
    let alice_grant = resume_grant(port, &persona("alice"));
    assert_grant_shape(&alice_grant);

    // A second session of the same principal finishes the first session's outbox.
    let second_authorization = format!("Bearer {}", second["token"].as_str().unwrap());
    let second_session = [("Authorization", second_authorization.as_str())];
    let profile_args = json!({
        "displayName": "Grant Holder",
        "handle": "grant_holder",
        "bio": "",
        "location": "",
    });
    let pinned = mutation(
        port,
        &second_session,
        "profiles.createMyProfile",
        profile_args.clone(),
        envelope(&first["grant"], 0, 4, empty_trace()),
    );
    assert_eq!(pinned.status, 200, "{}", pinned.body);
    assert_eq!(pinned.body["state"], "committed", "{}", pinned.body);
    assert_eq!(
        pinned.body["data"]["id"], first["grant"]["from"],
        "the slice's first id is the program's first new id"
    );
    assert_eq!(
        pinned.body["intent"],
        format!("{}:0", first["grant"]["id"].as_str().unwrap())
    );

    // Another principal cannot spend it.
    let foreign = mutation(
        port,
        &persona("alice"),
        "profiles.createMyProfile",
        profile_args,
        envelope(&first["grant"], 8, 4, empty_trace()),
    );
    assert_eq!(foreign.status, 400, "{}", foreign.body);
    assert_eq!(foreign.body["code"], "E_OFFLINE_INTENT_EXPIRED");
    assert_eq!(foreign.body["family"], "offline");
    assert_eq!(foreign.body["site"], "/api/mutation.replay.grant");

    // The allocator's own reservations never land inside a grant, and a grant
    // minted afterwards starts past them.
    let ordinary = mutation(
        port,
        &persona("alice"),
        "messages.send",
        send_args("profile-bob", "allocator"),
        Value::Null,
    );
    assert_eq!(ordinary.body["state"], "committed", "{}", ordinary.body);
    let reserved = engine_sequence(ordinary.body["data"]["id"].as_str().unwrap());
    for (label, (start, end)) in [
        ("first", first_range),
        ("second", second_range),
        ("alice", assert_grant_shape(&alice_grant)),
    ] {
        assert!(
            !(start..end).contains(&reserved),
            "ordinary id {reserved} fell inside the {label} grant {start}..{end}"
        );
    }
    let later = login(port);
    assert!(assert_grant_shape(&later["grant"]).0 > reserved);
    stop_owner(port, &secret, &mut owner, "offline grants complete");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn offline_replay_envelope_pins_ids_and_dedups_by_intent() {
    let (root, mut owner, port, secret) = boot(|_| {});
    let alice = persona("alice");

    // Without an envelope the mutation wire is exactly today's bytes.
    let plain = mutation(
        port,
        &alice,
        "messages.send",
        send_args("profile-bob", "plain"),
        Value::Null,
    );
    assert_eq!(plain.status, 200, "{}", plain.body);
    let expected = format!(
        r#"{{"data":{{"id":"{}"}},"seq":{},"state":"committed"}}"#,
        plain.body["data"]["id"].as_str().unwrap(),
        plain.body["seq"]
    );
    assert_eq!(
        String::from_utf8(plain.body_bytes.clone()).unwrap(),
        expected
    );
    let explicit_null = mutation(
        port,
        &alice,
        "messages.send",
        send_args("profile-bob", "null"),
        json!(null),
    );
    assert_eq!(explicit_null.status, 200, "{}", explicit_null.body);
    assert!(explicit_null.body.get("intent").is_none());
    assert_eq!(
        explicit_null
            .body
            .as_object()
            .unwrap()
            .keys()
            .collect::<Vec<_>>(),
        vec!["data", "seq", "state"]
    );

    let grant = resume_grant(port, &alice);
    let (start, _) = assert_grant_shape(&grant);
    let before = thread_bodies(port, &alice).len();

    // Pinned ids replace the allocator's reservation: the row gets the slice's
    // first id, and the same bytes twice return the stored response with one row.
    let args = send_args("profile-bob", "pinned");
    let first = mutation(
        port,
        &alice,
        "messages.send",
        args.clone(),
        envelope(&grant, 0, 8, empty_trace()),
    );
    assert_eq!(first.status, 200, "{}", first.body);
    assert_eq!(first.body["state"], "committed", "{}", first.body);
    assert_eq!(
        engine_sequence(first.body["data"]["id"].as_str().unwrap()),
        start
    );
    assert_eq!(
        first.body["intent"],
        format!("{}:0", grant["id"].as_str().unwrap())
    );
    let effects = first.body["effects"].as_array().unwrap();
    assert_eq!(effects.iter().map(|effect| effect["table"].as_str().unwrap()).collect::<Vec<_>>(),
        ["deliveries", "messageCounts", "messages"], "only the sender's delivery is observable");
    assert_eq!(effects[2]["id"], first.body["data"]["id"]);
    let seq_after_first = status(port, &secret)["seq"].as_u64().unwrap();
    let retry = mutation(
        port,
        &alice,
        "messages.send",
        args.clone(),
        envelope(&grant, 0, 8, empty_trace()),
    );
    assert_eq!(retry.status, 200, "{}", retry.body);
    assert_eq!(
        retry.body_bytes, first.body_bytes,
        "a retry returns the stored bytes"
    );
    assert_eq!(
        status(port, &secret)["seq"],
        seq_after_first,
        "a retry does not execute"
    );
    assert_eq!(thread_bodies(port, &alice).len(), before + 1);

    // The same intent with different bytes is a reuse.
    let reuse = mutation(
        port,
        &alice,
        "messages.send",
        send_args("profile-bob", "different"),
        envelope(&grant, 0, 8, empty_trace()),
    );
    assert_eq!(reuse.status, 400, "{}", reuse.body);
    assert_eq!(reuse.body["code"], "E_OFFLINE_INTENT_REUSE");
    assert_eq!(reuse.body["site"], "/api/mutation.replay.intent");
    assert!(
        reuse.body["rewrite"]
            .as_str()
            .is_some_and(|rewrite| !rewrite.is_empty())
    );

    // Slices outside the grant, overlapping a settled intent, or misnamed are id-block refusals.
    for (label, offset, count, intent) in [
        ("past the end", GRANT_COUNT - 2, 8, None),
        ("overlapping", 4, 8, None),
        ("empty", 16, 0, None),
        (
            "misnamed",
            16,
            8,
            Some(format!("{}:17", grant["id"].as_str().unwrap())),
        ),
    ] {
        let mut replay = envelope(&grant, offset, count, empty_trace());
        if let Some(intent) = intent {
            replay["intent"] = json!(intent);
        }
        let blocked = mutation(
            port,
            &alice,
            "messages.send",
            send_args("profile-bob", label),
            replay,
        );
        assert_eq!(blocked.status, 400, "{label}: {}", blocked.body);
        assert_eq!(blocked.body["code"], "E_OFFLINE_ID_BLOCK", "{label}");
        assert_eq!(blocked.body["site"], "/api/mutation.replay.offset");
    }
    assert_eq!(thread_bodies(port, &alice).len(), before + 1);

    // A rejection is stored too: the retry is the same rejection, and its
    // slice is spent.
    let rejected_args = send_args("profile-nobody", "rejected");
    let rejected = mutation(
        port,
        &alice,
        "messages.send",
        rejected_args.clone(),
        envelope(&grant, 16, 8, empty_trace()),
    );
    assert_eq!(rejected.status, 200, "{}", rejected.body);
    assert_eq!(rejected.body["state"], "rejected");
    assert_eq!(rejected.body["code"], "RECIPIENT_UNKNOWN");
    assert_eq!(
        rejected.body["intent"],
        format!("{}:16", grant["id"].as_str().unwrap())
    );
    let rejected_again = mutation(
        port,
        &alice,
        "messages.send",
        rejected_args,
        envelope(&grant, 16, 8, empty_trace()),
    );
    assert_eq!(rejected_again.body_bytes, rejected.body_bytes);
    let spent = mutation(
        port,
        &alice,
        "messages.send",
        send_args("profile-bob", "spent"),
        envelope(&grant, 20, 8, empty_trace()),
    );
    assert_eq!(spent.body["code"], "E_OFFLINE_ID_BLOCK", "{}", spent.body);

    // Too few pinned ids is an ordinary rejection, recorded like any other.
    let starved = mutation(
        port,
        &alice,
        "messages.send",
        send_args("profile-bob", "starved"),
        envelope(&grant, 32, 1, empty_trace()),
    );
    assert_eq!(starved.body["state"], "rejected", "{}", starved.body);
    assert_eq!(starved.body["code"], "E_INPUT");
    assert_eq!(thread_bodies(port, &alice).len(), before + 1);

    stop_owner(
        port,
        &secret,
        &mut owner,
        "offline replay envelope complete",
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn offline_replay_grant_expires_after_thirty_days_by_server_clock() {
    let (root, mut owner, port, secret) = boot(|_| {});
    let alice = persona("alice");
    let grant = resume_grant(port, &alice);
    let fresh = mutation(
        port,
        &alice,
        "messages.send",
        send_args("profile-bob", "fresh"),
        envelope(&grant, 0, 8, empty_trace()),
    );
    assert_eq!(fresh.body["state"], "committed", "{}", fresh.body);

    let advanced = request(
        port,
        "POST",
        "/control/clock",
        &[("X-Snapback-Control", &secret)],
        json!({ "advanceMs": THIRTY_DAYS_MS + 1_000 }),
    );
    assert_eq!(advanced.status, 200, "{}", advanced.body);
    let expired = mutation(
        port,
        &alice,
        "messages.send",
        send_args("profile-bob", "expired"),
        envelope(&grant, 8, 8, empty_trace()),
    );
    assert_eq!(expired.status, 400, "{}", expired.body);
    assert_eq!(expired.body["code"], "E_OFFLINE_INTENT_EXPIRED");
    assert_eq!(expired.body["family"], "offline");
    assert_eq!(expired.body["site"], "/api/mutation.replay.grant");
    assert_eq!(expired.body["guide"], "offline");
    assert!(
        expired.body["rewrite"]
            .as_str()
            .is_some_and(|rewrite| rewrite.contains("resume"))
    );

    let renewed = resume_grant(port, &alice);
    assert!(
        renewed["mintedAt"].as_i64().unwrap() - grant["mintedAt"].as_i64().unwrap()
            >= THIRTY_DAYS_MS,
        "grants are minted with server time"
    );
    let again = mutation(
        port,
        &alice,
        "messages.send",
        send_args("profile-bob", "renewed"),
        envelope(&renewed, 0, 8, empty_trace()),
    );
    assert_eq!(again.body["state"], "committed", "{}", again.body);
    stop_owner(port, &secret, &mut owner, "offline grant expiry complete");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn offline_replay_trace_conflicts_on_moved_points_and_verdicts_not_ranges() {
    let edit = r#"
mutation edit(messageId: messages, body: text <=4000, baseBody: text <=4000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require msg.body = baseBody else CONFLICT
  update messages[msg] { body }
  for m in memberships[msg.conversationId] first 50 by byConversationPrincipal:
    insert deliveries { recipient: m.principal, conversationId: msg.conversationId, messageId, kind: 'edit', at: now }
  return null
"#;
    let (root, mut owner, port, secret) = boot(|root| {
        let messages = root.join("snapback/messages.q");
        let source = fs::read_to_string(&messages).unwrap() + edit;
        fs::write(messages, source).unwrap();
    });
    let alice = persona("alice");
    let bob = persona("bob");
    let alice_grant = resume_grant(port, &alice);
    let bob_grant = resume_grant(port, &bob);
    let edit_args = |body: &str, base: &str| json!({ "messageId": "message-1", "body": body, "baseBody": base });
    let point = |digest: &str| json!({ "points": [{ "table": "messages", "index": "byId", "key": ["message-1"], "digest": digest }], "verdicts": [] });
    let body_of = |port| {
        thread_bodies(port, &alice)
            .into_iter()
            .find(|(id, _)| id == "message-1")
            .unwrap()
            .1
    };
    assert_eq!(body_of(port), "Welcome");

    // A matching trace commits.
    let welcome = pool_digest(port, &alice, "messages", "message-1");
    let matching = mutation(
        port,
        &alice,
        "messages.edit",
        edit_args("v2", "Welcome"),
        envelope(&alice_grant, 0, 8, point(&welcome)),
    );
    assert_eq!(matching.status, 200, "{}", matching.body);
    assert_eq!(matching.body["state"], "committed", "{}", matching.body);
    assert_eq!(body_of(port), "v2");

    // The row moves under the client; its held digest is stale. The edit's own
    // compare-and-set passes (baseBody is current), so only the trace can
    // catch it — and nothing is written.
    let v2 = pool_digest(port, &alice, "messages", "message-1");
    let moved = mutation(
        port,
        &alice,
        "messages.edit",
        edit_args("v3", "v2"),
        Value::Null,
    );
    assert_eq!(moved.body["state"], "committed", "{}", moved.body);
    let seq_before = status(port, &secret)["seq"].as_u64().unwrap();
    let stale = mutation(
        port,
        &alice,
        "messages.edit",
        edit_args("v4", "v3"),
        envelope(&alice_grant, 8, 8, point(&v2)),
    );
    assert_eq!(stale.status, 200, "{}", stale.body);
    assert_eq!(stale.body["state"], "rejected", "{}", stale.body);
    assert_eq!(stale.body["reason"], "conflict");
    assert!(
        stale.body.get("code").is_none(),
        "a conflict is a state, not a code"
    );
    assert!(
        stale.body["site"]
            .as_str()
            .is_some_and(|site| site.starts_with("messages.edit")),
        "{}",
        stale.body
    );
    assert_eq!(
        stale.body["intent"],
        format!("{}:8", alice_grant["id"].as_str().unwrap())
    );
    assert_eq!(body_of(port), "v3", "a conflicting edit writes nothing");
    assert_eq!(
        status(port, &secret)["seq"],
        seq_before,
        "a conflict commits no seq"
    );
    let stale_again = mutation(
        port,
        &alice,
        "messages.edit",
        edit_args("v4", "v3"),
        envelope(&alice_grant, 8, 8, point(&v2)),
    );
    assert_eq!(
        stale_again.body_bytes, stale.body_bytes,
        "the conflict is stored with the intent"
    );
    let v3 = pool_digest(port, &alice, "messages", "message-1");
    let current = mutation(
        port,
        &alice,
        "messages.edit",
        edit_args("v4", "v3"),
        envelope(&alice_grant, 16, 8, point(&v3)),
    );
    assert_eq!(current.body["state"], "committed", "{}", current.body);
    assert_eq!(body_of(port), "v4");

    // A range that changed does not conflict: the fan-out uses the members at
    // commit, so a member who joined receives the replayed send.
    let alice_send = send_args("profile-bob", "to the group");
    let alice_trace = replay_trace_from(&why_trace(
        port,
        &secret,
        "messages.send",
        alice_send.clone(),
        "alice",
    ));
    assert!(
        alice_trace["points"].as_array().unwrap().len() >= 3,
        "{alice_trace}"
    );
    assert!(
        !alice_trace["verdicts"].as_array().unwrap().is_empty(),
        "{alice_trace}"
    );
    let joined = mutation(
        port,
        &alice,
        "groups.memberAdd",
        json!({ "conversationId": "conversation-1", "principal": "dev:charlie" }),
        Value::Null,
    );
    assert_eq!(joined.body["state"], "committed", "{}", joined.body);
    let fanned = mutation(
        port,
        &alice,
        "messages.send",
        alice_send,
        envelope(&alice_grant, 24, 8, alice_trace),
    );
    assert_eq!(fanned.body["state"], "committed", "{}", fanned.body);
    let commit = request(
        port,
        "GET",
        &format!("/control/trace?seq={}", fanned.body["seq"]),
        &[("X-Snapback-Control", &secret)],
        json!({}),
    );
    assert_eq!(commit.status, 200, "{}", commit.body);
    assert_eq!(
        commit.body["commit"]["writes"]["deliveries"], 3,
        "{}",
        commit.body["commit"]
    );
    assert_eq!(commit.body["commit"]["writes"]["messages"], 1);

    // A send whose traced membership no longer holds: bob queued a send as a
    // member, alice removed him, and the replay settles as a conflict at the
    // membership read rather than as the ordinary rejection.
    let bob_send = send_args("profile-alice", "from bob");
    let bob_trace = replay_trace_from(&why_trace(
        port,
        &secret,
        "messages.send",
        bob_send.clone(),
        "bob",
    ));
    let removed = mutation(
        port,
        &alice,
        "groups.memberRemove",
        json!({ "conversationId": "conversation-1", "membershipId": "membership-2" }),
        Value::Null,
    );
    assert_eq!(removed.body["state"], "committed", "{}", removed.body);
    let seq_before = status(port, &secret)["seq"].as_u64().unwrap();
    let flipped = mutation(
        port,
        &bob,
        "messages.send",
        bob_send.clone(),
        envelope(&bob_grant, 0, 8, bob_trace),
    );
    assert_eq!(flipped.status, 200, "{}", flipped.body);
    assert_eq!(flipped.body["state"], "rejected", "{}", flipped.body);
    assert_eq!(flipped.body["reason"], "conflict");
    assert!(
        flipped.body["site"]
            .as_str()
            .is_some_and(|site| site.starts_with("messages.send")),
        "{}",
        flipped.body
    );
    assert_eq!(status(port, &secret)["seq"], seq_before);
    let untraced = mutation(
        port,
        &bob,
        "messages.send",
        bob_send,
        envelope(&bob_grant, 8, 8, empty_trace()),
    );
    assert_eq!(untraced.body["state"], "rejected", "{}", untraced.body);
    assert_eq!(
        untraced.body["code"], "NOT_MEMBER",
        "without a trace the ordinary rejection stands"
    );

    stop_owner(
        port,
        &secret,
        &mut owner,
        "offline trace validation complete",
    );
    fs::remove_dir_all(root).unwrap();
}

/// Fix round 1, item 1: the intent ledger is consulted before any grant
/// check, so an identical retry is exactly-once even after its grant expired
/// and was swept — while a new intent on that grant is refused as expired.
#[test]
fn offline_replay_identical_retry_after_grant_expiry_returns_the_stored_terminal() {
    let (root, mut owner, port, secret) = boot(|_| {});
    let alice = persona("alice");
    let grant = resume_grant(port, &alice);
    let ten_days = 10 * 24 * 60 * 60 * 1_000;
    let advance = |ms: i64| {
        let advanced = request(
            port,
            "POST",
            "/control/clock",
            &[("X-Snapback-Control", &secret)],
            json!({ "advanceMs": ms }),
        );
        assert_eq!(advanced.status, 200, "{}", advanced.body);
    };
    advance(ten_days);
    let args = send_args("profile-bob", "before the fence");
    let first = mutation(
        port,
        &alice,
        "messages.send",
        args.clone(),
        envelope(&grant, 0, 8, empty_trace()),
    );
    assert_eq!(first.body["state"], "committed", "{}", first.body);
    let before = thread_bodies(port, &alice).len();

    // The grant is now past thirty days by server time and swept; the intent
    // (ten days younger) is not.
    advance(THIRTY_DAYS_MS - ten_days + 1_000);
    let seq = status(port, &secret)["seq"].as_u64().unwrap();
    let executions = status(port, &secret)["executions"].as_u64().unwrap();
    let retry = mutation(
        port,
        &alice,
        "messages.send",
        args.clone(),
        envelope(&grant, 0, 8, empty_trace()),
    );
    assert_eq!(retry.status, 200, "{}", retry.body);
    assert_eq!(
        retry.body_bytes, first.body_bytes,
        "the stored terminal, byte for byte"
    );
    assert_eq!(status(port, &secret)["seq"], seq, "nothing executed");
    assert_eq!(status(port, &secret)["executions"], executions);
    assert_eq!(thread_bodies(port, &alice).len(), before, "one row");
    let reuse = mutation(
        port,
        &alice,
        "messages.send",
        send_args("profile-bob", "other bytes"),
        envelope(&grant, 0, 8, empty_trace()),
    );
    assert_eq!(
        reuse.body["code"], "E_OFFLINE_INTENT_REUSE",
        "the ledger outranks the grant: {}",
        reuse.body
    );
    let fresh = mutation(
        port,
        &alice,
        "messages.send",
        send_args("profile-bob", "after the fence"),
        envelope(&grant, 8, 8, empty_trace()),
    );
    assert_eq!(fresh.status, 400, "{}", fresh.body);
    assert_eq!(fresh.body["code"], "E_OFFLINE_INTENT_EXPIRED");
    stop_owner(
        port,
        &secret,
        &mut owner,
        "offline retry after expiry complete",
    );
    fs::remove_dir_all(root).unwrap();
}

/// Fix round 1, item 5: a traced point that moved is a conflict whether the
/// program's `require` fails before or after the read that would have seen
/// it — the rejected path probes every traced point the program never
/// reached — and a rejection whose reads all still hold keeps its own code.
#[test]
fn offline_replay_conflict_precedence_is_independent_of_require_order() {
    let (root, mut owner, port, secret) = boot(|root| {
        append_source(
            root,
            "snapback/messages.q",
            r#"
mutation edit(messageId: messages, body: text <=4000, baseBody: text <=4000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require msg.body = baseBody else CONFLICT
  update messages[msg] { body }
  return null

mutation guarded(messageId: messages, other: messages, body: text <=4000, expected: text <=4000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.body = expected else STALE
  peer = messages[other] ! else NOT_FOUND
  update messages[msg] { body }
  return { peer: peer.id }

mutation unguarded(messageId: messages, other: messages, body: text <=4000, expected: text <=4000):
  msg = messages[messageId] ! else NOT_FOUND
  peer = messages[other] ! else NOT_FOUND
  require msg.body = expected else STALE
  update messages[msg] { body }
  return { peer: peer.id }
"#,
        );
    });
    let alice = persona("alice");
    let grant = resume_grant(port, &alice);
    let sent = mutation(
        port,
        &alice,
        "messages.send",
        send_args("profile-bob", "peer"),
        Value::Null,
    );
    assert_eq!(sent.body["state"], "committed", "{}", sent.body);
    let peer = sent.body["data"]["id"].as_str().unwrap().to_owned();
    let welcome = pool_digest(port, &alice, "messages", "message-1");
    let peer_held = pool_digest(port, &alice, "messages", &peer);
    // The peer moves under the client after it traced both rows.
    let moved = mutation(
        port,
        &alice,
        "messages.edit",
        json!({ "messageId": peer, "body": "peer v2", "baseBody": "peer" }),
        Value::Null,
    );
    assert_eq!(moved.body["state"], "committed", "{}", moved.body);
    let trace = |peer_digest: &str| {
        json!({
            "points": [
                { "table": "messages", "index": "byId", "key": ["message-1"], "digest": welcome },
                { "table": "messages", "index": "byId", "key": [peer], "digest": peer_digest },
            ],
            "verdicts": [],
        })
    };
    let args = json!({ "messageId": "message-1", "other": peer, "body": "changed", "expected": "not the body" });
    let body_of = || {
        thread_bodies(port, &alice)
            .into_iter()
            .find(|(id, _)| id == "message-1")
            .unwrap()
            .1
    };
    let seq = status(port, &secret)["seq"].as_u64().unwrap();
    for (label, op, offset) in [
        ("require before the moved read", "messages.guarded", 0),
        ("require after it", "messages.unguarded", 8),
    ] {
        let settled = mutation(
            port,
            &alice,
            op,
            args.clone(),
            envelope(&grant, offset, 8, trace(&peer_held)),
        );
        assert_eq!(settled.status, 200, "{label}: {}", settled.body);
        assert_eq!(
            settled.body["state"], "rejected",
            "{label}: {}",
            settled.body
        );
        assert_eq!(
            settled.body["reason"], "conflict",
            "{label}: {}",
            settled.body
        );
        assert!(
            settled.body.get("code").is_none(),
            "{label}: a conflict is a state, not a code"
        );
        assert!(
            settled.body["site"]
                .as_str()
                .is_some_and(|site| site.starts_with("messages.")),
            "{label}: {}",
            settled.body
        );
    }
    assert_eq!(body_of(), "Welcome", "a conflicting program writes nothing");
    assert_eq!(status(port, &secret)["seq"], seq);

    // With the peer's current digest nothing has moved, so the program's own
    // rejection stands on either shape.
    let peer_current = pool_digest(port, &alice, "messages", &peer);
    for (op, offset) in [("messages.guarded", 16), ("messages.unguarded", 24)] {
        let stale = mutation(
            port,
            &alice,
            op,
            args.clone(),
            envelope(&grant, offset, 8, trace(&peer_current)),
        );
        assert_eq!(stale.body["state"], "rejected", "{op}: {}", stale.body);
        assert_eq!(stale.body["code"], "STALE", "{op}: {}", stale.body);
    }
    stop_owner(
        port,
        &secret,
        &mut owner,
        "offline conflict precedence complete",
    );
    fs::remove_dir_all(root).unwrap();
}

/// Fix round 2, item 1: an unreached verdict is re-derived only through a
/// rule check on a row this principal may see, never from raw existence, and
/// the rule inputs a hidden candidate minted never reach the compare. So a
/// trace whose verdict names a hidden row's key settles exactly as one
/// naming an absent key — on the rejected path and on the committed path —
/// and the ledger stores the same terminal for both; a verdict the twin
/// legitimately holds still validates.
#[test]
fn offline_replay_unreached_verdicts_never_disclose_hidden_rows() {
    let (root, mut owner, port, secret) = boot(|root| {
        append_source(
            root,
            "snapback/messages.q",
            r#"
mutation peek(messageId: messages, other: messages, expected: text <=4000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.body = expected else STALE
  peer = messages[other]
  if peer != null:
    return { seen: true }
  return { seen: false }
"#,
        );
    });
    // bob is a member of conversation-1 only: message-2 (conversation-2) is a
    // row that exists and is hidden from him; message-nope is absent.
    let bob = persona("bob");
    let grant = resume_grant(port, &bob);
    let welcome = pool_digest(port, &bob, "messages", "message-1");
    let peek_args = |other: &str, expected: &str| json!({ "messageId": "message-1", "other": other, "expected": expected });
    // Everything a probing client needs is public: the read rule's hash is on
    // every trace the rule ever minted for it, and the inputs digest formula
    // is a wire fact it can compute for any key.
    let why = why_trace(
        port,
        &secret,
        "messages.peek",
        peek_args("message-1", "Welcome"),
        "bob",
    );
    let own_membership = why["rule_inputs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|input| input["table"] == "memberships")
        .unwrap_or_else(|| panic!("{why}"))
        .clone();
    let read_rule = own_membership["rule_hash"].as_str().unwrap().to_owned();
    let membership_digest = |conversation: &str| {
        rule_inputs_digest(
            "memberships",
            "byConversationPrincipal",
            &[
                CoreValue::Id(conversation.to_owned()),
                CoreValue::Id("dev:bob".to_owned()),
            ],
        )
    };
    assert_eq!(
        own_membership["pinned_inputs_digest"],
        membership_digest("conversation-1"),
        "the formula the client computes is the digest the rule minted"
    );
    let own_key_digest =
        |id: &str| rule_inputs_digest("messages", "byId", &[CoreValue::Id(id.to_owned())]);
    let verdict = |digest: String, result: bool| json!([{ "ruleHash": read_rule, "inputsDigest": digest, "result": result }]);
    let trace = |other: &str, verdicts: Value| {
        json!({
            "points": [
                { "table": "messages", "index": "byId", "key": ["message-1"], "digest": welcome },
                { "table": "messages", "index": "byId", "key": [other], "digest": null },
            ],
            "verdicts": verdicts,
        })
    };
    // Settle one intent twice and return its terminal without the intent
    // name, so two intents can be compared field for field.
    let settle = |offset: u64, other: &str, expected: &str, verdicts: Value| {
        let replay = envelope(&grant, offset, 8, trace(other, verdicts));
        let first = mutation(
            port,
            &bob,
            "messages.peek",
            peek_args(other, expected),
            replay.clone(),
        );
        assert_eq!(first.status, 200, "{}", first.body);
        let again = mutation(
            port,
            &bob,
            "messages.peek",
            peek_args(other, expected),
            replay,
        );
        assert_eq!(
            again.body_bytes, first.body_bytes,
            "the ledger holds one terminal per intent"
        );
        let mut body = first.body;
        body.as_object_mut().unwrap().remove("intent");
        body
    };
    let seq = status(port, &secret)["seq"].as_u64().unwrap();

    // Rejected path, a verdict over the row's own key: re-deriving it from
    // raw existence would flip the hidden row alone to a conflict.
    let hidden = settle(
        0,
        "message-2",
        "not the body",
        verdict(own_key_digest("message-2"), false),
    );
    let absent = settle(
        8,
        "message-nope",
        "not the body",
        verdict(own_key_digest("message-nope"), false),
    );
    assert_eq!(hidden["state"], "rejected", "{hidden}");
    assert_eq!(
        hidden["code"], "STALE",
        "an unverifiable verdict leaves the program's own code: {hidden}"
    );
    assert_eq!(
        hidden, absent,
        "own-key verdict: a hidden row and an absent one settle identically"
    );

    // Rejected path, a verdict over the membership the read rule probes:
    // the probe of a hidden hit does derive that input, and it must not count.
    let hidden = settle(
        16,
        "message-2",
        "not the body",
        verdict(membership_digest("conversation-2"), true),
    );
    let absent = settle(
        24,
        "message-nope",
        "not the body",
        verdict(membership_digest("conversation-2"), true),
    );
    assert_eq!(hidden["code"], "STALE", "{hidden}");
    assert_eq!(
        hidden, absent,
        "membership verdict: a hidden row and an absent one settle identically"
    );
    assert_eq!(status(port, &secret)["seq"], seq, "nothing committed");

    // Committed path: the program reads `other` (null either way) and would
    // commit; the strict compare must not let a hidden hit's rule inputs
    // vouch for the verdict, or only the hidden row would commit.
    let hidden = settle(
        32,
        "message-2",
        "Welcome",
        verdict(membership_digest("conversation-2"), false),
    );
    let absent = settle(
        40,
        "message-nope",
        "Welcome",
        verdict(membership_digest("conversation-2"), false),
    );
    assert_eq!(hidden["state"], "rejected", "{hidden}");
    assert_eq!(hidden["reason"], "conflict", "{hidden}");
    assert_eq!(hidden["site"], format!("rule:{read_rule}"), "{hidden}");
    assert_eq!(
        hidden, absent,
        "committed path: a hidden row and an absent one settle identically"
    );
    assert_eq!(status(port, &secret)["seq"], seq, "nothing committed");

    // Control: the verdict bob legitimately holds — his own membership, derived
    // by the visible read of message-1 — still validates and commits.
    let held = settle(
        48,
        "message-nope",
        "Welcome",
        verdict(membership_digest("conversation-1"), true),
    );
    assert_eq!(held["state"], "committed", "{held}");
    assert_eq!(held["data"]["seen"], false, "{held}");

    stop_owner(
        port,
        &secret,
        &mut owner,
        "offline hidden-row verdicts complete",
    );
    fs::remove_dir_all(root).unwrap();
}

/// Fix round 2, item 2: the verdict leg of conflict precedence is whole. A
/// traced verdict that flipped is a conflict whether the program's `require`
/// fails before or after the read whose rule derives it — the rejected path
/// probes the unread point through its rule — while the same verdict, still
/// holding, leaves the program's own code on either shape.
#[test]
fn offline_replay_verdict_conflict_precedence_is_independent_of_require_order() {
    let (root, mut owner, port, secret) = boot(|root| {
        // A read rule with a redundant term: removing bob's membership flips
        // the membership verdict without hiding his own note, so the verdict
        // is the only thing that moves.
        append_source(
            root,
            "snapback/schema.q",
            r#"

table notes:
  conversationId: conversations
  authorId: principal
  body: text <=4000
  read <- (exists memberships[.conversationId, viewer] or .authorId = viewer)
  insert <- .authorId = viewer
  update <- .authorId = viewer
  delete <- deny
"#,
        );
        append_source(
            root,
            "snapback/notes.q",
            r#"
mutation create(conversationId: conversations, body: text <=4000):
  row = insert notes { conversationId, authorId: viewer, body }
  return { id: row.id }

query view(noteId: notes):
  return notes[noteId]

mutation guarded(profileId: profiles, noteId: notes, expected: text <=20, body: text <=4000):
  author = profiles[profileId] ! else NOT_FOUND
  require author.handle = expected else STALE
  note = notes[noteId] ! else NOT_FOUND
  update notes[note] { body }
  return null

mutation unguarded(profileId: profiles, noteId: notes, expected: text <=20, body: text <=4000):
  author = profiles[profileId] ! else NOT_FOUND
  note = notes[noteId] ! else NOT_FOUND
  require author.handle = expected else STALE
  update notes[note] { body }
  return null
"#,
        );
    });
    let alice = persona("alice");
    let bob = persona("bob");
    let grant = resume_grant(port, &bob);
    let created = mutation(
        port,
        &bob,
        "notes.create",
        json!({ "conversationId": "conversation-1", "body": "mine" }),
        Value::Null,
    );
    assert_eq!(created.body["state"], "committed", "{}", created.body);
    let note = created.body["data"]["id"].as_str().unwrap().to_owned();
    // The owner's trace of reading the note: its point, the membership
    // verdict its read rule derived, and the transitive visibility probe of
    // the membership row that rule found (same inputs, the memberships read
    // rule's hash) — a twin holds only the first, since visibility probes
    // never become receipt verdicts.
    let view_args = json!({ "noteId": note });
    let full = replay_trace_from(&why_trace_in_state(
        port,
        &secret,
        "notes.view",
        view_args.clone(),
        "bob",
        "complete",
    ));
    assert_eq!(full["points"].as_array().unwrap().len(), 1, "{full}");
    assert_eq!(full["verdicts"].as_array().unwrap().len(), 2, "{full}");
    assert!(
        full["verdicts"]
            .as_array()
            .unwrap()
            .iter()
            .all(|verdict| verdict["result"] == true),
        "{full}"
    );
    let args = json!({ "profileId": "profile-bob", "noteId": note, "expected": "not the handle", "body": "changed" });
    let body_of = || {
        let view = request(
            port,
            "POST",
            "/api/query",
            &bob,
            json!({ "op": "notes.view", "args": { "noteId": note } }),
        );
        assert_eq!(view.status, 200, "{}", view.body);
        view.body["data"]["body"].as_str().unwrap().to_owned()
    };

    // While the verdicts hold, the program's own rejection stands on either shape.
    for (op, offset) in [("notes.guarded", 0), ("notes.unguarded", 8)] {
        let stale = mutation(
            port,
            &bob,
            op,
            args.clone(),
            envelope(&grant, offset, 8, full.clone()),
        );
        assert_eq!(stale.body["state"], "rejected", "{op}: {}", stale.body);
        assert_eq!(stale.body["code"], "STALE", "{op}: {}", stale.body);
    }

    // alice removes bob: the verdict flips while the note stays visible to
    // its author with the same digest.
    let removed = mutation(
        port,
        &alice,
        "groups.memberRemove",
        json!({ "conversationId": "conversation-1", "membershipId": "membership-2" }),
        Value::Null,
    );
    assert_eq!(removed.body["state"], "committed", "{}", removed.body);
    assert_eq!(body_of(), "mine", "the note is still bob's to read");
    // With the membership gone only the read rule's own probe is derived
    // (nothing was found to derive visibility for), which names that rule.
    let flipped = why_trace_in_state(port, &secret, "notes.view", view_args, "bob", "complete");
    let flipped = flipped["rule_inputs"].as_array().unwrap();
    assert_eq!(flipped.len(), 1, "{flipped:?}");
    assert_eq!(flipped[0]["result"], false, "{flipped:?}");
    let rule = flipped[0]["rule_hash"].as_str().unwrap().to_owned();
    let held = json!({
        "points": full["points"],
        "verdicts": full["verdicts"].as_array().unwrap().iter().filter(|verdict| verdict["ruleHash"] == rule).collect::<Vec<_>>(),
    });
    assert_eq!(held["verdicts"].as_array().unwrap().len(), 1, "{full}");
    let seq = status(port, &secret)["seq"].as_u64().unwrap();
    for (label, op, offset) in [
        (
            "require before the read whose rule derives it",
            "notes.guarded",
            16,
        ),
        ("require after it", "notes.unguarded", 24),
    ] {
        let settled = mutation(
            port,
            &bob,
            op,
            args.clone(),
            envelope(&grant, offset, 8, held.clone()),
        );
        assert_eq!(settled.status, 200, "{label}: {}", settled.body);
        assert_eq!(
            settled.body["state"], "rejected",
            "{label}: {}",
            settled.body
        );
        assert_eq!(
            settled.body["reason"], "conflict",
            "{label}: {}",
            settled.body
        );
        assert_eq!(
            settled.body["site"],
            format!("rule:{rule}"),
            "{label}: {}",
            settled.body
        );
        assert!(
            settled.body.get("code").is_none(),
            "{label}: a conflict is a state, not a code"
        );
    }
    assert_eq!(body_of(), "mine", "a conflicting program writes nothing");
    assert_eq!(status(port, &secret)["seq"], seq);

    stop_owner(
        port,
        &secret,
        &mut owner,
        "offline verdict precedence complete",
    );
    fs::remove_dir_all(root).unwrap();
}

/// Fix round 2, item 3: a bearer whose session was logged out cannot replay
/// at all — the mutation route refuses it before the ledger, the grant, or
/// the slice is consulted — while the grant, bound to the principal, outlives
/// that session, so a fresh login of the same principal finishes the outbox
/// it queued and reads the terminals it stored.
#[test]
fn offline_replay_needs_a_live_session_and_the_grant_outlives_it() {
    let (root, mut owner, port, secret) = boot(|_| {});
    let credentials = json!({ "email": "outbox@example.com", "password": "correct horse" });
    let signup = request(port, "POST", "/api/auth/signup", &[], credentials.clone());
    assert_eq!(signup.status, 200, "{}", signup.body);
    let login = |remaining: Value| {
        let mut body = credentials.clone();
        if !remaining.is_null() {
            body["remaining"] = remaining;
        }
        let response = request(port, "POST", "/api/auth/login", &[], body);
        assert_eq!(response.status, 200, "{}", response.body);
        response.body
    };
    let first = login(Value::Null);
    let grant = first["grant"].clone();
    assert_grant_shape(&grant);
    let grant_id = grant["id"].as_str().unwrap().to_owned();
    let first_authorization = format!("Bearer {}", first["token"].as_str().unwrap());
    let first_session = [("Authorization", first_authorization.as_str())];
    let profile_args = json!({ "displayName": "Outbox Owner", "handle": "outbox_owner", "bio": "", "location": "" });
    let post_args = json!({ "body": "queued before logout" });
    let created = mutation(
        port,
        &first_session,
        "profiles.createMyProfile",
        profile_args.clone(),
        envelope(&grant, 0, 4, empty_trace()),
    );
    assert_eq!(created.body["state"], "committed", "{}", created.body);

    let logout = request(port, "POST", "/api/auth/logout", &first_session, json!({}));
    assert_eq!(logout.status, 200, "{}", logout.body);
    let before = status(port, &secret);
    // A new intent and a retry of the committed one both die at the session
    // check: no terminal, stored or fresh, reaches a dead session.
    for (label, op, args, offset) in [
        ("a new intent", "posts.createPost", post_args.clone(), 8),
        (
            "a retry of the committed intent",
            "profiles.createMyProfile",
            profile_args.clone(),
            0,
        ),
    ] {
        let refused = mutation(
            port,
            &first_session,
            op,
            args,
            envelope(&grant, offset, 4, empty_trace()),
        );
        assert_eq!(refused.status, 401, "{label}: {}", refused.body);
        assert_eq!(
            refused.body["code"], "E_AUTH_SESSION",
            "{label}: {}",
            refused.body
        );
        assert_eq!(refused.body["family"], "auth", "{label}: {}", refused.body);
        assert!(
            refused.body.get("state").is_none() && refused.body.get("intent").is_none(),
            "{label}: {}",
            refused.body
        );
    }
    let after = status(port, &secret);
    assert_eq!(after["seq"], before["seq"], "nothing executed");
    assert_eq!(after["executions"], before["executions"]);

    // A fresh session of the same principal, holding enough ids to be minted
    // nothing, finishes the outbox on the old grant: the refused attempt
    // stored nothing, and the first session's terminal is the principal's.
    let second = login(json!(8_000));
    assert!(second.get("grant").is_none(), "{second}");
    let second_authorization = format!("Bearer {}", second["token"].as_str().unwrap());
    let second_session = [("Authorization", second_authorization.as_str())];
    let executions = status(port, &secret)["executions"].as_u64().unwrap();
    let finished = mutation(
        port,
        &second_session,
        "posts.createPost",
        post_args,
        envelope(&grant, 8, 4, empty_trace()),
    );
    assert_eq!(finished.body["state"], "committed", "{}", finished.body);
    assert_eq!(finished.body["intent"], format!("{grant_id}:8"));
    assert_eq!(
        status(port, &secret)["executions"],
        executions + 1,
        "the dead session's attempt left no terminal"
    );
    let stored = mutation(
        port,
        &second_session,
        "profiles.createMyProfile",
        profile_args,
        envelope(&grant, 0, 4, empty_trace()),
    );
    assert_eq!(
        stored.body_bytes, created.body_bytes,
        "the stored terminal, byte for byte"
    );

    stop_owner(port, &secret, &mut owner, "offline replay session complete");
    fs::remove_dir_all(root).unwrap();
}
