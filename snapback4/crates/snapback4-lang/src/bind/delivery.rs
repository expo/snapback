//! Delivery is an author promise; the binder verifies its coordinates and signature.
// @ref LLP 3000.019#4 — P7 delegates reporting to the SDK.
// @ref LLP 3000.022#2.1 — success is coverage, with one immutable position identity.
use super::{catalog::Catalog, operation_name};
use crate::{
    ast::{ProgramKind, TypeKind},
    diag::Diagnostic,
};
use snapback4_core::schema::{ColumnType, Constraint, DeliveryBinding, Schema};
use std::collections::BTreeSet;

pub(super) fn bind(catalog: &Catalog, schema: &mut Schema, diagnostics: &mut Vec<Diagnostic>) {
    let mut tables = BTreeSet::new();
    for doc in &catalog.documents {
        let module = std::path::Path::new(&doc.file)
            .file_stem()
            .unwrap()
            .to_string_lossy();
        for decl in &doc.programs {
            let Some(clause) = &decl.delivery else {
                continue;
            };
            let mut refuse = |message: String, rewrite: String| {
                diagnostics.push(
                    Diagnostic::new(&clause.site, "E_DELIVERY_CLAUSE", message, rewrite)
                        .guide("receipts"),
                )
            };
            if decl.kind != ProgramKind::Mutation {
                refuse(
                    "only a mutation can report delivery".into(),
                    format!(
                        "mutation {}(group: conversations, from: int, through: int) reports delivery of {} by .{}, .{}:",
                        decl.name, clause.table, clause.group, clause.position
                    ),
                );
                continue;
            }
            let Some(table) = schema.tables.get(&clause.table) else {
                refuse(
                    format!("unknown tracked table {}", clause.table),
                    format!(
                        "replace {} with a declared table: {}",
                        clause.table,
                        schema.tables.keys().cloned().collect::<Vec<_>>().join(", ")
                    ),
                );
                continue;
            };
            if !tables.insert(clause.table.clone()) {
                refuse(
                    format!("{} already has a delivery reporter", clause.table),
                    format!(
                        "keep one reports delivery of {} clause; remove this duplicate clause",
                        clause.table
                    ),
                );
                continue;
            }
            let Some(ColumnType::Ref { table: group_table }) = table.columns.get(&clause.group)
            else {
                refuse(
                    format!(
                        "{}.{} must be a required reference column",
                        clause.table, clause.group
                    ),
                    format!(
                        "declare {}: conversations on {}; name it in by .{}, .{}",
                        clause.group, clause.table, clause.group, clause.position
                    ),
                );
                continue;
            };
            if table.columns.get(&clause.position) != Some(&ColumnType::Int) {
                refuse(
                    format!(
                        "{}.{} must be a required int column",
                        clause.table, clause.position
                    ),
                    format!("declare {}: int on {}", clause.position, clause.table),
                );
                continue;
            }
            let correct_args = decl.args.len() == 3
                && decl.args.iter().all(|a| !a.type_.optional)
                && decl.args[0].type_.kind
                    == (TypeKind::Ref {
                        table: group_table.clone(),
                    })
                && decl.args[1..].iter().all(|a| a.type_.kind == TypeKind::Int);
            if !correct_args {
                refuse(
                    format!(
                        "{} requires exactly a {} reference, then the first and last int positions",
                        decl.name, group_table
                    ),
                    format!(
                        "mutation {}(group: {}, from: int, through: int) reports delivery of {} by .{}, .{}:",
                        decl.name, group_table, clause.table, clause.group, clause.position
                    ),
                );
                continue;
            }
            let immutable = |column: &String| {
                table.constraints.iter().any(
                    |c| matches!(c, Constraint::Immutable { fields } if fields.contains(column)),
                )
            };
            if !immutable(&clause.group) || !immutable(&clause.position) {
                refuse(
                    format!(
                        "{}.{} and .{} must both be immutable",
                        clause.table, clause.group, clause.position
                    ),
                    format!(
                        "add immutable {}, {} to table {}",
                        clause.group, clause.position, clause.table
                    ),
                );
                continue;
            }
            if !table.indexes.values().any(|index| {
                index.unique
                    && index.components.len() == 2
                    && index.components[0].column() == Some(&clause.group)
                    && index.components[1].column() == Some(&clause.position)
            }) {
                refuse(
                    format!("{} needs a unique (group, position) key", clause.table),
                    format!(
                        "add unique {}, {} to table {}",
                        clause.group, clause.position, clause.table
                    ),
                );
                continue;
            }
            schema.delivery.push(DeliveryBinding {
                table: clause.table.clone(),
                group: clause.group.clone(),
                position: clause.position.clone(),
                mutation: operation_name(&module, &decl.name),
                args: decl.args.iter().map(|arg| arg.name.clone()).collect(),
            });
        }
    }
}

// Ephemeral mutations deliberately bypass receipts, so they cannot promise replay.
pub(super) fn durability(catalog: &Catalog, schema: &Schema, diagnostics: &mut Vec<Diagnostic>) {
    for doc in &catalog.documents {
        let module = std::path::Path::new(&doc.file)
            .file_stem()
            .unwrap()
            .to_string_lossy();
        for decl in &doc.programs {
            if let Some(clause) = &decl.delivery
                && schema
                    .operations
                    .get(&operation_name(&module, &decl.name))
                    .is_some_and(|fact| fact.ephemeral)
            {
                diagnostics.push(Diagnostic::new(&clause.site, "E_DELIVERY_CLAUSE",
                    "an ephemeral mutation cannot keep a durable delivery receipt or replay its write id",
                    "record delivered coverage in durable tables; keep ephemeral writes in a separate mutation").guide("receipts"));
            }
        }
    }
}
