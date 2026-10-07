use super::*;
use snapback4_core::schema::{RuleHop, MAX_RULE_HOPS};
// @ref LLP 3000.007#5.4 — bounded live, authorized point reads are distinct
// from the immutable audience capture of read through.
pub(super) fn rule_reference(catalog: &Catalog, info: &TableInfo, base: &Expr, field: &str, bindings: &RuleBindings, site: &Site) -> Fallible<(RuleTerm, Ty)> {
    let refusal = |reason: &str| Diagnostic::new(site, "E_QUARRY_RULE_HOP", reason,
        reference_rewrite(catalog, info, &Expr::Member { base: Box::new(base.clone()), name: field.into(), site: site.clone() })).guide("rules");
    let (source, ty) = match base {
        Expr::Member { .. } => rule_term(catalog, info, base, bindings)?,
        _ => return Err(refusal("a rule hop needs a row-local reference or an id lookup through it")),
    };
    let (column, old, mut hops) = match source {
        RuleTerm::Field(c) | RuleTerm::NextField(c) => (c, false, vec![]),
        RuleTerm::OldField(c) => (c, true, vec![]),
        RuleTerm::Reference { table, column, field, old } => (column, old, vec![RuleHop { table, field }]),
        RuleTerm::ReferenceChain { column, hops, old } => (column, old, hops),
        _ => return Err(refusal("a rule hop needs a row-local reference")),
    };
    if hops.len() >= MAX_RULE_HOPS { return Err(refusal("a rule term follows at most three references")); }
    let Ty::Ref(table) = ty.required() else { return Err(type_error(site, "a rule hop needs a table reference", "declare the source column with its referenced table type")); };
    let target = catalog.tables.get(&table).ok_or_else(|| unknown(site, format!("unknown table {table}"), "declare the referenced table"))?;
    let (owner, source_field) = hops.last().map_or((info, column.as_str()), |hop| (&catalog.tables[&hop.table], hop.field.as_str()));
    let private = |info: &TableInfo, field: &str| info.decl.columns.iter().any(|c| c.name == field && c.written_by.is_some() && !c.readable_by_audience);
    if !bindings.hops { return Err(refusal("read rules inherit whole parent authority with read through; live hops belong to write rules")); }
    if target.maintained.is_some() || super::super::columns::fields(target).any(|c| c == field) {
        return Err(refusal("a rule hop cannot read maintained targets or fields at a fixed point-read cost; pass the view's group keys to the mutation"));
    }
    if target.decl.ephemeral.is_some() { return Err(refusal("ephemeral rows cannot decide durable write authority; store this authority in a durable table before using the mutation check")); }
    if private(owner, source_field) || private(target, field) { return Err(refusal("a rule hop cannot disclose a private field to the row audience")); }
    let field_ty = column_ty(target, field).ok_or_else(|| unknown(site, format!("{table} has no column {field}"), name_rewrite(field, target.columns.keys().map(String::as_str), None)))?;
    if hops.is_empty() { return Ok((RuleTerm::Reference { table, column, field: field.into(), old }, field_ty)); }
    hops.push(RuleHop { table, field: field.into() });
    Ok((RuleTerm::ReferenceChain { column, hops, old }, field_ty))
}

/// A concrete mutation check. Bind each row before testing the predicate so
/// neither null equality nor negation can turn an absent/hidden hop into a grant.
/// Row-local fields name mutation inputs; named images keep old_/next_ prefixes.
pub(super) fn reference_rewrite(catalog: &Catalog, info: &TableInfo, expr: &Expr) -> String {
    fn lookup(catalog: &Catalog, table: &str, key: &str) -> String {
        // Aggregate rows are addressed by their group, never by a row id.
        let group = catalog.tables.get(table).filter(|t| t.maintained.is_some())
            .and_then(|t| t.indexes.iter().find(|i| i.name == "byGroup"));
        let key = group.map_or_else(|| format!("id = {key}"), |index|
            index.columns.iter().map(|field| format!("{field} = {field}")).collect::<Vec<_>>().join(", "));
        format!("{table}[{key}]")
    }
    fn private_guard(info: &TableInfo, field: &str, row: &str, lines: &mut Vec<String>) {
        if let Some(owner) = info.decl.columns.iter().find(|c| c.name == field && !c.readable_by_audience).and_then(|c| c.written_by.as_ref()) {
            lines.push(format!("require {row}{owner} = viewer else FORBIDDEN"));
        }
    }
    fn selected(catalog: &Catalog, table: &str, field: &str, local: &str) -> (String, Option<Ty>) {
        let target = catalog.tables.get(table);
        // A maintained view lookup returns its scalar value directly.
        let value = if field == "value" && target.is_some_and(|t| t.maintained.is_some()) { local.into() }
            else { format!("{local}.{field}") };
        (value,target.and_then(|t| column_ty(t,field)))
    }
    fn render(catalog: &Catalog, info: &TableInfo, expr: &Expr, lines: &mut Vec<String>) -> (String, Option<Ty>) {
        match expr {
            Expr::Member { base, name, .. } if matches!(base.as_ref(), Expr::Focal { .. }) => {
                private_guard(info, name, "", lines);
                (name.clone(), column_ty(info, name))
            },
            Expr::Member { base, name, .. } if matches!(base.as_ref(), Expr::Name { .. }) => {
                let Expr::Name { name: image, .. } = base.as_ref() else { unreachable!() };
                if let Some(Ty::Ref(table)) = column_ty(info, image).map(|ty| ty.required()) {
                    let local = format!("rule_parent_{}", lines.len());
                    lines.push(format!("{local} = {} ! else FORBIDDEN", lookup(catalog, &table, image)));
                    if let Some(target) = catalog.tables.get(&table) { private_guard(target, name, &format!("{local}."), lines); }
                    selected(catalog,&table,name,&local)
                } else { (format!("{image}_{name}"), column_ty(info, name)) }
            }
            Expr::Member { base, name, .. } => {
                let (key, ty) = if let Expr::Read(read) = base.as_ref() {
                    let key = read.keys.first().map(|key| render(catalog, info, &key.value, lines).0).unwrap_or_else(|| "id".into());
                    (key, Some(Ty::Ref(read.table.clone())))
                } else { render(catalog, info, base, lines) };
                if let Some(Ty::Ref(table)) = ty.map(|ty| ty.required()) {
                    let local = format!("rule_parent_{}", lines.len());
                    lines.push(format!("{local} = {} ! else FORBIDDEN", lookup(catalog, &table, &key)));
                    if let Some(target) = catalog.tables.get(&table) { private_guard(target, name, &format!("{local}."), lines); }
                    selected(catalog,&table,name,&local)
                } else { (crate::print::expression(expr), None) }
            }
            Expr::Binary { op, left, right, .. } => {
                let left = render(catalog, info, left, lines).0;
                let right = render(catalog, info, right, lines).0;
                (format!("({left} {op} {right})"), None)
            }
            Expr::Unary { op, value, .. } => (format!("{op} ({})", render(catalog, info, value, lines).0), None),
            Expr::Exists { read, .. } => {
                let keys = read.keys.iter().map(|key| {
                    let value = render(catalog, info, &key.value, lines).0;
                    key.column.as_ref().map_or(value.clone(), |col| format!("{col} = {value}"))
                }).collect::<Vec<_>>().join(", ");
                let index = read.index.as_ref().map_or(String::new(), |i| format!(" by {i}"));
                (format!("exists {}[{keys}]{index}", read.table), None)
            }
            _ => (crate::print::expression(expr), None),
        }
    }
    let mut lines = Vec::new();
    let (predicate, _) = render(catalog, info, expr, &mut lines);
    lines.push(format!("require {predicate} else FORBIDDEN"));
    lines.join("\n")
}
