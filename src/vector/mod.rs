pub mod fixtures;
pub mod sqlite;
pub mod types;

pub use sqlite::{maintain_vector_indexes_in_tx, query_vector_on};
pub use types::*;

use crate::diagnostic::{SnapbackError, SnapbackResult};

fn invalid(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "vector", message)
}

/// Admit and canonicalize a vector at the one runtime boundary shared by
/// stored values and query vectors.
///
/// @ref LLP 0132#vector-values-and-declarations — vectors are fixed-size finite
/// binary64 arrays, bounded by 2^100, with negative zero canonicalized.
fn admit_vector_with_code(
    values: &[f64],
    dimensions: u32,
    code: &'static str,
) -> SnapbackResult<Vec<f64>> {
    if values.len() != dimensions as usize {
        return Err(invalid(
            code,
            format!(
                "vector has {} components; expected {dimensions}",
                values.len()
            ),
        ));
    }
    values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            if !value.is_finite() || value.abs() > VECTOR_COMPONENT_ABS_MAX {
                return Err(invalid(
                    code,
                    format!(
                        "vector component {index} is outside the portable finite binary64 domain"
                    ),
                ));
            }
            Ok(if *value == 0.0 { 0.0 } else { *value })
        })
        .collect()
}

pub fn admit_query_vector(values: &[f64], dimensions: u32) -> SnapbackResult<Vec<f64>> {
    admit_vector_with_code(values, dimensions, "SNAPBACK_VECTOR_QUERY_INVALID")
}

pub fn admit_stored_vector(values: &[f64], dimensions: u32) -> SnapbackResult<Vec<f64>> {
    admit_vector_with_code(values, dimensions, "SNAPBACK_VECTOR_VALUE_INVALID")
}

#[cfg(test)]
fn admit_vector(values: &[f64], dimensions: u32) -> SnapbackResult<Vec<f64>> {
    admit_query_vector(values, dimensions)
}

#[inline(never)]
fn rounded_mul(left: f64, right: f64) -> f64 {
    left * right
}

#[inline(never)]
fn rounded_add(left: f64, right: f64) -> f64 {
    left + right
}

#[inline(never)]
fn rounded_sub(left: f64, right: f64) -> f64 {
    left - right
}

/// Exact v1 arithmetic profile. The no-inline primitive operations make the
/// two mandatory rounding points observable and prevent FMA contraction.
///
/// @ref LLP 0132#distance-profile--the-portable-exactness-answer — evaluate in component order with
/// strict binary64 multiply/add steps; no FMA or reassociation.
pub fn distance(metric: VectorMetricV1, query: &[f64], candidate: &[f64]) -> f64 {
    let mut accumulator = 0.0;
    for (left, right) in query.iter().zip(candidate) {
        let term = match metric {
            VectorMetricV1::L2sq => {
                let delta = rounded_sub(*left, *right);
                rounded_mul(delta, delta)
            }
            VectorMetricV1::Dot => rounded_mul(*left, *right),
        };
        accumulator = rounded_add(accumulator, term);
    }
    if accumulator == 0.0 { 0.0 } else { accumulator }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimal_conversion_witness_is_correctly_rounded_at_arbitrary_length() {
        // Exactly halfway between 1.0 and its successor; ties-to-even selects
        // 1.0. Both decimals deliberately exceed 20 significant digits.
        let tie: f64 =
            serde_json::from_str("1.00000000000000011102230246251565404236316680908203125")
                .unwrap();
        let above: f64 =
            serde_json::from_str("1.00000000000000011102230246251565404236316680908203126")
                .unwrap();
        assert_eq!(tie.to_bits(), 1.0f64.to_bits());
        assert_eq!(above.to_bits(), 1.0f64.to_bits() + 1);
    }

    #[test]
    fn admission_canonicalizes_negative_zero_and_refuses_nonportable_values() {
        assert_eq!(admit_vector(&[-0.0], 1).unwrap()[0].to_bits(), 0);
        for value in [f64::NAN, f64::INFINITY, -f64::INFINITY] {
            let error = admit_vector(&[value], 1).unwrap_err();
            assert_eq!(error.diagnostic.code, "SNAPBACK_VECTOR_QUERY_INVALID");
        }
        let error = admit_vector(&[VECTOR_COMPONENT_ABS_MAX * 2.0], 1).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_VECTOR_QUERY_INVALID");
    }

    #[test]
    fn distance_uses_pinned_order_and_canonical_zero() {
        assert_eq!(
            distance(VectorMetricV1::L2sq, &[1.0, 2.0], &[3.0, 4.0]),
            8.0
        );
        assert_eq!(
            distance(VectorMetricV1::Dot, &[1.0, 2.0], &[3.0, 4.0]),
            11.0
        );
        assert_eq!(distance(VectorMetricV1::Dot, &[-0.0], &[1.0]).to_bits(), 0);
    }
}
