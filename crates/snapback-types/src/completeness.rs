use serde::{Deserialize, Serialize};
use schemars::JsonSchema;

pub use crate::auth::invalidation::AuthorizationWitnessRecordV1;
pub use crate::contract_types::CompletenessProofV1;

/// Client-store manifest for one composed first-to-terminal page set.  The
/// identity is the digest of the closed LLP 0157 `PageSetIdentityRecordV1`;
/// retaining the ordered proof digests beside it lets the client reproduce
/// that record from its already-verified fragments before committing the set.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageSetManifestV1 {
    pub identity: String,
    pub ordered_proof_digests: Vec<String>,
}
