//! LLP 0043 M2: mutation handlers can observe the durable client settlement
//! identity whose committed duplicate is replayed without handler re-entry.

use serde_json::{Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerInput, IbexModule, SchemaManifest, TableManifest,
};

const USER: &str = "settlement-user";

const HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async observeSettlement(ctx, args) {
    var first = await ctx.mutation.settlement();
    var second = await ctx.mutation.settlement();
    await ctx.db.insert('entries', {
      marker: args.marker,
      clientMutationId: first.clientMutationId,
      settlementId: first.settlementId
    });
    return {
      clientMutationId: first.clientMutationId,
      settlementId: first.settlementId,
      frozen: Object.isFrozen(first),
      nullPrototype: Object.getPrototypeOf(first) === null,
      fresh: first !== second,
      fields: Object.keys(first).sort().join(',')
    };
  },
  async throwSettlement(ctx) {
    var settlement = await ctx.mutation.settlement();
    var entryId = await ctx.runtime.id();
    throw new Error(settlement.settlementId + '|' + entryId);
  },
  async recordEffectIntent(ctx) {
    var settlement = await ctx.mutation.settlement();
    var providerIdempotencyKey = settlement.settlementId === null
      ? null
      : 'notification:' + settlement.settlementId;
    await ctx.db.insert('entries', {
      marker: providerIdempotencyKey === null ? 'no-settlement-identity' : providerIdempotencyKey,
      clientMutationId: settlement.clientMutationId,
      settlementId: settlement.settlementId
    });
    return {
      queued: providerIdempotencyKey !== null,
      providerIdempotencyKey: providerIdempotencyKey
    };
  },
  async listEntries(ctx) {
    return await ctx.db.query('entries').collect();
  },
  async querySettlement(ctx) {
    return [await ctx.mutation.settlement()];
  },
  async actionSettlement(ctx) {
    return await ctx.mutation.settlement();
  }
};
"#;

fn schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("mutation-settlement-identity-v0".to_owned()),
        tables: vec![TableManifest {
            name: "entries".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "marker".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "clientMutationId".to_owned(),
                    field_type: FieldType::String,
                    optional: true,
                },
                FieldManifest {
                    name: "settlementId".to_owned(),
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
            visibility: Some(snapback::manifest::TableVisibilityV1::PublicRead),
            history: None,
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
                source: HANDLER_SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        )
    };
    FunctionManifest {
        functions: vec![
            define("observeSettlement", FunctionKind::Mutation),
            define("throwSettlement", FunctionKind::Mutation),
            define("recordEffectIntent", FunctionKind::Mutation),
            define("listEntries", FunctionKind::Query),
            define("querySettlement", FunctionKind::Query),
            define("actionSettlement", FunctionKind::Action),
        ],
        ..FunctionManifest::default()
    }
}

fn configured() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(schema()).expect("apply schema");
    snapback.load_functions(functions());
    snapback
}

fn input(args: Value) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            user_id: Some(USER.to_owned()),
            ..AuthInput::default()
        },
        ..HandlerInput::default()
    }
}

#[allow(clippy::result_large_err)] // SnapbackResult is the API under test.
fn invoke_with_id(
    snapback: &mut LocalSnapback,
    name: &str,
    args: Value,
    client_mutation_id: &str,
) -> snapback::diagnostic::SnapbackResult<snapback::manifest::MutationOutput> {
    snapback
        .invoke_mutation_recording_with_id(
            name,
            input(args),
            Some(client_mutation_id.to_owned()),
            "test",
        )
        .0
}

fn assert_sha256(value: &Value) {
    let value = value.as_str().expect("settlement id is a string");
    let hex = value
        .strip_prefix("sha256:")
        .expect("settlement id has the sha256 prefix");
    assert_eq!(hex.len(), 64, "settlement digest has 32-byte hex output");
    assert!(
        hex.bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
        "settlement digest is lowercase hexadecimal: {value}"
    );
}

#[test]
fn mutation_handler_observes_its_settlement_identity() {
    let mut snapback = configured();
    let client_mutation_id = "cm_settlement_observe_1";
    let output = invoke_with_id(
        &mut snapback,
        "observeSettlement",
        json!({ "marker": "observe" }),
        client_mutation_id,
    )
    .expect("mutation with client settlement identity");

    assert_eq!(output.result["clientMutationId"], client_mutation_id);
    assert_sha256(&output.result["settlementId"]);
    assert_eq!(output.result["frozen"], true);
    assert_eq!(output.result["nullPrototype"], true);
    assert_eq!(output.result["fresh"], true);
    assert_eq!(
        output.result["fields"], "clientMutationId,settlementId",
        "the projection exposes only the two specified own fields"
    );
}

#[test]
fn settlement_identity_is_absent_without_a_client_mutation_id() {
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation(
            "observeSettlement",
            input(json!({ "marker": "no-client-id" })),
        )
        .expect("ordinary mutation");

    assert_eq!(output.result["clientMutationId"], Value::Null);
    assert_eq!(output.result["settlementId"], Value::Null);
}

#[test]
fn settled_duplicate_does_not_re_enter_the_handler() {
    let mut snapback = configured();
    let client_mutation_id = "cm_settlement_duplicate_1";
    let args = json!({ "marker": "duplicate" });
    let first = invoke_with_id(
        &mut snapback,
        "observeSettlement",
        args.clone(),
        client_mutation_id,
    )
    .expect("first mutation execution");
    let replayed = invoke_with_id(&mut snapback, "observeSettlement", args, client_mutation_id)
        .expect("settled duplicate replay");

    assert_eq!(replayed, first, "replay returns the settled output exactly");
    let rows = snapback
        .invoke_query("listEntries", input(json!({})))
        .expect("list committed entries")
        .rows;
    assert_eq!(
        rows.len(),
        1,
        "a settled duplicate must not run the inserting handler twice"
    );
}

#[test]
fn settlement_identity_is_stable_across_a_genuine_re_entry() {
    let mut snapback = configured();
    let client_mutation_id = "cm_settlement_reentry_1";
    let attempt = |snapback: &mut LocalSnapback| {
        // The re-entry witness is carried by an app-authored throw, whose
        // message is intentionally visible only under development exposure.
        let error = snapback::runtime::with_development_handler_error_exposure(|| {
            invoke_with_id(snapback, "throwSettlement", json!({}), client_mutation_id)
        })
        .expect_err("the retry probe deliberately throws before settlement");
        assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_FAILED");
        error.diagnostic.details["message"]
            .as_str()
            .expect("handler failure carries the extracted error message")
            .split_once('|')
            .map(|(settlement, entry)| (settlement.to_owned(), entry.to_owned()))
            .expect("retry probe includes settlement and per-entry ids")
    };

    let first = attempt(&mut snapback);
    let second = attempt(&mut snapback);
    assert_eq!(
        first.0, second.0,
        "the server-constructed settlement digest is stable across re-entry"
    );
    assert_ne!(
        first.1, second.1,
        "a fresh ctx.runtime.id proves the handler genuinely re-entered"
    );
    assert_sha256(&Value::String(first.0));
}

#[test]
fn effect_intent_uses_one_replay_stable_provider_key() {
    let mut snapback = configured();
    let client_mutation_id = "cm_settlement_effect_1";
    let first = invoke_with_id(
        &mut snapback,
        "recordEffectIntent",
        json!({}),
        client_mutation_id,
    )
    .expect("record effect intent");
    let replayed = invoke_with_id(
        &mut snapback,
        "recordEffectIntent",
        json!({}),
        client_mutation_id,
    )
    .expect("replay settled effect intent");

    assert_eq!(replayed, first, "the settled duplicate returns one result");
    assert_eq!(first.result["queued"], true);
    let settlement_id = first.result["providerIdempotencyKey"]
        .as_str()
        .expect("effect intent has a provider key")
        .strip_prefix("notification:")
        .expect("provider key is namespaced for the effect");
    assert_sha256(&Value::String(settlement_id.to_owned()));

    let rows = snapback
        .invoke_query("listEntries", input(json!({})))
        .expect("list committed effect intents")
        .rows;
    assert_eq!(rows.len(), 1, "settled replay inserts one effect intent");
    assert_eq!(rows[0]["marker"], first.result["providerIdempotencyKey"]);
}

#[test]
fn queries_and_actions_refuse_the_settlement_surface() {
    let mut snapback = configured();
    let query = snapback
        .invoke_query("querySettlement", input(json!({})))
        .expect_err("queries have no mutation settlement identity");
    assert_eq!(
        query.diagnostic.code,
        "SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE"
    );
    assert!(
        query.diagnostic.details["message"]
            .as_str()
            .is_some_and(|message| message.ends_with(
                "queries are never queued or settled; only mutations carry a settlement identity"
            )),
        "query refusal retains the specified message body"
    );

    let action = snapback.run_app_action("actionSettlement", input(json!({})));
    assert!(!action.ok, "actions have no mutation settlement identity");
    let action = action.diagnostic.expect("action refusal diagnostic");
    assert_eq!(action.code, "SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE");
    assert!(
        action.details["message"]
            .as_str()
            .is_some_and(|message| message.ends_with(
                "actions carry no settlement identity; call ctx.runMutation and read ctx.mutation.settlement() inside that mutation"
            )),
        "action refusal retains the specified message body"
    );
}
