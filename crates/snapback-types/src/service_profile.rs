//! Commit-addressed remote-service publication artifacts.
//!
//! These records publish target, endpoint-policy, credential-policy, client
//! wire, operation, and data-tier identity without carrying an endpoint or a
//! credential value. Consumers pin the containing Snapback commit and verify
//! every referenced artifact digest before constructing a transport.
//!
//! @ref LLP 0051#remote-service-publication — the Snapback-owned half of the
//! Exact Native M4 remote-service profile (ENG-24556).
//! @ref LLP 0037#decision-ratified-2026-07-02 — Rust serde types own the
//! shared artifact shapes; committed JSON Schemas are generated from them.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishedArtifactRef {
    pub path: String,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteServiceGitPublication {
    pub kind: String,
    pub addressing: String,
    pub repository: String,
    pub profile_path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteEndpointPolicy {
    pub scheme: String,
    pub authority: String,
    pub value_in_artifacts: bool,
    pub value_in_arguments: bool,
    pub value_in_environment: bool,
    pub value_in_info_plist: bool,
    pub allow_redirects: bool,
    pub allow_ambient_proxy: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteCredentialPolicy {
    pub presentation: String,
    pub authority: String,
    pub value_in_artifacts: bool,
    pub value_in_arguments: bool,
    pub value_in_environment: bool,
    pub value_in_info_plist: bool,
    pub supports_rotation: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteServiceDataTierIdentity {
    pub corpus: String,
    pub profile_version: u32,
    pub corpus_format_version: u32,
    pub ledger_version: u32,
    pub case_count: usize,
    pub profile: PublishedArtifactRef,
    pub corpus_manifest: PublishedArtifactRef,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteServiceProfile {
    pub artifact_kind: String,
    pub schema_version: String,
    pub profile_version: u32,
    pub profile_id: String,
    pub app_id: String,
    pub target_profile_id: String,
    pub local_server_lifecycle: bool,
    pub publication: RemoteServiceGitPublication,
    pub endpoint_policy: RemoteEndpointPolicy,
    pub server_capability_manifest: PublishedArtifactRef,
    pub auth_capability_manifest: PublishedArtifactRef,
    pub data_capability_manifest: PublishedArtifactRef,
    pub data_tier: RemoteServiceDataTierIdentity,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteAuthCapabilityManifest {
    pub artifact_kind: String,
    pub schema_version: String,
    pub manifest_version: u32,
    pub capability_id: String,
    pub app_id: String,
    pub target_profile_id: String,
    pub credential_policy: RemoteCredentialPolicy,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteServiceOperation {
    pub name: String,
    pub function_id: String,
    pub kind: String,
    pub auth_requirement: String,
    pub arguments_schema: PublishedArtifactRef,
    pub request_schema: PublishedArtifactRef,
    pub response_schema: PublishedArtifactRef,
    pub receipt_schema: PublishedArtifactRef,
    pub error_schema: PublishedArtifactRef,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteDataCapabilityManifest {
    pub artifact_kind: String,
    pub schema_version: String,
    pub manifest_version: u32,
    pub capability_id: String,
    pub app_id: String,
    pub target_profile_id: String,
    pub schema_manifest: PublishedArtifactRef,
    pub function_manifest: PublishedArtifactRef,
    pub capability_manifest: PublishedArtifactRef,
    pub wire_schemas: BTreeMap<String, PublishedArtifactRef>,
    pub operations: Vec<RemoteServiceOperation>,
}
