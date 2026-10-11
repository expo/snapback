//! N_NEVER_COMPLETE names the missing pin as code against the author's own
//! columns: the equality to add, the parent read that supplies its value, the
//! two-query split for a two-party rule, and whether a role grant is used.
// @ref LLP 3000.036#11 — app-farm patterns 6 and 28.

use snapback4_core::ir::{ArgType, Expr, Program, Scan};
use snapback4_core::schema::{ColumnType, RuleExpr, RuleTerm, Schema, Table};

/// The concrete repair for a page whose read rule reads `unpinned`, or None
/// when no rendering beats the generic advice.
pub(super) fn pin_rewrite(schema: &Schema, program: &Program, scan: &Scan, table: &Table, unpinned: &[String]) -> Option<String> {
    let rule = &table.rules.read;
    let disjuncts = rule.disjuncts();
    let viewer_column = |rule: &RuleExpr| match rule {
        RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column)) => Some(column.clone()),
        _ => None,
    };
    let parties: Vec<String> = disjuncts.iter().filter_map(|d| viewer_column(d)).collect();
    let name = &scan.table;
    let mut out = Vec::new();
    if parties.len() >= 2 && unpinned.iter().all(|column| parties.contains(column)) {
        let queries = parties.iter().map(|column| format!("`{name} where .{column} = viewer …`")).collect::<Vec<_>>().join(" and ");
        out.push(format!("`{}` admits either party, so one page cannot certify both. Declare one query per party, each pinned and complete: {queries} (same order, page and cursor), and show or merge them in the client", rule.quarry()));
    } else {
        let mut setup = Vec::new();
        let mut pins = Vec::new();
        for column in unpinned {
            let (pin, line) = pin_for(schema, program, scan, table, column);
            pins.push(pin);
            if let Some(line) = line { if !setup.contains(&line) { setup.push(line); } }
        }
        let first = if setup.is_empty() { String::new() } else { format!("first {}, then ", setup.join("; ")) };
        out.push(format!("{first}add `and {}` to the page's where (keeping its current pins); this narrows the answer to that scope", pins.join(" and ")));
    }
    if let Some(grant) = disjuncts.iter().find(|d| row_independent(d)) {
        out.push(format!("the grant `{}` reads no row field, but completeness is decided per page, so neither it nor a `require` guard makes an unpinned page complete for its holders: they receive every row with complete: false (page with the cursor and render \"may be incomplete\")", grant.quarry()));
    }
    Some(out.join("; "))
}

/// `exists staff[viewer]` or `viewer = 'service:x'`: the same for every row.
fn row_independent(rule: &RuleExpr) -> bool {
    let mut fields = std::collections::BTreeSet::new();
    rule.fields(&mut fields);
    fields.is_empty() && !matches!(rule, RuleExpr::Allow | RuleExpr::Deny | RuleExpr::Public { .. })
}

fn pin_for(schema: &Schema, program: &Program, scan: &Scan, table: &Table, column: &str) -> (String, Option<String>) {
    let viewer = matches!(&table.rules.read, rule if contains_viewer_eq(rule, column));
    if viewer { return (format!(".{column} = viewer"), None); }
    let kind = table.columns.get(column).map(ColumnType::required);
    // A pinned reference whose row carries the same parent: `.board = c.board`.
    if let Some(ColumnType::Ref { table: parent }) = kind
        && let Some(index) = table.index(&scan.index) {
        for (part, key) in index.components.iter().zip(&scan.prefix) {
            let (Some(pinned), Some(Expr::Variable(value))) = (part.column(), key.scalar()) else { continue };
            if value.starts_with('$') { continue; }
            let Some(ColumnType::Ref { table: via }) = table.columns.get(pinned).map(ColumnType::required) else { continue };
            let Some(via_table) = schema.table(via) else { continue };
            if let Some((field, _)) = via_table.columns.iter().find(|(_, ty)| matches!(ty, ColumnType::Ref { table } if table == parent)) {
                let local = format!("{}Row", value);
                return (format!(".{column} = {local}.{field}"), Some(format!("read its parent: `{local} = {via}[{value}] ! else NOT_FOUND`")));
            }
        }
    }
    // An argument of the column's type.
    let wanted = match kind {
        Some(ColumnType::Ref { table }) => Some(ArgType::Ref { table: table.clone() }),
        Some(ColumnType::Principal) => Some(ArgType::Principal),
        Some(ColumnType::Int) => Some(ArgType::Int),
        Some(ColumnType::Time) => Some(ArgType::Time),
        _ => None,
    };
    if let Some(wanted) = wanted && let Some((arg, _)) = program.args.iter().find(|(_, ty)| **ty == wanted) {
        return (format!(".{column} = {arg}"), None);
    }
    let declared = match kind {
        Some(ColumnType::Ref { table }) => table.clone(),
        Some(ColumnType::Principal) => "principal".into(),
        Some(ColumnType::Int) => "int".into(),
        Some(ColumnType::Time) => "time".into(),
        _ => "…".into(),
    };
    (format!(".{column} = {column}"), Some(format!("declare `{column}: {declared}` among {}'s arguments", program.name)))
}

fn contains_viewer_eq(rule: &RuleExpr, column: &str) -> bool {
    match rule {
        RuleExpr::Eq(RuleTerm::Field(c), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(c)) => c == column,
        RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().any(|item| contains_viewer_eq(item, column)),
        _ => false,
    }
}
