//! ENG-23361: unhandled rejections of detached promise chains must fail the
//! invocation instead of committing partial work as success. The only promise
//! the host observes is the invoke IIFE's own; a detached chain the handler
//! spawned (`forEach(async ...)` is the classic shape) executes during the
//! microtask drain — its earlier `ctx.db.*` writes land in the commit buffer,
//! its later ones are silently skipped when it rejects — and nothing reported
//! the rejection. These tests pin the fix: the ctx bootstrap's rejection
//! ledger plus the host's post-eval sweep turn that into
//! `SNAPBACK_HANDLER_UNHANDLED_REJECTION` with nothing committed, while
//! rejections handled anywhere before completion still succeed.

use serde_json::{Value, json};
use snapback::cron::CronRunOutcome;
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, CronActivationPolicy, CronJitterPolicy, CronJobDefinition, CronOverlapPolicy,
    CronRetryMode, CronRetryPolicy, CronSchedule, FieldManifest, FieldType, FunctionDefinition,
    FunctionKind, FunctionManifest, FunctionRuntime, HandlerInput, IbexModule, SchemaManifest,
    TableManifest,
};

/// One module holding every handler these tests need; sharing one source also
/// exercises warm-pool check-in/reset behavior after a swept invocation.
const REJECTION_MODULE_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  // The exact ENG-23361 failure scenario: detached async callbacks. The
  // callback for a bad item throws before its insert; the callbacks for good
  // items insert. Before the fix this returned "ok" and committed the good
  // items' writes — partial work reported as success.
  async forEachInsert(ctx, args) {
    args.items.forEach(async function(item) {
      if (item.bad) { throw new Error("validation failed: " + item.n); }
      ctx.db.insert('items', { n: item.n });
    });
    return "ok";
  },
  // The recommended shape for the same work: the handler awaits the fan-out,
  // so a rejection propagates and fails the invocation as the handler's own
  // error (not via the ledger).
  async awaitedParallelInsert(ctx, args) {
    await Promise.all(args.items.map(async function(item) {
      if (item.bad) { throw new Error("validation failed: " + item.n); }
      ctx.db.insert('items', { n: item.n });
    }));
    return "ok";
  },
  // Rejects several microtask hops deep, after the invocation promise has
  // already settled — only a post-drain host-side sweep can see this one.
  async deepDetachedRejection(ctx) {
    Promise.resolve().then(function() {}).then(function() {}).then(function() {})
      .then(function() { throw new Error("deep-boom"); });
    return "ok";
  },
  // A rejection that is handled later in the same drain must not trip the
  // sweep: the ledger entry is cleared when the handler attaches.
  async rejectionHandledLater(ctx) {
    var rejected = Promise.reject(new Error("caught-later"));
    Promise.resolve().then(function() { rejected.catch(function() {}); });
    await Promise.resolve();
    await Promise.resolve();
    return "ok";
  },
  // A handler attached before completion and dispatched during finale must
  // clear its entry too.
  async rejectionPreHandled(ctx) {
    var value = await Promise.reject(new Error("caught")).catch(function() { return "caught"; });
    return value;
  },
  async detachedRejectionQuery(ctx) {
    Promise.resolve().then(function() { throw new Error("query-boom"); });
    return [];
  },
  async detachedRejectionAction(ctx) {
    Promise.resolve().then(function() { throw new Error("action-boom"); });
    return {};
  },
  async insertOne(ctx, args) {
    await ctx.db.insert('items', { n: args.n });
    return {};
  },
  async listItems(ctx) {
    return await ctx.db.query('items').order('_createdAt', 'asc').collect();
  }
};
"#;

fn schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("unhandled-rejection-v0".to_owned()),
        tables: vec![TableManifest {
            name: "items".to_owned(),
            fields: vec![FieldManifest {
                name: "n".to_owned(),
                field_type: FieldType::Integer,
                optional: false,
            }],
            indexes: Vec::new(),
            syncable: true,
        }],
        ..SchemaManifest::default()
    }
}

fn functions() -> FunctionManifest {
    let define = |name: &str, kind: FunctionKind| {
        FunctionDefinition::new(
            name,
            kind,
            FunctionRuntime::IbexModule(IbexModule {
                source: REJECTION_MODULE_SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        )
    };
    FunctionManifest {
        functions: vec![
            define("forEachInsert", FunctionKind::Mutation),
            define("awaitedParallelInsert", FunctionKind::Mutation),
            define("deepDetachedRejection", FunctionKind::Mutation),
            define("rejectionHandledLater", FunctionKind::Mutation),
            define("rejectionPreHandled", FunctionKind::Mutation),
            define("detachedRejectionQuery", FunctionKind::Query),
            define("detachedRejectionAction", FunctionKind::Action),
            define("insertOne", FunctionKind::Mutation),
            define("listItems", FunctionKind::Query),
        ],
        cron_jobs: vec![CronJobDefinition {
            name: "detachedRejection".to_owned(),
            schedule: CronSchedule {
                every_ms: Some(60_000),
                cron: None,
            },
            action: "detachedRejectionAction".to_owned(),
            enabled: true,
            activation: CronActivationPolicy::default(),
            jitter_policy: CronJitterPolicy {
                enabled: false,
                max_offset_ms: 0,
            },
            overlap_policy: CronOverlapPolicy::NoOverlap,
            retry_policy: CronRetryPolicy {
                mode: CronRetryMode::NextTick,
            },
            required_capabilities: vec!["cron".to_owned()],
            target_wakeup: None,
            source_span: None,
        }],
        ..FunctionManifest::default()
    }
}

fn configured() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("snapback");
    snapback.apply_schema(schema()).expect("schema");
    snapback.load_functions(functions());
    snapback
}

fn input(args: Value) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput::default(),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

fn items(snapback: &LocalSnapback) -> Vec<Value> {
    snapback
        .invoke_query("listItems", input(json!({})))
        .expect("listItems")
        .rows
}

fn mixed_items() -> Value {
    json!({ "items": [ { "n": 1 }, { "n": 2, "bad": true }, { "n": 3 } ] })
}

#[test]
fn foreach_async_rejection_fails_and_commits_nothing() {
    // The ENG-23361 repro: before the fix this returned "ok" and committed
    // items 1 and 3 — partial work, no error, no log.
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("forEachInsert", input(mixed_items()))
        .expect_err("a detached rejection must fail the mutation");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["validation failed: 2"]),
        "the diagnostic must carry the swallowed rejection reason"
    );
    assert!(
        items(&snapback).is_empty(),
        "the good items' buffered writes must not commit as partial work"
    );
}

#[test]
fn foreach_async_without_failures_still_succeeds() {
    // Positive control: detached chains that all resolve leave no ledger
    // entries, and their writes commit as before.
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation(
            "forEachInsert",
            input(json!({ "items": [ { "n": 1 }, { "n": 2 } ] })),
        )
        .expect("all-good forEach mutation");
    assert_eq!(output.result, json!("ok"));
    assert_eq!(items(&snapback).len(), 2);
}

#[test]
fn awaited_parallel_rejection_is_the_handlers_own_error() {
    // The recommended fix pattern fails as a plain handler error — the
    // rejection is handled (by Promise.all and the await), so the ledger
    // stays out of it — and still commits nothing.
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("awaitedParallelInsert", input(mixed_items()))
        .expect_err("awaited rejection must fail the mutation");
    assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_FAILED");
    assert!(items(&snapback).is_empty());
}

#[test]
fn rejection_after_settlement_is_still_caught() {
    // The chain rejects microtask hops after the invocation promise settled;
    // only the post-drain host-side sweep can observe it.
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("deepDetachedRejection", input(json!({})))
        .expect_err("a post-settlement detached rejection must fail the mutation");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(error.diagnostic.details["rejections"], json!(["deep-boom"]));
}

#[test]
fn rejection_handled_later_in_the_drain_succeeds() {
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation("rejectionHandledLater", input(json!({})))
        .expect("a rejection handled before completion is not unhandled");
    assert_eq!(output.result, json!("ok"));
}

#[test]
fn rejection_with_pre_attached_handler_succeeds() {
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation("rejectionPreHandled", input(json!({})))
        .expect("a caught rejection is not unhandled");
    assert_eq!(output.result, json!("caught"));
}

#[test]
fn detached_rejection_fails_queries_too() {
    let snapback = configured();
    let error = snapback
        .invoke_query("detachedRejectionQuery", input(json!({})))
        .expect_err("a detached rejection must fail the query");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
}

#[test]
fn detached_rejection_fails_actions_too() {
    // Actions never pool (fresh-VM path), so this pins the sweep on the
    // fresh path as well as the warm one.
    let mut snapback = configured();
    let record = snapback
        .run_cron_job_now("detachedRejection", 1_000)
        .expect("run cron job");
    assert_eq!(record.outcome, CronRunOutcome::Failed);
    let diagnostic = record.diagnostic.expect("failed run carries a diagnostic");
    assert_eq!(diagnostic.code, "SNAPBACK_HANDLER_UNHANDLED_REJECTION");
}

#[test]
fn pool_stays_healthy_and_ledger_does_not_leak_across_invocations() {
    // The sweep drains the ledger and the VM is checked back in, so a failed
    // invocation must not poison the next one on the same warm VM.
    let mut snapback = configured();
    for _ in 0..2 {
        let error = snapback
            .invoke_mutation("forEachInsert", input(mixed_items()))
            .expect_err("detached rejection");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
        );
    }
    let output = snapback
        .invoke_mutation("insertOne", input(json!({ "n": 7 })))
        .expect("mutation after swept invocations");
    assert_eq!(output.result, json!({}));
    let rows = items(&snapback);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["n"], json!(7));
}
