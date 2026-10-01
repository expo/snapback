//! Caller expressions and schema defaults carry input provenance through writes.
use super::Value;
use crate::{error::RuntimeError, schema::{Table, Index}};
#[derive(Clone)]
pub(crate) struct Supplied(Value);
impl std::ops::Deref for Supplied { type Target = Value; fn deref(&self) -> &Value { &self.0 } }
impl Supplied {
    pub(crate) fn ephemeral(mut self, table: &Table, now: i64) -> Result<Self, RuntimeError> {
        table.stamp_ephemeral(&mut self.0, now)?;
        Ok(self)
    }
    pub(crate) fn into_value(self) -> Value { self.0 }
    pub(crate) fn heap_bytes(&self) -> u64 { self.0.retained_heap() }
    pub(crate) fn field_copy(&self, field: &str) -> u64 { self.0.field(field).map_or(0,Value::clone_heap) }
    pub(crate) fn defaults(mut self, table: &Table, now: i64, viewer: &str) -> Result<Self,RuntimeError> {
        let mut fields = self.0.as_object()?.clone();
        for (name,default) in &table.defaults { if !fields.contains_key(name) { fields.insert(name.clone(),default.value(now,viewer)); } }
        self.0 = Value::Row(fields.into());
        Ok(self)
    }
    pub(crate) fn remove_fields(mut self, removed: impl Iterator<Item=String>) -> Result<Self,RuntimeError> {
        let mut fields = self.0.as_object()?.clone();
        for field in removed { fields.remove(&field); }
        self.0 = Value::Row(fields.into());
        Ok(self)
    }
    pub(crate) fn key(index: &Index, key: &[Value], _: &crate::engine::write::target::TargetInput) -> Self {
        Self(Value::Row(index.columns().into_iter().zip(key.iter().cloned()).collect()))
    }
    pub(crate) fn complete_key(mut self, index: &Index, key: &[Value], id: Value, _: &crate::engine::write::target::TargetInput) -> Result<Self,RuntimeError> {
        let mut fields = self.0.as_object()?.clone();
        for (component,value) in index.components.iter().zip(key) {
            if let Some(column) = component.column() { fields.entry(column.clone()).or_insert_with(||value.clone()); }
        }
        fields.insert("id".into(),id);
        self.0 = Value::Row(fields.into());
        Ok(self)
    }
}
impl Value {
    #[cfg(feature = "sqlite")]
    pub(crate) fn import_input(self, _: &crate::engine::ImportInput) -> Supplied { Supplied(self) }
    // The native module compiles under `wasm-host` (engine/mod.rs); the
    // iOS device enables `wasm-host` without the server-only `native` jobs.
    #[cfg(feature = "wasm-host")]
    pub(crate) fn native_input(self, _: &crate::engine::native::NativeInput) -> Supplied { Supplied(self) }
    pub(crate) fn expression_input(self, _: crate::engine::runner::ExpressionAccess) -> Supplied { Supplied(self) }
    pub(crate) fn timeline_input(self, _: &crate::engine::timeline::TimelineInput) -> Supplied { Supplied(self) }
    /// A read-through child's supplied image plus the parent capture stamped
    /// under reserve_capture's declared allowance (LLP 3000.014 §4).
    pub(crate) fn capture_input(self, _: &crate::engine::through::CaptureInput) -> Supplied { Supplied(self) }
}
