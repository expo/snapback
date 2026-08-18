//! LLP 0053 retained/offline authorization admission profile.

use serde_json::json;
use sha2::{Digest, Sha256};
use snapback::manifest::{
    AuthRequirement, AuthorizationInputDimension, DependencySummary, FilterExpr, FilterOp,
    FunctionArgsContract, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionResultContract, FunctionRuntime, HandlerPlan, IbexModule, MutationPlan, QueryPlan,
    RelationalQueryPlan, ResultValueContract, ValueExpr, single_node_identity_v1,
};

fn query_plan(filters: Vec<FilterExpr>) -> QueryPlan {
    QueryPlan {
        table_visibility: None,
        table: "todos".to_owned(),
        filters,
        order: Vec::new(),
        limit: None,
        membership_filters: Vec::new(),
        indexed_by: None,
    }
}

fn exact_summary(auth_scope_field: Option<&str>) -> DependencySummary {
    DependencySummary {
        mode: Some("singleTable".to_owned()),
        primary_table: Some("todos".to_owned()),
        tables: vec!["todos".to_owned()],
        auth_scope_field: auth_scope_field.map(ToOwned::to_owned),
    }
}

fn user_scoped_query() -> FunctionDefinition {
    let mut function = FunctionDefinition::new(
        "myTodos",
        FunctionKind::Query,
        FunctionRuntime::HostPlan(HandlerPlan::Query(query_plan(vec![FilterExpr {
            field: "ownerId".to_owned(),
            op: FilterOp::Eq,
            value: ValueExpr::AuthUserId,
        }]))),
    );
    function.retainable = true;
    function.authorization_dependence = vec![AuthorizationInputDimension::UserId];
    function.read_set_summary = exact_summary(None);
    function
}

fn validate(function: FunctionDefinition) -> Result<(), Box<snapback::diagnostic::SnapbackError>> {
    let acknowledged_experimental_capabilities = if matches!(
        &function.runtime,
        FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(_))
    ) {
        vec!["relational_query_v1".to_owned()]
    } else {
        Vec::new()
    };
    FunctionManifest {
        functions: vec![function],
        acknowledged_experimental_capabilities,
        ..FunctionManifest::default()
    }
    .validate_artifact()
    .map_err(|error| Box::new(error.into()))
}

fn owner_visible_relational_query() -> FunctionDefinition {
    let corpus: serde_json::Value = serde_json::from_str(include_str!(
        "../../../tests/conformance/relational/corpus.v1.json"
    ))
    .expect("relational corpus JSON");
    let plan: RelationalQueryPlan = serde_json::from_value(corpus["cases"][0]["plan"].clone())
        .expect("owner-visible relational plan");
    let mut function = FunctionDefinition::new(
        "booksWithAuthors",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)),
    );
    function.retainable = true;
    function.required_capabilities = vec![
        "args_contract_v1".to_owned(),
        "live_subscriptions".to_owned(),
        "relational_query_v1".to_owned(),
        "result_contract_v1".to_owned(),
    ];
    let args_contract = FunctionArgsContract::default();
    function.args_contract_hash = Some(contract_hash(
        b"snapback:function-args:v2\n",
        &args_contract,
    ));
    function.args_contract = Some(args_contract);
    function.result_contract = FunctionResultContract::Records {
        record: ResultValueContract::Object {
            fields: Vec::new(),
            allow_extra: false,
        },
        rows: None,
    };
    function.result_contract_hash = Some(contract_hash(
        b"snapback:function-result:v1\n",
        &function.result_contract,
    ));
    function.authorization_dependence = vec![AuthorizationInputDimension::UserId];
    function.read_set_summary = DependencySummary {
        mode: Some("relational".to_owned()),
        primary_table: Some("books".to_owned()),
        tables: vec!["books".to_owned(), "authors".to_owned()],
        auth_scope_field: None,
    };
    function
}

fn contract_hash(prefix: &[u8], contract: &impl serde::Serialize) -> String {
    let value = serde_json::to_value(contract).expect("contract serializes");
    let canonical = snapback::rqs::jcs(&value).expect("contract has canonical JSON");
    let mut hash = Sha256::new();
    hash.update(prefix);
    hash.update(canonical.as_bytes());
    format!("sha256:{:x}", hash.finalize())
}

#[test]
fn immutable_user_identity_and_authority_independent_are_the_retainable_profiles() {
    validate(user_scoped_query()).expect("AuthUserId dependence is retainable");

    let mut kind_scoped = user_scoped_query();
    let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &mut kind_scoped.runtime else {
        unreachable!()
    };
    plan.filters.push(FilterExpr {
        field: "principalKind".to_owned(),
        op: FilterOp::Eq,
        value: ValueExpr::AuthKind,
    });
    kind_scoped.authorization_dependence = vec![
        AuthorizationInputDimension::Kind,
        AuthorizationInputDimension::UserId,
    ];
    validate(kind_scoped).expect("effective kind is immutable with userId");

    let mut live = user_scoped_query();
    live.kind = FunctionKind::LiveQuery;
    validate(live).expect("a user-scoped retainable live query uses the same profile");

    let mut scoped_by_summary = FunctionDefinition::new(
        "scopeField",
        FunctionKind::Query,
        FunctionRuntime::HostPlan(HandlerPlan::Query(query_plan(Vec::new()))),
    );
    scoped_by_summary.retainable = true;
    scoped_by_summary.authorization_dependence = vec![AuthorizationInputDimension::UserId];
    scoped_by_summary.read_set_summary = exact_summary(Some("ownerId"));
    validate(scoped_by_summary).expect("authScopeField is a userId declaration");

    let mut public = FunctionDefinition::new(
        "publicTodos",
        FunctionKind::Query,
        FunctionRuntime::HostPlan(HandlerPlan::Query(query_plan(Vec::new()))),
    );
    public.auth_requirement = Some(AuthRequirement::Public);
    public.authority_independent = true;
    public.retainable = true;
    public.read_set_summary = exact_summary(None);
    validate(public).expect("authority-independent public result is retainable");
}

#[test]
fn relational_owner_reclassification_rotates_identity_without_mutating_the_old_class() {
    let opaque = owner_visible_relational_query();
    validate(opaque.clone()).expect("legacy opaque relational class remains admitted");
    let opaque_identity = single_node_identity_v1(&opaque, None)
        .expect("opaque identity")
        .expect("relational identity");
    assert_eq!(
        opaque_identity.normalized_composite_plan["classification"]["retention"],
        "opaque-authorized-snapshot-v1"
    );

    let mut reclassified = opaque.clone();
    reclassified.retention_class = Some("result-transform-snapshot-v1".to_owned());
    validate(reclassified.clone()).expect("owner-reclassified result-transform class is admitted");
    let reclassified_identity = single_node_identity_v1(&reclassified, None)
        .expect("reclassified identity")
        .expect("relational identity");
    assert_eq!(
        reclassified_identity.normalized_composite_plan["classification"]["retention"],
        "result-transform-snapshot-v1"
    );
    assert_ne!(opaque_identity.plan_hash, reclassified_identity.plan_hash);

    let mut forged = opaque;
    forged.retention_class = Some("future-class".to_owned());
    let error = validate(forged).unwrap_err();
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_AUTH_UNDECLARABLE_RETENTION"
    );
    assert_eq!(error.diagnostic.details["reason"], "unknownRetentionClass");
}

#[test]
fn non_query_and_opaque_javascript_retention_fail_closed() {
    let mut mutation = FunctionDefinition::new(
        "badMutation",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: Vec::new(),
            return_value: None,
        })),
    );
    mutation.retainable = true;
    assert_eq!(
        validate(mutation).unwrap_err().diagnostic.code,
        "SNAPBACK_AUTH_UNDECLARABLE_RETENTION"
    );

    let mut javascript = FunctionDefinition::new(
        "opaqueJs",
        FunctionKind::Query,
        FunctionRuntime::IbexModule(IbexModule {
            source: "globalThis.__snapbackHandlers = { opaqueJs() { return []; } };".to_owned(),
            export: "opaqueJs".to_owned(),
        }),
    );
    javascript.retainable = true;
    javascript.authorization_dependence = vec![AuthorizationInputDimension::UserId];
    javascript.read_set_summary = exact_summary(None);
    let error = validate(javascript).unwrap_err();
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_AUTH_UNDECLARABLE_RETENTION"
    );
    assert_eq!(error.diagnostic.details["reason"], "opaqueJavaScript");
}

#[test]
fn session_provider_and_opaque_dimensions_are_refused() {
    for dimension in [
        AuthorizationInputDimension::ActorKind,
        AuthorizationInputDimension::IsDelegated,
        AuthorizationInputDimension::SessionId,
        AuthorizationInputDimension::Provider,
        AuthorizationInputDimension::Roles,
        AuthorizationInputDimension::IsAuthenticated,
        AuthorizationInputDimension::Opaque,
    ] {
        let mut function = user_scoped_query();
        function.authorization_dependence = vec![dimension];
        assert_eq!(
            validate(function).unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_UNDECLARABLE_RETENTION",
            "{dimension:?} must remain online-only"
        );
    }

    let mut missing = user_scoped_query();
    missing.authorization_dependence.clear();
    let error = validate(missing).unwrap_err();
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_AUTH_UNDECLARABLE_RETENTION"
    );
    assert_eq!(
        error.diagnostic.details["reason"],
        "authorizationDeclarationMismatch"
    );
}

#[test]
fn incomplete_or_unknown_read_summaries_are_never_retainable() {
    let cases = [
        DependencySummary::default(),
        DependencySummary {
            mode: Some("unknown".to_owned()),
            ..exact_summary(None)
        },
        DependencySummary {
            tables: Vec::new(),
            ..exact_summary(None)
        },
        DependencySummary {
            primary_table: Some("other".to_owned()),
            ..exact_summary(None)
        },
        DependencySummary {
            auth_scope_field: Some(String::new()),
            ..exact_summary(None)
        },
    ];
    for summary in cases {
        let mut function = user_scoped_query();
        function.read_set_summary = summary;
        let error = validate(function).unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_UNDECLARABLE_RETENTION"
        );
        assert_eq!(error.diagnostic.details["reason"], "incompleteReadSummary");
    }
}

#[test]
fn finite_retainable_queries_use_the_protected_mutable_input_diagnostics() {
    for (value, expected, input_kind) in [
        (
            ValueExpr::RuntimeNow,
            "SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY",
            "RuntimeNow",
        ),
        (
            ValueExpr::RuntimeId,
            "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED",
            "RuntimeId",
        ),
    ] {
        let mut function = user_scoped_query();
        let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &mut function.runtime else {
            unreachable!()
        };
        plan.filters[0].value = value;
        let error = validate(function).unwrap_err();
        assert_eq!(error.diagnostic.code, expected);
        assert_eq!(error.diagnostic.details["inputKind"], input_kind);
    }
}

#[test]
fn authorization_vocabulary_and_function_fields_are_closed() {
    let value = serde_json::to_value(user_scoped_query()).expect("function JSON");

    let mut unknown_dimension = value.clone();
    unknown_dimension["authorizationDependence"] = json!(["futureAuthority"]);
    assert!(serde_json::from_value::<FunctionDefinition>(unknown_dimension).is_err());

    let mut unknown_field = value;
    unknown_field["retianable"] = json!(true);
    assert!(serde_json::from_value::<FunctionDefinition>(unknown_field).is_err());
}
