#[path = "../../snapback4-core/tests/paired_worlds/sequences.rs"]
mod cases;
mod common;
#[path = "../../snapback4-core/tests/paired_worlds/mod.rs"]
mod paired_worlds;
use common::*;
use paired_worlds::*;
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
                        schema: e.schema().clone(),
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
