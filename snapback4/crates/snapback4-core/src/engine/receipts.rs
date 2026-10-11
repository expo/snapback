//! Generated receipts share the interpreter, meter and partition log.
// @ref LLP 3000.022#14 — receipt progress is owned; recipient removal retires runs atomically.
use super::runner::Runner;
use crate::{
    error::RuntimeError,
    rows::{Bounds, Dir},
    value::Value,
};

fn owned() -> RuntimeError {
    RuntimeError::Structural { code: "E_RECEIPTS_OWNED", message: "receipt accounting and progress are engine-owned; omit allocation, floor and count fields; call delivered or seen for the signed-in recipient (guide receipts)".into() }
}
impl Runner<'_> {
    // @ref LLP 3000.022#14.3 — local positions order the overlay, never receipts.
    pub(super) fn receipt_insert_fields(
        &mut self,
        table: &str,
        row: Value,
    ) -> Result<Value, RuntimeError> {
        if !self.schema.receipt_insert(table) {
            return Ok(row);
        }
        if self.device || !self.context.is_system() || !self.receipt_operation.is_empty() {
            let price = self.source_price(table, crate::schema::reservations::ALLOCATION)?;
            self.receipt_allocation |= self.device && price[0] != 0;
            self.charge_price(price)?;
        }
        if self.device {
            return self.predict_receipt_fields(table, row);
        }
        #[cfg(feature = "sqlite")]
        {
            self.assign_receipt_fields(table, row)
        }
        #[cfg(not(feature = "sqlite"))]
        {
            Ok(row)
        }
    }

    fn predict_receipt_fields(
        &mut self,
        table: &str,
        mut row: Value,
    ) -> Result<Value, RuntimeError> {
        if !self.check_rule(table, crate::schema::Effect::Insert, None, &row)? {
            return Err(self.rule_refusal(table, crate::schema::Effect::Insert, "insert rule"));
        }
        self.meter.heap(super::write_target::row_copy_ceiling(
            &self.schema.tables[table],
        ))?;
        for f in &self.schema.receipts {
            if table == f.scope {
                set(&mut row, &f.counter, 0)?;
            }
            if table != f.members && table != f.messages {
                continue;
            }
            let sending = table == f.messages;
            let group = row
                .field(if sending { &f.message_group } else { &f.group })?
                .clone();
            self.receipt_allocation |= self.device;
            let scope = self.receipt_scope(f, &group)?;
            let mut high = scope.field(&f.counter)?.as_int()?;
            if sending {
                self.receipt_membership(f, &group)?;
                let (index, _) = self.schema.tables[table]
                    .indexes
                    .iter()
                    .find(|(_, i)| {
                        i.unique && i.columns() == [f.message_group.as_str(), f.position.as_str()]
                    })
                    .unwrap();
                // One suffix probe includes this device's earlier pending sends.
                // The counter itself remains the last confirmed server image.
                let rows = self.metered_scan(|runner, allowance| {
                    runner.tx.scan_metered(
                        allowance,
                        table,
                        index,
                        &[group],
                        &Bounds::default(),
                        Dir::Desc,
                        1,
                        &mut runner.meter,
                    )
                })?;
                self.meter.charge(crate::error::MeterKind::IndexEntries, 1)?;
                if let Some((last, _)) = rows.first() {
                    self.meter.step(1)?;
                    self.meter.charge(crate::error::MeterKind::Examined, 1)?;
                    high = high.max(last.field(&f.position)?.as_int()?);
                }
                if high >= crate::value::I53_MAX {
                    return Err(RuntimeError::Prediction(
                        "no provisional receipt position fits; queue until settlement".into(),
                    ));
                }
                set(&mut row, &f.position, high + 1)?;
                set(&mut row, &f.count, 0)?;
            } else {
                set(&mut row, &f.floor, high)?;
            }
        }
        Ok(row)
    }

    fn receipt_membership(
        &mut self,
        f: &crate::schema::ReceiptFamily,
        group: &Value,
    ) -> Result<(), RuntimeError> {
        let (index, _) = self.schema.tables[&f.members]
            .indexes
            .iter()
            .find(|(_, i)| i.unique && i.columns() == [f.group.as_str(), f.principal.as_str()])
            .unwrap();
        let own = self.get(&crate::ir::Read {
            site: "receipt membership".into(),
            table: f.members.clone(),
            index: index.clone(),
            key: vec![
                crate::ir::Expr::Literal(group.clone()),
                crate::ir::Expr::Literal(Value::Id(self.context.viewer.clone())),
            ],
            provenance: crate::ir::KeyProvenance::Computed,
        })?;
        if own == Value::Null && !self.context.is_system() {
            return Err(RuntimeError::Require {
                code: "NOT_MEMBER".into(),
                site: None,
                message: None,
            });
        }
        Ok(())
    }

    #[cfg(feature = "sqlite")]
    fn assign_receipt_fields(
        &mut self,
        table: &str,
        mut row: Value,
    ) -> Result<Value, RuntimeError> {
        use crate::schema::Effect;
        // Supplied fields were checked before defaults. New scope counters are
        // always zero; trusted seed/import images retain their explicit values.
        if self.context.is_system() && self.receipt_operation.is_empty() {
            return Ok(row);
        }
        if !self.check_rule(table, Effect::Insert, None, &row)? {
            return Err(self.rule_refusal(table, Effect::Insert, "insert rule"));
        }
        self.meter.heap(super::write_target::row_copy_ceiling(
            &self.schema.tables[table],
        ))?;
        for f in &self.schema.receipts {
            if table == f.scope {
                set(&mut row, &f.counter, 0)?;
            }
            if table != f.members && table != f.messages {
                continue;
            }
            let sending = table == f.messages;
            let group = row
                .field(if sending { &f.message_group } else { &f.group })?
                .clone();
            self.receipt_allocation |= self.device;
            let scope = self.receipt_scope(f, &group)?;
            let high = scope.field(&f.counter)?.as_int()?;
            if high < 0 || high > crate::value::I53_MAX {
                return Err(RuntimeError::Input(
                    "receipt counter must be a nonnegative safe integer".into(),
                ));
            }
            if sending {
                if high == crate::value::I53_MAX {
                    return Err(super::sequences::exhausted());
                }
                // The admitted group-wide audience makes the complete membership
                // population readable to this member. Do not infer zero from a
                // filtered scan by a non-member (even one granted insert).
                let members = &self.schema.tables[&f.members];
                let (index, _) = members
                    .indexes
                    .iter()
                    .find(|(_, i)| {
                        i.unique && i.columns() == [f.group.as_str(), f.principal.as_str()]
                    })
                    .unwrap();
                self.receipt_membership(f, &group)?;
                // Membership is non-expiring and capped. Count index keys, not
                // private member payloads; their sizes cannot influence the
                // logical receipt meter or a count's refusal boundary.
                let (total, sender) = self.metered_scan(|runner, allowance| {
                    let total = runner.tx.count_prefix(
                        allowance,
                        &f.members,
                        index,
                        &[group.clone()],
                        50,
                    )?;
                    let sender = runner.tx.count_prefix(
                        allowance,
                        &f.members,
                        index,
                        &[group.clone(), row.field(&f.sender)?.clone()],
                        1,
                    )?;
                    Ok((total, sender))
                })?;
                // Key-count work is covered by the shared fixed allocation price.
                let count = (total - sender) as i64;
                set(&mut row, &f.position, high + 1)?;
                set(&mut row, &f.count, count)?;
            } else {
                set(&mut row, &f.floor, high)?;
            }
        }
        Ok(row)
    }

    fn receipt_scope(
        &mut self,
        f: &crate::schema::ReceiptFamily,
        group: &Value,
    ) -> Result<Value, RuntimeError> {
        let created = self
            .created_rows
            .contains_key(&(f.scope.clone(), group.as_str()?.into()));
        let scope = if created {
            self.metered_scan(|runner, allowance| {
                runner.fetch(allowance, &f.scope, group.as_str()?)
            })?
            .unwrap_or(Value::Null)
        } else {
            self.get(&crate::ir::Read {
                site: "receipt counter".into(),
                table: f.scope.clone(),
                index: "byId".into(),
                key: vec![crate::ir::Expr::Literal(group.clone())],
                provenance: crate::ir::KeyProvenance::Computed,
            })?
        };
        if scope == Value::Null {
            return Err(RuntimeError::Require {
                code: "NOT_FOUND".into(),
                site: None,
                message: None,
            });
        }
        // point_image() proves row authority but projects private fields. Preserve the
        // complete stored image when the engine replaces only its own counter.
        self.metered_scan(|runner, allowance| runner.fetch(allowance, &f.scope, group.as_str()?))?
            .ok_or_else(|| RuntimeError::Require {
                code: "NOT_FOUND".into(),
                site: None,
                message: None,
            })
    }

    // Only successful message insert arms consume a position. A duplicate
    // if-absent or any later refusal leaves both images unchanged by rollback.
    pub(super) fn commit_receipt_counter(
        &mut self,
        table: &str,
        row: &Value,
    ) -> Result<(), RuntimeError> {
        if self.context.is_system() && self.receipt_operation.is_empty() { return Ok(()); }
        for f in self.schema.receipts.iter().filter(|f| table == f.messages) {
            let old = self.receipt_scope(f, row.field(&f.message_group)?)?;
            let copy = super::write_target::row_copy_ceiling(&self.schema.tables[&f.scope]);
            self.meter.heap(copy)?;
            if crate::schema::reservations::simple_counter(self.schema, f) {
                // No guessed ordinal is consumed here on a device. The source
                // price reserves the counter replacement and its partition event.
                // The existing restoring scope executes bounded server work only.
                let price = crate::schema::reservations::counter_price(&self.schema.tables[&f.scope]);
                self.authorized_scratch(price[4], &[(crate::error::MeterKind::Steps, price[0]),
                    (crate::error::MeterKind::RowsWritten, price[3]),
                    (crate::error::MeterKind::IndexEntries, price[1]), (crate::error::MeterKind::Examined, price[2])], |runner, _| {
                    #[cfg(feature = "sqlite")]
                    if !runner.device {
                        let mut new = old.clone();
                        set(&mut new, &f.counter, row.field(&f.position)?.as_int()?)?;
                        runner.replace_authorized(&f.scope, old.clone(), new, true, &Value::Row(Default::default()), copy)?;
                    }
                    Ok(())
                })?;
            } else {
                if self.device { return Err(RuntimeError::Prediction("receipt counter has data-dependent maintenance".into())); }
                #[cfg(feature = "sqlite")]
                {
                    let mut new = old.clone();
                    set(&mut new, &f.counter, row.field(&f.position)?.as_int()?)?;
                    self.reserve_maintains(&f.scope, &self.schema.tables[&f.scope])?;
                    self.replace_authorized(&f.scope, old, new, true, &Value::Row(Default::default()), copy)?;
                }
            }
        }
        Ok(())
    }

    pub(super) fn receipt_result(
        &mut self,
        table: &str,
        row: Value,
    ) -> Result<Value, RuntimeError> {
        // The caller owns the insert image. Return only newly assigned ints,
        // not a read of other columns or a grant to read the new scope before
        // its founding membership exists.
        if self.schema.receipt_insert(table) {
            self.meter.heap(super::write_target::row_copy_ceiling(
                &self.schema.tables[table],
            ))?;
            let stored = self
                .metered_scan(|runner, allowance| {
                    runner.tx.get(allowance, table, row.field("id")?.as_str()?)
                })?
                .ok_or_else(|| RuntimeError::Require {
                    code: "NOT_FOUND".into(),
                    site: None,
                    message: None,
                })?;
            // @ref LLP 3000.007#5.4 — total ordinary fields and assigned
            // receipt ints share this already-reserved full result map copy.
            let mut row = self.complete_insert_result(table, row, true)?;
            for family in &self.schema.receipts {
                for field in family.assigned(table) {
                    set(&mut row, field, stored.field(field)?.as_int()?)?;
                }
            }
            self.stamp_source(table, &mut row)?;
            return Ok(row);
        }
        Ok(row)
    }

    pub(super) fn refuse_receipt_fields(
        &self,
        table: &str,
        patch: &Value,
        inserting: bool,
    ) -> Result<(), RuntimeError> {
        if self.context.is_system() && self.receipt_operation.is_empty() {
            return Ok(());
        }
        for family in &self.schema.receipts {
            if family
                .assigned(table)
                .any(|field| patch.as_object().is_ok_and(|p| p.contains_key(field)))
            {
                return Err(owned());
            }
            if family.members != table {
                continue;
            }
            for (field, operation) in [
                (family.delivered_field.as_str(), &family.delivered),
                (family.seen_field.as_str(), &family.seen),
            ] {
                if patch.as_object()?.contains_key(field)
                    && !(inserting && patch.field(field)? == &Value::Int(0))
                    && self.receipt_operation != *operation
                    && !(field == family.delivered_field
                        && self.receipt_operation == family.compact)
                {
                    return Err(owned());
                }
            }
        }
        Ok(())
    }
    pub(super) fn refuse_receipt_scope_delete(&self, table: &str) -> Result<(), RuntimeError> {
        if (!self.context.is_system() || !self.receipt_operation.is_empty())
            && self.schema.receipts.iter().any(|f| f.scope == table)
        {
            return Err(owned());
        }
        Ok(())
    }
    pub(super) fn refuse_receipt_table(&self, table: &str) -> Result<(), RuntimeError> {
        if self.context.is_system() && self.receipt_operation.is_empty() {
            return Ok(());
        }
        if self.schema.receipts.iter().any(|f| {
            table == f.runs
                && self.receipt_operation != f.delivered
                && self.receipt_operation != f.compact
        }) {
            return Err(owned());
        }
        Ok(())
    }
    pub(super) fn receipt_member_removed(
        &mut self,
        table: &str,
        member: &Value,
    ) -> Result<(), RuntimeError> {
        for family in &self.schema.receipts {
            if table != family.members {
                continue;
            }
            let runs = &self.schema.tables[&family.runs];
            let (index, _) = runs
                .indexes
                .iter()
                .find(|(_, i)| {
                    i.unique
                        && i.columns() == [family.run_group.as_str(), "principal", "fromOrdinal"]
                })
                .ok_or_else(|| RuntimeError::Schema("receipt runs needs its unique key".into()))?;
            let prefix = [
                member.field(&family.group)?.clone(),
                member.field(&family.principal)?.clone(),
            ];
            if self.device && !self.tx.current_group(&family.runs, index, &prefix)? {
                self.unknown_fact(
                    &family.runs,
                    index,
                    &prefix,
                    "receipt removal needs complete run coverage",
                );
            }
            // This is storage retirement, not disclosure. The member delete
            // authorized exactly these rows; never install a broader viewer.
            self.meter
                .heap(crate::rows::word_heap::slots::<(Value, Vec<u8>)>(64))?;
            let rows = self.metered_scan(|runner, scope| {
                runner.tx.scan_metered(
                    scope,
                    &family.runs,
                    index,
                    &prefix,
                    &Bounds::default(),
                    Dir::Asc,
                    64,
                    &mut runner.meter,
                )
            })?;
            for (run, _) in rows {
                self.meter.step(1)?;
                self.meter.charge(crate::error::MeterKind::Examined, 1)?;
                self.meter
                    .charge(crate::error::MeterKind::IndexEntries, 1)?;
                self.delete_authorized(&family.runs, run)?;
            }
        }
        Ok(())
    }
}

fn set(row: &mut Value, field: &str, value: i64) -> Result<(), RuntimeError> {
    if let Value::Row(fields) | Value::Map(fields) = row {
        fields.insert(field.into(), Value::Int(value));
    } else {
        return Err(RuntimeError::Input("receipt insert must be a row".into()));
    }
    Ok(())
}
