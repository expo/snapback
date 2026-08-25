//! Schema, wire, and manifest data contracts.

use super::*;

pub const SNAPBACK_SCHEMA_VERSION: &str = "snapback.v0";
/// The paired schema/function artifact version reserved for session authority.
/// Non-pair artifacts (capabilities, diagnostics, runtime state, and wire DTOs)
/// intentionally remain at [`SNAPBACK_SCHEMA_VERSION`].
pub const SNAPBACK_SESSIONS_SCHEMA_VERSION: &str = "snapback.v1";
/// Portable query budgets shared by the local and Cloudflare evaluators. The
/// Filter-bind and `In` caps stay below SQLite's 999-variable compatibility
/// floor with room for target-internal parameters; the result cap matches the
/// existing 1,024-item bounded runtime lanes.
pub const QUERY_MAX_LIMIT: usize = 1_024;
pub const QUERY_DEFAULT_LIMIT: usize = QUERY_MAX_LIMIT;
pub const QUERY_MAX_IN_ITEMS: usize = 500;
pub const QUERY_MAX_FILTER_BINDINGS: usize = 500;
pub const QUERY_MAX_BUFFERED_WRITES: usize = 1_024;
pub const QUERY_INTERNAL_OVERFETCH_MAX: usize = QUERY_MAX_LIMIT + QUERY_MAX_BUFFERED_WRITES;
/// Portable bounded batch-read ceilings. The item cap stays below SQLite's
/// 999-variable compatibility floor for exact-id reads; canonical request
/// bytes mirror the 1 MiB handler-input posture and response bytes mirror the
/// 4 MiB result-contract host-response posture.
///
/// @ref LLP 0248#d1-exact-id-batch-reads
/// @ref LLP 0248#d4-dependency-and-cost-evidence-remain-conservative
pub const BATCH_READ_MAX_ITEMS: usize = 256;
pub const BATCH_READ_MAX_INPUT_BYTES: usize = 1_048_576;
pub const BATCH_READ_MAX_RESPONSE_BYTES: usize = 4_194_304;
pub const BATCH_READ_MAX_POLICY_PROBES_PER_ITEM: usize = 8;

/// One request may cumulatively acknowledge this many durable mutation
/// settlements. It matches the existing 1,024-item replay-ledger budget so a
/// hostile envelope cannot turn acknowledgement into unbounded SQLite work.
pub const CLIENT_MUTATION_ACK_MAX_IDS: usize = 1_024;
/// Authoring-time ceiling for one direct-field bounded-skew declaration. A
/// day is intentionally generous enough for clock drift and short offline
/// queues while keeping the opt-in visibly bounded.
pub const SETTLEMENT_BOUNDED_SKEW_MAX_MS: u64 = 86_400_000;
pub const TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX: &str = "local-dev-sqlite-ibex";
/// The standard SQLite + Ibex server when its lifecycle and network endpoint
/// are owned outside the consuming application. The service semantics match
/// the local development target; only lifecycle authority differs.
pub const TARGET_PROFILE_REMOTE_SERVICE_SQLITE_IBEX: &str = "remote-service-sqlite-ibex";
/// The LLP 0048 conformance twin's internal profile — named to be
/// unmistakably non-public so generated clients cannot mistake it for a
/// supported `local-dev-sqlite-v8` target.
pub const TARGET_PROFILE_LOCAL_CONFORMANCE_SQLITE_WORKERD_V8: &str =
    "local-conformance-sqlite-workerd-v8";
/// The LLP 0040 Cloudflare narrow-proof profile (LLP 0014 §Resolution:
/// everything on Durable Objects).
pub const TARGET_PROFILE_CLOUDFLARE_DO_SQLITE_V8: &str = "cloudflare-do-sqlite-v8";

fn schema_manifest_kind() -> String {
    "schemaManifest".to_owned()
}

#[cfg(test)]
mod single_table_v1_tests {
    use super::*;
    use serde_json::json;

    fn eligible_function() -> FunctionDefinition {
        let plan = QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: vec![FilterExpr {
                field: "title".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Arg("zed".to_owned()),
            }],
            membership_filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            indexed_by: None,
        };
        let mut function = FunctionDefinition::new(
            "publicLive",
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(plan)),
        );
        function.auth_requirement = Some(AuthRequirement::Public);
        function.args_contract = Some(FunctionArgsContract {
            fields: vec![
                ResultObjectFieldContract {
                    name: "zed".to_owned(),
                    required: true,
                    value: ResultValueContract::String {
                        max_bytes: 1024 * 1024,
                    },
                },
                ResultObjectFieldContract {
                    name: "alpha".to_owned(),
                    required: true,
                    value: ResultValueContract::String {
                        max_bytes: 1024 * 1024,
                    },
                },
            ],
        });
        function.required_capabilities = vec![
            "live_subscriptions".to_owned(),
            "host_plan_runtime".to_owned(),
            "single_table_v1".to_owned(),
            "result_contract_v1".to_owned(),
            "args_contract_v1".to_owned(),
        ];
        function.read_set_summary = DependencySummary {
            primary_table: Some("todos".to_owned()),
            tables: vec!["todos".to_owned()],
            mode: Some("singleTable".to_owned()),
            auth_scope_field: None,
        };
        function
    }

    fn empty_todos_schema() -> SchemaManifest {
        let table = serde_json::from_value(json!({
            "name": "todos",
            "fields": [],
            "indexes": [],
            "searchIndexes": [],
            "vectorIndexes": [],
            "syncable": true
        }))
        .expect("minimal table fixture");
        SchemaManifest {
            tables: vec![table],
            ..SchemaManifest::default()
        }
    }

    fn exact_empty_document_contract() -> FunctionResultContract {
        let safe_integer = || ResultValueContract::Integer {
            min: 0,
            max: 9_007_199_254_740_991,
        };
        FunctionResultContract::Documents {
            table: "todos".to_owned(),
            document: ResultValueContract::Object {
                fields: vec![
                    ResultObjectFieldContract {
                        name: "_id".to_owned(),
                        required: true,
                        value: ResultValueContract::Id {
                            table: "todos".to_owned(),
                        },
                    },
                    ResultObjectFieldContract {
                        name: "_version".to_owned(),
                        required: true,
                        value: safe_integer(),
                    },
                    ResultObjectFieldContract {
                        name: "_createdAt".to_owned(),
                        required: true,
                        value: safe_integer(),
                    },
                    ResultObjectFieldContract {
                        name: "_updatedAt".to_owned(),
                        required: true,
                        value: safe_integer(),
                    },
                ],
                allow_extra: false,
            },
        }
    }

    #[test]
    fn normalization_and_identity_match_the_codegen_golden() {
        let mut function = eligible_function();
        assert!(
            !function.authority_independent,
            "fixture carries no app assertion"
        );
        let normalized = single_table_plan_v1(&function)
            .expect("normalization succeeds")
            .expect("derived predicate selects the class");
        assert_eq!(
            serde_json::to_value(&normalized).expect("serialize normalized plan"),
            json!({
                "format": "snapback.single-table-plan.v1",
                "query": {
                    "table": "todos",
                    "filters": [{ "field": "title", "op": "Eq", "value": { "Arg": "zed" } }],
                    "membershipFilters": [],
                    "order": [],
                    "limit": null,
                    "indexedBy": null
                },
                "rqsDigestKind": "mset1",
                "examinedEntryCeiling": 1024
            })
        );
        function.result_contract = exact_empty_document_contract();
        let identity = single_node_identity_v1(&function, Some(&empty_todos_schema()))
            .expect("identity reconstruction succeeds")
            .expect("single-table identity exists");
        assert_eq!(
            identity.plan_hash,
            "sha256:5adc42769ab270a7deb6813bf9256316e7b38b98945faadea82f8b49f0247324"
        );
        assert!(owner_admits_authority_independence(&function));
        let node = &identity.normalized_composite_plan["nodes"][0]["nodePlan"];
        assert_eq!(node["classId"], "single_table_v1");
        assert_eq!(node["capability"]["live"]["delivery"], "live_delta");
        assert_eq!(
            node["argumentBindings"]
                .as_array()
                .expect("bindings")
                .iter()
                .map(|binding| binding["name"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["zed", "alpha"]
        );
    }

    #[test]
    fn selector_and_closed_refusals_preserve_null_and_order_semantics() {
        let mut function = eligible_function();
        if let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &mut function.runtime {
            plan.limit = Some(0);
        }
        assert_eq!(
            single_table_plan_v1(&function)
                .unwrap()
                .unwrap()
                .rqs_digest_kind,
            "seq1"
        );
        if let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &mut function.runtime {
            plan.limit = None;
            plan.order.push(OrderExpr {
                field: "title".to_owned(),
                direction: OrderDirection::Asc,
                max_encoded_bytes: Some(0),
            });
        }
        assert_eq!(
            single_table_plan_v1(&function)
                .expect_err("zero maxEncodedBytes refuses")
                .diagnostic
                .code,
            "SNAPBACK_SINGLE_TABLE_PLAN_INVALID"
        );
        let mut serialized =
            serde_json::to_value(single_table_plan_v1(&eligible_function()).unwrap().unwrap())
                .unwrap();
        serialized["unexpected"] = json!(true);
        assert!(serde_json::from_value::<SingleTablePlanV1>(serialized).is_err());
        for outside_profile in [
            json!({
                "format": "wrong",
                "query": { "table": "todos", "filters": [], "membershipFilters": [], "order": [], "limit": null, "indexedBy": null },
                "rqsDigestKind": "mset1", "examinedEntryCeiling": 1024
            }),
            json!({
                "format": "snapback.single-table-plan.v1",
                "query": { "table": "todos", "filters": [], "membershipFilters": [{}], "order": [], "limit": null, "indexedBy": null },
                "rqsDigestKind": "mset1", "examinedEntryCeiling": 1024
            }),
            json!({
                "format": "snapback.single-table-plan.v1",
                "query": { "table": "todos", "filters": [], "membershipFilters": [], "order": [], "limit": 0, "indexedBy": null },
                "rqsDigestKind": "mset1", "examinedEntryCeiling": 1024
            }),
            json!({
                "format": "snapback.single-table-plan.v1",
                "query": { "table": "todos", "filters": [], "membershipFilters": [], "order": [], "limit": 1025, "indexedBy": null },
                "rqsDigestKind": "seq1", "examinedEntryCeiling": 1024
            }),
            json!({
                "format": "snapback.single-table-plan.v1",
                "query": { "table": "todos", "filters": [], "membershipFilters": [], "order": [], "limit": null, "indexedBy": null },
                "rqsDigestKind": "mset1", "examinedEntryCeiling": 1025
            }),
        ] {
            assert!(
                serde_json::from_value::<SingleTablePlanV1>(outside_profile).is_err(),
                "closed profile must refuse exact near-misses"
            );
        }

        let mut explicit = eligible_function();
        explicit.authority_independent = true;
        assert!(single_table_plan_v1(&explicit).unwrap().is_some());

        let mut ineligible = eligible_function();
        ineligible.auth_requirement = Some(AuthRequirement::OptionalUser);
        assert!(single_table_plan_v1(&ineligible).unwrap().is_none());
        assert!(
            single_node_identity_v1(&ineligible, None)
                .unwrap()
                .is_none()
        );
    }
}

fn function_manifest_kind() -> String {
    "functionManifest".to_owned()
}

fn local_app_id() -> String {
    "local-app".to_owned()
}

fn default_true() -> bool {
    true
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// Framework-owned zero-to-many media relation. The generated child table is
/// still an ordinary SQLite table for OCC, backup, and live-query purposes;
/// this descriptor is the exclusive authority to mutate it.
/// @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetCollectionManifestV1 {
    pub format: String,
    pub name: String,
    pub generation: String,
    pub owner_table: String,
    pub owner_field: String,
    pub intent: String,
    pub max_items: u8,
    pub order: AssetCollectionOrderV1,
    pub kinds: Vec<MediaKindV1>,
    pub duplicate_policy: String,
    pub sharing: AssetCollectionSharingManifestV1,
    pub child_table: String,
    pub fields: AssetCollectionFieldsManifestV1,
    pub operations: AssetCollectionOperationsManifestV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AssetCollectionOrderV1 {
    Manual,
    Created,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetCollectionSharingManifestV1 {
    pub format: String,
    pub ceiling: Vec<AssetCollectionSharingPlanManifestV1>,
    #[serde(rename = "default")]
    pub default_plan: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AssetCollectionGrantStateV1 {
    Active,
    Pending,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetCollectionSharingPlanManifestV1 {
    pub name: String,
    #[serde(flatten)]
    pub plan: AssetCollectionSharingPlanV1,
}

impl<'de> Deserialize<'de> for AssetCollectionSharingPlanManifestV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let Value::Object(mut object) = Value::deserialize(deserializer)? else {
            return Err(serde::de::Error::custom(
                "asset collection sharing plan must be an object",
            ));
        };
        let name = object
            .remove("name")
            .and_then(|value| value.as_str().map(str::to_owned))
            .ok_or_else(|| {
                serde::de::Error::custom("asset collection sharing plan requires a string name")
            })?;
        let kind = object.get("kind").and_then(Value::as_str).ok_or_else(|| {
            serde::de::Error::custom("asset collection sharing plan requires a string kind")
        })?;
        let allowed = match kind {
            "none" | "owner-only" | "inherit-command" => &["kind"][..],
            "recipients" => &["kind", "state", "maxRecipients"][..],
            "derived" => &[
                "kind",
                "state",
                "maxRecipients",
                "function",
                "table",
                "parentField",
                "principalField",
            ][..],
            _ => {
                return Err(serde::de::Error::custom(
                    "asset collection sharing plan kind is not admitted",
                ));
            }
        };
        if let Some(field) = object
            .keys()
            .find(|field| !allowed.contains(&field.as_str()))
        {
            return Err(serde::de::Error::custom(format!(
                "asset collection sharing plan contains unknown field {field}",
            )));
        }
        let plan =
            serde_json::from_value(Value::Object(object)).map_err(serde::de::Error::custom)?;
        Ok(Self { name, plan })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum AssetCollectionSharingPlanV1 {
    None,
    OwnerOnly,
    Recipients {
        state: AssetCollectionGrantStateV1,
        #[serde(rename = "maxRecipients")]
        max_recipients: u8,
    },
    Derived {
        state: AssetCollectionGrantStateV1,
        #[serde(rename = "maxRecipients")]
        max_recipients: u8,
        function: String,
        table: String,
        #[serde(rename = "parentField")]
        parent_field: String,
        #[serde(rename = "principalField")]
        principal_field: String,
    },
    InheritCommand,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetCollectionFieldsManifestV1 {
    pub parent_id: String,
    pub parent_incarnation: String,
    pub asset_id: String,
    pub kind: String,
    pub policy_generation: String,
    pub ordinal: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetCollectionOperationsManifestV1 {
    pub query: String,
    pub append: String,
    pub replace: String,
    pub remove: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reorder: Option<String>,
}

/// Closed codegen-installed binding for one LLP 0239 D3 media command. Every
/// field is manifest authority; invocation carriers name only its identities
/// and deterministic item plan.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaCommandBindingV1 {
    pub format: String,
    pub identity: String,
    pub command: MediaCommandIdentityV1,
    pub target_mutation: MediaCommandTargetMutationV1,
    pub passthrough_args: Vec<String>,
    pub media: MediaCommandInputV1,
    pub parent_result_path: Vec<String>,
    pub collection: MediaCommandCollectionV1,
    pub item_identity_plan: MediaCommandItemIdentityPlanV1,
    pub sharing: AssetCollectionSharingPlanManifestV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub principal_input: Option<MediaCommandPrincipalInputV1>,
    pub task_profile: MediaCommandTaskProfileV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaCommandIdentityV1 {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaCommandTargetMutationV1 {
    pub id: String,
    pub name: String,
    pub implementation_hash: String,
    pub args_contract_hash: String,
    pub result_contract_hash: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaCommandInputV1 {
    pub input: String,
    pub intent: String,
    pub intent_policy_hash: String,
    pub mutation_arg: String,
    pub min_items: u8,
    pub max_items: u8,
    pub kinds: Vec<MediaKindV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaCommandCollectionV1 {
    pub name: String,
    pub generation: String,
    pub owner_table: String,
    pub owner_field: String,
    pub child_table: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaCommandItemIdentityPlanV1 {
    pub format: String,
    pub operation: String,
    pub order: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaCommandPrincipalInputV1 {
    pub input: String,
    pub min_items: u8,
    pub max_items: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaCommandTaskProfileV1 {
    pub concurrency: u8,
}

/// Wire carrier. The ordered plan is bound to one client mutation attempt;
/// the host compares it with the installed binding before handler execution.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaCommandInvocationV1 {
    pub binding_identity: String,
    pub command_identity: String,
    pub attempt_id: String,
    pub items: Vec<MediaCommandInvocationItemV1>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub principals: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaCommandInvocationItemV1 {
    pub ordinal: u8,
    pub asset_id: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedMediaCommandV1 {
    pub binding: MediaCommandBindingV1,
    pub invocation: MediaCommandInvocationV1,
}

/// One app-owned table sealed against every ordinary write path and reserved
/// for authorized migration plus the still-open verified-provisioning writer.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdentityBindingTableManifestV1 {
    pub table: String,
    pub principal_field: String,
    pub identity_field: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct SchemaManifest {
    #[serde(
        default = "schema_manifest_kind",
        rename = "artifactKind",
        alias = "artifact_kind"
    )]
    pub artifact_kind: String,
    #[serde(
        default = "snapback_schema_version",
        rename = "schemaVersion",
        alias = "schema_version"
    )]
    pub schema_version: String,
    #[serde(default = "local_app_id", rename = "appId", alias = "app_id")]
    pub app_id: String,
    #[serde(default)]
    pub app: Option<AppIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthManifest>,
    /// Generated identity-program facts consumed by first-party auth routes.
    /// @ref LLP 0214#81-guest-principal-and-session-creation — guest entry is
    /// gated by this generated policy, never by request input.
    #[serde(
        default,
        rename = "authProgram",
        skip_serializing_if = "Option::is_none"
    )]
    pub auth_program: Option<crate::contract_types::AuthProgramManifestV1>,
    /// External function exposure policy. This is public by construction: it
    /// is the declaration selecting the outward-facing projection, not a
    /// credential or implementation secret.
    // @ref LLP 0204#d1--the-exposure-declaration-keystone — one declaration
    // controls credentialed callability and exposed-only disclosure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<ApiManifest>,
    /// App-level asset policy (LLP 0044 §Deletion: the reference-GC opt-in
    /// is a schema declaration — "an app may enable" — not an intent knob).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assets: Option<SchemaAssetsPolicyV1>,
    /// Registry-only first slice of LLP 0143. The declaration pins app scope
    /// once in generated source; registration requests never choose it.
    #[serde(
        default,
        rename = "pushSeam",
        alias = "push_seam",
        skip_serializing_if = "Option::is_none"
    )]
    pub push_seam: Option<crate::push::PushSeamDeclarationV1>,
    /// Executable LLP 0234 governance identity. Review-only projection facts
    /// remain outside the manifest; activation deep-matches these digests to
    /// a target-owned protected observer verdict.
    #[serde(
        default,
        rename = "visibilityGovernance",
        alias = "visibility_governance",
        skip_serializing_if = "Option::is_none"
    )]
    pub visibility_governance:
        Option<crate::visibility_governance::VisibilityGovernanceActivationV1>,
    #[serde(
        default,
        rename = "requiredCapabilities",
        alias = "required_capabilities",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub required_capabilities: Vec<String>,
    /// @ref LLP 0214#53-sealed-invocation-authority — ordinary buffered
    /// writers are denied for these codegen-validated tables.
    #[serde(
        default,
        rename = "identityBindingTables",
        alias = "identity_binding_tables",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub identity_binding_tables: Vec<IdentityBindingTableManifestV1>,
    /// Per-app strict declaration conformance opt-in (LLP 0146 D1 surface 3):
    /// when set, an opaque handler's application-table reads and writes must
    /// be a subset of its declared sets, refused at the runtime seam with
    /// `SNAPBACK_HANDLER_UNDECLARED_READ`/`SNAPBACK_HANDLER_UNDECLARED_WRITE`.
    /// Default off — declarations stay evidence, not enforced ceilings
    /// (LLP 0127 decision 6), and per the 2026-08-03 OQ1 ruling newly
    /// generated apps do not opt in by default.
    #[serde(
        default,
        rename = "strictDeclarations",
        alias = "strict_declarations",
        skip_serializing_if = "is_false"
    )]
    pub strict_declarations: bool,
    #[serde(default, rename = "schemaHash", alias = "schema_hash")]
    pub schema_hash: Option<String>,
    #[serde(default, rename = "inputsHash", alias = "inputs_hash")]
    pub inputs_hash: Option<String>,
    // @ref LLP 0157#amendment--2026-08-10-toolchain-stable-activation-identity-ruled
    // — the artifact pair carries the authored-byte admission identity beside
    // its toolchain-sensitive generation identity.
    #[serde(default, rename = "authoredSourceHash", alias = "authored_source_hash")]
    pub authored_source_hash: Option<String>,
    #[serde(default, rename = "generatedAt", alias = "generated_at")]
    pub generated_at: Option<u64>,
    #[serde(default, rename = "sourceHash", alias = "source_hash")]
    pub source_hash: Option<String>,
    #[serde(
        default,
        rename = "artifactDiagnostics",
        alias = "artifact_diagnostics"
    )]
    pub artifact_diagnostics: Vec<Diagnostic>,
    #[serde(default, rename = "targetProfile", alias = "target_profile")]
    pub target_profile: Option<String>,
    #[serde(default, rename = "portabilityFlags", alias = "portability_flags")]
    pub portability_flags: Vec<String>,
    #[serde(
        default,
        rename = "ephemeralCollections",
        alias = "ephemeral_collections"
    )]
    pub ephemeral_collections: Vec<EphemeralCollection>,
    #[serde(
        default,
        rename = "assetCollections",
        alias = "asset_collections",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub asset_collections: Vec<AssetCollectionManifestV1>,
    pub tables: Vec<TableManifest>,
}

impl Default for SchemaManifest {
    fn default() -> Self {
        Self {
            artifact_kind: schema_manifest_kind(),
            schema_version: snapback_schema_version(),
            app_id: local_app_id(),
            app: None,
            auth: None,
            auth_program: None,
            api: None,
            assets: None,
            push_seam: None,
            visibility_governance: None,
            required_capabilities: Vec::new(),
            identity_binding_tables: Vec::new(),
            strict_declarations: false,
            schema_hash: None,
            inputs_hash: None,
            authored_source_hash: None,
            generated_at: None,
            source_hash: None,
            artifact_diagnostics: Vec::new(),
            target_profile: Some(TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned()),
            portability_flags: Vec::new(),
            ephemeral_collections: Vec::new(),
            asset_collections: Vec::new(),
            tables: Vec::new(),
        }
    }
}

impl SchemaManifest {
    pub fn table(&self, name: &str) -> Option<&TableManifest> {
        self.tables.iter().find(|table| table.name == name)
    }

    pub fn effective_auth_mode(&self) -> AuthMode {
        self.auth.map(|auth| auth.mode).unwrap_or(AuthMode::Dev)
    }

    pub fn effective_agents_manifest(&self) -> AgentsManifest {
        self.auth.and_then(|auth| auth.agents).unwrap_or_default()
    }

    pub fn effective_auth_password_identifier_mode(&self) -> AuthPasswordIdentifierMode {
        self.auth
            .and_then(|auth| auth.password_identifier_mode)
            .unwrap_or_default()
    }

    pub fn effective_auth_password_minimum_length(&self) -> u16 {
        self.auth
            .and_then(|auth| auth.password_minimum_length)
            .unwrap_or(crate::contract_types::AUTH_PASSWORD_MINIMUM_LENGTH_DEFAULT)
    }

    pub fn uses_exposed_only_disclosure(&self) -> bool {
        self.api
            .as_ref()
            .is_some_and(|api| api.enabled && api.disclosure == ApiDisclosure::ExposedOnly)
    }

    pub fn oauth_manifest(&self) -> Option<&ApiOAuthManifest> {
        self.api
            .as_ref()
            .filter(|api| api.enabled)
            .and_then(|api| api.oauth.as_ref())
            .filter(|oauth| oauth.enabled)
    }

    pub fn ask_manifest(&self) -> Option<(&ApiAskManifest, &ApiAskBudgets)> {
        let api = self.api.as_ref().filter(|api| api.enabled)?;
        let ask = api.ask.as_ref().filter(|ask| ask.enabled)?;
        let budgets = api.budgets.as_ref()?.ask.as_ref()?;
        Some((ask, budgets))
    }

    pub fn agent_registration_diagnostics(&self) -> Vec<Diagnostic> {
        let agents = self.effective_agents_manifest();
        if agents.mode == AgentsMode::Invited && agents.invited_by == InvitedBy::Operators {
            vec![Diagnostic::warning(
                "SNAPBACK_AUTH_AGENT_ONBOARDING_PROD_UNAVAILABLE",
                "auth",
                "auth.agents invitedBy operators has no production onboarding path; use invitedBy users or open registration",
            )]
        } else {
            Vec::new()
        }
    }

    pub fn api_exposure_diagnostics(&self, functions: &FunctionManifest) -> Vec<Diagnostic> {
        const PAGINATION_LINT_THRESHOLD: usize = 100;
        if !self.api.as_ref().is_some_and(|api| api.enabled) {
            return Vec::new();
        }
        functions
            .functions
            .iter()
            .filter(|function| {
                function.api_exposure.as_ref().is_some_and(|exposure| exposure.expose)
                    && matches!(function.kind, FunctionKind::Query | FunctionKind::LiveQuery)
                    && matches!(
                        &function.result_contract,
                        FunctionResultContract::Records { rows: Some(rows), .. }
                            if rows.max_items > PAGINATION_LINT_THRESHOLD
                    )
                    && !function.args_contract.as_ref().is_some_and(|contract| {
                        contract.fields.iter().any(|field| {
                            matches!(field.name.as_str(), "cursor" | "continuation")
                        })
                    })
            })
            .map(|function| {
                let FunctionResultContract::Records { rows: Some(rows), .. } =
                    &function.result_contract
                else {
                    unreachable!("pagination lint predicate selected bounded records")
                };
                Diagnostic::warning(
                    "SNAPBACK_API_PAGINATION_RECOMMENDED",
                    "api",
                    format!(
                        "exposed query {} declares rows.maxItems {} (> {}) without a cursor or continuation argument",
                        function.name, rows.max_items, PAGINATION_LINT_THRESHOLD
                    ),
                )
            })
            .collect()
    }

    /// Revalidate the codegen-compiled exposure fact against the exact paired
    /// function manifest. Artifact activation never trusts either half alone.
    pub fn validate_api_against_functions(
        &self,
        functions: &FunctionManifest,
    ) -> SnapbackResult<()> {
        let Some(api) = &self.api else {
            if functions
                .functions
                .iter()
                .any(|function| function.api_exposure.is_some())
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_API_EXPOSURE_COMPILATION_INVALID",
                    "api",
                    "function exposure facts require an enabled schema api declaration",
                ));
            }
            return Ok(());
        };
        let names = functions
            .functions
            .iter()
            .map(|function| function.name.as_str())
            .collect::<BTreeSet<_>>();
        if let Some(name) = api
            .functions
            .keys()
            .find(|name| !names.contains(name.as_str()))
        {
            return Err(SnapbackError::error(
                "SNAPBACK_API_FUNCTION_UNKNOWN",
                "api",
                format!("api.functions names unknown function {name}"),
            ));
        }
        for (name, exposure) in &api.functions {
            if exposure.approval.is_some() && !exposure.expose {
                return Err(SnapbackError::error(
                    "SNAPBACK_API_APPROVAL_REQUIRES_EXPOSURE",
                    "api",
                    format!(
                        "api.functions.{name}.approval requires expose: true so the gated effect has an externally named surface"
                    ),
                ));
            }
            if exposure.approval.is_some()
                && functions.functions.iter().any(|function| {
                    function.name == *name
                        && matches!(function.kind, FunctionKind::Query | FunctionKind::LiveQuery)
                })
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_API_APPROVAL_QUERY_INVALID",
                    "api",
                    format!(
                        "api.functions.{name}.approval is valid only for mutations and actions"
                    ),
                ));
            }
        }
        if let Some(oauth) = &api.oauth {
            for (bundle_name, bundle) in &oauth.bundles {
                for function_name in &bundle.functions {
                    if !names.contains(function_name.as_str()) {
                        return Err(SnapbackError::error(
                            "SNAPBACK_API_OAUTH_FUNCTION_UNKNOWN",
                            "api",
                            format!(
                                "api.oauth.bundles.{bundle_name}.functions names unknown function {function_name}"
                            ),
                        ));
                    }
                    if !api
                        .functions
                        .get(function_name)
                        .is_some_and(|exposure| exposure.expose)
                    {
                        return Err(SnapbackError::error(
                            "SNAPBACK_API_OAUTH_FUNCTION_NOT_EXPOSED",
                            "api",
                            format!(
                                "api.oauth bundle {bundle_name} names unexposed function {function_name}; expose it in api.functions"
                            ),
                        ));
                    }
                }
            }
        }
        if let Some(ask) = &api.ask
            && ask.billing == ApiAskBilling::App
            && let Some(secret) = ask.model.as_ref().and_then(|model| model.secret.as_ref())
        {
            let declared = functions
                .config
                .iter()
                .any(|entry| entry.name == *secret && entry.secret);
            if !declared {
                return Err(SnapbackError::error(
                    "SNAPBACK_API_ASK_SECRET_INVALID",
                    "api",
                    format!(
                        "api.ask.model.secret names {secret}, which must be a declared secret LLP 0036 config entry"
                    ),
                ));
            }
        }
        for function in &functions.functions {
            let expected = api.enabled.then(|| {
                api.functions
                    .get(&function.name)
                    .cloned()
                    .unwrap_or_default()
            });
            if function.api_exposure != expected {
                return Err(SnapbackError::error(
                    "SNAPBACK_API_EXPOSURE_COMPILATION_INVALID",
                    "api",
                    format!(
                        "function {} exposure does not match the schema api declaration",
                        function.name
                    ),
                ));
            }
        }
        Ok(())
    }
}

/// Public schema identity facts. The schema itself is intentionally public,
/// but artifact diagnostics are projected to their stable classification so
/// source paths and application values in producer-authored text stay gated.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicSchemaManifest {
    #[serde(rename = "artifactKind")]
    pub artifact_kind: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "appId")]
    pub app_id: String,
    pub app: Option<AppIdentity>,
    pub auth: Option<AuthManifest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<ApiManifest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assets: Option<SchemaAssetsPolicyV1>,
    #[serde(rename = "pushSeam", default, skip_serializing_if = "Option::is_none")]
    pub push_seam: Option<crate::push::PushSeamDeclarationV1>,
    #[serde(rename = "requiredCapabilities")]
    pub required_capabilities: Vec<String>,
    #[serde(rename = "identityBindingTables")]
    pub identity_binding_tables: Vec<IdentityBindingTableManifestV1>,
    #[serde(rename = "schemaHash")]
    pub schema_hash: Option<String>,
    #[serde(rename = "inputsHash")]
    pub inputs_hash: Option<String>,
    #[serde(rename = "authoredSourceHash")]
    pub authored_source_hash: Option<String>,
    #[serde(rename = "generatedAt")]
    pub generated_at: Option<u64>,
    #[serde(rename = "sourceHash")]
    pub source_hash: Option<String>,
    #[serde(rename = "artifactDiagnostics")]
    pub artifact_diagnostics: Vec<PublicDiagnostic>,
    #[serde(rename = "targetProfile")]
    pub target_profile: Option<String>,
    #[serde(rename = "portabilityFlags")]
    pub portability_flags: Vec<String>,
    #[serde(rename = "ephemeralCollections")]
    pub ephemeral_collections: Vec<EphemeralCollection>,
    #[serde(rename = "assetCollections")]
    pub asset_collections: Vec<AssetCollectionManifestV1>,
    pub tables: Vec<TableManifest>,
}

impl From<SchemaManifest> for PublicSchemaManifest {
    fn from(manifest: SchemaManifest) -> Self {
        let SchemaManifest {
            artifact_kind,
            schema_version,
            app_id,
            app,
            auth,
            auth_program: _,
            api,
            assets,
            push_seam,
            required_capabilities,
            identity_binding_tables,
            // The strict-declaration posture is server-enforcement authority,
            // not a client-facing schema fact (LLP 0146 D1).
            strict_declarations: _,
            // Visibility governance is target-owned activation authority and
            // must not be projected into the public client manifest.
            visibility_governance: _,
            schema_hash,
            inputs_hash,
            authored_source_hash,
            generated_at,
            source_hash,
            artifact_diagnostics,
            target_profile,
            portability_flags,
            ephemeral_collections,
            asset_collections,
            tables,
        } = manifest;
        Self {
            artifact_kind,
            schema_version,
            app_id,
            app,
            auth,
            api,
            assets,
            push_seam,
            required_capabilities,
            identity_binding_tables,
            schema_hash,
            inputs_hash,
            authored_source_hash,
            generated_at,
            source_hash,
            artifact_diagnostics: artifact_diagnostics.into_iter().map(Into::into).collect(),
            target_profile,
            portability_flags,
            ephemeral_collections,
            asset_collections,
            tables,
        }
    }
}

/// Finite product-history retention declared beside the table it governs.
/// This is authoring authority; storage projects it into the durable policy
/// table in the same transaction that publishes the schema manifest.
// @ref LLP 0162#6-bounded-history-and-named-checkpoints — history is opt-in,
// per-table, finite on both age and versions-per-record axes, and manifest-visible.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryRetentionManifestV1 {
    #[schemars(range(min = 1_u64, max = 2_592_000_000_u64))]
    pub retain_ms: u64,
    #[schemars(range(min = 1_u64, max = 1_000_u64))]
    pub max_versions_per_record: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TableManifest {
    pub name: String,
    #[serde(default)]
    pub fields: Vec<FieldManifest>,
    #[serde(default)]
    pub indexes: Vec<IndexManifest>,
    /// Portable full-text indexes over this ordinary table. Search metadata is
    /// table-local because source field/visibility validation and synchronous
    /// maintenance are schema obligations, not function-handler conventions.
    ///
    /// @ref LLP 0073#search-declarations — one versioned declaration owns the
    /// complete portable index semantics and work bounds.
    #[serde(
        default,
        rename = "searchIndexes",
        alias = "search_indexes",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub search_indexes: Vec<SearchIndexManifestV1>,
    /// Portable exact-vector index declarations. A declaration is authoring
    /// vocabulary, not support by itself: execution additionally requires a
    /// target that reports qualified `vector_search_v1`.
    ///
    /// @ref LLP 0132#index-declarations
    #[serde(
        default,
        rename = "vectorIndexes",
        alias = "vector_indexes",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub vector_indexes: Vec<VectorIndexManifestV1>,
    /// The one table-wide aggregate live-search subscription ceiling.
    /// Optional because absence selects the target's admitted default; it is
    /// table-scoped so indexes cannot publish conflicting aggregate answers.
    ///
    /// @ref LLP 0136#capability-id-and-claim-discipline-llp-0119-oq2-proposal
    #[serde(
        default,
        rename = "searchLiveLimits",
        alias = "search_live_limits",
        skip_serializing_if = "Option::is_none"
    )]
    pub search_live_limits: Option<SearchTableLiveLimitsV1>,
    #[serde(default)]
    pub syncable: bool,
    /// This table contains facts that grant or revoke authority. This axis is
    /// independent of query/result dependence and of function-level
    /// `authorityIndependent` declarations.
    ///
    /// @ref LLP 0053#two-orthogonal-declarations — permission-backing data is
    ///   an explicit table property, not inferred from function reads.
    #[serde(
        default,
        rename = "permissionBacking",
        alias = "permission_backing",
        skip_serializing_if = "is_false"
    )]
    pub permission_backing: bool,
    /// Optional narrowing for known updates. Inserts, deletes, and updates
    /// with absent/empty/unknown changed-field metadata remain conservative.
    #[serde(
        default,
        rename = "permissionFields",
        alias = "permission_fields",
        skip_serializing_if = "Option::is_none"
    )]
    pub permission_fields: Option<Vec<String>>,
    /// At most one `.membership()` declaration per table. Its presence turns
    /// the table into a system-recognized role-per-resource membership table:
    /// a closed role vocabulary, immutable `(principal, resource)` axes, a
    /// generated true-unique index, and a host-enforced write contract.
    /// Declaring it alongside a hand-written `permissionBacking`/
    /// `permissionFields` is a typed manifest error — the derivation owns the
    /// table.
    ///
    /// @ref LLP 0056#declaring-a-membership-table — the membership declaration
    ///   is the recognized shape; the derivation, not the app, owns the table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub membership: Option<MembershipManifest>,
    /// Rollout-1 projection of `.authorityProfile(...)`. This is a versioned
    /// authoring/codegen fact over the canonical membership and table-policy
    /// declarations; it adds no evaluator or independently writable roster.
    ///
    /// @ref LLP 0240#d1-declare-an-application-authority-profile-at-the-scoped-relation
    ///   — the app membership table remains the single authority source.
    /// @ref LLP 0240#d2-compile-one-authority-ir-for-read-and-write-decisions
    ///   — the projection references the shipped membership/policy IR.
    #[serde(
        default,
        rename = "authorityProfile",
        alias = "authority_profile",
        skip_serializing_if = "Option::is_none"
    )]
    pub authority_profile: Option<AuthorityProfileV1>,
    /// `.assetSharing(spec)` — the explicit declaration that this table's
    /// analyzable row-visibility policy is sufficient asset-sharing
    /// authority: anyone the spec admits may also read assets referenced
    /// from these rows. Without it a typed reference confers no
    /// `via-references` read authority (owner-only fallback).
    ///
    /// @ref LLP 0044#asset-read-authorization — sharing is never inferred
    ///   from a filter's existence; LLP 0007 dated amendment 2026-07-31
    ///   freezes the closed spelling.
    #[serde(
        default,
        rename = "assetSharing",
        alias = "asset_sharing",
        skip_serializing_if = "Option::is_none"
    )]
    pub asset_sharing: Option<AssetSharingManifest>,
    /// The table-wide default row-visibility declaration. Restricted leaves
    /// and bounded owner-or-membership groups are compiled into ordinary
    /// declarative query plans; public/implicit tables preserve legacy plan
    /// bytes by carrying no executable predicate.
    ///
    /// @ref LLP 0231#d1--the-table-is-the-policy-locus-queries-refine — the
    ///   table policy is compiled into ordinary declarative query plans;
    ///   arbitrary handler reads remain outside this bounded slice.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<TableVisibilityV1>,
    /// Optional bounded record-history policy. Absence disables product
    /// history for this table; v1 deliberately has no unbounded spelling.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history: Option<HistoryRetentionManifestV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchTableLiveLimitsV1 {
    pub max_live_subscriptions_per_table: u32,
}

/// The closed asset-sharing declaration, reusing the shipped visibility
/// union rather than a not-yet-implemented general permission language.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum AssetSharingManifest {
    PublicRead,
    Owner {
        field: String,
    },
    Membership {
        membership: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        roles: Option<Vec<String>>,
    },
}

/// The closed table-policy language. This is intentionally separate from
/// search and asset-sharing visibility: extending this enum does not widen
/// either of those independently enforced surfaces.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum TableVisibilityV1 {
    PublicRead,
    Owner {
        field: String,
    },
    Membership {
        declaration: String,
        #[serde(rename = "resourceField", alias = "resource_field")]
        resource_field: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        roles: Option<Vec<String>>,
    },
    AnyOf {
        arms: Vec<TableVisibilityArmV1>,
    },
}

/// A disjunction arm deliberately excludes public-read and recursive groups.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum TableVisibilityArmV1 {
    Owner {
        field: String,
    },
    Membership {
        declaration: String,
        #[serde(rename = "resourceField", alias = "resource_field")]
        resource_field: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        roles: Option<Vec<String>>,
    },
}

impl TableVisibilityV1 {
    pub fn is_restricted(&self) -> bool {
        !matches!(self, Self::PublicRead)
    }

    pub fn contains_membership(&self) -> bool {
        matches!(self, Self::Membership { .. })
            || matches!(self, Self::AnyOf { arms } if arms.iter().any(TableVisibilityArmV1::is_membership))
    }

    pub fn membership_predicates(&self) -> Vec<MembershipPredicate> {
        let predicate =
            |declaration: &String, resource_field: &String, roles: &Option<Vec<String>>| {
                MembershipPredicate {
                    declaration: declaration.clone(),
                    resource: MembershipResourceRef::RowField(resource_field.clone()),
                    roles: roles.clone(),
                }
            };
        match self {
            Self::Membership {
                declaration,
                resource_field,
                roles,
            } => vec![predicate(declaration, resource_field, roles)],
            Self::AnyOf { arms } => arms
                .iter()
                .filter_map(|arm| match arm {
                    TableVisibilityArmV1::Membership {
                        declaration,
                        resource_field,
                        roles,
                    } => Some(predicate(declaration, resource_field, roles)),
                    TableVisibilityArmV1::Owner { .. } => None,
                })
                .collect(),
            Self::PublicRead | Self::Owner { .. } => Vec::new(),
        }
    }
}

impl TableVisibilityArmV1 {
    pub fn is_membership(&self) -> bool {
        matches!(self, Self::Membership { .. })
    }
}

#[cfg(test)]
mod table_visibility_manifest_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn table_visibility_round_trips_the_closed_union() {
        for visibility in [
            json!({ "kind": "public-read" }),
            json!({ "kind": "owner", "field": "ownerId" }),
            json!({
                "kind": "membership",
                "declaration": "room-members",
                "resourceField": "roomId",
                "roles": ["member"],
            }),
            json!({
                "kind": "any-of",
                "arms": [
                    { "kind": "owner", "field": "ownerId" },
                    {
                        "kind": "membership",
                        "declaration": "room-members",
                        "resourceField": "roomId",
                        "roles": ["member"],
                    },
                ],
            }),
        ] {
            let authored = json!({ "name": "messages", "visibility": visibility });
            let parsed: TableManifest =
                serde_json::from_value(authored.clone()).expect("table manifest parses");
            let emitted = serde_json::to_value(parsed).expect("table manifest serializes");
            assert_eq!(emitted["visibility"], authored["visibility"]);
        }
    }

    #[test]
    fn table_visibility_effect_ceiling_observes_user_and_membership_inputs() {
        let check = |visibility: TableVisibilityV1, inputs: Vec<&str>| {
            let mut function = FunctionDefinition::new(
                "visibleNotes",
                FunctionKind::Query,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table_visibility: Some(visibility),
                    table: "notes".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                })),
            );
            function.effect_ceiling = Some(EffectCeiling {
                version: "EffectCeilingV1".to_owned(),
                basis: "static".to_owned(),
                reads: vec![EffectCeilingRead {
                    table: "notes".to_owned(),
                    access: "query".to_owned(),
                    index: None,
                }],
                writes: Vec::new(),
                host_operations: Vec::new(),
                authorization_inputs: inputs.into_iter().map(str::to_owned).collect(),
            });
            validate_effect_ceiling(&function)
        };

        check(
            TableVisibilityV1::Owner {
                field: "ownerId".to_owned(),
            },
            vec!["authUserId"],
        )
        .expect("owner policy observes the effective user only");
        let any_of = TableVisibilityV1::AnyOf {
            arms: vec![
                TableVisibilityArmV1::Owner {
                    field: "ownerId".to_owned(),
                },
                TableVisibilityArmV1::Membership {
                    declaration: "note-followers".to_owned(),
                    resource_field: "_id".to_owned(),
                    roles: Some(vec!["follower".to_owned()]),
                },
            ],
        };
        check(any_of.clone(), vec!["authUserId", "membershipPredicate"])
            .expect("membership arm observes both closed authorization inputs");
        let error = check(any_of, vec!["authUserId"])
            .expect_err("a doctored ceiling cannot omit membershipPredicate");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_FUNCTION_EFFECT_CEILING_EXCEEDED"
        );
    }
}

impl TableManifest {
    pub fn field(&self, name: &str) -> Option<&FieldManifest> {
        self.fields.iter().find(|field| field.name == name)
    }

    /// Whether writes to this table are authorization events under LLP 0053.
    /// A membership declaration is permission-backing by construction; the
    /// app must not repeat the lower-level `permissionBacking` flag (schema
    /// validation rejects that ambiguous double declaration).
    ///
    /// @ref LLP 0056#invalidation-the-llp-0053-mapping — every membership
    ///   declaration is permission-backing, for every writer.
    pub fn is_permission_backing(&self) -> bool {
        self.permission_backing || self.membership.is_some()
    }

    /// Whether a known update to `field` can change authorization. Ordinary
    /// permission-backing tables use their optional `permissionFields`
    /// narrowing. Membership tables invert their explicit `incidental`
    /// attestation: every declared field is authorization-relevant unless the
    /// declaration proves it inert. The membership validator keeps the
    /// principal/resource/role axes out of `incidental`.
    ///
    /// Unknown fields are handled conservatively by callers before consulting
    /// this method.
    pub fn field_affects_authorization(&self, field: &str) -> bool {
        if let Some(membership) = &self.membership {
            return !membership
                .incidental
                .iter()
                .flatten()
                .any(|incidental| incidental == field);
        }
        self.permission_fields
            .as_ref()
            .is_none_or(|permission_fields| permission_fields.iter().any(|item| item == field))
    }
}

/// The scope a membership declaration binds its `resource` axis to.
///
/// @ref LLP 0056#global-roles — a `resource`-scoped declaration references one
///   resource table; `app` scope is the degenerate global-role case whose
///   resource is a system-constant singleton (never a null column).
#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum MembershipScope {
    /// The declared `resource` column references exactly one resource table.
    #[default]
    Resource,
    /// The whole app is the resource (classic global RBAC as the degenerate
    /// case). There is no `resource` column; uniqueness is one row per
    /// principal per declaration.
    App,
}

/// `lastHolder: { protect: <role> }` — the protected role's *eligible* holder
/// set may never be left empty for any live resource. Schema activation
/// validates the declaration and existing rows; the write path preserves the
/// invariant with commit-time concurrency checks.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the
///   protected role never empties; establishment requires `bootstrapRole == R`.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipLastHolder {
    pub protect: String,
}

/// `principalAddressedWrites: { remove: true }` — the closed opt-in for the
/// generated principal-addressed removal command (LLP 0100 §2). The object
/// is closed and v1 admits only `remove: true`: false, unknown operations,
/// and unknown fields fail activation, and no principal-addressed `setRole`,
/// `patch`, or read is implied.
///
/// @ref LLP 0100#2-opting-into-principal-addressed-removal — activation
///   additionally requires at least one total other-principal removal
///   transition, and under `lastHolder` every carrier caller role must be
///   the protected role (the hidden-role-oracle closure).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipPrincipalAddressedWrites {
    pub remove: bool,
}

/// `expiry: { field, onExpiry }` — a time-bounded membership materialized by
/// the host-bound sweep. In v1 the only `onExpiry` effect is `remove`: with no
/// declared role ordering the host cannot prove any downgrade is
/// non-escalating, so a `downgradeTo:` effect is a manifest error.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — remove-only
///   in v1; the host owns the rollback-checked sweep.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipExpiry {
    pub field: String,
    /// The declared expiry effect. v1 accepts exactly `"remove"`; any other
    /// spelling (e.g. `"downgradeTo:guest"`) is refused by `validate_schema`.
    #[serde(rename = "onExpiry", alias = "on_expiry")]
    pub on_expiry: String,
}

/// The two host-filled attribution levels. `authorityCreating` (LLP 0055)
/// requires `full`. Schema validation enforces the `incidental` floor over
/// the generated provenance columns; the membership writer fills those
/// columns and records the append-only transition log.
///
/// @ref LLP 0056#agents — creation attribution vs. the append-only transition
///   log; `full` is `authorityCreating`'s precondition.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum MembershipProvenance {
    Creation,
    Full,
}

/// The op a transition governs. The manifest loader shape-validates it, and
/// the host evaluates the matrix with caller-class derivation, target binding,
/// and witness capture at the central membership write seam.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MembershipOp {
    Insert,
    SetRole,
    Remove,
    Patch,
}

impl MembershipOp {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Insert => "insert",
            Self::SetRole => "setRole",
            Self::Remove => "remove",
            Self::Patch => "patch",
        }
    }
}

/// Whether a transition acts on the caller's own row or another principal's.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum MembershipTarget {
    /// The effective principal **is** the target row's principal ("self").
    #[serde(rename = "self")]
    Own,
    Other,
}

impl MembershipTarget {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Own => "self",
            Self::Other => "other",
        }
    }
}

/// One row of the closed, declaration-level transition matrix (`op` × caller
/// class × self/other × `from`→`to`, or `patch` × `fields`). Manifest loading
/// **shape-validates** every entry — chiefly that no unknown role hides in
/// `by`/`from`/`to` and no undeclared column hides in `fields`, so the closed
/// vocabulary holds. The runtime evaluates this same matrix for every
/// declaration-bound membership write.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the
///   policy is declared, closed by default, and enforced by the host.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipTransition {
    pub op: MembershipOp,
    /// Caller classes: a declared role, or the reserved classes `"self"` /
    /// `"none"`.
    pub by: Vec<String>,
    pub target: MembershipTarget,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<Vec<String>>,
    /// Non-axis, non-role columns a `patch` transition may write.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<Vec<String>>,
}

/// The `.membership()` metadata carried by a [`TableManifest`]. See
/// `crate::storage`'s `validate_schema` for the declaration-shape enforcement
/// and `validate_membership_activation` for the fail-closed scan over existing
/// data.
///
/// The public authoring path emits this exact shape from `.membership()`,
/// including nominal `v.principal()` / `v.id(table)` axes. Schema activation
/// validates existing rows and installs the generated indexes; the host then
/// enforces transition writes, declaration-bound reads, invalidation, and
/// provenance below every app writer.
///
/// @ref LLP 0056#declaring-a-membership-table — the recognized membership
///   shape and its closed, non-null, exact-decoded vocabulary.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipManifest {
    /// Stable declaration id. Absent means it defaults from the table name
    /// (see [`MembershipManifest::effective_id`]); pin it with `id:` to keep a
    /// durable reference stable across a table rename.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Name of the non-null principal-axis field (`v.principal()`).
    pub principal: String,
    /// Name of the non-null resource-axis field. Absent iff `scope: "app"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
    /// Name of the non-null role field.
    pub role: String,
    /// The closed, non-pending role vocabulary.
    pub roles: Vec<String>,
    /// Pending roles — in the write vocabulary but excluded from `memberOf`.
    /// Disjoint from `roles`; their union is the closed write vocabulary.
    #[serde(
        default,
        rename = "pendingRoles",
        alias = "pending_roles",
        skip_serializing_if = "Option::is_none"
    )]
    pub pending_roles: Option<Vec<String>>,
    /// The role the creation witness seats. Required to equal `lastHolder`'s
    /// protected role when `lastHolder` is declared.
    #[serde(
        default,
        rename = "bootstrapRole",
        alias = "bootstrap_role",
        skip_serializing_if = "Option::is_none"
    )]
    pub bootstrap_role: Option<String>,
    #[serde(
        default,
        rename = "lastHolder",
        alias = "last_holder",
        skip_serializing_if = "Option::is_none"
    )]
    pub last_holder: Option<MembershipLastHolder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expiry: Option<MembershipExpiry>,
    /// Attested non-authorization columns. Subject to a hard floor: the
    /// principal/resource/role axes and generated provenance columns can never
    /// be attested incidental.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub incidental: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<MembershipProvenance>,
    /// The closed transition matrix. Shape-validated at manifest load and
    /// executed at the central membership write seam.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub transitions: Vec<MembershipTransition>,
    /// Explicit opt-in to principal-addressed writes (LLP 0100 §2). Absent
    /// means the generated `removePrincipal` surface does not exist for this
    /// declaration; presence requires at least one total other-principal
    /// removal transition at activation. Closed: v1 admits only
    /// `{ remove: true }`.
    #[serde(
        default,
        rename = "principalAddressedWrites",
        alias = "principal_addressed_writes",
        skip_serializing_if = "Option::is_none"
    )]
    pub principal_addressed_writes: Option<MembershipPrincipalAddressedWrites>,
    #[serde(default)]
    pub scope: MembershipScope,
    /// The resource table the `resource` axis references (`v.id("events")`).
    /// Present for `scope: "resource"`; absent for `scope: "app"`. Used by the
    /// activation scan's referential-integrity check. Codegen derives it from
    /// the nominal `v.id(...)` resource-axis declaration; direct manifests are
    /// still validated against the same binding.
    #[serde(
        default,
        rename = "resourceTable",
        alias = "resource_table",
        skip_serializing_if = "Option::is_none"
    )]
    pub resource_table: Option<String>,
}

impl MembershipManifest {
    /// The effective stable declaration id: the pinned `id:` if present, else
    /// the table name. Used by helpers, audit, room bindings, and (future)
    /// durable references.
    pub fn effective_id<'a>(&'a self, table_name: &'a str) -> &'a str {
        self.id.as_deref().unwrap_or(table_name)
    }

    /// The closed write vocabulary: `roles ∪ pendingRoles`.
    pub fn vocabulary(&self) -> impl Iterator<Item = &str> {
        self.roles
            .iter()
            .map(String::as_str)
            .chain(self.pending_roles.iter().flatten().map(String::as_str))
    }
}

fn compare_utf16_vectors(left: &[String], right: &[String]) -> std::cmp::Ordering {
    left.iter()
        .zip(right)
        .map(|(left, right)| crate::rqs_contract::cmp_utf16(left, right))
        .find(|ordering| !ordering.is_eq())
        .unwrap_or_else(|| left.len().cmp(&right.len()))
}

fn compare_optional_utf16_vectors(
    left: Option<&Vec<String>>,
    right: Option<&Vec<String>>,
) -> std::cmp::Ordering {
    match (left, right) {
        (None, None) => std::cmp::Ordering::Equal,
        (None, Some(_)) => std::cmp::Ordering::Less,
        (Some(_), None) => std::cmp::Ordering::Greater,
        (Some(left), Some(right)) => compare_utf16_vectors(left, right),
    }
}

/// Canonical, order-stable copy of a membership transition matrix. The row
/// order is semantically irrelevant (rows authorize rather than select), and
/// `by`/`from`/`to`/`fields` are sets. Authority-profile identity therefore
/// sorts every set and then every complete row by the closed semantic tuple,
/// preserving duplicates so the embedded matrix remains an exact projection.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the
///   complete matrix, including caller classes and field coverage, is the
///   runtime authorization policy.
pub fn canonical_membership_transition_matrix(
    transitions: &[MembershipTransition],
) -> Vec<MembershipTransition> {
    let mut canonical = transitions.to_vec();
    for transition in &mut canonical {
        transition
            .by
            .sort_by(|left, right| crate::rqs_contract::cmp_utf16(left, right));
        for values in [
            &mut transition.from,
            &mut transition.to,
            &mut transition.fields,
        ] {
            if let Some(values) = values {
                values.sort_by(|left, right| crate::rqs_contract::cmp_utf16(left, right));
            }
        }
    }
    canonical.sort_by(|left, right| {
        crate::rqs_contract::cmp_utf16(left.op.as_str(), right.op.as_str())
            .then_with(|| {
                crate::rqs_contract::cmp_utf16(left.target.as_str(), right.target.as_str())
            })
            .then_with(|| compare_utf16_vectors(&left.by, &right.by))
            .then_with(|| compare_optional_utf16_vectors(left.from.as_ref(), right.from.as_ref()))
            .then_with(|| compare_optional_utf16_vectors(left.to.as_ref(), right.to.as_ref()))
            .then_with(|| {
                compare_optional_utf16_vectors(left.fields.as_ref(), right.fields.as_ref())
            })
    });
    canonical
}

/// Stable identity of one authority-profile generation. Function manifests
/// carry this beside their ordinary authorization dimensions so a role-field
/// or transition edit is visible to dependent artifact review without
/// changing the evaluator's existing membership predicate shape.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileIdentityV1 {
    pub id: String,
    pub generation: String,
}

/// Closed identity of an authority-profile operation synthesized by codegen.
/// This is a manifest fact emitted from a module-private generator marker;
/// function names and declared dependencies alone never grant this identity.
// @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface — private
// transition marshalling is capability-gated by generated operation identity.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum GeneratedAuthorityOperationKindV1 {
    List,
    MyRole,
    History,
    Incarnations,
    SnapshotRecipients,
    Invite,
    Join,
    Leave,
    ChangeRole,
    TransferOwner,
    Remove,
}

impl GeneratedAuthorityOperationKindV1 {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::List => "list",
            Self::MyRole => "myRole",
            Self::History => "history",
            Self::Incarnations => "incarnations",
            Self::SnapshotRecipients => "snapshotRecipients",
            Self::Invite => "invite",
            Self::Join => "join",
            Self::Leave => "leave",
            Self::ChangeRole => "changeRole",
            Self::TransferOwner => "transferOwner",
            Self::Remove => "remove",
        }
    }

    pub fn is_mutation(self) -> bool {
        !matches!(
            self,
            Self::List | Self::MyRole | Self::History | Self::Incarnations
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GeneratedAuthorityOperationV1 {
    pub id: String,
    pub generation: String,
    pub operation: GeneratedAuthorityOperationKindV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipient_sink: Option<AuthorityProfileRecipientSinkV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileMembershipReferenceV1 {
    pub declaration: String,
    pub manifest_path: String,
    pub predicate_identity: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileTablePolicyReferenceV1 {
    pub identity: String,
    pub membership_declaration: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileScopeRelationV1 {
    pub table: String,
    pub resource_field: String,
    pub resource_table: String,
    pub principal_key: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileStatusPredicatesV1 {
    pub active: String,
    pub invited: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileRoleV1 {
    pub role: String,
    pub implies: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileOwnerBootstrapInvariantV1 {
    pub role: String,
    pub bootstrap_role: String,
    pub protected_last_holder_role: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileTransitionPreconditionsV1 {
    pub source: String,
    /// The explicitly pinned membership declaration id. Profile-backed tables
    /// never use the ordinary table-name fallback because that would let a
    /// rename retarget an authorization profile without rotating its declared
    /// stable identity.
    pub membership_declaration_id: String,
    /// Canonical copy of every transition row that runtime authorization may
    /// consult. This makes the closed profile generation cover caller classes,
    /// predecessor/successor roles, and field-bound writes directly.
    pub matrix: Vec<MembershipTransition>,
    /// Exact membership provenance mode consumed by delegated service-principal
    /// admission and transition-log recording. `None` is emitted as JSON null,
    /// so absence cannot collapse into either declared mode.
    pub provenance: Option<MembershipProvenance>,
    /// Whether the membership declaration installs the host-owned expiry
    /// sweep. The sweep's detailed shape is validated on the canonical
    /// membership declaration; its authority-relevant presence is generation
    /// bound here.
    pub expiry_present: bool,
    /// Exact closed `principalAddressedWrites.remove` value. `None` is emitted
    /// as JSON null and remains distinct from the only admitted value, `true`.
    pub principal_addressed_writes_remove: Option<bool>,
    pub owner_mutation: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileSubjectDerivationV1 {
    pub strategy: String,
    pub principal_field: String,
    pub scope_field: String,
    /// The conservative target universe when a consumer cannot qualify the
    /// exact `(principal, scope)` invalidation path. This is metadata only in
    /// rollout 1; no new wake behavior is installed here.
    pub coarse_global_wake_universe: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileRequiredIndexV1 {
    pub name: String,
    pub fields: Vec<String>,
    pub unique: bool,
    pub lookup: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileRosterV1 {
    pub visible_fields: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileHistoryProjectionV1 {
    pub visible_fields: Vec<String>,
    pub incarnation_semantics: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileRecipientProjectionV1 {
    pub ceiling: u16,
    pub overflow: String,
    pub freeze: String,
    #[serde(default)]
    pub sinks: Vec<AuthorityProfileRecipientSinkV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileRecipientSinkV1 {
    pub operation: String,
    pub table: String,
    pub scope_field: String,
    pub recipients_field: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileHistoryHorizonCarrierV1 {
    pub carrier: String,
    pub coverage: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileProjectionV1 {
    pub version: u8,
    pub source: String,
    pub history: AuthorityProfileHistoryProjectionV1,
    pub recipients: AuthorityProfileRecipientProjectionV1,
    pub history_horizon: AuthorityProfileHistoryHorizonCarrierV1,
    pub offline_retention: String,
}

/// One generated rollout-2 operation. The operation vocabulary is closed by
/// codegen; transition ops name the LLP 0056 planner rows (or the dedicated
/// transfer planner) that remain the server-side authority boundary.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AuthorityProfileOperationNameV1 {
    #[serde(rename = "list")]
    List,
    #[serde(rename = "myRole")]
    MyRole,
    #[serde(rename = "history")]
    History,
    #[serde(rename = "incarnations")]
    Incarnations,
    #[serde(rename = "invite")]
    Invite,
    #[serde(rename = "join")]
    Join,
    #[serde(rename = "leave")]
    Leave,
    #[serde(rename = "changeRole")]
    ChangeRole,
    #[serde(rename = "transferOwner")]
    TransferOwner,
    #[serde(rename = "remove")]
    Remove,
}

impl AuthorityProfileOperationNameV1 {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::List => "list",
            Self::MyRole => "myRole",
            Self::History => "history",
            Self::Incarnations => "incarnations",
            Self::Invite => "invite",
            Self::Join => "join",
            Self::Leave => "leave",
            Self::ChangeRole => "changeRole",
            Self::TransferOwner => "transferOwner",
            Self::Remove => "remove",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AuthorityProfileHookV1 {
    #[serde(rename = "useSnapbackQuery")]
    Query,
    #[serde(rename = "useSnapbackAuthorityRoster")]
    AuthorityRoster,
    #[serde(rename = "useSnapbackAuthorityMyRole")]
    AuthorityMyRole,
    #[serde(rename = "useSnapbackAuthorityHistory")]
    AuthorityHistory,
    #[serde(rename = "useSnapbackAuthorityIncarnations")]
    AuthorityIncarnations,
    #[serde(rename = "useSnapbackMutation")]
    Mutation,
    #[serde(rename = "useSnapbackAuthorityMutation")]
    AuthorityMutation,
    #[serde(rename = "useSnapbackOutbox.mutationStatus")]
    OutboxMutationStatus,
    #[serde(rename = "useSnapbackAuthorityMutationStatus")]
    AuthorityMutationStatus,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AuthorityProfileTransitionOpV1 {
    #[serde(rename = "insert")]
    Insert,
    #[serde(rename = "setRole")]
    SetRole,
    #[serde(rename = "remove")]
    Remove,
    #[serde(rename = "transferOwner")]
    TransferOwner,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileOperationV1 {
    pub name: AuthorityProfileOperationNameV1,
    pub kind: FunctionKind,
    pub auth_requirement: AuthRequirement,
    pub hooks: Vec<AuthorityProfileHookV1>,
    pub transition_ops: Vec<AuthorityProfileTransitionOpV1>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outcomes: Vec<AuthorityProfileOperationOutcomeV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileOperationOutcomeV1 {
    pub branch: String,
    pub outcome: AuthorityProfileOutcomeClassV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AuthorityProfileOutcomeClassV1 {
    #[serde(rename = "idempotent-success-unchanged")]
    IdempotentSuccessUnchanged,
    #[serde(rename = "typed-precondition-refusal")]
    TypedPreconditionRefusal,
    #[serde(rename = "non-enumerating-denial")]
    NonEnumeratingDenial,
}

/// The closed rollout-2 authority profile projection. Canonical membership
/// remains in [`TableManifest::membership`] and table policy remains in
/// [`TableManifest::visibility`]; reference fields below make that ownership
/// explicit while carrying the profile-only lattice, identity, and
/// qualification facts codegen needs to explain.
///
/// @ref LLP 0240#d2-compile-one-authority-ir-for-read-and-write-decisions —
///   one generated projection feeds the already-shipped policy vocabulary.
/// @ref LLP 0225#1-ownership-map — this cross-owner value shape lives in the
///   manifest leaf; storage/evaluators consume only their existing carriers.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityProfileV1 {
    pub version: u8,
    pub id: String,
    pub generation: String,
    pub membership: AuthorityProfileMembershipReferenceV1,
    pub table_policy: AuthorityProfileTablePolicyReferenceV1,
    pub scope_relation: AuthorityProfileScopeRelationV1,
    pub status_predicates: AuthorityProfileStatusPredicatesV1,
    pub role_lattice: Vec<AuthorityProfileRoleV1>,
    pub owner_bootstrap_invariant: AuthorityProfileOwnerBootstrapInvariantV1,
    pub transition_preconditions: AuthorityProfileTransitionPreconditionsV1,
    pub authorization_event_fields: Vec<String>,
    pub subject_derivation: AuthorityProfileSubjectDerivationV1,
    pub required_indexes: Vec<AuthorityProfileRequiredIndexV1>,
    pub permitted_composition_classes: Vec<String>,
    pub not_yet_qualified_composition_classes: Vec<String>,
    pub roster: AuthorityProfileRosterV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub projection: Option<AuthorityProfileProjectionV1>,
    pub operations: Vec<AuthorityProfileOperationV1>,
}

#[cfg(test)]
mod authority_profile_manifest_tests {
    use super::*;
    use serde_json::json;

    fn profile_json() -> Value {
        json!({
            "version": 1,
            "id": "eventMembers",
            "generation": "sha256:profile-generation",
            "membership": {
                "declaration": "eventMembers",
                "manifestPath": "tables.eventMembers.membership",
                "predicateIdentity": "snapback.membership-predicate.v1"
            },
            "tablePolicy": {
                "identity": "snapback.table-visibility.v1",
                "membershipDeclaration": "eventMembers"
            },
            "scopeRelation": {
                "table": "eventMembers",
                "resourceField": "eventId",
                "resourceTable": "events",
                "principalKey": "userId"
            },
            "statusPredicates": {
                "active": "membership.roles",
                "invited": "membership.pendingRoles"
            },
            "roleLattice": [
                { "role": "owner", "implies": ["admin", "member", "owner"] },
                { "role": "admin", "implies": ["admin", "member"] },
                { "role": "member", "implies": ["member"] }
            ],
            "ownerBootstrapInvariant": {
                "role": "owner",
                "bootstrapRole": "owner",
                "protectedLastHolderRole": "owner"
            },
            "transitionPreconditions": {
                "source": "membership.transitions",
                "membershipDeclarationId": "eventMembers",
                "matrix": [
                    {
                        "op": "insert",
                        "by": ["owner"],
                        "target": "other",
                        "to": ["invited"]
                    },
                    {
                        "op": "setRole",
                        "by": ["self"],
                        "target": "self",
                        "from": ["invited"],
                        "to": ["member"]
                    }
                ],
                "provenance": "full",
                "expiryPresent": false,
                "principalAddressedWritesRemove": null,
                "ownerMutation": "transfer-owner-only"
            },
            "authorizationEventFields": ["eventId", "userId", "role"],
            "subjectDerivation": {
                "strategy": "membership-principal-resource-v1",
                "principalField": "userId",
                "scopeField": "eventId",
                "coarseGlobalWakeUniverse": [
                    "membership-relation-insert-update-delete",
                    "protected-resource-row-insert-update-delete",
                    "effective-principal-or-auth-context-change",
                    "authority-profile-generation-activation"
                ]
            },
            "requiredIndexes": [
                {
                    "name": "_membership_pk",
                    "fields": ["userId", "eventId"],
                    "unique": true,
                    "lookup": "principal-in-scope-point"
                },
                {
                    "name": "_membership_reverse",
                    "fields": ["eventId", "role", "userId"],
                    "unique": false,
                    "lookup": "protected-holders-and-scope-invalidation-range"
                }
            ],
            "permittedCompositionClasses": ["table-visibility.membership.v1"],
            "notYetQualifiedCompositionClasses": [
                "membership-visible-search.v1",
                "authority-profile-asset-sharing.v1"
            ],
            "roster": { "visibleFields": ["userId", "role"] },
            "operations": [
                {
                    "name": "list",
                    "kind": "LiveQuery",
                    "authRequirement": "authenticated",
                    "hooks": ["useSnapbackQuery", "useSnapbackAuthorityRoster"],
                    "transitionOps": []
                },
                {
                    "name": "transferOwner",
                    "kind": "Mutation",
                    "authRequirement": "authenticated",
                    "hooks": ["useSnapbackMutation", "useSnapbackAuthorityMutation", "useSnapbackOutbox.mutationStatus", "useSnapbackAuthorityMutationStatus"],
                    "transitionOps": ["transferOwner"]
                }
            ]
        })
    }

    #[test]
    fn authority_profile_v1_round_trips_the_closed_projection() {
        let authored = profile_json();
        let parsed: AuthorityProfileV1 =
            serde_json::from_value(authored.clone()).expect("authority profile parses");
        assert_eq!(
            serde_json::to_value(parsed).expect("authority profile serializes"),
            authored
        );
    }

    #[test]
    fn authority_profile_v1_refuses_unknown_projection_fields() {
        let mut authored = profile_json();
        authored
            .as_object_mut()
            .expect("profile object")
            .insert("rosterHook".to_owned(), json!("useAuthorityRoster"));
        serde_json::from_value::<AuthorityProfileV1>(authored)
            .expect_err("rollout 2 admits only the pinned operations and hook projection");
    }

    #[test]
    fn authority_profile_v1_refuses_unknown_operation_and_hook_vocabulary() {
        for (field, value) in [
            ("name", json!("promoteOwner")),
            ("hooks", json!(["useAuthorityMutation"])),
            ("transitionOps", json!(["replaceRoster"])),
        ] {
            let mut authored = profile_json();
            authored["operations"][1][field] = value;
            serde_json::from_value::<AuthorityProfileV1>(authored)
                .expect_err("rollout 2 operation vocabulary stays closed");
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct FunctionManifest {
    #[serde(
        default = "function_manifest_kind",
        rename = "artifactKind",
        alias = "artifact_kind"
    )]
    pub artifact_kind: String,
    #[serde(
        default = "snapback_schema_version",
        rename = "schemaVersion",
        alias = "schema_version"
    )]
    pub schema_version: String,
    #[serde(default = "local_app_id", rename = "appId", alias = "app_id")]
    pub app_id: String,
    #[serde(default, rename = "bundleHash", alias = "bundle_hash")]
    pub bundle_hash: Option<String>,
    #[serde(default, rename = "inputsHash", alias = "inputs_hash")]
    pub inputs_hash: Option<String>,
    #[serde(default, rename = "authoredSourceHash", alias = "authored_source_hash")]
    pub authored_source_hash: Option<String>,
    #[serde(default, rename = "generatedAt", alias = "generated_at")]
    pub generated_at: Option<u64>,
    #[serde(
        default,
        rename = "unsupportedDependencyDiagnostics",
        alias = "unsupported_dependency_diagnostics"
    )]
    pub unsupported_dependency_diagnostics: Vec<Diagnostic>,
    /// Experimental-capability acknowledgments for the generated artifact
    /// pair (LLP 0058 §Capability maturity, amendment 2026-07-24): the
    /// registry ids this artifact knowingly requires at experimental
    /// maturity. Emitted by codegen from the same closed capability table it
    /// derives requirements from; admission refuses an experimental
    /// requirement the artifact does not acknowledge. Acknowledging a stable
    /// id is a no-op, so promotion to stable never breaks the artifact, and
    /// an acknowledgment can never make an unsupported capability supported.
    #[serde(
        default,
        rename = "acknowledgedExperimentalCapabilities",
        alias = "acknowledged_experimental_capabilities",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub acknowledged_experimental_capabilities: Vec<String>,
    #[serde(default)]
    pub functions: Vec<FunctionDefinition>,
    #[serde(default, rename = "cronJobs", alias = "cron_jobs")]
    pub cron_jobs: Vec<CronJobDefinition>,
    /// @ref LLP 0036#declared-configuration-in-the-manifest — declared config
    /// entries ride the generated function manifest the way cron jobs do.
    #[serde(default)]
    pub config: Vec<ConfigEntryDefinition>,
    /// Transactionally maintained projections (LLP 0080 §5). Activation
    /// validates each plan against the schema and the whole active set (the
    /// per-source write-budget proof), and every source mutation maintains
    /// the output in its own commit.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub projections: Vec<MaintainedProjectionPlan>,
    /// Generated upload intents (LLP 0044 §Generated upload intents; LLP
    /// 0037 dated alignment 2026-07-31). Deliberately their own section —
    /// an intent is not a callable function, appears in no public function
    /// listing, and its authorizer executes only through the asset attempt
    /// admission path.
    #[serde(
        default,
        rename = "assetUploadIntents",
        alias = "asset_upload_intents",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub asset_upload_intents: Vec<AssetUploadIntentDefinition>,
}

/// One generated upload intent: the declared, client-unwidenable policy
/// plus the server-executed authorizer. The declaration fixes accepted
/// types, byte bounds, delivery profile, read-access policy, and processing
/// recipe (LLP 0044 §Generated upload intents).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetUploadIntentDefinition {
    /// Stable identity, `app:intent` like function ids.
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default, rename = "exportedName", alias = "exported_name")]
    pub exported_name: Option<String>,
    #[serde(default, rename = "implementationHash", alias = "implementation_hash")]
    pub implementation_hash: Option<String>,
    #[serde(default, rename = "argsContractHash", alias = "args_contract_hash")]
    pub args_contract_hash: Option<String>,
    /// Hash over the declared accept/delivery/access/image/video/auth facts —
    /// the admitted policy identity an attempt finalizes under.
    #[serde(rename = "intentPolicyHash", alias = "intent_policy_hash")]
    pub intent_policy_hash: String,
    #[serde(default, rename = "authRequirement", alias = "auth_requirement")]
    pub auth_requirement: Option<AuthRequirement>,
    pub accept: AssetAcceptPolicy,
    pub delivery: AssetDeliveryPolicy,
    pub access: AssetAccessPolicy,
    /// Recipient-scoped grant edges are an explicit authority opt-in. Absent
    /// is canonical so manifests and policy hashes produced before LLP 0210
    /// retain their exact bytes and semantics.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub grants: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<AssetImagePolicy>,
    /// @ref LLP 0044#video-location-policy-the-video--location--sibling-block-dated-decision-2026-08-03 —
    /// video location policy has its own manifest carrier rather than
    /// overloading or aliasing the frozen image-policy spelling.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<AssetVideoPolicy>,
    /// Declared lifecycle callbacks; absent stays canonical so pre-existing
    /// intent policy hashes are unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on: Option<AssetCallbackPolicy>,
    #[serde(default, rename = "declaredReads", alias = "declared_reads")]
    pub declared_reads: Vec<String>,
    pub runtime: FunctionRuntime,
    #[serde(default, rename = "handlerForm", alias = "handler_form")]
    pub handler_form: Option<String>,
    #[serde(default, rename = "sourceSpan", alias = "source_span")]
    pub source_span: Option<SourceSpan>,
}

/// Schema-level asset policy block (`defineSchema(..., { assets })`).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaAssetsPolicyV1 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference_gc: Option<AssetReferenceGcPolicyV1>,
}

/// The app's reference-GC opt-in: a ready asset with no typed
/// reverse-reference edges is reclaimed after this grace period. Codegen
/// refuses a grace outside the target's declared Enforced bounds.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetReferenceGcPolicyV1 {
    pub grace_ms: u64,
}

/// Declared lifecycle callbacks: each names an ordinary generated mutation
/// invoked with typed facts — under owner authority in dev mode or the ruled
/// `asset-callbacks` service principal in sessions mode — never raw byte
/// authority (LLP 0044 §Declarative processing).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetCallbackPolicy {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ready: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rejected: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetAcceptPolicy {
    #[serde(rename = "mediaTypes", alias = "media_types")]
    pub media_types: Vec<String>,
    #[serde(rename = "maxBytes", alias = "max_bytes")]
    pub max_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetDeliveryPolicy {
    pub kind: crate::assets::AssetDeliveryProfile,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetAccessPolicy {
    pub read: crate::assets::AssetReadAccessPolicy,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetImagePolicy {
    /// Mandatory-explicit for location-bearing media; there is no implicit
    /// fallback (LLP 0044 §Generated upload intents).
    pub location: AssetLocationPolicy,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variants: Vec<AssetImageVariant>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetVideoPolicy {
    /// Mandatory-explicit for location-bearing video; there is no implicit
    /// fallback (LLP 0044 §Video location policy).
    pub location: AssetLocationPolicy,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AssetLocationPolicy {
    Strip,
    Retain,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetImageVariant {
    pub key: String,
    pub width: u64,
    /// A required variant is part of the asset-ready contract (LLP 0044
    /// §Lifecycle transitions); absent means optional, and absence is
    /// canonical so pre-existing intent policy hashes are unchanged.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub required: bool,
}

impl Default for FunctionManifest {
    fn default() -> Self {
        Self {
            artifact_kind: function_manifest_kind(),
            schema_version: snapback_schema_version(),
            app_id: local_app_id(),
            bundle_hash: None,
            inputs_hash: None,
            authored_source_hash: None,
            generated_at: None,
            unsupported_dependency_diagnostics: Vec::new(),
            acknowledged_experimental_capabilities: Vec::new(),
            functions: Vec::new(),
            cron_jobs: Vec::new(),
            config: Vec::new(),
            projections: Vec::new(),
            asset_upload_intents: Vec::new(),
        }
    }
}

impl FunctionManifest {
    /// The artifact's experimental acknowledgments parsed to registry ids
    /// (unknown strings are inert; see `parse_acknowledged_capabilities`).
    pub fn acknowledged_capability_ids(&self) -> BTreeSet<TargetCapabilityId> {
        CapabilityManifest::parse_acknowledged_capabilities(
            self.acknowledged_experimental_capabilities
                .iter()
                .map(String::as_str),
        )
    }

    pub fn function(&self, name: &str) -> Option<&FunctionDefinition> {
        self.functions
            .iter()
            .find(|function| function.name == name || function.id == name)
    }

    pub fn validate_artifact(&self) -> SnapbackResult<()> {
        validate_artifact_header(
            "function",
            "functionManifest",
            &self.artifact_kind,
            &self.schema_version,
            self.bundle_hash.as_deref(),
            self.inputs_hash.as_deref(),
        )?;
        self.validate_semantics()
    }

    fn validate_semantics(&self) -> SnapbackResult<()> {
        let mut identities = BTreeMap::<String, (usize, String)>::new();
        let mut sequence_declarations = BTreeMap::<String, SequenceDeclaration>::new();
        for (function_index, function) in self.functions.iter().enumerate() {
            validate_media_command_binding_shape(function)?;
            if let Some(write_policy) = &function.write_policy {
                if function.kind != FunctionKind::Mutation
                    || write_policy.semantic_version != "snapback.owner-write.v1"
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE",
                        "auth",
                        "writePolicy requires a mutation and the supported semantic version",
                    )
                    .with_details(serde_json::json!({ "function": function.name })));
                }
                let mut disclosures = BTreeSet::new();
                for disclosure in &write_policy.disclosures {
                    let sorted_operations = disclosure
                        .operations
                        .iter()
                        .cloned()
                        .collect::<BTreeSet<_>>()
                        .into_iter()
                        .collect::<Vec<_>>();
                    if !matches!(
                        disclosure.write_form.as_str(),
                        "insert" | "insert-each" | "patch" | "delete" | "delete-where"
                    ) || !disclosure
                        .operations
                        .iter()
                        .any(|operation| operation == &function.name)
                        || disclosure.operations.is_empty()
                        || disclosure.table.trim().is_empty()
                        || disclosure.constraint.trim().is_empty()
                        || sorted_operations != disclosure.operations
                    {
                        return Err(SnapbackError::error(
                            "SNAPBACK_TABLE_WRITE_UNIQUE_DISCLOSURE_REQUIRED",
                            "auth",
                            "writePolicy disclosure does not bind its operation and generic write form",
                        )
                        .with_details(serde_json::json!({
                            "function": function.name,
                            "table": disclosure.table,
                            "writeForm": disclosure.write_form,
                            "constraint": disclosure.constraint,
                        })));
                    }
                    let identity = (
                        disclosure.table.clone(),
                        disclosure.write_form.clone(),
                        disclosure.constraint.clone(),
                        disclosure.operations.clone(),
                    );
                    if !disclosures.insert(identity) {
                        return Err(SnapbackError::error(
                            "SNAPBACK_TABLE_WRITE_UNIQUE_DISCLOSURE_REQUIRED",
                            "auth",
                            "writePolicy repeats a conflict disclosure identity",
                        ));
                    }
                }
                match (
                    write_policy.opaque_write_posture.as_deref(),
                    write_policy.declared_table_ceiling.as_ref(),
                ) {
                    (None, None) => {}
                    (None, Some(tables)) | (Some("conservative-v1"), Some(tables))
                        if !tables.is_empty()
                            && tables
                                == &tables
                                    .iter()
                                    .cloned()
                                    .collect::<BTreeSet<_>>()
                                    .into_iter()
                                    .collect::<Vec<_>>() => {}
                    _ => {
                        return Err(SnapbackError::error(
                            "SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE",
                            "auth",
                            "opaque writePolicy requires conservative-v1 and a non-empty table ceiling",
                        )
                        .with_details(serde_json::json!({ "function": function.name })));
                    }
                }
            }
            if let Some(generated) = &function.generated_authority_operation {
                let expected_name = if generated.operation
                    == GeneratedAuthorityOperationKindV1::SnapshotRecipients
                {
                    generated
                        .recipient_sink
                        .as_ref()
                        .map(|sink| sink.operation.clone())
                } else if generated.recipient_sink.is_none() {
                    Some(format!("{}.{}", generated.id, generated.operation.as_str()))
                } else {
                    None
                };
                let expected_kind = if generated.operation.is_mutation() {
                    FunctionKind::Mutation
                } else {
                    FunctionKind::LiveQuery
                };
                let dependence = AuthorityProfileIdentityV1 {
                    id: generated.id.clone(),
                    generation: generated.generation.clone(),
                };
                if expected_name.as_deref() != Some(function.name.as_str())
                    || function.kind != expected_kind
                    || !function.authority_profile_dependence.contains(&dependence)
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_GENERATED_AUTHORITY_OPERATION_INVALID",
                        "runtime",
                        format!(
                            "function {} carries an inconsistent generated authority-operation identity",
                            function.name
                        ),
                    ));
                }
            }
            if function.stream && function.kind != FunctionKind::Action {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_STREAM_KIND_INVALID",
                    "runtime",
                    format!(
                        "function {} declares stream but is not an action",
                        function.name
                    ),
                ));
            }
            if function.name.trim().is_empty() {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_IDENTITY_INVALID",
                    "runtime",
                    "function names must not be empty",
                ));
            }
            // @ref LLP 0012#v0-function-manifest — the stable function id is
            //   required (grants/consent key on it); a manifest that omits it
            //   fails load with a typed diagnostic before install.
            if function.id.trim().is_empty() {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_IDENTITY_INVALID",
                    "runtime",
                    format!(
                        "function {} is missing the required stable function id",
                        function.name
                    ),
                ));
            }
            let local_identities = [&function.name, &function.id]
                .into_iter()
                .collect::<BTreeSet<_>>();
            for identity in local_identities {
                if let Some((previous_index, previous)) = identities.get(identity)
                    && *previous_index != function_index
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_FUNCTION_IDENTITY_COLLISION",
                        "runtime",
                        format!(
                            "function identity {identity:?} is shared by {previous} and {}",
                            function.name
                        ),
                    ));
                }
                identities.insert(identity.clone(), (function_index, function.name.clone()));
            }

            match (&function.kind, &function.runtime) {
                (
                    FunctionKind::Query | FunctionKind::LiveQuery,
                    FunctionRuntime::HostPlan(HandlerPlan::Query(plan)),
                ) => validate_query_plan_shape(plan)?,
                (
                    FunctionKind::Query | FunctionKind::LiveQuery,
                    FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)),
                ) => validate_relational_query_plan_shape(plan)?,
                (
                    FunctionKind::Query | FunctionKind::LiveQuery,
                    FunctionRuntime::HostPlan(HandlerPlan::SearchQuery(plan)),
                ) => validate_search_query_plan_shape(plan)?,
                (
                    FunctionKind::Query,
                    FunctionRuntime::HostPlan(HandlerPlan::VectorQuery(plan)),
                ) => validate_vector_query_plan_shape(plan)?,
                (
                    FunctionKind::Query | FunctionKind::LiveQuery,
                    FunctionRuntime::HostPlan(HandlerPlan::JobStatusQuery(_)),
                ) => {}
                (
                    FunctionKind::Query,
                    FunctionRuntime::HostPlan(HandlerPlan::PushLedgerQuery(_)),
                ) => {}
                (
                    FunctionKind::LiveQuery,
                    FunctionRuntime::HostPlan(HandlerPlan::BoundedChildrenQuery(plan)),
                ) => validate_bounded_children_plan_shape(plan)?,
                (
                    FunctionKind::Query | FunctionKind::LiveQuery,
                    FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatch(plan)),
                ) => {
                    validate_snapshot_batch_plan_shape(plan)?;
                    validate_snapshot_batch_argument_bindings(function, plan)?;
                }
                (
                    FunctionKind::Query | FunctionKind::LiveQuery,
                    FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatchV2(plan)),
                ) => {
                    validate_snapshot_batch_v2_plan_shape(plan)?;
                    validate_snapshot_batch_v2_argument_bindings(function, plan)?;
                }
                (
                    FunctionKind::Query | FunctionKind::LiveQuery,
                    FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(carrier)),
                ) => validate_graph_query_carrier_v1(
                    carrier,
                    function.result_contract_hash.as_deref(),
                )
                .map_err(|reason| {
                    SnapbackError::error(
                        reason.code(),
                        "query",
                        format!(
                            "graph query {} failed host reconstruction: {reason}",
                            function.name
                        ),
                    )
                })?,
                (
                    FunctionKind::Mutation,
                    FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan)),
                ) => crate::value_expr::validate_mutation_plan(plan)?,
                (
                    FunctionKind::Mutation,
                    FunctionRuntime::HostPlan(HandlerPlan::WriteWithActivity(plan)),
                ) => {
                    validate_write_with_activity_plan_shape(plan)?;
                    crate::value_expr::validate_mutation_plan(&plan.mutation)?;
                }
                (FunctionKind::Action, FunctionRuntime::HostPlan(HandlerPlan::Action(plan))) => {
                    crate::value_expr::validate_action_plan(plan)?
                }
                (_, FunctionRuntime::IbexModule(_)) => {}
                _ => {
                    return Err(SnapbackError::error(
                        "SNAPBACK_FUNCTION_KIND_RUNTIME_MISMATCH",
                        "runtime",
                        format!(
                            "function {} kind {:?} does not match its host-plan runtime",
                            function.name, function.kind
                        ),
                    ));
                }
            }
            let implied_capabilities: &[&str] = match &function.runtime {
                FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(_)) => {
                    if function.kind == FunctionKind::LiveQuery {
                        &["relational_query_v1", "live_subscriptions"]
                    } else {
                        &["relational_query_v1"]
                    }
                }
                FunctionRuntime::HostPlan(HandlerPlan::SearchQuery(_)) => {
                    if function.kind == FunctionKind::LiveQuery {
                        &[
                            crate::search::types::SEARCH_CAPABILITY,
                            "live_subscriptions",
                            "live_full_text_search_v1",
                        ]
                    } else {
                        &[crate::search::types::SEARCH_CAPABILITY]
                    }
                }
                FunctionRuntime::HostPlan(HandlerPlan::VectorQuery(_)) => {
                    &[crate::vector::types::VECTOR_CAPABILITY]
                }
                // The declared job-status query requires the experimental
                // jobs registry id (LLP 0070 is Draft, so the id can never be
                // stable while the claim boundary stands) plus live delivery
                // when declared live.
                FunctionRuntime::HostPlan(HandlerPlan::JobStatusQuery(_)) => {
                    if function.kind == FunctionKind::LiveQuery {
                        &["jobs_one_off_v1", "live_subscriptions"]
                    } else {
                        &["jobs_one_off_v1"]
                    }
                }
                FunctionRuntime::HostPlan(HandlerPlan::PushLedgerQuery(_)) => {
                    &["notifications.expoPushSeam"]
                }
                FunctionRuntime::HostPlan(HandlerPlan::BoundedChildrenQuery(_)) => {
                    &["bounded_children_v1", "live_subscriptions"]
                }
                FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatch(_)) => {
                    if function.kind == FunctionKind::LiveQuery {
                        &[
                            "snapshot_batch_v1",
                            "bounded_children_v1",
                            "live_subscriptions",
                        ]
                    } else {
                        &["snapshot_batch_v1", "bounded_children_v1"]
                    }
                }
                FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatchV2(plan)) => {
                    let bounded = plan
                        .nodes
                        .iter()
                        .any(|node| matches!(node, SnapshotBatchNodeV2::BoundedChildren(_)));
                    match (function.kind == FunctionKind::LiveQuery, bounded) {
                        (true, true) => &[
                            "snapshot_batch_v2",
                            "relational_query_v1",
                            "bounded_children_v1",
                            "live_subscriptions",
                        ],
                        (true, false) => &[
                            "snapshot_batch_v2",
                            "relational_query_v1",
                            "live_subscriptions",
                        ],
                        (false, true) => &[
                            "snapshot_batch_v2",
                            "relational_query_v1",
                            "bounded_children_v1",
                        ],
                        (false, false) => &["snapshot_batch_v2", "relational_query_v1"],
                    }
                }
                FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(_)) => {
                    if function.kind == FunctionKind::LiveQuery {
                        &["graph_query_v1", "live_subscriptions"]
                    } else {
                        &["graph_query_v1"]
                    }
                }
                FunctionRuntime::HostPlan(HandlerPlan::WriteWithActivity(_)) => {
                    &["write_activity_v1"]
                }
                _ => &[],
            };
            for required in implied_capabilities {
                if !function
                    .required_capabilities
                    .iter()
                    .any(|capability| capability == *required)
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_CAPABILITY_UNSUPPORTED",
                        "capability",
                        format!(
                            "function {} uses a runtime profile without required capability {required}",
                            function.name
                        ),
                    ));
                }
            }

            validate_protected_query_profile(function)?;
            validate_custom_authorization(function)?;
            validate_authority_independent(function)?;
            validate_public_inline(function)?;
            validate_retainable_query(function)?;
            validate_effect_ceiling(function)?;
            validate_standard_pattern_identity(function)?;
            validate_result_contract_definition(function)?;
            validate_field_boundary(function)?;
            validate_elevated_read_capabilities(function)?;
            validate_args_contract_definition(function)?;
            validate_live_search_contracts(function)?;
            validate_declared_refusals(function)?;
            validate_plan_refusal_declarations(function)?;
            validate_bounded_skew_definition(function)?;
            validate_sequence_declarations(function)?;
            if let FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatch(plan)) = &function.runtime {
                validate_snapshot_batch_outer_result_contract(function, plan)?;
                let identity = snapshot_batch_identity_v1(function, plan)?;
                if plan.normalized_composite_plan != identity.normalized_composite_plan
                    || plan.plan_hash != identity.plan_hash
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
                        "query",
                        "snapshot batch emitted identity does not match the host reconstruction",
                    ));
                }
            }
            if let FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatchV2(plan)) = &function.runtime
            {
                validate_snapshot_batch_v2_outer_result_contract(function, plan)?;
                let identity = snapshot_batch_identity_v2(function, plan)?;
                if plan.normalized_composite_plan != identity.normalized_composite_plan
                    || plan.plan_hash != identity.plan_hash
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
                        "query",
                        "snapshot batch v2 emitted identity does not match the host reconstruction",
                    ));
                }
            }
            if let FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(carrier)) = &function.runtime {
                validate_graph_query_carrier_v1(
                    carrier,
                    function.result_contract_hash.as_deref(),
                )
                .map_err(|reason| {
                    SnapbackError::error(
                        reason.code(),
                        "query",
                        format!(
                            "graph query {} emitted identity does not match host reconstruction",
                            function.name
                        ),
                    )
                })?;
            }
            for declaration in &function.sequences {
                match sequence_declarations.get(&declaration.name) {
                    Some(previous) if previous != declaration => {
                        return Err(SnapbackError::error(
                            "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
                            "runtime",
                            format!(
                                "sequence {:?} has inconsistent declarations across functions",
                                declaration.name
                            ),
                        ));
                    }
                    Some(_) => {}
                    None => {
                        sequence_declarations.insert(declaration.name.clone(), declaration.clone());
                    }
                }
            }

            if self.schema_version == SNAPBACK_SESSIONS_SCHEMA_VERSION {
                validate_known_v1_capabilities(
                    function.required_capabilities.iter().map(String::as_str),
                )?;
            }
        }

        if self.schema_version == SNAPBACK_SESSIONS_SCHEMA_VERSION {
            // v1 grammar symmetry (LLP 0058 §Capability maturity): a sessions
            // artifact's acknowledgments must spell known registry ids, the
            // same closed-vocabulary rule its requirements obey.
            validate_known_v1_capabilities(
                self.acknowledged_experimental_capabilities
                    .iter()
                    .map(String::as_str),
            )?;
        }

        let by_name = self
            .functions
            .iter()
            .map(|function| (function.name.as_str(), function))
            .collect::<BTreeMap<_, _>>();
        for function in &self.functions {
            if let FunctionRuntime::HostPlan(HandlerPlan::Action(plan)) = &function.runtime {
                for step in &plan.steps {
                    let ActionStep::RunMutation { name, .. } = step;
                    match self.function(name) {
                        Some(target) if target.kind == FunctionKind::Mutation => {}
                        _ => {
                            return Err(SnapbackError::error(
                                "SNAPBACK_ACTION_MUTATION_REFERENCE_INVALID",
                                "runtime",
                                format!(
                                    "action {} references missing or non-mutation function {name}",
                                    function.name
                                ),
                            ));
                        }
                    }
                }
            }
        }

        let mut config_names = BTreeSet::new();
        for entry in &self.config {
            if entry.name.is_empty()
                || !entry
                    .name
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
                || !config_names.insert(entry.name.clone())
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_CONFIG_ENTRY_INVALID",
                    "config",
                    format!("config entry {:?} is invalid or duplicated", entry.name),
                ));
            }
            if !entry.secret {
                return Err(SnapbackError::error(
                    "SNAPBACK_CONFIG_NON_SECRET_UNIMPLEMENTED",
                    "config",
                    format!(
                        "config entry {} declares secret: false, which is not implemented",
                        entry.name
                    ),
                ));
            }
            if entry.default.is_some() {
                return Err(SnapbackError::error(
                    "SNAPBACK_CONFIG_DEFAULT_UNIMPLEMENTED",
                    "config",
                    format!(
                        "config entry {} declares an unsupported default",
                        entry.name
                    ),
                ));
            }
            if let Some(probe) = &entry.probe {
                match self.function(probe) {
                    Some(target) if target.kind == FunctionKind::Action => {}
                    _ => {
                        return Err(SnapbackError::error(
                            "SNAPBACK_CONFIG_PROBE_INVALID",
                            "config",
                            format!(
                                "config entry {} references missing or non-action probe {probe}",
                                entry.name
                            ),
                        ));
                    }
                }
            }
        }
        for function in by_name.values() {
            for used in &function.uses {
                if !config_names.contains(used) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_CONFIG_USES_UNKNOWN",
                        "config",
                        format!(
                            "function {} declares unknown config entry {used}",
                            function.name
                        ),
                    ));
                }
            }
        }
        for job in &self.cron_jobs {
            if self.schema_version == SNAPBACK_SESSIONS_SCHEMA_VERSION {
                validate_known_v1_capabilities(
                    job.required_capabilities.iter().map(String::as_str),
                )?;
            }
            if let Some(target) = self.function(&job.action)
                && target.effective_auth_requirement() == AuthRequirement::Authenticated
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_CRON_AUTH_REQUIREMENT_INVALID",
                    "cron",
                    format!(
                        "cron job {} targets authenticated function {}; system authority has no user",
                        job.name, job.action
                    ),
                )
                .with_details(serde_json::json!({
                    "jobName": job.name,
                    "function": job.action,
                    "authRequirement": AuthRequirement::Authenticated.as_str(),
                })));
            }
        }
        // Upload intents (LLP 0044): stable ids like functions, closed to
        // duplicates across intents *and* functions (one exported-name
        // namespace), a non-empty accept set, and an Ibex authorizer — a
        // host-plan intent authorizer is not a defined thing.
        let mut intent_identities = BTreeSet::new();
        for intent in &self.asset_upload_intents {
            if intent.name.trim().is_empty() || intent.id.trim().is_empty() {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_INTENT_IDENTITY_INVALID",
                    "asset",
                    "asset upload intents require non-empty stable ids and names",
                ));
            }
            if !intent_identities.insert(intent.id.clone())
                || !intent_identities.insert(intent.name.clone())
                || self.function(&intent.name).is_some()
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_INTENT_IDENTITY_COLLISION",
                    "asset",
                    format!(
                        "asset upload intent identity {:?} is duplicated",
                        intent.name
                    ),
                ));
            }
            if intent.accept.media_types.is_empty() || intent.accept.max_bytes == 0 {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_INTENT_ACCEPT_INVALID",
                    "asset",
                    format!(
                        "asset upload intent {} must accept at least one media type and a positive byte bound",
                        intent.name
                    ),
                ));
            }
            if intent.intent_policy_hash.trim().is_empty() {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_INTENT_IDENTITY_INVALID",
                    "asset",
                    format!(
                        "asset upload intent {} is missing intentPolicyHash",
                        intent.name
                    ),
                ));
            }
            if !matches!(intent.runtime, FunctionRuntime::IbexModule(_)) {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_INTENT_RUNTIME_INVALID",
                    "asset",
                    format!(
                        "asset upload intent {} requires an Ibex authorizer",
                        intent.name
                    ),
                ));
            }
            // Declared lifecycle callbacks name ordinary generated mutations
            // (defense in depth beside codegen's contract check; the loaded
            // manifest is the authority the runner executes against).
            if let Some(on) = &intent.on {
                for callback in [on.ready.as_deref(), on.rejected.as_deref()]
                    .into_iter()
                    .flatten()
                {
                    let target = self.function(callback);
                    let is_mutation =
                        target.is_some_and(|function| function.kind == FunctionKind::Mutation);
                    if !is_mutation {
                        return Err(SnapbackError::error(
                            "SNAPBACK_ASSET_CALLBACK_INVALID",
                            "asset",
                            format!(
                                "asset upload intent {} callback {callback} must name a declared mutation",
                                intent.name
                            ),
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    /// Pair-time validation closes every binding edge over the exact schema
    /// artifact that will execute it.
    pub fn validate_media_commands_against_schema(
        &self,
        schema: &SchemaManifest,
    ) -> SnapbackResult<()> {
        let invalid = |message: String| {
            SnapbackError::error(
                "SNAPBACK_MEDIA_COMMAND_MANIFEST_INVALID",
                "media-command",
                message,
            )
        };
        for function in &self.functions {
            for binding in &function.media_command_bindings {
                let collection = schema
                    .asset_collections
                    .iter()
                    .find(|candidate| candidate.name == binding.collection.name)
                    .ok_or_else(|| {
                        invalid(format!(
                            "media command {} names missing collection {}",
                            binding.command.name, binding.collection.name
                        ))
                    })?;
                if collection.generation != binding.collection.generation
                    || collection.owner_table != binding.collection.owner_table
                    || collection.owner_field != binding.collection.owner_field
                    || collection.child_table != binding.collection.child_table
                    || collection.intent != binding.media.intent
                    || collection.max_items < binding.media.max_items
                    || binding
                        .media
                        .kinds
                        .iter()
                        .any(|kind| !collection.kinds.contains(kind))
                    || collection.order != AssetCollectionOrderV1::Manual
                    || !collection.sharing.ceiling.contains(&binding.sharing)
                {
                    return Err(invalid(format!(
                        "media command {} no longer matches collection {} generation/policy",
                        binding.command.name, collection.name
                    )));
                }
                let args = function.args_contract.as_ref().ok_or_else(|| {
                    invalid(format!(
                        "media command {} target has no argument contract",
                        binding.command.name
                    ))
                })?;
                let media_arg = args
                    .fields
                    .iter()
                    .find(|field| field.name == binding.media.mutation_arg)
                    .ok_or_else(|| {
                        invalid(format!(
                            "media command {} mapped argument is absent",
                            binding.command.name
                        ))
                    })?;
                if !media_arg.required
                    || !matches!(
                        &media_arg.value,
                        ResultValueContract::Array { element, max_items }
                            if *max_items == usize::from(binding.media.max_items)
                                && matches!(element.as_ref(), ResultValueContract::AssetRef)
                    )
                {
                    return Err(invalid(format!(
                        "media command {} mapped argument contract is incompatible",
                        binding.command.name
                    )));
                }
                let ordinary = args
                    .fields
                    .iter()
                    .filter(|field| field.name != binding.media.mutation_arg)
                    .map(|field| field.name.as_str())
                    .collect::<BTreeSet<_>>();
                if ordinary
                    != binding
                        .passthrough_args
                        .iter()
                        .map(String::as_str)
                        .collect::<BTreeSet<_>>()
                {
                    return Err(invalid(format!(
                        "media command {} passthrough arguments drifted",
                        binding.command.name
                    )));
                }
                let mut result = match &function.result_contract {
                    FunctionResultContract::Value { value } => value,
                    _ => {
                        return Err(invalid(format!(
                            "media command {} target must return one exact value",
                            binding.command.name
                        )));
                    }
                };
                for component in &binding.parent_result_path {
                    let ResultValueContract::Object {
                        fields,
                        allow_extra,
                    } = result
                    else {
                        return Err(invalid(format!(
                            "media command {} parent path leaves the exact object contract",
                            binding.command.name
                        )));
                    };
                    if *allow_extra {
                        return Err(invalid(format!(
                            "media command {} parent path traverses an open object",
                            binding.command.name
                        )));
                    }
                    result = &fields
                        .iter()
                        .find(|field| field.required && field.name == *component)
                        .ok_or_else(|| {
                            invalid(format!(
                                "media command {} parent result path is missing",
                                binding.command.name
                            ))
                        })?
                        .value;
                }
                if !matches!(result, ResultValueContract::Id { table } if table == &collection.owner_table)
                {
                    return Err(invalid(format!(
                        "media command {} parent result is not Id<{}>",
                        binding.command.name, collection.owner_table
                    )));
                }
            }
        }
        Ok(())
    }
}

fn validate_media_command_binding_shape(function: &FunctionDefinition) -> SnapbackResult<()> {
    if function.media_command_bindings.is_empty() {
        return Ok(());
    }
    let invalid = |message: String| {
        SnapbackError::error(
            "SNAPBACK_MEDIA_COMMAND_MANIFEST_INVALID",
            "media-command",
            message,
        )
    };
    if function.kind != FunctionKind::Mutation
        || function.effective_auth_requirement() != AuthRequirement::Authenticated
        || !function
            .required_capabilities
            .iter()
            .any(|capability| capability == TargetCapabilityId::MediaCommandV1.as_str())
    {
        return Err(invalid(format!(
            "function {} carries media bindings outside an authenticated capability-declared mutation",
            function.name
        )));
    }
    let mut commands = BTreeSet::new();
    let mut identities = BTreeSet::new();
    for binding in &function.media_command_bindings {
        let principal_shape_valid = match (&binding.sharing.plan, &binding.principal_input) {
            (AssetCollectionSharingPlanV1::Recipients { max_recipients, .. }, Some(input)) => {
                is_user_identifier(&input.input)
                    && input.min_items >= 1
                    && input.min_items <= input.max_items
                    && input.max_items <= *max_recipients
                    && input.max_items <= 32
                    && input.input != binding.media.input
                    && !binding.passthrough_args.contains(&input.input)
            }
            (AssetCollectionSharingPlanV1::Recipients { .. }, None) => false,
            (_, None) => true,
            (_, Some(_)) => false,
        };
        let shape_valid = binding.format == "snapback.media-command-binding.v1"
            && sha256_is_well_formed_nonzero(&binding.identity)
            && commands.insert(binding.command.name.as_str())
            && identities.insert(binding.identity.as_str())
            && is_user_identifier(&binding.command.name)
            && !binding.command.id.is_empty()
            && binding.target_mutation.id == function.id
            && binding.target_mutation.name == function.name
            && function.args_contract_hash.as_deref()
                == Some(binding.target_mutation.args_contract_hash.as_str())
            && function.result_contract_hash.as_deref()
                == Some(binding.target_mutation.result_contract_hash.as_str())
            && is_user_identifier(&binding.media.input)
            && is_user_identifier(&binding.media.mutation_arg)
            && !binding.media.intent.is_empty()
            && sha256_is_well_formed_nonzero(&binding.media.intent_policy_hash)
            && binding.media.min_items <= binding.media.max_items
            && (1..=32).contains(&binding.media.max_items)
            && !binding.media.kinds.is_empty()
            && binding.media.kinds.iter().collect::<BTreeSet<_>>().len()
                == binding.media.kinds.len()
            && !binding.parent_result_path.is_empty()
            && binding
                .parent_result_path
                .iter()
                .all(|part| is_user_identifier(part))
            && binding.item_identity_plan.format == "snapback:asset-collection-item-id:v1"
            && matches!(
                binding.item_identity_plan.operation.as_str(),
                "append" | "replace"
            )
            && binding.item_identity_plan.order == "input"
            && principal_shape_valid
            && (1..=8).contains(&binding.task_profile.concurrency)
            && binding
                .passthrough_args
                .iter()
                .all(|name| is_user_identifier(name))
            && binding
                .passthrough_args
                .iter()
                .collect::<BTreeSet<_>>()
                .len()
                == binding.passthrough_args.len();
        if !shape_valid {
            return Err(invalid(format!(
                "function {} carries an invalid or colliding MediaCommandBindingV1",
                function.name
            )));
        }
        let mut core = serde_json::to_value(binding).map_err(|error| {
            invalid(format!("media binding could not be canonicalized: {error}"))
        })?;
        core.as_object_mut()
            .expect("media binding serializes to an object")
            .remove("identity");
        let canonical = crate::watches::canonical_json(&core)?;
        let expected =
            sha256_prefixed(format!("snapback:media-command-binding:v1\n{canonical}").as_bytes());
        if expected != binding.identity {
            return Err(invalid(format!(
                "media command {} binding identity does not match its closed contents",
                binding.command.name
            )));
        }
    }
    Ok(())
}

fn validate_sequence_declarations(function: &FunctionDefinition) -> SnapbackResult<()> {
    let host_allocations = match &function.runtime {
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan)) => plan
            .steps
            .iter()
            .filter(|step| matches!(step, MutationStep::AllocateSequence { .. }))
            .count(),
        FunctionRuntime::HostPlan(HandlerPlan::WriteWithActivity(plan)) => plan
            .mutation
            .steps
            .iter()
            .filter(|step| matches!(step, MutationStep::AllocateSequence { .. }))
            .count(),
        _ => 0,
    };
    if function.sequences.is_empty() {
        return if host_allocations == 0 {
            Ok(())
        } else {
            Err(SnapbackError::error(
                "SNAPBACK_SEQUENCE_UNDECLARED",
                "runtime",
                format!(
                    "function {} contains AllocateSequence without a declaration",
                    function.name
                ),
            ))
        };
    }
    let handler = matches!(function.runtime, FunctionRuntime::IbexModule(_));
    let write_with_activity = match &function.runtime {
        FunctionRuntime::HostPlan(HandlerPlan::WriteWithActivity(plan)) => Some(plan),
        _ => None,
    };
    if function.kind != FunctionKind::Mutation
        || (!handler && write_with_activity.is_none())
        || (write_with_activity.is_none() && host_allocations > 0)
        || !function
            .required_capabilities
            .iter()
            .any(|capability| capability == "sequence_allocation_v1")
    {
        return Err(SnapbackError::error(
            "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
            "runtime",
            format!(
                "function {} declares sequences without an admitted mutation profile and capability",
                function.name
            ),
        ));
    }
    let mut names = BTreeSet::new();
    for declaration in &function.sequences {
        if !is_user_identifier(&declaration.name)
            || !is_user_identifier(&declaration.scope_table)
            || !names.insert(declaration.name.as_str())
        {
            return Err(SnapbackError::error(
                "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
                "runtime",
                format!(
                    "function {} has an empty or duplicate sequence declaration",
                    function.name
                ),
            ));
        }
        match &declaration.scope_access {
            SequenceScopeAccess::Public(profile) if handler && profile == "public.v1" => {}
            SequenceScopeAccess::Membership { declaration, roles }
                if handler
                    && !declaration.trim().is_empty()
                    && !roles.is_empty()
                    && roles.iter().all(|role| !role.trim().is_empty())
                    && roles.iter().collect::<BTreeSet<_>>().len() == roles.len() => {}
            SequenceScopeAccess::ExistingOwner(access)
                if write_with_activity.is_some_and(|plan| {
                    access.kind == "existing-owner.v1"
                        && !access.owner_field.trim().is_empty()
                        && access.owner_field == plan.scope_owner_field
                        && declaration.scope_table == plan.scope_table
                }) => {}
            _ => {
                return Err(SnapbackError::error(
                    "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
                    "runtime",
                    format!(
                        "function {} sequence {} has an invalid scopeAccess declaration",
                        function.name, declaration.name
                    ),
                ));
            }
        }
    }
    if let Some(plan) = write_with_activity {
        let allocations = plan
            .mutation
            .steps
            .iter()
            .filter_map(|step| match step {
                MutationStep::AllocateSequence {
                    counter,
                    scope,
                    into: _,
                } => Some((counter, scope)),
                _ => None,
            })
            .collect::<Vec<_>>();
        if allocations.len() != function.sequences.len()
            || allocations.into_iter().any(|(counter, scope)| {
                scope != &plan.scope_id
                    || !function.sequences.iter().any(|declaration| {
                        declaration.name.as_str() == counter.as_str()
                            && declaration.scope_table == plan.scope_table
                            && matches!(
                                &declaration.scope_access,
                                SequenceScopeAccess::ExistingOwner(access)
                                    if access.kind == "existing-owner.v1"
                                        && access.owner_field == plan.scope_owner_field
                            )
                    })
            })
        {
            return Err(SnapbackError::error(
                "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
                "runtime",
                format!(
                    "function {} sequence declarations do not match its AllocateSequence steps",
                    function.name
                ),
            ));
        }
    }
    Ok(())
}

/// User-authored identifier grammar shared by manifest admission and durable
/// sequence-fact validation. SQL's raw identifier grammar is intentionally
/// broader because framework-owned `_snapback*` tables must remain quotable.
///
/// @ref LLP 0057#reservation — the auth namespace is ASCII-case-insensitive.
pub fn is_user_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first == '_' || first.is_ascii_alphabetic())
        || !chars.all(|char| char == '_' || char.is_ascii_alphanumeric())
        || value.starts_with("_snapback")
    {
        return false;
    }
    let folded = value.to_ascii_lowercase();
    folded != "_auth" && !folded.starts_with("_auth_")
}

/// Fail-closed shape validation for standard-pattern metadata whose deeper
/// table/declaration coherence is checked when the function manifest is paired
/// with its schema.
fn validate_standard_pattern_identity(function: &FunctionDefinition) -> SnapbackResult<()> {
    let Some(pattern) = &function.standard_pattern else {
        return Ok(());
    };
    let membership_helper = pattern.helper == "membership-keyset-pages.v1";
    let membership_profile = pattern.profile == "membership.v1";
    let bounded_helper = matches!(
        pattern.helper.as_str(),
        "chunked-semi-join.v1" | "set-keyed-aggregate.v1"
    );
    let bounded_profile = pattern.profile == "bounded-composition.v1";
    let invalid = |message: &str| {
        SnapbackError::error(
            "SNAPBACK_STANDARD_PATTERN_MEMBERSHIP_INVALID",
            "runtime",
            format!("function {} {message}", function.name),
        )
    };

    if membership_helper != membership_profile {
        return Err(invalid(
            "must pair helper membership-keyset-pages.v1 with profile membership.v1",
        ));
    }
    if bounded_helper != bounded_profile {
        return Err(SnapbackError::error(
            "SNAPBACK_STANDARD_PATTERN_COMPOSITION_INVALID",
            "runtime",
            format!(
                "function {} must pair a bounded composition helper with profile bounded-composition.v1",
                function.name
            ),
        ));
    }
    if bounded_helper
        && (function.kind != FunctionKind::LiveQuery
            || !matches!(function.runtime, FunctionRuntime::IbexModule(_)))
    {
        return Err(SnapbackError::error(
            "SNAPBACK_STANDARD_PATTERN_COMPOSITION_INVALID",
            "runtime",
            format!(
                "function {} requires a generated live Ibex handler",
                function.name
            ),
        ));
    }
    if membership_helper {
        if pattern.membership.is_none() {
            return Err(invalid(
                "requires the closed standardPattern.membership block",
            ));
        }
        if function.kind != FunctionKind::Query {
            return Err(invalid(
                "must be an ordinary callable Query and cannot be a LiveQuery",
            ));
        }
        if !matches!(
            function.runtime,
            FunctionRuntime::HostPlan(HandlerPlan::Query(_))
        ) {
            return Err(invalid("requires a single-table HostPlan query"));
        }
    } else if pattern.membership.is_some() {
        return Err(invalid(
            "carries membership metadata for a helper that does not admit it",
        ));
    }
    Ok(())
}

const RESULT_CONTRACT_MAX_DEPTH: usize = 16;
const RESULT_CONTRACT_MAX_FIELDS: usize = 128;
const RESULT_CONTRACT_MAX_UNION_VARIANTS: usize = 8;
const RESULT_CONTRACT_MAX_ARRAY_ITEMS: usize = 1_024;
const RESULT_CONTRACT_MAX_VALUE_BYTES: usize = 1024 * 1024;
const RESULT_CONTRACT_JS_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

fn invalid_result_contract(
    function: &FunctionDefinition,
    message: impl Into<String>,
) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID",
        "runtime",
        format!("function {} {}", function.name, message.into()),
    )
}

fn invalid_args_contract(
    function: &FunctionDefinition,
    message: impl Into<String>,
) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_FUNCTION_ARGS_CONTRACT_INVALID",
        "runtime",
        format!("function {} {}", function.name, message.into()),
    )
}

/// Canonical content identity for persisted generation facts. Keeping this
/// primitive beside the shared manifest types lets storage bind their exact
/// content without depending on a higher-level query/realtime owner.
pub fn canonical_content_identity<T: Serialize>(value: &T) -> Option<String> {
    let value = serde_json::to_value(value).ok()?;
    crate::rqs_contract::sha256_identity(&value).ok()
}

/// Hash witness for the extended argument-contract descriptor.
///
/// @ref LLP 0131#identity-and-hashing — the canonical form is hashed under
/// the new v2 domain prefix (the v1 descriptor dropped all bounds, so a
/// hash-stable extension would witness nothing this Spec makes contractual).
/// A `PlatformSchemaRef` node contributes its authority class and reference id, never artifact bytes.
pub fn args_contract_hash(contract: &FunctionArgsContract) -> SnapbackResult<String> {
    let value = serde_json::to_value(contract).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
            "runtime",
            "args contract cannot be represented as canonical JSON",
        )
    })?;
    let canonical = crate::rqs_contract::jcs(&value).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
            "runtime",
            "args contract is outside the canonical JSON profile",
        )
    })?;
    let mut hash = Sha256::new();
    hash.update(b"snapback:function-args:v2\n");
    hash.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", hash.finalize()))
}

/// Recompute the durable structured-field witness from the persisted carrier.
///
/// @ref LLP 0211#representation-and-write-path — the exact preimage is the
///   UTF-8 domain plus one newline followed by the RFC 8785 bytes of the
///   three-member `StoredStructuredContractV1` record.
pub fn stored_structured_contract_hash(
    contract: &StoredStructuredContractV1,
) -> SnapbackResult<String> {
    let value = serde_json::to_value(contract).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_STRUCTURED_CONTRACT_INVALID",
            "schema",
            "stored structured contract cannot be represented as canonical JSON",
        )
    })?;
    let canonical = crate::rqs_contract::jcs(&value).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_STRUCTURED_CONTRACT_INVALID",
            "schema",
            "stored structured contract is outside the canonical JSON profile",
        )
    })?;
    let mut hash = Sha256::new();
    hash.update(b"snapback:stored-structured-contract:v1\n");
    hash.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", hash.finalize()))
}

pub fn result_contract_hash(contract: &FunctionResultContract) -> SnapbackResult<String> {
    let value = serde_json::to_value(contract).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
            "runtime",
            "result contract cannot be represented as canonical JSON",
        )
    })?;
    let canonical = crate::rqs_contract::jcs(&value).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
            "runtime",
            "result contract is outside the canonical JSON profile",
        )
    })?;
    let mut hash = Sha256::new();
    hash.update(b"snapback:function-result:v1\n");
    hash.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", hash.finalize()))
}

pub fn media_result_contract(
    table: &str,
    field: &FieldManifest,
    media: &crate::contract_types::MediaFieldDescriptorV1,
) -> ResultValueContract {
    let source_field_generation = media_source_field_generation(table, field, media);
    ResultValueContract::MediaRefV1 {
        source_table: table.to_owned(),
        source_field: field.name.clone(),
        source_field_generation,
        optional: field.optional,
        class_m_treatment: "class-m.none.v1".to_owned(),
        upload_intent: media.intent.clone(),
        policy_generation: media.policy.clone(),
        kinds: media.kinds.clone(),
        delivery: media.delivery.clone(),
        variants: media.variants.clone(),
        classification_profile: media.classification_profile.clone(),
        retention_class: media.retention_class.clone(),
    }
}

/// Return the canonical installed-schema result contract for one stored
/// document field, including Snapback's four system fields.
///
/// @ref LLP 0108#result-contract-vocabulary — complete stored documents use
/// the installed table schema and exact system-field domains.
/// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut — a
/// media-qualified asset field reifies to the semantic media result node.
pub fn table_document_field_result_contract(
    table: &TableManifest,
    field_name: &str,
) -> Option<ResultValueContract> {
    let safe_integer = || ResultValueContract::Integer {
        min: 0,
        max: RESULT_CONTRACT_JS_SAFE_INTEGER,
    };
    let value = match field_name {
        "_id" => ResultValueContract::Id {
            table: table.name.clone(),
        },
        "_version" | "_createdAt" | "_updatedAt" => safe_integer(),
        _ => {
            let field = table.field(field_name)?;
            let value = match &field.field_type {
                FieldType::String => ResultValueContract::String {
                    max_bytes: RESULT_CONTRACT_MAX_VALUE_BYTES,
                },
                FieldType::Enum { values } => ResultValueContract::Union {
                    variants: values
                        .iter()
                        .cloned()
                        .map(|value| ResultValueContract::Literal {
                            value: Value::String(value),
                        })
                        .collect(),
                },
                FieldType::Boolean => ResultValueContract::Boolean,
                FieldType::Integer => ResultValueContract::Integer {
                    min: -RESULT_CONTRACT_JS_SAFE_INTEGER,
                    max: RESULT_CONTRACT_JS_SAFE_INTEGER,
                },
                FieldType::Real => ResultValueContract::FiniteReal {
                    min: -f64::MAX,
                    max: f64::MAX,
                },
                FieldType::Vector { dimensions } => ResultValueContract::Vector {
                    dimensions: *dimensions,
                },
                FieldType::Json => ResultValueContract::Json {
                    max_depth: RESULT_CONTRACT_MAX_DEPTH,
                    max_bytes: RESULT_CONTRACT_MAX_VALUE_BYTES,
                },
                // @ref LLP 0211#declaration-closed-dispatch-closed-interior — the
                // persisted descriptor is also the exact logical document shape.
                FieldType::Structured { contract, .. } => contract.descriptor.clone(),
                FieldType::Principal => ResultValueContract::Principal,
                FieldType::Id { table } => ResultValueContract::Id {
                    table: table.clone(),
                },
                FieldType::RelationIncarnation { .. } => {
                    ResultValueContract::String { max_bytes: 64 }
                }
                FieldType::AssetRef {
                    media: Some(media), ..
                } => media_result_contract(&table.name, field, media),
                FieldType::AssetRef { .. } => ResultValueContract::AssetRef,
            };
            if field.optional && !matches!(value, ResultValueContract::Json { .. }) {
                match value {
                    ResultValueContract::Union { mut variants } => {
                        variants.insert(0, ResultValueContract::Null);
                        ResultValueContract::Union { variants }
                    }
                    value => ResultValueContract::Union {
                        variants: vec![ResultValueContract::Null, value],
                    },
                }
            } else {
                value
            }
        }
    };
    Some(value)
}

pub fn table_document_value_contract(table: &TableManifest) -> ResultValueContract {
    let mut field_names = vec!["_id", "_version", "_createdAt", "_updatedAt"];
    field_names.extend(table.fields.iter().map(|field| field.name.as_str()));
    let fields = field_names
        .into_iter()
        .map(|name| ResultObjectFieldContract {
            name: name.to_owned(),
            required: true,
            value: table_document_field_result_contract(table, name)
                .unwrap_or_else(|| unreachable!("table field came from the installed schema")),
        })
        .collect();
    ResultValueContract::Object {
        fields,
        allow_extra: false,
    }
}

pub fn media_source_field_generation(
    table: &str,
    field: &FieldManifest,
    media: &crate::contract_types::MediaFieldDescriptorV1,
) -> String {
    let generation_value = serde_json::json!({
        "table": table,
        "field": field.name,
        "descriptor": media,
    });
    let canonical = crate::rqs_contract::jcs(&generation_value)
        .expect("validated media field descriptor is canonical JSON");
    let mut hash = Sha256::new();
    hash.update(b"snapback:media-source-field-generation:v1\n");
    hash.update(canonical.as_bytes());
    format!("sha256:{:x}", hash.finalize())
}

#[derive(Clone, Copy, Eq, Ord, PartialEq, PartialOrd)]
enum ResultPrimitiveKind {
    Null,
    Boolean,
    String,
    Number,
    Array,
    Object,
    AnyJson,
}

fn result_primitive_kind(contract: &ResultValueContract) -> ResultPrimitiveKind {
    match contract {
        ResultValueContract::Null => ResultPrimitiveKind::Null,
        ResultValueContract::Boolean => ResultPrimitiveKind::Boolean,
        ResultValueContract::String { .. }
        | ResultValueContract::Principal
        | ResultValueContract::AssetRef
        | ResultValueContract::Id { .. } => ResultPrimitiveKind::String,
        ResultValueContract::Integer { .. } | ResultValueContract::FiniteReal { .. } => {
            ResultPrimitiveKind::Number
        }
        ResultValueContract::Literal { value } => match value {
            Value::Null => ResultPrimitiveKind::Null,
            Value::Bool(_) => ResultPrimitiveKind::Boolean,
            Value::String(_) => ResultPrimitiveKind::String,
            Value::Number(_) => ResultPrimitiveKind::Number,
            Value::Array(_) => ResultPrimitiveKind::Array,
            Value::Object(_) => ResultPrimitiveKind::Object,
        },
        ResultValueContract::Json { .. }
        | ResultValueContract::Union { .. }
        | ResultValueContract::PlatformSchemaRef { .. } => ResultPrimitiveKind::AnyJson,
        ResultValueContract::Array { .. }
        | ResultValueContract::Tuple { .. }
        | ResultValueContract::Vector { .. } => ResultPrimitiveKind::Array,
        ResultValueContract::Object { .. } | ResultValueContract::MediaRefV1 { .. } => {
            ResultPrimitiveKind::Object
        }
    }
}

fn union_has_object_discriminator(variants: &[ResultValueContract]) -> bool {
    let objects = variants
        .iter()
        .map(|variant| match variant {
            ResultValueContract::Object {
                fields,
                allow_extra: false,
            } => Some(fields),
            _ => None,
        })
        .collect::<Option<Vec<_>>>();
    let Some(objects) = objects else {
        return false;
    };
    let Some(first) = objects.first() else {
        return false;
    };
    first.iter().any(|candidate| {
        if !candidate.required {
            return false;
        }
        let ResultValueContract::Literal { value: first_value } = &candidate.value else {
            return false;
        };
        if !matches!(
            first_value,
            Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_)
        ) {
            return false;
        }
        let mut values = BTreeSet::new();
        for fields in &objects {
            let Some(field) = fields
                .iter()
                .find(|field| field.required && field.name == candidate.name)
            else {
                return false;
            };
            let ResultValueContract::Literal { value } = &field.value else {
                return false;
            };
            let Ok(canonical) = crate::rqs_contract::jcs(value) else {
                return false;
            };
            if !values.insert(canonical) {
                return false;
            }
        }
        true
    })
}

fn union_has_disjoint_primitive_variants(variants: &[ResultValueContract]) -> bool {
    let mut groups = BTreeMap::<ResultPrimitiveKind, Vec<&ResultValueContract>>::new();
    for variant in variants {
        let kind = result_primitive_kind(variant);
        if kind == ResultPrimitiveKind::AnyJson {
            return false;
        }
        groups.entry(kind).or_default().push(variant);
    }
    groups.values().all(|group| {
        if group.len() == 1 {
            return true;
        }
        let mut literals = BTreeSet::new();
        group.iter().all(|variant| {
            let ResultValueContract::Literal { value } = variant else {
                return false;
            };
            crate::rqs_contract::jcs(value)
                .ok()
                .is_some_and(|value| literals.insert(value))
        })
    })
}

pub fn stored_structured_union_is_disjoint(variants: &[ResultValueContract]) -> bool {
    union_has_disjoint_primitive_variants(variants) || union_has_object_discriminator(variants)
}

fn validate_result_value_contract(
    function: &FunctionDefinition,
    contract: &ResultValueContract,
    depth: usize,
    object_fields: &mut usize,
) -> SnapbackResult<()> {
    validate_value_contract_node(
        function,
        contract,
        depth,
        object_fields,
        ContractLane::Result,
    )
}

/// Which contract root a value node sits under. One node vocabulary, two
/// roots (LLP 0131): argument contracts additionally admit registry-checked
/// `PlatformSchemaRef` nodes; result contracts keep the LLP 0108 set.
#[derive(Clone, Copy, Eq, PartialEq)]
enum ContractLane {
    Result,
    Args,
}

fn validate_value_contract_node(
    function: &FunctionDefinition,
    contract: &ResultValueContract,
    depth: usize,
    object_fields: &mut usize,
    lane: ContractLane,
) -> SnapbackResult<()> {
    if depth > RESULT_CONTRACT_MAX_DEPTH {
        return Err(invalid_result_contract(
            function,
            "result contract exceeds the depth-16 profile",
        ));
    }
    match contract {
        ResultValueContract::String { max_bytes } => {
            if *max_bytes > RESULT_CONTRACT_MAX_VALUE_BYTES {
                return Err(invalid_result_contract(
                    function,
                    "result string bound exceeds 1 MiB",
                ));
            }
        }
        ResultValueContract::Integer { min, max } => {
            if min > max
                || *min < -RESULT_CONTRACT_JS_SAFE_INTEGER
                || *max > RESULT_CONTRACT_JS_SAFE_INTEGER
            {
                return Err(invalid_result_contract(
                    function,
                    "result integer bounds are invalid or outside JavaScript-safe integers",
                ));
            }
        }
        ResultValueContract::FiniteReal { min, max } => {
            if !min.is_finite() || !max.is_finite() || min > max {
                return Err(invalid_result_contract(
                    function,
                    "result finite-real bounds are invalid",
                ));
            }
        }
        ResultValueContract::Id { table } if table.is_empty() => {
            return Err(invalid_result_contract(
                function,
                "result id names an empty table",
            ));
        }
        ResultValueContract::Literal { value } => {
            if !matches!(
                value,
                Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_)
            ) || crate::rqs_contract::jcs(value).is_err()
            {
                return Err(invalid_result_contract(
                    function,
                    "result literal is not a canonical JSON scalar",
                ));
            }
        }
        ResultValueContract::Json {
            max_depth,
            max_bytes,
        } => {
            if *max_depth > RESULT_CONTRACT_MAX_DEPTH
                || *max_bytes > RESULT_CONTRACT_MAX_VALUE_BYTES
            {
                return Err(invalid_result_contract(
                    function,
                    "result JSON bound exceeds the depth-16/1-MiB profile",
                ));
            }
        }
        ResultValueContract::Array { element, max_items } => {
            if *max_items > RESULT_CONTRACT_MAX_ARRAY_ITEMS {
                return Err(invalid_result_contract(
                    function,
                    "result array bound exceeds 1,024 items",
                ));
            }
            validate_value_contract_node(function, element, depth + 1, object_fields, lane)?;
        }
        ResultValueContract::Tuple { elements } => {
            if elements.is_empty() || elements.len() > 8 {
                return Err(invalid_result_contract(
                    function,
                    "result tuple must contain 1–8 elements",
                ));
            }
            for element in elements {
                validate_value_contract_node(function, element, depth + 1, object_fields, lane)?;
            }
        }
        // @ref LLP 0132#the-vvectordimensions-value — vectors are a dedicated
        // closed node in both lanes. They do not widen the ordinary array
        // profile's 1,024-item ceiling.
        ResultValueContract::Vector { dimensions } => {
            if !(crate::vector::types::VECTOR_PROFILE_DIMENSIONS_MIN
                ..=crate::vector::types::VECTOR_PROFILE_DIMENSIONS_MAX)
                .contains(dimensions)
            {
                return Err(match lane {
                    ContractLane::Result => {
                        invalid_result_contract(function, "vector dimensions must be in 1..=4,096")
                    }
                    ContractLane::Args => {
                        invalid_args_contract(function, "vector dimensions must be in 1..=4,096")
                    }
                });
            }
        }
        ResultValueContract::Union { variants } => {
            if !(2..=RESULT_CONTRACT_MAX_UNION_VARIANTS).contains(&variants.len()) {
                return Err(invalid_result_contract(
                    function,
                    "result union must contain 2–8 variants",
                ));
            }
            let primitive_disjoint = union_has_disjoint_primitive_variants(variants);
            if !primitive_disjoint && !union_has_object_discriminator(variants) {
                return Err(invalid_result_contract(
                    function,
                    "result union variants are not syntactically disjoint",
                ));
            }
            for variant in variants {
                validate_value_contract_node(function, variant, depth + 1, object_fields, lane)?;
            }
        }
        ResultValueContract::Object {
            fields,
            allow_extra,
        } => {
            // @ref LLP 0131#the-argument-contract-descriptor — `allowExtra`
            // is carried for node-type reuse and must be false at every
            // argument position; argument objects are closed.
            if lane == ContractLane::Args && *allow_extra {
                return Err(invalid_args_contract(
                    function,
                    "argument objects must be closed (allowExtra: false)",
                ));
            }
            *object_fields = object_fields.saturating_add(fields.len());
            if *object_fields > RESULT_CONTRACT_MAX_FIELDS {
                return Err(invalid_result_contract(
                    function,
                    "result contract exceeds 128 object fields",
                ));
            }
            let mut names = BTreeSet::new();
            for field in fields {
                if field.name.is_empty() || !names.insert(field.name.as_str()) {
                    return Err(invalid_result_contract(
                        function,
                        "result object field names must be non-empty and unique",
                    ));
                }
                validate_value_contract_node(
                    function,
                    &field.value,
                    depth + 1,
                    object_fields,
                    lane,
                )?;
            }
        }
        // @ref LLP 0131#one-argument-grammar — PlatformSchemaRef is an argument-lane
        // node in v1; result contracts keep the LLP 0108 vocabulary. The
        // reference id must name an entry in the closed platform registry.
        ResultValueContract::PlatformSchemaRef { schema, .. } => {
            if lane == ContractLane::Result {
                return Err(invalid_result_contract(
                    function,
                    "result contracts do not admit platformSchemaRef nodes",
                ));
            }
            if !schema_ref_registry_v1().contains(&schema.as_str()) {
                // @ref LLP 0131#diagnostics — a manifest naming an id the
                // host does not carry refuses under the load-time identity
                // code, beside recomputation mismatch and unknown node kind.
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
                    "runtime",
                    format!(
                        "function {} references unregistered platform schema {schema}",
                        function.name
                    ),
                ));
            }
        }
        ResultValueContract::MediaRefV1 {
            source_table,
            source_field,
            source_field_generation,
            optional: _,
            class_m_treatment,
            upload_intent,
            policy_generation,
            kinds,
            delivery: _,
            variants,
            classification_profile,
            retention_class,
        } => {
            if lane != ContractLane::Result
                || source_table.is_empty()
                || source_field.is_empty()
                || !source_field_generation.starts_with("sha256:")
                || class_m_treatment != "class-m.none.v1"
                || upload_intent.is_empty()
                || policy_generation.is_empty()
                || kinds.is_empty()
                || kinds.iter().collect::<BTreeSet<_>>().len() != kinds.len()
                || variants.iter().any(String::is_empty)
                || variants.iter().collect::<BTreeSet<_>>().len() != variants.len()
                || classification_profile != "detected-content-type.v1"
                || retention_class != "media-reference.v1"
            {
                return Err(invalid_result_contract(
                    function,
                    "mediaRef.v1 carries invalid source or projection-profile facts",
                ));
            }
        }
        ResultValueContract::Null
        | ResultValueContract::Boolean
        | ResultValueContract::Principal
        // @ref LLP 0180#declaration — a command's mapped mutation argument
        // retains the AssetRef contract node. Runtime ingress admits only the
        // opaque non-empty id; LLP 0044's attach boundary still owns policy,
        // ownership, readiness, and reverse-reference authorization.
        | ResultValueContract::AssetRef
        | ResultValueContract::Id { .. } => {}
    }
    Ok(())
}

/// Load-time integrity of the argument-contract descriptor (LLP 0131): node
/// bounds under the shared profile, hash pairing under the v2 domain, and the
/// fail-closed capability requirement for structured/reference declarations.
fn validate_args_contract_definition(function: &FunctionDefinition) -> SnapbackResult<()> {
    let Some(contract) = &function.args_contract else {
        // Legacy manifests (v1 args hash, no descriptor) keep loading; the
        // runtime ingress seam validates only descriptor-carrying functions.
        return Ok(());
    };
    let mut object_fields = 0;
    let mut names = BTreeSet::new();
    for field in &contract.fields {
        if field.name.is_empty() || !names.insert(field.name.as_str()) {
            return Err(invalid_args_contract(
                function,
                "argument names must be non-empty and unique",
            ));
        }
        validate_value_contract_node(
            function,
            &field.value,
            0,
            &mut object_fields,
            ContractLane::Args,
        )?;
    }
    match function.args_contract_hash.as_deref() {
        None => {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
                "runtime",
                format!(
                    "function {} must pair its argument contract and argsContractHash",
                    function.name
                ),
            ));
        }
        Some(actual) => {
            let expected = args_contract_hash(contract)?;
            if actual != expected {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
                    "runtime",
                    format!(
                        "function {} argsContractHash does not authenticate its argument contract",
                        function.name
                    ),
                ));
            }
        }
    }
    // @ref LLP 0131#runtime-ingress-validation — the capability posture is
    // app-wide: every function carrying the v2 descriptor requires
    // `args_contract_v1`, scalar-only and empty argument roots included,
    // the same fail-closed pattern result_contract_v1 uses.
    if !function
        .required_capabilities
        .iter()
        .any(|capability| capability == "args_contract_v1")
    {
        return Err(SnapbackError::error(
            "SNAPBACK_CAPABILITY_UNSUPPORTED",
            "capability",
            format!(
                "function {} carries an argument contract without args_contract_v1",
                function.name
            ),
        ));
    }
    Ok(())
}

/// The live-search author contract is narrower than the reusable SearchQuery
/// plan carrier: first-page-only args and a concrete SearchItem row contract.
/// Schema expansion of that row is checked again against the named index at
/// pair activation in `local.rs`.
fn validate_live_search_contracts(function: &FunctionDefinition) -> SnapbackResult<()> {
    if !matches!(
        (&function.kind, &function.runtime),
        (
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::SearchQuery(_))
        )
    ) {
        return Ok(());
    }
    let expected_args = FunctionArgsContract {
        fields: vec![
            ResultObjectFieldContract {
                name: "query".to_owned(),
                required: true,
                value: ResultValueContract::PlatformSchemaRef {
                    authority: SchemaRefAuthority::Platform,
                    schema: SCHEMA_REF_SEARCH_QUERY_AST_V1.to_owned(),
                },
            },
            ResultObjectFieldContract {
                name: "limit".to_owned(),
                required: false,
                value: ResultValueContract::Integer { min: 1, max: 50 },
            },
        ],
    };
    if function.args_contract.as_ref() != Some(&expected_args) {
        return Err(invalid_args_contract(
            function,
            "live search requires exactly query: PlatformSchemaRef(search AST) and optional limit: integer 1..50",
        ));
    }
    if !matches!(
        function.result_contract,
        FunctionResultContract::Records { .. }
    ) {
        return Err(invalid_result_contract(
            function,
            "live search requires a concrete schema-derived SearchItem records contract",
        ));
    }
    Ok(())
}

fn validate_result_contract_definition(function: &FunctionDefinition) -> SnapbackResult<()> {
    let compatible = matches!(
        (&function.kind, &function.result_contract),
        (_, FunctionResultContract::Unknown)
            | (
                FunctionKind::Query | FunctionKind::LiveQuery,
                FunctionResultContract::Documents { .. }
                    | FunctionResultContract::Records { .. }
                    | FunctionResultContract::LegacyQueryRowsV0 { .. }
                    | FunctionResultContract::Document { .. }
                    | FunctionResultContract::Value { .. },
            )
            | (
                FunctionKind::Mutation | FunctionKind::Action,
                FunctionResultContract::Document { .. } | FunctionResultContract::Value { .. },
            )
    );
    if !compatible {
        return Err(SnapbackError::error(
            "SNAPBACK_RESULT_CONTRACT_KIND_MISMATCH",
            "runtime",
            format!(
                "function {} result contract does not match kind {:?}",
                function.name, function.kind
            ),
        ));
    }
    let value_contract = match &function.result_contract {
        FunctionResultContract::Unknown => None,
        FunctionResultContract::Documents { table, document }
        | FunctionResultContract::Document { table, document } => {
            if table.is_empty() {
                return Err(invalid_result_contract(
                    function,
                    "result contract names an empty table",
                ));
            }
            Some(document)
        }
        FunctionResultContract::Records { record, rows } => {
            let closed_object = matches!(
                record,
                ResultValueContract::Object {
                    allow_extra: false,
                    ..
                }
            );
            let sealed_object_union = matches!(
                record,
                ResultValueContract::Union { variants }
                    if variants.iter().all(|variant| matches!(
                        variant,
                        ResultValueContract::Object { allow_extra: false, .. }
                    ))
            );
            if !closed_object && !sealed_object_union {
                return Err(invalid_result_contract(
                    function,
                    "records result must carry a closed object or discriminated closed-object union contract",
                ));
            }
            if rows.as_ref().is_some_and(|bound| {
                bound.min_items > bound.max_items
                    || bound.max_items > RESULT_CONTRACT_MAX_ARRAY_ITEMS
            }) {
                return Err(invalid_result_contract(
                    function,
                    "records row bounds require 0 <= minItems <= maxItems <= 1,024",
                ));
            }
            Some(record)
        }
        FunctionResultContract::Value { value } => Some(value),
        FunctionResultContract::LegacyQueryRowsV0 { row } => Some(row),
    };
    if let Some(contract) = value_contract {
        let mut object_fields = 0;
        validate_result_value_contract(function, contract, 0, &mut object_fields)?;
        if matches!(function.kind, FunctionKind::Action) && value_contract_contains_media(contract)
        {
            return Err(SnapbackError::error(
                "SNAPBACK_MEDIA_PROJECTION_SNAPSHOT_UNAVAILABLE",
                "assets",
                "an Action direct result cannot carry mediaRef.v1; return it from a Query or Mutation",
            ));
        }
        // @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
        // — a media proof must bind a concrete generated function artifact;
        // optional implementation identity cannot collapse to `None == None`.
        if value_contract_contains_media(contract) && function.implementation_hash.is_none() {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
                "runtime",
                format!(
                    "media-bearing function {} requires a concrete implementationHash",
                    function.name
                ),
            ));
        }
    }
    if let Some(form) = function.handler_form.as_deref() {
        let form_matches = matches!(
            (form, &function.runtime),
            ("inline" | "module", FunctionRuntime::IbexModule(_))
                | ("plan", FunctionRuntime::HostPlan(_))
        );
        if !form_matches {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_HANDLER_FORM_INVALID",
                "runtime",
                format!("function {} has an invalid handler form", function.name),
            ));
        }
        if form == "inline"
            && !function
                .required_capabilities
                .iter()
                .any(|capability| capability == "inline_handler_v1")
        {
            return Err(SnapbackError::error(
                "SNAPBACK_CAPABILITY_UNSUPPORTED",
                "capability",
                format!(
                    "function {} uses an inline handler without inline_handler_v1",
                    function.name
                ),
            ));
        }
    }
    for hash in [
        function.implementation_hash.as_deref(),
        function.args_contract_hash.as_deref(),
        function.result_contract_hash.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        let digest = hash.strip_prefix("sha256:").unwrap_or_default();
        if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
                "runtime",
                format!(
                    "function {} carries an invalid contract hash",
                    function.name
                ),
            ));
        }
    }
    match (
        &function.result_contract,
        function.result_contract_hash.as_deref(),
    ) {
        (FunctionResultContract::Unknown, None) => {}
        (_, None) => {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
                "runtime",
                format!(
                    "function {} must pair its concrete result contract and resultContractHash",
                    function.name
                ),
            ));
        }
        (contract, Some(actual)) => {
            let expected = result_contract_hash(contract)?;
            if actual != expected {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
                    "runtime",
                    format!(
                        "function {} resultContractHash does not authenticate its effective contract",
                        function.name
                    ),
                ));
            }
        }
    }
    if function.result_contract_hash.is_some()
        && !function
            .required_capabilities
            .iter()
            .any(|capability| capability == "result_contract_v1")
    {
        return Err(SnapbackError::error(
            "SNAPBACK_CAPABILITY_UNSUPPORTED",
            "capability",
            format!(
                "function {} carries a result contract without result_contract_v1",
                function.name
            ),
        ));
    }
    Ok(())
}

pub fn value_contract_contains_media(contract: &ResultValueContract) -> bool {
    match contract {
        ResultValueContract::MediaRefV1 { .. } => true,
        ResultValueContract::Array { element, .. } => value_contract_contains_media(element),
        ResultValueContract::Tuple { elements }
        | ResultValueContract::Union { variants: elements } => {
            elements.iter().any(value_contract_contains_media)
        }
        ResultValueContract::Object { fields, .. } => fields
            .iter()
            .any(|field| value_contract_contains_media(&field.value)),
        _ => false,
    }
}

pub fn result_contract_contains_media(contract: &FunctionResultContract) -> bool {
    match contract {
        FunctionResultContract::Unknown => false,
        FunctionResultContract::Documents { document, .. }
        | FunctionResultContract::Document { document, .. } => {
            value_contract_contains_media(document)
        }
        FunctionResultContract::Records { record, .. }
        | FunctionResultContract::LegacyQueryRowsV0 { row: record }
        | FunctionResultContract::Value { value: record } => value_contract_contains_media(record),
    }
}

fn result_row_contract_has_field(contract: &FunctionResultContract, field: &str) -> Option<bool> {
    let row = match contract {
        FunctionResultContract::Documents { document, .. }
        | FunctionResultContract::Document { document, .. } => document,
        FunctionResultContract::Records { record, .. } => record,
        FunctionResultContract::Value { value } => value,
        FunctionResultContract::LegacyQueryRowsV0 { row } => row,
        FunctionResultContract::Unknown => return None,
    };
    match row {
        ResultValueContract::Object { fields, .. } => {
            Some(fields.iter().any(|candidate| candidate.name == field))
        }
        ResultValueContract::Union { variants }
            if !variants.is_empty()
                && variants
                    .iter()
                    .all(|variant| matches!(variant, ResultValueContract::Object { .. })) =>
        {
            Some(variants.iter().all(|variant| {
                let ResultValueContract::Object { fields, .. } = variant else {
                    unreachable!("guard above admits only object variants")
                };
                fields.iter().any(|candidate| candidate.name == field)
            }))
        }
        _ => None,
    }
}

fn validate_field_boundary(function: &FunctionDefinition) -> SnapbackResult<()> {
    let Some(boundary) = &function.field_boundary else {
        return Ok(());
    };
    let invalid = |code: &'static str, reason: String| {
        SnapbackError::error(
            code,
            "function",
            format!(
                "function {} declares an invalid fieldBoundary: {reason}",
                function.name
            ),
        )
        .with_details(serde_json::json!({
            "function": function.name,
            "fields": boundary.fields,
            "condition": boundary.condition,
            "reason": reason,
        }))
    };
    if !matches!(function.kind, FunctionKind::Query | FunctionKind::LiveQuery)
        || !matches!(function.runtime, FunctionRuntime::IbexModule(_))
    {
        return Err(invalid(
            "SNAPBACK_FIELD_BOUNDARY_SPEC_INVALID",
            "only an IbexModule Query or LiveQuery may carry the handler-enforced residual"
                .to_owned(),
        ));
    }
    let mut seen = BTreeSet::new();
    if boundary.fields.is_empty()
        || boundary
            .fields
            .iter()
            .any(|field| field.is_empty() || field.trim() != field || !seen.insert(field.as_str()))
    {
        return Err(invalid(
            "SNAPBACK_FIELD_BOUNDARY_FIELDS_INVALID",
            "fields must be a non-empty list of unique field names without surrounding whitespace"
                .to_owned(),
        ));
    }
    if boundary.condition.trim().is_empty() {
        return Err(invalid(
            "SNAPBACK_FIELD_BOUNDARY_CONDITION_INVALID",
            "condition must be a non-empty free-text disclosure claim".to_owned(),
        ));
    }
    for field in &boundary.fields {
        if result_row_contract_has_field(&function.result_contract, field) == Some(false) {
            return Err(invalid(
                "SNAPBACK_FIELD_BOUNDARY_FIELD_UNKNOWN",
                format!("field {field:?} is absent from the effective result row contract"),
            ));
        }
    }
    Ok(())
}

fn validate_elevated_read_capabilities(function: &FunctionDefinition) -> SnapbackResult<()> {
    if function.elevated_db_capabilities.is_empty() {
        return Ok(());
    }
    let refuse = |reason: String| {
        SnapbackError::error(
            "SNAPBACK_ELEVATED_READ_CAPABILITY_UNDECLARED",
            "auth",
            format!(
                "function {} carries an invalid elevated-read host capability: {reason}",
                function.name
            ),
        )
        .with_details(serde_json::json!({
            "function": function.name,
            "reason": reason,
        }))
    };
    if !matches!(function.runtime, FunctionRuntime::IbexModule(_))
        || !matches!(
            function.kind,
            FunctionKind::Query | FunctionKind::LiveQuery | FunctionKind::Mutation
        )
    {
        return Err(refuse(
            "only a named Ibex query or mutation may carry elevated-read capability".to_owned(),
        ));
    }
    let mut forms = BTreeSet::new();
    for capability in &function.elevated_db_capabilities {
        if !forms.insert(&capability.form) {
            return Err(refuse("read forms must be unique".to_owned()));
        }
        match &capability.tables {
            ElevatedReadTableCeilingV1::Opaque(value) if value == "opaque" => {}
            ElevatedReadTableCeilingV1::Opaque(_) => {
                return Err(refuse("the only string table ceiling is opaque".to_owned()));
            }
            ElevatedReadTableCeilingV1::Tables(tables) => {
                let mut prior = None;
                if tables.is_empty()
                    || tables.iter().any(|table| {
                        let invalid = table.is_empty()
                            || table.trim() != table
                            || prior.is_some_and(|previous| previous >= table.as_str());
                        prior = Some(table.as_str());
                        invalid
                    })
                {
                    return Err(refuse(
                        "table ceilings must be non-empty, unique, and canonically sorted"
                            .to_owned(),
                    ));
                }
            }
        }
    }
    Ok(())
}

fn validate_custom_authorization(function: &FunctionDefinition) -> SnapbackResult<()> {
    let Some(custom) = &function.custom_authorization else {
        return Ok(());
    };
    let invalid = |reason: &str| {
        SnapbackError::error(
            "SNAPBACK_CUSTOM_AUTHORIZATION_MANIFEST_INVALID",
            "auth",
            format!(
                "function {} has invalid custom authorization: {reason}",
                function.name
            ),
        )
    };
    if !matches!(
        function.kind,
        FunctionKind::Query | FunctionKind::LiveQuery | FunctionKind::Mutation
    ) || !matches!(function.runtime, FunctionRuntime::IbexModule(_))
    {
        return Err(invalid(
            "only query/live-query/mutation Ibex handlers are admitted",
        ));
    }
    if function.effective_auth_requirement() != AuthRequirement::Authenticated {
        return Err(invalid(
            "the operation must require an authenticated principal",
        ));
    }
    if function.retainable
        || custom.offline != "none"
        || custom.sync != "coarse-global"
        || custom.input_completeness != "unproven"
        || custom.pushdown != "none"
        || custom.retention != "none"
        || custom.precise_invalidation
    {
        return Err(invalid(
            "coarse-global must remain online-only with no pushdown, retention, precise invalidation, or completeness claim",
        ));
    }
    let expected_wake_universe = vec![
        "membership-relation-insert-update-delete".to_owned(),
        "protected-resource-row-insert-update-delete".to_owned(),
        "effective-principal-or-auth-context-change".to_owned(),
        "authority-profile-generation-activation".to_owned(),
    ];
    if custom.coarse_global_wake_universe != expected_wake_universe {
        return Err(invalid(
            "the coarse-global wake universe is not the closed LLP 0240 set",
        ));
    }
    if custom.inputs.is_empty()
        || custom.inputs.iter().any(|input| {
            input.kind != "table"
                || !is_user_identifier(&input.table)
                || input.subject != "ctx.auth.userId"
                || input.key.is_empty()
                || input.key.iter().any(|field| !is_user_identifier(field))
                || input.key.iter().collect::<BTreeSet<_>>().len() != input.key.len()
                || !function.read_set_summary.tables.contains(&input.table)
        })
    {
        return Err(invalid(
            "policy inputs are empty, malformed, repeated, or outside the read set",
        ));
    }
    let digest = custom
        .evaluator_identity
        .strip_prefix("sha256:")
        .unwrap_or_default();
    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(invalid("evaluatorIdentity is not a sha256 digest"));
    }
    let dimensions = function
        .authorization_dependence
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    if !dimensions.contains(&AuthorizationInputDimension::UserId)
        || !dimensions.contains(&AuthorizationInputDimension::Opaque)
    {
        return Err(invalid(
            "authorizationDependence must disclose userId and opaque",
        ));
    }
    Ok(())
}

fn validate_authority_independent(function: &FunctionDefinition) -> SnapbackResult<()> {
    if !function.authority_independent {
        return Ok(());
    }

    let eligible_kind = matches!(function.kind, FunctionKind::Query | FunctionKind::LiveQuery);
    let eligible_requirement = function.effective_auth_requirement() == AuthRequirement::Public;
    let eligible_declarations = function.uses.is_empty()
        && function.read_set_summary.auth_scope_field.is_none()
        && function.authorization_dependence.is_empty();
    let eligible_runtime = match &function.runtime {
        FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) => {
            plan.table_visibility.is_none()
                && !plan
                    .filters
                    .iter()
                    .any(|filter| value_expr_uses_authority_or_ambient_input(&filter.value))
        }
        // @ref LLP 0136#admission-path-decision — structural admission is
        // only half the proof. `validate_function_schema_references` binds
        // this declaration to an exact public-read search index before the
        // artifact pair can activate.
        FunctionRuntime::HostPlan(HandlerPlan::SearchQuery(_)) => {
            function.kind == FunctionKind::LiveQuery
        }
        // @ref LLP 0209#3-authorization-at-every-node — a graph whose complete
        // admitted node set is class 1 has no caller authority partition.
        // Graph admission separately proves those class-1 reads public and
        // refuses forged authority labels against the installed schema.
        FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(carrier)) => carrier
            .normalized_plan
            .nodes
            .iter()
            .all(|node| node.authority().declared_class == GraphAuthorityClassV1::INDEPENDENT),
        FunctionRuntime::HostPlan(_) | FunctionRuntime::IbexModule(_) => false,
    };

    if eligible_kind && eligible_requirement && eligible_declarations && eligible_runtime {
        return Ok(());
    }

    Err(SnapbackError::error(
        "SNAPBACK_AUTHORITY_INDEPENDENT_INVALID",
        "auth",
        format!(
            "function {} does not satisfy the authority-independent HostPlan profile",
            function.name
        ),
    )
    .with_details(serde_json::json!({
        "function": function.name,
        "kind": &function.kind,
        "authRequirement": function.effective_auth_requirement().as_str(),
        "hostPlanQuery": matches!(&function.runtime, FunctionRuntime::HostPlan(HandlerPlan::Query(_) | HandlerPlan::GraphQuery(_))),
        "usesConfig": !function.uses.is_empty(),
        "authScopeField": function.read_set_summary.auth_scope_field.as_deref(),
        "authorizationDependence": &function.authorization_dependence,
    })))
}

/// LLP 0092 §0C.3: `publicInline` is a disclosure permission accepted only on
/// a query that also carries a *valid* `authorityIndependent: true`
/// declaration (which entails `public` under the existing invariant —
/// [`validate_authority_independent`] runs first, so reaching this check with
/// `authority_independent` set means the declaration validated). v1 keeps the
/// narrower rule fail-closed: no consumer exists for a
/// public-but-authority-dependent inline query.
/// Application refusal codes live in their own namespace and are a closed,
/// declared set. The vocabulary is deliberately narrow — screaming snake case,
/// bounded count and length — so an app code can never be confused with a
/// platform `SNAPBACK_*` diagnostic on any surface that renders both.
///
/// @ref LLP 0108#declared-application-refusals
const MAX_DECLARED_REFUSALS: usize = 64;
const MAX_REFUSAL_CODE_LEN: usize = 64;

/// A declarative mutation's app-namespaced failures share LLP 0108's closed
/// refusal declaration with imperative `ctx.refuse`. Platform-owned
/// `SNAPBACK_*` outcomes are intentionally outside that declaration.
///
/// @ref LLP 0108#declared-application-refusals
fn validate_plan_refusal_declarations(function: &FunctionDefinition) -> SnapbackResult<()> {
    let FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan)) = &function.runtime else {
        return Ok(());
    };
    for (step_index, step) in plan.steps.iter().enumerate() {
        let (step_kind, code) = match step {
            MutationStep::Get {
                else_error: Some(code),
                ..
            } => ("Get", code),
            MutationStep::Guard { else_error, .. } => ("Guard", else_error),
            _ => continue,
        };
        if code.starts_with("SNAPBACK_")
            || function.refusals.iter().any(|declared| declared == code)
        {
            continue;
        }
        return Err(SnapbackError::error(
            "SNAPBACK_FUNCTION_PLAN_REFUSAL_UNDECLARED",
            "runtime",
            format!(
                "function {} {step_kind} step {step_index} emits undeclared app refusal {code}",
                function.name
            ),
        )
        .with_details(serde_json::json!({
            "function": function.name,
            "refusal": code,
            "stepKind": step_kind,
            "stepIndex": step_index,
        })));
    }
    Ok(())
}

fn validate_declared_refusals(function: &FunctionDefinition) -> SnapbackResult<()> {
    if function.refusals.is_empty() && function.tracked_refusals.is_empty() {
        return Ok(());
    }
    let invalid = |reason: &str, code: &str| {
        Err(SnapbackError::error(
            "SNAPBACK_FUNCTION_REFUSAL_DECLARATION_INVALID",
            "runtime",
            format!(
                "function {} declares an invalid refusal: {reason}",
                function.name
            ),
        )
        .with_details(serde_json::json!({
            "function": function.name,
            "refusal": code,
            "reason": reason,
        })))
    };
    if function.refusals.len() > MAX_DECLARED_REFUSALS {
        return invalid("more than 64 declared refusals", "");
    }
    let mut seen = std::collections::BTreeSet::new();
    for code in &function.refusals {
        if code.is_empty() || code.len() > MAX_REFUSAL_CODE_LEN {
            return invalid("code must be 1..=64 characters", code);
        }
        if code.starts_with("SNAPBACK_") {
            return invalid("code must not use the reserved SNAPBACK_ namespace", code);
        }
        if !code
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
        {
            return invalid("code must be A-Z, 0-9, and underscore", code);
        }
        if !seen.insert(code.as_str()) {
            return invalid("duplicate declared refusal", code);
        }
    }
    let invalid_tracking = |reason: &str, code: &str| {
        Err(SnapbackError::error(
            "SNAPBACK_FUNCTION_TRACKED_REFUSAL_INVALID",
            "runtime",
            format!(
                "function {} declares invalid refusal tracking: {reason}",
                function.name
            ),
        )
        .with_details(serde_json::json!({
            "function": function.name,
            "trackedRefusal": code,
            "reason": reason,
        })))
    };
    if function.tracked_refusals.len() > MAX_DECLARED_REFUSALS {
        return invalid_tracking("more than 64 tracked refusals", "");
    }
    let mut seen_tracked = std::collections::BTreeSet::new();
    for code in &function.tracked_refusals {
        if !seen.contains(code.as_str()) {
            return invalid_tracking("tracked refusal must also be declared", code);
        }
        if !seen_tracked.insert(code.as_str()) {
            return invalid_tracking("duplicate tracked refusal", code);
        }
    }
    Ok(())
}

fn validate_bounded_skew_definition(function: &FunctionDefinition) -> SnapbackResult<()> {
    let Some(declaration) = &function.bounded_skew else {
        return Ok(());
    };
    let invalid = |reason: &str| {
        SnapbackError::error(
            "SNAPBACK_BOUNDED_SKEW_DECLARATION_INVALID",
            "runtime",
            format!(
                "function {} declares invalid boundedSkew: {reason}",
                function.name
            ),
        )
        .with_details(serde_json::json!({
            "function": function.name,
            "field": declaration.field,
            "maxSkewMs": declaration.max_skew_ms,
        }))
    };
    if declaration.field.is_empty() {
        return Err(invalid("field must be non-empty"));
    }
    if !(1..=SETTLEMENT_BOUNDED_SKEW_MAX_MS).contains(&declaration.max_skew_ms) {
        return Err(invalid("maxSkewMs is outside 1..=86400000"));
    }
    if !function
        .required_capabilities
        .iter()
        .any(|capability| capability == "settlement.bounded_skew")
    {
        return Err(invalid("the declaration requires settlement.bounded_skew"));
    }
    let plan = match &function.runtime {
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan))
        | FunctionRuntime::HostPlan(HandlerPlan::WriteWithActivity(WriteWithActivityPlan {
            mutation: plan,
            ..
        })) => plan,
        _ => {
            return Err(invalid(
                "only HostPlan mutations can prove a direct time sink",
            ));
        }
    };
    let matching = plan.steps.iter().filter_map(|step| match step {
        MutationStep::Insert { values, .. }
        | MutationStep::Patch { values, .. }
        | MutationStep::InsertEach { values, .. } => values.get(&declaration.field),
        _ => None,
    });
    let matching = matching.collect::<Vec<_>>();
    // @ref LLP 0133#the-bounded-skew-opt-in — v0.2 admits exactly one
    //   structural leaf assignment, directly equal to RuntimeNow. No value
    //   flow or transformed/nested expression can acquire this authority.
    if matching.len() != 1 || !matches!(matching[0], ValueExpr::RuntimeNow) {
        return Err(invalid(
            "field must name exactly one direct RuntimeNow write assignment",
        ));
    }
    Ok(())
}

fn validate_public_inline(function: &FunctionDefinition) -> SnapbackResult<()> {
    if !function.public_inline {
        return Ok(());
    }
    // @ref LLP 0136#admission-path-decision — public-read live search is
    // authority-independent, but it is not approved for Channel-A inline
    // disclosure. Keep this refusal plan-shaped so direct manifests cannot
    // bypass the authoring surface.
    if matches!(
        &function.runtime,
        FunctionRuntime::HostPlan(HandlerPlan::SearchQuery(_))
    ) {
        return Err(SnapbackError::error(
            "SNAPBACK_PUBLIC_INLINE_INVALID",
            "auth",
            format!(
                "function {} declares publicInline on a search-plan function",
                function.name
            ),
        )
        .with_details(serde_json::json!({
            "function": function.name,
            "runtime": "search-query",
        })));
    }
    if function.authority_independent {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_PUBLIC_INLINE_INVALID",
        "auth",
        format!(
            "function {} declares publicInline without a valid authorityIndependent declaration",
            function.name
        ),
    )
    .with_details(serde_json::json!({
        "function": function.name,
        "authRequirement": function.effective_auth_requirement().as_str(),
    })))
}

/// The derived, never-authored `rqsEligible` served-manifest predicate
/// (LLP 0270 D1/D2; LLP 0092 §0C.2): public application semantics AND the
/// host-owned LLP 0053 closed-inputs proof — HostPlan query runtime, no ambient
/// or membership dependency, and a complete `singleTable` read summary whose
/// table set equals the plan's. The app-authored `authorityIndependent` flag
/// is deliberately not an input to this public-exact retention admission.
/// Evaluated non-erroringly: a query failing the proof is simply not eligible,
/// never a load error. Returns the digest kind the eligible query's
/// `contentDigest` takes (LLP 0091 §0A.4's selector: DK-3-analyzable unordered
/// → `mset1`; ordered/limited replace-only → `seq1`).
///
/// Everything keyed on the predicate — token minting, bundle `resume`
/// presence, Channel B persistence, D1.1 admission — reads this one derived
/// fact; there is no authored `rqsEligible` field anywhere (an authored field
/// of that name refuses at load via `deny_unknown_fields`).
pub fn rqs_eligible_digest_kind(
    function: &FunctionDefinition,
) -> Option<crate::rqs_contract::DigestKind> {
    // @ref LLP 0244#d4-result-artifact-retention-and-rqs-identity-rotate-explicitly
    // — media projection reads protected asset metadata in addition to the
    // app table, so it cannot inhabit the current exact one-table RQS class.
    if result_contract_contains_media(&function.result_contract) {
        return None;
    }
    if function.kind != FunctionKind::LiveQuery {
        return None;
    }
    if function.effective_auth_requirement() != AuthRequirement::Public {
        return None;
    }
    if !function.uses.is_empty()
        || function.read_set_summary.auth_scope_field.is_some()
        || !function.authorization_dependence.is_empty()
    {
        return None;
    }
    let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &function.runtime else {
        return None;
    };
    if plan
        .filters
        .iter()
        .any(|filter| value_expr_uses_authority_or_ambient_input(&filter.value))
    {
        return None;
    }
    if !plan.membership_filters.is_empty() {
        return None;
    }
    if plan.table_visibility.is_some() {
        return None;
    }
    // Closed-inputs proof (the `validate_retainable_query` obligations for the
    // retainable class, reused as a measurement): a complete `singleTable`
    // read summary whose table set equals the plan's.
    let summary = &function.read_set_summary;
    let summary_complete = summary.mode.as_deref() == Some("singleTable")
        && summary.primary_table.as_deref() == Some(plan.table.as_str())
        && summary.tables.len() == 1
        && summary.tables.first() == Some(&plan.table);
    if !summary_complete {
        return None;
    }
    Some(if plan.order.is_empty() && plan.limit.is_none() {
        crate::rqs_contract::DigestKind::Mset1
    } else {
        crate::rqs_contract::DigestKind::Seq1
    })
}

/// Owner-admitted authority independence used by live lifecycle and bundle
/// namespace selection. Explicit validated declarations retain their existing
/// meaning; the public-exact class additionally derives the fact from the
/// closed host plan. No client/app assertion can widen this predicate.
// @ref LLP 0270#d1-default-is-automatic-request-plus-owner-admission — the
// owner proof, not local configuration, selects the authority-independent lane.
pub fn owner_admits_authority_independence(function: &FunctionDefinition) -> bool {
    function.authority_independent || rqs_eligible_digest_kind(function).is_some()
}

pub fn value_expr_uses_authority_or_ambient_input(value: &ValueExpr) -> bool {
    match value {
        ValueExpr::AuthUserId
        | ValueExpr::AuthKind
        | ValueExpr::AuthActorKind
        | ValueExpr::AuthActivityActorKind
        | ValueExpr::AuthActorUserId
        | ValueExpr::AuthGrantId
        | ValueExpr::ClientMutationDigest
        | ValueExpr::AuthIsDelegated
        | ValueExpr::RuntimeId
        | ValueExpr::RuntimeNow => true,
        ValueExpr::Arg(_) | ValueExpr::Args | ValueExpr::Binding(_) | ValueExpr::Literal(_) => {
            false
        }
        ValueExpr::Field { base, .. } => value_expr_uses_authority_or_ambient_input(base),
        ValueExpr::Binary { left, right, .. } => {
            value_expr_uses_authority_or_ambient_input(left)
                || value_expr_uses_authority_or_ambient_input(right)
        }
        ValueExpr::Unary { expr, .. } => value_expr_uses_authority_or_ambient_input(expr),
        ValueExpr::If { cond, then, r#else } => {
            value_expr_uses_authority_or_ambient_input(cond)
                || value_expr_uses_authority_or_ambient_input(then)
                || value_expr_uses_authority_or_ambient_input(r#else)
        }
        ValueExpr::Concat(values) | ValueExpr::Call { args: values, .. } => values
            .iter()
            .any(value_expr_uses_authority_or_ambient_input),
        ValueExpr::Record { fields } => fields
            .values()
            .any(value_expr_uses_authority_or_ambient_input),
        // A membership semi-join always reads the effective principal (the
        // implicit `auth.userId` axis of the lookup), so it depends on
        // authority by construction.
        ValueExpr::MembershipExists(_) => true,
    }
}

fn single_table_plan_invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_SINGLE_TABLE_PLAN_INVALID",
        "query",
        message.into(),
    )
}

fn normalize_single_table_value_expr(value: &ValueExpr) -> SnapbackResult<SingleTableValueExprV1> {
    let normalized = match value {
        ValueExpr::Args => SingleTableValueExprV1::Args,
        ValueExpr::Arg(path) => SingleTableValueExprV1::Arg(path.clone()),
        ValueExpr::Binding(name) => SingleTableValueExprV1::Binding(name.clone()),
        ValueExpr::Literal(literal) => {
            // JCS is the cross-target numeric/literal profile. In particular,
            // it refuses integers outside the interoperable 53-bit domain.
            crate::rqs_contract::jcs(literal).map_err(|_| {
                single_table_plan_invalid(
                    "single-table literal is outside the RFC 8785 portable JSON profile",
                )
            })?;
            SingleTableValueExprV1::Literal(literal.clone())
        }
        ValueExpr::Field { base, key } => SingleTableValueExprV1::Field {
            base: Box::new(normalize_single_table_value_expr(base)?),
            key: key.clone(),
        },
        ValueExpr::Binary { op, left, right } => SingleTableValueExprV1::Binary {
            op: *op,
            left: Box::new(normalize_single_table_value_expr(left)?),
            right: Box::new(normalize_single_table_value_expr(right)?),
        },
        ValueExpr::Unary { op, expr } => SingleTableValueExprV1::Unary {
            op: *op,
            expr: Box::new(normalize_single_table_value_expr(expr)?),
        },
        ValueExpr::If { cond, then, r#else } => SingleTableValueExprV1::If {
            cond: Box::new(normalize_single_table_value_expr(cond)?),
            then: Box::new(normalize_single_table_value_expr(then)?),
            r#else: Box::new(normalize_single_table_value_expr(r#else)?),
        },
        ValueExpr::Concat(values) => SingleTableValueExprV1::Concat(
            values
                .iter()
                .map(normalize_single_table_value_expr)
                .collect::<SnapbackResult<Vec<_>>>()?,
        ),
        ValueExpr::Call { func, args } => SingleTableValueExprV1::Call {
            func: func.clone(),
            args: args
                .iter()
                .map(normalize_single_table_value_expr)
                .collect::<SnapbackResult<Vec<_>>>()?,
        },
        ValueExpr::Record { fields } => SingleTableValueExprV1::Record {
            fields: fields
                .iter()
                .map(|(name, value)| Ok((name.clone(), normalize_single_table_value_expr(value)?)))
                .collect::<SnapbackResult<BTreeMap<_, _>>>()?,
        },
        ValueExpr::AuthUserId
        | ValueExpr::AuthKind
        | ValueExpr::AuthActorKind
        | ValueExpr::AuthActivityActorKind
        | ValueExpr::AuthActorUserId
        | ValueExpr::AuthGrantId
        | ValueExpr::ClientMutationDigest
        | ValueExpr::AuthIsDelegated
        | ValueExpr::RuntimeId
        | ValueExpr::RuntimeNow
        | ValueExpr::MembershipExists(_) => {
            return Err(single_table_plan_invalid(
                "single-table value expression uses an authority, ambient, or membership input",
            ));
        }
    };
    Ok(normalized)
}

/// Reconstruct the typed class plan from the served function. Returning
/// `None` is the non-erroring class-selection outcome; only a function that
/// already passed the derived predicate can receive a typed normalization
/// refusal.
pub fn single_table_plan_v1(
    function: &FunctionDefinition,
) -> SnapbackResult<Option<SingleTablePlanV1>> {
    let Some(digest_kind) = rqs_eligible_digest_kind(function) else {
        return Ok(None);
    };
    let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &function.runtime else {
        unreachable!("rqs eligibility admits only HostPlan Query")
    };
    validate_query_plan_shape(plan)?;
    let filters = plan
        .filters
        .iter()
        .map(|filter| {
            let op = match filter.op {
                FilterOp::Eq => SingleTableFilterOpV1::Eq,
                FilterOp::In => SingleTableFilterOpV1::In,
                FilterOp::Lt => SingleTableFilterOpV1::Lt,
                FilterOp::Lte => SingleTableFilterOpV1::Lte,
                FilterOp::Gt => SingleTableFilterOpV1::Gt,
                FilterOp::Gte => SingleTableFilterOpV1::Gte,
            };
            Ok(SingleTableFilterV1 {
                field: filter.field.clone(),
                op,
                value: normalize_single_table_value_expr(&filter.value)?,
            })
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    let order = plan
        .order
        .iter()
        .map(|order| {
            if order
                .max_encoded_bytes
                .is_some_and(|bound| bound == 0 || bound > 9_007_199_254_740_991)
            {
                return Err(single_table_plan_invalid(
                    "single-table maxEncodedBytes must be a positive safe integer",
                ));
            }
            Ok(SingleTableOrderV1 {
                field: order.field.clone(),
                direction: order.direction.clone(),
                max_encoded_bytes: order.max_encoded_bytes,
            })
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    Ok(Some(SingleTablePlanV1 {
        format: "snapback.single-table-plan.v1".to_owned(),
        query: SingleTableQueryV1 {
            table: plan.table.clone(),
            filters,
            membership_filters: Vec::new(),
            order,
            limit: plan.limit,
            indexed_by: plan.indexed_by.clone(),
        },
        rqs_digest_kind: digest_kind.as_str().to_owned(),
        examined_entry_ceiling: 1_024,
    }))
}

/// Closed caller-authority dimensions that a query result may depend on.
/// Retention v1 accepts `userId` plus the effective principal `kind`, which is
/// an immutable function of that identity; spelling the rejected dimensions
/// is still important because a manifest must describe why it is online-only
/// rather than silently erasing actor/session/provider/opaque dependence.
///
/// @ref LLP 0053#retained-and-offline-authorization — retained rows survive a
///   same-user session replacement, so every other authority dimension is
///   deliberately ineligible.
#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum AuthorizationInputDimension {
    UserId,
    Kind,
    ActorKind,
    IsDelegated,
    SessionId,
    Provider,
    Roles,
    IsAuthenticated,
    Opaque,
}

fn protected_input_error(function: &FunctionDefinition, input_kind: &str) -> SnapbackError {
    let code = if input_kind == "RuntimeNow" {
        "SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY"
    } else {
        "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED"
    };
    SnapbackError::error(
        code,
        "auth",
        format!(
            "protected query {} depends on denied mutable input {input_kind}",
            function.name
        ),
    )
    .with_details(serde_json::json!({
        "function": function.name,
        "inputKind": input_kind,
    }))
}

fn validate_protected_value_expr(
    function: &FunctionDefinition,
    value: &ValueExpr,
) -> SnapbackResult<()> {
    match value {
        ValueExpr::RuntimeNow => Err(protected_input_error(function, "RuntimeNow")),
        ValueExpr::RuntimeId => Err(protected_input_error(function, "RuntimeId")),
        ValueExpr::ClientMutationDigest => {
            Err(protected_input_error(function, "ClientMutationDigest"))
        }
        ValueExpr::Arg(_)
        | ValueExpr::Args
        | ValueExpr::AuthUserId
        | ValueExpr::AuthKind
        | ValueExpr::AuthActorKind
        | ValueExpr::AuthActivityActorKind
        | ValueExpr::AuthActorUserId
        | ValueExpr::AuthGrantId
        | ValueExpr::AuthIsDelegated
        | ValueExpr::Binding(_)
        | ValueExpr::Literal(_) => Ok(()),
        ValueExpr::Field { base, .. } => validate_protected_value_expr(function, base),
        ValueExpr::Binary { left, right, .. } => {
            validate_protected_value_expr(function, left)?;
            validate_protected_value_expr(function, right)
        }
        ValueExpr::Unary { expr, .. } => validate_protected_value_expr(function, expr),
        ValueExpr::If { cond, then, r#else } => {
            validate_protected_value_expr(function, cond)?;
            validate_protected_value_expr(function, then)?;
            validate_protected_value_expr(function, r#else)
        }
        ValueExpr::Concat(values) | ValueExpr::Call { args: values, .. } => {
            for value in values {
                validate_protected_value_expr(function, value)?;
            }
            Ok(())
        }
        ValueExpr::Record { fields } => {
            for value in fields.values() {
                validate_protected_value_expr(function, value)?;
            }
            Ok(())
        }
        // Admitted by the ENG-24906 amendment to LLP 0053's protected-query
        // input profile: a membership semi-join is a snapshot-bound,
        // `DatabaseCaptured` declarative expression kind. It carries no clock,
        // id, or other `MutableNonDatabase` input — its resource reference is a
        // row field or a query argument, both snapshot-bound — so it is
        // admitted rather than refused as an unknown expression kind.
        //
        // @ref LLP 0053#agent-auth-protected-query-inputs-amended-2026-07-14-eng-24906
        //   — the membership predicate node is an admitted declarative input.
        ValueExpr::MembershipExists(_) => Ok(()),
    }
}

fn validate_protected_query_profile(function: &FunctionDefinition) -> SnapbackResult<()> {
    if !function.is_protected_query() {
        return Ok(());
    }
    if let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &function.runtime {
        for filter in &plan.filters {
            validate_protected_value_expr(function, &filter.value)?;
        }
        // Membership predicates are the admitted DatabaseCaptured kind; they
        // carry no mutable non-database input to reject, but validate the
        // recursion for symmetry (a resource-ref cannot smuggle a clock).
        for predicate in &plan.membership_filters {
            let _ = predicate;
        }
    }
    Ok(())
}

/// Observed effects of a closed HostPlan, in exactly the vocabulary of
/// codegen's `EffectCeilingV1` walker (`packages/snapback-codegen/
/// effect-ceiling.mjs`). The two must stay mirror images: deriving *more*
/// here would falsely refuse legitimately generated artifacts, deriving
/// *less* would let a doctored artifact under-declare.
#[derive(Debug, Default)]
struct ObservedEffects {
    reads: BTreeSet<(String, String, Option<String>)>,
    writes: BTreeSet<(String, String)>,
    host_operations: BTreeSet<&'static str>,
    authorization_inputs: BTreeSet<&'static str>,
}

impl ObservedEffects {
    fn read(&mut self, table: &str, access: &str, index: Option<&str>) {
        self.reads.insert((
            table.to_owned(),
            access.to_owned(),
            index.map(str::to_owned),
        ));
    }

    fn write(&mut self, table: &str, operation: &str) {
        self.writes.insert((table.to_owned(), operation.to_owned()));
    }

    fn expr(&mut self, expr: &ValueExpr) {
        match expr {
            ValueExpr::AuthUserId => {
                self.authorization_inputs.insert("authUserId");
            }
            ValueExpr::AuthKind => {
                self.authorization_inputs.insert("authKind");
            }
            ValueExpr::AuthActorKind => {
                self.authorization_inputs.insert("authActorKind");
            }
            ValueExpr::AuthActivityActorKind => {
                self.authorization_inputs.insert("activityActorKind");
            }
            ValueExpr::AuthActorUserId => {
                self.authorization_inputs.insert("actualActor");
            }
            ValueExpr::AuthGrantId => {
                self.authorization_inputs.insert("grantId");
            }
            ValueExpr::ClientMutationDigest => {
                self.host_operations.insert("clientMutationDigest");
            }
            ValueExpr::AuthIsDelegated => {
                self.authorization_inputs.insert("authIsDelegated");
            }
            ValueExpr::RuntimeId => {
                self.host_operations.insert("runtimeId");
            }
            ValueExpr::RuntimeNow => {
                self.host_operations.insert("runtimeNow");
            }
            ValueExpr::MembershipExists(_) => {
                self.authorization_inputs.insert("membershipPredicate");
            }
            ValueExpr::Arg(_) | ValueExpr::Args | ValueExpr::Binding(_) | ValueExpr::Literal(_) => {
            }
            ValueExpr::Field { base, .. } => self.expr(base),
            ValueExpr::Binary { left, right, .. } => {
                self.expr(left);
                self.expr(right);
            }
            ValueExpr::Unary { expr, .. } => self.expr(expr),
            ValueExpr::If { cond, then, r#else } => {
                self.expr(cond);
                self.expr(then);
                self.expr(r#else);
            }
            ValueExpr::Concat(parts) => parts.iter().for_each(|part| self.expr(part)),
            ValueExpr::Call { args, .. } => args.iter().for_each(|arg| self.expr(arg)),
            ValueExpr::Record { fields } => fields.values().for_each(|value| self.expr(value)),
        }
    }

    fn filters(&mut self, filters: &[FilterExpr]) {
        for filter in filters {
            self.expr(&filter.value);
        }
    }

    fn handler_plan(&mut self, plan: &HandlerPlan) {
        match plan {
            HandlerPlan::Query(plan) => {
                self.read(&plan.table, "query", plan.indexed_by.as_deref());
                self.filters(&plan.filters);
                if !plan.membership_filters.is_empty() {
                    self.authorization_inputs.insert("membershipPredicate");
                }
                if let Some(visibility) = &plan.table_visibility {
                    self.authorization_inputs.insert("authUserId");
                    if visibility.contains_membership() {
                        self.authorization_inputs.insert("membershipPredicate");
                    }
                }
            }
            HandlerPlan::SearchQuery(plan) => {
                self.read(&plan.table, "search", Some(&plan.index));
            }
            HandlerPlan::VectorQuery(plan) => {
                self.read(&plan.table, "vector-search", Some(&plan.index));
            }
            HandlerPlan::JobStatusQuery(_) => {
                // A point read of the reserved job-status projection — not an
                // application schema table.
                self.read(crate::contract_types::JOBS_STATUS_TABLE, "point", None);
            }
            HandlerPlan::PushLedgerQuery(_) => {
                // A point read of the protected platform ledger. Its
                // audience authorization is evaluated by the Rust-owned
                // executor against the intent's stored arguments.
                self.read("_snapback_push_ledger_v1", "point", None);
                self.authorization_inputs
                    .insert("pushAudienceAuthorization");
            }
            HandlerPlan::RelationalQuery(plan) => {
                self.read(&plan.root, "query", Some(&plan.root_index));
                self.read(&plan.joined, "query", Some(&plan.joined_index));
                self.filters(&plan.root_filters);
                self.filters(&plan.root_visibility);
                self.filters(&plan.joined_visibility);
            }
            HandlerPlan::BoundedChildrenQuery(plan) => {
                self.read(&plan.parent_table, "point", None);
                self.read(&plan.child_table, "query", Some(&plan.child_index));
                self.authorization_inputs.insert("parentVisibility");
            }
            HandlerPlan::SnapshotBatch(plan) => {
                // @ref LLP 0135#25-work-ceiling-identity-and-live-classification
                //   — the static composite summary is the union of node
                //   dependencies. EffectCeilingV1 records access classes,
                //   not quantitative reads; the separately derived group
                //   carrier retains the structural dedup count.
                for node in &plan.nodes {
                    self.read(&node.parent_table, "point", None);
                    self.read(&node.child_table, "query", Some(&node.child_index));
                }
                self.authorization_inputs.insert("parentVisibility");
            }
            HandlerPlan::SnapshotBatchV2(plan) => {
                // @ref LLP 0157#sbsb2-plaintext-and-budget — each class keeps
                // its owner dependency set; relational nodes add both source
                // indexes and never invent a parent point-read.
                let mut has_bounded_parent = false;
                for node in &plan.nodes {
                    match node {
                        SnapshotBatchNodeV2::BoundedChildren(node) => {
                            has_bounded_parent = true;
                            self.read(&node.parent_table, "point", None);
                            self.read(&node.child_table, "query", Some(&node.child_index));
                        }
                        SnapshotBatchNodeV2::RelationalQuery(node) => {
                            self.read(&node.root, "query", Some(&node.root_index));
                            self.read(&node.joined, "query", Some(&node.joined_index));
                            self.filters(&node.root_filters);
                            self.filters(&node.root_visibility);
                            self.filters(&node.joined_visibility);
                        }
                    }
                }
                if has_bounded_parent {
                    self.authorization_inputs.insert("parentVisibility");
                }
            }
            HandlerPlan::GraphQuery(carrier) => {
                for node in &carrier.normalized_plan.nodes {
                    match node {
                        GraphNodeV1::RootWindow {
                            table,
                            access_index,
                            filters,
                            ..
                        } => {
                            self.read(table, "query", Some(access_index));
                            self.filters(filters);
                        }
                        GraphNodeV1::EqualityToOne {
                            table,
                            access_index,
                            filters,
                            ..
                        }
                        | GraphNodeV1::BoundedToMany {
                            table,
                            access_index,
                            filters,
                            ..
                        }
                        | GraphNodeV1::PrincipalBound {
                            table,
                            access_index,
                            filters,
                            ..
                        } => {
                            self.read(table, "query", Some(access_index));
                            if let Some(filters) = filters {
                                self.filters(filters);
                            }
                        }
                        GraphNodeV1::ExistsSemiJoin { edge, filters, .. } => {
                            match edge {
                                GraphEdgeV1::Direct(edge) => {
                                    self.read(&edge.table, "query", Some(&edge.access_index));
                                }
                                GraphEdgeV1::Through(edge) => {
                                    self.read(&edge.table, "query", Some(&edge.parent_index));
                                    self.read(
                                        &edge.target_table,
                                        "point",
                                        Some(&edge.target_index),
                                    );
                                }
                            }
                            if let Some(filters) = filters {
                                self.filters(filters);
                            }
                        }
                        GraphNodeV1::SearchMembership {
                            invalidation_tables,
                            ..
                        } => {
                            for table in invalidation_tables {
                                self.read(table, "search-membership", None);
                            }
                        }
                        GraphNodeV1::ClosedProjection { .. } => {}
                    }
                }
            }
            HandlerPlan::Mutation(plan) => {
                for step in &plan.steps {
                    match step {
                        MutationStep::AssetCollection(plan) => {
                            self.read(&plan.owner_table, "point", None);
                            self.read(&plan.child_table, "query", Some("uniqueParentAsset"));
                            for table in &plan.sharing_derivation_tables {
                                self.read(table, "query", None);
                            }
                            let operation = match plan.operation {
                                AssetCollectionOperationV1::Append => "append",
                                AssetCollectionOperationV1::Replace => "replace",
                                AssetCollectionOperationV1::Remove => "remove",
                                AssetCollectionOperationV1::Reorder => "reorder",
                            };
                            self.write(&plan.child_table, operation);
                            self.authorization_inputs.insert("authUserId");
                            self.authorization_inputs.insert("resolvedAppAuthority");
                            self.host_operations.insert("assetCollectionCommit");
                            if plan.sharing_grant_capable {
                                self.host_operations.insert("assetGrantCommit");
                            }
                            self.host_operations.insert("clientMutationSettlement");
                        }
                        MutationStep::AllocateSequence { scope, .. } => {
                            self.expr(scope);
                            self.host_operations.insert("sequenceAllocate");
                        }
                        MutationStep::Insert { table, values, .. } => {
                            self.write(table, "insert");
                            values.values().for_each(|value| self.expr(value));
                        }
                        MutationStep::Patch { table, id, values } => {
                            self.write(table, "patch");
                            self.read(table, "point", None);
                            self.expr(id);
                            values.values().for_each(|value| self.expr(value));
                        }
                        MutationStep::Delete { table, id } => {
                            self.write(table, "delete");
                            self.read(table, "point", None);
                            self.expr(id);
                        }
                        MutationStep::Get { table, id, .. } => {
                            self.read(table, "point", None);
                            self.expr(id);
                        }
                        MutationStep::AssertCurrentRelation {
                            table,
                            id,
                            scope_table,
                            scope_id,
                            ..
                        } => {
                            self.read(table, "point", None);
                            self.read(scope_table, "relationIncarnation", None);
                            self.expr(id);
                            self.expr(scope_id);
                        }
                        MutationStep::Guard { cond, .. } => self.expr(cond),
                        MutationStep::Let { expr, .. } => self.expr(expr),
                        MutationStep::AssertSourceChanged { table, id, .. } => {
                            self.read(table, "sourceEffect", None);
                            self.expr(id);
                        }
                        MutationStep::DeleteWhere { table, filter } => {
                            self.write(table, "deleteWhere");
                            self.read(table, "query", None);
                            self.filters(filter);
                        }
                        MutationStep::InsertEach {
                            table,
                            source,
                            values,
                            ..
                        } => {
                            self.write(table, "insertEach");
                            self.expr(source);
                            values.values().for_each(|value| self.expr(value));
                        }
                    }
                }
            }
            HandlerPlan::WriteWithActivity(plan) => {
                self.read(&plan.scope_table, "point", None);
                self.handler_plan(&HandlerPlan::Mutation(plan.mutation.clone()));
                self.authorization_inputs.insert("resolvedAppAuthority");
                self.host_operations.insert("clientMutationSettlement");
            }
            HandlerPlan::Action(plan) => {
                for step in &plan.steps {
                    let ActionStep::RunMutation { args, .. } = step;
                    args.values().for_each(|value| self.expr(value));
                    self.host_operations.insert("runMutation");
                }
            }
        }
    }
}

/// LLP 0065 §1: the runtime checks observed operations are a subset of the
/// admitted `EffectCeilingV1` and fails closed on mismatch. For a closed
/// HostPlan the plan *is* the totality of what executes, so the load-time
/// subset check over the typed IR is exactly the observed-operations check —
/// a doctored artifact that under-declares its ceiling refuses activation
/// instead of running past its admission.
fn validate_effect_ceiling(function: &FunctionDefinition) -> SnapbackResult<()> {
    let Some(ceiling) = &function.effect_ceiling else {
        return Ok(());
    };
    let FunctionRuntime::HostPlan(plan) = &function.runtime else {
        // Opaque handlers restate author declarations (`basis: "declared"`);
        // their runtime enforcement is the declared-reads path.
        return Ok(());
    };
    let mut observed = ObservedEffects::default();
    observed.handler_plan(plan);

    let exceeded = |axis: &str, detail: String| {
        SnapbackError::error(
            "SNAPBACK_FUNCTION_EFFECT_CEILING_EXCEEDED",
            "runtime",
            format!(
                "function {} performs a {axis} outside its admitted effect ceiling: {detail}",
                function.name
            ),
        )
        .with_details(serde_json::json!({
            "function": function.name,
            "axis": axis,
            "detail": detail,
        }))
    };
    for (table, access, index) in &observed.reads {
        let admitted = ceiling
            .reads
            .iter()
            .any(|read| read.table == *table && read.access == *access && read.index == *index);
        if !admitted {
            return Err(exceeded(
                "read",
                format!("{table} ({access}, index {index:?})"),
            ));
        }
    }
    for (table, operation) in &observed.writes {
        let admitted = ceiling
            .writes
            .iter()
            .any(|write| write.table == *table && write.operations.contains(operation));
        if !admitted {
            return Err(exceeded("write", format!("{table} ({operation})")));
        }
    }
    for host_operation in &observed.host_operations {
        if !ceiling
            .host_operations
            .iter()
            .any(|admitted| admitted == host_operation)
        {
            return Err(exceeded("host operation", (*host_operation).to_owned()));
        }
    }
    for input in &observed.authorization_inputs {
        if !ceiling
            .authorization_inputs
            .iter()
            .any(|admitted| admitted == input)
        {
            return Err(exceeded("authorization input", (*input).to_owned()));
        }
    }
    Ok(())
}

fn undeclarable_retention(function: &FunctionDefinition, reason: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_UNDECLARABLE_RETENTION",
        "auth",
        format!(
            "function {} cannot retain results because its authorization dependence is not declarable: {reason}",
            function.name
        ),
    )
    .with_details(serde_json::json!({
        "function": function.name,
        "reason": reason,
    }))
}

fn collect(value: &ValueExpr, dimensions: &mut BTreeSet<AuthorizationInputDimension>) {
    match value {
        ValueExpr::AuthUserId => {
            dimensions.insert(AuthorizationInputDimension::UserId);
        }
        ValueExpr::AuthKind => {
            dimensions.insert(AuthorizationInputDimension::Kind);
        }
        ValueExpr::AuthActorKind => {
            dimensions.insert(AuthorizationInputDimension::ActorKind);
        }
        ValueExpr::AuthActivityActorKind | ValueExpr::AuthActorUserId => {
            dimensions.insert(AuthorizationInputDimension::ActorKind);
        }
        ValueExpr::AuthGrantId => {
            dimensions.insert(AuthorizationInputDimension::Opaque);
        }
        ValueExpr::ClientMutationDigest => {}
        ValueExpr::AuthIsDelegated => {
            dimensions.insert(AuthorizationInputDimension::IsDelegated);
        }
        ValueExpr::Arg(_)
        | ValueExpr::Args
        | ValueExpr::Binding(_)
        | ValueExpr::Literal(_)
        | ValueExpr::RuntimeId
        | ValueExpr::RuntimeNow => {}
        ValueExpr::Field { base, .. } => collect(base, dimensions),
        ValueExpr::Binary { left, right, .. } => {
            collect(left, dimensions);
            collect(right, dimensions);
        }
        ValueExpr::Unary { expr, .. } => collect(expr, dimensions),
        ValueExpr::If { cond, then, r#else } => {
            collect(cond, dimensions);
            collect(then, dimensions);
            collect(r#else, dimensions);
        }
        ValueExpr::Concat(values) | ValueExpr::Call { args: values, .. } => {
            for value in values {
                collect(value, dimensions);
            }
        }
        ValueExpr::Record { fields } => {
            for value in fields.values() {
                collect(value, dimensions);
            }
        }
        // A membership semi-join authorizes on the effective principal.
        ValueExpr::MembershipExists(_) => {
            dimensions.insert(AuthorizationInputDimension::UserId);
        }
    }
}

pub fn host_plan_authorization_dimensions(
    function: &FunctionDefinition,
    plan: &QueryPlan,
) -> BTreeSet<AuthorizationInputDimension> {
    let mut dimensions = BTreeSet::new();
    for filter in &plan.filters {
        collect(&filter.value, &mut dimensions);
    }
    // Every membership predicate authorizes on the effective principal.
    if !plan.membership_filters.is_empty() {
        dimensions.insert(AuthorizationInputDimension::UserId);
    }
    if plan.table_visibility.is_some() {
        dimensions.insert(AuthorizationInputDimension::UserId);
    }
    if function.read_set_summary.auth_scope_field.is_some() {
        dimensions.insert(AuthorizationInputDimension::UserId);
    }
    dimensions
}

/// The authorization dimensions a relational plan observes: its root
/// filters and both visibility predicate lists (LLP 0080 §3 — visibility
/// is the executable authorization evidence).
fn relational_authorization_dimensions(
    plan: &RelationalQueryPlan,
) -> BTreeSet<AuthorizationInputDimension> {
    let mut dimensions = BTreeSet::new();
    for filter in plan
        .root_filters
        .iter()
        .chain(&plan.root_visibility)
        .chain(&plan.joined_visibility)
    {
        collect(&filter.value, &mut dimensions);
    }
    if plan.root_table_visibility.is_some() || plan.joined_table_visibility.is_some() {
        dimensions.insert(AuthorizationInputDimension::UserId);
    }
    dimensions
}

fn validate_retainable_query(function: &FunctionDefinition) -> SnapbackResult<()> {
    if let Some(retention_class) = function.retention_class.as_deref() {
        if !function.retainable {
            return Err(undeclarable_retention(
                function,
                "retentionClassWithoutRetainable",
            ));
        }
        if retention_class != "result-transform-snapshot-v1" {
            return Err(undeclarable_retention(function, "unknownRetentionClass"));
        }
        if !matches!(
            &function.runtime,
            FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(_))
        ) {
            return Err(undeclarable_retention(
                function,
                "resultTransformRequiresRelationalPlan",
            ));
        }
    }
    if !function.retainable {
        return Ok(());
    }
    if !matches!(function.kind, FunctionKind::Query | FunctionKind::LiveQuery) {
        return Err(undeclarable_retention(function, "retainableNonQuery"));
    }

    // @ref LLP 0080#4-live-and-retained-capability — retention is a closed
    //   default-deny plan capability for relational queries: legacy
    //   `retainable` declares `opaque-authorized-snapshot-v1`; only the
    //   retention owner may explicitly reclassify it as the post-gate
    //   `result-transform-snapshot-v1` class,
    //   which treats the projected result as an opaque authorized snapshot
    //   under LLP 0053's lease and reconnect rules and therefore requires a
    //   server-resolved authenticated principal. Anonymous results have no
    //   admissible v1 retention, so an all-`public-read` plan refuses. The
    //   retained/native evaluator only decodes the opaque snapshot against
    //   the retained store — it never re-executes the join over retained
    //   rows — which holds by construction: the lease envelope carries
    //   result bytes, never a plan to re-run.
    if let FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)) = &function.runtime {
        let owner_visible = plan
            .root_visibility
            .iter()
            .chain(&plan.joined_visibility)
            .any(|filter| matches!(filter.value, ValueExpr::AuthUserId));
        if !owner_visible {
            return Err(undeclarable_retention(
                function,
                "relationalAnonymousRetention",
            ));
        }
        let summary = &function.read_set_summary;
        let summary_complete = summary.mode.as_deref() == Some("relational")
            && summary.primary_table.as_deref() == Some(plan.root.as_str())
            && summary.tables == vec![plan.root.clone(), plan.joined.clone()]
            && summary
                .auth_scope_field
                .as_ref()
                .is_none_or(|field| !field.trim().is_empty());
        if !summary_complete {
            return Err(undeclarable_retention(function, "incompleteReadSummary"));
        }
        let declared = function
            .authorization_dependence
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        if declared.len() != function.authorization_dependence.len() {
            return Err(undeclarable_retention(
                function,
                "duplicateAuthorizationDimension",
            ));
        }
        let mut observed = relational_authorization_dimensions(plan);
        if summary.auth_scope_field.is_some() {
            observed.insert(AuthorizationInputDimension::UserId);
        }
        if declared != observed {
            return Err(undeclarable_retention(
                function,
                "authorizationDeclarationMismatch",
            ));
        }
        if function.authority_independent {
            return Err(undeclarable_retention(
                function,
                "authorityIndependentWithAuthorizationDependence",
            ));
        }
        if declared == BTreeSet::from([AuthorizationInputDimension::UserId])
            || declared
                == BTreeSet::from([
                    AuthorizationInputDimension::UserId,
                    AuthorizationInputDimension::Kind,
                ])
        {
            return Ok(());
        }
        return Err(undeclarable_retention(function, "notUserIdOnly"));
    }

    // The shipped DK-4 reset does not reset module lexical/imported singleton
    // state, and JavaScript declarations cannot prove they read only userId.
    // Retaining an Ibex result would therefore turn a trusted string into a
    // security boundary. Keep it online until the reset-equivalence/profile
    // proof exists.
    // @ref LLP 0053#the-authorization-event-universe-closed — opaque ctx.auth
    //   or module state makes retention a load error.
    let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &function.runtime else {
        return Err(undeclarable_retention(function, "opaqueJavaScript"));
    };

    let summary = &function.read_set_summary;
    let summary_complete = summary.mode.as_deref() == Some("singleTable")
        && summary.primary_table.as_deref() == Some(plan.table.as_str())
        && summary.tables.len() == 1
        && summary.tables.first() == Some(&plan.table)
        && summary
            .auth_scope_field
            .as_ref()
            .is_none_or(|field| !field.trim().is_empty());
    if !summary_complete {
        return Err(undeclarable_retention(function, "incompleteReadSummary"));
    }

    let declared = function
        .authorization_dependence
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    if declared.len() != function.authorization_dependence.len() {
        return Err(undeclarable_retention(
            function,
            "duplicateAuthorizationDimension",
        ));
    }
    let observed = host_plan_authorization_dimensions(function, plan);
    if declared != observed {
        return Err(undeclarable_retention(
            function,
            "authorizationDeclarationMismatch",
        ));
    }

    if function.authority_independent {
        if declared.is_empty() {
            return Ok(());
        }
        return Err(undeclarable_retention(
            function,
            "authorityIndependentWithAuthorizationDependence",
        ));
    }

    if declared == BTreeSet::from([AuthorizationInputDimension::UserId])
        || declared
            == BTreeSet::from([
                AuthorizationInputDimension::UserId,
                AuthorizationInputDimension::Kind,
            ])
    {
        return Ok(());
    }
    Err(undeclarable_retention(function, "notUserIdOnly"))
}

/// Structural admission of the closed relational plan (LLP 0080 §1); schema
/// binding (tables, fields, indexes, the cardinality proof) is validated at
/// artifact load, and the load-bearing bounds are re-checked at execution.
pub fn validate_relational_query_plan_shape(plan: &RelationalQueryPlan) -> SnapbackResult<()> {
    let invalid = |message: String| {
        SnapbackError::error("SNAPBACK_RELATIONAL_PLAN_INVALID", "runtime", message)
    };
    if plan.root.is_empty() || plan.joined.is_empty() || plan.root == plan.joined {
        return Err(invalid(
            "relational plan requires two distinct named source tables".to_owned(),
        ));
    }
    if plan.root_alias.is_empty()
        || plan.joined_alias.is_empty()
        || plan.root_alias == plan.joined_alias
    {
        return Err(invalid(
            "relational plan requires distinct non-empty source aliases".to_owned(),
        ));
    }
    if plan.join_on.is_empty() || plan.join_on.len() > 4 {
        return Err(invalid(format!(
            "relational plan requires 1..=4 join equality pairs, got {}",
            plan.join_on.len()
        )));
    }
    if plan.take > 1024 {
        return Err(invalid(format!(
            "relational take must be 0..=1024, got {}",
            plan.take
        )));
    }
    if plan.projection.is_empty() {
        return Err(invalid(
            "relational projection must be non-empty".to_owned(),
        ));
    }
    let mut names = std::collections::BTreeSet::new();
    for leaf in &plan.projection {
        if leaf.name.is_empty() || !names.insert(&leaf.name) {
            return Err(invalid(format!(
                "relational projection field {:?} must be non-empty and unique",
                leaf.name
            )));
        }
    }
    if plan.root_index.is_empty() || plan.joined_index.is_empty() {
        return Err(invalid(
            "relational plan requires named root and joined indexes".to_owned(),
        ));
    }
    Ok(())
}

/// Structural admission for the portable search carrier. Table/index binding
/// and field classifications are validated against the schema at activation.
pub fn validate_search_query_plan_shape(plan: &SearchQueryPlanV1) -> SnapbackResult<()> {
    if plan.table.trim().is_empty()
        || plan.index.trim().is_empty()
        || plan
            .resource_arg
            .as_ref()
            .is_some_and(|resource_arg| resource_arg.trim().is_empty())
        || plan.parser != crate::search::types::SEARCH_PARSER
        || plan.result_projection != "search-page-v1"
        || plan.required_capability != crate::search::types::SEARCH_CAPABILITY
    {
        return Err(SnapbackError::error(
            "SNAPBACK_SEARCH_QUERY_PLAN_INVALID",
            "search",
            "search plan must name one table/index and the exact v1 parser, result, and capability profiles",
        ));
    }
    Ok(())
}

/// Rust projection of codegen's schema-derived `SearchItemV1` records
/// contract. Pair activation compares this exact value, so a direct artifact
/// cannot retain the right plan while weakening or reshaping its rows.
pub fn expected_search_result_contract(
    table: &TableManifest,
    index: &SearchIndexManifestV1,
) -> SnapbackResult<FunctionResultContract> {
    let object_field = |name: &str, value: ResultValueContract| ResultObjectFieldContract {
        name: name.to_owned(),
        required: true,
        value,
    };
    let stored_value = |field: &FieldManifest| {
        let value = match &field.field_type {
            FieldType::String => ResultValueContract::String {
                max_bytes: RESULT_CONTRACT_MAX_VALUE_BYTES,
            },
            FieldType::Enum { values } => ResultValueContract::Union {
                variants: values
                    .iter()
                    .cloned()
                    .map(|value| ResultValueContract::Literal {
                        value: Value::String(value),
                    })
                    .collect(),
            },
            FieldType::Boolean => ResultValueContract::Boolean,
            FieldType::Integer => ResultValueContract::Integer {
                min: -RESULT_CONTRACT_JS_SAFE_INTEGER,
                max: RESULT_CONTRACT_JS_SAFE_INTEGER,
            },
            FieldType::Real => ResultValueContract::FiniteReal {
                min: -f64::MAX,
                max: f64::MAX,
            },
            FieldType::Vector { dimensions } => ResultValueContract::Vector {
                dimensions: *dimensions,
            },
            FieldType::Json => ResultValueContract::Json {
                max_depth: RESULT_CONTRACT_MAX_DEPTH,
                max_bytes: RESULT_CONTRACT_MAX_VALUE_BYTES,
            },
            FieldType::Structured { .. } => {
                unreachable!("structured search storedFields refused before contract derivation")
            }
            FieldType::Principal => ResultValueContract::Principal,
            FieldType::Id { table } => ResultValueContract::Id {
                table: table.clone(),
            },
            FieldType::RelationIncarnation { .. } => ResultValueContract::String { max_bytes: 64 },
            FieldType::AssetRef {
                media: Some(media), ..
            } => media_result_contract(&table.name, field, media),
            FieldType::AssetRef { .. } => ResultValueContract::AssetRef,
        };
        if field.optional && !matches!(&field.field_type, FieldType::Json) {
            match value {
                ResultValueContract::Union { mut variants } => {
                    variants.insert(0, ResultValueContract::Null);
                    ResultValueContract::Union { variants }
                }
                value => ResultValueContract::Union {
                    variants: vec![ResultValueContract::Null, value],
                },
            }
        } else {
            value
        }
    };
    let mut stored_fields = Vec::with_capacity(index.stored_fields.len());
    for name in &index.stored_fields {
        let field = table.field(name).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
                "search",
                format!(
                    "search result contract references unknown stored field {}.{name}",
                    table.name
                ),
            )
        })?;
        stored_fields.push(object_field(name, stored_value(field)));
    }
    let match_range = ResultValueContract::Object {
        allow_extra: false,
        fields: vec![
            object_field(
                "start",
                ResultValueContract::Integer {
                    min: 0,
                    max: RESULT_CONTRACT_JS_SAFE_INTEGER,
                },
            ),
            object_field(
                "end",
                ResultValueContract::Integer {
                    min: 0,
                    max: RESULT_CONTRACT_JS_SAFE_INTEGER,
                },
            ),
        ],
    };
    let highlight = ResultValueContract::Object {
        allow_extra: false,
        fields: vec![
            object_field(
                "field",
                ResultValueContract::String {
                    max_bytes: RESULT_CONTRACT_MAX_VALUE_BYTES,
                },
            ),
            object_field("text", ResultValueContract::String { max_bytes: 256 }),
            object_field(
                "matches",
                ResultValueContract::Array {
                    element: Box::new(match_range),
                    max_items: 8,
                },
            ),
        ],
    };
    Ok(FunctionResultContract::Records {
        rows: None,
        record: ResultValueContract::Object {
            allow_extra: false,
            fields: vec![
                object_field(
                    "rowId",
                    ResultValueContract::Id {
                        table: table.name.clone(),
                    },
                ),
                object_field(
                    "score",
                    ResultValueContract::Integer {
                        min: 0,
                        max: 22_937_600,
                    },
                ),
                object_field(
                    "fields",
                    ResultValueContract::Object {
                        fields: stored_fields,
                        allow_extra: false,
                    },
                ),
                object_field(
                    "highlights",
                    ResultValueContract::Array {
                        element: Box::new(highlight),
                        max_items: 3,
                    },
                ),
            ],
        },
    })
}

#[cfg(test)]
mod stored_enum_result_contract_tests {
    use super::*;

    fn enum_table() -> TableManifest {
        TableManifest {
            name: "todos".to_owned(),
            fields: vec![FieldManifest {
                name: "role".to_owned(),
                field_type: FieldType::Enum {
                    values: vec!["crew".to_owned(), "user".to_owned()],
                },
                optional: false,
            }],
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
            visibility: None,
            history: None,
        }
    }

    #[test]
    fn stored_enum_expands_to_literal_union_in_effective_search_result_contract() {
        let table = enum_table();
        let index = SearchIndexManifestV1 {
            format_version: 1,
            name: "search_todos".to_owned(),
            semantic_version: "todos.v1".to_owned(),
            analyzer: "unused-by-contract-expansion".to_owned(),
            analyzer_tables_digest: "unused-by-contract-expansion".to_owned(),
            text_fields: BTreeMap::new(),
            field_classifications: BTreeMap::new(),
            equality_filters: Vec::new(),
            stored_fields: vec!["role".to_owned()],
            highlight_fields: Vec::new(),
            visibility: SearchVisibilityV1::PublicRead,
            tie_break: "score-desc-row-id-asc.v1".to_owned(),
            source_limits: SearchSourceLimitsV1::default(),
            query_limits: SearchQueryLimitsV1::default(),
            cursor_limits: SearchCursorLimitsV1::default(),
            maintenance_limits: SearchMaintenanceLimitsV1::default(),
            live_limits: None,
        };

        let FunctionResultContract::Records { record, .. } =
            expected_search_result_contract(&table, &index).expect("expand search contract")
        else {
            panic!("search contract must be records");
        };
        let ResultValueContract::Object { fields, .. } = record else {
            panic!("search record must be an object");
        };
        let stored = fields
            .iter()
            .find(|field| field.name == "fields")
            .expect("stored-fields object");
        let ResultValueContract::Object { fields, .. } = &stored.value else {
            panic!("stored fields must be an object");
        };
        assert_eq!(
            fields,
            &[ResultObjectFieldContract {
                name: "role".to_owned(),
                required: true,
                value: ResultValueContract::Union {
                    variants: vec![
                        ResultValueContract::Literal {
                            value: Value::String("crew".to_owned()),
                        },
                        ResultValueContract::Literal {
                            value: Value::String("user".to_owned()),
                        },
                    ],
                },
            }]
        );
    }

    #[test]
    fn stored_enum_expands_to_literal_union_in_document_result_contract() {
        let table = enum_table();
        let safe_integer = ResultValueContract::Integer {
            min: 0,
            max: 9_007_199_254_740_991,
        };
        let contract = FunctionResultContract::Documents {
            table: "todos".to_owned(),
            document: ResultValueContract::Object {
                fields: vec![
                    ResultObjectFieldContract {
                        name: "_id".to_owned(),
                        required: true,
                        value: ResultValueContract::Id {
                            table: "todos".to_owned(),
                        },
                    },
                    ResultObjectFieldContract {
                        name: "_version".to_owned(),
                        required: true,
                        value: safe_integer.clone(),
                    },
                    ResultObjectFieldContract {
                        name: "_createdAt".to_owned(),
                        required: true,
                        value: safe_integer.clone(),
                    },
                    ResultObjectFieldContract {
                        name: "_updatedAt".to_owned(),
                        required: true,
                        value: safe_integer,
                    },
                    ResultObjectFieldContract {
                        name: "role".to_owned(),
                        required: true,
                        value: ResultValueContract::Union {
                            variants: vec![
                                ResultValueContract::Literal {
                                    value: Value::String("crew".to_owned()),
                                },
                                ResultValueContract::Literal {
                                    value: Value::String("user".to_owned()),
                                },
                            ],
                        },
                    },
                ],
                allow_extra: false,
            },
        };
        let plan = QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: Vec::new(),
            membership_filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            indexed_by: None,
        };
        let schema = SchemaManifest {
            tables: vec![table],
            ..SchemaManifest::default()
        };

        assert!(single_table_delta_contract_matches_schema(
            &contract, &plan, &schema
        ));
    }
}

/// Rust projection of the exact row contract carried inside the ordinary
/// QueryOutput envelope. The public adapter projects these rows to
/// `VectorPageV1 { items }`; vector source values are never stored fields.
///
/// @ref LLP 0132#query-surface
pub fn expected_vector_result_contract(
    table: &TableManifest,
    index: &VectorIndexManifestV1,
) -> SnapbackResult<FunctionResultContract> {
    validate_vector_index_manifest(table, index)?;
    let object_field = |name: &str, value: ResultValueContract| ResultObjectFieldContract {
        name: name.to_owned(),
        required: true,
        value,
    };
    let stored_value = |field: &FieldManifest| -> SnapbackResult<ResultValueContract> {
        let value = match &field.field_type {
            FieldType::String => ResultValueContract::String {
                max_bytes: RESULT_CONTRACT_MAX_VALUE_BYTES,
            },
            FieldType::Enum { values } => ResultValueContract::Union {
                variants: values
                    .iter()
                    .cloned()
                    .map(|value| ResultValueContract::Literal {
                        value: Value::String(value),
                    })
                    .collect(),
            },
            FieldType::Boolean => ResultValueContract::Boolean,
            FieldType::Integer => ResultValueContract::Integer {
                min: -RESULT_CONTRACT_JS_SAFE_INTEGER,
                max: RESULT_CONTRACT_JS_SAFE_INTEGER,
            },
            FieldType::Real => ResultValueContract::FiniteReal {
                min: -f64::MAX,
                max: f64::MAX,
            },
            FieldType::Json => ResultValueContract::Json {
                max_depth: RESULT_CONTRACT_MAX_DEPTH,
                max_bytes: RESULT_CONTRACT_MAX_VALUE_BYTES,
            },
            FieldType::Principal => ResultValueContract::Principal,
            FieldType::Id { table } => ResultValueContract::Id {
                table: table.clone(),
            },
            FieldType::RelationIncarnation { .. } => ResultValueContract::String { max_bytes: 64 },
            FieldType::AssetRef {
                media: Some(media), ..
            } => media_result_contract(&table.name, field, media),
            FieldType::AssetRef { .. } => ResultValueContract::AssetRef,
            FieldType::Vector { .. } => {
                return Err(vector_manifest_invalid(format!(
                    "vector index {} storedFields must not expose source vectors",
                    index.name
                )));
            }
            FieldType::Structured { .. } => {
                return Err(vector_manifest_invalid(format!(
                    "vector index {} storedFields must not expose structured values",
                    index.name
                )));
            }
        };
        Ok(
            if field.optional && !matches!(&field.field_type, FieldType::Json) {
                match value {
                    ResultValueContract::Union { mut variants } => {
                        variants.insert(0, ResultValueContract::Null);
                        ResultValueContract::Union { variants }
                    }
                    value => ResultValueContract::Union {
                        variants: vec![ResultValueContract::Null, value],
                    },
                }
            } else {
                value
            },
        )
    };

    let mut stored = Vec::with_capacity(index.stored_fields.len());
    for name in &index.stored_fields {
        let field = table
            .fields
            .iter()
            .find(|field| field.name == *name)
            .ok_or_else(|| {
                vector_manifest_invalid(format!(
                    "vector index {} names missing stored field {name}",
                    index.name
                ))
            })?;
        stored.push(object_field(name, stored_value(field)?));
    }
    Ok(FunctionResultContract::Records {
        record: ResultValueContract::Object {
            allow_extra: false,
            fields: vec![
                object_field(
                    "rowId",
                    ResultValueContract::Id {
                        table: table.name.clone(),
                    },
                ),
                object_field(
                    "distance",
                    ResultValueContract::FiniteReal {
                        min: -f64::MAX,
                        max: f64::MAX,
                    },
                ),
                object_field(
                    "fields",
                    ResultValueContract::Object {
                        fields: stored,
                        allow_extra: false,
                    },
                ),
            ],
        },
        rows: Some(ResultRowsBound {
            min_items: 0,
            max_items: crate::vector::types::VECTOR_MAX_K as usize,
        }),
    })
}

/// Exact operation-specific arguments derived from the selected index.
/// `vector` uses the dedicated closed node so D may reach 4,096 without
/// widening general arrays.
pub fn expected_vector_args_contract(index: &VectorIndexManifestV1) -> FunctionArgsContract {
    let field =
        |name: &str, required: bool, value: ResultValueContract| ResultObjectFieldContract {
            name: name.to_owned(),
            required,
            value,
        };
    let mut fields = vec![
        field(
            "vector",
            true,
            ResultValueContract::Vector {
                dimensions: index.dimensions,
            },
        ),
        field(
            "k",
            false,
            ResultValueContract::Integer {
                min: 1,
                max: crate::vector::types::VECTOR_MAX_K.into(),
            },
        ),
    ];
    if !index.equality_filters.is_empty() {
        let mut filter_names = index
            .equality_filters
            .iter()
            .map(|name| ResultValueContract::Literal {
                value: Value::String(name.clone()),
            })
            .collect::<Vec<_>>();
        let filter_name = if filter_names.len() == 1 {
            filter_names.remove(0)
        } else {
            ResultValueContract::Union {
                variants: filter_names,
            }
        };
        fields.push(field(
            "filters",
            false,
            ResultValueContract::Array {
                max_items: crate::vector::types::VECTOR_MAX_FILTERS,
                element: Box::new(ResultValueContract::Object {
                    allow_extra: false,
                    fields: vec![
                        field("field", true, filter_name),
                        field(
                            "op",
                            true,
                            ResultValueContract::Literal {
                                value: Value::String("eq".to_owned()),
                            },
                        ),
                        field(
                            "value",
                            true,
                            ResultValueContract::Union {
                                variants: vec![
                                    ResultValueContract::String {
                                        max_bytes: RESULT_CONTRACT_MAX_VALUE_BYTES,
                                    },
                                    ResultValueContract::FiniteReal {
                                        min: -f64::MAX,
                                        max: f64::MAX,
                                    },
                                    ResultValueContract::Boolean,
                                ],
                            },
                        ),
                    ],
                }),
            },
        ));
    }
    FunctionArgsContract { fields }
}

pub fn validate_bounded_children_plan_shape(plan: &BoundedChildrenQueryPlan) -> SnapbackResult<()> {
    let valid_projection = |fields: &[BoundedProjectionField]| {
        let names: BTreeSet<&str> = fields.iter().map(|field| field.name.as_str()).collect();
        !fields.is_empty()
            && names.len() == fields.len()
            && fields
                .iter()
                .all(|field| !field.name.trim().is_empty() && !field.field.trim().is_empty())
    };
    let order_fields: BTreeSet<&str> = plan
        .order
        .iter()
        .map(|order| order.field.as_str())
        .collect();
    if plan.profile != "bounded-children.v1"
        || plan.required_capability != "bounded_children_v1"
        || plan.parent_table.trim().is_empty()
        || plan.parent_id_arg.trim().is_empty()
        || plan.child_table.trim().is_empty()
        || plan.child_foreign_key.trim().is_empty()
        || plan.child_relation_incarnation.trim().is_empty()
        || plan.child_index.trim().is_empty()
        || plan.order.is_empty()
        || plan
            .order
            .iter()
            .any(|order| order.direction != OrderDirection::Asc)
        || order_fields.len() != plan.order.len()
        || plan.take > 1024
        || plan.parent_deletion != "hide-orphans.v1"
        || !valid_projection(&plan.parent_projection)
        || !valid_projection(&plan.child_projection)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_BOUNDED_CHILDREN_PLAN_INVALID",
            "query",
            "bounded children plan is outside the closed v1 profile",
        ));
    }
    Ok(())
}

/// Structural admission for the released `snapshot-batch.v1` normalized
/// carrier. Identity, result-contract, schema, and capability checks add the
/// remaining release gates after this closed shape proof.
///
/// @ref LLP 0135#21-composite-plan-shape — v1 is exactly two through eight
///   complete bounded-children plans with a summed `take` ceiling of 1,024.
pub fn validate_snapshot_batch_plan_shape(plan: &SnapshotBatchPlanV1) -> SnapbackResult<()> {
    let invalid = |message: String| {
        SnapbackError::error("SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID", "query", message)
    };
    if plan.profile != "snapshot-batch.v1" || !(2..=8).contains(&plan.nodes.len()) {
        return Err(invalid(
            "snapshot batch requires profile snapshot-batch.v1 and two through eight nodes"
                .to_owned(),
        ));
    }
    let mut total_take = 0_u32;
    for node in &plan.nodes {
        validate_bounded_children_plan_shape(node).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_SNAPSHOT_BATCH_NODE_INELIGIBLE",
                "query",
                "snapshot batch nodes must be complete bounded-children.v1 plans",
            )
        })?;
        total_take = total_take.checked_add(node.take).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_SNAPSHOT_BATCH_CEILING_EXCEEDED",
                "query",
                "snapshot batch node take sum overflowed the closed ceiling",
            )
        })?;
    }
    if total_take > 1_024 {
        return Err(SnapbackError::error(
            "SNAPBACK_SNAPSHOT_BATCH_CEILING_EXCEEDED",
            "query",
            "snapshot batch node take sum exceeds 1,024",
        ));
    }
    Ok(())
}

/// Structural admission for `snapshot-batch.v2`'s closed mixed-node tuple.
///
/// @ref LLP 0157#d1--the-node-algebra — v2 admits exactly two through eight
///   owner-valid bounded-child or relational nodes, requires at least one
///   relational node, and caps the summed `take` at 1,024.
pub fn validate_snapshot_batch_v2_plan_shape(plan: &SnapshotBatchPlanV2) -> SnapbackResult<()> {
    let invalid = |message: String| {
        SnapbackError::error("SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID", "query", message)
    };
    if plan.profile != "snapshot-batch.v2" || !(2..=8).contains(&plan.nodes.len()) {
        return Err(invalid(
            "snapshot batch v2 requires profile snapshot-batch.v2 and two through eight nodes"
                .to_owned(),
        ));
    }
    let mut total_take = 0_u32;
    let mut relational = false;
    for node in &plan.nodes {
        let admitted = match node {
            SnapshotBatchNodeV2::BoundedChildren(plan) => {
                validate_bounded_children_plan_shape(plan)
            }
            SnapshotBatchNodeV2::RelationalQuery(plan) => {
                relational = true;
                validate_relational_query_plan_shape(plan)
            }
        };
        admitted.map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_SNAPSHOT_BATCH_NODE_INELIGIBLE",
                "query",
                "snapshot batch v2 nodes must be complete bounded_children_v1 or relational_query_v1 plans",
            )
        })?;
        total_take = total_take.checked_add(node.take()).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_SNAPSHOT_BATCH_CEILING_EXCEEDED",
                "query",
                "snapshot batch v2 node take sum overflowed the closed ceiling",
            )
        })?;
    }
    if !relational {
        return Err(invalid(
            "snapshot batch v2 requires at least one relational_query_v1 node".to_owned(),
        ));
    }
    if total_take > 1_024 {
        return Err(SnapbackError::error(
            "SNAPBACK_SNAPSHOT_BATCH_CEILING_EXCEEDED",
            "query",
            "snapshot batch v2 node take sum exceeds 1,024",
        ));
    }
    Ok(())
}

/// One internally derived structural parent-authorization identity. The dated
/// LLP 0135 implementation record maps it to the exact closed
/// `ParentAuthorizationKeyV1` JCS carrier used in plan and cursor identity.
///
/// @ref LLP 0135#22-one-snapshot-execution-and-parent-authorization-dedup —
///   equality includes parent table, typed argument binding, and the complete
///   versioned visibility declaration, never runtime argument values.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct SnapshotBatchParentAuthorizationIdentityV1 {
    pub parent_table: String,
    pub parent_id_argument: String,
    pub parent_id_table: String,
    pub visibility: BoundedParentVisibility,
}

/// One equivalence class in declaration order, with node positions retained
/// for deterministic planning and the normalized composite record.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SnapshotBatchParentAuthorizationGroupV1 {
    pub identity: SnapshotBatchParentAuthorizationIdentityV1,
    pub node_indices: Vec<usize>,
}

/// Host-recomputed LLP 0157 identity inputs used by `sbsb1` admission.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SnapshotBatchIdentityV1 {
    pub normalized_composite_plan: Value,
    pub plan_hash: String,
    pub node_plan_hashes: Vec<String>,
    pub parent_authorization_key_jcs: Vec<String>,
    pub parent_authorization_key_digests: Vec<String>,
}

/// Host-recomputed LLP 0157 identity inputs used by `sbsb2` admission.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SnapshotBatchIdentityV2 {
    pub normalized_composite_plan: Value,
    pub plan_hash: String,
    pub node_plan_hashes: Vec<String>,
    pub node_examined_entry_ceilings: Vec<usize>,
    pub node_joined_lookup_ceilings: Vec<usize>,
    pub parent_authorization_group_count: usize,
    pub parent_authorization_key_jcs: Vec<String>,
    pub parent_authorization_key_digests: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SingleNodeIdentityV1 {
    pub normalized_composite_plan: Value,
    pub plan_hash: String,
    pub node_plan_hash: String,
}

/// Exact schema-derived document contract gate for DK-3 delivery. A direct
/// manifest can spell `Documents` with arbitrary nested bounds, so the enum
/// tag and table name alone do not prove that raw committed rows satisfy the
/// declared egress shape.
pub fn single_table_delta_contract_matches_schema(
    contract: &FunctionResultContract,
    plan: &QueryPlan,
    schema: &SchemaManifest,
) -> bool {
    // @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut —
    // Raw changed rows have not crossed the snapshot-pinned media projection
    // boundary, so they cannot satisfy a media-bearing logical result contract.
    if result_contract_contains_media(contract) {
        return false;
    }
    let FunctionResultContract::Documents { table, document } = contract else {
        return false;
    };
    if table != &plan.table {
        return false;
    }
    let Some(table) = schema.table(table) else {
        return false;
    };
    document == &table_document_value_contract(table)
}

pub(super) fn domain_hash(domain: &[u8], value: &Value) -> SnapbackResult<String> {
    let canonical = crate::rqs_contract::jcs(value).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
            "query",
            "snapshot batch identity is not RFC 8785 canonicalizable",
        )
    })?;
    let mut digest = Sha256::new();
    digest.update(domain);
    digest.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", digest.finalize()))
}

/// Rebuild LLP 0157's single-node plan identity for the admitted owner
/// classes. The function declaration, rather than plan shape, supplies the
/// liveness axis; retention remains the independent owner-issued flag.
// @ref LLP 0157#d2--plan-identity — a single-node hash includes every declared argument contract and explicit capability classification.
pub fn single_node_identity_v1(
    function: &FunctionDefinition,
    schema: Option<&SchemaManifest>,
) -> SnapbackResult<Option<SingleNodeIdentityV1>> {
    let (class_id, normalized_plan, retention, delivery, invalidation, required_capability_ids) =
        match &function.runtime {
            FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)) => (
                "relational_query_v1",
                serde_json::to_value(plan).map_err(|_| {
                    SnapbackError::error(
                        "SNAPBACK_COMPOSITION_PLAN_INVALID",
                        "query",
                        "relational plan does not serialize",
                    )
                })?,
                function.effective_retention_class(),
                "live_replace",
                "table-granular-resnapshot",
                vec!["relational_query_v1".to_owned()],
            ),
            FunctionRuntime::HostPlan(HandlerPlan::BoundedChildrenQuery(plan)) => (
                "bounded_children_v1",
                serde_json::to_value(plan).map_err(|_| {
                    SnapbackError::error(
                        "SNAPBACK_COMPOSITION_PLAN_INVALID",
                        "query",
                        "bounded-children plan does not serialize",
                    )
                })?,
                "none",
                "live_replace",
                "table-granular-resnapshot",
                vec!["bounded_children_v1".to_owned()],
            ),
            FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) => {
                let Some(normalized) = single_table_plan_v1(function)? else {
                    return Ok(None);
                };
                let delivery = if normalized.rqs_digest_kind == "mset1"
                    && schema.is_some_and(|schema| {
                        single_table_delta_contract_matches_schema(
                            &function.result_contract,
                            plan,
                            schema,
                        )
                    }) {
                    "live_delta"
                } else {
                    "live_replace"
                };
                let mut required = function.required_capabilities.clone();
                required.sort();
                required.dedup();
                (
                    "single_table_v1",
                    serde_json::to_value(normalized).map_err(|_| {
                        single_table_plan_invalid("single-table plan does not serialize")
                    })?,
                    "rqs-authority-independent-snapshot-v1",
                    delivery,
                    "proved-disjoint-write-set",
                    required,
                )
            }
            _ => return Ok(None),
        };
    let contract = function.args_contract.as_ref().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_COMPOSITION_PLAN_INVALID",
            "query",
            "single-node composition identity requires a typed argument contract",
        )
    })?;
    let mut bindings = Vec::with_capacity(contract.fields.len());
    let mut merged = Vec::with_capacity(contract.fields.len());
    for field in &contract.fields {
        let binding_contract = serde_json::json!({
            "format": "snapback.argument-binding-contract.v1",
            "required": field.required,
            "value": field.value,
        });
        let contract_hash =
            domain_hash(b"snapback:argument-binding-contract:v1:", &binding_contract)?;
        bindings.push(serde_json::json!({
            "name": field.name,
            "contract": binding_contract,
            "contractHash": contract_hash,
        }));
        merged.push(serde_json::json!({
            "name": field.name,
            "contract": binding_contract,
            "contractHash": contract_hash,
            "sourcePositions": [0],
        }));
    }
    let live = if function.kind == FunctionKind::LiveQuery {
        serde_json::json!({
            "kind": "admitted",
            "delivery": delivery,
            "pageDomain": "cursor-free-first-page",
        })
    } else {
        serde_json::json!({"kind": "none"})
    };
    let node_plan = serde_json::json!({
        "format": "snapback.node-plan.v1",
        "classId": class_id,
        "classVersion": 1,
        "normalizedPlan": normalized_plan,
        "argumentBindings": bindings,
        "capability": {
            "exportKind": if function.kind == FunctionKind::LiveQuery { "LiveQuery" } else { "Query" },
            "live": live,
            "retention": retention,
            "requiredCapabilityIds": required_capability_ids,
        },
    });
    let node_plan_hash = domain_hash(b"snapback:node-plan:v1:", &node_plan)?;
    let merged_record = serde_json::json!({
        "format": "snapback.merged-args-contract.v1",
        "bindings": merged,
    });
    let merged_hash = domain_hash(b"snapback:merged-args-contract:v1:", &merged_record)?;
    let classification_live = if function.kind == FunctionKind::LiveQuery {
        serde_json::json!({
            "kind": "admitted",
            "delivery": delivery,
            "pageDomain": "cursor-free-first-page",
        })
    } else {
        serde_json::json!({"kind": "none", "delivery": "none", "pageDomain": "none"})
    };
    let normalized = serde_json::json!({
        "format": "snapback.normalized-composite-plan.v1",
        "profileId": "single-node.v1",
        "nodes": [{
            "position": 0,
            "nodePlan": node_plan,
            "nodePlanHash": node_plan_hash,
        }],
        "mergedArgsContractHash": merged_hash,
        "classification": {
            "callable": true,
            "live": classification_live,
            "invalidation": if function.kind == FunctionKind::LiveQuery { invalidation } else { "none" },
            "retention": retention,
        },
        "parentAuthorizationGroups": [],
    });
    Ok(Some(SingleNodeIdentityV1 {
        normalized_composite_plan: normalized.clone(),
        plan_hash: domain_hash(b"snapback:plan-hash:v1:", &normalized)?,
        node_plan_hash,
    }))
}

/// Rebuild the exact LLP 0157 node/composite identity stack from an admitted
/// function. No author-supplied plan hash or liveness inference is trusted.
///
/// @ref LLP 0157#d2--plan-identity — node records, merged bindings,
///   classification, and structural parent groups are all PlanHashV1 input.
pub fn snapshot_batch_identity_v1(
    function: &FunctionDefinition,
    plan: &SnapshotBatchPlanV1,
) -> SnapbackResult<SnapshotBatchIdentityV1> {
    let contract = function.args_contract.as_ref().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
            "query",
            "snapshot batch identity requires a typed argument contract",
        )
    })?;
    let groups = snapshot_batch_parent_authorization_groups(function, plan)?;
    let mut node_records = Vec::with_capacity(plan.nodes.len());
    let mut node_hashes = Vec::with_capacity(plan.nodes.len());
    let mut merged = Vec::<Value>::new();
    let mut merged_positions = BTreeMap::<String, usize>::new();

    for (position, node) in plan.nodes.iter().enumerate() {
        let field = contract
            .fields
            .iter()
            .find(|field| field.name == node.parent_id_arg)
            .expect("snapshot batch argument admission ran before identity");
        let binding_contract = serde_json::json!({
            "format": "snapback.argument-binding-contract.v1",
            "required": field.required,
            "value": field.value,
        });
        let contract_hash =
            domain_hash(b"snapback:argument-binding-contract:v1:", &binding_contract)?;
        let binding = serde_json::json!({
            "name": field.name,
            "contract": binding_contract,
            "contractHash": contract_hash,
        });
        if let Some(index) = merged_positions.get(&field.name).copied() {
            let entry = merged[index]
                .as_object_mut()
                .expect("host-created merged binding object");
            let same = entry.get("contract") == binding.get("contract")
                && entry.get("contractHash") == binding.get("contractHash");
            if !same {
                return Err(SnapbackError::error(
                    "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
                    "query",
                    "one merged snapshot argument has incompatible node contracts",
                ));
            }
            entry
                .get_mut("sourcePositions")
                .and_then(Value::as_array_mut)
                .expect("host-created sourcePositions")
                .push(Value::from(position));
        } else {
            merged_positions.insert(field.name.clone(), merged.len());
            merged.push(serde_json::json!({
                "name": field.name,
                "contract": binding.get("contract").cloned().expect("binding contract"),
                "contractHash": binding.get("contractHash").cloned().expect("binding hash"),
                "sourcePositions": [position],
            }));
        }
        let node_record = serde_json::json!({
            "format": "snapback.node-plan.v1",
            "classId": "bounded_children_v1",
            "classVersion": 1,
            "normalizedPlan": serde_json::to_value(node).map_err(|_| SnapbackError::error(
                "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID", "query", "snapshot node does not serialize"
            ))?,
            "argumentBindings": [binding],
            "capability": {
                "exportKind": "internal",
                "live": {"kind": "none"},
                "retention": "none",
                "requiredCapabilityIds": ["bounded_children_v1"],
            },
        });
        let node_hash = domain_hash(b"snapback:node-plan:v1:", &node_record)?;
        node_records.push(serde_json::json!({
            "position": position,
            "nodePlan": node_record,
            "nodePlanHash": node_hash,
        }));
        node_hashes.push(node_hash);
    }

    let merged_record = serde_json::json!({
        "format": "snapback.merged-args-contract.v1",
        "bindings": merged,
    });
    let merged_hash = domain_hash(b"snapback:merged-args-contract:v1:", &merged_record)?;

    let mut key_jcs = Vec::with_capacity(groups.len());
    let mut key_digests = Vec::with_capacity(groups.len());
    let mut normalized_groups = Vec::with_capacity(groups.len());
    for group in groups {
        let key = serde_json::json!({
            "format": "snapback.parent-authorization-key.v1",
            "parentTable": group.identity.parent_table,
            "parentIdArgument": group.identity.parent_id_argument,
            "parentIdType": {"kind": "id", "table": group.identity.parent_id_table},
            "visibility": match group.identity.visibility {
                BoundedParentVisibility::PublicRead => serde_json::json!({
                    "kind": "public-read",
                }),
                BoundedParentVisibility::Owner { field } => serde_json::json!({
                    "kind": "owner.v1",
                    "field": field,
                }),
            },
        });
        let canonical = crate::rqs_contract::jcs(&key).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
                "query",
                "parent authorization key is not canonicalizable",
            )
        })?;
        let digest = domain_hash(b"snapback:parent-authorization-key:v1:", &key)?;
        normalized_groups.push(serde_json::json!({
            "members": group.node_indices,
            "keyJcsBase64url": URL_SAFE_NO_PAD.encode(canonical.as_bytes()),
        }));
        key_jcs.push(canonical);
        key_digests.push(digest);
    }
    let normalized = serde_json::json!({
        "format": "snapback.normalized-composite-plan.v1",
        "profileId": "snapshot-batch.v1",
        "nodes": node_records,
        "mergedArgsContractHash": merged_hash,
        "classification": {
            "callable": true,
            "live": {
                "kind": "admitted",
                "delivery": "live_replace",
                "pageDomain": "cursor-free-first-page",
            },
            "invalidation": "table-granular-resnapshot",
            "retention": "none",
        },
        "parentAuthorizationGroups": normalized_groups,
    });
    Ok(SnapshotBatchIdentityV1 {
        normalized_composite_plan: normalized.clone(),
        plan_hash: domain_hash(b"snapback:plan-hash:v1:", &normalized)?,
        node_plan_hashes: node_hashes,
        parent_authorization_key_jcs: key_jcs,
        parent_authorization_key_digests: key_digests,
    })
}

fn collect_snapshot_batch_v2_argument_uses(
    value: &ValueExpr,
    names: &mut BTreeSet<String>,
    uses_all: &mut bool,
) -> SnapbackResult<()> {
    match value {
        ValueExpr::Arg(path) => {
            let name = path
                .split('.')
                .next()
                .filter(|name| !name.is_empty())
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
                        "query",
                        "snapshot batch v2 relational argument path must name a top-level binding",
                    )
                })?;
            names.insert(name.to_owned());
        }
        ValueExpr::Args => *uses_all = true,
        ValueExpr::Field { base, .. } => {
            collect_snapshot_batch_v2_argument_uses(base, names, uses_all)?;
        }
        ValueExpr::Binary { left, right, .. } => {
            collect_snapshot_batch_v2_argument_uses(left, names, uses_all)?;
            collect_snapshot_batch_v2_argument_uses(right, names, uses_all)?;
        }
        ValueExpr::Unary { expr, .. } => {
            collect_snapshot_batch_v2_argument_uses(expr, names, uses_all)?;
        }
        ValueExpr::If { cond, then, r#else } => {
            collect_snapshot_batch_v2_argument_uses(cond, names, uses_all)?;
            collect_snapshot_batch_v2_argument_uses(then, names, uses_all)?;
            collect_snapshot_batch_v2_argument_uses(r#else, names, uses_all)?;
        }
        ValueExpr::Concat(values) | ValueExpr::Call { args: values, .. } => {
            for value in values {
                collect_snapshot_batch_v2_argument_uses(value, names, uses_all)?;
            }
        }
        ValueExpr::Record { fields } => {
            for value in fields.values() {
                collect_snapshot_batch_v2_argument_uses(value, names, uses_all)?;
            }
        }
        ValueExpr::AuthUserId
        | ValueExpr::AuthKind
        | ValueExpr::AuthActorKind
        | ValueExpr::AuthActivityActorKind
        | ValueExpr::AuthActorUserId
        | ValueExpr::AuthGrantId
        | ValueExpr::ClientMutationDigest
        | ValueExpr::AuthIsDelegated
        | ValueExpr::RuntimeId
        | ValueExpr::RuntimeNow
        | ValueExpr::Binding(_)
        | ValueExpr::Literal(_)
        | ValueExpr::MembershipExists(_) => {}
    }
    Ok(())
}

fn snapshot_batch_v2_node_argument_names(
    function: &FunctionDefinition,
    node: &SnapshotBatchNodeV2,
) -> SnapbackResult<Vec<String>> {
    let contract = function.args_contract.as_ref().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
            "query",
            "snapshot batch v2 requires a closed typed argument contract",
        )
    })?;
    let mut names = BTreeSet::new();
    let mut uses_all = false;
    match node {
        SnapshotBatchNodeV2::BoundedChildren(plan) => {
            names.insert(plan.parent_id_arg.clone());
        }
        SnapshotBatchNodeV2::RelationalQuery(plan) => {
            for filter in plan
                .root_filters
                .iter()
                .chain(&plan.root_visibility)
                .chain(&plan.joined_visibility)
            {
                collect_snapshot_batch_v2_argument_uses(&filter.value, &mut names, &mut uses_all)?;
            }
        }
    }
    if uses_all {
        names.extend(
            contract
                .fields
                .iter()
                .filter(|field| field.name != "cursor")
                .map(|field| field.name.clone()),
        );
    }
    for name in &names {
        if name == "cursor" || !contract.fields.iter().any(|field| field.name == *name) {
            return Err(SnapbackError::error(
                "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
                "query",
                format!("snapshot batch v2 node references undeclared argument {name}"),
            ));
        }
    }
    // Owner declaration order is the function contract order, never set order
    // or traversal order through an expression tree.
    Ok(contract
        .fields
        .iter()
        .filter(|field| names.contains(&field.name))
        .map(|field| field.name.clone())
        .collect())
}

/// Validate and derive v2's parent groups. Relational nodes deliberately
/// contribute no parent key and an all-relational tuple therefore returns the
/// canonical empty group list.
pub fn snapshot_batch_v2_parent_authorization_groups(
    function: &FunctionDefinition,
    plan: &SnapshotBatchPlanV2,
) -> SnapbackResult<Vec<SnapshotBatchParentAuthorizationGroupV1>> {
    let contract = function.args_contract.as_ref().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
            "query",
            "snapshot batch v2 requires a closed typed argument contract",
        )
    })?;
    let mut group_positions = BTreeMap::<SnapshotBatchParentAuthorizationIdentityV1, usize>::new();
    let mut groups: Vec<SnapshotBatchParentAuthorizationGroupV1> = Vec::new();
    for (node_index, node) in plan.nodes.iter().enumerate() {
        let SnapshotBatchNodeV2::BoundedChildren(node) = node else {
            continue;
        };
        let argument = contract
            .fields
            .iter()
            .find(|field| field.name == node.parent_id_arg)
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
                    "query",
                    format!(
                        "snapshot batch v2 node {node_index} names undeclared parent argument {}",
                        node.parent_id_arg
                    ),
                )
            })?;
        if !argument.required
            || argument.value
                != (ResultValueContract::Id {
                    table: node.parent_table.clone(),
                })
        {
            return Err(SnapbackError::error(
                "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
                "query",
                format!(
                    "snapshot batch v2 node {node_index} parent argument {} must be a required id<{}>",
                    node.parent_id_arg, node.parent_table
                ),
            ));
        }
        let identity = SnapshotBatchParentAuthorizationIdentityV1 {
            parent_table: node.parent_table.clone(),
            parent_id_argument: node.parent_id_arg.clone(),
            parent_id_table: node.parent_table.clone(),
            visibility: node.parent_visibility.clone(),
        };
        if let Some(group_index) = group_positions.get(&identity).copied() {
            groups[group_index].node_indices.push(node_index);
        } else {
            group_positions.insert(identity.clone(), groups.len());
            groups.push(SnapshotBatchParentAuthorizationGroupV1 {
                identity,
                node_indices: vec![node_index],
            });
        }
    }
    Ok(groups)
}

fn validate_snapshot_batch_v2_argument_bindings(
    function: &FunctionDefinition,
    plan: &SnapshotBatchPlanV2,
) -> SnapbackResult<()> {
    snapshot_batch_v2_parent_authorization_groups(function, plan)?;
    let contract = function
        .args_contract
        .as_ref()
        .expect("v2 group derivation requires the argument contract");
    let mut expected = BTreeSet::<String>::new();
    for node in &plan.nodes {
        expected.extend(snapshot_batch_v2_node_argument_names(function, node)?);
    }
    expected.insert("cursor".to_owned());
    let actual = contract
        .fields
        .iter()
        .map(|field| field.name.clone())
        .collect::<BTreeSet<_>>();
    let cursor = contract.fields.iter().find(|field| field.name == "cursor");
    if actual != expected
        || !cursor.is_some_and(|field| {
            !field.required && field.value == ResultValueContract::String { max_bytes: 8_192 }
        })
    {
        return Err(SnapbackError::error(
            "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
            "query",
            "snapshot batch v2 arguments must be exactly the merged node bindings plus optional cursor:string(maxBytes=8192)",
        ));
    }
    Ok(())
}

/// Rebuild the exact v2 node/composite identity without inferring node class,
/// parent grouping, liveness, or argument closure from serialized shape.
///
/// @ref LLP 0157#d2--plan-identity — v2 reuses the v1 identity stack with
///   profileId `snapshot-batch.v2`; only bounded-child positions enter parent
///   groups and every node binds its owner-declared arguments in order.
pub fn snapshot_batch_identity_v2(
    function: &FunctionDefinition,
    plan: &SnapshotBatchPlanV2,
) -> SnapbackResult<SnapshotBatchIdentityV2> {
    validate_snapshot_batch_v2_argument_bindings(function, plan)?;
    let contract = function
        .args_contract
        .as_ref()
        .expect("v2 argument admission requires the contract");
    let groups = snapshot_batch_v2_parent_authorization_groups(function, plan)?;
    let mut node_records = Vec::with_capacity(plan.nodes.len());
    let mut node_hashes = Vec::with_capacity(plan.nodes.len());
    let mut merged = Vec::<Value>::new();
    let mut merged_positions = BTreeMap::<String, usize>::new();

    for (position, node) in plan.nodes.iter().enumerate() {
        let mut bindings = Vec::new();
        for name in snapshot_batch_v2_node_argument_names(function, node)? {
            let field = contract
                .fields
                .iter()
                .find(|field| field.name == name)
                .expect("v2 argument closure checked names");
            let binding_contract = serde_json::json!({
                "format": "snapback.argument-binding-contract.v1",
                "required": field.required,
                "value": field.value,
            });
            let contract_hash =
                domain_hash(b"snapback:argument-binding-contract:v1:", &binding_contract)?;
            let binding = serde_json::json!({
                "name": field.name,
                "contract": binding_contract,
                "contractHash": contract_hash,
            });
            if let Some(index) = merged_positions.get(&field.name).copied() {
                let entry = merged[index]
                    .as_object_mut()
                    .expect("host-created v2 merged binding object");
                let same = entry.get("contract") == binding.get("contract")
                    && entry.get("contractHash") == binding.get("contractHash");
                if !same {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
                        "query",
                        "one merged snapshot batch v2 argument has incompatible node contracts",
                    ));
                }
                entry
                    .get_mut("sourcePositions")
                    .and_then(Value::as_array_mut)
                    .expect("host-created v2 sourcePositions")
                    .push(Value::from(position));
            } else {
                merged_positions.insert(field.name.clone(), merged.len());
                merged.push(serde_json::json!({
                    "name": field.name,
                    "contract": binding.get("contract").cloned().expect("binding contract"),
                    "contractHash": binding.get("contractHash").cloned().expect("binding hash"),
                    "sourcePositions": [position],
                }));
            }
            bindings.push(binding);
        }
        let class_id = node.class_id();
        let node_record = serde_json::json!({
            "format": "snapback.node-plan.v1",
            "classId": class_id,
            "classVersion": 1,
            "normalizedPlan": node.normalized_plan()?,
            "argumentBindings": bindings,
            "capability": {
                "exportKind": "internal",
                "live": {"kind": "none"},
                "retention": "none",
                "requiredCapabilityIds": [class_id],
            },
        });
        let node_hash = domain_hash(b"snapback:node-plan:v1:", &node_record)?;
        node_records.push(serde_json::json!({
            "position": position,
            "nodePlan": node_record,
            "nodePlanHash": node_hash,
        }));
        node_hashes.push(node_hash);
    }

    let merged_record = serde_json::json!({
        "format": "snapback.merged-args-contract.v1",
        "bindings": merged,
    });
    let merged_hash = domain_hash(b"snapback:merged-args-contract:v1:", &merged_record)?;

    let mut key_jcs = Vec::with_capacity(groups.len());
    let mut key_digests = Vec::with_capacity(groups.len());
    let mut normalized_groups = Vec::with_capacity(groups.len());
    for group in groups {
        let key = serde_json::json!({
            "format": "snapback.parent-authorization-key.v1",
            "parentTable": group.identity.parent_table,
            "parentIdArgument": group.identity.parent_id_argument,
            "parentIdType": {"kind": "id", "table": group.identity.parent_id_table},
            "visibility": match group.identity.visibility {
                BoundedParentVisibility::PublicRead => serde_json::json!({
                    "kind": "public-read",
                }),
                BoundedParentVisibility::Owner { field } => serde_json::json!({
                    "kind": "owner.v1",
                    "field": field,
                }),
            },
        });
        let canonical = crate::rqs_contract::jcs(&key).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
                "query",
                "snapshot batch v2 parent authorization key is not canonicalizable",
            )
        })?;
        let digest = domain_hash(b"snapback:parent-authorization-key:v1:", &key)?;
        normalized_groups.push(serde_json::json!({
            "members": group.node_indices,
            "keyJcsBase64url": URL_SAFE_NO_PAD.encode(canonical.as_bytes()),
        }));
        key_jcs.push(canonical);
        key_digests.push(digest);
    }
    let normalized = serde_json::json!({
        "format": "snapback.normalized-composite-plan.v1",
        "profileId": "snapshot-batch.v2",
        "nodes": node_records,
        "mergedArgsContractHash": merged_hash,
        "classification": {
            "callable": true,
            "live": {
                "kind": "admitted",
                "delivery": "live_replace",
                "pageDomain": "cursor-free-first-page",
            },
            "invalidation": "table-granular-resnapshot",
            "retention": "none",
        },
        "parentAuthorizationGroups": normalized_groups,
    });
    Ok(SnapshotBatchIdentityV2 {
        normalized_composite_plan: normalized.clone(),
        plan_hash: domain_hash(b"snapback:plan-hash:v1:", &normalized)?,
        node_plan_hashes: node_hashes,
        node_examined_entry_ceilings: plan
            .nodes
            .iter()
            .map(SnapshotBatchNodeV2::examined_entry_ceiling)
            .collect(),
        node_joined_lookup_ceilings: plan
            .nodes
            .iter()
            .map(SnapshotBatchNodeV2::joined_lookup_ceiling)
            .collect(),
        parent_authorization_group_count: key_digests.len(),
        parent_authorization_key_jcs: key_jcs,
        parent_authorization_key_digests: key_digests,
    })
}

/// Validate and derive the merged argument identities and parent-auth groups.
/// A bounded-child parent binding must name a required `id<parentTable>` field
/// in the function's existing LLP 0131 argument contract. Reusing one argument
/// name for incompatible parent types therefore refuses structurally.
pub fn snapshot_batch_parent_authorization_groups(
    function: &FunctionDefinition,
    plan: &SnapshotBatchPlanV1,
) -> SnapbackResult<Vec<SnapshotBatchParentAuthorizationGroupV1>> {
    let contract = function.args_contract.as_ref().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
            "query",
            "snapshot batch requires a closed typed argument contract",
        )
    })?;
    let mut group_positions = BTreeMap::<SnapshotBatchParentAuthorizationIdentityV1, usize>::new();
    let mut groups: Vec<SnapshotBatchParentAuthorizationGroupV1> = Vec::new();
    for (node_index, node) in plan.nodes.iter().enumerate() {
        let argument = contract
            .fields
            .iter()
            .find(|field| field.name == node.parent_id_arg)
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
                    "query",
                    format!(
                        "snapshot batch node {node_index} names undeclared parent argument {}",
                        node.parent_id_arg
                    ),
                )
            })?;
        if !argument.required
            || argument.value
                != (ResultValueContract::Id {
                    table: node.parent_table.clone(),
                })
        {
            return Err(SnapbackError::error(
                "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
                "query",
                format!(
                    "snapshot batch node {node_index} parent argument {} must be a required id<{}>",
                    node.parent_id_arg, node.parent_table
                ),
            ));
        }
        let identity = SnapshotBatchParentAuthorizationIdentityV1 {
            parent_table: node.parent_table.clone(),
            parent_id_argument: node.parent_id_arg.clone(),
            parent_id_table: node.parent_table.clone(),
            visibility: node.parent_visibility.clone(),
        };
        if let Some(group_index) = group_positions.get(&identity).copied() {
            groups[group_index].node_indices.push(node_index);
        } else {
            group_positions.insert(identity.clone(), groups.len());
            groups.push(SnapshotBatchParentAuthorizationGroupV1 {
                identity,
                node_indices: vec![node_index],
            });
        }
    }
    Ok(groups)
}

fn validate_snapshot_batch_argument_bindings(
    function: &FunctionDefinition,
    plan: &SnapshotBatchPlanV1,
) -> SnapbackResult<()> {
    snapshot_batch_parent_authorization_groups(function, plan)?;
    let contract = function
        .args_contract
        .as_ref()
        .expect("group derivation requires the argument contract");
    let mut expected = plan
        .nodes
        .iter()
        .map(|node| node.parent_id_arg.as_str())
        .collect::<BTreeSet<_>>();
    expected.insert("cursor");
    let actual = contract
        .fields
        .iter()
        .map(|field| field.name.as_str())
        .collect::<BTreeSet<_>>();
    let cursor = contract.fields.iter().find(|field| field.name == "cursor");
    if actual != expected
        || !cursor.is_some_and(|field| {
            !field.required && field.value == ResultValueContract::String { max_bytes: 8_192 }
        })
    {
        return Err(SnapbackError::error(
            "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
            "query",
            "snapshot batch arguments must be exactly the merged required parent ids plus optional cursor:string(maxBytes=8192)",
        ));
    }
    Ok(())
}

/// Check LLP 0135's complete sealed one-row outer result, including the exact
/// declaration-ordered heterogeneous node tuple. Schema-aware validation later
/// compares every tuple element with its node projection.
fn validate_snapshot_batch_outer_result_contract(
    function: &FunctionDefinition,
    plan: &SnapshotBatchPlanV1,
) -> SnapbackResult<()> {
    validate_snapshot_batch_outer_result_contract_len(
        function,
        plan.nodes.len(),
        "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
    )
}

fn validate_snapshot_batch_v2_outer_result_contract(
    function: &FunctionDefinition,
    plan: &SnapshotBatchPlanV2,
) -> SnapbackResult<()> {
    validate_snapshot_batch_outer_result_contract_len(
        function,
        plan.nodes.len(),
        "SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID",
    )
}

fn validate_snapshot_batch_outer_result_contract_len(
    function: &FunctionDefinition,
    node_count: usize,
    diagnostic_code: &'static str,
) -> SnapbackResult<()> {
    let invalid = || {
        SnapbackError::error(
            diagnostic_code,
            "query",
            "snapshot batch requires the exact one-row sealed outer result envelope",
        )
    };
    let FunctionResultContract::Records {
        record: ResultValueContract::Union { variants },
        rows: Some(ResultRowsBound {
            min_items: 1,
            max_items: 1,
        }),
    } = &function.result_contract
    else {
        return Err(invalid());
    };
    if variants.len() != 2 {
        return Err(invalid());
    }
    fn object_fields(variant: &ResultValueContract) -> Option<&Vec<ResultObjectFieldContract>> {
        let ResultValueContract::Object {
            fields,
            allow_extra: false,
        } = variant
        else {
            return None;
        };
        if fields.len() != 3
            || fields.iter().any(|field| !field.required)
            || fields[0].name != "kind"
            || fields[1].name != "nodes"
            || fields[2].name != "continuation"
        {
            return None;
        }
        Some(fields)
    }
    let absent = object_fields(&variants[0]).ok_or_else(invalid)?;
    if absent[0].value
        != (ResultValueContract::Literal {
            value: Value::String("absent".to_owned()),
        })
        || absent[1].value != ResultValueContract::Null
        || absent[2].value != ResultValueContract::Null
    {
        return Err(invalid());
    }
    let visible = object_fields(&variants[1]).ok_or_else(invalid)?;
    if visible[0].value
        != (ResultValueContract::Literal {
            value: Value::String("visible".to_owned()),
        })
        || visible[2].value
            != (ResultValueContract::Union {
                variants: vec![
                    ResultValueContract::Null,
                    ResultValueContract::String { max_bytes: 8_192 },
                ],
            })
    {
        return Err(invalid());
    }
    let ResultValueContract::Tuple { elements } = &visible[1].value else {
        return Err(invalid());
    };
    if elements.len() != node_count {
        return Err(invalid());
    }
    Ok(())
}

pub fn validate_write_with_activity_plan_shape(plan: &WriteWithActivityPlan) -> SnapbackResult<()> {
    let invalid = || {
        SnapbackError::error(
            "SNAPBACK_WRITE_WITH_ACTIVITY_PLAN_INVALID",
            "mutation",
            "write-with-activity plan is outside the closed v1 profile",
        )
    };
    let relation_tables: BTreeSet<&str> = plan
        .relations
        .iter()
        .map(|relation| relation.table.as_str())
        .collect();
    let provenance_fields = [
        plan.provenance_fields.scope_id.as_str(),
        plan.provenance_fields.source_table.as_str(),
        plan.provenance_fields.source_id.as_str(),
        plan.provenance_fields.operation.as_str(),
        plan.provenance_fields.effective_subject.as_str(),
        plan.provenance_fields.actual_actor.as_str(),
        plan.provenance_fields.actor_kind.as_str(),
        plan.provenance_fields.grant.as_str(),
        plan.provenance_fields.occurred_at.as_str(),
        plan.provenance_fields.mutation.as_str(),
    ];
    let distinct_provenance_fields: BTreeSet<&str> = provenance_fields.iter().copied().collect();
    if plan.profile != "write-with-activity.v1"
        || plan.required_capability != "write_activity_v1"
        // Only the existing-owner authoring mode has a generated evaluator
        // and publication corpus. A direct artifact cannot opt into the
        // reserved create-owner discriminator ahead of that implementation.
        || plan.mode != WriteWithActivityMode::ExistingOwnerV1
        || plan.scope_table.trim().is_empty()
        || plan.scope_owner_field.trim().is_empty()
        || plan.source_table.trim().is_empty()
        || plan.activity_table.trim().is_empty()
        || plan.scope_table == plan.source_table
        || plan.source_table == plan.activity_table
        || plan.scope_table == plan.activity_table
        || plan.activity_scope_foreign_key.trim().is_empty()
        || plan.activity_scope_incarnation.trim().is_empty()
        || plan.activity_scope_foreign_key != plan.provenance_fields.scope_id
        || distinct_provenance_fields.len() != provenance_fields.len()
        || distinct_provenance_fields.contains(plan.activity_scope_incarnation.as_str())
        || plan.relations.is_empty()
        || relation_tables.len() != plan.relations.len()
        || !relation_tables.contains(plan.source_table.as_str())
        || plan.relations.iter().any(|relation| {
            relation.table.trim().is_empty()
                || relation.table == plan.scope_table
                || relation.table == plan.activity_table
                || relation.scope_foreign_key.trim().is_empty()
                || relation.scope_incarnation.trim().is_empty()
                || relation.scope_foreign_key == relation.scope_incarnation
        })
        || plan.effect_formula.source_writes != 1
        || plan.effect_formula.activity_inserts != 1
        || plan.effect_formula.scope_reads != 1
        || plan.effect_formula.runtime_now != 1
        || plan.effect_formula.settlement_lookups != 1
        || plan.effect_formula.settlement_writes != 1
        || plan.effect_formula.sequence_allocations > 1
        || plan.effect_formula.auxiliary_point_reads > 8
        || plan.effect_formula.maximum_application_writes > 3
    {
        return Err(invalid());
    }

    let steps = &plan.mutation.steps;
    if steps.len() < 4 {
        return Err(invalid());
    }
    let scope_binding = "__activityScope";
    let activity_binding = "__activityId";
    let allocation_positions = steps
        .iter()
        .enumerate()
        .filter_map(|(index, step)| {
            matches!(step, MutationStep::AllocateSequence { .. }).then_some(index)
        })
        .collect::<Vec<_>>();
    let scope_refusal = if plan.effect_formula.sequence_allocations == 0 {
        "SNAPBACK_ROW_NOT_FOUND"
    } else {
        "SNAPBACK_RELATION_PARENT_UNAVAILABLE"
    };
    if allocation_positions.len() != usize::from(plan.effect_formula.sequence_allocations)
        || (plan.effect_formula.sequence_allocations == 1 && allocation_positions != [2])
    {
        return Err(invalid());
    }
    if !matches!(
        &steps[0],
        MutationStep::Get {
            table,
            id,
            bind_as,
            else_error,
        } if table == &plan.scope_table
            && id == &plan.scope_id
            && bind_as == scope_binding
            && else_error.as_deref() == Some(scope_refusal)
    ) {
        return Err(invalid());
    }
    let exact_owner_guard = match &steps[1] {
        MutationStep::Guard {
            cond:
                ValueExpr::Binary {
                    op: BinaryOp::Eq,
                    left,
                    right,
                },
            else_error,
        } if else_error == scope_refusal && matches!(right.as_ref(), ValueExpr::AuthUserId) => {
            matches!(
                left.as_ref(),
                ValueExpr::Field { base, key }
                    if key == &plan.scope_owner_field
                        && matches!(
                            base.as_ref(),
                            ValueExpr::Binding(binding) if binding == scope_binding
                        )
            )
        }
        _ => false,
    };
    if !exact_owner_guard {
        return Err(invalid());
    }
    let source_assertion_index = steps.len() - 2;
    let guard_and_let_count = steps[2..source_assertion_index]
        .iter()
        .filter(|step| matches!(step, MutationStep::Guard { .. } | MutationStep::Let { .. }))
        .count();
    let forbidden_expr =
        |expr: &ValueExpr| expr.uses_runtime_id() || expr.uses_authoritative_only();
    let step_uses_forbidden_expr = |step: &MutationStep| match step {
        MutationStep::AssetCollection(_) => true,
        MutationStep::AllocateSequence { scope, .. } => forbidden_expr(scope),
        MutationStep::Insert { values, .. } => values.values().any(forbidden_expr),
        MutationStep::Patch { id, values, .. } => {
            forbidden_expr(id) || values.values().any(forbidden_expr)
        }
        MutationStep::Delete { id, .. } | MutationStep::Get { id, .. } => forbidden_expr(id),
        MutationStep::Guard { cond, .. } => forbidden_expr(cond),
        MutationStep::AssertCurrentRelation { id, scope_id, .. } => {
            forbidden_expr(id) || forbidden_expr(scope_id)
        }
        MutationStep::Let { expr, .. } => forbidden_expr(expr),
        MutationStep::DeleteWhere { filter, .. } => {
            filter.iter().any(|entry| forbidden_expr(&entry.value))
        }
        MutationStep::InsertEach { source, values, .. } => {
            forbidden_expr(source) || values.values().any(forbidden_expr)
        }
        MutationStep::AssertSourceChanged { id, .. } => forbidden_expr(id),
    };
    let return_uses_forbidden_expr = match &plan.mutation.return_value {
        Some(ReturnValue::Document { id, .. }) => forbidden_expr(id),
        Some(ReturnValue::Expr(expr)) => forbidden_expr(expr),
        _ => false,
    };
    if guard_and_let_count > 16
        || steps.iter().any(step_uses_forbidden_expr)
        || return_uses_forbidden_expr
    {
        return Err(invalid());
    }

    if !matches!(
        &steps[source_assertion_index],
        MutationStep::AssertSourceChanged {
            table,
            id,
            operation,
        } if table == &plan.source_table
            && id == &plan.source_id
            && operation == &plan.source_operation
    ) {
        return Err(invalid());
    }
    let activity_values = match &steps[steps.len() - 1] {
        MutationStep::Insert {
            table,
            values,
            bind_id_as,
        } if table == &plan.activity_table && bind_id_as.as_deref() == Some(activity_binding) => {
            values
        }
        _ => return Err(invalid()),
    };
    let provenance = &plan.provenance_fields;
    let literal_string = |field: &str, expected: &str| {
        matches!(
            activity_values.get(field),
            Some(ValueExpr::Literal(serde_json::Value::String(value))) if value == expected
        )
    };
    if activity_values.get(&provenance.scope_id) != Some(&plan.scope_id)
        || !literal_string(&provenance.source_table, &plan.source_table)
        || activity_values.get(&provenance.source_id) != Some(&plan.source_id)
        || !literal_string(&provenance.operation, plan.source_operation.as_str())
        || !matches!(
            activity_values.get(&provenance.effective_subject),
            Some(ValueExpr::AuthUserId)
        )
        || !matches!(
            activity_values.get(&provenance.actual_actor),
            Some(ValueExpr::AuthActorUserId)
        )
        || !matches!(
            activity_values.get(&provenance.actor_kind),
            Some(ValueExpr::AuthActivityActorKind)
        )
        || !matches!(
            activity_values.get(&provenance.grant),
            Some(ValueExpr::AuthGrantId)
        )
        || !matches!(
            activity_values.get(&provenance.occurred_at),
            Some(ValueExpr::RuntimeNow)
        )
        || !matches!(
            activity_values.get(&provenance.mutation),
            Some(ValueExpr::ClientMutationDigest)
        )
        || activity_values.contains_key(&plan.activity_scope_incarnation)
        || !matches!(&plan.mutation.return_value, Some(ReturnValue::Expr(_)))
    {
        return Err(invalid());
    }

    let mut source_writes = 0_u8;
    let mut scope_patches = 0_u8;
    let mut auxiliary_point_reads = 0_u8;
    let mut sequence_allocations = 0_u8;
    for index in 2..source_assertion_index {
        let step = &steps[index];
        match step {
            MutationStep::AllocateSequence { scope, .. } => {
                if index != 2 || scope != &plan.scope_id {
                    return Err(invalid());
                }
                sequence_allocations += 1;
            }
            MutationStep::Get { table, id, .. } => {
                if table == &plan.scope_table
                    || !matches!(
                        steps.get(index - 1),
                        Some(MutationStep::AssertCurrentRelation {
                            table: asserted_table,
                            id: asserted_id,
                            ..
                        }) if asserted_table == table && asserted_id == id
                    )
                {
                    return Err(invalid());
                }
                auxiliary_point_reads += 2;
            }
            MutationStep::Insert {
                table, bind_id_as, ..
            } => {
                if table != &plan.source_table
                    || plan.source_operation != WriteWithActivitySourceOperation::Insert
                    || !matches!(
                        (&plan.source_id, bind_id_as),
                        (ValueExpr::Binding(source_binding), Some(insert_binding))
                            if source_binding == insert_binding
                    )
                {
                    return Err(invalid());
                }
                source_writes += 1;
            }
            MutationStep::Patch { table, id, values } => {
                if table == &plan.scope_table {
                    if id != &plan.scope_id {
                        return Err(invalid());
                    }
                    scope_patches += 1;
                } else {
                    if table != &plan.source_table
                        || id != &plan.source_id
                        || values.is_empty()
                        || plan.source_operation != WriteWithActivitySourceOperation::Patch
                        || !matches!(
                            steps.get(index - 1),
                            Some(MutationStep::AssertCurrentRelation {
                                table: asserted_table,
                                id: asserted_id,
                                ..
                            }) if asserted_table == table && asserted_id == id
                        )
                    {
                        return Err(invalid());
                    }
                    source_writes += 1;
                    auxiliary_point_reads += 2;
                }
            }
            MutationStep::Delete { table, id } => {
                if table != &plan.source_table
                    || id != &plan.source_id
                    || plan.source_operation != WriteWithActivitySourceOperation::Delete
                    || !matches!(
                        steps.get(index - 1),
                        Some(MutationStep::AssertCurrentRelation {
                            table: asserted_table,
                            id: asserted_id,
                            ..
                        }) if asserted_table == table && asserted_id == id
                    )
                {
                    return Err(invalid());
                }
                source_writes += 1;
                auxiliary_point_reads += 2;
            }
            MutationStep::AssertCurrentRelation { table, id, .. } => {
                if !matches!(
                    steps.get(index + 1),
                    Some(MutationStep::Get {
                        table: operation_table,
                        id: operation_id,
                        ..
                    } | MutationStep::Patch {
                        table: operation_table,
                        id: operation_id,
                        ..
                    } | MutationStep::Delete {
                        table: operation_table,
                        id: operation_id,
                    }) if operation_table == table && operation_id == id
                ) {
                    return Err(invalid());
                }
            }
            MutationStep::Guard { .. } | MutationStep::Let { .. } => {}
            MutationStep::AssertSourceChanged { .. }
            | MutationStep::DeleteWhere { .. }
            | MutationStep::InsertEach { .. }
            | MutationStep::AssetCollection(_) => return Err(invalid()),
        }
    }
    let expected_runtime_ids = if plan.source_operation == WriteWithActivitySourceOperation::Insert
    {
        2
    } else {
        1
    };
    if source_writes != 1
        || scope_patches > 1
        || plan.effect_formula.scope_patches != scope_patches
        || plan.effect_formula.auxiliary_point_reads != auxiliary_point_reads
        || plan.effect_formula.sequence_allocations != sequence_allocations
        || plan.effect_formula.runtime_ids != expected_runtime_ids
        || plan.effect_formula.maximum_application_writes != 2 + scope_patches
    {
        return Err(invalid());
    }
    Ok(())
}

pub fn validate_query_plan_shape(plan: &QueryPlan) -> SnapbackResult<()> {
    // @ref LLP 0007#query-semantics — every direct artifact must enter the
    // same bounded portable expression profile before it can be installed.
    if let Some(limit) = plan.limit
        && limit > QUERY_MAX_LIMIT
    {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_LIMIT_INVALID",
            "query",
            format!("query limit {limit} exceeds the portable cap {QUERY_MAX_LIMIT}"),
        ));
    }
    let mut literal_in_items = 0_usize;
    let mut known_filter_bindings = 0_usize;
    for filter in &plan.filters {
        crate::value_expr::validate_value_expr(&filter.value)?;
        let added_bindings = if filter.op == FilterOp::In {
            if let ValueExpr::Literal(value) = &filter.value {
                let Some(items) = value.as_array() else {
                    return Err(SnapbackError::error(
                        "SNAPBACK_QUERY_FILTER_VALUE_INVALID",
                        "query",
                        format!("query In filter on {} expects an array", filter.field),
                    ));
                };
                literal_in_items = literal_in_items.saturating_add(items.len());
                if literal_in_items > QUERY_MAX_IN_ITEMS {
                    return Err(SnapbackError::error(
                        "SNAPBACK_QUERY_IN_ITEMS_EXCEEDED",
                        "query",
                        format!(
                            "query In filters contain {} literal items after {}; maxInItems is {}",
                            literal_in_items, filter.field, QUERY_MAX_IN_ITEMS
                        ),
                    ));
                }
                items.len()
            } else {
                // The runtime validator accounts for a dynamically evaluated
                // `In` array once its length is known.
                0
            }
        } else {
            1
        };
        known_filter_bindings = known_filter_bindings.saturating_add(added_bindings);
        if known_filter_bindings > QUERY_MAX_FILTER_BINDINGS {
            return Err(SnapbackError::error(
                "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED",
                "query",
                format!(
                    "query filters bind {known_filter_bindings} statically known values after {}; maxFilterBindings is {QUERY_MAX_FILTER_BINDINGS}",
                    filter.field
                ),
            ));
        }
    }
    Ok(())
}

pub fn effective_query_limit(plan: &QueryPlan) -> usize {
    plan.limit.unwrap_or(QUERY_DEFAULT_LIMIT)
}

/// The closed v1 registry of platform schema-reference ids (LLP 0131).
/// Exactly one entry: the search query AST, resolving to the
/// `SearchQueryAstV1` definition inside the exported
/// `search.request.schema.json`. The registry maps the id to both its
/// exported artifact definition and its runtime validator; in v1 both are
/// the same Rust type (`SearchQueryAstV1`), so artifact/validator agreement
/// is intrinsic and byte drift is gated by the schema-export drift test.
pub const SCHEMA_REF_SEARCH_QUERY_AST_V1: &str = "snapback:search-query-ast:v1";

pub fn schema_ref_registry_v1() -> [&'static str; 1] {
    [SCHEMA_REF_SEARCH_QUERY_AST_V1]
}

/// Interim declaration for field masking that remains inside an opaque
/// JavaScript query handler. It is review evidence only: the runtime does not
/// interpret the free-text condition or prove noninterference.
///
/// @ref LLP 0231#d3--composed-into-the-plan-sized-by-a-plan-class-model —
///   field-level boundaries stay declared and visibly handler-enforced until
///   the class-M sibling replaces this residual with an enforced grammar.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct FieldBoundaryDeclaration {
    pub fields: Vec<String>,
    pub condition: String,
}

/// Closed host-call capability emitted for every admitted D7 elevated read.
/// The runtime dispatch fence is owned by the separate provenance lane; this
/// manifest carrier gives that fence an alias-independent operation/form/table
/// ceiling instead of asking it to recover JavaScript source behavior.
///
/// @ref LLP 0234#d1--an-override-is-an-alternate-invocation-bound-table-policy
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ElevatedReadCapabilityV1 {
    pub form: ElevatedReadFormV1,
    pub tables: ElevatedReadTableCeilingV1,
}

#[derive(
    Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
pub enum ElevatedReadFormV1 {
    #[serde(rename = "get")]
    Get,
    #[serde(rename = "getMany")]
    GetMany,
    #[serde(rename = "uniqueMany")]
    UniqueMany,
    #[serde(rename = "query")]
    Query,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(untagged)]
pub enum ElevatedReadTableCeilingV1 {
    Opaque(String),
    Tables(Vec<String>),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TableWriteConflictDisclosureV1 {
    pub table: String,
    #[serde(rename = "writeForm", alias = "write_form")]
    pub write_form: String,
    pub constraint: String,
    pub operations: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FunctionWritePolicyV1 {
    pub semantic_version: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disclosures: Vec<TableWriteConflictDisclosureV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opaque_write_posture: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declared_table_ceiling: Option<Vec<String>>,
}

/// One declared backing-table input to an opaque custom authorization
/// evaluator. This is review evidence and wake input, never a completeness or
/// pushdown claim.
///
/// @ref LLP 0240#d4-custom-function-mediated-authority-has-an-honest-declaration
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomAuthorizationPolicyInputV1 {
    pub kind: String,
    pub table: String,
    pub subject: String,
    pub key: Vec<String>,
}

/// Closed coarse-global custom authorization fact emitted beside an Ibex
/// operation. Strings that describe unproved properties are fixed literals
/// validated at activation; they are not author-extensible vocabularies.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomAuthorizationV1 {
    pub offline: String,
    pub sync: String,
    pub inputs: Vec<CustomAuthorizationPolicyInputV1>,
    pub input_completeness: String,
    pub pushdown: String,
    pub retention: String,
    pub precise_invalidation: bool,
    pub coarse_global_wake_universe: Vec<String>,
    pub evaluator_identity: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct FunctionDefinition {
    /// Required stable identity for grants and consent. Deserialization
    /// tolerates an absent field (empty string) so the refusal is a typed
    /// load-time diagnostic rather than an opaque parse error, but
    /// [`FunctionManifest::validate_artifact`] rejects a manifest whose
    /// function lacks a non-empty id before it can install.
    ///
    /// @ref LLP 0012#v0-function-manifest — function ids are required and
    ///   stable; a missing id fails load with a typed diagnostic because
    ///   scoped grants and consent are keyed by this identity.
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default, rename = "exportedName", alias = "exported_name")]
    pub exported_name: Option<String>,
    pub kind: FunctionKind,
    /// A server-side streaming action emits bounded private chunks before its
    /// ordinary return value settles the durable transcript.
    ///
    /// @ref LLP 0204#d91--streaming-conversations — stream is a
    /// compiled action fact, never an invocation-time option.
    #[serde(default, skip_serializing_if = "is_false")]
    pub stream: bool,
    #[serde(default, rename = "sourceSpan", alias = "source_span")]
    pub source_span: Option<SourceSpan>,
    #[serde(default, rename = "handlerForm", alias = "handler_form")]
    pub handler_form: Option<String>,
    #[serde(default, rename = "implementationHash", alias = "implementation_hash")]
    pub implementation_hash: Option<String>,
    #[serde(
        default,
        rename = "mediaCommandBindings",
        alias = "media_command_bindings",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub media_command_bindings: Vec<MediaCommandBindingV1>,
    #[serde(default, rename = "argsContractHash", alias = "args_contract_hash")]
    pub args_contract_hash: Option<String>,
    /// The declared argument contract (LLP 0131): one closed object over the
    /// function's declaration-ordered arguments, carried beside the result
    /// contract and witnessed by `argsContractHash` (v2 domain). Absent on
    /// pre-0131 manifests, which keep loading without ingress validation.
    #[serde(
        default,
        rename = "argsContract",
        alias = "args_contract",
        skip_serializing_if = "Option::is_none"
    )]
    pub args_contract: Option<FunctionArgsContract>,
    /// Optional lane-L acceptance contract for one directly assigned
    /// `RuntimeNow` storage field. It sits beside the argument/result
    /// contracts because it is declaration authority, never a request knob.
    #[serde(
        default,
        rename = "boundedSkew",
        alias = "bounded_skew",
        skip_serializing_if = "Option::is_none"
    )]
    pub bounded_skew: Option<BoundedSkewDeclaration>,
    /// Counters this handler may allocate from. The scope table and its
    /// visibility proof are declaration authority: imperative handler code
    /// cannot widen either at runtime.
    ///
    /// @ref LLP 0135#12-allocation-surfaces — handler allocations are closed
    ///   by a per-function `sequences` declaration, default empty.
    /// @ref LLP 0128#contract-guardrails-before-choosing-a-substrate —
    ///   every counter names its scope table in the authoring surface.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sequences: Vec<SequenceDeclaration>,
    #[serde(default, rename = "resultContract", alias = "result_contract")]
    pub result_contract: FunctionResultContract,
    #[serde(default, rename = "resultContractHash", alias = "result_contract_hash")]
    pub result_contract_hash: Option<String>,
    /// Declared field-masking residual for an opaque JS query. This is not
    /// runtime enforcement and carries no noninterference guarantee.
    #[serde(
        default,
        rename = "fieldBoundary",
        alias = "field_boundary",
        skip_serializing_if = "Option::is_none"
    )]
    pub field_boundary: Option<FieldBoundaryDeclaration>,
    #[serde(
        default,
        rename = "elevatedDbCapabilities",
        alias = "elevated_db_capabilities",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub elevated_db_capabilities: Vec<ElevatedReadCapabilityV1>,
    #[serde(
        default,
        rename = "requiredCapabilities",
        alias = "required_capabilities"
    )]
    pub required_capabilities: Vec<String>,
    #[serde(default, rename = "authRequirement", alias = "auth_requirement")]
    pub auth_requirement: Option<AuthRequirement>,
    /// Codegen-compiled external exposure. `None` means the app has no
    /// enabled external API and preserves the historical grant-only policy;
    /// `Some(default)` means the enabled surface explicitly keeps this
    /// function closed.
    // @ref LLP 0204#d1--the-exposure-declaration-keystone — the fact rides
    // every invocation source through the function manifest.
    #[serde(
        default,
        rename = "apiExposure",
        alias = "api_exposure",
        skip_serializing_if = "Option::is_none"
    )]
    pub api_exposure: Option<ApiFunctionExposure>,
    #[serde(
        default,
        rename = "authorityIndependent",
        alias = "authority_independent",
        skip_serializing_if = "is_false"
    )]
    pub authority_independent: bool,
    /// Disclosure permission for Channel A / read-mode public bundles: this
    /// already-public query's rows may be embedded in a tokenless HTML
    /// response. Grants no invocation authority; accepted only beside a valid
    /// `authorityIndependent` declaration.
    // @ref LLP 0092#0c3-publicinline--a-codegen-compiled-disclosure-fact —
    //   authored on the function definition, compiled by codegen, re-enforced
    //   at manifest load; never route-manifest authored. Keep this reference
    //   out of the generated JSON Schema description.
    #[serde(
        default,
        rename = "publicInline",
        alias = "public_inline",
        skip_serializing_if = "is_false"
    )]
    pub public_inline: bool,
    /// This entry point may reach a durable permission-backing write. The
    /// marker is part of delegated consent: changing it terminally invalidates
    /// scopes minted against the prior function basis.
    ///
    /// @ref LLP 0055#grants — authority-creating functions require explicit,
    ///   displayed consent and never join a delegated tier expansion.
    #[serde(
        default,
        rename = "authorityCreating",
        alias = "authority_creating",
        skip_serializing_if = "is_false"
    )]
    pub authority_creating: bool,
    /// Results may be durably retained only when the item-8 admission profile
    /// validates this declaration and the complete read summary.
    ///
    /// @ref LLP 0053#retained-and-offline-authorization — retainability is an
    ///   explicit capability, never inferred from live/callable status.
    #[serde(default, skip_serializing_if = "is_false")]
    pub retainable: bool,
    /// Optional owner-issued refinement of the retained-result class. Its
    /// absence preserves the legacy `retainable: true` encoding and means
    /// `opaque-authorized-snapshot-v1`; the only admitted explicit value is
    /// the post-gate `result-transform-snapshot-v1` class.
    // @ref LLP 0166#d3--retention-keyed-by-plan-identity — the server-side
    //   retention owner reclassifies a plan; the class is identity input, so
    //   old records are never mutated into the new class.
    #[serde(
        default,
        rename = "retentionClass",
        alias = "retention_class",
        skip_serializing_if = "Option::is_none"
    )]
    pub retention_class: Option<String>,
    /// Closed set of application refusal codes this function may raise through
    /// `ctx.refuse`. The declaration is what makes an app-minted code typed: a
    /// thrown code outside this set folds to `SNAPBACK_HANDLER_FAILED`, so a
    /// forged claim can never mint semantics the author did not declare.
    // @ref LLP 0108#declared-application-refusals — app codes live in their
    //   own namespace and can never collide with or mask `SNAPBACK_*`. Keep
    //   this reference out of the generated JSON Schema description.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub refusals: Vec<String>,
    /// Subset of `refusals` whose admitted occurrences opt into issue
    /// tracking. This is private invocation authority, not a served/public
    /// function descriptor, and cannot admit a refusal code by itself.
    // @ref LLP 0108#tracked-refusal-opt-in — codegen and manifest load both
    //   enforce the subset; omission is the empty opt-in.
    #[serde(
        default,
        rename = "trackedRefusals",
        alias = "tracked_refusals",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub tracked_refusals: Vec<String>,
    /// Closed authority dimensions used by this result. Codegen derives the
    /// HostPlan value from `AuthUserId`/`authScopeField`; opaque JavaScript is
    /// never upgraded merely because an author writes `userId` here.
    #[serde(
        default,
        rename = "authorizationDependence",
        alias = "authorization_dependence",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub authorization_dependence: Vec<AuthorizationInputDimension>,
    /// Opaque function-mediated authority remains private manifest authority:
    /// the public function projection deliberately omits its policy topology.
    #[serde(
        default,
        rename = "customAuthorization",
        alias = "custom_authorization",
        skip_serializing_if = "Option::is_none"
    )]
    pub custom_authorization: Option<CustomAuthorizationV1>,
    /// Authority-profile generations mechanically referenced by this
    /// function's compiled membership predicates or membership-table writes.
    /// Authors cannot supply this field; codegen derives it alongside
    /// `authorizationDependence`.
    #[serde(
        default,
        rename = "authorityProfileDependence",
        alias = "authority_profile_dependence",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub authority_profile_dependence: Vec<AuthorityProfileIdentityV1>,
    /// Definitive codegen identity for a synthesized authority operation.
    /// Authors cannot supply the generator's private marker, so a matching
    /// function name or dependency vector is never sufficient authority.
    #[serde(
        default,
        rename = "generatedAuthorityOperation",
        alias = "generated_authority_operation",
        skip_serializing_if = "Option::is_none"
    )]
    pub generated_authority_operation: Option<GeneratedAuthorityOperationV1>,
    #[serde(default, rename = "syncabilityClass", alias = "syncability_class")]
    pub syncability_class: Option<String>,
    #[serde(default, rename = "readSetSummary", alias = "read_set_summary")]
    pub read_set_summary: DependencySummary,
    #[serde(default, rename = "writeSetSummary", alias = "write_set_summary")]
    pub write_set_summary: DependencySummary,
    /// The versioned conservative effect ceiling. Codegen computes it by a
    /// total default-deny traversal of the closed plan vocabulary for
    /// HostPlans (`basis: "static"`) and records author declarations for
    /// opaque handlers (`basis: "declared"`). Optional so pre-ceiling
    /// manifests keep loading; enforcement remains the runtime subset check.
    // @ref LLP 0065#1-fact-classes — EffectCeilingV1. (Plain comment: doc
    //   text flows into generated schemas.)
    #[serde(default, rename = "effectCeiling", alias = "effect_ceiling")]
    pub effect_ceiling: Option<EffectCeiling>,
    /// Stable versioned standard-pattern identity — which generated helper
    /// and visibility profile produced this function (e.g. `owned-crud.v1`,
    /// `owner.v1`). Absent on free-form definitions.
    /// @ref LLP 0065#3-common-pattern-contracts — versioned identifiers.
    #[serde(default, rename = "standardPattern", alias = "standard_pattern")]
    pub standard_pattern: Option<StandardPatternIdentity>,
    /// Operation-bound write disclosures and the bounded opaque-census facts.
    /// The storage seam never trusts these for row authority; activation and
    /// unique-oracle admission bind them into the operation identity.
    ///
    /// @ref LLP 0264#d1-one-table-policy-is-the-read-and-write-locus
    #[serde(
        default,
        rename = "writePolicy",
        alias = "write_policy",
        skip_serializing_if = "Option::is_none"
    )]
    pub write_policy: Option<FunctionWritePolicyV1>,
    #[serde(
        default,
        rename = "permissionEpochBumps",
        alias = "permission_epoch_bumps"
    )]
    pub permission_epoch_bumps: Vec<PermissionScopeExpr>,
    #[serde(default, rename = "bundleEntrypoint", alias = "bundle_entrypoint")]
    pub bundle_entrypoint: Option<String>,
    /// @ref LLP 0036#declared-configuration-in-the-manifest — D8: the config
    /// entries this function may receive. Declaring an entry makes it exist;
    /// only functions that name it here are granted it at runtime.
    #[serde(default)]
    pub uses: Vec<String>,
    pub runtime: FunctionRuntime,
}

impl FunctionDefinition {
    pub fn new(name: impl Into<String>, kind: FunctionKind, runtime: FunctionRuntime) -> Self {
        let name = name.into();
        let syncability_class = match kind {
            FunctionKind::LiveQuery => "syncable-live",
            FunctionKind::Query => "online-only",
            FunctionKind::Mutation => "mutation",
            FunctionKind::Action => "action",
        };
        Self {
            id: format!("fn:{name}"),
            name: name.clone(),
            exported_name: Some(name.clone()),
            kind,
            stream: false,
            source_span: None,
            handler_form: None,
            implementation_hash: None,
            media_command_bindings: Vec::new(),
            args_contract_hash: None,
            args_contract: None,
            bounded_skew: None,
            sequences: Vec::new(),
            result_contract: FunctionResultContract::Unknown,
            result_contract_hash: None,
            field_boundary: None,
            elevated_db_capabilities: Vec::new(),
            required_capabilities: Vec::new(),
            auth_requirement: None,
            api_exposure: None,
            authority_independent: false,
            public_inline: false,
            authority_creating: false,
            retainable: false,
            retention_class: None,
            refusals: Vec::new(),
            tracked_refusals: Vec::new(),
            authorization_dependence: Vec::new(),
            custom_authorization: None,
            authority_profile_dependence: Vec::new(),
            generated_authority_operation: None,
            syncability_class: Some(syncability_class.to_owned()),
            read_set_summary: DependencySummary::default(),
            write_set_summary: DependencySummary::default(),
            effect_ceiling: None,
            standard_pattern: None,
            write_policy: None,
            permission_epoch_bumps: Vec::new(),
            bundle_entrypoint: Some(name),
            uses: Vec::new(),
            runtime,
        }
    }

    pub fn effective_auth_requirement(&self) -> AuthRequirement {
        self.auth_requirement
            .unwrap_or(AuthRequirement::OptionalUser)
    }

    /// Every auth-scoped live query and every retainable query uses the same
    /// default-deny execution profile. Ordinary finite queries remain outside
    /// it unless they opt into retention.
    pub fn is_protected_query(&self) -> bool {
        self.retainable || (self.kind == FunctionKind::LiveQuery && !self.authority_independent)
    }

    /// Effective owner-issued class used by composition identity. Only call
    /// after manifest validation when consuming an authored explicit class.
    pub fn effective_retention_class(&self) -> &str {
        if !self.retainable {
            "none"
        } else {
            self.retention_class
                .as_deref()
                .unwrap_or("opaque-authorized-snapshot-v1")
        }
    }

    /// True only for retained results whose continued visibility is bound to
    /// the authenticated user rather than to a session lease. Public,
    /// authority-independent results deliberately stay outside this path.
    pub fn is_user_scoped_retainable_query(&self) -> bool {
        let dimensions = self
            .authorization_dependence
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        matches!(self.kind, FunctionKind::Query | FunctionKind::LiveQuery)
            && self.retainable
            && (dimensions == BTreeSet::from([AuthorizationInputDimension::UserId])
                || dimensions
                    == BTreeSet::from([
                        AuthorizationInputDimension::UserId,
                        AuthorizationInputDimension::Kind,
                    ]))
    }
}

/// `MaintainedProjectionPlanV1` (LLP 0080 §5): a relational core plus a
/// stable output key expression, per-source and output visibility
/// declarations, the declared root reverse index (the bounded lookup and
/// admission proof for joined-source fan-out), and a static `fanOutLimit`.
/// It deliberately has no caller-relative ordering, cursor, or `take`.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MaintainedProjectionPlan {
    /// Stable plan identity (publication metadata). The stored projection
    /// identity assigned at first activation derives from this and is
    /// revision-stable — it names the row-identity domain, never re-keys.
    pub id: String,
    pub root: String,
    #[serde(rename = "rootAlias", alias = "root_alias")]
    pub root_alias: String,
    pub joined: String,
    #[serde(rename = "joinedAlias", alias = "joined_alias")]
    pub joined_alias: String,
    #[serde(rename = "joinKind", alias = "join_kind")]
    pub join_kind: JoinKind,
    #[serde(rename = "joinOn", alias = "join_on")]
    pub join_on: Vec<JoinEquality>,
    /// The non-security root filter `materializeAll` enumerates under —
    /// portable literal-only predicates in v1 (no caller, no auth exprs).
    #[serde(default, rename = "rootFilters", alias = "root_filters")]
    pub root_filters: Vec<FilterExpr>,
    #[serde(rename = "rootVisibility", alias = "root_visibility")]
    pub root_visibility: ProjectionVisibility,
    #[serde(rename = "joinedVisibility", alias = "joined_visibility")]
    pub joined_visibility: ProjectionVisibility,
    /// Projection leaves; declaration order is the output field order.
    pub projection: Vec<ProjectionLeaf>,
    #[serde(rename = "outputTable", alias = "output_table")]
    pub output_table: String,
    #[serde(rename = "outputKey", alias = "output_key")]
    pub output_key: ProjectionOutputKey,
    #[serde(rename = "outputVisibility", alias = "output_visibility")]
    pub output_visibility: ProjectionVisibility,
    /// Declared root reverse index whose leading fields are exactly the
    /// root join-field sequence — targets may not discover affected roots
    /// through a table scan.
    #[serde(rename = "rootReverseIndex", alias = "root_reverse_index")]
    pub root_reverse_index: String,
    /// Static per-joined-key reference bound, `1..=1023`. Counts every
    /// reverse-index entry for the joined key, not only filter-admitted
    /// roots.
    #[serde(rename = "fanOutLimit", alias = "fan_out_limit")]
    pub fan_out_limit: u32,
    /// Explicit acknowledgment of the cross-authority capacity coupling
    /// when a mutable shared joined source feeds an owner output
    /// (LLP 0080 §3); absent otherwise.
    #[serde(
        default,
        rename = "sharedFanOutDisclosure",
        alias = "shared_fan_out_disclosure"
    )]
    pub shared_fan_out_disclosure: bool,
    /// The versioned rebuild recipe this plan declares (LLP 0080 §5);
    /// `"rebuild-v1"` is the only admitted value until the 0081 slice.
    #[serde(rename = "rebuildRecipe", alias = "rebuild_recipe")]
    pub rebuild_recipe: String,
}

// @ref LLP 0080#1-closed-relational-plan — this Rust-owned shape is the
// closed first relational profile. Keep the reference out of generated schema
// prose so ref-check does not interpret a JSON string as a source annotation.
/// The closed first relational profile: one root table, exactly one
/// unique-joined table, at most four equality pairs, explicit
/// visibility on both sources, index-served root access, deterministic
/// root ordering, and a bounded `take`. Evaluation follows the normative
/// `root-window-v1` pipeline: visible root filter → cursor boundary → root
/// order → take N roots → join + joined visibility → projection. `take`
/// bounds consumed authorized roots, not emitted rows.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RelationalQueryPlan {
    pub root: String,
    #[serde(rename = "rootAlias", alias = "root_alias")]
    pub root_alias: String,
    pub joined: String,
    #[serde(rename = "joinedAlias", alias = "joined_alias")]
    pub joined_alias: String,
    #[serde(rename = "joinKind", alias = "join_kind")]
    pub join_kind: JoinKind,
    /// 1..=4 equality pairs; declaration order preserved. A null in any
    /// join-key position never matches (LLP 0080 §2).
    #[serde(rename = "joinOn", alias = "join_on")]
    pub join_on: Vec<JoinEquality>,
    /// Non-security root filters from the portable vocabulary, index-served.
    #[serde(default, rename = "rootFilters", alias = "root_filters")]
    pub root_filters: Vec<FilterExpr>,
    /// The root visibility predicate, composed before ordering and `take`
    /// so an invisible root cannot occupy a bounded-result slot. Empty for
    /// an explicitly declared `public-read` root.
    #[serde(default, rename = "rootVisibility", alias = "root_visibility")]
    pub root_visibility: Vec<FilterExpr>,
    /// The exact restricted table policy derived from the installed schema.
    /// Public-read is normalized to absence, matching `QueryPlan`.
    ///
    /// @ref LLP 0231#d3--composed-into-the-plan-sized-by-a-plan-class-model
    #[serde(
        default,
        rename = "rootTableVisibility",
        alias = "root_table_visibility",
        skip_serializing_if = "Option::is_none"
    )]
    pub root_table_visibility: Option<TableVisibilityV1>,
    /// The joined-source visibility predicate, executed per joined row
    /// before projection: an invisible joined row behaves as absent.
    #[serde(default, rename = "joinedVisibility", alias = "joined_visibility")]
    pub joined_visibility: Vec<FilterExpr>,
    /// The exact restricted joined-table policy. Storage composes it with
    /// `joined_visibility`, so a row must satisfy both predicates.
    ///
    /// @ref LLP 0231#d3--composed-into-the-plan-sized-by-a-plan-class-model
    #[serde(
        default,
        rename = "joinedTableVisibility",
        alias = "joined_table_visibility",
        skip_serializing_if = "Option::is_none"
    )]
    pub joined_table_visibility: Option<TableVisibilityV1>,
    /// Explicit projection whose leaves are literals or qualified source
    /// fields; declaration order is the result field order.
    pub projection: Vec<ProjectionLeaf>,
    /// Root scalar order fields; the storage layer's `_id` tie-break
    /// totalizes it exactly as for single-table queries.
    #[serde(default)]
    pub order: Vec<OrderExpr>,
    /// Consumed-authorized-roots bound, `0..=1024`.
    pub take: u32,
    /// The declared root access index proving bounded, index-served access.
    #[serde(rename = "rootIndex", alias = "root_index")]
    pub root_index: String,
    /// The declared unique joined index whose complete ordered key is
    /// exactly the joined-field sequence — the cardinality proof.
    #[serde(rename = "joinedIndex", alias = "joined_index")]
    pub joined_index: String,
}

/// `bounded-children.v1`: one visible parent point read followed by one exact,
/// forward, `take + 1` child-index range. The one computed result record keeps
/// its continuation inside the row, leaving the ordinary top-level query
/// cursor unused.
///
/// @ref LLP 0110#cursor-and-result-closure — the result is a closed computed
///   record and the cursor binds the current parent version/incarnation.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BoundedChildrenQueryPlan {
    pub profile: String,
    #[serde(rename = "requiredCapability", alias = "required_capability")]
    pub required_capability: String,
    #[serde(rename = "parentTable", alias = "parent_table")]
    pub parent_table: String,
    #[serde(rename = "parentIdArg", alias = "parent_id_arg")]
    pub parent_id_arg: String,
    #[serde(rename = "parentVisibility", alias = "parent_visibility")]
    pub parent_visibility: BoundedParentVisibility,
    /// Exact restricted schema policy for the parent point read.
    ///
    /// @ref LLP 0231#d3--composed-into-the-plan-sized-by-a-plan-class-model
    #[serde(
        default,
        rename = "parentTableVisibility",
        alias = "parent_table_visibility",
        skip_serializing_if = "Option::is_none"
    )]
    pub parent_table_visibility: Option<TableVisibilityV1>,
    #[serde(rename = "parentProjection", alias = "parent_projection")]
    pub parent_projection: Vec<BoundedProjectionField>,
    #[serde(rename = "childTable", alias = "child_table")]
    pub child_table: String,
    /// Exact restricted schema policy for the child range.
    ///
    /// @ref LLP 0231#d3--composed-into-the-plan-sized-by-a-plan-class-model
    #[serde(
        default,
        rename = "childTableVisibility",
        alias = "child_table_visibility",
        skip_serializing_if = "Option::is_none"
    )]
    pub child_table_visibility: Option<TableVisibilityV1>,
    #[serde(rename = "childForeignKey", alias = "child_foreign_key")]
    pub child_foreign_key: String,
    #[serde(
        rename = "childRelationIncarnation",
        alias = "child_relation_incarnation"
    )]
    pub child_relation_incarnation: String,
    #[serde(rename = "childIndex", alias = "child_index")]
    pub child_index: String,
    pub order: Vec<OrderExpr>,
    pub take: u32,
    #[serde(rename = "childProjection", alias = "child_projection")]
    pub child_projection: Vec<BoundedProjectionField>,
    #[serde(rename = "parentDeletion", alias = "parent_deletion")]
    pub parent_deletion: String,
}

/// The released LLP 0157 normalized carrier for LLP 0135 Part 2. Codegen emits
/// the complete normalized record and its domain-separated hash; the host
/// reconstructs and compares both before treating either as identity.
///
/// @ref LLP 0135#21-composite-plan-shape — v1 composes a static tuple of
///   complete bounded-children plans and no other node kind.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SnapshotBatchPlanV1 {
    pub profile: String,
    pub nodes: Vec<BoundedChildrenQueryPlan>,
    #[serde(rename = "normalizedCompositePlan")]
    pub normalized_composite_plan: Value,
    #[serde(rename = "planHash")]
    pub plan_hash: String,
}

/// One class-explicit node in `snapshot-batch.v2`. The adjacent tag keeps
/// class membership host-visible while leaving `plan` as the owner's exact
/// normalized record for LLP 0157 node identity.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "classId", content = "plan", deny_unknown_fields)]
pub enum SnapshotBatchNodeV2 {
    #[serde(rename = "bounded_children_v1")]
    BoundedChildren(BoundedChildrenQueryPlan),
    #[serde(rename = "relational_query_v1")]
    RelationalQuery(RelationalQueryPlan),
}

impl SnapshotBatchNodeV2 {
    pub fn class_id(&self) -> &'static str {
        match self {
            Self::BoundedChildren(_) => "bounded_children_v1",
            Self::RelationalQuery(_) => "relational_query_v1",
        }
    }

    pub fn take(&self) -> u32 {
        match self {
            Self::BoundedChildren(plan) => plan.take,
            Self::RelationalQuery(plan) => plan.take,
        }
    }

    /// Per-node examined index-entry ceiling carried into plan identity by
    /// the owner-normalized `take`; parent point reads remain a separate group
    /// count and relational joined lookups remain a separate executor axis.
    ///
    /// @ref LLP 0157#sbsb2-plaintext-and-budget — bounded children use
    ///   `take + 1` except at zero; relational roots use exactly `take`.
    pub fn examined_entry_ceiling(&self) -> usize {
        match self {
            Self::BoundedChildren(plan) => {
                if plan.take == 0 {
                    0
                } else {
                    plan.take as usize + 1
                }
            }
            Self::RelationalQuery(plan) => plan.take as usize,
        }
    }

    pub fn joined_lookup_ceiling(&self) -> usize {
        match self {
            Self::BoundedChildren(_) => 0,
            Self::RelationalQuery(plan) => plan.take as usize,
        }
    }

    pub fn normalized_plan(&self) -> SnapbackResult<Value> {
        match self {
            Self::BoundedChildren(plan) => serde_json::to_value(plan),
            Self::RelationalQuery(plan) => serde_json::to_value(plan),
        }
        .map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
                "query",
                "snapshot batch v2 node does not serialize",
            )
        })
    }
}

/// The class-tagged mixed-node carrier for LLP 0157 `snapshot-batch.v2`.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SnapshotBatchPlanV2 {
    pub profile: String,
    pub nodes: Vec<SnapshotBatchNodeV2>,
    #[serde(rename = "normalizedCompositePlan")]
    pub normalized_composite_plan: Value,
    #[serde(rename = "planHash")]
    pub plan_hash: String,
}

/// One normalized `write-with-activity.v1` plan. `mutation` is the complete
/// executable closed IR including scope/source guards, the host-checked source
/// effect assertion, the activity insert, and final result expression.
///
/// @ref LLP 0110#total-effect-formulas — the plan carries its mode-indexed,
///   quantitative ceiling rather than reconstructing it from names.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WriteWithActivityPlan {
    pub profile: String,
    #[serde(rename = "requiredCapability", alias = "required_capability")]
    pub required_capability: String,
    pub mode: WriteWithActivityMode,
    #[serde(rename = "scopeTable", alias = "scope_table")]
    pub scope_table: String,
    #[serde(rename = "scopeId", alias = "scope_id")]
    pub scope_id: ValueExpr,
    #[serde(rename = "scopeOwnerField", alias = "scope_owner_field")]
    pub scope_owner_field: String,
    #[serde(rename = "sourceTable", alias = "source_table")]
    pub source_table: String,
    #[serde(rename = "sourceId", alias = "source_id")]
    pub source_id: ValueExpr,
    #[serde(rename = "sourceOperation", alias = "source_operation")]
    pub source_operation: WriteWithActivitySourceOperation,
    #[serde(rename = "activityTable", alias = "activity_table")]
    pub activity_table: String,
    #[serde(
        rename = "activityScopeForeignKey",
        alias = "activity_scope_foreign_key"
    )]
    pub activity_scope_foreign_key: String,
    #[serde(
        rename = "activityScopeIncarnation",
        alias = "activity_scope_incarnation"
    )]
    pub activity_scope_incarnation: String,
    pub relations: Vec<WriteActivityRelation>,
    #[serde(rename = "provenanceFields", alias = "provenance_fields")]
    pub provenance_fields: WriteActivityProvenanceFields,
    #[serde(rename = "effectFormula", alias = "effect_formula")]
    pub effect_formula: WriteWithActivityEffectFormula,
    pub mutation: MutationPlan,
}

// `HandlerPlan` outgrew clippy's variant-size threshold as the relational
// profile (LLP 0080) widened query plans. The externally-tagged shape is the
// ratified v0 artifact pin and every construction site spells the variant
// directly, so boxing here would be churn without a wire or safety win.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum FunctionRuntime {
    HostPlan(HandlerPlan),
    IbexModule(IbexModule),
}

/// The public projection of [`FunctionManifest`] served inside the root
/// `/inspect` identity descriptor. Like `PublicInspect` it is a typed
/// allowlist: the `From` impls below destructure the full structs exhaustively,
/// so a newly-added field is a compile error here rather than a silent leak.
///
/// What it keeps: identity/compat and dependency facts — app id, bundle/inputs
/// hashes, function names/kinds/capability summaries, read/write summaries,
/// cron and config *declarations* (never values; secrets do not ride the
/// manifest — LLP 0036). What it drops: every executable handler body
/// (`IbexModule.source`, `HandlerPlan` step bodies), every function/cron/config
/// `sourceSpan` (a source-path leak), and free-form unsupported-dependency
/// diagnostic message/details. Full operational context stays only on the gated
/// `/_snapback/api/inspect` twin.
///
/// @ref LLP 0031#resolved-decisions — D3: public `/inspect` is an identity
///   descriptor; handler source and plan bodies are operational facts for the
///   gated twin only (ENG-23441).
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicFunctionManifest {
    #[serde(rename = "artifactKind")]
    pub artifact_kind: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "appId")]
    pub app_id: String,
    #[serde(rename = "bundleHash")]
    pub bundle_hash: Option<String>,
    #[serde(rename = "inputsHash")]
    pub inputs_hash: Option<String>,
    #[serde(rename = "authoredSourceHash")]
    pub authored_source_hash: Option<String>,
    #[serde(rename = "generatedAt")]
    pub generated_at: Option<u64>,
    #[serde(rename = "unsupportedDependencyDiagnostics")]
    pub unsupported_dependency_diagnostics: Vec<PublicDiagnostic>,
    #[serde(
        default,
        rename = "acknowledgedExperimentalCapabilities",
        skip_serializing_if = "Vec::is_empty"
    )]
    #[schemars(default)]
    pub acknowledged_experimental_capabilities: Vec<String>,
    pub functions: Vec<PublicFunctionDefinition>,
    #[serde(rename = "cronJobs")]
    pub cron_jobs: Vec<PublicCronJobDefinition>,
    pub config: Vec<PublicConfigEntryDefinition>,
}

/// Public cron declaration: scheduling posture without its source path.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicCronJobDefinition {
    pub name: String,
    pub schedule: CronSchedule,
    pub action: String,
    pub enabled: bool,
    pub activation: CronActivationPolicy,
    #[serde(rename = "jitterPolicy")]
    pub jitter_policy: CronJitterPolicy,
    #[serde(rename = "overlapPolicy")]
    pub overlap_policy: CronOverlapPolicy,
    #[serde(rename = "retryPolicy")]
    pub retry_policy: CronRetryPolicy,
    #[serde(rename = "requiredCapabilities")]
    pub required_capabilities: Vec<String>,
    #[serde(rename = "targetWakeup")]
    pub target_wakeup: Option<CronTargetWakeup>,
}

/// Public config declaration. Values never ride the manifest; the source span
/// is additionally removed because it reveals local build paths.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicConfigEntryDefinition {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    pub secret: bool,
    pub required: bool,
    pub pool: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe: Option<String>,
    #[serde(rename = "howToGet", skip_serializing_if = "Option::is_none")]
    pub how_to_get: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acquisition: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
}

/// Public projection of [`FunctionDefinition`]: everything except the
/// executable runtime body and the source span.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicFunctionDefinition {
    /// Always present: the validated manifest guarantees a non-empty stable
    /// id, so the public projection never serves a null function identity.
    pub id: String,
    pub name: String,
    #[serde(rename = "exportedName")]
    pub exported_name: Option<String>,
    pub kind: FunctionKind,
    /// Omission is the canonical zero-value encoding and means `false`.
    #[serde(skip_serializing_if = "is_false")]
    #[schemars(default)]
    pub stream: bool,
    #[serde(rename = "handlerForm", skip_serializing_if = "Option::is_none")]
    pub handler_form: Option<String>,
    #[serde(rename = "implementationHash", skip_serializing_if = "Option::is_none")]
    pub implementation_hash: Option<String>,
    #[serde(rename = "argsContractHash", skip_serializing_if = "Option::is_none")]
    pub args_contract_hash: Option<String>,
    /// The declared argument contract (LLP 0131) — a bounded declarative
    /// schema like the result contract, safe on the public projection.
    #[serde(rename = "argsContract", skip_serializing_if = "Option::is_none")]
    pub args_contract: Option<FunctionArgsContract>,
    #[serde(rename = "boundedSkew", skip_serializing_if = "Option::is_none")]
    pub bounded_skew: Option<BoundedSkewDeclaration>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub sequences: Vec<SequenceDeclaration>,
    // @ref LLP 0107#optimistic-mutation-projection — the browser verifies
    // the deployed descriptor as well as its hash before admitting an
    // optimistic reducer. Result contracts are bounded declarative schemas,
    // not executable handler source.
    #[serde(rename = "resultContract")]
    pub result_contract: FunctionResultContract,
    #[serde(rename = "resultContractHash", skip_serializing_if = "Option::is_none")]
    pub result_contract_hash: Option<String>,
    #[serde(rename = "requiredCapabilities")]
    pub required_capabilities: Vec<String>,
    #[serde(rename = "authRequirement")]
    pub auth_requirement: Option<AuthRequirement>,
    #[serde(rename = "apiExposure", skip_serializing_if = "Option::is_none")]
    pub api_exposure: Option<ApiFunctionExposure>,
    #[serde(rename = "authorityIndependent")]
    pub authority_independent: bool,
    /// LLP 0092 §0C.3 disclosure fact — already disclosed by the behavior it
    /// authorizes, so it rides the public projection.
    #[serde(rename = "publicInline", skip_serializing_if = "is_false")]
    pub public_inline: bool,
    /// LLP 0092 §0C.2 derived predicate — never authored; clients key the
    /// alias-key promotion check and token expectations on it.
    #[serde(rename = "rqsEligible", skip_serializing_if = "is_false")]
    pub rqs_eligible: bool,
    #[serde(rename = "authorityCreating", skip_serializing_if = "is_false")]
    pub authority_creating: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub retainable: bool,
    #[serde(rename = "retentionClass", skip_serializing_if = "Option::is_none")]
    pub retention_class: Option<String>,
    /// Omission is the canonical zero-value encoding and means `[]`.
    #[serde(
        rename = "authorizationDependence",
        skip_serializing_if = "Vec::is_empty"
    )]
    #[schemars(default)]
    pub authorization_dependence: Vec<AuthorizationInputDimension>,
    /// Omission is the canonical zero-value encoding and means `[]`.
    #[serde(
        rename = "authorityProfileDependence",
        skip_serializing_if = "Vec::is_empty"
    )]
    #[schemars(default)]
    pub authority_profile_dependence: Vec<AuthorityProfileIdentityV1>,
    #[serde(
        rename = "generatedAuthorityOperation",
        skip_serializing_if = "Option::is_none"
    )]
    pub generated_authority_operation: Option<GeneratedAuthorityOperationV1>,
    #[serde(rename = "syncabilityClass")]
    pub syncability_class: Option<String>,
    #[serde(rename = "readSetSummary")]
    pub read_set_summary: DependencySummary,
    #[serde(rename = "writeSetSummary")]
    pub write_set_summary: DependencySummary,
    #[serde(rename = "permissionEpochBumps")]
    pub permission_epoch_bumps: Vec<PermissionScopeExpr>,
    #[serde(rename = "bundleEntrypoint")]
    pub bundle_entrypoint: Option<String>,
    pub uses: Vec<String>,
    pub runtime: PublicFunctionRuntime,
}

/// Public projection of [`FunctionRuntime`]: the runtime kind (and the export
/// name for Ibex modules) without any executable body.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub enum PublicFunctionRuntime {
    HostPlan(PublicHostPlanKind),
    IbexModule(PublicIbexModule),
}

/// Which host-plan family a redacted `HostPlan` runtime executes.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub enum PublicHostPlanKind {
    Query,
    SearchQuery,
    VectorQuery,
    JobStatusQuery,
    PushLedgerQuery,
    Mutation,
    Action,
    RelationalQuery,
    BoundedChildrenQuery,
    SnapshotBatch,
    SnapshotBatchV2,
    GraphQuery,
    WriteWithActivity,
}

/// Public projection of [`IbexModule`]: the export name, never the source.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicIbexModule {
    pub export: String,
}

impl From<FunctionManifest> for PublicFunctionManifest {
    fn from(manifest: FunctionManifest) -> Self {
        // Exhaustive destructure: a new FunctionManifest field must be
        // classified here, not leak by default.
        let FunctionManifest {
            artifact_kind,
            schema_version,
            app_id,
            bundle_hash,
            inputs_hash,
            authored_source_hash,
            generated_at,
            unsupported_dependency_diagnostics,
            acknowledged_experimental_capabilities,
            functions,
            cron_jobs,
            config,
            // Maintained-projection plans are dropped from the public
            // projection like every HandlerPlan body: they are executable
            // maintenance declarations, not identity/compat facts. A typed
            // public summary can be added deliberately if inspection needs
            // one.
            projections: _,
            // Upload intents never enter the public function projection:
            // an intent is not callable, and its authorizer source is a
            // private artifact like every handler body (LLP 0044; LLP 0108
            // source-custody rules).
            asset_upload_intents: _,
        } = manifest;
        PublicFunctionManifest {
            artifact_kind,
            schema_version,
            app_id,
            bundle_hash,
            inputs_hash,
            authored_source_hash,
            generated_at,
            unsupported_dependency_diagnostics: unsupported_dependency_diagnostics
                .into_iter()
                .map(Into::into)
                .collect(),
            acknowledged_experimental_capabilities,
            functions: functions.into_iter().map(Into::into).collect(),
            cron_jobs: cron_jobs.into_iter().map(Into::into).collect(),
            config: config.into_iter().map(Into::into).collect(),
        }
    }
}

/// Build the one public function projection selected by the schema's
/// disclosure posture. `/inspect` and the server-composed envelope both call
/// this helper so they cannot drift into different inventories.
///
/// @ref LLP 0204#d1--the-exposure-declaration-keystone — exposed-only must
/// govern inspect and the envelope together.
pub fn public_function_manifest_for_schema(
    schema: &SchemaManifest,
    functions: FunctionManifest,
) -> PublicFunctionManifest {
    let mut public = PublicFunctionManifest::from(functions);
    if schema.uses_exposed_only_disclosure() {
        let exposed = public
            .functions
            .iter()
            .filter(|function| {
                function
                    .api_exposure
                    .as_ref()
                    .is_some_and(|exposure| exposure.expose)
            })
            .map(|function| function.name.clone())
            .collect::<BTreeSet<_>>();
        public
            .functions
            .retain(|function| exposed.contains(&function.name));
        public.cron_jobs.retain(|job| exposed.contains(&job.action));
    }
    public
}

impl From<CronJobDefinition> for PublicCronJobDefinition {
    fn from(job: CronJobDefinition) -> Self {
        let CronJobDefinition {
            name,
            schedule,
            action,
            enabled,
            activation,
            jitter_policy,
            overlap_policy,
            retry_policy,
            required_capabilities,
            target_wakeup,
            source_span: _,
        } = job;
        Self {
            name,
            schedule,
            action,
            enabled,
            activation,
            jitter_policy,
            overlap_policy,
            retry_policy,
            required_capabilities,
            target_wakeup,
        }
    }
}

impl From<ConfigEntryDefinition> for PublicConfigEntryDefinition {
    fn from(entry: ConfigEntryDefinition) -> Self {
        let ConfigEntryDefinition {
            name,
            description,
            purpose,
            secret,
            required,
            pool,
            probe,
            how_to_get,
            acquisition,
            default,
            source_span: _,
        } = entry;
        Self {
            name,
            description,
            purpose,
            secret,
            required,
            pool,
            probe,
            how_to_get,
            acquisition,
            default,
        }
    }
}

impl From<FunctionDefinition> for PublicFunctionDefinition {
    fn from(definition: FunctionDefinition) -> Self {
        // Derived before the destructure: the served-manifest `rqsEligible`
        // fact (LLP 0092 §0C.2) is computed, never carried.
        let rqs_eligible = rqs_eligible_digest_kind(&definition).is_some();
        let FunctionDefinition {
            id,
            name,
            exported_name,
            kind,
            stream,
            source_span: _,
            handler_form,
            implementation_hash,
            args_contract_hash,
            args_contract,
            bounded_skew,
            sequences,
            result_contract,
            result_contract_hash,
            // The committed codegen summary is LLP 0231 D5's review surface.
            // Public inspect does not restate this free-text handler claim.
            field_boundary: _,
            elevated_db_capabilities: _,
            required_capabilities,
            auth_requirement,
            api_exposure,
            authority_independent,
            public_inline,
            authority_creating,
            retainable,
            retention_class,
            // Declared app-refusal vocabulary and its tracking subset are
            // private authoring/invocation authority; the public identity
            // descriptor restates neither.
            refusals: _,
            tracked_refusals: _,
            authorization_dependence,
            custom_authorization: _,
            authority_profile_dependence,
            generated_authority_operation,
            syncability_class,
            read_set_summary,
            write_set_summary,
            effect_ceiling: _,
            standard_pattern: _,
            write_policy: _,
            permission_epoch_bumps,
            bundle_entrypoint,
            uses,
            runtime,
            media_command_bindings: _,
        } = definition;
        PublicFunctionDefinition {
            id,
            name,
            exported_name,
            kind,
            stream,
            handler_form,
            implementation_hash,
            args_contract_hash,
            args_contract,
            bounded_skew,
            sequences,
            result_contract,
            result_contract_hash,
            required_capabilities,
            auth_requirement,
            api_exposure,
            authority_independent,
            public_inline,
            rqs_eligible,
            authority_creating,
            retainable,
            retention_class,
            authorization_dependence,
            authority_profile_dependence,
            generated_authority_operation,
            syncability_class,
            read_set_summary,
            write_set_summary,
            permission_epoch_bumps,
            bundle_entrypoint,
            uses,
            runtime: runtime.into(),
        }
    }
}

impl From<FunctionRuntime> for PublicFunctionRuntime {
    fn from(runtime: FunctionRuntime) -> Self {
        match runtime {
            FunctionRuntime::HostPlan(plan) => PublicFunctionRuntime::HostPlan(match plan {
                HandlerPlan::Query(_) => PublicHostPlanKind::Query,
                HandlerPlan::SearchQuery(_) => PublicHostPlanKind::SearchQuery,
                HandlerPlan::VectorQuery(_) => PublicHostPlanKind::VectorQuery,
                HandlerPlan::JobStatusQuery(_) => PublicHostPlanKind::JobStatusQuery,
                HandlerPlan::PushLedgerQuery(_) => PublicHostPlanKind::PushLedgerQuery,
                HandlerPlan::Mutation(_) => PublicHostPlanKind::Mutation,
                HandlerPlan::Action(_) => PublicHostPlanKind::Action,
                // Plan-level kind only: per-row facts stay off the ordinary
                // inspection surface (LLP 0080 §7).
                HandlerPlan::RelationalQuery(_) => PublicHostPlanKind::RelationalQuery,
                HandlerPlan::BoundedChildrenQuery(_) => PublicHostPlanKind::BoundedChildrenQuery,
                HandlerPlan::SnapshotBatch(_) => PublicHostPlanKind::SnapshotBatch,
                HandlerPlan::SnapshotBatchV2(_) => PublicHostPlanKind::SnapshotBatchV2,
                HandlerPlan::GraphQuery(_) => PublicHostPlanKind::GraphQuery,
                HandlerPlan::WriteWithActivity(_) => PublicHostPlanKind::WriteWithActivity,
            }),
            // `source: _` is the redaction this projection exists for.
            FunctionRuntime::IbexModule(IbexModule { source: _, export }) => {
                PublicFunctionRuntime::IbexModule(PublicIbexModule { export })
            }
        }
    }
}

// Host plans are parsed once and then borrowed throughout admission/execution.
// Keeping the wire-shaped variants inline avoids an otherwise pervasive
// allocation contract in this public serde/schema carrier.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum HandlerPlan {
    Query(QueryPlan),
    /// Non-live portable indexed search. The operation uses the ordinary
    /// query envelope while storage projects SearchItemV1 values into rows.
    ///
    /// @ref LLP 0073#rust-owned-artifacts-and-operation-carrier — search is a
    /// Query-kind HostPlan and never gains live semantics by implication.
    SearchQuery(SearchQueryPlanV1),
    /// Non-live exact vector retrieval. The local SQLite target executes this
    /// plan under `vector_search_v1`; other targets refuse at capability
    /// admission until independently qualified.
    ///
    /// @ref LLP 0132#query-surface
    VectorQuery(VectorQueryPlanV1),
    /// The generated declared job-status query (LLP 0121 option 3, decided in
    /// LLP 0070's first slice): a Rust-owned plan serving the privacy-bounded
    /// job lifecycle projection for one job id, live-capable through the
    /// ordinary subscription machinery — a declared operation with an
    /// ordinary contract, never an ambient system table.
    JobStatusQuery(JobStatusQueryPlanV1),
    /// The declared, privacy-bounded LLP 0143 handoff-ledger projection.
    /// It is query-only: receipt upgrades are observed by re-querying rather
    /// than claiming an app-table live-delta contract for protected rows.
    PushLedgerQuery(PushLedgerQueryPlanV1),
    Mutation(MutationPlan),
    Action(ActionPlan),
    // @ref LLP 0080#1-closed-relational-plan — closed bounded-join plan.
    /// The closed bounded-join profile. Callable and `live_replace`-capable
    /// only; targets that cannot execute it report a machine-readable
    /// capability gap before invocation.
    RelationalQuery(RelationalQueryPlan),
    /// Protected one-parent bounded child page.
    BoundedChildrenQuery(BoundedChildrenQueryPlan),
    /// Unpublished static bounded-child tuple. The carrier and admission
    /// analysis exist, but whole-manifest load remains fail-closed until the
    /// exact tuple result contract is owner-pinned; no executor is registered.
    SnapshotBatch(SnapshotBatchPlanV1),
    /// Class-tagged bounded-child/relational tuple using one `sbsb2`
    /// continuation and LLP 0157's unchanged two-arm outer envelope.
    SnapshotBatchV2(SnapshotBatchPlanV2),
    /// Additive graph carrier. Stage B validates and identities this arm but
    /// deliberately registers no executor.
    ///
    /// @ref LLP 0209#25-additive-sibling-carrier-stage-b-plan-not-shipped-surface —
    /// graph_query_v1 is a sibling and does not reinterpret frozen carriers.
    GraphQuery(GraphQueryCarrierV1),
    /// Closed source/scope/activity transaction.
    WriteWithActivity(WriteWithActivityPlan),
}

/// The v1 job-status plan carries no authored parameters: the job id arrives
/// as the invocation's `jobId` argument, the projection shape is Rust-owned,
/// and observability scoping is the operation's own declared auth requirement
/// (knowledge of the opaque job id within that auth class; per-job row policy
/// is a later vocabulary — see the LLP 0070 amendment note).
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct JobStatusQueryPlanV1 {}

/// The v1 push-ledger plan carries no authored parameters. `intentId` is the
/// fixed invocation argument and the complete result/authorization contract
/// is platform-owned.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct PushLedgerQueryPlanV1 {}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct ActionPlan {
    #[serde(default)]
    pub steps: Vec<ActionStep>,
    #[serde(default, rename = "returnValue", alias = "return_value")]
    pub return_value: Option<ActionReturnValue>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ActionStep {
    RunMutation {
        name: String,
        #[serde(default)]
        args: BTreeMap<String, ValueExpr>,
        #[serde(default, rename = "bindResultAs", alias = "bind_result_as")]
        bind_result_as: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ActionReturnValue {
    Literal(Value),
    Binding(String),
    LastMutationResult,
    ChangedCount,
}

/// @ref LLP 0028#cron-job-definition — generated function manifests carry
/// source-authored cron jobs beside query/mutation/action handlers.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronJobDefinition {
    pub name: String,
    pub schedule: CronSchedule,
    pub action: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub activation: CronActivationPolicy,
    #[serde(default, rename = "jitterPolicy", alias = "jitter_policy")]
    pub jitter_policy: CronJitterPolicy,
    #[serde(default, rename = "overlapPolicy", alias = "overlap_policy")]
    pub overlap_policy: CronOverlapPolicy,
    #[serde(default, rename = "retryPolicy", alias = "retry_policy")]
    pub retry_policy: CronRetryPolicy,
    #[serde(
        default,
        rename = "requiredCapabilities",
        alias = "required_capabilities"
    )]
    pub required_capabilities: Vec<String>,
    #[serde(default, rename = "targetWakeup", alias = "target_wakeup")]
    pub target_wakeup: Option<CronTargetWakeup>,
    #[serde(default, rename = "sourceSpan", alias = "source_span")]
    pub source_span: Option<SourceSpan>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronSchedule {
    #[serde(default, rename = "everyMs", alias = "every_ms")]
    pub every_ms: Option<u64>,
    #[serde(default)]
    pub cron: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronActivationPolicy {
    pub kind: CronActivationKind,
    #[serde(default, rename = "whileLive", alias = "while_live")]
    pub while_live: Vec<String>,
}

impl Default for CronActivationPolicy {
    fn default() -> Self {
        Self {
            kind: CronActivationKind::Always,
            while_live: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CronActivationKind {
    Always,
    WhileLive,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronJitterPolicy {
    pub enabled: bool,
    #[serde(rename = "maxOffsetMs", alias = "max_offset_ms")]
    pub max_offset_ms: u64,
}

impl Default for CronJitterPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            max_offset_ms: 0,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CronOverlapPolicy {
    #[default]
    NoOverlap,
    Allow,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronRetryPolicy {
    pub mode: CronRetryMode,
}

impl Default for CronRetryPolicy {
    fn default() -> Self {
        Self {
            mode: CronRetryMode::NextTick,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CronRetryMode {
    NextTick,
    Backoff,
}

/// @ref LLP 0036#declared-configuration-in-the-manifest — one declared config
/// entry: names, purposes, and acquisition metadata are app source (public by
/// construction); values never appear in any manifest.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct ConfigEntryDefinition {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    /// Default **true**: misclassification fails safe — forgetting the flag
    /// makes a value more protected, never less (LLP 0036 D5).
    #[serde(default = "default_true")]
    pub secret: bool,
    #[serde(default = "default_true")]
    pub required: bool,
    /// The entry holds an ordered pool of values rotated across invocations.
    #[serde(default)]
    pub pool: bool,
    /// Name of a declared action that test-calls the value (`config.verify`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub probe: Option<String>,
    #[serde(
        default,
        rename = "howToGet",
        alias = "how_to_get",
        skip_serializing_if = "Option::is_none"
    )]
    pub how_to_get: Option<String>,
    /// Structured, agent-readable acquisition metadata (LLP 0036 D6). The host
    /// carries it verbatim to status/wizard consumers; v1 does not interpret it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acquisition: Option<Value>,
    /// Non-secret entries only; carried for forward compatibility. v1 rejects
    /// non-secret entries at manifest validation, so this is always absent in
    /// an accepted manifest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
    #[serde(default, rename = "sourceSpan", alias = "source_span")]
    pub source_span: Option<SourceSpan>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronTargetWakeup {
    pub kind: CronTargetWakeupKind,
    #[serde(default, rename = "needsDurableRunner", alias = "needs_durable_runner")]
    pub needs_durable_runner: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CronTargetWakeupKind {
    IntervalMs,
    CronExpression,
    DynamicAlarm,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct QueryPlan {
    pub table: String,
    /// Exact schema-derived table policy for ordinary declarative reads.
    /// Public/implicit tables omit it so historical plan bytes are stable.
    #[serde(
        default,
        rename = "tableVisibility",
        alias = "table_visibility",
        skip_serializing_if = "Option::is_none"
    )]
    pub table_visibility: Option<TableVisibilityV1>,
    #[serde(default)]
    pub filters: Vec<FilterExpr>,
    /// Declaration-bound membership semi-joins ANDed onto the field filters —
    /// the first structured-filter IR nodes past single-table filters. Empty
    /// for an ordinary single-table query. Each entry gates the query rows by a
    /// non-recursive membership existence check and contributes an *ordinary*
    /// snapshot-bound capture (never the legacy `Permission` kind) so the
    /// matcher and commit-time read-set validation both wake on membership
    /// writes — including the empty-to-visible direction.
    ///
    /// @ref LLP 0056#what-exists-what-this-adds — the declaration-bound
    ///   membership predicate node, the first step past single-table filters.
    #[serde(
        default,
        rename = "membershipFilters",
        alias = "membership_filters",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub membership_filters: Vec<MembershipPredicate>,
    #[serde(default)]
    pub order: Vec<OrderExpr>,
    pub limit: Option<usize>,
    pub indexed_by: Option<String>,
}

/// The closed, owner-normalized plan carried by the `single_table_v1@1`
/// node identity. This is deliberately distinct from [`QueryPlan`]: the
/// latter remains the ordinary application API, while this record freezes the
/// narrower portable class profile and its explicit-null identity semantics.
///
/// @ref LLP 0004#dated-owner-amendment-single_table_v11-2026-08-03 — exact
///   SingleTablePlanV1 carrier and class-only examined-entry ceiling.
/// @ref LLP 0007#dated-owner-amendment-singletableplanv1-portability-2026-08-03 — closed
///   typed expression grammar, explicit nulls, declaration order, and digest
///   selector semantics.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SingleTablePlanV1 {
    pub format: String,
    pub query: SingleTableQueryV1,
    pub rqs_digest_kind: String,
    pub examined_entry_ceiling: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SingleTableQueryV1 {
    pub table: String,
    pub filters: Vec<SingleTableFilterV1>,
    /// The only admitted value is empty. Keeping it as a typed field rather
    /// than omitting it preserves exact identity and makes a widened producer
    /// fail comparison.
    pub membership_filters: Vec<Value>,
    pub order: Vec<SingleTableOrderV1>,
    pub limit: Option<usize>,
    pub indexed_by: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SingleTableFilterV1 {
    pub field: String,
    pub op: SingleTableFilterOpV1,
    pub value: SingleTableValueExprV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum SingleTableFilterOpV1 {
    Eq,
    In,
    Lt,
    Lte,
    Gt,
    Gte,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SingleTableOrderV1 {
    pub field: String,
    pub direction: OrderDirection,
    pub max_encoded_bytes: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub enum SingleTableValueExprV1 {
    Args,
    Arg(String),
    Binding(String),
    Literal(Value),
    Field {
        base: Box<SingleTableValueExprV1>,
        key: String,
    },
    Binary {
        op: BinaryOp,
        left: Box<SingleTableValueExprV1>,
        right: Box<SingleTableValueExprV1>,
    },
    Unary {
        op: UnaryOp,
        expr: Box<SingleTableValueExprV1>,
    },
    If {
        cond: Box<SingleTableValueExprV1>,
        then: Box<SingleTableValueExprV1>,
        #[serde(rename = "else")]
        r#else: Box<SingleTableValueExprV1>,
    },
    Concat(Vec<SingleTableValueExprV1>),
    Call {
        func: String,
        args: Vec<SingleTableValueExprV1>,
    },
    Record {
        fields: BTreeMap<String, SingleTableValueExprV1>,
    },
}

impl<'de> Deserialize<'de> for SingleTablePlanV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct RawSingleTablePlanV1 {
            format: String,
            query: SingleTableQueryV1,
            rqs_digest_kind: String,
            examined_entry_ceiling: usize,
        }

        fn expression_in_profile(expr: &SingleTableValueExprV1, depth: usize) -> bool {
            if depth > crate::value_expr::MAX_EXPR_DEPTH {
                return false;
            }
            match expr {
                SingleTableValueExprV1::Literal(value) => crate::rqs_contract::jcs(value).is_ok(),
                SingleTableValueExprV1::Field { base, .. } => {
                    expression_in_profile(base, depth + 1)
                }
                SingleTableValueExprV1::Binary { left, right, .. } => {
                    expression_in_profile(left, depth + 1)
                        && expression_in_profile(right, depth + 1)
                }
                SingleTableValueExprV1::Unary { expr, .. } => {
                    expression_in_profile(expr, depth + 1)
                }
                SingleTableValueExprV1::If { cond, then, r#else } => {
                    expression_in_profile(cond, depth + 1)
                        && expression_in_profile(then, depth + 1)
                        && expression_in_profile(r#else, depth + 1)
                }
                SingleTableValueExprV1::Concat(values)
                | SingleTableValueExprV1::Call { args: values, .. } => values
                    .iter()
                    .all(|value| expression_in_profile(value, depth + 1)),
                SingleTableValueExprV1::Record { fields } => fields
                    .values()
                    .all(|value| expression_in_profile(value, depth + 1)),
                SingleTableValueExprV1::Args
                | SingleTableValueExprV1::Arg(_)
                | SingleTableValueExprV1::Binding(_) => true,
            }
        }

        let raw = RawSingleTablePlanV1::deserialize(deserializer)?;
        let expected_digest = if raw.query.order.is_empty() && raw.query.limit.is_none() {
            "mset1"
        } else {
            "seq1"
        };
        let literal_in_items = raw
            .query
            .filters
            .iter()
            .filter(|filter| filter.op == SingleTableFilterOpV1::In)
            .filter_map(|filter| match &filter.value {
                SingleTableValueExprV1::Literal(Value::Array(items)) => Some(items.len()),
                _ => None,
            })
            .sum::<usize>();
        let valid = raw.format == "snapback.single-table-plan.v1"
            && raw.query.membership_filters.is_empty()
            && raw.query.limit.is_none_or(|limit| limit <= QUERY_MAX_LIMIT)
            && raw.query.order.iter().all(|order| {
                order
                    .max_encoded_bytes
                    .is_none_or(|bound| (1..=9_007_199_254_740_991).contains(&bound))
            })
            && raw
                .query
                .filters
                .iter()
                .all(|filter| expression_in_profile(&filter.value, 0))
            && literal_in_items <= QUERY_MAX_IN_ITEMS
            && raw.rqs_digest_kind == expected_digest
            && raw.examined_entry_ceiling == 1_024;
        if !valid {
            return Err(serde::de::Error::custom(
                "SingleTablePlanV1 is outside the closed class profile",
            ));
        }
        Ok(Self {
            format: raw.format,
            query: raw.query,
            rqs_digest_kind: raw.rqs_digest_kind,
            examined_entry_ceiling: raw.examined_entry_ceiling,
        })
    }
}

/// A declaration-bound membership semi-join: the structured-filter IR node the
/// `eventMembers.memberOf(resourceRef)` / `eventMembers.hasRole(resourceRef,
/// …)` rule helpers lower to. There is deliberately **no** global
/// `memberOf`/`hasRole` resolver — two declarations can target the same
/// resource type, and that ambiguity is an authorization bug factory
/// (LLP 0056 §Rule helpers), so every predicate names its declaration.
///
/// Semantics: the predicate holds for the effective principal iff a membership
/// row exists in the bound declaration whose `principal` axis is that
/// principal, whose `resource` axis equals the resolved `resource` reference,
/// and whose `role` is one of the effective roles. A null effective principal
/// (unauthenticated) matches no rows — fail-closed.
///
/// The node is **authoritative-only**: it is evaluated by a non-recursive
/// storage semi-join that deliberately bypasses the membership table's own
/// row-visibility rules (a locked-down roster must not break role evaluation
/// for guests), never by the pure/optimistic `ValueExpr` evaluator — which has
/// no storage and no business consulting membership facts.
///
/// @ref LLP 0056#rule-helpers — declaration-bound; `memberOf` excludes
///   `pendingRoles`; `hasRole` names roles explicitly; `resourceRef` is a row
///   field of the queried table or a query argument of the declared resource
///   type.
/// @ref LLP 0053#agent-auth-protected-query-inputs-amended-2026-07-14-eng-24906 —
///   admitted `DatabaseCaptured` declarative expression kind, snapshot-bound,
///   with the pinned empty-result capture.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipPredicate {
    /// The stable declaration id this predicate binds to
    /// (`MembershipManifest::effective_id`).
    pub declaration: String,
    /// Where the `resource` axis value is read from.
    pub resource: MembershipResourceRef,
    /// The satisfying roles. `None` is `memberOf` — every **non-pending** role
    /// of the declaration. `Some(list)` is `hasRole` with exactly the named
    /// roles (which may name pending roles explicitly).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roles: Option<Vec<String>>,
}

/// Where a [`MembershipPredicate`] reads its `resource` axis value from. Both
/// forms are analyzable at subscribe time; anything else — a computed
/// expression, a different resource type, a join through a third table — is a
/// load-time error (LLP 0056 §Rule helpers).
///
/// @ref LLP 0056#rule-helpers — the two analyzable resource-reference forms.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum MembershipResourceRef {
    /// A column of the queried (primary) table whose type is the declared
    /// resource reference. The per-row semi-join; v1 captures a **conservative
    /// table-level** dependency for it (coarse wake = re-query cost; the
    /// reverse choice would be a correctness loss).
    RowField(String),
    /// A query argument (dotted path) of the declared resource type. The
    /// resource is fixed for the whole query, so v1 captures the fine-grained
    /// `(principal, resource)` index-range dependency, including the
    /// empty-result form.
    Arg {
        /// Dotted query-argument path evaluated at invocation time.
        path: String,
        /// Nominal resource type proven by codegen. Resource-scoped
        /// declarations require their exact `resourceTable`; app-scoped
        /// declarations require `null` and the closed synthetic path. Carrying
        /// this provenance in the installed artifact keeps a hand-written
        /// manifest from silently degrading an `Id<table>` to a bare string.
        #[serde(rename = "resourceTable", alias = "resource_table")]
        resource_table: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct FilterExpr {
    pub field: String,
    pub op: FilterOp,
    pub value: ValueExpr,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum FilterOp {
    Eq,
    In,
    Lt,
    Lte,
    Gt,
    Gte,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct OrderExpr {
    pub field: String,
    pub direction: OrderDirection,
    /// Optional UTF-8 ceiling for a string or application-id order field. The
    /// loader reconciles every occurrence to one value per `(table, field)`
    /// before storage installs it as a central-writer constraint.
    ///
    /// @ref LLP 0157#d8--coordinated-cursor-family-grammar-and-the-llp-0135-seam —
    ///   the snapshot-batch family applies the same schema-level,
    ///   write-enforced bound to string and application-id order values.
    #[serde(
        default,
        rename = "maxEncodedBytes",
        alias = "max_encoded_bytes",
        skip_serializing_if = "Option::is_none"
    )]
    pub max_encoded_bytes: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum OrderDirection {
    Asc,
    Desc,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct MutationPlan {
    #[serde(default)]
    pub steps: Vec<MutationStep>,
    /// Sealed, host-consumed absent dispositions for owner-policy point
    /// writes. The carrier is plan-level so the executor can validate the
    /// complete operation before executing its first step; `step_index`
    /// still binds each fact to exactly one `Patch` or `Delete` site.
    ///
    /// @ref LLP 0264#d4-update-and-delete-check-the-old-row-transactionally
    #[serde(
        default,
        rename = "ownerWriteChecks",
        alias = "owner_write_checks",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub owner_write_checks: Vec<OwnerWriteCheckV1>,
    pub return_value: Option<ReturnValue>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnerWriteCheckV1 {
    pub step_index: usize,
    pub absent: OwnerWriteAbsentDispositionV1,
}

/// The complete public outcome used for every missing-principal, missing-row,
/// malformed-owner, and different-owner leg of one HostPlan point write.
/// `digest` binds the canonical `{code,message,details}` bytes and is checked
/// before the transaction executes any plan step.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum OwnerWriteAbsentDispositionV1 {
    NoEffect,
    Refuse {
        code: String,
        message: String,
        details: Value,
        digest: String,
    },
}

/// The data-tier v1 mutation step set (LLP 0051 D2). Two families:
/// unconditional writes (`Insert`/`Patch`/`Delete`, the original plan forms)
/// and the v1 extension — reads and guards (`Get`/`Guard`/`Let`, evaluated
/// inside the commit transaction with reads captured server-side) plus the
/// two closed set-oriented forms (`DeleteWhere`/`InsertEach`). General
/// iteration, recursion, and data-dependent cross-step control flow stay out
/// of the profile permanently.
// @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation —
//   the v1 step set. (Plain comment: doc text flows into generated schemas.)
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum MutationStep {
    /// Framework-generated collection transaction. No public IR builder
    /// exposes this variant; schema/function pairing authenticates the exact
    /// descriptor before execution.
    /// @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation
    AssetCollection(AssetCollectionMutationPlanV1),
    /// One point-shaped host allocation. It is legal only inside a validated
    /// `write-with-activity.v1` plan, after the exact scope owner guard.
    /// @ref LLP 0135#12-allocation-surfaces
    AllocateSequence {
        counter: String,
        scope: ValueExpr,
        into: String,
    },
    Insert {
        table: String,
        values: BTreeMap<String, ValueExpr>,
        bind_id_as: Option<String>,
    },
    Patch {
        table: String,
        id: ValueExpr,
        values: BTreeMap<String, ValueExpr>,
    },
    Delete {
        table: String,
        id: ValueExpr,
    },
    /// Point read by id, captured into the read-set. Missing is data, not
    /// failure: with `else_error` unset the binding is null (composes with
    /// `coalesce` for the defaulting idiom); with `else_error` set the
    /// mutation fails with that typed code, mirroring `Guard`.
    Get {
        table: String,
        id: ValueExpr,
        bind_as: String,
        else_error: Option<String>,
    },
    /// Truthiness check; failure is the author-supplied typed error code.
    Guard {
        cond: ValueExpr,
        else_error: String,
    },
    /// Host-owned, transaction-local relationship assertion inserted only by
    /// `write-with-activity.v1`. It checks the selected row's required foreign
    /// key and protected stamp against the current active parent incarnation;
    /// missing, cross-scope, and stale-orphan rows collapse to `else_error`.
    AssertCurrentRelation {
        table: String,
        id: ValueExpr,
        scope_table: String,
        scope_id: ValueExpr,
        foreign_key_field: String,
        incarnation_field: String,
        else_error: String,
    },
    /// Bind a computed expression for later steps.
    Let {
        bind_as: String,
        expr: ValueExpr,
    },
    /// Set-oriented delete over one table; the empty filter clears the table.
    /// No more expressive than SQL `DELETE … WHERE`.
    DeleteWhere {
        table: String,
        filter: Vec<FilterExpr>,
    },
    /// One insert per element of an argument-supplied array — a bounded
    /// comprehension (fan-out capped by `MAX_INSERT_EACH_FANOUT`), not a
    /// loop construct. Each value is a `ValueExpr` over `item_as`.
    InsertEach {
        table: String,
        source: ValueExpr,
        item_as: String,
        values: BTreeMap<String, ValueExpr>,
    },
    /// Host-owned assertion inserted only by `write-with-activity.v1`.
    /// Exactly one matching changed source row must already exist in the
    /// provisional transaction; missing/no-op/wrong-source execution refuses
    /// before the activity insert and settlement.
    AssertSourceChanged {
        table: String,
        id: ValueExpr,
        operation: WriteWithActivitySourceOperation,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ReturnValue {
    Literal(Value),
    Binding(String),
    Document {
        table: String,
        id: ValueExpr,
    },
    ChangedCount,
    /// Expression-valued return (with the `Record` constructor this covers
    /// the computed summaries real feed mutations return — LLP 0051 D2).
    Expr(ValueExpr),
}

/// The data-tier v1 expression profile: a closed set — no arrows, no
/// closures, no free calls, no JS method binding — so every evaluator in
/// every language is finite work. Evaluation semantics live in one shared
/// evaluator (`crate::value_expr`) and are pinned by the data-tier corpus.
// @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation —
//   the closed v1 expression profile. (Plain comment: doc text flows into
//   generated schemas.)
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ValueExpr {
    /// Strict arg lookup by dotted path; a missing arg is a typed error.
    Arg(String),
    /// The whole args object — the null-safe base for optional-arg access
    /// via `Field` (missing keys propagate null instead of failing).
    Args,
    AuthUserId,
    /// Effective principal kind in the sealed authorization projection.
    AuthKind,
    /// Actor kind for delegated authority; null for direct and autonomous use.
    AuthActorKind,
    /// Total activity-provenance projection: `human` for sessions and `agent`
    /// for delegated service authority. Unsupported authority classes leave
    /// it absent and the write-with-activity profile refuses.
    AuthActivityActorKind,
    AuthActorUserId,
    AuthGrantId,
    /// Digest of the server-constructed canonical client-mutation identity.
    ClientMutationDigest,
    /// True only when an actor is exercising authority for another principal.
    AuthIsDelegated,
    Binding(String),
    Literal(Value),
    RuntimeId,
    RuntimeNow,
    /// Null-propagating access by arbitrary string key (hyphenated JSON keys
    /// are first-class; settles the IR half of Exact LLP 0329 EQ8).
    Field {
        base: Box<ValueExpr>,
        key: String,
    },
    Binary {
        op: BinaryOp,
        left: Box<ValueExpr>,
        right: Box<ValueExpr>,
    },
    Unary {
        op: UnaryOp,
        expr: Box<ValueExpr>,
    },
    If {
        cond: Box<ValueExpr>,
        then: Box<ValueExpr>,
        #[serde(rename = "else")]
        r#else: Box<ValueExpr>,
    },
    /// String-template lowering: concatenation of stringified parts.
    Concat(Vec<ValueExpr>),
    /// Call into the pinned function library (`value_expr::PINNED_FUNCTIONS`);
    /// anything else fails closed with a typed rejection.
    Call {
        func: String,
        args: Vec<ValueExpr>,
    },
    /// Closed record constructor — the same shape as `Insert`'s values map,
    /// evaluated by the same machinery.
    Record {
        fields: BTreeMap<String, ValueExpr>,
    },
    /// A declaration-bound membership semi-join as a composable boolean
    /// expression kind — the form the `eventMembers.memberOf(...)` /
    /// `hasRole(...)` rule helpers and the `ctx.permissions.<decl>.requireRole`
    /// twin lower to (LLP 0053 §Agent-auth item 1 admits it as a new
    /// declarative IR expression kind).
    ///
    /// It is **authoritative-only**: unlike every other variant it cannot be
    /// answered by the pure `ValueExpr` evaluator, because deciding it requires
    /// a non-recursive storage semi-join over the membership table (bypassing
    /// that table's row-visibility rules). The pure evaluator therefore refuses
    /// it (`SNAPBACK_VALUE_EXPR_AUTHORITATIVE_ONLY`), the query path answers it
    /// through `QueryPlan::membership_filters` / the `ctx.permissions` read, and
    /// the derived optimistic overlay refuses rather than mirrors it — so a
    /// role check is server-decided, never optimistically forged client-side.
    ///
    /// @ref LLP 0056#rule-helpers — the declaration-bound membership predicate.
    MembershipExists(Box<MembershipPredicate>),
}

impl ValueExpr {
    /// A D4 owner-write carrier runs before any plan binding or mutable host
    /// answer exists. Expressions outside this subset would let an earlier
    /// observer decide which row is authorized and therefore refuse
    /// composition rather than becoming an implicit carrier.
    pub fn owner_write_check_preflight_safe(&self) -> bool {
        match self {
            Self::Binding(_) | Self::RuntimeId | Self::MembershipExists(_) => false,
            Self::Field { base, .. } => base.owner_write_check_preflight_safe(),
            Self::Binary { left, right, .. } => {
                left.owner_write_check_preflight_safe() && right.owner_write_check_preflight_safe()
            }
            Self::Unary { expr, .. } => expr.owner_write_check_preflight_safe(),
            Self::If { cond, then, r#else } => {
                cond.owner_write_check_preflight_safe()
                    && then.owner_write_check_preflight_safe()
                    && r#else.owner_write_check_preflight_safe()
            }
            Self::Concat(values) | Self::Call { args: values, .. } => {
                values.iter().all(Self::owner_write_check_preflight_safe)
            }
            Self::Record { fields } => fields.values().all(Self::owner_write_check_preflight_safe),
            Self::Arg(_)
            | Self::Args
            | Self::AuthUserId
            | Self::AuthKind
            | Self::AuthActorKind
            | Self::AuthActivityActorKind
            | Self::AuthActorUserId
            | Self::AuthGrantId
            | Self::ClientMutationDigest
            | Self::AuthIsDelegated
            | Self::Literal(_)
            | Self::RuntimeNow => true,
        }
    }

    fn uses_runtime_id(&self) -> bool {
        match self {
            Self::RuntimeId => true,
            Self::Field { base, .. } => base.uses_runtime_id(),
            Self::Binary { left, right, .. } => left.uses_runtime_id() || right.uses_runtime_id(),
            Self::Unary { expr, .. } => expr.uses_runtime_id(),
            Self::If { cond, then, r#else } => {
                cond.uses_runtime_id() || then.uses_runtime_id() || r#else.uses_runtime_id()
            }
            Self::Concat(values) | Self::Call { args: values, .. } => {
                values.iter().any(Self::uses_runtime_id)
            }
            Self::Record { fields } => fields.values().any(Self::uses_runtime_id),
            Self::Arg(_)
            | Self::Args
            | Self::AuthUserId
            | Self::AuthKind
            | Self::AuthActorKind
            | Self::AuthActivityActorKind
            | Self::AuthActorUserId
            | Self::AuthGrantId
            | Self::ClientMutationDigest
            | Self::AuthIsDelegated
            | Self::Binding(_)
            | Self::Literal(_)
            | Self::RuntimeNow
            | Self::MembershipExists(_) => false,
        }
    }

    fn uses_authoritative_only(&self) -> bool {
        match self {
            Self::MembershipExists(_) => true,
            Self::Field { base, .. } => base.uses_authoritative_only(),
            Self::Binary { left, right, .. } => {
                left.uses_authoritative_only() || right.uses_authoritative_only()
            }
            Self::Unary { expr, .. } => expr.uses_authoritative_only(),
            Self::If { cond, then, r#else } => {
                cond.uses_authoritative_only()
                    || then.uses_authoritative_only()
                    || r#else.uses_authoritative_only()
            }
            Self::Concat(values) | Self::Call { args: values, .. } => {
                values.iter().any(Self::uses_authoritative_only)
            }
            Self::Record { fields } => fields.values().any(Self::uses_authoritative_only),
            Self::Arg(_)
            | Self::Args
            | Self::AuthUserId
            | Self::AuthKind
            | Self::AuthActorKind
            | Self::AuthActivityActorKind
            | Self::AuthActorUserId
            | Self::AuthGrantId
            | Self::ClientMutationDigest
            | Self::AuthIsDelegated
            | Self::Binding(_)
            | Self::Literal(_)
            | Self::RuntimeNow
            | Self::RuntimeId => false,
        }
    }

    pub fn uses_actor_projection(&self) -> bool {
        match self {
            Self::AuthActorKind
            | Self::AuthActivityActorKind
            | Self::AuthActorUserId
            | Self::AuthGrantId
            | Self::AuthIsDelegated => true,
            Self::Field { base, .. } => base.uses_actor_projection(),
            Self::Binary { left, right, .. } => {
                left.uses_actor_projection() || right.uses_actor_projection()
            }
            Self::Unary { expr, .. } => expr.uses_actor_projection(),
            Self::If { cond, then, r#else } => {
                cond.uses_actor_projection()
                    || then.uses_actor_projection()
                    || r#else.uses_actor_projection()
            }
            Self::Concat(values) | Self::Call { args: values, .. } => {
                values.iter().any(Self::uses_actor_projection)
            }
            Self::Record { fields } => fields.values().any(Self::uses_actor_projection),
            Self::Arg(_)
            | Self::Args
            | Self::AuthUserId
            | Self::AuthKind
            | Self::Binding(_)
            | Self::Literal(_)
            | Self::ClientMutationDigest
            | Self::RuntimeId
            | Self::RuntimeNow
            | Self::MembershipExists(_) => false,
        }
    }

    pub fn uses_runtime_intrinsic(&self) -> bool {
        match self {
            Self::RuntimeId | Self::RuntimeNow | Self::ClientMutationDigest => true,
            Self::Field { base, .. } => base.uses_runtime_intrinsic(),
            Self::Binary { left, right, .. } => {
                left.uses_runtime_intrinsic() || right.uses_runtime_intrinsic()
            }
            Self::Unary { expr, .. } => expr.uses_runtime_intrinsic(),
            Self::If { cond, then, r#else } => {
                cond.uses_runtime_intrinsic()
                    || then.uses_runtime_intrinsic()
                    || r#else.uses_runtime_intrinsic()
            }
            Self::Concat(values) | Self::Call { args: values, .. } => {
                values.iter().any(Self::uses_runtime_intrinsic)
            }
            Self::Record { fields } => fields.values().any(Self::uses_runtime_intrinsic),
            Self::Arg(_)
            | Self::Args
            | Self::AuthUserId
            | Self::AuthKind
            | Self::AuthActorKind
            | Self::AuthActivityActorKind
            | Self::AuthActorUserId
            | Self::AuthGrantId
            | Self::AuthIsDelegated
            | Self::Binding(_)
            | Self::Literal(_)
            | Self::MembershipExists(_) => false,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum BinaryOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Eq,
    Ne,
    Lt,
    Lte,
    Gt,
    Gte,
    And,
    Or,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum UnaryOp {
    Not,
    Neg,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct AuthInput {
    pub principal: Option<String>,
    pub session_id: Option<String>,
    pub user_id: Option<String>,
    /// Server-owned declarative-authorization facts. They never deserialize
    /// from or serialize onto the legacy handler input wire.
    #[serde(skip)]
    #[schemars(skip)]
    #[doc(hidden)]
    pub authorization_kind: Option<String>,
    #[serde(skip)]
    #[schemars(skip)]
    #[doc(hidden)]
    pub authorization_actor_kind: Option<String>,
    #[serde(skip)]
    #[schemars(skip)]
    #[doc(hidden)]
    pub authorization_activity_actor_kind: Option<String>,
    #[serde(skip)]
    #[schemars(skip)]
    #[doc(hidden)]
    pub authorization_actor_user_id: Option<String>,
    #[serde(skip)]
    #[schemars(skip)]
    #[doc(hidden)]
    pub authorization_grant_id: Option<String>,
    #[serde(skip)]
    #[schemars(skip)]
    #[doc(hidden)]
    pub client_mutation_id: Option<String>,
    #[serde(skip)]
    #[schemars(skip)]
    #[doc(hidden)]
    pub client_mutation_digest: Option<String>,
    #[serde(skip)]
    #[schemars(skip)]
    #[doc(hidden)]
    pub authorization_is_delegated: bool,
}

impl AuthInput {
    pub fn with_authorization_projection(
        mut self,
        kind: Option<&str>,
        actor_kind: Option<&str>,
        is_delegated: bool,
    ) -> Self {
        self.authorization_kind = kind.map(str::to_owned);
        self.authorization_actor_kind = actor_kind.map(str::to_owned);
        self.authorization_is_delegated = is_delegated;
        self
    }

    pub fn direct_authorization_baseline(&self) -> Option<Self> {
        self.authorization_is_delegated.then(|| {
            let mut direct = self.clone();
            direct.authorization_actor_kind = None;
            direct.authorization_is_delegated = false;
            direct
        })
    }

    pub fn with_activity_provenance(
        mut self,
        actor_user_id: Option<&str>,
        actor_kind: Option<&str>,
        grant_id: Option<&str>,
    ) -> Self {
        self.authorization_actor_user_id = actor_user_id.map(str::to_owned);
        self.authorization_activity_actor_kind = actor_kind.map(str::to_owned);
        self.authorization_grant_id = grant_id.map(str::to_owned);
        self
    }

    pub fn with_client_mutation_settlement(
        mut self,
        id: Option<&str>,
        digest: Option<&str>,
    ) -> Self {
        self.client_mutation_id = id.map(str::to_owned);
        self.client_mutation_digest = digest.map(str::to_owned);
        self
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct HandlerInput {
    #[serde(default)]
    pub args: Value,
    #[serde(default)]
    pub auth: AuthInput,
    #[serde(default)]
    pub read_set: Vec<ReadDependency>,
    /// Opaque adapter-stitched correlation (LLP 0034 §3.2, ENG-22478): the
    /// Exact adapter's join keys (`actionInvocationId`, `optimisticWaveId`,
    /// `rootId`, `bindingIds`) live inside. The provider echoes it verbatim
    /// on receipts and never interprets it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation: Option<Value>,
    /// Replay ledger (LLP 0051 D1): when present, the invocation runs in
    /// REPLAY mode — `ctx.runtime.now()` answers `ledger.now` and every
    /// host-generated id (`ctx.runtime.id()` and `ctx.db.insert` row ids)
    /// consumes `ledger.ids` in order. Consuming past the end is a typed
    /// divergence error. Additive: absent means record mode, today's
    /// behavior. Queries and mutations only; actions never carry one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ctx_ledger: Option<CtxAnswerLedger>,
}

/// Content-derived identity of one coherent schema/function artifact pair.
/// It deliberately excludes the process-local publication counter: callers
/// learn these values from generated artifacts and can refetch them after a
/// deployment race.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactGeneration {
    #[schemars(length(min = 1))]
    pub schema_version: String,
    #[schemars(length(min = 1))]
    pub app_id: String,
    #[schemars(length(min = 1))]
    pub schema_hash: String,
    #[schemars(length(min = 1))]
    pub bundle_hash: String,
    #[schemars(length(min = 1))]
    pub inputs_hash: String,
}

/// Server-derived successful-invocation facts. Keeping the generation under
/// a named `facts` block leaves room for additive call facts without mixing
/// them into handler-owned result values.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FunctionInvocationFacts {
    pub active_generation: ArtifactGeneration,
}

/// Successful query/action wire envelope. The function-owned output remains
/// flattened for compatibility while host-derived attribution and generation
/// facts stay outside that output contract.
#[derive(Clone, Debug, PartialEq, Serialize, schemars::JsonSchema)]
pub struct FunctionResponse<T> {
    #[serde(flatten)]
    pub output: T,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribution: Option<FunctionAttribution>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub facts: Option<FunctionInvocationFacts>,
}

impl<T> FunctionResponse<T> {
    pub fn new(output: T, attribution: Option<FunctionAttribution>) -> Self {
        Self {
            output,
            attribution,
            facts: None,
        }
    }

    pub fn with_facts(
        output: T,
        attribution: Option<FunctionAttribution>,
        facts: Option<FunctionInvocationFacts>,
    ) -> Self {
        Self {
            output,
            attribution,
            facts,
        }
    }
}

/// Ordinary query/action request envelope. The expected generation is kept
/// outside [`HandlerInput`] so nested calls and internal runtime invocations
/// cannot accidentally inherit a caller's transport assertion.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct FunctionCallRequest {
    #[serde(flatten)]
    pub input: HandlerInput,
    /// Anonymous streaming actions bind their private room to an already-open
    /// connection grant. Authenticated callers omit this: their resolved user
    /// or service credential is the reconnect-stable initiator identity.
    ///
    /// @ref LLP 0204#d91--streaming-conversations — anonymous
    /// streams are connection-private rather than bearer-by-room-name.
    #[serde(
        default,
        rename = "streamConnectionId",
        alias = "stream_connection_id",
        skip_serializing_if = "Option::is_none"
    )]
    pub stream_connection_id: Option<String>,
    /// Optional caller assertion checked only by sessions targets. Absence is
    /// the backwards-compatible unchecked path.
    ///
    /// @ref LLP 0012#call-time-generation-binding — selection and generation
    ///   comparison are one server admission operation.
    #[serde(
        default,
        rename = "expectedGeneration",
        alias = "expected_generation",
        skip_serializing_if = "Option::is_none"
    )]
    pub expected_generation: Option<ArtifactGeneration>,
}

/// Ordinary finite-query request. The legacy function-call fields remain
/// flattened; the optional completeness context is query-only and never
/// widens the action request family.
// NOTE: no deny_unknown_fields — serde cannot combine it with the flattened
// legacy request (it would reject the flattened fields themselves), and the
// legacy finite route tolerated unknown members before this amendment.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct FiniteQueryRequest {
    #[serde(flatten)]
    pub request: FunctionCallRequest,
    /// Non-authorizing finite completeness namespace. Old callers omit it and
    /// receive the pre-amendment response shape.
    // @ref LLP 0094#llp-0157-finite-carrier-completeness-amendment--2026-08-04 — finite proofs bind the exact caller-store namespace.
    #[serde(
        default,
        rename = "completenessNamespace",
        skip_serializing_if = "Option::is_none"
    )]
    pub completeness_namespace: Option<crate::auth::invalidation::QueryNamespace>,
    /// Already-held ordered proofs used only to compose a terminal
    /// snapshot-batch page-set manifest. Every entry is signature-verified
    /// before use; the server never treats the array as authority.
    #[serde(
        default,
        rename = "priorCompletenessProofs",
        skip_serializing_if = "Vec::is_empty"
    )]
    #[schemars(length(max = 1024))]
    pub prior_completeness_proofs: Vec<crate::completeness::CompletenessProofV1>,
}

/// Opaque server-issued consistency descriptor for one queued mutation.
/// Possession grants no authority; the invocation gate first resolves a live
/// credential and only then compares this value with its prepared authority.
///
/// @ref LLP 0039#replay-parity-and-the-authority-instance-id — this is a
///   dedicated MutationRequest channel, never a ctx-answer-ledger member.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityDescriptor {
    pub descriptor_version: u32,
    #[schemars(extend("pattern" = crate::ids::ID_WIRE_PATTERN))]
    pub authority_instance_id: String,
    #[schemars(range(max = AUTHORITY_DESCRIPTOR_MAX_SESSION_GENERATION))]
    pub session_generation: u64,
}

/// Highest generation that round-trips exactly through JavaScript's number
/// representation and every generated Snapback client.
pub const AUTHORITY_DESCRIPTOR_MAX_SESSION_GENERATION: u64 = 9_007_199_254_740_991;

/// Settle-time trust policy selected by an ordinary client-attested mutation
/// label. The default preserves the pre-0133 queued replay contract for older
/// request and retained-artifact decoders.
///
/// @ref LLP 0133#the-two-settlement-lanes — the label selects replay acceptance
///   or server re-derivation without granting authority.
#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum SettlementLane {
    #[default]
    ReplayAccept,
    ReDerive,
}

/// Element-1/5 identity facts recorded by a lane-L capture. They are claims,
/// never authority; this substrate binds them into exactly-once identity but
/// leaves mismatch disposition to the tuple owners.
///
/// @ref LLP 0133#what-settlement-consumes-of-the-execution-identity-tuple —
///   implementation and activation identity are retained claims only.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettlementIdentityClaims {
    pub implementation_hash: String,
    pub activation: ArtifactGeneration,
}

/// One locally minted id plus the logical mint identity needed for ticket
/// 04's unmapped-never-guessed pairing.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettlementMintClaim {
    pub claimed: String,
    pub site: String,
    pub occurrence: u32,
}

/// One server-observed HostPlan mint. This is retained inside the exactly-once
/// output so duplicate delivery can reconstruct the same private receipt map;
/// the direct HTTP response exposes only the map, not this internal ledger.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettlementMintObservation {
    pub id: String,
    pub site: String,
    pub occurrence: u32,
}

/// Server-owned observation of the one structurally admitted direct time
/// sink. Retained with exactly-once output so duplicate delivery reconstructs
/// the original disposition even after the function artifact is retired.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettlementTimeObservation {
    pub field: String,
    pub claimed: u64,
    pub authoritative_sample: u64,
    pub skew_ms: u64,
    pub sink_reached: bool,
    pub accepted: bool,
}

fn settlement_claim_set_version() -> u32 {
    1
}

/// Versioned lane-L recorded answers. This is separate from lane Q's shipped
/// positional `ctxLedger`: claims do not become replay authority.
///
/// @ref LLP 0133#divergence-on-settle — mint claims carry site/occurrence so
///   equal counts at different sites can never cross-pair.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettlementClaimSet {
    #[serde(default = "settlement_claim_set_version")]
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(range(max = PORTABLE_TIMESTAMP_MAX_MS))]
    pub now: Option<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[schemars(length(max = CTX_ANSWER_LEDGER_MAX_IDS))]
    pub mints: Vec<SettlementMintClaim>,
}

/// Capture-time identity of one proposed bounded-skew declaration. Ticket 05
/// adds manifest admission and execution semantics; ticket 02 makes changes
/// fail closed under a reused mutation id immediately.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoundedSkewDeclaration {
    pub field: String,
    #[schemars(range(max = PORTABLE_TIMESTAMP_MAX_MS))]
    pub max_skew_ms: u64,
}

/// All LLP 0133 semantics-affecting request facts. Flattening keeps the
/// additions optional on the established mutation envelope; the default
/// preserves the pre-0133 lane-Q identity.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct MutationSettlement {
    #[serde(default, rename = "settlementLane", alias = "settlement_lane")]
    pub lane: SettlementLane,
    #[serde(
        default,
        rename = "settlementIdentity",
        alias = "settlement_identity",
        skip_serializing_if = "Option::is_none"
    )]
    pub identity_claims: Option<SettlementIdentityClaims>,
    #[serde(
        default,
        rename = "settlementClaims",
        alias = "settlement_claims",
        skip_serializing_if = "Option::is_none"
    )]
    pub claims: Option<SettlementClaimSet>,
    #[serde(
        default,
        rename = "boundedSkew",
        alias = "bounded_skew",
        skip_serializing_if = "Option::is_none"
    )]
    pub bounded_skew: Option<BoundedSkewDeclaration>,
}

/// Client-visible mutation request envelope. The idempotency key is mutation
/// only: queries remain server-authoritative reads and are never queued or
/// ledgered as writes (LLP 0043 M1/M2).
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct MutationRequest {
    #[serde(flatten)]
    pub input: HandlerInput,
    /// Closed generated-command carrier. It belongs only to mutations: query,
    /// action, live, and host-input envelopes cannot accidentally admit it.
    #[serde(
        default,
        rename = "mediaCommand",
        alias = "media_command",
        skip_serializing_if = "Option::is_none"
    )]
    pub media_command: Option<MediaCommandInvocationV1>,
    /// Additive settle-time trust facts. Every member joins the durable
    /// exactly-once identity before any fresh lane or activation gate.
    ///
    /// @ref LLP 0133#exactly-once-identity-under-the-new-semantics — changed
    ///   lane, identity claims, declaration, or claim set fails closed.
    #[serde(flatten)]
    pub settlement: MutationSettlement,
    /// Optional generated-artifact assertion; sessions targets compare it
    /// atomically with mutation function selection before any receipt/ACK or
    /// handler effect. Absent remains unchecked.
    #[serde(
        default,
        rename = "expectedGeneration",
        alias = "expected_generation",
        skip_serializing_if = "Option::is_none"
    )]
    pub expected_generation: Option<ArtifactGeneration>,
    /// Exact finite-mutation wire-version offer. A known token opts this
    /// request into the mutation identity requirements carried by that
    /// version; an unknown token refuses, while absence preserves the legacy
    /// optional-identity envelope.
    ///
    /// Unlike connection-scoped calls, an ordinary mutation has no grant
    /// lineage from which it can inherit a negotiated version. The offer is
    /// therefore carried on the mutation itself.
    ///
    /// @ref LLP 0093#mutation-wire-artifact-identity-amendment--2026-08-10 —
    ///   finite writes negotiate identity requiredness on their own carrier.
    #[serde(
        default,
        rename = "wireVersion",
        alias = "wire_version",
        skip_serializing_if = "Option::is_none"
    )]
    pub wire_version: Option<String>,
    /// Durable client-generated identity for exactly-once reconnect replay.
    /// Reusing an id with another function or auth context is rejected.
    #[serde(
        default,
        rename = "clientMutationId",
        alias = "client_mutation_id",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(
        length(min = 1, max = REPLAY_OPAQUE_ID_MAX_BYTES),
        pattern(REPLAY_OPAQUE_ID_PATTERN)
    )]
    pub client_mutation_id: Option<String>,
    /// Authenticated finite-range allocation for this exact operation id.
    /// This extends `clientMutationId`; it is not a second retry identity.
    #[serde(
        default,
        rename = "operationIssuance",
        alias = "operation_issuance",
        skip_serializing_if = "Option::is_none"
    )]
    pub operation_issuance: Option<crate::commit_envelope::OperationIssuanceV1>,
    /// Required whenever `clientMutationId` is present after authority
    /// descriptor protocol v1 is negotiated. It is intentionally outside the
    /// flattened HandlerInput/ctx ledger so client-supplied replay answers can
    /// never become execution authority.
    #[serde(
        default,
        rename = "authorityDescriptor",
        alias = "authority_descriptor",
        skip_serializing_if = "Option::is_none"
    )]
    pub authority_descriptor: Option<AuthorityDescriptor>,
    /// Results the client has durably consumed and removed from its replay
    /// queue. The server may reclaim these settlement payloads only after this
    /// explicit acknowledgement; age alone is not proof that an offline
    /// client cannot redeliver the id.
    #[serde(
        default,
        rename = "acknowledgedClientMutationIds",
        alias = "acknowledged_client_mutation_ids",
        skip_serializing_if = "Vec::is_empty"
    )]
    #[schemars(
        length(max = CLIENT_MUTATION_ACK_MAX_IDS),
        inner(
            length(min = 1, max = REPLAY_OPAQUE_ID_MAX_BYTES),
            pattern(REPLAY_OPAQUE_ID_PATTERN)
        )
    )]
    pub acknowledged_client_mutation_ids: Vec<String>,
}

/// Standalone authenticated settlement acknowledgement. It lives outside the
/// `/mutation/{name}` namespace so an application may still declare a
/// mutation named `acknowledge` (or `ack`) without a route collision.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutationAcknowledgementRequest {
    /// Legacy dev-mode body authority. Session-mode clients authenticate with
    /// the bearer header and deliberately omit this field; the shared
    /// authority gate still rejects any body `auth` presence under sessions.
    // @ref LLP 0058#session-mode-body-closure — sessions use the admitted
    // header authority while legacy dev requests retain their body carrier.
    #[serde(default)]
    pub auth: AuthInput,
    /// Optional exact authority cohort for durable client ACK custody. When
    /// present it is compared before any settlement GC.
    #[serde(
        default,
        rename = "authorityDescriptor",
        alias = "authority_descriptor",
        skip_serializing_if = "Option::is_none"
    )]
    pub authority_descriptor: Option<AuthorityDescriptor>,
    #[schemars(
        length(max = CLIENT_MUTATION_ACK_MAX_IDS),
        inner(
            length(min = 1, max = REPLAY_OPAQUE_ID_MAX_BYTES),
            pattern(REPLAY_OPAQUE_ID_PATTERN)
        )
    )]
    pub client_mutation_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutationAcknowledgementResponse {
    pub acknowledged: u64,
}

/// The ctx-answer ledger (LLP 0051 D1): the ordered answers the deterministic
/// ctx surface gave during one invocation. Record mode produces it; replay
/// mode consumes it. Reads are never ledgered — `ctx.db` reads always
/// re-evaluate against the executing tier's current view; the ledger pins
/// *answers* only. This is LLP 0043 M2's captured replay environment as a
/// defined channel: LLP 0008 pins the client wire to exactly
/// `{generatedIds, now}`; the auth fingerprint is server-retained and never
/// crosses the client wire.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CtxAnswerLedger {
    /// Ledger format version, versioned alongside the shared data-tier
    /// profile (LLP 0051 D5) so pre-extension ledgers stay replayable.
    #[serde(default = "ctx_ledger_version")]
    pub version: u32,
    /// Every host-generated id, in answer order (LLP 0008's `generatedIds`):
    /// `ctx.runtime.id()` answers and `ctx.db.insert` row-id generation share
    /// one ordered sequence.
    #[serde(default)]
    #[schemars(
        length(max = CTX_ANSWER_LEDGER_MAX_IDS),
        inner(
            length(min = 1, max = REPLAY_OPAQUE_ID_MAX_BYTES),
            pattern(REPLAY_OPAQUE_ID_PATTERN)
        )
    )]
    pub ids: Vec<String>,
    /// The frozen invocation clock every `ctx.runtime.now()` answered with.
    #[serde(default)]
    #[schemars(range(max = PORTABLE_TIMESTAMP_MAX_MS))]
    pub now: u64,
    /// Fingerprint of the resolved auth context the handler observed
    /// (LLP 0043 §Auth posture). Checked at replay when present: a mismatch
    /// surfaces `SNAPBACK_AUTH_STALE_RESULT` rather than replaying under new
    /// authority. Server-retained (D1 wire split) — record-mode outputs leave
    /// it unset on client-bound surfaces.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_fingerprint: Option<String>,
}

pub fn ctx_ledger_version() -> u32 {
    CTX_ANSWER_LEDGER_VERSION
}

/// The current ctx-answer ledger format version (LLP 0051 D1/D5).
pub const CTX_ANSWER_LEDGER_VERSION: u32 = 1;

/// Declared invocation-scoped limit row (LLP 0047 §Limits / LLP 0051 D1
/// ledger mechanics): the maximum number of host-generated ids one
/// invocation may record. A handler that calls `ctx.runtime.id()` in a loop
/// gets a typed error (`SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED`), not an
/// unbounded artifact.
pub const CTX_ANSWER_LEDGER_MAX_IDS: usize = 1024;

/// Largest exact non-negative integer carried by the plain-JSON portable
/// profile. Timestamps share the same bound as declared Integer values: every
/// accepted millisecond value must survive JavaScript, SQLite, and hosted
/// targets without aliasing or a signed-storage wrap.
///
/// @ref LLP 0007#data-model — the v0 JSON profile is JavaScript-safe-range
/// bounded on every target.
pub const PORTABLE_TIMESTAMP_MAX_MS: u64 = 9_007_199_254_740_991;

/// Largest exact global storage version in the plain-JSON v0 profile. Commit
/// versions are client cursors and row system fields, so they share the same
/// cross-target integer domain rather than SQLite's wider signed range.
///
/// @ref LLP 0007#data-model — `_version` must round-trip without JavaScript
/// aliasing on every supported target.
pub const PORTABLE_STORAGE_VERSION_MAX: u64 = 9_007_199_254_740_991;

/// Shared wire/storage bound for client mutation ids and captured generated
/// ids. The alphabet makes JSON Schema `maxLength` byte-equivalent to the Rust
/// runtime check and keeps ids safe as opaque SQLite/document keys.
pub const REPLAY_OPAQUE_ID_MAX_BYTES: usize = 256;
pub const REPLAY_OPAQUE_ID_PATTERN: &str = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$";

/// Validate a runtime-owned timestamp before an evaluator or storage adapter
/// can observe it. Keeping this at the shared artifact boundary prevents the
/// HostPlan and Ibex paths from accepting different timestamp domains.
pub fn validate_portable_timestamp_millis(value: u64) -> SnapbackResult<()> {
    if value <= PORTABLE_TIMESTAMP_MAX_MS {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_TIMESTAMP_OUT_OF_RANGE",
        "runtime",
        format!(
            "runtime timestamp {value} is outside the portable millisecond range (maximum: {PORTABLE_TIMESTAMP_MAX_MS})"
        ),
    )
    .with_details(serde_json::json!({
        "value": value,
        "maximum": PORTABLE_TIMESTAMP_MAX_MS,
        "unit": "milliseconds",
    })))
}

/// Validate the complete replay ledger once, before either evaluator begins.
/// The local HostPlan and Ibex implementations deliberately share this gate so
/// format, ids, authority, and time cannot drift across execution tiers.
pub fn validate_ctx_answer_ledger(
    input: &HandlerInput,
) -> SnapbackResult<Option<&CtxAnswerLedger>> {
    let Some(ledger) = input.ctx_ledger.as_ref() else {
        return Ok(None);
    };
    if ledger.version != CTX_ANSWER_LEDGER_VERSION {
        return Err(SnapbackError::error(
            "SNAPBACK_CTX_LEDGER_VERSION_UNSUPPORTED",
            "runtime",
            format!(
                "ctx-answer ledger version {} is not supported (current: {})",
                ledger.version, CTX_ANSWER_LEDGER_VERSION
            ),
        ));
    }
    if ledger.ids.len() > CTX_ANSWER_LEDGER_MAX_IDS {
        return Err(SnapbackError::error(
            "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED",
            "runtime",
            format!(
                "ctx-answer ledger contains {} ids, past the declared bound ({})",
                ledger.ids.len(),
                CTX_ANSWER_LEDGER_MAX_IDS
            ),
        ));
    }
    if let Some((index, _)) = ledger
        .ids
        .iter()
        .enumerate()
        .find(|(_, id)| !replay_opaque_id_is_valid(id))
    {
        return Err(SnapbackError::error(
            "SNAPBACK_CTX_LEDGER_ID_INVALID",
            "runtime",
            format!("ctx-answer ledger id at index {index} is not a valid opaque replay id"),
        ));
    }
    validate_portable_timestamp_millis(ledger.now)?;
    if let Some(recorded) = ledger.auth_fingerprint.as_ref()
        && *recorded != auth_fingerprint(&input.auth)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_STALE_RESULT",
            "runtime",
            "ctx-answer ledger was recorded under a different auth context; refusing to replay under new authority (LLP 0043 §Auth posture)",
        ));
    }
    Ok(Some(ledger))
}

pub fn replay_opaque_id_is_valid(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > REPLAY_OPAQUE_ID_MAX_BYTES {
        return false;
    }
    bytes[0].is_ascii_alphanumeric()
        && bytes[1..]
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

/// Stable cross-language fingerprint of the resolved auth context (LLP 0043
/// §Auth posture). Each optional field is tagged, and each present UTF-8 value
/// is length-delimited before SHA-256, so absent/empty values and adjacent
/// fields cannot collide. This is still a staleness/ownership guard rather
/// than authorization: the server re-evaluates authorization at commit
/// regardless (LLP 0051 D1).
pub fn auth_fingerprint(auth: &AuthInput) -> String {
    let mut hash = Sha256::new();
    hash.update(b"snapback-auth-fingerprint-v1\0");
    for field in [&auth.principal, &auth.session_id, &auth.user_id] {
        match field {
            Some(value) => {
                hash.update([1]);
                hash.update((value.len() as u64).to_be_bytes());
                hash.update(value.as_bytes());
            }
            None => hash.update([0]),
        }
    }
    format!("sha256:{:x}", hash.finalize())
}

/// Fingerprint emitted before the SHA-256 transition. Kept only as a deletion
/// alias: a current client may ACK or an administrator may purge its legacy
/// settlement, but replay never rebinds a 64-bit alias to a new SHA identity
/// because the old row lacks enough canonical auth material to disambiguate a
/// collision safely.
pub fn legacy_auth_fingerprint(auth: &AuthInput) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut eat = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    for field in [&auth.principal, &auth.session_id, &auth.user_id] {
        match field {
            Some(value) => {
                eat(&[1]);
                eat(value.as_bytes());
            }
            None => eat(&[0]),
        }
        eat(&[0xff]);
    }
    format!("fnv1a:{hash:016x}")
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct ReadDependency {
    pub table: String,
    pub id: String,
    #[schemars(range(max = PORTABLE_STORAGE_VERSION_MAX))]
    pub version: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct QueryOutput {
    #[schemars(range(max = PORTABLE_STORAGE_VERSION_MAX))]
    pub version: u64,
    pub rows: Vec<Value>,
    /// Relational continuation cursor (LLP 0080 §2): present exactly when a
    /// `root-window-v1` page consumed its full `take` of authorized roots.
    /// Opaque and versioned; presenting it back as the `cursor` argument
    /// resumes from the last consumed root. Absent for every non-relational
    /// query and for terminal pages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
}

/// Successful ordinary finite-query payload. The established rows/cursor keep
/// their existing flattened wire shape; the proof fields are optional
/// transport metadata admitted by the dated LLP 0093/0094 amendment.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct FiniteQueryOutput {
    #[serde(flatten)]
    pub output: QueryOutput,
    #[serde(
        default,
        rename = "completenessProof",
        skip_serializing_if = "Option::is_none"
    )]
    pub completeness_proof: Option<crate::completeness::CompletenessProofV1>,
    #[serde(
        default,
        rename = "authorizationWitness",
        skip_serializing_if = "Option::is_none"
    )]
    pub authorization_witness: Option<crate::completeness::AuthorizationWitnessRecordV1>,
    #[serde(
        default,
        rename = "pageSetManifest",
        skip_serializing_if = "Option::is_none"
    )]
    pub page_set_manifest: Option<crate::completeness::PageSetManifestV1>,
}

impl FiniteQueryOutput {
    pub fn without_proof(output: QueryOutput) -> Self {
        Self {
            output,
            completeness_proof: None,
            authorization_witness: None,
            page_set_manifest: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct MutationOutput {
    #[schemars(range(max = PORTABLE_STORAGE_VERSION_MAX))]
    pub version: u64,
    pub changed_count: usize,
    pub result: Value,
    /// Durable post-commit authority transitions for a generated
    /// authority-profile mutation. Storage records this beside the exact
    /// settlement so replay reproduces the original receipt; Local strips it
    /// from non-generated mutation responses.
    ///
    /// @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface
    #[serde(
        default,
        rename = "authorityTransitions",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub authority_transitions: Vec<crate::storage::AuthorityTransitionReceiptV1>,
    /// The recorded ctx-answer ledger for this invocation (LLP 0051 D1).
    /// Present for mutations in both executable tiers (record mode records;
    /// replay mode echoes the consumed ledger). HostPlan and Ibex share the
    /// same bounded id/clock contract so queued replay is tier-neutral. The
    /// `auth_fingerprint` member stays unset here — that channel is
    /// server-retained (D1 wire split).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ctx_ledger: Option<CtxAnswerLedger>,
    /// Server-owned logical mint observations retained for lane-L receipt
    /// reconstruction. The public mutation envelope exhaustively strips this
    /// implementation ledger and exposes only its claim-keyed `idMap`.
    ///
    /// @ref LLP 0133#divergence-on-settle — authoritative ids are paired only
    ///   by logical mint identity, never by their ctx-ledger positions.
    #[doc(hidden)]
    #[serde(
        default,
        rename = "_settlementMintObservations",
        skip_serializing_if = "Vec::is_empty"
    )]
    #[schemars(skip)]
    pub settlement_mint_observations: Vec<SettlementMintObservation>,
    /// Private execution fact for reconstructing the field-specific
    /// bounded-skew receipt on exact duplicate delivery.
    #[doc(hidden)]
    #[serde(
        default,
        rename = "_settlementTimeObservation",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(skip)]
    pub settlement_time_observation: Option<SettlementTimeObservation>,
    /// Authority-private sequence receipt facts retained only so an exact
    /// settlement replay can reproduce the first commit's receipt without
    /// re-running the handler or advancing the counter.
    ///
    /// @ref LLP 0135#14-idempotent-re-allocation — replay republishes the
    ///   retained allocation evidence and never performs a second allocation.
    #[doc(hidden)]
    #[serde(
        default,
        rename = "_settlementSequenceAllocations",
        skip_serializing_if = "Vec::is_empty"
    )]
    #[schemars(skip)]
    pub settlement_sequence_allocations: Vec<crate::storage::SequenceAllocationFact>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct SeedData {
    #[serde(default)]
    pub tables: BTreeMap<String, Vec<Map<String, Value>>>,
}

/// A schema/function artifact version understood by the auth-aware receiver.
/// Capability manifests report the dimensions separately for discovery, but
/// [`SupportedArtifactAuthPair`] remains the actual compatibility authority.
#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
pub enum ArtifactVersion {
    #[serde(rename = "snapback.v0")]
    V0,
    #[serde(rename = "snapback.v1")]
    V1,
}

impl ArtifactVersion {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::V0 => SNAPBACK_SCHEMA_VERSION,
            Self::V1 => SNAPBACK_SESSIONS_SCHEMA_VERSION,
        }
    }
}

/// One explicitly supported schema/function-version and auth-mode tuple.
/// Separate version/mode arrays are dimension reports and never imply a
/// Cartesian-product authorization.
///
/// @ref LLP 0058#the-two-admissible-tuples — exactly v0+dev and v1+sessions.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SupportedArtifactAuthPair {
    #[serde(rename = "schemaVersion", alias = "schema_version")]
    pub schema_version: ArtifactVersion,
    #[serde(rename = "authMode", alias = "auth_mode")]
    pub auth_mode: AuthMode,
}

/// The exact target-capability vocabulary understood by paired-v1 manifests.
/// App artifacts retain string fields for v0 compatibility; every v1 string
/// is parsed through this enum before target support is consulted.
///
/// @ref LLP 0058#the-two-admissible-tuples — the v1 registry is closed and
/// LLP 0076 adds the ninth id with an exact positive runtime predicate.
#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
pub enum TargetCapabilityId {
    #[serde(rename = "auth.sessions.v1")]
    AuthSessionsV1,
    #[serde(rename = "bounded_response_stream_v1")]
    BoundedResponseStreamV1,
    #[serde(rename = "bounded_children_v1")]
    BoundedChildrenV1,
    #[serde(rename = "bounded_batch_reads_v1")]
    BoundedBatchReadsV1,
    #[serde(rename = "cron")]
    Cron,
    #[serde(rename = "cron_action_run_mutation")]
    CronActionRunMutation,
    #[serde(rename = "host_plan_runtime")]
    HostPlanRuntime,
    #[serde(rename = "ibex_ctx_db_host_bridge")]
    IbexCtxDbHostBridge,
    #[serde(rename = "inline_handler_v1")]
    InlineHandlerV1,
    /// Transactional one-off durable work, first slice (LLP 0070, Draft):
    /// `ctx.jobs.enqueue` from JS mutations, the paved default queue,
    /// job/attempt receipts, the declared job-status query, and the
    /// injected-clock forced drain. Experimental for as long as LLP 0070 is
    /// Draft — its claim boundary bars any durable-background-work
    /// capability-class claim, and this id asserts current-contract
    /// compatibility only.
    #[serde(rename = "jobs_one_off_v1")]
    JobsOneOffV1,
    #[serde(rename = "notifications.expoPushSeam")]
    ExpoPushSeamV1,
    #[serde(rename = "realtime.connected-client-predicate")]
    ConnectedClientPredicate,
    #[serde(rename = "live_subscriptions")]
    LiveSubscriptions,
    /// The target atomically retains a client-mutation settlement under the
    /// caller's replay-stable id and republishes it on duplicate delivery.
    /// This is the safety prerequisite for a durable client outbox; it is
    /// independent from merely accepting a `clientMutationId` field.
    #[serde(rename = "offline_mutation_replay")]
    OfflineMutationReplay,
    #[serde(rename = "mutation_read_set_validation")]
    MutationReadSetValidation,
    #[serde(rename = "mixed_bundle_boot_v2")]
    MixedBundleBootV2,
    #[serde(rename = "permission_epoch_resync")]
    PermissionEpochResync,
    #[serde(rename = "registered_bundle_boot_v1")]
    RegisteredBundleBootV1,
    #[serde(rename = "relational_query_v1")]
    RelationalQueryV1,
    #[serde(rename = "sequence_allocation_v1")]
    SequenceAllocationV1,
    #[serde(rename = "snapshot_batch_v1")]
    SnapshotBatchV1,
    /// LLP 0157's mixed bounded-child/relational composite. Registration is
    /// experimental and local-only; hosted, remote, and Cloudflare targets
    /// retain explicit gaps until their own executors and evidence land.
    #[serde(rename = "snapshot_batch_v2")]
    SnapshotBatchV2,
    /// LLP 0209 G0 graph-query carrier. The id is reserved while every target
    /// remains unsupported until a later executor stage qualifies it.
    #[serde(rename = "graph_query_v1")]
    GraphQueryV1,
    #[serde(rename = "single_table_v1")]
    SingleTableV1,
    #[serde(rename = "migration_keyset_scan_v1")]
    MigrationKeysetScanV1,
    #[serde(rename = "full_text_search_v1")]
    FullTextSearchV1,
    /// First-page-only live search by bounded coarse re-execution. The id is
    /// registered at experimental maturity but remains unsupported until the
    /// complete LLP 0136 evidence/publication train lands.
    #[serde(rename = "live_full_text_search_v1")]
    LiveFullTextSearchV1,
    /// Exact portable vector search. The local target publishes this at
    /// experimental maturity only when its dedicated implementation fact and
    /// complete closed profile are both present; every other target remains
    /// a structured GAP.
    #[serde(rename = "vector_search_v1")]
    VectorSearchV1,
    #[serde(rename = "result_contract_v1")]
    ResultContractV1,
    /// Typed opaque structured stored values. The implementation carrier is
    /// registered independently from target support so the eventual support
    /// flip remains a separately reviewed LLP 0134 act.
    #[serde(rename = "structured_stored_value_v1")]
    StructuredStoredValueV1,
    #[serde(rename = "settlement.bounded_skew")]
    SettlementBoundedSkew,
    #[serde(rename = "args_contract_v1")]
    ArgsContractV1,
    #[serde(rename = "versioned_seed_install_v1")]
    VersionedSeedInstallV1,
    #[serde(rename = "versioned_seed_reset_v1")]
    VersionedSeedResetV1,
    #[serde(rename = "write_activity_v1")]
    WriteActivityV1,
    #[serde(rename = "asset_lifecycle_v1")]
    AssetLifecycleV1,
    #[serde(rename = "assets.media-ref-projection.v1")]
    MediaRefProjectionV1,
    #[serde(rename = "assets.media-collection.v1")]
    MediaCollectionV1,
    #[serde(rename = "assets.media-command.v1")]
    MediaCommandV1,
    #[serde(rename = "asset_image_finalization_v1")]
    AssetImageFinalizationV1,
    #[serde(rename = "asset_image_pipeline_v1")]
    AssetImagePipelineV1,
    #[serde(rename = "asset_reference_gc_v1")]
    AssetReferenceGcV1,
    #[serde(rename = "asset_video_finalization_v1")]
    AssetVideoFinalizationV1,
    /// Registry identity for the LLP 0162 `agentSafe.v1` extension/component
    /// fact vocabulary. It does not name the `AgentSafeV1` core aggregate and
    /// registration does not imply that any target has passed the corpus.
    #[serde(rename = "agent_safe_storage_v1")]
    AgentSafeStorageV1,
    /// Additive LLP 0158 derived-deployment fork tuple. This identity remains
    /// independent from both the storage extension and in-app branch facts.
    #[serde(rename = "agent_safe_derived_deployment_fork_v1")]
    AgentSafeDerivedDeploymentForkV1,
}

/// The closed maturity vocabulary for registry capability ids (LLP 0058
/// §Capability maturity, amendment 2026-07-24; LLP 0074's no-overclaim rule
/// for Draft authorities).
///
/// - `proposed`: the contract exists in a proposal document but no
///   implementation is registered; a proposed id is never emitted in
///   `supportedCapabilities` at all.
/// - `experimental`: the implementation is registered and the id's positive
///   instance predicate holds, but the governing contract is not Accepted —
///   the entry asserts current-contract compatibility only, and admission
///   refuses requirements on it unless the requiring artifact explicitly
///   acknowledges the experimental contract.
/// - `stable`: the original LLP 0058 reading — positive presence is the
///   plain compatibility assertion.
#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
pub enum CapabilityMaturity {
    #[serde(rename = "proposed")]
    Proposed,
    #[serde(rename = "experimental")]
    Experimental,
    #[serde(rename = "stable")]
    Stable,
}

/// Version-1 auth protocol numbers reported by an auth-aware target.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AuthProtocols {
    pub provider: u32,
    pub invocation: u32,
    #[serde(rename = "stagedMode", alias = "staged_mode")]
    pub staged_mode: u32,
    pub bootstrap: u32,
}

/// Version discriminator for the orthogonal agent-safe storage fact block.
/// This is intentionally independent of [`TargetCapabilityId`]: class facts
/// are multi-valued observations, not boolean support-registry membership.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeCapabilitySchemaVersion {
    #[serde(rename = "agentSafe.v1")]
    V1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeEnvelopeCoverageV1 {
    Missing,
    Covered,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeExplanationDetailV1 {
    Missing,
    DigestOnly,
    BoundedFacts,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeExplanationRetentionV1 {
    Missing,
    EnvelopeBounded,
    PolicyBounded,
}

/// @ref LLP 0158#capability-registry-record — positive derived-fork axes use
/// the exact lower-camel spellings bound by the publication candidate.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeForkEgressV1 {
    Missing,
    #[serde(rename = "denyAll")]
    DenyAll,
    #[serde(rename = "captureOnly")]
    CaptureOnly,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeForkPromotionV1 {
    Missing,
    #[serde(rename = "notPromotable")]
    NotPromotable,
    #[serde(rename = "promotable")]
    Promotable,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeForkBaseV1 {
    Missing,
    #[serde(rename = "currentHead")]
    CurrentHead,
    #[serde(rename = "namedCheckpoint")]
    NamedCheckpoint,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeForkIsolationV1 {
    Missing,
    #[serde(rename = "hostMediated")]
    HostMediated,
    #[serde(rename = "endToEnd")]
    EndToEnd,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeDiffCoverageV1 {
    Missing,
    Exact,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeHistoryClassV1 {
    Missing,
    BoundedChanges,
    NamedCheckpoints,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeProofClassV1 {
    Missing,
    RecordedInventory,
    #[serde(rename = "verifiedCopyFidelity")]
    VerifiedCopyFidelity,
    IndependentBoundaryProof,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeHandlerReplayClassV1 {
    Missing,
    Deterministic,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeActionReplayClassV1 {
    Missing,
    Nondeterministic,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeSchemaEvolutionClassV1 {
    Missing,
    ProofsWithoutLens,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeResourceBoundClassV1 {
    Missing,
    AdmissionAndResourceBounds,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AgentSafeAggregateStateV1 {
    Missing,
    Supported,
}

/// Fixed durable-lane inventory. Specialized lanes remain first-class facts
/// even though their absence does not block the v1 core aggregate.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentSafeEnvelopeCoverageByAdapterV1 {
    pub host_plan: AgentSafeEnvelopeCoverageV1,
    pub ibex_buffered: AgentSafeEnvelopeCoverageV1,
}

/// Exact logical-lane x physical-adapter coverage. The ordinary and Host
/// namespaces each have both execution adapters; collapsing either axis would
/// let one green writer silently stand in for another.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentSafeEnvelopeCoverageByScopeV1 {
    pub ordinary_mutation: AgentSafeEnvelopeCoverageByAdapterV1,
    pub host_child_mutation: AgentSafeEnvelopeCoverageByAdapterV1,
    pub migration: AgentSafeEnvelopeCoverageV1,
    pub durable_background_work: AgentSafeEnvelopeCoverageV1,
    pub push: AgentSafeEnvelopeCoverageV1,
    pub auth: AgentSafeEnvelopeCoverageV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentSafeExplanationClassV1 {
    pub detail: AgentSafeExplanationDetailV1,
    pub retention: AgentSafeExplanationRetentionV1,
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum AgentSafeExplanationLogicalLaneV1 {
    OrdinaryMutation,
    HostChildMutation,
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum AgentSafeExplanationAdapterV1 {
    HostPlan,
    IbexBuffered,
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum AgentSafeExplanationAccessV1 {
    PublicCurrentPolicy,
    Administrative,
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum AgentSafeExplanationProfileV1 {
    GeneratedOwnedCrudOwnerCreateV1,
    GeneratedOwnedCrudOwnerUpdateV1,
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentSafeExplanationScopeV1 {
    pub logical_lane: AgentSafeExplanationLogicalLaneV1,
    pub adapter: AgentSafeExplanationAdapterV1,
    pub access: AgentSafeExplanationAccessV1,
    pub profile: AgentSafeExplanationProfileV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentSafeScopedExplanationFactV1 {
    pub scope: AgentSafeExplanationScopeV1,
    pub class: AgentSafeExplanationClassV1,
}

/// Canonical sparse projection of explanation support. An empty list is the
/// complete Missing projection. Positive entries are strictly scope-sorted,
/// unique, and use only the closed profile/access/execution vocabulary above.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentSafeExplanationFactsV1 {
    pub scoped_facts: Vec<AgentSafeScopedExplanationFactV1>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentSafeForkAxesV1 {
    pub egress: AgentSafeForkEgressV1,
    pub promotion: AgentSafeForkPromotionV1,
    pub base: AgentSafeForkBaseV1,
    pub isolation: AgentSafeForkIsolationV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentSafeForkFactsV1 {
    pub in_app: AgentSafeForkAxesV1,
    pub derived_deployment: AgentSafeForkAxesV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentSafeDiffFactsV1 {
    pub data: AgentSafeDiffCoverageV1,
    pub effects: AgentSafeDiffCoverageV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentSafeReplayFactsV1 {
    pub handlers: AgentSafeHandlerReplayClassV1,
    pub actions: AgentSafeActionReplayClassV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentSafeAggregateFactsV1 {
    pub core: AgentSafeAggregateStateV1,
    pub history: AgentSafeAggregateStateV1,
}

/// One projection of the component and aggregate facts. The target projection
/// reports installed and qualified machinery; `appEffective` separately
/// reports what the current app actually exercises.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentSafeCapabilityFactsV1 {
    pub envelope: AgentSafeEnvelopeCoverageByScopeV1,
    pub explanation: AgentSafeExplanationFactsV1,
    pub forks: AgentSafeForkFactsV1,
    pub diff: AgentSafeDiffFactsV1,
    pub history: AgentSafeHistoryClassV1,
    pub proof: AgentSafeProofClassV1,
    pub replay: AgentSafeReplayFactsV1,
    pub schema_evolution: AgentSafeSchemaEvolutionClassV1,
    pub resource_bounds: AgentSafeResourceBoundClassV1,
    pub aggregate: AgentSafeAggregateFactsV1,
}

/// Rust-owned LLP 0162 §8 capability extension. Its public constructors are
/// deliberately Missing-only until a later digest-bound publication carrier
/// supplies a validated candidate for one named target.
///
/// @ref LLP 0162#8-capability-honesty — target support and app-effective
/// coverage are separate, every class is closed, and specialized lane gaps
/// remain visible without silently widening the core aggregate.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentSafeCapabilityExtensionV1 {
    pub schema_version: AgentSafeCapabilitySchemaVersion,
    pub target: AgentSafeCapabilityFactsV1,
    pub app_effective: AgentSafeCapabilityFactsV1,
}

impl<'de> Deserialize<'de> for AgentSafeCapabilityExtensionV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Wire {
            schema_version: AgentSafeCapabilitySchemaVersion,
            target: AgentSafeCapabilityFactsV1,
            app_effective: AgentSafeCapabilityFactsV1,
        }

        let wire = Wire::deserialize(deserializer)?;
        let extension = Self {
            schema_version: wire.schema_version,
            target: wire.target,
            app_effective: wire.app_effective,
        };
        extension.validate().map_err(serde::de::Error::custom)?;
        Ok(extension)
    }
}

impl Default for AgentSafeCapabilityExtensionV1 {
    fn default() -> Self {
        Self::missing()
    }
}

impl AgentSafeCapabilityExtensionV1 {
    pub fn missing() -> Self {
        Self {
            schema_version: AgentSafeCapabilitySchemaVersion::V1,
            target: AgentSafeCapabilityFactsV1::missing(),
            app_effective: AgentSafeCapabilityFactsV1::missing(),
        }
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        self.target.validate_projection()?;
        self.app_effective.validate_projection()?;
        if !self.app_effective.is_subset_of(&self.target) {
            return Err("appEffective facts exceed target support");
        }
        if self.app_effective.aggregate.core == AgentSafeAggregateStateV1::Supported
            && self.target.aggregate.core != AgentSafeAggregateStateV1::Supported
        {
            return Err("appEffective core aggregate exceeds target support");
        }
        if self.app_effective.aggregate.history == AgentSafeAggregateStateV1::Supported
            && self.target.aggregate.history != AgentSafeAggregateStateV1::Supported
        {
            return Err("appEffective history aggregate exceeds target support");
        }
        Ok(())
    }
}

impl AgentSafeCapabilityFactsV1 {
    pub fn missing() -> Self {
        let fork = || AgentSafeForkAxesV1 {
            egress: AgentSafeForkEgressV1::Missing,
            promotion: AgentSafeForkPromotionV1::Missing,
            base: AgentSafeForkBaseV1::Missing,
            isolation: AgentSafeForkIsolationV1::Missing,
        };
        Self {
            envelope: AgentSafeEnvelopeCoverageByScopeV1 {
                ordinary_mutation: AgentSafeEnvelopeCoverageByAdapterV1 {
                    host_plan: AgentSafeEnvelopeCoverageV1::Missing,
                    ibex_buffered: AgentSafeEnvelopeCoverageV1::Missing,
                },
                host_child_mutation: AgentSafeEnvelopeCoverageByAdapterV1 {
                    host_plan: AgentSafeEnvelopeCoverageV1::Missing,
                    ibex_buffered: AgentSafeEnvelopeCoverageV1::Missing,
                },
                migration: AgentSafeEnvelopeCoverageV1::Missing,
                durable_background_work: AgentSafeEnvelopeCoverageV1::Missing,
                push: AgentSafeEnvelopeCoverageV1::Missing,
                auth: AgentSafeEnvelopeCoverageV1::Missing,
            },
            explanation: AgentSafeExplanationFactsV1 {
                scoped_facts: Vec::new(),
            },
            forks: AgentSafeForkFactsV1 {
                in_app: fork(),
                derived_deployment: fork(),
            },
            diff: AgentSafeDiffFactsV1 {
                data: AgentSafeDiffCoverageV1::Missing,
                effects: AgentSafeDiffCoverageV1::Missing,
            },
            history: AgentSafeHistoryClassV1::Missing,
            proof: AgentSafeProofClassV1::Missing,
            replay: AgentSafeReplayFactsV1 {
                handlers: AgentSafeHandlerReplayClassV1::Missing,
                actions: AgentSafeActionReplayClassV1::Missing,
            },
            schema_evolution: AgentSafeSchemaEvolutionClassV1::Missing,
            resource_bounds: AgentSafeResourceBoundClassV1::Missing,
            aggregate: AgentSafeAggregateFactsV1 {
                core: AgentSafeAggregateStateV1::Missing,
                history: AgentSafeAggregateStateV1::Missing,
            },
        }
    }

    fn validate_projection(&self) -> Result<(), &'static str> {
        let mut prior_scope = None;
        for fact in &self.explanation.scoped_facts {
            if prior_scope.is_some_and(|prior| prior >= fact.scope) {
                return Err("explanation facts must be strictly scope-sorted and unique");
            }
            if fact.class.detail == AgentSafeExplanationDetailV1::Missing
                || fact.class.retention == AgentSafeExplanationRetentionV1::Missing
            {
                return Err("scoped explanation facts must carry positive detail and retention");
            }
            if fact.scope.logical_lane != AgentSafeExplanationLogicalLaneV1::OrdinaryMutation
                || fact.scope.adapter != AgentSafeExplanationAdapterV1::HostPlan
            {
                return Err(
                    "generated owner explanation profiles require ordinaryMutation HostPlan",
                );
            }
            prior_scope = Some(fact.scope);
        }
        for fork in [&self.forks.in_app, &self.forks.derived_deployment] {
            let missing = fork.egress == AgentSafeForkEgressV1::Missing
                && fork.promotion == AgentSafeForkPromotionV1::Missing
                && fork.base == AgentSafeForkBaseV1::Missing
                && fork.isolation == AgentSafeForkIsolationV1::Missing;
            let complete = fork.egress != AgentSafeForkEgressV1::Missing
                && fork.promotion != AgentSafeForkPromotionV1::Missing
                && fork.base != AgentSafeForkBaseV1::Missing
                && fork.isolation != AgentSafeForkIsolationV1::Missing;
            if !missing && !complete {
                return Err("fork facts must be wholly Missing or declare every axis");
            }
            if fork.promotion == AgentSafeForkPromotionV1::Promotable
                && fork.base != AgentSafeForkBaseV1::CurrentHead
            {
                return Err("Promotable forks require currentHead base");
            }
            if fork.promotion == AgentSafeForkPromotionV1::Promotable
                && fork.egress == AgentSafeForkEgressV1::Missing
            {
                return Err("Promotable forks require a declared egress policy");
            }
        }
        if self.aggregate.core == AgentSafeAggregateStateV1::Supported
            || self.aggregate.history == AgentSafeAggregateStateV1::Supported
        {
            return Err("agent-safe aggregates require a separately verified publication carrier");
        }
        Ok(())
    }

    fn is_subset_of(&self, target: &Self) -> bool {
        fn class<T: Copy + PartialEq>(effective: T, target: T, missing: T) -> bool {
            effective == missing || effective == target
        }
        let fork = |effective: &AgentSafeForkAxesV1, target: &AgentSafeForkAxesV1| {
            let missing = effective.egress == AgentSafeForkEgressV1::Missing
                && effective.promotion == AgentSafeForkPromotionV1::Missing
                && effective.base == AgentSafeForkBaseV1::Missing
                && effective.isolation == AgentSafeForkIsolationV1::Missing;
            missing || effective == target
        };
        let envelope = |effective: AgentSafeEnvelopeCoverageV1,
                        target: AgentSafeEnvelopeCoverageV1| {
            class(effective, target, AgentSafeEnvelopeCoverageV1::Missing)
        };

        envelope(
            self.envelope.ordinary_mutation.host_plan,
            target.envelope.ordinary_mutation.host_plan,
        ) && envelope(
            self.envelope.ordinary_mutation.ibex_buffered,
            target.envelope.ordinary_mutation.ibex_buffered,
        ) && envelope(
            self.envelope.host_child_mutation.host_plan,
            target.envelope.host_child_mutation.host_plan,
        ) && envelope(
            self.envelope.host_child_mutation.ibex_buffered,
            target.envelope.host_child_mutation.ibex_buffered,
        ) && envelope(self.envelope.migration, target.envelope.migration)
            && envelope(
                self.envelope.durable_background_work,
                target.envelope.durable_background_work,
            )
            && envelope(self.envelope.push, target.envelope.push)
            && envelope(self.envelope.auth, target.envelope.auth)
            && self.explanation.scoped_facts.iter().all(|fact| {
                target
                    .explanation
                    .scoped_facts
                    .binary_search_by_key(&fact.scope, |candidate| candidate.scope)
                    .ok()
                    .is_some_and(|index| &target.explanation.scoped_facts[index] == fact)
            })
            && fork(&self.forks.in_app, &target.forks.in_app)
            && fork(
                &self.forks.derived_deployment,
                &target.forks.derived_deployment,
            )
            && class(
                self.diff.data,
                target.diff.data,
                AgentSafeDiffCoverageV1::Missing,
            )
            && class(
                self.diff.effects,
                target.diff.effects,
                AgentSafeDiffCoverageV1::Missing,
            )
            && class(
                self.history,
                target.history,
                AgentSafeHistoryClassV1::Missing,
            )
            && class(self.proof, target.proof, AgentSafeProofClassV1::Missing)
            && class(
                self.replay.handlers,
                target.replay.handlers,
                AgentSafeHandlerReplayClassV1::Missing,
            )
            && class(
                self.replay.actions,
                target.replay.actions,
                AgentSafeActionReplayClassV1::Missing,
            )
            && class(
                self.schema_evolution,
                target.schema_evolution,
                AgentSafeSchemaEvolutionClassV1::Missing,
            )
            && class(
                self.resource_bounds,
                target.resource_bounds,
                AgentSafeResourceBoundClassV1::Missing,
            )
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CapabilityManifest {
    #[serde(
        default = "capability_manifest_kind",
        rename = "artifactKind",
        alias = "artifact_kind"
    )]
    pub artifact_kind: String,
    #[serde(
        default = "snapback_schema_version",
        rename = "schemaVersion",
        alias = "schema_version"
    )]
    pub schema_version: String,
    #[serde(rename = "targetProfileId", alias = "target_profile_id")]
    pub target_profile_id: String,
    #[serde(
        default,
        rename = "supportedArtifactVersions",
        alias = "supported_artifact_versions"
    )]
    pub supported_artifact_versions: Vec<ArtifactVersion>,
    #[serde(default, rename = "supportedAuthModes", alias = "supported_auth_modes")]
    pub supported_auth_modes: Vec<AuthMode>,
    #[serde(
        default,
        rename = "supportedArtifactAuthPairs",
        alias = "supported_artifact_auth_pairs"
    )]
    pub supported_artifact_auth_pairs: Vec<SupportedArtifactAuthPair>,
    #[serde(
        default,
        rename = "supportedCapabilities",
        alias = "supported_capabilities"
    )]
    pub supported_capabilities: Vec<TargetCapabilityId>,
    /// Maturity annotations over `supportedCapabilities` (LLP 0058
    /// §Capability maturity, amendment 2026-07-24). Only emitted ids whose
    /// registry maturity is not `stable` appear here; an id absent from this
    /// map is stable, and a manifest omitting the field predates the maturity
    /// dimension. The map is derived from the same closed Rust registry as
    /// `supportedCapabilities` — it is reporting, never accepted as authority
    /// from a posted artifact.
    #[serde(
        default,
        rename = "capabilityMaturity",
        alias = "capability_maturity",
        skip_serializing_if = "BTreeMap::is_empty"
    )]
    pub capability_maturity: BTreeMap<TargetCapabilityId, CapabilityMaturity>,
    /// Versioned LLP 0162 fact projection. This remains present and wholly
    /// `Missing` until a named target passes its component corpus and a later
    /// publication carrier validates and installs the candidate facts.
    #[serde(default, rename = "agentSafe", alias = "agent_safe")]
    pub agent_safe: AgentSafeCapabilityExtensionV1,
    /// Instance-live bootstrap marker for the staged packaged-store
    /// qualification corpus. Absence/false is the only production posture.
    // @ref LLP 0166#public-package-advertisement-amendment--2026-08-06 —
    // qualification mode must be visible so it cannot be mistaken for
    // receipt-backed production authority.
    #[serde(
        default,
        rename = "packagedStoreQualificationMode",
        alias = "packaged_store_qualification_mode",
        skip_serializing_if = "bool_is_false"
    )]
    pub packaged_store_qualification_mode: bool,
    #[serde(
        default,
        rename = "authProtocols",
        alias = "auth_protocols",
        skip_serializing_if = "Option::is_none"
    )]
    pub auth_protocols: Option<AuthProtocols>,
    /// Target-authored deployment and browser-security facts. App artifacts
    /// and operator input may consume this descriptor but cannot assert it.
    ///
    /// @ref LLP 0060#d5-hosted-readiness-is-conjunctive — hosted auth is an
    /// exact conjunction; local loopback and production profile are not facts.
    #[serde(default, rename = "hostedAuth", alias = "hosted_auth")]
    pub hosted_auth: crate::auth::deployment::HostedAuthCapabilities,
    #[serde(rename = "storageEngine", alias = "storage_engine")]
    pub storage_engine: String,
    #[serde(rename = "runtimeEngine", alias = "runtime_engine")]
    pub runtime_engine: String,
    #[serde(rename = "localServerLifecycle", alias = "local_server_lifecycle")]
    pub local_server_lifecycle: bool,
    #[serde(rename = "liveSubscriptions", alias = "live_subscriptions")]
    pub live_subscriptions: bool,
    #[serde(rename = "syncableLiveQueries", alias = "syncable_live_queries")]
    pub syncable_live_queries: bool,
    #[serde(rename = "onlineOnlyQueries", alias = "online_only_queries")]
    pub online_only_queries: bool,
    #[serde(rename = "replaceOnlyQueries", alias = "replace_only_queries")]
    pub replace_only_queries: bool,
    #[serde(default, rename = "ephemeralRealtime", alias = "ephemeral_realtime")]
    pub ephemeral_realtime: bool,
    #[serde(
        default,
        rename = "ephemeralWebSocketPublish",
        alias = "ephemeral_websocket_publish"
    )]
    pub ephemeral_websocket_publish: bool,
    #[serde(
        default,
        rename = "ephemeralLocalRoomAuthority",
        alias = "ephemeral_local_room_authority"
    )]
    pub ephemeral_local_room_authority: bool,
    #[serde(
        default,
        rename = "ephemeralHostedAdapter",
        alias = "ephemeral_hosted_adapter"
    )]
    pub ephemeral_hosted_adapter: bool,
    #[serde(rename = "offlineRetention", alias = "offline_retention")]
    pub offline_retention: bool,
    #[serde(rename = "optimisticReplay", alias = "optimistic_replay")]
    pub optimistic_replay: bool,
    #[serde(rename = "mutationIsolationMode", alias = "mutation_isolation_mode")]
    pub mutation_isolation_mode: String,
    #[serde(rename = "authImpersonation", alias = "auth_impersonation")]
    pub auth_impersonation: bool,
    #[serde(rename = "permissionDiagnostics", alias = "permission_diagnostics")]
    pub permission_diagnostics: bool,
    #[serde(rename = "assetUpload", alias = "asset_upload")]
    pub asset_upload: bool,
    #[serde(rename = "outboundActions", alias = "outbound_actions")]
    pub outbound_actions: bool,
    pub cron: bool,
    pub notifications: bool,
    /// Local Expo integration-seam facts. This is deliberately distinct from
    /// the first-class `notifications` capability owned by LLP 0045.
    /// Presence reports target support; use still requires a session-auth app
    /// declaration and an instance with outbound actions enabled.
    #[serde(
        default,
        rename = "expoPushSeam",
        alias = "expo_push_seam",
        skip_serializing_if = "Option::is_none"
    )]
    pub expo_push_seam: Option<ExpoPushSeamFactsV1>,
    /// Advisory connected-client predicate facts. `single-authority-routing`
    /// means every relevant client act and handler must reach this exact app
    /// authority; multi-instance targets may not infer aggregation from it.
    #[serde(
        default,
        rename = "connectedClientPredicate",
        alias = "connected_client_predicate",
        skip_serializing_if = "Option::is_none"
    )]
    pub connected_client_predicate: Option<ConnectedClientPredicateFactsV2>,
    #[serde(rename = "supportedQueryForms", alias = "supported_query_forms")]
    pub supported_query_forms: Vec<String>,
    #[serde(rename = "portabilityOptOuts", alias = "portability_opt_outs")]
    pub portability_opt_outs: Vec<String>,
    #[serde(rename = "resourceLimits", alias = "resource_limits")]
    pub resource_limits: Vec<ResourceLimit>,
    #[serde(rename = "capabilityGaps", alias = "capability_gaps")]
    pub capability_gaps: Vec<String>,
    /// VM lifecycle for handler execution. Current targets report
    /// `"fresh-per-invocation"`; `"warm-pooled-reset"` remains a recognized
    /// historical value for compatibility with older artifacts. Surfaced so
    /// LLP 0012's honesty rule holds.
    ///
    /// @ref LLP 0009#dk-4-retired--upstream-ibex-owner-thread-contract-2026-07-27 — lifecycle truthfulness.
    #[serde(
        rename = "vmLifecycle",
        alias = "vm_lifecycle",
        default = "vm_lifecycle_fresh"
    )]
    pub vm_lifecycle: String,
    /// Target-computed runtime facts (LLP 0048 §Single-sourced runtime flags,
    /// DK-5 capability truthfulness): the workerd release id, pinned
    /// compatibility date and flags, kill-domain shape, and computed limit
    /// values. Absent on targets that assert their limits statically.
    #[serde(
        default,
        rename = "runtimeFacts",
        alias = "runtime_facts",
        skip_serializing_if = "Option::is_none"
    )]
    pub runtime_facts: Option<Value>,
    /// Migration-executor facts (LLP 0081 §4): the executor profile and
    /// the closed fence lane registry. Present exactly when the target has
    /// a migration executor; absent targets refuse with
    /// `SNAPBACK_MIGRATION_EXECUTOR_UNAVAILABLE`.
    #[serde(default, rename = "migration", skip_serializing_if = "Option::is_none")]
    pub migration: Option<MigrationTargetFacts>,
    /// Relational-query facts (LLP 0080 §4): the live delivery class and
    /// the closed set of admitted retention classes. Present exactly when
    /// the target supports `relational_query_v1`; a target without the
    /// executor reports the capability gap instead.
    #[serde(
        default,
        rename = "relationalQueries",
        alias = "relational_queries",
        skip_serializing_if = "Option::is_none"
    )]
    pub relational_queries: Option<RelationalQueryFacts>,
    /// Generated standard-pattern facts (LLP 0065 §4): live delivery is the
    /// conservative resnapshot, and the `authScopeField`-enabled
    /// disjointness-skip refinement of LLP 0053 is disabled — the field is
    /// invalidation-routing metadata, never a skip enabler or enforcement.
    /// Present exactly when the target runs generated standard patterns.
    #[serde(
        default,
        rename = "standardPatterns",
        alias = "standard_patterns",
        skip_serializing_if = "Option::is_none"
    )]
    pub standard_patterns: Option<StandardPatternFacts>,
    /// Exact local portable-search posture. Absent on Cloudflare,
    /// conformance, and hosted targets until their independent corpus
    /// qualifies.
    #[serde(
        default,
        rename = "fullTextSearch",
        alias = "full_text_search",
        skip_serializing_if = "Option::is_none"
    )]
    pub full_text_search: Option<FullTextSearchFactsV1>,
    /// Closed target-owned facts for LLP 0136 live search. This block is
    /// absent on every current target while `live_full_text_search_v1`
    /// remains unpublished; parent search/live facts are never substituted.
    #[serde(
        default,
        rename = "liveFullTextSearch",
        alias = "live_full_text_search",
        skip_serializing_if = "Option::is_none"
    )]
    pub live_full_text_search: Option<LiveFullTextSearchFactsV1>,
    /// Closed exact-vector facts. Present on the qualified local target and
    /// absent everywhere that reports the structured `vector_search_v1` GAP.
    #[serde(
        default,
        rename = "vectorSearch",
        alias = "vector_search",
        skip_serializing_if = "Option::is_none"
    )]
    pub vector_search: Option<VectorSearchFactsV1>,
    /// Declared asset facts (LLP 0044; LLP 0012 dated registration
    /// 2026-07-31). Presence with a qualified store list is half the
    /// `asset_lifecycle_v1` predicate; absence is the honest Missing report
    /// for targets without the subsystem.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assets: Option<crate::assets::AssetTargetFactsV1>,
    /// The `app-cli.target` eligibility descriptor (LLP 0062 §4; dated LLP
    /// 0058 amendment 2026-08-01). Absence is capability-absent: the engine
    /// refuses credentialed lanes rather than inferring eligibility from a
    /// URL or a correlated capability.
    #[serde(
        default,
        rename = "appCliTarget",
        skip_serializing_if = "Option::is_none"
    )]
    pub app_cli_target: Option<AppCliTargetFactsV1>,
}

/// The exact inspection fact block a future claiming target must publish.
/// Values are target facts, not app-authored authority. The sibling stays
/// absent while support is false, but landing the closed shape now prevents
/// the runtime wave from inventing a looser or backend-specific projection.
///
/// @ref LLP 0136#capability-id-and-claim-discipline-llp-0119-oq2-proposal
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiveFullTextSearchFactsV1 {
    pub capability_id: String,
    pub liveness_scope: String,
    pub wake_granularity: String,
    pub delivery_lane: String,
    pub retention: bool,
    pub resume: bool,
    pub auth_scoped: bool,
    pub max_live_subscriptions: u32,
    pub max_live_subscriptions_per_connection: u32,
    pub max_live_subscriptions_per_table: u32,
}

/// Machine-readable honesty and operating bounds for LLP 0143's local Expo
/// provider seam. These are target facts, not app-supplied declarations.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ExpoPushSeamFactsV1 {
    #[serde(rename = "capabilityId")]
    pub capability_id: String,
    pub surfaces: Vec<String>,
    #[serde(rename = "requiresSessionAuth")]
    pub requires_session_auth: bool,
    #[serde(rename = "requiresOutboundActions")]
    pub requires_outbound_actions: bool,
    #[serde(rename = "productionEndpoint")]
    pub production_endpoint: String,
    #[serde(rename = "localLoopbackTestOverride")]
    pub local_loopback_test_override: bool,
    #[serde(rename = "sendBatchMax")]
    pub send_batch_max: u32,
    #[serde(rename = "maxConcurrentSendAttempts")]
    pub max_concurrent_send_attempts: u16,
    #[serde(rename = "receiptBatchMax")]
    pub receipt_batch_max: u32,
    #[serde(rename = "receiptFirstPollMs")]
    pub receipt_first_poll_ms: u64,
    #[serde(rename = "receiptPollIntervalsMs")]
    pub receipt_poll_intervals_ms: Vec<u64>,
    #[serde(rename = "receiptPollMaxAttempts")]
    pub receipt_poll_max_attempts: u32,
    #[serde(rename = "receiptWindowMs")]
    pub receipt_window_ms: u64,
    #[serde(rename = "registryIdleRetentionMs")]
    pub registry_idle_retention_ms: CapabilityRangeV1,
    #[serde(rename = "ledgerRetentionMs")]
    pub ledger_retention_ms: CapabilityRangeV1,
    #[serde(rename = "pacingClass")]
    pub pacing_class: String,
    #[serde(rename = "adaptivePacing")]
    pub adaptive_pacing: bool,
    #[serde(rename = "neverClaims")]
    pub never_claims: Vec<String>,
}

/// Machine-readable semantics for LLP 0222's advisory connectivity fact.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ConnectedClientPredicateFactsV2 {
    #[serde(rename = "capabilityId")]
    pub capability_id: String,
    #[serde(rename = "semanticsVersion")]
    pub semantics_version: u32,
    #[serde(rename = "freshnessBudgetMs")]
    pub freshness_budget_ms: u64,
    pub transport: Vec<String>,
    #[serde(rename = "authorityScope")]
    pub authority_scope: String,
    #[serde(rename = "aggregationMode")]
    pub aggregation_mode: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CapabilityRangeV1 {
    pub source: String,
    #[serde(rename = "minMs")]
    pub min_ms: u64,
    #[serde(rename = "maxMs")]
    pub max_ms: u64,
}

/// The declared standard-pattern live posture (LLP 0065 §4).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StandardPatternFacts {
    /// Always `"conservative-resnapshot"` in v1: a generated live query
    /// resnapshots on a dependency commit and never claims `live_delta` —
    /// the runtime excludes pattern-identified functions from the delta
    /// lane even when the plan shape would otherwise qualify.
    #[serde(rename = "liveDelivery", alias = "live_delivery")]
    pub live_delivery: String,
    /// Always `"disabled"` in v1: `authScopeField` routes invalidation and
    /// never enables LLP 0053's disjointness-skip refinement, so no
    /// convergence fixture is owed until a future profile claims the skip.
    #[serde(
        rename = "authScopeDisjointnessSkip",
        alias = "auth_scope_disjointness_skip"
    )]
    pub auth_scope_disjointness_skip: String,
}

impl StandardPatternFacts {
    pub fn local_v1() -> Self {
        Self {
            live_delivery: "conservative-resnapshot".to_owned(),
            auth_scope_disjointness_skip: "disabled".to_owned(),
        }
    }
}

/// The migration-executor posture and the closed lane registry the
/// persisted migration fence covers (LLP 0081 §4): a lane the fence does
/// not name cannot be admitted at all, so the registry is a capability
/// fact, not prose.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationTargetFacts {
    /// The executor profile: `"local-exclusive-single-writer"` on the
    /// local target (one IMMEDIATE transaction per durable transition).
    pub executor: String,
    /// The closed, enumerated lane registry the durable fence closes.
    #[serde(rename = "fenceLanes")]
    pub fence_lanes: Vec<String>,
}

impl MigrationTargetFacts {
    pub fn local_v1() -> Self {
        Self {
            executor: "local-exclusive-single-writer".to_owned(),
            fence_lanes: [
                "mutation",
                "buffered-mutation",
                "query",
                "live-subscribe",
                "live-resume",
                "cron",
                "action-stage",
                "ephemeral-publish",
            ]
            .iter()
            .map(|lane| (*lane).to_owned())
            .collect(),
        }
    }
}

/// The declared relational live/retention posture (LLP 0080 §4).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RelationalQueryFacts {
    /// Always `"live_replace"` in v1: relational subscriptions inherit
    /// LLP 0053 with table-granular invalidation and no proved-disjoint
    /// skip, and no incremental delta matcher is admitted.
    #[serde(rename = "liveDelivery", alias = "live_delivery")]
    pub live_delivery: String,
    /// Closed, default-deny retention classes the target admits for
    /// relational plans: `none` (the default) and
    /// `opaque-authorized-snapshot-v1` (the authenticated lease class) and
    /// `result-transform-snapshot-v1` (the owner-reclassified post-gate
    /// class). Both retained classes require owner-visible plans; anonymous
    /// results have no admissible retention.
    pub retention: Vec<String>,
}

impl RelationalQueryFacts {
    pub fn local_v1() -> Self {
        Self {
            live_delivery: "live_replace".to_owned(),
            retention: vec![
                "none".to_owned(),
                "opaque-authorized-snapshot-v1".to_owned(),
                "result-transform-snapshot-v1".to_owned(),
            ],
        }
    }
}

/// The `app-cli.target` eligibility descriptor (LLP 0062 §4; dated LLP 0058
/// amendment 2026-08-01).
///
/// Deliberately a **structured descriptor**, not a ninth entry in the closed
/// `TargetCapabilityId` string set: §4 requires a target to state *which*
/// principal classes it supports, whether it serves envelopes and accepts
/// generation assertions, and the per-grant token cap the engine's admission
/// bound must read rather than hardcode. A boolean could carry none of that.
///
/// Absence is the honest capability-absent report — §4's rule that the engine
/// "never infers any of this from a URL" has teeth only because this fact
/// exists to read. Facts state what the target *supports*; they never prove
/// transport locality, which is why the agent lane's loopback condition stays
/// engine-enforced.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AppCliTargetFactsV1 {
    /// The working capability id this descriptor answers for.
    #[serde(rename = "capabilityId", alias = "capability_id")]
    pub capability_id: String,
    /// Closed principal-class vocabulary this target admits, from §4's
    /// matrix: `anonymous`, `dev`, `session`, `agent`. A class the target
    /// refuses is simply absent — the engine reports the refusal as a target
    /// capability rather than a bug.
    #[serde(rename = "principalClasses", alias = "principal_classes")]
    pub principal_classes: Vec<String>,
    /// Whether the target composes and serves `/app-api/*` envelopes.
    #[serde(rename = "servesEnvelopes", alias = "serves_envelopes")]
    pub serves_envelopes: bool,
    /// Whether the target admits caller-asserted `expectedGeneration`
    /// (LLP 0012's call-time binding).
    #[serde(
        rename = "acceptsGenerationAssertions",
        alias = "accepts_generation_assertions"
    )]
    pub accepts_generation_assertions: bool,
    /// The per-grant live-token cap the engine's cross-process admission
    /// bound reads. `None` where the target admits no agent lane — a
    /// hardcoded copy of LLP 0055's constant would drift silently.
    #[serde(
        rename = "perGrantTokenCap",
        alias = "per_grant_token_cap",
        skip_serializing_if = "Option::is_none"
    )]
    pub per_grant_token_cap: Option<u32>,
}

pub fn vm_lifecycle_fresh() -> String {
    "fresh-per-invocation".to_owned()
}

fn bool_is_false(value: &bool) -> bool {
    !*value
}

pub const VM_LIFECYCLE_WARM_POOLED_RESET: &str = "warm-pooled-reset";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct ResourceLimit {
    pub name: String,
    pub status: ResourceLimitStatus,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ResourceLimitStatus {
    Enforced,
    Advisory,
    Missing,
}

#[cfg(test)]
mod approval_manifest_tests {
    use super::*;

    fn exposure(approval: ApiFunctionApproval, expose: bool) -> ApiFunctionExposure {
        ApiFunctionExposure {
            expose,
            since: None,
            approval: Some(approval),
        }
    }

    fn function(
        name: &str,
        kind: FunctionKind,
        exposure: ApiFunctionExposure,
    ) -> FunctionDefinition {
        let mut function = FunctionDefinition::new(
            name,
            kind,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                owner_write_checks: Vec::new(),
                steps: Vec::new(),
                return_value: None,
            })),
        );
        function.api_exposure = Some(exposure);
        function
    }

    fn schema(name: &str, exposure: ApiFunctionExposure) -> SchemaManifest {
        SchemaManifest {
            api: Some(ApiManifest {
                enabled: true,
                functions: BTreeMap::from([(name.to_owned(), exposure)]),
                ..ApiManifest::default()
            }),
            ..SchemaManifest::default()
        }
    }

    #[test]
    fn approval_requires_exposed_mutation_or_action_in_rust_activation() {
        let hidden = exposure(ApiFunctionApproval::Required, false);
        let error = schema("write", hidden.clone())
            .validate_api_against_functions(&FunctionManifest {
                functions: vec![function("write", FunctionKind::Mutation, hidden)],
                ..FunctionManifest::default()
            })
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_API_APPROVAL_REQUIRES_EXPOSURE"
        );

        let query = exposure(ApiFunctionApproval::External, true);
        let error = schema("read", query.clone())
            .validate_api_against_functions(&FunctionManifest {
                functions: vec![function("read", FunctionKind::Query, query)],
                ..FunctionManifest::default()
            })
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_API_APPROVAL_QUERY_INVALID");

        let mutation = exposure(ApiFunctionApproval::External, true);
        schema("write", mutation.clone())
            .validate_api_against_functions(&FunctionManifest {
                functions: vec![function("write", FunctionKind::Mutation, mutation)],
                ..FunctionManifest::default()
            })
            .expect("an exposed mutation accepts the external approval posture");
    }
}

#[cfg(test)]
mod membership_manifest_grammar_tests {
    use super::*;
    use serde_json::json;

    fn result_contract_function(contract: FunctionResultContract) -> FunctionDefinition {
        let mut function = FunctionDefinition::new(
            "resultContractFixture",
            FunctionKind::Mutation,
            FunctionRuntime::IbexModule(IbexModule {
                source: "globalThis.__snapbackHandlers = {};".to_owned(),
                export: "resultContractFixture".to_owned(),
            }),
        );
        function.result_contract_hash =
            Some(result_contract_hash(&contract).expect("hash fixture contract"));
        function.result_contract = contract;
        function
            .required_capabilities
            .push("result_contract_v1".to_owned());
        function
    }

    #[test]
    fn tracked_refusals_are_a_private_unique_subset_of_declared_refusals() {
        let mut function = result_contract_function(FunctionResultContract::Unknown);
        function.refusals = vec!["INVITE_CONSUMED".to_owned(), "STALE_MOVE".to_owned()];
        function.tracked_refusals = vec!["STALE_MOVE".to_owned()];
        validate_declared_refusals(&function).expect("declared tracked subset validates");

        let serialized = serde_json::to_value(&function).expect("serialize function authority");
        assert_eq!(serialized["trackedRefusals"], json!(["STALE_MOVE"]));
        let public = serde_json::to_value(PublicFunctionDefinition::from(function.clone()))
            .expect("serialize public function projection");
        assert!(public.get("refusals").is_none());
        assert!(public.get("trackedRefusals").is_none());

        function.tracked_refusals = vec!["NOT_DECLARED".to_owned()];
        let undeclared = validate_declared_refusals(&function)
            .expect_err("tracking cannot admit an undeclared app code");
        assert_eq!(
            undeclared.diagnostic.code,
            "SNAPBACK_FUNCTION_TRACKED_REFUSAL_INVALID"
        );
        assert_eq!(
            undeclared.diagnostic.details["reason"],
            "tracked refusal must also be declared"
        );

        function.tracked_refusals = vec!["STALE_MOVE".to_owned(), "STALE_MOVE".to_owned()];
        let duplicate = validate_declared_refusals(&function)
            .expect_err("tracking opt-in is a set, not a multiset");
        assert_eq!(
            duplicate.diagnostic.details["reason"],
            "duplicate tracked refusal"
        );
    }

    #[test]
    fn result_contract_hash_authenticates_the_effective_contract() {
        let mut function = result_contract_function(FunctionResultContract::Value {
            value: ResultValueContract::String { max_bytes: 8 },
        });
        validate_result_contract_definition(&function).expect("matching contract hash");

        function.result_contract = FunctionResultContract::Value {
            value: ResultValueContract::String { max_bytes: 9 },
        };
        let error = validate_result_contract_definition(&function)
            .expect_err("a valid-looking stale hash must not authenticate changed semantics");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID"
        );

        let mut explicit_unknown = result_contract_function(FunctionResultContract::Unknown);
        validate_result_contract_definition(&explicit_unknown)
            .expect("explicit unknown is still a hashed effective contract");
        explicit_unknown.result_contract_hash = None;
        explicit_unknown.required_capabilities.clear();
        validate_result_contract_definition(&explicit_unknown)
            .expect("legacy manifests may omit the result contract identity");
    }

    #[test]
    fn queries_admit_declared_single_value_result_contracts() {
        let mut function = result_contract_function(FunctionResultContract::Value {
            value: ResultValueContract::Object {
                fields: vec![ResultObjectFieldContract {
                    name: "title".to_owned(),
                    required: true,
                    value: ResultValueContract::String { max_bytes: 32 },
                }],
                allow_extra: false,
            },
        });
        function.kind = FunctionKind::LiveQuery;
        validate_result_contract_definition(&function)
            .expect("a live query may declare one scalar object result");
    }

    #[test]
    fn field_boundary_is_an_ibex_query_claim_bound_to_known_result_fields() {
        let mut function = FunctionDefinition::new(
            "liveTally",
            FunctionKind::LiveQuery,
            FunctionRuntime::IbexModule(IbexModule {
                source: "globalThis.__snapbackHandlers = {};".to_owned(),
                export: "liveTally".to_owned(),
            }),
        );
        function.result_contract = FunctionResultContract::Records {
            record: ResultValueContract::Object {
                fields: vec![ResultObjectFieldContract {
                    name: "value".to_owned(),
                    required: true,
                    value: ResultValueContract::Union {
                        variants: vec![
                            ResultValueContract::Null,
                            ResultValueContract::String { max_bytes: 8 },
                        ],
                    },
                }],
                allow_extra: false,
            },
            rows: None,
        };
        function.field_boundary = Some(FieldBoundaryDeclaration {
            fields: vec!["value".to_owned()],
            condition: "round is revealed or caller owns the vote".to_owned(),
        });
        validate_field_boundary(&function).expect("known Ibex query field boundary");

        let serialized = serde_json::to_value(&function).expect("serialize declaration");
        assert_eq!(serialized["fieldBoundary"]["fields"], json!(["value"]));
        let public = serde_json::to_value(PublicFunctionDefinition::from(function.clone()))
            .expect("serialize public projection");
        assert!(
            public.get("fieldBoundary").is_none(),
            "the committed codegen summary, not public inspect, owns the review claim"
        );

        function.field_boundary.as_mut().unwrap().fields = vec!["missing".to_owned()];
        let unknown = validate_field_boundary(&function)
            .expect_err("a checkable result contract refuses unknown boundary fields");
        assert_eq!(
            unknown.diagnostic.code,
            "SNAPBACK_FIELD_BOUNDARY_FIELD_UNKNOWN"
        );

        function.kind = FunctionKind::Action;
        let wrong_kind = validate_field_boundary(&function)
            .expect_err("actions cannot self-declare a field-boundary residual");
        assert_eq!(
            wrong_kind.diagnostic.code,
            "SNAPBACK_FIELD_BOUNDARY_SPEC_INVALID"
        );
    }

    #[test]
    fn elevated_read_capability_is_closed_manifest_authority() {
        let mut function = FunctionDefinition::new(
            "moderate",
            FunctionKind::Mutation,
            FunctionRuntime::IbexModule(IbexModule {
                source: "globalThis.__snapbackHandlers = {};".to_owned(),
                export: "moderate".to_owned(),
            }),
        );
        function.elevated_db_capabilities = vec![ElevatedReadCapabilityV1 {
            form: ElevatedReadFormV1::GetMany,
            tables: ElevatedReadTableCeilingV1::Tables(vec!["messages".to_owned()]),
        }];
        validate_elevated_read_capabilities(&function)
            .expect("named Ibex mutation accepts one closed elevated-read ceiling");
        let serialized = serde_json::to_value(&function).expect("serialize capability");
        assert_eq!(serialized["elevatedDbCapabilities"][0]["form"], "getMany");
        assert_eq!(
            serialized["elevatedDbCapabilities"][0]["tables"],
            json!(["messages"])
        );
        let public = serde_json::to_value(PublicFunctionDefinition::from(function.clone()))
            .expect("serialize public projection");
        assert!(public.get("elevatedDbCapabilities").is_none());

        function.elevated_db_capabilities[0].tables =
            ElevatedReadTableCeilingV1::Opaque("everything".to_owned());
        assert_eq!(
            validate_elevated_read_capabilities(&function)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_ELEVATED_READ_CAPABILITY_UNDECLARED"
        );
    }

    #[test]
    fn result_contract_profile_bounds_and_union_disjointness_are_load_time_authority() {
        let oversized = result_contract_function(FunctionResultContract::Value {
            value: ResultValueContract::String {
                max_bytes: RESULT_CONTRACT_MAX_VALUE_BYTES + 1,
            },
        });
        let error = validate_result_contract_definition(&oversized)
            .expect_err("authored bounds may narrow but never widen the profile");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID"
        );

        let overlapping = result_contract_function(FunctionResultContract::Value {
            value: ResultValueContract::Union {
                variants: vec![
                    ResultValueContract::String { max_bytes: 8 },
                    ResultValueContract::String { max_bytes: 16 },
                ],
            },
        });
        let error = validate_result_contract_definition(&overlapping)
            .expect_err("overlapping unions are not deterministic contracts");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID"
        );
    }

    #[test]
    fn vector_contract_node_keeps_ordinary_array_ceiling_closed_in_both_lanes() {
        let vector = ResultValueContract::Vector { dimensions: 4_096 };
        let function = result_contract_function(FunctionResultContract::Value {
            value: vector.clone(),
        });
        validate_result_contract_definition(&function)
            .expect("the dedicated result vector node admits D=4096");

        let oversized_array = result_contract_function(FunctionResultContract::Value {
            value: ResultValueContract::Array {
                element: Box::new(ResultValueContract::FiniteReal {
                    min: -crate::vector::types::VECTOR_COMPONENT_ABS_MAX,
                    max: crate::vector::types::VECTOR_COMPONENT_ABS_MAX,
                }),
                max_items: RESULT_CONTRACT_MAX_ARRAY_ITEMS + 1,
            },
        });
        assert_eq!(
            validate_result_contract_definition(&oversized_array)
                .expect_err("ordinary result arrays remain capped at 1024")
                .diagnostic
                .code,
            "SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID"
        );

        let mut args_function = result_contract_function(FunctionResultContract::Unknown);
        let args = FunctionArgsContract {
            fields: vec![ResultObjectFieldContract {
                name: "vector".to_owned(),
                required: true,
                value: vector,
            }],
        };
        args_function.args_contract_hash = Some(args_contract_hash(&args).expect("args hash"));
        args_function.args_contract = Some(args);
        args_function
            .required_capabilities
            .push("args_contract_v1".to_owned());
        validate_args_contract_definition(&args_function)
            .expect("the dedicated args vector node admits D=4096");

        let oversized_args = FunctionArgsContract {
            fields: vec![ResultObjectFieldContract {
                name: "values".to_owned(),
                required: true,
                value: ResultValueContract::Array {
                    element: Box::new(ResultValueContract::Boolean),
                    max_items: RESULT_CONTRACT_MAX_ARRAY_ITEMS + 1,
                },
            }],
        };
        args_function.args_contract_hash =
            Some(args_contract_hash(&oversized_args).expect("oversized args hash"));
        args_function.args_contract = Some(oversized_args);
        assert_eq!(
            validate_args_contract_definition(&args_function)
                .expect_err("ordinary argument arrays remain capped at 1024")
                .diagnostic
                .code,
            "SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID"
        );
    }

    fn vector_index_fixture() -> (TableManifest, VectorIndexManifestV1) {
        let table = TableManifest {
            name: "documents".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "embedding".to_owned(),
                    field_type: FieldType::Vector { dimensions: 3 },
                    optional: false,
                },
                FieldManifest {
                    name: "category".to_owned(),
                    field_type: FieldType::String,
                    optional: true,
                },
                FieldManifest {
                    name: "title".to_owned(),
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
            visibility: None,
            history: None,
        };
        let index = VectorIndexManifestV1 {
            format_version: 1,
            name: "by_embedding".to_owned(),
            semantic_version: "documents.embedding.v1".to_owned(),
            vector_field: "embedding".to_owned(),
            dimensions: 3,
            metric: VectorMetricV1::L2sq,
            distance_profile: crate::vector::types::VECTOR_DISTANCE_PROFILE_ID.to_owned(),
            ordering_profile: crate::vector::types::VECTOR_ORDERING_PROFILE_ID.to_owned(),
            field_classifications: BTreeMap::from([
                ("category".to_owned(), VectorFieldClassV1::Public),
                ("embedding".to_owned(), VectorFieldClassV1::Public),
                ("title".to_owned(), VectorFieldClassV1::Public),
            ]),
            equality_filters: vec!["category".to_owned()],
            stored_fields: vec!["title".to_owned()],
            visibility: VectorVisibilityV1::PublicRead,
            tie_break: crate::vector::types::VectorTieBreakV1::IdAsc,
            max_indexed_vectors_per_partition: 128,
            max_scalar_pairs: 384,
            maintenance_limits: VectorMaintenanceLimitsV1::default(),
        };
        (table, index)
    }

    #[test]
    fn vector_index_load_reproves_derived_fixed_and_projection_fields() {
        let (table, index) = vector_index_fixture();
        validate_vector_index_manifest(&table, &index)
            .expect("optional equality source fields are admitted");

        let mut principal_table = table.clone();
        principal_table
            .fields
            .iter_mut()
            .find(|field| field.name == "category")
            .unwrap()
            .field_type = FieldType::Principal;
        validate_vector_index_manifest(&principal_table, &index)
            .expect("nominal string-like equality fields inherit LLP 0080 exact semantics");
        let mut real_table = table.clone();
        real_table
            .fields
            .iter_mut()
            .find(|field| field.name == "category")
            .unwrap()
            .field_type = FieldType::Real;
        assert_eq!(
            validate_vector_index_manifest(&real_table, &index)
                .expect_err("floating-point equality is outside LLP 0080's closed scalar set")
                .diagnostic
                .code,
            "SNAPBACK_VECTOR_INDEX_INVALID"
        );

        let args = expected_vector_args_contract(&index);
        let filters = args
            .fields
            .iter()
            .find(|field| field.name == "filters")
            .expect("declared equality filters produce an argument field");
        let ResultValueContract::Array { element, .. } = &filters.value else {
            panic!("filters must be a bounded array");
        };
        let ResultValueContract::Object { fields, .. } = element.as_ref() else {
            panic!("filters must contain closed records");
        };
        assert_eq!(
            &fields
                .iter()
                .find(|field| field.name == "field")
                .unwrap()
                .value,
            &ResultValueContract::Literal {
                value: json!("category")
            }
        );
        let mut no_filters = index.clone();
        no_filters.equality_filters.clear();
        assert!(
            expected_vector_args_contract(&no_filters)
                .fields
                .iter()
                .all(|field| field.name != "filters"),
            "an index with no equality filters must expose no filter argument"
        );

        let mut omitted_maintenance = serde_json::to_value(&index).unwrap();
        omitted_maintenance
            .as_object_mut()
            .unwrap()
            .remove("maintenanceLimits");
        assert!(
            serde_json::from_value::<VectorIndexManifestV1>(omitted_maintenance).is_err(),
            "the fixed v1 maintenance identity is required at manifest load"
        );

        let mut forged_pairs = index.clone();
        forged_pairs.max_scalar_pairs += 1;
        assert_eq!(
            validate_vector_index_manifest(&table, &forged_pairs)
                .expect_err("maxScalarPairs is derived, never authored authority")
                .diagnostic
                .code,
            "SNAPBACK_VECTOR_INDEX_INVALID"
        );

        let mut forged_maintenance = index.clone();
        forged_maintenance.maintenance_limits.vector_bytes -= 1;
        assert_eq!(
            validate_vector_index_manifest(&table, &forged_maintenance)
                .expect_err("maintenance ceilings are fixed")
                .diagnostic
                .code,
            "SNAPBACK_VECTOR_INDEX_INVALID"
        );

        let mut leaked_vector = index;
        leaked_vector.stored_fields = vec!["embedding".to_owned()];
        leaked_vector.field_classifications.remove("title");
        assert_eq!(
            validate_vector_index_manifest(&table, &leaked_vector)
                .expect_err("storedFields categorically refuse vectors")
                .diagnostic
                .code,
            "SNAPBACK_VECTOR_INDEX_INVALID"
        );
    }

    fn snapshot_node_fixture(
        parent_id_arg: &str,
        visibility: BoundedParentVisibility,
        take: u32,
    ) -> BoundedChildrenQueryPlan {
        BoundedChildrenQueryPlan {
            profile: "bounded-children.v1".to_owned(),
            required_capability: "bounded_children_v1".to_owned(),
            parent_table: "boards".to_owned(),
            parent_id_arg: parent_id_arg.to_owned(),
            parent_visibility: visibility,
            parent_table_visibility: None,
            parent_projection: vec![BoundedProjectionField {
                name: "id".to_owned(),
                field: "_id".to_owned(),
            }],
            child_table: "cards".to_owned(),
            child_table_visibility: None,
            child_foreign_key: "boardId".to_owned(),
            child_relation_incarnation: "boardIncarnation".to_owned(),
            child_index: "by_board_position".to_owned(),
            order: vec![OrderExpr {
                field: "position".to_owned(),
                direction: OrderDirection::Asc,
                max_encoded_bytes: None,
            }],
            take,
            child_projection: vec![
                BoundedProjectionField {
                    name: "id".to_owned(),
                    field: "_id".to_owned(),
                },
                BoundedProjectionField {
                    name: "position".to_owned(),
                    field: "position".to_owned(),
                },
            ],
            parent_deletion: "hide-orphans.v1".to_owned(),
        }
    }

    fn snapshot_function_fixture(plan: SnapshotBatchPlanV1) -> FunctionDefinition {
        let mut parent_arguments = plan
            .nodes
            .iter()
            .map(|node| (node.parent_id_arg.clone(), node.parent_table.clone()))
            .collect::<BTreeMap<_, _>>()
            .into_iter()
            .map(|(name, table)| ResultObjectFieldContract {
                name,
                required: true,
                value: ResultValueContract::Id { table },
            })
            .collect::<Vec<_>>();
        parent_arguments.push(ResultObjectFieldContract {
            name: "cursor".to_owned(),
            required: false,
            value: ResultValueContract::String { max_bytes: 8_192 },
        });
        let args_contract = FunctionArgsContract {
            fields: parent_arguments,
        };
        let outer = |kind: &str, nodes: ResultValueContract, continuation: ResultValueContract| {
            ResultValueContract::Object {
                fields: vec![
                    ResultObjectFieldContract {
                        name: "kind".to_owned(),
                        required: true,
                        value: ResultValueContract::Literal { value: json!(kind) },
                    },
                    ResultObjectFieldContract {
                        name: "nodes".to_owned(),
                        required: true,
                        value: nodes,
                    },
                    ResultObjectFieldContract {
                        name: "continuation".to_owned(),
                        required: true,
                        value: continuation,
                    },
                ],
                allow_extra: false,
            }
        };
        let page = || ResultValueContract::Object {
            fields: vec![
                ResultObjectFieldContract {
                    name: "parent".to_owned(),
                    required: true,
                    value: ResultValueContract::Json {
                        max_depth: 16,
                        max_bytes: 1_048_576,
                    },
                },
                ResultObjectFieldContract {
                    name: "children".to_owned(),
                    required: true,
                    value: ResultValueContract::Array {
                        element: Box::new(ResultValueContract::Json {
                            max_depth: 16,
                            max_bytes: 1_048_576,
                        }),
                        max_items: 1_024,
                    },
                },
            ],
            allow_extra: false,
        };
        let result_contract = FunctionResultContract::Records {
            record: ResultValueContract::Union {
                variants: vec![
                    outer(
                        "absent",
                        ResultValueContract::Null,
                        ResultValueContract::Null,
                    ),
                    outer(
                        "visible",
                        ResultValueContract::Tuple {
                            elements: (0..plan.nodes.len()).map(|_| page()).collect(),
                        },
                        ResultValueContract::Union {
                            variants: vec![
                                ResultValueContract::Null,
                                ResultValueContract::String { max_bytes: 8_192 },
                            ],
                        },
                    ),
                ],
            },
            rows: Some(ResultRowsBound {
                min_items: 1,
                max_items: 1,
            }),
        };
        let mut function = FunctionDefinition::new(
            "boardView",
            FunctionKind::Query,
            FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatch(plan)),
        );
        function.args_contract_hash = Some(args_contract_hash(&args_contract).expect("args hash"));
        function.args_contract = Some(args_contract);
        function.result_contract_hash =
            Some(result_contract_hash(&result_contract).expect("result hash"));
        function.result_contract = result_contract;
        function.required_capabilities = vec![
            "snapshot_batch_v1".to_owned(),
            "bounded_children_v1".to_owned(),
            "args_contract_v1".to_owned(),
            "result_contract_v1".to_owned(),
        ];
        let identity = {
            let FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatch(plan)) = &function.runtime
            else {
                unreachable!("snapshot fixture")
            };
            snapshot_batch_identity_v1(&function, plan).expect("snapshot identity")
        };
        let FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatch(plan)) = &mut function.runtime
        else {
            unreachable!("snapshot fixture")
        };
        plan.normalized_composite_plan = identity.normalized_composite_plan;
        plan.plan_hash = identity.plan_hash;
        function
    }

    fn snapshot_v2_relational_node_fixture(take: u32) -> RelationalQueryPlan {
        RelationalQueryPlan {
            root: "events".to_owned(),
            root_alias: "event".to_owned(),
            joined: "actors".to_owned(),
            joined_alias: "actor".to_owned(),
            join_kind: JoinKind::Left,
            join_on: vec![JoinEquality {
                root_field: "actorId".to_owned(),
                joined_field: "id".to_owned(),
            }],
            root_filters: Vec::new(),
            root_visibility: Vec::new(),
            root_table_visibility: None,
            joined_visibility: Vec::new(),
            joined_table_visibility: None,
            projection: vec![ProjectionLeaf {
                name: "title".to_owned(),
                source: ProjectionSource::RootField("title".to_owned()),
            }],
            order: vec![OrderExpr {
                field: "createdAt".to_owned(),
                direction: OrderDirection::Asc,
                max_encoded_bytes: None,
            }],
            take,
            root_index: "by_created_at".to_owned(),
            joined_index: "by_id".to_owned(),
        }
    }

    fn snapshot_v2_function_fixture(plan: SnapshotBatchPlanV2) -> FunctionDefinition {
        let mut arguments = plan
            .nodes
            .iter()
            .filter_map(|node| match node {
                SnapshotBatchNodeV2::BoundedChildren(node) => {
                    Some((node.parent_id_arg.clone(), node.parent_table.clone()))
                }
                SnapshotBatchNodeV2::RelationalQuery(_) => None,
            })
            .collect::<BTreeMap<_, _>>()
            .into_iter()
            .map(|(name, table)| ResultObjectFieldContract {
                name,
                required: true,
                value: ResultValueContract::Id { table },
            })
            .collect::<Vec<_>>();
        arguments.push(ResultObjectFieldContract {
            name: "cursor".to_owned(),
            required: false,
            value: ResultValueContract::String { max_bytes: 8_192 },
        });
        let args_contract = FunctionArgsContract { fields: arguments };
        let outer = |kind: &str, nodes: ResultValueContract, continuation: ResultValueContract| {
            ResultValueContract::Object {
                fields: vec![
                    ResultObjectFieldContract {
                        name: "kind".to_owned(),
                        required: true,
                        value: ResultValueContract::Literal { value: json!(kind) },
                    },
                    ResultObjectFieldContract {
                        name: "nodes".to_owned(),
                        required: true,
                        value: nodes,
                    },
                    ResultObjectFieldContract {
                        name: "continuation".to_owned(),
                        required: true,
                        value: continuation,
                    },
                ],
                allow_extra: false,
            }
        };
        let result_contract = FunctionResultContract::Records {
            record: ResultValueContract::Union {
                variants: vec![
                    outer(
                        "absent",
                        ResultValueContract::Null,
                        ResultValueContract::Null,
                    ),
                    outer(
                        "visible",
                        ResultValueContract::Tuple {
                            elements: plan
                                .nodes
                                .iter()
                                .map(|node| match node {
                                    SnapshotBatchNodeV2::BoundedChildren(_) => {
                                        ResultValueContract::Json {
                                            max_depth: 16,
                                            max_bytes: 1_048_576,
                                        }
                                    }
                                    SnapshotBatchNodeV2::RelationalQuery(node) => {
                                        ResultValueContract::Array {
                                            element: Box::new(ResultValueContract::Json {
                                                max_depth: 16,
                                                max_bytes: 1_048_576,
                                            }),
                                            max_items: node.take as usize,
                                        }
                                    }
                                })
                                .collect(),
                        },
                        ResultValueContract::Union {
                            variants: vec![
                                ResultValueContract::Null,
                                ResultValueContract::String { max_bytes: 8_192 },
                            ],
                        },
                    ),
                ],
            },
            rows: Some(ResultRowsBound {
                min_items: 1,
                max_items: 1,
            }),
        };
        let mut function = FunctionDefinition::new(
            "mixedView",
            FunctionKind::Query,
            FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatchV2(plan)),
        );
        function.args_contract_hash = Some(args_contract_hash(&args_contract).expect("args hash"));
        function.args_contract = Some(args_contract);
        function.result_contract_hash =
            Some(result_contract_hash(&result_contract).expect("result hash"));
        function.result_contract = result_contract;
        function.required_capabilities = vec![
            "snapshot_batch_v2".to_owned(),
            "relational_query_v1".to_owned(),
            "bounded_children_v1".to_owned(),
            "args_contract_v1".to_owned(),
            "result_contract_v1".to_owned(),
        ];
        let identity = {
            let FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatchV2(plan)) = &function.runtime
            else {
                unreachable!("snapshot v2 fixture")
            };
            snapshot_batch_identity_v2(&function, plan).expect("snapshot v2 identity")
        };
        let FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatchV2(plan)) = &mut function.runtime
        else {
            unreachable!("snapshot v2 fixture")
        };
        plan.normalized_composite_plan = identity.normalized_composite_plan;
        plan.plan_hash = identity.plan_hash;
        function
    }

    #[test]
    fn snapshot_batch_v2_shape_identity_groups_and_effect_ceilings_are_closed() {
        let bounded = SnapshotBatchNodeV2::BoundedChildren(snapshot_node_fixture(
            "boardId",
            BoundedParentVisibility::PublicRead,
            4,
        ));
        let relational =
            SnapshotBatchNodeV2::RelationalQuery(snapshot_v2_relational_node_fixture(7));
        assert_eq!(bounded.examined_entry_ceiling(), 5);
        assert_eq!(bounded.joined_lookup_ceiling(), 0);
        assert_eq!(relational.examined_entry_ceiling(), 7);
        assert_eq!(relational.joined_lookup_ceiling(), 7);

        let plan = SnapshotBatchPlanV2 {
            profile: "snapshot-batch.v2".to_owned(),
            nodes: vec![bounded.clone(), relational.clone()],
            normalized_composite_plan: Value::Null,
            plan_hash: String::new(),
        };
        validate_snapshot_batch_v2_plan_shape(&plan).expect("mixed v2 tuple");
        let function = snapshot_v2_function_fixture(plan.clone());
        let groups = snapshot_batch_v2_parent_authorization_groups(&function, &plan)
            .expect("bounded positions alone form groups");
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].node_indices, vec![0]);
        let identity = snapshot_batch_identity_v2(&function, &plan).expect("v2 identity");
        assert_eq!(identity.node_examined_entry_ceilings, vec![5, 7]);
        assert_eq!(identity.node_joined_lookup_ceilings, vec![0, 7]);
        assert_eq!(identity.parent_authorization_group_count, 1);
        assert_eq!(
            identity.normalized_composite_plan["profileId"],
            "snapshot-batch.v2"
        );
        assert_eq!(
            identity.normalized_composite_plan["nodes"][1]["nodePlan"]["classId"],
            "relational_query_v1"
        );
        assert_eq!(
            identity.normalized_composite_plan["parentAuthorizationGroups"][0]["members"],
            json!([0])
        );
        assert!(matches!(
            PublicFunctionDefinition::from(function).runtime,
            PublicFunctionRuntime::HostPlan(PublicHostPlanKind::SnapshotBatchV2)
        ));

        let all_relational_plan = SnapshotBatchPlanV2 {
            profile: "snapshot-batch.v2".to_owned(),
            nodes: vec![relational.clone(), relational.clone()],
            normalized_composite_plan: Value::Null,
            plan_hash: String::new(),
        };
        let all_relational = snapshot_v2_function_fixture(all_relational_plan.clone());
        assert!(
            snapshot_batch_v2_parent_authorization_groups(&all_relational, &all_relational_plan,)
                .expect("all-relational has no parent groups")
                .is_empty()
        );

        let no_relational = SnapshotBatchPlanV2 {
            profile: "snapshot-batch.v2".to_owned(),
            nodes: vec![bounded.clone(), bounded],
            normalized_composite_plan: Value::Null,
            plan_hash: String::new(),
        };
        assert_eq!(
            validate_snapshot_batch_v2_plan_shape(&no_relational)
                .expect_err("v2 requires a relational node")
                .diagnostic
                .code,
            "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
        );

        for nodes in [vec![relational.clone()], vec![relational.clone(); 9]] {
            let out_of_range = SnapshotBatchPlanV2 {
                profile: "snapshot-batch.v2".to_owned(),
                nodes,
                normalized_composite_plan: Value::Null,
                plan_hash: String::new(),
            };
            assert_eq!(
                validate_snapshot_batch_v2_plan_shape(&out_of_range)
                    .expect_err("v2 admits exactly two through eight nodes")
                    .diagnostic
                    .code,
                "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
            );
        }

        let exceeded = SnapshotBatchPlanV2 {
            profile: "snapshot-batch.v2".to_owned(),
            nodes: vec![
                SnapshotBatchNodeV2::RelationalQuery(snapshot_v2_relational_node_fixture(1_024)),
                SnapshotBatchNodeV2::RelationalQuery(snapshot_v2_relational_node_fixture(1)),
            ],
            normalized_composite_plan: Value::Null,
            plan_hash: String::new(),
        };
        assert_eq!(
            validate_snapshot_batch_v2_plan_shape(&exceeded)
                .expect_err("summed take stays bounded")
                .diagnostic
                .code,
            "SNAPBACK_SNAPSHOT_BATCH_CEILING_EXCEEDED",
        );

        let encoded = serde_json::to_value(relational).expect("serialize tagged v2 node");
        assert_eq!(encoded["classId"], "relational_query_v1");
        assert!(encoded.get("plan").is_some());
        assert_eq!(encoded.as_object().map(|value| value.len()), Some(2));
    }

    #[test]
    fn snapshot_batch_v2_outer_contract_never_narrows_to_visible() {
        let plan = SnapshotBatchPlanV2 {
            profile: "snapshot-batch.v2".to_owned(),
            nodes: vec![
                SnapshotBatchNodeV2::RelationalQuery(snapshot_v2_relational_node_fixture(2)),
                SnapshotBatchNodeV2::RelationalQuery(snapshot_v2_relational_node_fixture(2)),
            ],
            normalized_composite_plan: Value::Null,
            plan_hash: String::new(),
        };
        let function = snapshot_v2_function_fixture(plan.clone());
        validate_snapshot_batch_v2_outer_result_contract(&function, &plan)
            .expect("two-arm envelope admits even when absence is unreachable");

        let mut narrowed = function;
        let FunctionResultContract::Records {
            record: ResultValueContract::Union { variants },
            ..
        } = &mut narrowed.result_contract
        else {
            unreachable!("v2 fixture result")
        };
        let visible = variants[1].clone();
        narrowed.result_contract = FunctionResultContract::Records {
            record: visible,
            rows: Some(ResultRowsBound {
                min_items: 1,
                max_items: 1,
            }),
        };
        assert_eq!(
            validate_snapshot_batch_v2_outer_result_contract(&narrowed, &plan)
                .expect_err("visible-only contract must refuse")
                .diagnostic
                .code,
            "SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID",
        );
    }

    #[test]
    fn snapshot_batch_static_tuple_ceiling_arguments_and_structural_groups_are_closed() {
        let owner = BoundedParentVisibility::Owner {
            field: "ownerId".to_owned(),
        };
        let plan = SnapshotBatchPlanV1 {
            profile: "snapshot-batch.v1".to_owned(),
            nodes: vec![
                snapshot_node_fixture("boardId", owner.clone(), 512),
                snapshot_node_fixture("boardId", owner.clone(), 512),
            ],
            normalized_composite_plan: Value::Null,
            plan_hash: String::new(),
        };
        validate_snapshot_batch_plan_shape(&plan).expect("closed 2-node plan");
        let function = snapshot_function_fixture(plan.clone());
        validate_snapshot_batch_argument_bindings(&function, &plan).expect("exact merged args");
        let groups = snapshot_batch_parent_authorization_groups(&function, &plan)
            .expect("derive parent groups");
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].node_indices, vec![0, 1]);
        let identity = snapshot_batch_identity_v1(&function, &plan).expect("identity");
        assert_eq!(
            identity.parent_authorization_key_jcs,
            vec!["{\"format\":\"snapback.parent-authorization-key.v1\",\"parentIdArgument\":\"boardId\",\"parentIdType\":{\"kind\":\"id\",\"table\":\"boards\"},\"parentTable\":\"boards\",\"visibility\":{\"field\":\"ownerId\",\"kind\":\"owner.v1\"}}".to_owned()],
            "ParentAuthorizationKeyV1 uses the dated LLP 0135 closed record",
        );

        let mut js_node = snapshot_node_fixture(
            "incidentId",
            BoundedParentVisibility::Owner {
                field: "ownerId".to_owned(),
            },
            25,
        );
        js_node.parent_table = "incidents".to_owned();
        js_node.parent_projection = vec![
            BoundedProjectionField {
                name: "id".to_owned(),
                field: "_id".to_owned(),
            },
            BoundedProjectionField {
                name: "title".to_owned(),
                field: "title".to_owned(),
            },
        ];
        js_node.child_table = "tasks".to_owned();
        js_node.child_foreign_key = "incidentId".to_owned();
        js_node.child_relation_incarnation = "incidentIncarnation".to_owned();
        js_node.child_index = "by_incident_position".to_owned();
        js_node.child_projection = [
            ("id", "_id"),
            ("position", "position"),
            ("body", "body"),
            ("note", "note"),
        ]
        .into_iter()
        .map(|(name, field)| BoundedProjectionField {
            name: name.to_owned(),
            field: field.to_owned(),
        })
        .collect();
        let cross_language = snapshot_function_fixture(SnapshotBatchPlanV1 {
            profile: "snapshot-batch.v1".to_owned(),
            nodes: vec![js_node.clone(), js_node.clone(), js_node],
            normalized_composite_plan: Value::Null,
            plan_hash: String::new(),
        });
        let FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatch(cross_language_plan)) =
            &cross_language.runtime
        else {
            unreachable!("snapshot fixture")
        };
        assert_eq!(
            cross_language_plan.plan_hash,
            "sha256:46f823237e192428ce488c6f7a993c4569097a3f036bfd8f7325437e38ed2c0e",
            "Rust and JavaScript reconstruct one exact LLP 0157 PlanHashV1",
        );

        let mut different_argument = plan.clone();
        different_argument.nodes[1].parent_id_arg = "otherBoardId".to_owned();
        let different_argument_function = snapshot_function_fixture(different_argument.clone());
        assert_eq!(
            snapshot_batch_parent_authorization_groups(
                &different_argument_function,
                &different_argument,
            )
            .expect("different typed binding remains valid")
            .len(),
            2,
            "equal runtime ids under different bindings never dedup",
        );

        let mut different_visibility = plan.clone();
        different_visibility.nodes[1].parent_visibility = BoundedParentVisibility::PublicRead;
        let different_visibility_function = snapshot_function_fixture(different_visibility.clone());
        assert_eq!(
            snapshot_batch_parent_authorization_groups(
                &different_visibility_function,
                &different_visibility,
            )
            .expect("different visibility remains a valid plan")
            .len(),
            2,
            "different visibility declarations never dedup",
        );

        let mut exceeded = plan.clone();
        exceeded.nodes[1].take = 513;
        assert_eq!(
            validate_snapshot_batch_plan_shape(&exceeded)
                .expect_err("sum take must be bounded")
                .diagnostic
                .code,
            "SNAPBACK_SNAPSHOT_BATCH_CEILING_EXCEEDED",
        );

        let mut extra_argument = function.clone();
        extra_argument
            .args_contract
            .as_mut()
            .expect("args")
            .fields
            .push(ResultObjectFieldContract {
                name: "unbound".to_owned(),
                required: true,
                value: ResultValueContract::Boolean,
            });
        assert_eq!(
            validate_snapshot_batch_argument_bindings(&extra_argument, &plan)
                .expect_err("composite args are exactly the merged node args plus cursor")
                .diagnostic
                .code,
            "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
        );
    }

    #[test]
    fn snapshot_batch_direct_artifact_and_public_kind_load_with_exact_tuple() {
        let plan = SnapshotBatchPlanV1 {
            profile: "snapshot-batch.v1".to_owned(),
            nodes: vec![
                snapshot_node_fixture("boardId", BoundedParentVisibility::PublicRead, 8),
                snapshot_node_fixture("boardId", BoundedParentVisibility::PublicRead, 8),
            ],
            normalized_composite_plan: Value::Null,
            plan_hash: String::new(),
        };
        let function = snapshot_function_fixture(plan);
        let runtime = serde_json::to_value(&function.runtime).expect("serialize private carrier");
        assert!(runtime.get("HostPlan").is_some());
        let public = PublicFunctionDefinition::from(function.clone());
        assert!(matches!(
            public.runtime,
            PublicFunctionRuntime::HostPlan(PublicHostPlanKind::SnapshotBatch)
        ));
        let manifest = FunctionManifest {
            schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
            functions: vec![function],
            acknowledged_experimental_capabilities: vec![
                "snapshot_batch_v1".to_owned(),
                "bounded_children_v1".to_owned(),
                "args_contract_v1".to_owned(),
                "result_contract_v1".to_owned(),
            ],
            ..FunctionManifest::default()
        };
        manifest
            .validate_artifact()
            .expect("the exact heterogeneous tuple carrier is admitted");
        let mut tampered = manifest.clone();
        let FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatch(plan)) =
            &mut tampered.functions[0].runtime
        else {
            unreachable!("snapshot fixture")
        };
        plan.plan_hash = format!("sha256:{}", "0".repeat(64));
        assert_eq!(
            tampered
                .validate_artifact()
                .expect_err("an artifact cannot supply a mismatched LLP 0157 identity")
                .diagnostic
                .code,
            "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
        );
    }

    #[test]
    fn stream_fact_is_action_only_and_survives_public_projection() {
        let runtime = FunctionRuntime::IbexModule(IbexModule {
            source: "globalThis.__snapbackHandlers = { probe() { return null; } };".to_owned(),
            export: "probe".to_owned(),
        });
        let mut query = FunctionDefinition::new("probe", FunctionKind::Query, runtime.clone());
        query.stream = true;
        let error = FunctionManifest {
            functions: vec![query],
            ..FunctionManifest::default()
        }
        .validate_semantics()
        .expect_err("query stream fact must refuse");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_FUNCTION_STREAM_KIND_INVALID"
        );

        let mut action = FunctionDefinition::new("probe", FunctionKind::Action, runtime);
        action.stream = true;
        FunctionManifest {
            functions: vec![action.clone()],
            ..FunctionManifest::default()
        }
        .validate_semantics()
        .expect("streaming action admits");
        assert!(PublicFunctionDefinition::from(action).stream);
    }

    fn write_activity_plan_fixture() -> WriteWithActivityPlan {
        let scope_id = ValueExpr::Arg("incidentId".to_owned());
        let source_id = ValueExpr::Arg("taskId".to_owned());
        let provenance = WriteActivityProvenanceFields {
            scope_id: "incidentId".to_owned(),
            source_table: "sourceTable".to_owned(),
            source_id: "sourceId".to_owned(),
            operation: "operation".to_owned(),
            effective_subject: "effectiveSubject".to_owned(),
            actual_actor: "actualActor".to_owned(),
            actor_kind: "actorKind".to_owned(),
            grant: "grantId".to_owned(),
            occurred_at: "occurredAt".to_owned(),
            mutation: "mutationDigest".to_owned(),
        };
        let activity_values = BTreeMap::from([
            (provenance.scope_id.clone(), scope_id.clone()),
            (
                provenance.source_table.clone(),
                ValueExpr::Literal(json!("tasks")),
            ),
            (provenance.source_id.clone(), source_id.clone()),
            (
                provenance.operation.clone(),
                ValueExpr::Literal(json!("patch")),
            ),
            (provenance.effective_subject.clone(), ValueExpr::AuthUserId),
            (provenance.actual_actor.clone(), ValueExpr::AuthActorUserId),
            (
                provenance.actor_kind.clone(),
                ValueExpr::AuthActivityActorKind,
            ),
            (provenance.grant.clone(), ValueExpr::AuthGrantId),
            (provenance.occurred_at.clone(), ValueExpr::RuntimeNow),
            (provenance.mutation.clone(), ValueExpr::ClientMutationDigest),
        ]);
        let relation_assertion = MutationStep::AssertCurrentRelation {
            table: "tasks".to_owned(),
            id: source_id.clone(),
            scope_table: "incidents".to_owned(),
            scope_id: scope_id.clone(),
            foreign_key_field: "incidentId".to_owned(),
            incarnation_field: "incidentIncarnation".to_owned(),
            else_error: "SNAPBACK_ROW_NOT_FOUND".to_owned(),
        };
        WriteWithActivityPlan {
            profile: "write-with-activity.v1".to_owned(),
            required_capability: "write_activity_v1".to_owned(),
            mode: WriteWithActivityMode::ExistingOwnerV1,
            scope_table: "incidents".to_owned(),
            scope_id: scope_id.clone(),
            scope_owner_field: "ownerId".to_owned(),
            source_table: "tasks".to_owned(),
            source_id: source_id.clone(),
            source_operation: WriteWithActivitySourceOperation::Patch,
            activity_table: "activity".to_owned(),
            activity_scope_foreign_key: provenance.scope_id.clone(),
            activity_scope_incarnation: "incidentIncarnation".to_owned(),
            relations: vec![WriteActivityRelation {
                table: "tasks".to_owned(),
                scope_foreign_key: "incidentId".to_owned(),
                scope_incarnation: "incidentIncarnation".to_owned(),
            }],
            provenance_fields: provenance,
            effect_formula: WriteWithActivityEffectFormula {
                scope_reads: 1,
                scope_patches: 0,
                auxiliary_point_reads: 2,
                source_writes: 1,
                activity_inserts: 1,
                runtime_ids: 1,
                runtime_now: 1,
                settlement_lookups: 1,
                settlement_writes: 1,
                sequence_allocations: 0,
                maximum_application_writes: 2,
            },
            mutation: MutationPlan {
                owner_write_checks: Vec::new(),
                steps: vec![
                    MutationStep::Get {
                        table: "incidents".to_owned(),
                        id: scope_id,
                        bind_as: "__activityScope".to_owned(),
                        else_error: Some("SNAPBACK_ROW_NOT_FOUND".to_owned()),
                    },
                    MutationStep::Guard {
                        cond: ValueExpr::Binary {
                            op: BinaryOp::Eq,
                            left: Box::new(ValueExpr::Field {
                                base: Box::new(ValueExpr::Binding("__activityScope".to_owned())),
                                key: "ownerId".to_owned(),
                            }),
                            right: Box::new(ValueExpr::AuthUserId),
                        },
                        else_error: "SNAPBACK_ROW_NOT_FOUND".to_owned(),
                    },
                    relation_assertion,
                    MutationStep::Patch {
                        table: "tasks".to_owned(),
                        id: source_id.clone(),
                        values: BTreeMap::from([(
                            "body".to_owned(),
                            ValueExpr::Literal(json!("patched")),
                        )]),
                    },
                    MutationStep::AssertSourceChanged {
                        table: "tasks".to_owned(),
                        id: source_id,
                        operation: WriteWithActivitySourceOperation::Patch,
                    },
                    MutationStep::Insert {
                        table: "activity".to_owned(),
                        values: activity_values,
                        bind_id_as: Some("__activityId".to_owned()),
                    },
                ],
                return_value: Some(ReturnValue::Expr(ValueExpr::Binding(
                    "__activityId".to_owned(),
                ))),
            },
        }
    }

    #[test]
    fn write_activity_direct_artifact_cannot_forge_the_closed_plan_or_ceiling() {
        let valid = write_activity_plan_fixture();
        validate_write_with_activity_plan_shape(&valid).expect("generated closed plan");

        let mut extra_scope_write = valid.clone();
        extra_scope_write.mutation.steps.insert(
            4,
            MutationStep::Delete {
                table: "incidents".to_owned(),
                id: extra_scope_write.scope_id.clone(),
            },
        );
        assert!(
            validate_write_with_activity_plan_shape(&extra_scope_write).is_err(),
            "a direct artifact cannot hide an extra scope write behind the claimed ceiling",
        );

        let mut forged_provenance = valid.clone();
        let actor_field = forged_provenance.provenance_fields.actual_actor.clone();
        let Some(MutationStep::Insert { values, .. }) = forged_provenance.mutation.steps.last_mut()
        else {
            panic!("activity insert fixture");
        };
        values.insert(actor_field, ValueExpr::Arg("claimedActor".to_owned()));
        assert!(
            validate_write_with_activity_plan_shape(&forged_provenance).is_err(),
            "activity actor provenance is server-owned",
        );

        let mut forged_ceiling = valid.clone();
        forged_ceiling.effect_formula.auxiliary_point_reads = 0;
        assert!(
            validate_write_with_activity_plan_shape(&forged_ceiling).is_err(),
            "the declared quantitative ceiling is reconstructed from the executable plan",
        );

        let mut extra_runtime_id = valid.clone();
        let Some(MutationStep::Patch { values, .. }) = extra_runtime_id.mutation.steps.get_mut(3)
        else {
            panic!("source patch fixture");
        };
        values.insert("nonce".to_owned(), ValueExpr::RuntimeId);
        assert!(
            validate_write_with_activity_plan_shape(&extra_runtime_id).is_err(),
            "runtime ids are allocated only by the source/activity insert steps",
        );

        let mut authoritative_escape = valid.clone();
        authoritative_escape.mutation.steps.insert(
            2,
            MutationStep::Guard {
                cond: ValueExpr::MembershipExists(Box::new(MembershipPredicate {
                    declaration: "incidentMembers".to_owned(),
                    resource: MembershipResourceRef::Arg {
                        path: "incidentId".to_owned(),
                        resource_table: Some("incidents".to_owned()),
                    },
                    roles: None,
                })),
                else_error: "SNAPBACK_GUARD_FAILED".to_owned(),
            },
        );
        assert!(
            validate_write_with_activity_plan_shape(&authoritative_escape).is_err(),
            "the closed write profile cannot smuggle in an authoritative membership read",
        );

        let mut empty_source_patch = valid.clone();
        let Some(MutationStep::Patch { values, .. }) = empty_source_patch.mutation.steps.get_mut(3)
        else {
            panic!("source patch fixture");
        };
        values.clear();
        assert!(
            validate_write_with_activity_plan_shape(&empty_source_patch).is_err(),
            "an empty source patch cannot enter the source-effect profile",
        );

        let mut aliased_provenance = valid.clone();
        aliased_provenance.provenance_fields.actual_actor =
            aliased_provenance.activity_scope_incarnation.clone();
        assert!(
            validate_write_with_activity_plan_shape(&aliased_provenance).is_err(),
            "the protected incarnation field cannot alias activity provenance",
        );

        let mut maximum_guards = valid.clone();
        for _ in 0..16 {
            maximum_guards.mutation.steps.insert(
                2,
                MutationStep::Guard {
                    cond: ValueExpr::Literal(json!(true)),
                    else_error: "SNAPBACK_GUARD_FAILED".to_owned(),
                },
            );
        }
        validate_write_with_activity_plan_shape(&maximum_guards)
            .expect("sixteen authored Guard/Let steps are admitted");
        let mut too_many_guards = maximum_guards;
        too_many_guards.mutation.steps.insert(
            2,
            MutationStep::Guard {
                cond: ValueExpr::Literal(json!(true)),
                else_error: "SNAPBACK_GUARD_FAILED".to_owned(),
            },
        );
        assert!(
            validate_write_with_activity_plan_shape(&too_many_guards).is_err(),
            "direct artifacts share the authored Guard/Let ceiling",
        );

        let mut future_mode = valid;
        future_mode.mode = WriteWithActivityMode::CreateOwnerV1;
        assert!(
            validate_write_with_activity_plan_shape(&future_mode).is_err(),
            "the reserved create-owner mode stays unavailable until it has an implementation corpus",
        );
    }

    fn sequence_wwa_function_fixture() -> FunctionDefinition {
        let mut plan = write_activity_plan_fixture();
        let MutationStep::Get { else_error, .. } = &mut plan.mutation.steps[0] else {
            panic!("scope get fixture");
        };
        *else_error = Some("SNAPBACK_RELATION_PARENT_UNAVAILABLE".to_owned());
        let MutationStep::Guard { else_error, .. } = &mut plan.mutation.steps[1] else {
            panic!("scope guard fixture");
        };
        *else_error = "SNAPBACK_RELATION_PARENT_UNAVAILABLE".to_owned();
        plan.mutation.steps.insert(
            2,
            MutationStep::AllocateSequence {
                counter: "taskPositions".to_owned(),
                scope: plan.scope_id.clone(),
                into: "position".to_owned(),
            },
        );
        plan.effect_formula.sequence_allocations = 1;
        let mut function = FunctionDefinition::new(
            "allocateTaskPosition",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::WriteWithActivity(plan)),
        );
        function.required_capabilities = vec![
            "host_plan_runtime".to_owned(),
            "mutation_read_set_validation".to_owned(),
            "write_activity_v1".to_owned(),
            "sequence_allocation_v1".to_owned(),
        ];
        function.sequences = vec![SequenceDeclaration {
            name: "taskPositions".to_owned(),
            scope_table: "incidents".to_owned(),
            scope_access: SequenceScopeAccess::ExistingOwner(SequenceExistingOwnerAccess {
                kind: "existing-owner.v1".to_owned(),
                owner_field: "ownerId".to_owned(),
            }),
        }];
        function
    }

    #[test]
    fn sequence_direct_artifacts_cannot_bypass_generated_wwa_authority() {
        let valid = sequence_wwa_function_fixture();
        validate_sequence_declarations(&valid).expect("valid generated sequence declaration");
        let FunctionRuntime::HostPlan(HandlerPlan::WriteWithActivity(plan)) = &valid.runtime else {
            panic!("WWA fixture");
        };
        validate_write_with_activity_plan_shape(plan).expect("valid generated allocation shape");

        let mut missing_declaration = valid.clone();
        missing_declaration.sequences.clear();
        assert_eq!(
            validate_sequence_declarations(&missing_declaration)
                .expect_err("allocation without declaration refuses")
                .diagnostic
                .code,
            "SNAPBACK_SEQUENCE_UNDECLARED",
        );

        let mut missing_step = valid.clone();
        let FunctionRuntime::HostPlan(HandlerPlan::WriteWithActivity(plan)) =
            &mut missing_step.runtime
        else {
            unreachable!();
        };
        plan.mutation
            .steps
            .retain(|step| !matches!(step, MutationStep::AllocateSequence { .. }));
        plan.effect_formula.sequence_allocations = 0;
        assert_eq!(
            validate_sequence_declarations(&missing_step)
                .expect_err("declaration without allocation refuses")
                .diagnostic
                .code,
            "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
        );

        let declaration_forgeries: [fn(&mut FunctionDefinition); 3] = [
            |function: &mut FunctionDefinition| function.sequences[0].name = "other".to_owned(),
            |function: &mut FunctionDefinition| {
                function.sequences[0].scope_table = "otherScopes".to_owned()
            },
            |function: &mut FunctionDefinition| {
                let SequenceScopeAccess::ExistingOwner(access) =
                    &mut function.sequences[0].scope_access
                else {
                    unreachable!();
                };
                access.owner_field = "otherOwner".to_owned();
            },
        ];
        for mutate in declaration_forgeries {
            let mut forged = valid.clone();
            mutate(&mut forged);
            assert_eq!(
                validate_sequence_declarations(&forged)
                    .expect_err("mismatched generated declaration refuses")
                    .diagnostic
                    .code,
                "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
            );
        }

        for invalid_name in [
            "bad/name",
            "9tasks",
            "_snapbackTasks",
            "_auth",
            "_AUTH_tasks",
        ] {
            let mut forged = valid.clone();
            forged.sequences[0].name = invalid_name.to_owned();
            let FunctionRuntime::HostPlan(HandlerPlan::WriteWithActivity(plan)) =
                &mut forged.runtime
            else {
                unreachable!();
            };
            let MutationStep::AllocateSequence { counter, .. } = &mut plan.mutation.steps[2] else {
                unreachable!();
            };
            *counter = invalid_name.to_owned();
            assert_eq!(
                validate_sequence_declarations(&forged)
                    .expect_err("malformed or reserved direct-manifest counter refuses")
                    .diagnostic
                    .code,
                "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
            );
        }

        let mut missing_capability = valid.clone();
        missing_capability
            .required_capabilities
            .retain(|capability| capability != "sequence_allocation_v1");
        assert_eq!(
            validate_sequence_declarations(&missing_capability)
                .expect_err("missing sequence capability refuses")
                .diagnostic
                .code,
            "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
        );

        let mut handler = FunctionDefinition::new(
            "forgedHandler",
            FunctionKind::Mutation,
            FunctionRuntime::IbexModule(IbexModule {
                source: "globalThis.__snapbackHandlers = {};".to_owned(),
                export: "forgedHandler".to_owned(),
            }),
        );
        handler.required_capabilities = vec!["sequence_allocation_v1".to_owned()];
        handler.sequences = valid.sequences.clone();
        assert_eq!(
            validate_sequence_declarations(&handler)
                .expect_err("generated existing-owner proof is not handler authority")
                .diagnostic
                .code,
            "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
        );

        let generic = FunctionDefinition::new(
            "genericAllocation",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                owner_write_checks: Vec::new(),
                steps: vec![MutationStep::AllocateSequence {
                    counter: "taskPositions".to_owned(),
                    scope: ValueExpr::Arg("incidentId".to_owned()),
                    into: "position".to_owned(),
                }],
                return_value: None,
            })),
        );
        assert_eq!(
            validate_sequence_declarations(&generic)
                .expect_err("generic HostPlan allocation refuses")
                .diagnostic
                .code,
            "SNAPBACK_SEQUENCE_UNDECLARED",
        );
    }

    fn table_json() -> Value {
        json!({
            "name": "eventMembers",
            "fields": [
                { "name": "userId", "field_type": "Principal", "optional": false },
                { "name": "eventId", "field_type": { "Id": { "table": "events" } }, "optional": false },
                { "name": "role", "field_type": "String", "optional": false },
                { "name": "expiresAt", "field_type": "Integer", "optional": true }
            ],
            "membership": {
                "principal": "userId",
                "resource": "eventId",
                "resourceTable": "events",
                "role": "role",
                "roles": ["host", "guest"],
                "bootstrapRole": "host",
                "lastHolder": { "protect": "host" },
                "expiry": { "field": "expiresAt", "onExpiry": "remove" },
                "transitions": [{
                    "op": "patch",
                    "by": ["host"],
                    "target": "other",
                    "from": ["guest"],
                    "fields": ["expiresAt"]
                }]
            }
        })
    }

    #[test]
    fn membership_security_grammar_rejects_unknown_fields_at_every_layer() {
        let mut cases = Vec::new();

        let mut outer = table_json();
        outer
            .as_object_mut()
            .unwrap()
            .insert("membershp".into(), json!({}));
        cases.push(outer);

        for (path, typo) in [
            ("membership", "resourceTabel"),
            ("membership", "lastHodler"),
            ("lastHolder", "unknown"),
            ("expiry", "unknown"),
            ("transition", "frmo"),
            ("transition", "unknown"),
        ] {
            let mut value = table_json();
            let membership = value["membership"].as_object_mut().unwrap();
            match path {
                "membership" => {
                    membership.insert(typo.into(), json!(null));
                }
                "lastHolder" => {
                    membership["lastHolder"]
                        .as_object_mut()
                        .unwrap()
                        .insert(typo.into(), json!(true));
                }
                "expiry" => {
                    membership["expiry"]
                        .as_object_mut()
                        .unwrap()
                        .insert(typo.into(), json!(true));
                }
                "transition" => {
                    membership["transitions"][0]
                        .as_object_mut()
                        .unwrap()
                        .insert(typo.into(), json!(["guest"]));
                }
                _ => unreachable!(),
            }
            cases.push(value);
        }

        for value in cases {
            assert!(
                serde_json::from_value::<TableManifest>(value).is_err(),
                "unknown security field must fail closed"
            );
        }
    }

    #[test]
    fn nominal_id_field_round_trips_its_target_table() {
        let field = FieldType::Id {
            table: "events".to_owned(),
        };
        let encoded = serde_json::to_value(&field).expect("serialize nominal id");
        assert_eq!(encoded, json!({ "Id": { "table": "events" } }));
        assert_eq!(
            serde_json::from_value::<FieldType>(encoded).expect("parse nominal id"),
            field
        );
    }

    #[test]
    fn membership_argument_resource_ref_carries_nominal_table_provenance() {
        let resource = MembershipResourceRef::Arg {
            path: "event.id".to_owned(),
            resource_table: Some("events".to_owned()),
        };
        let encoded = serde_json::to_value(&resource).expect("serialize resource ref");
        assert_eq!(
            encoded,
            json!({
                "arg": {
                    "path": "event.id",
                    "resourceTable": "events"
                }
            })
        );
        assert_eq!(
            serde_json::from_value::<MembershipResourceRef>(encoded)
                .expect("parse nominal resource ref"),
            resource
        );
        assert!(
            serde_json::from_value::<MembershipResourceRef>(json!({ "arg": "event.id" })).is_err(),
            "the old bare-string artifact shape erased nominal provenance"
        );
        assert!(
            serde_json::from_value::<MembershipResourceRef>(json!({
                "arg": {
                    "path": "event.id",
                    "resourceTable": "events",
                    "resourceTabel": "projects"
                }
            }))
            .is_err(),
            "unknown fields inside the authorization reference fail closed"
        );
    }
}

#[cfg(test)]
mod asset_upload_intent_manifest_tests {
    use super::*;

    fn intent(name: &str) -> AssetUploadIntentDefinition {
        AssetUploadIntentDefinition {
            id: format!("app:{name}"),
            name: name.to_owned(),
            exported_name: Some(name.to_owned()),
            implementation_hash: Some("sha256:aa".to_owned()),
            args_contract_hash: Some("sha256:bb".to_owned()),
            intent_policy_hash: "sha256:cc".to_owned(),
            auth_requirement: Some(AuthRequirement::Authenticated),
            accept: AssetAcceptPolicy {
                media_types: vec!["application/pdf".to_owned()],
                max_bytes: 1_000,
            },
            delivery: AssetDeliveryPolicy {
                kind: crate::assets::AssetDeliveryProfile::PrivateStrict,
            },
            access: AssetAccessPolicy {
                read: crate::assets::AssetReadAccessPolicy::OwnerOnly,
            },
            grants: false,
            image: None,
            video: None,
            on: None,
            declared_reads: Vec::new(),
            runtime: FunctionRuntime::IbexModule(IbexModule {
                source: "globalThis.__snapbackHandlers = {};".to_owned(),
                export: name.to_owned(),
            }),
            handler_form: Some("inline".to_owned()),
            source_span: None,
        }
    }

    fn manifest_with(intents: Vec<AssetUploadIntentDefinition>) -> FunctionManifest {
        FunctionManifest {
            asset_upload_intents: intents,
            ..FunctionManifest::default()
        }
    }

    #[test]
    fn valid_intent_passes_manifest_validation() {
        manifest_with(vec![intent("avatarUpload")])
            .validate_semantics()
            .expect("valid intent admits");
    }

    #[test]
    fn duplicate_intent_identity_is_refused() {
        let error = manifest_with(vec![intent("avatarUpload"), intent("avatarUpload")])
            .validate_semantics()
            .expect_err("duplicate identity must refuse");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_INTENT_IDENTITY_COLLISION"
        );
    }

    #[test]
    fn empty_accept_set_is_refused() {
        let mut bad = intent("avatarUpload");
        bad.accept.media_types.clear();
        let error = manifest_with(vec![bad])
            .validate_semantics()
            .expect_err("empty accept must refuse");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_INTENT_ACCEPT_INVALID"
        );
    }

    #[test]
    fn host_plan_authorizer_is_refused() {
        let mut bad = intent("avatarUpload");
        bad.runtime = FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table_visibility: None,
            table: "notes".to_owned(),
            filters: Vec::new(),
            membership_filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            indexed_by: None,
        }));
        let error = manifest_with(vec![bad])
            .validate_semantics()
            .expect_err("host-plan authorizer must refuse");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_INTENT_RUNTIME_INVALID"
        );
    }
}

#[cfg(test)]
mod media_ref_manifest_tests {
    use super::*;

    /// @ref LLP 0244#d4-result-artifact-retention-and-rqs-identity-rotate-explicitly
    /// @ref LLP 0244#d6-projection-is-a-capability-gated-storage-feature
    #[test]
    fn generated_media_contract_rotates_identity_demotes_rqs_and_refuses_actions() {
        let schema: SchemaManifest = serde_json::from_str(include_str!(
            "../../../../tests/acceptance/fixtures/media-profile/snapback/generated/schema.manifest.json"
        ))
        .expect("generated media schema");
        let functions: FunctionManifest = serde_json::from_str(include_str!(
            "../../../../tests/acceptance/fixtures/media-profile/snapback/generated/functions.manifest.json"
        ))
        .expect("generated media functions");
        let function = functions
            .functions
            .iter()
            .find(|function| function.name == "listProfiles")
            .expect("media LiveQuery");
        assert!(result_contract_contains_media(&function.result_contract));
        let contract_hash = result_contract_hash(&function.result_contract).unwrap();
        assert_eq!(
            function.result_contract_hash.as_deref(),
            Some(contract_hash.as_str())
        );
        assert!(
            function.required_capabilities.iter().any(|capability| {
                capability == TargetCapabilityId::MediaRefProjectionV1.as_str()
            })
        );
        assert_eq!(rqs_eligible_digest_kind(function), None);
        let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &function.runtime else {
            panic!("fixture LiveQuery must use a single-table host query")
        };
        assert!(
            !single_table_delta_contract_matches_schema(&function.result_contract, plan, &schema),
            "raw-row delta delivery must not bypass media result projection"
        );

        let mut missing_generation = function.clone();
        missing_generation.implementation_hash = None;
        let error = validate_result_contract_definition(&missing_generation)
            .expect_err("media result proof cannot bind an absent implementation generation");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID"
        );

        let table = schema.table("profiles").expect("profiles table");
        let field = table.field("image").expect("media field");
        let FieldType::AssetRef {
            media: Some(media), ..
        } = &field.field_type
        else {
            panic!("image must lower as distinguished AssetRef media")
        };
        let generation = media_source_field_generation("profiles", field, media);
        let mut changed_field = field.clone();
        let FieldType::AssetRef {
            media: Some(changed),
            ..
        } = &mut changed_field.field_type
        else {
            unreachable!()
        };
        changed.policy = "profile-image.v2".to_owned();
        let changed = changed.clone();
        assert_ne!(
            media_source_field_generation("profiles", &changed_field, &changed),
            generation,
            "policy generation rotates source identity"
        );

        let FunctionResultContract::Documents { table, document } = &function.result_contract
        else {
            panic!("fixture LiveQuery must return documents")
        };
        let mut action = function.clone();
        action.kind = FunctionKind::Action;
        action.result_contract = FunctionResultContract::Document {
            table: table.clone(),
            document: document.clone(),
        };
        action.result_contract_hash = Some(result_contract_hash(&action.result_contract).unwrap());
        let error = validate_result_contract_definition(&action)
            .expect_err("Action has no pinned snapshot for direct media output");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEDIA_PROJECTION_SNAPSHOT_UNAVAILABLE"
        );
    }
}

#[cfg(test)]
mod public_projection_schema_tests {
    use super::*;

    #[test]
    fn public_projection_schema_accepts_omitted_zero_value_function_facts() {
        let function = FunctionDefinition::new(
            "zeroFacts",
            FunctionKind::Query,
            FunctionRuntime::IbexModule(IbexModule {
                source: "globalThis.__snapbackHandlers = {};".to_owned(),
                export: "zeroFacts".to_owned(),
            }),
        );
        let public = serde_json::to_value(PublicFunctionDefinition::from(function))
            .expect("serialize public function projection");
        for field in [
            "stream",
            "authorizationDependence",
            "authorityProfileDependence",
        ] {
            assert!(
                public.get(field).is_none(),
                "the zero-value public projection must omit {field}"
            );
        }

        let schema = serde_json::to_value(schemars::schema_for!(PublicFunctionDefinition))
            .expect("serialize public function schema");
        let required = schema["required"]
            .as_array()
            .expect("public function required fields");
        for field in [
            "stream",
            "authorizationDependence",
            "authorityProfileDependence",
        ] {
            assert!(
                !required.iter().any(|required| required == field),
                "the schema must treat omitted {field} as its zero value"
            );
        }
    }
}
