//! Post-commit live fan-out coalescing (LLP 0008 §Dated decision —
//! post-commit fan-out coalescing (2026-08-08); LLP 0191 §1 rung 1).
//!
//! Serving-process commits enqueue outside-turn fan-out, and backlogged data
//! merges into one pending frame per subscription at the latest version. These
//! tests prove the three obligations of that decision: (a) a burst of M
//! mutations costs each observer far fewer than M re-evaluations, (b) the
//! delivered state converges exactly to a fresh query, and (c) a continuous
//! write stream still yields periodic deliveries (the starvation bounds), plus
//! the refresh-signal supersession rule and the backstop flusher's guarantee.

use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use snapback::ephemeral::RealtimeEnvelope;
use snapback::live_coalesce::{LiveCoalesceTunables, LiveFanoutCoalescer};
use snapback::local::{LiveSubscribeInput, LocalSnapback};
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FilterExpr, FilterOp, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionResultContract, FunctionRuntime, HandlerInput, HandlerPlan,
    MutationPlan, MutationStep, QueryPlan, ResultObjectFieldContract, ResultValueContract,
    ReturnValue, SchemaManifest, SeedData, TableManifest, ValueExpr,
};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

/// Deterministic scheduler tunables. The long hold/turn bounds keep tests in
/// explicit control of synchronous drains.
fn deterministic_tunables() -> LiveCoalesceTunables {
    LiveCoalesceTunables {
        min_eval_cost: Duration::ZERO,
        min_window: Duration::from_secs(600),
        max_frames: 4096,
        max_changes: 25_000,
        max_hold: Duration::from_secs(600),
        max_eval_turn: Duration::from_secs(30),
    }
}

fn install_deterministic_coalescer(snapback: &mut LocalSnapback) -> Arc<LiveFanoutCoalescer> {
    let coalescer = Arc::new(LiveFanoutCoalescer::with_tunables(deterministic_tunables()));
    snapback.install_live_fanout_coalescer(coalescer.clone());
    coalescer
}

/// (a) + (b): a burst of M backlogged mutations produces one coalesced frame
/// per observer — not M — and applying it converges to the fresh query result.
#[test]
fn backlogged_burst_coalesces_to_one_frame_and_converges() {
    let mut snapback = configured();
    install_deterministic_coalescer(&mut snapback);
    snapback
        .subscribe_live("listMine", sub_input("conn", "ada"))
        .expect("subscribe");

    let mut client: BTreeMap<String, Value> = BTreeMap::new();
    create(&mut snapback, "prime", "ada");

    // Every installed-scheduler commit is outside-turn and collapses while no
    // scheduler turn is driven.
    for index in 0..10 {
        create(&mut snapback, &format!("burst-{index}"), "ada");
    }
    assert!(
        drain(&mut snapback, "conn").is_empty(),
        "backlogged commits defer their data fan-out"
    );
    assert_eq!(snapback.live_coalesce_stats().deferred_commits, 11);

    // The synchronous scheduler drain delivers the whole burst as ONE frame.
    assert!(
        snapback.flush_pending_live_fanout(),
        "pending frame flushed"
    );
    let flushed = drain(&mut snapback, "conn");
    assert_eq!(
        flushed.len(),
        1,
        "eleven queued commits deliver exactly one coalesced frame"
    );
    apply_deltas(&mut client, flushed);

    let fresh = snapback
        .invoke_query("listMine", input(json!({ "userId": "ada" }), "ada"))
        .expect("fresh");
    assert_eq!(client_rows(&client), query_rows(&fresh.rows));
    assert_eq!(fresh.rows.len(), 11);

    let stats = snapback.live_coalesce_stats();
    assert_eq!(stats.coalesced_flushes, 1);
    assert_eq!(stats.backstop_flushes, 0);
    assert_eq!(stats.last_flush_merged_frames, 11);
    assert!(
        !snapback.flush_pending_live_fanout(),
        "nothing pending after the flush"
    );
}

/// The turn-start cut drains the complete pending prefix and stamps the delta
/// with that same store head. The implementation carries a hard assertion for
/// coverage == stamp; this wire assertion makes the accepted burst observable
/// at the integration boundary too.
#[test]
fn atomic_cut_never_stamps_ahead_of_coverage() {
    let mut snapback = configured();
    install_deterministic_coalescer(&mut snapback);
    snapback
        .subscribe_live("listMine", sub_input("conn-cut", "ada"))
        .expect("subscribe");

    for index in 0..8 {
        create(&mut snapback, &format!("cut-{index}"), "ada");
    }
    let current = snapback
        .invoke_query("listMine", input(json!({ "userId": "ada" }), "ada"))
        .expect("fresh head before scheduler cut");
    assert!(snapback.flush_pending_live_fanout());
    let delivered = drain(&mut snapback, "conn-cut");
    assert_eq!(delivered.len(), 1, "one turn covers the complete burst");
    let RealtimeEnvelope::Durable(message) = &delivered[0] else {
        panic!("live delivery must be durable");
    };
    let frame: Value = serde_json::from_slice(&message.payload).expect("live frame JSON");
    assert_eq!(frame["kind"], "live_delta");
    assert_eq!(
        frame["version"], current.version,
        "the emitted stamp is exactly the store head covered by the atomic cut"
    );
}

/// Matcher-disjoint and evaluated-no-change turns both publish the rowless
/// subscription watermark that makes convergence observable after settlement.
#[test]
fn skip_and_no_change_advance_subscription_watermark() {
    let mut snapback = configured();
    install_deterministic_coalescer(&mut snapback);
    snapback
        .subscribe_live("listMine", sub_input("conn-watermark", "ada"))
        .expect("subscribe");

    let skipped_version = snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "theirs", "userId": "bob" }), "bob"),
        )
        .expect("matcher-disjoint commit")
        .version;
    assert!(snapback.flush_pending_live_fanout());
    let skipped = drain_json(&mut snapback, "conn-watermark");
    assert_eq!(skipped.len(), 1);
    assert_eq!(skipped[0]["kind"], "current_as_of");
    assert_eq!(skipped[0]["version"], skipped_version);
    assert!(skipped[0].get("resume").is_none());

    let no_change_version = snapback
        .invoke_mutation(
            "createThenDelete",
            input(json!({ "title": "transient", "userId": "ada" }), "ada"),
        )
        .expect("net-no-change commit")
        .version;
    assert!(snapback.flush_pending_live_fanout());
    let no_change = drain_json(&mut snapback, "conn-watermark");
    assert_eq!(no_change.len(), 1);
    assert_eq!(no_change[0]["kind"], "current_as_of");
    assert_eq!(no_change[0]["version"], no_change_version);
}

/// A watermark is appended behind older content for its subscription. The
/// client can therefore never observe watermark V while content < V is still
/// pending behind it.
#[test]
fn watermark_never_overtakes_undelivered_content() {
    let mut snapback = configured();
    install_deterministic_coalescer(&mut snapback);
    snapback
        .subscribe_live("listMine", sub_input("conn-order", "ada"))
        .expect("subscribe");

    let content_version = snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "mine", "userId": "ada" }), "ada"),
        )
        .expect("content commit")
        .version;
    assert!(snapback.flush_pending_live_fanout());
    let watermark_version = snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "theirs", "userId": "bob" }), "bob"),
        )
        .expect("skip commit")
        .version;
    assert!(snapback.flush_pending_live_fanout());

    let delivered = drain_json(&mut snapback, "conn-order");
    assert_eq!(delivered.len(), 2);
    assert_eq!(delivered[0]["kind"], "live_delta");
    assert_eq!(delivered[0]["version"], content_version);
    assert_eq!(delivered[1]["kind"], "current_as_of");
    assert_eq!(delivered[1]["version"], watermark_version);
    assert!(watermark_version > content_version);
}

/// Repeated skip turns collapse to one pending latest-value envelope, and a
/// newer content frame removes a pending watermark because it carries the
/// same version fact intrinsically.
#[test]
fn pending_watermarks_coalesce_and_newer_content_supersedes_them() {
    let mut snapback = configured();
    install_deterministic_coalescer(&mut snapback);
    snapback
        .subscribe_live("listMine", sub_input("conn-coalesce", "ada"))
        .expect("subscribe");

    let mut newest = 0;
    for index in 0..6 {
        newest = snapback
            .invoke_mutation(
                "createTodo",
                input(
                    json!({ "title": format!("theirs-{index}"), "userId": "bob" }),
                    "bob",
                ),
            )
            .expect("skip commit")
            .version;
        assert!(snapback.flush_pending_live_fanout());
    }
    let coalesced = drain_json(&mut snapback, "conn-coalesce");
    assert_eq!(
        coalesced.len(),
        1,
        "six pending skips collapse to one envelope"
    );
    assert_eq!(coalesced[0]["kind"], "current_as_of");
    assert_eq!(coalesced[0]["version"], newest);

    let watermark_version = snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "still-theirs", "userId": "bob" }), "bob"),
        )
        .expect("pending watermark")
        .version;
    assert!(snapback.flush_pending_live_fanout());
    let content_version = snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "mine", "userId": "ada" }), "ada"),
        )
        .expect("newer content")
        .version;
    assert!(content_version > watermark_version);
    assert!(snapback.flush_pending_live_fanout());
    let superseding = drain_json(&mut snapback, "conn-coalesce");
    assert_eq!(
        superseding.len(),
        1,
        "content supersedes the pending watermark"
    );
    assert_eq!(superseding[0]["kind"], "live_delta");
    assert_eq!(superseding[0]["version"], content_version);
}

/// (b) across mixed operations: create/update/leave/delete/create-then-delete
/// merged into one frame still classifies to the exact final state (the delta
/// classifier collapses to the last change per row id).
#[test]
fn coalesced_flush_converges_across_mixed_operations() {
    let mut snapback = configured();
    install_deterministic_coalescer(&mut snapback);
    snapback
        .subscribe_live("listMine", sub_input("conn", "ada"))
        .expect("subscribe");

    let mut client: BTreeMap<String, Value> = BTreeMap::new();
    let doomed = create(&mut snapback, "doomed", "ada");
    assert!(snapback.flush_pending_live_fanout());
    apply_deltas(&mut client, drain(&mut snapback, "conn"));
    assert_eq!(client.len(), 1);

    // Deferred burst: a is created then retitled (add with final title);
    // b is created then reassigned away (net nothing for ada); the primed row
    // is deleted (remove); ghost is created and deleted inside one commit.
    let a = create(&mut snapback, "a", "ada");
    set_title(&mut snapback, &a, "a-final");
    let b = create(&mut snapback, "b", "ada");
    set_user(&mut snapback, &b, "bob");
    delete_todo(&mut snapback, &doomed);
    snapback
        .invoke_mutation(
            "createThenDelete",
            input(json!({ "title": "ghost", "userId": "ada" }), "ada"),
        )
        .expect("create-then-delete");
    assert!(drain(&mut snapback, "conn").is_empty());
    assert_eq!(snapback.live_coalesce_stats().deferred_commits, 7);

    assert!(snapback.flush_pending_live_fanout());
    let flushed = drain(&mut snapback, "conn");
    assert_eq!(flushed.len(), 1, "one coalesced frame for six commits");
    apply_deltas(&mut client, flushed);

    let fresh = snapback
        .invoke_query("listMine", input(json!({ "userId": "ada" }), "ada"))
        .expect("fresh");
    assert_eq!(client_rows(&client), query_rows(&fresh.rows));
    assert_eq!(fresh.rows.len(), 1, "only `a` survives for ada");
    assert_eq!(fresh.rows[0]["title"], "a-final");
}

/// (c) memory bound: without a running scheduler, a pending frame that reaches
/// its cap degrades to one refresh obligation. It never re-enters the commit
/// turn to flush inline.
#[test]
fn pending_bound_degrades_to_scheduler_refresh() {
    let mut snapback = configured();
    let coalescer = Arc::new(LiveFanoutCoalescer::with_tunables(LiveCoalesceTunables {
        max_frames: 3,
        ..deterministic_tunables()
    }));
    snapback.install_live_fanout_coalescer(coalescer);
    snapback
        .subscribe_live("listMine", sub_input("conn", "ada"))
        .expect("subscribe");

    let mut client: BTreeMap<String, Value> = BTreeMap::new();
    create(&mut snapback, "prime", "ada");
    assert!(snapback.flush_pending_live_fanout());
    apply_deltas(&mut client, drain(&mut snapback, "conn"));

    // The fourth commit crosses the cap. Settlement still performs no fan-out;
    // the pending data becomes one scheduler-priority refresh.
    for index in 0..4 {
        create(&mut snapback, &format!("stream-{index}"), "ada");
    }
    assert!(drain(&mut snapback, "conn").is_empty());
    assert!(snapback.flush_pending_live_fanout());
    let delivered = drain(&mut snapback, "conn");
    assert_eq!(delivered.len(), 1, "one refresh delivers the latest state");
    apply_deltas(&mut client, delivered);

    let stats = snapback.live_coalesce_stats();
    // The fourth stream commit arrives after this subscription has already
    // collapsed to a refresh obligation, so it creates no additional queued
    // work and is intentionally absent from the accepted-work diagnostic.
    assert_eq!(stats.deferred_commits, 4);
    // Neither direct turn represented >1 accepted frame: the prime was one
    // frame, and the bound-triggered refresh collapse is deliberately one.
    assert_eq!(stats.coalesced_flushes, 0);
    assert_eq!(stats.backstop_flushes, 0);
    assert_eq!(stats.last_flush_merged_frames, 1);

    let fresh = snapback
        .invoke_query("listMine", input(json!({ "userId": "ada" }), "ada"))
        .expect("fresh");
    assert_eq!(client_rows(&client), query_rows(&fresh.rows));
    assert_eq!(fresh.rows.len(), 5);
}

/// A refresh signal (empty change list — here `seed()`) re-queries and
/// replaces every subscription from current state, superseding and discarding
/// the pending deferred frame.
#[test]
fn refresh_signal_supersedes_pending_frame() {
    let mut snapback = configured();
    install_deterministic_coalescer(&mut snapback);
    snapback
        .subscribe_live("listMine", sub_input("conn", "ada"))
        .expect("subscribe");

    let mut client: BTreeMap<String, Value> = BTreeMap::new();
    create(&mut snapback, "prime", "ada");
    assert!(snapback.flush_pending_live_fanout());
    apply_deltas(&mut client, drain(&mut snapback, "conn"));
    for index in 0..3 {
        create(&mut snapback, &format!("deferred-{index}"), "ada");
    }
    assert!(drain(&mut snapback, "conn").is_empty());

    let mut seeded = Map::new();
    seeded.insert("title".to_owned(), json!("seeded"));
    seeded.insert("userId".to_owned(), json!("ada"));
    snapback
        .seed(SeedData {
            tables: BTreeMap::from([("todos".to_owned(), vec![seeded])]),
        })
        .expect("seed");

    assert!(snapback.flush_pending_live_fanout());
    let refreshed = drain(&mut snapback, "conn");
    assert_eq!(
        refreshed.len(),
        1,
        "the refresh delivers one whole-state frame"
    );
    apply_deltas(&mut client, refreshed);
    assert!(
        !snapback.flush_pending_live_fanout(),
        "the refresh superseded (discarded) the pending deferred frame"
    );
    let fresh = snapback
        .invoke_query("listMine", input(json!({ "userId": "ada" }), "ada"))
        .expect("fresh");
    assert_eq!(client_rows(&client), query_rows(&fresh.rows));
    assert_eq!(fresh.rows.len(), 5, "prime + three deferred + seeded");
}

/// Without an installed coalescer nothing changes: every commit fans out
/// inline, one frame per commit (the pre-decision behavior every non-serving
/// embedding keeps).
#[test]
fn no_coalescing_without_installed_coalescer() {
    let mut snapback = configured();
    snapback
        .subscribe_live("listMine", sub_input("conn", "ada"))
        .expect("subscribe");
    for index in 0..3 {
        create(&mut snapback, &format!("inline-{index}"), "ada");
    }
    assert_eq!(
        drain(&mut snapback, "conn").len(),
        3,
        "one frame per commit without a coalescer"
    );
    assert_eq!(snapback.live_coalesce_stats().deferred_commits, 0);

    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "legacy-skip", "userId": "bob" }), "bob"),
        )
        .expect("legacy matcher-disjoint commit");
    snapback
        .invoke_mutation(
            "createThenDelete",
            input(
                json!({ "title": "legacy-no-change", "userId": "ada" }),
                "ada",
            ),
        )
        .expect("legacy no-change commit");
    assert!(
        drain(&mut snapback, "conn").is_empty(),
        "legacy skip and no-change dispositions remain byte-for-byte silent"
    );
}

/// The backstop flusher task end to end: deferred commits are delivered
/// without any further commit arriving, within the backstop delay plus one
/// lock queue (the LLP 0008 delivery guarantee).
// Current-thread runtime: the test drives the state directly under the lock
// (sanctioned there — blocking stalls only this test's own runtime), while the
// backstop task's `with_snapback` offload interleaves at each await point.
#[tokio::test]
async fn backstop_task_flushes_deferred_frames() {
    let mut snapback = configured();
    snapback
        .subscribe_live("listMine", sub_input("conn", "ada"))
        .expect("subscribe");
    let state: snapback::server::SharedSnapback = Arc::new(tokio::sync::Mutex::new(snapback));
    let coalescer = Arc::new(LiveFanoutCoalescer::with_tunables(deterministic_tunables()));
    // Install synchronously so the burst below cannot race the scheduler
    // task's own (idempotent, same-Arc) installation.
    state
        .lock()
        .await
        .install_live_fanout_coalescer(coalescer.clone());
    let backstop = snapback::server::spawn_live_fanout_backstop(state.clone(), coalescer);

    let mut client: BTreeMap<String, Value> = BTreeMap::new();
    {
        let mut guard = state.lock().await;
        create(&mut guard, "prime", "ada");
        for index in 0..5 {
            create(&mut guard, &format!("burst-{index}"), "ada");
        }
        assert_eq!(guard.live_coalesce_stats().deferred_commits, 6);
        assert!(drain(&mut guard, "conn").is_empty());
    }

    // No manual flush: the backstop task must deliver.
    let mut delivered = Vec::new();
    for _ in 0..200 {
        tokio::time::sleep(Duration::from_millis(10)).await;
        let mut guard = state.lock().await;
        delivered.extend(drain(&mut guard, "conn"));
        if !delivered.is_empty() {
            break;
        }
    }
    backstop.abort();
    assert!(
        !delivered.is_empty(),
        "the backstop flushed the deferred frames without another commit"
    );
    apply_deltas(&mut client, delivered);
    let guard = state.lock().await;
    assert!(guard.live_coalesce_stats().coalesced_flushes >= 1);
    assert!(guard.live_coalesce_stats().backstop_flushes >= 1);
    let fresh = guard
        .invoke_query("listMine", input(json!({ "userId": "ada" }), "ada"))
        .expect("fresh");
    assert_eq!(client_rows(&client), query_rows(&fresh.rows));
    assert_eq!(fresh.rows.len(), 6, "prime + five burst rows");
}

/// Synthetic scale evidence for the ticket (run manually:
/// `cargo test --test live_coalesce_v0 -- --ignored --nocapture`): a 30k-row
/// store, six ordered 1,000-row windowed observers (the replace/re-query
/// lane — the zb5-hot shape at reduced scale), and a 16-mutation burst.
/// Reports total wall time and per-observer evaluation counts with
/// coalescing off vs on. Ignored by default: timing assertions are
/// machine-dependent; the non-ignored tests above carry the correctness
/// gates.
#[test]
#[ignore = "synthetic micro-benchmark; run manually with --ignored --nocapture"]
fn bench_synthetic_burst_coalescing() {
    const ROWS: usize = 30_000;
    const OBSERVERS: usize = 6;
    const BURST: usize = 16;

    let run = |coalesce: bool| -> (Duration, u64, u64) {
        let mut snapback = configured();
        let mut tables = BTreeMap::new();
        tables.insert(
            "todos".to_owned(),
            (0..ROWS)
                .map(|index| {
                    let mut row = Map::new();
                    row.insert("title".to_owned(), json!(format!("row-{index:06}")));
                    row.insert("userId".to_owned(), json!("ada"));
                    row
                })
                .collect::<Vec<_>>(),
        );
        snapback.seed(SeedData { tables }).expect("seed");
        if coalesce {
            install_deterministic_coalescer(&mut snapback);
        }
        for observer in 0..OBSERVERS {
            snapback
                .subscribe_live(
                    "listAllOrdered",
                    sub_input(&format!("conn-{observer}"), "ada"),
                )
                .expect("subscribe");
        }
        // Prime one commit so the coalescing lane has its cost sample, and
        // drain its frames so counts below cover the burst only.
        create(&mut snapback, "prime", "ada");
        for observer in 0..OBSERVERS {
            drain(&mut snapback, &format!("conn-{observer}"));
        }
        let started = std::time::Instant::now();
        for index in 0..BURST {
            create(&mut snapback, &format!("burst-{index:06}"), "ada");
        }
        snapback.flush_pending_live_fanout();
        let elapsed = started.elapsed();
        let deferred = snapback.live_coalesce_stats().deferred_commits;
        let delivered = (0..OBSERVERS)
            .map(|observer| drain(&mut snapback, &format!("conn-{observer}")).len() as u64)
            .sum::<u64>();
        (elapsed, delivered, deferred)
    };

    let (off_elapsed, off_frames, off_deferred) = run(false);
    let (on_elapsed, on_frames, on_deferred) = run(true);
    println!(
        "coalescing OFF: burst of {BURST} mutations x {OBSERVERS} observers over {ROWS} rows: \
         {off_elapsed:?} total, {off_frames} delivered frames, {off_deferred} deferred"
    );
    println!(
        "coalescing ON:  burst of {BURST} mutations x {OBSERVERS} observers over {ROWS} rows: \
         {on_elapsed:?} total, {on_frames} delivered frames, {on_deferred} deferred"
    );
    assert!(on_frames < off_frames, "coalescing must reduce frame count");
}

/* ---------- client-apply simulation (mirrors tests/live_delta_v0.rs) ---------- */

fn apply_deltas(client: &mut BTreeMap<String, Value>, envelopes: Vec<RealtimeEnvelope>) {
    for envelope in envelopes {
        let RealtimeEnvelope::Durable(message) = envelope else {
            continue;
        };
        let update: Value = serde_json::from_slice(&message.payload).expect("json");
        match update["kind"].as_str() {
            Some("live_delta") => {
                for op in update["ops"].as_array().cloned().unwrap_or_default() {
                    let id = op["id"].as_str().unwrap_or_default().to_owned();
                    match op["op"].as_str() {
                        Some("add") | Some("update") => {
                            client.insert(id, op["row"].clone());
                        }
                        Some("remove") => {
                            client.remove(&id);
                        }
                        _ => {}
                    }
                }
            }
            Some("live_replace") => {
                client.clear();
                for row in update["rows"].as_array().cloned().unwrap_or_default() {
                    if let Some(id) = row["_id"].as_str() {
                        client.insert(id.to_owned(), row);
                    }
                }
            }
            _ => {}
        }
    }
}

fn client_rows(client: &BTreeMap<String, Value>) -> BTreeMap<String, Value> {
    client.clone()
}

fn query_rows(rows: &[Value]) -> BTreeMap<String, Value> {
    rows.iter()
        .map(|row| (row["_id"].as_str().expect("id").to_owned(), row.clone()))
        .collect()
}

/* ---------- harness (mirrors tests/live_delta_v0.rs) ---------- */

fn drain(snapback: &mut LocalSnapback, connection: &str) -> Vec<RealtimeEnvelope> {
    snapback.drain_outbox(connection)
}

fn drain_json(snapback: &mut LocalSnapback, connection: &str) -> Vec<Value> {
    drain(snapback, connection)
        .into_iter()
        .filter_map(|envelope| match envelope {
            RealtimeEnvelope::Durable(message) => {
                Some(serde_json::from_slice(&message.payload).expect("durable live JSON"))
            }
            RealtimeEnvelope::Ephemeral(_) => None,
        })
        .collect()
}

fn create(snapback: &mut LocalSnapback, title: &str, user: &str) -> String {
    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": title, "userId": user }), user),
        )
        .expect("create")
        .result
        .as_str()
        .expect("id")
        .to_owned()
}

fn set_user(snapback: &mut LocalSnapback, id: &str, user: &str) {
    snapback
        .invoke_mutation(
            "setUser",
            input(json!({ "id": id, "userId": user }), "admin"),
        )
        .expect("set user");
}

fn set_title(snapback: &mut LocalSnapback, id: &str, title: &str) {
    snapback
        .invoke_mutation(
            "setTitle",
            input(json!({ "id": id, "title": title }), "admin"),
        )
        .expect("set title");
}

fn delete_todo(snapback: &mut LocalSnapback, id: &str) {
    snapback
        .invoke_mutation("deleteTodo", input(json!({ "id": id }), "admin"))
        .expect("delete");
}

fn configured() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(schema()).expect("schema");
    snapback.load_functions(functions());
    snapback
}

fn sub_input(connection: &str, user: &str) -> LiveSubscribeInput {
    LiveSubscribeInput {
        connection_id: connection.to_owned(),
        input: input(json!({ "userId": user }), user),
        authorization_namespace: None,
        supersedes: None,
        resume_from_token: None,
    }
}

fn input(args: Value, user: &str) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            user_id: Some(user.to_owned()),
            ..Default::default()
        },
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

fn schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("coalesce-v0".to_owned()),
        tables: vec![TableManifest {
            name: "todos".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "title".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "userId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
            ],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: Some(snapback::manifest::TableVisibilityV1::PublicRead),
            history: None,
        }],
        ..SchemaManifest::default()
    }
}

fn functions() -> FunctionManifest {
    let mut list_mine = FunctionDefinition::new(
        "listMine",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: vec![FilterExpr {
                field: "userId".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::AuthUserId,
            }],
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        })),
    );
    install_result_contract(&mut list_mine, documents_contract());
    // The synthetic-benchmark shape: ordered + windowed forces the honest
    // re-query/`live_replace` lane (the delta core returns `Replace` for
    // ordered results), matching the zb5-hot observer shape.
    let mut list_all_ordered = FunctionDefinition::new(
        "listAllOrdered",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: Vec::new(),
            order: vec![snapback::manifest::OrderExpr {
                field: "title".to_owned(),
                direction: snapback::manifest::OrderDirection::Asc,
                max_encoded_bytes: None,
            }],
            limit: Some(1_000),
            membership_filters: Vec::new(),
            indexed_by: None,
        })),
    );
    install_result_contract(&mut list_all_ordered, documents_contract());
    let insert = FunctionDefinition::new(
        "createTodo",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Insert {
                table: "todos".to_owned(),
                values: BTreeMap::from([
                    ("title".to_owned(), ValueExpr::Arg("title".to_owned())),
                    ("userId".to_owned(), ValueExpr::Arg("userId".to_owned())),
                ]),
                bind_id_as: Some("id".to_owned()),
            }],
            return_value: Some(ReturnValue::Binding("id".to_owned())),
        })),
    );
    let patch = |name: &str, field: &str| {
        FunctionDefinition::new(
            name,
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                owner_write_checks: Vec::new(),
                steps: vec![MutationStep::Patch {
                    table: "todos".to_owned(),
                    id: ValueExpr::Arg("id".to_owned()),
                    values: BTreeMap::from([(field.to_owned(), ValueExpr::Arg(field.to_owned()))]),
                }],
                return_value: Some(ReturnValue::ChangedCount),
            })),
        )
    };
    let delete = FunctionDefinition::new(
        "deleteTodo",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Delete {
                table: "todos".to_owned(),
                id: ValueExpr::Arg("id".to_owned()),
            }],
            return_value: Some(ReturnValue::ChangedCount),
        })),
    );
    let create_then_delete = FunctionDefinition::new(
        "createThenDelete",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![
                MutationStep::Insert {
                    table: "todos".to_owned(),
                    values: BTreeMap::from([
                        ("title".to_owned(), ValueExpr::Arg("title".to_owned())),
                        ("userId".to_owned(), ValueExpr::Arg("userId".to_owned())),
                    ]),
                    bind_id_as: Some("id".to_owned()),
                },
                MutationStep::Delete {
                    table: "todos".to_owned(),
                    id: ValueExpr::Binding("id".to_owned()),
                },
            ],
            return_value: Some(ReturnValue::Binding("id".to_owned())),
        })),
    );
    FunctionManifest {
        bundle_hash: Some("coalesce-fns-v0".to_owned()),
        functions: vec![
            list_mine,
            list_all_ordered,
            insert,
            patch("setUser", "userId"),
            patch("setTitle", "title"),
            delete,
            create_then_delete,
        ],
        acknowledged_experimental_capabilities: vec!["result_contract_v1".to_owned()],
        ..FunctionManifest::default()
    }
}

fn install_result_contract(function: &mut FunctionDefinition, contract: FunctionResultContract) {
    let value = serde_json::to_value(&contract).expect("serialize result contract");
    let canonical = snapback::rqs::jcs(&value).expect("canonical result contract");
    let mut hash = Sha256::new();
    hash.update(b"snapback:function-result:v1\n");
    hash.update(canonical.as_bytes());
    function.result_contract = contract;
    function.result_contract_hash = Some(format!("sha256:{:x}", hash.finalize()));
    function
        .required_capabilities
        .push("result_contract_v1".to_owned());
}

fn documents_contract() -> FunctionResultContract {
    FunctionResultContract::Documents {
        table: "todos".to_owned(),
        document: todo_row_contract(),
    }
}

fn todo_row_contract() -> ResultValueContract {
    let system_integer = || ResultValueContract::Integer {
        min: 0,
        max: 9_007_199_254_740_991,
    };
    ResultValueContract::Object {
        fields: vec![
            ResultObjectFieldContract {
                name: "_id".to_owned(),
                required: true,
                value: ResultValueContract::Id {
                    table: "todos".to_owned(),
                },
            },
            ResultObjectFieldContract {
                name: "_version".to_owned(),
                required: true,
                value: system_integer(),
            },
            ResultObjectFieldContract {
                name: "_createdAt".to_owned(),
                required: true,
                value: system_integer(),
            },
            ResultObjectFieldContract {
                name: "_updatedAt".to_owned(),
                required: true,
                value: system_integer(),
            },
            ResultObjectFieldContract {
                name: "title".to_owned(),
                required: true,
                value: ResultValueContract::String {
                    max_bytes: 1024 * 1024,
                },
            },
            ResultObjectFieldContract {
                name: "userId".to_owned(),
                required: true,
                value: ResultValueContract::String {
                    max_bytes: 1024 * 1024,
                },
            },
        ],
        allow_extra: false,
    }
}
