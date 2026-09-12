use super::super::writer_live_tests::state_with;
use super::*;
use snapback2_core::{
    Auth, ColumnType, Constraint, Index, IndexComponent, Input, ProjectJson, Schema, Table,
    delivery, object, public_table,
};

fn table(columns: &[(&str, ColumnType)], indexes: &[(&str, &[&str], bool)]) -> Table {
    public_table(
        columns
            .iter()
            .map(|(name, kind)| ((*name).into(), kind.clone()))
            .collect(),
        indexes
            .iter()
            .map(|(name, columns, unique)| {
                (
                    (*name).into(),
                    Index {
                        components: columns
                            .iter()
                            .map(|column| IndexComponent::Column((*column).into()))
                            .collect(),
                        unique: *unique,
                    },
                )
            })
            .collect(),
    )
}

fn project() -> ProjectJson {
    let reference = || ColumnType::Ref {
        table: "groups".into(),
    };
    let mut members = table(
        &[
            ("id", ColumnType::Id),
            ("group", reference()),
            ("principal", ColumnType::Principal),
        ],
        &[
            ("byId", &["id"], true),
            ("byGroup", &["group", "principal"], false),
        ],
    );
    members.constraints.push(Constraint::Cap {
        by: vec!["group".into()],
        max: 2,
    });
    let declaration = delivery::Deliver {
        target: "members".into(),
        prefix: vec!["group".into()],
        principal: "principal".into(),
        log: "events".into(),
        receipts: true,
        bootstrap: false,
    };
    let mut messages = table(
        &[
            ("id", ColumnType::Id),
            ("group", reference()),
            ("body", ColumnType::Text { max: 1_000 }),
        ],
        &[("byId", &["id"], true)],
    );
    messages.deliver = Some(declaration.clone());
    let mut schema = Schema {
        tables: BTreeMap::from([
            (
                "groups".into(),
                table(&[("id", ColumnType::Id)], &[("byId", &["id"], true)]),
            ),
            ("members".into(), members),
            ("messages".into(), messages),
        ]),
        ..Schema::default()
    };
    schema.tables.insert(
        "events".into(),
        delivery::log_table(&schema, "messages", &declaration).unwrap(),
    );
    schema.tables.insert(
        "eventsReceipts".into(),
        delivery::receipts_table(&schema, "messages", &declaration).unwrap(),
    );
    let scan = |name: &str, table: &str, index: &str, prefix| Program {
        name: name.into(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("c".into(), ArgType::Optional(Box::new(ArgType::Cursor)))]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: format!("{name}.page"),
            table: table.into(),
            index: index.into(),
            prefix,
            order: Order::Asc,
            take: Bound::Literal(50),
            after: Some(Box::new(Expr::Variable("c".into()))),
            before: None,
            range: None,
            opaque_cursor: true,
            merge_site: None,
            provenance: KeyProvenance::Shape,
        }))],
    };
    let noop = Program {
        name: "product.write".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Null))],
    };
    ProjectJson {
        version: 1,
        schema,
        programs: vec![
            scan(
                "events.log",
                "events",
                "byRecipient",
                vec![snapback2_core::ir::IndexKeyExpr::Scalar(Expr::Input(
                    Input::Viewer,
                ))],
            ),
            scan("messages.log", "messages", "byId", vec![]),
            delivery::ack_program("messages", &declaration),
            noop.clone(),
            Program {
                name: "members.remove".into(),
                body: vec![Stmt::Delete {
                    table: "members".into(),
                    key: Expr::Literal(Value::Id("membership".into())),
                }],
                ..noop
            },
        ],
        effects: vec![],
        auth: Auth::default(),
    }
}

fn fixture(count: usize, body_bytes: usize) -> State {
    let mut state = state_with("bulk-acquisition", project());
    let mut rows = vec![
        ("groups".into(), object([("id", Value::Id("group".into()))])),
        (
            "members".into(),
            object([
                ("id", Value::Id("membership".into())),
                ("group", Value::Id("group".into())),
                ("principal", Value::Id("dev:alice".into())),
            ]),
        ),
    ];
    rows.extend((0..count).map(|index| {
        (
            "messages".into(),
            object([
                ("id", Value::Id(format!("message-{index:03}"))),
                ("group", Value::Id("group".into())),
                ("body", Value::String("x".repeat(body_bytes))),
            ]),
        )
    }));
    state.runtime_mut().seed(&rows).unwrap();
    state
}

fn alice() -> Identity {
    Identity::Persona("alice".into())
}
fn query(op: &str, cursor: Json, count: usize) -> Json {
    json!({"op": op, "args": {"c": cursor}, "batch": count})
}
fn unrestricted(field: &str) -> Batch {
    let mut batch = Batch::new(field);
    batch.max_work = Duration::MAX;
    batch
}
fn replay(grant: &snapback2_core::ReplayGrant, offset: u32, events: Vec<Json>) -> Json {
    json!({"op": "_delivery.events.ack", "args": {"events": events}, "replay": {
        "grant": grant.id, "offset": offset, "count": 1, "intent": format!("{}:{offset}", grant.id),
        "trace": {"points": [], "verdicts": []},
    }})
}
fn drop_state(state: State) {
    let root = state.root.clone();
    drop(state);
    std::fs::remove_dir_all(root).unwrap();
}

fn native_request(state: &State, after: Json, receipts: Json) -> Json {
    json!({"protocol":1,"generation":state.runtime().generation().program_hash(),
        "schemaHash":state.runtime().generation().schema().hash(),"authEpoch":0,
        "log":"events","after":after,"receipts":receipts,"pages":8})
}

fn native_ids(response: &Json) -> Vec<Json> {
    response["pages"].as_array().unwrap().iter().flat_map(|page|
        page["events"].as_array().unwrap().iter().map(|event| event["id"].clone())).collect()
}

fn native_receipt(state: &mut State, id: &Json) -> Value {
    let program = Program { name: "oracle".into(), kind: ProgramKind::Query,
        args: BTreeMap::new(), read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(snapback2_core::Read { site:"oracle".into(),
            table:"eventsReceipts".into(),index:"byId".into(),key:vec![Expr::Literal(Value::Id(id.as_str().unwrap().into()))],
            provenance:KeyProvenance::Const }))] };
    state.runtime_mut().read_operator(&program, BTreeMap::new(), snapback2_core::OperatorId("test".into()), 0).unwrap().result
}

fn native_write(state: &mut State, statement: Stmt) -> Execution {
    state.runtime_mut().execute_adhoc(&Program { name:"test.write".into(), kind:ProgramKind::Mutation,
        args:BTreeMap::new(),read_time_granularity_ms:None,body:vec![statement] },
        Context::mutation(Actor::persona("alice").unwrap(),BTreeMap::new())).unwrap()
}

#[test]
fn native_acquisition_pages_are_contiguous_current_and_pooled_once() {
    let mut state = fixture(101, 20);
    let mut after = Json::Null;
    let mut events = BTreeSet::new();
    let seq = state.runtime().store().commit_seq().unwrap();
    loop {
        let request = native_request(&state, after.clone(), json!([]));
        let response = state.acquire(request, alice()).unwrap();
        assert!(response.get("error").is_none(), "{response}");
        assert_eq!(response["seq"], seq);
        assert!(serde_json::to_vec(&response).unwrap().len() <= 1_048_576);
        let rows = response["rows"].as_array().unwrap();
        let mut keys = BTreeSet::new();
        for row in rows { assert!(keys.insert((row["table"].to_string(),row["id"].to_string()))); }
        for page in response["pages"].as_array().unwrap() {
            assert_eq!(page["after"], after);
            assert!(page["events"].as_array().unwrap().len() <= 50);
            for event in page["events"].as_array().unwrap() {
                assert!(events.insert(event["id"].to_string()));
                assert_eq!(event["disposition"], "present");
                assert!(rows.iter().any(|row| row["table"] == "messages" && row["id"] == event["row"]));
            }
            after = page["cursor"].clone();
            assert_ne!(after, Json::Null);
            assert_eq!(page["next"], if page["exhausted"] == true { Json::Null } else { after.clone() });
        }
        if response["more"] == false { break; }
    }
    assert_eq!(events.len(), 101);
    let request = native_request(&state, after.clone(), json!([]));
    let empty = state.acquire(request, alice()).unwrap();
    assert!(native_ids(&empty).is_empty());
    assert_eq!(empty["pages"][0]["cursor"], after);
    assert_eq!(empty["pages"][0]["exhausted"], true);
    let request = native_request(&state, Json::Null, json!([]));
    assert!(native_ids(&state.acquire(request, Identity::Persona("bob".into())).unwrap()).is_empty());
    drop_state(state);
}

#[test]
fn native_acquisition_lost_reply_and_reopen_preserve_first_receipt_commit() {
    let mut state = fixture(2, 1);
    let request = native_request(&state, Json::Null, json!([]));
    let read = state.acquire(request, alice()).unwrap();
    let ids = native_ids(&read);
    let packet = json!([{"id":"stable-packet","events":ids}]);
    let request = native_request(&state, read["pages"][0]["cursor"].clone(), packet);
    let first = state.acquire(request.clone(), alice()).unwrap();
    assert_eq!(first["receipts"][0]["state"], "complete");
    let committed = first["receipts"][0]["seq"].as_u64().unwrap();
    assert_eq!(native_receipt(&mut state, &ids[0]).field("seq").unwrap(), &Value::Int(committed as i64));
    assert_eq!(native_receipt(&mut state, &ids[1]).field("received").unwrap(), &Value::Bool(true));
    let commits = state.runtime().store().commits_since(committed - 1, 1).unwrap();
    assert_eq!(commits[0].kind, "receipt");
    assert_eq!(commits[0].writes["eventsReceipts"], 2);
    assert!(state.runtime().store().stored_client_intent("dev:alice", "stable-packet").unwrap().is_none());
    let path = state.root.join("receipt-reopen.sqlite");
    state.runtime().store().snapshot_to(&path).unwrap();
    let generation = state.runtime().generation().clone();
    state.runtime = Some(Runtime::open(snapback2_core::Store::open(&path).unwrap(), generation).unwrap());
    let retried = state.acquire(request, alice()).unwrap();
    assert_eq!(retried["receipts"], first["receipts"]);
    assert_eq!(state.runtime().store().commit_seq().unwrap(), committed);
    assert_eq!(native_receipt(&mut state, &ids[0]).field("seq").unwrap(), &Value::Int(committed as i64));
    drop_state(state);
}

#[test]
fn native_acquisition_packet_refusal_rolls_back_prior_receipts_and_deletion_remains_visible() {
    let mut state = fixture(2, 1);
    let request = native_request(&state, Json::Null, json!([]));
    let read = state.acquire(request, alice()).unwrap();
    let ids = native_ids(&read);
    let deleted_row = read["pages"][0]["events"][1]["row"].as_str().unwrap().to_owned();
    let deleted = native_write(&mut state, Stmt::Delete { table:"messages".into(),key:Expr::Literal(Value::Id(deleted_row.clone())) });
    assert!(matches!(deleted.state, ExecutionState::Committed { .. }));
    let before = state.runtime().store().commit_seq().unwrap();
    let request = native_request(&state, Json::Null, json!([{"id":"atomic","events":ids}]));
    let result = state.acquire(request, alice()).unwrap();
    assert_eq!(result["receipts"][0]["state"], "rejected");
    assert_eq!(result["receipts"][0]["code"], "E_RULE");
    assert_eq!(state.runtime().store().commit_seq().unwrap(), before);
    assert_eq!(native_receipt(&mut state, &ids[0]).field("received").unwrap(), &Value::Bool(false));
    let events = result["pages"].as_array().unwrap().iter().flat_map(|p| p["events"].as_array().unwrap()).collect::<Vec<_>>();
    assert!(events.iter().any(|event| event["row"] == deleted_row && event["disposition"] == "unavailable"));
    assert!(events.iter().any(|event| event["row"] == deleted_row && event["disposition"] == "removed"));
    assert!(!result["rows"].as_array().unwrap().iter().any(|row| row["table"] == "messages" && row["id"] == deleted_row));
    let reinsert = native_write(&mut state, Stmt::Insert { table:"messages".into(), row:Expr::Literal(object([
        ("id",Value::Id(deleted_row)),("group",Value::Id("group".into())),("body",Value::String("replacement".into()))])) });
    assert!(matches!(reinsert.state,ExecutionState::Rejected { ref code, .. } if code == "E_DELIVER_INCARNATION"));
    let request = native_request(&state, Json::Null, json!([{"id":"retry-first","events":[ids[0]]}]));
    assert_eq!(state.acquire(request, alice()).unwrap()["receipts"][0]["state"], "complete");
    drop_state(state);
}

#[test]
fn native_acquisition_current_membership_and_identity_fences_precede_writes() {
    let mut state = fixture(2, 1);
    let request = native_request(&state, Json::Null, json!([]));
    let ids = native_ids(&state.acquire(request.clone(), alice()).unwrap());
    assert_eq!(state.acquire(request.clone(), Identity::Anonymous).unwrap_err().code,"E_AUTH_REQUIRED");
    let mut forged = request.clone(); forged["log"] = json!("messages");
    assert_eq!(state.acquire(forged, alice()).unwrap_err().code,"E_INPUT");
    for field in ["generation","schemaHash","authEpoch"] {
        let mut stale = request.clone(); stale[field] = if field == "authEpoch" { json!(99) } else { json!("stale") };
        assert_eq!(state.acquire(stale, alice()).unwrap_err().code,"E_OFFLINE_RESUME");
    }
    let mut cursor = request.clone(); cursor["after"] = json!("not-a-cursor");
    cursor["receipts"] = json!([{"id":"no-write","events":ids}]);
    assert_eq!(state.acquire(cursor, alice()).unwrap_err().code,"E_INPUT");
    assert_eq!(native_receipt(&mut state, &ids[0]).field("received").unwrap(), &Value::Bool(false));
    state.execute("members.remove",json!({}),alice(),Some(ProgramKind::Mutation),OfflineOptions::default(),None).unwrap();
    let mut departed = request; departed["receipts"] = json!([{"id":"departed","events":ids}]);
    let response = state.acquire(departed, alice()).unwrap();
    assert_eq!(response["receipts"][0]["code"],"E_RULE");
    assert_eq!(native_receipt(&mut state, &ids[0]).field("received").unwrap(), &Value::Bool(false));
    drop_state(state);
}

#[test]
fn native_acquisition_current_body_rules_disclose_verdicts_without_private_inputs() {
    use snapback2_core::{RuleExpr, RuleTerm};
    let mut project = project();
    let members = project.schema.tables.get_mut("members").unwrap();
    members.rules.read = RuleExpr::Deny;
    members.indexes.get_mut("byGroup").unwrap().unique = true;
    project.schema.tables.get_mut("messages").unwrap().rules.read = RuleExpr::Exists {
        table:"members".into(),index:"byGroup".into(),
        key:vec![RuleTerm::Field("group".into()),RuleTerm::Viewer],provenance:KeyProvenance::Shape,
    };
    let d = project.schema.tables["messages"].deliver.clone().unwrap();
    project.schema.tables.insert("eventsReceipts".into(),delivery::receipts_table(&project.schema,"messages",&d).unwrap());
    let mut state = state_with("native-private-rules",project);
    state.runtime_mut().seed(&[
        ("groups".into(),object([("id",Value::Id("group".into()))])),
        ("members".into(),object([("id",Value::Id("membership".into())),("group",Value::Id("group".into())),("principal",Value::Id("dev:alice".into()))])),
        ("messages".into(),object([("id",Value::Id("body".into())),("group",Value::Id("group".into())),("body",Value::String("private".into()))])),
    ]).unwrap();
    let request = native_request(&state,Json::Null,json!([]));
    let first = state.acquire(request.clone(),alice()).unwrap();
    assert_eq!(first["pages"][0]["events"][0]["disposition"],"present");
    assert!(!first["pages"][0]["receipt"]["verdicts"].as_array().unwrap().is_empty());
    assert!(first["rows"].as_array().unwrap().iter().all(|row| row["table"] != "members"));
    state.execute("members.remove",json!({}),alice(),Some(ProgramKind::Mutation),OfflineOptions::default(),None).unwrap();
    let second = state.acquire(request,alice()).unwrap();
    assert_eq!(second["pages"][0]["events"][0]["disposition"],"unavailable");
    assert!(second["rows"].as_array().unwrap().iter().all(|row| row["table"] != "members" && row["table"] != "messages"));
    drop_state(state);
}

#[test]
fn native_acquisition_receipt_and_page_turns_obey_the_same_unit_fairness() {
    let mut state = fixture(2,1);
    let request = native_request(&state,Json::Null,json!([]));
    let ids = native_ids(&state.acquire(request.clone(),alice()).unwrap());
    let mut receipts = request.clone();
    receipts["receipts"] = json!([{"id":"first","events":[ids[0]]},{"id":"second","events":[ids[1]]}]);
    let limited = state.acquire_with_work(receipts,alice(),Duration::ZERO).unwrap();
    assert_eq!(limited["receipts"].as_array().unwrap().len(),1);
    assert!(limited["pages"].as_array().unwrap().is_empty());
    assert_eq!(limited["more"],true);
    assert_eq!(native_receipt(&mut state,&ids[1]).field("received").unwrap(),&Value::Bool(false));
    let progress = state.acquire_with_work(request,alice(),Duration::ZERO).unwrap();
    assert_eq!(native_ids(&progress).len(),2,"a receipt-free turn always completes its first bounded page");
    drop_state(state);
}

#[test]
fn query_batch_preserves_exact_same_commit_pages_and_continuation() {
    let mut state = fixture(101, 1);
    let first = state
        .query_batch_with(
            query("events.log", Json::Null, 2),
            alice(),
            unrestricted("pages"),
        )
        .unwrap();
    assert_eq!(first["pages"].as_array().unwrap().len(), 2);
    assert_eq!(first["more"], true);
    let seq = first["pages"][0]["envelope"]["seq"].clone();
    let authority = state.resolve_authority(alice()).unwrap();
    let mut ids = BTreeSet::new();
    for (index, frame) in first["pages"].as_array().unwrap().iter().enumerate() {
        let ordinary = state
            .execute_batch_page("events.log", frame["args"].clone(), &authority)
            .unwrap();
        assert_eq!(frame["envelope"], ordinary);
        assert_eq!(ordinary["seq"], seq);
        assert_eq!(ordinary["data"].as_array().unwrap().len(), 50);
        assert_eq!(
            frame["args"]["c"],
            if index == 0 {
                Json::Null
            } else {
                first["pages"][index - 1]["envelope"]["next"].clone()
            }
        );
        for row in ordinary["data"].as_array().unwrap() {
            assert!(ids.insert(row["$row"]["id"].as_str().unwrap().to_owned()));
        }
    }
    let foreground = state
        .execute(
            "product.write",
            json!({}),
            alice(),
            Some(ProgramKind::Mutation),
            OfflineOptions::default(),
            None,
        )
        .unwrap();
    assert_eq!(foreground["state"], "committed");
    assert!(foreground["seq"].as_u64().unwrap() > seq.as_u64().unwrap());
    let cursor = first["pages"][1]["envelope"]["next"].clone();
    let last = state
        .query_batch_with(
            query("events.log", cursor, 16),
            alice(),
            unrestricted("pages"),
        )
        .unwrap();
    assert_eq!(last["more"], false);
    assert_eq!(last["pages"].as_array().unwrap().len(), 1);
    assert_eq!(
        last["pages"][0]["envelope"]["rows"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(last["pages"][0]["envelope"]["seq"], foreground["seq"]);
    assert!(
        ids.insert(
            last["pages"][0]["envelope"]["data"][0]["$row"]["id"]
                .as_str()
                .unwrap()
                .to_owned()
        )
    );
    assert_eq!(ids.len(), 101);
    drop_state(state);
}

#[test]
fn query_batch_byte_and_time_stops_preserve_progress_and_an_oversized_first_page() {
    let mut state = fixture(51, 500);
    let mut small_target = unrestricted("pages");
    small_target.max_bytes = 1_024;
    let first = state
        .query_batch_with(query("messages.log", Json::Null, 16), alice(), small_target)
        .unwrap();
    assert_eq!(first["pages"].as_array().unwrap().len(), 1);
    assert_eq!(first["more"], true);
    assert!(
        encoded_length(&first) > 1_024,
        "a legal first page must make progress alone"
    );
    let next = first["pages"][0]["envelope"]["next"].clone();
    let last = state
        .query_batch_with(
            query("messages.log", next, 16),
            alice(),
            unrestricted("pages"),
        )
        .unwrap();
    assert_eq!(last["more"], false);
    assert_eq!(
        last["pages"][0]["envelope"]["rows"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let mut time_bound = unrestricted("pages");
    time_bound.max_work = Duration::ZERO;
    let timed = state
        .query_batch_with(query("events.log", Json::Null, 16), alice(), time_bound)
        .unwrap();
    assert_eq!(timed["pages"].as_array().unwrap().len(), 1);
    assert_eq!(timed["more"], true);
    let ordinary = state
        .query_batch_with(
            query("events.log", Json::Null, 16),
            alice(),
            unrestricted("pages"),
        )
        .unwrap();
    let mut byte_bound = unrestricted("pages");
    byte_bound.max_bytes =
        encoded_length(&json!({"pages": [ordinary["pages"][0]], "more": false})) + 1;
    let bytes = state
        .query_batch_with(query("events.log", Json::Null, 16), alice(), byte_bound)
        .unwrap();
    assert_eq!(bytes["pages"].as_array().unwrap().len(), 1);
    assert_eq!(bytes["more"], true);
    assert_eq!(bytes["pages"][0], ordinary["pages"][0]);
    drop_state(state);
}

#[test]
fn batch_limits_auth_and_certified_log_admission_are_checked() {
    let mut state = fixture(1, 1);
    for invalid in [0, 17] {
        assert_eq!(
            state
                .query_batch(query("events.log", Json::Null, invalid), alice())
                .unwrap_err()
                .code,
            "E_INPUT"
        );
    }
    assert_eq!(
        state
            .query_batch(query("events.log", Json::Null, 1), Identity::Anonymous)
            .unwrap_err()
            .code,
        "E_AUTH_REQUIRED"
    );
    assert_eq!(
        state
            .query_batch(query("product.write", Json::Null, 1), alice())
            .unwrap_err()
            .code,
        "E_OFFLINE_RESUME"
    );
    assert_eq!(
        state
            .replay_batch(json!({"batch": []}), alice())
            .unwrap_err()
            .code,
        "E_INPUT"
    );
    drop_state(state);
}

#[test]
fn replay_batch_preserves_prefix_terminals_and_retries_after_a_successor() {
    let mut state = fixture(2, 1);
    let full = state
        .query_batch(query("events.log", Json::Null, 16), alice())
        .unwrap();
    let events = full["pages"][0]["envelope"]["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["id"].clone())
        .collect::<Vec<_>>();
    let grant = state.mint_replay_grant("dev:alice").unwrap();
    let first = replay(&grant, 0, vec![events[0].clone()]);
    let mut product = replay(&grant, 1, vec![]);
    product["op"] = json!("product.write");
    product["args"] = json!({});
    let last = replay(&grant, 2, vec![events[1].clone()]);
    let stopped = state
        .replay_batch_with(
            json!({"batch": [first, product, last]}),
            alice(),
            unrestricted("results"),
        )
        .unwrap();
    assert_eq!(stopped["results"].as_array().unwrap().len(), 1);
    assert_eq!(stopped["results"][0]["state"], "committed");
    assert!(
        !stopped["results"][0]["effects"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(stopped["error"]["code"], "E_INPUT");
    assert_eq!(stopped["more"], false);
    assert!(
        state
            .runtime()
            .store()
            .stored_client_intent("dev:alice", last["replay"]["intent"].as_str().unwrap())
            .unwrap()
            .is_none()
    );
    let seq = state.runtime().store().commit_seq().unwrap();
    let mut successor = project();
    successor
        .programs
        .retain(|op| op.name != "_delivery.events.ack");
    successor
        .schema
        .tables
        .get_mut("messages")
        .unwrap()
        .deliver
        .as_mut()
        .unwrap()
        .receipts = false;
    successor.schema.tables.remove("eventsReceipts");
    let next = Generation::certify(&successor, Ceilings::default()).unwrap();
    let refusal = state
        .runtime_mut()
        .apply_successor(next.clone())
        .unwrap_err();
    assert_eq!(refusal.code, "E_SUCCESSOR_DESTRUCTIVE");
    state
        .runtime_mut()
        .apply_migration(next, &refusal.plan, 0)
        .unwrap();
    let after_successor = state.runtime().store().commit_seq().unwrap();
    assert!(after_successor >= seq);
    let retried = state
        .replay_batch(json!({"batch": [first, last]}), alice())
        .unwrap();
    assert_eq!(retried["results"], stopped["results"]);
    assert_eq!(retried["error"]["code"], "E_OP_UNKNOWN");
    assert_eq!(
        state.runtime().store().commit_seq().unwrap(),
        after_successor
    );
    assert_eq!(
        state
            .replay_batch(json!({"batch": [first]}), Identity::Anonymous)
            .unwrap_err()
            .code,
        "E_AUTH_REQUIRED"
    );
    drop_state(state);
}

#[test]
fn replay_batch_uses_live_membership_and_includes_oversized_final_terminals() {
    let mut state = fixture(2, 1);
    let full = state
        .query_batch(query("events.log", Json::Null, 16), alice())
        .unwrap();
    let events = full["pages"][0]["envelope"]["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["id"].clone())
        .collect::<Vec<_>>();
    let grant = state.mint_replay_grant("dev:alice").unwrap();
    let entries = [
        replay(&grant, 0, vec![events[0].clone()]),
        replay(&grant, 1, vec![events[1].clone()]),
    ];
    let mut bytes = unrestricted("results");
    bytes.max_bytes = 1;
    let first = state
        .replay_batch_with(json!({"batch": entries}), alice(), bytes)
        .unwrap();
    assert_eq!(first["results"].as_array().unwrap().len(), 1);
    assert_eq!(first["more"], true);
    assert_eq!(first["results"][0]["state"], "committed");
    let removed = state
        .execute(
            "members.remove",
            json!({}),
            alice(),
            Some(ProgramKind::Mutation),
            OfflineOptions::default(),
            None,
        )
        .unwrap();
    assert_eq!(removed["state"], "committed");
    let seq = state.runtime().store().commit_seq().unwrap();
    let second = state
        .replay_batch(json!({"batch": [entries[1]]}), alice())
        .unwrap();
    assert_eq!(second["results"][0]["state"], "rejected", "{second}");
    assert_eq!(second["results"][0]["code"], "E_RULE");
    assert!(second["results"][0].get("effects").is_none());
    assert_eq!(state.runtime().store().commit_seq().unwrap(), seq);
    assert_eq!(state.replay_batch(json!({"batch": [entries[1]]}), alice()).unwrap(), second,
        "the departed member's refusal is a stable terminal, not a fresh execution");
    let oracle = Program {
        name: "oracle".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(snapback2_core::Read {
            site: "oracle".into(),
            table: "eventsReceipts".into(),
            index: "byId".into(),
            key: vec![Expr::Literal(Value::Id(events[1].as_str().unwrap().into()))],
            provenance: KeyProvenance::Const,
        }))],
    };
    let receipt = state
        .runtime_mut()
        .read_operator(
            &oracle,
            BTreeMap::new(),
            snapback2_core::OperatorId("test".into()),
            0,
        )
        .unwrap();
    assert_eq!(
        receipt.result.field("received").unwrap(),
        &Value::Bool(false),
        "a departed member must stay unreceived"
    );
    assert_eq!(second["more"], false);
    let again = state
        .replay_batch(json!({"batch": [entries[0], entries[1]]}), alice())
        .unwrap();
    assert_eq!(again["results"][0], first["results"][0]);
    if again["results"].as_array().unwrap().len() == 2 {
        assert_eq!(again["results"][1], second["results"][0]);
    }
    drop_state(state);
}

#[test]
fn replay_batch_defers_an_error_that_cannot_fit_beside_its_terminal_prefix() {
    let mut state = fixture(1, 1);
    let grant = state.mint_replay_grant("dev:alice").unwrap();
    let first = replay(&grant, 0, vec![]);
    let committed = state
        .replay_batch(json!({"batch": [first]}), alice())
        .unwrap();
    let mut product = replay(&grant, 1, vec![]);
    product["op"] = json!("product.write");
    product["args"] = json!({});
    let mut bound = unrestricted("results");
    bound.max_bytes = encoded_length(&committed) + 1;
    let prefix = state
        .replay_batch_with(json!({"batch": [first, product]}), alice(), bound)
        .unwrap();
    assert_eq!(prefix["results"], committed["results"]);
    assert_eq!(prefix["more"], true);
    assert!(prefix.get("error").is_none());
    let failure = state
        .replay_batch(json!({"batch": [product]}), alice())
        .unwrap();
    assert_eq!(failure["results"], json!([]));
    assert_eq!(failure["more"], false);
    assert_eq!(failure["error"]["code"], "E_INPUT");
    let mut tiny = unrestricted("results");
    tiny.max_bytes = 1;
    assert_eq!(
        state
            .replay_batch_with(json!({"batch": [product]}), alice(), tiny)
            .unwrap_err()
            .code,
        "E_INPUT"
    );
    assert!(
        state
            .runtime()
            .store()
            .stored_client_intent("dev:alice", product["replay"]["intent"].as_str().unwrap())
            .unwrap()
            .is_none()
    );
    drop_state(state);
}

#[test]
fn owner_queue_runs_foreground_and_revocation_at_each_batch_boundary() {
    for replaying in [false, true] {
        let mut state = fixture(101, 1);
        let now = state.now();
        let session = state.runtime_mut().persona("alice", now).unwrap();
        let identity = Identity::Bearer(session.token.clone());
        let grant = state.mint_replay_grant("dev:alice").unwrap();
        let full = state
            .query_batch(query("events.log", Json::Null, 1), alice())
            .unwrap();
        let event_ids = full["pages"][0]["envelope"]["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["id"].clone())
            .collect::<Vec<_>>();
        let entries = [
            replay(&grant, 0, vec![event_ids[0].clone()]),
            replay(&grant, 1, vec![event_ids[1].clone()]),
        ];
        let continuation = replay(&grant, 2, vec![event_ids[2].clone()]);
        let action = |body| {
            if replaying {
                Action::ReplayBatch {
                    body,
                    identity: identity.clone(),
                }
            } else {
                Action::QueryBatch {
                    body,
                    identity: identity.clone(),
                }
            }
        };
        let first_body = if replaying {
            json!({"batch": entries})
        } else {
            query("events.log", Json::Null, 2)
        };
        let next_body = if replaying {
            json!({"batch": [continuation]})
        } else {
            query(
                "events.log",
                full["pages"][0]["envelope"]["next"].clone(),
                16,
            )
        };
        let actions = [
            action(first_body),
            Action::Execute {
                op: "product.write".into(),
                args: json!({}),
                identity: alice(),
                expected: Some(ProgramKind::Mutation),
                expected_generation: None,
                offline: OfflineOptions::default(),
                replay: None,
            },
            Action::Logout {
                token: session.token.clone(),
            },
            action(next_body),
            Action::FinishStop,
        ];
        let (requests, receiver) = mpsc::channel();
        let (replies, responses) = mpsc::channel();
        // Keep foreground/revocation work pending throughout the active batch.
        // A shared reply channel observes actual dispatcher order, rather than
        // sequential direct method calls or a copy of the driver's turn limit.
        for action in actions {
            requests
                .send(Request {
                    action,
                    reply: replies.clone(),
                })
                .unwrap();
        }
        drop(requests);
        drop(replies);
        let worker = std::thread::spawn(move || {
            super::super::writer_jobs::drive(&mut state, receiver);
            state
        });
        let mut received = Vec::new();
        for _ in 0..5 {
            received.push(responses.recv_timeout(Duration::from_secs(5)).unwrap());
        }
        let state = worker.join().unwrap();
        let prefix = received[0].as_ref().unwrap();
        let foreground = received[1].as_ref().unwrap();
        assert_eq!(foreground["state"], "committed");
        let foreground_seq = foreground["seq"].as_u64().unwrap();
        if replaying {
            let terminals = prefix["results"].as_array().unwrap();
            assert!(!terminals.is_empty());
            for (index, terminal) in terminals.iter().enumerate() {
                assert_eq!(terminal["state"], "committed");
                assert!(!terminal["effects"].as_array().unwrap().is_empty());
                assert!(terminal["seq"].as_u64().unwrap() < foreground_seq);
                let stored = state
                    .runtime()
                    .store()
                    .stored_client_intent(
                        "dev:alice",
                        entries[index]["replay"]["intent"].as_str().unwrap(),
                    )
                    .unwrap()
                    .unwrap();
                assert_eq!(stored.response, *terminal);
            }
            assert_eq!(prefix["more"], terminals.len() < entries.len());
            assert!(
                state
                    .runtime()
                    .store()
                    .stored_client_intent(
                        "dev:alice",
                        continuation["replay"]["intent"].as_str().unwrap(),
                    )
                    .unwrap()
                    .is_none()
            );
        } else {
            let pages = prefix["pages"].as_array().unwrap();
            assert!(!pages.is_empty());
            assert_eq!(
                prefix["more"], true,
                "foreground must run before acquisition finishes"
            );
            let seq = pages[0]["envelope"]["seq"].as_u64().unwrap();
            assert!(seq < foreground_seq);
            for page in pages {
                assert_eq!(
                    page["envelope"]["seq"], seq,
                    "no queued write runs inside the batch"
                );
            }
        }
        assert_eq!(received[2].as_ref().unwrap(), &json!({"ok": true}));
        assert_eq!(received[3].as_ref().unwrap_err().code, "E_AUTH_SESSION");
        assert_eq!(received[4].as_ref().unwrap(), &json!({"ok": true}));
        assert_eq!(
            state.runtime().store().commit_seq().unwrap(),
            foreground_seq
        );
        assert!(
            state
                .runtime()
                .authenticate(&session.token, state.now())
                .is_err()
        );
        drop_state(state);
    }
}
