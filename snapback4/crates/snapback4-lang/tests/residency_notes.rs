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
    assert!(!note.message.contains("follow count"), "room memberships are not a follows-shaped read: {note}");
    assert!(note.rewrite.contains("snapback4 check --cost"));
}

#[test]
fn w7d_wide_membership_search_points_to_the_complete_walk() {
    let source = format!("{}\nquery searchAll(q: text <=100, c: cursor ?):\n  return merge messages matching q after c last 20 by byRoomWords:\n    [m.roomId] for m in members[viewer] first 1000 by byPrincipalRoom\n", include_str!("../../snapback4-sim/tests/search_merge/schema.q"));
    let b = clean(&source);
    let note = b.notes.iter().find(|n| n.code == "N_WIDE_MERGE").unwrap();
    println!("{note}");
    assert_eq!(note.to_string(), "schema.q:32:1 — N_WIDE_MERGE: query searchAll: the merge over messages reads up to 1000 lanes, one page of 21 each — up to 21000 rows per read; a read past the 8,192 examined ceiling returns `complete: false`\n  rewrite: `snapback4 guide search`, section \"Search every chat I'm in\": search held messages with one unscoped words index, or page memberships 50 at a time and exhaust each matching merge with its own result cursor before advancing the membership cursor; a result cursor alone does not continue undiscovered chats or a meter-cut merge. Measure with `snapback4 check --cost`; if a held query answers this read, delete the merge\n  guide: search");
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
        assert!(!note.message.contains("programs."), "{note}");
        assert!(!note.message.contains("sites: insert ") && !note.message.contains("sites: delete ") && !note.message.contains(", upsert "), "{note}");
        assert!(note.message.contains("schema.q:36:3"), "the helper's insert source: {note}");
        if name != "createPost" { assert!(note.message.contains("schema.q:40:5"), "the helper's delete source: {note}"); }
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

#[test]
fn calibration_capped_members_page_needs_no_cursor_note() {
    let prefix = "table members:\n  conversationId: id\n  principal: principal\n  unique byConversationPrincipal: conversationId, principal\n  cap 50 by conversationId\n  public 'roster'\n";
    for (take, cursor_note) in [(49, true), (50, false), (51, false)] {
        let source = format!("{prefix}query settings(conversationId: id):\n  return members[conversationId] first {take} by byConversationPrincipal\n");
        let b = clean(&source);
        for n in &b.notes { println!("{n}"); }
        assert_eq!(b.notes.iter().any(|n| n.code == "N_NO_CURSOR"), cursor_note, "take {take}");
    }
    let unpinned = clean(&format!("{prefix}query settings():\n  return members first 50 by byConversationPrincipal\n"));
    assert!(unpinned.notes.iter().any(|n| n.code == "N_NO_CURSOR"));
}

#[test]
fn capped_page_cursor_note_respects_default_examined_ceiling() {
    let source = |cap, cursor| format!("table rows:\n  owner: principal\n  by byOwner: owner, id\n  cap {cap} by owner\n  public 'bounded rows'\nquery list({}):\n  return rows[viewer] {}first {cap} by byOwner\n", if cursor { "c: cursor ?" } else { "" }, if cursor { "after c " } else { "" });
    let b = clean(&source(9000, false));
    let mut e = Engine::memory(b.schema.clone(), b.programs.iter().map(|p| p.program.clone())).unwrap();
    e.seed((0..9000).map(|n| ("rows".into(), wire::row_from_json(&b.schema.tables["rows"], &json!({"id":format!("r{n:04}"), "owner":"alice"})).unwrap()))).unwrap();
    let read = e.query("list", Context::new("alice", Default::default())).unwrap();
    println!("capped page: cap=9000 returned={} examined={} complete={} next={}", read.data.as_array().unwrap().len(), read.metered.examined, read.complete, read.next.is_some());
    assert!(!read.complete);
    assert!(read.next.is_none());
    let paged = clean(&source(9000, true));
    e.adopt(paged.schema, paged.programs.into_iter().map(|p| p.program)).unwrap();
    let first = e.query("list", Context::new("alice", [("c".into(), snapback4_core::Value::Null)].into())).unwrap();
    let next = first.next.clone().expect("a cursor can continue a meter-cut page");
    let second = e.query("list", Context::new("alice", [("c".into(), snapback4_core::Value::String(next))].into())).unwrap();
    assert!(second.complete);
    assert_eq!(first.data.as_array().unwrap().len() + second.data.as_array().unwrap().len(), 9000);
    println!("capped continuation: first={} second={} total=9000", first.data.as_array().unwrap().len(), second.data.as_array().unwrap().len());
    for (cap, expected) in [(9000, true), (8191, false), (8192, false), (8193, true)] {
        let b = clean(&source(cap, false));
        let note = b.notes.iter().find(|n| n.code == "N_NO_CURSOR");
        if let Some(note) = note { println!("{note}"); }
        assert_eq!(note.is_some(), expected, "cap {cap}");
    }
}

#[test]
fn calibration_presence_refusal_names_source_read_without_internal_paths() {
    let source = "table profiles:\n  principal: principal\n  unique byPrincipal: principal\n  displayName: text <=100\n  public 'profiles'\n  sync\neffect notify\nmutation send(recipient: principal) predicts:\n  if not exists connected[recipient]:\n    emit notify { senderDisplayName: profiles[viewer].displayName }\n";
    let b = compile(&[("chat.q".into(), source.into())]);
    let d = &b.diagnostics[0];
    println!("{d}");
    assert_eq!(d.code, "E_NOT_PREDICTABLE");
    assert!(d.message.contains("connected[recipient]") && d.message.contains("chat.q:9:17"), "{d}");
    assert!(!d.to_string().contains("programs.") && !d.to_string().contains('$'), "{d}");
    let fixed = source.replace("  if not exists connected[recipient]:\n    emit notify { senderDisplayName: profiles[viewer].displayName }", "  senderName = profiles[viewer].displayName\n  if not exists connected[recipient]:\n    emit notify { senderDisplayName: senderName }");
    let good = compile(&[("chat.q".into(), fixed)]);
    assert!(good.diagnostics.is_empty(), "{:?}", good.diagnostics);
    assert_eq!(good.schema.operations["chat.send"].predicts.as_deref(), Some("eligible"));
    let unasserted = compile(&[("chat.q".into(), source.replace(" predicts:", ":"))]);
    let summary = snapback4_lang::bind::residency::prediction_summary(&unasserted).unwrap();
    assert!(!summary.contains("programs.") && summary.contains("chat.q:9:17"), "{summary}");
    for note in snapback4_lang::bind::residency::change_notes(&unasserted, &good.schema.operations) {
        assert!(!note.to_string().contains("programs."), "{note}");
    }
}

#[test]
fn calibration_merge_of_capped_groups_still_needs_a_cursor() {
    let source = "table members:\n  conversationId: id\n  principal: principal\n  unique byConversationPrincipal: conversationId, principal\n  cap 50 by conversationId\n  public 'roster'\nquery settings():\n  return merge members first 50 by byConversationPrincipal:\n    ['one']\n    ['two']\n";
    let b = clean(source);
    assert!(b.notes.iter().any(|n| n.code == "N_NO_CURSOR"), "two groups can have 100 rows: {:?}", b.notes);
}


const REACTIONS: &str = "table members:\n  conversationId: id\n  principal: principal\n  unique byConversationPrincipal: conversationId, principal\n  by byPrincipalConversation: principal, conversationId, id\n  immutable conversationId, principal\n  read <- .principal = viewer\n  sync\ntable reactions:\n  conversationId: id\n  messageId: id\n  principal: principal\n  emoji: text <=20\n  unique byMessagePrincipal: messageId, principal\n  by byConversation: conversationId, id\n  by byPrincipal: principal, id\n  cap 50 by messageId\n  read <- exists members[.conversationId, viewer]\n  insert <- .principal = viewer\n  update <- .principal = viewer\n  sync to members[.conversationId] last 500 by byConversation\nmutation react(conversationId: id, messageId: id):\n  upsert reactions[messageId, viewer] { conversationId, emoji: 'heart' }\n";

#[test]
fn insert_arm_clique_output_names_the_first_failed_proof_everywhere() {
    let b = compile(&[("chat.q".into(), REACTIONS.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let lines = snapback4_lang::bind::residency::operation_lines("chat.react", &b.schema.operations["chat.react"]);
    let summary = snapback4_lang::bind::residency::prediction_summary(&b);
    println!("{lines}\nsummary: {summary:?}");
    assert_eq!(lines.lines().next().unwrap(), "  chat.react: predicts: updates only — inserts into reactions queue without a row");
    assert_eq!(lines.lines().count(), 2, "one clear explanation: {lines}");
    assert!(lines.lines().any(|line| line == "    Horizon: upsert insert queues without a row: reactions has horizon last 500 by byConversation (conversationId, id) (site chat.q:23:3); this write queues until the server answers; show its pending state"), "{lines}");
    assert_eq!(summary.as_deref(), Some("1 mutation has insert arms that never predict: chat.react (reactions has horizon last 500 by byConversation (conversationId, id)) — snapback4 why <op>"));
}

#[test]
fn insert_arm_rule_and_cap_causes_have_applicable_guidance() {
    let unbounded = REACTIONS.replace(" last 500 by byConversation", "");
    let b = compile(&[("chat.q".into(), unbounded.clone())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let summary = snapback4_lang::bind::residency::prediction_summary(&b).unwrap();
    assert_eq!(summary, "1 mutation has insert arms that never predict: chat.react (reactions read rule `exists members[.conversationId, viewer]` is not decided by key byMessagePrincipal (messageId, principal); unpinned: conversationId) — snapback4 why <op>");
    let private = unbounded.replace("read <- exists members[.conversationId, viewer]", "read <- .principal = viewer").replace("sync to members[.conversationId]", "sync to .principal");
    let b = compile(&[("chat.q".into(), private.clone())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert_eq!(snapback4_lang::bind::residency::prediction_summary(&b).unwrap(), "1 mutation has insert arms that never predict: chat.react (reactions cap 50 by messageId is not covered by read rule `.principal = viewer`; unpinned: principal) — snapback4 why <op>");
    let lines = snapback4_lang::bind::residency::operation_lines("chat.react", &b.schema.operations["chat.react"]);
    assert!(lines.contains("this write queues until the server answers; show its pending state"));
    assert!(!lines.contains("rewrite:"), "changing the cap population changes the product rule: {lines}");
    for source in [private.replace("cap 50 by messageId", "cap 50 by principal"), private.replace("read <- .principal = viewer", "read <- public").replace("sync to .principal", "sync public")] {
        let b = compile(&[("chat.q".into(), source)]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        assert_eq!(snapback4_lang::bind::residency::operation_lines("chat.react", &b.schema.operations["chat.react"]).lines().next().unwrap(), "  chat.react: predicts: eligible");
        assert_eq!(snapback4_lang::bind::residency::prediction_summary(&b), None);
    }
}

#[test]
fn insert_arm_if_absent_is_reported_and_covered_control_stays_eligible() {
    let source = REACTIONS.replace("upsert reactions[messageId, viewer] { conversationId, emoji: 'heart' }", "insert reactions { conversationId, messageId, principal: viewer, emoji: 'heart' } if absent");
    let b = compile(&[("chat.q".into(), source.clone())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let lines = snapback4_lang::bind::residency::operation_lines("chat.react", &b.schema.operations["chat.react"]);
    assert_eq!(lines.lines().next().unwrap(), "  chat.react: predicts: inserts queue without a row — insert if absent into reactions cannot prove absence");
    assert!(snapback4_lang::bind::residency::prediction_summary(&b).unwrap().contains("chat.react (reactions has horizon last 500 by byConversation (conversationId, id))"));
    assert!(lines.contains("insert if absent queues without a row:"));
    assert!(!lines.contains("may queue") && !lines.contains("rewrite:"), "{lines}");
    let source = source.replace("read <- exists members[.conversationId, viewer]", "read <- public").replace("sync to members[.conversationId] last 500 by byConversation", "sync public");
    let b = compile(&[("chat.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert_eq!(snapback4_lang::bind::residency::operation_lines("chat.react", &b.schema.operations["chat.react"]).lines().next().unwrap(), "  chat.react: predicts: eligible");
    assert_eq!(snapback4_lang::bind::residency::prediction_summary(&b), None);
}

#[test]
fn insert_arm_nullable_unique_image_distinguishes_null_from_a_known_lookup() {
    let source = REACTIONS.replace("read <- exists members[.conversationId, viewer]", "read <- .principal = viewer")
        .replace("sync to members[.conversationId] last 500 by byConversation", "sync to .principal")
        .replace("  cap 50 by messageId\n", "  alias: text <=20 ? default 'taken'\n  unique byAlias: alias\n");
    let b = compile(&[("chat.q".into(), source.clone())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert_eq!(snapback4_lang::bind::residency::prediction_summary(&b).as_deref(), Some("1 mutation has insert arms that never predict: chat.react (reactions unique key byAlias (alias) is not covered by read rule `.principal = viewer`; unpinned: principal) — snapback4 why <op>"));
    let source = source.replace("emoji: 'heart'", "emoji: 'heart', alias: null");
    let b = compile(&[("chat.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert_eq!(snapback4_lang::bind::residency::prediction_summary(&b), None);
}

const HORIZONS: &str = include_str!("fixtures/prediction-horizons.q");
fn horizon_fixture(source: &str) -> Bound {
    let b = compile(&[("chat.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}

#[test]
fn horizon_calibration_summary_and_heading_persist() {
    use snapback4_lang::bind::residency::{change_notes, operation_lines, prediction_summary};
    let first = horizon_fixture(HORIZONS);
    let heading = operation_lines("chat.send", &first.schema.operations["chat.send"]);
    let summary = prediction_summary(&first);
    println!("heading:\n{heading}\nsummary: {summary:?}\nnotes: {}", first.notes.len());
    assert_eq!(heading.lines().next().unwrap(), "  chat.send: predicts: eligible except past the horizon at messages[messageId] (chat.q:83:22)");
    let summary = summary.unwrap();
    assert_eq!(summary, "2 mutations eligible, but these reads queue without a row past a horizon: chat.createPost (posts[postId] (chat.q:87:13), ranked insert rule: posts by byId (chat.q:32:3)), chat.send (messages[messageId] (chat.q:83:22)) — snapback4 why <op>");
    for _ in 0..3 {
        let next = horizon_fixture(HORIZONS);
        assert_eq!(prediction_summary(&next).as_deref(), Some(summary.as_str()));
        assert_eq!(operation_lines("chat.send", &next.schema.operations["chat.send"]), heading);
        assert_eq!(next.notes, first.notes);
        assert!(change_notes(&next, &first.schema.operations).is_empty());
    }
    let fixed = horizon_fixture(&HORIZONS.replace("  require not exists messages[messageId] else DUPLICATE\n", ""));
    assert_eq!(operation_lines("chat.send", &fixed.schema.operations["chat.send"]).lines().next().unwrap(), "  chat.send: predicts: eligible");
    assert!(!prediction_summary(&fixed).unwrap().contains("chat.send"));
}

#[test]
fn horizon_calibration_advice_preserves_prediction_and_groups_sites() {
    let b = horizon_fixture(HORIZONS);
    println!("notes: {}", b.notes.len());
    for note in &b.notes { println!("{note}"); }
    let no_horizon: Vec<_> = b.notes.iter().filter(|n| n.code == "N_NO_HORIZON").collect();
    assert_eq!(no_horizon.len(), 1);
    assert!(no_horizon[0].message.starts_with("table archive:"));
    assert_eq!(no_horizon[0].rewrite, "sync public last 500 by byTime");
    let grouped: Vec<_> = b.notes.iter().filter(|n| n.code == "N_MAINTAIN_SYNCED").collect();
    assert_eq!(grouped.len(), 1);
    for (name, line) in [("messageCounts", 69), ("reactionCounts", 71), ("postCounts", 73), ("postTimes", 75), ("rankCounts", 77), ("rankTotal", 79)] {
        assert!(grouped[0].message.contains(&format!("maintain {name}:")), "{}", grouped[0]);
        assert!(grouped[0].message.contains(&format!("chat.q:{line}:1")), "{}", grouped[0]);
    }
    let search = b.notes.iter().find(|n| n.code == "N_WIDE_MERGE").unwrap();
    assert_eq!(search.guide, "search");
    assert!(!search.rewrite.contains("feed"));
    assert!(search.rewrite.contains("snapback4 check --cost"));
    let guard = b.notes.iter().find(|n| n.code == "N_HORIZON_GUARD").unwrap();
    assert_eq!(guard.to_string(), "chat.q:83:22 — N_HORIZON_GUARD: chat.send: `require not exists messages[messageId] else DUPLICATE` reads the argument row id `messageId`, not the mutation write id; a miss past the horizon cannot prove row absence, so this call queues without a predicted row\n  rewrite: if this guard only dedupes retries, remove `require not exists messages[messageId] else DUPLICATE` and keep the insert; retry with the same mutation write id for this principal. That id dedupes the mutation, not the argument row id; a new mutation write id with the same row id is a different write. Keep guards that enforce an application requirement\n  guide: prediction");
    assert!(!guard.mechanical, "a guard may be an application requirement");
    assert_eq!(b.notes.len(), 4);
    for name in ["chat.react", "chat.acceptIntent", "chat.recordSent"] { assert_eq!(b.schema.operations[name].predicts.as_deref(), Some("eligible")); }
    // If prediction is deliberately disabled, the growing tables get ordinary advice again.
    let server = horizon_fixture(&HORIZONS.replace("mutation react(conversationId: id, messageId: id):", "mutation react(conversationId: id, messageId: id): server")
        .replace("mutation acceptIntent(key: id):", "mutation acceptIntent(key: id): server").replace("mutation recordSent(key: id):", "mutation recordSent(key: id): server"));
    assert_eq!(server.notes.iter().filter(|n| n.code == "N_NO_HORIZON").count(), 4);
}

#[test]
fn w6r1_rule_live_aggregate_keeps_source_coverage_and_summary() {
    use snapback4_lang::bind::residency::{operation_lines, prediction_summary};
    let source = include_str!("fixtures/rule-live-horizon.q");
    let b = clean(source);
    for note in &b.notes { println!("{note}"); }
    assert!(!b.notes.iter().any(|n| n.code == "N_NO_HORIZON" && n.message.starts_with("table sessions:")));
    let sites = &b.schema.operations["act"].sites;
    assert!(sites.iter().any(|s| s.table == "sessions" && s.kind == "aggregate source" && s.class == snapback4_core::schema::SiteClass::Held));
    let b = clean(&source.replacen("sync public", "sync public last 1 by byExpiry", 1));
    let summary = prediction_summary(&b).unwrap();
    println!("{summary}\n{}", operation_lines("act", &b.schema.operations["act"]));
    assert!(summary.contains("sessions by byOwner"), "{summary}");
    assert!(operation_lines("act", &b.schema.operations["act"]).lines().next().unwrap().contains("sessions by byOwner"));
}

#[test]
fn w6r1_ordinary_mutation_page_keeps_growing_table_advice() {
    let source = "table archive:\n  at: time\n  by byTime: at, id\n  public 'archive'\n  sync public\nmutation page():\n  return archive last 20 by byTime\n";
    let b = clean(source);
    assert_eq!(b.schema.operations["page"].predicts.as_deref(), Some("eligible"));
    let note = b.notes.iter().find(|n| n.code == "N_NO_HORIZON").expect("a page needs no whole-partition proof");
    println!("{note}");
    assert_eq!(note.rewrite, "sync public last 500 by byTime");
    let bounded = clean(&source.replace("sync public", &note.rewrite));
    assert_eq!(bounded.schema.operations["page"].predicts.as_deref(), Some("eligible"));
    assert!(!bounded.notes.iter().any(|n| n.code == "N_NO_HORIZON"));
}

#[test]
fn w6r1_horizon_guard_distinguishes_row_invariants_from_write_retries() {
    let source = "table tombstones:\n  at: time\n  by byTime: at, id\n  public 'tombstones'\n  sync public last 20 by byTime\nmutation act(eventId: tombstones):\n  require not exists tombstones[eventId] else EVENT_REMOVED\n  return null\n";
    for code in ["EVENT_REMOVED", "DUPLICATE", "RETRY"] {
        let b = clean(&source.replace("EVENT_REMOVED", code));
        let note = b.notes.iter().find(|n| n.code == "N_HORIZON_GUARD");
        if let Some(note) = note { println!("{note}"); }
        assert_eq!(note.is_some(), code != "EVENT_REMOVED");
        if let Some(note) = note {
            assert!(note.message.contains("argument row id `eventId`, not the mutation write id"));
            assert!(note.rewrite.contains("a new mutation write id with the same row id is a different write"));
        }
        assert_eq!(b.schema.operations["act"].predicts.as_deref(), Some("eligible"));
    }
}

#[test]
fn w6r1_final_exists_live_aggregate_also_keeps_source_coverage() {
    let source = include_str!("fixtures/rule-live-horizon.q").replace("insert <- exists liveCounts[.owner]", "insert <- allow\n  after insert <- exists liveCounts[.owner]");
    let b = clean(&source);
    assert!(!b.notes.iter().any(|n| n.code == "N_NO_HORIZON" && n.message.starts_with("table sessions:")));
    assert!(b.schema.operations["act"].sites.iter().any(|s| s.table == "sessions" && s.kind == "aggregate source"));
    let bounded = clean(&source.replacen("sync public", "sync public last 1 by byExpiry", 1));
    assert!(snapback4_lang::bind::residency::prediction_summary(&bounded).unwrap().contains("sessions by byOwner (after insert)"));
}

fn mutation_page_horizon_advice(read: &str, rewrite: &str) {
    let source = include_str!("fixtures/horizon-pages.q").replace("archive first 20 by byTime", read);
    let b = compile(&[("chat.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert_eq!(b.schema.operations["chat.copyArchive"].predicts.as_deref(), Some("eligible"));
    let note = b.notes.iter().find(|n| n.code == "N_NO_HORIZON" && n.message.starts_with("table archive:")).unwrap();
    println!("{read}:\n{note}");
    assert_eq!(note.to_string(), format!("chat.q:1:1 — N_NO_HORIZON: table archive: `sync public` has no horizon, so every row of every group a device holds reaches it and stays; a device that holds many groups, or a public table that grows, pays for all of it at every cold start\n  rewrite: {rewrite}\n  guide: sync"));
}

#[test]
fn w6r2_ascending_page_advice_preserves_prediction() {
    mutation_page_horizon_advice("archive first 20 by byTime", "a horizon would cost these mutations their prediction: chat.copyArchive; keep `sync public`");
}

#[test]
fn w6r2_descending_page_keeps_horizon_rewrite() {
    mutation_page_horizon_advice("archive last 20 by byTime", "sync public last 500 by byTime");
}

#[test]
fn w6r2_different_index_page_advice_preserves_prediction() {
    mutation_page_horizon_advice("archive last 20 by byTimeOther", "a horizon would cost these mutations their prediction: chat.copyArchive; keep `sync public`");
}
