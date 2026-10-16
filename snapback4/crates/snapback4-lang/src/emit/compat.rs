//! @ref LLP 3000.000.000.000#3-generated-compatibility — opt-in types span a saved baseline and current source.
use super::*;

pub(super) fn args(current: &[(String, Ty)], old: Option<&[(String, Ty)]>, since: Option<u64>) -> String {
    if current.is_empty() { return "Record<string, never>".into(); }
    format!("{{ {} }}", current.iter().map(|(name, ty)| {
        let added = old.is_some_and(|old| !old.iter().any(|(n, _)| n == name));
        let optional = ty.is_optional() || added;
        format!("{}{}{}: {}", if added { format!("/** Since release {}. */ ", since.unwrap()) } else { String::new() }, property(name), if optional { "?" } else { "" }, ty_ts(ty))
    }).collect::<Vec<_>>().join("; "))
}

pub(super) fn result(current: &Ty, old: Option<&Ty>, since: Option<u64>) -> String {
    let Some(old) = old else { return ty_ts(current) };
    if current == old { return ty_ts(current); }
    match (current, old) {
        (Ty::Object(fields) | Ty::RowShape(fields) | Ty::RowObject(fields), Ty::Object(before) | Ty::RowShape(before) | Ty::RowObject(before)) => {
            let mut fields = fields.iter().map(|(name, ty)| {
                let optional = !before.contains_key(name);
                format!("{}{}{}: {}", if optional { format!("/** Since release {}. */ ", since.unwrap()) } else { String::new() }, property(name), if optional { "?" } else { "" }, result(ty, before.get(name), since))
            }).collect::<Vec<_>>();
            if matches!(current, Ty::RowShape(_) | Ty::RowObject(_)) { fields.push("pending?: boolean".into()); fields.push("retained?: boolean".into()); }
            format!("{{ {} }}", fields.join("; "))
        }
        (Ty::Optional(a), Ty::Optional(b)) => format!("{} | null", result(a, Some(b), since)),
        (Ty::List(a, _) | Ty::Collection(a, _), Ty::List(b, _) | Ty::Collection(b, _)) => format!("Array<{}>", result(a, Some(b), since)),
        // Nominal rows expand through Rows; value unions retain old enum/value domains.
        (Ty::Row(a), Ty::Row(b)) | (Ty::Page(a, _), Ty::Page(b, _)) if a == b => ty_ts(current),
        (Ty::Enum(a), Ty::Enum(b)) => {
            let mut variants = a.clone();
            for variant in b { if !variants.contains(variant) { variants.push(variant.clone()); } }
            ty_ts(&Ty::Enum(variants))
        }
        _ => {
            fn atoms(ty: &Ty, baseline: bool, out: &mut Vec<String>) {
                let mut add = |text| { if !out.contains(&text) { out.push(text); } };
                match ty {
                    Ty::Optional(inner) => { atoms(inner, baseline, out); if !out.iter().any(|atom| atom == "null") { out.push("null".into()); } }
                    Ty::Enum(variants) => for variant in variants { add(string_literal(variant)); },
                    _ => add(if baseline { baseline_type(ty) } else { ty_ts(ty) }),
                }
            }
            let mut union = Vec::new(); atoms(current, false, &mut union); atoms(old, true, &mut union);
            // Plain strings already include every enum literal, even through an optional.
            if union.iter().any(|atom| atom == "string") { union.retain(|atom| !atom.starts_with('"')); }
            union.join(" | ")
        },
    }
}

/// Keep baseline nominal types in their own namespace: a table may no longer
/// exist, or may now have a different public row shape.
fn baseline_type(ty: &Ty) -> String {
    match ty {
        Ty::Row(table) => format!("BaselineRows[{}]", string_literal(table)),
        Ty::WriteRow(table) => format!("BaselineWriteRows[{}]", string_literal(table)),
        Ty::Page(table, _) => format!("BaselineRows[{}][]", string_literal(table)),
        Ty::Optional(inner) => format!("{} | null", baseline_type(inner)),
        Ty::List(inner, _) | Ty::Collection(inner, _) => format!("Array<{}>", baseline_type(inner)),
        Ty::Object(fields) | Ty::RowShape(fields) | Ty::RowObject(fields) => {
            let mut parts = fields.iter().map(|(name, ty)| format!("{}: {}", property(name), baseline_type(ty))).collect::<Vec<_>>();
            if matches!(ty, Ty::RowShape(_) | Ty::RowObject(_)) { parts.push("pending?: boolean".into()); parts.push("retained?: boolean".into()); }
            if parts.is_empty() { "Record<string, never>".into() } else { format!("{{ {} }}", parts.join("; ")) }
        }
        _ => ty_ts(ty),
    }
}

pub(super) fn baseline_rows(bound: &Bound, out: &mut String) {
    out.push_str("type BaselineRows = {\n");
    for (name, table) in bound.schema.visible_tables() {
        out.push_str(&format!("  {}: {{\n", property(name)));
        for (column, kind) in table.columns.iter().filter(|(name, _)| !table.engine_field(name) && !snapback4_core::schema::timeline::is_slot(name)) {
            out.push_str(&format!("    {}{}: {};\n", property(column), if table.private_field(column) { "?" } else { "" }, column_ts(kind, &bound.schema)));
        }
        out.push_str("    pending?: boolean; retained?: boolean;\n  };\n");
    }
    for (name, ty) in &bound.view_types { out.push_str(&format!("  {}: {};\n", property(name), baseline_type(ty))); }
    out.push_str("};\ntype BaselineWriteRows = {\n");
    for (name, table) in bound.schema.visible_tables() {
        let fields = table.maintained.keys().map(|name| string_literal(name)).collect::<Vec<_>>().join(" | ");
        out.push_str(&format!("  {}: Omit<BaselineRows[{}], {}>;\n", property(name), string_literal(name), if fields.is_empty() { "never" } else { &fields }));
    }
    out.push_str("};\n\n");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn value_unions_deduplicate_through_optional_and_string_domains() {
        assert_eq!(result(&Ty::Text(80), Some(&Ty::Optional(Box::new(Ty::Text(40)))), Some(2)), "string | null");
        assert_eq!(result(&Ty::Enum(vec!["open".into(), "held".into()]), Some(&Ty::Optional(Box::new(Ty::Enum(vec!["open".into(), "closed".into()])))), Some(2)), "\"open\" | \"held\" | \"closed\" | null");
        assert_eq!(result(&Ty::Enum(vec!["open".into()]), Some(&Ty::Text(40)), Some(2)), "string");
    }
}
