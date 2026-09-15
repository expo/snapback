//! First offline reactions and the hidden-target boundary, on both stores.
use super::common::*;
use serde_json::json;
use snapback4_core::{Context, Value, WriteState, wire};
use snapback4_device::device::Queued;

#[path = "../../../snapback4-sim/tests/common/write_observation.rs"]
mod observation;

const LIKES: &str = r#"
table likes:
  postId: text <=30
  principal: principal
  on: bool
  unique byPostPrincipal: postId, principal
  by byPrincipal: principal, postId, id
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  sync
query one(postId: text <=30):
  return likes[postId, viewer]
mutation vote(postId: text <=30):
  upsert likes[postId, viewer] { on: true }
"#;

#[test]
fn a_pinned_membership_read_needs_a_positive_witness_for_its_group() {
    let source = r#"
table members:
  room: text <=30
  principal: principal
  unique byRoomPrincipal: room, principal
  by byPrincipalRoom: principal, room, id
  immutable room, principal
  read <- .principal = viewer
  sync
table likes:
  room: text <=30
  post: text <=30
  principal: principal
  on: bool
  unique byRoomPostPrincipal: room, post, principal
  read <- exists members[.room, viewer]
  insert <- .principal = viewer
  update <- allow
  sync
mutation vote(room: text <=30):
  upsert likes[room, 'first', viewer] {on: true}
query one(room: text <=30):
  return likes[room, 'first', viewer]
"#;
    fn run<H: Host>(host: &mut H, source: &str) {
        for (room, predicts) in [("held", true), ("unheld", false)] {
            let (mut server, backend) = compile(source);
            let member = wire::row_from_json(&server.schema().tables["members"], &json!({"id":"member","room":"held","principal":"bob"})).unwrap();
            server.seed([("members".into(), member)]).unwrap();
            let mut device = host.open(room, Some(backend)).unwrap();
            for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
            let input = json!({"room":room});
            let queued = device.admit(Queued { id: "vote".into(), seq: 1, op: "vote".into(), args: input.clone(), viewer: "bob".into(), now: 1000, new_ids: vec!["like".into()], predicted: vec![], predictable: true, sent_seq: None, observed_seq: None }).unwrap();
            assert_eq!(queued.predictable, predicts, "{room}: {queued:?}");
            assert_eq!(queued.predicted.len(), usize::from(predicts));
            assert_eq!(device.query("one", "bob", &input, 1000).unwrap().data != Value::Null, predicts);
            let sent = server.mutate("vote", Some("vote"), Context::new("bob", args(&[("room", Value::String(room.into()))])).at(1000).with_ids(["like".into()])).unwrap();
            assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
            if predicts {
                let row = device.query("one", "bob", &input, 1000).unwrap().data;
                let mut fields = row.as_object().unwrap().clone(); fields.remove("pending");
                assert_eq!(Value::Row(fields.into()), server.store().rows("likes").unwrap()[0]);
            }
            host.close(room, device);
        }
    }
    run(&mut Sqlite::new("membership-upsert"), source);
    run(&mut Memory::new(), source);
}

#[test]
fn the_feeds_card_predicts_its_first_vote_on_both_stores() {
    let source = snapback4_lang::guide::quarry(snapback4_lang::guide::card("feeds").unwrap()).into_iter().find(|block| block.contains("mutation vote(")).unwrap();
    fn run<H: Host>(host: &mut H, source: &str) {
        let (mut server, backend) = compile(source);
        let post = wire::row_from_json(&server.schema().tables["posts"], &json!({"id":"post","authorId":"bob","body":"first","at":1000})).unwrap();
        server.seed([("posts".into(), post)]).unwrap();
        let mut device = host.open("feeds", Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        let input = json!({"postId":"post","direction":1});
        let predicted = device.predict("vote", "bob", &input, 1000, vec!["vote".into()], 1).unwrap();
        // The online-only score is a server side effect; the source vote still predicts.
        assert_eq!(predicted.predicted, vec!["votes/vote".to_owned()]);
        let sent = server.mutate("vote", Some("vote"), Context::new("bob", args(&[("postId", id("post")), ("direction", Value::Int(1))])).at(1000).with_ids(["vote".into()])).unwrap();
        assert!(matches!(sent.state, WriteState::Sent { .. }));
        host.close("feeds", device);
    }
    run(&mut Sqlite::new("feeds-vote"), &source);
    run(&mut Memory::new(), &source);
}

#[test]
fn first_offline_upsert_predicts_only_when_absence_is_provable_on_both_stores() {
    fn run<H: Host>(host: &mut H) {
        for (case, source, predicts) in [
            ("owner", LIKES.to_owned(), true),
            ("public", LIKES.replace("read <- .principal = viewer", "read <- public"), true),
            ("horizon", LIKES.replace("  sync\n", "  sync last 1 by byPrincipal\n"), false),
            ("unpinned", LIKES.replace("unique byPostPrincipal: postId, principal", "unique byPostPrincipal: postId").replace("likes[postId, viewer]", "likes[postId]").replace("{ on: true }", "{ principal: viewer, on: true }"), false),
            ("online", LIKES.replace("  sync\n", "  online only\n"), false),
        ] {
            let (mut server, backend) = compile(&source);
            let mut device = host.open(case, Some(backend)).unwrap();
            for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
            let input = json!({"postId":"first"});
            let entry = Queued { id: "vote".into(), seq: 1, op: "vote".into(), args: input.clone(), viewer: "bob".into(), now: 1000, new_ids: vec!["like".into()], predicted: vec![], predictable: true, sent_seq: None, observed_seq: None };
            let queued = device.admit(entry).unwrap();
            assert_eq!(queued.predictable, predicts, "{} {case}: {queued:?}", host.label());
            assert_eq!(queued.predicted.len(), usize::from(predicts));
            let pending = device.query("one", "bob", &input, 1000).unwrap().data;
            assert_eq!(pending != Value::Null, predicts, "{case}");
            host.close(case, device);
            let mut device = host.open(case, None).unwrap();
            assert_eq!(device.queued().unwrap(), vec![queued]);
            assert_eq!(device.query("one", "bob", &input, 1000).unwrap().data, pending);
            let context = Context::new("bob", args(&[("postId", Value::String("first".into()))])).at(1000).with_ids(["like".into()]);
            let sent = server.mutate("vote", Some("vote"), context.clone()).unwrap();
            let WriteState::Sent { seq, .. } = sent.state else { panic!("{sent:?}") };
            let confirmed = server.query("one", context).unwrap().data;
            if predicts {
                assert_eq!(pending.field("pending"), Ok(&Value::Bool(true)));
                let mut image = pending.as_object().unwrap().clone();
                image.remove("pending");
                assert_eq!(Value::Row(image.into()), confirmed, "the row's application fields are identical to the server's");
            }
            device.settle("vote", Some(seq)).unwrap();
            device.apply(&stream_page(&mut server, "bob", device.state().unwrap().0), false).unwrap();
            assert!(device.queued().unwrap().is_empty());
            if case != "online" { assert_eq!(device.query("one", "bob", &input, 1000).unwrap().data, confirmed); }
            host.close(case, device);
        }
    }
    run(&mut Sqlite::new("first-like"));
    run(&mut Memory::new());
}

#[test]
fn hidden_admitted_upserts_preserve_the_complete_paired_observation() {
    let source = LIKES.replace("unique byPostPrincipal: postId, principal", "unique byPostPrincipal: postId")
        .replace("likes[postId, viewer]", "likes[postId]")
        .replace("update <- .principal = viewer", "update <- allow");
    let mut pair = Vec::new();
    for secret in ["alice", "carol"] {
        let (mut server, _) = compile(&source);
        let row = wire::row_from_json(&server.schema().tables["likes"], &json!({"id":"hidden","postId":"first","principal":secret,"on":false})).unwrap();
        server.seed([("likes".into(), row)]).unwrap();
        let (sent, observed) = observation::observe(&mut server, "vote", "bob", json!({"postId":"first"}), "same", ("one", json!({"postId":"first"})));
        assert!(matches!(sent.state, WriteState::Sent { .. }));
        for device in &observed.devices {
            assert_eq!(device["admission"]["queued"]["predictable"], false);
            assert_eq!(device["admission"]["queued"]["predicted"], json!([]));
            for stage in ["initial", "pending", "reopened", "settled"] { assert_eq!(device[stage]["query"]["data"], json!(null)); }
        }
        pair.push(observed);
    }
    pair[0].assert_same(&pair[1]);
}

mod proof;
mod final_exists;
