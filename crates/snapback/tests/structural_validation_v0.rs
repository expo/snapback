//! ENG-24342 cross-target structural-write proof.
//!
//! @ref LLP 0007#validation-requirements — the portable storage claim is
//! executable only when local SQLite and the hosted target consume one corpus.

use serde::Deserialize;
use serde_json::{Map, Value, json};
use snapback::manifest::{
    AuthInput, BinaryOp, FieldManifest, FieldType, HandlerInput, IndexManifest, MutationPlan,
    MutationStep, ReturnValue, SchemaManifest, TableManifest, ValueExpr,
};
use snapback::storage::LocalDatabase;
use std::collections::BTreeMap;

const CORPUS_JSON: &str = include_str!("../../../tests/conformance/structural-validation.corpus.json");

#[derive(Debug, Deserialize)]
struct Corpus {
    version: u32,
    schema: CorpusSchema,
    #[serde(rename = "validRow")]
    valid_row: Map<String, Value>,
    #[serde(rename = "typeCases")]
    type_cases: Vec<TypeCase>,
    cases: Vec<Case>,
}

#[derive(Debug, Deserialize)]
struct CorpusSchema {
    table: String,
    fields: Vec<CorpusField>,
}

#[derive(Debug, Deserialize)]
struct CorpusField {
    name: String,
    #[serde(rename = "type")]
    field_type: String,
    optional: bool,
}

#[derive(Debug, Deserialize)]
struct Case {
    name: String,
    operation: String,
    #[serde(default)]
    values: Map<String, Value>,
    field: Option<String>,
    left: Option<Value>,
    right: Option<Value>,
    #[serde(rename = "expectedCode")]
    expected_code: String,
}

#[derive(Debug, Deserialize)]
struct TypeCase {
    name: String,
    #[serde(rename = "fieldType")]
    field_type: String,
    value: Value,
    #[serde(default, rename = "expectOk")]
    expect_ok: bool,
    #[serde(default, rename = "expectedCode")]
    expected_code: Option<String>,
}

fn corpus() -> Corpus {
    serde_json::from_str(CORPUS_JSON).expect("structural-validation corpus parses")
}

fn field_type(name: &str) -> FieldType {
    match name {
        "string" => FieldType::String,
        "boolean" => FieldType::Boolean,
        "integer" => FieldType::Integer,
        "real" => FieldType::Real,
        "json" => FieldType::Json,
        other => panic!("unsupported corpus field type {other}"),
    }
}

fn schema(corpus: &Corpus) -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("structural-validation-v1".to_owned()),
        tables: vec![TableManifest {
            name: corpus.schema.table.clone(),
            fields: corpus
                .schema
                .fields
                .iter()
                .map(|field| FieldManifest {
                    name: field.name.clone(),
                    field_type: field_type(&field.field_type),
                    optional: field.optional,
                })
                .collect(),
            indexes: vec![IndexManifest {
                name: "by_board".to_owned(),
                fields: vec!["boardId".to_owned()],
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
        }],
        ..SchemaManifest::default()
    }
}

fn edge_schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("structural-validation-edge-v1".to_owned()),
        tables: vec![TableManifest {
            name: "edgeRecords".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "payload".to_owned(),
                    field_type: FieldType::Json,
                    optional: false,
                },
                FieldManifest {
                    name: "__proto__".to_owned(),
                    field_type: FieldType::Json,
                    optional: true,
                },
            ],
            indexes: vec![],
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

fn input(args: Value) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput::default(),
        ..HandlerInput::default()
    }
}

fn literal_values(values: &Map<String, Value>) -> BTreeMap<String, ValueExpr> {
    values
        .iter()
        .map(|(field, value)| (field.clone(), ValueExpr::Literal(value.clone())))
        .collect()
}

fn derived_value() -> ValueExpr {
    ValueExpr::Binary {
        op: BinaryOp::Add,
        left: Box::new(ValueExpr::Arg("left".to_owned())),
        right: Box::new(ValueExpr::Arg("right".to_owned())),
    }
}

fn seed_existing(db: &mut LocalDatabase, corpus: &Corpus) {
    db.schema_seed()
        .seed(snapback::manifest::SeedData {
            tables: BTreeMap::from([(corpus.schema.table.clone(), vec![corpus.valid_row.clone()])]),
        })
        .expect("valid corpus row seeds");
    assert!(
        db.query_reads_read()
            .get(&corpus.schema.table, "structural-validation-existing")
            .expect("read explicit seed id")
            .is_some(),
        "a valid declarative seed _id remains the stored identity"
    );
}

#[test]
fn local_sqlite_consumes_the_shared_structural_validation_corpus() {
    let corpus = corpus();
    assert_eq!(
        corpus.version, 1,
        "runner and corpus version must move together"
    );

    let protected = ["_id", "_version", "_createdAt", "_updatedAt"];
    for operation in ["insert", "patch"] {
        for field in protected {
            assert!(
                corpus.cases.iter().any(|case| {
                    case.operation == operation
                        && case.values.contains_key(field)
                        && case.expected_code == "SNAPBACK_SYSTEM_FIELD_WRITE"
                }),
                "corpus is missing {operation} coverage for {field}"
            );
        }
    }
    assert!(corpus.cases.iter().any(|case| case.operation == "seed"));
    assert!(
        corpus
            .cases
            .iter()
            .any(|case| case.operation == "derivedInsert")
    );
    assert!(
        corpus
            .cases
            .iter()
            .any(|case| case.operation == "derivedPatch")
    );

    for case in &corpus.cases {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(schema(&corpus))
            .expect("apply corpus schema");
        if matches!(case.operation.as_str(), "patch" | "derivedPatch") {
            seed_existing(&mut db, &corpus);
        }
        let version_before = db
            .versions_read()
            .current_version()
            .expect("version before case");

        let outcome = match case.operation.as_str() {
            "seed" => db
                .schema_seed()
                .seed(snapback::manifest::SeedData {
                    tables: BTreeMap::from([(
                        corpus.schema.table.clone(),
                        vec![case.values.clone()],
                    )]),
                })
                .map(|_| ()),
            "insert" => db
                .mutation_writes()
                .execute_mutation(
                    &MutationPlan {
            owner_write_checks: Vec::new(),
                        steps: vec![MutationStep::Insert {
                            table: corpus.schema.table.clone(),
                            values: literal_values(&case.values),
                            bind_id_as: None,
                        }],
                        return_value: None,
                    },
                    &input(json!({})),
                )
                .map(|_| ()),
            "patch" => db
                .mutation_writes()
                .execute_mutation(
                    &MutationPlan {
            owner_write_checks: Vec::new(),
                        steps: vec![MutationStep::Patch {
                            table: corpus.schema.table.clone(),
                            id: ValueExpr::Literal(Value::String(
                                "structural-validation-existing".to_owned(),
                            )),
                            values: literal_values(&case.values),
                        }],
                        return_value: None,
                    },
                    &input(json!({})),
                )
                .map(|_| ()),
            "derivedInsert" => {
                let field = case.field.clone().expect("derived insert field");
                let mut values = BTreeMap::from([
                    (
                        "boardId".to_owned(),
                        ValueExpr::Literal(Value::String("validation-board".to_owned())),
                    ),
                    (
                        "text".to_owned(),
                        ValueExpr::Literal(Value::String("valid derived row".to_owned())),
                    ),
                ]);
                values.insert(field, derived_value());
                db.mutation_writes()
                    .execute_mutation(
                        &MutationPlan {
            owner_write_checks: Vec::new(),
                            steps: vec![MutationStep::Insert {
                                table: corpus.schema.table.clone(),
                                values,
                                bind_id_as: None,
                            }],
                            return_value: None,
                        },
                        &input(json!({
                            "left": case.left.clone().expect("derived left"),
                            "right": case.right.clone().expect("derived right"),
                        })),
                    )
                    .map(|_| ())
            }
            "derivedPatch" => {
                let field = case.field.clone().expect("derived patch field");
                db.mutation_writes()
                    .execute_mutation(
                        &MutationPlan {
            owner_write_checks: Vec::new(),
                            steps: vec![MutationStep::Patch {
                                table: corpus.schema.table.clone(),
                                id: ValueExpr::Literal(Value::String(
                                    "structural-validation-existing".to_owned(),
                                )),
                                values: BTreeMap::from([(field, derived_value())]),
                            }],
                            return_value: None,
                        },
                        &input(json!({
                            "left": case.left.clone().expect("derived left"),
                            "right": case.right.clone().expect("derived right"),
                        })),
                    )
                    .map(|_| ())
            }
            other => panic!("unknown structural-validation operation {other}"),
        };

        let error = match outcome {
            Ok(()) => panic!("{} committed; expected {}", case.name, case.expected_code),
            Err(error) => error,
        };
        assert_eq!(
            error.diagnostic.code, case.expected_code,
            "{} returned the wrong structural diagnostic: {}",
            case.name, error.diagnostic.message
        );
        assert_eq!(
            db.versions_read()
                .current_version()
                .expect("version after rejected case"),
            version_before,
            "{} changed durable state despite rejection",
            case.name
        );
    }
}

#[test]
fn local_missing_rows_still_validate_the_shared_patch_corpus() {
    let corpus = corpus();
    for case in corpus
        .cases
        .iter()
        .filter(|case| matches!(case.operation.as_str(), "patch" | "derivedPatch"))
    {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(schema(&corpus))
            .expect("apply corpus schema");
        let version_before = db
            .versions_read()
            .current_version()
            .expect("version before case");
        let values = if case.operation == "patch" {
            literal_values(&case.values)
        } else {
            BTreeMap::from([(
                case.field.clone().expect("derived patch field"),
                derived_value(),
            )])
        };
        let outcome = db.mutation_writes().execute_mutation(
            &MutationPlan {
            owner_write_checks: Vec::new(),
                steps: vec![MutationStep::Patch {
                    table: corpus.schema.table.clone(),
                    id: ValueExpr::Literal(Value::String(
                        "structural-validation-missing".to_owned(),
                    )),
                    values,
                }],
                return_value: None,
            },
            &input(if case.operation == "derivedPatch" {
                json!({
                    "left": case.left.clone().expect("derived left"),
                    "right": case.right.clone().expect("derived right"),
                })
            } else {
                json!({})
            }),
        );

        let error = outcome.expect_err("invalid patch must fail before missing-row lookup");
        assert_eq!(
            error.diagnostic.code, case.expected_code,
            "{} returned the wrong diagnostic for a missing row",
            case.name
        );
        assert_eq!(
            db.versions_read()
                .current_version()
                .expect("version after rejected case"),
            version_before,
            "{} changed durable state for a missing row",
            case.name
        );
    }
}

#[test]
fn local_declared_field_types_consume_the_shared_boundary_corpus() {
    let corpus = corpus();
    for case in &corpus.type_cases {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(SchemaManifest {
                schema_hash: Some(format!("structural-type-{}", case.name)),
                tables: vec![TableManifest {
                    name: "typeRecords".to_owned(),
                    fields: vec![FieldManifest {
                        name: "value".to_owned(),
                        field_type: field_type(&case.field_type),
                        optional: false,
                    }],
                    indexes: vec![],
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
            .expect("apply type-case schema");
        let outcome = db.mutation_writes().execute_mutation(
            &MutationPlan {
            owner_write_checks: Vec::new(),
                steps: vec![MutationStep::Insert {
                    table: "typeRecords".to_owned(),
                    values: BTreeMap::from([(
                        "value".to_owned(),
                        ValueExpr::Literal(case.value.clone()),
                    )]),
                    bind_id_as: Some("insertedId".to_owned()),
                }],
                return_value: Some(ReturnValue::Expr(ValueExpr::Binding(
                    "insertedId".to_owned(),
                ))),
            },
            &input(json!({})),
        );

        if case.expect_ok {
            let output = outcome
                .unwrap_or_else(|error| panic!("{} rejected a valid value: {error:?}", case.name));
            let id = output
                .output
                .result
                .as_str()
                .expect("insert returns bound id");
            let stored = db
                .query_reads_read()
                .get("typeRecords", id)
                .expect("read type-case row")
                .expect("type-case row exists");
            assert_eq!(stored["value"], case.value, "{} changed value", case.name);
        } else {
            let error = outcome.expect_err("invalid type-case value must fail");
            assert_eq!(
                error.diagnostic.code,
                case.expected_code.as_deref().expect("rejected case code"),
                "{} returned the wrong code",
                case.name
            );
        }
    }
}

#[test]
fn local_required_json_and_prototype_named_fields_match_the_cloud_boundary() {
    let mut db = LocalDatabase::memory().expect("memory database");
    db.schema_seed()
        .apply_schema(edge_schema())
        .expect("apply edge schema");
    let valid = json!({
        "_id": "edge-existing",
        "payload": { "valid": true },
        "__proto__": { "polluted": true }
    });
    db.schema_seed()
        .seed(snapback::manifest::SeedData {
            tables: BTreeMap::from([(
                "edgeRecords".to_owned(),
                vec![valid.as_object().expect("valid edge row").clone()],
            )]),
        })
        .expect("prototype-named declared field seeds as ordinary data");
    let stored = db
        .query_reads_read()
        .get("edgeRecords", "edge-existing")
        .expect("read edge row")
        .expect("edge row exists");
    assert_eq!(stored["__proto__"], json!({ "polluted": true }));

    for id in ["edge-existing", "edge-missing"] {
        let before = db
            .versions_read()
            .current_version()
            .expect("version before invalid patch");
        let error = db
            .mutation_writes()
            .execute_mutation(
                &MutationPlan {
            owner_write_checks: Vec::new(),
                    steps: vec![MutationStep::Patch {
                        table: "edgeRecords".to_owned(),
                        id: ValueExpr::Literal(Value::String(id.to_owned())),
                        values: BTreeMap::from([(
                            "payload".to_owned(),
                            ValueExpr::Literal(Value::Null),
                        )]),
                    }],
                    return_value: None,
                },
                &input(json!({})),
            )
            .expect_err("required JSON null is invalid independent of row existence");
        assert_eq!(error.diagnostic.code, "SNAPBACK_FIELD_TYPE_MISMATCH");
        assert_eq!(db.versions_read().current_version().unwrap(), before);
    }

    let insert_error = db
        .mutation_writes()
        .execute_mutation(
            &MutationPlan {
            owner_write_checks: Vec::new(),
                steps: vec![MutationStep::Insert {
                    table: "edgeRecords".to_owned(),
                    values: BTreeMap::from([(
                        "payload".to_owned(),
                        ValueExpr::Literal(Value::Null),
                    )]),
                    bind_id_as: None,
                }],
                return_value: None,
            },
            &input(json!({})),
        )
        .expect_err("required JSON null insert must fail");
    assert_eq!(insert_error.diagnostic.code, "SNAPBACK_FIELD_TYPE_MISMATCH");

    let mut seed_db = LocalDatabase::memory().expect("seed memory database");
    seed_db
        .schema_seed()
        .apply_schema(edge_schema())
        .expect("apply seed edge schema");
    let invalid_seed = json!({ "_id": "edge-invalid", "payload": null });
    let seed_error = seed_db
        .schema_seed()
        .seed(snapback::manifest::SeedData {
            tables: BTreeMap::from([(
                "edgeRecords".to_owned(),
                vec![
                    invalid_seed
                        .as_object()
                        .expect("invalid edge seed object")
                        .clone(),
                ],
            )]),
        })
        .expect_err("required JSON null seed must fail");
    assert_eq!(seed_error.diagnostic.code, "SNAPBACK_FIELD_TYPE_MISMATCH");
}
