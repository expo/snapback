use super::*;

/// §9: a scope logged while the table synced to the team must not close the
/// team after the table stopped syncing to it, the viewer rejoined, and the
/// union came back. Without the audience epoch the stream reads the old
/// scope as the last word and a new task of the team never arrives.
#[test]
fn an_audience_epoch_keeps_an_old_scope_from_closing_a_rejoined_group() {
    let union = compiled(TEAMS);
    let owner_only = compiled(&TEAMS.replace("  read <- .owner = viewer or exists members[.team, viewer]\n", "  read <- .owner = viewer\n"));
    assert!(!owner_only.0.tables["tasks"].sync.as_ref().unwrap().is_union());
    let mut engine = Engine::memory(union.0.clone(), union.1.clone()).unwrap();
    engine.seed(teams_seed()).unwrap();
    mutate(&mut engine, ALICE, "leave", &[("team", id("t1"))], 1);
    engine.adopt(owner_only.0.clone(), owner_only.1.clone()).unwrap();
    // Alice rejoins while tasks sync to owners only: no join is logged for tasks.
    engine.seed([("members".to_owned(), object([("id", id("back")), ("team", id("t1")), ("principal", id(ALICE))]))]).unwrap();
    engine.adopt(union.0.clone(), union.1.clone()).unwrap();
    let (_, watermark) = engine.snapshot_at(ALICE, NOW).unwrap();
    engine.seed([("members".to_owned(), object([("id", id("mb1")), ("team", id("t1")), ("principal", id(BOB))]))]).unwrap();
    mutate(&mut engine, BOB, "create", &[("team", id("t1"))], 3);
    let page = engine.stream_at(ALICE, watermark, 1_000, NOW).unwrap();
    let created: Vec<_> = page.events.iter().filter(|event| event.table == "tasks" && event.kind == "put").map(|event| event.id.clone()).collect();
    assert_eq!(created, ["e30"], "Alice holds t1 again, so Bob's new task in it reaches her: {:?}", page.events);
}

/// §4.3: the leave walk passes spared rows; 600 of them ahead of the rows it
/// must drop do not stop it, and none of them is lost.
#[test]
fn a_leave_keeps_every_spared_row_however_many_come_first() {
    let b = backend(teams_world());
    let mut engine = Engine::memory(b.schema.clone(), b.programs.clone()).unwrap();
    let mut rows = teams_seed();
    for n in 0..600 {
        rows.push(("tasks".to_owned(), object([("id", id(&format!("a{n:03}"))), ("owner", id(ALICE)), ("team", id("t1")), ("title", Value::String("x".into())), ("at", Value::Int(10 + n))])));
    }
    for n in 0..3 {
        rows.push(("tasks".to_owned(), object([("id", id(&format!("z{n}"))), ("owner", id(BOB)), ("team", id("t1")), ("title", Value::String("x".into())), ("at", Value::Int(1_000 + n))])));
    }
    engine.seed(rows).unwrap();
    let mut device = real_device(&b, &mut engine, ALICE);
    mutate(&mut engine, ALICE, "leave", &[("team", id("t1"))], 1);
    follow(&mut engine, &mut device, ALICE);
    let (count, unknown, _) = device.query_with_coverage("myCount", ALICE, &json!({}), NOW);
    let count = count.unwrap();
    assert!(count.complete && !unknown);
    assert_eq!(count.data, Value::Int(601), "Alice's 600 tasks in t1 and her seeded task stay");
    for n in 0..3 {
        let (task, unknown, _) = device.query_with_coverage("task", ALICE, &json!({"t": format!("z{n}")}), NOW);
        let task = task.unwrap();
        assert!(task.complete && !unknown && task.data == Value::Null, "Bob's task z{n} left with the team");
    }
}

/// Round 3 (Muse finding 1): a row deleted and recreated under its id in one
/// commit, in another team, keeps the deletion owed to the partition it left:
/// the first incarnation's `del` survives the second's birth.
#[test]
fn a_row_recreated_elsewhere_in_one_commit_still_revokes_where_it_was() {
    let source = format!("{TEAMS}\nmutation recreate(task: tasks, team: teams):\n  t = tasks[task] ! else NOT_FOUND\n  delete tasks[t]\n  return insert tasks {{ owner: viewer, team, title: 'x', at: now }}\n");
    let (schema, programs) = compiled(&source);
    let mut engine = Engine::memory(schema, programs).unwrap();
    engine.seed(teams_seed()).unwrap();
    // Mallory holds t1 only; Bob holds t2 only.
    engine.seed([("members".to_owned(), object([("id", id("mm1")), ("team", id("t1")), ("principal", id(MALLORY))]))]).unwrap();
    let (_, before) = engine.snapshot_at(MALLORY, NOW).unwrap();
    // The commit deletes ka (Alice's, in t1) and recreates it under the same
    // id as Alice's task in t2.
    let args = [("task".to_owned(), id("ka")), ("team".to_owned(), id("t2"))].into();
    let outcome = engine.mutate("recreate", Some("re"), Context::new(ALICE, args).at(NOW).with_ids(["ka".to_owned()])).unwrap();
    assert!(matches!(outcome.state, WriteState::Sent { .. }), "{:?}", outcome.state);
    let mallory = engine.stream_at(MALLORY, before, 1_000, NOW).unwrap();
    let last = mallory.events.iter().rev().find(|event| event.table == "tasks" && event.id == "ka");
    assert_eq!(last.map(|event| event.kind.as_str()), Some("del"), "Mallory held ka through t1 and must lose it: {:?}", mallory.events);
    let bob = engine.stream_at(BOB, before, 1_000, NOW).unwrap();
    assert!(bob.events.iter().any(|event| event.id == "ka" && event.kind == "put"), "Bob reads the new ka through t2: {:?}", bob.events);
}

/// Round 3 (Muse finding 2): R1 also covers a single group audience whose
/// group column can change. A task moved between two teams its viewer holds
/// logs a `put` to the new team and a `del` to the old; served from
/// serve-time state, the `del` is the current image and the row stays.
#[test]
fn a_row_moved_between_two_held_groups_of_one_audience_stays() {
    let source = "table teams:\n  name: text <=20\n  read <- exists members[.id, viewer]\n  insert <- deny\n  sync\ntable members:\n  team: teams\n  principal: principal\n  unique team, principal\n  immutable team, principal\n  read <- exists members[.team, viewer]\n  insert <- exists members[.team, viewer]\n  sync\ntable tasks:\n  team: teams\n  read <- exists members[.team, viewer]\n  insert <- exists members[.team, viewer]\n  update <- exists members[.team, viewer]\n  sync\nmutation move(task: tasks, team: teams):\n  t = tasks[task] ! else NOT_FOUND\n  update tasks[t] { team }\n  return null\n";
    let (schema, programs) = compiled(source);
    let mut engine = Engine::memory(schema, programs).unwrap();
    engine.seed([
        ("teams".to_owned(), object([("id", id("t1")), ("name", Value::String("a".into()))])),
        ("teams".to_owned(), object([("id", id("t2")), ("name", Value::String("b".into()))])),
        ("members".to_owned(), object([("id", id("m1")), ("team", id("t1")), ("principal", id(ALICE))])),
        ("members".to_owned(), object([("id", id("m2")), ("team", id("t2")), ("principal", id(ALICE))])),
        ("tasks".to_owned(), object([("id", id("k")), ("team", id("t1"))])),
    ]).unwrap();
    let (_, watermark) = engine.snapshot_at(ALICE, NOW).unwrap();
    mutate(&mut engine, ALICE, "move", &[("task", id("k")), ("team", id("t2"))], 1);
    let page = engine.stream_at(ALICE, watermark, 1_000, NOW).unwrap();
    let last = page.events.iter().rev().find(|event| event.id == "k").expect("an event for k");
    assert_eq!(last.kind, "put", "{:?}", page.events);
}

/// Round 3 (GPT finding 1): a stream from a watermark before the audience
/// epoch reads no group log of the earlier audience. Alice was never in t2
/// while a task of t2 was deleted; after the arm is removed, Alice joins and
/// the union returns, a stream from 0 names no deletion she never could read.
#[test]
fn a_stream_from_before_the_epoch_reads_no_earlier_group_log() {
    let union = compiled(TEAMS);
    let owner_only = compiled(&TEAMS.replace("  read <- .owner = viewer or exists members[.team, viewer]\n", "  read <- .owner = viewer\n"));
    let mut engine = Engine::memory(union.0.clone(), union.1.clone()).unwrap();
    // Alice only in t1 here; Bob owns kb in t2.
    engine.seed(teams_seed().into_iter().filter(|(table, row)| !(table == "members" && row.field("id").ok() == Some(&id("ma2")))).collect::<Vec<_>>()).unwrap();
    mutate(&mut engine, BOB, "remove", &[("task", id("kb"))], 1);
    engine.adopt(owner_only.0.clone(), owner_only.1.clone()).unwrap();
    engine.seed([("members".to_owned(), object([("id", id("late")), ("team", id("t2")), ("principal", id(ALICE))]))]).unwrap();
    engine.adopt(union.0.clone(), union.1.clone()).unwrap();
    for limit in [1, 1_000] {
        let mut watermark = 0;
        loop {
            let page = engine.stream_at(ALICE, watermark, limit, NOW).unwrap();
            assert!(page.events.iter().all(|event| event.id != "kb"), "Alice never could read kb: {:?}", page.events);
            watermark = page.watermark;
            if !page.more { break; }
        }
    }
}

/// Round 3 (GPT finding 3): a renewal inside the acquiring commit is still
/// that commit's acquisition. Mallory joins a group with one deadline, the
/// same commit renews it and deletes a row of the group: she is never sent
/// the row's id.
#[test]
fn a_renewal_inside_the_acquiring_commit_reads_nothing_of_that_commit() {
    let source = "table members:\n  team: id\n  principal: principal\n  until: time\n  unique team, principal\n  by byUntil: until\n  immutable team, principal\n  expire at .until\n  read <- exists members[.team, viewer]\n  insert <- exists members[.team, viewer]\n  update <- exists members[.team, viewer]\n  sync\ntable notes:\n  team: id\n  immutable team\n  read <- exists members[.team, viewer]\n  insert <- exists members[.team, viewer]\n  delete <- exists members[.team, viewer]\n  sync\nmutation admitAndDrop(who: principal, note: notes):\n  m = insert members { team: 'g', principal: who, until: now + 100 }\n  update members[m] { until: now + 200 }\n  n = notes[note] ! else NOT_FOUND\n  delete notes[n]\n  return null\n";
    let (schema, programs) = compiled(source);
    let mut engine = Engine::memory(schema, programs).unwrap();
    engine.seed([
        ("members".to_owned(), object([("id", id("ma")), ("team", id("g")), ("principal", id(ALICE)), ("until", Value::Int(NOW * 10))])),
        ("notes".to_owned(), object([("id", id("x")), ("team", id("g"))])),
    ]).unwrap();
    let (_, before) = engine.snapshot_at(MALLORY, NOW).unwrap();
    mutate(&mut engine, ALICE, "admitAndDrop", &[("who", id(MALLORY)), ("note", id("x"))], 1);
    for limit in [1, 1_000] {
        let mut watermark = before;
        loop {
            let page = engine.stream_at(MALLORY, watermark, limit, NOW + 20).unwrap();
            assert!(page.events.iter().all(|event| event.id != "x"), "Mallory never could read x: {:?}", page.events);
            watermark = page.watermark;
            if !page.more { break; }
        }
    }
}

/// Round 4 (GPT finding 1): the audience epoch's identity includes how stored
/// membership images are read, so changing a group column's default (which
/// decides the group an old row names) starts a new epoch.
#[test]
fn a_changed_membership_default_is_a_new_audience() {
    let source = |default: &str| format!("table members:\n  team: text <=5 default '{default}'\n  principal: principal\n  unique team, principal\n  immutable team, principal\n  read <- exists members[.team, viewer]\n  insert <- exists members[.team, viewer]\n  sync\ntable notes:\n  owner: principal\n  team: text <=5\n  read <- .owner = viewer or exists members[.team, viewer]\n  insert <- .owner = viewer\n  sync\n");
    let (one, _) = compiled(&source("g1"));
    let (two, _) = compiled(&source("g2"));
    let changed = snapback4_core::partition::changed_group_audiences(Some(&one), &two);
    assert!(changed.contains(&"notes".to_owned()) && changed.contains(&"members".to_owned()), "{changed:?}");
    assert!(snapback4_core::partition::changed_group_audiences(Some(&one), &one).is_empty());
}

/// Round 4 (GPT finding 2): a scope logged under an earlier audience is not
/// streamed under a new one. Alice leaves t1 under owner-or-team; the union
/// is retargeted to an empty-group roster; a stream from before the leave
/// carries no `tasks` scope of the old width the current device would refuse.
#[test]
fn a_scope_of_an_earlier_audience_is_not_streamed() {
    let union = compiled(TEAMS);
    let roster = compiled(&format!("{}\ntable staff:\n  principal: principal\n  unique principal\n  read <- exists staff[viewer]\n  insert <- exists staff[viewer]\n  sync\n",
        TEAMS.replace("  read <- .owner = viewer or exists members[.team, viewer]\n  insert <- .owner = viewer and exists members[.team, viewer]\n", "  read <- .owner = viewer or exists staff[viewer]\n  insert <- .owner = viewer and exists members[.team, viewer]\n")));
    let mut engine = Engine::memory(union.0.clone(), union.1.clone()).unwrap();
    engine.seed(teams_seed()).unwrap();
    mutate(&mut engine, ALICE, "leave", &[("team", id("t1"))], 1);
    engine.adopt(roster.0.clone(), roster.1.clone()).unwrap();
    let page = engine.stream_at(ALICE, 0, 1_000, NOW).unwrap();
    assert!(page.events.iter().all(|event| !(event.table == "tasks" && event.kind == "scope")), "{:?}", page.events);
    // The members table kept its audience: its own scope still streams.
    assert!(page.events.iter().any(|event| event.table == "members" && event.kind == "scope"), "{:?}", page.events);
}

/// Round 5 (GPT finding 1): an existing row that enters a new arm with an
/// image already expired at its commit's end names nothing to that arm. Bob
/// buys and sells `o`; one commit makes Mallory the buyer and ends the row's
/// life. Mallory could read `o` at neither boundary: she is sent nothing,
/// then or after the sweep; Bob loses the row.
#[test]
fn an_expiring_move_into_another_audience_names_nothing_there() {
    let source = "table orders:\n  buyer: principal\n  seller: principal\n  until: time\n  by byBuyer: buyer, id\n  by bySeller: seller, id\n  by byUntil: until\n  expire at .until\n  read <- .buyer = viewer\n  insert <- .seller = viewer\n  update <- allow\n  sync\nmutation hand(order: orders, who: principal):\n  o = orders[order] ! else NOT_FOUND\n  update orders[o] { buyer: who, until: now }\n  return null\n";
    let (schema, programs) = compiled(source);
    let mut engine = Engine::memory(schema, programs).unwrap();
    engine.seed([("orders".to_owned(), object([("id", id("o")), ("buyer", id(BOB)), ("seller", id(BOB)), ("until", Value::Int(NOW * 10))]))]).unwrap();
    let before = engine.seq().unwrap();
    mutate(&mut engine, BOB, "hand", &[("order", id("o")), ("who", id(MALLORY))], 1);
    let streams = |engine: &mut Engine, viewer: &str, at: i64| -> Vec<(String, String)> {
        let mut out = Vec::new();
        for limit in [1, 1_000] {
            let mut watermark = before;
            loop {
                let page = engine.stream_at(viewer, watermark, limit, at).unwrap();
                out.extend(page.events.iter().filter(|event| event.id == "o").map(|event| (event.kind.clone(), event.seq.to_string())));
                watermark = page.watermark;
                if !page.more { break; }
            }
        }
        out
    };
    assert!(streams(&mut engine, MALLORY, NOW + 10).is_empty(), "Mallory never could read o");
    assert!(streams(&mut engine, BOB, NOW + 10).iter().any(|(kind, _)| kind == "del"), "Bob loses o");
    engine.sweep_expired(NOW + 100, 100).unwrap();
    assert!(streams(&mut engine, MALLORY, NOW + 100).is_empty(), "nor after the sweep");
}

// Revision 7: exercise epoch transitions through both real device applicators.
pub(super) fn epoch_trace_applies<S: snapback4_device::store::DeviceStore>(store: S, backend: snapback4_device::device::Backend, trace: &[Json], query: &str, args: &Json, expected: &Value) {
    let mut device = snapback4_device::device::Device::open_store(store, Some(backend)).unwrap();
    for (n, page) in trace.iter().enumerate() {
        let page = serde_json::from_value(page.clone()).unwrap();
        device.apply(&page, n == 0).unwrap();
    }
    let (answer, unknown, _) = device.query_with_coverage(query, ALICE, args, NOW + 10);
    let answer = answer.unwrap();
    assert!(answer.complete && !unknown && !answer.unavailable, "{answer:?}, unknown={unknown}");
    assert_eq!(&answer.data, expected);
}

pub(super) fn epoch_snapshot_trace(engine: &mut Engine) -> Vec<Json> {
    let mut trace = Vec::new();
    let mut after = None;
    loop {
        let (page, next) = snapshot_page(engine, ALICE, after);
        trace.push(page);
        after = next;
        if after.is_none() { return trace; }
    }
}

pub(super) fn epoch_stream_trace(engine: &mut Engine, from: u64, limit: usize, trace: &mut Vec<Json>) {
    stream_trace_at(engine,from,limit,NOW+10,trace);
}

pub(super) fn stream_trace_at(engine: &mut Engine, from: u64, limit: usize, now: i64, trace: &mut Vec<Json>) {
    let mut watermark = from;
    loop {
        let page = engine.stream_at(ALICE, watermark, limit, now).unwrap();
        assert!(page.acquisitions.iter().all(|marker| marker.at <= page.events.len()), "marker past page: {page:?}");
        let events: Vec<_> = page.events.iter().map(|e| json!({"data": e.data.as_ref().map(wire::to_json), "id": e.id, "kind": e.kind, "seq": e.seq, "table": e.table})).collect();
        trace.push(json!({"acknowledged": {}, "events": events, "generation": engine.generation(), "joined": page.joined,
            "more": page.more, "now": now, "snapshot": false, "watermark": page.watermark, "acquisitions": page.acquisitions, "images_at": page.images_at}));
        assert!(page.watermark > watermark || !page.more, "empty page must advance");
        watermark = page.watermark;
        if !page.more { break; }
    }
}

#[test]
fn an_obsolete_scope_does_not_shift_a_later_window_acquisition() {
    let source = TEAMS.replace(".owner = viewer or exists members[.team, viewer]", "exists members[.team, viewer]")
        .replace("  sync\n\nquery myTasks", "  sync last 1 by .at\n\nquery myTasks")
        .replace("query myCount():\n  return count(tasks where .owner = viewer)\n", "")
        + "\nquery newest():\n  return tasks last 1 by .at\n";
    let old = compiled(&source);
    let new = compiled(&format!("{}\ntable staff:\n  principal: principal\n  unique principal\n  read <- exists staff[viewer]\n  insert <- exists staff[viewer]\n  sync\n",
        source.replace("  read <- exists members[.team, viewer]\n  insert <- .owner = viewer and exists members[.team, viewer]\n", "  read <- exists staff[viewer]\n  insert <- .owner = viewer and exists members[.team, viewer]\n")));
    for limit in [1, 1_000] {
        let mut engine = Engine::memory(old.0.clone(), old.1.clone()).unwrap();
        engine.seed_at(teams_seed(), NOW).unwrap();
        let from = engine.seq().unwrap();
        mutate(&mut engine, ALICE, "leave", &[("team", id("t1"))], 1);
        engine.adopt(new.0.clone(), new.1.clone()).unwrap();
        let mut trace = epoch_snapshot_trace(&mut engine);
        engine.seed_at([("staff".to_owned(), object([("id", id("a-staff")), ("principal", id(ALICE))]))], NOW + 2).unwrap();
        epoch_stream_trace(&mut engine, from, limit, &mut trace);
        let backend = snapback4_device::device::Backend { generation: engine.generation(), schema: new.0.public_projection(), programs: new.1.clone() };
        // The new single-audience window covers the roster's empty group.
        let expected = engine.query("newest", Context::new(ALICE, BTreeMap::new()).at(NOW + 10)).unwrap().data;
        epoch_trace_applies(snapback4_device::memory::MemoryStore::new(), backend.clone(), &trace, "newest", &json!({}), &expected);
        epoch_trace_applies(snapback4_core::Store::memory().unwrap(), backend, &trace, "newest", &json!({}), &expected);
    }
}

#[test]
fn a_first_post_epoch_renewal_keeps_history_without_granting_acquisition_history() {
    let source = "table members:\n  group: text <=10\n  person: principal\n  until: time\n  immutable group, person\n  unique group, person\n  expire at .until\n  read <- .person = viewer\n  insert <- exists members[.group, viewer]\n  update <- .person = viewer\n  sync\ntable notes:\n  group: text <=10\n  body: text <=10\n  read <- exists members[.group, viewer]\n  insert <- allow\n  delete <- allow\n  sync\nquery notes(group: text <=10):\n  return notes where .group = group first 20 by .id\nmutation renewDelete(who: principal, until: time, note: notes):\n  upsert members[group = 'g', person = who] { until }\n  delete notes[note]\n  return null\n";
    let old = compiled(&source.replace("  sync\nquery notes", "  online only\nquery notes"));
    let new = compiled(source);
    for limit in [1, 1_000] {
        for lifetime in [Some(NOW + 100), Some(NOW + 1), None] {
            let mut engine = Engine::memory(old.0.clone(), old.1.clone()).unwrap();
            let mut rows = vec![("notes".into(), object([("id", id("n")), ("group", Value::String("g".into())), ("body", Value::String("x".into()))]))];
            if let Some(until) = lifetime { rows.push(("members".into(), object([("id", id("m")), ("group", Value::String("g".into())), ("person", id(ALICE)), ("until", Value::Int(until))]))); }
            engine.seed_at(rows, NOW).unwrap();
            engine.adopt_at(new.0.clone(), new.1.clone(), NOW).unwrap();
            let mut trace = epoch_snapshot_trace(&mut engine);
            let from = engine.seq().unwrap();
            let mut context = Context::system().at(NOW + 2);
            context.args = BTreeMap::from([("who".into(), id(ALICE)), ("until".into(), Value::Int(NOW + 200)), ("note".into(), id("n"))]);
            let outcome = engine.mutate("renewDelete", Some("renew-delete"), context).unwrap();
            assert!(matches!(outcome.state, WriteState::Sent { .. }), "{outcome:?}");
            epoch_stream_trace(&mut engine, from, limit, &mut trace);
            if lifetime == Some(NOW + 100) {
                let events: Vec<_> = trace.iter().filter(|p| p["snapshot"] == false).flat_map(|p| p["events"].as_array().unwrap()).collect();
                assert!(events.iter().any(|e| e["table"] == "notes" && e["kind"] == "del" && e["id"] == "n"), "live renewal preserves the deletion in its renewing commit");
                assert!(events.iter().all(|e| !(e["table"] == "notes" && e["kind"] == "scope")), "live renewal never replaces the acquired group");
            }
            if lifetime.is_none() {
                assert!(trace.iter().flat_map(|p| p["events"].as_array().unwrap()).all(|e| !(e["table"] == "notes" && e["id"] == "n")), "a genuine acquisition learns no deleted id");
            }
            let backend = snapback4_device::device::Backend { generation: engine.generation(), schema: new.0.public_projection(), programs: new.1.clone() };
            epoch_trace_applies(snapback4_device::memory::MemoryStore::new(), backend.clone(), &trace, "notes", &json!({"group":"g"}), &Value::Array(Vec::new()));
            epoch_trace_applies(snapback4_core::Store::memory().unwrap(), backend, &trace, "notes", &json!({"group":"g"}), &Value::Array(Vec::new()));
        }
    }
}

#[test]
fn an_expiry_default_change_starts_a_new_epoch_and_discloses_no_expired_ids() {
    let source = "table members:\n  group: text <=10\n  person: principal\n  until: time ?\n  immutable group, person\n  unique group, person\n  expire at .until\n  read <- .person = viewer\n  insert <- exists members[.group, viewer]\n  sync\ntable notes:\n  group: text <=10\n  body: text <=10\n  read <- exists members[.group, viewer]\n  insert <- allow\n  delete <- allow\n  sync\nmutation remove(note: notes):\n  delete notes[note]\n  return null\n";
    let old = compiled(source);
    let new = compiled(&source.replace("until: time ?", &format!("until: time default {}", NOW + 200)));
    let changed = snapback4_core::partition::changed_group_audiences(Some(&old.0), &new.0);
    assert!(changed.contains(&"notes".into()), "{changed:?}");
    for limit in [1, 1_000] {
        let mut engine = Engine::memory(old.0.clone(), old.1.clone()).unwrap();
        let alice = object([("id", id("ma")), ("group", Value::String("g".into())), ("person", id(ALICE))]);
        let bob = object([("id", id("mb")), ("group", Value::String("g".into())), ("person", id(BOB)), ("until", Value::Int(NOW + 1_000))]);
        engine.seed_at([("members".into(), alice.clone()), ("members".into(), bob)], NOW).unwrap();
        // Preserve an older stored image with its optional field omitted;
        // activation interprets required literal defaults without storing them.
        engine.store().conn().execute("UPDATE r SET data = ?1 WHERE id = 'ma'", [snapback4_core::value::canonical_json(&alice)]).unwrap();
        engine.adopt_at(new.0.clone(), new.1.clone(), NOW + 100).unwrap();
        let (_, from) = engine.snapshot_at(ALICE, NOW + 150).unwrap();
        engine.seed_at([("notes".into(), object([("id", id("x")), ("group", Value::String("g".into())), ("body", Value::String("x".into()))]))], NOW + 250).unwrap();
        let mut context = Context::system().at(NOW + 260);
        context.args.insert("note".into(), id("x"));
        assert!(matches!(engine.mutate("remove", Some("remove-x"), context).unwrap().state, WriteState::Sent { .. }));
        engine.sweep_expired(NOW + 300, 100).unwrap();
        let mut watermark = from;
        loop {
            let page = engine.stream_at(ALICE, watermark, limit, NOW + 310).unwrap();
            assert!(page.events.iter().all(|event| !(event.table == "notes" && event.id == "x")), "Alice never read x: {page:?}");
            watermark = page.watermark;
            if !page.more { break; }
        }
    }
}

#[test]
fn removed_roster_joins_never_expand_under_an_owner_only_audience() {
    let old = compiled(STAFF);
    let new = compiled(&STAFF.replace("read <- .owner = viewer or exists staff[viewer]", "read <- .owner = viewer"));
    for limit in [1, 1_000] {
        let mut engine = Engine::memory(old.0.clone(), old.1.clone()).unwrap();
        engine.seed_at((staff_world().seed)(), NOW).unwrap();
        engine.adopt_at(new.0.clone(), new.1.clone(), NOW + 1).unwrap();
        let baseline = epoch_snapshot_trace(&mut engine);
        mutate(&mut engine, ALICE, "open", &[], 2);
        let head = engine.seq().unwrap();
        let backend = snapback4_device::device::Backend { generation: engine.generation(), schema: new.0.public_projection(), programs: new.1.clone() };
        let expected = engine.query("mine", Context::new(ALICE, BTreeMap::new()).at(NOW + 10)).unwrap().data;
        for from in 0..=head {
            let mut trace = if from == 0 { Vec::new() }
                else if from == head { epoch_snapshot_trace(&mut engine) }
                else { baseline.clone() };
            epoch_stream_trace(&mut engine, from, limit, &mut trace);
            assert!(trace.iter().flat_map(|p| p["events"].as_array().unwrap()).all(|e| !(e["table"] == "requests" && e["kind"] == "scope")), "removed group scopes cannot reappear");
            epoch_trace_applies(snapback4_device::memory::MemoryStore::new(), backend.clone(), &trace, "mine", &json!({}), &expected);
            epoch_trace_applies(snapback4_core::Store::memory().unwrap(), backend.clone(), &trace, "mine", &json!({}), &expected);
        }
    }
}

// Named disclosure follow-ups: vary wire pagination while applying to both stores.
pub(super) fn snapshot_trace_at(engine: &mut Engine, viewer: &str, limit: usize) -> Vec<Json> {
    let mut trace = Vec::new();
    let mut after = None;
    loop {
        let page = engine
            .snapshot_acquisition_page_at(viewer, after.as_deref(), limit, NOW + 10)
            .unwrap();
        let next = page.next.map(|n| n.encode());
        let events: Vec<_> = page.events.iter().map(|e| json!({"table":e.table,"kind":e.kind.word(),"id":e.id,"data":e.data.as_ref().map(wire::to_json)})).collect();
        assert!(page.acquisitions.iter().all(|a| a.at <= events.len()));
        trace.push(json!({"snapshot":true,"watermark":page.watermark,"generation":engine.generation(),"after":after,"next":next,"more":next.is_some(),"now":NOW + 10,"held":page.held,"acquisitions":page.acquisitions,"events":events}));
        after = next;
        if after.is_none() {
            return trace;
        }
    }
}

pub(super) fn compare_trace<S: snapback4_device::store::DeviceStore>(
    store: S,
    b: &Backend,
    engine: &mut Engine,
    viewer: &str,
    trace: &[Json],
) {
    let backend = snapback4_device::device::Backend {
        generation: engine.generation(),
        schema: b.schema.clone(),
        programs: b.programs.clone(),
    };
    let mut device = snapback4_device::device::Device::open_store(store, Some(backend)).unwrap();
    for (n, page) in trace.iter().enumerate() {
        device
            .apply(&serde_json::from_value(page.clone()).unwrap(), n == 0)
            .unwrap();
    }
    let now = b.tables(engine);
    for (query, args, known) in (b.world.queries)(&now, viewer) {
        let (local, unknown, _) = device.query_with_coverage(query, viewer, &args, NOW + 10);
        let server = engine.query(
            query,
            Context::new(
                viewer,
                args.as_object()
                    .unwrap()
                    .iter()
                    .map(|(k, v)| {
                        (
                            k.clone(),
                            wire::from_json(
                                &b.programs.iter().find(|p| p.name == query).unwrap().args[k],
                                v,
                            )
                            .unwrap(),
                        )
                    })
                    .collect(),
            )
            .at(NOW + 10),
        );
        match (local, server) {
            (Ok(local), Ok(server)) => {
                if known {
                    assert!(
                        local.complete && !unknown,
                        "{query}: {local:?}, unknown={unknown}"
                    );
                }
                if local.complete && !unknown && !local.unavailable && !server.unavailable {
                    assert_eq!(local.data, server.data, "{query} for {viewer}");
                }
            }
            (Err(local), Err(server)) => assert_eq!(local.code, server.code),
            (Ok(local), Err(server)) => assert!(
                !local.complete || unknown,
                "{query}: local {local:?} vs server {server:?}"
            ),
            (Err(local), Ok(_)) => assert!(
                unknown || matches!(local.code.as_str(), "E_OFFLINE" | "E_UNAVAILABLE"),
                "{query}: {local:?}"
            ),
        }
    }
}

