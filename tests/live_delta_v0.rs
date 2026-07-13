//! DK-3 op-log delta fan-out (LLP 0008 §Decision DK-3 / LLP 0034 OQ1).
//!
//! Live delivery for the analyzable subset — an unordered single-table
//! filtered HostPlan query — ships a `live_delta` (the classified per-row
//! transitions) instead of re-running the query and shipping a whole-result
//! `live_replace`. These tests prove: the delta is emitted for the eligible
//! subset, ordered/limited queries fall back to `live_replace`, and — the
//! load-bearing correctness property — applying the deltas client-side
//! converges to exactly what a fresh query returns, across a mixed commit
//! sequence.

use serde_json::{Map, Value, json};
use snapback::ephemeral::RealtimeEnvelope;
use snapback::local::{LiveSubscribeInput, LocalSnapback};
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FilterExpr, FilterOp, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, MutationPlan, MutationStep,
    QueryPlan, ReturnValue, SchemaManifest, TableManifest, ValueExpr,
};
use std::collections::BTreeMap;

/// The committed row that enters/leaves/updates a subscription's result is
/// delivered as a `live_delta` op, not a whole-result replace.
#[test]
fn live_delta_is_emitted_for_an_unordered_filtered_query() {
    let mut snapback = configured();
    snapback
        .subscribe_live("listMine", sub_input("conn", "ada"))
        .expect("subscribe");

    // A matching insert → one `add` op.
    let created = snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "mine", "userId": "ada" }), "ada"),
        )
        .expect("create");
    let id = created.result.as_str().expect("id").to_owned();

    let update = drain_one_update(&mut snapback, "conn");
    assert_eq!(update["kind"], "live_delta");
    assert!(update["subscription_id"].is_string());
    let ops = update["ops"].as_array().expect("ops");
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0]["op"], "add");
    assert_eq!(ops[0]["id"], id);
    assert_eq!(ops[0]["row"]["userId"], "ada");

    // A non-matching insert (different user) → the subscription is not affected,
    // no delivery at all.
    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "theirs", "userId": "bob" }), "bob"),
        )
        .expect("create other");
    assert!(
        drain(&mut snapback, "conn").is_empty(),
        "a non-matching commit produces no delta for this subscription"
    );
}

/// An ordered query keeps the honest whole-result `live_replace` path (the
/// delta core returns `Replace` for ordered/limited windows).
#[test]
fn ordered_query_falls_back_to_live_replace() {
    let mut snapback = configured();
    snapback
        .subscribe_live("listMineOrdered", sub_input("conn", "ada"))
        .expect("subscribe");
    snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "mine", "userId": "ada" }), "ada"),
        )
        .expect("create");

    let update = drain_one_update(&mut snapback, "conn");
    assert_eq!(
        update["kind"], "live_replace",
        "ordered queries must fall back to the whole-result replace"
    );
    assert_eq!(update["rows"].as_array().expect("rows").len(), 1);
}

/// The correctness property: applying the emitted deltas on the client
/// converges to exactly what a fresh query returns, across insert / update
/// into / update out of / delete. The server's own debug convergence assertion
/// guards membership; this test additionally reconstructs the *client* row set
/// from the deltas and compares it to a fresh query.
#[test]
fn deltas_applied_clientside_converge_with_a_fresh_query() {
    let mut snapback = configured();
    snapback
        .subscribe_live("listMine", sub_input("conn", "ada"))
        .expect("subscribe");

    // A simulated client result store: id -> row, applied exactly as
    // demos/_kit/client.mjs does (add/update upsert, remove drop).
    let mut client: BTreeMap<String, Value> = BTreeMap::new();

    // 1. insert matching → add
    let a = create(&mut snapback, "a-mine", "ada");
    apply_deltas(&mut client, drain(&mut snapback, "conn"));
    // 2. insert non-matching → no delta
    let _b = create(&mut snapback, "b-theirs", "bob");
    apply_deltas(&mut client, drain(&mut snapback, "conn"));
    // 3. insert another matching → add
    let c = create(&mut snapback, "c-mine", "ada");
    apply_deltas(&mut client, drain(&mut snapback, "conn"));
    // 4. update `a` moving OUT of the predicate (reassign to bob) → remove
    set_user(&mut snapback, &a, "bob");
    apply_deltas(&mut client, drain(&mut snapback, "conn"));
    // 5. update `c` in place (still matches) → update
    set_title(&mut snapback, &c, "c-renamed");
    apply_deltas(&mut client, drain(&mut snapback, "conn"));
    // 6. update `b` moving INTO the predicate (reassign to ada) → add
    let b_id = todo_id(&snapback, "b-theirs");
    set_user(&mut snapback, &b_id, "ada");
    apply_deltas(&mut client, drain(&mut snapback, "conn"));
    // 7. delete a member (`c`) → remove
    delete_todo(&mut snapback, &c);
    apply_deltas(&mut client, drain(&mut snapback, "conn"));

    // The client's reconstructed membership must equal a fresh query's ids.
    let fresh = snapback
        .invoke_query("listMine", input(json!({ "userId": "ada" }), "ada"))
        .expect("fresh query");
    let fresh_ids: std::collections::BTreeSet<String> = fresh
        .rows
        .iter()
        .filter_map(|row| row["_id"].as_str().map(str::to_owned))
        .collect();
    let client_ids: std::collections::BTreeSet<String> = client.keys().cloned().collect();
    assert_eq!(
        client_ids, fresh_ids,
        "client rows reconstructed from deltas must match a fresh query"
    );
    // And the surviving rows' content matches (delta carried the current row).
    for row in &fresh.rows {
        let id = row["_id"].as_str().unwrap();
        assert_eq!(
            client[id]["title"], row["title"],
            "delta-applied row content must match the fresh row"
        );
    }
}

/// Finding A (HIGH): a NULL value in a range-filtered field must not phantom
/// into the result. SQL `WHERE priority < 3` excludes a NULL priority; the
/// matcher must agree or the client holds a row a real query never returns and
/// membership drifts permanently.
#[test]
fn null_field_never_phantoms_into_a_range_filter() {
    let mut snapback = configured();
    snapback
        .subscribe_live("listUrgent", sub_input("conn", "ada"))
        .expect("subscribe");

    // A matching row (priority 1 < 3) → delivered.
    let urgent = snapback
        .invoke_mutation(
            "createWithPriority",
            input(
                json!({ "title": "urgent", "userId": "ada", "priority": 1 }),
                "ada",
            ),
        )
        .expect("create urgent")
        .result
        .as_str()
        .expect("id")
        .to_owned();
    let mut client: BTreeMap<String, Value> = BTreeMap::new();
    apply_deltas(&mut client, drain(&mut snapback, "conn"));

    // A NULL-priority row (created without priority) must NOT appear — SQL
    // excludes it, so no delta may add it. (Pre-fix, the matcher read
    // `NULL < 3` as true and delivered a phantom add; the server's debug
    // convergence assertion would fire on that delta.)
    let _null_row = snapback
        .invoke_mutation(
            "createTodo",
            input(json!({ "title": "someday", "userId": "ada" }), "ada"),
        )
        .expect("create null-priority");
    apply_deltas(&mut client, drain(&mut snapback, "conn"));

    let fresh = snapback
        .invoke_query("listUrgent", input(json!({}), "ada"))
        .expect("fresh");
    let fresh_ids: std::collections::BTreeSet<String> = fresh
        .rows
        .iter()
        .filter_map(|r| r["_id"].as_str().map(str::to_owned))
        .collect();
    assert_eq!(
        client
            .keys()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>(),
        fresh_ids,
        "the NULL-priority row must not phantom into `priority < 3`"
    );
    assert_eq!(fresh_ids, std::collections::BTreeSet::from([urgent]));
}

/// Finding B (MEDIUM): one commit that inserts then deletes the same row nets
/// to nothing — no phantom add for a row that no longer exists.
#[test]
fn insert_then_delete_in_one_commit_is_a_no_op() {
    let mut snapback = configured();
    snapback
        .subscribe_live("listMine", sub_input("conn", "ada"))
        .expect("subscribe");

    snapback
        .invoke_mutation(
            "createThenDelete",
            input(json!({ "title": "ephemeral", "userId": "ada" }), "ada"),
        )
        .expect("create-then-delete");

    let mut client: BTreeMap<String, Value> = BTreeMap::new();
    apply_deltas(&mut client, drain(&mut snapback, "conn"));
    assert!(
        client.is_empty(),
        "a row created and deleted in one commit must not appear"
    );
    let fresh = snapback
        .invoke_query("listMine", input(json!({ "userId": "ada" }), "ada"))
        .expect("fresh");
    assert!(fresh.rows.is_empty());
}

/// Finding C (MEDIUM): `seed()` (empty-changes refresh signal) must still
/// deliver to a HostPlan-query subscriber — the delta path is only for real
/// commits with a change list.
#[test]
fn seed_delivers_to_a_hostplan_subscriber() {
    let mut snapback = configured();
    snapback
        .subscribe_live("listMine", sub_input("conn", "ada"))
        .expect("subscribe");

    let mut seeded = Map::new();
    seeded.insert("title".to_owned(), json!("seeded"));
    seeded.insert("userId".to_owned(), json!("ada"));
    snapback
        .seed(snapback::manifest::SeedData {
            tables: BTreeMap::from([("todos".to_owned(), vec![seeded])]),
        })
        .expect("seed");

    let mut client: BTreeMap<String, Value> = BTreeMap::new();
    let envelopes = drain(&mut snapback, "conn");
    assert!(
        !envelopes.is_empty(),
        "seed must deliver the seeded state to the live subscriber"
    );
    apply_deltas(&mut client, envelopes);
    assert_eq!(
        client.len(),
        1,
        "the seeded matching row reaches the subscriber"
    );
}

/// Updates always change `_version` even when the user-field change list does
/// not include it. A subscription whose predicate mentions `_version` must
/// therefore be treated as affected or stale rows remain in the client.
#[test]
fn system_field_predicates_are_affected_by_updates() {
    let mut snapback = configured();
    let id = create(&mut snapback, "versioned", "ada");
    let subscription = snapback
        .subscribe_live("listVersionOne", sub_input("conn", "ada"))
        .expect("subscribe");
    assert_eq!(subscription.snapshot.rows.len(), 1);

    set_title(&mut snapback, &id, "versioned-again");

    let update = drain_one_update(&mut snapback, "conn");
    assert_eq!(update["kind"], "live_delta");
    let ops = update["ops"].as_array().expect("ops");
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0]["op"], "remove");
    assert_eq!(ops[0]["id"], id);
}

/* ---------- client-apply simulation (mirrors demos/_kit/client.mjs) ---------- */

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

/* ---------- harness ---------- */

fn drain(snapback: &mut LocalSnapback, connection: &str) -> Vec<RealtimeEnvelope> {
    snapback.drain_outbox(connection)
}

fn drain_one_update(snapback: &mut LocalSnapback, connection: &str) -> Value {
    let envelopes = drain(snapback, connection);
    let RealtimeEnvelope::Durable(message) = envelopes
        .into_iter()
        .next()
        .expect("expected a durable update")
    else {
        panic!("expected a durable envelope");
    };
    serde_json::from_slice(&message.payload).expect("json")
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

fn todo_id(snapback: &LocalSnapback, title: &str) -> String {
    let all = snapback
        .invoke_query("listAll", input(json!({}), "admin"))
        .expect("list all");
    all.rows
        .iter()
        .find(|row| row["title"] == title)
        .and_then(|row| row["_id"].as_str())
        .expect("row present")
        .to_owned()
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
        supersedes: None,
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
        schema_hash: Some("delta-v0".to_owned()),
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
                // Optional → a row that omits it stores SQL NULL (finding A).
                FieldManifest {
                    name: "priority".to_owned(),
                    field_type: FieldType::Integer,
                    optional: true,
                },
            ],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
        }],
        ..SchemaManifest::default()
    }
}

fn functions() -> FunctionManifest {
    let filtered_query = |name: &str, order: Vec<snapback::manifest::OrderExpr>| {
        FunctionDefinition::new(
            name,
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table: "todos".to_owned(),
                filters: vec![FilterExpr {
                    field: "userId".to_owned(),
                    op: FilterOp::Eq,
                    value: ValueExpr::AuthUserId,
                }],
                order,
                limit: None,
                indexed_by: None,
            })),
        )
    };
    let insert = FunctionDefinition::new(
        "createTodo",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
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
            steps: vec![MutationStep::Delete {
                table: "todos".to_owned(),
                id: ValueExpr::Arg("id".to_owned()),
            }],
            return_value: Some(ReturnValue::ChangedCount),
        })),
    );
    let list_all = FunctionDefinition::new(
        "listAll",
        FunctionKind::Query,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table: "todos".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            indexed_by: None,
        })),
    );
    // An unordered range-filtered query: `priority < 3`. A row with a NULL
    // priority must be excluded, matching SQL (finding A).
    let list_urgent = FunctionDefinition::new(
        "listUrgent",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table: "todos".to_owned(),
            filters: vec![FilterExpr {
                field: "priority".to_owned(),
                op: FilterOp::Lt,
                value: ValueExpr::Literal(json!(3)),
            }],
            order: Vec::new(),
            limit: None,
            indexed_by: None,
        })),
    );
    let list_version_one = FunctionDefinition::new(
        "listVersionOne",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table: "todos".to_owned(),
            filters: vec![FilterExpr {
                field: "_version".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Literal(json!(1)),
            }],
            order: Vec::new(),
            limit: None,
            indexed_by: None,
        })),
    );
    let create_with_priority = FunctionDefinition::new(
        "createWithPriority",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            steps: vec![MutationStep::Insert {
                table: "todos".to_owned(),
                values: BTreeMap::from([
                    ("title".to_owned(), ValueExpr::Arg("title".to_owned())),
                    ("userId".to_owned(), ValueExpr::Arg("userId".to_owned())),
                    ("priority".to_owned(), ValueExpr::Arg("priority".to_owned())),
                ]),
                bind_id_as: Some("id".to_owned()),
            }],
            return_value: Some(ReturnValue::Binding("id".to_owned())),
        })),
    );
    // One mutation that inserts then deletes the same row (finding B): the
    // commit's change list holds both, and only the last (Delete) is the row's
    // final state.
    let create_then_delete = FunctionDefinition::new(
        "createThenDelete",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
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
        bundle_hash: Some("delta-fns-v0".to_owned()),
        functions: vec![
            filtered_query("listMine", Vec::new()),
            filtered_query(
                "listMineOrdered",
                vec![snapback::manifest::OrderExpr {
                    field: "title".to_owned(),
                    direction: snapback::manifest::OrderDirection::Asc,
                }],
            ),
            list_urgent,
            list_version_one,
            insert,
            create_with_priority,
            create_then_delete,
            patch("setUser", "userId"),
            patch("setTitle", "title"),
            delete,
            list_all,
        ],
        ..FunctionManifest::default()
    }
}
