//! A bounded serialized read-ahead buffer used only inside server activation.
//! Logical callers still fetch and price exactly one row at a time.
// @ref LLP 3000.002#implementation-follow-up — separate bounded raw workspace preserves logical admission.
use super::*;
use crate::{
    meter::{Ceilings, Cut, Meter},
    rows::word_heap as heap,
};
use std::{cell::RefCell, collections::VecDeque};

pub(super) type Buffer = RefCell<Option<Page>>;

pub(super) struct Page {
    table: i64,
    index: i64,
    lo: Vec<u8>,
    hi: Vec<u8>,
    rows: VecDeque<(String, Vec<u8>)>,
    /// Retain the admission for the complete buffer, including consumed slots.
    _meter: Meter,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{engine::InternalLedger, rows::Rows, value::object};

    fn fixture() -> (Store, Schema) {
        let bound = snapback4_lang::compile(&[("schema.q".into(), "table entries:\n  n: int\n  text: text <=200000\n  public\n  online only\nquery entries():\n  return entries first 20 by .n\n".into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let schema: Schema =
            serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
        let mut store = Store::memory().unwrap();
        store.install(&schema).unwrap();
        let tx = store.transaction().unwrap();
        for n in 0..96 {
            let row = object([
                ("id", Value::Id(format!("r{n:03}"))),
                ("n", Value::Int(n)),
                (
                    "text",
                    Value::String("x".repeat(if n == 40 { 150_000 } else { 100 })),
                ),
            ]);
            tx.put("entries", &schema.tables["entries"], &row, None)
                .unwrap();
        }
        tx.commit().unwrap();
        (store, schema)
    }

    #[test]
    fn activation_read_ahead_preserves_rows_cursors_and_every_logical_charge() {
        let (mut store, schema) = fixture();
        let index = schema.tables["entries"]
            .indexes
            .iter()
            .find(|(_, i)| i.columns().first().is_some_and(|c| c == "n"))
            .unwrap()
            .0;
        let mut tx = store.transaction().unwrap();
        let mut bounds = Bounds::default();
        for n in 0..=96 {
            tx.activation_scan = None;
            let mut slow = Meter::new(Ceilings::job(), Cut::Abort);
            let a = InternalLedger::with_meter(&mut slow, |meter, scope| {
                Rows::scan_metered(
                    &tx,
                    "entries",
                    index,
                    &[],
                    &bounds,
                    Dir::Asc,
                    1,
                    scope,
                    meter,
                )
            })
            .unwrap();
            tx.activation_scan = Some(Default::default());
            // Fill/reuse the page by reading the predecessor first, where there is one.
            if n > 0 {
                let before = Bounds {
                    after: Some(vec![Value::Int(n - 2), Value::Id(format!("r{:03}", n - 2))]),
                    ..Default::default()
                };
                let mut ignored = Meter::new(Ceilings::job(), Cut::Abort);
                InternalLedger::with_meter(&mut ignored, |meter, scope| {
                    Rows::scan_metered(
                        &tx,
                        "entries",
                        index,
                        &[],
                        &before,
                        Dir::Asc,
                        1,
                        scope,
                        meter,
                    )
                })
                .unwrap();
            }
            let mut fast = Meter::new(Ceilings::job(), Cut::Abort);
            let b = InternalLedger::with_meter(&mut fast, |meter, scope| {
                Rows::scan_metered(
                    &tx,
                    "entries",
                    index,
                    &[],
                    &bounds,
                    Dir::Asc,
                    1,
                    scope,
                    meter,
                )
            })
            .unwrap();
            assert_eq!(a, b, "row {n}");
            assert_eq!(slow.used, fast.used, "meter {n}");
            if let Some((_, key)) = a.last() {
                bounds.after = crate::key::decode(key);
            }
        }
    }

    #[test]
    fn activation_read_ahead_is_invalidated_by_writes_and_raw_access() {
        let (mut store, schema) = fixture();
        let mut tx = store.transaction().unwrap();
        tx.activation_scan = Some(Default::default());
        let t = tx.num("entries").unwrap();
        let ti = tx.num("entries.byId").unwrap();
        assert!(
            tx.activation_head(t, ti, &[], &[255])
                .unwrap()
                .flatten()
                .is_some()
        );
        let mut row = tx.get("entries", "r001").unwrap().unwrap();
        let old = row.clone();
        if let Value::Row(fields) = &mut row {
            fields.insert("text".into(), Value::String("changed".into()));
        }
        tx.put("entries", &schema.tables["entries"], &row, Some(&old))
            .unwrap();
        assert!(tx.activation_scan.as_ref().unwrap().borrow().is_none());
        tx.activation_head(t, ti, &[], &[255]).unwrap();
        let _ = tx.conn();
        assert!(tx.activation_scan.as_ref().unwrap().borrow().is_none());
        tx.activation_head(t, ti, &[], &[255]).unwrap();
        tx.delete("entries", &schema.tables["entries"], &row)
            .unwrap();
        assert!(tx.activation_scan.as_ref().unwrap().borrow().is_none());
    }
}

impl Tx<'_> {
    pub(super) fn clear_activation_scan(&self) {
        if let Some(buffer) = &self.activation_scan {
            buffer.borrow_mut().take();
        }
    }

    /// None means use the ordinary adapter; Some(None) proves an empty range.
    /// No Value is decoded by read-ahead, so malformed/unvisited payloads do not
    /// change a caller's result or refusal. A too-wide first row uses the old path.
    pub(super) fn activation_head(
        &self,
        t: i64,
        ti: i64,
        lo: &[u8],
        hi: &[u8],
    ) -> Result<Option<Option<(String, Vec<u8>)>>, RuntimeError> {
        let Some(buffer) = &self.activation_scan else {
            return Ok(None);
        };
        let mut held = buffer.borrow_mut();
        if let Some(page) = held.as_mut() {
            if page.table == t && page.index == ti && page.hi == hi && lo >= page.lo.as_slice() {
                while page
                    .rows
                    .front()
                    .is_some_and(|(_, key)| key.as_slice() < lo)
                {
                    page.rows.pop_front();
                }
                if let Some(row) = page.rows.pop_front() {
                    // Only forward cursors may reuse the unread tail.
                    page.lo = crate::key::upper_bound(&row.1);
                    return Ok(Some(Some(row)));
                }
            }
        }
        held.take();
        const PAGE: usize = 32;
        const BYTES: u64 = 128 * 1024;
        let mut meter = Meter::new(
            Ceilings {
                heap_bytes: BYTES,
                ..Ceilings::job()
            },
            Cut::Abort,
        );
        meter.at("adopt serialized read-ahead");
        let fixed = heap::slots::<(String, Vec<u8>)>(PAGE)
            + heap::allocation(lo.len())
            + heap::allocation(hi.len())
            // upper_bound clones then appends: reserve the old cursor, clone,
            // and the Vec growth replacement together, including capacity.
            + 4 * heap::allocation(2 * crate::rows::MAX_INDEX_KEY_BYTES + 1)
            + 2 * self.page_size;
        // An unusually large SQLite page can simply disable this optimization.
        if !meter.room(crate::error::MeterKind::HeapBytes, fixed) {
            return Ok(None);
        }
        meter.heap(fixed)?;
        let mut count = 0;
        {
            let mut statement = self.tx.prepare_cached("SELECT octet_length(r.data), length(i.k) FROM i JOIN r ON r.t = ?1 AND r.id = i.id WHERE i.ti = ?2 AND i.k >= ?3 AND i.k < ?4 ORDER BY i.k LIMIT 32")?;
            let mut rows = statement.query(params![t, ti, lo, hi])?;
            while let Some(row) = rows.next()? {
                let bytes = 3
                    * (heap::allocation(row.get::<_, i64>(0)? as usize)
                        + heap::allocation(row.get::<_, i64>(1)? as usize))
                    + 64;
                if !meter.room(crate::error::MeterKind::HeapBytes, bytes) {
                    break;
                }
                meter.heap(bytes)?;
                meter.charge(crate::error::MeterKind::Examined, 1)?;
                count += 1;
            }
        }
        if count == 0 {
            return Ok(None);
        }
        let mut page = Page {
            table: t,
            index: ti,
            lo: lo.to_vec(),
            hi: hi.to_vec(),
            rows: VecDeque::with_capacity(PAGE),
            _meter: meter,
        };
        {
            let mut statement = self.tx.prepare_cached(scan_sql(Dir::Asc))?;
            let mut rows = statement.query(params![t, ti, lo, hi, count])?;
            while let Some(row) = rows.next()? {
                page.rows.push_back((row.get(0)?, row.get(1)?));
            }
        }
        let first = page.rows.pop_front();
        if let Some((_, key)) = &first {
            page.lo = crate::key::upper_bound(key);
        }
        *held = Some(page);
        Ok(Some(first))
    }
}
