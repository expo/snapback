//! N_NEVER_COMPLETE names the missing pin as code against the author's own
//! columns: the equality to add, the parent read that supplies its value, the
//! two-query split for a two-party rule, and whether a role grant is used.
// @ref LLP 3000.036#11 — app-farm patterns 6 and 28.

use snapback4_core::ir::{ArgType, Expr, Program, Scan};
use snapback4_core::schema::{ColumnType, RuleExpr, RuleTerm, Schema, Table};

/// The concrete repair for a page whose read rule reads `unpinned`, or None
/// when no rendering beats the generic advice: the code to paste first (the
/// author's query split by role or by party, when it can be rendered from the
/// declaration), then the rest of the advice.
// @ref LLP 3000.036#14.2 — the role branch or per-party split leads the note, as code that compiles.
pub(super) fn pin_rewrite(schema: &Schema, program: &Program, scan: &Scan, table: &Table, unpinned: &[String], declaration: Option<&str>) -> Option<(Option<String>, String)> {
    let rule = &table.rules.read;
    let disjuncts = rule.disjuncts();
    let viewer_column = |rule: &RuleExpr| match rule {
        RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column)) => Some(column.clone()),
        _ => None,
    };
    let parties: Vec<String> = disjuncts.iter().filter_map(|d| viewer_column(d)).collect();
    let name = &scan.table;
    let grant = snapback4_core::engine::rules::grant_decision(schema, scan);
    let mut out = Vec::new();
    // @ref LLP 3000.036#16.1 — the form is built from every disjunct and printed only when it admits exactly the rule's readers.
    let form = super::complete_form::complete_form(schema, program, scan, table, declaration);
    let code = match &form { super::complete_form::Outcome::Form(form) => Some(format!("{}\n{}", form.lead, form.code)), _ => None };
    let only_parties = parties.len() >= 2 && unpinned.iter().all(|column| parties.contains(column)) && disjuncts.len() == parties.len();
    if only_parties {
        let queries = parties.iter().map(|column| format!("`{name} where .{column} = viewer …`")).collect::<Vec<_>>().join(" and ");
        // @ref LLP 3000.036#12 — wave 2 #11: print the author's own query once per party, ready to paste.
        if code.is_some() {
            out.push(format!("`{}` admits either party, so one page cannot certify both (an `or` of the two pins in `where` is still one scan)", rule.quarry()));
        } else {
            out.push(format!("`{}` admits either party, so one page cannot certify both. Declare one query per party, each pinned and complete: {queries} (same order, page and cursor), and show or merge them in the client", rule.quarry()));
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
        let others = if disjuncts.len() > 1 { " — only for a screen meant for that scope alone: every other reader the rule admits loses their rows" } else { "" };
        out.push(format!("{first}add `and {}` to the page's where (keeping its current pins); this narrows the answer to that scope{others}", pins.join(" and ")));
    }
    if let super::complete_form::Outcome::None(why) = &form {
        out.push(format!("there is no single complete form: {why}; keep the query as written and expect `complete: false` (`capped`; test.cases.jsonl's default passes it)"));
    }
    // @ref LLP 3000.036#12 — the engine decides a page once for a caller whose readable grant holds.
    if let Some(used) = &grant {
        out.push(format!("for callers `{}` admits (staff), this page is decided once and answers `complete: true`; everyone else pages their own rows with complete: false — in test.cases.jsonl run it as staff to expect complete, and expect `capped` for the others", used.quarry()));
    } else if let Some(grant) = disjuncts.iter().find(|d| row_independent(d)) {
        out.push(format!("the grant `{}` reads no row field, but its holders cannot read the row that grants it, so it does not decide the page (that would disclose the hidden row): they receive every row with complete: false. Let each holder read their own grant row (`read <- .principal = viewer` on the probed table) to make their pages complete", grant.quarry()));
    }
    Some((code, out.join("; ")))
}

/// The page statement of a one-statement query declaration: its `return`'s
/// read over `table`, with the rest of the declaration's header.
pub(super) fn single_page(text: &str, table: &str) -> Option<(String, crate::ast::ProgramDecl, crate::ast::Expr)> {
    use crate::ast::{Expr as A, Stmt as S};
    let (document, errors) = crate::parser::parse_document("query.q", text);
    if !errors.is_empty() { return None; }
    let [decl] = document.programs.as_slice() else { return None };
    let [S::Return { value, .. }] = decl.body.as_slice() else { return None };
    if !decl.prelude.is_empty() { return None; }
    let read = match value {
        A::Read(read) => read,
        A::Shape { base, .. } | A::ShapeUse { base, .. } => match base.as_ref() { A::Read(read) => read, _ => return None },
        _ => return None,
    };
    if read.table != table || !read.keys.is_empty() || read.matching.is_some() || read.index.is_some() { return None; }
    let (header, _) = text.split_once('\n')?;
    Some((header.to_owned(), decl.clone(), value.clone()))
}

/// `value` (a page over `table`, maybe shaped) with its `where` keeping every
/// conjunct but the parties' pins and their disjunction, and `.party = viewer` first.
pub(super) fn pinned_to(value: &crate::ast::Expr, parties: &[String], party: &str) -> Option<crate::ast::Expr> {
    use crate::ast::Expr as A;
    let mut value = value.clone();
    let read = match &mut value {
        A::Read(read) => read,
        A::Shape { base, .. } | A::ShapeUse { base, .. } => match base.as_mut() { A::Read(read) => read, _ => return None },
        _ => return None,
    };
    let site = read.site.clone();
    let pin = |column: &str, site: &crate::Site| A::Binary { op: "=".into(), left: Box::new(A::Member { base: Box::new(A::Focal { site: site.clone() }), name: column.into(), site: site.clone() }), right: Box::new(A::Name { name: "viewer".into(), site: site.clone() }), site: site.clone() };
    let party_only = |expr: &A| {
        fn disjuncts<'a>(e: &'a A, out: &mut Vec<&'a A>) { match e { A::Binary { op, left, right, .. } if op == "or" => { disjuncts(left, out); disjuncts(right, out); }, other => out.push(other) } }
        let mut parts = Vec::new();
        disjuncts(expr, &mut parts);
        parts.len() > 1 && parts.iter().all(|part| matches!(part, A::Binary { op, left, right, .. } if op == "=" && matches!(right.as_ref(), A::Name { name, .. } if name == "viewer") && matches!(left.as_ref(), A::Member { base, .. } if matches!(base.as_ref(), A::Focal { .. }))))
    };
    let mut conjuncts = Vec::new();
    fn split(e: A, out: &mut Vec<A>) { match e { A::Binary { op, left, right, .. } if op == "and" => { split(*left, out); split(*right, out); }, other => out.push(other) } }
    if let Some(filter) = read.filter.take() { split(*filter, &mut conjuncts); }
    conjuncts.retain(|part| !party_only(part) && !matches!(part, A::Binary { op, left, .. } if op == "=" && matches!(left.as_ref(), A::Member { base, name, .. } if matches!(base.as_ref(), A::Focal { .. }) && parties.iter().any(|p| p == name))));
    let filter = conjuncts.into_iter().fold(pin(party, &site), |acc, part| A::Binary { op: "and".into(), left: Box::new(acc), right: Box::new(part), site: site.clone() });
    read.filter = Some(Box::new(filter));
    Some(value)
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
        Some(ColumnType::IntRange { min, max }) => Some(ArgType::IntRange { min: *min, max: *max }),
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
        Some(kind @ ColumnType::IntRange { .. }) => kind.to_string(),
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

/// Disjuncts of the read rule that read row columns, all of which the scan
/// pins (`exists rides[.ride, leader = viewer]` under `.ride = ride`). They
/// decide the rule for this page and this caller, but the server only decides
/// a page from a disjunct that reads no column of the row (`grant_decision`),
/// so the page stays `complete: false` for their holders too.
pub(super) fn prefix_decided(scan: &Scan, table: &Table, pinned: &std::collections::BTreeSet<String>) -> Vec<RuleExpr> {
    let _ = scan;
    if !matches!(table.rules.read, RuleExpr::Or(_)) { return Vec::new(); }
    table.rules.read.disjuncts().into_iter().filter(|disjunct| {
        let mut fields = std::collections::BTreeSet::new();
        disjunct.fields(&mut fields);
        !fields.is_empty() && fields.iter().all(|field| pinned.contains(field))
    }).cloned().collect()
}

/// The repair that makes a prefix-decided parent grant complete: copy the
/// deciding principal onto the row (immutable, checked against the parent at
/// insert), read it as a column, and pin it in the holders' page.
// @ref LLP 3000.036#14.1 — lane 039: the leader's roster is complete once the leader is on the row.
pub(super) fn copy_recipe(name: &str, table: &Table, disjunct: &RuleExpr, page: Option<&str>) -> Option<String> {
    let RuleExpr::Exists { table: parent, key, equalities, .. } = disjunct else { return None };
    let ([RuleTerm::Field(reference)], [(column, RuleTerm::Viewer)]) = (key.as_slice(), equalities.as_slice()) else { return None };
    if !matches!(table.columns.get(reference).map(ColumnType::required), Some(ColumnType::Ref { table }) if table == parent) { return None; }
    let copy = match table.columns.get(column).map(ColumnType::required) {
        None | Some(ColumnType::Principal) => column.clone(),
        Some(_) => format!("{reference}{}{}", column[..1].to_ascii_uppercase(), &column[1..]),
    };
    let declare = if table.columns.contains_key(&copy) { String::new() } else { format!("`{copy}: principal`, ") };
    let rule = table.rules.read.disjuncts().iter().map(|d| if *d == disjunct { format!(".{copy} = viewer") } else { d.quarry() }).collect::<Vec<_>>().join(" or ");
    let pinned = page.map(|page| format!("; the holders' page then pins it and is complete: `{}`", add_pin(page, &copy))).unwrap_or_default();
    Some(format!("to make the page complete for `{}`'s holders, copy the deciding principal onto {name}: declare {declare}`immutable {reference}, {copy}`, add `and exists {parent}[.{reference}, {column} = .{copy}]` to the insert rule (the inserting mutation sets `{copy}` from the {parent} row), and read it as a column: `read <- {rule}`{pinned} (the copy is checked at insert, so it holds while {parent}.{column} cannot change)", disjunct.quarry()))
}

/// `t where … first …` with `.column = viewer` added to its where.
fn add_pin(page: &str, column: &str) -> String {
    match page.split_once(" where ") {
        Some((table, rest)) => format!("{table} where .{column} = viewer and {rest}"),
        None => match page.split_once(' ') { Some((table, rest)) => format!("{table} where .{column} = viewer {rest}"), None => format!("{page} where .{column} = viewer") },
    }
}
