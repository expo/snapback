//! LLP 1021 §3 and §4 through the real engine and the real `test` verb: a
//! provider stand-in bound per journey epoch, the bound-only transport, the
//! witness count, and the lifecycle journeys (retry after backoff, offline
//! replay, a schedule with no client connected, a changed `then`).
use super::common::{Project, json_stdout};
use super::*;

fn check<'a>(receipt: &'a Value, name: &str) -> &'a Value {
    receipt["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["name"] == name)
        .unwrap_or_else(|| panic!("no check named {name:?} in {receipt}"))
}

fn scaffold_chat() -> Project {
    let project = Project::new();
    let initialized = project.init("chat", "none");
    assert!(
        initialized.status.success(),
        "init failed: {}{}",
        String::from_utf8_lossy(&initialized.stdout),
        String::from_utf8_lossy(&initialized.stderr)
    );
    project
}

fn run_test(project: &Project, args: &[&str]) -> Value {
    let mut argv = vec!["test", "--json"];
    argv.extend_from_slice(args);
    let output = project.run(&argv);
    let receipt = json_stdout(&output);
    assert!(
        !receipt["checks"].as_array().unwrap().is_empty(),
        "{receipt}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    receipt
}

// @ref LLP 1021#4-test-counts-witnesses — acceptance 2: the scaffolded chat reports `effects: pass` with one witness whose `then` committed with a seq.
#[test]
fn chat_template_test_reports_one_witness_per_effect_with_its_then_committed() {
    let project = scaffold_chat();
    let receipt = run_test(&project, &[]);
    assert_eq!(receipt["verdict"], "pass", "{receipt}");
    let effects = check(&receipt, "effects");
    assert_eq!(effects["verdict"], "pass", "{effects}");
    assert_eq!(effects["detail"]["engine"], "ibex2 + vanilla hermes");
    assert_eq!(
        effects["detail"]["declarations"],
        json!(["delivery.notify"])
    );
    let witness = &effects["detail"]["witnesses"]["delivery.notify"];
    assert_eq!(
        witness["journey"], "a sent message notifies the recipient",
        "{effects}"
    );
    assert_eq!(witness["state"], "sent");
    assert_eq!(witness["attempts"], 1);
    assert_eq!(witness["provider"]["requests"], 1);
    assert_eq!(
        witness["provider"]["origins"],
        json!(["https://api.example.com"])
    );
    assert_eq!(witness["then"]["op"], "notifications.recordNotified");
    assert_eq!(witness["then"]["state"], "committed");
    let emitted = witness["seq"].as_u64().unwrap();
    assert!(
        witness["then"]["seq"]
            .as_u64()
            .is_some_and(|seq| seq > emitted),
        "{witness}"
    );
    assert!(witness["ms"].is_number(), "{witness}");
    // The template's other journeys send messages without binding a provider:
    // their rows failed E_EFFECT_UNBOUND, reached nothing, and are negative
    // evidence only.
    let refused = effects["detail"]["refused"]["delivery.notify"]["rows"]
        .as_array()
        .unwrap();
    assert!(!refused.is_empty(), "{effects}");
    assert!(
        refused.iter().all(|row| {
            row["state"] == "failed"
                && row["lastError"]
                    .as_str()
                    .is_some_and(|error| error.contains("E_EFFECT_UNBOUND"))
        }),
        "{refused:?}"
    );
    assert!(
        refused
            .iter()
            .any(|row| row["journey"] == "alice posts to the room and a non-member cannot"),
        "{refused:?}"
    );
    assert_eq!(
        check(&receipt, "a sent message notifies the recipient")["verdict"],
        "pass"
    );
    let names = receipt["checks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|check| check["name"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert!(
        names.iter().position(|name| *name == "effects")
            > names
                .iter()
                .position(|name| *name == "a sent message notifies the recipient"),
        "the effects check reads the outbox after the journeys: {names:?}"
    );
}

const LIFECYCLE_JOURNEYS: &str = r#"
import { subscribe } from "snapback2/internal";
import { journey } from "snapback2/test";
import { api } from "snapback2/client";

journey("held provider dies with its journey", async ({ as, effects }) => {
  const provider = await effects.provider("https://api.example.com", () => new Promise<Response>(() => {}));
  const alice = as("alice");
  const sent = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body: "held by the first journey" });
  if (sent.state !== "committed") throw new Error(`send was ${sent.state}`);
  for (let i = 0; i < 400 && provider.requests.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  if (provider.requests.length !== 1) throw new Error("the provider never received the held request");
  // Block the event loop past the host deadline with the request still held:
  // no in-process timer can end this journey, so the supervisor kills the
  // process, and the provider dies with it — the RFC's "process death".
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 8_000);
});

journey("a later journey binding the same origin receives only its own request", async ({ as, effects, tick }) => {
  const provider = await effects.provider("https://api.example.com", async () => Response.json({ id: "prov-2" }));
  const alice = as("alice");
  try {
    const sent = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body: "second journey" });
    if (sent.state !== "committed") throw new Error(`send was ${sent.state}`);
    await tick(5_000);
    const { settled, rows, remaining } = await effects.settle({ upTo: sent.seq, budgetMs: 4000 });
    if (!settled) throw new Error(`unsettled: ${JSON.stringify(remaining)}`);
    const held = rows.find((row) => row.state === "failed" && String(row.lastError).includes("E_EFFECT_UNBOUND"));
    if (!held) throw new Error(`the earlier journey's row did not fail E_EFFECT_UNBOUND: ${JSON.stringify(rows)}`);
    if (held.attempts !== 2) throw new Error(`the held row was retried on attempt ${held.attempts}`);
    const mine = rows.find((row) => row.seq === sent.seq);
    if (mine?.state !== "sent" || mine.then?.state !== "committed") throw new Error(`mine: ${JSON.stringify(mine)}`);
    if (provider.requests.length !== 1) throw new Error(`the provider saw ${provider.requests.length} requests`);
    if (!provider.requests[0]!.body.includes("second journey")) throw new Error(provider.requests[0]!.body);
  } finally {
    alice.close();
  }
});

journey("a provider 503 is retried on attempt 2 once tick passes nextAt", async ({ as, effects, tick }) => {
  let calls = 0;
  const provider = await effects.provider("https://api.example.com", async () =>
    calls++ === 0 ? new Response("busy", { status: 503 }) : Response.json({ id: "prov-retry" }));
  const alice = as("alice");
  try {
    const sent = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body: "retry me" });
    if (sent.state !== "committed") throw new Error(`send was ${sent.state}`);
    const first = await effects.settle({ upTo: sent.seq, budgetMs: 200 });
    const backoff = first.remaining.find((row) => row.reason === "backoff");
    if (first.settled || !backoff || typeof backoff.nextAt !== "number") throw new Error(`expected a backoff: ${JSON.stringify(first)}`);
    const attempted = first.rows.find((row) => row.seq === sent.seq);
    if (attempted?.attempts !== 1 || !String(attempted.lastError).includes("provider 503")) throw new Error(`attempt 1: ${JSON.stringify(attempted)}`);
    await tick(1_001);
    // Allow the retry and its then to settle on a loaded owner.
    const second = await effects.settle({ upTo: sent.seq, budgetMs: 3000 });
    const row = second.rows.find((r) => r.seq === sent.seq);
    if (!second.settled || row?.state !== "sent" || row.attempts !== 2 || row.then?.state !== "committed") throw new Error(`attempt 2: ${JSON.stringify(second)}`);
    if (provider.requests.length !== 2) throw new Error(`the provider saw ${provider.requests.length} requests`);
  } finally {
    alice.close();
  }
});

journey("an offline-queued send replayed after a lost response emits once", async ({ as, effects }) => {
  const provider = await effects.provider("https://api.example.com", async () => Response.json({ id: "prov-offline" }));
  const alice = as("alice", { store: "file" });
  // The twin predicts an offline send from the drained log, as the template's offline journeys do.
  const drain = subscribe(alice, api.messages.inbox, { c: null }, () => undefined, { drain: true });
  await drain.until((value) => (value.state === "complete" || value.state === "capped") && value.caughtUp === true);
  drain.close();
  await alice.offline();
  const queued = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body: "queued offline once" });
  if (queued.state !== "queued") throw new Error(`offline send was ${queued.state}`);
  alice.failNextResponse("/api/mutation", 503);
  await alice.online();
  await alice.settled();
  if ((await alice.outbox.entries()).some((entry) => entry.state !== "queued")) throw new Error("a 503 after the commit settled the intent");
  await alice.outbox.drain();
  const entries = await alice.outbox.entries();
  if (entries.map((entry) => entry.state).join() !== "committed") throw new Error(`replay settled as ${JSON.stringify(entries)}`);
  const { settled, rows, remaining } = await effects.settle({ budgetMs: 3000 });
  if (!settled) throw new Error(`unsettled: ${JSON.stringify(remaining)}`);
  const emitted = rows.filter((row) => row.effect === "delivery.notify" && JSON.stringify(row.result).includes("prov-offline"));
  if (emitted.length !== 1 || emitted[0]!.state !== "sent" || emitted[0]!.then?.state !== "committed") throw new Error(`emissions: ${JSON.stringify(emitted)}`);
  if (provider.requests.length !== 1 || !provider.requests[0]!.body.includes("queued offline once")) throw new Error(`the provider saw ${JSON.stringify(provider.requests)}`);
});

journey("an unbound granted origin refuses E_EFFECT_UNBOUND and reaches no provider", async ({ as, effects }) => {
  const alice = as("alice");
  try {
    const sent = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body: "nobody is bound" });
    if (sent.state !== "committed") throw new Error(`send was ${sent.state}`);
    const { settled, rows } = await effects.settle({ upTo: sent.seq });
    const row = rows.find((r) => r.seq === sent.seq);
    if (!settled || row?.state !== "failed" || row.attempts !== 1) throw new Error(`unbound row: ${JSON.stringify(row)}`);
    const error = String(row.lastError);
    if (!error.includes("E_EFFECT_UNBOUND") || !error.includes("effects.provider('https://api.example.com', handler) in the journey that emits delivery.notify")) throw new Error(error);
  } finally {
    alice.close();
  }
});

journey("an ungranted redirect refuses E_EFFECT_GRANT on the logical origin", async ({ as, effects }) => {
  const provider = await effects.provider("https://api.example.com", async () =>
    new Response(null, { status: 302, headers: { location: "https://other.example.com/steal" } }));
  const alice = as("alice");
  try {
    const sent = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body: "redirect me" });
    if (sent.state !== "committed") throw new Error(`send was ${sent.state}`);
    const { settled, rows } = await effects.settle({ upTo: sent.seq });
    const row = rows.find((r) => r.seq === sent.seq);
    if (!settled || row?.state !== "failed" || row.attempts !== 1) throw new Error(`redirected row: ${JSON.stringify(row)}`);
    if (!String(row.lastError).includes("denied: net.fetch https://other.example.com; declare https://other.example.com")) throw new Error(String(row.lastError));
    if (provider.requests.length !== 1) throw new Error(`the provider saw ${provider.requests.length} requests`);
  } finally {
    alice.close();
  }
});
"#;

// @ref LLP 1021#3-a-provider-stand-in-and-nothing-else-answers — acceptance 4 and the lifecycle journeys of 3 and 6, on the real test owner.
#[test]
fn lifecycle_journeys_isolate_bindings_retry_after_backoff_replay_offline_and_refuse() {
    let project = scaffold_chat();
    fs::write(
        project.path.join("snapback/tests/chat.test.ts"),
        LIFECYCLE_JOURNEYS,
    )
    .unwrap();
    let receipt = run_test(&project, &[]);
    let held = check(&receipt, "held provider dies with its journey");
    assert_eq!(held["verdict"], "fail", "{held}");
    assert_eq!(
        held["detail"]["error"],
        "journey exceeded the 5000 ms host deadline"
    );
    for name in [
        "a later journey binding the same origin receives only its own request",
        "a provider 503 is retried on attempt 2 once tick passes nextAt",
        "an offline-queued send replayed after a lost response emits once",
        "an unbound granted origin refuses E_EFFECT_UNBOUND and reaches no provider",
        "an ungranted redirect refuses E_EFFECT_GRANT on the logical origin",
    ] {
        let journey = check(&receipt, name);
        assert_eq!(journey["verdict"], "pass", "{name}: {journey}");
    }
    let effects = check(&receipt, "effects");
    assert_eq!(effects["verdict"], "pass", "{effects}");
    let witness = &effects["detail"]["witnesses"]["delivery.notify"];
    assert_eq!(
        witness["journey"], "a later journey binding the same origin receives only its own request",
        "the lowest-seq successful witness: {effects}"
    );
    assert_eq!(witness["attempts"], 1);
    assert_eq!(witness["then"]["state"], "committed");
    let refused = effects["detail"]["refused"]["delivery.notify"]["rows"]
        .as_array()
        .unwrap();
    let refusal = |journey: &str| {
        refused
            .iter()
            .find(|row| row["journey"] == journey)
            .unwrap_or_else(|| panic!("no refusal for {journey}: {refused:?}"))["lastError"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    assert!(refusal("held provider dies with its journey").contains("E_EFFECT_UNBOUND"));
    assert!(
        refusal("an unbound granted origin refuses E_EFFECT_UNBOUND and reaches no provider")
            .contains("E_EFFECT_UNBOUND")
    );
    assert!(
        refusal("an ungranted redirect refuses E_EFFECT_GRANT on the logical origin")
            .contains("denied: net.fetch https://other.example.com")
    );
}

const SCHEDULE_JOURNEY: &str = r#"
import { journey } from "snapback2/test";

journey("a schedule advanced with every client disconnected emits and settles", async ({ effects, tick }) => {
  const provider = await effects.provider("https://push.example.com", async () => Response.json({ ok: true }));
  // No client is created: the digest fires on the background turn alone.
  await tick(24 * 60 * 60 * 1000 + 1);
  const { settled, rows, remaining } = await effects.settle({ budgetMs: 4000 });
  if (!settled) throw new Error(`unsettled: ${JSON.stringify(remaining)}`);
  const digests = rows.filter((row) => row.effect === "push.digest");
  if (digests.length === 0 || digests.some((row) => row.state !== "sent")) throw new Error(`digests: ${JSON.stringify(digests)}`);
  if (provider.requests.length !== digests.length) throw new Error(`${provider.requests.length} requests for ${digests.length} digest rows`);
  if (!provider.requests.every((request) => request.path === "/digest" && request.method === "POST")) throw new Error(JSON.stringify(provider.requests));
});
"#;

// @ref LLP 1021#4-test-counts-witnesses — acceptance 6 (a schedule with no client) and the `blocked: effects:no-witness` receipt naming the effect and the journey it needs.
#[test]
fn a_schedule_with_every_client_disconnected_is_witnessed_and_a_missing_witness_blocks() {
    let project = scaffold_chat();
    let schedules_fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/compiler/fixtures/quarry-schedules/snapback");
    fs::copy(
        schedules_fixture.join("push.ts"),
        project.path.join("snapback/push.ts"),
    )
    .unwrap();
    fs::write(
        project.path.join("snapback/admin.q"),
        "effect digest from push\n\njob digestSweep():\n  chunk p in profiles first 100 by byId:\n    if p.displayName != '':\n      emit digest { to: p.principal, newFollowers: 1, unreadMessages: 0 }\n\nschedule dailyDigest every 24h: digestSweep()\n",
    )
    .unwrap();
    fs::write(
        project.path.join("snapback/tests/chat.test.ts"),
        SCHEDULE_JOURNEY,
    )
    .unwrap();
    let receipt = run_test(&project, &[]);
    let journey = check(
        &receipt,
        "a schedule advanced with every client disconnected emits and settles",
    );
    assert_eq!(journey["verdict"], "pass", "{journey}");
    let effects = check(&receipt, "effects");
    assert_eq!(effects["verdict"], "blocked", "{effects}");
    assert_eq!(effects["detail"]["reason"], "effects:no-witness");
    // `push.ts` declares two effects; only `digest` is emitted by the sweep.
    assert_eq!(
        effects["detail"]["declarations"],
        json!(["delivery.notify", "push.digest", "push.notify"])
    );
    let digest = &effects["detail"]["witnesses"]["push.digest"];
    assert_eq!(digest["state"], "sent", "{effects}");
    assert_eq!(digest["then"], json!({ "declared": false }));
    assert_eq!(
        digest["journey"],
        "a schedule advanced with every client disconnected emits and settles"
    );
    let missing = effects["detail"]["missing"].as_array().unwrap();
    assert_eq!(
        missing
            .iter()
            .map(|entry| entry["effect"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["delivery.notify", "push.notify"],
        "{effects}"
    );
    let needs = missing[0]["needs"].as_str().unwrap();
    assert!(
        needs.contains("effects.provider(\"https://api.example.com\", handler)"),
        "{needs}"
    );
    assert!(needs.contains("emits delivery.notify"), "{needs}");
    assert!(
        needs.contains("lets notifications.recordNotified commit"),
        "{needs}"
    );
    // A selected run states its scope and claims no execution coverage.
    let selected = run_test(
        &project,
        &[
            "--journey",
            "a schedule advanced with every client disconnected emits and settles",
        ],
    );
    assert_eq!(selected["verdict"], "pass", "{selected}");
    assert_eq!(
        selected["scope"]["journey"],
        "a schedule advanced with every client disconnected emits and settles"
    );
    assert!(
        !selected["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|check| check["name"] == "effects"),
        "{selected}"
    );
}

// @ref LLP 1003#2-the-outbox-lifecycle — acceptance 3: a `then` whose generation changed while the provider held the request is `E_EFFECT_THEN_CHANGED`, on a dev owner with the provider at the granted origin.
#[test]
fn a_then_changed_while_the_provider_held_the_request_fails_e_effect_then_changed() {
    let provider = Provider::start();
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    prepare_effect_fixture(&root, &provider.origin());
    let notifications = root.join("snapback/notifications.q");
    let mut source = fs::read_to_string(&notifications).unwrap();
    source.push_str(
        "\nmutation recordNotifiedAgain(outboxId: id, effect: text <=100, result: json <=1000):\n  return null\n",
    );
    fs::write(&notifications, source).unwrap();
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    let mut owner = ChildGuard::spawn(binary, &compiler, &root);
    let (port, secret) = owner.ready(&root);
    let sent = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "alice")],
        json!({"op":"messages.send", "args":{"conversationId":"conversation-1", "recipientId":"profile-bob", "body":"then will change"}}),
    );
    assert_eq!(sent.body["state"], "committed", "{}", sent.body);
    let seq = sent.body["seq"].as_u64().unwrap();
    wait_for(Duration::from_secs(8), || {
        (provider.hits() == 1).then_some(())
    });
    // The provider holds the request; the effect's `then` changes underneath it.
    let delivery = root.join("snapback/delivery.ts");
    let rewritten = fs::read_to_string(&delivery)
        .unwrap()
        .replace(
            "import { recordNotified } from \"./notifications\";",
            "import { recordNotifiedAgain } from \"./notifications\";",
        )
        .replace("then: recordNotified,", "then: recordNotifiedAgain,");
    assert!(
        rewritten.contains("then: recordNotifiedAgain,")
            && rewritten.contains("import { recordNotifiedAgain }"),
        "the fixture's delivery.ts changed shape: {rewritten}"
    );
    fs::write(&delivery, rewritten).unwrap();
    // The watcher applies the successor; `status.generation` is the schema and
    // program identity and does not move for a `then` change (the effects hash
    // the runner binds does), so the applied line in the owner's log is the signal.
    let log = root.join(".snapback/log.jsonl");
    wait_for(Duration::from_secs(20), || {
        fs::read_to_string(&log)
            .ok()
            .filter(|log| log.contains("\"successor\":\"applied\""))
            .map(|_| ())
    });
    provider.release_first();
    let row = wait_for(Duration::from_secs(10), || {
        let row = trace(port, &secret, seq)["outbox"]["rows"][0].clone();
        (row["state"] == "failed").then_some(row)
    });
    assert_eq!(row["lastError"], "E_EFFECT_THEN_CHANGED", "{row}");
    assert_eq!(row["attempts"], 1);
    let history = trace(port, &secret, seq)["outbox"]["history"]
        .as_array()
        .unwrap()
        .iter()
        .map(|line| line["outbox"]["to"].as_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    assert_eq!(
        history,
        vec!["queued", "running", "then_pending", "failed"],
        "{history:?}"
    );
    assert_eq!(
        status(port, &secret)["effects"]["thenPending"],
        0,
        "no then is pending after the refusal"
    );
    let stopped = request(
        port,
        "POST",
        "/control/stop",
        &[("X-Snapback-Control", &secret)],
        json!({ "cause": "then changed test complete" }),
    );
    assert_eq!(stopped.status, 200, "{}", stopped.body);
    owner.wait();
    fs::remove_dir_all(root).unwrap();
}

fn successful_return_without_contact(catch_unbound: bool, no_grants: bool) {
    let project = scaffold_chat();
    let grants = if no_grants {
        ""
    } else {
        "\"https://api.example.com\""
    };
    let body = if catch_unbound {
        "try { await fetch(\"https://api.example.com/send\"); } catch (_) {}"
    } else {
        ""
    };
    fs::write(
        project.path.join("snapback/delivery.ts"),
        format!(
            r#"
import {{ effect }} from "snapback2";
import {{ recordNotified }} from "./notifications";
export const notify = effect({{
  grants: [{grants}],
  run: async (payload: {{ to: string; body: string }}, {{ fetch, meta }}) => {{
    {body}
    return {{ providerId: meta.id }};
  }},
  then: recordNotified,
}});
"#
        ),
    )
    .unwrap();
    fs::write(project.path.join("snapback/tests/chat.test.ts"), r#"
import { journey } from "snapback2/test";
import { api } from "snapback2/client";
journey("return without provider contact", async ({ as, effects }) => {
  const sent = await as("alice").mutation(api.messages.send, { conversationId: "conversation-1", body: "no contact" });
  if (sent.state !== "committed") throw new Error(JSON.stringify(sent));
  const result = await effects.settle({ upTo: sent.seq, budgetMs: 3000 });
  const row = result.rows.find(r => r.seq === sent.seq);
  if (!result.settled || row?.state !== "sent" || row.then?.state !== "committed") throw new Error(JSON.stringify(result));
});
"#).unwrap();
    let receipt = run_test(&project, &[]);
    assert_eq!(
        check(&receipt, "return without provider contact")["verdict"],
        "pass",
        "{receipt}"
    );
    let effects = check(&receipt, "effects");
    if no_grants {
        assert_eq!(effects["verdict"], "pass", "{effects}");
        assert_eq!(
            effects["detail"]["witnesses"]["delivery.notify"]["provider"],
            json!({"declared":false})
        );
        return;
    }
    assert_eq!(effects["verdict"], "blocked", "{effects}");
    assert_eq!(
        effects["detail"]["reason"], "effects:no-witness",
        "{effects}"
    );
    assert_eq!(
        effects["detail"]["refused"]["delivery.notify"]["rows"][0]["provider"]["requests"], 0,
        "{effects}"
    );
    if catch_unbound {
        assert_eq!(
            effects["detail"]["refused"]["delivery.notify"]["rows"][0]["provider"]["refused"]["E_EFFECT_UNBOUND"],
            1,
            "{effects}"
        );
    }
}

#[test]
fn granted_effect_returning_without_fetching_is_not_a_witness() {
    successful_return_without_contact(false, false);
}

#[test]
fn caught_unbound_refusal_returning_success_is_not_a_witness() {
    successful_return_without_contact(true, false);
}

#[test]
fn supervisor_close_keeps_a_completed_journeys_provider_alive_until_settlement() {
    let project = scaffold_chat();
    fs::write(project.path.join("snapback/tests/chat.test.ts"), r#"
import { journey } from "snapback2/test";
import { api } from "snapback2/client";
journey("finish with a request held", async ({ as, effects }) => {
  const provider = await effects.provider("https://api.example.com", async () => {
    await new Promise(resolve => setTimeout(resolve, 400));
    return Response.json({ id: "old-binding" });
  });
  const sent = await as("alice").mutation(api.messages.send, { conversationId: "conversation-1", body: "held" });
  if (sent.state !== "committed") throw new Error(JSON.stringify(sent));
  while (!provider.requests.length) await new Promise(resolve => setTimeout(resolve, 5));
});
journey("the next epoch observes the old settlement without provider contamination", async ({ effects }) => {
  const provider = await effects.provider("https://api.example.com", () => Response.json({ id: "new-binding" }));
  const page = await effects.rows();
  const old = page.rows.find(row => JSON.stringify(row.result).includes("old-binding"));
  if (old?.state !== "sent" || old.then?.state !== "committed") throw new Error("old request did not settle before next journey: " + JSON.stringify(page));
  if (provider.requests.length) throw new Error("old attempt reached new provider");
});
"#).unwrap();
    let receipt = run_test(&project, &[]);
    assert_eq!(receipt["verdict"], "pass", "{receipt}");
    assert_eq!(
        check(&receipt, "effects")["detail"]["witnesses"]["delivery.notify"]["provider"]["requests"],
        1
    );
}

#[test]
fn owner_journeys_admit_relative_and_host_derived_redirects_on_the_logical_origin() {
    let project = scaffold_chat();
    let path = project.path.join("snapback/delivery.ts");
    fs::write(
        &path,
        fs::read_to_string(&path)
            .unwrap()
            .replace("https://api.example.com", "http://127.0.0.1:9"),
    )
    .unwrap();
    fs::write(project.path.join("snapback/tests/chat.test.ts"), r#"
import { journey } from "snapback2/test";
import { api } from "snapback2/client";
for (const kind of ["relative", "host"]) journey(kind + " logical redirect", async ({ as, effects }) => {
  const provider = await effects.provider("http://127.0.0.1:9", request => {
    if (new URL(request.url).pathname === "/send") return new Response(null, { status: 302, headers: {
      location: kind === "relative" ? "/next" : "http://" + request.headers.get("host") + "/next"
    }});
    if (request.headers.get("host") !== "127.0.0.1:9") throw new Error("wrong Host");
    return Response.json({ id: kind });
  });
  const sent = await as("alice").mutation(api.messages.send, { conversationId: "conversation-1", body: kind });
  if (sent.state !== "committed") throw new Error(JSON.stringify(sent));
  const result = await effects.settle({ upTo: sent.seq, budgetMs: 3000 });
  const row = result.rows.find(row => row.seq === sent.seq);
  if (!result.settled || row?.state !== "sent" || row.then?.state !== "committed") throw new Error(JSON.stringify(result));
  if (provider.requests.length !== 2 || provider.requests[1]?.path !== "/next") throw new Error(JSON.stringify(provider.requests));
});
"#).unwrap();
    let receipt = run_test(&project, &[]);
    assert_eq!(receipt["verdict"], "pass", "{receipt}");
    assert_eq!(
        check(&receipt, "effects")["detail"]["witnesses"]["delivery.notify"]["provider"]["requests"],
        2
    );
}

#[test]
fn effects_emitted_in_one_commit_keep_their_own_provider_timing() {
    let project = scaffold_chat();
    let delivery = project.path.join("snapback/delivery.ts");
    let original = fs::read_to_string(&delivery).unwrap();
    let fast = original[original.find("export const notify").unwrap()..]
        .replace("const notify", "const fast")
        .replace("/send", "/fast");
    fs::write(delivery, format!("{original}\n{fast}")).unwrap();
    fs::write(project.path.join("snapback/pair.q"), "effect notify from delivery\neffect fast from delivery\nmutation send():\n  emit notify { to: 'bob', body: 'slow' }\n  emit fast { to: 'bob', body: 'fast' }\n  return null\n").unwrap();
    fs::write(project.path.join("snapback/tests/chat.test.ts"), r#"
import { journey } from "snapback2/test";
import { api } from "snapback2/client";
journey("two effects in one commit", async ({ as, effects }) => {
  await effects.provider("https://api.example.com", async request => {
    if (new URL(request.url).pathname === "/send") await new Promise(resolve => setTimeout(resolve, 200));
    return Response.json({ id: request.headers.get("idempotency-key") });
  });
  const sent = await as("alice").mutation(api.pair.send, {});
  if (sent.state !== "committed") throw new Error(JSON.stringify(sent));
  const result = await effects.settle({ upTo: sent.seq, budgetMs: 3000 });
  if (!result.settled) throw new Error(JSON.stringify(result));
});
"#).unwrap();
    let receipt = run_test(&project, &[]);
    assert_eq!(receipt["verdict"], "pass", "{receipt}");
    let witnesses = &check(&receipt, "effects")["detail"]["witnesses"];
    let slow = &witnesses["delivery.notify"];
    let fast = &witnesses["delivery.fast"];
    assert_eq!(slow["seq"], fast["seq"]);
    assert_ne!(slow["id"], fast["id"]);
    assert!(
        slow["ms"].as_u64().unwrap() >= fast["ms"].as_u64().unwrap() + 100,
        "{witnesses}"
    );
    assert_eq!(slow["provider"]["requests"], 1);
    assert_eq!(fast["provider"]["requests"], 1);
}

#[test]
fn grantless_effect_witness_explicitly_declares_no_provider() {
    successful_return_without_contact(false, true);
}

#[test]
fn a_bound_provider_with_a_rejecting_then_is_negative_witness_evidence() {
    let project = scaffold_chat();
    fs::write(project.path.join("snapback/tests/chat.test.ts"), r#"
import { journey } from "snapback2/test";
import { api } from "snapback2/client";
journey("provider succeeds but then rejects", async ({ as, effects }) => {
  const provider = await effects.provider("https://api.example.com", () => Response.json({ id: "x".repeat(201) }));
  const sent = await as("alice").mutation(api.messages.send, { conversationId: "conversation-1", body: "reject bookkeeping" });
  if (sent.state !== "committed") throw new Error(JSON.stringify(sent));
  const result = await effects.settle({ upTo: sent.seq, budgetMs: 3000 });
  const row = result.rows.find(row => row.seq === sent.seq);
  if (!result.settled || row?.state !== "sent" || row.then?.state !== "rejected" || provider.requests.length !== 1) throw new Error(JSON.stringify(result));
});
"#).unwrap();
    let receipt = run_test(&project, &[]);
    assert_eq!(
        check(&receipt, "provider succeeds but then rejects")["verdict"],
        "pass",
        "{receipt}"
    );
    let effects = check(&receipt, "effects");
    assert_eq!(
        effects["detail"]["reason"], "effects:no-witness",
        "{effects}"
    );
    let refused = &effects["detail"]["refused"]["delivery.notify"]["rows"][0];
    assert_eq!(refused["provider"]["requests"], 1);
    assert_eq!(refused["then"]["state"], "rejected");
}
