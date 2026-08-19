use crate::diagnostic::SnapbackResult;
use crate::manifest::{FunctionResultContract, ResultValueContract};
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaProjectionPlanV1 {
    pub occurrences: Vec<MediaProjectionSemanticOccurrenceV1>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaProjectionSemanticOccurrenceV1 {
    pub path: Vec<String>,
    pub node: ResultValueContract,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MediaProjectionInvocationScopeV1 {
    pub process_epoch: String,
    pub invocation_nonce: u64,
    pub pinned_snapshot: u64,
}

impl MediaProjectionInvocationScopeV1 {
    pub fn for_test(
        process_epoch: impl Into<String>,
        invocation_nonce: u64,
        pinned_snapshot: u64,
    ) -> Self {
        Self {
            process_epoch: process_epoch.into(),
            invocation_nonce,
            pinned_snapshot,
        }
    }
}

/// Closed representation of the identity used by the authoritative storage
/// lane. An absent client identity is a positive fact, never `None == None`.
///
/// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut — the
/// proof binds the exact commit identity, including lanes that deliberately
/// commit without one.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MediaProjectionClientMutationIdentityV1 {
    ClientMutation(String),
    NoClientIdentity,
}

impl MediaProjectionClientMutationIdentityV1 {
    pub fn from_digest(digest: Option<&str>) -> Self {
        match digest {
            Some(digest) => Self::ClientMutation(digest.to_owned()),
            None => Self::NoClientIdentity,
        }
    }
}

/// Closed host-only identity checked independently at storage admission.
/// None of these fields enter handler or settlement bytes.
///
/// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut — the
/// staged proof is scoped to one process invocation, prepared authority,
/// function generation, result contract, snapshot, and request identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MediaProjectionProofBindingV1 {
    pub process_epoch: String,
    pub invocation_nonce: u64,
    pub principal_binding: String,
    pub authority_instance_binding: String,
    pub function_id: String,
    pub function_artifact_generation: String,
    pub result_contract_hash: String,
    pub pinned_snapshot: u64,
    pub request_identity: String,
    pub client_mutation_identity: MediaProjectionClientMutationIdentityV1,
}

#[derive(Debug)]
pub struct StagedMediaProjectionProofV1 {
    pub plan: MediaProjectionPlanV1,
    pub result_contract_hash: String,
    pub binding: MediaProjectionProofBindingV1,
    occurrences: Vec<MediaProjectionProofOccurrenceV1>,
}

impl StagedMediaProjectionProofV1 {
    pub fn new(
        plan: MediaProjectionPlanV1,
        result_contract_hash: String,
        binding: MediaProjectionProofBindingV1,
        occurrences: Vec<MediaProjectionProofOccurrenceV1>,
    ) -> Self {
        Self {
            plan,
            result_contract_hash,
            binding,
            occurrences,
        }
    }

    /// Preview borrows the exact carrier. There is no cloneable proof handle
    /// and therefore no second authority to refresh or consume.
    pub fn borrow_occurrences(&self) -> &[MediaProjectionProofOccurrenceV1] {
        &self.occurrences
    }

    /// The authoritative boundary takes ownership of the proof and consumes
    /// its occurrences once. Cancellation or a same-id winner drops the sole
    /// owner, so retry must execute again and mint a fresh invocation nonce.
    pub fn consume_occurrences(self) -> SnapbackResult<Vec<MediaProjectionProofOccurrenceV1>> {
        Ok(self.occurrences)
    }
}

#[derive(Clone, Debug)]
pub struct MediaProjectionProofOccurrenceV1 {
    pub path: Vec<String>,
    pub source_table: String,
    pub source_field: String,
    pub source_field_generation: String,
    pub source_row_id: String,
    pub asset_id: String,
    pub kind: crate::contract_types::MediaKindV1,
    pub snapshot_version: u64,
    pub related_fact_digest: String,
}

pub fn is_concrete_function_artifact_generation(generation: &str) -> bool {
    let digest = generation.strip_prefix("sha256:").unwrap_or_default();
    digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub fn media_projection_plan(contract: &FunctionResultContract) -> MediaProjectionPlanV1 {
    let mut occurrences = Vec::new();
    match contract {
        FunctionResultContract::Documents { document, .. }
        | FunctionResultContract::Records {
            record: document, ..
        }
        | FunctionResultContract::LegacyQueryRowsV0 { row: document } => {
            collect_media_plan_value(document, &mut vec!["*".to_owned()], &mut occurrences);
        }
        FunctionResultContract::Document { document, .. }
        | FunctionResultContract::Value { value: document } => {
            collect_media_plan_value(document, &mut Vec::new(), &mut occurrences);
        }
        FunctionResultContract::Unknown => {}
    }
    MediaProjectionPlanV1 { occurrences }
}

fn collect_media_plan_value(
    contract: &ResultValueContract,
    path: &mut Vec<String>,
    output: &mut Vec<MediaProjectionSemanticOccurrenceV1>,
) {
    match contract {
        ResultValueContract::MediaRefV1 { .. } => {
            output.push(MediaProjectionSemanticOccurrenceV1 {
                path: path.clone(),
                node: contract.clone(),
            })
        }
        ResultValueContract::Array { element, .. } => {
            path.push("*".to_owned());
            collect_media_plan_value(element, path, output);
            path.pop();
        }
        ResultValueContract::Tuple { elements } => {
            for (index, element) in elements.iter().enumerate() {
                path.push(index.to_string());
                collect_media_plan_value(element, path, output);
                path.pop();
            }
        }
        ResultValueContract::Union { variants } => {
            for variant in variants {
                collect_media_plan_value(variant, path, output);
            }
        }
        ResultValueContract::Object { fields, .. } => {
            for field in fields {
                path.push(field.name.clone());
                collect_media_plan_value(&field.value, path, output);
                path.pop();
            }
        }
        _ => {}
    }
}
