//! Transaction-neutral exact k-NN evaluation for LLP 0132.
//!
//! Storage adapters provide one already-selected visibility partition and a
//! same-snapshot authoritative release callback. This module owns the portable
//! parts: closed request admission, canonical posting order, declaration-order
//! filters, strict distance arithmetic, total top-k ordering, logical-work
//! accounting, and fail-closed release rechecks.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{FieldType, TableManifest};
use crate::vector::diagnostics::{index_corrupt, query_invalid, work_limit};
use crate::vector::profile::{admit_vector_components, strict_distance};
use crate::vector::storage::decode_vector_binary64_le;
use crate::vector::types::{
    VECTOR_DEFAULT_K, VECTOR_MAX_FILTERS, VECTOR_MAX_K, VectorFilterValueV1, VectorIndexManifestV1,
    VectorItemV1, VectorPageV1, VectorRequestV1, VectorTieBreakV1,
};

/// One retained posting supplied by a target adapter. `vector_bytes` is the
/// canonical storage representation; projections are the exact declared maps.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorPostingV1 {
    pub row_id: String,
    pub source_version: u64,
    pub partition: String,
    pub vector_bytes: Vec<u8>,
    pub filters: Map<String, Value>,
    pub fields: Map<String, Value>,
    pub content_digest: String,
}

/// The minimal candidate identity exposed to the same-snapshot source loader.
/// It intentionally omits query-vector components and distance.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VectorReleaseCandidateV1<'a> {
    pub row_id: &'a str,
    pub source_version: u64,
    pub partition: &'a str,
    pub content_digest: &'a str,
}

/// Authoritative source derivation returned only after the adapter has loaded
/// the current row and evaluated the generated public/owner predicate.
///
/// `authorized` remains explicit so an adapter cannot turn predicate failure
/// into an absent row with different semantics. Either false or absence is
/// index drift and refuses the complete page.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorAuthoritativeReleaseV1 {
    pub source_version: u64,
    pub partition: String,
    pub content_digest: String,
    pub authorized: bool,
    pub fields: Map<String, Value>,
}

/// The four closed logical-work categories. Candidate count and scalar-pair
/// count are retained separately inside category three because acceptance
/// compares both facts.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorWorkCountersV1 {
    pub postings_enumerated: u64,
    pub filter_comparisons: u64,
    pub candidates_scored: u64,
    pub scalar_pairs: u64,
    pub release_source_reads: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct VectorQueryEvaluationV1 {
    pub page: VectorPageV1,
    pub counters: VectorWorkCountersV1,
}

#[derive(Clone, Debug)]
struct ScoredCandidate {
    posting: VectorPostingV1,
    vector: Vec<f64>,
    distance: f64,
}

/// RFC 8785 content identity shared by maintenance and release recheck.
/// Canonical admitted components, rather than binary storage bytes or an
/// in-memory struct comparison, bind the posting to its source derivation.
///
/// @ref LLP 0132#candidate-to-release-consistency — retained and authoritative source content
///   meet at a JCS digest, and released fields come from the latter.
pub fn vector_posting_content_digest(
    row_id: &str,
    source_version: u64,
    partition: &str,
    vector: &[f64],
    filters: &Map<String, Value>,
    fields: &Map<String, Value>,
) -> SnapbackResult<String> {
    let dimensions = u32::try_from(vector.len()).map_err(|_| index_corrupt())?;
    let vector = admit_vector_components(vector, dimensions).map_err(|_| index_corrupt())?;
    crate::rqs_contract::sha256_identity(&json!({
        "rowId": row_id,
        "sourceVersion": source_version,
        "partition": partition,
        "vector": vector,
        "filters": filters,
        "fields": fields,
    }))
    .map_err(|_| index_corrupt())
}

fn work_limit_at(counters: &VectorWorkCountersV1, ceiling: &'static str) -> SnapbackError {
    work_limit().with_details(json!({
        "ceiling": ceiling,
        "counters": counters,
    }))
}

fn checked_increment(
    counter: u64,
    amount: u64,
    counters: &VectorWorkCountersV1,
    ceiling: &'static str,
) -> SnapbackResult<u64> {
    counter
        .checked_add(amount)
        .ok_or_else(|| work_limit_at(counters, ceiling))
}

fn exact_keys(map: &Map<String, Value>, declared: &[String]) -> bool {
    map.len() == declared.len() && declared.iter().all(|field| map.contains_key(field))
}

fn request_value_matches_type(value: &VectorFilterValueV1, field_type: &FieldType) -> bool {
    match (field_type, value) {
        (
            FieldType::String
            | FieldType::Enum { .. }
            | FieldType::Principal
            | FieldType::Id { .. }
            | FieldType::AssetRef { .. },
            VectorFilterValueV1::String(_),
        )
        | (FieldType::Boolean, VectorFilterValueV1::Boolean(_)) => true,
        (FieldType::Integer, VectorFilterValueV1::Number(number)) => number.as_i64().is_some(),
        _ => false,
    }
}

fn stored_value_matches_type(value: &Value, field_type: &FieldType, optional: bool) -> bool {
    if value.is_null() {
        return optional;
    }
    match (field_type, value) {
        (
            FieldType::String
            | FieldType::Enum { .. }
            | FieldType::Principal
            | FieldType::Id { .. }
            | FieldType::AssetRef { .. },
            Value::String(_),
        )
        | (FieldType::Boolean, Value::Bool(_)) => true,
        (FieldType::Integer, Value::Number(number)) => number.as_i64().is_some(),
        _ => false,
    }
}

fn filter_matches(filter: &VectorFilterValueV1, stored: &Value) -> bool {
    match (filter, stored) {
        (VectorFilterValueV1::String(left), Value::String(right)) => left == right,
        (VectorFilterValueV1::Number(left), Value::Number(right)) => left == right,
        (VectorFilterValueV1::Boolean(left), Value::Bool(right)) => left == right,
        _ => false,
    }
}

fn compare_candidates(
    left: &ScoredCandidate,
    right: &ScoredCandidate,
    index: &VectorIndexManifestV1,
) -> Ordering {
    let distance = match index.metric {
        crate::vector::VectorMetricV1::L2sq => left.distance.total_cmp(&right.distance),
        crate::vector::VectorMetricV1::Dot => right.distance.total_cmp(&left.distance),
    };
    distance.then_with(|| match index.tie_break {
        VectorTieBreakV1::IdAsc => left
            .posting
            .row_id
            .as_bytes()
            .cmp(right.posting.row_id.as_bytes()),
        VectorTieBreakV1::IdDesc => right
            .posting
            .row_id
            .as_bytes()
            .cmp(left.posting.row_id.as_bytes()),
    })
}

/// Evaluate one exact-vector request over a single already-authorized posting
/// partition. The caller must hold the same application snapshot while
/// enumerating `postings` and running `release_recheck`.
///
/// The callback returns `Ok(None)` only for a missing authoritative source row.
/// Any callback error, absence, predicate failure, or identity mismatch maps to
/// `SNAPBACK_VECTOR_INDEX_CORRUPT`; no partial page is returned.
///
/// @ref LLP 0132#candidate-to-release-consistency — evaluation is canonical
///   enumeration, declaration-order filters, strict distance, top-k, then one
///   authoritative read and generated-predicate recheck per released row.
pub fn evaluate_vector_query<F>(
    table: &TableManifest,
    index: &VectorIndexManifestV1,
    partition: &str,
    request: VectorRequestV1,
    mut postings: Vec<VectorPostingV1>,
    mut release_recheck: F,
) -> SnapbackResult<VectorQueryEvaluationV1>
where
    F: FnMut(VectorReleaseCandidateV1<'_>) -> SnapbackResult<Option<VectorAuthoritativeReleaseV1>>,
{
    let query =
        admit_vector_components(&request.vector, index.dimensions).map_err(|_| query_invalid())?;
    let k = request.k.unwrap_or(VECTOR_DEFAULT_K);
    if k == 0 || k > VECTOR_MAX_K || partition.is_empty() {
        return Err(query_invalid());
    }

    let requested_filters = request.filters.unwrap_or_default();
    if requested_filters.len() > VECTOR_MAX_FILTERS {
        return Err(query_invalid());
    }
    let mut by_field = BTreeMap::new();
    for filter in requested_filters {
        if by_field.insert(filter.field.clone(), filter).is_some() {
            return Err(query_invalid());
        }
    }

    // Caller order is not semantic. Project the request onto the exact authored
    // declaration order before any posting is observed.
    let mut ordered_filters = Vec::with_capacity(by_field.len());
    for field_name in &index.equality_filters {
        let Some(filter) = by_field.remove(field_name) else {
            continue;
        };
        let field = table.field(field_name).ok_or_else(query_invalid)?;
        if !request_value_matches_type(&filter.value, &field.field_type) {
            return Err(query_invalid());
        }
        ordered_filters.push(filter);
    }
    if !by_field.is_empty() {
        return Err(query_invalid());
    }

    postings.sort_by(|left, right| left.row_id.as_bytes().cmp(right.row_id.as_bytes()));
    let mut previous_row_id: Option<&str> = None;
    let mut counters = VectorWorkCountersV1::default();
    let mut scored = Vec::new();

    for posting in &postings {
        counters.postings_enumerated = checked_increment(
            counters.postings_enumerated,
            1,
            &counters,
            "partitionPostings",
        )?;
        if counters.postings_enumerated > u64::from(index.max_indexed_vectors_per_partition) {
            return Err(work_limit_at(&counters, "partitionPostings"));
        }
        if posting.row_id.is_empty()
            || posting.partition != partition
            || previous_row_id == Some(posting.row_id.as_str())
            || !exact_keys(&posting.filters, &index.equality_filters)
        {
            return Err(index_corrupt());
        }
        previous_row_id = Some(&posting.row_id);

        for field_name in &index.equality_filters {
            let field = table.field(field_name).ok_or_else(index_corrupt)?;
            if !stored_value_matches_type(
                posting
                    .filters
                    .get(field_name)
                    .expect("exact filter keys checked"),
                &field.field_type,
                field.optional,
            ) {
                return Err(index_corrupt());
            }
        }

        let mut accepted = true;
        for filter in &ordered_filters {
            counters.filter_comparisons = checked_increment(
                counters.filter_comparisons,
                1,
                &counters,
                "filterComparisons",
            )?;
            if !filter_matches(
                &filter.value,
                posting
                    .filters
                    .get(&filter.field)
                    .expect("declared posting filter checked"),
            ) {
                accepted = false;
                break;
            }
        }
        if !accepted {
            continue;
        }

        let next_pairs = counters
            .scalar_pairs
            .checked_add(u64::from(index.dimensions))
            .ok_or_else(|| work_limit_at(&counters, "scalarPairs"))?;
        if next_pairs > index.max_scalar_pairs {
            return Err(work_limit_at(&counters, "scalarPairs"));
        }
        let vector = decode_vector_binary64_le(&posting.vector_bytes, index.dimensions)?;
        counters.candidates_scored = counters
            .candidates_scored
            .checked_add(1)
            .ok_or_else(|| work_limit_at(&counters, "scoredCandidates"))?;
        counters.scalar_pairs = next_pairs;
        let distance = strict_distance(index.metric, &query, &vector);
        if !distance.is_finite() || (distance == 0.0 && distance.to_bits() != 0) {
            return Err(index_corrupt());
        }
        scored.push(ScoredCandidate {
            posting: posting.clone(),
            vector,
            distance,
        });
    }

    scored.sort_by(|left, right| compare_candidates(left, right, index));
    scored.truncate(k as usize);

    let mut items = Vec::with_capacity(scored.len());
    for candidate in scored {
        counters.release_source_reads = counters
            .release_source_reads
            .checked_add(1)
            .ok_or_else(|| work_limit_at(&counters, "releaseSourceReads"))?;
        if counters.release_source_reads > u64::from(k) {
            return Err(work_limit_at(&counters, "releaseSourceReads"));
        }
        let release = release_recheck(VectorReleaseCandidateV1 {
            row_id: &candidate.posting.row_id,
            source_version: candidate.posting.source_version,
            partition: &candidate.posting.partition,
            content_digest: &candidate.posting.content_digest,
        })
        .map_err(|_| index_corrupt())?
        .ok_or_else(index_corrupt)?;

        let retained_digest = vector_posting_content_digest(
            &candidate.posting.row_id,
            candidate.posting.source_version,
            &candidate.posting.partition,
            &candidate.vector,
            &candidate.posting.filters,
            &candidate.posting.fields,
        )?;
        if !release.authorized
            || release.source_version != candidate.posting.source_version
            || release.partition != candidate.posting.partition
            || retained_digest != candidate.posting.content_digest
            || release.content_digest != candidate.posting.content_digest
            || !exact_keys(&candidate.posting.fields, &index.stored_fields)
            || !exact_keys(&release.fields, &index.stored_fields)
        {
            return Err(index_corrupt());
        }
        items.push(VectorItemV1 {
            row_id: candidate.posting.row_id,
            distance: candidate.distance,
            fields: release.fields,
        });
    }

    Ok(VectorQueryEvaluationV1 {
        page: VectorPageV1 { items },
        counters,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{FieldManifest, TableManifest};
    use crate::vector::diagnostics::code;
    use crate::vector::storage::encode_vector_binary64_le;
    use crate::vector::{
        VECTOR_DISTANCE_PROFILE_ID, VECTOR_ORDERING_PROFILE_ID, VectorFieldClassV1,
        VectorMaintenanceLimitsV1, VectorMetricV1, VectorVisibilityV1,
    };

    fn table() -> TableManifest {
        TableManifest {
            name: "documents".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "embedding".to_owned(),
                    field_type: FieldType::Vector { dimensions: 2 },
                    optional: false,
                },
                FieldManifest {
                    name: "second".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "first".to_owned(),
                    field_type: FieldType::Integer,
                    optional: false,
                },
                FieldManifest {
                    name: "title".to_owned(),
                    field_type: FieldType::Real,
                    optional: false,
                },
            ],
            indexes: Vec::new(),
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            syncable: false,
            permission_backing: false,
            permission_fields: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        }
    }

    fn index(metric: VectorMetricV1, tie_break: VectorTieBreakV1) -> VectorIndexManifestV1 {
        VectorIndexManifestV1 {
            format_version: 1,
            name: "by_embedding".to_owned(),
            semantic_version: "documents.embedding.v1".to_owned(),
            vector_field: "embedding".to_owned(),
            dimensions: 2,
            metric,
            distance_profile: VECTOR_DISTANCE_PROFILE_ID.to_owned(),
            ordering_profile: VECTOR_ORDERING_PROFILE_ID.to_owned(),
            field_classifications: BTreeMap::from([
                ("embedding".to_owned(), VectorFieldClassV1::Public),
                ("first".to_owned(), VectorFieldClassV1::Public),
                ("second".to_owned(), VectorFieldClassV1::Public),
                ("title".to_owned(), VectorFieldClassV1::Public),
            ]),
            equality_filters: vec!["second".to_owned(), "first".to_owned()],
            stored_fields: vec!["title".to_owned()],
            visibility: VectorVisibilityV1::PublicRead,
            tie_break,
            max_indexed_vectors_per_partition: 8,
            max_scalar_pairs: 16,
            maintenance_limits: VectorMaintenanceLimitsV1::default(),
        }
    }

    fn posting(
        row_id: &str,
        vector: &[f64],
        second: &str,
        first: i64,
        title: Value,
    ) -> VectorPostingV1 {
        let filters = Map::from_iter([
            ("first".to_owned(), json!(first)),
            ("second".to_owned(), json!(second)),
        ]);
        let fields = Map::from_iter([("title".to_owned(), title)]);
        let digest =
            vector_posting_content_digest(row_id, 7, "public", vector, &filters, &fields).unwrap();
        VectorPostingV1 {
            row_id: row_id.to_owned(),
            source_version: 7,
            partition: "public".to_owned(),
            vector_bytes: encode_vector_binary64_le(vector, 2).unwrap(),
            filters,
            fields,
            content_digest: digest,
        }
    }

    fn authoritative(posting: &VectorPostingV1) -> VectorAuthoritativeReleaseV1 {
        VectorAuthoritativeReleaseV1 {
            source_version: posting.source_version,
            partition: posting.partition.clone(),
            content_digest: posting.content_digest.clone(),
            authorized: true,
            fields: posting.fields.clone(),
        }
    }

    #[test]
    fn request_admission_refuses_before_posting_or_release_work() {
        let table = table();
        let index = index(VectorMetricV1::L2sq, VectorTieBreakV1::IdAsc);
        let invalid = [
            VectorRequestV1 {
                vector: vec![0.0],
                k: None,
                filters: None,
            },
            VectorRequestV1 {
                vector: vec![0.0, 0.0],
                k: Some(0),
                filters: None,
            },
            VectorRequestV1 {
                vector: vec![0.0, 0.0],
                k: None,
                filters: Some(vec![
                    crate::vector::VectorFilterV1 {
                        field: "first".to_owned(),
                        op: Default::default(),
                        value: VectorFilterValueV1::Number(1.into()),
                    },
                    crate::vector::VectorFilterV1 {
                        field: "first".to_owned(),
                        op: Default::default(),
                        value: VectorFilterValueV1::Number(2.into()),
                    },
                ]),
            },
            VectorRequestV1 {
                vector: vec![0.0, 0.0],
                k: None,
                filters: Some(vec![crate::vector::VectorFilterV1 {
                    field: "unknown".to_owned(),
                    op: Default::default(),
                    value: VectorFilterValueV1::Boolean(true),
                }]),
            },
            VectorRequestV1 {
                vector: vec![0.0, 0.0],
                k: None,
                filters: Some(vec![crate::vector::VectorFilterV1 {
                    field: "first".to_owned(),
                    op: Default::default(),
                    value: VectorFilterValueV1::String("1".to_owned()),
                }]),
            },
        ];
        for request in invalid {
            let error =
                evaluate_vector_query(&table, &index, "public", request, Vec::new(), |_| {
                    panic!("invalid request reached release")
                })
                .expect_err("invalid request refuses");
            assert_eq!(error.diagnostic.code, code::QUERY_INVALID);
        }
    }

    #[test]
    fn canonical_enumeration_and_declaration_order_pin_work_counters() {
        let table = table();
        let index = index(VectorMetricV1::L2sq, VectorTieBreakV1::IdAsc);
        let a = posting("row-a", &[3.0, 0.0], "blue", 1, json!(1.0));
        let b = posting("row-b", &[2.0, 0.0], "red", 2, json!(2.0));
        let c = posting("row-c", &[1.0, 0.0], "red", 1, json!(3.0));
        let source = BTreeMap::from([
            (a.row_id.clone(), authoritative(&a)),
            (b.row_id.clone(), authoritative(&b)),
            (c.row_id.clone(), authoritative(&c)),
        ]);
        let request = VectorRequestV1 {
            vector: vec![0.0, -0.0],
            k: Some(3),
            // Reverse caller order deliberately. `second` is declared first.
            filters: Some(vec![
                crate::vector::VectorFilterV1 {
                    field: "first".to_owned(),
                    op: Default::default(),
                    value: VectorFilterValueV1::Number(1.into()),
                },
                crate::vector::VectorFilterV1 {
                    field: "second".to_owned(),
                    op: Default::default(),
                    value: VectorFilterValueV1::String("red".to_owned()),
                },
            ]),
        };
        let evaluation = evaluate_vector_query(
            &table,
            &index,
            "public",
            request,
            vec![c, b, a],
            |candidate| Ok(source.get(candidate.row_id).cloned()),
        )
        .unwrap();
        assert_eq!(
            evaluation
                .page
                .items
                .iter()
                .map(|item| item.row_id.as_str())
                .collect::<Vec<_>>(),
            vec!["row-c"]
        );
        assert_eq!(
            evaluation.counters,
            VectorWorkCountersV1 {
                postings_enumerated: 3,
                filter_comparisons: 5,
                candidates_scored: 1,
                scalar_pairs: 2,
                release_source_reads: 1,
            }
        );
        assert_eq!(
            evaluation.page.items[0].distance.to_bits(),
            1.0_f64.to_bits()
        );
    }

    #[test]
    fn distance_then_declared_row_id_direction_is_a_total_order() {
        let table = table();
        for (metric, tie_break, expected) in [
            (
                VectorMetricV1::L2sq,
                VectorTieBreakV1::IdDesc,
                vec!["row-b", "row-a"],
            ),
            (
                VectorMetricV1::Dot,
                VectorTieBreakV1::IdAsc,
                vec!["row-a", "row-b"],
            ),
        ] {
            let mut index = index(metric, tie_break);
            index.equality_filters.clear();
            index.field_classifications.remove("first");
            index.field_classifications.remove("second");
            let mut a = posting("row-a", &[1.0, 0.0], "x", 1, json!(1.0));
            let mut b = posting("row-b", &[1.0, 0.0], "x", 1, json!(2.0));
            for posting in [&mut a, &mut b] {
                posting.filters.clear();
                posting.content_digest = vector_posting_content_digest(
                    &posting.row_id,
                    posting.source_version,
                    &posting.partition,
                    &[1.0, 0.0],
                    &posting.filters,
                    &posting.fields,
                )
                .unwrap();
            }
            let source = BTreeMap::from([
                (a.row_id.clone(), authoritative(&a)),
                (b.row_id.clone(), authoritative(&b)),
            ]);
            let evaluation = evaluate_vector_query(
                &table,
                &index,
                "public",
                VectorRequestV1 {
                    vector: vec![1.0, 0.0],
                    k: Some(2),
                    filters: None,
                },
                vec![b, a],
                |candidate| Ok(source.get(candidate.row_id).cloned()),
            )
            .unwrap();
            assert_eq!(
                evaluation
                    .page
                    .items
                    .iter()
                    .map(|item| item.row_id.as_str())
                    .collect::<Vec<_>>(),
                expected
            );
        }
    }

    #[test]
    fn first_exceeded_logical_ceiling_refuses_without_release() {
        let table = table();
        let mut index = index(VectorMetricV1::L2sq, VectorTieBreakV1::IdAsc);
        index.equality_filters.clear();
        index.stored_fields.clear();
        index.max_indexed_vectors_per_partition = 2;
        index.max_scalar_pairs = 4;
        let postings = ["a", "b", "c"]
            .into_iter()
            .map(|row_id| {
                let mut posting = posting(row_id, &[0.0, 0.0], "x", 1, json!(1.0));
                posting.filters.clear();
                posting.fields.clear();
                posting.content_digest = vector_posting_content_digest(
                    row_id,
                    7,
                    "public",
                    &[0.0, 0.0],
                    &posting.filters,
                    &posting.fields,
                )
                .unwrap();
                posting
            })
            .collect();
        let error = evaluate_vector_query(
            &table,
            &index,
            "public",
            VectorRequestV1 {
                vector: vec![0.0, 0.0],
                k: Some(1),
                filters: None,
            },
            postings,
            |_| panic!("work refusal must precede release"),
        )
        .expect_err("third posting exceeds corpus work ceiling");
        assert_eq!(error.diagnostic.code, code::WORK_LIMIT);
        assert_eq!(error.diagnostic.details["ceiling"], "partitionPostings");
        assert_eq!(
            error.diagnostic.details["counters"]["postingsEnumerated"],
            3
        );
    }

    #[test]
    fn release_is_authoritative_jcs_based_and_never_partial() {
        let table = table();
        let mut index = index(VectorMetricV1::L2sq, VectorTieBreakV1::IdAsc);
        index.equality_filters.clear();
        let mut a = posting("row-a", &[0.0, 0.0], "x", 1, json!(5));
        a.filters.clear();
        a.content_digest = vector_posting_content_digest(
            &a.row_id,
            a.source_version,
            &a.partition,
            &[0.0, 0.0],
            &a.filters,
            &a.fields,
        )
        .unwrap();
        let request = VectorRequestV1 {
            vector: vec![0.0, 0.0],
            k: Some(1),
            filters: None,
        };
        let evaluation = evaluate_vector_query(
            &table,
            &index,
            "public",
            request.clone(),
            vec![a.clone()],
            |_| {
                Ok(Some(VectorAuthoritativeReleaseV1 {
                    source_version: 7,
                    partition: "public".to_owned(),
                    content_digest: a.content_digest.clone(),
                    authorized: true,
                    fields: Map::from_iter([("title".to_owned(), json!(5.0))]),
                }))
            },
        )
        .expect("JCS equates integral Real spellings at the digest boundary");
        assert_eq!(evaluation.page.items[0].fields["title"], json!(5.0));

        for release in [
            None,
            Some(VectorAuthoritativeReleaseV1 {
                source_version: 7,
                partition: "public".to_owned(),
                content_digest: a.content_digest.clone(),
                authorized: false,
                fields: a.fields.clone(),
            }),
            Some(VectorAuthoritativeReleaseV1 {
                source_version: 8,
                partition: "public".to_owned(),
                content_digest: a.content_digest.clone(),
                authorized: true,
                fields: a.fields.clone(),
            }),
        ] {
            let error = evaluate_vector_query(
                &table,
                &index,
                "public",
                request.clone(),
                vec![a.clone()],
                |_| Ok(release.clone()),
            )
            .expect_err("every release-recheck drift shape fails closed");
            assert_eq!(error.diagnostic.code, code::INDEX_CORRUPT);
        }

        let mut tampered = a;
        tampered.fields.insert("title".to_owned(), json!(6));
        let error = evaluate_vector_query(
            &table,
            &index,
            "public",
            request,
            vec![tampered.clone()],
            |_| Ok(Some(authoritative(&tampered))),
        )
        .expect_err("retained bytes must match their retained digest");
        assert_eq!(error.diagnostic.code, code::INDEX_CORRUPT);
    }

    #[test]
    fn malformed_partition_projection_and_duplicate_ids_are_corruption() {
        let table = table();
        let index = index(VectorMetricV1::L2sq, VectorTieBreakV1::IdAsc);
        let base = posting("row-a", &[0.0, 0.0], "red", 1, json!(1.0));
        let mut wrong_partition = base.clone();
        wrong_partition.partition = "owner:elsewhere".to_owned();
        let mut missing_filter = base.clone();
        missing_filter.filters.remove("second");
        for postings in [
            vec![wrong_partition],
            vec![missing_filter],
            vec![base.clone(), base.clone()],
        ] {
            let error = evaluate_vector_query(
                &table,
                &index,
                "public",
                VectorRequestV1 {
                    vector: vec![0.0, 0.0],
                    k: None,
                    filters: None,
                },
                postings,
                |_| panic!("corrupt posting must not reach release"),
            )
            .expect_err("malformed posting refuses");
            assert_eq!(error.diagnostic.code, code::INDEX_CORRUPT);
        }
    }
}
