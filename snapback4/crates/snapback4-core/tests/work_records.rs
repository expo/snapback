#![cfg(feature = "sqlite")]

use snapback4_core::{Context, Engine, Schema, Store, Value, WriteState, identity};
use snapback4_core::ir::{ArgType, Expr, Program, ProgramKind, Stmt};
use serde_json::json;
use std::collections::BTreeMap;

fn program(name: &str) -> Program {
    Program { name: name.into(), kind: ProgramKind::Mutation, args: BTreeMap::from([("n".into(), ArgType::Int)]),
        read_time_granularity_ms: None, native: false, body: vec![Stmt::Return(Expr::Variable("n".into()))] }
}
fn context(n: i64) -> Context { Context::new("member:alice", BTreeMap::from([("n".into(), Value::Int(n))])).at(10) }

#[test]
fn mutation_ids_bind_wire_arguments_and_the_original_name() {
    let mut engine = Engine::memory(Schema::default(), [program("answer"), program("another")]).unwrap();
    let first = engine.mutate("answer", Some("id"), context(1)).unwrap();
    assert!(matches!(first.state, WriteState::Sent { .. }));
    assert!(engine.mutate("answer", Some("id"), context(1)).unwrap().replayed);
    for (name, n) in [("answer", 2), ("another", 1)] {
        let error = engine.mutate(name, Some("id"), context(n)).unwrap_err().refusal();
        assert_eq!((error.code.as_str(), error.family.as_str()), ("E_ID_REUSED", "input"));
    }
    // The receipt does not regain historical result authority.
    let replay = engine.replay_mutation("member:alice", "id", "answer", &json!({"n": 1})).unwrap().unwrap();
    assert!(replay.reply(Some("id")).get("result").is_none());
    assert!(engine.replay_mutation("member:bob", "id", "answer", &json!({"n": 2})).unwrap().is_none());
    engine.adopt(Schema::default(), [program("renamed")]).unwrap();
    assert!(engine.replay_mutation("member:alice", "id", "answer", &json!({"n": 1})).unwrap().is_some());
    assert_eq!(engine.replay_mutation("member:alice", "id", "renamed", &json!({"n": 1})).unwrap_err().code(), "E_ID_REUSED");
}

#[test]
fn payload_digests_sort_nested_keys_and_keep_array_order() {
    use snapback4_core::store::payload_digest;
    let a = serde_json::from_str(r#"{"a":{"x":1,"y":2},"b":[1,2]}"#).unwrap();
    let b = serde_json::from_str(r#"{"b":[1,2],"a":{"y":2,"x":1}}"#).unwrap();
    assert_eq!(payload_digest(&a), payload_digest(&b));
    assert_ne!(payload_digest(&a), payload_digest(&json!({"a":{"x":1,"y":2},"b":[2,1]})));
}

#[test]
fn a_pre_binding_store_opens_legacy_receipts_replay_and_sessions_refresh() {
    use sha2::{Digest, Sha256};
    let path = std::env::temp_dir().join(format!("sb4-legacy-work-{}-{}", std::process::id(), snapback4_core::ids::mint(snapback4_core::now_ms(), &mut 0).unwrap()));
    std::fs::create_dir_all(&path).unwrap();
    let file = path.join("store.sqlite");
    let conn = rusqlite::Connection::open(&file).unwrap();
    conn.execute_batch("CREATE TABLE _ops (principal TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, outcome TEXT NOT NULL, PRIMARY KEY(principal, id)) WITHOUT ROWID;
        CREATE TABLE _sessions (token_digest TEXT PRIMARY KEY, principal TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
        CREATE TABLE _requests (id TEXT PRIMARY KEY, name TEXT NOT NULL, args TEXT NOT NULL, principal TEXT NOT NULL, at INTEGER NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER, lease_until INTEGER, claimed_by TEXT, session_digest TEXT, result TEXT, error TEXT);
        INSERT INTO _ops VALUES ('member:alice', 'old-op', 7, '{\"state\":\"sent\",\"seq\":7,\"id\":\"old-op\"}');
        INSERT INTO _requests(id, name, args, principal, at, state, result) VALUES ('old-action', 'old', '{}', 'member:alice', 0, 'done', '42');").unwrap();
    let digest = format!("{:x}", Sha256::digest(b"old-token"));
    conn.execute("INSERT INTO _sessions VALUES (?1, 'member:alice', 'member', 0, 86400000)", [&digest]).unwrap();
    drop(conn);
    let mut engine = Engine::new(Store::open(&file).unwrap(), Schema::default(), [program("answer")]).unwrap();
    assert!(engine.mutate("no-longer-declared", Some("old-op"), context(999)).unwrap().replayed);
    assert_eq!(engine.action_request_at("old-action", "member:alice", i64::MAX).unwrap().result, Some(json!(42)));
    assert!(engine.replay_action("old-action", "member:alice", "old", &json!({"ignored": true}), i64::MAX).unwrap().is_some());
    assert_eq!(engine.replay_action("old-action", "member:alice", "other", &json!({}), 1).unwrap_err().code(), "E_ACTION_UNKNOWN");
    let rotated = identity::rotate_session(engine.store(), "old-token", 1).unwrap().unwrap();
    let family: String = engine.store().conn().query_row("SELECT family FROM _sessions WHERE principal = 'member:alice'", [], |row| row.get(0)).unwrap();
    assert_eq!(family, digest, "a legacy session is its own family");
    assert!(identity::resolve(engine.store(), &rotated.token, 2).unwrap().is_some());
    drop(engine);
    assert!(Engine::open(Store::open(&file).unwrap()).is_ok());
    std::fs::remove_dir_all(path).unwrap();
}

fn action() -> Program {
    Program { name: "nullable".into(), kind: ProgramKind::Action,
        args: BTreeMap::from([("required".into(), ArgType::Scalar), ("optional".into(), ArgType::Optional(Box::new(ArgType::Int)))]),
        read_time_granularity_ms: None, native: false,
        body: vec![Stmt::Require { condition: Expr::Literal(Value::Bool(true)), code: "E_RULE".into(), site: None }] }
}

#[test]
fn action_replay_binds_raw_arguments_before_defaults_and_across_declarations() {
    let mut engine = Engine::memory(Schema::default(), [action()]).unwrap();
    for (id, raw) in [("omitted", json!({"required":null})), ("explicit", json!({"required":null,"optional":null}))] {
        let args = raw.as_object().unwrap().keys().map(|key| (key.clone(), Value::Null)).collect();
        let context = Context::new("member:alice", args).with_wire_args(raw.clone());
        let (run, replayed) = engine.request_action("nullable", id, context.clone()).unwrap();
        assert!(!replayed);
        assert_eq!(run.args.get("optional"), Some(&Value::Null), "the worker receives validated defaults");
        assert_eq!(run.args_digest, Some(snapback4_core::store::payload_digest(&raw)));
        assert!(engine.request_action("nullable", id, context).unwrap().1);
        assert!(engine.replay_action(id, "member:alice", "nullable", &raw, 1).unwrap().is_some());
    }
    assert_eq!(engine.replay_action("omitted", "member:alice", "nullable", &json!({"required":null,"optional":null}), 1).unwrap_err().code(), "E_ID_REUSED");
    let mut successor = action();
    successor.args.insert("required".into(), ArgType::Optional(Box::new(ArgType::Scalar)));
    successor.args.insert("later".into(), ArgType::Optional(Box::new(ArgType::Int)));
    engine.adopt(Schema::default(), [successor]).unwrap();
    assert!(engine.replay_action("omitted", "member:alice", "nullable", &json!({"required":null}), 1).unwrap().is_some());
    assert!(engine.replay_action("explicit", "member:alice", "nullable", &json!({"required":null,"optional":null}), 1).unwrap().is_some());
    assert_eq!(engine.replay_action("explicit", "member:alice", "nullable", &json!({}), 1).unwrap_err().code(), "E_ID_REUSED");
}

#[test]
fn op_records_keep_only_binding_metadata_and_sizes_count_all_remaining_fields() {
    let mut engine = Engine::memory(Schema::default(), [program("answer")]).unwrap();
    engine.mutate("answer", Some("id"), context(987654)).unwrap();
    let conn = engine.store().conn();
    let columns: Vec<String> = conn.prepare("SELECT name FROM pragma_table_info('_ops')").unwrap().query_map([], |row| row.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(columns, ["principal", "id", "seq", "outcome", "name", "args_digest", "at"]);
    let (receipt, digest): (String, String) = conn.query_row("SELECT outcome, args_digest FROM _ops", [], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
    assert!(!receipt.contains("987654"));
    assert!(!receipt.contains("result"));
    assert_eq!(digest, snapback4_core::store::payload_digest(&json!({"n":987654})));
    let expected = "member:alice".len() + "id".len() + "1".len() + receipt.len() + "answer".len() + digest.len() + "10".len();
    assert_eq!(engine.store().sizes().unwrap().ops, expected as u64);
    conn.execute("INSERT INTO _ops(principal, id, seq, outcome) VALUES ('legacy', 'old', 0, '{}')", []).unwrap();
    assert_eq!(engine.store().sizes().unwrap().ops, (expected + 6 + 3 + 1 + 2) as u64, "nullable legacy bindings still count");
}

#[test]
fn action_lease_floor_is_one_second_but_family_expiry_can_be_sooner() {
    for remaining in [10_000, 100] {
        let mut engine = Engine::memory(Schema::default(), [action()]).unwrap();
        let session = identity::custom_session(engine.store(), "member:alice", "member", 0, 1).unwrap();
        let now = session.expires_at - remaining;
        engine.request_action("nullable", "id", Context::new(&session.principal, BTreeMap::from([("required".into(), Value::Null)])).with_session(&session.token).at(now)).unwrap();
        let claim = engine.claim_actions("service:worker", None, 1, 1, 60, now).unwrap().remove(0);
        assert_eq!(claim.session.expires_at, now + remaining.min(1_000));
        assert_eq!(claim.request.lease_until, Some(claim.session.expires_at));
    }
}
