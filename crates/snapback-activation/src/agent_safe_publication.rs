//! Fail-closed source authority for LLP 0162's storage publication and the
//! independently shaped derived-fork witness chain.
//!
//! Each record owns an anchor -> carrier -> qualification-receipt chain. A
//! chain may be `withheld` or `published`; the author-ruled derived-fork claim
//! is carried by the LLP 0061 guide row rather than the manifest predicate, so
//! publication-record changes cannot make the binary advertise that capability.

use crate::manifest::{
    AgentSafeCapabilityFactsV1, AgentSafeEnvelopeCoverageV1, AgentSafeExplanationAccessV1,
    AgentSafeExplanationAdapterV1, AgentSafeExplanationClassV1, AgentSafeExplanationDetailV1,
    AgentSafeExplanationLogicalLaneV1, AgentSafeExplanationProfileV1,
    AgentSafeExplanationRetentionV1, AgentSafeExplanationScopeV1, AgentSafeForkAxesV1,
    AgentSafeForkBaseV1, AgentSafeForkEgressV1, AgentSafeForkIsolationV1, AgentSafeForkPromotionV1,
    AgentSafeScopedExplanationFactV1, TARGET_PROFILE_CLOUDFLARE_DO_SQLITE_V8,
    TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX, TARGET_PROFILE_REMOTE_SERVICE_SQLITE_IBEX,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const STORAGE_ID: &str = "agent_safe_storage_v1";
#[cfg(test)]
const DERIVED_FORK_ID: &str = "agent_safe_derived_deployment_fork_v1";
const STORAGE_COMPONENTS: [&str; 6] = [
    "ordinaryMutationHostPlanEnvelope",
    "ordinaryMutationIbexBufferedEnvelope",
    "hostChildMutationHostPlanEnvelope",
    "hostChildMutationIbexBufferedEnvelope",
    "generatedOwnedCrudOwnerCreateHostPlanExplanation",
    "generatedOwnedCrudOwnerUpdateHostPlanExplanation",
];
#[cfg(test)]
const DERIVED_FORK_COMPONENTS: [&str; 1] = ["derivedDeploymentForkSafetyV1"];
const STORAGE_EVIDENCE_LOCATORS: [(&str, &str); 6] = [
    (
        "acceptanceCorpus",
        "tests/acceptance/fixtures/agent-safe-storage/acceptance-corpus.2026-08-04.v1.json",
    ),
    (
        "pairedPerformance",
        "tests/acceptance/fixtures/agent-safe-storage/agent-safe-active-covered-paired.2026-08-04.v1.json",
    ),
    (
        "absolutePerformance",
        "tests/acceptance/fixtures/agent-safe-storage/fork-promotion-performance.2026-08-04.v1.json",
    ),
    (
        "independentReviewFable",
        "llp/reviews/0162-agent-safe-storage-profile.implementation-2026-08-04.fable.md",
    ),
    (
        "independentReviewCodex",
        "llp/reviews/0162-agent-safe-storage-profile.implementation-2026-08-04.codex.md",
    ),
    (
        "authorAcceptance",
        "tests/acceptance/fixtures/agent-safe-storage/author-acceptance.2026-08-04.v1.json",
    ),
];
#[cfg(test)]
const DERIVED_FORK_EVIDENCE_LOCATORS: [(&str, &str); 13] = [
    (
        "lifecycleBenchMacos",
        "tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json",
    ),
    (
        "lifecycleBenchLinux",
        "tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json",
    ),
    (
        "boundsRatification",
        "tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.v1.json",
    ),
    (
        "assetLifecycleEvidence",
        "tests/acceptance/asset-lifecycle-v1-evidence.md",
    ),
    (
        "specReviewCodex",
        "llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.md",
    ),
    (
        "specReviewCodexVerdicts",
        "llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.verdicts.v1.json",
    ),
    (
        "specReviewFable",
        "llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.md",
    ),
    (
        "specReviewFableVerdicts",
        "llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.verdicts.v1.json",
    ),
    (
        "implementationReviewCodex",
        "llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.md",
    ),
    (
        "implementationReviewCodexVerdicts",
        "llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.verdicts.v1.json",
    ),
    (
        "implementationReviewFable",
        "llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.md",
    ),
    (
        "implementationReviewFableVerdicts",
        "llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.verdicts.v1.json",
    ),
    (
        "authorAcceptance",
        "tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json",
    ),
];

const STORAGE_ANCHOR_BYTES: &[u8] =
    include_bytes!("local-agent-safe-storage-publication.anchor.json");
const STORAGE_CARRIER_BYTES: &[u8] =
    include_bytes!("local-agent-safe-storage-publication.carrier.json");
const STORAGE_RECEIPT_BYTES: &[u8] = include_bytes!(
    "../../../tests/acceptance/receipts/agent-safe-storage-publication.2026-08-04.v1.json"
);
#[cfg(test)]
const DERIVED_FORK_ANCHOR_BYTES: &[u8] =
    include_bytes!("local-agent-safe-derived-deployment-fork-publication.anchor.json");
#[cfg(test)]
const DERIVED_FORK_CARRIER_BYTES: &[u8] =
    include_bytes!("local-agent-safe-derived-deployment-fork-publication.carrier.json");
#[cfg(test)]
const DERIVED_FORK_RECEIPT_BYTES: &[u8] = include_bytes!(
    "../../../tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json"
);

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum PublicationStateV1 {
    Withheld,
    Published,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalAgentSafePublicationAnchorV1 {
    schema_version: String,
    capability_id: String,
    state: PublicationStateV1,
    carrier_sha256: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalAgentSafePublicationCarrierV1 {
    schema_version: String,
    capability_id: String,
    target_profile_id: String,
    maturity: String,
    qualified_source_commit: String,
    implementation_digest_version: Option<String>,
    implementation_tree_sha256: String,
    candidate_facts_sha256: String,
    qualification_receipt_sha256: String,
    build_provenance_requirement: String,
    candidate_facts: Option<AgentSafeCapabilityFactsV1>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentSafePublicationReceiptV1 {
    schema_version: String,
    capability_id: String,
    qualified_source_commit: String,
    implementation_digest_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    implementation_scope: Option<AgentSafeImplementationScopeV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    selection_policy_sha256: Option<String>,
    implementation_tree_sha256: String,
    candidate_facts_sha256: String,
    qualified_target_profile_id: String,
    negative_target_profile_ids: Vec<String>,
    negative_build_distributions: Vec<String>,
    qualified_components: Vec<String>,
    evidence: Vec<AgentSafeEvidenceBindingV1>,
}

// @ref LLP 0189#decision — D-4 makes this exact roots/files classification
// part of the named-author-accepted derived-fork claim record.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentSafeImplementationScopeV1 {
    schema_version: AgentSafeImplementationScopeSchemaV1,
    roots: Vec<AgentSafeImplementationRootV1>,
    files: Vec<AgentSafeImplementationFileV1>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
enum AgentSafeImplementationScopeSchemaV1 {
    #[serde(rename = "snapback.agent-safe-implementation-scope.v1")]
    V1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
enum AgentSafeImplementationRootV1 {
    #[serde(rename = "src")]
    Src,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
enum AgentSafeImplementationFileV1 {
    #[serde(rename = ".gitmodules")]
    Gitmodules,
    #[serde(rename = "Cargo.lock")]
    CargoLock,
    #[serde(rename = "Cargo.toml")]
    CargoToml,
    #[serde(rename = "build.rs")]
    BuildRs,
    #[serde(rename = "scripts/check-agent-safe-publication.mjs")]
    PublicationChecker,
    #[serde(rename = "scripts/generated-artifact-policy.mjs")]
    GeneratedArtifactPolicy,
    #[serde(rename = "vendor/ibex")]
    VendorIbex,
}

#[cfg(test)]
fn derived_fork_implementation_scope() -> AgentSafeImplementationScopeV1 {
    AgentSafeImplementationScopeV1 {
        schema_version: AgentSafeImplementationScopeSchemaV1::V1,
        roots: vec![AgentSafeImplementationRootV1::Src],
        files: vec![
            AgentSafeImplementationFileV1::Gitmodules,
            AgentSafeImplementationFileV1::CargoLock,
            AgentSafeImplementationFileV1::CargoToml,
            AgentSafeImplementationFileV1::BuildRs,
            AgentSafeImplementationFileV1::PublicationChecker,
            AgentSafeImplementationFileV1::GeneratedArtifactPolicy,
            AgentSafeImplementationFileV1::VendorIbex,
        ],
    }
}

#[cfg(test)]
fn derived_fork_v3_evidence_path_matches(index: usize, path: &str) -> bool {
    fn is_dated_path(path: &str, prefix: &str, suffix: &str) -> bool {
        path.strip_prefix(prefix)
            .and_then(|value| value.strip_suffix(suffix))
            .is_some_and(|date| {
                let has_iso_shape = date.len() == 10
                    && date.as_bytes()[4] == b'-'
                    && date.as_bytes()[7] == b'-'
                    && date
                        .bytes()
                        .enumerate()
                        .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit());
                if !has_iso_shape {
                    return false;
                }
                let year = date[0..4].parse::<u16>().unwrap();
                let month = date[5..7].parse::<u8>().unwrap();
                let day = date[8..10].parse::<u8>().unwrap();
                let leap_year = year.is_multiple_of(4)
                    && (!year.is_multiple_of(100) || year.is_multiple_of(400));
                let days_in_month = match month {
                    1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
                    4 | 6 | 9 | 11 => 30,
                    2 if leap_year => 29,
                    2 => 28,
                    _ => return false,
                };
                (1..=days_in_month).contains(&day)
            })
    }

    match index {
        0 => is_dated_path(
            path,
            "tests/acceptance/instance-fork-lifecycle-bench.",
            ".macos-aarch64.v1.json",
        ),
        1 => is_dated_path(
            path,
            "tests/acceptance/instance-fork-lifecycle-bench.",
            ".linux-x86_64.v1.json",
        ),
        2 => is_dated_path(
            path,
            "tests/acceptance/instance-fork-lifecycle-bench.",
            ".v1.json",
        ),
        12 => is_dated_path(
            path,
            "tests/acceptance/fixtures/instance-forks/author-acceptance.",
            ".v3.json",
        ),
        _ => path == DERIVED_FORK_EVIDENCE_LOCATORS[index].1,
    }
}

#[derive(Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentSafeEvidenceBindingV1 {
    kind: String,
    path: String,
    sha256: String,
}

#[doc(hidden)]
pub fn storage_target_candidate() -> AgentSafeCapabilityFactsV1 {
    let mut facts = AgentSafeCapabilityFactsV1::missing();
    facts.envelope.ordinary_mutation.host_plan = AgentSafeEnvelopeCoverageV1::Covered;
    facts.envelope.ordinary_mutation.ibex_buffered = AgentSafeEnvelopeCoverageV1::Covered;
    facts.envelope.host_child_mutation.host_plan = AgentSafeEnvelopeCoverageV1::Covered;
    facts.envelope.host_child_mutation.ibex_buffered = AgentSafeEnvelopeCoverageV1::Covered;
    facts.explanation.scoped_facts = [
        AgentSafeExplanationProfileV1::GeneratedOwnedCrudOwnerCreateV1,
        AgentSafeExplanationProfileV1::GeneratedOwnedCrudOwnerUpdateV1,
    ]
    .into_iter()
    .map(owner_explanation_fact)
    .collect();
    facts
}

#[doc(hidden)]
pub fn derived_fork_target_candidate() -> AgentSafeCapabilityFactsV1 {
    let mut facts = AgentSafeCapabilityFactsV1::missing();
    facts.forks.derived_deployment = AgentSafeForkAxesV1 {
        egress: AgentSafeForkEgressV1::DenyAll,
        promotion: AgentSafeForkPromotionV1::NotPromotable,
        base: AgentSafeForkBaseV1::CurrentHead,
        isolation: AgentSafeForkIsolationV1::HostMediated,
    };
    facts
}

fn owner_explanation_fact(
    profile: AgentSafeExplanationProfileV1,
) -> AgentSafeScopedExplanationFactV1 {
    AgentSafeScopedExplanationFactV1 {
        scope: AgentSafeExplanationScopeV1 {
            logical_lane: AgentSafeExplanationLogicalLaneV1::OrdinaryMutation,
            adapter: AgentSafeExplanationAdapterV1::HostPlan,
            access: AgentSafeExplanationAccessV1::PublicCurrentPolicy,
            profile,
        },
        class: AgentSafeExplanationClassV1 {
            detail: AgentSafeExplanationDetailV1::BoundedFacts,
            retention: AgentSafeExplanationRetentionV1::PolicyBounded,
        },
    }
}

#[cfg(any(test, feature = "test-support"))]
#[doc(hidden)]
pub fn storage_publication_verified() -> bool {
    storage_publication_verified_for_distribution(crate::identity::build_distribution())
}

#[doc(hidden)]
pub fn storage_publication_verified_for_distribution(build_distribution: &str) -> bool {
    embedded_publication_verified(
        STORAGE_ID,
        STORAGE_COMPONENTS.as_slice(),
        STORAGE_EVIDENCE_LOCATORS.as_slice(),
        &storage_target_candidate(),
        STORAGE_ANCHOR_BYTES,
        STORAGE_CARRIER_BYTES,
        STORAGE_RECEIPT_BYTES,
        build_distribution,
    )
}

#[cfg(any(test, feature = "test-support"))]
#[doc(hidden)]
pub fn derived_fork_publication_verified() -> bool {
    derived_fork_publication_verified_for_distribution(crate::identity::build_distribution())
}

#[doc(hidden)]
pub fn derived_fork_publication_verified_for_distribution(build_distribution: &str) -> bool {
    // @ref LLP 0158#capability-registry-record — the author ruled the LLP 0061
    // guide capability-index row as the local claim's publication carrier.
    // This Rust predicate guards only the never-ruled LLP 0113/manifest act,
    // so JSON-only anchor/carrier changes must remain incapable of turning
    // the target-capability tuple positive.
    let _ = build_distribution;
    false
}

#[allow(
    clippy::too_many_arguments,
    reason = "the verifier mirrors the closed publication carrier tuple; named axes keep drift reviewable"
)]
fn embedded_publication_verified(
    capability_id: &str,
    components: &[&str],
    evidence_locators: &[(&str, &str)],
    exact_candidate: &AgentSafeCapabilityFactsV1,
    anchor_bytes: &[u8],
    carrier_bytes: &[u8],
    receipt_bytes: &[u8],
    build_distribution: &str,
) -> bool {
    let identity = crate::identity::binary_identity();
    publication_verified_for(
        capability_id,
        components,
        evidence_locators,
        exact_candidate,
        anchor_bytes,
        carrier_bytes,
        receipt_bytes,
        build_distribution,
        &identity.git_commit,
        identity.git_dirty,
        option_env!("SNAPBACK_AGENT_SAFE_IMPLEMENTATION_SHA256").unwrap_or("unknown"),
    )
}

/// Verify one chain without consulting the other component. Candidate facts
/// are reconstructed in Rust and compared exactly; carrier JSON can therefore
/// never widen a specialized lane, aggregate, fork tuple, or explanation
/// profile.
///
/// @ref LLP 0110#local-and-packaged-publication-authority — contributor
/// source support requires a source-owned embedded carrier and known, clean
/// build provenance. Public packages require a different signed attestation.
/// @ref LLP 0134#4-the-promotion-act — the receipt is outside the qualified
/// implementation tree, breaking the source-digest cycle while its hash is
/// still bound by the carrier.
#[allow(clippy::too_many_arguments)]
fn publication_verified_for(
    capability_id: &str,
    components: &[&str],
    evidence_locators: &[(&str, &str)],
    exact_candidate: &AgentSafeCapabilityFactsV1,
    anchor_bytes: &[u8],
    carrier_bytes: &[u8],
    receipt_bytes: &[u8],
    build_distribution: &str,
    build_git_commit: &str,
    build_git_dirty: bool,
    build_implementation_tree_sha256: &str,
) -> bool {
    let Ok(anchor) = serde_json::from_slice::<LocalAgentSafePublicationAnchorV1>(anchor_bytes)
    else {
        return false;
    };
    if anchor.schema_version != "snapback.local-capability-publication-anchor.v1"
        || anchor.capability_id != capability_id
    {
        return false;
    }
    if anchor.state == PublicationStateV1::Withheld {
        return false;
    }
    let Some(expected_carrier_sha256) = anchor.carrier_sha256 else {
        return false;
    };
    if build_distribution != crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE
        || build_git_dirty
        || !is_source_commit(build_git_commit)
        || !is_sha256(build_implementation_tree_sha256)
        || sha256_prefixed(carrier_bytes) != expected_carrier_sha256
    {
        return false;
    }

    let Ok(carrier) = serde_json::from_slice::<LocalAgentSafePublicationCarrierV1>(carrier_bytes)
    else {
        return false;
    };
    let Ok(receipt) = serde_json::from_slice::<AgentSafePublicationReceiptV1>(receipt_bytes) else {
        return false;
    };
    let Some(candidate) = carrier.candidate_facts.as_ref() else {
        return false;
    };
    let Ok(candidate_bytes) = serde_json::to_vec(candidate) else {
        return false;
    };
    let expected_components = components
        .iter()
        .map(|value| (*value).to_owned())
        .collect::<Vec<_>>();
    let evidence_locators_match = receipt.evidence.len() == evidence_locators.len()
        && receipt
            .evidence
            .iter()
            .zip(evidence_locators)
            .all(|(binding, (kind, path))| {
                binding.kind == *kind && binding.path == *path && is_nonzero_sha256(&binding.sha256)
            });
    carrier.schema_version == "snapback.local-agent-safe-publication.v2"
        && carrier.capability_id == capability_id
        && carrier.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
        && carrier.maturity == "experimental"
        && carrier.build_provenance_requirement == "known-clean-contributor-source"
        && carrier.implementation_digest_version.as_deref()
            == Some("snapback:agent-safe-implementation-tree:v2")
        && is_source_commit(&carrier.qualified_source_commit)
        && carrier.implementation_tree_sha256 == build_implementation_tree_sha256
        && carrier.candidate_facts_sha256 == sha256_prefixed(&candidate_bytes)
        && carrier.qualification_receipt_sha256 == sha256_prefixed(receipt_bytes)
        && candidate == exact_candidate
        && receipt.schema_version == "snapback.agent-safe-publication-receipt.v2"
        && receipt.capability_id == capability_id
        && receipt.implementation_digest_version == carrier.implementation_digest_version
        && receipt.qualified_source_commit == carrier.qualified_source_commit
        && receipt.implementation_tree_sha256 == carrier.implementation_tree_sha256
        && receipt.candidate_facts_sha256 == carrier.candidate_facts_sha256
        && receipt.qualified_target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
        && receipt.negative_target_profile_ids
            == [
                TARGET_PROFILE_CLOUDFLARE_DO_SQLITE_V8.to_owned(),
                TARGET_PROFILE_REMOTE_SERVICE_SQLITE_IBEX.to_owned(),
            ]
        && receipt.negative_build_distributions
            == [crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE.to_owned()]
        && receipt.qualified_components == expected_components
        && evidence_locators_match
}

fn sha256_prefixed(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn is_sha256(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|hex| hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit()))
}

fn is_nonzero_sha256(value: &str) -> bool {
    is_sha256(value) && value != format!("sha256:{}", "0".repeat(64))
}

fn is_source_commit(value: &str) -> bool {
    value.len() == 40 && value.chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn published_fixture(
        capability_id: &str,
        components: &[&str],
        evidence_locators: &[(&str, &str)],
        candidate: AgentSafeCapabilityFactsV1,
    ) -> (Vec<u8>, Vec<u8>, Vec<u8>, String) {
        let tree = format!("sha256:{}", "a".repeat(64));
        let commit = "b".repeat(40);
        let candidate_sha256 = sha256_prefixed(&serde_json::to_vec(&candidate).unwrap());
        let receipt = AgentSafePublicationReceiptV1 {
            schema_version: "snapback.agent-safe-publication-receipt.v2".to_owned(),
            capability_id: capability_id.to_owned(),
            qualified_source_commit: commit.clone(),
            implementation_digest_version: Some(
                "snapback:agent-safe-implementation-tree:v2".to_owned(),
            ),
            implementation_scope: None,
            selection_policy_sha256: None,
            implementation_tree_sha256: tree.clone(),
            candidate_facts_sha256: candidate_sha256.clone(),
            qualified_target_profile_id: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            negative_target_profile_ids: vec![
                TARGET_PROFILE_CLOUDFLARE_DO_SQLITE_V8.to_owned(),
                TARGET_PROFILE_REMOTE_SERVICE_SQLITE_IBEX.to_owned(),
            ],
            negative_build_distributions: vec![
                crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE.to_owned(),
            ],
            qualified_components: components.iter().map(|value| (*value).to_owned()).collect(),
            evidence: evidence_locators
                .iter()
                .map(|&(kind, path)| AgentSafeEvidenceBindingV1 {
                    kind: kind.to_owned(),
                    path: path.to_owned(),
                    sha256: format!("sha256:{}", "e".repeat(64)),
                })
                .collect(),
        };
        let receipt_bytes = serde_json::to_vec(&receipt).unwrap();
        let carrier = LocalAgentSafePublicationCarrierV1 {
            schema_version: "snapback.local-agent-safe-publication.v2".to_owned(),
            capability_id: capability_id.to_owned(),
            target_profile_id: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            maturity: "experimental".to_owned(),
            qualified_source_commit: commit,
            implementation_digest_version: Some(
                "snapback:agent-safe-implementation-tree:v2".to_owned(),
            ),
            implementation_tree_sha256: tree.clone(),
            candidate_facts_sha256: candidate_sha256,
            qualification_receipt_sha256: sha256_prefixed(&receipt_bytes),
            build_provenance_requirement: "known-clean-contributor-source".to_owned(),
            candidate_facts: Some(candidate),
        };
        let carrier_bytes = serde_json::to_vec(&carrier).unwrap();
        let anchor = LocalAgentSafePublicationAnchorV1 {
            schema_version: "snapback.local-capability-publication-anchor.v1".to_owned(),
            capability_id: capability_id.to_owned(),
            state: PublicationStateV1::Published,
            carrier_sha256: Some(sha256_prefixed(&carrier_bytes)),
        };
        (
            serde_json::to_vec(&anchor).unwrap(),
            carrier_bytes,
            receipt_bytes,
            tree,
        )
    }

    // @ref LLP 0162#source-owned-publication-carrier-amendment--2026-08-04
    // The live chain is inspected without selecting a lifecycle state. Branch
    // coverage comes from synthetic records, so publishing cannot make this
    // implementation-digest-covered test contradict its own fixture.
    fn assert_derived_chain_lifecycle_invariants(
        anchor_bytes: &[u8],
        carrier_bytes: &[u8],
        receipt_bytes: &[u8],
    ) -> PublicationStateV1 {
        let anchor: LocalAgentSafePublicationAnchorV1 =
            serde_json::from_slice(anchor_bytes).unwrap();
        let carrier: LocalAgentSafePublicationCarrierV1 =
            serde_json::from_slice(carrier_bytes).unwrap();
        let receipt: AgentSafePublicationReceiptV1 = serde_json::from_slice(receipt_bytes).unwrap();

        assert_eq!(
            anchor.schema_version,
            "snapback.local-capability-publication-anchor.v1"
        );
        assert_eq!(anchor.capability_id, DERIVED_FORK_ID);
        assert_eq!(carrier.capability_id, DERIVED_FORK_ID);
        assert_eq!(receipt.capability_id, DERIVED_FORK_ID);

        let carrier_uses_current_schema = match carrier.schema_version.as_str() {
            "snapback.local-agent-safe-publication.v1" => {
                assert_eq!(carrier.implementation_digest_version, None);
                false
            }
            "snapback.local-agent-safe-publication.v2" => {
                assert!(matches!(
                    carrier.implementation_digest_version.as_deref(),
                    Some(
                        "snapback:agent-safe-implementation-tree:v2"
                            | "snapback:agent-safe-implementation-tree:v3"
                    )
                ));
                true
            }
            other => panic!("unsupported derived carrier schema {other}"),
        };
        let (receipt_uses_current_schema, receipt_uses_scoped_evidence) =
            match receipt.schema_version.as_str() {
                "snapback.agent-safe-publication-receipt.v1" => {
                    assert_eq!(receipt.implementation_digest_version, None);
                    assert_eq!(receipt.implementation_scope, None);
                    assert_eq!(receipt.selection_policy_sha256, None);
                    (false, false)
                }
                "snapback.agent-safe-publication-receipt.v2" => {
                    assert_eq!(
                        receipt.implementation_digest_version.as_deref(),
                        Some("snapback:agent-safe-implementation-tree:v2")
                    );
                    assert_eq!(receipt.implementation_scope, None);
                    assert_eq!(receipt.selection_policy_sha256, None);
                    (true, false)
                }
                "snapback.agent-safe-publication-receipt.v3" => {
                    assert_eq!(
                        receipt.implementation_digest_version.as_deref(),
                        Some("snapback:agent-safe-implementation-tree:v3")
                    );
                    assert_eq!(
                        receipt.implementation_scope.as_ref(),
                        Some(&derived_fork_implementation_scope())
                    );
                    assert!(
                        receipt
                            .selection_policy_sha256
                            .as_deref()
                            .is_some_and(is_nonzero_sha256)
                    );
                    (true, true)
                }
                other => panic!("unsupported derived receipt schema {other}"),
            };
        assert_eq!(
            carrier.implementation_digest_version,
            receipt.implementation_digest_version
        );

        assert_eq!(
            carrier.target_profile_id,
            TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
        );
        assert_eq!(carrier.maturity, "experimental");
        assert_eq!(
            carrier.build_provenance_requirement,
            "known-clean-contributor-source"
        );
        assert!(is_source_commit(&carrier.qualified_source_commit));
        assert_eq!(
            carrier.qualified_source_commit,
            receipt.qualified_source_commit
        );
        assert!(is_sha256(&carrier.implementation_tree_sha256));
        assert_eq!(
            carrier.implementation_tree_sha256,
            receipt.implementation_tree_sha256
        );
        assert!(is_sha256(&carrier.candidate_facts_sha256));
        assert_eq!(
            carrier.candidate_facts_sha256,
            receipt.candidate_facts_sha256
        );
        let candidate = carrier
            .candidate_facts
            .as_ref()
            .expect("derived carrier must retain its exact candidate facts");
        assert_eq!(candidate, &derived_fork_target_candidate());
        assert_eq!(
            carrier.candidate_facts_sha256,
            sha256_prefixed(&serde_json::to_vec(candidate).unwrap())
        );
        assert_eq!(
            receipt.qualified_target_profile_id,
            TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
        );
        assert_eq!(
            receipt.negative_target_profile_ids,
            [
                TARGET_PROFILE_CLOUDFLARE_DO_SQLITE_V8.to_owned(),
                TARGET_PROFILE_REMOTE_SERVICE_SQLITE_IBEX.to_owned(),
            ]
        );
        assert_eq!(
            receipt.negative_build_distributions,
            [crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE.to_owned()]
        );
        assert_eq!(
            receipt.qualified_components,
            DERIVED_FORK_COMPONENTS.map(str::to_owned)
        );
        assert_eq!(receipt.evidence.len(), DERIVED_FORK_EVIDENCE_LOCATORS.len());
        for (index, (binding, (kind, path))) in receipt
            .evidence
            .iter()
            .zip(DERIVED_FORK_EVIDENCE_LOCATORS)
            .enumerate()
        {
            assert_eq!(binding.kind, kind);
            if receipt_uses_scoped_evidence {
                assert!(derived_fork_v3_evidence_path_matches(index, &binding.path));
            } else {
                assert_eq!(binding.path, path);
            }
            assert!(is_sha256(&binding.sha256));
            if anchor.state == PublicationStateV1::Published {
                assert!(is_nonzero_sha256(&binding.sha256));
            }
        }

        match anchor.state {
            PublicationStateV1::Withheld => {
                assert_eq!(anchor.carrier_sha256, None);
            }
            PublicationStateV1::Published => {
                assert!(carrier_uses_current_schema);
                assert!(receipt_uses_current_schema);
                assert_eq!(
                    carrier.qualification_receipt_sha256,
                    sha256_prefixed(receipt_bytes)
                );
                assert_eq!(
                    anchor.carrier_sha256.as_deref(),
                    Some(sha256_prefixed(carrier_bytes).as_str())
                );
                assert_ne!(carrier.qualified_source_commit, "0".repeat(40));
                assert!(is_nonzero_sha256(&carrier.implementation_tree_sha256));
                assert!(is_nonzero_sha256(&carrier.candidate_facts_sha256));
            }
        }
        anchor.state
    }

    fn legacy_withheld_derived_fixture() -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        let (_, carrier_bytes, receipt_bytes, _) = published_fixture(
            DERIVED_FORK_ID,
            DERIVED_FORK_COMPONENTS.as_slice(),
            DERIVED_FORK_EVIDENCE_LOCATORS.as_slice(),
            derived_fork_target_candidate(),
        );
        let mut receipt: serde_json::Value = serde_json::from_slice(&receipt_bytes).unwrap();
        let receipt_object = receipt.as_object_mut().unwrap();
        receipt_object.insert(
            "schemaVersion".to_owned(),
            serde_json::Value::String("snapback.agent-safe-publication-receipt.v1".to_owned()),
        );
        receipt_object.remove("implementationDigestVersion");
        let receipt_bytes = serde_json::to_vec(&receipt).unwrap();

        let mut carrier: serde_json::Value = serde_json::from_slice(&carrier_bytes).unwrap();
        let carrier_object = carrier.as_object_mut().unwrap();
        carrier_object.insert(
            "schemaVersion".to_owned(),
            serde_json::Value::String("snapback.local-agent-safe-publication.v1".to_owned()),
        );
        carrier_object.remove("implementationDigestVersion");
        carrier_object.insert(
            "qualificationReceiptSha256".to_owned(),
            serde_json::Value::String(sha256_prefixed(&receipt_bytes)),
        );
        let carrier_bytes = serde_json::to_vec(&carrier).unwrap();
        let anchor = LocalAgentSafePublicationAnchorV1 {
            schema_version: "snapback.local-capability-publication-anchor.v1".to_owned(),
            capability_id: DERIVED_FORK_ID.to_owned(),
            state: PublicationStateV1::Withheld,
            carrier_sha256: None,
        };
        (
            serde_json::to_vec(&anchor).unwrap(),
            carrier_bytes,
            receipt_bytes,
        )
    }

    #[test]
    fn embedded_storage_anchor_is_valid_and_may_publish_independently() {
        let storage_anchor: LocalAgentSafePublicationAnchorV1 =
            serde_json::from_slice(STORAGE_ANCHOR_BYTES).unwrap();
        assert_eq!(storage_anchor.capability_id, STORAGE_ID);
        match storage_anchor.state {
            PublicationStateV1::Withheld => {
                assert_eq!(storage_anchor.carrier_sha256, None);
                assert!(!storage_publication_verified());
            }
            PublicationStateV1::Published => {
                assert!(storage_anchor.carrier_sha256.is_some());
                assert!(storage_publication_verified());
            }
        }
    }

    #[test]
    fn derived_chain_invariants_hold_across_lifecycle_states() {
        let _live_state = assert_derived_chain_lifecycle_invariants(
            DERIVED_FORK_ANCHOR_BYTES,
            DERIVED_FORK_CARRIER_BYTES,
            DERIVED_FORK_RECEIPT_BYTES,
        );

        let (withheld_anchor, withheld_carrier, withheld_receipt) =
            legacy_withheld_derived_fixture();
        assert_eq!(
            assert_derived_chain_lifecycle_invariants(
                &withheld_anchor,
                &withheld_carrier,
                &withheld_receipt,
            ),
            PublicationStateV1::Withheld
        );

        let candidate = derived_fork_target_candidate();
        let (published_anchor, published_carrier, published_receipt, tree) = published_fixture(
            DERIVED_FORK_ID,
            DERIVED_FORK_COMPONENTS.as_slice(),
            DERIVED_FORK_EVIDENCE_LOCATORS.as_slice(),
            candidate.clone(),
        );
        assert_eq!(
            assert_derived_chain_lifecycle_invariants(
                &published_anchor,
                &published_carrier,
                &published_receipt,
            ),
            PublicationStateV1::Published
        );
        assert!(publication_verified_for(
            DERIVED_FORK_ID,
            DERIVED_FORK_COMPONENTS.as_slice(),
            DERIVED_FORK_EVIDENCE_LOCATORS.as_slice(),
            &candidate,
            &published_anchor,
            &published_carrier,
            &published_receipt,
            crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
            &"c".repeat(40),
            false,
            &tree,
        ));

        // The engine-owned capability-manifest tests cover target projection;
        // this owner test proves the lower publication chain remains closed.
        assert!(!derived_fork_publication_verified());
        for distribution in [
            crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
            crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE,
        ] {
            assert!(!derived_fork_publication_verified_for_distribution(
                distribution
            ));
        }
    }

    #[test]
    fn exact_storage_chain_qualifies_without_minting_derived_authority() {
        let candidate = storage_target_candidate();
        let (anchor, carrier, receipt, tree) = published_fixture(
            STORAGE_ID,
            STORAGE_COMPONENTS.as_slice(),
            STORAGE_EVIDENCE_LOCATORS.as_slice(),
            candidate.clone(),
        );
        assert!(publication_verified_for(
            STORAGE_ID,
            STORAGE_COMPONENTS.as_slice(),
            STORAGE_EVIDENCE_LOCATORS.as_slice(),
            &candidate,
            &anchor,
            &carrier,
            &receipt,
            crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
            &"c".repeat(40),
            false,
            &tree,
        ));
        assert!(!derived_fork_publication_verified_for_distribution(
            crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
        ));
    }

    #[test]
    fn provenance_tampering_and_cross_component_substitution_fail_closed() {
        let candidate = storage_target_candidate();
        let (anchor, carrier, receipt, tree) = published_fixture(
            STORAGE_ID,
            STORAGE_COMPONENTS.as_slice(),
            STORAGE_EVIDENCE_LOCATORS.as_slice(),
            candidate.clone(),
        );
        let verify = |id: &str,
                      candidate: &AgentSafeCapabilityFactsV1,
                      anchor: &[u8],
                      carrier: &[u8],
                      receipt: &[u8],
                      distribution: &str,
                      commit: &str,
                      dirty: bool,
                      digest: &str| {
            publication_verified_for(
                id,
                STORAGE_COMPONENTS.as_slice(),
                STORAGE_EVIDENCE_LOCATORS.as_slice(),
                candidate,
                anchor,
                carrier,
                receipt,
                distribution,
                commit,
                dirty,
                digest,
            )
        };
        assert!(!verify(
            STORAGE_ID,
            &candidate,
            &anchor,
            &carrier,
            &receipt,
            crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE,
            &"c".repeat(40),
            false,
            &tree,
        ));
        assert!(!verify(
            STORAGE_ID,
            &candidate,
            &anchor,
            &carrier,
            &receipt,
            crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
            "unknown",
            false,
            &tree,
        ));
        assert!(!verify(
            STORAGE_ID,
            &candidate,
            &anchor,
            &carrier,
            &receipt,
            crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
            &"c".repeat(40),
            true,
            &tree,
        ));
        assert!(!verify(
            STORAGE_ID,
            &candidate,
            &anchor,
            &carrier,
            &receipt,
            crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
            &"c".repeat(40),
            false,
            &format!("sha256:{}", "d".repeat(64)),
        ));
        assert!(!publication_verified_for(
            DERIVED_FORK_ID,
            DERIVED_FORK_COMPONENTS.as_slice(),
            DERIVED_FORK_EVIDENCE_LOCATORS.as_slice(),
            &derived_fork_target_candidate(),
            &anchor,
            &carrier,
            &receipt,
            crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
            &"c".repeat(40),
            false,
            &tree,
        ));

        for index in [0, carrier.len() / 2, carrier.len() - 1] {
            let mut tampered = carrier.clone();
            tampered[index] ^= 1;
            assert!(!verify(
                STORAGE_ID,
                &candidate,
                &anchor,
                &tampered,
                &receipt,
                crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
                &"c".repeat(40),
                false,
                &tree,
            ));
        }
    }
}
