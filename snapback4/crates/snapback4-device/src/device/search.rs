//! Internal SDK composition metadata and state fence; no query/session storage.
use super::*;

impl<S: DeviceStore> Device<S> {
    // @ref LLP 3000.028#3.3 — a continuation binds the device incarnation and membership observation.
    pub(crate) fn search_state(&mut self, name: &str, spent: Option<snapback4_core::meter::Metered>) -> Result<serde_json::Value, RuntimeError> {
        let Some(plan) = self.schema.operations.get(name).and_then(|fact| fact.search.as_ref()) else { return Ok(serde_json::Value::Null) };
        let tx = self.store.read_transaction()?;
        store_identity::require_owner(&tx, &self.backend_identity, &self.store_identity, self.native_digest.as_deref())?;
        let mut meter = snapback4_core::meter::Meter::resume(Ceilings::default(), spent.unwrap_or_default())?;
        meter.heap(8192)?;
        meter.step(32)?;
        let capture = store_identity::adoption_capture(&tx)?;
        let epoch = snapback4_core::value::digest(&capture);
        let raw = tx.meta(history::GROUPS)?.unwrap_or_else(|| "{}".into());
        // The store supplies bytes; prepay typed retained-state decoding and
        // traversal before allocating a Groups map, on the same page ledger.
        meter.heap(128 + raw.len() as u64 * 32)?;
        meter.step(raw.len() as u64 + 1)?;
        let groups: history::Groups = decoded(&raw)?;
        let left: Vec<_> = groups.get(&plan.table).into_iter().flat_map(|groups| groups.iter())
            .filter(|(_, state)| **state == history::Membership::Left).map(|(key, _)| key.clone()).collect();
        let kind = snapback4_core::MeterKind::OutputBytes;
        if !meter.charge(kind, 8192 + raw.len() as u64 * 6)? {
            return Err(RuntimeError::Bound { kind, actual: meter.used.output_bytes,
                ceiling: meter.ceilings.output_bytes, site: "ordinary search state".into() });
        }
        tx.rollback()?;
        Ok(serde_json::json!({ "plan": plan, "epoch": epoch, "left": left, "retained": !left.is_empty(), "metered": meter.used, "ceilings": Ceilings::default() }))
    }
}
