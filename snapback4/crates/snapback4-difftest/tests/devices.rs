//! Server against device: the acquisition wire, the argued field exceptions
//! and the retained device findings. The fixed-seed device run is in smoke.rs.
use serde_json::json;
use snapback4_difftest::{
    ast::*,
    devices,
    execute::Outcome,
    generate::generate,
    oracle::{Oracle, Verdict},
    shrink,
};
use snapback4_difftest::device_writes::{UNHELD_UNIQUE, clashing_row, refused_over_unheld_unique, seeded_items};
use std::collections::BTreeSet;

#[test]
fn snapshot_reply_has_the_sync_wire_fields() {
    // `crates/snapback4/src/sync_wire.rs::SnapshotReply` serialized fields;
    // `acquisitions` and `sent` are omitted when empty.
    let mut case = generate(19);
    case.program.tables[0].residency = Residency::Public;
    case.program.tables[0].rule = Rule::Allow;
    let source = case.program.source();
    let mut server = devices::server(&case, &source).unwrap();
    let reply = devices::snapshot_reply(&mut server, &case.principal, None, 1, case.clock, &[]).unwrap();
    let keys: BTreeSet<_> = reply.as_object().unwrap().keys().map(String::as_str).collect();
    let mut expected: BTreeSet<_> =
        ["acknowledged", "after", "events", "generation", "held", "more", "next", "now", "snapshot", "store_id", "watermark"].into();
    if reply.get("acquisitions").is_some() {
        expected.insert("acquisitions");
    }
    assert_eq!(keys, expected);
    assert!(reply["events"].as_array().unwrap().iter().all(|e| e.get("seq").is_none()), "snapshot events carry no seq");
    // A fresh device ends the first sync round acquired, by snapshot then catch-up.
    let mut files = devices::Files::new().unwrap();
    for store in devices::STORES {
        let mut dev = devices::open(store, &mut files, &server.backend).unwrap();
        let pages = devices::acquire(dev.as_mut(), &mut server, &case.principal, 1, case.clock).unwrap();
        assert!(pages.len() >= 2 && pages.last().unwrap()["snapshot"] == json!(false), "{store}: {pages:?}");
    }
}

#[test]
fn only_argued_fields_are_excepted() {
    let server = Outcome {
        kind: "query".into(),
        value: json!({"data":{"Int":3},"complete":true,"cut":null,"next":"c","metered":{"examined":1,"index_entries":0,"rule_probes":0,"steps":3,"heap_bytes":9,"output_bytes":9,"rows_written":0},"tables":["items"],"seq":7}),
    };
    let mut device = server.clone();
    device.value["seq"] = json!(0);
    device.value["unknown"] = json!(false);
    device.value["retained"] = json!(false);
    let (a, b) = devices::comparable_pub(&server, &device);
    assert_eq!(devices::field_pub(&a, &b), None);
    for key in ["data", "complete", "cut", "next", "tables", "capped_at", "word_cut_at", "next_expiry", "unavailable", "refusal"] {
        let mut changed = device.clone();
        changed.value[key] = json!("different");
        let (a, b) = devices::comparable_pub(&server, &changed);
        assert!(devices::field_pub(&a, &b).is_some(), "{key}");
    }
    for d in snapback4_difftest::oracle::DIMENSIONS {
        let mut changed = device.clone();
        changed.value["metered"][d] = json!(1234);
        let (a, b) = devices::comparable_pub(&server, &changed);
        assert_eq!(devices::field_pub(&a, &b), Some(format!("metered-{d}")));
    }
    // A delivery manifest on the device side is never excepted.
    let mut changed = device.clone();
    changed.value["delivery"] = json!({"x":1});
    let (a, b) = devices::comparable_pub(&server, &changed);
    assert!(devices::field_pub(&a, &b).is_some());
}

#[test]
fn retained_device_findings_still_reproduce() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("cases/found");
    let mut seen = 0;
    for entry in std::fs::read_dir(&root).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_str().unwrap().to_owned();
        if !name.starts_with("device-") {
            continue;
        }
        seen += 1;
        let artifact: shrink::Artifact = serde_json::from_slice(&std::fs::read(path.join("case.json")).unwrap()).unwrap();
        assert!(matches!(artifact.finding.oracle, Oracle::Device { .. }));
        match shrink::replay(&path).unwrap() {
            // Regression cases of the ruled exception (DIAGNOSIS.md): they replay as its name.
            Verdict::Named(n) if name.contains("--write-predicted-refused--") => assert_eq!(n, UNHELD_UNIQUE, "{name}"),
            Verdict::Disagree(f) => assert_eq!(f.signature, name),
            other => panic!("{name} no longer reproduces ({other:?}): diagnose, update its DIAGNOSIS.md and this test"),
        }
    }
    // The heap-accounting findings were retired with the uniform heap charge.
    assert!(seen >= 2, "{seen}");
}

#[test]
fn isolated_device_workers_agree_with_serial_counts() {
    use snapback4_difftest::campaign;
    let root = std::env::temp_dir().join(format!("quarry-device-workers-{}", std::process::id()));
    let executable = std::path::Path::new(env!("CARGO_BIN_EXE_snapback4-difftest"));
    let mut one = serde_json::to_value(campaign::parallel_command(0, 6, 1, &root.join("one"), executable, "run-devices", None).unwrap()).unwrap();
    let mut two = serde_json::to_value(campaign::parallel_command(0, 6, 2, &root.join("two"), executable, "run-devices", None).unwrap()).unwrap();
    for name in ["seconds", "slowest_case_seconds", "slowest_case_seed"] {
        one.as_object_mut().unwrap().remove(name);
        two.as_object_mut().unwrap().remove(name);
    }
    assert_eq!(one, two);
    std::fs::remove_dir_all(root).unwrap();
}

fn unheld_id_case() -> snapback4_difftest::generate::Case {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("cases/found/device-sqlite--write-predicted-refused--admitted");
    let artifact: shrink::Artifact = serde_json::from_slice(&std::fs::read(path.join("case.json")).unwrap()).unwrap();
    artifact.case
}

#[test]
fn a_predicted_insert_over_an_unheld_supplied_id_is_the_named_outcome() {
    // Bob inserts with key "r0", which names alice's row on `sync to .owner`.
    let case = unheld_id_case();
    let mut report = snapback4_difftest::campaign::Report::default();
    let mut files = devices::Files::new().unwrap();
    let mut found = Vec::new();
    devices::check(&case, &mut report, &mut files, |f| found.push(f.signature)).unwrap();
    assert!(found.is_empty(), "{found:?}");
    for store in devices::STORES {
        let write = &report.by_oracle[&format!("device-{store}-write")];
        assert_eq!((write.attempted, write.passed, write.disagreeing), (1, 0, 0), "{report:#?}");
        assert_eq!(write.named.get(UNHELD_UNIQUE), Some(&1), "{report:#?}");
        assert_eq!(report.by_oracle[&format!("device-{store}-converge")].passed, 1, "{report:#?}");
    }
    // What the guide states: the client reports E_RULE and settling the
    // refusal withdraws the pending row, before any further sync.
    let source = case.program.source();
    for store in devices::STORES {
        let mut server = devices::server(&case, &source).unwrap();
        let mut dev = devices::open(store, &mut files, &server.backend).unwrap();
        devices::acquire(dev.as_mut(), &mut server, &case.principal, devices::page_limit(case.seed), case.clock).unwrap();
        let entry = json!({"id": "w1", "seq": 1, "op": "run", "args": case.args, "viewer": case.principal, "now": case.clock,
            "new_ids": [], "predictable": true, "predicted": [], "replay_candidate": false});
        let admitted = dev.call_text(&json!({"op": "admit", "entry": entry}).to_string());
        assert_eq!(admitted["ok"]["predicted"], json!(["items/r0"]), "{store}: {admitted}");
        let observe = json!({"key": "r0"});
        let pending = devices::device_answer_named(dev.as_mut(), &case, "observe", &observe).outcome;
        assert_eq!(pending.data().unwrap()["Row"]["pending"], json!({"Bool": true}), "{store}: {pending:?}");
        let settled = dev.call_text(&json!({"op": "settle", "id": "w1", "store_id": server.store_id}).to_string());
        assert!(settled.get("denied").is_none(), "{store}: {settled}");
        let after = devices::device_answer_named(dev.as_mut(), &case, "observe", &observe).outcome;
        assert!(after.data().and_then(|d| d.get("Row")).is_none(), "{store}: {after:?}");
    }
}

#[test]
fn a_predicted_insert_over_a_hidden_secondary_unique_value_is_the_named_outcome() {
    // A hidden collision on a secondary unique key, with a fresh row id: the
    // device predicts, the server refuses E_RULE. Charlie's 2026-10-08 ruling
    // extends the supplied-id exception to any unique key.
    let mut case = unheld_id_case();
    case.program.tables[0].keys.push(("byTag".into(), vec!["tag".into()], true));
    case.rows[0].1["tag"] = json!("tag");
    case.args["key"] = json!("fresh");
    assert_eq!(clashing_row(&case, &seeded_items(&case)).as_deref(), Some("r0"));
    let mut report = snapback4_difftest::campaign::Report::default();
    let mut files = devices::Files::new().unwrap();
    let mut found = BTreeSet::new();
    devices::check(&case, &mut report, &mut files, |f| { found.insert(f.signature); }).unwrap();
    assert!(found.is_empty(), "{found:?}");
    for store in devices::STORES {
        let write = &report.by_oracle[&format!("device-{store}-write")];
        assert_eq!(write.named.get(UNHELD_UNIQUE), Some(&1), "{report:#?}");
        assert_eq!(write.disagreeing, 0, "{report:#?}");
    }
    // With no unique key on `tag` there is no clash: no exception applies.
    let mut plain = case.clone();
    plain.program.tables[0].keys.retain(|(name, _, _)| name != "byTag");
    assert_eq!(clashing_row(&plain, &seeded_items(&plain)), None);
    // Each clause of the exact condition is necessary.
    let case = unheld_id_case();
    let admitted = json!({"ok": {"predictable": true, "predicted": ["items/r0"]}});
    let refused = |code: &str| Outcome { kind: "mutation".into(), value: json!({"state": "failed", "why": {"code": code}}) };
    let none = Outcome { kind: "query".into(), value: json!({"data": "Null"}) };
    let row = Outcome { kind: "query".into(), value: json!({"data": {"Row": {}}}) };
    assert!(refused_over_unheld_unique(&case, &seeded_items(&case), &admitted, &refused("E_RULE"), &none, &none));
    // A different refusal reason (here a visible clash) stays a disagreement.
    assert!(!refused_over_unheld_unique(&case, &seeded_items(&case), &admitted, &refused("E_CONSTRAINT"), &none, &none));
    assert!(!refused_over_unheld_unique(&case, &seeded_items(&case), &admitted, &refused("E_RULE"), &row, &none), "the viewer can read it");
    assert!(!refused_over_unheld_unique(&case, &seeded_items(&case), &admitted, &refused("E_RULE"), &none, &row), "the device holds it");
    assert!(!refused_over_unheld_unique(&case, &seeded_items(&case), &json!({"ok": {"predictable": true, "predicted": []}}), &refused("E_RULE"), &none, &none));
    let mut absent = case.clone();
    absent.rows.clear();
    assert!(!refused_over_unheld_unique(&absent, &seeded_items(&absent), &admitted, &refused("E_RULE"), &none, &none), "no row has the id");
    let mut upsert = case.clone();
    upsert.program.body = Body::Write(Write::Upsert, Expr::Int(1));
    assert!(!refused_over_unheld_unique(&upsert, &seeded_items(&upsert), &admitted, &refused("E_RULE"), &none, &none), "only a plain insert");
}
