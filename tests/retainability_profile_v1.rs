//! LLP 0053 retained/offline authorization admission profile.

use serde_json::json;
use snapback::manifest::{
    AuthRequirement, AuthorizationInputDimension, DependencySummary, FilterExpr, FilterOp,
    FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime, HandlerPlan, IbexModule,
    MutationPlan, QueryPlan, ValueExpr,
};

fn query_plan(filters: Vec<FilterExpr>) -> QueryPlan {
    QueryPlan {
        table: "todos".to_owned(),
        filters,
        order: Vec::new(),
        limit: None,
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

fn validate(function: FunctionDefinition) -> Result<(), snapback::diagnostic::SnapbackError> {
    FunctionManifest {
        functions: vec![function],
        ..FunctionManifest::default()
    }
    .validate_artifact()
}

#[test]
fn user_id_and_authority_independent_are_the_only_retainable_profiles() {
    validate(user_scoped_query()).expect("AuthUserId dependence is retainable");

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
fn non_query_and_opaque_javascript_retention_fail_closed() {
    let mut mutation = FunctionDefinition::new(
        "badMutation",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
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
