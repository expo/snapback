// @ref LLP 3000.023#11 — derive custody before projecting private engine effects.
use serde_json::Value;
fn compile(source: &str) -> snapback4_lang::Bound {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}
fn facts(bound: &snapback4_lang::Bound, name: &str) -> Value {
    snapback4_lang::emit::backend_programs(bound)
        .into_iter()
        .find(|p| p["name"] == name)
        .unwrap()["settlement"]
        .clone()
}
#[test]
fn capability_free_wire_pin_adds_settlement_without_changing_schema_or_device_ir() {
    let bound = compile(include_str!("../../snapback4-core/tests/fixtures/capability-free.q"));
    let wire = serde_json::json!({
        "generation": 1, "native": null,
        "programs": snapback4_lang::emit::backend_programs(&bound),
        "schema": bound.schema.public_projection(),
    });
    assert_eq!(serde_json::to_string(&wire).unwrap(), include_str!(
        "../../../packages/snapback4/test/fixtures/capability-free-0.4.backend.json"));
    assert_eq!(serde_json::to_string(&bound.schema).unwrap(), include_str!(
        "../../snapback4-core/tests/fixtures/capability-free.schema.json"));
    assert!(wire["programs"].as_array().unwrap().iter().all(|p| p["settlement"].is_object()));
    let decoded: snapback4_device::device::Backend = serde_json::from_value(wire).unwrap();
    let original = snapback4_device::device::Backend {
        generation: 1, schema: bound.schema.public_projection(),
        programs: bound.programs.into_iter().map(|p| p.program).collect(),
    };
    // This is the typed encoding persisted as device:backend; wire facts are discarded.
    assert_eq!(serde_json::to_string(&decoded).unwrap(), serde_json::to_string(&original).unwrap());
    assert!(!serde_json::to_string(&decoded).unwrap().contains("\"settlement\""));
}
#[test]
fn receipt_watermarks_do_not_write_membership_keys_but_returned_progress_depends_on_them() {
    let bound = compile(include_str!("fixtures/rp-predecessor/schema.q"));
    let history = facts(&bound, "history");
    assert_eq!(history["reads"]["messages"], Value::Null);
    assert_eq!(
        history["reads"]["members"],
        serde_json::json!(["conversation", "principal"])
    );
    for (op, field) in [
        ("seen", "seenOrdinal"),
        ("delivered", "deliveredOrdinal"),
        ("compactReceipts", "deliveredOrdinal"),
    ] {
        let write = facts(&bound, op);
        assert_eq!(write["writes"]["members"], serde_json::json!([field]));
        assert!(
            write["writes"].get("unreadCounts").is_some(),
            "row counts follow recipient changes"
        );
    }
    assert_eq!(
        facts(&bound, "receiptMember")["reads"]["members"],
        Value::Null
    );
    let decorated = facts(&bound, "messageReceipts");
    assert_eq!(decorated["reads"]["members"], Value::Null);
    assert_eq!(decorated["reads"]["runs"], Value::Null);
    assert_eq!(
        facts(&bound, "send")["writes"]["conversations"],
        serde_json::json!(["lastOrdinal"])
    );
    assert!(facts(&bound, "leave")["writes"].get("runs").is_some());
}
#[test]
fn maintained_columns_are_included_before_private_formulas_leave_the_wire() {
    let bound = compile(include_str!("fixtures/maintained-columns.q"));
    assert!(bound.schema.maintains.iter().any(|m| m.private.is_some()));
    assert!(bound
        .schema
        .public_projection()
        .maintains
        .iter()
        .all(|m| m.private.is_none()));
    for op in ["like", "change", "unlike"] {
        let writes = facts(&bound, op)["writes"].clone();
        let parent = writes["posts"].as_array().unwrap();
        for f in ["likeCount", "selected", "total"] {
            assert!(parent.contains(&Value::String(f.into())), "{writes}");
        }
    }
    assert_eq!(facts(&bound, "ranked")["reads"]["posts"], Value::Null);
}
#[test]
fn rules_include_extra_equalities_expiry_and_through_ancestors() {
    let source = "table grants:\n  who: principal\n  active: bool\n  expires: time ?\n  unique who\n  expire at .expires\n  public\ntable rooms:\n  read <- exists grants[who = viewer, active = true]\n  publicWritePlaceholder\ntable entries:\n  room: rooms\n  body: text\n  immutable room\n  read through .room\nquery list():\n  return entries first 10 by .id\n".replace("  publicWritePlaceholder\n", "");
    let bound = compile(&source);
    let reads = facts(&bound, "list")["reads"].clone();
    assert!(reads.get("rooms").is_some(), "{reads}");
    for field in ["who", "active", "expires"] {
        assert!(
            reads["grants"]
                .as_array()
                .unwrap()
                .contains(&Value::String(field.into())),
            "{reads}"
        );
    }
}
#[test]
fn opaque_program_has_no_empty_effect_claim() {
    let mut bound = compile("query plain():\n  return 1\n");
    bound.programs[0].program.native = true;
    assert_eq!(facts(&bound, "plain"), Value::Null);
}

#[test]
fn search_expiry_and_inherited_views_close_over_sources_and_parent_authority() {
    let bound = compile(include_str!("fixtures/read-through-device.q"));
    for op in ["search", "page", "countFor"] {
        let reads = facts(&bound, op)["reads"].clone();
        for table in ["comments", "tasks", "projects", "orgs", "members"] {
            assert!(reads.get(table).is_some(), "{op}: {reads}");
        }
    }
    // A parent's lifetime/deletion affects descendants even without an explicit
    // child write in the mutation; derived counts and search share that source.
    let writes = facts(&bound, "dropTask")["writes"].clone();
    for table in ["tasks", "comments", "totals"] {
        assert!(writes.get(table).is_some(), "{writes}");
    }
    let bound = compile(include_str!("fixtures/following-view.q"));
    let reads = facts(&bound, "cards")["reads"].clone();
    for table in ["posts", "reposts", "follows"] {
        assert!(reads.get(table).is_some(), "{reads}");
    }
    let writes = facts(&bound, "unfollow")["writes"].clone();
    assert!(writes.get("follows").is_some());
    assert!(bound
        .schema
        .timelines
        .iter()
        .all(|timeline| timeline.owned.iter().all(|t| writes.get(t).is_some())));
}
