//! Read-only evidence about retained rows written under a future clock.
use snapback4_core::{Engine, RuntimeError, schema::ColumnType};
use std::collections::{BTreeMap, BTreeSet};

const TOLERANCE_MS: i64 = 5_000;

// @ref LLP 3000.007#20.12 — warn about retained write stamps, not ordinary future expiry/deadline values.
pub fn ahead(engine: &Engine, now: i64) -> Result<Option<String>, RuntimeError> {
    let snapshot = engine.store().conn().unchecked_transaction()?;
    let conn = &snapshot;
    let threshold = now.saturating_add(TOLERANCE_MS);
    let mut commits = conn.prepare("SELECT DISTINCT at FROM _commits WHERE at > ?1")?;
    let stamps = commits.query_map([threshold], |r| r.get::<_, i64>(0))?.collect::<Result<BTreeSet<_>, _>>()?;
    let mut tables = BTreeMap::new();
    let mut rows = conn.prepare("SELECT r.id, r.data FROM r JOIN _catalog c ON c.num = r.t WHERE c.name = ?1")?;
    for (name, table) in engine.schema().visible_tables() {
        let times: Vec<_> = table.columns.iter().filter(|(_, kind)| kind.required() == &ColumnType::Time).map(|(name, _)| name).collect();
        let mut query = rows.query([name])?;
        while let Some(row) = query.next()? {
            let id: String = row.get(0)?;
            let mut at = snapback4_core::ids::minted_at(&id).unwrap_or(0);
            if !stamps.is_empty() && !times.is_empty() {
                let data: String = row.get(1)?;
                let value: snapback4_core::Value = serde_json::from_str(&data).map_err(|e| RuntimeError::Store(e.to_string()))?;
                if let snapback4_core::Value::Row(fields) = value {
                    for field in &times {
                        if let Some(snapback4_core::Value::Int(time)) = fields.get(*field) {
                            if stamps.contains(time) { at = at.max(*time); }
                        }
                    }
                }
            }
            if at > threshold { tables.entry(name.as_str()).and_modify(|lead: &mut i64| *lead = (*lead).max(at - now)).or_insert(at - now); }
        }
    }
    Ok(tables.values().max().map(|lead| format!(
        "N_CLOCK_STORE_AHEAD: stored row stamps lead the current clock by up to {lead}ms in {}; use a fresh store per offset test (dev --fresh --port 4401), or restart with the same --clock-offset to continue",
        tables.keys().copied().collect::<Vec<_>>().join(", "))))
}

pub fn has_data(engine: &Engine) -> bool {
    engine.store().conn().query_row("SELECT EXISTS(SELECT 1 FROM r)", [], |r| r.get(0)).unwrap_or(false)
}

pub fn offset_line(offset: i64, running: bool) -> String {
    format!("clock     offset from wall time: {offset:+}ms{}", if running { " (lasts until restart)" } else { " (no running dev; inspecting against wall time)" })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tolerance_and_largest_lead_cover_retained_rows_only() {
        let bound = snapback4_lang::compile(&[("schema.q".into(), "table alpha:\n  at: time\n  public\ntable beta:\n  at: time\n  public\n".into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::new_at(snapback4_core::Store::memory().unwrap(), bound.schema,
            bound.programs.into_iter().map(|p| p.program), 100_000).unwrap();
        let rows = [("alpha", 105_000), ("beta", 107_000)].map(|(table, at)| (table.into(), snapback4_core::value::object([
            ("id", snapback4_core::Value::Id(snapback4_core::ids::mint(at, &mut 0).unwrap())),
            ("at", snapback4_core::Value::Int(at)),
        ])));
        engine.seed_at(rows, 100_000).unwrap();
        let note = ahead(&engine, 100_000).unwrap().unwrap();
        assert!(note.contains("up to 7000ms in beta;"), "{note}");
        let note = ahead(&engine, 99_999).unwrap().unwrap();
        assert!(note.contains("up to 7001ms in alpha, beta;"), "{note}");
        assert!(ahead(&engine, 102_000).unwrap().is_none());
    }
}
