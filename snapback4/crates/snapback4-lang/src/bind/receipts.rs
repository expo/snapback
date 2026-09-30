//! Named receipt families compiled to ordinary metered IR.
// @ref LLP 3000.022#14 — allocation stays explicit in the prototype.
use super::{catalog::Catalog, operation_name};
use crate::{ast::*, diag::Diagnostic};
use snapback4_core::schema::{ReceiptFamily, Schema};

fn refuse(site: &crate::diag::Site, message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site, "E_RECEIPTS_CLAUSE", message,
        "name a receipt family and map counter, floor and count; use group-readable synced members and distinct generated names").guide("receipts")
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
    let mut names = std::collections::BTreeSet::new();
    for (doc_index, table, clause) in declarations {
        if !names.insert(clause.name.clone()) {
            errors.push(refuse(&clause.site, "duplicate receipt family name"));
            continue;
        }
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
            || !required(&table, &clause.count, TypeKind::Int)
            || !required(
                members,
                &clause.member_group,
                TypeKind::Ref {
                    table: scope.clone(),
                },
            )
            || !required(members, &clause.principal, TypeKind::Principal)
            || !required(members, &clause.floor, TypeKind::Int)
            || !tables
                .iter()
                .any(|t| t.name == *scope && required(t, &clause.counter, TypeKind::Int))
            || ![
                clause.member_group.as_str(),
                clause.principal.as_str(),
                clause.floor.as_str(),
            ]
            .iter()
            .all(|c| immutable(members, c))
            || ![
                clause.group.as_str(),
                clause.position.as_str(),
                clause.sender.as_str(),
                clause.count.as_str(),
            ]
            .iter()
            .all(|c| immutable(&table, c))
            || !members
                .caps
                .iter()
                .any(|c| c.by == [clause.member_group.clone()] && c.max <= 50)
            || members.expire.is_some()
            || members.ephemeral.is_some()
            || table.ephemeral.is_some()
        {
            errors.push(refuse(&clause.site, "receipt coordinates need immutable identity, explicit allocation/snapshot fields, a durable non-expiring audience capped at 50, and durable messages"));
            continue;
        }
        let mut owned = clause.operations.clone();
        owned.push(clause.runs.clone());
        owned.push(format!("{}Fold", clause.name));
        if owned
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != owned.len()
            || clause.delivered_field == clause.seen_field
        {
            errors.push(refuse(
                &clause.site,
                "receipt-generated names must be distinct",
            ));
            continue;
        }
        if documents.iter().any(|d| {
            d.tables
                .iter()
                .map(|t| &t.name)
                .chain(d.functions.iter().map(|t| &t.name))
                .chain(d.programs.iter().map(|t| &t.name))
                .chain(d.views.iter().map(|t| &t.name))
                .any(|n| owned.contains(n))
        }) || members
            .columns
            .iter()
            .any(|c| [&clause.delivered_field, &clause.seen_field].contains(&&c.name))
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
            .replace("@SENDER@", &clause.sender)
            .replace("@MEMBER_GROUP@", &clause.member_group)
            .replace("@PRINCIPAL@", &clause.principal)
            .replace("@COUNTER@", &clause.counter)
            .replace("@FLOOR@", &clause.floor)
            .replace("@COUNT@", &clause.count)
            .replace("@DELIVERED_FIELD@", &clause.delivered_field)
            .replace("@SEEN_FIELD@", &clause.seen_field)
            .replace("@RUNS@", &clause.runs)
            .replace("@FOLD@", &format!("{}Fold", clause.name))
            .replace("@RECEIPT@", &clause.operations[0])
            .replace("@DELIVERED@", &clause.operations[1])
            .replace("@SEEN@", &clause.operations[2])
            .replace("@MEMBER@", &clause.operations[3])
            .replace("@PROGRESS@", &clause.operations[4])
            .replace("@COMPACT@", &clause.operations[5]);
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
                    for name in [clause.delivered_field.as_str(), clause.seen_field.as_str()] {
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
            // Prove that a group member can read every membership, and that
            // acquisition contains the entire group (no self-only/horizon lane).
            use snapback4_core::schema::{Audience, RuleExpr, RuleTerm};
            let members = &schema.tables[&clause.members];
            let member_key = members.indexes.iter().find(|(_, i)| {
                i.unique && i.columns() == [clause.member_group.as_str(), clause.principal.as_str()]
            });
            fn allows(rule: &RuleExpr, table: &str, index: &str, group: &str) -> bool {
                match rule {
                    RuleExpr::Allow | RuleExpr::Public { .. } => true,
                    RuleExpr::Or(rules) => rules.iter().any(|r| allows(r, table, index, group)),
                    RuleExpr::Exists {
                        table: t,
                        index: i,
                        key,
                        equalities,
                        ..
                    } => {
                        t == table
                            && i == index
                            && equalities.is_empty()
                            && *key == [RuleTerm::Field(group.into()), RuleTerm::Viewer]
                    }
                    _ => false,
                }
            }
            let synced = members.sync.as_ref().is_some_and(|s| {
                s.horizon.is_none()
                    && s.audience
                        == Audience::Target {
                            table: clause.members.clone(),
                            prefix: vec![clause.member_group.clone()],
                            principal: clause.principal.clone(),
                        }
            });
            if !synced
                || !member_key.is_some_and(|(i, _)| {
                    allows(
                        &members.rules.read,
                        &clause.members,
                        i,
                        &clause.member_group,
                    ) && allows(
                        &schema.tables[&table.name].rules.read,
                        &clause.members,
                        i,
                        &clause.group,
                    )
                })
            {
                errors.push(refuse(&clause.site,"receipt membership must be group-readable and synced in full to that group; messages must be group-readable"));
                continue;
            }
            let family = ReceiptFamily {
                name: clause.name.clone(),
                members: clause.members.clone(),
                group: clause.member_group.clone(),
                principal: clause.principal.clone(),
                runs: clause.runs.clone(),
                run_group: clause.group.clone(),
                delivered_field: clause.delivered_field.clone(),
                seen_field: clause.seen_field.clone(),
                delivered: operation_name(&module, &clause.operations[1]),
                seen: operation_name(&module, &clause.operations[2]),
                compact: operation_name(&module, &clause.operations[5]),
            };
            let binding = schema
                .delivery
                .iter_mut()
                .find(|b| b.mutation == family.delivered)
                .unwrap();
            binding.compact = Some(family.compact.clone());
            // All semantic coordinates plus the template version fence SDK debt.
            binding.semantics = Some(format!(
                "receipts.v2:{}:{}:{}:{}:{}:{}",
                serde_json::to_string(&family).unwrap(),
                clause.counter,
                clause.floor,
                clause.count,
                clause.sender,
                include_str!("receipts.q")
            ));
            binding.semantics = Some(format!("receipts.v2:{}", binding.compute_fingerprint()));
            binding.fingerprint = binding.compute_fingerprint();
            schema.receipts.push(family);
        }
    }
}
