//! Expand inherited rules before index planning and aggregate derivation.
// @ref LLP 3000.014#2-the-form — whole-rule substitution preserves every conjunct and service grant.
use super::catalog::TableInfo;
use crate::{ast::*, diag::Diagnostic};
use snapback4_core::schema::through::{CHILDREN, DEADLINE, PARENT_DEADLINE, Through};
use std::collections::{BTreeMap, BTreeSet};
mod paths;

pub(super) fn sync_repair(catalog: &super::catalog::Catalog, info: &TableInfo) -> Option<String> {
    // Keep the authored horizon, before planning adds captured audience columns.
    let decl = catalog.documents.iter().flat_map(|doc| &doc.tables)
        .find(|decl| decl.name == info.decl.name).unwrap_or(&info.decl);
    info.through.as_ref().map(|through| paths::repair(decl, &through.reference))
}

fn reference(info: &TableInfo) -> Option<String> {
    info.decl.rules.iter().find_map(|rule| match &rule.value {
        Expr::Call { name, args, .. } if name == "$readThrough" => match args.as_slice() {
            [Expr::Name { name, .. }] => Some(name.clone()),
            _ => None,
        },
        _ => None,
    }).or_else(|| paths::reference(info))
}

pub(super) fn expand(tables: &mut BTreeMap<String, TableInfo>, diagnostics: &mut Vec<Diagnostic>) {
    let names: Vec<_> = tables.keys().cloned().collect();
    let mut done = BTreeSet::new();
    for name in names {
        if let Err(d) = one(&name, tables, &mut done, &mut BTreeSet::new()) {
            diagnostics.push(d);
        }
    }
}

fn one(
    name: &str,
    tables: &mut BTreeMap<String, TableInfo>,
    done: &mut BTreeSet<String>,
    visiting: &mut BTreeSet<String>,
) -> Result<(), Diagnostic> {
    if done.contains(name) {
        return Ok(());
    }
    let Some(reference) = reference(&tables[name]) else {
        done.insert(name.into());
        return Ok(());
    };
    let info = tables[name].clone();
    let site = info
        .decl
        .rules
        .iter()
        .find(|r| r.effect == Effect::Read)
        .map(|r| &r.site)
        .unwrap_or(&info.decl.site);
    let fail = |message: String, rewrite: String| {
        Diagnostic::new(site, "E_READ_THROUGH", message, rewrite).guide("rules")
    };
    if info.decl.sync.is_some()
        && info.decl.retain.as_ref().is_some_and(|(policy, _)| policy == "delivered-history")
        && info.columns.contains_key("retained")
    {
        return Err(fail(format!("{name}.retained conflicts with delivered-history row metadata"),
            "rename the application column to wasRetained; retained marks delivered history on read-through rows".into()));
    }
    if !visiting.insert(name.into()) {
        return Err(fail(
            format!("read through cycle at {name}"),
            "break this cycle with an ordinary read <- rule".into(),
        ));
    }
    if info.decl.public.is_some()
        || info
            .decl
            .rules
            .iter()
            .filter(|r| r.effect == Effect::Read)
            .count()
            != 1
    {
        return Err(fail(
            format!("{name}: read through must be the only read rule"),
            format!("keep only `read through .{reference}`; put service grants on the parent"),
        ));
    }
    let parent = match info.columns.get(&reference) {
        Some(ScalarType {
            kind: TypeKind::Ref { table },
            optional: false,
        }) if tables.contains_key(table) => table.clone(),
        _ => {
            return Err(fail(
                format!(
                    "{name}.{reference} must be a required reference to an ordinary application table"
                ),
                format!("{reference}: {}\nimmutable {reference}\nread through .{reference}", match info.columns.get(&reference) { Some(ScalarType { kind: TypeKind::Ref { table }, .. }) => table.as_str(), _ => "parents" }),
            ));
        }
    };
    if info
        .decl
        .columns
        .iter()
        .any(|c| c.name == reference && c.default.is_some())
    {
        return Err(fail(
            format!("{name}.{reference} cannot have a default"),
            format!("{reference}: {parent}  -- supply the parent on each insert"),
        ));
    }
    if !info
        .decl
        .immutable
        .iter()
        .any(|(fields, _)| fields.contains(&reference))
    {
        return Err(fail(
            format!("{name}.{reference} must be immutable"),
            format!("immutable {reference}"),
        ));
    }
    one(&parent, tables, done, visiting)?;
    let parent_info = &tables[&parent];
    let parent_read = parent_info
        .decl
        .rules
        .iter()
        .find(|r| r.effect == Effect::Read)
        .cloned()
        .unwrap_or_else(|| RuleDecl {
            effect: Effect::Read,
            bindings: vec![],
            value: Expr::Name {
                name: if parent_info.decl.public.is_some() {
                    "allow"
                } else {
                    "deny"
                }
                .into(),
                site: site.clone(),
            },
            site: site.clone(),
        });
    let mut value = parent_read.value.clone();
    let mut fields = BTreeMap::new();
    let mut captures = BTreeMap::new();
    let mut errors = Vec::new();
    super::intent_walk::expression(&mut value, &mut |expr| {
        if let Expr::Member {
            base, name: field, ..
        } = expr
            && matches!(base.as_ref(), Expr::Focal { .. })
        {
            let immutable = field == "id"
                || parent_info.captures.contains_key(field)
                || parent_info
                    .decl
                    .immutable
                    .iter()
                    .any(|(fs, _)| fs.contains(field));
            if !immutable {
                errors.push(fail(
                    format!("{parent}.{field} is captured by {name} and must be immutable"),
                    format!("immutable {field}  -- on table {parent}"),
                ));
            }
            let ty = if field == "id" {
                Some(ScalarType {
                    kind: TypeKind::Ref {
                        table: parent.clone(),
                    },
                    optional: false,
                })
            } else {
                parent_info
                    .columns
                    .get(field)
                    .or_else(|| parent_info.captures.get(field))
                    .cloned()
            };
            if let Some(ty) = ty {
                let hidden = format!("${reference}.{field}");
                fields.insert(hidden.clone(), field.clone());
                captures.insert(hidden.clone(), ty);
                *field = hidden;
            }
        }
    });
    if let Some((field, _)) = &parent_info.decl.expire
        && !parent_info
            .decl
            .immutable
            .iter()
            .any(|(fs, _)| fs.contains(field))
    {
        errors.push(fail(
            format!("{parent}.{field} is a captured deadline and must be immutable"),
            format!("immutable {field}  -- on table {parent}"),
        ));
    }
    if let Some(error) = errors.into_iter().next() {
        return Err(error);
    }
    paths::check_rule(&info, &reference, &value)?;
    let expiring = info.decl.expire.is_some()
        || parent_info.decl.expire.is_some()
        || parent_info.through.as_ref().is_some_and(|t| t.expiring);
    let identity = snapback4_core::value::digest(&format!(
        "{:?}",
        (
            &parent_read,
            &parent_info.columns,
            &parent_info.decl.expire,
            &parent_info.through,
            &info.columns[&reference]
        )
    ));
    let info = tables.get_mut(name).unwrap();
    paths::sync(&mut info.decl, &reference, &captures)?;
    info.through = Some(Through {
        reference: reference.clone(),
        parent,
        fields,
        identity,
        expiring,
    });
    for field in [PARENT_DEADLINE, DEADLINE] {
        captures.insert(
            field.into(),
            ScalarType {
                kind: TypeKind::Time,
                optional: true,
            },
        );
    }
    info.captures = captures;
    info.decl.rules.iter_mut().find(|r| r.effect == Effect::Read).unwrap().value = value;
    let mut add_index = |name: &str, columns: Vec<String>| {
        info.indexes.push(IndexDecl {
            name: name.into(),
            columns,
            unique: false,
            refusal: None,
            words: None,
            computed: BTreeMap::new(),
            site: site.clone(),
        })
    };
    add_index(CHILDREN, vec![reference, DEADLINE.into(), "id".into()]);
    if expiring {
        add_index("$expiry", vec![DEADLINE.into(), "id".into()]);
    }
    visiting.remove(name);
    done.insert(name.into());
    Ok(())
}
