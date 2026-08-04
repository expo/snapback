//! Fail-closed source authority for LLP 0162's two independently publishable
//! local agent-safe capability components.
//!
//! Each component owns an anchor -> carrier -> qualification-receipt chain.
//! The checked-in anchors are valid `withheld` records at frozen C, so merely
//! compiling this machinery cannot advertise either capability.

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
const DERIVED_FORK_ID: &str = "agent_safe_derived_deployment_fork_v1";
const STORAGE_COMPONENTS: [&str; 6] = [
    "ordinaryMutationHostPlanEnvelope",
    "ordinaryMutationIbexBufferedEnvelope",
    "hostChildMutationHostPlanEnvelope",
    "hostChildMutationIbexBufferedEnvelope",
    "generatedOwnedCrudOwnerCreateHostPlanExplanation",
    "generatedOwnedCrudOwnerUpdateHostPlanExplanation",
];
const DERIVED_FORK_COMPONENTS: [&str; 1] = ["derivedDeploymentForkSafetyV1"];
const EVIDENCE_LOCATORS: [(&str, &str); 6] = [
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

const STORAGE_ANCHOR_BYTES: &[u8] =
    include_bytes!("local-agent-safe-storage-publication.anchor.json");
const STORAGE_CARRIER_BYTES: &[u8] =
    include_bytes!("local-agent-safe-storage-publication.carrier.json");
const STORAGE_RECEIPT_BYTES: &[u8] = include_bytes!(
    "../tests/acceptance/receipts/agent-safe-storage-publication.2026-08-04.v1.json"
);
const DERIVED_FORK_ANCHOR_BYTES: &[u8] =
    include_bytes!("local-agent-safe-derived-deployment-fork-publication.anchor.json");
const DERIVED_FORK_CARRIER_BYTES: &[u8] =
    include_bytes!("local-agent-safe-derived-deployment-fork-publication.carrier.json");
const DERIVED_FORK_RECEIPT_BYTES: &[u8] = include_bytes!(
    "../tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json"
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
    implementation_tree_sha256: String,
    candidate_facts_sha256: String,
    qualified_target_profile_id: String,
    negative_target_profile_ids: Vec<String>,
    negative_build_distributions: Vec<String>,
    qualified_components: Vec<String>,
    evidence: Vec<AgentSafeEvidenceBindingV1>,
}

#[derive(Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentSafeEvidenceBindingV1 {
    kind: String,
    path: String,
    sha256: String,
}

pub(crate) fn storage_target_candidate() -> AgentSafeCapabilityFactsV1 {
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

pub(crate) fn derived_fork_target_candidate() -> AgentSafeCapabilityFactsV1 {
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

pub(crate) fn storage_publication_verified() -> bool {
    storage_publication_verified_for_distribution(crate::identity::build_distribution())
}

pub(crate) fn storage_publication_verified_for_distribution(build_distribution: &str) -> bool {
    embedded_publication_verified(
        STORAGE_ID,
        STORAGE_COMPONENTS.as_slice(),
        &storage_target_candidate(),
        STORAGE_ANCHOR_BYTES,
        STORAGE_CARRIER_BYTES,
        STORAGE_RECEIPT_BYTES,
        build_distribution,
    )
}

pub(crate) fn derived_fork_publication_verified() -> bool {
    derived_fork_publication_verified_for_distribution(crate::identity::build_distribution())
}

pub(crate) fn derived_fork_publication_verified_for_distribution(build_distribution: &str) -> bool {
    embedded_publication_verified(
        DERIVED_FORK_ID,
        DERIVED_FORK_COMPONENTS.as_slice(),
        &derived_fork_target_candidate(),
        DERIVED_FORK_ANCHOR_BYTES,
        DERIVED_FORK_CARRIER_BYTES,
        DERIVED_FORK_RECEIPT_BYTES,
        build_distribution,
    )
}

fn embedded_publication_verified(
    capability_id: &str,
    components: &[&str],
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
    let evidence_locators_match = receipt.evidence.len() == EVIDENCE_LOCATORS.len()
        && receipt
            .evidence
            .iter()
            .zip(EVIDENCE_LOCATORS)
            .all(|(binding, (kind, path))| {
                binding.kind == kind && binding.path == path && is_nonzero_sha256(&binding.sha256)
            });
    carrier.schema_version == "snapback.local-agent-safe-publication.v1"
        && carrier.capability_id == capability_id
        && carrier.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
        && carrier.maturity == "experimental"
        && carrier.build_provenance_requirement == "known-clean-contributor-source"
        && is_source_commit(&carrier.qualified_source_commit)
        && carrier.implementation_tree_sha256 == build_implementation_tree_sha256
        && carrier.candidate_facts_sha256 == sha256_prefixed(&candidate_bytes)
        && carrier.qualification_receipt_sha256 == sha256_prefixed(receipt_bytes)
        && candidate == exact_candidate
        && receipt.schema_version == "snapback.agent-safe-publication-receipt.v1"
        && receipt.capability_id == capability_id
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
        candidate: AgentSafeCapabilityFactsV1,
    ) -> (Vec<u8>, Vec<u8>, Vec<u8>, String) {
        let tree = format!("sha256:{}", "a".repeat(64));
        let commit = "b".repeat(40);
        let candidate_sha256 = sha256_prefixed(&serde_json::to_vec(&candidate).unwrap());
        let receipt = AgentSafePublicationReceiptV1 {
            schema_version: "snapback.agent-safe-publication-receipt.v1".to_owned(),
            capability_id: capability_id.to_owned(),
            qualified_source_commit: commit.clone(),
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
            evidence: EVIDENCE_LOCATORS
                .into_iter()
                .map(|(kind, path)| AgentSafeEvidenceBindingV1 {
                    kind: kind.to_owned(),
                    path: path.to_owned(),
                    sha256: format!("sha256:{}", "e".repeat(64)),
                })
                .collect(),
        };
        let receipt_bytes = serde_json::to_vec(&receipt).unwrap();
        let carrier = LocalAgentSafePublicationCarrierV1 {
            schema_version: "snapback.local-agent-safe-publication.v1".to_owned(),
            capability_id: capability_id.to_owned(),
            target_profile_id: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            maturity: "experimental".to_owned(),
            qualified_source_commit: commit,
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

    #[test]
    fn embedded_frozen_c_anchors_are_valid_and_withheld_independently() {
        assert!(!storage_publication_verified());
        assert!(!derived_fork_publication_verified());
        for (bytes, capability) in [
            (STORAGE_ANCHOR_BYTES, STORAGE_ID),
            (DERIVED_FORK_ANCHOR_BYTES, DERIVED_FORK_ID),
        ] {
            let anchor: LocalAgentSafePublicationAnchorV1 = serde_json::from_slice(bytes).unwrap();
            assert_eq!(anchor.capability_id, capability);
            assert_eq!(anchor.state, PublicationStateV1::Withheld);
            assert_eq!(anchor.carrier_sha256, None);
        }
    }

    #[test]
    fn exact_storage_and_derived_chains_qualify_independently() {
        for (id, components, candidate) in [
            (
                STORAGE_ID,
                STORAGE_COMPONENTS.as_slice(),
                storage_target_candidate(),
            ),
            (
                DERIVED_FORK_ID,
                DERIVED_FORK_COMPONENTS.as_slice(),
                derived_fork_target_candidate(),
            ),
        ] {
            let (anchor, carrier, receipt, tree) =
                published_fixture(id, components, candidate.clone());
            assert!(publication_verified_for(
                id,
                components,
                &candidate,
                &anchor,
                &carrier,
                &receipt,
                crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
                &"c".repeat(40),
                false,
                &tree,
            ));
        }
    }

    #[test]
    fn provenance_tampering_and_cross_component_substitution_fail_closed() {
        let candidate = storage_target_candidate();
        let (anchor, carrier, receipt, tree) =
            published_fixture(STORAGE_ID, STORAGE_COMPONENTS.as_slice(), candidate.clone());
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
