#[path = "../../snapback4-core/tests/paired_worlds/sequences.rs"]
mod cases;
mod common;
#[path = "../../snapback4-core/tests/paired_worlds/mod.rs"]
mod paired_worlds;
use common::*;
use paired_worlds::*;
use serde_json::{Value as Json, json};
use snapback4_core::{ir::ProgramKind, Context, WriteState};
use snapback4_device::device::{Backend, Device, StreamPage, Queued};
fn pair_devices<H: Host>(host: &mut H, pair: &Pair) {
    let mut devices: [Option<Device<H::Store>>; 2] = [None, None];
    pair.assert_with(|world, e, phase, pages| {
        if devices[world].is_none() {
            devices[world] = Some(
                host.open(
                    &format!("world-{world}"),
                    Some(Backend {
                        generation: e.generation(),
                        schema: e.schema().clone(),
                        programs: e.programs().cloned().collect(),
                    }),
                )
                .unwrap(),
            );
        }
        let name = format!("world-{world}");
        let mut d = devices[world].take().unwrap();
        let mut observation = serde_json::Map::new();
        if phase == "stream" && !d.queued().unwrap().is_empty() {
            let op = &pair.operations[0];
            let reply = e.mutate(&op.name, Some("operation-0"), Context::new(&op.principal, inputs(e, &op.name, &op.args)).at(NOW)).unwrap();
            let seq = match reply.state { WriteState::Sent { seq, .. } => Some(seq), WriteState::Failed { .. } => None };
            observation.insert("settlement".into(), json!(seq));
            d.settle("operation-0", seq).unwrap();
            observation.insert("outbox/receipt".into(), json!(d.queued().unwrap()));
        }
        for (n, page) in pages.iter().enumerate() {
            let p: StreamPage = serde_json::from_value(page.clone()).unwrap();
            d.apply(&p, phase != "stream" && n == 0).unwrap();
        }
        observation.insert("watermark".into(), json!(d.state().unwrap()));
        if phase == "initial" {
            let op = &pair.operations[0];
            let prediction = d.predict(
                &op.name,
                &op.principal,
                &op.args,
                NOW,
                vec!["new-0".into()],
                1,
            );
            observation.insert(
                "prediction".into(),
                match prediction {
                    Ok(prediction) => {
                        let json = json!(prediction);
                        d.withdraw(&prediction.predicted).unwrap();
                        json
                    }
                    Err(error) => json!({"refusal":error.refusal()}),
                },
            );
            let admission = d.admit(Queued { upload: None,
                id: "operation-0".into(), seq: 1, op: op.name.clone(), args: op.args.clone(),
                new_ids: vec!["new-0".into(), "gate-0".into()], predicted: vec![],
                viewer: op.principal.clone(), now: NOW, predictable: true,
                sent_seq: None, receipt_store: None, observed_seq: None, dispatch: None,
            });
            observation.insert("admission".into(), match admission { Ok(entry) => json!(entry), Err(e) => json!({"refusal": e.refusal()}) });
        }
        let outbox = d.queued().unwrap();
        observation.insert("outbox/before-reopen".into(), json!(outbox));
        host.close(&name, d);
        let mut d = host.open(&name, None).unwrap();
        assert_eq!(d.queued().unwrap(), outbox, "durable outbox on {}", host.label());
        observation.insert("outbox/reopened".into(), json!(d.queued().unwrap()));
        if phase == "stream" { assert!(d.queued().unwrap().is_empty(), "settlement must drain the outbox"); }
        for p in e.programs().filter(|p| p.kind == ProgramKind::Query) {
            let mut args = pair.queries.get(&p.name).cloned().unwrap_or(json!({}));
            for page in 0..100 {
                let result = d.query(&p.name, &pair.principal, &args, NOW);
                observation.insert(format!("query/{}/{page}", p.name), json!(result));
                if let Some(next) = result.ok().and_then(|r| r.next) {
                    args["c"] = json!(next);
                } else {
                    break;
                }
                assert!(page < 99);
            }
        }
        for table in e.schema().tables.keys() {
            let mut rows = d.store().raw_rows(table);
            rows.sort_by_key(|r| r.field("id").unwrap().as_str().unwrap().to_owned());
            observation.insert(format!("held/{table}"), json!(rows));
        }
        devices[world] = Some(d);
        Json::Object(observation)
    });
}
#[test]
fn sequence_pairs_on_both_device_stores() {
    for pair in cases::pairs() {
        pair_devices(&mut Memory::new(), &pair);
        pair_devices(&mut Sqlite::new("sequence-pairs"), &pair);
    }
}

#[path = "../../snapback4-core/tests/paired_worlds/sequence_generated.rs"]
mod generated;
#[test]
fn generated_pairs_compare_admission_durable_outboxes_and_settlement() {
    for case in generated::cases().into_iter().chain(generated::address_cases()).chain(generated::boundary_cases()) {
        let result = std::panic::catch_unwind(|| {
            pair_devices(&mut Memory::new(), &case.pair);
            pair_devices(&mut Sqlite::new("generated-sequence-pairs"), &case.pair);
        });
        assert!(result.is_ok(), "{}", case.label);
    }
}

#[path = "../../snapback4-core/tests/paired_worlds/sequence_dependencies.rs"]
mod dependencies;
#[test]
fn generated_author_lookups_keep_intents_until_settlement() {
    fn run<H: Host>(host: &mut H, case: &dependencies::Dependency) {
        let pair = &case.pair;
        pair_devices(host, pair);
        let mut e = pair.engine(0);
        let backend = Backend { generation: e.generation(), schema: e.schema().clone(), programs: e.programs().cloned().collect() };
        let mut d = host.open("dependency", Some(backend)).unwrap();
        for (n, page) in paired_worlds::snapshot(&mut e, "alice").iter().enumerate() {
            d.apply(&serde_json::from_value(page.clone()).unwrap(), n == 0).unwrap();
        }
        let op = &pair.operations[0];
        let prediction = d.predict(&op.name, "alice", &op.args, NOW, vec!["new-0".into()], 1);
        if case.ordinal == 6 {
            assert_eq!(prediction.unwrap_err().code(), "E_PREDICT", "{}", case.label);
        } else {
            let prediction = prediction.unwrap();
            assert_eq!(prediction.result["ordinal"], 1);
            assert_eq!(prediction.result["pending"], true);
            d.withdraw(&prediction.predicted).unwrap();
        }
        let entry = d.admit(Queued { upload: None,
            id: "intent".into(), seq: 1, op: op.name.clone(), args: op.args.clone(), new_ids: vec!["new-0".into()], predicted: vec![],
            viewer: "alice".into(), now: NOW, predictable: true, sent_seq: None, receipt_store: None, observed_seq: None, dispatch: None,
        }).unwrap();
        assert_eq!(entry.predictable, case.ordinal == 1, "{}", case.label);
        assert_eq!(d.queued().unwrap(), vec![entry.clone()]);
        host.close("dependency", d);
        let mut d = host.open("dependency", None).unwrap();
        assert_eq!(d.queued().unwrap(), vec![entry.clone()], "durable intent: {}", case.label);
        let reply = e.mutate(&entry.op, Some(&entry.id), Context::new("alice", inputs(&e, &entry.op, &entry.args)).at(NOW).with_ids(entry.new_ids)).unwrap();
        let WriteState::Sent { seq, result } = reply.state else { panic!("{}: {reply:?}", case.label) };
        assert_eq!(result.field("ordinal"), Ok(&snapback4_core::Value::Int(case.ordinal)));
        d.settle("intent", Some(seq)).unwrap();
        assert_eq!(d.queued().unwrap()[0].sent_seq, Some(seq));
        let mut watermark = d.sync_state().unwrap().watermark;
        for page in paired_worlds::stream(&mut e, "alice", &mut watermark) {
            d.apply(&serde_json::from_value(page).unwrap(), false).unwrap();
        }
        assert!(d.queued().unwrap().is_empty());
        let row = d.query("one", "alice", &json!({}), NOW).unwrap().data;
        assert_eq!(row.field("ordinal"), Ok(&snapback4_core::Value::Int(case.ordinal)));
        assert_ne!(row.field("pending"), Ok(&snapback4_core::Value::Bool(true)));
        host.close("dependency", d);
        let mut d = host.open("dependency", None).unwrap();
        assert!(d.queued().unwrap().is_empty());
        assert_eq!(d.query("one", "alice", &json!({}), NOW).unwrap().data, row);
    }
    for case in dependencies::cases() {
        run(&mut Memory::new(), &case);
        run(&mut Sqlite::new("sequence-dependencies"), &case);
    }
}

#[test]
fn generated_readable_insert_admission_and_server_dispositions() {
    use generated::{Principal, ReadRule, Write};
    fn run<H: Host>(host: &mut H, principal: Principal, read: ReadRule, op: Write, cap: bool, hidden: bool) {
        let who = principal.who();
        let mut seed = vec![];
        if hidden {
            if read == ReadRule::Witness { seed.push(("grants".into(), json!({"id":"grant","parent":"p","who":who}))); }
            else { seed.push(generated::row("occupant", "carol", 5, "occupied")); }
        }
        let mut pair = Pair::new(generated::schema(principal, read, false, cap), [seed, vec![]], who,
            Operation::new(op.name(), json!({"parent":"p","body":"new","n":6}), who));
        pair.trusted = true;
        let mut e = pair.engine(0);
        let backend = Backend { generation: e.generation(), schema: e.schema().clone(), programs: e.programs().cloned().collect() };
        let mut d = host.open("readable", Some(backend)).unwrap();
        for (n, page) in paired_worlds::snapshot(&mut e, who).iter().enumerate() {
            d.apply(&serde_json::from_value(page.clone()).unwrap(), n == 0).unwrap();
        }
        let op = &pair.operations[0];
        let entry = d.admit(Queued { upload: None,
            id: "intent".into(), seq: 1, op: op.name.clone(), args: op.args.clone(), new_ids: vec!["new-0".into()], predicted: vec![],
            viewer: who.into(), now: NOW, predictable: true, sent_seq: None, receipt_store: None, observed_seq: None, dispatch: None,
        }).unwrap();
        let held = d.store().raw_rows("messages");
        if entry.predictable {
            assert_eq!(held.len(), 1);
            assert_eq!(held[0].field("ordinal"), Ok(&snapback4_core::Value::Int(1)));
            assert_eq!(held[0].field("pending"), Ok(&snapback4_core::Value::Bool(true)));
        }
        host.close("readable", d);
        let mut d = host.open("readable", None).unwrap();
        assert_eq!(d.queued().unwrap(), vec![entry.clone()]);
        let reply = e.mutate(&entry.op, Some(&entry.id), Context::new(who, inputs(&e, &entry.op, &entry.args)).at(NOW).with_ids(entry.new_ids)).unwrap();
        let accepted = if read == ReadRule::Witness { hidden } else { !cap || !hidden };
        let seq = match reply.state {
            WriteState::Sent { seq, result } => {
                assert!(accepted);
                assert_eq!(result.field("ordinal"), Ok(&snapback4_core::Value::Int(if read == ReadRule::Owner && hidden { 6 } else { 1 })));
                Some(seq)
            }
            WriteState::Failed { why, .. } => { assert!(!accepted); assert_eq!(why.code, "E_RULE"); None }
        };
        d.settle("intent", seq).unwrap();
        let mut watermark = d.sync_state().unwrap().watermark;
        for page in paired_worlds::stream(&mut e, who, &mut watermark) { d.apply(&serde_json::from_value(page).unwrap(), false).unwrap(); }
        assert!(d.queued().unwrap().is_empty());
        let rows = d.store().raw_rows("messages");
        // Witness rules here are online-only; their accepted row is read on
        // the server, not silently retained on a device without an audience.
        assert_eq!(rows.len(), usize::from(accepted && read == ReadRule::Owner));
        for row in rows { assert_ne!(row.field("pending"), Ok(&snapback4_core::Value::Bool(true))); }
        host.close("readable", d);
        let mut d = host.open("readable", None).unwrap();
        assert!(d.queued().unwrap().is_empty());
    }
    for principal in [Principal::SelfReadable, Principal::Writer] {
        for read in [ReadRule::Owner, ReadRule::Witness] {
            for op in [Write::Insert, Write::Absent] {
                for cap in [false, true] {
                    for hidden in [false, true] {
                        run(&mut Memory::new(), principal, read, op, cap, hidden);
                        run(&mut Sqlite::new("sequence-readable"), principal, read, op, cap, hidden);
                    }
                }
            }
        }
    }
}
