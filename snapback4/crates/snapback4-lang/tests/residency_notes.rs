//! LLP 3000.007 §20: L12 final-check, L10a maintain sync and M6 fanout.
use snapback4_lang::{compile, Bound};
use snapback4_core::{Context, Engine, Store, wire};
use serde_json::json;
const SOURCE: &str = include_str!("fixtures/residency-notes.q");
fn bind(source: &str) -> Bound { compile(&[("schema.q".into(), source.into())]) }
fn clean(source: &str) -> Bound {
    let b = bind(source);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn online() -> String { SOURCE.replace("  read <- allow", "  read <- allow\n  online only") }

#[test]
fn maintain_note_names_readers_before_they_lose_prediction() {
    let b = clean(SOURCE);
    let note = b.notes.iter().find(|n| n.code == "N_MAINTAIN_SYNCED").unwrap();
    println!("{note}");
    assert!(note.message.contains("one value row per postId reaches every device"));
    assert!(note.message.contains("createPost, like, repost would stop predicting if likeCounts goes `online only`"), "{note}");
    assert!(note.rewrite.contains("snapback4 test --residency"));
    for name in ["like", "createPost", "repost"] { assert_eq!(b.schema.operations[name].predicts.as_deref(), Some("eligible")); }
    let off = clean(&online());
    for name in ["like", "createPost", "repost"] { assert_eq!(off.schema.operations[name].predicts.as_deref(), Some("never")); }
}

#[test]
fn maintain_sync_explains_inheritance_and_both_valid_choices() {
    let b = bind(&SOURCE.replace("  read <- allow", "  read <- allow\n  sync"));
    assert_eq!(b.diagnostics.len(), 1);
    let d = &b.diagnostics[0];
    println!("{d}");
    assert_eq!(d.message, "a maintain inherits its source's sync; `online only` opts out");
    assert_eq!(d.rewrite, "remove this sync line to inherit, or replace it with `online only`");
    clean(SOURCE);
    clean(&online());
}

#[test]
fn predicts_assertion_accepts_eligible_and_refuses_server_at_header() {
    let asserted = SOURCE.replace("mutation like(postId: id):", "mutation like(postId: id) predicts:");
    let b = clean(&asserted);
    assert_eq!(b.schema.operations["like"].predicts.as_deref(), Some("eligible"));
    let b = bind(&asserted.replace("  read <- allow", "  read <- allow\n  online only"));
    assert_eq!(b.diagnostics.len(), 1, "{:?}", b.diagnostics);
    let d = &b.diagnostics[0];
    println!("{d}");
    assert_eq!(d.code, "E_NOT_PREDICTABLE");
    assert_eq!((d.site.line, d.site.col), (14, 1));
    assert_eq!(d.message, "mutation like asserts predicts, but reads online-only maintain likeCounts");
    assert!(d.rewrite.contains("remove `online only` from maintain likeCounts"));
    assert_eq!(d.guide, "prediction");
}

#[test]
fn horizon_guard_remains_eligible_and_effect_only_presence_can_assert() {
    let source = snapback4_lang::guide::card("prediction").unwrap();
    assert!(source.contains("mutation notifyPost(body: text <=200, recipient: principal) predicts:"));
    assert!(source.contains("mutation saveDraft(id: drafts, body: text <=200) predicts:"));
    let source = snapback4_lang::guide::quarry(source).into_iter().next().unwrap();
    let b = clean(&source);
    assert_eq!(b.schema.operations["guardedPost"].predicts.as_deref(), Some("eligible"));
    let lines = snapback4_lang::bind::residency::operation_lines("guardedPost", &b.schema.operations["guardedPost"]);
    assert!(lines.contains("may queue without a row past the horizon"));
    assert_eq!(b.schema.operations["notifyPost"].predicts.as_deref(), Some("eligible"));
}

const FANOUT: &str = "table members:\n  room: id\n  principal: principal\n  by byRoom: room, id\n  cap 50 by room\n  public 'roster'\n  sync\neffect notify\nmutation send(room: id):\n  recipients = []\n  for m in members[room] first 50 by byRoom:\n    if m.principal != viewer:\n      recipients = recipients + [m.principal]\n  for p in recipients:\n    emit notify { recipient: p }\n";
#[test]
fn accumulated_recipient_list_fanout_is_located_and_has_a_concrete_rewrite() {
    let b = bind(FANOUT);
    assert_eq!(b.diagnostics.len(), 1, "{:?}", b.diagnostics);
    let d = &b.diagnostics[0];
    println!("{d}");
    assert_eq!(d.code, "E_STRUCTURAL_FANOUT");
    assert_eq!((d.site.line, d.site.col), (14, 3));
    assert!(!d.message.contains('$') && !d.message.contains("E_STRUCTURAL_FANOUT"), "{d}");
    assert!(d.message.contains("recipients") && d.message.contains("members") && d.message.contains("50"), "{d}");
    assert_ne!(d.message, d.rewrite);
    assert!(d.rewrite.contains("members[room] first 50 by byRoom"), "{d}");
    let fixed = FANOUT.replace("  recipients = []\n", "").replace("      recipients = recipients + [m.principal]\n  for p in recipients:\n    emit notify { recipient: p }", "      emit notify { recipient: m.principal }");
    let b = clean(&fixed);
    assert_eq!(b.schema.operations["send"].predicts.as_deref(), Some("eligible"));
    let mut e = Engine::new(Store::memory().unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([("members".into(), wire::row_from_json(&e.schema().tables["members"], &json!({"id":"m1", "room":"r", "principal":"bob"})).unwrap())]).unwrap();
    let result = e.mutate("send", Some("send-1"), Context::new("alice", [("room".into(), snapback4_core::Value::Id("r".into()))].into())).unwrap();
    assert!(matches!(result.state, snapback4_core::WriteState::Sent { .. }));
}

// Two loops may reuse a binding name; the diagnostic must locate the loop
// that fails admission, not the first loop with that name.
#[test]
fn a_reused_loop_binding_locates_the_failing_loop() {
    let source = "table members:\n  room: id\n  principal: principal\n  by byRoom: room, id\n  cap 50 by room\n  public 'roster'\n  sync\neffect notify\nmutation send(room: id):\n  recipients = []\n  for m in members[room] first 50 by byRoom:\n    if m.principal != viewer:\n      recipients = recipients + [m.principal]\n  for p in recipients:\n    emit notify { recipient: p }\n  for p in members[room] first 50 by byRoom:\n    emit notify { recipient: p.principal }\n";
    let b = bind(source);
    assert_eq!(b.diagnostics.len(), 1, "{:?}", b.diagnostics);
    let d = &b.diagnostics[0];
    println!("{d}");
    assert_eq!(d.code, "E_STRUCTURAL_FANOUT");
    assert_eq!((d.site.line, d.site.col), (14, 3), "{d}");
    assert!(d.message.contains("recipients"), "{d}");
}

#[test]
fn wide_matching_merge_note_is_conditional_when_the_read_completes() {
    let source = format!("{}\nquery searchAll(q: text <=100, c: cursor ?):\n  return merge messages matching q after c last 20 by byRoomWords:\n    [m.roomId] for m in members[viewer] first 1000 by byPrincipalRoom\n", include_str!("../../snapback4-sim/tests/search_merge/schema.q"));
    let b = clean(&source);
    let mut e = Engine::new(Store::memory().unwrap(), b.schema.clone(), b.programs.iter().map(|p| p.program.clone())).unwrap();
    let rows = [("members", json!({"id":"member", "roomId":"r", "principal":"alice"})),
        ("messages", json!({"id":"message", "roomId":"r", "body":"hello", "at":1}))];
    e.seed(rows.into_iter().map(|(table, row)| (table.into(), wire::row_from_json(&b.schema.tables[table], &row).unwrap()))).unwrap();
    let read = e.query("searchAll", Context::new("alice", [("q".into(), snapback4_core::Value::String("hello".into())), ("c".into(), snapback4_core::Value::Null)].into())).unwrap();
    assert!(read.complete);
    assert_eq!(read.data.as_array().unwrap().len(), 1);
    println!("wide merge measured: {} rows examined, complete={}", read.metered.examined, read.complete);
    let note = b.notes.iter().find(|n| n.code == "N_WIDE_MERGE" && n.message.contains("searchAll")).unwrap();
    println!("{note}");
    assert!(note.message.contains("up to 21000 rows per read"), "{note}");
    assert!(note.message.contains("a read past the 8,192 examined ceiling returns `complete: false`"), "{note}");
    assert!(!note.message.contains("the page is cut"));
    assert!(note.rewrite.contains("snapback4 test --cost"));
}

#[test]
fn fanout_read_and_small_page_name_the_source_and_a_passing_rewrite() {
    let base = "table members:\n  room: id\n  owner: principal\n  by byRoom: room, id\n  cap 50 by room\n  read <- .owner = viewer\n";
    let b = bind(&format!("{base}mutation send(room: id): server\n  rows = members[room] first 10 by byRoom\n  return count(rows)\n"));
    let d = &b.diagnostics[0];
    println!("{d}");
    assert_eq!((d.site.line, d.site.col), (8, 10));
    assert!(d.message.contains("members by byRoom (page bound 10)"));
    assert!(d.rewrite.contains("pin .owner") && d.rewrite.contains("members[owner = row.owner]"), "{d}");
    clean(&format!("{base}query send(room: id):\n  rows = members[room] first 10 by byRoom\n  return count(rows)\n"));
    let base = base.replace("  read <- .owner = viewer", "  public 'roster'\n  sync");
    let b = bind(&format!("{base}mutation send(room: id):\n  for m in members[room] first 10 by byRoom:\n    require m.room = room else WRONG_ROOM\n"));
    let d = &b.diagnostics[0];
    println!("{d}");
    assert_eq!((d.site.line, d.site.col), (9, 3));
    assert!(d.message.contains("page bound 10") && d.message.contains("schema cap 50"));
    assert!(d.rewrite.contains("members[room] first 50 by byRoom"));
    clean(&format!("{base}mutation send(room: id):\n  for m in members[room] first 50 by byRoom:\n    require m.room = room else WRONG_ROOM\n"));
}

#[test]
fn core_fanout_refusal_does_not_repeat_code_or_message() {
    let b = clean(&FANOUT.replace("mutation send(room: id):", "mutation send(room: id): server").replace("  for p in recipients:\n    emit notify { recipient: p }", "  return null"));
    let mut schema = b.schema.clone();
    schema.operations.get_mut("send").unwrap().predicts = Some("eligible".into());
    schema.tables.get_mut("members").unwrap().constraints.clear();
    let why = snapback4_core::engine::admission::check(&schema, &b.programs[0].program).unwrap_err().refusal();
    println!("core fanout: {} / {}", why.message, why.rewrite.as_deref().unwrap());
    assert_eq!(why.code, "E_STRUCTURAL_FANOUT");
    assert!(!why.message.contains("E_STRUCTURAL_FANOUT"));
    assert_ne!(Some(&why.message), why.rewrite.as_ref());
}

#[test]
fn predicts_assertion_refuses_online_writes_and_explicit_server_but_keeps_horizons() {
    for (source, reason) in [
        ("table ranked:\n  score: int\n  read <- allow\n  insert <- allow\nmutation createPost() predicts:\n  insert ranked { score: 1 }\n", "writes online-only table ranked"),
        ("mutation dispatch() predicts: server\n  return null\n", "author marked this mutation : server"),
        ("mutation present(p: principal) predicts:\n  return connected[p]\n", "connected"),
    ] {
        let b = bind(source);
        assert_eq!(b.diagnostics.len(), 1, "{:?}", b.diagnostics);
        assert_eq!(b.diagnostics[0].code, "E_NOT_PREDICTABLE");
        assert!(b.diagnostics[0].message.contains(reason));
        clean(&source.replace(" predicts:", ":"));
    }
    let source = snapback4_lang::guide::quarry(snapback4_lang::guide::card("prediction").unwrap()).remove(0);
    let b = clean(&source.replace("mutation guardedPost(id: notes, body: text <=200):", "mutation guardedPost(id: notes, body: text <=200) predicts:"));
    assert_eq!(b.schema.operations["guardedPost"].predicts.as_deref(), Some("eligible"));
}

// Reduced from 0.2.16 m8-feed-check.txt: byEvent omits the private rule's readerId.
#[test]
fn feed_removal_fanout_names_the_private_deciding_column_and_loop() {
    let source = "table follows:\n  followerId: principal\n  followedId: principal\n  by byFollowed: followedId, followerId\n  cap 1000 by followedId\n  public 'follow graph'\ntable feedEntries:\n  readerId: principal\n  actorId: principal\n  eventId: id\n  by byEvent: eventId, id\n  unique byReaderEvent: readerId, eventId\n  read <- .readerId = viewer\n  delete <- .actorId = viewer\nmutation removeEvent(actorId: principal, eventId: id):\n  for row in feedEntries[eventId] first 10000 by byEvent:\n    delete feedEntries[row]\n";
    let b = bind(source);
    assert_eq!(b.diagnostics.len(), 1, "{:?}", b.diagnostics);
    let d = &b.diagnostics[0];
    println!("{d}");
    assert_eq!(d.code, "E_STRUCTURAL_FANOUT");
    assert!(d.rewrite.contains(".readerId"), "{d}");
    assert!(d.rewrite.contains("for f in follows[actorId] first 1000 by byFollowed"), "{d}");
    assert!(d.rewrite.contains("readerId = f.followerId"), "{d}");
    clean(&source.replace("  for row in feedEntries[eventId] first 10000 by byEvent:\n    delete feedEntries[row]", "  for f in follows[actorId] first 1000 by byFollowed:\n    if exists feedEntries[f.followerId, eventId]:\n      delete feedEntries[f.followerId, eventId]"));
}

#[test]
fn never_predict_change_notes_group_distinct_roots_once_per_mutation() {
    let source = include_str!("fixtures/never-predict.q");
    let after = clean(source);
    let before = clean(&source.replace("  online only", "  sync public last 1000 by byId").replace("maintain likeCounts: count likes by postId\n  read <- allow\n  sync public last 1000 by byId", "maintain likeCounts: count likes by postId\n  read <- allow"));
    for name in ["createPost", "like", "repost"] { assert_eq!(before.schema.operations[name].predicts.as_deref(), Some("eligible")); }
    let notes = snapback4_lang::bind::residency::change_notes(&after, &before.schema.operations);
    for note in &notes { println!("{note}"); }
    assert_eq!(notes.len(), 3, "one per mutation");
    for name in ["createPost", "like", "repost"] {
        let note = notes.iter().find(|n| n.message.starts_with(&format!("{name} "))).unwrap();
        assert_eq!(note.code, "N_NOT_PREDICTABLE");
        assert_eq!(note.message.matches("online-only table insightFacts").count(), 1, "{note}");
        if name != "repost" {
            assert_eq!(note.message.matches("online-only maintain likeCounts").count(), 1, "{note}");
            assert_eq!(note.message.matches("online-only table rankedPosts").count(), 1, "{note}");
        }
        assert_eq!(note.rewrite.matches("sync insightFacts").count(), 1);
    }
    assert!(snapback4_lang::bind::residency::change_notes(&after, &after.schema.operations).is_empty());
}

#[test]
fn fanout_rewrite_lists_all_unpinned_rule_columns() {
    let source = "table rows:\n  owner: principal\n  room: text <=20\n  by byRoom: room, id\n  read <- .owner = viewer and .room != 'blocked'\nmutation inspect(): server\n  return rows first 10 by byRoom\n";
    let b = bind(source);
    assert_eq!(b.diagnostics.len(), 1);
    assert!(b.diagnostics[0].rewrite.contains("pin .owner, .room"), "{}", b.diagnostics[0]);
    let b = bind(&source.replace("inspect()", "inspect(room: text <=20)").replace("rows first", "rows[room] first"));
    assert!(b.diagnostics[0].rewrite.contains("pin .owner in"), "{}", b.diagnostics[0]);
    let fixed = source.replace("  by byRoom: room, id", "  by byRoom: owner, room, id").replace("inspect()", "inspect(room: text <=20)").replace("rows first", "rows[viewer, room] first");
    let b = clean(&fixed);
    let mut e = Engine::memory(b.schema.clone(), b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([("rows".into(), wire::row_from_json(&b.schema.tables["rows"], &json!({"id":"a", "owner":"alice", "room":"room"})).unwrap())]).unwrap();
    let result = e.mutate("inspect", None, Context::new("alice", [("room".into(), snapback4_core::Value::String("room".into()))].into())).unwrap();
    assert!(matches!(result.state, snapback4_core::WriteState::Sent { result, .. } if result.as_array().unwrap().len() == 1));
}

#[test]
fn horizon_change_notes_keep_distinct_indexes_and_deduplicate_sites() {
    let base = "table rows:\n  owner: principal\n  other: id\n  unique byOther: other\n  by byOwner: owner, id\n  read <- .owner = viewer\n  sync to .owner\nmutation inspect(id: rows, other: id):\n  return { first: rows[id], again: rows[id], other: rows[other] by byOther }\n";
    let before = clean(base);
    let after = clean(&base.replace("sync to .owner", "sync to .owner last 10 by byOwner"));
    let notes = snapback4_lang::bind::residency::change_notes(&after, &before.schema.operations);
    assert_eq!(notes.len(), 1);
    assert!(notes[0].message.contains("remains eligible"));
    assert!(notes[0].message.contains("by byId") && notes[0].message.contains("by byOther"));
    assert_eq!(notes[0].rewrite.matches("remove a redundant guard").count(), 1);
}

#[test]
fn pinning_a_private_reader_admits_the_page_without_granting_authority() {
    let source = "table follows:\n  followerId: principal\n  followedId: principal\n  by byFollowed: followedId, followerId\n  cap 1000 by followedId\n  public 'follow graph'\ntable feedEntries:\n  readerId: principal\n  actorId: principal\n  eventId: id\n  unique byReaderEvent: readerId, eventId\n  read <- .readerId = viewer\n  delete <- .actorId = viewer\nmutation removeEvent(actorId: principal, eventId: id):\n  for f in follows[actorId] first 1000 by byFollowed:\n    for row in feedEntries[f.followerId] first 1000 by byReaderEvent:\n      delete feedEntries[row]\nmutation byKey(readerId: principal, eventId: id):\n  delete feedEntries[readerId, eventId]\nquery own():\n  return feedEntries[viewer] first 1000 by byReaderEvent\n";
    let b = clean(source);
    let mut e = Engine::memory(b.schema.clone(), b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([
        ("follows".into(), wire::row_from_json(&b.schema.tables["follows"], &json!({"id":"f", "followerId":"bob", "followedId":"alice"})).unwrap()),
        ("feedEntries".into(), wire::row_from_json(&b.schema.tables["feedEntries"], &json!({"id":"entry", "readerId":"bob", "actorId":"alice", "eventId":"event"})).unwrap()),
    ]).unwrap();
    let args = [("actorId".into(), snapback4_core::Value::Id("alice".into())), ("eventId".into(), snapback4_core::Value::Id("event".into()))].into();
    let write = e.mutate("removeEvent", None, Context::new("alice", args)).unwrap();
    assert!(matches!(write.state, snapback4_core::WriteState::Sent { .. }));
    assert_eq!(write.metered.rows_written, 0, "uniform-false inboxes are unreadable to the actor");
    assert_eq!(e.store().rows("feedEntries").unwrap().len(), 1);
    let args = [("readerId".into(), snapback4_core::Value::Id("bob".into())), ("eventId".into(), snapback4_core::Value::Id("event".into()))].into();
    let write = e.mutate("byKey", None, Context::new("alice", args)).unwrap();
    assert!(matches!(write.state, snapback4_core::WriteState::Failed { why, .. } if why.code == "NOT_FOUND"));
    for (viewer, count) in [("alice", 0), ("bob", 1)] {
        let read = e.query("own", Context::new(viewer, Default::default())).unwrap();
        assert!(read.complete);
        assert_eq!(read.data.as_array().unwrap().len(), count);
    }
}
