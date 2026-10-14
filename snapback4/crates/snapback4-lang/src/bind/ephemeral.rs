//! Ephemeral declaration refusals before other lowering can obscure the clause.
use super::{BoundProgram, catalog::Catalog};
use crate::{ast::*, diag::Diagnostic};
use snapback4_core::schema::{Schema, SiteClass};

pub fn declarations(documents: &[Document], diagnostics: &mut Vec<Diagnostic>) {
    let eph: std::collections::BTreeSet<_> = documents
        .iter()
        .flat_map(|d| &d.tables)
        .filter(|t| t.ephemeral.is_some())
        .map(|t| t.name.as_str())
        .collect();
    if eph.is_empty() {
        return;
    }
    for doc in documents {
        for table in &doc.tables {
            let mut refuse = |clause: &str, fix: &str| {
                diagnostics.push(
                    Diagnostic::new(
                        &table.site,
                        "E_QUARRY_EPHEMERAL",
                        format!("table {}: {clause}", table.name),
                        fix,
                    )
                    .guide("ephemeral"),
                )
            };
            if table.ephemeral.is_some() {
                if table.sync.is_some() {
                    refuse(
                        "sync (including a horizon) cannot appear on an ephemeral table",
                        "delete the sync line; devices read ephemeral rows from the server",
                    );
                }
                if table.online_only {
                    refuse(
                        "online only cannot appear on an ephemeral table",
                        "delete the line; devices read ephemeral rows from the server",
                    );
                }
                if table.expire.is_some() {
                    refuse(
                        "expire at cannot appear on an ephemeral table",
                        "delete it; ephemeral <life> sets every row's deadline",
                    );
                }
                if table.not_before.is_some() {
                    refuse(
                        "not before cannot appear on an ephemeral table",
                        "keep the scheduled payload in a durable table",
                    );
                }
                if table.columns.iter().any(|c| c.sequence.is_some()) {
                    refuse(
                        "sequence by cannot appear on an ephemeral table",
                        "keep that data in a durable table",
                    );
                }
                if table
                    .rules
                    .iter()
                    .any(|r| matches!(&r.value, Expr::Call { name, .. } if name == "$readThrough"))
                {
                    refuse(
                        "through cannot appear on an ephemeral table",
                        "keep that data in a durable table",
                    );
                }
                if table.columns.iter().any(|c| asset(&c.type_.kind)) {
                    refuse(
                        "asset columns (image, video, once) cannot appear on an ephemeral table",
                        "keep that data in a durable table",
                    );
                }
                if !table.search.is_empty() || table.indexes.iter().any(|i| i.words.is_some()) {
                    refuse(
                        "words(..) indexes cannot appear on an ephemeral table",
                        "keep that data in a durable table",
                    );
                }
            }
            for col in &table.columns {
                if reference(&col.type_.kind).is_some_and(|t| eph.contains(t)) {
                    refuse(
                        "reference column cannot target an ephemeral table",
                        "keep the referenced data in a durable table",
                    );
                }
                if col
                    .maintained
                    .as_ref()
                    .is_some_and(|m| eph.contains(m.source.as_str()))
                {
                    refuse(
                        "maintained column cannot use an ephemeral source",
                        "count or rank durable rows",
                    );
                }
            }
            if table.sync.as_ref().is_some_and(|s| matches!(&s.audience, SyncAudience::Target { table, .. } if eph.contains(table.as_str()))) { refuse("sync to cannot target an ephemeral table", "keep the audience in a durable table"); }
        }
        for action in &doc.actions {
            if rule_reads_ephemeral(&action.rule, &eph) {
                diagnostics.push(
                    Diagnostic::new(
                        &action.site,
                        "E_QUARRY_EPHEMERAL",
                        "action cannot read an ephemeral table",
                        "call a separate ephemeral mutation from the client",
                    )
                    .guide("ephemeral"),
                );
            }
        }
        for t in &doc.timelines {
            if [&t.authors[0], &t.posts[0], &t.reposts[0], &t.edges[0]]
                .iter()
                .any(|n| eph.contains(n.as_str()))
            {
                diagnostics.push(
                    Diagnostic::new(
                        &t.site,
                        "E_QUARRY_EPHEMERAL",
                        "Following/feed cannot use an ephemeral source",
                        "count or rank durable rows",
                    )
                    .guide("ephemeral"),
                );
            }
        }
        for m in &doc.maintains {
            if eph.contains(m.source.as_str()) {
                diagnostics.push(
                    Diagnostic::new(
                        &m.site,
                        "E_QUARRY_EPHEMERAL",
                        "maintain cannot use an ephemeral source",
                        "count or rank durable rows",
                    )
                    .guide("ephemeral"),
                );
            }
        }
    }
}
// Action rules admit only booleans, comparisons and probes. The ordinary
// action binder still refuses every other expression with its existing code.
fn rule_reads_ephemeral(expr: &Expr, tables: &std::collections::BTreeSet<&str>) -> bool {
    match expr {
        Expr::Exists { read, .. } | Expr::Read(read) => tables.contains(read.table.as_str()),
        Expr::Unary { value, .. } => rule_reads_ephemeral(value, tables),
        Expr::Binary { left, right, .. } => {
            rule_reads_ephemeral(left, tables) || rule_reads_ephemeral(right, tables)
        }
        _ => false,
    }
}
fn asset(t: &TypeKind) -> bool {
    match t {
        TypeKind::Image { .. } | TypeKind::Video { .. } | TypeKind::File { .. } => true,
        TypeKind::List { item, .. } => asset(&item.kind),
        _ => false,
    }
}
fn reference(t: &TypeKind) -> Option<&str> {
    match t {
        TypeKind::Ref { table } => Some(table),
        TypeKind::List { item, .. } => reference(&item.kind),
        _ => None,
    }
}

pub fn programs(
    _catalog: &Catalog,
    schema: &mut Schema,
    programs: &[BoundProgram],
    diagnostics: &mut Vec<Diagnostic>,
) {
    for bound in programs {
        let mut fact = schema.operations[&bound.program.name].clone();
        if let Err(message) =
            snapback4_core::schema::ephemeral::execution(schema, &bound.program, &mut fact)
        {
            let (message, fix) = message.split_once("; ").unwrap_or((
                &message,
                "call a separate ephemeral mutation from the client",
            ));
            diagnostics.push(
                Diagnostic::new(&bound.site, "E_QUARRY_EPHEMERAL", message, fix).guide("ephemeral"),
            );
        }
        fact.search_decoration = snapback4_core::search_decoration::admit(schema, &bound.program).is_ok();
        fact.search = snapback4_core::search_plan::ordinary::composition(schema, &bound.program);
        let merges = snapback4_core::ir::body_merges(&bound.program.body);
        fact.branch_merge = merges.iter().any(|m| m.branches());
        fact.branch_pages_v2 = merges.iter().any(|merge| merge.branches() && merge.lanes.iter().any(|lane|
            lane.guarded() || lane.scan.filter.as_deref().is_some_and(predicate_probe)
            || schema.table(&lane.scan.table).is_some_and(|table|
                lane.grant() && table.sync.as_ref().is_some_and(snapback4_core::schema::Sync::is_union)
                || !snapback4_core::engine::rules::membership_point_id(schema, lane) && table.index(&lane.scan.index).is_some_and(|index| lane.scan.prefix.len() == index.components.len()))));
        // @ref LLP 3000.036.001#17 — older validators cannot prove a fixed second witness field.
        fact.branch_pages_v3 = merges.iter().flat_map(|merge| &merge.lanes).any(|lane| schema.table(&lane.scan.table).is_some_and(|table| lane.membership() && (multi_field_probe(&table.rules.read) || table.leave == snapback4_core::schema::LeavePolicy::DeliveredHistory)
                || (lane.guarded() || lane.grant()) && negative_probe(&table.rules.read)));
        fact.branch_pages_v3 |= snapback4_core::ir::scans(&bound.program).iter().any(|scan|
            snapback4_core::engine::rules::page_guard_decision(schema, scan).as_ref().is_some_and(negative_probe));
        fact.branch_pages_v3 |= bound.program.body.iter().any(uncapped_statement);
        // @ref LLP 3000.036.001#18 — PAGE5's fixed residual point needs the new validator.
        fact.branch_pages_v4 = merges.iter().flat_map(|merge| &merge.lanes).any(|lane|
            lane.vacancy() || lane.membership() && lane.scan.filter.as_deref().is_some_and(predicate_probe));
        fact.branch_membership = merges.iter().any(|merge| merge.lanes.iter().any(|lane| lane.membership()));
        fact.branch_membership_v2 = merges.iter().flat_map(|merge| &merge.lanes)
            .any(|lane| membership_v2(schema, lane));
        schema.operations.insert(bound.program.name.clone(), fact);
    }
}

fn predicate_probe(expr: &snapback4_core::ir::Expr) -> bool {
    use snapback4_core::ir::Expr;
    match expr {
        Expr::Exists(_) | Expr::Get(_) => true,
        Expr::Binary { left, right, .. } => predicate_probe(left) || predicate_probe(right),
        Expr::Unary { value, .. } => predicate_probe(value),
        Expr::Field { base, .. } => predicate_probe(base),
        Expr::Array(values) => values.iter().any(predicate_probe),
        Expr::Object(fields) => fields.values().any(predicate_probe),
        Expr::Builtin { args, .. } => args.iter().any(predicate_probe),
        Expr::Block { body, value } => body.iter().any(predicate_statement) || predicate_probe(value),
        _ => false,
    }
}

fn predicate_statement(stmt: &snapback4_core::ir::Stmt) -> bool {
    use snapback4_core::ir::Stmt;
    match stmt {
        Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. }
        | Stmt::Push { value, .. } | Stmt::Return(value) | Stmt::Require { condition: value, .. } => predicate_probe(value),
        Stmt::If { condition, then_body, else_body } => predicate_probe(condition)
            || then_body.iter().any(predicate_statement) || else_body.iter().any(predicate_statement),
        _ => false,
    }
}

fn membership_v2(schema: &Schema, lane: &snapback4_core::ir::MergeLane) -> bool {
    lane.membership() && !snapback4_core::engine::rules::membership_v1(schema, lane)
}
pub fn notes(schema: &Schema, programs: &[BoundProgram]) -> Vec<Diagnostic> {
    programs.iter().filter_map(|bound| {
        let fact = &schema.operations[&bound.program.name];
        (!fact.ephemeral_reads.is_empty() && fact.sites.iter().filter(|s| s.class == SiteClass::Server).all(|s| schema.table(&s.table).is_some_and(|t| t.ephemeral.is_some())))
            .then(|| Diagnostic::new(&bound.site, "N_EPHEMERAL_SERVER", format!("{} runs on the server because it reads an ephemeral table", bound.program.name), "split the ephemeral read into its own query and render it next to the device-held one").guide("ephemeral"))
    }).collect()
}

fn multi_field_probe(rule: &snapback4_core::schema::RuleExpr) -> bool {
    use snapback4_core::schema::{RuleExpr, RuleTerm};
    match rule {
        RuleExpr::Exists { key, equalities, .. } => key.iter().chain(equalities.iter().map(|(_, term)| term))
            .filter_map(|term| if let RuleTerm::Field(field) = term { Some(field) } else { None }).collect::<std::collections::BTreeSet<_>>().len() > 1,
        RuleExpr::And(terms) | RuleExpr::Or(terms) => terms.iter().any(multi_field_probe),
        _ => false,
    }
}

fn negative_probe(rule: &snapback4_core::schema::RuleExpr) -> bool {
    use snapback4_core::schema::RuleExpr;
    match rule { RuleExpr::Not(inner) => matches!(inner.as_ref(), RuleExpr::Exists { .. }),
        RuleExpr::And(terms) | RuleExpr::Or(terms) => terms.iter().any(negative_probe), _ => false }
}

fn uncapped_expr(expr: &snapback4_core::ir::Expr) -> bool {
    use snapback4_core::ir::{Builtin, Expr};
    match expr {
        Expr::Builtin { builtin: Builtin::RequireUncapped, .. } => true,
        Expr::Builtin { builtin: Builtin::JobQuery { program, .. }, args } =>
            program.body.iter().any(uncapped_statement) || args.iter().any(uncapped_expr),
        Expr::Builtin { args, .. } | Expr::Array(args) => args.iter().any(uncapped_expr),
        Expr::Binary { left, right, .. } => uncapped_expr(left) || uncapped_expr(right),
        Expr::Unary { value, .. } | Expr::Field { base: value, .. } => uncapped_expr(value),
        Expr::Block { body, value } => body.iter().any(uncapped_statement) || uncapped_expr(value),
        Expr::Object(fields) => fields.values().any(uncapped_expr),
        Expr::Shape { base, fields } => uncapped_expr(base) || fields.values().any(uncapped_expr),
        Expr::Get(read) | Expr::Exists(read) => read.key.iter().any(uncapped_expr),
        Expr::Scan(scan) => uncapped_scan(scan),
        Expr::Merge(merge) => merge.lanes.iter().any(|lane|
            uncapped_scan(&lane.scan) || lane.setup.iter().any(uncapped_statement)
            || lane.guard.as_ref().is_some_and(uncapped_expr) || lane.project.as_ref().is_some_and(uncapped_expr)
            || lane.source.as_ref().is_some_and(|source| source.scan().is_some_and(uncapped_scan) || source.expressions().into_iter().any(uncapped_expr))),
        _ => false,
    }
}
fn uncapped_statement(stmt: &snapback4_core::ir::Stmt) -> bool {
    use snapback4_core::ir::{Stmt, LoopDomain};
    match stmt {
        Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. }
        | Stmt::Return(value) | Stmt::Require { condition: value, .. } => uncapped_expr(value),
        Stmt::If { condition, then_body, else_body } => uncapped_expr(condition)
            || then_body.iter().any(uncapped_statement) || else_body.iter().any(uncapped_statement),
        Stmt::For { domain, body, .. } => body.iter().any(uncapped_statement)
            || match domain { LoopDomain::DerivedArray { value, .. } => uncapped_expr(value), LoopDomain::Page(scan) => uncapped_scan(scan), _ => false },
        _ => false,
    }
}

fn uncapped_scan(scan: &snapback4_core::ir::Scan) -> bool {
    scan.filter.as_deref().is_some_and(uncapped_expr) || scan.after.as_deref().is_some_and(uncapped_expr)
        || scan.before.as_deref().is_some_and(uncapped_expr)
        || scan.prefix.iter().filter_map(|key| key.scalar()).any(uncapped_expr)
}
