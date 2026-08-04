//! ENG-24597 artifact half: closed auth declarations, paired manifest
//! versions, exact target capabilities, and manifest-load refusals.

use serde_json::json;
use snapback::manifest::{
    AuthManifest, AuthMode, AuthRequirement, CapabilityManifest, CapabilityMaturity,
    CronJobDefinition, FilterExpr, FilterOp, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerPlan, IbexModule, QueryPlan, SNAPBACK_SCHEMA_VERSION,
    SNAPBACK_SESSIONS_SCHEMA_VERSION, SchemaManifest, TargetCapabilityId, ValueExpr,
};

fn host_query(name: &str) -> FunctionDefinition {
    FunctionDefinition::new(
        name,
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table: "todos".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        })),
    )
}

fn sessions_schema() -> SchemaManifest {
    SchemaManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        auth: Some(AuthManifest {
            mode: AuthMode::Sessions,
        }),
        required_capabilities: vec![TargetCapabilityId::AuthSessionsV1.to_string()],
        ..SchemaManifest::default()
    }
}

#[test]
fn closed_auth_values_and_legacy_defaults_are_exact() {
    let legacy = SchemaManifest::default();
    assert_eq!(legacy.effective_auth_mode(), AuthMode::Dev);
    legacy.validate_artifact().expect("v0 + absent dev auth");

    let legacy_function = host_query("legacy");
    assert_eq!(
        legacy_function.effective_auth_requirement(),
        AuthRequirement::OptionalUser
    );

    let mut schema_json = serde_json::to_value(SchemaManifest::default()).expect("schema JSON");
    schema_json["auth"] = json!({ "mode": "future" });
    assert!(serde_json::from_value::<SchemaManifest>(schema_json).is_err());
    assert!(
        serde_json::from_value::<AuthManifest>(json!({ "mode": "sessions", "future": true }))
            .is_err()
    );

    let mut function_json =
        serde_json::to_value(host_query("closedRequirement")).expect("function JSON");
    function_json["authRequirement"] = json!("future-user");
    assert!(serde_json::from_value::<FunctionDefinition>(function_json).is_err());
}

#[test]
fn schema_version_and_auth_mode_form_a_closed_pair() {
    sessions_schema()
        .validate_artifact()
        .expect("v1 + sessions + required auth capability");

    let mut v1_dev = SchemaManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        ..SchemaManifest::default()
    };
    assert_eq!(
        v1_dev.validate_artifact().unwrap_err().diagnostic.code,
        "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION"
    );

    v1_dev.schema_version = SNAPBACK_SCHEMA_VERSION.to_owned();
    v1_dev.auth = Some(AuthManifest {
        mode: AuthMode::Sessions,
    });
    assert_eq!(
        v1_dev.validate_artifact().unwrap_err().diagnostic.code,
        "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION"
    );

    let mut missing_auth_capability = sessions_schema();
    missing_auth_capability.required_capabilities.clear();
    assert_eq!(
        missing_auth_capability
            .validate_artifact()
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_CAPABILITY_UNSUPPORTED"
    );

    let dev_claims_sessions = SchemaManifest {
        required_capabilities: vec!["auth.sessions.v1".to_owned()],
        ..SchemaManifest::default()
    };
    assert_eq!(
        dev_claims_sessions
            .validate_artifact()
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_CAPABILITY_UNSUPPORTED"
    );
}

#[test]
fn authority_independent_is_hostplan_public_and_ambient_free_only() {
    let mut valid = host_query("publicTodos");
    valid.auth_requirement = Some(AuthRequirement::Public);
    valid.authority_independent = true;
    FunctionManifest {
        functions: vec![valid.clone()],
        ..FunctionManifest::default()
    }
    .validate_artifact()
    .expect("static public HostPlan is eligible");

    let mut not_public = valid.clone();
    not_public.auth_requirement = Some(AuthRequirement::OptionalUser);
    let error = FunctionManifest {
        functions: vec![not_public],
        ..FunctionManifest::default()
    }
    .validate_artifact()
    .unwrap_err();
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_AUTHORITY_INDEPENDENT_INVALID"
    );

    let mut ambient = valid.clone();
    let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &mut ambient.runtime else {
        unreachable!()
    };
    plan.filters.push(FilterExpr {
        field: "ownerId".to_owned(),
        op: FilterOp::Eq,
        value: ValueExpr::AuthUserId,
    });
    assert_eq!(
        FunctionManifest {
            functions: vec![ambient],
            ..FunctionManifest::default()
        }
        .validate_artifact()
        .unwrap_err()
        .diagnostic
        .code,
        "SNAPBACK_AUTHORITY_INDEPENDENT_INVALID"
    );

    let mut opaque = FunctionDefinition::new(
        "opaque",
        FunctionKind::LiveQuery,
        FunctionRuntime::IbexModule(IbexModule {
            source: "export function opaque() { return []; }".to_owned(),
            export: "opaque".to_owned(),
        }),
    );
    opaque.auth_requirement = Some(AuthRequirement::Public);
    opaque.authority_independent = true;
    assert_eq!(
        FunctionManifest {
            functions: vec![opaque],
            ..FunctionManifest::default()
        }
        .validate_artifact()
        .unwrap_err()
        .diagnostic
        .code,
        "SNAPBACK_AUTHORITY_INDEPENDENT_INVALID"
    );
}

#[test]
fn authenticated_cron_target_is_rejected_at_manifest_load() {
    let mut action = FunctionDefinition::new(
        "scheduled",
        FunctionKind::Action,
        FunctionRuntime::IbexModule(IbexModule {
            source: "export function scheduled() {}".to_owned(),
            export: "scheduled".to_owned(),
        }),
    );
    action.auth_requirement = Some(AuthRequirement::Authenticated);
    let job: CronJobDefinition = serde_json::from_value(json!({
        "name": "tick",
        "schedule": { "everyMs": 60_000 },
        "action": "scheduled"
    }))
    .expect("minimal cron declaration");
    let error = FunctionManifest {
        functions: vec![action],
        cron_jobs: vec![job],
        ..FunctionManifest::default()
    }
    .validate_artifact()
    .unwrap_err();
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_CRON_AUTH_REQUIREMENT_INVALID"
    );
}

#[test]
fn target_capability_registry_is_exact_and_fail_closed() {
    let local = CapabilityManifest::local_v0_declared();
    assert_eq!(
        local
            .supported_capabilities
            .iter()
            .map(|capability| capability.as_str())
            .collect::<Vec<_>>(),
        vec![
            "auth.sessions.v1",
            "bounded_children_v1",
            "cron",
            "cron_action_run_mutation",
            "host_plan_runtime",
            "ibex_ctx_db_host_bridge",
            "inline_handler_v1",
            "jobs_one_off_v1",
            "notifications.expoPushSeam",
            "live_subscriptions",
            "mutation_read_set_validation",
            "mixed_bundle_boot_v2",
            "permission_epoch_resync",
            "registered_bundle_boot_v1",
            "relational_query_v1",
            "sequence_allocation_v1",
            "snapshot_batch_v1",
            "single_table_v1",
            "migration_keyset_scan_v1",
            "full_text_search_v1",
            // @ref LLP 0132#capabilities-targets-and-staging — the local
            // target publishes exact vector search only behind experimental
            // acknowledgement.
            "vector_search_v1",
            "result_contract_v1",
            "settlement.bounded_skew",
            "args_contract_v1",
            "versioned_seed_install_v1",
            "versioned_seed_reset_v1",
            "write_activity_v1",
            // cdc3c41e (assets L1-12): the asset lifecycle joins the closed
            // registry; this inventory is the deliberate-review gate.
            "asset_lifecycle_v1",
            "asset_image_finalization_v1",
            "asset_image_pipeline_v1",
            "asset_reference_gc_v1",
            "asset_video_finalization_v1",
        ]
    );
    assert_eq!(TargetCapabilityId::ALL.len(), 34);
    for capability in TargetCapabilityId::ALL {
        assert_eq!(
            capability.as_str().parse::<TargetCapabilityId>(),
            Ok(capability)
        );
        if capability == TargetCapabilityId::BoundedResponseStreamV1 {
            assert_eq!(
                local
                    .require_capability(capability.as_str())
                    .expect_err("the static local target keeps process-live egress disabled")
                    .diagnostic
                    .code,
                "SNAPBACK_CAPABILITY_UNSUPPORTED"
            );
        } else if capability.maturity() != CapabilityMaturity::Stable {
            assert_eq!(
                local
                    .require_capability(capability.as_str())
                    .expect_err("experimental capabilities are not plain support")
                    .diagnostic
                    .code,
                "SNAPBACK_CAPABILITY_UNSUPPORTED"
            );
            if local.supported_capabilities.contains(&capability) {
                local
                    .require_capability_acknowledging(
                        capability.as_str(),
                        &std::collections::BTreeSet::from([capability]),
                    )
                    .expect("acknowledged experimental capability");
            }
        } else {
            local
                .require_capability(capability.as_str())
                .expect("local positive predicate");
        }
    }
    assert_eq!(
        local
            .require_capability("candidate.asserted.future")
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_CAPABILITY_UNSUPPORTED"
    );

    let conformance = CapabilityManifest::conformance_workerd_v8(json!({}));
    assert!(
        !conformance
            .supported_capabilities
            .contains(&TargetCapabilityId::IbexCtxDbHostBridge)
    );
    assert!(
        conformance
            .supported_capabilities
            .contains(&TargetCapabilityId::HostPlanRuntime)
    );

    let cloudflare = CapabilityManifest::cloudflare_do_sqlite_v8(json!({}));
    assert_eq!(
        cloudflare.supported_capabilities,
        vec![TargetCapabilityId::LiveSubscriptions]
    );

    let mut historical_json = serde_json::to_value(local).expect("capability JSON");
    let historical_object = historical_json.as_object_mut().expect("capability object");
    historical_object.remove("supportedCapabilities");
    historical_object.insert("capabilityGaps".to_owned(), json!([]));
    let historical: CapabilityManifest =
        serde_json::from_value(historical_json).expect("additive fields may be absent");
    assert!(historical.supported_capabilities.is_empty());
    assert_eq!(
        historical
            .require_capability("live_subscriptions")
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_CAPABILITY_UNSUPPORTED",
        "missing gaps never become positive evidence"
    );

    let mut foreign_json =
        serde_json::to_value(CapabilityManifest::local_v0_declared()).expect("capability JSON");
    foreign_json["supportedCapabilities"] = json!(["candidate.asserted.future"]);
    assert!(serde_json::from_value::<CapabilityManifest>(foreign_json).is_err());
}

#[test]
fn v1_function_capabilities_use_the_same_closed_registry() {
    let mut function = host_query("unknownCapability");
    function.required_capabilities = vec!["candidate.asserted.future".to_owned()];
    let error = FunctionManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        functions: vec![function],
        ..FunctionManifest::default()
    }
    .validate_artifact()
    .unwrap_err();
    assert_eq!(error.diagnostic.code, "SNAPBACK_CAPABILITY_UNSUPPORTED");
}
