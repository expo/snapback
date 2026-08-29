use snapback2_core::*;
use std::collections::BTreeMap;

fn table(columns: &[(&str, ColumnType)], indexes: &[(&str, &[&str])]) -> Table {
    public_table(
        columns
            .iter()
            .map(|(name, kind)| ((*name).to_owned(), kind.clone()))
            .collect(),
        indexes
            .iter()
            .map(|(name, columns)| {
                (
                    (*name).to_owned(),
                    Index {
                        columns: columns.iter().map(|column| (*column).to_owned()).collect(),
                        unique: false,
                    },
                )
            })
            .collect(),
    )
}

fn schema(tables: BTreeMap<String, Table>, maintains: Vec<Maintain>) -> Schema {
    Schema {
        tables,
        maintains,
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    }
}

fn generation(schema: Schema, programs: Vec<Program>) -> Generation {
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema,
            programs,
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap()
}

fn get_program(name: &str, table: &str, index: &str, key: &str) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([(key.to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: name.to_owned(),
            table: table.to_owned(),
            index: index.to_owned(),
            key: vec![var(key)],
            provenance: KeyProvenance::Arg,
        }))],
    }
}

#[test]
fn additive_successor_adds_table_column_index_and_program_in_place() {
    let base_items = table(
        &[
            ("id", ColumnType::Id),
            ("name", ColumnType::Text { max: 64 }),
        ],
        &[("byId", &["id"])],
    );
    let base_schema = schema(
        BTreeMap::from([("items".to_owned(), base_items.clone())]),
        Vec::new(),
    );
    let base = generation(
        base_schema,
        vec![get_program("items.get", "items", "byId", "id")],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), base).unwrap();
    runtime
        .seed(&[(
            "items".to_owned(),
            object([
                ("id", Value::Id("i1".to_owned())),
                ("name", Value::String("one".to_owned())),
            ]),
        )])
        .unwrap();

    let mut next_items = base_items;
    next_items
        .columns
        .insert("note".to_owned(), ColumnType::Text { max: 64 });
    next_items.indexes.insert(
        "byName".to_owned(),
        Index {
            columns: vec!["name".to_owned()],
            unique: false,
        },
    );
    let logs = table(&[("id", ColumnType::Id)], &[("byId", &["id"])]);
    let next_schema = schema(
        BTreeMap::from([("items".to_owned(), next_items), ("logs".to_owned(), logs)]),
        Vec::new(),
    );
    let next = generation(
        next_schema,
        vec![
            get_program("items.get", "items", "byId", "id"),
            get_program("items.byName", "items", "byName", "name"),
        ],
    );
    let report = runtime.apply_successor(next).unwrap();
    assert_eq!(report.added_tables, vec!["logs"]);
    assert!(report.added_columns.contains(&"items.note".to_owned()));
    assert!(report.added_indexes.contains(&"items.byName".to_owned()));

    let execution = runtime
        .execute(
            "items.byName",
            Context::query(
                "u1",
                BTreeMap::from([("name".to_owned(), Value::String("one".to_owned()))]),
            ),
        )
        .unwrap();
    assert_eq!(
        execution.result.field("id").unwrap(),
        &Value::Id("i1".to_owned())
    );
}

#[test]
fn new_maintained_aggregate_is_backfilled_from_existing_rows() {
    let cards = table(
        &[("id", ColumnType::Id), ("group", ColumnType::Id)],
        &[("byId", &["id"])],
    );
    let counts = table(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Id),
            ("value", ColumnType::Int),
        ],
        &[("byGroup", &["group"])],
    );
    let tables = BTreeMap::from([("cards".to_owned(), cards), ("counts".to_owned(), counts)]);
    let base = generation(schema(tables.clone(), Vec::new()), Vec::new());
    let mut runtime = Runtime::open(Store::memory().unwrap(), base).unwrap();
    runtime
        .seed(&[
            (
                "cards".to_owned(),
                object([
                    ("id", Value::Id("c1".to_owned())),
                    ("group", Value::Id("g1".to_owned())),
                ]),
            ),
            (
                "cards".to_owned(),
                object([
                    ("id", Value::Id("c2".to_owned())),
                    ("group", Value::Id("g1".to_owned())),
                ]),
            ),
        ])
        .unwrap();
    let maintain = Maintain {
        kind: MaintainKind::Count,
        source: "cards".to_owned(),
        by: vec!["group".to_owned()],
        target: "counts".to_owned(),
        readable: None,
    };
    let next = generation(
        schema(tables, vec![maintain]),
        vec![get_program("counts.get", "counts", "byGroup", "group")],
    );
    let report = runtime.apply_successor(next).unwrap();
    assert_eq!(report.backfilled_maintains, 1);
    let execution = runtime
        .execute(
            "counts.get",
            Context::query(
                "u1",
                BTreeMap::from([("group".to_owned(), Value::Id("g1".to_owned()))]),
            ),
        )
        .unwrap();
    assert_eq!(execution.result.field("value").unwrap(), &Value::Int(2));

    let seq = runtime
        .seed(&[(
            "cards".to_owned(),
            object([
                ("id", Value::Id("c3".to_owned())),
                ("group", Value::Id("g1".to_owned())),
            ]),
        )])
        .unwrap();
    let commit = runtime.store().commits_since(seq - 1, 1).unwrap().remove(0);
    assert_eq!(commit.kind, "seed");
    assert_eq!(commit.writes.get("counts"), Some(&1));
    assert_eq!(
        commit
            .touched
            .iter()
            .filter(|key| key.table == "counts" && key.index == "byGroup")
            .count(),
        2,
        "maintained updates trace the aggregate's before and after keys"
    );
}

#[test]
fn destructive_successor_reports_all_drops_and_applies_only_that_plan() {
    let items = table(
        &[
            ("id", ColumnType::Id),
            ("name", ColumnType::Text { max: 64 }),
        ],
        &[("byId", &["id"])],
    );
    let base = generation(
        schema(BTreeMap::from([("items".to_owned(), items)]), Vec::new()),
        Vec::new(),
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), base).unwrap();
    runtime
        .seed(&[(
            "items".to_owned(),
            object([
                ("id", Value::Id("i1".to_owned())),
                ("name", Value::String("one".to_owned())),
            ]),
        )])
        .unwrap();
    let next = generation(schema(BTreeMap::new(), Vec::new()), Vec::new());
    let refusal = runtime.apply_successor(next.clone()).unwrap_err();
    assert_eq!(refusal.code, "E_SUCCESSOR_DESTRUCTIVE");
    assert_eq!(
        refusal.plan.drops,
        vec![Drop::Table {
            name: "items".to_owned(),
            rows: 1,
        }]
    );
    runtime.apply_migration(next, &refusal.plan).unwrap();
    assert!(runtime.generation().schema.tables.is_empty());
}
