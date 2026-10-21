#![cfg(feature = "sqlite")]
use snapback4_core::{Context, Engine, Schema, schema::{Schedule, RouteSpec, WorkSpec, routes::RouteRequest}};
use std::collections::BTreeMap;
use sha2::{Digest, Sha256};

fn engine() -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), "use server\naction work() <- allow\neffect mail\nmutation send():\n  emit mail { n: 1 }\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn context(at: i64) -> Context { Context::new("dev:alice", BTreeMap::new()).at(at) }

#[test]
fn nul_mutation_id_and_viewer_are_refused_before_writes_or_clock_advance() {
    let source = "table releases:\n  opensAt: time\n  by byOpening: opensAt\n  not before .opensAt\n  public\n  online only\nmutation ping():\n  return 1\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut e = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let changes = (match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes();
    for (viewer, id, code) in [("dev:alice", Some("op\0id"), "E_INPUT"), ("dev:bad\0viewer", Some("op"), "E_AUTH"), ("dev:bad\0viewer", None, "E_AUTH")] {
        let ctx = Context::new(viewer, BTreeMap::new()).at(1_000);
        assert_eq!(e.mutate("ping", id, ctx).unwrap_err().code(), code);
        assert_eq!((match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes(), changes, "refusal must precede the timed-schema clock pin too");
    }
    for table in ["_ops", "_commits"] {
        assert_eq!((match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }
}

#[test]
fn nul_asset_intent_owner_and_id_are_refused_before_writes() {
    let mut e = engine();
    let placement = serde_json::json!({"op":"send", "args":{}, "argument":"file"});
    let why = snapback4_core::error::Refusal::new("E_INPUT", "input", "invalid argument");
    let changes = (match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes();
    for (owner, id, code) in [("dev:alice", "intent\0id", "E_INPUT"), ("dev:bad\0owner", "intent", "E_AUTH")] {
        assert_eq!(e.declare_asset_intent(owner, id, "fingerprint", &placement).unwrap_err().code(), code);
        assert_eq!(e.finish_asset_intent(owner, id, "send", &serde_json::json!({}), &why).unwrap_err().code(), code);
        assert_eq!((match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes(), changes);
    }
}

#[test]
fn nul_action_invocation_is_refused_before_any_write() {
    let mut e = engine();
    let changes = (match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes();
    assert_eq!(e.request_action("work", "inv\0ocation", context(1)).unwrap_err().code(), "E_INPUT");
    assert_eq!((match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes(), changes);
    assert!(e.action_counts().unwrap().is_empty());
}

#[test]
fn nul_dev_route_viewer_is_refused_before_any_write() {
    let route = RouteSpec { path: "/hooks/test".into(), service: None, work: WorkSpec::default(), wait_ms: 5_000 };
    let mut schema = Schema::default();
    schema.routes.insert("test".into(), route.clone());
    let mut e = Engine::memory(schema, []).unwrap();
    let envelope = RouteRequest { method: "POST".into(), path: route.path.clone(), headers: vec![], body_hex: String::new() };
    let changes = (match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes();
    let ctx = Context::new("dev:bad\0principal", BTreeMap::new()).at(1);
    assert_eq!(e.request_session_route("test", &route.contract("test"), &envelope, ctx).unwrap_err().code(), "E_AUTH");
    assert_eq!((match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes(), changes);
    assert!(e.action_counts().unwrap().is_empty());
}

#[test]
fn nul_action_worker_is_refused_before_expiry_or_claim() {
    let mut e = engine();
    e.request_action("work", "expired", context(0)).unwrap();
    let lease = e.claim_actions("service:worker", None, 1, 1_000, 1, 0).unwrap().remove(0).session.token;
    e.request_action("work", "queued", context(1)).unwrap();
    let changes = (match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes();
    assert_eq!(e.claim_actions("service:bad\0worker", None, 10, 1_000, 1, 2_000).unwrap_err().code(), "E_AUTH");
    assert_eq!((match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes(), changes);
    assert_eq!(e.action_counts().unwrap(), BTreeMap::from([("queued".into(), 1), ("running".into(), 1)]));
    let delegated: i64 = (match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().query_row("SELECT count(*) FROM _sessions WHERE token_digest = ?1", [format!("{:x}", Sha256::digest(lease.as_bytes()))], |r| r.get(0)).unwrap();
    assert_eq!(delegated, 1, "refusal must precede expired-lease cleanup");
}

#[test]
fn nul_effect_worker_is_refused_before_expiry_or_claim() {
    let mut e = engine();
    for id in ["one", "two"] { e.mutate("send", Some(id), context(0)).unwrap(); }
    e.claim_effects_fenced("service:worker", None, 1, 1_000, 0).unwrap();
    let changes = (match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes();
    for fenced in [false, true] {
        let result = if fenced { e.claim_effects_fenced("service:bad\0worker", None, 10, 1_000, 2_000) }
            else { e.claim_effects("service:bad\0worker", None, 10, 1_000, 2_000) };
        assert_eq!(result.unwrap_err().code(), "E_AUTH");
    }
    assert_eq!((match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes(), changes);
    let states: String = (match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().query_row("SELECT group_concat(state, ',') FROM (SELECT state FROM _outbox ORDER BY state)", [], |r| r.get(0)).unwrap();
    assert_eq!(states, "queued,running");
}

#[test]
fn direct_effect_claims_keep_unbounded_nul_free_worker_labels() {
    let mut e = engine();
    let worker = "w".repeat(136);
    for fenced in [false, true] {
        e.mutate("send", Some(if fenced { "fenced" } else { "plain" }), context(0)).unwrap();
        let claims = if fenced { e.claim_effects_fenced(&worker, None, 1, 1_000, 0) }
            else { e.claim_effects(&worker, None, 1, 1_000, 0) }.unwrap();
        assert_eq!(claims.len(), 1);
        let stored: String = (match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().query_row("SELECT claimed_by FROM _outbox WHERE id=?1", [&claims[0].id], |r| r.get(0)).unwrap();
        assert_eq!(stored, worker);
    }
}

#[test]
fn legacy_nul_step_names_complete_park_and_reconcile_but_new_names_refuse() {
    let name = "send\0mail";
    for mode in ["complete", "park", "reconcile", "uncertain"] {
        let mut e = engine();
        e.request_action("work", "invocation", context(0)).unwrap();
        let first = e.claim_actions("service:worker", None, 1, 1_000, 1, 0).unwrap().remove(0).session.token;
        assert_eq!(e.begin_action_step("invocation", "service:worker", &first, name, &serde_json::json!({}), false, 1).unwrap_err().code(), "E_STEP_INPUT");
        assert_eq!((match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().query_row("SELECT count(*) FROM _action_steps", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        // Seed through the old, valid spelling, then preserve its binding and
        // provider key while installing the pre-upgrade SQLite name.
        let begun = e.begin_action_step("invocation", "service:worker", &first, "legacy", &serde_json::json!({}), false, 1).unwrap();
        (match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().execute("UPDATE _action_steps SET name=?1 WHERE invocation='invocation'", [name]).unwrap();
        match mode {
            "complete" => {
                let result = serde_json::json!({"receipt": 1});
                assert_eq!(e.complete_action_step("invocation", "service:worker", &first, name, &result, 2).unwrap().state, "done");
                let replay = e.begin_action_step("invocation", "service:worker", &first, name, &serde_json::json!({}), false, 3).unwrap();
                assert_eq!(replay.result, Some(result));
                assert_eq!(replay.key, begun.key);
            }
            "park" => e.park_action_step("invocation", "service:worker", &first, name, "uncertain", 2).unwrap(),
            _ => {
                let next = e.claim_actions("service:worker", None, 1, 1_000, 1, 1_002).unwrap().remove(0).session.token;
                let next_step = e.begin_action_step("invocation", "service:worker", &next, name, &serde_json::json!({}), mode == "reconcile", 1_003);
                if mode == "reconcile" {
                    let step = next_step.unwrap();
                    assert_eq!(step.state, "reconcile");
                    assert_eq!(step.key, begun.key);
                    e.complete_action_step("invocation", "service:worker", &next, name, &serde_json::json!({}), 1_004).unwrap();
                } else {
                    assert_eq!(next_step.unwrap_err().code(), "E_STEP_PARKED");
                }
            }
        }
        let state: String = (match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().query_row("SELECT state FROM _action_steps WHERE name=?1", [name], |r| r.get(0)).unwrap();
        assert_eq!(state, if ["park", "uncertain"].contains(&mode) { "parked" } else { "done" });
    }
}

#[test]
fn nul_scheduled_service_seat_is_refused_before_activation_writes() {
    let mut e = engine();
    let mut schema = e.schema().clone();
    schema.schedules.push(Schedule { name: "hourly".into(), every_ms: 60_000, offset_ms: 0,
        target: "work".into(), service: Some("service:bad\0seat".into()), months: 0 });
    let changes = (match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes();
    let programs = e.programs().cloned().collect::<Vec<_>>();
    assert_eq!(e.adopt_at(schema, programs, 0).unwrap_err().code(), "E_SCHEMA");
    assert_eq!((match &e.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).test_support_conn().total_changes(), changes);
}
