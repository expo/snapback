use snapback3_core::*;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn project(body: &str, optional_note: bool) -> ProjectJson {
    let mut columns = BTreeMap::from([("id".to_owned(), ColumnType::Id)]);
    if optional_note {
        columns.insert(
            "note".to_owned(),
            ColumnType::Optional(Box::new(ColumnType::Text { max: 64 })),
        );
    }
    ProjectJson {
        version: 1,
        schema: Schema {
            tables: BTreeMap::from([(
                "items".to_owned(),
                public_table(
                    columns,
                    BTreeMap::from([(
                        "byId".to_owned(),
                        Index {
                            components: vec![search_key::IndexComponent::Column("id".to_owned())],
                            unique: false,
                        },
                    )]),
                ),
            )]),
            auth: Auth {
                password: true,
                guests: false,
            },
            ..Schema::default()
        },
        programs: vec![Program {
            name: "items.meaning".to_owned(),
            kind: ProgramKind::Query,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![Stmt::Return(Expr::Literal(Value::String(body.to_owned())))],
        }],
        effects: Vec::new(),
        auth: Auth {
            password: true,
            guests: false,
        },
    }
}

fn certify(project: &ProjectJson) -> Generation {
    Generation::certify(project, Ceilings::default()).unwrap()
}

#[test]
fn accepted_project_custody_commits_with_generation_and_refusal_keeps_predecessor() {
    let path = temp_store_path("project-custody");
    let a = project("A", false);
    let b = project("B", true);
    let mut runtime = Runtime::open(Store::open(&path).unwrap(), certify(&a)).unwrap();
    assert_eq!(stored_project(runtime.store()), a);

    let generation_b = certify(&b);
    runtime.apply_successor(generation_b.clone()).unwrap();
    assert_eq!(stored_project(runtime.store()), b);
    assert_eq!(
        runtime.store().meta("generation").unwrap(),
        Some(generation_b.hash())
    );
    assert_eq!(
        runtime
            .store()
            .meta("program_generation")
            .unwrap()
            .as_deref(),
        Some(generation_b.program_hash())
    );

    let mut destructive = project("rejected", true);
    destructive.schema.tables.clear();
    assert!(runtime.apply_successor(certify(&destructive)).is_err());
    assert_eq!(stored_project(runtime.store()), b);
    drop(runtime);

    let store = Store::open(&path).unwrap();
    let recovered = certify(&stored_project(&store));
    let runtime = Runtime::open(store, recovered).unwrap();
    assert_eq!(
        runtime.generation().program_hash(),
        generation_b.program_hash()
    );
    drop(runtime);
    cleanup_store(&path);
}

fn stored_project(store: &Store) -> ProjectJson {
    serde_json::from_str(&store.meta("project_json").unwrap().unwrap()).unwrap()
}

fn temp_store_path(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "snapback3-{label}-{}-{}.sqlite",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ))
}

fn cleanup_store(path: &Path) {
    for path in [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ] {
        let _ = std::fs::remove_file(path);
    }
}
