//! Complete source-write reservation plans. Only prices survive projection.
// @ref LLP 3000.022#14.3 — one calculation for the compiler and authoritative writer.
use super::*;
use crate::engine::row_copy_ceiling;

// steps, indexes, examined, written rows, transient heap, output, rule probes.
pub type Price = [u64; 7];
pub const COLUMNS: usize = 0;
pub const ASSETS: usize = 1;
pub const AGGREGATES: usize = 2;
pub const ROW_SOURCE: usize = 3;
pub const ROW_MEMBER: usize = 4;
pub const ALLOCATION: usize = 5;
pub const COUNTER: usize = 6;
pub const CAPTURE: usize = 7;
pub const BIRTH: usize = 8;
pub const VIEW_READ: usize = 9;
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WriteReservation {
    pub prices: [Price; 8],
    /// v2 adds owner initialization; absence identifies a legacy v1 plan.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub birth: Option<Price>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_read: Option<Price>,
    /// Data-dependent skipped work cannot be admitted from a fixed price.
    pub server_only: bool,
}
impl WriteReservation {
    pub fn price(&self, phase: usize) -> Price {
        if phase == BIRTH { self.birth.unwrap_or_default() } else if phase == VIEW_READ { self.view_read.unwrap_or_default() } else { self.prices[phase] }
    }
    #[cfg(feature = "sqlite")]
    fn is_zero(&self) -> bool {
        self.prices == [[0; 7]; 8] && self.birth.unwrap_or_default() == [0; 7]
            && self.view_read.unwrap_or_default() == [0; 7] && !self.server_only
    }
}
fn add(to: &mut Price, price: Price) {
    for (to, price) in to.iter_mut().zip(price) { *to = to.saturating_add(price); }
}
pub fn slots(kind: &ColumnType, in_list: bool) -> u64 {
    match kind {
        ColumnType::Optional(inner) => slots(inner, in_list),
        ColumnType::List { of, max } => slots(of, true).saturating_mul(u64::from(*max)),
        ColumnType::Image { .. } | ColumnType::Video { .. } if in_list => 1,
        _ => 0,
    }
}
pub fn asset_price(table: &Table) -> Price {
    let n = table.columns.values().map(|k| slots(k, false)).fold(0_u64, u64::saturating_add);
    [n.saturating_mul(8), 0, n.saturating_mul(4), n.saturating_mul(2), n.saturating_mul(16_384), 0, 0]
}
pub fn counter_price(scope: &Table) -> Price {
    let mut price = [2, 0, 0, 1, row_copy_ceiling(scope)*4, 0, 0];
    add(&mut price, asset_price(scope));
    price
}
pub fn capture_price(schema: &Schema, table: &Table) -> Price {
    let Some(through) = &table.through else { return [0;7]; };
    let parent = &schema.tables[&through.parent];
    [through.fields.len() as u64+2, 0, 1, 0,
     row_copy_ceiling(parent)*2+row_copy_ceiling(table), 0,
     crate::engine::rules::rule_probes(&parent.rules.read)+crate::engine::rules::rule_probes(&table.rules.insert)]
}
#[cfg(feature = "sqlite")]
fn row_price(schema: &Schema, m: &Maintain, recipients: u64) -> Price {
    let k = m.row_key.as_ref().unwrap();
    let target = &schema.tables[&m.target];
    let image = row_copy_ceiling(target);
    [recipients.saturating_mul(k.predicate.steps()*4 + 8),
     recipients.saturating_mul(2*target.indexes.len() as u64 + 4),
     recipients.saturating_mul(4) + 4, recipients.saturating_mul(2),
     row_copy_ceiling(&schema.tables[&k.table]).saturating_mul(4).saturating_add(image.saturating_mul(16)),
     recipients.saturating_mul(image.saturating_mul(2)), 0]
}
/// Missing references mean an unadmitted schema, never a zero price.
#[cfg(feature = "sqlite")]
pub fn reservation(schema: &Schema, source: &str) -> Option<WriteReservation> {
    let table = schema.table(source)?;
    let mut plan = WriteReservation::default();
    let mut birth = [0; 7];
    for m in schema.maintains.iter().filter(|m| m.private.as_ref().is_some_and(|owner| owner.table == source)) {
        birth[2] += 1;
        birth[4] += row_copy_ceiling(schema.table(&m.target)?);
    }
    if birth[2] != 0 { birth[4] += row_copy_ceiling(table); }
    plan.birth = Some(birth);
    if let Some(m) = schema.maintain_for(source).filter(|m| m.row_key.is_some()) {
        let live = m.row_count_needs_live_basis(schema);
        let bytes = if live {
            let certificate = [m.target.clone(), format!("$basis:{}", m.target)].iter()
                .map(|name| schema.table(name).map(crate::rows::disclosed::decode_reservation)).collect::<Option<Vec<_>>>()?.into_iter().sum::<u64>();
            certificate.max(crate::rows::disclosed::decode_reservation(schema.table(&m.source)?))
        } else { crate::rows::MAX_INDEX_KEY_BYTES as u64 * 4 };
        plan.view_read = Some([u64::from(live),0,1,0,bytes,0,0]);
    }

    plan.prices[ASSETS] = asset_price(table);
    let mut public = 0;
    for m in &schema.maintains {
        if m.source != source && !m.row_key.as_ref().is_some_and(|k| k.table == source) { continue; }
        let target = schema.table(&m.target)?;
        if let Some(k) = &m.row_key {
            schema.table(&k.table)?;
            let (phase, recipients) = if k.table == source { (ROW_MEMBER, 1) } else { (ROW_SOURCE, k.fanout.saturating_mul(2)) };
            add(&mut plan.prices[phase], row_price(schema, m, recipients));
        } else if let Some(owner) = &m.private {
            let parent = schema.table(&owner.table)?;
            let entries = parent.indexes.values().map(|index| {
                if let Some((_, fields)) = index.word_component() {
                    fields.iter().filter_map(|f| parent.columns.get(f)).map(|kind| match kind.required() {
                        ColumnType::Text { max } => u64::from(*max), _ => 0,
                    }).sum::<u64>().min(crate::words::MAX_TOKENS_PER_ROW as u64)
                } else { 1 }
            }).sum::<u64>();
            let heap = 4*entries.saturating_sub(parent.indexes.len() as u64)*(crate::rows::MAX_INDEX_KEY_BYTES as u64+24)
                + row_copy_ceiling(table)*2 + row_copy_ceiling(target)*(16+4*target.indexes.len() as u64)
                + row_copy_ceiling(parent)*(16+4*parent.indexes.len() as u64);
            add(&mut plan.prices[COLUMNS], [m.evaluation_steps()*2+8, 4*(target.indexes.len() as u64+entries), 4, 4, heap, 0, 0]);
        } else {
            public += 1;
            let evaluations = if table.indexes.contains_key(&m.contribution_index()) { 6 } else { 2 };
            add(&mut plan.prices[AGGREGATES], [m.evaluation_steps()*evaluations+4,
                target.indexes.len() as u64*4+2, 4, 2,
                row_copy_ceiling(target)*(16+4*target.indexes.len() as u64), 0, 0]);

        }
    }
    if public > 0 { plan.prices[AGGREGATES][4] += row_copy_ceiling(table)*4; }
    for f in schema.receipts.iter().filter(|f| f.messages == source) {
        let scope = schema.table(&f.scope)?;
        // The clause admits at most 50 non-expiring members. Charge the full
        // key-only allocation allowance on both hosts, not a live count.
        add(&mut plan.prices[ALLOCATION], [51, 51, 51, 0, 0, 0, 0]);
        add(&mut plan.prices[COUNTER], counter_price(scope));
        // These hooks need more than a simple, fixed counter replacement.
        // Preserve server execution; do not guess their data-dependent work.
        plan.server_only |= !simple_counter(schema, f);
    }
    plan.prices[CAPTURE] = capture_price(schema, table);
    Some(plan)
}

pub fn simple_counter(schema: &Schema, f: &ReceiptFamily) -> bool {
    let Some(scope) = schema.table(&f.scope) else { return false; };
    !(!scope.written_by.is_empty() || scope.through.is_some()
            || !scope.recorded.is_empty() || !scope.sequences.is_empty()
            || scope.indexes.values().any(|i| i.uses_column(&f.counter))
            || scope.constraints.iter().any(|c| match c {
                Constraint::Unique { .. } | Constraint::FinalExistsOnInsert { .. } | Constraint::Text { .. } => false,
                Constraint::Immutable { fields } => fields.contains(&f.counter),
                _ => true,
            })
            || schema.maintains.iter().any(|m| m.source == f.scope || m.row_key.as_ref().is_some_and(|k| k.table == f.scope))
            || schema.timelines.iter().any(|t| [&t.posts[0], &t.reposts[0], &t.edges[0], &t.authors[0]].contains(&&f.scope)))
}

impl Schema {
    pub fn prepare_write_reservations(&mut self) {
        #[cfg(feature = "sqlite")]
        self.prepare_native_reservations();
    }
    #[cfg(feature = "sqlite")]
    fn prepare_native_reservations(&mut self) {
        // Projected columns have no derivation; retain their compiler's complete
        // plan. Full schemas always rebuild, so a forged price is not authority.
        if self.validate_column_owners().is_err() { return; }
        let had_prices = !self.source_reservations.is_empty();
        self.source_reservations = self.tables.keys().filter_map(|source|
            reservation(self, source).map(|price| (source.clone(), price))).collect();
        // Preserve old zero-only store bytes and existing explicit price maps.
        if !had_prices && self.source_reservations.values().all(WriteReservation::is_zero) {
            self.source_reservations.clear();
        }
    }
    /// Export every source if any plan needs a reservation; otherwise preserve
    /// capability-free legacy bytes. Devices already prove structural zero.
    #[cfg(feature = "sqlite")]
    pub fn export_write_reservations(&mut self) {
        self.source_reservations = self.tables.keys().filter_map(|source|
            reservation(self, source).map(|price| (source.clone(), price))).collect();
        if self.source_reservations.values().all(WriteReservation::is_zero) {
            self.source_reservations.clear();
        }
    }
    pub fn write_reservation(&self, source: &str) -> Option<WriteReservation> {
        let table = self.table(source)?;
        if let Some(plan) = self.source_reservations.get(source) {
            // v1 has no owner-birth price. Do not silently interpret it as zero.
            if plan.birth.is_none() && !table.maintained.is_empty() { return None; }
            return Some(plan.clone());
        }
        // A legacy representation may prove *zero*, but a device never rebuilds
        // prices from formulas. Missing private formulas prevent that proof for
        // any source. Ordinary unrelated legacy writers remain available.
        let zero = self.tables.values().all(|t| t.maintained.is_empty())
            && table.through.is_none()
            && table.columns.values().all(|kind| slots(kind, false) == 0)
            && !self.receipts.iter().any(|f| f.messages == source)
            && !self.maintains.iter().any(|m| m.source == source
                || m.row_key.as_ref().is_some_and(|k| k.table == source));
        zero.then(|| WriteReservation { birth: Some([0;7]), ..WriteReservation::default() })
    }
    pub fn prediction_reservation_refusal(&self, program: &crate::ir::Program) -> Option<&'static str> {
        for (source, kind) in crate::ir::write_tables(program) {
            if let Some(reason) = self.write_prediction_refusal(&source) { return Some(reason); }
            if self.legacy_receipt_prediction && self.receipts.iter().any(|f|
                source == f.messages || source == f.members || source == f.runs
                || (source == f.scope && matches!(kind, "insert" | "upsert"))) {
                return Some("legacy receipt source needs the current backend before predicting");
            }
        }
        // Existing compiler read fences are retained verbatim. Hidden effect
        // slices cannot prove an unaffected footprint from their public body.
        if self.legacy_receipt_prediction && self.operations.get(&program.name).is_some_and(|f|
            !f.prediction_skips.is_empty() || !f.effect_payload_reads.is_empty()) {
            return Some("legacy hidden effect needs current compiler facts before predicting");
        }
        None
    }
    pub fn write_prediction_refusal(&self, source: &str) -> Option<&'static str> {
        match self.write_reservation(source) {
            None => Some("source write has no complete reservation price; adopt the current backend"),
            Some(plan) if plan.server_only => Some("receipt counter has additional data-dependent work; queue until settlement"),
            _ => None,
        }
    }
}

#[cfg(all(test, feature = "sqlite"))]
mod tests {
    use super::*;

    #[test]
    fn zero_plan_requires_every_phase_and_server_permission_to_be_zero() {
        let zero = WriteReservation { birth: Some([0; 7]), view_read: Some([0; 7]), ..WriteReservation::default() };
        assert!(zero.is_zero());
        assert!(WriteReservation::default().is_zero());
        for phase in 0..=VIEW_READ {
            for dimension in 0..7 {
                let mut plan = zero.clone();
                let price = match phase {
                    BIRTH => plan.birth.as_mut().unwrap(),
                    VIEW_READ => plan.view_read.as_mut().unwrap(),
                    _ => &mut plan.prices[phase],
                };
                price[dimension] = 1;
                assert!(!plan.is_zero(), "phase {phase}, dimension {dimension}");
            }
        }
        assert!(!WriteReservation { server_only: true, ..zero }.is_zero());
    }
}
