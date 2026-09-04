//! Lane O1b (LLP 1012 §8): `POST /api/resume` as one owner action, and the
//! `retain` exposure on the manifest and certificate.

use super::*;

const MOUNTED_CAP: usize = 32;
const RESUME_BYTE_CAP: usize = 1_048_576;

/// Copy the chat fixture into a fresh root, apply `edit_sources` to it, and
/// start an owner. Returns the owner, its port, and the control secret.
pub(super) fn boot(edit_sources: impl FnOnce(&Path)) -> (PathBuf, ChildGuard, u16, String) {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    edit_sources(&root);
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
    let secret = owner_json["secret"].as_str().unwrap().to_owned();
    (root, owner, port, secret)
}

pub(super) fn thread_args(conversation: &str) -> Value {
    json!({ "conversationId": conversation, "c": null })
}

pub(super) fn resume_body(generation: &str, schema_hash: &str, log: Value, mounted: Value) -> Value {
    json!({
        "protocol": 1,
        "generation": generation,
        "schemaHash": schema_hash,
        "authEpoch": 0,
        "log": log,
        "mounted": mounted,
    })
}

/// The current certified program generation and schema hash, as the client
/// learns them from `/api/manifest`.
pub(super) fn generation_pair(port: u16) -> (String, String) {
    let manifest = request(port, "GET", "/api/manifest", &[], json!({}));
    assert_eq!(manifest.status, 200, "{}", manifest.body);
    (
        manifest.body["programGeneration"]
            .as_str()
            .unwrap()
            .to_owned(),
        manifest.body["generation"].as_str().unwrap().to_owned(),
    )
}

#[test]
fn offline_resume_first_page_unchanged_caps_reset_and_stale_epoch() {
    let (root, mut owner, port, secret) = boot(|_| {});
    let (generation, schema_hash) = generation_pair(port);
    let alice = [("X-Snapback-As", "alice")];
    let subscribe_path = "/api/subscribe?op=messages.thread&args=%7B%22conversationId%22%3A%22conversation-1%22%2C%22c%22%3Anull%7D";
    let mut live = Sse::open(port, subscribe_path, "alice");
    assert_eq!(live.event()["state"], "complete");
    let before = status(port, &secret);
    assert_eq!(before["subscriptions"], 1);
    let executions_before = before["executions"].as_u64().unwrap();

    // watermark: null asks for the first page; every mounted query executes once.
    let first = request(
        port,
        "POST",
        "/api/resume",
        &alice,
        resume_body(
            &generation,
            &schema_hash,
            json!({
                "op": "messages.thread",
                "args": thread_args("conversation-1"),
                "watermark": null,
                "validator": "",
            }),
            json!([
                { "op": "messages.summary", "args": { "conversationId": "conversation-1" }, "validator": "" },
                { "op": "messages.thread", "args": thread_args("conversation-2"), "validator": "" },
            ]),
        ),
    );
    assert_eq!(first.status, 200, "{}", first.body);
    assert_eq!(first.body["generation"], generation);
    assert_eq!(first.body["schemaHash"], schema_hash);
    assert_eq!(first.body["authority"]["principal"], "dev:alice");
    assert_eq!(first.body["authority"]["authEpoch"], 0);
    assert!(first.body["seq"].is_u64());
    assert!(first.body.get("more").is_none());
    let log = &first.body["log"];
    assert_eq!(log["protocol"], 1, "{log}");
    assert_eq!(log["state"], "complete");
    assert!(log["rows"].as_array().is_some_and(|rows| !rows.is_empty()));
    let watermark = log["watermark"].as_str().unwrap().to_owned();
    let mounted = first.body["mounted"].as_array().unwrap();
    assert_eq!(mounted.len(), 2);
    for answer in mounted {
        assert_eq!(answer["protocol"], 1, "{answer}");
        assert!(answer["validator"].as_str().is_some());
    }
    let grant = &first.body["grant"];
    assert_eq!(grant["count"], 8192, "{grant}");
    assert!(grant["from"].as_str().unwrap().starts_with("s2id-"));
    let after = status(port, &secret);
    assert_eq!(
        after["executions"].as_u64().unwrap() - executions_before,
        1 + 2,
        "resume executes the log tail plus each mounted query, never held pages"
    );
    assert_eq!(after["subscriptions"], 1, "resume must not reopen subscriptions");
    live.assert_silent(Duration::from_millis(200));

    // The drained tail: an empty page after the watermark whose validator the
    // client kept. The same request comes back `unchanged` on both halves.
    let tail = request(
        port,
        "POST",
        "/api/query",
        &alice,
        json!({
            "op": "messages.thread",
            "args": { "conversationId": "conversation-1", "c": watermark },
            "receipt": true,
        }),
    );
    assert_eq!(tail.status, 200, "{}", tail.body);
    assert_eq!(tail.body["data"], json!([]), "{}", tail.body);
    let tail_validator = tail.body["validator"].as_str().unwrap().to_owned();
    let summary_validator = mounted[0]["validator"].as_str().unwrap().to_owned();
    let executions_before = status(port, &secret)["executions"].as_u64().unwrap();
    let unchanged = request(
        port,
        "POST",
        "/api/resume",
        &alice,
        resume_body(
            &generation,
            &schema_hash,
            json!({
                "op": "messages.thread",
                "args": thread_args("conversation-1"),
                "watermark": watermark,
                "validator": tail_validator,
            }),
            json!([{
                "op": "messages.summary",
                "args": { "conversationId": "conversation-1" },
                "validator": summary_validator,
            }]),
        ),
    );
    assert_eq!(unchanged.status, 200, "{}", unchanged.body);
    assert_eq!(unchanged.body["log"], json!({ "unchanged": true }));
    assert_eq!(
        unchanged.body["mounted"],
        json!([{
            "op": "messages.summary",
            "args": { "conversationId": "conversation-1" },
            "unchanged": true,
            "validator": summary_validator,
        }])
    );
    assert!(unchanged.body["grant"]["from"].is_string());
    assert_eq!(
        status(port, &secret)["executions"].as_u64().unwrap() - executions_before,
        2
    );

    // Thirty-three mounted queries are refused before anything executes.
    let executions_before = status(port, &secret)["executions"].as_u64().unwrap();
    let too_many = request(
        port,
        "POST",
        "/api/resume",
        &alice,
        resume_body(
            &generation,
            &schema_hash,
            json!({
                "op": "messages.thread",
                "args": thread_args("conversation-1"),
                "watermark": null,
                "validator": "",
            }),
            Value::Array(
                std::iter::repeat_n(
                    json!({ "op": "messages.summary", "args": { "conversationId": "conversation-1" }, "validator": "" }),
                    MOUNTED_CAP + 1,
                )
                .collect(),
            ),
        ),
    );
    assert_eq!(too_many.status, 413, "{}", too_many.body);
    assert_eq!(too_many.body["code"], "E_OFFLINE_RESUME");
    assert_eq!(too_many.body["family"], "offline");
    assert_eq!(too_many.body["which"], "mounted");
    assert_eq!(too_many.body["cap"], MOUNTED_CAP);
    assert_eq!(
        too_many.body["rewrite"],
        "re-subscribe the rest as ordinary reads"
    );
    assert_eq!(
        status(port, &secret)["executions"].as_u64().unwrap(),
        executions_before
    );

    // A generation or schema the owner no longer serves resets the client.
    for (stale_generation, stale_schema) in [
        ("0".repeat(64), schema_hash.clone()),
        (generation.clone(), "0".repeat(64)),
    ] {
        let reset = request(
            port,
            "POST",
            "/api/resume",
            &alice,
            resume_body(
                &stale_generation,
                &stale_schema,
                json!({
                    "op": "messages.thread",
                    "args": thread_args("conversation-1"),
                    "watermark": null,
                    "validator": "",
                }),
                json!([]),
            ),
        );
        assert_eq!(reset.status, 409, "{}", reset.body);
        assert_eq!(reset.body["code"], "E_OFFLINE_RESET");
        assert_eq!(reset.body["generation"], generation);
        assert_eq!(reset.body["schemaHash"], schema_hash);
        assert!(reset.body.get("log").is_none());
    }

    // A stale auth epoch is refused with no data: the client seals.
    let signup = request(
        port,
        "POST",
        "/api/auth/signup",
        &[],
        json!({ "email": "resume@example.com", "password": "correct horse" }),
    );
    assert_eq!(signup.status, 200, "{}", signup.body);
    let login = request(
        port,
        "POST",
        "/api/auth/login",
        &[],
        json!({ "email": "resume@example.com", "password": "correct horse" }),
    );
    assert_eq!(login.status, 200, "{}", login.body);
    let authorization = format!("Bearer {}", login.body["token"].as_str().unwrap());
    let bearer = [("Authorization", authorization.as_str())];
    let envelope = request(
        port,
        "POST",
        "/api/query",
        &bearer,
        json!({ "op": "profiles.mine", "args": {}, "receipt": true }),
    );
    let epoch = envelope.body["authority"]["authEpoch"].as_u64().unwrap();
    assert!(epoch > 1, "{}", envelope.body);
    let mut stale = resume_body(
        &generation,
        &schema_hash,
        json!({ "op": "profiles.mine", "args": {}, "watermark": null, "validator": "" }),
        json!([]),
    );
    stale["authEpoch"] = json!(epoch - 1);
    let refused = request(port, "POST", "/api/resume", &bearer, stale.clone());
    assert_eq!(refused.status, 401, "{}", refused.body);
    assert_eq!(refused.body["code"], "E_AUTH_SESSION");
    assert!(refused.body.get("log").is_none() && refused.body.get("grant").is_none());
    stale["authEpoch"] = json!(epoch);
    let current = request(port, "POST", "/api/resume", &bearer, stale);
    assert_eq!(current.status, 200, "{}", current.body);
    assert_eq!(current.body["authority"]["authEpoch"], epoch);
    assert_eq!(current.body["log"]["watermark"], Value::Null);

    let wrong_protocol = request(
        port,
        "POST",
        "/api/resume",
        &alice,
        json!({ "protocol": 2, "generation": generation, "schemaHash": schema_hash, "authEpoch": 0,
                "log": { "op": "profiles.mine", "args": {}, "watermark": null, "validator": "" }, "mounted": [] }),
    );
    assert_eq!(wrong_protocol.status, 400, "{}", wrong_protocol.body);

    stop_owner(port, &secret, &mut owner, "offline resume contract complete");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn offline_resume_stops_at_one_mib_of_output_with_more() {
    let (root, mut owner, port, secret) = boot(|_| {});
    let (generation, schema_hash) = generation_pair(port);
    let alice = [("X-Snapback-As", "alice")];
    let body = "x".repeat(4_000);
    for _ in 0..50 {
        let sent = request(
            port,
            "POST",
            "/api/mutation",
            &alice,
            json!({
                "op": "messages.send",
                "args": { "conversationId": "conversation-1", "recipientId": "profile-bob", "body": body },
            }),
        );
        assert_eq!(sent.body["state"], "committed", "{}", sent.body);
    }
    let held = json!({ "op": "messages.thread", "args": thread_args("conversation-1"), "validator": "" });
    let mounted_count = 8;
    let executions_before = status(port, &secret)["executions"].as_u64().unwrap();
    let response = request(
        port,
        "POST",
        "/api/resume",
        &alice,
        resume_body(
            &generation,
            &schema_hash,
            json!({
                "op": "messages.thread",
                "args": thread_args("conversation-1"),
                "watermark": null,
                "validator": "",
            }),
            Value::Array(std::iter::repeat_n(held, mounted_count).collect()),
        ),
    );
    assert_eq!(response.status, 200, "{}", response.body["code"]);
    let answered = response.body["mounted"].as_array().unwrap().len();
    let more = response.body["more"].as_u64().unwrap() as usize;
    assert!(answered >= 1 && more >= 1, "answered {answered}, more {more}");
    assert_eq!(answered + more, mounted_count);
    assert!(
        response.body_bytes.len() <= RESUME_BYTE_CAP + 64,
        "resume output was {} bytes",
        response.body_bytes.len()
    );
    assert_eq!(response.body["log"]["data"].as_array().unwrap().len(), 50);
    let executed = status(port, &secret)["executions"].as_u64().unwrap() - executions_before;
    assert_eq!(
        executed,
        1 + answered as u64 + 1,
        "the log, each answered query, and the one that crossed the cap execute once; the rest wait for the next resume"
    );
    assert!(executed <= 1 + mounted_count as u64);
    stop_owner(port, &secret, &mut owner, "offline resume byte cap complete");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn offline_manifest_and_certificate_carry_retain() {
    let (root, mut owner, port, secret) = boot(|_| {});
    let manifest = request(port, "GET", "/api/manifest", &[], json!({}));
    assert_eq!(manifest.status, 200, "{}", manifest.body);
    let tables = manifest.body["tables"].as_object().unwrap();
    assert_eq!(tables["messages"]["retain"], "delivered-history", "{tables:?}");
    assert_eq!(tables["deliveries"]["retain"], "until-revoked");
    assert_eq!(tables["memberships"]["retain"], "until-revoked");
    for (name, table) in tables {
        assert!(table["retain"].is_string(), "{name} has no retain word");
    }

    let program_generation = manifest.body["programGeneration"].as_str().unwrap();
    let program = request(
        port,
        "GET",
        &format!("/api/program?generation={program_generation}"),
        &[("X-Snapback-As", "alice")],
        json!({}),
    );
    assert_eq!(program.status, 200, "{}", program.body);
    let certificate = &program.body["programs"]["messages.send"]["certificate"];
    assert_eq!(certificate["tables"]["messages"]["retain"], "delivered-history", "{certificate}");
    assert_eq!(certificate["tables"]["deliveries"]["retain"], "until-revoked");
    let parsed: snapback2_core::Certificate =
        serde_json::from_value(certificate.clone()).unwrap();
    assert_eq!(
        parsed.tables["messages"].retain,
        snapback2_core::RetentionPolicy::DeliveredHistory
    );

    // The envelope never echoes retain per range.
    let thread = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        json!({ "op": "messages.thread", "args": thread_args("conversation-1"), "receipt": true }),
    );
    assert_eq!(thread.status, 200, "{}", thread.body);
    for range in thread.body["receipt"]["ranges"].as_array().unwrap() {
        assert!(range.get("retain").is_none(), "{range}");
    }
    stop_owner(port, &secret, &mut owner, "retain exposure complete");
    fs::remove_dir_all(root).unwrap();
}
