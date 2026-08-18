//! Executable acceptance for the local SQLite exact-vector profile.
//!
//! This module is test-only: it publishes no capability fact. The small suite
//! runs in ordinary CI; the exact D=1536 qualification is ignored unless an
//! evidence run invokes it explicitly and supplies a receipt path.

use super::diagnostics::code;
use super::profile::{VECTOR_DISTANCE_PROFILE_ID, VECTOR_ORDERING_PROFILE_ID};
use super::query::VectorWorkCountersV1;
use super::rebuild::{
    VECTOR_REBUILD_EXECUTOR, VECTOR_REBUILD_PLAN_SCHEMA_VERSION, VectorRebuildPlanBodyV1,
    VectorRebuildPlanV1, VectorRebuildReceiptV1, VectorRebuildStateV1, activate_rebuild,
    begin_rebuild, inspect_rebuild, resume_rebuild,
};
use super::sqlite::{
    canonical_posting, create_infra, maintain_vector_indexes_in_tx, manifest_digest,
    query_vector_on, stage_manifest_in_tx, verify_generation,
};
use super::storage::encode_vector_binary64_le;
use super::types::{
    VECTOR_CAPABILITY, VECTOR_MAX_SCALAR_PAIRS, VECTOR_RESULT_PROJECTION, VectorFieldClassV1,
    VectorIndexManifestV1, VectorMaintenanceLimitsV1, VectorMetricV1, VectorQueryPlanV1,
    VectorTieBreakV1, VectorVisibilityV1,
};
use crate::manifest::{
    AuthInput, FieldManifest, FieldType, HandlerInput, SchemaManifest, TableManifest,
};
use crate::migration::{
    MIGRATION_APPROVAL_SCHEMA_VERSION, MIGRATION_OPERATION_ID_PREFIX, MigrationApprovalV1,
    MigrationAudienceV1, MigrationCeilings,
};
use crate::storage::{ChangeOp, ChangedRow};
use rusqlite::{Connection, params};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::time::Instant;

const EMPTY_ROOT: &str =
    "sha256-xor-v1:0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleCorpus {
    schema_version: u32,
    profile: String,
    source: String,
    dimensions: u32,
    query_bits: Vec<String>,
    candidates: Vec<OracleCandidate>,
    expected_ranks: OracleRanks,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleCandidate {
    row_id: String,
    vector_bits: Vec<String>,
    distances: OracleDistances,
}

#[derive(Debug, Deserialize)]
struct OracleDistances {
    l2sq: String,
    dot: String,
}

#[derive(Debug, Deserialize)]
struct OracleRanks {
    l2sq: Vec<String>,
    dot: Vec<String>,
}

fn oracle() -> OracleCorpus {
    serde_json::from_str(include_str!(
        "../../../../tests/conformance/vector-search-v1.corpus.json"
    ))
    .expect("committed vector-search semantic oracle parses")
}

fn bits(value: &str) -> f64 {
    f64::from_bits(u64::from_str_radix(value, 16).expect("oracle contains binary64 hex"))
}

fn vector_index(
    dimensions: u32,
    metric: VectorMetricV1,
    visibility: VectorVisibilityV1,
    corpus: u32,
) -> VectorIndexManifestV1 {
    let classification = if matches!(visibility, VectorVisibilityV1::PublicRead) {
        VectorFieldClassV1::Public
    } else {
        VectorFieldClassV1::Private
    };
    let mut field_classifications = BTreeMap::from([
        ("embedding".to_owned(), classification),
        ("status".to_owned(), classification),
        ("title".to_owned(), classification),
    ]);
    if matches!(visibility, VectorVisibilityV1::Owner { .. }) {
        field_classifications.insert("owner".to_owned(), classification);
    }
    VectorIndexManifestV1 {
        format_version: 1,
        name: "by_embedding".to_owned(),
        semantic_version: format!("documents.by_embedding.d{dimensions}.v1"),
        vector_field: "embedding".to_owned(),
        dimensions,
        metric,
        distance_profile: VECTOR_DISTANCE_PROFILE_ID.to_owned(),
        ordering_profile: VECTOR_ORDERING_PROFILE_ID.to_owned(),
        field_classifications,
        equality_filters: vec!["status".to_owned()],
        stored_fields: vec!["title".to_owned()],
        visibility,
        tie_break: VectorTieBreakV1::IdAsc,
        max_indexed_vectors_per_partition: corpus,
        max_scalar_pairs: u64::from(dimensions) * u64::from(corpus),
        maintenance_limits: VectorMaintenanceLimitsV1::default(),
    }
}

fn manifest_with_index(index: VectorIndexManifestV1) -> SchemaManifest {
    SchemaManifest {
        tables: vec![TableManifest {
            name: "documents".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "embedding".to_owned(),
                    field_type: FieldType::Vector {
                        dimensions: index.dimensions,
                    },
                    optional: false,
                },
                FieldManifest {
                    name: "owner".to_owned(),
                    field_type: FieldType::Principal,
                    optional: false,
                },
                FieldManifest {
                    name: "status".to_owned(),
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
            search_indexes: Vec::new(),
            vector_indexes: vec![index],
            search_live_limits: None,
            syncable: false,
            permission_backing: false,
            permission_fields: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        }],
        ..SchemaManifest::default()
    }
}

fn create_database(index: VectorIndexManifestV1) -> (Connection, SchemaManifest) {
    let mut conn = Connection::open_in_memory().expect("acceptance SQLite opens");
    conn.execute_batch(
        "CREATE TABLE _snapback_version(id INTEGER PRIMARY KEY,version INTEGER NOT NULL);
         INSERT INTO _snapback_version(id,version) VALUES(1,0);
         CREATE TABLE documents(
           _id TEXT PRIMARY KEY,_version INTEGER NOT NULL,embedding BLOB NOT NULL,
           owner TEXT NOT NULL,status TEXT NOT NULL,title TEXT NOT NULL
         );",
    )
    .unwrap();
    create_infra(&conn).unwrap();
    let schema = manifest_with_index(index);
    let tx = conn.transaction().unwrap();
    stage_manifest_in_tx(&tx, &schema, 0).unwrap();
    let index = &schema.tables[0].vector_indexes[0];
    let receipt = VectorRebuildReceiptV1 {
        executor: VECTOR_REBUILD_EXECUTOR.to_owned(),
        operation_id: "operation-v1:acceptance-active".to_owned(),
        plan_digest: "acceptance-plan".to_owned(),
        approval_digest: "acceptance-approval".to_owned(),
        table: "documents".to_owned(),
        index: index.name.clone(),
        generation: 1,
        predecessor_generation: None,
        source_head: 0,
        root_digest: EMPTY_ROOT.to_owned(),
        live_rows: 0,
        frontier_rows: 0,
        activated: true,
        rollback_eligible: false,
    };
    tx.execute(
        "UPDATE _snapback_vector_generations
         SET status='active',receipt_json=?1 WHERE generation=1",
        params![serde_json::to_string(&receipt).unwrap()],
    )
    .unwrap();
    tx.commit().unwrap();
    (conn, schema)
}

fn document(id: &str, version: u64, owner: &str, vector: &[f64], title: &str) -> Value {
    json!({
        "_id": id,
        "_version": version,
        "embedding": vector,
        "owner": owner,
        "status": "ready",
        "title": title,
    })
}

fn upsert_rows(
    conn: &mut Connection,
    schema: &SchemaManifest,
    version: u64,
    rows: &[(String, String, Vec<f64>, String)],
) -> crate::diagnostic::SnapbackResult<()> {
    let tx = conn.transaction()?;
    let mut changes = Vec::with_capacity(rows.len());
    for (id, owner, vector, title) in rows {
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM documents WHERE _id=?1)",
            params![id],
            |row| row.get(0),
        )?;
        let blob =
            encode_vector_binary64_le(vector, schema.tables[0].vector_indexes[0].dimensions)?;
        if exists {
            tx.execute(
                "UPDATE documents SET _version=?2,embedding=?3,owner=?4,status='ready',title=?5
                 WHERE _id=?1",
                params![id, version as i64, blob, owner, title],
            )?;
        } else {
            tx.execute(
                "INSERT INTO documents(_id,_version,embedding,owner,status,title)
                 VALUES (?1,?2,?3,?4,'ready',?5)",
                params![id, version as i64, blob, owner, title],
            )?;
        }
        changes.push(ChangedRow {
            table: "documents".to_owned(),
            id: id.clone(),
            op: if exists {
                ChangeOp::Update
            } else {
                ChangeOp::Insert
            },
            row: Some(document(id, version, owner, vector, title)),
            changed_fields: Vec::new(),
        });
    }
    maintain_vector_indexes_in_tx(&tx, schema, &changes, version)?;
    tx.execute(
        "UPDATE _snapback_version SET version=?1 WHERE id=1",
        params![version as i64],
    )?;
    tx.commit()?;
    Ok(())
}

fn delete_row(
    conn: &mut Connection,
    schema: &SchemaManifest,
    version: u64,
    id: &str,
) -> crate::diagnostic::SnapbackResult<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM documents WHERE _id=?1", params![id])?;
    maintain_vector_indexes_in_tx(
        &tx,
        schema,
        &[ChangedRow {
            table: "documents".to_owned(),
            id: id.to_owned(),
            op: ChangeOp::Delete,
            row: None,
            changed_fields: Vec::new(),
        }],
        version,
    )?;
    tx.execute(
        "UPDATE _snapback_version SET version=?1 WHERE id=1",
        params![version as i64],
    )?;
    tx.commit()?;
    Ok(())
}

fn query_plan() -> VectorQueryPlanV1 {
    VectorQueryPlanV1 {
        table: "documents".to_owned(),
        index: "by_embedding".to_owned(),
        distance_profile: VECTOR_DISTANCE_PROFILE_ID.to_owned(),
        result_projection: VECTOR_RESULT_PROJECTION.to_owned(),
        required_capability: VECTOR_CAPABILITY.to_owned(),
    }
}

fn input(vector: &[f64], k: u32) -> HandlerInput {
    HandlerInput {
        args: json!({
            "vector": vector,
            "k": k,
            "filters": [{"field": "status", "op": "eq", "value": "ready"}],
        }),
        auth: AuthInput {
            user_id: Some("untrusted-carrier-subject".to_owned()),
            ..AuthInput::default()
        },
        ..HandlerInput::default()
    }
}

fn query_ids(
    conn: &Connection,
    schema: &SchemaManifest,
    vector: &[f64],
    k: u32,
    owner: Option<&str>,
) -> (Vec<String>, Vec<u64>, VectorWorkCountersV1, u64) {
    let result = query_vector_on(conn, schema, &query_plan(), &input(vector, k), owner).unwrap();
    let ids = result
        .output
        .rows
        .iter()
        .map(|row| row["rowId"].as_str().unwrap().to_owned())
        .collect();
    let distances = result
        .output
        .rows
        .iter()
        .map(|row| row["distance"].as_f64().unwrap().to_bits())
        .collect();
    (ids, distances, result.counters, result.output.version)
}

fn oracle_rows(corpus: &OracleCorpus, owner: &str) -> Vec<(String, String, Vec<f64>, String)> {
    corpus
        .candidates
        .iter()
        .map(|candidate| {
            (
                candidate.row_id.clone(),
                owner.to_owned(),
                candidate
                    .vector_bits
                    .iter()
                    .map(|value| bits(value))
                    .collect(),
                format!("Research {}", candidate.row_id),
            )
        })
        .collect()
}

#[test]
fn research_room_oracle_matches_public_and_owner_adapters_bit_for_bit() {
    let corpus = oracle();
    assert_eq!(corpus.schema_version, 1);
    assert_eq!(corpus.profile, VECTOR_DISTANCE_PROFILE_ID);
    assert!(corpus.source.contains("Diary 0031"));
    let query = corpus
        .query_bits
        .iter()
        .map(|value| bits(value))
        .collect::<Vec<_>>();

    for metric in [VectorMetricV1::L2sq, VectorMetricV1::Dot] {
        let expected_ranks = match metric {
            VectorMetricV1::L2sq => &corpus.expected_ranks.l2sq,
            VectorMetricV1::Dot => &corpus.expected_ranks.dot,
        };
        let expected_bits = expected_ranks
            .iter()
            .take(3)
            .map(|row_id| {
                let candidate = corpus
                    .candidates
                    .iter()
                    .find(|candidate| candidate.row_id == *row_id)
                    .unwrap();
                let value = match metric {
                    VectorMetricV1::L2sq => &candidate.distances.l2sq,
                    VectorMetricV1::Dot => &candidate.distances.dot,
                };
                u64::from_str_radix(value, 16).unwrap()
            })
            .collect::<Vec<_>>();
        let mut observed = Vec::new();
        for visibility in [
            VectorVisibilityV1::PublicRead,
            VectorVisibilityV1::Owner {
                field: "owner".to_owned(),
            },
        ] {
            let owner = matches!(visibility, VectorVisibilityV1::Owner { .. }).then_some("alice");
            let index = vector_index(corpus.dimensions, metric, visibility, 32);
            let (mut conn, schema) = create_database(index);
            upsert_rows(&mut conn, &schema, 1, &oracle_rows(&corpus, "alice")).unwrap();
            let transcript = query_ids(&conn, &schema, &query, 3, owner);
            assert_eq!(&transcript.0, &expected_ranks[..3]);
            assert_eq!(transcript.1, expected_bits);
            assert_eq!(
                transcript.2,
                VectorWorkCountersV1 {
                    postings_enumerated: 20,
                    filter_comparisons: 20,
                    candidates_scored: 20,
                    scalar_pairs: 640,
                    release_source_reads: 3,
                }
            );
            observed.push((transcript.0, transcript.1, transcript.2));
        }
        assert_eq!(
            observed[0], observed[1],
            "public and owner shapes share the oracle"
        );
    }
}

#[test]
fn another_owner_cannot_change_results_codes_counters_or_ordinary_inspection() {
    let corpus = oracle();
    let query = corpus
        .query_bits
        .iter()
        .map(|value| bits(value))
        .collect::<Vec<_>>();
    let index = vector_index(
        corpus.dimensions,
        VectorMetricV1::L2sq,
        VectorVisibilityV1::Owner {
            field: "owner".to_owned(),
        },
        32,
    );
    let (mut left, left_schema) = create_database(index.clone());
    let (mut right, right_schema) = create_database(index);
    let alice = oracle_rows(&corpus, "alice");
    upsert_rows(&mut left, &left_schema, 1, &alice).unwrap();
    let mut right_rows = alice;
    right_rows.extend((0..7).map(|row| {
        let mut vector = vec![0.0; corpus.dimensions as usize];
        vector[0] = 1.0;
        (
            format!("bob-{row:02}"),
            "bob".to_owned(),
            vector,
            format!("Hidden Bob {row}"),
        )
    }));
    upsert_rows(&mut right, &right_schema, 1, &right_rows).unwrap();

    assert_eq!(
        query_ids(&left, &left_schema, &query, 3, Some("alice")),
        query_ids(&right, &right_schema, &query, 3, Some("alice"))
    );
    let left_refusal = query_vector_on(&left, &left_schema, &query_plan(), &input(&query, 3), None)
        .expect_err("owner query without server authority refuses")
        .error
        .diagnostic
        .code;
    let right_refusal = query_vector_on(
        &right,
        &right_schema,
        &query_plan(),
        &input(&query, 3),
        None,
    )
    .expect_err("owner query without server authority refuses")
    .error
    .diagnostic
    .code;
    assert_eq!(left_refusal, right_refusal);
    assert_eq!(left_refusal, code::QUERY_INVALID);

    let ordinary_inspection = |conn: &Connection, schema: &SchemaManifest| {
        json!({
            "schema": schema,
            "head": crate::storage::current_version_on(conn).unwrap(),
            "generationStatus": conn.query_row(
                "SELECT status FROM _snapback_vector_generations WHERE generation=1",
                [],
                |row| row.get::<_, String>(0),
            ).unwrap(),
            "targetFacts": super::types::VectorSearchFactsV1::local_v1(),
        })
    };
    assert_eq!(
        ordinary_inspection(&left, &left_schema),
        ordinary_inspection(&right, &right_schema)
    );
}

#[test]
fn commit_head_lifecycle_and_injected_failure_are_atomic() {
    let index = vector_index(
        2,
        VectorMetricV1::L2sq,
        VectorVisibilityV1::Owner {
            field: "owner".to_owned(),
        },
        4,
    );
    let (mut conn, schema) = create_database(index);
    upsert_rows(
        &mut conn,
        &schema,
        1,
        &[
            (
                "a".to_owned(),
                "alice".to_owned(),
                vec![1.0, 0.0],
                "A1".to_owned(),
            ),
            (
                "b".to_owned(),
                "bob".to_owned(),
                vec![2.0, 0.0],
                "B1".to_owned(),
            ),
        ],
    )
    .unwrap();
    assert_eq!(
        query_ids(&conn, &schema, &[0.0, 0.0], 4, Some("alice")).0,
        ["a"]
    );

    upsert_rows(
        &mut conn,
        &schema,
        2,
        &[(
            "a".to_owned(),
            "alice".to_owned(),
            vec![3.0, 0.0],
            "A2".to_owned(),
        )],
    )
    .unwrap();
    let updated = query_vector_on(
        &conn,
        &schema,
        &query_plan(),
        &input(&[0.0, 0.0], 4),
        Some("alice"),
    )
    .unwrap();
    assert_eq!(updated.output.version, 2);
    assert_eq!(updated.output.rows[0]["fields"]["title"], "A2");

    upsert_rows(
        &mut conn,
        &schema,
        3,
        &[(
            "a".to_owned(),
            "bob".to_owned(),
            vec![3.0, 0.0],
            "A3".to_owned(),
        )],
    )
    .unwrap();
    assert!(
        query_ids(&conn, &schema, &[0.0, 0.0], 4, Some("alice"))
            .0
            .is_empty()
    );
    assert_eq!(
        query_ids(&conn, &schema, &[0.0, 0.0], 4, Some("bob")).0,
        ["b", "a"]
    );

    delete_row(&mut conn, &schema, 4, "a").unwrap();
    assert_eq!(
        query_ids(&conn, &schema, &[0.0, 0.0], 4, Some("bob")).0,
        ["b"]
    );

    conn.execute_batch(
        "CREATE TRIGGER acceptance_vector_failure
         BEFORE INSERT ON _snapback_vector_sources
         BEGIN SELECT RAISE(ABORT,'injected vector maintenance failure'); END;",
    )
    .unwrap();
    let tx = conn.transaction().unwrap();
    let vector = vec![4.0, 0.0];
    tx.execute(
        "INSERT INTO documents(_id,_version,embedding,owner,status,title)
         VALUES ('c',5,?1,'bob','ready','C1')",
        params![encode_vector_binary64_le(&vector, 2).unwrap()],
    )
    .unwrap();
    let error = maintain_vector_indexes_in_tx(
        &tx,
        &schema,
        &[ChangedRow {
            table: "documents".to_owned(),
            id: "c".to_owned(),
            op: ChangeOp::Insert,
            row: Some(document("c", 5, "bob", &vector, "C1")),
            changed_fields: Vec::new(),
        }],
        5,
    )
    .expect_err("injected derived write failure refuses the source transaction");
    assert_eq!(error.diagnostic.code, "SNAPBACK_SQLITE_ERROR");
    tx.rollback().unwrap();
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM documents WHERE _id='c'", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap(),
        0
    );
    assert_eq!(
        query_ids(&conn, &schema, &[0.0, 0.0], 4, Some("bob")).0,
        ["b"]
    );
}

#[test]
fn corpus_product_activation_transfer_and_classification_boundaries_are_closed() {
    let index = vector_index(
        2,
        VectorMetricV1::L2sq,
        VectorVisibilityV1::Owner {
            field: "owner".to_owned(),
        },
        2,
    );
    let (mut conn, schema) = create_database(index);
    upsert_rows(
        &mut conn,
        &schema,
        1,
        &[
            (
                "a".to_owned(),
                "alice".to_owned(),
                vec![0.0, 0.0],
                "A".to_owned(),
            ),
            (
                "b".to_owned(),
                "bob".to_owned(),
                vec![1.0, 0.0],
                "B".to_owned(),
            ),
            (
                "c".to_owned(),
                "bob".to_owned(),
                vec![2.0, 0.0],
                "C".to_owned(),
            ),
        ],
    )
    .unwrap();

    let tx = conn.transaction().unwrap();
    tx.execute(
        "UPDATE documents SET _version=2,owner='bob' WHERE _id='a'",
        [],
    )
    .unwrap();
    let transfer = ChangedRow {
        table: "documents".to_owned(),
        id: "a".to_owned(),
        op: ChangeOp::Update,
        row: Some(document("a", 2, "bob", &[0.0, 0.0], "A")),
        changed_fields: Vec::new(),
    };
    let error = maintain_vector_indexes_in_tx(&tx, &schema, &[transfer], 2)
        .expect_err("full destination refuses ownership transfer");
    assert_eq!(error.diagnostic.code, code::CORPUS_BOUND);
    tx.rollback().unwrap();
    assert_eq!(
        conn.query_row("SELECT owner FROM documents WHERE _id='a'", [], |row| {
            row.get::<_, String>(0)
        })
        .unwrap(),
        "alice"
    );

    let tx = conn.transaction().unwrap();
    let vector = vec![3.0, 0.0];
    tx.execute(
        "INSERT INTO documents(_id,_version,embedding,owner,status,title)
         VALUES ('d',2,?1,'bob','ready','D')",
        params![encode_vector_binary64_le(&vector, 2).unwrap()],
    )
    .unwrap();
    let error = maintain_vector_indexes_in_tx(
        &tx,
        &schema,
        &[ChangedRow {
            table: "documents".to_owned(),
            id: "d".to_owned(),
            op: ChangeOp::Insert,
            row: Some(document("d", 2, "bob", &vector, "D")),
            changed_fields: Vec::new(),
        }],
        2,
    )
    .expect_err("overflowing insert refuses");
    assert_eq!(error.diagnostic.code, code::CORPUS_BOUND);
    tx.rollback().unwrap();

    let (table, valid) = {
        let schema = manifest_with_index(vector_index(
            32,
            VectorMetricV1::L2sq,
            VectorVisibilityV1::PublicRead,
            64,
        ));
        (
            schema.tables[0].clone(),
            schema.tables[0].vector_indexes[0].clone(),
        )
    };
    let mut product = valid.clone();
    product.dimensions = 4_096;
    product.max_indexed_vectors_per_partition = 65_536;
    product.max_scalar_pairs =
        u64::from(product.dimensions) * u64::from(product.max_indexed_vectors_per_partition);
    assert_eq!(
        crate::manifest::validate_vector_index_manifest(&table, &product)
            .expect_err("declaration over scalar-pair product refuses")
            .diagnostic
            .code,
        "SNAPBACK_VECTOR_INDEX_INVALID"
    );

    for role in ["embedding", "status", "title"] {
        let mut private_public = valid.clone();
        private_public
            .field_classifications
            .insert(role.to_owned(), VectorFieldClassV1::Private);
        assert_eq!(
            crate::manifest::validate_vector_index_manifest(&table, &private_public)
                .expect_err("private public-read participant refuses")
                .diagnostic
                .code,
            "SNAPBACK_VECTOR_INDEX_INVALID"
        );
    }
    for classification in [VectorFieldClassV1::Sensitive, VectorFieldClassV1::Forbidden] {
        for role in ["embedding", "status", "title"] {
            let mut invalid = valid.clone();
            invalid
                .field_classifications
                .insert(role.to_owned(), classification);
            assert_eq!(
                crate::manifest::validate_vector_index_manifest(&table, &invalid)
                    .expect_err("sensitive/forbidden participant refuses")
                    .diagnostic
                    .code,
                "SNAPBACK_VECTOR_INDEX_INVALID"
            );
        }
    }

    let owner_schema = manifest_with_index(vector_index(
        32,
        VectorMetricV1::L2sq,
        VectorVisibilityV1::Owner {
            field: "owner".to_owned(),
        },
        64,
    ));
    let owner_table = &owner_schema.tables[0];
    let owner_valid = &owner_table.vector_indexes[0];
    crate::manifest::validate_vector_index_manifest(owner_table, owner_valid)
        .expect("owner-private participants are admitted");
    for classification in [VectorFieldClassV1::Sensitive, VectorFieldClassV1::Forbidden] {
        for role in ["embedding", "status", "title", "owner"] {
            let mut invalid = owner_valid.clone();
            invalid
                .field_classifications
                .insert(role.to_owned(), classification);
            assert_eq!(
                crate::manifest::validate_vector_index_manifest(owner_table, &invalid)
                    .expect_err("owner index still refuses sensitive/forbidden fields")
                    .diagnostic
                    .code,
                "SNAPBACK_VECTOR_INDEX_INVALID"
            );
        }
    }

    // The activation preflight's generation verifier rejects an over-bound
    // legacy candidate even when its physical rows predate the declaration.
    let legacy_index = vector_index(2, VectorMetricV1::L2sq, VectorVisibilityV1::PublicRead, 1);
    let (legacy, legacy_schema) = create_database(legacy_index.clone());
    legacy
        .execute(
            "UPDATE _snapback_vector_generations SET status='building'",
            [],
        )
        .unwrap();
    for (id, value) in [("legacy-a", 0.0), ("legacy-b", 1.0)] {
        let vector = [value, 0.0];
        let posting =
            canonical_posting(&legacy_index, id, 1, &document(id, 1, "any", &vector, id)).unwrap();
        legacy
            .execute(
                "INSERT INTO _snapback_vector_sources
             (table_name,index_name,generation,row_id,source_version,partition_key,
              vector_blob,filters_json,fields_json,content_digest)
             VALUES ('documents','by_embedding',1,?1,1,?2,?3,?4,?5,?6)",
                params![
                    id,
                    posting.partition,
                    posting.vector_blob,
                    serde_json::to_string(&posting.filters).unwrap(),
                    serde_json::to_string(&posting.fields).unwrap(),
                    posting.content_digest,
                ],
            )
            .unwrap();
        legacy
            .execute(
                "INSERT INTO _snapback_vector_frontiers
             (table_name,index_name,generation,source_id,highest_version,tombstone,content_digest)
             VALUES ('documents','by_embedding',1,?1,1,0,?2)",
                params![id, posting.content_digest],
            )
            .unwrap();
    }
    let error = verify_generation(
        &legacy,
        "documents",
        &legacy_schema.tables[0].vector_indexes[0],
        1,
    )
    .expect_err("activation verification refuses over-bound legacy partition");
    assert_eq!(error.diagnostic.code, code::CORPUS_BOUND);
}

const SCALE_DIMENSIONS: u32 = 1_536;
const SCALE_VECTORS: u32 = 43_690;
const SCALE_VECTOR_BYTES: u64 = SCALE_VECTORS as u64 * SCALE_DIMENSIONS as u64 * 8;
const SCALE_SCALAR_PAIRS: u64 = SCALE_VECTORS as u64 * SCALE_DIMENSIONS as u64;
const SCALE_BUILD_BUDGET_MS: u64 = 30 * 60 * 1_000;
const SCALE_UPDATE_BUDGET_MS: u64 = 15 * 60 * 1_000;
const SCALE_QUERY_BUDGET_MS: u64 = 2 * 60 * 1_000;
const SCALE_PEAK_RSS_BUDGET_BYTES: u64 = 12 * 1_024 * 1_024 * 1_024;
const SCALE_DATABASE_BUDGET_BYTES: u64 = 4 * 1_024 * 1_024 * 1_024;

fn scale_index() -> VectorIndexManifestV1 {
    VectorIndexManifestV1 {
        format_version: 1,
        name: "by_embedding".to_owned(),
        semantic_version: "documents.by_embedding.d1536.v1".to_owned(),
        vector_field: "embedding".to_owned(),
        dimensions: SCALE_DIMENSIONS,
        metric: VectorMetricV1::L2sq,
        distance_profile: VECTOR_DISTANCE_PROFILE_ID.to_owned(),
        ordering_profile: VECTOR_ORDERING_PROFILE_ID.to_owned(),
        field_classifications: BTreeMap::from([(
            "embedding".to_owned(),
            VectorFieldClassV1::Public,
        )]),
        equality_filters: Vec::new(),
        stored_fields: Vec::new(),
        visibility: VectorVisibilityV1::PublicRead,
        tie_break: VectorTieBreakV1::IdAsc,
        max_indexed_vectors_per_partition: SCALE_VECTORS,
        max_scalar_pairs: SCALE_SCALAR_PAIRS,
        maintenance_limits: VectorMaintenanceLimitsV1::default(),
    }
}

fn scale_schema() -> SchemaManifest {
    SchemaManifest {
        tables: vec![TableManifest {
            name: "documents".to_owned(),
            fields: vec![FieldManifest {
                name: "embedding".to_owned(),
                field_type: FieldType::Vector {
                    dimensions: SCALE_DIMENSIONS,
                },
                optional: false,
            }],
            indexes: Vec::new(),
            search_indexes: Vec::new(),
            vector_indexes: vec![scale_index()],
            search_live_limits: None,
            syncable: false,
            permission_backing: false,
            permission_fields: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        }],
        ..SchemaManifest::default()
    }
}

fn scale_vector_blob(row: u32) -> Vec<u8> {
    let mut bytes = vec![0_u8; SCALE_DIMENSIONS as usize * 8];
    let offset = row as usize % SCALE_DIMENSIONS as usize * 8;
    bytes[offset..offset + 8].copy_from_slice(&1.0_f64.to_le_bytes());
    bytes
}

fn scale_vector_value(row: u32) -> Vec<f64> {
    let mut vector = vec![0.0; SCALE_DIMENSIONS as usize];
    vector[row as usize % SCALE_DIMENSIONS as usize] = 1.0;
    vector
}

fn peak_rss_bytes() -> u64 {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    // SAFETY: getrusage initializes the caller-owned rusage on success.
    let status = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) };
    assert_eq!(status, 0, "getrusage must succeed during qualification");
    // SAFETY: status zero means the structure was initialized.
    let usage = unsafe { usage.assume_init() };
    #[cfg(target_os = "macos")]
    return usage.ru_maxrss as u64;
    #[cfg(not(target_os = "macos"))]
    return (usage.ru_maxrss as u64).saturating_mul(1_024);
}

fn scale_audience() -> MigrationAudienceV1 {
    MigrationAudienceV1 {
        project_id: None,
        target_id: None,
        environment_id: None,
        deployment_id: None,
        release_id: None,
        database_id: "llp-0132-scale-qualification".to_owned(),
        stream_incarnation: "scale-stream-1".to_owned(),
        activation_generation: 1,
        target_profile_id: "local-dev-sqlite-ibex.v1".to_owned(),
    }
}

#[test]
#[ignore = "exact D=1536 × 43,690 qualification; run explicitly on Air with a receipt path"]
fn realistic_scale_d1536_filled_partition_emits_budget_receipt() {
    // The portable test binary used by the independent container lane invokes
    // only this ignored exact filter. Re-run every small semantic boundary in
    // this same process so one retained receipt covers the complete tranche.
    research_room_oracle_matches_public_and_owner_adapters_bit_for_bit();
    another_owner_cannot_change_results_codes_counters_or_ordinary_inspection();
    commit_head_lifecycle_and_injected_failure_are_atomic();
    corpus_product_activation_transfer_and_classification_boundaries_are_closed();

    assert_eq!(
        u64::from(SCALE_VECTORS),
        (VECTOR_MAX_SCALAR_PAIRS / u64::from(SCALE_DIMENSIONS)).min(65_536)
    );
    assert_eq!(SCALE_VECTOR_BYTES, 536_862_720);
    assert_eq!(SCALE_SCALAR_PAIRS, 67_107_840);

    let temp = tempfile::TempDir::new().unwrap();
    let path = temp.path().join("vector-scale.sqlite");
    let mut conn = Connection::open(&path).unwrap();
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA cache_size=-65536;
         CREATE TABLE _snapback_version(id INTEGER PRIMARY KEY,version INTEGER NOT NULL);
         INSERT INTO _snapback_version(id,version) VALUES(1,1);
         CREATE TABLE _snapback_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
         CREATE TABLE _snapback_changes(
           id INTEGER PRIMARY KEY AUTOINCREMENT,version INTEGER NOT NULL,
           table_name TEXT NOT NULL,row_id TEXT NOT NULL,op TEXT NOT NULL,
           row_json TEXT,changed_at_ms INTEGER NOT NULL
         );
         CREATE INDEX _snapback_changes_by_version ON _snapback_changes(version,id);
         CREATE INDEX _snapback_changes_by_table_version ON _snapback_changes(table_name,version);
         CREATE INDEX _snapback_changes_invalid_committed_version
           ON _snapback_changes(table_name)
           WHERE typeof(version) <> 'integer' OR version <= 0
             OR version > 9007199254740991;
         CREATE TABLE documents(
           _id TEXT PRIMARY KEY,_version INTEGER NOT NULL,embedding BLOB NOT NULL
         );",
    )
    .unwrap();
    create_infra(&conn).unwrap();
    let schema = scale_schema();
    crate::manifest::validate_vector_index_manifest(
        &schema.tables[0],
        &schema.tables[0].vector_indexes[0],
    )
    .unwrap();

    let tx = conn.transaction().unwrap();
    {
        let mut insert = tx
            .prepare("INSERT INTO documents(_id,_version,embedding) VALUES (?1,1,?2)")
            .unwrap();
        for row in 0..SCALE_VECTORS {
            insert
                .execute(params![format!("row-{row:05}"), scale_vector_blob(row)])
                .unwrap();
        }
    }
    stage_manifest_in_tx(&tx, &schema, 1).unwrap();
    tx.commit().unwrap();

    let index = &schema.tables[0].vector_indexes[0];
    let plan = VectorRebuildPlanV1::seal(VectorRebuildPlanBodyV1 {
        schema_version: VECTOR_REBUILD_PLAN_SCHEMA_VERSION.to_owned(),
        executor: VECTOR_REBUILD_EXECUTOR.to_owned(),
        table: "documents".to_owned(),
        index: index.name.clone(),
        semantic_version: index.semantic_version.clone(),
        manifest_digest: manifest_digest(index).unwrap(),
        predecessor_generation: None,
        audience: scale_audience(),
        ceilings: MigrationCeilings {
            max_affected_rows: u64::from(SCALE_VECTORS),
            max_bytes: SCALE_VECTOR_BYTES * 2,
            max_writes: 1_024,
            max_barrier_downtime_ms: SCALE_QUERY_BUDGET_MS,
        },
        // 341 × (1536 × 8 bytes) = 4,190,208, the largest complete
        // batch below the fixed 4 MiB mutation-global vector-byte ceiling.
        max_batch_rows: 341,
        journal_lease_ms: SCALE_BUILD_BUDGET_MS * 2,
    })
    .unwrap();
    let approval = MigrationApprovalV1 {
        schema_version: MIGRATION_APPROVAL_SCHEMA_VERSION.to_owned(),
        plan_digest: plan.plan_digest.clone(),
        observation_digest: "llp-0132-scale-observation-v1".to_owned(),
        policy_digest: "llp-0132-scale-policy-v1".to_owned(),
        audience: plan.body.audience.clone(),
        approver: "operator:llp-0132-qualification".to_owned(),
        generator_is_approver: false,
        issued_at_ms: 1,
        expires_at_ms: SCALE_BUILD_BUDGET_MS * 4,
        operation_id: format!("{MIGRATION_OPERATION_ID_PREFIX}llp-0132-scale-v1"),
    };

    let build_started = Instant::now();
    begin_rebuild(&mut conn, &schema, &plan, &approval, 1).unwrap();
    for step in 0..256_u64 {
        let progress = inspect_rebuild(&conn, &approval.operation_id).unwrap();
        if progress.state == VectorRebuildStateV1::Verified {
            break;
        }
        resume_rebuild(&mut conn, &schema, &approval.operation_id, step + 2).unwrap();
    }
    assert_eq!(
        inspect_rebuild(&conn, &approval.operation_id)
            .unwrap()
            .state,
        VectorRebuildStateV1::Verified
    );
    let rebuilt = activate_rebuild(&mut conn, &schema, &approval.operation_id).unwrap();
    let build_ms = build_started.elapsed().as_millis() as u64;
    assert_eq!(rebuilt.live_rows, u64::from(SCALE_VECTORS));
    assert!(build_ms <= SCALE_BUILD_BUDGET_MS, "build took {build_ms}ms");

    let updated_row = 0;
    let mut updated_vector = scale_vector_value(updated_row);
    updated_vector[1] = 1.0;
    let update_started = Instant::now();
    let tx = conn.transaction().unwrap();
    tx.execute(
        "UPDATE documents SET _version=2,embedding=?2 WHERE _id=?1",
        params![
            format!("row-{updated_row:05}"),
            encode_vector_binary64_le(&updated_vector, SCALE_DIMENSIONS).unwrap()
        ],
    )
    .unwrap();
    maintain_vector_indexes_in_tx(
        &tx,
        &schema,
        &[ChangedRow {
            table: "documents".to_owned(),
            id: format!("row-{updated_row:05}"),
            op: ChangeOp::Update,
            row: Some(json!({
                "_id": format!("row-{updated_row:05}"),
                "_version": 2,
                "embedding": updated_vector,
            })),
            changed_fields: Vec::new(),
        }],
        2,
    )
    .unwrap();
    tx.execute("UPDATE _snapback_version SET version=2 WHERE id=1", [])
        .unwrap();
    tx.commit().unwrap();
    let update_ms = update_started.elapsed().as_millis() as u64;
    assert!(
        update_ms <= SCALE_UPDATE_BUDGET_MS,
        "update took {update_ms}ms"
    );

    // Exercise the exact upper admission edge through synchronous active
    // maintenance: make one slot, then refill it before probing the refusal.
    let fill_row = SCALE_VECTORS - 1;
    let tx = conn.transaction().unwrap();
    tx.execute(
        "DELETE FROM documents WHERE _id=?1",
        params![format!("row-{fill_row:05}")],
    )
    .unwrap();
    maintain_vector_indexes_in_tx(
        &tx,
        &schema,
        &[ChangedRow {
            table: "documents".to_owned(),
            id: format!("row-{fill_row:05}"),
            op: ChangeOp::Delete,
            row: None,
            changed_fields: Vec::new(),
        }],
        3,
    )
    .unwrap();
    tx.execute("UPDATE _snapback_version SET version=3 WHERE id=1", [])
        .unwrap();
    tx.commit().unwrap();

    let fill_vector = scale_vector_value(fill_row);
    let fill_started = Instant::now();
    let tx = conn.transaction().unwrap();
    tx.execute(
        "INSERT INTO documents(_id,_version,embedding) VALUES (?1,4,?2)",
        params![format!("row-{fill_row:05}"), scale_vector_blob(fill_row)],
    )
    .unwrap();
    maintain_vector_indexes_in_tx(
        &tx,
        &schema,
        &[ChangedRow {
            table: "documents".to_owned(),
            id: format!("row-{fill_row:05}"),
            op: ChangeOp::Insert,
            row: Some(json!({
                "_id": format!("row-{fill_row:05}"),
                "_version": 4,
                "embedding": fill_vector,
            })),
            changed_fields: Vec::new(),
        }],
        4,
    )
    .unwrap();
    tx.execute("UPDATE _snapback_version SET version=4 WHERE id=1", [])
        .unwrap();
    tx.commit().unwrap();
    let bound_fill_insert_ms = fill_started.elapsed().as_millis() as u64;
    assert!(bound_fill_insert_ms <= SCALE_UPDATE_BUDGET_MS);

    let next_row = SCALE_VECTORS;
    let next_vector = scale_vector_value(next_row);
    let tx = conn.transaction().unwrap();
    tx.execute(
        "INSERT INTO documents(_id,_version,embedding) VALUES (?1,3,?2)",
        params![format!("row-{next_row:05}"), scale_vector_blob(next_row)],
    )
    .unwrap();
    let overflow = maintain_vector_indexes_in_tx(
        &tx,
        &schema,
        &[ChangedRow {
            table: "documents".to_owned(),
            id: format!("row-{next_row:05}"),
            op: ChangeOp::Insert,
            row: Some(json!({
                "_id": format!("row-{next_row:05}"),
                "_version": 5,
                "embedding": next_vector,
            })),
            changed_fields: Vec::new(),
        }],
        5,
    )
    .expect_err("the vector after the exact filled bound refuses");
    assert_eq!(overflow.diagnostic.code, code::CORPUS_BOUND);
    tx.rollback().unwrap();

    let query = vec![0.0; SCALE_DIMENSIONS as usize];
    let query_started = Instant::now();
    let result = query_vector_on(
        &conn,
        &schema,
        &query_plan(),
        &HandlerInput {
            args: json!({"vector": query, "k": 3}),
            ..HandlerInput::default()
        },
        None,
    )
    .unwrap();
    let query_ms = query_started.elapsed().as_millis() as u64;
    assert!(query_ms <= SCALE_QUERY_BUDGET_MS, "query took {query_ms}ms");
    assert_eq!(
        result
            .output
            .rows
            .iter()
            .map(|row| row["rowId"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["row-00001", "row-00002", "row-00003"]
    );
    assert_eq!(
        result.counters,
        VectorWorkCountersV1 {
            postings_enumerated: u64::from(SCALE_VECTORS),
            filter_comparisons: 0,
            candidates_scored: u64::from(SCALE_VECTORS),
            scalar_pairs: SCALE_SCALAR_PAIRS,
            release_source_reads: 3,
        }
    );

    let authoritative_count: u64 = conn
        .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
        .unwrap();
    let (posting_count, vector_bytes): (u64, u64) = conn
        .query_row(
            "SELECT COUNT(*),COALESCE(SUM(length(vector_blob)),0)
             FROM _snapback_vector_sources WHERE generation=?1",
            params![rebuilt.generation as i64],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(authoritative_count, u64::from(SCALE_VECTORS));
    assert_eq!(posting_count, u64::from(SCALE_VECTORS));
    assert_eq!(vector_bytes, SCALE_VECTOR_BYTES);

    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .unwrap();
    let database_bytes = std::fs::metadata(&path).unwrap().len();
    let peak_rss_bytes = peak_rss_bytes();
    assert!(
        database_bytes <= SCALE_DATABASE_BUDGET_BYTES,
        "database used {database_bytes} bytes"
    );
    assert!(
        peak_rss_bytes <= SCALE_PEAK_RSS_BUDGET_BYTES,
        "peak RSS was {peak_rss_bytes} bytes"
    );
    let active_receipt: VectorRebuildReceiptV1 = serde_json::from_str(
        &conn
            .query_row(
                "SELECT receipt_json FROM _snapback_vector_generations WHERE status='active'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
    )
    .unwrap();
    assert_eq!(active_receipt.live_rows, u64::from(SCALE_VECTORS));

    let receipt = json!({
        "schemaVersion": 1,
        "qualification": "llp-0132-sqlite-exact-scale-v1",
        "status": "pass",
        "codeRevision": std::env::var("SNAPBACK_VECTOR_QUALIFICATION_REVISION")
            .unwrap_or_else(|_| "unrecorded".to_owned()),
        "target": {
            "adapter": "local SQLite exact scan",
            "targetProfileId": "local-dev-sqlite-ibex.v1",
            "machine": std::env::var("SNAPBACK_VECTOR_QUALIFICATION_MACHINE")
                .unwrap_or_else(|_| "unrecorded".to_owned()),
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "distanceProfile": VECTOR_DISTANCE_PROFILE_ID,
            "accelerator": "none"
        },
        "harness": {
            "testName": "vector::acceptance::realistic_scale_d1536_filled_partition_emits_budget_receipt",
            "filterMode": "ignored exact",
            "repositoryFilesRequiredAtRuntime": false,
            "requiresWritableTemporaryDirectory": true,
        },
        "acceptanceChecks": [
            {
                "testName": "vector::acceptance::research_room_oracle_matches_public_and_owner_adapters_bit_for_bit",
                "pass": true,
            },
            {
                "testName": "vector::acceptance::another_owner_cannot_change_results_codes_counters_or_ordinary_inspection",
                "pass": true,
            },
            {
                "testName": "vector::acceptance::commit_head_lifecycle_and_injected_failure_are_atomic",
                "pass": true,
            },
            {
                "testName": "vector::acceptance::corpus_product_activation_transfer_and_classification_boundaries_are_closed",
                "pass": true,
            },
        ],
        "corpus": {
            "dimensions": SCALE_DIMENSIONS,
            "buildVectorCount": SCALE_VECTORS,
            "finalVectorCount": SCALE_VECTORS,
            "vectorBytes": SCALE_VECTOR_BYTES,
            "scalarPairs": SCALE_SCALAR_PAIRS,
            "generation": active_receipt.generation,
            "rootDigest": active_receipt.root_digest,
        },
        "budgets": {
            "buildMsMax": SCALE_BUILD_BUDGET_MS,
            "updateMsMax": SCALE_UPDATE_BUDGET_MS,
            "queryMsMax": SCALE_QUERY_BUDGET_MS,
            "peakRssBytesMax": SCALE_PEAK_RSS_BUDGET_BYTES,
            "databaseBytesMax": SCALE_DATABASE_BUDGET_BYTES,
        },
        "observed": {
            "buildMs": build_ms,
            "updateMs": update_ms,
            "boundFillInsertMs": bound_fill_insert_ms,
            "queryMs": query_ms,
            "peakRssBytes": peak_rss_bytes,
            "databaseBytes": database_bytes,
            "workCounters": result.counters,
        },
        "boundaries": {
            "boundFillingInsertAdmitted": true,
            "nextInsertRefused": code::CORPUS_BOUND,
            "sourceAndPostingCountsMatch": true,
        },
        "nonclaims": ["ann", "hosted-targets", "postgres", "live-vector-search"]
    });
    let rendered = format!("{}\n", serde_json::to_string_pretty(&receipt).unwrap());
    println!("{rendered}");
    if let Ok(output) = std::env::var("SNAPBACK_VECTOR_QUALIFICATION_RECEIPT_OUT") {
        std::fs::write(output, rendered).unwrap();
    }
}
