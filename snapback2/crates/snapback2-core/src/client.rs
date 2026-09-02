use crate::certificate::Certificate;
use crate::engine::{ClosureReceipt, Context, Engine, Execution, RuntimeError};
use crate::ir::Program;
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
}

impl ClientStore {
    pub fn hydrate(schema: Schema, receipt: &ClosureReceipt) -> Result<Self, RuntimeError> {
        let mut engine = Engine::memory(schema.clone())?;
        for row in &receipt.rows {
            engine.seed(&row.table, row.row.clone())?;
        }
        engine.install_receipt_authority(receipt);
        Ok(Self {
            schema,
            engine,
            coverage: receipt.clone(),
            range_deletions: BTreeMap::new(),
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
        let before = self.all_ids()?;
        let execution = self.engine.execute(program, certificate, context)?;
        let after = self.all_ids()?;
        for removed in before.difference(&after) {
            for range in &self.coverage.ranges {
                let held = range
                    .row_ids
                    .iter()
                    .any(|id| format!("{}:{id}", range.table) == *removed)
                    || range
                        .halo
                        .as_ref()
                        .is_some_and(|halo| format!("{}:{}", halo.table, halo.id) == *removed);
                if held {
                    *self.range_deletions.entry(range.site.clone()).or_default() += 1;
                }
            }
        }
        let state = match &execution.state {
            crate::engine::ExecutionState::Partial { reason } => {
                LocalState::Partial(vec![reason.clone()])
            }
            _ => LocalState::Predicted,
        };
        Ok((state, execution))
    }

    pub fn reexecute(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
    ) -> Result<(LocalState, Execution), RuntimeError> {
        let execution = self.engine.execute(program, certificate, context)?;
        let mut partial = BTreeSet::new();
        if let crate::engine::ExecutionState::Partial { reason } = &execution.state {
            partial.insert(reason.clone());
        }
        for range in &execution.trace.ranges {
            let covered = self
                .coverage
                .ranges
                .iter()
                .any(|coverage| coverage.site == range.site && coverage.prefix == range.prefix);
            if !covered {
                partial.insert(range.site.clone());
            }
            if self.range_deletions.get(&range.site).copied().unwrap_or(0) > 1 {
                partial.insert(range.site.clone());
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
}
