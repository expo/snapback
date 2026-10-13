//! A private population cannot answer a cross-row constraint for its writer.
// @ref LLP 3000.013#5.1 — aggregate consumers retain scan authorization and admission.
use super::*;
use snapback4_core::{engine::{admission, rules}, schema::{Constraint, Schema}};

impl BoundProgram {
    // @ref LLP 3000.025#6-diagnostics-and-exact-documentation-changes — retain the admission repair before the qualified receipt-gap fallback.
    pub(crate) fn expiry_gap_diagnostic(&self, schema: &Schema, problem: &admission::Problem) -> Option<Diagnostic> {
        use snapback4_core::schema::ColumnType;
        if problem.code != "E_STRUCTURAL_FANOUT" || self.program.kind != ir::ProgramKind::Mutation { return None; }
        let site = problem.page_site.as_ref()?;
        let scan = ir::scans(&self.program).into_iter().find(|scan| &scan.site == site)?;
        let table = schema.table(&scan.table)?;
        if !table.is_expiring() || !rules::scan_visibility(schema, scan).uniform { return None; }
        let scan_index = table.index(&scan.index)?;
        let ordinal = scan_index.components.get(scan.prefix.len())?.column()?;
        if table.columns.get(ordinal) != Some(&ColumnType::Int) || !scan.orders_field(schema, ordinal) { return None; }
        let (parent, parent_table) = table.indexes.values().filter(|index| index.unique).find_map(|index| {
            if index.components.len() != 2 { return None; }
            let columns = [index.components[0].column()?, index.components[1].column()?];
            let parent = if columns[0] == ordinal { columns[1] } else if columns[1] == ordinal { columns[0] } else { return None; };
            let ColumnType::Ref { table: parent_table } = table.columns.get(parent)? else { return None; };
            // Consider every covering key, in either column order. An earlier
            // key on an unpinned parent cannot hide the applicable one.
            let scope = scan_index.components.iter().zip(&scan.prefix)
                .find_map(|(part, key)| (part.column() == Some(parent)).then(|| key.scalar()).flatten())?;
            rules::prefix_visibility(&scan.table, table, &table.rules.read, &[(parent, scope)].into()).uniform
                .then_some((parent, parent_table))
        })?;
        // A sender/ordinal equality may make the refused page uniform while
        // other positions in the parent group remain hidden. Never call those holes.
        // Uniformity proves one verdict for the scope, not that it is readable;
        // proving a dominating caller check needs control-flow/rule implication.
        let name = &scan.table;
        // Quarry comments keep the whole rewrite pasteable without hiding the
        // smaller repair that admits the author's original scan.
        let rewrite = format!("-- {}\n-- Fallback if the mutation must keep its prediction or effect ordering:\nfn skipExpired_{name}(scope: {parent_table}, initialPrefix: int, low: int):\n  prefix = initialPrefix\n  for i in range(0, 1024):\n    if prefix + 1 >= low:\n      break\n    if exists {name}[{parent} = scope, {ordinal} = prefix + 1]:\n      break\n    prefix = prefix + 1\n  return prefix", problem.rewrite);
        Some(Diagnostic::new(&self.sources.get(site)?.0, problem.code,
            format!("{}. For receipt gaps, try the admission repair below first. If the shape must stay refused, use bounded unique ordinal probes; a new schema can declare `{ordinal}: sequence by {parent}` with `unique {parent}, {ordinal}`. The helper's prefix justifies advancing a receipt only after the caller's own authority check (the membership check or the card's readable-message anchor). Call it inside the receipt merge, retain disjoint runs, and let an already-recorded run reach the helper again to resume after the 1,024-probe limit. For an unread badge use a row-keyed count; for general processing use a query or job (guide sequences)", problem.message),
            rewrite).guide("sequences"))
    }

    /// This is diagnostic selection only. The ordinary admission pass still
    /// owns the capped-scope case; neither path changes a rule or a scan.
    pub(crate) fn constraint_diagnostic(&self, schema: &Schema, problem: &admission::Problem) -> Option<Diagnostic> {
        if problem.code != "E_STRUCTURAL_FANOUT" || self.program.kind != ir::ProgramKind::Mutation { return None; }
        let site = problem.page_site.as_ref()?;
        if !self.constraint_domains.contains(site) { return None; }
        let scan = ir::scans(&self.program).into_iter().find(|scan| &scan.site == site)?;
        if rules::scan_visibility(schema, scan).uniform || capped_scope_decides(schema, scan) { return None; }
        let table = schema.table(&scan.table)?;
        let source = &self.sources.get(site)?.0;
        // @ref LLP 3000.036#11 — render the repairs against the author's own table and pins (app-farm patterns 6, 19).
        let pins: Vec<(String, String)> = table.index(&scan.index).map(|index| index.components.iter().zip(&scan.prefix)
            .filter_map(|(part, key)| {
                let column = part.column()?.clone();
                let value = match key.scalar()? { Expr::Variable(name) if !name.starts_with('$') => name.clone(), _ => column.clone() };
                Some((column, value))
            }).collect()).unwrap_or_default();
        let name = &scan.table;
        let group = pins.iter().map(|(column, _)| column.clone()).collect::<Vec<_>>().join(", ");
        let key = pins.iter().map(|(_, value)| value.clone()).collect::<Vec<_>>().join(", ");
        let example = format!("declare one row per reserved unit with `unique resource, unit else TAKEN`, then insert those rows inside `{}`", self.program.name);
        // @ref LLP 3000.036#16.2 — wave 6 R2: `require not exists children…` before a delete is a zero count, not a capacity.
        let by = pins.iter().map(|(column, _)| format!(".{column}")).collect::<Vec<_>>().join(", ");
        let absence = (!pins.is_empty()).then(|| absence_require(&self.program.body, site)).flatten().map(|code| format!(
            "an absence check over every {name} row, whoever may read it, is a zero count (it discloses only the count per {group}, never who): declare `view {name}Count: count {name} by {by}` with `read <- allow`, then in `{}` write `require {name}Count[{key}] = 0 else {code}` in place of the `not exists` (before a delete of the parent, this guard also silences N_DELETE_RESTRICTED; guide recipes, \"Booking\", `removeSlot`). Otherwise, ", self.program.name)).unwrap_or_default();
        Some(Diagnostic::new(source, "E_STRUCTURAL_FANOUT",
            format!("`{}` can read only the {} its viewer may read (`{}`). A check over them would miss hidden {} rows, so it is refused. A point read of a full unique key (`exists {name}[…]`) is not refused, but it too sees only readable rows",
                self.program.name, scan.table, table.rules.read.quarry(), scan.table),
            format!("{absence}for one known {name} row, use a point read by id (`{name}[id]`); for a global total, read a maintained aggregate whose explicit read rule admits this caller (public only if its totals may be public). use a constraint every write obeys, whoever wrote the clashing row: {example}; a clash rolls back the whole mutation. A hidden clash stays E_RULE; make the unit table public only if availability may be public, so a readable clash can return TAKEN. Or use a readable audience: check a public availability table if those rows may be public. {count}A `require` role guard does not make the population readable. See `snapback4 guide writes` for the per-night example", count = if pins.is_empty() || !absence.is_empty() { String::new() } else {
                // @ref LLP 3000.036#14.6 — wave 4 #15: the count view and the author's own capacity check, as code.
                let check = capacity_require(&self.program.body, site).map_or_else(|| format!("require {name}Count[{key}] < limit else FULL"),
                    |(op, bound, code)| format!("require {name}Count[{key}] {op} {bound} else {code}"));
                format!("For a count or capacity, keep a count whose read rule covers the writers (it discloses only the count per {group}, never who): `view {name}Count: count {name} by {by}` with `read <- allow`, then in `{}` `{check}` before the insert; the insert itself keeps the count current (guide indexes, \"Private lists\"). ", self.program.name)
            }))
            .guide("writes"))
    }
}

/// Keep the existing scope-pinning rewrite only when a declared bounded
/// group supplies enough deciding columns. Preserve the current pins and
/// ask the engine's rule analysis, including self-probe absorption, whether
/// pinning that scope gives one verdict. A cap on unrelated columns cannot
/// turn a private conflict check into a check over every writer's rows.
fn capped_scope_decides(schema: &Schema, scan: &Scan) -> bool {
    let Some(table) = schema.table(&scan.table) else { return false };
    let Some(index) = table.index(&scan.index) else { return false };
    let pinned: BTreeMap<String, Expr> = index.components.iter().zip(&scan.prefix)
        .filter_map(|(part, key)| part.column().zip(key.scalar()).map(|(column, value)| (column.clone(), value.clone())))
        .collect();
    table.constraints.iter().any(|constraint| {
        let Constraint::Cap { by: group, max } = constraint else { return false };
        if u64::from(*max) > snapback4_core::Ceilings::default().examined { return false; }
        let mut candidate = pinned.clone();
        for column in group { candidate.entry(column.clone()).or_insert_with(|| ir::var("$constraint_scope")); }
        rules::prefix_visibility(&scan.table, table, &table.rules.read, &candidate.iter().collect()).uniform
    })
}

/// The `require count(page) OP bound else CODE` that consumes the refused
/// page, with `bound` printed when it is a local, a field of one, or a literal.
fn capacity_require(body: &[ir::Stmt], site: &str) -> Option<(&'static str, String, String)> {
    fn print(expr: &Expr) -> Option<String> {
        match expr {
            Expr::Variable(name) if !name.starts_with('$') => Some(name.clone()),
            // A local is renamed `$s2` for `s`; compiler temporaries are not locals.
            Expr::Variable(name) => {
                let local = name.strip_prefix('$')?.trim_end_matches(|c: char| c.is_ascii_digit());
                (!local.is_empty() && !["present", "probe", "bool", "row", "tmp", "pureCall"].contains(&local)).then(|| local.to_owned())
            }
            Expr::Field { base, name } => Some(format!("{}.{name}", print(base)?)),
            Expr::Literal(Value::Int(n)) => Some(n.to_string()),
            _ => None,
        }
    }
    let counts = |expr: &Expr| matches!(expr, Expr::Builtin { builtin: ir::Builtin::Count | ir::Builtin::CountCapped, args } if matches!(args.as_slice(), [Expr::Scan(scan)] if scan.site == site));
    body.iter().find_map(|statement| match statement {
        ir::Stmt::Require { condition: Expr::Binary { op, left, right }, code, .. } if counts(left) => {
            let op = match op { ir::BinaryOp::Lt => "<", ir::BinaryOp::Lte => "<=", _ => return None };
            Some((op, print(right)?, code.clone()))
        }
        ir::Stmt::If { then_body, else_body, .. } => capacity_require(then_body, site).or_else(|| capacity_require(else_body, site)),
        _ => None,
    })
}

/// The refusal code of a `require not exists …` whose existence test reads
/// the refused page (`require not exists sightings[cat = cat] else HAS`).
fn absence_require(body: &[ir::Stmt], site: &str) -> Option<String> {
    fn reads(expr: &Expr, site: &str) -> bool {
        match expr {
            Expr::Scan(scan) => scan.site == site,
            Expr::Unary { value, .. } => reads(value, site),
            Expr::Binary { left, right, .. } => reads(left, site) || reads(right, site),
            Expr::Builtin { args, .. } => args.iter().any(|arg| reads(arg, site)),
            Expr::Block { value, body } => reads(value, site) || body.iter().any(|statement| matches!(statement, ir::Stmt::Let { value, .. } if reads(value, site))),
            _ => false,
        }
    }
    body.iter().find_map(|statement| match statement {
        ir::Stmt::Require { condition: Expr::Unary { op: ir::UnaryOp::Not, value }, code, .. } if reads(value, site) => Some(code.clone()),
        ir::Stmt::If { then_body, else_body, .. } => absence_require(then_body, site).or_else(|| absence_require(else_body, site)),
        _ => None,
    })
}
