//! Proposals only: the application owns role policy and must add the seat rule.
use snapback4_core::schema::{Schema, ColumnType};

// @ref LLP 3000.013#6.10 — role proposals never grant authority or edit source.
pub(super) fn proposal(schema: &Schema, name: &str) -> String {
    let Some(table) = schema.table(name) else { return String::new(); };
    let roles = match table.columns.get("role") {
        Some(ColumnType::Enum { variants }) => variants.iter().map(Some).collect::<Vec<_>>(),
        _ => vec![None],
    };
    let mut out = "Review this proposal, add the explicit service:ops insert branch to the table, and run check. No role is granted by signup.\n```quarry\n".to_owned();
    for (index, role) in roles.into_iter().enumerate() {
        let args = table.columns.iter().filter(|(column, _)| column.as_str() != "id" && !(column.as_str() == "role" && role.is_some()) && !table.defaults.contains_key(*column))
            .map(|(column, kind)| format!("{column}: {kind}")).collect::<Vec<_>>();
        let mut fields = table.columns.keys().filter(|column| column.as_str() != "id" && !(column.as_str() == "role" && role.is_some()) && !table.defaults.contains_key(*column)).cloned().collect::<Vec<_>>();
        if let Some(role) = role { fields.push(format!("role: '{}'", role.replace('\\', "\\\\").replace('\'', "\\'"))); }
        let suffix = if role.is_some() { format!("Role{}", index + 1) } else { String::new() };
        out.push_str(&format!("mutation bootstrap{name}{suffix}({}):\n  require viewer = 'service:ops' else NOT_OPERATOR\n  return insert {name} {{ {} }}\n", args.join(", "), fields.join(", ")));
    }
    out.push_str("```"); out
}

#[test]
fn each_declared_role_gets_a_compilable_seat_mutation() {
    let source = "use identity password\ntable roster:\n  principal: principal\n  role: enum('admin', 'reviewer')\n  unique principal\n  read <- viewer = 'service:ops'\n  insert <- viewer = 'service:ops'\n  online only\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let proposed = proposal(&bound.schema, "roster");
    assert!(proposed.contains("role: 'admin'") && proposed.contains("role: 'reviewer'"));
    let quarry = proposed.split("```quarry\n").nth(1).unwrap().split("```").next().unwrap();
    let revised = snapback4_lang::compile(&[("schema.q".into(), format!("{source}{quarry}"))]);
    assert!(revised.diagnostics.is_empty(), "{:?}", revised.diagnostics);
}
