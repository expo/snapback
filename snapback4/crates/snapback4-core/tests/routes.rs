#![cfg(feature = "sqlite")]
use snapback4_core::{Context, Engine, identity, schema::{self, RouteSpec, Schema, WorkSpec, routes::{BODY_BYTES, RouteRequest, RouteResponse}}, value::encode_bytes_hex};
use snapback4_core::engine::actions::ActionSettled;
use serde_json::json;
use std::collections::BTreeMap;

fn spec() -> RouteSpec { RouteSpec { path: "/hooks/billing".into(), service: Some("service:billing".into()), work: WorkSpec::default(), wait_ms: 5_000 } }
fn request(bytes: &[u8]) -> RouteRequest { RouteRequest { method: "POST".into(), path: spec().path, headers: vec![("X-Signature".into(), "signature".into())], body_hex: encode_bytes_hex(bytes) } }
fn response(bytes: &[u8]) -> RouteResponse { RouteResponse { status: 200, headers: vec![], body_hex: encode_bytes_hex(bytes), application_refusal: None } }

#[test]
fn route_schema_preserves_legacy_ir_and_refuses_ambiguous_or_reserved_paths() {
    let old = serde_json::json!({"tables": {}});
    let decoded: Schema = serde_json::from_value(old.clone()).unwrap();
    assert!(decoded.routes.is_empty());
    assert!(serde_json::to_value(decoded).unwrap().get("routes").is_none());
    for path in ["/", "hooks/billing", "/hooks/", "/hooks//billing", "/hooks/../billing", "/hooks/./billing", "/hooks/%62illing", "/hooks/a?b", "/hooks/a#b", "/hooks/a\\b", "/a/billing", "/dev/clock", "/routes/claim", "/auth", "/schema", "/assets/other"] {
        let mut route = spec(); route.path = path.into();
        assert!(route.validate().is_err(), "{path}");
    }
    let mut schema = Schema::default();
    schema.routes.insert("billing".into(), spec());
    assert!(schema::validate(&schema).is_empty());
    schema.routes.insert("other".into(), spec());
    assert!(schema::validate(&schema).iter().any(|issue| issue.message.contains("same POST path")));
    for service in ["system", "member:billing", "service:", "service:a/b", "service:a b"] {
        let mut route = spec(); route.service = Some(service.into());
        assert!(route.validate().is_err(), "{service}");
    }
    for wait in [0, 25_001] { let mut route = spec(); route.wait_ms = wait; assert!(route.validate().is_err()); }
}

#[test]
fn route_contract_covers_declaration_and_synthetic_action_cannot_be_publicly_admitted() {
    let route = spec();
    let program = route.program("billing");
    assert_eq!(program.name, "@route/billing");
    assert!(snapback4_core::engine::actions::authorize(&program, "service:billing").is_err());
    let contract = route.contract("billing");
    for changed in [RouteSpec { path: "/hooks/other".into(), ..route.clone() }, RouteSpec { service: None, ..route.clone() }, RouteSpec { wait_ms: 1_000, ..route.clone() }] {
        assert_ne!(contract, changed.contract("billing"));
    }
    let mut changed = route.clone(); changed.work.secrets.push("KEY".into());
    assert_ne!(contract, changed.contract("billing"));
    assert_ne!(contract, route.contract("other"));
}

#[test]
fn route_envelopes_preserve_non_utf8_bytes_and_apply_bounds_before_decoding() {
    let raw = b"\xff\x00{ \"a\" : 1 }\r\n";
    let envelope = request(raw);
    assert_eq!(envelope.validate(&spec()).unwrap(), raw);
    let wire = serde_json::to_value(&envelope).unwrap();
    assert_eq!(serde_json::from_value::<RouteRequest>(wire).unwrap(), envelope);
    let mut wrong = request(raw); wrong.method = "GET".into(); assert!(wrong.validate(&spec()).is_err());
    wrong = request(raw); wrong.path = "/hooks/other".into(); assert!(wrong.validate(&spec()).is_err());
    for hex in ["FF", "f", "0z"] { wrong = request(raw); wrong.body_hex = hex.into(); assert!(wrong.validate(&spec()).is_err()); }
    assert!(request(&vec![0; BODY_BYTES]).validate(&spec()).is_ok());
    assert!(request(&vec![0; BODY_BYTES + 1]).validate(&spec()).is_err());
    for headers in [vec![("Bad Name".into(), "a".into())], vec![("x".into(), "a\r\nb".into())], vec![("x".into(), "a".repeat(16 * 1024))], vec![("x".into(), "a".into()); 65]] {
        wrong = request(raw); wrong.headers = headers; assert!(wrong.validate(&spec()).is_err());
    }
}

#[test]
fn route_responses_are_bounded_and_refusal_acknowledgement_is_unambiguous() {
    let mut reply = response(b"\xff\0");
    reply.headers = vec![("set-cookie".into(), "a=1".into()), ("set-cookie".into(), "b=2".into())];
    assert_eq!(reply.validate().unwrap(), b"\xff\0");
    for status in [0, 101, 199, 600] { let mut wrong = reply.clone(); wrong.status = status; assert!(wrong.validate().is_err()); }
    for status in [204, 205, 304] { let mut wrong = reply.clone(); wrong.status = status; assert!(wrong.validate().is_err()); }
    for name in ["Connection", "Content-Length", "TRANSFER-ENCODING", "trailer", "upgrade"] {
        let mut wrong = response(b""); wrong.headers.push((name.into(), "x".into())); assert!(wrong.validate().is_err());
    }
    assert!(response(&vec![0; BODY_BYTES + 1]).validate().is_err());
    let mut refused = RouteResponse { status: 204, application_refusal: Some("redacted refusal".into()), ..response(b"") };
    assert!(refused.validate().is_ok());
    refused.status = 200; assert!(refused.validate().is_err());
    refused.status = 204; refused.headers.push(("content-type".into(), "text/plain".into())); assert!(refused.validate().is_err());
    let mut wire = serde_json::to_value(response(b"")).unwrap(); wire["extra"] = true.into();
    assert!(serde_json::from_value::<RouteResponse>(wire).is_err());
}

fn schema_with(route: RouteSpec) -> Schema { Schema { routes: BTreeMap::from([("billing".into(), route)]).into(), ..Schema::default() } }
fn engine() -> Engine { Engine::memory(schema_with(spec()), []).unwrap() }
fn verified(engine: &mut Engine, body: &[u8], at: i64) -> snapback4_core::engine::actions::ActionRequest {
    engine.request_verified_route("billing", &spec().contract("billing"), &request(body), 0, at).unwrap().0
}
fn claim(engine: &mut Engine, at: i64) -> snapback4_core::engine::actions::ActionClaim {
    engine.claim_actions("service:worker", Some("@route/billing"), 1, 1_000, 1, at).unwrap().remove(0)
}

#[test]
fn registry_claims_filter_names_and_preserve_group_lifetime_and_limit() {
    let mut schema = schema_with(spec());
    let other = RouteSpec { path: "/hooks/other".into(), ..spec() };
    schema.routes.insert("other".into(), other.clone());
    let mut engine = Engine::memory(schema, []).unwrap();
    let billing = verified(&mut engine, b"billing-first", 0);
    let envelope = RouteRequest { path: other.path.clone(), ..request(b"other") };
    let other_run = engine.request_verified_route("other", &other.contract("other"), &envelope, 0, 1).unwrap().0;
    let last = verified(&mut engine, b"billing-last", 2);
    for names in [vec![], vec!["".into()], vec!["@route/billing".into(); 129]] {
        assert_eq!(engine.claim_action_set("service:worker", &names, 10, 10_000, 10, 3).unwrap_err().code(), "E_INPUT");
    }
    assert!(engine.claim_action_set("dev:alice", &["@route/billing".into()], 1, 10_000, 10, 3).is_err());
    assert!(engine.claim_action_set("service:worker", &["unregistered".into()], 10, 10_000, 10, 3).unwrap().is_empty());
    let claims = engine.claim_action_set("service:worker", &["@route/other".into()], 10, 10_000, 2, 4).unwrap();
    assert_eq!(claims.len(), 1); assert_eq!(claims[0].request.id, other_run.id);
    assert_eq!(claims[0].session.expires_at, 2_004);
    let claims = engine.claim_action_set("service:worker", &["@route/billing".into(), "@route/other".into()], 1, 10_000, 5, 5).unwrap();
    assert_eq!(claims.len(), 1); assert_eq!(claims[0].request.id, billing.id);
    assert_eq!(claims[0].session.expires_at, 5_005);
    let legacy = engine.claim_actions("service:worker", None, 10, 10_000, 10, 6).unwrap();
    assert_eq!(legacy.len(), 1); assert_eq!(legacy[0].request.id, last.id);
}

#[test]
fn registry_claim_accepts_the_full_declared_route_name_with_its_private_prefix() {
    let name = "a".repeat(128);
    let schema = Schema { routes: BTreeMap::from([(name.clone(), spec())]).into(), ..Schema::default() };
    assert!(schema::validate(&schema).is_empty());
    let mut engine = Engine::memory(schema, []).unwrap();
    let admitted = engine.request_verified_route(&name, &spec().contract(&name), &request(b"long-name"), 0, 0).unwrap().0;
    let claims = engine.claim_action_set("service:worker", &[format!("@route/{name}")], 1, 1_000, 1, 1).unwrap();
    assert_eq!(claims.len(), 1); assert_eq!(claims[0].request.id, admitted.id);
}

#[test]
fn verified_retries_join_one_body_and_retain_the_first_authenticated_envelope() {
    let mut engine = engine();
    let contract = spec().contract("billing");
    let first = verified(&mut engine, b"event", 0);
    assert!(first.id.starts_with("route:v1:"));
    assert_eq!(first.principal, "service:billing");
    assert_eq!(first.service_generation, Some(0));
    let mut retry = request(b"event"); retry.headers[0].1 = "fresh-signature".into();
    let (joined, replayed) = engine.request_verified_route("billing", &contract, &retry, 0, 1).unwrap();
    assert!(replayed); assert_eq!(joined, first);
    assert_eq!(snapback4_core::wire::to_json(&joined.args["request"])["headers"][0][1], "signature");
    let held = claim(&mut engine, 2);
    assert_eq!(held.request.id, first.id);
    assert_eq!(identity::resolve(engine.store(), &held.session.token, 3).unwrap().unwrap().0, "service:billing");
    let result = serde_json::to_value(response(b"\xffreceipt")).unwrap();
    engine.settle_action(&first.id, "service:worker", &held.session.token, ActionSettled::Done(result.clone()), 4).unwrap();
    let done = engine.request_verified_route("billing", &contract, &retry, 0, 5).unwrap();
    assert!(done.1); assert_eq!(done.0.state, "done"); assert_eq!(done.0.result, Some(result));
    assert!(engine.claim_actions("service:worker", None, 1, 1_000, 1, 5).unwrap().is_empty());
    assert_ne!(verified(&mut engine, b"different-event", 6).id, first.id);
    // Deterministic IDs must not be preempted through ordinary action admission.
    assert_eq!(engine.request_action("anything", "route:v1:predictable", Context::new("dev:alice", BTreeMap::new()).at(0)).unwrap_err().code(), "E_INPUT");
    assert_eq!(engine.request_action("@route/billing", "ordinary-id", Context::new("service:billing", BTreeMap::new()).at(0)).unwrap_err().code(), "E_ACTION_UNKNOWN");
    assert!(engine.request_session_route("billing", &contract, &request(b"wrong-door"), Context::new("dev:alice", BTreeMap::new()).at(0)).is_err());
    assert_eq!(engine.replay_action(&first.id, "service:billing", "@route/billing", &serde_json::json!({"request": snapback4_core::wire::to_json(&first.args["request"])}), 6).unwrap_err().code(), "E_ACTION_UNKNOWN");
}

#[test]
fn route_work_does_not_retain_reusable_ingress_credentials() {
    let mut engine = engine();
    let mut envelope = request(b"event");
    for name in ["Authorization", "proxy-authorization", "COOKIE", "x-snapback-persona"] { envelope.headers.push((name.into(), "do-not-retain".into())); }
    let run = engine.request_verified_route("billing", &spec().contract("billing"), &envelope, 0, 0).unwrap().0;
    let recorded = snapback4_core::wire::to_json(&run.args["request"]);
    assert_eq!(recorded["headers"], json!([["X-Signature", "signature"]]));
    assert_eq!(recorded["bodyHex"], encode_bytes_hex(b"event"));
    assert!(!serde_json::to_string(&run.args).unwrap().contains("do-not-retain"));
}

#[test]
fn revocation_during_verification_cannot_readmit_service_authority() {
    let mut engine = engine();
    let contract = spec().contract("billing");
    let (_, generation) = engine.route_service_generation("billing", &contract).unwrap();
    let first = verified(&mut engine, b"admitted", 0);
    identity::revoke_principal(engine.store(), "service:billing").unwrap();
    assert!(engine.request_verified_route("billing", &contract, &request(b"not-admitted"), generation, 1).is_err());
    assert!(engine.route_request_at("billing", &contract, &first.id, "service:billing", 1).is_err());
    assert!(engine.claim_actions("service:worker", None, 1, 1_000, 1, 2).unwrap().is_empty());
    let (_, fresh_generation) = engine.route_service_generation("billing", &contract).unwrap();
    assert_ne!(generation, fresh_generation);
    // A fresh verification cannot rebind old same-body work after revocation.
    assert!(engine.request_verified_route("billing", &contract, &request(b"admitted"), fresh_generation, 3).is_err());
    assert!(engine.request_verified_route("billing", &contract, &request(b"new-intent"), fresh_generation, 3).is_ok());
}

#[test]
fn session_route_identity_isolated_by_principal_and_originating_family() {
    let route = RouteSpec { service: None, ..spec() };
    let contract = route.contract("billing");
    let mut engine = Engine::memory(schema_with(route), []).unwrap();
    let alice = identity::open_session(engine.store(), "member:alice", "account", 0).unwrap();
    let other_alice = identity::open_session(engine.store(), "member:alice", "account", 0).unwrap();
    let bob = identity::open_session(engine.store(), "member:bob", "account", 0).unwrap();
    let context = |session: &identity::Session| Context::new(&session.principal, BTreeMap::new()).with_session(&session.token).at(0);
    let request = request(b"same-body");
    let first = engine.request_session_route("billing", &contract, &request, context(&alice)).unwrap();
    let replay = engine.request_session_route("billing", &contract, &request, context(&alice)).unwrap();
    assert!(replay.1); assert_eq!(first.0.id, replay.0.id);
    let second = engine.request_session_route("billing", &contract, &request, context(&other_alice)).unwrap();
    let third = engine.request_session_route("billing", &contract, &request, context(&bob)).unwrap();
    assert_ne!(first.0.id, second.0.id); assert_ne!(first.0.id, third.0.id);
    assert!(engine.route_request_at("billing", &contract, &first.0.id, &bob.principal, 1).is_err());
    identity::close_session(engine.store(), &alice.token).unwrap();
    assert!(engine.route_request_at("billing", &contract, &first.0.id, &alice.principal, 1).is_err());
    assert!(engine.request_session_route("billing", &contract, &request, context(&alice)).is_err());
    assert!(engine.request_session_route("billing", &contract, &request, Context::new("member:alice", BTreeMap::new()).at(0)).is_err());
    assert!(engine.request_verified_route("billing", &contract, &request, 0, 0).is_err());
}

#[test]
fn a_changed_route_contract_parks_old_work_instead_of_rekeying_same_body() {
    let mut engine = engine();
    let first = verified(&mut engine, b"event", 0);
    let changed = RouteSpec { service: Some("service:new-billing".into()), ..spec() };
    let contract = changed.contract("billing");
    engine.adopt(schema_with(changed), []).unwrap();
    assert!(engine.claim_actions("service:worker", None, 1, 1_000, 1, 1).unwrap().is_empty());
    assert_eq!(engine.action_request_at(&first.id, "service:billing", 1).unwrap().state, "parked");
    assert_eq!(engine.request_verified_route("billing", &contract, &request(b"event"), 0, 2).unwrap_err().code(), "E_ROUTE_GENERATION");
    assert_eq!(engine.route_request_at("billing", &spec().contract("billing"), &first.id, "service:billing", 2).unwrap_err().code(), "E_ROUTE_GENERATION");
}

#[test]
fn raw_route_settlement_cannot_cache_a_5xx_and_business_refusal_is_recorded() {
    let mut engine = engine();
    let first = verified(&mut engine, b"event", 0);
    let held = claim(&mut engine, 0);
    let unavailable = RouteResponse { status: 503, ..response(b"temporary") };
    let retry = engine.settle_action(&first.id, "service:worker", &held.session.token, ActionSettled::Done(serde_json::to_value(unavailable).unwrap()), 1).unwrap();
    assert_eq!(retry.state, "queued"); assert!(retry.result.is_none());
    let next = claim(&mut engine, 2_001);
    let refused = RouteResponse { status: 204, application_refusal: Some("plan declined".into()), ..response(b"") };
    let done = engine.settle_action(&first.id, "service:worker", &next.session.token, ActionSettled::Done(serde_json::to_value(refused).unwrap()), 2_002).unwrap();
    assert_eq!(done.state, "done"); assert_eq!(done.error_code.as_deref(), Some("E_ROUTE_REFUSED"));
    assert_eq!(done.error.as_deref(), Some("plan declined")); assert_eq!(done.result.unwrap()["status"], 204);
}

#[test]
fn malformed_route_response_fails_terminally_after_possible_io() {
    for value in [json!(null), json!({"status":200,"headers":[],"bodyHex":"FF"}), json!({"status":200,"headers":[["content-length","99"]],"bodyHex":""}), json!({"status":204,"headers":[],"bodyHex":"00"})] {
        let mut engine = engine(); let run = verified(&mut engine, b"event", 0); let held = claim(&mut engine, 0);
        let failed = engine.settle_action(&run.id, "service:worker", &held.session.token, ActionSettled::Done(value), 1).unwrap();
        assert_eq!(failed.state, "failed"); assert_eq!(failed.error_code.as_deref(), Some("E_ROUTE_RESULT"));
        assert!(engine.claim_actions("service:worker", None, 1, 1_000, 1, 9_000).unwrap().is_empty());
    }
}

#[test]
fn route_recovery_uses_the_same_fenced_steps_and_response_record_after_a_crash() {
    let mut engine = engine(); let run = verified(&mut engine, b"event", 0); let first = claim(&mut engine, 0);
    let begun = engine.begin_action_step(&run.id, "service:worker", &first.session.token, "provider", &json!({"body": "event"}), false, 1).unwrap();
    engine.complete_action_step(&run.id, "service:worker", &first.session.token, "provider", &json!({"receipt":1}), 2).unwrap();
    let next = claim(&mut engine, 1_001);
    assert_eq!(next.request.id, first.request.id); assert_eq!(next.request.attempt, 2);
    let replay = engine.begin_action_step(&run.id, "service:worker", &next.session.token, "provider", &json!({"body":"event"}), false, 1_002).unwrap();
    assert_eq!(replay.state, "done"); assert_eq!(replay.key, begun.key); assert_eq!(replay.result, Some(json!({"receipt":1})));
    let result = serde_json::to_value(response(b"ok")).unwrap();
    assert_eq!(engine.settle_action(&run.id, "service:worker", &first.session.token, ActionSettled::Done(result.clone()), 1_003).unwrap_err().code(), "E_ACTION_LEASE");
    assert_eq!(engine.settle_action(&run.id, "service:worker", &next.session.token, ActionSettled::Done(result), 1_003).unwrap().state, "done");
}
