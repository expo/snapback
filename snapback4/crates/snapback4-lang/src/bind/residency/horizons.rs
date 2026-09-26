//! Persistent advice from the same coverage facts that qualify prediction.
use super::*;

// @ref LLP 3000.007#6.2 — horizon risks remain visible even when an unchanged check emits no transition note.
pub(super) fn reads(fact: &Execution) -> Vec<String> {
    fact.sites.iter().filter(|site| site.class == SiteClass::Horizon && !inserts::blocked(site)
        && !(site.kind == "write target" && fact.sites.iter().any(|insert| inserts::blocked(insert) && insert.site == site.site && insert.table == site.table && insert.index == site.index)))
        .map(|site| match site.site.split_once(" (") {
            Some((location, spelling)) => format!("{} ({location})", spelling.strip_suffix(')').unwrap_or(spelling)),
            None => format!("{} by {} ({})", site.table, site.index, site.site),
        }).collect::<BTreeSet<_>>().into_iter().collect()
}

// Point/exists reads, live aggregates and successful insert proofs need
// whole coverage on a miss. Ordinary pages do not establish absence.
pub(in crate::bind) fn needs_whole_partition(schema: &Schema, name: &str) -> bool {
    schema.operations.values().any(|fact| fact.predicts.as_deref() == Some("eligible") && fact.sites.iter().any(|site|
        site.table == name && site.class == SiteClass::Held && matches!(site.kind.as_str(), "point" | "rule" | "aggregate source" | "upsert insert" | "insert if absent")))
}

// @ref LLP 3000.007#6.2 — eligibility alone does not mean a page can predict under the suggested horizon.
pub(in crate::bind) fn incompatible_horizon_pages(schema: &Schema, programs: &[super::super::BoundProgram], table: &str, index: Option<&str>) -> Vec<String> {
    programs.iter().filter(|bound| bound.program.kind == ProgramKind::Mutation
        && schema.operations.get(&bound.program.name).is_some_and(|fact| fact.predicts.as_deref() == Some("eligible"))
        && ir::scans(&bound.program).iter().any(|scan| scan.table == table && (scan.order != ir::Order::Desc || Some(scan.index.as_str()) != index)))
        .map(|bound| bound.program.name.clone()).collect::<BTreeSet<_>>().into_iter().collect()
}

mod sync_order;
pub(in crate::bind) use sync_order::sync_order_notes;

pub(in crate::bind) fn guard_notes(schema: &Schema, programs: &[super::super::BoundProgram]) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    for bound in programs.iter().filter(|bound| bound.program.kind == ProgramKind::Mutation) {
        guards(&bound.program.body, &mut |condition, code| {
            if !code.split('_').any(|word| matches!(word, "DUPLICATE" | "RETRY" | "DEDUPE")) { return; }
            let Expr::Unary { op: ir::UnaryOp::Not, value } = condition else { return };
            let Expr::Exists(read) = value.as_ref() else { return };
            let [Expr::Variable(arg)] = read.key.as_slice() else { return };
            if read.index != "byId" || !bound.program.args.contains_key(arg)
                || schema.tables.get(&read.table).and_then(|table| table.sync.as_ref()).is_none_or(|sync| sync.horizon.is_none()) { return; }
            let Some((location, spelling)) = bound.sources.get(&read.site) else { return };
            let guard = format!("require not exists {spelling} else {code}");
            notes.push(Diagnostic::new(location, "N_HORIZON_GUARD",
                format!("{}: `{guard}` reads the argument row id `{arg}`, not the mutation write id; a miss past the horizon cannot prove row absence, so this call queues without a predicted row", bound.program.name),
                format!("if this guard only dedupes retries, remove `{guard}` and keep the insert; retry with the same mutation write id for this principal. That id dedupes the mutation, not the argument row id; a new mutation write id with the same row id is a different write. Keep guards that enforce an application requirement"))
                .guide("prediction"));
        });
    }
    notes.sort_by(|a, b| (&a.site.file, a.site.line, a.site.col, &a.message).cmp(&(&b.site.file, b.site.line, b.site.col, &b.message)));
    notes.dedup();
    notes
}

fn guards(stmts: &[Stmt], visit: &mut impl FnMut(&Expr, &str)) {
    for stmt in stmts {
        match stmt {
            Stmt::Require { condition, code, .. } => { visit(condition, code); in_expr(condition, visit); }
            Stmt::If { condition, then_body, else_body } => { in_expr(condition, visit); guards(then_body, visit); guards(else_body, visit); }
            Stmt::For { domain, body, .. } => {
                match domain {
                    LoopDomain::DerivedArray { value, .. } => in_expr(value, visit),
                    LoopDomain::ExpressionRange { start, end_exclusive } => { in_expr(start, visit); in_expr(end_exclusive, visit); }
                    _ => {}
                }
                guards(body, visit);
            }
            Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. } | Stmt::Return(value) => in_expr(value, visit),
            Stmt::Emit { payload: value, once, .. } => { in_expr(value, visit); if let Some(value) = once { in_expr(value, visit); } },
            Stmt::Insert { row, .. } | Stmt::InsertIfAbsent { row, .. } => in_expr(row, visit),
            Stmt::Update { key, patch, .. } => { in_expr(key, visit); in_expr(patch, visit); }
            Stmt::Upsert { key, row, .. } => { in_expr(key, visit); in_expr(row, visit); }
            Stmt::WriteTarget { patch, condition, .. } => {
                in_expr(patch, visit);
                if let Some(condition) = condition { guards(&condition.setup, visit); in_expr(&condition.value, visit); }
            }
            _ => {}
        }
    }
}
fn in_expr(expr: &Expr, visit: &mut impl FnMut(&Expr, &str)) {
    match expr {
        Expr::Block { body, value } => { guards(body, visit); in_expr(value, visit); }
        Expr::Unary { value, .. } | Expr::Field { base: value, .. } => in_expr(value, visit),
        Expr::Binary { left, right, .. } => { in_expr(left, visit); in_expr(right, visit); }
        Expr::Object(fields) => for value in fields.values() { in_expr(value, visit); },
        Expr::Array(values) | Expr::Builtin { args: values, .. } => for value in values { in_expr(value, visit); },
        Expr::Shape { base, fields } => { in_expr(base, visit); for value in fields.values() { in_expr(value, visit); } }
        Expr::Get(read) | Expr::Exists(read) => for key in &read.key { in_expr(key, visit); },
        _ => {}
    }
}
