//! Executes the data-tier conformance corpus against the host IR evaluator.
//!
//! The committed JSON cases under `tests/conformance/data-tier/` are the
//! executable definition of the v1 mutation-IR profile (LLP 0051 D2/D5):
//! authored via the typed builder (see
//! `packages/snapback-codegen/data-tier-corpus.mjs`, regen-and-diff gated by
//! `data-tier-corpus.test.mjs`), executed here by the Rust host, and consumed
//! by reference from Exact CI (LLP 0329 E-A) and the future native-tier data
//! evaluator (E-C). Cases are data — plans plus rows — never code, so every
//! implementation in every language can run them; the corpus, not this
//! runner, is the definition of correct.
//!
//! Every case carries an exact ctx-answer replay ledger. Committing cases must
//! consume it exactly and echo it as their output ledger; the corpus contains
//! no nondeterministic placeholders.
//!
//! @ref LLP 0051#d5-conformance-the-corpus-becomes-the-data-tier-contract

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use snapback::data_tier::{
    DATA_TIER_CORPUS_FORMAT_VERSION, DATA_TIER_CORPUS_NAME, DataTierCompatibilityOutcome,
    DataTierCorpusCase, DataTierCorpusManifest, compatibility_outcome,
};
use snapback::manifest::{
    AuthInput, HandlerInput, MutationPlan, SchemaManifest, SeedData, TableManifest,
    TableVisibilityV1,
};
use snapback_kernel::storage::LocalDatabase;
use std::collections::BTreeMap;
use std::path::PathBuf;

fn corpus_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .join("tests")
        .join("conformance")
        .join("data-tier")
}

/// Objects subset-match for row projections (extra runtime-owned system fields
/// are fine); arrays are exact-length elementwise and scalars compare exactly.
fn value_matches(expected: &Value, actual: &Value) -> bool {
    match expected {
        Value::Object(fields) => {
            let Some(actual_fields) = actual.as_object() else {
                return false;
            };
            fields.iter().all(|(key, value)| {
                value_matches(value, actual_fields.get(key).unwrap_or(&Value::Null))
            })
        }
        Value::Array(items) => {
            let Some(actual_items) = actual.as_array() else {
                return false;
            };
            items.len() == actual_items.len()
                && items
                    .iter()
                    .zip(actual_items)
                    .all(|(expected, actual)| value_matches(expected, actual))
        }
        _ => expected == actual,
    }
}

fn assert_rows_match(case: &str, table: &str, expected: &[Map<String, Value>], actual: &[Value]) {
    assert_eq!(
        actual.len(),
        expected.len(),
        "{case}: table {table} has {} rows, expected {} — actual: {actual:?}",
        actual.len(),
        expected.len()
    );
    let mut unmatched: Vec<&Value> = actual.iter().collect();
    for expected_row in expected {
        let expected_value = Value::Object(expected_row.clone());
        let position = unmatched
            .iter()
            .position(|actual_row| value_matches(&expected_value, actual_row));
        match position {
            Some(index) => {
                unmatched.remove(index);
            }
            None => panic!(
                "{case}: table {table} has no row matching {expected_value} — remaining: {unmatched:?}"
            ),
        }
    }
}

fn scan_all_rows(db: &LocalDatabase, table: &str) -> Vec<Value> {
    use snapback::manifest::QueryPlan;
    let plan = QueryPlan {
        table_visibility: None,
        table: table.to_owned(),
        filters: Vec::new(),
        order: Vec::new(),
        limit: None,
        membership_filters: Vec::new(),
        indexed_by: None,
    };
    db.query_reads_read()
        .query(&plan, &HandlerInput::default())
        .expect("table scan")
        .rows
}

fn normalized_public_rows(rows: Vec<Value>) -> Vec<Value> {
    let mut rows = rows
        .into_iter()
        .map(|mut row| {
            if let Some(fields) = row.as_object_mut() {
                fields.retain(|key, _| !key.starts_with('_') || key == "_id");
            }
            row
        })
        .collect::<Vec<_>>();
    rows.sort_by_cached_key(|row| serde_json::to_string(row).expect("public row serializes"));
    rows
}

#[test]
fn data_tier_corpus_cases_pass_on_the_host_evaluator() {
    let dir = corpus_dir();
    let manifest_path = dir.join("corpus.manifest.json");
    let manifest: DataTierCorpusManifest = serde_json::from_str(
        &std::fs::read_to_string(&manifest_path).expect("read corpus manifest"),
    )
    .expect("parse corpus manifest through the public Rust shape");
    assert_eq!(manifest.corpus, DATA_TIER_CORPUS_NAME);
    assert_eq!(
        manifest.corpus_format_version,
        DATA_TIER_CORPUS_FORMAT_VERSION
    );
    assert_eq!(
        compatibility_outcome(
            manifest.profile_version,
            snapback::value_expr::DATA_TIER_PROFILE_VERSION,
            snapback::value_expr::DATA_TIER_PROFILE_VERSION,
            true,
        ),
        DataTierCompatibilityOutcome::Compatible
    );
    let mut paths: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|error| panic!("corpus dir {} missing: {error}", dir.display()))
        .map(|entry| entry.expect("dir entry").path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(".case.json"))
        })
        .collect();
    paths.sort();
    assert!(
        !paths.is_empty(),
        "no corpus cases found under {}",
        dir.display()
    );
    assert_eq!(
        paths.len(),
        manifest.cases.len(),
        "manifest/case count drift"
    );
    assert_eq!(paths.len(), 37, "the complete v1 D5 corpus has 37 cases");
    let mut receipt_cases = Vec::with_capacity(paths.len());

    for path in paths {
        let raw = std::fs::read_to_string(&path).expect("read case");
        let case: DataTierCorpusCase = serde_json::from_str(&raw)
            .unwrap_or_else(|error| panic!("{}: case does not parse: {error}", path.display()));
        assert_eq!(case.corpus, DATA_TIER_CORPUS_NAME, "{}", case.name);
        assert_eq!(
            compatibility_outcome(
                case.minimum_profile_version,
                snapback::value_expr::DATA_TIER_PROFILE_VERSION,
                snapback::value_expr::DATA_TIER_PROFILE_VERSION,
                true,
            ),
            DataTierCompatibilityOutcome::Compatible,
            "{}",
            case.name
        );
        let entry = manifest
            .cases
            .iter()
            .find(|entry| entry.name == case.name)
            .unwrap_or_else(|| panic!("{} missing from corpus manifest", case.name));
        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some(entry.path.as_str()),
            "{} path drift",
            case.name
        );
        let digest = format!("sha256:{:x}", Sha256::digest(raw.as_bytes()));
        assert_eq!(digest, entry.sha256, "{} content hash drift", case.name);
        assert!(
            !raw.contains("$ANY_"),
            "{}: nondeterministic placeholder remains",
            case.name
        );
        let expected_ledger = case
            .ctx_ledger
            .as_ref()
            .unwrap_or_else(|| panic!("{}: exact input ctx ledger missing", case.name));

        // The v1 data-tier corpus intentionally predates table-policy wire
        // vocabulary. Execute those frozen plan/row bytes under the explicit
        // non-owner policy that preserves their original semantics; omission
        // itself must remain a runtime refusal outside this compatibility
        // harness (LLP 0264 Phase 1a).
        let tables = case
            .schema
            .tables
            .iter()
            .cloned()
            .map(|mut table| {
                table
                    .visibility
                    .get_or_insert(TableVisibilityV1::PublicRead);
                table
            })
            .collect();
        let mut db = LocalDatabase::memory().expect("memory database");
        db.schema_seed()
            .apply_schema(SchemaManifest {
                schema_hash: Some(format!("data-tier-corpus-{}", case.name)),
                tables,
                ..SchemaManifest::default()
            })
            .expect("apply schema");
        if !case.seed.is_empty() {
            db.schema_seed()
                .seed(SeedData {
                    tables: case.seed.clone(),
                })
                .expect("seed");
        }

        let input = HandlerInput {
            args: case.args.clone(),
            auth: AuthInput {
                principal: None,
                session_id: None,
                user_id: case.auth_user_id.clone(),
                ..AuthInput::default()
            },
            ctx_ledger: case.ctx_ledger.clone(),
            ..HandlerInput::default()
        };

        let outcome = db.mutation_writes().execute_mutation(&case.plan, &input);

        let mut receipt_case = match (&case.expect.error, &outcome) {
            (Some(expected_error), Err(actual)) => {
                assert_eq!(
                    actual.diagnostic.code, expected_error.code,
                    "{}: error code mismatch ({})",
                    case.name, actual.diagnostic.message
                );
                serde_json::json!({
                    "name": case.name,
                    "status": "rejected",
                    "result": null,
                    "changedCount": null,
                    "inputCtxLedger": expected_ledger,
                    "outputCtxLedger": null,
                    "rejectionCode": actual.diagnostic.code,
                })
            }
            (Some(expected_error), Ok(commit)) => panic!(
                "{}: expected error {} but the mutation committed: {:?}",
                case.name, expected_error.code, commit.output
            ),
            (None, Err(error)) => panic!(
                "{}: unexpected failure {} — {}",
                case.name, error.diagnostic.code, error.diagnostic.message
            ),
            (None, Ok(commit)) => {
                let expected_count = case.expect.changed_count.unwrap_or_else(|| {
                    panic!("{}: committing case does not pin changedCount", case.name)
                });
                assert_eq!(
                    commit.output.changed_count, expected_count,
                    "{}: changed count",
                    case.name
                );
                let expected_result = case.expect.result.as_ref().unwrap_or_else(|| {
                    panic!(
                        "{}: committing case does not pin its whole-plan result",
                        case.name
                    )
                });
                assert_eq!(
                    &commit.output.result, expected_result,
                    "{}: whole-plan result",
                    case.name
                );
                assert_eq!(
                    commit.output.ctx_ledger.as_ref(),
                    Some(expected_ledger),
                    "{}: output ledger must echo the exact consumed recording",
                    case.name
                );
                serde_json::json!({
                    "name": case.name,
                    "status": "committed",
                    "result": commit.output.result,
                    "changedCount": commit.output.changed_count,
                    "inputCtxLedger": expected_ledger,
                    "outputCtxLedger": commit.output.ctx_ledger,
                    "rejectionCode": null,
                })
            }
        };

        if let Some(expected_tables) = &case.expect.rows {
            for (table, expected_rows) in expected_tables {
                let actual = scan_all_rows(&db, table);
                assert_rows_match(&case.name, table, expected_rows, &actual);
            }
        }
        if case.expect.error.is_some() {
            for table in &case.schema.tables {
                let actual = scan_all_rows(&db, &table.name);
                let seeded = case.seed.get(&table.name).map(Vec::as_slice).unwrap_or(&[]);
                assert_rows_match(&case.name, &table.name, seeded, &actual);
            }
        }

        let rows = case
            .schema
            .tables
            .iter()
            .map(|table| {
                (
                    table.name.clone(),
                    normalized_public_rows(scan_all_rows(&db, &table.name)),
                )
            })
            .collect::<BTreeMap<_, _>>();
        receipt_case
            .as_object_mut()
            .expect("receipt case is an object")
            .insert(
                "rows".to_owned(),
                serde_json::to_value(rows).expect("receipt rows serialize"),
            );
        receipt_cases.push(receipt_case);
    }

    if let Some(path) = std::env::var_os("SNAPBACK_D5_RUST_OUTCOMES_PATH") {
        let payload = serde_json::json!({
            "artifactKind": "snapback.d5-rust-outcomes.v1",
            "corpus": manifest.corpus,
            "corpusFormatVersion": manifest.corpus_format_version,
            "profileVersion": manifest.profile_version,
            "ledgerVersion": manifest.ledger_version,
            "cases": receipt_cases,
        });
        let mut rendered = serde_json::to_string_pretty(&payload).expect("receipt serializes");
        rendered.push('\n');
        std::fs::write(&path, rendered).unwrap_or_else(|error| {
            panic!("failed to write {}: {error}", PathBuf::from(path).display())
        });
    }
}

/// Read capture (LLP 0051 D2): plan `Get` reads land in `read_dependencies`
/// as Row/MissingRow entries — the receipt/overlay channel derived overlays
/// (0051 Increment 5 / Exact E-B) will consume. Asserted here rather than in
/// corpus JSON because the corpus deliberately describes only wire-visible
/// outcomes today.
#[test]
fn get_reads_are_captured_server_side() {
    use snapback::manifest::{MutationStep, ValueExpr};
    use snapback_kernel::storage::CapturedReadKind;

    let mut db = LocalDatabase::memory().expect("memory database");
    db.schema_seed()
        .apply_schema(SchemaManifest {
            schema_hash: Some("read-capture".to_owned()),
            tables: vec![
                serde_json::from_value::<TableManifest>(serde_json::json!({
                    "name": "rows",
                    "fields": [{ "name": "value", "field_type": "Json", "optional": true }],
                    "indexes": [],
                    "syncable": false
                }))
                .expect("table manifest"),
            ],
            ..SchemaManifest::default()
        })
        .expect("apply schema");

    let mut seed_row = Map::new();
    seed_row.insert("_id".to_owned(), Value::String("present".to_owned()));
    seed_row.insert("value".to_owned(), serde_json::json!(1));
    db.schema_seed()
        .seed(SeedData {
            tables: BTreeMap::from([("rows".to_owned(), vec![seed_row])]),
        })
        .expect("seed");

    let plan = MutationPlan {
        owner_write_checks: Vec::new(),
        steps: vec![
            MutationStep::Get {
                table: "rows".to_owned(),
                id: ValueExpr::Literal(Value::String("present".to_owned())),
                bind_as: "hit".to_owned(),
                else_error: None,
            },
            MutationStep::Get {
                table: "rows".to_owned(),
                id: ValueExpr::Literal(Value::String("absent".to_owned())),
                bind_as: "miss".to_owned(),
                else_error: None,
            },
        ],
        return_value: None,
    };
    let commit = db
        .mutation_writes()
        .execute_mutation(&plan, &HandlerInput::default())
        .expect("mutation commits");

    assert_eq!(commit.read_dependencies.len(), 2);
    assert_eq!(commit.read_dependencies[0].kind, CapturedReadKind::Row);
    assert_eq!(commit.read_dependencies[0].id.as_deref(), Some("present"));
    assert!(commit.read_dependencies[0].version.is_some());
    assert_eq!(
        commit.read_dependencies[1].kind,
        CapturedReadKind::MissingRow
    );
    assert_eq!(commit.read_dependencies[1].id.as_deref(), Some("absent"));
}
