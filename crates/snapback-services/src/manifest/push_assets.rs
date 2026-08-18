//! Push and asset manifest validation and target facts.
//!
//! `SchemaManifest::validate_artifact` also checks core and vector declarations.
//! Its single body remains intact here because dividing it would be a semantic
//! rewrite; the push service call-through fixes the least-ambiguous owner.

use super::*;

fn validate_api_origin(origin: &str) -> SnapbackResult<()> {
    let parsed = origin.parse::<http::Uri>().map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_API_ORIGIN_INVALID",
            "api",
            format!("api origin {origin:?} must be an exact http(s) scheme+host+port origin"),
        )
    })?;
    let valid_scheme = matches!(parsed.scheme_str(), Some("http" | "https"));
    let authority = parsed.authority();
    let canonical = parsed
        .scheme_str()
        .zip(authority)
        .map(|(scheme, authority)| format!("{scheme}://{}", authority.as_str()));
    if !valid_scheme
        || authority.is_none_or(|value| value.host().is_empty() || value.as_str().contains('@'))
        || parsed
            .path_and_query()
            .is_some_and(|path| path.as_str() != "/")
        || origin.contains('*')
        || canonical.as_deref() != Some(origin)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_API_ORIGIN_INVALID",
            "api",
            format!(
                "api origin {origin:?} must be an exact http(s) scheme+host+port origin without wildcards"
            ),
        ));
    }
    Ok(())
}
pub trait SchemaManifestValidationExt {
    fn validate_artifact(&self) -> SnapbackResult<()>;
    fn validate_asset_collections(&self) -> SnapbackResult<()>;
}

impl SchemaManifestValidationExt for SchemaManifest {
    fn validate_artifact(&self) -> SnapbackResult<()> {
        validate_artifact_header(
            "schema",
            "schemaManifest",
            &self.artifact_kind,
            &self.schema_version,
            self.schema_hash.as_deref(),
            self.inputs_hash.as_deref(),
        )?;

        let mode = self.effective_auth_mode();
        if let Some(api) = &self.api {
            if api.enabled
                && self
                    .auth
                    .and_then(|auth| auth.agents)
                    .is_none_or(|agents| !agents.mode_explicit)
            {
                // @ref LLP 0204#d1--the-exposure-declaration-keystone — an
                // enabled external surface must name both authority mode and
                // registration posture; explicit disabled remains valid.
                return Err(SnapbackError::error(
                    "SNAPBACK_API_REGISTRATION_POSTURE_REQUIRED",
                    "api",
                    "api.enabled requires both auth.mode sessions and an explicit auth.agents.mode declaration",
                ));
            }
            if mode != AuthMode::Sessions {
                return Err(SnapbackError::error(
                    "SNAPBACK_API_AUTH_MODE_INVALID",
                    "api",
                    "the api block is meaningful only when auth.mode is sessions",
                ));
            }
            if let Some(origins) = &api.origins {
                for origin in origins {
                    validate_api_origin(origin)?;
                }
            }
            if let Some(oauth) = &api.oauth {
                if oauth.enabled && !api.enabled {
                    return Err(SnapbackError::error(
                        "SNAPBACK_API_OAUTH_REQUIRES_API",
                        "api",
                        "api.oauth.enabled requires api.enabled; enable both declarations",
                    ));
                }
                // v1 deliberately has no DPoP/PoP transport. Refusing the
                // default makes the bearer weakening an explicit author act.
                if oauth.enabled && !oauth.bearer {
                    return Err(SnapbackError::error(
                        "SNAPBACK_API_OAUTH_BEARER_OPT_IN_REQUIRED",
                        "api",
                        "the OAuth facade is bearer-only in v1; set api.oauth.bearer true to acknowledge the shorter-lived bearer weakening",
                    ));
                }
                if oauth.bundles.len() > 64 {
                    return Err(SnapbackError::error(
                        "SNAPBACK_API_OAUTH_BUNDLES_INVALID",
                        "api",
                        "api.oauth.bundles accepts at most 64 named bundles",
                    ));
                }
                for (name, bundle) in &oauth.bundles {
                    let valid_name = !name.is_empty()
                        && name.len() <= 128
                        && name.bytes().all(|byte| {
                            byte == b'!'
                                || (b'#'..=b'[').contains(&byte)
                                || (b']'..=b'~').contains(&byte)
                        });
                    let unique = bundle.functions.iter().collect::<BTreeSet<_>>().len()
                        == bundle.functions.len();
                    if !valid_name
                        || bundle.functions.is_empty()
                        || bundle.functions.len() > 128
                        || !unique
                    {
                        return Err(SnapbackError::error(
                            "SNAPBACK_API_OAUTH_BUNDLES_INVALID",
                            "api",
                            format!(
                                "api.oauth bundle {name:?} must use an OAuth scope-token name and contain 1..=128 unique function names"
                            ),
                        ));
                    }
                }
            }
            if let Some(ask) = &api.ask {
                if ask.enabled && !api.enabled {
                    return Err(SnapbackError::error(
                        "SNAPBACK_API_ASK_REQUIRES_API",
                        "api",
                        "api.ask.enabled requires api.enabled",
                    ));
                }
                if let Some(model) = &ask.model
                    && (model.provider.is_empty()
                        || model.provider.len() > 2_048
                        || model.model.is_empty()
                        || model.model.len() > 512
                        || model
                            .secret
                            .as_ref()
                            .is_some_and(|secret| secret.is_empty() || secret.len() > 512)
                        || (ask.billing == ApiAskBilling::CallerKey && model.secret.is_some()))
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_API_ASK_MODEL_INVALID",
                        "api",
                        "api.ask.model requires bounded non-empty provider/model and an optional LLP 0036 secret entry name",
                    ));
                }
                if ask.enabled
                    && api
                        .budgets
                        .as_ref()
                        .and_then(|value| value.ask.as_ref())
                        .is_none()
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_API_ASK_BUDGETS_REQUIRED",
                        "api",
                        "api.ask.enabled requires api.budgets.ask.perRequest, api.budgets.ask.perPrincipalDay, api.budgets.ask.appMonthly, and api.budgets.ask.resultVolume",
                    ));
                }
            }
            if let Some(budgets) = api.budgets.as_ref().and_then(|value| value.ask.as_ref()) {
                let values = [
                    budgets.per_request.max_tokens,
                    budgets.per_request.max_steps,
                    budgets.per_request.max_wall_ms,
                    budgets.per_principal_day.max_tokens,
                    budgets.app_monthly.max_tokens,
                    budgets.result_volume.max_bytes,
                    budgets.result_volume.max_rows,
                    budgets.result_volume.per_principal_day_bytes,
                ];
                if values
                    .into_iter()
                    .any(|value| value == 0 || value > 9_007_199_254_740_991)
                    || budgets.per_integration_day.as_ref().is_some_and(|budget| {
                        budget.max_tokens == 0 || budget.max_tokens > 9_007_199_254_740_991
                    })
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_API_ASK_BUDGETS_INVALID",
                        "api",
                        "api.budgets.ask values must be positive portable safe integers",
                    ));
                }
            }
        }
        if self.auth.is_some_and(|auth| auth.agents.is_some()) && mode != AuthMode::Sessions {
            // @ref LLP 0055#registration — auth.agents changes abuse posture
            // only inside the sessions authority model; dev declarations are
            // rejected instead of being silently dormant.
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_AGENT_POLICY_MODE_INVALID",
                "auth",
                "auth.agents is meaningful only when auth.mode is sessions",
            ));
        }
        let tuple_supported = matches!(
            (self.schema_version.as_str(), mode),
            (SNAPBACK_SCHEMA_VERSION, AuthMode::Dev)
                | (SNAPBACK_SESSIONS_SCHEMA_VERSION, AuthMode::Sessions)
        );
        if !tuple_supported {
            return Err(SnapbackError::error(
                "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION",
                "schema",
                format!(
                    "unsupported schema/auth tuple {} + {}",
                    self.schema_version,
                    mode.as_str()
                ),
            )
            .with_details(serde_json::json!({
                "schemaVersion": self.schema_version,
                "authMode": mode.as_str(),
            })));
        }

        if self.schema_version == SNAPBACK_SESSIONS_SCHEMA_VERSION {
            validate_known_v1_capabilities(self.required_capabilities.iter().map(String::as_str))?;
            if !self
                .required_capabilities
                .iter()
                .any(|capability| capability == TargetCapabilityId::AuthSessionsV1.as_str())
            {
                return Err(unsupported_capability_error(
                    TargetCapabilityId::AuthSessionsV1.as_str(),
                    "a sessions schema must require auth.sessions.v1",
                ));
            }
        } else if self
            .required_capabilities
            .iter()
            .any(|capability| capability == TargetCapabilityId::AuthSessionsV1.as_str())
        {
            return Err(unsupported_capability_error(
                TargetCapabilityId::AuthSessionsV1.as_str(),
                "a v0 dev schema must not require auth.sessions.v1",
            ));
        }

        let declares_live_search_limits = self.tables.iter().any(|table| {
            table.search_live_limits.is_some()
                || table
                    .search_indexes
                    .iter()
                    .any(|index| index.live_limits.is_some())
        });
        if declares_live_search_limits
            && !self
                .required_capabilities
                .iter()
                .any(|capability| capability == "live_full_text_search_v1")
        {
            // @ref LLP 0136#capability-id-and-claim-discipline-llp-0119-oq2-proposal
            // — a decoder that knows the carrier but lacks target support
            // must still refuse; limits can never be silently discarded.
            return Err(unsupported_capability_error(
                "live_full_text_search_v1",
                "live-search limit carriers require live_full_text_search_v1",
            ));
        }

        let declares_vector = self.tables.iter().any(|table| {
            !table.vector_indexes.is_empty()
                || table
                    .fields
                    .iter()
                    .any(|field| matches!(field.field_type, FieldType::Vector { .. }))
        });
        if declares_vector
            && !self
                .required_capabilities
                .iter()
                .any(|capability| capability == crate::vector::types::VECTOR_CAPABILITY)
        {
            return Err(unsupported_capability_error(
                crate::vector::types::VECTOR_CAPABILITY,
                "vector fields and indexes require vector_search_v1",
            ));
        }
        for table in &self.tables {
            let mut names = BTreeSet::new();
            for index in &table.vector_indexes {
                if !names.insert(index.name.as_str()) {
                    return Err(vector_manifest_invalid(format!(
                        "table {} repeats vector index {}",
                        table.name, index.name
                    )));
                }
                validate_vector_index_manifest(table, index)?;
            }
        }

        if let Some(push_seam) = &self.push_seam {
            if mode != AuthMode::Sessions {
                return Err(SnapbackError::error(
                    "SNAPBACK_PUSH_SEAM_AUTH_REQUIRED",
                    "push",
                    "the push-token registry requires schema auth.mode sessions",
                ));
            }
            crate::push::validate_declaration_against_schema(push_seam, self)?;
        }

        self.validate_asset_collections()?;

        Ok(())
    }

    /// Re-prove that every generated relation is exactly the closed D2
    /// storage shape and that no lookalike system table exists without a
    /// descriptor. Runtime mutation admission relies on this pairing.
    /// @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation
    fn validate_asset_collections(&self) -> SnapbackResult<()> {
        let invalid = |message: String| {
            SnapbackError::error(
                "SNAPBACK_MEDIA_COLLECTION_MANIFEST_INVALID",
                "asset-collection",
                message,
            )
        };
        if self.asset_collections.is_empty() {
            if let Some(table) = self
                .tables
                .iter()
                .find(|table| table.name.starts_with("_snapback_asset_collection_"))
            {
                return Err(invalid(format!(
                    "framework-owned child table {} has no collection descriptor",
                    table.name
                )));
            }
            return Ok(());
        }
        if !self
            .required_capabilities
            .iter()
            .any(|capability| capability == TargetCapabilityId::MediaCollectionV1.as_str())
        {
            return Err(invalid(
                "assetCollections requires assets.media-collection.v1".to_owned(),
            ));
        }
        let mut names = BTreeSet::new();
        let mut child_tables = BTreeSet::new();
        let mut operations = BTreeSet::new();
        for collection in &self.asset_collections {
            if collection.format != "snapback.asset-collection.v1"
                || collection.name.is_empty()
                || !names.insert(collection.name.as_str())
                || collection.generation.len() != 71
                || !collection.generation.starts_with("sha256:")
                || !collection.generation[7..]
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit())
                || collection.max_items == 0
                || collection.max_items > 32
                || collection.kinds.is_empty()
                || collection.kinds.iter().collect::<BTreeSet<_>>().len() != collection.kinds.len()
                || collection.duplicate_policy != "refuse.v1"
                || collection.sharing.format != "snapback.asset-collection-sharing.v1"
                || collection.sharing.ceiling.is_empty()
                || collection.sharing.ceiling.len() > 8
                || !collection
                    .child_table
                    .starts_with("_snapback_asset_collection_")
                || !child_tables.insert(collection.child_table.as_str())
            {
                return Err(invalid(format!(
                    "collection {} is outside the closed descriptor profile",
                    collection.name
                )));
            }
            let portable_plan_name = |name: &str| {
                (1..=64).contains(&name.len())
                    && name
                        .bytes()
                        .next()
                        .is_some_and(|byte| byte.is_ascii_alphabetic())
                    && name
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
            };
            let mut sharing_names = BTreeSet::new();
            for sharing_plan in &collection.sharing.ceiling {
                let bounded = match &sharing_plan.plan {
                    AssetCollectionSharingPlanV1::None
                    | AssetCollectionSharingPlanV1::OwnerOnly
                    | AssetCollectionSharingPlanV1::InheritCommand => true,
                    AssetCollectionSharingPlanV1::Recipients { max_recipients, .. }
                    | AssetCollectionSharingPlanV1::Derived { max_recipients, .. } => {
                        (1..=32).contains(max_recipients)
                    }
                };
                if !portable_plan_name(&sharing_plan.name)
                    || !sharing_names.insert(sharing_plan.name.as_str())
                    || !bounded
                {
                    return Err(invalid(format!(
                        "collection {} has an invalid or duplicate sharing ceiling plan",
                        collection.name
                    )));
                }
            }
            let Some(default_sharing) = collection
                .sharing
                .ceiling
                .iter()
                .find(|plan| plan.name == collection.sharing.default_plan)
            else {
                return Err(invalid(format!(
                    "collection {} sharing default is outside its ceiling",
                    collection.name
                )));
            };
            if matches!(
                default_sharing.plan,
                AssetCollectionSharingPlanV1::Recipients { .. }
            ) {
                return Err(invalid(format!(
                    "collection {} cannot default a sharing plan that requires invocation principals",
                    collection.name
                )));
            }
            let operation_names = [
                Some(collection.operations.query.as_str()),
                Some(collection.operations.append.as_str()),
                Some(collection.operations.replace.as_str()),
                Some(collection.operations.remove.as_str()),
                collection.operations.reorder.as_deref(),
            ];
            if operation_names
                .into_iter()
                .flatten()
                .any(|name| name.is_empty() || !operations.insert(name))
                || collection.sharing.ceiling.iter().any(|plan| {
                    matches!(&plan.plan, AssetCollectionSharingPlanV1::Derived { function, .. }
                        if function.is_empty() || !operations.insert(function))
                })
                || matches!(collection.order, AssetCollectionOrderV1::Manual)
                    != collection.operations.reorder.is_some()
            {
                return Err(invalid(format!(
                    "collection {} has empty or colliding generated operation names",
                    collection.name
                )));
            }
            let owner = self.table(&collection.owner_table).ok_or_else(|| {
                invalid(format!(
                    "collection {} owner table {} is missing",
                    collection.name, collection.owner_table
                ))
            })?;
            if owner.permission_backing
                || owner.membership.is_some()
                || owner.authority_profile.is_some()
                || owner.visibility
                    != Some(TableVisibilityV1::Owner {
                        field: collection.owner_field.clone(),
                    })
            {
                return Err(invalid(format!(
                    "collection {} owner authority/sharing no longer matches its descriptor",
                    collection.name
                )));
            }
            for plan in &collection.sharing.ceiling {
                let AssetCollectionSharingPlanV1::Derived {
                    table,
                    parent_field,
                    principal_field,
                    ..
                } = &plan.plan
                else {
                    continue;
                };
                let source = self.table(table).ok_or_else(|| {
                    invalid(format!(
                        "collection {} sharing derivation table {} is missing",
                        collection.name, table
                    ))
                })?;
                let parent = source.field(parent_field);
                let principal = source.field(principal_field);
                if source.permission_backing
                    || source.membership.is_some()
                    || source.authority_profile.is_some()
                    || !matches!(source.visibility, Some(TableVisibilityV1::Owner { .. }))
                    || !parent.is_some_and(|field| {
                        !field.optional
                            && field.field_type
                                == FieldType::Id {
                                    table: collection.owner_table.clone(),
                                }
                    })
                    || !principal.is_some_and(|field| {
                        !field.optional && field.field_type == FieldType::Principal
                    })
                {
                    return Err(invalid(format!(
                        "collection {} sharing derivation {} is outside the closed owner-authorized profile",
                        collection.name, plan.name
                    )));
                }
            }
            let child = self.table(&collection.child_table).ok_or_else(|| {
                invalid(format!(
                    "collection {} child table {} is missing",
                    collection.name, collection.child_table
                ))
            })?;
            let expected_fields = [
                collection.fields.parent_id.as_str(),
                collection.fields.parent_incarnation.as_str(),
                collection.fields.asset_id.as_str(),
                collection.fields.kind.as_str(),
                collection.fields.policy_generation.as_str(),
                collection.fields.ordinal.as_str(),
            ];
            if expected_fields
                != [
                    "parentId",
                    "parentIncarnation",
                    "assetId",
                    "kind",
                    "policyGeneration",
                    "ordinal",
                ]
                || child.fields.len() != expected_fields.len()
                || child.syncable
                || child.permission_backing
                || child.membership.is_some()
                || child.authority_profile.is_some()
                || child.asset_sharing.is_some()
                || child.visibility.is_some()
            {
                return Err(invalid(format!(
                    "collection {} child table is not framework-owned closed storage",
                    collection.name
                )));
            }
            let expected_types = [
                FieldType::Id {
                    table: collection.owner_table.clone(),
                },
                FieldType::RelationIncarnation {
                    foreign_key_field: "parentId".to_owned(),
                    parent_table: collection.owner_table.clone(),
                },
                FieldType::AssetRef {
                    upload: Some(collection.intent.clone()),
                    media: Some(crate::contract_types::MediaFieldDescriptorV1 {
                        intent: collection.intent.clone(),
                        policy: collection.generation.clone(),
                        kinds: collection.kinds.clone(),
                        delivery: None,
                        variants: Vec::new(),
                        classification_profile: "detected-content-type.v1".to_owned(),
                        retention_class: "media-reference.v1".to_owned(),
                        target_capability: "assets.media-ref-projection.v1".to_owned(),
                    }),
                },
                FieldType::String,
                FieldType::String,
                FieldType::Integer,
            ];
            if child
                .fields
                .iter()
                .zip(expected_fields.into_iter().zip(expected_types))
                .any(|(field, (name, field_type))| {
                    field.name != name || field.optional || field.field_type != field_type
                })
            {
                return Err(invalid(format!(
                    "collection {} child record fields drifted from the D2 shape",
                    collection.name
                )));
            }
            let index = |name: &str, fields: &[&str], unique: bool| {
                child.indexes.iter().any(|index| {
                    index.name == name
                        && index
                            .fields
                            .iter()
                            .map(String::as_str)
                            .eq(fields.iter().copied())
                        && index.unique == unique
                        && !index.where_applicable
                })
            };
            if child.indexes.len() != 2
                || !index(
                    "byParentOrdinal",
                    &["parentId", "parentIncarnation", "ordinal"],
                    false,
                )
                || !index(
                    "uniqueParentAsset",
                    &["parentId", "parentIncarnation", "assetId"],
                    true,
                )
            {
                return Err(invalid(format!(
                    "collection {} child indexes drifted from the D2 shape",
                    collection.name
                )));
            }
        }
        if let Some(table) = self.tables.iter().find(|table| {
            table.name.starts_with("_snapback_asset_collection_")
                && !child_tables.contains(table.name.as_str())
        }) {
            return Err(invalid(format!(
                "framework-owned child table {} has no matching descriptor",
                table.name
            )));
        }
        Ok(())
    }
}
pub trait ExpoPushSeamFactsLocalExt {
    fn local_v1() -> Self;
}

impl ExpoPushSeamFactsLocalExt for ExpoPushSeamFactsV1 {
    fn local_v1() -> Self {
        Self {
            capability_id: "notifications.expoPushSeam".to_owned(),
            surfaces: [
                "push-token-registry",
                "ctx.push.send",
                "handoff-ledger",
                "receipt-maintenance",
            ]
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
            requires_session_auth: true,
            requires_outbound_actions: true,
            production_endpoint: "https://exp.host".to_owned(),
            local_loopback_test_override: true,
            send_batch_max: crate::push::PUSH_BATCH_MESSAGES_MAX as u32,
            max_concurrent_send_attempts: 1,
            receipt_batch_max: crate::push::PUSH_RECEIPT_BATCH_MAX as u32,
            receipt_first_poll_ms: crate::push::PUSH_RECEIPT_FIRST_POLL_MS,
            receipt_poll_intervals_ms: vec![1_800_000, 3_600_000, 7_200_000, 14_400_000],
            receipt_poll_max_attempts: 7,
            receipt_window_ms: crate::push::PUSH_RECEIPT_WINDOW_MS,
            registry_idle_retention_ms: CapabilityRangeV1 {
                source: "app-declared".to_owned(),
                min_ms: 86_400_000,
                max_ms: 31_536_000_000,
            },
            ledger_retention_ms: CapabilityRangeV1 {
                source: "app-declared".to_owned(),
                min_ms: 86_400_000,
                max_ms: 31_536_000_000,
            },
            pacing_class: "serial-batches-per-action-attempt".to_owned(),
            adaptive_pacing: false,
            never_claims: [
                "device-delivery",
                "notification-display",
                "read-or-interaction-state",
                "os-permission-state",
                "exactly-once-or-duplicate-suppression",
                "ordering-across-recipients-or-intents",
                "delivery-latency-availability-or-sla",
                "continued-token-validity-or-current-registration",
            ]
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
        }
    }
}
