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

/// Only maintain binding sees these synthetic columns; ordinary programs never do.
pub(super) fn recorded_paths(tables: &BTreeMap<String, TableInfo>, maintain: &MaintainDecl) -> Fallible<BTreeMap<String, ScalarType>> {
    fn visit(tables: &BTreeMap<String, TableInfo>, source: &TableInfo, expr: &Expr, out: &mut BTreeMap<String, ScalarType>) -> Fallible<()> {
        match expr {
            Expr::Member { base, name, .. } if !matches!(base.as_ref(), Expr::Focal { .. }) => {
                let fail = |message: String| refusal(expr.site(), message, "use one immutable reference to a public table and an immutable target column (or id)");
                let Expr::Name { name: reference, .. } = base.as_ref() else { return Err(fail("maintain reference paths have exactly one hop".into())); };
                let Some(ScalarType { kind: TypeKind::Ref { table }, .. }) = source.columns.get(reference) else { return Err(fail(format!("{reference} must be a reference column of {}", source.decl.name))); };
                if !source.decl.immutable.iter().any(|(fields, _)| fields.contains(reference)) { return Err(fail(format!("{}.{} must be immutable", source.decl.name, reference))); }
                let target = tables.get(table).ok_or_else(|| fail(format!("unknown target table {table}")))?;
                let reads: Vec<_> = target.decl.rules.iter().filter(|rule| rule.effect == Effect::Read).collect();
                let public = match (target.decl.public.is_some(), reads.as_slice()) {
                    (true, []) => true,
                    (false, [rule]) if !matches!(&rule.value, Expr::Call { name, args, .. } if name == "public" && !args.is_empty()) => {
                        let catalog = super::catalog::Catalog { tables: tables.clone(), ..Default::default() };
                        super::schema::bind_rule(&catalog, target, rule).is_ok_and(|rule| rule.is_uniformly_readable())
                    }
                    _ => false,
                };
                if !public { return Err(fail(format!("{table}'s effective read rule must be unconditionally public or allow; use one read policy without public(...) arguments"))); }
                let mut ty = if name == "id" { ScalarType { kind: TypeKind::Id, optional: false } }
                    else { target.columns.get(name).cloned().ok_or_else(|| fail(format!("unknown column {table}.{name}")))? };
                if name != "id" && !target.decl.immutable.iter().any(|(fields, _)| fields.contains(name)) { return Err(fail(format!("{table}.{name} must be immutable"))); }
                ty.optional = true;
                out.insert(format!("{reference}.{name}"), ty);
            }
            Expr::Call { args, .. } => for arg in args { visit(tables, source, arg, out)?; },
            Expr::Binary { left, right, .. } => { visit(tables, source, left, out)?; visit(tables, source, right, out)?; }
            Expr::Unary { value, .. } => visit(tables, source, value, out)?,
            _ => {}
        }
        Ok(())
    }
    let mut out = BTreeMap::new();
    if let Some(source) = tables.get(&maintain.source) {
        for key in &maintain.keys { visit(tables, source, key, &mut out)?; }
        if let Some(filter) = &maintain.filter { visit(tables, source, filter, &mut out)?; }
    }
    Ok(out)
}

fn path(expr: &Expr) -> Option<String> {
    match expr {
        Expr::Member { base, name, .. } => match base.as_ref() {
            Expr::Focal { .. } => Some(name.clone()),
            Expr::Name { name: reference, .. } => Some(format!("{reference}.{name}")),
            _ => None,
        },
        _ => None,
    }
}

pub(super) fn keys(source: &TableInfo, maintain: &MaintainDecl) -> Fallible<BTreeMap<String, CalendarKey>> {
    let mut computed = BTreeMap::new();
    let mut names = BTreeSet::from(["id".to_owned(), "value".to_owned()]);
    for (field, key) in maintain.by.iter().zip(&maintain.keys) {
        if !names.insert(field.clone()) { return Err(refusal(key.site(), format!("maintain output name {field} is duplicated or reserved"), "use distinct bare keys and at most one day, hour and bucket key; id and value are reserved")); }
        match key {
            Expr::Name { name, .. } if source.columns.contains_key(name) => {}
            Expr::Member { .. } if path(key).is_some_and(|p| source.recorded.contains_key(&p)) => {}
            Expr::Call { name, args, .. } if matches!(name.as_str(), "day" | "hour" | "bucket") => {
                let (millis, offset) = calendar(name, args, key.site())?;
                let column = path(&args[0]).ok_or_else(|| refusal(args[0].site(), "calendar group key needs a source time column or recorded path", "day(.at), hour(postId.at), or bucket(.at, 2m)"))?;
                if !source.columns.get(&column).is_some_and(|ty| ty.kind == TypeKind::Time && (!ty.optional || source.recorded.contains_key(&column))) {
                    return Err(refusal(args[0].site(), format!("{}.{} must be a required time column or recorded time path for {name}", maintain.source, column), format!("{column}: time")));
                }
                computed.insert(field.clone(), CalendarKey { function: name.clone(), column: column.clone(), millis, offset });
            }
            _ => return Err(refusal(key.site(), "maintain group keys are bare source columns or day, hour and bucket of a required time column", "by authorId, day(.at)")),
        }
    }
    Ok(computed)
}

pub(super) fn calendar(name: &str, args: &[Expr], site: &Site) -> Fallible<(i64, i64)> {
    let base = if name == "bucket" { 2 } else { 1 };
    let rewrite = "day(time, 8h), hour(time, 30m), or bucket(time, 1d, 8h); omit the offset for UTC epoch boundaries";
    if args.len() != base && args.len() != base + 1 { return Err(refusal(site, "calendar key takes a time, a bucket duration if needed, and an optional literal offset", rewrite)); }
    let literal = |expr: &Expr| match expr {
        Expr::Literal { value: Literal::Number(n), site } => super::integer_literal(n, site),
        _ => Err(refusal(expr.site(), "calendar durations and offsets must be literals", rewrite)),
    };
    let millis = match name { "day" => 86_400_000, "hour" => 3_600_000, _ => literal(&args[1])? };
    if millis <= 0 { return Err(refusal(site, "bucket duration must be positive", "bucket(.at, 2m)")); }
    let offset = if args.len() > base { literal(&args[base])? } else { 0 };
    if offset < 0 || offset >= millis { return Err(refusal(args[base].site(), "calendar offset must be nonnegative and smaller than its period", rewrite)); }
    Ok((millis, offset))
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
        Expr::Member { .. } if path(expr).is_some() => {
            let name = path(expr).unwrap();
            let ty = if name == "id" { Ty::Id } else { source.columns.get(&name).map(Ty::from_scalar).ok_or_else(|| restricted(expr))? };
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
