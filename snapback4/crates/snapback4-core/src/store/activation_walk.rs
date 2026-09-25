//! Preflight activation pages before owning their serialized row images.
use super::*;
use crate::{error::MeterKind, meter::{Ceilings, Cut, Meter}, rows::{adoption, word_heap as heap}};

pub(super) fn walk(tx: &Tx<'_>, table: i64, mut visit: impl FnMut(&str, Value) -> Result<(), RuntimeError>) -> Result<(), RuntimeError> {
    walk_metered(tx, table, adoption::Work::DECODE, |_| 0, |id, row, _| visit(id, row))
}

// @ref LLP 3000.007#20.24.1 — reserve stored bytes before fetching or decoding; page scratch stays live until consumed.
pub(super) fn walk_metered(tx: &Tx<'_>, table: i64, work: adoption::Work, scratch: impl Fn(&Value) -> u64,
    mut visit: impl FnMut(&str, Value, &mut Meter) -> Result<(), RuntimeError>) -> Result<(), RuntimeError> {
    const PAGE: usize = 256;
    let mut after: Option<String> = None;
    loop {
        // One job meter per page, shared with contribution evaluation. Retain
        // the continuation's allowance across the page; reset only after all
        // its row images and callback scratch have been consumed and dropped.
        let mut meter = Meter::new(Ceilings::job(), Cut::Abort);
        meter.at("adopt stored rows");
        meter.heap(after.as_deref().map_or(0, heap::text))?;
        meter.once(crate::meter::HeapSite::SqliteColumns, 2 * tx.page_size)?;
        let page_mark = meter.mark();
        let mut limit = PAGE;
        let mut page = loop {
            limit = work.limit(&meter, limit);
            let sizes = if after.is_some() {
                "SELECT octet_length(id), octet_length(data) FROM r WHERE t = ?1 AND id > ?2 ORDER BY id LIMIT ?3"
            } else {
                "SELECT octet_length(id), octet_length(data) FROM r WHERE t = ?1 AND ?2 IS NULL ORDER BY id LIMIT ?3"
            };
            let (mut count, mut bytes) = (0, 0u64);
            {
                let mut statement = tx.tx.prepare_cached(sizes)?;
                let mut rows = statement.query(params![table, after, limit as i64])?;
                while let Some(row) = rows.next()? {
                    let id_bytes = row.get::<_, i64>(0)? as usize;
                    let data_bytes = row.get::<_, i64>(1)? as usize;
                    // Rust-owned text, two native payload copies, allocation
                    // headers and exact Vec slots. Length preflight borrows no
                    // overflow payload (the same SQLite convention as scans).
                    let next = bytes.saturating_add(3 * (heap::allocation(id_bytes) + heap::allocation(data_bytes)) + 64 + heap::slots::<(String, String)>(1));
                    // This first size estimate bounds the fetch; admission below
                    // also checks the actual decoder and contribution allowance.
                    if count > 0 && next > meter.ceilings.heap_bytes / 2 { break; }
                    meter.heap(next - bytes)?;
                    bytes = next;
                    count += 1;
                }
            }
            if count == 0 { return Ok(()); }
            let query = if after.is_some() {
                "SELECT id, data FROM r WHERE t = ?1 AND id > ?2 ORDER BY id LIMIT ?3"
            } else {
                "SELECT id, data FROM r WHERE t = ?1 AND ?2 IS NULL ORDER BY id LIMIT ?3"
            };
            let mut page = Vec::<(String, String)>::with_capacity(count);
            {
                let mut statement = tx.tx.prepare_cached(query)?;
                let mut rows = statement.query(params![table, after, count as i64])?;
                while let Some(row) = rows.next()? { page.push((row.get(0)?, row.get(1)?)); }
            }
            if adoption::page_fits(page.iter().map(|(_, data)| data.as_str()), &mut meter, work, &scratch)? { break page; }
            limit = (page.len() / 2).max(1);
            drop(page);
            meter.release_heap(page_mark.clone());
        };
        for (id, data) in &page {
            let row_mark = meter.mark();
            meter.charge(MeterKind::Examined, 1)?;
            // Decode plus copy-on-write projection, optional materialization
            // and validation scratch. Contribution keys reserve more through
            // this same meter, on top of the still-resident complete page.
            meter.heap(adoption::decode_bytes(data))?;
            let row = serde_json::from_str(data).map_err(|e| RuntimeError::Store(e.to_string()))?;
            visit(id, row, &mut meter)?;
            meter.release_heap(row_mark);
        }
        // Move the last ID into the next page's continuation, without an
        // unpriced clone. Drop every other fetched byte before releasing.
        after = page.pop().map(|row| row.0);
        drop(page);
        meter.release_heap(page_mark);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(count: usize, payload: usize) -> Store {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        for n in 0..count {
            let id = format!("r{n:04}");
            let data = canonical_json(&crate::value::object([
                ("id", Value::Id(id.clone())), ("payload", Value::String("x".repeat(payload))),
            ]));
            tx.tx.execute("INSERT INTO r(t,id,data) VALUES(1,?1,?2)", params![id, data]).unwrap();
        }
        tx.commit().unwrap();
        store
    }

    #[test]
    fn callback_keeps_the_whole_fetched_page_reserved() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        let mut serialized_bytes = 0;
        for n in 0..20 {
            let id = format!("r{n:04}");
            let data = canonical_json(&crate::value::object([
                ("id", Value::Id(id.clone())), ("payload", Value::String("x".repeat(1024))),
            ]));
            serialized_bytes += (id.len() + data.len()) as u64;
            tx.tx.execute("INSERT INTO r(t,id,data) VALUES(1,?1,?2)", params![id, data]).unwrap();
        }
        let mut calls = 0;
        let mut first_heap = None;
        walk_metered(&tx, 1, adoption::Work::DECODE, |_| 0, |_, row, meter| {
            let decode = adoption::decode_bytes(&canonical_json(&row));
            // Independent lower bound: Rust-owned images and both native
            // payload copies coexist with decode. This excludes headers/slots,
            // so it does not just repeat the walker's allocation formula.
            assert!(meter.used.heap_bytes >= 3 * serialized_bytes + decode,
                "Rust and native page copies must coexist with decoder scratch: {:?}", meter.used);
            let expected = first_heap.get_or_insert(meter.used.heap_bytes);
            assert_eq!(meter.used.heap_bytes, *expected, "earlier rows release only their own scratch");
            assert_eq!(meter.used.examined, 20 + calls + 1, "all admission decodes plus callback decodes are charged");
            calls += 1;
            Ok(())
        }).unwrap();
        assert_eq!(calls, 20);
        tx.rollback().unwrap();
    }

    #[test]
    fn heap_retries_keep_admission_examinations_at_the_callback_boundary() {
        let mut store = fixture(5, 1280 << 10);
        let tx = store.transaction().unwrap();
        let work = adoption::Work { examined: 2, steps: 1, index_entries: 1 };
        let scratch = |row: &Value| row.heap_bytes() * 4 + 4096;
        let mut observed = Vec::new();
        walk_metered(&tx, 1, work, scratch, |_, row, meter| {
            observed.push(meter.used.examined);
            assert_eq!((meter.used.steps, meter.used.index_entries), (0, 0), "rejected attempts perform no contribution work");
            meter.charge(MeterKind::Examined, 1)?;
            meter.step(1)?;
            meter.heap(scratch(&row))?;
            meter.charge(MeterKind::IndexEntries, 1)?;
            assert!(meter.heap_peak <= Ceilings::job().heap_bytes);
            Ok(())
        }).unwrap();
        // Four two-image attempts each decode one row before the heap check
        // asks for a singleton. Its admission and callback decode add two.
        // The last source is already a singleton and needs no rejected attempt.
        assert_eq!(observed, [3, 3, 3, 3, 2]);
        tx.rollback().unwrap();
    }

    #[test]
    fn every_cumulative_budget_fixes_the_page_before_any_callback() {
        for (work, sizes) in [
            (adoption::Work { examined: 64, steps: 63, index_entries: 63 }, vec![252, 4]),
            (adoption::Work { examined: 2, steps: 5040, index_entries: 1 }, vec![198, 58]),
            (adoption::Work { examined: 1, steps: 0, index_entries: 400 }, vec![40, 40, 40, 40, 40, 40, 16]),
        ] {
            let mut store = fixture(256, 0);
            let tx = store.transaction().unwrap();
            let (mut page, mut offset, mut calls) = (0, 0u64, 0);
            walk_metered(&tx, 1, work, |_| 0, |_, _, meter| {
                assert_eq!(meter.used.examined, sizes[page] + offset * work.examined + 1,
                    "the entire admission pass and every earlier callback remain charged");
                assert_eq!(meter.used.steps, offset * work.steps);
                assert_eq!(meter.used.index_entries, offset * work.index_entries);
                meter.charge(MeterKind::Examined, work.examined - 1)?;
                meter.step(work.steps)?;
                meter.charge(MeterKind::IndexEntries, work.index_entries)?;
                calls += 1;
                offset += 1;
                if offset == sizes[page] { page += 1; offset = 0; }
                Ok(())
            }).unwrap();
            assert_eq!(calls, 256);
            assert_eq!(page, sizes.len());
            tx.rollback().unwrap();
        }
    }

    #[test]
    fn only_non_fitting_singletons_refuse_before_callbacks() {
        for (work, kind) in [
            (adoption::Work { examined: 16_384, steps: 0, index_entries: 0 }, MeterKind::Examined),
            (adoption::Work { examined: 1, steps: 1_000_001, index_entries: 0 }, MeterKind::Steps),
            (adoption::Work { examined: 1, steps: 0, index_entries: 16_385 }, MeterKind::IndexEntries),
        ] {
            for count in [0, 1] {
                let mut store = fixture(count, 0);
                let tx = store.transaction().unwrap();
                let mut calls = 0;
                let result = walk_metered(&tx, 1, work, |_| 0, |_, _, _| { calls += 1; Ok(()) });
                assert_eq!(calls, 0, "no callback can start with an impossible page budget");
                if count == 0 { result.unwrap(); }
                else { assert!(matches!(result, Err(RuntimeError::Bound { kind: got, .. }) if got == kind), "{result:?}"); }
                tx.rollback().unwrap();
            }
        }
    }
}
