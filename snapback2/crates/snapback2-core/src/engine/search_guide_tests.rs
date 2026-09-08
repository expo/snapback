use super::*;

#[path = "search_guide_fixture.rs"]
mod fixture;

#[test]
fn adjusted_real_chat_certifies_and_executes_search_and_write_fanout() {
    let project: crate::ProjectJson = serde_json::from_str(fixture::PROJECT).unwrap();
    let generation = crate::Generation::certify(&project, Ceilings::default())
        .unwrap_or_else(|e| panic!("full adjusted chat certification: {e:#?}"));
    assert_eq!(generation.programs().len(), 23);
    let certificates: BTreeMap<_, _> = generation
        .programs()
        .iter()
        .map(|(n, (_, c))| (n.clone(), c.clone()))
        .collect();
    let schema = project.schema.clone();
    let viewer = "v".repeat(135);
    let actor = Actor::user(viewer.clone()).unwrap();
    let chat = |i: usize| format!("s2id-00000000000000000000000000000001-{:016x}", i + 1);
    let mut seed = Vec::new();
    for i in 0..100 {
        seed.push((
            "conversations".into(),
            object([
                ("id", Value::Id(chat(i))),
                ("title", Value::String("t".repeat(120))),
                ("creatorId", Value::Id(viewer.clone())),
            ]),
        ));
        seed.push((
            "memberships".into(),
            object([
                ("id", Value::Id(format!("s{i:03}{}", "x".repeat(131)))),
                ("conversationId", Value::Id(chat(i))),
                ("principal", Value::Id(viewer.clone())),
                ("role", Value::String("admin".into())),
                ("joinedAt", Value::Int(crate::value::I53_MAX)),
            ]),
        ));
    }
    // Exactly the real fixture's maximum membership fanout in one conversation.
    for i in 0..49 {
        seed.push((
            "memberships".into(),
            object([
                ("id", Value::Id(format!("other-seat-{i}"))),
                ("conversationId", Value::Id(chat(0))),
                ("principal", Value::Id(format!("other-{i}"))),
                ("role", Value::String("member".into())),
                ("joinedAt", Value::Int(1)),
            ]),
        ));
    }
    seed.push((
        "profiles".into(),
        object([
            ("id", Value::Id("recipient-profile".into())),
            ("principal", Value::Id("other-0".into())),
            ("displayName", Value::String("Recipient".into())),
            ("handle", Value::String("recipient".into())),
            ("bio", Value::String(String::new())),
            ("location", Value::String(String::new())),
        ]),
    ));
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    runtime.seed(&seed).unwrap();

    // A certified native write against the unchanged actual schema constructs
    // the legal maximum combined media row. Real compiled sends below separately
    // exercise their original bodies, membership fanout, maintains and effects.
    let put = Program {
        name: "qualification.putFullMessage".into(),
        kind: ProgramKind::Mutation,
        read_time_granularity_ms: None,
        args: schema.tables["messages"]
            .columns
            .iter()
            .map(|(n, t)| {
                (
                    n.clone(),
                    serde_json::from_value(serde_json::to_value(t).unwrap()).unwrap(),
                )
            })
            .collect(),
        body: vec![Stmt::Insert {
            table: "messages".into(),
            row: Expr::Object(
                schema.tables["messages"]
                    .columns
                    .keys()
                    .map(|n| (n.clone(), Expr::Variable(n.clone())))
                    .collect(),
            ),
        }],
    };
    let put_certificate = Checker::new(&schema, Ceilings::default())
        .check_all(&put)
        .unwrap();
    let body = format!("a{}", "\u{10100}".repeat(3999));
    let term = format!("a{}", "\u{10100}".repeat(1999));
    let mut actual = BTreeMap::new();
    for i in 0..100 {
        for j in 0..2 {
            let args = BTreeMap::from([
                (
                    "id".into(),
                    Value::Id(format!("m{i:03}{j}{}", "x".repeat(130))),
                ),
                ("conversationId".into(), Value::Id(chat(i))),
                ("authorId".into(), Value::Id(viewer.clone())),
                ("body".into(), Value::String(body.clone())),
                (
                    "photo".into(),
                    super::media::asset(&mut runtime, &actor, false),
                ),
                (
                    "clip".into(),
                    super::media::asset(&mut runtime, &actor, true),
                ),
                (
                    "oncePhoto".into(),
                    super::media::asset(&mut runtime, &actor, false),
                ),
                ("expiresAt".into(), Value::Int(crate::value::I53_MAX)),
                ("at".into(), Value::Int((i * 2 + j) as i64)),
            ]);
            let mut context = Context::mutation(actor.clone(), args);
            context.now = Some(1);
            let execution = runtime
                .engine
                .execute(&put, &put_certificate, context)
                .unwrap();
            assert!(matches!(execution.state, ExecutionState::Committed { .. }));
            measured(&put_certificate, &execution);
        }
    }
    let query_args = |cursor| {
        BTreeMap::from([
            ("term".into(), Value::String(term.clone())),
            ("c".into(), cursor),
        ])
    };
    let first = runtime
        .execute(
            "search.global",
            Context::query(actor.clone(), query_args(Value::Null)),
        )
        .unwrap();
    assert_eq!(first.state, ExecutionState::Capped);
    assert_eq!(ids(&first).len(), 20);
    assert_eq!(ids(&first)[0], format!("m0991{}", "x".repeat(130)));
    assert_eq!(
        first
            .receipt
            .rows
            .iter()
            .filter(|r| r.table == "memberships")
            .count(),
        100
    );
    assert!(
        first
            .receipt
            .rows
            .iter()
            .filter(|r| r.table == "messages")
            .count()
            <= 122
    );
    actual.insert(
        "search.global",
        measured(&certificates["search.global"], &first),
    );
    let next = runtime
        .execute(
            "search.global",
            Context::query(
                actor.clone(),
                query_args(Value::String(first.next.clone().unwrap())),
            ),
        )
        .unwrap();
    assert_eq!(ids(&next).len(), 20);
    assert!(!ids(&next).iter().any(|id| ids(&first).contains(id)));
    actual.insert(
        "search.global.next",
        measured(&certificates["search.global"], &next),
    );
    let mut args = query_args(Value::Null);
    args.insert("conversationId".into(), Value::Id(chat(0)));
    let in_chat = runtime
        .execute("search.inConversation", Context::query(actor.clone(), args))
        .unwrap();
    assert_eq!(ids(&in_chat).len(), 2);
    assert_eq!(in_chat.state, ExecutionState::Complete);
    actual.insert(
        "search.inConversation",
        measured(&certificates["search.inConversation"], &in_chat),
    );

    let write = |runtime: &mut crate::Runtime, name: &str, args, now| {
        let mut context = Context::mutation(actor.clone(), args);
        context.now = Some(now);
        context.new_ids = runtime.reserve_new_ids().unwrap();
        let execution = runtime.execute(name, context).unwrap();
        assert!(
            matches!(execution.state, ExecutionState::Committed { .. }),
            "{name}: {execution:?}"
        );
        execution
    };
    let sent = write(
        &mut runtime,
        "messages.send",
        BTreeMap::from([
            ("conversationId".into(), Value::Id(chat(0))),
            ("recipientId".into(), Value::Id("recipient-profile".into())),
            ("body".into(), Value::String("\u{1f82}".repeat(4000))),
        ]),
        500,
    );
    assert_eq!(sent.trace.writes.get("deliveries"), Some(&50));
    assert_eq!(sent.trace.emits.len(), 1);
    assert!(sent.trace.writes.contains_key("messageCounts"));
    actual.insert(
        "messages.send",
        measured(&certificates["messages.send"], &sent),
    );
    for (name, field, video) in [
        ("messages.sendPhoto", "photo", false),
        ("messages.sendClip", "clip", true),
        ("messages.sendOncePhoto", "photo", false),
    ] {
        let asset = super::media::asset(&mut runtime, &actor, video);
        let execution = write(
            &mut runtime,
            name,
            BTreeMap::from([
                ("conversationId".into(), Value::Id(chat(0))),
                (field.into(), asset),
            ]),
            600,
        );
        if name == "messages.sendOncePhoto" {
            assert_eq!(execution.trace.writes.get("deliveries"), Some(&50));
        }
        actual.insert(name, measured(&certificates[name], &execution));
    }
    let profile_args = |name: &str| {
        BTreeMap::from([
            ("displayName".into(), Value::String(name.into())),
            (
                "handle".into(),
                Value::String("abcdefghijklmnopqrst".into()),
            ),
            ("bio".into(), Value::String("𐐀".repeat(200))),
            ("location".into(), Value::String("𐐀".repeat(50))),
            ("avatarUrl".into(), Value::Null),
            ("link".into(), Value::Null),
        ])
    };
    let created = write(
        &mut runtime,
        "profiles.createMyProfile",
        profile_args(&"\u{1f82}".repeat(50)),
        700,
    );
    actual.insert(
        "profiles.createMyProfile",
        measured(&certificates["profiles.createMyProfile"], &created),
    );
    let updated = write(
        &mut runtime,
        "profiles.updateMyProfile",
        profile_args("Café"),
        701,
    );
    actual.insert(
        "profiles.updateMyProfile",
        measured(&certificates["profiles.updateMyProfile"], &updated),
    );
    let people = runtime
        .execute(
            "search.findPeople",
            Context::query(
                actor,
                BTreeMap::from([
                    ("term".into(), Value::String("CAFE\u{301}".into())),
                    ("c".into(), Value::Null),
                ]),
            ),
        )
        .unwrap();
    assert_eq!(people.result.as_array().unwrap().len(), 1);
    assert_eq!(
        people.result.as_array().unwrap()[0]
            .field("displayName")
            .unwrap(),
        &Value::String("Café".into())
    );
    actual.insert(
        "search.findPeople",
        measured(&certificates["search.findPeople"], &people),
    );
    if let Ok(path) = std::env::var("SNAPBACK_SEARCH_GUIDE_EVIDENCE") {
        std::fs::write(path, canonical_json(&serde_json::json!({
            "certificates": certificates, "actual": actual,
            "message_row_max": crate::bounds::declared_serialized_row_max(&schema, "messages"),
            "membership_row_max": crate::bounds::declared_serialized_row_max(&schema, "memberships"),
            "combined_media_row_write": { "program": put, "certificate": put_certificate },
        }))).unwrap();
    }
}

fn measured(certificate: &crate::Certificate, execution: &Execution) -> serde_json::Value {
    let closure = canonical_json(&execution.receipt).len() as u64;
    assert!(execution.trace.steps <= certificate.max_steps);
    assert!(execution.trace.derived_steps <= certificate.derived_steps);
    assert!(execution.trace.derived_scratch_bytes <= certificate.derived_scratch_bytes);
    assert!(certificate.max_steps <= 1_000_000);
    assert!(certificate.max_heap_bytes <= 8 * 1024 * 1024);
    // Mutations do not deliver a query closure.
    if !matches!(execution.state, ExecutionState::Committed { .. }) {
        assert!(
            closure <= certificate.max_closure_bytes,
            "closure {closure} > {}",
            certificate.max_closure_bytes
        );
    }
    assert!(certificate.max_closure_bytes < 4 * 1024 * 1024);
    serde_json::json!({"steps":execution.trace.steps,"derived_steps":execution.trace.derived_steps,
        "derived_scratch_bytes":execution.trace.derived_scratch_bytes,"closure_bytes":closure,
        "writes":execution.trace.writes,"emits":execution.trace.emits.len()})
}
