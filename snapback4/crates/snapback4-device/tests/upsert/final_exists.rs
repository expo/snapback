//! Final-exists misses need the same held-group proof as upsert absence.
use super::observation;
use super::super::common::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Value, WriteState, wire};

const SOURCE: &str = r#"
table targets:
  owner: principal
  name: text <=10
  unique byName: name
  by byOwner: owner, name, id
  read <- .owner = viewer
  insert <- .owner = viewer
  sync
table sources:
  owner: principal
  name: text <=10
  unique byOwnerName: owner, name
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  after insert <- exists targets[.name]
  sync
mutation put():
  upsert sources[viewer, 'x'] {}
mutation add():
  insert sources {owner: viewer, name: 'x'}
query one():
  return sources[viewer, 'x']
table ballast:
  marker: bool
  online only
"#;

fn seeded(source: &str, owner: &str, name: Option<&str>) -> (snapback4_core::Engine, snapback4_device::device::Backend) {
    let (mut server, backend) = compile(source);
    // Give every world the same committed seed sequence, including absence.
    let mut rows = vec![("ballast".into(), wire::row_from_json(&server.schema().tables["ballast"], &json!({"id":"ballast", "marker":true})).unwrap())];
    if let Some(name) = name { rows.push(("targets".into(), wire::row_from_json(&server.schema().tables["targets"],
        &json!({"id":"target", "owner":owner, "name":name})).unwrap())); }
    server.seed(rows).unwrap();
    (server, backend)
}

fn unknown_worlds(op: &str, store: usize) {
    let mut worlds = Vec::new();
    for name in [None, Some("other"), Some("x")] {
        let (mut server, _) = seeded(SOURCE, "alice", name);
        let (result, observed) = observation::observe(&mut server, op, "bob", json!({}), "write", ("one", json!({})));
        if name == Some("x") {
            assert!(matches!(result.state, WriteState::Sent { .. }), "{result:?}");
            assert_eq!(observed.devices[store]["settled"]["query"]["data"]["name"], "x");
        } else {
            assert!(matches!(result.state, WriteState::Failed { why, .. } if why.code == "E_CONSTRAINT"));
            assert_eq!(observed.devices[store]["settled"]["query"]["data"], Json::Null);
        }
        worlds.push(observed);
    }
    // The server's postcondition legitimately distinguishes a matching witness.
    // Its absent/nonmatching worlds still agree through receipts and settlement.
    worlds[0].assert_same(&worlds[1]);
    for world in &worlds[1..] {
        for stage in ["initial", "admission", "pending", "reopened"] {
            assert_eq!(worlds[0].devices[store][stage], world.devices[store][stage], "complete pre-settlement {stage}");
        }
    }
    for world in &worlds {
        let device = &world.devices[store];
        assert_eq!(device["admission"]["queued"]["predictable"], false, "store {store}: {}", device["admission"]);
        assert_eq!(device["admission"]["queued"]["predicted"], json!([]));
        assert_eq!(device["initial"]["rows"], device["pending"]["rows"], "no speculative row in any table");
        assert_eq!(device["pending"], device["reopened"], "complete pending state survives reopen");
        assert_eq!(device["pending"]["outbox"].as_array().unwrap().len(), 1);
        assert_eq!(device["settled"]["outbox"], json!([]));
    }
}

#[test]
fn unpinned_upsert_sqlite() { unknown_worlds("put", 0); }
#[test]
fn unpinned_upsert_memory() { unknown_worlds("put", 1); }
#[test]
fn unpinned_insert_sqlite() { unknown_worlds("add", 0); }
#[test]
fn unpinned_insert_memory() { unknown_worlds("add", 1); }

fn held_worlds(op: &str, pinned: bool) {
    let source = if pinned { SOURCE.replace("unique byName: name", "unique byName: owner, name").replace("exists targets[.name]", "exists targets[viewer, .name]") }
        else { SOURCE.to_owned() };
    for present in [false, true] {
        // The unpinned case is the positive-hit control: finding the held row
        // needs no absence proof, even though this key cannot prove a miss.
        if !pinned && !present { continue; }
        let (mut server, _) = seeded(&source, "bob", present.then_some("x"));
        let (result, observed) = observation::observe(&mut server, op, "bob", json!({}), "write", ("one", json!({})));
        for device in &observed.devices {
            if present {
                assert!(matches!(&result.state, WriteState::Sent { .. }), "{result:?}");
                assert_eq!(device["admission"]["queued"]["predictable"], true, "{}", device["admission"]);
                assert_eq!(device["admission"]["queued"]["predicted"], json!(["sources/fresh"]));
                let mut predicted = device["pending"]["query"]["data"].clone();
                assert_eq!(predicted.as_object_mut().unwrap().remove("pending"), Some(json!(true)));
                assert_eq!(predicted, observed.body()["result"]);
                assert_eq!(predicted, device["settled"]["query"]["data"]);
            } else {
                let WriteState::Failed { why, .. } = &result.state else { panic!("{result:?}") };
                assert_eq!(why.code, "E_CONSTRAINT");
                assert_eq!(device["admission"]["refusal"], serde_json::to_value(why).unwrap(), "complete refusal matches the server");
                assert_eq!(device["pending"]["outbox"], json!([]));
                assert_eq!(device["pending"]["query"]["data"], Json::Null);
            }
        }
    }
}

#[test]
fn held_upsert_refusal_and_success_match_server() { held_worlds("put", true); }
#[test]
fn held_insert_refusal_and_success_match_server() { held_worlds("add", true); }
#[test]
fn unpinned_local_hits_still_predict() { held_worlds("put", false); held_worlds("add", false); }

#[test]
fn unknown_prediction_is_e_predict_on_both_stores() {
    fn run<H: Host>(host: &mut H) {
        for op in ["put", "add"] {
            let (mut server, backend) = seeded(SOURCE, "alice", Some("x"));
            let mut device = host.open(op, Some(backend)).unwrap();
            for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
            let error = device.predict(op, "bob", &json!({}), 1000, vec!["fresh".into()], 1).unwrap_err().refusal();
            println!("{} {op}: {}: {}", host.label(), error.code, error.message);
            assert_eq!(error.code, "E_PREDICT");
            assert_eq!(device.query("one", "bob", &json!({}), 1000).unwrap().data, Value::Null);
            host.close(op, device);
        }
    }
    run(&mut Sqlite::new("final-exists")); run(&mut Memory::new());
}
