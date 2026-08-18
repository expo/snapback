//! Vector-manifest structural validation.

use super::*;

/// Closed load-time admission for a direct vector-index artifact. Authoring
/// derives scalar-pair and maintenance limits, but Rust re-proves them so a
/// forged manifest cannot lower or widen the fixed v1 profile.
///
/// @ref LLP 0132#index-declarations
pub fn validate_vector_index_manifest(
    table: &TableManifest,
    index: &VectorIndexManifestV1,
) -> SnapbackResult<()> {
    if index.format_version != 1
        || index.name.trim().is_empty()
        || index.semantic_version.trim().is_empty()
        || index.vector_field.trim().is_empty()
        || index.distance_profile != crate::vector::types::VECTOR_DISTANCE_PROFILE_ID
        || index.ordering_profile != crate::vector::types::VECTOR_ORDERING_PROFILE_ID
        || !(crate::vector::types::VECTOR_PROFILE_DIMENSIONS_MIN
            ..=crate::vector::types::VECTOR_PROFILE_DIMENSIONS_MAX)
            .contains(&index.dimensions)
        || !(1..=crate::vector::types::VECTOR_MAX_CORPUS)
            .contains(&index.max_indexed_vectors_per_partition)
    {
        return Err(vector_manifest_invalid(format!(
            "vector index {} has an invalid identity, profile, or bound",
            index.name
        )));
    }

    let Some(vector_field) = table
        .fields
        .iter()
        .find(|field| field.name == index.vector_field)
    else {
        return Err(vector_manifest_invalid(format!(
            "vector index {} names missing vector field {}",
            index.name, index.vector_field
        )));
    };
    if vector_field.optional
        || vector_field.field_type
            != (FieldType::Vector {
                dimensions: index.dimensions,
            })
    {
        return Err(vector_manifest_invalid(format!(
            "vector index {} must name a required v.vector({}) field",
            index.name, index.dimensions
        )));
    }

    let product = u64::from(index.dimensions)
        .checked_mul(u64::from(index.max_indexed_vectors_per_partition))
        .ok_or_else(|| vector_manifest_invalid("vector scalar-pair product overflow"))?;
    if product > crate::vector::types::VECTOR_MAX_SCALAR_PAIRS || index.max_scalar_pairs != product
    {
        return Err(vector_manifest_invalid(format!(
            "vector index {} maxScalarPairs must equal dimensions × maxIndexedVectorsPerPartition and remain <= 2^26",
            index.name
        )));
    }
    if index.maintenance_limits != VectorMaintenanceLimitsV1::default() {
        return Err(vector_manifest_invalid(format!(
            "vector index {} maintenanceLimits must equal the fixed mutation-global v1 ceiling",
            index.name
        )));
    }

    let unique_nonempty = |fields: &[String]| {
        fields.iter().all(|field| !field.trim().is_empty())
            && fields.iter().collect::<BTreeSet<_>>().len() == fields.len()
    };
    if index.equality_filters.len() > crate::vector::types::VECTOR_MAX_FILTERS
        || !unique_nonempty(&index.equality_filters)
        || !unique_nonempty(&index.stored_fields)
    {
        return Err(vector_manifest_invalid(format!(
            "vector index {} has invalid or duplicate filter/stored fields",
            index.name
        )));
    }

    let field = |name: &str| table.fields.iter().find(|field| field.name == name);
    for name in &index.equality_filters {
        let Some(filter) = field(name) else {
            return Err(vector_manifest_invalid(format!(
                "vector index {} names missing equality-filter field {name}",
                index.name
            )));
        };
        if !matches!(
            filter.field_type,
            FieldType::String
                | FieldType::Enum { .. }
                | FieldType::Boolean
                | FieldType::Integer
                | FieldType::Principal
                | FieldType::Id { .. }
                | FieldType::AssetRef { .. }
        ) {
            return Err(vector_manifest_invalid(format!(
                "vector index {} equality-filter field {name} must use the closed scalar vocabulary",
                index.name
            )));
        }
    }
    for name in &index.stored_fields {
        let Some(stored) = field(name) else {
            return Err(vector_manifest_invalid(format!(
                "vector index {} names missing stored field {name}",
                index.name
            )));
        };
        if matches!(
            stored.field_type,
            FieldType::Vector { .. } | FieldType::Structured { .. }
        ) {
            return Err(vector_manifest_invalid(format!(
                "vector index {} storedFields must not expose vector or opaque structured field {name}",
                index.name
            )));
        }
    }

    let mut participating = BTreeSet::from([index.vector_field.as_str()]);
    participating.extend(index.equality_filters.iter().map(String::as_str));
    participating.extend(index.stored_fields.iter().map(String::as_str));
    if let VectorVisibilityV1::Owner { field: owner } = &index.visibility {
        let Some(owner_field) = field(owner) else {
            return Err(vector_manifest_invalid(format!(
                "vector index {} names missing owner field {owner}",
                index.name
            )));
        };
        if owner_field.optional
            || !matches!(
                owner_field.field_type,
                FieldType::String | FieldType::Principal
            )
        {
            return Err(vector_manifest_invalid(format!(
                "vector index {} owner field {owner} must be a required string/principal",
                index.name
            )));
        }
        participating.insert(owner);
    }
    let classified = index
        .field_classifications
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if classified != participating {
        return Err(vector_manifest_invalid(format!(
            "vector index {} classifications must name exactly every participating field",
            index.name
        )));
    }
    for classification in index.field_classifications.values() {
        let admitted = match &index.visibility {
            VectorVisibilityV1::PublicRead => *classification == VectorFieldClassV1::Public,
            VectorVisibilityV1::Owner { .. } => matches!(
                classification,
                VectorFieldClassV1::Public | VectorFieldClassV1::Private
            ),
        };
        if !admitted {
            return Err(vector_manifest_invalid(format!(
                "vector index {} field classification violates its visibility profile",
                index.name
            )));
        }
    }
    Ok(())
}

/// Structural admission for the exact vector carrier. No executor is
/// registered by this checkpoint; target capability admission remains false.
pub fn validate_vector_query_plan_shape(plan: &VectorQueryPlanV1) -> SnapbackResult<()> {
    if plan.table.trim().is_empty()
        || plan.index.trim().is_empty()
        || plan.distance_profile != crate::vector::types::VECTOR_DISTANCE_PROFILE_ID
        || plan.result_projection != crate::vector::types::VECTOR_RESULT_PROJECTION
        || plan.required_capability != crate::vector::types::VECTOR_CAPABILITY
    {
        return Err(SnapbackError::error(
            "SNAPBACK_VECTOR_QUERY_PLAN_INVALID",
            "vector",
            "vector plan must name one table/index and the exact v1 distance, result, and capability profiles",
        ));
    }
    Ok(())
}
