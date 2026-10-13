//! Expand inherited rules before index planning and aggregate derivation.
// @ref LLP 3000.014#2-the-form — whole-rule substitution preserves every conjunct and service grant.
use super::catalog::TableInfo;
use crate::{ast::*, diag::Diagnostic};
use snapback4_core::schema::through::{CHILDREN, DEADLINE, PARENT_DEADLINE, Through};
use std::collections::{BTreeMap, BTreeSet};
mod paths;
mod hops;

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
    hops::lower(tables);
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
    // @ref LLP 3000.036#13.5 — a hop in a read rule that is not the parent's
    // whole rule (owner-or-organizer, lanes 033 036 060 067) is not a
    // membership path: `read through` would widen it to the parent's audience.
    // Leave it to E_QUARRY_RULE_HOP, whose rewrite probes the deciding row.
    if !paths::declares_membership(&tables[name], &reference, tables) {
        done.insert(name.into());
        return Ok(());
    }
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
                // @ref LLP 3000.036#15.6 — lane 082: a reassignable audience column cannot be
                // captured; an online-only child can probe the live parent row instead.
                let probes = (info.decl.sync.is_none()).then(|| parent_probes(&parent_read.value, &parent, &reference)).flatten()
                    .map(|rule| format!("; or, when {field} must change (an online-only table reads it live), replace `read through .{reference}` with `read <- {rule}`"))
                    .unwrap_or_default();
                errors.push(fail(
                    format!("{parent}.{field} is captured by {name} and must be immutable. `read through` freezes this audience input when the child is inserted. If it must remain mutable, choose the intended history: copy it into a required immutable audience column on {name}, check `.copy = .{reference}.{field}` in {name}'s insert rule, and use an ordinary read rule over the copy to retain creation-time authority; or keep {name} online only and probe the live parent so existing children follow later changes"),
                    format!("immutable {field}  -- on table {parent}{probes}"),
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

/// The parent's read rule as probes of the parent row through `reference`:
/// `.caller = viewer or .assignedTo = viewer` becomes `exists reports[.report,
/// caller = viewer] or exists reports[.report, assignedTo = viewer]`, the
/// one-hop form an online-only table accepts on a mutable column. Disjuncts
/// that read no row column are kept; any other shape has no such rewrite.
fn parent_probes(rule: &Expr, parent: &str, reference: &str) -> Option<String> {
    fn disjuncts<'a>(value: &'a Expr, out: &mut Vec<&'a Expr>) {
        match value { Expr::Binary { op, left, right, .. } if op == "or" => { disjuncts(left, out); disjuncts(right, out); } other => out.push(other) }
    }
    fn focal(value: &Expr) -> bool {
        match value {
            Expr::Focal { .. } => true,
            Expr::Member { base, .. } | Expr::Unary { value: base, .. } => focal(base),
            Expr::Binary { left, right, .. } => focal(left) || focal(right),
            Expr::Exists { read, .. } => read.keys.iter().any(|key| focal(&key.value)),
            _ => false,
        }
    }
    let mut parts = Vec::new();
    disjuncts(rule, &mut parts);
    let probes = parts.into_iter().map(|part| match part {
        Expr::Binary { op, left, right, .. } if op == "=" => match (left.as_ref(), right.as_ref()) {
            (Expr::Member { base, name, .. }, Expr::Name { name: viewer, .. }) | (Expr::Name { name: viewer, .. }, Expr::Member { base, name, .. })
                if viewer == "viewer" && matches!(base.as_ref(), Expr::Focal { .. }) => Some(format!("exists {parent}[.{reference}, {name} = viewer]")),
            _ => None,
        },
        other if !focal(other) => Some(crate::print::expression(other)),
        _ => None,
    }).collect::<Option<Vec<_>>>()?;
    Some(probes.join(" or "))
}
