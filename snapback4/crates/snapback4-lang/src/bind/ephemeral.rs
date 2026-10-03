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
        TypeKind::Image { .. } | TypeKind::Video { .. } => true,
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
        schema.operations.insert(bound.program.name.clone(), fact);
    }
}
pub fn notes(schema: &Schema, programs: &[BoundProgram]) -> Vec<Diagnostic> {
    programs.iter().filter_map(|bound| {
        let fact = &schema.operations[&bound.program.name];
        (!fact.ephemeral_reads.is_empty() && fact.sites.iter().filter(|s| s.class == SiteClass::Server).all(|s| schema.table(&s.table).is_some_and(|t| t.ephemeral.is_some())))
            .then(|| Diagnostic::new(&bound.site, "N_EPHEMERAL_SERVER", format!("{} runs on the server because it reads an ephemeral table", bound.program.name), "split the ephemeral read into its own query and render it next to the device-held one").guide("ephemeral"))
    }).collect()
}
