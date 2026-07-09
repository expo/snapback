//! DK-4 leak suite — the "proven reset" gate for the warm VM pool
//! (LLP 0009 §Invocation Isolation, DK-4 as-built).
//!
//! Every test here would fail if the per-invocation reset regressed. The
//! characterization test (`dk4_module_level_state_persists_documented_semantics`)
//! is the positive control: it fails if warm reuse silently stops happening,
//! which keeps the leak tests from passing vacuously against an
//! always-fresh fallback.

use serde_json::{Value, json};
use snapback::cron::CronRunOutcome;
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, CronActivationPolicy, CronJitterPolicy, CronJobDefinition, CronOverlapPolicy,
    CronRetryMode, CronRetryPolicy, CronSchedule, FieldManifest, FieldType, FunctionDefinition,
    FunctionKind, FunctionManifest, FunctionRuntime, HandlerInput, IbexModule, SchemaManifest,
    TableManifest,
};

/// One module ("bundle") holding every handler the leak tests need, so all of
/// them share a single warm VM per instance and each test's second invocation
/// really does observe the VM its first invocation may have dirtied.
const LEAK_MODULE_SOURCE: &str = r#"
let moduleCounter = 0;
let mutationCounter = 0;
let stashedCtx = null;
globalThis.DK4_BASELINE = "original";
globalThis.__snapbackHandlers = {
  async count(ctx) { moduleCounter += 1; return [{ n: moduleCounter }]; },
  // Cross-context injection probe: A captures its own ctx in module scope
  // (the sweep cannot reach a closure); a later invocation B fires it.
  async stashCtx(ctx, args) {
    stashedCtx = ctx;
    return await ctx.db.insert('items', { n: args.n, who: args.who });
  },
  async fireStashed(ctx, args) {
    var sawStash = stashedCtx !== null;
    var injectionBlocked = false;
    if (stashedCtx) {
      try {
        // Under the bug this routes through B's live context (B's auth, B's
        // buffer) and commits {n:999} inside B's mutation. The epoch guard
        // must reject it: A's ctx closes over A's epoch, B is live.
        stashedCtx.db.insert('items', { n: 999, who: 'injected' });
      } catch (e) {
        injectionBlocked = true;
      }
    }
    await ctx.db.insert('items', {
      n: args.n, who: args.who, sawStash: sawStash, injectionBlocked: injectionBlocked
    });
    return [];
  },
  async listItems(ctx) {
    return await ctx.db.query('items').order('_createdAt', 'asc').collect();
  },
  // Iterator-prototype pollution: %ArrayIteratorPrototype%.next is not a named
  // global; a poisoned .next breaks the next invocation's for-of unless the
  // reset root-set reaches it. Poison to terminate-empty (never hang).
  async poisonIterator(ctx) {
    var proto = Object.getPrototypeOf([][Symbol.iterator]());
    proto.dk4IterPoison = "x";
    proto.next = function () { return { value: undefined, done: true }; };
    return [];
  },
  async checkIterator(ctx) {
    var arr = ["a", "b"];
    var collected = [];
    for (var x of arr) { collected.push(x); if (collected.length > 8) break; }
    var proto = Object.getPrototypeOf([][Symbol.iterator]());
    return [{ collected: collected, poisoned: proto.dk4IterPoison !== undefined }];
  },
  async setLeak(ctx, args) {
    globalThis.dk4Leak = args.value;
    globalThis[Symbol.for("dk4sym")] = args.value;
    if (typeof console === "object" && console !== null) {
      console.dk4Stash = args.value;
    }
    return [];
  },
  async readLeak(ctx) {
    return [{
      leak: typeof globalThis.dk4Leak,
      sym: typeof globalThis[Symbol.for("dk4sym")],
      consoleStash: typeof console === "object" && console !== null
        ? typeof console.dk4Stash
        : "undefined"
    }];
  },
  async bumpViaMutation(ctx, args) {
    mutationCounter += 1;
    globalThis.dk4MutationLeak = "set-by-mutation";
    return await ctx.db.insert('counts', { n: mutationCounter });
  },
  async readMutationLeak(ctx) {
    return [{ leak: typeof globalThis.dk4MutationLeak }];
  },
  async listCounts(ctx) {
    return await ctx.db.query('counts').order('_createdAt', 'asc').collect();
  },
  async overwriteBaseline(ctx) { globalThis.DK4_BASELINE = "evil"; return []; },
  async readBaseline(ctx) { return [{ v: globalThis.DK4_BASELINE }]; },
  async hijackDispatch(ctx) {
    globalThis.__snapbackHandlers.victim = async function() { return [{ v: "hacked" }]; };
    return [];
  },
  async victim(ctx) { return [{ v: "clean" }]; },
  async pollute(ctx) {
    Object.prototype.dk4Polluted = "x";
    Array.prototype.map = function() { return ["evil"]; };
    return [];
  },
  async checkPollution(ctx) {
    var arr = ["a"];
    return [{
      protoClean: ({}).dk4Polluted === undefined,
      mapResult: arr.map(function(v) { return v + "b"; })[0]
    }];
  },
  async danglePromise(ctx) {
    var p = new Promise(function(resolve) { globalThis.dk4Fire = resolve; });
    p.then(function() { globalThis.dk4Fired = 1; });
    return [];
  },
  async checkDangle(ctx) {
    return [{ fire: typeof globalThis.dk4Fire, fired: typeof globalThis.dk4Fired }];
  },
  async freezeGlobals(ctx) {
    moduleCounter += 1;
    Object.freeze(globalThis);
    return [{ n: moduleCounter }];
  }
};
"#;

fn schema() -> SchemaManifest {
    let int = |name: &str, optional: bool| FieldManifest {
        name: name.to_owned(),
        field_type: FieldType::Integer,
        optional,
    };
    let string = |name: &str, optional: bool| FieldManifest {
        name: name.to_owned(),
        field_type: FieldType::String,
        optional,
    };
    let boolean = |name: &str, optional: bool| FieldManifest {
        name: name.to_owned(),
        field_type: FieldType::Boolean,
        optional,
    };
    SchemaManifest {
        schema_hash: Some("dk4-v0".to_owned()),
        tables: vec![
            TableManifest {
                name: "counts".to_owned(),
                fields: vec![int("n", false)],
                indexes: Vec::new(),
                syncable: true,
            },
            TableManifest {
                name: "items".to_owned(),
                fields: vec![
                    int("n", false),
                    string("who", false),
                    boolean("sawStash", true),
                    boolean("injectionBlocked", true),
                ],
                indexes: Vec::new(),
                syncable: true,
            },
        ],
        ..SchemaManifest::default()
    }
}

fn leak_functions() -> FunctionManifest {
    let query = |name: &str| {
        FunctionDefinition::new(
            name,
            FunctionKind::Query,
            FunctionRuntime::IbexModule(IbexModule {
                source: LEAK_MODULE_SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        )
    };
    let mutation = |name: &str| {
        FunctionDefinition::new(
            name,
            FunctionKind::Mutation,
            FunctionRuntime::IbexModule(IbexModule {
                source: LEAK_MODULE_SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        )
    };
    FunctionManifest {
        functions: vec![
            query("count"),
            mutation("setLeak"),
            query("readLeak"),
            mutation("bumpViaMutation"),
            query("readMutationLeak"),
            query("listCounts"),
            mutation("overwriteBaseline"),
            query("readBaseline"),
            mutation("hijackDispatch"),
            query("victim"),
            mutation("pollute"),
            query("checkPollution"),
            mutation("danglePromise"),
            query("checkDangle"),
            mutation("stashCtx"),
            mutation("fireStashed"),
            query("listItems"),
            query("poisonIterator"),
            query("checkIterator"),
            query("freezeGlobals"),
        ],
        ..FunctionManifest::default()
    }
}

fn configured() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("snapback");
    snapback.apply_schema(schema()).expect("schema");
    snapback.load_functions(leak_functions());
    snapback
}

fn input(args: Value) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput::default(),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,    }
}

fn input_as(user: &str, args: Value) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            principal: Some(user.to_owned()),
            session_id: None,
            user_id: Some(user.to_owned()),
        },
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,    }
}

fn query_row(snapback: &LocalSnapback, name: &str) -> Value {
    snapback
        .invoke_query(name, input(json!({})))
        .unwrap_or_else(|error| panic!("query {name}: {error:?}"))
        .rows
        .first()
        .cloned()
        .unwrap_or(Value::Null)
}

fn count(snapback: &LocalSnapback) -> u64 {
    query_row(snapback, "count")["n"].as_u64().expect("counter")
}

/// Documented DK-4 semantics AND the suite's positive control: module-level
/// mutable state persists across invocations on the warm path (the standard
/// pooled-runtime model — code must rely on neither persistence nor
/// freshness). If warm reuse silently stopped (every VM burned, pool
/// bypassed), this returns 1,1 and fails — proving the leak tests below run
/// against a genuinely reused VM.
#[test]
fn dk4_module_level_state_persists_documented_semantics() {
    let snapback = configured();
    assert_eq!(count(&snapback), 1);
    assert_eq!(
        count(&snapback),
        2,
        "warm reuse must actually happen (module state is the documented observable)"
    );
}

/// Obligation 1 (globals cleared): a global added by one invocation — string
/// and symbol keyed — is gone before the next invocation of the same bundle.
#[test]
fn dk4_global_add_does_not_leak_between_invocations() {
    let mut snapback = configured();
    // Prove the VM is warm across this pair, not fresh-per-invocation.
    assert_eq!(count(&snapback), 1);
    snapback
        .invoke_mutation("setLeak", input(json!({ "value": "leaked" })))
        .expect("setLeak");
    let row = query_row(&snapback, "readLeak");
    assert_eq!(
        row["leak"], "undefined",
        "string-keyed global must be swept: {row:?}"
    );
    assert_eq!(
        row["sym"], "undefined",
        "symbol-keyed global must be swept: {row:?}"
    );
    assert_eq!(
        row["consoleStash"], "undefined",
        "data stashed on the console host global must be swept: {row:?}"
    );
    assert_eq!(count(&snapback), 2, "the sweep must not have burned the VM");
}

/// Obligation 1 (globals restored): overwriting a module-established global
/// is rolled back to the post-setup baseline value.
#[test]
fn dk4_global_overwrite_restored_to_baseline() {
    let mut snapback = configured();
    assert_eq!(query_row(&snapback, "readBaseline")["v"], "original");
    snapback
        .invoke_mutation("overwriteBaseline", input(json!({})))
        .expect("overwriteBaseline");
    assert_eq!(
        query_row(&snapback, "readBaseline")["v"],
        "original",
        "baseline global must be restored after an overwrite"
    );
}

/// The dispatch table is swept one level deep: replacing a handler on
/// `__snapbackHandlers` does not survive into the next invocation.
#[test]
fn dk4_dispatch_table_mutation_restored() {
    let mut snapback = configured();
    assert_eq!(query_row(&snapback, "victim")["v"], "clean");
    snapback
        .invoke_mutation("hijackDispatch", input(json!({})))
        .expect("hijackDispatch");
    assert_eq!(
        query_row(&snapback, "victim")["v"],
        "clean",
        "a replaced dispatch-table handler must be restored"
    );
}

/// Prototype pollution — an added `Object.prototype` property and an
/// overwritten `Array.prototype` method — is swept back to the baseline.
#[test]
fn dk4_prototype_pollution_swept() {
    let mut snapback = configured();
    snapback
        .invoke_mutation("pollute", input(json!({})))
        .expect("pollute");
    let row = query_row(&snapback, "checkPollution");
    assert_eq!(
        row["protoClean"], true,
        "Object.prototype addition must be swept: {row:?}"
    );
    assert_eq!(
        row["mapResult"], "ab",
        "Array.prototype.map must be restored: {row:?}"
    );
}

/// Obligation 3: an unsettled promise's resolver and reactions from one
/// invocation cannot fire during a later one — the reset removes the global
/// reference, leaving the resolver unreachable.
#[test]
fn dk4_unsettled_promise_does_not_carry_over() {
    let mut snapback = configured();
    snapback
        .invoke_mutation("danglePromise", input(json!({})))
        .expect("danglePromise");
    let row = query_row(&snapback, "checkDangle");
    assert_eq!(
        row["fire"], "undefined",
        "the stored resolver must be swept: {row:?}"
    );
    assert_eq!(
        row["fired"], "undefined",
        "the dangling reaction must never fire: {row:?}"
    );
}

/// Fail-closed: when the reset cannot restore (a frozen `globalThis` makes
/// deletes/redefines impossible), the VM is burned and the next invocation
/// runs fresh — observable as module state starting over.
#[test]
fn dk4_reset_failure_burns_the_vm() {
    let snapback = configured();
    assert_eq!(count(&snapback), 1);
    // The freeze invocation itself may succeed or fail depending on how the
    // engine's own bookkeeping tolerates a frozen global object; either way
    // the VM must not be pooled again.
    let _ = snapback.invoke_query("freezeGlobals", input(json!({})));
    assert_eq!(
        count(&snapback),
        1,
        "after a failed reset the next invocation must get a fresh VM"
    );
}

/// Mutations participate in the warm pool (their module state advances) and
/// their global residue is swept before the next invocation.
#[test]
fn dk4_mutations_share_the_warm_vm_and_are_swept() {
    let mut snapback = configured();
    snapback
        .invoke_mutation("bumpViaMutation", input(json!({})))
        .expect("first mutation");
    snapback
        .invoke_mutation("bumpViaMutation", input(json!({})))
        .expect("second mutation");
    let rows = snapback
        .invoke_query("listCounts", input(json!({})))
        .expect("listCounts")
        .rows;
    let ns: Vec<u64> = rows.iter().filter_map(|row| row["n"].as_u64()).collect();
    assert_eq!(
        ns,
        vec![1, 2],
        "mutations must reuse one warm VM (module counter advances)"
    );
    assert_eq!(
        query_row(&snapback, "readMutationLeak")["leak"],
        "undefined",
        "a mutation's global residue must be swept like a query's"
    );
}

/// Two local app instances never share loaded code state: each has its own
/// pool, so module-level state cannot bleed across instances
/// (LLP 0009 §Validation Requirements; LLP 0018).
#[test]
fn dk4_pools_are_per_instance() {
    let a = configured();
    let b = configured();
    assert_eq!(count(&a), 1);
    assert_eq!(count(&b), 1, "instance B must not observe instance A's VM");
    assert_eq!(count(&a), 2, "instance A keeps its own warm state");
}

/// `load_functions` invalidates the pool: even reloading the *same* source
/// starts from fresh VMs (and changed source could never hit anyway — the
/// pool is keyed by exact module source).
#[test]
fn dk4_load_functions_resets_warm_state() {
    let mut snapback = configured();
    assert_eq!(count(&snapback), 1);
    assert_eq!(count(&snapback), 2);
    snapback.load_functions(leak_functions());
    assert_eq!(
        count(&snapback),
        1,
        "load_functions must clear the warm pool"
    );
}

/// App reset invalidates the pool too.
#[test]
fn dk4_app_reset_clears_warm_state() {
    let mut snapback = configured();
    assert_eq!(count(&snapback), 1);
    snapback.reset().expect("reset");
    assert_eq!(count(&snapback), 1, "app reset must clear the warm pool");
}

/// The capability manifest reports the live VM lifecycle honestly
/// (LLP 0012's honesty rule): warm-pooled-reset by default on this target.
#[test]
fn dk4_capability_manifest_reports_vm_lifecycle() {
    let mut snapback = configured();
    let inspect = snapback.inspect().expect("inspect");
    assert_eq!(
        inspect.capability_manifest.vm_lifecycle,
        "warm-pooled-reset"
    );
}

/// THE cross-context regression test (adversarial-review HIGH, 2026-07-02).
/// Invocation A (alice) stashes its own `ctx` in module scope — the accepted
/// closure carve-out the sweep cannot reach. Invocation B (bob) reuses the
/// warm VM and fires A's stashed `ctx.db.insert({n:999})`. Against the
/// unfixed code that insert routes through B's live thread-local context and
/// commits `{n:999}` inside bob's mutation (cross-user write injection). With
/// the epoch guard, A's ctx carries A's epoch, B is live, and the host
/// rejects the stale continuation. Asserts: bob's row proves reuse
/// (`sawStash`) AND the guard fired (`injectionBlocked`), and no `n:999` row
/// exists in anyone's data. Would fail against the pre-fix code.
#[test]
fn dk4_stale_continuation_cannot_inject_into_another_invocation() {
    let mut snapback = configured();
    snapback
        .invoke_mutation(
            "stashCtx",
            input_as("alice", json!({ "n": 1, "who": "alice" })),
        )
        .expect("alice stash");
    snapback
        .invoke_mutation(
            "fireStashed",
            input_as("bob", json!({ "n": 2, "who": "bob" })),
        )
        .expect("bob fire");

    let rows = snapback
        .invoke_query("listItems", input(json!({})))
        .expect("listItems")
        .rows;

    let bob_row = rows
        .iter()
        .find(|row| row["n"].as_u64() == Some(2))
        .expect("bob's row must exist");
    assert_eq!(
        bob_row["sawStash"], true,
        "the warm VM must have been reused — else the probe is vacuous: {bob_row:?}"
    );
    assert_eq!(
        bob_row["injectionBlocked"], true,
        "A's stashed ctx.db.insert must be rejected as a stale continuation: {bob_row:?}"
    );
    assert!(
        !rows.iter().any(|row| row["n"].as_u64() == Some(999)),
        "no injected n:999 row may exist — cross-context write must not commit: {rows:?}"
    );
}

/// MEDIUM (adversarial-review, 2026-07-02): the reset root-set must reach
/// intrinsics that are not named globals. A poisoned
/// `%ArrayIteratorPrototype%.next` from one invocation must not survive to
/// break the next invocation's for-of. `count` first proves reuse is
/// happening (non-vacuous), then poison + check on the same warm VM.
#[test]
fn dk4_iterator_prototype_pollution_is_swept() {
    let snapback = configured();
    assert_eq!(count(&snapback), 1);
    assert_eq!(
        count(&snapback),
        2,
        "warm VM must be reused for this to be meaningful"
    );

    snapback
        .invoke_query("poisonIterator", input(json!({})))
        .expect("poisonIterator");
    let row = query_row(&snapback, "checkIterator");
    assert_eq!(
        row["collected"],
        json!(["a", "b"]),
        "for-of must work on the next invocation — %ArrayIteratorPrototype% must be restored: {row:?}"
    );
    assert_eq!(
        row["poisoned"], false,
        "the added iterator-prototype property must be swept: {row:?}"
    );
}

/// Actions always run fresh: module-level state never persists across two
/// runs of the same action, even though the same module's *mutations* pool.
/// The nested `ctx.runMutation` also exercises the S5.D1 re-entry shape with
/// a warm inner mutation inside a fresh outer action.
#[test]
fn dk4_actions_always_fresh() {
    let mut snapback = LocalSnapback::memory().expect("snapback");
    snapback.apply_schema(schema()).expect("schema");
    snapback.load_functions(action_functions());

    for run in 0..2u64 {
        let record = snapback
            .run_cron_job_now("dk4Bump", 1_000 + run)
            .expect("run cron job");
        assert_eq!(
            record.outcome,
            CronRunOutcome::Succeeded,
            "action run must succeed: {:?}",
            record.diagnostic
        );
    }

    let rows = snapback
        .invoke_query("listCounts", input(json!({})))
        .expect("listCounts")
        .rows;
    let ns: Vec<u64> = rows.iter().filter_map(|row| row["n"].as_u64()).collect();
    assert_eq!(
        ns,
        vec![1, 1],
        "each action run must start from a fresh VM (module counter always 1)"
    );
}

const ACTION_MODULE_SOURCE: &str = r#"
let actionCounter = 0;
globalThis.__snapbackHandlers = {
  async bumpAction(ctx) {
    actionCounter += 1;
    return await ctx.runMutation('recordCount', { n: actionCounter });
  },
  async recordCount(ctx, args) {
    return await ctx.db.insert('counts', { n: args.n });
  },
  async listCounts(ctx) {
    return await ctx.db.query('counts').order('_createdAt', 'asc').collect();
  }
};
"#;

fn action_functions() -> FunctionManifest {
    let module = |export: &str| IbexModule {
        source: ACTION_MODULE_SOURCE.to_owned(),
        export: export.to_owned(),
    };
    let mut manifest = FunctionManifest {
        functions: vec![
            FunctionDefinition::new(
                "bumpAction",
                FunctionKind::Action,
                FunctionRuntime::IbexModule(module("bumpAction")),
            ),
            FunctionDefinition::new(
                "recordCount",
                FunctionKind::Mutation,
                FunctionRuntime::IbexModule(module("recordCount")),
            ),
            FunctionDefinition::new(
                "listCounts",
                FunctionKind::Query,
                FunctionRuntime::IbexModule(module("listCounts")),
            ),
        ],
        ..FunctionManifest::default()
    };
    manifest.cron_jobs = vec![CronJobDefinition {
        name: "dk4Bump".to_owned(),
        schedule: CronSchedule {
            every_ms: Some(60_000),
            cron: None,
        },
        action: "bumpAction".to_owned(),
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
        required_capabilities: vec!["cron".to_owned(), "cron_action_run_mutation".to_owned()],
        target_wakeup: None,
        source_span: None,
    }];
    manifest
}
