use super::*;

#[test]
fn successor_ignores_unrelated_legacy_fields_but_validates_the_field_when_declared() {
    fn stored_rows(runtime: &Runtime) -> Vec<(String, String)> {
        let snapshot = temp_store_path("legacy-successor-snapshot");
        runtime.store().snapshot_to(&snapshot).unwrap();
        let rows = {
            let connection = rusqlite::Connection::open(&snapshot).unwrap();
            let mut statement = connection
                .prepare("SELECT row_id, data FROM rows WHERE table_name = 'items' ORDER BY row_id")
                .unwrap();
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        cleanup_store(&snapshot);
        rows
    }
    let path = temp_store_path("reserved-successor-row");
    let items = table(&[("id", ColumnType::Id)], &[("byId", &["id"])]);
    let base = generation(
        schema(
            BTreeMap::from([("items".to_owned(), items.clone())]),
            Vec::new(),
        ),
        Vec::new(),
    );
    {
        Runtime::open(Store::open(&path).unwrap(), base.clone()).unwrap();
    }
    {
        let connection = rusqlite::Connection::open(&path).unwrap();
        let vulnerable_row = object([
            ("id", Value::Id("legacy-row".to_owned())),
            ("ownerId", Value::Id(SYSTEM_PRINCIPAL_ID.to_string())),
        ]);
        connection
            .execute(
                "INSERT INTO rows(table_name, row_id, data) VALUES (?1, ?2, ?3)",
                rusqlite::params!["items", "legacy-row", canonical_json(&vulnerable_row)],
            )
            .unwrap();
    }

    let mut runtime = Runtime::open(Store::open(&path).unwrap(), base).unwrap();
    let mut clean_items = items.clone();
    clean_items.columns.insert(
        "note".to_owned(),
        ColumnType::Optional(Box::new(ColumnType::Text { max: 64 })),
    );
    clean_items.indexes.insert(
        "byNote".into(),
        Index {
            components: vec!["note", "id"]
                .into_iter()
                .map(|name| snapback2_core::search_key::IndexComponent::Column(name.into()))
                .collect(),
            unique: false,
        },
    );
    let note_query = Program {
        name: "items.byNote".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: "note".into(),
            table: "items".into(),
            index: "byNote".into(),
            key: vec![
                Expr::Literal(Value::Null),
                Expr::Literal(Value::Id("legacy-row".into())),
            ],
            provenance: KeyProvenance::Const,
        }))],
    };
    let before_generation = runtime.generation().hash();
    let before_seq = runtime.store().commit_seq().unwrap();
    let before_rows = stored_rows(&runtime);
    let result = runtime.apply_successor(generation(
        schema(
            BTreeMap::from([("items".to_owned(), clean_items.clone())]),
            Vec::new(),
        ),
        vec![note_query.clone()],
    ));
    println!(
        "synthetic legacy row; indexed successor result={result:?}; generation_before={before_generation} generation_after={} seq_before={before_seq} seq_after={} rows={:?}",
        runtime.generation().hash(),
        runtime.store().commit_seq().unwrap(),
        stored_rows(&runtime)
    );
    if result.is_err() {
        assert_eq!(runtime.generation().hash(), before_generation);
        assert_eq!(runtime.store().commit_seq().unwrap(), before_seq);
        assert_eq!(stored_rows(&runtime), before_rows);
    }
    result.expect(
        "an unrelated undeclared legacy field must not block a clean successor with a new index",
    );

    let clean_hash = runtime.generation().hash();
    let indexed = runtime
        .execute(
            &note_query.name,
            Context::query(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert_eq!(indexed.result.field("note").unwrap(), &Value::Null);
    assert_eq!(
        indexed.result.field("ownerId").unwrap(),
        &Value::Id(SYSTEM_PRINCIPAL_ID.to_string())
    );
    clean_items.columns.insert(
        "ownerId".to_owned(),
        ColumnType::Optional(Box::new(ColumnType::Id)),
    );
    let next = generation(
        schema(
            BTreeMap::from([("items".to_owned(), clean_items)]),
            Vec::new(),
        ),
        Vec::new(),
    );
    let refusal = runtime.apply_successor(next).unwrap_err();

    assert_eq!(runtime.generation().hash(), clean_hash);
    assert_eq!(stored_rows(&runtime), before_rows);
    assert_eq!(
        runtime
            .execute(
                &note_query.name,
                Context::query(Actor::user("alice").unwrap(), BTreeMap::new())
            )
            .unwrap()
            .result,
        indexed.result
    );
    assert_eq!(refusal.code, "E_SUCCESSOR_ROW_INVALID");
    assert!(refusal.message.contains("items.legacy-row"));
    assert!(refusal.message.contains("reserved system principal"));
    cleanup_store(&path);
}

#[test]
fn reindex_checks_consumed_ordinary_and_search_inputs_and_rolls_back() {
    use snapback2_core::search_key::{IndexComponent, SearchContract};
    for search in [false, true] {
        let path = temp_store_path(if search {
            "legacy-search-input"
        } else {
            "legacy-ordinary-input"
        });
        let items = table(
            &[
                ("id", ColumnType::Id),
                ("label", ColumnType::Text { max: 16 }),
            ],
            &[("byId", &["id"])],
        );
        let base = generation(
            schema(BTreeMap::from([("items".into(), items.clone())]), vec![]),
            vec![],
        );
        Runtime::open(Store::open(&path).unwrap(), base.clone()).unwrap();
        // Synthetic pre-validator legacy store. The first row can reindex;
        // the second has a bad newly consumed input, so all index writes roll back.
        {
            let c = rusqlite::Connection::open(&path).unwrap();
            for (id, label) in [("a", Value::String("Café".into())), ("b", Value::Int(7))] {
                let row = object([("id", Value::Id(id.into())), ("label", label)]);
                c.execute(
                    "INSERT INTO rows(table_name,row_id,data) VALUES ('items',?1,?2)",
                    rusqlite::params![id, canonical_json(&row)],
                )
                .unwrap();
            }
        }
        let mut next_items = items;
        next_items.indexes.insert(
            "byLabel".into(),
            Index {
                components: vec![
                    if search {
                        IndexComponent::WordPrefixes {
                            fields: vec!["label".into()],
                            contract: SearchContract::Unicode17,
                        }
                    } else {
                        IndexComponent::Column("label".into())
                    },
                    IndexComponent::Column("id".into()),
                ],
                unique: false,
            },
        );
        let next = generation(
            schema(BTreeMap::from([("items".into(), next_items)]), vec![]),
            vec![],
        );
        let mut runtime = Runtime::open(Store::open(&path).unwrap(), base.clone()).unwrap();
        let refusal = runtime.apply_successor(next.clone()).unwrap_err();
        println!("search={search} consumed_input_refusal={refusal:?}");
        assert_eq!(refusal.code, "E_SUCCESSOR_STORE");
        assert!(refusal.message.contains("items.label"));
        assert_eq!(runtime.generation().hash(), base.hash());
        assert_eq!(runtime.store().commit_seq().unwrap(), 0);
        let snapshot = temp_store_path("reindex-rollback");
        runtime.store().snapshot_to(&snapshot).unwrap();
        {
            let c = rusqlite::Connection::open(&snapshot).unwrap();
            assert_eq!(
                c.query_row("SELECT count(*) FROM index_entries", [], |r| r
                    .get::<_, u32>(0))
                    .unwrap(),
                0
            );
            assert_eq!(
                c.query_row("SELECT count(*) FROM _search_postings", [], |r| r
                    .get::<_, u32>(0))
                    .unwrap(),
                0
            );
            assert_eq!(
                c.query_row("SELECT count(*) FROM rows", [], |r| r.get::<_, u32>(0))
                    .unwrap(),
                2
            );
        }
        cleanup_store(&snapshot);
        runtime
            .seed(&[(
                "items".into(),
                object([
                    ("id", Value::Id("b".into())),
                    ("label", Value::String("Café".into())),
                ]),
            )])
            .unwrap();
        runtime.apply_successor(next.clone()).unwrap();
        assert_eq!(runtime.generation().hash(), next.hash());
        drop(runtime);
        let c = rusqlite::Connection::open(&path).unwrap();
        let sql = if search {
            "SELECT count(DISTINCT row_id) FROM _search_postings WHERE index_name='byLabel'"
        } else {
            "SELECT count(*) FROM index_entries WHERE index_name='byLabel'"
        };
        assert_eq!(c.query_row(sql, [], |r| r.get::<_, u32>(0)).unwrap(), 2);
        drop(c);
        cleanup_store(&path);
    }
}
