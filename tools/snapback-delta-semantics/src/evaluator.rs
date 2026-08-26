//! Executable form rules and atomic whole-graph composition.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use super::types::*;

#[derive(Debug)]
enum DynamicVerdict {
    Maintain { delta_out: Value, next_state: Value },
    Fallback(FallbackReason),
}

fn dynamic<Delta: Serialize, State: Serialize>(
    verdict: FormVerdict<Delta, State>,
) -> DynamicVerdict {
    match verdict {
        FormVerdict::Maintain {
            delta_out,
            next_state,
        } => DynamicVerdict::Maintain {
            delta_out: serde_json::to_value(delta_out).expect("reference delta serializes"),
            next_state: serde_json::to_value(next_state).expect("reference state serializes"),
        },
        FormVerdict::Fallback { reason } => DynamicVerdict::Fallback(reason),
    }
}

fn parse<T: DeserializeOwned>(value: Value) -> Result<T, FallbackReason> {
    serde_json::from_value(value).map_err(|_| FallbackReason::PredicateUnanalyzable)
}

fn render(verdict: DynamicVerdict) -> Value {
    match verdict {
        DynamicVerdict::Maintain {
            delta_out,
            next_state,
        } => json!({
            "verdict": "Maintain",
            "deltaOut": delta_out,
            "nextState": next_state,
        }),
        DynamicVerdict::Fallback(reason) => json!({
            "verdict": "Fallback",
            "reason": reason,
        }),
    }
}

/// Evaluate one corpus case without reading or mutating ambient state.
pub fn evaluate_case(case: &DeltaSemanticsCase) -> Value {
    evaluate_operator(
        &case.operator,
        case.initial_state.clone(),
        case.folded_change_batch.clone(),
        &case.read_transcript,
    )
}

/// Evaluate one operator form. The JSON envelope exists only so a single
/// corpus runner can dispatch the faithfully typed per-form state carriers.
pub fn evaluate_operator(
    operator: &Operator,
    state: Value,
    input: Value,
    reads: &ReadTranscript,
) -> Value {
    render(evaluate_dynamic(operator, state, input, reads))
}

fn evaluate_dynamic(
    operator: &Operator,
    state: Value,
    input: Value,
    reads: &ReadTranscript,
) -> DynamicVerdict {
    let parsed = match operator {
        Operator::Admit { config } => parse::<AdmitState>(state).and_then(|state| {
            parse::<AdmitInput>(input)
                .map(|input| dynamic(evaluate_admit(config, state, input, reads)))
        }),
        Operator::Window { config } => parse::<WindowState>(state).and_then(|state| {
            parse::<DeltaZBatch>(input)
                .map(|input| dynamic(evaluate_window(config, state, input, reads)))
        }),
        Operator::KeyedLookup { config } => parse::<LookupState>(state).and_then(|state| {
            parse::<LookupInput>(input)
                .map(|input| dynamic(evaluate_lookup(config, state, input, reads)))
        }),
        Operator::PerParentWindow { config } => {
            parse::<PerParentWindowState>(state).and_then(|state| {
                parse::<PerParentWindowInput>(input)
                    .map(|input| dynamic(evaluate_per_parent_window(config, state, input, reads)))
            })
        }
        Operator::SupportSemiJoin { config } => parse::<SupportState>(state).and_then(|state| {
            parse::<SupportInput>(input)
                .map(|input| dynamic(evaluate_support(config, state, input, reads)))
        }),
        Operator::MembershipLift { config } => {
            parse::<MembershipLiftState>(state).and_then(|state| {
                parse::<MembershipLiftInput>(input)
                    .map(|input| dynamic(evaluate_membership_lift(config, state, input, reads)))
            })
        }
        Operator::PrincipalBind { config } => parse::<PrincipalState>(state).and_then(|state| {
            parse::<PrincipalInput>(input)
                .map(|input| dynamic(evaluate_principal(config, state, input, reads)))
        }),
        Operator::Assemble { config } => parse::<AssembleState>(state).and_then(|state| {
            parse::<AssembleInput>(input)
                .map(|input| dynamic(evaluate_assemble(config, state, input)))
        }),
        Operator::Composition { nodes } => {
            Ok(dynamic(evaluate_composition(nodes, state, input, reads)))
        }
    };
    parsed.unwrap_or_else(DynamicVerdict::Fallback)
}

/// Fold a raw application batch per row key in first-seen order.
// @ref LLP 0309.000#11-δapp--the-admitted-application-row-change-carrier-input —
// first/last operation kinds and the first raw pre-image define the net batch.
pub fn fold_app_batch(batch: &AppBatch) -> Vec<FoldedAppChange> {
    #[derive(Clone)]
    struct Acc {
        first_op: ChangeOp,
        last_op: ChangeOp,
        first_pre: Option<Row>,
        last_post: Option<Row>,
        changed_fields: BTreeSet<String>,
        unknown_fields: bool,
    }

    let mut order = Vec::new();
    let mut by_key = BTreeMap::<String, Acc>::new();
    for change in &batch.changes {
        if !by_key.contains_key(&change.row_key) {
            order.push(change.row_key.clone());
            by_key.insert(
                change.row_key.clone(),
                Acc {
                    first_op: change.op,
                    last_op: change.op,
                    first_pre: change.pre_image.clone(),
                    last_post: change.post_image.clone(),
                    changed_fields: change.changed_fields.clone(),
                    unknown_fields: change.op == ChangeOp::Update
                        && change.changed_fields.is_empty(),
                },
            );
        } else if let Some(acc) = by_key.get_mut(&change.row_key) {
            acc.last_op = change.op;
            acc.last_post = change.post_image.clone();
            if change.op == ChangeOp::Update && change.changed_fields.is_empty() {
                acc.unknown_fields = true;
            }
            acc.changed_fields
                .extend(change.changed_fields.iter().cloned());
        }
    }

    order
        .into_iter()
        .filter_map(|row_key| {
            let acc = by_key.remove(&row_key)?;
            if acc.first_op == ChangeOp::Insert && acc.last_op == ChangeOp::Delete {
                return None;
            }
            let op = match (acc.first_op, acc.last_op) {
                (ChangeOp::Insert, ChangeOp::Insert | ChangeOp::Update) => ChangeOp::Insert,
                (ChangeOp::Update | ChangeOp::Delete, ChangeOp::Delete) => ChangeOp::Delete,
                (ChangeOp::Update | ChangeOp::Delete, ChangeOp::Insert | ChangeOp::Update) => {
                    ChangeOp::Update
                }
                (ChangeOp::Insert, ChangeOp::Delete) => unreachable!(),
            };
            Some(FoldedAppChange {
                row_key,
                op,
                post_image: if op == ChangeOp::Delete {
                    None
                } else {
                    acc.last_post
                },
                pre_image: acc.first_pre,
                changed_fields: if acc.unknown_fields
                    || (acc.first_op == ChangeOp::Delete && op == ChangeOp::Update)
                {
                    BTreeSet::new()
                } else {
                    acc.changed_fields
                },
            })
        })
        .collect()
}

fn row_key(row: &Row) -> Option<String> {
    row.get("_id")
        .or_else(|| row.get("id"))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn field_values(row: &Row, fields: &[String]) -> Option<Vec<Value>> {
    let values = fields
        .iter()
        .map(|field| row.get(field).cloned().unwrap_or(Value::Null))
        .collect::<Vec<_>>();
    values.iter().all(canonical_scalar).then_some(values)
}

fn lookup_key(row: &Row, fields: &[String]) -> Result<Option<Vec<Value>>, FallbackReason> {
    let Some(values) = field_values(row, fields) else {
        return Err(FallbackReason::PredicateUnanalyzable);
    };
    if values.iter().any(Value::is_null) {
        Ok(None)
    } else {
        Ok(Some(values))
    }
}

fn canonical_scalar(value: &Value) -> bool {
    matches!(
        value,
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_)
    )
}

fn scalar_cmp(left: &Value, right: &Value) -> Option<Ordering> {
    use Value::*;
    match (left, right) {
        (Null, Null) => Some(Ordering::Equal),
        (Null, _) => Some(Ordering::Greater),
        (_, Null) => Some(Ordering::Less),
        (Bool(a), Bool(b)) => Some(a.cmp(b)),
        (Number(a), Number(b)) => a.as_f64()?.partial_cmp(&b.as_f64()?),
        (String(a), String(b)) => Some(a.as_bytes().cmp(b.as_bytes())),
        (Bool(_), Number(_) | String(_)) => Some(Ordering::Less),
        (Number(_), Bool(_)) => Some(Ordering::Greater),
        (Number(_), String(_)) => Some(Ordering::Less),
        (String(_), Bool(_) | Number(_)) => Some(Ordering::Greater),
        _ => None,
    }
}

fn filter_expected(filter: &Filter) -> Result<&Value, FallbackReason> {
    match (&filter.argument, &filter.literal) {
        (Some(value), None) | (None, Some(value))
            if canonical_scalar(value) || value.is_array() =>
        {
            Ok(value)
        }
        _ => Err(FallbackReason::PredicateUnanalyzable),
    }
}

fn filter_matches(row: &Row, filter: &Filter) -> Result<bool, FallbackReason> {
    let actual = row.get(&filter.field).unwrap_or(&Value::Null);
    if !canonical_scalar(actual) {
        return Err(FallbackReason::PredicateUnanalyzable);
    }
    let expected = filter_expected(filter)?;
    if actual.is_null() {
        return Ok(false);
    }
    match filter.op {
        FilterOp::Eq => Ok(!expected.is_null() && actual == expected),
        FilterOp::In => {
            let values = expected
                .as_array()
                .ok_or(FallbackReason::PredicateUnanalyzable)?;
            if values.is_empty() || values.iter().any(|value| !canonical_scalar(value)) {
                return Err(FallbackReason::PredicateUnanalyzable);
            }
            Ok(values
                .iter()
                .any(|value| !value.is_null() && value == actual))
        }
        FilterOp::Lt | FilterOp::Lte | FilterOp::Gt | FilterOp::Gte => {
            if expected.is_null() || !canonical_scalar(expected) {
                return Ok(false);
            }
            let Some(ordering) = scalar_cmp(actual, expected) else {
                return Ok(false);
            };
            Ok(match filter.op {
                FilterOp::Lt => ordering == Ordering::Less,
                FilterOp::Lte => ordering != Ordering::Greater,
                FilterOp::Gt => ordering == Ordering::Greater,
                FilterOp::Gte => ordering != Ordering::Less,
                _ => unreachable!(),
            })
        }
    }
}

fn resource_scope(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn membership_bit(
    arm: &str,
    resource_field: &str,
    roles: Option<&[String]>,
    edge: &str,
    row_key: &str,
    row: &Row,
    pre: Option<&Row>,
    support_bits: &BTreeMap<String, BTreeMap<String, MembershipEvidence>>,
    reads: &ReadTranscript,
) -> Result<bool, FallbackReason> {
    let resource = row.get(resource_field).unwrap_or(&Value::Null);
    if resource_scope(resource).is_none() {
        return Ok(false);
    }
    let rekeyed =
        pre.is_some_and(|pre| pre.get(resource_field).unwrap_or(&Value::Null) != resource);
    if let Some(evidence) = support_bits.get(arm).and_then(|bits| bits.get(row_key)) {
        return Ok(match evidence {
            MembershipEvidence::Bit(bit) => *bit,
            MembershipEvidence::Fact { role, pending } => {
                !pending
                    && role.as_ref().is_some_and(|role| {
                        roles.is_none_or(|allowed| allowed.iter().any(|value| value == role))
                    })
            }
        });
    }
    if rekeyed {
        let request = ReadRequest::Probe {
            edge: edge.to_owned(),
            scope: resource_scope(resource).unwrap_or_else(|| row_key.to_owned()),
            element: None,
        };
        return match reads.response(&request) {
            Some(ReadResponse::Probe { rows }) => Ok(!rows.is_empty()),
            _ => Err(FallbackReason::SupportUnproved),
        };
    }
    Err(FallbackReason::SupportUnproved)
}

fn visibility_matches(
    visibility: &Visibility,
    row_key: &str,
    row: &Row,
    pre: Option<&Row>,
    support_bits: &BTreeMap<String, BTreeMap<String, MembershipEvidence>>,
    reads: &ReadTranscript,
    probe_relation: bool,
) -> Result<bool, FallbackReason> {
    if probe_relation {
        return Ok(true);
    }
    match visibility {
        Visibility::PublicRead => Ok(true),
        Visibility::Owner { field, user_id } => Ok(row
            .get(field)
            .and_then(Value::as_str)
            .is_some_and(|owner| owner == user_id)),
        Visibility::Membership {
            arm,
            resource_field,
            roles,
            edge,
        } => membership_bit(
            arm,
            resource_field,
            roles.as_deref(),
            edge,
            row_key,
            row,
            pre,
            support_bits,
            reads,
        ),
        Visibility::AnyOf { arms } => {
            let mut unresolved = None;
            for arm in arms {
                match visibility_matches(
                    arm,
                    row_key,
                    row,
                    pre,
                    support_bits,
                    reads,
                    probe_relation,
                ) {
                    Ok(true) => return Ok(true),
                    Ok(false) => {}
                    Err(reason) => unresolved = Some(reason),
                }
            }
            unresolved.map_or(Ok(false), Err)
        }
    }
}

// @ref LLP 0309.000#e0--admitvisibility-filters-the-δappδz-adapter —
// E0 owns net-batch admission classification and membership re-key proofs.
pub fn evaluate_admit(
    config: &AdmitConfig,
    mut state: AdmitState,
    input: AdmitInput,
    reads: &ReadTranscript,
) -> FormVerdict<DeltaZBatch, AdmitState> {
    let mut entries = Vec::new();
    for change in fold_app_batch(&input.changes) {
        let retained_pre = state.retained.get(&change.row_key).cloned();
        let pre = change.pre_image.as_ref().or(retained_pre.as_ref());
        let was_admitted = state.retained.contains_key(&change.row_key);
        if change.op != ChangeOp::Delete && change.post_image.is_none() {
            return FormVerdict::fallback(FallbackReason::MissingImage);
        }
        let is_admitted = match change.post_image.as_ref() {
            None => false,
            Some(row) => {
                let visible = match visibility_matches(
                    &config.visibility,
                    &change.row_key,
                    row,
                    pre,
                    &input.support_bits,
                    reads,
                    config.probe_relation,
                ) {
                    Ok(value) => value,
                    Err(reason) => return FormVerdict::fallback(reason),
                };
                if !visible {
                    false
                } else {
                    let mut admitted = true;
                    for filter in &config.filters {
                        match filter_matches(row, filter) {
                            Ok(value) => admitted &= value,
                            Err(reason) => return FormVerdict::fallback(reason),
                        }
                    }
                    admitted
                }
            }
        };
        let admit = match (was_admitted, is_admitted) {
            (false, true) => Admission::Enter,
            (true, false) => Admission::Leave,
            (true, true) => Admission::StayIn,
            (false, false) => Admission::StayOut,
        };
        let rank_keys = change
            .post_image
            .as_ref()
            .map(|row| {
                config
                    .rank_order
                    .iter()
                    .map(|order| row.get(&order.field).cloned().unwrap_or(Value::Null))
                    .collect()
            })
            .unwrap_or_default();
        entries.push(DeltaZEntry {
            row_key: change.row_key.clone(),
            op: change.op,
            post_image: change.post_image.clone(),
            admit,
            rank_keys,
        });

        match config.grain {
            AdmissionGrain::CompleteScope => {
                if is_admitted {
                    state.retained.insert(
                        change.row_key,
                        change.post_image.expect("admitted post image"),
                    );
                } else {
                    state.retained.remove(&change.row_key);
                }
            }
            AdmissionGrain::Window => match admit {
                Admission::Leave | Admission::StayOut => {
                    state.retained.remove(&change.row_key);
                }
                Admission::StayIn => {
                    state.retained.insert(
                        change.row_key,
                        change.post_image.expect("stay-in post image"),
                    );
                }
                Admission::Enter => {}
            },
        }
    }
    FormVerdict::Maintain {
        delta_out: DeltaZBatch { entries },
        next_state: state,
    }
}

fn rank_for(config: &WindowConfig, row_key: &str, row: &Row) -> Result<RankKey, FallbackReason> {
    let mut values = Vec::with_capacity(config.order.len());
    for order in &config.order {
        let value = row.get(&order.field).cloned().unwrap_or(Value::Null);
        if !canonical_scalar(&value) {
            return Err(FallbackReason::RankUndecidable);
        }
        values.push(value);
    }
    Ok(RankKey {
        values,
        row_key: row_key.to_owned(),
    })
}

fn cmp_rank(config: &WindowConfig, left: &RankKey, right: &RankKey) -> Ordering {
    for (index, field) in config.order.iter().enumerate() {
        let left_value = left.values.get(index).unwrap_or(&Value::Null);
        let right_value = right.values.get(index).unwrap_or(&Value::Null);
        let mut ordering = scalar_cmp(left_value, right_value).unwrap_or(Ordering::Equal);
        if !left_value.is_null() && !right_value.is_null() && field.direction == Direction::Desc {
            ordering = ordering.reverse();
        }
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    left.row_key.cmp(&right.row_key)
}

fn in_interval(config: &WindowConfig, key: &RankKey) -> bool {
    if let Some(lower) = &config.interval.lower {
        let ordering = cmp_rank(config, key, &lower.key);
        if ordering == Ordering::Less || (ordering == Ordering::Equal && !lower.inclusive) {
            return false;
        }
    }
    if let Some(upper) = &config.interval.upper {
        let ordering = cmp_rank(config, key, &upper.key);
        if ordering == Ordering::Greater || (ordering == Ordering::Equal && !upper.inclusive) {
            return false;
        }
    }
    true
}

fn sorted_rows(config: &WindowConfig, map: &BTreeMap<String, RankedRow>) -> Vec<RankedRow> {
    let mut rows = map.values().cloned().collect::<Vec<_>>();
    rows.sort_by(|left, right| cmp_rank(config, &left.rank_keys, &right.rank_keys));
    rows
}

fn project_diff(old: &Row, new: &Row, fields: &BTreeSet<String>) -> Row {
    fields
        .iter()
        .filter(|field| old.get(*field) != new.get(*field))
        .map(|field| {
            (
                field.clone(),
                new.get(field).cloned().unwrap_or(Value::Null),
            )
        })
        .collect()
}

fn window_diff(config: &WindowConfig, old: &[RankedRow], new: &[RankedRow]) -> DeltaSeq {
    let old_by_key = old
        .iter()
        .map(|row| (row.row_key.clone(), row))
        .collect::<BTreeMap<_, _>>();
    let new_by_key = new
        .iter()
        .map(|row| (row.row_key.clone(), row))
        .collect::<BTreeMap<_, _>>();
    let mut ops = Vec::new();
    for row in old {
        match new_by_key.get(&row.row_key) {
            None => ops.push(SeqOp::SpliceOut {
                sort_key: row.rank_keys.clone(),
                row_key: row.row_key.clone(),
            }),
            Some(next) if next.rank_keys != row.rank_keys => ops.push(SeqOp::SpliceOut {
                sort_key: row.rank_keys.clone(),
                row_key: row.row_key.clone(),
            }),
            _ => {}
        }
    }
    for row in new {
        match old_by_key.get(&row.row_key) {
            None => ops.push(SeqOp::SpliceIn {
                sort_key: row.rank_keys.clone(),
                row: row.row.clone(),
            }),
            Some(previous) if previous.rank_keys != row.rank_keys => ops.push(SeqOp::SpliceIn {
                sort_key: row.rank_keys.clone(),
                row: row.row.clone(),
            }),
            Some(previous) if previous.row != row.row => {
                let post = project_diff(&previous.row, &row.row, &config.projection_fields);
                if !post.is_empty() {
                    ops.push(SeqOp::Patch {
                        sort_key: row.rank_keys.clone(),
                        row_key: row.row_key.clone(),
                        post,
                    });
                }
            }
            _ => {}
        }
    }
    DeltaSeq { ops }
}

fn tail_rows(config: &WindowConfig, rows: &[Row]) -> Result<Vec<RankedRow>, FallbackReason> {
    rows.iter()
        .map(|row| {
            let key = row_key(row).ok_or(FallbackReason::RankUndecidable)?;
            let rank_keys = rank_for(config, &key, row)?;
            Ok(RankedRow {
                row_key: key,
                rank_keys,
                row: row.clone(),
            })
        })
        .collect()
}

// @ref LLP 0309.000#e3--windoworder-interval-take-ordered-window — the
// keyed working map, one tail competition, and (a)-wins completeness are atomic.
pub fn evaluate_window(
    config: &WindowConfig,
    state: WindowState,
    input: DeltaZBatch,
    reads: &ReadTranscript,
) -> FormVerdict<DeltaSeq, WindowState> {
    if config.take == 0 {
        return FormVerdict::Maintain {
            delta_out: DeltaSeq::default(),
            next_state: WindowState {
                rows: Vec::new(),
                boundary: None,
                result_count: 0,
                complete: false,
                label: CompletenessLabel::ZeroTakeUnproved,
                continuation: None,
            },
        };
    }

    let retained_keys = state
        .rows
        .iter()
        .map(|row| row.row_key.clone())
        .collect::<BTreeSet<_>>();
    let mut working = state
        .rows
        .iter()
        .cloned()
        .map(|row| (row.row_key.clone(), row))
        .collect::<BTreeMap<_, _>>();
    let mut entered_admitted = BTreeSet::new();
    for entry in &input.entries {
        if let Some(row) = entry.post_image.as_ref()
            && let Err(reason) = rank_for(config, &entry.row_key, row)
        {
            return FormVerdict::fallback(reason);
        }
        if entry.admit == Admission::Leave {
            working.remove(&entry.row_key);
        }
        if matches!(entry.admit, Admission::Enter | Admission::StayIn) {
            let Some(row) = entry.post_image.as_ref() else {
                return FormVerdict::fallback(FallbackReason::MissingImage);
            };
            let rank_keys = match rank_for(config, &entry.row_key, row) {
                Ok(key) => key,
                Err(reason) => return FormVerdict::fallback(reason),
            };
            if in_interval(config, &rank_keys) {
                working.insert(
                    entry.row_key.clone(),
                    RankedRow {
                        row_key: entry.row_key.clone(),
                        rank_keys,
                        row: row.clone(),
                    },
                );
                entered_admitted.insert(entry.row_key.clone());
            } else {
                working.remove(&entry.row_key);
            }
        }
    }

    let b_old = state.boundary.clone();
    let mut all_rows = sorted_rows(config, &working);
    let mut selected = all_rows
        .iter()
        .take(config.take)
        .cloned()
        .collect::<Vec<_>>();
    let selected_before_or_at_old = match &b_old {
        Some(boundary) => selected
            .iter()
            .filter(|row| cmp_rank(config, &row.rank_keys, boundary) != Ordering::Greater)
            .count(),
        None => 0,
    };
    let selected_beyond_old = match &b_old {
        Some(boundary) => selected
            .iter()
            .any(|row| cmp_rank(config, &row.rank_keys, boundary) == Ordering::Greater),
        None => !selected.is_empty(),
    };
    let needs_tail = !state.complete && (selected.len() < config.take || selected_beyond_old);
    let mut tail_ran = false;
    let mut tail_exhausted = false;
    if needs_tail {
        let request = ReadRequest::Tail {
            window: config.window_id.clone(),
            boundary: b_old.clone(),
            k: config.take.saturating_sub(selected_before_or_at_old),
            label_only: false,
        };
        let (rows, exhausted) = match reads.response(&request) {
            Some(ReadResponse::Tail {
                rows,
                exhausted: Some(exhausted),
            }) => (rows, *exhausted),
            _ => return FormVerdict::fallback(FallbackReason::BoundaryDisplacement),
        };
        let ranked = match tail_rows(config, rows) {
            Ok(rows) => rows,
            Err(reason) => return FormVerdict::fallback(reason),
        };
        for row in ranked {
            if in_interval(config, &row.rank_keys) {
                working.insert(row.row_key.clone(), row);
            }
        }
        all_rows = sorted_rows(config, &working);
        selected = all_rows.iter().take(config.take).cloned().collect();
        tail_ran = true;
        tail_exhausted = exhausted;
    }

    let selected_keys = selected
        .iter()
        .map(|row| row.row_key.as_str())
        .collect::<BTreeSet<_>>();
    let case_a = working
        .keys()
        .any(|key| !selected_keys.contains(key.as_str()));
    let mut complete = if case_a {
        false
    } else if tail_ran {
        tail_exhausted
    } else {
        state.complete
    };
    if !case_a && !tail_ran && !state.complete {
        let case_c = input.entries.iter().any(|entry| {
            matches!(entry.op, ChangeOp::Delete | ChangeOp::Update)
                && !retained_keys.contains(&entry.row_key)
                && !entered_admitted.contains(&entry.row_key)
        });
        if case_c {
            let request = ReadRequest::Tail {
                window: config.window_id.clone(),
                boundary: selected.last().map(|row| row.rank_keys.clone()),
                k: 1,
                label_only: true,
            };
            match reads.response(&request) {
                Some(ReadResponse::Tail {
                    rows,
                    exhausted: Some(exhausted),
                }) => {
                    complete = rows.is_empty() && *exhausted;
                }
                _ => {
                    return FormVerdict::fallback(FallbackReason::CompletenessIndeterminate);
                }
            }
        }
    }

    let boundary = selected.last().map(|row| row.rank_keys.clone());
    let delta_out = window_diff(config, &state.rows, &selected);
    let next_state = WindowState {
        result_count: selected.len(),
        rows: selected,
        boundary: boundary.clone(),
        complete,
        label: if complete {
            CompletenessLabel::Complete
        } else {
            CompletenessLabel::Incomplete
        },
        continuation: boundary,
    };
    FormVerdict::Maintain {
        delta_out,
        next_state,
    }
}

fn projected_row(row: &Row, fields: &BTreeSet<String>) -> Row {
    fields
        .iter()
        .filter_map(|field| row.get(field).cloned().map(|value| (field.clone(), value)))
        .collect()
}

fn fill_lookup(
    config: &LookupConfig,
    key: &[Value],
    reads: &ReadTranscript,
    missing_reason: FallbackReason,
) -> Result<Option<Row>, FallbackReason> {
    let request = ReadRequest::Point {
        index: config.index.clone(),
        key: key.to_vec(),
    };
    match reads.response(&request) {
        Some(ReadResponse::Point { row }) => Ok(row.clone()),
        _ => Err(missing_reason),
    }
}

fn lookup_fill_diff(
    config: &LookupConfig,
    scope: &str,
    old: Option<&Row>,
    new: Option<&Row>,
) -> Vec<LookupDeltaOp> {
    match (old, new) {
        (None, None) => Vec::new(),
        (None, Some(row)) => vec![LookupDeltaOp::Presence {
            scope: scope.to_owned(),
            child_key: row_key(row),
            value: Some(projected_row(row, &config.projection_fields)),
        }],
        (Some(_), None) => vec![LookupDeltaOp::Presence {
            scope: scope.to_owned(),
            child_key: None,
            value: None,
        }],
        (Some(old), Some(new)) if row_key(old) == row_key(new) => {
            let fields = project_diff(old, new, &config.projection_fields);
            if fields.is_empty() {
                Vec::new()
            } else {
                vec![LookupDeltaOp::Patch {
                    scope: scope.to_owned(),
                    child_key: row_key(new).unwrap_or_default(),
                    fields,
                }]
            }
        }
        (Some(_), Some(new)) => vec![LookupDeltaOp::Presence {
            scope: scope.to_owned(),
            child_key: row_key(new),
            value: Some(projected_row(new, &config.projection_fields)),
        }],
    }
}

fn set_lookup_scope(
    state: &mut LookupState,
    scope: &str,
    key: Option<Vec<Value>>,
    row: Option<Row>,
) {
    let child_key = row.as_ref().and_then(row_key);
    if let (Some(child_key), Some(row)) = (&child_key, row) {
        state.children.insert(child_key.clone(), row);
    }
    state.scopes.insert(
        scope.to_owned(),
        LookupScopeState {
            lookup_key: key,
            child_key: child_key.clone(),
            found: child_key.is_some(),
            row_version: None,
        },
    );
}

fn retained_scope_row<'a>(state: &'a LookupState, scope: &str) -> Option<&'a Row> {
    state
        .scopes
        .get(scope)
        .and_then(|scope| scope.child_key.as_ref())
        .and_then(|key| state.children.get(key))
}

fn lookup_required_transition(presence: Presence, old_found: bool, new_found: bool) -> bool {
    presence == Presence::Required && old_found != new_found
}

// @ref LLP 0309.000#e4--keyedlookupindex-joinon-unique-point-join — parent
// fills run first and child changes skip born, re-keyed, and killed scopes.
pub fn evaluate_lookup(
    config: &LookupConfig,
    state: LookupState,
    input: LookupInput,
    reads: &ReadTranscript,
) -> FormVerdict<LookupDelta, LookupState> {
    let mut next = state.clone();
    let mut ops = Vec::new();
    let mut skipped = BTreeSet::new();

    for parent in &input.parent.entries {
        let scope = parent.row_key.as_str();
        let old_scope = state.scopes.get(scope);
        let old_row = retained_scope_row(&state, scope);
        match parent.admit {
            Admission::Enter => {
                let Some(row) = parent.post_image.as_ref() else {
                    return FormVerdict::fallback(FallbackReason::MissingImage);
                };
                let key = match lookup_key(row, &config.parent_join_fields) {
                    Ok(key) => key,
                    Err(reason) => return FormVerdict::fallback(reason),
                };
                let fill = match key.as_ref() {
                    Some(key) => {
                        match fill_lookup(config, key, reads, FallbackReason::ScopeUnfilled) {
                            Ok(row) => row,
                            Err(reason) => return FormVerdict::fallback(reason),
                        }
                    }
                    None => None,
                };
                if config.presence == Presence::Required && fill.is_none() {
                    return FormVerdict::fallback(FallbackReason::RefusalTransition);
                }
                ops.extend(lookup_fill_diff(config, scope, None, fill.as_ref()));
                set_lookup_scope(&mut next, scope, key, fill);
                skipped.insert(scope.to_owned());
            }
            Admission::Leave => {
                next.scopes.remove(scope);
                skipped.insert(scope.to_owned());
            }
            Admission::StayIn => {
                let Some(row) = parent.post_image.as_ref() else {
                    return FormVerdict::fallback(FallbackReason::MissingImage);
                };
                let key = match lookup_key(row, &config.parent_join_fields) {
                    Ok(key) => key,
                    Err(reason) => return FormVerdict::fallback(reason),
                };
                let old_key = old_scope.and_then(|scope| scope.lookup_key.clone());
                if key != old_key {
                    let fill = match key.as_ref() {
                        Some(key) => {
                            match fill_lookup(config, key, reads, FallbackReason::RekeyUnread) {
                                Ok(row) => row,
                                Err(reason) => return FormVerdict::fallback(reason),
                            }
                        }
                        None => None,
                    };
                    if lookup_required_transition(
                        config.presence,
                        old_row.is_some(),
                        fill.is_some(),
                    ) {
                        return FormVerdict::fallback(FallbackReason::RefusalTransition);
                    }
                    ops.extend(lookup_fill_diff(config, scope, old_row, fill.as_ref()));
                    set_lookup_scope(&mut next, scope, key, fill);
                    skipped.insert(scope.to_owned());
                }
            }
            Admission::StayOut => {}
        }
    }

    for child in &input.child.entries {
        let previous = state.children.get(&child.row_key);
        let old_join = previous.and_then(|row| field_values(row, &config.child_join_fields));
        let new_join = child
            .post_image
            .as_ref()
            .and_then(|row| field_values(row, &config.child_join_fields));
        let join_changed = previous.is_some() && old_join != new_join;
        if join_changed || child.admit == Admission::Leave {
            let affected = next
                .scopes
                .iter()
                .filter(|(scope, value)| {
                    !skipped.contains(*scope)
                        && value.child_key.as_deref() == Some(child.row_key.as_str())
                })
                .map(|(scope, _)| scope.clone())
                .collect::<Vec<_>>();
            for scope in affected {
                if config.presence == Presence::Required {
                    return FormVerdict::fallback(FallbackReason::RefusalTransition);
                }
                ops.push(LookupDeltaOp::Presence {
                    scope: scope.clone(),
                    child_key: None,
                    value: None,
                });
                if let Some(scope_state) = next.scopes.get_mut(&scope) {
                    scope_state.child_key = None;
                    scope_state.found = false;
                }
            }
            next.children.remove(&child.row_key);
        }

        if matches!(child.admit, Admission::Enter | Admission::StayIn) {
            let Some(row) = child.post_image.as_ref() else {
                return FormVerdict::fallback(FallbackReason::MissingImage);
            };
            let Some(join) = new_join else {
                return FormVerdict::fallback(FallbackReason::PredicateUnanalyzable);
            };
            let scopes = next
                .scopes
                .iter()
                .filter(|(scope, value)| {
                    !skipped.contains(*scope) && value.lookup_key.as_ref() == Some(&join)
                })
                .map(|(scope, value)| (scope.clone(), value.clone()))
                .collect::<Vec<_>>();
            for (scope, scope_state) in scopes {
                if scope_state.found && scope_state.child_key.as_deref() != Some(&child.row_key) {
                    return FormVerdict::fallback(FallbackReason::UniqueViolation);
                }
                if scope_state.found {
                    let old = next
                        .children
                        .get(&child.row_key)
                        .cloned()
                        .unwrap_or_default();
                    let fields = project_diff(&old, row, &config.projection_fields);
                    if !fields.is_empty() {
                        ops.push(LookupDeltaOp::Patch {
                            scope: scope.clone(),
                            child_key: child.row_key.clone(),
                            fields,
                        });
                    }
                } else {
                    if config.presence == Presence::Required {
                        return FormVerdict::fallback(FallbackReason::RefusalTransition);
                    }
                    ops.push(LookupDeltaOp::Presence {
                        scope: scope.clone(),
                        child_key: Some(child.row_key.clone()),
                        value: Some(projected_row(row, &config.projection_fields)),
                    });
                    if let Some(scope_state) = next.scopes.get_mut(&scope) {
                        scope_state.found = true;
                        scope_state.child_key = Some(child.row_key.clone());
                    }
                }
            }
            next.children.insert(child.row_key.clone(), row.clone());
        }
    }

    let live_children = next
        .scopes
        .values()
        .filter_map(|scope| scope.child_key.clone())
        .collect::<BTreeSet<_>>();
    next.children.retain(|key, _| live_children.contains(key));
    FormVerdict::Maintain {
        delta_out: LookupDelta { ops },
        next_state: next,
    }
}

fn fill_window(
    config: &WindowConfig,
    rows: &[Row],
    exhausted: bool,
) -> Result<WindowState, FallbackReason> {
    let mut map = BTreeMap::new();
    for row in tail_rows(config, rows)? {
        if in_interval(config, &row.rank_keys) {
            map.insert(row.row_key.clone(), row);
        }
    }
    let all = sorted_rows(config, &map);
    let selected = all.iter().take(config.take).cloned().collect::<Vec<_>>();
    let complete = exhausted && all.len() <= config.take;
    let boundary = selected.last().map(|row| row.rank_keys.clone());
    Ok(WindowState {
        result_count: selected.len(),
        rows: selected,
        boundary: boundary.clone(),
        complete,
        label: if complete {
            CompletenessLabel::Complete
        } else {
            CompletenessLabel::Incomplete
        },
        continuation: boundary,
    })
}

// @ref LLP 0309.000#e5--perparentwindow-bounded-to-many — literal scope
// birth/re-key emits the prior-to-fill splice diff; demand identity wins first.
pub fn evaluate_per_parent_window(
    config: &PerParentWindowConfig,
    state: PerParentWindowState,
    input: PerParentWindowInput,
    reads: &ReadTranscript,
) -> FormVerdict<ScopedDeltaSeq, PerParentWindowState> {
    let mut next = state.clone();
    let mut ops = Vec::new();
    let mut skipped = BTreeSet::new();
    for parent in &input.parent.entries {
        let scope = parent.row_key.as_str();
        let old_scope = state.scopes.get(scope);
        let new_key = parent
            .post_image
            .as_ref()
            .map(|row| lookup_key(row, &config.parent_join_fields))
            .transpose();
        let new_key = match new_key {
            Ok(Some(key)) => key,
            Ok(None) => None,
            Err(reason) => return FormVerdict::fallback(reason),
        };
        let rekey = parent.admit == Admission::StayIn
            && old_scope.and_then(|scope| scope.lookup_key.clone()) != new_key;
        let identity_transition =
            matches!(parent.admit, Admission::Enter | Admission::Leave) || rekey;
        if config.demand_paged && identity_transition {
            return FormVerdict::fallback(FallbackReason::DemandIdentityTransition);
        }
        match parent.admit {
            Admission::Enter => {
                if parent.post_image.is_none() {
                    return FormVerdict::fallback(FallbackReason::MissingImage);
                }
                let key = new_key;
                let fill = if config.window.take == 0 {
                    WindowState {
                        rows: Vec::new(),
                        boundary: None,
                        result_count: 0,
                        complete: false,
                        label: CompletenessLabel::ZeroTakeUnproved,
                        continuation: None,
                    }
                } else if key.is_none() {
                    WindowState::empty(true)
                } else {
                    let request = ReadRequest::Range {
                        index: config.index.clone(),
                        key_prefix: key.clone().expect("non-null key reads"),
                        bound: config.max_children_per_parent,
                    };
                    let (rows, exhausted) = match reads.response(&request) {
                        Some(ReadResponse::Range { rows, exhausted }) => (rows, *exhausted),
                        _ => return FormVerdict::fallback(FallbackReason::ScopeUnfilled),
                    };
                    match fill_window(&config.window, rows, exhausted) {
                        Ok(window) => window,
                        Err(reason) => return FormVerdict::fallback(reason),
                    }
                };
                for op in window_diff(&config.window, &[], &fill.rows).ops {
                    ops.push(ScopedSeqOp {
                        scope: scope.to_owned(),
                        op,
                    });
                }
                next.scopes.insert(
                    scope.to_owned(),
                    PerParentScopeState {
                        lookup_key: key,
                        window: fill,
                    },
                );
                skipped.insert(scope.to_owned());
            }
            Admission::Leave => {
                next.scopes.remove(scope);
                skipped.insert(scope.to_owned());
            }
            Admission::StayIn if rekey => {
                if parent.post_image.is_none() {
                    return FormVerdict::fallback(FallbackReason::MissingImage);
                }
                let key = new_key;
                let old_window = old_scope
                    .map(|scope| scope.window.clone())
                    .unwrap_or_else(|| WindowState::empty(true));
                let fill = if config.window.take == 0 {
                    WindowState {
                        rows: Vec::new(),
                        boundary: None,
                        result_count: 0,
                        complete: false,
                        label: CompletenessLabel::ZeroTakeUnproved,
                        continuation: None,
                    }
                } else if key.is_none() {
                    WindowState::empty(true)
                } else {
                    let request = ReadRequest::Range {
                        index: config.index.clone(),
                        key_prefix: key.clone().expect("non-null key reads"),
                        bound: config.max_children_per_parent,
                    };
                    let (rows, exhausted) = match reads.response(&request) {
                        Some(ReadResponse::Range { rows, exhausted }) => (rows, *exhausted),
                        _ => return FormVerdict::fallback(FallbackReason::RekeyUnread),
                    };
                    match fill_window(&config.window, rows, exhausted) {
                        Ok(window) => window,
                        Err(reason) => return FormVerdict::fallback(reason),
                    }
                };
                for op in window_diff(&config.window, &old_window.rows, &fill.rows).ops {
                    ops.push(ScopedSeqOp {
                        scope: scope.to_owned(),
                        op,
                    });
                }
                next.scopes.insert(
                    scope.to_owned(),
                    PerParentScopeState {
                        lookup_key: key,
                        window: fill,
                    },
                );
                skipped.insert(scope.to_owned());
            }
            _ => {}
        }
    }

    for (scope, batch) in &input.child_by_scope {
        if skipped.contains(scope) {
            continue;
        }
        let Some(scope_state) = next.scopes.get(scope).cloned() else {
            continue;
        };
        let mut scoped_config = config.window.clone();
        scoped_config.window_id = format!("{}:{scope}", config.window.window_id);
        match evaluate_window(&scoped_config, scope_state.window, batch.clone(), reads) {
            FormVerdict::Maintain {
                delta_out,
                next_state,
            } => {
                for op in delta_out.ops {
                    ops.push(ScopedSeqOp {
                        scope: scope.clone(),
                        op,
                    });
                }
                if let Some(scope_state) = next.scopes.get_mut(scope) {
                    scope_state.window = next_state;
                }
            }
            FormVerdict::Fallback { reason } => return FormVerdict::fallback(reason),
        }
    }
    FormVerdict::Maintain {
        delta_out: ScopedDeltaSeq { ops },
        next_state: next,
    }
}

fn probe_bit(
    config: &SupportConfig,
    scope: &str,
    element: Option<&str>,
    reads: &ReadTranscript,
) -> Result<bool, FallbackReason> {
    let request = ReadRequest::Probe {
        edge: config.edge.clone(),
        scope: scope.to_owned(),
        element: element.map(str::to_owned),
    };
    match reads.response(&request) {
        Some(ReadResponse::Probe { rows }) => Ok(!rows.is_empty()),
        _ => Err(FallbackReason::SupportUnproved),
    }
}

fn establish_support(
    config: &SupportConfig,
    scope: &str,
    reads: &ReadTranscript,
) -> Result<bool, FallbackReason> {
    match &config.mode {
        SupportMode::Exists => probe_bit(config, scope, None, reads),
        SupportMode::All { elements } => {
            let mut result = true;
            for element in elements {
                result &= probe_bit(config, scope, Some(element), reads)?;
            }
            Ok(result)
        }
    }
}

fn support_join_key(
    config: &SupportConfig,
    entry: &DeltaZEntry,
) -> Result<Vec<Value>, FallbackReason> {
    if let Some(row) = entry.post_image.as_ref() {
        return field_values(row, &config.support_join_fields)
            .ok_or(FallbackReason::ScopeUnresolved);
    }
    if entry.rank_keys.len() >= config.support_join_fields.len() {
        return Ok(entry.rank_keys[..config.support_join_fields.len()].to_vec());
    }
    Err(FallbackReason::ScopeUnresolved)
}

fn transition(old: bool, new: bool) -> BitTransitionKind {
    match (old, new) {
        (false, true) => BitTransitionKind::ZeroToOne,
        (true, false) => BitTransitionKind::OneToZero,
        _ => BitTransitionKind::Unchanged,
    }
}

// @ref LLP 0309.000#e6--supportsemijoin-exists--membership-support — folded
// per-scope support, parent-first establishment, and narrowed proofs are exact.
pub fn evaluate_support(
    config: &SupportConfig,
    state: SupportState,
    input: SupportInput,
    reads: &ReadTranscript,
) -> FormVerdict<DeltaBit, SupportState> {
    let mut next = state.clone();
    let mut skipped = BTreeSet::new();
    let mut transitions = Vec::new();
    for parent in &input.parent.entries {
        let scope = parent.row_key.as_str();
        match parent.admit {
            Admission::Enter => {
                let Some(row) = parent.post_image.as_ref() else {
                    return FormVerdict::fallback(FallbackReason::MissingImage);
                };
                let join_key = match field_values(row, &config.parent_join_fields) {
                    Some(key) => key,
                    None => return FormVerdict::fallback(FallbackReason::ScopeUnresolved),
                };
                let bit = match establish_support(config, scope, reads) {
                    Ok(bit) => bit,
                    Err(reason) => return FormVerdict::fallback(reason),
                };
                next.scopes
                    .insert(scope.to_owned(), SupportScopeState { join_key, bit });
                transitions.push(BitTransition {
                    scope: scope.to_owned(),
                    element: None,
                    transition: transition(false, bit),
                });
                skipped.insert(scope.to_owned());
            }
            Admission::Leave => {
                next.scopes.remove(scope);
                skipped.insert(scope.to_owned());
            }
            Admission::StayIn => {
                let Some(row) = parent.post_image.as_ref() else {
                    return FormVerdict::fallback(FallbackReason::MissingImage);
                };
                let join_key = match field_values(row, &config.parent_join_fields) {
                    Some(key) => key,
                    None => return FormVerdict::fallback(FallbackReason::ScopeUnresolved),
                };
                if state.scopes.get(scope).map(|scope| &scope.join_key) != Some(&join_key) {
                    let old = state.scopes.get(scope).is_some_and(|scope| scope.bit);
                    let bit = match establish_support(config, scope, reads) {
                        Ok(bit) => bit,
                        Err(reason) => return FormVerdict::fallback(reason),
                    };
                    if old != bit {
                        transitions.push(BitTransition {
                            scope: scope.to_owned(),
                            element: None,
                            transition: transition(old, bit),
                        });
                    }
                    next.scopes
                        .insert(scope.to_owned(), SupportScopeState { join_key, bit });
                    skipped.insert(scope.to_owned());
                }
            }
            Admission::StayOut => {}
        }
    }

    let changes = input
        .support
        .entries
        .iter()
        .chain(input.target.entries.iter())
        .collect::<Vec<_>>();
    let mut by_scope = BTreeMap::<String, Vec<&DeltaZEntry>>::new();
    for entry in changes {
        let join_key = match support_join_key(config, entry) {
            Ok(key) => key,
            Err(reason) => return FormVerdict::fallback(reason),
        };
        for (scope, scope_state) in &next.scopes {
            if !skipped.contains(scope) && scope_state.join_key == join_key {
                by_scope.entry(scope.clone()).or_default().push(entry);
            }
        }
    }
    for (scope, changes) in by_scope {
        let old = next.scopes.get(&scope).is_some_and(|scope| scope.bit);
        let new = match &config.mode {
            SupportMode::All { .. } => match establish_support(config, &scope, reads) {
                Ok(bit) => bit,
                Err(reason) => return FormVerdict::fallback(reason),
            },
            SupportMode::Exists => {
                let has_enter = changes.iter().any(|entry| entry.admit == Admission::Enter);
                let has_leave = changes.iter().any(|entry| entry.admit == Admission::Leave);
                if config.edge_kind == SupportEdgeKind::Direct && has_enter {
                    true
                } else if has_leave || has_enter || config.edge_kind == SupportEdgeKind::Through {
                    match probe_bit(config, &scope, None, reads) {
                        Ok(bit) => bit,
                        Err(reason) => return FormVerdict::fallback(reason),
                    }
                } else {
                    old
                }
            }
        };
        if let Some(scope_state) = next.scopes.get_mut(&scope) {
            scope_state.bit = new;
        }
        if old != new {
            transitions.push(BitTransition {
                scope,
                element: None,
                transition: transition(old, new),
            });
        }
    }
    transitions.sort_by(|left, right| left.scope.cmp(&right.scope));
    FormVerdict::Maintain {
        delta_out: DeltaBit { transitions },
        next_state: next,
    }
}

// @ref LLP 0309.000#e6--supportsemijoin-exists--membership-support — support-bit
// admission changes read unretained carriers only through the declared index.
pub fn evaluate_membership_lift(
    config: &MembershipLiftConfig,
    state: MembershipLiftState,
    input: MembershipLiftInput,
    reads: &ReadTranscript,
) -> FormVerdict<DeltaZBatch, MembershipLiftState> {
    if config.windowed_unprojected {
        return FormVerdict::fallback(FallbackReason::SupportUnproved);
    }
    let mut next = state.clone();
    let mut entries = Vec::new();
    for bit in &input.bits.transitions {
        let Some(value) = input.support_values.get(&bit.scope) else {
            return FormVerdict::fallback(FallbackReason::ScopeUnresolved);
        };
        match bit.transition {
            BitTransitionKind::ZeroToOne => {
                let request = ReadRequest::Range {
                    index: config.index.clone(),
                    key_prefix: vec![value.clone()],
                    bound: config.bound,
                };
                let rows = match reads.response(&request) {
                    Some(ReadResponse::Range {
                        rows,
                        exhausted: true,
                    }) => rows,
                    _ => return FormVerdict::fallback(FallbackReason::ScopeUnresolved),
                };
                for row in rows {
                    let Some(key) = row_key(row) else {
                        return FormVerdict::fallback(FallbackReason::ScopeUnresolved);
                    };
                    let admit = if next.retained.contains_key(&key) {
                        Admission::StayIn
                    } else {
                        Admission::Enter
                    };
                    entries.push(DeltaZEntry {
                        row_key: key.clone(),
                        op: ChangeOp::Update,
                        post_image: Some(row.clone()),
                        admit,
                        rank_keys: Vec::new(),
                    });
                    next.retained.insert(key, row.clone());
                }
            }
            BitTransitionKind::OneToZero => {
                let affected = next
                    .retained
                    .iter()
                    .filter(|(_, row)| row.get(&config.support_field) == Some(value))
                    .map(|(key, row)| (key.clone(), row.clone()))
                    .collect::<Vec<_>>();
                for (key, row) in affected {
                    if next.surviving_any_of.contains(&key) {
                        continue;
                    }
                    entries.push(DeltaZEntry {
                        row_key: key.clone(),
                        op: ChangeOp::Update,
                        post_image: Some(row),
                        admit: Admission::Leave,
                        rank_keys: Vec::new(),
                    });
                    next.retained.remove(&key);
                }
            }
            BitTransitionKind::Unchanged => {}
        }
    }
    FormVerdict::Maintain {
        delta_out: DeltaZBatch { entries },
        next_state: next,
    }
}

// @ref LLP 0309.000#e7--principalbind — binding and target are composed E4s;
// the digest ledger is never treated as a binding value.
pub fn evaluate_principal(
    config: &PrincipalConfig,
    state: PrincipalState,
    input: PrincipalInput,
    reads: &ReadTranscript,
) -> FormVerdict<PrincipalDelta, PrincipalState> {
    let (binding_delta, binding_state) = match &config.binding {
        Some(binding) => {
            match evaluate_lookup(binding, state.binding.clone(), input.binding, reads) {
                FormVerdict::Maintain {
                    delta_out,
                    next_state,
                } => (delta_out, next_state),
                FormVerdict::Fallback { reason } => return FormVerdict::fallback(reason),
            }
        }
        None => (LookupDelta::default(), state.binding.clone()),
    };
    let (target_delta, target_state) =
        match evaluate_lookup(&config.target, state.target.clone(), input.target, reads) {
            FormVerdict::Maintain {
                delta_out,
                next_state,
            } => (delta_out, next_state),
            FormVerdict::Fallback { reason } => return FormVerdict::fallback(reason),
        };
    FormVerdict::Maintain {
        delta_out: PrincipalDelta {
            binding: binding_delta,
            target: target_delta,
        },
        next_state: PrincipalState {
            binding: binding_state,
            target: target_state,
            principal_digests: state.principal_digests,
        },
    }
}

fn assembly_node<'a>(config: &'a AssembleConfig, node_id: &str) -> Option<&'a AssemblyNode> {
    config.nodes.iter().find(|node| node.node_id == node_id)
}

fn ancestors(config: &AssembleConfig, node_id: &str) -> Option<Vec<String>> {
    let mut result = Vec::new();
    let mut current = assembly_node(config, node_id)?;
    while let Some(parent) = &current.parent {
        result.push(parent.clone());
        current = assembly_node(config, parent)?;
    }
    Some(result)
}

fn addressable(config: &AssembleConfig, node_id: &str) -> bool {
    let Some(mut chain) = ancestors(config, node_id) else {
        return false;
    };
    chain.retain(|node| node != &config.root_node_id);
    !chain.iter().any(|node| {
        assembly_node(config, node).is_some_and(|node| node.kind == AssemblyNodeKind::ToMany)
    })
}

fn row_value(row: Row) -> Value {
    Value::Object(Map::from_iter(row))
}

fn value_row_key(value: &Value) -> Option<String> {
    value
        .as_object()?
        .get("_id")
        .or_else(|| value.as_object()?.get("id"))?
        .as_str()
        .map(str::to_owned)
}

fn result_item<'a>(result: &'a Value, key: &str) -> Option<(usize, &'a Value)> {
    result.as_array()?.iter().enumerate().find(|(_, value)| {
        value
            .as_object()
            .and_then(|row| row.get("_id").or_else(|| row.get("id")))
            .and_then(Value::as_str)
            == Some(key)
    })
}

struct ScopeContext<'a> {
    root_position: usize,
    root_key: String,
    parent: &'a Value,
    ancestor_scopes: Vec<(String, String)>,
}

fn scope_context<'a>(
    config: &AssembleConfig,
    result: &'a Value,
    node_id: &str,
    scope: &str,
) -> Option<ScopeContext<'a>> {
    let mut chain = Vec::new();
    let mut current = assembly_node(config, node_id)?.parent.as_deref()?;
    loop {
        chain.push(current.to_owned());
        if current == config.root_node_id {
            break;
        }
        current = assembly_node(config, current)?.parent.as_deref()?;
    }
    chain.reverse();

    for (root_position, root) in result.as_array()?.iter().enumerate() {
        let root_key = value_row_key(root)?;
        let mut parent = root;
        let mut ancestor_scopes = vec![(config.root_node_id.clone(), root_key.clone())];
        for ancestor_id in chain.iter().skip(1) {
            let ancestor = assembly_node(config, ancestor_id)?;
            let field = ancestor.result_field.as_deref()?;
            parent = parent.get(field)?;
            ancestor_scopes.push((ancestor_id.clone(), value_row_key(parent)?));
        }
        if value_row_key(parent).as_deref() == Some(scope) {
            return Some(ScopeContext {
                root_position,
                root_key,
                parent,
                ancestor_scopes,
            });
        }
    }
    None
}

type AbsorptionToken = (String, String);

fn absorption_tokens(
    config: &AssembleConfig,
    state: &AssembleState,
    input: &AssembleInput,
) -> Result<(BTreeSet<AbsorptionToken>, BTreeSet<AbsorptionToken>), FallbackReason> {
    let mut births = BTreeSet::new();
    let mut deaths = BTreeSet::new();
    for event in &input.events {
        match event {
            AssemblyEvent::RootSeq { node_id, delta } => {
                for op in &delta.ops {
                    match op {
                        SeqOp::SpliceIn { row, .. } => {
                            let key = row_key(row).ok_or(FallbackReason::WireUnaddressable)?;
                            births.insert((node_id.clone(), key));
                        }
                        SeqOp::SpliceOut { row_key, .. } => {
                            deaths.insert((node_id.clone(), row_key.clone()));
                        }
                        SeqOp::Patch { .. } => {}
                    }
                }
            }
            AssemblyEvent::ToOne { node_id, delta } => {
                let node =
                    assembly_node(config, node_id).ok_or(FallbackReason::WireUnaddressable)?;
                for op in &delta.ops {
                    let LookupDeltaOp::Presence {
                        scope,
                        child_key,
                        value,
                    } = op
                    else {
                        continue;
                    };
                    if value.is_some() {
                        let key = child_key.clone().or_else(|| {
                            let context =
                                scope_context(config, &input.post_result, node_id, scope)?;
                            value_row_key(context.parent.get(node.result_field.as_deref()?)?)
                        });
                        if let Some(key) = key {
                            births.insert((node_id.clone(), key));
                        }
                    } else {
                        let key = child_key.clone().or_else(|| {
                            let context = scope_context(config, &state.result, node_id, scope)?;
                            value_row_key(context.parent.get(node.result_field.as_deref()?)?)
                        });
                        if let Some(key) = key {
                            deaths.insert((node_id.clone(), key));
                        }
                    }
                }
            }
            AssemblyEvent::ToMany { node_id, delta, .. } => {
                for op in &delta.ops {
                    match op {
                        SeqOp::SpliceIn { row, .. } => {
                            let key = row_key(row).ok_or(FallbackReason::WireUnaddressable)?;
                            births.insert((node_id.clone(), key));
                        }
                        SeqOp::SpliceOut { row_key, .. } => {
                            deaths.insert((node_id.clone(), row_key.clone()));
                        }
                        SeqOp::Patch { .. } => {}
                    }
                }
            }
            AssemblyEvent::Exists { .. } => {}
        }
    }
    Ok((births, deaths))
}

fn scope_is_absorbed(
    config: &AssembleConfig,
    state: &AssembleState,
    input: &AssembleInput,
    node_id: &str,
    scope: &str,
    births: &BTreeSet<AbsorptionToken>,
    deaths: &BTreeSet<AbsorptionToken>,
) -> bool {
    let token_present = |token: &(String, String)| births.contains(token) || deaths.contains(token);
    if assembly_node(config, node_id)
        .and_then(|node| node.parent.as_ref())
        .is_some_and(|parent| token_present(&(parent.clone(), scope.to_owned())))
    {
        return true;
    }
    scope_context(config, &input.post_result, node_id, scope)
        .or_else(|| scope_context(config, &state.result, node_id, scope))
        .is_some_and(|context| context.ancestor_scopes.iter().any(token_present))
}

fn child_item<'a>(parent: &'a Value, field: &str, child_key: &str) -> Option<(usize, &'a Value)> {
    parent
        .get(field)?
        .as_array()?
        .iter()
        .enumerate()
        .find(|(_, value)| {
            value
                .as_object()
                .and_then(|row| row.get("_id").or_else(|| row.get("id")))
                .and_then(Value::as_str)
                == Some(child_key)
        })
}

fn result_digest(value: &Value) -> String {
    let bytes = serde_json::to_vec(value).expect("JSON value serializes");
    format!("sha256:{:x}", Sha256::digest(bytes))
}

// @ref LLP 0309.000#e8--assemble-closed-projection — lowering is projection
// scoped, addressability checked, digest-exact, and ancestor births absorb fills.
pub fn evaluate_assemble(
    config: &AssembleConfig,
    state: AssembleState,
    input: AssembleInput,
) -> FormVerdict<WireFrame, AssembleState> {
    let mut ops = Vec::new();
    let mut root_order = state.ordered_root_keys.clone();
    let (births, deaths) = match absorption_tokens(config, &state, &input) {
        Ok(tokens) => tokens,
        Err(reason) => return FormVerdict::fallback(reason),
    };
    for event in &input.events {
        let node_id = match event {
            AssemblyEvent::RootSeq { node_id, .. }
            | AssemblyEvent::ToOne { node_id, .. }
            | AssemblyEvent::ToMany { node_id, .. }
            | AssemblyEvent::Exists { node_id, .. } => node_id,
        };
        let Some(node) = assembly_node(config, node_id) else {
            return FormVerdict::fallback(FallbackReason::WireUnaddressable);
        };
        match event {
            AssemblyEvent::RootSeq { delta, .. } => {
                if node_id != &config.root_node_id {
                    return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                }
                for seq in &delta.ops {
                    match seq {
                        SeqOp::SpliceOut { row_key, .. } => {
                            let Some(position) = root_order.iter().position(|key| key == row_key)
                            else {
                                return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                            };
                            root_order.remove(position);
                            ops.push(WireOp {
                                op: WireOpKind::Remove,
                                node_id: node_id.clone(),
                                root_key: None,
                                key: Some(row_key.clone()),
                                position: Some(position),
                                row: None,
                            });
                        }
                        SeqOp::SpliceIn { row, .. } => {
                            let Some(key) = row_key(row) else {
                                return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                            };
                            let position = input
                                .ordered_root_keys
                                .iter()
                                .position(|candidate| candidate == &key)
                                .unwrap_or(root_order.len())
                                .min(root_order.len());
                            root_order.insert(position, key.clone());
                            let Some((_, assembled)) = result_item(&input.post_result, &key) else {
                                return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                            };
                            ops.push(WireOp {
                                op: WireOpKind::Add,
                                node_id: node_id.clone(),
                                root_key: None,
                                key: Some(key),
                                position: Some(position),
                                row: Some(assembled.clone()),
                            });
                        }
                        SeqOp::Patch { row_key, post, .. } => {
                            let position = root_order.iter().position(|key| key == row_key);
                            ops.push(WireOp {
                                op: WireOpKind::Update,
                                node_id: node_id.clone(),
                                root_key: Some(row_key.clone()),
                                key: Some(row_key.clone()),
                                position,
                                row: Some(row_value(projected_row(post, &node.projection_fields))),
                            });
                        }
                    }
                }
            }
            AssemblyEvent::ToOne { delta, .. } => {
                for lookup in &delta.ops {
                    match lookup {
                        LookupDeltaOp::Patch {
                            scope,
                            child_key,
                            fields,
                        } => {
                            if scope_is_absorbed(
                                config, &state, &input, node_id, scope, &births, &deaths,
                            ) {
                                continue;
                            }
                            if !addressable(config, node_id) {
                                return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                            }
                            let Some(context) =
                                scope_context(config, &input.post_result, node_id, scope)
                            else {
                                return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                            };
                            ops.push(WireOp {
                                op: WireOpKind::Update,
                                node_id: node_id.clone(),
                                root_key: Some(context.root_key),
                                key: Some(child_key.clone()),
                                position: Some(context.root_position),
                                row: Some(row_value(projected_row(
                                    fields,
                                    &node.projection_fields,
                                ))),
                            });
                        }
                        LookupDeltaOp::Presence { scope, value, .. } => {
                            if scope_is_absorbed(
                                config, &state, &input, node_id, scope, &births, &deaths,
                            ) {
                                continue;
                            }
                            if !addressable(config, node_id) {
                                return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                            }
                            let Some(context) =
                                scope_context(config, &input.post_result, node_id, scope)
                            else {
                                return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                            };
                            let assembled = if value.is_some() {
                                let Some(field) = node.result_field.as_deref() else {
                                    return FormVerdict::fallback(
                                        FallbackReason::WireUnaddressable,
                                    );
                                };
                                let Some(value) = context.parent.get(field) else {
                                    return FormVerdict::fallback(
                                        FallbackReason::WireUnaddressable,
                                    );
                                };
                                value.clone()
                            } else {
                                Value::Null
                            };
                            ops.push(WireOp {
                                op: WireOpKind::Update,
                                node_id: node_id.clone(),
                                root_key: Some(context.root_key),
                                key: Some(scope.clone()),
                                position: Some(context.root_position),
                                row: Some(assembled),
                            });
                        }
                    }
                }
            }
            AssemblyEvent::ToMany { scope, delta, .. } => {
                if scope_is_absorbed(config, &state, &input, node_id, scope, &births, &deaths) {
                    continue;
                }
                if !addressable(config, node_id) {
                    return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                }
                let Some(result_field) = node.result_field.as_deref() else {
                    return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                };
                for seq in &delta.ops {
                    match seq {
                        SeqOp::SpliceIn { row, .. } => {
                            let Some(key) = row_key(row) else {
                                return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                            };
                            let Some(context) =
                                scope_context(config, &input.post_result, node_id, scope)
                            else {
                                return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                            };
                            let Some((position, assembled)) =
                                child_item(context.parent, result_field, &key)
                            else {
                                return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                            };
                            ops.push(WireOp {
                                op: WireOpKind::Add,
                                node_id: node_id.clone(),
                                root_key: Some(context.root_key),
                                key: Some(key),
                                position: Some(position),
                                row: Some(assembled.clone()),
                            });
                        }
                        SeqOp::SpliceOut { row_key, .. } => {
                            let Some(context) =
                                scope_context(config, &state.result, node_id, scope)
                            else {
                                return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                            };
                            let Some((position, _)) =
                                child_item(context.parent, result_field, row_key)
                            else {
                                return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                            };
                            ops.push(WireOp {
                                op: WireOpKind::Remove,
                                node_id: node_id.clone(),
                                root_key: Some(context.root_key),
                                key: Some(row_key.clone()),
                                position: Some(position),
                                row: None,
                            });
                        }
                        SeqOp::Patch { row_key, post, .. } => {
                            let Some(context) =
                                scope_context(config, &input.post_result, node_id, scope)
                            else {
                                return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                            };
                            let Some((position, _)) =
                                child_item(context.parent, result_field, row_key)
                            else {
                                return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                            };
                            ops.push(WireOp {
                                op: WireOpKind::Update,
                                node_id: node_id.clone(),
                                root_key: Some(context.root_key),
                                key: Some(row_key.clone()),
                                position: Some(position),
                                row: Some(row_value(projected_row(post, &node.projection_fields))),
                            });
                        }
                    }
                }
            }
            AssemblyEvent::Exists { delta, .. } => {
                let projected_name = node
                    .result_field
                    .clone()
                    .or_else(|| node.projection_fields.iter().next().cloned())
                    .unwrap_or_else(|| node_id.clone());
                for bit in &delta.transitions {
                    if scope_is_absorbed(
                        config, &state, &input, node_id, &bit.scope, &births, &deaths,
                    ) {
                        continue;
                    }
                    if !addressable(config, node_id) {
                        return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                    }
                    let Some(context) =
                        scope_context(config, &input.post_result, node_id, &bit.scope)
                    else {
                        return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                    };
                    let Some(value) = context.parent.get(&projected_name).cloned() else {
                        return FormVerdict::fallback(FallbackReason::WireUnaddressable);
                    };
                    ops.push(WireOp {
                        op: WireOpKind::Update,
                        node_id: node_id.clone(),
                        root_key: Some(context.root_key),
                        key: Some(bit.scope.clone()),
                        position: Some(context.root_position),
                        row: Some(json!({ projected_name.clone(): value })),
                    });
                }
            }
        }
    }
    if root_order != input.ordered_root_keys {
        return FormVerdict::fallback(FallbackReason::WireUnaddressable);
    }
    let digest = result_digest(&input.post_result);
    FormVerdict::Maintain {
        delta_out: WireFrame {
            ops,
            ordered_root_keys: input.ordered_root_keys.clone(),
            result_digest: digest,
        },
        next_state: AssembleState {
            result: input.post_result,
            ordered_root_keys: input.ordered_root_keys,
        },
    }
}

// @ref LLP 0309.000#5-composition-and-eligibility — dataflow output feeds
// consumers, and any fallback discards every tentative operator state update.
pub fn evaluate_composition(
    nodes: &[CompositionNode],
    state: Value,
    input: Value,
    reads: &ReadTranscript,
) -> FormVerdict<Value, Value> {
    match evaluate_composition_dynamic(nodes, state, input, reads) {
        DynamicVerdict::Maintain {
            delta_out,
            next_state,
        } => FormVerdict::Maintain {
            delta_out,
            next_state,
        },
        DynamicVerdict::Fallback(reason) => FormVerdict::fallback(reason),
    }
}

fn evaluate_composition_dynamic(
    nodes: &[CompositionNode],
    state: Value,
    input: Value,
    reads: &ReadTranscript,
) -> DynamicVerdict {
    let Some(states) = state.as_object() else {
        return DynamicVerdict::Fallback(FallbackReason::PredicateUnanalyzable);
    };
    let Some(inputs) = input.as_object() else {
        return DynamicVerdict::Fallback(FallbackReason::PredicateUnanalyzable);
    };
    let mut outputs = Map::new();
    let mut next_states = Map::new();
    for node in nodes {
        let Some(node_state) = states.get(&node.node_id).cloned() else {
            return DynamicVerdict::Fallback(FallbackReason::PredicateUnanalyzable);
        };
        let node_input = match &node.input_from {
            Some(source) => match outputs.get(source) {
                Some(output) => output.clone(),
                None => return DynamicVerdict::Fallback(FallbackReason::PredicateUnanalyzable),
            },
            None => match inputs.get(&node.node_id) {
                Some(input) => input.clone(),
                None => return DynamicVerdict::Fallback(FallbackReason::PredicateUnanalyzable),
            },
        };
        match evaluate_dynamic(&node.operator, node_state, node_input, reads) {
            DynamicVerdict::Maintain {
                delta_out,
                next_state,
            } => {
                outputs.insert(node.node_id.clone(), delta_out);
                next_states.insert(node.node_id.clone(), next_state);
            }
            DynamicVerdict::Fallback(reason) => return DynamicVerdict::Fallback(reason),
        }
    }
    DynamicVerdict::Maintain {
        delta_out: Value::Object(outputs),
        next_state: Value::Object(next_states),
    }
}
