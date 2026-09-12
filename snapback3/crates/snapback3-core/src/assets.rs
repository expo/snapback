//! Closed asset records shared by schema, argument, and lifecycle validation.

use crate::engine::RuntimeError;
use crate::ir::ArgType;
use crate::schema::ColumnType;
use crate::value::{I53_MAX, Value};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Image,
    Video,
}

impl AssetKind {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Video => "video",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "image" => Some(Self::Image),
            "video" => Some(Self::Video),
            _ => None,
        }
    }
}

impl fmt::Display for AssetKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AssetRecord {
    pub(crate) kind: AssetKind,
    pub(crate) id: String,
    pub(crate) width: i64,
    pub(crate) height: i64,
    pub(crate) duration: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AssetUse {
    pub(crate) record: AssetRecord,
    pub(crate) max: u32,
}

// @ref LLP 1006#6-the-write-validated-not-stamped — the wire record is closed and identical on both twins before ledger facts are consulted.
pub(crate) fn parse_asset_record(
    kind: AssetKind,
    value: &Value,
    label: &str,
) -> Result<AssetRecord, RuntimeError> {
    let Value::Map(fields) = value else {
        return Err(asset_type(format!(
            "{label} must be a closed {kind} asset map"
        )));
    };
    let expected: &[&str] = match kind {
        AssetKind::Image => &["height", "id", "width"],
        AssetKind::Video => &["duration", "height", "id", "width"],
    };
    if fields.len() != expected.len() || expected.iter().any(|name| !fields.contains_key(*name)) {
        return Err(asset_type(format!(
            "{label} must contain exactly {}",
            expected.join(", ")
        )));
    }
    let id = fields
        .get("id")
        .and_then(|value| match value {
            Value::String(value) => Some(value.as_str()),
            _ => None,
        })
        .filter(|id| is_engine_id(id))
        .ok_or_else(|| asset_type(format!("{label}.id must be a minted s2id")))?
        .to_owned();
    let width = positive_i53(fields.get("width"), &format!("{label}.width"))?;
    let height = positive_i53(fields.get("height"), &format!("{label}.height"))?;
    let duration = match kind {
        AssetKind::Image => None,
        AssetKind::Video => Some(positive_i53(
            fields.get("duration"),
            &format!("{label}.duration"),
        )?),
    };
    Ok(AssetRecord {
        kind,
        id,
        width,
        height,
        duration,
    })
}

pub(crate) fn column_asset_uses(
    kind: &ColumnType,
    value: Option<&Value>,
    label: &str,
) -> Result<Vec<AssetUse>, RuntimeError> {
    let mut uses = Vec::new();
    collect_column_uses(kind, value, label, &mut uses)?;
    Ok(uses)
}

fn collect_column_uses(
    kind: &ColumnType,
    value: Option<&Value>,
    label: &str,
    uses: &mut Vec<AssetUse>,
) -> Result<(), RuntimeError> {
    match kind {
        ColumnType::Optional(_) if value.is_none_or(|value| matches!(value, Value::Null)) => Ok(()),
        ColumnType::Optional(inner) => collect_column_uses(inner, value, label, uses),
        ColumnType::List { of, max } => {
            let Some(Value::Array(values)) = value else {
                return Err(asset_type(format!("{label} must be a list")));
            };
            if values.len() > *max as usize {
                return Err(asset_type(format!("{label} exceeds list max {max}")));
            }
            let start = uses.len();
            for (index, value) in values.iter().enumerate() {
                collect_column_uses(of, Some(value), &format!("{label}[{index}]"), uses)?;
            }
            require_unique(&uses[start..], label)
        }
        ColumnType::Image { max, .. } => {
            let value = value.ok_or_else(|| asset_type(format!("{label} is required")))?;
            uses.push(AssetUse {
                record: parse_asset_record(AssetKind::Image, value, label)?,
                max: *max,
            });
            Ok(())
        }
        ColumnType::Video { max } => {
            let value = value.ok_or_else(|| asset_type(format!("{label} is required")))?;
            uses.push(AssetUse {
                record: parse_asset_record(AssetKind::Video, value, label)?,
                max: *max,
            });
            Ok(())
        }
        _ => Ok(()),
    }
}

pub(crate) fn arg_asset_uses(
    kind: &ArgType,
    value: &Value,
    label: &str,
) -> Result<Vec<AssetUse>, RuntimeError> {
    let mut uses = Vec::new();
    collect_arg_uses(kind, value, label, &mut uses)?;
    Ok(uses)
}

fn collect_arg_uses(
    kind: &ArgType,
    value: &Value,
    label: &str,
    uses: &mut Vec<AssetUse>,
) -> Result<(), RuntimeError> {
    match kind {
        ArgType::Optional(_) if matches!(value, Value::Null) => Ok(()),
        ArgType::Optional(inner) => collect_arg_uses(inner, value, label, uses),
        ArgType::List { of, max } => {
            let Value::Array(values) = value else {
                return Err(asset_type(format!("{label} must be a list")));
            };
            if values.len() > *max as usize {
                return Err(asset_type(format!("{label} exceeds list max {max}")));
            }
            let start = uses.len();
            if let Some(of) = of {
                for (index, value) in values.iter().enumerate() {
                    collect_arg_uses(of, value, &format!("{label}[{index}]"), uses)?;
                }
            }
            require_unique(&uses[start..], label)
        }
        ArgType::Image { max } => {
            uses.push(AssetUse {
                record: parse_asset_record(AssetKind::Image, value, label)?,
                max: *max,
            });
            Ok(())
        }
        ArgType::Video { max } => {
            uses.push(AssetUse {
                record: parse_asset_record(AssetKind::Video, value, label)?,
                max: *max,
            });
            Ok(())
        }
        _ => Ok(()),
    }
}

fn require_unique(uses: &[AssetUse], label: &str) -> Result<(), RuntimeError> {
    let mut ids = BTreeSet::new();
    if let Some(duplicate) = uses
        .iter()
        .map(|asset| asset.record.id.as_str())
        .find(|id| !ids.insert(*id))
    {
        return Err(asset_type(format!(
            "{label} repeats asset id {duplicate}; asset ids in a list must be unique"
        )));
    }
    Ok(())
}

pub(crate) fn column_has_asset_value(kind: &ColumnType, value: Option<&Value>) -> bool {
    match kind {
        ColumnType::Image { .. } | ColumnType::Video { .. } => {
            value.is_some_and(|value| !matches!(value, Value::Null))
        }
        ColumnType::Optional(inner) => column_has_asset_value(inner, value),
        ColumnType::List { of, .. } => match value {
            Some(Value::Array(values)) => values
                .iter()
                .any(|value| column_has_asset_value(of, Some(value))),
            Some(value) => !matches!(value, Value::Null) && of.contains_asset(),
            None => false,
        },
        _ => false,
    }
}

pub(crate) fn refuse_seed_assets(
    schema: &crate::schema::Schema,
    table: &str,
    row: &Value,
) -> Result<(), RuntimeError> {
    let Some(definition) = schema.table(table) else {
        return Ok(());
    };
    let fields = row.as_object()?;
    for (column, kind) in &definition.columns {
        if column_has_asset_value(kind, fields.get(column)) {
            // @ref LLP 1006#2a-one-asset-one-home-author-ruling-2026-09-01 — authoritative seeds cannot name an asset because no seed path mints its ledger authority.
            return Err(RuntimeError::SchemaSeedAsset {
                table: table.to_owned(),
                column: column.clone(),
            });
        }
    }
    Ok(())
}

pub(crate) fn is_engine_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("s2id-") else {
        return false;
    };
    let Some((namespace, sequence)) = rest.rsplit_once('-') else {
        return false;
    };
    namespace.len() == 32
        && sequence.len() == 16
        && namespace.bytes().all(lower_hex)
        && sequence.bytes().all(lower_hex)
        && sequence.bytes().any(|byte| byte != b'0')
}

fn lower_hex(byte: u8) -> bool {
    byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
}

fn positive_i53(value: Option<&Value>, label: &str) -> Result<i64, RuntimeError> {
    match value {
        Some(Value::Int(value)) if (1..=I53_MAX).contains(value) => Ok(*value),
        _ => Err(asset_type(format!(
            "{label} must be a positive i53 integer"
        ))),
    }
}

fn asset_type(message: String) -> RuntimeError {
    RuntimeError::AssetType(message)
}
