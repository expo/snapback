//! Transaction-neutral storage primitives for the LLP 0132 exact-vector
//! profile. This module defines canonical bytes, vector-value digests,
//! mutation-global budget accounting, and source-frontier CAS classification;
//! it deliberately performs no database I/O.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::diagnostic::SnapbackResult;
use crate::vector::diagnostics::{
    index_corrupt, maintenance_failed, maintenance_limit, value_invalid,
};
use crate::vector::profile::admit_vector_components;
pub use crate::vector::types::{VECTOR_MAINTENANCE_BYTES_MAX, VECTOR_MAINTENANCE_EFFECTS_MAX};

const NEGATIVE_ZERO_BITS: u64 = 1_u64 << 63;

/// Admit and encode one vector as exactly `8 * dimensions` bytes. Each
/// component uses its canonical IEEE 754 binary64 bits in little-endian byte
/// order; admission turns negative zero into positive zero before encoding.
///
/// @ref LLP 0132#index-maintenance-and-storage — SQLite stores fixed-width
/// little-endian binary64 bytes, never a target-native vector representation.
pub fn encode_vector_binary64_le(values: &[f64], dimensions: u32) -> SnapbackResult<Vec<u8>> {
    let admitted = admit_vector_components(values, dimensions).map_err(|_| value_invalid())?;
    let mut encoded = Vec::with_capacity(admitted.len() * size_of::<f64>());
    for component in admitted {
        encoded.extend_from_slice(&component.to_bits().to_le_bytes());
    }
    Ok(encoded)
}

/// Decode canonical storage bytes and re-run the complete vector admission
/// rule. Any invalid dimension, byte length, non-finite/out-of-bound component,
/// or stored negative-zero spelling is index corruption, not an authored-value
/// refusal. In particular, decode never silently heals noncanonical `-0`.
///
/// @ref LLP 0132#the-vvectordimensions-value — reload repeats dimensions,
/// finiteness, component-bound, and positive-zero canonicality checks.
pub fn decode_vector_binary64_le(bytes: &[u8], dimensions: u32) -> SnapbackResult<Vec<f64>> {
    let expected_len = usize::try_from(dimensions)
        .ok()
        .and_then(|dimensions| dimensions.checked_mul(size_of::<f64>()))
        .ok_or_else(index_corrupt)?;
    if bytes.len() != expected_len {
        return Err(index_corrupt());
    }

    let mut decoded = Vec::with_capacity(bytes.len() / size_of::<f64>());
    for chunk in bytes.chunks_exact(size_of::<f64>()) {
        let bits = u64::from_le_bytes(chunk.try_into().expect("exact f64-sized chunk"));
        if bits == NEGATIVE_ZERO_BITS {
            return Err(index_corrupt());
        }
        decoded.push(f64::from_bits(bits));
    }
    admit_vector_components(&decoded, dimensions).map_err(|_| index_corrupt())
}

/// SHA-256 over the RFC 8785 canonical JSON array of admitted components. This
/// vector-only digest is a reusable component of the eventual source/posting
/// release digest; it does not by itself claim to bind stored fields, filters,
/// visibility, row identity, or source version, and it never hashes the binary
/// storage representation.
pub fn vector_content_digest(values: &[f64], dimensions: u32) -> SnapbackResult<String> {
    let admitted = admit_vector_components(values, dimensions).map_err(|_| value_invalid())?;
    let value = serde_json::to_value(admitted).map_err(|_| maintenance_failed())?;
    crate::rqs_contract::sha256_identity(&value).map_err(|_| maintenance_failed())
}

/// The exact identity of one idempotent vector-derived-state update.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorSourceUpdateIdentityV1 {
    pub index_version: String,
    pub source_id: String,
    pub source_version: u64,
}

/// Highest-applied state retained per source. Tombstones use the same
/// version/digest-bearing shape so an older replay cannot resurrect a deleted
/// posting.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorSourceFrontierV1 {
    pub identity: VectorSourceUpdateIdentityV1,
    pub tombstone: bool,
    pub content_digest: String,
}

/// Pure CAS classification. `Apply` carries the complete previous value a
/// storage adapter must compare before replacement. Same-version divergence is
/// corruption; an exact replay is idempotent; an older replay is stale.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VectorFrontierCasV1 {
    Apply {
        expected: Option<VectorSourceFrontierV1>,
    },
    Idempotent,
    Stale,
}

/// Classify an incoming frontier without changing either argument.
///
/// @ref LLP 0132#index-maintenance-and-storage — updates are idempotent by
/// `(indexVersion, sourceId, sourceVersion)` and use CAS plus retained
/// tombstones/high-water frontiers.
pub fn classify_vector_frontier_cas(
    current: Option<&VectorSourceFrontierV1>,
    incoming: &VectorSourceFrontierV1,
) -> SnapbackResult<VectorFrontierCasV1> {
    let Some(current) = current else {
        return Ok(VectorFrontierCasV1::Apply { expected: None });
    };
    if current.identity.index_version != incoming.identity.index_version
        || current.identity.source_id != incoming.identity.source_id
    {
        return Err(index_corrupt());
    }
    match incoming
        .identity
        .source_version
        .cmp(&current.identity.source_version)
    {
        std::cmp::Ordering::Less => Ok(VectorFrontierCasV1::Stale),
        std::cmp::Ordering::Equal if current == incoming => Ok(VectorFrontierCasV1::Idempotent),
        std::cmp::Ordering::Equal => Err(index_corrupt()),
        std::cmp::Ordering::Greater => Ok(VectorFrontierCasV1::Apply {
            expected: Some(current.clone()),
        }),
    }
}

/// Mutation-global accounting across every vector index touched by one source
/// transaction. There is intentionally no index key in this type: callers get
/// one accumulator for the mutation, not one accumulator per index.
#[derive(Debug, Default, Eq, PartialEq)]
pub struct VectorMaintenanceBudget {
    posting_effects: u64,
    vector_bytes: u64,
}

impl VectorMaintenanceBudget {
    pub fn posting_effects(&self) -> u64 {
        self.posting_effects
    }

    pub fn vector_bytes(&self) -> u64 {
        self.vector_bytes
    }

    /// Atomically account a planned charge. Overflow or a ceiling violation
    /// leaves the accumulator unchanged so planning can refuse before writes.
    pub fn charge(&mut self, posting_effects: u64, vector_bytes: u64) -> SnapbackResult<()> {
        let next_effects = self
            .posting_effects
            .checked_add(posting_effects)
            .ok_or_else(maintenance_limit)?;
        let next_bytes = self
            .vector_bytes
            .checked_add(vector_bytes)
            .ok_or_else(maintenance_limit)?;
        if next_effects > VECTOR_MAINTENANCE_EFFECTS_MAX
            || next_bytes > VECTOR_MAINTENANCE_BYTES_MAX
        {
            return Err(maintenance_limit());
        }
        self.posting_effects = next_effects;
        self.vector_bytes = next_bytes;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vector::diagnostics::code;
    use crate::vector::profile::VECTOR_COMPONENT_ABS_MAX;

    fn frontier(version: u64, tombstone: bool, digest: &str) -> VectorSourceFrontierV1 {
        VectorSourceFrontierV1 {
            identity: VectorSourceUpdateIdentityV1 {
                index_version: "messages.embedding.v1".to_owned(),
                source_id: "row-a".to_owned(),
                source_version: version,
            },
            tombstone,
            content_digest: digest.to_owned(),
        }
    }

    #[test]
    fn fixed_width_little_endian_round_trip_is_canonical() {
        let values = [
            -0.0,
            1.5,
            -2.25,
            f64::from_bits(1),
            VECTOR_COMPONENT_ABS_MAX,
        ];
        let encoded = encode_vector_binary64_le(&values, 5).expect("admitted vector encodes");
        assert_eq!(encoded.len(), 5 * size_of::<f64>());
        assert_eq!(
            encoded,
            vec![
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // +0
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x3f, // 1.5
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xc0, // -2.25
                0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // min subnormal
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x30, 0x46, // 2^100
            ]
        );
        let decoded = decode_vector_binary64_le(&encoded, 5).expect("canonical bytes decode");
        assert_eq!(
            decoded
                .iter()
                .map(|value| value.to_bits())
                .collect::<Vec<_>>(),
            vec![
                0,
                1.5_f64.to_bits(),
                (-2.25_f64).to_bits(),
                1,
                VECTOR_COMPONENT_ABS_MAX.to_bits(),
            ]
        );
    }

    #[test]
    fn decode_refuses_every_noncanonical_or_out_of_domain_storage_shape() {
        let cases = [
            (NEGATIVE_ZERO_BITS, "negative zero"),
            (f64::NAN.to_bits(), "NaN"),
            (f64::INFINITY.to_bits(), "infinity"),
            (
                VECTOR_COMPONENT_ABS_MAX.to_bits() + 1,
                "above component bound",
            ),
        ];
        for (bits, label) in cases {
            let error = decode_vector_binary64_le(&bits.to_le_bytes(), 1)
                .expect_err("invalid stored component must refuse");
            assert_eq!(error.diagnostic.code, code::INDEX_CORRUPT, "{label}");
        }
        for (bytes, dimensions) in [(&[][..], 0), (&[0; 7][..], 1), (&[0; 8][..], 2)] {
            let error = decode_vector_binary64_le(bytes, dimensions)
                .expect_err("invalid storage shape must refuse");
            assert_eq!(error.diagnostic.code, code::INDEX_CORRUPT);
        }
    }

    #[test]
    fn vector_digest_uses_admitted_rfc8785_content_and_canonical_zero() {
        let positive = vector_content_digest(&[0.0, 1.5, -2.25], 3).unwrap();
        let negative = vector_content_digest(&[-0.0, 1.5, -2.25], 3).unwrap();
        assert_eq!(positive, negative);
        assert_eq!(
            positive,
            "sha256:28eee5c1867e8dc30eb5b17b8daa0fe3feaab6c04b0f37f4ba1757df83d34514"
        );
        let admitted = serde_json::to_value([0.0, 1.5, -2.25]).unwrap();
        assert_eq!(
            crate::rqs_contract::jcs(&admitted).unwrap(),
            "[0,1.5,-2.25]"
        );
        assert_eq!(
            crate::rqs_contract::sha256_identity(&admitted).unwrap(),
            positive
        );
        let error = vector_content_digest(&[f64::NAN], 1).expect_err("NaN refuses");
        assert_eq!(error.diagnostic.code, code::VALUE_INVALID);
    }

    #[test]
    fn mutation_global_budget_composes_charges_and_refusal_is_neutral() {
        let mut budget = VectorMaintenanceBudget::default();
        budget.charge(700, 3 * 1024 * 1024).unwrap();
        budget.charge(324, 1024 * 1024).unwrap();
        assert_eq!(budget.posting_effects(), VECTOR_MAINTENANCE_EFFECTS_MAX);
        assert_eq!(budget.vector_bytes(), VECTOR_MAINTENANCE_BYTES_MAX);

        let at_limit = (budget.posting_effects(), budget.vector_bytes());
        for charge in [(1, 0), (0, 1), (u64::MAX, 0), (0, u64::MAX)] {
            let error = budget
                .charge(charge.0, charge.1)
                .expect_err("aggregate limit must refuse");
            assert_eq!(error.diagnostic.code, code::MAINTENANCE_LIMIT);
            assert_eq!(
                (budget.posting_effects(), budget.vector_bytes()),
                at_limit,
                "refusal must not mutate counters"
            );
        }
    }

    #[test]
    fn frontier_cas_is_idempotent_stale_safe_and_conflict_closed() {
        let tombstone = frontier(7, true, "sha256:deleted");
        assert_eq!(
            classify_vector_frontier_cas(None, &tombstone).unwrap(),
            VectorFrontierCasV1::Apply { expected: None }
        );
        assert_eq!(
            classify_vector_frontier_cas(Some(&tombstone), &tombstone).unwrap(),
            VectorFrontierCasV1::Idempotent
        );
        assert_eq!(
            classify_vector_frontier_cas(
                Some(&tombstone),
                &frontier(6, false, "sha256:older-live")
            )
            .unwrap(),
            VectorFrontierCasV1::Stale,
            "older work cannot resurrect a tombstone"
        );
        assert_eq!(
            classify_vector_frontier_cas(
                Some(&tombstone),
                &frontier(8, false, "sha256:newer-live")
            )
            .unwrap(),
            VectorFrontierCasV1::Apply {
                expected: Some(tombstone.clone())
            }
        );

        for conflicting in [
            frontier(7, false, "sha256:deleted"),
            frontier(7, true, "sha256:different"),
        ] {
            let error = classify_vector_frontier_cas(Some(&tombstone), &conflicting)
                .expect_err("same identity with divergent state is corrupt");
            assert_eq!(error.diagnostic.code, code::INDEX_CORRUPT);
        }
        let mut wrong_source = frontier(8, false, "sha256:newer-live");
        wrong_source.identity.source_id = "row-b".to_owned();
        assert_eq!(
            classify_vector_frontier_cas(Some(&tombstone), &wrong_source)
                .expect_err("CAS cannot cross source identities")
                .diagnostic
                .code,
            code::INDEX_CORRUPT
        );
    }

    #[test]
    fn source_identity_and_frontier_carriers_are_closed() {
        let identity = VectorSourceUpdateIdentityV1 {
            index_version: "messages.embedding.v1".to_owned(),
            source_id: "row-a".to_owned(),
            source_version: 9,
        };
        assert_eq!(
            serde_json::to_value(&identity).unwrap(),
            serde_json::json!({
                "indexVersion": "messages.embedding.v1",
                "sourceId": "row-a",
                "sourceVersion": 9,
            })
        );
        assert!(
            serde_json::from_value::<VectorSourceUpdateIdentityV1>(serde_json::json!({
                "indexVersion": "messages.embedding.v1",
                "sourceId": "row-a",
                "sourceVersion": 9,
                "extra": true,
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<VectorSourceFrontierV1>(serde_json::json!({
                "identity": identity,
                "tombstone": true,
                "contentDigest": "sha256:deleted",
                "extra": true,
            }))
            .is_err()
        );
    }
}
