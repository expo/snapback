//! In-memory live-query subscriptions indexed by authoritative trace keys.
// @ref LLP 1001#5-live-subscriptions-livers — authoritative keys drive conservative reruns.

use crate::engine::{
    AuthoritativeTrace, ClosureReceipt, Context, Execution, ExecutionState, RuntimeError,
};
use crate::ir::ProgramKind;
use crate::registry::Runtime;
use crate::store::CommitRecord;
use crate::value::{Value, canonical_json, digest};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub type SubscriptionId = u64;
type TraceIndex = (String, String);
type ExactTraceKey = (String, String, String);
type RangeSubscription = (Vec<Value>, SubscriptionId);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    pub id: SubscriptionId,
    pub seq: u64,
    pub execution: Execution,
    pub changed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionInfo {
    pub id: SubscriptionId,
    pub op: String,
    pub principal: String,
    pub last_result_digest: String,
    pub last_seq: u64,
}

#[derive(Clone)]
struct Subscription {
    op: String,
    context: Context,
    last_result_digest: String,
    last_seq: u64,
    trace: AuthoritativeTrace,
}

#[derive(Default)]
pub struct Subscriptions {
    next_id: SubscriptionId,
    entries: BTreeMap<SubscriptionId, Subscription>,
    ranges: BTreeMap<TraceIndex, Vec<RangeSubscription>>,
    exact: BTreeMap<ExactTraceKey, BTreeSet<SubscriptionId>>,
    constraints: BTreeMap<String, BTreeSet<SubscriptionId>>,
}

impl Subscriptions {
    fn rebuild_indexes(&mut self) {
        self.ranges.clear();
        self.exact.clear();
        self.constraints.clear();
        for (id, subscription) in &self.entries {
            for range in &subscription.trace.ranges {
                self.ranges
                    .entry((range.table.clone(), range.index.clone()))
                    .or_default()
                    .push((range.prefix.clone(), *id));
            }
            for point in &subscription.trace.points {
                self.exact
                    .entry((
                        point.table.clone(),
                        point.index.clone(),
                        canonical_json(&point.key),
                    ))
                    .or_default()
                    .insert(*id);
            }
            for (table, index, key) in &subscription.trace.absences {
                self.exact
                    .entry((table.clone(), index.clone(), canonical_json(key)))
                    .or_default()
                    .insert(*id);
            }
            for input in &subscription.trace.rule_inputs {
                self.exact
                    .entry((
                        input.table.clone(),
                        input.index.clone(),
                        canonical_json(&input.key),
                    ))
                    .or_default()
                    .insert(*id);
            }
            for input in &subscription.trace.constraint_inputs {
                self.constraints
                    .entry(input.table.clone())
                    .or_default()
                    .insert(*id);
            }
        }
        for ranges in self.ranges.values_mut() {
            ranges.sort_by_key(|(_, id)| *id);
        }
    }

    fn ids(&self) -> Vec<SubscriptionId> {
        self.entries.keys().copied().collect()
    }
}

impl Runtime {
    pub fn subscribe(
        &mut self,
        op: &str,
        context: Context,
    ) -> Result<(SubscriptionId, Execution), RuntimeError> {
        let program = self
            .generation
            .programs
            .get(op)
            .ok_or_else(|| RuntimeError::OpUnknown(op.to_owned()))?;
        if program.0.kind != ProgramKind::Query {
            return Err(RuntimeError::Input(format!(
                "cannot subscribe to mutation {op}"
            )));
        }
        let execution = self.execute(op, context.clone())?;
        self.subs.next_id = self.subs.next_id.saturating_add(1).max(1);
        let id = self.subs.next_id;
        self.subs.entries.insert(
            id,
            Subscription {
                op: op.to_owned(),
                context,
                last_result_digest: digest(&execution.result),
                last_seq: execution.seq,
                trace: execution.trace.clone(),
            },
        );
        self.subs.rebuild_indexes();
        Ok((id, execution))
    }

    pub fn unsubscribe(&mut self, id: SubscriptionId) {
        self.subs.entries.remove(&id);
        self.subs.rebuild_indexes();
    }

    pub fn invalidated(&self, commit: &CommitRecord) -> Vec<SubscriptionId> {
        let mut invalidated = BTreeSet::new();
        for touched in &commit.touched {
            if let Some(ranges) = self
                .subs
                .ranges
                .get(&(touched.table.clone(), touched.index.clone()))
            {
                for (prefix, id) in ranges {
                    if touched.key.starts_with(prefix) {
                        invalidated.insert(*id);
                    }
                }
            }
            if let Some(ids) = self.subs.exact.get(&(
                touched.table.clone(),
                touched.index.clone(),
                canonical_json(&touched.key),
            )) {
                invalidated.extend(ids);
            }
            if let Some(ids) = self.subs.constraints.get(&touched.table) {
                invalidated.extend(ids);
            }
        }
        invalidated.into_iter().collect()
    }

    pub fn rerun(&mut self, ids: &[SubscriptionId]) -> Vec<Delivery> {
        let ids: BTreeSet<_> = ids.iter().copied().collect();
        let mut deliveries = Vec::new();
        for id in ids {
            let Some(subscription) = self.subs.entries.get(&id).cloned() else {
                continue;
            };
            let execution = match self.execute(&subscription.op, subscription.context.clone()) {
                Ok(execution) => execution,
                Err(error) => Execution {
                    result: Value::Null,
                    trace: AuthoritativeTrace::default(),
                    receipt: ClosureReceipt::default(),
                    state: ExecutionState::Rejected {
                        code: error
                            .to_string()
                            .split(':')
                            .next()
                            .unwrap_or("E_RUNTIME")
                            .to_owned(),
                        message: error.to_string(),
                    },
                    seq: self.store().commit_seq().unwrap_or(subscription.last_seq),
                },
            };
            let fresh_digest = digest(&execution.result);
            let changed = fresh_digest != subscription.last_result_digest;
            if let Some(entry) = self.subs.entries.get_mut(&id) {
                entry.last_result_digest = fresh_digest;
                entry.last_seq = execution.seq;
                entry.trace = execution.trace.clone();
            }
            deliveries.push(Delivery {
                id,
                seq: execution.seq,
                execution,
                changed,
            });
        }
        self.subs.rebuild_indexes();
        deliveries
    }

    pub fn subscriptions(&self) -> Vec<SubscriptionInfo> {
        self.subs
            .entries
            .iter()
            .map(|(id, subscription)| SubscriptionInfo {
                id: *id,
                op: subscription.op.clone(),
                principal: subscription.context.viewer.clone(),
                last_result_digest: subscription.last_result_digest.clone(),
                last_seq: subscription.last_seq,
            })
            .collect()
    }

    pub(crate) fn rerun_all_subscriptions(&mut self) {
        let ids = self.subs.ids();
        let _ = self.rerun(&ids);
    }
}
