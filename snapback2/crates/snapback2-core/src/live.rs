//! In-memory live-query subscriptions indexed by authoritative trace keys.
// @ref LLP 1001#5-live-subscriptions-livers — authoritative keys drive conservative reruns.

use crate::engine::{AuthoritativeTrace, Context, Execution, RuntimeError};
use crate::ir::ProgramKind;
use crate::registry::Runtime;
use crate::store::CommitRecord;
use crate::value::{Value, canonical_json, digest};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub type SubscriptionId = u64;
type TraceIndex = (String, String);
type ExactTraceKey = (String, String, String);

#[derive(Default)]
struct RangePrefixGroup {
    prefix: Vec<crate::search_key::IndexAtom>,
    ids: BTreeSet<SubscriptionId>,
}

#[derive(Default)]
struct TraceKeys {
    ranges: BTreeMap<(String, String, String), Vec<crate::search_key::IndexAtom>>,
    exact: BTreeSet<ExactTraceKey>,
    constraints: BTreeSet<String>,
}

impl TraceKeys {
    fn from_trace(trace: &AuthoritativeTrace) -> Self {
        let mut keys = Self::default();
        for range in &trace.ranges {
            keys.ranges.insert(
                (
                    range.table.clone(),
                    range.index.clone(),
                    canonical_json(&range.prefix),
                ),
                range.prefix.clone(),
            );
        }
        for point in &trace.points {
            keys.exact.insert((
                point.table.clone(),
                point.index.clone(),
                canonical_json(&point.key),
            ));
        }
        for (table, index, key) in &trace.absences {
            keys.exact
                .insert((table.clone(), index.clone(), canonical_json(key)));
        }
        for input in &trace.rule_inputs {
            keys.exact.insert((
                input.table.clone(),
                input.index.clone(),
                canonical_json(&input.key),
            ));
        }
        keys.constraints.extend(
            trace
                .constraint_inputs
                .iter()
                .map(|input| input.table.clone()),
        );
        keys
    }
}

fn delivery_digest(execution: &Execution) -> String {
    digest(&(&execution.state, &execution.result))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    pub id: SubscriptionId,
    pub seq: u64,
    pub execution: Result<Execution, RuntimeError>,
    pub changed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionInfo {
    pub id: SubscriptionId,
    pub op: String,
    pub principal: String,
    pub last_result_digest: String,
    pub last_seq: u64,
    // @ref LLP 1002#7-test-and-the-receipt — qualification intersects the exact retained trace.
    // A later re-execution is not equivalent for branch- or time-sensitive queries.
    pub trace: AuthoritativeTrace,
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
    ranges: BTreeMap<TraceIndex, BTreeMap<String, RangePrefixGroup>>,
    exact: BTreeMap<ExactTraceKey, BTreeSet<SubscriptionId>>,
    constraints: BTreeMap<String, BTreeSet<SubscriptionId>>,
    #[cfg(test)]
    last_index_work: usize,
}

impl Subscriptions {
    fn add_keys(&mut self, id: SubscriptionId, keys: &TraceKeys) {
        for ((table, index, prefix_key), prefix) in &keys.ranges {
            #[cfg(test)]
            {
                self.last_index_work += 1;
            }
            let groups = self
                .ranges
                .entry((table.clone(), index.clone()))
                .or_default();
            #[cfg(test)]
            {
                self.last_index_work += 1;
            }
            let group = groups
                .entry(prefix_key.clone())
                .or_insert_with(|| RangePrefixGroup {
                    prefix: prefix.clone(),
                    ids: BTreeSet::new(),
                });
            #[cfg(test)]
            {
                self.last_index_work += 1;
            }
            group.ids.insert(id);
        }
        for key in &keys.exact {
            if self.exact.entry(key.clone()).or_default().insert(id) {
                #[cfg(test)]
                {
                    self.last_index_work += 1;
                }
            }
        }
        for table in &keys.constraints {
            if self
                .constraints
                .entry(table.clone())
                .or_default()
                .insert(id)
            {
                #[cfg(test)]
                {
                    self.last_index_work += 1;
                }
            }
        }
    }

    fn remove_keys(&mut self, id: SubscriptionId, keys: &TraceKeys) {
        for ((table, index, prefix_key), _) in &keys.ranges {
            let index_key = (table.clone(), index.clone());
            #[cfg(test)]
            {
                self.last_index_work += 1;
            }
            let mut remove_index = false;
            if let Some(groups) = self.ranges.get_mut(&index_key) {
                #[cfg(test)]
                {
                    self.last_index_work += 1;
                }
                let mut remove_prefix = false;
                if let Some(group) = groups.get_mut(prefix_key) {
                    #[cfg(test)]
                    {
                        self.last_index_work += 1;
                    }
                    group.ids.remove(&id);
                    remove_prefix = group.ids.is_empty();
                }
                if remove_prefix {
                    groups.remove(prefix_key);
                }
                remove_index = groups.is_empty();
            }
            if remove_index {
                self.ranges.remove(&index_key);
            }
        }
        for key in &keys.exact {
            if let Some(bucket) = self.exact.get_mut(key) {
                if bucket.remove(&id) {
                    #[cfg(test)]
                    {
                        self.last_index_work += 1;
                    }
                }
                if bucket.is_empty() {
                    self.exact.remove(key);
                }
            }
        }
        for table in &keys.constraints {
            if let Some(bucket) = self.constraints.get_mut(table) {
                if bucket.remove(&id) {
                    #[cfg(test)]
                    {
                        self.last_index_work += 1;
                    }
                }
                if bucket.is_empty() {
                    self.constraints.remove(table);
                }
            }
        }
    }

    fn replace_trace(
        &mut self,
        id: SubscriptionId,
        old: &AuthoritativeTrace,
        new: &AuthoritativeTrace,
    ) {
        let old = TraceKeys::from_trace(old);
        let new = TraceKeys::from_trace(new);
        let removed = TraceKeys {
            ranges: old
                .ranges
                .iter()
                .filter(|(key, _)| !new.ranges.contains_key(*key))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
            exact: old.exact.difference(&new.exact).cloned().collect(),
            constraints: old
                .constraints
                .difference(&new.constraints)
                .cloned()
                .collect(),
        };
        let added = TraceKeys {
            ranges: new
                .ranges
                .iter()
                .filter(|(key, _)| !old.ranges.contains_key(*key))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
            exact: new.exact.difference(&old.exact).cloned().collect(),
            constraints: new
                .constraints
                .difference(&old.constraints)
                .cloned()
                .collect(),
        };
        self.remove_keys(id, &removed);
        self.add_keys(id, &added);
    }

    fn ids(&self) -> Vec<SubscriptionId> {
        self.entries.keys().copied().collect()
    }
}

impl Runtime {
    pub fn connected_invalidated(&self, principals: &BTreeSet<String>) -> Vec<SubscriptionId> {
        principals
            .iter()
            .flat_map(|principal| {
                self.subs
                    .exact
                    .get(&(
                        crate::CONNECTED_TABLE.to_owned(),
                        crate::CONNECTED_INDEX.to_owned(),
                        canonical_json(&vec![Value::Id(principal.clone())]),
                    ))
                    .into_iter()
                    .flatten()
                    .copied()
            })
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }
    pub fn subscribe(
        &mut self,
        op: &str,
        context: Context,
    ) -> Result<(SubscriptionId, Execution), RuntimeError> {
        let program = self
            .generation
            .programs()
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
                last_result_digest: delivery_digest(&execution),
                last_seq: execution.seq,
                trace: execution.trace.clone(),
            },
        );
        self.subs
            .add_keys(id, &TraceKeys::from_trace(&execution.trace));
        Ok((id, execution))
    }

    pub fn unsubscribe(&mut self, id: SubscriptionId) {
        if let Some(subscription) = self.subs.entries.remove(&id) {
            self.subs
                .remove_keys(id, &TraceKeys::from_trace(&subscription.trace));
        }
    }

    pub fn invalidated(&self, commit: &CommitRecord) -> Vec<SubscriptionId> {
        let mut invalidated = BTreeSet::new();
        for touched in &commit.touched {
            if let Some(ranges) = self
                .subs
                .ranges
                .get(&(touched.table.clone(), touched.index.clone()))
            {
                for group in ranges.values() {
                    if crate::search_key::scalar_key_starts_with(&touched.key, &group.prefix) {
                        invalidated.extend(&group.ids);
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
        for touch in &commit.scope_touches {
            if let Some(ranges) = self
                .subs
                .ranges
                .get(&(touch.table.clone(), touch.index.clone()))
            {
                for group in ranges.values() {
                    if crate::search_key::scope_intersects(&touch.prefix, &group.prefix) {
                        invalidated.extend(&group.ids);
                    }
                }
            }
            if let Some(ids) = self.subs.constraints.get(&touch.table) {
                invalidated.extend(ids);
            }
        }
        invalidated.into_iter().collect()
    }

    pub fn rerun(&mut self, ids: &[SubscriptionId]) -> Vec<Delivery> {
        let contexts = ids
            .iter()
            .filter_map(|id| {
                self.subs
                    .entries
                    .get(id)
                    .map(|subscription| (*id, subscription.context.clone()))
            })
            .collect::<Vec<_>>();
        self.rerun_with_contexts(&contexts)
    }

    /// Re-execute a batch in stable subscription slots while replacing only the
    /// trace-index keys that changed. The latest supplied context wins for a
    /// duplicate id; a runtime error retains the old trace so a later overlap
    /// can retry it.
    pub fn rerun_with_contexts(&mut self, entries: &[(SubscriptionId, Context)]) -> Vec<Delivery> {
        let contexts = entries.iter().cloned().collect::<BTreeMap<_, _>>();
        let mut deliveries = Vec::new();
        #[cfg(test)]
        {
            self.subs.last_index_work = 0;
        }
        for (id, context) in contexts {
            let Some(subscription) = self.subs.entries.get(&id).cloned() else {
                continue;
            };
            let (seq, execution, changed) = match self.execute(&subscription.op, context.clone()) {
                Ok(execution) => {
                    let fresh_digest = delivery_digest(&execution);
                    let changed = fresh_digest != subscription.last_result_digest;
                    if let Some(entry) = self.subs.entries.get_mut(&id) {
                        entry.context = context;
                        entry.last_result_digest = fresh_digest;
                        entry.last_seq = execution.seq;
                        entry.trace = execution.trace.clone();
                    }
                    self.subs
                        .replace_trace(id, &subscription.trace, &execution.trace);
                    (execution.seq, Ok(execution), changed)
                }
                Err(error) => {
                    let seq = self.store().commit_seq().unwrap_or(subscription.last_seq);
                    let fresh_digest = digest(&(error.code(), error.to_string()));
                    let changed = fresh_digest != subscription.last_result_digest;
                    if let Some(entry) = self.subs.entries.get_mut(&id) {
                        entry.context = context;
                        entry.last_result_digest = fresh_digest;
                        entry.last_seq = seq;
                    }
                    // No fresh authoritative trace exists on a runtime error. Keep the
                    // previous indexes so a later overlapping commit can retry the query.
                    (seq, Err(error), changed)
                }
            };
            deliveries.push(Delivery {
                id,
                seq,
                execution,
                changed,
            });
        }
        deliveries
    }

    pub fn subscriptions(&self) -> Vec<SubscriptionInfo> {
        self.subs
            .entries
            .iter()
            .map(|(id, subscription)| SubscriptionInfo {
                id: *id,
                op: subscription.op.clone(),
                principal: subscription.context.viewer().to_owned(),
                last_result_digest: subscription.last_result_digest.clone(),
                last_seq: subscription.last_seq,
                trace: subscription.trace.clone(),
            })
            .collect()
    }

    pub(crate) fn rerun_all_subscriptions(&mut self) {
        let ids = self.subs.ids();
        let _ = self.rerun(&ids);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Actor;
    use crate::certificate::Ceilings;
    use crate::engine::{ConstraintTrace, StopReason, TraceRange};
    use crate::ir::Order;
    use crate::registry::{Generation, ProjectJson};
    use crate::schema::{Auth, ColumnType, Schema, public_table};
    use crate::search_key::IndexAtom;
    use crate::store::Store;
    use crate::value::{Value, object};

    #[test]
    fn unindexed_table_write_invalidates_table_constraint_subscription() {
        let schema = Schema {
            tables: BTreeMap::from([(
                "probes".to_owned(),
                public_table(
                    BTreeMap::from([("id".to_owned(), ColumnType::Id)]),
                    BTreeMap::new(),
                ),
            )]),
            schedules: Vec::new(),
            maintains: Vec::new(),
            channels: BTreeMap::new(),
            auth: Auth::default(),
            effects: Vec::new(),
        };
        let generation = Generation::certify(
            &ProjectJson {
                version: 1,
                schema,
                programs: Vec::new(),
                effects: Vec::new(),
                auth: Auth::default(),
            },
            Ceilings::default(),
        )
        .unwrap();
        let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
        let seq = runtime
            .seed(&[(
                "probes".to_owned(),
                object([("id", Value::Id("p1".to_owned()))]),
            )])
            .unwrap();
        let commit = runtime.store().commits_since(seq - 1, 1).unwrap().remove(0);
        assert_eq!(commit.touched.len(), 1);
        assert_eq!(commit.touched[0].table, "probes");
        assert_eq!(commit.touched[0].index, "");
        assert!(commit.touched[0].key.is_empty());

        runtime.subs.entries.insert(
            1,
            Subscription {
                op: "probe".to_owned(),
                context: Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
                last_result_digest: String::new(),
                last_seq: 0,
                trace: AuthoritativeTrace {
                    constraint_inputs: vec![ConstraintTrace {
                        table: "probes".to_owned(),
                        check: "Cap([],1)".to_owned(),
                        index: String::new(),
                        prefix: Vec::new(),
                        examined_ids: Vec::new(),
                    }],
                    ..AuthoritativeTrace::default()
                },
            },
        );
        let keys = TraceKeys::from_trace(&runtime.subs.entries[&1].trace);
        runtime.subs.add_keys(1, &keys);
        let info = runtime.subscriptions();
        assert_eq!(info.len(), 1);
        assert_eq!(
            crate::value::canonical_json(&info[0].trace),
            crate::value::canonical_json(&runtime.subs.entries[&1].trace)
        );
        assert_eq!(runtime.invalidated(&commit), vec![1]);
    }

    #[test]
    fn replacing_one_range_trace_does_bounded_lookup_work_and_prunes_prefixes() {
        let range = |prefix: &str| TraceRange {
            site: "items.byGroup".to_owned(),
            table: "items".to_owned(),
            index: "byGroup".to_owned(),
            prefix: vec![IndexAtom::Scalar(Value::Id(prefix.to_owned()))],
            order: Order::Asc,
            take: 10,
            after: None,
            before: None,
            gt: None,
            gte: None,
            lt: None,
            lte: None,
            rule_hash: String::new(),
            examined_ids: Vec::new(),
            visible_ids: Vec::new(),
            returned_ids: Vec::new(),
            stop: StopReason::Exhausted,
            absence: true,
            halo: None,
            n2_suffix: None,
        };
        let trace = |prefix: &str| AuthoritativeTrace {
            ranges: vec![range(prefix)],
            ..AuthoritativeTrace::default()
        };
        let mut subscriptions = Subscriptions::default();
        for id in 1..=1_000 {
            subscriptions.add_keys(id, &TraceKeys::from_trace(&trace(&format!("group-{id}"))));
        }
        for id in 1_001..=2_000 {
            subscriptions.add_keys(id, &TraceKeys::from_trace(&trace("shared")));
        }
        subscriptions.last_index_work = 0;
        let old = trace("group-1");
        let new = trace("moved");
        subscriptions.replace_trace(1, &old, &new);
        assert_eq!(subscriptions.last_index_work, 6);
        let groups = &subscriptions.ranges[&("items".to_owned(), "byGroup".to_owned())];
        assert!(
            !groups.contains_key(&canonical_json(&vec![IndexAtom::Scalar(Value::Id(
                "group-1".to_owned(),
            ))]))
        );
        assert_eq!(
            groups[&canonical_json(&vec![IndexAtom::Scalar(Value::Id("moved".to_owned(),))])].ids,
            BTreeSet::from([1]),
        );

        subscriptions.last_index_work = 0;
        subscriptions.replace_trace(1_001, &trace("shared"), &trace("moved-shared"));
        assert_eq!(subscriptions.last_index_work, 6);
        let groups = &subscriptions.ranges[&("items".to_owned(), "byGroup".to_owned())];
        assert_eq!(
            groups[&canonical_json(&vec![IndexAtom::Scalar(Value::Id("shared".to_owned(),))])]
                .ids
                .len(),
            999,
        );
    }
}
