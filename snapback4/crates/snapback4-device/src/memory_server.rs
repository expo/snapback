//! Authoritative test/embedded hosts use the memory Rows adapter too. Device
//! installation keeps its separate reacquisition contract.
// @ref LLP 3000.014#7-activation — stage the entire generation and publish only on success.
use super::*;
use snapback4_core::{
    engine::{Context, runner::Runner, through_activation},
    meter::{Ceilings, Cut, Meter},
};

impl MemoryStore {
    pub fn seed_server_at(
        &mut self,
        rows: impl IntoIterator<Item = (String, Value)>,
        now: i64,
    ) -> Result<u64, RuntimeError> {
        let schema = self
            .schema
            .clone()
            .ok_or_else(|| RuntimeError::Schema("install a server schema before seeding".into()))?;
        let tx = self.transaction()?;
        let mut runner = Runner::new(
            &tx,
            &schema,
            Context::system().at(now),
            Meter::new(Ceilings::unbounded(), Cut::Abort),
            0,
        );
        let count = runner.seed_server_rows(rows)?;
        drop(runner);
        tx.commit()?;
        Ok(count)
    }
    pub fn sweep_server_at(&mut self, now: i64, limit: usize) -> Result<u64, RuntimeError> {
        let schema = self.schema.clone().ok_or_else(|| {
            RuntimeError::Schema("install a server schema before sweeping".into())
        })?;
        let mut expiry_after = self.expiry_after.clone();
        let tx = self.transaction()?;
        let mut runner = Runner::new(
            &tx,
            &schema,
            Context::system().at(now),
            Meter::new(Ceilings::unbounded(), Cut::Abort),
            0,
        );
        let count = runner.sweep_server_rows(limit, &mut expiry_after)?;
        drop(runner);
        tx.commit()?;
        self.expiry_after = expiry_after;
        Ok(count)
    }
    pub fn activate_server_at(
        &mut self,
        mut schema: Schema,
        now: i64,
    ) -> Result<u64, RuntimeError> {
        schema.prepare_contribution_indexes();
        if let Some(issue) = snapback4_core::schema::validate(&schema).first() {
            return Err(RuntimeError::Schema(format!(
                "{}: {}",
                issue.path, issue.message
            )));
        }
        let previous = self.schema.clone();
        let mut staged = Self {
            state: RefCell::new(self.state.borrow().clone()),
            schema: previous.clone(),
            changes: RefCell::new(self.changes.borrow().clone()),
            drained: Cell::new(self.drained.get()),
            expiry_after: BTreeMap::new(),
        };
        let tx = staged.transaction()?;
        let shortened = through_activation::activate(&tx, &schema, previous.as_ref(), now)?;
        tx.commit()?;
        staged.install(&schema, &BTreeMap::new(), false)?;
        let tx = staged.transaction()?;
        for (name, table) in &schema.tables {
            let mut bounds = Bounds::default();
            loop {
                let page = tx.scan(name, "byId", &[], &bounds, Dir::Asc, 256)?;
                if page.is_empty() {
                    break;
                }
                for (old, key) in page {
                    bounds.after = key::decode(&key);
                    let mut row = old.clone();
                    table.recompute_deadline(&mut row)?;
                    snapback4_core::engine::validate::validate_row(
                        &schema,
                        name,
                        &snapback4_core::schema::row_image(&row, table),
                    )?;
                    tx.put(name, table, &row, Some(&old))?;
                }
            }
        }
        let mut runner = Runner::new(
            &tx,
            &schema,
            Context::system().at(now),
            Meter::new(Ceilings::unbounded(), Cut::Abort),
            0,
        );
        runner.rebuild_server_derivations(previous.as_ref())?;
        drop(runner);
        through_activation::validate_indexes(&tx, &schema)?;
        let generation = tx
            .meta("server:generation")?
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0)
            .checked_add(1)
            .ok_or_else(|| RuntimeError::Generation("generation overflow".into()))?;
        tx.set_meta("server:generation", &generation.to_string())?;
        tx.set_meta("read_through_shortened", &stored(&shortened))?;
        tx.commit()?;
        *self = staged;
        Ok(generation)
    }

    /// Recompute effective instants, validate every immutable capture against
    /// the final image, then atomically publish. This never resolves a capture.
    pub fn restore_server_at(
        &mut self,
        rows: impl IntoIterator<Item = (String, Value)>,
        now: i64,
    ) -> Result<u64, RuntimeError> {
        let schema = self.schema.clone().ok_or_else(|| {
            RuntimeError::Schema("install a server schema before restoring".into())
        })?;
        let tx = self.transaction()?;
        let mut count = 0;
        for (name, mut row) in rows {
            let table = schema
                .table(&name)
                .ok_or_else(|| RuntimeError::Schema(format!("missing {name}")))?;
            table.recompute_deadline(&mut row)?;
            snapback4_core::engine::validate::validate_row(&schema, &name, &row)?;
            let old = tx.get(&name, row.field("id")?.as_str()?)?;
            tx.put(&name, table, &row, old.as_ref())?;
            count += 1;
        }
        through_activation::validate_restore(&tx, &schema, now)?;
        let mut runner = Runner::new(
            &tx,
            &schema,
            Context::system().at(now),
            Meter::new(Ceilings::unbounded(), Cut::Abort),
            0,
        );
        runner.rebuild_server_derivations(None)?;
        drop(runner);
        through_activation::validate_indexes(&tx, &schema)?;
        tx.commit()?;
        Ok(count)
    }
}
