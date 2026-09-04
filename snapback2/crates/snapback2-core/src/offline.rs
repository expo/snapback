//! Public local-first delivery projection.
// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — clients receive one frozen, authority-bound projection instead of the private closure receipt.

use crate::engine::{
    Execution, ExecutionState, ReceiptRange, ResultProvenance, RowRecord, Verdict,
};
use crate::value::{Value, digest};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as Json, json};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

pub const DELIVERY_PROTOCOL_V1: u8 = 1;
const ROW_REFERENCE_KEY: &str = "$row";
const ROW_ESCAPE_KEY: &str = "$value";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeliveryState {
    Complete,
    Capped,
    Partial,
    Denied,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryAuthority {
    pub principal: String,
    pub auth_epoch: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeliveryRow {
    pub table: String,
    pub id: String,
    pub row: Json,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryRange {
    pub site: String,
    pub table: String,
    pub index: String,
    pub prefix: Vec<Json>,
    pub order: crate::ir::Order,
    pub take: u32,
    pub after: Option<Json>,
    pub before: Option<Json>,
    pub gt: Option<Json>,
    pub gte: Option<Json>,
    pub lt: Option<Json>,
    pub lte: Option<Json>,
    pub rule_hash: String,
    pub row_ids: Vec<String>,
    pub stop: crate::engine::StopReason,
    pub absence: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub halo_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryVerdict {
    pub rule_hash: String,
    pub pinned_inputs_digest: String,
    pub principal: String,
    pub auth_epoch: u64,
    pub result: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeliveryReceipt {
    pub ranges: Vec<DeliveryRange>,
    pub absences: Vec<(String, String, Vec<Json>)>,
    pub verdicts: Vec<DeliveryVerdict>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryEnvelopeV1 {
    pub protocol: u8,
    pub generation: String,
    pub schema_hash: String,
    pub plan_hash: String,
    pub authority: DeliveryAuthority,
    pub state: DeliveryState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule: Option<String>,
    pub data: Json,
    pub next: Option<String>,
    pub seq: u64,
    pub rows: Vec<DeliveryRow>,
    pub receipt: DeliveryReceipt,
    pub validator: String,
}

pub struct DeliveryProjectionContext<'a> {
    pub op: &'a str,
    pub args: &'a BTreeMap<String, Value>,
    pub generation: &'a str,
    pub schema_hash: &'a str,
    pub plan_hash: &'a str,
    pub principal: &'a str,
    pub auth_epoch: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ValidatorPayload<'a> {
    op: &'a str,
    args: &'a BTreeMap<String, Value>,
    state: &'a DeliveryState,
    reason: &'a Option<String>,
    rule: &'a Option<String>,
    data: &'a Json,
    next: &'a Option<String>,
    rows: &'a [DeliveryRow],
    receipt: &'a DeliveryReceipt,
    generation: &'a str,
    schema_hash: &'a str,
    plan_hash: &'a str,
    principal: &'a str,
    auth_epoch: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DeliveryProjectionError {
    NonQueryState,
    MissingPooledRow { table: String, id: String },
}

impl fmt::Display for DeliveryProjectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NonQueryState => {
                formatter.write_str("delivery envelopes are defined only for query executions")
            }
            Self::MissingPooledRow { table, id } => {
                write!(
                    formatter,
                    "result references missing pooled row {table}/{id}"
                )
            }
        }
    }
}

impl std::error::Error for DeliveryProjectionError {}

/// Project an engine execution into the frozen public v1 delivery envelope.
pub fn project(
    execution: &Execution,
    context: &DeliveryProjectionContext<'_>,
) -> Result<DeliveryEnvelopeV1, DeliveryProjectionError> {
    let state = delivery_state(&execution.state)?;
    let reason = match &execution.state {
        ExecutionState::Partial { reason } => Some(reason.clone()),
        _ => None,
    };
    let rule = match &execution.state {
        ExecutionState::Denied { rule } => Some(rule.clone()),
        _ => None,
    };
    let rows = row_pool(execution);
    let pool = rows
        .iter()
        .map(|row| (row.table.clone(), row.id.clone()))
        .collect::<BTreeSet<_>>();
    let data = pooled_value(&execution.result, &execution.result_provenance, &pool)?;
    let receipt = DeliveryReceipt {
        ranges: execution
            .receipt
            .ranges
            .iter()
            .map(delivery_range)
            .collect(),
        // @ref LLP 1012#5-retention-revocation-and-the-fence — only primary-id negative facts may leave the owner; alternate-key misses remain indistinguishable from hidden rows.
        absences: execution
            .receipt
            .absences
            .iter()
            .filter(|(_, index, _)| index == "byId")
            .map(|(table, index, key)| {
                (
                    table.clone(),
                    index.clone(),
                    key.iter().map(value_to_wire_json).collect(),
                )
            })
            .collect(),
        verdicts: execution
            .receipt
            .verdicts
            .iter()
            .map(delivery_verdict)
            .collect(),
    };
    // The validator's logical data is the expanded answer. The envelope's data
    // uses row references, but hashing only those references would miss a body
    // change whose (table, id) is stable.
    let validator_data = value_to_wire_json(&execution.result);
    let validator = digest(&ValidatorPayload {
        op: context.op,
        args: context.args,
        state: &state,
        reason: &reason,
        rule: &rule,
        data: &validator_data,
        next: &execution.next,
        rows: &rows,
        receipt: &receipt,
        generation: context.generation,
        schema_hash: context.schema_hash,
        plan_hash: context.plan_hash,
        principal: context.principal,
        auth_epoch: context.auth_epoch,
    });
    Ok(DeliveryEnvelopeV1 {
        protocol: DELIVERY_PROTOCOL_V1,
        generation: context.generation.to_owned(),
        schema_hash: context.schema_hash.to_owned(),
        plan_hash: context.plan_hash.to_owned(),
        authority: DeliveryAuthority {
            principal: context.principal.to_owned(),
            auth_epoch: context.auth_epoch,
        },
        state,
        reason,
        rule,
        data,
        next: execution.next.clone(),
        seq: execution.seq,
        rows,
        receipt,
        validator,
    })
}

fn delivery_state(state: &ExecutionState) -> Result<DeliveryState, DeliveryProjectionError> {
    match state {
        ExecutionState::Complete => Ok(DeliveryState::Complete),
        ExecutionState::Capped => Ok(DeliveryState::Capped),
        ExecutionState::Partial { .. } => Ok(DeliveryState::Partial),
        ExecutionState::Denied { .. } => Ok(DeliveryState::Denied),
        ExecutionState::Committed { .. } | ExecutionState::Rejected { .. } => {
            Err(DeliveryProjectionError::NonQueryState)
        }
    }
}

fn row_pool(execution: &Execution) -> Vec<DeliveryRow> {
    let mut pool = BTreeMap::<(String, String), &RowRecord>::new();
    for row in &execution.receipt.rows {
        pool.entry((row.table.clone(), row.id.clone()))
            .or_insert(row);
    }
    for range in &execution.receipt.ranges {
        if let Some(row) = &range.halo {
            pool.entry((row.table.clone(), row.id.clone()))
                .or_insert(row);
        }
    }
    pool.into_iter()
        .map(|((table, id), row)| DeliveryRow {
            table,
            id,
            row: value_to_wire_json(&row.row),
        })
        .collect()
}

fn pooled_value(
    value: &Value,
    provenance: &ResultProvenance,
    rows: &BTreeSet<(String, String)>,
) -> Result<Json, DeliveryProjectionError> {
    if let ResultProvenance::Row { table, id } = provenance {
        if !rows.contains(&(table.clone(), id.clone())) {
            return Err(DeliveryProjectionError::MissingPooledRow {
                table: table.clone(),
                id: id.clone(),
            });
        }
        let reference = Map::from_iter([
            ("table".to_owned(), Json::String(table.clone())),
            ("id".to_owned(), Json::String(id.clone())),
        ]);
        return Ok(Json::Object(Map::from_iter([(
            ROW_REFERENCE_KEY.to_owned(),
            Json::Object(reference),
        )])));
    }
    Ok(match value {
        Value::Null => Json::Null,
        Value::Bool(value) => Json::Bool(*value),
        Value::Int(value) => Json::Number((*value).into()),
        Value::String(value) | Value::Id(value) => Json::String(value.clone()),
        Value::Bytes(value) => json!({ "Bytes": crate::encode_bytes_hex(value) }),
        Value::Row(values) | Value::Map(values) => {
            let provenance = match provenance {
                ResultProvenance::Object(values) => Some(values),
                _ => None,
            };
            let object = values
                .iter()
                .map(|(key, value)| {
                    let provenance = provenance
                        .and_then(|values| values.get(key))
                        .unwrap_or(&ResultProvenance::None);
                    Ok((key.clone(), pooled_value(value, provenance, rows)?))
                })
                .collect::<Result<Map<_, _>, DeliveryProjectionError>>()?;
            if object.contains_key(ROW_REFERENCE_KEY) {
                Json::Object(Map::from_iter([(
                    ROW_REFERENCE_KEY.to_owned(),
                    Json::Object(Map::from_iter([(
                        ROW_ESCAPE_KEY.to_owned(),
                        Json::Object(object),
                    )])),
                )]))
            } else {
                Json::Object(object)
            }
        }
        Value::Array(values) => {
            let provenance = match provenance {
                ResultProvenance::Array(provenance) if provenance.len() == values.len() => {
                    Some(provenance)
                }
                _ => None,
            };
            Json::Array(
                values
                    .iter()
                    .enumerate()
                    .map(|(index, value)| {
                        pooled_value(
                            value,
                            provenance
                                .and_then(|values| values.get(index))
                                .unwrap_or(&ResultProvenance::None),
                            rows,
                        )
                    })
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
    })
}

fn delivery_range(range: &ReceiptRange) -> DeliveryRange {
    DeliveryRange {
        site: range.site.clone(),
        table: range.table.clone(),
        index: range.index.clone(),
        prefix: range.prefix.iter().map(value_to_wire_json).collect(),
        order: range.order,
        take: range.take,
        after: range.after.as_ref().map(value_to_wire_json),
        before: range.before.as_ref().map(value_to_wire_json),
        gt: range.gt.as_ref().map(value_to_wire_json),
        gte: range.gte.as_ref().map(value_to_wire_json),
        lt: range.lt.as_ref().map(value_to_wire_json),
        lte: range.lte.as_ref().map(value_to_wire_json),
        rule_hash: range.rule_hash.clone(),
        row_ids: range.row_ids.clone(),
        stop: range.stop,
        absence: range.absence,
        halo_id: range.halo.as_ref().map(|row| row.id.clone()),
    }
}

fn delivery_verdict(verdict: &Verdict) -> DeliveryVerdict {
    DeliveryVerdict {
        rule_hash: verdict.rule_hash.clone(),
        pinned_inputs_digest: verdict.pinned_inputs_digest.clone(),
        principal: verdict.principal.clone(),
        auth_epoch: verdict.auth_epoch,
        result: verdict.result,
    }
}

/// The public JSON encoding used by query data and every row in the pool.
pub fn value_to_wire_json(value: &Value) -> Json {
    match value {
        Value::Null => Json::Null,
        Value::Bool(value) => Json::Bool(*value),
        Value::Int(value) => Json::Number((*value).into()),
        Value::String(value) | Value::Id(value) => Json::String(value.clone()),
        Value::Bytes(value) => json!({ "Bytes": crate::encode_bytes_hex(value) }),
        Value::Row(values) | Value::Map(values) => Json::Object(
            values
                .iter()
                .map(|(key, value)| (key.clone(), value_to_wire_json(value)))
                .collect::<Map<_, _>>(),
        ),
        Value::Array(values) => Json::Array(values.iter().map(value_to_wire_json).collect()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{AuthoritativeTrace, ClosureReceipt};
    use crate::ir::Order;
    use crate::object;

    fn hash(character: char) -> String {
        std::iter::repeat_n(character, 64).collect()
    }

    fn row(id: &str, body: &str) -> RowRecord {
        RowRecord {
            table: "messages".to_owned(),
            id: id.to_owned(),
            row: object([
                ("body", Value::String(body.to_owned())),
                ("id", Value::Id(id.to_owned())),
            ]),
        }
    }

    fn range(halo: Option<RowRecord>) -> ReceiptRange {
        ReceiptRange {
            site: "messages.page".to_owned(),
            table: "messages".to_owned(),
            index: "byConversationAt".to_owned(),
            prefix: vec![Value::Id("conversation-1".to_owned())],
            order: Order::Asc,
            take: 2,
            after: None,
            before: None,
            gt: None,
            gte: None,
            lt: None,
            lte: None,
            rule_hash: hash('a'),
            row_ids: vec!["message-1".to_owned()],
            stop: crate::engine::StopReason::Exhausted,
            absence: false,
            halo,
            n2_key: None,
        }
    }

    fn execution(receipt: ClosureReceipt) -> Execution {
        let first = row("message-1", "hello");
        Execution {
            result: Value::Array(vec![first.row]),
            result_provenance: ResultProvenance::Array(vec![ResultProvenance::Row {
                table: "messages".to_owned(),
                id: "message-1".to_owned(),
            }]),
            trace: AuthoritativeTrace::default(),
            receipt,
            state: ExecutionState::Complete,
            seq: 7,
            next: None,
        }
    }

    fn project_test(
        execution: &Execution,
        generation: &str,
        principal: &str,
        epoch: u64,
    ) -> DeliveryEnvelopeV1 {
        let args = BTreeMap::from([(
            "conversationId".to_owned(),
            Value::Id("conversation-1".to_owned()),
        )]);
        project(
            execution,
            &DeliveryProjectionContext {
                op: "messages.thread",
                args: &args,
                generation,
                schema_hash: &hash('b'),
                plan_hash: &hash('c'),
                principal,
                auth_epoch: epoch,
            },
        )
        .unwrap()
    }

    #[test]
    fn envelope_projection_pools_rows_projects_halo_and_filters_alternate_absence() {
        let first = row("message-1", "hello");
        let halo = row("message-2", "later");
        let execution = execution(ClosureReceipt {
            schema_hash: Some(hash('b')),
            rows: vec![first.clone(), first],
            ranges: vec![range(Some(halo))],
            absences: vec![
                (
                    "messages".to_owned(),
                    "byId".to_owned(),
                    vec![Value::Id("missing".to_owned())],
                ),
                (
                    "messages".to_owned(),
                    "bySlug".to_owned(),
                    vec![Value::String("secret".to_owned())],
                ),
            ],
            verdicts: Vec::new(),
        });
        let envelope = project_test(&execution, &hash('d'), "alice", 3);
        assert_eq!(
            envelope.rows.len(),
            2,
            "each (table,id) belongs in the pool once"
        );
        assert_eq!(envelope.receipt.absences.len(), 1);
        assert_eq!(envelope.receipt.absences[0].1, "byId");
        assert_eq!(
            envelope.receipt.ranges[0].halo_id.as_deref(),
            Some("message-2")
        );
        assert_eq!(
            envelope.data,
            json!([{ "$row": { "table": "messages", "id": "message-1" } }]),
        );
        let serialized = serde_json::to_value(&envelope).unwrap();
        assert!(serialized["receipt"]["ranges"][0].get("halo").is_none());
        assert!(serialized["receipt"].get("rows").is_none());
    }

    #[test]
    fn envelope_projection_carries_only_engine_certified_uniform_ranges() {
        let without_range = project_test(
            &execution(ClosureReceipt {
                schema_hash: Some(hash('b')),
                rows: vec![row("message-1", "hello")],
                ranges: Vec::new(),
                absences: Vec::new(),
                verdicts: Vec::new(),
            }),
            &hash('d'),
            "alice",
            3,
        );
        assert!(without_range.receipt.ranges.is_empty());
        let with_range = project_test(
            &execution(ClosureReceipt {
                schema_hash: Some(hash('b')),
                rows: vec![row("message-1", "hello")],
                ranges: vec![range(None)],
                absences: Vec::new(),
                verdicts: Vec::new(),
            }),
            &hash('d'),
            "alice",
            3,
        );
        assert_eq!(with_range.receipt.ranges[0].row_ids, ["message-1"]);
        assert_eq!(
            with_range.receipt.ranges[0].stop,
            crate::engine::StopReason::Exhausted
        );
    }

    #[test]
    fn validator_excludes_seq_and_binds_absence_verdict_next_generation_principal_and_epoch() {
        let base_receipt = ClosureReceipt {
            schema_hash: Some(hash('b')),
            rows: vec![row("message-1", "hello")],
            ranges: vec![range(Some(row("message-2", "later")))],
            absences: Vec::new(),
            verdicts: vec![Verdict {
                rule_hash: hash('e'),
                pinned_inputs_digest: hash('f'),
                principal: "alice".to_owned(),
                auth_epoch: 3,
                result: true,
            }],
        };
        let base_execution = execution(base_receipt.clone());
        let base = project_test(&base_execution, &hash('d'), "alice", 3).validator;

        let mut changed = base_execution.clone();
        changed.seq += 1;
        assert_eq!(
            project_test(&changed, &hash('d'), "alice", 3).validator,
            base
        );

        changed = base_execution.clone();
        changed.receipt.absences.push((
            "messages".to_owned(),
            "byId".to_owned(),
            vec![Value::Id("gone".to_owned())],
        ));
        assert_ne!(
            project_test(&changed, &hash('d'), "alice", 3).validator,
            base
        );

        changed = base_execution.clone();
        changed.receipt.verdicts[0].auth_epoch += 1;
        assert_ne!(
            project_test(&changed, &hash('d'), "alice", 3).validator,
            base
        );

        changed = base_execution.clone();
        changed.receipt.ranges[0].halo.as_mut().unwrap().row = row("message-2", "changed").row;
        assert_ne!(
            project_test(&changed, &hash('d'), "alice", 3).validator,
            base,
            "the canonical pool, including a halo body, is validator content"
        );

        changed = base_execution.clone();
        changed.next = Some("cursor".to_owned());
        assert_ne!(
            project_test(&changed, &hash('d'), "alice", 3).validator,
            base
        );
        assert_ne!(
            project_test(&base_execution, &hash('1'), "alice", 3).validator,
            base
        );
        assert_ne!(
            project_test(&base_execution, &hash('d'), "bob", 3).validator,
            base
        );
        assert_ne!(
            project_test(&base_execution, &hash('d'), "alice", 4).validator,
            base
        );

        let changed_args = BTreeMap::from([(
            "conversationId".to_owned(),
            Value::Id("conversation-2".to_owned()),
        )]);
        let changed_args_validator = project(
            &base_execution,
            &DeliveryProjectionContext {
                op: "messages.thread",
                args: &changed_args,
                generation: &hash('d'),
                schema_hash: &hash('b'),
                plan_hash: &hash('c'),
                principal: "alice",
                auth_epoch: 3,
            },
        )
        .unwrap()
        .validator;
        assert_ne!(changed_args_validator, base);

        let mut partial_a = base_execution.clone();
        partial_a.result = Value::Null;
        partial_a.result_provenance = ResultProvenance::None;
        partial_a.state = ExecutionState::Partial {
            reason: "never-held".to_owned(),
        };
        let mut partial_b = partial_a.clone();
        partial_b.state = ExecutionState::Partial {
            reason: "evicted".to_owned(),
        };
        assert_ne!(
            project_test(&partial_a, &hash('d'), "alice", 3).validator,
            project_test(&partial_b, &hash('d'), "alice", 3).validator,
        );

        let mut denied_a = partial_a;
        denied_a.state = ExecutionState::Denied {
            rule: "messages.Read".to_owned(),
        };
        let mut denied_b = denied_a.clone();
        denied_b.state = ExecutionState::Denied {
            rule: "memberships.Read".to_owned(),
        };
        assert_ne!(
            project_test(&denied_a, &hash('d'), "alice", 3).validator,
            project_test(&denied_b, &hash('d'), "alice", 3).validator,
        );
    }

    #[test]
    fn projection_uses_row_provenance_and_escapes_application_row_shapes() {
        let body = object([
            ("body", Value::String("same".to_owned())),
            ("id", Value::Id("shared".to_owned())),
        ]);
        let execution = Execution {
            result: Value::Array(vec![body.clone(), body.clone()]),
            result_provenance: ResultProvenance::Array(vec![
                ResultProvenance::Row {
                    table: "alpha".to_owned(),
                    id: "shared".to_owned(),
                },
                ResultProvenance::Row {
                    table: "beta".to_owned(),
                    id: "shared".to_owned(),
                },
            ]),
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt {
                rows: vec![
                    RowRecord {
                        table: "alpha".to_owned(),
                        id: "shared".to_owned(),
                        row: body.clone(),
                    },
                    RowRecord {
                        table: "beta".to_owned(),
                        id: "shared".to_owned(),
                        row: body,
                    },
                ],
                ..ClosureReceipt::default()
            },
            state: ExecutionState::Complete,
            seq: 1,
            next: None,
        };
        let envelope = project_test(&execution, &hash('d'), "alice", 3);
        assert_eq!(
            envelope.data,
            json!([
                { "$row": { "table": "alpha", "id": "shared" } },
                { "$row": { "table": "beta", "id": "shared" } },
            ])
        );

        let application = Execution {
            result: Value::Map(BTreeMap::from([(
                "$row".to_owned(),
                Value::Map(BTreeMap::from([
                    ("id".to_owned(), Value::String("literal".to_owned())),
                    ("table".to_owned(), Value::String("application".to_owned())),
                ])),
            )])),
            result_provenance: ResultProvenance::None,
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt::default(),
            state: ExecutionState::Complete,
            seq: 1,
            next: None,
        };
        assert_eq!(
            project_test(&application, &hash('d'), "alice", 3).data,
            json!({ "$row": { "$value": { "$row": { "id": "literal", "table": "application" } } } })
        );
    }

    #[test]
    fn projection_refuses_mutation_states_without_panicking() {
        let mut execution = execution(ClosureReceipt::default());
        execution.state = ExecutionState::Committed { seq: 8 };
        let args = BTreeMap::new();
        assert_eq!(
            project(
                &execution,
                &DeliveryProjectionContext {
                    op: "messages.send",
                    args: &args,
                    generation: &hash('d'),
                    schema_hash: &hash('b'),
                    plan_hash: &hash('c'),
                    principal: "alice",
                    auth_epoch: 3,
                },
            ),
            Err(DeliveryProjectionError::NonQueryState)
        );
    }
}
