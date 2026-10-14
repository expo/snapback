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
            // Resolved by lane EX (DIAGNOSIS.md): a refusal after an unproved insert queues,
            // and the meter charges only live rows (LLP 3000.007 §20.5, §20.24.6).
            Verdict::Unsupported(r) if name.contains("--write-refused--") => assert_eq!(r, "prediction-declined", "{name}"),
            Verdict::Pass if !name.contains("--write-") => {}
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

// @ref LLP 3000.007#20.24.6 — the public meter charges only rows live at the read's clock.
const EXPIRING_PUBLIC: &str = "table items:\n  bucket: int\n  score: int\n  label: text <=64\n  until: time ?\n  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  expire at .until\n  sync public\n\n";
const EXPIRING_OWNER: &str = "table items:\n  owner: principal\n  bucket: int\n  score: int\n  label: text <=64\n  tag: id\n  until: time ?\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  delete <- .owner = viewer\n  expire at .until\n  sync to .owner\n\ntable tags:\n  owner: principal\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  delete <- .owner = viewer\n  sync to .owner\n\n";

/// Unswept expired rows interleaved with live ones, at the read clock 1,000:
/// expired long ago (100), expired at the read (1,000), expiring later
/// (5,000, held by a device that acquired before 1,000), and never.
fn expiring_case(owner: bool) -> snapback4_difftest::generate::Case {
    let mut case = snapback4_difftest::generate::generate(0);
    let untils = [json!(100), json!(null), json!(1000), json!(5000), json!(100), json!(null), json!(999), json!(1000), json!(null)];
    case.rows = untils.iter().enumerate().map(|(n, until)| {
        let mut row = json!({"id": format!("r{n}"), "bucket": 0, "score": (n % 3) as i64, "label": (["", "a", "é"][n % 3]), "until": until});
        if owner { row["owner"] = json!("bob"); row["tag"] = json!(format!("tag{n}")); }
        ("items".to_owned(), row)
    }).collect();
    if owner { case.rows.push(("tags".into(), json!({"id": "tag1", "owner": "bob"}))); }
    case.principal = "bob".into();
    case.args = json!({"c": null});
    case.clock = 1000;
    case
}

fn expiring_programs() -> Vec<(bool, &'static str)> {
    vec![
        (false, "query run(c: cursor ?):\n  return items where .bucket = 0 first 2 by .label, .score after c\n"),
        (false, "query run(c: cursor ?):\n  return items where .bucket = 0 last 1 by .label, .score\n"),
        (false, "query run(c: cursor ?):\n  return count(items where .bucket = 0)\n"),
        (true, "query run(c: cursor ?):\n  return items where .bucket = 0 and .owner = viewer last 3 by .label, .score after c { id, t: tags[.tag] }\n"),
        (true, "query run(c: cursor ?):\n  return sum(items where .bucket = 0 and .owner = viewer, .score)\n"),
    ]
}

#[test]
fn unswept_expired_rows_meter_the_same_on_the_server_and_the_device() {
    for (owner, query) in expiring_programs() {
        let case = expiring_case(owner);
        let source = format!("{}{query}", if owner { EXPIRING_OWNER } else { EXPIRING_PUBLIC });
        // A device that acquired at the read clock never received the expired
        // rows; one that acquired earlier holds rows that expired since.
        for acquired_at in [case.clock, 500] {
            for store in devices::STORES {
                let mut server = devices::server(&case, &source).unwrap();
                let mut files = devices::Files::new().unwrap();
                let mut dev = devices::open(store, &mut files, &server.backend).unwrap();
                devices::acquire(dev.as_mut(), &mut server, &case.principal, 2, acquired_at).unwrap();
                let oracle = devices::store_oracle(store, "read", 0);
                let (verdict, classes) = devices::compare_read(&oracle, &mut server, dev.as_mut(), &case);
                assert!(matches!(verdict, Verdict::Pass), "{store} acquired at {acquired_at}: {query}{verdict:#?}");
                assert!(classes.iter().all(|c| c == "complete"), "{classes:?}");
                for dimension in snapback4_difftest::oracle::DIMENSIONS {
                    for n in devices::boundaries(&mut server, &case, dimension).unwrap() {
                        let oracle = devices::store_oracle(store, dimension, n);
                        let verdict = devices::compare_cut(&oracle, &mut server, dev.as_mut(), &case, dimension, n);
                        assert!(!matches!(verdict, Verdict::Disagree(_)), "{store} acquired at {acquired_at}, {dimension} {n}: {query}{verdict:#?}");
                    }
                }
            }
        }
    }
}

#[test]
fn a_cut_lands_in_the_same_place_before_and_after_the_sweep() {
    use snapback4_difftest::execute;
    for (owner, query) in expiring_programs() {
        let case = expiring_case(owner);
        let source = format!("{}{query}", if owner { EXPIRING_OWNER } else { EXPIRING_PUBLIC });
        let mut unswept = devices::server(&case, &source).unwrap();
        let mut swept = devices::server(&case, &source).unwrap();
        assert!(swept.engine.sweep_expired(case.clock, 1000).unwrap() > 0);
        let read = |server: &mut devices::Server, ceilings: snapback4_core::Ceilings| {
            server.engine.set_ceilings(ceilings);
            let mut outcome = execute::execute(&mut server.engine, &case, "run", &case.args);
            outcome.value.as_object_mut().unwrap().remove("seq");
            outcome
        };
        for dimension in snapback4_difftest::oracle::DIMENSIONS {
            let mut positions = devices::boundaries(&mut swept, &case, dimension).unwrap();
            positions.extend(devices::boundaries(&mut unswept, &case, dimension).unwrap());
            for n in positions {
                let ceilings = devices::ceilings(dimension, n);
                let (before, after) = (read(&mut unswept, ceilings), read(&mut swept, ceilings));
                assert_eq!(before.value, after.value, "{dimension} {n}: {query}");
            }
        }
        let (before, after) = (read(&mut unswept, Default::default()), read(&mut swept, Default::default()));
        assert_eq!(before.value, after.value, "{query}");
    }
}

const BLOCK_TABLE: &str = "table items:\n  owner: principal\n  bucket: int\n  score: int\n  label: text <=64\n  tag: id\n  unique byTag: tag\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  delete <- .owner = viewer\n  sync to .owner\n\ntable notes:\n  owner: principal\n  body: text <=64\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  sync to .owner\n\nquery observe(key: id):\n  return items[key]\n\n";

/// Admit `body` as `run` on both device stores after acquiring alice's
/// partition (bob holds `r0` with tag `tag0`, which alice cannot see), then
/// run it through the harness's write comparison: the device's admission
/// reply and the write and convergence verdicts.
fn admit_block(body: &str, args: serde_json::Value) -> Vec<(serde_json::Value, [(String, Verdict); 2])> {
    let mut case = unheld_id_case();
    case.rows = vec![("items".into(), json!({"id": "r0", "owner": "bob", "bucket": 1, "score": 0, "label": "", "tag": "tag0"}))];
    case.principal = "alice".into();
    case.args = args;
    let source = format!("{BLOCK_TABLE}mutation run(key: id, k2: id, a: int, b: int):\n{body}");
    let mut out = Vec::new();
    for store in devices::STORES {
        let mut server = devices::server(&case, &source).unwrap();
        let mut files = devices::Files::new().unwrap();
        let mut dev = devices::open(store, &mut files, &server.backend).unwrap();
        devices::acquire(dev.as_mut(), &mut server, &case.principal, 5, case.clock).unwrap();
        // The same admission the harness makes, kept for its reply.
        let entry = json!({"id": "probe", "seq": 1, "op": "run", "args": case.args, "viewer": case.principal, "now": case.clock,
            "new_ids": (0..8).map(|i| format!("minted-{i}")).collect::<Vec<_>>(), "predictable": true, "predicted": [], "replay_candidate": false});
        let admitted = dev.call_text(&json!({"op": "admit", "entry": entry}).to_string());
        if admitted.get("ok").is_some() {
            assert!(dev.call_text(&json!({"op": "settle", "id": "probe", "store_id": server.store_id}).to_string()).get("denied").is_none());
        }
        let mut report = snapback4_difftest::campaign::Report::default();
        let verdicts = snapback4_difftest::device_writes::compare(store, &mut server, dev.as_mut(), &case, &mut report).unwrap();
        out.push((admitted, verdicts));
    }
    out
}

// @ref LLP 3000.007#20.5 — a refusal after an unproved prediction is the server's to report.
#[test]
fn a_refusal_after_an_unproved_insert_queues_for_the_server() {
    let args = json!({"key": "r0", "k2": "fresh", "a": 0, "b": 9007199254740991_i64});
    for body in [
        // The id belongs to bob's row: the server refuses E_RULE at the first insert.
        "  insert items { id: key, owner: viewer, bucket: 0, score: a, label: 'x', tag: 'mine' }\n  insert items { id: key, owner: viewer, bucket: 0, score: a, label: 'x', tag: 'mine2' }\n  return false\n",
        "  insert items { id: key, owner: viewer, bucket: 0, score: a, label: 'x', tag: 'mine' }\n  delete items[key]\n  delete items[key]\n  return 0\n",
        // A fresh id whose tag bob's row holds: still E_RULE on the server. (A
        // minted id would not help: the tag's population is unproved too.)
        "  insert items { id: k2, owner: viewer, bucket: 0, score: b, label: 'x', tag: 'tag0' }\n  v1 = (b * (items[k2].score ?? 0))\n  return 0\n",
    ] {
        for (admitted, [(_, write), (_, converge)]) in admit_block(body, args.clone()) {
            assert!(admitted.get("denied").is_none(), "{body}{admitted}");
            assert_eq!((admitted["ok"]["predictable"].clone(), admitted["ok"]["predicted"].clone()), (json!(false), json!([])), "{body}{admitted}");
            assert!(matches!(&write, Verdict::Unsupported(r) if r == "prediction-declined"), "{body}{write:?}");
            assert!(matches!(converge, Verdict::Pass), "{body}{converge:?}");
        }
    }
}

#[test]
fn a_refusal_the_device_can_prove_stays_final_and_local() {
    let args = json!({"key": "r9", "k2": "fresh", "a": 0, "b": 9007199254740991_i64});
    for (body, code) in [
        // A minted id on a table with no other unique key or cap: nothing to prove.
        ("  insert notes { owner: viewer, body: 'x' }\n  v1 = (b * b)\n  return 0\n", "E_OVERFLOW"),
        // No write precedes the refusal.
        ("  v1 = (b * b)\n  insert items { id: key, owner: viewer, bucket: 0, score: a, label: 'x', tag: 'mine' }\n  return 0\n", "E_OVERFLOW"),
    ] {
        for (admitted, [(_, write), (_, converge)]) in admit_block(body, args.clone()) {
            assert_eq!(admitted["denied"]["code"], json!(code), "{body}{admitted}");
            assert!(matches!(write, Verdict::Pass), "{body}{write:?}");
            assert!(matches!(converge, Verdict::Pass), "{body}{converge:?}");
        }
    }
}

#[test]
fn output_pricing_after_an_unproved_insert_queues_for_the_server() {
    let args = json!({"key": "r0", "k2": "fresh", "a": 0, "b": 0});
    // Evaluation fits the heap; only final output pricing refuses. The server
    // refuses the hidden id collision before it can reach this output.
    let body = format!("  insert items {{ id: key, owner: viewer, bucket: 0, score: a, label: 'x', tag: 'mine' }}\n  return '{}'\n", "x".repeat(1 << 20));
    for (admitted, [(_, write), (_, converge)]) in admit_block(&body, args) {
        assert!(admitted.get("denied").is_none(), "{admitted}");
        assert_eq!(admitted["ok"]["predictable"], false);
        assert!(matches!(&write, Verdict::Unsupported(r) if r == "prediction-declined"), "{write:?}");
        assert!(matches!(converge, Verdict::Pass), "{converge:?}");
    }
}

// @ref LLP 3000.036.001#17 — a discovered parent snapshot lane pays its
// admission once on both stores, including empty ranges and every meter cut.
#[test]
fn parent_snapshot_membership_lanes_keep_native_device_meter_parity() {
    let mut files = devices::Files::new().unwrap();
    for seed in [218, 1287, 1548] {
        let case = generate(seed);
        assert_eq!(case.program.domain.as_deref(), Some(".tag = parent.id"));
        let mut report = snapback4_difftest::campaign::Report::default();
        devices::check(&case, &mut report, &mut files, |_| {}).unwrap();
        assert!(!report.failed(), "seed {seed}: {report:?}");
    }
}
