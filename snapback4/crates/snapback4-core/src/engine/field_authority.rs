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
}

impl Probe for DeliveryProbe<'_, '_> {
    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
        if !self.runner.read_charge(MeterKind::RuleProbes, 1)? { return Ok(false); }
        let (present, known) = self.runner.probe_witness(table, index, key, equalities, false)?;
        self.known &= known;
        Ok(present)
    }

    fn created(&mut self, _table: &str, _index: &str, _key: &[Value]) -> bool { false }
}

impl Runner<'_> {
    pub(crate) fn field_owner_can_read(&mut self, rule: &RuleExpr, owner: &str, row: &Value) -> Result<bool, RuntimeError> {
        let mut probe = DeliveryProbe { runner: self, known: true };
        let readable = rules::evaluate(rule, owner, None, row, false, &mut probe)?;
        // Even a negated unknown witness cannot authorize an owner partition.
        Ok(readable && probe.known)
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
            && ((!owned_only || definition.update_transition) && definition.rules.update.references_field(field)
                || next.field(&authority.owner).ok() == Some(&Value::Id(self.context.viewer.clone())))) {
            return Err(RuntimeError::Prediction(format!("{table}: this transition needs another principal's private field; queue it for the server (guide rules)")));
        }
        let transition = self.schema.tables[table].update_transition;
        if (!owned_only || transition) && !self.check_rule(table, Effect::Update, Some(old), next)? {
            return Err(if readable { RuntimeError::Rule { table: table.into(), effect: Effect::Update } } else { self.no_write_target() });
        }
        Ok(())
    }

    pub(crate) fn project_row(&mut self, table: &str, row: Value) -> Result<Value, RuntimeError> {
        let definition = &self.schema.tables[table];
        if !self.context.is_system() && definition.written_by.iter().any(|(field, authority)| row.field(field).is_ok() && !authority.audience
            && row.field(&authority.owner).ok() != Some(&Value::Id(self.context.viewer.clone()))) {
            // Charge the unprojected payload and reserve the map's copy before
            // removal invokes Arc::make_mut. A shared row's Clone costs zero,
            // but mutating its map can copy every field, including private text.
            self.meter.heap(row.heap_bytes())?;
        }
        let row = super::recorded::public_image(definition, row);
        Ok(if self.context.is_system() { row } else { definition.project_fields(row, Some(&self.context.viewer)) })
    }
}
