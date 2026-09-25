#[path = "../../snapback4-core/tests/row_view_disclosure/cases.rs"]
mod cases;
mod common;
#[path = "../../snapback4-core/tests/row_view_disclosure/mod.rs"]
mod disclosure;
use common::*;
use disclosure::*;
use serde_json::{Value as Json, json};
use snapback4_core::ir::ProgramKind;
use snapback4_device::device::{Backend, Device, StreamPage, Queued};
fn pair_devices<H: Host>(host: &mut H, pair: &Pair) -> Transcript {
    if let Some((schema, programs)) = pair.refused_backend() {
        let mut refusals = Vec::new();
        for world in 0..2 {
            let error = host.open(&format!("refused-{world}"), Some(Backend { generation: 1, schema: schema.clone(), programs: programs.clone() })).err().expect("unsupported backend must refuse before outbox admission");
            assert_eq!(error.refusal().code, "E_VIEW_KEY", "{error}");
            refusals.push(json!(error.refusal()));
        }
        assert_eq!(refusals[0], refusals[1]);
        return Transcript::from([("schema-refusal".into(), refusals.remove(0))]);
    }
    let mut devices: [Option<Device<H::Store>>; 2] = [None, None];
    pair.assert_with(|world, e, phase, pages, now| {
        if devices[world].is_none() {
            devices[world] = Some(
                host.open(
                    &format!("world-{world}"),
                    Some(Backend {
                        generation: e.generation(),
                        schema: e.schema().public_projection(),
                        programs: e.programs().cloned().collect(),
                    }),
                )
                .unwrap(),
            );
        }
        let d = devices[world].as_mut().unwrap();
        let mut observation = serde_json::Map::new();
        if let Some(n) = phase.strip_prefix("admit/").and_then(|n|n.parse::<usize>().ok()) {
            let op = &pair.operations[n];
            if op.principal == pair.principal {
                let prediction = d.predict(&op.name, &op.principal, &op.args, now, vec![format!("new-{n}")], n as u64 + 1);
                observation.insert("prediction".into(), match prediction {
                    Ok(p) => { let value = json!(p); d.withdraw(&p.predicted).unwrap(); value },
                    Err(e) => json!({"refusal":e.refusal()}),
                });
                let admission = d.admit(Queued {
                    id: format!("operation-{n}"), seq: n as u64 + 1,
                    op: op.name.clone(), args: op.args.clone(), viewer: op.principal.clone(),
                    now, new_ids: vec![format!("new-{n}")], predicted: vec![], predictable: true,
                    sent_seq: None, receipt_store: None, observed_seq: None,
                });
                observation.insert("admission".into(), match admission { Ok(q) => json!(q), Err(e) => json!({"refusal":e.refusal()}) });
            }
        } else if let Some(n) = phase.strip_prefix("settle/").and_then(|n|n.parse::<usize>().ok()) {
            let id = format!("operation-{n}");
            if d.queued().unwrap().iter().any(|q|q.id == id) {
                let result: snapback4_core::MutationOutcome = serde_json::from_value(pages[0].clone()).unwrap();
                let seq = match result.state { snapback4_core::WriteState::Sent { seq, .. } => Some(seq), _ => None };
                observation.insert("settlement".into(), json!(d.settle(&id, seq).map_err(|e|e.refusal())));
            }
        } else { for (n, page) in pages.iter().enumerate() {
            let p: StreamPage = serde_json::from_value(page.clone()).unwrap();
            d.apply(&p, phase != "stream" && n == 0).unwrap();
        }
        }
        let queued = d.queued().unwrap();
        if phase == "snapshot" { assert!(queued.is_empty(), "settled write remained queued: {queued:?}"); }
        observation.insert("outbox".into(), json!(queued));
        observation.insert("watermark".into(), json!(d.state().unwrap()));
        if phase == "initial" {
            let op = &pair.operations[0];
            let prediction = d.predict(
                &op.name,
                &op.principal,
                &op.args,
                now,
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
        }
        if phase == "initial" {
            let result = d.predict("send", &pair.principal, &json!({"id":"device-pred","conversationId":"c","ordinal":1400,"senderId":"bob","until":null}), now, vec!["device-pred".into()], 1);
            let observation_value = match result {
                Ok(p) => {
                    let value = json!({"prediction":p,"query":d.query("unreadFor",&pair.principal,&pair.queries["unreadFor"],now)});
                    d.withdraw(&p.predicted).unwrap();
                    value
                }
                Err(error) => json!({"refusal":error.refusal()}),
            };
            observation.insert("counted-insert-prediction".into(),observation_value);
        }
        for p in e.programs().filter(|p| p.kind == ProgramKind::Query) {
            let mut args = pair.queries.get(&p.name).cloned().unwrap_or(json!({}));
            for page in 0..100 {
                let result = d.query(&p.name, &pair.principal, &args, now);
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
        if let Ok(r) = d.query("unreadFor", &pair.principal, pair.queries.get("unreadFor").unwrap(), now) {
            if r.complete && d.store().raw_rows("members").iter().any(|u| u.field("id").ok().and_then(|v|v.as_str().ok()) == pair.queries["unreadFor"]["member"].as_str()) {
                let key = &e.schema().maintains.iter().find(|m|m.target == "unread").unwrap().row_key.as_ref().unwrap();
                let u = d.store().raw_rows("members").into_iter().find(|u| u.field("id").ok().and_then(|v|v.as_str().ok()) == pair.queries["unreadFor"]["member"].as_str()).unwrap();
                let expected = d.store().raw_rows("messages").iter().filter(|m| !e.schema().tables["messages"].expired(m, now) && key.matches(m, &u)).count();
                assert_eq!(r.data, snapback4_core::Value::Int(expected as i64), "certified count is not the device's basis");
            }
        }
        Json::Object(observation)
    })
}
#[test]
fn row_views_replay_every_channel_on_memory_and_sqlite() {
    for pair in [
        cases::old_mark(),
        cases::hidden_conversation(),
        cases::unreadable_key(),
        cases::hidden_interval(),
        cases::hidden_expiry(),
        cases::digit_boundary(),
    ]
    .into_iter()
    .chain(
        [
            "insertRow",
            "insertAbsent",
            "upsertRow",
            "updateRow",
            "deleteRow",
        ]
        .map(cases::hidden_source),
    )
    .chain(
        [
            "insertRow",
            "insertAbsent",
            "upsertRow",
            "updateRow",
            "deleteRow",
        ]
        .map(cases::refused_source),
    ) {
        pair_devices(&mut Memory::new(), &pair);
        pair_devices(&mut Sqlite::new("row-view-worlds"), &pair);
    }
}

#[path = "../../snapback4-core/tests/row_view_disclosure/generated.rs"]
mod generated;
#[test]
fn generated_pairs_admission_outbox_and_settlement_on_both_devices() {
    let mut admitted = 0;
    let count = generated::visit(|name, pair| {
        eprintln!("{name}");
        admitted += usize::from(!pair.refused);
        let memory = pair_devices(&mut Memory::new(), &pair);
        let sqlite = pair_devices(&mut Sqlite::new("row-view-generated"), &pair);
        assert_eq!(memory, sqlite, "device stores differ: {name}");
    });
    assert_eq!((count, admitted), (546, 276));
    for pair in [generated::astra_move(), generated::astra_schedule(), generated::aligned_access_hidden_mark(), generated::blind_private_parent()] {
        pair_devices(&mut Memory::new(), &pair);
        pair_devices(&mut Sqlite::new("row-view-astra"), &pair);
    }
}

#[test]
fn grok_born_expired_replays_every_device_lifecycle_channel() {
    for (population, examined) in [(3,None), (30,Some(48)), (9999,None)] {
        let pair = generated::grok_born_expired(population, examined);
        let memory = pair_devices(&mut Memory::new(), &pair);
        let sqlite = pair_devices(&mut Sqlite::new("row-view-grok"), &pair);
        assert_eq!(memory, sqlite);
    }
}

#[path = "../../snapback4-core/tests/row_view_disclosure/scalars.rs"]
mod scalars;
fn scalar_device<H: Host>(host: &mut H, name: &str, pair: &Pair, marks: &[Json], expected: &[i64]) {
    let mut e = pair.engine(0);
    let mut d = host.open("scalars", Some(Backend { generation: e.generation(), schema: e.schema().public_projection(), programs: e.programs().cloned().collect() })).unwrap();
    for (i, page) in snapshot(&mut e, "alice", NOW, 100).into_iter().enumerate() {
        d.apply(&serde_json::from_value(page).unwrap(), i == 0).unwrap();
    }
    for (mark, &count) in marks.iter().zip(expected) {
        let args = json!({"member":"scalar-member", "readUpTo":mark});
        let prediction = d.predict("mark", "alice", &args, NOW, vec![], 1).unwrap();
        let result = d.query("unreadFor", "alice", &json!({"member":"scalar-member"}), NOW).unwrap();
        assert!(result.complete, "{name}: {result:?}");
        assert_eq!(result.data, snapback4_core::Value::Int(count), "{name}: mark={mark}");
        d.withdraw(&prediction.predicted).unwrap();
        let result = e.mutate("mark", None, snapback4_core::Context::new("alice", inputs(&e, "mark", &args)).at(NOW)).unwrap();
        assert!(matches!(result.state, snapback4_core::WriteState::Sent { .. }), "{name}: {result:?}");
        for (i, page) in snapshot(&mut e, "alice", NOW, 100).into_iter().enumerate() {
            d.apply(&serde_json::from_value(page).unwrap(), i == 0).unwrap();
        }
        let settled = d.query("unreadFor", "alice", &json!({"member":"scalar-member"}), NOW).unwrap();
        assert!(settled.complete, "{name}: {settled:?}");
        assert_eq!(settled.data, snapback4_core::Value::Int(count), "{name}: mark={mark}");
    }
}
#[test]
fn generated_scalar_comparisons_predict_and_settle_on_both_devices() {
    assert_eq!(scalars::visit(|name, pair, marks, expected| {
        scalar_device(&mut Memory::new(), &name, &pair, &marks, &expected);
        scalar_device(&mut Sqlite::new("row-view-scalars"), &name, &pair, &marks, &expected);
    }), 24);
}

#[test]
fn public_source_blind_private_parent_replays_every_device_lifecycle_channel() {
    let pair = generated::public_private_parent([1, 1200], "alice", "bob", "alice", "alice");
    let memory = pair_devices(&mut Memory::new(), &pair);
    let sqlite = pair_devices(&mut Sqlite::new("row-view-private-parent"), &pair);
    assert_eq!(memory, sqlite);
}

#[test]
fn formerly_live_populations_replay_both_insertion_orders_on_both_devices() {
    assert_eq!(generated::visit_formerly_live(|name,pair| {
        pair_devices(&mut Memory::new(),&pair);
        pair_devices(&mut Sqlite::new(&format!("b3-r6-{}",name.replace('/',"-"))),&pair);
    }),6);
}
