//! A private population cannot answer a cross-row constraint for its writer.
// @ref LLP 3000.013#5.1 — aggregate consumers retain scan authorization and admission.
use super::*;
use snapback4_core::{engine::{admission, rules}, schema::{Constraint, Schema}};

impl BoundProgram {
    // @ref LLP 3000.015#2-sequence-by — receipt holes are unique ordinal probes, never expiry scans.
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
        let rewrite = format!("fn skipExpired_{name}(scope: {parent_table}, initialPrefix: int, low: int):\n  prefix = initialPrefix\n  for i in range(0, 1024):\n    if prefix + 1 >= low:\n      break\n    if exists {name}[{parent} = scope, {ordinal} = prefix + 1]:\n      break\n    prefix = prefix + 1\n  return prefix");
        Some(Diagnostic::new(&self.sources.get(site)?.0, problem.code,
            format!("{}. For receipt gaps in expiring messages, declare `{ordinal}: sequence by {parent}` with `unique {parent}, {ordinal}` in a new schema, then use bounded unique ordinal probes. The helper's prefix justifies advancing a receipt only after the caller's own authority check (the membership check or the card's readable-message anchor). Call it inside the receipt merge, retain disjoint runs, and let an already-recorded run reach the helper again to resume after the 1,024-probe limit. For an unread badge use a row-keyed count; for general processing use a query or job (guide sequences)", problem.message),
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
        let example = format!("declare one row per reserved unit with `unique resource, unit else TAKEN`, then insert those rows inside `{}`", self.program.name);
        Some(Diagnostic::new(source, "E_STRUCTURAL_FANOUT",
            format!("`{}` can read only the {} its viewer may read (`{}`). A check over them would miss hidden {} rows, so it is refused",
                self.program.name, scan.table, table.rules.read.quarry(), scan.table),
            format!("use a constraint every write obeys, whoever wrote the clashing row: {example}; a clash rolls back the whole mutation. A hidden clash stays E_RULE; make the unit table public only if availability may be public, so a readable clash can return TAKEN. Or use a readable audience: check a public availability table if those rows may be public. See `snapback4 guide writes` for the per-night example"))
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
