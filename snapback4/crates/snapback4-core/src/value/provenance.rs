//! Output provenance is not an application field, value identity or stored data.
// @ref LLP 3000.014#5 — fallback pairs by table-qualified source, never projection or position.
use super::{ObjectFields, Value, object};
use std::sync::Arc;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceIdentity {
    pub table: String,
    pub id: String,
}
impl ObjectFields {
    pub fn source_identity(&self) -> Option<&SourceIdentity> {
        self.2.as_deref()
    }
    pub(crate) fn set_source(&mut self, table: &str, id: &str) {
        self.2 = Some(Arc::new(SourceIdentity {
            table: table.into(),
            id: id.into(),
        }));
    }
    pub(crate) fn inherit_source(&mut self, bases: &[Value]) {
        let mut source = None;
        for base in bases {
            let (Value::Row(fields) | Value::Map(fields)) = base else {
                return;
            };
            let Some(identity) = &fields.2 else { return };
            if source.as_ref().is_some_and(|prior| prior != identity) {
                return;
            }
            source = Some(identity.clone());
        }
        self.2 = source;
    }
}
impl Value {
    /// Reserve both the mask's owned tree and its transport conversion before
    /// either is built. Includes metadata even when the shape has no fields.
    pub fn provenance_allowance(&self) -> (u64, u64) {
        match self {
            Self::Row(fields) | Self::Map(fields) => {
                let identity = fields
                    .source_identity()
                    .map_or(0, |s| 128 + s.table.len() as u64 + s.id.len() as u64);
                fields
                    .iter()
                    .fold((512 + identity, 1), |(heap, steps), (key, value)| {
                        let (child, work) = value.provenance_allowance();
                        (
                            heap.saturating_add(80 + key.len() as u64)
                                .saturating_add(child),
                            steps.saturating_add(work),
                        )
                    })
            }
            Self::Array(items) => {
                items
                    .iter()
                    .fold((64 * items.len() as u64, 1), |(heap, steps), value| {
                        let (child, work) = value.provenance_allowance();
                        (heap.saturating_add(child), steps.saturating_add(work))
                    })
            }
            _ => (0, 1),
        }
    }
    /// A parallel mask describes every returned row and nested field. A null
    /// source is intentionally unknown; projected fields cannot fill it in.
    pub fn retained_rows_mask(&self) -> Self {
        match self {
            Self::Row(fields) | Self::Map(fields) => object([
                (
                    "source",
                    fields.source_identity().map_or(Self::Null, |s| {
                        Self::Array(vec![Self::String(s.table.clone()), Self::Id(s.id.clone())])
                    }),
                ),
                ("retained", Self::Bool(fields.is_retained())),
                (
                    "fields",
                    Self::Row(
                        fields
                            .iter()
                            .map(|(key, value)| (key.clone(), value.retained_rows_mask()))
                            .collect(),
                    ),
                ),
            ]),
            Self::Array(items) => Self::Array(items.iter().map(Self::retained_rows_mask).collect()),
            _ => Self::Null,
        }
    }
}
