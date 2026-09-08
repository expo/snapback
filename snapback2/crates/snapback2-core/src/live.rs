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

type SubscriptionRefs = BTreeMap<SubscriptionId, usize>;

/// Scalar components form the path. A range ending at this node is in
/// `terminal`; every range at or below it is refcounted in `subtree` so a
/// scope touch can select descendants without scanning unrelated prefixes.
#[derive(Default)]
struct RangePrefixNode {
    children: BTreeMap<String, RangePrefixNode>,
    terminal: SubscriptionRefs,
    subtree: SubscriptionRefs,
}

fn increment_ref(ids: &mut SubscriptionRefs, id: SubscriptionId) {
    *ids.entry(id).or_default() += 1;
}

fn decrement_ref(ids: &mut SubscriptionRefs, id: SubscriptionId) {
    let Some(count) = ids.get_mut(&id) else {
        return;
    };
    if *count == 1 {
        ids.remove(&id);
    } else {
        *count -= 1;
    }
}

fn scalar_prefix_path(prefix: &[crate::search_key::IndexAtom]) -> (Vec<String>, bool) {
    let path = prefix
        .iter()
        .take_while(|atom| matches!(atom, crate::search_key::IndexAtom::Scalar(_)))
        .map(|atom| match atom {
            crate::search_key::IndexAtom::Scalar(value) => canonical_json(value),
            crate::search_key::IndexAtom::WordPrefix(_) => unreachable!(),
        })
        .collect::<Vec<_>>();
    let fully_scalar = path.len() == prefix.len();
    (path, fully_scalar)
}

impl RangePrefixNode {
    fn add(&mut self, id: SubscriptionId, prefix: &[crate::search_key::IndexAtom]) -> usize {
        let (path, fully_scalar) = scalar_prefix_path(prefix);
        self.add_path(id, &path, fully_scalar)
    }

    fn add_path(&mut self, id: SubscriptionId, path: &[String], fully_scalar: bool) -> usize {
        increment_ref(&mut self.subtree, id);
        if let Some((head, tail)) = path.split_first() {
            2 + self
                .children
                .entry(head.clone())
                .or_default()
                .add_path(id, tail, fully_scalar)
        } else {
            if fully_scalar {
                increment_ref(&mut self.terminal, id);
                2
            } else {
                1
            }
        }
    }

    fn remove(&mut self, id: SubscriptionId, prefix: &[crate::search_key::IndexAtom]) -> usize {
        let (path, fully_scalar) = scalar_prefix_path(prefix);
        self.remove_path(id, &path, fully_scalar)
    }

    fn remove_path(&mut self, id: SubscriptionId, path: &[String], fully_scalar: bool) -> usize {
        decrement_ref(&mut self.subtree, id);
        let Some((head, tail)) = path.split_first() else {
            if fully_scalar {
                decrement_ref(&mut self.terminal, id);
                return 2;
            }
            return 1;
        };
        let Some(child) = self.children.get_mut(head) else {
            return 2;
        };
        let mut work = 2 + child.remove_path(id, tail, fully_scalar);
        if child.is_empty() {
            self.children.remove(head);
            work += 1;
        }
        work
    }

    fn is_empty(&self) -> bool {
        self.children.is_empty() && self.terminal.is_empty() && self.subtree.is_empty()
    }

    /// Exact scalar touches select only range prefixes that end on ancestors.
    fn scalar_ancestors(
        &self,
        key: &[Value],
        ids: &mut BTreeSet<SubscriptionId>,
    ) -> (usize, usize) {
        let mut node = self;
        let mut visits = 1;
        let mut bucket_refs = node.terminal.len();
        ids.extend(node.terminal.keys());
        for value in key {
            let Some(child) = node.children.get(&canonical_json(value)) else {
                break;
            };
            node = child;
            visits += 1;
            bucket_refs += node.terminal.len();
            ids.extend(node.terminal.keys());
        }
        (visits, bucket_refs)
    }

    /// Scope touches select scalar-prefix ancestors plus every range below the
    /// exact scope, including all WordPrefix terms rooted there.
    fn scope_intersections(
        &self,
        scope: &[Value],
        ids: &mut BTreeSet<SubscriptionId>,
    ) -> (usize, usize) {
        let mut node = self;
        let mut visits = 1;
        let mut bucket_refs = 0;
        for value in scope {
            bucket_refs += node.terminal.len();
            ids.extend(node.terminal.keys());
            let Some(child) = node.children.get(&canonical_json(value)) else {
                return (visits, bucket_refs);
            };
            node = child;
            visits += 1;
        }
        bucket_refs += node.subtree.len();
        ids.extend(node.subtree.keys());
        (visits, bucket_refs)
    }
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
    ranges: BTreeMap<TraceIndex, RangePrefixNode>,
    exact: BTreeMap<ExactTraceKey, BTreeSet<SubscriptionId>>,
    constraints: BTreeMap<String, BTreeSet<SubscriptionId>>,
    #[cfg(test)]
    last_index_work: usize,
    #[cfg(test)]
    last_invalidation_prefix_visits: std::cell::Cell<usize>,
    #[cfg(test)]
    last_invalidation_bucket_refs: std::cell::Cell<usize>,
}

impl Subscriptions {
    fn add_keys(&mut self, id: SubscriptionId, keys: &TraceKeys) {
        for ((table, index, _), prefix) in &keys.ranges {
            let work = self
                .ranges
                .entry((table.clone(), index.clone()))
                .or_default()
                .add(id, prefix);
            #[cfg(test)]
            {
                self.last_index_work += work;
            }
            #[cfg(not(test))]
            let _ = work;
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
        for ((table, index, _), prefix) in &keys.ranges {
            let index_key = (table.clone(), index.clone());
            let mut remove_index = false;
            if let Some(root) = self.ranges.get_mut(&index_key) {
                let work = root.remove(id, prefix);
                #[cfg(test)]
                {
                    self.last_index_work += work;
                }
                #[cfg(not(test))]
                let _ = work;
                remove_index = root.is_empty();
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

    fn invalidated(&self, commit: &CommitRecord) -> Vec<SubscriptionId> {
        let mut invalidated = BTreeSet::new();
        let mut prefix_visits = 0;
        let mut bucket_refs = 0;
        for touched in &commit.touched {
            if let Some(ranges) = self
                .ranges
                .get(&(touched.table.clone(), touched.index.clone()))
            {
                let work = ranges.scalar_ancestors(&touched.key, &mut invalidated);
                prefix_visits += work.0;
                bucket_refs += work.1;
            }
            if let Some(ids) = self.exact.get(&(
                touched.table.clone(),
                touched.index.clone(),
                canonical_json(&touched.key),
            )) {
                invalidated.extend(ids);
            }
            if let Some(ids) = self.constraints.get(&touched.table) {
                invalidated.extend(ids);
            }
        }
        for touch in &commit.scope_touches {
            if let Some(ranges) = self.ranges.get(&(touch.table.clone(), touch.index.clone())) {
                let work = ranges.scope_intersections(&touch.prefix, &mut invalidated);
                prefix_visits += work.0;
                bucket_refs += work.1;
            }
            if let Some(ids) = self.constraints.get(&touch.table) {
                invalidated.extend(ids);
            }
        }
        #[cfg(test)]
        self.last_invalidation_prefix_visits.set(prefix_visits);
        #[cfg(test)]
        self.last_invalidation_bucket_refs.set(bucket_refs);
        #[cfg(not(test))]
        let _ = (prefix_visits, bucket_refs);
        invalidated.into_iter().collect()
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
        self.subs.invalidated(commit)
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
    use crate::ir::{Expr, KeyProvenance, Order, Program, Read, Stmt};
    use crate::registry::{Generation, ProjectJson};
    use crate::schema::{Auth, ColumnType, Index, Schema, public_table};
    use crate::search_key::{IndexAtom, IndexComponent, SearchContract, WordPrefix};
    use crate::store::{ScopeTouch, Store, TouchedKey};
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
        assert_eq!(subscriptions.last_index_work, 9);
        let root = &subscriptions.ranges[&("items".to_owned(), "byGroup".to_owned())];
        assert!(
            !root
                .children
                .contains_key(&canonical_json(&Value::Id("group-1".to_owned(),)))
        );
        assert_eq!(
            root.children[&canonical_json(&Value::Id("moved".to_owned()))].terminal,
            BTreeMap::from([(1, 1)]),
        );

        subscriptions.last_index_work = 0;
        subscriptions.replace_trace(1_001, &trace("shared"), &trace("moved-shared"));
        assert_eq!(subscriptions.last_index_work, 8);
        let root = &subscriptions.ranges[&("items".to_owned(), "byGroup".to_owned())];
        assert_eq!(
            root.children[&canonical_json(&Value::Id("shared".to_owned()))]
                .terminal
                .len(),
            999,
        );
    }

    fn add_range(subscriptions: &mut Subscriptions, id: SubscriptionId, prefix: Vec<IndexAtom>) {
        subscriptions.add_keys(
            id,
            &TraceKeys {
                ranges: BTreeMap::from([(
                    (
                        "items".to_owned(),
                        "byGroup".to_owned(),
                        canonical_json(&prefix),
                    ),
                    prefix,
                )]),
                ..TraceKeys::default()
            },
        );
    }

    fn remove_range(subscriptions: &mut Subscriptions, id: SubscriptionId, prefix: Vec<IndexAtom>) {
        subscriptions.remove_keys(
            id,
            &TraceKeys {
                ranges: BTreeMap::from([(
                    (
                        "items".to_owned(),
                        "byGroup".to_owned(),
                        canonical_json(&prefix),
                    ),
                    prefix,
                )]),
                ..TraceKeys::default()
            },
        );
    }

    fn word(source: &str) -> IndexAtom {
        IndexAtom::WordPrefix(WordPrefix {
            contract: SearchContract::Unicode17,
            source: source.to_owned(),
        })
    }

    #[test]
    fn range_prefix_trie_matches_scalar_and_scope_oracles() {
        let prefixes = vec![
            (1, vec![]),
            (2, vec![IndexAtom::Scalar(Value::Id("g".to_owned()))]),
            (
                3,
                vec![
                    IndexAtom::Scalar(Value::Id("g".to_owned())),
                    IndexAtom::Scalar(Value::String("x".to_owned())),
                ],
            ),
            (4, vec![IndexAtom::Scalar(Value::String("g".to_owned()))]),
            (
                5,
                vec![IndexAtom::Scalar(Value::Id("g".to_owned())), word("ca")],
            ),
            (
                6,
                vec![
                    IndexAtom::Scalar(Value::Id("g".to_owned())),
                    IndexAtom::Scalar(Value::String("x".to_owned())),
                    word("dog"),
                ],
            ),
            (7, vec![IndexAtom::Scalar(Value::Id("other".to_owned()))]),
            (8, vec![word("root")]),
        ];
        let mut subscriptions = Subscriptions::default();
        for (id, prefix) in &prefixes {
            add_range(&mut subscriptions, *id, prefix.clone());
        }
        let root = &subscriptions.ranges[&("items".to_owned(), "byGroup".to_owned())];

        for key in [
            vec![],
            vec![Value::Id("g".to_owned())],
            vec![Value::Id("g".to_owned()), Value::String("x".to_owned())],
            vec![Value::String("g".to_owned())],
        ] {
            let expected = prefixes
                .iter()
                .filter(|(_, prefix)| crate::search_key::scalar_key_starts_with(&key, prefix))
                .map(|(id, _)| *id)
                .collect::<BTreeSet<_>>();
            let mut actual = BTreeSet::new();
            root.scalar_ancestors(&key, &mut actual);
            assert_eq!(actual, expected, "scalar key {key:?}");
        }

        for scope in [
            vec![],
            vec![Value::Id("g".to_owned())],
            vec![Value::Id("g".to_owned()), Value::String("x".to_owned())],
            vec![
                Value::Id("g".to_owned()),
                Value::String("x".to_owned()),
                Value::String("longer".to_owned()),
            ],
            vec![Value::String("g".to_owned())],
        ] {
            let expected = prefixes
                .iter()
                .filter(|(_, prefix)| crate::search_key::scope_intersects(&scope, prefix))
                .map(|(id, _)| *id)
                .collect::<BTreeSet<_>>();
            let mut actual = BTreeSet::new();
            root.scope_intersections(&scope, &mut actual);
            assert_eq!(actual, expected, "scope {scope:?}");
        }
    }

    #[test]
    fn range_prefix_trie_refcounts_multiple_search_terms_and_prunes() {
        let scope = IndexAtom::Scalar(Value::Id("g".to_owned()));
        let cafe = vec![scope.clone(), word("cafe")];
        let dog = vec![scope, word("dog")];
        let mut subscriptions = Subscriptions::default();
        add_range(&mut subscriptions, 1, cafe.clone());
        add_range(&mut subscriptions, 1, dog.clone());

        let mut actual = BTreeSet::new();
        subscriptions.ranges[&("items".to_owned(), "byGroup".to_owned())]
            .scope_intersections(&[Value::Id("g".to_owned())], &mut actual);
        assert_eq!(actual, BTreeSet::from([1]));

        remove_range(&mut subscriptions, 1, cafe);
        let mut actual = BTreeSet::new();
        subscriptions.ranges[&("items".to_owned(), "byGroup".to_owned())]
            .scope_intersections(&[Value::Id("g".to_owned())], &mut actual);
        assert_eq!(actual, BTreeSet::from([1]));

        remove_range(&mut subscriptions, 1, dog);
        assert!(subscriptions.ranges.is_empty());
    }

    fn commit_with(touched: Vec<TouchedKey>, scope_touches: Vec<ScopeTouch>) -> CommitRecord {
        CommitRecord {
            seq: 1,
            at: 0,
            program: "test".to_owned(),
            principal: "test".to_owned(),
            kind: "mutation".to_owned(),
            by: None,
            job: None,
            job_chunk: None,
            schedule: None,
            touched,
            scope_touches,
            writes: BTreeMap::new(),
            emits: 0,
        }
    }

    #[test]
    fn invalidation_prefix_work_varies_with_affected_not_total_groups() {
        for search in [false, true] {
            for total in [200, 2_000] {
                let mut subscriptions = Subscriptions::default();
                for id in 1..=total {
                    let mut prefix = vec![IndexAtom::Scalar(Value::Id(format!("group-{id}")))];
                    if search {
                        prefix.push(word(&format!("term-{id}")));
                    }
                    add_range(&mut subscriptions, id as u64, prefix);
                }
                for affected in [1, 50] {
                    let touched = (!search)
                        .then(|| {
                            (1..=affected)
                                .map(|id| TouchedKey {
                                    table: "items".to_owned(),
                                    index: "byGroup".to_owned(),
                                    key: vec![
                                        Value::Id(format!("group-{id}")),
                                        Value::Id(format!("row-{id}")),
                                    ],
                                    row_id: format!("row-{id}"),
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let scope_touches = search
                        .then(|| {
                            (1..=affected)
                                .map(|id| ScopeTouch {
                                    table: "items".to_owned(),
                                    index: "byGroup".to_owned(),
                                    prefix: vec![Value::Id(format!("group-{id}"))],
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let actual = subscriptions.invalidated(&commit_with(touched, scope_touches));
                    assert_eq!(actual, (1..=affected as u64).collect::<Vec<_>>());
                    assert_eq!(
                        subscriptions.last_invalidation_prefix_visits.get(),
                        affected * 2,
                        "search={search} total={total} affected={affected}",
                    );
                    assert_eq!(
                        subscriptions.last_invalidation_bucket_refs.get(),
                        affected,
                        "search={search} total={total} affected={affected}",
                    );
                }
            }
        }
    }

    #[test]
    fn rerun_latency_varies_total_subscriptions_and_affected_batch_independently() {
        let schema = Schema {
            tables: BTreeMap::from([(
                "items".to_owned(),
                public_table(
                    BTreeMap::from([("id".to_owned(), ColumnType::Id)]),
                    BTreeMap::from([(
                        "byId".to_owned(),
                        Index {
                            components: vec![IndexComponent::Column("id".to_owned())],
                            unique: true,
                        },
                    )]),
                ),
            )]),
            ..Schema::default()
        };
        let query = Program {
            name: "items.one".to_owned(),
            kind: ProgramKind::Query,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![Stmt::Return(Expr::Get(Read {
                site: "items.one".to_owned(),
                table: "items".to_owned(),
                index: "byId".to_owned(),
                key: vec![Expr::Literal(Value::Id("one".to_owned()))],
                provenance: KeyProvenance::Const,
            }))],
        };
        let generation = Generation::certify(
            &ProjectJson {
                version: 1,
                schema,
                programs: vec![query],
                effects: Vec::new(),
                auth: Auth::default(),
            },
            Ceilings::default(),
        )
        .unwrap();
        let repeats = 25;
        for total in [200, 2_000] {
            let mut runtime = Runtime::open(Store::memory().unwrap(), generation.clone()).unwrap();
            runtime
                .seed(&[(
                    "items".to_owned(),
                    object([("id", Value::Id("one".to_owned()))]),
                )])
                .unwrap();
            let mut ids = Vec::with_capacity(total);
            for _ in 0..total {
                ids.push(
                    runtime
                        .subscribe(
                            "items.one",
                            Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
                        )
                        .unwrap()
                        .0,
                );
            }
            for affected in [1, 50] {
                let batch = &ids[..affected];
                let started = std::time::Instant::now();
                let mut deliveries = 0;
                for _ in 0..repeats {
                    deliveries += runtime.rerun(batch).len();
                }
                let elapsed = started.elapsed();
                std::hint::black_box(deliveries);
                assert_eq!(deliveries, affected * repeats);
                assert_eq!(runtime.subs.last_index_work, 0);
                println!(
                    "RERUN_LATENCY total={total} affected={affected} repeats={repeats} elapsed_ns={} per_batch_ns={}",
                    elapsed.as_nanos(),
                    elapsed.as_nanos() / repeats as u128,
                );
            }
        }
    }
}
