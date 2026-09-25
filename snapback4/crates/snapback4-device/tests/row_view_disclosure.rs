#[path = "../../snapback4-core/tests/row_view_disclosure/cases.rs"]
mod cases;
mod common;
#[path = "../../snapback4-core/tests/row_view_disclosure/mod.rs"]
mod disclosure;
use common::*;
use disclosure::*;
use serde_json::{Value as Json, json};
use snapback4_core::ir::ProgramKind;
use snapback4_device::device::{Backend, Device, StreamPage};
fn pair_devices<H: Host>(host: &mut H, pair: &Pair) {
    let mut devices: [Option<Device<H::Store>>; 2] = [None, None];
    pair.assert_with(|world, e, phase, pages| {
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
        for (n, page) in pages.iter().enumerate() {
            let p: StreamPage = serde_json::from_value(page.clone()).unwrap();
            d.apply(&p, phase != "stream" && n == 0).unwrap();
        }
        let mut observation = serde_json::Map::new();
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
        }
        if phase == "initial" {
            let result = d.predict("send", &pair.principal, &json!({"id":"device-pred","conversationId":"c","ordinal":1400,"senderId":"bob","until":null}), NOW, vec!["device-pred".into()], 1);
            let observation_value = match result {
                Ok(p) => {
                    let value = json!({"prediction":p,"query":d.query("unreadFor",&pair.principal,&pair.queries["unreadFor"],NOW)});
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
        if let Ok(r) = d.query("unreadFor", &pair.principal, pair.queries.get("unreadFor").unwrap(), NOW) {
            if r.complete && d.store().raw_rows("members").iter().any(|u| u.field("id").ok().and_then(|v|v.as_str().ok()) == pair.queries["unreadFor"]["member"].as_str()) {
                let key = &e.schema().maintains.iter().find(|m|m.target == "unread").unwrap().row_key.as_ref().unwrap();
                let u = d.store().raw_rows("members").into_iter().find(|u| u.field("id").ok().and_then(|v|v.as_str().ok()) == pair.queries["unreadFor"]["member"].as_str()).unwrap();
                let expected = d.store().raw_rows("messages").iter().filter(|m| !e.schema().tables["messages"].expired(m, NOW) && key.matches(m, &u)).count();
                assert_eq!(r.data, snapback4_core::Value::Int(expected as i64), "certified count is not the device's basis");
            }
        }
        Json::Object(observation)
    });
}
#[test]
fn row_views_replay_every_channel_on_memory_and_sqlite() {
    for pair in [
        cases::old_mark(),
        cases::hidden_conversation(),
        cases::unreadable_key(),
        cases::hidden_interval(),
        cases::hidden_expiry(),
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
