//! The value model, copied from Snapback 2 (LLP 2000.000 §5.1): i53 integers,
//! strings, nominal ids, bytes, rows, arrays and maps; one total order; one
//! canonical JSON; one digest. The conformance corpus under `corpus/` is
//! written against this exact serialization.

mod supplied;
pub(crate) use supplied::Supplied;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::BTreeMap;
use thiserror::Error;

pub const I53_MAX: i64 = (1_i64 << 53) - 1;
pub const I53_MIN: i64 = -I53_MAX;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Value {
    Null,
    Bool(bool),
    Int(i64),
    String(String),
    Id(String),
    Bytes(#[serde(with = "bytes_hex")] Vec<u8>),
    Row(ObjectFields),
    Array(Vec<Value>),
    Map(ObjectFields),
}

// Row images are shared immutably (`Arc`) so a result, a page head and a
// partition event can hold one copy; serialization is the plain map.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct ObjectFields(std::sync::Arc<BTreeMap<String, Value>>);
impl From<BTreeMap<String, Value>> for ObjectFields {
    fn from(value: BTreeMap<String, Value>) -> Self {
        Self(std::sync::Arc::new(value))
    }
}
impl FromIterator<(String, Value)> for ObjectFields {
    fn from_iter<T: IntoIterator<Item = (String, Value)>>(iter: T) -> Self {
        BTreeMap::from_iter(iter).into()
    }
}
impl std::ops::Deref for ObjectFields {
    type Target = BTreeMap<String, Value>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl std::ops::DerefMut for ObjectFields {
    fn deref_mut(&mut self) -> &mut Self::Target {
        std::sync::Arc::make_mut(&mut self.0)
    }
}
impl IntoIterator for ObjectFields {
    type Item = (String, Value);
    type IntoIter = std::collections::btree_map::IntoIter<String, Value>;
    fn into_iter(self) -> Self::IntoIter {
        std::sync::Arc::unwrap_or_clone(self.0).into_iter()
    }
}
impl<'a> IntoIterator for &'a ObjectFields {
    type Item = (&'a String, &'a Value);
    type IntoIter = std::collections::btree_map::Iter<'a, String, Value>;
    fn into_iter(self) -> Self::IntoIter {
        self.0.iter()
    }
}
impl<'a> IntoIterator for &'a mut ObjectFields {
    type Item = (&'a String, &'a mut Value);
    type IntoIter = std::collections::btree_map::IterMut<'a, String, Value>;
    fn into_iter(self) -> Self::IntoIter {
        std::sync::Arc::make_mut(&mut self.0).iter_mut()
    }
}
impl Serialize for ObjectFields {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.0.as_ref().serialize(s)
    }
}
impl<'de> Deserialize<'de> for ObjectFields {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        BTreeMap::deserialize(d).map(Into::into)
    }
}
impl ObjectFields {
    pub fn shares_image(&self, other: &Self) -> bool {
        std::sync::Arc::ptr_eq(&self.0, &other.0)
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValueError {
    #[error("E_OVERFLOW: {0} is outside the i53 value model")]
    Overflow(i128),
    #[error("E_TYPE: expected {expected}, got {actual}")]
    Type {
        expected: &'static str,
        actual: &'static str,
    },
    #[error("E_FIELD: missing field {0}")]
    MissingField(String),
    #[error("E_DIV_ZERO: division by zero")]
    DivideByZero,
    #[error("E_INPUT: identity exceeds 144 canonical tagged UTF-8 bytes")]
    Identity,
}

impl Value {
    pub fn int(value: i128) -> Result<Self, ValueError> {
        if !(I53_MIN as i128..=I53_MAX as i128).contains(&value) {
            return Err(ValueError::Overflow(value));
        }
        Ok(Self::Int(value as i64))
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::Null => "null",
            Self::Bool(_) => "bool",
            Self::Int(_) => "int",
            Self::String(_) => "string",
            Self::Id(_) => "id",
            Self::Bytes(_) => "bytes",
            Self::Row(_) => "row",
            Self::Array(_) => "array",
            Self::Map(_) => "map",
        }
    }

    pub fn as_bool(&self) -> Result<bool, ValueError> {
        match self {
            Self::Bool(value) => Ok(*value),
            other => Err(ValueError::Type {
                expected: "bool",
                actual: other.kind(),
            }),
        }
    }

    pub fn as_int(&self) -> Result<i64, ValueError> {
        match self {
            Self::Int(value) => Ok(*value),
            other => Err(ValueError::Type {
                expected: "int",
                actual: other.kind(),
            }),
        }
    }

    pub fn as_str(&self) -> Result<&str, ValueError> {
        match self {
            Self::String(value) | Self::Id(value) => Ok(value),
            other => Err(ValueError::Type {
                expected: "string or id",
                actual: other.kind(),
            }),
        }
    }

    pub fn as_array(&self) -> Result<&[Value], ValueError> {
        match self {
            Self::Array(value) => Ok(value),
            other => Err(ValueError::Type {
                expected: "array",
                actual: other.kind(),
            }),
        }
    }

    pub fn as_object(&self) -> Result<&BTreeMap<String, Value>, ValueError> {
        match self {
            Self::Row(value) | Self::Map(value) => Ok(value),
            other => Err(ValueError::Type {
                expected: "row or map",
                actual: other.kind(),
            }),
        }
    }

    /// Approximate heap footprint, charged by the meter (LLP 2000.000 §6).
    /// Bytes copied by `Clone`: row/map images already share an Arc, while
    /// strings, bytes and array slots are owned copies (with tight capacity).
    fn clone_heap(&self) -> u64 {
        match self {
            Self::String(s) | Self::Id(s) => s.len() as u64,
            Self::Bytes(bytes) => bytes.len() as u64,
            Self::Array(values) => values.len() as u64 * std::mem::size_of::<Value>() as u64 + values.iter().map(Self::clone_heap).sum::<u64>(),
            _ => 0,
        }
    }

    /// Raw storage has an opaque price; the caller ledger cannot accept it.
    pub fn clone_heap_bytes(&self, _: &crate::engine::Authorization) -> InternalPrice { InternalPrice(self.clone_heap()) }
    pub fn retained_internal(&self, _: &crate::engine::Authorization) -> InternalPrice { InternalPrice(self.retained_heap()) }
    pub fn scalar_heap(&self, _: &crate::engine::Authorization) -> InternalPrice { InternalPrice(scalar_copy(self)) }
    pub(crate) fn expression_copy(&self, _: crate::engine::runner::ExpressionAccess) -> u64 { self.clone_heap() }
    pub(crate) fn expression_heap(&self, _: crate::engine::runner::ExpressionAccess) -> u64 { self.retained_heap() }


    fn retained_heap(&self) -> u64 {
        match self {
            Value::String(s) | Value::Id(s) => s.capacity() as u64,
            Value::Bytes(b) => b.capacity() as u64,
            Value::Array(a) => {
                a.capacity() as u64 * std::mem::size_of::<Value>() as u64
                    + a.iter().map(Value::retained_heap).sum::<u64>()
            }
            Value::Row(m) | Value::Map(m) => {
                40 + m
                    .iter()
                    .map(|(k, v)| 80 + k.capacity() as u64 + v.retained_heap())
                    .sum::<u64>()
            }
            _ => 0,
        }
    }

    pub fn field(&self, name: &str) -> Result<&Value, ValueError> {
        self.as_object()?
            .get(name)
            .ok_or_else(|| ValueError::MissingField(name.to_owned()))
    }

    pub fn total_cmp(&self, other: &Self) -> Ordering {
        let tag = |v: &Value| match v {
            Value::Null => 0,
            Value::Bool(_) => 1,
            Value::Int(_) => 2,
            Value::String(_) => 3,
            Value::Id(_) => 4,
            Value::Bytes(_) => 5,
            Value::Row(_) => 6,
            Value::Array(_) => 7,
            Value::Map(_) => 8,
        };
        match tag(self).cmp(&tag(other)) {
            Ordering::Equal => {}
            order => return order,
        }
        match (self, other) {
            (Self::Null, Self::Null) => Ordering::Equal,
            (Self::Bool(a), Self::Bool(b)) => a.cmp(b),
            (Self::Int(a), Self::Int(b)) => a.cmp(b),
            (Self::String(a), Self::String(b)) | (Self::Id(a), Self::Id(b)) => a.cmp(b),
            (Self::Bytes(a), Self::Bytes(b)) => a.cmp(b),
            (Self::Array(a), Self::Array(b)) => cmp_slices(a, b),
            (Self::Row(a), Self::Row(b)) | (Self::Map(a), Self::Map(b)) => {
                let left: Vec<_> = a.iter().collect();
                let right: Vec<_> = b.iter().collect();
                left.len().cmp(&right.len()).then_with(|| {
                    left.iter()
                        .zip(right.iter())
                        .find_map(|((ak, av), (bk, bv))| {
                            let order = ak.cmp(bk).then_with(|| av.total_cmp(bv));
                            (order != Ordering::Equal).then_some(order)
                        })
                        .unwrap_or(Ordering::Equal)
                })
            }
            _ => unreachable!("equal tags imply equal variants"),
        }
    }
}

mod bytes_hex {
    use serde::{Deserialize, Deserializer, Serializer, de};

    pub fn serialize<S>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&encode(bytes))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let encoded = String::deserialize(deserializer)?;
        decode(&encoded).ok_or_else(|| {
            de::Error::custom("Bytes must be canonical lowercase even-length base16")
        })
    }

    pub(crate) fn encode(bytes: &[u8]) -> String {
        const DIGITS: &[u8; 16] = b"0123456789abcdef";
        let mut encoded = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            encoded.push(DIGITS[(byte >> 4) as usize] as char);
            encoded.push(DIGITS[(byte & 0x0f) as usize] as char);
        }
        encoded
    }

    pub(crate) fn decode(encoded: &str) -> Option<Vec<u8>> {
        if encoded.len() % 2 != 0
            || !encoded
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return None;
        }
        encoded
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| Some((decode_nibble(pair[0])? << 4) | decode_nibble(pair[1])?))
            .collect()
    }

    fn decode_nibble(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            _ => None,
        }
    }
}

fn cmp_slices(left: &[Value], right: &[Value]) -> Ordering {
    left.iter()
        .zip(right.iter())
        .find_map(|(a, b)| {
            let order = a.total_cmp(b);
            (order != Ordering::Equal).then_some(order)
        })
        .unwrap_or_else(|| left.len().cmp(&right.len()))
}

pub fn object(entries: impl IntoIterator<Item = (impl Into<String>, Value)>) -> Value {
    Value::Row(
        entries
            .into_iter()
            .map(|(key, value)| (key.into(), value))
            .collect(),
    )
}

pub fn encode_bytes_hex(bytes: &[u8]) -> String {
    bytes_hex::encode(bytes)
}

pub fn decode_bytes_hex(encoded: &str) -> Option<Vec<u8>> {
    bytes_hex::decode(encoded)
}

pub fn canonical_json<T: Serialize>(value: &T) -> String {
    crate::json_codec::to_text(value).expect("IR values are serializable")
}

pub fn digest<T: Serialize>(value: &T) -> String {
    let mut hash = Sha256::new();
    hash.update(canonical_json(value).as_bytes());
    format!("{:x}", hash.finalize())
}

/// An identity fits when its canonical tagged form is at most 144 UTF-8 bytes.
pub fn identity_fits(value: &str) -> bool {
    // Tag {"Id":""} is nine bytes. JSON escaping is counted in UTF-8 bytes.
    9usize.saturating_add(
        value
            .chars()
            .map(|c| match c {
                '"' | '\\' | '\n' | '\r' | '\t' | '\u{8}' | '\u{c}' => 2,
                '\0'..='\u{1f}' => 6,
                c => c.len_utf8(),
            })
            .sum::<usize>(),
    ) <= 144
}
pub fn validate_identities(value: &Value) -> Result<(), ValueError> {
    match value {
        Value::Id(id) if !identity_fits(id) => Err(ValueError::Identity),
        Value::Array(v) => v.iter().try_for_each(validate_identities),
        Value::Row(m) | Value::Map(m) => m.values().try_for_each(validate_identities),
        _ => Ok(()),
    }
}

#[path = "value/disclosed.rs"]
mod disclosed;
pub use disclosed::Disclosed;

/// Raw prices never escape into a caller meter. This cache-owned ledger can
/// admit a retained raw image, but exports neither a price nor its counter.
#[cfg(feature = "postgres")]
pub(crate) struct InternalLedger { used: u64, limit: u64 }
#[cfg(feature = "postgres")]
impl InternalLedger {
    pub(crate) fn new(limit: u64) -> Self { Self { used: 0, limit } }
    pub(crate) fn retain(&mut self, value: Option<&Value>, fixed: u64) -> bool {
        self.used = self.used.saturating_add(fixed).saturating_add(value.map_or(0, Value::retained_heap));
        self.used <= self.limit
    }
}

/// A raw-storage price has no conversion to caller-ledger bytes.
pub struct InternalPrice(u64);
impl InternalPrice {
    pub(crate) fn zero() -> Self { Self(0) }
    pub(crate) fn plus(self, other: Self) -> Self { Self(self.0.saturating_add(other.0)) }
    pub fn fixed(self, bytes: u64) -> Self { Self(self.0.saturating_add(bytes)) }
    pub fn times(self, factor: u64) -> Self { Self(self.0.saturating_mul(factor)) }
    pub(crate) fn fits(&self, meter: &crate::meter::Meter, _: &crate::engine::Authorization) -> bool { meter.room(crate::error::MeterKind::HeapBytes, self.0) }
    pub fn from_storage(bytes: u64, _: &crate::engine::Authorization) -> Self { Self(bytes) } }
impl InternalPrice {
    pub fn charge(self, meter: &mut crate::engine::InternalMeter<'_>, _: &crate::engine::Authorization) -> Result<(), crate::error::RuntimeError> { meter.heap(self.0) }
}

fn scalar_copy(value: &Value) -> u64 {
    use crate::rows::word_heap as h;
    match value {
        Value::String(s) | Value::Id(s) => h::text(s),
        Value::Bytes(b) => h::allocation(b.len()),
        Value::Array(a) => h::slots::<Value>(a.len()) + a.iter().map(scalar_copy).sum::<u64>(),
        _ => 0,
    }
}
