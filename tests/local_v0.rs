use serde_json::{Map, Value, json};
use snapback::cron::{CronActivationState, CronRunOutcome};
use snapback::ephemeral::{
    AuthContext, ClientEphemeralOverlay, EphemeralCollection, EphemeralErrorCode, EphemeralMessage,
    OverlayApply, PublishRequest, RealtimeEnvelope, Scope, SubscribeRequest,
};
use snapback::local::{LiveResumeInput, LiveSubscribeInput, LocalSnapback};
use snapback::manifest::{
    ActionPlan, ActionReturnValue, ActionStep, AuthInput, CronActivationKind, CronActivationPolicy,
    CronJitterPolicy, CronJobDefinition, CronOverlapPolicy, CronRetryMode, CronRetryPolicy,
    CronSchedule, FieldManifest, FieldType, FilterExpr, FilterOp, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, IbexModule, IndexManifest,
    MutationPlan, MutationStep, OrderDirection, OrderExpr, PermissionScopeExpr, QueryPlan,
    ReadDependency, ReturnValue, SchemaManifest, SeedData, TableManifest, ValueExpr,
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
                input: input(json!({}), "cron"),
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
        Some("sha256:e0f87e44f7d609b2")
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
            },
        )
        .expect("first subscription");
    let second = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "client_a".to_owned(),
                input: input(json!({}), "user_1"),
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
