//! Lane O1b (LLP 1012 §7): replay grants, the replay envelope, the intent
//! ledger, and trace-validated commits.

use super::offline_resume::{boot, generation_pair, resume_body, thread_args};
use super::*;
use crate::owner_wire::Response;

const GRANT_COUNT: u64 = 8_192;
const THIRTY_DAYS_MS: i64 = 30 * 24 * 60 * 60 * 1_000;

fn persona(name: &'static str) -> [(&'static str, &'static str); 1] {
    [("X-Snapback-As", name)]
}

/// A resume with a trivial log, used only for the grant it returns.
fn resume_grant(port: u16, headers: &[(&str, &str)]) -> Value {
    let (generation, schema_hash) = generation_pair(port);
    let body = resume_body(
        &generation,
        &schema_hash,
        json!({ "op": "profiles.mine", "args": {}, "watermark": null, "validator": "" }),
        json!([]),
    );
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
    assert_eq!(grant["expiresAt"].as_i64().unwrap() - minted_at, THIRTY_DAYS_MS);
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
    let why = request(
        port,
        "POST",
        "/control/why",
        &[("X-Snapback-Control", secret)],
        json!({ "op": op, "args": args, "as": as_persona }),
    );
    assert_eq!(why.status, 200, "{}", why.body);
    assert_eq!(why.body["result"]["state"], "committed", "{}", why.body);
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
    let plain = mutation(port, &alice, "messages.send", send_args("profile-bob", "plain"), Value::Null);
    assert_eq!(plain.status, 200, "{}", plain.body);
    let expected = format!(
        r#"{{"data":{{"id":"{}"}},"seq":{},"state":"committed"}}"#,
        plain.body["data"]["id"].as_str().unwrap(),
        plain.body["seq"]
    );
    assert_eq!(String::from_utf8(plain.body_bytes.clone()).unwrap(), expected);
    let explicit_null = mutation(port, &alice, "messages.send", send_args("profile-bob", "null"), json!(null));
    assert_eq!(explicit_null.status, 200, "{}", explicit_null.body);
    assert!(explicit_null.body.get("intent").is_none());
    assert_eq!(
        explicit_null.body.as_object().unwrap().keys().collect::<Vec<_>>(),
        vec!["data", "seq", "state"]
    );

    let grant = resume_grant(port, &alice);
    let (start, _) = assert_grant_shape(&grant);
    let before = thread_bodies(port, &alice).len();

    // Pinned ids replace the allocator's reservation: the row gets the slice's
    // first id, and the same bytes twice return the stored response with one row.
    let args = send_args("profile-bob", "pinned");
    let first = mutation(port, &alice, "messages.send", args.clone(), envelope(&grant, 0, 8, empty_trace()));
    assert_eq!(first.status, 200, "{}", first.body);
    assert_eq!(first.body["state"], "committed", "{}", first.body);
    assert_eq!(engine_sequence(first.body["data"]["id"].as_str().unwrap()), start);
    assert_eq!(first.body["intent"], format!("{}:0", grant["id"].as_str().unwrap()));
    let seq_after_first = status(port, &secret)["seq"].as_u64().unwrap();
    let retry = mutation(port, &alice, "messages.send", args.clone(), envelope(&grant, 0, 8, empty_trace()));
    assert_eq!(retry.status, 200, "{}", retry.body);
    assert_eq!(retry.body_bytes, first.body_bytes, "a retry returns the stored bytes");
    assert_eq!(status(port, &secret)["seq"], seq_after_first, "a retry does not execute");
    assert_eq!(thread_bodies(port, &alice).len(), before + 1);

    // The same intent with different bytes is a reuse.
    let reuse = mutation(port, &alice, "messages.send", send_args("profile-bob", "different"), envelope(&grant, 0, 8, empty_trace()));
    assert_eq!(reuse.status, 400, "{}", reuse.body);
    assert_eq!(reuse.body["code"], "E_OFFLINE_INTENT_REUSE");
    assert_eq!(reuse.body["site"], "/api/mutation.replay.intent");
    assert!(reuse.body["rewrite"].as_str().is_some_and(|rewrite| !rewrite.is_empty()));

    // Slices outside the grant, overlapping a settled intent, or misnamed are id-block refusals.
    for (label, offset, count, intent) in [
        ("past the end", GRANT_COUNT - 2, 8, None),
        ("overlapping", 4, 8, None),
        ("empty", 16, 0, None),
        ("misnamed", 16, 8, Some(format!("{}:17", grant["id"].as_str().unwrap()))),
    ] {
        let mut replay = envelope(&grant, offset, count, empty_trace());
        if let Some(intent) = intent {
            replay["intent"] = json!(intent);
        }
        let blocked = mutation(port, &alice, "messages.send", send_args("profile-bob", label), replay);
        assert_eq!(blocked.status, 400, "{label}: {}", blocked.body);
        assert_eq!(blocked.body["code"], "E_OFFLINE_ID_BLOCK", "{label}");
        assert_eq!(blocked.body["site"], "/api/mutation.replay.offset");
    }
    assert_eq!(thread_bodies(port, &alice).len(), before + 1);

    // A rejection is stored too: the retry is the same rejection, and its
    // slice is spent.
    let rejected_args = send_args("profile-nobody", "rejected");
    let rejected = mutation(port, &alice, "messages.send", rejected_args.clone(), envelope(&grant, 16, 8, empty_trace()));
    assert_eq!(rejected.status, 200, "{}", rejected.body);
    assert_eq!(rejected.body["state"], "rejected");
    assert_eq!(rejected.body["code"], "RECIPIENT_UNKNOWN");
    assert_eq!(rejected.body["intent"], format!("{}:16", grant["id"].as_str().unwrap()));
    let rejected_again = mutation(port, &alice, "messages.send", rejected_args, envelope(&grant, 16, 8, empty_trace()));
    assert_eq!(rejected_again.body_bytes, rejected.body_bytes);
    let spent = mutation(port, &alice, "messages.send", send_args("profile-bob", "spent"), envelope(&grant, 20, 8, empty_trace()));
    assert_eq!(spent.body["code"], "E_OFFLINE_ID_BLOCK", "{}", spent.body);

    // Too few pinned ids is an ordinary rejection, recorded like any other.
    let starved = mutation(port, &alice, "messages.send", send_args("profile-bob", "starved"), envelope(&grant, 32, 1, empty_trace()));
    assert_eq!(starved.body["state"], "rejected", "{}", starved.body);
    assert_eq!(starved.body["code"], "E_INPUT");
    assert_eq!(thread_bodies(port, &alice).len(), before + 1);

    stop_owner(port, &secret, &mut owner, "offline replay envelope complete");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn offline_replay_grant_expires_after_thirty_days_by_server_clock() {
    let (root, mut owner, port, secret) = boot(|_| {});
    let alice = persona("alice");
    let grant = resume_grant(port, &alice);
    let fresh = mutation(port, &alice, "messages.send", send_args("profile-bob", "fresh"), envelope(&grant, 0, 8, empty_trace()));
    assert_eq!(fresh.body["state"], "committed", "{}", fresh.body);

    let advanced = request(
        port,
        "POST",
        "/control/clock",
        &[("X-Snapback-Control", &secret)],
        json!({ "advanceMs": THIRTY_DAYS_MS + 1_000 }),
    );
    assert_eq!(advanced.status, 200, "{}", advanced.body);
    let expired = mutation(port, &alice, "messages.send", send_args("profile-bob", "expired"), envelope(&grant, 8, 8, empty_trace()));
    assert_eq!(expired.status, 400, "{}", expired.body);
    assert_eq!(expired.body["code"], "E_OFFLINE_INTENT_EXPIRED");
    assert_eq!(expired.body["family"], "offline");
    assert_eq!(expired.body["site"], "/api/mutation.replay.grant");
    assert_eq!(expired.body["guide"], "offline");
    assert!(expired.body["rewrite"].as_str().is_some_and(|rewrite| rewrite.contains("resume")));

    let renewed = resume_grant(port, &alice);
    assert!(
        renewed["mintedAt"].as_i64().unwrap() - grant["mintedAt"].as_i64().unwrap() >= THIRTY_DAYS_MS,
        "grants are minted with server time"
    );
    let again = mutation(port, &alice, "messages.send", send_args("profile-bob", "renewed"), envelope(&renewed, 0, 8, empty_trace()));
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
    let edit_args = |body: &str, base: &str| {
        json!({ "messageId": "message-1", "body": body, "baseBody": base })
    };
    let point = |digest: &str| {
        json!({ "points": [{ "table": "messages", "index": "byId", "key": ["message-1"], "digest": digest }], "verdicts": [] })
    };
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
    let matching = mutation(port, &alice, "messages.edit", edit_args("v2", "Welcome"), envelope(&alice_grant, 0, 8, point(&welcome)));
    assert_eq!(matching.status, 200, "{}", matching.body);
    assert_eq!(matching.body["state"], "committed", "{}", matching.body);
    assert_eq!(body_of(port), "v2");

    // The row moves under the client; its held digest is stale. The edit's own
    // compare-and-set passes (baseBody is current), so only the trace can
    // catch it — and nothing is written.
    let v2 = pool_digest(port, &alice, "messages", "message-1");
    let moved = mutation(port, &alice, "messages.edit", edit_args("v3", "v2"), Value::Null);
    assert_eq!(moved.body["state"], "committed", "{}", moved.body);
    let seq_before = status(port, &secret)["seq"].as_u64().unwrap();
    let stale = mutation(port, &alice, "messages.edit", edit_args("v4", "v3"), envelope(&alice_grant, 8, 8, point(&v2)));
    assert_eq!(stale.status, 200, "{}", stale.body);
    assert_eq!(stale.body["state"], "rejected", "{}", stale.body);
    assert_eq!(stale.body["reason"], "conflict");
    assert!(stale.body.get("code").is_none(), "a conflict is a state, not a code");
    assert!(
        stale.body["site"].as_str().is_some_and(|site| site.starts_with("messages.edit")),
        "{}",
        stale.body
    );
    assert_eq!(stale.body["intent"], format!("{}:8", alice_grant["id"].as_str().unwrap()));
    assert_eq!(body_of(port), "v3", "a conflicting edit writes nothing");
    assert_eq!(status(port, &secret)["seq"], seq_before, "a conflict commits no seq");
    let stale_again = mutation(port, &alice, "messages.edit", edit_args("v4", "v3"), envelope(&alice_grant, 8, 8, point(&v2)));
    assert_eq!(stale_again.body_bytes, stale.body_bytes, "the conflict is stored with the intent");
    let v3 = pool_digest(port, &alice, "messages", "message-1");
    let current = mutation(port, &alice, "messages.edit", edit_args("v4", "v3"), envelope(&alice_grant, 16, 8, point(&v3)));
    assert_eq!(current.body["state"], "committed", "{}", current.body);
    assert_eq!(body_of(port), "v4");

    // A range that changed does not conflict: the fan-out uses the members at
    // commit, so a member who joined receives the replayed send.
    let alice_send = send_args("profile-bob", "to the group");
    let alice_trace = replay_trace_from(&why_trace(port, &secret, "messages.send", alice_send.clone(), "alice"));
    assert!(alice_trace["points"].as_array().unwrap().len() >= 3, "{alice_trace}");
    assert!(!alice_trace["verdicts"].as_array().unwrap().is_empty(), "{alice_trace}");
    let joined = mutation(
        port,
        &alice,
        "groups.memberAdd",
        json!({ "conversationId": "conversation-1", "principal": "dev:charlie" }),
        Value::Null,
    );
    assert_eq!(joined.body["state"], "committed", "{}", joined.body);
    let fanned = mutation(port, &alice, "messages.send", alice_send, envelope(&alice_grant, 24, 8, alice_trace));
    assert_eq!(fanned.body["state"], "committed", "{}", fanned.body);
    let commit = request(
        port,
        "GET",
        &format!("/control/trace?seq={}", fanned.body["seq"]),
        &[("X-Snapback-Control", &secret)],
        json!({}),
    );
    assert_eq!(commit.status, 200, "{}", commit.body);
    assert_eq!(commit.body["commit"]["writes"]["deliveries"], 3, "{}", commit.body["commit"]);
    assert_eq!(commit.body["commit"]["writes"]["messages"], 1);

    // A send whose traced membership no longer holds: bob queued a send as a
    // member, alice removed him, and the replay settles as a conflict at the
    // membership read rather than as the ordinary rejection.
    let bob_send = send_args("profile-alice", "from bob");
    let bob_trace = replay_trace_from(&why_trace(port, &secret, "messages.send", bob_send.clone(), "bob"));
    let removed = mutation(
        port,
        &alice,
        "groups.memberRemove",
        json!({ "conversationId": "conversation-1", "membershipId": "membership-2" }),
        Value::Null,
    );
    assert_eq!(removed.body["state"], "committed", "{}", removed.body);
    let seq_before = status(port, &secret)["seq"].as_u64().unwrap();
    let flipped = mutation(port, &bob, "messages.send", bob_send.clone(), envelope(&bob_grant, 0, 8, bob_trace));
    assert_eq!(flipped.status, 200, "{}", flipped.body);
    assert_eq!(flipped.body["state"], "rejected", "{}", flipped.body);
    assert_eq!(flipped.body["reason"], "conflict");
    assert!(
        flipped.body["site"].as_str().is_some_and(|site| site.starts_with("messages.send")),
        "{}",
        flipped.body
    );
    assert_eq!(status(port, &secret)["seq"], seq_before);
    let untraced = mutation(port, &bob, "messages.send", bob_send, envelope(&bob_grant, 8, 8, empty_trace()));
    assert_eq!(untraced.body["state"], "rejected", "{}", untraced.body);
    assert_eq!(untraced.body["code"], "NOT_MEMBER", "without a trace the ordinary rejection stands");

    stop_owner(port, &secret, &mut owner, "offline trace validation complete");
    fs::remove_dir_all(root).unwrap();
}
