use super::*;
use serde_json::json;

fn ask_budgets_fixture() -> ApiAskBudgets {
    ApiAskBudgets {
        per_request: ApiAskPerRequestBudget {
            max_tokens: 100,
            max_steps: 4,
            max_wall_ms: 5_000,
        },
        per_principal_day: ApiAskPerPrincipalDayBudget { max_tokens: 1_000 },
        per_integration_day: Some(ApiAskTokenBudget { max_tokens: 500 }),
        app_monthly: ApiAskTokenBudget { max_tokens: 10_000 },
        result_volume: ApiAskResultVolumeBudget {
            max_bytes: 10_000,
            max_rows: 100,
            per_principal_day_bytes: 100_000,
        },
    }
}

fn ask_schema_fixture() -> SchemaManifest {
    SchemaManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        auth: Some(AuthManifest {
            mode: AuthMode::Sessions,
            agents: Some(AgentsManifest::explicit(
                AgentsMode::Disabled,
                InvitedBy::Users,
            )),
            password_identifier_mode: None,
            password_minimum_length: None,
        }),
        api: Some(ApiManifest {
            enabled: true,
            ask: Some(ApiAskManifest {
                enabled: true,
                billing: ApiAskBilling::CallerKey,
                model: Some(ApiAskModelManifest {
                    provider: "openai-compatible".to_owned(),
                    model: "stub".to_owned(),
                    secret: None,
                }),
            }),
            ..ApiManifest::default()
        }),
        required_capabilities: vec!["auth.sessions.v1".to_owned()],
        ..SchemaManifest::default()
    }
}

#[test]
fn ask_requires_complete_budgets_but_budgets_are_valid_alone() {
    let mut ask = ask_schema_fixture();
    let error = ask
        .validate_artifact()
        .expect_err("enabled ask without budgets must fail closed");
    assert_eq!(error.diagnostic.code, "SNAPBACK_API_ASK_BUDGETS_REQUIRED");
    assert!(error.diagnostic.message.contains("perRequest"));
    assert!(error.diagnostic.message.contains("resultVolume"));

    ask.api.as_mut().unwrap().budgets = Some(ApiBudgetsManifest {
        ask: Some(ask_budgets_fixture()),
    });
    ask.validate_artifact().expect("ask plus complete budgets");

    ask.api.as_mut().unwrap().ask = None;
    ask.validate_artifact()
        .expect("budgets alone are inert and valid");
}

#[test]
fn ask_billing_shapes_and_unknown_keys_are_closed() {
    let caller: ApiAskManifest = serde_json::from_value(json!({
        "enabled": true,
        "billing": "caller-key",
        "model": { "provider": "openai-compatible", "model": "stub" }
    }))
    .expect("caller-key shape");
    assert_eq!(caller.billing, ApiAskBilling::CallerKey);
    let app: ApiAskManifest = serde_json::from_value(json!({
        "enabled": true,
        "billing": "app",
        "model": { "provider": "openai-compatible", "model": "stub", "secret": "providerKey" }
    }))
    .expect("app-paid shape");
    assert_eq!(app.billing, ApiAskBilling::App);
    assert!(
        serde_json::from_value::<ApiAskManifest>(json!({
            "enabled": true,
            "billing": "app",
            "mutationTools": true
        }))
        .is_err()
    );

    let mut caller_with_app_secret = ask_schema_fixture();
    caller_with_app_secret.api.as_mut().unwrap().budgets = Some(ApiBudgetsManifest {
        ask: Some(ask_budgets_fixture()),
    });
    caller_with_app_secret
        .api
        .as_mut()
        .unwrap()
        .ask
        .as_mut()
        .unwrap()
        .model
        .as_mut()
        .unwrap()
        .secret = Some("providerKey".to_owned());
    let error = caller_with_app_secret
        .validate_artifact()
        .expect_err("caller-key billing must not open the app-secret seam");
    assert_eq!(error.diagnostic.code, "SNAPBACK_API_ASK_MODEL_INVALID");
}
#[test]
fn vector_capability_is_exact_on_local_and_gap_only_everywhere_else() {
    let id = TargetCapabilityId::VectorSearchV1;
    assert_eq!(serde_json::to_value(id).unwrap(), json!("vector_search_v1"));
    assert_eq!(
        serde_json::from_value::<TargetCapabilityId>(json!("vector_search_v1")).unwrap(),
        id
    );
    assert_eq!(id.maturity(), CapabilityMaturity::Experimental);

    for manifest in [
        CapabilityManifest::local_v0_declared(),
        CapabilityManifest::local_v0_instance(Vec::new(), true),
    ] {
        assert!(
            manifest.supported_capabilities.contains(&id),
            "{} must publish the qualified local exact-vector profile",
            manifest.target_profile_id,
        );
        assert_eq!(
            manifest.capability_maturity.get(&id),
            Some(&CapabilityMaturity::Experimental),
        );
        assert_eq!(
            manifest.vector_search,
            Some(VectorSearchFactsV1::local_v1()),
        );
        assert!(
            !manifest
                .capability_gaps
                .iter()
                .any(|gap| gap == "vector_search_v1"),
        );
        assert_eq!(
            manifest
                .require_capability("vector_search_v1")
                .expect_err("experimental vector support requires acknowledgment")
                .diagnostic
                .code,
            "SNAPBACK_CAPABILITY_UNSUPPORTED",
        );
        manifest
            .require_capability_acknowledging(
                "vector_search_v1",
                &BTreeSet::from([TargetCapabilityId::VectorSearchV1]),
            )
            .expect("acknowledged experimental vector support admits");
    }

    for manifest in [
        CapabilityManifest::remote_service_sqlite_ibex_declared(),
        CapabilityManifest::conformance_workerd_v8(json!({})),
        CapabilityManifest::cloudflare_do_sqlite_v8(json!({})),
    ] {
        assert!(!id.is_supported_by(&manifest, TargetCapabilityFacts::default()));
        assert!(!manifest.supported_capabilities.contains(&id));
        assert!(!manifest.capability_maturity.contains_key(&id));
        assert!(manifest.vector_search.is_none());
        assert!(
            manifest
                .capability_gaps
                .iter()
                .any(|gap| gap == "vector_search_v1"),
            "{} must publish the exact structured vector GAP",
            manifest.target_profile_id
        );
    }

    let local = CapabilityManifest::local_v0_declared();
    let mut missing_registration = TargetCapabilityFacts::local_auth_aware();
    missing_registration.vector_search_v1_registered = false;
    assert!(!id.is_supported_by(&local, missing_registration));

    let mut tampered = local.clone();
    tampered
        .vector_search
        .as_mut()
        .expect("local vector facts")
        .accelerator = "ann".to_owned();
    assert!(!id.is_supported_by(&tampered, TargetCapabilityFacts::local_auth_aware(),));
}
#[test]
fn bounded_stream_capability_requires_both_implementation_and_live_egress() {
    let declared = CapabilityManifest::local_v0_declared();
    assert!(!declared.outbound_actions);
    assert!(
        !declared
            .supported_capabilities
            .contains(&TargetCapabilityId::BoundedResponseStreamV1)
    );

    let enabled = CapabilityManifest::local_v0_instance(Vec::new(), true);
    assert!(enabled.outbound_actions);
    assert!(
        enabled
            .supported_capabilities
            .contains(&TargetCapabilityId::BoundedResponseStreamV1)
    );
}

// @ref LLP 0080#7-generated-authoring-surface — a maintained projection
// has no function carrier: codegen surfaces its relational-engine
// dependence as a schema-level `relational_query_v1` requirement, and
// the load path chains schema-level requirements through the same
// `require_capabilities` gate as function requirements. A target
// without the relational engine therefore refuses the projection
// bundle at admission, never as a late activation surprise.
#[test]
fn projection_schema_requirement_refuses_without_relational_support() {
    let supported = CapabilityManifest::local_v0_declared();
    supported
        .require_capability("relational_query_v1")
        .expect("the local target serves projection-carrying bundles");

    let mut stripped = CapabilityManifest::local_v0_declared();
    stripped
        .supported_capabilities
        .retain(|id| *id != TargetCapabilityId::RelationalQueryV1);
    let refusal = stripped
        .require_capabilities(["relational_query_v1"], &BTreeSet::new())
        .expect_err("a projection bundle refuses on a target without the relational engine");
    assert_eq!(refusal.diagnostic.code, "SNAPBACK_CAPABILITY_UNSUPPORTED");
    assert_eq!(
        refusal.diagnostic.details["capability"],
        "relational_query_v1"
    );
}

// @ref LLP 0058#capability-maturity — the maturity map annotates the
// emitted support set with every non-stable id; stable ids never appear.
// With `relational_query_v1` and `migration_keyset_scan_v1` promoted as
// LLP 0080/0081's Implemented act (2026-07-26), the source-published LLP
// 0104 pair joins the explicitly experimental 0101/0103/0107 contracts.
#[test]
fn capability_maturity_promotions_hold_and_admission_stays_fail_closed() {
    let disabled = CapabilityManifest::local_v0_declared();
    // Both promoted ids stay supported by the local runtime…
    assert!(
        disabled
            .supported_capabilities
            .contains(&TargetCapabilityId::RelationalQueryV1)
    );
    assert!(
        disabled
            .supported_capabilities
            .contains(&TargetCapabilityId::MigrationKeysetScanV1)
    );
    let experimental = BTreeMap::from([
        (
            TargetCapabilityId::BoundedChildrenV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::BoundedBatchReadsV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::InlineHandlerV1,
            CapabilityMaturity::Experimental,
        ),
        // LLP 0070 first slice: experimental while the RFC is Draft (its
        // claim boundary bars any stable/capability-class reading).
        (
            TargetCapabilityId::JobsOneOffV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::ConnectedClientPredicate,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::OfflineMutationReplay,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::MixedBundleBootV2,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::RegisteredBundleBootV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::SequenceAllocationV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::SnapshotBatchV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::SnapshotBatchV2,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::SingleTableV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::VectorSearchV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::ResultContractV1,
            CapabilityMaturity::Experimental,
        ),
        // @ref LLP 0211#capability-and-maturity-the-llp-0134-publication-contract
        //   — advertised by the reviewed support flip (author acceptance,
        //   2026-08-10).
        (
            TargetCapabilityId::StructuredStoredValueV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::ArgsContractV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::VersionedSeedInstallV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::VersionedSeedResetV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::WriteActivityV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::AssetLifecycleV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::MediaRefProjectionV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::MediaCollectionV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::MediaCommandV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::AssetImageFinalizationV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::AssetImagePipelineV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::AssetReferenceGcV1,
            CapabilityMaturity::Experimental,
        ),
        (
            TargetCapabilityId::AssetVideoFinalizationV1,
            CapabilityMaturity::Experimental,
        ),
    ]);
    assert_eq!(disabled.capability_maturity, experimental);
    assert!(
        disabled
            .supported_capabilities
            .contains(&TargetCapabilityId::SequenceAllocationV1)
    );
    assert!(
        !disabled
            .capability_gaps
            .iter()
            .any(|gap| gap == "sequence_allocation_v1")
    );
    assert!(
        disabled
            .supported_capabilities
            .contains(&TargetCapabilityId::BoundedChildrenV1)
            && disabled
                .supported_capabilities
                .contains(&TargetCapabilityId::WriteActivityV1),
        "the reviewed embedded local carrier publishes the atomic relation/activity pair",
    );
    assert!(
        disabled
            .supported_capabilities
            .contains(&TargetCapabilityId::RegisteredBundleBootV1),
        "registered bundle boot is advertised only by the proven target implementation",
    );
    let enabled = CapabilityManifest::local_v0_instance(Vec::new(), true);
    assert!(
        enabled
            .supported_capabilities
            .contains(&TargetCapabilityId::BoundedResponseStreamV1)
    );
    assert_eq!(enabled.capability_maturity, experimental);

    // Serialization retains the experimental advertisement gate.
    let plain = serde_json::to_value(&enabled).expect("serialize");
    assert!(plain.get("capabilityMaturity").is_some());
    let round_tripped: CapabilityManifest =
        serde_json::from_value(plain).expect("deserialize maturity map");
    assert_eq!(round_tripped.capability_maturity, experimental);

    // Promoted ids are plain support: they admit with NO acknowledgment
    // at all — before 2026-07-26 the first two refusals below were the
    // experimental-gate witnesses.
    enabled
        .require_capability("relational_query_v1")
        .expect("promoted relational support admits without acknowledgment");
    enabled
        .require_capability("migration_keyset_scan_v1")
        .expect("promoted migration-scan support admits without acknowledgment");
    enabled
        .require_capability("bounded_response_stream_v1")
        .expect("stable support admits without acknowledgment");
    assert_eq!(
        enabled
            .require_capability("inline_handler_v1")
            .expect_err("experimental support requires an artifact acknowledgment")
            .diagnostic
            .code,
        "SNAPBACK_CAPABILITY_UNSUPPORTED"
    );
    assert_eq!(
        enabled
            .require_capability("bounded_children_v1")
            .expect_err("experimental local publication requires an artifact acknowledgment")
            .diagnostic
            .code,
        "SNAPBACK_CAPABILITY_UNSUPPORTED"
    );

    // Pre-promotion acknowledgments for stable ids remain harmless, while
    // the current experimental ids admit only through the explicit gate.
    let acknowledged = CapabilityManifest::parse_acknowledged_capabilities([
        "inline_handler_v1",
        "bounded_children_v1",
        "relational_query_v1",
        "bounded_response_stream_v1",
        "live_subscriptions",
        "sequence_allocation_v1",
        "write_activity_v1",
        "not.a.known.capability",
    ]);
    enabled
        .require_capability_acknowledging("relational_query_v1", &acknowledged)
        .expect("a surviving pre-promotion acknowledgment stays a no-op");
    enabled
        .require_capability_acknowledging("live_subscriptions", &acknowledged)
        .expect("acknowledging a stable id is a no-op");
    enabled
        .require_capability_acknowledging("inline_handler_v1", &acknowledged)
        .expect("acknowledged experimental support admits");
    enabled
        .require_capability_acknowledging("bounded_children_v1", &acknowledged)
        .expect("acknowledged bounded-children support admits");
    enabled
        .require_capability_acknowledging("write_activity_v1", &acknowledged)
        .expect("acknowledged write/activity support admits");
    enabled
        .require_capability_acknowledging("sequence_allocation_v1", &acknowledged)
        .expect("acknowledged experimental sequence support admits");
    assert_eq!(
        disabled
            .require_capability_acknowledging("bounded_response_stream_v1", &acknowledged)
            .expect_err("acknowledgment cannot mint support")
            .diagnostic
            .code,
        "SNAPBACK_CAPABILITY_UNSUPPORTED"
    );
}

// @ref LLP 0134#7-the-grandfather-set — the reserved direct route is a
// closed five-id eligibility set and grants no maturity by itself.
#[test]
fn capability_maturity_grandfather_set_is_closed_and_still_experimental() {
    assert_eq!(
        TargetCapabilityId::GRANDFATHERED_DIRECT_PROMOTION_IDS,
        [
            TargetCapabilityId::InlineHandlerV1,
            TargetCapabilityId::ResultContractV1,
            TargetCapabilityId::RegisteredBundleBootV1,
            TargetCapabilityId::VersionedSeedInstallV1,
            TargetCapabilityId::VersionedSeedResetV1,
        ]
    );
    for id in TargetCapabilityId::ALL {
        assert_eq!(
            id.is_grandfathered_direct_promotion_eligible(),
            TargetCapabilityId::GRANDFATHERED_DIRECT_PROMOTION_IDS.contains(&id),
        );
        if id.is_grandfathered_direct_promotion_eligible() {
            assert_eq!(id.maturity(), CapabilityMaturity::Experimental);
        }
    }
}

#[test]
fn sequence_publication_is_experimental_local_source_only() {
    assert!(local_sequence_allocation_publication_verified());
    for manifest in [
        CapabilityManifest::local_v0(Vec::new()),
        CapabilityManifest::local_v0_instance(Vec::new(), true),
    ] {
        assert!(
            manifest
                .supported_capabilities
                .contains(&TargetCapabilityId::SequenceAllocationV1)
        );
        assert!(
            !manifest
                .capability_gaps
                .iter()
                .any(|gap| gap == "sequence_allocation_v1")
        );
        assert_eq!(
            manifest
                .capability_maturity
                .get(&TargetCapabilityId::SequenceAllocationV1),
            Some(&CapabilityMaturity::Experimental),
            "LLP 0113 publication cannot mint stable maturity",
        );
    }
    for manifest in [
        CapabilityManifest::remote_service_sqlite_ibex_declared(),
        CapabilityManifest::conformance_workerd_v8(json!({})),
        CapabilityManifest::cloudflare_do_sqlite_v8(json!({})),
    ] {
        assert!(
            !manifest
                .supported_capabilities
                .contains(&TargetCapabilityId::SequenceAllocationV1),
            "{} must not inherit the local sequence publication",
            manifest.target_profile_id,
        );
        assert!(
            manifest
                .capability_gaps
                .iter()
                .any(|gap| gap == "sequence_allocation_v1"),
            "{} must carry the structured sequence GAP",
            manifest.target_profile_id,
        );
        assert!(
            !manifest
                .capability_maturity
                .contains_key(&TargetCapabilityId::SequenceAllocationV1),
            "unsupported ids do not receive maturity annotations",
        );
    }

    let withheld = CapabilityManifest::local_v0_with_facts(
        Vec::new(),
        TargetCapabilityFacts::local_auth_aware().with_sequence_allocation_publication_withheld(),
    );
    assert!(
        !withheld
            .supported_capabilities
            .contains(&TargetCapabilityId::SequenceAllocationV1)
    );
    assert!(
        withheld
            .capability_gaps
            .iter()
            .any(|gap| gap == "sequence_allocation_v1")
    );
}

#[test]
fn sequence_publication_tamper_and_package_substitutions_fail_closed() {
    let mut tampered_carrier = LOCAL_SEQUENCE_ALLOCATION_PUBLICATION_BYTES.to_vec();
    tampered_carrier[0] ^= 1;
    assert!(!local_sequence_allocation_publication_verified_for(
        crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
        &tampered_carrier,
        LOCAL_SEQUENCE_ALLOCATION_PUBLICATION_SHA256,
        LOCAL_SEQUENCE_ALLOCATION_QUALIFICATION_RECEIPT_BYTES,
    ));
    let mut stale_receipt = LOCAL_SEQUENCE_ALLOCATION_QUALIFICATION_RECEIPT_BYTES.to_vec();
    stale_receipt.push(b'\n');
    assert!(!local_sequence_allocation_publication_verified_for(
        crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
        LOCAL_SEQUENCE_ALLOCATION_PUBLICATION_BYTES,
        LOCAL_SEQUENCE_ALLOCATION_PUBLICATION_SHA256,
        &stale_receipt,
    ));
    assert!(!local_sequence_allocation_publication_verified_for(
        crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE,
        LOCAL_SEQUENCE_ALLOCATION_PUBLICATION_BYTES,
        LOCAL_SEQUENCE_ALLOCATION_PUBLICATION_SHA256,
        LOCAL_SEQUENCE_ALLOCATION_QUALIFICATION_RECEIPT_BYTES,
    ));
    let package = CapabilityManifest::local_v0_with_facts(
        Vec::new(),
        TargetCapabilityFacts::local_auth_aware_for_distribution(
            crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE,
        ),
    );
    assert!(
        !package
            .supported_capabilities
            .contains(&TargetCapabilityId::SequenceAllocationV1)
    );
    assert!(
        package
            .capability_gaps
            .iter()
            .any(|gap| gap == "sequence_allocation_v1")
    );
    assert_eq!(
        TargetCapabilityId::SequenceAllocationV1.maturity(),
        CapabilityMaturity::Experimental,
    );
}

#[test]
fn single_table_publication_is_experimental_and_evidence_gated() {
    let published = local_persistent_store_publication_verified();
    assert_eq!(
        published,
        local_persistent_store_receipts_qualified(
            LOCAL_PERSISTENT_STORE_CARRIER_EXIT_RECEIPT_BYTES,
            LOCAL_PERSISTENT_STORE_TRIAGE_MOVE1_RECEIPT_BYTES,
            LOCAL_PERSISTENT_STORE_TRIAGE_BUDGET_RECEIPT_BYTES,
        ),
        "the exact embedded carrier chain publishes iff its receipts qualify",
    );
    let mut qualified_exit: Value =
        serde_json::from_slice(LOCAL_PERSISTENT_STORE_CARRIER_EXIT_RECEIPT_BYTES)
            .expect("carrier exit fixture parses");
    qualified_exit["summary"]["pass"] = json!(17);
    qualified_exit["summary"]["gap"] = json!(0);
    let triage = qualified_exit["legs"]
        .as_array_mut()
        .and_then(|legs| {
            legs.iter_mut()
                .find(|leg| leg["leg"] == "footprint-hydration-triage")
        })
        .expect("carrier exit carries the Triage leg");
    triage["status"] = json!("PASS");
    let fleet = qualified_exit["legs"]
        .as_array_mut()
        .and_then(|legs| {
            legs.iter_mut()
                .find(|leg| leg["leg"] == "footprint-hydration-fleet")
        })
        .expect("carrier exit carries the Fleet leg");
    fleet["status"] = json!("PASS");
    assert!(local_persistent_store_receipts_qualified(
        &serde_json::to_vec(&qualified_exit).expect("qualified fixture serializes"),
        LOCAL_PERSISTENT_STORE_TRIAGE_MOVE1_RECEIPT_BYTES,
        LOCAL_PERSISTENT_STORE_TRIAGE_BUDGET_RECEIPT_BYTES,
    ));
    assert_eq!(
        TargetCapabilityId::SingleTableV1.maturity(),
        CapabilityMaturity::Experimental,
    );
    for manifest in [
        CapabilityManifest::local_v0_declared(),
        CapabilityManifest::local_v0_instance(Vec::new(), true),
    ] {
        assert_eq!(
            manifest
                .supported_capabilities
                .contains(&TargetCapabilityId::SingleTableV1),
            published,
        );
        assert_eq!(
            manifest
                .capability_gaps
                .iter()
                .any(|gap| gap == "single_table_v1"),
            !published,
        );
    }
    for manifest in [
        CapabilityManifest::remote_service_sqlite_ibex_declared(),
        CapabilityManifest::conformance_workerd_v8(json!({})),
        CapabilityManifest::cloudflare_do_sqlite_v8(json!({})),
    ] {
        assert!(
            !manifest
                .supported_capabilities
                .contains(&TargetCapabilityId::SingleTableV1),
            "{} must not inherit contributor-source publication",
            manifest.target_profile_id,
        );
        assert!(
            manifest
                .capability_gaps
                .iter()
                .any(|gap| gap == "single_table_v1")
        );
    }
}

const PACKAGED_STORE_TEST_GIT_COMMIT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn packaged_store_test_receipt_bytes() -> Vec<u8> {
    let identity = crate::identity::BinaryIdentity {
        crate_version: env!("CARGO_PKG_VERSION").to_owned(),
        git_commit: PACKAGED_STORE_TEST_GIT_COMMIT.to_owned(),
        git_dirty: false,
        build_profile: "release".to_owned(),
        startup_nonce: "test-nonce".to_owned(),
    };
    let receipt = stamp_packaged_store_qualification_receipt(
        "2026-08-06",
        &identity,
        crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE,
        vec![PackagedStoreClosureEntryV1 {
            name: "@expo/snapback-client".to_owned(),
            version: "0.1.11".to_owned(),
            sha256: format!("sha256:{}", "1".repeat(64)),
        }],
        PackagedStoreQualificationSuiteV1 {
            id: PACKAGED_STORE_QUALIFICATION_SUITE_ID.to_owned(),
            pass: 3,
            fail: 0,
            skipped: 0,
        },
    )
    .expect("clean public-package fixture stamps");
    serde_json::to_vec(&receipt).expect("packaged-store receipt serializes")
}

fn public_packaged_store_verified(
    receipt: Option<&[u8]>,
    git_commit: &str,
    git_dirty: bool,
    build_profile: &str,
) -> bool {
    local_persistent_store_publication_verified_for(
        crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE,
        git_commit,
        git_dirty,
        build_profile,
        receipt,
        LOCAL_PERSISTENT_STORE_PUBLICATION_BYTES,
        LOCAL_PERSISTENT_STORE_PUBLICATION_ANCHOR_BYTES,
        LOCAL_PERSISTENT_STORE_CARRIER_EXIT_RECEIPT_BYTES,
        LOCAL_PERSISTENT_STORE_TRIAGE_MOVE1_RECEIPT_BYTES,
        LOCAL_PERSISTENT_STORE_TRIAGE_BUDGET_RECEIPT_BYTES,
    )
}

#[test]
fn single_table_publication_tamper_and_package_substitutions_fail_closed() {
    let valid_receipt = packaged_store_test_receipt_bytes();
    // @ref LLP 0110#single-table-public-package-advertisement-amendment--2026-08-06
    // — the amended positive requires a valid receipt and clean release
    // identity in addition to the intact contributor carrier chain.
    assert!(public_packaged_store_verified(
        Some(&valid_receipt),
        PACKAGED_STORE_TEST_GIT_COMMIT,
        false,
        "release",
    ));
    // @ref LLP 0110#single-table-public-package-advertisement-amendment--2026-08-06
    // — public packages without the qualification receipt still fail.
    assert!(!public_packaged_store_verified(
        None,
        PACKAGED_STORE_TEST_GIT_COMMIT,
        false,
        "release",
    ));

    let mut tampered_carrier = LOCAL_PERSISTENT_STORE_PUBLICATION_BYTES.to_vec();
    tampered_carrier[0] ^= 1;
    assert!(!local_persistent_store_publication_verified_for(
        crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
        "ignored",
        true,
        "debug",
        None,
        &tampered_carrier,
        LOCAL_PERSISTENT_STORE_PUBLICATION_ANCHOR_BYTES,
        LOCAL_PERSISTENT_STORE_CARRIER_EXIT_RECEIPT_BYTES,
        LOCAL_PERSISTENT_STORE_TRIAGE_MOVE1_RECEIPT_BYTES,
        LOCAL_PERSISTENT_STORE_TRIAGE_BUDGET_RECEIPT_BYTES,
    ));
    let mut tampered_anchor = LOCAL_PERSISTENT_STORE_PUBLICATION_ANCHOR_BYTES.to_vec();
    tampered_anchor[0] ^= 1;
    assert!(!local_persistent_store_publication_verified_for(
        crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
        "ignored",
        true,
        "debug",
        None,
        LOCAL_PERSISTENT_STORE_PUBLICATION_BYTES,
        &tampered_anchor,
        LOCAL_PERSISTENT_STORE_CARRIER_EXIT_RECEIPT_BYTES,
        LOCAL_PERSISTENT_STORE_TRIAGE_MOVE1_RECEIPT_BYTES,
        LOCAL_PERSISTENT_STORE_TRIAGE_BUDGET_RECEIPT_BYTES,
    ));
    let anchor_mutations: [fn(&mut Value); 4] = [
        |anchor: &mut Value| anchor["state"] = json!("withheld"),
        |anchor: &mut Value| anchor["capabilityId"] = json!("bounded_children_v1"),
        |anchor: &mut Value| anchor["carrierSha256"] = json!(format!("sha256:{}", "0".repeat(64))),
        |anchor: &mut Value| anchor["unexpected"] = json!(true),
    ];
    for mutate in anchor_mutations {
        let mut anchor: Value =
            serde_json::from_slice(LOCAL_PERSISTENT_STORE_PUBLICATION_ANCHOR_BYTES)
                .expect("persistent-store publication anchor parses");
        mutate(&mut anchor);
        assert!(!local_persistent_store_publication_verified_for(
            crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
            "ignored",
            true,
            "debug",
            None,
            LOCAL_PERSISTENT_STORE_PUBLICATION_BYTES,
            &serde_json::to_vec(&anchor).expect("tampered anchor serializes"),
            LOCAL_PERSISTENT_STORE_CARRIER_EXIT_RECEIPT_BYTES,
            LOCAL_PERSISTENT_STORE_TRIAGE_MOVE1_RECEIPT_BYTES,
            LOCAL_PERSISTENT_STORE_TRIAGE_BUDGET_RECEIPT_BYTES,
        ));
        assert!(!local_persistent_store_publication_verified_for(
            crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE,
            PACKAGED_STORE_TEST_GIT_COMMIT,
            false,
            "release",
            Some(&valid_receipt),
            LOCAL_PERSISTENT_STORE_PUBLICATION_BYTES,
            &serde_json::to_vec(&anchor).expect("tampered anchor serializes"),
            LOCAL_PERSISTENT_STORE_CARRIER_EXIT_RECEIPT_BYTES,
            LOCAL_PERSISTENT_STORE_TRIAGE_MOVE1_RECEIPT_BYTES,
            LOCAL_PERSISTENT_STORE_TRIAGE_BUDGET_RECEIPT_BYTES,
        ));
    }
    assert!(!local_persistent_store_publication_verified_for(
        crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE,
        PACKAGED_STORE_TEST_GIT_COMMIT,
        false,
        "release",
        Some(&valid_receipt),
        &tampered_carrier,
        LOCAL_PERSISTENT_STORE_PUBLICATION_ANCHOR_BYTES,
        LOCAL_PERSISTENT_STORE_CARRIER_EXIT_RECEIPT_BYTES,
        LOCAL_PERSISTENT_STORE_TRIAGE_MOVE1_RECEIPT_BYTES,
        LOCAL_PERSISTENT_STORE_TRIAGE_BUDGET_RECEIPT_BYTES,
    ));

    let mut tampered_receipt = valid_receipt.clone();
    tampered_receipt[0] ^= 1;
    assert!(!public_packaged_store_verified(
        Some(&tampered_receipt),
        PACKAGED_STORE_TEST_GIT_COMMIT,
        false,
        "release",
    ));
    assert!(!public_packaged_store_verified(
        Some(&valid_receipt),
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        false,
        "release",
    ));
    assert!(!public_packaged_store_verified(
        Some(&valid_receipt),
        PACKAGED_STORE_TEST_GIT_COMMIT,
        true,
        "release",
    ));
    assert!(!public_packaged_store_verified(
        Some(&valid_receipt),
        PACKAGED_STORE_TEST_GIT_COMMIT,
        false,
        "debug",
    ));

    let receipt_mutations: [fn(&mut Value); 17] = [
        |receipt| receipt["schemaVersion"] = json!("snapback.packaged-store-qualification.v2"),
        |receipt| receipt["capabilityId"] = json!("bounded_children_v1"),
        |receipt| receipt["date"] = json!("2026-02-30"),
        |receipt| receipt["binaryIdentity"]["crateVersion"] = json!("0.0.0"),
        |receipt| receipt["binaryIdentity"]["gitCommit"] = json!("b".repeat(40)),
        |receipt| receipt["binaryIdentity"]["gitDirty"] = json!(true),
        |receipt| receipt["binaryIdentity"]["buildProfile"] = json!("debug"),
        |receipt| {
            receipt["binaryIdentity"]["buildDistribution"] =
                json!(crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE)
        },
        |receipt| receipt["embeddedCarrierSha256"] = json!(format!("sha256:{}", "2".repeat(64))),
        |receipt| receipt["packageClosureSha256"] = json!(format!("sha256:{}", "3".repeat(64))),
        |receipt| {
            receipt["packageClosure"][0]["sha256"] = json!(format!("sha256:{}", "0".repeat(64)))
        },
        |receipt| receipt["packageClosure"][0]["sha256"] = json!("sha256:not-a-digest"),
        |receipt| receipt["suite"]["id"] = json!("some-other-suite"),
        |receipt| receipt["suite"]["fail"] = json!(1),
        |receipt| receipt["suite"]["skipped"] = json!(1),
        |receipt| receipt["suite"]["pass"] = json!(0),
        |receipt| receipt["unexpected"] = json!(true),
    ];
    for mutate in receipt_mutations {
        let mut receipt: Value =
            serde_json::from_slice(&valid_receipt).expect("valid receipt parses");
        mutate(&mut receipt);
        let receipt = serde_json::to_vec(&receipt).expect("mutated receipt serializes");
        assert!(!public_packaged_store_verified(
            Some(&receipt),
            PACKAGED_STORE_TEST_GIT_COMMIT,
            false,
            "release",
        ));
    }
    assert!(!local_persistent_store_publication_verified_for(
        "unrecognized-distribution",
        PACKAGED_STORE_TEST_GIT_COMMIT,
        false,
        "release",
        Some(&valid_receipt),
        LOCAL_PERSISTENT_STORE_PUBLICATION_BYTES,
        LOCAL_PERSISTENT_STORE_PUBLICATION_ANCHOR_BYTES,
        LOCAL_PERSISTENT_STORE_CARRIER_EXIT_RECEIPT_BYTES,
        LOCAL_PERSISTENT_STORE_TRIAGE_MOVE1_RECEIPT_BYTES,
        LOCAL_PERSISTENT_STORE_TRIAGE_BUDGET_RECEIPT_BYTES,
    ));

    let unsorted = vec![
        PackagedStoreClosureEntryV1 {
            name: "z-package".to_owned(),
            version: "1.0.0".to_owned(),
            sha256: format!("sha256:{}", "4".repeat(64)),
        },
        PackagedStoreClosureEntryV1 {
            name: "a-package".to_owned(),
            version: "2.0.0".to_owned(),
            sha256: format!("sha256:{}", "5".repeat(64)),
        },
    ];
    let expected_canonical = format!(
        "a-package@2.0.0 sha256:{}\nz-package@1.0.0 sha256:{}\n",
        "5".repeat(64),
        "4".repeat(64),
    );
    assert_eq!(
        packaged_store_closure_canonical_text(&unsorted).as_deref(),
        Some(expected_canonical.as_str()),
    );
    let withheld = CapabilityManifest::local_v0_with_facts(
        Vec::new(),
        TargetCapabilityFacts::local_auth_aware()
            .with_local_persistent_store_publication_withheld(),
    );
    assert!(
        !withheld
            .supported_capabilities
            .contains(&TargetCapabilityId::SingleTableV1)
    );
    assert!(
        withheld
            .capability_gaps
            .iter()
            .any(|gap| gap == "single_table_v1")
    );
}

#[test]
fn packaged_store_qualification_mode_is_public_package_only_and_manifest_honest() {
    assert!(!packaged_store_qualification_mode_from_value(None));
    assert!(!packaged_store_qualification_mode_from_value(Some(
        OsStr::new("")
    )));
    assert!(packaged_store_qualification_mode_from_value(Some(
        OsStr::new("1")
    )));
    assert!(packaged_store_qualification_mode_from_value(Some(
        OsStr::new("0")
    )));

    let packaged_facts = TargetCapabilityFacts::local_auth_aware_with_packaged_store_evidence(
        crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE,
        PACKAGED_STORE_TEST_GIT_COMMIT,
        false,
        "release",
        None,
        true,
    );
    let packaged =
        CapabilityManifest::local_v0_with_facts(local_v0_default_capability_gaps(), packaged_facts);
    assert!(packaged.packaged_store_qualification_mode);
    assert!(
        packaged
            .supported_capabilities
            .contains(&TargetCapabilityId::SingleTableV1)
    );
    assert!(
        !packaged
            .capability_gaps
            .iter()
            .any(|gap| gap == "single_table_v1")
    );
    for untouched in [
        TargetCapabilityId::BoundedChildrenV1,
        TargetCapabilityId::WriteActivityV1,
        TargetCapabilityId::SequenceAllocationV1,
        TargetCapabilityId::AgentSafeStorageV1,
        TargetCapabilityId::AgentSafeDerivedDeploymentForkV1,
    ] {
        assert!(
            !packaged.supported_capabilities.contains(&untouched),
            "qualification mode must not widen {}",
            untouched.as_str(),
        );
    }

    let without_mode = CapabilityManifest::local_v0_with_facts(
        local_v0_default_capability_gaps(),
        TargetCapabilityFacts::local_auth_aware_with_packaged_store_evidence(
            crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE,
            PACKAGED_STORE_TEST_GIT_COMMIT,
            false,
            "release",
            None,
            false,
        ),
    );
    assert!(!without_mode.packaged_store_qualification_mode);
    assert!(
        without_mode
            .capability_gaps
            .iter()
            .any(|gap| gap == "single_table_v1")
    );

    let contributor_with_mode = CapabilityManifest::local_v0_with_facts(
        local_v0_default_capability_gaps(),
        TargetCapabilityFacts::local_auth_aware_with_packaged_store_evidence(
            crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
            PACKAGED_STORE_TEST_GIT_COMMIT,
            false,
            "release",
            None,
            true,
        ),
    );
    let contributor_without_mode = CapabilityManifest::local_v0_with_facts(
        local_v0_default_capability_gaps(),
        TargetCapabilityFacts::local_auth_aware_with_packaged_store_evidence(
            crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
            "unknown",
            true,
            "debug",
            None,
            false,
        ),
    );
    assert_eq!(contributor_with_mode, contributor_without_mode);
    assert!(!contributor_with_mode.packaged_store_qualification_mode);
    assert!(
        serde_json::to_value(&contributor_with_mode)
            .expect("contributor manifest serializes")
            .get("packagedStoreQualificationMode")
            .is_none(),
        "false qualification mode must not leak into declared manifests",
    );
    let committed: Value = serde_json::from_slice(include_bytes!(
        "../../../../schemas/capability.manifest.local-dev-sqlite-ibex.json"
    ))
    .expect("committed local manifest parses");
    assert_eq!(
        serde_json::to_value(&contributor_without_mode).expect("contributor manifest serializes"),
        committed,
        "the contributor-source declared manifest remains byte-shape identical",
    );
}

#[test]
fn snapshot_batch_registry_is_experimental_and_local_only() {
    assert_eq!(
        TargetCapabilityId::SnapshotBatchV1.maturity(),
        CapabilityMaturity::Experimental,
    );
    for manifest in [
        CapabilityManifest::local_v0_declared(),
        CapabilityManifest::local_v0_instance(Vec::new(), true),
    ] {
        assert!(
            manifest
                .supported_capabilities
                .contains(&TargetCapabilityId::SnapshotBatchV1),
            "{} must advertise the registered local executor",
            manifest.target_profile_id,
        );
        assert_eq!(
            manifest
                .capability_maturity
                .get(&TargetCapabilityId::SnapshotBatchV1),
            Some(&CapabilityMaturity::Experimental),
        );
        assert!(
            !manifest
                .capability_gaps
                .iter()
                .any(|gap| gap == "snapshot_batch_v1")
        );
    }
    for manifest in [
        CapabilityManifest::remote_service_sqlite_ibex_declared(),
        CapabilityManifest::conformance_workerd_v8(json!({})),
        CapabilityManifest::cloudflare_do_sqlite_v8(json!({})),
    ] {
        assert!(
            !manifest
                .supported_capabilities
                .contains(&TargetCapabilityId::SnapshotBatchV1),
            "{} must not inherit local snapshot-batch runtime support",
            manifest.target_profile_id,
        );
        assert!(
            !manifest
                .capability_maturity
                .contains_key(&TargetCapabilityId::SnapshotBatchV1),
            "{} must not annotate maturity for an unsupported id",
            manifest.target_profile_id,
        );
        assert!(
            manifest
                .capability_gaps
                .iter()
                .any(|gap| gap == "snapshot_batch_v1"),
            "{} must report the structured snapshot_batch_v1 GAP",
            manifest.target_profile_id,
        );
    }
}

#[test]
fn snapshot_batch_v2_registry_is_experimental_and_local_only() {
    assert_eq!(
        TargetCapabilityId::SnapshotBatchV2.maturity(),
        CapabilityMaturity::Experimental,
    );
    for manifest in [
        CapabilityManifest::local_v0_declared(),
        CapabilityManifest::local_v0_instance(Vec::new(), true),
    ] {
        assert!(
            manifest
                .supported_capabilities
                .contains(&TargetCapabilityId::SnapshotBatchV2),
            "{} must advertise the registered local v2 executor",
            manifest.target_profile_id,
        );
        assert_eq!(
            manifest
                .capability_maturity
                .get(&TargetCapabilityId::SnapshotBatchV2),
            Some(&CapabilityMaturity::Experimental),
        );
        assert!(
            !manifest
                .capability_gaps
                .iter()
                .any(|gap| gap == "snapshot_batch_v2")
        );
    }
    for manifest in [
        CapabilityManifest::remote_service_sqlite_ibex_declared(),
        CapabilityManifest::conformance_workerd_v8(json!({})),
        CapabilityManifest::cloudflare_do_sqlite_v8(json!({})),
    ] {
        assert!(
            !manifest
                .supported_capabilities
                .contains(&TargetCapabilityId::SnapshotBatchV2),
            "{} must not inherit local snapshot-batch v2 support",
            manifest.target_profile_id,
        );
        assert!(
            !manifest
                .capability_maturity
                .contains_key(&TargetCapabilityId::SnapshotBatchV2),
            "{} must not annotate maturity for an unsupported id",
            manifest.target_profile_id,
        );
        assert!(
            manifest
                .capability_gaps
                .iter()
                .any(|gap| gap == "snapshot_batch_v2"),
            "{} must report the structured snapshot_batch_v2 GAP",
            manifest.target_profile_id,
        );
    }
}

#[test]
fn unpublished_live_search_capability_is_closed_and_always_gapped() {
    assert_eq!(
        TargetCapabilityId::LiveFullTextSearchV1.maturity(),
        CapabilityMaturity::Experimental,
    );
    for manifest in [
        CapabilityManifest::local_v0(Vec::new()),
        CapabilityManifest::local_v0_instance(Vec::new(), true),
        CapabilityManifest::remote_service_sqlite_ibex_declared(),
        CapabilityManifest::conformance_workerd_v8(serde_json::json!({})),
        CapabilityManifest::cloudflare_do_sqlite_v8(serde_json::json!({})),
    ] {
        assert!(
            !manifest
                .supported_capabilities
                .contains(&TargetCapabilityId::LiveFullTextSearchV1),
            "{} must not publish live search before complete evidence",
            manifest.target_profile_id,
        );
        assert!(
            manifest
                .capability_gaps
                .iter()
                .any(|gap| gap == "live_full_text_search_v1"),
            "{} must carry the structured live-search GAP",
            manifest.target_profile_id,
        );
        assert!(manifest.live_full_text_search.is_none());
        assert!(
            !manifest
                .capability_maturity
                .contains_key(&TargetCapabilityId::LiveFullTextSearchV1),
            "unsupported ids do not receive maturity annotations",
        );
    }

    let closed = serde_json::json!({
        "capabilityId": "live_full_text_search_v1",
        "livenessScope": "first-page-only",
        "wakeGranularity": "table-granular",
        "deliveryLane": "replace-only",
        "retention": false,
        "resume": false,
        "authScoped": false,
        "maxLiveSubscriptions": 64,
        "maxLiveSubscriptionsPerConnection": 8,
        "maxLiveSubscriptionsPerTable": 128,
        "invented": true,
    });
    assert!(
        serde_json::from_value::<LiveFullTextSearchFactsV1>(closed).is_err(),
        "target facts must remain deny-unknown-fields closed",
    );
}

#[test]
fn relation_activity_publication_is_exactly_local_and_source_owned() {
    assert!(
        local_relation_activity_publication_verified(),
        "the tracked carrier must match its receipt, source bytes, and compiled digest",
    );

    for manifest in [
        CapabilityManifest::remote_service_sqlite_ibex_declared(),
        CapabilityManifest::conformance_workerd_v8(json!({})),
        CapabilityManifest::cloudflare_do_sqlite_v8(json!({})),
    ] {
        for (id, gap) in [
            (TargetCapabilityId::BoundedChildrenV1, "bounded_children_v1"),
            (TargetCapabilityId::WriteActivityV1, "write_activity_v1"),
        ] {
            assert!(
                !manifest.supported_capabilities.contains(&id),
                "{} must not inherit the local source publication",
                manifest.target_profile_id,
            );
            assert!(
                manifest
                    .capability_gaps
                    .iter()
                    .any(|candidate| candidate == gap),
                "{} must retain the structured {gap} GAP",
                manifest.target_profile_id,
            );
        }
    }

    let mut local = CapabilityManifest::local_v0_declared();
    local.refresh_supported_capabilities(
        TargetCapabilityFacts::local_auth_aware().with_relation_activity_publication_withheld(),
    );
    assert!(
        !local
            .supported_capabilities
            .contains(&TargetCapabilityId::BoundedChildrenV1)
            && !local
                .supported_capabilities
                .contains(&TargetCapabilityId::WriteActivityV1),
        "target facts, not manifest fields from an app artifact, own publication authority",
    );
}

#[test]
fn packaged_relation_activity_publication_withholds_atomic_pair_as_structured_gaps() {
    let facts = TargetCapabilityFacts::local_auth_aware_for_distribution(
        crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE,
    );
    let manifest =
        CapabilityManifest::local_v0_with_facts(local_v0_default_capability_gaps(), facts);

    for (id, gap) in [
        (TargetCapabilityId::BoundedChildrenV1, "bounded_children_v1"),
        (TargetCapabilityId::WriteActivityV1, "write_activity_v1"),
    ] {
        assert!(!manifest.supported_capabilities.contains(&id));
        assert!(
            manifest
                .capability_gaps
                .iter()
                .any(|candidate| candidate == gap),
            "public package must retain the structured {gap} GAP",
        );
        assert_eq!(id.maturity(), CapabilityMaturity::Experimental);
    }
}

#[test]
fn compiled_build_distribution_owns_relation_activity_publication() {
    let manifest = CapabilityManifest::local_v0_declared();
    let source_authority = crate::identity::build_distribution()
        == crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE;
    for (id, gap) in [
        (TargetCapabilityId::BoundedChildrenV1, "bounded_children_v1"),
        (TargetCapabilityId::WriteActivityV1, "write_activity_v1"),
    ] {
        assert_eq!(
            manifest.supported_capabilities.contains(&id),
            source_authority
        );
        assert_eq!(
            manifest
                .capability_gaps
                .iter()
                .any(|candidate| candidate == gap),
            !source_authority,
        );
    }
}

#[test]
fn relation_activity_publication_tamper_and_package_substitutions_fail_closed() {
    let mut tampered_carrier = LOCAL_RELATION_ACTIVITY_PUBLICATION_BYTES.to_vec();
    tampered_carrier[0] ^= 1;
    assert!(!local_relation_activity_publication_verified_for(
        crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
        &tampered_carrier,
        LOCAL_RELATION_ACTIVITY_PUBLICATION_SHA256,
        LOCAL_RELATION_ACTIVITY_QUALIFICATION_RECEIPT_BYTES,
    ));

    let mut stale_receipt = LOCAL_RELATION_ACTIVITY_QUALIFICATION_RECEIPT_BYTES.to_vec();
    stale_receipt.push(b'\n');
    assert!(!local_relation_activity_publication_verified_for(
        crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
        LOCAL_RELATION_ACTIVITY_PUBLICATION_BYTES,
        LOCAL_RELATION_ACTIVITY_PUBLICATION_SHA256,
        &stale_receipt,
    ));

    // @ref LLP 0110#local-and-packaged-publication-authority — until a
    // release-key verifier and exact PackageCapabilityAttestationV1 are
    // embedded, the public-package distribution cut must reject every
    // mandatory negative before any carrier detail can become authority.
    for attempted_substitution in [
        "tampered embedded carrier",
        "another binary sha256",
        "another target triple",
        "stale installed graph",
        "old package closure",
        "unknown signing key",
        "rollback-incompatible package",
        "candidate artifact substitution",
    ] {
        assert!(
            !local_relation_activity_publication_verified_for(
                crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE,
                LOCAL_RELATION_ACTIVITY_PUBLICATION_BYTES,
                LOCAL_RELATION_ACTIVITY_PUBLICATION_SHA256,
                LOCAL_RELATION_ACTIVITY_QUALIFICATION_RECEIPT_BYTES,
            ),
            "{attempted_substitution} must not cross the package GAP",
        );
    }
}
