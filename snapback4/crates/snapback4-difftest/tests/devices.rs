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
            Verdict::Disagree(f) => assert_eq!(f.signature, name),
            other => panic!("{name} no longer reproduces ({other:?}): diagnose, update its DIAGNOSIS.md and this test"),
        }
    }
    assert!(seen >= 9, "{seen}");
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
