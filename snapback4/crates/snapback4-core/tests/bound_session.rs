#![cfg(feature = "sqlite")]

use serde_json::json;
use sha2::{Digest, Sha256};
use snapback4_core::engine::actions::ActionSettled;
use snapback4_core::ir::{Expr, Program, ProgramKind, Stmt};
use snapback4_core::{Context, Engine, RuntimeError, Schema, Store, Value, identity};
use std::collections::BTreeMap;
use std::sync::{Arc, Barrier, OnceLock};
use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};

fn program() -> Program {
    Program { name: "work".into(), kind: ProgramKind::Action, args: BTreeMap::new(), read_time_granularity_ms: None, native: false, returned_shapes: Default::default(),
        body: vec![Stmt::Require { condition: Expr::Literal(Value::Bool(true)), code: "E_RULE".into(), site: None, message: None }] }
}
fn engine() -> Engine { Engine::memory(Schema::default(), [program()]).unwrap() }
fn admit(engine: &mut Engine, id: &str, at: i64) {
    engine.request_action("work", id, Context::new("dev:alice", BTreeMap::new()).at(at)).unwrap();
}
fn claim(engine: &mut Engine, at: i64) -> String {
    engine.claim_actions("service:worker", None, 1, 1_000, 1, at).unwrap().remove(0).session.token
}
fn binding(id: &str, replace: bool) -> identity::SessionMintBinding {
    identity::SessionMintBinding { invocation_id: id.into(), intent: identity::BOUND_SESSION_INTENT.into(), replace_lost_delivery: replace }
}
#[allow(clippy::too_many_arguments)]
fn mint(engine: &mut Engine, service: &identity::Session, lease: &str, id: &str, principal: &str, kind: &str, days: i64, now: i64, replace: bool) -> Result<identity::Session, RuntimeError> {
    identity::bound_custom_session(engine.store_mut(), &service.token, &service.principal, lease, principal, kind, || now, days, &binding(id, replace))
}
fn binding_count(engine: &Engine, id: &str) -> i64 {
    engine.store().conn().query_row("SELECT COUNT(*) FROM _session_mint_bindings WHERE invocation = ?1", [id], |row| row.get(0)).unwrap()
}
fn digest(token: &str) -> String { format!("{:x}", Sha256::digest(token.as_bytes())) }

static WRITER_BLOCKED: OnceLock<Barrier> = OnceLock::new();

fn witness_writer_blocked(attempt: i32) -> bool {
    if attempt == 0 {
        WRITER_BLOCKED.get_or_init(|| Barrier::new(2)).wait();
    }
    true
}

#[test]
fn initial_mint_replay_input_binding_and_family_recovery_are_exact() {
    let mut engine = engine();
    let service = identity::service_session(engine.store(), "worker", 0, 1).unwrap();
    admit(&mut engine, "mint", 0);
    let lease = claim(&mut engine, 0);
    assert_eq!(mint(&mut engine, &service, &lease, "", "member:alice", "member", 30, 1, false).unwrap_err().code(), "E_INPUT");
    let first = mint(&mut engine, &service, &lease, "mint", "member:alice", "member", 30, 1, false).unwrap();
    assert_eq!(binding_count(&engine, "mint"), 1);
    let binding_columns: Vec<String> = engine.store().conn().prepare("SELECT name FROM pragma_table_info('_session_mint_bindings')").unwrap()
        .query_map([], |row| row.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(binding_columns, ["invocation", "intent", "input_digest", "principal", "kind", "days", "expires_at", "family", "principal_generation", "scope"]);
    assert_eq!(engine.store().conn().query_row("SELECT scope FROM _session_mint_bindings", [], |row| row.get::<_, String>(0)).unwrap(), "full");
    let persisted: String = engine.store().conn().query_row("SELECT invocation || intent || input_digest || principal || kind || days || expires_at || family || principal_generation FROM _session_mint_bindings", [], |row| row.get(0)).unwrap();
    assert!(!persisted.contains(&first.token), "the binding never stores a raw session token");
    assert_eq!(mint(&mut engine, &service, &lease, "mint", "member:alice", "member", 30, 2, false).unwrap_err().code(), "E_INPUT");
    for (principal, kind, days) in [("member:bob", "member", 30), ("member:alice", "other", 30), ("member:alice", "member", 29)] {
        assert_eq!(mint(&mut engine, &service, &lease, "mint", principal, kind, days, 2, true).unwrap_err().code(), "E_INPUT");
        assert!(identity::resolve(engine.store(), &first.token, 2).unwrap().is_some());
    }

    admit(&mut engine, "separate", 2);
    let separate_lease = claim(&mut engine, 2);
    let separate = mint(&mut engine, &service, &separate_lease, "separate", "member:alice", "member", 30, 3, true).unwrap();
    assert_ne!(separate.token, first.token, "another invocation is a genuinely separate intent");

    for (id, days, clamped) in [("short-days", 0, 1), ("long-days", 3_651, 3_650)] {
        admit(&mut engine, id, 3);
        let days_lease = claim(&mut engine, 3);
        let session = mint(&mut engine, &service, &days_lease, id, &format!("member:{id}"), "member", days, 4, false).unwrap();
        assert_eq!(session.expires_at, 4 + clamped * 86_400_000, "bound integer days retain the legacy lifetime clamp");
    }

    let family: String = engine.store().conn().query_row("SELECT family FROM _sessions WHERE token_digest = ?1", [digest(&first.token)], |row| row.get(0)).unwrap();
    let refreshed = identity::rotate_session(engine.store(), &first.token, 4).unwrap().unwrap();
    let overlap = identity::custom_session(engine.store(), "member:alice", "member", 5, 30).unwrap();
    engine.store().conn().execute("UPDATE _sessions SET family = ?2 WHERE token_digest = ?1", rusqlite::params![digest(&overlap.token), family]).unwrap();
    let recovered = mint(&mut engine, &service, &lease, "mint", "member:alice", "member", 30, 6, true).unwrap();
    assert_eq!(recovered.expires_at, first.expires_at, "lost delivery cannot extend the original lifetime");
    for stale in [&first.token, &refreshed.token, &overlap.token] { assert!(identity::resolve(engine.store(), stale, 7).unwrap().is_none()); }
    assert!(identity::resolve(engine.store(), &recovered.token, 7).unwrap().is_some());
    assert_eq!(engine.store().conn().query_row("SELECT COUNT(*) FROM _sessions WHERE principal = 'member:alice' AND family = ?1", [&family], |row| row.get::<_, i64>(0)).unwrap(), 1);
}

#[test]
fn current_claim_worker_and_admitting_authority_gate_every_mint_or_recovery() {
    let mut engine = engine();
    let service = identity::service_session(engine.store(), "worker", 0, 1).unwrap();
    let other = identity::service_session(engine.store(), "other", 0, 1).unwrap();
    admit(&mut engine, "claim", 0);
    let first_lease = claim(&mut engine, 0);
    assert_eq!(mint(&mut engine, &service, "wrong", "claim", "member:claim", "member", 1, 1, true).unwrap_err().code(), "E_ACTION_LEASE");
    assert_eq!(binding_count(&engine, "claim"), 0, "a lost request before commit leaves no binding");
    assert_eq!(mint(&mut engine, &other, &first_lease, "claim", "member:claim", "member", 1, 1, true).unwrap_err().code(), "E_ACTION_LEASE");
    let initial = mint(&mut engine, &service, &first_lease, "claim", "member:claim", "member", 1, 1, true).unwrap();

    admit(&mut engine, "cross", 2);
    let cross_lease = claim(&mut engine, 2);
    assert_eq!(mint(&mut engine, &service, &cross_lease, "claim", "member:claim", "member", 1, 3, true).unwrap_err().code(), "E_ACTION_LEASE");
    let current_lease = engine.claim_actions("service:worker", Some("work"), 1, 1_000, 1, 1_001).unwrap().remove(0).session.token;
    assert_eq!(mint(&mut engine, &service, &first_lease, "claim", "member:claim", "member", 1, 1_002, true).unwrap_err().code(), "E_ACTION_LEASE");
    let recovered = mint(&mut engine, &service, &current_lease, "claim", "member:claim", "member", 1, 1_002, true).unwrap();
    assert_eq!(recovered.expires_at, initial.expires_at);
    engine.settle_action("claim", "service:worker", &current_lease, ActionSettled::Done(json!(null)), 1_003).unwrap();
    assert_eq!(mint(&mut engine, &service, &current_lease, "claim", "member:claim", "member", 1, 1_004, true).unwrap_err().code(), "E_ACTION_LEASE");

    let owner = identity::custom_session(engine.store(), "member:owner", "member", 2_000, 1).unwrap();
    engine.request_action("work", "revoked", Context::new(&owner.principal, BTreeMap::new()).with_session(&owner.token).at(2_000)).unwrap();
    let revoked_lease = claim(&mut engine, 2_000);
    identity::close_session(engine.store(), &owner.token).unwrap();
    assert_eq!(mint(&mut engine, &service, &revoked_lease, "revoked", "member:new", "member", 1, 2_001, false).unwrap_err().code(), "E_ACTION_LEASE");

    admit(&mut engine, "cancelled", 3_000);
    let cancelled_lease = claim(&mut engine, 3_000);
    engine.cancel_action("cancelled", "dev:alice", 3_001).unwrap();
    assert_eq!(mint(&mut engine, &service, &cancelled_lease, "cancelled", "member:new", "member", 1, 3_002, false).unwrap_err().code(), "E_ACTION_LEASE");

    let mut parked_engine = Engine::memory(Schema::default(), [program()]).unwrap();
    let parked_service = identity::service_session(parked_engine.store(), "worker", 4_000, 1).unwrap();
    admit(&mut parked_engine, "parked", 4_000);
    let first_parked_lease = claim(&mut parked_engine, 4_000);
    parked_engine.begin_action_step("parked", "service:worker", &first_parked_lease, "provider", &json!({"id":1}), false, 4_001).unwrap();
    let current_parked_lease = claim(&mut parked_engine, 5_001);
    assert_eq!(parked_engine.begin_action_step("parked", "service:worker", &current_parked_lease, "provider", &json!({"id":1}), false, 5_002).unwrap_err().code(), "E_STEP_PARKED");
    assert_eq!(parked_engine.action_request_at("parked", "dev:alice", 5_002).unwrap().state, "parked");
    assert_eq!(mint(&mut parked_engine, &parked_service, &current_parked_lease, "parked", "member:parked", "member", 1, 5_003, false).unwrap_err().code(), "E_ACTION_LEASE");
    assert_eq!(binding_count(&parked_engine, "parked"), 0, "the finish/live-authority gate refuses parked work before mint");
}

#[test]
fn family_tombstone_refuses_logout_revocation_generation_and_expiry() {
    for mode in ["logout", "revoke", "expired"] {
        let mut engine = engine();
        let service = identity::service_session(engine.store(), "worker", 0, 1).unwrap();
        admit(&mut engine, mode, 0);
        let lease = claim(&mut engine, 0);
        let target = mint(&mut engine, &service, &lease, mode, "member:target", "member", 1, 1, false).unwrap();
        match mode {
            "logout" => identity::close_session(engine.store(), &target.token).unwrap(),
            "revoke" => {
                identity::revoke_principal(engine.store(), "member:target").unwrap();
                let unrelated = identity::custom_session(engine.store(), "member:target", "member", 2, 1).unwrap();
                assert!(identity::resolve(engine.store(), &unrelated.token, 3).unwrap().is_some());
            }
            "expired" => {
                engine.store().conn().execute("UPDATE _sessions SET expires_at = 2 WHERE principal = 'member:target'", []).unwrap();
                engine.store().conn().execute("UPDATE _session_mint_bindings SET expires_at = 2 WHERE invocation = 'expired'", []).unwrap();
            }
            _ => unreachable!(),
        }
        assert_eq!(mint(&mut engine, &service, &lease, mode, "member:target", "member", 1, 3, true).unwrap_err().code(), "E_ACTION_AUTHORITY");
        assert_eq!(binding_count(&engine, mode), 1, "revocation keeps the binding tombstone");
        assert!(identity::resolve(engine.store(), &target.token, 3).unwrap().is_none());
        assert_eq!(engine.store().conn().query_row("SELECT COUNT(*) FROM _sessions WHERE principal = 'member:target'", [], |row| row.get::<_, i64>(0)).unwrap(), if mode == "revoke" { 1 } else { 0 });
    }

    for mode in ["service-logout", "service-revoke", "service-expiry"] {
        let mut engine = engine();
        let service = identity::service_session(engine.store(), "worker", 0, 1).unwrap();
        admit(&mut engine, mode, 0);
        let lease = claim(&mut engine, 0);
        match mode {
            "service-logout" => identity::close_session(engine.store(), &service.token).unwrap(),
            "service-revoke" => { identity::revoke_principal(engine.store(), "service:worker").unwrap(); }
            "service-expiry" => { engine.store().conn().execute("UPDATE _sessions SET expires_at = 2 WHERE token_digest = ?1", [digest(&service.token)]).unwrap(); }
            _ => unreachable!(),
        }
        assert_eq!(mint(&mut engine, &service, &lease, mode, "member:new", "member", 1, 3, false).unwrap_err().code(), "E_AUTH");
        assert_eq!(binding_count(&engine, mode), 0);
    }
}

#[test]
fn admitting_family_logout_all_and_expiry_cannot_be_replaced_by_a_fresh_sign_in() {
    for mode in ["admitting-logout", "admitting-all", "admitting-expiry"] {
        let mut engine = engine();
        let service = identity::service_session(engine.store(), "worker", 0, 1).unwrap();
        let owner = identity::custom_session(engine.store(), "member:owner", "member", 0, 1).unwrap();
        engine.request_action("work", mode, Context::new(&owner.principal, BTreeMap::new()).with_session(&owner.token).at(0)).unwrap();
        let lease = claim(&mut engine, 0);
        let now = match mode {
            "admitting-logout" => { identity::close_session(engine.store(), &owner.token).unwrap(); 1 }
            "admitting-all" => { identity::revoke_principal(engine.store(), &owner.principal).unwrap(); 1 }
            "admitting-expiry" => {
                engine.store().conn().execute("UPDATE _sessions SET expires_at = 2 WHERE token_digest = ?1", [digest(&owner.token)]).unwrap();
                engine.store().conn().execute("UPDATE _requests SET lease_until = 4 WHERE id = 'admitting-expiry'", []).unwrap();
                3
            }
            _ => unreachable!(),
        };
        let fresh = identity::custom_session(engine.store(), "member:owner", "member", now, 1).unwrap();
        assert!(identity::resolve(engine.store(), &fresh.token, now).unwrap().is_some());
        assert_eq!(mint(&mut engine, &service, &lease, mode, "member:new", "member", 1, now, false).unwrap_err().code(), "E_ACTION_LEASE");
        assert_eq!(binding_count(&engine, mode), 0);
    }
}

#[test]
fn a_cyclic_delegated_authority_chain_fails_closed() {
    let mut engine = engine();
    let owner = identity::custom_session(engine.store(), "member:cycle", "member", 0, 1).unwrap();
    engine.request_action("work", "cycle-parent", Context::new(&owner.principal, BTreeMap::new()).with_session(&owner.token).at(0)).unwrap();
    let parent = claim(&mut engine, 0);
    engine.request_action("work", "cycle-child", Context::new(&owner.principal, BTreeMap::new()).with_session(&parent).at(1)).unwrap();
    let child = claim(&mut engine, 1);

    // Corrupt the parent's admission edge to point back at the child. The
    // shared authority walk must retain the existing cycle refusal.
    engine.store().conn().execute(
        "UPDATE _requests SET family = ?2 WHERE id = ?1",
        rusqlite::params!["cycle-parent", digest(&child)],
    ).unwrap();
    assert!(identity::resolve(engine.store(), &child, 2).unwrap().is_none());
    let status = engine.action_status("cycle-child", "service:worker", &child, 2).unwrap();
    assert_eq!(status.error_code.as_deref(), Some("E_ACTION_AUTHORITY"));
}

#[test]
fn two_connections_recheck_service_revocation_and_serialize_replacements() {
    let root = std::env::temp_dir().join(format!("sb4-bound-session-{}-{}", std::process::id(), snapback4_core::ids::mint(snapback4_core::now_ms(), &mut 0).unwrap()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("store.sqlite");
    let mut engine = Engine::new(Store::open(&path).unwrap(), Schema::default(), [program()]).unwrap();
    let stale_service = identity::service_session(engine.store(), "worker", 0, 1).unwrap();
    admit(&mut engine, "race", 0);
    let lease = claim(&mut engine, 0);
    assert!(identity::resolve(engine.store(), &stale_service.token, 1).unwrap().is_some(), "the HTTP precheck can race");
    let second = Store::open(&path).unwrap();
    identity::close_session(&second, &stale_service.token).unwrap();
    assert_eq!(mint(&mut engine, &stale_service, &lease, "race", "member:race", "member", 1, 1, false).unwrap_err().code(), "E_AUTH");
    assert_eq!(binding_count(&engine, "race"), 0);

    let service = identity::service_session(engine.store(), "worker", 1, 1).unwrap();
    let initial = mint(&mut engine, &service, &lease, "race", "member:race", "member", 1, 2, false).unwrap();
    let gate = std::sync::Arc::new(std::sync::Barrier::new(3));
    let threads: Vec<_> = (0..2).map(|_| {
        let (path, service, lease, gate) = (path.clone(), service.clone(), lease.clone(), gate.clone());
        std::thread::spawn(move || {
            let mut store = Store::open(&path).unwrap();
            gate.wait();
            identity::bound_custom_session(&mut store, &service.token, &service.principal, &lease, "member:race", "member", || 3, 1, &binding("race", true)).unwrap()
        })
    }).collect();
    gate.wait();
    let replacements: Vec<_> = threads.into_iter().map(|thread| thread.join().unwrap()).collect();
    let check = Store::open(&path).unwrap();
    assert_eq!(replacements.iter().filter(|session| identity::resolve(&check, &session.token, 4).unwrap().is_some()).count(), 1);
    assert!(identity::resolve(&check, &initial.token, 4).unwrap().is_none());
    assert!(replacements.iter().all(|session| session.expires_at == initial.expires_at));
    let family: String = check.conn().query_row("SELECT family FROM _session_mint_bindings WHERE invocation = 'race'", [], |row| row.get(0)).unwrap();
    assert_eq!(check.conn().query_row("SELECT COUNT(*) FROM _sessions WHERE family = ?1", [&family], |row| row.get::<_, i64>(0)).unwrap(), 1);

    let gate = std::sync::Arc::new(std::sync::Barrier::new(3));
    let revoke = { let (path, gate) = (path.clone(), gate.clone()); std::thread::spawn(move || {
        let store = Store::open(&path).unwrap(); gate.wait(); identity::revoke_principal(&store, "member:race").unwrap();
    }) };
    let recover = { let (path, service, lease, gate) = (path.clone(), service.clone(), lease.clone(), gate.clone()); std::thread::spawn(move || {
        let mut store = Store::open(&path).unwrap(); gate.wait();
        identity::bound_custom_session(&mut store, &service.token, &service.principal, &lease, "member:race", "member", || 5, 1, &binding("race", true))
    }) };
    gate.wait();
    revoke.join().unwrap();
    if let Err(error) = recover.join().unwrap() { assert_eq!(error.code(), "E_ACTION_AUTHORITY"); }
    assert_eq!(check.conn().query_row("SELECT COUNT(*) FROM _sessions WHERE principal = 'member:race'", [], |row| row.get::<_, i64>(0)).unwrap(), 0,
        "revocation racing replacement must win finally without recreating the family");
    assert_eq!(check.conn().query_row("SELECT COUNT(*) FROM _session_mint_bindings WHERE invocation = 'race'", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
    drop(check); drop(second); drop(engine);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn committed_order_logout_and_lost_delivery_replacement_are_serialized() {
    let root = std::env::temp_dir().join(format!("sb4-bound-logout-{}-{}", std::process::id(), snapback4_core::ids::mint(snapback4_core::now_ms(), &mut 0).unwrap()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("store.sqlite");
    let mut engine = Engine::new(Store::open(&path).unwrap(), Schema::default(), [program()]).unwrap();
    let mut logout_store = Store::open(&path).unwrap();
    let service = identity::service_session(engine.store(), "worker", 0, 1).unwrap();

    admit(&mut engine, "logout-first", 0);
    let first_lease = claim(&mut engine, 0);
    let first = mint(&mut engine, &service, &first_lease, "logout-first", "member:logout-first", "member", 1, 1, false).unwrap();
    let first_family: String = engine.store().conn().query_row(
        "SELECT family FROM _session_mint_bindings WHERE invocation = 'logout-first'", [], |row| row.get(0)).unwrap();
    identity::logout_session(&mut logout_store, &first.token, || 2).unwrap();
    assert_eq!(mint(&mut engine, &service, &first_lease, "logout-first", "member:logout-first", "member", 1, 3, true).unwrap_err().code(), "E_ACTION_AUTHORITY");
    assert_eq!(engine.store().conn().query_row("SELECT COUNT(*) FROM _sessions WHERE family = ?1", [&first_family], |row| row.get::<_, i64>(0)).unwrap(), 0);
    assert_eq!(binding_count(&engine, "logout-first"), 1, "logout keeps the binding tombstone that prevents resurrection");

    admit(&mut engine, "replace-first", 4);
    let second_lease = claim(&mut engine, 4);
    let second = mint(&mut engine, &service, &second_lease, "replace-first", "member:replace-first", "member", 1, 5, false).unwrap();
    let second_family: String = engine.store().conn().query_row(
        "SELECT family FROM _session_mint_bindings WHERE invocation = 'replace-first'", [], |row| row.get(0)).unwrap();
    let replacement = mint(&mut engine, &service, &second_lease, "replace-first", "member:replace-first", "member", 1, 6, true).unwrap();
    assert_eq!(identity::logout_session(&mut logout_store, &second.token, || 7).unwrap_err().code(), "E_AUTH", "a stale delivered token cannot report logout success");
    assert!(identity::resolve(&logout_store, &replacement.token, 8).unwrap().is_some(), "stale-token logout must not close the replacement");
    assert_eq!(logout_store.conn().query_row("SELECT COUNT(*) FROM _sessions WHERE family = ?1", [&second_family], |row| row.get::<_, i64>(0)).unwrap(), 1);

    drop(logout_store); drop(engine);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn two_connection_writer_block_samples_authority_time_after_the_lock() {
    for mode in ["service-expiry", "claim-lease-expiry", "claim-deadline-expiry", "admitting-expiry"] {
        let root = std::env::temp_dir().join(format!("sb4-bound-clock-{mode}-{}-{}", std::process::id(), snapback4_core::ids::mint(snapback4_core::now_ms(), &mut 0).unwrap()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("store.sqlite");
        let mut engine = Engine::new(Store::open(&path).unwrap(), Schema::default(), [program()]).unwrap();
        let service = identity::service_session(engine.store(), "worker", 0, 1).unwrap();
        let admitting_token = if mode == "admitting-expiry" {
            let owner = identity::custom_session(engine.store(), "member:owner", "member", 0, 1).unwrap();
            engine.request_action("work", mode, Context::new(&owner.principal, BTreeMap::new()).with_session(&owner.token).at(0)).unwrap();
            Some(owner.token)
        } else {
            admit(&mut engine, mode, 0);
            None
        };
        let lease = claim(&mut engine, 0);
        match mode {
            "service-expiry" => { engine.store().conn().execute("UPDATE _sessions SET expires_at = 10 WHERE token_digest = ?1", [digest(&service.token)]).unwrap(); }
            "claim-lease-expiry" => { engine.store().conn().execute("UPDATE _requests SET lease_until = 10 WHERE id = ?1", [mode]).unwrap(); }
            "claim-deadline-expiry" => { engine.store().conn().execute("UPDATE _requests SET deadline = 10 WHERE id = ?1", [mode]).unwrap(); }
            "admitting-expiry" => { engine.store().conn().execute("UPDATE _sessions SET expires_at = 10 WHERE token_digest = ?1", [digest(admitting_token.as_deref().unwrap())]).unwrap(); }
            _ => unreachable!(),
        }

        let mut blocked = Store::open(&path).unwrap();
        blocked.conn().busy_handler(Some(witness_writer_blocked)).unwrap();
        let mut blocker = Store::open(&path).unwrap();
        let held_writer = blocker.transaction().unwrap();
        let clock = Arc::new(AtomicI64::new(9));
        let samples = Arc::new(AtomicUsize::new(0));
        let thread_clock = clock.clone();
        let thread_samples = samples.clone();
        let principal = format!("member:{mode}");
        let worker = service.principal.clone();
        let service_token = service.token.clone();
        let invocation = mode.to_owned();
        let handle = std::thread::spawn(move || identity::bound_custom_session(
            &mut blocked, &service_token, &worker, &lease, &principal, "member",
            || { thread_samples.fetch_add(1, Ordering::SeqCst); thread_clock.load(Ordering::SeqCst) },
            1, &binding(&invocation, false),
        ));

        WRITER_BLOCKED.get_or_init(|| Barrier::new(2)).wait();
        assert_eq!(samples.load(Ordering::SeqCst), 0, "{mode}: the clock must not be sampled while BEGIN IMMEDIATE is blocked");
        clock.store(11, Ordering::SeqCst);
        drop(held_writer);
        let error = handle.join().unwrap().unwrap_err();
        assert_eq!(samples.load(Ordering::SeqCst), 1, "{mode}: authority time is sampled exactly once");
        assert_eq!(error.code(), if mode == "service-expiry" { "E_AUTH" } else { "E_ACTION_LEASE" }, "{mode}: {error}");
        assert_eq!(engine.store().conn().query_row("SELECT COUNT(*) FROM _session_mint_bindings WHERE invocation = ?1", [mode], |row| row.get::<_, i64>(0)).unwrap(), 0, "{mode}: no stale-time binding");
        assert_eq!(engine.store().conn().query_row("SELECT COUNT(*) FROM _sessions WHERE principal = ?1", [&format!("member:{mode}")], |row| row.get::<_, i64>(0)).unwrap(), 0, "{mode}: no stale-time mint");
        drop(blocker); drop(engine);
        std::fs::remove_dir_all(root).unwrap();
    }

    let root = std::env::temp_dir().join(format!("sb4-logout-clock-{}-{}", std::process::id(), snapback4_core::ids::mint(snapback4_core::now_ms(), &mut 0).unwrap()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("store.sqlite");
    let store = Store::open(&path).unwrap();
    let session = identity::custom_session(&store, "member:logout-clock", "member", 0, 1).unwrap();
    store.conn().execute("UPDATE _sessions SET expires_at = 10 WHERE token_digest = ?1", [digest(&session.token)]).unwrap();
    let mut blocked = Store::open(&path).unwrap();
    blocked.conn().busy_handler(Some(witness_writer_blocked)).unwrap();
    let mut blocker = Store::open(&path).unwrap();
    let held_writer = blocker.transaction().unwrap();
    let clock = Arc::new(AtomicI64::new(9));
    let samples = Arc::new(AtomicUsize::new(0));
    let thread_clock = clock.clone();
    let thread_samples = samples.clone();
    let token = session.token.clone();
    let handle = std::thread::spawn(move || identity::logout_session(&mut blocked, &token, || {
        thread_samples.fetch_add(1, Ordering::SeqCst);
        thread_clock.load(Ordering::SeqCst)
    }));

    WRITER_BLOCKED.get_or_init(|| Barrier::new(2)).wait();
    assert_eq!(samples.load(Ordering::SeqCst), 0, "logout clock must not be sampled while BEGIN IMMEDIATE is blocked");
    clock.store(11, Ordering::SeqCst);
    drop(held_writer);
    assert_eq!(handle.join().unwrap().unwrap_err().code(), "E_AUTH", "an expired presented token cannot report logout success from stale pre-lock time");
    assert_eq!(samples.load(Ordering::SeqCst), 1, "logout authority time is sampled exactly once");
    assert_eq!(store.conn().query_row("SELECT COUNT(*) FROM _sessions WHERE token_digest = ?1", [digest(&session.token)], |row| row.get::<_, i64>(0)).unwrap(), 1, "the expired token was refused, not successfully logged out");
    drop(blocker); drop(store);
    std::fs::remove_dir_all(root).unwrap();
}
