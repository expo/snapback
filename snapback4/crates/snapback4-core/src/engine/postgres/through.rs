//! The same capture barrier, restore validation and child-first sweep on Postgres.
// @ref LLP 3000.014#7-activation — publish captures, indexes and generation in one transaction.
use super::*;

impl PostgresEngine {
    pub fn read_through_shortened(&mut self) -> Result<BTreeMap<String, u64>, RuntimeError> {
        let tx = self.store.transaction(None)?;
        let counts = decode(
            tx.query(
                "SELECT through_shortened FROM _backend WHERE singleton",
                &[],
            )?[0]
                .get(0),
        )?;
        tx.rollback()?;
        Ok(counts)
    }
    pub fn sweep_expired(&mut self, now: i64, limit: usize) -> Result<u64, RuntimeError> {
        let tx = self.store.transaction(Some(WriteMode::Serialized))?;
        let seq = tx.next_seq()?;
        let mut runner = Runner::new(
            &tx,
            &self.schema,
            Context::system().at(now),
            Meter::new(Ceilings::unbounded(), Cut::Abort),
            seq,
        );
        let count = runner.sweep_server_rows(limit)?;
        let events = runner.events.take();
        let tables: Vec<_> = runner.written_tables.iter().cloned().collect();
        let writes = runner.rows_written;
        drop(runner);
        if writes > 0 {
            tx.record_commit(
                seq,
                now,
                "expire",
                crate::SYSTEM_PRINCIPAL,
                "sweep",
                &tables,
                writes,
            )?;
            partition::append(&tx, seq, &events)?;
        }
        tx.commit()?;
        Ok(count)
    }

    pub fn load_trusted(
        &mut self,
        rows: impl IntoIterator<Item = (String, Value)>,
        now: i64,
    ) -> Result<u64, RuntimeError> {
        let tx = self.store.transaction(Some(WriteMode::Serialized))?;
        let seq = tx.next_seq()?;
        let order = self.schema.through_order();
        let mut rows: Vec<_> = rows.into_iter().collect();
        rows.sort_by_key(|(n, _)| order.iter().position(|x| x == n));
        let mut count = 0;
        let mut runner = Runner::new(
            &tx,
            &self.schema,
            Context::system().at(now),
            Meter::new(Ceilings::unbounded(), Cut::Abort),
            seq,
        );
        for (name, mut row) in rows {
            let table = self
                .schema
                .table(&name)
                .ok_or_else(|| RuntimeError::Schema(format!("missing table {name}")))?;
            table.recompute_deadline(&mut row)?;
            validate::validate_row(&self.schema, &name, &row)?;
            let old = tx.get(&name, row.field("id")?.as_str()?)?;
            tx.put(&name, table, &row, old.as_ref())?;
            partition::row_changed(
                &mut runner,
                &name,
                old.as_ref(),
                Some(&row),
                crate::engine::write::Origin::Source,
            )?;
            runner.written_tables.insert(name);
            count += 1;
        }
        super::super::through_activation::validate_restore(&tx, &self.schema, now)?;
        let events = runner.events.take();
        let tables: Vec<_> = runner.written_tables.iter().cloned().collect();
        drop(runner);
        if count > 0 {
            tx.record_commit(
                seq,
                now,
                "restore",
                crate::SYSTEM_PRINCIPAL,
                "restore",
                &tables,
                count,
            )?;
            partition::append(&tx, seq, &events)?;
        }
        tx.commit()?;
        Ok(count)
    }

    pub fn adopt_at(
        &mut self,
        mut schema: Schema,
        programs: impl IntoIterator<Item = Program>,
        now: i64,
    ) -> Result<u64, RuntimeError> {
        schema.prepare_contribution_indexes();
        // @ref LLP 3000.022#5 — adoption replaces tracked membership and any shared binding index.
        schema.prepare_delivery_lookup();
        let programs: BTreeMap<_, _> = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        supported(&schema, &programs)?;
        let generation = self
            .generation()
            .checked_add(1)
            .ok_or_else(|| RuntimeError::Generation("generation overflow".into()))?;
        let tx = self.store.transaction(Some(WriteMode::Serialized))?;
        let shortened =
            super::super::through_activation::activate(&tx, &schema, Some(&self.schema), now)?;
        tx.execute("DELETE FROM i", &[])?;
        tx.execute("DELETE FROM _cap_counts", &[])?;
        for name in self
            .schema
            .tables
            .keys()
            .filter(|n| !schema.tables.contains_key(*n))
        {
            tx.execute("DELETE FROM r WHERE t=$1", &[name])?;
        }
        for (name, table) in &schema.tables {
            let mut after = String::new();
            loop {
                let page = tx.query(
                    "SELECT id,data FROM r WHERE t=$1 AND id>$2 ORDER BY id LIMIT 256",
                    &[name, &after],
                )?;
                if page.is_empty() {
                    break;
                }
                for item in page {
                    after = item.get(0);
                    let mut row: Value = decode(item.get(1))?;
                    if let Value::Row(fields) | Value::Map(fields) = &mut row {
                        fields.retain(|f, _| table.columns.contains_key(f));
                    }
                    table.recompute_deadline(&mut row)?;
                    validate::validate_row(&schema, name, &crate::schema::row_image(&row, table))?;
                    tx.execute("DELETE FROM r WHERE t=$1 AND id=$2", &[name, &after])?;
                    tx.put(name, table, &row, None)?;
                }
            }
        }
        let seq = tx.next_seq()?;
        let mut runner = Runner::new(
            &tx,
            &schema,
            Context::system().at(now),
            Meter::new(Ceilings::unbounded(), Cut::Abort),
            seq,
        );
        runner.event_free = true;
        for m in schema.maintains.iter().filter(|m| m.private.is_none()) {
            runner.rebuild_maintain(m)?;
        }
        let parents = super::super::column_activation::changed_parents(&schema, Some(&self.schema));
        runner.activate_columns(
            Some(&self.schema),
            &schema.maintains.iter().collect::<Vec<_>>(),
            &parents,
            None,
        )?;
        drop(runner);
        super::super::through_activation::validate_indexes(&tx, &schema)?;
        tx.execute("UPDATE _backend SET schema=$1, programs=$2, generation=$3, through_shortened=$4 WHERE singleton",&[&canonical_json(&schema),&canonical_json(&programs),&(generation as i64),&canonical_json(&shortened)])?;
        tx.commit()?;
        self.schema = schema;
        self.programs = programs;
        self.store.generation = generation;
        Ok(generation)
    }
}
