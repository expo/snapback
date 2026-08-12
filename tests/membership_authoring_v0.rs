use serde_json::Value;
use snapback::diagnostic::DiagnosticSeverity;
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, AuthRequirement, CTX_ANSWER_LEDGER_VERSION, CtxAnswerLedger, FieldManifest,
    FieldType, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime, HandlerInput,
    IbexModule, MembershipManifest, MembershipOp, MembershipProvenance, MembershipScope,
    MembershipTarget, MembershipTransition, SchemaManifest, TableManifest,
};

const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async join(ctx) {
    await ctx.membership.app_members.insert({ userId: ctx.auth.userId, role: 'member' });
    return null;
  },
  async rawJoin(ctx) {
    return await ctx.db.insert('app_members', { userId: ctx.auth.userId, role: 'member' });
  },
  async patchMember(ctx, args) {
    return await ctx.membership.app_members.patchSelf({ note: 'updated' });
  },
  async promote(ctx, args) {
    return await ctx.membership.app_members.setSelfRole('admin');
  },
  async leave(ctx, args) {
    return await ctx.membership.app_members.removeSelf();
  },
  async nestedJoin(ctx) {
    return await ctx.runMutation('join', {});
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
                FieldManifest {
                    name: "note".to_owned(),
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
                transitions: vec![
                    MembershipTransition {
                        op: MembershipOp::Insert,
                        by: vec!["none".to_owned()],
                        target: MembershipTarget::Own,
                        from: None,
                        to: Some(vec!["member".to_owned()]),
                        fields: None,
                    },
                    MembershipTransition {
                        op: MembershipOp::Patch,
                        by: vec!["self".to_owned()],
                        target: MembershipTarget::Own,
                        from: Some(vec!["member".to_owned()]),
                        to: None,
                        fields: Some(vec!["note".to_owned()]),
                    },
                    MembershipTransition {
                        op: MembershipOp::SetRole,
                        by: vec!["self".to_owned()],
                        target: MembershipTarget::Own,
                        from: Some(vec!["member".to_owned()]),
                        to: Some(vec!["admin".to_owned()]),
                        fields: None,
                    },
                    MembershipTransition {
                        op: MembershipOp::Remove,
                        by: vec!["self".to_owned()],
                        target: MembershipTarget::Own,
                        from: Some(vec!["admin".to_owned()]),
                        to: None,
                        fields: None,
                    },
                ],
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
            function("join", FunctionKind::Mutation),
            function("rawJoin", FunctionKind::Mutation),
            function("patchMember", FunctionKind::Mutation),
            function("promote", FunctionKind::Mutation),
            function("leave", FunctionKind::Mutation),
            function("nestedJoin", FunctionKind::Action),
        ],
        ..FunctionManifest::default()
    });
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != DiagnosticSeverity::Error),
        "function diagnostics: {diagnostics:?}"
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
fn generated_helper_runs_direct_nested_dry_run_and_replay_while_raw_stays_closed() {
    let mut direct = configured();
    direct
        .invoke_mutation("join", input("alice"))
        .expect("direct generated helper");
    let rows = direct
        .scan_table("app_members", 10, 0)
        .expect("direct rows");
    assert_eq!(rows.total, 1);
    assert_eq!(rows.rows[0]["userId"], "alice");
    direct
        .invoke_mutation("patchMember", input("alice"))
        .expect("declaration-bound patch");
    direct
        .invoke_mutation("promote", input("alice"))
        .expect("declaration-bound setRole");
    let rows = direct
        .scan_table("app_members", 10, 0)
        .expect("updated rows");
    assert_eq!(rows.rows[0]["note"], "updated");
    assert_eq!(rows.rows[0]["role"], "admin");
    direct
        .invoke_mutation("leave", input("alice"))
        .expect("declaration-bound remove");
    assert_eq!(
        direct
            .scan_table("app_members", 10, 0)
            .expect("removed rows")
            .total,
        0
    );

    let mut nested = configured();
    let output = nested.run_app_action("nestedJoin", input("bob"));
    assert!(output.ok, "nested generated helper: {output:?}");
    let rows = nested
        .scan_table("app_members", 10, 0)
        .expect("nested rows");
    assert_eq!(rows.total, 1);
    assert_eq!(rows.rows[0]["userId"], "bob");

    let mut dry_run = configured();
    let outcome = dry_run
        .dry_run_mutation("join", input("carol"))
        .expect("membership dry run");
    assert!(outcome.would_commit, "dry-run outcome: {outcome:?}");
    assert_eq!(
        dry_run
            .scan_table("app_members", 10, 0)
            .expect("dry-run rows")
            .total,
        0
    );

    let mut replay = configured();
    let mut replay_input = input("dave");
    replay_input.ctx_ledger = Some(CtxAnswerLedger {
        version: CTX_ANSWER_LEDGER_VERSION,
        ids: Vec::new(),
        now: 1,
        auth_fingerprint: None,
    });
    replay
        .invoke_mutation("join", replay_input)
        .expect("ledger replay preserves writer authority");
    assert_eq!(
        replay
            .scan_table("app_members", 10, 0)
            .expect("replay rows")
            .total,
        1
    );

    let mut raw = configured();
    let error = raw
        .invoke_mutation("rawJoin", input("mallory"))
        .expect_err("raw membership insert stays refused");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED"
    );
    assert_eq!(
        raw.scan_table("app_members", 10, 0)
            .expect("raw rows")
            .total,
        0
    );
}
