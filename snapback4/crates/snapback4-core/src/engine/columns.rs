//! Birth and mirroring of maintained fields. Private totals are authoritative.
// @ref LLP 3000.007.001#3.2 — never probe parent authority or resurrect expired rows.
use super::runner::Runner;
#[cfg(feature = "sqlite")]
use super::write_target::row_copy_ceiling;
#[cfg(feature = "sqlite")]
use super::write::Origin;
use crate::{error::{MeterKind, RuntimeError}, schema::{Maintain, reservations::{COLUMNS, ASSETS}}, value::Value};
#[cfg(feature = "sqlite")]
use crate::schema::maintained_id;

pub(crate) fn write_result(table: &crate::schema::Table, mut row: Value) -> Value {
    if let Value::Row(fields) | Value::Map(fields) = &mut row { fields.retain(|field,_| !table.maintained.contains_key(field)); }
    row
}

/// Preparation replaces contribution indexes, so refuse forbidden dependencies
/// while the caller's resolved declarations are still present.
#[cfg(feature = "sqlite")]
pub(super) fn validate_before_prepare(schema: &crate::schema::Schema) -> Result<(),RuntimeError> {
    if let Some(issue) = crate::schema::columns::timeline_issues(schema).first() {
        return Err(RuntimeError::Structural { code: "E_MAINTAINED_COLUMN", message: issue.message.clone() });
    }
    if let Some(issue) = crate::schema::columns::validate(schema).first() {
        let mut message=format!("{}: {}",issue.path,issue.message);
        for m in schema.maintains.iter().filter(|m|m.private.is_some()) { message=message.replace(&m.target,&m.label()); }
        return Err(RuntimeError::Schema(message));
    }
    Ok(())
}


impl Runner<'_> {
    #[cfg(feature = "sqlite")]
    pub(super) fn rebuild_imported_columns(&mut self) -> Result<(),RuntimeError> {
        let declarations: Vec<_> = self.schema.maintains.iter().filter(|m|m.private.is_some()).cloned().collect();
        for m in declarations {
            self.rebuild_maintain(&m)?;
            self.mirror_column_pass(&m)?;
        }
        Ok(())
    }

    // @ref LLP 3000.007.001#3.2 — devices preserve synchronized column values;
    // only the server reads private totals or performs their mirrored writes.
    #[cfg(not(feature = "sqlite"))]
    pub(super) fn birth_columns(&mut self, _name: &str, row: Value) -> Result<Value,RuntimeError> { Ok(row) }

    #[cfg(feature = "sqlite")]
    pub(super) fn birth_columns(&mut self, name: &str, mut row: Value) -> Result<Value,RuntimeError> {
        if self.device { return Ok(row); }
        let declarations: Vec<_> = self.schema.maintains.iter().filter(|m|m.private.as_ref().is_some_and(|o|o.table == name)).cloned().collect();
        if declarations.is_empty() { return Ok(row); }
        let id = row.field("id")?.clone();
        // A fixed ceiling includes cloning an existing private image and stamping the parent.
        self.meter.heap(row_copy_ceiling(&self.schema.tables[name]))?;
        for m in declarations {
            self.meter.charge(MeterKind::Examined,1)?;
            self.meter.heap(row_copy_ceiling(&self.schema.tables[&m.target]))?;
            let total = self.metered_scan(|runner, allowance| runner.tx.get(allowance, &m.target,&maintained_id(&[id.clone()])))?
                .and_then(|r|r.field("value").ok().cloned()).unwrap_or(Value::Int(0));
            if let Value::Row(fields) | Value::Map(fields) = &mut row { fields.insert(m.private.as_ref().unwrap().column.clone(),total); }
        }
        Ok(row)
    }

    // Without the server feature the interpreter only runs projected device
    // schemas. Those contain no private maintains, so there is nothing to mirror.
    #[cfg(not(feature = "sqlite"))]
    pub(super) fn mirror_column(&mut self, _m: &Maintain, _key: &[Value], _total: i64) -> Result<(),RuntimeError> { Ok(()) }

    #[cfg(feature = "sqlite")]
    pub(super) fn mirror_column(&mut self, m: &Maintain, key: &[Value], total: i64) -> Result<(),RuntimeError> {
        if self.column_rebuild { return Ok(()) }
        let Some(owner) = &m.private else { return Ok(()) };
        self.refuse_timeline_write(&owner.table, crate::schema::Effect::Update)?;
        let Some(Value::Id(id)) = key.first() else { return Ok(()) };
        self.written_tables.insert(owner.table.clone());
        self.charge_maintain(MeterKind::Examined,1)?;
        let table = self.schema.tables[&owner.table].clone();
        let Some(old) = self.metered_scan(|runner, allowance| runner.tx.get(allowance, &owner.table,id))? else { return Ok(()) };
        if table.expired(&old,self.context.now.unwrap_or(0)) { return Ok(()) }
        if old.field(&owner.column).cloned().unwrap_or(Value::Int(0)) == Value::Int(total) { return Ok(()) }
        let mut row = old.clone();
        if let Value::Row(fields) | Value::Map(fields) = &mut row { fields.insert(owner.column.clone(),Value::Int(total)); }
        let entries = self.tx.put(&owner.table,&table,&row,Some(&old))?;
        self.charge_maintain(MeterKind::IndexEntries,entries)?;
        self.row_changed(&owner.table,Some(&old),Some(&row),Origin::Maintained)
    }

    // All source attempts use the same complete plan, independent of receipts.
    pub(super) fn reserve_columns(&mut self, source: &str) -> Result<(),RuntimeError> {
        // Preserve the write authority/schema refusal for an unknown raw target.
        if self.schema.table(source).is_none() { return Ok(()); }
        let price = self.source_price(source, COLUMNS)?;
        self.reservation_deferred |= self.device && price[3] != 0;
        self.charge_price(price)?;
        self.column_heap = price[4];
        self.column_prepaid = price[3] > 0;
        let assets = self.source_price(source, ASSETS)?;
        if self.device || self.tx.holds_assets() {
            self.charge_price(assets)?;
            self.column_heap = self.column_heap.saturating_add(assets[4]);
        }
        #[cfg(feature = "sqlite")]
        { self.assets_prepaid = true; }
        Ok(())
    }
}
