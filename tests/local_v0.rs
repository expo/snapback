use serde_json::{Map, Value, json};
use snapback::cron::{CronActivationState, CronRunOutcome};
use snapback::ephemeral::{
    AuthContext, ClientEphemeralOverlay, EphemeralCollection, EphemeralErrorCode, EphemeralMessage,
    LocalEphemeralBackend, OverlayApply, PublishRequest, RealtimeEnvelope, Scope, SubscribeRequest,
};
use snapback::local::{LiveResumeInput, LiveSubscribeInput, LiveUnsubscribeInput, LocalSnapback};
use snapback::manifest::{
    ActionPlan, ActionReturnValue, ActionStep, AuthInput, CronActivationKind, CronActivationPolicy,
    CronJitterPolicy, CronJobDefinition, CronOverlapPolicy, CronRetryMode, CronRetryPolicy,
    CronSchedule, FieldManifest, FieldType, FilterExpr, FilterOp, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, IbexModule, IndexManifest,
    MutationPlan, MutationStep, OrderDirection, OrderExpr, PermissionScopeExpr, QueryPlan,
    ReadDependency, ReturnValue, SchemaManifest, SeedData, TableManifest, ValueExpr,
};
use snapback::runtime::CapabilityState;
use snapback::storage::{
    BufferedWrite, CapturedReadDependency, CapturedReadKind, ChangeOp, LocalDatabase,
};
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
                supersedes: None,
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
                supersedes: None,
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
                input: input(json!({}), "cron"),
                supersedes: None,
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
                supersedes: None,
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
                supersedes: None,
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
                supersedes: None,
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
                supersedes: None,
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
                supersedes: None,
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
                supersedes: None,
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
                supersedes: None,
            },
        )
        .expect("subscribe limited ranked todos");
    assert_eq!(
        subscription
            .snapshot
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
                supersedes: None,
            },
        )
        .expect("subscribe live query");
    assert_eq!(subscription.snapshot.rows.len(), 1);
    let other_subscription = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_b".to_owned(),
                input: input(json!({}), "user_2"),
                supersedes: None,
            },
        )
        .expect("subscribe other user");
    assert_eq!(other_subscription.snapshot.rows.len(), 0);

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
}

#[test]
fn live_resume_resnapshots_when_recorded_permission_epoch_is_stale() {
    let mut functions = ibex_todo_functions(TODO_HANDLER_SOURCE);
    let mut permission_change = FunctionDefinition::new(
        "touchPermissions",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
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
                supersedes: None,
            },
        )
        .expect("subscribe live query");
    assert_eq!(
        subscription.snapshot.rows[0]["title"],
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
                supersedes: None,
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
                supersedes: None,
            },
        )
        .expect("subscribe live query");
    assert_eq!(subscription.snapshot.rows.len(), 0);

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
                supersedes: None,
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
                supersedes: None,
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
fn ephemeral_unsubscribe_removes_only_the_requester_registration() {
    // ENG-22527 item 3 (LLP 0034 §10.1): the idle-linger teardown's server
    // half — `EphemeralApi::unsubscribe`, the lock-free primitive reached over
    // the shared live socket (SECURITY: no public HTTP route; the socket binds
    // the requester). It removes ONLY the caller's own registration; published
    // entries and other observers' registrations are untouched.
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.register_ephemeral_collection(EphemeralCollection::local_cursor(
        "boardCursors",
        "boardId",
    ));
    let scope = Scope::from_pairs([("boardId", "board_1")]);
    let auth = AuthContext::default();
    let api = snapback.ephemeral_api();
    let request = |connection_id: &str| SubscribeRequest {
        collection: "boardCursors".to_owned(),
        scope: scope.clone(),
        connection_id: connection_id.to_owned(),
        auth: auth.clone(),
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
        // Path-independent since the LLP 0034 review fix 4 (handler sources
        // hash by manifest-relative path): reproducible from any checkout.
        // Re-pinned when LLP 0036 added `uses`/`config` to the manifest shape.
        Some("sha256:61becbf27c074ddd")
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
    }
}

fn auth(user_id: &str) -> AuthInput {
    AuthInput {
        principal: Some(user_id.to_owned()),
        session_id: None,
        user_id: Some(user_id.to_owned()),
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
                supersedes: None,
            },
        )
        .expect("first subscription");
    let second = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                supersedes: None,
            },
        )
        .expect("second subscription");
    assert_ne!(first.subscription_id, second.subscription_id);
    for id in [&first.subscription_id, &second.subscription_id] {
        assert!(id.starts_with("sub_"), "unexpected id shape: {id}");
        assert!(
            id.len() >= "sub_".len() + 32,
            "id must not be an enumerable counter: {id}"
        );
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
                supersedes: None,
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

/// LLP 0032 S5.D9 — a live query handler that returns a non-array fails
/// closed with a structured diagnostic, never a silently-empty result set.
#[test]
fn s5_d9_non_array_query_result_fails_closed() {
    let snapback = configured_ibex_snapback(
        r#"
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
"#,
    );
    let error = snapback
        .invoke_query("listTodos", input(json!({}), "user_1"))
        .expect_err("non-array query result must fail closed");
    assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_RESULT_INVALID");
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
                supersedes: None,
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
                supersedes: None,
            },
        )
        .expect("healthy subscribe");
    snapback
        .subscribe_live(
            "explodeOnItems",
            LiveSubscribeInput {
                connection_id: "exploding".to_owned(),
                input: input(json!({}), "user_1"),
                supersedes: None,
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
    let mut manifest = FunctionManifest::default();
    manifest.functions.push(FunctionDefinition::new(
        "badIndex",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table: "todos".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            indexed_by: Some("does_not_exist".to_owned()),
        })),
    ));
    snapback.load_functions(manifest);

    let error = snapback
        .invoke_query("badIndex", input(json!({}), "user_1"))
        .expect_err("unknown index must fail closed");
    assert_eq!(error.diagnostic.code, "SNAPBACK_QUERY_UNKNOWN_INDEX");

    // A query that names a defined index still works.
    let mut ok_manifest = FunctionManifest::default();
    ok_manifest.functions.push(FunctionDefinition::new(
        "goodIndex",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table: "todos".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            indexed_by: Some("by_user".to_owned()),
        })),
    ));
    snapback.load_functions(ok_manifest);
    snapback
        .invoke_query("goodIndex", input(json!({}), "user_1"))
        .expect("declared index resolves");
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
    snapback.register_ephemeral_collection(EphemeralCollection::local_cursor("cursors", "roomId"));
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
                supersedes: None,
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

/// LLP 0032 E4 — predicate-granularity read-set validation: a captured read of
/// a filtered query conflicts only with writes that actually affect the query's
/// result. A concurrent *non-matching* write no longer conflicts (the
/// table-granularity spurious conflict), while a *matching* write still does.
#[test]
fn e4_query_validation_is_predicate_granular() {
    let filtered_query = || CapturedReadDependency {
        kind: CapturedReadKind::Query,
        table: Some("todos".to_owned()),
        id: None,
        version: None, // filled per-case with the captured table version
        predicate: Some(
            serde_json::to_value(QueryPlan {
                table: "todos".to_owned(),
                filters: vec![FilterExpr {
                    field: "completed".to_owned(),
                    op: FilterOp::Eq,
                    value: ValueExpr::Literal(json!(true)),
                }],
                order: Vec::new(),
                limit: None,
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
        db.commit_buffered_writes(
            &input(json!({}), "u"),
            vec![BufferedWrite::Insert {
                table: "todos".to_owned(),
                id: db.generate_id(),
                values: json!({ "title": title, "completed": completed, "userId": "u" })
                    .as_object()
                    .cloned()
                    .unwrap(),
            }],
            Vec::new(),
            json!(null),
        )
    };

    // Non-matching concurrent write → no conflict (the E4 win).
    {
        let mut db = LocalDatabase::memory().unwrap();
        db.apply_schema(todo_schema()).unwrap();
        let captured = db.table_change_version("todos").unwrap();
        commit_todo(&mut db, "not-completed", false).expect("concurrent non-matching write");
        let mut dep = filtered_query();
        dep.version = Some(captured);
        let result = db.commit_buffered_writes(
            &input(json!({}), "u"),
            vec![BufferedWrite::Insert {
                table: "todos".to_owned(),
                id: db.generate_id(),
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
        db.apply_schema(todo_schema()).unwrap();
        let captured = db.table_change_version("todos").unwrap();
        commit_todo(&mut db, "completed", true).expect("concurrent matching write");
        let mut dep = filtered_query();
        dep.version = Some(captured);
        let error = db
            .commit_buffered_writes(
                &input(json!({}), "u"),
                vec![BufferedWrite::Insert {
                    table: "todos".to_owned(),
                    id: db.generate_id(),
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
                supersedes: None,
            },
        )
        .expect("first subscribe");
    let second = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
                supersedes: None,
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
                supersedes: Some(first.subscription_id.clone()),
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
                supersedes: Some("sub_gone".to_owned()),
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
    backend.register_collection(EphemeralCollection::local_cursor("boardCursors", "boardId"));
    let scope = Scope::from_pairs([("boardId", "board_1")]);
    let auth = AuthContext::default();

    let snapshot = backend
        .subscribe(
            SubscribeRequest {
                collection: "boardCursors".to_owned(),
                scope: scope.clone(),
                connection_id: "observer".to_owned(),
                auth: auth.clone(),
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
    backend.replace_collections(vec![changed]);

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
                supersedes: None,
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
    assert_eq!(
        disposed.receipt.as_ref().expect("receipt")["event"],
        "disposed"
    );
    assert_eq!(
        disposed.receipt.as_ref().expect("receipt")["reason"],
        "unsubscribed"
    );

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
    declared.write_set_summary.tables = vec!["todos".to_owned()];
    let mut undeclared = system_todo_mutation();
    undeclared.name = "undeclaredWrites".to_owned();
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
    let output = result.expect("mutation");
    assert_eq!(receipt["kind"], "mutation");
    assert_eq!(receipt["outcome"], "confirmed");
    assert_eq!(receipt["rollbackReason"], Value::Null);
    assert_eq!(receipt["affectedTables"], json!(["todos"]));
    assert_eq!(receipt["snapshotVersion"], json!(output.version));
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
    assert_eq!(unknown_receipt["affectedTables"], Value::Null);

    // A rejected mutation still produces its receipt, with the diagnostic
    // CODE (never the message) as the rollback reason (§3.3 privacy).
    let (rejected, rejected_receipt) =
        snapback.invoke_mutation_recording("nope", input(json!({}), "user_1"));
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
                supersedes: None,
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
