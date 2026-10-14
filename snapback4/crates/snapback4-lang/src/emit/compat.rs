//! @ref LLP 3000.000.000.000#3-generated-compatibility — opt-in types span a saved baseline and current source.
use super::*;

pub(super) fn args(current: &[(String, Ty)], old: Option<&[(String, Ty)]>, since: Option<u64>) -> String {
    if current.is_empty() { return "Record<string, never>".into(); }
    format!("{{ {} }}", current.iter().map(|(name, ty)| {
        let optional = old.is_some_and(|old| !old.iter().any(|(n, _)| n == name));
        format!("{}{}{}: {}", if optional { format!("/** Since release {}. */ ", since.unwrap()) } else { String::new() }, property(name), if optional { "?" } else { "" }, ty_ts(ty))
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
        _ => format!("({} | {})", ty_ts(current), ty_ts(old)),
    }
}
