//! Type-aware refusal suggestions derived only from the currently served
//! manifest/catalog generation.
//!
//! This module produces candidates and the ruled contextual remediation set
//! for the existing diagnostic `details` map. The candidate source and the
//! machine-applicable entries are therefore one generation-fenced decision.
//!
//! @ref LLP 0146#d7-typed-remediations-and-type-aware-suggestion — unknown
//!   identifiers and argument shapes name typed candidates from served truth,
//!   with a bounded process-local summary for repeated misses.
//! @ref LLP 0144#axis-i--disclosure-posture — suggestions contain served
//!   schema/function metadata only, never rejected values or secret bytes.

use crate::diagnostic::SnapbackError;
use crate::manifest::{
    FieldType, FunctionDefinition, FunctionKind, FunctionManifest, ResultObjectFieldContract,
    ResultValueContract, TableManifest,
};
use crate::remediation::{
    RemediationItemV1, RemediationKindV1, RemediationSetV1, attach_remediation_set,
};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, VecDeque};
use std::sync::{Mutex, OnceLock};

pub const LOCAL_MISS_CAPACITY: usize = 128;
const LOCAL_MISS_COUNT_MAX: u64 = 255;
const FUNCTION_CANDIDATE_LIMIT: usize = 8;
const PATH_CANDIDATE_LIMIT: usize = 8;
const FIELD_CANDIDATE_LIMIT: usize = 16;
const IDENTIFIER_DISTANCE_BYTES: usize = 128;

#[derive(Default)]
struct MissState {
    counts: BTreeMap<String, u64>,
    order: VecDeque<String>,
}

struct MissTracker {
    capacity: usize,
    state: Mutex<MissState>,
}

impl MissTracker {
    fn new(capacity: usize) -> Self {
        Self {
            capacity,
            state: Mutex::new(MissState::default()),
        }
    }

    fn record(&self, category: &str, generation: Option<&str>, guessed: &str) -> Value {
        let mut digest = Sha256::new();
        digest.update(category.as_bytes());
        digest.update([0]);
        digest.update(generation.unwrap_or("unversioned").as_bytes());
        digest.update([0]);
        digest.update(guessed.as_bytes());
        let key = format!("{:x}", digest.finalize());

        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (same_miss_count, count_capped) = if state.counts.contains_key(&key) {
            let (same_miss_count, count_capped) = {
                let count = state.counts.get_mut(&key).expect("known miss key exists");
                let was_capped = *count == LOCAL_MISS_COUNT_MAX;
                *count = count.saturating_add(1).min(LOCAL_MISS_COUNT_MAX);
                (*count, was_capped || *count == LOCAL_MISS_COUNT_MAX)
            };
            state.order.retain(|candidate| candidate != &key);
            state.order.push_back(key.clone());
            (same_miss_count, count_capped)
        } else {
            while state.counts.len() >= self.capacity {
                let Some(evicted) = state.order.pop_front() else {
                    break;
                };
                state.counts.remove(&evicted);
            }
            state.counts.insert(key.clone(), 1);
            state.order.push_back(key);
            (1, false)
        };
        json!({
            "scope": "process-local",
            "sameMissCount": same_miss_count,
            "repeated": same_miss_count > 1,
            "trackedDistinctMisses": state.counts.len(),
            "capacity": self.capacity,
            "countCapped": count_capped,
        })
    }
}

fn miss_tracker() -> &'static MissTracker {
    static TRACKER: OnceLock<MissTracker> = OnceLock::new();
    TRACKER.get_or_init(|| MissTracker::new(LOCAL_MISS_CAPACITY))
}

fn bounded_identifier(value: &str) -> String {
    value
        .chars()
        .take(IDENTIFIER_DISTANCE_BYTES)
        .collect::<String>()
        .to_ascii_lowercase()
}

fn edit_distance(left: &str, right: &str) -> usize {
    let left = bounded_identifier(left).into_bytes();
    let right = bounded_identifier(right).into_bytes();
    let mut prior = (0..=right.len()).collect::<Vec<_>>();
    let mut current = vec![0; right.len() + 1];
    for (left_index, left_byte) in left.iter().enumerate() {
        current[0] = left_index + 1;
        for (right_index, right_byte) in right.iter().enumerate() {
            current[right_index + 1] = (prior[right_index + 1] + 1)
                .min(current[right_index] + 1)
                .min(prior[right_index] + usize::from(left_byte != right_byte));
        }
        std::mem::swap(&mut prior, &mut current);
    }
    prior[right.len()]
}

fn function_distance(guess: &str, function: &FunctionDefinition) -> usize {
    std::iter::once(function.name.as_str())
        .chain(std::iter::once(function.id.as_str()))
        .chain(function.exported_name.as_deref())
        .map(|candidate| edit_distance(guess, candidate))
        .min()
        .unwrap_or(usize::MAX)
}

fn kind_matches(function: &FunctionDefinition, expected: &[FunctionKind]) -> bool {
    expected.is_empty() || expected.iter().any(|kind| kind == &function.kind)
}

/// Existing-details content for an unknown function refusal. The miss itself
/// is intentionally absent; only served identifiers appear in the candidates.
pub fn unknown_function_details(
    manifest: &FunctionManifest,
    guessed: &str,
    expected_kinds: &[FunctionKind],
) -> Value {
    let mut functions = manifest
        .functions
        .iter()
        .filter(|function| kind_matches(function, expected_kinds))
        .collect::<Vec<_>>();
    functions.sort_by(|left, right| {
        function_distance(guessed, left)
            .cmp(&function_distance(guessed, right))
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.id.cmp(&right.id))
    });
    let candidate_count = functions.len();
    let candidates = functions
        .into_iter()
        .take(FUNCTION_CANDIDATE_LIMIT)
        .map(|function| {
            json!({
                "id": function.id,
                "name": function.name,
                "exportedName": function.exported_name,
                "kind": function.kind,
                "argsContractHash": function.args_contract_hash,
            })
        })
        .collect::<Vec<_>>();
    let mut details = json!({
        "artifactHash": manifest.bundle_hash,
        "expectedKinds": expected_kinds,
        "candidateFunctions": candidates.clone(),
        "candidateFunctionCount": candidate_count,
        "candidatesTruncated": candidate_count > FUNCTION_CANDIDATE_LIMIT,
        "localMissSummary": miss_tracker().record(
            "unknown-function",
            manifest.bundle_hash.as_deref(),
            guessed,
        ),
    });
    if let Some(artifact_hash) = manifest.bundle_hash.as_deref() {
        let items = candidates
            .iter()
            .filter_map(|candidate| candidate.get("name").and_then(Value::as_str))
            .map(|replacement| {
                RemediationItemV1::identifier_replacement(
                    RemediationKindV1::FixTypo,
                    artifact_hash,
                    "function",
                    None,
                    replacement,
                )
            })
            .collect();
        attach_remediation_set(
            &mut details,
            RemediationSetV1::for_artifact(artifact_hash, items),
        );
    }
    details
}

pub fn unknown_function_error(
    manifest: &FunctionManifest,
    guessed: &str,
    expected_kinds: &[FunctionKind],
) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_UNKNOWN_FUNCTION",
        "runtime",
        "the requested function is not in the served function manifest",
    )
    .with_details(unknown_function_details(manifest, guessed, expected_kinds))
}

pub fn unknown_operation_details(
    guessed: &str,
    operations: &[&str],
    artifact_hash: Option<&str>,
) -> Value {
    let mut operations = operations.to_vec();
    operations.sort_by(|left, right| {
        edit_distance(guessed, left)
            .cmp(&edit_distance(guessed, right))
            .then_with(|| left.cmp(right))
    });
    let candidate_count = operations.len();
    let candidates = operations
        .into_iter()
        .take(FUNCTION_CANDIDATE_LIMIT)
        .collect::<Vec<_>>();
    let mut details = json!({
        "operation": "unrecognized",
        "artifactHash": artifact_hash,
        "candidateOperations": candidates.clone(),
        "candidateOperationCount": candidate_count,
        "candidatesTruncated": candidate_count > FUNCTION_CANDIDATE_LIMIT,
        "localMissSummary": miss_tracker().record(
            "unknown-operation",
            artifact_hash,
            guessed,
        ),
    });
    if let Some(artifact_hash) = artifact_hash {
        let items = candidates
            .iter()
            .map(|replacement| {
                RemediationItemV1::identifier_replacement(
                    RemediationKindV1::FixTypo,
                    artifact_hash,
                    "hostOperation",
                    None,
                    *replacement,
                )
            })
            .collect();
        // @ref LLP 0146#oq6-author-ruling--2026-08-10 — offers are built at
        //   the refusal site from the exact ControlCatalog generation seen.
        attach_remediation_set(
            &mut details,
            RemediationSetV1::for_artifact(artifact_hash, items),
        );
    }
    details
}

/// Existing-details content for an unmatched HTTP path. Candidates come only
/// from the registry that installed the router, never from a copied path list.
/// The attacker-controlled spelling is used for ranking and the bounded local
/// miss counter, but is not reflected in the public diagnostic details.
///
/// @ref LLP 0031#enforcement — route_registry() is the path authority; an
///   unmatched route may suggest only entries from that exact registry.
pub fn unknown_path_details(guessed: &str, paths: &[&str]) -> Value {
    let mut candidates = paths.to_vec();
    candidates.sort_unstable();
    candidates.dedup();
    let artifact_hash = path_set_hash(&candidates);
    candidates.sort_by(|left, right| {
        edit_distance(guessed, left)
            .cmp(&edit_distance(guessed, right))
            .then_with(|| left.cmp(right))
    });
    let candidate_count = candidates.len();
    let candidates = candidates
        .into_iter()
        .take(PATH_CANDIDATE_LIMIT)
        .collect::<Vec<_>>();
    let mut details = json!({
        "path": "unrecognized",
        "artifactHash": artifact_hash,
        "candidatePaths": candidates.clone(),
        "candidatePathCount": candidate_count,
        "candidatesTruncated": candidate_count > PATH_CANDIDATE_LIMIT,
        "localMissSummary": miss_tracker().record("unknown-route", Some(&artifact_hash), guessed),
    });
    let items = candidates
        .iter()
        .map(|replacement| {
            RemediationItemV1::identifier_replacement(
                RemediationKindV1::FixTypo,
                &artifact_hash,
                "httpRoute",
                None,
                *replacement,
            )
        })
        .collect();
    attach_remediation_set(
        &mut details,
        RemediationSetV1::for_artifact(&artifact_hash, items),
    );
    details
}

pub fn path_set_hash(paths: &[&str]) -> String {
    let mut paths = paths.to_vec();
    paths.sort_unstable();
    paths.dedup();
    let mut digest = Sha256::new();
    for path in paths {
        digest.update(path.as_bytes());
        digest.update([0]);
    }
    format!("sha256:{:x}", digest.finalize())
}

fn contract_kind(contract: &ResultValueContract) -> &'static str {
    match contract {
        ResultValueContract::Null => "null",
        ResultValueContract::Boolean => "boolean",
        ResultValueContract::String { .. } => "string",
        ResultValueContract::Integer { .. } => "integer",
        ResultValueContract::FiniteReal { .. } => "finiteReal",
        ResultValueContract::Principal => "principal",
        ResultValueContract::AssetRef => "assetRef",
        ResultValueContract::MediaRefV1 { .. } => "mediaRef.v1",
        ResultValueContract::Id { .. } => "id",
        ResultValueContract::Literal { .. } => "literal",
        ResultValueContract::Json { .. } => "json",
        ResultValueContract::Array { .. } => "array",
        ResultValueContract::Tuple { .. } => "tuple",
        ResultValueContract::Vector { .. } => "vector",
        ResultValueContract::Union { .. } => "union",
        ResultValueContract::Object { .. } => "object",
        ResultValueContract::PlatformSchemaRef { .. } => "platformSchemaRef",
    }
}

fn contract_field_candidates(
    fields: &[ResultObjectFieldContract],
    guessed: Option<&str>,
) -> (Vec<Value>, usize) {
    let mut fields = fields.iter().collect::<Vec<_>>();
    if let Some(guessed) = guessed {
        fields.sort_by(|left, right| {
            edit_distance(guessed, &left.name)
                .cmp(&edit_distance(guessed, &right.name))
                .then_with(|| left.name.cmp(&right.name))
        });
    }
    let count = fields.len();
    let values = fields
        .into_iter()
        .take(FIELD_CANDIDATE_LIMIT)
        .map(|field| {
            json!({
                "name": field.name,
                "required": field.required,
                "expected": contract_kind(&field.value),
            })
        })
        .collect();
    (values, count)
}

/// Merge the served argument contract and field candidates into a refusal's
/// existing details object. `unknown_field` carries the rejected name only
/// transiently for ranking/tracking; it is never serialized.
pub fn enrich_argument_details(
    details: &mut Map<String, Value>,
    function: &FunctionDefinition,
    unknown_field: Option<(&str, &[ResultObjectFieldContract])>,
) {
    let Some(contract) = function.args_contract.as_ref() else {
        return;
    };
    details.insert(
        "artifactHash".to_owned(),
        function
            .args_contract_hash
            .clone()
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    details.insert(
        "expectedArgumentContract".to_owned(),
        serde_json::to_value(contract).expect("argument contract serializes"),
    );
    let (fields, guessed) = unknown_field
        .map(|(guessed, fields)| (fields, Some(guessed)))
        .unwrap_or((&contract.fields, None));
    let (candidates, count) = contract_field_candidates(fields, guessed);
    details.insert("candidateFields".to_owned(), Value::Array(candidates));
    details.insert("candidateFieldCount".to_owned(), Value::from(count));
    details.insert(
        "candidatesTruncated".to_owned(),
        Value::Bool(count > FIELD_CANDIDATE_LIMIT),
    );
    if let Some((guessed, _)) = unknown_field {
        details.insert(
            "localMissSummary".to_owned(),
            miss_tracker().record(
                "unknown-argument-field",
                function.args_contract_hash.as_deref(),
                guessed,
            ),
        );
        if let Some(artifact_hash) = function.args_contract_hash.as_deref() {
            let items = details
                .get("candidateFields")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|candidate| candidate.get("name").and_then(Value::as_str))
                .map(|replacement| {
                    RemediationItemV1::identifier_replacement(
                        RemediationKindV1::FixTypo,
                        artifact_hash,
                        "argumentField",
                        Some(function.id.clone()),
                        replacement,
                    )
                })
                .collect();
            let mut carrier_details = Value::Object(std::mem::take(details));
            attach_remediation_set(
                &mut carrier_details,
                RemediationSetV1::for_artifact(artifact_hash, items),
            );
            *details = carrier_details
                .as_object_mut()
                .map(std::mem::take)
                .expect("carrier details stays an object");
        }
    }
}

fn field_type_name(field_type: &FieldType) -> &'static str {
    match field_type {
        FieldType::String => "string",
        FieldType::Enum { .. } => "enum",
        FieldType::Integer => "integer",
        FieldType::Real => "real",
        FieldType::Boolean => "boolean",
        FieldType::Json => "json",
        FieldType::Structured { .. } => "structured",
        FieldType::Principal => "principal",
        FieldType::Id { .. } => "id",
        FieldType::RelationIncarnation { .. } => "relationIncarnation",
        FieldType::Vector { .. } => "vector",
        FieldType::AssetRef { .. } => "assetRef",
    }
}

pub fn unknown_schema_field_details(table: &TableManifest, guessed: &str) -> Value {
    let served_shape_hash = table_shape_hash(table);
    let mut fields = table.fields.iter().collect::<Vec<_>>();
    fields.sort_by(|left, right| {
        edit_distance(guessed, &left.name)
            .cmp(&edit_distance(guessed, &right.name))
            .then_with(|| left.name.cmp(&right.name))
    });
    let candidate_count = fields.len();
    let candidates = fields
        .into_iter()
        .take(FIELD_CANDIDATE_LIMIT)
        .map(|field| {
            json!({
                "name": field.name,
                "optional": field.optional,
                "expected": field_type_name(&field.field_type),
            })
        })
        .collect::<Vec<_>>();
    let mut details = json!({
        "table": table.name,
        "artifactHash": served_shape_hash,
        "servedShapeHash": served_shape_hash,
        "candidateFields": candidates.clone(),
        "candidateFieldCount": candidate_count,
        "candidatesTruncated": candidate_count > FIELD_CANDIDATE_LIMIT,
        "localMissSummary": miss_tracker().record(
            "unknown-schema-field",
            Some(&served_shape_hash),
            guessed,
        ),
    });
    let items = candidates
        .iter()
        .filter_map(|candidate| candidate.get("name").and_then(Value::as_str))
        .map(|replacement| {
            RemediationItemV1::identifier_replacement(
                RemediationKindV1::FixTypo,
                &served_shape_hash,
                "schemaField",
                Some(table.name.clone()),
                replacement,
            )
        })
        .collect();
    attach_remediation_set(
        &mut details,
        RemediationSetV1::for_artifact(&served_shape_hash, items),
    );
    details
}

pub fn table_shape_hash(table: &TableManifest) -> String {
    let mut digest = Sha256::new();
    digest.update(serde_json::to_vec(table).expect("table manifest serializes"));
    format!("sha256:{:x}", digest.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn miss_tracker_is_lru_bounded_and_counts_repeats_without_echoing_names() {
        let tracker = MissTracker::new(3);
        assert_eq!(
            tracker.record("function", Some("generation"), "same")["sameMissCount"],
            1
        );
        assert_eq!(
            tracker.record("function", Some("generation"), "same")["sameMissCount"],
            2
        );
        let third = tracker.record("function", Some("generation"), "same");
        assert_eq!(third["sameMissCount"], 3);
        assert_eq!(third["repeated"], true);
        for guessed in ["two", "three", "four"] {
            tracker.record("function", Some("generation"), guessed);
        }
        let bounded = tracker.record("function", Some("generation"), "four");
        assert_eq!(bounded["trackedDistinctMisses"], 3);
        assert_eq!(bounded["capacity"], 3);
        let serialized = serde_json::to_string(&bounded).unwrap();
        assert!(!serialized.contains("four"));
    }

    #[test]
    fn edit_distance_ranks_typo_candidates_deterministically() {
        let mut candidates = ["createTodo", "deleteTodo", "listTodos"];
        candidates.sort_by(|left, right| {
            edit_distance("listTods", left)
                .cmp(&edit_distance("listTods", right))
                .then_with(|| left.cmp(right))
        });
        assert_eq!(candidates[0], "listTodos");
    }
}
