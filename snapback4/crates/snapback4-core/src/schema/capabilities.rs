//! One wire fence for engine semantics an older decoder must not ignore.
//! Constraint is strictly parsed by 0.2.33, unlike Schema's optional fields.
use super::*;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::BTreeSet;

// Private remote derive: the schema has one wire field list, and callers
// cannot accidentally invoke an unchecked inherent Schema::deserialize.
#[derive(Serialize, Deserialize)]
#[serde(remote = "Schema")]
struct Wire {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    receipts: Vec<ReceiptFamily>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    receipt_dependencies: BTreeMap<String, BTreeSet<String>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    source_reservations: BTreeMap<String, reservations::WriteReservation>,
    #[serde(skip)]
    legacy_receipt_prediction: bool,
    tables: BTreeMap<String, Table>,
    #[cfg(feature = "sqlite")]
    #[serde(skip)]
    authored_indexes: inspection::AuthoredIndexes,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    delivery: Vec<DeliveryBinding>,
    #[cfg(feature = "sqlite")]
    #[serde(skip)]
    delivery_lookup: crate::engine::delivery::Lookup,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    timelines: Vec<timeline::Timeline>,
    #[serde(default)]
    maintains: Vec<Maintain>,
    #[serde(default, skip_serializing_if = "Auth::is_default")]
    auth: Auth,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    effects: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    schedules: Vec<Schedule>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    operations: BTreeMap<String, Execution>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    unique_refusals: BTreeMap<String, BTreeMap<String, UniqueRefusal>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    action_specs: BTreeMap<String, ActionSpec>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    effect_specs: BTreeMap<String, WorkSpec>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    routes: BTreeMap<String, RouteSpec>,
}

// Add a capability and its schema predicate here in one line. This is both
// the derivation and the decoder's allowlist; authors never declare it.
const CAPABILITIES: &[(&str, fn(&Schema) -> bool)] = &[
    ("source-write-reservations-v2", |s| s.source_reservations.values().any(|p| p.birth.is_some())),
    ("source-write-reservations-v1", |s| !s.source_reservations.is_empty()),
    // @ref LLP 3000.022#14.3 — older devices must not execute newly eligible
    // writes using their receipt-derived maintenance path.
    ("receipt-derived-prediction-v1", |s| s.maintains.iter().any(|m| s.receipt_dependencies.contains_key(&m.target))
        || s.has_receipt_columns()),
    ("rule-reference-v2", |s| s.tables.values().any(|t|
        [&t.rules.insert, &t.rules.update, &t.rules.delete].iter().any(|r| r.any_term(&|term| matches!(term, RuleTerm::ReferenceChain { .. })))
        || t.constraints.iter().any(|c| matches!(c, Constraint::FinalExistsOnInsert { key, .. } if key.iter().any(|term| term.reference_source().is_some()))))),
    ("rule-reference", |s| s.tables.values().any(|t| [&t.rules.insert, &t.rules.update, &t.rules.delete].iter().any(|r| r.has_reference()))),
    ("declarative-receipts-v4", |s| !s.receipts.is_empty()),
    ("owner-key-coverage", |s| s.maintains.iter().any(|m| m.own_keys.is_some())),
    ("ephemeral", |s| s.tables.values().any(|t| t.ephemeral.is_some())),
    ("field-authority", |s| s.tables.values().any(|t| !t.written_by.is_empty() || t.update_transition)),
    // @ref LLP 3000.036#11 — an older decoder refuses ordered insert rules rather than misjudging them.
    ("insert-rule-order", |s| s.tables.values().any(|t| ordered(&t.rules.insert))),
    // @ref LLP 3000.036#12 — a decoder that orders only int/time in insert rules refuses a money or decimal order by name.
    ("insert-rule-order-units", |s| s.tables.values().any(|t| ordered_units(t, &t.rules.insert))),
    ("row-keyed-view", |s| s.maintains.iter().any(|m|m.row_key.is_some())),
    // @ref LLP 3000.039#8 — an older engine or device must not delete with the old (orphaning) semantics.
    ("reference-actions", |s| s.tables.values().any(|t| !t.on_delete.is_empty())),
    ("read-through", |s| s.tables.values().any(|t| t.through.is_some()) || s.maintains.iter().any(|m| m.parent_key.is_some() || !m.aliases.is_empty())),
    // Device projections keep column metadata but omit private maintains.
    ("maintained-column", |s| s.tables.values().any(|t| !t.maintained.is_empty()) || s.maintains.iter().any(|m| m.private.is_some())),
    ("recorded-attribution", |s| s.tables.values().any(|t| !t.recorded.is_empty())),
    ("sequence-by", |s| s.tables.values().any(|t| !t.sequences.is_empty())),
    // @ref LLP 3000.040#4-fences-and-compatibility — an older decoder names the bounded int it cannot check.
    ("int-range", |s| s.tables.values().any(|t| t.columns.values().any(int_range))),
    // @ref LLP 3000.040#4-fences-and-compatibility — civil keys and calendar schedules.
    ("calendar-month", |s| s.tables.values().any(|t| t.indexes.values().any(|i| i.components.iter().any(|c| matches!(c, IndexComponent::Calendar(key) if key.civil()))))
        || s.maintains.iter().any(|m| m.computed.values().any(|key| key.civil()))),
    ("calendar-schedule", |s| s.schedules.iter().any(|schedule| schedule.months > 0)),
    ("timeline", |s| s.timelines.iter().any(|t| t.version == 1)),
    ("timeline-v2", |s| s.timelines.iter().any(|t| t.version == 2)),
    // @ref LLP 3000.036.001#3 — an older device would page a merged plan as an eager merge and refuse its server cursors; it refuses the backend by name.
    ("branch-merge-v1", |s| s.operations.values().any(|o| o.branch_merge)),
    ("branch-membership-v1", |s| s.operations.values().any(|o| o.branch_membership)),
    // @ref LLP 3000.036.001#15 — v2 fences metered uncapped discovery and row-id point lanes from v1 devices.
    ("branch-pages-v2", |s| s.operations.values().any(|o| o.branch_pages_v2)),
    ("branch-pages-v3", |s| s.operations.values().any(|o| o.branch_pages_v3)),
    ("branch-membership-v2", |s| s.operations.values().any(|o| o.branch_membership_v2)),
    // Source slots alter negative coverage, prediction and application row projection.
    ("timeline-event-slots", |s| s.tables.values().any(|t| t.columns.keys().any(|field| timeline::is_slot(field)))),
    // @ref LLP 3000.036.000.000#2.3 — a decoder that ignored `also` would hold only the first arm and lose rows.
    ("union-audience", |s| s.tables.values().any(|t| t.sync.as_ref().is_some_and(Sync::is_union))),
    ("time-audiences-v1", |s| s.tables.values().any(|t| t.not_before.is_some())),
];

fn int_range(kind: &ColumnType) -> bool {
    match kind {
        ColumnType::IntRange { .. } => true,
        ColumnType::Optional(inner) | ColumnType::List { of: inner, .. } | ColumnType::ListRange { of: inner, .. } => int_range(inner),
        _ => false,
    }
}

fn ordered_units(table: &Table, rule: &RuleExpr) -> bool {
    let units = |term: &RuleTerm| matches!(term, RuleTerm::Field(f) if matches!(table.columns.get(f), Some(ColumnType::Decimal { .. } | ColumnType::Money { .. })));
    match rule {
        RuleExpr::Compare(_, l, r) => units(l) || units(r),
        RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().any(|item| ordered_units(table, item)),
        RuleExpr::Not(inner) => ordered_units(table, inner),
        _ => false,
    }
}

fn ordered(rule: &RuleExpr) -> bool {
    match rule {
        RuleExpr::Compare(..) => true,
        RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().any(ordered),
        RuleExpr::Not(inner) => ordered(inner),
        _ => false,
    }
}

impl Schema {
    pub fn supported_capabilities() -> Vec<String> { CAPABILITIES.iter().map(|(name, _)| (*name).into()).collect() }
    fn has_receipt_columns(&self) -> bool {
        self.tables.iter().any(|(name, table)| table.maintained.keys().any(|field|
            self.receipt_dependencies.get(name).is_some_and(|fields| fields.contains(field))))
    }
    pub fn required_capabilities(&self) -> BTreeSet<String> {
        CAPABILITIES.iter().filter(|(_, needs)| needs(self)).map(|(name, _)| (*name).into()).collect()
    }
}

impl Serialize for Schema {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let required = self.required_capabilities();
        // The derive's field order, omissions and bytes are unchanged for
        // ordinary schemas, including the serialized conformance corpus.
        if required.is_empty() { return Wire::serialize(self, serializer); }
        let mut wire = self.clone();
        for table in wire.tables.values_mut() {
            table.constraints.retain(|c| !matches!(c, Constraint::Recorded));
        }
        let mut carrier = wire.tables.first_entry().ok_or_else(||
            serde::ser::Error::custom("E_SCHEMA_CAPABILITY: required capabilities need a table carrier"))?;
        carrier.get_mut().constraints.push(Constraint::Capabilities(required));
        Wire::serialize(&wire, serializer)
    }
}

impl<'de> Deserialize<'de> for Schema {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // The private remote derive uses the ordinary
        // streaming serde codec. No JSON-value or content-buffer replay.
        let mut schema = Wire::deserialize(deserializer)?;
        let mut declared = BTreeSet::new();
        let mut carriers = 0;
        let mut legacy = false;
        for table in schema.tables.values_mut() {
            let mut recorded = 0;
            table.constraints.retain(|constraint| {
                if let Constraint::Capabilities(names) = constraint {
                    carriers += 1;
                    declared.extend(names.iter().cloned());
                    false
                } else if matches!(constraint, Constraint::Recorded) {
                    recorded += 1;
                    false
                } else { true }
            });
            if recorded > 1 || (recorded != 0 && table.recorded.is_empty()) {
                return Err(serde::de::Error::custom("E_SCHEMA_CAPABILITY: invalid legacy Recorded marker"));
            }
            if recorded != 0 { legacy = true; declared.insert("recorded-attribution".into()); }
        }
        for name in &declared {
            if !CAPABILITIES.iter().any(|(known, _)| name == known) {
                return Err(serde::de::Error::custom(format!("E_SCHEMA_CAPABILITY: unsupported engine capability {name}; upgrade the engine/device")));
            }
        }
        let mut required = schema.required_capabilities();
        // @ref LLP 3000.022#14.3 — RY already serialized the dependency closure.
        // RP stamps every emitted schema so old devices refuse its new prediction
        // facts, but an RP reader must still open RY's kept backend/database.
        // All other capabilities and the carrier shape remain exact.
        let legacy_receipt_prediction = !declared.contains("receipt-derived-prediction-v1")
            && required.remove("receipt-derived-prediction-v1");
        // The price carrier can be absent in an old projection. Missing prices
        // are fenced per program, rather than bricking a kept store.
        for cap in ["source-write-reservations-v1", "source-write-reservations-v2"] {
            if declared.contains(cap) { required.insert(cap.into()); }
            else { required.remove(cap); }
        }
        // Before the shared fence, the binder emitted Recorded on F2 tables
        // even when the same schema also declared timelines. Only that legacy
        // representation infers its full requirements; modern carriers remain
        // exact, including when mixed with a legacy marker.
        if legacy && carriers == 0 {
            // A legacy marker only covers the capabilities that predate the fence.
            // New semantics must never inherit permission from this escape hatch.
            declared = required.iter().filter(|name| matches!(name.as_str(),
                "maintained-column" | "recorded-attribution" | "timeline" | "timeline-v2")).cloned().collect();
        }
        if declared != required || carriers + usize::from(legacy) != usize::from(!required.is_empty()) {
            return Err(serde::de::Error::custom(format!("E_SCHEMA_CAPABILITY: schema requires {required:?}, but declares {declared:?} in {carriers} carriers")));
        }
        let had_prices = !schema.source_reservations.is_empty();
        schema.prepare_receipt_dependencies();
        // Opening an old blob preserves its wire shape. Complete visible
        // declarations can still price a write on demand; hidden ones cannot.
        if !had_prices { schema.source_reservations.clear(); }
        schema.legacy_receipt_prediction = legacy_receipt_prediction
            || (!declared.contains("source-write-reservations-v1") && !schema.receipts.is_empty());
        Ok(schema)
    }
}
