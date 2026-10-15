//! Literal column defaults, shared by schema binding and an insert's returned image.
use super::catalog::TableInfo;
use crate::ast::{ColumnDecl, Expr, Literal, TypeKind};
use crate::diag::{Diagnostic, Fallible, type_error};
use snapback4_core::schema::ColumnDefault;
use snapback4_core::value::Value;
use std::collections::BTreeMap;

pub(super) fn bind(info: &TableInfo, diagnostics: &mut Vec<Diagnostic>) -> BTreeMap<String, ColumnDefault> {
    let mut defaults = BTreeMap::new();
    for decl in &info.decl.columns {
        if let Some(expr) = &decl.default {
            match column(decl, expr) {
                Ok(default) => { defaults.insert(decl.name.clone(), default); }
                Err(diagnostic) => diagnostics.push(diagnostic),
            }
        }
    }
    defaults
}

pub(super) fn column(decl: &ColumnDecl, expr: &Expr) -> Fallible<ColumnDefault> {
    let bad = || type_error(expr.site(), format!("default for {} must be a literal, now or viewer fitting {}", decl.name, crate::print::scalar_type(&decl.type_)), format!("{}: {} default <literal | now | viewer>", decl.name, crate::print::scalar_type(&decl.type_)));
    let default = match expr {
        Expr::Name { name, .. } if name == "now" && matches!(decl.type_.kind, TypeKind::Time) => ColumnDefault::Now,
        Expr::Name { name, .. } if name == "viewer" && matches!(decl.type_.kind, TypeKind::Principal) => ColumnDefault::Viewer,
        Expr::Literal { value, site } => ColumnDefault::Literal(match value {
            Literal::Str(text) if matches!(decl.type_.kind, TypeKind::Id | TypeKind::Ref { .. } | TypeKind::Principal) => Value::Id(text.clone()),
            Literal::Str(text) => Value::String(text.clone()),
            Literal::Number(text) => Value::Int(super::integer_literal(text, site)?),
            Literal::Bool(b) => Value::Bool(*b),
            Literal::Null => Value::Null,
        }),
        Expr::Unary { op, value, site } if op == "-" => match value.as_ref() {
            Expr::Literal { value: Literal::Number(text), .. } => ColumnDefault::Literal(Value::Int(super::integer_literal(&format!("-{text}"), site)?)),
            _ => return Err(bad()),
        },
        _ => return Err(bad()),
    };
    let value = default.value(0, "dev:default");
    snapback4_core::engine::validate::validate_column("default", &decl.name, &crate::types::scalar_to_column(&decl.type_), Some(&value)).map_err(|_| bad())?;
    if let (TypeKind::Text { min, format, .. }, Value::String(text)) = (&decl.type_.kind, &value) {
        let format = match format.as_deref() {
            Some("handle") => Some(snapback4_core::schema::TextFormat::Handle),
            Some("url") => Some(snapback4_core::schema::TextFormat::Url),
            Some("email") => Some(snapback4_core::schema::TextFormat::Email),
            _ => None,
        };
        snapback4_core::engine::validate::validate_text(&decl.name, text, min.unwrap_or(0), format).map_err(|_| bad())?;
    }
    Ok(default)
}
