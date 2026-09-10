use super::*;
use super::runner_ops::RowChangeOrigin;
use crate::delivery;

impl Runner<'_> {
    // @ref LLP 1019#6-receipts-with-receipts — current recipient membership
    // is a private bounded probe, not a client claim or a read receipt.
    pub(super) fn acknowledge(&mut self, table: &str, old: &Value) -> Result<bool, RuntimeError> {
        if self.rule_authority == RuleAuthority::ReceiptOnly {
            self.missing_authority = true;
            self.authority_miss_serial += 1;
            return Ok(false);
        }
        if old.field("received")? == &Value::Bool(true) { return Ok(false); }
        if old.field("recipient")?.as_str()? != self.context.viewer() { return Ok(false); }
        let (_, d, _) = delivery::owner(self.schema, table).expect("canonical acknowledgement");
        let target = &self.schema.tables[&d.target];
        let (index, definition) = crate::cap::enforcement_index(target, &d.prefix).unwrap();
        let log = self.env.get("original").ok_or_else(|| RuntimeError::TraceSubset("receipt has no delivery".into()))?;
        if log == &Value::Null || log.field("id")? != old.field("id")? { return Ok(false); }
        let prefix = crate::cap::group_key(log, &d.prefix);
        let limit = u64::from(delivery::group_cap(target, &d.prefix).unwrap()) + 1;
        let certificate = self.certificate.unwrap();
        let check = format!("{}:DeliveryAcknowledgement", d.target);
        if !certificate.indexes_required.contains(&format!("{}.{index}", d.target))
            || !certificate.constraint_checks.contains(&check)
            || certificate.max_examined < limit || certificate.max_index_entries < limit {
            return Err(RuntimeError::TraceSubset("missing delivery acknowledgement reserve".into()));
        }
        let rows = scan_indexed(self.tx, &d.target, index, target, definition, &prefix,
            None, None, None, Order::Asc, limit as usize)?;
        self.trace.examined += rows.len() as u64;
        self.trace.constraint_inputs.push(ConstraintTrace { table: d.target.clone(), check: "DeliveryAcknowledgement".into(),
            index: index.clone(), prefix, examined_ids: row_ids(&rows)? });
        self.step(limit * 5)?;
        Ok(rows.iter().any(|row| row.field(&d.principal).is_ok_and(|p| p == &Value::Id(self.context.viewer().into()))))
    }

    // False is initialized with custody; later body changes keep the copied
    // read-rule inputs current. Only acknowledge can change false to true.
    pub(super) fn delivery_receipt(&mut self, d: &delivery::Deliver, content: &Value, event: &Value) -> Result<(), RuntimeError> {
        let Some(table) = d.receipts_table() else { return Ok(()); };
        let id = event.field("id")?.as_str()?;
        let old = self.fetch_id(&table, id)?;
        let certificate = self.certificate.unwrap();
        let reserved = self.delivery_write_reserves.entry(table.clone()).or_default();
        *reserved += 1;
        if *reserved > certificate.write_sites.iter().filter(|w| w.table == table).map(|w| w.max_rows).sum::<u64>()
            || !certificate.constraint_checks.contains(&format!("{table}:DeliveryReceipt"))
            || !certificate.indexes_required.contains(&format!("{table}.byId")) {
            return Err(RuntimeError::TraceSubset("missing delivery receipt reserve".into()));
        }
        self.trace.examined += u64::from(old.is_some());
        self.trace.constraint_inputs.push(ConstraintTrace { table: table.clone(), check: "DeliveryReceipt".into(),
            index: "byId".into(), prefix: vec![Value::Id(id.into())], examined_ids: if old.is_some() { vec![id.into()] } else { vec![] } });
        self.step(5)?;
        let received = old.as_ref().is_some_and(|r| r.field("received").ok() == Some(&Value::Bool(true)));
        let seq = old.as_ref().and_then(|r| r.field("seq").ok()).and_then(|v| v.as_int().ok()).unwrap_or(self.seq as i64);
        let row = delivery::receipt_row(self.schema, content, event, &table, received, seq)?;
        if old.as_ref() == Some(&row) { return Ok(()); }
        validate_row(self.schema, &table, &row)?;
        self.tx.execute("INSERT INTO rows(table_name,row_id,data) VALUES (?1,?2,?3) ON CONFLICT(table_name,row_id) DO UPDATE SET data=excluded.data",
            params![table, id, canonical_json(&row)])?;
        let work = reindex_row(self.tx, self.schema, &table, &row)?;
        self.finish_row_change(&table, old.as_ref(), Some(&row), work, RowChangeOrigin::Source)
    }
}
