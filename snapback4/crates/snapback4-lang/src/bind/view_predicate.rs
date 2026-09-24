//! Substitute only the view's focal row. Nested scan predicates and shapes
//! introduce a different focal row and must keep their own column meanings.
use super::intent;
use crate::{ast::*, diag::{Fallible, type_error}};
use std::collections::BTreeMap;

pub(super) fn project(value: &mut Expr, fields: &BTreeMap<String, Expr>) -> Fallible<()> {
    if let Some(name) = intent::column(value) {
        let replacement = fields.get(name).ok_or_else(|| type_error(value.site(), format!("view has no projected field {name}"), format!("project `{name}: .<sourceColumn>` in every view branch")))?;
        *value = replacement.clone();
        return Ok(());
    }
    match value {
        Expr::Read(read) | Expr::Exists { read, .. } | Expr::Created { read, .. } => {
            for key in &mut read.keys { project(&mut key.value, fields)?; }
            for bound in &mut read.seeks { project(&mut bound.value, fields)?; }
            if let Some(value) = &mut read.matching { project(value, fields)?; }
            if let Some(value) = read.range.as_mut().and_then(|range| range.cursor.as_mut()) { project(value, fields)?; }
            // `where` binds the nested read's source row.
        }
        Expr::Unary { value, .. } | Expr::Member { base: value, .. } | Expr::Assert { value, .. } | Expr::ShapeUse { base: value, .. } | Expr::Shape { base: value, .. } => project(value, fields)?,
        Expr::Binary { left, right, .. } => { project(left, fields)?; project(right, fields)?; }
        Expr::Array { items, .. } | Expr::Call { args: items, .. } => { for value in items { project(value, fields)?; } }
        Expr::Object { fields: values, .. } => { for field in values { if let Some(value) = &mut field.value { project(value, fields)?; } } }
        Expr::If { then, condition, otherwise, .. } => { project(then, fields)?; project(condition, fields)?; project(otherwise, fields)?; }
        Expr::Walk { seed, .. } => project(seed, fields)?,
        Expr::Name { .. } | Expr::Literal { .. } => {}
        Expr::Focal { site } => return Err(type_error(site, "a view predicate names projected fields", "write `.field = value`")),
        Expr::Merge(merge) => {
            for value in [&mut merge.matching, &mut merge.cursor].into_iter().flatten() { project(value, fields)?; }
            for lane in &mut merge.lanes {
                for value in &mut lane.prefix { project(value, fields)?; }
                if let Some((_, source)) = &mut lane.loop_ { project(source, fields)?; }
            }
        }
        Expr::Write { site, .. } => return Err(type_error(site, "a view predicate cannot write", "write in a mutation, then read the view")),
    }
    Ok(())
}
