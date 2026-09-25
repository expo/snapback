#[path = "../../snapback4-core/tests/disclosure/generated.rs"]
mod generated;
#[path = "../../snapback4-core/tests/disclosure/cases.rs"]
mod cases;
mod common;
#[path = "../../snapback4-core/tests/disclosure/mod.rs"]
mod disclosure;
use common::*;
use disclosure::*;
use serde_json::{Value as Json, json};
use snapback4_core::ir::ProgramKind;
use snapback4_device::device::{Backend, Device, StreamPage};
fn pair_devices<H: Host>(host: &mut H, pair: &Pair) {
    pair_devices_expect(host, pair, false);
}
fn pair_devices_expect<H: Host>(host: &mut H, pair: &Pair, predicts: bool) {
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
            if predicts { assert!(prediction.is_ok(), "independent owned patch must predict: {prediction:?}"); }
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
fn paired_worlds_replay_every_channel_on_memory_and_sqlite() {
    let filter = std::env::var("DISCLOSURE_FILTER").unwrap_or_default();
    let mut failed = Vec::new();
    let count = generated::visit(|case| {
        if !case.label.contains(&filter) { return; }
        for sqlite in [false,true] {
            let result = std::panic::catch_unwind(|| {
                if sqlite { pair_devices_expect(&mut Sqlite::new("generated"),&case.pair,case.predicts); }
                else { pair_devices_expect(&mut Memory::new(),&case.pair,case.predicts); }
            });
            if result.is_err() { failed.push(format!("{}/{sqlite}",case.label)); }
        }
    });
    eprintln!("generated device pairs: {count} per store; differences: {}",failed.len());
    assert!(failed.is_empty(), "{} generated device pairs differ: {failed:?}",failed.len());
}

#[test]
fn acquiring_an_omitted_private_value_queues_on_both_stores() {
    fn run<H: Host>(host: &mut H) {
        let source = cases::RECORDS.replace("update <- deny", "update <- allow")
            + "\nmutation acquire(id: records):\n  update records[id] { owner: viewer }\n";
        let pair = cases::records(
            source,
            [cases::seed(json!(0)), cases::seed(json!(10))],
            "acquire",
            "target",
        );
        let mut e = pair.engine(0);
        let mut d = host
            .open(
                "acquire",
                Some(Backend {
                    generation: e.generation(),
                    schema: e.schema().clone(),
                    programs: e.programs().cloned().collect(),
                }),
            )
            .unwrap();
        for (n, p) in disclosure::snapshot(&mut e, "alice")
            .into_iter()
            .enumerate()
        {
            d.apply(&serde_json::from_value(p).unwrap(), n == 0)
                .unwrap();
        }
        assert!(d.store().raw_rows("records")[0].field("secret").is_err());
        let error = d
            .predict("acquire", "alice", &json!({"id":"target"}), NOW, vec![], 1)
            .unwrap_err();
        assert_eq!(error.code(), "E_PREDICT");
        let entry = snapback4_device::device::Queued {
            id: "acquire".into(),
            seq: 1,
            op: "acquire".into(),
            args: json!({"id":"target"}),
            viewer: "alice".into(),
            now: NOW,
            new_ids: vec![],
            predicted: vec![],
            predictable: true,
            sent_seq: None,
            receipt_store: None,
            observed_seq: None,
        };
        let queued = d.admit(entry).unwrap();
        assert!(!queued.predictable);
        assert!(queued.predicted.is_empty());
        assert_eq!(d.queued().unwrap().len(), 1);
        assert_eq!(
            d.store().raw_rows("records")[0].field("owner"),
            Ok(&id("bob"))
        );
    }
    run(&mut Memory::new());
    run(&mut Sqlite::new("acquire"));
}

#[test]
fn negated_unknown_delivery_witness_never_authorizes_an_owner_partition() {
    fn run<H: Host>(host: &mut H) {
        let source = r#"
table blocked:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table notes:
  owner: principal
  other: principal
  secret: int default 0 written by .owner
  otherSecret: int default 0 written by .other
  read <- not exists blocked[principal = viewer]
  online only
mutation mark(id: notes):
  update notes[id] { secret: 9 }
  return true
"#;
        let (_, mut backend) = compile(source);
        // An acquired row's audience is trusted; the other owner's online-only
        // witness is unknown. Exercise delivery accounting itself on both stores.
        backend.schema.operations.clear();
        backend.schema.tables.get_mut("notes").unwrap().sync = Some(snapback4_core::schema::Sync {
            audience: snapback4_core::schema::Audience::Public,
            horizon: None,
        });
        let mut d = host.open("negated", Some(backend.clone())).unwrap();
        let page:StreamPage=serde_json::from_value(json!({"snapshot":true,"after":null,"watermark":1,"more":false,"generation":backend.generation,"held":{},"events":[{"kind":"put","table":"notes","id":"note","data":{"id":"note","owner":"alice","other":"bob","secret":1}}]})).unwrap();
        d.apply(&page, true).unwrap();
        assert!(d.store().raw_rows("blocked").is_empty());
        d.predict("mark", "alice", &json!({"id":"note"}), NOW, vec![], 1)
            .unwrap();
    }
    run(&mut Memory::new());
    run(&mut Sqlite::new("negated"));
    // Recipient authorization itself is checked by the core's
    // unknown_negation_does_not_authorize_delivery regression. The prepaid
    // meter now intentionally counts every declared owner slot, known or not.

}

#[test]
fn following_delivers_only_public_derived_images_on_both_stores() {
    let pair = cases::safe_following();
    pair_devices(&mut Memory::new(), &pair);
    pair_devices(&mut Sqlite::new("following-pair"), &pair);
}
