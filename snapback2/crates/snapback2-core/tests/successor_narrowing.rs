use snapback2_core::*;
use std::collections::BTreeMap;

fn generation(kind: ColumnType) -> Generation {
    let table = public_table(
        BTreeMap::from([("id".into(), ColumnType::Id), ("value".into(), kind)]),
        BTreeMap::from([(
            "byId".into(),
            Index {
                columns: vec!["id".into()],
                unique: true,
            },
        )]),
    );
    Generation::certify(
        &ProjectJson {
            version: 1,
            auth: Auth::default(),
            effects: vec![],
            programs: vec![],
            schema: Schema {
                tables: BTreeMap::from([("items".into(), table)]),
                ..Schema::default()
            },
        },
        Ceilings::default(),
    )
    .unwrap()
}
fn runtime(kind: ColumnType, values: Vec<Option<Value>>) -> Runtime {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(kind)).unwrap();
    let rows = values
        .into_iter()
        .enumerate()
        .map(|(i, value)| {
            let mut row = BTreeMap::from([("id".into(), Value::Id(format!("id-{i:02}")))]);
            if let Some(value) = value {
                row.insert("value".into(), value);
            }
            ("items".into(), Value::Row(row))
        })
        .collect::<Vec<_>>();
    runtime.seed(&rows).unwrap();
    runtime
}
fn optional(t: ColumnType) -> ColumnType {
    ColumnType::Optional(Box::new(t))
}
fn read_values(runtime: &mut Runtime) -> Value {
    let query = Program {
        name: "inspect".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "items".into(),
            table: "items".into(),
            index: "byId".into(),
            prefix: vec![],
            take: Bound::Literal(30),
            order: Order::Asc,
            after: None,
            before: None,
            range: None,
            opaque_cursor: false,
            merge_site: None,
            provenance: KeyProvenance::Const,
        }))],
    };
    runtime
        .read_operator(&query, BTreeMap::new(), OperatorId("alice".into()), 10)
        .unwrap()
        .result
}
#[test]
fn narrowing_admits_non_null_rows_in_place_through_successor_and_migration() {
    for migration in [false, true] {
        let mut runtime = runtime(
            optional(ColumnType::Int),
            vec![Some(Value::Int(3)), Some(Value::Int(4))],
        );
        let before = read_values(&mut runtime);
        let seq = runtime.store().commit_seq().unwrap();
        if migration {
            runtime
                .apply_migration(generation(ColumnType::Int), &MigrationPlan::default(), 9)
                .unwrap();
        } else {
            runtime
                .apply_successor(generation(ColumnType::Int))
                .unwrap();
        }
        assert_eq!(before, read_values(&mut runtime));
        assert_eq!(runtime.store().commit_seq().unwrap(), seq);
    }
}
#[test]
fn narrowing_refuses_null_and_absent_rows_with_total_count_and_ten_id_sample_atomically() {
    let mut values = vec![Some(Value::Null); 11];
    values.push(None);
    values.push(Some(Value::Int(1)));
    let mut runtime = runtime(optional(ColumnType::Int), values);
    let old_generation = runtime.generation().hash();
    let before = read_values(&mut runtime);
    let error = runtime
        .apply_successor(generation(ColumnType::Int))
        .unwrap_err();
    assert_eq!(error.code, "E_SUCCESSOR_NARROWING");
    assert!(error.plan.drops.is_empty());
    let detail = error.narrowings.first().unwrap();
    assert_eq!(detail.table, "items");
    assert_eq!(detail.column, "value");
    assert_eq!(detail.null_rows, 12);
    assert_eq!(
        detail.sample,
        (0..10).map(|i| format!("id-{i:02}")).collect::<Vec<_>>()
    );
    assert!(error.rewrite.contains("job fill_items_value(value: int):\n  chunk p in items first 100 by byId:\n    update items[p.id] { value: p.value ?? value }"));
    assert!(error.message.contains("pasted job"));
    assert_eq!(
        serde_json::to_value(&error).unwrap()["narrowings"][0]["nullRows"],
        12
    );
    assert_eq!(runtime.generation().hash(), old_generation);
    assert_eq!(read_values(&mut runtime), before);
    let migration = runtime
        .apply_migration(generation(ColumnType::Int), &MigrationPlan::default(), 9)
        .unwrap_err();
    assert_eq!(migration.code(), "E_SUCCESSOR_NARROWING");
    assert_eq!(runtime.generation().hash(), old_generation);
    assert_eq!(read_values(&mut runtime), before);
}
#[test]
fn outer_optional_list_narrows_but_nested_optional_and_retypes_stay_type_changes() {
    let list = ColumnType::List {
        of: Box::new(optional(ColumnType::Int)),
        max: 3,
    };
    let mut allowed = runtime(
        optional(list.clone()),
        vec![Some(Value::Array(vec![Value::Null, Value::Int(1)]))],
    );
    allowed.apply_successor(generation(list)).unwrap();
    for (from, to) in [
        (
            optional(optional(ColumnType::Int)),
            optional(ColumnType::Int),
        ),
        (
            ColumnType::List {
                of: Box::new(optional(ColumnType::Int)),
                max: 3,
            },
            ColumnType::List {
                of: Box::new(ColumnType::Int),
                max: 3,
            },
        ),
        (optional(ColumnType::Int), ColumnType::Text { max: 30 }),
        (
            optional(ColumnType::Text { max: 30 }),
            ColumnType::Text { max: 20 },
        ),
    ] {
        let mut runtime = runtime(from.clone(), vec![]);
        let refusal = runtime.apply_successor(generation(to.clone())).unwrap_err();
        assert_eq!(refusal.code, "E_SUCCESSOR_DESTRUCTIVE");
        assert!(
            matches!(&refusal.plan.drops[..], [Drop::TypeChange { from: f, to: t, .. }] if f == &from && t == &to)
        );
    }
}

#[test]
fn narrowing_reports_every_null_column_with_its_count_sample_and_fill() {
    let mut project = ProjectJson {
        version: 1,
        auth: Auth::default(),
        effects: vec![],
        programs: vec![],
        schema: generation(optional(ColumnType::Int)).schema().clone(),
    };
    project
        .schema
        .tables
        .get_mut("items")
        .unwrap()
        .columns
        .insert("other".into(), optional(ColumnType::Int));
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        Generation::certify(&project, Ceilings::default()).unwrap(),
    )
    .unwrap();
    runtime
        .seed(&[
            (
                "items".into(),
                object([
                    ("id", Value::Id("a".into())),
                    ("value", Value::Null),
                    ("other", Value::Int(3)),
                ]),
            ),
            (
                "items".into(),
                object([("id", Value::Id("b".into())), ("value", Value::Null)]),
            ),
        ])
        .unwrap();
    let before = runtime.generation().hash();
    for column in ["value", "other"] {
        project
            .schema
            .tables
            .get_mut("items")
            .unwrap()
            .columns
            .insert(column.into(), ColumnType::Int);
    }
    let refusal = runtime
        .apply_successor(Generation::certify(&project, Ceilings::default()).unwrap())
        .unwrap_err();
    assert_eq!(refusal.code, "E_SUCCESSOR_NARROWING");
    assert_eq!(refusal.narrowings.len(), 2);
    // The wire primary site uses the first column in BTreeMap order.
    assert_eq!(refusal.narrowings[0].column, "other");
    for (column, count, sample) in [("other", 1, vec!["b"]), ("value", 2, vec!["a", "b"])] {
        let detail = refusal
            .narrowings
            .iter()
            .find(|c| c.column == column)
            .unwrap();
        assert_eq!(detail.null_rows, count);
        assert_eq!(detail.sample, sample);
        assert!(refusal.message.contains(&format!("items.{column}")));
        assert!(
            refusal
                .rewrite
                .contains(&format!("job fill_items_{column}(value: "))
        );
    }
    assert_eq!(runtime.generation().hash(), before);
}

fn changed_generation(runtime: &Runtime, change: impl FnOnce(&mut Table)) -> Generation {
    let mut schema = runtime.generation().schema().clone();
    change(schema.tables.get_mut("items").unwrap());
    Generation::certify(
        &ProjectJson {
            version: 1,
            auth: Auth::default(),
            effects: vec![],
            programs: vec![],
            schema,
        },
        Ceilings::default(),
    )
    .unwrap()
}

fn list(of: ColumnType, max: u32) -> ColumnType {
    ColumnType::List {
        of: Box::new(of),
        max,
    }
}

// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — text maximum widening
// preserves stored values, identities and sequence through both admission paths.
#[test]
fn text_maximum_widening_retains_boundary_rows_and_rejects_stale_destructive_plans() {
    let from = ColumnType::Text { max: 80 };
    let to = ColumnType::Text { max: 2000 };
    for migration in [false, true] {
        let mut runtime = runtime(
            from.clone(),
            vec![
                Some(Value::String("stored preview".into())),
                Some(Value::String("x".repeat(80))),
                Some(Value::String("🦀".repeat(80))),
            ],
        );
        let before = read_values(&mut runtime);
        let seq = runtime.store().commit_seq().unwrap();
        let old_hash = runtime.generation().hash();
        let next = generation(to.clone());
        let next_hash = next.hash();
        let stale = MigrationPlan {
            drops: vec![Drop::TypeChange {
                table: "items".into(),
                column: "value".into(),
                from: from.clone(),
                to: to.clone(),
            }],
        };
        assert!(matches!(
            runtime.apply_migration(next.clone(), &stale, 9),
            Err(RuntimeError::MigrationPlan(_))
        ));
        assert_eq!(read_values(&mut runtime), before);
        assert_eq!(runtime.generation().hash(), old_hash);
        assert_eq!(runtime.store().commit_seq().unwrap(), seq);
        let report = if migration {
            runtime
                .apply_migration(next, &MigrationPlan::default(), 9)
                .unwrap()
        } else {
            runtime.apply_successor(next).unwrap()
        };
        assert_eq!(report.from, old_hash);
        assert_eq!(report.to, next_hash);
        assert!(report.added_columns.is_empty());
        assert_eq!(read_values(&mut runtime), before);
        assert_eq!(runtime.store().commit_seq().unwrap(), seq);
        assert_eq!(runtime.store().meta("generation").unwrap(), Some(next_hash));
        runtime
            .seed(&[(
                "items".into(),
                object([
                    ("id", Value::Id("long".into())),
                    ("value", Value::String("y".repeat(2000))),
                ]),
            )])
            .unwrap();
        let after_write = read_values(&mut runtime);
        let written_seq = runtime.store().commit_seq().unwrap();
        assert!(
            runtime
                .seed(&[(
                    "items".into(),
                    object([
                        ("id", Value::Id("too-long".into())),
                        ("value", Value::String("y".repeat(2001))),
                    ])
                )])
                .is_err()
        );
        assert_eq!(read_values(&mut runtime), after_write);
        assert_eq!(runtime.store().commit_seq().unwrap(), written_seq);
    }
}

#[test]
fn text_maximum_widening_recurses_only_through_unchanged_wrappers() {
    let text = ColumnType::Text { max: 80 };
    let wide = ColumnType::Text { max: 2000 };
    let boundary = Value::String("x".repeat(80));
    let cases = [
        (
            optional(text.clone()),
            optional(wide.clone()),
            vec![None, Some(Value::Null), Some(boundary.clone())],
        ),
        (
            list(text.clone(), 2),
            list(wide.clone(), 2),
            vec![
                Some(Value::Array(vec![])),
                Some(Value::Array(vec![boundary.clone(), boundary.clone()])),
            ],
        ),
        (
            optional(list(optional(text.clone()), 2)),
            optional(list(optional(wide.clone()), 2)),
            vec![
                None,
                Some(Value::Array(vec![Value::Null, boundary.clone()])),
            ],
        ),
        (
            list(optional(list(text, 2)), 2),
            list(optional(list(wide, 2)), 2),
            vec![Some(Value::Array(vec![
                Value::Null,
                Value::Array(vec![boundary]),
            ]))],
        ),
    ];
    for (from, to, values) in cases {
        for migration in [false, true] {
            let mut runtime = runtime(from.clone(), values.clone());
            let before = read_values(&mut runtime);
            let seq = runtime.store().commit_seq().unwrap();
            let stale = MigrationPlan {
                drops: vec![Drop::TypeChange {
                    table: "items".into(),
                    column: "value".into(),
                    from: from.clone(),
                    to: to.clone(),
                }],
            };
            assert!(matches!(
                runtime.apply_migration(generation(to.clone()), &stale, 9),
                Err(RuntimeError::MigrationPlan(_))
            ));
            assert_eq!(read_values(&mut runtime), before);
            if migration {
                runtime
                    .apply_migration(generation(to.clone()), &MigrationPlan::default(), 9)
                    .unwrap();
            } else {
                runtime.apply_successor(generation(to.clone())).unwrap();
            }
            assert_eq!(read_values(&mut runtime), before);
            assert_eq!(runtime.store().commit_seq().unwrap(), seq);
        }
    }
}

#[test]
fn text_maximum_narrowing_and_unrelated_retypes_still_require_exact_destructive_plans() {
    let text = ColumnType::Text { max: 80 };
    let wide = ColumnType::Text { max: 2000 };
    for (from, to) in [
        (text.clone(), ColumnType::Text { max: 79 }),
        (text.clone(), ColumnType::Id),
        (text.clone(), optional(wide.clone())),
        (optional(text.clone()), wide.clone()),
        (list(text.clone(), 2), list(wide.clone(), 3)),
        (list(text.clone(), 2), list(wide.clone(), 1)),
        (list(optional(text.clone()), 2), list(wide, 2)),
        (
            ColumnType::Bytes { max: 80 },
            ColumnType::Bytes { max: 2000 },
        ),
        (
            ColumnType::Json { max_bytes: 80 },
            ColumnType::Json { max_bytes: 2000 },
        ),
        (
            ColumnType::Decimal { scale: 2 },
            ColumnType::Decimal { scale: 3 },
        ),
        (
            ColumnType::Money {
                currency: "USD".into(),
                scale: 2,
            },
            ColumnType::Money {
                currency: "EUR".into(),
                scale: 2,
            },
        ),
        (
            ColumnType::Enum {
                variants: vec!["a".into()],
            },
            ColumnType::Enum {
                variants: vec!["a".into(), "b".into()],
            },
        ),
        (
            ColumnType::Image {
                max: 80,
                once: false,
            },
            ColumnType::Image {
                max: 2000,
                once: false,
            },
        ),
        (
            ColumnType::Video { max: 80 },
            ColumnType::Video { max: 2000 },
        ),
    ] {
        let mut runtime = runtime(from.clone(), vec![]);
        let next = generation(to.clone());
        let refusal = runtime.apply_successor(next.clone()).unwrap_err();
        assert_eq!(
            refusal.code, "E_SUCCESSOR_DESTRUCTIVE",
            "{from:?} -> {to:?}"
        );
        assert_eq!(
            refusal.plan.drops,
            vec![Drop::TypeChange {
                table: "items".into(),
                column: "value".into(),
                from,
                to,
            }]
        );
        assert!(matches!(
            runtime.apply_migration(next.clone(), &MigrationPlan::default(), 9),
            Err(RuntimeError::MigrationPlan(_))
        ));
        // An exact destructive plan remains usable when there are no stored values.
        runtime.apply_migration(next, &refusal.plan, 9).unwrap();
    }
    for to in [ColumnType::Text { max: 79 }, ColumnType::Int] {
        let mut runtime = runtime(text.clone(), vec![Some(Value::String("x".repeat(80)))]);
        let before = read_values(&mut runtime);
        let hash = runtime.generation().hash();
        let seq = runtime.store().commit_seq().unwrap();
        let next = generation(to);
        let refusal = runtime.apply_successor(next.clone()).unwrap_err();
        let Err(RuntimeError::Successor(refusal)) = runtime.apply_migration(next, &refusal.plan, 9)
        else {
            panic!("required retype must roll back its dropped values")
        };
        assert_eq!(refusal.code, "E_SUCCESSOR_COLUMN_REQUIRED");
        assert_eq!(read_values(&mut runtime), before);
        assert_eq!(runtime.generation().hash(), hash);
        assert_eq!(runtime.store().meta("generation").unwrap(), Some(hash));
        assert_eq!(runtime.store().commit_seq().unwrap(), seq);
    }
}

#[test]
fn text_widening_rechecks_constraints_and_rolls_back_mixed_migrations() {
    for migration in [false, true] {
        for constraint in [
            Constraint::Text {
                field: "value".into(),
                min: 20,
                format: None,
            },
            Constraint::Text {
                field: "value".into(),
                min: 0,
                format: Some(TextFormat::Handle),
            },
            Constraint::Text {
                field: "value".into(),
                min: 0,
                format: Some(TextFormat::Url),
            },
            Constraint::Cap {
                by: vec!["value".into()],
                max: 1,
            },
            Constraint::Unique {
                index: "byValue".into(),
            },
        ] {
            let mut runtime = runtime(
                ColumnType::Text { max: 80 },
                vec![Some(Value::String("two words".into())); 2],
            );
            let expanded = changed_generation(&runtime, |table| {
                table
                    .columns
                    .insert("obsolete".into(), optional(ColumnType::Int));
            });
            runtime.apply_successor(expanded).unwrap();
            let before = read_values(&mut runtime);
            let hash = runtime.generation().hash();
            let seq = runtime.store().commit_seq().unwrap();
            let next = changed_generation(&runtime, |table| {
                table
                    .columns
                    .insert("value".into(), ColumnType::Text { max: 2000 });
                if migration {
                    table.columns.remove("obsolete");
                }
                if matches!(
                    constraint,
                    Constraint::Unique { .. } | Constraint::Cap { .. }
                ) {
                    table.indexes.insert(
                        "byValue".into(),
                        Index {
                            columns: vec!["value".into()],
                            unique: matches!(constraint, Constraint::Unique { .. }),
                        },
                    );
                }
                table.constraints.push(constraint.clone());
            });
            let refusal = if migration {
                let refused = runtime.apply_successor(next.clone()).unwrap_err();
                assert_eq!(
                    refused.plan.drops,
                    vec![Drop::Column {
                        table: "items".into(),
                        name: "obsolete".into()
                    }]
                );
                let Err(RuntimeError::Successor(refusal)) =
                    runtime.apply_migration(next, &refused.plan, 9)
                else {
                    panic!("mixed migration must refuse and roll back")
                };
                *refusal
            } else {
                runtime.apply_successor(next).unwrap_err()
            };
            let code = match constraint {
                Constraint::Text { .. } => "E_SUCCESSOR_ROW_INVALID",
                Constraint::Cap { .. } => "E_SUCCESSOR_CAP",
                _ => "E_SUCCESSOR_UNIQUE",
            };
            assert_eq!(refusal.code, code);
            assert_eq!(read_values(&mut runtime), before);
            assert_eq!(runtime.generation().hash(), hash);
            assert_eq!(runtime.store().meta("generation").unwrap(), Some(hash));
            assert_eq!(runtime.store().commit_seq().unwrap(), seq);
        }
    }
}

#[test]
fn text_widening_can_accompany_valid_constraints_and_an_explicit_column_drop() {
    let mut runtime = runtime(
        optional(ColumnType::Text { max: 80 }),
        vec![None, Some(Value::String("valid_handle".into()))],
    );
    let expanded = changed_generation(&runtime, |table| {
        table
            .columns
            .insert("obsolete".into(), optional(ColumnType::Int));
    });
    runtime.apply_successor(expanded).unwrap();
    let seq = runtime.store().commit_seq().unwrap();
    let next = changed_generation(&runtime, |table| {
        table
            .columns
            .insert("value".into(), optional(ColumnType::Text { max: 2000 }));
        table.columns.remove("obsolete");
        table.constraints.push(Constraint::Text {
            field: "value".into(),
            min: 3,
            format: Some(TextFormat::Handle),
        });
    });
    let refused = runtime.apply_successor(next.clone()).unwrap_err();
    assert_eq!(
        refused.plan.drops,
        vec![Drop::Column {
            table: "items".into(),
            name: "obsolete".into()
        }]
    );
    runtime.apply_migration(next, &refused.plan, 9).unwrap();
    let Value::Array(rows) = read_values(&mut runtime) else {
        panic!("rows")
    };
    assert_eq!(rows[0].field("value").unwrap(), &Value::Null);
    assert_eq!(
        rows[1].field("value").unwrap(),
        &Value::String("valid_handle".into())
    );
    assert_eq!(rows[1].field("id").unwrap(), &Value::Id("id-01".into()));
    assert_eq!(runtime.store().commit_seq().unwrap(), seq);
}

#[test]
fn reopening_a_store_applies_text_widening_without_rewriting_rows_or_sequence() {
    let dir = std::env::temp_dir().join(format!(
        "s2-text-widening-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("store.sqlite");
    let base = generation(ColumnType::Text { max: 80 });
    let mut runtime = Runtime::open(Store::open(&path).unwrap(), base).unwrap();
    runtime
        .seed(&[(
            "items".into(),
            object([
                ("id", Value::Id("retained".into())),
                ("value", Value::String("x".repeat(80))),
            ]),
        )])
        .unwrap();
    let before = read_values(&mut runtime);
    let seq = runtime.store().commit_seq().unwrap();
    drop(runtime);
    let next = generation(ColumnType::Text { max: 2000 });
    let mut reopened = Runtime::open(Store::open(&path).unwrap(), next.clone()).unwrap();
    assert_eq!(read_values(&mut reopened), before);
    assert_eq!(reopened.store().commit_seq().unwrap(), seq);
    assert_eq!(
        reopened.store().meta("generation").unwrap(),
        Some(next.hash())
    );
    drop(reopened);
    let mut reopened = Runtime::open(Store::open(&path).unwrap(), next).unwrap();
    assert_eq!(read_values(&mut reopened), before);
    assert_eq!(reopened.store().commit_seq().unwrap(), seq);
    drop(reopened);
    std::fs::remove_dir_all(dir).unwrap();
}
