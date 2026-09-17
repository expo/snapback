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
  cap 50 by room, post
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
            if predicts {
                let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
                let lines = snapback4_lang::bind::residency::operation_lines("vote", &bound.schema.operations["vote"]);
                assert_eq!(lines.lines().next().unwrap(), "  vote: predicts: eligible", "{case}");
                assert_eq!(snapback4_lang::bind::residency::prediction_summary(&bound), None);
            }
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

#[test]
fn insert_if_absent_matches_its_reported_absence_proof_on_both_stores() {
    fn run<H: Host>(host: &mut H) {
        for (case, horizon, cap, predicts) in [
            ("covered", "", "", true), ("window", " last 1 by byPrincipal", "", false),
            ("covered-cap", "", "  cap 50 by principal\n", true), ("hidden-cap", "", "  cap 50 by postId\n", false),
            ("fixed-id", "", "", false), ("public-id", "", "", true),
        ] {
            let source = LIKES.replace("upsert likes[postId, viewer] { on: true }", "insert likes { postId, principal: viewer, on: true } if absent")
                .replace("  sync\n", &format!("{cap}  sync{horizon}\n"));
            let source = if case.ends_with("-id") { source.replace("insert likes { postId", "insert likes { id: 'chosen', postId") } else { source };
            let source = if case == "public-id" { source.replace("read <- .principal = viewer", "read <- public") } else { source };
            let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
            assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
            let lines = snapback4_lang::bind::residency::operation_lines("vote", &bound.schema.operations["vote"]);
            assert_eq!(lines.lines().next().unwrap(), if predicts { "  vote: predicts: eligible" } else { "  vote: predicts: inserts queue without a row — insert if absent into likes cannot prove absence" }, "{case}");
            let (mut server, backend) = compile(&source);
            let mut device = host.open(case, Some(backend)).unwrap();
            for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
            let queued = device.admit(Queued { id: "vote".into(), seq: 1, op: "vote".into(), args: json!({"postId":"first"}), viewer: "bob".into(), now: 1000,
                new_ids: vec!["like".into()], predicted: vec![], predictable: true, sent_seq: None, observed_seq: None }).unwrap();
            assert_eq!(queued.predictable, predicts, "{} {case}: {queued:?}", host.label());
            assert_eq!(queued.predicted.len(), usize::from(predicts));
            host.close(case, device);
        }
    }
    run(&mut Sqlite::new("if-absent-proof"));
    run(&mut Memory::new());
}

#[test]
fn review_supplied_and_minted_ids_match_prediction_on_both_stores() {
    fn run<H: Host>(host: &mut H, mismatches: &mut Vec<String>) {
        for (case, prelude, id_field, public, predicts) in [
            ("parameter", "", "id, ", false, false),
            ("alias", "  chosen = id\n", "id: chosen, ", false, false),
            ("helper", "  chosen = identity(id)\n", "id: chosen, ", false, false),
            ("public-parameter", "", "id, ", true, true),
            ("minted", "", "id: new, ", false, true),
            ("minted-alias", "  chosen = new\n", "id: chosen, ", false, true),
            ("minted-require", "  chosen = new\n  require allowed else NOT_ALLOWED\n", "id: chosen, ", false, true),
            ("minted-read", "  chosen = new\n  previous = likes[postId, viewer]\n", "id: chosen, ", false, true),
            ("minted-emit", "  chosen = new\n  emit notified { postId }\n", "id: chosen, ", false, true),
            ("minted-write", "  chosen = new\n  insert likes { postId: 'other', principal: viewer, on: true }\n", "id: chosen, ", false, true),
            ("minted-branch", "  chosen = new\n  if allowed:\n    require allowed else NOT_ALLOWED\n", "id: chosen, ", false, true),
            ("minted-loop", "  chosen = new\n  for i in range(0, 2):\n    require allowed else NOT_ALLOWED\n", "id: chosen, ", false, true),
            ("other-alias", "  chosen = new\n  other = chosen\n  other = id\n", "id: chosen, ", false, true),
            ("copied-alias", "  chosen = new\n  original = chosen\n  chosen = id\n  chosen = original\n", "id: chosen, ", false, true),
            ("reassigned-alias", "  chosen = new\n  chosen = id\n", "id: chosen, ", false, false),
            ("branch-alias", "  chosen = new\n  if id != null:\n    chosen = id\n", "id: chosen, ", false, false),
            ("else-alias", "  chosen = new\n  if not allowed:\n    require allowed else NOT_ALLOWED\n  else:\n    chosen = id\n", "id: chosen, ", false, false),
            ("loop-alias", "  chosen = new\n  for i in range(0, 2):\n    chosen = id\n", "id: chosen, ", false, false),
            ("nested-alias", "  chosen = new\n  if allowed:\n    for i in range(0, 2):\n      chosen = id\n", "id: chosen, ", false, false),
            ("implicit", "", "", false, true),
        ] {
            let source = LIKES.replace("text <=30", "id")
                .replace("mutation vote(postId: id):", "effect notified\nfn identity(id: id): id\nmutation vote(id: id, postId: id, allowed: bool):")
                .replace("  upsert likes[postId, viewer] { on: true }", &format!("{prelude}  insert likes {{ {id_field}postId, principal: viewer, on: true }} if absent"));
            let source = if public { source.replace("read <- .principal = viewer", "read <- public") } else { source };
            let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
            assert!(bound.diagnostics.is_empty(), "{case}: {:?}", bound.diagnostics);
            let (mut server, backend) = compile(&source);
            let mut device = host.open(case, Some(backend)).unwrap();
            for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
            let input = json!({"id":"chosen", "postId":"first", "allowed":true});
            let queued = device.admit(Queued { id: "vote".into(), seq: 1, op: "vote".into(), args: input.clone(), viewer: "bob".into(), now: 1000,
                new_ids: vec!["minted-like".into(), "other-like".into()], predicted: vec![], predictable: true, sent_seq: None, observed_seq: None }).unwrap();
            assert_eq!(queued.predictable, predicts, "{} {case}: {queued:?}", host.label());
            assert_eq!(queued.predicted.len(), if case == "minted-write" { 2 } else { usize::from(predicts) });
            let pending = device.query("one", "bob", &json!({"postId":"first"}), 1000).unwrap().data;
            assert_eq!(pending != Value::Null, predicts);
            let lines = snapback4_lang::bind::residency::operation_lines("vote", &bound.schema.operations["vote"]);
            let summary = snapback4_lang::bind::residency::prediction_summary(&bound);
            println!("{} {case}: predicted rows={}, summary={summary:?}", host.label(), queued.predicted.len());
            if summary.is_none() != predicts { mismatches.push(format!("{} {case}: {lines}", host.label())); }
            let expected = if predicts { "  vote: predicts: eligible" } else { "  vote: predicts: inserts queue without a row — insert if absent into likes cannot prove absence" };
            if lines.lines().next().unwrap() != expected { mismatches.push(format!("{} {case}: expected {expected}", host.label())); }
            let context = Context::new("bob", args(&[("id", id("chosen")), ("postId", id("first")), ("allowed", Value::Bool(true))]))
                .at(1000).with_ids(["minted-like".into(), "other-like".into()]);
            let sent = server.mutate("vote", Some("vote"), context).unwrap();
            assert!(matches!(sent.state, WriteState::Sent { .. }), "{} {case}: {sent:?}", host.label());
            if predicts {
                let mut image = pending.as_object().unwrap().clone(); image.remove("pending");
                let confirmed = server.query("one", Context::new("bob", args(&[("postId", id("first"))])).at(1000)).unwrap().data;
                assert_eq!(Value::Row(image.into()), confirmed, "{} {case}", host.label());
            }
            host.close(case, device);
        }
    }
    let mut mismatches = Vec::new();
    run(&mut Sqlite::new("review-id-proof"), &mut mismatches);
    run(&mut Memory::new(), &mut mismatches);
    assert!(mismatches.is_empty(), "binder/runtime mismatches:\n{}", mismatches.join("\n"));
}
