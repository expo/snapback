//! The deliberately row-local maintain language; no reads or contextual inputs.
use super::catalog::TableInfo;
use crate::ast::*;
use crate::diag::{Diagnostic, Fallible, Site};
use crate::types::Ty;
use snapback4_core::maintain::{CalendarKey, Operand, Predicate};
use snapback4_core::value::Value;
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn refusal(site: &Site, message: impl Into<String>, rewrite: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site, "E_QUARRY_MAINTAIN", message, rewrite).guide("maintains")
}

fn restricted(expr: &Expr) -> Diagnostic {
    refusal(expr.site(), format!("maintain cannot evaluate {}; predicates compare row-local scalar columns and literals", crate::print::expression(expr)),
        "store this fact in a source field and compare .field with a literal, or use a bounded job")
}

pub(super) fn keys(source: &TableInfo, maintain: &MaintainDecl) -> Fallible<BTreeMap<String, CalendarKey>> {
    let mut computed = BTreeMap::new();
    let mut names = BTreeSet::from(["id".to_owned(), "value".to_owned()]);
    for (field, key) in maintain.by.iter().zip(&maintain.keys) {
        if !names.insert(field.clone()) { return Err(refusal(key.site(), format!("maintain output name {field} is duplicated or reserved"), "use distinct bare keys and at most one day, hour and bucket key; id and value are reserved")); }
        match key {
            Expr::Name { name, .. } if source.columns.contains_key(name) => {}
            Expr::Call { name, args, .. } if matches!(name.as_str(), "day" | "hour" | "bucket") => {
                if args.len() != if name == "bucket" { 2 } else { 1 } { return Err(refusal(key.site(), "calendar key has the wrong number of arguments", "day(.at), hour(.at), or bucket(.at, 2m)")); }
                let column = match &args[0] { Expr::Member { base, name, .. } if matches!(base.as_ref(), Expr::Focal { .. }) => name, _ => return Err(refusal(args[0].site(), "calendar group key needs a source time column", "day(.at), hour(.at), or bucket(.at, 2m)")) };
                if source.columns.get(column) != Some(&ScalarType { kind: TypeKind::Time, optional: false }) {
                    return Err(refusal(args[0].site(), format!("{}.{} must be a required time column for {name}", maintain.source, column), format!("{column}: time")));
                }
                let millis = match name.as_str() { "day" => 86_400_000, "hour" => 3_600_000, _ => match &args[1] {
                    Expr::Literal { value: Literal::Number(n), site } => super::integer_literal(n, site)?,
                    other => return Err(restricted(other)),
                }};
                if millis <= 0 { return Err(refusal(key.site(), "bucket duration must be positive", "bucket(.at, 2m)")); }
                computed.insert(field.clone(), CalendarKey { function: name.clone(), column: column.clone(), millis });
            }
            _ => return Err(refusal(key.site(), "maintain group keys are bare source columns or day, hour and bucket of a required time column", "by authorId, day(.at)")),
        }
    }
    Ok(computed)
}

pub(super) fn predicate(source: &TableInfo, expr: &Expr) -> Fallible<Predicate> {
    match expr {
        Expr::Literal { value: Literal::Bool(b), .. } => Ok(Predicate::Bool(*b)),
        Expr::Member { base, name, .. } if matches!(base.as_ref(), Expr::Focal { .. }) => {
            if source.columns.get(name) == Some(&ScalarType { kind: TypeKind::Bool, optional: false }) { Ok(Predicate::Field(name.clone())) }
            else { Err(refusal(expr.site(), "a bare maintain predicate needs a required boolean column", "compare .column with a scalar literal, or declare column: bool")) }
        }
        Expr::Unary { op, value, .. } if op == "not" => Ok(Predicate::Not(Box::new(predicate(source, value)?))),
        Expr::Binary { op, left, right, .. } if op == "and" || op == "or" => {
            let (a,b) = (Box::new(predicate(source, left)?), Box::new(predicate(source, right)?));
            Ok(if op == "and" { Predicate::And(a,b) } else { Predicate::Or(a,b) })
        }
        Expr::Binary { op, left, right, .. } if matches!(op.as_str(), "=" | "!=" | "<" | "<=" | ">" | ">=") => {
            let (mut a, mut at) = operand(source, left)?;
            let (mut b, mut bt) = operand(source, right)?;
            coerce(&mut a, &bt, left)?; coerce(&mut b, &at, right)?;
            if matches!(a, Operand::Literal(Value::Id(_))) && bt.required().is_identity() { at = bt.required(); }
            if matches!(b, Operand::Literal(Value::Id(_))) && at.required().is_identity() { bt = at.required(); }
            let scalar = |ty: &Ty| matches!(ty.required(), Ty::Null | Ty::Bool | Ty::Int | Ty::Decimal { .. } | Ty::Money { .. } | Ty::Time | Ty::Text(_) | Ty::Enum(_) | Ty::Id | Ty::Ref(_) | Ty::Principal);
            if !scalar(&at) || !scalar(&bt) || !at.comparable(&bt) || (!matches!(op.as_str(), "=" | "!=") && (at.is_optional() || bt.is_optional() || matches!(at, Ty::Null) || matches!(bt, Ty::Null))) {
                return Err(refusal(expr.site(), format!("maintain comparison needs compatible scalar types; got {} and {}", at.name(), bt.name()), "compare like scalar types; ordered comparisons require non-optional operands"));
            }
            Ok(Predicate::Compare { op: op.clone(), left: a, right: b })
        }
        _ => Err(restricted(expr)),
    }
}

fn coerce(value: &mut Operand, ty: &Ty, expr: &Expr) -> Fallible<()> {
    if let Operand::Literal(Value::String(s)) = value {
        if ty.required().is_identity() { *value = Operand::Literal(Value::Id(s.clone())); }
        else if let Ty::Enum(variants) = ty.required() {
            if !variants.contains(s) { return Err(refusal(expr.site(), format!("'{s}' is not an allowed variant"), format!("use one of {}", variants.join(", ")))); }
        }
    }
    Ok(())
}
fn operand(source: &TableInfo, expr: &Expr) -> Fallible<(Operand, Ty)> {
    match expr {
        Expr::Member { base, name, .. } if matches!(base.as_ref(), Expr::Focal { .. }) => {
            let ty = if name == "id" { Ty::Id } else { source.columns.get(name).map(Ty::from_scalar).ok_or_else(|| restricted(expr))? };
            Ok((Operand::Field(name.clone()), ty))
        }
        Expr::Literal { value, site } => Ok(match value {
            Literal::Str(s) => (Operand::Literal(Value::String(s.clone())), Ty::Text(s.chars().count() as u32)),
            Literal::Number(n) => (Operand::Literal(Value::Int(super::integer_literal(n, site)?)), Ty::Int),
            Literal::Bool(b) => (Operand::Literal(Value::Bool(*b)), Ty::Bool),
            Literal::Null => (Operand::Literal(Value::Null), Ty::Null),
        }),
        Expr::Unary { op, value, .. } if op == "-" => {
            if let Expr::Literal { value: Literal::Number(n), site } = value.as_ref() { return Ok((Operand::Literal(Value::Int(super::integer_literal(&format!("-{n}"), site)?)), Ty::Int)); }
            Err(restricted(expr))
        }
        _ => Err(restricted(expr)),
    }
}
