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
globalThis.DK4_BASELINE = "original";
globalThis.__snapbackHandlers = {
  async count(ctx) { moduleCounter += 1; return [{ n: moduleCounter }]; },
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
    SchemaManifest {
        schema_hash: Some("dk4-v0".to_owned()),
        tables: vec![TableManifest {
            name: "counts".to_owned(),
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
    }
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
    assert_eq!(row["leak"], "undefined", "string-keyed global must be swept: {row:?}");
    assert_eq!(row["sym"], "undefined", "symbol-keyed global must be swept: {row:?}");
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
    assert_eq!(row["protoClean"], true, "Object.prototype addition must be swept: {row:?}");
    assert_eq!(row["mapResult"], "ab", "Array.prototype.map must be restored: {row:?}");
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
    assert_eq!(row["fire"], "undefined", "the stored resolver must be swept: {row:?}");
    assert_eq!(row["fired"], "undefined", "the dangling reaction must never fire: {row:?}");
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
    assert_eq!(ns, vec![1, 2], "mutations must reuse one warm VM (module counter advances)");
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
    assert_eq!(count(&snapback), 1, "load_functions must clear the warm pool");
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
    assert_eq!(inspect.capability_manifest.vm_lifecycle, "warm-pooled-reset");
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
