//! Compiler proof for a one-to-one search projection made only of point reads.
use crate::{ir::*, schema::Schema, Value};
use std::collections::BTreeSet;

pub struct Parts<'a> {
    pub binding: &'a str,
    pub domain: &'a LoopDomain,
    pub value: &'a Expr,
}
impl Parts<'_> {
    pub fn bare(&self, program: &Program) -> Program {
        let mut bare = program.clone();
        bare.body = vec![Stmt::Return(match self.domain {
            LoopDomain::Page(scan) => Expr::Scan(scan.clone()),
            LoopDomain::DerivedArray { value, .. } => value.clone(),
            _ => unreachable!(),
        })];
        bare.returned_shapes.clear();
        bare
    }
}

// @ref LLP 3000.028#3.3.1 — recognize the binder's single collector, not an
// arbitrary authored loop. Every emitted hit has exactly one projected value.
pub fn parts(program: &Program) -> Option<Parts<'_>> {
    let [Stmt::Let { name, value: Expr::Array(empty) },
        Stmt::For { binding, domain, body }, Stmt::Return(Expr::Variable(result))] = program.body.as_slice() else { return None };
    let [Stmt::Push { target, value }] = body.as_slice() else { return None };
    if !empty.is_empty() || name != result || name != target || !name.starts_with("$rows") { return None; }
    Some(Parts { binding, domain, value })
}

pub fn page(value: &Expr) -> Option<&Scan> {
    if let Expr::Scan(scan) = value { return Some(scan); }
    let Expr::Block { body, value } = value else { return None };
    let [Stmt::Let { name: needle, value: input }, Stmt::Let { name: result, value: Expr::Literal(Value::Null) },
        Stmt::If { condition: Expr::Builtin { builtin: Builtin::SearchPresent, args }, then_body, else_body }] = body.as_slice() else { return None };
    if !needle.starts_with("$intentNeedle") || !result.starts_with("$if")
        || !matches!(input, Expr::Variable(_) | Expr::Literal(_))
        || args != &[Expr::Variable(needle.clone())] || value.as_ref() != &Expr::Variable(result.clone()) { return None; }
    let [Stmt::Assign { name: yes, value: Expr::Scan(scan) }] = then_body.as_slice() else { return None };
    let [Stmt::Assign { name: no, value: Expr::Scan(browse) }] = else_body.as_slice() else { return None };
    (yes == result && no == result && browse.table == scan.table && browse.site == scan.site).then_some(scan)
}

pub fn scan<'a>(parts: &Parts<'a>) -> Option<&'a Scan> {
    match parts.domain {
        LoopDomain::Page(scan) => Some(scan),
        LoopDomain::DerivedArray { value, .. } => page(value),
        _ => None,
    }
}

pub fn scalar(value: &Expr) -> bool {
    match value {
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(Input::Viewer) => true,
        Expr::Field { base, .. } => matches!(base.as_ref(), Expr::Variable(v) if v == "$filter"),
        Expr::Unary { value, .. } => scalar(value),
        Expr::Binary { left, right, .. } => scalar(left) && scalar(right),
        _ => false,
    }
}

/// The certificate and execution descriptor share this proof. Unsupported
/// shapes retain their evaluator and can explain the precise rejected part.
pub fn admit<'a>(schema: &Schema, program: &'a Program) -> Result<Parts<'a>, &'static str> {
    if program.kind != ProgramKind::Query || program.native || schema.operations.get(&program.name).is_some_and(|f| f.held) { return Err("explicit guard, held operation or non-query body"); }
    let parts = parts(program).ok_or("projection contains statements beyond a point lookup")?;
    let scan = scan(&parts).ok_or("projection is not over one ordinary search page")?;
    if !matches!(scan.prefix.last(), Some(IndexKeyExpr::WordPrefix(_))) || scan.merge_site.is_some() { return Err("projection is not over one ordinary search page"); }
    if scan.filter.as_deref().is_some_and(|f| !scalar(f)) { return Err("filter depends on a decoration or subquery"); }
    let mut reads = BTreeSet::new();
    if !point_value(schema, parts.value, parts.binding, &mut reads) { return Err("projection contains an aggregate, non-key subquery or computed decoration"); }
    Ok(parts)
}

pub fn reads(schema: &Schema, parts: &Parts<'_>) -> BTreeSet<(String, String)> {
    let mut reads = BTreeSet::new();
    point_value(schema, parts.value, parts.binding, &mut reads);
    reads
}

fn point_value(schema: &Schema, value: &Expr, binding: &str, reads: &mut BTreeSet<(String, String)>) -> bool {
    match value {
        Expr::Literal(_) | Expr::Input(Input::Viewer) => true,
        Expr::Variable(name) => name == binding,
        Expr::Field { base, .. } => point_value(schema, base, binding, reads),
        Expr::Shape { base, fields } => matches!(base.as_ref(), Expr::Variable(name) if name == binding)
            && fields.values().all(|v| point_value(schema, v, binding, reads)),
        Expr::Object(fields) => fields.values().all(|v| point_value(schema, v, binding, reads)),
        Expr::Builtin { builtin: Builtin::OptionalField { .. }, args } => args.iter().all(|v| point_value(schema, v, binding, reads)),
        Expr::Get(read) => {
            let Some(table) = schema.table(&read.table) else { return false };
            let Some(index) = table.index(&read.index) else { return false };
            if !index.unique || !index.is_plain() || index.components.len() != read.key.len()
                || index.components.iter().any(|c| c.key_type(table).is_none_or(|kind| kind.is_optional()))
                || schema.maintain_for(&read.table).is_some() || table.ephemeral.is_some() { return false; }
            reads.insert((read.table.clone(), read.index.clone()));
            read.key.iter().all(|v| point_value(schema, v, binding, reads))
        }
        _ => false,
    }
}
