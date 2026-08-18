//! Server-side completeness proof identities and Ed25519 issuance.
//!
//! The records in this module intentionally mirror the closed LLP 0157 D2/D3
//! JSON vocabulary.  In particular, signatures are over the JCS record with
//! `signature` omitted; the generated activation artifact, not a proof or the
//! mutable materialization store, is the verification trust root.

use anyhow::{Context as _, Result, anyhow, bail};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::signature::{Ed25519KeyPair, KeyPair as _, UnparsedPublicKey};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

use crate::auth::invalidation::CompositeWitness;
use crate::manifest::ArtifactGeneration;

// The pure proof/witness shapes live on lower-ranked owners so leaf and sync
// consumers never import upward; their derivation, validation, and issuance
// logic stays here with the signing coordinator (LLP 0199 worklist item 7).
pub use crate::auth::invalidation::AuthorizationWitnessRecordV1;
pub use crate::contract_types::{
    CompletenessProofV1, CursorEndV1, PageIdentityV1, ProofNodeIdentityV1, ProofVersionV1,
    UnsignedCompletenessProofV1,
};

pub const PROOF_KEYRING_FILE_NAME: &str = "completeness-proof-keyring.json";
pub const TRUSTED_COMPOSITION_ACTIVATION_FILE_NAME: &str = "trusted-composition-activation.json";
const PROOF_KEYRING_FORMAT_VERSION: u32 = 1;
const PROOF_KEYRING_MAX_BYTES: usize = 64 * 1024;
const PROOF_SIGNATURE_DOMAIN: &[u8] = b"snapback:completeness-proof:v1:";
const PROOF_DIGEST_DOMAIN: &[u8] = b"snapback:completeness-proof-digest:v1:";
const PROOF_KEY_MANIFEST_DOMAIN: &[u8] = b"snapback:completeness-proof-keys:v1:";
const ACTIVATION_V1_DOMAIN: &[u8] = b"snapback:composition-activation:v1:";
const ACTIVATION_V2_DOMAIN: &[u8] = b"snapback:composition-activation:v2:";
const AUTHORIZATION_WITNESS_DOMAIN: &[u8] = b"snapback:authorization-witness:v1:";
const ESTABLISHED_RESULT_DOMAIN: &[u8] = b"snapback:established-result:v1:";
const OPAQUE_CREDENTIAL_DOMAIN: &[u8] = b"snapback:opaque-credential:v1:";
const PAGE_IDENTITY_DOMAIN: &[u8] = b"snapback:page-identity:v1:";
const NODE_PAGE_BOUNDARY_DOMAIN: &[u8] = b"snapback:node-page-boundary:v1:";
const PAGE_BOUNDARY_VECTOR_DOMAIN: &[u8] = b"snapback:page-boundary-vector:v1:";
const PAGE_SET_DOMAIN: &[u8] = b"snapback:page-set:v1:";

fn jcs_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let value = serde_json::to_value(value)?;
    Ok(crate::rqs_contract::jcs(&value)
        .map_err(|err| anyhow!("JCS refusal: {err:?}"))?
        .into_bytes())
}

fn domain_digest<T: Serialize>(domain: &[u8], value: &T) -> Result<String> {
    let mut hash = Sha256::new();
    hash.update(domain);
    hash.update(jcs_bytes(value)?);
    Ok(format!("sha256:{:x}", hash.finalize()))
}

fn wire_digest(domain: &[u8], bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(domain);
    hash.update(bytes);
    format!("sha256:{:x}", hash.finalize())
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProofKeyManifestEntryV1 {
    pub proof_key_id: String,
    pub algorithm: String,
    pub public_key_base64url: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProofKeyManifestV1 {
    pub format: String,
    pub keys: Vec<ProofKeyManifestEntryV1>,
}

impl ProofKeyManifestV1 {
    pub fn digest(&self) -> Result<String> {
        validate_manifest(self)?;
        domain_digest(PROOF_KEY_MANIFEST_DOMAIN, self)
    }
}

fn validate_manifest(manifest: &ProofKeyManifestV1) -> Result<()> {
    if manifest.format != "snapback.completeness-proof-keys.v1" {
        bail!("unsupported completeness proof key manifest format")
    }
    let mut previous: Option<&str> = None;
    for key in &manifest.keys {
        if key.algorithm != "Ed25519" {
            bail!("unsupported completeness proof algorithm")
        }
        if key.proof_key_id.is_empty()
            || previous.is_some_and(|prior| prior >= key.proof_key_id.as_str())
        {
            bail!("completeness proof key ids are not unique and ascending")
        }
        let public = URL_SAFE_NO_PAD
            .decode(&key.public_key_base64url)
            .context("invalid proof public-key base64url")?;
        if public.len() != 32 || URL_SAFE_NO_PAD.encode(&public) != key.public_key_base64url {
            bail!("proof public key is not canonical 32-byte base64url")
        }
        previous = Some(&key.proof_key_id);
    }
    if manifest.keys.is_empty() {
        bail!("proof key manifest has no verification key")
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompositionActivationIdentityV1 {
    pub format: String,
    pub database_id: String,
    pub deployment_id: String,
    pub target_profile_id: String,
    pub auth_mode: String,
    pub expected_generation: ArtifactGeneration,
    pub proof_key_manifest_digest: String,
}

impl CompositionActivationIdentityV1 {
    pub fn activation_hash(&self) -> Result<String> {
        if self.format != "snapback.composition-activation.v1"
            || !matches!(self.auth_mode.as_str(), "dev" | "sessions")
            || !self.proof_key_manifest_digest.starts_with("sha256:")
        {
            bail!("invalid composition activation identity")
        }
        domain_digest(ACTIVATION_V1_DOMAIN, self)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompositionActivationIdentityV2 {
    pub format: String,
    pub database_id: String,
    pub deployment_id: String,
    pub target_profile_id: String,
    pub auth_mode: String,
    pub authored_source_hash: String,
    pub minted_generation: ArtifactGeneration,
    pub proof_key_manifest_digest: String,
}

impl CompositionActivationIdentityV2 {
    pub fn activation_hash(&self) -> Result<String> {
        if self.format != "snapback.composition-activation.v2"
            || !matches!(self.auth_mode.as_str(), "dev" | "sessions")
            || !self.proof_key_manifest_digest.starts_with("sha256:")
            || !is_sha256_digest(&self.authored_source_hash)
        {
            bail!("invalid composition activation identity")
        }
        domain_digest(ACTIVATION_V2_DOMAIN, self)
    }
}

// @ref LLP 0157#amendment--2026-08-10-toolchain-stable-activation-identity-ruled
// — the trusted root remains the v1 proof-key carrier while its closed
// activation identity validates under exactly one of the two versioned rules.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum CompositionActivationIdentity {
    V1(CompositionActivationIdentityV1),
    V2(CompositionActivationIdentityV2),
}

impl CompositionActivationIdentity {
    pub fn activation_hash(&self) -> Result<String> {
        match self {
            Self::V1(activation) => activation.activation_hash(),
            Self::V2(activation) => activation.activation_hash(),
        }
    }

    pub fn database_id(&self) -> &str {
        match self {
            Self::V1(activation) => &activation.database_id,
            Self::V2(activation) => &activation.database_id,
        }
    }

    pub fn target_profile_id(&self) -> &str {
        match self {
            Self::V1(activation) => &activation.target_profile_id,
            Self::V2(activation) => &activation.target_profile_id,
        }
    }

    pub fn auth_mode(&self) -> &str {
        match self {
            Self::V1(activation) => &activation.auth_mode,
            Self::V2(activation) => &activation.auth_mode,
        }
    }

    pub fn proof_key_manifest_digest(&self) -> &str {
        match self {
            Self::V1(activation) => &activation.proof_key_manifest_digest,
            Self::V2(activation) => &activation.proof_key_manifest_digest,
        }
    }

    pub fn expected_generation_v1(&self) -> Option<&ArtifactGeneration> {
        match self {
            Self::V1(activation) => Some(&activation.expected_generation),
            Self::V2(_) => None,
        }
    }

    pub fn authored_source_hash_v2(&self) -> Option<&str> {
        match self {
            Self::V1(_) => None,
            Self::V2(activation) => Some(&activation.authored_source_hash),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrustedCompositionActivationV1 {
    pub format: String,
    pub activation: CompositionActivationIdentity,
    pub activation_hash: String,
    pub proof_keys: ProofKeyManifestV1,
}

impl TrustedCompositionActivationV1 {
    /// Compatibility constructor for committed v1 fixtures and activations.
    pub fn prepare(
        database_id: impl Into<String>,
        deployment_id: impl Into<String>,
        target_profile_id: impl Into<String>,
        auth_mode: impl Into<String>,
        expected_generation: ArtifactGeneration,
        proof_keys: ProofKeyManifestV1,
    ) -> Result<Self> {
        let activation = CompositionActivationIdentity::V1(CompositionActivationIdentityV1 {
            format: "snapback.composition-activation.v1".to_owned(),
            database_id: database_id.into(),
            deployment_id: deployment_id.into(),
            target_profile_id: target_profile_id.into(),
            auth_mode: auth_mode.into(),
            expected_generation,
            proof_key_manifest_digest: proof_keys.digest()?,
        });
        let activation_hash = activation.activation_hash()?;
        Ok(Self {
            format: "snapback.trusted-composition-activation.v1".to_owned(),
            activation,
            activation_hash,
            proof_keys,
        })
    }

    pub fn prepare_v2(
        database_id: impl Into<String>,
        deployment_id: impl Into<String>,
        target_profile_id: impl Into<String>,
        auth_mode: impl Into<String>,
        authored_source_hash: impl Into<String>,
        minted_generation: ArtifactGeneration,
        proof_keys: ProofKeyManifestV1,
    ) -> Result<Self> {
        let activation = CompositionActivationIdentity::V2(CompositionActivationIdentityV2 {
            format: "snapback.composition-activation.v2".to_owned(),
            database_id: database_id.into(),
            deployment_id: deployment_id.into(),
            target_profile_id: target_profile_id.into(),
            auth_mode: auth_mode.into(),
            authored_source_hash: authored_source_hash.into(),
            minted_generation,
            proof_key_manifest_digest: proof_keys.digest()?,
        });
        let activation_hash = activation.activation_hash()?;
        Ok(Self {
            format: "snapback.trusted-composition-activation.v1".to_owned(),
            activation,
            activation_hash,
            proof_keys,
        })
    }

    pub fn validate(&self) -> Result<()> {
        if self.format != "snapback.trusted-composition-activation.v1" {
            bail!("unsupported trusted composition activation format")
        }
        if self.proof_keys.digest()? != self.activation.proof_key_manifest_digest() {
            bail!("trusted activation proof-key manifest digest mismatch")
        }
        if self.activation.activation_hash()? != self.activation_hash {
            bail!("trusted activation hash mismatch")
        }
        Ok(())
    }
}

impl AuthorizationWitnessRecordV1 {
    pub fn new(query_instance_id: u64, composite_witness: CompositeWitness) -> Result<Self> {
        if query_instance_id == 0 || query_instance_id > 9_007_199_254_740_991 {
            bail!("query instance id is not a positive portable safe integer")
        }
        if composite_witness.authorization.epoch > 9_007_199_254_740_991
            || composite_witness
                .data
                .as_ref()
                .is_some_and(|data| data.min_commit_version > 9_007_199_254_740_991)
        {
            bail!("authorization witness counters are not portable safe integers")
        }
        Ok(Self {
            format: "snapback.authorization-witness.v1".to_owned(),
            query_instance_id,
            composite_witness,
        })
    }

    pub fn digest(&self) -> Result<String> {
        domain_digest(AUTHORIZATION_WITNESS_DOMAIN, self)
    }
}

impl CursorEndV1 {
    pub fn input(profile_id: &str, wire: Option<&str>) -> Self {
        match wire {
            None => Self::First,
            Some(wire) => Self::Cursor {
                profile_id: profile_id.to_owned(),
                digest: opaque_credential_digest(wire.as_bytes()),
            },
        }
    }

    pub fn output(profile_id: &str, wire: Option<&str>) -> Self {
        match wire {
            None => Self::Terminal,
            Some(wire) => Self::Cursor {
                profile_id: profile_id.to_owned(),
                digest: opaque_credential_digest(wire.as_bytes()),
            },
        }
    }
}

impl PageIdentityV1 {
    pub fn digest(&self) -> Result<String> {
        self.validate()?;
        domain_digest(PAGE_IDENTITY_DOMAIN, self)
    }

    fn validate(&self) -> Result<()> {
        let validate_cursor = |cursor: &CursorEndV1, input: bool| -> Result<()> {
            match cursor {
                CursorEndV1::First if input => Ok(()),
                CursorEndV1::Terminal if !input => Ok(()),
                CursorEndV1::Cursor { profile_id, digest }
                    if matches!(
                        profile_id.as_str(),
                        "relational-query.v1"
                            | "bounded-children.v1"
                            | "snapshot-batch.v1"
                            | "snapshot-batch.v2"
                    ) && is_sha256_digest(digest) =>
                {
                    Ok(())
                }
                _ => bail!("page identity has an inadmissible cursor end"),
            }
        };
        match self {
            Self::SealedTerminal { input, output } => {
                validate_cursor(input, true)?;
                if !matches!(output, CursorEndV1::Terminal) {
                    bail!("sealed page output is not terminal")
                }
            }
            Self::Visible {
                input,
                boundary_vector_digest,
                output,
            } => {
                validate_cursor(input, true)?;
                validate_cursor(output, false)?;
                if !is_sha256_digest(boundary_vector_digest) {
                    bail!("visible page boundary-vector digest is invalid")
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum NodePageBoundaryV1 {
    #[serde(rename = "relational-query.v1")]
    RelationalQuery {
        #[serde(rename = "orderFields")]
        order_fields: Vec<String>,
        boundary: Vec<Value>,
        #[serde(rename = "rowId")]
        row_id: String,
    },
    #[serde(rename = "bounded-children.v1")]
    BoundedChildren {
        #[serde(rename = "orderFields")]
        order_fields: Vec<String>,
        boundary: Vec<Value>,
        #[serde(rename = "rowId")]
        row_id: String,
    },
}

impl NodePageBoundaryV1 {
    fn validate(&self) -> Result<()> {
        let (order_fields, boundary, row_id) = match self {
            Self::RelationalQuery {
                order_fields,
                boundary,
                row_id,
            }
            | Self::BoundedChildren {
                order_fields,
                boundary,
                row_id,
            } => (order_fields, boundary, row_id),
        };
        if order_fields.len() != boundary.len() || row_id.is_empty() {
            bail!("node page boundary does not match its owner order")
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum NodeBoundaryStateV1 {
    Terminal,
    Boundary {
        #[serde(rename = "boundaryDigest")]
        boundary_digest: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageBoundaryVectorNodeV1 {
    pub position: u64,
    pub state: NodeBoundaryStateV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageBoundaryVectorV1 {
    pub format: String,
    pub profile_id: String,
    pub nodes: Vec<PageBoundaryVectorNodeV1>,
}

pub fn node_page_boundary_digest(
    position: u64,
    class_id: &str,
    class_version: u64,
    boundary: &NodePageBoundaryV1,
) -> Result<String> {
    boundary.validate()?;
    domain_digest(
        NODE_PAGE_BOUNDARY_DOMAIN,
        &serde_json::json!({
            "position": position,
            "classId": class_id,
            "classVersion": class_version,
            "boundary": boundary,
        }),
    )
}

impl PageBoundaryVectorV1 {
    pub fn digest(&self) -> Result<String> {
        if self.format != "snapback.page-boundary-vector.v1"
            || self
                .nodes
                .iter()
                .enumerate()
                .any(|(position, node)| node.position != position as u64)
        {
            bail!("page boundary vector is not canonical")
        }
        domain_digest(PAGE_BOUNDARY_VECTOR_DOMAIN, self)
    }
}

pub fn opaque_credential_digest(wire: &[u8]) -> String {
    wire_digest(OPAQUE_CREDENTIAL_DOMAIN, wire)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultDigestPreimage<'a> {
    encoding_id: &'static str,
    bytes_base64url: &'a str,
}

pub fn result_digest_v1(established_result: &Value) -> Result<String> {
    let result_bytes = crate::rqs_contract::jcs(established_result)
        .map_err(|err| anyhow!("established-result JCS refusal: {err:?}"))?;
    let encoded = URL_SAFE_NO_PAD.encode(result_bytes.as_bytes());
    domain_digest(
        ESTABLISHED_RESULT_DOMAIN,
        &ResultDigestPreimage {
            encoding_id: "established-result-jcs.v1",
            bytes_base64url: &encoded,
        },
    )
}

impl CompletenessProofV1 {
    pub fn preimage(&self) -> Result<Vec<u8>> {
        let mut bytes = PROOF_SIGNATURE_DOMAIN.to_vec();
        bytes.extend(jcs_bytes(&UnsignedCompletenessProofV1::from(self.clone()))?);
        Ok(bytes)
    }

    pub fn digest(&self) -> Result<String> {
        domain_digest(PROOF_DIGEST_DOMAIN, self)
    }
}

pub fn fresh_batch_identity() -> Result<String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).context("could not mint completeness batch identity")?;
    Ok(format!("sbbi1.{}", URL_SAFE_NO_PAD.encode(bytes)))
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedProofKeyringV1 {
    format_version: u32,
    keys: Vec<PersistedProofKeyV1>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedProofKeyV1 {
    proof_key_id: String,
    public_key_base64url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    seed_base64url: Option<String>,
    created_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    retired_at_ms: Option<u64>,
}

struct ProofKey {
    proof_key_id: String,
    public_key: [u8; 32],
    seed: Option<Zeroizing<[u8; 32]>>,
    created_at_ms: u64,
    retired_at_ms: Option<u64>,
}

/// Dedicated server-only Ed25519 custody.  The persisted ring is an
/// owner-only database sidecar, matching resume-token custody without sharing
/// its symmetric roots.  Rotation is an explicit activation-preparation step:
/// changing this manifest necessarily changes the trusted activation.
pub struct ProofKeyring {
    path: Option<PathBuf>,
    keys: Vec<ProofKey>,
}

impl ProofKeyring {
    pub fn in_memory(now_ms: u64) -> Result<Self> {
        let mut ring = Self {
            path: None,
            keys: Vec::new(),
        };
        ring.mint_active(now_ms)?;
        Ok(ring)
    }

    pub fn load_or_create(path: PathBuf, now_ms: u64) -> Result<Self> {
        let keys = match crate::secure_file::read_owner_only(&path) {
            Ok(bytes) if bytes.len() <= PROOF_KEYRING_MAX_BYTES => {
                let persisted: PersistedProofKeyringV1 = serde_json::from_slice(&bytes)
                    .context("completeness proof keyring is not valid JSON")?;
                if persisted.format_version != PROOF_KEYRING_FORMAT_VERSION {
                    bail!("unsupported completeness proof keyring version")
                }
                persisted
                    .keys
                    .into_iter()
                    .map(parse_persisted_key)
                    .collect::<Result<Vec<_>>>()?
            }
            Ok(_) => bail!("completeness proof keyring exceeds its size limit"),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(err) => return Err(err).context("could not read completeness proof keyring"),
        };
        let mut ring = Self {
            path: Some(path),
            keys,
        };
        let active = ring
            .keys
            .iter()
            .filter(|key| key.retired_at_ms.is_none())
            .count();
        if active == 0 {
            ring.mint_active(now_ms)?;
        } else if active != 1 {
            bail!("completeness proof keyring must contain exactly one active key")
        }
        Ok(ring)
    }

    #[cfg(test)]
    pub(crate) fn from_fixed_seed(proof_key_id: impl Into<String>, seed: [u8; 32]) -> Result<Self> {
        let pair = Ed25519KeyPair::from_seed_unchecked(&seed)
            .map_err(|_| anyhow!("invalid fixed Ed25519 seed"))?;
        let public_key: [u8; 32] = pair
            .public_key()
            .as_ref()
            .try_into()
            .map_err(|_| anyhow!("ring returned a non-32-byte Ed25519 key"))?;
        Ok(Self {
            path: None,
            keys: vec![ProofKey {
                proof_key_id: proof_key_id.into(),
                public_key,
                seed: Some(Zeroizing::new(seed)),
                created_at_ms: 0,
                retired_at_ms: None,
            }],
        })
    }

    pub fn manifest(&self) -> ProofKeyManifestV1 {
        let mut keys = self
            .keys
            .iter()
            .map(|key| ProofKeyManifestEntryV1 {
                proof_key_id: key.proof_key_id.clone(),
                algorithm: "Ed25519".to_owned(),
                public_key_base64url: URL_SAFE_NO_PAD.encode(key.public_key),
            })
            .collect::<Vec<_>>();
        keys.sort_by(|left, right| left.proof_key_id.cmp(&right.proof_key_id));
        ProofKeyManifestV1 {
            format: "snapback.completeness-proof-keys.v1".to_owned(),
            keys,
        }
    }

    pub fn matches_manifest(&self, manifest: &ProofKeyManifestV1) -> Result<bool> {
        validate_manifest(manifest)?;
        Ok(self.manifest() == *manifest)
    }

    pub fn sign(&self, mut proof: UnsignedCompletenessProofV1) -> Result<CompletenessProofV1> {
        let active = self
            .keys
            .iter()
            .find(|key| key.retired_at_ms.is_none())
            .ok_or_else(|| anyhow!("no active completeness proof key"))?;
        let seed = active
            .seed
            .as_ref()
            .ok_or_else(|| anyhow!("active completeness proof key has no signing custody"))?;
        proof.proof_key_id = active.proof_key_id.clone();
        validate_unsigned_proof(&proof)?;
        let mut preimage = PROOF_SIGNATURE_DOMAIN.to_vec();
        preimage.extend(jcs_bytes(&proof)?);
        let pair = Ed25519KeyPair::from_seed_unchecked(seed.as_ref())
            .map_err(|_| anyhow!("invalid Ed25519 signing seed"))?;
        let signature = URL_SAFE_NO_PAD.encode(pair.sign(&preimage).as_ref());
        Ok(CompletenessProofV1 {
            format: proof.format,
            materialization_key: proof.materialization_key,
            query_instance_id: proof.query_instance_id,
            activation_hash: proof.activation_hash,
            plan_hash: proof.plan_hash,
            version: proof.version,
            authorization_witness_digest: proof.authorization_witness_digest,
            page: proof.page,
            nodes: proof.nodes,
            batch_identity: proof.batch_identity,
            result_digest: proof.result_digest,
            proof_key_id: proof.proof_key_id,
            signature,
        })
    }

    pub fn verify(&self, proof: &CompletenessProofV1) -> Result<()> {
        validate_unsigned_proof(&UnsignedCompletenessProofV1::from(proof.clone()))?;
        let key = self
            .keys
            .iter()
            .find(|key| key.proof_key_id == proof.proof_key_id)
            .ok_or_else(|| anyhow!("unknown completeness proof key"))?;
        let signature = URL_SAFE_NO_PAD
            .decode(&proof.signature)
            .context("invalid proof signature base64url")?;
        if signature.len() != 64 || URL_SAFE_NO_PAD.encode(&signature) != proof.signature {
            bail!("proof signature is not canonical 64-byte base64url")
        }
        UnparsedPublicKey::new(&ring::signature::ED25519, key.public_key)
            .verify(&proof.preimage()?, &signature)
            .map_err(|_| anyhow!("invalid completeness proof signature"))
    }

    fn mint_active(&mut self, now_ms: u64) -> Result<()> {
        let mut id_bytes = [0_u8; 16];
        getrandom::fill(&mut id_bytes).context("could not mint proof key id")?;
        let proof_key_id = format!("sbpk1.{}", URL_SAFE_NO_PAD.encode(id_bytes));
        let mut seed = Zeroizing::new([0_u8; 32]);
        getrandom::fill(seed.as_mut()).context("could not mint Ed25519 proof key")?;
        let pair = Ed25519KeyPair::from_seed_unchecked(seed.as_ref())
            .map_err(|_| anyhow!("could not construct Ed25519 proof key"))?;
        let public_key: [u8; 32] = pair
            .public_key()
            .as_ref()
            .try_into()
            .map_err(|_| anyhow!("ring returned a non-32-byte Ed25519 key"))?;
        self.keys.push(ProofKey {
            proof_key_id,
            public_key,
            seed: Some(seed),
            created_at_ms: now_ms,
            retired_at_ms: None,
        });
        self.persist()
    }

    fn persist(&self) -> Result<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let persisted = PersistedProofKeyringV1 {
            format_version: PROOF_KEYRING_FORMAT_VERSION,
            keys: self
                .keys
                .iter()
                .map(|key| PersistedProofKeyV1 {
                    proof_key_id: key.proof_key_id.clone(),
                    public_key_base64url: URL_SAFE_NO_PAD.encode(key.public_key),
                    seed_base64url: key.seed.as_ref().map(|seed| URL_SAFE_NO_PAD.encode(seed)),
                    created_at_ms: key.created_at_ms,
                    retired_at_ms: key.retired_at_ms,
                })
                .collect(),
        };
        crate::secure_file::write_owner_only(path, &serde_json::to_vec(&persisted)?)
            .context("could not persist completeness proof keyring")
    }
}

fn parse_persisted_key(key: PersistedProofKeyV1) -> Result<ProofKey> {
    if key.proof_key_id.is_empty() {
        bail!("empty completeness proof key id")
    }
    let public_key: [u8; 32] = URL_SAFE_NO_PAD
        .decode(&key.public_key_base64url)
        .context("invalid persisted proof public key")?
        .try_into()
        .map_err(|_| anyhow!("persisted proof public key is not 32 bytes"))?;
    let seed = key
        .seed_base64url
        .map(|seed| {
            let bytes = URL_SAFE_NO_PAD
                .decode(seed)
                .context("invalid persisted proof seed")?;
            let seed: [u8; 32] = bytes
                .try_into()
                .map_err(|_| anyhow!("persisted proof seed is not 32 bytes"))?;
            Ok::<_, anyhow::Error>(Zeroizing::new(seed))
        })
        .transpose()?;
    if key.retired_at_ms.is_none() {
        let seed = seed
            .as_ref()
            .ok_or_else(|| anyhow!("active persisted proof key has no signing seed"))?;
        let pair = Ed25519KeyPair::from_seed_unchecked(seed.as_ref())
            .map_err(|_| anyhow!("invalid persisted Ed25519 seed"))?;
        if pair.public_key().as_ref() != public_key {
            bail!("persisted proof public key does not match its seed")
        }
    }
    Ok(ProofKey {
        proof_key_id: key.proof_key_id,
        public_key,
        seed,
        created_at_ms: key.created_at_ms,
        retired_at_ms: key.retired_at_ms,
    })
}

fn validate_unsigned_proof(proof: &UnsignedCompletenessProofV1) -> Result<()> {
    if proof.format != "snapback.completeness-proof.v1"
        || proof.materialization_key.is_empty()
        || proof.query_instance_id == 0
        || proof.query_instance_id > 9_007_199_254_740_991
        || proof.version.commit > 9_007_199_254_740_991
        || proof.version.stream.is_empty()
        || !is_sha256_digest(&proof.activation_hash)
        || !is_sha256_digest(&proof.plan_hash)
        || !is_sha256_digest(&proof.authorization_witness_digest)
        || !is_sha256_digest(&proof.result_digest)
        || proof.proof_key_id.is_empty()
        || !proof.batch_identity.starts_with("sbbi1.")
        || proof.nodes.is_empty()
        || proof.nodes.iter().enumerate().any(|(position, node)| {
            node.position != position as u64
                || node.class_id.is_empty()
                || node.class_version > 9_007_199_254_740_991
                || !is_sha256_digest(&node.node_plan_hash)
        })
    {
        bail!("completeness proof record is not canonical")
    }
    proof.page.validate()?;
    let batch = URL_SAFE_NO_PAD
        .decode(&proof.batch_identity["sbbi1.".len()..])
        .context("invalid completeness batch identity")?;
    if batch.len() != 16
        || format!("sbbi1.{}", URL_SAFE_NO_PAD.encode(&batch)) != proof.batch_identity
    {
        bail!("completeness batch identity is not 16 bytes")
    }
    Ok(())
}

fn is_sha256_digest(value: &str) -> bool {
    value.len() == "sha256:".len() + 64
        && value.starts_with("sha256:")
        && value["sha256:".len()..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageSetIdentityRecordV1 {
    pub format: String,
    pub materialization_key: String,
    pub activation_hash: String,
    pub plan_hash: String,
    pub version: ProofVersionV1,
    pub authorization_witness_digest: String,
    pub ordered_proof_digests: Vec<String>,
}

impl PageSetIdentityRecordV1 {
    pub fn digest(&self) -> Result<String> {
        if self.format != "snapback.page-set.v1" || self.ordered_proof_digests.is_empty() {
            bail!("page-set identity is not canonical")
        }
        domain_digest(PAGE_SET_DOMAIN, self)
    }

    pub fn compose(proofs: &[CompletenessProofV1]) -> Result<Self> {
        let first = proofs
            .first()
            .ok_or_else(|| anyhow!("page set has no proofs"))?;
        if !matches!(
            first.page,
            PageIdentityV1::Visible {
                input: CursorEndV1::First,
                ..
            } | PageIdentityV1::SealedTerminal {
                input: CursorEndV1::First,
                ..
            }
        ) {
            bail!("page set does not begin at first")
        }
        let shared = |proof: &CompletenessProofV1| {
            proof.materialization_key == first.materialization_key
                && proof.activation_hash == first.activation_hash
                && proof.plan_hash == first.plan_hash
                && proof.version == first.version
                && proof.authorization_witness_digest == first.authorization_witness_digest
                && proof.nodes == first.nodes
        };
        if !proofs.iter().all(shared) {
            bail!("page-set proofs do not share one establishment identity")
        }
        for pair in proofs.windows(2) {
            let output = match &pair[0].page {
                PageIdentityV1::Visible { output, .. }
                | PageIdentityV1::SealedTerminal { output, .. } => output,
            };
            let input = match &pair[1].page {
                PageIdentityV1::Visible { input, .. }
                | PageIdentityV1::SealedTerminal { input, .. } => input,
            };
            if output != input || !matches!(output, CursorEndV1::Cursor { .. }) {
                bail!("page-set cursor chain is not continuous")
            }
        }
        let last_output = match &proofs.last().expect("nonempty").page {
            PageIdentityV1::Visible { output, .. }
            | PageIdentityV1::SealedTerminal { output, .. } => output,
        };
        if !matches!(last_output, CursorEndV1::Terminal) {
            bail!("page set does not end at terminal")
        }
        Ok(Self {
            format: "snapback.page-set.v1".to_owned(),
            materialization_key: first.materialization_key.clone(),
            activation_hash: first.activation_hash.clone(),
            plan_hash: first.plan_hash.clone(),
            version: first.version.clone(),
            authorization_witness_digest: first.authorization_witness_digest.clone(),
            ordered_proof_digests: proofs
                .iter()
                .map(CompletenessProofV1::digest)
                .collect::<Result<Vec<_>>>()?,
        })
    }
}

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

impl PageSetManifestV1 {
    pub fn compose(proofs: &[CompletenessProofV1]) -> Result<Self> {
        let record = PageSetIdentityRecordV1::compose(proofs)?;
        Ok(Self {
            identity: record.digest()?,
            ordered_proof_digests: record.ordered_proof_digests,
        })
    }
}

pub fn read_trusted_activation(path: &Path) -> Result<TrustedCompositionActivationV1> {
    let bytes = std::fs::read(path)
        .with_context(|| format!("could not read trusted activation {}", path.display()))?;
    let artifact: TrustedCompositionActivationV1 = serde_json::from_slice(&bytes)
        .with_context(|| format!("trusted activation {} is invalid JSON", path.display()))?;
    artifact.validate()?;
    Ok(artifact)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::AuthorizationVersion;

    fn fixture_proof(ring: &ProofKeyring) -> CompletenessProofV1 {
        let witness = AuthorizationWitnessRecordV1::new(
            17,
            CompositeWitness {
                authorization: AuthorizationVersion {
                    incarnation: "0198f7c2-e3b0-7ad5-8000-000000000001".to_owned(),
                    epoch: 9,
                },
                data: Some(crate::auth::invalidation::DataWitness {
                    version_stream: "0198f7c2-e3b0-7ad5-8000-000000000002".to_owned(),
                    min_commit_version: 41,
                }),
            },
        )
        .unwrap();
        ring.sign(UnsignedCompletenessProofV1 {
            format: "snapback.completeness-proof.v1".to_owned(),
            materialization_key: "qmk1.fixture".to_owned(),
            query_instance_id: 17,
            activation_hash: format!("sha256:{}", "11".repeat(32)),
            plan_hash: format!("sha256:{}", "22".repeat(32)),
            version: ProofVersionV1 {
                stream: "0198f7c2-e3b0-7ad5-8000-000000000002".to_owned(),
                commit: 43,
            },
            authorization_witness_digest: witness.digest().unwrap(),
            page: PageIdentityV1::Visible {
                input: CursorEndV1::First,
                boundary_vector_digest: format!("sha256:{}", "33".repeat(32)),
                output: CursorEndV1::Terminal,
            },
            nodes: vec![ProofNodeIdentityV1 {
                position: 0,
                class_id: "relational_query_v1".to_owned(),
                class_version: 1,
                node_plan_hash: format!("sha256:{}", "44".repeat(32)),
            }],
            batch_identity: "sbbi1.AAECAwQFBgcICQoLDA0ODw".to_owned(),
            result_digest: result_digest_v1(&serde_json::json!([{"_id":"r1","n":1}])).unwrap(),
            proof_key_id: String::new(),
        })
        .unwrap()
    }

    #[test]
    fn snapshot_batch_v2_is_an_admitted_completeness_cursor_profile() {
        let page = PageIdentityV1::Visible {
            input: CursorEndV1::Cursor {
                profile_id: "snapshot-batch.v2".to_owned(),
                digest: format!("sha256:{}", "55".repeat(32)),
            },
            boundary_vector_digest: format!("sha256:{}", "66".repeat(32)),
            output: CursorEndV1::Terminal,
        };
        page.digest().expect("v2 batch cursor end is admitted");
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SharedGoldenFixture {
        seed_base64url: String,
        trusted_activation: TrustedCompositionActivationV1,
        result_bytes_base64url: String,
        page_identity_digest: String,
        proof_preimage_base64url: String,
        proof: CompletenessProofV1,
    }

    #[test]
    fn shared_server_fixture_freezes_preimage_and_signature_bytes() {
        let fixture: SharedGoldenFixture = serde_json::from_str(include_str!(
            "../../../tests/conformance/completeness-proof-v1.json"
        ))
        .unwrap();
        let seed: [u8; 32] = URL_SAFE_NO_PAD
            .decode(fixture.seed_base64url)
            .unwrap()
            .try_into()
            .unwrap();
        let ring = ProofKeyring::from_fixed_seed("fixture-key", seed).unwrap();
        assert_eq!(ring.manifest(), fixture.trusted_activation.proof_keys);
        fixture.trusted_activation.validate().unwrap();
        let minted = ring
            .sign(UnsignedCompletenessProofV1::from(fixture.proof.clone()))
            .unwrap();
        assert_eq!(minted, fixture.proof);
        assert_eq!(
            URL_SAFE_NO_PAD.encode(minted.preimage().unwrap()),
            fixture.proof_preimage_base64url
        );
        assert_eq!(minted.page.digest().unwrap(), fixture.page_identity_digest);
        let result: Value = serde_json::from_slice(
            &URL_SAFE_NO_PAD
                .decode(fixture.result_bytes_base64url)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(result_digest_v1(&result).unwrap(), minted.result_digest);
        ring.verify(&minted).unwrap();
    }

    #[test]
    fn proof_signatures_are_exact_and_tamper_evident() {
        let ring = ProofKeyring::from_fixed_seed("fixture-key", [7; 32]).unwrap();
        let proof = fixture_proof(&ring);
        assert_eq!(URL_SAFE_NO_PAD.decode(&proof.signature).unwrap().len(), 64);
        ring.verify(&proof).unwrap();
        let mut tampered = proof.clone();
        tampered.query_instance_id += 1;
        assert!(ring.verify(&tampered).is_err());
    }

    #[test]
    fn persisted_keyring_survives_restart_owner_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PROOF_KEYRING_FILE_NAME);
        let first = ProofKeyring::load_or_create(path.clone(), 100).unwrap();
        let manifest = first.manifest();
        drop(first);
        let second = ProofKeyring::load_or_create(path, 200).unwrap();
        assert_eq!(second.manifest(), manifest);
    }

    #[test]
    fn activation_binds_the_exact_manifest_digest() {
        let ring = ProofKeyring::from_fixed_seed("fixture-key", [7; 32]).unwrap();
        let artifact = TrustedCompositionActivationV1::prepare(
            "db",
            "deployment",
            "local",
            "sessions",
            ArtifactGeneration {
                schema_version: "1".to_owned(),
                app_id: "app".to_owned(),
                schema_hash: "sha256:schema".to_owned(),
                bundle_hash: "sha256:bundle".to_owned(),
                inputs_hash: "sha256:inputs".to_owned(),
            },
            ring.manifest(),
        )
        .unwrap();
        artifact.validate().unwrap();
        let mut missing = artifact.activation.clone();
        match &mut missing {
            CompositionActivationIdentity::V1(identity) => {
                identity.proof_key_manifest_digest.clear()
            }
            CompositionActivationIdentity::V2(_) => unreachable!("v1 fixture"),
        }
        assert!(missing.activation_hash().is_err());
    }

    #[test]
    fn activation_v2_binds_authored_source_and_retains_minted_generation() {
        let ring = ProofKeyring::from_fixed_seed("fixture-key", [9; 32]).unwrap();
        let minted_generation = ArtifactGeneration {
            schema_version: "snapback.v1".to_owned(),
            app_id: "app".to_owned(),
            schema_hash: "sha256:schema".to_owned(),
            bundle_hash: "sha256:bundle".to_owned(),
            inputs_hash: "sha256:inputs".to_owned(),
        };
        let artifact = TrustedCompositionActivationV1::prepare_v2(
            "db",
            "deployment",
            "local",
            "sessions",
            format!("sha256:{}", "ab".repeat(32)),
            minted_generation.clone(),
            ring.manifest(),
        )
        .unwrap();
        artifact.validate().unwrap();
        let CompositionActivationIdentity::V2(identity) = &artifact.activation else {
            unreachable!("v2 constructor")
        };
        assert_eq!(identity.minted_generation, minted_generation);
        assert_eq!(identity.format, "snapback.composition-activation.v2");
    }
}
