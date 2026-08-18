use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub use crate::vector::types::{
    VECTOR_COMPONENT_ABS_MAX, VECTOR_DISTANCE_PROFILE_DIGEST, VECTOR_DISTANCE_PROFILE_ID,
    VECTOR_ORDERING_PROFILE_ID, VECTOR_PROFILE_DIMENSIONS_MAX, VECTOR_PROFILE_DIMENSIONS_MIN,
    VectorMetricV1,
};

pub const VECTOR_DISTANCE_PROFILE_FILE: &str = "vector.distance-profile-v1.json";

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum VectorWitnessPurposeV1 {
    FmaContraction,
    ReassociationReductionReorder,
    ExtendedPrecisionX87,
    FtzDazSubnormalFlushing,
    OneUlpDecimalConversion,
    ComponentBoundary,
    NegativeZero,
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum VectorForbiddenAlternativeV1 {
    FusedTermAccumulation,
    ReverseReductionOrder,
    SingleRoundExtendedAccumulation,
    FlushSubnormalsToZero,
    RoundDecimalToFiniteH,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorAdmissionProfileV1 {
    pub dimensions_min: u32,
    pub dimensions_max: u32,
    pub component_abs_max_bits: String,
    pub decimal_conversion: String,
    pub negative_zero: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorArithmeticProfileV1 {
    pub binary_format: String,
    pub rounding: String,
    pub evaluation_order: String,
    pub gradual_underflow: bool,
    pub fused_multiply_add: bool,
    pub reassociation: bool,
    pub extended_precision_intermediates: bool,
    pub flush_to_zero_or_denormals_are_zero: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorConversionWitnessV1 {
    pub name: String,
    pub purpose: VectorWitnessPurposeV1,
    pub decimal: String,
    pub expected_bits: String,
    pub admission: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub admitted_bits: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finite_h_digits: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rounded_to_h_decimal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rounded_to_h_bits: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorWireInputsV1 {
    pub query_decimals: Vec<String>,
    pub candidate_decimals: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finite_h_digits: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorDistanceWitnessV1 {
    pub name: String,
    pub metric: VectorMetricV1,
    pub purpose: VectorWitnessPurposeV1,
    pub forbidden_alternative: VectorForbiddenAlternativeV1,
    pub query_bits: Vec<String>,
    pub candidate_bits: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wire_inputs: Option<VectorWireInputsV1>,
    pub expected_bits: String,
    pub forbidden_alternative_bits: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorOrderingWitnessV1 {
    pub name: String,
    pub metric: VectorMetricV1,
    pub distance_bits: String,
    pub direction: String,
    pub left_row_id_hex: String,
    pub right_row_id_hex: String,
    pub expected_first_row_id_hex: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorDistanceProfileV1 {
    pub profile_id: String,
    pub ordering_profile_id: String,
    pub admission: VectorAdmissionProfileV1,
    pub arithmetic: VectorArithmeticProfileV1,
    pub conversion_witnesses: Vec<VectorConversionWitnessV1>,
    pub distance_witnesses: Vec<VectorDistanceWitnessV1>,
    pub ordering_witnesses: Vec<VectorOrderingWitnessV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorDistanceProfileArtifactV1 {
    pub artifact_kind: String,
    pub format_version: u32,
    pub profile_digest: String,
    pub profile: VectorDistanceProfileV1,
}

fn conversion(
    name: &str,
    purpose: VectorWitnessPurposeV1,
    decimal: &str,
    expected_bits: &str,
    admission: &str,
    admitted_bits: Option<&str>,
    finite_h_evidence: Option<(u32, &str, &str)>,
) -> VectorConversionWitnessV1 {
    let (finite_h_digits, rounded_to_h_decimal, rounded_to_h_bits) =
        finite_h_evidence.map_or((None, None, None), |(digits, decimal, bits)| {
            (
                Some(digits),
                Some(decimal.to_owned()),
                Some(bits.to_owned()),
            )
        });
    VectorConversionWitnessV1 {
        name: name.to_owned(),
        purpose,
        decimal: decimal.to_owned(),
        expected_bits: expected_bits.to_owned(),
        admission: admission.to_owned(),
        admitted_bits: admitted_bits.map(ToOwned::to_owned),
        finite_h_digits,
        rounded_to_h_decimal,
        rounded_to_h_bits,
    }
}

#[allow(clippy::too_many_arguments)]
fn distance_witness(
    name: &str,
    metric: VectorMetricV1,
    purpose: VectorWitnessPurposeV1,
    forbidden_alternative: VectorForbiddenAlternativeV1,
    query_bits: &[&str],
    candidate_bits: &[&str],
    wire_inputs: Option<(&[&str], &[&str], Option<u32>)>,
    expected_bits: &str,
    forbidden_alternative_bits: &str,
) -> VectorDistanceWitnessV1 {
    VectorDistanceWitnessV1 {
        name: name.to_owned(),
        metric,
        purpose,
        forbidden_alternative,
        query_bits: query_bits.iter().map(|value| (*value).to_owned()).collect(),
        candidate_bits: candidate_bits
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
        wire_inputs: wire_inputs.map(|(query, candidate, finite_h_digits)| VectorWireInputsV1 {
            query_decimals: query.iter().map(|value| (*value).to_owned()).collect(),
            candidate_decimals: candidate.iter().map(|value| (*value).to_owned()).collect(),
            finite_h_digits,
        }),
        expected_bits: expected_bits.to_owned(),
        forbidden_alternative_bits: forbidden_alternative_bits.to_owned(),
    }
}

/// The closed LLP 0132 numeric payload. Expected bits are literal pins derived
/// by `scripts/vector-distance-reference.mjs`, an exact BigInt rational oracle;
/// this function never calls the production evaluator below.
///
/// @ref LLP 0132#distance-profile--the-portable-exactness-answer — one
/// committed profile fixes admission, primitive-operation order, ordering, and
/// the golden corpus before any target may publish support.
pub fn vector_distance_profile() -> VectorDistanceProfileV1 {
    let halfway = "1.00000000000000011102230246251565404236316680908203125";
    let above_halfway = "1.00000000000000011102230246251565404236316680908203126";
    VectorDistanceProfileV1 {
        profile_id: VECTOR_DISTANCE_PROFILE_ID.to_owned(),
        ordering_profile_id: VECTOR_ORDERING_PROFILE_ID.to_owned(),
        admission: VectorAdmissionProfileV1 {
            dimensions_min: VECTOR_PROFILE_DIMENSIONS_MIN,
            dimensions_max: VECTOR_PROFILE_DIMENSIONS_MAX,
            component_abs_max_bits: "4630000000000000".to_owned(),
            decimal_conversion: "nearest-binary64-ties-even-any-input-length".to_owned(),
            negative_zero: "canonicalize-to-positive-zero".to_owned(),
        },
        arithmetic: VectorArithmeticProfileV1 {
            binary_format: "ieee-754-binary64".to_owned(),
            rounding: "nearest-ties-even-after-every-primitive-operation".to_owned(),
            evaluation_order: "ascending-dimension-strict-sequential".to_owned(),
            gradual_underflow: true,
            fused_multiply_add: false,
            reassociation: false,
            extended_precision_intermediates: false,
            flush_to_zero_or_denormals_are_zero: false,
        },
        conversion_witnesses: vec![
            conversion(
                "arbitrary-length-halfway-ties-to-even",
                VectorWitnessPurposeV1::OneUlpDecimalConversion,
                halfway,
                "3ff0000000000000",
                "accept",
                Some("3ff0000000000000"),
                None,
            ),
            conversion(
                "arbitrary-length-above-halfway-rounds-up",
                VectorWitnessPurposeV1::OneUlpDecimalConversion,
                above_halfway,
                "3ff0000000000001",
                "accept",
                Some("3ff0000000000001"),
                Some((20, "10000000000000001110e-19", "3ff0000000000000")),
            ),
            conversion(
                "negative-zero-canonicalizes-positive",
                VectorWitnessPurposeV1::NegativeZero,
                "-0.000000000000000000000000000000000000000000000000000000000000",
                "8000000000000000",
                "canonicalize",
                Some("0000000000000000"),
                None,
            ),
            conversion(
                "positive-component-boundary",
                VectorWitnessPurposeV1::ComponentBoundary,
                "1267650600228229401496703205376",
                "4630000000000000",
                "accept",
                Some("4630000000000000"),
                None,
            ),
            conversion(
                "negative-component-boundary",
                VectorWitnessPurposeV1::ComponentBoundary,
                "-1267650600228229401496703205376",
                "c630000000000000",
                "accept",
                Some("c630000000000000"),
                None,
            ),
            conversion(
                "next-representable-above-component-boundary-refuses",
                VectorWitnessPurposeV1::ComponentBoundary,
                "1267650600228229682971679916032",
                "4630000000000001",
                "reject-component-bound",
                None,
                None,
            ),
            conversion(
                "gross-component-boundary-overflow-refuses",
                VectorWitnessPurposeV1::ComponentBoundary,
                "2535301200456458802993406410752",
                "4640000000000000",
                "reject-component-bound",
                None,
                None,
            ),
        ],
        // The literal expected/alternative bits below were derived by the
        // independent BigInt oracle. They are never computed here through the
        // production `strict_distance` kernel.
        distance_witnesses: vec![
            distance_witness(
                "dot-fma-contraction",
                VectorMetricV1::Dot,
                VectorWitnessPurposeV1::FmaContraction,
                VectorForbiddenAlternativeV1::FusedTermAccumulation,
                &["bff0000000000002", "3ff0000000000001"],
                &["3ff0000000000000", "3ff0000000000001"],
                None,
                "0000000000000000",
                "3970000000000000",
            ),
            distance_witness(
                "l2sq-fma-contraction",
                VectorMetricV1::L2sq,
                VectorWitnessPurposeV1::FmaContraction,
                VectorForbiddenAlternativeV1::FusedTermAccumulation,
                &["3f00000000000001", "3f10000000000001"],
                &["0000000000000000", "0000000000000000"],
                None,
                "3e34000000000002",
                "3e34000000000003",
            ),
            distance_witness(
                "dot-reassociation-reduction-reorder",
                VectorMetricV1::Dot,
                VectorWitnessPurposeV1::ReassociationReductionReorder,
                VectorForbiddenAlternativeV1::ReverseReductionOrder,
                &["4350000000000000", "c350000000000000", "3ff0000000000000"],
                &["3ff0000000000000", "3ff0000000000000", "3ff0000000000000"],
                None,
                "3ff0000000000000",
                "0000000000000000",
            ),
            distance_witness(
                "l2sq-reassociation-reduction-reorder",
                VectorMetricV1::L2sq,
                VectorWitnessPurposeV1::ReassociationReductionReorder,
                VectorForbiddenAlternativeV1::ReverseReductionOrder,
                &[
                    "41a0000000000000",
                    "3ff0000000000000",
                    "3ff0000000000000",
                    "3ff0000000000000",
                ],
                &[
                    "0000000000000000",
                    "0000000000000000",
                    "0000000000000000",
                    "0000000000000000",
                ],
                None,
                "4350000000000000",
                "4350000000000001",
            ),
            distance_witness(
                "dot-extended-precision-x87",
                VectorMetricV1::Dot,
                VectorWitnessPurposeV1::ExtendedPrecisionX87,
                VectorForbiddenAlternativeV1::SingleRoundExtendedAccumulation,
                &[
                    "3ff0000000000000",
                    "3ff0000000000000",
                    "4350000000000000",
                    "3ff0000000000000",
                ],
                &[
                    "3ff0000000000000",
                    "3ff0000000000000",
                    "3ff0000000000000",
                    "3ff0000000000000",
                ],
                None,
                "4350000000000000",
                "4350000000000001",
            ),
            distance_witness(
                "l2sq-extended-precision-x87",
                VectorMetricV1::L2sq,
                VectorWitnessPurposeV1::ExtendedPrecisionX87,
                VectorForbiddenAlternativeV1::SingleRoundExtendedAccumulation,
                &[
                    "3ff0000000000000",
                    "3ff0000000000000",
                    "41a0000000000000",
                    "3ff0000000000000",
                ],
                &[
                    "0000000000000000",
                    "0000000000000000",
                    "0000000000000000",
                    "0000000000000000",
                ],
                None,
                "4350000000000000",
                "4350000000000001",
            ),
            distance_witness(
                "dot-ftz-daz-subnormal",
                VectorMetricV1::Dot,
                VectorWitnessPurposeV1::FtzDazSubnormalFlushing,
                VectorForbiddenAlternativeV1::FlushSubnormalsToZero,
                &["0000000000000001"],
                &["3ff0000000000000"],
                None,
                "0000000000000001",
                "0000000000000000",
            ),
            distance_witness(
                "l2sq-ftz-daz-subnormal",
                VectorMetricV1::L2sq,
                VectorWitnessPurposeV1::FtzDazSubnormalFlushing,
                VectorForbiddenAlternativeV1::FlushSubnormalsToZero,
                &["1e60000000000000"],
                &["0000000000000000"],
                None,
                "0000000000000001",
                "0000000000000000",
            ),
            distance_witness(
                "dot-one-ulp-decimal-conversion",
                VectorMetricV1::Dot,
                VectorWitnessPurposeV1::OneUlpDecimalConversion,
                VectorForbiddenAlternativeV1::RoundDecimalToFiniteH,
                &["3ff0000000000001"],
                &["3ff0000000000000"],
                Some((&[above_halfway], &["1"], Some(20))),
                "3ff0000000000001",
                "3ff0000000000000",
            ),
            distance_witness(
                "l2sq-one-ulp-decimal-conversion",
                VectorMetricV1::L2sq,
                VectorWitnessPurposeV1::OneUlpDecimalConversion,
                VectorForbiddenAlternativeV1::RoundDecimalToFiniteH,
                &["3ff0000000000001"],
                &["0000000000000000"],
                Some((&[above_halfway], &["0"], Some(20))),
                "3ff0000000000002",
                "3ff0000000000000",
            ),
            distance_witness(
                "dot-component-boundary",
                VectorMetricV1::Dot,
                VectorWitnessPurposeV1::ComponentBoundary,
                VectorForbiddenAlternativeV1::SingleRoundExtendedAccumulation,
                &["4630000000000000"],
                &["4630000000000000"],
                None,
                "4c70000000000000",
                "4c70000000000000",
            ),
            distance_witness(
                "l2sq-component-boundary",
                VectorMetricV1::L2sq,
                VectorWitnessPurposeV1::ComponentBoundary,
                VectorForbiddenAlternativeV1::SingleRoundExtendedAccumulation,
                &["4630000000000000"],
                &["c630000000000000"],
                None,
                "4c90000000000000",
                "4c90000000000000",
            ),
            distance_witness(
                "dot-negative-zero-output-canonicalization",
                VectorMetricV1::Dot,
                VectorWitnessPurposeV1::NegativeZero,
                VectorForbiddenAlternativeV1::FlushSubnormalsToZero,
                &["0000000000000000"],
                &["bff0000000000000"],
                None,
                "0000000000000000",
                "0000000000000000",
            ),
            distance_witness(
                "l2sq-negative-zero-output-canonicalization",
                VectorMetricV1::L2sq,
                VectorWitnessPurposeV1::NegativeZero,
                VectorForbiddenAlternativeV1::FlushSubnormalsToZero,
                &["0000000000000000"],
                &["0000000000000000"],
                None,
                "0000000000000000",
                "0000000000000000",
            ),
        ],
        ordering_witnesses: vec![
            VectorOrderingWitnessV1 {
                name: "l2sq-bit-equal-id-asc".to_owned(),
                metric: VectorMetricV1::L2sq,
                distance_bits: "3ff0000000000000".to_owned(),
                direction: "id-asc".to_owned(),
                left_row_id_hex: "726f772d61".to_owned(),
                right_row_id_hex: "726f772d62".to_owned(),
                expected_first_row_id_hex: "726f772d61".to_owned(),
            },
            VectorOrderingWitnessV1 {
                name: "dot-bit-equal-id-desc".to_owned(),
                metric: VectorMetricV1::Dot,
                distance_bits: "3ff0000000000000".to_owned(),
                direction: "id-desc".to_owned(),
                left_row_id_hex: "726f772d61".to_owned(),
                right_row_id_hex: "726f772d62".to_owned(),
                expected_first_row_id_hex: "726f772d62".to_owned(),
            },
        ],
    }
}

pub fn vector_distance_profile_artifact() -> Value {
    let profile = vector_distance_profile();
    let profile_value = serde_json::to_value(&profile).expect("vector profile serializes");
    let computed = crate::rqs_contract::sha256_identity(&profile_value)
        .expect("integer/string-only vector profile is canonical JSON");
    assert_eq!(
        computed, VECTOR_DISTANCE_PROFILE_DIGEST,
        "vector profile digest drift requires an intentional profile-version decision"
    );
    serde_json::to_value(VectorDistanceProfileArtifactV1 {
        artifact_kind: "vectorDistanceProfileV1".to_owned(),
        format_version: 1,
        profile_digest: computed,
        profile,
    })
    .expect("vector profile artifact serializes")
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VectorAdmissionError {
    Dimensions,
    Component,
}

pub fn admit_vector_components(
    values: &[f64],
    dimensions: u32,
) -> Result<Vec<f64>, VectorAdmissionError> {
    if !(VECTOR_PROFILE_DIMENSIONS_MIN..=VECTOR_PROFILE_DIMENSIONS_MAX).contains(&dimensions)
        || values.len() != dimensions as usize
    {
        return Err(VectorAdmissionError::Dimensions);
    }
    values
        .iter()
        .map(|value| {
            if !value.is_finite() || value.abs() > VECTOR_COMPONENT_ABS_MAX {
                return Err(VectorAdmissionError::Component);
            }
            Ok(if *value == 0.0 { 0.0 } else { *value })
        })
        .collect()
}

#[inline(never)]
fn rounded_sub(left: f64, right: f64) -> f64 {
    left - right
}

#[inline(never)]
fn rounded_mul(left: f64, right: f64) -> f64 {
    left * right
}

#[inline(never)]
fn rounded_add(left: f64, right: f64) -> f64 {
    left + right
}

/// The scalar semantic kernel only; no target claims it in this checkpoint.
///
/// @ref LLP 0132#distance-profile--the-portable-exactness-answer — each
/// primitive rounds to binary64, dimensions accumulate in ascending order,
/// and FMA/reassociation/extended intermediates are forbidden.
pub fn strict_distance(metric: VectorMetricV1, query: &[f64], candidate: &[f64]) -> f64 {
    assert_eq!(
        query.len(),
        candidate.len(),
        "distance dimensions must agree"
    );
    let mut accumulator = 0.0;
    for index in 0..query.len() {
        let term = match metric {
            VectorMetricV1::L2sq => {
                let difference = rounded_sub(query[index], candidate[index]);
                rounded_mul(difference, difference)
            }
            VectorMetricV1::Dot => rounded_mul(query[index], candidate[index]),
        };
        accumulator = rounded_add(accumulator, term);
    }
    if accumulator == 0.0 { 0.0 } else { accumulator }
}

#[cfg(any(test, feature = "test-support"))]
fn parse_bits(bits: &str) -> f64 {
    f64::from_bits(u64::from_str_radix(bits, 16).expect("fixture contains f64 bits"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn admission_pins_dimensions_domain_bound_and_negative_zero() {
        assert_eq!(admit_vector_components(&[-0.0], 1).unwrap()[0].to_bits(), 0);
        assert!(admit_vector_components(&[], 0).is_err());
        assert!(admit_vector_components(&[0.0], 2).is_err());
        assert!(admit_vector_components(&vec![0.0; 4_097], 4_097).is_err());
        for value in [f64::NAN, f64::INFINITY, -f64::INFINITY] {
            assert_eq!(
                admit_vector_components(&[value], 1),
                Err(VectorAdmissionError::Component)
            );
        }
        for value in [VECTOR_COMPONENT_ABS_MAX, -VECTOR_COMPONENT_ABS_MAX] {
            assert_eq!(admit_vector_components(&[value], 1).unwrap(), [value]);
        }
        assert_eq!(
            admit_vector_components(&[f64::from_bits(VECTOR_COMPONENT_ABS_MAX.to_bits() + 1)], 1),
            Err(VectorAdmissionError::Component)
        );
        assert_eq!(
            admit_vector_components(&[f64::from_bits(0x4640_0000_0000_0000)], 1),
            Err(VectorAdmissionError::Component)
        );
    }

    #[test]
    fn committed_witnesses_cover_every_named_divergence_per_metric() {
        let profile = vector_distance_profile();
        for purpose in [
            VectorWitnessPurposeV1::FmaContraction,
            VectorWitnessPurposeV1::ReassociationReductionReorder,
            VectorWitnessPurposeV1::ExtendedPrecisionX87,
            VectorWitnessPurposeV1::FtzDazSubnormalFlushing,
            VectorWitnessPurposeV1::OneUlpDecimalConversion,
        ] {
            let metrics = profile
                .distance_witnesses
                .iter()
                .filter(|witness| witness.purpose == purpose)
                .map(|witness| witness.metric)
                .collect::<BTreeSet<_>>();
            assert_eq!(
                metrics,
                BTreeSet::from([VectorMetricV1::L2sq, VectorMetricV1::Dot])
            );
        }
    }

    #[test]
    fn rust_kernel_consumes_the_independently_pinned_expected_bits() {
        for witness in vector_distance_profile().distance_witnesses {
            let query = witness
                .query_bits
                .iter()
                .map(|bits| parse_bits(bits))
                .collect::<Vec<_>>();
            let candidate = witness
                .candidate_bits
                .iter()
                .map(|bits| parse_bits(bits))
                .collect::<Vec<_>>();
            assert_eq!(
                strict_distance(witness.metric, &query, &candidate).to_bits(),
                u64::from_str_radix(&witness.expected_bits, 16).expect("expected f64 bits"),
                "{}",
                witness.name
            );
        }
    }

    #[test]
    fn decimal_conversion_witnesses_parse_to_the_pinned_bits() {
        for witness in vector_distance_profile().conversion_witnesses {
            let parsed: f64 = serde_json::from_str(&witness.decimal).expect("valid JSON number");
            assert_eq!(
                format!("{:016x}", parsed.to_bits()),
                witness.expected_bits,
                "{}",
                witness.name
            );
        }
    }

    #[test]
    fn profile_digest_is_pinned() {
        let artifact = vector_distance_profile_artifact();
        assert_eq!(
            artifact["profileDigest"],
            serde_json::json!(VECTOR_DISTANCE_PROFILE_DIGEST)
        );
    }
}
