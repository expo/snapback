//! Round-zero declarative recipe: one receipt family, ordinary metered IR.
// @ref LLP 3000.022#14 — allocation stays explicit in the prototype.
use super::{catalog::Catalog, operation_name};
use crate::{ast::*, diag::Diagnostic};
use snapback4_core::schema::{ReceiptFamily, Schema};

fn refuse(site: &crate::diag::Site, message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site, "E_RECEIPTS_CLAUSE", message,
        "use one receipts by .conversation, .ordinal from .sender to members clause; keep lastOrdinal, joinedOrdinal and recipients explicit; omit deliveredOrdinal, seenOrdinal, runs, receipt, delivered, seen, receiptMember and progress").guide("receipts")
}

pub fn expand(documents: &mut Vec<Document>, errors: &mut Vec<Diagnostic>) {
    let declarations: Vec<_> = documents
        .iter()
        .enumerate()
        .flat_map(|(i, d)| {
            d.tables
                .iter()
                .filter_map(move |t| t.receipts.clone().map(|r| (i, t.clone(), r)))
        })
        .collect();
    if declarations.len() > 1 {
        errors.push(refuse(
            &declarations[1].2.site,
            "round-zero receipts supports one family per schema",
        ));
        return;
    }
    for (doc_index, table, clause) in declarations {
        let Some(group) = table.columns.iter().find(|c| c.name == clause.group) else {
            errors.push(refuse(
                &clause.site,
                "receipt scope must name a reference column",
            ));
            continue;
        };
        let TypeKind::Ref { table: scope } = &group.type_.kind else {
            errors.push(refuse(
                &clause.site,
                "receipt scope must be a required reference",
            ));
            continue;
        };
        let tables: Vec<_> = documents.iter().flat_map(|d| &d.tables).collect();
        let Some(members) = tables.iter().find(|t| t.name == clause.members) else {
            errors.push(refuse(&clause.site, "receipt audience table is missing"));
            continue;
        };
        let required = |t: &TableDecl, name: &str, kind: TypeKind| {
            t.columns
                .iter()
                .any(|c| c.name == name && c.type_.kind == kind && !c.type_.optional)
        };
        let immutable = |t: &TableDecl, name: &str| {
            t.immutable
                .iter()
                .any(|(cols, _)| cols.iter().any(|c| c == name))
        };
        if group.type_.optional
            || !required(&table, &clause.position, TypeKind::Int)
            || !required(&table, &clause.sender, TypeKind::Principal)
            || !required(&table, "recipients", TypeKind::Int)
            || !required(
                members,
                &clause.group,
                TypeKind::Ref {
                    table: scope.clone(),
                },
            )
            || !required(members, "principal", TypeKind::Principal)
            || !required(members, "joinedOrdinal", TypeKind::Int)
            || !tables
                .iter()
                .any(|t| t.name == *scope && required(t, "lastOrdinal", TypeKind::Int))
            || ![clause.group.as_str(), "principal", "joinedOrdinal"]
                .iter()
                .all(|c| immutable(members, c))
            || ![
                clause.group.as_str(),
                clause.position.as_str(),
                clause.sender.as_str(),
                "recipients",
            ]
            .iter()
            .all(|c| immutable(&table, c))
            || !members
                .caps
                .iter()
                .any(|c| c.by == [clause.group.clone()] && c.max <= 50)
            || members.expire.is_some()
            || members.ephemeral.is_some()
            || table.ephemeral.is_some()
        {
            errors.push(refuse(&clause.site, "receipt coordinates need immutable identity, explicit allocation/snapshot fields, a durable non-expiring audience capped at 50, and durable messages"));
            continue;
        }
        let owned = [
            "runs",
            "receipt",
            "delivered",
            "seen",
            "receiptMember",
            "progress",
        ];
        if documents.iter().any(|d| {
            d.tables
                .iter()
                .map(|t| &t.name)
                .chain(d.functions.iter().map(|t| &t.name))
                .chain(d.programs.iter().map(|t| &t.name))
                .chain(d.views.iter().map(|t| &t.name))
                .any(|n| owned.contains(&n.as_str()))
        }) || members
            .columns
            .iter()
            .any(|c| ["deliveredOrdinal", "seenOrdinal"].contains(&c.name.as_str()))
        {
            errors.push(refuse(
                &clause.site,
                "receipt-generated name collides with an authored declaration",
            ));
            continue;
        }
        let source = include_str!("receipts.q")
            .replace("@SCOPE@", scope)
            .replace("@GROUP@", &clause.group)
            .replace("@MESSAGES@", &table.name)
            .replace("@MEMBERS@", &clause.members)
            .replace("@POSITION@", &clause.position)
            .replace("@SENDER@", &clause.sender);
        let (mut generated, diagnostics) =
            crate::parse_document(&documents[doc_index].file, &source);
        errors.extend(diagnostics);
        // Generated sites point back to the declaration instead of invented source lines.
        for p in &mut generated.programs {
            p.site = clause.site.clone();
        }
        for d in documents.iter_mut() {
            for t in &mut d.tables {
                if t.name == clause.members {
                    for name in ["deliveredOrdinal", "seenOrdinal"] {
                        t.columns.push(ColumnDecl {
                            name: name.into(),
                            type_: ScalarType {
                                kind: TypeKind::Int,
                                optional: false,
                            },
                            default: Some(Expr::Literal {
                                value: Literal::Number("0".into()),
                                site: clause.site.clone(),
                            }),
                            sequence: None,
                            written_by: None,
                            readable_by_audience: false,
                            maintained: None,
                            site: clause.site.clone(),
                        });
                    }
                }
            }
        }
        let d = &mut documents[doc_index];
        d.tables.extend(generated.tables);
        d.functions.extend(generated.functions);
        d.programs.extend(generated.programs);
    }
}

pub fn bind(catalog: &Catalog, schema: &mut Schema, errors: &mut Vec<Diagnostic>) {
    for doc in &catalog.documents {
        for table in &doc.tables {
            let Some(clause) = &table.receipts else {
                continue;
            };
            if !errors.is_empty() {
                continue;
            }
            let module = std::path::Path::new(&doc.file)
                .file_stem()
                .unwrap()
                .to_string_lossy();
            schema.receipts.push(ReceiptFamily {
                members: clause.members.clone(),
                group: clause.group.clone(),
                delivered: operation_name(&module, "delivered"),
                seen: operation_name(&module, "seen"),
            });
        }
    }
}
