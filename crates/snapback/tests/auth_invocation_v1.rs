use std::collections::BTreeMap;

use serde_json::{Value, json};
use snapback::diagnostic::DiagnosticSeverity;
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, AuthRequirement, CronActivationPolicy, CronJitterPolicy, CronJobDefinition,
    CronOverlapPolicy, CronRetryPolicy, CronSchedule, FieldManifest, FieldType, FunctionDefinition,
    FunctionKind, FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, IbexModule,
    IdentityBindingTableManifestV1, MutationPlan, MutationStep, SchemaManifest, TableManifest,
    TableVisibilityV1, ValueExpr,
};

const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async requiredQuery(ctx) {
    return [{ userId: ctx.auth.userId }];
  },
  async publicQuery(ctx) {
    return [{ userId: ctx.auth.userId, authenticated: ctx.auth.isAuthenticated }];
  },
  async optionalQuery(ctx) {
    return [{ userId: ctx.auth.userId }];
  },
  async projectionQuery(ctx) {
    const descriptors = Object.getOwnPropertyDescriptors(ctx.auth);
    return [{
      prototypeIsNull: Object.getPrototypeOf(ctx.auth) === null,
      frozen: Object.isFrozen(ctx.auth),
      rolesFrozen: ctx.auth.roles === undefined || Object.isFrozen(ctx.auth.roles),
      keys: Object.keys(ctx.auth).sort(),
      ownDataOnly: Object.keys(descriptors).every(function(key) {
        const descriptor = descriptors[key];
        return descriptor.get === undefined && descriptor.set === undefined &&
          descriptor.enumerable === true && descriptor.writable === false &&
          descriptor.configurable === false;
      }),
      inheritedPollution: ctx.auth.polluted === undefined,
    }];
  },
  async createRecord(ctx, args) {
    return await ctx.db.insert('records', { value: args.value });
  },
  async outerAction(ctx, args) {
    return await ctx.runMutation('createRecord', { value: args.value });
  },
  async scheduledAction() {
    return null;
  }
};
"#;

fn module(
    name: &str,
    kind: FunctionKind,
    requirement: Option<AuthRequirement>,
) -> FunctionDefinition {
    let mut function = FunctionDefinition::new(
        name,
        kind,
        FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: name.to_owned(),
        }),
    );
    function.auth_requirement = requirement;
    function
}

fn input(user_id: Option<&str>, args: Value) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            principal: None,
            session_id: None,
            user_id: user_id.map(str::to_owned),
            ..AuthInput::default()
        },
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

fn configured() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback
        .apply_schema(SchemaManifest {
            tables: vec![TableManifest {
                name: "records".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "owner".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "value".to_owned(),
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
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: Some(TableVisibilityV1::Owner {
                    field: "owner".to_owned(),
                }),
                history: None,
            }],
            ..SchemaManifest::default()
        })
        .expect("apply schema");
    let diagnostics = snapback.load_functions(FunctionManifest {
        functions: vec![
            module(
                "requiredQuery",
                FunctionKind::Query,
                Some(AuthRequirement::Authenticated),
            ),
            module(
                "publicQuery",
                FunctionKind::Query,
                Some(AuthRequirement::Public),
            ),
            module("optionalQuery", FunctionKind::Query, None),
            module(
                "projectionQuery",
                FunctionKind::Query,
                Some(AuthRequirement::Public),
            ),
            module(
                "createRecord",
                FunctionKind::Mutation,
                Some(AuthRequirement::Authenticated),
            ),
            module(
                "outerAction",
                FunctionKind::Action,
                Some(AuthRequirement::Public),
            ),
        ],
        ..FunctionManifest::default()
    });
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != DiagnosticSeverity::Error),
        "function load diagnostics: {diagnostics:?}"
    );
    snapback
}

#[test]
fn requirement_gate_applies_before_handler_and_public_preserves_a_user() {
    let snapback = configured();
    let error = snapback
        .invoke_query("requiredQuery", input(None, json!({})))
        .expect_err("anonymous required query must fail");
    assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_REQUIRED");

    let required = snapback
        .invoke_query("requiredQuery", input(Some("user_1"), json!({})))
        .expect("authenticated query");
    assert_eq!(required.rows[0]["userId"], "user_1");

    let public = snapback
        .invoke_query("publicQuery", input(Some("user_1"), json!({})))
        .expect("public does not strip resolved user");
    assert_eq!(public.rows[0]["userId"], "user_1");
    assert_eq!(public.rows[0]["authenticated"], true);

    let optional = snapback
        .invoke_query("optionalQuery", input(None, json!({})))
        .expect("legacy absence means optional-user");
    assert_eq!(optional.rows[0]["userId"], Value::Null);
}

#[test]
fn handler_projection_is_exact_null_prototype_and_deep_frozen() {
    // Application source evaluates before invocation. Even replacing the
    // object/array primitives used to construct the projection must not let
    // the handler forge, loosen, or inherit authority.
    let mut snapback = configured();
    let polluter = module(
        "projectionQuery",
        FunctionKind::Query,
        Some(AuthRequirement::Public),
    );
    let mut source = SOURCE.to_owned();
    source.insert_str(
        0,
        r#"
Object.prototype.polluted = 'attacker';
JSON.parse = function() {
  return { userId: 'forged-user', roles: ['forged'] };
};
Object.create = function() { return { forged: true }; };
Object.freeze = function(value) { return value; };
Object.defineProperty = function(target, key, descriptor) {
  target[key] = descriptor.value;
  return target;
};
Object.prototype.hasOwnProperty = function() { return false; };
Array.prototype.slice = function() { return ['forged']; };
"#,
    );
    let mut polluter = polluter;
    polluter.runtime = FunctionRuntime::IbexModule(IbexModule {
        source,
        export: "projectionQuery".to_owned(),
    });
    let diagnostics = snapback.load_functions(FunctionManifest {
        functions: vec![polluter],
        ..FunctionManifest::default()
    });
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != DiagnosticSeverity::Error)
    );

    let output = snapback
        .invoke_query("projectionQuery", input(Some("user_1"), json!({})))
        .expect("projection query");
    let row = &output.rows[0];
    assert_eq!(row["prototypeIsNull"], true);
    assert_eq!(row["frozen"], true);
    assert_eq!(row["rolesFrozen"], true);
    assert_eq!(row["ownDataOnly"], true);
    assert_eq!(row["inheritedPollution"], true);
    assert_eq!(
        row["keys"],
        json!(["isAuthenticated", "kind", "roles", "sessionId", "userId"])
    );
}

#[test]
fn hostile_json_parse_replacement_cannot_erase_host_selected_export() {
    let mut snapback = configured();
    let mut function = module(
        "projectionQuery",
        FunctionKind::Query,
        Some(AuthRequirement::Public),
    );
    function.runtime = FunctionRuntime::IbexModule(IbexModule {
        source: r#"
JSON.parse = function() {
  return { userId: 'forged-user', roles: ['forged'] };
};
globalThis.__snapbackHandlers = {
  async projectionQuery(ctx) {
    return [{ userId: ctx.auth.userId }];
  }
};
"#
        .to_owned(),
        export: "projectionQuery".to_owned(),
    });
    let diagnostics = snapback.load_functions(FunctionManifest {
        functions: vec![function],
        ..FunctionManifest::default()
    });
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != DiagnosticSeverity::Error)
    );

    let output = snapback
        .invoke_query("projectionQuery", input(Some("user_1"), json!({})))
        .expect("captured JSON.parse must preserve host-selected export resolution");
    assert_eq!(output.rows, vec![json!({ "userId": "user_1" })]);
}

#[test]
fn nested_mutation_inherits_outer_authority_and_action_errors_stay_enveloped() {
    let mut snapback = configured();
    let direct = snapback
        .invoke_mutation(
            "createRecord",
            input(None, json!({ "value": "default-auth-bypass" })),
        )
        .expect_err("default/empty auth cannot bypass an authenticated mutation");
    assert_eq!(direct.diagnostic.code, "SNAPBACK_AUTH_REQUIRED");

    let denied = snapback.run_app_action("outerAction", input(None, json!({ "value": "denied" })));
    assert!(!denied.ok);
    assert_eq!(
        denied
            .diagnostic
            .as_ref()
            .map(|diagnostic| diagnostic.code.as_str()),
        Some("SNAPBACK_AUTH_REQUIRED")
    );
    assert_eq!(
        snapback
            .scan_table("records", 10, 0)
            .expect("scan denied records")
            .total,
        0
    );

    let allowed = snapback.run_app_action(
        "outerAction",
        input(Some("user_1"), json!({ "value": "allowed" })),
    );
    assert!(allowed.ok, "allowed action: {allowed:?}");
    let rows = snapback
        .scan_table("records", 10, 0)
        .expect("scan allowed records");
    assert_eq!(rows.total, 1);
    assert_eq!(rows.rows[0]["owner"], "user_1");
}

#[test]
fn ordinary_handler_cannot_write_declared_identity_binding_table() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    let binding_table =
        |name: &str, visibility: Option<TableVisibilityV1>, permission_backing: bool| {
            TableManifest {
                name: name.to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "principal".to_owned(),
                        field_type: FieldType::Principal,
                        optional: false,
                    },
                    FieldManifest {
                        name: "sourceUserID".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
                syncable: false,
                permission_backing,
                permission_fields: permission_backing.then(|| vec!["principal".to_owned()]),
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility,
                history: None,
            }
        };
    let binding_declaration = |table: &str| IdentityBindingTableManifestV1 {
        table: table.to_owned(),
        principal_field: "principal".to_owned(),
        identity_field: "sourceUserID".to_owned(),
    };
    let schema = SchemaManifest {
        tables: vec![
            binding_table("identityBindings", None, false),
            binding_table(
                "publicIdentityBindings",
                Some(TableVisibilityV1::PublicRead),
                false,
            ),
            binding_table(
                "ownedIdentityBindings",
                Some(TableVisibilityV1::Owner {
                    field: "principal".to_owned(),
                }),
                false,
            ),
            binding_table(
                "permissionIdentityBindings",
                Some(TableVisibilityV1::Owner {
                    field: "principal".to_owned(),
                }),
                true,
            ),
            TableManifest {
                name: "ordinaryOwnedRecords".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "owner".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "value".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
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
                visibility: Some(TableVisibilityV1::Owner {
                    field: "owner".to_owned(),
                }),
                history: None,
            },
        ],
        identity_binding_tables: vec![
            binding_declaration("identityBindings"),
            binding_declaration("publicIdentityBindings"),
            binding_declaration("ownedIdentityBindings"),
            binding_declaration("permissionIdentityBindings"),
        ],
        ..SchemaManifest::default()
    };
    snapback.apply_schema(schema).expect("binding schema");
    let source = r#"globalThis.__snapbackHandlers = {
      async createBinding(ctx, args) {
        return await ctx.db.insert('identityBindings', { principal: ctx.auth.userId, sourceUserID: args.sourceUserID });
      },
      async patchBinding(ctx, args) {
        return await ctx.db.patch('identityBindings', 'binding_1', { sourceUserID: args.sourceUserID });
      },
      async deleteBinding(ctx) {
        return await ctx.db.delete('identityBindings', 'binding_1');
      },
      async createPublicBinding(ctx, args) {
        return await ctx.db.insert('publicIdentityBindings', { principal: ctx.auth.userId, sourceUserID: args.sourceUserID });
      },
      async createOwnedBinding(ctx, args) {
        return await ctx.db.insert('ownedIdentityBindings', { principal: ctx.auth.userId, sourceUserID: args.sourceUserID });
      },
      async createPermissionBinding(ctx, args) {
        return await ctx.db.insert('permissionIdentityBindings', { principal: ctx.auth.userId, sourceUserID: args.sourceUserID });
      },
      async createOwnedBindingWithoutUser(ctx, args) {
        return await ctx.db.insert('ownedIdentityBindings', { sourceUserID: args.sourceUserID });
      },
      async patchOwnedBindingOwner(ctx, args) {
        return await ctx.db.patch('ownedIdentityBindings', 'binding_1', { principal: args.principal });
      },
      async createOwnedRecordWithoutUser(ctx, args) {
        return await ctx.db.insert('ordinaryOwnedRecords', { value: args.value });
      },
      async patchOwnedRecordOwner(ctx, args) {
        return await ctx.db.patch('ordinaryOwnedRecords', 'record_1', { owner: args.owner });
      },
      async batchBindings(ctx, args) {
        await ctx.db.insert('identityBindings', { principal: ctx.auth.userId, sourceUserID: args.sourceUserID });
        return await ctx.db.insert('identityBindings', { principal: ctx.auth.userId, sourceUserID: args.secondSourceUserID });
      }
    };"#;
    let js_function = |name: &str, requirement: AuthRequirement| {
        let mut function = module(name, FunctionKind::Mutation, Some(requirement));
        function.runtime = FunctionRuntime::IbexModule(IbexModule {
            source: source.to_owned(),
            export: name.to_owned(),
        });
        function
    };
    let js_functions = [
        "createBinding",
        "patchBinding",
        "deleteBinding",
        "createPublicBinding",
        "createOwnedBinding",
        "createPermissionBinding",
        "patchOwnedBindingOwner",
        "patchOwnedRecordOwner",
        "batchBindings",
    ]
    .map(|name| js_function(name, AuthRequirement::Authenticated))
    .into_iter()
    .chain(
        [
            "createOwnedBindingWithoutUser",
            "createOwnedRecordWithoutUser",
        ]
        .map(|name| js_function(name, AuthRequirement::Public)),
    )
    .collect::<Vec<_>>();
    let host_plan = |name: &str, step: MutationStep| {
        let mut function = FunctionDefinition::new(
            name,
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                owner_write_checks: Vec::new(),
                steps: vec![step],
                return_value: None,
            })),
        );
        function.auth_requirement = Some(AuthRequirement::Authenticated);
        function
    };
    let permission_binding_insert = || MutationStep::Insert {
        table: "permissionIdentityBindings".to_owned(),
        values: BTreeMap::from([
            ("principal".to_owned(), ValueExpr::AuthUserId),
            (
                "sourceUserID".to_owned(),
                ValueExpr::Arg("sourceUserID".to_owned()),
            ),
        ]),
        bind_id_as: None,
    };
    let host_functions = vec![
        host_plan(
            "hostInsertBinding",
            MutationStep::Insert {
                table: "identityBindings".to_owned(),
                values: BTreeMap::from([
                    ("principal".to_owned(), ValueExpr::AuthUserId),
                    (
                        "sourceUserID".to_owned(),
                        ValueExpr::Arg("sourceUserID".to_owned()),
                    ),
                ]),
                bind_id_as: None,
            },
        ),
        host_plan(
            "hostPatchBinding",
            MutationStep::Patch {
                table: "identityBindings".to_owned(),
                id: ValueExpr::Literal(json!("binding_1")),
                values: BTreeMap::from([(
                    "sourceUserID".to_owned(),
                    ValueExpr::Arg("sourceUserID".to_owned()),
                )]),
            },
        ),
        host_plan(
            "hostDeleteBinding",
            MutationStep::Delete {
                table: "identityBindings".to_owned(),
                id: ValueExpr::Literal(json!("binding_1")),
            },
        ),
        host_plan(
            "hostDeleteWhereBindings",
            MutationStep::DeleteWhere {
                table: "identityBindings".to_owned(),
                filter: Vec::new(),
            },
        ),
        host_plan(
            "hostInsertEachBinding",
            MutationStep::InsertEach {
                table: "identityBindings".to_owned(),
                source: ValueExpr::Literal(json!([])),
                item_as: "item".to_owned(),
                values: BTreeMap::from([
                    ("principal".to_owned(), ValueExpr::AuthUserId),
                    (
                        "sourceUserID".to_owned(),
                        ValueExpr::Arg("sourceUserID".to_owned()),
                    ),
                ]),
            },
        ),
        host_plan(
            "hostInsertPublicBinding",
            MutationStep::Insert {
                table: "publicIdentityBindings".to_owned(),
                values: BTreeMap::from([
                    ("principal".to_owned(), ValueExpr::AuthUserId),
                    (
                        "sourceUserID".to_owned(),
                        ValueExpr::Arg("sourceUserID".to_owned()),
                    ),
                ]),
                bind_id_as: None,
            },
        ),
        host_plan(
            "hostInsertOwnedBinding",
            MutationStep::Insert {
                table: "ownedIdentityBindings".to_owned(),
                values: BTreeMap::from([
                    ("principal".to_owned(), ValueExpr::AuthUserId),
                    (
                        "sourceUserID".to_owned(),
                        ValueExpr::Arg("sourceUserID".to_owned()),
                    ),
                ]),
                bind_id_as: None,
            },
        ),
        host_plan("hostInsertPermissionBinding", permission_binding_insert()),
    ];
    let diagnostics = snapback.load_functions(FunctionManifest {
        functions: js_functions.into_iter().chain(host_functions).collect(),
        ..FunctionManifest::default()
    });
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != DiagnosticSeverity::Error)
    );
    for function_name in [
        "createBinding",
        "patchBinding",
        "deleteBinding",
        "createPublicBinding",
        "createOwnedBinding",
        "createPermissionBinding",
    ] {
        let error = snapback
            .invoke_mutation(
                function_name,
                input(Some("user_1"), json!({ "sourceUserID": "external-1" })),
            )
            .expect_err("every JavaScript identity-binding write must be sealed before policy");
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN",
            "unexpected JavaScript refusal for {function_name}"
        );
    }
    let error = snapback
        .invoke_mutation(
            "patchOwnedBindingOwner",
            input(Some("user_1"), json!({ "principal": "user_2" })),
        )
        .expect_err("the binding seal must precede owner immutability");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN"
    );
    let error = snapback
        .invoke_mutation(
            "createOwnedRecordWithoutUser",
            input(None, json!({ "value": "anonymous" })),
        )
        .expect_err("an ordinary owner insert without a principal must retain its policy code");
    assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_USER_MISSING");
    let error = snapback
        .invoke_mutation(
            "createOwnedBindingWithoutUser",
            input(None, json!({ "sourceUserID": "external-anonymous" })),
        )
        .expect_err("the binding seal must precede the owner-policy missing-principal refusal");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN"
    );
    let error = snapback
        .invoke_mutation(
            "patchOwnedRecordOwner",
            input(Some("user_1"), json!({ "owner": "user_2" })),
        )
        .expect_err("an ordinary owner patch must retain owner immutability");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_TABLE_WRITE_OWNER_IMMUTABLE"
    );
    let error = snapback
        .invoke_mutation(
            "batchBindings",
            input(
                Some("user_1"),
                json!({
                    "sourceUserID": "external-1",
                    "secondSourceUserID": "external-2",
                }),
            ),
        )
        .expect_err("a buffered write batch must be sealed at its shared commit primitive");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN"
    );
    for function_name in [
        "hostInsertBinding",
        "hostPatchBinding",
        "hostDeleteBinding",
        "hostDeleteWhereBindings",
        "hostInsertEachBinding",
        "hostInsertPublicBinding",
        "hostInsertOwnedBinding",
        "hostInsertPermissionBinding",
    ] {
        let error = snapback
            .invoke_mutation(
                function_name,
                input(Some("user_1"), json!({ "sourceUserID": "external-1" })),
            )
            .expect_err("every HostPlan identity-binding write form must be sealed");
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN",
            "unexpected refusal for {function_name}"
        );
    }
}

#[test]
fn cron_rejects_an_authenticated_target_at_manifest_load() {
    let mut action = module(
        "scheduledAction",
        FunctionKind::Action,
        Some(AuthRequirement::Authenticated),
    );
    action.required_capabilities.clear();
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    let diagnostics = snapback.load_functions(FunctionManifest {
        functions: vec![action],
        cron_jobs: vec![CronJobDefinition {
            name: "scheduled".to_owned(),
            schedule: CronSchedule {
                every_ms: Some(60_000),
                cron: None,
            },
            action: "scheduledAction".to_owned(),
            enabled: true,
            activation: CronActivationPolicy::default(),
            jitter_policy: CronJitterPolicy::default(),
            overlap_policy: CronOverlapPolicy::default(),
            retry_policy: CronRetryPolicy::default(),
            required_capabilities: Vec::new(),
            target_wakeup: None,
            source_span: None,
        }],
        ..FunctionManifest::default()
    });
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == "SNAPBACK_CRON_AUTH_REQUIREMENT_INVALID"
            && diagnostic.severity == DiagnosticSeverity::Error
    }));
}
