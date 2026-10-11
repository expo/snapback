//! N_NEVER_COMPLETE names the missing pin as code against the author's own
//! columns: the equality to add, the parent read that supplies its value, the
//! two-query split for a two-party rule, and whether a role grant is used.
// @ref LLP 3000.036#11 — app-farm patterns 6 and 28.

use snapback4_core::ir::{ArgType, Expr, Program, Scan};
use snapback4_core::schema::{ColumnType, RuleExpr, RuleTerm, Schema, Table};

/// The concrete repair for a page whose read rule reads `unpinned`, or None
/// when no rendering beats the generic advice.
pub(super) fn pin_rewrite(schema: &Schema, program: &Program, scan: &Scan, table: &Table, unpinned: &[String], declaration: Option<&str>) -> Option<String> {
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
        // @ref LLP 3000.036#12 — wave 2 #11: print the author's own query once per party, ready to paste.
        let pasted = declaration.and_then(|text| party_declarations(text, name, &parties));
        match pasted {
            Some(declarations) => out.push(format!("`{}` admits either party, so one page cannot certify both (an `or` of the two pins in `where` is still one scan). Replace this query with one per party, each pinned and complete, and show both lists or merge them by their order in the client:\n{declarations}", rule.quarry())),
            None => out.push(format!("`{}` admits either party, so one page cannot certify both. Declare one query per party, each pinned and complete: {queries} (same order, page and cursor), and show or merge them in the client", rule.quarry())),
        }
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
    // @ref LLP 3000.036#12 — the engine decides a page once for a caller whose readable grant holds.
    if let Some(used) = snapback4_core::engine::rules::grant_decision(schema, scan) {
        out.push(format!("for callers `{}` admits (staff), this page is decided once and answers `complete: true`; everyone else pages their own rows with complete: false — in test.cases.jsonl run it as staff to expect complete, and expect `capped` for the others", used.quarry()));
    } else if let Some(grant) = disjuncts.iter().find(|d| row_independent(d)) {
        out.push(format!("the grant `{}` reads no row field, but its holders cannot read the row that grants it, so it does not decide the page (that would disclose the hidden row): they receive every row with complete: false. Let each holder read their own grant row (`read <- .principal = viewer` on the probed table) to make their pages complete", grant.quarry()));
    }
    Some(out.join("; "))
}

/// The query declaration `text` (one `return` of a page over `table`) once
/// per party: named `{query}As{Party}`, its `where` without the parties'
/// disjunction and with `.party = viewer` added, everything else as written.
fn party_declarations(text: &str, table: &str, parties: &[String]) -> Option<String> {
    use crate::ast::{Expr as A, Stmt as S};
    let (document, errors) = crate::parser::parse_document("query.q", text);
    if !errors.is_empty() { return None; }
    let [decl] = document.programs.as_slice() else { return None };
    let [S::Return { value, .. }] = decl.body.as_slice() else { return None };
    if !decl.prelude.is_empty() { return None; }
    let (header, _) = text.split_once('\n')?;
    let at = header.find(&format!(" {}(", decl.name))? + 1;
    let pin = |column: &str, site: &crate::Site| A::Binary { op: "=".into(), left: Box::new(A::Member { base: Box::new(A::Focal { site: site.clone() }), name: column.into(), site: site.clone() }), right: Box::new(A::Name { name: "viewer".into(), site: site.clone() }), site: site.clone() };
    let party_only = |expr: &A| {
        fn disjuncts<'a>(e: &'a A, out: &mut Vec<&'a A>) { match e { A::Binary { op, left, right, .. } if op == "or" => { disjuncts(left, out); disjuncts(right, out); }, other => out.push(other) } }
        let mut parts = Vec::new();
        disjuncts(expr, &mut parts);
        parts.len() > 1 && parts.iter().all(|part| matches!(part, A::Binary { op, left, right, .. } if op == "=" && matches!(right.as_ref(), A::Name { name, .. } if name == "viewer") && matches!(left.as_ref(), A::Member { base, .. } if matches!(base.as_ref(), A::Focal { .. }))))
    };
    let mut out = Vec::new();
    for party in parties {
        let mut value = value.clone();
        let read = match &mut value {
            A::Read(read) => read,
            A::Shape { base, .. } | A::ShapeUse { base, .. } => match base.as_mut() { A::Read(read) => read, _ => return None },
            _ => return None,
        };
        if read.table != table || !read.keys.is_empty() || read.matching.is_some() || read.index.is_some() { return None; }
        let site = read.site.clone();
        let mut conjuncts = Vec::new();
        fn split(e: A, out: &mut Vec<A>) { match e { A::Binary { op, left, right, .. } if op == "and" => { split(*left, out); split(*right, out); }, other => out.push(other) } }
        if let Some(filter) = read.filter.take() { split(*filter, &mut conjuncts); }
        conjuncts.retain(|part| !party_only(part) && !matches!(part, A::Binary { op, left, .. } if op == "=" && matches!(left.as_ref(), A::Member { base, name, .. } if matches!(base.as_ref(), A::Focal { .. }) && parties.contains(name))));
        let filter = conjuncts.into_iter().fold(pin(party, &site), |acc, part| A::Binary { op: "and".into(), left: Box::new(acc), right: Box::new(part), site: site.clone() });
        read.filter = Some(Box::new(filter));
        let mut name: Vec<char> = party.chars().collect();
        name[0] = name[0].to_ascii_uppercase();
        let header = format!("{}{}As{}{}", &header[..at], decl.name, name.into_iter().collect::<String>(), &header[at + decl.name.len()..]);
        out.push(format!("{header}\n  return {}", crate::print::with_source(&value, &|_| None)));
    }
    Some(out.join("\n"))
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
