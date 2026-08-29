use serde_json::{Map, Value, json};
use snapback::cron::{CronActivationState, CronRunOutcome};
use snapback::ephemeral::{
    AuthContext, ClientEphemeralOverlay, EphemeralCollection, EphemeralErrorCode, EphemeralMessage,
    LocalEphemeralBackend, OverlayApply, PublishRequest, RealtimeEnvelope, Scope, SubscribeRequest,
};
use snapback::local::{LiveResumeInput, LiveSubscribeInput, LiveUnsubscribeInput, LocalSnapback};
use snapback::manifest::{
    ActionPlan, ActionReturnValue, ActionStep, AuthInput, ConfigEntryDefinition,
    CronActivationKind, CronActivationPolicy, CronJitterPolicy, CronJobDefinition,
    CronOverlapPolicy, CronRetryMode, CronRetryPolicy, CronSchedule, FieldManifest, FieldType,
    FilterExpr, FilterOp, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime,
    HandlerInput, HandlerPlan, IbexModule, IndexManifest, MutationPlan, MutationStep,
    OrderDirection, OrderExpr, PermissionScopeExpr, QueryPlan, ReadDependency, ReturnValue,
    SchemaManifest, SeedData, TableManifest, ValueExpr,
};
use snapback::runtime::CapabilityState;
use snapback_kernel::storage::{
    BufferedWrite, CapturedReadDependency, CapturedReadKind, ChangeOp, LocalDatabase,
};
use std::collections::BTreeMap;
use std::process::Command;
use std::thread;
use std::time::Duration;

// @ref LLP 0316#phase-2--test-currency — generated, gitignored demo fixtures
// stay runtime preconditions of the tests that consume them, not crate inputs.
fn read_generated_demo_fixture(relative_path: &str, demo_name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join(relative_path);
    std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "failed to read generated demo fixture at {}: {error}\n\
             run from the repository root: node packages/snapback-codegen/index.mjs demos/{demo_name}/snapback\n\
             generated demo outputs are gitignored; this test reads them at run time so a missing fixture fails only this test instead of breaking the crate's compilation (LLP 0316 Phase 2)",
            path.display()
        )
    })
}

#[test]
fn local_sqlite_host_plan_runs_todo_live_query_and_mutation() {
    let mut snapback = configured_snapback();

    let subscription = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe live query");
    assert_eq!(
        subscription.snapshot.as_ref().unwrap().rows,
        Vec::<Value>::new()
    );

    let mutation = snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "Buy milk" }), "user_1"),
        )
        .expect("create todo");
    let todo_id = mutation
        .result
        .as_str()
        .expect("mutation returns inserted id")
        .to_owned();
    assert_eq!(mutation.version, 1);
    assert_eq!(mutation.changed_count, 1);

    let query = snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect("query todos");
    assert_eq!(query.rows.len(), 1);
    assert_eq!(query.rows[0]["_id"], todo_id);
    assert_eq!(query.rows[0]["title"], "Buy milk");
    assert_eq!(query.rows[0]["completed"], false);

    let messages = snapback.drain_outbox("client_a");
    assert_eq!(messages.len(), 1);
    let RealtimeEnvelope::Durable(message) = &messages[0] else {
        panic!("expected durable live update");
    };
    let update: Value = serde_json::from_slice(&message.payload).expect("live update json");
    assert_eq!(update["kind"], "live_replace");
    assert_eq!(update["subscription_id"], subscription.subscription_id);
    assert_eq!(update["rows"].as_array().unwrap().len(), 1);
}

#[test]
fn ibex_ctx_db_handlers_run_todo_query_mutation_and_live_update() {
    let mut snapback = configured_ibex_snapback(TODO_HANDLER_SOURCE);

    let subscription = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe live query");
    assert_eq!(
        subscription.snapshot.as_ref().unwrap().rows,
        Vec::<Value>::new()
    );

    let mutation = snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "Write a handler" }), "user_1"),
        )
        .expect("run ibex mutation");
    let todo_id = mutation.result.as_str().expect("inserted id").to_owned();
    assert_eq!(mutation.changed_count, 1);

    let query = snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect("run ibex query");
    assert_eq!(query.rows.len(), 1);
    assert_eq!(query.rows[0]["_id"], todo_id);
    assert_eq!(query.rows[0]["title"], "Write a handler");
    assert_eq!(query.rows[0]["completed"], false);
    assert_eq!(query.rows[0]["userId"], "user_1");

    let messages = snapback.drain_outbox("client_a");
    assert_eq!(messages.len(), 1);
    let RealtimeEnvelope::Durable(message) = &messages[0] else {
        panic!("expected durable live update");
    };
    let update: Value = serde_json::from_slice(&message.payload).expect("live update json");
    assert_eq!(update["kind"], "live_replace");
    assert_eq!(update["rows"].as_array().unwrap().len(), 1);
}

/// LLP 0246 rollouts 1-2: codegen erases a typed single-file handler and the
/// exact emitted JavaScript executes in Hermes. This is intentionally a real
/// codegen -> generated manifest -> runtime invocation seam, not a hand-copied
/// JavaScript transform fixture.
#[test]
fn typescript_handler_codegen_executes_emitted_javascript_in_hermes() {
    let root = std::path::PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let codegen = root.join("packages/snapback-codegen/index.mjs");
    let define = root.join("packages/snapback-codegen/define.mjs");
    let define_url = format!(
        "file://{}",
        define
            .to_string_lossy()
            .replace('%', "%25")
            .replace(' ', "%20")
            .replace('#', "%23")
            .replace('?', "%3F")
    );
    let fixture = tempfile::tempdir().expect("temporary TypeScript handler app");
    std::fs::write(
        fixture.path().join("schema.mjs"),
        format!(
            "import {{ defineSchema }} from '{define_url}';\n\
             export default defineSchema({{}});\n"
        ),
    )
    .expect("write schema source");
    std::fs::write(
        fixture.path().join("functions.mjs"),
        format!(
            "import {{ defineAction, v }} from '{define_url}';\n\
             export const typedProbe = defineAction({{\n\
               args: {{ value: v.string() }},\n\
               js: {{ source: 'typed-probe.ts', exportName: 'typedProbe' }},\n\
             }});\n"
        ),
    )
    .expect("write functions source");
    std::fs::write(
        fixture.path().join("typed-probe.ts"),
        r#"interface ProbeArgs { value: string }
interface ProbeResult { echoed: string; count: number }
globalThis.__snapbackHandlers = {
  async typedProbe(_ctx: unknown, args: ProbeArgs): Promise<ProbeResult> {
    const echoed: string = args.value.toUpperCase();
    return { echoed, count: echoed.length };
  },
};
"#,
    )
    .expect("write typed handler source");

    let output = Command::new("node")
        .arg(&codegen)
        .arg(fixture.path())
        .output()
        .expect("run snapback-codegen");
    assert!(
        output.status.success(),
        "TypeScript handler codegen failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );

    let generated = fixture.path().join("generated");
    let schema: SchemaManifest = serde_json::from_slice(
        &std::fs::read(generated.join("schema.manifest.json")).expect("read generated schema"),
    )
    .expect("decode generated schema");
    let functions: FunctionManifest = serde_json::from_slice(
        &std::fs::read(generated.join("functions.manifest.json"))
            .expect("read generated functions"),
    )
    .expect("decode generated functions");
    let typed_probe = functions
        .functions
        .iter()
        .find(|function| function.name == "typedProbe")
        .expect("generated typedProbe function");
    let FunctionRuntime::IbexModule(module) = &typed_probe.runtime else {
        panic!("typedProbe must be emitted as an Ibex module");
    };
    assert!(!module.source.contains("ProbeArgs"));
    assert!(!module.source.contains(": string"));
    assert!(module.source.contains("async typedProbe(_ctx, args)"));

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback
        .apply_schema(schema)
        .expect("apply generated schema");
    let diagnostics = snapback.load_functions(functions);
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED"),
        "generated typed handler must load: {diagnostics:?}"
    );
    let result = snapback.run_function(
        "typedProbe",
        input(json!({ "value": "hermes" }), "typescript-test"),
    );
    assert!(result.ok, "typed handler invocation failed: {result:?}");
    assert_eq!(
        result.result,
        Some(json!({ "echoed": "HERMES", "count": 6 }))
    );
}

#[test]
fn live_matcher_skips_user_scoped_disjoint_mutations() {
    let mut snapback = configured_ibex_snapback(TODO_HANDLER_SOURCE);

    let ada = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "ada_client".to_owned(),
                input: input(json!({}), "cron"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("ada subscribe");
    assert_eq!(ada.snapshot.as_ref().unwrap().rows.len(), 0);

    let grace = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "grace_client".to_owned(),
                input: input(json!({}), "user_2"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("grace subscribe");
    assert_eq!(grace.snapshot.as_ref().unwrap().rows.len(), 0);

    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "Grace only" }), "user_2"),
        )
        .expect("create grace todo");

    assert_eq!(snapback.drain_outbox("ada_client"), Vec::new());
    let grace_messages = snapback.drain_outbox("grace_client");
    assert_eq!(grace_messages.len(), 1);
    let RealtimeEnvelope::Durable(message) = &grace_messages[0] else {
        panic!("expected durable grace update");
    };
    let update: Value = serde_json::from_slice(&message.payload).expect("live update json");
    assert_eq!(update["subscription_id"], grace.subscription_id);
    assert_eq!(update["rows"].as_array().unwrap().len(), 1);

    let inspect = snapback.inspect().expect("inspect live delivery stats");
    assert_eq!(inspect.live_delivery.last_fanout_subscriptions, 2);
    assert_eq!(inspect.live_delivery.last_deliveries, 1);
    assert_eq!(inspect.live_delivery.last_skipped, 1);
}

#[test]
fn live_matcher_skips_hidden_row_patches_and_deletes() {
    let mut snapback = configured_ibex_snapback(TODO_HANDLER_SOURCE);
    let created = snapback
        .invoke_mutation("createTodo", input(json!({ "title": "Hidden" }), "user_2"))
        .expect("create hidden todo");
    let hidden_id = created.result.as_str().unwrap().to_owned();

    snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "ada_client".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("ada subscribe");

    snapback
        .invoke_mutation(
            "setCompleted",
            input(json!({ "id": hidden_id, "completed": true }), "user_2"),
        )
        .expect("patch hidden row");
    assert_eq!(snapback.drain_outbox("ada_client"), Vec::new());
    let inspect = snapback.inspect().expect("inspect hidden patch skip");
    assert_eq!(inspect.live_delivery.last_deliveries, 0);
    assert_eq!(inspect.live_delivery.last_skipped, 1);

    snapback
        .invoke_mutation("deleteTodo", input(json!({ "id": hidden_id }), "user_2"))
        .expect("delete hidden row");
    assert_eq!(snapback.drain_outbox("ada_client"), Vec::new());
    let inspect = snapback.inspect().expect("inspect hidden delete skip");
    assert_eq!(inspect.live_delivery.last_deliveries, 0);
    assert_eq!(inspect.live_delivery.last_skipped, 1);
}

#[test]
fn zero_change_mutation_does_not_fan_out_or_count_delivery_attempts() {
    let mut functions = todo_functions();
    functions.functions.push(FunctionDefinition::new(
        "noOp",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: Vec::new(),
            return_value: Some(ReturnValue::ChangedCount),
        })),
    ));

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("schema");
    snapback.load_functions(functions);
    snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe");

    let output = snapback
        .invoke_mutation("noOp", input(json!({}), "user_1"))
        .expect("no-op mutation");
    assert_eq!(output.changed_count, 0);
    assert_eq!(snapback.drain_outbox("client"), Vec::new());
    let inspect = snapback.inspect().expect("inspect live stats");
    assert_eq!(inspect.live_delivery.total_fanout_attempts, 0);
    assert_eq!(inspect.live_delivery.last_fanout_subscriptions, 0);
    assert_eq!(inspect.live_delivery.last_deliveries, 0);
    assert_eq!(inspect.live_delivery.last_skipped, 0);
}

#[test]
fn live_matcher_keeps_unmarked_ibex_queries_conservative() {
    let mut functions = ibex_todo_functions(ALL_TODOS_HANDLER_SOURCE);
    let list = functions
        .functions
        .iter_mut()
        .find(|function| function.name == "listTodos")
        .expect("listTodos function");
    list.read_set_summary.auth_scope_field = None;

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(functions);
    snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "ada_client".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("ada subscribe");

    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "Visible to all" }), "user_2"),
        )
        .expect("create other-user todo");

    let messages = snapback.drain_outbox("ada_client");
    assert_eq!(messages.len(), 1);
    let inspect = snapback.inspect().expect("inspect conservative delivery");
    assert_eq!(inspect.live_delivery.last_deliveries, 1);
    assert_eq!(inspect.live_delivery.last_skipped, 0);
}

#[test]
fn live_matcher_uses_captured_equality_predicates_beyond_auth_scope() {
    let mut functions = ibex_todo_functions(COMPLETED_TODOS_HANDLER_SOURCE);
    let list = functions
        .functions
        .iter_mut()
        .find(|function| function.name == "listTodos")
        .expect("listTodos function");
    list.read_set_summary.auth_scope_field = None;

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(functions);
    snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe completed todos");

    let created = snapback
        .invoke_mutation(
            "createTodo",
            input(
                json!({ "title": "Still open", "completed": false }),
                "user_1",
            ),
        )
        .expect("create incomplete todo");
    let todo_id = created.result.as_str().unwrap().to_owned();
    assert_eq!(snapback.drain_outbox("client_a"), Vec::new());
    let inspect = snapback.inspect().expect("inspect incomplete skip");
    assert_eq!(inspect.live_delivery.last_deliveries, 0);
    assert_eq!(inspect.live_delivery.last_skipped, 1);

    snapback
        .invoke_mutation(
            "setCompleted",
            input(json!({ "id": todo_id, "completed": true }), "user_1"),
        )
        .expect("complete todo");
    let messages = snapback.drain_outbox("client_a");
    assert_eq!(messages.len(), 1);
    let RealtimeEnvelope::Durable(message) = &messages[0] else {
        panic!("expected durable completion update");
    };
    let update: Value = serde_json::from_slice(&message.payload).expect("live update json");
    assert_eq!(update["rows"].as_array().unwrap().len(), 1);
    assert_eq!(update["rows"][0]["completed"], true);
    let inspect = snapback.inspect().expect("inspect completion delivery");
    assert_eq!(inspect.live_delivery.last_deliveries, 1);
    assert_eq!(inspect.live_delivery.last_skipped, 0);
}

/// ENG-23420: an Ibex live query that point-reads a row (`ctx.db.get`) and
/// folds it into its result must be woken when that row changes, even when the
/// change is disjoint from every captured query predicate. Previously the
/// dependency gate consulted only `Query` dependencies, skipped the
/// subscription, and the client stayed permanently stale.
#[test]
fn live_matcher_wakes_ibex_point_read_dependency() {
    let mut functions = ibex_todo_functions(PINNED_TODOS_HANDLER_SOURCE);
    let list = functions
        .functions
        .iter_mut()
        .find(|function| function.name == "listTodos")
        .expect("listTodos function");
    list.read_set_summary.auth_scope_field = None;
    let mut set_title = FunctionDefinition::new(
        "setTitle",
        FunctionKind::Mutation,
        FunctionRuntime::IbexModule(IbexModule {
            source: PINNED_TODOS_HANDLER_SOURCE.to_owned(),
            export: "setTitle".to_owned(),
        }),
    );
    set_title.required_capabilities = vec![
        "ibex_ctx_db_host_bridge".to_owned(),
        "mutation_read_set_validation".to_owned(),
    ];
    set_title.write_set_summary.primary_table = Some("todos".to_owned());
    set_title.write_set_summary.tables = vec!["todos".to_owned()];
    set_title.write_set_summary.mode = Some("handlerDeclared".to_owned());
    functions.functions.push(set_title);

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(functions);

    let pinned = snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "Pinned", "completed": false }), "user_1"),
        )
        .expect("create pinned todo");
    let pinned_id = pinned.result.as_str().unwrap().to_owned();
    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "Member", "completed": true }), "user_1"),
        )
        .expect("create member todo");

    snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({ "pinnedId": pinned_id }), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe pinned todos");
    snapback.drain_outbox("client_a");

    // Retitle the pinned row. It fails the query's `completed = true`
    // predicate and the patch does not touch a filter field, so only the
    // captured Row dependency can wake the subscription.
    snapback
        .invoke_mutation(
            "setTitle",
            input(json!({ "id": pinned_id, "title": "Pinned v2" }), "user_1"),
        )
        .expect("retitle pinned todo");

    let messages = snapback.drain_outbox("client_a");
    assert_eq!(messages.len(), 1, "point-read change must be delivered");
    let RealtimeEnvelope::Durable(message) = &messages[0] else {
        panic!("expected durable live update");
    };
    let update: Value = serde_json::from_slice(&message.payload).expect("live update json");
    assert_eq!(update["rows"].as_array().unwrap().len(), 1);
    assert_eq!(update["rows"][0]["pinnedTitle"], "Pinned v2");
    let inspect = snapback.inspect().expect("inspect point-read delivery");
    assert_eq!(inspect.live_delivery.last_deliveries, 1);
    assert_eq!(inspect.live_delivery.last_skipped, 0);
}

#[test]
fn live_matcher_uses_captured_in_predicates() {
    let mut functions = ibex_todo_functions(IN_TODOS_HANDLER_SOURCE);
    let list = functions
        .functions
        .iter_mut()
        .find(|function| function.name == "listTodos")
        .expect("listTodos function");
    list.read_set_summary.auth_scope_field = None;

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(functions);
    snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe completed todos");

    let created = snapback
        .invoke_mutation(
            "createTodo",
            input(
                json!({ "title": "Still open", "completed": false }),
                "user_1",
            ),
        )
        .expect("create incomplete todo");
    let todo_id = created.result.as_str().unwrap().to_owned();
    assert_eq!(snapback.drain_outbox("client_a"), Vec::new());
    let inspect = snapback.inspect().expect("inspect incomplete skip");
    assert_eq!(inspect.live_delivery.last_deliveries, 0);
    assert_eq!(inspect.live_delivery.last_skipped, 1);

    snapback
        .invoke_mutation(
            "setCompleted",
            input(json!({ "id": todo_id, "completed": true }), "user_1"),
        )
        .expect("complete todo");
    let messages = snapback.drain_outbox("client_a");
    assert_eq!(messages.len(), 1);
    let RealtimeEnvelope::Durable(message) = &messages[0] else {
        panic!("expected durable completion update");
    };
    let update: Value = serde_json::from_slice(&message.payload).expect("live update json");
    assert_eq!(update["rows"].as_array().unwrap().len(), 1);
    assert_eq!(update["rows"][0]["_id"], todo_id);
    assert_eq!(update["rows"][0]["completed"], true);
    let inspect = snapback.inspect().expect("inspect completion delivery");
    assert_eq!(inspect.live_delivery.last_deliveries, 1);
    assert_eq!(inspect.live_delivery.last_skipped, 0);
}

#[test]
fn live_matcher_uses_captured_range_predicates() {
    let mut functions = ibex_todo_functions(RANGE_TODOS_HANDLER_SOURCE);
    let list = functions
        .functions
        .iter_mut()
        .find(|function| function.name == "listTodos")
        .expect("listTodos function");
    list.read_set_summary.auth_scope_field = None;

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(functions);
    snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe ranked todos");

    let created = snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "Too low", "rank": 5 }), "user_1"),
        )
        .expect("create below range");
    let todo_id = created.result.as_str().unwrap().to_owned();
    assert_eq!(snapback.drain_outbox("client_a"), Vec::new());
    let inspect = snapback.inspect().expect("inspect range skip");
    assert_eq!(inspect.live_delivery.last_deliveries, 0);
    assert_eq!(inspect.live_delivery.last_skipped, 1);

    snapback
        .invoke_mutation(
            "setCompleted",
            input(
                json!({ "id": todo_id, "completed": false, "rank": 12 }),
                "user_1",
            ),
        )
        .expect("move into range");
    let messages = snapback.drain_outbox("client_a");
    assert_eq!(messages.len(), 1);
    let RealtimeEnvelope::Durable(message) = &messages[0] else {
        panic!("expected durable range update");
    };
    let update: Value = serde_json::from_slice(&message.payload).expect("live update json");
    assert_eq!(update["rows"].as_array().unwrap().len(), 1);
    assert_eq!(update["rows"][0]["_id"], todo_id);
    assert_eq!(update["rows"][0]["rank"], 12);
}

#[test]
fn live_matcher_uses_limited_order_boundaries() {
    let mut functions = ibex_todo_functions(LIMITED_RANK_TODOS_HANDLER_SOURCE);
    let list = functions
        .functions
        .iter_mut()
        .find(|function| function.name == "listTodos")
        .expect("listTodos function");
    list.read_set_summary.auth_scope_field = None;

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(functions);
    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "One", "rank": 1 }), "user_1"),
        )
        .expect("create rank 1");
    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "Two", "rank": 2 }), "user_1"),
        )
        .expect("create rank 2");
    let outside = snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "Outside", "rank": 4 }), "user_1"),
        )
        .expect("create rank 4");
    let outside_id = outside.result.as_str().unwrap().to_owned();

    let subscription = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe limited ranked todos");
    assert_eq!(
        subscription
            .snapshot
            .as_ref()
            .unwrap()
            .rows
            .iter()
            .map(|row| row["rank"].as_i64().unwrap())
            .collect::<Vec<_>>(),
        vec![1, 2]
    );

    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "After boundary", "rank": 6 }), "user_1"),
        )
        .expect("create after boundary");
    assert_eq!(snapback.drain_outbox("client_a"), Vec::new());
    let inspect = snapback.inspect().expect("inspect boundary insert skip");
    assert_eq!(inspect.live_delivery.last_deliveries, 0);
    assert_eq!(inspect.live_delivery.last_skipped, 1);

    snapback
        .invoke_mutation(
            "setCompleted",
            input(
                json!({ "id": outside_id, "completed": false, "rank": 5 }),
                "user_1",
            ),
        )
        .expect("move outside row farther after boundary");
    assert_eq!(snapback.drain_outbox("client_a"), Vec::new());
    let inspect = snapback.inspect().expect("inspect boundary update skip");
    assert_eq!(inspect.live_delivery.last_deliveries, 0);
    assert_eq!(inspect.live_delivery.last_skipped, 1);

    snapback
        .invoke_mutation(
            "setCompleted",
            input(
                json!({ "id": outside_id, "completed": false, "rank": 0 }),
                "user_1",
            ),
        )
        .expect("move outside row before boundary");
    let messages = snapback.drain_outbox("client_a");
    assert_eq!(messages.len(), 1);
    let RealtimeEnvelope::Durable(message) = &messages[0] else {
        panic!("expected durable boundary update");
    };
    let update: Value = serde_json::from_slice(&message.payload).expect("live update json");
    assert_eq!(
        update["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["rank"].as_i64().unwrap())
            .collect::<Vec<_>>(),
        vec![0, 1]
    );
}

#[test]
fn permission_epoch_resync_suppresses_stale_live_replace() {
    let mut functions = ibex_todo_functions(TODO_HANDLER_SOURCE);
    let mut permission_change = FunctionDefinition::new(
        "touchPermissions",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Patch {
                table: "todos".to_owned(),
                id: ValueExpr::Arg("id".to_owned()),
                values: BTreeMap::from([("title".to_owned(), ValueExpr::Arg("title".to_owned()))]),
            }],
            return_value: Some(ReturnValue::ChangedCount),
        })),
    );
    permission_change.required_capabilities = vec!["permission_epoch_resync".to_owned()];
    permission_change.permission_epoch_bumps = vec![PermissionScopeExpr::AuthUser];
    permission_change.write_set_summary.primary_table = Some("todos".to_owned());
    permission_change.write_set_summary.tables = vec!["todos".to_owned()];
    functions.functions.push(permission_change);

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(functions);

    let created = snapback
        .invoke_mutation(
            "createTodo",
            input(
                json!({ "title": "Visible before permission change" }),
                "user_1",
            ),
        )
        .expect("create visible todo");
    let todo_id = created.result.as_str().unwrap().to_owned();

    let subscription = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe live query");
    assert_eq!(subscription.snapshot.as_ref().unwrap().rows.len(), 1);
    let other_subscription = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_b".to_owned(),
                input: input(json!({}), "user_2"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe other user");
    assert_eq!(other_subscription.snapshot.as_ref().unwrap().rows.len(), 0);

    snapback
        .invoke_mutation(
            "touchPermissions",
            input(
                json!({ "id": todo_id, "title": "Changed with permission epoch" }),
                "user_1",
            ),
        )
        .expect("touch permission scope");

    let messages = snapback.drain_outbox("client_a");
    assert_eq!(messages.len(), 1);
    let RealtimeEnvelope::Durable(message) = &messages[0] else {
        panic!("expected durable resync message");
    };
    let update: Value = serde_json::from_slice(&message.payload).expect("resync json");
    assert_eq!(update["kind"], "resync_required");
    assert_eq!(update["reason"], "permission_epoch_changed");
    assert_eq!(update["subscription_id"], subscription.subscription_id);
    assert_eq!(update["scope"], "user:user_1");
    assert_eq!(update["epoch"], 1);
    assert_eq!(update["clear_retained"], true);
    assert_eq!(snapback.drain_outbox("client_b"), Vec::new());

    let inspect = snapback.inspect().expect("inspect live delivery stats");
    assert_eq!(inspect.live_delivery.total_fanout_attempts, 2);
    assert_eq!(inspect.live_delivery.last_fanout_subscriptions, 2);
    assert_eq!(inspect.live_delivery.last_deliveries, 1);
    assert_eq!(inspect.live_delivery.last_skipped, 1);
}

/// ENG-23329 — a mutation whose declared permission-epoch scope cannot be
/// evaluated (here `authUser` without an authenticated user) must be rejected
/// BEFORE any write executes. Previously the scope was evaluated only after
/// the durable commit: the rows landed, the receipt said "rejected", the
/// caller got an error, and live subscribers never heard about the committed
/// change.
#[test]
fn permission_epoch_scope_failure_rejects_before_any_write() {
    let mut functions = ibex_todo_functions(TODO_HANDLER_SOURCE);
    let mut epoch_insert = FunctionDefinition::new(
        "createWithEpochBump",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Insert {
                table: "todos".to_owned(),
                values: BTreeMap::from([
                    ("title".to_owned(), ValueExpr::Arg("title".to_owned())),
                    (
                        "completed".to_owned(),
                        ValueExpr::Literal(Value::Bool(false)),
                    ),
                    (
                        "userId".to_owned(),
                        ValueExpr::Literal(Value::String("user_1".to_owned())),
                    ),
                ]),
                bind_id_as: None,
            }],
            return_value: Some(ReturnValue::ChangedCount),
        })),
    );
    epoch_insert.required_capabilities = vec!["permission_epoch_resync".to_owned()];
    epoch_insert.permission_epoch_bumps = vec![PermissionScopeExpr::AuthUser];
    epoch_insert.write_set_summary.primary_table = Some("todos".to_owned());
    epoch_insert.write_set_summary.tables = vec!["todos".to_owned()];
    functions.functions.push(epoch_insert);

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(functions);

    let subscription = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe live query");
    assert_eq!(subscription.snapshot.as_ref().unwrap().rows.len(), 0);

    let unauthenticated = HandlerInput {
        args: json!({ "title": "No auth user" }),
        auth: AuthInput {
            principal: None,
            session_id: None,
            user_id: None,
            ..AuthInput::default()
        },
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    };
    let (result, receipt) =
        snapback.invoke_mutation_recording("createWithEpochBump", unauthenticated);
    let receipt = receipt.into_value();
    let error = result.expect_err("unevaluable permission scope must reject the mutation");
    assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_USER_MISSING");
    assert_eq!(receipt["outcome"], "rejected");
    assert_eq!(receipt["rollbackReason"], "SNAPBACK_AUTH_USER_MISSING");

    // The rejection happened before any write: nothing committed, and no live
    // update or resync reached the subscriber.
    let query = snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect("list todos");
    assert_eq!(query.rows.len(), 0);
    assert_eq!(snapback.drain_outbox("client_a"), Vec::new());

    // The same mutation with an authenticated user still commits, bumps the
    // epoch, and fans out to the live subscriber.
    let committed = snapback
        .invoke_mutation(
            "createWithEpochBump",
            input(json!({ "title": "With auth user" }), "user_1"),
        )
        .expect("authenticated mutation commits");
    assert_eq!(committed.changed_count, 1);
    assert!(!snapback.drain_outbox("client_a").is_empty());
}

#[test]
fn live_resume_resnapshots_when_recorded_permission_epoch_is_stale() {
    let mut functions = ibex_todo_functions(TODO_HANDLER_SOURCE);
    let mut permission_change = FunctionDefinition::new(
        "touchPermissions",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Patch {
                table: "todos".to_owned(),
                id: ValueExpr::Arg("id".to_owned()),
                values: BTreeMap::from([("title".to_owned(), ValueExpr::Arg("title".to_owned()))]),
            }],
            return_value: Some(ReturnValue::ChangedCount),
        })),
    );
    permission_change.required_capabilities = vec!["permission_epoch_resync".to_owned()];
    permission_change.permission_epoch_bumps = vec![PermissionScopeExpr::AuthUser];
    permission_change.write_set_summary.primary_table = Some("todos".to_owned());
    permission_change.write_set_summary.tables = vec!["todos".to_owned()];
    functions.functions.push(permission_change);

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(functions);

    let created = snapback
        .invoke_mutation(
            "createTodo",
            input(
                json!({ "title": "Visible before permission change" }),
                "user_1",
            ),
        )
        .expect("create visible todo");
    let todo_id = created.result.as_str().unwrap().to_owned();

    let subscription = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe live query");
    assert_eq!(
        subscription.snapshot.as_ref().unwrap().rows[0]["title"],
        "Visible before permission change"
    );
    assert_eq!(subscription.permission_epochs.get("user:user_1"), Some(&0));

    snapback
        .invoke_mutation(
            "touchPermissions",
            input(
                json!({ "id": todo_id, "title": "Changed with permission epoch" }),
                "user_1",
            ),
        )
        .expect("touch permission scope");

    let messages = snapback.drain_outbox("client_a");
    assert_eq!(messages.len(), 1);
    let RealtimeEnvelope::Durable(message) = &messages[0] else {
        panic!("expected durable resync message");
    };
    let update: Value = serde_json::from_slice(&message.payload).expect("resync json");
    assert_eq!(update["kind"], "resync_required");

    let resume = snapback
        .resume_live(
            "listTodos",
            LiveResumeInput {
                subscription_id: subscription.subscription_id.clone(),
                connection_id: "client_reconnected".to_owned(),
                auth: auth("user_1"),
                recorded_permission_epochs: subscription.permission_epochs,
            },
        )
        .expect("resume stale subscription");

    assert_eq!(resume.subscription_id, subscription.subscription_id);
    assert_eq!(resume.mode, "resnapshot");
    assert_eq!(resume.reason.as_deref(), Some("permission_epoch_changed"));
    assert_eq!(resume.permission_epochs.get("user:user_1"), Some(&1));
    let snapshot = resume.snapshot.expect("stale resume returns snapshot");
    assert_eq!(snapshot.rows.len(), 1);
    assert_eq!(snapshot.rows[0]["title"], "Changed with permission epoch");

    snapback
        .invoke_mutation(
            "setCompleted",
            input(json!({ "id": todo_id, "completed": true }), "user_1"),
        )
        .expect("normal live update after resume");
    let messages = snapback.drain_outbox("client_reconnected");
    assert_eq!(messages.len(), 1);
    let RealtimeEnvelope::Durable(message) = &messages[0] else {
        panic!("expected durable live update after resume");
    };
    let update: Value = serde_json::from_slice(&message.payload).expect("live update json");
    assert_eq!(update["kind"], "live_replace");
    assert_eq!(update["subscription_id"], subscription.subscription_id);
    assert_eq!(update["rows"][0]["completed"], true);
}

#[test]
fn live_resume_retains_subscription_when_recorded_permission_epoch_is_current() {
    let mut snapback = configured_ibex_snapback(TODO_HANDLER_SOURCE);
    let subscription = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe live query");

    let resume = snapback
        .resume_live(
            "listTodos",
            LiveResumeInput {
                subscription_id: subscription.subscription_id.clone(),
                connection_id: "client_reconnected".to_owned(),
                auth: auth("user_1"),
                recorded_permission_epochs: subscription.permission_epochs,
            },
        )
        .expect("resume current subscription");

    assert_eq!(resume.subscription_id, subscription.subscription_id);
    assert_eq!(resume.mode, "retained");
    assert_eq!(resume.reason, None);
    assert_eq!(resume.snapshot, None);
    assert_eq!(resume.permission_epochs.get("user:user_1"), Some(&0));

    snapback
        .invoke_mutation(
            "createTodo",
            input(
                json!({ "title": "Delivered after retained resume" }),
                "user_1",
            ),
        )
        .expect("create visible todo");
    assert_eq!(snapback.drain_outbox("client_a"), Vec::new());
    let messages = snapback.drain_outbox("client_reconnected");
    assert_eq!(messages.len(), 1);
    let RealtimeEnvelope::Durable(message) = &messages[0] else {
        panic!("expected durable live update after retained resume");
    };
    let update: Value = serde_json::from_slice(&message.payload).expect("live update json");
    assert_eq!(update["kind"], "live_replace");
    assert_eq!(update["subscription_id"], subscription.subscription_id);
    assert_eq!(
        update["rows"][0]["title"],
        "Delivered after retained resume"
    );
}

#[test]
fn function_runner_surfaces_captured_handler_read_and_write_facts() {
    let mut snapback = configured_ibex_snapback(TODO_HANDLER_SOURCE);
    let created = snapback.run_function(
        "createTodo",
        input(json!({ "title": "Capture facts" }), "user_1"),
    );
    let todo_id = created.result.unwrap().as_str().unwrap().to_owned();

    let toggled = snapback.run_function(
        "setCompleted",
        input(json!({ "id": todo_id, "completed": true }), "user_1"),
    );
    assert!(toggled.ok);
    assert_eq!(toggled.changed_count, Some(1));
    assert!(toggled.captured_reads.iter().any(|dependency| {
        dependency.kind == CapturedReadKind::Row
            && dependency.table.as_deref() == Some("todos")
            && dependency.id.as_deref() == Some(todo_id.as_str())
    }));
    assert!(toggled.captured_writes.iter().any(|dependency| {
        dependency.op == ChangeOp::Update && dependency.table == "todos" && dependency.id == todo_id
    }));
}

#[test]
fn function_runner_reports_action_declared_write_tables_not_mutation_names() {
    let mut functions = todo_functions_with_cron(false);
    let action = functions
        .functions
        .iter_mut()
        .find(|function| function.name == "pollTodosAction")
        .expect("poll action");
    action.write_set_summary.primary_table = Some("todos".to_owned());
    action.write_set_summary.tables = vec!["todos".to_owned()];

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("schema");
    snapback.load_functions(functions);

    let result = snapback.run_function("pollTodosAction", input(json!({}), "cron"));
    assert!(result.ok, "{result:?}");
    assert_eq!(result.writes, vec!["todos"]);
}

#[test]
fn ibex_handler_ambient_capability_denial_is_structured() {
    let snapback = configured_ibex_snapback(
        r#"
        globalThis.__snapbackHandlers = {
          async listTodos() {
            return await fetch("https://example.com/");
          },
          async createTodo() {
            return null;
          }
        };
        "#,
    );

    let error = snapback
        .invoke_query("listTodos", input(json!({}), "cron"))
        .expect_err("fetch should be denied");
    assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_CAPABILITY_DENIED");
}

#[test]
fn ibex_handler_error_messages_do_not_spoof_snapback_codes() {
    let snapback = configured_ibex_snapback(
        r#"
        globalThis.__snapbackHandlers = {
          async listTodos() {
            throw new Error("expected SNAPBACK_CONFIG_MISSING to be handled upstream");
          },
          async createTodo() {
            return null;
          }
        };
        "#,
    );

    let error = snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect_err("handler should throw");
    assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_FAILED");
}

#[test]
fn ibex_handler_lone_surrogate_strings_are_sanitized() {
    let snapback = configured_ibex_snapback(
        r#"
        globalThis.__snapbackHandlers = {
          async listTodos() {
            return [
              "\uD800",
              "\uDC00",
              "\uD83D\uDE00",
              "x".repeat(16400) + "\uD800" + "tail",
              { ["\uD800"]: "lone-high-key" },
              { ["\uDC00"]: "lone-low-key" },
              { ["\uD83D\uDE00"]: "valid-pair-key" },
              { ["\\uD800"]: "literal-escape-key" },
              { ["x".repeat(16400) + "\uD800" + "tail"]: "long-key" }
            ];
          },
          async createTodo() {
            return null;
          }
        };
        "#,
    );

    let output = snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect("lone surrogate should not break JSON transport");
    assert_eq!(
        output.rows,
        vec![
            json!("\u{FFFD}"),
            json!("\u{FFFD}"),
            json!("😀"),
            json!(format!("{}\u{FFFD}tail", "x".repeat(16_400))),
            json!({ "\u{FFFD}": "lone-high-key" }),
            json!({ "\u{FFFD}": "lone-low-key" }),
            json!({ "😀": "valid-pair-key" }),
            json!({ "\\uD800": "literal-escape-key" }),
            json!({ format!("{}\u{FFFD}tail", "x".repeat(16_400)): "long-key" }),
        ]
    );
}

#[test]
fn cron_tick_runs_host_action_through_mutation_and_live_delivery() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(todo_functions_with_cron(false));

    let subscription = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "cron"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe live query");
    assert_eq!(subscription.snapshot.as_ref().unwrap().rows.len(), 0);

    let runs = snapback.tick_cron(0).expect("tick cron at epoch");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].job_name, "pollTodos");
    assert_eq!(runs[0].outcome, CronRunOutcome::Succeeded);
    assert_eq!(runs[0].scheduled_at_ms, Some(0));
    assert_eq!(runs[0].due_at_ms, 0);
    assert_eq!(runs[0].idempotency_key, "cron:pollTodos:scheduled:0");

    let query = snapback
        .invoke_query("listTodos", input(json!({}), "cron"))
        .expect("query after cron");
    assert_eq!(query.rows.len(), 1);
    assert_eq!(query.rows[0]["title"], "From cron");
    assert_eq!(query.rows[0]["userId"], "cron");

    let messages = snapback.drain_outbox("client_a");
    assert_eq!(messages.len(), 1, "cron mutation fans out like any write");

    let inspect = snapback.inspect().expect("inspect cron state");
    let job = inspect
        .cron
        .jobs
        .iter()
        .find(|job| job.name == "pollTodos")
        .expect("cron job inspect");
    assert_eq!(job.jitter_offset_ms, 0);
    assert_eq!(job.next_nominal_at_ms, Some(60_000));
    assert_eq!(job.next_due_at_ms, Some(60_000));
    assert_eq!(job.last_outcome, Some(CronRunOutcome::Succeeded));
    assert!(inspect.capability_manifest.cron);
    assert!(!inspect.capability_gaps.contains(&"cron".to_owned()));
}

#[test]
fn cron_demand_gating_and_default_jitter_are_visible_in_inspect() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(todo_functions_with_cron(true));

    let inactive = snapback.tick_cron(0).expect("inactive demand tick");
    assert!(inactive.is_empty());
    let inspect = snapback.inspect().expect("inspect inactive cron");
    let job = inspect
        .cron
        .jobs
        .iter()
        .find(|job| job.name == "pollTodos")
        .expect("cron job inspect");
    assert_eq!(job.activation_state, CronActivationState::InactiveNoDemand);
    assert!(job.jitter_policy.enabled);
    assert!(job.jitter_offset_ms <= 6_000);

    snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe activates demand-gated cron");
    let runs = snapback.tick_cron(6_000).expect("armed demand tick");
    assert_eq!(runs.len(), 1);
    let inspect = snapback.inspect().expect("inspect armed cron");
    let job = inspect
        .cron
        .jobs
        .iter()
        .find(|job| job.name == "pollTodos")
        .expect("cron job inspect");
    assert_eq!(job.activation_state, CronActivationState::Armed);
}

/// LLP 0032 L5 — the ticker's lock-skip flag tracks arming, not just presence:
/// a demand-gated cron job with no watcher is unarmed (flag off → the ticker
/// skips the lock), subscribing arms it, and disconnecting the last watcher
/// disarms it again.
#[test]
fn l5_cron_activity_flag_tracks_arming() {
    use std::sync::atomic::Ordering;
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(todo_functions_with_cron(true));
    let flag = snapback.cron_activity_flag();

    // Loaded but no watcher → unarmed → the ticker skips the global lock.
    assert!(!flag.load(Ordering::Relaxed));

    snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "watcher".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe arms the demand-gated cron");
    assert!(
        flag.load(Ordering::Relaxed),
        "a watcher must arm the ticker"
    );

    snapback.disconnect("watcher", 1_000);
    assert!(
        !flag.load(Ordering::Relaxed),
        "losing the last watcher disarms the ticker"
    );
}

#[test]
fn ibex_action_can_call_run_mutation_with_cron_metadata() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(ibex_action_cron_functions());

    let record = snapback
        .run_cron_job_now("pollTodos", 123_000)
        .expect("manual cron run");
    assert_eq!(record.outcome, CronRunOutcome::Succeeded);
    assert_eq!(record.slot_key, "cron:pollTodos:manual:123000");

    let query = snapback
        .invoke_query("listTodos", input(json!({}), "cron"))
        .expect("query after ibex action");
    assert_eq!(query.rows.len(), 1);
    assert_eq!(query.rows[0]["title"], "JS pollTodos");
}

#[test]
fn cron_detached_rejection_is_scrubbed_before_any_diagnostic_retention() {
    const SECRET: &str = "cron-secret-must-never-escape";
    const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async leakingCron(ctx) {
    const secret = ctx.secrets.get('cronKey').expose();
    Promise.resolve().then(() => { throw new Error(`detached ${secret}`); });
    return { settled: true };
  }
};
"#;
    let mut action = FunctionDefinition::new(
        "leakingCron",
        FunctionKind::Action,
        FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: "leakingCron".to_owned(),
        }),
    );
    action.uses = vec!["cronKey".to_owned()];
    let manifest = FunctionManifest {
        functions: vec![action],
        config: vec![ConfigEntryDefinition {
            name: "cronKey".to_owned(),
            description: None,
            purpose: None,
            secret: true,
            required: false,
            pool: false,
            probe: None,
            how_to_get: None,
            acquisition: None,
            default: None,
            source_span: None,
        }],
        cron_jobs: vec![CronJobDefinition {
            name: "leakingCronJob".to_owned(),
            schedule: CronSchedule {
                every_ms: Some(60_000),
                cron: None,
            },
            action: "leakingCron".to_owned(),
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
            required_capabilities: vec![],
            target_wakeup: None,
            source_span: None,
        }],
        ..FunctionManifest::default()
    };
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("schema");
    let diagnostics = snapback.load_functions(manifest);
    assert!(
        diagnostics.iter().all(|diagnostic| {
            diagnostic.severity != snapback::diagnostic::DiagnosticSeverity::Error
        }),
        "unexpected load diagnostics: {diagnostics:?}"
    );
    snapback
        .set_config_entry("cronKey", vec![SECRET.to_owned()], false, "test")
        .expect("set cron secret");

    let record = snapback
        .run_cron_job_now("leakingCronJob", 123_000)
        .expect("manual cron run records handler failure");
    assert_eq!(record.outcome, CronRunOutcome::Failed);
    let record_json = serde_json::to_string(&record).unwrap();
    assert!(!record_json.contains(SECRET), "{record_json}");
    assert!(record_json.contains("[REDACTED]"), "{record_json}");

    let gated = snapback.inspect().expect("gated inspect");
    let gated_json = serde_json::to_string(&gated).unwrap();
    assert!(!gated_json.contains(SECRET), "{gated_json}");
    let public = snapback::local::PublicInspect::from(gated);
    let public_json = serde_json::to_string(&public).unwrap();
    assert!(!public_json.contains(SECRET), "{public_json}");
    assert!(!public_json.contains("detached"), "{public_json}");
}

#[test]
fn ibex_handler_throw_is_structured() {
    let snapback = configured_ibex_snapback(
        r#"
        globalThis.__snapbackHandlers = {
          async listTodos() {
            throw new Error("boom");
          },
          async createTodo() {
            return null;
          }
        };
        "#,
    );

    let error = snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect_err("handler throw should fail structurally");
    assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_FAILED");
}

#[test]
fn read_set_conflict_rejects_stale_mutation() {
    let mut snapback = configured_snapback();
    let created = snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "Conflict" }), "user_1"),
        )
        .expect("create todo");
    let todo_id = created.result.as_str().unwrap().to_owned();

    let before = snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect("query before conflict");
    let observed_version = before.rows[0]["_version"].as_u64().unwrap();

    snapback
        .invoke_mutation(
            "setCompleted",
            input(json!({ "id": todo_id, "completed": true }), "user_1"),
        )
        .expect("first patch");

    let stale = HandlerInput {
        args: json!({ "id": before.rows[0]["_id"], "completed": false }),
        auth: auth("user_1"),
        read_set: vec![ReadDependency {
            table: "todos".to_owned(),
            id: before.rows[0]["_id"].as_str().unwrap().to_owned(),
            version: observed_version,
        }],
        correlation: None,
        ctx_ledger: None,
    };
    let error = snapback
        .invoke_mutation("setCompleted", stale)
        .expect_err("stale read set should conflict");
    assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
}

#[test]
fn captured_handler_read_conflict_rejects_without_client_read_set() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("snapback.db");

    let mut setup = LocalSnapback::open(&db_path).expect("open setup snapback");
    setup.apply_schema(todo_schema()).expect("apply schema");
    setup.load_functions(ibex_todo_functions(CONFLICT_HANDLER_SOURCE));
    let created = setup
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "Captured conflict" }), "user_1"),
        )
        .expect("create todo");
    let todo_id = created.result.as_str().unwrap().to_owned();
    drop(setup);

    let (read_tx, read_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let _read_hook = snapback::runtime::set_captured_point_read_debug_hook(
        "todos", &todo_id, read_tx, release_rx,
    );
    let thread_path = db_path.clone();
    let thread_id = todo_id.clone();
    let first = thread::spawn(move || {
        let mut snapback = LocalSnapback::open(thread_path).expect("open first snapback");
        snapback.load_functions(ibex_todo_functions(CONFLICT_HANDLER_SOURCE));
        snapback
            .invoke_mutation(
                "setCompleted",
                input(json!({ "id": thread_id, "completed": true }), "user_1"),
            )
            .err()
            .map(|error| error.diagnostic)
    });

    read_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("first handler captured the stale row read");

    let mut concurrent = LocalSnapback::open(&db_path).expect("open concurrent snapback");
    concurrent.load_functions(todo_functions());
    // Flip completed to a new value so the captured row version changes before
    // the first handler is released (the row starts at completed=false).
    concurrent
        .invoke_mutation(
            "setCompleted",
            input(json!({ "id": todo_id, "completed": true }), "user_1"),
        )
        .expect("concurrent patch");
    release_tx
        .send(())
        .expect("release first handler after concurrent commit");

    let diagnostic = first
        .join()
        .expect("first thread joins")
        .expect("captured stale row read should conflict");
    assert_eq!(diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
    assert_eq!(diagnostic.details["retryPolicy"], "reject");
    assert_eq!(diagnostic.details["dependency"]["kind"], "row");
    assert_eq!(diagnostic.details["dependency"]["table"], "todos");
    assert_eq!(diagnostic.details["dependency"]["id"], todo_id);
}

// @ref LLP 0248#d3-one-host-operation-one-authoritative-snapshot — the batch storage read is one pinned snapshot.
// Parking after its first logical capture and committing a change to the other
// requested row must leave the mutation with a stale coherent batch, never a
// mixed before/after result that could commit successfully.
#[test]
fn captured_batch_read_is_one_snapshot_and_conflicts_as_a_unit() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("snapback.db");

    let mut setup = LocalSnapback::open(&db_path).expect("open setup snapback");
    setup.apply_schema(todo_schema()).expect("apply schema");
    setup.load_functions(ibex_todo_functions(CONFLICT_HANDLER_SOURCE));
    let first_id = setup
        .invoke_mutation("createTodo", input(json!({ "title": "First" }), "user_1"))
        .expect("create first todo")
        .result
        .as_str()
        .expect("first id")
        .to_owned();
    let second_id = setup
        .invoke_mutation("createTodo", input(json!({ "title": "Second" }), "user_1"))
        .expect("create second todo")
        .result
        .as_str()
        .expect("second id")
        .to_owned();
    drop(setup);

    let (read_tx, read_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let _read_hook = snapback::runtime::set_captured_point_read_debug_hook(
        "todos", &first_id, read_tx, release_rx,
    );
    let thread_path = db_path.clone();
    let thread_first_id = first_id.clone();
    let thread_second_id = second_id.clone();
    let first = thread::spawn(move || {
        let mut snapback = LocalSnapback::open(thread_path).expect("open batch snapback");
        snapback.load_functions(batch_conflict_functions());
        snapback
            .invoke_mutation(
                "batchSetCompleted",
                input(
                    json!({ "firstId": thread_first_id, "secondId": thread_second_id }),
                    "user_1",
                ),
            )
            .err()
            .map(|error| error.diagnostic)
    });

    read_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("batch captured its pinned pre-write rows");

    let mut concurrent = LocalSnapback::open(&db_path).expect("open concurrent snapback");
    concurrent.load_functions(todo_functions());
    concurrent
        .invoke_mutation(
            "setCompleted",
            input(
                json!({ "id": second_id.clone(), "completed": true }),
                "user_1",
            ),
        )
        .expect("concurrent patch of the other batch row");
    release_tx
        .send(())
        .expect("release batch handler after concurrent commit");

    let diagnostic = first
        .join()
        .expect("batch thread joins")
        .expect("the coherent stale batch must conflict");
    assert_eq!(diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
    assert_eq!(diagnostic.details["retryPolicy"], "reject");
    assert_eq!(diagnostic.details["dependency"]["kind"], "row");
    assert_eq!(diagnostic.details["dependency"]["id"], second_id);
}

// @ref LLP 0032#phase-2--execution-semantics-honesty — E3: host-plan mutation
// isolation is the client-supplied read_set baseline *by design* (Option A). A
// stale optimistic baseline is rejected; a current baseline commits. This is the
// principled OCC mechanism for atomic single-transaction host-plan mutations, not
// a trust gap — the deciding read happened on the client, so only the client can
// declare it.
#[test]
fn e3_hostplan_conflict_uses_client_baseline() {
    let mut snapback = configured_snapback();
    let created = snapback
        .invoke_mutation("createTodo", input(json!({ "title": "E3" }), "user_1"))
        .expect("create todo");
    let todo_id = created.result.as_str().unwrap().to_owned();

    // The client optimistically reads the row at V0.
    let before = snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect("query at v0");
    let v0 = before.rows[0]["_version"].as_u64().unwrap();

    // Another mutation advances the same row to V1.
    let bump = snapback
        .invoke_mutation(
            "setCompleted",
            input(
                json!({ "id": todo_id.clone(), "completed": true }),
                "user_1",
            ),
        )
        .expect("advance to v1");
    let v1 = bump.version;
    assert!(v1 > v0, "the bump must advance the row version");

    // (A) A stale client baseline (V0) is rejected as a conflict — the host-plan
    // mutation declared it read the row at V0, but the row is now at V1.
    let stale = HandlerInput {
        args: json!({ "id": todo_id.clone(), "completed": false }),
        auth: auth("user_1"),
        read_set: vec![ReadDependency {
            table: "todos".to_owned(),
            id: todo_id.clone(),
            version: v0,
        }],
        correlation: None,
        ctx_ledger: None,
    };
    let error = snapback
        .invoke_mutation("setCompleted", stale)
        .expect_err("stale client baseline should conflict");
    assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");

    // (B) A current client baseline (V1) commits — the isolation contract holds
    // for host-plan mutations through the client baseline, not just rejects.
    let current = HandlerInput {
        args: json!({ "id": todo_id.clone(), "completed": false }),
        auth: auth("user_1"),
        read_set: vec![ReadDependency {
            table: "todos".to_owned(),
            id: todo_id.clone(),
            version: v1,
        }],
        correlation: None,
        ctx_ledger: None,
    };
    let committed = snapback
        .invoke_mutation("setCompleted", current)
        .expect("current client baseline should commit");
    assert_eq!(committed.changed_count, 1);
}

// @ref LLP 0032#phase-2--execution-semantics-honesty — E3: demonstrates the
// Finding's core claim — under the atomic single-transaction host-plan model,
// server-side read capture is a no-op for conflict detection. With no client
// baseline the unconditional plan commits against changed state, because any read
// the server could capture inside the commit tx is already current, never stale.
#[test]
fn e3_hostplan_without_baseline_commits_against_changed_state() {
    let mut snapback = configured_snapback();
    let created = snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "E3 no-op" }), "user_1"),
        )
        .expect("create todo");
    let todo_id = created.result.as_str().unwrap().to_owned();

    // The client optimistically observes V0 but never declares it.
    let before = snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect("query at v0");
    let v0 = before.rows[0]["_version"].as_u64().unwrap();

    // A concurrent writer advances the row to V1.
    let bump = snapback
        .invoke_mutation(
            "setCompleted",
            input(
                json!({ "id": todo_id.clone(), "completed": true }),
                "user_1",
            ),
        )
        .expect("advance to v1");
    assert!(bump.version > v0);

    // `input(..)` builds an EMPTY read_set — the host-plan mutation carries no
    // client baseline. The server has no server-side read that predates the
    // commit to capture, so it cannot know the client decided against the
    // now-stale V0. The unconditional plan commits. A hypothetical
    // "capture reads server-side" here would capture the *current* (V1) row inside
    // the same transaction that commits — trivially consistent — so it would not
    // change this outcome. Only the client baseline (see the test above) detects
    // the stale optimistic read. => E3 Option A.
    let committed = snapback
        .invoke_mutation(
            "setCompleted",
            input(
                json!({ "id": todo_id.clone(), "completed": false }),
                "user_1",
            ),
        )
        .expect("unconditional host-plan mutation commits with no baseline");
    assert_eq!(committed.changed_count, 1);
}

#[test]
fn reset_and_seed_are_deterministic_handler_bypass_paths() {
    let mut snapback = configured_snapback();
    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "Before reset" }), "user_1"),
        )
        .expect("create before reset");
    snapback.reset().expect("reset");

    let mut row = Map::new();
    row.insert("_id".to_owned(), json!("seed_1"));
    row.insert("title".to_owned(), json!("Seeded"));
    row.insert("completed".to_owned(), json!(false));
    row.insert("userId".to_owned(), json!("user_1"));
    snapback
        .seed(SeedData {
            tables: BTreeMap::from([("todos".to_owned(), vec![row])]),
        })
        .expect("seed");

    let query = snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect("query seeded rows");
    assert_eq!(query.version, 1);
    assert_eq!(query.rows.len(), 1);
    assert_eq!(query.rows[0]["_id"], "seed_1");
    assert_eq!(query.rows[0]["title"], "Seeded");
}

#[test]
fn reset_clears_removed_physical_tables_before_they_can_be_readded() {
    let mut db = LocalDatabase::memory().expect("memory database");
    db.schema_seed()
        .apply_schema(todo_schema())
        .expect("initial schema");
    insert_schema_test_row(
        &mut db,
        "removed-before-reset",
        json!({
            "title": "must not resurrect",
            "completed": false,
            "userId": "u"
        }),
    );
    db.schema_seed()
        .apply_schema(SchemaManifest::default())
        .expect("logical table removal preserves its physical table");
    db.schema_seed()
        .reset()
        .expect("reset clears current and removed physical user tables");
    db.schema_seed()
        .apply_schema(todo_schema())
        .expect("re-add table schema");
    assert_eq!(
        db.query_reads_read()
            .scan_table("todos", 10, 0)
            .expect("scan re-added table")
            .total,
        0,
        "removed-table rows must not resurrect after reset and re-add"
    );
}

#[test]
fn rejected_reset_seed_preserves_database_generation_and_subscriptions() {
    let mut snapback = configured_snapback();
    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "Before rejected reset" }), "user_1"),
        )
        .unwrap();
    snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_atomic_reset".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .unwrap();
    snapback.drain_outbox("client_atomic_reset");

    let invalid = serde_json::from_value(json!({
        "tables": {
            "todos": [
                { "_id": "valid-prefix", "title": "would land", "completed": false, "userId": "user_1" },
                { "_id": "invalid-row", "title": null, "completed": false, "userId": "user_1" }
            ]
        }
    }))
    .unwrap();
    let error = snapback.reset_with_seed(Some(invalid)).unwrap_err();
    assert_eq!(error.diagnostic.code, "SNAPBACK_FIELD_TYPE_MISMATCH");
    let rows = snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .unwrap();
    assert_eq!(rows.rows.len(), 1);
    assert_eq!(rows.rows[0]["title"], "Before rejected reset");

    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "Subscription survived" }), "user_1"),
        )
        .unwrap();
    assert_eq!(
        snapback.drain_outbox("client_atomic_reset").len(),
        1,
        "a rejected reset must not dispose the live subscription"
    );
}

/// ENG-23333 — `reset()` drops every live subscription, so each dropped
/// subscription's connection must receive a `resync_required` (reason
/// "reset") and the global receipts ring must record the disposal. Without
/// the signal a connected tab keeps rendering pre-reset (now-deleted) data
/// forever — its subscription ids no longer exist server-side, so no future
/// commit (including a post-reset seed) ever delivers to it.
#[test]
fn reset_signals_dropped_live_subscriptions() {
    let mut snapback = configured_snapback();
    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "Before reset" }), "user_1"),
        )
        .expect("create before reset");
    let subscription = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe live query");
    assert_eq!(subscription.snapshot.as_ref().unwrap().rows.len(), 1);
    // Discard anything already queued so the assertions see only what the
    // reset itself enqueues.
    snapback.drain_outbox("client_a");

    snapback.reset().expect("reset");

    let messages = snapback.drain_outbox("client_a");
    assert_eq!(
        messages.len(),
        1,
        "reset must enqueue exactly one resync for the dropped subscription"
    );
    let RealtimeEnvelope::Durable(message) = &messages[0] else {
        panic!("expected durable resync message");
    };
    let update: Value = serde_json::from_slice(&message.payload).expect("resync json");
    assert_eq!(update["kind"], "resync_required");
    assert_eq!(update["reason"], "reset");
    assert_eq!(update["subscription_id"], subscription.subscription_id);
    assert_eq!(update["clear_retained"], true);

    let receipts = snapback.receipts_snapshot(None);
    assert!(
        receipts["global"]
            .as_array()
            .unwrap()
            .iter()
            .any(|receipt| {
                receipt["event"] == "disposed"
                    && receipt["reason"] == "reset"
                    && receipt["subscriptionId"] == subscription.subscription_id
            }),
        "reset disposal must be receipted globally: {receipts}"
    );
}

#[test]
fn local_snapback_reuses_in_memory_ephemeral_store() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback
        .register_ephemeral_collection(EphemeralCollection::local_cursor("boardCursors", "boardId"))
        .unwrap();
    let scope = Scope::from_pairs([("boardId", "board_1")]);
    let auth = AuthContext::default();

    let snapshot = snapback
        .subscribe_ephemeral(
            SubscribeRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "observer".to_owned(),
                auth: auth.clone(),
                since_chunk: None,
            },
            1_000,
        )
        .expect("subscribe ephemeral");
    assert!(matches!(snapshot, EphemeralMessage::Snapshot { .. }));

    snapback
        .publish_ephemeral(
            PublishRequest {
                collection: "boardCursors".to_owned(),
                scope,
                connection_id: "publisher".to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                value: br#"{"x":1,"y":2}"#.to_vec(),
                ttl_ms: None,
                auth,
            },
            1_001,
        )
        .expect("publish ephemeral");

    let messages = snapback.drain_outbox("observer");
    assert!(matches!(messages[0], RealtimeEnvelope::Ephemeral(_)));
}

#[test]
fn ephemeral_unsubscribe_removes_only_the_requester_registration() {
    // ENG-22527 item 3 (LLP 0034 §10.1): the idle-linger teardown's server
    // half — `EphemeralApi::unsubscribe`, the lock-free primitive reached over
    // the shared live socket (SECURITY: no public HTTP route; the socket binds
    // the requester). It removes ONLY the caller's own registration; published
    // entries and other observers' registrations are untouched.
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback
        .register_ephemeral_collection(EphemeralCollection::local_cursor("boardCursors", "boardId"))
        .unwrap();
    let scope = Scope::from_pairs([("boardId", "board_1")]);
    let auth = AuthContext::default();
    let api = snapback.ephemeral_api();
    let request = |connection_id: &str| SubscribeRequest {
        collection: "boardCursors".to_owned(),
        scope: scope.clone(),
        connection_id: connection_id.to_owned(),
        auth: auth.clone(),
        since_chunk: None,
    };

    // Two observers on one room; only `observer` unsubscribes.
    api.subscribe(request("observer"), 1_000)
        .expect("subscribe");
    api.subscribe(request("bystander"), 1_000)
        .expect("subscribe bystander");
    api.drain_outbox("observer");
    api.drain_outbox("bystander");

    let removed = api
        .unsubscribe(request("observer"), 1_100)
        .expect("unsubscribe");
    assert!(removed, "the requester's own registration is removed");

    // A publish reaches the bystander but never the unsubscribed observer;
    // published entries themselves are untouched (the bystander still sees it).
    api.publish(
        PublishRequest {
            collection: "boardCursors".to_owned(),
            scope: scope.clone(),
            connection_id: "publisher".to_owned(),
            session_id: None,
            user_id: None,
            custom_key: None,
            value: br#"{"x":9,"y":9}"#.to_vec(),
            ttl_ms: None,
            auth: auth.clone(),
        },
        1_200,
    )
    .expect("publish");
    assert!(
        api.drain_outbox("observer").is_empty(),
        "unsubscribed observer must not receive deltas"
    );
    assert!(
        !api.drain_outbox("bystander").is_empty(),
        "the bystander's registration is untouched and still receives deltas"
    );

    // Unsubscribing again (or for a room already pruned) is a quiet no-op —
    // best-effort teardown may race disconnect cleanup.
    let again = api
        .unsubscribe(request("observer"), 1_300)
        .expect("second unsubscribe");
    assert!(
        !again,
        "a second unsubscribe is a quiet no-op (removed:false)"
    );
}

#[test]
fn ephemeral_unsubscribe_unknown_collection_still_touches_liveness() {
    let snapback = LocalSnapback::memory().expect("memory snapback");
    let api = snapback.ephemeral_api();

    let removed = api
        .unsubscribe(
            SubscribeRequest {
                collection: "removedCollection".to_owned(),
                scope: Scope::from_pairs([("boardId", "board_1")]),
                connection_id: "observer".to_owned(),
                auth: AuthContext::default(),
                since_chunk: None,
            },
            1_100,
        )
        .expect("unknown unsubscribe is a teardown no-op");
    assert!(!removed);
    assert_eq!(
        snapback.active_connection_count(),
        1,
        "a failed/no-op unsubscribe still proves the connection is alive"
    );
}

#[test]
fn schema_manifest_registers_authorized_ephemeral_board_cursors() {
    let mut collection = EphemeralCollection::local_cursor("boardCursors", "boardId")
        .require_room_permission("boardMember");
    collection.burst = 2;
    collection.sustained_hz = 1;

    let mut schema = todo_schema();
    schema.ephemeral_collections = vec![collection];

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(schema).expect("apply schema");
    let scope = Scope::from_pairs([("boardId", "board_1")]);
    let member = AuthContext::default().with_room_permission("boardMember", &scope);
    let non_member = AuthContext::default();

    let denied = snapback
        .subscribe_ephemeral(
            SubscribeRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "intruder".to_owned(),
                auth: non_member.clone(),
                since_chunk: None,
            },
            1_000,
        )
        .expect_err("non-member subscribe should fail");
    assert_eq!(denied.code, EphemeralErrorCode::Unauthorized);

    let snapshot = snapback
        .subscribe_ephemeral(
            SubscribeRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "observer".to_owned(),
                auth: member.clone(),
                since_chunk: None,
            },
            1_000,
        )
        .expect("member subscribe");
    assert!(matches!(snapshot, EphemeralMessage::Snapshot { .. }));

    let denied_publish = snapback
        .publish_ephemeral(
            PublishRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "intruder".to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                value: br#"{"x":0,"y":0}"#.to_vec(),
                ttl_ms: None,
                auth: non_member,
            },
            1_001,
        )
        .expect_err("non-member publish should fail");
    assert_eq!(denied_publish.code, EphemeralErrorCode::Unauthorized);

    snapback
        .publish_ephemeral(
            PublishRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "publisher".to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                value: br#"{"x":1,"y":2}"#.to_vec(),
                ttl_ms: Some(5_000),
                auth: member.clone(),
            },
            1_002,
        )
        .expect("first publish");
    assert_eq!(
        snapback.inspect().expect("inspect").storage.version,
        0,
        "ephemeral publish must not advance durable storage"
    );

    let messages = snapback.drain_outbox("observer");
    let RealtimeEnvelope::Ephemeral(first_upsert) = &messages[0] else {
        panic!("expected ephemeral upsert");
    };
    let mut overlay = ClientEphemeralOverlay::default();
    assert_eq!(overlay.apply(&snapshot), OverlayApply::Applied);
    assert_eq!(overlay.apply(first_upsert), OverlayApply::Applied);
    let room = match first_upsert {
        EphemeralMessage::Upsert { room, .. } => room.clone(),
        _ => panic!("expected upsert"),
    };
    assert_eq!(overlay.room_entries(&room).len(), 1);

    snapback
        .publish_ephemeral(
            PublishRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "publisher".to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                value: br#"{"x":2,"y":3}"#.to_vec(),
                ttl_ms: None,
                auth: member.clone(),
            },
            1_003,
        )
        .expect("second publish within burst");
    let rate_limited = snapback
        .publish_ephemeral(
            PublishRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "publisher".to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                value: br#"{"x":3,"y":4}"#.to_vec(),
                ttl_ms: None,
                auth: member.clone(),
            },
            1_003,
        )
        .expect_err("third publish at same instant should rate limit");
    assert_eq!(rate_limited.code, EphemeralErrorCode::RateLimited);

    let oversized = snapback
        .publish_ephemeral(
            PublishRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "oversized".to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                value: vec![b'x'; 1_025],
                ttl_ms: None,
                auth: member.clone(),
            },
            1_004,
        )
        .expect_err("oversized publish should fail");
    assert_eq!(oversized.code, EphemeralErrorCode::ValueTooLarge);

    snapback.cleanup_ephemeral(6_003);
    let expired = snapback.drain_outbox("observer");
    assert!(
        expired.iter().any(|message| {
            matches!(
                message,
                RealtimeEnvelope::Ephemeral(EphemeralMessage::Remove {
                    reason: snapback::ephemeral::RemoveReason::Expired,
                    ..
                })
            )
        }),
        "expected TTL expiry remove"
    );

    let inspect = snapback.inspect().expect("inspect ephemeral diagnostics");
    assert_eq!(inspect.ephemeral.room_count, 1);
    assert_eq!(inspect.ephemeral.entry_count, 0);
    assert_eq!(inspect.ephemeral.rejected_publishes, 2);
    assert!(inspect.ephemeral.rate_limited_publishes >= 1);
    assert!(inspect.ephemeral.oversized_publishes >= 1);
    assert!(inspect.ephemeral.unauthorized_requests >= 2);
    assert_eq!(inspect.ephemeral.active_rooms[0].collection, "boardCursors");
}

#[test]
fn repeated_matching_schema_load_preserves_ephemeral_rooms_and_outbox() {
    let collection = EphemeralCollection::local_cursor("boardCursors", "boardId");
    let mut schema = todo_schema();
    schema.ephemeral_collections = vec![collection];

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(schema.clone()).expect("first schema");

    let scope = Scope::from_pairs([("boardId", "board_1")]);
    let auth = AuthContext::default();
    snapback
        .subscribe_ephemeral(
            SubscribeRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "observer_a".to_owned(),
                auth: auth.clone(),
                since_chunk: None,
            },
            1_000,
        )
        .expect("first subscribe");
    snapback
        .publish_ephemeral(
            PublishRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "publisher".to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                value: br#"{"x":11,"y":22}"#.to_vec(),
                ttl_ms: None,
                auth: auth.clone(),
            },
            1_001,
        )
        .expect("publish cursor");

    snapback
        .apply_schema(schema)
        .expect("matching schema reload");

    let messages = snapback.drain_outbox("observer_a");
    assert!(
        messages.iter().any(|message| matches!(
            message,
            RealtimeEnvelope::Ephemeral(EphemeralMessage::Upsert { .. })
        )),
        "matching schema reload should not clear queued cursor updates"
    );

    let snapshot = snapback
        .subscribe_ephemeral(
            SubscribeRequest {
                collection: "boardCursors".to_owned(),
                scope,
                connection_id: "observer_b".to_owned(),
                auth,
                since_chunk: None,
            },
            1_002,
        )
        .expect("second subscribe");
    assert!(
        matches!(snapshot, EphemeralMessage::Snapshot { entries, .. } if entries.len() == 1),
        "matching schema reload should preserve active cursor rooms"
    );
}

#[test]
fn invalid_ephemeral_schema_is_rejected_before_durable_or_live_state_changes() {
    let collection = EphemeralCollection::local_cursor("boardCursors", "boardId");
    let mut baseline = todo_schema();
    baseline.ephemeral_collections = vec![collection.clone()];

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback
        .apply_schema(baseline.clone())
        .expect("baseline schema");
    let scope = Scope::from_pairs([("boardId", "board_1")]);
    snapback
        .publish_ephemeral(
            PublishRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "publisher".to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                value: br#"{"x":5,"y":6}"#.to_vec(),
                ttl_ms: None,
                auth: AuthContext::default(),
            },
            1_000,
        )
        .expect("publish cursor");

    let mut invalid = baseline.clone();
    invalid.schema_hash = Some("must-not-commit".to_owned());
    invalid.tables[0].fields.push(FieldManifest {
        name: "mustNotExist".to_owned(),
        field_type: FieldType::String,
        optional: true,
    });
    invalid.ephemeral_collections[0].default_ttl_ms = 0;

    let error = snapback
        .apply_schema(invalid)
        .expect_err("invalid ephemeral definition must fail atomically");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION"
    );

    let inspect = snapback.inspect().expect("inspect after failed apply");
    assert_eq!(inspect.schema.schema_hash, baseline.schema_hash);
    assert!(
        inspect.schema.tables[0].field("mustNotExist").is_none(),
        "durable manifest must not advance before ephemeral preflight"
    );
    let snapshot = snapback
        .subscribe_ephemeral(
            SubscribeRequest {
                collection: "boardCursors".to_owned(),
                scope,
                connection_id: "observer".to_owned(),
                auth: AuthContext::default(),
                since_chunk: None,
            },
            1_001,
        )
        .expect("existing collection remains usable");
    assert!(
        matches!(snapshot, EphemeralMessage::Snapshot { entries, .. } if entries.len() == 1),
        "failed schema must preserve the existing ephemeral room"
    );
}

#[test]
fn ensure_ephemeral_collections_rejects_mismatch_without_clearing_room() {
    let collection = EphemeralCollection::local_cursor("boardCursors", "boardId");
    let mut schema = todo_schema();
    schema.ephemeral_collections = vec![collection.clone()];

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(schema).expect("schema");

    let scope = Scope::from_pairs([("boardId", "board_1")]);
    let auth = AuthContext::default();
    snapback
        .publish_ephemeral(
            PublishRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "publisher".to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                value: br#"{"x":5,"y":6}"#.to_vec(),
                ttl_ms: None,
                auth: auth.clone(),
            },
            1_000,
        )
        .expect("publish cursor");

    let mut incompatible = collection;
    incompatible.max_value_bytes = 512;
    let error = snapback
        .ensure_ephemeral_collections(vec![incompatible])
        .expect_err("incompatible generated collection should fail");
    assert_eq!(
        error.code,
        EphemeralErrorCode::IncompatibleCollectionDefinition
    );

    let snapshot = snapback
        .subscribe_ephemeral(
            SubscribeRequest {
                collection: "boardCursors".to_owned(),
                scope,
                connection_id: "observer".to_owned(),
                auth,
                since_chunk: None,
            },
            1_001,
        )
        .expect("subscribe after failed ensure");
    assert!(
        matches!(snapshot, EphemeralMessage::Snapshot { entries, .. } if entries.len() == 1),
        "failed ensure must not clear existing live presence"
    );
}

#[test]
fn generated_v0_artifacts_round_trip_through_runtime_structs() {
    let generated_schema = read_generated_demo_fixture(
        "../../../demos/todo/snapback/generated/schema.manifest.json",
        "todo",
    );
    let committed_schema: Value =
        serde_json::from_str(&generated_schema).expect("committed schema artifact parses");
    let schema: SchemaManifest =
        serde_json::from_str(&generated_schema).expect("generated schema manifest parses");
    assert_eq!(schema.artifact_kind, "schemaManifest");
    assert_eq!(schema.schema_version, "snapback.v0");
    let committed_schema_hash = committed_schema["schemaHash"]
        .as_str()
        .expect("committed schema hash");
    assert!(committed_schema_hash.starts_with("sha256:"));
    assert_eq!(
        schema.schema_hash.as_deref(),
        Some(committed_schema_hash),
        "the runtime struct must preserve the current committed generated hash"
    );
    assert!(schema.inputs_hash.is_some());
    let schema_value = serde_json::to_value(&schema).expect("schema roundtrip");
    assert_eq!(schema_value["artifactKind"], "schemaManifest");
    assert_eq!(schema_value["schemaHash"], committed_schema["schemaHash"]);

    let generated_functions = read_generated_demo_fixture(
        "../../../demos/todo/snapback/generated/functions.manifest.json",
        "todo",
    );
    let committed_functions: Value =
        serde_json::from_str(&generated_functions).expect("committed function artifact parses");
    let functions: FunctionManifest =
        serde_json::from_str(&generated_functions).expect("generated function manifest parses");
    assert_eq!(functions.artifact_kind, "functionManifest");
    assert_eq!(functions.schema_version, "snapback.v0");
    let committed_bundle_hash = committed_functions["bundleHash"]
        .as_str()
        .expect("committed function bundle hash");
    assert!(committed_bundle_hash.starts_with("sha256:"));
    assert_eq!(
        functions.bundle_hash.as_deref(),
        Some(committed_bundle_hash),
        "the runtime struct must preserve the current committed generated bundle hash"
    );
    let functions_value = serde_json::to_value(&functions).expect("functions roundtrip");
    assert_eq!(
        functions_value["bundleHash"],
        committed_functions["bundleHash"]
    );

    let list = functions
        .function("todo:listTodos")
        .expect("function id lookup");
    assert_eq!(list.name, "listTodos");
    assert_eq!(list.exported_name.as_deref(), Some("listTodos"));
    assert_eq!(list.syncability_class.as_deref(), Some("syncable-live"));
    assert!(matches!(&list.runtime, FunctionRuntime::IbexModule(_)));
    assert_eq!(
        list.read_set_summary.primary_table.as_deref(),
        Some("todos")
    );
    assert_eq!(
        list.read_set_summary.auth_scope_field.as_deref(),
        Some("userId")
    );

    let create = functions
        .function("createTodo")
        .expect("function name lookup");
    assert_eq!(
        create.write_set_summary.primary_table.as_deref(),
        Some("todos")
    );
    assert!(matches!(&create.runtime, FunctionRuntime::IbexModule(_)));
    assert!(
        create
            .required_capabilities
            .contains(&"mutation_read_set_validation".to_owned())
    );
}

#[test]
fn inspect_exposes_v0_runtime_and_capability_artifacts() {
    let mut snapback = configured_snapback();
    let inspect = snapback.inspect().expect("inspect");
    assert_eq!(inspect.artifact_kind, "runtimeState");
    assert_eq!(inspect.schema_version, "snapback.v0");
    assert_eq!(
        inspect.capability_manifest.artifact_kind,
        "capabilityManifest"
    );
    assert_eq!(inspect.capability_manifest.schema_version, "snapback.v0");
    assert_eq!(
        inspect.runtime.ibex_ctx_db_host_bridge,
        CapabilityState::Available
    );
    assert_eq!(inspect.capability_manifest.runtime_engine, "ibex");
    assert!(
        inspect
            .capability_manifest
            .supported_query_forms
            .contains(&"ibex-ctx-db-single-table-eq".to_owned())
    );
    assert!(
        inspect
            .capability_manifest
            .supported_query_forms
            .contains(&"ibex-ctx-db-single-table-in".to_owned())
    );
    assert!(
        inspect
            .capability_manifest
            .supported_query_forms
            .contains(&"ibex-ctx-db-single-table-range".to_owned())
    );
    assert!(
        inspect
            .capability_manifest
            .supported_query_forms
            .contains(&"ibex-live-eq-replace".to_owned())
    );
    assert!(
        inspect
            .capability_manifest
            .supported_query_forms
            .contains(&"ibex-live-in-replace".to_owned())
    );
    assert!(
        inspect
            .capability_manifest
            .supported_query_forms
            .contains(&"ibex-live-range-replace".to_owned())
    );
    assert!(
        inspect
            .capability_manifest
            .supported_query_forms
            .contains(&"ibex-live-limited-boundary-replace".to_owned())
    );
    assert!(
        inspect
            .capability_manifest
            .supported_query_forms
            .contains(&"websocket-live-replace".to_owned())
    );
    assert!(
        !inspect
            .capability_manifest
            .capability_gaps
            .contains(&"precise_realtime_query_range_matcher".to_owned())
    );
    assert!(
        !inspect
            .capability_manifest
            .capability_gaps
            .contains(&"ibex_ctx_db_host_bridge".to_owned())
    );
}

#[test]
fn artifact_version_mismatch_reports_structured_diagnostics() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    let mut schema = todo_schema();
    schema.schema_version = "snapback.v999".to_owned();
    let error = snapback
        .apply_schema(schema)
        .expect_err("schema version mismatch should fail");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION"
    );
    assert_eq!(
        error.diagnostic.details["expectedSchemaVersion"],
        "snapback.v0"
    );
    assert_eq!(error.diagnostic.details["schemaVersion"], "snapback.v999");

    let mut functions = todo_functions();
    functions.schema_version = "snapback.v999".to_owned();
    let diagnostics = snapback.load_functions(functions);
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(
        diagnostics[0].code,
        "SNAPBACK_STALE_FUNCTION_ARTIFACT_VERSION"
    );
    assert_eq!(
        diagnostics[0].details["expectedSchemaVersion"],
        "snapback.v0"
    );
}

fn configured_snapback() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback
        .apply_schema(todo_schema())
        .expect("apply todo schema");
    let diagnostics = snapback.load_functions(todo_functions());
    assert!(diagnostics.is_empty());
    snapback
}

fn configured_ibex_snapback(source: &str) -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback
        .apply_schema(todo_schema())
        .expect("apply todo schema");
    let diagnostics = snapback.load_functions(ibex_todo_functions(source));
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED")
    );
    snapback
}

const TODO_HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async listTodos(ctx) {
    return await ctx.db
      .query('todos')
      .withIndex('by_user')
      .eq('userId', ctx.auth.userId)
      .order('_createdAt', 'asc')
      .collect();
  },

  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', {
      title: args.title,
      completed: false,
      userId: ctx.auth.userId,
    });
  },

  async setCompleted(ctx, args) {
    const todo = await ctx.db.get('todos', args.id);
    if (!todo) return 0;
    return (await ctx.db.patch('todos', args.id, {
      completed: args.completed,
    })) ? 1 : 0;
  },

  async deleteTodo(ctx, args) {
    const todo = await ctx.db.get('todos', args.id);
    if (!todo) return 0;
    return (await ctx.db.delete('todos', args.id)) ? 1 : 0;
  }
};
"#;

const ALL_TODOS_HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async listTodos(ctx) {
    return await ctx.db
      .query('todos')
      .order('_createdAt', 'asc')
      .collect();
  },

  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', {
      title: args.title,
      completed: false,
      userId: ctx.auth.userId,
    });
  }
};
"#;

const COMPLETED_TODOS_HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async listTodos(ctx) {
    return await ctx.db
      .query('todos')
      .eq('completed', true)
      .order('_createdAt', 'asc')
      .collect();
  },

  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', {
      title: args.title,
      completed: args.completed,
      userId: ctx.auth.userId,
    });
  },

  async setCompleted(ctx, args) {
    const todo = await ctx.db.get('todos', args.id);
    if (!todo) return 0;
    return (await ctx.db.patch('todos', args.id, {
      completed: args.completed,
    })) ? 1 : 0;
  },

  async deleteTodo(ctx, args) {
    const todo = await ctx.db.get('todos', args.id);
    if (!todo) return 0;
    return (await ctx.db.delete('todos', args.id)) ? 1 : 0;
  }
};
"#;

const PINNED_TODOS_HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async listTodos(ctx, args) {
    const pinned = await ctx.db.get('todos', args.pinnedId);
    const rows = await ctx.db
      .query('todos')
      .eq('completed', true)
      .order('_createdAt', 'asc')
      .collect();
    return rows.map((row) => ({
      ...row,
      pinnedTitle: pinned ? pinned.title : null,
    }));
  },

  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', {
      title: args.title,
      completed: args.completed === true,
      userId: ctx.auth.userId,
    });
  },

  async setTitle(ctx, args) {
    return (await ctx.db.patch('todos', args.id, {
      title: args.title,
    })) ? 1 : 0;
  }
};
"#;

const IN_TODOS_HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async listTodos(ctx) {
    return await ctx.db
      .query('todos')
      .in('completed', [true])
      .order('_createdAt', 'asc')
      .collect();
  },

  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', {
      title: args.title,
      completed: args.completed,
      userId: ctx.auth.userId,
    });
  },

  async setCompleted(ctx, args) {
    const todo = await ctx.db.get('todos', args.id);
    if (!todo) return 0;
    return (await ctx.db.patch('todos', args.id, {
      completed: args.completed,
    })) ? 1 : 0;
  },

  async deleteTodo(ctx, args) {
    const todo = await ctx.db.get('todos', args.id);
    if (!todo) return 0;
    return (await ctx.db.delete('todos', args.id)) ? 1 : 0;
  }
};
"#;

const RANGE_TODOS_HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async listTodos(ctx) {
    return await ctx.db
      .query('todos')
      .gte('rank', 10)
      .order('rank', 'asc')
      .collect();
  },

  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', {
      title: args.title,
      completed: args.completed === true,
      rank: args.rank,
      userId: ctx.auth.userId,
    });
  },

  async setCompleted(ctx, args) {
    const values = { completed: args.completed === true };
    if (args.rank !== undefined) values.rank = args.rank;
    return (await ctx.db.patch('todos', args.id, values)) ? 1 : 0;
  },

  async deleteTodo(ctx, args) {
    const todo = await ctx.db.get('todos', args.id);
    if (!todo) return 0;
    return (await ctx.db.delete('todos', args.id)) ? 1 : 0;
  }
};
"#;

const LIMITED_RANK_TODOS_HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async listTodos(ctx) {
    return await ctx.db
      .query('todos')
      .order('rank', 'asc')
      .take(2)
      .collect();
  },

  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', {
      title: args.title,
      completed: args.completed === true,
      rank: args.rank,
      userId: ctx.auth.userId,
    });
  },

  async setCompleted(ctx, args) {
    const values = { completed: args.completed === true };
    if (args.rank !== undefined) values.rank = args.rank;
    return (await ctx.db.patch('todos', args.id, values)) ? 1 : 0;
  },

  async deleteTodo(ctx, args) {
    const todo = await ctx.db.get('todos', args.id);
    if (!todo) return 0;
    return (await ctx.db.delete('todos', args.id)) ? 1 : 0;
  }
};
"#;

const CONFLICT_HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', {
      title: args.title,
      completed: false,
      userId: ctx.auth.userId,
    });
  },

  async setCompleted(ctx, args) {
    const todo = await ctx.db.get('todos', args.id);
    if (!todo) return 0;
    return (await ctx.db.patch('todos', args.id, {
      completed: args.completed,
    })) ? 1 : 0;
  }
};
"#;

const BATCH_CONFLICT_HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async batchSetCompleted(ctx, args) {
    const rows = await ctx.db.getMany('todos', [args.firstId, args.secondId]);
    if (!rows[0] || !rows[1] || rows[0].completed !== false || rows[1].completed !== false) {
      throw new Error('batch did not observe one coherent pre-write snapshot');
    }
    return (await ctx.db.patch('todos', args.firstId, { completed: true })) ? 1 : 0;
  }
};
"#;

fn batch_conflict_functions() -> FunctionManifest {
    let mut function = FunctionDefinition::new(
        "batchSetCompleted",
        FunctionKind::Mutation,
        FunctionRuntime::IbexModule(IbexModule {
            source: BATCH_CONFLICT_HANDLER_SOURCE.to_owned(),
            export: "batchSetCompleted".to_owned(),
        }),
    );
    function.required_capabilities = vec![
        "bounded_batch_reads_v1".to_owned(),
        "ibex_ctx_db_host_bridge".to_owned(),
        "mutation_read_set_validation".to_owned(),
    ];
    function.read_set_summary.primary_table = Some("todos".to_owned());
    function.read_set_summary.tables = vec!["todos".to_owned()];
    function.read_set_summary.mode = Some("handlerDeclared".to_owned());
    function.write_set_summary.primary_table = Some("todos".to_owned());
    function.write_set_summary.tables = vec!["todos".to_owned()];
    function.write_set_summary.mode = Some("handlerDeclared".to_owned());
    FunctionManifest {
        acknowledged_experimental_capabilities: vec!["bounded_batch_reads_v1".to_owned()],
        functions: vec![function],
        ..FunctionManifest::default()
    }
}

fn todo_schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("todo-v0".to_owned()),
        tables: vec![TableManifest {
            name: "todos".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "title".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "completed".to_owned(),
                    field_type: FieldType::Boolean,
                    optional: false,
                },
                FieldManifest {
                    name: "rank".to_owned(),
                    field_type: FieldType::Integer,
                    optional: true,
                },
                FieldManifest {
                    name: "userId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
            ],
            indexes: vec![IndexManifest {
                name: "by_user".to_owned(),
                fields: vec!["userId".to_owned()],
                unique: false,
                where_applicable: false,
            }],
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        }],
        ..SchemaManifest::default()
    }
}

fn ibex_todo_functions(source: &str) -> FunctionManifest {
    let mut list = FunctionDefinition::new(
        "listTodos",
        FunctionKind::LiveQuery,
        FunctionRuntime::IbexModule(IbexModule {
            source: source.to_owned(),
            export: "listTodos".to_owned(),
        }),
    );
    list.required_capabilities = vec![
        "live_subscriptions".to_owned(),
        "ibex_ctx_db_host_bridge".to_owned(),
    ];
    list.read_set_summary.primary_table = Some("todos".to_owned());
    list.read_set_summary.tables = vec!["todos".to_owned()];
    list.read_set_summary.mode = Some("handlerDeclared".to_owned());
    list.read_set_summary.auth_scope_field = Some("userId".to_owned());

    let mut create = FunctionDefinition::new(
        "createTodo",
        FunctionKind::Mutation,
        FunctionRuntime::IbexModule(IbexModule {
            source: source.to_owned(),
            export: "createTodo".to_owned(),
        }),
    );
    create.required_capabilities = vec![
        "ibex_ctx_db_host_bridge".to_owned(),
        "mutation_read_set_validation".to_owned(),
    ];
    create.write_set_summary.primary_table = Some("todos".to_owned());
    create.write_set_summary.tables = vec!["todos".to_owned()];
    create.write_set_summary.mode = Some("handlerDeclared".to_owned());

    let mut set_completed = FunctionDefinition::new(
        "setCompleted",
        FunctionKind::Mutation,
        FunctionRuntime::IbexModule(IbexModule {
            source: source.to_owned(),
            export: "setCompleted".to_owned(),
        }),
    );
    set_completed.required_capabilities = vec![
        "ibex_ctx_db_host_bridge".to_owned(),
        "mutation_read_set_validation".to_owned(),
    ];
    set_completed.read_set_summary.primary_table = Some("todos".to_owned());
    set_completed.read_set_summary.tables = vec!["todos".to_owned()];
    set_completed.read_set_summary.mode = Some("handlerDeclared".to_owned());
    set_completed.write_set_summary.primary_table = Some("todos".to_owned());
    set_completed.write_set_summary.tables = vec!["todos".to_owned()];
    set_completed.write_set_summary.mode = Some("handlerDeclared".to_owned());

    let mut delete = FunctionDefinition::new(
        "deleteTodo",
        FunctionKind::Mutation,
        FunctionRuntime::IbexModule(IbexModule {
            source: source.to_owned(),
            export: "deleteTodo".to_owned(),
        }),
    );
    delete.required_capabilities = vec![
        "ibex_ctx_db_host_bridge".to_owned(),
        "mutation_read_set_validation".to_owned(),
    ];
    delete.read_set_summary.primary_table = Some("todos".to_owned());
    delete.read_set_summary.tables = vec!["todos".to_owned()];
    delete.read_set_summary.mode = Some("handlerDeclared".to_owned());
    delete.write_set_summary.primary_table = Some("todos".to_owned());
    delete.write_set_summary.tables = vec!["todos".to_owned()];
    delete.write_set_summary.mode = Some("handlerDeclared".to_owned());

    FunctionManifest {
        bundle_hash: Some("todo-ibex-functions-v0".to_owned()),
        functions: vec![list, create, set_completed, delete],
        ..FunctionManifest::default()
    }
}

fn todo_functions() -> FunctionManifest {
    FunctionManifest {
        bundle_hash: Some("todo-functions-v0".to_owned()),
        functions: vec![
            FunctionDefinition::new(
                "listTodos",
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table_visibility: None,
                    table: "todos".to_owned(),
                    filters: vec![FilterExpr {
                        field: "userId".to_owned(),
                        op: FilterOp::Eq,
                        value: ValueExpr::AuthUserId,
                    }],
                    order: vec![OrderExpr {
                        field: "_createdAt".to_owned(),
                        direction: OrderDirection::Asc,
                        max_encoded_bytes: None,
                    }],
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: Some("by_user".to_owned()),
                })),
            ),
            FunctionDefinition::new(
                "createTodo",
                FunctionKind::Mutation,
                FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                    owner_write_checks: Vec::new(),
                    steps: vec![MutationStep::Insert {
                        table: "todos".to_owned(),
                        values: BTreeMap::from([
                            ("title".to_owned(), ValueExpr::Arg("title".to_owned())),
                            (
                                "completed".to_owned(),
                                ValueExpr::Literal(Value::Bool(false)),
                            ),
                            ("userId".to_owned(), ValueExpr::AuthUserId),
                        ]),
                        bind_id_as: Some("todoId".to_owned()),
                    }],
                    return_value: Some(ReturnValue::Binding("todoId".to_owned())),
                })),
            ),
            FunctionDefinition::new(
                "setCompleted",
                FunctionKind::Mutation,
                FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                    owner_write_checks: Vec::new(),
                    steps: vec![MutationStep::Patch {
                        table: "todos".to_owned(),
                        id: ValueExpr::Arg("id".to_owned()),
                        values: BTreeMap::from([(
                            "completed".to_owned(),
                            ValueExpr::Arg("completed".to_owned()),
                        )]),
                    }],
                    return_value: Some(ReturnValue::ChangedCount),
                })),
            ),
        ],
        ..FunctionManifest::default()
    }
}

fn todo_functions_with_cron(demand_gated: bool) -> FunctionManifest {
    let mut manifest = todo_functions();
    manifest.functions.push(system_todo_mutation());
    manifest.functions.push(FunctionDefinition::new(
        "pollTodosAction",
        FunctionKind::Action,
        FunctionRuntime::HostPlan(HandlerPlan::Action(ActionPlan {
            steps: vec![ActionStep::RunMutation {
                name: "createSystemTodo".to_owned(),
                args: BTreeMap::from([(
                    "title".to_owned(),
                    ValueExpr::Literal(json!("From cron")),
                )]),
                bind_result_as: Some("created".to_owned()),
            }],
            return_value: Some(ActionReturnValue::Binding("created".to_owned())),
        })),
    ));
    manifest.cron_jobs = vec![CronJobDefinition {
        name: "pollTodos".to_owned(),
        schedule: CronSchedule {
            every_ms: Some(60_000),
            cron: None,
        },
        action: "pollTodosAction".to_owned(),
        enabled: true,
        activation: if demand_gated {
            CronActivationPolicy {
                kind: CronActivationKind::WhileLive,
                while_live: vec!["listTodos".to_owned()],
            }
        } else {
            CronActivationPolicy::default()
        },
        jitter_policy: CronJitterPolicy {
            enabled: demand_gated,
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

fn ibex_action_cron_functions() -> FunctionManifest {
    let mut manifest = todo_functions();
    manifest.functions.push(system_todo_mutation());
    manifest.functions.push(FunctionDefinition::new(
        "pollTodosAction",
        FunctionKind::Action,
        FunctionRuntime::IbexModule(IbexModule {
            source: r#"
globalThis.__snapbackHandlers = {
  async pollTodosAction(ctx) {
    return await ctx.runMutation('createSystemTodo', {
      title: 'JS ' + ctx.run.jobName,
    });
  }
};
"#
            .to_owned(),
            export: "pollTodosAction".to_owned(),
        }),
    ));
    manifest.cron_jobs = vec![CronJobDefinition {
        name: "pollTodos".to_owned(),
        schedule: CronSchedule {
            every_ms: Some(60_000),
            cron: None,
        },
        action: "pollTodosAction".to_owned(),
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

fn system_todo_mutation() -> FunctionDefinition {
    FunctionDefinition::new(
        "createSystemTodo",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Insert {
                table: "todos".to_owned(),
                values: BTreeMap::from([
                    ("title".to_owned(), ValueExpr::Arg("title".to_owned())),
                    (
                        "completed".to_owned(),
                        ValueExpr::Literal(Value::Bool(false)),
                    ),
                    (
                        "userId".to_owned(),
                        ValueExpr::Literal(Value::String("cron".to_owned())),
                    ),
                ]),
                bind_id_as: Some("todoId".to_owned()),
            }],
            return_value: Some(ReturnValue::Binding("todoId".to_owned())),
        })),
    )
}

fn input(args: Value, user_id: &str) -> HandlerInput {
    HandlerInput {
        args,
        auth: auth(user_id),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

fn auth(user_id: &str) -> AuthInput {
    AuthInput {
        principal: Some(user_id.to_owned()),
        session_id: None,
        user_id: Some(user_id.to_owned()),
        ..AuthInput::default()
    }
}

/// LLP 0032 S2 — subscription ids must be unguessable bearer capabilities,
/// not enumerable counters.
#[test]
fn s2_subscription_ids_are_unguessable() {
    let mut snapback = configured_ibex_snapback(TODO_HANDLER_SOURCE);
    let first = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("first subscription");
    let second = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("second subscription");
    assert_ne!(first.subscription_id, second.subscription_id);
    for id in [&first.subscription_id, &second.subscription_id] {
        // @ref LLP 0148#d1-grammar — subscription capabilities now carry the
        // registry's canonical 128-bit Crockford body instead of UUID text.
        assert!(
            snapback::ids::is_well_formed(id),
            "subscription id must retain the canonical minted-id body: {id}"
        );
        let (prefix, body) = snapback::ids::split(id).expect("well-formed subscription id");
        assert_eq!(prefix, snapback::ids::Kind::Subscription.prefix());
        assert_eq!(body.len(), snapback::ids::BODY_LEN);
        assert!(snapback::ids::decode_body(body).is_some());
    }
}

/// LLP 0032 S2 — resume is bound to the subscribing principal: a different or
/// anonymous caller must fail closed even with the correct subscription id.
#[test]
fn s2_resume_live_fails_closed_for_a_different_principal() {
    let mut snapback = configured_ibex_snapback(TODO_HANDLER_SOURCE);
    let subscription = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_owner".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe live query");

    let hijack = snapback.resume_live(
        "listTodos",
        LiveResumeInput {
            subscription_id: subscription.subscription_id.clone(),
            connection_id: "client_attacker".to_owned(),
            auth: auth("user_2"),
            recorded_permission_epochs: subscription.permission_epochs.clone(),
        },
    );
    let error = hijack.expect_err("resume by a different principal must fail closed");
    assert_eq!(error.diagnostic.code, "SNAPBACK_LIVE_RESUME_OWNERSHIP");

    let anonymous = snapback.resume_live(
        "listTodos",
        LiveResumeInput {
            subscription_id: subscription.subscription_id.clone(),
            connection_id: "client_attacker".to_owned(),
            auth: AuthInput::default(),
            recorded_permission_epochs: subscription.permission_epochs.clone(),
        },
    );
    assert_eq!(
        anonymous
            .expect_err("anonymous resume of an owned subscription must fail closed")
            .diagnostic
            .code,
        "SNAPBACK_LIVE_RESUME_OWNERSHIP"
    );

    let owner = snapback
        .resume_live(
            "listTodos",
            LiveResumeInput {
                subscription_id: subscription.subscription_id.clone(),
                connection_id: "client_owner_reconnected".to_owned(),
                auth: auth("user_1"),
                recorded_permission_epochs: subscription.permission_epochs,
            },
        )
        .expect("owner resume succeeds");
    assert_eq!(owner.subscription_id, subscription.subscription_id);
}

/// LLP 0032 S5.D9 — query-shaped handlers that return a non-array fail closed
/// with diagnostics that identify the declared function kind.
#[test]
fn s5_d9_non_array_query_result_fails_closed() {
    const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async listTodos(ctx) {
    return { not: 'an array' };
  },
  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', {
      title: args.title, completed: false, userId: ctx.auth.userId,
    });
  }
};
"#;
    let live = configured_ibex_snapback(SOURCE);
    let error = live
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect_err("non-array query result must fail closed");
    assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_RESULT_INVALID");
    assert!(error.diagnostic.message.contains("live query handler"));
    assert!(error.diagnostic.message.contains("listTodos"));

    let mut ordinary = LocalSnapback::memory().expect("memory snapback");
    ordinary.apply_schema(todo_schema()).expect("todo schema");
    let mut functions = ibex_todo_functions(SOURCE);
    functions.functions[0].kind = FunctionKind::Query;
    functions.functions[0]
        .required_capabilities
        .retain(|capability| capability != "live_subscriptions");
    ordinary.load_functions(functions);
    let error = ordinary
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect_err("ordinary non-array query result must fail closed");
    assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_RESULT_INVALID");
    assert!(error.diagnostic.message.contains("query handler"));
    assert!(!error.diagnostic.message.contains("live query handler"));
    assert!(error.diagnostic.message.contains("listTodos"));
}

/// LLP 0032 S5.D8 — cron run duration is measured from real wall-clock, not
/// collapsed to zero (started/finished no longer coincide).
#[test]
fn s5_d8_cron_run_records_nonzero_duration() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(ibex_busy_action_cron_functions());

    let record = snapback
        .run_cron_job_now("pollTodos", 123_000)
        .expect("manual cron run");
    assert_eq!(record.outcome, CronRunOutcome::Succeeded);
    let finished = record.finished_at_ms.expect("finished timestamp");
    assert!(
        finished > record.started_at_ms,
        "finished ({finished}) must be after started ({})",
        record.started_at_ms
    );
    assert!(
        record.duration_ms.unwrap_or(0) > 0,
        "a busy action must record a nonzero durationMs, got {:?}",
        record.duration_ms
    );
}

/// LLP 0032 S5.D11 — the recording tick returns runs on the happy path and
/// leaves the error counter untouched. (The error path — tick_cron's own
/// claim/persist failure — needs storage fault injection and is recorded as
/// test-debt in LLP 0032; the recording seam and counter are exercised here.)
#[test]
fn s5_d11_recording_tick_runs_cron_without_error() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(ibex_action_cron_functions());
    snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe activates demand-gated cron");

    let runs = snapback.tick_cron_recording(6_000);
    assert_eq!(runs.len(), 1);
    assert_eq!(snapback.cron_tick_errors(), 0);
}

fn ibex_busy_action_cron_functions() -> FunctionManifest {
    let mut manifest = todo_functions();
    manifest.functions.push(FunctionDefinition::new(
        "busyAction",
        FunctionKind::Action,
        FunctionRuntime::IbexModule(IbexModule {
            source: r#"
globalThis.__snapbackHandlers = {
  async busyAction(ctx) {
    const start = Date.now();
    while (Date.now() - start < 5) {}
    return { ranAt: start };
  }
};
"#
            .to_owned(),
            export: "busyAction".to_owned(),
        }),
    ));
    manifest.cron_jobs = vec![CronJobDefinition {
        name: "pollTodos".to_owned(),
        schedule: CronSchedule {
            every_ms: Some(60_000),
            cron: None,
        },
        action: "busyAction".to_owned(),
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
    }];
    manifest
}

/// LLP 0032 S5.D1 — an Ibex action whose `ctx.runMutation` targets an Ibex
/// mutation re-enters the runtime; the outer action's context must survive the
/// nested call so a *subsequent* host call still works. Pre-fix, the nested
/// exit nulled the thread-local and the second runMutation failed with
/// SNAPBACK_HANDLER_HOST_CALL_WITHOUT_CONTEXT.
#[test]
fn s5_d1_action_calling_ibex_mutation_preserves_context() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(ibex_nested_reentry_functions());

    let record = snapback
        .run_cron_job_now("nestedReentry", 1_000)
        .expect("manual cron run");
    assert_eq!(
        record.outcome,
        CronRunOutcome::Succeeded,
        "nested re-entry must not strand the outer action: {:?}",
        record.diagnostic
    );

    // Both nested mutations committed — proving the second host call, made
    // after the first nested Ibex mutation returned, still had a live context.
    let query = snapback
        .invoke_query("listAllTodos", input(json!({}), "nested"))
        .expect("query todos after nested action");
    let titles: Vec<&str> = query
        .rows
        .iter()
        .filter_map(|row| row["title"].as_str())
        .collect();
    assert!(
        titles.contains(&"first"),
        "first nested insert missing: {titles:?}"
    );
    assert!(
        titles.contains(&"second"),
        "second nested insert missing: {titles:?}"
    );
}

fn ibex_nested_reentry_functions() -> FunctionManifest {
    const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async listAllTodos(ctx) {
    return await ctx.db.query('todos').order('_createdAt', 'asc').collect();
  },
  async innerCreate(ctx, args) {
    return await ctx.db.insert('todos', {
      title: args.title, completed: false, userId: 'nested',
    });
  },
  async nestedAction(ctx) {
    const first = await ctx.runMutation('innerCreate', { title: 'first' });
    // This second host call runs AFTER the first nested Ibex mutation has
    // returned; on the bug the context is null here and it fails closed.
    const second = await ctx.runMutation('innerCreate', { title: 'second' });
    return { first: first, second: second };
  }
};
"#;
    let mut manifest = FunctionManifest::default();

    let mut list = FunctionDefinition::new(
        "listAllTodos",
        FunctionKind::LiveQuery,
        FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: "listAllTodos".to_owned(),
        }),
    );
    list.required_capabilities = vec![
        "live_subscriptions".to_owned(),
        "ibex_ctx_db_host_bridge".to_owned(),
    ];
    list.read_set_summary.primary_table = Some("todos".to_owned());
    list.read_set_summary.tables = vec!["todos".to_owned()];
    list.read_set_summary.mode = Some("handlerDeclared".to_owned());
    manifest.functions.push(list);

    let mut inner = FunctionDefinition::new(
        "innerCreate",
        FunctionKind::Mutation,
        FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: "innerCreate".to_owned(),
        }),
    );
    inner.required_capabilities = vec![
        "ibex_ctx_db_host_bridge".to_owned(),
        "mutation_read_set_validation".to_owned(),
    ];
    inner.write_set_summary.primary_table = Some("todos".to_owned());
    inner.write_set_summary.tables = vec!["todos".to_owned()];
    inner.write_set_summary.mode = Some("handlerDeclared".to_owned());
    manifest.functions.push(inner);

    let mut action = FunctionDefinition::new(
        "nestedAction",
        FunctionKind::Action,
        FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: "nestedAction".to_owned(),
        }),
    );
    action.required_capabilities = vec!["cron".to_owned(), "cron_action_run_mutation".to_owned()];
    manifest.functions.push(action);

    manifest.cron_jobs = vec![CronJobDefinition {
        name: "nestedReentry".to_owned(),
        schedule: CronSchedule {
            every_ms: Some(60_000),
            cron: None,
        },
        action: "nestedAction".to_owned(),
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

/// LLP 0032 S5.D4 — a post-commit fan-out failure for one subscription is a
/// per-subscription diagnostic plus a resync signal; it never fails the
/// already-committed mutation and never starves the other subscribers.
#[test]
fn s5_d4_fanout_failure_does_not_fail_mutation_or_starve_others() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(ibex_fanout_failure_functions());

    // Healthy subscriber and a subscriber whose query throws once a todo exists.
    snapback
        .subscribe_live(
            "listAllTodos",
            LiveSubscribeInput {
                connection_id: "healthy".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("healthy subscribe");
    snapback
        .subscribe_live(
            "explodeOnItems",
            LiveSubscribeInput {
                connection_id: "exploding".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("exploding subscribe (empty snapshot is fine)");

    // The mutation commits; its fan-out re-runs both subscriptions, one of
    // which now throws. The mutation must still succeed.
    let commit = snapback
        .invoke_mutation("createTodo", input(json!({ "title": "boom" }), "user_1"))
        .expect("mutation must succeed despite a fan-out failure");
    assert_eq!(commit.changed_count, 1);

    // The healthy subscriber still got its live update.
    let healthy = snapback.drain_outbox("healthy");
    let RealtimeEnvelope::Durable(message) = &healthy[0] else {
        panic!("expected a durable update for the healthy subscriber");
    };
    let update: Value = serde_json::from_slice(&message.payload).expect("healthy update json");
    assert_eq!(update["kind"], "live_replace");

    // The failing subscriber got a resync signal instead of silence.
    let exploding = snapback.drain_outbox("exploding");
    let RealtimeEnvelope::Durable(message) = &exploding[0] else {
        panic!("expected a durable resync for the failing subscriber");
    };
    let signal: Value = serde_json::from_slice(&message.payload).expect("resync json");
    assert_eq!(signal["kind"], "resync_required");
    assert_eq!(signal["reason"], "live_refresh_failed");

    // The failure is counted and a diagnostic was recorded.
    let inspect = snapback.inspect().expect("inspect");
    assert_eq!(inspect.live_delivery.total_failed, 1);
    assert!(
        inspect
            .recent_diagnostics
            .iter()
            .any(|d| d.details["reason"] == "live_refresh_failed"),
        "a per-subscription fan-out diagnostic should be recorded"
    );
}

fn ibex_fanout_failure_functions() -> FunctionManifest {
    const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async listAllTodos(ctx) {
    return await ctx.db.query('todos').order('_createdAt', 'asc').collect();
  },
  async explodeOnItems(ctx) {
    const rows = await ctx.db.query('todos').collect();
    if (rows.length > 0) throw new Error('boom on re-run');
    return rows;
  },
  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', {
      title: args.title, completed: false, userId: ctx.auth.userId,
    });
  }
};
"#;
    let mut manifest = FunctionManifest::default();

    for export in ["listAllTodos", "explodeOnItems"] {
        let mut query = FunctionDefinition::new(
            export,
            FunctionKind::LiveQuery,
            FunctionRuntime::IbexModule(IbexModule {
                source: SOURCE.to_owned(),
                export: export.to_owned(),
            }),
        );
        query.required_capabilities = vec![
            "live_subscriptions".to_owned(),
            "ibex_ctx_db_host_bridge".to_owned(),
        ];
        query.read_set_summary.primary_table = Some("todos".to_owned());
        query.read_set_summary.tables = vec!["todos".to_owned()];
        query.read_set_summary.mode = Some("handlerDeclared".to_owned());
        manifest.functions.push(query);
    }

    let mut create = FunctionDefinition::new(
        "createTodo",
        FunctionKind::Mutation,
        FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: "createTodo".to_owned(),
        }),
    );
    create.required_capabilities = vec![
        "ibex_ctx_db_host_bridge".to_owned(),
        "mutation_read_set_validation".to_owned(),
    ];
    create.write_set_summary.primary_table = Some("todos".to_owned());
    create.write_set_summary.tables = vec!["todos".to_owned()];
    create.write_set_summary.mode = Some("handlerDeclared".to_owned());
    manifest.functions.push(create);

    manifest
}

/// LLP 0032 E2 — read-your-writes: a handler's buffered writes are visible to
/// its own later reads. insert-then-query sees the row, get returns it,
/// patch-after-buffered-insert reports existed:true and the patched value,
/// and delete-then-get misses.
#[test]
fn e2_handler_reads_its_own_buffered_writes() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    let mut functions = ibex_todo_functions(RYW_HANDLER_SOURCE);
    let mut ryw = FunctionDefinition::new(
        "ryw",
        FunctionKind::Mutation,
        FunctionRuntime::IbexModule(IbexModule {
            source: RYW_HANDLER_SOURCE.to_owned(),
            export: "ryw".to_owned(),
        }),
    );
    ryw.required_capabilities = vec![
        "ibex_ctx_db_host_bridge".to_owned(),
        "mutation_read_set_validation".to_owned(),
    ];
    ryw.write_set_summary.primary_table = Some("todos".to_owned());
    ryw.write_set_summary.tables = vec!["todos".to_owned()];
    ryw.write_set_summary.mode = Some("handlerDeclared".to_owned());
    functions.functions.push(ryw);
    snapback.load_functions(functions);

    // Two committed rows so the in-handler query has existing rows to merge with.
    for title in ["first", "second"] {
        snapback
            .invoke_mutation("createTodo", input(json!({ "title": title }), "u"))
            .expect("seed todo");
    }

    let commit = snapback
        .invoke_mutation("ryw", input(json!({}), "u"))
        .expect("read-your-writes mutation");
    let r = &commit.result;

    // insert-then-query sees the buffered row layered over the committed rows.
    assert_eq!(
        r["queryCount"], 3,
        "buffered insert must appear in the query"
    );
    assert_eq!(r["queryHasBuffered"], true);
    // get returns the buffered row.
    assert_eq!(r["gotTitle"], "buffered");
    // patch-after-buffered-insert: existed is true and the patched value is read back.
    assert_eq!(r["patchExisted"], true);
    assert_eq!(r["completedAfterPatch"], true);
    // delete-then-get misses.
    assert_eq!(r["deleteExisted"], true);
    assert_eq!(r["afterDeleteNull"], true);
}

#[test]
fn bounded_read_your_writes_overfetch_fills_top_n_after_buffered_delete() {
    const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', { title: args.title, completed: false, userId: 'u' });
  },
  async deleteThenTopTwo(ctx, args) {
    await ctx.db.delete('todos', args.id);
    return await ctx.db.query('todos').order('_createdAt', 'asc').take(2).collect();
  }
};
"#;
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("schema");
    let mut functions = ibex_todo_functions(SOURCE);
    let mut query_after_delete = FunctionDefinition::new(
        "deleteThenTopTwo",
        FunctionKind::Mutation,
        FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: "deleteThenTopTwo".to_owned(),
        }),
    );
    query_after_delete.required_capabilities = vec![
        "ibex_ctx_db_host_bridge".to_owned(),
        "mutation_read_set_validation".to_owned(),
    ];
    query_after_delete.write_set_summary.tables = vec!["todos".to_owned()];
    functions.functions.push(query_after_delete);
    snapback.load_functions(functions);
    let mut ids = Vec::new();
    for title in ["one", "two", "three"] {
        ids.push(
            snapback
                .invoke_mutation("createTodo", input(json!({ "title": title }), "u"))
                .unwrap()
                .result
                .as_str()
                .unwrap()
                .to_owned(),
        );
    }
    let output = snapback
        .invoke_mutation("deleteThenTopTwo", input(json!({ "id": ids[0] }), "u"))
        .expect("bounded overlay query");
    let rows = output.result.as_array().expect("rows");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["title"], "two");
    assert_eq!(rows[1]["title"], "three");
}

#[test]
fn buffered_query_captures_exact_overfetch_and_out_of_range_touched_row() {
    const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', { title: args.title, completed: false, userId: 'u' });
  },
  async insertThenTopTwo(ctx) {
    const id = await ctx.db.insert('todos', {
      title: 'zzzz', completed: false, userId: 'u',
    });
    const rows = await ctx.db.query('todos').order('title', 'asc').take(2).collect();
    return { id, rows };
  }
};
"#;
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("schema");
    let mut functions = ibex_todo_functions(SOURCE);
    let mut query_after_insert = FunctionDefinition::new(
        "insertThenTopTwo",
        FunctionKind::Mutation,
        FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: "insertThenTopTwo".to_owned(),
        }),
    );
    query_after_insert.required_capabilities = vec![
        "ibex_ctx_db_host_bridge".to_owned(),
        "mutation_read_set_validation".to_owned(),
    ];
    query_after_insert.write_set_summary.tables = vec!["todos".to_owned()];
    functions.functions.push(query_after_insert);
    snapback.load_functions(functions);

    for title in ["a", "b", "c"] {
        snapback
            .invoke_mutation("createTodo", input(json!({ "title": title }), "u"))
            .expect("seed todo");
    }
    let output = snapback.run_function("insertThenTopTwo", input(json!({}), "u"));
    assert!(output.ok, "{output:?}");
    let result = output.result.as_ref().expect("handler result");
    let inserted_id = result["id"].as_str().expect("inserted id");
    let rows = result
        .get("rows")
        .and_then(Value::as_array)
        .expect("query rows");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["title"], "a");
    assert_eq!(rows[1]["title"], "b");

    let query_dependencies = output
        .captured_reads
        .iter()
        .filter(|dependency| dependency.kind == CapturedReadKind::Query)
        .collect::<Vec<_>>();
    assert_eq!(query_dependencies.len(), 1);
    assert_eq!(query_dependencies[0].limit, Some(3));
    assert_eq!(query_dependencies[0].result_count, Some(3));
    assert!(
        output.captured_reads.iter().any(|dependency| {
            dependency.kind == CapturedReadKind::MissingRow
                && dependency.id.as_deref() == Some(inserted_id)
        }),
        "the buffered insert outside the overfetch window must capture its storage miss"
    );
}

#[test]
fn handler_buffered_write_ceiling_rejects_and_rolls_back() {
    const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async tooManyWrites(ctx) {
    for (let i = 0; i < 1025; i++) {
      await ctx.db.insert('todos', { title: 'x', completed: false, userId: 'u' });
    }
    return true;
  }
};
"#;
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("schema");
    let mut manifest = FunctionManifest::default();
    let mut function = FunctionDefinition::new(
        "tooManyWrites",
        FunctionKind::Mutation,
        FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: "tooManyWrites".to_owned(),
        }),
    );
    function.required_capabilities = vec!["ibex_ctx_db_host_bridge".to_owned()];
    function.write_set_summary.tables = vec!["todos".to_owned()];
    manifest.functions.push(function);
    snapback.load_functions(manifest);
    let error = snapback
        .invoke_mutation("tooManyWrites", input(json!({}), "u"))
        .expect_err("1025th buffered write must reject");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED"
    );
    assert_eq!(
        snapback.inspect().unwrap().storage.version,
        0,
        "rejected buffered writes must not commit"
    );
}

#[test]
fn repeated_handler_point_reads_are_deduped() {
    const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', { title: args.title, completed: false, userId: 'u' });
  },
  async repeatGets(ctx, args) {
    for (let i = 0; i < 20; i++) {
      await ctx.db.get('todos', args.id);
    }
    return true;
  }
};
"#;
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("schema");
    let mut functions = ibex_todo_functions(SOURCE);
    let mut repeat = FunctionDefinition::new(
        "repeatGets",
        FunctionKind::Mutation,
        FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: "repeatGets".to_owned(),
        }),
    );
    repeat.required_capabilities = vec![
        "ibex_ctx_db_host_bridge".to_owned(),
        "mutation_read_set_validation".to_owned(),
    ];
    repeat.write_set_summary.tables = vec!["todos".to_owned()];
    functions.functions.push(repeat);
    snapback.load_functions(functions);

    let id = snapback
        .invoke_mutation("createTodo", input(json!({ "title": "dedupe" }), "u"))
        .expect("create")
        .result
        .as_str()
        .unwrap()
        .to_owned();
    let result = snapback.run_function("repeatGets", input(json!({ "id": id }), "u"));
    assert!(result.ok, "{result:?}");
    let row_reads = result
        .captured_reads
        .iter()
        .filter(|dependency| dependency.kind == CapturedReadKind::Row)
        .count();
    assert_eq!(row_reads, 1, "repeated identical reads should dedupe");
}

#[test]
fn query_builder_first_restores_limit_after_throw() {
    const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', { title: args.title, completed: false, userId: 'u' });
  },
  async firstThenCollect(ctx) {
    try {
      await ctx.db.query('missingTable').first();
    } catch (_) {}
    return [(await ctx.db.query('todos').collect()).length];
  }
};
"#;
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("schema");
    let mut functions = ibex_todo_functions(SOURCE);
    let query = FunctionDefinition::new(
        "firstThenCollect",
        FunctionKind::Query,
        FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: "firstThenCollect".to_owned(),
        }),
    );
    functions.functions.push(query);
    snapback.load_functions(functions);

    for title in ["one", "two"] {
        snapback
            .invoke_mutation("createTodo", input(json!({ "title": title }), "u"))
            .expect("create");
    }
    let output = snapback
        .invoke_query("firstThenCollect", input(json!({}), "u"))
        .expect("query after failed first");
    assert_eq!(output.rows, vec![json!(2)]);
}

#[test]
fn handler_collect_refuses_the_implicit_ceiling_and_supports_an_explicit_prefix() {
    const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async implicitTail(ctx) {
    const rows = await ctx.db.query('todos').withIndex('by_user').eq('userId', 'u').collect();
    rows.sort((left, right) => right.rank - left.rank);
    return rows.slice(0, 1);
  },
  async explicitTail(ctx) {
    return await ctx.db
      .query('todos')
      .withIndex('by_user')
      .eq('userId', 'u')
      .order('rank', 'desc')
      .take(1)
      .collect();
  }
};
"#;
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("schema");
    let mut functions = FunctionManifest::default();
    for name in ["implicitTail", "explicitTail"] {
        let mut function = FunctionDefinition::new(
            name,
            FunctionKind::Query,
            FunctionRuntime::IbexModule(IbexModule {
                source: SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        );
        function.required_capabilities = vec!["ibex_ctx_db_host_bridge".to_owned()];
        function.read_set_summary.primary_table = Some("todos".to_owned());
        function.read_set_summary.tables = vec!["todos".to_owned()];
        function.read_set_summary.mode = Some("handlerDeclared".to_owned());
        functions.functions.push(function);
    }
    snapback.load_functions(functions);
    let rows = (0..1_025)
        .map(|rank| {
            Map::from_iter([
                ("_id".to_owned(), json!(format!("todo-{rank:04}"))),
                ("title".to_owned(), json!(format!("todo {rank}"))),
                ("completed".to_owned(), json!(false)),
                ("rank".to_owned(), json!(rank)),
                ("userId".to_owned(), json!("u")),
            ])
        })
        .collect();
    snapback
        .seed(SeedData {
            tables: BTreeMap::from([("todos".to_owned(), rows)]),
        })
        .expect("seed over-cap table");

    let error = snapback
        .invoke_query("implicitTail", input(json!({}), "u"))
        .expect_err("an implicit 1,024-row prefix cannot masquerade as complete");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"
    );
    assert_eq!(
        error.diagnostic.message,
        "query collect reached the implicit 1024-row cap; add order(...).take(n) for an intentional bounded prefix",
        "moving completeness detection into the host must preserve the documented one-shot message"
    );
    assert!(
        error.is_trusted_query_contract_refusal(),
        "the one-shot refusal is host-established even though only live re-query consumes its provenance"
    );

    let output = snapback
        .invoke_query("explicitTail", input(json!({}), "u"))
        .expect("an explicitly ordered and bounded prefix is intentional");
    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.rows[0]["rank"], 1_024);

    snapback.reset().expect("reset over-cap fixture");
    let exactly_at_cap = (0..1_024)
        .map(|rank| {
            Map::from_iter([
                ("_id".to_owned(), json!(format!("todo-{rank:04}"))),
                ("title".to_owned(), json!(format!("todo {rank}"))),
                ("completed".to_owned(), json!(false)),
                ("rank".to_owned(), json!(rank)),
                ("userId".to_owned(), json!("u")),
            ])
        })
        .collect();
    snapback
        .seed(SeedData {
            tables: BTreeMap::from([("todos".to_owned(), exactly_at_cap)]),
        })
        .expect("seed exactly-at-cap table");
    let error = snapback
        .invoke_query("implicitTail", input(json!({}), "u"))
        .expect_err("exactly 1,024 rows must conservatively require an explicit limit");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"
    );
}

const RYW_HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async listTodos(ctx) {
    return await ctx.db.query('todos').order('_createdAt', 'asc').collect();
  },
  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', {
      title: args.title, completed: false, userId: 'u',
    });
  },
  async setCompleted(ctx, args) {
    const todo = await ctx.db.get('todos', args.id);
    if (!todo) return 0;
    return (await ctx.db.patch('todos', args.id, { completed: args.completed })) ? 1 : 0;
  },
  async deleteTodo(ctx, args) {
    const todo = await ctx.db.get('todos', args.id);
    if (!todo) return 0;
    return (await ctx.db.delete('todos', args.id)) ? 1 : 0;
  },
  async ryw(ctx) {
    const id = await ctx.db.insert('todos', { title: 'buffered', completed: false, userId: 'u' });
    const q = await ctx.db.query('todos').order('_createdAt', 'asc').collect();
    const got = await ctx.db.get('todos', id);
    const patchExisted = await ctx.db.patch('todos', id, { completed: true });
    const gotPatched = await ctx.db.get('todos', id);
    const deleteExisted = await ctx.db.delete('todos', id);
    const gotDeleted = await ctx.db.get('todos', id);
    return {
      queryCount: q.length,
      queryHasBuffered: q.some((row) => row.title === 'buffered'),
      gotTitle: got ? got.title : null,
      patchExisted,
      completedAfterPatch: gotPatched ? gotPatched.completed : null,
      deleteExisted,
      afterDeleteNull: gotDeleted === null,
    };
  }
};
"#;

/// LLP 0032 E5 — a query that declares an index the table does not define fails
/// closed with a structured diagnostic, instead of silently ignoring the hint.
#[test]
fn e5_unknown_index_fails_closed() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    let mut ok_manifest = FunctionManifest::default();
    ok_manifest.functions.push(FunctionDefinition::new(
        "goodIndex",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: Some("by_user".to_owned()),
        })),
    ));
    snapback.load_functions(ok_manifest);
    snapback
        .invoke_query("goodIndex", input(json!({}), "user_1"))
        .expect("declared index resolves");

    let mut manifest = FunctionManifest::default();
    manifest.functions.push(FunctionDefinition::new(
        "badIndex",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: Some("does_not_exist".to_owned()),
        })),
    ));
    let diagnostics = snapback.load_functions(manifest);
    assert_eq!(diagnostics[0].code, "SNAPBACK_QUERY_UNKNOWN_INDEX");
    assert!(snapback.function_definition("badIndex").is_none());
    snapback
        .invoke_query("goodIndex", input(json!({}), "user_1"))
        .expect("invalid artifact must preserve the prior generation");
}

#[test]
fn whole_manifest_rejects_cumulative_in_budget_before_atomic_install() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(todo_functions());

    let filter = |field: &str| FilterExpr {
        field: field.to_owned(),
        op: FilterOp::In,
        value: ValueExpr::Literal(json!(vec!["x"; 300])),
    };
    let mut invalid = FunctionManifest::default();
    invalid.functions.push(FunctionDefinition::new(
        "tooManyBindings",
        FunctionKind::Query,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: vec![filter("title"), filter("userId")],
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        })),
    ));
    let diagnostics = snapback.load_functions(invalid);
    assert_eq!(diagnostics[0].code, "SNAPBACK_QUERY_IN_ITEMS_EXCEEDED");
    assert!(snapback.function_definition("tooManyBindings").is_none());
    snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect("prior function generation remains installed");
}

#[test]
fn whole_manifest_rejects_invalid_query_expressions_before_atomic_install() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(todo_functions());

    let mut over_depth = ValueExpr::Literal(json!(true));
    for _ in 0..=snapback::value_expr::MAX_EXPR_DEPTH {
        over_depth = ValueExpr::Field {
            base: Box::new(over_depth),
            key: "nested".to_owned(),
        };
    }
    let cases = [
        (
            ValueExpr::Call {
                func: "notPinned".to_owned(),
                args: Vec::new(),
            },
            "SNAPBACK_EXPR_UNSUPPORTED_FUNCTION",
        ),
        (over_depth, "SNAPBACK_PLAN_BOUNDS"),
    ];
    for (index, (expression, expected_code)) in cases.into_iter().enumerate() {
        let name = format!("invalidQueryExpression{index}");
        let mut invalid = FunctionManifest::default();
        invalid.functions.push(FunctionDefinition::new(
            &name,
            FunctionKind::Query,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table_visibility: None,
                table: "todos".to_owned(),
                filters: vec![FilterExpr {
                    field: "title".to_owned(),
                    op: FilterOp::Eq,
                    value: expression,
                }],
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })),
        ));
        let diagnostics = snapback.load_functions(invalid);
        assert_eq!(diagnostics[0].code, expected_code);
        assert!(snapback.function_definition(&name).is_none());
        snapback
            .invoke_query("listTodos", input(json!({}), "user_1"))
            .expect("invalid query artifact must preserve the prior generation");
    }
}

#[test]
fn whole_manifest_rejects_unbounded_or_invalid_actions_before_atomic_install() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(todo_functions());

    let step = |args, bind_result_as| ActionStep::RunMutation {
        name: "createTodo".to_owned(),
        args,
        bind_result_as,
    };
    let ordinary = || step(BTreeMap::new(), None);
    let mut over_depth = ValueExpr::Literal(json!(true));
    for _ in 0..=snapback::value_expr::MAX_EXPR_DEPTH {
        over_depth = ValueExpr::Field {
            base: Box::new(over_depth),
            key: "nested".to_owned(),
        };
    }
    let cases = vec![
        (
            ActionPlan {
                steps: vec![ordinary(); snapback::value_expr::MAX_PLAN_STEPS + 1],
                return_value: None,
            },
            "SNAPBACK_PLAN_BOUNDS",
        ),
        (
            ActionPlan {
                steps: vec![step(
                    BTreeMap::from([(
                        "title".to_owned(),
                        ValueExpr::Literal(json!(
                            "x".repeat(snapback::value_expr::MAX_PLAN_SERIALIZED_BYTES)
                        )),
                    )]),
                    None,
                )],
                return_value: None,
            },
            "SNAPBACK_PLAN_BOUNDS",
        ),
        (
            ActionPlan {
                steps: vec![step(
                    BTreeMap::from([(
                        "title".to_owned(),
                        ValueExpr::Call {
                            func: "notPinned".to_owned(),
                            args: Vec::new(),
                        },
                    )]),
                    None,
                )],
                return_value: None,
            },
            "SNAPBACK_EXPR_UNSUPPORTED_FUNCTION",
        ),
        (
            ActionPlan {
                steps: vec![step(
                    BTreeMap::from([("title".to_owned(), over_depth)]),
                    None,
                )],
                return_value: None,
            },
            "SNAPBACK_PLAN_BOUNDS",
        ),
        (
            ActionPlan {
                steps: vec![step(BTreeMap::new(), Some("not valid".to_owned()))],
                return_value: None,
            },
            "SNAPBACK_PLAN_INVALID",
        ),
        (
            ActionPlan {
                steps: vec![
                    step(BTreeMap::new(), Some("duplicate".to_owned())),
                    step(BTreeMap::new(), Some("duplicate".to_owned())),
                ],
                return_value: None,
            },
            "SNAPBACK_PLAN_INVALID",
        ),
        (
            ActionPlan {
                steps: vec![ordinary()],
                return_value: Some(ActionReturnValue::Binding("missing".to_owned())),
            },
            "SNAPBACK_BINDING_MISSING",
        ),
    ];
    for (index, (plan, expected_code)) in cases.into_iter().enumerate() {
        let name = format!("invalidActionPlan{index}");
        let mut invalid = todo_functions();
        invalid.functions.push(FunctionDefinition::new(
            &name,
            FunctionKind::Action,
            FunctionRuntime::HostPlan(HandlerPlan::Action(plan)),
        ));
        let diagnostics = snapback.load_functions(invalid);
        assert_eq!(diagnostics[0].code, expected_code, "case {index}");
        assert!(snapback.function_definition(&name).is_none());
        snapback
            .invoke_query("listTodos", input(json!({}), "user_1"))
            .expect("invalid action artifact must preserve the prior generation");
    }
}

#[test]
fn query_filter_bind_budget_counts_every_filter_operand() {
    let mut db = LocalDatabase::memory().expect("memory db");
    db.schema_seed()
        .apply_schema(todo_schema())
        .expect("schema");

    let plan = |in_value: ValueExpr| QueryPlan {
        table_visibility: None,
        table: "todos".to_owned(),
        filters: vec![
            FilterExpr {
                field: "title".to_owned(),
                op: FilterOp::In,
                value: in_value,
            },
            FilterExpr {
                field: "userId".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Literal(json!("u")),
            },
        ],
        order: Vec::new(),
        limit: None,
        membership_filters: Vec::new(),
        indexed_by: None,
    };

    db.query_reads_read()
        .query(
            &plan(ValueExpr::Literal(json!(vec!["x"; 499]))),
            &input(json!({}), "u"),
        )
        .expect("499 In values plus one equality stay within the 500-bind cap");

    let static_error = db
        .query_reads_read()
        .query(
            &plan(ValueExpr::Literal(json!(vec!["x"; 500]))),
            &input(json!({}), "u"),
        )
        .expect_err("500 In values plus one equality must exceed the total bind cap");
    assert_eq!(
        static_error.diagnostic.code,
        "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED"
    );

    let dynamic_error = db
        .query_reads_read()
        .query(
            &plan(ValueExpr::Arg("values".to_owned())),
            &input(json!({ "values": vec!["x"; 500] }), "u"),
        )
        .expect_err("runtime-sized In operands must share the same total bind cap");
    assert_eq!(
        dynamic_error.diagnostic.code,
        "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED"
    );
}

#[test]
fn query_filter_values_match_declared_and_system_field_types() {
    let mut schema = todo_schema();
    schema.tables[0].fields.push(FieldManifest {
        name: "score".to_owned(),
        field_type: FieldType::Real,
        optional: false,
    });
    let mut db = LocalDatabase::memory().expect("memory db");
    db.schema_seed().apply_schema(schema).expect("schema");

    let plan = |field: &str, op: FilterOp, value: Value| QueryPlan {
        table_visibility: None,
        table: "todos".to_owned(),
        filters: vec![FilterExpr {
            field: field.to_owned(),
            op,
            value: ValueExpr::Literal(value),
        }],
        order: Vec::new(),
        limit: None,
        membership_filters: Vec::new(),
        indexed_by: None,
    };

    for (field, op, value) in [
        ("title", FilterOp::Eq, json!("todo")),
        ("completed", FilterOp::Eq, json!(true)),
        ("rank", FilterOp::Eq, json!(-9_007_199_254_740_991_i64)),
        ("rank", FilterOp::Eq, json!(1.0)),
        ("rank", FilterOp::Eq, Value::Null),
        ("score", FilterOp::Eq, json!(1.5)),
        ("_id", FilterOp::Eq, json!("todo-1")),
        ("_version", FilterOp::Eq, json!(0)),
        ("_version", FilterOp::Eq, json!(1.0)),
        ("_createdAt", FilterOp::Eq, json!(9_007_199_254_740_991_i64)),
    ] {
        db.query_reads_read()
            .query(&plan(field, op, value), &input(json!({}), "u"))
            .unwrap_or_else(|error| panic!("valid {field} filter failed: {error:?}"));
    }

    for (field, op, value) in [
        ("title", FilterOp::Eq, json!(1)),
        ("title", FilterOp::Eq, Value::Null),
        ("completed", FilterOp::Eq, json!("true")),
        ("rank", FilterOp::Eq, json!(9_007_199_254_740_992_i64)),
        ("score", FilterOp::Eq, json!("1.5")),
        ("_id", FilterOp::Eq, json!(1)),
        ("_version", FilterOp::Eq, json!(-1)),
        ("_updatedAt", FilterOp::Eq, json!("now")),
        ("title", FilterOp::In, json!(["todo", 1])),
    ] {
        let error = db
            .query_reads_read()
            .query(&plan(field, op, value), &input(json!({}), "u"))
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_QUERY_FILTER_VALUE_INVALID",
            "wrong diagnostic for {field}"
        );
    }
}

#[test]
fn ibex_query_filter_boundaries_preserve_portable_diagnostics() {
    const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async listTodos(ctx, args) {
    const query = ctx.db.query('todos');
    if (args.mode === 'bindings') {
      for (let index = 0; index < 501; index += 1) query.eq('title', 'todo');
    } else {
      query.eq('title', 1);
    }
    return await query.collect();
  },
  async createTodo() { return null; },
  async setCompleted() { return null; },
  async deleteTodo() { return null; },
};
"#;

    let snapback = configured_ibex_snapback(SOURCE);
    let bindings = snapback
        .invoke_query("listTodos", input(json!({ "mode": "bindings" }), "u"))
        .expect_err("the JS builder must reject 501 scalar filter binds");
    assert_eq!(
        bindings.diagnostic.code,
        "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED"
    );

    let wrong_type = snapback
        .invoke_query("listTodos", input(json!({ "mode": "type" }), "u"))
        .expect_err("the host boundary must reject a numeric String filter");
    assert_eq!(
        wrong_type.diagnostic.code,
        "SNAPBACK_QUERY_FILTER_VALUE_INVALID"
    );
}

#[test]
fn query_without_take_uses_the_portable_default_result_cap() {
    let mut db = LocalDatabase::memory().expect("memory db");
    db.schema_seed()
        .apply_schema(todo_schema())
        .expect("schema");
    let rows = (0..1_025)
        .map(|index| {
            json!({
                "_id": format!("todo-{index:04}"),
                "title": format!("todo {index}"),
                "completed": false,
                "userId": "u"
            })
            .as_object()
            .cloned()
            .unwrap()
        })
        .collect();
    db.schema_seed()
        .seed(SeedData {
            tables: BTreeMap::from([("todos".to_owned(), rows)]),
        })
        .expect("seed over-cap table");
    let output = db
        .query_reads_read()
        .query(
            &QueryPlan {
                table_visibility: None,
                table: "todos".to_owned(),
                filters: Vec::new(),
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            },
            &input(json!({}), "u"),
        )
        .expect("bounded query");
    assert_eq!(output.rows.len(), 1_024);
}

#[test]
fn duplicate_identity_and_overflowing_jitter_preserve_function_generation() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(todo_functions());

    let mut self_alias = todo_functions();
    self_alias.functions[0].id = self_alias.functions[0].name.clone();
    let diagnostics = snapback.load_functions(self_alias);
    assert!(
        diagnostics.iter().all(
            |diagnostic| diagnostic.severity != snapback::diagnostic::DiagnosticSeverity::Error
        ),
        "an id equal to its own function name is one unambiguous identity"
    );

    let mut duplicate = todo_functions();
    duplicate.functions.push(duplicate.functions[0].clone());
    let diagnostics = snapback.load_functions(duplicate);
    assert_eq!(diagnostics[0].code, "SNAPBACK_FUNCTION_IDENTITY_COLLISION");
    assert!(snapback.function_definition("listTodos").is_some());

    let mut bad_jitter = todo_functions_with_cron(false);
    bad_jitter.cron_jobs[0].jitter_policy.enabled = true;
    bad_jitter.cron_jobs[0].jitter_policy.max_offset_ms = u64::MAX;
    let diagnostics = snapback.load_functions(bad_jitter);
    assert!(
        diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "SNAPBACK_CRON_JITTER_INVALID")
    );
    snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect("invalid cron metadata cannot partially replace functions");
}

/// ENG-24905 / LLP 0012 §V0 Function Manifest — the stable function id is
/// required. A manifest JSON that omits `id` still parses (so the refusal is
/// a typed diagnostic, not an opaque serde error), but it fails load with
/// `SNAPBACK_FUNCTION_IDENTITY_INVALID` and leaves the prior known-good
/// function generation serving (the ENG-24572 atomic-install rule).
#[test]
fn manifest_missing_function_id_fails_load_typed_and_preserves_generation() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    let diagnostics = snapback.load_functions(todo_functions());
    assert!(
        diagnostics.iter().all(
            |diagnostic| diagnostic.severity != snapback::diagnostic::DiagnosticSeverity::Error
        ),
        "baseline generation loads clean"
    );

    // Strip every function `id` from the serialized manifest JSON: the wire
    // form a pre-ENG-24905 generator would have produced.
    let mut manifest_json = serde_json::to_value(todo_functions()).expect("serialize manifest");
    let functions_json = manifest_json["functions"]
        .as_array_mut()
        .expect("functions array");
    assert!(!functions_json.is_empty());
    for function in functions_json.iter_mut() {
        let removed = function
            .as_object_mut()
            .expect("function object")
            .remove("id");
        assert!(removed.is_some(), "fixture functions carry ids");
    }
    let missing_id: FunctionManifest =
        serde_json::from_value(manifest_json).expect("absent id parses so the refusal is typed");

    let diagnostics = snapback.load_functions(missing_id);
    let refusal = diagnostics
        .iter()
        .find(|diagnostic| diagnostic.code == "SNAPBACK_FUNCTION_IDENTITY_INVALID")
        .expect("missing function id fails load with the typed identity diagnostic");
    assert!(
        refusal
            .message
            .contains("missing the required stable function id"),
        "diagnostic names the missing id: {}",
        refusal.message
    );

    // The invalid generation must not partially install: the prior functions
    // keep serving and their stable ids are intact.
    assert!(snapback.function_definition("listTodos").is_some());
    assert_eq!(
        snapback
            .function_definition("listTodos")
            .expect("prior generation serving")
            .id,
        "fn:listTodos"
    );
    snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect("prior generation still invocable after the typed refusal");
}

/// LLP 0032 L5 — idle means idle: an instance with no armed cron work performs
/// no periodic cron-state disk writes, and the ticker's activity flag is off so
/// it never takes the global lock.
#[test]
fn l5_idle_instance_performs_no_periodic_cron_writes() {
    use std::sync::atomic::Ordering;
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("apply schema");
    snapback.load_functions(todo_functions()); // no cron jobs

    // No cron jobs loaded → the ticker skips the global lock entirely.
    assert!(!snapback.cron_activity_flag().load(Ordering::Relaxed));

    let writes_after_load = snapback.cron_state_writes();
    // Many idle ticks: nothing is due or armed, so the cron state never changes
    // and is never re-persisted.
    for tick in 1..30 {
        snapback.tick_cron(tick * 1_000).expect("idle tick");
    }
    assert_eq!(
        snapback.cron_state_writes(),
        writes_after_load,
        "idle ticks must not write cron state to disk"
    );
}

/// LLP 0032 L9 (MEDIUM finding 2) — an `EphemeralApi::subscribe` racing a
/// write-lane `disconnect` for the same connection must never leave a
/// registered subscriber with no liveness entry — an unreapable zombie whose
/// room can never prune. The store is off the global mutex, so the two
/// interleave. The fix orders both sides so a surviving registration always
/// implies a surviving activity entry (disconnect removes activity before it
/// removes registrations; the API touches after the store op succeeds).
/// Discriminator: after the race a far-future reap must drive
/// `subscriber_count` to zero — a pre-fix zombie has no activity entry, so the
/// reaper can never see it and this assertion fails.
#[test]
fn l9_reap_vs_revival_subscribe_leaves_no_unreapable_zombie() {
    use std::sync::{Arc, Mutex};

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback
        .register_ephemeral_collection(EphemeralCollection::local_cursor("cursors", "roomId"))
        .unwrap();
    // The off-lock ephemeral lane shares the store and the liveness map with
    // the snapback now behind the write mutex.
    let api = snapback.ephemeral_api();
    let shared = Arc::new(Mutex::new(snapback));

    // Distinct connection ids so a later iteration's disconnect can never mask
    // an earlier zombie: an unreapable subscriber from any round survives to
    // the final far-future reap.
    const ITERATIONS: u64 = 3_000;
    for i in 0..ITERATIONS {
        let connection_id = format!("c-{i}");
        let subscribe = {
            let api = api.clone();
            let connection_id = connection_id.clone();
            thread::spawn(move || {
                // Off the global mutex — races the disconnect below.
                let _ = api.subscribe(
                    SubscribeRequest {
                        collection: "cursors".to_owned(),
                        scope: Scope::from_pairs([("roomId", "room-1")]),
                        connection_id,
                        auth: AuthContext::default(),
                        since_chunk: None,
                    },
                    1_000,
                );
            })
        };
        {
            let mut snapback = shared.lock().expect("write lock");
            snapback.disconnect(&connection_id, 1_000);
        }
        subscribe.join().expect("subscribe thread");
    }

    // Every registration the race left behind must be reapable: a far-future
    // reap clears them all. A single unreapable zombie (registered, no
    // activity) survives and pins its room's subscriber count above zero.
    let mut snapback = shared.lock().expect("write lock");
    snapback.reap_stale_connections(2_000_000_000_000, 120_000);
    let inspect = snapback.inspect().expect("inspect");
    assert_eq!(
        inspect.ephemeral.subscriber_count, 0,
        "an unreapable zombie subscriber survived the far-future reap"
    );
    assert_eq!(
        snapback.active_connection_count(),
        0,
        "every liveness entry must be reapable"
    );
}

/// LLP 0032 L2 — a connection idle past the TTL is reaped: its live
/// subscriptions are torn down and the reap is counted in /inspect. A
/// recently-active connection is left alone.
#[test]
fn l2_abandoned_connection_is_reaped_with_counters() {
    let mut snapback = configured_ibex_snapback(TODO_HANDLER_SOURCE);
    snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "ghost".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe");
    assert_eq!(snapback.active_connection_count(), 1);
    assert_eq!(snapback.inspect().unwrap().active_connections, 1);

    // Reaping with an early clock leaves the recently-seen connection alone.
    assert_eq!(snapback.reap_stale_connections(1_000, 120_000), 0);
    assert_eq!(snapback.active_connection_count(), 1);

    // Idle past the TTL (reap with a clock far in the future) → reaped, and its
    // subscription is torn down.
    let reaped = snapback.reap_stale_connections(2_000_000_000_000, 120_000);
    assert_eq!(reaped, 1);
    assert_eq!(snapback.active_connection_count(), 0);
    assert_eq!(snapback.reaped_connection_count(), 1);

    let inspect = snapback.inspect().unwrap();
    assert_eq!(inspect.active_connections, 0);
    assert_eq!(inspect.reaped_connections, 1);
    assert!(
        inspect.subscriptions.is_empty(),
        "reaping must tear down the connection's subscriptions"
    );
}

/// ENG-23424 — the WS safety net must not immortalize a silently-dead peer.
/// The 30s tick calls `drain_live_stream` even when the outbox is empty; an
/// empty *server-initiated* drain is not liveness and must not create or
/// refresh the connection's L2 activity entry (before the fix it did, keeping
/// a vanished idle subscriber permanently under the reaper's TTL). Client
/// liveness on the WS path is `touch_connection` — the task calls it for the
/// Pong answering the safety-net Ping.
#[test]
fn eng_23424_empty_ws_drain_is_not_liveness() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback
        .register_ephemeral_collection(EphemeralCollection::local_cursor("cursors", "roomId"))
        .unwrap();
    let api = snapback.ephemeral_api();

    // No liveness entry exists for the connection (as after a reap): the
    // safety-net's empty drain must not conjure one.
    assert_eq!(snapback.active_connection_count(), 0);
    assert!(api.drain_live_stream("ghost").is_empty());
    assert_eq!(
        snapback.active_connection_count(),
        0,
        "an empty server-initiated WS drain must not create or refresh liveness"
    );

    // The Pong path IS client-initiated liveness.
    api.touch_connection("ghost");
    assert_eq!(
        snapback.active_connection_count(),
        1,
        "touch_connection (Pong) must register liveness"
    );

    // A drain that actually delivers still counts: subscribe an observer,
    // publish into its room, and the non-empty drain keeps its entry live.
    api.subscribe(
        SubscribeRequest {
            collection: "cursors".to_owned(),
            scope: Scope::from_pairs([("roomId", "room-1")]),
            connection_id: "observer".to_owned(),
            auth: AuthContext::default(),
            since_chunk: None,
        },
        1_000,
    )
    .expect("subscribe observer");
    api.publish(
        PublishRequest {
            collection: "cursors".to_owned(),
            scope: Scope::from_pairs([("roomId", "room-1")]),
            connection_id: "publisher".to_owned(),
            session_id: None,
            user_id: None,
            custom_key: None,
            value: br#"{"x":1,"y":2}"#.to_vec(),
            ttl_ms: None,
            auth: AuthContext::default(),
        },
        1_100,
    )
    .expect("publish");
    assert!(
        !api.drain_live_stream("observer").is_empty(),
        "the published delta reaches the observer's WS drain"
    );
    assert!(
        snapback.active_connection_count() >= 2,
        "a delivering drain refreshes (or keeps) the observer's liveness entry"
    );
}

/// ENG-23427 — reaping a connection whose delivery registration is still
/// current (the WS pump task parked in `sender.send` on a peer that stopped
/// reading: socket open, no select iterations, no activity touches) must not
/// destroy its state silently. The reap seeds a fresh outbox with a durable
/// connection-wide `resync_required` sentinel plus one ephemeral
/// `ResyncRequired` per wiped room, and stores a wake permit so the pump
/// drains them the moment the peer resumes reading. A reaped connection with
/// no registration (an HTTP poller that vanished) gets no sentinel — nothing
/// would ever drain it.
#[test]
fn eng_23427_reap_under_open_registration_signals_resync() {
    use futures_util::FutureExt;

    let mut snapback = configured_ibex_snapback(TODO_HANDLER_SOURCE);
    snapback
        .register_ephemeral_collection(EphemeralCollection::local_cursor("cursors", "roomId"))
        .unwrap();
    let api = snapback.ephemeral_api();

    // A durable live query and an ephemeral room subscription on the frozen
    // WS connection; a plain HTTP-lane connection with the same shape for
    // contrast.
    for connection_id in ["frozen", "poller"] {
        snapback
            .subscribe_live(
                "listTodos",
                LiveSubscribeInput {
                    connection_id: connection_id.to_owned(),
                    input: input(json!({}), "user_1"),
                    authorization_namespace: None,
                    supersedes: None,
                    resume_from_token: None,
                },
            )
            .expect("subscribe live");
        api.subscribe(
            SubscribeRequest {
                collection: "cursors".to_owned(),
                scope: Scope::from_pairs([("roomId", "room-1")]),
                connection_id: connection_id.to_owned(),
                auth: AuthContext::default(),
                since_chunk: None,
            },
            1_000,
        )
        .expect("subscribe ephemeral");
    }

    // "frozen" has an open, registered socket: its pump task registered and
    // is now (conceptually) parked in a blocked `sender.send`.
    let notify = snapback.delivery_notifier();
    let (_generation, waker) = notify.register("frozen").unwrap();

    // Both idle past the TTL → both reaped, all subscriptions destroyed.
    assert_eq!(
        snapback.reap_stale_connections(2_000_000_000_000, 120_000),
        2
    );
    assert!(
        snapback
            .inspect()
            .expect("inspect")
            .subscriptions
            .is_empty(),
        "reaping must tear down both connections' subscriptions"
    );

    // The registered connection got a wake permit: the parked pump task's
    // next select iteration drains instead of sleeping forever.
    assert!(
        waker.notified().now_or_never().is_some(),
        "reap must store a wake permit for the still-registered pump task"
    );

    // ...and its fresh outbox carries the sentinels: durable lane first (the
    // connection-wide resync_required), then the per-room ephemeral resync.
    let drained = snapback.drain_live_stream("frozen");
    assert_eq!(
        drained.len(),
        2,
        "expected the two resync sentinels, got {drained:?}"
    );
    let durable: Value = serde_json::from_str(&drained[0]).expect("durable sentinel json");
    assert_eq!(durable["kind"], "resync_required");
    assert_eq!(durable["reason"], "disconnected");
    assert!(
        durable.get("subscription_id").is_none(),
        "the sentinel is connection-wide: every handle must re-snapshot"
    );
    let ephemeral: Value = serde_json::from_str(&drained[1]).expect("ephemeral sentinel json");
    assert_eq!(ephemeral["kind"], "ephemeral");
    assert_eq!(
        ephemeral["message"]["ResyncRequired"]["reason"],
        "Disconnected"
    );

    // The unregistered connection was wiped without a sentinel — there is no
    // pump to drain an outbox to nowhere.
    assert!(
        snapback.drain_live_stream("poller").is_empty(),
        "a reaped connection with no registration gets no sentinel"
    );
}

/// LLP 0032 L3 — the change journal is bounded by retention (prune drops old
/// changes and raises the floor), a resume from below the retained floor is
/// told to resnapshot, and the per-mutation validation query uses the
/// (table_name, version) index instead of scanning.
#[test]
fn l3_journal_retention_prune_floor_and_index() {
    let mut snapback = configured_ibex_snapback(TODO_HANDLER_SOURCE);
    // Generate a run of committed changes (one per mutation → one version each).
    for n in 0..12 {
        snapback
            .invoke_mutation(
                "createTodo",
                input(json!({ "title": format!("t{n}") }), "user_1"),
            )
            .expect("create todo");
    }
    let before = snapback.change_journal_len().unwrap();
    assert!(
        before >= 12,
        "expected the journal to hold each change, got {before}"
    );
    // Nothing pruned yet → the replay floor is 0 (no resnapshot forced).
    assert_eq!(snapback.journal_floor_version().unwrap(), 0);

    // Prune keeping only the last 3 versions (time window zero → the version
    // window governs). The journal shrinks and the replay floor rises.
    let pruned = snapback
        .prune_change_journal(2_000_000_000_000, 3, 0)
        .expect("prune");
    assert!(pruned > 0, "prune should have dropped old changes");
    let after = snapback.change_journal_len().unwrap();
    assert!(after < before, "journal must shrink: {after} !< {before}");
    let floor = snapback.journal_floor_version().unwrap();
    assert!(
        floor > 1,
        "replay floor must rise after pruning, got {floor}"
    );

    // A resume from below the retained floor must resnapshot; from the floor or
    // later can replay.
    assert!(
        snapback.journal_resume_requires_resnapshot(1).unwrap(),
        "resume from a pruned version must resnapshot"
    );
    assert!(
        !snapback.journal_resume_requires_resnapshot(floor).unwrap(),
        "resume from the retained floor can replay"
    );

    // The validation query uses the (table_name, version) index, not a scan.
    let plan = snapback
        .explain_table_change_version_plan("todos")
        .expect("explain");
    assert!(
        plan.contains("_snapback_changes_by_table_version"),
        "read-set validation must use the table_name index; plan was: {plan}"
    );
    assert!(
        !plan.to_uppercase().contains("SCAN "),
        "plan should not scan: {plan}"
    );
}

#[test]
fn l3_reset_clears_retention_floor() {
    let mut snapback = configured_ibex_snapback(TODO_HANDLER_SOURCE);
    for n in 0..8 {
        snapback
            .invoke_mutation(
                "createTodo",
                input(json!({ "title": format!("t{n}") }), "user_1"),
            )
            .expect("create todo");
    }
    snapback
        .prune_change_journal(2_000_000_000_000, 1, 0)
        .expect("prune");
    assert!(snapback.journal_floor_version().unwrap() > 0);

    snapback.reset().expect("reset");
    assert_eq!(snapback.journal_floor_version().unwrap(), 0);
    assert!(
        !snapback.journal_resume_requires_resnapshot(0).unwrap(),
        "a fresh reset database has no pruned replay gap"
    );
}

/// LLP 0032 L3 — regression for the review's HIGH finding: pruning must never
/// drop a cold table's MAX(version), or read-set validation would spuriously
/// conflict a mutation that only *read* the cold table (captured expected
/// version vs a MAX that collapsed to 0).
#[test]
fn l3_prune_preserves_cold_table_validation_version() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    let mut schema = todo_schema();
    schema.tables.push(TableManifest {
        name: "notes".to_owned(),
        fields: vec![FieldManifest {
            name: "body".to_owned(),
            field_type: FieldType::String,
            optional: false,
        }],
        indexes: Vec::new(),
        syncable: false,
        permission_backing: false,
        permission_fields: None,
        search_indexes: Vec::new(),
        vector_indexes: Vec::new(),
        search_live_limits: None,
        membership: None,
        authority_profile: None,
        asset_sharing: None,
        visibility: None,
        history: None,
    });
    snapback
        .apply_schema(schema)
        .expect("apply two-table schema");

    const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', { title: args.title, completed: false, userId: 'u' });
  },
  async createNote(ctx, args) {
    return await ctx.db.insert('notes', { body: args.body });
  }
};
"#;
    let mut functions = FunctionManifest::default();
    for (name, table) in [("createTodo", "todos"), ("createNote", "notes")] {
        let mut def = FunctionDefinition::new(
            name,
            FunctionKind::Mutation,
            FunctionRuntime::IbexModule(IbexModule {
                source: SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        );
        def.required_capabilities = vec![
            "ibex_ctx_db_host_bridge".to_owned(),
            "mutation_read_set_validation".to_owned(),
        ];
        def.write_set_summary.primary_table = Some(table.to_owned());
        def.write_set_summary.tables = vec![table.to_owned()];
        def.write_set_summary.mode = Some("handlerDeclared".to_owned());
        functions.functions.push(def);
    }
    snapback.load_functions(functions);

    // `notes` changes once (cold), then `todos` changes many times (hot), so
    // `notes`' only change sits far below the version window.
    snapback
        .invoke_mutation("createNote", input(json!({ "body": "keep me" }), "u"))
        .expect("create note");
    let cold_version = snapback.table_change_version("notes").unwrap();
    assert!(cold_version >= 1);
    for n in 0..12 {
        snapback
            .invoke_mutation(
                "createTodo",
                input(json!({ "title": format!("t{n}") }), "u"),
            )
            .expect("create todo");
    }

    snapback
        .prune_change_journal(2_000_000_000_000, 3, 0)
        .expect("prune");

    // The cold table's validation high-water survives, so a mutation that read
    // `notes` will not spuriously conflict.
    assert_eq!(
        snapback.table_change_version("notes").unwrap(),
        cold_version,
        "pruning must preserve a cold table's MAX(version) for read-set validation"
    );
}

#[test]
fn l3_retention_floor_boundary_still_allows_precise_query_validation() {
    let mut schema = todo_schema();
    schema.tables.push(TableManifest {
        name: "notes".to_owned(),
        fields: vec![FieldManifest {
            name: "body".to_owned(),
            field_type: FieldType::String,
            optional: false,
        }],
        indexes: Vec::new(),
        syncable: false,
        permission_backing: false,
        permission_fields: None,
        search_indexes: Vec::new(),
        vector_indexes: Vec::new(),
        search_live_limits: None,
        membership: None,
        authority_profile: None,
        asset_sharing: None,
        visibility: None,
        history: None,
    });
    let mut db = LocalDatabase::memory().unwrap();
    db.schema_seed().apply_schema(schema).unwrap();

    let insert = |db: &mut LocalDatabase, table: &str, id: &str, values: Value| {
        db.mutation_writes()
            .commit_buffered_writes(
                &input(json!({}), "u"),
                vec![BufferedWrite::Insert {
                    table: table.to_owned(),
                    id: id.to_owned(),
                    values: values.as_object().cloned().unwrap(),
                }],
                Vec::new(),
                json!(null),
            )
            .expect("insert")
    };

    db.mutation_writes()
        .commit_buffered_writes(
            &input(json!({}), "u"),
            vec![
                BufferedWrite::Insert {
                    table: "todos".to_owned(),
                    id: "todo-v1".to_owned(),
                    values: json!({ "title": "hot", "completed": false, "userId": "u" })
                        .as_object()
                        .cloned()
                        .unwrap(),
                },
                BufferedWrite::Insert {
                    table: "notes".to_owned(),
                    id: "note-v1".to_owned(),
                    values: json!({ "body": "baseline" }).as_object().cloned().unwrap(),
                },
            ],
            Vec::new(),
            json!(null),
        )
        .expect("seed both tables");
    let captured_notes_version = db.versions().table_change_version("notes").unwrap();
    assert_eq!(captured_notes_version, 1);

    insert(
        &mut db,
        "todos",
        "todo-v2",
        json!({ "title": "hotter", "completed": false, "userId": "u" }),
    );
    db.versions()
        .prune_change_journal(2_000_000_000_000, 0, 0)
        .expect("prune boundary");
    assert_eq!(
        db.versions().journal_floor_version().unwrap(),
        captured_notes_version + 1
    );

    insert(
        &mut db,
        "notes",
        "note-disjoint",
        json!({ "body": "other" }),
    );

    let dependency = CapturedReadDependency {
        graph: None,
        kind: CapturedReadKind::Query,
        table: Some("notes".to_owned()),
        id: None,
        version: Some(captured_notes_version),
        predicate: Some(
            serde_json::to_value(QueryPlan {
                table_visibility: None,
                table: "notes".to_owned(),
                filters: vec![FilterExpr {
                    field: "body".to_owned(),
                    op: FilterOp::Eq,
                    value: ValueExpr::Literal(json!("needle")),
                }],
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })
            .unwrap(),
        ),
        rows: Vec::new(),
        field: None,
        value: None,
        order: None,
        limit: None,
        result_count: Some(0),
        boundary: None,
    };
    let result = db.mutation_writes().commit_buffered_writes(
        &input(json!({}), "u"),
        vec![BufferedWrite::Insert {
            table: "todos".to_owned(),
            id: "reader-write".to_owned(),
            values: json!({ "title": "reader", "completed": false, "userId": "u" })
                .as_object()
                .cloned()
                .unwrap(),
        }],
        vec![dependency],
        json!(null),
    );
    assert!(
        result.is_ok(),
        "when expected + 1 is exactly the floor, all needed changes are retained: {result:?}"
    );
}

/// LLP 0032 E4 — predicate-granularity read-set validation: a captured read of
/// a filtered query conflicts only with writes that actually affect the query's
/// result. A concurrent *non-matching* write no longer conflicts (the
/// table-granularity spurious conflict), while a *matching* write still does.
#[test]
fn e4_query_validation_is_predicate_granular() {
    let filtered_query = || CapturedReadDependency {
        graph: None,
        kind: CapturedReadKind::Query,
        table: Some("todos".to_owned()),
        id: None,
        version: None, // filled per-case with the captured table version
        predicate: Some(
            serde_json::to_value(QueryPlan {
                table_visibility: None,
                table: "todos".to_owned(),
                filters: vec![FilterExpr {
                    field: "completed".to_owned(),
                    op: FilterOp::Eq,
                    value: ValueExpr::Literal(json!(true)),
                }],
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })
            .unwrap(),
        ),
        rows: Vec::new(),
        field: None,
        value: None,
        order: None,
        limit: None,
        result_count: Some(0),
        boundary: None,
    };

    let commit_todo = |db: &mut LocalDatabase, title: &str, completed: bool| {
        let row_id = db.generate_id();
        db.mutation_writes()
            .commit_buffered_writes(
                &input(json!({}), "u"),
                vec![BufferedWrite::Insert {
                    table: "todos".to_owned(),
                    id: row_id,
                    values: json!({ "title": title, "completed": completed, "userId": "u" })
                        .as_object()
                        .cloned()
                        .unwrap(),
                }],
                Vec::new(),
                json!(null),
            )
            .expect("commit concurrent todo");
    };

    // Non-matching concurrent write → no conflict (the E4 win).
    {
        let mut db = LocalDatabase::memory().unwrap();
        db.schema_seed().apply_schema(todo_schema()).unwrap();
        let captured = db.versions().table_change_version("todos").unwrap();
        commit_todo(&mut db, "not-completed", false);
        let mut dep = filtered_query();
        dep.version = Some(captured);
        let row_id = db.generate_id();
        let result = db.mutation_writes().commit_buffered_writes(
            &input(json!({}), "u"),
            vec![BufferedWrite::Insert {
                table: "todos".to_owned(),
                id: row_id,
                values: json!({ "title": "reader-write", "completed": false, "userId": "u" })
                    .as_object()
                    .cloned()
                    .unwrap(),
            }],
            vec![dep],
            json!(null),
        );
        assert!(
            result.is_ok(),
            "a non-matching concurrent write must not conflict a filtered-query reader: {result:?}"
        );
    }

    // Matching concurrent write → conflict (correctness preserved).
    {
        let mut db = LocalDatabase::memory().unwrap();
        db.schema_seed().apply_schema(todo_schema()).unwrap();
        let captured = db.versions().table_change_version("todos").unwrap();
        commit_todo(&mut db, "completed", true);
        let mut dep = filtered_query();
        dep.version = Some(captured);
        let row_id = db.generate_id();
        let error = db
            .mutation_writes()
            .commit_buffered_writes(
                &input(json!({}), "u"),
                vec![BufferedWrite::Insert {
                    table: "todos".to_owned(),
                    id: row_id,
                    values: json!({ "title": "reader-write", "completed": false, "userId": "u" })
                        .as_object()
                        .cloned()
                        .unwrap(),
                }],
                vec![dep],
                json!(null),
            )
            .expect_err("a matching concurrent write must still conflict");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
    }
}

/// ENG-23341 — `apply_schema` must reject a manifest that retypes an existing
/// field (LLP 0003's migrator contract: reject type changes that would require
/// rewriting existing data). The physical column keeps its old affinity, so a
/// silent accept would return values decoded under the old declaration while
/// the schema and generated client types promise the new one.
const REVIEWED_MIGRATION_NEXT_STEP: &str =
    ". Run `snapback migrate preview --help` to start the reviewed migration workflow";

#[test]
fn apply_schema_rejects_field_type_change_on_existing_column() {
    let mut db = LocalDatabase::memory().unwrap();
    db.schema_seed()
        .apply_schema(todo_schema())
        .expect("initial schema");
    let row_id = db.generate_id();
    db.mutation_writes()
        .commit_buffered_writes(
            &input(json!({}), "u"),
            vec![BufferedWrite::Insert {
                table: "todos".to_owned(),
                id: row_id,
                values: json!({ "title": "keep me", "completed": false, "rank": 7, "userId": "u" })
                    .as_object()
                    .cloned()
                    .unwrap(),
            }],
            Vec::new(),
            json!(null),
        )
        .expect("seed row");

    // Retype rank: integer -> string (INTEGER -> TEXT affinity).
    let mut retyped = todo_schema();
    retyped.tables[0]
        .fields
        .iter_mut()
        .find(|field| field.name == "rank")
        .expect("rank field declared")
        .field_type = FieldType::String;
    let error = db
        .schema_seed()
        .apply_schema(retyped)
        .expect_err("retyping an existing field must fail schema apply");
    assert_eq!(error.diagnostic.code, "SNAPBACK_SCHEMA_FIELD_RETYPED");
    assert_eq!(error.diagnostic.details["table"], "todos");
    assert_eq!(error.diagnostic.details["field"], "rank");
    assert_eq!(error.diagnostic.details["existingType"], "Integer");
    assert_eq!(error.diagnostic.details["requestedType"], "String");
    assert_eq!(
        error.diagnostic.message,
        format!(
            "field todos.rank cannot change type from Integer to String; retyping stored data is not supported — add a new field instead{REVIEWED_MIGRATION_NEXT_STEP}"
        ),
        "the complete refusal text is a stable front-door contract"
    );

    // Affinity-preserving retypes still change how stored values decode
    // (string -> json would fail JSON parsing on old rows), so they are
    // rejected too.
    let mut same_affinity = todo_schema();
    same_affinity.tables[0]
        .fields
        .iter_mut()
        .find(|field| field.name == "title")
        .expect("title field declared")
        .field_type = FieldType::Json;
    let error = db
        .schema_seed()
        .apply_schema(same_affinity)
        .expect_err("same-affinity retype must fail schema apply");
    assert_eq!(error.diagnostic.code, "SNAPBACK_SCHEMA_FIELD_RETYPED");
    assert_eq!(
        error.diagnostic.message,
        format!(
            "field todos.title cannot change type from String to Json; retyping stored data is not supported — add a new field instead{REVIEWED_MIGRATION_NEXT_STEP}"
        )
    );

    // The stored manifest is untouched: rank is still declared Integer, and a
    // matching re-apply (the normal redeploy path) still succeeds.
    assert_eq!(
        db.schema().tables[0]
            .field("rank")
            .expect("rank still declared")
            .field_type,
        FieldType::Integer
    );
    db.schema_seed()
        .apply_schema(todo_schema())
        .expect("matching schema re-apply still succeeds");
}

/// ENG-23341 — the physical-affinity backstop: even when the stored manifest
/// no longer declares a table (so the manifest diff cannot see the retype), a
/// re-added table whose declared column affinity disagrees with the surviving
/// physical column is rejected at DDL time rather than silently accepted.
#[test]
fn apply_schema_rejects_affinity_mismatch_with_surviving_physical_column() {
    let mut db = LocalDatabase::memory().unwrap();
    db.schema_seed()
        .apply_schema(todo_schema())
        .expect("initial schema");

    // Drop the table from the manifest; the physical table survives (the
    // migrator preserves removed tables and columns).
    let empty = SchemaManifest {
        schema_hash: Some("todo-v1".to_owned()),
        ..SchemaManifest::default()
    };
    db.schema_seed()
        .apply_schema(empty)
        .expect("table removal is additive");

    // Re-add the table with rank retyped integer -> string: the manifest diff
    // has nothing to compare against, but PRAGMA table_info still knows the
    // column is INTEGER.
    let mut readded = todo_schema();
    readded.tables[0]
        .fields
        .iter_mut()
        .find(|field| field.name == "rank")
        .expect("rank field declared")
        .field_type = FieldType::String;
    let error = db
        .schema_seed()
        .apply_schema(readded)
        .expect_err("affinity mismatch with the physical column must fail");
    assert_eq!(error.diagnostic.code, "SNAPBACK_SCHEMA_FIELD_RETYPED");
    assert_eq!(error.diagnostic.details["existingType"], "INTEGER");
    assert_eq!(error.diagnostic.details["requestedType"], "TEXT");
    assert_eq!(
        error.diagnostic.message,
        format!(
            "field todos.rank cannot change storage type from INTEGER to TEXT; retyping stored data is not supported — add a new field instead{REVIEWED_MIGRATION_NEXT_STEP}"
        ),
        "the complete physical-backstop refusal is stable"
    );
}

fn physical_column_not_null(path: &std::path::Path, table: &str, field: &str) -> bool {
    let conn = rusqlite::Connection::open(path).expect("open sqlite for column inspection");
    let mut statement = conn
        .prepare(&format!("PRAGMA table_info(\"{table}\")"))
        .expect("prepare table_info");
    statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(1)?, row.get::<_, i64>(3)?))
        })
        .expect("query table_info")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect table_info")
        .into_iter()
        .find(|(name, _)| name == field)
        .map(|(_, not_null)| not_null != 0)
        .expect("field exists")
}

fn rank_required(mut schema: SchemaManifest) -> SchemaManifest {
    schema
        .tables
        .iter_mut()
        .find(|table| table.name == "todos")
        .and_then(|table| table.fields.iter_mut().find(|field| field.name == "rank"))
        .expect("rank field")
        .optional = false;
    schema
}

fn insert_schema_test_row(db: &mut LocalDatabase, id: &str, values: Value) {
    db.mutation_writes()
        .commit_buffered_writes(
            &input(json!({}), "u"),
            vec![BufferedWrite::Insert {
                table: "todos".to_owned(),
                id: id.to_owned(),
                values: values.as_object().cloned().expect("object values"),
            }],
            Vec::new(),
            Value::Null,
        )
        .expect("insert schema test row");
}

#[test]
fn required_field_tightening_rebuilds_empty_and_populated_nonnull_tables() {
    for populated in [false, true] {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(format!("required-{populated}.db"));
        let mut db = LocalDatabase::open(&path).expect("open db");
        db.schema_seed()
            .apply_schema(todo_schema())
            .expect("optional schema");
        if populated {
            insert_schema_test_row(
                &mut db,
                "nonnull",
                json!({
                    "title": "preserved",
                    "completed": false,
                    "rank": 7,
                    "userId": "u"
                }),
            );
        }
        db.schema_seed()
            .apply_schema(rank_required(todo_schema()))
            .expect("zero-null tightening is safe");
        assert!(physical_column_not_null(&path, "todos", "rank"));
        if populated {
            assert_eq!(
                db.query_reads_read()
                    .get("todos", "nonnull")
                    .unwrap()
                    .unwrap()["rank"],
                json!(7),
                "atomic rebuild preserves row values"
            );
        }
    }
}

#[test]
fn required_field_tightening_with_nulls_rolls_back_manifest_and_rows() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("required-null.db");
    let mut db = LocalDatabase::open(&path).expect("open db");
    db.schema_seed()
        .apply_schema(todo_schema())
        .expect("optional schema");
    insert_schema_test_row(
        &mut db,
        "null-rank",
        json!({ "title": "preserved", "completed": false, "userId": "u" }),
    );
    let error = db
        .schema_seed()
        .apply_schema(rank_required(todo_schema()))
        .expect_err("null rows require an explicit backfill");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED"
    );
    assert_eq!(error.diagnostic.details["existingNullRows"], json!(1));
    assert_eq!(
        error.diagnostic.message,
        format!(
            "field todos.rank cannot become physically required while 1 stored rows are null{REVIEWED_MIGRATION_NEXT_STEP}"
        ),
        "the complete tightening refusal is stable"
    );
    assert!(db.schema().tables[0].field("rank").expect("rank").optional);
    assert!(!physical_column_not_null(&path, "todos", "rank"));
    assert_eq!(
        db.query_reads_read()
            .get("todos", "null-rank")
            .unwrap()
            .unwrap()["title"],
        json!("preserved")
    );
}

#[test]
fn required_field_removal_or_optionalization_preserves_prior_schema_and_data() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("required-removal.db");
    let required = rank_required(todo_schema());
    let mut db = LocalDatabase::open(&path).expect("open db");
    db.schema_seed()
        .apply_schema(todo_schema())
        .expect("optional schema");
    insert_schema_test_row(
        &mut db,
        "preserved",
        json!({
            "title": "preserved",
            "completed": false,
            "rank": 7,
            "userId": "u"
        }),
    );
    db.schema_seed()
        .apply_schema(required.clone())
        .expect("tighten populated non-null field");
    assert!(physical_column_not_null(&path, "todos", "rank"));

    let mut removed = required.clone();
    removed.tables[0]
        .fields
        .retain(|field| field.name != "rank");
    let removal = db
        .schema_seed()
        .apply_schema(removed)
        .expect_err("additive migration cannot hide a preserved NOT NULL column");
    assert_eq!(
        removal.diagnostic.code,
        "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED"
    );
    assert_eq!(removal.diagnostic.details["requestedChange"], "remove");
    assert_eq!(
        removal.diagnostic.message,
        format!(
            "required field todos.rank cannot be removed or made optional while its preserved SQLite column is NOT NULL; explicit drop/backfill migrations are not supported{REVIEWED_MIGRATION_NEXT_STEP}"
        ),
        "the complete removal refusal is stable"
    );

    let mut optional = required.clone();
    optional.tables[0]
        .fields
        .iter_mut()
        .find(|field| field.name == "rank")
        .expect("rank")
        .optional = true;
    let loosening = db
        .schema_seed()
        .apply_schema(optional)
        .expect_err("logical optional cannot contradict physical NOT NULL");
    assert_eq!(
        loosening.diagnostic.code,
        "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED"
    );
    assert_eq!(
        loosening.diagnostic.details["requestedChange"],
        "makeOptional"
    );
    assert_eq!(
        loosening.diagnostic.message,
        format!(
            "required field todos.rank cannot be removed or made optional while its preserved SQLite column is NOT NULL; explicit drop/backfill migrations are not supported{REVIEWED_MIGRATION_NEXT_STEP}"
        ),
        "the complete optionalization refusal is stable"
    );

    assert!(
        !db.schema().tables[0]
            .field("rank")
            .expect("prior rank declaration")
            .optional
    );
    assert!(physical_column_not_null(&path, "todos", "rank"));
    assert_eq!(
        db.query_reads_read()
            .get("todos", "preserved")
            .unwrap()
            .unwrap()["rank"],
        7
    );
    insert_schema_test_row(
        &mut db,
        "after-rejection",
        json!({
            "title": "old schema still writable",
            "completed": false,
            "rank": 8,
            "userId": "u"
        }),
    );
}

#[test]
fn schema_reapply_repairs_legacy_required_but_nullable_column() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("legacy-required.db");
    let required = rank_required(todo_schema());
    {
        let mut db = LocalDatabase::open(&path).expect("open db");
        db.schema_seed()
            .apply_schema(todo_schema())
            .expect("legacy optional physical schema");
        insert_schema_test_row(
            &mut db,
            "legacy",
            json!({ "title": "legacy", "completed": false, "rank": 9, "userId": "u" }),
        );
    }
    {
        let conn = rusqlite::Connection::open(&path).expect("open raw legacy db");
        let updated = conn
            .execute(
                "UPDATE _snapback_meta SET value = ?1
             WHERE key IN ('schema_manifest', 'schema_manifest_capability_aware')",
                [serde_json::to_string(&required).unwrap()],
            )
            .expect("simulate pre-fix logical required manifest");
        assert_eq!(
            updated, 2,
            "both pre-sessions manifest mirrors move together"
        );
    }
    assert!(!physical_column_not_null(&path, "todos", "rank"));
    let mut reopened = LocalDatabase::open(&path).expect("reopen legacy db");
    reopened
        .schema_seed()
        .apply_schema(required)
        .expect("reapply repairs the physical invariant");
    assert!(physical_column_not_null(&path, "todos", "rank"));
    assert_eq!(
        reopened
            .query_reads_read()
            .get("todos", "legacy")
            .unwrap()
            .unwrap()["rank"],
        json!(9)
    );
}

#[test]
fn new_required_field_is_allowed_only_on_an_empty_table() {
    let add_required = |mut schema: SchemaManifest| {
        schema.tables[0].fields.push(FieldManifest {
            name: "requiredLater".to_owned(),
            field_type: FieldType::String,
            optional: false,
        });
        schema
    };

    let empty_dir = tempfile::tempdir().unwrap();
    let empty_path = empty_dir.path().join("required-add-empty.db");
    let mut empty = LocalDatabase::open(&empty_path).unwrap();
    empty.schema_seed().apply_schema(todo_schema()).unwrap();
    empty
        .schema_seed()
        .apply_schema(add_required(todo_schema()))
        .expect("empty table needs no backfill");
    assert!(physical_column_not_null(
        &empty_path,
        "todos",
        "requiredLater"
    ));

    let populated_dir = tempfile::tempdir().unwrap();
    let populated_path = populated_dir.path().join("required-add-populated.db");
    let mut populated = LocalDatabase::open(&populated_path).unwrap();
    populated.schema_seed().apply_schema(todo_schema()).unwrap();
    insert_schema_test_row(
        &mut populated,
        "existing",
        json!({ "title": "existing", "completed": false, "userId": "u" }),
    );
    let error = populated
        .schema_seed()
        .apply_schema(add_required(todo_schema()))
        .expect_err("populated table requires a backfill");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED"
    );
    assert_eq!(error.diagnostic.details["existingRows"], json!(1));
    assert_eq!(
        error.diagnostic.message,
        format!(
            "required field todos.requiredLater cannot be added to 1 existing rows without a default/backfill{REVIEWED_MIGRATION_NEXT_STEP}"
        ),
        "the complete required-field refusal is stable"
    );
    assert!(
        populated.schema().tables[0]
            .field("requiredLater")
            .is_none()
    );
    assert_eq!(
        populated
            .query_reads_read()
            .get("todos", "existing")
            .unwrap()
            .unwrap()["title"],
        json!("existing")
    );
}

#[test]
fn readded_table_cannot_hide_a_preserved_required_physical_column() {
    let mut db = LocalDatabase::memory().unwrap();
    db.schema_seed()
        .apply_schema(todo_schema())
        .expect("optional predecessor");
    insert_schema_test_row(
        &mut db,
        "preserved",
        json!({
            "title": "preserved",
            "completed": false,
            "rank": 7,
            "userId": "u"
        }),
    );
    db.schema_seed()
        .apply_schema(rank_required(todo_schema()))
        .expect("tighten the populated non-null field");

    db.schema_seed()
        .apply_schema(SchemaManifest {
            schema_hash: Some("without-todos".to_owned()),
            ..SchemaManifest::default()
        })
        .expect("whole-table removal preserves physical storage");

    let mut readded = todo_schema();
    readded.tables[0]
        .fields
        .retain(|field| field.name != "rank");
    let error = db
        .schema_seed()
        .apply_schema(readded)
        .expect_err("the physical NOT NULL backstop must refuse the hidden column");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED"
    );
    assert_eq!(error.diagnostic.details["requestedChange"], "remove");
    assert_eq!(
        error.diagnostic.message,
        format!(
            "table todos cannot omit preserved required field rank; its SQLite column is still NOT NULL{REVIEWED_MIGRATION_NEXT_STEP}"
        ),
        "the complete physical required-field backstop is stable"
    );
}

/// The owning table and ordered column list of a physical SQLite index, read
/// directly from the database file; `None` when no index with that name
/// exists.
fn physical_index_definition(path: &std::path::Path, name: &str) -> Option<(String, Vec<String>)> {
    use rusqlite::OptionalExtension;
    let conn = rusqlite::Connection::open(path).expect("open sqlite for inspection");
    let table: Option<String> = conn
        .query_row(
            "SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?1",
            [name],
            |row| row.get(0),
        )
        .optional()
        .expect("query sqlite_master");
    let table = table?;
    let mut statement = conn
        .prepare(&format!("PRAGMA index_info(\"{name}\")"))
        .expect("prepare index_info");
    let columns = statement
        .query_map([], |row| row.get::<_, String>(2))
        .expect("query index_info")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect index columns");
    Some((table, columns))
}

fn single_index_schema(hash: &str, table: &str, field: &str, index: &str) -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some(hash.to_owned()),
        tables: vec![TableManifest {
            name: table.to_owned(),
            fields: vec![FieldManifest {
                name: field.to_owned(),
                field_type: FieldType::String,
                optional: false,
            }],
            indexes: vec![IndexManifest {
                name: index.to_owned(),
                fields: vec![field.to_owned()],
                unique: false,
                where_applicable: false,
            }],
            syncable: false,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        }],
        ..SchemaManifest::default()
    }
}

/// ENG-23342 — SQLite index names are database-global and the physical name
/// joins `{table}_{index}` with `_`, a character both identifiers may
/// contain, so distinct declarations can collide (table `foo` + index
/// `bar_baz` vs table `foo_bar` + index `baz`). Schema validation must reject
/// the collision instead of letting the second index silently never exist.
#[test]
fn apply_schema_rejects_cross_table_physical_index_name_collision() {
    let mut db = LocalDatabase::memory().unwrap();
    let mut manifest = single_index_schema("collision-v0", "foo", "a", "bar_baz");
    manifest
        .tables
        .extend(single_index_schema("collision-v0", "foo_bar", "a", "baz").tables);
    let error = db
        .schema_seed()
        .apply_schema(manifest)
        .expect_err("colliding physical index names must fail validation");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_SCHEMA_INDEX_NAME_COLLISION"
    );
    assert_eq!(error.diagnostic.details["physicalName"], "foo_bar_baz");
}

/// ENG-23342 — editing an existing index's field list in the manifest must
/// rebuild the physical index. A bare `CREATE INDEX IF NOT EXISTS` would keep
/// the stale definition forever while `indexed_by` hints kept validating
/// against the manifest — exactly the silent no-op LLP 0032 E5 forbids.
#[test]
fn apply_schema_rebuilds_index_when_declared_fields_change() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("index-rebuild.db");
    let mut db = LocalDatabase::open(&path).expect("open db");
    db.schema_seed()
        .apply_schema(todo_schema())
        .expect("initial schema");
    assert_eq!(
        physical_index_definition(&path, "todos_by_user"),
        Some((
            "todos".to_owned(),
            vec!["userId".to_owned(), "_id".to_owned()]
        ))
    );

    // Re-applying the same manifest keeps the index (the redeploy no-op path).
    db.schema_seed()
        .apply_schema(todo_schema())
        .expect("matching re-apply");

    // Widen by_user to (userId, completed): the physical index must follow.
    let mut widened = todo_schema();
    widened.tables[0].indexes[0].fields = vec!["userId".to_owned(), "completed".to_owned()];
    db.schema_seed()
        .apply_schema(widened)
        .expect("index definition change applies");
    assert_eq!(
        physical_index_definition(&path, "todos_by_user"),
        Some((
            "todos".to_owned(),
            vec![
                "userId".to_owned(),
                "completed".to_owned(),
                "_id".to_owned()
            ]
        ))
    );
}

/// ENG-23342 — a stale physical index left by an earlier schema epoch (table
/// `foo_bar` index `baz`, physical `foo_bar_baz`; the migrator preserves
/// removed tables) must not block a later table whose declaration joins to
/// the same physical name: the owning-table mismatch is detected and the
/// index is rebuilt on the declaring table.
#[test]
fn apply_schema_reclaims_stale_physical_index_from_removed_table() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("index-reclaim.db");
    let mut db = LocalDatabase::open(&path).expect("open db");

    db.schema_seed()
        .apply_schema(single_index_schema("epoch-1", "foo_bar", "a", "baz"))
        .expect("epoch one");
    assert_eq!(
        physical_index_definition(&path, "foo_bar_baz"),
        Some(("foo_bar".to_owned(), vec!["a".to_owned(), "_id".to_owned()]))
    );

    // Epoch two drops foo_bar from the manifest and declares table foo with
    // index bar_baz — the same physical name, now owned by a different table.
    db.schema_seed()
        .apply_schema(single_index_schema("epoch-2", "foo", "b", "bar_baz"))
        .expect("epoch two");
    assert_eq!(
        physical_index_definition(&path, "foo_bar_baz"),
        Some(("foo".to_owned(), vec!["b".to_owned(), "_id".to_owned()]))
    );
}

/// LLP 0034 §10.1 residual / ENG-22478 (review fix A) — supersession is
/// EXPLICIT: plain duplicate subscribes coexist (two components may share a
/// query on one connection), while a subscribe naming `supersedes` disposes
/// exactly that id (receipted) and only that id stops fanning out.
#[test]
fn d2_explicit_supersession_disposes_only_the_named_subscription() {
    let mut snapback = configured_snapback();
    let first = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("first subscribe");
    let second = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("second subscribe");
    assert_ne!(first.subscription_id, second.subscription_id);

    // Plain duplicates COEXIST: both fan out.
    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "both live" }), "user_1"),
        )
        .expect("create todo");
    let updates: Vec<Value> = snapback
        .drain_outbox("client_a")
        .into_iter()
        .filter_map(|envelope| match envelope {
            RealtimeEnvelope::Durable(message) => serde_json::from_slice(&message.payload).ok(),
            RealtimeEnvelope::Ephemeral(_) => None,
        })
        .filter(|update: &Value| update["kind"] == "live_replace")
        .collect();
    assert_eq!(updates.len(), 2, "duplicate subscribers must both fan out");

    // The kit's resubscribe names its predecessor: exactly that id dies.
    let third = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: Some(first.subscription_id.clone()),
                resume_from_token: None,
            },
        )
        .expect("superseding subscribe");
    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "after supersede" }), "user_1"),
        )
        .expect("create todo");
    let ids: Vec<Value> = snapback
        .drain_outbox("client_a")
        .into_iter()
        .filter_map(|envelope| match envelope {
            RealtimeEnvelope::Durable(message) => serde_json::from_slice(&message.payload).ok(),
            RealtimeEnvelope::Ephemeral(_) => None,
        })
        .filter(|update: &Value| update["kind"] == "live_replace")
        .map(|update: Value| update["subscription_id"].clone())
        .collect();
    assert_eq!(ids.len(), 2, "the survivor and the superseder fan out");
    assert!(
        ids.contains(&json!(second.subscription_id)),
        "the untouched duplicate survives"
    );
    assert!(
        ids.contains(&json!(third.subscription_id)),
        "the superseder is live"
    );
    assert!(
        !ids.contains(&json!(first.subscription_id)),
        "the named predecessor is disposed"
    );

    let receipts = snapback.receipts_snapshot(Some("client_a"));
    let ring = receipts["receipts"].as_array().expect("connection ring");
    assert!(
        ring.iter().any(|receipt| receipt["event"] == "disposed"
            && receipt["reason"] == "superseded"
            && receipt["subscriptionId"] == first.subscription_id
            && receipt["supersededBy"] == third.subscription_id),
        "explicit supersession must be receipted: {receipts}"
    );

    // An unknown supersedes id is a quiet no-op (reconnects race teardown).
    snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: Some("sub_gone".to_owned()),
                resume_from_token: None,
            },
        )
        .expect("unknown supersedes is not an error");
}

/// ENG-22478 review fix D — collection replace/reset retires room epochs with
/// a resync boundary: attached subscribers receive ResyncRequired, and a
/// recreated room's epoch is strictly higher, so fresh entries are never
/// dropped as stale by an overlay holding the previous window.
#[test]
fn d2_collection_replace_bumps_epoch_and_signals_resync() {
    // The sharded room authority (LLP 0032 L9) exposes `&self` methods, so the
    // backend binding no longer needs `mut`.
    let backend = LocalEphemeralBackend::new();
    backend
        .register_collection(EphemeralCollection::local_cursor("boardCursors", "boardId"))
        .unwrap();
    let scope = Scope::from_pairs([("boardId", "board_1")]);
    let auth = AuthContext::default();

    let snapshot = backend
        .subscribe(
            SubscribeRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "observer".to_owned(),
                auth: auth.clone(),
                since_chunk: None,
            },
            1_000,
        )
        .expect("subscribe");
    let EphemeralMessage::Snapshot {
        scope_epoch: first_epoch,
        ..
    } = snapshot
    else {
        panic!("expected snapshot");
    };

    backend
        .publish(
            PublishRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "publisher".to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                value: b"{}".to_vec(),
                ttl_ms: None,
                auth: auth.clone(),
            },
            1_001,
        )
        .expect("publish");
    backend.drain_outbox("observer");

    // Replace with a CHANGED definition: rooms retire, subscribers get the
    // resync boundary.
    let mut changed = EphemeralCollection::local_cursor("boardCursors", "boardId");
    changed.default_ttl_ms = 9_000;
    backend.replace_collections(vec![changed]).unwrap();

    let resync = backend
        .drain_outbox("observer")
        .into_iter()
        .find_map(|envelope| match envelope {
            RealtimeEnvelope::Ephemeral(EphemeralMessage::ResyncRequired {
                scope_epoch, ..
            }) => Some(scope_epoch),
            _ => None,
        })
        .expect("attached subscriber must receive the resync boundary");
    assert_eq!(resync, first_epoch);

    // The recreated room re-snapshots at a strictly higher epoch, and its
    // fresh entries apply under the new window (entry versions restart at 1
    // WITHIN the new epoch — never comparable across epochs).
    let fresh = backend
        .subscribe(
            SubscribeRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "observer".to_owned(),
                auth: auth.clone(),
                since_chunk: None,
            },
            2_000,
        )
        .expect("re-subscribe");
    let EphemeralMessage::Snapshot {
        scope_epoch: second_epoch,
        ..
    } = fresh
    else {
        panic!("expected fresh snapshot");
    };
    assert!(
        second_epoch > first_epoch,
        "recreated room must carry a strictly higher epoch ({second_epoch} vs {first_epoch})"
    );
}

/// LLP 0034 §10.1 residual / ENG-22478 — explicit unsubscribe disposes the
/// subscription (receipted), stops fan-out, and enforces ownership.
#[test]
fn d2_unsubscribe_live_disposes_and_enforces_ownership() {
    let mut snapback = configured_snapback();
    let sub = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe");

    // A different principal cannot dispose it.
    let stranger = snapback.unsubscribe_live(
        "listTodos",
        LiveUnsubscribeInput {
            subscription_id: sub.subscription_id.clone(),
            connection_id: "client_a".to_owned(),
            auth: auth("user_2"),
        },
    );
    assert_eq!(
        stranger.expect_err("ownership").diagnostic.code,
        "SNAPBACK_LIVE_RESUME_OWNERSHIP"
    );

    let disposed = snapback
        .unsubscribe_live(
            "listTodos",
            LiveUnsubscribeInput {
                subscription_id: sub.subscription_id.clone(),
                connection_id: "client_a".to_owned(),
                auth: auth("user_1"),
            },
        )
        .expect("unsubscribe");
    assert!(disposed.disposed);
    let disposed_receipt =
        serde_json::to_value(disposed.receipt.as_ref().expect("receipt")).expect("receipt json");
    assert_eq!(disposed_receipt["event"], "disposed");
    assert_eq!(disposed_receipt["reason"], "unsubscribed");

    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "after dispose" }), "user_1"),
        )
        .expect("create todo");
    let durable = snapback
        .drain_outbox("client_a")
        .into_iter()
        .filter(|envelope| matches!(envelope, RealtimeEnvelope::Durable(_)))
        .count();
    assert_eq!(durable, 0, "a disposed subscription must not fan out");

    let unknown = snapback.unsubscribe_live(
        "listTodos",
        LiveUnsubscribeInput {
            subscription_id: sub.subscription_id,
            connection_id: "client_a".to_owned(),
            auth: auth("user_1"),
        },
    );
    assert_eq!(
        unknown.expect_err("already disposed").diagnostic.code,
        "SNAPBACK_UNKNOWN_SUBSCRIPTION"
    );
}

/// LLP 0034 §3.2 / ENG-22478 — mutation receipts: provider fields populated,
/// adapter correlation echoed verbatim, affectedTables from DECLARED writes
/// with the explicit-unknown (null) shape when a function declares none.
#[test]
fn d2_mutation_receipts_echo_correlation_and_declare_affected_tables() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("schema");

    let mut declared = system_todo_mutation();
    declared.name = "declaredWrites".to_owned();
    declared.id = "fn:declaredWrites".to_owned();
    declared.write_set_summary.tables = vec!["todos".to_owned()];
    let mut undeclared = system_todo_mutation();
    undeclared.name = "undeclaredWrites".to_owned();
    undeclared.id = "fn:undeclaredWrites".to_owned();
    // write_set_summary stays default-empty: declared-nothing.
    snapback.load_functions(FunctionManifest {
        bundle_hash: Some("d2-receipts".to_owned()),
        functions: vec![declared, undeclared],
        ..FunctionManifest::default()
    });

    let correlation = json!({
        "actionInvocationId": "act_1",
        "rootId": "root_1",
        "bindingIds": ["todos"],
    });
    let mut with_correlation = input(json!({ "title": "receipted" }), "user_1");
    with_correlation.correlation = Some(correlation.clone());
    let (result, receipt) = snapback.invoke_mutation_recording("declaredWrites", with_correlation);
    let receipt = receipt.into_value();
    let output = result.expect("mutation");
    assert_eq!(receipt["kind"], "mutation");
    assert_eq!(receipt["outcome"], "confirmed");
    assert_eq!(receipt["rollbackReason"], Value::Null);
    assert_eq!(receipt["affectedTables"], json!(["todos"]));
    assert_eq!(receipt["snapshotVersion"], json!(output.version));
    assert_eq!(receipt["transport"], "local");
    assert_eq!(
        receipt["correlation"], correlation,
        "correlation echoed verbatim"
    );
    assert!(receipt["mutationId"].as_str().unwrap().starts_with("mut_"));

    // Declared-nothing: EXPLICITLY unknown (null), never silently empty.
    let (_, unknown_receipt) = snapback.invoke_mutation_recording(
        "undeclaredWrites",
        input(json!({ "title": "unknown writes" }), "user_1"),
    );
    let unknown_receipt = unknown_receipt.into_value();
    assert_eq!(unknown_receipt["affectedTables"], Value::Null);

    // A rejected mutation still produces its receipt, with the diagnostic
    // CODE (never the message) as the rollback reason (§3.3 privacy).
    let (rejected, rejected_receipt) =
        snapback.invoke_mutation_recording("nope", input(json!({}), "user_1"));
    let rejected_receipt = rejected_receipt.into_value();
    assert!(rejected.is_err());
    assert_eq!(rejected_receipt["outcome"], "rejected");
    assert_eq!(
        rejected_receipt["rollbackReason"],
        "SNAPBACK_UNKNOWN_FUNCTION"
    );

    // Retention: all three receipts are in the bounded global ring.
    let receipts = snapback.receipts_snapshot(None);
    assert_eq!(receipts["global"].as_array().expect("global ring").len(), 3);
}

/// LLP 0034 §3 / ENG-22478 — a disconnect receipts the disposal into the
/// GLOBAL ring and drops the connection's own ring.
#[test]
fn d2_disconnect_receipts_disposal_and_drops_the_connection_ring() {
    let mut snapback = configured_snapback();
    let sub = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_gone".to_owned(),
                input: input(json!({}), "user_1"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe");
    assert!(
        !snapback.receipts_snapshot(Some("client_gone"))["receipts"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    snapback.disconnect("client_gone", 1_000);
    let receipts = snapback.receipts_snapshot(None);
    assert!(
        receipts["global"]
            .as_array()
            .unwrap()
            .iter()
            .any(|receipt| {
                receipt["event"] == "disposed"
                    && receipt["reason"] == "disconnected"
                    && receipt["subscriptionId"] == sub.subscription_id
            }),
        "disconnect disposal must be receipted globally: {receipts}"
    );
    assert!(
        snapback.receipts_snapshot(Some("client_gone"))["receipts"]
            .as_array()
            .unwrap()
            .is_empty(),
        "the connection ring dies with the connection"
    );
}

/// LLP 0034 §5 D4 / ENG-22527 — the single idempotent ensure-everything
/// operation: provisions only what is missing, matches on re-run, and seeds
/// server-side only when every target table is empty (never reset-then-seed).
#[test]
fn d4_ensure_app_provisions_once_and_seeds_only_if_empty() {
    use snapback::local::EnsureAppInput;

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    let seed = SeedData {
        tables: std::collections::BTreeMap::from([(
            "todos".to_owned(),
            vec![
                serde_json::from_value::<Map<String, Value>>(
                    json!({ "_id": "seed_1", "title": "Seeded", "completed": false, "userId": "user_1" }),
                )
                .expect("seed row"),
            ],
        )]),
    };

    // Fresh backend: everything provisions.
    let first = snapback
        .ensure_app(
            EnsureAppInput {
                routes: None,
                schema: Some(todo_schema()),
                functions: Some(todo_functions()),
                seed: Some(seed.clone()),
            },
            true,
            "dev",
        )
        .expect("first ensure");
    assert_eq!(first.schema, "provisioned");
    assert_eq!(first.functions, "provisioned");
    assert_eq!(first.seed, "seeded");
    assert_eq!(first.profile, "dev");

    // Second boot (another window): everything matches; the seed is
    // skipped because the target table has rows — data always survives.
    let second = snapback
        .ensure_app(
            EnsureAppInput {
                routes: None,
                schema: Some(todo_schema()),
                functions: Some(todo_functions()),
                seed: Some(seed.clone()),
            },
            true,
            "dev",
        )
        .expect("second ensure");
    assert_eq!(second.schema, "matched");
    assert_eq!(second.functions, "matched");
    assert_eq!(second.seed, "skipped-nonempty");
    let rows = snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect("query");
    assert_eq!(rows.rows.len(), 1, "the seed ran exactly once");
}

#[test]
fn ensure_app_rejects_config_errors_before_loading_functions_or_seeding() {
    use snapback::local::EnsureAppInput;

    let mut functions = todo_functions();
    let action = FunctionDefinition::new(
        "usesMissingConfig",
        FunctionKind::Action,
        FunctionRuntime::HostPlan(HandlerPlan::Action(ActionPlan {
            steps: Vec::new(),
            return_value: Some(ActionReturnValue::Literal(json!(null))),
        })),
    );
    let mut action = action;
    action.uses = vec!["STRIPE_KEY".to_owned()];
    functions.functions.push(action);
    functions.config = vec![ConfigEntryDefinition {
        name: "DECLARED_KEY".to_owned(),
        description: None,
        purpose: None,
        secret: true,
        required: false,
        pool: false,
        probe: None,
        how_to_get: None,
        acquisition: None,
        default: None,
        source_span: None,
    }];

    let seed = SeedData {
        tables: std::collections::BTreeMap::from([(
            "todos".to_owned(),
            vec![serde_json::from_value::<Map<String, Value>>(
                json!({ "_id": "seed_1", "title": "Seeded", "completed": false, "userId": "user_1" }),
            )
            .expect("seed row")],
        )]),
    };
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    let error = snapback
        .ensure_app(
            EnsureAppInput {
                routes: None,
                schema: Some(todo_schema()),
                functions: Some(functions.clone()),
                seed: Some(seed.clone()),
            },
            true,
            "dev",
        )
        .expect_err("function-manifest errors must fail provisioning");
    assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_USES_UNKNOWN");

    let inspect = snapback.inspect().expect("inspect failed provisioning");
    assert!(inspect.functions.functions.is_empty());
    assert_eq!(
        inspect.storage.version, 0,
        "seed must not run after failure"
    );
    assert!(
        inspect
            .recent_diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "SNAPBACK_CONFIG_USES_UNKNOWN"),
        "the rejected declaration remains diagnosable"
    );
}

/// ENG-22527 — the profile capability gates the PROVISIONING half of ensure:
/// under a prod profile the operation inspects and reports 'gated' instead
/// of writing; matched halves still report 'matched'.
#[test]
fn d4_ensure_app_reports_gated_under_prod() {
    use snapback::local::EnsureAppInput;

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    let gated = snapback
        .ensure_app(
            EnsureAppInput {
                routes: None,
                schema: Some(todo_schema()),
                functions: Some(todo_functions()),
                seed: None,
            },
            false,
            "prod",
        )
        .expect("gated ensure");
    assert_eq!(gated.schema, "gated");
    assert_eq!(gated.functions, "gated");
    assert_eq!(gated.seed, "skipped-absent");

    // The primary fresh-prod mount (ENG-22527 FIX 2): an UNPROVISIONED prod
    // backend with a seed present must report seed:"gated", never raise
    // SNAPBACK_UNKNOWN_TABLE by scanning a table the gated schema never
    // created (that scan-before-gate ordering was a 500 on the main mount).
    let seed = SeedData {
        tables: std::collections::BTreeMap::from([(
            "todos".to_owned(),
            vec![serde_json::from_value::<Map<String, Value>>(
                json!({ "_id": "seed_1", "title": "Seeded", "completed": false, "userId": "user_1" }),
            )
            .expect("seed row")],
        )]),
    };
    let fresh_prod = snapback
        .ensure_app(
            EnsureAppInput {
                routes: None,
                schema: Some(todo_schema()),
                functions: Some(todo_functions()),
                seed: Some(seed),
            },
            false,
            "prod",
        )
        .expect("fresh-prod ensure must not error");
    assert_eq!(fresh_prod.schema, "gated");
    assert_eq!(fresh_prod.functions, "gated");
    assert_eq!(fresh_prod.seed, "gated");

    // Provision under dev, then a prod ensure of the SAME manifests is a
    // pure inspection: matched, no gate needed.
    snapback
        .ensure_app(
            EnsureAppInput {
                routes: None,
                schema: Some(todo_schema()),
                functions: Some(todo_functions()),
                seed: None,
            },
            true,
            "dev",
        )
        .expect("provision");
    let matched = snapback
        .ensure_app(
            EnsureAppInput {
                routes: None,
                schema: Some(todo_schema()),
                functions: Some(todo_functions()),
                seed: None,
            },
            false,
            "prod",
        )
        .expect("prod inspect");
    assert_eq!(matched.schema, "matched");
    assert_eq!(matched.functions, "matched");
}

#[test]
fn diagnostic_ring_evicts_low_severity_before_errors() {
    let mut functions = todo_functions();
    functions.config = vec![ConfigEntryDefinition {
        name: "feedKeys".to_owned(),
        description: None,
        purpose: None,
        secret: true,
        required: false,
        pool: false,
        probe: None,
        how_to_get: None,
        acquisition: None,
        default: None,
        source_span: None,
    }];
    let mut bad_functions = functions.clone();
    let mut bad_action = FunctionDefinition::new(
        "badAction",
        FunctionKind::Action,
        FunctionRuntime::HostPlan(HandlerPlan::Action(ActionPlan {
            steps: Vec::new(),
            return_value: Some(ActionReturnValue::Literal(json!(null))),
        })),
    );
    bad_action.uses = vec!["missingConfig".to_owned()];
    bad_functions.functions.push(bad_action);

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("schema");
    snapback.load_functions(functions);
    let diagnostics = snapback.load_functions(bad_functions);
    assert_eq!(diagnostics[0].code, "SNAPBACK_CONFIG_USES_UNKNOWN");
    for n in 0..140 {
        snapback
            .set_config_entry("feedKeys", vec![format!("key-{n}")], false, "test")
            .expect("config set");
    }

    let diagnostics = snapback.inspect().expect("inspect").recent_diagnostics;
    assert!(
        diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "SNAPBACK_CONFIG_USES_UNKNOWN"),
        "error diagnostics should survive lower-severity churn"
    );
    assert!(diagnostics.len() <= 100);
}
