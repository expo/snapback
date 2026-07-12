//! ENG-24342 cross-target structural-write proof.
//!
//! @ref LLP 0007#validation-requirements — the portable storage claim is
//! executable only when local SQLite and the hosted target consume one corpus.

use serde::Deserialize;
use serde_json::{Map, Value, json};
use snapback::manifest::{
    AuthInput, BinaryOp, FieldManifest, FieldType, HandlerInput, IndexManifest, MutationPlan,
    MutationStep, SchemaManifest, TableManifest, ValueExpr,
};
use snapback::storage::LocalDatabase;
use std::collections::BTreeMap;

const CORPUS_JSON: &str = include_str!("conformance/structural-validation.corpus.json");

#[derive(Debug, Deserialize)]
struct Corpus {
    version: u32,
    schema: CorpusSchema,
    #[serde(rename = "validRow")]
    valid_row: Map<String, Value>,
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

fn corpus() -> Corpus {
    serde_json::from_str(CORPUS_JSON).expect("structural-validation corpus parses")
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
                    field_type: match field.field_type.as_str() {
                        "string" => FieldType::String,
                        "boolean" => FieldType::Boolean,
                        "integer" => FieldType::Integer,
                        "real" => FieldType::Real,
                        "json" => FieldType::Json,
                        other => panic!("unsupported corpus field type {other}"),
                    },
                    optional: field.optional,
                })
                .collect(),
            indexes: vec![IndexManifest {
                name: "by_board".to_owned(),
                fields: vec!["boardId".to_owned()],
            }],
            syncable: true,
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
    db.seed(snapback::manifest::SeedData {
        tables: BTreeMap::from([(corpus.schema.table.clone(), vec![corpus.valid_row.clone()])]),
    })
    .expect("valid corpus row seeds");
    assert!(
        db.get(&corpus.schema.table, "structural-validation-existing")
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
        db.apply_schema(schema(&corpus))
            .expect("apply corpus schema");
        if matches!(case.operation.as_str(), "patch" | "derivedPatch") {
            seed_existing(&mut db, &corpus);
        }
        let version_before = db.current_version().expect("version before case");

        let outcome = match case.operation.as_str() {
            "seed" => db
                .seed(snapback::manifest::SeedData {
                    tables: BTreeMap::from([(
                        corpus.schema.table.clone(),
                        vec![case.values.clone()],
                    )]),
                })
                .map(|_| ()),
            "insert" => db
                .execute_mutation(
                    &MutationPlan {
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
                .execute_mutation(
                    &MutationPlan {
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
                db.execute_mutation(
                    &MutationPlan {
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
                db.execute_mutation(
                    &MutationPlan {
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
            db.current_version().expect("version after rejected case"),
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
        db.apply_schema(schema(&corpus))
            .expect("apply corpus schema");
        let version_before = db.current_version().expect("version before case");
        let values = if case.operation == "patch" {
            literal_values(&case.values)
        } else {
            BTreeMap::from([(
                case.field.clone().expect("derived patch field"),
                derived_value(),
            )])
        };
        let outcome = db.execute_mutation(
            &MutationPlan {
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
            db.current_version().expect("version after rejected case"),
            version_before,
            "{} changed durable state for a missing row",
            case.name
        );
    }
}

#[test]
fn local_required_json_and_prototype_named_fields_match_the_cloud_boundary() {
    let mut db = LocalDatabase::memory().expect("memory database");
    db.apply_schema(edge_schema()).expect("apply edge schema");
    let valid = json!({
        "_id": "edge-existing",
        "payload": { "valid": true },
        "__proto__": { "polluted": true }
    });
    db.seed(snapback::manifest::SeedData {
        tables: BTreeMap::from([(
            "edgeRecords".to_owned(),
            vec![valid.as_object().expect("valid edge row").clone()],
        )]),
    })
    .expect("prototype-named declared field seeds as ordinary data");
    let stored = db
        .get("edgeRecords", "edge-existing")
        .expect("read edge row")
        .expect("edge row exists");
    assert_eq!(stored["__proto__"], json!({ "polluted": true }));

    for id in ["edge-existing", "edge-missing"] {
        let before = db.current_version().expect("version before invalid patch");
        let error = db
            .execute_mutation(
                &MutationPlan {
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
        assert_eq!(db.current_version().unwrap(), before);
    }

    let insert_error = db
        .execute_mutation(
            &MutationPlan {
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
        .apply_schema(edge_schema())
        .expect("apply seed edge schema");
    let invalid_seed = json!({ "_id": "edge-invalid", "payload": null });
    let seed_error = seed_db
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
