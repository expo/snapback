//! The page finishes before any presentation point read. A separate read frame
//! isolates missing decoration coverage, while sharing the request's ledgers.
use super::runner::{Runner, expression_heap};
use crate::{ir::Program, search_decoration, RuntimeError, Value};

impl Runner<'_> {
    pub(super) fn run_decorated_search(&mut self, program: &Program) -> Result<Option<Value>, RuntimeError> {
        if !self.schema.operations.get(&program.name).is_some_and(|f| f.search_decoration) { return Ok(None); }
        let Some(parts) = search_decoration::parts(program) else { return Ok(None) };
        let bare = parts.bare(program);
        let data = if self.device { self.run(&bare)? } else {
            #[cfg(feature = "sqlite")]
            { self.run_server_query(&bare)? }
            #[cfg(not(feature = "sqlite"))]
            { self.run(&bare)? }
        };
        if self.context.retained_search { return Ok(Some(data)); }
        let Value::Array(rows) = data else { return Ok(Some(data)); };
        if let Some(plan) = self.schema.operations.get(&program.name).and_then(|f| f.search.as_ref()) {
            self.meter.heap(rows.len() as u64 * (512 + plan.column.len() as u64) + rows.iter().map(|r| expression_heap(r.field("id").unwrap())).sum::<u64>())?;
            let keys = rows.iter().map(|row| crate::value::object([
                ("id", row.field("id").unwrap().clone()),
                (plan.column.as_str(), row.field(&plan.column).unwrap().clone()),
            ])).collect();
            let keys = Value::Array(keys);
            self.charge_output(&keys)?;
            self.search_rows = Some(keys);
        }
        self.decorate_search_values(program, rows).map(Some)
    }

    pub(crate) fn decorate_search_values(&mut self, program: &Program, rows: Vec<Value>) -> Result<Value, RuntimeError> {
        let parts = search_decoration::parts(program).ok_or_else(|| RuntimeError::Input("query has no lifted search projection".into()))?;
        let mut child = self.decoration_child()?;
        let result = (|| {
            child.decoration_cache = Some(Default::default());
            child.meter.heap(rows.len() as u64 * (std::mem::size_of::<Value>() as u64 + 64))?;
            #[cfg(feature = "server-search")]
            let selected = child.search_decoration_selection(program, &rows)?;
            let mut out = Vec::new();
            for (_position, row) in rows.into_iter().enumerate() {
                #[cfg(feature = "server-search")]
                if selected.as_ref().is_some_and(|selected| !selected.contains(&_position)) {
                    // The coordinator consumes the source key, never this value.
                    out.push(Value::Null); continue;
                }
                child.bind(parts.binding, row);
                out.push(child.expr(parts.value)?);
            }
            Ok(Value::Array(out))
        })();
        self.finish_decoration_child(child);
        result
    }

    #[cfg(feature = "server-search")]
    fn search_decoration_selection(&mut self, program: &Program, rows: &[Value]) -> Result<Option<std::collections::BTreeSet<usize>>, RuntimeError> {
        let Some((_, more)) = &self.context.search_retained_order else { return Ok(None) };
        let Some(plan) = self.schema.operations.get(&program.name).and_then(|f| f.search.as_ref()) else { return Ok(None) };
        let candidates = &self.context.search_retained_candidates;
        let (mut i, mut j, mut count) = (0, 0, 0);
        let mut selected = std::collections::BTreeSet::new();
        while count < plan.limit && j < rows.len() {
            if i == candidates.len() && *more { break; }
            let row = &rows[j];
            let id = row.field("id")?.as_str()?;
            let from_retained = if let Some((left, at, _)) = candidates.get(i) {
                self.meter.step(4 + left.len() as u64 + id.len() as u64)?;
                let cmp = at.cmp(&row.field(&plan.column)?.as_int()?).then_with(|| left.as_str().cmp(id));
                if plan.order == crate::ir::Order::Desc { cmp.is_gt() } else { cmp.is_lt() }
            } else { false };
            if from_retained {
                if !candidates[i].2 { count += 1; }
                i += 1;
            } else {
                selected.insert(j); j += 1; count += 1;
            }
        }
        Ok(Some(selected))
    }

    pub(super) fn decoration_get(&mut self, read: &crate::ir::Read) -> Result<Value, RuntimeError> {
        use crate::rows::word_heap;
        self.meter.heap(word_heap::slots::<Value>(read.key.len()))?;
        let key = read.key.iter().map(|expr| self.expr(expr)).collect::<Result<Vec<_>, _>>()?;
        // Escaping can double scalar bytes; Vec growth retains successive
        // capacities. Reserve before encoding, including all numeric slots.
        let bytes = 8 * (key.iter().map(expression_heap).sum::<u64>() + key.len() as u64 * 12)
            + 128 + read.table.len() as u64 + read.index.len() as u64;
        self.meter.heap(bytes)?;
        self.meter.step(1 + bytes)?;
        let cache_key = (read.table.clone(), read.index.clone(), crate::key::encode(&key));
        if let Some(value) = self.decoration_cache.as_ref().unwrap().get(&cache_key) {
            self.meter.heap(expression_heap(value))?;
            return Ok(value.clone());
        }
        let mut point = read.clone();
        point.key = key.into_iter().map(crate::ir::Expr::Literal).collect();
        // Keep the cache enabled while evaluating nested key expressions, but
        // the now-literal point itself must enter the ordinary authorization door.
        let value = self.get_uncached(&point)?;
        self.meter.require_uncapped()?;
        self.meter.heap(expression_heap(&value) + word_heap::insertion::<(String, String, Vec<u8>), Value>(self.decoration_cache.as_ref().unwrap().len()))?;
        self.decoration_cache.as_mut().unwrap().insert(cache_key, value.clone());
        Ok(value)
    }
}
