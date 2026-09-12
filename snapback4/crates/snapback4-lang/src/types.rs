//! The binder's type model: what a Quarry expression is, statically, so a
//! program's arguments and result reach the client as TypeScript types by
//! inference (nothing is annotated, nothing is committed).

use crate::ast::{ScalarType, TypeKind};
use snapback4_core::ir::ArgType;
use snapback4_core::schema::{ColumnType, TextFormat};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Ty {
    Unknown,
    Null,
    Bool,
    Int,
    Time,
    Decimal(u8),
    Money(String, u8),
    Text(u32),
    Id,
    Principal,
    Ref(String),
    Bytes,
    Json,
    Image,
    Video,
    Enum(Vec<String>),
    Cursor,
    Optional(Box<Ty>),
    /// A bounded list of scalars; `max` bounds a loop over it.
    List(Box<Ty>, u32),
    /// One row of a table, present.
    Row(String),
    /// A bounded page of rows, in index order.
    Page(String, u32),
    /// A shaped page: at most `max` objects.
    Collection(Box<Ty>, u32),
    Object(BTreeMap<String, Ty>),
}

impl Ty {
    pub fn optional(self) -> Ty {
        match self {
            Ty::Optional(_) | Ty::Null | Ty::Unknown => self,
            other => Ty::Optional(Box::new(other)),
        }
    }

    pub fn required(&self) -> Ty {
        match self {
            Ty::Optional(inner) => inner.as_ref().clone(),
            other => other.clone(),
        }
    }

    pub fn is_optional(&self) -> bool {
        matches!(self, Ty::Optional(_) | Ty::Null)
    }

    pub fn is_bool(&self) -> bool {
        matches!(self, Ty::Bool)
    }

    pub fn is_numeric(&self) -> bool {
        matches!(self, Ty::Int | Ty::Time | Ty::Decimal(_) | Ty::Money(..))
    }

    pub fn is_identity(&self) -> bool {
        matches!(self, Ty::Id | Ty::Principal | Ty::Ref(_))
    }

    pub fn from_scalar(scalar: &ScalarType) -> Ty {
        let base = match &scalar.kind {
            TypeKind::Cursor => Ty::Cursor,
            TypeKind::Text { max, .. } => Ty::Text(*max),
            TypeKind::Id => Ty::Id,
            TypeKind::Principal => Ty::Principal,
            TypeKind::Int => Ty::Int,
            TypeKind::Decimal { scale } => Ty::Decimal(*scale),
            TypeKind::Money { currency, scale } => Ty::Money(currency.clone(), *scale),
            TypeKind::Time => Ty::Time,
            TypeKind::Bool => Ty::Bool,
            TypeKind::Json { .. } => Ty::Json,
            TypeKind::Bytes { .. } => Ty::Bytes,
            TypeKind::Image { .. } => Ty::Image,
            TypeKind::Video { .. } => Ty::Video,
            TypeKind::Enum { variants } => Ty::Enum(variants.clone()),
            TypeKind::Ref { table } => Ty::Ref(table.clone()),
            TypeKind::List { item, max } => Ty::List(Box::new(Ty::from_scalar(item)), *max),
        };
        if scalar.optional { base.optional() } else { base }
    }

    pub fn from_column(kind: &ColumnType) -> Ty {
        match kind {
            ColumnType::Id => Ty::Id,
            ColumnType::Principal => Ty::Principal,
            ColumnType::Text { max } => Ty::Text(*max),
            ColumnType::Bytes { .. } => Ty::Bytes,
            ColumnType::Image { .. } => Ty::Image,
            ColumnType::Video { .. } => Ty::Video,
            ColumnType::Int => Ty::Int,
            ColumnType::Enum { variants } => Ty::Enum(variants.clone()),
            ColumnType::Decimal { scale } => Ty::Decimal(*scale),
            ColumnType::Money { currency, scale } => Ty::Money(currency.clone(), *scale),
            ColumnType::Bool => Ty::Bool,
            ColumnType::Time => Ty::Time,
            ColumnType::Ref { table } => Ty::Ref(table.clone()),
            ColumnType::Json { .. } => Ty::Json,
            ColumnType::Optional(inner) => Ty::from_column(inner).optional(),
            ColumnType::List { of, max } => Ty::List(Box::new(Ty::from_column(of)), *max),
        }
    }

    /// The name a diagnostic prints.
    pub fn name(&self) -> String {
        match self {
            Ty::Unknown => "an unknown value".into(),
            Ty::Null => "null".into(),
            Ty::Bool => "bool".into(),
            Ty::Int => "int".into(),
            Ty::Time => "time".into(),
            Ty::Decimal(scale) => format!("decimal {scale}"),
            Ty::Money(currency, scale) => format!("money {currency} {scale}"),
            Ty::Text(max) => format!("text <={max}"),
            Ty::Id => "id".into(),
            Ty::Principal => "principal".into(),
            Ty::Ref(table) => format!("a {table} reference"),
            Ty::Bytes => "bytes".into(),
            Ty::Json => "json".into(),
            Ty::Image => "image".into(),
            Ty::Video => "video".into(),
            Ty::Enum(variants) => format!("enum({})", variants.iter().map(|v| format!("'{v}'")).collect::<Vec<_>>().join(", ")),
            Ty::Cursor => "cursor".into(),
            Ty::Optional(inner) => format!("{} ?", inner.name()),
            Ty::List(item, max) => format!("[{}] <={max}", item.name()),
            Ty::Row(table) => format!("a {table} row"),
            Ty::Page(table, max) => format!("a page of at most {max} {table} rows"),
            Ty::Collection(item, max) => format!("at most {max} of {}", item.name()),
            Ty::Object(fields) => format!("{{ {} }}", fields.keys().cloned().collect::<Vec<_>>().join(", ")),
        }
    }

    /// Whether a value of `self` may be stored where `expected` is declared.
    pub fn assignable_to(&self, expected: &Ty) -> bool {
        if self == expected {
            return true;
        }
        match (self, expected) {
            (Ty::Null, Ty::Optional(_)) => true,
            (Ty::Optional(inner), Ty::Optional(target)) => inner.assignable_to(target),
            (value, Ty::Optional(target)) => value.assignable_to(target),
            (Ty::Text(a), Ty::Text(b)) => a <= b,
            // A text literal in an enum position is a variant; the binder
            // checks membership where it knows the literal.
            (Ty::Text(_), Ty::Enum(_)) => true,
            (Ty::Id, Ty::Ref(_)) | (Ty::Ref(_), Ty::Id) | (Ty::Id, Ty::Principal) | (Ty::Principal, Ty::Id) => true,
            (Ty::Ref(a), Ty::Ref(b)) => a == b,
            (Ty::Int, Ty::Time) | (Ty::Time, Ty::Int) => true,
            (Ty::Int, Ty::Decimal(_)) | (Ty::Int, Ty::Money(..)) => true,
            (Ty::List(a, am), Ty::List(b, bm)) => a.assignable_to(b) && am <= bm,
            (Ty::Enum(a), Ty::Enum(b)) => a.iter().all(|v| b.contains(v)),
            (Ty::Unknown, _) | (_, Ty::Unknown) | (_, Ty::Json) => true,
            _ => false,
        }
    }

    /// Whether two values may meet in `=`, `!=` or a key position.
    pub fn comparable(&self, other: &Ty) -> bool {
        let a = self.required();
        let b = other.required();
        a == b || a.assignable_to(&b) || b.assignable_to(&a) || a == Ty::Null || b == Ty::Null
    }

    /// The type both branches of a join can be shown as.
    pub fn join(&self, other: &Ty) -> Ty {
        if self == other {
            return self.clone();
        }
        match (self, other) {
            (Ty::Null, other) | (other, Ty::Null) => other.clone().optional(),
            (Ty::Unknown, other) | (other, Ty::Unknown) => other.clone(),
            (Ty::Optional(a), b) | (b, Ty::Optional(a)) => a.join(&b.required()).optional(),
            (Ty::Text(a), Ty::Text(b)) => Ty::Text(*a.max(b)),
            (Ty::Int, Ty::Time) | (Ty::Time, Ty::Int) => Ty::Int,
            (Ty::Object(a), Ty::Object(b)) => {
                let mut fields = BTreeMap::new();
                for (name, ty) in a {
                    match b.get(name) {
                        Some(other) => fields.insert(name.clone(), ty.join(other)),
                        None => fields.insert(name.clone(), ty.clone().optional()),
                    };
                }
                for (name, ty) in b {
                    if !a.contains_key(name) {
                        fields.insert(name.clone(), ty.clone().optional());
                    }
                }
                Ty::Object(fields)
            }
            (Ty::Collection(a, am), Ty::Collection(b, bm)) => Ty::Collection(Box::new(a.join(b)), *am.max(bm)),
            (Ty::Page(t, am), Ty::Page(u, bm)) if t == u => Ty::Page(t.clone(), *am.max(bm)),
            _ => Ty::Unknown,
        }
    }

    /// The bound of a loop over this value, if it is bounded.
    pub fn loop_max(&self) -> Option<u32> {
        match self {
            Ty::List(_, max) | Ty::Page(_, max) | Ty::Collection(_, max) => Some(*max),
            _ => None,
        }
    }
}

pub fn scalar_to_column(scalar: &ScalarType) -> ColumnType {
    let base = match &scalar.kind {
        TypeKind::Cursor => ColumnType::Text { max: 4096 },
        TypeKind::Text { max, .. } => ColumnType::Text { max: *max },
        TypeKind::Id => ColumnType::Id,
        TypeKind::Principal => ColumnType::Principal,
        TypeKind::Int => ColumnType::Int,
        TypeKind::Decimal { scale } => ColumnType::Decimal { scale: *scale },
        TypeKind::Money { currency, scale } => ColumnType::Money { currency: currency.clone(), scale: *scale },
        TypeKind::Time => ColumnType::Time,
        TypeKind::Bool => ColumnType::Bool,
        TypeKind::Json { max } => ColumnType::Json { max_bytes: *max },
        TypeKind::Bytes { max } => ColumnType::Bytes { max: *max },
        TypeKind::Image { max, once } => ColumnType::Image { max: *max, once: *once },
        TypeKind::Video { max } => ColumnType::Video { max: *max },
        TypeKind::Enum { variants } => ColumnType::Enum { variants: variants.clone() },
        TypeKind::Ref { table } => ColumnType::Ref { table: table.clone() },
        TypeKind::List { item, max } => ColumnType::List { of: Box::new(scalar_to_column(item)), max: *max },
    };
    if scalar.optional { ColumnType::Optional(Box::new(base)) } else { base }
}

pub fn scalar_to_arg(scalar: &ScalarType) -> ArgType {
    let base = match &scalar.kind {
        TypeKind::Cursor => ArgType::Cursor,
        TypeKind::Text { min, max, format } => ArgType::Text {
            max: *max,
            min: min.unwrap_or(0),
            format: format.as_deref().map(|f| if f == "handle" { TextFormat::Handle } else { TextFormat::Url }),
        },
        TypeKind::Id => ArgType::Id,
        TypeKind::Principal => ArgType::Principal,
        TypeKind::Int => ArgType::Int,
        TypeKind::Decimal { scale } => ArgType::Decimal { scale: *scale },
        TypeKind::Money { currency, scale } => ArgType::Money { currency: currency.clone(), scale: *scale },
        TypeKind::Time => ArgType::Time,
        TypeKind::Bool => ArgType::Bool,
        TypeKind::Json { max } => ArgType::Json { max_bytes: *max },
        TypeKind::Bytes { max } => ArgType::Bytes { max: *max },
        TypeKind::Image { max, .. } => ArgType::Image { max: *max },
        TypeKind::Video { max } => ArgType::Video { max: *max },
        TypeKind::Enum { variants } => ArgType::Enum { variants: variants.clone() },
        TypeKind::Ref { table } => ArgType::Ref { table: table.clone() },
        TypeKind::List { item, max } => ArgType::List { of: Some(Box::new(scalar_to_arg(item))), max: *max },
    };
    if scalar.optional { ArgType::Optional(Box::new(base)) } else { base }
}
