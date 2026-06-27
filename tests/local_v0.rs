use serde_json::{Map, Value, json};
use snapback::ephemeral::{
    AuthContext, EphemeralCollection, EphemeralMessage, PublishRequest, RealtimeEnvelope, Scope,
    SubscribeRequest,
};
use snapback::local::{LiveSubscribeInput, LocalSnapback};
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FilterExpr, FilterOp, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, IbexModule, IndexManifest,
    MutationPlan, MutationStep, OrderDirection, OrderExpr, QueryPlan, ReadDependency, ReturnValue,
    SchemaManifest, SeedData, TableManifest, ValueExpr,
};
use snapback::runtime::CapabilityState;
use snapback::storage::{CapturedReadKind, ChangeOp};
use std::collections::BTreeMap;
use std::thread;
use std::time::Duration;

#[test]
fn local_sqlite_host_plan_runs_todo_live_query_and_mutation() {
    let mut snapback = configured_snapback();

    let subscription = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
            },
        )
        .expect("subscribe live query");
    assert_eq!(subscription.snapshot.rows, Vec::<Value>::new());

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
            },
        )
        .expect("subscribe live query");
    assert_eq!(subscription.snapshot.rows, Vec::<Value>::new());

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

#[test]
fn live_matcher_skips_user_scoped_disjoint_mutations() {
    let mut snapback = configured_ibex_snapback(TODO_HANDLER_SOURCE);

    let ada = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "ada_client".to_owned(),
                input: input(json!({}), "user_1"),
            },
        )
        .expect("ada subscribe");
    assert_eq!(ada.snapshot.rows.len(), 0);

    let grace = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "grace_client".to_owned(),
                input: input(json!({}), "user_2"),
            },
        )
        .expect("grace subscribe");
    assert_eq!(grace.snapshot.rows.len(), 0);

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
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect_err("fetch should be denied");
    assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_CAPABILITY_DENIED");
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

    let thread_path = db_path.clone();
    let thread_id = todo_id.clone();
    let first = thread::spawn(move || {
        let mut snapback = LocalSnapback::open(thread_path).expect("open first snapback");
        snapback.load_functions(ibex_todo_functions(CONFLICT_HANDLER_SOURCE));
        snapback.invoke_mutation(
            "setCompleted",
            input(json!({ "id": thread_id, "completed": true }), "user_1"),
        )
    });

    thread::sleep(Duration::from_millis(500));

    let mut concurrent = LocalSnapback::open(&db_path).expect("open concurrent snapback");
    concurrent.load_functions(todo_functions());
    concurrent
        .invoke_mutation(
            "setCompleted",
            input(json!({ "id": todo_id, "completed": false }), "user_1"),
        )
        .expect("concurrent patch");

    let error = first
        .join()
        .expect("first thread joins")
        .expect_err("captured stale row read should conflict");
    assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
    assert_eq!(error.diagnostic.details["retryPolicy"], "reject");
    assert_eq!(error.diagnostic.details["dependency"]["kind"], "row");
    assert_eq!(error.diagnostic.details["dependency"]["table"], "todos");
    assert_eq!(error.diagnostic.details["dependency"]["id"], todo_id);
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
fn local_snapback_reuses_in_memory_ephemeral_store() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.register_ephemeral_collection(EphemeralCollection::local_cursor(
        "boardCursors",
        "boardId",
    ));
    let scope = Scope::from_pairs([("boardId", "board_1")]);
    let auth = AuthContext::default();

    let snapshot = snapback
        .subscribe_ephemeral(
            SubscribeRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "observer".to_owned(),
                auth: auth.clone(),
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
fn generated_v0_artifacts_round_trip_through_runtime_structs() {
    let schema: SchemaManifest = serde_json::from_str(include_str!(
        "../demos/todo/snapback/generated/schema.manifest.json"
    ))
    .expect("generated schema manifest parses");
    assert_eq!(schema.artifact_kind, "schemaManifest");
    assert_eq!(schema.schema_version, "snapback.v0");
    assert_eq!(
        schema.schema_hash.as_deref(),
        Some("sha256:8d0c00db95d693f6")
    );
    assert!(schema.inputs_hash.is_some());
    let schema_value = serde_json::to_value(&schema).expect("schema roundtrip");
    assert_eq!(schema_value["artifactKind"], "schemaManifest");
    assert_eq!(schema_value["schemaHash"], "sha256:8d0c00db95d693f6");

    let functions: FunctionManifest = serde_json::from_str(include_str!(
        "../demos/todo/snapback/generated/functions.manifest.json"
    ))
    .expect("generated function manifest parses");
    assert_eq!(functions.artifact_kind, "functionManifest");
    assert_eq!(functions.schema_version, "snapback.v0");
    assert_eq!(
        functions.bundle_hash.as_deref(),
        Some("sha256:1e02d0edbabb277c")
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
            .contains(&"websocket-live-replace".to_owned())
    );
    assert!(
        inspect
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
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| { diagnostic.code == "SNAPBACK_IBEX_CLI_UNAVAILABLE" })
    );
    snapback
}

fn configured_ibex_snapback(source: &str) -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback
        .apply_schema(todo_schema())
        .expect("apply todo schema");
    let diagnostics = snapback.load_functions(ibex_todo_functions(source));
    assert!(diagnostics.iter().all(|diagnostic| {
        diagnostic.code == "SNAPBACK_IBEX_CLI_UNAVAILABLE"
            || diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED"
    }));
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
    const start = Date.now();
    while (Date.now() - start < 2000) {}
    return (await ctx.db.patch('todos', args.id, {
      completed: args.completed,
    })) ? 1 : 0;
  }
};
"#;

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
                    name: "userId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
            ],
            indexes: vec![IndexManifest {
                name: "by_user".to_owned(),
                fields: vec!["userId".to_owned()],
            }],
            syncable: true,
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
                    table: "todos".to_owned(),
                    filters: vec![FilterExpr {
                        field: "userId".to_owned(),
                        op: FilterOp::Eq,
                        value: ValueExpr::AuthUserId,
                    }],
                    order: vec![OrderExpr {
                        field: "_createdAt".to_owned(),
                        direction: OrderDirection::Asc,
                    }],
                    limit: None,
                    indexed_by: Some("by_user".to_owned()),
                })),
            ),
            FunctionDefinition::new(
                "createTodo",
                FunctionKind::Mutation,
                FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
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

fn input(args: Value, user_id: &str) -> HandlerInput {
    HandlerInput {
        args,
        auth: auth(user_id),
        read_set: Vec::new(),
    }
}

fn auth(user_id: &str) -> AuthInput {
    AuthInput {
        principal: Some(user_id.to_owned()),
        session_id: None,
        user_id: Some(user_id.to_owned()),
    }
}
