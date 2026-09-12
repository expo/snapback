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
    // The resume log is an ascending `after c first 50` page (LLP 1012 §8);
    // the fixture's thread pages backwards, so every offline test gets one.
    append_source(&root, "snapback/messages.q", LOG_QUERY);
    edit_sources(&root);
    let compiler = compiler(&root);
    let mut owner = ChildGuard::spawn(env!("CARGO_BIN_EXE_snapback2"), &compiler, &root);
    let ready = owner.ready_line();
    let port = ready
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap_or_else(|| panic!("the owner did not become ready: {ready:?}"))
        .parse()
        .unwrap();
    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = owner_json["secret"].as_str().unwrap().to_owned();
    (root, owner, port, secret)
}

pub(super) const LOG_QUERY: &str = r#"
query log(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return messages[conversationId] after c first 50
"#;

pub(super) fn append_source(root: &Path, relative: &str, source: &str) {
    let path = root.join(relative);
    let existing = fs::read_to_string(&path).unwrap_or_default();
    fs::write(path, existing + source).unwrap();
}

pub(super) fn thread_args(conversation: &str) -> Value {
    json!({ "conversationId": conversation, "c": null })
}

pub(super) fn resume_body(
    generation: &str,
    schema_hash: &str,
    log: Value,
    mounted: Value,
) -> Value {
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
                "op": "messages.log",
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
    assert_eq!(
        after["subscriptions"], 1,
        "resume must not reopen subscriptions"
    );
    live.assert_silent(Duration::from_millis(200));

    // The drained tail: an empty page after the watermark whose validator the
    // client kept. The same request comes back `unchanged` on both halves.
    let tail = request(
        port,
        "POST",
        "/api/query",
        &alice,
        json!({
            "op": "messages.log",
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
                "op": "messages.log",
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
                "op": "messages.log",
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
                    "op": "messages.log",
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
    let mut stale = resume_body(&generation, &schema_hash, Value::Null, json!([]));
    stale["authEpoch"] = json!(epoch - 1);
    let refused = request(port, "POST", "/api/resume", &bearer, stale.clone());
    assert_eq!(refused.status, 401, "{}", refused.body);
    assert_eq!(refused.body["code"], "E_AUTH_SESSION");
    assert!(refused.body.get("log").is_none() && refused.body.get("grant").is_none());
    stale["authEpoch"] = json!(epoch);
    let current = request(port, "POST", "/api/resume", &bearer, stale);
    assert_eq!(current.status, 200, "{}", current.body);
    assert_eq!(current.body["authority"]["authEpoch"], epoch);
    assert!(
        current.body["log"].is_null(),
        "no log was sent: {}",
        current.body
    );

    let wrong_protocol = request(
        port,
        "POST",
        "/api/resume",
        &alice,
        json!({ "protocol": 2, "generation": generation, "schemaHash": schema_hash, "authEpoch": 0,
                "log": null, "mounted": [] }),
    );
    assert_eq!(wrong_protocol.status, 400, "{}", wrong_protocol.body);

    stop_owner(
        port,
        &secret,
        &mut owner,
        "offline resume contract complete",
    );
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
    let held =
        json!({ "op": "messages.thread", "args": thread_args("conversation-1"), "validator": "" });
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
                "op": "messages.log",
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
    assert!(
        answered >= 1 && more >= 1,
        "answered {answered}, more {more}"
    );
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
    stop_owner(
        port,
        &secret,
        &mut owner,
        "offline resume byte cap complete",
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn offline_manifest_and_certificate_carry_retain() {
    let (root, mut owner, port, secret) = boot(|root| {
        append_source(
            root,
            "snapback/messages.q",
            r#"
proc cursorPreview(conversationId: conversations, position: cursor ?):
  preview = messages[conversationId] after position first 1
fn cursorPage(conversationId: conversations, position: cursor ?): messages[conversationId] after position first 2
query cursorRecord(a: cursor ?, c: cursor ?, conversationId: conversations, flag: bool):
  cursorPreview(conversationId, a)
  selected = c
  if flag:
    return { messages: cursorPage(conversationId, selected) }
  return { messages: cursorPage(conversationId, c) }
query cursorBranches(a: cursor ?, c: cursor ?, conversationId: conversations, flag: bool):
  if flag:
    return { messages: cursorPage(conversationId, a) }
  return { messages: cursorPage(conversationId, c) }
"#,
        )
    });
    let manifest = request(port, "GET", "/api/manifest", &[], json!({}));
    assert_eq!(manifest.status, 200, "{}", manifest.body);
    let tables = manifest.body["tables"].as_object().unwrap();
    assert_eq!(
        tables["messages"]["retain"], "delivered-history",
        "{tables:?}"
    );
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
    for (op, cursor) in [
        ("messages.log", json!("c")),
        ("messages.cursorRecord", json!("c")),
        ("messages.cursorBranches", Value::Null),
    ] {
        assert_eq!(manifest.body["ops"][op]["cursor"], cursor, "manifest {op}");
        assert_eq!(
            program.body["programs"][op]["cursor"], cursor,
            "program {op}"
        );
    }
    assert_eq!(
        manifest.body["ops"]["messages.cursorRecord"]["drain"]["reason"],
        "cursor-binding"
    );
    let certificate = &program.body["programs"]["messages.send"]["certificate"];
    assert_eq!(
        certificate["tables"]["messages"]["retain"], "delivered-history",
        "{certificate}"
    );
    assert_eq!(
        certificate["tables"]["deliveries"]["retain"],
        "until-revoked"
    );
    let parsed: snapback2_core::Certificate = serde_json::from_value(certificate.clone()).unwrap();
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

/// Fix round 1, item 2: the log is the certified ascending page — `after c
/// first <= 50` — never a backwards or unpaged query, and its bytes count
/// against the same 1 MiB budget as the mounted answers: when the log alone
/// exceeds it, `more` names every mounted query and none of them executes.
#[test]
fn offline_resume_log_is_the_ascending_page_measured_against_the_budget() {
    let (root, mut owner, port, secret) = boot(|root| {
        append_source(
            root,
            "snapback/schema.q",
            r#"
table notes:
  owner: principal
  body: text <=5100
  at: time
  by byOwnerAt: owner, at, id
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- deny
  delete <- deny
"#,
        );
        append_source(
            root,
            "snapback/notes.q",
            r#"query log(c: cursor ?):
  return notes[viewer] after c first 50 by byOwnerAt

mutation put(body: text <=5100):
  row = insert notes { owner: viewer, body, at: now }
  return { id: row.id }
"#,
        );
        append_source(
            root,
            "snapback/messages.q",
            r#"
query members(conversationId: conversations, c: cursor ?):
  return memberships[conversationId] after c first 60 by byConversationPrincipal
"#,
        );
        let seed = root.join("snapback/seed.ts");
        let source = fs::read_to_string(&seed).unwrap().replace(
            "    messageCounts: [],",
            "    notes: [],\n    messageCounts: [],",
        );
        fs::write(seed, source).unwrap();
    });
    let (generation, schema_hash) = generation_pair(port);
    let alice = [("X-Snapback-As", "alice")];

    // A backwards page, an unpaged query, and a page over 50 rows are refused
    // as the log before anything executes.
    for (label, op, args, shape) in [
        (
            "last 50",
            "messages.thread",
            thread_args("conversation-1"),
            "descending",
        ),
        ("no page", "profiles.mine", json!({}), "cursor-binding"),
        (
            "first 60",
            "messages.members",
            thread_args("conversation-1"),
            "page-bound",
        ),
    ] {
        let executions_before = status(port, &secret)["executions"].as_u64().unwrap();
        let refused = request(
            port,
            "POST",
            "/api/resume",
            &alice,
            resume_body(
                &generation,
                &schema_hash,
                json!({ "op": op, "args": args, "watermark": null, "validator": "" }),
                json!([{ "op": "messages.summary", "args": { "conversationId": "conversation-1" }, "validator": "" }]),
            ),
        );
        assert_eq!(refused.status, 413, "{label}: {}", refused.body);
        assert_eq!(refused.body["code"], "E_OFFLINE_RESUME", "{label}");
        assert_eq!(refused.body["which"], "log", "{label}");
        assert_eq!(refused.body["reason"], "unsupported-log", "{label}");
        assert_eq!(refused.body["op"], op, "{label}");
        assert_eq!(refused.body["shape"], shape, "{label}");
        assert!(
            refused.body.get("cap").is_none(),
            "{label}: {}",
            refused.body
        );
        assert_eq!(refused.body["site"], "/api/resume.log", "{label}");
        for recovery in [
            "ascending delivery log",
            "after c first N",
            "N <= 50",
            "subscribe normally at c: null for newest-first data",
            "queued writes are kept",
        ] {
            assert!(
                refused.body["rewrite"]
                    .as_str()
                    .is_some_and(|rewrite| rewrite.contains(recovery)),
                "{label}: missing {recovery:?}: {}",
                refused.body
            );
        }
        assert_eq!(
            status(port, &secret)["executions"].as_u64().unwrap(),
            executions_before,
            "{label}: a refused log executes nothing"
        );
    }

    // Fifty-two notes of 5,100 four-byte characters: each row is priced at
    // its certified maximum, so the page certifies under the 1 MiB output
    // ceiling while its envelope (pool, halo, references) crosses the resume
    // budget on its own.
    let body = "\u{1F600}".repeat(5_100);
    for _ in 0..52 {
        let put = request(
            port,
            "POST",
            "/api/mutation",
            &alice,
            json!({ "op": "notes.put", "args": { "body": body } }),
        );
        assert_eq!(put.body["state"], "committed", "{}", put.body);
    }
    let executions_before = status(port, &secret)["executions"].as_u64().unwrap();
    let response = request(
        port,
        "POST",
        "/api/resume",
        &alice,
        resume_body(
            &generation,
            &schema_hash,
            json!({ "op": "notes.log", "args": { "c": null }, "watermark": null, "validator": "" }),
            json!([{ "op": "messages.summary", "args": { "conversationId": "conversation-1" }, "validator": "" }]),
        ),
    );
    assert_eq!(response.status, 200, "{}", response.body["code"]);
    assert_eq!(response.body["log"]["data"].as_array().unwrap().len(), 50);
    assert_eq!(
        response.body["log"]["rows"].as_array().unwrap().len(),
        51,
        "the pool carries the page and its halo"
    );
    assert!(
        response.body_bytes.len() > RESUME_BYTE_CAP,
        "the log alone was only {} bytes",
        response.body_bytes.len()
    );
    assert_eq!(response.body["more"], 1, "{}", response.body["more"]);
    assert_eq!(response.body["mounted"], json!([]));
    assert_eq!(
        status(port, &secret)["executions"].as_u64().unwrap() - executions_before,
        1,
        "a log over the budget executes no mounted query"
    );
    stop_owner(
        port,
        &secret,
        &mut owner,
        "offline resume log budget complete",
    );
    fs::remove_dir_all(root).unwrap();
}

/// Fix round 1, item 3: a grant is minted only when the client's unused ids
/// are low — `remaining` absent or below 1,024 — on signup, resume, login,
/// and guest. Signup has no existing client grant, so it always mints one.
#[test]
fn offline_grants_are_minted_only_when_remaining_ids_are_low() {
    let (root, mut owner, port, secret) = boot(|_| {});
    let (generation, schema_hash) = generation_pair(port);
    let alice = [("X-Snapback-As", "alice")];
    let resume_with = |remaining: Value| {
        let mut body = resume_body(&generation, &schema_hash, Value::Null, json!([]));
        if !remaining.is_null() {
            body["remaining"] = remaining;
        }
        request(port, "POST", "/api/resume", &alice, body)
    };
    let plenty = resume_with(json!(5_000));
    assert_eq!(plenty.status, 200, "{}", plenty.body);
    assert!(plenty.body.get("grant").is_none(), "{}", plenty.body);
    let exact = resume_with(json!(1_024));
    assert!(exact.body.get("grant").is_none(), "{}", exact.body);
    let low = resume_with(json!(1_023));
    assert_eq!(low.body["grant"]["count"], 8_192, "{}", low.body);
    let absent = resume_with(Value::Null);
    assert_eq!(absent.body["grant"]["count"], 8_192, "{}", absent.body);
    let malformed = resume_with(json!("many"));
    assert_eq!(malformed.status, 400, "{}", malformed.body);
    assert_eq!(malformed.body["code"], "E_INPUT");

    let signup = request(
        port,
        "POST",
        "/api/auth/signup",
        &[],
        json!({ "email": "remaining@example.com", "password": "correct horse" }),
    );
    assert_eq!(signup.status, 200, "{}", signup.body);
    assert_eq!(signup.body["grant"]["count"], 8_192, "{}", signup.body);
    assert_eq!(
        signup.body["grant"]["id"], signup.body["grant"]["from"],
        "{}",
        signup.body
    );
    let stocked = request(
        port,
        "POST",
        "/api/auth/login",
        &[],
        json!({ "email": "remaining@example.com", "password": "correct horse", "remaining": 5_000 }),
    );
    assert_eq!(stocked.status, 200, "{}", stocked.body);
    assert!(stocked.body["token"].is_string());
    assert!(stocked.body.get("grant").is_none(), "{}", stocked.body);
    let empty = request(
        port,
        "POST",
        "/api/auth/login",
        &[],
        json!({ "email": "remaining@example.com", "password": "correct horse" }),
    );
    assert_eq!(empty.body["grant"]["count"], 8_192, "{}", empty.body);
    let guest_stocked = request(
        port,
        "POST",
        "/api/auth/guest",
        &[],
        json!({ "remaining": 4_096 }),
    );
    assert_eq!(guest_stocked.status, 200, "{}", guest_stocked.body);
    assert!(
        guest_stocked.body.get("grant").is_none(),
        "{}",
        guest_stocked.body
    );
    let guest_low = request(
        port,
        "POST",
        "/api/auth/guest",
        &[],
        json!({ "remaining": 0 }),
    );
    assert_eq!(
        guest_low.body["grant"]["count"], 8_192,
        "{}",
        guest_low.body
    );
    stop_owner(
        port,
        &secret,
        &mut owner,
        "offline grant watermark complete",
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn resume_capacity_demand_uses_the_current_mutation_certificate_above_the_watermark() {
    let (root, mut owner, port, secret) = boot(|root| {
        let mut source = "\nmutation capacity(conversationId: conversations, messageId: messages):\n".to_owned();
        // Each loop covers the real schema cap (50); thirty independently
        // bounded writes fit the 2,048 ceiling while pricing above 1,024 IDs.
        for index in 0..30 {
            source.push_str(&format!("  for member{index} in memberships[conversationId] first 50 by byConversationPrincipal:\n    insert deliveries {{ recipient: member{index}.principal, conversationId, messageId, kind: 'message', at: now }}\n"));
        }
        source.push_str("  return null\n");
        append_source(root, "snapback/messages.q", &source);
    });
    let (generation, schema_hash) = generation_pair(port);
    let alice = [("X-Snapback-As", "alice")];
    let program = request(port, "GET", &format!("/api/program?generation={generation}"), &alice, json!({}));
    assert_eq!(program.status, 200, "{}", program.body);
    let count = 1 + program.body["programs"]["messages.capacity"]["certificate"]["write_sites"]
        .as_array().unwrap_or_else(|| panic!("missing capacity certificate: {}", program.body)).iter()
        .filter(|site| matches!(site["kind"].as_str(), Some("Insert" | "Upsert")))
        .map(|site| site["max_rows"].as_u64().unwrap()).sum::<u64>();
    assert!(count > 1_025 && count <= 8_192, "fixture must price a real above-watermark deficit: {count}");
    let mut body = resume_body(&generation, &schema_hash, Value::Null, json!([]));
    body["remaining"] = json!(count - 1);
    let healthy = request(port, "POST", "/api/resume", &alice, body.clone());
    assert_eq!(healthy.status, 200, "{}", healthy.body);
    assert!(healthy.body.get("grant").is_none());
    body["demand"] = json!("messages.capacity");
    let deficit = request(port, "POST", "/api/resume", &alice, body.clone());
    assert_eq!(deficit.status, 200, "{}", deficit.body);
    assert_eq!(deficit.body["grant"]["count"], 8_192);
    body["remaining"] = json!(count);
    let exact = request(port, "POST", "/api/resume", &alice, body.clone());
    assert_eq!(exact.status, 200, "{}", exact.body);
    assert!(exact.body.get("grant").is_none());
    body["demand"] = json!("messages.thread");
    let query = request(port, "POST", "/api/resume", &alice, body.clone());
    assert_eq!(query.status, 400, "{}", query.body);
    body["demand"] = json!("messages.unknown");
    assert_eq!(request(port, "POST", "/api/resume", &alice, body.clone()).status, 404);
    body["demand"] = json!("messages.capacity");
    body["generation"] = json!("0".repeat(64));
    let obsolete = request(port, "POST", "/api/resume", &alice, body);
    assert_eq!(obsolete.body["code"], "E_OFFLINE_RESET");
    assert!(obsolete.body.get("grant").is_none());
    stop_owner(port, &secret, &mut owner, "capacity demand complete");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn acquisition_batches_use_existing_http_routes_and_ordinary_replay_terminals() {
    let (root, mut owner, port, secret) = boot(|root| {
        append_source(root, "snapback/bulk.q", "\nmutation echo():\n  return null\n");
    });
    let alice = [("X-Snapback-As", "alice")];
    let args = thread_args("conversation-1");
    let ordinary = request(port, "POST", "/api/query?receipt=1", &alice,
        json!({"op": "messages.log", "args": args}));
    let batch = request(port, "POST", "/api/query?receipt=1", &alice,
        json!({"op": "messages.log", "args": args, "batch": 16}));
    assert_eq!(batch.status, 200, "{}", batch.body);
    assert_eq!(batch.body["more"], false);
    assert_eq!(batch.body["pages"], json!([{"args": args, "envelope": ordinary.body}]));
    let too_many = request(port, "POST", "/api/query?receipt=1", &alice,
        json!({"op": "messages.log", "args": args, "batch": 17}));
    assert_eq!(too_many.status, 400, "{}", too_many.body);
    let (generation, schema) = generation_pair(port);
    let resumed = request(port, "POST", "/api/resume", &alice,
        resume_body(&generation, &schema, Value::Null, json!([])));
    let grant = resumed.body["grant"]["id"].as_str().unwrap();
    let intent = |offset| json!({"op": "bulk.echo", "args": {}, "replay": {
        "grant": grant, "offset": offset, "count": 1, "intent": format!("{grant}:{offset}"),
        "trace": {"points": [], "verdicts": []},
    }});
    let first = request(port, "POST", "/api/mutation", &alice, intent(0));
    assert_eq!(first.body["state"], "committed");
    let seq = status(port, &secret)["seq"].clone();
    // A stored terminal precedes generated-operation admission; the next new
    // product intent is refused without executing or bypassing its position.
    let replayed = request(port, "POST", "/api/mutation", &alice,
        json!({"batch": [intent(0), intent(1)]}));
    assert_eq!(replayed.status, 200, "{}", replayed.body);
    assert_eq!(replayed.body["results"], json!([first.body]));
    assert_eq!(replayed.body["error"]["code"], "E_INPUT");
    assert_eq!(replayed.body["more"], false);
    assert_eq!(status(port, &secret)["seq"], seq);
    let anonymous = request(port, "POST", "/api/mutation", &[], json!({"batch": [intent(0)]}));
    assert_eq!(anonymous.status, 401, "{}", anonymous.body);
    assert_eq!(anonymous.body["code"], "E_AUTH_REQUIRED");
    stop_owner(port, &secret, &mut owner, "bounded acquisition HTTP complete");
    fs::remove_dir_all(root).unwrap();
}
