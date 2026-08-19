//! Executes the relational callable-query conformance corpus (LLP 0080
//! §Acceptance, the callable half) against every local evaluator lane.
//!
//! The committed JSON cases under `tests/conformance/relational/` are data —
//! a schema, seed rows, and closed `RelationalQueryPlan`s with pinned
//! `RelationalResultEncodingV1` bytes — so any future evaluator arm (pure
//! JS, hosted, Postgres) can consume the same corpus before it is claimed.
//! Today the claimed arms are the local lanes: the storage executor, the
//! serialized write lane, and the lock-free read lane; hosted targets
//! report the `relational_query_v1` capability gap instead of executing.
//!
//! Regenerate pinned bytes after a deliberate semantic change with:
//!   SNAPBACK_UPDATE_RELATIONAL_CORPUS=1 cargo test --test relational_corpus_v0
//!
//! @ref LLP 0080#2-portable-evaluation-semantics — one canonical corpus,
//!   byte-identical results across evaluators, result bytes pinned as
//!   RelationalResultEncodingV1.

use serde_json::{Map, Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime, HandlerInput,
    HandlerPlan, RelationalQueryPlan, SchemaManifest, SeedData,
};
use snapback::rqs::relational_result_encoding_v1;
use snapback_kernel::storage::LocalDatabase;
use std::collections::BTreeMap;
use std::path::PathBuf;

const CORPUS_FILE: &str = "tests/conformance/relational/corpus.v1.json";

fn corpus_path() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../..")).join(CORPUS_FILE)
}

fn load_corpus() -> Value {
    let bytes = std::fs::read_to_string(corpus_path()).expect("read relational corpus");
    serde_json::from_str(&bytes).expect("parse relational corpus")
}

fn corpus_schema(corpus: &Value) -> SchemaManifest {
    serde_json::from_value(corpus["schema"].clone()).expect("corpus schema deserializes")
}

fn corpus_tables(corpus: &Value, case: &Value) -> BTreeMap<String, Vec<Map<String, Value>>> {
    let mut tables: BTreeMap<String, Vec<Map<String, Value>>> =
        serde_json::from_value(corpus["tables"].clone()).expect("corpus tables");
    if let Some(overrides) = case.get("tables").and_then(Value::as_object) {
        for (table, rows) in overrides {
            tables.insert(
                table.clone(),
                serde_json::from_value(Value::Array(rows.as_array().cloned().unwrap_or_default()))
                    .expect("case table override"),
            );
        }
    }
    tables
}

fn case_input(case: &Value) -> HandlerInput {
    HandlerInput {
        auth: AuthInput {
            user_id: case["auth"].as_str().map(str::to_owned),
            ..AuthInput::default()
        },
        ..HandlerInput::default()
    }
}

fn field_order(plan: &RelationalQueryPlan) -> Vec<String> {
    plan.projection
        .iter()
        .map(|leaf| leaf.name.clone())
        .collect()
}

fn relational_live_function(name: &str, plan: RelationalQueryPlan) -> FunctionDefinition {
    let mut function = FunctionDefinition::new(
        name,
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)),
    );
    // @ref LLP 0080#2-portable-evaluation-semantics — corpus fixtures cross
    // the same explicit target-capability gate as generated applications.
    function.required_capabilities = vec![
        "relational_query_v1".to_owned(),
        "live_subscriptions".to_owned(),
    ];
    function
}

fn storage_lane(
    schema: &SchemaManifest,
    tables: &BTreeMap<String, Vec<Map<String, Value>>>,
    plan: &RelationalQueryPlan,
    input: &HandlerInput,
) -> Result<Vec<Value>, String> {
    let mut db = LocalDatabase::memory().expect("memory storage lane");
    db.schema_seed()
        .apply_schema(schema.clone())
        .expect("apply corpus schema");
    db.schema_seed()
        .seed(SeedData {
            tables: tables.clone(),
        })
        .expect("seed corpus rows");
    db.query_reads_read()
        .query_relational(plan, input, None)
        .map(|(output, _)| output.rows)
        .map_err(|error| error.diagnostic.code)
}

/// Every corpus case executes byte-identically through the storage
/// executor, the write lane, and the lock-free read lane, matching the
/// pinned RelationalResultEncodingV1 bytes; refusal cases answer with the
/// pinned code. `lanes: "storage"` restricts shape/injection cases that
/// activation would (correctly) refuse before dispatch.
#[test]
fn corpus_executes_byte_identically_across_local_lanes() {
    let update = std::env::var("SNAPBACK_UPDATE_RELATIONAL_CORPUS").is_ok();
    let mut corpus = load_corpus();
    let schema = corpus_schema(&corpus);

    let dir = std::env::temp_dir().join(format!("snapback-rel-corpus-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("corpus temp dir");
    let db_path = dir.join("corpus.sqlite");
    let _ = std::fs::remove_file(&db_path);
    let _ = std::fs::remove_file(dir.join("resume-keyring.json"));
    let mut snapback = LocalSnapback::open(&db_path).expect("file-backed dispatch fixture");
    snapback
        .apply_schema(schema.clone())
        .expect("apply corpus schema to dispatch lanes");
    let lane = snapback.read_lane();
    assert!(
        lane.available(),
        "file-backed fixture exposes the read lane"
    );
    let base_tables: BTreeMap<String, Vec<Map<String, Value>>> =
        serde_json::from_value(corpus["tables"].clone()).expect("corpus tables");
    snapback
        .seed(SeedData {
            tables: base_tables,
        })
        .expect("seed dispatch lanes once");

    let mut updated_bytes: Vec<(usize, String)> = Vec::new();
    let cases = corpus["cases"].as_array().expect("corpus cases").clone();
    for (index, case) in cases.iter().enumerate() {
        let name = case["name"].as_str().expect("case name");
        let plan: RelationalQueryPlan =
            serde_json::from_value(case["plan"].clone()).expect("case plan deserializes");
        let tables = corpus_tables(&corpus, case);
        let input = case_input(case);
        let storage = storage_lane(&schema, &tables, &plan, &input);

        if let Some(code) = case["expect"]["code"].as_str() {
            assert_eq!(
                storage.as_ref().err().map(String::as_str),
                Some(code),
                "{name}: storage lane must refuse with the pinned code",
            );
            continue;
        }
        let rows = storage.unwrap_or_else(|code| panic!("{name}: storage lane refused: {code}"));
        let order = field_order(&plan);
        let storage_bytes =
            relational_result_encoding_v1(&order, &rows).expect("storage rows encode");

        let storage_only = case["lanes"].as_str() == Some("storage");
        if !storage_only {
            let diagnostics = snapback.load_functions(FunctionManifest {
                functions: vec![relational_live_function("corpusCase", plan.clone())],
                ..FunctionManifest::default()
            });
            assert!(
                diagnostics
                    .iter()
                    .all(|d| d.severity != snapback::diagnostic::DiagnosticSeverity::Error),
                "{name}: corpus case must activate: {diagnostics:?}"
            );
            let write = snapback
                .invoke_query("corpusCase", case_input(case))
                .unwrap_or_else(|error| panic!("{name}: write lane failed: {error:?}"));
            let read = lane
                .invoke_query("corpusCase", case_input(case))
                .unwrap_or_else(|error| panic!("{name}: read lane failed: {error:?}"));
            let write_bytes =
                relational_result_encoding_v1(&order, &write.rows).expect("write rows encode");
            let read_bytes =
                relational_result_encoding_v1(&order, &read.rows).expect("read rows encode");
            assert_eq!(
                storage_bytes, write_bytes,
                "{name}: storage and write lanes must agree byte-for-byte",
            );
            assert_eq!(
                write_bytes, read_bytes,
                "{name}: write and read lanes must agree byte-for-byte",
            );
        }

        let expected = case["expect"]["bytes"].as_str().unwrap_or_default();
        if update {
            updated_bytes.push((index, storage_bytes));
        } else {
            assert_eq!(
                storage_bytes, expected,
                "{name}: bytes drifted from the committed corpus; if the \
                 semantic change is deliberate, regenerate with \
                 SNAPBACK_UPDATE_RELATIONAL_CORPUS=1",
            );
        }
    }

    if update {
        for (index, bytes) in updated_bytes {
            corpus["cases"][index]["expect"]["bytes"] = Value::String(bytes);
        }
        let rendered = format!(
            "{}\n",
            serde_json::to_string_pretty(&corpus).expect("corpus renders")
        );
        std::fs::write(corpus_path(), rendered).expect("write updated corpus");
    }

    // The anonymous/authenticated pair pins that public-read grants no
    // authority effect on result bytes: same plan, same bytes.
    let by_name = |wanted: &str| {
        cases
            .iter()
            .find(|case| case["name"] == wanted)
            .unwrap_or_else(|| panic!("corpus case {wanted} missing"))["expect"]["bytes"]
            .clone()
    };
    if !update {
        assert_eq!(
            by_name("public-inner-integer-key"),
            by_name("public-read-anonymous-matches-authenticated"),
            "anonymous and authenticated public-read results are byte-identical",
        );
    }
}

/// The paired-database fixture (LLP 0080 §Acceptance): two databases
/// differing only by one unauthorized joined row answer byte-identically —
/// results, continuation posture, and cursor refusals — so missing and
/// invisible stay indistinguishable across ordinary surfaces.
#[test]
fn paired_databases_keep_missing_and_invisible_indistinguishable() {
    let corpus = load_corpus();
    let schema = corpus_schema(&corpus);
    let plan_value = json!({
        "root": "books", "rootAlias": "book",
        "joined": "authors", "joinedAlias": "author",
        "joinKind": "Inner",
        "joinOn": [{ "rootField": "authorSlug", "joinedField": "slug" }],
        "rootFilters": [],
        "rootVisibility": [{ "field": "ownerId", "op": "Eq", "value": "AuthUserId" }],
        "joinedVisibility": [{ "field": "ownerId", "op": "Eq", "value": "AuthUserId" }],
        "projection": [
            { "name": "title", "source": { "RootField": "title" } },
            { "name": "authorName", "source": { "JoinedField": "name" } },
        ],
        "order": [{ "field": "title", "direction": "Asc" }],
        "take": 1,
        "rootIndex": "by_owner_title",
        "joinedIndex": "by_slug",
    });
    let plan: RelationalQueryPlan = serde_json::from_value(plan_value).expect("paired plan");
    let books = json!([
        { "_id": "b1", "title": "alpha", "authorSlug": "ada", "rank": 1, "flag": true, "ownerId": "user-a" },
        { "_id": "b2", "title": "beta", "authorSlug": "grace", "rank": 2, "flag": false, "ownerId": "user-a" },
    ]);
    // Database A: the joined row for beta exists but belongs to another
    // user (invisible). Database B: the row does not exist at all.
    let authors_invisible = json!([
        { "_id": "a1", "slug": "ada", "name": "Ada", "rating": 1, "active": true, "ownerId": "user-a" },
        { "_id": "a2", "slug": "grace", "name": "Grace", "rating": 2, "active": false, "ownerId": "user-b" },
    ]);
    let authors_missing = json!([
        { "_id": "a1", "slug": "ada", "name": "Ada", "rating": 1, "active": true, "ownerId": "user-a" },
    ]);

    let build = |authors: &Value| {
        let mut snapback = LocalSnapback::memory().expect("paired fixture");
        snapback.apply_schema(schema.clone()).expect("apply schema");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![relational_live_function("pairedBooks", plan.clone())],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics
                .iter()
                .all(|d| d.severity != snapback::diagnostic::DiagnosticSeverity::Error),
            "paired fixture must activate: {diagnostics:?}"
        );
        let tables: BTreeMap<String, Vec<Map<String, Value>>> = serde_json::from_value(json!({
            "books": books,
            "authors": authors,
            "mirrors": [],
        }))
        .expect("paired tables");
        snapback
            .seed(SeedData { tables })
            .expect("seed paired rows");
        snapback
    };
    let input = |args: Value| HandlerInput {
        args,
        auth: AuthInput {
            user_id: Some("user-a".to_owned()),
            ..AuthInput::default()
        },
        ..HandlerInput::default()
    };

    let invisible = build(&authors_invisible);
    let missing = build(&authors_missing);
    let order = field_order(&plan);

    // Page 1 (window [alpha]): identical bytes and identical continuation
    // posture on both databases.
    let page_invisible = invisible
        .invoke_query("pairedBooks", input(json!({})))
        .expect("invisible page");
    let page_missing = missing
        .invoke_query("pairedBooks", input(json!({})))
        .expect("missing page");
    assert_eq!(
        relational_result_encoding_v1(&order, &page_invisible.rows).expect("invisible encodes"),
        relational_result_encoding_v1(&order, &page_missing.rows).expect("missing encodes"),
    );
    assert_eq!(
        page_invisible.cursor.is_some(),
        page_missing.cursor.is_some(),
        "continuation posture must not leak the difference",
    );

    // Page 2 (window [beta], all-omitted on both): same bytes, same
    // terminality.
    let next_invisible = invisible
        .invoke_query(
            "pairedBooks",
            input(json!({ "cursor": page_invisible.cursor.expect("invisible continuation") })),
        )
        .expect("invisible page 2");
    let next_missing = missing
        .invoke_query(
            "pairedBooks",
            input(json!({ "cursor": page_missing.cursor.expect("missing continuation") })),
        )
        .expect("missing page 2");
    assert_eq!(
        relational_result_encoding_v1(&order, &next_invisible.rows).expect("invisible 2 encodes"),
        relational_result_encoding_v1(&order, &next_missing.rows).expect("missing 2 encodes"),
    );
    assert_eq!(
        next_invisible.cursor.is_some(),
        next_missing.cursor.is_some()
    );

    // Cursor refusals are byte-identical on both databases.
    let refusal = |snapback: &LocalSnapback| {
        snapback
            .invoke_query("pairedBooks", input(json!({ "cursor": "sbrc1.garbage" })))
            .map(|output| output.rows)
            .expect_err("garbage cursor refuses")
    };
    let left = refusal(&invisible);
    let right = refusal(&missing);
    assert_eq!(left.diagnostic.code, right.diagnostic.code);
    assert_eq!(left.diagnostic.message, right.diagnostic.message);
}

/// Large fixtures: a sparse, mostly-invisible root population still
/// answers the correct window (no other-owner row occupies a slot), and a
/// large duplicate-order-key population stays byte-stable across lanes via
/// the `_id` tie-break. The examined-entries instrumentation for the
/// index-served bound is a named residual in the corpus ticket — this test
/// asserts correctness, not scan counts.
#[test]
fn large_sparse_and_duplicate_key_fixtures_stay_correct_and_stable() {
    let corpus = load_corpus();
    let schema = corpus_schema(&corpus);
    let mut books: Vec<Map<String, Value>> = Vec::new();
    for index in 0..3_000 {
        let owner = if index % 300 == 0 { "user-a" } else { "user-x" };
        books.push(
            json!({
                "_id": format!("bk{index:05}"),
                "title": format!("t{index:05}"),
                "authorSlug": "ada",
                // One shared rank value: a large duplicate-order-key band.
                "rank": 7,
                "flag": true,
                "ownerId": owner,
            })
            .as_object()
            .cloned()
            .expect("bulk row"),
        );
    }
    let tables: BTreeMap<String, Vec<Map<String, Value>>> = {
        let mut tables: BTreeMap<String, Vec<Map<String, Value>>> = BTreeMap::new();
        tables.insert("books".to_owned(), books);
        tables.insert(
            "authors".to_owned(),
            vec![
                json!({ "_id": "a1", "slug": "ada", "name": "Ada", "rating": 1, "active": true, "ownerId": "user-a" })
                    .as_object()
                    .cloned()
                    .expect("author row"),
            ],
        );
        tables.insert("mirrors".to_owned(), Vec::new());
        tables
    };

    let owner_plan: RelationalQueryPlan = serde_json::from_value(json!({
        "root": "books", "rootAlias": "book",
        "joined": "authors", "joinedAlias": "author",
        "joinKind": "Left",
        "joinOn": [{ "rootField": "authorSlug", "joinedField": "slug" }],
        "rootFilters": [],
        "rootVisibility": [{ "field": "ownerId", "op": "Eq", "value": "AuthUserId" }],
        "joinedVisibility": [],
        "projection": [{ "name": "title", "source": { "RootField": "title" } }],
        "order": [{ "field": "title", "direction": "Asc" }],
        "take": 5,
        "rootIndex": "by_owner_title",
        "joinedIndex": "by_slug",
    }))
    .expect("sparse plan");
    let duplicate_plan: RelationalQueryPlan = serde_json::from_value(json!({
        "root": "books", "rootAlias": "book",
        "joined": "authors", "joinedAlias": "author",
        "joinKind": "Left",
        "joinOn": [{ "rootField": "authorSlug", "joinedField": "slug" }],
        "rootFilters": [],
        "rootVisibility": [],
        "joinedVisibility": [],
        "projection": [{ "name": "title", "source": { "RootField": "title" } }],
        "order": [{ "field": "rank", "direction": "Asc" }],
        "take": 100,
        "rootIndex": "by_rank",
        "joinedIndex": "by_slug",
    }))
    .expect("duplicate plan");

    let input = HandlerInput {
        auth: AuthInput {
            user_id: Some("user-a".to_owned()),
            ..AuthInput::default()
        },
        ..HandlerInput::default()
    };
    let mut db = LocalDatabase::memory().expect("sparse fixture");
    db.schema_seed()
        .apply_schema(schema)
        .expect("apply sparse schema");
    db.schema_seed()
        .seed(SeedData {
            tables: tables.clone(),
        })
        .expect("seed sparse rows");

    // Sparse window: exactly the caller's first five roots, no other-owner
    // row in a slot even though 2,990 of 3,000 roots are invisible.
    let (window, continuation) = db
        .query_reads_read()
        .query_relational(&owner_plan, &input, None)
        .expect("sparse window");
    let titles: Vec<&str> = window
        .rows
        .iter()
        .map(|row| row["title"].as_str().expect("title"))
        .collect();
    assert_eq!(
        titles,
        vec!["t00000", "t00300", "t00600", "t00900", "t01200"]
    );
    assert!(continuation.is_some(), "full sparse window continues");

    // Duplicate order keys: two evaluations are byte-identical, and the
    // window advances purely on the `_id` tie-break.
    let (first, _) = db
        .query_reads_read()
        .query_relational(&duplicate_plan, &input, None)
        .expect("duplicate window");
    let (second, _) = db
        .query_reads_read()
        .query_relational(&duplicate_plan, &input, None)
        .expect("duplicate window again");
    let order = field_order(&duplicate_plan);
    assert_eq!(
        relational_result_encoding_v1(&order, &first.rows).expect("first encodes"),
        relational_result_encoding_v1(&order, &second.rows).expect("second encodes"),
    );
    assert_eq!(first.rows.len(), 100);
    assert_eq!(first.rows[0]["title"], json!("t00000"));
    assert_eq!(first.rows[99]["title"], json!("t00099"));
}

/// A declared-unique index refuses a duplicate at the storage boundary, so
/// the below-constraint duplicate injection in the corpus (a non-unique
/// physical index behind a claimed-unique plan) is the only way two rows
/// can share the joined key — exactly the invariant the executor treats as
/// corruption.
#[test]
fn declared_unique_index_refuses_duplicates_at_seed() {
    let corpus = load_corpus();
    let schema = corpus_schema(&corpus);
    let mut db = LocalDatabase::memory().expect("unique fixture");
    db.schema_seed()
        .apply_schema(schema)
        .expect("apply unique schema");
    let tables: BTreeMap<String, Vec<Map<String, Value>>> = serde_json::from_value(json!({
        "books": [],
        "authors": [
            { "_id": "a1", "slug": "ada", "name": "Ada", "rating": 1, "active": true, "ownerId": "user-a" },
            { "_id": "a9", "slug": "ada", "name": "Imposter", "rating": 9, "active": true, "ownerId": "user-a" },
        ],
        "mirrors": [],
    }))
    .expect("unique tables");
    let error = db
        .schema_seed()
        .seed(SeedData { tables })
        .expect_err("duplicate slug must refuse under the unique index");
    assert!(
        error.diagnostic.code.starts_with("SNAPBACK_"),
        "typed refusal: {error:?}"
    );
}
