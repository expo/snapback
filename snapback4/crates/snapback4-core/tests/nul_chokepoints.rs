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
fn nul_action_invocation_is_refused_before_any_write() {
    let mut e = engine();
    let changes = e.store().conn().total_changes();
    assert_eq!(e.request_action("work", "inv\0ocation", context(1)).unwrap_err().code(), "E_INPUT");
    assert_eq!(e.store().conn().total_changes(), changes);
    assert!(e.action_counts().unwrap().is_empty());
}

#[test]
fn nul_dev_route_viewer_is_refused_before_any_write() {
    let route = RouteSpec { path: "/hooks/test".into(), service: None, work: WorkSpec::default(), wait_ms: 5_000 };
    let mut schema = Schema::default();
    schema.routes.insert("test".into(), route.clone());
    let mut e = Engine::memory(schema, []).unwrap();
    let envelope = RouteRequest { method: "POST".into(), path: route.path.clone(), headers: vec![], body_hex: String::new() };
    let changes = e.store().conn().total_changes();
    let ctx = Context::new("dev:bad\0principal", BTreeMap::new()).at(1);
    assert_eq!(e.request_session_route("test", &route.contract("test"), &envelope, ctx).unwrap_err().code(), "E_AUTH");
    assert_eq!(e.store().conn().total_changes(), changes);
    assert!(e.action_counts().unwrap().is_empty());
}

#[test]
fn nul_action_worker_is_refused_before_expiry_or_claim() {
    let mut e = engine();
    e.request_action("work", "expired", context(0)).unwrap();
    let lease = e.claim_actions("service:worker", None, 1, 1_000, 1, 0).unwrap().remove(0).session.token;
    e.request_action("work", "queued", context(1)).unwrap();
    let changes = e.store().conn().total_changes();
    assert_eq!(e.claim_actions("service:bad\0worker", None, 10, 1_000, 1, 2_000).unwrap_err().code(), "E_AUTH");
    assert_eq!(e.store().conn().total_changes(), changes);
    assert_eq!(e.action_counts().unwrap(), BTreeMap::from([("queued".into(), 1), ("running".into(), 1)]));
    let delegated: i64 = e.store().conn().query_row("SELECT count(*) FROM _sessions WHERE token_digest = ?1", [format!("{:x}", Sha256::digest(lease.as_bytes()))], |r| r.get(0)).unwrap();
    assert_eq!(delegated, 1, "refusal must precede expired-lease cleanup");
}

#[test]
fn nul_effect_worker_is_refused_before_expiry_or_claim() {
    let mut e = engine();
    for id in ["one", "two"] { e.mutate("send", Some(id), context(0)).unwrap(); }
    e.claim_effects_fenced("service:worker", None, 1, 1_000, 0).unwrap();
    let changes = e.store().conn().total_changes();
    for fenced in [false, true] {
        let result = if fenced { e.claim_effects_fenced("service:bad\0worker", None, 10, 1_000, 2_000) }
            else { e.claim_effects("service:bad\0worker", None, 10, 1_000, 2_000) };
        assert_eq!(result.unwrap_err().code(), "E_AUTH");
    }
    assert_eq!(e.store().conn().total_changes(), changes);
    let states: String = e.store().conn().query_row("SELECT group_concat(state, ',') FROM (SELECT state FROM _outbox ORDER BY state)", [], |r| r.get(0)).unwrap();
    assert_eq!(states, "queued,running");
}

#[test]
fn nul_scheduled_service_seat_is_refused_before_activation_writes() {
    let mut e = engine();
    let mut schema = e.schema().clone();
    schema.schedules.push(Schedule { name: "hourly".into(), every_ms: 60_000, offset_ms: 0,
        target: "work".into(), service: Some("service:bad\0seat".into()), months: 0 });
    let changes = e.store().conn().total_changes();
    let programs = e.programs().cloned().collect::<Vec<_>>();
    assert_eq!(e.adopt_at(schema, programs, 0).unwrap_err().code(), "E_SCHEMA");
    assert_eq!(e.store().conn().total_changes(), changes);
}
