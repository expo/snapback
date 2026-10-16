use super::*;
use super::epochs::*;

#[test]
fn snapshots_at_every_small_page_size_certify_each_union_arm_on_both_stores() {
    for world in [
        teams_world(),
        staff_world(),
        parties_world(),
        three_world(),
        two_columns_group_world(),
    ] {
        let b = backend(world);
        let mut engine = b.fresh();
        for viewer in PRINCIPALS {
            for limit in [1, 2, 3, 4, 5, 6, 7, 8, 1000] {
                let trace = snapshot_trace_at(&mut engine, viewer, limit);
                compare_trace(
                    snapback4_device::memory::MemoryStore::new(),
                    &b,
                    &mut engine,
                    viewer,
                    &trace,
                );
                compare_trace(
                    snapback4_core::store::Store::memory().unwrap(),
                    &b,
                    &mut engine,
                    viewer,
                    &trace,
                );
            }
        }
    }
}

#[test]
fn two_prefix_scopes_spare_both_column_keepers_without_crossing_groups() {
    let source = "table members:\n  area: text <=20\n  lane: text <=20\n  principal: principal\n  unique area, lane, principal\n  immutable area, lane, principal\n  read <- .principal = viewer\n  insert <- exists members[.area, .lane, viewer]\n  delete <- .principal = viewer\n  sync\ntable notes:\n  area: text <=20\n  lane: text <=20\n  owner: principal\n  reviewer: principal\n  at: time\n  read <- .owner = viewer or .reviewer = viewer or exists members[.area, .lane, viewer]\n  insert <- .owner = viewer and exists members[.area, .lane, viewer]\n  sync\nquery mine():\n  return notes where .reviewer = viewer first 20 by .id\nmutation leave(area: text, lane: text):\n  m = members[area, lane, viewer] ! else NOT_MEMBER\n  delete members[m]\n  return null\n";
    let (schema, programs) = compiled(source);
    {
        let (schema, programs) = (schema.clone(), programs.clone());
        let mut engine = Engine::memory(schema.clone(), programs.clone()).unwrap();
        let member = |key: &str, lane: &str| {
            (
                "members".into(),
                object([
                    ("id", id(key)),
                    ("area", Value::String("a".into())),
                    ("lane", Value::String(lane.into())),
                    ("principal", id(ALICE)),
                ]),
            )
        };
        let note = |key: &str, lane: &str, owner: &str, reviewer: &str, at: i64| {
            (
                "notes".into(),
                object([
                    ("id", id(key)),
                    ("area", Value::String("a".into())),
                    ("lane", Value::String(lane.into())),
                    ("owner", id(owner)),
                    ("reviewer", id(reviewer)),
                    ("at", Value::Int(at)),
                ]),
            )
        };
        engine
            .seed([
                member("m1", "x"),
                member("m2", "y"),
                note("owner", "x", ALICE, BOB, 1),
                note("reviewer", "x", BOB, ALICE, 2),
                note("private", "x", BOB, BOB, 3),
                note("other", "y", BOB, BOB, 4),
            ])
            .unwrap();
        let mut trace = snapshot_trace_at(&mut engine, ALICE, 1);
        let from = engine.seq().unwrap();
        mutate(
            &mut engine,
            ALICE,
            "leave",
            &[
                ("area", Value::String("a".into())),
                ("lane", Value::String("x".into())),
            ],
            1,
        );
        epoch_stream_trace(&mut engine, from, 1, &mut trace);
        assert!(
            trace
                .iter()
                .flat_map(|p| p["events"].as_array().unwrap())
                .filter(|e| e["kind"] == "scope" && e["table"] == "notes")
                .all(|e| e["data"] == json!(["a", "x", ALICE]))
        );
        let expected = engine
            .query("mine", Context::new(ALICE, BTreeMap::new()).at(NOW + 10))
            .unwrap()
            .data;
        let backend = snapback4_device::device::Backend {
            generation: engine.generation(),
            schema,
            programs,
        };
        check_spared_trace(
            snapback4_device::memory::MemoryStore::new(),
            backend.clone(),
            &trace,
            &["owner", "reviewer", "other"],
            &["private"],
            "notes",
            "mine",
            &expected,
        );
        check_spared_trace(
            snapback4_core::store::Store::memory().unwrap(),
            backend,
            &trace,
            &["owner", "reviewer", "other"],
            &["private"],
            "notes",
            "mine",
            &expected,
        );
    }
}

fn check_spared_trace<S: snapback4_device::store::DeviceStore>(
    store: S,
    backend: snapback4_device::device::Backend,
    trace: &[Json],
    kept: &[&str],
    gone: &[&str],
    table: &str,
    query: &str,
    expected: &Value,
) {
    let mut device = snapback4_device::device::Device::open_store(store, Some(backend)).unwrap();
    for (n, page) in trace.iter().enumerate() {
        device
            .apply(&serde_json::from_value(page.clone()).unwrap(), n == 0)
            .unwrap();
    }
    let (answer, unknown, _) = device.query_with_coverage(query, ALICE, &json!({}), NOW + 10);
    let answer = answer.unwrap();
    assert!(answer.complete && !unknown, "{answer:?}, unknown={unknown}");
    assert_eq!(&answer.data, expected);
    assert_eq!(
        device.store().witness_count(table).unwrap(),
        kept.len() as u64,
        "the committed store keeps every spared row and removes {} revoked rows",
        gone.len()
    );
}

#[test]
fn a_large_roster_scope_walks_interleaved_owners_across_500_row_batches() {
    {
        let source = STAFF.replace("first 20 by .id", "first 2000 by .id");
        let (schema, programs) = compiled(&source);
        let mut engine = Engine::memory(schema.clone(), programs.clone()).unwrap();
        let mut seed = vec![(
            "staff".into(),
            object([("id", id("sa")), ("principal", id(ALICE))]),
        )];
        let mut kept = Vec::new();
        let mut gone = Vec::new();
        for n in 0..1200 {
            let key = format!("r{n:04}");
            let owner = if n % 2 == 0 {
                kept.push(key.clone());
                ALICE
            } else {
                gone.push(key.clone());
                BOB
            };
            seed.push((
                "requests".into(),
                object([
                    ("id", id(&key)),
                    ("owner", id(owner)),
                    ("title", Value::String("x".into())),
                    ("at", Value::Int(n)),
                ]),
            ));
        }
        engine.seed(seed.clone()).unwrap();
        for limit in [1, 1000] {
            let mut trace = snapshot_trace_at(&mut engine, ALICE, limit);
            let from = engine.seq().unwrap();
            // Rebuild below for the second pagination variant.
            mutate(&mut engine, ALICE, "quit", &[], 1);
            epoch_stream_trace(&mut engine, from, limit, &mut trace);
            let expected = engine
                .query("mine", Context::new(ALICE, BTreeMap::new()).at(NOW + 10))
                .unwrap()
                .data;
            let backend = snapback4_device::device::Backend {
                generation: engine.generation(),
                schema: schema.clone(),
                programs: programs.clone(),
            };
            let kept: Vec<_> = kept.iter().map(String::as_str).collect();
            let gone: Vec<_> = gone.iter().map(String::as_str).collect();
            check_spared_trace(
                snapback4_device::memory::MemoryStore::new(),
                backend.clone(),
                &trace,
                &kept,
                &gone,
                "requests",
                "mine",
                &expected,
            );
            check_spared_trace(
                snapback4_core::store::Store::memory().unwrap(),
                backend,
                &trace,
                &kept,
                &gone,
                "requests",
                "mine",
                &expected,
            );
            engine = Engine::memory(schema.clone(), programs.clone()).unwrap();
            engine.seed(seed.clone()).unwrap();
        }
    }
}

#[test]
fn epoch_identity_changes_for_each_interpretation_and_inherited_lifetime_input() {
    use snapback4_core::schema::{ColumnDefault, ColumnType, Index};
    let (schema, _) = compiled(TEAMS);
    for input in [
        "content-type",
        "group-type",
        "recipient-type",
        "index",
        "capture",
        "ancestor-default",
        "ancestor-expiry-type",
        "ancestor-expiry-column",
    ] {
        let mut before = schema.clone();
        if input.starts_with("ancestor") || input == "capture" {
            let mut parent = before.tables["members"].clone();
            parent.columns.insert(
                "until".into(),
                ColumnType::Optional(Box::new(ColumnType::Time)),
            );
            parent.expire = Some("until".into());
            before.tables.insert("parents".into(), parent);
            before.tables.get_mut("members").unwrap().through =
                Some(snapback4_core::schema::through::Through {
                    reference: "parent".into(),
                    parent: "parents".into(),
                    fields: BTreeMap::new(),
                    identity: "capture".into(),
                    expiring: true,
                });
        }
        let mut after = before.clone();
        match input {
            "content-type" => {
                after
                    .tables
                    .get_mut("tasks")
                    .unwrap()
                    .columns
                    .insert("team".into(), ColumnType::Text { max: 20 });
            }
            "group-type" => {
                after
                    .tables
                    .get_mut("members")
                    .unwrap()
                    .columns
                    .insert("team".into(), ColumnType::Text { max: 20 });
            }
            "recipient-type" => {
                after.tables.get_mut("members").unwrap().columns.insert(
                    "principal".into(),
                    ColumnType::Optional(Box::new(ColumnType::Principal)),
                );
            }
            "index" => {
                let members = after.tables.get_mut("members").unwrap();
                let columns: Vec<String> = vec!["team".into(), "principal".into()];
                members.indexes.retain(|_, i| i.columns() != columns);
                members
                    .indexes
                    .insert("renamed".into(), Index::of(&["team", "principal"], true));
            }
            "capture" => {
                after
                    .tables
                    .get_mut("members")
                    .unwrap()
                    .through
                    .as_mut()
                    .unwrap()
                    .identity = "new-capture".into();
            }
            "ancestor-default" => {
                after
                    .tables
                    .get_mut("parents")
                    .unwrap()
                    .defaults
                    .insert("until".into(), ColumnDefault::Literal(Value::Int(NOW)));
            }
            "ancestor-expiry-type" => {
                after
                    .tables
                    .get_mut("parents")
                    .unwrap()
                    .columns
                    .insert("until".into(), ColumnType::Time);
            }
            "ancestor-expiry-column" => {
                after.tables.get_mut("parents").unwrap().expire = Some("other".into());
            }
            _ => unreachable!(),
        }
        assert!(
            snapback4_core::partition::changed_group_audiences(Some(&before), &after)
                .contains(&"tasks".into()),
            "{input}"
        );
    }
}

#[test]
fn rebirth_chains_disclose_only_commit_boundary_audiences() {
    let source = format!(
        "{TEAMS}\nmutation rebirth(task: tasks, team: teams, to: principal):\n  t = tasks[task] ! else NOT_FOUND\n  update tasks[t] {{ team }}\n  delete tasks[t]\n  r = insert tasks {{ owner: viewer, team, title: 'x', at: now }}\n  update tasks[r] {{ owner: to }}\n  return null\nmutation born(team: teams, to: principal):\n  t = insert tasks {{ owner: viewer, team, title: 'x', at: now }}\n  update tasks[t] {{ team: 't1' }}\n  update tasks[t] {{ team }}\n  delete tasks[t]\n  r = insert tasks {{ owner: viewer, team, title: 'x', at: now }}\n  update tasks[r] {{ owner: to }}\n  return null\n"
    );
    let (schema, programs) = compiled(&source);
    for op in ["rebirth", "born"] {
        let mut engine = Engine::memory(schema.clone(), programs.clone()).unwrap();
        engine.seed(teams_seed()).unwrap();
        engine
            .seed([(
                "members".into(),
                object([
                    ("id", id("mm1")),
                    ("team", id("t1")),
                    ("principal", id(MALLORY)),
                ]),
            )])
            .unwrap();
        let before = engine.seq().unwrap();
        let args = BTreeMap::from([
            ("task".into(), id("ka")),
            ("team".into(), id("t2")),
            ("to".into(), id(BOB)),
        ]);
        let args = if op == "born" {
            args.into_iter().filter(|(k, _)| k != "task").collect()
        } else {
            args
        };
        let key = if op == "born" { "born" } else { "ka" };
        let out = engine
            .mutate(
                op,
                Some(op),
                Context::new(ALICE, args)
                    .at(NOW + 1)
                    .with_ids([key.into(), key.into()]),
            )
            .unwrap();
        assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
        for limit in [1, 1000] {
            for (viewer, reads) in [(ALICE, true), (BOB, true), (MALLORY, false)] {
                let mut from = before;
                let mut events = Vec::new();
                loop {
                    let page = engine.stream_at(viewer, from, limit, NOW + 10).unwrap();
                    from = page.watermark;
                    events.extend(page.events);
                    if !page.more {
                        break;
                    }
                }
                let named: Vec<_> = events
                    .iter()
                    .filter(|e| e.table == "tasks" && e.id == key)
                    .collect();
                if reads {
                    assert!(
                        named.iter().any(|e| e.kind == "put"),
                        "{op} for {viewer}: {named:?}"
                    );
                } else if op == "born" {
                    assert!(
                        named.is_empty(),
                        "a transient birth names no id to {viewer}: {named:?}"
                    );
                } else {
                    assert!(
                        named.iter().any(|e| e.kind == "del")
                            && named.iter().all(|e| e.kind != "put"),
                        "old reader gets only revocation: {named:?}"
                    );
                }
            }
        }
    }
}

#[test]
fn epoch_leave_rejoin_create_is_blocking_on_both_stores() {
    let b = backend(teams_world());
    // Change the group arm before the three separate commits.
    let (mut schema, programs) = compiled(&b.world.source);
    schema.tables.get_mut("members").unwrap().defaults.insert(
        "principal".into(),
        snapback4_core::schema::ColumnDefault::Literal(id(MALLORY)),
    );
    for limit in [1, 2, 3, 1000] {
        let mut engine = b.fresh();
        engine
            .seed([(
                "members".into(),
                object([
                    ("id", id("mm1")),
                    ("team", id("t1")),
                    ("principal", id(MALLORY)),
                ]),
            )])
            .unwrap();
        engine.adopt(schema.clone(), programs.clone()).unwrap();
        let mut trace = snapshot_trace_at(&mut engine, ALICE, limit);
        let from = engine.seq().unwrap();
        mutate(&mut engine, ALICE, "leave", &[("team", id("t1"))], 1);
        // Alice must be reacquired by an existing t1 member.
        mutate(
            &mut engine,
            MALLORY,
            "add",
            &[("team", id("t1")), ("who", id(ALICE))],
            2,
        );
        mutate(&mut engine, ALICE, "create", &[("team", id("t1"))], 3);
        epoch_stream_trace(&mut engine, from, limit, &mut trace);
        let b = Backend {
            world: teams_world(),
            schema: schema.clone(),
            programs: programs.clone(),
        };
        compare_trace(
            snapback4_device::memory::MemoryStore::new(),
            &b,
            &mut engine,
            ALICE,
            &trace,
        );
        compare_trace(
            snapback4_core::store::Store::memory().unwrap(),
            &b,
            &mut engine,
            ALICE,
            &trace,
        );
    }
}

#[test]
fn roster_and_team_scopes_interleave_with_both_tables_owner_changes() {
    let staff = STAFF
        .replace("mutation ", "mutation staff")
        .replace("query ", "query staff");
    for reverse in [false, true] {
        let writes = [
            "  update tasks[t] { owner: to }",
            "  delete members[m]",
            "  update requests[r] { owner: to }",
            "  delete staff[s]",
        ];
        let writes: Vec<_> = if reverse {
            writes.into_iter().rev().collect()
        } else {
            writes.into_iter().collect()
        };
        let source = format!(
            "{TEAMS}\n{staff}\nmutation interleave(task: tasks, request: requests, to: principal):\n  t = tasks[task] ! else NOT_FOUND\n  m = members[t.team, viewer] ! else NOT_MEMBER\n  r = requests[request] ! else NOT_FOUND\n  s = staff[viewer] ! else NOT_STAFF\n{}\n  return null\n",
            writes.join("\n")
        );
        let (schema, programs) = compiled(&source);
        for limit in [1, 3, 1000] {
            let mut engine = Engine::memory(schema.clone(), programs.clone()).unwrap();
            let mut seed = teams_seed();
            seed.extend([
                (
                    "staff".into(),
                    object([("id", id("sa")), ("principal", id(ALICE))]),
                ),
                (
                    "requests".into(),
                    object([
                        ("id", id("r")),
                        ("owner", id(ALICE)),
                        ("title", Value::String("x".into())),
                        ("at", Value::Int(1)),
                    ]),
                ),
                (
                    "requests".into(),
                    object([
                        ("id", id("private")),
                        ("owner", id(BOB)),
                        ("title", Value::String("x".into())),
                        ("at", Value::Int(2)),
                    ]),
                ),
            ]);
            engine.seed(seed).unwrap();
            let mut trace = snapshot_trace_at(&mut engine, ALICE, limit);
            let from = engine.seq().unwrap();
            mutate(
                &mut engine,
                ALICE,
                "interleave",
                &[("task", id("ka")), ("request", id("r")), ("to", id(BOB))],
                1,
            );
            epoch_stream_trace(&mut engine, from, limit, &mut trace);
            let backend = snapback4_device::device::Backend {
                generation: engine.generation(),
                schema: schema.clone(),
                programs: programs.clone(),
            };
            for query in ["myCount", "staffmine"] {
                let expected = engine
                    .query(query, Context::new(ALICE, BTreeMap::new()).at(NOW + 10))
                    .unwrap()
                    .data;
                epoch_trace_applies(
                    snapback4_device::memory::MemoryStore::new(),
                    backend.clone(),
                    &trace,
                    query,
                    &json!({}),
                    &expected,
                );
                epoch_trace_applies(
                    snapback4_core::store::Store::memory().unwrap(),
                    backend.clone(),
                    &trace,
                    query,
                    &json!({}),
                    &expected,
                );
            }
        }
    }
}

#[test]
fn renewal_epoch_and_sweep_between_pages_name_only_previously_readable_ids() {
    let old = "table members:\n  principal: principal\n  until: time ?\n  unique principal\n  immutable principal\n  expire at .until\n  read <- .principal = viewer\n  insert <- exists members[viewer]\n  update <- .principal = viewer\n  delete <- .principal = viewer\n  sync\ntable notes:\n  at: time\n  read <- exists members[viewer]\n  insert <- exists members[viewer]\n  delete <- exists members[viewer]\n  online only\nquery notes():\n  return notes last 2 by .at\nmutation renew(until: time ?):\n  update members[id = 'ma'] { until }\n  return null\nmutation remove(n: notes):\n  delete notes[n]\n  return null\n";
    let synced = old.replace("  online only", "  sync last 2 by .at");
    let (old_schema, old_programs) = compiled(old);
    let (schema, programs) = compiled(&synced);
    // An expiring group is still outside the union contract, including read-through lifetimes.
    let refused = snapback4_lang::compile(&[(
        "bad.q".into(),
        synced.replace("sync last 2 by .at", "sync").replace(
            "  at: time\n  read <- exists",
            "  owner: principal\n  at: time\n  read <- .owner = viewer or exists",
        ),
    )]);
    assert!(
        refused
            .diagnostics
            .iter()
            .any(|d| d.code == "E_SYNC" && d.message.contains("cannot expire")),
        "{:?}",
        refused.diagnostics
    );
    for limit in [1, 2, 1000] {
        let mut engine = Engine::memory(old_schema.clone(), old_programs.clone()).unwrap();
        engine
            .seed([
                (
                    "members".into(),
                    object([
                        ("id", id("ma")),
                        ("principal", id(ALICE)),
                        ("until", Value::Int(NOW + 100)),
                    ]),
                ),
                (
                    "notes".into(),
                    object([("id", id("old")), ("at", Value::Int(1))]),
                ),
                (
                    "notes".into(),
                    object([("id", id("new")), ("at", Value::Int(2))]),
                ),
            ])
            .unwrap();
        engine.adopt_at(schema.clone(), programs.clone(), NOW).unwrap();
        let mut trace = snapshot_trace_at(&mut engine, ALICE, limit);
        let from = engine.seq().unwrap();
        mutate(
            &mut engine,
            ALICE,
            "renew",
            &[("until", Value::Int(NOW + 200))],
            1,
        );
        mutate(&mut engine, ALICE, "remove", &[("n", id("old"))], 2);
        let first = engine.stream_at(ALICE, from, limit, NOW + 10).unwrap();
        let events:Vec<_>=first.events.iter().map(|e|json!({"table":e.table,"kind":e.kind,"id":e.id,"data":e.data.as_ref().map(wire::to_json)})).collect();
        trace.push(json!({"snapshot":false,"watermark":first.watermark,"more":first.more,"now":NOW+10,"generation":engine.generation(),"events":events,"acquisitions":first.acquisitions,"images_at":first.images_at,"joined":first.joined}));
        // Sweep after the first wire page, then revive through an existing live roster reader.
        engine.sweep_expired(NOW + 201, 100).unwrap();
        engine
            .seed_at(
                [(
                    "members".into(),
                    object([
                        ("id", id("ma")),
                        ("principal", id(ALICE)),
                        ("until", Value::Int(NOW + 1000)),
                    ]),
                )],
                NOW + 300,
            )
            .unwrap();
        stream_trace_at(&mut engine, first.watermark, limit, NOW + 310, &mut trace);
        let expected = engine
            .query("notes", Context::new(ALICE, BTreeMap::new()).at(NOW + 310))
            .unwrap()
            .data;
        let backend = snapback4_device::device::Backend {
            generation: engine.generation(),
            schema: schema.clone(),
            programs: programs.clone(),
        };
        epoch_trace_applies(
            snapback4_device::memory::MemoryStore::new(),
            backend.clone(),
            &trace,
            "notes",
            &json!({}),
            &expected,
        );
        epoch_trace_applies(
            snapback4_core::store::Store::memory().unwrap(),
            backend,
            &trace,
            "notes",
            &json!({}),
            &expected,
        );
    }
}

#[test]
fn a_rebound_already_expired_grant_never_names_its_new_group() {
    let old = "table members:\n  team: text <=20\n  alternate: text <=20\n  person: principal\n  until: time ?\n  immutable team, alternate, person\n  unique team, person\n  unique person\n  read <- .person = viewer\n  insert <- exists members[.team, viewer]\n  delete <- .person = viewer\n  sync\ntable notes:\n  owner: principal\n  team: text <=20\n  body: text <=20\n  read <- .owner = viewer or exists members[.team, viewer]\n  insert <- .owner = viewer\n  sync\nmutation remove(person: principal):\n  m = members[person = person] ! else NOT_FOUND\n  delete members[m]\n  return null\n";
    let new = old.replace("until: time ?", &format!("until: time default {}\n  expire at .until", NOW+50))
        .replace("unique team, person", "unique alternate, person")
        .replace(".owner = viewer or exists members[.team, viewer]", "exists members[.team, viewer]")
        .replace("insert <- exists members[.team, viewer]", "insert <- exists members[.alternate, viewer]");
    let compound = "\nmutation transient(who: principal, until: time):\n  m = insert members { team: 'old-a', alternate: 'never-held', person: who, until }\n  delete members[m]\n  return null\nmutation transientRenew(who: principal, until: time):\n  m = insert members { team: 'old-a', alternate: 'never-held', person: who, until }\n  update members[m] { until: now + 2d }\n  update members[m] { until: now + 3d }\n  delete members[m]\n  return null\n";
    let old=compiled(&format!("{old}{compound}")); let new=compiled(&format!("{new}{compound}").replace("  delete <- .person = viewer", "  update <- .person = viewer\n  delete <- .person = viewer"));
    for op in ["none", "transient", "transientRenew"] {
    for limit in [1,1000] {
        let mut engine=Engine::memory(old.0.clone(),old.1.clone()).unwrap();
        let alice=object([("id",id("ma")),("team",Value::String("old-a".into())),("alternate",Value::String("never-held".into())),("person",id(ALICE))]);
        let bob=object([("id",id("mb")),("team",Value::String("old-b".into())),("alternate",Value::String("live-b".into())),("person",id(BOB)),("until",Value::Int(NOW+1000))]);
        engine.seed_at([("members".into(),alice.clone()),("members".into(),bob)],NOW).unwrap();
        engine.store().conn().execute("UPDATE r SET data = ?1 WHERE id = 'ma'",[snapback4_core::value::canonical_json(&alice)]).unwrap();
        engine.adopt_at(new.0.clone(),new.1.clone(),NOW+100).unwrap();
        let (_,watermark)=engine.snapshot_at(ALICE,NOW+150).unwrap();
        if op != "none" {
            let mut context=Context::system().at(NOW+200).with_ids(["fresh".into()]);
            context.args=BTreeMap::from([("who".into(),id(ALICE)),("until".into(),Value::Int(NOW+1000))]);
            let out=engine.mutate(op,Some(op),context).unwrap();
            assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
        }
        for swept in [false,true] {
            if swept { engine.sweep_expired(NOW+300,100).unwrap(); }
            for from in [0,watermark] {
                let mut from=from;
                loop {
                    let page=engine.stream_at(ALICE,from,limit,NOW+310).unwrap();
                    assert!(page.events.iter().all(|e|e.table!="notes" || e.kind!="scope"),"{swept}, {page:?}");
                    from=page.watermark;if !page.more {break;}
                }
            }
        }
        let (_,from)=engine.snapshot_at(BOB,NOW+310).unwrap();
        mutate(&mut engine,BOB,"remove",&[("person",id(BOB))],400);
        let page=engine.stream_at(BOB,from,limit,NOW+500).unwrap();
        assert!(page.events.iter().any(|e| e.table=="notes" && e.kind=="scope" && e.data==Some(Value::Array(vec![Value::String("live-b".into())]))),"a grant live after activation still revokes: {page:?}");
    }
}
}
