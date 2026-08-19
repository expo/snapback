//! ENG-23430 settlement gate: the vendored eval loop's no-progress fallback
//! returns the still-pending invocation promise with SUCCESS status, which
//! JSON-stringifies to "{}". Before the tagged completion envelope, Snapback
//! read that as a handler that legitimately returned `{}` — a mutation's
//! buffered pre-await writes committed and the client saw success. These
//! tests pin the fix: an unsettled handler is a failed invocation
//! (`SNAPBACK_HANDLER_DID_NOT_SETTLE`) that commits nothing, while legitimate
//! `{}` / `null` / `undefined` results still succeed.

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionResultContract, FunctionRuntime, HandlerInput, IbexModule, ResultObjectFieldContract,
    ResultValueContract, SchemaManifest, TableManifest,
};

/// One module holding every handler the settlement tests need. The warm pool
/// keys VMs by module source, so sharing one source means the tests also
/// exercise check-in/reset behavior after an unsettled invocation.
const SETTLEMENT_MODULE_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  // The exact ENG-23430 repro shape: a write buffered before an await that
  // can never be advanced (timers are denied; nothing external resolves it),
  // and a second write after it that must never happen.
  async insertThenHang(ctx, args) {
    await ctx.db.insert('items', { n: 1 });
    await new Promise(function (resolve) { if (args && args.resolve) resolve(); });
    await ctx.db.insert('items', { n: 2 });
    return {};
  },
  async hangForever(ctx) {
    await new Promise(function () {});
    return [];
  },
  async returnsEmptyObject(ctx) { return {}; },
  async returnsUndefined(ctx) {},
  async returnsNull(ctx) { return null; },
  async insertThenReturnFunction(ctx) {
    await ctx.db.insert('items', { n: 3 });
    return function () {};
  },
  async insertOne(ctx, args) {
    await ctx.db.insert('items', { n: args.n });
    return {};
  },
  async insertThenReturnWrongContract(ctx, args) {
    await ctx.db.insert('items', { n: args.n });
    return { accepted: "not-a-boolean" };
  },
  async listItems(ctx) {
    return await ctx.db.query('items').order('_createdAt', 'asc').collect();
  },
  async listItemsLive(ctx) {
    return await ctx.db.query('items').order('_createdAt', 'asc').collect();
  },
  async listItemsWrongContract(ctx) {
    return await ctx.db.query('items').order('_createdAt', 'asc').collect();
  },
  async echoAction(_ctx, args) {
    return { accepted: args.accepted };
  },
  async echoActionWrongContract() {
    return { accepted: "not-a-boolean" };
  },
  async insertText(ctx, args) {
    return await ctx.db.insert('texts', { body: args.body });
  },
  async readText(ctx, args) {
    const row = await ctx.db.get('texts', args.id);
    return row ? [{ body: row.body, observedLength: row.body.length }] : [];
  }
};
"#;

fn schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("settlement-v0".to_owned()),
        tables: vec![
            TableManifest {
                name: "items".to_owned(),
                fields: vec![FieldManifest {
                    name: "n".to_owned(),
                    field_type: FieldType::Integer,
                    optional: false,
                }],
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
                visibility: Some(snapback::manifest::TableVisibilityV1::PublicRead),
                history: None,
            },
            TableManifest {
                name: "texts".to_owned(),
                fields: vec![FieldManifest {
                    name: "body".to_owned(),
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
                visibility: Some(snapback::manifest::TableVisibilityV1::PublicRead),
                history: None,
            },
        ],
        ..SchemaManifest::default()
    }
}

fn functions() -> FunctionManifest {
    let define = |name: &str, kind: FunctionKind| {
        FunctionDefinition::new(
            name,
            kind,
            FunctionRuntime::IbexModule(IbexModule {
                source: SETTLEMENT_MODULE_SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        )
    };
    let mark_inline = |function: &mut FunctionDefinition| {
        function.handler_form = Some("inline".to_owned());
        function
            .required_capabilities
            .push("inline_handler_v1".to_owned());
    };
    let contract = FunctionResultContract::Value {
        value: ResultValueContract::Object {
            fields: vec![ResultObjectFieldContract {
                name: "accepted".to_owned(),
                required: true,
                value: ResultValueContract::Boolean,
            }],
            allow_extra: false,
        },
    };
    let install_contract = |function: &mut FunctionDefinition, contract: FunctionResultContract| {
        let value = serde_json::to_value(&contract).expect("serialize result contract");
        let canonical = snapback::rqs::jcs(&value).expect("canonical result contract");
        let mut hash = Sha256::new();
        hash.update(b"snapback:function-result:v1\n");
        hash.update(canonical.as_bytes());
        function.result_contract = contract;
        function.result_contract_hash = Some(format!("sha256:{:x}", hash.finalize()));
        function
            .required_capabilities
            .push("result_contract_v1".to_owned());
    };
    let mut invalid_mutation = define("insertThenReturnWrongContract", FunctionKind::Mutation);
    mark_inline(&mut invalid_mutation);
    install_contract(&mut invalid_mutation, contract.clone());

    let mut invalid_query = define("listItemsWrongContract", FunctionKind::Query);
    install_contract(
        &mut invalid_query,
        FunctionResultContract::Records {
            record: ResultValueContract::Object {
                fields: vec![ResultObjectFieldContract {
                    name: "missing".to_owned(),
                    required: true,
                    value: ResultValueContract::String { max_bytes: 8 },
                }],
                allow_extra: false,
            },
            rows: None,
        },
    );

    let document_row = ResultValueContract::Object {
        fields: vec![
            ResultObjectFieldContract {
                name: "_id".to_owned(),
                required: true,
                value: ResultValueContract::Id {
                    table: "items".to_owned(),
                },
            },
            ResultObjectFieldContract {
                name: "_version".to_owned(),
                required: true,
                value: ResultValueContract::Integer {
                    min: 0,
                    max: 9_007_199_254_740_991,
                },
            },
            ResultObjectFieldContract {
                name: "_createdAt".to_owned(),
                required: true,
                value: ResultValueContract::Integer {
                    min: 0,
                    max: 9_007_199_254_740_991,
                },
            },
            ResultObjectFieldContract {
                name: "_updatedAt".to_owned(),
                required: true,
                value: ResultValueContract::Integer {
                    min: 0,
                    max: 9_007_199_254_740_991,
                },
            },
            ResultObjectFieldContract {
                name: "n".to_owned(),
                required: true,
                value: ResultValueContract::Integer {
                    min: -9_007_199_254_740_991,
                    max: 9_007_199_254_740_991,
                },
            },
        ],
        allow_extra: false,
    };
    let mut inline_query = define("listItems", FunctionKind::Query);
    mark_inline(&mut inline_query);
    install_contract(
        &mut inline_query,
        FunctionResultContract::Documents {
            table: "items".to_owned(),
            document: document_row.clone(),
        },
    );
    let mut inline_live_query = define("listItemsLive", FunctionKind::LiveQuery);
    mark_inline(&mut inline_live_query);
    install_contract(
        &mut inline_live_query,
        FunctionResultContract::Documents {
            table: "items".to_owned(),
            document: document_row,
        },
    );
    let mut inline_mutation = define("insertOne", FunctionKind::Mutation);
    mark_inline(&mut inline_mutation);
    install_contract(
        &mut inline_mutation,
        FunctionResultContract::Value {
            value: ResultValueContract::Object {
                fields: Vec::new(),
                allow_extra: false,
            },
        },
    );
    let mut inline_action = define("echoAction", FunctionKind::Action);
    mark_inline(&mut inline_action);
    install_contract(&mut inline_action, contract.clone());
    let mut invalid_action = define("echoActionWrongContract", FunctionKind::Action);
    mark_inline(&mut invalid_action);
    install_contract(&mut invalid_action, contract);

    FunctionManifest {
        acknowledged_experimental_capabilities: vec![
            "inline_handler_v1".to_owned(),
            "result_contract_v1".to_owned(),
        ],
        functions: vec![
            define("insertThenHang", FunctionKind::Mutation),
            define("hangForever", FunctionKind::Query),
            define("returnsEmptyObject", FunctionKind::Mutation),
            define("returnsUndefined", FunctionKind::Mutation),
            define("returnsNull", FunctionKind::Mutation),
            define("insertThenReturnFunction", FunctionKind::Mutation),
            inline_mutation,
            invalid_mutation,
            inline_query,
            inline_live_query,
            invalid_query,
            inline_action,
            invalid_action,
            define("insertText", FunctionKind::Mutation),
            define("readText", FunctionKind::Query),
        ],
        ..FunctionManifest::default()
    }
}

fn configured() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("snapback");
    snapback.apply_schema(schema()).expect("schema");
    snapback.load_functions(functions());
    snapback
}

fn input(args: Value) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput::default(),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

fn items(snapback: &LocalSnapback) -> Vec<Value> {
    snapback
        .invoke_query("listItems", input(json!({})))
        .expect("listItems")
        .rows
}

#[test]
fn unsettled_mutation_fails_and_commits_nothing() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("insertThenHang", input(json!({})))
        .expect_err("an unsettled mutation must not be reported as success");
    assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_DID_NOT_SETTLE");
    assert!(
        items(&snapback).is_empty(),
        "the pre-await insert must not commit when the handler never settled"
    );
}

#[test]
fn settled_variant_of_the_same_handler_commits_both_writes() {
    // Positive control for the repro shape: with the resolve branch taken the
    // identical handler settles, succeeds, and commits both inserts.
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation("insertThenHang", input(json!({ "resolve": true })))
        .expect("settled mutation");
    assert_eq!(output.result, json!({}));
    let rows = items(&snapback);
    assert_eq!(
        rows.len(),
        2,
        "both inserts commit when the handler settles"
    );
}

#[test]
fn unsettled_query_reports_did_not_settle_not_result_invalid() {
    // Before the envelope, an unsettled query surfaced as the misleading
    // "must return an array" SNAPBACK_HANDLER_RESULT_INVALID.
    let snapback = configured();
    let error = snapback
        .invoke_query("hangForever", input(json!({})))
        .expect_err("an unsettled query must fail");
    assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_DID_NOT_SETTLE");
}

#[test]
fn legitimate_empty_object_result_still_succeeds() {
    // The value the pending-promise fallback used to forge. It must stay a
    // perfectly valid handler result.
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation("returnsEmptyObject", input(json!({})))
        .expect("mutation returning {}");
    assert_eq!(output.result, json!({}));
}

#[test]
fn ctx_db_string_larger_than_failure_metadata_bound_roundtrips_exactly() {
    // @ref LLP 0108#runtime-validation-and-atomicity — a stored value below
    // the declared result ceilings reaches the handler and its published
    // post-JSON result in full; no engine bridge may return a plausible prefix.
    let mut snapback = configured();
    let body = "x".repeat(44_084);
    let inserted = snapback
        .invoke_mutation("insertText", input(json!({ "body": body })))
        .expect("insert long string through a JS mutation");
    let id = inserted.result.as_str().expect("insert returns id");
    let rows = snapback
        .invoke_query("readText", input(json!({ "id": id })))
        .expect("read long string through a JS query")
        .rows;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["observedLength"], 44_084);
    assert_eq!(rows[0]["body"].as_str(), Some(body.as_str()));
}

#[test]
fn undefined_and_null_results_still_normalize_to_null() {
    let mut snapback = configured();
    let undefined = snapback
        .invoke_mutation("returnsUndefined", input(json!({})))
        .expect("mutation returning undefined");
    assert_eq!(undefined.result, Value::Null);
    let null = snapback
        .invoke_mutation("returnsNull", input(json!({})))
        .expect("mutation returning null");
    assert_eq!(null.result, Value::Null);
}

#[test]
fn function_result_fails_closed_and_commits_nothing() {
    // JSON.stringify(function) is undefined; the untagged channel used to
    // deliver that as a silent null success. The IIFE now throws
    // SNAPBACK_HANDLER_RESULT_INVALID in JS, and the buffered insert must
    // not commit.
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("insertThenReturnFunction", input(json!({})))
        .expect_err("a non-JSON-serializable result must fail");
    assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_RESULT_INVALID");
    assert!(
        items(&snapback).is_empty(),
        "writes must not commit when the result channel is invalid"
    );
}

#[test]
fn pool_stays_healthy_after_an_unsettled_invocation() {
    // The warm path checks the VM back in before parsing the output; the
    // DK-4 reset must leave it (or a fresh replacement) fully usable.
    let mut snapback = configured();
    for _ in 0..2 {
        let error = snapback
            .invoke_mutation("insertThenHang", input(json!({})))
            .expect_err("unsettled mutation");
        assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_DID_NOT_SETTLE");
    }
    let output = snapback
        .invoke_mutation("insertOne", input(json!({ "n": 7 })))
        .expect("mutation after unsettled invocations");
    assert_eq!(output.result, json!({}));
    let rows = items(&snapback);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["n"], json!(7));
}

#[test]
fn declared_result_contract_refuses_before_mutation_commit() {
    // @ref LLP 0108#final-author-reconciliation-after-round-3 — mutation
    // result validation runs while handler writes are still buffered.
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("insertThenReturnWrongContract", input(json!({ "n": 9 })))
        .expect_err("an invalid declared result must refuse");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION"
    );
    assert!(
        items(&snapback).is_empty(),
        "writes must not commit when the declared result contract fails"
    );
}

#[test]
fn declared_result_contract_refuses_before_query_publication() {
    let mut snapback = configured();
    snapback
        .invoke_mutation("insertOne", input(json!({ "n": 7 })))
        .expect("seed one query row");
    let error = snapback
        .invoke_query("listItemsWrongContract", input(json!({})))
        .expect_err("an invalid query result must refuse");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION"
    );
    assert_eq!(
        items(&snapback).len(),
        1,
        "query result refusal cannot mutate source state"
    );
}

#[test]
fn inline_query_live_mutation_and_action_execute_with_precise_contracts() {
    // @ref LLP 0108#final-author-reconciliation-after-round-3 — the generated
    // inline form uses the ordinary native runtime after load-time admission;
    // every operation kind still crosses the same effective result validator.
    let mut snapback = configured();
    let mutation = snapback
        .invoke_mutation("insertOne", input(json!({ "n": 7 })))
        .expect("inline mutation");
    assert_eq!(mutation.result, json!({}));

    let query = snapback
        .invoke_query("listItems", input(json!({})))
        .expect("inline query");
    let live_query = snapback
        .invoke_query("listItemsLive", input(json!({})))
        .expect("inline live query");
    assert_eq!(live_query.rows, query.rows);

    let action = snapback.run_app_action("echoAction", input(json!({ "accepted": true })));
    assert!(action.ok, "{:?}", action.diagnostic);
    assert_eq!(action.result, Some(json!({ "accepted": true })));
}

#[test]
fn declared_action_result_contract_refuses_before_publication() {
    let mut snapback = configured();
    let action = snapback.run_app_action("echoActionWrongContract", input(json!({})));
    assert!(!action.ok, "an invalid action result must not be published");
    assert_eq!(
        action.diagnostic.map(|diagnostic| diagnostic.code),
        Some("SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION".to_owned()),
    );
    assert_eq!(action.result, None);
}
