use snapback4_core::{schema::{self, RouteSpec, Schema, WorkSpec, routes::{BODY_BYTES, RouteRequest, RouteResponse}}, value::encode_bytes_hex};

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
