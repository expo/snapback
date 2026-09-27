//! Delivery metadata has a supplemental ledger, never the answer's meter.
// @ref LLP 3000.019#4 — the SDK reports only images delivered by the platform.
// @ref LLP 3000.022#5 — reserve stamping, origins, traversal and wire bytes independently.
use super::runner::Runner;
use crate::{
    meter::Ceilings,
    schema::DeliveryBinding,
    value::{ObjectFields, SourceIdentity, Value},
};
use serde::{Serialize, Serializer};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryMeter {
    pub steps: u64,
    pub heap_bytes: u64,
    pub output_bytes: u64,
}
#[derive(Debug, Default)]
struct Heap {
    live: AtomicU64,
    peak: AtomicU64,
}
#[derive(Debug)]
pub(crate) struct Lease {
    heap: Arc<Heap>,
    bytes: u64,
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.heap.live.fetch_sub(self.bytes, Ordering::Relaxed);
    }
}
#[derive(Debug)]
pub(crate) struct Ledger {
    limits: DeliveryMeter,
    used: DeliveryMeter,
    heap: Option<Arc<Heap>>,
    pub partial: bool,
    stamping_stopped: bool,
}
impl Ledger {
    fn new(ceilings: Ceilings) -> Self {
        Self {
            limits: DeliveryMeter {
                steps: ceilings.steps / 4,
                heap_bytes: ceilings.heap_bytes / 4,
                output_bytes: (ceilings.output_bytes / 4).max(128),
            },
            used: DeliveryMeter::default(),
            heap: None,
            partial: false,
            stamping_stopped: false,
        }
    }
    fn reserve(&mut self, steps: u64, heap: u64, output: u64) -> bool {
        let live = self
            .heap
            .as_ref()
            .map_or(0, |heap| heap.live.load(Ordering::Relaxed));
        let heap = heap.saturating_add(if heap != 0 && self.heap.is_none() {
            64
        } else {
            0
        });
        if steps > self.limits.steps.saturating_sub(self.used.steps)
            || heap > self.limits.heap_bytes.saturating_sub(live)
            || output
                > self
                    .limits
                    .output_bytes
                    .saturating_sub(self.used.output_bytes)
        {
            self.partial = true;
            self.stamping_stopped = true;
            return false;
        }
        self.used.steps += steps;
        self.used.output_bytes += output;
        if heap != 0 {
            let state = self.heap.get_or_insert_with(Arc::default);
            state.live.fetch_add(heap, Ordering::Relaxed);
            state.peak.fetch_max(live + heap, Ordering::Relaxed);
        }
        true
    }
    fn tracking(&mut self, steps: u64, heap: u64) -> bool {
        !self.stamping_stopped && self.reserve(steps, heap, 0)
    }
    fn lease(&self, bytes: u64) -> Lease {
        Lease {
            heap: self.heap.as_ref().expect("reserved metadata heap").clone(),
            bytes,
        }
    }
    fn meter(&self) -> DeliveryMeter {
        DeliveryMeter {
            heap_bytes: self
                .heap
                .as_ref()
                .map_or(0, |heap| heap.peak.load(Ordering::Relaxed)),
            ..self.used
        }
    }
}

#[derive(Debug)]
pub(crate) struct Coordinates {
    pub table: String,
    pub id: String,
    pub group: Arc<str>,
    pub position: i64,
    pub position_column: String,
    _heap: Lease,
}
#[derive(Clone, Debug)]
pub(crate) struct Origin {
    pub source: Arc<Coordinates>,
    pub column: Arc<str>,
    _heap: Arc<Lease>,
}
#[derive(Debug)]
pub(crate) struct Image {
    pub coordinates: Option<Arc<Coordinates>>,
    pub fields: BTreeMap<String, Origin>,
    _heap: Lease,
}
#[derive(Default)]
pub(super) struct Origins {
    fields: BTreeMap<String, Origin>,
    heap: Option<Lease>,
}
#[derive(Default)]
pub(super) struct Tracking {
    ledger: Option<Ledger>,
    pub last: Option<Origin>,
    index: Option<BTreeMap<String, usize>>,
    variables: BTreeMap<String, (Origin, Lease)>,
    // Removing an entry need not free its BTree node. Retain node charges
    // until the whole map is dropped; individual leases own only the names.
    variable_nodes: Option<Lease>,
}

impl Tracking {
    pub(super) fn field(&mut self, fields: &ObjectFields, name: &str) {
        self.last = None;
        if fields.delivery_image().is_none() {
            return;
        }
        if let Some(ledger) = &mut self.ledger
            && ledger.tracking(1, 0)
        {
            self.last = fields.field_origin(name);
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct Envelope {
    pub table: String,
    pub mutation: String,
    pub args: Vec<String>,
    pub fingerprint: String,
    pub rows: Vec<(String, i64)>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub partial: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Manifest {
    Partial,
    Bindings(Vec<Envelope>),
}
impl Serialize for Manifest {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Partial => s.serialize_str("partial"),
            Self::Bindings(bindings) => bindings.serialize(s),
        }
    }
}
impl<'de> serde::Deserialize<'de> for Manifest {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = Manifest;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("delivery bindings or partial")
            }
            fn visit_str<E: serde::de::Error>(self, s: &str) -> Result<Manifest, E> {
                if s == "partial" {
                    Ok(Manifest::Partial)
                } else {
                    Err(E::custom("expected partial"))
                }
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Manifest, A::Error> {
                let mut bindings = Vec::new();
                while let Some(binding) = seq.next_element()? {
                    bindings.push(binding);
                }
                Ok(Manifest::Bindings(bindings))
            }
        }
        d.deserialize_any(Visitor)
    }
}

impl ObjectFields {
    pub(crate) fn field_origin(&self, name: &str) -> Option<Origin> {
        self.delivery_image()?.fields.get(name).cloned()
    }
}
impl Runner<'_> {
    fn delivery_ledger(&mut self) -> &mut Ledger {
        self.delivery
            .ledger
            .get_or_insert_with(|| Ledger::new(self.meter.ceilings))
    }
    pub(super) fn stamp_delivery(&mut self, table: &str, row: &mut Value) {
        if self.device || self.meter.cut != crate::meter::Cut::Cap {
            return;
        }
        if !self.delivery_index() { return; }
        let cost = 1 + (self.schema.delivery.len() + 1).ilog2() as u64;
        let ledger = self.delivery_ledger();
        if ledger.stamping_stopped || !ledger.reserve(cost, 0, 0) { return; }
        let Some(&index) = self.delivery.index.as_ref().unwrap().get(table) else { return; };
        let binding = &self.schema.delivery[index];
        let (Value::Row(fields) | Value::Map(fields)) = row else {
            return;
        };
        let Some(id) = fields.get("id").and_then(|v| v.as_str().ok()) else {
            return;
        };
        let Some(group) = fields.get(&binding.group).and_then(|v| v.as_str().ok()) else {
            return;
        };
        let Some(position) = fields.get(&binding.position).and_then(|v| v.as_int().ok()) else {
            return;
        };
        if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&position) { return; }
        let ledger = self.delivery_ledger();
        let size =
            384 + (2 * table.len() + 2 * id.len() + group.len() + binding.position.len()) as u64;
        if !ledger.reserve(1, size, 0) {
            ledger.stamping_stopped = true;
            return;
        }
        let coordinate = Arc::new(Coordinates {
            table: table.into(),
            id: id.into(),
            group: group.into(),
            position,
            position_column: binding.position.clone(),
            _heap: ledger.lease(size),
        });
        let mut origins = Origins {
            fields: BTreeMap::new(),
            heap: Some(ledger.lease(0)),
        };
        for key in fields.keys() {
            if !self.delivery_ledger().tracking(1, 0) { return; }
            // Runtime flags are not stored columns; the schema includes the implicit id.
            if !self.schema.tables[table].columns.contains_key(key) {
                continue;
            }
            let nodes = crate::rows::word_heap::insertion::<String, Origin>(origins.fields.len());
            let bytes = nodes + 64 + 2 * key.len() as u64;
            let ledger = self.delivery_ledger();
            if !ledger.reserve(1, bytes, 0) {
                ledger.stamping_stopped = true;
                return;
            }
            origins.heap.as_mut().unwrap().bytes += nodes + key.len() as u64;
            origins.fields.insert(
                key.clone(),
                Origin {
                    source: coordinate.clone(),
                    column: Arc::from(key.as_str()),
                    _heap: Arc::new(ledger.lease(64 + key.len() as u64)),
                },
            );
        }
        fields.set_delivery(
            table,
            &coordinate.id,
            Image {
                coordinates: Some(coordinate.clone()),
                fields: origins.fields,
                _heap: origins.heap.unwrap(),
            },
        );
    }
    pub(super) fn delivery_field(&mut self, value: &Value, name: &str) {
        self.delivery.last = None;
        let (Value::Row(fields) | Value::Map(fields)) = value else {
            return;
        };
        if fields.delivery_image().is_none() {
            return;
        }
        if self.delivery_ledger().tracking(1, 0) {
            self.delivery.last = fields.field_origin(name);
        }
    }
    pub(super) fn delivery_variable(&mut self, name: &str) {
        self.delivery.last = None;
        if self.delivery.variables.is_empty() {
            return;
        }
        if let Some(ledger) = &mut self.delivery.ledger
            && ledger.tracking(1, 0)
        {
            self.delivery.last = self
                .delivery
                .variables
                .get(name)
                .map(|(origin, _)| origin.clone());
        }
    }
    pub(super) fn bind_delivery(&mut self, name: &str) {
        self.clear_delivery_variable(name);
        if let Some(origin) = self.delivery.last.take() {
            let nodes = crate::rows::word_heap::insertion::<String, (Origin, Lease)>(
                self.delivery.variables.len(),
            );
            let ledger = self.delivery_ledger();
            if ledger.tracking(1, nodes + name.len() as u64) {
                let lease = ledger.lease(name.len() as u64);
                let node_lease = ledger.lease(0);
                self.delivery.variable_nodes.get_or_insert(node_lease).bytes += nodes;
                self.delivery.variables.insert(name.into(), (origin, lease));
            }
        }
    }
    pub(super) fn clear_delivery_variable(&mut self, name: &str) {
        if self.delivery.variables.is_empty() { return; }
        let cost = 1 + (self.delivery.variables.len() + 1).ilog2() as u64;
        if !self.delivery_ledger().tracking(cost, 0) { return; }
        self.delivery.variables.remove(name);
        if self.delivery.variables.is_empty() {
            self.delivery.variables = BTreeMap::new();
            self.delivery.variable_nodes = None;
        }
    }
    pub(super) fn delivery_fields(
        &mut self,
        values: &BTreeMap<String, crate::ir::Expr>,
    ) -> Result<(ObjectFields, Origins), crate::RuntimeError> {
        let mut origins = Origins::default();
        let mut fields = BTreeMap::new();
        for (key, expr) in values {
            let value = self.expr(expr)?;
            self.origin_field(&mut origins, key);
            fields.insert(key.clone(), value);
        }
        Ok((fields.into(), origins))
    }
    pub(super) fn origin_field(&mut self, origins: &mut Origins, name: &str) {
        let Some(origin) = self.delivery.last.take() else {
            return;
        };
        let bytes = crate::rows::word_heap::insertion::<String, Origin>(origins.fields.len())
            + name.len() as u64;
        let ledger = self.delivery_ledger();
        if ledger.tracking(1, bytes) {
            origins.heap.get_or_insert_with(|| ledger.lease(0)).bytes += bytes;
            origins.fields.insert(name.into(), origin);
        }
    }
    pub(super) fn project_delivery(&mut self, fields: &mut ObjectFields, origins: Origins) {
        let coordinate = fields
            .source_identity()
            .and_then(|source| source.delivery.as_ref())
            .and_then(|image| image.coordinates.clone());
        let source = fields.source_identity();
        let bytes = 256 + source.map_or(0, |s| (s.table.len() + s.id.len()) as u64);
        if origins.fields.is_empty() || !self.delivery_ledger().tracking(1, bytes) {
            fields.clear_delivery();
            return;
        }
        let table = source.map_or("", |s| s.table.as_str());
        let id = source.map_or("", |s| s.id.as_str());
        let identity = SourceIdentity::with_delivery(
            table,
            id,
            Image {
                coordinates: coordinate,
                fields: origins.fields,
                _heap: {
                    let mut lease = origins.heap.unwrap();
                    lease.bytes += bytes;
                    lease
                },
            },
        );
        fields.replace_source(identity);
    }

    // Build once per query. Each insertion is reserved before looking at the
    // next binding, so many bindings cannot evade a small supplemental budget.
    fn delivery_index(&mut self) -> bool {
        if self.schema.delivery.is_empty() { return false; }
        if self.delivery_ledger().stamping_stopped { return false; }
        if self.delivery.index.is_none() {
            self.delivery.index = Some(BTreeMap::new());
            for (i, binding) in self.schema.delivery.iter().enumerate() {
                let bytes = crate::rows::word_heap::insertion::<String, usize>(i) + binding.table.len() as u64;
                if !self.delivery_ledger().reserve(1 + (i + 1).ilog2() as u64, bytes, 0) { return false; }
                self.delivery.index.as_mut().unwrap().insert(binding.table.clone(), i);
            }
        }
        true
    }

    pub(crate) fn delivery_manifest(
        &mut self,
        data: &Value,
    ) -> (Option<Manifest>, Option<DeliveryMeter>) {
        if self.device || self.query_unavailable || self.schema.delivery.is_empty() {
            return (None, None);
        }
        if !self.delivery_index() { return self.partial_manifest(); }
        let mut bindings = Vec::new();
        let mut seen = Vec::new();
        // Select by read table through the index, never by scanning all bindings
        // once per source. Reserve the final partial-flag pass with each envelope.
        for table in &self.read_tables {
            let cost = 1 + (self.schema.delivery.len() + 1).ilog2() as u64;
            let ledger = self.delivery.ledger.as_mut().unwrap();
            if !ledger.reserve(cost, 0, 0) { break; }
            let Some(&index) = self.delivery.index.as_ref().unwrap().get(table) else { continue; };
            let binding = &self.schema.delivery[index];
            if !ledger.reserve(1 + binding.table.len() as u64 + binding.mutation.len() as u64
                + binding.fingerprint.len() as u64 + binding.args.iter().map(|s| 1 + s.len() as u64).sum::<u64>(), 0, 0) { break; }
            let bytes = envelope_bytes(binding) + if bindings.is_empty() { 14 } else { 1 };
            let heap = 256 + bytes * 2
                + crate::rows::word_heap::vec_growth::<Envelope>(bindings.len() + 1)
                + crate::rows::word_heap::vec_growth::<BTreeSet<(Arc<str>, i64)>>(seen.len() + 1);
            if !ledger.reserve(2, heap, bytes) { break; }
            bindings.push(Envelope {
                table: binding.table.clone(), mutation: binding.mutation.clone(),
                args: binding.args.to_vec(), fingerprint: binding.fingerprint.clone(),
                rows: Vec::new(), partial: true,
            });
            seen.push(BTreeSet::new());
        }
        if bindings.is_empty() {
            if self.delivery_ledger().partial { return self.partial_manifest(); }
            return (None, None);
        }
        if !self.delivery_ledger().partial {
            walk(data, &mut bindings, &mut seen, self.delivery_ledger());
        }
        let ledger = self.delivery_ledger();
        if !ledger.partial {
            for binding in &mut bindings { binding.partial = false; }
        }
        (Some(Manifest::Bindings(bindings)), Some(ledger.meter()))
    }

    fn partial_manifest(&mut self) -> (Option<Manifest>, Option<DeliveryMeter>) {
        let ledger = self.delivery_ledger();
        // No bindings were emitted, so only the minimal representation is owed.
        ledger.used.output_bytes = 0;
        ledger.reserve(0, 0, 24);
        (Some(Manifest::Partial), Some(ledger.meter()))
    }

}

// JSON escaping is counted without constructing a second string or Value tree.
fn text_bytes(text: &str) -> u64 {
    2 + text
        .bytes()
        .map(|b| match b {
            b'"' | b'\\' => 2,
            0..=31 => 6,
            _ => 1,
        })
        .sum::<u64>()
}
fn envelope_bytes(binding: &DeliveryBinding) -> u64 {
    br#"{"table":,"mutation":,"args":[,,],"fingerprint":,"rows":[],"partial":true}"#.len() as u64
        + text_bytes(&binding.fingerprint)
        + text_bytes(&binding.table)
        + text_bytes(&binding.mutation)
        + binding.args.iter().map(|s| text_bytes(s)).sum::<u64>()
}
fn walk(
    data: &Value,
    bindings: &mut [Envelope],
    seen: &mut [BTreeSet<(Arc<str>, i64)>],
    ledger: &mut Ledger,
) -> bool {
    if !ledger.reserve(1, 64, 0) {
        return false;
    }
    let _frame = ledger.lease(64);
    match data {
        Value::Row(fields) | Value::Map(fields) => {
            if let Some(image) = fields.delivery_image()
                && let Some(coordinate) = &image.coordinates
            {
                let mut qualifies = false;
                for (field, origin) in &image.fields {
                    if !ledger.reserve(1, 0, 0) {
                        return false;
                    }
                    if fields.contains_key(field)
                        && origin.source.table == coordinate.table
                        && origin.source.id == coordinate.id
                        && origin.column.as_ref() != coordinate.position_column
                    {
                        qualifies = true;
                        break;
                    }
                }
                if qualifies {
                    for (binding, seen) in bindings.iter_mut().zip(seen.iter_mut()) {
                        if !ledger.reserve(1, 0, 0) {
                            return false;
                        }
                        if binding.table != coordinate.table {
                            continue;
                        }
                        // Every comparison/allocation is bounded before deduplication.
                        if !ledger.reserve(1 + (seen.len() + 1).ilog2() as u64, 0, 0) {
                            return false;
                        }
                        if seen.contains(&(coordinate.group.clone(), coordinate.position)) {
                            continue;
                        }
                        if !ledger.reserve(coordinate.group.len() as u64, 0, 0) {
                            return false;
                        }
                        let digits = if coordinate.position == 0 { 1 } else { coordinate.position.unsigned_abs().ilog10() as u64 + 1 } + u64::from(coordinate.position < 0);
                        let bytes = 3 + text_bytes(&coordinate.group) + digits + u64::from(!binding.rows.is_empty());
                        let heap =
                            crate::rows::word_heap::insertion::<(Arc<str>, i64), ()>(seen.len())
                                + crate::rows::word_heap::vec_growth::<(String, i64)>(
                                    binding.rows.len() + 1,
                                )
                                + coordinate.group.len() as u64;
                        if !ledger.reserve(1, heap, bytes) {
                            return false;
                        }
                        let pair = (coordinate.group.clone(), coordinate.position);
                        seen.insert(pair.clone());
                        binding
                            .rows
                            .push((coordinate.group.to_string(), coordinate.position));
                    }
                }
            }
            for child in fields.values() {
                if !walk(child, bindings, seen, ledger) {
                    return false;
                }
            }
        }
        Value::Array(items) => {
            for child in items {
                if !walk(child, bindings, seen, ledger) {
                    return false;
                }
            }
        }
        _ => {}
    }
    true
}
