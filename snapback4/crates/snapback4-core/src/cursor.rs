//! Canonical opaque positions for bounded index pages, copied from Snapback
//! 2: a token carries the table, index, order, the typed suffix and its
//! values; it is rejected before any scan when it is not canonical or names
//! another scope.

use crate::ir::Order;
use crate::schema::{ColumnType, Schema};
use crate::value::Value;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const VERSION: u8 = 1;
const MAX_TOKEN_BYTES: usize = 4_096;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CursorColumn {
    pub name: String,
    pub kind: ColumnType,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CursorPosition {
    pub table: String,
    pub index: String,
    pub order: Order,
    pub suffix: Vec<CursorColumn>,
    pub values: Vec<Value>,
    pub scope: Option<CursorScope>,
    /// Resume at this visible row when its returned shape was unfinished.
    pub inclusive: bool,
}

// @ref LLP 3000.007#20.9 — direct pages bind evaluated scope and active generation, not mutable row values.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CursorScope {
    pub generation: u64,
    pub prefix: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<crate::ir::VariantId>,
}

pub(crate) fn check_variant(position: &CursorPosition, expected: Option<crate::ir::VariantId>) -> Result<(), crate::error::RuntimeError> {
    if position.scope.as_ref().and_then(|scope| scope.variant) != expected {
        return Err(crate::error::RuntimeError::Structural { code: "E_CURSOR_INDEX", message: "cursor belongs to a different argument-presence or search variant; restart this read with a null cursor when filters change".into() });
    }
    Ok(())
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CursorError {
    #[error("cursor token exceeds {MAX_TOKEN_BYTES} bytes")]
    TooLarge,
    #[error("cursor token is not canonical base64url")]
    Base64,
    #[error("cursor token is not the canonical tagged encoding")]
    Encoding,
    #[error("cursor token version {0} is unsupported")]
    Version(u8),
    #[error("cursor token describes a different table, index, order, or suffix")]
    Descriptor,
    #[error("cursor token describes a different prefix or generation")]
    Scope,
    #[error("cursor token values do not match its typed suffix")]
    Values,
}

type Tagged = (u8, String, String, Order, Vec<CursorColumn>, Vec<Value>);

/// Encodes `[version, table, index, order, suffix descriptor, suffix values]`
/// as unpadded base64url over canonical compact JSON.
pub fn encode_cursor(schema: &Schema, position: &CursorPosition) -> Result<String, CursorError> {
    validate_values(schema, &position.table, &position.suffix, &position.values)?;
    let tagged = (
        VERSION,
        &position.table,
        &position.index,
        position.order,
        &position.suffix,
        &position.values,
    );
    let bytes = if position.inclusive {
        crate::json_codec::to_vec(&(3_u8, tagged.1, tagged.2, tagged.3, tagged.4, tagged.5, &position.scope))
    } else {
        match &position.scope {
            Some(scope) => crate::json_codec::to_vec(&(2_u8, tagged.1, tagged.2, tagged.3, tagged.4, tagged.5, scope)),
            None => crate::json_codec::to_vec(&tagged),
        }
    }.map_err(|_| CursorError::Encoding)?;
    if bytes.len() > MAX_TOKEN_BYTES {
        return Err(CursorError::TooLarge);
    }
    Ok(base64url_encode(&bytes))
}

pub fn decode_cursor(schema: &Schema, token: &str) -> Result<CursorPosition, CursorError> {
    if token.starts_with("h1") {
        return Err(CursorError::Encoding);
    }
    if token.len() > encoded_len(MAX_TOKEN_BYTES) {
        return Err(CursorError::TooLarge);
    }
    let bytes = base64url_decode(token)?;
    if bytes.len() > MAX_TOKEN_BYTES {
        return Err(CursorError::TooLarge);
    }
    let raw: serde_json::Value = crate::json_codec::from_slice(&bytes).map_err(|_| CursorError::Encoding)?;
    let version = raw.get(0).and_then(serde_json::Value::as_u64).ok_or(CursorError::Encoding)?;
    let (tagged, scope): (Tagged, Option<CursorScope>) = if version == 3 {
        let (v,t,i,o,s,k,scope): (u8,String,String,Order,Vec<CursorColumn>,Vec<Value>,Option<CursorScope>) = crate::json_codec::from_slice(&bytes).map_err(|_| CursorError::Encoding)?;
        ((v,t,i,o,s,k),scope)
    } else if version == 2 {
        let (v,t,i,o,s,k,scope): (u8,String,String,Order,Vec<CursorColumn>,Vec<Value>,CursorScope) = crate::json_codec::from_slice(&bytes).map_err(|_| CursorError::Encoding)?;
        ((v,t,i,o,s,k),Some(scope))
    } else if version == u64::from(VERSION) {
        (crate::json_codec::from_slice(&bytes).map_err(|_| CursorError::Encoding)?,None)
    } else { return Err(CursorError::Version(version.try_into().map_err(|_| CursorError::Encoding)?)); };
    let position = CursorPosition { table: tagged.1, index: tagged.2, order: tagged.3, suffix: tagged.4, values: tagged.5, scope, inclusive: version == 3 };
    // Canonical re-encoding also validates the typed values; do it once.
    if encode_cursor(schema, &position)? != token {
        return Err(CursorError::Encoding);
    }
    Ok(position)
}

pub fn decode_cursor_for(
    schema: &Schema,
    token: &str,
    table: &str,
    index: &str,
    order: Order,
    suffix: &[CursorColumn],
) -> Result<Vec<Value>, CursorError> {
    let position = decode_cursor(schema, token)?;
    position.check_descriptor(table, index, order, suffix)?;
    Ok(position.values)
}

impl CursorPosition {
    #[inline(never)]
    pub(crate) fn check_descriptor(&self, table: &str, index: &str, order: Order, suffix: &[CursorColumn]) -> Result<(), CursorError> {
        if self.table != table || self.index != index || self.order != order || self.suffix != suffix {
            return Err(CursorError::Descriptor);
        }
        Ok(())
    }
}

fn validate_values(
    schema: &Schema,
    table: &str,
    suffix: &[CursorColumn],
    values: &[Value],
) -> Result<(), CursorError> {
    if suffix.len() != values.len() {
        return Err(CursorError::Values);
    }
    for (column, value) in suffix.iter().zip(values) {
        if !value_matches(value, &column.kind) {
            return Err(CursorError::Values);
        }
    }
    let _ = (schema, table);
    Ok(())
}

fn value_matches(value: &Value, kind: &ColumnType) -> bool {
    match kind {
        ColumnType::Optional(inner) => matches!(value, Value::Null) || value_matches(value, inner),
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => {
            matches!(value, Value::Id(_))
        }
        ColumnType::Text { .. } | ColumnType::Enum { .. } => {
            matches!(value, Value::String(_))
        }
        ColumnType::Int
        | ColumnType::IntRange { .. }
        | ColumnType::Time
        | ColumnType::Decimal { .. }
        | ColumnType::Money { .. } => matches!(value, Value::Int(_)),
        ColumnType::Bool => matches!(value, Value::Bool(_)),
        ColumnType::Bytes { .. } => matches!(value, Value::Bytes(_)),
        ColumnType::Json { .. } => matches!(
            value,
            Value::Bool(_) | Value::Int(_) | Value::String(_) | Value::Id(_) | Value::Bytes(_)
        ),
        ColumnType::List { .. } | ColumnType::ListRange { .. } | ColumnType::Image { .. } | ColumnType::Video { .. } => false,
    }
}

fn encoded_len(bytes: usize) -> usize {
    bytes.div_ceil(3) * 4
}

pub(crate) fn base64url_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::with_capacity(encoded_len(bytes.len()));
    for chunk in bytes.chunks(3) {
        let value = u32::from(chunk[0]) << 16
            | u32::from(*chunk.get(1).unwrap_or(&0)) << 8
            | u32::from(*chunk.get(2).unwrap_or(&0));
        output.push(ALPHABET[((value >> 18) & 63) as usize] as char);
        output.push(ALPHABET[((value >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            output.push(ALPHABET[((value >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            output.push(ALPHABET[(value & 63) as usize] as char);
        }
    }
    output
}

pub(crate) fn base64url_decode(token: &str) -> Result<Vec<u8>, CursorError> {
    if token.is_empty() || token.len() % 4 == 1 || !token.is_ascii() {
        return Err(CursorError::Base64);
    }
    let digit = |byte: u8| -> Result<u32, CursorError> {
        match byte {
            b'A'..=b'Z' => Ok(u32::from(byte - b'A')),
            b'a'..=b'z' => Ok(u32::from(byte - b'a') + 26),
            b'0'..=b'9' => Ok(u32::from(byte - b'0') + 52),
            b'-' => Ok(62),
            b'_' => Ok(63),
            _ => Err(CursorError::Base64),
        }
    };
    let mut output = Vec::with_capacity(token.len() / 4 * 3 + 2);
    for chunk in token.as_bytes().chunks(4) {
        let mut value = 0_u32;
        for byte in chunk {
            value = (value << 6) | digit(*byte)?;
        }
        value <<= (4 - chunk.len()) * 6;
        output.push((value >> 16) as u8);
        if chunk.len() > 2 {
            output.push((value >> 8) as u8);
        }
        if chunk.len() > 3 {
            output.push(value as u8);
        }
    }
    if base64url_encode(&output) != token {
        return Err(CursorError::Base64);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn position() -> CursorPosition {
        CursorPosition {
            table: "messages".to_owned(),
            index: "byConversationAt".to_owned(),
            order: Order::Desc,
            suffix: vec![
                CursorColumn {
                    name: "at".to_owned(),
                    kind: ColumnType::Time,
                },
                CursorColumn {
                    name: "id".to_owned(),
                    kind: ColumnType::Id,
                },
            ],
            values: vec![Value::Int(41), Value::Id("message-41".to_owned())],
            scope: None,
            inclusive: false,
        }
    }

    #[test]
    fn canonical_round_trip_is_typed_and_strict() {
        let position = position();
        let token = encode_cursor(&Schema::default(), &position).unwrap();
        assert_eq!(decode_cursor(&Schema::default(), &token).unwrap(), position);
        assert_eq!(
            decode_cursor(&Schema::default(), &format!("{token}=")).unwrap_err(),
            CursorError::Base64
        );
        assert_eq!(
            decode_cursor(&Schema::default(), &format!("+{}", &token[1..])).unwrap_err(),
            CursorError::Base64
        );
    }

    #[test]
    fn descriptor_and_value_tags_are_bound() {
        let position = position();
        let token = encode_cursor(&Schema::default(), &position).unwrap();
        assert_eq!(
            decode_cursor_for(
                &Schema::default(),
                &token,
                "messages",
                "byConversationAt",
                Order::Asc,
                &position.suffix,
            )
            .unwrap_err(),
            CursorError::Descriptor,
        );
        let mut wrong = position;
        wrong.values[1] = Value::String("message-41".to_owned());
        assert_eq!(
            encode_cursor(&Schema::default(), &wrong).unwrap_err(),
            CursorError::Values
        );
    }
}
