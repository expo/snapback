use crate::certificate::Certificate;
use crate::engine::{
    ClosureReceipt, ConstraintTrace, Context, Engine, Execution, ReceiptRange, RuntimeError,
    StopReason, TraceRange,
};
use crate::ir::{Order, Program};
use crate::schema::Schema;
use crate::value::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LocalState {
    Fresh,
    Predicted,
    Partial(Vec<String>),
}

pub struct ClientStore {
    schema: Schema,
    engine: Engine,
    coverage: ClosureReceipt,
    range_deletions: BTreeMap<String, u32>,
    tainted_tables: BTreeSet<String>,
}

impl ClientStore {
    pub fn hydrate(schema: Schema, receipt: &ClosureReceipt) -> Result<Self, RuntimeError> {
        let mut engine = Engine::memory(schema.clone())?;
        for row in &receipt.rows {
            engine.seed(&row.table, row.row.clone())?;
        }
        engine.install_verdicts(&receipt.verdicts);
        Ok(Self {
            schema,
            engine,
            coverage: receipt.clone(),
            range_deletions: BTreeMap::new(),
            tainted_tables: BTreeSet::new(),
        })
    }

    pub fn rehydrate(&mut self, receipt: &ClosureReceipt) -> Result<usize, RuntimeError> {
        let before = self.all_ids()?;
        let replacement = Self::hydrate(self.schema.clone(), receipt)?;
        let after = replacement.all_ids()?;
        let evicted = before.difference(&after).count();
        *self = replacement;
        Ok(evicted)
    }

    pub fn apply_mutation(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
    ) -> Result<(LocalState, Execution), RuntimeError> {
        let mut staged = Self {
            schema: self.schema.clone(),
            engine: self.engine.memory_copy()?,
            coverage: self.coverage.clone(),
            range_deletions: self.range_deletions.clone(),
            tainted_tables: self.tainted_tables.clone(),
        };
        let before = staged.covered_index_keys()?;
        let held_maintained_targets = staged.maintained_target_ids()?;
        let mut execution = staged.engine.execute(program, certificate, context)?;
        let mut partial = BTreeSet::new();
        for constraint in &execution.trace.constraint_inputs {
            if !staged.constraint_covered(constraint) {
                partial.insert(format!("{}.{}", constraint.table, constraint.index));
            }
        }
        for (table, held_ids) in held_maintained_targets {
            for row in staged.engine.rows(&table)? {
                let id = row.field("id")?.as_str()?;
                if !held_ids.contains(id) {
                    // @ref LLP 1001#2-what-a-commit-records — point absences
                    // are not schema-bound, so a successor cannot use one to
                    // initialize an unheld maintained target from zero.
                    partial.insert(format!("{table}.byId"));
                    break;
                }
            }
        }
        if !partial.is_empty() {
            execution.result = Value::Null;
            return Ok((
                LocalState::Partial(partial.into_iter().collect()),
                execution,
            ));
        }
        for (source, _) in &execution.trace.missing_preimages {
            for maintain in staged
                .schema
                .maintains
                .iter()
                .filter(|maintain| maintain.source == *source)
            {
                staged.tainted_tables.insert(maintain.target.clone());
            }
        }
        let after = staged.covered_index_keys()?;
        for (offset, (before_range, after_range)) in before.iter().zip(&after).enumerate() {
            for (id, before_key) in before_range {
                if after_range.get(id) != Some(before_key) {
                    let site = staged.coverage.ranges[offset].site.clone();
                    *staged.range_deletions.entry(site).or_default() += 1;
                }
            }
        }
        *self = staged;
        Ok((LocalState::Predicted, execution))
    }

    pub fn reexecute(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
    ) -> Result<(LocalState, Execution), RuntimeError> {
        let execution = self.engine.execute(program, certificate, context)?;
        let mut partial = BTreeSet::new();
        for range in &execution.trace.ranges {
            let covered = self
                .coverage
                .ranges
                .iter()
                .any(|coverage| range_covered(coverage, range));
            if !covered {
                partial.insert(range.site.clone());
            }
            if self.tainted_tables.contains(&range.table) {
                partial.insert(range.site.clone());
            }
            if self.range_deletions.get(&range.site).copied().unwrap_or(0) > 1 {
                partial.insert(range.site.clone());
            }
        }
        for point in &execution.trace.points {
            if self.tainted_tables.contains(&point.table) {
                partial.insert(point.site.clone());
            }
        }
        for absence in &execution.trace.absences {
            let held = self.coverage.absences.contains(absence)
                || self.coverage.rows.iter().any(|row| {
                    row.table == absence.0
                        && self
                            .schema
                            .table(&absence.0)
                            .and_then(|table| table.index(&absence.1))
                            .is_some_and(|index| {
                                index
                                    .columns
                                    .iter()
                                    .map(|column| {
                                        row.row.field(column).cloned().unwrap_or(Value::Null)
                                    })
                                    .collect::<Vec<_>>()
                                    == absence.2
                            })
                });
            if !held {
                partial.insert(format!("{}.{}", absence.0, absence.1));
            }
        }
        let state = if partial.is_empty() {
            LocalState::Fresh
        } else {
            LocalState::Partial(partial.into_iter().collect())
        };
        Ok((state, execution))
    }

    pub fn rows(&self, table: &str) -> Result<Vec<Value>, RuntimeError> {
        self.engine.rows(table)
    }

    fn all_ids(&self) -> Result<BTreeSet<String>, RuntimeError> {
        let mut ids = BTreeSet::new();
        for table in self.schema.tables.keys() {
            for row in self.engine.rows(table)? {
                ids.insert(format!("{table}:{}", row.field("id")?.as_str()?));
            }
        }
        Ok(ids)
    }

    fn maintained_target_ids(&self) -> Result<BTreeMap<String, BTreeSet<String>>, RuntimeError> {
        self.schema
            .maintains
            .iter()
            .map(|maintain| {
                let ids = self
                    .engine
                    .rows(&maintain.target)?
                    .into_iter()
                    .map(|row| Ok(row.field("id")?.as_str()?.to_owned()))
                    .collect::<Result<BTreeSet<_>, RuntimeError>>()?;
                Ok((maintain.target.clone(), ids))
            })
            .collect()
    }

    fn covered_index_keys(&self) -> Result<Vec<BTreeMap<String, Vec<Value>>>, RuntimeError> {
        self.coverage
            .ranges
            .iter()
            .map(|range| {
                let index = self
                    .schema
                    .table(&range.table)
                    .and_then(|table| table.index(&range.index))
                    .ok_or_else(|| {
                        RuntimeError::Schema(format!(
                            "missing covered index {}.{}",
                            range.table, range.index
                        ))
                    })?;
                let retained: BTreeSet<_> = range
                    .row_ids
                    .iter()
                    .cloned()
                    .chain(range.halo.iter().map(|row| row.id.clone()))
                    .collect();
                let mut keys = BTreeMap::new();
                for row in self.engine.rows(&range.table)? {
                    let id = row.field("id")?.as_str()?;
                    if retained.contains(id) {
                        keys.insert(
                            id.to_owned(),
                            index
                                .columns
                                .iter()
                                .map(|column| row.field(column).cloned())
                                .collect::<Result<_, _>>()?,
                        );
                    }
                }
                Ok(keys)
            })
            .collect()
    }

    fn constraint_covered(&self, constraint: &ConstraintTrace) -> bool {
        if constraint.index == "byId"
            || (constraint.check.starts_with("Unique(") && !constraint.examined_ids.is_empty())
        {
            return true;
        }
        if constraint.check.starts_with("Unique(")
            && self.coverage.absences.iter().any(|(table, index, key)| {
                table == &constraint.table
                    && index == &constraint.index
                    && key == &constraint.prefix
            })
        {
            return true;
        }
        self.coverage.ranges.iter().any(|range| {
            range.table == constraint.table
                && range.index == constraint.index
                && range.prefix == constraint.prefix
                && range.order == Order::Asc
                && range.after.is_none()
                && range.before.is_none()
                && range.gt.is_none()
                && range.gte.is_none()
                && range.lt.is_none()
                && range.lte.is_none()
                && range.stop == StopReason::Exhausted
        })
    }
}

fn range_covered(coverage: &ReceiptRange, range: &TraceRange) -> bool {
    coverage.site == range.site
        && coverage.table == range.table
        && coverage.index == range.index
        && coverage.prefix == range.prefix
        && coverage.order == range.order
        && coverage.take == range.take
        && coverage.after == range.after
        && coverage.before == range.before
        && coverage.gt == range.gt
        && coverage.gte == range.gte
        && coverage.lt == range.lt
        && coverage.lte == range.lte
        && coverage.rule_hash == range.rule_hash
}
