//! Birth and mirroring of maintained fields. Private totals are authoritative.
// @ref LLP 3000.007.001#3.2 — never probe parent authority or resurrect expired rows.
use super::{runner::Runner, write_target::row_copy_ceiling};
#[cfg(feature = "sqlite")]
use super::write::Origin;
use crate::{error::{MeterKind, RuntimeError}, schema::{Maintain, maintained_id}, value::Value};

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
            let total = self.tx.get(&m.target,&maintained_id(&[id.clone()]))?
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
        let Some(old) = self.tx.get(&owner.table,id)? else { return Ok(()) };
        if table.expired(&old,self.context.now.unwrap_or(0)) { return Ok(()) }
        if old.field(&owner.column).cloned().unwrap_or(Value::Int(0)) == Value::Int(total) { return Ok(()) }
        let mut row = old.clone();
        if let Value::Row(fields) | Value::Map(fields) = &mut row { fields.insert(owner.column.clone(),Value::Int(total)); }
        let entries = self.tx.put(&owner.table,&table,&row,Some(&old))?;
        self.charge_maintain(MeterKind::IndexEntries,entries)?;
        self.row_changed(&owner.table,Some(&old),Some(&row),Origin::Maintained)
    }

    /// Always prepaid, even for public unfiltered sources and the system.
    /// Ordinary maintains retain their separate reservation/actual charging.
    pub(super) fn reserve_columns(&mut self, source: &str) -> Result<(),RuntimeError> {
        if self.device { return Ok(()) }
        let mut steps = 0_u64;
        let mut entries = 0_u64;
        let mut heap = 0_u64;
        let mut count = 0_u64;
        for m in self.schema.maintains.iter().filter(|m|m.source == source && m.private.is_some()) {
            let owner = m.private.as_ref().unwrap();
            let target = &self.schema.tables[&m.target];
            let parent = &self.schema.tables[&owner.table];
            count += 1;
            steps = steps.saturating_add(m.evaluation_steps()*2 + 8);
            // A words index can order by the maintained column. Each token then
            // changes two keys, on each of the old and new parents.
            let parent_entries = parent.indexes.values().map(|index| {
                if let Some((_,fields)) = index.word_component() {
                    fields.iter().filter_map(|field|parent.columns.get(field)).map(|kind| match kind.required() {
                        crate::schema::ColumnType::Text { max } => u64::from(*max), _ => 0,
                    }).sum::<u64>().min(crate::words::MAX_TOKENS_PER_ROW as u64)
                } else { 1 }
            }).sum::<u64>();
            entries = entries.saturating_add(4*(target.indexes.len() as u64+parent_entries));
            // Account for word-key buffers as well as the ordinary row copies.
            heap = heap.saturating_add(4*parent_entries.saturating_sub(parent.indexes.len() as u64)
                *(crate::rows::MAX_INDEX_KEY_BYTES as u64+24));
            heap = heap.saturating_add(row_copy_ceiling(&self.schema.tables[source])*2)
                .saturating_add(row_copy_ceiling(target)*(16+4*target.indexes.len() as u64))
                .saturating_add(row_copy_ceiling(parent)*(16+4*parent.indexes.len() as u64));
        }
        for (kind,amount) in [(MeterKind::Steps,steps),(MeterKind::IndexEntries,entries),(MeterKind::Examined,4*count),
            (MeterKind::RowsWritten,4*count),(MeterKind::HeapBytes,heap)] { self.meter.charge(kind,amount)?; }
        self.column_heap = heap;
        self.column_prepaid = count > 0;
        Ok(())
    }
}
