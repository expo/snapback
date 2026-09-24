use snapback4_core::{Context, Engine, Value, WriteState, value::object};
const SOURCE: &str = include_str!("fixtures/row-keyed-view.q");
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn id(s: &str) -> Value {
    Value::Id(s.into())
}
fn ctx(args: &[(&str, Value)], now: i64) -> Context {
    Context::new(
        "alice",
        args.iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect(),
    )
    .at(now)
}
fn write(e: &mut Engine, name: &str, args: &[(&str, Value)]) {
    let result = e.mutate(name, None, ctx(args, 1)).unwrap();
    assert!(
        matches!(result.state, WriteState::Sent { .. }),
        "{name}: {result:?}"
    );
}
fn count(e: &mut Engine, member: &str, expected: i64) {
    let r = e
        .query("unreadFor", ctx(&[("member", id(member))], 1))
        .unwrap();
    assert!(r.complete, "{r:?}");
    assert_eq!(r.data, Value::Int(expected), "{member}: {r:?}");
}
fn join(e: &mut Engine, member: &str, principal: &str, mark: i64, joined: i64) {
    write(
        e,
        "join",
        &[
            ("id", id(member)),
            ("conversationId", id("c")),
            ("principal", id(principal)),
            ("readUpTo", Value::Int(mark)),
            ("joinedAt", Value::Int(joined)),
        ],
    );
}
fn send(e: &mut Engine, name: &str, n: i64, who: &str, until: Value) {
    write(
        e,
        "send",
        &[
            ("id", id(name)),
            ("conversationId", id("c")),
            ("ordinal", Value::Int(n)),
            ("senderId", id(who)),
            ("until", until),
        ],
    );
}
#[test]
fn parse_bind_and_explain() {
    let b = bound(SOURCE);
    let m = &b.schema.maintains[0];
    let k = m.row_key.as_ref().unwrap();
    assert_eq!(k.table, "members");
    assert_eq!(k.fanout, 100);
    assert!(snapback4_lang::guide::explain_code("E_VIEW_KEY").is_some());
    assert!(
        b.schema.tables["messages"]
            .indexes
            .contains_key(&k.range_index("ordinal"))
    );
}
#[test]
fn rejected_shapes_have_rewrites() {
    let good = ".conversationId = m.conversationId and .ordinal > m.readUpTo\n    and .senderId != m.principal and not .tombstone and .ordinal > m.joinedAt";
    for bad in [
        ".ordinal > m.readUpTo",
        ".conversationId = m.conversationId and .conversationId = m.conversationId",
        ".conversationId != m.conversationId",
        ".conversationId = m.conversationId or .ordinal > m.readUpTo",
        ".conversationId = m.conversationId and m.readUpTo > 0",
        ".conversationId = m.conversationId and .ordinal > m.readUpTo + 1",
        ".conversationId = m.conversationId and exists members[.conversationId, viewer]",
        ".conversationId = m.conversationId and .senderId = viewer",
        ".conversationId = m.conversationId and not (.ordinal > m.readUpTo)",
    ] {
        let b = snapback4_lang::compile(&[("bad.q".into(), SOURCE.replace(good, bad))]);
        assert!(
            b.diagnostics.iter().any(|d| d.code == "E_VIEW_KEY"
                && d.rewrite.contains("view unread:")
                && d.guide == "maintains"),
            "{bad}: {:?}",
            b.diagnostics
        );
    }
}
fn lifecycle(mut e: Engine) {
    join(&mut e, "a", "alice", 0, 0);
    join(&mut e, "b", "bob", 2, 0);
    join(&mut e, "c", "carol", 0, 2);
    for n in 1..=4 {
        send(&mut e, &format!("m{n}"), n, "alice", Value::Null);
    }
    count(&mut e, "a", 0);
    count(&mut e, "b", 2);
    count(&mut e, "c", 2);
    send(&mut e, "other", 4, "bob", Value::Null);
    count(&mut e, "a", 1);
    count(&mut e, "b", 2);
    count(&mut e, "c", 3);
    write(&mut e, "tombstone", &[("message", id("m3"))]);
    count(&mut e, "b", 1);
    count(&mut e, "c", 2);
    write(
        &mut e,
        "edit",
        &[
            ("message", id("m2")),
            ("ordinal", Value::Int(5)),
            ("senderId", id("carol")),
        ],
    );
    count(&mut e, "a", 2);
    count(&mut e, "b", 2);
    count(&mut e, "c", 2);
    write(&mut e, "remove", &[("message", id("m4"))]);
    count(&mut e, "b", 1);
    count(&mut e, "c", 1);
    write(
        &mut e,
        "mark",
        &[("member", id("b")), ("readUpTo", Value::Int(5))],
    );
    count(&mut e, "b", 0);
    send(&mut e, "exp", 6, "alice", Value::Int(10));
    count(&mut e, "b", 1);
    let live = e
        .query("unreadFor", ctx(&[("member", id("b"))], 11))
        .unwrap();
    assert!(live.complete);
    assert_eq!(live.data, Value::Int(0));
    assert_eq!(e.sweep_expired(11, 100).unwrap(), 1);
    count(&mut e, "b", 0);
    write(&mut e, "leave", &[("member", id("c"))]);
    assert!(
        e.store()
            .rows("unread")
            .unwrap()
            .iter()
            .all(|v| v.field("member") != Ok(&id("c")))
    );
}
#[test]
fn lifecycle_memory() {
    let b = bound(SOURCE);
    lifecycle(Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap());
}
#[test]
fn lifecycle_sqlite() {
    let b = bound(SOURCE);
    let dir = std::env::temp_dir().join(format!("b3-lifecycle-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("store.sqlite");
    let _ = std::fs::remove_file(&path);
    lifecycle(
        Engine::new(
            snapback4_core::Store::open(&path).unwrap(),
            b.schema,
            b.programs.into_iter().map(|p| p.program),
        )
        .unwrap(),
    );
    let _ = std::fs::remove_file(path);
}
#[test]
fn large_mark_commits_pending_then_settles() {
    let source = SOURCE.replace("  expire at .until\n", "");
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 0, 0);
    e.seed((1..=10000).map(|n| {
        (
            "messages".into(),
            object([
                ("id", id(&format!("m{n:05}"))),
                ("conversationId", id("c")),
                ("ordinal", Value::Int(n)),
                ("senderId", id("alice")),
                ("tombstone", Value::Bool(false)),
                ("until", Value::Null),
            ]),
        )
    }))
    .unwrap();
    count(&mut e, "b", 10000);
    write(
        &mut e,
        "mark",
        &[("member", id("b")), ("readUpTo", Value::Int(10000))],
    );
    let r = e
        .query("unreadFor", ctx(&[("member", id("b"))], 1))
        .unwrap();
    assert!(!r.complete, "{r:?}");
    let mut chunks = 0;
    while let Some(m) = e.run_view_chunk(1).unwrap() {
        chunks += 1;
        assert!(m.examined <= 260, "{m:?}");
        assert!(chunks < 50);
    }
    assert!(chunks >= 40);
    count(&mut e, "b", 0);
}

#[test]
fn small_mark_uses_the_changed_range_in_a_large_chat() {
    let source = SOURCE.replace("  expire at .until\n", "");
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 9998, 0);
    e.seed((1..=10000).map(|n| {
        (
            "messages".into(),
            object([
                ("id", id(&format!("m{n:05}"))),
                ("conversationId", id("c")),
                ("ordinal", Value::Int(n)),
                ("senderId", id("alice")),
                ("tombstone", Value::Bool(false)),
                ("until", Value::Null),
            ]),
        )
    }))
    .unwrap();
    count(&mut e, "b", 2);
    let r = e
        .mutate(
            "mark",
            None,
            ctx(&[("member", id("b")), ("readUpTo", Value::Int(9999))], 1),
        )
        .unwrap();
    assert!(matches!(r.state, WriteState::Sent { .. }), "{r:?}");
    assert!(r.metered.examined < 25, "{r:?}");
    count(&mut e, "b", 1);
    assert!(e.run_view_chunk(1).unwrap().is_none());
}
#[test]
fn recount_survives_restart_and_concurrent_changes_on_both_sides_of_cursor() {
    let source = SOURCE.replace("  expire at .until\n", "");
    let b = bound(&source);
    let dir = std::env::temp_dir().join(format!("b3-restart-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("store.sqlite");
    let _ = std::fs::remove_file(&path);
    let mut e = Engine::new(
        snapback4_core::Store::open(&path).unwrap(),
        b.schema,
        b.programs.into_iter().map(|p| p.program),
    )
    .unwrap();
    join(&mut e, "b", "bob", 0, 0);
    e.seed((1..=10000).map(|n| {
        (
            "messages".into(),
            object([
                ("id", id(&format!("m{n:05}"))),
                ("conversationId", id("c")),
                ("ordinal", Value::Int(n)),
                ("senderId", id("alice")),
                ("tombstone", Value::Bool(false)),
                ("until", Value::Null),
            ]),
        )
    }))
    .unwrap();
    write(
        &mut e,
        "mark",
        &[("member", id("b")), ("readUpTo", Value::Int(5000))],
    );
    e.run_view_chunk(1).unwrap().unwrap();
    drop(e);
    let mut e = Engine::open(snapback4_core::Store::open(&path).unwrap()).unwrap();
    write(
        &mut e,
        "edit",
        &[
            ("message", id("m00001")),
            ("ordinal", Value::Int(6000)),
            ("senderId", id("alice")),
        ],
    );
    write(&mut e, "tombstone", &[("message", id("m09000"))]);
    send(&mut e, "a-before-cursor", 7000, "alice", Value::Null);
    send(&mut e, "z-after-cursor", 8000, "alice", Value::Null);
    write(&mut e, "remove", &[("message", id("m08000"))]);
    while e.run_view_chunk(1).unwrap().is_some() {}
    count(&mut e, "b", 5001);
    // Replacing a mark while pending cancels its partial prefix, in the same transaction.
    write(
        &mut e,
        "mark",
        &[("member", id("b")), ("readUpTo", Value::Int(0))],
    );
    e.run_view_chunk(1).unwrap();
    write(
        &mut e,
        "mark",
        &[("member", id("b")), ("readUpTo", Value::Int(10000))],
    );
    while e.run_view_chunk(1).unwrap().is_some() {}
    count(&mut e, "b", 0);
    drop(e);
    let _ = std::fs::remove_dir_all(dir);
}
#[test]
fn unread_inherits_member_authority_and_expiry_timer() {
    let source=SOURCE.replacen("  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public", "  read <- .principal = viewer\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync to .principal",1);
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 0, 0);
    send(&mut e, "m1", 1, "alice", Value::Int(10));
    let r = e
        .query(
            "unreadFor",
            Context::new("bob", [("member".into(), id("b"))].into()).at(1),
        )
        .unwrap();
    assert!(r.complete);
    assert_eq!(r.data, Value::Int(1));
    assert_eq!(r.next_expiry, Some(10));
    let hidden = e
        .query("unreadFor", ctx(&[("member", id("b"))], 1))
        .unwrap();
    assert_eq!(hidden.data, Value::Int(0));
}
#[test]
fn live_cap_ignores_unswept_expired_members() {
    let source = SOURCE.replace(
        "  cap 100 by conversationId",
        "  cap 1 by conversationId\n  expires: time default 10\n  expire at .expires",
    );
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "a", "alice", 0, 0);
    e.seed([(
        "members".into(),
        object([
            ("id", id("b")),
            ("conversationId", id("c")),
            ("principal", id("bob")),
            ("readUpTo", Value::Int(0)),
            ("joinedAt", Value::Int(0)),
            ("expires", Value::Int(100)),
        ]),
    )])
    .unwrap();
    let result = e
        .mutate(
            "send",
            None,
            ctx(
                &[
                    ("id", id("m")),
                    ("conversationId", id("c")),
                    ("ordinal", Value::Int(1)),
                    ("senderId", id("alice")),
                    ("until", Value::Null),
                ],
                11,
            ),
        )
        .unwrap();
    assert!(
        matches!(result.state, WriteState::Sent { .. }),
        "{result:?}"
    );
    let r = e
        .query("unreadFor", ctx(&[("member", id("b"))], 11))
        .unwrap();
    assert_eq!(r.data, Value::Int(1));
    assert_eq!(r.next_expiry, Some(100));
}

#[test]
fn existence_with_expiring_sources_and_raw_metadata_refusals() {
    let b = bound(
        &(SOURCE.to_owned()
            + "\nquery existsUnread(member: members):\n  return exists unread[member = member]\n"),
    );
    let mut e =
        Engine::memory(b.schema.clone(), b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 0, 0);
    send(&mut e, "m", 1, "alice", Value::Int(10));
    let r = e
        .query("existsUnread", ctx(&[("member", id("b"))], 1))
        .unwrap();
    assert_eq!(r.data, Value::Bool(true));
    for kind in 0..5 {
        let mut s = b.schema.clone();
        match kind {
            0 => {
                s.maintains[0].row_key.as_mut().unwrap().predicate =
                    snapback4_core::maintain::Predicate::Bool(true)
            }
            1 => s.maintains[0].row_key.as_mut().unwrap().fanout = 100000,
            2 => {
                s.tables.get_mut("unread").unwrap().rules.read =
                    snapback4_core::schema::RuleExpr::Deny;
            }
            3 => {
                s.tables
                    .get_mut("unread")
                    .unwrap()
                    .columns
                    .remove("recountPending");
            }
            _ => {
                s.tables
                    .get_mut("members")
                    .unwrap()
                    .columns
                    .insert("value".into(), snapback4_core::schema::ColumnType::Int);
            }
        }
        assert!(
            snapback4_core::schema::validate(&s)
                .iter()
                .any(|i| i.message.contains("E_VIEW_KEY")),
            "raw mutation {kind}"
        );
    }
}

#[test]
fn emitted_work_and_chunked_deletes_maintain_all_members() {
    let b = bound(
        &(SOURCE.to_owned()
            + "\neffect deleted\njob cleanup():\n  for msg in messages:\n    emit deleted { message: msg.id }\n    delete messages[msg.id]\n"),
    );
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 0, 0);
    join(&mut e, "c", "carol", 0, 0);
    for n in 1..=5 {
        send(&mut e, &format!("m{n}"), n, "alice", Value::Null);
    }
    let run = e.run_job("cleanup", Default::default(), 1).unwrap();
    assert_eq!(run.state, snapback4_core::JobState::Done);
    count(&mut e, "b", 0);
    count(&mut e, "c", 0);
}
#[test]
fn row_key_requires_same_parent_and_bounded_recipients() {
    for source in [
        SOURCE.replace("  cap 100 by conversationId\n", ""),
        SOURCE.replacen("conversationId: conversations", "conversationId: id", 1),
        SOURCE.replace(
            "conversationId: conversations",
            "conversationId: conversations ?",
        ),
        SOURCE.replace(
            "count messages by members m",
            "sum messages of .ordinal by members m",
        ),
    ] {
        let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(
            b.diagnostics
                .iter()
                .any(|d| d.code == "E_VIEW_KEY" && !d.rewrite.is_empty()),
            "{:?}",
            b.diagnostics
        );
    }
}

#[test]
fn member_expiry_ends_existence_and_rule_authority_before_sweep() {
    let source = SOURCE.replace(
        "  cap 100 by conversationId",
        "  cap 100 by conversationId\n  until: time default 10\n  expire at .until",
    ) + "\nquery viewExists(member: members):\n  return exists unread[member = member]\ntable secrets:\n  member: members\n  read <- exists unread[member = .member]\nquery secrets():\n  return secrets first 10\n";
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 0, 0);
    e.seed([(
        "secrets".into(),
        object([("id", id("secret")), ("member", id("b"))]),
    )])
    .unwrap();
    let before = e
        .query("viewExists", ctx(&[("member", id("b"))], 1))
        .unwrap();
    assert_eq!(before.data, Value::Bool(true));
    assert_eq!(before.next_expiry, Some(10));
    assert_eq!(
        e.query("viewExists", ctx(&[("member", id("b"))], 11))
            .unwrap()
            .data,
        Value::Bool(false)
    );
    assert_eq!(
        e.query("secrets", ctx(&[], 11)).unwrap().data,
        Value::Array(vec![])
    );
}

#[test]
fn defaulted_member_fields_are_materialized_in_durable_recounts() {
    let final_source = SOURCE
        .replace("  expire at .until\n", "")
        .replace("readUpTo: int default 0", "readUpTo: int default 5000");
    let start = final_source.find("view unread:").unwrap();
    let before = final_source[..start].replace("  readUpTo: int default 5000\n", "");
    let b = bound(&before);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([(
        "members".into(),
        object([
            ("id", id("b")),
            ("conversationId", id("c")),
            ("principal", id("bob")),
            ("joinedAt", Value::Int(0)),
        ]),
    )])
    .unwrap();
    e.seed((1..=10000).map(|n| {
        (
            "messages".into(),
            object([
                ("id", id(&format!("m{n:05}"))),
                ("conversationId", id("c")),
                ("ordinal", Value::Int(n)),
                ("senderId", id("alice")),
                ("tombstone", Value::Bool(false)),
                ("until", Value::Null),
            ]),
        )
    }))
    .unwrap();
    let b = bound(&final_source);
    e.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), 1)
        .unwrap();
    assert!(
        !e.query("unreadFor", ctx(&[("member", id("b"))], 1))
            .unwrap()
            .complete
    );
    while e.run_view_chunk(1).unwrap().is_some() {}
    count(&mut e, "b", 5000);
    assert_eq!(
        e.store().rows("unread").unwrap()[0].field("readUpTo"),
        Ok(&Value::Int(5000))
    );
}

#[test]
fn incomplete_counts_cannot_authorize_writes_or_numeric_probes() {
    let source = SOURCE.to_owned()
        + "\nmutation depend(member: members):\n  n = unread[member]\n  update members[member] { readUpTo: n }\nquery valueExists(member: members):\n  return exists unread[member = member, value = 1200]\n";
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 0, 0);
    e.seed((1..=1200).map(|n| {
        (
            "messages".into(),
            object([
                ("id", id(&format!("m{n:05}"))),
                ("conversationId", id("c")),
                ("ordinal", Value::Int(n)),
                ("senderId", id("alice")),
                ("tombstone", Value::Bool(false)),
                ("until", Value::Int(10000)),
            ]),
        )
    }))
    .unwrap();
    let settled = e
        .query("unreadFor", ctx(&[("member", id("b"))], 1))
        .unwrap();
    assert!(settled.complete, "{settled:?}");
    assert_eq!(settled.data, Value::Int(1200));
    // The live expiry scan exceeds the writer slice even before stored pending is set.
    let r = e.mutate("depend", None, ctx(&[("member", id("b"))], 1));
    assert!(format!("{r:?}").contains("E_VIEW_KEY"), "{r:?}");
    write(
        &mut e,
        "mark",
        &[("member", id("b")), ("readUpTo", Value::Int(1200))],
    );
    let r = e.query("valueExists", ctx(&[("member", id("b"))], 1)).unwrap();
    assert!(!r.complete, "{r:?}"); // A query's scalar existence result carries the same pending fact.
    let r = e.mutate("depend", None, ctx(&[("member", id("b"))], 1));
    assert!(format!("{r:?}").contains("E_VIEW_KEY"), "{r:?}");
    while e.run_view_chunk(1).unwrap().is_some() {}
    count(&mut e, "b", 0);
}

#[test]
fn counts_cannot_be_indexed_for_rules_or_ranking() {
    for extra in [
        "\ntable secrets:\n  read <- exists unread[value = 1]\n",
        "\nquery ranked():\n  return unread last 1 by .value\n",
    ] {
        let b = snapback4_lang::compile(&[("schema.q".into(), SOURCE.replace("  expire at .until\n", "") + extra)]);
        assert!(
            b.diagnostics
                .iter()
                .any(|d| d.code == "E_VIEW_KEY" && d.rewrite.contains("view unread:")),
            "{:?}",
            b.diagnostics
        );
    }
}
