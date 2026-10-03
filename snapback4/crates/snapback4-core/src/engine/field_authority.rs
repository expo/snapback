//! Field writes use the old owner; row transition rules still constrain them.
// @ref LLP 3000.015#1 — ownership grants only the explicitly touched owned fields.
use super::runner::Runner;
use super::rules::{self, Probe};
use crate::{error::{MeterKind, RuntimeError}, schema::{Effect, RuleExpr}, value::Value};

/// Delivery accounting must not make another recipient's unknown membership
/// a dependency of the writer's prediction. Server witnesses remain exact.
struct DeliveryProbe<'a, 'b> {
    runner: &'a mut Runner<'b>,
    known: bool,
    allowance: &'a super::Authorization,
}

impl Probe for DeliveryProbe<'_, '_> {
    fn take_changes(&mut self) -> Option<Vec<(i64, super::rules::Verdict)>> { self.runner.witness_changes.take() }
    fn replace_expiry(&mut self, expiry: Option<i64>) -> Option<i64> { self.runner.next_expiry.replace(expiry) }
    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
        if !self.runner.read_charge(MeterKind::RuleProbes, 1)? { return Ok(false); }
        let (present, known) = self.runner.probe_witness(self.allowance, table, index, key, equalities, false)?;
        self.known &= known;
        Ok(present)
    }

    fn created(&mut self, _table: &str, _index: &str, _key: &[Value]) -> bool { false }
}

impl<'r> Runner<'r> {
    pub(crate) fn field_owner_can_read(&mut self, rule: &RuleExpr, owner: &str, row: &Value) -> Result<bool, RuntimeError> {
        // Recipient witnesses are exact but are not the caller's observations.
        // Partition accounting prepays their schema-derived probe/step bound.
        // A recipient's witness deadline never enters the writer's answer: the scope is dropped, not emitted.
        let delivery_expiry = self.next_expiry.scope();
        let result = self.authorized_scratch(self.rule_scratch(rule), &[], |runner, allowance| {
            let mut probe = DeliveryProbe { runner, known: true, allowance };
            let readable = rules::evaluate(rule, owner, None, row, false, &mut probe)?;
            Ok(readable && probe.known)
        });
        drop(delivery_expiry);
        result
    }

    pub(crate) fn prepay_field_delivery(&mut self, rule: &RuleExpr, slots: u64, maintained: bool) -> Result<(), RuntimeError> {
        let probes = slots.saturating_mul(rules::rule_probes(rule));
        if maintained {
            self.charge_maintain(MeterKind::RuleProbes, probes)?;
            self.charge_maintain(MeterKind::Steps, slots)?;
        } else {
            self.meter.charge(MeterKind::RuleProbes, probes)?;
            self.meter.step(slots)?;
        }
        Ok(())
    }

    pub(super) fn authorize_fields(&self, table: &str, row: &Value, supplied: &Value) -> Result<bool, RuntimeError> {
        let definition = &self.schema.tables[table];
        let fields = supplied.as_object()?;
        let mut owned = false;
        let mut ordinary = false;
        for field in fields.keys().filter(|field| field.as_str() != "id") {
            if let Some(authority) = definition.written_by.get(field) {
                owned = true;
                if !self.context.is_system() && row.field(&authority.owner).ok() != Some(&Value::Id(self.context.viewer.clone())) {
                    #[cfg(feature = "sqlite")]
                    self.refusing_clause(table, &format!("field authority {field}"));
                    return Err(RuntimeError::Structural { code: "E_FIELD_AUTHORITY", message: format!("{table}.{field} is written by .{}; omit {field} or write as the principal in .{} (guide rules)", authority.owner, authority.owner) });
                }
            } else { ordinary = true; }
        }
        Ok(owned && !ordinary)
    }

    pub(super) fn authorize_update_fields(&mut self, table: &str, old: &Value, next: &Value, patch: &Value, readable: bool) -> Result<(), RuntimeError> {
        let owned_only = self.authorize_fields(table, old, patch).map_err(|error| if readable { error } else { self.no_write_target() })?;
        // An unrelated owner's omitted field is unknown, not its literal
        // default. It prevents prediction only when this transition needs it,
        // or when changing ownership would expose it to this device.
        let definition = &self.schema.tables[table];
        if self.device && definition.written_by.iter().any(|(field, authority)|
            !authority.audience && old.field(&authority.owner).ok() != Some(&Value::Id(self.context.viewer.clone()))
            && ((!owned_only || definition.update_transition) && definition.rules.update.needs_field_value(field, &definition.columns[field])
                || next.field(&authority.owner).ok() == Some(&Value::Id(self.context.viewer.clone())))) {
            return Err(RuntimeError::Prediction(format!("{table}: this transition needs another principal's private field; queue it for the server (guide rules)")));
        }
        // @ref LLP 3000.015#1 — a named transition is not permission to test guesses against someone else's private value.
        if !self.context.is_system() && let Some((field, authority)) = definition.written_by.iter().find(|(field, authority)|
            !authority.audience && old.field(&authority.owner).ok() != Some(&Value::Id(self.context.viewer.clone()))
            && definition.rules.update.needs_field_value(field, &definition.columns[*field])) {
            #[cfg(feature = "sqlite")]
            self.refusing_clause(table, &format!("field authority {field}"));
            return Err(if readable { RuntimeError::Structural { code: "E_FIELD_AUTHORITY", message: format!("{table}.{field}: this transition needs the private value written by .{}; write as that owner or declare readable by audience (guide rules)", authority.owner) } } else { self.no_write_target() });
        }
        let transition = self.schema.tables[table].update_transition;
        if (!owned_only || transition) && !self.check_rule(table, Effect::Update, Some(old), next)? {
            return Err(if readable { RuntimeError::Rule { table: table.into(), effect: Effect::Update } } else { self.no_write_target() });
        }
        Ok(())
    }

    pub(crate) fn disclosed_row<'a>(&self, definition: &'a crate::schema::Table, row: Value) -> crate::value::Disclosed<'a> {
        match self.system_access() {
            Some(system) => definition.system_fields(row, &system),
            None => definition.project_fields(row, Some(&self.context.viewer)),
        }
    }

    // @ref LLP 3000.023#12 — disclose before pricing, filters and derived expressions.
    pub(crate) fn query_row(&self, name: &str, mut row: Value) -> crate::value::Disclosed<'r> {
        let table = &self.schema.tables[name];
        if self.once_disclosure {
            let slots = table.columns.values().filter(|ty| crate::revocation::once(ty))
                .fold(0u64, |n, ty| n.saturating_add(crate::once_read::slots(ty)));
            let remaining = self.once_slots.get();
            let admitted = slots <= remaining;
            self.once_slots.set(remaining.saturating_sub(slots));
            if let Value::Row(fields) | Value::Map(fields) = &mut row {
                let id = fields.get("id").and_then(|v| v.as_str().ok()).unwrap_or("").to_owned();
                for (column, ty) in &table.columns {
                    if !crate::revocation::once(ty) { continue; }
                    if let Some(value) = fields.get_mut(column) {
                        let proven = !self.device && !self.context.once_unproven && admitted && crate::once_read::cell(value, |asset_id| {
                            self.tx.asset(asset_id).ok().flatten().is_some_and(|asset| asset.released_at.is_none()
                                && asset.home.as_ref().is_some_and(|(t, r, c)| t == name && r == &id && c == column))
                                && self.tx.asset_unviewed(asset_id, &self.context.viewer)
                        });
                        if !proven { *value = Value::Null; }
                    }
                }
            }
        }
        self.disclosed_row(table, row)
    }

    pub(crate) fn project_row(&mut self, table: &str, row: Value) -> Result<super::authorized_point::AuthorizedRow<'r>, RuntimeError> {
        let definition = &self.schema.tables[table];
        // A merge may retain previously authorized results after its next lane
        // cuts. Revalidate their authority internally without treating that
        // existing logical cut as a denied row. Preserve the original cut.
        let cap = self.meter.capped_at.take();
        let result = self.authorized_scratch(self.rule_scratch(&definition.rules.read), &[], |runner, _| runner.authorize_image(table,row));
        if cap.is_some() { self.meter.capped_at = cap; }
        result?.ok_or_else(|| { self.refusing_clause(table, "read rule"); self.no_write_target() })
    }

    pub(super) fn private_scan_authority(&self, table: &str, uniform: bool, admitted: bool) -> Result<(), RuntimeError> {
        // A bounded hidden-row walk exposes population through both its meter
        // and its cut. Require a readable scope before walking protected rows.
        if !uniform && !admitted && self.schema.tables[table].written_by.values().any(|a| !a.audience) {
            return Err(RuntimeError::Structural { code: "E_FIELD_AUTHORITY", message: format!("{table}: scope this read to a uniformly readable audience before scanning rows with private fields (guide rules)") });
        }
        Ok(())
    }
}
