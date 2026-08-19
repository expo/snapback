// 0137 a4-f5: a nested mutation's trusted SNAPBACK_AUTH_PERMISSION_DENIED
// must survive the action boundary — before the fix the caller saw only
// SNAPBACK_HANDLER_FAILED, so a client could not distinguish "not allowed"
// from "handler crashed" one hop into the action lane.
//
// The pass-through is witness-gated to preserve LLP 0053's rule that a
// handler-forged `{code: ...}` stays untyped: the typed code surfaces only
// when the host itself produced the denial during this invocation
// (`denial_witness` in src/runtime.rs), and the surfaced bytes are the
// host-recorded uniform denial, not the JS round-trip.

use serde_json::{Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, AuthRequirement, FieldManifest, FieldType, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, IbexModule, MembershipManifest, MembershipOp,
    MembershipProvenance, MembershipScope, MembershipTarget, MembershipTransition, SchemaManifest,
    TableManifest,
};

const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async gatedMutation(ctx) {
    await ctx.permissions.app_members.requireRole(null, 'admin');
    return null;
  },
  async gatedAction(ctx) {
    return await ctx.runMutation('gatedMutation', {});
  },
  async forgedDenialAction(ctx) {
    var error = new Error('forged denial that no host op produced');
    error.__snapbackCode = 'SNAPBACK_AUTH_PERMISSION_DENIED';
    throw error;
  },
  async caughtDenialOtherFailureAction(ctx) {
    try { await ctx.runMutation('gatedMutation', {}); } catch (_ignored) {}
    throw new Error('unrelated failure after catching the denial');
  },
  async caughtDenialRecoveryAction(ctx) {
    try { await ctx.runMutation('gatedMutation', {}); } catch (_ignored) {}
    return { recovered: true };
  }
};
"#;

fn function(name: &str, kind: FunctionKind) -> FunctionDefinition {
    let mut function = FunctionDefinition::new(
        name,
        kind,
        FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: name.to_owned(),
        }),
    );
    function.auth_requirement = Some(AuthRequirement::Authenticated);
    function
}

fn schema() -> SchemaManifest {
    SchemaManifest {
        tables: vec![TableManifest {
            name: "app_members".to_owned(),
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
                id: None,
                principal: "userId".to_owned(),
                resource: None,
                role: "role".to_owned(),
                roles: vec!["member".to_owned(), "admin".to_owned()],
                pending_roles: None,
                bootstrap_role: None,
                last_holder: None,
                expiry: None,
                incidental: None,
                provenance: Some(MembershipProvenance::Full),
                transitions: vec![MembershipTransition {
                    op: MembershipOp::Insert,
                    by: vec!["none".to_owned()],
                    target: MembershipTarget::Own,
                    from: None,
                    to: Some(vec!["member".to_owned()]),
                    fields: None,
                }],
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

fn configured() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(schema()).expect("membership schema");
    let diagnostics = snapback.load_functions(FunctionManifest {
        functions: vec![
            function("gatedMutation", FunctionKind::Mutation),
            function("gatedAction", FunctionKind::Action),
            function("forgedDenialAction", FunctionKind::Action),
            function("caughtDenialOtherFailureAction", FunctionKind::Action),
            function("caughtDenialRecoveryAction", FunctionKind::Action),
        ],
        ..FunctionManifest::default()
    });
    assert!(
        diagnostics.iter().all(|diagnostic| {
            diagnostic.severity != snapback::diagnostic::DiagnosticSeverity::Error
        }),
        "manifest must install: {diagnostics:?}"
    );
    snapback
}

fn input(user: &str) -> HandlerInput {
    HandlerInput {
        args: Value::Object(Default::default()),
        auth: AuthInput {
            principal: Some(user.to_owned()),
            session_id: None,
            user_id: Some(user.to_owned()),
            ..AuthInput::default()
        },
        ..HandlerInput::default()
    }
}

#[test]
fn nested_mutation_denial_surfaces_typed_through_the_action_boundary() {
    let mut snapback = configured();

    // The direct-mutation denial is the uniformity baseline.
    let direct = snapback.run_function("gatedMutation", input("user_outsider"));
    assert!(!direct.ok, "outsider must be denied directly");
    let direct_diagnostic = direct.diagnostic.expect("direct denial diagnostic");
    assert_eq!(direct_diagnostic.code, "SNAPBACK_AUTH_PERMISSION_DENIED");

    // The same denial one hop into the action lane keeps the PLATFORM code
    // and the identical uniform bytes (code, message, details).
    let via_action = snapback.run_function("gatedAction", input("user_outsider"));
    assert!(!via_action.ok, "denial must hold through the action");
    let action_diagnostic = via_action.diagnostic.expect("action denial diagnostic");
    assert_eq!(
        action_diagnostic.code, "SNAPBACK_AUTH_PERMISSION_DENIED",
        "the platform auth code must survive the action boundary, got {action_diagnostic:?}"
    );
    assert_eq!(
        action_diagnostic.message, direct_diagnostic.message,
        "denial message must be byte-uniform with the direct-mutation denial"
    );
    assert_eq!(
        action_diagnostic.details, direct_diagnostic.details,
        "denial details must be byte-uniform with the direct-mutation denial"
    );
}

#[test]
fn forged_denial_code_without_a_witness_stays_untyped() {
    let mut snapback = configured();
    let forged = snapback.run_function("forgedDenialAction", input("user_outsider"));
    assert!(!forged.ok);
    let diagnostic = forged.diagnostic.expect("forged failure diagnostic");
    assert_eq!(
        diagnostic.code, "SNAPBACK_HANDLER_FAILED",
        "a handler-forged denial code must stay untyped (LLP 0053), got {diagnostic:?}"
    );
}

#[test]
fn caught_denial_with_unrelated_failure_is_not_restored() {
    let mut snapback = configured();
    let result = snapback::runtime::with_development_handler_error_exposure(|| {
        snapback.run_function("caughtDenialOtherFailureAction", input("user_outsider"))
    });
    assert!(!result.ok);
    let diagnostic = result.diagnostic.expect("unrelated failure diagnostic");
    assert_eq!(
        diagnostic.code, "SNAPBACK_HANDLER_FAILED",
        "a caught denial followed by an unrelated failure keeps the handler's own failure, got {diagnostic:?}"
    );
    assert_eq!(
        diagnostic
            .details
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or(""),
        "unrelated failure after catching the denial"
    );
}

#[test]
fn caught_denial_with_recovery_still_succeeds() {
    let mut snapback = configured();
    let result = snapback.run_function("caughtDenialRecoveryAction", input("user_outsider"));
    assert!(
        result.ok,
        "an action may catch a nested denial and take an alternative path (the denied \
         mutation committed nothing): {:?}",
        result.diagnostic
    );
    assert_eq!(result.result, Some(json!({ "recovered": true })));
}
