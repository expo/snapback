//! ENG-23430 settlement gate: the vendored eval loop's no-progress fallback
//! returns the still-pending invocation promise with SUCCESS status, which
//! JSON-stringifies to "{}". Before the tagged completion envelope, Snapback
//! read that as a handler that legitimately returned `{}` — a mutation's
//! buffered pre-await writes committed and the client saw success. These
//! tests pin the fix: an unsettled handler is a failed invocation
//! (`SNAPBACK_HANDLER_DID_NOT_SETTLE`) that commits nothing, while legitimate
//! `{}` / `null` / `undefined` results still succeed.

use serde_json::{Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerInput, IbexModule, SchemaManifest, TableManifest,
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
  async listItems(ctx) {
    return await ctx.db.query('items').order('_createdAt', 'asc').collect();
  }
};
"#;

fn schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("settlement-v0".to_owned()),
        tables: vec![TableManifest {
            name: "items".to_owned(),
            fields: vec![FieldManifest {
                name: "n".to_owned(),
                field_type: FieldType::Integer,
                optional: false,
            }],
            indexes: Vec::new(),
            syncable: true,
        }],
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
    FunctionManifest {
        functions: vec![
            define("insertThenHang", FunctionKind::Mutation),
            define("hangForever", FunctionKind::Query),
            define("returnsEmptyObject", FunctionKind::Mutation),
            define("returnsUndefined", FunctionKind::Mutation),
            define("returnsNull", FunctionKind::Mutation),
            define("insertThenReturnFunction", FunctionKind::Mutation),
            define("insertOne", FunctionKind::Mutation),
            define("listItems", FunctionKind::Query),
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
    assert_eq!(rows.len(), 2, "both inserts commit when the handler settles");
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
