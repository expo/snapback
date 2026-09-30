//! Delivery clause admission and its portable backend binding.
use serde_json::json;
const SOURCE: &str = include_str!("delivery/schema.q");
fn compile(source: &str) -> snapback4_lang::Bound {
    snapback4_lang::compile(&[("schema.q".into(), source.into())])
}

#[test]
fn clause_binds_argument_names_and_survives_schema_serialization() {
    let bound = compile(SOURCE);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let wire = serde_json::to_value(&bound.schema).unwrap();
    assert_eq!(
        wire["delivery"],
        json!([{"table":"messages","group":"chat","position":"ordinal","mutation":"delivered","args":["group","low","high"],"fingerprint":"2f5d2629caf0cd61eacb5eb5bd772dd8684be9e7872af1112bd679c5719f3443"}])
    );
    let restored: snapback4_core::Schema =
        serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
    assert_eq!(restored, bound.schema);
    let inline = compile(&SOURCE.replace(")\n  reports", ") reports"));
    assert!(inline.diagnostics.is_empty(), "{:?}", inline.diagnostics);
    assert_eq!(inline.schema.delivery, bound.schema.delivery);
    let mut legacy = bound.schema.clone();
    legacy.delivery.clear();
    assert!(
        serde_json::to_value(legacy)
            .unwrap()
            .get("delivery")
            .is_none()
    );
}

#[test]
fn every_clause_check_has_a_located_diagnostic_and_concrete_rewrite() {
    for (from, to) in [
        ("mutation delivered", "query delivered"),
        ("of messages", "of missing"),
        ("by .chat, .ordinal", "by .missing, .ordinal"),
        ("by .chat, .ordinal", "by .chat, .missing"),
        ("chat: chats", "chat: chats ?"),
        ("ordinal: int", "ordinal: text <=80"),
        (
            "group: chats, low: int, high: int",
            "group: chats, low: int",
        ),
        (
            "group: chats, low: int, high: int",
            "group: chats, low: int, high: int, extra: int",
        ),
        (
            "by .chat, .ordinal:",
            "by .chat, .ordinal reports delivery of messages by .chat, .ordinal:",
        ),
        (
            "group: chats, low: int, high: int",
            "group: messages, low: int, high: int",
        ),
        (
            "group: chats, low: int, high: int",
            "group: chats, low: int ?, high: int",
        ),
        (
            "group: chats, low: int, high: int",
            "group: chats, low: time, high: int",
        ),
        ("immutable chat, ordinal", "immutable chat"),
        ("immutable chat, ordinal", "immutable ordinal"),
        ("unique chat, ordinal", "by positions: chat, ordinal"),
        ("by .chat, .ordinal", "by chat, .ordinal"),
    ] {
        let changed = SOURCE.replacen(from, to, 1);
        let bound = compile(&changed);
        let d = bound
            .diagnostics
            .iter()
            .find(|d| d.code == "E_DELIVERY_CLAUSE")
            .unwrap_or_else(|| panic!("{from} => {to}: {:?}", bound.diagnostics));
        assert!(!d.rewrite.is_empty(), "{d:?}");
        assert!(d.site.line > 0, "{d:?}");
        assert!(d.explanation().is_some());
    }
    let duplicate = compile(&format!(
        "{SOURCE}\nmutation second(g: chats, a: int, b: int) reports delivery of messages by .chat, .ordinal:\n  return null\n"
    ));
    assert!(
        duplicate
            .diagnostics
            .iter()
            .any(|d| d.code == "E_DELIVERY_CLAUSE" && d.message.contains("already"))
    );
}

#[test]
fn ephemeral_mutations_cannot_promise_durable_replay() {
    let source = format!(
        "table signals:\n  n: int\n  principal: principal\n  insert <- .principal = viewer\n  read <- allow\n  ephemeral 4s\n{}",
        SOURCE.replacen(
            "  return null\nmutation ordinary",
            "  insert signals {n: low, principal: viewer}\n  return null\nmutation ordinary",
            1
        )
    );
    let bound = compile(&source);
    assert!(
        bound
            .diagnostics
            .iter()
            .any(|d| d.code == "E_DELIVERY_CLAUSE" && d.message.contains("ephemeral")),
        "{:?}",
        bound.diagnostics
    );
}

#[test]
fn binding_decoder_rejects_incomplete_or_duplicate_fields() {
    use snapback4_core::schema::DeliveryBinding;
    for wire in [
        r#"{"table":"messages"}"#,
        r#"{"table":"messages","table":"other","group":"chat","position":"ordinal","mutation":"delivered","args":["group","low","high"],"fingerprint":"2f5d2629caf0cd61eacb5eb5bd772dd8684be9e7872af1112bd679c5719f3443"}"#,
        r#"{"table":"messages","group":"chat","position":"ordinal","mutation":"delivered","args":["group"]}"#,
    ] {
        assert!(serde_json::from_str::<DeliveryBinding>(wire).is_err());
    }
}

#[test]
fn fingerprint_names_every_component_and_is_independent_of_wire_order() {
    let bound = compile(SOURCE);
    let binding = bound.schema.delivery[0].clone();
    assert_eq!(binding.fingerprint, binding.compute_fingerprint());
    for field in 0..7 {
        let mut changed = binding.clone();
        match field {
            0 => changed.table.push('x'), 1 => changed.group.push('x'),
            2 => changed.position.push('x'), 3 => changed.mutation.push('x'),
            n => changed.args[n - 4].push('x'),
        }
        assert_ne!(changed.compute_fingerprint(), binding.fingerprint, "{field}");
    }
    let wire = serde_json::to_value(&binding).unwrap();
    let restored: snapback4_core::schema::DeliveryBinding = serde_json::from_value(wire).unwrap();
    assert_eq!(restored.compute_fingerprint(), binding.fingerprint);
}

#[test]
fn manual_delivery_accepts_extra_message_and_member_unique_keys_and_caps() {
    let source = include_str!("delivery/integration.q")
        .replace("members[.room, viewer]", "members[room = .room, principal = viewer]")
        .replace("  unique room, principal", "  nonce: int default 0\n  unique room, principal\n  unique byClientNonce: principal, nonce\n  cap 50 by room\n  cap 100 by principal")
        .replace("  unique room, ordinal", "  nonce: int default 0\n  unique room, ordinal\n  unique byClientNonce: room, nonce\n  cap 100 by room\n  cap 1000");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert_eq!(bound.schema.delivery.len(), 1);
}
