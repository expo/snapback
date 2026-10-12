//! A one-hop equality in an online-only table's read rule is the probe of the
//! row that decides it: `.goal.owner = viewer` reads exactly as
//! `exists goals[.goal, owner = viewer]`. Both are false when the reference
//! is null or names no row, and equal otherwise, so the lowering admits the
//! same readers under `and`, `or` and `not`.
// @ref LLP 3000.036#14.3 — wave 4 #8: a hop inside `or` compiles as the probe the diagnostic printed.
use super::*;
use crate::Site;

/// Lower the read rules that hop but do not spell a membership path (those
/// stay `read through`). Synced tables keep `E_QUARRY_RULE_HOP`: sync needs
/// the reader on the row, and its rewrite copies it there.
pub(super) fn lower(tables: &mut BTreeMap<String, TableInfo>) {
    let mut lowered = Vec::new();
    for (name, info) in tables.iter() {
        if info.decl.sync.is_some() || info.decl.ephemeral.is_some() || info.maintained.is_some() { continue; }
        let Some(reference) = super::reference(info) else { continue };
        if paths::declares_membership(info, &reference, tables) { continue; }
        let Some(position) = info.decl.rules.iter().position(|rule| rule.effect == Effect::Read && rule.bindings.is_empty()) else { continue };
        let mut value = info.decl.rules[position].value.clone();
        if rewrite(&mut value, info, tables) { lowered.push((name.clone(), position, value)); }
    }
    for (name, position, value) in lowered {
        if let Some(info) = tables.get_mut(&name) { info.decl.rules[position].value = value; }
    }
}

fn rewrite(expr: &mut Expr, info: &TableInfo, tables: &BTreeMap<String, TableInfo>) -> bool {
    match expr {
        Expr::Binary { op, left, right, .. } if op == "and" || op == "or" => {
            let a = rewrite(left, info, tables);
            let b = rewrite(right, info, tables);
            a || b
        }
        Expr::Unary { op, value, .. } if op == "not" => rewrite(value, info, tables),
        Expr::Binary { op, left, right, site } if op == "=" => {
            let (hop, other) = if hop(left).is_some() { (left.as_ref(), right.as_ref()) } else { (right.as_ref(), left.as_ref()) };
            let Some((reference, field)) = hop_parts(hop) else { return false };
            match probe(info, tables, reference, field, other, site) { Some(probe) => { *expr = probe; true } None => false }
        }
        Expr::Member { .. } => {
            let site = expr.site().clone();
            let Some((reference, field)) = hop_parts(expr) else { return false };
            let truth = Expr::Literal { value: Literal::Bool(true), site: site.clone() };
            match probe(info, tables, reference, field, &truth, &site) { Some(probe) => { *expr = probe; true } None => false }
        }
        _ => false,
    }
}

fn hop(expr: &Expr) -> Option<()> { hop_parts(expr).map(|_| ()) }

/// `.reference.field`, exactly one hop from the row.
fn hop_parts(expr: &Expr) -> Option<(&str, &str)> {
    let Expr::Member { base, name: field, .. } = expr else { return None };
    let Expr::Member { base, name: reference, .. } = base.as_ref() else { return None };
    matches!(base.as_ref(), Expr::Focal { .. }).then_some((reference.as_str(), field.as_str()))
}

fn probe(info: &TableInfo, tables: &BTreeMap<String, TableInfo>, reference: &str, field: &str, other: &Expr, site: &Site) -> Option<Expr> {
    let Some(ScalarType { kind: TypeKind::Ref { table: parent }, .. }) = info.columns.get(reference) else { return None };
    let target = tables.get(parent)?;
    if target.decl.ephemeral.is_some() || target.maintained.is_some() || target.through.is_some() { return None; }
    let column = target.decl.columns.iter().find(|column| column.name == field)?;
    // A private field stays refused: the hop's own diagnostic says why.
    if column.written_by.is_some() && !column.readable_by_audience { return None; }
    let kind = &target.columns.get(field)?.kind;
    // The other side: the viewer beside a principal, or a present literal of the field's type.
    let fits = match other {
        Expr::Name { name, .. } => name == "viewer" && matches!(kind, TypeKind::Principal),
        Expr::Literal { value: Literal::Str(_), .. } => matches!(kind, TypeKind::Text { .. } | TypeKind::Enum { .. }),
        Expr::Literal { value: Literal::Number(_), .. } => matches!(kind, TypeKind::Int | TypeKind::IntRange { .. }),
        Expr::Literal { value: Literal::Bool(_), .. } => matches!(kind, TypeKind::Bool),
        _ => false,
    };
    if !fits { return None; }
    let focal = Expr::Member { base: Box::new(Expr::Focal { site: site.clone() }), name: reference.into(), site: site.clone() };
    Some(Expr::Exists {
        read: ReadExpr {
            cursor_prefix: None, computed: Default::default(), order_keys: Vec::new(), table: parent.clone(),
            keys: vec![KeyPart { column: None, value: focal, site: site.clone() }, KeyPart { column: Some(field.into()), value: other.clone(), site: site.clone() }],
            seeks: Vec::new(), filter: None, index: None, range: None, matching: None, site: site.clone(),
        },
        site: site.clone(),
    })
}
