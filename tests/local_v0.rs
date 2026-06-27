use serde_json::{Map, Value, json};
use snapback::ephemeral::{
    AuthContext, EphemeralCollection, EphemeralMessage, PublishRequest, RealtimeEnvelope, Scope,
    SubscribeRequest,
};
use snapback::local::{LiveSubscribeInput, LocalSnapback};
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FilterExpr, FilterOp, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, IndexManifest, MutationPlan,
    MutationStep, OrderDirection, OrderExpr, QueryPlan, ReadDependency, ReturnValue,
    SchemaManifest, SeedData, TableManifest, ValueExpr,
};
use std::collections::BTreeMap;

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

fn configured_snapback() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback
        .apply_schema(todo_schema())
        .expect("apply todo schema");
    let diagnostics = snapback.load_functions(todo_functions());
    assert!(diagnostics.iter().all(|diagnostic| {
        diagnostic.code == "SNAPBACK_IBEX_CLI_UNAVAILABLE"
            || diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOAD_DEFERRED"
    }));
    snapback
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
    }
}

fn todo_functions() -> FunctionManifest {
    FunctionManifest {
        bundle_hash: Some("todo-functions-v0".to_owned()),
        functions: vec![
            FunctionDefinition {
                name: "listTodos".to_owned(),
                kind: FunctionKind::LiveQuery,
                runtime: FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
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
            },
            FunctionDefinition {
                name: "createTodo".to_owned(),
                kind: FunctionKind::Mutation,
                runtime: FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
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
            },
            FunctionDefinition {
                name: "setCompleted".to_owned(),
                kind: FunctionKind::Mutation,
                runtime: FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
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
            },
        ],
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
