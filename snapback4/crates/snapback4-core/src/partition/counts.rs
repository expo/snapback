//! Repeated view puts in a delivery page use bounded, transaction-local certification.
use super::*;

// @ref LLP 3000.015#3 — sync certifies the current live basis, not the logged count cache.
// @ref LLP 3000.019#3.6 — the independent sync reader owns the complete read transaction.
pub(super) fn delivery_counts(reader: &mut Runner<'_>, schema: &Schema, page: &[LogEvent])
    -> Result<BTreeMap<(String, String), Option<Value>>, RuntimeError> {
    let mut certified = BTreeMap::new();
    for m in schema.maintains.iter().filter(|m| m.row_count_needs_live_basis(schema)) {
        let member = &schema.tables[&m.row_key.as_ref().unwrap().table];
        // Window selection must still precede recounting. Keep its existing path.
        if member.sync.as_ref().is_some_and(|sync| sync.horizon.is_some()) { continue; }
        let mut events = page.iter().filter(|event| event.kind == "put" && event.table == m.target).peekable();
        while events.peek().is_some() {
            reader.meter.heap(crate::rows::word_heap::slots::<Value>(256))?;
            let mut rows = Vec::with_capacity(256);
            for event in events.by_ref().take(256) {
                reader.meter.step(1 + rows.len() as u64)?;
                reader.meter.heap(crate::rows::word_heap::allocation(m.target.len() + event.id.len() + 128))?;
                // Ordinary puts all deliver the current transaction's image.
                // Several logged updates to one member need one certification.
                if certified.contains_key(&(m.target.clone(), event.id.clone()))
                    || rows.iter().any(|row: &Value| row.field("id").is_ok_and(|id| id.as_str() == Ok(event.id.as_str()))) { continue; }
                // Same authorization and declared decode reservation as an ordinary put.
                if let Some(row) = reader.metered_scan(|r, scope| r.fetch(scope, &event.table, &event.id))? {
                    rows.push(row);
                }
            }
            let images = reader.live_aggregate_batch(&m.target, &rows)?;
            for (row, image) in rows.iter().zip(images) {
                let id = row.field("id")?.as_str()?;
                reader.meter.heap(crate::rows::word_heap::allocation(m.target.len() + id.len() + 128))?;
                certified.insert((m.target.clone(), id.to_owned()), image);
            }
        }
    }
    Ok(certified)
}
