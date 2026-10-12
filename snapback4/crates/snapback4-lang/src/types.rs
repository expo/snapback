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
    WriteRow(String),
    /// A bounded page of rows, in index order.
    Page(String, u32),
    /// A shaped page: at most `max` objects.
    Collection(Box<Ty>, u32),
    Object(BTreeMap<String, Ty>),
    /// A projection whose row base carries optional device metadata.
    RowShape(BTreeMap<String, Ty>),
    /// Object-spread fields with row metadata, but ordinary object wildcard order.
    RowObject(BTreeMap<String, Ty>),

}

impl Ty {
    /// A reassigned allocation is bounded by the heap meter, not its first literal's length.
    pub(crate) fn rebound(self) -> Ty {
        match self {
            Ty::Text(_) => Ty::Text(u32::MAX),
            // A known empty value stays empty, even at a loop header.
            Ty::List(_, 0) | Ty::Collection(_, 0) => self,
            Ty::List(item, _) => Ty::List(Box::new(item.rebound()), u32::MAX),
            Ty::Collection(item, _) => Ty::Collection(Box::new(item.rebound()), u32::MAX),
            Ty::Object(fields) => Ty::Object(fields.into_iter().map(|(name, ty)| (name, ty.rebound())).collect()),
            Ty::RowShape(fields) => Ty::RowShape(fields.into_iter().map(|(name, ty)| (name, ty.rebound())).collect()),
            Ty::RowObject(fields) => Ty::RowObject(fields.into_iter().map(|(name, ty)| (name, ty.rebound())).collect()),
            Ty::Optional(inner) => inner.rebound().optional(),
            other => other,
        }
    }

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
            TypeKind::Int | TypeKind::IntRange { .. } => Ty::Int,
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
            TypeKind::List { item, max, .. } => Ty::List(Box::new(Ty::from_scalar(item)), *max),
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
            ColumnType::Int | ColumnType::IntRange { .. } => Ty::Int,
            ColumnType::Enum { variants } => Ty::Enum(variants.clone()),
            ColumnType::Decimal { scale } => Ty::Decimal(*scale),
            ColumnType::Money { currency, scale } => Ty::Money(currency.clone(), *scale),
            ColumnType::Bool => Ty::Bool,
            ColumnType::Time => Ty::Time,
            ColumnType::Ref { table } => Ty::Ref(table.clone()),
            ColumnType::Json { .. } => Ty::Json,
            ColumnType::Optional(inner) => Ty::from_column(inner).optional(),
            ColumnType::List { of, max } | ColumnType::ListRange { of, max, .. } => Ty::List(Box::new(Ty::from_column(of)), *max),
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
            Ty::WriteRow(table) => format!("a {table} write result"),
            Ty::Page(table, max) => format!("a page of at most {max} {table} rows"),
            Ty::Collection(item, max) => format!("at most {max} of {}", item.name()),
            Ty::Object(fields) | Ty::RowShape(fields) | Ty::RowObject(fields) => format!("{{ {} }}", fields.keys().cloned().collect::<Vec<_>>().join(", ")),
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
            // @ref LLP 3000.007#20 — enum widening is static and total: every variant fits the text bound and character domain.
            (Ty::Enum(variants), Ty::Text(max)) => variants.iter().all(|v| v.chars().count() <= *max as usize && snapback4_core::engine::validate::disallowed_text_control(v).is_none()),
            // A text literal in an enum position is a variant; the binder
            // checks membership where it knows the literal.
            (Ty::Text(_), Ty::Enum(_)) => true,
            (Ty::Id, Ty::Ref(_)) | (Ty::Ref(_), Ty::Id) | (Ty::Id, Ty::Principal) | (Ty::Principal, Ty::Id) => true,
            (Ty::Ref(a), Ty::Ref(b)) => a == b,
            (Ty::Int, Ty::Time) | (Ty::Time, Ty::Int) => true,
            (Ty::Int, Ty::Decimal(_)) | (Ty::Int, Ty::Money(..)) => true,
            (a, b) if a.sequence().is_some() && b.sequence().is_some() => {
                let (a, am) = a.sequence().unwrap();
                let (b, bm) = b.sequence().unwrap();
                a.assignable_to(&b) && am <= bm
            },
            (Ty::Object(a) | Ty::RowShape(a) | Ty::RowObject(a), Ty::Object(b) | Ty::RowShape(b) | Ty::RowObject(b)) => a.len() == b.len() && a.iter().all(|(name, ty)| b.get(name).is_some_and(|target| ty.assignable_to(target))),
            (Ty::Enum(a), Ty::Enum(b)) => a.iter().all(|v| b.contains(v)),
            (Ty::Unknown, _) | (_, Ty::Unknown) | (_, Ty::Json) => true,
            _ => false,
        }
    }

    /// A heap-bound allocation can be written; the row validator checks its
    /// actual length. It cannot claim a smaller bound inside an inline helper.
    pub(crate) fn writable_to(&self, expected: &Ty) -> bool {
        match (self, expected) {
            (Ty::Optional(a), Ty::Optional(b)) => a.writable_to(b),
            (a, Ty::Optional(b)) => a.writable_to(b) || *a == Ty::Null,
            (Ty::Text(u32::MAX), Ty::Text(_)) => true,
            (Ty::List(a, am), Ty::List(b, bm)) => a.writable_to(b) && (*am == u32::MAX || am <= bm),
            _ => self.assignable_to(expected),
        }
    }

    /// Whether two values may meet in `=`, `!=` or a key position.
    pub fn comparable(&self, other: &Ty) -> bool {
        let a = self.required();
        let b = other.required();
        a == b || a.assignable_to(&b) || b.assignable_to(&a) || a == Ty::Null || b == Ty::Null
    }

    /// The type both branches can share. Row-kind conflicts are errors at
    /// their first join, including inside objects and collections.
    pub fn join(&self, other: &Ty) -> Result<Ty, JoinError> {
        self.join_inner(other, false)
    }

    /// Nonempty list items must never erase a conflict into Unknown: a later
    /// item could otherwise recover a type the earlier values do not have.
    // @ref LLP 3000.007#5.1 — literals and concatenation share sound item joins.
    pub(crate) fn join_item(&self, other: &Ty) -> Result<Ty, JoinError> {
        self.join_inner(other, true)
    }

    fn join_inner(&self, other: &Ty, strict: bool) -> Result<Ty, JoinError> {
        if self == other { return Ok(self.clone()); }
        // Absence adds nullability; it supplies no competing wildcard kind.
        if *self == Ty::Null { return Ok(other.clone().optional()); }
        if *other == Ty::Null { return Ok(self.clone().optional()); }
        if let Ty::Optional(a) = self { return Ok(a.join_inner(&other.required(), strict)?.optional()); }
        if let Ty::Optional(b) = other { return Ok(self.required().join_inner(b, strict)?.optional()); }
        let conflict = || JoinError { left: self.kind_name(), right: other.kind_name(), path: String::new(), incompatible_items: false,
            mixed_references: matches!((self, other), (Ty::Ref(a), Ty::Ref(b)) if a != b),
            enum_items: matches!(self, Ty::Enum(_)) || matches!(other, Ty::Enum(_)) };
        Ok(match (self, other) {
            (Ty::Null, other) | (other, Ty::Null) => other.clone().optional(),
            (Ty::Unknown, other) | (other, Ty::Unknown) if !strict && !other.contains_row() => other.clone(),
            (Ty::Text(a), Ty::Text(b)) => Ty::Text(*a.max(b)),
            // @ref LLP 3000.007#5.1 — compatible items keep their common representation;
            // assignment's literal-enum and Unknown exceptions are not joins.
            (Ty::Enum(a), Ty::Enum(b)) => {
                // Keep an existing superset's order; otherwise form the union
                // in encounter order. Every enum value stays the same string.
                if b.iter().all(|v| a.contains(v)) { Ty::Enum(a.clone()) }
                else if a.iter().all(|v| b.contains(v)) { Ty::Enum(b.clone()) }
                else {
                    let mut variants = a.clone();
                    for variant in b {
                        if !variants.contains(variant) { variants.push(variant.clone()); }
                    }
                    Ty::Enum(variants)
                }
            }
            (Ty::Enum(variants), Ty::Text(max)) | (Ty::Text(max), Ty::Enum(variants))
                if Ty::Enum(variants.clone()).assignable_to(&Ty::Text(u32::MAX)) => {
                let longest = variants.iter().map(|v| u32::try_from(v.chars().count()).unwrap_or(u32::MAX)).max().unwrap_or(0);
                Ty::Text((*max).max(longest))
            }
            (Ty::Id, Ty::Ref(_) | Ty::Principal) | (Ty::Ref(_) | Ty::Principal, Ty::Id) => Ty::Id,
            (Ty::Int, Ty::Decimal(scale)) | (Ty::Decimal(scale), Ty::Int) => Ty::Decimal(*scale),
            (Ty::Int, Ty::Money(currency, scale)) | (Ty::Money(currency, scale), Ty::Int) => Ty::Money(currency.clone(), *scale),
            (Ty::Int, Ty::Time) | (Ty::Time, Ty::Int) => Ty::Int,
            (Ty::Object(a), Ty::Object(b)) | (Ty::RowShape(a), Ty::RowShape(b)) | (Ty::RowObject(a), Ty::RowObject(b)) => {
                let mut fields = BTreeMap::new();
                for (name, ty) in a {
                    fields.insert(name.clone(), match b.get(name) {
                        Some(other) => ty.join_inner(other, strict).map_err(|error| error.at(name))?,
                        None => ty.clone().optional(),
                    });
                }
                for (name, ty) in b {
                    if !a.contains_key(name) { fields.insert(name.clone(), ty.clone().optional()); }
                }
                match self {
                    Ty::RowShape(_) => Ty::RowShape(fields),
                    Ty::RowObject(_) => Ty::RowObject(fields),
                    _ => Ty::Object(fields),
                }
            }
            // Differing outer kinds can also hide a conflict in a shared
            // field. Explain that path rather than proposing an outer-only fix.
            (Ty::Object(a) | Ty::RowShape(a) | Ty::RowObject(a), Ty::Object(b) | Ty::RowShape(b) | Ty::RowObject(b)) => {
                for (name, ty) in a {
                    if let Some(other) = b.get(name) {
                        ty.join_inner(other, strict).map_err(|error| error.at(name))?;
                    }
                }
                return Err(conflict());
            }
            (Ty::Collection(a, am), Ty::Collection(b, bm)) => Ty::Collection(Box::new(join_items(a, *am, b, *bm)?), *am.max(bm)),
            (Ty::List(a, am), Ty::List(b, bm)) => Ty::List(Box::new(join_items(a, *am, b, *bm)?), *am.max(bm)),
            (Ty::Page(t, am), Ty::Page(u, bm)) if t == u => Ty::Page(t.clone(), *am.max(bm)),
            (a, b) if a.sequence().is_some() && b.sequence().is_some() => {
                let (a, am) = a.sequence().unwrap();
                let (b, bm) = b.sequence().unwrap();
                Ty::List(Box::new(join_items(&a, am, &b, bm)?), am.max(bm))
            }
            // No row-derived value, even in a container, may disappear into
            // Unknown and later acquire a different kind from another arm.
            _ if self.contains_row() || other.contains_row() => return Err(conflict()),
            (Ty::Json, other) | (other, Ty::Json) if *other != Ty::Unknown => Ty::Json,
            _ if strict => return Err(JoinError { incompatible_items: true, ..conflict() }),
            _ => Ty::Unknown,
        })
    }

    pub(crate) fn row_kind(&self) -> Option<&'static str> {
        match self {
            Ty::Row(_) => Some("Row"), Ty::WriteRow(_) => Some("WriteRow"),
            Ty::RowShape(_) => Some("RowShape"), Ty::RowObject(_) => Some("RowObject"),
            Ty::Optional(inner) => inner.row_kind(),
            _ => None,
        }
    }

    pub(crate) fn kind_name(&self) -> String {
        if let Some(kind) = self.row_kind() { return kind.into(); }
        match self {
            Ty::Object(_) => "Object".into(),
            Ty::List(item, _) => format!("List<{}>", item.kind_name()),
            Ty::Collection(item, _) => format!("Collection<{}>", item.kind_name()),
            Ty::Page(_, _) => "Page<Row>".into(),
            other => other.name(),
        }
    }

    fn contains_row(&self) -> bool {
        match self {
            Ty::Row(_) | Ty::WriteRow(_) | Ty::RowShape(_) | Ty::RowObject(_) | Ty::Page(..) => true,
            Ty::Optional(inner) | Ty::List(inner, _) | Ty::Collection(inner, _) => inner.contains_row(),
            Ty::Object(fields) => fields.values().any(Ty::contains_row),
            _ => false,
        }
    }

    /// The bound of a loop over this value, if it is bounded.
    /// Lists, pages and shaped collections have one sequence interface.
    pub fn sequence(&self) -> Option<(Ty, u32)> {
        match self {
            Ty::List(item, max) | Ty::Collection(item, max) => Some((item.as_ref().clone(), *max)),
            Ty::Page(table, max) => Some((Ty::Row(table.clone()), *max)),
            _ => None,
        }
    }

    pub fn loop_max(&self) -> Option<u32> {
        match self {
            Ty::List(_, max) | Ty::Page(_, max) | Ty::Collection(_, max) => Some(*max),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JoinError {
    pub left: String,
    pub right: String,
    pub path: String,
    pub(crate) incompatible_items: bool,
    pub(crate) mixed_references: bool,
    pub(crate) enum_items: bool,
}

impl JoinError {
    pub(crate) fn at(mut self, path: &str) -> Self {
        self.path = if self.path.is_empty() { path.into() }
            else if self.path.starts_with("[]") { format!("{path}{}", self.path) }
            else { format!("{path}.{}", self.path) };
        self
    }
}

// An empty sequence supplies no arm to compare, including the initial []
// of a collector. Unknown in a nonempty value never gets this exemption.
fn join_items(a: &Ty, am: u32, b: &Ty, bm: u32) -> Result<Ty, JoinError> {
    if am == 0 { Ok(b.clone()) } else if bm == 0 { Ok(a.clone()) } else { a.join_item(b).map_err(|error| error.at("[]")) }
}

pub fn scalar_to_column(scalar: &ScalarType) -> ColumnType {
    let base = match &scalar.kind {
        TypeKind::Cursor => ColumnType::Text { max: 4096 },
        TypeKind::Text { max, .. } => ColumnType::Text { max: *max },
        TypeKind::Id => ColumnType::Id,
        TypeKind::Principal => ColumnType::Principal,
        TypeKind::Int => ColumnType::Int,
        TypeKind::IntRange { min, max } => ColumnType::IntRange { min: min.unwrap_or_else(snapback4_core::schema::int_floor), max: max.unwrap_or_else(snapback4_core::schema::int_ceiling) },
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
        TypeKind::List { item, min: 0, max } => ColumnType::List { of: Box::new(scalar_to_column(item)), max: *max },
        TypeKind::List { item, min, max } => ColumnType::ListRange { of: Box::new(scalar_to_column(item)), min: *min, max: *max },
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
        TypeKind::IntRange { min, max } => ArgType::IntRange { min: min.unwrap_or_else(snapback4_core::schema::int_floor), max: max.unwrap_or_else(snapback4_core::schema::int_ceiling) },
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
        TypeKind::List { item, min: 0, max } => ArgType::List { of: Some(Box::new(scalar_to_arg(item))), max: *max },
        TypeKind::List { item, min, max } => ArgType::ListRange { of: Some(Box::new(scalar_to_arg(item))), min: *min, max: *max },
    };
    if scalar.optional { ArgType::Optional(Box::new(base)) } else { base }
}
