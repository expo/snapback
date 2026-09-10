use snapback2_core::ir::IndexKeyExpr;
use snapback2_core::*;
use std::collections::BTreeMap;

fn generation(kind: ColumnType) -> Generation {
    let table = public_table(
        BTreeMap::from([("id".into(), ColumnType::Id), ("value".into(), kind)]),
        BTreeMap::from([(
            "byId".into(),
            Index {
                components: (vec!["id".into()])
                    .into_iter()
                    .map(snapback2_core::search_key::IndexComponent::Column)
                    .collect(),
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
            ("items".into(), Value::Row(row.into()))
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
            prefix: (vec![]).into_iter().map(IndexKeyExpr::Scalar).collect(),
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
fn outer_optional_and_maxima_narrow_but_nested_optional_and_retypes_stay_type_changes() {
    let list = ColumnType::List {
        of: Box::new(optional(ColumnType::Int)),
        max: 3,
    };
    let mut allowed = runtime(
        optional(list.clone()),
        vec![Some(Value::Array(vec![Value::Null, Value::Int(1)]))],
    );
    allowed.apply_successor(generation(list)).unwrap();
    for (from, to, small, large) in [
        (optional(ColumnType::Text { max: 30 }), ColumnType::Text { max: 20 },
         Value::String("a".into()), Value::String("x".repeat(21))),
        (optional(ColumnType::Bytes { max: 30 }), ColumnType::Bytes { max: 20 },
         Value::Bytes(vec![1]), Value::Bytes(vec![1; 21])),
        (optional(ColumnType::List { of: Box::new(ColumnType::Int), max: 3 }),
         ColumnType::List { of: Box::new(ColumnType::Int), max: 2 },
         Value::Array(vec![Value::Int(1)]), Value::Array(vec![Value::Int(1); 3])),
    ] {
        let mut fits = runtime(from.clone(), vec![Some(small)]);
        let before = read_values(&mut fits);
        let report = fits.apply_successor(generation(to.clone())).unwrap();
        assert_eq!(report.narrowings[0].affected_rows, 0);
        assert_eq!(read_values(&mut fits), before);
        let mut over = runtime(from, vec![Some(large)]);
        let before = read_values(&mut over);
        let refusal = over.apply_successor(generation(to)).unwrap_err();
        assert_eq!(refusal.code, "E_SUCCESSOR_NARROWING");
        assert_eq!(refusal.narrowings[0].oversize_rows, 1);
        assert_eq!(read_values(&mut over), before);
    }
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
