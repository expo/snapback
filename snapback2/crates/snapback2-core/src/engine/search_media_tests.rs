use super::*;

pub(super) fn asset(runtime: &mut crate::Runtime, actor: &Actor, video: bool) -> Value {
    let kind = if video {
        crate::AssetKind::Video
    } else {
        crate::AssetKind::Image
    };
    let id = runtime.begin_asset(kind, actor, 0).unwrap();
    runtime.reserve_asset_finalized_bytes(&id, 100).unwrap();
    runtime
        .mark_asset_ready(
            &id,
            &crate::AssetReadyFacts {
                media_type: if video {
                    "video/mp4".into()
                } else {
                    "image/png".into()
                },
                bytes: 100,
                width: crate::value::I53_MAX,
                height: crate::value::I53_MAX,
                duration: video.then_some(crate::value::I53_MAX),
            },
        )
        .unwrap();
    let mut fields = BTreeMap::from([
        ("id".into(), Value::String(id)),
        ("width".into(), Value::Int(crate::value::I53_MAX)),
        ("height".into(), Value::Int(crate::value::I53_MAX)),
    ]);
    if video {
        fields.insert("duration".into(), Value::Int(crate::value::I53_MAX));
    }
    Value::Map(fields.into())
}
fn pad_width(schema: &mut Schema, table: &str, target: u64) -> usize {
    let current = crate::bounds::declared_serialized_row_max(schema, table);
    let max = target
        .checked_sub(current + "pad".len() as u64 + 4 + 16)
        .unwrap();
    schema.tables.get_mut(table).unwrap().columns.insert(
        "pad".into(),
        if max == 0 {
            ColumnType::Text { max: 0 }
        } else {
            ColumnType::Json {
                max_bytes: max as u32,
            }
        },
    );
    assert_eq!(
        crate::bounds::declared_serialized_row_max(schema, table),
        target
    );
    max as usize
}

#[test]
fn maximum_media_shape_and_twenty_kib_stress_fit_actual_closure_and_scratch() {
    // Exact compiler recipe with the public chat template's actual scope name,
    // optional 4000-scalar body, image/video/once-photo and expiry/author fields.
    let raw = crate::certificate::search::tests::RECIPES
        .replace("\"conversation\"", "\"conversationId\"");
    let project = crate::certificate::search::tests::project(&raw);
    let program = program(&project.programs, "search.global");
    let mut base = project.schema;
    let messages = base.tables.get_mut("messages").unwrap();
    messages.columns.extend([
        ("authorId".into(), ColumnType::Principal),
        (
            "photo".into(),
            ColumnType::Optional(Box::new(ColumnType::Image {
                max: 5_000_000,
                once: false,
            })),
        ),
        (
            "clip".into(),
            ColumnType::Optional(Box::new(ColumnType::Video { max: 50_000_000 })),
        ),
        (
            "oncePhoto".into(),
            ColumnType::Optional(Box::new(ColumnType::Image {
                max: 5_000_000,
                once: true,
            })),
        ),
        (
            "expiresAt".into(),
            ColumnType::Optional(Box::new(ColumnType::Time)),
        ),
    ]);
    base.tables.get_mut("memberships").unwrap().columns.extend([
        (
            "role".into(),
            ColumnType::Enum {
                variants: vec!["member".into(), "admin".into()],
            },
        ),
        ("joinedAt".into(), ColumnType::Time),
    ]);
    for stress in [false, true] {
        let mut schema = base.clone();
        let (message_pad, member_pad) = if stress {
            (
                pad_width(&mut schema, "messages", 20 * 1024),
                pad_width(&mut schema, "memberships", 576),
            )
        } else {
            (0, 0)
        };
        schema.tables.get_mut("messages").unwrap().rules.insert = RuleExpr::Allow;
        let certificate = Checker::new(&schema, Ceilings::default())
            .check_all(&program)
            .unwrap_or_else(|e| panic!("stress={stress}: {e:#?}"));
        assert!(certificate.max_closure_bytes < 4 * 1024 * 1024);
        assert!(certificate.max_heap_bytes < 8 * 1024 * 1024);
        let put = Program {
            name: "media.put".into(),
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
        let generation = crate::Generation::certify(
            &crate::ProjectJson {
                version: 1,
                auth: Default::default(),
                schema: schema.clone(),
                programs: vec![program.clone(), put.clone()],
                effects: vec![],
            },
            Ceilings::default(),
        )
        .unwrap();
        let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
        let viewer = "p".repeat(135);
        let actor = Actor::user(viewer.clone()).unwrap();
        let padding = |n: usize| Value::String("𐐀".repeat(n.saturating_sub(13) / 4));
        for i in 0..100 {
            let c = format!("c{i:03}{}", "x".repeat(131));
            let mut membership = BTreeMap::from([
                (
                    "id".into(),
                    Value::Id(format!("s{i:03}{}", "x".repeat(131))),
                ),
                ("conversationId".into(), Value::Id(c.clone())),
                ("principal".into(), Value::Id(viewer.clone())),
                ("role".into(), Value::String("member".into())),
                ("joinedAt".into(), Value::Int(crate::value::I53_MAX)),
            ]);
            if stress {
                membership.insert("pad".into(), padding(member_pad));
            }
            runtime
                .engine
                .seed("memberships", Value::Row(membership.into()))
                .unwrap();
            for j in 0..2 {
                let mut row = BTreeMap::from([
                    (
                        "id".into(),
                        Value::Id(format!("m{i:03}{j}{}", "x".repeat(130))),
                    ),
                    ("conversationId".into(), Value::Id(c.clone())),
                    ("authorId".into(), Value::Id(viewer.clone())),
                    (
                        "body".into(),
                        Value::String(format!("a{}", "\u{10100}".repeat(3999))),
                    ),
                    ("caption".into(), Value::String("\u{10100}".repeat(50))),
                    ("photo".into(), asset(&mut runtime, &actor, false)),
                    ("oncePhoto".into(), asset(&mut runtime, &actor, false)),
                    ("clip".into(), asset(&mut runtime, &actor, true)),
                    ("at".into(), Value::Int(i * 2 + j)),
                    ("expiresAt".into(), Value::Int(crate::value::I53_MAX)),
                ]);
                if stress {
                    row.insert("pad".into(), padding(message_pad));
                }
                let write = runtime
                    .execute("media.put", Context::mutation(actor.clone(), row))
                    .unwrap();
                assert!(
                    matches!(write.state, ExecutionState::Committed { .. }),
                    "{write:?}"
                );
            }
        }
        let context = Context::query(
            Actor::user(viewer).unwrap(),
            BTreeMap::from([
                (
                    "term".into(),
                    Value::String(format!("a{}", "\u{10100}".repeat(1999))),
                ),
                ("c".into(), Value::Null),
            ]),
        );
        let execution = runtime
            .engine
            .execute(&program, &certificate, context)
            .unwrap();
        assert_eq!(ids(&execution).len(), 20);
        execution.receipt.validate_pool(&schema).unwrap();
        let bytes = canonical_json(&execution.receipt).len() as u64;
        assert!(bytes <= certificate.max_closure_bytes);
        assert!(execution.trace.derived_scratch_bytes <= certificate.derived_scratch_bytes);
        assert!(execution.trace.derived_steps <= certificate.derived_steps);
        assert_eq!(
            execution
                .receipt
                .rows
                .iter()
                .filter(|r| r.table == "memberships")
                .count(),
            100
        );
        assert!(
            execution
                .receipt
                .rows
                .iter()
                .filter(|r| r.table == "messages")
                .count()
                <= 122
        );
        println!(
            "SEARCH_MEDIA {}",
            canonical_json(
                &serde_json::json!({"stress":stress,"row_width":crate::bounds::declared_serialized_row_max(&schema,"messages"),"membership_width":crate::bounds::declared_serialized_row_max(&schema,"memberships"),"certificate":certificate,"actual_closure_bytes":bytes,"actual_derived_steps":execution.trace.derived_steps,"actual_derived_scratch_bytes":execution.trace.derived_scratch_bytes})
            )
        );
    }
}
