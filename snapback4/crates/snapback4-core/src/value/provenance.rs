//! Output provenance is not an application field, value identity or stored data.
// @ref LLP 3000.014#5 — fallback pairs by table-qualified source, never projection or position.
use super::{ObjectFields, Value, object};
use std::sync::Arc;

#[derive(Clone, Debug)]
pub struct SourceIdentity {
    pub table: String,
    pub id: String,
    #[cfg(feature = "sqlite")]
    pub(crate) delivery: Option<Arc<crate::engine::delivery::Image>>,
}
impl PartialEq for SourceIdentity {
    fn eq(&self, other: &Self) -> bool { self.table == other.table && self.id == other.id }
}
impl Eq for SourceIdentity {}
impl ObjectFields {
    pub fn source_identity(&self) -> Option<&SourceIdentity> {
        #[cfg(feature = "sqlite")]
        { self.2.as_deref().filter(|s| !s.table.is_empty()) }
        #[cfg(not(feature = "sqlite"))]
        { self.2.as_deref() }
    }
    pub(crate) fn set_source(&mut self, table: &str, id: &str) {
        self.2 = Some(Arc::new(SourceIdentity {
            table: table.into(),
            id: id.into(),
            #[cfg(feature = "sqlite")]
            delivery: None,
        }));
    }
    pub(crate) fn inherit_source(&mut self, bases: &[Value]) {
        let mut source = None;
        for base in bases {
            let (Value::Row(fields) | Value::Map(fields)) = base else {
                return;
            };
            let Some(identity) = &fields.2 else { return };
            #[cfg(feature = "sqlite")]
            if identity.table.is_empty() { return; }
            if source.as_ref().is_some_and(|prior| prior != identity) {
                return;
            }
            source = Some(identity.clone());
        }
        self.2 = source;
        #[cfg(feature = "sqlite")]
        { self.3 = false; }
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

#[cfg(feature = "sqlite")]
impl SourceIdentity {
    pub(crate) fn with_delivery(table: &str, id: &str, image: crate::engine::delivery::Image) -> Self {
        Self { table: table.into(), id: id.into(), delivery: Some(Arc::new(image)) }
    }
}
#[cfg(feature = "sqlite")]
impl ObjectFields {
    pub(crate) fn delivery_image(&self) -> Option<&crate::engine::delivery::Image> {
        if self.3 { self.2.as_ref()?.delivery.as_deref() } else { None }
    }
    pub(crate) fn clear_delivery(&mut self) { self.3 = false; }
    pub(crate) fn replace_source(&mut self, source: SourceIdentity) { self.2 = Some(Arc::new(source)); self.3 = true; }
    pub(crate) fn set_delivery(&mut self, table: &str, id: &str, image: crate::engine::delivery::Image) {
        self.replace_source(SourceIdentity::with_delivery(table, id, image));
    }
}
