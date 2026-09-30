//! Named receipt families compiled to ordinary metered IR.
// @ref LLP 3000.022#14 — allocation stays explicit in the prototype.
use super::{catalog::Catalog, operation_name};
use crate::{ast::*, diag::Diagnostic};
use snapback4_core::schema::{ReceiptFamily, Schema};

fn refuse(site: &crate::diag::Site, message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site, "E_RECEIPTS_CLAUSE", message,
        "name a receipt family and map counter, floor and count; use group-readable synced members and distinct generated names").guide("receipts")
}

// Preserve existing storage names except when the scope would duplicate a run column.
fn run_group(group: &str) -> &str {
    if matches!(group, "principal" | "fromOrdinal" | "throughOrdinal") {
        "receiptScope"
    } else {
        group
    }
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
            errors.push(refuse(
                &clause.site,
                format!("duplicate receipt family `{}`", clause.name),
            ));
            continue;
        }
        let Some(group) = table.columns.iter().find(|c| c.name == clause.group) else {
            errors.push(refuse(
                &clause.site,
                format!(
                    "receipt scope field `{}` is missing; name a reference column",
                    clause.group
                ),
            ));
            continue;
        };
        let TypeKind::Ref { table: scope } = &group.type_.kind else {
            errors.push(refuse(
                &clause.site,
                format!(
                    "receipt scope field `{}` must be a required table reference, got {}",
                    clause.group,
                    format!("{:?}", group.type_.kind).to_lowercase()
                ),
            ));
            continue;
        };
        if let Some((role, name)) = [
            ("scope table", scope.as_str()),
            ("message table", table.name.as_str()),
            ("member table", clause.members.as_str()),
        ]
        .into_iter()
        .find(|(_, name)| super::generated::expression_keyword(name) || *name == "principal")
        {
            errors.push(refuse(
                &clause.site,
                format!(
                    "receipt {role} mapping `{name}` is reserved expression or scalar-type syntax"
                ),
            ));
            continue;
        }
        if let Some((i, name)) = clause
            .operations
            .iter()
            .enumerate()
            .find(|(_, name)| name.contains('-'))
        {
            errors.push(refuse(
                &clause.site,
                format!(
                    "receipt operation {} mapping `{name}` cannot contain a hyphen",
                    i + 1
                ),
            ));
            continue;
        }
        let tables: Vec<_> = documents.iter().flat_map(|d| &d.tables).collect();
        let Some(members) = tables.iter().find(|t| t.name == clause.members) else {
            errors.push(refuse(
                &clause.site,
                format!("receipt audience table `{}` is missing", clause.members),
            ));
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
            errors.push(refuse(&clause.site, format!("receipt mappings {} need immutable identity, required coordinate types, explicit allocation/snapshot fields, a durable non-expiring audience capped at 50, and durable messages", mapping_names(&table, &clause))));
            continue;
        }
        if let Some((role, name)) = [
            ("runs", clause.runs.as_str()),
            ("projection", clause.operations[0].as_str()),
        ]
        .into_iter()
        .find(|(_, name)| super::generated::expression_keyword(name))
        {
            errors.push(refuse(
                &clause.site,
                format!("receipt {role} mapping `{name}` is reserved expression syntax"),
            ));
            continue;
        }
        let mut owned = clause.operations.clone();
        owned.push(clause.runs.clone());
        owned.push(format!("$receipt:{}:fold", clause.name));
        if owned
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != owned.len()
            || clause.delivered_field == clause.seen_field
            || clause.delivered_field == "id"
            || clause.seen_field == "id"
        {
            errors.push(refuse(
                &clause.site,
                format!(
                    "receipt names must be distinct; watermarks `{}` and `{}` cannot be id",
                    clause.delivered_field, clause.seen_field
                ),
            ));
            continue;
        }
        let collision = documents
            .iter()
            .flat_map(|d| {
                d.tables
                    .iter()
                    .map(|t| &t.name)
                    .chain(d.functions.iter().map(|t| &t.name))
                    .chain(d.programs.iter().map(|t| &t.name))
                    .chain(d.views.iter().map(|t| &t.name))
            })
            .find(|n| owned.contains(n))
            .or_else(|| {
                members
                    .columns
                    .iter()
                    .map(|c| &c.name)
                    .find(|n| [&clause.delivered_field, &clause.seen_field].contains(n))
            });
        if let Some(name) = collision {
            errors.push(refuse(
                &clause.site,
                format!(
                    "receipt mapping `{name}` collides with an authored declaration or member field"
                ),
            ));
            continue;
        }
        // Reserve authored/global identifiers before allocating template locals.
        // Public scope/range/cursor names keep their usual spelling when possible.
        let mut used: std::collections::BTreeSet<String> = documents
            .iter()
            .flat_map(|d| {
                d.tables
                    .iter()
                    .map(|t| t.name.clone())
                    .chain(d.functions.iter().map(|f| f.name.clone()))
                    .chain(d.programs.iter().map(|p| p.name.clone()))
                    .chain(d.views.iter().map(|v| v.name.clone()))
            })
            .chain(owned.iter().cloned())
            .collect();
        let mut fresh = |base: &str| {
            let mut name = base.to_owned();
            let mut suffix = 0;
            while !used.insert(name.clone()) {
                suffix += 1;
                name = format!("{base}{suffix}");
            }
            name
        };
        // These words have expression syntax instead of variable meaning.
        let scope_arg = fresh(
            if super::generated::expression_keyword(&clause.group)
                || matches!(clause.group.as_str(), "first" | "last")
            {
                "receiptScope"
            } else {
                &clause.group
            },
        );
        let from_arg = fresh("from");
        let through_arg = fresh("through");
        let cursor_arg = fresh("c");
        let mut template = include_str!("receipts.q").to_owned();
        let mut locals = std::collections::BTreeMap::new();
        while let Some(start) = template.find('$') {
            let length = template[start + 1..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .count();
            let key = template[start + 1..start + 1 + length].to_owned();
            let name = locals
                .entry(key.clone())
                .or_insert_with(|| fresh(&format!("__receipt_{key}")));
            template.replace_range(start..start + 1 + length, name);
        }
        let source = template
            .replace("@ARG@", &scope_arg)
            .replace("@FROM@", &from_arg)
            .replace("@THROUGH@", &through_arg)
            .replace("@CURSOR@", &cursor_arg)
            .replace("@SCOPE@", scope)
            .replace("@GROUP@", &clause.group)
            .replace("@RUN_GROUP@", run_group(&clause.group))
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
            .replace("@FOLD@", "receiptPrivateFold")
            .replace("@RECEIPT@", &clause.operations[0])
            .replace("@DELIVERED@", &clause.operations[1])
            .replace("@SEEN@", &clause.operations[2])
            .replace("@MEMBER@", &clause.operations[3])
            .replace("@PROGRESS@", &clause.operations[4])
            .replace("@COMPACT@", &clause.operations[5]);
        let (mut generated, diagnostics) =
            crate::parse_document(&documents[doc_index].file, &source);
        if !diagnostics.is_empty() {
            errors.push(refuse(
                &clause.site,
                format!(
                    "receipt mappings {} cannot be expressed in Quarry: {}",
                    mapping_names(&table, &clause),
                    public_reason(&diagnostics[0].message)
                ),
            ));
            continue;
        }
        // @ref LLP 3000.022#14.1 — generated calls and sites have compiler custody.
        super::generated::receipts(&mut generated, &clause);
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
                run_group: run_group(&clause.group).into(),
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
                "receipts.v2:{}:{}:{}:{}:{}:{}:{}",
                serde_json::to_string(&family).unwrap(),
                clause.counter,
                clause.floor,
                clause.count,
                clause.sender,
                serde_json::to_string(
                    &clause
                        .operations
                        .iter()
                        .map(|name| operation_name(&module, name))
                        .collect::<Vec<_>>()
                )
                .unwrap(),
                include_str!("receipts.q")
            ));
            binding.semantics = Some(format!("receipts.v2:{}", binding.compute_fingerprint()));
            binding.fingerprint = binding.compute_fingerprint();
            schema.receipts.push(family);
        }
    }
}

// A later planner/type/admission refusal still belongs to the author declaration.
// Never suggest pasting a generated local or a compiler-only call into an app.
pub(super) fn diagnostics(documents: &[Document], errors: &mut [Diagnostic]) {
    for diagnostic in errors {
        for table in documents.iter().flat_map(|d| &d.tables) {
            if let Some(clause) = &table.receipts
                && diagnostic.site == clause.site
                && diagnostic.code != "E_RECEIPTS_CLAUSE"
            {
                *diagnostic = refuse(
                    &clause.site,
                    format!(
                        "receipt mappings {}: {}",
                        mapping_names(table, clause),
                        public_reason(&diagnostic.message)
                    ),
                );
                break;
            }
        }
    }
}
fn mapping_names(table: &TableDecl, clause: &ReceiptsDecl) -> String {
    format!(
        "{}.{}, .{}, .{}, count .{}; members {}.{}, .{}, floor .{}; counter .{}; watermarks .{}, .{}; runs {}; operations {}",
        table.name,
        clause.group,
        clause.position,
        clause.sender,
        clause.count,
        clause.members,
        clause.member_group,
        clause.principal,
        clause.floor,
        clause.counter,
        clause.delivered_field,
        clause.seen_field,
        clause.runs,
        clause.operations.join(", ")
    )
}
fn public_reason(reason: &str) -> String {
    reason
        .split_inclusive(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '$' && c != ':')
        .map(|word| {
            if word.starts_with("__receipt_")
                || word.starts_with("$receipt:")
                || word.starts_with("$builtin:")
                || word.starts_with("$input:")
            {
                format!(
                    "receipt expression{}",
                    word.chars()
                        .last()
                        .filter(|c| !c.is_ascii_alphanumeric())
                        .map(|c| c.to_string())
                        .unwrap_or_default()
                )
            } else {
                word.into()
            }
        })
        .collect()
}
