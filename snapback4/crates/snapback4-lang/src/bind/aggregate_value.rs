//! Bounded abstract values. These budgets belong only to the optional note;
//! they neither admit programs nor charge the engine's meter.
use std::{cell::Cell, collections::BTreeMap, cmp::Ordering, ops::Deref, rc::Rc};

pub(super) const AMBIENT: u8 = 1;
pub(super) const READ: u8 = 2;
pub(super) const ARGUMENT: u8 = 4;
pub(super) const UNKNOWN: u8 = 8;
pub(super) const VALUE_NODES: usize = 4096;
pub(super) const TOTAL_WORK: usize = 262_144;
const VALUE_DEPTH: usize = 128;
const ANALYSIS_DEPTH: usize = 128;

// One shared witness is enough to explain caller selection; it never grows a
// path history. Data, cardinality and control all participate in helper-cache keys.
#[derive(Clone, Default, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Control {
    pub(super) bits: u8,
    pub(super) choice: Option<Rc<(String, String)>>,
}
impl Control {
    pub(super) fn union(&self, other: &Self) -> Self {
        Self { bits: self.bits | other.bits, choice: match (&self.choice, &other.choice) {
            (Some(a), Some(b)) => Some(a.min(b).clone()),
            (a, b) => a.clone().or_else(|| b.clone()),
        } }
    }
}

#[derive(Default, Debug)]
pub(super) struct Budget {
    work: Cell<usize>,
    exhausted: Cell<bool>,
    peak: Cell<usize>,
    widened: Cell<usize>,
    depth: Cell<usize>,
}

pub(super) struct Frame(Rc<Budget>);
impl Drop for Frame { fn drop(&mut self) { self.0.depth.set(self.0.depth.get() - 1); } }

impl Budget {
    pub(super) fn enter(self: &Rc<Self>) -> Option<Frame> {
        if self.depth.get() == ANALYSIS_DEPTH { self.exhausted.set(true); }
        if !self.spend(1) { return None; }
        self.depth.set(self.depth.get() + 1);
        Some(Frame(self.clone()))
    }
    pub(super) fn spend(&self, count: usize) -> bool {
        if self.exhausted.get() || count > TOTAL_WORK - self.work.get() {
            self.exhausted.set(true);
            return false;
        }
        self.work.set(self.work.get() + count);
        true
    }
    pub(super) fn exhausted(&self) -> bool { self.exhausted.get() }
    #[cfg(test)]
    pub(super) fn stats(&self) -> (usize, usize, usize) { (self.peak.get(), self.work.get(), self.widened.get()) }
    pub(super) fn scalar(self: &Rc<Self>, data: u8) -> Value { self.make(data, data, BTreeMap::new(), None, false, Control::default()) }
    pub(super) fn literal(self: &Rc<Self>) -> Value { self.make(AMBIENT, AMBIENT, BTreeMap::new(), None, true, Control::default()) }
    pub(super) fn object(self: &Rc<Self>, data: u8, fields: BTreeMap<String, Value>) -> Value { self.make(data, AMBIENT, fields, None, false, Control::default()) }
    pub(super) fn list(self: &Rc<Self>, cardinality: u8, item: Value) -> Value { self.make(0, cardinality, BTreeMap::new(), Some(item), false, Control::default()) }
    fn make(self: &Rc<Self>, data: u8, cardinality: u8, fields: BTreeMap<String, Value>, item: Option<Value>, literal: bool, control: Control) -> Value {
        let children = || fields.values().chain(item.iter());
        let nodes = 1 + children().map(|value| value.nodes).sum::<usize>();
        let depth = 1 + children().map(|value| value.depth).max().unwrap_or(0);
        // Count expanded nodes even though the representation shares subtrees.
        // The check precedes allocating the parent, so sharing is not the bound.
        let node = if nodes > VALUE_NODES || depth > VALUE_DEPTH || !self.spend(nodes) {
            self.widened.set(self.widened.get() + 1);
            Node { control: Control::default(), data: UNKNOWN, cardinality: UNKNOWN, all: UNKNOWN, nodes: 1, depth: 1, fields: BTreeMap::new(), item: None, literal: false }
        } else {
            self.peak.set(self.peak.get().max(nodes));
            Node { control, cardinality, all: children().fold(data | if item.is_some() { cardinality } else { 0 }, |data, value| data | value.all), data, nodes, depth, fields, item, literal }
        };
        Value { node: Rc::new(node), budget: self.clone() }
    }
}

#[derive(Clone, Debug)]
pub(super) struct Value { node: Rc<Node>, budget: Rc<Budget> }
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Node {
    pub(super) data: u8,
    pub(super) cardinality: u8,
    pub(super) control: Control,
    pub(super) fields: BTreeMap<String, Value>,
    pub(super) item: Option<Value>,
    pub(super) literal: bool,
    pub(super) nodes: usize,
    depth: usize,
    all: u8,
}
impl Deref for Value { type Target = Node; fn deref(&self) -> &Node { &self.node } }
impl PartialEq for Value { fn eq(&self, other: &Self) -> bool { Rc::ptr_eq(&self.node, &other.node) || self.node == other.node } }
impl Eq for Value {}
impl PartialOrd for Value { fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) } }
impl Ord for Value { fn cmp(&self, other: &Self) -> Ordering { if Rc::ptr_eq(&self.node, &other.node) { Ordering::Equal } else { self.node.cmp(&other.node) } } }

impl Value {
    pub(super) fn all(&self) -> u8 { self.all }
    /// How many: a collection's cardinality bits (its own data bits for a scalar).
    pub(super) fn cardinality(&self) -> u8 { self.cardinality }
    pub(super) fn controls(&self) -> Control {
        // Children are bounded, but charge this traversal as well.
        if !self.budget.spend(1) { return Control { bits: UNKNOWN, choice: None }; }
        self.fields.values().chain(self.item.iter()).fold(self.control.clone(), |control, value| control.union(&value.controls()))
    }
    pub(super) fn summary(&self) -> Self { self.budget.scalar(self.all()).selected(&self.controls()) }
    pub(super) fn field(&self, name: &str) -> Self {
        self.fields.get(name).cloned().unwrap_or_else(|| self.budget.scalar(if self.data == 0 { UNKNOWN } else { self.data })).selected(&self.control)
    }
    pub(super) fn element(&self) -> Self { self.item.clone().map_or_else(|| self.clone(), |item| item.selected(&self.control)) }
    // @ref LLP 3000.007#21.8 — L28: consuming a collection consumes its cardinality separately from its item data.
    pub(super) fn consumed_element(&self) -> Self { self.element().influenced(self.cardinality) }
    pub(super) fn with_cardinality(&self, cardinality: u8) -> Self {
        self.budget.make(self.data, cardinality, self.fields.clone(), self.item.clone(), self.literal, self.control.clone())
    }
    pub(super) fn join(&self, other: &Self) -> Self { self.combine(other, false) }
    pub(super) fn widen(&self, other: &Self) -> Self { self.combine(other, true) }
    fn combine(&self, other: &Self, widen: bool) -> Self {
        if !self.budget.spend(self.nodes + other.nodes) { return self.budget.scalar(UNKNOWN); }
        if self == other { return self.clone(); }
        if widen && self.fields.is_empty() && self.item.is_none() && (!other.fields.is_empty() || other.item.is_some()) {
            return self.budget.scalar(UNKNOWN);
        }
        // A list joined with an object has no single projection semantics.
        if self.item.is_some() && !other.fields.is_empty() || other.item.is_some() && !self.fields.is_empty() {
            return self.budget.scalar(UNKNOWN);
        }
        let mut fields = BTreeMap::new();
        let missing_left = self.budget.scalar(if self.data == 0 { UNKNOWN } else { self.data });
        let missing_right = self.budget.scalar(if other.data == 0 { UNKNOWN } else { other.data });
        for (name, left) in &self.fields {
            if self.budget.exhausted() { return self.budget.scalar(UNKNOWN); }
            fields.insert(name.clone(), left.combine(other.fields.get(name).unwrap_or(&missing_right), widen));
        }
        for (name, right) in &other.fields {
            if self.budget.exhausted() { return self.budget.scalar(UNKNOWN); }
            if !self.fields.contains_key(name) { fields.insert(name.clone(), missing_left.combine(right, widen)); }
        }
        let item = match (&self.item, &other.item) {
            (None, None) => None,
            (left, right) => Some(left.as_ref().unwrap_or(&self.budget.scalar(self.data))
                .combine(right.as_ref().unwrap_or(&self.budget.scalar(other.data)), widen)),
        };
        self.budget.make(self.data | other.data, self.cardinality | other.cardinality, fields, item, self.literal && other.literal, self.control.union(&other.control))
    }
    pub(super) fn selected(&self, control: &Control) -> Self {
        if control.bits == 0 { return self.clone(); }
        // Unsupported dependence remains UNKNOWN data, even if encountered in
        // a selector: the audit did not prove how that construct uses its input.
        let value = if control.bits & UNKNOWN != 0 { self.influenced(UNKNOWN) } else { self.clone() };
        self.budget.make(value.data, value.cardinality, value.fields.clone(), value.item.clone(), value.literal, value.control.union(control))
    }
    pub(super) fn influenced(&self, data: u8) -> Self {
        if data == 0 { return self.clone(); }
        if !self.budget.spend(self.nodes) { return self.budget.scalar(UNKNOWN); }
        let fields = self.fields.iter().map(|(name, value)| (name.clone(), value.influenced(data))).collect();
        let item = self.item.as_ref().map(|value| value.influenced(data));
        self.budget.make(self.data | data, self.cardinality | data, fields, item, false, self.control.clone())
    }
}
