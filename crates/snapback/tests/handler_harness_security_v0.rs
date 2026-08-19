//! ENG-24339: the handler module is untrusted with respect to the invocation
//! harness. Reserving a harness global must not expose the live epoch/transport,
//! and action DB reads stay denied at the Rust host boundary.

use serde_json::{Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime,
    HandlerInput, IbexModule, SchemaManifest, TableManifest,
};

const SEED_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async seed(ctx, args) {
    var id = await ctx.db.insert('items', { secret: args.secret });
    return { id: id };
  }
};
"#;

// This is the original exploit shape: on the vulnerable source ordering the
// app reserves __snapbackSettle before ctx-bootstrap evaluates. The trusted
// assignment silently loses, and the invocation IIFE hands this function the
// live epoch; action-mode raw db.get then returns the seeded row.
const HOSTILE_ACTION_SOURCE: &str = r#"
var reservationBlocked = false;
var hostileSettle = async function(name, argsJson, authJson, mode, runJson, secretsJson, epoch) {
  var args = JSON.parse(argsJson || '{}');
  var stolen = globalThis.__hostCall(
    epoch + '|db.get',
    JSON.stringify({ table: 'items', id: args.id })
  );
  return JSON.stringify({
    r: {
      __snapbackOk: true,
      value: { settleHijacked: true, stolen: stolen }
    }
  });
};
try {
  Object.defineProperty(globalThis, '__snapbackSettle', {
    value: hostileSettle,
    configurable: false,
    writable: false
  });
} catch (_) {
  reservationBlocked = true;
}

globalThis.__snapbackHandlers = {
  async hostileAction(ctx, args) {
    var ordinaryDenied = false;
    try {
      await ctx.db.get('items', args.id);
    } catch (error) {
      ordinaryDenied = String(error && error.message || error)
        .indexOf('SNAPBACK_HANDLER_WRITE_IN_QUERY') >= 0;
    }
    return {
      settleHijacked: false,
      reservationBlocked: reservationBlocked,
      ordinaryDenied: ordinaryDenied
    };
  }
};
"#;

fn input(args: Value) -> HandlerInput {
    HandlerInput {
        args,
        ..HandlerInput::default()
    }
}

fn configured() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("instance");
    snapback
        .apply_schema(SchemaManifest {
            schema_hash: Some("handler-harness-security-v0".to_owned()),
            tables: vec![TableManifest {
                name: "items".to_owned(),
                fields: vec![FieldManifest {
                    name: "secret".to_owned(),
                    field_type: FieldType::String,
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
            }],
            ..SchemaManifest::default()
        })
        .expect("schema");
    snapback.load_functions(FunctionManifest {
        functions: vec![
            FunctionDefinition::new(
                "seed",
                FunctionKind::Mutation,
                FunctionRuntime::IbexModule(IbexModule {
                    source: SEED_SOURCE.to_owned(),
                    export: "seed".to_owned(),
                }),
            ),
            FunctionDefinition::new(
                "hostileAction",
                FunctionKind::Action,
                FunctionRuntime::IbexModule(IbexModule {
                    source: HOSTILE_ACTION_SOURCE.to_owned(),
                    export: "hostileAction".to_owned(),
                }),
            ),
        ],
        ..FunctionManifest::default()
    });
    snapback
}

#[test]
fn hostile_settlement_global_cannot_steal_action_data() {
    let mut snapback = configured();
    let seed = snapback.run_function("seed", input(json!({ "secret": "classified" })));
    assert!(seed.ok, "seed failed: {:?}", seed.diagnostic);
    let id = seed
        .result
        .as_ref()
        .and_then(|value| value["id"].as_str())
        .expect("seed returns id")
        .to_owned();

    let action = snapback.run_app_action("hostileAction", input(json!({ "id": id })));
    assert!(action.ok, "action failed: {:?}", action.diagnostic);
    assert_eq!(
        action.result,
        Some(json!({
            "settleHijacked": false,
            "reservationBlocked": true,
            "ordinaryDenied": true
        })),
        "application code must receive neither the invocation epoch nor direct DB read authority"
    );
}
