use super::*;

#[cfg(test)]
mod authoring_suggestion_tests {
    use super::*;

    #[test]
    fn unknown_schema_field_names_only_typed_fields_from_the_served_table() {
        let schema: SchemaManifest = serde_json::from_str(include_str!(
            "../../demos/todo/snapback/generated/schema.manifest.json"
        ))
        .expect("parse served schema fixture");
        let table = schema.table("todos").expect("served todos table");
        let error = ensure_field(table, "titel").expect_err("unknown schema field");
        assert_eq!(error.diagnostic.code, "SNAPBACK_UNKNOWN_FIELD");
        assert_eq!(
            error.diagnostic.details["candidateFields"][0]["name"],
            "title"
        );
        assert_eq!(
            error.diagnostic.details["candidateFields"][0]["expected"],
            "string"
        );
        assert!(
            error.diagnostic.details["servedShapeHash"]
                .as_str()
                .unwrap()
                .starts_with("sha256:")
        );
        assert!(
            !serde_json::to_string(&error.diagnostic)
                .unwrap()
                .contains("titel")
        );
    }
}

#[cfg(test)]
mod asset_infra_tests {
    use super::*;

    /// @ref LLP 0044#internal-model — the asset system tables are part of the
    ///   core infra migration, present after every open.
    #[test]
    fn asset_system_tables_migrate_on_startup() {
        let db = LocalDatabase::memory().expect("memory database");
        for table in crate::assets::ASSET_SYSTEM_TABLES {
            let count: u64 = db
                .conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .expect("sqlite_master probe");
            assert_eq!(count, 1, "{table} must exist after open");
        }
    }
}

#[cfg(test)]
mod vector_storage_carrier_tests {
    use super::*;

    #[test]
    fn direct_vector_schema_lowers_and_round_trips_canonical_bytes() {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(SchemaManifest {
                required_capabilities: vec![crate::vector::VECTOR_CAPABILITY.to_owned()],
                tables: vec![TableManifest {
                    name: "embeddings".to_owned(),
                    fields: vec![FieldManifest {
                        name: "embedding".to_owned(),
                        field_type: FieldType::Vector { dimensions: 3 },
                        optional: false,
                    }],
                    indexes: Vec::new(),
                    syncable: false,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                }],
                ..SchemaManifest::default()
            })
            .expect("direct manifest lowering must not panic");

        let declared: String = db
            .conn
            .query_row(
                "SELECT type FROM pragma_table_info('embeddings') WHERE name = 'embedding'",
                [],
                |row| row.get(0),
            )
            .expect("vector column declaration");
        assert_eq!(declared, "BLOB");

        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "embeddings".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), json!("embedding_1")),
                        ("embedding".to_owned(), json!([-0.0, 2.0, 3.0])),
                    ])],
                )]),
            })
            .expect("internal vector storage admits canonical values");
        let stored: Vec<u8> = db
            .conn
            .query_row(
                "SELECT embedding FROM embeddings WHERE _id='embedding_1'",
                [],
                |row| row.get(0),
            )
            .expect("canonical vector blob");
        assert_eq!(stored.len(), 24);
        assert_eq!(&stored[..8], &[0; 8], "negative zero canonicalizes");
        let row = db
            .query_reads_read()
            .get("embeddings", "embedding_1")
            .expect("row reload")
            .expect("stored row");
        assert_eq!(row["embedding"], json!([0.0, 2.0, 3.0]));
    }
}

#[cfg(test)]
mod stored_enum_tests {
    use super::*;

    fn field(name: &str, field_type: FieldType, optional: bool) -> FieldManifest {
        FieldManifest {
            name: name.to_owned(),
            field_type,
            optional,
        }
    }

    fn domain(values: &[&str]) -> FieldType {
        FieldType::Enum {
            values: values.iter().map(|value| (*value).to_owned()).collect(),
        }
    }

    fn schema(fields: Vec<FieldManifest>) -> SchemaManifest {
        SchemaManifest {
            tables: vec![TableManifest {
                name: "items".to_owned(),
                fields,
                indexes: Vec::new(),
                syncable: false,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            }],
            ..SchemaManifest::default()
        }
    }

    fn insert(db: &mut LocalDatabase, id: &str, values: Map<String, Value>) -> SnapbackResult<()> {
        db.mutation_writes().commit_buffered_writes(
            &HandlerInput::default(),
            vec![BufferedWrite::Insert {
                table: "items".to_owned(),
                id: id.to_owned(),
                values,
            }],
            Vec::new(),
            Value::Null,
        )?;
        Ok(())
    }

    #[test]
    fn enum_manifest_wire_shape_and_domain_admission_are_closed() {
        assert_eq!(
            serde_json::to_value(domain(&["admin", "member"])).expect("serialize enum"),
            json!({ "Enum": { "values": ["admin", "member"] } })
        );

        let invalid_domains = vec![
            vec!["only".to_owned()],
            // Eight refuses: the stored bound is seven so an optional field's
            // `null | …` document contract stays inside LLP 0108's eight.
            (0..8).map(|index| format!("v{index}")).collect(),
            vec!["".to_owned(), "ok".to_owned()],
            vec!["a".repeat(65), "ok".to_owned()],
            vec!["same".to_owned(), "same".to_owned()],
        ];
        for values in invalid_domains {
            let mut db = LocalDatabase::memory().expect("memory database");
            let error = db
                .schema_seed()
                .apply_schema(schema(vec![field(
                    "role",
                    FieldType::Enum { values },
                    false,
                )]))
                .expect_err("invalid enum domain must refuse");
            assert_eq!(error.diagnostic.code, "SNAPBACK_SCHEMA_ENUM_DOMAIN_INVALID");
            let physical: i64 = db
                .conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='items'",
                    [],
                    |row| row.get(0),
                )
                .expect("physical table probe");
            assert_eq!(physical, 0, "invalid enum must refuse before DDL");
            assert!(db.schema().table("items").is_none());
        }
    }

    #[test]
    fn enum_lowers_to_text_and_central_writes_enforce_the_domain() {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(schema(vec![
                field("role", domain(&["admin", "member"]), false),
                field("visibility", domain(&["internal", "public"]), true),
            ]))
            .expect("apply enum schema");

        let (declared, not_null): (String, i64) = db
            .conn
            .query_row(
                "SELECT type, \"notnull\" FROM pragma_table_info('items') WHERE name='role'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("enum column declaration");
        assert_eq!(declared, "TEXT");
        assert_eq!(not_null, 1);
        let (optional_declared, optional_not_null): (String, i64) = db
            .conn
            .query_row(
                "SELECT type, \"notnull\" FROM pragma_table_info('items') WHERE name='visibility'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("optional enum column declaration");
        assert_eq!(optional_declared, "TEXT");
        assert_eq!(optional_not_null, 0);

        insert(
            &mut db,
            "item_ok",
            Map::from_iter([("role".to_owned(), json!("admin"))]),
        )
        .expect("admitted enum insert");
        assert_eq!(
            db.query_reads_read()
                .get("items", "item_ok")
                .unwrap()
                .unwrap()["role"],
            "admin"
        );

        let non_string = insert(
            &mut db,
            "item_number",
            Map::from_iter([("role".to_owned(), json!(7))]),
        )
        .expect_err("non-string enum insert refuses");
        assert_eq!(non_string.diagnostic.code, "SNAPBACK_FIELD_TYPE_MISMATCH");

        let outside = insert(
            &mut db,
            "item_outside",
            Map::from_iter([("role".to_owned(), json!("owner"))]),
        )
        .expect_err("out-of-domain enum insert refuses");
        assert_eq!(outside.diagnostic.code, "SNAPBACK_FIELD_ENUM_VALUE_INVALID");
        assert_eq!(outside.diagnostic.details["table"], "items");
        assert_eq!(outside.diagnostic.details["field"], "role");
        assert_eq!(outside.diagnostic.details["value"], "owner");
        assert_eq!(
            outside.diagnostic.details["admitted"],
            json!(["admin", "member"])
        );
        assert!(
            db.query_reads_read()
                .get("items", "item_outside")
                .unwrap()
                .is_none()
        );

        let required_null = insert(
            &mut db,
            "item_required_null",
            Map::from_iter([("role".to_owned(), Value::Null)]),
        )
        .expect_err("null required enum refuses");
        assert_eq!(
            required_null.diagnostic.code,
            "SNAPBACK_FIELD_TYPE_MISMATCH"
        );
        assert!(
            db.query_reads_read()
                .get("items", "item_required_null")
                .unwrap()
                .is_none()
        );
        insert(
            &mut db,
            "item_optional_null",
            Map::from_iter([
                ("role".to_owned(), json!("member")),
                ("visibility".to_owned(), Value::Null),
            ]),
        )
        .expect("null optional enum commits");
        assert_eq!(
            db.query_reads_read()
                .get("items", "item_optional_null")
                .unwrap()
                .unwrap()["visibility"],
            Value::Null
        );

        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "item_ok".to_owned(),
                    values: Map::from_iter([("role".to_owned(), json!("member"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("admitted enum patch");
        let refused_patch = db
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "item_ok".to_owned(),
                    values: Map::from_iter([("role".to_owned(), json!("owner"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect_err("out-of-domain enum patch refuses");
        assert_eq!(
            refused_patch.diagnostic.code,
            "SNAPBACK_FIELD_ENUM_VALUE_INVALID"
        );
        assert_eq!(
            db.query_reads_read()
                .get("items", "item_ok")
                .unwrap()
                .unwrap()["role"],
            "member"
        );
    }

    #[test]
    fn optional_enum_field_addition_admits_on_a_nonempty_table() {
        let base = schema(vec![field("title", FieldType::String, false)]);
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(base)
            .expect("apply base schema");
        insert(
            &mut db,
            "nonempty",
            Map::from_iter([("title".to_owned(), json!("hello"))]),
        )
        .expect("seed nonempty table");
        db.schema_seed()
            .apply_schema(schema(vec![
                field("title", FieldType::String, false),
                field("state", domain(&["open", "closed"]), true),
            ]))
            .expect("optional enum field can be added to nonempty table");
        assert_eq!(
            db.schema()
                .table("items")
                .unwrap()
                .field("state")
                .unwrap()
                .field_type,
            domain(&["open", "closed"])
        );
    }

    #[test]
    fn required_enum_field_addition_admits_only_on_an_empty_table() {
        let base = schema(vec![field("title", FieldType::String, false)]);
        let mut empty = LocalDatabase::memory().expect("memory database");
        empty
            .schema_seed()
            .apply_schema(base.clone())
            .expect("apply base schema");
        empty
            .schema_seed()
            .apply_schema(schema(vec![
                field("title", FieldType::String, false),
                field("state", domain(&["open", "closed"]), false),
            ]))
            .expect("required enum field can be added to empty table");

        let mut nonempty = LocalDatabase::memory().expect("memory database");
        nonempty
            .schema_seed()
            .apply_schema(base)
            .expect("apply base schema");
        insert(
            &mut nonempty,
            "nonempty",
            Map::from_iter([("title".to_owned(), json!("hello"))]),
        )
        .expect("seed nonempty table");
        let error = nonempty
            .schema_seed()
            .apply_schema(schema(vec![
                field("title", FieldType::String, false),
                field("state", domain(&["open", "closed"]), false),
            ]))
            .expect_err("required enum field needs a backfill");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED"
        );
        assert!(
            nonempty
                .schema()
                .table("items")
                .unwrap()
                .field("state")
                .is_none(),
            "refusal leaves the manifest unchanged"
        );
        let state_columns: i64 = nonempty
            .conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('items') WHERE name='state'",
                [],
                |row| row.get(0),
            )
            .expect("new-column probe");
        assert_eq!(state_columns, 0, "refusal occurs before additive DDL");
    }

    #[test]
    fn enum_domain_widening_admits_without_touching_rows() {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(schema(vec![field(
                "state",
                domain(&["open", "closed"]),
                false,
            )]))
            .expect("apply narrow enum");
        insert(
            &mut db,
            "open_item",
            Map::from_iter([("state".to_owned(), json!("open"))]),
        )
        .expect("seed admitted value");
        db.schema_seed()
            .apply_schema(schema(vec![field(
                "state",
                domain(&["closed", "open", "archived"]),
                false,
            )]))
            .expect("enum subset widening is declaration-only");
        assert_eq!(
            db.query_reads_read()
                .get("items", "open_item")
                .unwrap()
                .unwrap()["state"],
            "open"
        );
    }

    #[test]
    fn enum_domain_narrowing_scans_existing_rows_in_the_activation_transaction() {
        let mut conforming = LocalDatabase::memory().expect("memory database");
        conforming
            .schema_seed()
            .apply_schema(schema(vec![field(
                "state",
                domain(&["open", "closed", "archived"]),
                false,
            )]))
            .expect("apply wide enum");
        insert(
            &mut conforming,
            "open_item",
            Map::from_iter([("state".to_owned(), json!("open"))]),
        )
        .expect("seed conforming value");
        conforming
            .schema_seed()
            .apply_schema(schema(vec![field(
                "state",
                domain(&["open", "closed"]),
                false,
            )]))
            .expect("conforming enum narrowing succeeds");

        let mut refusing = LocalDatabase::memory().expect("memory database");
        refusing
            .schema_seed()
            .apply_schema(schema(vec![field(
                "state",
                domain(&["open", "closed", "archived"]),
                false,
            )]))
            .expect("apply wide enum");
        insert(
            &mut refusing,
            "archived_item",
            Map::from_iter([("state".to_owned(), json!("archived"))]),
        )
        .expect("seed soon-to-be excluded value");
        let error = refusing
            .schema_seed()
            .apply_schema(schema(vec![
                field("state", domain(&["open", "closed"]), false),
                field("note", FieldType::String, true),
            ]))
            .expect_err("nonconforming enum narrowing refuses");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_SCHEMA_ENUM_DOMAIN_BACKFILL_REQUIRED"
        );
        assert_eq!(error.diagnostic.details["table"], "items");
        assert_eq!(error.diagnostic.details["field"], "state");
        assert_eq!(error.diagnostic.details["offendingValue"], "archived");
        assert_eq!(
            error.diagnostic.details["admitted"],
            json!(["open", "closed"])
        );
        assert!(
            error
                .diagnostic
                .message
                .contains("snapback migrate preview --help")
        );
        assert_eq!(
            refusing
                .schema()
                .table("items")
                .unwrap()
                .field("state")
                .unwrap()
                .field_type,
            domain(&["open", "closed", "archived"]),
            "refusal leaves the manifest unchanged"
        );
        let note_columns: i64 = refusing
            .conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('items') WHERE name='note'",
                [],
                |row| row.get(0),
            )
            .expect("new-column probe");
        assert_eq!(note_columns, 0, "refusal occurs before additive DDL");
    }

    #[test]
    fn string_to_enum_scans_existing_rows_in_the_activation_transaction() {
        let mut conforming = LocalDatabase::memory().expect("memory database");
        conforming
            .schema_seed()
            .apply_schema(schema(vec![field("state", FieldType::String, false)]))
            .expect("apply string schema");
        insert(
            &mut conforming,
            "open_item",
            Map::from_iter([("state".to_owned(), json!("open"))]),
        )
        .expect("seed conforming string");
        conforming
            .schema_seed()
            .apply_schema(schema(vec![field(
                "state",
                domain(&["open", "closed"]),
                false,
            )]))
            .expect("conforming string to enum succeeds");

        let mut refusing = LocalDatabase::memory().expect("memory database");
        refusing
            .schema_seed()
            .apply_schema(schema(vec![field("state", FieldType::String, false)]))
            .expect("apply string schema");
        insert(
            &mut refusing,
            "pending_item",
            Map::from_iter([("state".to_owned(), json!("pending"))]),
        )
        .expect("seed nonconforming string");
        let error = refusing
            .schema_seed()
            .apply_schema(schema(vec![
                field("state", domain(&["open", "closed"]), false),
                field("note", FieldType::String, true),
            ]))
            .expect_err("nonconforming string to enum refuses");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_SCHEMA_ENUM_DOMAIN_BACKFILL_REQUIRED"
        );
        assert_eq!(error.diagnostic.details["offendingValue"], "pending");
        assert_eq!(
            refusing
                .schema()
                .table("items")
                .unwrap()
                .field("state")
                .unwrap()
                .field_type,
            FieldType::String
        );
        let note_columns: i64 = refusing
            .conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('items') WHERE name='note'",
                [],
                |row| row.get(0),
            )
            .expect("new-column probe");
        assert_eq!(note_columns, 0, "refusal occurs before additive DDL");
    }

    #[test]
    fn enum_to_string_admits_without_touching_rows() {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(schema(vec![field(
                "state",
                domain(&["open", "closed"]),
                false,
            )]))
            .expect("apply enum schema");
        insert(
            &mut db,
            "open_item",
            Map::from_iter([("state".to_owned(), json!("open"))]),
        )
        .expect("seed enum row");
        db.schema_seed()
            .apply_schema(schema(vec![field("state", FieldType::String, false)]))
            .expect("enum to string is declaration-only");
        assert_eq!(
            db.schema()
                .table("items")
                .unwrap()
                .field("state")
                .unwrap()
                .field_type,
            FieldType::String
        );
        assert_eq!(
            db.query_reads_read()
                .get("items", "open_item")
                .unwrap()
                .unwrap()["state"],
            "open"
        );
    }

    #[test]
    fn non_string_scalar_to_enum_remains_a_logical_retype() {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(schema(vec![field("state", FieldType::Integer, false)]))
            .expect("apply integer schema");
        let error = db
            .schema_seed()
            .apply_schema(schema(vec![field(
                "state",
                domain(&["open", "closed"]),
                false,
            )]))
            .expect_err("integer to enum remains a retype");
        assert_eq!(error.diagnostic.code, "SNAPBACK_SCHEMA_FIELD_RETYPED");
        assert_eq!(
            db.schema()
                .table("items")
                .unwrap()
                .field("state")
                .unwrap()
                .field_type,
            FieldType::Integer
        );
        let declared: String = db
            .conn
            .query_row(
                "SELECT type FROM pragma_table_info('items') WHERE name='state'",
                [],
                |row| row.get(0),
            )
            .expect("integer column declaration");
        assert_eq!(declared, "INTEGER");
    }
}

#[cfg(test)]
mod stored_structured_value_tests {
    use super::*;
    use crate::manifest::{
        IndexManifest, ResultObjectFieldContract, ResultValueContract, StoredStructuredContractV1,
    };

    fn member(name: &str, required: bool, value: ResultValueContract) -> ResultObjectFieldContract {
        ResultObjectFieldContract {
            name: name.to_owned(),
            required,
            value,
        }
    }

    fn object(fields: Vec<ResultObjectFieldContract>) -> ResultValueContract {
        ResultValueContract::Object {
            fields,
            allow_extra: false,
        }
    }

    fn carrier(descriptor: ResultValueContract) -> (StoredStructuredContractV1, String) {
        let contract = StoredStructuredContractV1 {
            version: crate::manifest::STORED_STRUCTURED_CONTRACT_VERSION_V1,
            descriptor,
            encoding: crate::manifest::STORED_STRUCTURED_ENCODING_V1.to_owned(),
        };
        let hash = crate::manifest::stored_structured_contract_hash(&contract)
            .expect("structured carrier hash");
        (contract, hash)
    }

    fn field(name: &str, descriptor: ResultValueContract) -> FieldManifest {
        let (contract, contract_hash) = carrier(descriptor);
        FieldManifest {
            name: name.to_owned(),
            field_type: FieldType::Structured {
                contract,
                contract_hash,
            },
            optional: false,
        }
    }

    fn schema(fields: Vec<FieldManifest>) -> SchemaManifest {
        SchemaManifest {
            required_capabilities: vec!["structured_stored_value_v1".to_owned()],
            tables: vec![TableManifest {
                name: "items".to_owned(),
                fields,
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            }],
            ..SchemaManifest::default()
        }
    }

    fn insert(db: &mut LocalDatabase, id: &str, values: Map<String, Value>) -> SnapbackResult<()> {
        db.mutation_writes().commit_buffered_writes(
            &HandlerInput::default(),
            vec![BufferedWrite::Insert {
                table: "items".to_owned(),
                id: id.to_owned(),
                values,
            }],
            Vec::new(),
            Value::Null,
        )?;
        Ok(())
    }

    fn numeric_payload() -> ResultValueContract {
        object(vec![
            member(
                "n",
                true,
                ResultValueContract::FiniteReal {
                    min: -100.0,
                    max: 100.0,
                },
            ),
            member(
                "nested",
                true,
                object(vec![member(
                    "label",
                    true,
                    ResultValueContract::String { max_bytes: 64 },
                )]),
            ),
        ])
    }

    #[test]
    fn rust_and_js_share_the_exact_carrier_golden() {
        let descriptor = object(vec![
            member(
                "quote",
                true,
                object(vec![
                    member(
                        "author",
                        true,
                        ResultValueContract::String { max_bytes: 64 },
                    ),
                    member("text", true, ResultValueContract::String { max_bytes: 512 }),
                ]),
            ),
            member(
                "options",
                true,
                ResultValueContract::Array {
                    element: Box::new(object(vec![
                        member("label", true, ResultValueContract::String { max_bytes: 80 }),
                        member(
                            "votes",
                            true,
                            ResultValueContract::Integer {
                                min: 0,
                                max: 9_007_199_254_740_991,
                            },
                        ),
                        member(
                            "note",
                            false,
                            ResultValueContract::String { max_bytes: 128 },
                        ),
                    ])),
                    max_items: 32,
                },
            ),
        ]);
        let (contract, hash) = carrier(descriptor);
        assert_eq!(
            hash,
            "sha256:0969c39c1a3f91259a7949665d61ea93314a6182de90d1f82443f3f8c842a01c"
        );
        assert_eq!(
            crate::rqs_contract::jcs(&serde_json::to_value(&contract).unwrap()).unwrap(),
            "{\"descriptor\":{\"allowExtra\":false,\"fields\":[{\"name\":\"quote\",\"required\":true,\"value\":{\"allowExtra\":false,\"fields\":[{\"name\":\"author\",\"required\":true,\"value\":{\"kind\":\"string\",\"maxBytes\":64}},{\"name\":\"text\",\"required\":true,\"value\":{\"kind\":\"string\",\"maxBytes\":512}}],\"kind\":\"object\"}},{\"name\":\"options\",\"required\":true,\"value\":{\"element\":{\"allowExtra\":false,\"fields\":[{\"name\":\"label\",\"required\":true,\"value\":{\"kind\":\"string\",\"maxBytes\":80}},{\"name\":\"votes\",\"required\":true,\"value\":{\"kind\":\"integer\",\"max\":9007199254740991,\"min\":0}},{\"name\":\"note\",\"required\":false,\"value\":{\"kind\":\"string\",\"maxBytes\":128}}],\"kind\":\"object\"},\"kind\":\"array\",\"maxItems\":32}}],\"kind\":\"object\"},\"encoding\":\"canonical-json-text.v1\",\"version\":1}"
        );
    }

    #[test]
    fn ordinary_buffered_patch_and_seed_routes_canonicalize_integral_reals() {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.apply_schema(schema(vec![field("payload", numeric_payload())]))
            .expect("apply structured schema");
        let declared: String = db
            .conn
            .query_row(
                "SELECT type FROM pragma_table_info('items') WHERE name='payload'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(declared, "TEXT");

        db.mutation_writes()
            .execute_mutation(
                &MutationPlan {
                    steps: vec![MutationStep::Insert {
                        table: "items".to_owned(),
                        values: BTreeMap::from([(
                            "payload".to_owned(),
                            ValueExpr::Literal(json!({ "nested": { "label": "first" }, "n": 5.0 })),
                        )]),
                        bind_id_as: None,
                    }],
                    return_value: None,
                },
                &HandlerInput::default(),
            )
            .expect("ordinary structured insert");
        let inserted_id: String = db
            .conn
            .query_row("SELECT _id FROM items", [], |row| row.get(0))
            .expect("ordinary inserted id");
        let stored: String = db
            .conn
            .query_row(
                "SELECT payload FROM items WHERE _id=?1",
                [&inserted_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, r#"{"n":5,"nested":{"label":"first"}}"#);
        assert_eq!(
            db.get("items", &inserted_id).unwrap().unwrap()["payload"]["n"],
            json!(5)
        );

        db.mutation_writes()
            .execute_mutation(
                &MutationPlan {
                    steps: vec![MutationStep::Patch {
                        table: "items".to_owned(),
                        id: ValueExpr::Literal(json!(inserted_id.clone())),
                        values: BTreeMap::from([(
                            "payload".to_owned(),
                            ValueExpr::Literal(
                                json!({ "nested": { "label": "patched" }, "n": 6.0 }),
                            ),
                        )]),
                    }],
                    return_value: None,
                },
                &HandlerInput::default(),
            )
            .expect("ordinary structured patch");
        assert_eq!(
            db.get("items", &inserted_id).unwrap().unwrap()["payload"],
            json!({ "n": 6, "nested": { "label": "patched" } })
        );

        insert(
            &mut db,
            "buffered",
            Map::from_iter([(
                "payload".to_owned(),
                json!({ "nested": { "label": "buffered" }, "n": 6.0 }),
            )]),
        )
        .expect("buffered structured insert");
        assert_eq!(
            db.get("items", "buffered").unwrap().unwrap()["payload"]["n"],
            json!(6)
        );

        db.reset_and_seed(Some(SeedData {
            tables: BTreeMap::from([(
                "items".to_owned(),
                vec![Map::from_iter([
                    ("_id".to_owned(), json!("seeded")),
                    (
                        "payload".to_owned(),
                        json!({ "nested": { "label": "seed" }, "n": 7.0 }),
                    ),
                ])],
            )]),
        }))
        .expect("structured seed");
        assert_eq!(
            db.get("items", "seeded").unwrap().unwrap()["payload"]["n"],
            json!(7)
        );
    }

    #[test]
    fn privileged_import_routes_through_structured_admission() {
        let mut declared = schema(vec![
            FieldManifest {
                name: "userId".to_owned(),
                field_type: FieldType::Principal,
                optional: false,
            },
            FieldManifest {
                name: "role".to_owned(),
                field_type: FieldType::String,
                optional: false,
            },
            field("profile", numeric_payload()),
        ]);
        let table = &mut declared.tables[0];
        table.name = "app_roles".to_owned();
        table.membership = Some(MembershipManifest {
            id: Some("appRoles".to_owned()),
            principal: "userId".to_owned(),
            resource: None,
            role: "role".to_owned(),
            roles: vec!["admin".to_owned()],
            pending_roles: None,
            bootstrap_role: None,
            last_holder: None,
            expiry: None,
            incidental: None,
            provenance: None,
            transitions: Vec::new(),
            scope: MembershipScope::App,
            resource_table: None,
            principal_addressed_writes: None,
        });

        let mut db = LocalDatabase::memory().expect("memory database");
        db.apply_schema(declared).expect("structured import schema");
        let importer = MembershipWriter::Import {
            granted_by_actor: "original-agent".to_owned(),
            granted_by_effective: "original-user".to_owned(),
            granted_by_grant: Some("historical-grant".to_owned()),
        };
        let plan = db
            .plan_privileged_membership_insert(
                &importer,
                "app_roles",
                Map::from_iter([
                    ("userId".to_owned(), json!("alice")),
                    ("role".to_owned(), json!("admin")),
                    (
                        "profile".to_owned(),
                        json!({ "nested": { "label": "imported" }, "n": 8.0 }),
                    ),
                ]),
            )
            .expect("privileged import plan");
        db.commit_membership_plan(&importer, plan)
            .expect("privileged structured import");
        let stored: String = db
            .conn
            .query_row(
                "SELECT profile FROM app_roles WHERE userId='alice'",
                [],
                |row| row.get(0),
            )
            .expect("canonical imported profile");
        assert_eq!(stored, r#"{"n":8,"nested":{"label":"imported"}}"#);
    }

    #[test]
    fn invalid_shape_reports_an_rfc6901_pointer_and_writes_nothing() {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.apply_schema(schema(vec![field("payload", numeric_payload())]))
            .unwrap();
        let error = insert(
            &mut db,
            "invalid",
            Map::from_iter([(
                "payload".to_owned(),
                json!({ "n": "not-a-number", "nested": { "label": "x" } }),
            )]),
        )
        .expect_err("invalid structured write refuses");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STRUCTURED_VALUE_INVALID");
        assert_eq!(error.diagnostic.details["path"], "/n");
        assert!(db.get("items", "invalid").unwrap().is_none());
    }

    #[test]
    fn structured_principal_arrays_round_trip_as_nominal_snapshots() {
        let recipients = ResultValueContract::Array {
            element: Box::new(ResultValueContract::Principal),
            max_items: 8,
        };
        let mut db = LocalDatabase::memory().expect("memory database");
        db.apply_schema(schema(vec![field("recipients", recipients)]))
            .expect("principal snapshot schema");
        insert(
            &mut db,
            "message-1",
            Map::from_iter([("recipients".to_owned(), json!(["user-1", "agent-2"]))]),
        )
        .expect("principal snapshot insert");
        assert_eq!(
            db.get("items", "message-1").unwrap().unwrap()["recipients"],
            json!(["user-1", "agent-2"]),
        );

        let invalid = insert(
            &mut db,
            "message-2",
            Map::from_iter([("recipients".to_owned(), json!([""]))]),
        )
        .expect_err("an empty principal is not a nominal snapshot value");
        assert_eq!(invalid.diagnostic.code, "SNAPBACK_STRUCTURED_VALUE_INVALID");
        assert_eq!(invalid.diagnostic.details["path"], "/0");
    }

    #[test]
    fn carrier_hash_and_all_four_bounds_fail_closed() {
        let mut hash_mismatch = field("payload", numeric_payload());
        let FieldType::Structured { contract_hash, .. } = &mut hash_mismatch.field_type else {
            unreachable!()
        };
        *contract_hash =
            "sha256:0000000000000000000000000000000000000000000000000000000000000000".to_owned();
        let mut db = LocalDatabase::memory().unwrap();
        assert_eq!(
            db.apply_schema(schema(vec![hash_mismatch]))
                .expect_err("hash mismatch refuses")
                .diagnostic
                .code,
            "SNAPBACK_STRUCTURED_CONTRACT_HASH_INVALID"
        );

        let text = object(vec![member(
            "text",
            true,
            ResultValueContract::String {
                max_bytes: 1024 * 1024,
            },
        )]);
        let mut db = LocalDatabase::memory().unwrap();
        db.apply_schema(schema(vec![field("payload", text.clone())]))
            .unwrap();
        let oversized = insert(
            &mut db,
            "oversized",
            Map::from_iter([(
                "payload".to_owned(),
                json!({ "text": "x".repeat(MAX_STORED_STRUCTURED_VALUE_BYTES) }),
            )]),
        )
        .expect_err("value byte ceiling refuses");
        assert_eq!(
            oversized.diagnostic.code,
            "SNAPBACK_STRUCTURED_VALUE_BYTES_EXCEEDED"
        );
        assert_eq!(oversized.diagnostic.details["path"], "");

        let arrays = ResultValueContract::Array {
            element: Box::new(ResultValueContract::Integer {
                min: 0,
                max: 9_007_199_254_740_991,
            }),
            max_items: 1_024,
        };
        let mut db = LocalDatabase::memory().unwrap();
        db.apply_schema(schema(vec![field("payload", arrays)]))
            .unwrap();
        let elements = insert(
            &mut db,
            "too-many-elements",
            Map::from_iter([(
                "payload".to_owned(),
                Value::Array((0..1_025).map(|value| json!(value)).collect()),
            )]),
        )
        .expect_err("element ceiling refuses");
        assert_eq!(
            elements.diagnostic.code,
            "SNAPBACK_STRUCTURED_VALUE_INVALID"
        );
        assert!(elements.diagnostic.details["path"].is_string());

        let mut nested = object(vec![]);
        for index in 0..17 {
            nested = object(vec![member(&format!("d{index}"), true, nested)]);
        }
        let mut db = LocalDatabase::memory().unwrap();
        let depth = db
            .apply_schema(schema(vec![field("payload", nested)]))
            .expect_err("descriptor depth ceiling refuses");
        assert_eq!(
            depth.diagnostic.code,
            "SNAPBACK_STRUCTURED_CONTRACT_INVALID"
        );
        assert!(
            depth.diagnostic.details["reason"]
                .as_str()
                .unwrap()
                .contains("depth")
        );

        let mut db = LocalDatabase::memory().unwrap();
        db.apply_schema(schema(vec![
            field("left", text.clone()),
            field("right", text),
        ]))
        .unwrap();
        let aggregate = insert(
            &mut db,
            "aggregate",
            Map::from_iter([
                ("left".to_owned(), json!({ "text": "l".repeat(25_000) })),
                ("right".to_owned(), json!({ "text": "r".repeat(25_000) })),
            ]),
        )
        .expect_err("row aggregate ceiling refuses");
        assert_eq!(
            aggregate.diagnostic.code,
            "SNAPBACK_STRUCTURED_ROW_BYTES_EXCEEDED"
        );
        assert_eq!(aggregate.diagnostic.details["path"], "");
        assert!(db.get("items", "aggregate").unwrap().is_none());
    }

    #[test]
    fn rust_observation_gates_refuse_indexes_filters_orders_and_stored_fields() {
        let payload = field(
            "payload",
            object(vec![member(
                "label",
                true,
                ResultValueContract::String { max_bytes: 64 },
            )]),
        );
        let mut indexed = schema(vec![payload.clone()]);
        indexed.tables[0].indexes.push(IndexManifest {
            name: "by_payload".to_owned(),
            fields: vec!["payload".to_owned()],
            unique: false,
            where_applicable: false,
        });
        let mut db = LocalDatabase::memory().unwrap();
        assert_eq!(
            db.apply_schema(indexed)
                .expect_err("ordinary structured index refuses")
                .diagnostic
                .code,
            "SNAPBACK_SCHEMA_STRUCTURED_INDEX_UNSUPPORTED"
        );

        let table = schema(vec![payload.clone()]).tables.remove(0);
        assert_eq!(
            validate_query_filter_value(&table, "payload", &json!({ "label": "x" }))
                .expect_err("structured filter refuses")
                .diagnostic
                .code,
            "SNAPBACK_QUERY_FILTER_UNSUPPORTED_FIELD_TYPE"
        );
        assert_eq!(
            ensure_orderable_field(&table, "payload")
                .expect_err("structured order refuses")
                .diagnostic
                .code,
            "SNAPBACK_QUERY_ORDER_UNSUPPORTED_FIELD_TYPE"
        );

        let vector_index = crate::vector::VectorIndexManifestV1 {
            format_version: 1,
            name: "by_embedding".to_owned(),
            semantic_version: "structured-refusal.v1".to_owned(),
            vector_field: "embedding".to_owned(),
            dimensions: 2,
            metric: crate::vector::VectorMetricV1::L2sq,
            distance_profile: crate::vector::VECTOR_DISTANCE_PROFILE_ID.to_owned(),
            ordering_profile: crate::vector::VECTOR_ORDERING_PROFILE_ID.to_owned(),
            field_classifications: BTreeMap::from([
                (
                    "embedding".to_owned(),
                    crate::vector::VectorFieldClassV1::Public,
                ),
                (
                    "payload".to_owned(),
                    crate::vector::VectorFieldClassV1::Public,
                ),
            ]),
            equality_filters: Vec::new(),
            stored_fields: vec!["payload".to_owned()],
            visibility: crate::vector::VectorVisibilityV1::PublicRead,
            tie_break: crate::vector::VectorTieBreakV1::IdAsc,
            max_indexed_vectors_per_partition: 128,
            max_scalar_pairs: 256,
            maintenance_limits: crate::vector::VectorMaintenanceLimitsV1::default(),
        };
        let mut vector_table = table.clone();
        vector_table.fields.push(FieldManifest {
            name: "embedding".to_owned(),
            field_type: FieldType::Vector { dimensions: 2 },
            optional: false,
        });
        assert_eq!(
            crate::manifest::validate_vector_index_manifest(&vector_table, &vector_index)
                .expect_err("vector structured storedFields refuses")
                .diagnostic
                .code,
            "SNAPBACK_VECTOR_INDEX_INVALID"
        );

        let search_index = crate::search::types::SearchIndexManifestV1 {
            format_version: 1,
            name: "by_title".to_owned(),
            semantic_version: "structured-refusal.v1".to_owned(),
            analyzer: crate::search::types::SEARCH_ANALYZER.to_owned(),
            analyzer_tables_digest: crate::search::unicode17_generated::ANALYZER_TABLES_DIGEST
                .to_owned(),
            text_fields: BTreeMap::from([(
                "title".to_owned(),
                crate::search::types::SearchTextFieldV1 {
                    weight: 1,
                    classification: crate::search::types::SearchFieldClassV1::Public,
                },
            )]),
            field_classifications: BTreeMap::from([(
                "payload".to_owned(),
                crate::search::types::SearchFieldClassV1::Public,
            )]),
            equality_filters: Vec::new(),
            stored_fields: vec!["payload".to_owned()],
            highlight_fields: Vec::new(),
            visibility: crate::search::types::SearchVisibilityV1::PublicRead,
            tie_break: "score-desc-row-id-asc.v1".to_owned(),
            source_limits: Default::default(),
            query_limits: Default::default(),
            cursor_limits: Default::default(),
            maintenance_limits: Default::default(),
            live_limits: None,
        };
        let search_fields = vec![
            payload.clone(),
            FieldManifest {
                name: "title".to_owned(),
                field_type: FieldType::String,
                optional: false,
            },
        ];
        let mut equality_search = search_index.clone();
        equality_search.equality_filters = vec!["payload".to_owned()];
        equality_search.stored_fields.clear();
        let mut search_schema = schema(search_fields.clone());
        search_schema.tables[0].search_indexes.push(equality_search);
        let mut db = LocalDatabase::memory().unwrap();
        assert_eq!(
            db.apply_schema(search_schema)
                .expect_err("search structured equality membership refuses")
                .diagnostic
                .code,
            "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID"
        );

        let mut search_schema = schema(search_fields);
        search_schema.tables[0].search_indexes.push(search_index);
        let mut db = LocalDatabase::memory().unwrap();
        assert_eq!(
            db.apply_schema(search_schema)
                .expect_err("search structured storedFields refuses")
                .diagnostic
                .code,
            "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID"
        );
    }

    #[test]
    fn encoding_identity_change_is_a_plannable_successor_not_metadata_drift() {
        let predecessor = schema(vec![field("payload", numeric_payload())]);
        let mut successor = predecessor.clone();
        let FieldType::Structured {
            contract,
            contract_hash,
        } = &mut successor.tables[0].fields[0].field_type
        else {
            unreachable!()
        };
        contract.encoding = "canonical-json-text.v2".to_owned();
        *contract_hash = crate::manifest::stored_structured_contract_hash(contract).unwrap();

        let predecessor_identity =
            crate::storage::migration_executor::schema_identity(&predecessor).unwrap();
        let successor_identity =
            crate::storage::migration_executor::schema_identity(&successor).unwrap();
        assert_ne!(predecessor_identity, successor_identity);
        let error = crate::migration::derive_intents(&predecessor, &successor)
            .expect_err("an encoding change requires an explicit conversion generation");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_INVALID");
        assert!(error.diagnostic.message.contains("declare ConvertField"));
    }
}

#[cfg(test)]
mod guarded_commit_tests {
    use super::*;
    use std::cell::Cell;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier};

    fn migration_scan_database() -> LocalDatabase {
        use crate::manifest::IndexManifest;
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(SchemaManifest {
                tables: vec![TableManifest {
                    name: "scanned".to_owned(),
                    fields: vec![
                        FieldManifest {
                            name: "k".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                        FieldManifest {
                            name: "v".to_owned(),
                            field_type: FieldType::String,
                            optional: true,
                        },
                    ],
                    indexes: vec![
                        IndexManifest {
                            name: "by_k".to_owned(),
                            fields: vec!["k".to_owned()],
                            unique: false,
                            where_applicable: false,
                        },
                        IndexManifest {
                            name: "by_k_v".to_owned(),
                            fields: vec!["k".to_owned(), "v".to_owned()],
                            unique: false,
                            where_applicable: false,
                        },
                    ],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                }],
                ..SchemaManifest::default()
            })
            .expect("apply scan schema");
        let row = |id: &str, k: &str, v: Option<&str>| {
            let mut object = Map::new();
            object.insert("_id".to_owned(), json!(id));
            object.insert("k".to_owned(), json!(k));
            if let Some(v) = v {
                object.insert("v".to_owned(), json!(v));
            }
            object
        };
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "scanned".to_owned(),
                    vec![
                        row("r1", "alpha", Some("1")),
                        row("r2", "alpha", Some("2")),
                        row("r3", "beta", None),
                        row("r4", "beta", Some("4")),
                        row("r5", "beta", Some("5")),
                        row("r6", "gamma", None),
                        row("r7", "delta", Some("7")),
                    ],
                )]),
            })
            .expect("seed scan rows");
        db
    }

    fn migration_scan_request(max_batch_rows: u32) -> MigrationKeysetScanRequestV1 {
        MigrationKeysetScanRequestV1 {
            table: "scanned".to_owned(),
            index: Some("by_k".to_owned()),
            validators: vec![
                MigrationScanValidatorV1::NonNull {
                    field: "v".to_owned(),
                },
                MigrationScanValidatorV1::Unique {
                    field: "k".to_owned(),
                    additional_fields: Vec::new(),
                    where_applicable: false,
                },
            ],
            digest: Some(crate::rqs_contract::ContentDigestHeaderV1 {
                algorithm_version: 1,
                plan_digest: "sha256:test".to_owned(),
                schema_hash: "sha256:schema".to_owned(),
                qualified_table: "app.scanned".to_owned(),
                generation: "gen-1".to_owned(),
                barrier_head: 7,
                publication_version: 8,
                publication_timestamp: 1_784_000_000_000,
            }),
            ceilings: MigrationScanCeilingsV1 {
                max_batch_rows,
                max_batch_bytes: 1024 * 1024,
                max_batch_millis: 10_000,
            },
        }
    }

    fn run_scan_to_completion(
        db: &LocalDatabase,
        request: &MigrationKeysetScanRequestV1,
    ) -> MigrationKeysetScanBatch {
        let mut checkpoint: Option<MigrationKeysetScanCheckpointV1> = None;
        for _ in 0..64 {
            let batch = db
                .migration_keyset_scan_batch(request, checkpoint.as_ref())
                .expect("scan batch");
            if batch.done {
                return batch;
            }
            // The checkpoint round-trips through serialization exactly as
            // the executor journal will persist it.
            let serialized =
                serde_json::to_string(&batch.checkpoint).expect("checkpoint serializes");
            checkpoint = Some(serde_json::from_str(&serialized).expect("checkpoint parses"));
        }
        panic!("scan did not complete within 64 batches");
    }

    // @ref LLP 0160#2-the-ideal-experience-moment-by-moment — Moment 3's
    // estimate comes from snapshot-pinned, bounded observation facts, not the
    // sealed plan. A count stops one row beyond the approval ceiling so an
    // already-oversized target is visible without an unbounded preview scan.
    #[test]
    fn migration_preview_populates_bounded_precondition_rows() {
        let mut db = migration_scan_database();
        let mut successor = db.schema().clone();
        successor.tables[0].fields.push(FieldManifest {
            name: "required_later".to_owned(),
            field_type: FieldType::String,
            optional: false,
        });
        let steps = crate::migration::derive_plan_steps(
            &successor,
            &[crate::migration::MigrationIntent::AddRequiredField {
                table: "scanned".to_owned(),
                field: "required_later".to_owned(),
                field_type: FieldType::String,
                backfill: ValueExpr::Literal(json!("default")),
            }],
        )
        .expect("derive reviewed backfill steps");

        let (head, bounded) = db
            .migration_preview_observation_facts(&steps, 2)
            .expect("bounded observation");
        assert_eq!(head, db.current_version().unwrap());
        assert_eq!(bounded.len(), 2, "backfill and validation read rows");
        assert!(
            bounded.values().all(|rows| *rows == 3),
            "ceiling plus one is the bounded oversize signal"
        );

        let (complete_head, complete) = db
            .migration_preview_observation_facts(&steps, 10)
            .expect("complete observation below its ceiling");
        assert_eq!(complete.len(), 2);
        assert!(complete.values().all(|rows| *rows == 7));
        assert!(
            steps
                .iter()
                .filter(|step| step.reads.is_empty())
                .all(|step| !complete.contains_key(&step.id)),
            "steps without a declared read table have no inferred estimate"
        );

        let before = crate::migration::MigrationPreviewObservationV1 {
            schema_version: crate::migration::MIGRATION_OBSERVATION_SCHEMA_VERSION.to_owned(),
            plan_digest: "same-plan-digest".to_owned(),
            target_head_version: complete_head,
            observed_at_ms: 1,
            precondition_rows: complete,
            capability_health: BTreeMap::new(),
        };
        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Insert {
                    table: "scanned".to_owned(),
                    id: "r8".to_owned(),
                    values: Map::from_iter([
                        ("k".to_owned(), json!("epsilon")),
                        ("v".to_owned(), json!("8")),
                    ]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("insert one row into the preview's own target data source");
        let (changed_head, changed_rows) = db
            .migration_preview_observation_facts(&steps, 10)
            .expect("observe the changed target data");
        assert!(changed_head > complete_head);
        assert!(changed_rows.values().all(|rows| *rows == 8));
        let after = crate::migration::MigrationPreviewObservationV1 {
            target_head_version: changed_head,
            precondition_rows: changed_rows,
            ..before.clone()
        };
        assert_ne!(
            crate::migration::observation_digest(&before).unwrap(),
            crate::migration::observation_digest(&after).unwrap(),
            "target-data changes alter only the separately digested observation carrier"
        );
    }

    // @ref LLP 0081#3-typed-migration-steps — the privileged scan reads in
    //   stable key order with checkpointed cursors and emits only closed
    //   facts: interrupting it at every batch size yields byte-identical
    //   facts and sealed ContentDigestV1 values to the one-shot scan.
    #[test]
    fn migration_keyset_scan_is_batch_invariant() {
        let db = migration_scan_database();
        let one_shot = run_scan_to_completion(&db, &migration_scan_request(1024));
        assert_eq!(one_shot.checkpoint.rows_scanned, 7);
        let (logical, system) = one_shot.sealed_digests.clone().expect("sealed digests");
        assert!(logical.starts_with("cdv1:") && system.starts_with("cdv1:"));
        // Facts: two null/absent v rows (r3, r6); duplicates within k:
        // alpha x2 -> 1, beta x3 -> 2 (adjacent in by_k order).
        let non_null = one_shot
            .checkpoint
            .validators
            .iter()
            .find_map(|state| match state {
                MigrationScanValidatorStateV1::NonNull {
                    violations,
                    samples,
                    ..
                } => Some((*violations, samples.clone())),
                _ => None,
            })
            .expect("non-null facts");
        assert_eq!(non_null.0, 2);
        assert_eq!(non_null.1, vec!["r3".to_owned(), "r6".to_owned()]);
        let unique = one_shot
            .checkpoint
            .validators
            .iter()
            .find_map(|state| match state {
                MigrationScanValidatorStateV1::Unique { duplicates, .. } => Some(*duplicates),
                _ => None,
            })
            .expect("unique facts");
        assert_eq!(unique, 3, "alpha contributes one duplicate, beta two");

        for batch_rows in 1..=8 {
            let resumed = run_scan_to_completion(&db, &migration_scan_request(batch_rows));
            assert_eq!(
                resumed.checkpoint.rows_scanned, one_shot.checkpoint.rows_scanned,
                "batch size {batch_rows}"
            );
            assert_eq!(
                resumed.checkpoint.bytes_scanned, one_shot.checkpoint.bytes_scanned,
                "batch size {batch_rows}"
            );
            assert_eq!(
                resumed.checkpoint.validators, one_shot.checkpoint.validators,
                "batch size {batch_rows}"
            );
            assert_eq!(
                resumed.sealed_digests, one_shot.sealed_digests,
                "batch size {batch_rows}: resumed digests must equal one-shot"
            );
        }
    }

    // @ref LLP 0007#index-contract — the pre-publication uniqueness proof
    //   uses the same all-present compound participation rule as target DDL.
    #[test]
    fn migration_unique_scan_uses_compound_all_present_participation() {
        let mut db = migration_scan_database();
        let row = |id: &str, k: &str, v: Option<&str>| {
            let mut values = Map::from_iter([("k".to_owned(), json!(k))]);
            if let Some(v) = v {
                values.insert("v".to_owned(), json!(v));
            }
            BufferedWrite::Insert {
                table: "scanned".to_owned(),
                id: id.to_owned(),
                values,
            }
        };
        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![row("r8", "alpha", Some("1")), row("r9", "beta", None)],
                Vec::new(),
                Value::Null,
            )
            .expect("compound uniqueness scan fixtures");

        let request = MigrationKeysetScanRequestV1 {
            table: "scanned".to_owned(),
            index: Some("by_k_v".to_owned()),
            validators: vec![MigrationScanValidatorV1::Unique {
                field: "k".to_owned(),
                additional_fields: vec!["v".to_owned()],
                where_applicable: true,
            }],
            digest: None,
            ceilings: MigrationScanCeilingsV1 {
                max_batch_rows: 1,
                max_batch_bytes: 1024 * 1024,
                max_batch_millis: 10_000,
            },
        };
        let outcome = run_scan_to_completion(&db, &request);
        let duplicates = outcome
            .checkpoint
            .validators
            .iter()
            .find_map(|state| match state {
                MigrationScanValidatorStateV1::Unique { duplicates, .. } => Some(*duplicates),
                _ => None,
            })
            .expect("unique facts");
        assert_eq!(
            duplicates, 1,
            "only the duplicate (alpha, 1) participates; both (beta, absent) rows are exempt"
        );
    }

    // @ref LLP 0081#3-typed-migration-steps — ValidateRequired must count its
    //   exact target NULLs as closed facts while unrelated required-field
    //   corruption still fails through the ordinary strict decoder.
    #[test]
    fn migration_non_null_scan_allows_only_its_exact_validation_targets() {
        let db = migration_scan_database();
        db.conn
            .execute("ALTER TABLE scanned ADD COLUMN other TEXT", [])
            .expect("add a second physically nullable staged column");

        let mut effective = db.schema().clone();
        let table = effective
            .tables
            .iter_mut()
            .find(|table| table.name == "scanned")
            .expect("scanned table");
        table
            .fields
            .iter_mut()
            .find(|field| field.name == "v")
            .expect("v field")
            .optional = false;
        table.fields.push(FieldManifest {
            name: "other".to_owned(),
            field_type: FieldType::String,
            optional: false,
        });

        let request = MigrationKeysetScanRequestV1 {
            table: "scanned".to_owned(),
            index: None,
            validators: vec![MigrationScanValidatorV1::NonNull {
                field: "v".to_owned(),
            }],
            digest: None,
            ceilings: MigrationScanCeilingsV1 {
                max_batch_rows: 1024,
                max_batch_bytes: 1024 * 1024,
                max_batch_millis: 10_000,
            },
        };

        let error = migration_keyset_scan_batch_on(&db.conn, &effective, &request, None)
            .expect_err("an unrelated required NULL remains corrupt");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_FIELD_CORRUPT");
        assert_eq!(error.diagnostic.details["field"], "other");

        db.conn
            .execute("UPDATE scanned SET other = 'ready'", [])
            .expect("repair unrelated field");
        let outcome = migration_keyset_scan_batch_on(&db.conn, &effective, &request, None)
            .expect("the exact NonNull target is observable");
        let violations = outcome
            .checkpoint
            .validators
            .iter()
            .find_map(|state| match state {
                MigrationScanValidatorStateV1::NonNull { violations, .. } => Some(*violations),
                MigrationScanValidatorStateV1::Unique { .. } => None,
            })
            .expect("NonNull result");
        assert_eq!(violations, 2, "both staged v NULLs are counted");
    }

    // @ref LLP 0081#3-typed-migration-steps — scan refusals are typed and
    //   fail closed: ceilings outside the target caps, a checkpoint from a
    //   different scan, uniqueness without its leading index, and sealed
    //   digests withheld until the table is exhausted.
    #[test]
    fn migration_keyset_scan_refusals_and_sealing() {
        let db = migration_scan_database();

        let mut zero = migration_scan_request(0);
        zero.ceilings.max_batch_rows = 0;
        let error = db
            .migration_keyset_scan_batch(&zero, None)
            .expect_err("zero ceiling");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_INVALID");

        let mut oversized = migration_scan_request(4);
        oversized.ceilings.max_batch_bytes = MIGRATION_SCAN_MAX_BATCH_BYTES + 1;
        let error = db
            .migration_keyset_scan_batch(&oversized, None)
            .expect_err("oversized ceiling");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_INVALID");

        // Uniqueness demands its own order: `v` does not lead `by_k`.
        let mut misordered = migration_scan_request(4);
        misordered.validators = vec![MigrationScanValidatorV1::Unique {
            field: "v".to_owned(),
            additional_fields: Vec::new(),
            where_applicable: false,
        }];
        let error = db
            .migration_keyset_scan_batch(&misordered, None)
            .expect_err("uniqueness without leading index");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_INVALID");

        // A partial batch seals nothing and its checkpoint refuses to
        // resume a different request.
        let request = migration_scan_request(3);
        let partial = db
            .migration_keyset_scan_batch(&request, None)
            .expect("first batch");
        assert!(!partial.done);
        assert!(partial.sealed_digests.is_none());
        let other = migration_scan_request(3);
        let mut foreign = partial.checkpoint.clone();
        foreign.table = "items".to_owned();
        let error = db
            .migration_keyset_scan_batch(&other, Some(&foreign))
            .expect_err("foreign checkpoint");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MIGRATION_PRECONDITION_FAILED"
        );
    }

    fn schema() -> SchemaManifest {
        SchemaManifest {
            tables: vec![TableManifest {
                name: "items".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "title".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "rank".to_owned(),
                        field_type: FieldType::Integer,
                        optional: true,
                    },
                    FieldManifest {
                        name: "metadata".to_owned(),
                        field_type: FieldType::Json,
                        optional: true,
                    },
                ],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            }],
            ..SchemaManifest::default()
        }
    }

    fn database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(schema())
            .expect("apply test schema");
        db
    }

    fn apply_typed_decode_fixture(db: &mut LocalDatabase) {
        db.schema_seed()
            .apply_schema(SchemaManifest {
                tables: vec![TableManifest {
                    name: "typed_items".to_owned(),
                    fields: vec![
                        FieldManifest {
                            name: "label".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                        FieldManifest {
                            name: "flag".to_owned(),
                            field_type: FieldType::Boolean,
                            optional: false,
                        },
                        FieldManifest {
                            name: "count".to_owned(),
                            field_type: FieldType::Integer,
                            optional: false,
                        },
                        FieldManifest {
                            name: "score".to_owned(),
                            field_type: FieldType::Real,
                            optional: false,
                        },
                        FieldManifest {
                            name: "payload".to_owned(),
                            field_type: FieldType::Json,
                            optional: false,
                        },
                        FieldManifest {
                            name: "note".to_owned(),
                            field_type: FieldType::String,
                            optional: true,
                        },
                    ],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                }],
                ..SchemaManifest::default()
            })
            .expect("apply typed decode schema");
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "typed_items".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), json!("typed-row")),
                        ("label".to_owned(), json!("ok")),
                        ("flag".to_owned(), json!(true)),
                        ("count".to_owned(), json!(1)),
                        ("score".to_owned(), json!(1.5)),
                        ("payload".to_owned(), json!({ "ok": true })),
                        ("note".to_owned(), Value::Null),
                    ])],
                )]),
            })
            .expect("seed typed decode row");
    }

    fn typed_decode_database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        apply_typed_decode_fixture(&mut db);
        db
    }

    fn declared_storage_field(field_type: FieldType, optional: bool) -> FieldManifest {
        FieldManifest {
            name: "value".to_owned(),
            field_type,
            optional,
        }
    }

    fn assert_storage_field_corrupt<T: std::fmt::Debug>(
        result: SnapbackResult<T>,
        field: &str,
        lane: &str,
    ) {
        let error = result.expect_err("corrupt portable storage must fail closed");
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_STORAGE_FIELD_CORRUPT",
            "{field} {lane}"
        );
        assert_eq!(error.diagnostic.details["table"], "typed_items");
        assert_eq!(error.diagnostic.details["field"], field);
    }

    fn sequence_fact(db: &LocalDatabase, value: u64) -> SequenceAllocationFact {
        let incarnation = DbRead::Live(db)
            .active_relation_incarnation("items", "scope")
            .expect("incarnation lookup")
            .expect("active scope incarnation");
        SequenceAllocationFact {
            counter: "ticketNumber".to_owned(),
            scope_table: "items".to_owned(),
            scope_row_id: "scope".to_owned(),
            scope_incarnation: incarnation,
            value,
        }
    }

    fn commit_sequence(
        db: &mut LocalDatabase,
        fact: SequenceAllocationFact,
        identity: Option<&ClientMutationIdentity>,
        writes: Vec<BufferedWrite>,
    ) -> SnapbackResult<MutationCommit> {
        db.mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &HandlerInput::default(),
                BufferedCommitPayload {
                    writes,
                    sequence_allocations: vec![fact],
                    membership_plans: Vec::new(),
                    read_dependencies: Vec::new(),
                    result: json!({ "allocated": true }),
                    ctx_ledger: CtxAnswerLedger::default(),
                    job_enqueues: Vec::new(),
                    job_producer: None,
                    asset_admissions: Vec::new(),
                    asset_grant_ops: Vec::new(),
                    media_projection_proof: None,
                    expected_media_projection_binding: None,
                },
                identity,
                || Ok(()),
                || Ok(()),
            )
    }

    #[test]
    fn sequence_allocation_is_gapless_atomic_replay_safe_and_incarnation_scoped() {
        let mut db = database();
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), json!("scope")),
                        ("title".to_owned(), json!("original")),
                    ])],
                )]),
            })
            .expect("seed scope");

        let scope_tables = BTreeSet::from(["items".to_owned()]);
        db.conn
            .execute(
                "DELETE FROM _snapback_relation_incarnations_v1
                  WHERE table_name = 'items' AND row_id = 'scope'",
                [],
            )
            .expect("model a brownfield row predating incarnation enrollment");
        let activation = db
            .validate_sequence_scope_activation(&scope_tables)
            .expect_err("unregistered brownfield scope must refuse activation");
        assert_eq!(
            activation.diagnostic.code,
            "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED"
        );
        let tx = db.conn.transaction().expect("begin reviewed backfill");
        activate_relation_incarnation(&tx, "items", "scope")
            .expect("backfill active scope incarnation");
        tx.commit().expect("commit reviewed backfill");
        db.validate_sequence_scope_activation(&scope_tables)
            .expect("registered brownfield scope activates");

        let first = sequence_fact(&db, 1);
        db.mutation_writes()
            .dry_run_buffered_writes(
                &HandlerInput::default(),
                Vec::new(),
                vec![first.clone()],
                Vec::new(),
                Vec::new(),
                json!({ "sequence": 1 }),
                CtxAnswerLedger::default(),
                Vec::new(),
            )
            .expect("aborted preview validates");
        assert_eq!(
            DbRead::Live(&db)
                .sequence_next_value(
                    &first.counter,
                    &first.scope_table,
                    &first.scope_row_id,
                    &first.scope_incarnation,
                )
                .unwrap(),
            1,
            "dry-run/abort burns no value"
        );

        let identity =
            ClientMutationIdentity::new("cm-sequence", "allocate", &HandlerInput::default());
        let committed = commit_sequence(&mut db, first.clone(), Some(&identity), Vec::new())
            .expect("first allocation commits");
        assert_eq!(committed.sequence_allocations, vec![first.clone()]);
        let replay = db
            .settlement_read()
            .client_mutation_result(&identity)
            .expect("settlement lookup")
            .expect("exact settlement replay short-circuits before handler execution");
        assert_eq!(replay.result, committed.output.result);
        assert_eq!(replay.settlement_sequence_allocations, vec![first.clone()]);
        assert_eq!(
            DbRead::Live(&db)
                .sequence_next_value(
                    &first.counter,
                    &first.scope_table,
                    &first.scope_row_id,
                    &first.scope_incarnation,
                )
                .unwrap(),
            2,
            "replay advances exactly once"
        );

        let stale = sequence_fact(&db, 2);
        commit_sequence(&mut db, stale.clone(), None, Vec::new()).expect("second allocation");
        let conflict = commit_sequence(&mut db, stale, None, Vec::new())
            .expect_err("a stale allocator cannot commit a duplicate");
        assert_eq!(conflict.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");

        db.conn
            .execute(
                "UPDATE _snapback_sequence_counters_v1 SET next_value = ?1",
                params![i64::try_from(SEQUENCE_MAX_SAFE_INTEGER).unwrap()],
            )
            .expect("install maximum-allocatable boundary");
        let maximum = SequenceAllocationFact {
            value: SEQUENCE_MAX_SAFE_INTEGER,
            ..sequence_fact(&db, SEQUENCE_MAX_SAFE_INTEGER)
        };
        commit_sequence(&mut db, maximum, None, Vec::new())
            .expect("MAX_SAFE_INTEGER itself is allocatable");
        let exhausted = SequenceAllocationFact {
            value: SEQUENCE_MAX_SAFE_INTEGER + 1,
            ..sequence_fact(&db, SEQUENCE_MAX_SAFE_INTEGER + 1)
        };
        let failure = commit_sequence(
            &mut db,
            exhausted,
            None,
            vec![BufferedWrite::Patch {
                table: "items".to_owned(),
                id: "scope".to_owned(),
                values: Map::from_iter([("title".to_owned(), json!("must-roll-back"))]),
            }],
        )
        .expect_err("post-maximum allocation refuses");
        assert_eq!(failure.diagnostic.code, "SNAPBACK_SEQUENCE_EXHAUSTED");
        assert_eq!(
            db.query_reads_read()
                .get("items", "scope")
                .unwrap()
                .unwrap()["title"],
            json!("original"),
            "exhaustion rolls back source writes"
        );

        let predecessor_incarnation = first.scope_incarnation;
        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Delete {
                    table: "items".to_owned(),
                    id: "scope".to_owned(),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("delete old scope");
        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "scope".to_owned(),
                    values: Map::from_iter([("title".to_owned(), json!("successor"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("recreate scope");
        let restarted = sequence_fact(&db, 1);
        assert_ne!(restarted.scope_incarnation, predecessor_incarnation);
        commit_sequence(&mut db, restarted, None, Vec::new())
            .expect("successor incarnation restarts at one");
    }

    #[test]
    fn malformed_sequence_fact_cannot_commit_before_durable_replay_validation() {
        let mut db = database();
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), json!("scope")),
                        ("title".to_owned(), json!("original")),
                    ])],
                )]),
            })
            .expect("seed scope");

        let identity = ClientMutationIdentity::new(
            "cm-malformed-sequence",
            "allocate",
            &HandlerInput::default(),
        );
        let malformed = SequenceAllocationFact {
            counter: "bad/name".to_owned(),
            ..sequence_fact(&db, 1)
        };
        let failure = commit_sequence(
            &mut db,
            malformed,
            Some(&identity),
            vec![BufferedWrite::Patch {
                table: "items".to_owned(),
                id: "scope".to_owned(),
                values: Map::from_iter([("title".to_owned(), json!("must-roll-back"))]),
            }],
        )
        .expect_err("malformed retained sequence fact refuses the whole transaction");
        assert_eq!(
            failure.diagnostic.code,
            "SNAPBACK_SEQUENCE_DECLARATION_INVALID"
        );
        assert_eq!(
            db.query_reads_read()
                .get("items", "scope")
                .unwrap()
                .unwrap()["title"],
            json!("original"),
            "application writes roll back with the invalid replay fact"
        );
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_sequence_counters_v1",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("counter count"),
            0,
            "the rejected first invocation burns no sequence value"
        );
        assert!(
            db.settlement_read()
                .client_mutation_result(&identity)
                .expect("replay lookup after refusal")
                .is_none(),
            "the refused invocation leaves no poisoned replay row"
        );
    }

    #[test]
    fn noncanonical_sequence_scope_id_cannot_commit_or_burn() {
        let mut db = database();
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), json!("bad/id")),
                        ("title".to_owned(), json!("original")),
                    ])],
                )]),
            })
            .expect("seed accepts the legacy scope id");

        let incarnation = DbRead::Live(&db)
            .active_relation_incarnation("items", "bad/id")
            .expect("incarnation lookup")
            .expect("seeded scope incarnation");
        let fact = SequenceAllocationFact {
            counter: "ticketNumber".to_owned(),
            scope_table: "items".to_owned(),
            scope_row_id: "bad/id".to_owned(),
            scope_incarnation: incarnation,
            value: 1,
        };
        let failure = commit_sequence(
            &mut db,
            fact,
            None,
            vec![BufferedWrite::Patch {
                table: "items".to_owned(),
                id: "bad/id".to_owned(),
                values: Map::from_iter([("title".to_owned(), json!("must-roll-back"))]),
            }],
        )
        .expect_err("a sequence fact that cannot be retained must never commit");
        assert_eq!(
            failure.diagnostic.code,
            "SNAPBACK_SEQUENCE_DECLARATION_INVALID"
        );
        assert_eq!(
            db.query_reads_read()
                .get("items", "bad/id")
                .unwrap()
                .unwrap()["title"],
            json!("original")
        );
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_sequence_counters_v1",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("counter count"),
            0,
            "the refusal leaves no protected counter state"
        );
    }

    #[test]
    fn enrolled_sequence_scope_refuses_noncanonical_seed_row_atomically() {
        let mut db = database();
        db.install_sequence_declarations(item_sequence_declarations(), false)
            .expect("empty table enrolls as a sequence scope");
        let failure = db
            .schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), json!("bad/id")),
                        ("title".to_owned(), json!("must-not-commit")),
                    ])],
                )]),
            })
            .expect_err("an enrolled sequence scope cannot seed a non-replayable row id");
        assert_eq!(
            failure.diagnostic.code,
            "SNAPBACK_SEQUENCE_DECLARATION_INVALID"
        );
        assert!(
            db.query_reads_read()
                .get("items", "bad/id")
                .unwrap()
                .is_none(),
            "seed rollback leaves no invalid application row"
        );
        assert!(
            DbRead::Live(&db)
                .active_relation_incarnation("items", "bad/id")
                .unwrap()
                .is_none(),
            "seed rollback leaves no invalid active incarnation"
        );
    }

    #[test]
    fn order_field_utf8_bound_refuses_brownfield_and_all_central_writes() {
        let mut db = database();
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), json!("ordered")),
                        ("title".to_owned(), json!("four")),
                    ])],
                )]),
            })
            .expect("seed brownfield order row");

        let key = ("items".to_owned(), "title".to_owned());
        let too_small = BTreeMap::from([(key.clone(), 3)]);
        let adoption = db
            .validate_order_field_bounds(&too_small)
            .expect_err("brownfield value above a new bound refuses activation");
        assert_eq!(
            adoption.diagnostic.code,
            "SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED"
        );

        let bounds = BTreeMap::from([(key, 8)]);
        db.validate_order_field_bounds(&bounds)
            .expect("brownfield row fits the reviewed bound");
        db.set_order_field_bounds(bounds);

        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "ordered".to_owned(),
                    values: Map::from_iter([("title".to_owned(), json!("éééé"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("exact eight-byte UTF-8 value is admitted");
        let version = db.current_version().expect("version after admitted patch");

        let oversized = db
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "ordered".to_owned(),
                    values: Map::from_iter([("title".to_owned(), json!("ééééx"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect_err("nine-byte UTF-8 patch refuses");
        assert_eq!(
            oversized.diagnostic.code,
            "SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED"
        );
        assert_eq!(
            db.current_version().unwrap(),
            version,
            "oversized patch commits no version"
        );
        assert_eq!(
            db.query_reads_read()
                .get("items", "ordered")
                .unwrap()
                .unwrap()["title"],
            "éééé"
        );

        let oversized_insert = db
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "too-long".to_owned(),
                    values: Map::from_iter([("title".to_owned(), json!("123456789"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect_err("oversized insert refuses at the same writer");
        assert_eq!(
            oversized_insert.diagnostic.code,
            "SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED"
        );
        assert!(
            db.query_reads_read()
                .get("items", "too-long")
                .unwrap()
                .is_none()
        );
    }

    fn relation_schema() -> SchemaManifest {
        use crate::manifest::IndexManifest;
        SchemaManifest {
            tables: vec![
                TableManifest {
                    name: "parents".to_owned(),
                    fields: vec![
                        FieldManifest {
                            name: "owner".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                        FieldManifest {
                            name: "title".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                    ],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                },
                TableManifest {
                    name: "children".to_owned(),
                    fields: vec![
                        FieldManifest {
                            name: "parentId".to_owned(),
                            field_type: FieldType::Id {
                                table: "parents".to_owned(),
                            },
                            optional: false,
                        },
                        FieldManifest {
                            name: "parentIncarnation".to_owned(),
                            field_type: FieldType::RelationIncarnation {
                                foreign_key_field: "parentId".to_owned(),
                                parent_table: "parents".to_owned(),
                            },
                            optional: false,
                        },
                        FieldManifest {
                            name: "position".to_owned(),
                            field_type: FieldType::Integer,
                            optional: false,
                        },
                        FieldManifest {
                            name: "body".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                    ],
                    indexes: vec![IndexManifest {
                        name: "by_parent_position".to_owned(),
                        fields: vec![
                            "parentId".to_owned(),
                            "parentIncarnation".to_owned(),
                            "position".to_owned(),
                        ],
                        unique: false,
                        where_applicable: false,
                    }],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                },
                TableManifest {
                    name: "activity".to_owned(),
                    fields: vec![
                        FieldManifest {
                            name: "parentId".to_owned(),
                            field_type: FieldType::Id {
                                table: "parents".to_owned(),
                            },
                            optional: false,
                        },
                        FieldManifest {
                            name: "parentIncarnation".to_owned(),
                            field_type: FieldType::RelationIncarnation {
                                foreign_key_field: "parentId".to_owned(),
                                parent_table: "parents".to_owned(),
                            },
                            optional: false,
                        },
                        FieldManifest {
                            name: "sourceId".to_owned(),
                            field_type: FieldType::Id {
                                table: "children".to_owned(),
                            },
                            optional: false,
                        },
                        FieldManifest {
                            name: "operation".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                        FieldManifest {
                            name: "actualActor".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                        FieldManifest {
                            name: "actorKind".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                        FieldManifest {
                            name: "mutationDigest".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                    ],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                },
            ],
            ..SchemaManifest::default()
        }
    }

    fn relation_database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory relation database");
        db.schema_seed()
            .apply_schema(relation_schema())
            .expect("apply relation schema");
        db
    }

    fn object(entries: &[(&str, Value)]) -> Map<String, Value> {
        entries
            .iter()
            .map(|(key, value)| ((*key).to_owned(), value.clone()))
            .collect()
    }

    fn generated_sequence_declarations() -> BTreeMap<String, crate::manifest::SequenceDeclaration> {
        BTreeMap::from([(
            "jobs".to_owned(),
            crate::manifest::SequenceDeclaration {
                name: "jobs".to_owned(),
                scope_table: "parents".to_owned(),
                scope_access: crate::manifest::SequenceScopeAccess::ExistingOwner(
                    crate::manifest::SequenceExistingOwnerAccess {
                        kind: "existing-owner.v1".to_owned(),
                        owner_field: "owner".to_owned(),
                    },
                ),
            },
        )])
    }

    fn generated_sequence_database() -> LocalDatabase {
        let mut db = relation_database();
        db.install_sequence_declarations(generated_sequence_declarations(), false)
            .expect("fresh function generation enrolls its empty scope table");
        db
    }

    fn generated_sequence_file_database(path: &Path) -> LocalDatabase {
        let mut db = LocalDatabase::open(path).expect("open shared sequence database");
        db.schema_seed()
            .apply_schema(relation_schema())
            .expect("apply shared relation schema");
        db.install_sequence_declarations(generated_sequence_declarations(), false)
            .expect("install shared sequence declarations");
        db
    }

    fn insert_generated_sequence_scope(db: &mut LocalDatabase, owner: &str, title: &str) {
        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Insert {
                    table: "parents".to_owned(),
                    id: "parent-1".to_owned(),
                    values: object(&[("owner", json!(owner)), ("title", json!(title))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("insert generated sequence scope");
    }

    fn generated_sequence_wwa_plan() -> MutationPlan {
        let scope = ValueExpr::Arg("parentId".to_owned());
        let source_id = ValueExpr::Binding("sourceId".to_owned());
        MutationPlan {
            steps: vec![
                MutationStep::Get {
                    table: "parents".to_owned(),
                    id: scope.clone(),
                    bind_as: "scopeOwner".to_owned(),
                    else_error: Some("SNAPBACK_RELATION_PARENT_UNAVAILABLE".to_owned()),
                },
                MutationStep::Guard {
                    cond: ValueExpr::Binary {
                        op: crate::manifest::BinaryOp::Eq,
                        left: Box::new(ValueExpr::Field {
                            base: Box::new(ValueExpr::Binding("scopeOwner".to_owned())),
                            key: "owner".to_owned(),
                        }),
                        right: Box::new(ValueExpr::AuthUserId),
                    },
                    else_error: "SNAPBACK_RELATION_PARENT_UNAVAILABLE".to_owned(),
                },
                MutationStep::AllocateSequence {
                    counter: "jobs".to_owned(),
                    scope: scope.clone(),
                    into: "position".to_owned(),
                },
                MutationStep::Insert {
                    table: "children".to_owned(),
                    values: BTreeMap::from([
                        ("parentId".to_owned(), scope.clone()),
                        (
                            "position".to_owned(),
                            ValueExpr::Binding("position".to_owned()),
                        ),
                        ("body".to_owned(), ValueExpr::Arg("body".to_owned())),
                    ]),
                    bind_id_as: Some("sourceId".to_owned()),
                },
                MutationStep::AssertSourceChanged {
                    table: "children".to_owned(),
                    id: source_id.clone(),
                    operation: crate::manifest::WriteWithActivitySourceOperation::Insert,
                },
                MutationStep::Insert {
                    table: "activity".to_owned(),
                    values: BTreeMap::from([
                        ("parentId".to_owned(), scope),
                        ("sourceId".to_owned(), source_id),
                        ("operation".to_owned(), ValueExpr::Literal(json!("insert"))),
                        ("actualActor".to_owned(), ValueExpr::AuthActorUserId),
                        ("actorKind".to_owned(), ValueExpr::AuthActivityActorKind),
                        ("mutationDigest".to_owned(), ValueExpr::ClientMutationDigest),
                    ]),
                    bind_id_as: Some("activityId".to_owned()),
                },
            ],
            return_value: Some(ReturnValue::Binding("position".to_owned())),
        }
    }

    fn generated_sequence_input(owner: &str, body: &str) -> HandlerInput {
        HandlerInput {
            args: json!({ "parentId": "parent-1", "body": body }),
            auth: AuthInput {
                user_id: Some(owner.to_owned()),
                ..AuthInput::default()
            }
            .with_activity_provenance(Some(owner), Some("human"), None)
            .with_client_mutation_settlement(None, Some(&format!("sha256:{}", "0".repeat(64)))),
            ..HandlerInput::default()
        }
    }

    fn sequence_next(db: &LocalDatabase, incarnation: &str) -> Option<i64> {
        db.conn
            .query_row(
                "SELECT next_value FROM _snapback_sequence_counters_v1
                  WHERE counter_name = 'jobs' AND scope_table = 'parents'
                    AND scope_row_id = 'parent-1' AND scope_incarnation = ?1",
                params![incarnation],
                |row| row.get(0),
            )
            .optional()
            .expect("sequence counter lookup")
    }

    // @ref LLP 0135#12-allocation-surfaces — the generated WWA plan owns the
    // allocation branch: dry-run rolls it back, app writes and the counter
    // commit together, and an exact client-mutation replay is non-executing.
    #[test]
    fn generated_sequence_host_plan_is_atomic_gapless_and_exactly_replayable() {
        let mut db = generated_sequence_database();
        insert_generated_sequence_scope(&mut db, "user-1", "scope");
        let incarnation = DbRead::Live(&db)
            .active_relation_incarnation("parents", "parent-1")
            .unwrap()
            .expect("active parent incarnation");
        let plan = generated_sequence_wwa_plan();
        let input = generated_sequence_input("user-1", "first");

        let preview = db
            .mutation_writes()
            .dry_run_mutation(&plan, &input)
            .expect("generated WWA dry-run");
        assert_eq!(preview.commit.output.result, json!(1));
        assert_eq!(preview.commit.sequence_allocations[0].value, 1);
        assert_eq!(preview.generated_ids.len(), 2, "source plus activity ids");
        assert_eq!(
            sequence_next(&db, &incarnation),
            None,
            "dry-run burns no value"
        );
        assert_eq!(
            db.query_reads_read()
                .scan_table("children", 10, 0)
                .unwrap()
                .total,
            0
        );
        assert_eq!(
            db.query_reads_read()
                .scan_table("activity", 10, 0)
                .unwrap()
                .total,
            0
        );

        let identity = ClientMutationIdentity::new("cm_generated_sequence", "addJob", &input);
        let fresh = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &input, &identity)
            .expect("fresh generated WWA allocation");
        assert_eq!(fresh.output.result, json!(1));
        assert_eq!(fresh.output.changed_count, 2);
        assert_eq!(fresh.sequence_allocations.len(), 1);
        assert_eq!(fresh.sequence_allocations[0].value, 1);
        assert_eq!(sequence_next(&db, &incarnation), Some(2));

        let replay = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &input, &identity)
            .expect("exact generated WWA replay");
        assert_eq!(replay.output, fresh.output);
        assert_eq!(replay.sequence_allocations, fresh.sequence_allocations);
        assert!(replay.changes.is_empty());
        assert_eq!(sequence_next(&db, &incarnation), Some(2));

        let second = db
            .mutation_writes()
            .execute_mutation(
                &generated_sequence_wwa_plan(),
                &generated_sequence_input("user-1", "second"),
            )
            .expect("next generated WWA allocation");
        assert_eq!(second.output.result, json!(2));
        assert_eq!(sequence_next(&db, &incarnation), Some(3));

        let failing = MutationPlan {
            steps: vec![
                MutationStep::AllocateSequence {
                    counter: "jobs".to_owned(),
                    scope: ValueExpr::Literal(json!("parent-1")),
                    into: "position".to_owned(),
                },
                MutationStep::Insert {
                    table: "children".to_owned(),
                    values: BTreeMap::from([
                        (
                            "parentId".to_owned(),
                            ValueExpr::Literal(json!("missing-parent")),
                        ),
                        (
                            "position".to_owned(),
                            ValueExpr::Binding("position".to_owned()),
                        ),
                        (
                            "body".to_owned(),
                            ValueExpr::Literal(json!("must roll back")),
                        ),
                    ]),
                    bind_id_as: None,
                },
            ],
            return_value: Some(ReturnValue::Binding("position".to_owned())),
        };
        let error = db
            .mutation_writes()
            .execute_mutation(&failing, &HandlerInput::default())
            .expect_err("later app-write refusal rolls the allocation back");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_RELATION_PARENT_UNAVAILABLE"
        );
        assert_eq!(sequence_next(&db, &incarnation), Some(3));
    }

    // @ref LLP 0135#51-sequence-allocation — Relay's generated
    // write-with-activity arm returns source, activity, and allocated value
    // together; all effects share the settlement version and exact replay is
    // non-executing.
    #[test]
    fn relay_move_card_sequence_result_is_atomic_and_byte_exactly_replayable() {
        let mut db = generated_sequence_database();
        insert_generated_sequence_scope(&mut db, "user-1", "board");
        let incarnation = DbRead::Live(&db)
            .active_relation_incarnation("parents", "parent-1")
            .unwrap()
            .expect("active board incarnation");
        let mut plan = generated_sequence_wwa_plan();
        plan.return_value = Some(ReturnValue::Expr(ValueExpr::Record {
            fields: BTreeMap::from([
                (
                    "activityId".to_owned(),
                    ValueExpr::Binding("activityId".to_owned()),
                ),
                (
                    "cardId".to_owned(),
                    ValueExpr::Binding("sourceId".to_owned()),
                ),
                (
                    "sequence".to_owned(),
                    ValueExpr::Binding("position".to_owned()),
                ),
            ]),
        }));
        let input = generated_sequence_input("user-1", "moved card");
        let identity = ClientMutationIdentity::new("cm-relay-move-card", "moveCard", &input);
        let fresh = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &input, &identity)
            .expect("Relay moveCard commits");
        assert_eq!(fresh.output.result["sequence"], 1);
        assert!(fresh.output.result["cardId"].is_string());
        assert!(fresh.output.result["activityId"].is_string());
        assert_eq!(fresh.changes.len(), 2);
        assert!(fresh.changes.iter().all(|change| {
            change
                .row
                .as_ref()
                .is_some_and(|row| row["_version"] == fresh.output.version)
        }));
        assert_eq!(sequence_next(&db, &incarnation), Some(2));
        let encoded_fresh = serde_json::to_vec(&fresh.output).unwrap();

        let replay = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &input, &identity)
            .expect("Relay exact replay");
        assert_eq!(serde_json::to_vec(&replay.output).unwrap(), encoded_fresh);
        assert!(replay.changes.is_empty());
        assert_eq!(replay.sequence_allocations, fresh.sequence_allocations);
        assert_eq!(sequence_next(&db, &incarnation), Some(2));
    }

    // @ref LLP 0135#51-sequence-allocation — exact duplicate settlement is
    // non-executing even when several SQLite writers race the first commit.
    #[test]
    fn sequence_concurrent_duplicate_replay_advances_once_and_returns_exact_bytes() {
        const WRITERS: usize = 8;
        let dir = tempfile::tempdir().expect("sequence duplicate tempdir");
        let path = dir.path().join("sequence-duplicates.sqlite3");
        {
            let mut setup = generated_sequence_file_database(&path);
            insert_generated_sequence_scope(&mut setup, "user-1", "scope");
        }
        let writers = (0..WRITERS)
            .map(|_| generated_sequence_file_database(&path))
            .collect::<Vec<_>>();
        let barrier = Arc::new(Barrier::new(WRITERS + 1));
        let handles = writers
            .into_iter()
            .map(|mut db| {
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    let input = generated_sequence_input("user-1", "same duplicate");
                    let identity = ClientMutationIdentity::new(
                        "cm-sequence-concurrent-duplicate",
                        "addJob",
                        &input,
                    );
                    barrier.wait();
                    db.mutation_writes()
                        .execute_mutation_idempotent(
                            &generated_sequence_wwa_plan(),
                            &input,
                            &identity,
                        )
                        .expect("concurrent duplicate settles or exact-replays")
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        let commits = handles
            .into_iter()
            .map(|handle| handle.join().expect("duplicate writer joins"))
            .collect::<Vec<_>>();

        let canonical =
            serde_json::to_vec(&commits[0].output).expect("canonical retained result bytes");
        assert!(commits.iter().all(|commit| {
            serde_json::to_vec(&commit.output).expect("retained result bytes") == canonical
                && commit.sequence_allocations == commits[0].sequence_allocations
        }));
        assert_eq!(
            commits
                .iter()
                .filter(|commit| !commit.changes.is_empty())
                .count(),
            1,
            "one duplicate executes; every other caller receives retained replay",
        );
        let verify = generated_sequence_file_database(&path);
        let incarnation = DbRead::Live(&verify)
            .active_relation_incarnation("parents", "parent-1")
            .unwrap()
            .expect("active parent");
        assert_eq!(sequence_next(&verify, &incarnation), Some(2));
        assert_eq!(
            verify
                .query_reads_read()
                .scan_table("children", 10, 0)
                .unwrap()
                .total,
            1
        );
        assert_eq!(
            verify
                .query_reads_read()
                .scan_table("activity", 10, 0)
                .unwrap()
                .total,
            1
        );
    }

    // @ref LLP 0135#51-sequence-allocation — the contributor local target's
    // multi-writer proof binds sequence order directly to commit-version order
    // and retains a deliberately loose, repeatable contention budget.
    #[test]
    fn sequence_multi_writer_commit_order_and_performance_qualification() {
        const WRITERS: usize = 24;
        const MAX_ELAPSED_MS: u128 = 15_000;
        let dir = tempfile::tempdir().expect("sequence contention tempdir");
        let path = dir.path().join("sequence-contention.sqlite3");
        {
            let mut setup = generated_sequence_file_database(&path);
            insert_generated_sequence_scope(&mut setup, "user-1", "scope");
        }
        let writers = (0..WRITERS)
            .map(|_| generated_sequence_file_database(&path))
            .collect::<Vec<_>>();
        let barrier = Arc::new(Barrier::new(WRITERS + 1));
        let handles = writers
            .into_iter()
            .enumerate()
            .map(|(index, mut db)| {
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    let input =
                        generated_sequence_input("user-1", &format!("contended writer {index}"));
                    let identity = ClientMutationIdentity::new(
                        format!("cm-sequence-writer-{index}"),
                        "addJob",
                        &input,
                    );
                    barrier.wait();
                    let started = std::time::Instant::now();
                    let commit = db
                        .mutation_writes()
                        .execute_mutation_idempotent(
                            &generated_sequence_wwa_plan(),
                            &input,
                            &identity,
                        )
                        .expect("contended writer commits within SQLite busy budget");
                    (commit, started.elapsed().as_millis())
                })
            })
            .collect::<Vec<_>>();
        let started = std::time::Instant::now();
        barrier.wait();
        let mut observations = handles
            .into_iter()
            .map(|handle| handle.join().expect("contention writer joins"))
            .collect::<Vec<_>>();
        let elapsed_ms = started.elapsed().as_millis();
        observations.sort_by_key(|(commit, _)| commit.output.version);
        let committed_values = observations
            .iter()
            .map(|(commit, _)| commit.sequence_allocations[0].value)
            .collect::<Vec<_>>();
        assert_eq!(
            committed_values,
            (1..=WRITERS as u64).collect::<Vec<_>>(),
            "value order must equal commit-version order",
        );
        assert!(
            observations
                .windows(2)
                .all(|pair| pair[0].0.output.version < pair[1].0.output.version),
            "every contended commit has a unique increasing receipt version",
        );
        assert!(
            elapsed_ms <= MAX_ELAPSED_MS,
            "{WRITERS} writers took {elapsed_ms}ms, above the {MAX_ELAPSED_MS}ms qualification budget",
        );
        let mut latencies = observations
            .iter()
            .map(|(_, latency_ms)| *latency_ms)
            .collect::<Vec<_>>();
        latencies.sort_unstable();
        let p95_ms = latencies[(latencies.len() * 95).div_ceil(100) - 1];
        println!(
            "{}",
            json!({
                "schemaVersion": "snapback.sequence-allocation-contention-observation.v1",
                "targetProfileId": "local-dev-sqlite-ibex",
                "writers": WRITERS,
                "elapsedMs": elapsed_ms,
                "p95Ms": p95_ms,
                "minimumThroughputPerSecond": (WRITERS as f64 * 1000.0) / elapsed_ms.max(1) as f64,
                "commitOrderValues": committed_values,
            })
        );
    }

    #[test]
    fn generated_sequence_scope_refusals_are_byte_identical() {
        let plan = generated_sequence_wwa_plan();
        let input = generated_sequence_input("user-2", "hidden");

        let mut missing_db = generated_sequence_database();
        let missing = missing_db
            .mutation_writes()
            .execute_mutation(&plan, &input)
            .expect_err("missing parent refuses");

        let mut hidden_db = generated_sequence_database();
        insert_generated_sequence_scope(&mut hidden_db, "user-1", "hidden");
        let hidden = hidden_db
            .mutation_writes()
            .execute_mutation(&plan, &input)
            .expect_err("wrong owner refuses");

        assert_eq!(
            serde_json::to_vec(&missing.diagnostic).unwrap(),
            serde_json::to_vec(&hidden.diagnostic).unwrap(),
        );
        for db in [&missing_db, &hidden_db] {
            let counters: i64 = db
                .conn
                .query_row(
                    "SELECT count(*) FROM _snapback_sequence_counters_v1",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(counters, 0);
        }
    }

    #[test]
    fn generated_sequence_exhaustion_and_scope_recreation_are_incarnation_scoped() {
        let mut db = generated_sequence_database();
        insert_generated_sequence_scope(&mut db, "user-1", "first");
        let predecessor = DbRead::Live(&db)
            .active_relation_incarnation("parents", "parent-1")
            .unwrap()
            .expect("predecessor incarnation");
        db.conn
            .execute(
                "INSERT INTO _snapback_sequence_counters_v1(
                   counter_name, scope_table, scope_row_id, scope_incarnation, next_value
                 ) VALUES('jobs', 'parents', 'parent-1', ?1, ?2)",
                params![
                    predecessor,
                    i64::try_from(SEQUENCE_MAX_SAFE_INTEGER - 1).unwrap()
                ],
            )
            .unwrap();
        let allocate = generated_sequence_wwa_plan();
        let penultimate = db
            .mutation_writes()
            .execute_mutation(
                &allocate,
                &generated_sequence_input("user-1", "penultimate"),
            )
            .expect("MAX_SAFE_INTEGER - 1 is allocatable");
        assert_eq!(
            penultimate.output.result,
            json!(SEQUENCE_MAX_SAFE_INTEGER - 1)
        );
        let maximum = db
            .mutation_writes()
            .execute_mutation(&allocate, &generated_sequence_input("user-1", "maximum"))
            .expect("MAX_SAFE_INTEGER is allocatable");
        assert_eq!(maximum.output.result, json!(SEQUENCE_MAX_SAFE_INTEGER));
        assert_eq!(
            sequence_next(&db, &predecessor),
            Some(i64::try_from(SEQUENCE_MAX_SAFE_INTEGER + 1).unwrap()),
        );
        let children_before = db
            .query_reads_read()
            .scan_table("children", 10, 0)
            .unwrap()
            .total;
        let activity_before = db
            .query_reads_read()
            .scan_table("activity", 10, 0)
            .unwrap()
            .total;
        let head_before = db.current_version().unwrap();
        let mut refusal_bytes = Vec::new();
        for attempt in 0..2 {
            let input = generated_sequence_input("user-1", "must not commit");
            let identity = ClientMutationIdentity::new(
                format!("cm-sequence-exhausted-{attempt}"),
                "addJob",
                &input,
            );
            let error = db
                .mutation_writes()
                .execute_mutation_idempotent(&allocate, &input, &identity)
                .expect_err("post-maximum allocation refuses stably");
            assert_eq!(error.diagnostic.code, "SNAPBACK_SEQUENCE_EXHAUSTED");
            refusal_bytes.push(serde_json::to_vec(&error.diagnostic).unwrap());
            assert!(
                db.settlement_read()
                    .client_mutation_result(&identity)
                    .unwrap()
                    .is_none(),
                "an exhausted attempt retains no settlement result bytes",
            );
        }
        assert_eq!(refusal_bytes[0], refusal_bytes[1]);
        assert_eq!(db.current_version().unwrap(), head_before);
        assert_eq!(
            db.query_reads_read()
                .scan_table("children", 10, 0)
                .unwrap()
                .total,
            children_before
        );
        assert_eq!(
            db.query_reads_read()
                .scan_table("activity", 10, 0)
                .unwrap()
                .total,
            activity_before
        );
        assert_eq!(
            sequence_next(&db, &predecessor),
            Some(i64::try_from(SEQUENCE_MAX_SAFE_INTEGER + 1).unwrap()),
        );

        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Delete {
                    table: "parents".to_owned(),
                    id: "parent-1".to_owned(),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("delete predecessor scope");
        insert_generated_sequence_scope(&mut db, "user-1", "successor");
        let successor = DbRead::Live(&db)
            .active_relation_incarnation("parents", "parent-1")
            .unwrap()
            .expect("successor incarnation");
        assert_ne!(successor, predecessor);
        let restarted = db
            .mutation_writes()
            .execute_mutation(&allocate, &generated_sequence_input("user-1", "successor"))
            .expect("successor incarnation restarts at one");
        assert_eq!(restarted.output.result, json!(1));
        let identities: i64 = db
            .conn
            .query_row(
                "SELECT count(*) FROM _snapback_sequence_counters_v1
                  WHERE counter_name = 'jobs' AND scope_table = 'parents'
                    AND scope_row_id = 'parent-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(identities, 2);
    }

    // @ref LLP 0135#11-counter-identity-and-scope — a restarted value is
    // safe only when its client-observable uniqueness key includes the
    // framework-owned relation incarnation; predecessor rows remain physical.
    #[test]
    fn sequence_recreation_keeps_orphaned_rows_and_prefixed_unique_values_distinct() {
        let mut schema = relation_schema();
        schema
            .tables
            .iter_mut()
            .find(|table| table.name == "children")
            .expect("children table")
            .indexes[0]
            .unique = true;
        let mut db = LocalDatabase::memory().expect("incarnation unique database");
        db.schema_seed()
            .apply_schema(schema)
            .expect("apply unique relation schema");
        db.install_sequence_declarations(generated_sequence_declarations(), false)
            .expect("install sequence declarations");
        insert_generated_sequence_scope(&mut db, "user-1", "predecessor");
        let predecessor = db
            .mutation_writes()
            .execute_mutation(
                &generated_sequence_wwa_plan(),
                &generated_sequence_input("user-1", "predecessor child"),
            )
            .expect("predecessor value one");
        assert_eq!(predecessor.sequence_allocations[0].value, 1);
        let predecessor_incarnation = predecessor.sequence_allocations[0]
            .scope_incarnation
            .clone();

        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Delete {
                    table: "parents".to_owned(),
                    id: "parent-1".to_owned(),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("delete predecessor scope");
        insert_generated_sequence_scope(&mut db, "user-1", "successor");
        let successor = db
            .mutation_writes()
            .execute_mutation(
                &generated_sequence_wwa_plan(),
                &generated_sequence_input("user-1", "successor child"),
            )
            .expect("new incarnation admits restarted value one");
        assert_eq!(successor.sequence_allocations[0].value, 1);
        assert_ne!(
            successor.sequence_allocations[0].scope_incarnation,
            predecessor_incarnation,
        );

        let rows = db
            .query_reads_read()
            .scan_table("children", 10, 0)
            .expect("physical children");
        assert_eq!(rows.total, 2, "orphaned predecessor child stays physical");
        let incarnations = rows
            .rows
            .iter()
            .map(|row| row["parentIncarnation"].as_str().unwrap().to_owned())
            .collect::<BTreeSet<_>>();
        assert_eq!(incarnations.len(), 2);
        assert!(rows.rows.iter().all(|row| row["position"] == 1));
    }

    fn item_sequence_declarations() -> BTreeMap<String, crate::manifest::SequenceDeclaration> {
        BTreeMap::from([(
            "positions".to_owned(),
            crate::manifest::SequenceDeclaration {
                name: "positions".to_owned(),
                scope_table: "items".to_owned(),
                scope_access: crate::manifest::SequenceScopeAccess::ExistingOwner(
                    crate::manifest::SequenceExistingOwnerAccess {
                        kind: "existing-owner.v1".to_owned(),
                        owner_field: "title".to_owned(),
                    },
                ),
            },
        )])
    }

    fn raw_function_generation_manifest() -> crate::manifest::FunctionManifest {
        let mut function = crate::manifest::FunctionDefinition::new(
            "allocatePosition",
            crate::manifest::FunctionKind::Mutation,
            crate::manifest::FunctionRuntime::HostPlan(crate::manifest::HandlerPlan::Mutation(
                crate::manifest::MutationPlan {
                    steps: Vec::new(),
                    return_value: None,
                },
            )),
        );
        function.sequences = item_sequence_declarations().into_values().collect();
        crate::manifest::FunctionManifest {
            functions: vec![function],
            ..crate::manifest::FunctionManifest::default()
        }
    }

    fn pending_projection_publication(plan_id: &str) -> PendingProjectionPublication {
        let plan_digest = format!("sha256:{plan_id}");
        PendingProjectionPublication {
            plan_id: plan_id.to_owned(),
            plan_digest: plan_digest.clone(),
            receipt: ProjectionRebuildReceipt {
                operation_id: format!("rebuild_{plan_id}"),
                plan_digest,
                content_digest: format!("seq1:{plan_id}"),
                row_count: 0,
                generation: 1,
                published_version: 0,
                cause: "activation".to_owned(),
                at_ms: 1,
            },
        }
    }

    fn meta_value(db: &LocalDatabase, key: &str) -> Option<String> {
        db.conn
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .expect("read metadata")
    }

    // @ref LLP 0225#1-ownership-map — the persisted raw-dev generation
    //   record, not the process Arc/fence, proves which pins and sequence
    //   enrollments survived every crash cut.
    #[test]
    fn oq3_raw_dev_crash_cuts_use_durable_function_generation_record() {
        let (_before_dir, before_path, before) = file_database();
        drop(before);
        let before_reopen = LocalDatabase::open(&before_path).expect("reopen before composite");
        assert!(
            before_reopen
                .function_generation_record()
                .unwrap()
                .is_none()
        );
        assert!(meta_value(&before_reopen, "projection_plan_digest:raw-before").is_none());
        assert_eq!(
            before_reopen
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_sequence_scope_enrollments_v1",
                    [],
                    |row| row.get::<_, u64>(0),
                )
                .unwrap(),
            0
        );

        let (_after_dir, after_path, mut after) = file_database();
        let manifest = raw_function_generation_manifest();
        let committed = after
            .commit_function_generation(CommitFunctionGeneration {
                manifest: manifest.clone(),
                trusted_active_generation: false,
                projection_publications: vec![pending_projection_publication("raw-after")],
            })
            .expect("commit raw-dev generation before simulated process crash");
        assert_eq!(committed.generation_high_water, 1);
        assert!(
            after.sequence_declarations.is_empty(),
            "the process Arc is not part of the kernel commit"
        );
        drop(after);

        let mut after_reopen =
            LocalDatabase::open(&after_path).expect("reopen after composite commit");
        let reopened_record = after_reopen
            .function_generation_record()
            .expect("read durable generation")
            .expect("generation committed before crash");
        assert_eq!(reopened_record, committed);
        assert_eq!(
            meta_value(&after_reopen, "projection_plan_digest:raw-after").as_deref(),
            Some("sha256:raw-after")
        );
        assert_eq!(
            after_reopen
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_sequence_scope_enrollments_v1",
                    [],
                    |row| row.get::<_, u64>(0),
                )
                .unwrap(),
            1
        );

        let successor = after_reopen
            .commit_function_generation(CommitFunctionGeneration {
                manifest,
                trusted_active_generation: true,
                projection_publications: Vec::new(),
            })
            .expect("post-reopen generation advances durable high-water");
        assert_eq!(successor.generation_high_water, 2);
        assert_eq!(
            successor.function_manifest_digest,
            reopened_record.function_manifest_digest
        );
    }

    #[test]
    fn oq3_failed_function_generation_composite_rolls_back_pins_enrollments_and_record() {
        let mut db = database();
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![object(&[
                        ("_id", json!("bad/id")),
                        ("title", json!("brownfield")),
                    ])],
                )]),
            })
            .expect("seed non-replayable brownfield scope before enrollment");

        let error = db
            .commit_function_generation(CommitFunctionGeneration {
                manifest: raw_function_generation_manifest(),
                trusted_active_generation: true,
                projection_publications: vec![pending_projection_publication("rolled-back")],
            })
            .expect_err("sequence validation failure rolls back the composite");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED"
        );
        assert!(db.function_generation_record().unwrap().is_none());
        assert!(meta_value(&db, "projection_plan_digest:rolled-back").is_none());
        assert!(meta_value(&db, "projection_rebuild_receipt:rolled-back").is_none());
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_sequence_scope_enrollments_v1",
                    [],
                    |row| row.get::<_, u64>(0),
                )
                .unwrap(),
            0,
            "the enrollment written before validation rolled back"
        );
    }

    // Function/schema activation ordering is source-owned: an empty scope can
    // enroll before seed, predecessor relation authority can be reused, but a
    // new successor relation cannot silently bless brownfield sequence rows.
    #[test]
    fn sequence_enrollment_orders_fresh_brownfield_and_relation_activation() {
        let mut fresh = database();
        fresh
            .install_sequence_declarations(item_sequence_declarations(), false)
            .expect("functions-before-seed enrolls an empty scope");
        fresh
            .schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![object(&[
                        ("_id", json!("scope")),
                        ("title", json!("fresh")),
                    ])],
                )]),
            })
            .expect("fresh seed follows enrollment");

        let mut brownfield = database();
        brownfield
            .schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![object(&[("_id", json!("scope")), ("title", json!("old"))])],
                )]),
            })
            .unwrap();
        let error = brownfield
            .install_sequence_declarations(item_sequence_declarations(), false)
            .expect_err("raw seed-before-functions requires reviewed backfill");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED"
        );

        let mut relation_predecessor = relation_database();
        insert_generated_sequence_scope(&mut relation_predecessor, "user-1", "existing");
        relation_predecessor
            .install_sequence_declarations(generated_sequence_declarations(), false)
            .expect("an already-active relation parent is trusted predecessor authority");

        let mut simultaneous = database();
        simultaneous
            .schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![object(&[("_id", json!("scope")), ("title", json!("old"))])],
                )]),
            })
            .unwrap();
        let mut successor_schema = schema();
        successor_schema.tables.push(TableManifest {
            name: "children".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "itemId".to_owned(),
                    field_type: FieldType::Id {
                        table: "items".to_owned(),
                    },
                    optional: false,
                },
                FieldManifest {
                    name: "itemIncarnation".to_owned(),
                    field_type: FieldType::RelationIncarnation {
                        foreign_key_field: "itemId".to_owned(),
                        parent_table: "items".to_owned(),
                    },
                    optional: false,
                },
            ],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        });
        let tx = simultaneous.conn.transaction().unwrap();
        let error = preflight_sequence_enrollments(
            &tx,
            &successor_schema,
            &BTreeSet::new(),
            &BTreeMap::new(),
            &item_sequence_declarations(),
        )
        .expect_err("a simultaneous successor relation is not predecessor authority");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED"
        );
        tx.rollback().unwrap();
    }

    #[test]
    fn sequence_enrollment_restore_retirement_and_re_adoption_fail_closed() {
        let mut db = database();
        db.install_sequence_declarations(item_sequence_declarations(), false)
            .unwrap();
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![object(&[
                        ("_id", json!("scope")),
                        ("title", json!("active")),
                    ])],
                )]),
            })
            .unwrap();

        db.conn
            .execute(
                "DELETE FROM _snapback_sequence_scope_enrollments_v1 WHERE table_name = 'items'",
                [],
            )
            .unwrap();
        let error = match db.detached_read_snapshot() {
            Ok(_) => panic!("detached restore must require the enrollment marker"),
            Err(error) => error,
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED"
        );
        db.conn
            .execute(
                "INSERT INTO _snapback_sequence_scope_enrollments_v1(table_name, enrolled_by)
                 VALUES('items', 'reviewed-test')",
                [],
            )
            .unwrap();
        let incarnation = DbRead::Live(&db)
            .active_relation_incarnation("items", "scope")
            .unwrap()
            .unwrap();
        db.conn
            .execute(
                "INSERT INTO _snapback_sequence_counters_v1(
                   counter_name, scope_table, scope_row_id, scope_incarnation, next_value
                 ) VALUES('orphanedCounter', 'items', 'scope', ?1, 1)",
                params![incarnation],
            )
            .unwrap();
        let error = match db.detached_read_snapshot() {
            Ok(_) => panic!("detached restore must reject orphaned protected counter state"),
            Err(error) => error,
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_SEQUENCE_ACTIVATION_STATE_INVALID"
        );

        let mut retirement = database();
        retirement
            .install_sequence_declarations(item_sequence_declarations(), false)
            .unwrap();
        retirement
            .schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![object(&[
                        ("_id", json!("scope")),
                        ("title", json!("retired")),
                    ])],
                )]),
            })
            .unwrap();
        retirement
            .install_sequence_declarations(BTreeMap::new(), false)
            .expect("retirement with no counter state removes its marker");
        let markers: i64 = retirement
            .conn
            .query_row(
                "SELECT count(*) FROM _snapback_sequence_scope_enrollments_v1
                  WHERE table_name = 'items'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(markers, 0);
        let error = retirement
            .install_sequence_declarations(item_sequence_declarations(), false)
            .expect_err("re-adoption requires fresh reviewed authority");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED"
        );
    }

    #[test]
    fn sequence_exact_active_restart_recovers_marker_but_counter_retarget_refuses() {
        let mut restart = database();
        restart
            .install_sequence_declarations(item_sequence_declarations(), false)
            .unwrap();
        restart
            .schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![object(&[
                        ("_id", json!("scope")),
                        ("title", json!("active")),
                    ])],
                )]),
            })
            .unwrap();
        restart
            .conn
            .execute(
                "DELETE FROM _snapback_sequence_scope_enrollments_v1 WHERE table_name = 'items'",
                [],
            )
            .unwrap();
        let error = restart
            .install_sequence_declarations(item_sequence_declarations(), false)
            .expect_err("untrusted publication cannot recover a missing active marker");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED"
        );
        restart
            .install_sequence_declarations(item_sequence_declarations(), true)
            .expect("the exact active generation may recover its missing marker on restart");

        let allocate = MutationPlan {
            steps: vec![MutationStep::AllocateSequence {
                counter: "positions".to_owned(),
                scope: ValueExpr::Literal(json!("scope")),
                into: "position".to_owned(),
            }],
            return_value: Some(ReturnValue::Binding("position".to_owned())),
        };
        restart
            .mutation_writes()
            .execute_mutation(&allocate, &HandlerInput::default())
            .expect("create protected counter state");

        let removal = restart
            .install_sequence_declarations(BTreeMap::new(), false)
            .expect_err("declaration removal cannot orphan protected counter state");
        assert_eq!(
            removal.diagnostic.code,
            "SNAPBACK_SEQUENCE_ACTIVATION_STATE_INVALID"
        );
        let mut retargeted = item_sequence_declarations();
        let declaration = retargeted.remove("positions").unwrap();
        retargeted.insert(
            "successorPositions".to_owned(),
            crate::manifest::SequenceDeclaration {
                name: "successorPositions".to_owned(),
                ..declaration
            },
        );
        let retarget = restart
            .install_sequence_declarations(retargeted, false)
            .expect_err("counter rename cannot silently adopt predecessor state");
        assert_eq!(
            retarget.diagnostic.code,
            "SNAPBACK_SEQUENCE_ACTIVATION_STATE_INVALID"
        );
    }

    #[test]
    fn sequence_restore_rejects_fabricated_incarnation_but_keeps_historical_identity() {
        let mut db = database();
        db.install_sequence_declarations(item_sequence_declarations(), false)
            .unwrap();
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![object(&[
                        ("_id", json!("scope")),
                        ("title", json!("first")),
                    ])],
                )]),
            })
            .unwrap();
        let legitimate_active = DbRead::Live(&db)
            .active_relation_incarnation("items", "scope")
            .unwrap()
            .unwrap();
        db.conn
            .execute(
                "UPDATE _snapback_relation_incarnations_v1
                    SET incarnation = 'not-a-canonical-v7'
                  WHERE table_name = 'items' AND row_id = 'scope' AND active = 1",
                [],
            )
            .unwrap();
        let malformed_registry = match db.detached_read_snapshot() {
            Ok(_) => panic!("a malformed registered active incarnation must fail closed"),
            Err(error) => error,
        };
        assert_eq!(
            malformed_registry.diagnostic.code,
            "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED"
        );
        assert_eq!(
            malformed_registry.diagnostic.details["incarnationCanonical"],
            json!(false)
        );
        db.conn
            .execute(
                "UPDATE _snapback_relation_incarnations_v1
                    SET incarnation = ?1
                  WHERE table_name = 'items' AND row_id = 'scope' AND active = 1",
                params![legitimate_active],
            )
            .unwrap();

        let fabricated = Uuid::now_v7().to_string();
        db.conn
            .execute(
                "INSERT INTO _snapback_sequence_counters_v1(
                   counter_name, scope_table, scope_row_id, scope_incarnation, next_value
                 ) VALUES('positions', 'items', 'scope', ?1, 1)",
                params![fabricated],
            )
            .unwrap();
        let error = match db.detached_read_snapshot() {
            Ok(_) => panic!("a fabricated scope incarnation must fail closed on restore"),
            Err(error) => error,
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_SEQUENCE_ACTIVATION_STATE_INVALID"
        );
        assert_eq!(error.diagnostic.details["registryBacked"], json!(false));
        db.conn
            .execute(
                "DELETE FROM _snapback_sequence_counters_v1 WHERE scope_incarnation = ?1",
                params![fabricated],
            )
            .unwrap();

        db.conn
            .execute(
                "INSERT INTO _snapback_relation_incarnations_v1(
                   table_name, row_id, incarnation, active
                 ) VALUES('items', 'scope', 'historical-not-a-v7', 0)",
                [],
            )
            .unwrap();
        db.conn
            .execute(
                "INSERT INTO _snapback_sequence_counters_v1(
                   counter_name, scope_table, scope_row_id, scope_incarnation, next_value
                 ) VALUES('positions', 'items', 'scope', 'historical-not-a-v7', 1)",
                [],
            )
            .unwrap();
        let malformed_counter = match db.detached_read_snapshot() {
            Ok(_) => panic!("a registry-backed counter with malformed incarnation must refuse"),
            Err(error) => error,
        };
        assert_eq!(
            malformed_counter.diagnostic.code,
            "SNAPBACK_SEQUENCE_ACTIVATION_STATE_INVALID"
        );
        assert_eq!(
            malformed_counter.diagnostic.details["registryBacked"],
            json!(true)
        );
        assert_eq!(
            malformed_counter.diagnostic.details["incarnationCanonical"],
            json!(false)
        );
        db.conn
            .execute(
                "DELETE FROM _snapback_sequence_counters_v1
                  WHERE scope_incarnation = 'historical-not-a-v7'",
                [],
            )
            .unwrap();
        db.conn
            .execute(
                "DELETE FROM _snapback_relation_incarnations_v1
                  WHERE incarnation = 'historical-not-a-v7'",
                [],
            )
            .unwrap();

        let allocate = MutationPlan {
            steps: vec![MutationStep::AllocateSequence {
                counter: "positions".to_owned(),
                scope: ValueExpr::Literal(json!("scope")),
                into: "position".to_owned(),
            }],
            return_value: Some(ReturnValue::Binding("position".to_owned())),
        };
        db.mutation_writes()
            .execute_mutation(&allocate, &HandlerInput::default())
            .expect("create legitimate predecessor counter");
        let predecessor = DbRead::Live(&db)
            .active_relation_incarnation("items", "scope")
            .unwrap()
            .unwrap();
        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Delete {
                    table: "items".to_owned(),
                    id: "scope".to_owned(),
                }],
                Vec::new(),
                Value::Null,
            )
            .unwrap();
        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "scope".to_owned(),
                    values: object(&[("title", json!("second"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .unwrap();
        let successor = DbRead::Live(&db)
            .active_relation_incarnation("items", "scope")
            .unwrap()
            .unwrap();
        assert_ne!(successor, predecessor);
        let historical_active: i64 = db
            .conn
            .query_row(
                "SELECT active FROM _snapback_relation_incarnations_v1
                  WHERE table_name = 'items' AND row_id = 'scope' AND incarnation = ?1",
                params![predecessor],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(historical_active, 0);
        db.detached_read_snapshot()
            .expect("registry-backed inactive predecessor counter survives restore");
    }

    // @ref LLP 0110#protected-relation-incarnation-and-stamping — the
    // registry has exactly one active incarnation, every central writer
    // stamps from a present active parent, direct writes refuse, and
    // delete/recreate cannot revive an orphan.
    #[test]
    fn relation_incarnation_is_protected_and_delete_recreate_isolated() {
        let mut db = relation_database();
        let parent = db.schema.table("parents").expect("parent table").clone();
        let child = db.schema.table("children").expect("child table").clone();
        {
            let tx = db.conn.transaction().expect("insert transaction");
            insert_document(
                &tx,
                &parent,
                "parent-1",
                &object(&[("owner", json!("user-1")), ("title", json!("first"))]),
                1,
                1_000,
                &BTreeMap::new(),
            )
            .expect("insert parent");
            insert_document(
                &tx,
                &child,
                "child-old",
                &object(&[
                    ("parentId", json!("parent-1")),
                    ("position", json!(1)),
                    ("body", json!("old")),
                ]),
                1,
                1_000,
                &BTreeMap::new(),
            )
            .expect("central writer stamps child");
            tx.commit().expect("commit initial relation");
        }
        let old_incarnation: String = db
            .conn
            .query_row(
                "SELECT parentIncarnation FROM children WHERE _id = 'child-old'",
                [],
                |row| row.get(0),
            )
            .expect("old stamp");

        {
            let tx = db.conn.transaction().expect("protected patch transaction");
            let error = patch_document(
                &tx,
                &child,
                "child-old",
                &object(&[("parentIncarnation", json!("forged"))]),
                2,
                2_000,
                &BTreeMap::new(),
            )
            .expect_err("protected stamp cannot be patched");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_RELATION_INCARNATION_WRITE_PROTECTED"
            );
            let missing_error = patch_document(
                &tx,
                &child,
                "child-missing",
                &object(&[("parentIncarnation", json!("forged"))]),
                2,
                2_000,
                &BTreeMap::new(),
            )
            .expect_err("protected stamp is refused before missing-row lookup");
            assert_eq!(
                missing_error.diagnostic.code,
                "SNAPBACK_RELATION_INCARNATION_WRITE_PROTECTED"
            );
        }
        {
            let tx = db.conn.transaction().expect("delete transaction");
            assert!(delete_document(&tx, &parent, "parent-1").expect("delete parent"));
            tx.commit().expect("commit parent delete");
        }

        for parent_id in ["parent-1", "never-existed"] {
            let tx = db
                .conn
                .transaction()
                .expect("unavailable parent transaction");
            let error = insert_document(
                &tx,
                &child,
                &format!("child-{parent_id}"),
                &object(&[
                    ("parentId", json!(parent_id)),
                    ("position", json!(2)),
                    ("body", json!("refused")),
                ]),
                3,
                3_000,
                &BTreeMap::new(),
            )
            .expect_err("missing and inactive parents both refuse");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_RELATION_PARENT_UNAVAILABLE"
            );
        }

        {
            let tx = db.conn.transaction().expect("recreate transaction");
            insert_document(
                &tx,
                &parent,
                "parent-1",
                &object(&[("owner", json!("user-1")), ("title", json!("second"))]),
                4,
                4_000,
                &BTreeMap::new(),
            )
            .expect("recreate parent");
            insert_document(
                &tx,
                &child,
                "child-new",
                &object(&[
                    ("parentId", json!("parent-1")),
                    ("position", json!(2)),
                    ("body", json!("new")),
                ]),
                4,
                4_000,
                &BTreeMap::new(),
            )
            .expect("stamp child under successor incarnation");
            tx.commit().expect("commit recreated relation");
        }
        let new_incarnation: String = db
            .conn
            .query_row(
                "SELECT parentIncarnation FROM children WHERE _id = 'child-new'",
                [],
                |row| row.get(0),
            )
            .expect("new stamp");
        assert_ne!(old_incarnation, new_incarnation);
        let active: i64 = db
            .conn
            .query_row(
                "SELECT count(*) FROM _snapback_relation_incarnations_v1
                  WHERE table_name = 'parents' AND row_id = 'parent-1' AND active = 1",
                [],
                |row| row.get(0),
            )
            .expect("active registry count");
        assert_eq!(active, 1);
        let visible_old: i64 = db
            .conn
            .query_row(
                "SELECT count(*) FROM children
                  WHERE _id = 'child-old' AND parentIncarnation = ?1",
                params![new_incarnation],
                |row| row.get(0),
            )
            .expect("orphan visibility count");
        assert_eq!(visible_old, 0, "old child is not revived by id reuse");
        db.conn
            .execute("UPDATE _snapback_version SET version = 4 WHERE id = 1", [])
            .expect("align direct test writes with the managed storage head");

        let stale_relation_assertion = || MutationStep::AssertCurrentRelation {
            table: "children".to_owned(),
            id: ValueExpr::Literal(json!("child-old")),
            scope_table: "parents".to_owned(),
            scope_id: ValueExpr::Literal(json!("parent-1")),
            foreign_key_field: "parentId".to_owned(),
            incarnation_field: "parentIncarnation".to_owned(),
            else_error: "SNAPBACK_ROW_NOT_FOUND".to_owned(),
        };
        for terminal in [
            MutationStep::Patch {
                table: "children".to_owned(),
                id: ValueExpr::Literal(json!("child-old")),
                values: BTreeMap::from([(
                    "body".to_owned(),
                    ValueExpr::Literal(json!("must not patch")),
                )]),
            },
            MutationStep::Delete {
                table: "children".to_owned(),
                id: ValueExpr::Literal(json!("child-old")),
            },
        ] {
            let plan = MutationPlan {
                steps: vec![stale_relation_assertion(), terminal],
                return_value: None,
            };
            let error = db
                .mutation_writes()
                .execute_mutation(&plan, &HandlerInput::default())
                .expect_err("stale child cannot be patched or deleted after parent id reuse");
            assert_eq!(error.diagnostic.code, "SNAPBACK_ROW_NOT_FOUND");
        }
        let stale_body: String = db
            .conn
            .query_row(
                "SELECT body FROM children WHERE _id = 'child-old'",
                [],
                |row| row.get(0),
            )
            .expect("stale child remains unchanged");
        assert_eq!(stale_body, "old");
    }

    // @ref LLP 0110#relation-registry-lifecycle — backup/restore carries the
    // registry byte-for-byte, activation validates both directions, and a
    // legacy relation is admitted only after an explicit migration backfill.
    #[test]
    fn relation_restore_backfill_and_central_writer_matrix() {
        let row = |entries: &[(&str, Value)]| {
            entries
                .iter()
                .map(|(key, value)| ((*key).to_owned(), value.clone()))
                .collect::<Map<_, _>>()
        };
        let seed = SeedData {
            tables: BTreeMap::from([
                (
                    "parents".to_owned(),
                    vec![
                        row(&[
                            ("_id", json!("parent-a")),
                            ("owner", json!("user-a")),
                            ("title", json!("A")),
                        ]),
                        row(&[
                            ("_id", json!("parent-b")),
                            ("owner", json!("user-b")),
                            ("title", json!("B")),
                        ]),
                    ],
                ),
                (
                    "children".to_owned(),
                    vec![row(&[
                        ("_id", json!("seed-child")),
                        ("parentId", json!("parent-a")),
                        ("position", json!(1)),
                        ("body", json!("seed")),
                    ])],
                ),
            ]),
        };
        let mut db = relation_database();
        db.schema_seed()
            .seed(seed.clone())
            .expect("seed stamps relation children");
        let seed_stamp: String = db
            .conn
            .query_row(
                "SELECT parentIncarnation FROM children WHERE _id = 'seed-child'",
                [],
                |row| row.get(0),
            )
            .expect("seed stamp");
        let active_stamp = |db: &LocalDatabase, parent: &str| -> String {
            db.conn
                .query_row(
                    "SELECT incarnation
                       FROM _snapback_relation_incarnations_v1
                      WHERE table_name = 'parents' AND row_id = ?1 AND active = 1",
                    params![parent],
                    |row| row.get(0),
                )
                .expect("active relation incarnation")
        };
        assert_eq!(active_stamp(&db, "parent-a"), seed_stamp);

        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Insert {
                    table: "children".to_owned(),
                    id: "buffered-child".to_owned(),
                    values: row(&[
                        ("parentId", json!("parent-a")),
                        ("position", json!(2)),
                        ("body", json!("buffered")),
                    ]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("buffered insert stamps relation");
        let buffered_stamp: String = db
            .conn
            .query_row(
                "SELECT parentIncarnation FROM children WHERE _id = 'buffered-child'",
                [],
                |row| row.get(0),
            )
            .expect("buffered stamp");
        assert_eq!(buffered_stamp, seed_stamp);

        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Patch {
                    table: "children".to_owned(),
                    id: "buffered-child".to_owned(),
                    values: row(&[("parentId", json!("parent-b"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("foreign-key move re-derives relation stamp");
        let moved_stamp: String = db
            .conn
            .query_row(
                "SELECT parentIncarnation FROM children WHERE _id = 'buffered-child'",
                [],
                |row| row.get(0),
            )
            .expect("moved stamp");
        assert_ne!(moved_stamp, seed_stamp);
        assert_eq!(active_stamp(&db, "parent-b"), moved_stamp);

        let error = db
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Patch {
                    table: "children".to_owned(),
                    id: "buffered-child".to_owned(),
                    values: row(&[("parentIncarnation", json!("forged"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect_err("buffered writers cannot author the protected stamp");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_RELATION_INCARNATION_WRITE_PROTECTED"
        );

        let mut restored = db
            .detached_read_snapshot()
            .expect("SQLite backup preserves protected relation state");
        let restored_stamp: String = restored
            .conn
            .query_row(
                "SELECT parentIncarnation FROM children WHERE _id = 'seed-child'",
                [],
                |row| row.get(0),
            )
            .expect("restored stamp");
        assert_eq!(restored_stamp, seed_stamp);
        {
            let schema = restored.schema.clone();
            let tx = restored.conn.transaction().expect("restore validation tx");
            validate_relation_activation(&tx, &schema)
                .expect("uncorrupted restore satisfies both-direction relation validation");
            tx.rollback().unwrap();
        }

        restored
            .conn
            .execute(
                "DELETE FROM _snapback_relation_incarnations_v1
                  WHERE table_name = 'parents' AND row_id = 'parent-a'",
                [],
            )
            .expect("model legacy restore without protected registry");
        {
            let schema = restored.schema.clone();
            let tx = restored.conn.transaction().expect("legacy validation tx");
            let error = validate_relation_activation(&tx, &schema)
                .expect_err("activation never silently blesses a legacy relation");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED"
            );
            assert_eq!(error.diagnostic.details["direction"], "parent-to-registry");
            tx.rollback().unwrap();
        }

        // This direct SQL is intentionally migration-privileged: the normal
        // writer boundary above proves application code cannot perform it.
        let replacement = Uuid::now_v7().to_string();
        restored
            .conn
            .execute(
                "INSERT INTO _snapback_relation_incarnations_v1(
                   table_name, row_id, incarnation, active
                 ) VALUES('parents', 'parent-a', ?1, 1)",
                params![replacement],
            )
            .expect("explicit registry backfill");
        restored
            .conn
            .execute(
                "UPDATE children
                    SET parentIncarnation = ?1
                  WHERE parentId = 'parent-a'",
                params![replacement],
            )
            .expect("explicit child-stamp backfill");
        {
            let schema = restored.schema.clone();
            let tx = restored.conn.transaction().expect("backfill validation tx");
            validate_relation_activation(&tx, &schema)
                .expect("reviewed registry plus child backfill activates");
            tx.rollback().unwrap();
        }

        restored
            .conn
            .execute(
                "INSERT INTO _snapback_relation_incarnations_v1(
                   table_name, row_id, incarnation, active
                 ) VALUES('parents', 'missing-parent', ?1, 1)",
                params![Uuid::now_v7().to_string()],
            )
            .expect("model dangling active registry row");
        {
            let schema = restored.schema.clone();
            let tx = restored.conn.transaction().expect("dangling validation tx");
            let error = validate_relation_activation(&tx, &schema)
                .expect_err("restore refuses an active incarnation without a parent");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED"
            );
            assert_eq!(error.diagnostic.details["direction"], "registry-to-parent");
            tx.rollback().unwrap();
        }

        db.schema_seed()
            .reset_and_seed(Some(seed))
            .expect("reset seed recreates and restamps the relation cut");
        let reset_stamp: String = db
            .conn
            .query_row(
                "SELECT parentIncarnation FROM children WHERE _id = 'seed-child'",
                [],
                |row| row.get(0),
            )
            .expect("reset stamp");
        assert_ne!(
            reset_stamp, seed_stamp,
            "reset mints a successor parent incarnation"
        );
    }

    // @ref LLP 0110#total-effect-formulas — source-effect assertion and the
    // activity append share one transaction; exact replay commits once, and
    // no-op/wrong-operation paths roll back before activity or settlement.
    #[test]
    fn write_with_activity_source_assertion_is_atomic_and_replay_safe() {
        let mut db = relation_database();
        {
            let tx = db.conn.transaction().expect("parent transaction");
            let parent = db.schema.table("parents").expect("parent").clone();
            insert_document(
                &tx,
                &parent,
                "parent-1",
                &object(&[("owner", json!("user-1")), ("title", json!("incident"))]),
                1,
                1_000,
                &BTreeMap::new(),
            )
            .expect("insert scope");
            tx.commit().expect("commit scope");
        }

        let source_id = ValueExpr::Binding("sourceId".to_owned());
        let plan = MutationPlan {
            steps: vec![
                MutationStep::Insert {
                    table: "children".to_owned(),
                    values: BTreeMap::from([
                        ("parentId".to_owned(), ValueExpr::Literal(json!("parent-1"))),
                        ("position".to_owned(), ValueExpr::Literal(json!(1))),
                        ("body".to_owned(), ValueExpr::Literal(json!("triage"))),
                    ]),
                    bind_id_as: Some("sourceId".to_owned()),
                },
                MutationStep::AssertSourceChanged {
                    table: "children".to_owned(),
                    id: source_id.clone(),
                    operation: crate::manifest::WriteWithActivitySourceOperation::Insert,
                },
                MutationStep::Insert {
                    table: "activity".to_owned(),
                    values: BTreeMap::from([
                        ("parentId".to_owned(), ValueExpr::Literal(json!("parent-1"))),
                        ("sourceId".to_owned(), source_id.clone()),
                        ("operation".to_owned(), ValueExpr::Literal(json!("insert"))),
                        ("actualActor".to_owned(), ValueExpr::AuthActorUserId),
                        ("actorKind".to_owned(), ValueExpr::AuthActivityActorKind),
                        ("mutationDigest".to_owned(), ValueExpr::ClientMutationDigest),
                    ]),
                    bind_id_as: Some("activityId".to_owned()),
                },
            ],
            return_value: Some(ReturnValue::Expr(ValueExpr::Record {
                fields: BTreeMap::from([
                    (
                        "activityId".to_owned(),
                        ValueExpr::Binding("activityId".to_owned()),
                    ),
                    ("sourceId".to_owned(), source_id),
                ]),
            })),
        };
        let mut input = HandlerInput {
            auth: AuthInput {
                user_id: Some("user-1".to_owned()),
                ..AuthInput::default()
            }
            .with_activity_provenance(Some("user-1"), Some("human"), None),
            ..HandlerInput::default()
        };
        let identity = ClientMutationIdentity::new("cm_activity_exact", "addTask", &input);
        let digest = identity.activity_digest();
        input.auth = input
            .auth
            .with_client_mutation_settlement(Some(identity.id.as_str()), Some(digest.as_str()));
        let first = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &input, &identity)
            .expect("first activity commit");
        let replay = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &input, &identity)
            .expect("exact replay");
        assert_eq!(first.output, replay.output);
        let source_id = first.output.result["sourceId"].as_str().expect("source id");
        let activity_id = first.output.result["activityId"]
            .as_str()
            .expect("activity id");
        let (source_version, activity_version, stored_digest): (i64, i64, String) = db
            .conn
            .query_row(
                "SELECT c._version, a._version, a.mutationDigest
                   FROM children c JOIN activity a ON a.sourceId = c._id
                  WHERE c._id = ?1 AND a._id = ?2",
                params![source_id, activity_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("source/activity versions");
        assert_eq!(source_version, activity_version);
        assert_eq!(stored_digest, digest);
        let counts: (i64, i64) = db
            .conn
            .query_row(
                "SELECT
                   (SELECT count(*) FROM children),
                   (SELECT count(*) FROM activity)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("row counts");
        assert_eq!(counts, (1, 1), "replay appends no duplicate activity");

        let no_op = MutationPlan {
            steps: vec![
                MutationStep::Patch {
                    table: "children".to_owned(),
                    id: ValueExpr::Literal(json!(source_id)),
                    values: BTreeMap::from([(
                        "body".to_owned(),
                        ValueExpr::Literal(json!("triage")),
                    )]),
                },
                MutationStep::AssertSourceChanged {
                    table: "children".to_owned(),
                    id: ValueExpr::Literal(json!(source_id)),
                    operation: crate::manifest::WriteWithActivitySourceOperation::Patch,
                },
                MutationStep::Insert {
                    table: "activity".to_owned(),
                    values: BTreeMap::new(),
                    bind_id_as: None,
                },
            ],
            return_value: None,
        };
        let no_op_identity = ClientMutationIdentity::new("cm_activity_noop", "patchTask", &input);
        let error = db
            .mutation_writes()
            .execute_mutation_idempotent(&no_op, &input, &no_op_identity)
            .expect_err("storage-identical patch is not an activity source effect");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ACTIVITY_SOURCE_EFFECT_REQUIRED"
        );
        let after: (i64, i64) = db
            .conn
            .query_row(
                "SELECT
                   (SELECT count(*) FROM children),
                   (SELECT count(*) FROM activity)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("counts after refusal");
        assert_eq!(after, counts);
        assert!(
            db.settlement_read()
                .client_mutation_result(&no_op_identity)
                .expect("settlement lookup")
                .is_none(),
            "refusal retains no settlement"
        );
    }

    // @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation
    // — argOpt lowers to null-propagating Field access over the Args root.
    #[test]
    fn omitted_optional_arg_field_access_writes_null_to_optional_storage() {
        let mut db = database();
        let input = HandlerInput {
            args: json!({}),
            ..HandlerInput::default()
        };
        let plan = MutationPlan {
            steps: vec![MutationStep::Insert {
                table: "items".to_owned(),
                values: BTreeMap::from([
                    (
                        "title".to_owned(),
                        ValueExpr::Literal(json!("omitted optional arg")),
                    ),
                    (
                        "rank".to_owned(),
                        ValueExpr::Field {
                            base: Box::new(ValueExpr::Args),
                            key: "rank".to_owned(),
                        },
                    ),
                ]),
                bind_id_as: None,
            }],
            return_value: Some(ReturnValue::ChangedCount),
        };
        let identity = ClientMutationIdentity::new(
            "cm_optional_arg_omitted",
            "createItemWithOptionalRank",
            &input,
        );

        let committed = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &input, &identity)
            .expect("argOpt-shaped omitted property commits without SNAPBACK_ARG_MISSING");
        assert_eq!(committed.output.changed_count, 1);
        let row_id = &committed.changes.first().expect("inserted changed row").id;
        let row = db
            .query_reads_read()
            .get("items", row_id)
            .expect("read committed item")
            .expect("committed item exists");
        assert_eq!(row["rank"], Value::Null);
        assert!(
            row.as_object()
                .expect("stored row object")
                .contains_key("rank")
        );
    }

    fn activity_insert_plan(return_value: ReturnValue) -> MutationPlan {
        let source_id = ValueExpr::Binding("sourceId".to_owned());
        MutationPlan {
            steps: vec![
                MutationStep::Insert {
                    table: "children".to_owned(),
                    values: BTreeMap::from([
                        ("parentId".to_owned(), ValueExpr::Literal(json!("parent-1"))),
                        ("position".to_owned(), ValueExpr::RuntimeNow),
                        ("body".to_owned(), ValueExpr::Literal(json!("publication"))),
                    ]),
                    bind_id_as: Some("sourceId".to_owned()),
                },
                MutationStep::AssertSourceChanged {
                    table: "children".to_owned(),
                    id: source_id.clone(),
                    operation: crate::manifest::WriteWithActivitySourceOperation::Insert,
                },
                MutationStep::Insert {
                    table: "activity".to_owned(),
                    values: BTreeMap::from([
                        ("parentId".to_owned(), ValueExpr::Literal(json!("parent-1"))),
                        ("sourceId".to_owned(), source_id),
                        ("operation".to_owned(), ValueExpr::Literal(json!("insert"))),
                        ("actualActor".to_owned(), ValueExpr::AuthActorUserId),
                        ("actorKind".to_owned(), ValueExpr::AuthActivityActorKind),
                        ("mutationDigest".to_owned(), ValueExpr::ClientMutationDigest),
                    ]),
                    bind_id_as: Some("activityId".to_owned()),
                },
            ],
            return_value: Some(return_value),
        }
    }

    fn activity_input(result: Value) -> HandlerInput {
        HandlerInput {
            args: json!({ "result": result }),
            auth: AuthInput {
                user_id: Some("user-1".to_owned()),
                ..AuthInput::default()
            }
            .with_activity_provenance(Some("user-1"), Some("human"), None)
            .with_client_mutation_settlement(None, Some(&format!("sha256:{}", "0".repeat(64)))),
            ..HandlerInput::default()
        }
    }

    fn seed_activity_scope(db: &mut LocalDatabase) {
        let tx = db.conn.transaction().expect("activity scope tx");
        let parent = db.schema.table("parents").expect("parent").clone();
        insert_document(
            &tx,
            &parent,
            "parent-1",
            &object(&[("owner", json!("user-1")), ("title", json!("incident"))]),
            1,
            1_000,
            &BTreeMap::new(),
        )
        .expect("insert activity scope");
        set_version(&tx, 1).expect("publish activity scope version");
        tx.commit().expect("commit activity scope");
    }

    fn activity_counts(db: &LocalDatabase) -> (i64, i64) {
        db.conn
            .query_row(
                "SELECT
                   (SELECT count(*) FROM children),
                   (SELECT count(*) FROM activity)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("activity publication row counts")
    }

    fn input_with_identity_digest(
        id: &str,
        function: &str,
        result: Value,
    ) -> (HandlerInput, ClientMutationIdentity) {
        let mut input = activity_input(result);
        let identity = ClientMutationIdentity::new(id, function, &input);
        input.auth = input.auth.with_client_mutation_settlement(
            Some(identity.id.as_str()),
            Some(&identity.activity_digest()),
        );
        (input, identity)
    }

    // @ref LLP 0110#result-and-settlement-dependency — the retained result
    // boundary is exactly 65,536/65,537 serialized bytes; ACK and recovery
    // purge remove only settlement evidence, never ordinary activity data,
    // and a retry after either reclamation demonstrably executes again.
    #[test]
    fn write_with_activity_exact_retention_boundary_ack_purge_and_replay_loss() {
        let mut db = relation_database();
        seed_activity_scope(&mut db);
        let plan = activity_insert_plan(ReturnValue::Expr(ValueExpr::Arg("result".to_owned())));

        let base = db
            .mutation_writes()
            .dry_run_mutation(&plan, &activity_input(json!("")))
            .expect("measure retained output envelope")
            .commit
            .output;
        let base_bytes = serde_json::to_string(&base).unwrap().len();
        assert!(
            base_bytes < CLIENT_MUTATION_MAX_RESULT_BYTES as usize,
            "fixture envelope leaves room for exact-boundary payload"
        );
        let padding = CLIENT_MUTATION_MAX_RESULT_BYTES as usize - base_bytes;
        let (exact_input, exact_identity) =
            input_with_identity_digest("cm_activity_65536", "addTask", json!("x".repeat(padding)));
        let exact = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &exact_input, &exact_identity)
            .expect("65,536-byte retained result commits");
        assert_eq!(
            serde_json::to_string(&exact.output).unwrap().len(),
            CLIENT_MUTATION_MAX_RESULT_BYTES as usize
        );
        assert_eq!(activity_counts(&db), (1, 1));
        let replay = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &exact_input, &exact_identity)
            .expect("exact replay returns retained bytes");
        assert_eq!(replay.output, exact.output);
        assert_eq!(activity_counts(&db), (1, 1));

        assert_eq!(
            db.settlement()
                .acknowledge_client_mutations(
                    &exact_identity.auth_fingerprint,
                    std::slice::from_ref(&exact_identity.id),
                )
                .unwrap(),
            1
        );
        assert_eq!(activity_counts(&db), (1, 1), "ACK reclaims no product data");
        assert!(
            db.settlement_read()
                .client_mutation_result(&exact_identity)
                .unwrap()
                .is_none()
        );
        let after_ack = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &exact_input, &exact_identity)
            .expect("retry after ACK executes because replay evidence is gone");
        assert_ne!(after_ack.output, exact.output);
        assert_eq!(activity_counts(&db), (2, 2));

        let before_oversize = (
            db.current_version().unwrap(),
            activity_counts(&db),
            db.settlement_read()
                .client_mutation_retention_info()
                .unwrap(),
        );
        let measured = db
            .mutation_writes()
            .dry_run_mutation(&plan, &activity_input(json!("")))
            .expect("measure successor output envelope")
            .commit
            .output;
        let successor_base = serde_json::to_string(&measured).unwrap().len();
        let oversized_padding = CLIENT_MUTATION_MAX_RESULT_BYTES as usize + 1 - successor_base;
        let (oversized_input, oversized_identity) = input_with_identity_digest(
            "cm_activity_65537",
            "addTask",
            json!("x".repeat(oversized_padding)),
        );
        let error = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &oversized_input, &oversized_identity)
            .expect_err("65,537-byte retained result rolls back the whole profile");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_RESULT_TOO_LARGE"
        );
        assert_eq!(error.diagnostic.details["bytes"], 65_537);
        assert_eq!(db.current_version().unwrap(), before_oversize.0);
        assert_eq!(activity_counts(&db), before_oversize.1);
        assert_eq!(
            db.settlement_read()
                .client_mutation_retention_info()
                .unwrap(),
            before_oversize.2
        );
        assert!(
            db.settlement_read()
                .client_mutation_result(&oversized_identity)
                .unwrap()
                .is_none()
        );

        let (purge_input, purge_identity) =
            input_with_identity_digest("cm_activity_purge", "addTask", json!("small"));
        db.mutation_writes()
            .execute_mutation_idempotent(&plan, &purge_input, &purge_identity)
            .expect("settlement to purge");
        let before_purge = activity_counts(&db);
        assert!(
            db.settlement()
                .purge_client_mutation_settlements(Some(&purge_identity.auth_fingerprint))
                .unwrap()
                >= 1
        );
        assert_eq!(
            activity_counts(&db),
            before_purge,
            "administrative settlement purge preserves activity"
        );
        assert!(
            db.settlement_read()
                .client_mutation_result(&purge_identity)
                .unwrap()
                .is_none()
        );
        db.mutation_writes()
            .execute_mutation_idempotent(&plan, &purge_input, &purge_identity)
            .expect("retry after purge executes again by documented contract");
        assert_eq!(
            activity_counts(&db),
            (before_purge.0 + 1, before_purge.1 + 1)
        );
    }

    // @ref LLP 0110#82-write-plus-activity — every observable failure cut
    // executes inside the same SQLite transaction and leaves the scope cut,
    // source/activity rows, version, and successful settlement unchanged.
    #[test]
    fn write_with_activity_fault_cuts_leave_no_residue() {
        let clean = || {
            let mut db = relation_database();
            seed_activity_scope(&mut db);
            db
        };
        let plan = activity_insert_plan(ReturnValue::Expr(ValueExpr::Literal(json!({
            "ok": true
        }))));

        // Lifecycle checkpoints: before source, after source/before assertion,
        // before activity, after activity/result, and immediately before
        // settlement+COMMIT.
        for (label, fail_at) in [
            ("before-primary", 2_usize),
            ("between-primary-and-assertion", 3),
            ("before-activity", 4),
            ("after-activity", 5),
            ("before-commit", 6),
        ] {
            let mut db = clean();
            let (input, identity) =
                input_with_identity_digest(&format!("cm_fault_{fail_at}"), "addTask", Value::Null);
            let checks = Cell::new(0_usize);
            let error = match db.execute_mutation_plan_with_lifecycle(
                &plan,
                &input,
                true,
                Some(&identity),
                &|| {
                    checks.set(checks.get() + 1);
                    if checks.get() == fail_at {
                        Err(SnapbackError::error(
                            "SNAPBACK_TEST_ACTIVITY_FAULT",
                            "mutation",
                            label,
                        ))
                    } else {
                        Ok(())
                    }
                },
                || Ok(()),
            ) {
                Ok(_) => panic!("{label} unexpectedly committed"),
                Err(error) => error,
            };
            assert_eq!(error.diagnostic.code, "SNAPBACK_TEST_ACTIVITY_FAULT");
            assert_eq!(db.current_version().unwrap(), 1, "{label}");
            assert_eq!(activity_counts(&db), (0, 0), "{label}");
            assert!(
                db.settlement_read()
                    .client_mutation_result(&identity)
                    .unwrap()
                    .is_none(),
                "{label}"
            );
        }

        let mut invalid_activity = plan.clone();
        let Some(MutationStep::Insert { values, .. }) = invalid_activity.steps.last_mut() else {
            panic!("activity append");
        };
        values.insert("actorKind".to_owned(), ValueExpr::Literal(json!(7)));
        let mut db = clean();
        let (input, identity) =
            input_with_identity_digest("cm_fault_activity_validation", "addTask", Value::Null);
        let error = db
            .mutation_writes()
            .execute_mutation_idempotent(&invalid_activity, &input, &identity)
            .expect_err("activity schema validation failure rolls back source");
        assert_eq!(error.diagnostic.code, "SNAPBACK_FIELD_TYPE_MISMATCH");
        assert_eq!(activity_counts(&db), (0, 0));
        assert_eq!(db.current_version().unwrap(), 1);
        assert!(
            db.settlement_read()
                .client_mutation_result(&identity)
                .unwrap()
                .is_none()
        );

        let mut invalid_result = plan;
        invalid_result.return_value = Some(ReturnValue::Expr(ValueExpr::Arg(
            "missingResult".to_owned(),
        )));
        let mut db = clean();
        let (input, identity) =
            input_with_identity_digest("cm_fault_result_validation", "addTask", Value::Null);
        let error = db
            .mutation_writes()
            .execute_mutation_idempotent(&invalid_result, &input, &identity)
            .expect_err("result construction failure rolls back activity");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ARG_MISSING");
        assert_eq!(activity_counts(&db), (0, 0));
        assert_eq!(db.current_version().unwrap(), 1);
        assert!(
            db.settlement_read()
                .client_mutation_result(&identity)
                .unwrap()
                .is_none()
        );
    }

    // @ref LLP 0081#6-compatibility-and-deployment-ordering — barrier-time
    //   retained-work proof: the local profile proves exactly the `empty`
    //   posture by counting the durable server-resident work stores; a
    //   non-empty store fails closed under either admitted posture because
    //   no owning subsystem models dual-compatible payload validators yet.
    #[test]
    fn retained_work_posture_is_proven_not_assumed() {
        use crate::migration::RetainedWorkPosture;
        let mut db = database();
        {
            let tx = db
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("tx");
            prove_retained_work_posture(&tx, RetainedWorkPosture::Empty)
                .expect("an empty target proves the empty posture");
            prove_retained_work_posture(&tx, RetainedWorkPosture::DualCompatible)
                .expect("an empty target trivially satisfies dual-compatible");
        }
        // Retain one client-mutation record, then both postures fail closed.
        let identity = ClientMutationIdentity {
            id: "m-1".to_owned(),
            function: "createTodo".to_owned(),
            auth_fingerprint: "sha256:test".to_owned(),
            authority_instance_id: Uuid::now_v7().to_string(),
            input_fingerprint: "sha256:input".to_owned(),
            artifact_generation_digest: None,
            operation_issuance: None,
        };
        db.mutation_writes()
            .execute_mutation_idempotent(
                &MutationPlan {
                    steps: vec![MutationStep::Insert {
                        table: "items".to_owned(),
                        values: BTreeMap::from([(
                            "title".to_owned(),
                            ValueExpr::Literal(json!("retained")),
                        )]),
                        bind_id_as: None,
                    }],
                    return_value: None,
                },
                &HandlerInput::default(),
                &identity,
            )
            .expect("retained mutation");
        let tx = db
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .expect("tx");
        for posture in [
            RetainedWorkPosture::Empty,
            RetainedWorkPosture::DualCompatible,
        ] {
            let error = prove_retained_work_posture(&tx, posture)
                .expect_err("retained work must fail closed");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_MIGRATION_RETAINED_WORK_INCOMPATIBLE"
            );
        }
    }

    // @ref LLP 0081#4-execution-journaling-and-crash-recovery — the
    //   same-landing LLP 0007 amendment: schema-resync/rollback-resync are
    //   first-class typed journal operations. They count toward the journal
    //   high-water exactly like a data operation (the event alone IS the
    //   head here), head/journal-cut equality holds across them (pruning's
    //   whole-journal validation passes), and the vocabulary is closed —
    //   an unknown operation under the pseudo-table is corruption.
    #[test]
    fn schema_transition_events_are_first_class_and_closed() {
        let mut db = database();
        let body = SchemaTransitionEventBodyV1 {
            operation_id: "operation-v1:test".to_owned(),
            plan_id: "migration-v1:abc".to_owned(),
            predecessor_schema_hash: "p".repeat(64),
            successor_schema_hash: "s".repeat(64),
            predecessor_generation: 1,
            successor_generation: 2,
            retention_floor: 1,
            compatibility_posture: crate::migration::CompatibilityPosture::SuccessorOnly,
        };
        {
            let tx = db
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("tx");
            record_schema_transition_event(
                &tx,
                1,
                SchemaTransitionKind::SchemaResync,
                &body,
                1_000,
            )
            .expect("record event");
            set_version(&tx, 1).expect("set version");
            save_retention_floor_on(&tx, 1).expect("raise floor");
            tx.commit().expect("commit");
        }

        // Typed round-trip.
        let events = db.schema_transition_events(0).expect("read events");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, SchemaTransitionKind::SchemaResync);
        assert_eq!(events[0].version, 1);
        assert_eq!(events[0].body, body);
        assert_eq!(
            db.latest_schema_transition()
                .expect("latest")
                .expect("some")
                .body,
            body
        );

        // High-water/head-cut equality holds across the event: pruning's
        // whole-journal validation (head vs journal MAX) accepts it.
        db.prune_change_journal(2_000, 10, 10)
            .expect("prune validates");
        assert_eq!(db.journal_floor_version().expect("floor"), 1);

        // Constructor invariants: floor mismatch and a non-advancing
        // generation are refused before any row is written.
        {
            let tx = db
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("tx");
            let error = record_schema_transition_event(
                &tx,
                7,
                SchemaTransitionKind::SchemaResync,
                &body,
                1_000,
            )
            .expect_err("floor mismatch refuses");
            assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");
            let mut regressed = body.clone();
            regressed.retention_floor = 7;
            regressed.successor_generation = 1;
            let error = record_schema_transition_event(
                &tx,
                7,
                SchemaTransitionKind::SchemaResync,
                &regressed,
                1_000,
            )
            .expect_err("non-advancing generation refuses");
            assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");
        }

        // Closed vocabulary: a row under the pseudo-table with an unknown
        // operation is corruption, never an ignorable dialect.
        db.conn
            .execute(
                "INSERT INTO _snapback_changes(version, table_name, row_id, op, row_json, \
                 changed_at_ms) VALUES(1, ?1, 'x', 'mystery-op', '{}', 1000)",
                params![SCHEMA_TRANSITION_JOURNAL_TABLE],
            )
            .expect("inject unknown op");
        let error = db
            .schema_transition_events(0)
            .expect_err("unknown operation must refuse");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");
    }

    #[test]
    fn ordinary_unique_index_is_total_and_reports_a_stable_conflict() {
        let mut unique_schema = schema();
        unique_schema.tables[0].indexes = vec![crate::manifest::IndexManifest {
            name: "by_title".to_owned(),
            fields: vec!["title".to_owned()],
            unique: true,
            where_applicable: false,
        }];
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(unique_schema)
            .expect("apply unique index");

        let insert = |id: &str| BufferedWrite::Insert {
            table: "items".to_owned(),
            id: id.to_owned(),
            values: Map::from_iter([("title".to_owned(), json!("same"))]),
        };
        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![insert("first")],
                Vec::new(),
                Value::Null,
            )
            .expect("first unique insert");
        let error = db
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![insert("second")],
                Vec::new(),
                Value::Null,
            )
            .expect_err("duplicate unique key must lose at commit");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION"
        );
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .unwrap()
                .total,
            1
        );
    }

    #[test]
    fn optional_unique_index_requires_the_manifest_where_applicable_flag() {
        let mut unsafe_schema = schema();
        unsafe_schema.tables[0].indexes = vec![crate::manifest::IndexManifest {
            name: "by_rank".to_owned(),
            fields: vec!["rank".to_owned()],
            unique: true,
            where_applicable: false,
        }];
        let mut db = LocalDatabase::memory().expect("memory database");
        let error = db
            .schema_seed()
            .apply_schema(unsafe_schema)
            .expect_err("optional unique key needs an explicit carrier fact");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_SCHEMA_INDEX_WHERE_APPLICABLE_MISMATCH"
        );
    }

    #[test]
    fn unique_where_present_allows_absent_rows_and_refuses_present_duplicates() {
        let mut where_present_schema = schema();
        where_present_schema.tables[0].indexes = vec![crate::manifest::IndexManifest {
            name: "by_rank".to_owned(),
            fields: vec!["rank".to_owned()],
            unique: true,
            where_applicable: true,
        }];
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(where_present_schema)
            .expect("optional unique key activates");

        let insert = |id: &str, title: &str, rank: Option<i64>| {
            let mut values = Map::from_iter([("title".to_owned(), json!(title))]);
            if let Some(rank) = rank {
                values.insert("rank".to_owned(), json!(rank));
            }
            BufferedWrite::Insert {
                table: "items".to_owned(),
                id: id.to_owned(),
                values,
            }
        };
        for write in [
            insert("absent-1", "first absent", None),
            insert("absent-2", "second absent", None),
            insert("present-1", "first present", Some(7)),
        ] {
            db.mutation_writes()
                .commit_buffered_writes(
                    &HandlerInput::default(),
                    vec![write],
                    Vec::new(),
                    Value::Null,
                )
                .expect("participating and exempt rows insert");
        }
        let error = db
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![insert("present-2", "duplicate present", Some(7))],
                Vec::new(),
                Value::Null,
            )
            .expect_err("a duplicate present key must refuse");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION"
        );
        assert_eq!(db.scan_table("items", 10, 0).unwrap().total, 3);
    }

    #[test]
    fn compound_unique_where_present_uses_the_all_present_rule() {
        let mut where_present_schema = schema();
        where_present_schema.tables[0].indexes = vec![crate::manifest::IndexManifest {
            name: "by_title_rank".to_owned(),
            fields: vec!["title".to_owned(), "rank".to_owned()],
            unique: true,
            where_applicable: true,
        }];
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(where_present_schema)
            .expect("compound where-present index activates");

        let index_sql: String = db
            .conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'items_by_title_rank'",
                [],
                |row| row.get(0),
            )
            .expect("partial index SQL");
        assert!(index_sql.contains("WHERE \"title\" IS NOT NULL AND \"rank\" IS NOT NULL"));

        let insert = |id: &str, rank: Option<i64>| {
            let mut values = Map::from_iter([("title".to_owned(), json!("same"))]);
            if let Some(rank) = rank {
                values.insert("rank".to_owned(), json!(rank));
            }
            BufferedWrite::Insert {
                table: "items".to_owned(),
                id: id.to_owned(),
                values,
            }
        };
        for write in [
            insert("exempt-1", None),
            insert("exempt-2", None),
            insert("participating-1", Some(9)),
        ] {
            db.mutation_writes()
                .commit_buffered_writes(
                    &HandlerInput::default(),
                    vec![write],
                    Vec::new(),
                    Value::Null,
                )
                .expect("all-present participation is enforced");
        }
        let error = db
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![insert("participating-2", Some(9))],
                Vec::new(),
                Value::Null,
            )
            .expect_err("both-present duplicate must refuse");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION"
        );
    }

    #[test]
    fn unique_where_present_activation_refuses_participating_brownfield_duplicates() {
        let mut db = database();
        let insert = |id: &str, title: &str| BufferedWrite::Insert {
            table: "items".to_owned(),
            id: id.to_owned(),
            values: Map::from_iter([
                ("title".to_owned(), json!(title)),
                ("rank".to_owned(), json!(4)),
            ]),
        };
        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![insert("first", "first"), insert("second", "second")],
                Vec::new(),
                Value::Null,
            )
            .expect("brownfield duplicate fixture");

        let mut successor = schema();
        successor.tables[0].indexes = vec![crate::manifest::IndexManifest {
            name: "by_rank".to_owned(),
            fields: vec!["rank".to_owned()],
            unique: true,
            where_applicable: true,
        }];
        let error = db
            .schema_seed()
            .apply_schema(successor)
            .expect_err("participating duplicates refuse activation");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION"
        );
        assert!(
            db.schema.tables[0].indexes.is_empty(),
            "predecessor stays active"
        );
    }

    #[test]
    fn adding_unique_where_present_over_absent_brownfield_rows_succeeds() {
        let mut db = database();
        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![
                    BufferedWrite::Insert {
                        table: "items".to_owned(),
                        id: "absent-1".to_owned(),
                        values: Map::from_iter([("title".to_owned(), json!("first"))]),
                    },
                    BufferedWrite::Insert {
                        table: "items".to_owned(),
                        id: "absent-2".to_owned(),
                        values: Map::from_iter([("title".to_owned(), json!("second"))]),
                    },
                ],
                Vec::new(),
                Value::Null,
            )
            .expect("absent brownfield fixture");

        let mut successor = schema();
        successor.tables[0].indexes = vec![crate::manifest::IndexManifest {
            name: "by_rank".to_owned(),
            fields: vec!["rank".to_owned()],
            unique: true,
            where_applicable: true,
        }];
        db.schema_seed()
            .apply_schema(successor)
            .expect("absent rows are exempt during activation");
        assert!(db.schema.tables[0].indexes[0].where_applicable);
    }

    fn relational_schema() -> SchemaManifest {
        let string = |name: &str, optional: bool| FieldManifest {
            name: name.to_owned(),
            field_type: FieldType::String,
            optional,
        };
        SchemaManifest {
            tables: vec![
                TableManifest {
                    name: "books".to_owned(),
                    fields: vec![
                        string("title", false),
                        string("authorSlug", true),
                        string("ownerId", false),
                    ],
                    indexes: vec![crate::manifest::IndexManifest {
                        name: "by_owner_title".to_owned(),
                        fields: vec!["ownerId".to_owned(), "title".to_owned()],
                        unique: false,
                        where_applicable: false,
                    }],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                },
                TableManifest {
                    name: "authors".to_owned(),
                    fields: vec![
                        string("slug", false),
                        string("name", false),
                        string("ownerId", false),
                    ],
                    indexes: vec![crate::manifest::IndexManifest {
                        name: "by_slug".to_owned(),
                        fields: vec!["slug".to_owned()],
                        // Deliberately non-unique so the duplicate-key
                        // below-constraint corruption case is seedable; the
                        // executor must refuse, never pick a first row.
                        unique: false,
                        where_applicable: false,
                    }],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                },
            ],
            ..SchemaManifest::default()
        }
    }

    fn relational_plan(
        join_kind: crate::manifest::JoinKind,
        take: u32,
    ) -> crate::manifest::RelationalQueryPlan {
        use crate::manifest::{
            FilterExpr, JoinEquality, ProjectionLeaf, ProjectionSource, RelationalQueryPlan,
        };
        let owner_visibility = |field: &str| FilterExpr {
            field: field.to_owned(),
            op: FilterOp::Eq,
            value: ValueExpr::AuthUserId,
        };
        RelationalQueryPlan {
            root: "books".to_owned(),
            root_alias: "book".to_owned(),
            joined: "authors".to_owned(),
            joined_alias: "author".to_owned(),
            join_kind,
            join_on: vec![JoinEquality {
                root_field: "authorSlug".to_owned(),
                joined_field: "slug".to_owned(),
            }],
            root_filters: Vec::new(),
            root_visibility: vec![owner_visibility("ownerId")],
            joined_visibility: vec![owner_visibility("ownerId")],
            projection: vec![
                ProjectionLeaf {
                    name: "title".to_owned(),
                    source: ProjectionSource::RootField("title".to_owned()),
                },
                ProjectionLeaf {
                    name: "authorName".to_owned(),
                    source: ProjectionSource::JoinedField("name".to_owned()),
                },
                ProjectionLeaf {
                    name: "shelf".to_owned(),
                    source: ProjectionSource::Literal(json!("fiction")),
                },
            ],
            order: vec![crate::manifest::OrderExpr {
                field: "title".to_owned(),
                direction: OrderDirection::Asc,
                max_encoded_bytes: None,
            }],
            take,
            root_index: "by_owner_title".to_owned(),
            joined_index: "by_slug".to_owned(),
        }
    }

    fn relational_database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(relational_schema())
            .expect("apply relational schema");
        let row = |id: &str, fields: Value| {
            let mut object = fields.as_object().cloned().expect("row object");
            object.insert("_id".to_owned(), json!(id));
            object
        };
        db.schema_seed().seed(SeedData {
            tables: BTreeMap::from([
                (
                    "books".to_owned(),
                    vec![
                        row(
                            "b1",
                            json!({ "title": "alpha", "authorSlug": "ada", "ownerId": "user-a" }),
                        ),
                        row(
                            "b2",
                            json!({ "title": "beta", "authorSlug": "grace", "ownerId": "user-a" }),
                        ),
                        row(
                            "b3",
                            json!({ "title": "gamma", "authorSlug": null, "ownerId": "user-a" }),
                        ),
                        row(
                            "b4",
                            json!({ "title": "delta", "authorSlug": "ada", "ownerId": "user-b" }),
                        ),
                    ],
                ),
                (
                    "authors".to_owned(),
                    vec![
                        row(
                            "a1",
                            json!({ "slug": "ada", "name": "Ada", "ownerId": "user-a" }),
                        ),
                        row(
                            "a2",
                            json!({ "slug": "grace", "name": "Grace", "ownerId": "user-b" }),
                        ),
                    ],
                ),
            ]),
        })
        .expect("seed relational fixture");
        db
    }

    fn relational_input(user: &str) -> HandlerInput {
        HandlerInput {
            auth: AuthInput {
                user_id: Some(user.to_owned()),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        }
    }

    // @ref LLP 0080#2-portable-evaluation-semantics — root-window-v1: the
    //   root window is filtered by visibility before take; an unmatched,
    //   null-keyed, or invisible joined row is omitted by `inner` without
    //   refilling the page and nulled by `left`; a duplicate under the
    //   claimed-unique joined key refuses rather than choosing a row.
    #[test]
    fn relational_root_window_semantics() {
        use crate::manifest::JoinKind;
        let db = relational_database();
        let input = relational_input("user-a");

        // Inner: b1 joins Ada (visible); b2's author Grace is owned by
        // user-b, so the joined predicate makes her absent and b2 is
        // omitted; b3 has a null join key; b4 is another owner's root and
        // never occupies a window slot. Short page, no refill.
        let (inner, inner_continuation) = db
            .query_reads_read()
            .query_relational(&relational_plan(JoinKind::Inner, 10), &input, None)
            .expect("inner relational query");
        assert!(
            inner_continuation.is_none(),
            "a short page is terminal and returns no continuation",
        );
        assert_eq!(
            inner.rows,
            vec![json!({
                "authorName": "Ada",
                "shelf": "fiction",
                "title": "alpha",
            })],
        );

        // Left: every visible root emits; missing/invisible/null-key joined
        // leaves are null — indistinguishable from one another.
        let (left, _) = db
            .query_reads_read()
            .query_relational(&relational_plan(JoinKind::Left, 10), &input, None)
            .expect("left relational query");
        let titles: Vec<(&str, bool)> = left
            .rows
            .iter()
            .map(|r| (r["title"].as_str().unwrap(), r["authorName"].is_null()))
            .collect();
        assert_eq!(
            titles,
            vec![("alpha", false), ("beta", true), ("gamma", true)],
            "left join nulls invisible and null-key joined leaves identically",
        );

        // take bounds consumed authorized roots, not emitted rows: with
        // take=2 the window is [alpha, beta]; beta's author is invisible so
        // inner emits one row, and gamma is never consumed to refill.
        let (windowed, windowed_continuation) = db
            .query_reads_read()
            .query_relational(&relational_plan(JoinKind::Inner, 2), &input, None)
            .expect("windowed inner query");
        assert_eq!(windowed.rows.len(), 1);
        assert_eq!(windowed.rows[0]["title"], json!("alpha"));
        // The window consumed its full take of authorized roots, so the
        // short emitted page still carries a progressing continuation.
        let continuation = windowed_continuation.expect("full window continues");
        assert_eq!(continuation.id, "b2");

        let (_, _, observed) = query_relational_on_observed(
            &DbRead::Live(&db),
            &relational_plan(JoinKind::Inner, 2),
            &input,
            None,
        )
        .expect("observed relational window");
        assert_eq!(observed.examined_root_entries, 2);
        assert_eq!(
            observed.joined_lookups, 2,
            "every consumed root is charged one joined-side lookup decision",
        );

        // take: 0 is an empty page that consumes nothing.
        let (empty, empty_continuation) = db
            .query_reads_read()
            .query_relational(&relational_plan(JoinKind::Inner, 0), &input, None)
            .expect("take zero");
        assert!(empty.rows.is_empty());
        assert!(empty_continuation.is_none());
        let (_, _, observed_empty) = query_relational_on_observed(
            &DbRead::Live(&db),
            &relational_plan(JoinKind::Inner, 0),
            &input,
            None,
        )
        .expect("observed take-zero window");
        assert_eq!(observed_empty, RelationalExecutionObservation::default());

        // Below-constraint duplicate injection: a second row under the
        // claimed-unique joined key is a storage-invariant refusal.
        let mut corrupted = LocalDatabase::memory().expect("memory database");
        corrupted
            .schema_seed()
            .apply_schema(relational_schema())
            .expect("apply relational schema");
        corrupted
            .schema_seed().seed(SeedData {
                tables: BTreeMap::from([
                    (
                        "books".to_owned(),
                        vec![json!({ "_id": "b1", "title": "alpha", "authorSlug": "ada", "ownerId": "user-a" })
                            .as_object()
                            .cloned()
                            .expect("seed row")],
                    ),
                    (
                        "authors".to_owned(),
                        vec![
                            json!({ "_id": "a1", "slug": "ada", "name": "Ada", "ownerId": "user-a" }),
                            json!({ "_id": "a3", "slug": "ada", "name": "Imposter", "ownerId": "user-a" }),
                        ]
                        .into_iter()
                        .map(|row| row.as_object().cloned().expect("seed row"))
                        .collect(),
                    ),
                ]),
            })
            .expect("seed duplicate authors");
        let error = corrupted
            .query_reads_read()
            .query_relational(&relational_plan(JoinKind::Inner, 10), &input, None)
            .expect_err("duplicate unique key must refuse");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_RELATIONAL_DUPLICATE_UNIQUE_KEY"
        );

        // Closed-shape refusals.
        let mut no_pairs = relational_plan(JoinKind::Inner, 10);
        no_pairs.join_on.clear();
        let error = db
            .query_reads_read()
            .query_relational(&no_pairs, &input, None)
            .expect_err("zero join pairs");
        assert_eq!(error.diagnostic.code, "SNAPBACK_RELATIONAL_PLAN_INVALID");
        let mut too_big = relational_plan(JoinKind::Inner, 10);
        too_big.take = 1025;
        let error = db
            .query_reads_read()
            .query_relational(&too_big, &input, None)
            .expect_err("take over 1024");
        assert_eq!(error.diagnostic.code, "SNAPBACK_RELATIONAL_PLAN_INVALID");
    }

    // @ref LLP 0080#2-portable-evaluation-semantics — continuation follows
    //   the root order key from the last consumed root: a full window
    //   continues even when every root in it was omitted by the inner join
    //   (all-omitted windows progress), and only a short window is terminal.
    #[test]
    fn relational_keyset_pages_without_skip_or_duplicate() {
        use crate::manifest::JoinKind;
        let db = relational_database();
        let input = relational_input("user-a");
        let plan = relational_plan(JoinKind::Inner, 1);

        // Visible roots for user-a in title order: alpha(b1), beta(b2,
        // author invisible), gamma(b3, null join key).
        let (page1, cursor1) = db
            .query_reads_read()
            .query_relational(&plan, &input, None)
            .expect("first page");
        assert_eq!(page1.rows.len(), 1);
        assert_eq!(page1.rows[0]["title"], json!("alpha"));
        let cursor1 = cursor1.expect("full window continues");
        assert_eq!(cursor1.id, "b1");
        assert_eq!(cursor1.entries, vec![("title".to_owned(), json!("alpha"))]);

        // Window [beta]: consumed one root, emitted zero rows (invisible
        // author), still progresses.
        let (page2, cursor2) = db
            .query_reads_read()
            .query_relational(&plan, &input, Some(&cursor1))
            .expect("second page");
        assert!(page2.rows.is_empty(), "all-omitted window emits no rows");
        let cursor2 = cursor2.expect("all-omitted window still progresses");
        assert_eq!(cursor2.id, "b2");

        // Window [gamma]: null join key, same shape.
        let (page3, cursor3) = db
            .query_reads_read()
            .query_relational(&plan, &input, Some(&cursor2))
            .expect("third page");
        assert!(page3.rows.is_empty());
        let cursor3 = cursor3.expect("full window continues");
        assert_eq!(cursor3.id, "b3");

        // Past the last root: consumes nothing, terminal — end-of-stream
        // is an empty page with no continuation, exactly as pinned.
        let (page4, cursor4) = db
            .query_reads_read()
            .query_relational(&plan, &input, Some(&cursor3))
            .expect("terminal page");
        assert!(page4.rows.is_empty());
        assert!(cursor4.is_none(), "a short window is terminal");

        // No skip, no duplicate: the union of consumed roots across pages
        // is exactly the unpaged window.
        let (all, _) = db
            .query_reads_read()
            .query_relational(&relational_plan(JoinKind::Left, 10), &input, None)
            .expect("unpaged window");
        assert_eq!(all.rows.len(), 3);
    }

    // @ref LLP 0080#2-portable-evaluation-semantics — executor rows encode
    //   byte-deterministically under RelationalResultEncodingV1: members in
    //   projection declaration order, left-join nulls as the literal, and
    //   the same bytes on every evaluation.
    #[test]
    fn relational_rows_encode_under_result_encoding_v1() {
        use crate::manifest::JoinKind;
        let db = relational_database();
        let input = relational_input("user-a");
        let field_order: Vec<String> = ["title", "authorName", "shelf"]
            .iter()
            .map(|s| (*s).to_owned())
            .collect();
        let (inner, _) = db
            .query_reads_read()
            .query_relational(&relational_plan(JoinKind::Inner, 10), &input, None)
            .expect("inner query");
        assert_eq!(
            crate::rqs::relational_result_encoding_v1(&field_order, &inner.rows)
                .expect("inner rows encode"),
            r#"[{"title":"alpha","authorName":"Ada","shelf":"fiction"}]"#,
        );
        let (left, _) = db
            .query_reads_read()
            .query_relational(&relational_plan(JoinKind::Left, 10), &input, None)
            .expect("left query");
        assert_eq!(
            crate::rqs::relational_result_encoding_v1(&field_order, &left.rows)
                .expect("left rows encode"),
            concat!(
                r#"[{"title":"alpha","authorName":"Ada","shelf":"fiction"},"#,
                r#"{"title":"beta","authorName":null,"shelf":"fiction"},"#,
                r#"{"title":"gamma","authorName":null,"shelf":"fiction"}]"#,
            ),
            "left-join nulls stay literal; members follow the declaration order",
        );
    }

    // @ref LLP 0080#2-portable-evaluation-semantics — the instrumented
    //   index-served root bound: on a large, sparse, mostly-invisible
    //   fixture the root window performs zero fullscan steps (the declared
    //   owner-leading index serves the range), fetches no more rows than
    //   the admitted window, and its total VM work stays far below a table
    //   traversal — no target scans to fill a page.
    #[test]
    fn relational_root_window_is_index_served_on_sparse_fixture() {
        use crate::manifest::JoinKind;
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(relational_schema())
            .expect("apply schema");
        // 3,000 roots; only every 300th belongs to user-a (10 visible),
        // interleaved so a scan would walk the whole table.
        let books: Vec<Map<String, Value>> = (0..3_000)
            .map(|index| {
                let owner = if index % 300 == 0 { "user-a" } else { "user-b" };
                json!({
                    "_id": format!("b{index:04}"),
                    "title": format!("t{index:04}"),
                    "authorSlug": "ada",
                    "ownerId": owner,
                })
                .as_object()
                .cloned()
                .expect("seed row")
            })
            .collect();
        let authors = vec![
            json!({ "_id": "a1", "slug": "ada", "name": "Ada", "ownerId": "user-a" })
                .as_object()
                .cloned()
                .expect("seed row"),
        ];
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([
                    ("books".to_owned(), books),
                    ("authors".to_owned(), authors),
                ]),
            })
            .expect("seed sparse fixture");

        let input = relational_input("user-a");
        let _ = take_keyset_scan_stats();
        let (page, continuation) = db
            .query_reads_read()
            .query_relational(&relational_plan(JoinKind::Left, 5), &input, None)
            .expect("sparse window");
        assert_eq!(page.rows.len(), 5);
        assert!(continuation.is_some(), "full window continues");
        let stats = take_keyset_scan_stats();
        let root = stats
            .iter()
            .find(|entry| entry.table == "books")
            .expect("root window recorded scan stats");
        assert_eq!(
            root.fullscan_steps, 0,
            "the root window must be index-served, never a table scan: {root:?}"
        );
        assert!(
            root.fetched_rows <= 5,
            "examined entries stay within the admitted window: {root:?}"
        );
        assert!(
            root.vm_steps < 1_000,
            "VM work must be window-bounded, far below a 3,000-row              traversal: {root:?}"
        );
    }

    // @ref LLP 0080#2-portable-evaluation-semantics — pagination is not
    //   snapshot-consistent across pages, and the claim is exactly the
    //   stated bound: no skipped and no duplicated root among roots whose
    //   order keys and visibility are untouched by concurrent mutations; a
    //   mutated root may move relative to the boundary, and a root
    //   inserted before the boundary is not revisited.
    #[test]
    fn relational_keyset_bound_survives_concurrent_mutations() {
        use crate::manifest::JoinKind;
        let input = relational_input("user-a");
        let plan = relational_plan(JoinKind::Left, 2);
        let book = |id: &str, title: &str| {
            json!({ "_id": id, "title": title, "authorSlug": "ada", "ownerId": "user-a" })
                .as_object()
                .cloned()
                .expect("seed row")
        };
        let author = json!({ "_id": "a1", "slug": "ada", "name": "Ada", "ownerId": "user-a" })
            .as_object()
            .cloned()
            .expect("seed row");
        let seed = |books: Vec<Map<String, Value>>| {
            let mut db = LocalDatabase::memory().expect("memory database");
            db.schema_seed()
                .apply_schema(relational_schema())
                .expect("apply schema");
            db.schema_seed()
                .seed(SeedData {
                    tables: BTreeMap::from([
                        ("books".to_owned(), books),
                        ("authors".to_owned(), vec![author.clone()]),
                    ]),
                })
                .expect("seed");
            db
        };

        let before = seed(vec![
            book("b1", "alpha"),
            book("b2", "beta"),
            book("b3", "gamma"),
            book("b4", "delta"),
        ]);
        let (page1, cursor) = before
            .query_reads_read()
            .query_relational(&plan, &input, None)
            .expect("first page");
        assert_eq!(
            page1
                .rows
                .iter()
                .map(|r| r["title"].clone())
                .collect::<Vec<_>>(),
            vec![json!("alpha"), json!("beta")],
        );
        let cursor = cursor.expect("full window continues");

        // "Concurrent" mutations between pages: alpha deleted, a new root
        // inserted before the boundary, and gamma's order key moved past
        // delta. Only delta is untouched, and it must appear exactly once.
        let after = seed(vec![
            book("b0", "aardvark"),
            book("b2", "beta"),
            book("b3", "zeta"),
            book("b4", "delta"),
        ]);
        let (page2, _) = after
            .query_reads_read()
            .query_relational(&plan, &input, Some(&cursor))
            .expect("second page");
        assert_eq!(
            page2
                .rows
                .iter()
                .map(|r| r["title"].clone())
                .collect::<Vec<_>>(),
            vec![json!("delta"), json!("zeta")],
            "the untouched root is neither skipped nor duplicated; the moved \
             root reappears at its new position; the pre-boundary insert is \
             not revisited",
        );
    }

    // @ref LLP 0080#2-portable-evaluation-semantics — the buffered
    //   read-your-writes overlay executes only single-table `QueryPlan`s:
    //   `ctx.db` host calls deserialize their plan strictly as `QueryPlan`
    //   (whose `table` member is required), so the relational shape fails
    //   admission before any overlay code runs. Relational plans exist
    //   only as function runtimes, and the buffered arm of §2 is satisfied
    //   by construction rather than by a second evaluator.
    #[test]
    fn relational_plans_cannot_enter_the_buffered_overlay() {
        use crate::manifest::JoinKind;
        let relational =
            serde_json::to_value(relational_plan(JoinKind::Inner, 10)).expect("plan serializes");
        assert!(
            serde_json::from_value::<QueryPlan>(relational).is_err(),
            "a relational plan must not deserialize as a single-table QueryPlan",
        );
    }

    // The keyset lowering matches Snapback's total order exactly: NULLS
    // LAST in both directions and the `_id` tie-break, so a boundary can
    // sit on a duplicate order key or a null component without skipping or
    // duplicating rows.
    #[test]
    fn keyset_lowering_totalizes_nulls_and_tiebreak() {
        let db = relational_database();
        let input = relational_input("user-a");
        let plan = QueryPlan {
            table_visibility: None,
            table: "books".to_owned(),
            filters: Vec::new(),
            membership_filters: Vec::new(),
            order: vec![OrderExpr {
                field: "authorSlug".to_owned(),
                direction: OrderDirection::Asc,
                max_encoded_bytes: None,
            }],
            limit: None,
            indexed_by: None,
        };
        let ids = |output: &QueryOutput| {
            output
                .rows
                .iter()
                .map(|row| row["_id"].as_str().expect("row id").to_owned())
                .collect::<Vec<_>>()
        };
        let boundary = |value: Value, id: &str| KeysetAfter {
            entries: vec![("authorSlug".to_owned(), value)],
            id: id.to_owned(),
        };
        db.query_reads_read()
            .with_pinned_read_view(|view| {
                // Total order: b1(ada), b4(ada), b2(grace), b3(null).
                let full = view.query_keyset(&plan, &input, None)?;
                assert_eq!(ids(&full), vec!["b1", "b4", "b2", "b3"]);
                // Duplicate order key: the `_id` tie-break carries the boundary.
                let after_b1 =
                    view.query_keyset(&plan, &input, Some(&boundary(json!("ada"), "b1")))?;
                assert_eq!(ids(&after_b1), vec!["b4", "b2", "b3"]);
                // Nulls sort after every value, so they follow a non-null boundary.
                let after_b2 =
                    view.query_keyset(&plan, &input, Some(&boundary(json!("grace"), "b2")))?;
                assert_eq!(ids(&after_b2), vec!["b3"]);
                // A null boundary component admits only later tie-breaks.
                let after_b3 =
                    view.query_keyset(&plan, &input, Some(&boundary(Value::Null, "b3")))?;
                assert!(ids(&after_b3).is_empty());
                // A boundary whose fields do not match the order schema is an
                // internal invariant refusal, not a silent reposition.
                let error = view
                    .query_keyset(
                        &plan,
                        &input,
                        Some(&KeysetAfter {
                            entries: vec![("title".to_owned(), json!("alpha"))],
                            id: "b1".to_owned(),
                        }),
                    )
                    .expect_err("mismatched boundary fields must refuse");
                assert_eq!(error.diagnostic.code, "SNAPBACK_QUERY_KEYSET_INVALID");
                Ok(())
            })
            .expect("pinned keyset probes");
    }

    // @ref LLP 0065#2-the-v1-visibility-floor — generated update/delete lower
    //   to a server-evaluated conditional plan: read, owner guard, write in
    //   one authoritative transaction. The guard consumes the transaction's
    //   own read — a concurrent owner transfer landing between preview and
    //   commit is seen, refused with the collapsed public code, and neither
    //   commit order loses or misattributes a write.
    #[test]
    fn conditional_owner_guard_reads_commit_state_not_preview_state() {
        let owner_guard_plan = || {
            let owner_eq = ValueExpr::Binary {
                op: crate::manifest::BinaryOp::Eq,
                left: Box::new(ValueExpr::Field {
                    base: Box::new(ValueExpr::Binding("row".to_owned())),
                    key: "title".to_owned(),
                }),
                right: Box::new(ValueExpr::AuthUserId),
            };
            let mut patch_values = BTreeMap::new();
            patch_values.insert("rank".to_owned(), ValueExpr::Literal(json!(5)));
            MutationPlan {
                steps: vec![
                    MutationStep::Get {
                        table: "items".to_owned(),
                        id: ValueExpr::Literal(json!("row-1")),
                        bind_as: "row".to_owned(),
                        else_error: Some("SNAPBACK_ROW_NOT_FOUND".to_owned()),
                    },
                    MutationStep::Guard {
                        cond: owner_eq,
                        else_error: "SNAPBACK_ROW_NOT_FOUND".to_owned(),
                    },
                    MutationStep::Patch {
                        table: "items".to_owned(),
                        id: ValueExpr::Literal(json!("row-1")),
                        values: patch_values,
                    },
                ],
                return_value: Some(ReturnValue::ChangedCount),
            }
        };
        let owner_input = |user: &str| HandlerInput {
            auth: AuthInput {
                user_id: Some(user.to_owned()),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let transfer_to = |db: &mut LocalDatabase, new_owner: &str| {
            db.mutation_writes()
                .commit_buffered_writes(
                    &HandlerInput::default(),
                    vec![BufferedWrite::Patch {
                        table: "items".to_owned(),
                        id: "row-1".to_owned(),
                        values: Map::from_iter([("title".to_owned(), json!(new_owner))]),
                    }],
                    Vec::new(),
                    Value::Null,
                )
                .expect("handwritten owner transfer");
        };
        let seed = |db: &mut LocalDatabase| {
            db.schema_seed()
                .seed(SeedData {
                    tables: BTreeMap::from([(
                        "items".to_owned(),
                        vec![
                            json!({ "_id": "row-1", "title": "user-a", "rank": 1 })
                                .as_object()
                                .cloned()
                                .expect("seed row"),
                        ],
                    )]),
                })
                .expect("seed owned row");
        };

        // Order 1: the transfer lands between the update's preview and its
        // guarded commit. The commit-time guard must see the new owner and
        // refuse with the collapsed public code; the row is untouched.
        let mut db = database();
        seed(&mut db);
        let input = owner_input("user-a");
        let plan = owner_guard_plan();
        db.mutation_writes()
            .dry_run_mutation(&plan, &input)
            .expect("preview against the pre-transfer owner succeeds");
        transfer_to(&mut db, "user-b");
        let error = db
            .mutation_writes()
            .execute_mutation_guarded(&plan, &input, || Ok(()), || Ok(()))
            .expect_err("commit-time guard must see the concurrent transfer");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ROW_NOT_FOUND");
        let row = db.query_reads_read().scan_table("items", 10, 0).unwrap();
        assert_eq!(
            row.rows[0]["title"],
            json!("user-b"),
            "transfer is not lost"
        );
        assert_eq!(
            row.rows[0]["rank"],
            json!(1),
            "refused update wrote nothing"
        );

        // Order 2: the update commits first, then the transfer. Both writes
        // land; nothing is lost or misattributed.
        let mut db = database();
        seed(&mut db);
        db.mutation_writes()
            .execute_mutation_guarded(
                &owner_guard_plan(),
                &owner_input("user-a"),
                || Ok(()),
                || Ok(()),
            )
            .expect("owner update before the transfer succeeds");
        transfer_to(&mut db, "user-b");
        let rows = db.query_reads_read().scan_table("items", 10, 0).unwrap();
        assert_eq!(rows.rows[0]["rank"], json!(5), "committed update survives");
        assert_eq!(
            rows.rows[0]["title"],
            json!("user-b"),
            "later transfer wins the field"
        );
    }

    // @ref LLP 0007#index-contract — the duplicate-order-key witness: the
    //   implicit trailing `_id` component totalizes scan order while a unique
    //   index over the same declared fields still refuses duplicates.
    #[test]
    fn implicit_index_id_suffix_is_scan_order_only() {
        let mut suffix_schema = schema();
        suffix_schema.tables[0].indexes = vec![
            crate::manifest::IndexManifest {
                name: "by_rank".to_owned(),
                fields: vec!["rank".to_owned()],
                unique: false,
                where_applicable: false,
            },
            crate::manifest::IndexManifest {
                name: "by_title".to_owned(),
                fields: vec!["title".to_owned()],
                unique: true,
                where_applicable: false,
            },
        ];
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(suffix_schema)
            .expect("apply index schema");

        let index_columns = |db: &LocalDatabase, physical: &str| -> Vec<String> {
            let mut statement = db
                .conn
                .prepare(&format!(
                    "PRAGMA index_info({})",
                    quote_ident(physical).unwrap()
                ))
                .unwrap();
            statement
                .query_map([], |row| row.get::<_, String>(2))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(
            index_columns(&db, "items_by_rank"),
            ["rank", "_id"],
            "non-unique declared index carries the implicit scan-order _id suffix"
        );
        assert_eq!(
            index_columns(&db, "items_by_title"),
            ["title"],
            "unique index stays declared-fields-only so the constraint is not vacuous"
        );

        // Duplicate order keys inserted in shuffled id order: scan order must
        // be (rank, _id) ascending regardless of insertion order.
        let mut rows: Vec<Map<String, Value>> = Vec::new();
        for value in 0..64u32 {
            let id = format!("row-{:02}", (value * 37) % 64);
            rows.push(
                json!({
                    "_id": id,
                    "title": format!("title-{}", id),
                    "rank": (value % 2) as i64,
                })
                .as_object()
                .cloned()
                .expect("seed row"),
            );
        }
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([("items".to_owned(), rows)]),
            })
            .expect("seed duplicate order keys");
        let result = db
            .query_reads_read()
            .query(
                &QueryPlan {
                    table_visibility: None,
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    order: vec![crate::manifest::OrderExpr {
                        field: "rank".to_owned(),
                        direction: OrderDirection::Asc,
                        max_encoded_bytes: None,
                    }],
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: Some("by_rank".to_owned()),
                },
                &HandlerInput::default(),
            )
            .expect("indexed duplicate-key query");
        let observed: Vec<(i64, String)> = result
            .rows
            .iter()
            .map(|row| {
                (
                    row["rank"].as_i64().expect("rank"),
                    row["_id"].as_str().expect("id").to_owned(),
                )
            })
            .collect();
        let mut expected = observed.clone();
        expected.sort();
        assert_eq!(observed, expected, "scan order is (rank, _id) ascending");
        assert_eq!(observed.len(), 64);

        // The unique constraint ignores the implicit suffix: a duplicate
        // declared key with a fresh _id still loses at commit.
        let error = db
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "row-fresh".to_owned(),
                    values: Map::from_iter([
                        ("title".to_owned(), json!("title-row-00")),
                        ("rank".to_owned(), json!(9)),
                    ]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect_err("duplicate declared unique key must lose despite a fresh _id");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION"
        );
    }

    #[test]
    fn delegated_host_decisions_intersect_actor_aware_rules_with_direct_baseline() {
        let delegated = HandlerInput {
            auth: AuthInput {
                user_id: Some("effective-user".to_owned()),
                ..AuthInput::default()
            }
            .with_authorization_projection(Some("human"), Some("agent"), true),
            ..HandlerInput::default()
        };
        let direct = HandlerInput {
            auth: AuthInput {
                user_id: Some("effective-user".to_owned()),
                ..AuthInput::default()
            }
            .with_authorization_projection(Some("human"), None, false),
            ..HandlerInput::default()
        };
        let mut query_db = database();
        query_db
            .schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![
                        Map::from_iter([("title".to_owned(), json!("delegated"))]),
                        Map::from_iter([("title".to_owned(), json!("direct"))]),
                    ],
                )]),
            })
            .expect("seed actor-aware query rows");

        let actor_aware_query = QueryPlan {
            table_visibility: None,
            table: "items".to_owned(),
            filters: vec![crate::manifest::FilterExpr {
                field: "title".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::If {
                    cond: Box::new(ValueExpr::AuthIsDelegated),
                    then: Box::new(ValueExpr::Literal(json!("delegated"))),
                    r#else: Box::new(ValueExpr::Literal(json!("direct"))),
                },
            }],
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        };
        assert!(
            query_db
                .query_reads_read()
                .query(&actor_aware_query, &delegated)
                .expect("run intersected delegated query")
                .rows
                .is_empty(),
            "delegated and direct row constraints are intersected"
        );
        assert_eq!(
            query_db
                .query_reads_read()
                .query(&actor_aware_query, &direct)
                .expect("run direct query")
                .rows
                .len(),
            1
        );

        let disjunctive_query = QueryPlan {
            table_visibility: None,
            filters: vec![crate::manifest::FilterExpr {
                field: "title".to_owned(),
                op: FilterOp::In,
                value: ValueExpr::If {
                    cond: Box::new(ValueExpr::AuthIsDelegated),
                    then: Box::new(ValueExpr::Literal(json!(["direct", "delegated"]))),
                    r#else: Box::new(ValueExpr::Literal(json!(["direct"]))),
                },
            }],
            ..actor_aware_query.clone()
        };
        let intersected = query_db
            .query_reads_read()
            .query(&disjunctive_query, &delegated)
            .expect("intersect a disjunctive delegated row rule")
            .rows;
        assert_eq!(
            intersected.len(),
            1,
            "the delegated disjunct cannot widen the row set"
        );
        assert_eq!(intersected[0]["title"], "direct");
        assert_eq!(
            intersected.len(),
            1,
            "aggregate count derives only from admitted rows"
        );
        assert_eq!(
            intersected
                .iter()
                .map(|row| row["title"].clone())
                .collect::<Vec<_>>(),
            vec![json!("direct")],
            "a projection cannot recover the excluded row"
        );
        let opaque = json!({ "opaque": &intersected });
        assert_eq!(opaque["opaque"].as_array().map(Vec::len), Some(1));
        assert_eq!(
            opaque["opaque"][0]["title"], "direct",
            "opaque results are still derived from the intersected row set"
        );

        let actor_only_query = QueryPlan {
            table_visibility: None,
            filters: vec![crate::manifest::FilterExpr {
                field: "title".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::AuthActorKind,
            }],
            ..actor_aware_query.clone()
        };
        assert!(
            query_db
                .query_reads_read()
                .query(&actor_only_query, &delegated)
                .expect("a missing direct actor fails closed instead of widening")
                .rows
                .is_empty()
        );

        let actor_only = ValueExpr::Binary {
            op: crate::manifest::BinaryOp::Eq,
            left: Box::new(ValueExpr::AuthActorKind),
            right: Box::new(ValueExpr::Literal(json!("agent"))),
        };
        let delegated_disjunction = ValueExpr::Binary {
            op: crate::manifest::BinaryOp::Or,
            left: Box::new(ValueExpr::Binary {
                op: crate::manifest::BinaryOp::Eq,
                left: Box::new(ValueExpr::AuthUserId),
                right: Box::new(ValueExpr::Literal(json!("somebody-else"))),
            }),
            right: Box::new(ValueExpr::AuthIsDelegated),
        };
        let negated_actor = ValueExpr::Unary {
            op: crate::manifest::UnaryOp::Not,
            expr: Box::new(ValueExpr::Binary {
                op: crate::manifest::BinaryOp::Eq,
                left: Box::new(ValueExpr::AuthActorKind),
                right: Box::new(ValueExpr::Literal(json!("agent"))),
            }),
        };
        for (name, cond) in [
            ("actor-only", actor_only),
            ("delegated-disjunction", delegated_disjunction),
            ("negated-actor", negated_actor),
        ] {
            let mut db = database();
            let plan = MutationPlan {
                steps: vec![MutationStep::Guard {
                    cond,
                    else_error: "TEST_AUTH_RULE_DENIED".to_owned(),
                }],
                return_value: Some(ReturnValue::ChangedCount),
            };
            let error = db
                .mutation_writes()
                .execute_mutation(&plan, &delegated)
                .expect_err("the direct baseline must veto delegated-only authority");
            assert_eq!(error.diagnostic.code, "TEST_AUTH_RULE_DENIED", "{name}");
        }

        let mut db = database();
        let aliased_actor_rule = MutationPlan {
            steps: vec![
                MutationStep::Let {
                    bind_as: "delegated".to_owned(),
                    expr: ValueExpr::AuthIsDelegated,
                },
                MutationStep::Guard {
                    cond: ValueExpr::Binding("delegated".to_owned()),
                    else_error: "TEST_AUTH_RULE_DENIED".to_owned(),
                },
            ],
            return_value: Some(ReturnValue::ChangedCount),
        };
        let error = db
            .mutation_writes()
            .execute_mutation(&aliased_actor_rule, &delegated)
            .expect_err("binding aliases cannot hide actor dependence from a trusted guard");
        assert_eq!(error.diagnostic.code, "TEST_AUTH_RULE_DENIED");
    }

    fn permission_schema(permission_fields: Option<Vec<&str>>) -> SchemaManifest {
        let mut schema = schema();
        let table = &mut schema.tables[0];
        table.permission_backing = true;
        table.permission_fields =
            permission_fields.map(|fields| fields.into_iter().map(str::to_owned).collect());
        schema
    }

    fn permission_database(permission_fields: Option<Vec<&str>>) -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(permission_schema(permission_fields))
            .expect("apply permission schema");
        db
    }

    fn file_database() -> (tempfile::TempDir, PathBuf, LocalDatabase) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("guarded.sqlite3");
        let mut db = LocalDatabase::open(&path).expect("file database");
        db.schema_seed()
            .apply_schema(schema())
            .expect("apply test schema");
        (dir, path, db)
    }

    #[test]
    fn head_bound_reads_stay_on_one_snapshot_during_a_sibling_commit() {
        for surface in ["get", "query", "scan"] {
            let (_dir, path, mut setup) = file_database();
            setup
                .schema_seed()
                .seed(seed_data("item", "before"))
                .expect("seed baseline row");
            drop(setup);

            let reader = LocalDatabase::open(&path).expect("open reader");
            let (reached_tx, reached_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let _hook = set_storage_read_snapshot_debug_hook(&reader, reached_tx, release_rx);
            let writer_path = path.clone();
            let writer = std::thread::spawn(move || {
                let sampled_head = reached_rx
                    .recv_timeout(std::time::Duration::from_secs(5))
                    .expect("reader pins the baseline head");
                let mut writer = LocalDatabase::open(writer_path).expect("open sibling writer");
                let committed = writer
                    .mutation_writes()
                    .commit_buffered_writes(
                        &HandlerInput::default(),
                        vec![BufferedWrite::Patch {
                            table: "items".to_owned(),
                            id: "item".to_owned(),
                            values: Map::from_iter([("title".to_owned(), json!("after"))]),
                        }],
                        Vec::new(),
                        Value::Null,
                    )
                    .expect("commit sibling patch");
                release_tx
                    .send(())
                    .expect("release the pinned reader after commit");
                (sampled_head, committed.output.version)
            });

            let (reported_version, row) = match surface {
                "get" => (
                    None,
                    reader
                        .query_reads_read()
                        .get("items", "item")
                        .expect("point read")
                        .expect("baseline row"),
                ),
                "query" => {
                    let output = reader
                        .query_reads_read()
                        .query(
                            &QueryPlan {
                                table_visibility: None,
                                table: "items".to_owned(),
                                filters: Vec::new(),
                                membership_filters: Vec::new(),
                                order: Vec::new(),
                                limit: None,
                                indexed_by: None,
                            },
                            &HandlerInput::default(),
                        )
                        .expect("query read");
                    (Some(output.version), output.rows[0].clone())
                }
                "scan" => {
                    let output = reader
                        .query_reads_read()
                        .scan_table("items", 10, 0)
                        .expect("scan read");
                    (None, output.rows[0].clone())
                }
                _ => unreachable!(),
            };
            let (sampled_head, committed_version) = writer.join().expect("writer joins");

            assert_eq!(
                reported_version.unwrap_or(sampled_head),
                sampled_head,
                "{surface}"
            );
            assert_eq!(row["_version"], sampled_head, "{surface}");
            assert_eq!(row["title"], "before", "{surface}");
            assert_eq!(committed_version, sampled_head + 1, "{surface}");
            assert_eq!(
                reader.current_version().unwrap(),
                committed_version,
                "{surface}"
            );
        }
    }

    #[test]
    fn sibling_writers_allocate_versions_after_the_sqlite_write_reservation() {
        let (_dir, path, setup) = file_database();
        drop(setup);

        let mut first = LocalDatabase::open(&path).expect("open first writer");
        let mut second = LocalDatabase::open(&path).expect("open second writer");
        let (reached_tx, reached_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let _hook = set_commit_version_sample_debug_hook(&first.conn, reached_tx, release_rx);

        let first_writer = std::thread::spawn(move || {
            first
                .mutation_writes()
                .execute_mutation(&insert_plan(), &HandlerInput::default())
                .expect("first sibling commit")
                .output
                .version
        });

        reached_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("first writer samples after owning the write reservation");

        second
            .conn
            .busy_timeout(std::time::Duration::ZERO)
            .expect("disable busy wait for the reservation probe");
        let blocked = second
            .mutation_writes()
            .execute_mutation(&insert_plan(), &HandlerInput::default())
            .expect_err("the sibling cannot begin while the first writer owns the reservation");
        assert_eq!(blocked.diagnostic.code, "SNAPBACK_SQLITE_ERROR");
        assert!(
            blocked.diagnostic.details["error"]
                .as_str()
                .is_some_and(|error| error.contains("database is locked")),
            "unexpected reservation refusal: {:?}",
            blocked.diagnostic.details
        );
        release_tx.send(()).expect("release first sibling writer");
        assert_eq!(first_writer.join().expect("first writer joins"), 1);
        second
            .conn
            .busy_timeout(std::time::Duration::from_secs(5))
            .expect("restore busy timeout");
        let second_version = second
            .mutation_writes()
            .execute_mutation(&insert_plan(), &HandlerInput::default())
            .expect("second sibling commits after the reservation releases")
            .output
            .version;
        assert_eq!(second_version, 2);

        let reader = LocalDatabase::open(&path).expect("open committed database");
        assert_eq!(reader.current_version().unwrap(), 2);
        let rows = reader
            .query_reads_read()
            .scan_table("items", 10, 0)
            .expect("scan commits");
        assert_eq!(rows.total, 4);
        assert_eq!(
            rows.rows
                .iter()
                .map(|row| row["_version"].as_u64().unwrap())
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([1, 2]),
        );
    }

    #[test]
    fn reopen_accepts_a_valid_sibling_commit_after_its_initial_preflight() {
        let (_dir, path, mut writer) = file_database();
        let baseline = writer
            .schema_seed()
            .seed(seed_data("baseline", "before-open"))
            .expect("seed the initial open cut");
        let (reached_tx, reached_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let _hook = set_storage_read_snapshot_debug_hook(&writer, reached_tx, release_rx);

        let open_path = path.clone();
        let opener = std::thread::spawn(move || LocalDatabase::open(open_path));
        let inspected = reached_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("opener pins its mutation-free preflight snapshot");
        assert_eq!(inspected, baseline.version);

        let sibling = writer
            .schema_seed()
            .seed(seed_data("sibling", "during-open"))
            .expect("a sibling writer may commit while the opener validates its old snapshot");
        assert_eq!(sibling.version, baseline.version + 1);
        release_tx.send(()).expect("release the opening snapshot");

        let reopened = opener
            .join()
            .expect("opener thread joins")
            .expect("a valid sibling commit is not storage corruption");
        assert_eq!(reopened.current_version().unwrap(), sibling.version);
        let rows = reopened
            .query_reads_read()
            .scan_table("items", 10, 0)
            .unwrap();
        assert_eq!(rows.total, 2);
        assert_eq!(
            rows.rows
                .iter()
                .map(|row| row["_version"].as_u64().unwrap())
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([baseline.version, sibling.version])
        );
    }

    #[test]
    fn concurrent_reopen_serializes_additive_infrastructure_migration() {
        let (_dir, path, mut legacy) = file_database();
        let input = HandlerInput::default();
        let identity = ClientMutationIdentity::new("cm_legacy_exact_column", "hostPlan", &input);
        legacy
            .execute_mutation_plan_with_lifecycle(
                &insert_plan(),
                &input,
                true,
                Some(&identity),
                &|| Ok(()),
                || Ok(()),
            )
            .expect("seed a populated predecessor ledger");
        legacy
            .conn
            .execute(
                "ALTER TABLE _snapback_client_mutations DROP COLUMN settled_version_exact",
                [],
            )
            .expect("simulate the predecessor infrastructure schema");
        assert!(
            !sqlite_table_columns(&legacy.conn, "_snapback_client_mutations")
                .unwrap()
                .contains("settled_version_exact")
        );

        let (attempt_tx, attempt_rx) = mpsc::channel();
        let (attempt_proceeded_tx, attempt_proceeded_rx) = mpsc::channel();
        let (first_attempt_permit_tx, first_attempt_permit_rx) = mpsc::channel();
        let (second_attempt_permit_tx, second_attempt_permit_rx) = mpsc::channel();
        let (acquired_tx, acquired_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let _hook = set_infra_migration_debug_hook(
            &legacy.conn,
            attempt_tx,
            attempt_proceeded_tx,
            vec![first_attempt_permit_rx, second_attempt_permit_rx],
            acquired_tx,
            release_rx,
        );

        let first_path = path.clone();
        let first = std::thread::spawn(move || LocalDatabase::open(first_path));
        attempt_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("first opener reaches the writer-acquisition boundary");

        let second_path = path.clone();
        let second = std::thread::spawn(move || LocalDatabase::open(second_path));
        attempt_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("second opener reaches the writer-acquisition boundary");

        // Both openers have completed every pre-reservation step. Advance A
        // alone, then keep its acquired transaction paused before column
        // discovery while B remains at the exact BEGIN IMMEDIATE boundary.
        first_attempt_permit_tx
            .send(())
            .expect("let the first opener attempt its reservation");
        attempt_proceeded_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("first opener leaves the acquisition gate");
        acquired_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("first opener reserves the writer before inspecting columns");
        second_attempt_permit_tx
            .send(())
            .expect("let the second opener contend for the reservation");
        attempt_proceeded_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("second opener leaves the acquisition gate while A owns it");
        let probe = Connection::open(&path).expect("open raw reservation probe");
        probe
            .busy_timeout(std::time::Duration::ZERO)
            .expect("disable waiting for the reservation probe");
        let blocked = probe
            .execute_batch("BEGIN IMMEDIATE")
            .expect_err("the first opener must still own SQLite's writer reservation");
        assert!(
            blocked.to_string().contains("database is locked"),
            "unexpected migration reservation refusal: {blocked}"
        );
        drop(probe);
        release_tx
            .send(())
            .expect("release the first serialized migration");
        acquired_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("second opener acquires only after the first releases");

        let first = first
            .join()
            .expect("first opener joins")
            .expect("first additive migration succeeds");
        let second = second
            .join()
            .expect("second opener joins")
            .expect("second opener re-reads the migrated schema");
        for reopened in [&first, &second] {
            assert!(
                sqlite_table_columns(&reopened.conn, "_snapback_client_mutations")
                    .unwrap()
                    .contains("settled_version_exact")
            );
            assert_eq!(
                reopened
                    .settlement_read()
                    .client_mutation_result(&identity)
                    .expect("read the predecessor settlement")
                    .expect("legacy settlement remains retained")
                    .version,
                1
            );
        }
        let exact: SqlValue = first
            .conn
            .query_row(
                "SELECT settled_version_exact FROM _snapback_client_mutations
                 WHERE client_mutation_id = ?1",
                params![identity.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            exact,
            SqlValue::Null,
            "migration never fabricates provenance"
        );
    }

    #[test]
    fn global_query_cursor_does_not_conflict_after_only_hot_table_history_is_pruned() {
        let mut manifest = schema();
        let mut hot_table = manifest.tables[0].clone();
        hot_table.name = "hot_items".to_owned();
        manifest.tables.push(hot_table);
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(manifest)
            .expect("apply two-table schema");
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "hot_items".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), json!("hot")),
                        ("title".to_owned(), json!("v1")),
                    ])],
                )]),
            })
            .expect("seed hot table");

        let query = QueryPlan {
            table_visibility: None,
            table: "items".to_owned(),
            filters: Vec::new(),
            membership_filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            indexed_by: None,
        };
        let input = HandlerInput::default();
        let output = db
            .query_reads_read()
            .query(&query, &input)
            .expect("capture cold-table query");
        assert_eq!(output.version, 1);
        let dependency = crate::live_matcher::query_dependencies_from_plan(
            &query,
            &input,
            &output,
            &DbRead::Live(&db),
        )
        .expect("capture query dependency")
        .into_iter()
        .find(|dependency| dependency.kind == CapturedReadKind::Query)
        .expect("query dependency");

        for title in ["v2", "v3", "v4"] {
            db.mutation_writes()
                .commit_buffered_writes(
                    &input,
                    vec![BufferedWrite::Patch {
                        table: "hot_items".to_owned(),
                        id: "hot".to_owned(),
                        values: Map::from_iter([("title".to_owned(), json!(title))]),
                    }],
                    Vec::new(),
                    Value::Null,
                )
                .expect("advance only the hot table");
        }
        let future = now_millis().saturating_add(10_000);
        assert!(
            db.prune_change_journal(future, 0, 0)
                .expect("prune old hot-table history")
                > 0
        );
        assert!(db.journal_floor_version().unwrap() > output.version + 1);

        let commit = db
            .mutation_writes()
            .commit_buffered_writes(
                &input,
                vec![BufferedWrite::Insert {
                    table: "hot_items".to_owned(),
                    id: "later".to_owned(),
                    values: Map::from_iter([("title".to_owned(), json!("v5"))]),
                }],
                vec![dependency],
                Value::Null,
            )
            .expect("cold-table dependency remains valid");
        assert_eq!(commit.output.version, 5);
    }

    fn insert_plan() -> MutationPlan {
        let insert = |title: &str| {
            let mut values = BTreeMap::new();
            values.insert("title".to_owned(), ValueExpr::Literal(json!(title)));
            MutationStep::Insert {
                table: "items".to_owned(),
                values,
                bind_id_as: None,
            }
        };
        MutationPlan {
            steps: vec![insert("one"), insert("two")],
            return_value: Some(ReturnValue::ChangedCount),
        }
    }

    #[test]
    fn promotion_head_reservation_defers_real_host_plan_and_buffered_writers_on_current_stream() {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(schema())
            .expect("apply schema");
        let tx = db.conn.transaction().expect("stream transaction");
        let stream = auth_invalidation::ensure_data_version_stream_in(&tx)
            .expect("initialize nonliteral data-version stream");
        tx.commit().expect("commit stream");
        assert_ne!(
            stream, "canonical",
            "fixture literals are never stream authority"
        );

        crate::fork_promotion::ensure_promotion_tables(&db.conn)
            .expect("promotion admission tables");
        assert_eq!(
            crate::fork_promotion::canonical_mutation_admission(&db.conn, &stream, 1)
                .expect("no reservation admits"),
            crate::fork_promotion::CanonicalAdmissionV1::Admit
        );
        let ticket_json = serde_json::to_vec(&crate::fork_promotion::PromotionAdmissionTicketV1 {
            schema_version: 1,
            ticket_identity: crate::commit_envelope::OperationIdentityV1 {
                schema_version: 1,
                key: crate::commit_envelope::OperationKeyV1 {
                    stream_id: stream.clone(),
                    originator_class: crate::commit_envelope::OperationOriginatorClassV1::Host,
                    operation_id: "host:reservation-gate-test".to_owned(),
                },
                issuance: crate::commit_envelope::OperationIssuanceV1::HostIncarnation {
                    epoch_id: "host-epoch-reservation-gate-test".to_owned(),
                    upstream_identity: "reservation-gate-test".to_owned(),
                    commit_ordinal: 0,
                    authority_authenticator_digest: format!("sha256:{}", "a".repeat(64)),
                },
                bound_facts: crate::commit_envelope::OperationBoundFactsV1 {
                    audience: "app-reservation-gate-test".to_owned(),
                    principal_fingerprint: format!("sha256:{}", "b".repeat(64)),
                    authority_instance_id: "authority-reservation-gate-test".to_owned(),
                    operation_kind: "promotion".to_owned(),
                    function_or_command: "promotion.reserve".to_owned(),
                    input_fingerprint: format!("sha256:{}", "c".repeat(64)),
                },
            },
            canonical_stream_id: stream.clone(),
            branch_id: crate::branches::BranchId("branch-gate-test".to_owned()),
            fifo_sequence: 1,
            initial_queue_position: 1,
            observed_concurrent_forks: 1,
            rebase_budget: 3,
            losses: 2,
            expires_at_ms: i64::MAX,
            contention_policy: crate::fork_promotion::PRODUCTION_PROMOTION_CONTENTION_POLICY_V1,
        })
        .expect("serialize production-shaped ticket");
        db.conn
            .execute(
                "INSERT INTO _snapback_promotion_admission(
                   canonical_stream_id,ticket_id,branch_id,fifo_sequence,
                   ticket_json,state,losses,reserved_until_ms
                 ) VALUES(?1,'host:reservation-gate-test','branch-gate-test',1,?2,'queued',2,?3)",
                params![stream, ticket_json, i64::MAX],
            )
            .expect("install active production reservation");

        let host_plan = db
            .mutation_writes()
            .execute_mutation(&insert_plan(), &HandlerInput::default())
            .expect_err("HostPlan must defer inside its SQLite writer transaction");
        assert_eq!(
            host_plan.diagnostic.code,
            "SNAPBACK_PROMOTION_HEAD_RESERVED"
        );
        let buffered = db
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "buffered-reserved".to_owned(),
                    values: Map::from_iter([("title".to_owned(), json!("reserved"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect_err("buffered writer must defer inside its SQLite writer transaction");
        assert_eq!(buffered.diagnostic.code, "SNAPBACK_PROMOTION_HEAD_RESERVED");
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .expect("no partial writes")
                .total,
            0
        );

        db.conn
            .execute(
                "UPDATE _snapback_promotion_admission SET reserved_until_ms=NULL
                  WHERE ticket_id='host:reservation-gate-test'",
                [],
            )
            .expect("release reservation");
        assert_eq!(
            db.mutation_writes()
                .execute_mutation(&insert_plan(), &HandlerInput::default())
                .expect("HostPlan admitted after release")
                .changes
                .len(),
            2
        );
        assert_eq!(
            db.mutation_writes()
                .commit_buffered_writes(
                    &HandlerInput::default(),
                    vec![BufferedWrite::Insert {
                        table: "items".to_owned(),
                        id: "buffered-admitted".to_owned(),
                        values: Map::from_iter([("title".to_owned(), json!("admitted"))]),
                    }],
                    Vec::new(),
                    Value::Null,
                )
                .expect("buffered writer admitted after release")
                .changes
                .len(),
            1
        );
    }

    #[test]
    fn llp0163_issuance_bearing_host_plan_and_buffered_mutations_share_envelope_choke_point() {
        use crate::commit_envelope::{
            ClientIdentityRangeV1, IdentityEpochStateV1, IdentityEpochV1, OperationIssuanceV1,
            OperationOriginatorClassV1,
        };

        let mut history_schema = schema();
        history_schema.tables[0].history = Some(crate::manifest::HistoryRetentionManifestV1 {
            retain_ms: 60_000,
            max_versions_per_record: 32,
        });
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(history_schema)
            .expect("schema-declared finite history policy");
        let tx = db.conn.transaction().expect("stream authority tx");
        let stream = auth_invalidation::ensure_data_version_stream_in(&tx)
            .expect("initialize operation stream");
        tx.commit().expect("stream authority commit");
        let authenticator = format!("sha256:{}", "a".repeat(64));
        let issued_at_ms = now_millis();
        let input = HandlerInput::default();
        let prototype = ClientMutationIdentity::new("operation-0", "items.insert", &input);
        let audience = prototype.authority_instance_id.clone();
        let tx = db.conn.transaction().expect("operation authority tx");
        crate::operation_ledger::register_epoch_in(
            &tx,
            &IdentityEpochV1 {
                schema_version: 1,
                originator_class: OperationOriginatorClassV1::Client,
                audience: audience.clone(),
                authority_instance_id: audience.clone(),
                epoch_id: "epoch-1".to_owned(),
                epoch_sequence: 1,
                state: IdentityEpochStateV1::Open,
                issued_at_ms,
                terminated_at_ms: None,
                authority_authenticator_digest: authenticator.clone(),
            },
        )
        .expect("epoch");
        crate::operation_ledger::register_client_range_in(
            &tx,
            &ClientIdentityRangeV1 {
                schema_version: 1,
                audience: audience.clone(),
                authority_instance_id: audience.clone(),
                epoch_id: "epoch-1".to_owned(),
                epoch_sequence: 1,
                range_start: 0,
                range_end_exclusive: 2,
                issued_at_ms,
                expires_at_ms: issued_at_ms
                    + crate::operation_ledger::CLIENT_IDENTITY_RANGE_WINDOW_MS_V1,
                authority_authenticator_digest: authenticator.clone(),
            },
        )
        .expect("range");
        tx.commit().expect("operation authority commit");
        db.install_operation_coverage_for_test(
            vec![crate::operation_ledger::ORDINARY_MUTATION_LANE_V1.to_owned()],
            crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1
                .iter()
                .map(|writer| (*writer).to_owned())
                .collect(),
        )
        .expect("coverage");

        let issuance = |counter| OperationIssuanceV1::ClientRange {
            epoch_id: "epoch-1".to_owned(),
            counter,
            range_start: 0,
            range_end_exclusive: 2,
            authority_authenticator_digest: authenticator.clone(),
        };
        let host_plan_identity = prototype.with_operation_issuance(issuance(0));
        let host_plan = db
            .mutation_writes()
            .execute_mutation_idempotent(&insert_plan(), &input, &host_plan_identity)
            .expect("covered HostPlan commit");
        assert_eq!(host_plan.changes.len(), 2);

        let buffered_identity =
            ClientMutationIdentity::new("operation-1", "items.bufferedInsert", &input)
                .with_operation_issuance(issuance(1));
        let buffered = db
            .mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &input,
                BufferedCommitPayload {
                    writes: vec![BufferedWrite::Insert {
                        table: "items".to_owned(),
                        id: "buffered".to_owned(),
                        values: Map::from_iter([("title".to_owned(), json!("buffered"))]),
                    }],
                    sequence_allocations: Vec::new(),
                    membership_plans: Vec::new(),
                    read_dependencies: Vec::new(),
                    result: json!("buffered"),
                    ctx_ledger: CtxAnswerLedger::default(),
                    job_enqueues: Vec::new(),
                    job_producer: None,
                    asset_admissions: Vec::new(),
                    asset_grant_ops: Vec::new(),
                    media_projection_proof: None,
                    expected_media_projection_binding: None,
                },
                Some(&buffered_identity),
                || Ok(()),
                || Ok(()),
            )
            .expect("covered buffered commit");
        assert_eq!(buffered.changes.len(), 1);
        let buffered_row = db
            .query_reads_read()
            .get("items", "buffered")
            .expect("read buffered postimage")
            .expect("buffered row exists");
        let journal_row: String = db
            .conn
            .query_row(
                "SELECT row_json FROM _snapback_changes
                 WHERE table_name='items' AND row_id='buffered'
                 ORDER BY id DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .expect("buffered journal postimage");
        assert_eq!(
            serde_json::from_str::<Value>(&journal_row).expect("journal postimage JSON"),
            buffered_row,
            "the authorized physical write journals the exact app and system-field postimage"
        );
        for field in ["_id", "_version", "_createdAt", "_updatedAt"] {
            assert!(
                buffered_row.get(field).is_some(),
                "journal-complete postimage is missing system field {field}"
            );
        }

        let operations = [&host_plan_identity, &buffered_identity]
            .into_iter()
            .map(|identity| {
                crate::commit_envelope::OperationIdentityV1::from_client_mutation(
                    stream.clone(),
                    audience.clone(),
                    identity
                        .operation_issuance
                        .clone()
                        .expect("issuance retained"),
                    identity,
                    crate::operation_ledger::ORDINARY_MUTATION_LANE_V1,
                )
            })
            .collect::<Vec<_>>();
        for operation in &operations {
            assert!(matches!(
                crate::operation_ledger::lookup_operation(&db.conn, operation)
                    .expect("operation replay lookup"),
                crate::operation_ledger::OperationLookupV1::ExactReplay(_)
            ));
        }
        let envelope_count: u64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM _snapback_commit_envelopes_v1",
                [],
                |row| row.get(0),
            )
            .expect("envelope count");
        assert_eq!(envelope_count, 2);
        let protected_count: u64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM _snapback_operation_protected_detail_v1",
                [],
                |row| row.get(0),
            )
            .expect("protected detail count");
        assert_eq!(
            protected_count, 8,
            "four protected fact classes per envelope"
        );
        let retained_envelopes: String = db
            .conn
            .query_row(
                "SELECT group_concat(envelope_json, '\n') FROM _snapback_commit_envelopes_v1",
                [],
                |row| row.get(0),
            )
            .expect("retained envelope JSON");
        assert!(!retained_envelopes.contains("\"title\":\"one\""));
        assert!(!retained_envelopes.contains("\"title\":\"two\""));
        assert!(!retained_envelopes.contains("\"title\":\"buffered\""));

        let admin = crate::operation_ledger::CurrentExplanationAuthorityV1 {
            audience: audience.clone(),
            principal_fingerprint: String::new(),
            authority_instance_id: String::new(),
            current_artifact_digest: None,
            current_policy_provable: true,
            fact_policy: crate::operation_ledger::ExplanationFactPolicyV1::Unprovable,
            administrative: true,
        };
        let explanation =
            crate::operation_ledger::explain_operation(&db.conn, &operations[0], &admin)
                .expect("authorized protected explanation")
                .expect("operation exists");
        assert_eq!(
            explanation.disposition,
            crate::commit_envelope::ExplanationDispositionV1::Complete
        );
        let detail = explanation
            .detail
            .expect("all retained fact classes project");
        for name in ["readSet", "writeSet", "ctxAnswers", "effects", "receipt"] {
            assert!(
                detail.get(name).is_some(),
                "missing explanation fact {name}"
            );
        }
        let receipt_reference = format!(
            "operation-detail:{}:receipt",
            host_plan_identity.activity_digest()
        );
        db.conn
            .execute(
                "DELETE FROM _snapback_operation_protected_detail_v1
                 WHERE custody_reference=?1",
                [&receipt_reference],
            )
            .expect("remove protected receipt fixture");
        assert_eq!(
            crate::operation_ledger::explain_operation(&db.conn, &operations[0], &admin)
                .expect("fail-closed explanation")
                .expect("operation remains")
                .disposition,
            crate::commit_envelope::ExplanationDispositionV1::ProtectedCustodyUnavailable
        );
        let history_operation_ids = db
            .conn
            .prepare(
                "SELECT operation_id FROM _snapback_record_history_v1
                  WHERE table_name='items' ORDER BY version,id",
            )
            .expect("history query")
            .query_map([], |row| row.get::<_, Option<String>>(0))
            .expect("history rows")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("history identities");
        assert_eq!(
            history_operation_ids,
            vec![
                Some("operation-0".to_owned()),
                Some("operation-0".to_owned()),
                Some("operation-1".to_owned()),
            ],
            "history rows join to the covered operation in the same commit"
        );
    }

    #[derive(Clone, Copy, Debug)]
    enum CoveredWriterFixtureV1 {
        HostPlan,
        Buffered,
    }

    fn operation_crash_fixture(
        writer: CoveredWriterFixtureV1,
    ) -> (
        tempfile::TempDir,
        PathBuf,
        LocalDatabase,
        HandlerInput,
        ClientMutationIdentity,
    ) {
        use crate::commit_envelope::OperationIssuanceV1;

        let (dir, path, mut db) = file_database();
        db.install_operation_coverage_for_test(
            vec![crate::operation_ledger::ORDINARY_MUTATION_LANE_V1.to_owned()],
            crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1
                .iter()
                .map(|writer| (*writer).to_owned())
                .collect(),
        )
        .expect("activate test-only ordinary coverage");
        let input = HandlerInput::default();
        let function = match writer {
            CoveredWriterFixtureV1::HostPlan => "items.insert",
            CoveredWriterFixtureV1::Buffered => "items.bufferedInsert",
        };
        let prototype = ClientMutationIdentity::new("operation-crash-0", function, &input);
        let range = db
            .settlement()
            .issue_client_operation_identity_range(
                "crash-fixture-client",
                &prototype.authority_instance_id,
                None,
                now_millis(),
            )
            .expect("server-issued operation range");
        let identity = prototype.with_operation_issuance(OperationIssuanceV1::ClientRange {
            epoch_id: range.epoch_id,
            counter: range.range_start,
            range_start: range.range_start,
            range_end_exclusive: range.range_end_exclusive,
            authority_authenticator_digest: range.authority_authenticator_digest,
        });
        (dir, path, db, input, identity)
    }

    fn execute_operation_crash_fixture(
        db: &mut LocalDatabase,
        writer: CoveredWriterFixtureV1,
        input: &HandlerInput,
        identity: &ClientMutationIdentity,
    ) -> SnapbackResult<MutationCommit> {
        match writer {
            CoveredWriterFixtureV1::HostPlan => {
                db.mutation_writes()
                    .execute_mutation_idempotent(&insert_plan(), input, identity)
            }
            CoveredWriterFixtureV1::Buffered => db
                .mutation_writes()
                .commit_buffered_writes_idempotent_guarded(
                    input,
                    BufferedCommitPayload {
                        writes: vec![BufferedWrite::Insert {
                            table: "items".to_owned(),
                            id: format!("crash-buffered-{}", identity.id),
                            values: Map::from_iter([("title".to_owned(), json!("buffered"))]),
                        }],
                        sequence_allocations: Vec::new(),
                        membership_plans: Vec::new(),
                        read_dependencies: Vec::new(),
                        result: json!({ "receiptSecret": "classified-operation-output" }),
                        ctx_ledger: CtxAnswerLedger::default(),
                        job_enqueues: Vec::new(),
                        job_producer: None,
                        asset_admissions: Vec::new(),
                        asset_grant_ops: Vec::new(),
                        media_projection_proof: None,
                        expected_media_projection_binding: None,
                    },
                    Some(identity),
                    || Ok(()),
                    || Ok(()),
                ),
        }
    }

    fn host_operation_crash_fixture(
        writer: CoveredWriterFixtureV1,
    ) -> (
        tempfile::TempDir,
        PathBuf,
        LocalDatabase,
        HandlerInput,
        ClientMutationIdentity,
    ) {
        let (dir, path, mut db) = file_database();
        db.install_operation_coverage_for_test(
            vec![crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1.to_owned()],
            crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1
                .iter()
                .map(|writer| (*writer).to_owned())
                .collect(),
        )
        .expect("activate test-only host-child coverage");
        let input = HandlerInput::default();
        let function = match writer {
            CoveredWriterFixtureV1::HostPlan => "items.insert",
            CoveredWriterFixtureV1::Buffered => "items.bufferedInsert",
        };
        let upstream_identity = match writer {
            CoveredWriterFixtureV1::HostPlan => "job:host-crash-plan",
            CoveredWriterFixtureV1::Buffered => "job:host-crash-buffered",
        };
        let issuance = db
            .settlement()
            .host_operation_issuance(
                TEST_CLIENT_MUTATION_AUTHORITY_INSTANCE_ID,
                upstream_identity,
                0,
                now_millis(),
            )
            .expect("server-issued host incarnation");
        let identity = ClientMutationIdentity::for_authority(
            crate::commit_envelope::derive_host_operation_id(upstream_identity, 0),
            function,
            &input,
            TEST_CLIENT_MUTATION_AUTHORITY_INSTANCE_ID,
        )
        .with_operation_issuance(issuance);
        (dir, path, db, input, identity)
    }

    fn execute_host_operation_crash_fixture(
        db: &mut LocalDatabase,
        writer: CoveredWriterFixtureV1,
        input: &HandlerInput,
        identity: &ClientMutationIdentity,
    ) -> SnapbackResult<MutationCommit> {
        match writer {
            CoveredWriterFixtureV1::HostPlan => db
                .mutation_writes()
                .execute_host_mutation_guarded_with_settlement_time(
                    &insert_plan(),
                    input,
                    Some(identity),
                    None,
                    || Ok(()),
                    || Ok(()),
                ),
            CoveredWriterFixtureV1::Buffered => {
                db.mutation_writes().commit_buffered_host_writes_guarded(
                    input,
                    BufferedCommitPayload {
                        writes: vec![BufferedWrite::Insert {
                            table: "items".to_owned(),
                            id: format!("host-crash-buffered-{}", identity.id),
                            values: Map::from_iter([("title".to_owned(), json!("host buffered"))]),
                        }],
                        sequence_allocations: Vec::new(),
                        membership_plans: Vec::new(),
                        read_dependencies: Vec::new(),
                        result: json!({ "receiptSecret": "classified-host-operation-output" }),
                        ctx_ledger: CtxAnswerLedger::default(),
                        job_enqueues: Vec::new(),
                        job_producer: None,
                        asset_admissions: Vec::new(),
                        asset_grant_ops: Vec::new(),
                        media_projection_proof: None,
                        expected_media_projection_binding: None,
                    },
                    Some(identity),
                    || Ok(()),
                    || Ok(()),
                )
            }
        }
    }

    fn assert_operation_commit_absent(db: &LocalDatabase) {
        assert_eq!(db.current_version().expect("version after crash cut"), 0);
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .expect("app rows")
                .total,
            0
        );
        for table in [
            "_snapback_changes",
            "_snapback_client_mutations",
            "_snapback_commit_envelopes_v1",
            "_snapback_operation_suppression_v1",
            "_snapback_operation_protected_detail_v1",
        ] {
            let count: u64 = db
                .conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap_or_else(|error| panic!("count {table}: {error}"));
            assert_eq!(count, 0, "{table} must roll back at every crash cut");
        }
    }

    #[test]
    fn llp0162_ordinary_writers_are_atomic_at_every_envelope_crash_cut_and_after_reopen() {
        let points = [
            OperationEnvelopeCrashPointV1::BeforeSettlement,
            OperationEnvelopeCrashPointV1::AfterSettlementBeforeEnvelope,
            OperationEnvelopeCrashPointV1::AfterEnvelopeBeforeCommit,
        ];
        for writer in [
            CoveredWriterFixtureV1::HostPlan,
            CoveredWriterFixtureV1::Buffered,
        ] {
            for point in points {
                let (_dir, path, mut db, input, identity) = operation_crash_fixture(writer);
                inject_operation_envelope_crash_for_test(point);
                let error = execute_operation_crash_fixture(&mut db, writer, &input, &identity)
                    .expect_err("injected crash cut must roll back the covered commit");
                assert_eq!(error.diagnostic.code, "SNAPBACK_TEST_OPERATION_CRASH_CUT");
                drop(db);
                let reopened = LocalDatabase::open(&path).expect("reopen after crash cut");
                assert_operation_commit_absent(&reopened);
            }

            let (_dir, path, mut db, input, identity) = operation_crash_fixture(writer);
            let committed = execute_operation_crash_fixture(&mut db, writer, &input, &identity)
                .expect("complete covered commit");
            assert!(!committed.changes.is_empty());
            let expected = committed.output;
            drop(db);
            let mut reopened = LocalDatabase::open(&path).expect("reopen committed database");
            let replay = execute_operation_crash_fixture(&mut reopened, writer, &input, &identity)
                .expect("exact replay after process restart");
            assert!(replay.changes.is_empty());
            assert_eq!(replay.output, expected);
            assert_eq!(
                reopened
                    .conn
                    .query_row(
                        "SELECT COUNT(*) FROM _snapback_commit_envelopes_v1",
                        [],
                        |row| row.get::<_, u64>(0),
                    )
                    .expect("one complete envelope"),
                1
            );
        }
    }

    #[test]
    fn llp0163_host_writers_are_atomic_at_every_envelope_crash_cut_and_after_reopen() {
        let points = [
            OperationEnvelopeCrashPointV1::BeforeSettlement,
            OperationEnvelopeCrashPointV1::AfterSettlementBeforeEnvelope,
            OperationEnvelopeCrashPointV1::AfterEnvelopeBeforeCommit,
        ];
        for writer in [
            CoveredWriterFixtureV1::HostPlan,
            CoveredWriterFixtureV1::Buffered,
        ] {
            for point in points {
                let (_dir, path, mut db, input, identity) = host_operation_crash_fixture(writer);
                inject_operation_envelope_crash_for_test(point);
                let error =
                    execute_host_operation_crash_fixture(&mut db, writer, &input, &identity)
                        .expect_err("injected crash cut must roll back the host-child commit");
                assert_eq!(error.diagnostic.code, "SNAPBACK_TEST_OPERATION_CRASH_CUT");
                drop(db);
                let reopened = LocalDatabase::open(&path).expect("reopen after host crash cut");
                assert_operation_commit_absent(&reopened);
            }

            let (_dir, path, mut db, input, identity) = host_operation_crash_fixture(writer);
            let committed =
                execute_host_operation_crash_fixture(&mut db, writer, &input, &identity)
                    .expect("complete covered host-child commit");
            assert!(!committed.changes.is_empty());
            let expected = committed.output;
            drop(db);
            let mut reopened =
                LocalDatabase::open(&path).expect("reopen committed host-child database");
            let replay =
                execute_host_operation_crash_fixture(&mut reopened, writer, &input, &identity)
                    .expect("exact host-child replay after process restart");
            assert!(replay.changes.is_empty());
            assert_eq!(replay.output, expected);
            let envelopes = reopened
                .settlement_read()
                .operation_envelopes_for_test()
                .expect("read retained host-child envelopes");
            assert_eq!(envelopes.len(), 1);
            let envelope = &envelopes[0];
            assert_eq!(
                envelope.identity.key.originator_class,
                crate::commit_envelope::OperationOriginatorClassV1::Host
            );
        }
    }

    #[test]
    fn covered_replay_opens_protected_receipt_without_plaintext_in_suppression_json() {
        use crate::commit_envelope::{OperationSuppressionRecordV1, RetainedEnvelopeDetailV1};

        let (_dir, path, mut db, input, identity) =
            operation_crash_fixture(CoveredWriterFixtureV1::Buffered);
        let committed = execute_operation_crash_fixture(
            &mut db,
            CoveredWriterFixtureV1::Buffered,
            &input,
            &identity,
        )
        .expect("covered operation with protected receipt");
        assert_eq!(
            committed.output.result,
            json!({ "receiptSecret": "classified-operation-output" })
        );
        let suppression_json: String = db
            .conn
            .query_row(
                "SELECT record_json FROM _snapback_operation_suppression_v1
                  WHERE operation_id=?1",
                params![identity.id],
                |row| row.get(0),
            )
            .expect("suppression JSON");
        assert!(
            !suppression_json.contains("classified-operation-output"),
            "secret-bearing receipt plaintext belongs only in protected custody"
        );
        let suppression: OperationSuppressionRecordV1 =
            serde_json::from_str(&suppression_json).expect("decode suppression projection");
        assert!(matches!(
            serde_json::from_value::<RetainedEnvelopeDetailV1>(suppression.receipt_payload)
                .expect("decode retained receipt projection"),
            RetainedEnvelopeDetailV1::ProtectedLane { .. }
        ));

        let expected = committed.output;
        drop(db);
        let reopened = LocalDatabase::open(&path).expect("reopen protected receipt custody");
        // Simulate loss/reclamation of only the predecessor settlement row;
        // the LLP 0163 lookup is authoritative after process restart and opens
        // the digest-bound protected receipt without redispatching the writer.
        reopened
            .conn
            .execute(
                "DELETE FROM _snapback_client_mutations WHERE client_mutation_id=?1",
                params![identity.id],
            )
            .expect("remove predecessor replay row fixture");
        let recovered = reopened
            .settlement_read()
            .client_mutation_result(&identity)
            .expect("protected operation lookup")
            .expect("exact protected replay");
        assert_eq!(recovered, expected);
        assert_eq!(
            reopened
                .query_reads_read()
                .scan_table("items", 10, 0)
                .expect("unchanged app rows")
                .total,
            1,
            "exact fallback replay never redispatches the write"
        );
    }

    #[test]
    fn covered_capacity_ack_and_floor_lifecycle_never_reexecutes_an_ambiguous_identity() {
        use crate::commit_envelope::{OperationIssuanceV1, OperationOriginatorClassV1};

        let (_dir, _path, mut db, input, first) =
            operation_crash_fixture(CoveredWriterFixtureV1::Buffered);
        let OperationIssuanceV1::ClientRange {
            epoch_id,
            counter,
            range_start,
            range_end_exclusive,
            authority_authenticator_digest,
        } = first
            .operation_issuance
            .clone()
            .expect("first range issuance")
        else {
            panic!("client fixture must carry range issuance");
        };
        let second =
            ClientMutationIdentity::new("operation-delayed-1", "items.bufferedInsert", &input)
                .with_operation_issuance(OperationIssuanceV1::ClientRange {
                    epoch_id: epoch_id.clone(),
                    counter: counter + 1,
                    range_start,
                    range_end_exclusive,
                    authority_authenticator_digest: authority_authenticator_digest.clone(),
                });

        let limits = TestRetentionLimits::install(1, u64::MAX);
        let first_commit = execute_operation_crash_fixture(
            &mut db,
            CoveredWriterFixtureV1::Buffered,
            &input,
            &first,
        )
        .expect("first covered settlement fills bounded retention");
        let full = execute_operation_crash_fixture(
            &mut db,
            CoveredWriterFixtureV1::Buffered,
            &input,
            &second,
        )
        .expect_err("unacknowledged retention refuses new work");
        assert_eq!(
            full.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL"
        );
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .expect("one retained write")
                .total,
            1
        );
        let replay = execute_operation_crash_fixture(
            &mut db,
            CoveredWriterFixtureV1::Buffered,
            &input,
            &first,
        )
        .expect("full capacity cannot evict exact replay");
        assert!(replay.changes.is_empty());
        assert_eq!(replay.output, first_commit.output);
        drop(limits);

        assert_eq!(
            db.settlement()
                .acknowledge_client_mutations(
                    &first.auth_fingerprint,
                    std::slice::from_ref(&first.id),
                )
                .expect("durable ACK reclaims full result"),
            1
        );
        let expired = db
            .settlement_read()
            .client_mutation_result(&first)
            .expect_err("ACKed covered result keeps a compact duplicate barrier");
        assert_eq!(expired.diagnostic.code, "SNAPBACK_OPERATION_RESULT_EXPIRED");
        assert_eq!(expired.diagnostic.details["outcome"], "committed");

        let (audience, expires_at_ms): (String, u64) = db
            .conn
            .query_row(
                "SELECT audience,expires_at_ms FROM _snapback_operation_ranges_v1
                  WHERE epoch_id=?1 AND range_start=?2 AND range_end_exclusive=?3",
                params![epoch_id, range_start as i64, range_end_exclusive as i64],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("range lifecycle facts");
        let stream_id = crate::seed_identity::strict_current_data_version_stream(&db.conn)
            .expect("operation stream lookup")
            .expect("operation stream");
        let first_operation = crate::commit_envelope::OperationIdentityV1::from_client_mutation(
            stream_id,
            audience.clone(),
            first.operation_issuance.clone().expect("first issuance"),
            &first,
            crate::operation_ledger::ORDINARY_MUTATION_LANE_V1,
        );
        let tx = db.conn.transaction().expect("retire identity epoch");
        crate::operation_ledger::terminate_epoch_in(
            &tx,
            OperationOriginatorClassV1::Client,
            &audience,
            &epoch_id,
            false,
            expires_at_ms,
        )
        .expect("terminate client epoch");
        assert!(
            crate::operation_ledger::close_epoch_if_complete_in(
                &tx,
                OperationOriginatorClassV1::Client,
                &audience,
                &epoch_id,
                expires_at_ms + 1,
            )
            .expect("close fully acknowledged epoch")
        );
        assert!(
            crate::operation_ledger::prune_compact_envelope_in(&tx, &first_operation)
                .expect("independent compact-envelope retention expiry")
        );
        tx.commit().expect("commit identity floor advancement");

        for (label, identity) in [
            ("previously-committed", &first),
            ("delayed-first-delivery", &second),
        ] {
            let horizon = match execute_operation_crash_fixture(
                &mut db,
                CoveredWriterFixtureV1::Buffered,
                &input,
                identity,
            ) {
                Err(error) => error,
                Ok(output) => panic!("{label} below-floor identity executed: {output:?}"),
            };
            assert_eq!(
                horizon.diagnostic.code, "SNAPBACK_OPERATION_IDENTITY_HORIZON_PASSED",
                "{label} must surface outcome-unknown"
            );
            assert_eq!(horizon.diagnostic.details["outcome"], "unknown");
            assert_eq!(horizon.diagnostic.details["terminal"], false);
        }
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .expect("no below-floor write")
                .total,
            1
        );
    }

    #[test]
    fn llp0163_writer_lane_coverage_is_explicit_and_asymmetric() {
        use crate::commit_envelope::OperationIssuanceV1;

        fn database_with_lanes(lanes: &[&str]) -> LocalDatabase {
            let mut db = LocalDatabase::memory().expect("memory database");
            db.schema_seed()
                .apply_schema(schema())
                .expect("apply writer fixture schema");
            let mut covered_lanes = lanes
                .iter()
                .map(|lane| (*lane).to_owned())
                .collect::<Vec<_>>();
            covered_lanes.sort();
            let mut writers = Vec::new();
            if covered_lanes
                .iter()
                .any(|lane| lane == crate::operation_ledger::ORDINARY_MUTATION_LANE_V1)
            {
                writers.extend(
                    crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1
                        .iter()
                        .map(|writer| (*writer).to_owned()),
                );
            }
            if covered_lanes
                .iter()
                .any(|lane| lane == crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1)
            {
                writers.extend(
                    crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1
                        .iter()
                        .map(|writer| (*writer).to_owned()),
                );
            }
            writers.sort();
            db.install_operation_coverage_for_test(covered_lanes, writers)
                .expect("register explicit coverage");
            db
        }

        fn identity(issuance: OperationIssuanceV1) -> ClientMutationIdentity {
            ClientMutationIdentity::new("operation-1", "items.insert", &HandlerInput::default())
                .with_operation_issuance(issuance)
        }

        fn client_identity() -> ClientMutationIdentity {
            identity(OperationIssuanceV1::ClientRange {
                epoch_id: "client-epoch".to_owned(),
                counter: 0,
                range_start: 0,
                range_end_exclusive: 1,
                authority_authenticator_digest: format!("sha256:{}", "c".repeat(64)),
            })
        }

        fn host_identity() -> ClientMutationIdentity {
            identity(OperationIssuanceV1::HostIncarnation {
                epoch_id: "host-epoch".to_owned(),
                upstream_identity: "job:fixture".to_owned(),
                commit_ordinal: 0,
                authority_authenticator_digest: format!("sha256:{}", "h".repeat(64)),
            })
        }

        fn refusal_code(
            db: &LocalDatabase,
            lane: CoveredMutationLaneV1,
            identity: Option<&ClientMutationIdentity>,
        ) -> &'static str {
            match require_covered_mutation_identity_for_lane(&db.conn, lane, identity)
                .expect_err("covered lane must refuse this carrier")
                .diagnostic
                .code
                .as_str()
            {
                "SNAPBACK_OPERATION_IDENTITY_REQUIRED" => "SNAPBACK_OPERATION_IDENTITY_REQUIRED",
                "SNAPBACK_OPERATION_WRITER_IDENTITY_MISMATCH" => {
                    "SNAPBACK_OPERATION_WRITER_IDENTITY_MISMATCH"
                }
                other => panic!("unexpected writer-lane refusal {other}"),
            }
        }

        let client = client_identity();
        let host = host_identity();

        let mut ordinary_only =
            database_with_lanes(&[crate::operation_ledger::ORDINARY_MUTATION_LANE_V1]);
        assert_eq!(
            refusal_code(&ordinary_only, CoveredMutationLaneV1::Ordinary, None),
            "SNAPBACK_OPERATION_IDENTITY_REQUIRED"
        );
        require_covered_mutation_identity_for_lane(
            &ordinary_only.conn,
            CoveredMutationLaneV1::HostChild,
            None,
        )
        .expect("identityless uncovered host lane remains available");
        require_covered_mutation_identity_for_lane(
            &ordinary_only.conn,
            CoveredMutationLaneV1::Ordinary,
            Some(&client),
        )
        .expect("ordinary issuance matches ordinary-only coverage");
        assert_eq!(
            refusal_code(&ordinary_only, CoveredMutationLaneV1::Ordinary, Some(&host),),
            "SNAPBACK_OPERATION_WRITER_IDENTITY_MISMATCH"
        );
        let host_authority = TEST_CLIENT_MUTATION_AUTHORITY_INSTANCE_ID;
        let host_issuance = ordinary_only
            .settlement()
            .host_operation_issuance(host_authority, "job:fixture", 0, now_millis())
            .expect("server-recorded host incarnation");
        let host_input = HandlerInput::default();
        let host_for_hook = ClientMutationIdentity::for_authority(
            crate::commit_envelope::derive_host_operation_id("job:fixture", 0),
            "items.insert",
            &host_input,
            host_authority,
        )
        .with_operation_issuance(host_issuance);
        assert_eq!(
            ordinary_only
                .mutation_writes()
                .execute_host_mutation_guarded(
                    &insert_plan(),
                    &host_input,
                    Some(&host_for_hook),
                    || Ok(()),
                    || Ok(()),
                )
                .expect_err("ordinary-only manifest must reject a host envelope")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_WRITER_IDENTITY_MISMATCH"
        );
        assert_eq!(
            ordinary_only
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_commit_envelopes_v1",
                    [],
                    |row| row.get::<_, u64>(0),
                )
                .expect("envelope count after manifest-lane refusal"),
            0,
            "manifest-lane refusal rolls back data and envelope together"
        );

        let host_only =
            database_with_lanes(&[crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1]);
        assert_eq!(
            refusal_code(&host_only, CoveredMutationLaneV1::HostChild, None),
            "SNAPBACK_OPERATION_IDENTITY_REQUIRED"
        );
        require_covered_mutation_identity_for_lane(
            &host_only.conn,
            CoveredMutationLaneV1::Ordinary,
            None,
        )
        .expect("identityless uncovered ordinary lane remains available");
        require_covered_mutation_identity_for_lane(
            &host_only.conn,
            CoveredMutationLaneV1::HostChild,
            Some(&host),
        )
        .expect("host issuance matches host-only coverage");
        assert_eq!(
            refusal_code(&host_only, CoveredMutationLaneV1::HostChild, Some(&client),),
            "SNAPBACK_OPERATION_WRITER_IDENTITY_MISMATCH"
        );

        let mut both = database_with_lanes(&[
            crate::operation_ledger::ORDINARY_MUTATION_LANE_V1,
            crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1,
        ]);
        assert_eq!(
            refusal_code(&both, CoveredMutationLaneV1::Ordinary, None),
            "SNAPBACK_OPERATION_IDENTITY_REQUIRED"
        );
        assert_eq!(
            refusal_code(&both, CoveredMutationLaneV1::HostChild, None),
            "SNAPBACK_OPERATION_IDENTITY_REQUIRED"
        );
        require_covered_mutation_identity_for_lane(
            &both.conn,
            CoveredMutationLaneV1::Ordinary,
            Some(&client),
        )
        .expect("ordinary issuance matches combined coverage");
        require_covered_mutation_identity_for_lane(
            &both.conn,
            CoveredMutationLaneV1::HostChild,
            Some(&host),
        )
        .expect("host issuance matches combined coverage");

        let buffered_upstream = "job:buffered-fixture";
        let buffered_issuance = both
            .settlement()
            .host_operation_issuance(
                TEST_CLIENT_MUTATION_AUTHORITY_INSTANCE_ID,
                buffered_upstream,
                0,
                now_millis(),
            )
            .expect("server-recorded buffered host incarnation");
        let buffered_input = HandlerInput::default();
        let buffered_identity = ClientMutationIdentity::for_authority(
            crate::commit_envelope::derive_host_operation_id(buffered_upstream, 0),
            "items.bufferedInsert",
            &buffered_input,
            TEST_CLIENT_MUTATION_AUTHORITY_INSTANCE_ID,
        )
        .with_operation_issuance(buffered_issuance);
        let buffered_payload = || BufferedCommitPayload {
            writes: vec![BufferedWrite::Insert {
                table: "items".to_owned(),
                id: "host-buffered".to_owned(),
                values: Map::from_iter([("title".to_owned(), json!("host buffered"))]),
            }],
            sequence_allocations: Vec::new(),
            membership_plans: Vec::new(),
            read_dependencies: Vec::new(),
            result: json!("host buffered"),
            ctx_ledger: CtxAnswerLedger::default(),
            job_enqueues: Vec::new(),
            job_producer: None,
            asset_admissions: Vec::new(),
            asset_grant_ops: Vec::new(),
            media_projection_proof: None,
            expected_media_projection_binding: None,
        };
        let first_buffered = both
            .mutation_writes()
            .commit_buffered_host_writes_guarded(
                &buffered_input,
                buffered_payload(),
                Some(&buffered_identity),
                || Ok(()),
                || Ok(()),
            )
            .expect("covered buffered host child commit");
        assert_eq!(first_buffered.changes.len(), 1);
        let replayed_buffered = both
            .mutation_writes()
            .commit_buffered_host_writes_guarded(
                &buffered_input,
                buffered_payload(),
                Some(&buffered_identity),
                || Ok(()),
                || Ok(()),
            )
            .expect("buffered host child exact replay");
        assert!(replayed_buffered.changes.is_empty());
        let envelopes = both
            .settlement_read()
            .operation_envelopes_for_test()
            .expect("retained buffered host envelope");
        assert_eq!(envelopes.len(), 1);
        assert_eq!(
            envelopes[0].identity.key.originator_class,
            crate::commit_envelope::OperationOriginatorClassV1::Host
        );
    }

    #[test]
    fn llp0163_host_retry_capacity_purge_and_rotation_use_the_real_writer() {
        use crate::commit_envelope::{
            IdentityEpochStateV1, IdentityEpochV1, OperationIssuanceV1, OperationOriginatorClassV1,
        };

        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(schema())
            .expect("apply writer fixture schema");
        db.install_operation_coverage_for_test(
            vec![crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1.to_owned()],
            crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1
                .iter()
                .map(|writer| (*writer).to_owned())
                .collect(),
        )
        .expect("activate the production host-child writer lane");

        let authority = TEST_CLIENT_MUTATION_AUTHORITY_INSTANCE_ID;
        let issued_at_ms = now_millis();
        let first_upstream = "job:host-lifecycle-first";
        let first_issuance = db
            .settlement()
            .host_operation_issuance(authority, first_upstream, 0, issued_at_ms)
            .expect("server-issued host identity");
        let input = HandlerInput::default();
        let first = ClientMutationIdentity::for_authority(
            crate::commit_envelope::derive_host_operation_id(first_upstream, 0),
            "items.insert",
            &input,
            authority,
        )
        .with_operation_issuance(first_issuance.clone());
        let second_upstream = "job:host-lifecycle-delayed";
        let second = ClientMutationIdentity::for_authority(
            crate::commit_envelope::derive_host_operation_id(second_upstream, 0),
            "items.insert",
            &input,
            authority,
        )
        .with_operation_issuance(match &first_issuance {
            OperationIssuanceV1::HostIncarnation {
                epoch_id,
                authority_authenticator_digest,
                ..
            } => OperationIssuanceV1::HostIncarnation {
                epoch_id: epoch_id.clone(),
                upstream_identity: second_upstream.to_owned(),
                commit_ordinal: 0,
                authority_authenticator_digest: authority_authenticator_digest.clone(),
            },
            OperationIssuanceV1::ClientRange { .. } => {
                panic!("host issuance must be range-less")
            }
        });

        let limits = TestRetentionLimits::install(1, u64::MAX);
        let committed = db
            .mutation_writes()
            .execute_host_mutation_guarded(
                &insert_plan(),
                &input,
                Some(&first),
                || Ok(()),
                || Ok(()),
            )
            .expect("first host child fills bounded settlement custody");
        let exact_retry = db
            .mutation_writes()
            .execute_host_mutation_guarded(
                &insert_plan(),
                &input,
                Some(&first),
                || Ok(()),
                || Ok(()),
            )
            .expect("exact host retry survives full custody");
        assert!(exact_retry.changes.is_empty());
        assert_eq!(exact_retry.output, committed.output);
        let full = db
            .mutation_writes()
            .execute_host_mutation_guarded(
                &insert_plan(),
                &input,
                Some(&second),
                || Ok(()),
                || Ok(()),
            )
            .expect_err("full custody refuses a novel host operation");
        assert_eq!(
            full.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL"
        );
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .expect("only one host plan ran")
                .total,
            2
        );
        drop(limits);

        assert_eq!(
            db.settlement()
                .purge_client_mutation_settlements(Some(&first.auth_fingerprint))
                .expect("operator purge removes predecessor full-result custody"),
            1
        );
        let replay_after_purge = db
            .mutation_writes()
            .execute_host_mutation_guarded(
                &insert_plan(),
                &input,
                Some(&first),
                || Ok(()),
                || Ok(()),
            )
            .expect("host suppression is not selected by client operator purge");
        assert!(replay_after_purge.changes.is_empty());
        assert_eq!(replay_after_purge.output, committed.output);

        let (audience, retired_epoch_id, retired_sequence): (String, String, u64) = db
            .conn
            .query_row(
                "SELECT audience,epoch_id,epoch_sequence
                   FROM _snapback_operation_epochs_v1
                  WHERE originator_class='host' AND authority_instance_id=?1
                    AND state='open'",
                [authority],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        u64::try_from(row.get::<_, i64>(2)?).expect("nonnegative sequence"),
                    ))
                },
            )
            .expect("current host incarnation");
        let rotated_at_ms = issued_at_ms.saturating_add(1);
        let successor_authority =
            crate::ids::mint_time_ordered(crate::ids::Kind::AuthorityInstance);
        let tx = db.conn.transaction().expect("host incarnation rotation");
        crate::operation_ledger::rotate_host_incarnation_in(
            &tx,
            &audience,
            &retired_epoch_id,
            &IdentityEpochV1 {
                schema_version: 1,
                originator_class: OperationOriginatorClassV1::Host,
                audience: audience.clone(),
                authority_instance_id: successor_authority,
                epoch_id: "host-epoch-lifecycle-2".to_owned(),
                epoch_sequence: retired_sequence + 1,
                state: IdentityEpochStateV1::Open,
                issued_at_ms: rotated_at_ms,
                terminated_at_ms: None,
                authority_authenticator_digest: format!("sha256:{}", "e".repeat(64)),
            },
            rotated_at_ms,
        )
        .expect("rotate to a distinct server authority");
        tx.commit().expect("commit host incarnation rotation");

        let replay_after_rotation = db
            .mutation_writes()
            .execute_host_mutation_guarded(
                &insert_plan(),
                &input,
                Some(&first),
                || Ok(()),
                || Ok(()),
            )
            .expect("settled retry remains replayable after authority rotation");
        assert!(replay_after_rotation.changes.is_empty());
        assert_eq!(replay_after_rotation.output, committed.output);
        let delayed = db
            .mutation_writes()
            .execute_host_mutation_guarded(
                &insert_plan(),
                &input,
                Some(&second),
                || Ok(()),
                || Ok(()),
            )
            .expect_err("delayed first delivery under the retired authority must refuse");
        assert_eq!(
            delayed.diagnostic.code,
            "SNAPBACK_OPERATION_ISSUANCE_AUTH_INVALID"
        );
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .expect("no delayed host write")
                .total,
            2
        );
    }

    #[test]
    fn llp0162_sqlite_writer_authority_denies_bypass_and_projects_effective_gaps() {
        fn authorization_denied(error: &rusqlite::Error) -> bool {
            matches!(
                error,
                rusqlite::Error::SqliteFailure(failure, _)
                    if failure.code == rusqlite::ErrorCode::AuthorizationForStatementDenied
            )
        }

        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(schema())
            .expect("apply writer fixture schema");
        db.conn
            .execute_batch(
                "CREATE TRIGGER raw_system_to_app_bypass
                 AFTER INSERT ON _snapback_meta
                 BEGIN
                   UPDATE items SET _version = _version + 1;
                 END;",
            )
            .expect("install pre-coverage trigger fixture");
        db.install_operation_coverage_for_test(
            vec![crate::operation_ledger::ORDINARY_MUTATION_LANE_V1.to_owned()],
            crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1
                .iter()
                .map(|writer| (*writer).to_owned())
                .collect(),
        )
        .expect("activate ordinary writer fixture");

        let direct_insert = db
            .conn
            .execute(
                "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title)
                 VALUES('raw',1,1,1,'raw')",
                [],
            )
            .expect_err("raw insert must be denied by SQLite");
        assert!(authorization_denied(&direct_insert));

        let cached_sql = "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title) \
             VALUES('cached',1,1,1,'cached')";
        {
            let _token = db
                .writer_authority
                .enter(write_authority::LocalWriterLaneV1::OrdinaryHostPlan)
                .expect("generated writer token");
            let statement = db
                .conn
                .prepare_cached(cached_sql)
                .expect("prepare covered write while token is live");
            drop(statement);
        }
        let cached_escape = match db.conn.prepare_cached(cached_sql) {
            Ok(_) => panic!("a statement prepared under a dropped token escaped reauthorization"),
            Err(error) => error,
        };
        assert!(authorization_denied(&cached_escape));

        let system_field = db
            .conn
            .execute("UPDATE items SET _version = 9 WHERE _id='raw'", [])
            .expect_err("raw system-field patch must be denied by SQLite");
        assert!(authorization_denied(&system_field));
        let trigger_bypass = db
            .conn
            .execute(
                "INSERT INTO _snapback_meta(key,value) VALUES('writer-trigger','1')",
                [],
            )
            .expect_err("trigger-mediated app write must be denied by SQLite");
        assert!(authorization_denied(&trigger_bypass));
        let trigger_inside_token = {
            let _token = db
                .writer_authority
                .enter(write_authority::LocalWriterLaneV1::OrdinaryHostPlan)
                .expect("generated writer token");
            db.conn
                .execute(
                    "INSERT INTO _snapback_meta(key,value) VALUES('writer-trigger-token','1')",
                    [],
                )
                .expect_err("a token cannot bless an unjournaled trigger app-write")
        };
        assert!(authorization_denied(&trigger_inside_token));
        let schema_bypass = db
            .conn
            .execute("ALTER TABLE items ADD COLUMN rawBypass TEXT", [])
            .expect_err("raw covered schema change must be denied by SQLite");
        assert!(authorization_denied(&schema_bypass));
        assert_eq!(
            db.conn
                .query_row("SELECT COUNT(*) FROM items", [], |row| row.get::<_, u64>(0))
                .expect("bypass rollback count"),
            0
        );
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_meta
                     WHERE key IN ('writer-trigger','writer-trigger-token')",
                    [],
                    |row| row.get::<_, u64>(0),
                )
                .expect("trigger source rollback count"),
            0,
            "the source system write rolls back with its denied trigger target"
        );

        let inventory = db
            .local_writer_coverage_inventory_for_test()
            .expect("closed local writer inventory");
        assert_eq!(inventory.schema_version, 1);
        assert!(inventory.all_physical_writers_enumerated);
        assert!(inventory.all_app_effective_writers_accounted);
        assert_eq!(
            inventory.entries.len(),
            write_authority::LocalWriterLaneV1::ALL.len(),
            "every closed writer enum member has exactly one inventory row"
        );
        for writer in [
            write_authority::LocalWriterLaneV1::OrdinaryHostPlan,
            write_authority::LocalWriterLaneV1::OrdinaryIbexBuffered,
        ] {
            let entry = inventory
                .entries
                .iter()
                .find(|entry| entry.choke_point == writer.choke_point())
                .expect("ordinary writer inventory row");
            assert!(entry.target_supported && entry.app_effective);
            assert!(entry.declared_covered && entry.envelope_mapped);
            assert!(entry.write_authority_enforced);
        }
        for writer in [
            write_authority::LocalWriterLaneV1::HostChildHostPlan,
            write_authority::LocalWriterLaneV1::HostChildIbexBuffered,
        ] {
            let entry = inventory
                .entries
                .iter()
                .find(|entry| entry.choke_point == writer.choke_point())
                .expect("mapped but undeclared host writer inventory row");
            assert!(entry.target_supported && entry.app_effective);
            assert!(!entry.declared_covered);
            assert!(entry.envelope_mapped);
            assert!(entry.exclusion_reason.is_none());
        }
        for writer in [
            write_authority::LocalWriterLaneV1::SchemaActivation,
            write_authority::LocalWriterLaneV1::MigrationExecutor,
            write_authority::LocalWriterLaneV1::ResetAndSeed,
            write_authority::LocalWriterLaneV1::StandaloneSeed,
            write_authority::LocalWriterLaneV1::StrictPromotionReexecution,
        ] {
            let entry = inventory
                .entries
                .iter()
                .find(|entry| entry.choke_point == writer.choke_point())
                .expect("effective uncovered writer inventory row");
            assert!(entry.target_supported && entry.app_effective);
            assert!(!entry.declared_covered);
            assert!(!entry.envelope_mapped);
            assert!(entry.exclusion_reason.is_some());
        }
        assert!(
            !inventory.all_app_effective_writers_covered,
            "ordinary-only target support must not upcast app-effective coverage"
        );
        assert!(inventory.entries.iter().all(|entry| {
            entry.physically_enumerated
                && (entry.envelope_mapped != entry.exclusion_reason.is_some())
        }));
        for writer in [
            write_authority::LocalWriterLaneV1::AuthCatalog,
            write_authority::LocalWriterLaneV1::AdminControl,
            write_authority::LocalWriterLaneV1::AssetCatalog,
            write_authority::LocalWriterLaneV1::SearchIndex,
            write_authority::LocalWriterLaneV1::VectorIndex,
            write_authority::LocalWriterLaneV1::PushRegistry,
            write_authority::LocalWriterLaneV1::JobAndCronState,
            write_authority::LocalWriterLaneV1::JournalMaintenance,
            write_authority::LocalWriterLaneV1::OperationLedger,
            write_authority::LocalWriterLaneV1::HistoryAndCheckpoint,
            write_authority::LocalWriterLaneV1::BranchRegistry,
        ] {
            let entry = inventory
                .entries
                .iter()
                .find(|entry| entry.choke_point == writer.choke_point())
                .expect("enumerated system writer row");
            assert!(entry.target_supported && !entry.app_effective);
            assert!(entry.exclusion_reason.is_some());
        }
    }

    #[test]
    fn llp0165_armed_connection_is_defensive_default_deny_and_schema_alias_safe() {
        fn assert_authorization_denied(result: rusqlite::Result<usize>, operation: &str) {
            let error = match result {
                Ok(_) => panic!("{operation} unexpectedly succeeded"),
                Err(error) => error,
            };
            assert!(
                matches!(
                    error,
                    rusqlite::Error::SqliteFailure(failure, _)
                        if failure.code == rusqlite::ErrorCode::AuthorizationForStatementDenied
                ),
                "{operation} returned {error:?}"
            );
        }

        let mut db = LocalDatabase::memory().expect("armed adversarial database");
        db.schema_seed()
            .apply_schema(schema())
            .expect("apply adversarial schema");
        db.conn
            .execute_batch("CREATE TABLE prearmed_escape(value TEXT)")
            .expect("create unknown pre-arm table fixture");
        db.activate_local_target_operation_coverage(1)
            .expect("arm local writer authority");
        assert!(
            db.conn
                .db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_DEFENSIVE)
                .expect("read defensive mode"),
            "the armed connection verifies SQLITE_DBCONFIG_DEFENSIVE"
        );

        assert_authorization_denied(
            db.conn.execute("PRAGMA writable_schema = ON", []),
            "writable_schema pragma",
        );
        for alias in ["sqlite_schema", "sqlite_master"] {
            assert!(
                db.conn
                    .execute(
                        &format!("UPDATE {alias} SET name='items_alias' WHERE name='items'"),
                        [],
                    )
                    .is_err(),
                "defensive mode must refuse schema alias mutation through {alias}",
            );
        }
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT name FROM sqlite_schema WHERE type='table' AND name='items'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("protected schema name remains intact"),
            "items"
        );
        assert_authorization_denied(
            db.conn
                .execute("ATTACH DATABASE ':memory:' AS attached", []),
            "ATTACH",
        );
        assert_authorization_denied(db.conn.execute("DETACH DATABASE main", []), "DETACH");
        for (sql, operation) in [
            (
                "CREATE TEMP TABLE temp_items(value TEXT)",
                "temporary table",
            ),
            (
                "CREATE TEMP VIEW temp_items_view AS SELECT * FROM items",
                "temporary view",
            ),
            (
                "CREATE TEMP TRIGGER temp_items_trigger AFTER INSERT ON items BEGIN SELECT 1; END",
                "temporary trigger",
            ),
            ("CREATE TABLE escaped_items(value TEXT)", "ordinary DDL"),
            (
                "ALTER TABLE items RENAME TO items_alias",
                "covered-table rename",
            ),
        ] {
            assert_authorization_denied(db.conn.execute(sql, []), operation);
        }
        assert_authorization_denied(
            db.conn
                .execute("INSERT INTO prearmed_escape VALUES('raw')", []),
            "unknown pre-arm table DML",
        );

        db.conn
            .execute_batch("SAVEPOINT adversarial")
            .expect("savepoints themselves remain usable");
        assert_authorization_denied(
            db.conn.execute(
                "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title)
                 VALUES('savepoint-bypass',1,1,1,'denied')",
                [],
            ),
            "raw DML inside a savepoint",
        );
        db.conn
            .execute_batch("ROLLBACK TO adversarial; RELEASE adversarial")
            .expect("close adversarial savepoint");

        for (sql, operation) in [
            (
                "INSERT INTO _snapback_changes DEFAULT VALUES",
                "matching-journal forgery",
            ),
            (
                "UPDATE _snapback_version SET version = version + 1",
                "storage-version forgery",
            ),
        ] {
            assert_authorization_denied(db.conn.execute(sql, []), operation);
        }
        assert_eq!(
            db.conn
                .query_row("SELECT COUNT(*) FROM items", [], |row| row.get::<_, u64>(0))
                .expect("adversarial row count"),
            0
        );
    }

    #[test]
    fn llp0165_registered_second_writer_uses_connection_local_defensive_authority() {
        fn denied(result: rusqlite::Result<usize>) -> bool {
            matches!(
                result,
                Err(rusqlite::Error::SqliteFailure(failure, _))
                    if failure.code == rusqlite::ErrorCode::AuthorizationForStatementDenied
            )
        }

        let directory = tempfile::tempdir().expect("registered writer fixture");
        let path = directory.path().join("armed.sqlite3");
        let mut db = LocalDatabase::open(&path).expect("file database");
        db.schema_seed()
            .apply_schema(schema())
            .expect("apply registered writer schema");
        db.activate_local_target_operation_coverage(1)
            .expect("arm registered writer database");

        let second =
            open_registered_system_writer_v1(&path, RegisteredSystemWriterPurposeV1::VectorIndex)
                .expect("open registered vector writer");
        assert!(
            second
                .conn()
                .db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_DEFENSIVE)
                .expect("second writer defensive mode")
        );
        second
            .conn()
            .execute(
                "INSERT INTO _snapback_meta(key,value) VALUES('vector-system-write','1')",
                [],
            )
            .expect("the registered vector token admits its system-table lane");
        assert!(denied(second.conn().execute(
            "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title)
             VALUES('second-bypass',1,1,1,'denied')",
            [],
        )));
        assert!(denied(
            second
                .conn()
                .execute("INSERT INTO _snapback_changes DEFAULT VALUES", [],)
        ));
        assert!(denied(
            second
                .conn()
                .execute("DELETE FROM _snapback_operation_coverage_v1", [],)
        ));
        assert!(denied(second.conn().execute(
            "DELETE FROM _snapback_operation_coverage_continuity_v1",
            [],
        )));
        {
            let _primary_writer = db
                .writer_authority
                .enter(write_authority::LocalWriterLaneV1::OrdinaryHostPlan)
                .expect("enter primary ordinary writer");
            assert!(
                denied(second.conn().execute(
                    "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title)
                     VALUES('vector-bypass',1,1,1,'denied')",
                    [],
                )),
                "a primary token cannot leak authority to a second connection"
            );
            assert!(
                denied(
                    second
                        .conn()
                        .execute("INSERT INTO _snapback_changes DEFAULT VALUES", [])
                ),
                "a primary token cannot leak journal authority to a second connection"
            );
        }

        let lifecycle = open_registered_system_writer_v1(
            &path,
            RegisteredSystemWriterPurposeV1::DerivedForkLifecycle,
        )
        .expect("open registry-reconstructed lifecycle writer");
        assert!(
            lifecycle
                .conn()
                .db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_DEFENSIVE)
                .expect("lifecycle writer defensive mode")
        );
        assert!(denied(lifecycle.conn().execute(
            "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title)
             VALUES('lifecycle-bypass',1,1,1,'denied')",
            [],
        )));
        assert!(denied(
            lifecycle
                .conn()
                .execute("INSERT INTO _snapback_changes DEFAULT VALUES", [])
        ));
    }

    #[test]
    fn llp0162_local_target_activation_names_only_envelope_writers_and_blocks_exclusions() {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(schema())
            .expect("apply writer fixture schema");
        db.activate_local_target_operation_coverage(1)
            .expect("activate closed local target manifest");
        assert!(
            db.agent_safe_exact_operation_coverage_active()
                .expect("read exact active coverage"),
            "only the production two-lane/four-adapter cut projects app-effective coverage"
        );

        let inventory = db
            .local_writer_coverage_inventory_for_test()
            .expect("activated local writer inventory");
        let declared = inventory
            .entries
            .iter()
            .filter(|entry| entry.declared_covered)
            .collect::<Vec<_>>();
        assert_eq!(declared.len(), 4);
        assert!(declared.iter().all(|entry| {
            entry.envelope_mapped
                && entry.exclusion_reason.is_none()
                && entry.write_authority_enforced
        }));
        assert!(
            !inventory.all_app_effective_writers_covered,
            "explicitly excluded schema/seed/migration/projection/promotion writers remain visible"
        );

        for writer in [
            write_authority::LocalWriterLaneV1::SchemaActivation,
            write_authority::LocalWriterLaneV1::MigrationExecutor,
            write_authority::LocalWriterLaneV1::ResetAndSeed,
            write_authority::LocalWriterLaneV1::StandaloneSeed,
            write_authority::LocalWriterLaneV1::MembershipTransition,
            write_authority::LocalWriterLaneV1::ProjectionRebuild,
            write_authority::LocalWriterLaneV1::StrictPromotionReexecution,
        ] {
            let error = match db.writer_authority.enter(writer) {
                Ok(_) => panic!("an excluded app writer acquired authority"),
                Err(error) => error,
            };
            assert_eq!(error.diagnostic.code, "SNAPBACK_OPERATION_WRITER_EXCLUDED");
        }

        let schema_error = db
            .schema_seed()
            .apply_schema(schema())
            .expect_err("schema activation must use its excluded generated authority");
        assert_eq!(
            schema_error.diagnostic.code,
            "SNAPBACK_OPERATION_WRITER_EXCLUDED"
        );
        let reset_error = db
            .schema_seed()
            .reset()
            .expect_err("reset must use its excluded generated authority");
        assert_eq!(
            reset_error.diagnostic.code,
            "SNAPBACK_OPERATION_WRITER_EXCLUDED"
        );

        let raw = db
            .conn
            .execute(
                "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title)
                 VALUES('excluded-bypass',1,1,1,'denied')",
                [],
            )
            .expect_err("excluded writer cannot fall back to raw SQL");
        assert!(matches!(
            raw,
            rusqlite::Error::SqliteFailure(failure, _)
                if failure.code == rusqlite::ErrorCode::AuthorizationForStatementDenied
        ));
    }

    #[test]
    fn agent_safe_app_effective_coverage_rejects_subset_superset_and_manifest_removal() {
        let exact_lanes = vec![
            crate::operation_ledger::ORDINARY_MUTATION_LANE_V1.to_owned(),
            crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1.to_owned(),
        ];
        let exact_writers = crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1
            .into_iter()
            .chain(crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1)
            .map(str::to_owned)
            .collect::<Vec<_>>();

        let mut subset = LocalDatabase::memory().expect("subset database");
        subset
            .schema_seed()
            .apply_schema(schema())
            .expect("subset schema");
        subset
            .install_operation_coverage_for_test(
                vec![crate::operation_ledger::ORDINARY_MUTATION_LANE_V1.to_owned()],
                crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1
                    .into_iter()
                    .map(str::to_owned)
                    .collect(),
            )
            .expect("install subset");
        assert!(!subset.agent_safe_exact_operation_coverage_active().unwrap());

        let mut superset = LocalDatabase::memory().expect("superset database");
        superset
            .schema_seed()
            .apply_schema(schema())
            .expect("superset schema");
        let mut extra_writers = exact_writers.clone();
        extra_writers.push("forged::unregistered-writer".to_owned());
        superset
            .install_operation_coverage_for_test(exact_lanes.clone(), extra_writers)
            .expect("install superset");
        assert!(
            !superset
                .agent_safe_exact_operation_coverage_active()
                .unwrap()
        );

        let mut removed = LocalDatabase::memory().expect("removed database");
        removed
            .schema_seed()
            .apply_schema(schema())
            .expect("removed schema");
        removed
            .install_operation_coverage_for_test(exact_lanes, exact_writers)
            .expect("install exact manifest");
        assert!(
            removed
                .agent_safe_exact_operation_coverage_active()
                .unwrap()
        );
        let denied = removed
            .conn
            .execute("DELETE FROM _snapback_operation_coverage_v1", [])
            .expect_err("armed coverage carrier deletion must be denied");
        assert!(
            matches!(
                denied,
                rusqlite::Error::SqliteFailure(failure, _)
                    if failure.code == rusqlite::ErrorCode::AuthorizationForStatementDenied
            ),
            "manifest removal returned {denied:?}"
        );
        assert!(
            removed
                .agent_safe_exact_operation_coverage_active()
                .unwrap(),
            "denied carrier DML leaves the exact coverage cut active"
        );
        removed
            .install_operation_coverage_for_test(
                vec![
                    crate::operation_ledger::ORDINARY_MUTATION_LANE_V1.to_owned(),
                    crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1.to_owned(),
                ],
                crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1
                    .into_iter()
                    .chain(crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1)
                    .map(str::to_owned)
                    .collect(),
            )
            .expect("re-arm releases SQLite cache memory through the admitted pragma path");
    }

    #[test]
    fn llp0162_writer_authority_rearms_from_durable_manifest_on_reopen() {
        let dir = tempfile::tempdir().expect("writer authority tempdir");
        let path = dir.path().join("writer-authority.sqlite");
        let mut db = LocalDatabase::open(&path).expect("create file database");
        db.schema_seed()
            .apply_schema(schema())
            .expect("apply writer fixture schema");
        assert_eq!(
            db.conn
                .execute(
                    "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title)
                     VALUES('before-activation',1,1,1,'admitted')",
                    [],
                )
                .expect("raw DML remains admitted before explicit activation"),
            1
        );
        assert_eq!(
            db.conn
                .execute("DELETE FROM items WHERE _id='before-activation'", [])
                .expect("pre-activation fixture cleanup uses the same admitted raw DML"),
            1
        );
        db.activate_ordinary_mutation_coverage_for_evidence(1)
            .expect("activate durable writer manifest and live authorizer");
        let immediate = db
            .conn
            .execute(
                "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title)
                 VALUES('after-activation',1,1,1,'denied')",
                [],
            )
            .expect_err("same-process authorizer must arm before activation returns");
        assert!(matches!(
            immediate,
            rusqlite::Error::SqliteFailure(failure, _)
                if failure.code == rusqlite::ErrorCode::AuthorizationForStatementDenied
        ));
        {
            let _maintenance = db
                .writer_authority
                .enter_internal_schema_maintenance()
                .expect("enter bounded internal schema maintenance");
            crate::proof_checkpoint::ensure_checkpoint_erasure_infra(&db.conn)
                .expect("owned checkpoint schema is admitted while armed");
            for sql in [
                "CREATE TABLE app_schema_bypass(id INTEGER)",
                "ALTER TABLE items ADD COLUMN app_schema_bypass TEXT",
                "DROP TABLE items",
            ] {
                let error = db
                    .conn
                    .execute(sql, [])
                    .expect_err("internal maintenance cannot authorize application DDL");
                assert!(matches!(
                    error,
                    rusqlite::Error::SqliteFailure(failure, _)
                        if failure.code == rusqlite::ErrorCode::AuthorizationForStatementDenied
                ));
            }
        }
        let revoked = db
            .conn
            .execute("CREATE TABLE _snapback_maintenance_escape(id INTEGER)", [])
            .expect_err("internal schema authority is revoked when its token drops");
        assert!(matches!(
            revoked,
            rusqlite::Error::SqliteFailure(failure, _)
                if failure.code == rusqlite::ErrorCode::AuthorizationForStatementDenied
        ));
        drop(db);

        let reopened = LocalDatabase::open(&path).expect("reopen covered database");
        let error = reopened
            .conn
            .execute(
                "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title)
                 VALUES('reopen-bypass',1,1,1,'raw')",
                [],
            )
            .expect_err("reopened authorizer must deny raw app write");
        assert!(matches!(
            error,
            rusqlite::Error::SqliteFailure(failure, _)
                if failure.code == rusqlite::ErrorCode::AuthorizationForStatementDenied
        ));
        assert_eq!(
            reopened
                .local_writer_coverage_inventory_for_test()
                .expect("reopened writer inventory")
                .manifest_version,
            Some(1)
        );
    }

    #[test]
    fn llp0162_writer_authority_installs_only_at_the_active_coverage_cut() {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(schema())
            .expect("apply writer fixture schema");

        // A dormant connection must preserve SQLite's normal statement-cache
        // behavior. Preparing raw application DML is admitted before the
        // explicit coverage cut, including on a statement reused from cache.
        let sql = "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title) \
                   VALUES(?1,1,1,1,'dormant')";
        db.conn
            .prepare_cached(sql)
            .expect("dormant statement prepares before the coverage cut");
        db.install_operation_coverage_for_test(
            vec![crate::operation_ledger::ORDINARY_MUTATION_LANE_V1.to_owned()],
            crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1
                .iter()
                .map(|writer| (*writer).to_owned())
                .collect(),
        )
        .expect("activate ordinary writer fixture");

        let denied = match db.conn.prepare_cached(sql) {
            Ok(_) => {
                panic!("activation failed to clear the dormant cache and install the authorizer")
            }
            Err(error) => error,
        };
        assert!(matches!(
            denied,
            rusqlite::Error::SqliteFailure(failure, _)
                if failure.code == rusqlite::ErrorCode::AuthorizationForStatementDenied
        ));
    }

    fn buffered_writes() -> Vec<BufferedWrite> {
        [("item_one", "one"), ("item_two", "two")]
            .into_iter()
            .map(|(id, title)| {
                let mut values = Map::new();
                values.insert("title".to_owned(), json!(title));
                BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: id.to_owned(),
                    values,
                }
            })
            .collect()
    }

    fn ledger() -> CtxAnswerLedger {
        CtxAnswerLedger {
            version: CTX_ANSWER_LEDGER_VERSION,
            ids: Vec::new(),
            now: 0,
            auth_fingerprint: None,
        }
    }

    fn buffered_payload() -> BufferedCommitPayload {
        BufferedCommitPayload {
            writes: buffered_writes(),
            sequence_allocations: Vec::new(),
            membership_plans: Vec::new(),
            read_dependencies: Vec::new(),
            result: json!(2),
            ctx_ledger: ledger(),
            job_enqueues: Vec::new(),
            job_producer: None,
            asset_admissions: Vec::new(),
            asset_grant_ops: Vec::new(),
            media_projection_proof: None,
            expected_media_projection_binding: None,
        }
    }

    fn cancelled() -> SnapbackError {
        SnapbackError::error(
            "SNAPBACK_ACTION_TIMEOUT",
            "runtime",
            "guarded commit test cancellation",
        )
    }

    fn assert_empty(db: &LocalDatabase) {
        assert_eq!(db.current_version().expect("version"), 0);
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .expect("scan")
                .total,
            0
        );
    }

    struct TestRetentionLimits(Option<ClientMutationRetentionLimits>);

    impl TestRetentionLimits {
        fn install(records: u64, bytes: u64) -> Self {
            Self::install_all(records, bytes, u64::MAX, u64::MAX)
        }

        fn install_all(
            records: u64,
            bytes: u64,
            records_per_auth: u64,
            bytes_per_auth: u64,
        ) -> Self {
            let previous = CLIENT_MUTATION_TEST_LIMITS.with(|slot| {
                slot.replace(Some(ClientMutationRetentionLimits {
                    records,
                    bytes,
                    records_per_auth,
                    bytes_per_auth,
                }))
            });
            Self(previous)
        }
    }

    impl Drop for TestRetentionLimits {
        fn drop(&mut self) {
            CLIENT_MUTATION_TEST_LIMITS.with(|slot| slot.set(self.0));
        }
    }

    fn seed_data(id: &str, title: &str) -> SeedData {
        SeedData {
            tables: BTreeMap::from([(
                "items".to_owned(),
                vec![Map::from_iter([
                    ("_id".to_owned(), json!(id)),
                    ("title".to_owned(), json!(title)),
                ])],
            )]),
        }
    }

    fn managed_version_runtime_indexes(conn: &Connection) -> Vec<(String, String)> {
        let mut statement = conn
            .prepare(
                "SELECT name, tbl_name
                 FROM sqlite_schema
                 WHERE type = 'index'
                   AND (name GLOB '_snapback_version_domain_*'
                        OR name GLOB '_snapback_version_head_*')
                 ORDER BY name",
            )
            .expect("prepare managed-version index inventory");
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query managed-version index inventory")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect managed-version index inventory")
    }

    fn explain_query_plan(conn: &Connection, sql: &str, bind: Option<i64>) -> Vec<String> {
        let mut statement = conn.prepare(sql).expect("prepare query plan");
        let rows = match bind {
            Some(bind) => statement
                .query_map(params![bind], |row| row.get::<_, String>(3))
                .expect("explain bound query")
                .collect::<Result<Vec<_>, _>>(),
            None => statement
                .query_map([], |row| row.get::<_, String>(3))
                .expect("explain unbound query")
                .collect::<Result<Vec<_>, _>>(),
        };
        rows.expect("collect query plan")
    }

    fn managed_version_scale_database(rows: usize) -> LocalDatabase {
        assert!(rows > 0);
        let mut db = database();
        db.schema_seed()
            .seed(seed_data("scale-0", "seed"))
            .expect("seed scale baseline and storage head");
        if rows > 1 {
            db.conn
                .execute(
                    "WITH RECURSIVE sequence(value) AS (
                       SELECT 1
                       UNION ALL
                       SELECT value + 1 FROM sequence WHERE value + 1 < ?1
                     )
                     INSERT INTO items(_id, _version, _createdAt, _updatedAt, title)
                     SELECT printf('scale-%d', value), 1, 1, 1, 'seed' FROM sequence",
                    params![rows as i64],
                )
                .expect("seed scale rows through runtime indexes");
        }
        db
    }

    fn measure_buffered_patch_vm_steps(db: &mut LocalDatabase) -> usize {
        let steps = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&steps);
        db.conn.progress_handler(
            1,
            Some(move || {
                observed.fetch_add(1, Ordering::Relaxed);
                false
            }),
        );
        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "scale-0".to_owned(),
                    values: Map::from_iter([("title".to_owned(), json!("mutated"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("measure fixed-size buffered mutation");
        db.conn.progress_handler(0, None::<fn() -> bool>);
        steps.load(Ordering::Relaxed)
    }

    fn measure_legacy_managed_version_scan_vm_steps(db: &LocalDatabase) -> usize {
        let steps = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&steps);
        db.conn.progress_handler(
            1,
            Some(move || {
                observed.fetch_add(1, Ordering::Relaxed);
                false
            }),
        );
        let maximum = version_to_sql_integer(db.current_version().expect("scale head"))
            .expect("portable scale head");
        let invalid: Option<i64> = db
            .conn
            .query_row(
                "SELECT 1 FROM items
                 WHERE typeof(_version) <> 'integer'
                    OR _version <= 0
                    OR _version > ?1
                 LIMIT 1",
                params![maximum],
                |row| row.get(0),
            )
            .optional()
            .expect("measure legacy managed-version scan");
        assert!(invalid.is_none());
        db.conn.progress_handler(0, None::<fn() -> bool>);
        steps.load(Ordering::Relaxed)
    }

    fn force_exhausted_storage_version(db: &LocalDatabase) {
        db.conn
            .execute(
                "UPDATE _snapback_version SET version = ?1 WHERE id = 1",
                params![PORTABLE_STORAGE_VERSION_MAX as i64],
            )
            .expect("force exhausted storage version");
        assert_eq!(db.current_version().unwrap(), PORTABLE_STORAGE_VERSION_MAX);
    }

    fn assert_exhaustion_preserved(
        db: &LocalDatabase,
        authorization: &AuthorizationVersion,
        change_rows: i64,
    ) {
        assert_eq!(db.current_version().unwrap(), PORTABLE_STORAGE_VERSION_MAX);
        assert_eq!(&db.authorization_version().unwrap(), authorization);
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .unwrap()
                .total,
            0
        );
        let actual_change_rows: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(actual_change_rows, change_rows);
    }

    #[test]
    fn seed_refuses_exhausted_storage_version_without_data_or_auth_change() {
        let mut db = database();
        force_exhausted_storage_version(&db);
        let authorization = db.authorization_version().unwrap();
        let change_rows: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                row.get(0)
            })
            .unwrap();

        let error = db
            .schema_seed()
            .seed_with_authorization(seed_data("exhausted", "must-not-land"))
            .expect_err("seed cannot wrap the global storage version");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_EXHAUSTED");
        assert_exhaustion_preserved(&db, &authorization, change_rows);
    }

    #[test]
    fn host_plan_refuses_exhausted_storage_version_without_data_or_auth_change() {
        let mut db = database();
        force_exhausted_storage_version(&db);
        let authorization = db.authorization_version().unwrap();
        let change_rows = db
            .conn
            .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                row.get(0)
            })
            .unwrap();

        let error = db
            .mutation_writes()
            .execute_mutation(&insert_plan(), &HandlerInput::default())
            .expect_err("HostPlan cannot wrap the global storage version");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_EXHAUSTED");
        assert_exhaustion_preserved(&db, &authorization, change_rows);
    }

    #[test]
    fn buffered_commit_refuses_exhausted_storage_version_without_data_or_auth_change() {
        let mut db = database();
        force_exhausted_storage_version(&db);
        let authorization = db.authorization_version().unwrap();
        let change_rows = db
            .conn
            .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                row.get(0)
            })
            .unwrap();

        let error = db
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                buffered_writes(),
                Vec::new(),
                json!(2),
            )
            .expect_err("buffered/Ibex commit cannot wrap the global storage version");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_EXHAUSTED");
        assert_exhaustion_preserved(&db, &authorization, change_rows);
    }

    #[test]
    fn final_portable_storage_version_commits_once_then_refuses_successor() {
        let mut db = database();
        db.conn
            .execute(
                "UPDATE _snapback_version SET version = ?1 WHERE id = 1",
                params![(PORTABLE_STORAGE_VERSION_MAX - 1) as i64],
            )
            .unwrap();

        let committed = db
            .schema_seed()
            .seed_with_authorization(seed_data("last", "portable-final"))
            .expect("max-1 may commit the final exact JavaScript version");
        assert_eq!(committed.output.version, PORTABLE_STORAGE_VERSION_MAX);
        assert_eq!(db.current_version().unwrap(), PORTABLE_STORAGE_VERSION_MAX);
        let authorization = db.authorization_version().unwrap();
        let change_rows: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                row.get(0)
            })
            .unwrap();

        let error = db
            .schema_seed()
            .seed_with_authorization(seed_data("past", "must-not-land"))
            .expect_err("the portable final version has no successor");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_EXHAUSTED");
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .unwrap()
                .total,
            1
        );
        assert_eq!(db.authorization_version().unwrap(), authorization);
        assert_eq!(
            db.conn
                .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            change_rows
        );
    }

    #[test]
    fn negative_and_nonportable_durable_versions_fail_reads_and_reopen() {
        for (name, value) in [
            ("negative", SqlValue::Integer(-1_i64)),
            (
                "past-portable-max",
                SqlValue::Integer((PORTABLE_STORAGE_VERSION_MAX + 1) as i64),
            ),
            ("non-integer-real", SqlValue::Real(1.5)),
            (
                "non-integer-text",
                SqlValue::Text("not-a-version".to_owned()),
            ),
            ("non-integer-blob", SqlValue::Blob(vec![0x01, 0x02])),
        ] {
            let (_dir, path, db) = file_database();
            db.conn
                .execute(
                    "UPDATE _snapback_version SET version = ?1 WHERE id = 1",
                    params![value],
                )
                .unwrap();
            assert_eq!(
                db.current_version().unwrap_err().diagnostic.code,
                "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name} live read"
            );
            drop(db);
            let reopen_error = match LocalDatabase::open(&path) {
                Ok(_) => panic!("{name} durable version unexpectedly reopened"),
                Err(error) => error,
            };
            assert_eq!(
                reopen_error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name} reopen"
            );
        }
    }

    #[test]
    fn brownfield_auth_collision_without_storage_facts_adopts_before_rescue() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("brownfield.sqlite3");
        let raw = Connection::open(&path).expect("open brownfield database");
        raw.execute_batch(
            "CREATE TABLE _auth_foreign_row(id TEXT PRIMARY KEY, payload BLOB);
             INSERT INTO _auth_foreign_row(id, payload) VALUES('legacy', X'0102');",
        )
        .expect("seed dormant auth-name collision");
        drop(raw);

        let db = LocalDatabase::open(&path)
            .expect("a foreign auth-name collision is brownfield, not damaged Snapback state");
        assert_eq!(db.current_version().unwrap(), 0);
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT payload FROM _auth_foreign_row WHERE id = 'legacy'",
                    [],
                    |row| { row.get::<_, Vec<u8>>(0) }
                )
                .unwrap(),
            vec![1, 2],
            "storage adoption preserves the foreign collision for the rescue verb"
        );
        let collision = db
            .inspect_auth_catalog()
            .expect_err("the adopted database must still expose the dormant collision");
        assert_eq!(collision.diagnostic.code, "SNAPBACK_AUTH_TABLE_COLLISION");
    }

    #[test]
    fn unmarked_exact_auth_catalog_without_storage_objects_remains_a_collision() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("unmarked-auth-catalog.sqlite3");
        let mut db = LocalDatabase::open(&path).expect("create managed database");
        db.activate_current_auth_catalog()
            .expect("install exact protected auth catalog");
        assert_eq!(
            db.inspect_auth_catalog().unwrap(),
            crate::storage::auth::AuthCatalogState::ReadyV4
        );

        db.conn
            .execute_batch("PRAGMA foreign_keys = OFF")
            .expect("disable foreign keys for damage fixture");
        let snapback_tables = {
            let mut statement = db
                .conn
                .prepare(
                    "SELECT name FROM sqlite_schema
                     WHERE type = 'table' AND lower(name) GLOB '_snapback*'
                     ORDER BY name DESC",
                )
                .unwrap();
            statement
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        for table in snapback_tables {
            db.conn
                .execute(&format!("DROP TABLE {}", quote_ident(&table).unwrap()), [])
                .unwrap();
        }
        let remaining_snapback_objects: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema
                 WHERE name NOT GLOB 'sqlite_*' AND lower(name) GLOB '_snapback*'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining_snapback_objects, 0);
        drop(db);

        // LLP 0057 makes this observational ambiguity explicit: without the
        // marker, even an exact auth-catalog physical shape is never adopted as
        // a protected catalog. It follows the foreign-collision lane so rescue
        // remains possible, while auth inspection still refuses ordinary use.
        let db = LocalDatabase::open(&path)
            .expect("an unmarked auth shape remains reachable to collision rescue");
        let collision = db
            .inspect_auth_catalog()
            .expect_err("an unmarked exact catalog must never be silently adopted");
        assert_eq!(collision.diagnostic.code, "SNAPBACK_AUTH_TABLE_COLLISION");
    }

    #[test]
    fn managed_brownfield_row_without_storage_head_is_refused_before_adoption() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("damaged.sqlite3");
        let raw = Connection::open(&path).expect("open damaged database");
        raw.execute_batch(
            "CREATE TABLE items(
               _id TEXT PRIMARY KEY,
               _version INTEGER NOT NULL
             );
             INSERT INTO items(_id, _version) VALUES('retained', 1);",
        )
        .expect("seed managed ordering fact without its authority");
        drop(raw);

        let error = match LocalDatabase::open(&path) {
            Ok(_) => panic!("managed rows without a canonical head unexpectedly adopted"),
            Err(error) => error,
        };
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");

        let raw = Connection::open(&path).expect("inspect refused database");
        let snapback_objects: i64 = raw
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema
                 WHERE name NOT GLOB 'sqlite_*' AND lower(name) GLOB '_snapback*'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            snapback_objects, 0,
            "refusal must precede every additive Snapback schema write"
        );
    }

    #[test]
    fn reopen_refuses_missing_canonical_head_without_recreating_it() {
        for missing in ["table", "row"] {
            let (_dir, path, db) = file_database();
            match missing {
                "table" => db
                    .conn
                    .execute("DROP TABLE _snapback_version", [])
                    .expect("drop version table"),
                "row" => db
                    .conn
                    .execute("DELETE FROM _snapback_version WHERE id = 1", [])
                    .expect("delete canonical version row"),
                _ => unreachable!(),
            };
            drop(db);

            let error = match LocalDatabase::open(&path) {
                Ok(_) => panic!("missing version {missing} unexpectedly reopened"),
                Err(error) => error,
            };
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{missing}"
            );

            let raw = Connection::open(&path).expect("inspect refused database");
            let table_exists: i64 = raw
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_schema
                     WHERE type = 'table' AND name = '_snapback_version'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            let row_count = if table_exists == 0 {
                0
            } else {
                raw.query_row("SELECT COUNT(*) FROM _snapback_version", [], |row| {
                    row.get(0)
                })
                .unwrap()
            };
            assert_eq!(table_exists, i64::from(missing == "row"));
            assert_eq!(row_count, 0, "open must not recreate the canonical row");
        }
    }

    #[test]
    fn reopen_requires_the_exact_retained_journal_high_water() {
        for mismatch in ["ahead", "behind"] {
            let (_dir, path, mut db) = file_database();
            db.schema_seed().seed(seed_data("first", "first")).unwrap();
            if mismatch == "ahead" {
                db.conn
                    .execute(
                        "UPDATE _snapback_changes
                         SET version = 2,
                             row_json = json_set(row_json, '$._version', 2)
                         WHERE row_id = 'first'",
                        [],
                    )
                    .unwrap();
            } else {
                db.schema_seed()
                    .seed(seed_data("second", "second"))
                    .unwrap();
                db.conn
                    .execute("DELETE FROM _snapback_changes WHERE version = 2", [])
                    .unwrap();
            }
            drop(db);

            let error = match LocalDatabase::open(&path) {
                Ok(_) => panic!("journal {mismatch} mismatch unexpectedly reopened"),
                Err(error) => error,
            };
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{mismatch}"
            );
        }
    }

    #[test]
    fn reopen_refuses_a_managed_row_ahead_of_head_even_after_journal_pruning() {
        let (_dir, path, mut db) = file_database();
        db.schema_seed()
            .seed(seed_data("future-row", "future"))
            .unwrap();
        db.conn
            .execute("DELETE FROM _snapback_changes", [])
            .unwrap();
        db.conn
            .execute("UPDATE items SET _version = 2 WHERE _id = 'future-row'", [])
            .unwrap();
        drop(db);

        let error = match LocalDatabase::open(&path) {
            Ok(_) => panic!("future managed row unexpectedly reopened"),
            Err(error) => error,
        };
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");
    }

    #[test]
    fn set_version_requires_exactly_one_canonical_head_row() {
        let mut db = database();
        let tx = db.conn.transaction().unwrap();
        tx.execute("DELETE FROM _snapback_version WHERE id = 1", [])
            .unwrap();
        let error = set_version(&tx, 1).expect_err("zero-row head update must fail closed");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");
        tx.rollback().unwrap();
        assert_eq!(db.current_version().unwrap(), 0);
    }

    #[test]
    fn point_read_identity_requires_the_exact_requested_opaque_string() {
        let matching = json!({ "_id": "opaque-id" });
        validate_point_read_identity(&matching, "opaque-id", "items")
            .expect("an exact opaque-string identity matches");

        for malformed in [
            json!({ "_id": "different-id" }),
            json!({ "_id": 7 }),
            json!({}),
        ] {
            let error = validate_point_read_identity(&malformed, "opaque-id", "items")
                .expect_err("a mismatched or non-string decoded identity must fail closed");
            assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_ROW_ID_CORRUPT");
            assert_eq!(error.diagnostic.details["table"], "items");
        }
    }

    #[test]
    fn strict_portable_decoder_accepts_only_writer_representations() {
        let string_families = [
            FieldType::String,
            FieldType::Principal,
            FieldType::Id {
                table: "parents".to_owned(),
            },
            FieldType::RelationIncarnation {
                foreign_key_field: "parentId".to_owned(),
                parent_table: "parents".to_owned(),
            },
            FieldType::AssetRef {
                upload: None,
                media: None,
            },
        ];
        for field_type in string_families {
            let field = declared_storage_field(field_type, false);
            assert_eq!(
                sqlite_to_json(
                    ValueRef::Text(b"exact"),
                    Some(&field),
                    "typed_items",
                    "value"
                )
                .expect("valid TEXT"),
                json!("exact")
            );
            assert_storage_field_corrupt(
                sqlite_to_json(ValueRef::Integer(1), Some(&field), "typed_items", "value"),
                "value",
                "wrong text storage class",
            );
            assert_storage_field_corrupt(
                sqlite_to_json(
                    ValueRef::Text(&[0x80]),
                    Some(&field),
                    "typed_items",
                    "value",
                ),
                "value",
                "invalid UTF-8",
            );
        }

        let boolean = declared_storage_field(FieldType::Boolean, false);
        assert_eq!(
            sqlite_to_json(ValueRef::Integer(0), Some(&boolean), "typed_items", "value")
                .expect("false"),
            Value::Bool(false)
        );
        assert_eq!(
            sqlite_to_json(ValueRef::Integer(1), Some(&boolean), "typed_items", "value")
                .expect("true"),
            Value::Bool(true)
        );
        for invalid in [
            ValueRef::Integer(-1),
            ValueRef::Integer(2),
            ValueRef::Text(b"1"),
        ] {
            assert_storage_field_corrupt(
                sqlite_to_json(invalid, Some(&boolean), "typed_items", "value"),
                "value",
                "invalid Boolean",
            );
        }

        let integer = declared_storage_field(FieldType::Integer, false);
        for value in [PORTABLE_INTEGER_MIN, 0, PORTABLE_INTEGER_MAX] {
            assert_eq!(
                sqlite_to_json(
                    ValueRef::Integer(value),
                    Some(&integer),
                    "typed_items",
                    "value"
                )
                .expect("portable Integer"),
                json!(value)
            );
        }
        for invalid in [
            ValueRef::Integer(PORTABLE_INTEGER_MIN - 1),
            ValueRef::Integer(PORTABLE_INTEGER_MAX + 1),
            ValueRef::Real(1.0),
        ] {
            assert_storage_field_corrupt(
                sqlite_to_json(invalid, Some(&integer), "typed_items", "value"),
                "value",
                "invalid Integer",
            );
        }

        let real = declared_storage_field(FieldType::Real, false);
        assert_eq!(
            sqlite_to_json(ValueRef::Real(1.5), Some(&real), "typed_items", "value")
                .expect("finite REAL"),
            json!(1.5)
        );
        for invalid in [ValueRef::Integer(1), ValueRef::Real(f64::NAN)] {
            assert_storage_field_corrupt(
                sqlite_to_json(invalid, Some(&real), "typed_items", "value"),
                "value",
                "invalid Real",
            );
        }

        let json_field = declared_storage_field(FieldType::Json, false);
        assert_eq!(
            sqlite_to_json(
                ValueRef::Text(br#"{"ok":true}"#),
                Some(&json_field),
                "typed_items",
                "value",
            )
            .expect("JSON TEXT"),
            json!({ "ok": true })
        );
        assert_storage_field_corrupt(
            sqlite_to_json(
                ValueRef::Text(b"{"),
                Some(&json_field),
                "typed_items",
                "value",
            ),
            "value",
            "invalid JSON",
        );

        let vector = declared_storage_field(FieldType::Vector { dimensions: 2 }, false);
        let mut vector_bytes = Vec::new();
        vector_bytes.extend_from_slice(&1.0f64.to_le_bytes());
        vector_bytes.extend_from_slice(&2.0f64.to_le_bytes());
        assert_eq!(
            sqlite_to_json(
                ValueRef::Blob(&vector_bytes),
                Some(&vector),
                "typed_items",
                "value",
            )
            .expect("binary64 vector"),
            json!([1.0, 2.0])
        );
        assert_storage_field_corrupt(
            sqlite_to_json(ValueRef::Text(b"[]"), Some(&vector), "typed_items", "value"),
            "value",
            "invalid Vector storage class",
        );

        assert_storage_field_corrupt(
            sqlite_to_json(ValueRef::Null, Some(&boolean), "typed_items", "value"),
            "value",
            "required NULL",
        );
        assert_eq!(
            sqlite_to_json_with_staged_null(
                ValueRef::Null,
                Some(&boolean),
                "typed_items",
                "value",
                true,
            )
            .expect("the exact migration-staged destination may still be NULL"),
            Value::Null
        );
        let optional = declared_storage_field(FieldType::Boolean, true);
        assert_eq!(
            sqlite_to_json(ValueRef::Null, Some(&optional), "typed_items", "value")
                .expect("optional NULL"),
            Value::Null
        );

        assert_eq!(
            sqlite_to_json(ValueRef::Text(b"row"), None, "typed_items", "_id").expect("system id"),
            json!("row")
        );
        assert_storage_field_corrupt(
            sqlite_to_json(ValueRef::Integer(1), None, "typed_items", "_id"),
            "_id",
            "invalid system id",
        );
        for timestamp in [0, crate::manifest::PORTABLE_TIMESTAMP_MAX_MS as i64] {
            assert_eq!(
                sqlite_to_json(
                    ValueRef::Integer(timestamp),
                    None,
                    "typed_items",
                    "_createdAt",
                )
                .expect("portable timestamp"),
                json!(timestamp)
            );
        }
        for invalid in [
            ValueRef::Integer(-1),
            ValueRef::Integer(crate::manifest::PORTABLE_TIMESTAMP_MAX_MS as i64 + 1),
            ValueRef::Text(b"0"),
        ] {
            assert_storage_field_corrupt(
                sqlite_to_json(invalid, None, "typed_items", "_updatedAt"),
                "_updatedAt",
                "invalid system timestamp",
            );
        }
    }

    #[test]
    fn corrupt_portable_field_representations_fail_every_current_read_lane() {
        let healthy = typed_decode_database()
            .query_reads_read()
            .get("typed_items", "typed-row")
            .expect("healthy point read")
            .expect("healthy row");
        assert_eq!(healthy["label"], "ok");
        assert_eq!(healthy["flag"], true);
        assert_eq!(healthy["count"], 1);
        assert_eq!(healthy["score"], 1.5);
        assert_eq!(healthy["payload"], json!({ "ok": true }));
        assert_eq!(healthy["note"], Value::Null);

        let corruptions = [
            (
                "label",
                "UPDATE typed_items SET label = CAST(x'80' AS TEXT) WHERE _id = 'typed-row'"
                    .to_owned(),
            ),
            (
                "flag",
                "UPDATE typed_items SET flag = 2 WHERE _id = 'typed-row'".to_owned(),
            ),
            (
                "count",
                format!(
                    "UPDATE typed_items SET count = {} WHERE _id = 'typed-row'",
                    PORTABLE_INTEGER_MAX + 1
                ),
            ),
            (
                "score",
                "UPDATE typed_items SET score = 'not-real' WHERE _id = 'typed-row'".to_owned(),
            ),
            (
                "payload",
                "UPDATE typed_items SET payload = '{' WHERE _id = 'typed-row'".to_owned(),
            ),
            (
                "_createdAt",
                "UPDATE typed_items SET _createdAt = -1 WHERE _id = 'typed-row'".to_owned(),
            ),
        ];
        let plan = QueryPlan {
            table_visibility: None,
            table: "typed_items".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: Some(10),
            membership_filters: Vec::new(),
            indexed_by: None,
        };

        for (field, sql) in corruptions {
            let db = typed_decode_database();
            db.conn
                .execute(&sql, [])
                .unwrap_or_else(|error| panic!("inject {field} corruption: {error}"));

            assert_storage_field_corrupt(
                db.query_reads_read().get("typed_items", "typed-row"),
                field,
                "point",
            );
            assert_storage_field_corrupt(
                db.query_reads_read().scan_table("typed_items", 10, 0),
                field,
                "scan",
            );
            assert_storage_field_corrupt(
                db.query_reads_read().query(&plan, &HandlerInput::default()),
                field,
                "query",
            );
        }
    }

    #[test]
    fn file_backed_portable_corruption_reopens_then_refuses_on_read() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("typed-corruption.sqlite3");
        {
            let mut db = LocalDatabase::open(&path).expect("create file database");
            apply_typed_decode_fixture(&mut db);
            db.conn
                .execute(
                    "UPDATE typed_items SET flag = 2 WHERE _id = 'typed-row'",
                    [],
                )
                .expect("inject stored Boolean corruption");
        }

        let reopened = LocalDatabase::open(&path)
            .expect("bounded open policy does not scan every declared field");
        assert_storage_field_corrupt(
            reopened.query_reads_read().get("typed_items", "typed-row"),
            "flag",
            "reopened point read",
        );
    }

    #[test]
    fn corrupt_managed_row_versions_fail_every_document_decoder() {
        for (name, value) in [
            ("negative", SqlValue::Integer(-1_i64)),
            (
                "past-portable-max",
                SqlValue::Integer((PORTABLE_STORAGE_VERSION_MAX + 1) as i64),
            ),
            ("non-integer-real", SqlValue::Real(1.5)),
            (
                "non-integer-text",
                SqlValue::Text("not-a-version".to_owned()),
            ),
            ("non-integer-blob", SqlValue::Blob(vec![0x01, 0x02])),
        ] {
            let mut db = database();
            db.schema_seed()
                .seed(seed_data("corrupt-row", "must-not-publish"))
                .expect("seed managed row");
            db.conn
                .execute(
                    "UPDATE items SET _version = ?1 WHERE _id = 'corrupt-row'",
                    params![value],
                )
                .expect("corrupt managed row version");

            let get_error = db
                .query_reads_read()
                .get("items", "corrupt-row")
                .expect_err("point reads must reject a corrupt managed row version");
            assert_eq!(
                get_error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name} point read"
            );

            let scan_error = db
                .query_reads_read()
                .scan_table("items", 10, 0)
                .expect_err("admin scans must reject a corrupt managed row version");
            assert_eq!(
                scan_error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name} admin scan"
            );
        }
    }

    #[test]
    fn buffered_mutation_fast_path_refuses_every_managed_version_corruption_without_effects() {
        for (name, make_value) in [
            (
                "non-integer-real",
                Box::new(|_: u64| SqlValue::Real(1.5)) as Box<dyn Fn(u64) -> SqlValue>,
            ),
            (
                "non-integer-text",
                Box::new(|_: u64| SqlValue::Text("not-a-version".to_owned())),
            ),
            (
                "non-integer-blob",
                Box::new(|_: u64| SqlValue::Blob(vec![0x01, 0x02])),
            ),
            ("zero", Box::new(|_: u64| SqlValue::Integer(0))),
            ("negative", Box::new(|_: u64| SqlValue::Integer(-1))),
            (
                "past-portable-max",
                Box::new(|_: u64| SqlValue::Integer((PORTABLE_STORAGE_VERSION_MAX + 1) as i64)),
            ),
            (
                "future-head",
                Box::new(|head: u64| SqlValue::Integer((head + 1) as i64)),
            ),
        ] {
            let mut db = database();
            db.schema_seed()
                .seed(seed_data("corrupt-row", "must-survive"))
                .expect("seed managed row");
            assert_eq!(
                managed_version_integrity_index_state(&db.conn, "items").unwrap(),
                (true, true),
                "{name} exercises the indexed validation path"
            );
            let before_version = db.current_version().expect("pre-refusal version");
            let before_changes = db.change_journal_len().expect("pre-refusal journal");
            db.conn
                .execute(
                    "UPDATE items SET _version = ?1 WHERE _id = 'corrupt-row'",
                    params![make_value(before_version)],
                )
                .expect("inject managed row corruption");

            let error = db
                .mutation_writes()
                .commit_buffered_writes(
                    &HandlerInput::default(),
                    vec![BufferedWrite::Insert {
                        table: "items".to_owned(),
                        id: "must-not-commit".to_owned(),
                        values: Map::from_iter([("title".to_owned(), json!("refused"))]),
                    }],
                    Vec::new(),
                    Value::Null,
                )
                .expect_err("corrupt managed version must refuse before effects");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name}"
            );
            assert_eq!(error.diagnostic.subsystem, "storage", "{name}");
            assert_eq!(
                error.diagnostic.message,
                "managed table items contains a non-portable row storage version",
                "{name}"
            );
            assert_eq!(error.diagnostic.details["table"], json!("items"), "{name}");
            assert_eq!(db.current_version().unwrap(), before_version, "{name}");
            assert_eq!(db.change_journal_len().unwrap(), before_changes, "{name}");
            let attempted_rows: i64 = db
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM items WHERE _id = 'must-not-commit'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(attempted_rows, 0, "{name}");
            let original_title: String = db
                .conn
                .query_row(
                    "SELECT title FROM items WHERE _id = 'corrupt-row'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(original_title, "must-survive", "{name}");
        }
    }

    #[test]
    fn managed_version_validation_plans_use_bounded_runtime_indexes() {
        let db = database();
        let (domain_name, head_name) = managed_version_integrity_index_names("items");
        let domain_plan = explain_query_plan(
            &db.conn,
            &format!(
                "EXPLAIN QUERY PLAN
                 SELECT _version FROM items INDEXED BY {}
                 WHERE typeof(_version) <> 'integer'
                    OR _version <= 0
                    OR _version > {PORTABLE_STORAGE_VERSION_MAX}
                 LIMIT 1",
                quote_ident(&domain_name).unwrap()
            ),
            None,
        );
        assert!(
            domain_plan
                .iter()
                .any(|detail| detail.contains(&domain_name)),
            "domain probe must use its empty partial index: {domain_plan:?}"
        );

        let head_plan = explain_query_plan(
            &db.conn,
            &format!(
                "EXPLAIN QUERY PLAN
                 SELECT _version FROM items INDEXED BY {}
                 WHERE _version > ?1 LIMIT 1",
                quote_ident(&head_name).unwrap()
            ),
            Some(1),
        );
        assert!(
            head_plan
                .iter()
                .any(|detail| { detail.contains("SEARCH") && detail.contains(&head_name) }),
            "future-head probe must be an indexed range search: {head_plan:?}"
        );

        let legacy_plan = explain_query_plan(
            &db.conn,
            "EXPLAIN QUERY PLAN
             SELECT 1 FROM items
             WHERE typeof(_version) <> 'integer'
                OR _version <= 0
                OR _version > ?1
             LIMIT 1",
            Some(1),
        );
        assert!(
            legacy_plan.iter().any(|detail| detail.contains("SCAN")),
            "the dynamic legacy predicate remains a cardinality scan: {legacy_plan:?}"
        );
    }

    #[test]
    fn buffered_managed_version_validation_cost_is_cardinality_independent() {
        let mut small = managed_version_scale_database(1_000);
        let mut large = managed_version_scale_database(50_000);

        let small_fast = measure_buffered_patch_vm_steps(&mut small);
        let large_fast = measure_buffered_patch_vm_steps(&mut large);
        assert!(
            large_fast <= small_fast.saturating_mul(2).saturating_add(2_000),
            "indexed buffered validation must stay bounded: small={small_fast}, large={large_fast}"
        );

        let small_legacy = measure_legacy_managed_version_scan_vm_steps(&small);
        let large_legacy = measure_legacy_managed_version_scan_vm_steps(&large);
        assert!(
            large_legacy > small_legacy.saturating_mul(20),
            "legacy witness must grow with table cardinality: small={small_legacy}, large={large_legacy}"
        );
    }

    #[test]
    fn reopen_rebuilds_managed_version_indexes_after_upgrade_and_predicate_drift() {
        let (_dir, path, mut db) = file_database();
        db.schema_seed()
            .seed(seed_data("healthy-on-reopen", "healthy"))
            .expect("seed managed row");
        let (domain_name, head_name) = managed_version_integrity_index_names("items");
        db.conn
            .execute(
                &format!("DROP INDEX {}", quote_ident(&domain_name).unwrap()),
                [],
            )
            .expect("drop domain index");
        db.conn
            .execute(
                &format!("DROP INDEX {}", quote_ident(&head_name).unwrap()),
                [],
            )
            .expect("drop head index");
        db.conn
            .execute(
                &format!(
                    "CREATE INDEX {} ON items(_version)
                     WHERE typeof(_version) <> 'integer' OR _version < 0",
                    quote_ident(&domain_name).unwrap()
                ),
                [],
            )
            .expect("install stale domain predicate");
        drop(db);

        let reopened = LocalDatabase::open(&path).expect("healthy reopen upgrades indexes");
        assert_eq!(
            managed_version_integrity_index_state(&reopened.conn, "items").unwrap(),
            (true, true)
        );
        let domain_sql: String = reopened
            .conn
            .query_row(
                "SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?1",
                params![domain_name],
                |row| row.get(0),
            )
            .expect("inspect rebuilt domain index");
        assert!(domain_sql.contains("_version <= 0"), "{domain_sql}");
        assert!(
            domain_sql.contains(&format!("_version > {PORTABLE_STORAGE_VERSION_MAX}")),
            "{domain_sql}"
        );
        let plan = explain_query_plan(
            &reopened.conn,
            &format!(
                "EXPLAIN QUERY PLAN
                 SELECT _version FROM items INDEXED BY {}
                 WHERE typeof(_version) <> 'integer'
                    OR _version <= 0
                    OR _version > {PORTABLE_STORAGE_VERSION_MAX}
                 LIMIT 1",
                quote_ident(&domain_name).unwrap()
            ),
            None,
        );
        assert!(
            plan.iter().any(|detail| detail.contains(&domain_name)),
            "{plan:?}"
        );
    }

    #[test]
    fn reopen_refuses_corrupt_managed_versions_before_index_upgrade() {
        let (_dir, path, mut db) = file_database();
        db.schema_seed()
            .seed(seed_data("corrupt-on-reopen", "corrupt"))
            .expect("seed managed row");
        let (domain_name, head_name) = managed_version_integrity_index_names("items");
        for name in [&domain_name, &head_name] {
            db.conn
                .execute(&format!("DROP INDEX {}", quote_ident(name).unwrap()), [])
                .expect("simulate pre-index database");
        }
        db.conn
            .execute(
                "UPDATE items SET _version = ?1 WHERE _id = 'corrupt-on-reopen'",
                params![SqlValue::Real(1.5)],
            )
            .expect("corrupt managed version before reopen");
        drop(db);

        let error = match LocalDatabase::open(&path) {
            Ok(_) => panic!("open preflight must refuse before managed-index DDL"),
            Err(error) => error,
        };
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");
        let raw = Connection::open(&path).expect("inspect refused database");
        let runtime_indexes: i64 = raw
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema
                 WHERE type = 'index' AND name IN (?1, ?2)",
                params![domain_name, head_name],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            runtime_indexes, 0,
            "preflight refusal must precede index DDL"
        );
    }

    #[test]
    fn missing_managed_version_indexes_fall_back_to_fail_closed_scan() {
        let mut db = database();
        db.schema_seed()
            .seed(seed_data("corrupt-row", "must-survive"))
            .expect("seed managed row");
        let (domain_name, head_name) = managed_version_integrity_index_names("items");
        for name in [&domain_name, &head_name] {
            db.conn
                .execute(&format!("DROP INDEX {}", quote_ident(name).unwrap()), [])
                .expect("drop runtime index");
        }
        db.conn
            .execute(
                "UPDATE items SET _version = ?1 WHERE _id = 'corrupt-row'",
                params![SqlValue::Real(1.5)],
            )
            .expect("inject corruption without sentinel");
        let before = db.current_version().unwrap();

        let error = db
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "must-not-commit".to_owned(),
                    values: Map::from_iter([("title".to_owned(), json!("refused"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect_err("fallback scan must reject corruption");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");
        assert_eq!(db.current_version().unwrap(), before);
        let attempted_rows: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM items WHERE _id = 'must-not-commit'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(attempted_rows, 0);
    }

    #[test]
    fn optional_to_required_rebuild_restores_managed_version_indexes() {
        let mut db = database();
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), json!("required-row")),
                        ("title".to_owned(), json!("ready")),
                        ("rank".to_owned(), json!(1)),
                    ])],
                )]),
            })
            .expect("seed non-null optional value");
        let mut required = schema();
        required.tables[0]
            .fields
            .iter_mut()
            .find(|field| field.name == "rank")
            .expect("rank field")
            .optional = false;
        db.schema_seed()
            .apply_schema(required)
            .expect("safe optional-to-required rebuild");

        assert_eq!(
            managed_version_integrity_index_state(&db.conn, "items").unwrap(),
            (true, true)
        );
        assert_eq!(
            managed_version_runtime_indexes(&db.conn),
            vec![
                (
                    "_snapback_version_domain_items".to_owned(),
                    "items".to_owned()
                ),
                (
                    "_snapback_version_head_items".to_owned(),
                    "items".to_owned()
                ),
            ]
        );
        let rank_not_null: i64 = db
            .conn
            .query_row(
                "SELECT \"notnull\" FROM pragma_table_info('items') WHERE name = 'rank'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rank_not_null, 1);
    }

    #[test]
    fn corrupt_managed_row_versions_cannot_hide_in_version_selection() {
        let mut db = database();
        db.schema_seed()
            .seed(seed_data("corrupt-row", "must-not-publish"))
            .expect("seed managed row");
        db.conn
            .execute(
                "UPDATE items SET _version = -1 WHERE _id = 'corrupt-row'",
                [],
            )
            .expect("corrupt managed row version");

        let plans = [
            QueryPlan {
                table_visibility: None,
                table: "items".to_owned(),
                filters: vec![crate::manifest::FilterExpr {
                    field: "_version".to_owned(),
                    op: FilterOp::Gt,
                    value: ValueExpr::Literal(json!(0)),
                }],
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            },
            QueryPlan {
                table_visibility: None,
                table: "items".to_owned(),
                filters: Vec::new(),
                order: vec![crate::manifest::OrderExpr {
                    field: "_version".to_owned(),
                    direction: OrderDirection::Desc,
                    max_encoded_bytes: None,
                }],
                limit: Some(0),
                membership_filters: Vec::new(),
                indexed_by: None,
            },
        ];
        for (selection, plan) in ["filter", "order"].into_iter().zip(plans) {
            let error = db
                .query_reads_read()
                .query(&plan, &HandlerInput::default())
                .expect_err("a corrupt row version must not influence SQL selection");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{selection}"
            );
        }
    }

    #[test]
    fn delete_where_cannot_hide_a_corrupt_row_version_in_its_filter() {
        let mut db = database();
        db.schema_seed()
            .seed(seed_data("corrupt-row", "must-survive"))
            .expect("seed managed row");
        db.conn
            .execute(
                "UPDATE items SET _version = ?1 WHERE _id = 'corrupt-row'",
                params![SqlValue::Text("not-a-version".to_owned())],
            )
            .expect("corrupt managed row version");
        let before_version = db.current_version().expect("pre-refusal version");
        let before_changes = db.change_journal_len().expect("pre-refusal journal size");
        let plan = MutationPlan {
            steps: vec![MutationStep::DeleteWhere {
                table: "items".to_owned(),
                filter: vec![crate::manifest::FilterExpr {
                    field: "_version".to_owned(),
                    op: FilterOp::Gt,
                    value: ValueExpr::Literal(json!(0)),
                }],
            }],
            return_value: Some(ReturnValue::ChangedCount),
        };

        let error = db
            .mutation_writes()
            .execute_mutation(&plan, &HandlerInput::default())
            .expect_err("bulk mutation selection must preflight every row version");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");
        assert_eq!(db.current_version().unwrap(), before_version);
        assert_eq!(db.change_journal_len().unwrap(), before_changes);
        let rows: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 1, "the refused DeleteWhere must preserve the row");
    }

    #[test]
    fn corrupt_non_high_water_journal_version_cannot_validate_a_stale_query() {
        let mut db = database();
        db.schema_seed()
            .seed(seed_data("baseline", "disjoint"))
            .expect("seed query baseline");
        let query = QueryPlan {
            table_visibility: None,
            table: "items".to_owned(),
            filters: vec![crate::manifest::FilterExpr {
                field: "title".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Literal(json!("matching")),
            }],
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        };
        let input = HandlerInput::default();
        let output = db
            .query_reads_read()
            .query(&query, &input)
            .expect("capture empty query");
        let dependency = crate::live_matcher::query_dependencies_from_plan(
            &query,
            &input,
            &output,
            &DbRead::Live(&db),
        )
        .expect("capture query dependency")
        .into_iter()
        .find(|dependency| dependency.kind == CapturedReadKind::Query)
        .expect("table query dependency");

        db.schema_seed()
            .seed(seed_data("matching", "matching"))
            .expect("matching intervening change");
        db.schema_seed()
            .seed(seed_data("newer-disjoint", "disjoint"))
            .expect("newer disjoint high-water");
        db.conn
            .execute(
                "UPDATE _snapback_changes SET version = -1 WHERE row_id = 'matching'",
                [],
            )
            .expect("hide matching change below captured cursor");
        let before = db.current_version().expect("pre-refusal version");

        let error = db
            .mutation_writes()
            .commit_buffered_writes(
                &input,
                vec![BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "must-not-commit".to_owned(),
                    values: Map::from_iter([("title".to_owned(), json!("refused"))]),
                }],
                vec![dependency],
                Value::Null,
            )
            .expect_err("a corrupt hidden predecessor must not validate stale reads");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");
        assert_eq!(db.current_version().unwrap(), before);
        assert!(
            db.query_reads_read()
                .get("items", "must-not-commit")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn structurally_corrupt_journal_rows_cannot_validate_a_stale_query() {
        let corruptions = [
            (
                "embedded-version-mismatch",
                "insert",
                Some(json!({"_id": "intervening", "_version": 0, "title": "matching"})),
            ),
            (
                "embedded-id-mismatch",
                "insert",
                Some(json!({"_id": "another-row", "_version": 2, "title": "matching"})),
            ),
            (
                "unknown-operation",
                "mystery",
                Some(json!({"_id": "intervening", "_version": 2, "title": "disjoint"})),
            ),
            (
                "delete-with-snapshot",
                "delete",
                Some(json!({"_id": "intervening", "_version": 2, "title": "disjoint"})),
            ),
            ("insert-without-snapshot", "insert", None),
            ("non-object-snapshot", "insert", Some(json!([]))),
        ];

        for (name, op, snapshot) in corruptions {
            let mut db = database();
            db.schema_seed()
                .seed(seed_data("baseline", "baseline"))
                .expect("seed query baseline");
            let query = QueryPlan {
                table_visibility: None,
                table: "items".to_owned(),
                filters: vec![crate::manifest::FilterExpr {
                    field: "_version".to_owned(),
                    op: FilterOp::Gt,
                    value: ValueExpr::Literal(json!(1)),
                }],
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            };
            let input = HandlerInput::default();
            let output = db
                .query_reads_read()
                .query(&query, &input)
                .expect("capture empty query");
            let dependency = crate::live_matcher::query_dependencies_from_plan(
                &query,
                &input,
                &output,
                &DbRead::Live(&db),
            )
            .expect("capture query dependency")
            .into_iter()
            .find(|dependency| dependency.kind == CapturedReadKind::Query)
            .expect("table query dependency");
            db.schema_seed()
                .seed(seed_data("intervening", "matching"))
                .expect("intervening change");
            db.conn
                .execute(
                    "UPDATE _snapback_changes SET op = ?1, row_json = ?2 \
                     WHERE row_id = 'intervening'",
                    params![op, snapshot.map(|value| value.to_string())],
                )
                .expect("corrupt reconstructed journal row");
            let before = db.current_version().expect("pre-refusal version");

            let error = db
                .mutation_writes()
                .commit_buffered_writes(
                    &input,
                    vec![BufferedWrite::Insert {
                        table: "items".to_owned(),
                        id: format!("must-not-commit-{name}"),
                        values: Map::from_iter([("title".to_owned(), json!("refused"))]),
                    }],
                    vec![dependency],
                    Value::Null,
                )
                .expect_err("structural journal corruption must fail read validation");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name}"
            );
            assert_eq!(db.current_version().unwrap(), before, "{name}");
        }
    }

    #[test]
    fn reopen_migrates_a_stale_journal_sentinel_only_after_healthy_preflight() {
        let (_dir, path, mut db) = file_database();
        db.schema_seed()
            .seed(seed_data("healthy-on-reopen", "healthy"))
            .expect("seed journal row");
        db.conn
            .execute("DROP INDEX _snapback_changes_invalid_committed_version", [])
            .expect("remove current sentinel");
        db.conn
            .execute_batch(
                "CREATE INDEX _snapback_changes_invalid_committed_version
                 ON _snapback_changes(version)
                 WHERE typeof(version) <> 'integer' OR version < 0;",
            )
            .expect("simulate a stale sentinel predicate");
        drop(db);

        let reopened = LocalDatabase::open(&path).expect("healthy database migrates sentinel");
        let index_sql: String = reopened
            .conn
            .query_row(
                "SELECT sql FROM sqlite_schema
                 WHERE type = 'index'
                   AND name = '_snapback_changes_invalid_committed_version'",
                [],
                |row| row.get(0),
            )
            .expect("inspect migrated index");
        assert!(index_sql.contains("version <= 0"), "{index_sql}");
        assert_eq!(reopened.table_change_version("items").unwrap(), 1);
    }

    #[test]
    fn reopen_refuses_corrupt_journal_before_sentinel_migration() {
        let (_dir, path, mut db) = file_database();
        db.schema_seed()
            .seed(seed_data("corrupt-on-reopen", "corrupt"))
            .expect("seed journal row");
        db.conn
            .execute("DROP INDEX _snapback_changes_invalid_committed_version", [])
            .expect("simulate a database from before the final sentinel");
        db.conn
            .execute(
                "UPDATE _snapback_changes SET version = ?1 WHERE row_id = 'corrupt-on-reopen'",
                params![SqlValue::Real(1.5)],
            )
            .expect("corrupt journal version before migration");
        drop(db);

        let error = match LocalDatabase::open(&path) {
            Ok(_) => panic!("open preflight must refuse corruption before additive DDL"),
            Err(error) => error,
        };
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");
        let raw = Connection::open(&path).expect("inspect refused database");
        let index_count: i64 = raw
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema
                 WHERE type = 'index'
                   AND name = '_snapback_changes_invalid_committed_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            index_count, 0,
            "failed preflight must not run migration DDL"
        );
    }

    #[test]
    fn corrupt_change_journal_versions_fail_closed_without_pruning() {
        let mut db = database();
        db.schema_seed()
            .seed(seed_data("oldest", "oldest"))
            .expect("seed oldest journal row");
        db.schema_seed()
            .seed(seed_data("middle", "middle"))
            .expect("seed valid prunable high-water");
        db.schema_seed()
            .seed(seed_data("newest", "newest"))
            .expect("seed preserved table high-water");
        db.conn
            .execute(
                "UPDATE _snapback_changes SET version = -1 WHERE row_id = 'oldest'",
                [],
            )
            .expect("corrupt non-high-water prunable journal row");
        let before = db.change_journal_len().expect("journal length");
        let error = db
            .prune_change_journal(now_millis() + 10_000, 0, 0)
            .expect_err("a corrupt non-high-water must not advance the floor");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");
        assert_eq!(db.change_journal_len().unwrap(), before);
        assert_eq!(db.journal_floor_version().unwrap(), 0);

        for (name, value) in [
            (
                "past-portable-max",
                SqlValue::Integer((PORTABLE_STORAGE_VERSION_MAX + 1) as i64),
            ),
            ("non-integer-real", SqlValue::Real(1.5)),
            (
                "non-integer-text",
                SqlValue::Text("not-a-version".to_owned()),
            ),
        ] {
            let mut db = database();
            db.schema_seed()
                .seed(seed_data("only", "only"))
                .expect("seed table high-water");
            db.conn
                .execute(
                    "UPDATE _snapback_changes SET version = ?1 WHERE row_id = 'only'",
                    params![value],
                )
                .expect("corrupt table high-water");
            let error = db
                .table_change_version("items")
                .expect_err("a malformed table version must not become a read cursor");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name}"
            );
        }
    }

    #[test]
    fn corrupt_change_journal_retention_floor_fails_live_and_transactional_reads() {
        for value in [
            "-1".to_owned(),
            (PORTABLE_STORAGE_VERSION_MAX + 1).to_string(),
            "not-an-integer".to_owned(),
        ] {
            let mut db = database();
            db.conn
                .execute(
                    "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2) \
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    params![META_RETENTION_FLOOR, value],
                )
                .expect("corrupt retention floor");
            let error = db
                .journal_floor_version()
                .expect_err("live journal-floor reads must reject corruption");
            assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");

            let tx = db.conn.transaction().expect("read transaction");
            let error = retention_floor_from_tx(&tx)
                .expect_err("mutation validation must reject the same corrupt floor");
            assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");
            tx.rollback().expect("rollback read transaction");
        }
    }

    #[test]
    fn prune_rejects_a_nonportable_time_floor_without_touching_the_journal() {
        let mut db = database();
        db.schema_seed()
            .seed(seed_data("only", "only"))
            .expect("seed journal row");
        let before = db.change_journal_len().unwrap();
        let error = db
            .prune_change_journal(u64::MAX, 0, 0)
            .expect_err("a wrapped SQL timestamp would make pruning unsound");
        assert_eq!(error.diagnostic.code, "SNAPBACK_TIMESTAMP_OUT_OF_RANGE");
        assert_eq!(db.change_journal_len().unwrap(), before);
        assert_eq!(db.journal_floor_version().unwrap(), 0);
    }

    #[test]
    fn activation_and_ordinary_writes_preserve_the_closed_event_universe() {
        let mut db = LocalDatabase::memory().expect("database");
        let missing_predecessor = db
            .authorization_version()
            .expect_err("fresh database has no invented authorization version");
        let missing_predecessor_observed =
            missing_predecessor.diagnostic.code == "SNAPBACK_AUTHORIZATION_VERSION_CORRUPT";
        assert!(missing_predecessor_observed);
        db.schema_seed()
            .apply_schema(schema())
            .expect("initial activation");
        let activated = db.authorization_version().expect("activation version");
        assert_eq!(activated.epoch, 1);

        db.schema_seed()
            .apply_schema(schema())
            .expect("idempotent schema application");
        let after_idempotent = db.authorization_version().unwrap();
        assert_eq!(after_idempotent, activated);

        let commit = db
            .mutation_writes()
            .execute_mutation(&insert_plan(), &HandlerInput::default())
            .expect("ordinary host-plan commit");
        let removed_id = commit.changes[0].id.clone();
        let witness = commit.authorization.expect("postcommit witness");
        assert!(!witness.event);
        assert!(!witness.incarnation_rotated);
        assert_eq!(witness.version, activated);

        let removal = db
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Delete {
                    table: "items".to_owned(),
                    id: removed_id,
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("ordinary result-removing commit");
        let removal_witness = removal.authorization.unwrap();
        assert!(!removal_witness.event);
        assert_eq!(removal_witness.version, activated);
        println!(
            "SNAPBACK_AUTH_ACCEPTANCE_DEPLOYMENT_RECEIPT={}",
            json!({
                "missingPredecessorObserved": missing_predecessor_observed,
                "activationEpoch": activated.epoch,
                "idempotentActivationEpochAdvance": after_idempotent.epoch - activated.epoch,
                "ordinaryWriteRaisedAuthorizationEvent": witness.event,
                "ordinaryRemovalRaisedAuthorizationEvent": removal_witness.event,
            })
        );
    }

    #[test]
    fn permission_field_declarations_are_closed_and_schema_checked() {
        let mut db = LocalDatabase::memory().expect("database");

        let mut without_backing = schema();
        without_backing.tables[0].permission_fields = Some(vec!["rank".to_owned()]);
        let error = db
            .schema_seed()
            .apply_schema(without_backing)
            .expect_err("permissionFields requires permissionBacking");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_SCHEMA_PERMISSION_FIELDS_WITHOUT_BACKING"
        );

        let mut unknown = permission_schema(Some(vec!["missing"]));
        let error = db
            .schema_seed()
            .apply_schema(unknown.clone())
            .expect_err("unknown permission field");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_SCHEMA_PERMISSION_FIELD_UNKNOWN"
        );

        unknown.tables[0].permission_fields = Some(vec!["rank".to_owned(), "rank".to_owned()]);
        let error = db
            .schema_seed()
            .apply_schema(unknown)
            .expect_err("duplicate permission field");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_SCHEMA_PERMISSION_FIELD_DUPLICATE"
        );
    }

    #[test]
    fn protected_room_projection_is_exact_and_permission_backed() {
        let table = TableManifest {
            name: "memberships".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "userId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "boardId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
            ],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: true,
            permission_fields: Some(vec!["userId".to_owned(), "boardId".to_owned()]),
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        };
        let projection = crate::ephemeral::RoomPermissionProjection {
            table: "memberships".to_owned(),
            subject_field: "userId".to_owned(),
            scope_fields: BTreeMap::from([("boardId".to_owned(), "boardId".to_owned())]),
        };
        let collection =
            crate::ephemeral::EphemeralCollection::local_cursor("boardCursors", "boardId")
                .require_room_permission("board")
                .permission_backed_by(projection);
        let manifest = SchemaManifest {
            auth: Some(crate::manifest::AuthManifest {
                mode: crate::manifest::AuthMode::Sessions,
                agents: None,
                password_identifier_mode: None,
                password_minimum_length: None,
            }),
            tables: vec![table],
            ephemeral_collections: vec![collection],
            ..SchemaManifest::default()
        };
        validate_schema(&manifest).expect("exact durable room projection");

        let mut missing_scope = manifest.clone();
        missing_scope.ephemeral_collections[0]
            .permission_backing
            .as_mut()
            .unwrap()
            .scope_fields
            .clear();
        let error = validate_schema(&missing_scope).expect_err("scope mapping must be exact");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION"
        );

        let mut omitted_read_field = manifest;
        omitted_read_field.tables[0].permission_fields = Some(vec!["userId".to_owned()]);
        let error = validate_schema(&omitted_read_field)
            .expect_err("permissionFields must cover every projected read");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION"
        );
    }

    #[test]
    fn room_permission_projection_refuses_corrupt_rows_before_granting() {
        for (name, version) in [
            ("zero", SqlValue::Integer(0)),
            ("future", SqlValue::Integer(2)),
            ("text", SqlValue::Text("not-a-version".to_owned())),
        ] {
            let mut db = LocalDatabase::memory().expect("database");
            db.schema_seed()
                .apply_schema(SchemaManifest {
                    tables: vec![TableManifest {
                        name: "memberships".to_owned(),
                        fields: vec![
                            FieldManifest {
                                name: "userId".to_owned(),
                                field_type: FieldType::String,
                                optional: false,
                            },
                            FieldManifest {
                                name: "boardId".to_owned(),
                                field_type: FieldType::String,
                                optional: false,
                            },
                        ],
                        indexes: Vec::new(),
                        syncable: true,
                        permission_backing: true,
                        permission_fields: Some(vec!["userId".to_owned(), "boardId".to_owned()]),
                        search_indexes: Vec::new(),
                        vector_indexes: Vec::new(),
                        search_live_limits: None,
                        membership: None,
                        authority_profile: None,
                        asset_sharing: None,
                        visibility: None,
                        history: None,
                    }],
                    ..SchemaManifest::default()
                })
                .unwrap();
            db.schema_seed()
                .seed(SeedData {
                    tables: BTreeMap::from([(
                        "memberships".to_owned(),
                        vec![Map::from_iter([
                            ("_id".to_owned(), json!("grant")),
                            ("userId".to_owned(), json!("alice")),
                            ("boardId".to_owned(), json!("board-a")),
                        ])],
                    )]),
                })
                .unwrap();
            assert!(
                db.room_permission_projection_granted(
                    "memberships",
                    "userId",
                    "alice",
                    &[("boardId".to_owned(), "board-a".to_owned())],
                    1,
                )
                .unwrap()
            );
            db.conn
                .execute(
                    "UPDATE memberships SET _version = ?1 WHERE _id = 'grant'",
                    params![version],
                )
                .unwrap();

            let error = db
                .room_permission_projection_granted(
                    "memberships",
                    "userId",
                    "alice",
                    &[("boardId".to_owned(), "board-a".to_owned())],
                    1,
                )
                .expect_err("corrupt authorization source must not grant a room");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name}"
            );
        }
    }

    #[test]
    fn host_plan_permission_write_advances_once_and_dry_run_rolls_back() {
        let mut db = permission_database(Some(vec!["rank"]));
        let baseline = db.authorization_version().unwrap();

        let dry_run = db
            .mutation_writes()
            .dry_run_mutation(&insert_plan(), &HandlerInput::default())
            .expect("host-plan dry run");
        assert_eq!(dry_run.commit.authorization, None);
        assert_eq!(db.authorization_version().unwrap(), baseline);
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .unwrap()
                .total,
            0
        );

        let commit = db
            .mutation_writes()
            .execute_mutation(&insert_plan(), &HandlerInput::default())
            .expect("host-plan commit");
        let witness = commit.authorization.expect("postcommit witness");
        assert!(witness.event);
        assert_eq!(witness.version.epoch, baseline.epoch + 1);
        assert_eq!(witness.version, db.authorization_version().unwrap());
    }

    #[test]
    fn buffered_ibex_writes_use_permission_field_narrowing() {
        let mut db = permission_database(Some(vec!["rank"]));
        let baseline = db.authorization_version().unwrap();
        let input = HandlerInput::default();

        let inserted = db
            .mutation_writes()
            .commit_buffered_writes(
                &input,
                vec![BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "item".to_owned(),
                    values: Map::from_iter([
                        ("title".to_owned(), json!("before")),
                        ("rank".to_owned(), json!(1)),
                    ]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("buffered insert");
        let inserted_witness = inserted.authorization.unwrap();
        assert!(inserted_witness.event);
        assert_eq!(inserted_witness.version.epoch, baseline.epoch + 1);

        let disjoint = db
            .mutation_writes()
            .commit_buffered_writes(
                &input,
                vec![BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "item".to_owned(),
                    values: Map::from_iter([("title".to_owned(), json!("after"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("known disjoint patch");
        let disjoint_witness = disjoint.authorization.unwrap();
        assert!(!disjoint_witness.event);
        assert_eq!(disjoint_witness.version, inserted_witness.version);

        let permission = db
            .mutation_writes()
            .commit_buffered_writes(
                &input,
                vec![BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "item".to_owned(),
                    values: Map::from_iter([("rank".to_owned(), json!(2))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("permission patch");
        let permission_witness = permission.authorization.unwrap();
        assert!(permission_witness.event);
        assert_eq!(
            permission_witness.version.epoch,
            inserted_witness.version.epoch + 1
        );

        let deleted = db
            .mutation_writes()
            .commit_buffered_writes(
                &input,
                vec![BufferedWrite::Delete {
                    table: "items".to_owned(),
                    id: "item".to_owned(),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("permission delete");
        assert!(deleted.authorization.unwrap().event);
    }

    #[test]
    fn seed_and_reset_return_exact_transaction_witnesses() {
        let mut db = permission_database(Some(vec!["rank"]));
        let baseline = db.authorization_version().unwrap();
        let seed = db
            .schema_seed()
            .seed_with_authorization(seed_data("old", "old data"))
            .expect("permission seed");
        assert!(seed.authorization.event);
        assert_eq!(seed.authorization.version.epoch, baseline.epoch + 1);
        assert_eq!(
            seed.authorization.version,
            db.authorization_version().unwrap()
        );

        let reset = db
            .schema_seed()
            .reset_and_seed_with_authorization(Some(seed_data("new", "new data")))
            .expect("reset with seed");
        assert!(reset.authorization.event);
        assert!(reset.authorization.incarnation_rotated);
        assert_eq!(reset.authorization.version.epoch, 0);
        assert_ne!(
            reset.authorization.version.incarnation,
            seed.authorization.version.incarnation
        );
        assert_eq!(
            reset.authorization.version,
            db.authorization_version().unwrap()
        );

        let post_reset = db
            .schema_seed()
            .seed_with_authorization(seed_data("again", "again"))
            .expect("post-reset permission seed");
        assert_eq!(post_reset.authorization.version.epoch, baseline.epoch);
        assert_ne!(
            post_reset.authorization.version.incarnation, baseline.incarnation,
            "equal epochs across reset cannot create an ABA witness"
        );
    }

    #[test]
    fn authorization_version_persists_across_ordinary_restart() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("authorization-version.sqlite3");
        let committed = {
            let mut db = LocalDatabase::open(&path).expect("database");
            db.schema_seed()
                .apply_schema(permission_schema(None))
                .expect("permission schema");
            db.mutation_writes()
                .execute_mutation(&insert_plan(), &HandlerInput::default())
                .expect("permission commit");
            db.authorization_version().unwrap()
        };
        let reopened = LocalDatabase::open(&path).expect("reopen database");
        assert_eq!(reopened.authorization_version().unwrap(), committed);
    }

    #[test]
    fn sender_replay_epoch_survives_restart_and_rotates_atomically_with_stream_reset() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("sender-replay-epoch.sqlite3");
        let predecessor = {
            let mut db = LocalDatabase::open(&path).expect("database");
            db.schema_seed()
                .apply_schema(permission_schema(None))
                .expect("permission schema");
            db.activate_current_auth_catalog()
                .expect("activate auth catalog");
            db.initialize_sender_proof_after_hosted_preflight()
                .expect("initialize sender authority");
            let epoch = crate::auth::sender_proof::sender_replay_epoch(&db.conn)
                .expect("initial sender epoch");
            db.conn
                .execute(
                    "INSERT INTO _snapback_sender_proof_replay
                     (admission_epoch, proof_id, expires_at_seconds)
                     VALUES (?1, zeroblob(16), 999)",
                    params![epoch as i64],
                )
                .expect("seed replay state");
            db.conn
                .execute(
                    "INSERT INTO _snapback_sender_nonce
                     (admission_epoch, jwk_thumbprint, generation, nonce,
                      expires_at_seconds)
                     VALUES (?1, ?2, 1, ?3, 999)",
                    params![epoch as i64, "A".repeat(43), "B".repeat(43)],
                )
                .expect("seed nonce state");
            epoch
        };

        let mut reopened = LocalDatabase::open(&path).expect("reopen database");
        reopened
            .schema_seed()
            .apply_schema(permission_schema(None))
            .expect("reload permission schema");
        assert_eq!(
            crate::auth::sender_proof::sender_replay_epoch(&reopened.conn)
                .expect("restart sender epoch"),
            predecessor,
            "an ordinary restart or serving rollout cannot rotate sender replay state",
        );

        let before_stream = reopened.authorization_version().unwrap();
        reopened
            .schema_seed()
            .reset_and_seed_with_authorization(None)
            .expect("stream reset");
        let after_stream = reopened.authorization_version().unwrap();
        assert_ne!(after_stream.incarnation, before_stream.incarnation);
        assert_eq!(
            crate::auth::sender_proof::sender_replay_epoch(&reopened.conn)
                .expect("rotated sender epoch"),
            predecessor + 1,
        );
        let retained: (i64, i64) = reopened
            .conn
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM _snapback_sender_proof_replay),
                   (SELECT COUNT(*) FROM _snapback_sender_nonce)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("post-reset sender facts");
        assert_eq!(
            retained,
            (0, 0),
            "epoch advance and proof/nonce clearing share the reset transaction",
        );
    }

    #[test]
    fn epoch_exhaustion_refuses_and_rolls_back_permission_commit() {
        let mut db = permission_database(None);
        db.conn
            .execute(
                "UPDATE _snapback_meta SET value = ?1 WHERE key = ?2",
                params![
                    MAX_AUTHORIZATION_EPOCH.to_string(),
                    auth_stream::AUTHORIZATION_EPOCH_META_KEY
                ],
            )
            .expect("set maximum epoch");
        let error = db
            .mutation_writes()
            .execute_mutation(&insert_plan(), &HandlerInput::default())
            .expect_err("nonwrapping epoch must refuse");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTHORIZATION_EPOCH_EXHAUSTED"
        );
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .unwrap()
                .total,
            0
        );
        assert_eq!(
            db.authorization_version().unwrap().epoch,
            MAX_AUTHORIZATION_EPOCH
        );
    }

    #[test]
    fn reset_seed_rolls_back_insert_and_precommit_failures() {
        let mut db = database();
        db.schema_seed()
            .seed(seed_data("old", "old data"))
            .expect("initial seed");
        let predecessor_incarnation = db
            .ensure_authorization_stream_incarnation()
            .expect("initialize authorization stream");
        let predecessor_version = db.authorization_version().unwrap();

        let duplicate_seed = SeedData {
            tables: BTreeMap::from([(
                "items".to_owned(),
                vec![
                    Map::from_iter([
                        ("_id".to_owned(), json!("duplicate")),
                        ("title".to_owned(), json!("first")),
                    ]),
                    Map::from_iter([
                        ("_id".to_owned(), json!("duplicate")),
                        ("title".to_owned(), json!("second")),
                    ]),
                ],
            )]),
        };
        db.schema_seed()
            .reset_and_seed(Some(duplicate_seed))
            .expect_err("duplicate insert must roll back the reset transaction");
        let scan = db
            .query_reads_read()
            .scan_table("items", 10, 0)
            .expect("scan after insert failure");
        assert_eq!(scan.total, 1);
        assert_eq!(scan.rows[0]["_id"], "old");
        assert_eq!(db.current_version().unwrap(), 1);
        assert_eq!(
            db.authorization_stream_incarnation().unwrap(),
            predecessor_incarnation
        );
        assert_eq!(db.authorization_version().unwrap(), predecessor_version);

        BEFORE_RESET_COMMIT_HOOK.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(|| {
                Err(SnapbackError::error(
                    "SNAPBACK_ACTION_TIMEOUT",
                    "storage",
                    "injected reset commit-boundary failure",
                ))
            }));
        });
        db.schema_seed()
            .reset_and_seed(Some(seed_data("new", "new data")))
            .expect_err("precommit injection must roll back the reset transaction");
        let scan = db
            .query_reads_read()
            .scan_table("items", 10, 0)
            .expect("scan after commit-boundary failure");
        assert_eq!(scan.total, 1);
        assert_eq!(scan.rows[0]["_id"], "old");
        assert_eq!(db.current_version().unwrap(), 1);
        assert_eq!(
            db.authorization_stream_incarnation().unwrap(),
            predecessor_incarnation
        );
        assert_eq!(db.authorization_version().unwrap(), predecessor_version);

        db.schema_seed()
            .reset_and_seed(Some(seed_data("new", "new data")))
            .expect("successful reset");
        assert_ne!(
            db.authorization_stream_incarnation().unwrap(),
            predecessor_incarnation
        );
        assert_eq!(db.authorization_version().unwrap().epoch, 0);
    }

    #[test]
    fn oversized_idempotency_result_rolls_back_rows_and_settlement() {
        let mut db = database();
        let input = HandlerInput {
            args: json!({
                "result": "x".repeat(CLIENT_MUTATION_MAX_RESULT_BYTES as usize + 1),
            }),
            ..HandlerInput::default()
        };
        let identity = ClientMutationIdentity::new("cm_large_result", "hostPlan", &input);
        let mut plan = insert_plan();
        // Keep the plan itself comfortably inside the portable artifact bound:
        // production output can be much larger than its expression when it is
        // derived from request data.
        plan.return_value = Some(ReturnValue::Expr(ValueExpr::Arg("result".to_owned())));
        let error = match db.execute_mutation_plan_with_lifecycle(
            &plan,
            &input,
            true,
            Some(&identity),
            &|| Ok(()),
            || Ok(()),
        ) {
            Ok(_) => panic!("oversized retained output must reject the whole transaction"),
            Err(error) => error,
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_RESULT_TOO_LARGE"
        );
        assert_empty(&db);
        assert_eq!(
            db.settlement_read()
                .client_mutation_retention_info()
                .unwrap()
                .records,
            0,
            "a rejected output cannot leave an idempotency row"
        );
    }

    #[test]
    fn retained_mutation_replay_rejects_corrupt_version_metadata() {
        let mut db = database();
        let input = HandlerInput::default();
        let identity = ClientMutationIdentity::new("cm_corrupt_version", "hostPlan", &input);
        let committed = db
            .execute_mutation_plan_with_lifecycle(
                &insert_plan(),
                &input,
                true,
                Some(&identity),
                &|| Ok(()),
                || Ok(()),
            )
            .expect("settle mutation");
        let valid_output =
            serde_json::to_string(&committed.commit.output).expect("encode valid output");

        for (name, version) in [
            ("past-portable-max", json!(PORTABLE_STORAGE_VERSION_MAX + 1)),
            ("negative", json!(-1)),
            ("non-integer-real", json!(1.5)),
            ("non-integer-text", json!("not-a-version")),
            ("missing", Value::Null),
        ] {
            let mut output = serde_json::to_value(&committed.commit.output).unwrap();
            if name == "missing" {
                output.as_object_mut().unwrap().remove("version");
            } else {
                output["version"] = version;
            }
            db.conn
                .execute(
                    "UPDATE _snapback_client_mutations SET output_json = ?1, settled_version = ?2 \
                     WHERE client_mutation_id = ?3",
                    params![
                        output.to_string(),
                        version_to_sql_integer(committed.commit.output.version).unwrap(),
                        identity.id
                    ],
                )
                .expect("corrupt retained output version");
            let error = db
                .settlement_read()
                .client_mutation_result(&identity)
                .expect_err("a corrupt replay output version must not be republished");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name}"
            );
        }

        for (name, settled_version) in [
            ("negative", SqlValue::Integer(-1)),
            (
                "past-portable-max",
                SqlValue::Integer((PORTABLE_STORAGE_VERSION_MAX + 1) as i64),
            ),
            ("non-integer-real", SqlValue::Real(1.5)),
            (
                "non-integer-text",
                SqlValue::Text("not-a-version".to_owned()),
            ),
            ("non-integer-blob", SqlValue::Blob(vec![0x01, 0x02])),
        ] {
            db.conn
                .execute(
                    "UPDATE _snapback_client_mutations SET output_json = ?1, settled_version = ?2 \
                     WHERE client_mutation_id = ?3",
                    params![valid_output, settled_version, identity.id],
                )
                .expect("corrupt retained settlement version");
            let error = db
                .settlement_read()
                .client_mutation_result(&identity)
                .expect_err("a corrupt settlement cursor must not be ignored");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name}"
            );
        }

        for (name, exact_settled_version) in [
            ("negative", SqlValue::Integer(-1)),
            (
                "past-portable-max",
                SqlValue::Integer((PORTABLE_STORAGE_VERSION_MAX + 1) as i64),
            ),
            ("non-integer-real", SqlValue::Real(1.5)),
            (
                "non-integer-text",
                SqlValue::Text("not-a-version".to_owned()),
            ),
            ("non-integer-blob", SqlValue::Blob(vec![0x01, 0x02])),
        ] {
            db.conn
                .execute(
                    "UPDATE _snapback_client_mutations
                     SET output_json = ?1,
                         settled_version = ?2,
                         settled_version_exact = ?3
                     WHERE client_mutation_id = ?4",
                    params![
                        valid_output,
                        version_to_sql_integer(committed.commit.output.version).unwrap(),
                        exact_settled_version,
                        identity.id
                    ],
                )
                .expect("corrupt retained exact settlement version");
            let error = db
                .settlement_read()
                .client_mutation_result(&identity)
                .expect_err("a corrupt exact settlement cursor must not be ignored");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name}"
            );
        }

        db.conn
            .execute(
                "UPDATE _snapback_client_mutations
                 SET output_json = ?1,
                     settled_version = ?2,
                     settled_version_exact = ?3 \
                 WHERE client_mutation_id = ?4",
                params![
                    valid_output,
                    version_to_sql_integer(committed.commit.output.version + 1).unwrap(),
                    version_to_sql_integer(committed.commit.output.version).unwrap(),
                    identity.id
                ],
            )
            .expect("install mismatched settlement version");
        let error = db
            .settlement_read()
            .client_mutation_result(&identity)
            .expect_err("paired durable versions must agree");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");

        db.conn
            .execute(
                "UPDATE _snapback_client_mutations
                 SET settled_version = 0, settled_version_exact = NULL \
                 WHERE client_mutation_id = ?1",
                params![identity.id],
            )
            .expect("install documented legacy sentinel");
        assert_eq!(
            db.settlement_read()
                .client_mutation_result(&identity)
                .expect("legacy sentinel remains readable")
                .expect("retained result")
                .version,
            committed.commit.output.version
        );
    }

    #[test]
    fn exact_zero_settlement_rejects_output_version_drift_live_and_on_reopen() {
        let (_dir, path, mut db) = file_database();
        let input = HandlerInput::default();
        let identity = ClientMutationIdentity::new("cm_exact_zero", "hostPlan", &input);
        let no_op = MutationPlan {
            steps: Vec::new(),
            return_value: Some(ReturnValue::ChangedCount),
        };
        let settled = db
            .execute_mutation_plan_with_lifecycle(
                &no_op,
                &input,
                true,
                Some(&identity),
                &|| Ok(()),
                || Ok(()),
            )
            .expect("settle a no-op at the fresh database head");
        assert_eq!(settled.commit.output.version, 0);
        let exact: SqlValue = db
            .conn
            .query_row(
                "SELECT settled_version_exact FROM _snapback_client_mutations
                 WHERE client_mutation_id = ?1",
                params![identity.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exact, SqlValue::Integer(0));

        let advanced = db
            .mutation_writes()
            .execute_mutation(&insert_plan(), &HandlerInput::default())
            .expect("advance the global head after settlement");
        assert_eq!(advanced.output.version, 1);
        let mut corrupt_output = serde_json::to_value(&settled.commit.output).unwrap();
        corrupt_output["version"] = json!(1);
        db.conn
            .execute(
                "UPDATE _snapback_client_mutations SET output_json = ?1
                 WHERE client_mutation_id = ?2",
                params![corrupt_output.to_string(), identity.id],
            )
            .expect("drift only the replay payload version");

        let live_error = db
            .settlement_read()
            .client_mutation_result(&identity)
            .expect_err("authoritative zero metadata detects live replay drift");
        assert_eq!(
            live_error.diagnostic.code,
            "SNAPBACK_STORAGE_VERSION_CORRUPT"
        );
        drop(db);

        let reopen_error = match LocalDatabase::open(&path) {
            Ok(_) => panic!("corrupt exact-zero settlement unexpectedly reopened"),
            Err(error) => error,
        };
        assert_eq!(
            reopen_error.diagnostic.code,
            "SNAPBACK_STORAGE_VERSION_CORRUPT"
        );
    }

    /// @ref LLP 0255#s32-proposed-pending-llp-0218-and-llp-0043-amendment--declared-custody-and-ambiguous-online-intents — possibly-crossed refusals use
    /// the ordinary bounded settlement ledger and its exact identity/ACK cut.
    #[test]
    fn data_refusal_settlement_is_idempotent_exact_and_ack_capable() {
        let mut db = database();
        let input = HandlerInput::default();
        let identity = ClientMutationIdentity::new("data_refusal_1", "data.tx_deadbeef", &input);
        let diagnostic = Diagnostic::error(
            "SNAPBACK_DATA_TRANSACTION_INVALID",
            "data-transaction",
            "fixture refusal",
        );

        db.settlement()
            .record_data_mutation_refusal(&identity, &input, &diagnostic)
            .expect("record refusal");
        db.settlement()
            .record_data_mutation_refusal(&identity, &input, &diagnostic)
            .expect("exact duplicate is a no-op");
        assert_eq!(
            db.settlement_read()
                .client_mutation_retention_info()
                .unwrap()
                .records,
            1
        );
        assert_eq!(
            db.settlement_read()
                .client_mutation_result(&identity)
                .expect_err("ordinary replay observes the retained refusal")
                .diagnostic,
            diagnostic
        );
        assert!(matches!(
            db.settlement_read()
                .client_mutation_settlement(&identity)
                .expect("status lookup"),
            Some(ClientMutationSettlement::Refused(_))
        ));

        let mismatched = ClientMutationIdentity::new(identity.id.clone(), "data.tx_other", &input);
        assert_eq!(
            db.settlement_read()
                .client_mutation_settlement(&mismatched)
                .expect_err("five-member mismatch must fail closed")
                .diagnostic
                .code,
            "SNAPBACK_CLIENT_MUTATION_ID_REUSED"
        );
        let issued = identity.clone().with_operation_issuance(
            crate::commit_envelope::OperationIssuanceV1::ClientRange {
                epoch_id: "forbidden-data-issuance".to_owned(),
                counter: 1,
                range_start: 1,
                range_end_exclusive: 2,
                authority_authenticator_digest: format!("sha256:{}", "a".repeat(64)),
            },
        );
        assert_eq!(
            db.settlement_read()
                .client_mutation_settlement(&issued)
                .expect_err("absent issuance must compare unequal to present issuance")
                .diagnostic
                .code,
            "SNAPBACK_CLIENT_MUTATION_ID_REUSED"
        );

        assert_eq!(
            db.settlement()
                .acknowledge_client_mutations(
                    &identity.auth_fingerprint,
                    std::slice::from_ref(&identity.id),
                )
                .expect("ACK refusal"),
            1
        );
        assert_eq!(
            db.settlement_read()
                .client_mutation_settlement(&identity)
                .expect("post-ACK lookup"),
            None
        );
    }

    #[test]
    fn retention_record_n_plus_one_refuses_without_losing_replay_or_writes() {
        let _limits = TestRetentionLimits::install(2, u64::MAX);
        let mut db = database();
        let input = HandlerInput::default();
        let first = ClientMutationIdentity::new("cm_record_limit_1", "hostPlan", &input);
        let second = ClientMutationIdentity::new("cm_record_limit_2", "hostPlan", &input);
        for identity in [&first, &second] {
            db.execute_mutation_plan_with_lifecycle(
                &insert_plan(),
                &input,
                true,
                Some(identity),
                &|| Ok(()),
                || Ok(()),
            )
            .expect("settlement below the fixture limit");
        }
        let retained = db
            .settlement_read()
            .client_mutation_retention_info()
            .unwrap();
        assert_eq!(retained.records, 2);
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .unwrap()
                .total,
            4
        );
        assert_eq!(db.current_version().unwrap(), 2);

        let refused = ClientMutationIdentity::new("cm_record_limit_3", "hostPlan", &input);
        let error = match db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input,
            true,
            Some(&refused),
            &|| Ok(()),
            || Ok(()),
        ) {
            Ok(_) => panic!("record N+1 must fail closed"),
            Err(error) => error,
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL"
        );
        assert_eq!(
            db.settlement_read()
                .client_mutation_retention_info()
                .unwrap(),
            retained
        );
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .unwrap()
                .total,
            4
        );
        assert_eq!(db.current_version().unwrap(), 2);
        assert!(
            db.settlement_read()
                .client_mutation_result(&first)
                .unwrap()
                .is_some()
        );
        assert_eq!(
            db.settlement_read()
                .client_mutation_result(&refused)
                .unwrap(),
            None
        );
    }

    #[test]
    fn retention_byte_n_plus_one_refuses_without_losing_replay_or_writes() {
        let mut db = database();
        let input = HandlerInput::default();
        let first = ClientMutationIdentity::new("cm_byte_limit_1", "hostPlan", &input);
        db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input,
            true,
            Some(&first),
            &|| Ok(()),
            || Ok(()),
        )
        .expect("first settlement");
        let retained = db
            .settlement_read()
            .client_mutation_retention_info()
            .unwrap();
        let _limits = TestRetentionLimits::install(10, retained.bytes);

        let refused = ClientMutationIdentity::new("cm_byte_limit_2", "hostPlan", &input);
        let error = match db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input,
            true,
            Some(&refused),
            &|| Ok(()),
            || Ok(()),
        ) {
            Ok(_) => panic!("byte N+1 must fail closed"),
            Err(error) => error,
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL"
        );
        assert_eq!(
            db.settlement_read()
                .client_mutation_retention_info()
                .unwrap(),
            retained
        );
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .unwrap()
                .total,
            2
        );
        assert_eq!(db.current_version().unwrap(), 1);
        assert!(
            db.settlement_read()
                .client_mutation_result(&first)
                .unwrap()
                .is_some()
        );
        assert_eq!(
            db.settlement_read()
                .client_mutation_result(&refused)
                .unwrap(),
            None
        );
    }

    #[test]
    fn per_auth_record_limit_preserves_capacity_for_another_principal() {
        let _limits = TestRetentionLimits::install_all(10, u64::MAX, 2, u64::MAX);
        let mut db = database();
        let input_a = HandlerInput {
            auth: crate::manifest::AuthInput {
                user_id: Some("auth-a".to_owned()),
                ..crate::manifest::AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let input_b = HandlerInput {
            auth: crate::manifest::AuthInput {
                user_id: Some("auth-b".to_owned()),
                ..crate::manifest::AuthInput::default()
            },
            ..HandlerInput::default()
        };
        for suffix in ["1", "2"] {
            let identity =
                ClientMutationIdentity::new(format!("cm_auth_a_{suffix}"), "hostPlan", &input_a);
            db.execute_mutation_plan_with_lifecycle(
                &insert_plan(),
                &input_a,
                true,
                Some(&identity),
                &|| Ok(()),
                || Ok(()),
            )
            .expect("same auth below cap");
        }
        let refused = ClientMutationIdentity::new("cm_auth_a_3", "hostPlan", &input_a);
        let error = match db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input_a,
            true,
            Some(&refused),
            &|| Ok(()),
            || Ok(()),
        ) {
            Ok(_) => panic!("per-auth record N+1 must fail closed"),
            Err(error) => error,
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL"
        );
        assert_eq!(error.diagnostic.details["scope"], "auth");
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .unwrap()
                .total,
            4
        );

        let other = ClientMutationIdentity::new("cm_auth_b_1", "hostPlan", &input_b);
        db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input_b,
            true,
            Some(&other),
            &|| Ok(()),
            || Ok(()),
        )
        .expect("another auth retains independent capacity");
        assert_eq!(
            db.settlement_read()
                .client_mutation_retention_info()
                .unwrap()
                .records,
            3
        );
        assert_eq!(
            client_mutation_auth_retention_counters(&db.conn, &refused.auth_fingerprint)
                .unwrap()
                .0,
            2
        );
        assert_eq!(
            client_mutation_auth_retention_counters(&db.conn, &other.auth_fingerprint)
                .unwrap()
                .0,
            1
        );
    }

    #[test]
    fn per_auth_byte_limit_preserves_capacity_for_another_principal() {
        let mut db = database();
        let input_a = HandlerInput {
            auth: crate::manifest::AuthInput {
                user_id: Some("bytes-a".to_owned()),
                ..crate::manifest::AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let input_b = HandlerInput {
            auth: crate::manifest::AuthInput {
                user_id: Some("bytes-b".to_owned()),
                ..crate::manifest::AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let first = ClientMutationIdentity::new("cm_auth_bytes_a_1", "hostPlan", &input_a);
        db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input_a,
            true,
            Some(&first),
            &|| Ok(()),
            || Ok(()),
        )
        .expect("first auth settlement");
        let (_, auth_bytes) =
            client_mutation_auth_retention_counters(&db.conn, &first.auth_fingerprint).unwrap();
        let _limits = TestRetentionLimits::install_all(10, u64::MAX, 10, auth_bytes);

        let refused = ClientMutationIdentity::new("cm_auth_bytes_a_2", "hostPlan", &input_a);
        let error = match db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input_a,
            true,
            Some(&refused),
            &|| Ok(()),
            || Ok(()),
        ) {
            Ok(_) => panic!("per-auth byte N+1 must fail closed"),
            Err(error) => error,
        };
        assert_eq!(error.diagnostic.details["scope"], "auth");
        assert_eq!(
            db.query_reads_read()
                .scan_table("items", 10, 0)
                .unwrap()
                .total,
            2
        );

        let other = ClientMutationIdentity::new("cm_auth_bytes_b_1", "hostPlan", &input_b);
        db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input_b,
            true,
            Some(&other),
            &|| Ok(()),
            || Ok(()),
        )
        .expect("another auth has an independent byte budget");
        assert_eq!(
            db.settlement_read()
                .client_mutation_retention_info()
                .unwrap()
                .records,
            2
        );
    }

    #[test]
    fn explicit_authenticated_acknowledgement_reclaims_settlement_and_tracks_gc() {
        let mut db = database();
        let input = HandlerInput::default();
        let identity = ClientMutationIdentity::new("cm_ack_1", "hostPlan", &input);
        db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input,
            true,
            Some(&identity),
            &|| Ok(()),
            || Ok(()),
        )
        .expect("settle mutation");
        let retained = db
            .settlement_read()
            .client_mutation_retention_info()
            .unwrap();
        assert_eq!(retained.records, 1);
        assert!(retained.bytes > 0);
        assert_eq!(
            db.settlement()
                .acknowledge_client_mutations("another-auth", std::slice::from_ref(&identity.id))
                .unwrap(),
            0,
            "another authority cannot reclaim the result"
        );
        assert_eq!(
            db.settlement()
                .acknowledge_client_mutations(
                    &identity.auth_fingerprint,
                    &[identity.id.clone(), identity.id.clone()]
                )
                .unwrap(),
            1,
            "duplicate acknowledgements are idempotently deduplicated"
        );
        let reclaimed = db
            .settlement_read()
            .client_mutation_retention_info()
            .unwrap();
        assert_eq!(reclaimed.records, 0);
        assert_eq!(reclaimed.gc_total, 1);
    }

    #[test]
    fn legacy_auth_fingerprint_is_quarantined_from_replay_but_remains_acknowledgeable() {
        let mut db = database();
        let input = HandlerInput {
            auth: crate::manifest::AuthInput {
                principal: Some("legacy-user".to_owned()),
                session_id: Some("legacy-session".to_owned()),
                user_id: Some("legacy-user".to_owned()),
                ..crate::manifest::AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let current = ClientMutationIdentity::new("cm_legacy_auth", "hostPlan", &input);
        let legacy_fingerprint = crate::manifest::legacy_auth_fingerprint(&input.auth);
        let mut legacy = current.clone();
        legacy.auth_fingerprint = legacy_fingerprint.clone();
        db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input,
            true,
            Some(&legacy),
            &|| Ok(()),
            || Ok(()),
        )
        .expect("legacy settlement");
        let before = db
            .settlement_read()
            .client_mutation_retention_info()
            .unwrap();
        let error = db
            .settlement_read()
            .client_mutation_result(&current)
            .expect_err("a 64-bit legacy alias cannot be rebound safely");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED"
        );
        let after = db
            .settlement_read()
            .client_mutation_retention_info()
            .unwrap();
        assert_eq!(
            after, before,
            "quarantine does not rewrite rows or counters"
        );
        assert_eq!(
            client_mutation_auth_retention_counters(&db.conn, &legacy_fingerprint).unwrap(),
            (1, before.bytes)
        );
        assert_eq!(
            db.settlement()
                .acknowledge_client_mutations(
                    &legacy_fingerprint,
                    std::slice::from_ref(&current.id),
                )
                .unwrap(),
            1
        );
        assert_eq!(
            db.settlement_read()
                .client_mutation_retention_info()
                .unwrap()
                .records,
            0
        );
    }

    #[test]
    fn retention_counters_backfill_reopen_and_ack_transactionally() {
        let (_dir, path, mut db) = file_database();
        let input = HandlerInput::default();
        let identity = ClientMutationIdentity::new("cm_counter_reopen", "hostPlan", &input);
        db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input,
            true,
            Some(&identity),
            &|| Ok(()),
            || Ok(()),
        )
        .expect("settle mutation");
        let before = db
            .settlement_read()
            .client_mutation_retention_info()
            .unwrap();
        assert_eq!(before.records, 1);
        assert!(before.bytes > 0);

        // Simulate a database created before the counters existed. Reopen is
        // the only path that scans the retained ledger and installs them.
        db.conn
            .execute(
                "DELETE FROM _snapback_meta WHERE key IN (?1, ?2)",
                params![META_CLIENT_MUTATION_RECORDS, META_CLIENT_MUTATION_BYTES],
            )
            .unwrap();
        drop(db);
        let mut reopened = LocalDatabase::open(&path).expect("reopen and backfill counters");
        assert_eq!(
            reopened
                .settlement_read()
                .client_mutation_retention_info()
                .unwrap(),
            before
        );

        assert_eq!(
            reopened
                .settlement()
                .acknowledge_client_mutations(
                    &identity.auth_fingerprint,
                    std::slice::from_ref(&identity.id),
                )
                .unwrap(),
            1
        );
        let after_ack = reopened
            .settlement_read()
            .client_mutation_retention_info()
            .unwrap();
        assert_eq!(after_ack.records, 0);
        assert_eq!(after_ack.bytes, 0);
        assert_eq!(after_ack.gc_total, 1);
        drop(reopened);

        let reopened = LocalDatabase::open(&path).expect("reopen acknowledged counters");
        assert_eq!(
            reopened
                .settlement_read()
                .client_mutation_retention_info()
                .unwrap(),
            after_ack
        );
    }

    #[test]
    fn admin_recovery_purge_updates_global_and_auth_counters_atomically() {
        let mut db = database();
        let make_input = |user: &str| HandlerInput {
            auth: crate::manifest::AuthInput {
                user_id: Some(user.to_owned()),
                ..crate::manifest::AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let input_a = make_input("purge-a");
        let input_b = make_input("purge-b");
        let identities = [
            ClientMutationIdentity::new("cm_purge_a_1", "hostPlan", &input_a),
            ClientMutationIdentity::new("cm_purge_a_2", "hostPlan", &input_a),
            ClientMutationIdentity::new("cm_purge_b_1", "hostPlan", &input_b),
        ];
        for (identity, input) in [
            (&identities[0], &input_a),
            (&identities[1], &input_a),
            (&identities[2], &input_b),
        ] {
            db.execute_mutation_plan_with_lifecycle(
                &insert_plan(),
                input,
                true,
                Some(identity),
                &|| Ok(()),
                || Ok(()),
            )
            .expect("settle purge fixture");
        }
        assert_eq!(
            db.settlement_read()
                .client_mutation_retention_info()
                .unwrap()
                .records,
            3
        );
        assert_eq!(
            db.settlement()
                .purge_client_mutation_settlements(Some(&identities[0].auth_fingerprint))
                .unwrap(),
            2
        );
        let after_auth = db
            .settlement_read()
            .client_mutation_retention_info()
            .unwrap();
        assert_eq!(after_auth.records, 1);
        assert_eq!(after_auth.gc_total, 0, "admin purge is not client ACK GC");
        assert_eq!(
            client_mutation_auth_retention_counters(&db.conn, &identities[0].auth_fingerprint)
                .unwrap(),
            (0, 0)
        );
        assert!(
            db.settlement_read()
                .client_mutation_result(&identities[0])
                .unwrap()
                .is_none()
        );
        assert!(
            db.settlement_read()
                .client_mutation_result(&identities[2])
                .unwrap()
                .is_some()
        );

        assert_eq!(
            db.settlement()
                .purge_client_mutation_settlements(None)
                .unwrap(),
            1
        );
        let empty = db
            .settlement_read()
            .client_mutation_retention_info()
            .unwrap();
        assert_eq!((empty.records, empty.bytes), (0, 0));
        assert!(
            db.settlement_read()
                .client_mutation_result(&identities[2])
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn covered_operator_purge_is_keyed_by_active_client_stream_not_operation_text() {
        use crate::commit_envelope::{
            OperationIdentityV1, OperationIssuanceV1, OperationOriginatorClassV1,
            OperationSuppressionRecordV1,
        };

        let (_dir, _path, mut db, input, identity) =
            operation_crash_fixture(CoveredWriterFixtureV1::Buffered);
        execute_operation_crash_fixture(
            &mut db,
            CoveredWriterFixtureV1::Buffered,
            &input,
            &identity,
        )
        .expect("settle covered purge target");
        let active_stream = crate::seed_identity::strict_current_data_version_stream(&db.conn)
            .expect("active stream lookup")
            .expect("active stream");
        let (identity_json, record_json): (String, String) = db
            .conn
            .query_row(
                "SELECT identity_json,record_json
                   FROM _snapback_operation_suppression_v1
                  WHERE stream_id=?1 AND originator_class='client' AND operation_id=?2",
                params![active_stream, identity.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("target suppression row");
        let base_identity: OperationIdentityV1 =
            serde_json::from_str(&identity_json).expect("decode target identity");
        let base_record: OperationSuppressionRecordV1 =
            serde_json::from_str(&record_json).expect("decode target suppression");

        let insert_unrelated = |unrelated: OperationIdentityV1| {
            let mut record = base_record.clone();
            record.identity = unrelated.clone();
            let (epoch_id, counter) = match &unrelated.issuance {
                OperationIssuanceV1::ClientRange {
                    epoch_id, counter, ..
                } => (epoch_id.clone(), Some(*counter)),
                OperationIssuanceV1::HostIncarnation { epoch_id, .. } => (epoch_id.clone(), None),
            };
            db.conn
                .execute(
                    "INSERT INTO _snapback_operation_suppression_v1(
                       stream_id,originator_class,operation_id,audience,epoch_id,
                       epoch_sequence,counter,terminal_at_ms,acknowledged_at_ms,
                       identity_json,record_json
                     ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,NULL,?9,?10)",
                    params![
                        unrelated.key.stream_id,
                        match unrelated.key.originator_class {
                            OperationOriginatorClassV1::Client => "client",
                            OperationOriginatorClassV1::Host => "host",
                        },
                        unrelated.key.operation_id,
                        unrelated.bound_facts.audience,
                        epoch_id,
                        1_i64,
                        counter.map(|value| value as i64),
                        record.terminal_at_ms as i64,
                        serde_json::to_string(&unrelated).expect("encode unrelated identity"),
                        serde_json::to_string(&record).expect("encode unrelated suppression"),
                    ],
                )
                .expect("insert unrelated operation partition");
        };

        let mut retired_stream_client = base_identity.clone();
        retired_stream_client.key.stream_id = "retired-stream-fixture".to_owned();
        retired_stream_client.bound_facts.principal_fingerprint =
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_owned();
        insert_unrelated(retired_stream_client);

        let mut host = base_identity;
        host.key.originator_class = OperationOriginatorClassV1::Host;
        host.bound_facts.audience = "host-audience-fixture".to_owned();
        host.bound_facts.principal_fingerprint =
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc".to_owned();
        host.bound_facts.authority_instance_id = "host-authority-fixture".to_owned();
        host.issuance = OperationIssuanceV1::HostIncarnation {
            epoch_id: "host-epoch-fixture".to_owned(),
            upstream_identity: "job:purge-collision".to_owned(),
            commit_ordinal: 0,
            authority_authenticator_digest:
                "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd".to_owned(),
        };
        insert_unrelated(host);

        assert_eq!(
            db.settlement()
                .purge_client_mutation_settlements(Some(&identity.auth_fingerprint))
                .expect("purge exact active client partition"),
            1
        );
        let partitions = db
            .conn
            .prepare(
                "SELECT stream_id,originator_class
                   FROM _snapback_operation_suppression_v1
                  WHERE operation_id=?1 ORDER BY stream_id,originator_class",
            )
            .expect("partition query")
            .query_map(params![identity.id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .expect("partition rows")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect partitions");
        assert_eq!(
            partitions,
            vec![
                (active_stream.clone(), "host".to_owned()),
                ("retired-stream-fixture".to_owned(), "client".to_owned()),
            ],
            "same-text identities in unrelated partitions survive the purge"
        );
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT operation_count FROM _snapback_operation_purges_v1",
                    [],
                    |row| row.get::<_, u64>(0),
                )
                .expect("recorded purge count"),
            1
        );
        let retry = db
            .settlement_read()
            .client_mutation_result(&identity)
            .expect_err("purged exact partition keeps a result-expired tombstone");
        assert_eq!(retry.diagnostic.code, "SNAPBACK_OPERATION_RESULT_EXPIRED");
        assert_eq!(retry.diagnostic.details["outcome"], "committed");
    }

    struct CommitVisibilityGuard {
        reader: Connection,
        active: Arc<AtomicBool>,
        dropped: Arc<AtomicBool>,
        expected_rows: i64,
    }

    impl Drop for CommitVisibilityGuard {
        fn drop(&mut self) {
            let visible: i64 = self
                .reader
                .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
                .expect("guard drop visibility query");
            assert_eq!(
                visible, self.expected_rows,
                "the caller's guard must remain alive through SQLite COMMIT"
            );
            self.active.store(false, Ordering::SeqCst);
            self.dropped.store(true, Ordering::SeqCst);
        }
    }

    #[test]
    fn guarded_host_plan_cancellation_rolls_back_rows_version_and_idempotency() {
        let input = HandlerInput::default();
        let plan = insert_plan();

        let mut during_iteration = database();
        let checks = Cell::new(0_usize);
        let error = during_iteration
            .mutation_writes()
            .execute_mutation_guarded(
                &plan,
                &input,
                || {
                    checks.set(checks.get() + 1);
                    if checks.get() == 3 {
                        Err(cancelled())
                    } else {
                        Ok(())
                    }
                },
                || Ok(()),
            )
            .expect_err("second-step lifecycle check must cancel the transaction");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
        assert_empty(&during_iteration);

        let mut before_commit = permission_database(None);
        let authorization_before = before_commit.authorization_version().unwrap();
        let identity = ClientMutationIdentity::new("cm_host_guard", "hostPlan", &input);
        let error = match before_commit.execute_mutation_plan_with_lifecycle(
            &plan,
            &input,
            true,
            Some(&identity),
            &|| Ok(()),
            || -> SnapbackResult<()> { Err(cancelled()) },
        ) {
            Ok(_) => panic!("precommit cancellation must roll back the transaction"),
            Err(error) => error,
        };
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
        assert_empty(&before_commit);
        assert_eq!(
            before_commit.authorization_version().unwrap(),
            authorization_before
        );
        assert_eq!(
            before_commit
                .settlement_read()
                .client_mutation_result(&identity)
                .expect("idempotency lookup"),
            None,
            "a rejected precommit cannot retain an idempotency result"
        );
    }

    #[test]
    fn guarded_buffered_cancellation_rolls_back_rows_version_and_idempotency() {
        let input = HandlerInput::default();

        let mut during_iteration = database();
        let checks = Cell::new(0_usize);
        let error = during_iteration
            .mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &input,
                buffered_payload(),
                None,
                || {
                    checks.set(checks.get() + 1);
                    if checks.get() == 3 {
                        Err(cancelled())
                    } else {
                        Ok(())
                    }
                },
                || Ok(()),
            )
            .expect_err("second-write lifecycle check must cancel the transaction");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
        assert_empty(&during_iteration);

        let mut before_commit = permission_database(None);
        let authorization_before = before_commit.authorization_version().unwrap();
        let identity = ClientMutationIdentity::new("cm_buffer_guard", "ibex", &input);
        let error = before_commit
            .mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &input,
                buffered_payload(),
                Some(&identity),
                || Ok(()),
                || -> SnapbackResult<()> { Err(cancelled()) },
            )
            .expect_err("buffered precommit cancellation must roll back");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
        assert_empty(&before_commit);
        assert_eq!(
            before_commit.authorization_version().unwrap(),
            authorization_before
        );
        assert_eq!(
            before_commit
                .settlement_read()
                .client_mutation_result(&identity)
                .expect("idempotency lookup"),
            None,
            "a rejected buffered precommit cannot retain an idempotency result"
        );
    }

    #[test]
    fn guarded_host_plan_guard_starts_after_iteration_and_spans_commit() {
        let (_dir, path, mut db) = file_database();
        let reader = Connection::open(path).expect("visibility reader");
        let active = Arc::new(AtomicBool::new(false));
        let dropped = Arc::new(AtomicBool::new(false));
        let saw_guarded_final_check = Arc::new(AtomicBool::new(false));
        let checks_before_guard = Arc::new(AtomicUsize::new(0));

        db.mutation_writes()
            .execute_mutation_guarded(
                &insert_plan(),
                &HandlerInput::default(),
                {
                    let active = active.clone();
                    let saw_guarded_final_check = saw_guarded_final_check.clone();
                    let checks_before_guard = checks_before_guard.clone();
                    move || {
                        if active.load(Ordering::SeqCst) {
                            saw_guarded_final_check.store(true, Ordering::SeqCst);
                        } else {
                            checks_before_guard.fetch_add(1, Ordering::SeqCst);
                        }
                        Ok(())
                    }
                },
                {
                    let active = active.clone();
                    let dropped = dropped.clone();
                    let checks_before_guard = checks_before_guard.clone();
                    move || {
                        assert!(
                            checks_before_guard.load(Ordering::SeqCst) >= 3,
                            "plan iteration must finish before gate acquisition"
                        );
                        active.store(true, Ordering::SeqCst);
                        Ok(CommitVisibilityGuard {
                            reader,
                            active,
                            dropped,
                            expected_rows: 2,
                        })
                    }
                },
            )
            .expect("guarded host plan commit");

        assert!(saw_guarded_final_check.load(Ordering::SeqCst));
        assert!(dropped.load(Ordering::SeqCst));
        assert!(!active.load(Ordering::SeqCst));
        assert_eq!(db.current_version().unwrap(), 1);
    }

    #[test]
    fn guarded_buffered_guard_starts_after_iteration_and_spans_commit() {
        let (_dir, path, mut db) = file_database();
        let reader = Connection::open(path).expect("visibility reader");
        let active = Arc::new(AtomicBool::new(false));
        let dropped = Arc::new(AtomicBool::new(false));
        let saw_guarded_final_check = Arc::new(AtomicBool::new(false));
        let checks_before_guard = Arc::new(AtomicUsize::new(0));

        db.mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &HandlerInput::default(),
                buffered_payload(),
                None,
                {
                    let active = active.clone();
                    let saw_guarded_final_check = saw_guarded_final_check.clone();
                    let checks_before_guard = checks_before_guard.clone();
                    move || {
                        if active.load(Ordering::SeqCst) {
                            saw_guarded_final_check.store(true, Ordering::SeqCst);
                        } else {
                            checks_before_guard.fetch_add(1, Ordering::SeqCst);
                        }
                        Ok(())
                    }
                },
                {
                    let active = active.clone();
                    let dropped = dropped.clone();
                    let checks_before_guard = checks_before_guard.clone();
                    move || {
                        assert!(
                            checks_before_guard.load(Ordering::SeqCst) >= 3,
                            "buffered iteration must finish before gate acquisition"
                        );
                        active.store(true, Ordering::SeqCst);
                        Ok(CommitVisibilityGuard {
                            reader,
                            active,
                            dropped,
                            expected_rows: 2,
                        })
                    }
                },
            )
            .expect("guarded buffered commit");

        assert!(saw_guarded_final_check.load(Ordering::SeqCst));
        assert!(dropped.load(Ordering::SeqCst));
        assert!(!active.load(Ordering::SeqCst));
        assert_eq!(db.current_version().unwrap(), 1);
    }

    #[test]
    fn buffered_commit_uses_the_invocation_ledger_clock_everywhere() {
        let mut db = database();
        let input = HandlerInput::default();
        let mut ledger = ledger();
        ledger.now = 123_456_789;
        let commit = db
            .mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &input,
                BufferedCommitPayload {
                    writes: buffered_writes(),
                    sequence_allocations: Vec::new(),
                    membership_plans: Vec::new(),
                    read_dependencies: Vec::new(),
                    result: json!({ "now": ledger.now }),
                    ctx_ledger: ledger.clone(),
                    job_enqueues: Vec::new(),
                    job_producer: None,
                    asset_admissions: Vec::new(),
                    asset_grant_ops: Vec::new(),
                    media_projection_proof: None,
                    expected_media_projection_binding: None,
                },
                None,
                || Ok(()),
                || Ok(()),
            )
            .expect("buffered commit");

        assert_eq!(commit.output.ctx_ledger, Some(ledger.clone()));
        assert_eq!(commit.output.result["now"], json!(ledger.now));
        for change in &commit.changes {
            let row = change.row.as_ref().expect("insert row");
            assert_eq!(row["_createdAt"], json!(ledger.now));
            assert_eq!(row["_updatedAt"], json!(ledger.now));
        }
        let (minimum, maximum): (i64, i64) = db
            .conn
            .query_row(
                "SELECT MIN(changed_at_ms), MAX(changed_at_ms) FROM _snapback_changes",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("journal timestamps");
        assert_eq!((minimum, maximum), (ledger.now as i64, ledger.now as i64));
    }

    #[test]
    fn ordered_queries_are_null_last_and_id_stable_in_both_directions() {
        let mut db = database();
        let rows = [
            json!({ "_id": "n", "title": "null", "rank": null }),
            json!({ "_id": "b", "title": "tie-b", "rank": 1 }),
            json!({ "_id": "a", "title": "tie-a", "rank": 1 }),
            json!({ "_id": "z", "title": "high", "rank": 2 }),
        ]
        .into_iter()
        .map(|row| row.as_object().cloned().expect("seed row"))
        .collect();
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([("items".to_owned(), rows)]),
            })
            .expect("seed ordering fixture");

        let ids = |direction, limit| {
            db.query_reads_read()
                .query(
                    &QueryPlan {
                        table_visibility: None,
                        table: "items".to_owned(),
                        filters: Vec::new(),
                        order: vec![crate::manifest::OrderExpr {
                            field: "rank".to_owned(),
                            direction,
                            max_encoded_bytes: None,
                        }],
                        limit,
                        membership_filters: Vec::new(),
                        indexed_by: None,
                    },
                    &HandlerInput::default(),
                )
                .expect("ordered query")
                .rows
                .into_iter()
                .map(|row| row["_id"].as_str().expect("row id").to_owned())
                .collect::<Vec<_>>()
        };

        assert_eq!(
            ids(OrderDirection::Asc, None),
            ["a", "b", "z", "n"],
            "ASC must put NULL last and break ties by _id"
        );
        assert_eq!(
            ids(OrderDirection::Desc, None),
            ["z", "a", "b", "n"],
            "DESC must still put NULL last and break ties by _id"
        );
        assert_eq!(ids(OrderDirection::Asc, Some(2)), ["a", "b"]);
    }

    #[test]
    fn json_order_fields_fail_closed_before_sql_or_overlay_execution() {
        let db = database();
        let error = db
            .query_reads_read()
            .query(
                &QueryPlan {
                    table_visibility: None,
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    order: vec![crate::manifest::OrderExpr {
                        field: "metadata".to_owned(),
                        direction: OrderDirection::Asc,
                        max_encoded_bytes: None,
                    }],
                    limit: Some(1),
                    membership_filters: Vec::new(),
                    indexed_by: None,
                },
                &HandlerInput::default(),
            )
            .expect_err("Json field ordering has no portable scalar comparator");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_QUERY_ORDER_UNSUPPORTED_FIELD_TYPE"
        );
        assert_eq!(error.diagnostic.details["field"], "metadata");
        assert_eq!(error.diagnostic.details["fieldType"], "Json");
    }
}

// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the
//   write-path acceptance suite: the writer-class seam, the closed transition
//   matrix and its negatives, field-binding, the eligible-holder invariant (the
//   two-step schedule and the concurrent-finals race), witnesses, and the sweep.
#[cfg(test)]
mod membership_write_tests {
    use super::*;
    use crate::manifest::MembershipTransition;

    fn membership_schema() -> SchemaManifest {
        let string = |name: &str, optional: bool| FieldManifest {
            name: name.to_owned(),
            field_type: FieldType::String,
            optional,
        };
        let transition = |op: MembershipOp,
                          by: &[&str],
                          target: MembershipTarget,
                          from: Option<&[&str]>,
                          to: Option<&[&str]>,
                          fields: Option<&[&str]>| {
            crate::manifest::MembershipTransition {
                op,
                by: by.iter().map(|s| s.to_string()).collect(),
                target,
                from: from.map(|f| f.iter().map(|s| s.to_string()).collect()),
                to: to.map(|t| t.iter().map(|s| s.to_string()).collect()),
                fields: fields.map(|f| f.iter().map(|s| s.to_string()).collect()),
            }
        };
        use MembershipOp::*;
        use MembershipTarget::{Other, Own};
        SchemaManifest {
            tables: vec![
                TableManifest {
                    name: "events".to_owned(),
                    fields: vec![string("title", true)],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                },
                TableManifest {
                    name: "event_members".to_owned(),
                    fields: vec![
                        FieldManifest {
                            name: "userId".to_owned(),
                            field_type: FieldType::Principal,
                            optional: false,
                        },
                        FieldManifest {
                            name: "eventId".to_owned(),
                            field_type: FieldType::Id {
                                table: "events".to_owned(),
                            },
                            optional: false,
                        },
                        string("role", false),
                        FieldManifest {
                            name: "expiresAt".to_owned(),
                            field_type: FieldType::Integer,
                            optional: true,
                        },
                        string("notifyPrefs", true),
                    ],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: Some(MembershipManifest {
                        id: None,
                        principal: "userId".to_owned(),
                        resource: Some("eventId".to_owned()),
                        role: "role".to_owned(),
                        roles: ["host", "cohost", "guest"]
                            .iter()
                            .map(|s| s.to_string())
                            .collect(),
                        pending_roles: Some(vec!["invited".to_owned()]),
                        bootstrap_role: Some("host".to_owned()),
                        last_holder: Some(crate::manifest::MembershipLastHolder {
                            protect: "host".to_owned(),
                        }),
                        expiry: Some(crate::manifest::MembershipExpiry {
                            field: "expiresAt".to_owned(),
                            on_expiry: "remove".to_owned(),
                        }),
                        incidental: Some(vec!["notifyPrefs".to_owned()]),
                        provenance: Some(MembershipProvenance::Full),
                        transitions: vec![
                            transition(
                                Insert,
                                &["host", "cohost"],
                                Other,
                                None,
                                Some(&["invited"]),
                                None,
                            ),
                            transition(Insert, &["none"], Own, None, Some(&["guest"]), None),
                            transition(
                                SetRole,
                                &["self"],
                                Own,
                                Some(&["invited"]),
                                Some(&["guest"]),
                                None,
                            ),
                            transition(
                                SetRole,
                                &["host"],
                                Other,
                                Some(&["guest"]),
                                Some(&["cohost"]),
                                None,
                            ),
                            transition(
                                SetRole,
                                &["host"],
                                Other,
                                Some(&["cohost"]),
                                Some(&["guest"]),
                                None,
                            ),
                            transition(
                                SetRole,
                                &["host"],
                                Other,
                                Some(&["cohost"]),
                                Some(&["host"]),
                                None,
                            ),
                            transition(
                                Remove,
                                &["self"],
                                Own,
                                Some(&["invited", "guest", "cohost", "host"]),
                                None,
                                None,
                            ),
                            transition(
                                Remove,
                                &["host"],
                                Other,
                                Some(&["guest", "cohost"]),
                                None,
                                None,
                            ),
                            transition(Patch, &["host"], Other, None, None, Some(&["expiresAt"])),
                            transition(Patch, &["self"], Own, None, None, Some(&["notifyPrefs"])),
                        ],
                        scope: MembershipScope::Resource,
                        resource_table: Some("events".to_owned()),
                        principal_addressed_writes: None,
                    }),
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                },
            ],
            ..SchemaManifest::default()
        }
    }

    fn ready_db() -> LocalDatabase {
        ready_db_with_schema(membership_schema())
    }

    fn ready_db_with_schema(schema: SchemaManifest) -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.activate_current_auth_catalog().expect("auth catalog");
        db.schema_seed().apply_schema(schema).expect("apply schema");
        db
    }

    #[test]
    fn corrupt_membership_row_versions_fail_closed_during_transition_planning() {
        for (name, version) in [
            ("negative", SqlValue::Integer(-1_i64)),
            (
                "past-portable-max",
                SqlValue::Integer((PORTABLE_STORAGE_VERSION_MAX + 1) as i64),
            ),
            ("non-integer-real", SqlValue::Real(1.5)),
            (
                "non-integer-text",
                SqlValue::Text("not-a-version".to_owned()),
            ),
            ("non-integer-blob", SqlValue::Blob(vec![0x01, 0x02])),
        ] {
            let mut db = ready_db();
            let (_, host_id) = create_event(&mut db, "alice");
            db.conn
                .execute(
                    "UPDATE event_members SET _version = ?1 WHERE _id = ?2",
                    params![version, host_id],
                )
                .expect("corrupt membership row version");
            let error = db
                .membership_plans()
                .plan_membership_remove(&user("alice"), "event_members", &host_id)
                .expect_err("a corrupt membership cursor must not enter a plan");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name}"
            );
        }
    }

    #[test]
    fn unrelated_seed_cannot_legitimize_future_membership_activation_sources() {
        for source in ["holder", "resource"] {
            let mut schema = membership_schema();
            schema.tables.push(TableManifest {
                name: "notes".to_owned(),
                fields: vec![FieldManifest {
                    name: "value".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                }],
                indexes: Vec::new(),
                syncable: false,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            });
            let mut db = ready_db_with_schema(schema);
            let (event_id, host_id) = create_event(&mut db, "alice");
            let head = db.current_version().unwrap();
            let (table, id) = if source == "holder" {
                ("event_members", host_id.as_str())
            } else {
                ("events", event_id.as_str())
            };
            db.conn
                .execute(
                    &format!(
                        "UPDATE {} SET _version = ?1 WHERE _id = ?2",
                        quote_ident(table).unwrap()
                    ),
                    params![(head + 1) as i64, id],
                )
                .unwrap();
            let seed = SeedData {
                tables: BTreeMap::from([(
                    "notes".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), json!(format!("note-{source}"))),
                        ("value".to_owned(), json!("unrelated")),
                    ])],
                )]),
            };

            let preview_error = db
                .schema_seed()
                .preview_seed_changes(seed.clone())
                .expect_err("preview must preflight every activation source");
            assert_eq!(
                preview_error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{source} preview"
            );
            let commit_error = db
                .schema_seed()
                .seed(seed)
                .expect_err("commit must not let an unrelated seed advance over corruption");
            assert_eq!(
                commit_error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{source} commit"
            );
            assert_eq!(db.current_version().unwrap(), head);
            let notes: i64 = db
                .conn
                .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
                .unwrap();
            assert_eq!(notes, 0);
        }
    }

    #[test]
    fn corrupt_resource_versions_fail_closed_during_membership_insert_planning() {
        for (name, version) in [
            ("negative", SqlValue::Integer(-1_i64)),
            (
                "past-portable-max",
                SqlValue::Integer((PORTABLE_STORAGE_VERSION_MAX + 1) as i64),
            ),
            ("non-integer-real", SqlValue::Real(1.5)),
            (
                "non-integer-text",
                SqlValue::Text("not-a-version".to_owned()),
            ),
            ("non-integer-blob", SqlValue::Blob(vec![0x01, 0x02])),
        ] {
            let mut db = ready_db();
            let (event_id, _) = create_event(&mut db, "alice");
            db.conn
                .execute(
                    "UPDATE events SET _version = ?1 WHERE _id = ?2",
                    params![version, event_id],
                )
                .expect("corrupt resource row version");
            let values = Map::from_iter([
                ("userId".to_owned(), json!("bob")),
                ("eventId".to_owned(), json!(event_id)),
                ("role".to_owned(), json!("invited")),
            ]);
            let error = db
                .membership_plans()
                .plan_membership_insert(&user("alice"), "event_members", values)
                .expect_err("a corrupt resource cursor must not enter a plan");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name}"
            );
        }
    }

    #[test]
    fn corrupt_membership_transition_versions_fail_closed_during_log_reads() {
        for (name, version) in [
            (
                "past-portable-max",
                SqlValue::Integer((PORTABLE_STORAGE_VERSION_MAX + 1) as i64),
            ),
            ("non-integer-real", SqlValue::Real(1.5)),
            (
                "non-integer-text",
                SqlValue::Text("not-a-version".to_owned()),
            ),
            ("non-integer-blob", SqlValue::Blob(vec![0x01, 0x02])),
        ] {
            let mut db = ready_db();
            create_event(&mut db, "alice");
            db.conn
                .execute(
                    "UPDATE _snapback_membership_transitions SET commit_version = ?1 \
                     WHERE declaration_id = 'event_members'",
                    params![version],
                )
                .expect("corrupt transition commit version");
            let error = db
                .membership_transition_log("event_members")
                .expect_err("a malformed commit cursor must not enter an audit record");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name}"
            );
        }
    }

    #[test]
    fn corrupt_expired_membership_versions_fail_closed_during_sweep_planning() {
        for (name, version) in [
            ("negative", SqlValue::Integer(-1_i64)),
            (
                "past-portable-max",
                SqlValue::Integer((PORTABLE_STORAGE_VERSION_MAX + 1) as i64),
            ),
            ("non-integer-real", SqlValue::Real(1.5)),
            (
                "non-integer-text",
                SqlValue::Text("not-a-version".to_owned()),
            ),
            ("non-integer-blob", SqlValue::Blob(vec![0x01, 0x02])),
        ] {
            let mut db = ready_db();
            let (_, host_id) = create_event(&mut db, "alice");
            db.conn
                .execute(
                    "UPDATE event_members SET expiresAt = 10, _version = ?1 WHERE _id = ?2",
                    params![version, host_id],
                )
                .expect("corrupt expired membership row version");
            let error = db
                .membership_plans()
                .plan_membership_sweep_expired(&MembershipWriter::System, "event_members", 100)
                .expect_err("a corrupt sweep cursor must not enter a system plan");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name}"
            );
        }
    }

    #[test]
    fn membership_sweep_rejects_an_unrepresentable_time_floor() {
        let mut db = ready_db();
        create_event(&mut db, "alice");
        let error = db
            .membership_plans()
            .plan_membership_sweep_expired(&MembershipWriter::System, "event_members", u64::MAX)
            .expect_err("the sweep clock must fit the portable SQLite domain");
        assert_eq!(error.diagnostic.code, "SNAPBACK_TIMESTAMP_OUT_OF_RANGE");
    }

    #[test]
    fn membership_transition_grammar_rejects_empty_forbidden_and_unreachable_shapes() {
        let invalid = [
            crate::manifest::MembershipTransition {
                op: MembershipOp::Insert,
                by: vec!["none".to_owned()],
                target: MembershipTarget::Own,
                from: Some(vec!["guest".to_owned()]),
                to: Some(vec!["guest".to_owned()]),
                fields: None,
            },
            crate::manifest::MembershipTransition {
                op: MembershipOp::SetRole,
                by: vec!["host".to_owned()],
                target: MembershipTarget::Other,
                from: Some(vec!["guest".to_owned()]),
                to: None,
                fields: None,
            },
            crate::manifest::MembershipTransition {
                op: MembershipOp::Remove,
                by: vec!["host".to_owned()],
                target: MembershipTarget::Other,
                from: None,
                to: Some(vec!["guest".to_owned()]),
                fields: None,
            },
            crate::manifest::MembershipTransition {
                op: MembershipOp::Patch,
                by: Vec::new(),
                target: MembershipTarget::Other,
                from: None,
                to: None,
                fields: Some(vec!["expiresAt".to_owned()]),
            },
            crate::manifest::MembershipTransition {
                op: MembershipOp::Patch,
                by: vec!["host".to_owned()],
                target: MembershipTarget::Own,
                from: None,
                to: None,
                fields: Some(vec!["expiresAt".to_owned()]),
            },
        ];
        for transition in invalid {
            let mut schema = membership_schema();
            schema.tables[1].membership.as_mut().unwrap().transitions = vec![transition];
            let error = validate_schema(&schema).expect_err("invalid transition grammar");
            assert!(
                matches!(
                    error.diagnostic.code.as_str(),
                    "SNAPBACK_MEMBERSHIP_TRANSITION_GRAMMAR"
                        | "SNAPBACK_MEMBERSHIP_TRANSITION_EMPTY_SET"
                ),
                "unexpected diagnostic: {:?}",
                error.diagnostic
            );
        }
    }

    #[test]
    fn membership_authoring_and_activation_share_closed_invariant_fixtures() {
        #[derive(Deserialize)]
        struct ParityCase {
            name: String,
            kind: String,
            value: String,
            #[serde(rename = "codegenCode")]
            codegen_code: String,
            #[serde(rename = "activationCode")]
            activation_code: String,
        }

        let cases: Vec<ParityCase> = serde_json::from_str(include_str!(
            "../../tests/fixtures/membership-validation-parity-v0.json"
        ))
        .expect("shared membership validation parity corpus");
        assert!(!cases.is_empty());
        for case in cases {
            assert!(
                case.codegen_code.starts_with("SCHEMA_MEMBERSHIP_"),
                "{} must name its authoring diagnostic",
                case.name
            );
            let mut schema = membership_schema();
            let table = &mut schema.tables[1];
            match case.kind.as_str() {
                "reservedProvenance" => table.fields.push(FieldManifest {
                    name: case.value.clone(),
                    field_type: FieldType::String,
                    optional: true,
                }),
                "generatedIndexCollision" => {
                    table.indexes.push(crate::manifest::IndexManifest {
                        name: case.value.clone(),
                        fields: vec!["userId".to_owned()],
                        unique: false,
                        where_applicable: false,
                    });
                }
                "roleCallerTargetsSelf" | "selfCallerTargetsOther" | "patchAxis" => {
                    let (op, by, target, from, to, fields) =
                        match (case.kind.as_str(), case.value.as_str()) {
                            ("roleCallerTargetsSelf", "insert") => (
                                MembershipOp::Insert,
                                vec!["host".to_owned()],
                                MembershipTarget::Own,
                                None,
                                Some(vec!["guest".to_owned()]),
                                None,
                            ),
                            ("roleCallerTargetsSelf", "setRole") => (
                                MembershipOp::SetRole,
                                vec!["host".to_owned()],
                                MembershipTarget::Own,
                                Some(vec!["guest".to_owned()]),
                                Some(vec!["host".to_owned()]),
                                None,
                            ),
                            ("roleCallerTargetsSelf", "remove") => (
                                MembershipOp::Remove,
                                vec!["host".to_owned()],
                                MembershipTarget::Own,
                                Some(vec!["guest".to_owned()]),
                                None,
                                None,
                            ),
                            ("roleCallerTargetsSelf", "patch") => (
                                MembershipOp::Patch,
                                vec!["host".to_owned()],
                                MembershipTarget::Own,
                                None,
                                None,
                                Some(vec!["notifyPrefs".to_owned()]),
                            ),
                            ("selfCallerTargetsOther", "setRole") => (
                                MembershipOp::SetRole,
                                vec!["self".to_owned()],
                                MembershipTarget::Other,
                                Some(vec!["guest".to_owned()]),
                                Some(vec!["host".to_owned()]),
                                None,
                            ),
                            ("selfCallerTargetsOther", "remove") => (
                                MembershipOp::Remove,
                                vec!["self".to_owned()],
                                MembershipTarget::Other,
                                Some(vec!["guest".to_owned()]),
                                None,
                                None,
                            ),
                            ("selfCallerTargetsOther", "patch") => (
                                MembershipOp::Patch,
                                vec!["self".to_owned()],
                                MembershipTarget::Other,
                                None,
                                None,
                                Some(vec!["notifyPrefs".to_owned()]),
                            ),
                            ("patchAxis", field) => (
                                MembershipOp::Patch,
                                vec!["self".to_owned()],
                                MembershipTarget::Own,
                                None,
                                None,
                                Some(vec![field.to_owned()]),
                            ),
                            _ => panic!("unknown parity case {}", case.name),
                        };
                    table
                        .membership
                        .as_mut()
                        .expect("membership declaration")
                        .transitions = vec![crate::manifest::MembershipTransition {
                        op,
                        by,
                        target,
                        from,
                        to,
                        fields,
                    }];
                }
                _ => panic!("unknown parity kind {}", case.kind),
            }
            let error = match validate_schema(&schema) {
                Ok(()) => panic!("{} unexpectedly activated", case.name),
                Err(error) => error,
            };
            assert_eq!(
                error.diagnostic.code, case.activation_code,
                "shared parity case {}",
                case.name
            );
        }
    }

    #[test]
    fn app_membership_rejects_resource_bootstrap_role_at_manifest_load() {
        let mut schema = membership_schema();
        let membership = schema.tables[1]
            .membership
            .as_mut()
            .expect("membership declaration");
        membership.scope = MembershipScope::App;
        membership.resource = None;
        membership.resource_table = None;
        membership.last_holder = None;

        let error = validate_schema(&schema)
            .expect_err("app scope has no resource creation witness for bootstrapRole");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_BOOTSTRAP_APP_SCOPE"
        );
    }

    #[test]
    fn autonomous_service_principal_writer_preserves_its_grant() {
        let authority = crate::auth::invocation::ResolvedAppAuthority::ServicePrincipal {
            actor_user_id: "agent-a".to_owned(),
            credential_id: "credential-a".to_owned(),
            credential_generation: 7,
            grant_id: "grant-autonomous".to_owned(),
            token_id: "token-a".to_owned(),
            effective_user_id: None,
            scopes: Vec::new(),
            token_expires_at_ms: 10_000,
            integration_status: None,
        };
        let writer = MembershipWriter::from_resolved(&authority);
        assert_eq!(writer.effective_principal(), Some("agent-a"));
        let provenance = writer.provenance().expect("service provenance");
        assert_eq!(provenance.actor, "agent-a");
        assert_eq!(provenance.effective, "agent-a");
        assert_eq!(provenance.grant.as_deref(), Some("grant-autonomous"));
        assert_eq!(provenance.writer_class, "autonomous");

        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        let plan = db
            .membership_plans()
            .plan_membership_insert(
                &writer,
                "event_members",
                Map::from_iter([
                    ("userId".to_owned(), json!("agent-a")),
                    ("eventId".to_owned(), json!(event_id)),
                    ("role".to_owned(), json!("guest")),
                ]),
            )
            .expect("autonomous open-join plan");
        let commit = db
            .membership_plans()
            .commit_membership_plan(&writer, plan)
            .expect("autonomous open-join commit");
        let membership_id = commit_id_for_table(&commit, "event_members");
        assert_eq!(
            db.membership_creation_provenance("event_members", &membership_id)
                .expect("creation provenance"),
            Some(MembershipCreationProvenance {
                actor: "agent-a".to_owned(),
                effective: "agent-a".to_owned(),
                grant: Some("grant-autonomous".to_owned()),
            })
        );
    }

    #[test]
    fn mixed_resource_delete_cannot_spend_a_stale_membership_insert_plan() {
        let mut schema = membership_schema();
        let membership = schema
            .tables
            .iter_mut()
            .find(|table| table.name == "event_members")
            .and_then(|table| table.membership.as_mut())
            .expect("event membership declaration");
        membership.last_holder = None;
        membership.bootstrap_role = None;

        let mut db = LocalDatabase::memory().expect("memory database");
        db.activate_current_auth_catalog().expect("auth catalog");
        db.schema_seed()
            .apply_schema(schema)
            .expect("apply unprotected schema");
        let event_id = "event-empty";
        db.mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Insert {
                    table: "events".to_owned(),
                    id: event_id.to_owned(),
                    values: Map::from_iter([("title".to_owned(), json!("empty event"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("create empty resource");

        let writer = user("alice");
        let plan = db
            .membership_plans()
            .plan_membership_insert(
                &writer,
                "event_members",
                Map::from_iter([
                    ("userId".to_owned(), json!("alice")),
                    ("eventId".to_owned(), json!(event_id)),
                    ("role".to_owned(), json!("guest")),
                ]),
            )
            .expect("plan open join while resource exists");
        let error = db
            .mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &HandlerInput::default(),
                BufferedCommitPayload {
                    writes: vec![BufferedWrite::Delete {
                        table: "events".to_owned(),
                        id: event_id.to_owned(),
                    }],
                    sequence_allocations: Vec::new(),
                    membership_plans: vec![AuthorizedMembershipPlan::user_transition(writer, plan)],
                    read_dependencies: Vec::new(),
                    result: Value::Null,
                    asset_admissions: Vec::new(),
                    ctx_ledger: CtxAnswerLedger {
                        version: CTX_ANSWER_LEDGER_VERSION,
                        ids: Vec::new(),
                        now: 1,
                        auth_fingerprint: None,
                    },
                    job_enqueues: Vec::new(),
                    job_producer: None,
                    asset_grant_ops: Vec::new(),
                    media_projection_proof: None,
                    expected_media_projection_binding: None,
                },
                None,
                || Ok(()),
                || Ok(()),
            )
            .expect_err("mixed delete must not orphan the sanctioned membership insert");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING"
        );
        assert!(
            db.query_reads_read()
                .get("events", event_id)
                .expect("resource read")
                .is_some()
        );
        assert_eq!(
            db.query_reads_read()
                .scan_table("event_members", 10, 0)
                .expect("membership scan")
                .total,
            0
        );
    }

    fn user(principal: &str) -> MembershipWriter {
        MembershipWriter::User {
            effective_principal: principal.to_owned(),
        }
    }

    fn seed_agent(db: &mut LocalDatabase, id: &str) {
        db.create_agent_principal(
            id,
            0,
            &crate::storage::auth_agents::AgentRegistration {
                display_name: None,
                operator_contact: None,
                registration_provenance: json!({ "invitedBy": "open" }).to_string(),
                owner_user_id: None,
            },
        )
        .expect("create agent");
    }

    fn commit_id_for_table(commit: &MutationCommit, table: &str) -> String {
        commit
            .changes
            .iter()
            .find(|change| change.table == table)
            .map(|change| change.id.clone())
            .unwrap_or_else(|| panic!("no change for table {table}"))
    }

    /// Bootstrap an event with `host` seated. Returns (event_id, host_member_id).
    fn create_event(db: &mut LocalDatabase, host: &str) -> (String, String) {
        let writer = user(host);
        let mut values = Map::new();
        values.insert("title".to_owned(), json!("party"));
        let plan = db
            .membership_plans()
            .plan_membership_bootstrap(&writer, "events", values, "event_members")
            .expect("bootstrap plan");
        let commit = db
            .membership_plans()
            .commit_membership_plan(&writer, plan)
            .expect("bootstrap commit");
        let event_id = commit_id_for_table(&commit, "events");
        let host_id = commit_id_for_table(&commit, "event_members");
        (event_id, host_id)
    }

    fn member_id(db: &LocalDatabase, event_id: &str, principal: &str) -> String {
        db.conn
            .query_row(
                "SELECT _id FROM event_members WHERE eventId = ?1 AND userId = ?2",
                params![event_id, principal],
                |row| row.get::<_, String>(0),
            )
            .unwrap_or_else(|_| panic!("no member row for {principal} on {event_id}"))
    }

    fn role_of(db: &LocalDatabase, member_id: &str) -> Option<String> {
        db.conn
            .query_row(
                "SELECT role FROM event_members WHERE _id = ?1",
                params![member_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .expect("query role")
    }

    fn invite(db: &mut LocalDatabase, host: &str, event_id: &str, invitee: &str) {
        let writer = user(host);
        let mut values = Map::new();
        values.insert("userId".to_owned(), json!(invitee));
        values.insert("eventId".to_owned(), json!(event_id));
        values.insert("role".to_owned(), json!("invited"));
        let plan = db
            .membership_plans()
            .plan_membership_insert(&writer, "event_members", values)
            .expect("invite plan");
        db.membership_plans()
            .commit_membership_plan(&writer, plan)
            .expect("invite commit");
    }

    fn set_role(
        db: &mut LocalDatabase,
        actor: &str,
        member_id: &str,
        to: &str,
    ) -> SnapbackResult<()> {
        let writer = user(actor);
        let plan = db.membership_plans().plan_membership_set_role(
            &writer,
            "event_members",
            member_id,
            to,
        )?;
        db.membership_plans()
            .commit_membership_plan(&writer, plan)
            .map(|_| ())
    }

    /// Seat a second, real `host` by promoting an invited principal all the way up.
    fn promote_to_host(db: &mut LocalDatabase, host: &str, event_id: &str, target: &str) {
        invite(db, host, event_id, target);
        let mid = member_id(db, event_id, target);
        set_role(db, target, &mid, "guest").expect("accept");
        set_role(db, host, &mid, "cohost").expect("promote cohost");
        set_role(db, host, &mid, "host").expect("promote host");
    }

    /// The membership fixture with the LLP 0100 §2 opt-in: a TOTAL
    /// other-principal removal carrier (`from` omitted) whose caller class is
    /// the lastHolder-protected role, plus `principalAddressedWrites`.
    fn principal_addressed_schema() -> SchemaManifest {
        let mut schema = membership_schema();
        let membership = schema
            .tables
            .iter_mut()
            .find(|table| table.name == "event_members")
            .and_then(|table| table.membership.as_mut())
            .expect("membership fixture");
        membership.transitions.push(MembershipTransition {
            op: MembershipOp::Remove,
            by: vec!["host".to_owned()],
            target: MembershipTarget::Other,
            from: None,
            to: None,
            fields: None,
        });
        membership.principal_addressed_writes =
            Some(crate::manifest::MembershipPrincipalAddressedWrites { remove: true });
        schema
    }

    fn seat_guest(db: &mut LocalDatabase, host: &str, event_id: &str, target: &str) {
        invite(db, host, event_id, target);
        let mid = member_id(db, event_id, target);
        set_role(db, target, &mid, "guest").expect("accept invite");
    }

    fn remove_principal(
        db: &mut LocalDatabase,
        caller: &str,
        event_id: &str,
        principal: &str,
    ) -> SnapbackResult<Value> {
        let writer = user(caller);
        let plan = db.membership_plans().plan_membership_remove_principal(
            &writer,
            "event_members",
            Some(event_id),
            principal,
        )?;
        let result = plan.result.clone();
        db.membership_plans()
            .commit_membership_plan(&writer, plan)?;
        Ok(result)
    }

    // LLP 0100 §2 activation: the option is closed and the carrier contract
    // is validated at schema apply — remove:false, missing total carriers,
    // pending caller classes, and lastHolder-inconsistent carriers refuse.
    #[test]
    fn principal_addressed_activation_validates_the_carrier_contract() {
        let mutate = |change: &dyn Fn(&mut MembershipManifest)| {
            let mut schema = principal_addressed_schema();
            let membership = schema
                .tables
                .iter_mut()
                .find(|table| table.name == "event_members")
                .and_then(|table| table.membership.as_mut())
                .expect("membership fixture");
            change(membership);
            let mut db = LocalDatabase::memory().expect("memory database");
            db.activate_current_auth_catalog().expect("auth catalog");
            db.schema_seed().apply_schema(schema).map(|_| ())
        };

        // The valid fixture activates.
        mutate(&|_| {}).expect("valid principal-addressed declaration activates");

        // remove: false is refused rather than ignored.
        let error = mutate(&|membership| {
            membership.principal_addressed_writes =
                Some(crate::manifest::MembershipPrincipalAddressedWrites { remove: false });
        })
        .expect_err("remove: false refuses");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_PRINCIPAL_ADDRESSED_INVALID"
        );

        // Partial `from` coverage cannot carry the option: dropping the total
        // carrier leaves only the base schema's partial other-remove.
        let error = mutate(&|membership| {
            membership.transitions.retain(|transition| {
                transition.from.is_some()
                    || transition.op != MembershipOp::Remove
                    || transition.target != MembershipTarget::Other
            });
        })
        .expect_err("no total carrier refuses");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_PRINCIPAL_ADDRESSED_INVALID"
        );

        // A pending caller class on a carrier is refused.
        let error = mutate(&|membership| {
            membership.transitions.push(MembershipTransition {
                op: MembershipOp::Remove,
                by: vec!["invited".to_owned()],
                target: MembershipTarget::Other,
                from: None,
                to: None,
                fields: None,
            });
        })
        .expect_err("pending carrier class refuses");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_PRINCIPAL_ADDRESSED_INVALID"
        );

        // Under lastHolder every carrier caller role must be the protected
        // role — an admitted caller is itself a protected holder.
        let error = mutate(&|membership| {
            membership.transitions.push(MembershipTransition {
                op: MembershipOp::Remove,
                by: vec!["cohost".to_owned()],
                target: MembershipTarget::Other,
                from: None,
                to: None,
                fields: None,
            });
        })
        .expect_err("non-protected carrier class refuses under lastHolder");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_PRINCIPAL_ADDRESSED_INVALID"
        );
    }

    // LLP 0100 §§1/3: identical `null` for present and absent targets; the
    // present-target removal advances the durable global authorization
    // version (event 1) while the absent-target no-op advances nothing —
    // exactly the §1-scoped disclosure and nothing else.
    #[test]
    fn remove_principal_is_identical_null_with_the_scoped_epoch_disclosure() {
        let mut db = ready_db_with_schema(principal_addressed_schema());
        let (event_id, _host_id) = create_event(&mut db, "alice");
        seat_guest(&mut db, "alice", &event_id, "bob");

        let before = crate::storage::authorization_version_on(&db.conn)
            .expect("version before present removal");
        let result = remove_principal(&mut db, "alice", &event_id, "bob").expect("present removal");
        assert_eq!(result, Value::Null, "present-target result is null");
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT COUNT(*) FROM event_members WHERE userId = 'bob'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("count"),
            0,
            "the seat is gone"
        );
        let after_present = crate::storage::authorization_version_on(&db.conn)
            .expect("version after present removal");
        assert!(
            after_present.epoch > before.epoch || after_present.incarnation != before.incarnation,
            "a committed membership write is authorization event 1"
        );

        // The now-absent pair: byte-identical null, no version advance.
        let result = remove_principal(&mut db, "alice", &event_id, "bob").expect("absent no-op");
        assert_eq!(result, Value::Null, "absent-target result is the same null");
        let after_absent =
            crate::storage::authorization_version_on(&db.conn).expect("version after absent no-op");
        assert_eq!(
            after_absent, after_present,
            "the absent-target no-op advances no authorization version"
        );

        // A well-formed principal that names no user at all takes the same
        // branch: no user-directory probe, same null, no advance.
        let result = remove_principal(&mut db, "alice", &event_id, "ghost_principal")
            .expect("nonexistent principal no-op");
        assert_eq!(result, Value::Null);
        assert_eq!(
            crate::storage::authorization_version_on(&db.conn).expect("version"),
            after_present,
        );
    }

    // LLP 0100 §3 refusal order: unauthorized callers receive the invariant
    // transition denial BEFORE any target lookup — byte-identical whether the
    // target exists or not — the self target is a typed misuse, argument
    // validation is shape-only, and the surface is closed by default.
    #[test]
    fn remove_principal_refusals_are_ordered_and_non_disclosing() {
        let mut db = ready_db_with_schema(principal_addressed_schema());
        let (event_id, _) = create_event(&mut db, "alice");
        seat_guest(&mut db, "alice", &event_id, "bob");
        seat_guest(&mut db, "alice", &event_id, "carol");

        // A guest caller: invariant denial, identical for a present target
        // (bob) and an absent one (nobody) — no membership probe happened.
        let writer = user("carol");
        let present = db
            .membership_plans()
            .plan_membership_remove_principal(&writer, "event_members", Some(&event_id), "bob")
            .expect_err("guest caller denied");
        let absent = db
            .membership_plans()
            .plan_membership_remove_principal(&writer, "event_members", Some(&event_id), "nobody")
            .expect_err("guest caller denied on absent target too");
        assert_eq!(
            present.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED"
        );
        assert_eq!(
            (
                present.diagnostic.code.clone(),
                present.diagnostic.message.clone()
            ),
            (
                absent.diagnostic.code.clone(),
                absent.diagnostic.message.clone()
            ),
            "the denial is byte-identical across target presence"
        );

        // A caller with no row at all (class none): same invariant denial.
        let outsider = db
            .membership_plans()
            .plan_membership_remove_principal(
                &user("mallory"),
                "event_members",
                Some(&event_id),
                "bob",
            )
            .expect_err("outsider denied");
        assert_eq!(
            outsider.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED"
        );

        // Self-removal remains removeSelf: typed misuse, before target lookup.
        let this_is_me = db
            .membership_plans()
            .plan_membership_remove_principal(
                &user("alice"),
                "event_members",
                Some(&event_id),
                "alice",
            )
            .expect_err("self target refuses");
        assert_eq!(
            this_is_me.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_TARGET_SELF"
        );

        // Shape-only argument validation.
        let empty = db
            .membership_plans()
            .plan_membership_remove_principal(&user("alice"), "event_members", Some(&event_id), "")
            .expect_err("empty principal refuses");
        assert_eq!(
            empty.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_PRINCIPAL_INVALID"
        );
        let missing_resource = db
            .membership_plans()
            .plan_membership_remove_principal(&user("alice"), "event_members", None, "bob")
            .expect_err("resource-scoped removal needs a resource");
        assert_eq!(
            missing_resource.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING"
        );

        // Closed by default: without the opt-in the surface does not exist,
        // even for the host caller class.
        let mut undeclared = ready_db();
        let (undeclared_event, _) = create_event(&mut undeclared, "alice");
        let closed = undeclared
            .membership_plans()
            .plan_membership_remove_principal(
                &user("alice"),
                "event_members",
                Some(&undeclared_event),
                "bob",
            )
            .expect_err("undeclared option refuses");
        assert_eq!(
            closed.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_PRINCIPAL_ADDRESSED_UNDECLARED"
        );
    }

    // LLP 0100 §3: both present and absent lookups are captured, so a
    // concurrent insert invalidates the no-op's read set before companion
    // writes can commit against a stale absence.
    #[test]
    fn remove_principal_no_op_absence_capture_invalidates_on_concurrent_insert() {
        let mut db = ready_db_with_schema(principal_addressed_schema());
        let (event_id, _) = create_event(&mut db, "alice");

        let writer = user("alice");
        let stale = db
            .membership_plans()
            .plan_membership_remove_principal(&writer, "event_members", Some(&event_id), "bob")
            .expect("absent-target plan");
        assert!(stale.writes.is_empty(), "the no-op plans zero writes");
        assert!(
            !stale.read_dependencies.is_empty(),
            "the no-op captures its absence witness"
        );

        // bob joins between plan and commit: the captured absence is stale.
        seat_guest(&mut db, "alice", &event_id, "bob");
        let error = db
            .membership_plans()
            .commit_membership_plan(&writer, stale)
            .expect_err("stale absence capture must not commit");
        assert!(
            error.diagnostic.code.contains("CONFLICT")
                || error.diagnostic.code.contains("READ_SET")
                || error.diagnostic.code.contains("INVALID"),
            "commit-time read-set validation refuses the stale no-op: {}",
            error.diagnostic.code
        );
    }

    // LLP 0100 §2 + §Acceptance: the expired-but-authorized edge. 0056's
    // sweep-skipped protected holder stays live, so an expired host still
    // occupies the protected set: removal of the other host admits, commits,
    // and the protected set never empties; the absent branch is uniform.
    #[test]
    fn remove_principal_expired_but_authorized_holder_edge_is_uniform() {
        let mut db = ready_db_with_schema(principal_addressed_schema());
        let (event_id, _) = create_event(&mut db, "alice");
        promote_to_host(&mut db, "alice", &event_id, "bob");

        // Expire ALICE's row through the declared host patch transition
        // (fields: ["expiresAt"]) — bob, a host, patches alice's expiry into
        // the past. The row stays live: protection wins over expiry.
        let alice_row = member_id(&db, &event_id, "alice");
        let mut values = Map::new();
        values.insert("expiresAt".to_owned(), json!(1));
        let plan = db
            .membership_plans()
            .plan_membership_patch(&user("bob"), "event_members", &alice_row, values)
            .expect("expiry patch plan");
        db.membership_plans()
            .commit_membership_plan(&user("bob"), plan)
            .expect("expiry patch commit");

        // Expired-but-authorized alice removes the other protected holder:
        // admitted under her still-live role; her own (expired) row is the
        // surviving protected holder, so lastHolder cannot strand.
        let result = remove_principal(&mut db, "alice", &event_id, "bob").expect("present removal");
        assert_eq!(result, Value::Null);
        assert!(role_of(&db, &alice_row).is_some(), "alice's row survives");

        // The absent branch is uniform for the same caller.
        let result = remove_principal(&mut db, "alice", &event_id, "bob").expect("absent no-op");
        assert_eq!(result, Value::Null);
    }

    // LLP 0100 §8b / LLP 0109 §8: the declared membership fixture lane. A
    // versioned seed naming a membership table installs fixture seats through
    // the seed writer with per-row provenance; a reset-install retires every
    // runtime seat and restores exactly the fixture seats in ONE cut whose
    // authorization consequence is the rotated incarnation
    // (declared-restore/event-3 semantics — never a stream of per-row kicks);
    // and a runtime-only principal provably loses authority across the reset
    // while fixture authority survives.
    #[test]
    fn versioned_seed_membership_fixture_lane_installs_resets_and_retires_runtime_authority() {
        use crate::auth::coordinator::AuthCoordinator;
        use crate::auth::session_projection::{
            AuthorizationStreamRecord, ProjectionSource, SessionProjection,
        };
        use crate::seed_identity::{
            ExpectedDataVersionStreamV1, InstallSeedRequestV1, ResetSeedRequestV1,
            SEED_ARTIFACT_FORMAT_V1, SEED_INSTALL_REQUEST_FORMAT_V1, SEED_RESET_REQUEST_FORMAT_V1,
            SeedArtifactV1, SeedEnsureResultV1, SeedResetOperationV1, artifact_digest,
        };
        use std::sync::Arc;
        use std::time::Instant;

        let mut schema = principal_addressed_schema();
        schema.schema_hash = Some("membership-fixture-lane".to_owned());
        let app_id = schema.app_id.clone();
        let mut db = ready_db_with_schema(schema);

        let seat = |principal: &str, role: &str| {
            Map::from_iter([
                ("eventId".to_owned(), json!("evt_fixture")),
                ("userId".to_owned(), json!(principal)),
                ("role".to_owned(), json!(role)),
            ])
        };
        let make_artifact = |version: &str, seats: Vec<Map<String, Value>>| {
            let mut artifact = SeedArtifactV1 {
                format_version: SEED_ARTIFACT_FORMAT_V1.to_owned(),
                app_id: app_id.clone(),
                seed_version: version.to_owned(),
                seed_digest: String::new(),
                tables: BTreeMap::from([
                    (
                        "events".to_owned(),
                        vec![Map::from_iter([
                            ("_id".to_owned(), json!("evt_fixture")),
                            ("title".to_owned(), json!("fixture party")),
                        ])],
                    ),
                    ("event_members".to_owned(), seats),
                ]),
            };
            artifact.seed_digest = artifact_digest(&artifact).expect("artifact digest");
            artifact
        };

        // Install: fixture seats enter through the declared lane.
        let artifact = make_artifact(
            "fixture-v1",
            vec![seat("alice", "host"), seat("carol", "guest")],
        );
        let installed = db
            .schema_seed()
            .ensure_versioned_seed(InstallSeedRequestV1 {
                format_version: SEED_INSTALL_REQUEST_FORMAT_V1.to_owned(),
                operation_id: "01982c7a-7c00-7000-8000-000000000301".to_owned(),
                artifact: artifact.clone(),
                requested_mode: AuthMode::Dev,
                asset_fixtures: None,
            })
            .expect("membership fixture seed installs");
        let SeedEnsureResultV1::Installed { receipt } = installed else {
            panic!("fresh fixture seed must install");
        };

        // Per-row seed-writer provenance is stamped (LLP 0109 §8).
        let actor: String = db
            .conn
            .query_row(
                "SELECT grantedByActor FROM event_members WHERE userId = 'alice'",
                [],
                |row| row.get(0),
            )
            .expect("provenance stamped");
        assert_eq!(actor, "seed", "fixture seats carry the seed writer tag");

        // Fixture-established authority is real authority: the seeded host
        // exercises the ordinary transition matrix.
        invite(&mut db, "alice", "evt_fixture", "bob");
        let bob_row = member_id(&db, "evt_fixture", "bob");
        set_role(&mut db, "bob", &bob_row, "guest").expect("bob accepts");

        // Reset-install: one cut — every runtime seat retired, exactly the
        // fixture seats restored, the authorization incarnation rotated.
        let before =
            crate::storage::authorization_version_on(&db.conn).expect("version before reset");
        let incarnation = db
            .ensure_authorization_stream_incarnation()
            .expect("authorization stream");
        let source = ProjectionSource {
            authorization_stream_value: AuthorizationStreamRecord::new(incarnation)
                .encode_bytes()
                .expect("stream record"),
            restore_declaration_id: None,
            users: Vec::new(),
            identities: Vec::new(),
            sessions: Vec::new(),
            superseded_tokens: Vec::new(),
        };
        let projection =
            SessionProjection::rebuild_with_fresh_startup_id(source, now_millis(), Instant::now())
                .expect("session projection");
        let coordinator = Arc::new(AuthCoordinator::new(projection).expect("coordinator"));
        let carrier = coordinator
            .premark_stream_reset_if_drained()
            .expect("reset carrier");
        let attempt = db
            .schema_seed()
            .attempt_versioned_seed_reset_with_authorization_stream(
                ResetSeedRequestV1 {
                    format_version: SEED_RESET_REQUEST_FORMAT_V1.to_owned(),
                    operation_id: "01982c7a-7c00-7000-8000-000000000302".to_owned(),
                    operation: SeedResetOperationV1::ResetInstall,
                    requested_mode: AuthMode::Dev,
                    expected_data_version_stream: ExpectedDataVersionStreamV1::Present {
                        value: receipt.data_version_stream.clone(),
                    },
                    artifact: Some(artifact),
                },
                carrier.predecessor(),
                carrier.successor(),
            );
        let (_, reset_receipt) = coordinator
            .finish_stream_reset(carrier, attempt)
            .expect("reset-install commits");
        assert_ne!(
            reset_receipt.data_version_stream, receipt.data_version_stream,
            "the reset rotates the data-version stream"
        );

        // Runtime seat retired; fixture seats restored exactly.
        let bob_count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM event_members WHERE userId = 'bob'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(bob_count, 0, "the runtime-only seat is retired");
        let restored: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM event_members", [], |row| row.get(0))
            .expect("count");
        assert_eq!(restored, 2, "exactly the fixture seats are restored");

        // Declared-restore incarnation semantics: one rotated incarnation at
        // epoch 0 — not a stream of per-row event-1 kicks.
        let after =
            crate::storage::authorization_version_on(&db.conn).expect("version after reset");
        assert_ne!(
            after.incarnation, before.incarnation,
            "the reset rotates the authorization incarnation"
        );
        assert_eq!(
            after.epoch, 0,
            "the successor incarnation starts at epoch 0"
        );

        // The runtime-only principal provably lost authority; fixture
        // authority survives the same cut.
        let denied = db
            .membership_plans()
            .plan_membership_remove_principal(
                &user("bob"),
                "event_members",
                Some("evt_fixture"),
                "carol",
            )
            .expect_err("the runtime-only principal holds nothing after reset");
        assert_eq!(
            denied.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED"
        );
        remove_principal(&mut db, "alice", "evt_fixture", "carol")
            .expect("fixture authority survives the reset");
    }

    // The fixture lane stays declaration-checked: an out-of-vocabulary role
    // refuses the whole install, and a fixture row cannot spoof the
    // host-managed provenance columns.
    #[test]
    fn versioned_seed_membership_fixture_lane_fails_closed() {
        use crate::seed_identity::{
            InstallSeedRequestV1, SEED_ARTIFACT_FORMAT_V1, SEED_INSTALL_REQUEST_FORMAT_V1,
            SeedArtifactV1, artifact_digest,
        };

        let install = |rows: Vec<Map<String, Value>>, operation_id: &str| {
            let mut schema = principal_addressed_schema();
            schema.schema_hash = Some("membership-fixture-negative".to_owned());
            let app_id = schema.app_id.clone();
            let mut db = ready_db_with_schema(schema);
            let mut artifact = SeedArtifactV1 {
                format_version: SEED_ARTIFACT_FORMAT_V1.to_owned(),
                app_id,
                seed_version: "fixture-negative".to_owned(),
                seed_digest: String::new(),
                tables: BTreeMap::from([
                    (
                        "events".to_owned(),
                        vec![Map::from_iter([
                            ("_id".to_owned(), json!("evt_fixture")),
                            ("title".to_owned(), json!("fixture")),
                        ])],
                    ),
                    ("event_members".to_owned(), rows),
                ]),
            };
            artifact.seed_digest = artifact_digest(&artifact).expect("digest");
            db.schema_seed()
                .ensure_versioned_seed(InstallSeedRequestV1 {
                    format_version: SEED_INSTALL_REQUEST_FORMAT_V1.to_owned(),
                    operation_id: operation_id.to_owned(),
                    artifact,
                    requested_mode: AuthMode::Dev,
                    asset_fixtures: None,
                })
                .map(|_| ())
        };

        let unknown_role = install(
            vec![Map::from_iter([
                ("eventId".to_owned(), json!("evt_fixture")),
                ("userId".to_owned(), json!("alice")),
                ("role".to_owned(), json!("emperor")),
            ])],
            "01982c7a-7c00-7000-8000-000000000303",
        )
        .expect_err("out-of-vocabulary fixture role refuses the install");
        assert!(
            unknown_role
                .diagnostic
                .code
                .starts_with("SNAPBACK_MEMBERSHIP"),
            "declaration validation refuses: {}",
            unknown_role.diagnostic.code
        );

        let spoofed = install(
            vec![Map::from_iter([
                ("eventId".to_owned(), json!("evt_fixture")),
                ("userId".to_owned(), json!("alice")),
                ("role".to_owned(), json!("host")),
                ("grantedByActor".to_owned(), json!("mallory")),
            ])],
            "01982c7a-7c00-7000-8000-000000000304",
        )
        .expect_err("host-managed provenance columns cannot be spoofed");
        let code = spoofed.diagnostic.code.as_str();
        assert!(
            code.contains("UNKNOWN") || code.contains("FIELD"),
            "the spoofed column refuses as undeclared: {code}"
        );
    }

    #[derive(Clone, Copy, Debug)]
    enum CallerAuthorityOperation {
        Insert,
        SetRole,
        Remove,
        Patch,
    }

    impl CallerAuthorityOperation {
        const ALL: [Self; 4] = [Self::Insert, Self::SetRole, Self::Remove, Self::Patch];
    }

    fn allow_host_demotion(schema: &mut SchemaManifest) {
        schema.tables[1]
            .membership
            .as_mut()
            .expect("membership declaration")
            .transitions
            .push(crate::manifest::MembershipTransition {
                op: MembershipOp::SetRole,
                by: vec!["host".to_owned()],
                target: MembershipTarget::Other,
                from: Some(vec!["host".to_owned()]),
                to: Some(vec!["cohost".to_owned()]),
                fields: None,
            });
    }

    fn allow_none_class_insert(schema: &mut SchemaManifest) {
        let membership = schema.tables[1]
            .membership
            .as_mut()
            .expect("membership declaration");
        membership
            .transitions
            .push(crate::manifest::MembershipTransition {
                op: MembershipOp::Insert,
                by: vec!["none".to_owned()],
                target: MembershipTarget::Other,
                from: None,
                to: Some(vec!["invited".to_owned()]),
                fields: None,
            });
    }

    fn caller_authority_fixture(
        schema: SchemaManifest,
    ) -> (LocalDatabase, String, String, String, String) {
        let mut db = ready_db_with_schema(schema);
        let (event_id, alice) = create_event(&mut db, "alice");
        promote_to_host(&mut db, "alice", &event_id, "bob");
        let bob = member_id(&db, &event_id, "bob");
        invite(&mut db, "alice", &event_id, "carol");
        let carol = member_id(&db, &event_id, "carol");
        set_role(&mut db, "carol", &carol, "guest").expect("carol accepts");
        (db, event_id, alice, bob, carol)
    }

    fn plan_caller_authority_operation(
        db: &LocalDatabase,
        operation: CallerAuthorityOperation,
        caller: &str,
        event_id: &str,
        target: &str,
    ) -> MembershipPlan {
        match operation {
            CallerAuthorityOperation::Insert => db
                .membership_plans_read()
                .plan_membership_insert(
                    &user(caller),
                    "event_members",
                    Map::from_iter([
                        ("userId".to_owned(), json!("dave")),
                        ("eventId".to_owned(), json!(event_id)),
                        ("role".to_owned(), json!("invited")),
                    ]),
                )
                .expect("insert plan"),
            CallerAuthorityOperation::SetRole => db
                .membership_plans_read()
                .plan_membership_set_role(&user(caller), "event_members", target, "cohost")
                .expect("setRole plan"),
            CallerAuthorityOperation::Remove => db
                .membership_plans_read()
                .plan_membership_remove(&user(caller), "event_members", target)
                .expect("remove plan"),
            CallerAuthorityOperation::Patch => db
                .membership_plans_read()
                .plan_membership_patch(
                    &user(caller),
                    "event_members",
                    target,
                    Map::from_iter([("expiresAt".to_owned(), json!(5_000))]),
                )
                .expect("patch plan"),
        }
    }

    fn sessions_holder_fixture(
        allow_demotion: bool,
    ) -> (
        LocalDatabase,
        String,
        String,
        String,
        crate::auth::crypto::AgentCredential,
        crate::auth::crypto::AgentCredential,
    ) {
        let mut schema = membership_schema();
        if allow_demotion {
            allow_host_demotion(&mut schema);
        }
        let mut db = ready_db_with_schema(schema);
        // This storage-unit fixture exercises the sessions-mode eligibility
        // predicate without going through the deployment activation protocol,
        // whose staged artifact handshake is covered in auth_mode tests.
        db.schema.auth = Some(crate::manifest::AuthManifest {
            mode: AuthMode::Sessions,
            agents: None,
            password_identifier_mode: None,
            password_minimum_length: None,
        });
        seed_agent(&mut db, "agent-a");
        seed_agent(&mut db, "agent-b");
        let random = crate::auth::crypto::OsRandom;
        let agent_a_credential = db
            .issue_initial_agent_credential("agent-a", 1, &random)
            .expect("agent-a credential")
            .secret;
        let agent_b_credential = db
            .issue_initial_agent_credential("agent-b", 2, &random)
            .expect("agent-b credential")
            .secret;
        let (event_id, agent_a) = create_event(&mut db, "agent-a");
        promote_to_host(&mut db, "agent-a", &event_id, "agent-b");
        let agent_b = member_id(&db, &event_id, "agent-b");
        (
            db,
            event_id,
            agent_a,
            agent_b,
            agent_a_credential,
            agent_b_credential,
        )
    }

    #[test]
    fn membership_commits_drive_event_one_except_attested_incidental_updates() {
        let mut db = ready_db();
        let baseline = db.authorization_version().expect("activation version");

        let (event_id, _) = create_event(&mut db, "alice");
        let after_bootstrap = db.authorization_version().expect("bootstrap version");
        assert_eq!(after_bootstrap.epoch, baseline.epoch + 1);

        invite(&mut db, "alice", &event_id, "bob");
        let bob = member_id(&db, &event_id, "bob");
        let after_insert = db.authorization_version().expect("insert version");
        assert_eq!(after_insert.epoch, after_bootstrap.epoch + 1);

        let role_plan = db
            .membership_plans()
            .plan_membership_set_role(&user("bob"), "event_members", &bob, "guest")
            .expect("accept invite");
        let role_commit = db
            .membership_plans()
            .commit_membership_plan(&user("bob"), role_plan)
            .expect("role commit");
        assert!(role_commit.authorization.as_ref().is_some_and(|w| w.event));
        assert_eq!(
            role_commit
                .authorization
                .as_ref()
                .unwrap()
                .membership_declarations,
            vec!["event_members".to_owned()]
        );
        let after_role = db.authorization_version().expect("role version");
        assert_eq!(after_role.epoch, after_insert.epoch + 1);

        let incidental_plan = db
            .membership_plans()
            .plan_membership_patch(
                &user("bob"),
                "event_members",
                &bob,
                Map::from_iter([("notifyPrefs".to_owned(), json!("mentions"))]),
            )
            .expect("self preferences patch");
        let incidental_commit = db
            .membership_plans()
            .commit_membership_plan(&user("bob"), incidental_plan)
            .expect("incidental commit");
        assert!(
            incidental_commit
                .authorization
                .as_ref()
                .is_some_and(|witness| !witness.event)
        );
        assert!(
            incidental_commit
                .authorization
                .as_ref()
                .unwrap()
                .membership_declarations
                .is_empty()
        );
        assert_eq!(db.authorization_version().unwrap(), after_role);

        let expiry_plan = db
            .membership_plans()
            .plan_membership_patch(
                &user("alice"),
                "event_members",
                &bob,
                Map::from_iter([("expiresAt".to_owned(), json!(1_000))]),
            )
            .expect("host expiry patch");
        let expiry_commit = db
            .membership_plans()
            .commit_membership_plan(&user("alice"), expiry_plan)
            .expect("expiry commit");
        assert!(
            expiry_commit
                .authorization
                .as_ref()
                .is_some_and(|w| w.event)
        );
        assert_eq!(
            db.authorization_version().unwrap().epoch,
            after_role.epoch + 1
        );

        let remove_plan = db
            .membership_plans()
            .plan_membership_remove(&user("alice"), "event_members", &bob)
            .expect("host removes guest");
        let remove_commit = db
            .membership_plans()
            .commit_membership_plan(&user("alice"), remove_plan)
            .expect("remove commit");
        assert!(
            remove_commit
                .authorization
                .as_ref()
                .is_some_and(|w| w.event)
        );
    }

    #[test]
    fn full_provenance_keeps_delegated_downgrade_and_delete_attributable() {
        let mut db = ready_db();
        let (event_id, host_id) = create_event(&mut db, "alice");
        assert_eq!(
            db.membership_creation_provenance("event_members", &host_id)
                .unwrap(),
            Some(MembershipCreationProvenance {
                actor: "alice".to_owned(),
                effective: "alice".to_owned(),
                grant: None,
            })
        );

        let delegated = MembershipWriter::Delegated {
            actor_principal: "agent-a".to_owned(),
            effective_principal: "alice".to_owned(),
            grant_id: "grant-historical".to_owned(),
            authority_creating_consent: true,
        };
        let values = Map::from_iter([
            ("userId".to_owned(), json!("bob")),
            ("eventId".to_owned(), json!(event_id)),
            ("role".to_owned(), json!("invited")),
        ]);
        let plan = db
            .membership_plans()
            .plan_membership_insert(&delegated, "event_members", values)
            .expect("delegated invite plan");
        let invite = db
            .membership_plans()
            .commit_membership_plan(&delegated, plan)
            .expect("delegated invite commit");
        let bob = commit_id_for_table(&invite, "event_members");
        assert_eq!(
            db.membership_creation_provenance("event_members", &bob)
                .unwrap(),
            Some(MembershipCreationProvenance {
                actor: "agent-a".to_owned(),
                effective: "alice".to_owned(),
                grant: Some("grant-historical".to_owned()),
            })
        );

        set_role(&mut db, "bob", &bob, "guest").expect("accept invite");
        set_role(&mut db, "alice", &bob, "cohost").expect("promote cohost");
        let downgrade = db
            .membership_plans()
            .plan_membership_set_role(&delegated, "event_members", &bob, "guest")
            .expect("delegated downgrade plan");
        db.membership_plans()
            .commit_membership_plan(&delegated, downgrade)
            .expect("delegated downgrade commit");
        let remove = db
            .membership_plans()
            .plan_membership_remove(&delegated, "event_members", &bob)
            .expect("delegated kick plan");
        db.membership_plans()
            .commit_membership_plan(&delegated, remove)
            .expect("delegated kick commit");
        assert_eq!(role_of(&db, &bob), None, "the kicked row is gone");

        let log = db.membership_transition_log("event_members").unwrap();
        let bob_log = log
            .iter()
            .filter(|record| record.principal == "bob")
            .collect::<Vec<_>>();
        let downgrade = bob_log
            .iter()
            .find(|record| record.op == "setRole" && record.from_role.as_deref() == Some("cohost"))
            .expect("durable downgrade record");
        let deletion = bob_log
            .iter()
            .find(|record| record.op == "remove")
            .expect("durable deletion record");
        for record in [downgrade, deletion] {
            assert_eq!(record.actor, "agent-a");
            assert_eq!(record.effective, "alice");
            assert_eq!(record.grant.as_deref(), Some("grant-historical"));
            assert_eq!(record.writer_class, "delegated");
        }
    }

    #[test]
    fn delegated_self_seating_persists_after_grant_revocation_and_authorizes_by_row() {
        let mut schema = membership_schema();
        schema.tables[1]
            .membership
            .as_mut()
            .expect("event membership")
            .transitions
            .push(crate::manifest::MembershipTransition {
                op: MembershipOp::Insert,
                by: vec!["host".to_owned()],
                target: MembershipTarget::Other,
                from: None,
                to: Some(vec!["host".to_owned()]),
                fields: None,
            });
        let mut db = LocalDatabase::memory().expect("memory database");
        db.activate_current_auth_catalog().expect("auth catalog");
        db.schema_seed()
            .apply_schema(schema)
            .expect("self-seating schema");
        db.conn
            .execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES('alice', 0, 'human', 'Alice', NULL, NULL, NULL, NULL)",
                [],
            )
            .expect("human principal");
        seed_agent(&mut db, "agent-a");
        db.conn
            .execute(
                "INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, revoked_at_ms, created_by, request_id,
                   consent_digest, last_used_at_ms
                 ) VALUES(
                   'grant-self-seat', 'agent-a', 'alice', '[]', 10,
                   1000, NULL, 'test', NULL, NULL, 10
                 )",
                [],
            )
            .expect("delegated grant");

        let (event_id, _) = create_event(&mut db, "alice");
        let delegated = MembershipWriter::Delegated {
            actor_principal: "agent-a".to_owned(),
            effective_principal: "alice".to_owned(),
            grant_id: "grant-self-seat".to_owned(),
            authority_creating_consent: true,
        };
        let plan = db
            .membership_plans()
            .plan_membership_insert(
                &delegated,
                "event_members",
                Map::from_iter([
                    ("userId".to_owned(), json!("agent-a")),
                    ("eventId".to_owned(), json!(event_id)),
                    ("role".to_owned(), json!("host")),
                ]),
            )
            .expect("consented delegate seats its actor");
        let commit = db
            .membership_plans()
            .commit_membership_plan(&delegated, plan)
            .expect("self-seating commit");
        let membership_id = commit_id_for_table(&commit, "event_members");

        db.revoke_grant_for_user("alice", "grant-self-seat", 20)
            .expect("grant revocation");
        let revoked_at: Option<i64> = db
            .conn
            .query_row(
                "SELECT revoked_at_ms FROM _auth_grants WHERE id = 'grant-self-seat'",
                [],
                |row| row.get(0),
            )
            .expect("revoked grant row");
        assert_eq!(revoked_at, Some(20));
        assert_eq!(role_of(&db, &membership_id).as_deref(), Some("host"));
        assert_eq!(
            db.membership_creation_provenance("event_members", &membership_id)
                .expect("creation provenance"),
            Some(MembershipCreationProvenance {
                actor: "agent-a".to_owned(),
                effective: "alice".to_owned(),
                grant: Some("grant-self-seat".to_owned()),
            })
        );

        let membership = db.schema().tables[1]
            .membership
            .clone()
            .expect("event membership");
        let access = crate::membership_rules::require_role(
            &DbRead::Live(&db),
            &membership,
            "event_members",
            "agent-a",
            crate::membership_rules::ResourceBinding::Fixed(json!(event_id)),
            &["host".to_owned()],
        )
        .expect("autonomous role check");
        assert!(
            access.denial.is_none(),
            "post-revocation authority is explained by the durable row"
        );
    }

    #[test]
    fn full_membership_provenance_survives_database_reopen() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("membership-provenance.sqlite3");
        let (host_id, bob_id) = {
            let mut db = LocalDatabase::open(&path).expect("file database");
            db.activate_current_auth_catalog().expect("auth catalog");
            db.schema_seed()
                .apply_schema(membership_schema())
                .expect("membership schema");
            let (event_id, host_id) = create_event(&mut db, "alice");
            invite(&mut db, "alice", &event_id, "bob");
            let bob_id = member_id(&db, &event_id, "bob");
            set_role(&mut db, "bob", &bob_id, "guest").expect("accept invite");
            (host_id, bob_id)
        };

        let reopened = LocalDatabase::open(&path).expect("reopen database");
        assert_eq!(
            reopened
                .membership_creation_provenance("event_members", &host_id)
                .unwrap(),
            Some(MembershipCreationProvenance {
                actor: "alice".to_owned(),
                effective: "alice".to_owned(),
                grant: None,
            })
        );
        let bob_log = reopened
            .membership_transition_log("event_members")
            .unwrap()
            .into_iter()
            .filter(|record| record.principal == "bob")
            .collect::<Vec<_>>();
        assert!(
            bob_log
                .iter()
                .any(|record| record.op == "insert" && record.to_role.as_deref() == Some("invited"))
        );
        assert!(bob_log.iter().any(|record| {
            record.op == "setRole"
                && record.from_role.as_deref() == Some("invited")
                && record.to_role.as_deref() == Some("guest")
        }));
        assert_eq!(role_of(&reopened, &bob_id).as_deref(), Some("guest"));
    }

    fn global_role_schema(provenance: Option<MembershipProvenance>) -> SchemaManifest {
        SchemaManifest {
            tables: vec![TableManifest {
                name: "app_roles".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "userId".to_owned(),
                        field_type: FieldType::Principal,
                        optional: false,
                    },
                    FieldManifest {
                        name: "role".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: Some(MembershipManifest {
                    id: Some("appRoles".to_owned()),
                    principal: "userId".to_owned(),
                    resource: None,
                    role: "role".to_owned(),
                    roles: vec!["admin".to_owned(), "moderator".to_owned()],
                    pending_roles: None,
                    bootstrap_role: None,
                    last_holder: None,
                    expiry: None,
                    incidental: None,
                    provenance,
                    transitions: Vec::new(),
                    scope: MembershipScope::App,
                    resource_table: None,
                    principal_addressed_writes: None,
                }),
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            }],
            ..SchemaManifest::default()
        }
    }

    #[test]
    fn global_roles_seed_real_rows_and_import_preserves_creation_provenance() {
        let mut db = LocalDatabase::memory().expect("memory db");
        db.schema_seed()
            .apply_schema(global_role_schema(Some(MembershipProvenance::Creation)))
            .expect("global role schema");

        let seed = MembershipWriter::Seed;
        let seed_plan = db
            .membership_plans()
            .plan_privileged_membership_insert(
                &seed,
                "app_roles",
                Map::from_iter([
                    ("userId".to_owned(), json!("alice")),
                    ("role".to_owned(), json!("admin")),
                ]),
            )
            .expect("first global admin is seeded");
        let seed_commit = db
            .membership_plans()
            .commit_membership_plan(&seed, seed_plan)
            .unwrap();
        let alice = commit_id_for_table(&seed_commit, "app_roles");
        assert_eq!(
            db.membership_creation_provenance("app_roles", &alice)
                .unwrap()
                .unwrap()
                .actor,
            "seed"
        );

        let (_, declaration) = resolve_membership_decl(db.schema(), "app_roles").unwrap();
        let real_row = crate::membership_rules::membership_read(
            &DbRead::Live(&db),
            declaration,
            "app_roles",
            "alice",
            crate::membership_rules::ResourceBinding::AppSingleton,
            &["admin".to_owned()],
        )
        .expect("real seeded global-role lookup");
        assert!(
            real_row.present,
            "the app gate reads durable membership data"
        );

        let admin = MembershipWriter::Admin;
        let admin_plan = db
            .membership_plans()
            .plan_privileged_membership_insert(
                &admin,
                "app_roles",
                Map::from_iter([
                    ("userId".to_owned(), json!("bob")),
                    ("role".to_owned(), json!("moderator")),
                ]),
            )
            .expect("admin data-edit plan");
        let admin_commit = db
            .membership_plans()
            .commit_membership_plan(&admin, admin_plan)
            .expect("admin data-edit commit");
        let bob = commit_id_for_table(&admin_commit, "app_roles");
        assert_eq!(
            db.membership_creation_provenance("app_roles", &bob)
                .unwrap()
                .unwrap()
                .actor,
            "hostOps:dataEdit"
        );

        let imported = MembershipWriter::Import {
            granted_by_actor: "original-agent".to_owned(),
            granted_by_effective: "original-user".to_owned(),
            granted_by_grant: Some("historical-grant".to_owned()),
        };
        let import_plan = db
            .membership_plans()
            .plan_privileged_membership_insert(
                &imported,
                "app_roles",
                Map::from_iter([
                    ("userId".to_owned(), json!("carol")),
                    ("role".to_owned(), json!("moderator")),
                ]),
            )
            .expect("import plan");
        let import_commit = db
            .membership_plans()
            .commit_membership_plan(&imported, import_plan)
            .expect("import commit");
        let carol = commit_id_for_table(&import_commit, "app_roles");
        assert_eq!(
            db.membership_creation_provenance("app_roles", &carol)
                .unwrap(),
            Some(MembershipCreationProvenance {
                actor: "original-agent".to_owned(),
                effective: "original-user".to_owned(),
                grant: Some("historical-grant".to_owned()),
            })
        );
        assert!(
            db.membership_transition_log("appRoles").unwrap().is_empty(),
            "creation provenance does not manufacture the full transition ledger"
        );

        let duplicate = db
            .membership_plans()
            .plan_privileged_membership_insert(
                &MembershipWriter::Admin,
                "app_roles",
                Map::from_iter([
                    ("userId".to_owned(), json!("alice")),
                    ("role".to_owned(), json!("moderator")),
                ]),
            )
            .expect("admin plan");
        let error = db
            .membership_plans()
            .commit_membership_plan(&MembershipWriter::Admin, duplicate)
            .expect_err("one global role per declaration");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION"
        );
    }

    #[test]
    fn enabling_provenance_backfills_preexisting_memberships() {
        let mut db = LocalDatabase::memory().expect("memory db");
        let mut plain = global_role_schema(None);
        plain.tables[0].membership = None;
        db.schema_seed()
            .apply_schema(plain)
            .expect("pre-membership shape");
        db.mutation_writes()
            .execute_mutation(
                &MutationPlan {
                    steps: vec![MutationStep::Insert {
                        table: "app_roles".to_owned(),
                        values: BTreeMap::from([
                            (
                                "userId".to_owned(),
                                ValueExpr::Literal(json!("legacy-user")),
                            ),
                            ("role".to_owned(), ValueExpr::Literal(json!("admin"))),
                        ]),
                        bind_id_as: None,
                    }],
                    return_value: None,
                },
                &HandlerInput::default(),
            )
            .expect("seed preexisting row");
        let legacy_id = db
            .query_reads_read()
            .query(
                &QueryPlan {
                    table_visibility: None,
                    table: "app_roles".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                },
                &HandlerInput::default(),
            )
            .unwrap()
            .rows[0]["_id"]
            .as_str()
            .unwrap()
            .to_owned();
        db.schema_seed()
            .apply_schema(global_role_schema(Some(MembershipProvenance::Full)))
            .expect("brownfield provenance adoption");
        assert_eq!(
            db.membership_creation_provenance("app_roles", &legacy_id)
                .unwrap(),
            Some(MembershipCreationProvenance {
                actor: "preexisting".to_owned(),
                effective: "preexisting".to_owned(),
                grant: None,
            })
        );
    }

    // --- Writer-class seam --------------------------------------------------

    #[test]
    fn raw_ctx_db_membership_write_is_refused() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        let mut values = Map::new();
        values.insert("userId".to_owned(), json!("mallory"));
        values.insert("eventId".to_owned(), json!(event_id));
        values.insert("role".to_owned(), json!("host"));
        let error = db
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Insert {
                    table: "event_members".to_owned(),
                    id: "forged".to_owned(),
                    values,
                }],
                Vec::new(),
                Value::Null,
            )
            .expect_err("raw membership write must be refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED"
        );
    }

    #[test]
    fn hostplan_generic_membership_write_is_refused_including_dry_run() {
        let mut db = ready_db();
        let mut values = BTreeMap::new();
        values.insert("userId".to_owned(), ValueExpr::Literal(json!("mallory")));
        values.insert("eventId".to_owned(), ValueExpr::Literal(json!("e1")));
        values.insert("role".to_owned(), ValueExpr::Literal(json!("host")));
        let plan = MutationPlan {
            steps: vec![MutationStep::Insert {
                table: "event_members".to_owned(),
                values,
                bind_id_as: None,
            }],
            return_value: None,
        };
        let error = db
            .mutation_writes()
            .execute_mutation(&plan, &HandlerInput::default())
            .expect_err("hostplan membership insert refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_HOSTPLAN_WRITE_DENIED"
        );
        // Dry-run shares the path and must refuse identically.
        match db
            .mutation_writes()
            .dry_run_mutation(&plan, &HandlerInput::default())
        {
            Err(error) => assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_MEMBERSHIP_HOSTPLAN_WRITE_DENIED"
            ),
            Ok(_) => panic!("hostplan dry-run membership insert must be refused"),
        }
    }

    #[test]
    fn userless_authority_matches_no_transition_class() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        // An open-join `by: ["none"]` transition exists, but a userless authority
        // matches no class at all — not even "none".
        for writer in [
            MembershipWriter::System,
            MembershipWriter::AdminBypass,
            MembershipWriter::Anonymous,
        ] {
            let mut values = Map::new();
            values.insert("userId".to_owned(), json!("nobody"));
            values.insert("eventId".to_owned(), json!(event_id));
            values.insert("role".to_owned(), json!("guest"));
            let error = db
                .membership_plans()
                .plan_membership_insert(&writer, "event_members", values)
                .expect_err("userless open-join must be refused");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_MEMBERSHIP_NO_EFFECTIVE_PRINCIPAL",
                "writer {writer:?} must match no class"
            );
        }
    }

    // --- The declared transition matrix and its negatives -------------------

    #[test]
    fn invite_accept_and_leave() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        invite(&mut db, "alice", &event_id, "bob");
        let bob = member_id(&db, &event_id, "bob");
        assert_eq!(role_of(&db, &bob).as_deref(), Some("invited"));
        // Accept: self, invited -> guest.
        set_role(&mut db, "bob", &bob, "guest").expect("accept");
        assert_eq!(role_of(&db, &bob).as_deref(), Some("guest"));
        // Leave: self remove.
        let writer = user("bob");
        let plan = db
            .membership_plans()
            .plan_membership_remove(&writer, "event_members", &bob)
            .expect("leave plan");
        db.membership_plans()
            .commit_membership_plan(&writer, plan)
            .expect("leave");
        assert_eq!(role_of(&db, &bob), None);
    }

    #[test]
    fn open_join_seats_self_but_not_a_far_future_expiry() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        // Open join: non-member seats self as guest.
        let writer = user("carol");
        let mut values = Map::new();
        values.insert("userId".to_owned(), json!("carol"));
        values.insert("eventId".to_owned(), json!(event_id));
        values.insert("role".to_owned(), json!("guest"));
        let plan = db
            .membership_plans()
            .plan_membership_insert(&writer, "event_members", values.clone())
            .expect("open join plan");
        db.membership_plans()
            .commit_membership_plan(&writer, plan)
            .expect("open join");
        assert_eq!(
            role_of(&db, &member_id(&db, &event_id, "carol")).as_deref(),
            Some("guest")
        );

        // The open-join transition names no `fields`, so seating a far-future
        // expiresAt is refused (the field-bound insert hole).
        let mut with_expiry = Map::new();
        with_expiry.insert("userId".to_owned(), json!("dave"));
        with_expiry.insert("eventId".to_owned(), json!(event_id));
        with_expiry.insert("role".to_owned(), json!("guest"));
        with_expiry.insert("expiresAt".to_owned(), json!(9_999_999_999_999i64));
        let error = db
            .membership_plans()
            .plan_membership_insert(&user("dave"), "event_members", with_expiry)
            .expect_err("open join cannot seat expiresAt");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_INSERT_FIELD_DENIED"
        );
    }

    #[test]
    fn guest_cannot_self_promote() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        invite(&mut db, "alice", &event_id, "bob");
        let bob = member_id(&db, &event_id, "bob");
        set_role(&mut db, "bob", &bob, "guest").expect("accept");
        // No transition lets a guest promote themselves.
        let error = set_role(&mut db, "bob", &bob, "host").expect_err("guest self-promote refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED"
        );
    }

    #[test]
    fn invitee_cannot_act_on_another_invitees_row() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        invite(&mut db, "alice", &event_id, "bob");
        invite(&mut db, "alice", &event_id, "carol");
        let carol = member_id(&db, &event_id, "carol");
        // Bob (invited) tries to accept Carol's invite (target other) -> refused.
        let error = set_role(&mut db, "bob", &carol, "guest")
            .expect_err("acting on another's row is refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED"
        );
        // And bob cannot kick carol (remove other requires host).
        let plan =
            db.membership_plans()
                .plan_membership_remove(&user("bob"), "event_members", &carol);
        assert_eq!(
            plan.expect_err("non-host kick refused").diagnostic.code,
            "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED"
        );
    }

    #[test]
    fn patch_is_field_bound_self_cannot_extend_own_expiry_host_can() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        invite(&mut db, "alice", &event_id, "bob");
        let bob = member_id(&db, &event_id, "bob");
        set_role(&mut db, "bob", &bob, "guest").expect("accept");

        // Self may patch own notifyPrefs.
        let mut prefs = Map::new();
        prefs.insert("notifyPrefs".to_owned(), json!("muted"));
        let plan = db
            .membership_plans()
            .plan_membership_patch(&user("bob"), "event_members", &bob, prefs)
            .expect("prefs plan");
        db.membership_plans()
            .commit_membership_plan(&user("bob"), plan)
            .expect("prefs");

        // Self may NOT extend own expiresAt (the self-renewal hole).
        let mut extend = Map::new();
        extend.insert("expiresAt".to_owned(), json!(9_999_999_999_999i64));
        let error = db
            .membership_plans()
            .plan_membership_patch(&user("bob"), "event_members", &bob, extend.clone())
            .expect_err("self expiry extend refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED"
        );

        // But a host may extend a guest's expiresAt.
        let plan = db
            .membership_plans()
            .plan_membership_patch(&user("alice"), "event_members", &bob, extend)
            .expect("host extend plan");
        db.membership_plans()
            .commit_membership_plan(&user("alice"), plan)
            .expect("host extend");
    }

    #[test]
    fn patch_from_roles_allow_guest_refuse_cohost_and_omission_means_any_role() {
        let mut restricted_schema = membership_schema();
        restricted_schema.tables[1]
            .membership
            .as_mut()
            .unwrap()
            .transitions
            .iter_mut()
            .find(|transition| {
                transition.op == MembershipOp::Patch && transition.target == MembershipTarget::Other
            })
            .unwrap()
            .from = Some(vec!["guest".to_owned()]);
        let mut restricted = LocalDatabase::memory().unwrap();
        restricted.activate_current_auth_catalog().unwrap();
        restricted
            .schema_seed()
            .apply_schema(restricted_schema)
            .unwrap();
        let (event_id, _) = create_event(&mut restricted, "alice");
        invite(&mut restricted, "alice", &event_id, "bob");
        let bob = member_id(&restricted, &event_id, "bob");
        set_role(&mut restricted, "bob", &bob, "guest").unwrap();
        let expiry = Map::from_iter([("expiresAt".to_owned(), json!(5000))]);
        let guest_patch = restricted
            .membership_plans()
            .plan_membership_patch(&user("alice"), "event_members", &bob, expiry.clone())
            .expect("guest is in from set");
        restricted
            .membership_plans()
            .commit_membership_plan(&user("alice"), guest_patch)
            .unwrap();
        set_role(&mut restricted, "alice", &bob, "cohost").unwrap();
        let error = restricted
            .membership_plans()
            .plan_membership_patch(&user("alice"), "event_members", &bob, expiry.clone())
            .expect_err("cohost is outside from set");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED"
        );

        let mut unrestricted = ready_db();
        let (event_id, _) = create_event(&mut unrestricted, "alice");
        invite(&mut unrestricted, "alice", &event_id, "bob");
        let bob = member_id(&unrestricted, &event_id, "bob");
        set_role(&mut unrestricted, "bob", &bob, "guest").unwrap();
        set_role(&mut unrestricted, "alice", &bob, "cohost").unwrap();
        unrestricted
            .membership_plans()
            .plan_membership_patch(&user("alice"), "event_members", &bob, expiry)
            .expect("omitted from accepts any current role");
    }

    // --- lastHolder: establishment, preservation, the eligible-holder rule --

    #[test]
    fn creating_a_protected_resource_requires_seating_the_bootstrap_holder() {
        let mut db = ready_db();
        // A raw resource insert of a protected declaration's resource is refused;
        // it must go through the bootstrap path.
        let error = db
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Insert {
                    table: "events".to_owned(),
                    id: "orphan-event".to_owned(),
                    values: Map::new(),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect_err("bare protected resource insert refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_BOOTSTRAP_REQUIRED"
        );
        // The bootstrap path succeeds and seats the host.
        let (event_id, host_id) = create_event(&mut db, "alice");
        assert_eq!(role_of(&db, &host_id).as_deref(), Some("host"));

        // Bootstrap is creation-bound: an EXISTING resource can never obtain the
        // witness. The only bootstrap API mints a fresh resource id, so seating a
        // second `host` on the already-created event must go through the ordinary
        // transition matrix — which declares no insert transition seating `host` —
        // and is refused. (Equivalently: a zero-member / just-emptied / imported
        // resource has no fresh creation for the witness to bind to.)
        let mut usurp = Map::new();
        usurp.insert("userId".to_owned(), json!("mallory"));
        usurp.insert("eventId".to_owned(), json!(event_id));
        usurp.insert("role".to_owned(), json!("host"));
        let error = db
            .membership_plans()
            .plan_membership_insert(&user("mallory"), "event_members", usurp)
            .expect_err("no bootstrap witness on an existing resource");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED"
        );
    }

    #[test]
    fn a_lone_host_cannot_leave_but_two_hosts_allow_one_to_leave() {
        let mut db = ready_db();
        let (event_id, host_id) = create_event(&mut db, "alice");
        // Lone host leaving would strand the resource.
        let error = db
            .membership_plans()
            .plan_membership_remove(&user("alice"), "event_members", &host_id)
            .expect_err("lone host leave refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND"
        );

        // Seat a second host; now alice may leave.
        promote_to_host(&mut db, "alice", &event_id, "bob");
        let plan = db
            .membership_plans()
            .plan_membership_remove(&user("alice"), "event_members", &host_id)
            .expect("second host present");
        db.membership_plans()
            .commit_membership_plan(&user("alice"), plan)
            .expect("alice leaves");
        // And now bob is the lone host again.
        let bob_id = member_id(&db, &event_id, "bob");
        let error = db
            .membership_plans()
            .plan_membership_remove(&user("bob"), "event_members", &bob_id)
            .expect_err("bob is now the lone host");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND"
        );
    }

    #[test]
    fn eligible_holder_two_step_schedule_is_refused() {
        // The review-caught trap: deactivate A (not sole) -> B leaves -> resource
        // held only by dead A. Eligibility, not row-count, closes it.
        let mut db = ready_db();
        seed_agent(&mut db, "agent-a");
        seed_agent(&mut db, "agent-b");
        let (event_id, agent_a_host) = create_event(&mut db, "agent-a");
        promote_to_host(&mut db, "agent-a", &event_id, "agent-b");
        let agent_b_host = member_id(&db, &event_id, "agent-b");

        // Deactivate A — allowed, B is still an eligible holder.
        db.deactivate_agent("agent-a", 100, &membership_schema())
            .expect("A is not the last eligible holder");

        // B leaving is now refused — A is ineligible, so B is the last eligible
        // holder and the resource would strand permanently.
        let error = db
            .membership_plans()
            .plan_membership_remove(&user("agent-b"), "event_members", &agent_b_host)
            .expect_err("second-step leave must be refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND"
        );
        let _ = agent_a_host;
    }

    #[test]
    fn lifecycle_holder_check_cannot_hide_a_later_future_row_after_a_valid_holder() {
        let mut db = ready_db();
        for principal in ["agent-a", "agent-b", "agent-z"] {
            seed_agent(&mut db, principal);
        }
        let (event_id, _) = create_event(&mut db, "agent-a");
        promote_to_host(&mut db, "agent-a", &event_id, "agent-b");
        promote_to_host(&mut db, "agent-a", &event_id, "agent-z");
        let future_holder = member_id(&db, &event_id, "agent-z");
        let head = db.current_version().unwrap();
        db.conn
            .execute(
                "UPDATE event_members SET _version = ?1 WHERE _id = ?2",
                params![(head + 1) as i64, future_holder],
            )
            .unwrap();

        let error = db
            .deactivate_agent("agent-a", 100, &membership_schema())
            .expect_err("valid agent-b must not hide later future agent-z");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");
        assert!(!db.agent_is_deactivated("agent-a").unwrap());
        assert_eq!(db.current_version().unwrap(), head);
    }

    #[test]
    fn final_holder_removal_racing_deactivation_refuses_the_second_commit_in_both_orders() {
        let prepare = || {
            let mut db = ready_db();
            seed_agent(&mut db, "agent-a");
            seed_agent(&mut db, "agent-b");
            let (event_id, agent_a) = create_event(&mut db, "agent-a");
            promote_to_host(&mut db, "agent-a", &event_id, "agent-b");
            let agent_b = member_id(&db, &event_id, "agent-b");
            (db, agent_a, agent_b)
        };

        // Deactivation commits first. The removal's captured survivor row did
        // not change, so only the shared commit-stage eligibility evaluator can
        // detect that spending the stale plan would strand the resource.
        let (mut auth_first, agent_a, agent_b) = prepare();
        let stale_remove = auth_first
            .membership_plans()
            .plan_membership_remove(&user("agent-b"), "event_members", &agent_b)
            .unwrap();
        auth_first
            .deactivate_agent("agent-a", 100, &membership_schema())
            .unwrap();
        let error = auth_first
            .membership_plans()
            .commit_membership_plan(&user("agent-b"), stale_remove)
            .expect_err("stale removal must observe the survivor's ineligibility");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND"
        );
        assert_eq!(role_of(&auth_first, &agent_b).as_deref(), Some("host"));
        let _ = agent_a;

        // Removal commits first. Deactivation then runs the same predicate from
        // the auth side and is the refused second writer.
        let (mut membership_first, agent_a, agent_b) = prepare();
        let remove = membership_first
            .membership_plans()
            .plan_membership_remove(&user("agent-b"), "event_members", &agent_b)
            .unwrap();
        membership_first
            .membership_plans()
            .commit_membership_plan(&user("agent-b"), remove)
            .unwrap();
        let error = membership_first
            .deactivate_agent("agent-a", 100, &membership_schema())
            .expect_err("deactivation cannot strand the post-removal resource");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_DEACTIVATION_WOULD_STRAND"
        );
        assert_eq!(
            role_of(&membership_first, &agent_a).as_deref(),
            Some("host")
        );
    }

    #[test]
    fn a_deactivated_principal_cannot_be_promoted_into_the_protected_role() {
        let mut db = ready_db();
        seed_agent(&mut db, "agent-a");
        seed_agent(&mut db, "agent-dead");
        let (event_id, _) = create_event(&mut db, "agent-a");
        // Seat agent-dead as cohost, then deactivate it.
        invite(&mut db, "agent-a", &event_id, "agent-dead");
        let dead = member_id(&db, &event_id, "agent-dead");
        set_role(&mut db, "agent-dead", &dead, "guest").expect("accept");
        set_role(&mut db, "agent-a", &dead, "cohost").expect("cohost");
        db.deactivate_agent("agent-dead", 200, &membership_schema())
            .expect("cohost deactivation strands nothing");
        // Promoting the deactivated cohost to host is refused: the set cannot be
        // kept full with corpses.
        let error = set_role(&mut db, "agent-a", &dead, "host")
            .expect_err("promoting a corpse into the protected role is refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_INELIGIBLE_HOLDER"
        );
    }

    #[test]
    fn promotion_racing_deactivation_rechecks_eligibility_in_both_commit_orders() {
        let prepare = || {
            let mut db = ready_db();
            seed_agent(&mut db, "agent-a");
            seed_agent(&mut db, "agent-b");
            let (event_id, _) = create_event(&mut db, "agent-a");
            invite(&mut db, "agent-a", &event_id, "agent-b");
            let target = member_id(&db, &event_id, "agent-b");
            set_role(&mut db, "agent-b", &target, "guest").unwrap();
            set_role(&mut db, "agent-a", &target, "cohost").unwrap();
            (db, target)
        };

        // Auth lifecycle wins first: the stale planned promotion must not add
        // an ineligible protected holder just because agent-a still protects
        // the resource and the aggregate final state is otherwise nonempty.
        let (mut auth_first, target) = prepare();
        let stale_promotion = auth_first
            .membership_plans()
            .plan_membership_set_role(&user("agent-a"), "event_members", &target, "host")
            .unwrap();
        auth_first
            .deactivate_agent("agent-b", 100, &membership_schema())
            .unwrap();
        let error = auth_first
            .membership_plans()
            .commit_membership_plan(&user("agent-a"), stale_promotion)
            .expect_err("commit must recheck target eligibility after deactivation");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_INELIGIBLE_HOLDER"
        );
        assert_eq!(role_of(&auth_first, &target).as_deref(), Some("cohost"));

        // Membership wins first: the promotion is valid while the target is
        // live, then deactivation may commit because agent-a remains an
        // eligible holder. Both serialized outcomes preserve the invariant.
        let (mut membership_first, target) = prepare();
        let promotion = membership_first
            .membership_plans()
            .plan_membership_set_role(&user("agent-a"), "event_members", &target, "host")
            .unwrap();
        membership_first
            .membership_plans()
            .commit_membership_plan(&user("agent-a"), promotion)
            .unwrap();
        membership_first
            .deactivate_agent("agent-b", 100, &membership_schema())
            .unwrap();
        assert_eq!(role_of(&membership_first, &target).as_deref(), Some("host"));
    }

    #[test]
    fn protected_demotion_racing_deactivation_refuses_the_second_commit_in_both_orders() {
        // Auth lifecycle wins: B is still an eligible host when A deactivates,
        // but the stale demotion of B must not leave only deactivated A.
        let (mut auth_first, _, _, agent_b, _, _) = sessions_holder_fixture(true);
        let manifest = auth_first.schema().clone();
        let demote = auth_first
            .membership_plans()
            .plan_membership_set_role(&user("agent-a"), "event_members", &agent_b, "cohost")
            .expect("demotion plan");
        auth_first
            .deactivate_agent("agent-a", 100, &manifest)
            .expect("B remains an eligible host");
        let error = auth_first
            .membership_plans()
            .commit_membership_plan(&user("agent-a"), demote)
            .expect_err("demotion cannot spend a deactivated survivor");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND"
        );
        assert_eq!(role_of(&auth_first, &agent_b).as_deref(), Some("host"));

        // Membership wins: B leaves the protected role, making A the final
        // eligible holder, so the auth-side evaluator refuses A's deactivation.
        let (mut membership_first, _, agent_a, agent_b, _, _) = sessions_holder_fixture(true);
        let manifest = membership_first.schema().clone();
        let demote = membership_first
            .membership_plans()
            .plan_membership_set_role(&user("agent-a"), "event_members", &agent_b, "cohost")
            .expect("demotion plan");
        membership_first
            .membership_plans()
            .commit_membership_plan(&user("agent-a"), demote)
            .expect("demotion commits first");
        let error = membership_first
            .deactivate_agent("agent-a", 100, &manifest)
            .expect_err("deactivation cannot strand the post-demotion resource");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_DEACTIVATION_WOULD_STRAND"
        );
        assert_eq!(
            role_of(&membership_first, &agent_a).as_deref(),
            Some("host")
        );
    }

    #[test]
    fn protected_departures_racing_credential_revocation_refuse_the_second_commit() {
        for demote in [false, true] {
            // Credential revocation wins while B is still an eligible host.
            // The stale departure must then fail the shared final-state check.
            let (mut auth_first, _, _, agent_b, agent_a_credential, _) =
                sessions_holder_fixture(demote);
            let departure = if demote {
                auth_first
                    .membership_plans()
                    .plan_membership_set_role(&user("agent-a"), "event_members", &agent_b, "cohost")
                    .expect("demotion plan")
            } else {
                auth_first
                    .membership_plans()
                    .plan_membership_remove(&user("agent-b"), "event_members", &agent_b)
                    .expect("removal plan")
            };
            auth_first
                .revoke_agent_credential_family(&agent_a_credential, 100)
                .expect("B remains an eligible holder during revocation");
            let writer = if demote {
                user("agent-a")
            } else {
                user("agent-b")
            };
            let error = auth_first
                .membership_plans()
                .commit_membership_plan(&writer, departure)
                .expect_err("departure cannot spend a now-unrecoverable survivor");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND",
                "demote={demote}"
            );
            assert_eq!(role_of(&auth_first, &agent_b).as_deref(), Some("host"));

            // Membership wins first, leaving A as the sole protected holder;
            // credential-family revocation must roll back rather than strand it.
            let (mut membership_first, _, agent_a, agent_b, agent_a_credential, _) =
                sessions_holder_fixture(demote);
            let departure = if demote {
                membership_first
                    .membership_plans()
                    .plan_membership_set_role(&user("agent-a"), "event_members", &agent_b, "cohost")
                    .expect("demotion plan")
            } else {
                membership_first
                    .membership_plans()
                    .plan_membership_remove(&user("agent-b"), "event_members", &agent_b)
                    .expect("removal plan")
            };
            let writer = if demote {
                user("agent-a")
            } else {
                user("agent-b")
            };
            membership_first
                .membership_plans()
                .commit_membership_plan(&writer, departure)
                .expect("membership departure commits first");
            let error = membership_first
                .revoke_agent_credential_family(&agent_a_credential, 100)
                .expect_err("credential revocation cannot strand the resource");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND",
                "demote={demote}"
            );
            membership_first
                .resolve_agent_credential(&agent_a_credential, 100)
                .expect("refused revocation keeps A recoverable");
            assert_eq!(
                role_of(&membership_first, &agent_a).as_deref(),
                Some("host")
            );
        }
    }

    #[test]
    fn concurrent_final_two_host_removals_yield_one_commit_one_conflict() {
        let mut db = ready_db();
        let (event_id, alice_host) = create_event(&mut db, "alice");
        promote_to_host(&mut db, "alice", &event_id, "bob");
        let bob_host = member_id(&db, &event_id, "bob");

        // Both leaves are PLANNED against the same snapshot (two eligible hosts).
        let alice_plan = db
            .membership_plans()
            .plan_membership_remove(&user("alice"), "event_members", &alice_host)
            .expect("alice plan");
        let bob_plan = db
            .membership_plans()
            .plan_membership_remove(&user("bob"), "event_members", &bob_host)
            .expect("bob plan");

        // The first commits; the second relied on the first's row surviving, so it
        // fails commit-time read-set validation.
        db.membership_plans()
            .commit_membership_plan(&user("alice"), alice_plan)
            .expect("alice commits");
        let error = db
            .membership_plans()
            .commit_membership_plan(&user("bob"), bob_plan)
            .expect_err("bob's concurrent final removal must fail at commit");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
        // Exactly one host remains — the resource is never stranded.
        assert_eq!(role_of(&db, &bob_host).as_deref(), Some("host"));
        assert_eq!(role_of(&db, &alice_host), None);
    }

    #[test]
    fn caller_removal_races_every_membership_operation_in_both_commit_orders() {
        for operation in CallerAuthorityOperation::ALL {
            // Authority loss wins: every sanctioned operation must reject the
            // caller-role witness it planned while Alice was a host.
            let (mut authority_first, event_id, alice, _, target) =
                caller_authority_fixture(membership_schema());
            let stale = plan_caller_authority_operation(
                &authority_first,
                operation,
                "alice",
                &event_id,
                &target,
            );
            let remove_caller = authority_first
                .membership_plans()
                .plan_membership_remove(&user("alice"), "event_members", &alice)
                .expect("second host permits caller removal");
            authority_first
                .membership_plans()
                .commit_membership_plan(&user("alice"), remove_caller)
                .expect("caller membership removal commits first");
            let error = authority_first
                .membership_plans()
                .commit_membership_plan(&user("alice"), stale)
                .expect_err("stale caller authority must not commit");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT",
                "operation {operation:?}"
            );

            // Operation wins: the authority-changing plan may either remain
            // valid or conservatively conflict on another captured roster
            // fact. In the latter case a fresh plan must commit; the important
            // ordering property is that the authorized operation linearized
            // before authority ended, never after it.
            let (mut operation_first, event_id, alice, _, target) =
                caller_authority_fixture(membership_schema());
            let operation_plan = plan_caller_authority_operation(
                &operation_first,
                operation,
                "alice",
                &event_id,
                &target,
            );
            let remove_caller = operation_first
                .membership_plans()
                .plan_membership_remove(&user("alice"), "event_members", &alice)
                .expect("concurrent caller removal plan");
            operation_first
                .membership_plans()
                .commit_membership_plan(&user("alice"), operation_plan)
                .unwrap_or_else(|error| panic!("operation {operation:?} must win: {error}"));
            if let Err(error) = operation_first
                .membership_plans()
                .commit_membership_plan(&user("alice"), remove_caller)
            {
                assert_eq!(
                    error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT",
                    "operation {operation:?}"
                );
                let retry = operation_first
                    .membership_plans()
                    .plan_membership_remove(&user("alice"), "event_members", &alice)
                    .expect("fresh caller removal plan");
                operation_first
                    .membership_plans()
                    .commit_membership_plan(&user("alice"), retry)
                    .expect("fresh caller removal commits");
            }
        }
    }

    #[test]
    fn caller_demotion_races_every_membership_operation_in_both_commit_orders() {
        let schema = || {
            let mut schema = membership_schema();
            allow_host_demotion(&mut schema);
            schema
        };
        for operation in CallerAuthorityOperation::ALL {
            // The caller's row id survives a demotion, so this specifically
            // proves that the captured dependency includes the exact role that
            // produced the `host` class rather than row existence alone.
            let (mut authority_first, event_id, alice, _, target) =
                caller_authority_fixture(schema());
            let stale = plan_caller_authority_operation(
                &authority_first,
                operation,
                "alice",
                &event_id,
                &target,
            );
            let demote_caller = authority_first
                .membership_plans()
                .plan_membership_set_role(&user("bob"), "event_members", &alice, "cohost")
                .expect("bob may demote alice");
            authority_first
                .membership_plans()
                .commit_membership_plan(&user("bob"), demote_caller)
                .expect("caller demotion commits first");
            let error = authority_first
                .membership_plans()
                .commit_membership_plan(&user("alice"), stale)
                .expect_err("a host plan cannot survive caller demotion");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT",
                "operation {operation:?}"
            );

            let (mut operation_first, event_id, alice, _, target) =
                caller_authority_fixture(schema());
            let operation_plan = plan_caller_authority_operation(
                &operation_first,
                operation,
                "alice",
                &event_id,
                &target,
            );
            let demote_caller = operation_first
                .membership_plans()
                .plan_membership_set_role(&user("bob"), "event_members", &alice, "cohost")
                .expect("concurrent caller demotion plan");
            operation_first
                .membership_plans()
                .commit_membership_plan(&user("alice"), operation_plan)
                .unwrap_or_else(|error| panic!("operation {operation:?} must win: {error}"));
            if let Err(error) = operation_first
                .membership_plans()
                .commit_membership_plan(&user("bob"), demote_caller)
            {
                assert_eq!(
                    error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT",
                    "operation {operation:?}"
                );
                let retry = operation_first
                    .membership_plans()
                    .plan_membership_set_role(&user("bob"), "event_members", &alice, "cohost")
                    .expect("fresh caller demotion plan");
                operation_first
                    .membership_plans()
                    .commit_membership_plan(&user("bob"), retry)
                    .expect("fresh caller demotion commits");
            }
        }
    }

    #[test]
    fn absent_caller_insert_witness_races_membership_creation_in_both_commit_orders() {
        let schema = || {
            let mut schema = membership_schema();
            allow_none_class_insert(&mut schema);
            schema
        };
        let other_insert = |db: &LocalDatabase, event_id: &str| {
            db.membership_plans_read()
                .plan_membership_insert(
                    &user("mallory"),
                    "event_members",
                    Map::from_iter([
                        ("userId".to_owned(), json!("dave")),
                        ("eventId".to_owned(), json!(event_id)),
                        ("role".to_owned(), json!("invited")),
                    ]),
                )
                .expect("none-class other insert plan")
        };
        let join = |db: &LocalDatabase, event_id: &str| {
            db.membership_plans_read()
                .plan_membership_insert(
                    &user("mallory"),
                    "event_members",
                    Map::from_iter([
                        ("userId".to_owned(), json!("mallory")),
                        ("eventId".to_owned(), json!(event_id)),
                        ("role".to_owned(), json!("guest")),
                    ]),
                )
                .expect("absent caller may open-join")
        };

        // Membership wins: the caller is no longer class `none`, so the stale
        // operation must conflict even though its target is unchanged.
        let (mut membership_first, event_id, _, _, _) = caller_authority_fixture(schema());
        let stale = other_insert(&membership_first, &event_id);
        let caller_join = join(&membership_first, &event_id);
        membership_first
            .membership_plans()
            .commit_membership_plan(&user("mallory"), caller_join)
            .expect("caller membership appears first");
        let error = membership_first
            .membership_plans()
            .commit_membership_plan(&user("mallory"), stale)
            .expect_err("none-class plan must reject an absent-to-present caller race");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");

        // None-class operation wins: both plans were prepared while the caller
        // was absent, so it legitimately linearizes before the class change.
        let (mut operation_first, event_id, _, _, _) = caller_authority_fixture(schema());
        let operation_plan = other_insert(&operation_first, &event_id);
        let caller_join = join(&operation_first, &event_id);
        operation_first
            .membership_plans()
            .commit_membership_plan(&user("mallory"), operation_plan)
            .expect("none-class operation commits first");
        operation_first
            .membership_plans()
            .commit_membership_plan(&user("mallory"), caller_join)
            .expect("caller membership commits second");
    }

    #[test]
    fn stale_privileged_plan_conflicts_after_caller_membership_is_removed() {
        let mut db = ready_db();
        let (event_id, alice_host) = create_event(&mut db, "alice");
        promote_to_host(&mut db, "alice", &event_id, "bob");
        let invite_plan = db
            .membership_plans()
            .plan_membership_insert(
                &user("alice"),
                "event_members",
                Map::from_iter([
                    ("userId".to_owned(), json!("carol")),
                    ("eventId".to_owned(), json!(event_id)),
                    ("role".to_owned(), json!("invited")),
                ]),
            )
            .expect("host invite planned");
        let leave = db
            .membership_plans()
            .plan_membership_remove(&user("alice"), "event_members", &alice_host)
            .expect("other host preserves resource");
        db.membership_plans()
            .commit_membership_plan(&user("alice"), leave)
            .expect("caller membership removed first");
        let error = db
            .membership_plans()
            .commit_membership_plan(&user("alice"), invite_plan)
            .expect_err("obsolete host authority must not commit");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
    }

    #[test]
    fn absent_caller_witness_conflicts_when_the_caller_becomes_a_member() {
        let mut schema = membership_schema();
        schema.tables[1]
            .membership
            .as_mut()
            .unwrap()
            .transitions
            .push(crate::manifest::MembershipTransition {
                op: MembershipOp::Insert,
                by: vec!["none".to_owned()],
                target: MembershipTarget::Other,
                from: None,
                to: Some(vec!["invited".to_owned()]),
                fields: None,
            });
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();
        db.schema_seed().apply_schema(schema).unwrap();
        let (event_id, _) = create_event(&mut db, "alice");
        let stale = db
            .membership_plans()
            .plan_membership_insert(
                &user("mallory"),
                "event_members",
                Map::from_iter([
                    ("userId".to_owned(), json!("carol")),
                    ("eventId".to_owned(), json!(event_id)),
                    ("role".to_owned(), json!("invited")),
                ]),
            )
            .expect("none-class other insert plan");
        let join = db
            .membership_plans()
            .plan_membership_insert(
                &user("mallory"),
                "event_members",
                Map::from_iter([
                    ("userId".to_owned(), json!("mallory")),
                    ("eventId".to_owned(), json!(event_id)),
                    ("role".to_owned(), json!("guest")),
                ]),
            )
            .expect("caller joins");
        db.membership_plans()
            .commit_membership_plan(&user("mallory"), join)
            .unwrap();
        let error = db
            .membership_plans()
            .commit_membership_plan(&user("mallory"), stale)
            .expect_err("empty caller witness must invalidate");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
    }

    // --- Referential integrity + teardown witness ---------------------------

    #[test]
    fn insert_naming_a_missing_resource_is_refused() {
        let db = ready_db();
        let mut values = Map::new();
        values.insert("userId".to_owned(), json!("carol"));
        values.insert("eventId".to_owned(), json!("ghost-event"));
        values.insert("role".to_owned(), json!("guest"));
        let error = db
            .membership_plans_read()
            .plan_membership_insert(&user("carol"), "event_members", values)
            .expect_err("insert on a missing resource is refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING"
        );
    }

    #[test]
    fn deleting_a_resource_with_members_is_refused_teardown_clears_and_deletes() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        // A plain resource delete while the host remains is refused.
        let error = db
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Delete {
                    table: "events".to_owned(),
                    id: event_id.clone(),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect_err("resource delete with members refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_RESOURCE_DELETE_BLOCKED"
        );
        // Teardown clears the whole roster (including the protected host) and
        // deletes the resource.
        let plan = db
            .membership_plans()
            .plan_membership_teardown(&user("alice"), "events", &event_id)
            .expect("teardown plan");
        db.membership_plans()
            .commit_membership_plan(&user("alice"), plan)
            .expect("teardown");
        let remaining: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM event_members WHERE eventId = ?1",
                params![event_id],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(remaining, 0);
        assert!(
            read_resource_version(&db.conn, "events", &event_id)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn concurrent_open_join_racing_teardown_yields_one_winner() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        let mut join_values = Map::new();
        join_values.insert("userId".to_owned(), json!("carol"));
        join_values.insert("eventId".to_owned(), json!(event_id));
        join_values.insert("role".to_owned(), json!("guest"));

        // Both planned against the same snapshot.
        let join_plan = db
            .membership_plans()
            .plan_membership_insert(&user("carol"), "event_members", join_values)
            .expect("join plan");
        let teardown_plan = db
            .membership_plans()
            .plan_membership_teardown(&user("alice"), "events", &event_id)
            .expect("teardown plan");

        // Teardown commits first; the racing insert then fails because the
        // resource row it captured is gone — no orphan on a deleted resource.
        db.membership_plans()
            .commit_membership_plan(&user("alice"), teardown_plan)
            .expect("teardown commits");
        let error = db
            .membership_plans()
            .commit_membership_plan(&user("carol"), join_plan)
            .expect_err("open join must lose to the completed teardown");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
    }

    #[test]
    fn open_join_committing_before_teardown_blocks_the_teardown() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        let mut join_values = Map::new();
        join_values.insert("userId".to_owned(), json!("carol"));
        join_values.insert("eventId".to_owned(), json!(event_id));
        join_values.insert("role".to_owned(), json!("guest"));
        let join_plan = db
            .membership_plans()
            .plan_membership_insert(&user("carol"), "event_members", join_values)
            .expect("join plan");
        let teardown_plan = db
            .membership_plans()
            .plan_membership_teardown(&user("alice"), "events", &event_id)
            .expect("teardown plan");
        // The insert commits first; the teardown's captured roster emptiness is
        // now stale, so it fails rather than orphaning the new member.
        db.membership_plans()
            .commit_membership_plan(&user("carol"), join_plan)
            .expect("join commits");
        let error = db
            .membership_plans()
            .commit_membership_plan(&user("alice"), teardown_plan)
            .expect_err("teardown must lose to the completed open join");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
    }

    // --- The expiry sweep ---------------------------------------------------

    #[test]
    fn sweep_is_system_only_remove_only_and_last_holder_wins() {
        let mut db = ready_db();
        let (event_id, host_id) = create_event(&mut db, "alice");
        // Give the host an expiry in the past and seat a guest with a past expiry.
        db.conn
            .execute(
                "UPDATE event_members SET expiresAt = 10 WHERE _id = ?1",
                params![host_id],
            )
            .expect("expire host");
        // Open-join carol, then expire her too.
        let mut carol = Map::new();
        carol.insert("userId".to_owned(), json!("carol"));
        carol.insert("eventId".to_owned(), json!(event_id));
        carol.insert("role".to_owned(), json!("guest"));
        let plan = db
            .membership_plans()
            .plan_membership_insert(&user("carol"), "event_members", carol)
            .expect("carol join");
        db.membership_plans()
            .commit_membership_plan(&user("carol"), plan)
            .expect("carol commit");
        let carol_id = member_id(&db, &event_id, "carol");
        db.conn
            .execute(
                "UPDATE event_members SET expiresAt = 10 WHERE _id = ?1",
                params![carol_id],
            )
            .expect("expire carol");

        // A user authority cannot sweep.
        let error = db
            .membership_plans()
            .plan_membership_sweep_expired(&user("alice"), "event_members", 1000)
            .expect_err("user cannot sweep");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_SWEEP_AUTHORITY");

        // System sweeps: carol (guest, expired) is removed; the host is skipped
        // because lastHolder wins over expiry.
        let plan = db
            .membership_plans()
            .plan_membership_sweep_expired(&MembershipWriter::System, "event_members", 1000)
            .expect("sweep plan");
        assert_eq!(plan.skipped_protected(), std::slice::from_ref(&host_id));
        let before_sweep = db.authorization_version().expect("pre-sweep version");
        let sweep = db
            .membership_plans()
            .commit_membership_plan(&MembershipWriter::System, plan)
            .expect("sweep commit");
        let authorization = sweep.authorization.expect("sweep witness");
        assert!(authorization.event, "expiry removal is event 1");
        assert_eq!(
            authorization.membership_declarations,
            vec!["event_members".to_owned()]
        );
        assert_eq!(authorization.version.epoch, before_sweep.epoch + 1);
        let sweep_record = db
            .membership_transition_log("event_members")
            .unwrap()
            .into_iter()
            .find(|record| record.principal == "carol" && record.op == "remove")
            .expect("expiry removal is durably attributed");
        assert_eq!(sweep_record.actor, "system");
        assert_eq!(sweep_record.writer_class, "system");
        assert_eq!(role_of(&db, &carol_id), None, "expired guest swept");
        assert_eq!(
            role_of(&db, &host_id).as_deref(),
            Some("host"),
            "protected host survives expiry"
        );
    }

    #[test]
    fn stale_expiry_sweep_conflicts_after_a_membership_is_renewed() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        invite(&mut db, "alice", &event_id, "carol");
        let carol = member_id(&db, &event_id, "carol");
        set_role(&mut db, "carol", &carol, "guest").unwrap();
        db.conn
            .execute(
                "UPDATE event_members SET expiresAt = 10 WHERE _id = ?1",
                params![carol],
            )
            .unwrap();
        let sweep = db
            .membership_plans()
            .plan_membership_sweep_expired(&MembershipWriter::System, "event_members", 100)
            .expect("expired row planned");
        let renewal = db
            .membership_plans()
            .plan_membership_patch(
                &user("alice"),
                "event_members",
                &carol,
                Map::from_iter([("expiresAt".to_owned(), json!(1000))]),
            )
            .expect("host renewal plan");
        db.membership_plans()
            .commit_membership_plan(&user("alice"), renewal)
            .expect("renewal commits first");
        let error = db
            .membership_plans()
            .commit_membership_plan(&MembershipWriter::System, sweep)
            .expect_err("stale sweep cannot delete a renewed row");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
        assert_eq!(role_of(&db, &carol).as_deref(), Some("guest"));
    }

    #[test]
    fn stale_expiry_sweep_conflicts_after_the_target_role_changes() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        invite(&mut db, "alice", &event_id, "carol");
        let carol = member_id(&db, &event_id, "carol");
        set_role(&mut db, "carol", &carol, "guest").unwrap();
        db.conn
            .execute(
                "UPDATE event_members SET expiresAt = 10 WHERE _id = ?1",
                params![carol],
            )
            .unwrap();
        let sweep = db
            .membership_plans()
            .plan_membership_sweep_expired(&MembershipWriter::System, "event_members", 100)
            .unwrap();
        set_role(&mut db, "alice", &carol, "cohost").unwrap();
        let error = db
            .membership_plans()
            .commit_membership_plan(&MembershipWriter::System, sweep)
            .expect_err("a stale sweep cannot delete a promoted row");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
        assert_eq!(role_of(&db, &carol).as_deref(), Some("cohost"));
    }

    #[test]
    fn two_expired_protected_holders_and_deactivation_serialize_safely() {
        let prepare = || {
            let mut db = ready_db();
            seed_agent(&mut db, "agent-a");
            seed_agent(&mut db, "agent-b");
            let (event_id, agent_a) = create_event(&mut db, "agent-a");
            promote_to_host(&mut db, "agent-a", &event_id, "agent-b");
            let agent_b = member_id(&db, &event_id, "agent-b");
            db.conn
                .execute(
                    "UPDATE event_members SET expiresAt = 10 WHERE _id IN (?1, ?2)",
                    params![agent_a, agent_b],
                )
                .unwrap();
            let sweep = db
                .membership_plans()
                .plan_membership_sweep_expired(&MembershipWriter::System, "event_members", 100)
                .unwrap();
            assert_eq!(
                sweep.writes.len(),
                1,
                "only one protected holder is removable"
            );
            assert_eq!(sweep.skipped_protected().len(), 1);
            let survivor_id = sweep.skipped_protected()[0].clone();
            let survivor: String = db
                .conn
                .query_row(
                    "SELECT userId FROM event_members WHERE _id = ?1",
                    params![survivor_id],
                    |row| row.get(0),
                )
                .unwrap();
            (db, sweep, survivor, survivor_id)
        };

        // Auth lifecycle wins: the sweep's target rows remain byte-for-byte
        // unchanged, but deleting its chosen expired holder would leave only a
        // deactivated skipped holder. The transaction-final evaluator refuses.
        let (mut auth_first, sweep, survivor, survivor_id) = prepare();
        auth_first
            .deactivate_agent(&survivor, 100, &membership_schema())
            .unwrap();
        let error = auth_first
            .membership_plans()
            .commit_membership_plan(&MembershipWriter::System, sweep)
            .expect_err("sweep cannot spend a now-ineligible survivor");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND"
        );
        assert_eq!(role_of(&auth_first, &survivor_id).as_deref(), Some("host"));

        // Sweep wins: it leaves exactly the deliberately skipped holder, whose
        // later deactivation is then refused from the auth side.
        let (mut sweep_first, sweep, survivor, survivor_id) = prepare();
        sweep_first
            .membership_plans()
            .commit_membership_plan(&MembershipWriter::System, sweep)
            .unwrap();
        let error = sweep_first
            .deactivate_agent(&survivor, 100, &membership_schema())
            .expect_err("the skipped protected holder remains authoritative");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_DEACTIVATION_WOULD_STRAND"
        );
        assert_eq!(role_of(&sweep_first, &survivor_id).as_deref(), Some("host"));
    }

    #[test]
    fn expired_protected_holders_and_credential_revocation_serialize_safely() {
        let prepare = || {
            let (db, _, agent_a, agent_b, agent_a_credential, agent_b_credential) =
                sessions_holder_fixture(false);
            db.conn
                .execute(
                    "UPDATE event_members SET expiresAt = 10 WHERE _id IN (?1, ?2)",
                    params![agent_a, agent_b],
                )
                .expect("expire both protected holders");
            let sweep = db
                .membership_plans_read()
                .plan_membership_sweep_expired(&MembershipWriter::System, "event_members", 100)
                .expect("expiry plan");
            assert_eq!(sweep.writes.len(), 1);
            assert_eq!(sweep.skipped_protected().len(), 1);
            let survivor_id = sweep.skipped_protected()[0].clone();
            let survivor: String = db
                .conn
                .query_row(
                    "SELECT userId FROM event_members WHERE _id = ?1",
                    params![survivor_id],
                    |row| row.get(0),
                )
                .expect("skipped survivor");
            (
                db,
                sweep,
                survivor,
                survivor_id,
                agent_a_credential,
                agent_b_credential,
            )
        };

        // Revocation wins while the other expired holder is still live. The
        // sweep cannot then delete that other holder and leave only the
        // deliberately skipped, now-unrecoverable principal.
        let (mut auth_first, sweep, survivor, survivor_id, agent_a_credential, agent_b_credential) =
            prepare();
        let survivor_credential = if survivor == "agent-a" {
            &agent_a_credential
        } else {
            &agent_b_credential
        };
        auth_first
            .revoke_agent_credential_family(survivor_credential, 100)
            .expect("the other expired holder is still recoverable before the sweep");
        let error = auth_first
            .membership_plans()
            .commit_membership_plan(&MembershipWriter::System, sweep)
            .expect_err("sweep cannot spend a revoked survivor");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND"
        );
        assert_eq!(role_of(&auth_first, &survivor_id).as_deref(), Some("host"));

        // Sweep wins and leaves exactly the skipped holder; revoking that
        // holder's final credential family must then roll back.
        let (mut sweep_first, sweep, survivor, survivor_id, agent_a_credential, agent_b_credential) =
            prepare();
        let survivor_credential = if survivor == "agent-a" {
            &agent_a_credential
        } else {
            &agent_b_credential
        };
        sweep_first
            .membership_plans()
            .commit_membership_plan(&MembershipWriter::System, sweep)
            .expect("sweep commits first");
        let error = sweep_first
            .revoke_agent_credential_family(survivor_credential, 100)
            .expect_err("revocation cannot strand the skipped holder");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND"
        );
        sweep_first
            .resolve_agent_credential(survivor_credential, 100)
            .expect("refused revocation preserves the credential family");
        assert_eq!(role_of(&sweep_first, &survivor_id).as_deref(), Some("host"));
    }

    #[test]
    fn same_table_membership_semijoin_uses_the_outer_row_and_generic_roster_reads_are_private() {
        let mut db = ready_db();
        let (event_one, _) = create_event(&mut db, "u1");
        invite(&mut db, "u1", &event_one, "u2");
        let u2 = member_id(&db, &event_one, "u2");
        set_role(&mut db, "u2", &u2, "guest").unwrap();
        let (event_two, _) = create_event(&mut db, "u3");

        let plan = QueryPlan {
            table_visibility: None,
            table: "event_members".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            membership_filters: vec![crate::manifest::MembershipPredicate {
                declaration: "event_members".to_owned(),
                resource: crate::manifest::MembershipResourceRef::RowField("eventId".to_owned()),
                roles: None,
            }],
            indexed_by: None,
        };
        let input = HandlerInput {
            auth: AuthInput {
                user_id: Some("u1".to_owned()),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let table = db.schema().table("event_members").unwrap();
        let (sql, values) = build_query_sql(
            table,
            db.schema(),
            &plan,
            &input,
            &BTreeMap::new(),
            None,
            0,
            None,
            "query-test",
            None,
            None,
            false,
            OrderDirection::Asc,
            None,
        )
        .expect("lower internal semi-join");
        assert!(sql.contains("AS \"__snapback_outer\""));
        assert!(sql.contains("AS \"__snapback_membership\""));
        let mut statement = db.conn.prepare(&sql).unwrap();
        let event_column = statement
            .column_names()
            .iter()
            .position(|column| *column == "eventId")
            .expect("eventId result column");
        let event_ids = statement
            .query_map(params_from_iter(values.iter()), |row| {
                row.get::<_, String>(event_column)
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(!event_ids.is_empty());
        assert!(event_ids.iter().all(|event| event == &event_one));
        assert!(!event_ids.iter().any(|event| event == &event_two));

        let error = db
            .query_reads_read()
            .query(&plan, &input)
            .expect_err("generic roster primary reads are private by default");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_READ_PRIVATE");
    }

    #[test]
    fn table_visibility_any_of_is_grouped_before_authored_refinements_and_denies_anonymous() {
        let mut db = ready_db();
        let (owned, _) = create_event(&mut db, "alice");
        let (shared, _) = create_event(&mut db, "bob");
        let (blocked, _) = create_event(&mut db, "carol");
        db.conn
            .execute(
                "UPDATE events SET title = 'viewer' WHERE _id = ?1",
                [&owned],
            )
            .unwrap();
        db.conn
            .execute("UPDATE events SET title = 'keep' WHERE _id = ?1", [&shared])
            .unwrap();
        db.conn
            .execute(
                "UPDATE events SET title = 'blocked' WHERE _id = ?1",
                [&blocked],
            )
            .unwrap();
        invite(&mut db, "bob", &shared, "viewer");
        let viewer_member = member_id(&db, &shared, "viewer");
        set_role(&mut db, "viewer", &viewer_member, "guest").unwrap();

        let plan = QueryPlan {
            table_visibility: Some(crate::manifest::TableVisibilityV1::AnyOf {
                arms: vec![
                    crate::manifest::TableVisibilityArmV1::Owner {
                        field: "title".to_owned(),
                    },
                    crate::manifest::TableVisibilityArmV1::Membership {
                        declaration: "event_members".to_owned(),
                        resource_field: "_id".to_owned(),
                        roles: Some(vec!["host".to_owned(), "guest".to_owned()]),
                    },
                ],
            }),
            table: "events".to_owned(),
            filters: vec![crate::manifest::FilterExpr {
                field: "title".to_owned(),
                op: crate::manifest::FilterOp::In,
                value: crate::manifest::ValueExpr::Literal(json!(["viewer", "keep"])),
            }],
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        };
        let authorized = HandlerInput {
            auth: AuthInput {
                user_id: Some("viewer".to_owned()),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let output = db.query_reads_read().query(&plan, &authorized).unwrap();
        let dependencies = db
            .query_reads_read()
            .with_pinned_read_view(|view| {
                crate::live_matcher::query_dependencies_from_plan(
                    &plan,
                    &authorized,
                    &output,
                    &view,
                )
            })
            .unwrap();
        assert!(dependencies.iter().any(|dependency| {
            dependency.table.as_deref() == Some("event_members")
                && dependency.kind == CapturedReadKind::Query
        }));
        let rows = output.rows;
        let ids = rows
            .iter()
            .map(|row| row["_id"].as_str().unwrap())
            .collect::<BTreeSet<_>>();
        assert_eq!(ids, BTreeSet::from([owned.as_str(), shared.as_str()]));
        assert!(
            !ids.contains(blocked.as_str()),
            "the refinement must AND with the grouped disjunction"
        );

        let anonymous = db
            .query_reads_read()
            .query(&plan, &HandlerInput::default())
            .unwrap();
        assert!(anonymous.rows.is_empty());
    }

    #[test]
    fn table_visibility_membership_preflights_versions_and_counts_bindings() {
        let mut db = ready_db();
        let (event_id, host_id) = create_event(&mut db, "alice");
        let visibility = crate::manifest::TableVisibilityV1::Membership {
            declaration: "event_members".to_owned(),
            resource_field: "_id".to_owned(),
            roles: Some(vec!["host".to_owned()]),
        };
        let input = HandlerInput {
            auth: AuthInput {
                user_id: Some("alice".to_owned()),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let plan = QueryPlan {
            table_visibility: Some(visibility.clone()),
            table: "events".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        };
        assert_eq!(
            db.query_reads_read().query(&plan, &input).unwrap().rows[0]["_id"],
            event_id
        );
        db.conn
            .execute(
                "UPDATE event_members SET _version = 0 WHERE _id = ?1",
                [&host_id],
            )
            .unwrap();
        let error = db.query_reads_read().query(&plan, &input).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");

        db.conn
            .execute(
                "UPDATE event_members SET _version = 1 WHERE _id = ?1",
                [&host_id],
            )
            .unwrap();
        let mut binding_plan = plan;
        binding_plan.filters = (0..crate::manifest::QUERY_MAX_FILTER_BINDINGS)
            .map(|_| crate::manifest::FilterExpr {
                field: "title".to_owned(),
                op: crate::manifest::FilterOp::Eq,
                value: crate::manifest::ValueExpr::Literal(json!("party")),
            })
            .collect();
        let error = db
            .query_reads_read()
            .query(&binding_plan, &input)
            .expect_err("visibility bindings share the portable query budget");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED"
        );
    }

    #[test]
    fn membership_semijoin_refuses_corrupt_authorization_rows_before_selection() {
        for (name, version) in [
            ("zero", SqlValue::Integer(0)),
            ("future", SqlValue::Integer(2)),
            ("text", SqlValue::Text("not-a-version".to_owned())),
        ] {
            let mut db = ready_db();
            let (event_id, host_id) = create_event(&mut db, "alice");
            let plan = QueryPlan {
                table_visibility: None,
                table: "events".to_owned(),
                filters: Vec::new(),
                order: Vec::new(),
                limit: None,
                membership_filters: vec![crate::manifest::MembershipPredicate {
                    declaration: "event_members".to_owned(),
                    resource: crate::manifest::MembershipResourceRef::RowField("_id".to_owned()),
                    roles: None,
                }],
                indexed_by: None,
            };
            let input = HandlerInput {
                auth: AuthInput {
                    user_id: Some("alice".to_owned()),
                    ..AuthInput::default()
                },
                ..HandlerInput::default()
            };
            let healthy = db
                .query_reads_read()
                .query(&plan, &input)
                .expect("healthy membership query");
            assert_eq!(healthy.rows.len(), 1);
            assert_eq!(healthy.rows[0]["_id"], event_id);

            db.conn
                .execute(
                    "UPDATE event_members SET _version = ?1 WHERE _id = ?2",
                    params![version, host_id],
                )
                .unwrap();
            let error = db
                .query_reads_read()
                .query(&plan, &input)
                .expect_err("corrupt membership row must not influence EXISTS");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{name}"
            );
        }
    }

    #[test]
    fn generated_reverse_index_is_covering_for_holder_lookup() {
        let db = ready_db();
        let index = "event_members__membership_reverse";
        let mut statement = db
            .conn
            .prepare(&format!(
                "PRAGMA index_info({})",
                quote_ident(index).unwrap()
            ))
            .unwrap();
        let columns = statement
            .query_map([], |row| row.get::<_, String>(2))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(columns, ["eventId", "role", "userId", "_id"]);
        drop(statement);
        db.conn
            .execute_batch(
                "WITH RECURSIVE sequence(value) AS (
                   VALUES(1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 2048
                 )
                 INSERT INTO event_members(
                   _id, _version, _createdAt, _updatedAt,
                   userId, eventId, role,
                   grantedByActor, grantedByEffective, grantedByGrant
                 )
                 SELECT printf('member-%04d', value), 1, 1, 1,
                        printf('user-%04d', value),
                        printf('event-%04d', value % 32),
                        CASE WHEN value % 8 = 0 THEN 'host' ELSE 'guest' END,
                        'test', 'test', NULL
                 FROM sequence;
                 ANALYZE event_members;",
            )
            .unwrap();
        let roster_count: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM event_members", [], |row| row.get(0))
            .unwrap();
        assert_eq!(roster_count, 2048);
        let detail: String = db
            .conn
            .query_row(
                "EXPLAIN QUERY PLAN
                 SELECT _id, _version, userId FROM event_members
                 WHERE eventId = ?1 AND role = ?2 AND userId <> ?3",
                params!["event", "host", "excluded"],
                |row| row.get(3),
            )
            .unwrap();
        assert!(
            detail.contains(index),
            "query plan did not use {index}: {detail}"
        );

        let mut app_schema = membership_schema();
        app_schema.tables.remove(0);
        let role_table = &mut app_schema.tables[0];
        role_table.fields.retain(|field| field.name != "eventId");
        let membership = role_table.membership.as_mut().unwrap();
        membership.scope = MembershipScope::App;
        membership.resource = None;
        membership.resource_table = None;
        membership.bootstrap_role = None;
        membership.last_holder = None;
        let mut app = LocalDatabase::memory().unwrap();
        app.activate_current_auth_catalog().unwrap();
        app.schema_seed().apply_schema(app_schema).unwrap();
        let mut statement = app
            .conn
            .prepare("PRAGMA index_info('event_members__membership_reverse')")
            .unwrap();
        let columns = statement
            .query_map([], |row| row.get::<_, String>(2))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(columns, ["role", "userId", "_id"]);
    }

    #[test]
    fn versioned_seed_conformance_precommit_fault_restores_complete_predecessor() {
        use crate::auth::coordinator::AuthCoordinator;
        use crate::auth::session_projection::{
            AuthorizationStreamRecord, ProjectionSource, SessionProjection,
        };
        use crate::seed_identity::{
            ExpectedDataVersionStreamV1, InstallSeedRequestV1, ResetSeedRequestV1,
            SEED_ARTIFACT_FORMAT_V1, SEED_INSTALL_REQUEST_FORMAT_V1, SEED_RESET_REQUEST_FORMAT_V1,
            SeedArtifactV1, SeedEnsureResultV1, SeedResetOperationV1, artifact_digest,
        };

        let manifest: SchemaManifest = serde_json::from_str(include_str!(
            "../../demos/todo/snapback/generated/schema.manifest.json"
        ))
        .expect("todo generated schema");
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(manifest)
            .expect("apply schema");
        let make_artifact = |version: &str, id: &str| {
            let mut artifact = SeedArtifactV1 {
                format_version: SEED_ARTIFACT_FORMAT_V1.to_owned(),
                app_id: "todo".to_owned(),
                seed_version: version.to_owned(),
                seed_digest: String::new(),
                tables: BTreeMap::from([(
                    "todos".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), json!(id)),
                        ("title".to_owned(), json!(version)),
                        ("completed".to_owned(), json!(false)),
                        ("userId".to_owned(), json!("user_conformance")),
                    ])],
                )]),
            };
            artifact.seed_digest = artifact_digest(&artifact).expect("artifact digest");
            artifact
        };
        let predecessor_artifact = make_artifact("predecessor", "old");
        let predecessor = db
            .schema_seed()
            .ensure_versioned_seed(InstallSeedRequestV1 {
                format_version: SEED_INSTALL_REQUEST_FORMAT_V1.to_owned(),
                operation_id: "01982c7a-7c00-7000-8000-000000000201".to_owned(),
                artifact: predecessor_artifact.clone(),
                requested_mode: AuthMode::Dev,
                asset_fixtures: None,
            })
            .expect("install predecessor");
        let SeedEnsureResultV1::Installed {
            receipt: predecessor_receipt,
        } = predecessor
        else {
            panic!("fresh predecessor must install")
        };

        let incarnation = db
            .ensure_authorization_stream_incarnation()
            .expect("authorization stream");
        let source = ProjectionSource {
            authorization_stream_value: AuthorizationStreamRecord::new(incarnation)
                .encode_bytes()
                .expect("stream record"),
            restore_declaration_id: None,
            users: Vec::new(),
            identities: Vec::new(),
            sessions: Vec::new(),
            superseded_tokens: Vec::new(),
        };
        let projection =
            SessionProjection::rebuild_with_fresh_startup_id(source, now_millis(), Instant::now())
                .expect("session projection");
        let coordinator = Arc::new(AuthCoordinator::new(projection).expect("coordinator"));
        let carrier = coordinator
            .premark_stream_reset_if_drained()
            .expect("reset carrier");
        let request = ResetSeedRequestV1 {
            format_version: SEED_RESET_REQUEST_FORMAT_V1.to_owned(),
            operation_id: "01982c7a-7c00-7000-8000-000000000202".to_owned(),
            operation: SeedResetOperationV1::ResetInstall,
            requested_mode: AuthMode::Dev,
            expected_data_version_stream: ExpectedDataVersionStreamV1::Present {
                value: predecessor_receipt.data_version_stream.clone(),
            },
            artifact: Some(make_artifact("successor", "new")),
        };
        let request_digest = request.request_digest().expect("request digest");
        inject_reset_commit_failure_for_test();
        let attempt = db
            .schema_seed()
            .attempt_versioned_seed_reset_with_authorization_stream(
                request,
                carrier.predecessor(),
                carrier.successor(),
            );
        coordinator
            .finish_stream_reset(carrier, attempt)
            .expect_err("precommit fault rolls back");

        let scan = db
            .query_reads_read()
            .scan_table("todos", 10, 0)
            .expect("predecessor rows");
        assert_eq!(scan.total, 1);
        assert_eq!(scan.rows[0]["_id"], "old");
        assert!(
            db.schema_seed()
                .replay_versioned_seed_operation(
                    "01982c7a-7c00-7000-8000-000000000202",
                    &request_digest,
                )
                .expect("operation lookup")
                .is_none()
        );
        let matched = db
            .schema_seed()
            .ensure_versioned_seed(InstallSeedRequestV1 {
                format_version: SEED_INSTALL_REQUEST_FORMAT_V1.to_owned(),
                operation_id: "01982c7a-7c00-7000-8000-000000000203".to_owned(),
                artifact: predecessor_artifact,
                requested_mode: AuthMode::Dev,
                asset_fixtures: None,
            })
            .expect("predecessor identity remains active");
        assert!(matches!(matched, SeedEnsureResultV1::Matched { .. }));
    }
}

#[cfg(test)]
mod media_ref_projection_acceptance_tests {
    use super::*;

    fn media_database() -> LocalDatabase {
        let manifest: SchemaManifest = serde_json::from_str(include_str!(
            "../../tests/acceptance/fixtures/media-profile/snapback/generated/schema.manifest.json"
        ))
        .expect("generated media fixture schema");
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(manifest)
            .expect("apply generated media fixture schema");
        db
    }

    fn asset(
        asset_id: &str,
        owner: &str,
        availability: crate::assets::AssetAvailability,
    ) -> crate::assets::AssetRecordV1 {
        let ready = availability == crate::assets::AssetAvailability::Ready;
        crate::assets::AssetRecordV1 {
            asset_id: asset_id.to_owned(),
            app_id: "media-profile-fixture".to_owned(),
            intent_id: "media-profile-fixture:profileImageUpload".to_owned(),
            intent_name: "profileImageUpload".to_owned(),
            intent_policy_hash: "sha256:media-fixture-policy".to_owned(),
            policy_generation: 0,
            owner_principal: owner.to_owned(),
            delivery_profile: crate::assets::AssetDeliveryProfile::PrivateStrict,
            read_access: crate::assets::AssetReadAccessPolicy::ViaReferences,
            grants_enabled: false,
            availability,
            primary_rendition_id: ready.then(|| format!("rendition-{asset_id}")),
            media_kind: ready.then_some(crate::contract_types::MediaKindV1::Image),
            lifecycle_generation: u64::from(ready),
            created_at_ms: 1,
            updated_at_ms: 1,
            deleted_at_ms: None,
        }
    }

    fn install_asset(
        db: &mut LocalDatabase,
        asset_id: &str,
        owner: &str,
        availability: crate::assets::AssetAvailability,
    ) {
        let ready = availability == crate::assets::AssetAvailability::Ready;
        let tx = db.conn.transaction().expect("asset fixture transaction");
        crate::assets::insert_asset(&tx, &asset(asset_id, owner, availability))
            .expect("insert fixture asset");
        if ready {
            crate::assets::insert_rendition(
                &tx,
                &crate::assets::AssetRenditionRecordV1 {
                    rendition_id: format!("rendition-{asset_id}"),
                    asset_id: asset_id.to_owned(),
                    variant_key: crate::assets::ASSET_RENDITION_PRIMARY.to_owned(),
                    blob_id: format!("blob-{asset_id}"),
                    state: crate::assets::AssetRenditionState::Ready,
                    recipe: "identity".to_owned(),
                    recipe_version: 1,
                    media_facts: Some(json!({ "contentType": "image/png" })),
                    created_at_ms: 1,
                    updated_at_ms: 1,
                    failure: None,
                },
            )
            .expect("insert ready primary rendition");
        }
        tx.commit().expect("commit asset fixture");
    }

    fn principal(user: &str) -> HandlerInput {
        HandlerInput {
            auth: AuthInput {
                principal: Some(user.to_owned()),
                user_id: Some(user.to_owned()),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        }
    }

    fn insert_profile(image: Value, return_document: bool) -> MutationPlan {
        MutationPlan {
            steps: vec![MutationStep::Insert {
                table: "profiles".to_owned(),
                values: BTreeMap::from([
                    ("ownerId".to_owned(), ValueExpr::Literal(json!("row-owner"))),
                    ("displayName".to_owned(), ValueExpr::Literal(json!("Ada"))),
                    ("image".to_owned(), ValueExpr::Literal(image)),
                ]),
                bind_id_as: Some("profileId".to_owned()),
            }],
            return_value: return_document.then(|| ReturnValue::Document {
                table: "profiles".to_owned(),
                id: ValueExpr::Binding("profileId".to_owned()),
            }),
        }
    }

    /// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
    /// @ref LLP 0244#d2-kind-is-disclosed-with-field-delivery-policy-produces-denied
    /// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
    #[test]
    fn query_projection_is_snapshot_local_retry_is_exact_and_denied_delivery_is_not_an_oracle() {
        let mut db = media_database();
        install_asset(
            &mut db,
            "asset-ready",
            "asset-owner",
            crate::assets::AssetAvailability::Ready,
        );
        let input = principal("asset-owner");
        let plan = insert_profile(json!("asset-ready"), true);
        let identity = ClientMutationIdentity::new("media-settlement", "setProfileImage", &input);

        let fresh = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &input, &identity)
            .expect("fresh media mutation");
        assert_eq!(
            fresh.output.result["image"],
            json!({ "assetId": "asset-ready", "kind": "image" })
        );
        let replay = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &input, &identity)
            .expect("same attempt replays");
        assert_eq!(
            replay.output, fresh.output,
            "retry republishes the exact settlement"
        );
        assert!(replay.changes.is_empty(), "retry performs no second write");

        let query = QueryPlan {
            table: "profiles".to_owned(),
            table_visibility: None,
            filters: Vec::new(),
            membership_filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            indexed_by: None,
        };
        let outsider = principal("outsider");
        let projected = db
            .query_reads_read()
            .query(&query, &outsider)
            .expect("readable row projects media in its pinned transaction");
        assert_eq!(projected.rows.len(), 1);
        assert_eq!(
            projected.rows[0]["image"],
            json!({ "assetId": "asset-ready", "kind": "image" })
        );

        let schema = db.schema().clone();
        let tx = db
            .conn
            .unchecked_transaction()
            .expect("authorization probe");
        let ready = crate::assets::load_asset(&tx, "asset-ready")
            .expect("load asset")
            .expect("ready asset exists");
        let decision = asset_read_authorized(&schema, &tx, Some("outsider"), &ready)
            .expect("asset authorization decision");
        assert!(
            !decision.authorized,
            "delivery remains denied despite coarse projection"
        );
        tx.rollback()
            .expect("rollback read-only authorization probe");

        let (format, sequence, seal): (String, i64, Option<String>) = db
            .conn
            .query_row(
                "SELECT settlement_format, settlement_record_sequence,
                        settlement_projection_seal_json
                   FROM _snapback_client_mutations
                  WHERE client_mutation_id = ?1",
                [&identity.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("retained media settlement");
        assert_eq!(format, MEDIA_SETTLEMENT_FORMAT_V1);
        assert!(sequence > 0);
        let seal: Value = serde_json::from_str(seal.as_deref().expect("media seal"))
            .expect("closed settlement seal");
        assert_eq!(seal["settlementId"], identity.activity_digest());
        assert!(seal["resultContractHash"].as_str().is_some());
        assert!(seal["mediaProjectionProfileHash"].as_str().is_some());
    }

    /// @ref LLP 0244#d3-vmedia-attachment-is-finalized-only-in-v1
    #[test]
    fn pending_media_attachment_is_refused_at_the_commit_boundary() {
        let mut db = media_database();
        install_asset(
            &mut db,
            "asset-pending",
            "asset-owner",
            crate::assets::AssetAvailability::Pending,
        );
        let error = db
            .mutation_writes()
            .execute_mutation(
                &insert_profile(json!("asset-pending"), false),
                &principal("asset-owner"),
            )
            .expect_err("pending media must not attach");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEDIA_ASSET_NOT_FINALIZED");
        let count: i64 = db
            .conn
            .query_row("SELECT count(*) FROM profiles", [], |row| row.get(0))
            .expect("profile count");
        assert_eq!(count, 0, "the refusing transaction rolls back its row");
    }

    /// @ref LLP 0244#d3-vmedia-attachment-is-finalized-only-in-v1
    #[test]
    fn projected_kind_objects_are_refused_as_forged_write_authority() {
        let mut db = media_database();
        let error = db
            .mutation_writes()
            .execute_mutation(
                &insert_profile(json!({ "assetId": "asset-ready", "kind": "video" }), false),
                &principal("asset-owner"),
            )
            .expect_err("MediaRef objects are output-only");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEDIA_WRITE_FORGED_KIND");
    }

    /// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
    #[test]
    fn valid_json_semantic_edit_of_media_settlement_fails_before_recovery_publication() {
        let mut db = media_database();
        install_asset(
            &mut db,
            "asset-ready",
            "asset-owner",
            crate::assets::AssetAvailability::Ready,
        );
        let input = principal("asset-owner");
        let plan = insert_profile(json!("asset-ready"), true);
        let identity = ClientMutationIdentity::new("media-tamper", "setProfileImage", &input);
        db.mutation_writes()
            .execute_mutation_idempotent(&plan, &input, &identity)
            .expect("sealed media settlement");

        let output_json: String = db
            .conn
            .query_row(
                "SELECT output_json FROM _snapback_client_mutations
                  WHERE client_mutation_id = ?1",
                [&identity.id],
                |row| row.get(0),
            )
            .expect("settlement output");
        let mut edited: Value = serde_json::from_str(&output_json).expect("valid settlement JSON");
        edited["result"]["image"]["kind"] = json!("video");
        let edited = settlement_jcs(&edited).expect("semantic edit remains canonical JSON");
        db.conn
            .execute(
                "UPDATE _snapback_client_mutations SET output_json = ?1
                  WHERE client_mutation_id = ?2",
                params![edited, identity.id],
            )
            .expect("install corruption fixture");

        let error = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &input, &identity)
            .expect_err("seal rejects valid-JSON semantic corruption");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_RESULT_INTEGRITY"
        );
    }

    /// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
    #[test]
    fn related_media_fact_movement_refuses_at_the_ordinary_occ_gate() {
        let mut db = media_database();
        install_asset(
            &mut db,
            "asset-ready",
            "asset-owner",
            crate::assets::AssetAvailability::Ready,
        );
        let snapshot_version = db.current_version().expect("snapshot version");
        let digest = media_projection_fact_digest_on(&db.conn, "asset-ready")
            .expect("captured related facts");
        let dependency = CapturedReadDependency {
            kind: CapturedReadKind::Permission,
            table: Some(crate::assets::ASSET_RECORDS_TABLE.to_owned()),
            id: Some("asset-ready".to_owned()),
            version: Some(snapshot_version),
            predicate: None,
            rows: Vec::new(),
            field: Some(MEDIA_PROJECTION_DEPENDENCY_FIELD_V1.to_owned()),
            value: Some(Value::String(digest)),
            order: None,
            limit: None,
            result_count: None,
            boundary: None,
        };

        let tx = db.conn.transaction().expect("external asset movement");
        let mut moved = crate::assets::load_asset(&tx, "asset-ready")
            .expect("load asset")
            .expect("ready asset");
        moved.lifecycle_generation += 1;
        moved.updated_at_ms += 1;
        crate::assets::store_asset(&tx, &moved).expect("move related facts");
        tx.commit().expect("commit external asset movement");

        let schema = db.schema().clone();
        let tx = db.conn.transaction().expect("commit OCC gate");
        let error = validate_captured_read_set(
            &tx,
            &schema,
            &principal("asset-owner"),
            std::slice::from_ref(&dependency),
            snapshot_version,
        )
        .expect_err("related asset movement must conflict before egress");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
        assert_eq!(error.diagnostic.details["retryPolicy"], "reject");
        tx.rollback().expect("rollback validation probe");
    }

    /// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
    #[test]
    fn settlement_epoch_watermarks_predecessors_and_never_reopens_legacy_admission() {
        let mut db = media_database();
        let plan = MutationPlan {
            steps: Vec::new(),
            return_value: Some(ReturnValue::Literal(json!({ "plain": true }))),
        };
        let input = HandlerInput::default();
        let predecessor = ClientMutationIdentity::new("legacy-predecessor", "plain", &input);
        let first = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &input, &predecessor)
            .expect("predecessor settlement");

        db.conn
            .execute(
                "UPDATE _snapback_client_mutations
                    SET settlement_format = NULL,
                        settlement_record_sequence = NULL,
                        settlement_projection_seal_json = NULL
                  WHERE client_mutation_id = ?1",
                [&predecessor.id],
            )
            .expect("model predecessor carrier");
        db.conn
            .execute(
                "DELETE FROM _snapback_meta
                  WHERE key IN (?1, ?2)",
                params![
                    META_SETTLEMENT_FORMAT_EPOCH_V1,
                    META_SETTLEMENT_NEXT_SEQUENCE_V1
                ],
            )
            .expect("model pre-epoch store");
        let tx = db.conn.transaction().expect("format migration");
        initialize_settlement_format_epoch_v1(&tx).expect("stamp immutable legacy watermark");
        tx.commit().expect("commit format migration");

        let (format, sequence): (String, i64) = db
            .conn
            .query_row(
                "SELECT settlement_format, settlement_record_sequence
                   FROM _snapback_client_mutations
                  WHERE client_mutation_id = ?1",
                [&predecessor.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("migrated predecessor");
        assert_eq!(format, LEGACY_SETTLEMENT_FORMAT_V1);
        assert_eq!(sequence, 1);
        let replay = db
            .mutation_writes()
            .execute_mutation_idempotent(&plan, &input, &predecessor)
            .expect("watermarked predecessor remains replayable");
        assert_eq!(replay.output, first.output);

        let successor = ClientMutationIdentity::new("post-watermark", "plain", &input);
        db.mutation_writes()
            .execute_mutation_idempotent(&plan, &input, &successor)
            .expect("post-watermark settlement");
        let (format, sequence): (String, i64) = db
            .conn
            .query_row(
                "SELECT settlement_format, settlement_record_sequence
                   FROM _snapback_client_mutations
                  WHERE client_mutation_id = ?1",
                [&successor.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("post-watermark carrier");
        assert_eq!(format, PLAIN_SETTLEMENT_FORMAT_V1);
        assert_eq!(sequence, 2);
    }

    fn proof_binding(nonce: u64) -> crate::runtime::MediaProjectionProofBindingV1 {
        crate::runtime::MediaProjectionProofBindingV1 {
            process_epoch: "process-proof-fixture".to_owned(),
            invocation_nonce: nonce,
            principal_binding: "sha256:principal-a".to_owned(),
            authority_instance_binding: "authority-a".to_owned(),
            function_id: "profiles:setImage".to_owned(),
            function_artifact_generation:
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_owned(),
            result_contract_hash: "sha256:result-a".to_owned(),
            pinned_snapshot: 7,
            request_identity: "request-a".to_owned(),
            client_mutation_identity:
                crate::runtime::MediaProjectionClientMutationIdentityV1::NoClientIdentity,
        }
    }

    fn empty_staged_proof(
        binding: crate::runtime::MediaProjectionProofBindingV1,
    ) -> crate::runtime::StagedMediaProjectionProofV1 {
        crate::runtime::StagedMediaProjectionProofV1::new(
            crate::runtime::MediaProjectionPlanV1 {
                occurrences: Vec::new(),
            },
            binding.result_contract_hash.clone(),
            binding,
            Vec::new(),
        )
    }

    fn proof_binding_for_identity(
        nonce: u64,
        identity: Option<&ClientMutationIdentity>,
    ) -> crate::runtime::MediaProjectionProofBindingV1 {
        let mut binding = proof_binding(nonce);
        binding.client_mutation_identity = match identity {
            Some(identity) => {
                crate::runtime::MediaProjectionClientMutationIdentityV1::ClientMutation(
                    identity.activity_digest(),
                )
            }
            None => crate::runtime::MediaProjectionClientMutationIdentityV1::NoClientIdentity,
        };
        binding
    }

    /// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
    #[test]
    fn closed_proof_binding_refuses_every_scope_authority_function_and_request_swap() {
        let binding = proof_binding(11);
        let proof = empty_staged_proof(binding.clone());
        let mut swaps = Vec::new();
        let mut cross_process = binding.clone();
        cross_process.process_epoch = "process-proof-fixture-b".to_owned();
        swaps.push(cross_process);
        let mut cross_invocation = binding.clone();
        cross_invocation.invocation_nonce += 1;
        swaps.push(cross_invocation);
        let mut cross_request = binding.clone();
        cross_request.request_identity = "request-b".to_owned();
        swaps.push(cross_request);
        let mut cross_principal = binding.clone();
        cross_principal.principal_binding = "sha256:principal-b".to_owned();
        swaps.push(cross_principal);
        let mut cross_authority = binding.clone();
        cross_authority.authority_instance_binding = "authority-b".to_owned();
        swaps.push(cross_authority);
        let mut cross_function = binding.clone();
        cross_function.function_id = "profiles:setBanner".to_owned();
        swaps.push(cross_function);
        let mut cross_generation = binding.clone();
        cross_generation.function_artifact_generation =
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_owned();
        swaps.push(cross_generation);
        let mut cross_contract = binding.clone();
        cross_contract.result_contract_hash = "sha256:result-b".to_owned();
        swaps.push(cross_contract);
        let mut cross_snapshot = binding.clone();
        cross_snapshot.pinned_snapshot += 1;
        swaps.push(cross_snapshot);
        let mut cross_client_mutation = binding.clone();
        cross_client_mutation.client_mutation_identity =
            crate::runtime::MediaProjectionClientMutationIdentityV1::ClientMutation(
                "sha256:client-mutation-b".to_owned(),
            );
        swaps.push(cross_client_mutation);

        for swapped in swaps {
            let error = validate_staged_media_projection_binding(&proof, &swapped)
                .expect_err("a proof cannot cross its prepared invocation binding");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED"
            );
        }
        validate_staged_media_projection_binding(&proof, &binding)
            .expect("the exact independently reconstructed binding is admitted");
    }

    /// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
    #[test]
    fn previous_none_collapses_refuse_missing_generation_and_concrete_commit_identity() {
        let mut missing_generation = proof_binding(12);
        missing_generation.function_artifact_generation.clear();
        let proof = empty_staged_proof(missing_generation.clone());
        let error = validate_staged_media_projection_binding(&proof, &missing_generation)
            .expect_err("equal absent generations cannot become a bindable proof fact");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED"
        );

        let input = principal("asset-owner");
        let concrete = ClientMutationIdentity::new("concrete-proof-id", "setImage", &input);
        let no_identity = empty_staged_proof(proof_binding(13));
        let error = validate_staged_media_projection_commit_identity(&no_identity, Some(&concrete))
            .expect_err("NoClientIdentity cannot collapse with a concrete storage identity");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED"
        );

        let concrete_proof = empty_staged_proof(proof_binding_for_identity(14, Some(&concrete)));
        let error = validate_staged_media_projection_commit_identity(&concrete_proof, None)
            .expect_err("a concrete proof identity cannot collapse with an identity-free lane");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED"
        );
    }

    fn empty_media_payload(
        binding: crate::runtime::MediaProjectionProofBindingV1,
        expected: crate::runtime::MediaProjectionProofBindingV1,
    ) -> BufferedCommitPayload {
        BufferedCommitPayload {
            writes: Vec::new(),
            sequence_allocations: Vec::new(),
            membership_plans: Vec::new(),
            read_dependencies: Vec::new(),
            result: json!({ "proof": "fresh" }),
            ctx_ledger: CtxAnswerLedger::default(),
            job_enqueues: Vec::new(),
            job_producer: None,
            asset_admissions: Vec::new(),
            asset_grant_ops: Vec::new(),
            media_projection_proof: Some(empty_staged_proof(binding)),
            expected_media_projection_binding: Some(expected),
        }
    }

    /// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
    #[test]
    fn dry_run_borrows_exact_proof_then_authoritative_commit_takes_its_owner() {
        let mut db = media_database();
        let input = principal("asset-owner");
        let binding = proof_binding(19);
        let proof = empty_staged_proof(binding.clone());
        let preview = db
            .mutation_writes()
            .dry_run_buffered_writes_with_jobs(
                &input,
                Vec::new(),
                Vec::new(),
                Vec::new(),
                Vec::new(),
                json!({ "proof": "previewed" }),
                CtxAnswerLedger::default(),
                Vec::new(),
                None,
                Vec::new(),
                Vec::new(),
                Some(&proof),
                Some(&binding),
            )
            .expect("preview borrows the staged proof");
        assert_eq!(preview.output.result, json!({ "proof": "previewed" }));
        assert!(proof.borrow_occurrences().is_empty());

        let identity = ClientMutationIdentity::new("media-proof-preview", "setImage", &input);
        let binding = proof_binding_for_identity(19, Some(&identity));
        let proof = empty_staged_proof(binding.clone());
        let committed = db
            .mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &input,
                BufferedCommitPayload {
                    writes: Vec::new(),
                    sequence_allocations: Vec::new(),
                    membership_plans: Vec::new(),
                    read_dependencies: Vec::new(),
                    result: json!({ "proof": "committed" }),
                    ctx_ledger: CtxAnswerLedger::default(),
                    job_enqueues: Vec::new(),
                    job_producer: None,
                    asset_admissions: Vec::new(),
                    asset_grant_ops: Vec::new(),
                    media_projection_proof: Some(proof),
                    expected_media_projection_binding: Some(binding),
                },
                Some(&identity),
                || Ok(()),
                || Ok(()),
            )
            .expect("authoritative commit takes the proof after preview");
        assert_eq!(committed.output.result, json!({ "proof": "committed" }));
    }

    /// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
    #[test]
    fn cancelled_attempt_expires_proof_fresh_retry_mints_new_nonce_and_same_id_winner_replays() {
        let mut db = media_database();
        let input = principal("asset-owner");
        let identity = ClientMutationIdentity::new("media-proof-lifecycle", "setImage", &input);
        let cancelled_binding = proof_binding_for_identity(20, Some(&identity));
        let error = db
            .mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &input,
                empty_media_payload(cancelled_binding.clone(), cancelled_binding),
                Some(&identity),
                || {
                    Err(SnapbackError::error(
                        "SNAPBACK_ACTION_CANCELLED",
                        "runtime",
                        "injected cancellation",
                    ))
                },
                || Ok(()),
            )
            .expect_err("cancellation drops the only proof owner");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_CANCELLED");
        assert!(
            db.settlement_read()
                .client_mutation_result(&identity)
                .expect("settlement lookup")
                .is_none(),
            "cancelled work retains no settlement"
        );

        let retry_binding = proof_binding_for_identity(21, Some(&identity));
        let committed = db
            .mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &input,
                empty_media_payload(retry_binding.clone(), retry_binding),
                Some(&identity),
                || Ok(()),
                || Ok(()),
            )
            .expect("fresh execution with a new invocation nonce commits");

        let mut losing_expected = proof_binding_for_identity(22, Some(&identity));
        losing_expected.request_identity = "cross-request-loser".to_owned();
        let replayed = db
            .mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &input,
                empty_media_payload(
                    proof_binding_for_identity(22, Some(&identity)),
                    losing_expected,
                ),
                Some(&identity),
                || Ok(()),
                || Ok(()),
            )
            .expect("same-id winner returns sealed bytes without admitting loser proof");
        assert_eq!(replayed.output, committed.output);
        assert!(replayed.changes.is_empty());
    }

    /// @ref LLP 0043#milestone-2-queued-mutation-replay
    /// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
    #[test]
    fn mixed_settlement_rows_ack_and_rebuild_to_exact_predecessor_counters() {
        let dir = tempfile::tempdir().expect("temporary mixed-settlement store");
        let path = dir.path().join("mixed-settlements.sqlite3");
        let manifest: SchemaManifest = serde_json::from_str(include_str!(
            "../../tests/acceptance/fixtures/media-profile/snapback/generated/schema.manifest.json"
        ))
        .expect("generated media fixture schema");
        let mut db = LocalDatabase::open(&path).expect("open media store");
        db.schema_seed()
            .apply_schema(manifest)
            .expect("apply media schema");
        install_asset(
            &mut db,
            "asset-mixed",
            "asset-owner",
            crate::assets::AssetAvailability::Ready,
        );
        let input = principal("asset-owner");
        let plain_plan = MutationPlan {
            steps: Vec::new(),
            return_value: Some(ReturnValue::Literal(json!({ "plain": true }))),
        };
        let legacy = ClientMutationIdentity::new("mixed-legacy", "plain", &input);
        db.mutation_writes()
            .execute_mutation_idempotent(&plain_plan, &input, &legacy)
            .expect("write predecessor row");
        db.conn
            .execute(
                "UPDATE _snapback_client_mutations
                    SET settlement_format=NULL, settlement_record_sequence=NULL,
                        settlement_projection_seal_json=NULL
                  WHERE client_mutation_id=?1",
                [&legacy.id],
            )
            .expect("model legacy carrier");
        db.conn
            .execute(
                "DELETE FROM _snapback_meta
                  WHERE key IN (?1, ?2)",
                params![
                    META_SETTLEMENT_FORMAT_EPOCH_V1,
                    META_SETTLEMENT_NEXT_SEQUENCE_V1
                ],
            )
            .expect("model pre-epoch store");
        save_meta_u64(&db.conn, META_CLIENT_MUTATION_COUNTERS_VERSION, 3)
            .expect("force formula migration");
        drop(db);

        let mut db = LocalDatabase::open(&path).expect("migrate legacy row and rebuild v5");
        let predecessor = db
            .settlement_read()
            .client_mutation_retention_info()
            .expect("predecessor global counters");
        let predecessor_auth =
            client_mutation_auth_retention_counters(&db.conn, &legacy.auth_fingerprint)
                .expect("predecessor authority counters");
        assert_eq!(predecessor.records, 1);

        let plain = ClientMutationIdentity::new("mixed-plain", "plain", &input);
        db.mutation_writes()
            .execute_mutation_idempotent(&plain_plan, &input, &plain)
            .expect("write plain row");
        let media = ClientMutationIdentity::new("mixed-media", "setProfileImage", &input);
        db.mutation_writes()
            .execute_mutation_idempotent(
                &insert_profile(json!("asset-mixed"), true),
                &input,
                &media,
            )
            .expect("write media row");
        assert_eq!(
            scan_client_mutation_retention_totals(&db.conn)
                .expect("scan mixed rows")
                .0,
            3
        );

        save_meta_u64(&db.conn, META_CLIENT_MUTATION_COUNTERS_VERSION, 3)
            .expect("force mixed-row rebuild");
        drop(db);
        let mut db = LocalDatabase::open(&path).expect("reopen and rebuild mixed rows");
        assert_eq!(
            db.settlement_read()
                .client_mutation_retention_info()
                .expect("rebuilt mixed global counters")
                .bytes,
            scan_client_mutation_retention_totals(&db.conn)
                .expect("logical mixed total")
                .1
        );

        assert_eq!(
            db.settlement()
                .acknowledge_client_mutations(
                    &legacy.auth_fingerprint,
                    &[plain.id.clone(), media.id.clone()],
                )
                .expect("ack plain and media rows"),
            2
        );
        let after_ack = db
            .settlement_read()
            .client_mutation_retention_info()
            .expect("global counters after ack");
        assert_eq!(after_ack.records, predecessor.records);
        assert_eq!(after_ack.bytes, predecessor.bytes);
        assert_eq!(
            client_mutation_auth_retention_counters(&db.conn, &legacy.auth_fingerprint)
                .expect("authority counters after ack"),
            predecessor_auth
        );

        save_meta_u64(&db.conn, META_CLIENT_MUTATION_COUNTERS_VERSION, 3)
            .expect("force predecessor rebuild");
        drop(db);
        let db = LocalDatabase::open(&path).expect("reopen exact predecessor");
        let after_reopen = db
            .settlement_read()
            .client_mutation_retention_info()
            .expect("global predecessor after reopen");
        assert_eq!(after_reopen.records, predecessor.records);
        assert_eq!(after_reopen.bytes, predecessor.bytes);
        assert_eq!(
            client_mutation_auth_retention_counters(&db.conn, &legacy.auth_fingerprint)
                .expect("authority predecessor after reopen"),
            predecessor_auth
        );
    }
}
