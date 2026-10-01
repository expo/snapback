//! Evaluation-only receipt dependency. Never encoded, persisted or accepted on input.
// @ref LLP 3000.022#14.3 — compound values carry the same dependency as their fields.
use super::Value;
use serde::{Serialize, Serializer};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

#[derive(Clone, Debug, Default)]
pub(crate) struct ReceiptTaint(Arc<AtomicBool>);
impl ReceiptTaint {
    pub(crate) fn consume(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
    pub(crate) fn touched(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

#[derive(Clone, Debug)]
pub struct ReceiptValue {
    pub(crate) value: Value,
    taint: ReceiptTaint,
}

impl Value {
    pub(crate) fn with_receipt_taint(self, taint: Option<ReceiptTaint>) -> Self {
        match taint {
            Some(taint) if !matches!(self, Self::Receipt(_)) => {
                Self::Receipt(Box::new(ReceiptValue { value: self, taint }))
            }
            _ => self,
        }
    }
    /// One prediction owns all marks. Construction/cloning propagates without
    /// consuming. The recursive union includes fields that a comparison might
    /// short circuit before visiting, or a builtin might discard from its output.
    pub(crate) fn receipt_taint(&self) -> Option<ReceiptTaint> {
        match self {
            Self::Receipt(value) => Some(value.taint.clone()),
            Self::Row(fields) | Self::Map(fields) => fields.values().find_map(Self::receipt_taint),
            Self::Array(values) => values.iter().find_map(Self::receipt_taint),
            _ => None,
        }
    }
    pub(crate) fn receipt_root_taint(&self) -> Option<ReceiptTaint> {
        match self {
            Self::Receipt(value) => Some(value.taint.clone()),
            _ => None,
        }
    }
    pub(crate) fn receipt_field_value(&self, name: &str) -> Result<Self, super::ValueError> {
        self.field(name)
            .map(|value| value.clone().with_receipt_taint(self.receipt_root_taint()))
    }
    pub(crate) fn consume_receipt_taint(&self) {
        if let Some(taint) = self.receipt_taint() {
            taint.consume();
        }
    }
    /// A compound key chooses an outcome; neutral output serialization does not.
    pub(crate) fn key_json(&self) -> String {
        self.consume_receipt_taint();
        super::canonical_json(self)
    }
    pub(crate) fn receipt_read(&self) -> &Self {
        self.consume_receipt_taint();
        self.receipt_plain()
    }
    // A field selection consumes container taint, not sibling fields. Thus an
    // inserted message's id/text stay clean although its accounting is marked.
    pub(crate) fn receipt_read_shallow(&self) -> &Self {
        if let Self::Receipt(value) = self {
            value.taint.consume();
            value.value.receipt_read_shallow()
        } else {
            self
        }
    }
    pub(crate) fn receipt_plain(&self) -> &Self {
        if let Self::Receipt(value) = self {
            value.value.receipt_plain()
        } else {
            self
        }
    }
    /// Crossing a write/codec boundary consumes the dependency before erasing
    /// evaluation metadata. Raw store images never acquire this wrapper.
    pub(crate) fn without_receipt_taint(self) -> Self {
        match self {
            Self::Receipt(value) => {
                value.taint.consume();
                value.value.without_receipt_taint()
            }
            Self::Row(mut fields) => {
                if fields.values().any(|v| v.receipt_taint().is_some()) {
                    for value in fields.values_mut() {
                        *value = std::mem::replace(value, Self::Null).without_receipt_taint();
                    }
                }
                Self::Row(fields)
            }
            Self::Map(mut fields) => {
                if fields.values().any(|v| v.receipt_taint().is_some()) {
                    for value in fields.values_mut() {
                        *value = std::mem::replace(value, Self::Null).without_receipt_taint();
                    }
                }
                Self::Map(fields)
            }
            Self::Array(values) => Self::Array(
                values
                    .into_iter()
                    .map(Self::without_receipt_taint)
                    .collect(),
            ),
            value => value,
        }
    }
}

impl PartialEq for Value {
    fn eq(&self, other: &Self) -> bool {
        let (a, b) = (self.receipt_read_shallow(), other.receipt_read_shallow());
        // Comparing presence does not examine an inserted row's fields.
        if matches!(a, Self::Null) || matches!(b, Self::Null) {
            return matches!((a, b), (Self::Null, Self::Null));
        }
        a.consume_receipt_taint();
        b.consume_receipt_taint();
        match (a, b) {
            (Self::Bool(a), Self::Bool(b)) => a == b,
            (Self::Int(a), Self::Int(b)) => a == b,
            (Self::String(a), Self::String(b)) | (Self::Id(a), Self::Id(b)) => a == b,
            (Self::Bytes(a), Self::Bytes(b)) => a == b,
            (Self::Row(a), Self::Row(b)) | (Self::Map(a), Self::Map(b)) => a == b,
            (Self::Array(a), Self::Array(b)) => a == b,
            _ => false,
        }
    }
}
impl Eq for Value {}

impl Serialize for Value {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.receipt_plain() {
            Self::Null => serializer.serialize_unit_variant("Value", 0, "Null"),
            Self::Bool(v) => serializer.serialize_newtype_variant("Value", 1, "Bool", v),
            Self::Int(v) => serializer.serialize_newtype_variant("Value", 2, "Int", v),
            Self::String(v) => serializer.serialize_newtype_variant("Value", 3, "String", v),
            Self::Id(v) => serializer.serialize_newtype_variant("Value", 4, "Id", v),
            Self::Bytes(v) => serializer.serialize_newtype_variant(
                "Value",
                5,
                "Bytes",
                &super::bytes_hex::encode(v),
            ),
            Self::Row(v) => serializer.serialize_newtype_variant("Value", 6, "Row", v),
            Self::Array(v) => serializer.serialize_newtype_variant("Value", 7, "Array", v),
            Self::Map(v) => serializer.serialize_newtype_variant("Value", 8, "Map", v),
            Self::Receipt(_) => unreachable!(),
        }
    }
}
