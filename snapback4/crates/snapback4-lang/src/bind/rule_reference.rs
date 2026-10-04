use super::*;
// @ref LLP 3000.007#5.4 — a write-rule hop is a live, authorized point read,
// distinct from the immutable audience capture of read through.
pub(super) fn rule_reference(catalog: &Catalog, info: &TableInfo, base: &Expr, field: &str, bindings: &RuleBindings, site: &Site) -> Fallible<(RuleTerm, Ty)> {
    let refusal = |rewrite: String| Diagnostic::new(site, "E_QUARRY_RULE_HOP",
        "this rule position cannot follow that reference", rewrite).guide("rules");
    let (source, ty) = match base {
        Expr::Member { .. } => rule_term(catalog, info, base, bindings)?,
        _ => return Err(refusal("bind each parent with table[.ref] ! else NOT_FOUND in the mutation; use read through .ref for inherited read authority".into())),
    };
    let (column, old) = match source {
        RuleTerm::Field(c) | RuleTerm::NextField(c) => (c, false),
        RuleTerm::OldField(c) => (c, true),
        RuleTerm::Reference { table, column, field: parent_field, old } => {
            let parent = format!("{table}[{}.{column}].{parent_field}", if old { "old" } else { "" });
            let repair = if let Ty::Ref(target) = ty.required() { format!("{target}[{parent}].{field}") } else { parent };
            return Err(refusal(format!("use {repair} in a mutation require before the write; use read through for inherited read authority")));
        },
        _ => return Err(refusal("use a row-local reference, table[.ref].field".into())),
    };
    let Ty::Ref(table) = ty.required() else { return Err(type_error(site, "a rule hop needs a table reference", "declare the source column with its referenced table type")); };
    let target = catalog.tables.get(&table).ok_or_else(|| unknown(site, format!("unknown table {table}"), "declare the referenced table"))?;
    let image = if old { "old" } else { "" };
    let rewrite = format!("use {table}[{image}.{column}].{field} in a mutation require before the write; for inherited read authority declare read through .{column}");
    if !bindings.hops || target.maintained.is_some() || target.decl.ephemeral.is_some()
        || info.decl.columns.iter().any(|c| c.name == column && c.written_by.is_some() && !c.readable_by_audience)
        || target.decl.columns.iter().any(|c| c.name == field && c.written_by.is_some() && !c.readable_by_audience)
        || super::super::columns::fields(target).any(|c| c == field) {
        return Err(refusal(rewrite));
    }
    let field_ty = column_ty(target, field).ok_or_else(|| unknown(site, format!("{table} has no column {field}"), name_rewrite(field, target.columns.keys().map(String::as_str), None)))?;
    Ok((RuleTerm::Reference { table, column, field: field.into(), old }, field_ty))
}
