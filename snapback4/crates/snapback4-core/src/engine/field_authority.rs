//! Field writes use the old owner; row transition rules still constrain them.
// @ref LLP 3000.015#1 — ownership grants only the explicitly touched owned fields.
use super::runner::Runner;
use crate::{error::RuntimeError, schema::Effect, value::Value};

impl Runner<'_> {
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
        if !self.context.is_system() && definition.written_by.values().any(|authority| !authority.audience
            && row.field(&authority.owner).ok() != Some(&Value::Id(self.context.viewer.clone()))) {
            self.meter.heap(row.clone_heap_bytes())?;
        }
        let row = super::recorded::public_image(definition, row);
        Ok(if self.context.is_system() { row } else { definition.project_fields(row, Some(&self.context.viewer)) })
    }
}
