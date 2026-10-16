//! Candidate activation: project rows, validate invariants, build indexes
//! and derived rows, then publish the semantic generation in one commit.
// @ref LLP 3000.000#implementation-follow-up — one atomic activation boundary

pub(super) use super::activation_walk::walk;
use super::activation_walk::walk_metered;
use super::*;
use crate::ir::Program;
use crate::schema::{Constraint, materialize_optional_fields};
use crate::value::digest;
use std::collections::BTreeSet;

pub(super) type Identity = (Option<String>, Option<String>, Option<String>, Option<String>,
);

pub(super) fn identity(conn: &Connection) -> Result<Identity, RuntimeError> {
    let mut statement = conn.prepare_cached("SELECT value FROM _meta WHERE key = ?1")?;
    let mut get = |key| statement.query_row([key], |row| row.get(0)).optional();
    Ok((get("schema_hash")?, get("activation_hash")?, get("generation")?, get("device:generation")?,
    ))
}

impl Store {
    /// Install a device's schema. Server engines also supply their programs
    /// and derived-state builder through `activate` below.
    pub fn install(&mut self, schema: &Schema) -> Result<(), RuntimeError> {
        self.activate(schema, None, false, |_, _| Ok(())).map(|_| ())
    }

    /// A device can discard an obsolete partition while atomically caching
    /// its replacement backend and reset watermark. It never migrates rows
    /// whose authority belongs to a previous server generation.
    pub fn install_device(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool) -> Result<(), RuntimeError> {
        self.install_device_checked(schema, metadata, reset, &BTreeMap::new())
    }

    pub fn install_device_checked(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool, expected: &BTreeMap<String, Option<String>>) -> Result<(), RuntimeError> {
        self.install_device_checked_with(schema, metadata, reset, expected, |_| Ok(()))
    }

    /// Device-owned sidecar changes share the schema installation transaction.
    pub fn install_device_checked_with(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool, expected: &BTreeMap<String, Option<String>>, prepare: impl FnOnce(&Tx<'_>) -> Result<(), RuntimeError>) -> Result<(), RuntimeError> {
        self.install_device_checked_with_finish(schema, metadata, reset, expected, prepare, |_| {
            Ok(())
        })
    }

    /// Opening recovery and its final reads must finish before installation commits.
    pub fn install_device_checked_with_finish<R>(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool, expected: &BTreeMap<String, Option<String>>, prepare: impl FnOnce(&Tx<'_>) -> Result<(), RuntimeError>, finish: impl FnOnce(&Tx<'_>) -> Result<R, RuntimeError>,
    ) -> Result<R, RuntimeError> {
        let mut result = None;
        self.activate(schema, None, reset, |tx, _| {
            for (key, value) in expected {
                let held: Option<String> = tx.conn().query_row("SELECT value FROM _meta WHERE key = ?1", [key], |row| {
                        row.get(0)
                    }).optional()?;
                if &held != value { return Err(RuntimeError::Generation("the backend adoption capture is obsolete; retry sync".into())); }
            }
            prepare(tx)?;
            for (key, value) in metadata {
                // A device metadata namespace reset shares backend installation's transaction.
                if key.ends_with(':') {
                    tx.conn().execute("DELETE FROM _meta WHERE key >= ?1 AND key < ?2", params![key, format!("{key}\u{10ffff}")])?;
                } else { tx.set_meta(key, value)?; }
            }
            if reset { tx.conn().execute_batch("DELETE FROM _device_base; DELETE FROM _device_snapshot;")?; }
            result = Some(finish(tx)?);
            Ok(())
        })?;
        Ok(result.expect("activation ran opening recovery"))
    }

    pub(crate) fn activate(&mut self, schema: &Schema, programs: Option<&BTreeMap<String, Program>>, reset: bool, build: impl FnOnce(&Tx<'_>, bool) -> Result<(), RuntimeError>) -> Result<u64, RuntimeError> {
        self.activate_at(schema, programs, reset, crate::now_ms(), |tx, changed, _| build(tx, changed))
    }

    pub(crate) fn activate_at(&mut self, schema: &Schema, programs: Option<&BTreeMap<String, Program>>, reset: bool, now: i64, build: impl FnOnce(&Tx<'_>, bool, &mut super::adoption_report::AdoptionReport) -> Result<(), RuntimeError>) -> Result<u64, RuntimeError> {
        // One-shot device preparation is never retried or given a larger cache.
        self.activate_transaction(schema, programs, reset, now, true, build)
    }

    pub(crate) fn activate_at_with_launch<R>(&mut self, schema: &Schema, programs: Option<&BTreeMap<String, Program>>, reset: bool, now: i64, allow_launch: bool, check: impl Fn(&Connection) -> Result<(), RuntimeError>, mut build: impl FnMut(&Tx<'_>, bool, &mut super::adoption_report::AdoptionReport) -> Result<(), RuntimeError>, finish: impl Fn(&Tx<'_>) -> Result<R, RuntimeError>,
    ) -> Result<(u64, R), RuntimeError> {
        let budget = if programs.is_some() { super::activation_cache::configured_mib()? } else { 0 };
        // The server builder owns only transaction-local work. Recreate all of
        // it on retry, with the same schema/programs/activation time.
        self.with_activation_cache(budget, |store| {
            store.activate_transaction_with(schema, programs, reset, now, allow_launch, &check, &mut build, &finish)
        })
    }

    pub(super) fn activate_transaction(&mut self, schema: &Schema, programs: Option<&BTreeMap<String, Program>>, reset: bool, now: i64, allow_launch: bool, build: impl FnOnce(&Tx<'_>, bool, &mut super::adoption_report::AdoptionReport) -> Result<(), RuntimeError>) -> Result<u64, RuntimeError> {
        self.activate_transaction_with(schema, programs, reset, now, allow_launch, |_| Ok(()), build, |_| Ok(())).map(|(generation, ())| generation)
    }

    fn activate_transaction_with<R>(&mut self, schema: &Schema, programs: Option<&BTreeMap<String, Program>>, reset: bool, now: i64, allow_launch: bool, check: impl FnOnce(&Connection) -> Result<(), RuntimeError>, build: impl FnOnce(&Tx<'_>, bool, &mut super::adoption_report::AdoptionReport) -> Result<(), RuntimeError>, finish: impl FnOnce(&Tx<'_>) -> Result<R, RuntimeError>,
    ) -> Result<(u64, R), RuntimeError> {
        let mut report = super::adoption_report::AdoptionReport::default();
        let mut phase = std::time::Instant::now();
        if programs.is_some() {
            if let Some(estimate) = self.adoption_estimate(schema)?.filter(|e| e.seconds().1 > 1.0) {
                crate::diagnostic!("snapback4: atomic adoption: {}", estimate.summary());
            }
            let estimates = self.check_timeline_activation_at(schema, now, allow_launch)?;
            for estimate in estimates.iter().filter(|e| e.sources != 0) { crate::diagnostic!("snapback4: atomic feed adoption: {}", estimate.summary()); }
        }
        report.phase("read-only advice", &mut phase);
        self.check_ownership()?;
        let sql = self.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        // Low-level preparation may precede a writer-lock wait. Recheck all
        // opening admission under the lock that owns the upgrades.
        Self::check_version(&sql)?;
        let before = identity(&sql)?;
        if before != self.identity { return Err(RuntimeError::Generation("another engine activated this store; reopen it before activating source".into())); }
        check(&sql)?;
        // @ref LLP 3000.033#1.3 — physical upgrades roll back with adoption.
        // Rollback restores schema/rows and freelist count. It may leave
        // changed free-page contents or journal/WAL residue, not committed data.
        Self::initialize_schema(&sql)?;
        if programs.is_some() { Self::initialize_change_evidence(&sql)?; }
        index_key_guards(&sql)?;
        // @ref LLP 3000.019#3.6 — reuse an admitted key bound, never assume a legacy store was checked.
        // Physical INSERT/UPDATE triggers invalidate the proof on oversized keys,
        // including direct SQL. Every activation key
        // below is checked too. Bind the proof to the predecessor so an older
        // binary's adoption invalidates it; device installation always scans.
        let key_proof = before.1.as_ref().map(|hash| format!("{}:{hash}", crate::rows::MAX_INDEX_KEY_BYTES));
        let validated: Option<String> = sql.query_row("SELECT value FROM _meta WHERE key = 'index_keys_validated'", [], |r|r.get(0)).optional()?;
        let keys_validated = programs.is_some() && key_proof.is_some() && validated == key_proof;
        #[cfg(test)]
        let keys_validated = keys_validated && !self.full_adoption;
        // One bounded result, no row images. Fresh stores have no schema;
        // an explicit device reset discards the old entries in this transaction.
        if before.0.is_some() && !reset && !keys_validated {
            let violation: Option<(String, i64)> = sql.query_row(
                "SELECT c.name, COUNT(*) FROM i JOIN _catalog c ON c.num = i.ti WHERE length(i.k) > ?1 GROUP BY i.ti ORDER BY i.ti LIMIT 1",
                [crate::rows::MAX_INDEX_KEY_BYTES as i64], |row| Ok((row.get(0)?, row.get(1)?))
            ).optional()?;
            if let Some((name, count)) = violation {
                let (table, index) = name.rsplit_once('.').unwrap_or((&name, "unknown"));
                return Err(crate::rows::index_key_refusal(table, index, count as u64));
            }
        }
        report.phase("key validation", &mut phase);
        let schema_hash = schema.hash();
        // @ref LLP 3000.000.000#6-devices-and-partitions — executable native content changes the existing semantic generation.
        let native: Option<String> = sql.query_row("SELECT value FROM _meta WHERE key='release_native_digest'", [], |r|r.get(0)).optional()?;
        let activation_hash = programs.map(|programs| match &native {Some(native)=>digest(&(schema,programs,native)),None=>digest(&(schema,programs))});
        let schema_changed = before.0.as_deref() != Some(&schema_hash);
        let mut changed = schema_changed || activation_hash.as_ref().is_some_and(|hash| before.1.as_ref() != Some(hash));
        // The address function is part of the semantic generation even when
        // the authored schema and programs are byte-identical. Devices reset
        // with that generation; the server rebuilds old target rows below.
        let predecessor_has_aggregate = sql.query_row(
            "SELECT schema FROM _generations WHERE generation = (SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'generation')",
            [], |row| row.get::<_, String>(0),
        ).optional()?.map(|text| serde_json::from_str::<Schema>(&text)
            .map_err(|error| RuntimeError::decode(error, RuntimeError::Store))).transpose()?
            .is_some_and(|previous| previous.maintains.iter().any(|maintain| maintain.row_key.is_none()));
        let maintained_identity_upgrade = programs.is_some()
            && predecessor_has_aggregate
            && sql.query_row("SELECT value FROM _meta WHERE key=?1", [crate::schema::MAINTAINED_ID_META], |row| row.get::<_, String>(0)).optional()?.as_deref()
                != Some(crate::schema::MAINTAINED_ID_VERSION);
        changed |= maintained_identity_upgrade;
        let mut catalog: BTreeMap<String, i64> = sql.prepare("SELECT name, num FROM _catalog")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<_, _>>()?;
        // Repeat source-count admission under the writer lock, before any candidate writes.
        let preflight_catalog = catalog.clone();
        let (launches, sql) = {
            let preflight = Tx { activation_scan: None, changes: Default::default(), sequence_table: Default::default(), tx: sql, page_size: self.page_size,
                server: self.server,
                catalog: &preflight_catalog };
            let launches = if programs.is_some() { super::timeline_launch::preflight(&preflight, schema, now, allow_launch)? } else { Vec::new() };
            let Tx { tx: sql, .. } = preflight;
            (launches, sql)
        };
        let mut next = catalog.values().copied().max().unwrap_or(0) + 1;
        for (name, table) in schema.tables.iter().filter(|(_,t)| t.ephemeral.is_none()) {
            for full in std::iter::once(name.clone()).chain(table.indexes.keys().map(|index| format!("{name}.{index}"))) {
                if !catalog.contains_key(&full) {
                    sql.execute("INSERT INTO _catalog(name, num) VALUES (?1, ?2)", params![full, next])?;
                    catalog.insert(full, next); next += 1;
                }
            }
        }
        let activation_scan = programs.map(|_| Default::default());
        #[cfg(test)]
        let activation_scan = if self.full_adoption { None } else { activation_scan };
        let tx = Tx { activation_scan, changes: Default::default(), sequence_table: Default::default(), tx: sql, page_size: self.page_size,
            server: self.server,
            catalog: &catalog };
        let now = if schema.tables.values().any(|table| table.not_before.is_some()) {
            tx.pin_time_audience_clock(now)?
        } else {
            now
        };
        // @ref LLP 3000.013#12.1 — occupancy belongs to successful activation,
        // never opening a legacy store that may subsequently refuse adoption.
        let cap_counts = crate::rows::caps::required(schema) || tx.meta("cap_counts_schema")?.is_some();
        if cap_counts {
            tx.conn().execute_batch("CREATE TABLE IF NOT EXISTS _cap_counts (t INTEGER NOT NULL, k BLOB NOT NULL, n INTEGER NOT NULL CHECK(n >= 0), PRIMARY KEY(t, k)) WITHOUT ROWID;")?;
            if reset { tx.conn().execute_batch("DELETE FROM _cap_counts;")?; }
        }
        if schema.tables.values().any(|t| !t.sequences.is_empty()) {
            tx.ensure_sequence_table()?;
        }
        if reset {
            tx.conn().execute_batch("DELETE FROM r; DELETE FROM i;")?;
            if tx.has_sequence_table()? { tx.conn().execute_batch("DELETE FROM _sequences;")?; }
        }
        let mut retained_through=BTreeSet::new();
        let release_activation=programs.is_some() && tx.meta("activation_restore")?.is_some();
        if (schema_changed || release_activation) && programs.is_some() && !reset {
            let previous: Option<String> = tx.conn().query_row("SELECT schema FROM _generations WHERE generation=(SELECT CAST(value AS INTEGER) FROM _meta WHERE key='generation')", [], |r|r.get(0)).optional()?;
            let previous: Option<Schema> = previous.map(|s|serde_json::from_str(&s).map_err(|e|RuntimeError::Store(e.to_string()))).transpose()?;
            let restore=tx.meta("activation_restore")?.as_deref()!=Some("false");
            retained_through=super::dormant::transition(&tx,schema,previous.as_ref(),restore,now)?;
        }
        let population_changed=tx.meta("activation_population")?.as_deref()==Some("true");
        changed |= population_changed;
        let rebuilding=schema_changed || population_changed;
        if rebuilding && programs.is_some() && !reset {
            let started = std::time::Instant::now();
            let previous: Option<String> = tx.conn().query_row("SELECT schema FROM _generations WHERE generation = (SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'generation')", [], |row| row.get(0)).optional()?;
            let previous: Option<Schema> = previous.map(|s| {
                    serde_json::from_str(&s).map_err(|e| RuntimeError::decode(e,RuntimeError::Store))
                }).transpose()?;
            let shortened = crate::engine::through_activation::activate_retained(&tx,schema,previous.as_ref(),now,&retained_through)?;
            tx.set_meta("read_through_shortened",&canonical_json(&shortened))?;
            report.detail("read-through retirement", started);
        }
        if programs.is_some() { crate::engine::timeline::check_activation(&tx, schema)?; }
        if rebuilding && programs.is_some() {
            let started = std::time::Instant::now();
            super::timeline_launch::build(&tx, schema, &launches, now)?;
            report.detail("feed launch", started);
            let started = std::time::Instant::now();
            super::event_slots::fill(&tx, schema, now)?;
            report.detail("event slot fill", started);
            let started = std::time::Instant::now();
            if super::dormant::enabled(&tx)? {
                let old:Option<String>=tx.conn().query_row("SELECT schema FROM _generations WHERE generation=(SELECT CAST(value AS INTEGER) FROM _meta WHERE key='generation')",[],|r|r.get(0)).optional()?;
                let old:Option<Schema>=old.map(|s| {
                        serde_json::from_str(&s).map_err(|e|RuntimeError::Store(e.to_string()))
                    }).transpose()?;
                super::adopt_refusals::candidate(&tx,schema,if tx.meta("activation_population")?.as_deref()==Some("true"){None}else{old.as_ref()},false)?;
            }
            if let Some(step) = super::successor::assess(&tx, schema)?.iter().find(|s| s.change == crate::successor::Change::Narrowing) {
                return Err(step.refusal(schema));
            }
            report.detail("successor assessment", started);
        }
        let previous: Option<Schema> = if rebuilding && programs.is_some() && !reset {
            tx.conn().query_row("SELECT schema FROM _generations WHERE generation = (SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'generation')", [], |r| r.get::<_, String>(0)).optional()?
                .map(|s| serde_json::from_str(&s).map_err(|e| RuntimeError::decode(e, RuntimeError::Store))).transpose()?
        } else { None };
        #[cfg(test)]
        let previous = if self.full_adoption { None } else { previous };
        // @ref LLP 3000.000.000#13-wave-13-preview-decisions — report interpreted literal fills from the committed candidate population.
        if let Some(previous) = &previous {
            for (name, table) in &schema.tables {
                let fills: Vec<_> = table.defaults.iter().filter_map(|(column, default)| {
                    if previous.table(name).and_then(|t| t.defaults.get(column)) == Some(default) { return None; }
                    if table.columns[column].is_optional() || table.maintained.contains_key(column) || table.engine_field(column) { return None; }
                    match default { crate::schema::ColumnDefault::Literal(value) => Some((column, value)), _ => None }
                }).collect();
                if fills.is_empty() || schema.maintain_for(name).is_some() || table.ephemeral.is_some() { continue; }
                let mut counts = vec![0u64; fills.len()];
                walk(&tx, catalog[name], |_, row| {
                    for (i,(column,_)) in fills.iter().enumerate() { if row.field(column).is_err() { counts[i] += 1; } }
                    Ok(())
                })?;
                for ((column,value),count) in fills.into_iter().zip(counts).filter(|(_,count)| *count > 0) {
                    let value = match value { Value::String(text) => format!("'{}'", text.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', "\\n").replace('\r', "\\r")), value => crate::wire::to_json(value).to_string() };
                    report.backfills.push(format!("{name}.{column} ← {value} on {count} rows"));
                }
            }
        }
        let plans = super::activation_plan::plans(schema, if population_changed {None} else {previous.as_ref()});
        if let Some(previous)=&previous {
            for step in crate::successor::classify(previous,schema) {
                let parts=step.path.split('.').collect::<Vec<_>>();
                let label=if parts.first()==Some(&"tables") && parts.len()>=2 {
                    let name=parts[1];
                    let label=super::adoption_report::table_label(if schema.table(name).is_some(){schema}else{previous},name);
                    if label==name && parts.get(2)==Some(&"columns") && parts.get(3).is_some_and(|c|!c.starts_with('$')) {format!("{label}.{}",parts[3])}else{label}
                } else if let Some(position)=step.path.strip_prefix("maintains[").and_then(|s|s.strip_suffix(']')).and_then(|s|s.parse::<usize>().ok()) {
                    schema.maintains.get(position).map_or_else(||"view".into(),|m|m.label())
                } else {"backend".into()};
                let message=format!("{label} changed");
                if !report.changes.contains(&message){report.changes.push(message);}
            }
        }

        report.phase("preflight", &mut phase);
        if rebuilding {
            // @ref LLP 3000.000#implementation-follow-up — keys are still evaluated,
            // admitted and published in this transaction. Spill the key stream to
            // SQLite's temporary store, then insert in B-tree order instead of
            // repeatedly dirtying scattered main-database pages for every row.
            let ordered = programs.is_some() && plans.values().any(|plan| !plan.indexes.is_empty());
            #[cfg(test)]
            let ordered = ordered && !self.full_adoption;
            if ordered {
                super::activation_index::create(&tx)?;
            }
            // Removed names retain only their catalog number, never live row
            // images. Reintroducing a name starts empty, without resurrection.
            let active = super::activation_plan::active_names(schema);
            for (name, num) in &catalog {
                if !active.contains(name) {
                    tx.conn().execute("DELETE FROM r WHERE t = ?1", [num])?;
                    tx.conn().execute("DELETE FROM i WHERE ti = ?1", [num])?;
                }
            }
            for (name, table) in schema.tables.iter().filter(|(_,t)| t.ephemeral.is_none()) {
                let t = catalog[name];
                let plan = &plans[name];
                // Launch put() already built these fresh indexes under the
                // complete candidate schema. Keep the final invariant pass,
                // but do not delete and reconstruct the same entries again.
                if launches.iter().any(|launch| {
                    schema.timelines.iter().any(|timeline| {
                        timeline.name == launch.name && ["Posts", "Work", "Edges", "Feed"].iter()
                        .any(|suffix| timeline.table(suffix) == *name)
                    })
                }) { continue; }
                if !plan.project && plan.indexes.is_empty() { continue; }
                let started = std::time::Instant::now();
                for index in &plan.indexes { tx.conn().execute("DELETE FROM i WHERE ti = ?1", [catalog[&format!("{name}.{index}")]])?; }
                let work = crate::rows::adoption::Work::table(table);
                let scratch = |row: &Value| crate::rows::adoption::contribution_bytes(row, table);
                walk_metered(&tx, t, work, if work.index_entries != 0 { Some(&scratch) } else { None }, |id, mut row, contribution_meter| {
                    let keep = |column: &str| {
                            table.columns.contains_key(column) || (programs.is_none() && column == "pending")
                        };
                    let project = plan.project && row.as_object().is_ok_and(|fields| fields.keys().any(|column| !keep(column)));
                    // Persist only a destructive projection. Defaults and
                    // optionals are an interpretation of the stored image.
                    if project {
                        if let Value::Row(fields) | Value::Map(fields) = &mut row { fields.retain(|column, _| keep(column)); }
                        tx.conn().execute("UPDATE r SET data = ?1 WHERE t = ?2 AND id = ?3", params![canonical_json(&row), t, id])?;
                    }
                    materialize_optional_fields(&mut row, table);
                    // A device's prediction mark is metadata, retained in
                    // storage but absent from the row the schema validates.
                    if programs.is_none() { if let Value::Row(fields) = &mut row { fields.remove("pending"); } }
                    // Maintained rows are replaced by the candidate builder.
                    if schema.maintain_for(name).is_none() { crate::engine::validate::validate_row(schema, name, &row)?; }
                    for index_name in &plan.indexes {
                        let index = &table.indexes[index_name];
                        let scratch = contribution_meter.mark();
                        let contribution = match index.components.first() { Some(crate::schema::IndexComponent::Contribution(m)) => Some(m), _ => None };
                        if let Some(m) = contribution {
                            contribution_meter.at(&format!("adopt {name}.{index_name}"));
                            contribution_meter.charge(crate::error::MeterKind::Examined, 1)?;
                            contribution_meter.step(m.evaluation_steps())?;
                            crate::rows::adoption::charge(contribution_meter, crate::rows::adoption::contribution_bytes(&row, table))?;
                        }
                        for key in index_keys(index, &row, id) {
                            if key.len() > crate::rows::MAX_INDEX_KEY_BYTES {
                                return Err(crate::rows::index_key_refusal(name, index_name, 1));
                            }
                            if contribution.is_some() { contribution_meter.charge(crate::error::MeterKind::IndexEntries, 1)?; }
                            super::activation_index::insert(&tx, ordered, catalog[&format!("{name}.{index_name}")], &key, id)?;
                        }
                        contribution_meter.release_heap(scratch);
                    }
                    Ok(())
                })?;
                let label = super::adoption_report::table_label(schema, name);
                report.detail(format!("project/index {label} ({} indexes)", plan.indexes.len()), started);
            }
            if ordered {
                let started = std::time::Instant::now();
                tx.conn().execute_batch("INSERT INTO main.i(ti, k, id) SELECT ti, k, id FROM temp._adoption_index ORDER BY ti, k; DROP TABLE temp._adoption_index;")?;
                report.detail("ordered index insertion", started);
            }
        }
        report.phase("project and index", &mut phase);
        // Upgrade old stores and rebuild only when the schema changes. Counts
        // participate in the same activation transaction as rows and indexes.
        if cap_counts && (population_changed || tx.meta("cap_counts_schema")?.as_deref() != Some(&schema_hash)) {
            tx.conn().execute_batch("DELETE FROM _cap_counts;")?;
            for (name, table) in schema.tables.iter().filter(|(_,t)| t.ephemeral.is_none()) {
                if table.is_expiring() && table.constraints.iter().any(|c| matches!(c, Constraint::Cap { .. })) {
                    walk(&tx, catalog[name], |_, row| {
                        tx.update_cap_counts(name, table, None, Some(&row)).map(|_| ())
                    })?;
                }
            }
            tx.set_meta("cap_counts_schema", &schema_hash)?;
        }
        report.phase("cap counts", &mut phase);
        build(&tx, changed, &mut report)?;
        if rebuilding || reset || tx.meta(super::time_audience::PUBLICATION_STATE_KEY)?.as_deref() != Some("1") {
            tx.rebuild_time_audiences(schema, now)?;
        }
        report.phase("derived rebuild", &mut phase);
        if rebuilding && programs.is_some() && super::dormant::enabled(&tx)? {
            super::adopt_refusals::candidate(&tx,schema,if population_changed{None}else{previous.as_ref()},true)?;
        }
        if rebuilding {
            for (name, table) in schema.tables.iter().filter(|(_,t)| t.ephemeral.is_none()) {
                let plan = &plans[name];
                // @ref LLP 3000.019#3.6 — physical reuse cannot exempt rebuilt rows from unchanged invariants.
                let rebuilt = schema.maintain_for(name).is_some_and(|m| {
                    previous.as_ref().is_none_or(|old| crate::successor::maintain_rebuild_needed(old, schema, m))
                });
                if plan.project || rebuilt {
                walk(&tx, catalog[name], |_, mut row| {
                    materialize_optional_fields(&mut row, table);
                    if programs.is_none() { if let Value::Row(fields) = &mut row { fields.remove("pending"); } }
                    crate::engine::validate::validate_maintained_cache(schema, name, &row)?;
                    for (column, kind) in &table.columns { validate_assets(&tx, kind, row.field(column).ok())?; }
                    Ok(())
                })?;
                }
                for (index_name, index) in table.indexes.iter().filter(|(name, i)| {
                    i.unique && (plan.project || rebuilt || plan.indexes.contains(*name))
                }) {
                    validate_groups(&tx, name, index_name, index.components.len(), 1, true)?;
                }
                // @ref LLP 3000.039#2.2 — a `set null` cap skips its null group; adding or removing that exemption re-validates the cap.
                let exemption_changed = previous.as_ref().is_some_and(|old| old.tables.get(name).is_some_and(|old| old.constraints.iter().any(|c|
                    matches!(c, Constraint::Cap { by, .. } if old.cap_exempts_null(by) != table.cap_exempts_null(by)))));
                for constraint in table.constraints.iter().filter(|_| plan.project || rebuilt || exemption_changed) {
                    if let Constraint::Cap { by, max } = constraint {
                        let (index_name, _) = table.indexes.iter().find(|(_, i)| i.is_plain() && i.columns().starts_with(by)).ok_or_else(|| {
                                RuntimeError::Schema(format!("{name} cap has no matching index"))
                            })?;
                        validate_groups(&tx, name, index_name, by.len(), u64::from(*max), table.cap_exempts_null(by))?;
                    }
                }
            }
        }
        report.phase("validation", &mut phase);
        if rebuilding {
            // A removed asset home is retired in the same transaction as its
            // projection. The ordinary collector removes bytes after commit.
            let homes: Vec<(String, String)> = tx.conn().prepare("SELECT DISTINCT home_table, home_column FROM _assets WHERE home_table IS NOT NULL AND released_at IS NULL")?.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<_, _>>()?;
            for (table, column) in homes {
                if schema.table(&table).and_then(|t| t.columns.get(&column)).is_none_or(|kind| !contains_asset_type(kind)) && !super::dormant::holds_home(&tx,&table,&column)? {
                    tx.conn().execute("UPDATE _assets SET released_at = ?3 WHERE home_table = ?1 AND home_column = ?2 AND released_at IS NULL", params![table, column, crate::now_ms()])?;
                }
            }
        }
        let previous = tx.conn().query_row("SELECT value FROM _meta WHERE key = 'generation'", [], |row| row.get::<_, String>(0)).optional()?.and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
        let generation = if programs.is_some() && changed { previous.checked_add(1).ok_or_else(|| RuntimeError::Generation("generation overflow".into()))? } else { previous.max(1) };
        tx.set_meta("schema_hash", &schema_hash)?;
        if let Some(hash) = &activation_hash {
            tx.set_meta("index_keys_validated", &format!("{}:{hash}", crate::rows::MAX_INDEX_KEY_BYTES))?;
        } else {
            tx.conn().execute("DELETE FROM _meta WHERE key = 'index_keys_validated'", [])?;
        }
        if let (Some(hash), Some(programs)) = (&activation_hash, programs) {
            tx.set_meta("activation_hash", hash)?;
            tx.set_meta("generation", &generation.to_string())?;
            if changed {
                tx.conn().execute("INSERT INTO _generations(generation, schema, programs, at) VALUES (?1, ?2, ?3, ?4)", params![i64::try_from(generation).map_err(|_| RuntimeError::Generation("generation overflow".into()))?, canonical_json(schema), canonical_json(programs), crate::now_ms()])?;
            }
            // Inspection-only metadata shares the successful activation's
            // transaction, but never its schema bytes, hash or generation.
            if let Some(indexes) = &schema.authored_indexes.0 {
                let record = crate::schema::inspection::Record {
                    generation, schema_hash, indexes: indexes.clone(),
                };
                tx.set_meta(crate::schema::inspection::META_KEY, &canonical_json(&record))?;
            }
        }
        let after = identity(tx.conn())?;
        let result = finish(&tx)?;
        report.phase("metadata", &mut phase);
        tx.commit()?;
        report.phase("commit", &mut phase);
        // Reopening an unchanged backend must not announce a new adoption.
        self.adoption_report = if changed || reset { report } else { Default::default() };
        // Historical ordinals stay in _catalog, but no runtime transaction can address memory tables.
        catalog.retain(|name,_| {
            !schema.tables.iter().any(|(table,t)| {
                t.ephemeral.is_some() && (name == table || name.starts_with(&format!("{table}.")))
            })
        });
        self.catalog = catalog;
        self.identity = after;
        self.accept_open();
        Ok((generation, result))
    }
}

// @ref LLP 3000.019#3.6 — a key-bound proof must be invalidated even by direct SQL edits.
fn index_key_guards(conn: &Connection) -> Result<(), RuntimeError> {
    let limit = crate::rows::MAX_INDEX_KEY_BYTES;
    let insert = format!("_index_keys_insert_{limit}");
    let update = format!("_index_keys_update_{limit}");
    let installed: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_schema WHERE type = 'trigger' AND name IN (?1, ?2)",
        params![insert, update], |r| r.get(0),
    )?;
    if installed != 2 {
        // A predecessor without both guards could have retained a proof across
        // physical edits. Install and revalidate in this activation transaction.
        conn.execute("DELETE FROM _meta WHERE key = 'index_keys_validated'", [])?;
        conn.execute_batch(&format!(
            "CREATE TRIGGER IF NOT EXISTS {insert} AFTER INSERT ON i WHEN length(NEW.k) > {limit}
             BEGIN DELETE FROM _meta WHERE key = 'index_keys_validated'; END;
             CREATE TRIGGER IF NOT EXISTS {update} AFTER UPDATE OF k ON i WHEN length(NEW.k) > {limit}
             BEGIN DELETE FROM _meta WHERE key = 'index_keys_validated'; END;"
        ))?;
    }
    Ok(())
}

/// Equal prefixes are adjacent in an index. Validate uniqueness and caps
/// in one bounded pass per invariant, retaining one key rather than one
/// allocation for every group/row in a potentially large activation.
fn validate_groups(tx: &Tx<'_>, table: &str, index: &str, prefix_len: usize, max: u64, nulls_distinct: bool) -> Result<(), RuntimeError> {
    use crate::{error::MeterKind, meter::{Ceilings, Cut, Meter}, rows::word_heap as heap};
    // Only encoded group keys matter. Fetching source images here would
    // recreate an unmetered 500-row payload buffer after the metered rebuild.
    let mut statement = tx.conn().prepare_cached("SELECT k FROM i WHERE ti = ?1 ORDER BY k")?;
    let mut rows = statement.query([tx.num(&format!("{table}.{index}"))?])?;
    let mut previous: Option<Vec<Value>> = None;
    let mut count = 0;
    let mut visited = 0;
    let mut meter = Meter::new(Ceilings::job(), Cut::Abort);
    while let Some(row) = rows.next()? {
        if visited % 256 == 0 {
            meter = Meter::new(Ceilings::job(), Cut::Abort);
            meter.at(&format!("adopt {table}.{index} groups"));
            meter.once(crate::meter::HeapSite::SqliteColumns, 2 * tx.page_size)?;
        }
        visited += 1;
        let scratch = meter.mark();
        meter.charge(MeterKind::Examined, 1)?;
        let key = row.get_ref(0)?.as_blob().map_err(|e| RuntimeError::Store(e.to_string()))?;
        meter.heap(heap::key_decode(key.len(), key.len()))?;
        if let Some(values) = &previous {
            meter.heap(heap::slots::<Value>(values.len()))?;
            crate::engine::authorized_scan::InternalLedger::with_meter(&mut meter, |meter, scope| {
                for value in values { value.retained_internal(scope).charge(meter, scope)?; }
                Ok::<_, RuntimeError>(())
            })?;
        }
        let mut group = crate::key::decode(key).ok_or_else(|| RuntimeError::Store("invalid rebuilt index key".into()))?;
        group.truncate(prefix_len);
        if !(nulls_distinct && group.contains(&Value::Null)) {
            if previous.as_ref() == Some(&group) { count += 1; } else { previous = Some(group); count = 1; }
            if count > max { return Err(RuntimeError::Constraint(format!("cannot activate {table}.{index}: existing group exceeds {}", if nulls_distinct { "a unique key".to_owned() } else { format!("cap {max}") }))); }
        }
        meter.release_heap(scratch);
    }
    Ok(())
}

fn contains_asset_type(kind: &crate::schema::ColumnType) -> bool {
    use crate::schema::ColumnType::*;
    match kind { Optional(inner) | List { of: inner, .. } | ListRange { of: inner, .. } => {
            contains_asset_type(inner)
        }
        Image { .. } | Video { .. } | File { .. } => true, _ => false }
}
pub(super) fn validate_assets(tx: &Tx<'_>, kind: &crate::schema::ColumnType, value: Option<&Value>) -> Result<(), RuntimeError> {
    use crate::assets::AssetKind;
    use crate::schema::ColumnType::*;
    match (kind, value) {
        (Optional(inner), Some(value)) => validate_assets(tx, inner, Some(value)),
        (List { of, .. } | ListRange { of, .. }, Some(Value::Array(values))) => { for value in values { validate_assets(tx, of, Some(value))?; } Ok(()) }
        (Image { .. } | Video { .. } | File { .. }, Some(value)) => {
            let (wanted, max, types) = kind.asset_leaf().expect("an asset leaf");
            if let Some(id) = crate::assets::asset_id(Some(value)) {
                if let Some(asset) = tx.asset(id)? {
                    if asset.kind != wanted { return Err(RuntimeError::Asset { code: "E_ASSET_TYPE", message: format!("cannot activate: {id} is {}, not {}", asset.kind.word(), wanted.word()) }); }
                    if wanted == AssetKind::File && !crate::assets::file_accepts(types, &asset.content_type) { return Err(RuntimeError::Asset { code: "E_ASSET_TYPE", message: format!("cannot activate: {id} is {}, which the column no longer accepts", asset.content_type) }); }
                    if asset.bytes > u64::from(max) { return Err(RuntimeError::Asset { code: "E_ASSET_TOO_LARGE", message: format!("cannot activate: {id} has {} bytes; the column takes at most {max}", asset.bytes) }); }
                }
            }
            Ok(())
        }
        _ => Ok(())
    }
}
