use snapback3_core::{
    Auth, Ceilings, ColumnType, Engine, Generation, Index, Maintain, MaintainKind, ProjectJson,
    Schema, Table, public_table,
};
use std::collections::BTreeMap;

fn table(columns: impl IntoIterator<Item = (&'static str, ColumnType)>) -> Table {
    public_table(
        columns
            .into_iter()
            .map(|(name, column)| (name.to_owned(), column))
            .collect(),
        BTreeMap::from([(
            "byId".to_owned(),
            Index {
                components: (vec!["id".to_owned()])
                    .into_iter()
                    .map(snapback3_core::search_key::IndexComponent::Column)
                    .collect(),
                unique: true,
            },
        )]),
    )
}

fn valid_schema() -> Schema {
    Schema {
        tables: BTreeMap::from([
            (
                "events".to_owned(),
                table([
                    ("id", ColumnType::Id),
                    ("group", ColumnType::Text { max: 20 }),
                    ("amount", ColumnType::Int),
                    ("label", ColumnType::Text { max: 20 }),
                    ("value", ColumnType::Int),
                ]),
            ),
            (
                "totals".to_owned(),
                table([
                    ("id", ColumnType::Id),
                    ("group", ColumnType::Text { max: 20 }),
                    ("value", ColumnType::Int),
                ]),
            ),
        ]),
        maintains: vec![Maintain {
            kind: MaintainKind::Sum {
                of: "amount".to_owned(),
            },
            source: "events".to_owned(),
            by: vec!["group".to_owned()],
            target: "totals".to_owned(),
            readable: None,
        }],
        ..Schema::default()
    }
}

fn project(schema: Schema) -> ProjectJson {
    ProjectJson {
        version: 1,
        schema,
        programs: Vec::new(),
        effects: Vec::new(),
        auth: Auth::default(),
    }
}

#[test]
fn compatible_closed_maintain_shape_certifies_and_enters_the_engine() {
    let schema = valid_schema();
    Generation::certify(&project(schema.clone()), Ceilings::default()).unwrap();
    assert!(Engine::memory(schema).is_ok());
}

#[test]
fn malformed_raw_maintains_refuse_at_certification_and_engine_admission() {
    let mut cases = Vec::new();

    let mut schema = valid_schema();
    schema.maintains[0].by.push("group".to_owned());
    cases.push((
        "duplicate group",
        schema,
        "maintain.by repeats source column group",
    ));

    let mut schema = valid_schema();
    schema.maintains[0].by = vec!["id".to_owned()];
    cases.push((
        "reserved id",
        schema,
        "cannot use reserved source column id",
    ));

    let mut schema = valid_schema();
    schema.maintains[0].by = vec!["value".to_owned()];
    cases.push((
        "reserved value",
        schema,
        "cannot use reserved source column value",
    ));

    let mut schema = valid_schema();
    schema.maintains[0].by = Vec::new();
    cases.push((
        "empty group",
        schema,
        "must contain at least one source column",
    ));

    let mut schema = valid_schema();
    schema.maintains[0].by = vec!["missing".to_owned()];
    cases.push((
        "missing group",
        schema,
        "unknown source column events.missing",
    ));

    let mut schema = valid_schema();
    schema.maintains[0].kind = MaintainKind::Sum {
        of: "missing".to_owned(),
    };
    cases.push((
        "missing sum",
        schema,
        "unknown source column events.missing",
    ));

    let mut schema = valid_schema();
    schema.maintains[0].kind = MaintainKind::Sum {
        of: "label".to_owned(),
    };
    cases.push(("non-int sum", schema, "events.label must be Int"));

    let mut schema = valid_schema();
    schema
        .tables
        .get_mut("totals")
        .unwrap()
        .columns
        .remove("group");
    cases.push((
        "missing target group",
        schema,
        "totals.group must exactly match",
    ));

    let mut schema = valid_schema();
    schema
        .tables
        .get_mut("totals")
        .unwrap()
        .columns
        .insert("group".to_owned(), ColumnType::Text { max: 10 });
    cases.push((
        "incompatible target group",
        schema,
        "totals.group must exactly match",
    ));

    let mut schema = valid_schema();
    schema
        .tables
        .get_mut("totals")
        .unwrap()
        .columns
        .insert("value".to_owned(), ColumnType::Text { max: 20 });
    cases.push(("non-int target value", schema, "totals.value type"));

    let mut schema = valid_schema();
    schema
        .tables
        .get_mut("totals")
        .unwrap()
        .columns
        .insert("extra".to_owned(), ColumnType::Bool);
    cases.push(("open target shape", schema, "non-aggregate columns extra"));

    let mut schema = valid_schema();
    schema.maintains.push(Maintain {
        kind: MaintainKind::Count,
        source: "events".to_owned(),
        by: vec!["group".to_owned()],
        target: "totals".to_owned(),
        readable: None,
    });
    cases.push(("multiple owners", schema, "is owned by both"));

    let mut schema = valid_schema();
    schema.tables.insert(
        "grandTotals".to_owned(),
        table([
            ("id", ColumnType::Id),
            ("group", ColumnType::Text { max: 20 }),
            ("value", ColumnType::Int),
        ]),
    );
    schema.maintains.push(Maintain {
        kind: MaintainKind::Count,
        source: "totals".to_owned(),
        by: vec!["group".to_owned()],
        target: "grandTotals".to_owned(),
        readable: None,
    });
    cases.push((
        "maintain dependency chain",
        schema,
        "maintain target totals cannot also be a maintain source",
    ));

    let mut schema = valid_schema();
    schema.maintains[0].source = "missing".to_owned();
    cases.push(("missing source", schema, "unknown source table missing"));

    let mut schema = valid_schema();
    schema.maintains[0].target = "missing".to_owned();
    cases.push(("missing target", schema, "unknown target table missing"));

    for (name, schema, expected) in cases {
        let errors =
            Generation::certify(&project(schema.clone()), Ceilings::default()).expect_err(name);
        if name == "missing sum" {
            assert_eq!(
                errors
                    .iter()
                    .filter(|(site, error)| {
                        site.starts_with("schema.maintains[") && error.code == "E_SCHEMA_MAINTAIN"
                    })
                    .count(),
                1,
                "unknown sum source produced a secondary mismatch: {errors:?}"
            );
        }
        assert!(
            errors
                .iter()
                .any(|(site, error)| site.starts_with("schema.maintains[")
                    && error.code == "E_SCHEMA_MAINTAIN"
                    && error.message.contains(expected)),
            "{name}: {errors:?}"
        );

        let error = match Engine::memory(schema) {
            Ok(_) => panic!("{name}: malformed maintain entered the engine"),
            Err(error) => error,
        };
        assert_eq!(error.code(), "E_SCHEMA_MAINTAIN", "{name}: {error}");
        assert!(error.to_string().contains(expected), "{name}: {error}");
    }
}
