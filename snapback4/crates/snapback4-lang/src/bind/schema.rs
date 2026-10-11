//! Binding declarations to the core schema: tables, indexes, rules,
//! constraints, maintained aggregates and their generated targets, and the
//! `sync` line with the principal column resolved.

use super::catalog::{Catalog, TableInfo};
use crate::ast::*;
use crate::diag::{Diagnostic, Fallible, Site, ambiguous, name_rewrite, sync_error, type_error, unknown};
use crate::types::{Ty, scalar_to_column};
use snapback4_core::ir::KeyProvenance;
use snapback4_core::schema::{self as core, Audience, Constraint, Horizon, LeavePolicy, RuleExpr, RuleTerm, Rules, Sync, Table};
use snapback4_core::value::Value;
use std::collections::{BTreeMap, BTreeSet};

pub fn bind_schema(catalog: &Catalog, diagnostics: &mut Vec<Diagnostic>) -> core::Schema {
    let mut schema = core::Schema::default();
    for info in catalog.tables.values() {
        let table = bind_table(catalog, info, diagnostics);
        for index in &info.indexes {
            if let Some((code, message)) = &index.refusal {
                match super::program::validate_code(&index.site, code) {
                    Ok(()) => {
                        schema.unique_refusals.entry(info.decl.name.clone()).or_default().insert(index.name.clone(), core::UniqueRefusal {
                            code: code.clone(), message: message.clone().unwrap_or_else(|| format!("the program refused with {code}")),
                        });
                    }
                    Err(diagnostic) => diagnostics.push(diagnostic),
                }
            }
        }
        schema.tables.insert(info.decl.name.clone(), table);
    }
    // Identity is semantic, independent of source locations and index planning order.
    for name in schema.through_order() {
        let Some(t) = schema.tables[&name].through.clone() else { continue; };
        let parent=&schema.tables[&t.parent];
        let fields: Vec<_> = t.fields.values().map(|f| (f,parent.columns.get(f),parent.defaults.get(f))).collect();
        // @ref LLP 3000.014#4-the-capture — expiry interpretation changes recapture every descendant, even when the rule never reads the deadline.
        let expiry = parent.expire.as_ref().map(|field| (field, parent.columns.get(field), parent.defaults.get(field)));
        let identity=snapback4_core::value::digest(&(&parent.rules.read,fields,expiry,&parent.through,&schema.tables[&name].columns[&t.reference],schema.tables[&name].defaults.get(&t.reference)));
        schema.tables.get_mut(&name).unwrap().through.as_mut().unwrap().identity=identity;
    }
    // @ref LLP 3000.007#6.7 — inherit the resolved audience, unless explicitly online only.
    for maintain in catalog.maintains.values() {
        if maintain.row_key.is_some() || maintain.online_only || !schema.tables.contains_key(&maintain.name) { continue; }
        let sync = schema.tables.get(&maintain.source).and_then(|t| t.sync.clone());
        if let Some(sync) = sync {
            let aliases = super::maintains::inherited_aliases(&catalog.tables[&maintain.source], maintain);
            let output = |column: &String| aliases.iter().find_map(|(out, capture)| (capture == column).then(|| out.clone()))
                .or_else(|| maintain.keys.iter().any(|key| matches!(key, Expr::Name { name, .. } if name == column)).then(|| column.clone()));
            let audience = match &sync.audience {
                Audience::Public => Some(Audience::Public),
                Audience::Column(column) => output(column).map(Audience::Column),
                Audience::Target { table, prefix, principal } => prefix.iter().map(output).collect::<Option<Vec<_>>>().map(|prefix| Audience::Target { table: table.clone(), prefix, principal: principal.clone() }),
            };
            if let Some(audience) = audience {
                let target = schema.tables.get_mut(&maintain.name).expect("bound maintain");
                target.sync = Some(Sync { audience, horizon: None });
                target.residency.inherited_from = Some(maintain.source.clone());
            }
        }
    }
    for maintain in catalog.maintains.values() {
        if maintain.row_key.is_some() {
            if schema.tables.contains_key(&maintain.name) { if let Err(d)=super::row_views::lower(catalog,&mut schema,maintain) { diagnostics.push(d); } }
            continue;
        }
        let source = catalog.tables.get(&maintain.source);
        let Some(source) = source else { continue };
        let mut source = source.clone();
        source.columns.extend(source.recorded.clone());
        source.columns.extend(source.captures.clone());
        if !schema.tables.contains_key(&maintain.name) { continue; }
        let kind = match &maintain.column {
            Some(column) => core::MaintainKind::Sum { of: column.clone() },
            None => core::MaintainKind::Count,
        };
        let computed = match super::maintains::keys(&source, maintain) { Ok(keys) => keys, Err(d) => { diagnostics.push(d); continue; } };
        let filter = match maintain.filter.as_ref().map(|expr| super::maintains::predicate(&source, expr)).transpose() { Ok(p) => p, Err(d) => { diagnostics.push(d); continue; } };
        schema.maintains.push(core::Maintain { own_keys: None, row_key: None, parent_key: schema.tables[&maintain.source].through.clone().filter(|t| maintain.read.is_none() && maintain.by.contains(&t.reference)), aliases: super::maintains::inherited_aliases(&source,maintain), private: None, filter, computed, residency: schema.tables[&maintain.name].residency.clone(), kind, source: maintain.source.clone(), by: maintain.by.clone(), target: maintain.name.clone(), readable: None });
    }
    super::columns::lower(catalog, &mut schema, diagnostics);
    super::own_keys::lower(catalog, &mut schema, diagnostics);
    schema.prepare_row_views();
    schema.prepare_contribution_indexes();
    for doc in &catalog.documents {
        for effect in &doc.effects {
            match super::actions::bind_work(&effect.work, &effect.site) {
                Ok(mut work) if !schema.effect_specs.contains_key(&effect.name) => {
                    // Legacy effects started at 4s, while actions started at 2s.
                    if effect.work.backoff_ms.is_none() { work.policy.backoff_ms = 4_000; }
                    schema.effects.push(effect.name.clone());
                    schema.effect_specs.insert(effect.name.clone(), work);
                }
                Ok(_) => {}
                Err(error) => diagnostics.push(error),
            }
        }
        if let Some((password, guests)) = doc.identity {
            schema.auth = core::Auth { password, guests };
        }
    }
    // Owner type/default diagnostics remain useful even when an invalid
    // owner also makes audience inference fail.
    for issue in core::field_authority::validate(&schema) {
        diagnostics.push(Diagnostic::new(&catalog.site_for(&issue.path), "E_FIELD_AUTHORITY", issue.message,
            "name a required principal column of this table; declare a default; use readable by audience before indexing or deriving from the field").guide("rules"));
    }
    // The core's structural check catches what binding did not; a
    // declaration that already refused is not reported twice.
    if diagnostics.is_empty() {
        let mut grants = super::audience_diagnostics::Grants::default();
        for issue in core::validate(&schema) {
            if grants.take(&issue) { continue; }
            let site = catalog.site_for(&issue.path);
            if issue.message.starts_with("ephemeral:") {
                let (message, fix) = issue.message.split_once("; ").unwrap_or((&issue.message, "keep that data in a durable table"));
                diagnostics.push(Diagnostic::new(&site, "E_QUARRY_EPHEMERAL", message, fix).guide("ephemeral"));
            } else if issue.message.starts_with("written by:") {
                diagnostics.push(Diagnostic::new(&site, "E_FIELD_AUTHORITY", issue.message, "name a required principal column of this table; declare a default; use readable by audience before indexing or deriving from the field").guide("rules"));
            } else if issue.message.contains("E_VIEW_KEY") {
                diagnostics.push(super::row_views::refusal(&site,issue.message));
            } else if issue.message.contains("expiring aggregate authorization must use only group keys") {
                diagnostics.push(Diagnostic::new(&site, "E_MAINTAIN_READ_EXPIRE", issue.message, "read <- deny  -- replace deny with a rule over the group keys, or omit read to inherit").guide("maintains"));
            } else if issue.message.contains("maintained column") || issue.message.contains("guide maintains") {
                diagnostics.push(super::columns::refusal(&site, issue.message));
            } else if issue.path.ends_with(".sync") {
                if let Some(name) = issue.path.strip_prefix("tables.").and_then(|path| path.strip_suffix(".sync"))
                    && let Some(maintain) = catalog.maintains.get(name)
                    && let Some(context) = super::audience_diagnostics::public_conflict(&schema, maintain,
                        maintain.read.as_ref().map_or(&maintain.site, |read| &read.site), "E_SYNC") {
                    diagnostics.push(context);
                    continue;
                }
                let rewrite = if issue.message.contains("needs required group keys") { "remove `?` from every content and audience group column named by this sync" } else { "make the sync audience exactly match the table's read rule" };
                diagnostics.push(Diagnostic::new(&site, "E_SYNC", issue.message, rewrite).guide("sync"));
            } else {
                diagnostics.push(Diagnostic::new(&site, "E_SCHEMA_CONSTRAINT", issue.message, "fix the declaration named by this message").guide("indexes"));
            }
        }
        diagnostics.extend(grants.diagnostics(&schema, catalog));
    }
    schema
}

/// Bind one table. A refused line becomes a diagnostic and a `deny` (or an
/// absent sync), so one mistake does not cascade into every reader.
fn bind_table(catalog: &Catalog, info: &TableInfo, diagnostics: &mut Vec<Diagnostic>) -> Table {
    let decl = &info.decl;
    let mut columns = BTreeMap::new();
    columns.insert("id".to_owned(), core::ColumnType::Id);
    for column in &decl.columns {
        if let TypeKind::Ref { table } = &column.type_.kind
            && !catalog.tables.contains_key(table)
        {
            diagnostics.push(type_error(&column.site, format!("column {}.{} references unknown table {table}", decl.name, column.name), name_rewrite(table, catalog.tables.keys().map(String::as_str), Some("declare the table, or use id for an opaque identity"))));
        }
        columns.insert(column.name.clone(), scalar_to_column(&column.type_));
    }
    let mut recorded = BTreeMap::new();
    for (path, kind) in &info.recorded {
        let (reference, column) = path.split_once('.').expect("admitted path");
        let TypeKind::Ref { table } = &info.columns[reference].kind else { unreachable!("admitted reference") };
        recorded.insert(path.clone(), core::RecordedField { reference: reference.into(), table: table.clone(), column: column.into() });
        columns.insert(path.clone(), scalar_to_column(kind));
    }
    columns.extend(info.captures.iter().map(|(name, ty)| (name.clone(), scalar_to_column(ty))));
    let mut indexes = BTreeMap::new();
    let mut constraints = Vec::new();
    for index in &info.indexes {
        let mut bound = core::Index::of(&index.columns.iter().map(String::as_str).collect::<Vec<_>>(), index.unique);
        for (position, column) in index.columns.iter().enumerate() {
            if let Some(expr) = index.computed.get(column) {
                match super::time_indexes::key(&decl.name, &info.columns, column, expr) {
                    Ok(key) => bound.components[position] = core::IndexComponent::Calendar(key),
                    Err(_) => {} // The catalog has already located this refusal.
                }
            }
        }
        if let Some((position, fields)) = &index.words {
            bound.components.insert(*position, core::IndexComponent::WordPrefixes { fields: fields.clone(), contract: serde_json::Value::String(snapback4_core::words::CONTRACT.to_owned()) });
        }
        indexes.insert(index.name.clone(), bound);
        if index.unique && index.name != "byId" {
            constraints.push(Constraint::Unique { index: index.name.clone() });
        }
    }
    let mut rules = Rules::deny();
    for effect in [Effect::Read, Effect::Insert, Effect::Update, Effect::Delete] {
        let rule = decl.rules.iter().find(|rule| rule.effect == effect);
        let bound = match (effect, &decl.public, rule) {
            (Effect::Read, Some((reason, _)), Some(rule)) => {
                diagnostics.push(unknown(&rule.site, format!("table {} cannot combine public with an explicit read rule", decl.name), format!("remove the read line, or remove `public '{reason}'`")));
                RuleExpr::Deny
            }
            (Effect::Read, Some((reason, _)), None) => RuleExpr::Public { reason: reason.clone() },
            (_, _, Some(rule)) => match bind_rule(catalog, info, rule) {
                Ok(bound) => bound,
                Err(diagnostic) => {
                    diagnostics.push(diagnostic);
                    RuleExpr::Deny
                }
            },
            (_, _, None) => RuleExpr::Deny,
        };
        match effect {
            Effect::Read => rules.read = bound,
            Effect::Insert => rules.insert = bound,
            Effect::Update => rules.update = bound,
            Effect::Delete => rules.delete = bound,
        }
    }
    for cap in &decl.caps {
        if !info.indexes.iter().any(|index| index.is_plain() && index.columns.starts_with(&cap.by)) {
            diagnostics.push(Diagnostic::new(&cap.site, "E_SCHEMA_CONSTRAINT", format!("cap {} by {} needs an index whose leading columns are exactly those", cap.max, cap.by.join(", ")), format!("by by{}: {}", cap.by.iter().map(|c| title(c)).collect::<String>(), cap.by.join(", "))).guide("indexes"));
            continue;
        }
        constraints.push(Constraint::Cap { by: cap.by.clone(), max: cap.max });
    }
    for (fields, _) in &decl.immutable {
        constraints.push(Constraint::Immutable { fields: fields.clone() });
    }
    for column in &decl.columns {
        if let TypeKind::Text { min, format, .. } = &column.type_.kind
            && (min.is_some() || format.is_some())
        {
            constraints.push(Constraint::Text { field: column.name.clone(), min: min.unwrap_or(0), format: format.as_deref().map(|f| if f == "handle" { core::TextFormat::Handle } else { core::TextFormat::Url }) });
        }
    }
    for (value, site) in &decl.final_exists {
        let Expr::Exists { read, .. } = value else { continue };
        match bind_probe(catalog, info, read, site, false) {
            Ok((table, index, key)) => constraints.push(Constraint::FinalExistsOnInsert { table, index, key }),
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }
    let leave = match decl.retain.as_ref().map(|(policy, _)| policy.as_str()) {
        Some("delivered-history") => LeavePolicy::DeliveredHistory,
        _ => LeavePolicy::UntilRevoked,
    };
    let sync = match &decl.sync {
        Some(sync) => match bind_sync(catalog, info, sync, &rules.read, &read_source(decl, &rules.read)) {
            Ok(sync) => Some(sync),
            Err(diagnostic) => {
                diagnostics.push(diagnostic);
                None
            }
        },
        None => None,
    };
    let expire = match &decl.expire {
        Some((column, site)) => match bind_expire(info, column, site) {
            Ok(column) => Some(column),
            Err(diagnostic) => {
                diagnostics.push(diagnostic);
                None
            }
        },
        None => None,
    };
    if decl.ephemeral.is_some() {
        columns.insert(core::through::DEADLINE.into(), core::ColumnType::Time);
        indexes.insert("$expiry".into(), core::Index::of(&[core::through::DEADLINE, "id"], false));
    }
    let residency = core::Residency { online_only: decl.online_only, inferred: decl.sync.as_ref().is_some_and(|s| matches!(s.audience, SyncAudience::Inferred { .. }) || matches!(&s.audience, SyncAudience::Target { prefix, .. } if info.through.is_some() && prefix.iter().any(|p| info.captures.contains_key(p)))), inherited_from: None };
    let defaults = super::defaults::bind(info, diagnostics);
    let mut sequences = BTreeMap::new();
    for column in &decl.columns {
        let Some(parent) = &column.sequence else { continue };
        if !matches!(info.columns.get(parent), Some(ScalarType { kind: TypeKind::Ref { table }, optional: false }) if catalog.tables.contains_key(table)) {
            diagnostics.push(Diagnostic::new(&column.site, "E_SEQUENCE_PARENT",
                format!("{}.{} needs a required reference to a parent table in {parent}", decl.name, column.name),
                format!("{parent}: <parent table>\n{}: sequence by {parent}", column.name)).guide("types"));
            continue;
        }
        sequences.insert(column.name.clone(), parent.clone());
        // The reference cannot move after allocation: that would import a duplicate ordinal into another parent's order.
        indexes.insert(core::sequence_index(&column.name), core::Index::of(&[parent, &column.name], false));
    }
    let written_by = decl.columns.iter().filter_map(|column| column.written_by.as_ref().map(|owner|
        (column.name.clone(), core::FieldAuthority { owner: owner.clone(), audience: column.readable_by_audience }))).collect();
    let update_transition = decl.rules.iter().any(|rule| rule.effect == Effect::Update && !rule.bindings.is_empty());
    Table { ephemeral: decl.ephemeral.as_ref().map(|e| core::ephemeral::Ephemeral { life_ms: e.life_ms }), sequences, written_by, update_transition, through: info.through.clone(), maintained: BTreeMap::new(), recorded, columns, defaults, indexes, rules, constraints, leave, sync, expire, residency }
}

/// `expire at .column`: a `time` column (optional means "never" when null)
/// with an index leading with it, so the sweep finds what is due without a
/// walk. The rewrite is the index line to add.
fn bind_expire(info: &TableInfo, column: &str, site: &Site) -> Fallible<String> {
    let table = &info.decl.name;
    let Some(kind) = info.columns.get(column) else {
        return Err(type_error(site, format!("expire at .{column}: table {table} has no column {column}"), name_rewrite(column, info.columns.keys().map(String::as_str), Some("declare `expiresAt: time ?` and expire at .expiresAt"))));
    };
    if kind.kind != TypeKind::Time {
        return Err(type_error(site, format!("expire at .{column}: {table}.{column} is {}, and a row's life ends at a time", crate::print::scalar_type(kind)), format!("{column}: time ?")));
    }
    let title = title(column);
    if !info.indexes.iter().any(|index| index.is_plain() && index.columns.first().map(String::as_str) == Some(column)) {
        return Err(Diagnostic::new(site, "E_SCHEMA_CONSTRAINT", format!("expire at .{column} needs an index leading with {column}, so the sweep finds due rows without a walk"), format!("by by{title}: {column}")).guide("expire"));
    }
    Ok(column.to_owned())
}

/// The read clause as the author wrote it, for diagnostics.
fn read_source(decl: &TableDecl, bound: &RuleExpr) -> String {
    match (&decl.public, decl.rules.iter().find(|rule| rule.effect == Effect::Read)) {
        (Some((reason, _)), _) => format!("public {}", crate::print::quote(reason)),
        (None, Some(rule)) => format!("read <- {}", crate::print::with_source(&rule.value, &|_| None)),
        (None, None) => format!("read <- {}", bound.quarry()),
    }
}

fn bind_sync(catalog: &Catalog, info: &TableInfo, sync: &SyncDecl, rule: &RuleExpr, source: &str) -> Fallible<Sync> {
    let audience = match &sync.audience {
        SyncAudience::Inferred { principal } => infer_audience(catalog, info, sync, rule, source, principal.as_deref())?,
        SyncAudience::Public => Audience::Public,
        SyncAudience::Column(column) => {
            match info.columns.get(column) {
                Some(ScalarType { kind: TypeKind::Principal, .. }) => {}
                Some(other) => return Err(sync_error(&sync.site, format!("sync to .{column} needs a principal column; {}.{column} is {}", info.decl.name, crate::print::scalar_type(other)), format!("sync to .<principal column>  -- or: {column}: principal"))),
                None => return Err(sync_error(&sync.site, format!("sync to .{column} names an undeclared column of {}", info.decl.name), name_rewrite(column, info.columns.keys().map(String::as_str), None))),
            }
            Audience::Column(column.clone())
        }
        SyncAudience::Target { table, prefix, principal } => {
            let Some(target) = catalog.tables.get(table) else {
                return Err(sync_error(&sync.site, format!("sync to {table} names an unknown table"), name_rewrite(table, catalog.tables.keys().map(String::as_str), None)));
            };
            for column in prefix {
                if !info.columns.contains_key(column) && !info.captures.contains_key(column) && column != "id" {
                    return Err(sync_error(&sync.site, format!("sync to {table}[.{column}] names an undeclared column of {}", info.decl.name), name_rewrite(column, info.columns.keys().map(String::as_str), None)));
                }
            }
            let principals: Vec<&str> = target.columns.iter().filter(|(_, kind)| matches!(kind.kind, TypeKind::Principal) && !kind.optional).map(|(name, _)| name.as_str()).collect();
            let principal = match principal {
                Some(named) => {
                    if !principals.contains(&named.as_str()) {
                        return Err(sync_error(&sync.site, format!("sync to {table}[..] by .{named}: {table}.{named} is not a principal column"), format!("sync to {table}[{}] by .<principal column of {table}>", prefix.iter().map(|c| format!(".{c}")).collect::<Vec<_>>().join(", "))));
                    }
                    named.clone()
                }
                None => match principals.as_slice() {
                    [one] => (*one).to_owned(),
                    [] => return Err(sync_error(&sync.site, format!("sync to {table}[..] needs a principal column on {table} to read recipients from; it has none"), super::through::sync_repair(catalog, info).unwrap_or_else(|| format!("add `principal: principal` to table {table}")))),
                    many => return Err(sync_error(&sync.site, format!("sync to {table}[..]: {table} has several principal columns ({}); name the recipient column", many.join(", ")), format!("sync to {table}[{}] by .{}", prefix.iter().map(|c| format!(".{c}")).collect::<Vec<_>>().join(", "), many[0]))),
                },
            };
            Audience::Target { table: table.clone(), prefix: prefix.clone(), principal }
        }
    };
    let principal = match &audience { Audience::Target { principal, .. } => Some(principal.as_str()), _ => None };
    let implied = infer_audience(catalog, info, sync, rule, source, principal)?;
    if audience != implied {
        return Err(sync_error(&sync.site, format!("the sync audience disagrees with the read rule `{source}`"),
            super::through::sync_repair(catalog, info).unwrap_or_else(|| "sync  -- infer the audience from the read rule".into())));
    }
    let horizon = match &sync.horizon {
        Some((last, SyncOrder::Index(by))) => {
            let Some(index) = info.indexes.iter().find(|index| &index.name == by) else {
                return Err(sync_error(&sync.site, format!("horizon names unknown index {}.{by}", info.decl.name), name_rewrite(by, info.indexes.iter().map(|i| i.name.as_str()), None)));
            };
            let group: Vec<String> = match &audience { Audience::Public => Vec::new(), Audience::Column(column) => vec![column.clone()], Audience::Target { prefix, .. } => prefix.clone() };
            if index.is_plain() && !index.columns.starts_with(&group) {
                // @ref LLP 3000.036.000#2.3 — name the two repairs against this table's own columns.
                let order: Vec<String> = index.columns.iter().filter(|column| !group.contains(column)).cloned().collect();
                let spelled = |columns: &[String]| columns.iter().map(|column| format!(".{column}")).collect::<Vec<_>>().join(", ");
                let window = if order.is_empty() || order == ["id"] { "last {n} by .id".to_owned() } else { format!("last {{n}} by {}", spelled(&order)) };
                let window = window.replace("{n}", &last.to_string());
                let mut lead = group.clone();
                lead.extend(order.iter().cloned());
                return Err(sync_error(&sync.site,
                    format!("horizon index {by} ({}) must lead with the audience column{} {}: a device keeps the newest {last} rows of each group, read from an index that starts with the group", index.columns.join(", "), if group.len() == 1 { "" } else { "s" }, group.join(", ")),
                    format!("{window}  -- in place of `last {last} by {by}`: the compiler builds the index with {} first; or declare `by {by}: {}`", group.join(", "), lead.join(", "))));
            }
            Some(Horizon { last: *last, by: by.clone() })
        }
        Some((_, SyncOrder::Columns(_))) => unreachable!("intent planning resolves window columns"),
        None => None,
    };
    Ok(Sync { audience, horizon })
}

// @ref LLP 3000.007#6.6 — omitted audiences invert exactly the same three read rules.
fn infer_audience(catalog: &Catalog, info: &TableInfo, sync: &SyncDecl, rule: &RuleExpr, source: &str, named: Option<&str>) -> Fallible<Audience> {
    let refusal = || sync_error(&sync.site, format!("sync cannot infer an audience from `{source}`: a synced table's read rule must be exactly `public`, `.column = viewer` or `exists target[.columns, viewer]`, so each device holds every row its viewer may read and no other; do not make private rows public to get past this"), audience_split(catalog, info, rule));
    match &super::intent_sync::audience_rule(&info.decl.name, info, rule) {
        RuleExpr::Public { .. } | RuleExpr::Allow if named.is_none() => Ok(Audience::Public),
        RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column)) if named.is_none() => Ok(Audience::Column(column.clone())),
        RuleExpr::Exists { table, index, key, equalities, .. } if equalities.is_empty() && key.last() == Some(&RuleTerm::Viewer) => {
            let prefix = key[..key.len() - 1].iter().map(|term| match term { RuleTerm::Field(column) => Some(column.clone()), _ => None }).collect::<Option<Vec<_>>>().ok_or_else(refusal)?;
            let target = catalog.tables.get(table).ok_or_else(refusal)?;
            let probe = target.indexes.iter().find(|i| &i.name == index).ok_or_else(refusal)?;
            let recipient = probe.columns.get(key.len() - 1).ok_or_else(refusal)?;
            let principals: Vec<_> = target.columns.iter().filter(|(_, ty)| ty.kind == TypeKind::Principal && !ty.optional).map(|(name, _)| name.as_str()).collect();
            if principals.len() > 1 && named.is_none() {
                return Err(sync_error(&sync.site, format!("sync: {table} has several principal columns ({}); name the recipient with `by .{recipient}`", principals.join(", ")), format!("sync by .{recipient}{}", sync.horizon.as_ref().map(|(n, by)| format!(" last {n} by {by}")).unwrap_or_default())));
            }
            if named.is_some_and(|name| name != recipient) || !principals.contains(&recipient.as_str()) { return Err(sync_error(&sync.site, format!("the read rule binds viewer to {table}.{recipient}"), format!("sync by .{recipient}"))); }
            Ok(Audience::Target { table: table.clone(), prefix, principal: recipient.clone() })
        }
        _ => Err(refusal()),
    }
}

/// The paved splits that keep every reader (LLP 3000.036 §1 A), spelled
/// against this table's own columns for the shapes builders meet most:
/// two parties, an owner beside a group, an owner beside a role.
// @ref LLP 3000.036.000#2.1 — each union shape gets the recipe that keeps every reader offline.
fn audience_split(catalog: &Catalog, info: &TableInfo, rule: &RuleExpr) -> String {
    fn viewer(rule: &RuleExpr) -> bool {
        let term = |term: &RuleTerm| matches!(term, RuleTerm::Viewer);
        match rule {
            RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => false,
            RuleExpr::Eq(l, r) | RuleExpr::Ne(l, r) | RuleExpr::Compare(_, l, r) => term(l) || term(r),
            RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().any(viewer),
            RuleExpr::Not(inner) => viewer(inner),
            RuleExpr::Exists { key, equalities, .. } | RuleExpr::Created { key, equalities, .. } => key.iter().chain(equalities.iter().map(|(_, t)| t)).any(term),
        }
    }
    let table = &info.decl.name;
    let audience = super::intent_sync::audience_rule(table, info, rule);
    let online = "; or replace the sync line with `online only` and keep this rule";
    let disjuncts = audience.disjuncts();
    if disjuncts.len() > 1 && disjuncts.iter().any(|disjunct| !viewer(disjunct)) {
        let private = disjuncts.iter().find(|disjunct| viewer(disjunct)).map_or_else(|| ".owner = viewer".to_owned(), |disjunct| disjunct.quarry());
        return format!("keep shared and private rows in two tables: the shared rows in a `public '..'` table with its own sync, the rest in a table read and synced by `{private}`, moving a row when it becomes shared (guide sync){online}");
    }
    // `.col = viewer` disjuncts: the row's own reader columns.
    let owners: Vec<&String> = disjuncts.iter().filter_map(|disjunct| match disjunct {
        RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column)) => Some(column),
        _ => None,
    }).collect();
    // `exists t[.a, viewer]` disjuncts: a group this row belongs to.
    let groups: Vec<(&String, &String, Vec<&String>)> = disjuncts.iter().filter_map(|disjunct| match disjunct {
        RuleExpr::Exists { table: target, index, key, equalities, .. } if equalities.is_empty() && key.len() > 1 && key.last() == Some(&RuleTerm::Viewer) => {
            let fields = key[..key.len() - 1].iter().map(|term| match term { RuleTerm::Field(field) => Some(field), _ => None }).collect::<Option<Vec<_>>>()?;
            Some((target, index, fields))
        }
        _ => None,
    }).collect();
    // A row-independent probe (`exists staff[viewer]`): a role, not a group.
    let roles: Vec<String> = disjuncts.iter().filter(|disjunct| matches!(disjunct, RuleExpr::Exists { key, equalities, .. }
        if key.iter().chain(equalities.iter().map(|(_, term)| term)).all(|term| !matches!(term, RuleTerm::Field(_))) && key.iter().chain(equalities.iter().map(|(_, term)| term)).any(|term| matches!(term, RuleTerm::Viewer))))
        .map(|disjunct| disjunct.quarry()).collect();
    let spelled = |columns: &[&String]| columns.iter().map(|column| format!(".{column}")).collect::<Vec<_>>().join(", ");
    if owners.len() >= 2 && owners.len() == disjuncts.len() {
        let parties = format!("{table}Parties");
        return format!("{} readers are {} audiences: give the row a parties table and read through it: `table {parties}:` with `item: {table}`, `party: principal`, `unique item, party`, `immutable item, party`, `read <- exists {parties}[.item, viewer]`, `insert <- created {table}[.item]`, `sync`; then here `read <- exists {parties}[.id, viewer]`, `sync`, and {}; the mutation that inserts the row inserts one {parties} row per reader (guide sharing: two parties){online}",
            spelled(&owners), owners.len(),
            owners.iter().map(|owner| format!("`after insert <- exists {parties}[item = .id, party = .{owner}]`")).collect::<Vec<_>>().join(" and "));
    }
    if let [(target, index, fields)] = groups.as_slice() && !owners.is_empty() && owners.len() + 1 == disjuncts.len()
        && let Some(target_info) = catalog.tables.get(*target)
        && let Some(probe) = target_info.indexes.iter().find(|candidate| &candidate.name == *index)
        && probe.columns.len() == fields.len() + 1 {
        let recipient = &probe.columns[fields.len()];
        let group_columns = &probe.columns[..fields.len()];
        let bind = |owner: &String| group_columns.iter().zip(fields).map(|(column, field)| format!("{column} = .{field}")).chain([format!("{recipient} = .{owner}")]).collect::<Vec<_>>().join(", ");
        let grant = format!("exists {target}[{}, viewer]", group_columns.iter().map(|column| format!(".{column}")).collect::<Vec<_>>().join(", "));
        let created = match (group_columns, fields.as_slice()) {
            ([column], [field]) if field.as_str() == "id" => format!("created {table}[.{column}] or "),
            _ => String::new(),
        };
        return format!("the owner is one more reader of the group: drop {} and give each owner a {target} row, so every reader reads through {target}: here `read <- exists {target}[{}, viewer]`, `sync`, and {}; in {target}, `insert <- {created}{grant}` (each insert branch proves the caller's grant), and the mutation that inserts the row inserts the owner's {target} row (guide sharing: a team the owner manages){online}",
            owners.iter().map(|owner| format!("`.{owner} = viewer`")).collect::<Vec<_>>().join(" and "),
            spelled(fields), owners.iter().map(|owner| format!("`after insert <- exists {target}[{}]`", bind(owner))).collect::<Vec<_>>().join(" and "));
    }
    if !owners.is_empty() && !roles.is_empty() && owners.len() + roles.len() == disjuncts.len() {
        return format!("an owner plus a role ({}) is a union of two audiences, which sync does not deliver: keep one table per audience and let mutations write across: this table read and synced by `{}`, a staff copy read by `{}` and synced to it, and staff updates inserted into rows the owner reads (guide sharing: an owner plus staff){online}",
            roles.join(", "), owners.iter().map(|owner| format!(".{owner} = viewer")).collect::<Vec<_>>().join(" or "), roles.join(" or "));
    }
    format!("give each reader a row in a membership table synced to its members, and read through it: `table {table}Readers:` with `item: {table}`, `reader: principal`, `unique item, reader`, `immutable item, reader`, `read <- .reader = viewer`, `insert <- created {table}[.item] or exists {table}Readers[.item, viewer]`, `sync`; then here `read <- exists {table}Readers[.id, viewer]` and `sync to {table}Readers[.id] by .reader` (guide sharing){online}")
}

/// Bind a rule expression over a table's focal row.
pub fn bind_rule(catalog: &Catalog, info: &TableInfo, rule: &RuleDecl) -> Fallible<RuleExpr> {
    let bindings = RuleBindings { old: rule.bindings.first().cloned(), next: rule.bindings.get(1).cloned(), update: rule.effect == Effect::Update, insert: rule.effect == Effect::Insert, hops: rule.effect != Effect::Read, present: Vec::new() };
    rule_expr(catalog, info, &rule.value, &bindings).map_err(|error| {
        let mut error = super::first_paste::inherited_rule(catalog, info, rule).unwrap_or(error);
        // @ref LLP 3000.036#13.6 — the named form of a whole unnamed update rule, so the rewrite keeps every other clause.
        if error.code == "E_QUARRY_RULE_OPERATOR" && rule.effect == Effect::Update && rule.bindings.is_empty() && error.rewrite.starts_with("name both images") {
            let comparison = error.message.split('`').nth(1).unwrap_or_default().to_owned();
            error.rewrite = super::rule_operator::named_update(&info.decl.name, &rule.value, &comparison);
        }
        if error.code == "E_QUARRY_RULE_HOP" {
            error.rewrite = match rule.effect {
                Effect::Read => reference::read_hop_rewrite(catalog, info, &rule.value).unwrap_or_else(|| "a read rule probes one hop: copy the deciding value onto this row (immutable, checked against the parent by the insert rule), or use read through .parent".into()),
                _ => reference::reference_rewrite(catalog, info, &rule.value),
            };
        }
        // @ref LLP 3000.036#14.3 — a read-through child binds its parent's rule over hidden
        // captures (`.$enrollment.dancer`): its refusal is the parent's (`internal_names` drops the copy).
        if rule.effect == Effect::Read && let Some(through) = &info.through {
            error.rewrite = format!("repair {}'s read rule (its own diagnostic prints the repair); {} reads through it", through.parent, info.decl.name);
            error.cascade_of = Some(error.site.clone());
        }
        error
    })
}

#[derive(Clone)]
struct RuleBindings {
    old: Option<String>,
    next: Option<String>,
    update: bool,
    insert: bool,
    hops: bool,
    present: Vec<RuleTerm>,
}

// @ref LLP 3000.013#2.2 — presence facts retain a reference term's old/next image.
// Facts hold on the logical edge where the next operand can affect truth.
// Expiry accounting may evaluate other edges too: the shared runtime returns
// no witness for an ordinary unique null key, without accessing tied rows.
// Thus admission does not require physical short-circuiting. Facts still
// cannot leak from one OR alternative into an unrelated alternative.
fn present_terms(rule: &RuleExpr, truth: bool) -> Vec<RuleTerm> {
    match rule {
        RuleExpr::Ne(left, right) if truth => non_null_term(left, right),
        RuleExpr::Eq(left, right) if !truth => non_null_term(left, right),
        RuleExpr::Not(inner) => present_terms(inner, !truth),
        RuleExpr::And(parts) | RuleExpr::Or(parts) => {
            let union = matches!(rule, RuleExpr::And(_)) == truth;
            let mut facts = parts.iter().map(|part| present_terms(part, truth));
            let mut result = facts.next().unwrap_or_default();
            for facts in facts {
                if union { for term in facts { if !result.contains(&term) { result.push(term); } } }
                else { result.retain(|term| facts.contains(term)); }
            }
            result
        }
        _ => Vec::new(),
    }
}

fn non_null_term(left: &RuleTerm, right: &RuleTerm) -> Vec<RuleTerm> {
    match (left, right) {
        (RuleTerm::Literal(Value::Null), term) | (term, RuleTerm::Literal(Value::Null)) => vec![term.clone()],
        _ => Vec::new(),
    }
}

fn rule_expr(catalog: &Catalog, info: &TableInfo, expr: &Expr, bindings: &RuleBindings) -> Fallible<RuleExpr> {
    let site = expr.site();
    match expr {
        Expr::Name { name, .. } => match name.as_str() {
            "allow" => Ok(RuleExpr::Allow),
            "deny" => Ok(RuleExpr::Deny),
            "public" => Ok(RuleExpr::Public { reason: format!("{} is public", info.decl.name) }),
            "true" => Ok(RuleExpr::Allow),
            "false" => Ok(RuleExpr::Deny),
            other => Err(unknown(site, format!("`{other}` is not a rule; rules are allow, deny, public, exists, created, and comparisons over ., viewer and literals"), "read <- .ownerId = viewer")),
        },
        Expr::Call { name, args, .. } if name == "public" => {
            let reason = match args.first() {
                Some(Expr::Literal { value: crate::ast::Literal::Str(reason), .. }) => reason.clone(),
                _ => format!("{} is public", info.decl.name),
            };
            Ok(RuleExpr::Public { reason })
        }
        Expr::Binary { op, left, right, .. } => match op.as_str() {
            "and" | "or" => {
                let left = rule_expr(catalog, info, left, bindings)?;
                let mut guarded = bindings.clone();
                guarded.present.extend(present_terms(&left, op == "and"));
                let right = rule_expr(catalog, info, right, &guarded)?;
                Ok(if op == "and" { RuleExpr::And(vec![left, right]) } else { RuleExpr::Or(vec![left, right]) })
            }
            "=" | "!=" | ">=" | ">" | "<=" | "<" => {
                let ordered = !matches!(op.as_str(), "=" | "!=");
                let transition = bindings.update && bindings.old.is_some();
                let effect = super::rule_operator::effect_word(bindings.insert, bindings.update, !bindings.hops);
                // @ref LLP 3000.036#11 — unsupported terms and misplaced ordered comparisons name what rules evaluate and move the author's comparison into the mutation.
                if let Some(what) = [left.as_ref(), right.as_ref()].into_iter().find_map(super::rule_operator::unsupported_side) {
                    return Err(super::rule_operator::diagnostic(site, &info.decl.name, effect, transition, expr, what));
                }
                if ordered && !transition && !bindings.insert { return Err(super::rule_operator::diagnostic(site, &info.decl.name, effect, transition, expr, "an ordered comparison")); }
                let (mut l, mut lt) = rule_term(catalog, info, left, bindings)?;
                let (mut r, mut rt) = rule_term(catalog, info, right, bindings)?;
                // `viewer = 'service:ranker'`: a text literal beside the
                // viewer names a principal, as it does beside `=` in a program.
                let as_principal = |term: &mut RuleTerm, ty: &mut Ty| {
                    if let RuleTerm::Literal(Value::String(text)) = term {
                        *term = RuleTerm::Literal(Value::Id(text.clone()));
                        *ty = Ty::Principal;
                    }
                };
                if matches!(l, RuleTerm::Viewer) {
                    as_principal(&mut r, &mut rt);
                }
                if matches!(r, RuleTerm::Viewer) {
                    as_principal(&mut l, &mut lt);
                }
                if !lt.comparable(&rt) {
                    return Err(type_error(site, format!("rule comparison joins {} with {}", lt.name(), rt.name()), "compare a principal column with viewer, or a column with a literal of its own type"));
                }
                if let (Ty::Principal, other) | (other, Ty::Principal) = (&lt, &rt)
                    && !matches!(other, Ty::Principal | Ty::Id)
                    && !matches!((&l, &r), (RuleTerm::Viewer, _) | (_, RuleTerm::Viewer))
                {
                    return Err(type_error(site, format!("viewer meets {} here; only principal columns compare with viewer", other.name()), "declare the column as principal"));
                }
                if ordered && !transition {
                    // An insert rule orders only the new row's own required
                    // int/time/decimal/money columns and integer literals (a
                    // literal beside decimal or money is minor units, as the
                    // wire and programs read it).
                    // @ref LLP 3000.036#12 — money and decimal hold integer minor units, so they order like int.
                    let own = |term: &RuleTerm| match term { RuleTerm::Field(field) => info.columns.contains_key(field), RuleTerm::Literal(Value::Int(_)) => true, _ => false };
                    if !own(&l) || !own(&r) || matches!((&l, &r), (RuleTerm::Literal(_), RuleTerm::Literal(_))) {
                        return Err(super::rule_operator::diagnostic(site, &info.decl.name, effect, transition, expr, "an ordered comparison beyond this row's own columns"));
                    }
                    let scalar = |ty: &Ty| matches!(ty, Ty::Int | Ty::Time | Ty::Decimal(_) | Ty::Money(..));
                    let literal = |term: &RuleTerm| matches!(term, RuleTerm::Literal(_));
                    if !scalar(&lt) || !scalar(&rt) || (lt != rt && !literal(&l) && !literal(&r)) {
                        let optional = matches!(lt, Ty::Optional(_)) || matches!(rt, Ty::Optional(_));
                        let both_columns = !literal(&l) && !literal(&r);
                        let help = if optional { "declare the column required, or check it in the mutation with require".to_owned() }
                            else if both_columns && scalar(&lt) && scalar(&rt) { format!("columns ordered against each other need one type ({} and {} differ); compare each with an integer literal, or check it in the mutation with require", lt.name(), rt.name()) }
                            else { format!("an insert rule orders int, time, decimal and money columns; check this {} comparison in the mutation with require", if scalar(&lt) { rt.name() } else { lt.name() }) };
                        return Err(type_error(site, format!("an insert-rule ordered comparison joins {} with {}{}", lt.name(), rt.name(), if optional { "; an optional column may be null, which is not ordered" } else { "" }), help));
                    }
                } else if ordered {
                    // A named transition orders int, time, decimal and money images; an
                    // integer literal beside decimal or money is minor units, as in an
                    // insert rule (the engine compares the stored integers).
                    // @ref LLP 3000.036#13.6 — wave 3 I4: one ordering rule for insert rules and named updates.
                    let scalar = |ty: &Ty| matches!(ty.required(), Ty::Int | Ty::Time | Ty::Decimal(_) | Ty::Money(..));
                    let literal = |term: &RuleTerm| matches!(term, RuleTerm::Literal(Value::Int(_)));
                    // A private (`written by`) decimal or money input stays refused: the disclosure
                    // suite verifies ordered private transitions at runtime for int and time only.
                    let private = |term: &RuleTerm| matches!(term, RuleTerm::OldField(f) | RuleTerm::NextField(f)
                        if info.decl.columns.iter().any(|c| &c.name == f && c.written_by.is_some() && !c.readable_by_audience));
                    let units = |ty: &Ty| matches!(ty.required(), Ty::Decimal(_) | Ty::Money(..));
                    if (units(&lt) || units(&rt)) && (private(&l) || private(&r)) {
                        return Err(type_error(site, format!("ordered transition terms over a private decimal or money field are not evaluated in rules; got {} and {}", lt.name(), rt.name()),
                            super::rule_operator::transition_require(&info.decl.name, expr)));
                    }
                    if !scalar(&lt) || !scalar(&rt) || (lt.required() != rt.required() && !literal(&l) && !literal(&r)) {
                        // Never a rewrite that changes the policy: the same comparison, in the mutation.
                        return Err(type_error(site, format!("ordered transition terms need one int, time, decimal or money type (or an integer literal); got {} and {}", lt.name(), rt.name()),
                            super::rule_operator::transition_require(&info.decl.name, expr)));
                    }
                }
                Ok(match op.as_str() { "=" => RuleExpr::Eq(l,r), "!=" => RuleExpr::Ne(l,r),
                    ">=" => RuleExpr::Compare(snapback4_core::ir::BinaryOp::Gte,l,r), ">" => RuleExpr::Compare(snapback4_core::ir::BinaryOp::Gt,l,r),
                    "<=" => RuleExpr::Compare(snapback4_core::ir::BinaryOp::Lte,l,r), _ => RuleExpr::Compare(snapback4_core::ir::BinaryOp::Lt,l,r) })
            }
            other => {
                let effect = super::rule_operator::effect_word(bindings.insert, bindings.update, !bindings.hops);
                Err(super::rule_operator::diagnostic(site, &info.decl.name, effect, bindings.update && bindings.old.is_some(), expr, &format!("the operator `{other}`")))
            }
        },
        Expr::Unary { op, value, .. } if op == "not" => Ok(RuleExpr::Not(Box::new(rule_expr(catalog, info, value, bindings)?))),
        Expr::Member { .. } => {
            let (term, ty) = rule_term(catalog,info,expr,bindings)?;
            if ty != Ty::Bool { return Err(type_error(site,"a bare rule field must be bool","compare this field with a value of its declared type")); }
            Ok(RuleExpr::Eq(term,RuleTerm::Literal(Value::Bool(true))))
        }
        Expr::Exists { read, site } => {
            let (table, index, key, equalities) = probe(catalog, info, read, site, bindings, true)?;
            Ok(RuleExpr::Exists { table, index, key, equalities, provenance: KeyProvenance::Shape })
        }
        Expr::Created { read, site } => {
            if !bindings.insert {
                return Err(unknown(site, "created is valid only in an insert rule", "use exists in read, update and delete rules"));
            }
            let (table, index, key, equalities) = probe(catalog, info, read, site, bindings, true)?;
            Ok(RuleExpr::Created { table, index, key, equalities, provenance: KeyProvenance::Shape })
        }
        Expr::Literal { value: Literal::Bool(b), .. } => Ok(if *b { RuleExpr::Allow } else { RuleExpr::Deny }),
        Expr::Call { .. } => {
            let effect = super::rule_operator::effect_word(bindings.insert, bindings.update, !bindings.hops);
            Err(super::rule_operator::diagnostic(site, &info.decl.name, effect, bindings.update && bindings.old.is_some(), expr, "a helper or function call"))
        }
        other => Err(unknown(site, format!("`{}` is not a rule", crate::print::expression(other)), "read <- exists memberships[.conversationId, viewer]")),
    }
}

fn rule_term(catalog: &Catalog, info: &TableInfo, expr: &Expr, bindings: &RuleBindings) -> Fallible<(RuleTerm, Ty)> {
    let site = expr.site();
    match expr {
        Expr::Name { name, .. } if name == "viewer" => Ok((RuleTerm::Viewer, Ty::Principal)),
        Expr::Member { base, name, .. } => match base.as_ref() {
            Expr::Read(read) if read.keys.len() == 1 && read.keys[0].column.as_deref().is_none_or(|c| c == "id")
                && read.range.is_none() && read.filter.is_none() && read.matching.is_none()
                && read.index.is_none() && read.seeks.is_empty() => {
                let result = rule_reference(catalog, info, &read.keys[0].value, name, bindings, site)?;
                if result.0.references().last().is_some_and(|(table, _)| table == read.table) { Ok(result) }
                else { Err(type_error(site, "the lookup table differs from the reference type", "use the reference's declared table")) }
            }
            Expr::Focal { .. } => {
                if bindings.update && bindings.old.is_some() {
                    return Err(unknown(site, "an update (old, next) rule names its images; . is not bound", format!("next.{name}")));
                }
                let ty = column_ty(info, name).ok_or_else(|| unknown(site, format!("rule reads undeclared column {}.{name}", info.decl.name), name_rewrite(name, info.columns.keys().map(String::as_str).chain(["id"]), None)))?;
                Ok((RuleTerm::Field(name.clone()), ty))
            }
            Expr::Name { name: binder, .. } if bindings.old.as_deref() == Some(binder) => {
                let ty = column_ty(info, name).ok_or_else(|| unknown(site, format!("rule reads undeclared column {}.{name}", info.decl.name), name_rewrite(name, info.columns.keys().map(String::as_str).chain(["id"]), None)))?;
                Ok((RuleTerm::OldField(name.clone()), ty))
            }
            Expr::Name { name: binder, .. } if bindings.next.as_deref() == Some(binder) => {
                let ty = column_ty(info, name).ok_or_else(|| unknown(site, format!("rule reads undeclared column {}.{name}", info.decl.name), name_rewrite(name, info.columns.keys().map(String::as_str).chain(["id"]), None)))?;
                Ok((RuleTerm::NextField(name.clone()), ty))
            }
            other => rule_reference(catalog, info, other, name, bindings, site),
        },
        Expr::Name { name, .. } if bindings.update && (bindings.old.as_deref() == Some(name) || bindings.next.as_deref() == Some(name)) => Err(unknown(site, format!("select a field of {name} explicitly"), format!("{name}.id"))),
        Expr::Name { name, .. } => Err(unknown(site, format!("`{name}` is not a rule term; rules read the row as .{name}"), format!(".{name}"))),
        Expr::Literal { value, .. } => Ok(match value {
            Literal::Str(text) => (RuleTerm::Literal(Value::String(text.clone())), Ty::Text(text.chars().count() as u32)),
            Literal::Number(text) => (RuleTerm::Literal(Value::Int(super::integer_literal(text, site)?)), Ty::Int),
            Literal::Bool(b) => (RuleTerm::Literal(Value::Bool(*b)), Ty::Bool),
            Literal::Null => (RuleTerm::Literal(Value::Null), Ty::Null),
        }),
        Expr::Unary { op, value, .. } if op == "-" => {
            let (term, _) = rule_term(catalog, info, value, bindings)?;
            match term {
                RuleTerm::Literal(Value::Int(n)) => Ok((RuleTerm::Literal(Value::Int(-n)), Ty::Int)),
                _ => Err(type_error(site, "a negative rule literal needs an integer", "compare .column with an integer literal")),
            }
        }
        other => {
            let _ = catalog;
            Err(unknown(site, format!("`{}` is not a rule term", crate::print::expression(other)), "compare .column with viewer or a literal"))
        }
    }
}

fn column_ty(info: &TableInfo, name: &str) -> Option<Ty> {
    if name == "id" {
        return Some(Ty::Ref(info.decl.name.clone()));
    }
    info.columns.get(name).or_else(|| info.captures.get(name)).map(Ty::from_scalar)
}

/// Final-insert obligations retain their exact-index write-path contract.
/// Ordinary effect rules use `probe` with residual equalities enabled.
pub fn bind_probe(catalog: &Catalog, info: &TableInfo, read: &ReadExpr, site: &Site, update: bool) -> Fallible<(String, String, Vec<RuleTerm>)> {
    let bindings = RuleBindings { old: None, next: None, update, insert: false, hops: true, present: Vec::new() };
    let (table, index, key, _) = probe(catalog, info, read, site, &bindings, false).map_err(|mut error| {
        if error.code == "E_QUARRY_RULE_HOP" { error.rewrite = reference::reference_rewrite(catalog, info, &Expr::Exists { read: read.clone(), site: site.clone() }); }
        error
    })?;
    Ok((table, index, key))
}

fn probe(catalog: &Catalog, info: &TableInfo, read: &ReadExpr, site: &Site, bindings: &RuleBindings, extras: bool) -> Fallible<(String, String, Vec<RuleTerm>, Vec<(String, RuleTerm)>)> {
    if catalog.tables.get(&read.table).is_some_and(|t| t.decl.ephemeral.is_some()) {
        return Err(Diagnostic::new(site, "E_QUARRY_EPHEMERAL", format!("a rule or after insert cannot probe ephemeral table {}", read.table), "probe a durable table instead").guide("ephemeral"));
    }
    // `exists pieces[.id = .piece, …]`: a comparison where a key belongs. Name
    // the column (`id = .piece`) or give the full unique key by position first.
    // @ref LLP 3000.036#11 — app-farm pattern 27: the positional unique-key form.
    for key in &read.keys {
        if let Expr::Binary { op, left, right, .. } = &key.value && op == "="
            && let Expr::Member { base, name, .. } = left.as_ref() && matches!(base.as_ref(), Expr::Focal { .. }) {
            let others: Vec<String> = read.keys.iter().filter(|other| !std::ptr::eq(*other, key)).map(|other| match &other.column {
                Some(column) => format!("{column} = {}", crate::print::expression(&other.value)),
                None => crate::print::expression(&other.value),
            }).collect();
            let value = crate::print::expression(right);
            let positional = if name == "id" { std::iter::once(value.clone()).chain(others.iter().cloned()).collect::<Vec<_>>().join(", ") } else { std::iter::once(format!("{name} = {value}")).chain(others.iter().cloned()).collect::<Vec<_>>().join(", ") };
            return Err(unknown(&key.site, format!("`.{name} = {value}` is a comparison inside a probe key; in {}[..] a key names a column without a dot (`{name} = {value}`), or gives a full unique key by position first", read.table),
                format!("exists {}[{positional}]", read.table)).guide("rules"));
        }
    }
    let mixed = read.keys.iter().any(|key| key.column.is_some()) && read.keys.iter().any(|key| key.column.is_none());
    let types = if mixed { Some(read.keys.iter().take_while(|key| key.column.is_none()).map(|key| rule_term(catalog, info, &key.value, bindings)
        .map(|(term, ty)| (ty, matches!(term, RuleTerm::Literal(Value::String(_)))))).collect::<Fallible<Vec<_>>>()?) } else { None };
    let normalized = catalog.tables.get(&read.table).map(|target| super::mixed_keys::read_typed(target, read, catalog, types.as_deref())).transpose()?;
    let read = normalized.as_deref().unwrap_or(read);
    super::validate_key_names(read)?;
    if read.range.is_some() || !read.seeks.is_empty() || read.matching.is_some() || read.filter.is_some() { return Err(unknown(site, "a rule probe takes equalities, not a range", "exists t[key = .key]")); }
    let Some(target) = catalog.tables.get(&read.table) else {
        return Err(unknown(site, format!("exists probes unknown table {}", read.table), name_rewrite(&read.table, catalog.tables.keys().map(String::as_str), None)));
    };
    for key in &read.keys {
        if let Some(field) = &key.column { super::row_views::predicate_field(target, field, site)?; }
    }
    let mut terms = Vec::new();
    let mut types = Vec::new();
    for key in &read.keys {
        let (term, ty) = rule_term(catalog, info, &key.value, bindings)?;
        terms.push((key.column.clone(), term));
        types.push(ty);
    }
    let named: Option<Vec<String>> = if terms.iter().all(|(c, _)| c.is_some()) && !terms.is_empty() { Some(terms.iter().map(|(c, _)| c.clone().unwrap()).collect()) } else { None };
    // @ref LLP 3000.007#17 — an expiring maintain's physical value is not its live fact; only existence is a one-unit rule probe.
    if named.as_ref().is_some_and(|names| names.iter().any(|name| name == "value"))
        && catalog.maintains.get(&read.table).filter(|m| m.row_key.is_none()).and_then(|maintain| catalog.tables.get(&maintain.source)).is_some_and(|source| source.decl.expire.is_some() || source.through.as_ref().is_some_and(|t| t.expiring)) {
        return Err(Diagnostic::new(site, "E_QUARRY_LIVE_MAINTAIN_PROBE", format!("a rule cannot probe {}.value because its source expires", read.table),
            "read the view in the program; its live value cannot be probed at one unit").guide("expire"));
    }
    if let Some(names) = &named {
        for ((_, term), (column, ty)) in terms.iter_mut().zip(names.iter().zip(&mut types)) {
            let expected = column_ty(target, column).ok_or_else(|| unknown(site, format!("{} has no column {column}", read.table), name_rewrite(column, target.columns.keys().map(String::as_str).chain(["id"]), None)))?;
            if !ty.comparable(&expected) && !(expected.is_identity() && matches!(term, RuleTerm::Literal(Value::String(_)))) { return Err(type_error(site, format!("{column} is {}; {}.{column} is {}", ty.name(), read.table, expected.name()), format!("use {} for {column}", expected.name()))); }
            if expected.required().is_identity() && let RuleTerm::Literal(Value::String(text)) = term { *term = RuleTerm::Literal(Value::Id(text.clone())); *ty = Ty::Id; }
            if let (Ty::Enum(variants), RuleTerm::Literal(Value::String(text))) = (expected.required(), &*term) {
                if !variants.contains(text) { return Err(type_error(site, format!("'{text}' is not one of {}.{column}'s variants {}", read.table, variants.join(", ")), format!("'{}'", variants[0]))); }
            }
        }
    }
    if named.is_none() {
        let typed = types.iter().cloned().zip(terms.iter().map(|(_, term)| matches!(term, RuleTerm::Literal(Value::String(_))))).collect::<Vec<_>>();
        let declared = super::positional_keys::candidates(target, read, &typed, &catalog.synthesized);
        if declared.len() != 1 {
            return Err(super::positional_keys::refusal(target, read, &declared, catalog));
        }
        if read.index.is_none() {
            let mut selected = read.clone();
            selected.index = Some(declared[0].name.clone());
            return probe(catalog, info, &selected, site, bindings, extras);
        }
    }
    let mut candidates: Vec<&IndexDecl> = target
        .indexes
        .iter()
        .filter(|index| index.is_plain())
        .filter(|index| named.is_some() || !catalog.synthesized.contains(&(read.table.clone(), index.name.clone())))
        .filter(|index| match &read.index {
            Some(explicit) => &index.name == explicit,
            None => true,
        })
        .filter(|index| match &named {
            Some(names) => (index.columns.len() == names.len() && names.iter().all(|n| index.columns.contains(n))) || (extras && target.total_unique(index) && index.columns.iter().all(|column| names.contains(column))),
            None => (index.unique || read.index.is_some()) && index.columns.len() == terms.len(),
        })
        .filter(|index| {
            index.columns.iter().enumerate().all(|(position, column)| {
                let ty = match &named {
                    Some(names) => names.iter().position(|n| n == column).map(|p| &types[p]),
                    None => types.get(position),
                };
                let expected = if column == "id" { Ty::Ref(read.table.clone()) } else { target.columns.get(column).map(Ty::from_scalar).unwrap_or(Ty::Unknown) };
                ty.is_some_and(|ty| ty.comparable(&expected) || (expected.is_identity() && matches!(terms[position].1, RuleTerm::Literal(Value::String(_)))))
            })
        })
        .collect();
    if extras && named.is_some() {
        if let Some(width) = candidates.iter().filter(|i| target.total_unique(i)).map(|i| i.columns.len()).min() {
            candidates.retain(|i| target.total_unique(i) && i.columns.len() == width);
            // @ref LLP 3000.036#11 — named equalities covering two total unique keys
            // test one row either way (the other key's columns are extra
            // equalities on it), so the first declared key decides; no ambiguity.
            candidates.truncate(1);
        }
        else if candidates.iter().any(|i| i.unique) { candidates.retain(|i| i.unique); }
    }
    if named.is_none() {
        let unique: Vec<_> = candidates.iter().copied().filter(|index| index.unique && index.columns.len() == terms.len()).collect();
        if unique.len() == 1 { candidates = unique; }
    }
    let index = match candidates.as_slice() {
        [one] => (*one).clone(),
        [] => {
            if read.index.is_none() {
                if let Some(names) = &named {
                    let name = names.iter().map(|n| { let mut chars = n.chars(); chars.next().map(|c| c.to_uppercase().to_string()).unwrap_or_default() + chars.as_str() }).collect::<String>();
                    return Err(unknown(site, format!("{} has no index with {} columns matching this key", read.table, names.len()), format!("by by{name}: {}", names.join(", "))).guide("indexes"));
                }
            }
            let declared: Vec<String> = target.indexes.iter().map(|i| format!("{}: {}", i.name, i.columns.join(", "))).collect();
            return Err(unknown(site, format!("{} has no index with {} column{} matching this key", read.table, terms.len(), if terms.len() == 1 { "" } else { "s" }), format!("declare `unique by{}: <columns>` on {}; its indexes are {}", read.table.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default(), read.table, if declared.is_empty() { "none".to_owned() } else { declared.join("; ") }) + if extras && named.is_some() { "; an index is needed when the named equalities do not cover a total unique key" } else { "" }));
        }
        many => {
            let names: Vec<&str> = many.iter().map(|i| i.name.as_str()).collect();
            let changes = many.iter().filter(|index| !catalog.synthesized.contains(&(read.table.clone(), index.name.clone())))
                .map(|index| crate::repair::ReadChange::Index(index.name.clone())).collect();
            return Err(ambiguous(site, format!("{} has {} indexes matching this key: {}; choose a unique key with admitted arguments", read.table, many.len(), names.join(", ")), "")
                .repair_read(&read.site, changes));
        }
    };
    super::point_key::check(target, &index, read, &terms.iter().zip(&types).map(|((column, term), ty)|
        (column.as_deref(), (!ty.is_optional() && *ty != Ty::Unknown) || bindings.present.contains(term))).collect::<Vec<_>>())?;
    let equalities = terms.iter().filter_map(|(column, term)| column.as_ref().filter(|col| !index.columns.contains(col)).map(|col| (col.clone(), term.clone()))).collect();
    let mut ordered: Vec<RuleTerm> = match &named {
        Some(names) => index.columns.iter().map(|column| {
            let position = names.iter().position(|n| n == column).ok_or_else(|| unknown(site, format!("key omits column {column} of {}.{}", read.table, index.name), format!("name each column once: {}", index.columns.join(", "))))?;
            Ok(terms[position].1.clone())
        }).collect::<Fallible<_>>()?,
        None => terms.into_iter().map(|(_, term)| term).collect(),
    };
    // Literals take the column's nominal form: an id in an identity column,
    // a checked variant in an enum column.
    for (term, column) in ordered.iter_mut().zip(&index.columns) {
        let expected = if column == "id" { Some(ScalarType { kind: TypeKind::Ref { table: read.table.clone() }, optional: false }) } else { target.columns.get(column).cloned() };
        if let (RuleTerm::Literal(Value::String(text)), Some(expected)) = (&*term, expected) {
            match &expected.kind {
                TypeKind::Id | TypeKind::Principal | TypeKind::Ref { .. } => *term = RuleTerm::Literal(Value::Id(text.clone())),
                TypeKind::Enum { variants } if !variants.contains(text) => {
                    return Err(type_error(site, format!("'{text}' is not one of {}.{column}'s variants {}", read.table, variants.iter().map(|v| format!("'{v}'")).collect::<Vec<_>>().join(", ")), format!("'{}'", variants.first().cloned().unwrap_or_default())));
                }
                _ => {}
            }
        }
    }
    Ok((read.table.clone(), index.name, ordered, equalities))
}

fn title(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// The columns of a generated maintain target: `id`, `value`, and the `by`
/// columns typed as the source declares them.
pub fn maintain_target(source: &TableInfo, maintain: &MaintainDecl) -> Fallible<TableDecl> {
    let site = maintain.site.clone();
    if source.maintained.is_some() { return Err(super::maintains::refusal(&site, "a maintain cannot use another maintain as its source", "define the view over application source rows, or use a job sweep")); }
    let mut columns = Vec::new();
    let value_type = match &maintain.column {
        None => ScalarType { kind: TypeKind::Int, optional: false },
        Some(column) => match source.columns.get(column) {
            Some(ty) if matches!(ty.kind, TypeKind::Int | TypeKind::Decimal { .. } | TypeKind::Money { .. }) => ty.required(),
            Some(ty) => return Err(type_error(&site, format!("sum over {}.{column} needs int, decimal or money, not {}", maintain.source, crate::print::scalar_type(ty)), format!("view {}: count {} by {}", maintain.name, maintain.source, maintain.keys.iter().map(|key| super::maintains::bare_key(key).map_or_else(|| crate::print::expression(key), |name| format!(".{name}"))).collect::<Vec<_>>().join(", ")))),
            None => return Err(unknown(&site, format!("sum names unknown column {}.{column}", maintain.source), name_rewrite(column, source.columns.keys().map(String::as_str), None))),
        },
    };
    columns.push(ColumnDecl { sequence: None, written_by: None, readable_by_audience: false, maintained: None, default: None, name: "value".into(), type_: value_type, site: site.clone() });
    let computed = super::maintains::keys(&source, maintain)?;
    let aliases = super::maintains::inherited_aliases(source,maintain);
    if let Some(expr) = &maintain.filter { super::maintains::predicate(&source, expr)?; }
    for field in &maintain.by {
        let ty = if computed.contains_key(field) { ScalarType { kind: TypeKind::Int, optional: computed[field].column.contains('.') } } else { source.columns[aliases.get(field).unwrap_or(field)].clone() };
        columns.push(ColumnDecl { sequence: None, written_by: None, readable_by_audience: false, maintained: None, default: None, name: field.clone(), type_: ty, site: site.clone() });
    }
    let mut indexes = vec![IndexDecl { name: "byGroup".into(), columns: maintain.by.clone(), unique: true, refusal: None, words: None, computed: BTreeMap::new(), site: site.clone() }];
    let mut names = BTreeSet::from(["byGroup".to_owned(), "byId".to_owned()]);
    for index in &maintain.indexes {
        if !names.insert(index.name.clone()) { return Err(super::maintains::refusal(&index.site, format!("duplicate maintain index {}", index.name), "use a distinct index name; byGroup and byId are generated")); }
        let index = index.clone();
        if index.columns.contains(&"value".into()) {
            // @ref LLP 3000.007#20.21 — stored order is stale; the sound server count upper-bound threshold read is not built.
            if source.decl.expire.is_some() || source.through.as_ref().is_some_and(|t| t.expiring) { return Err(Diagnostic::new(&index.site, "E_QUARRY_MAINTAIN_EXPIRE", format!("maintain {} cannot order by value because source {} expires: stored order is stale before the physical sweep, so taking stored top-N can miss a live winner; a count upper-bound threshold scan is not built", maintain.name, maintain.source), "for an entity-time window over a non-expiring source, use the Trending predicate in guide feeds; for expiring contributions, stream each candidate's live count and rank only a complete candidate domain; a meter cut makes the ranking incomplete").guide("feeds")); }
            // @ref LLP 3000.007#14 — ruling 41's interim retires with maintained columns.
            let value_at = index.columns.iter().position(|field| field == "value").unwrap();
            let fields = index.columns.iter().collect::<BTreeSet<_>>();
            if !index.is_plain() || fields.len() != index.columns.len()
                || index.columns[value_at..] != ["value", "id"]
                || index.columns[..value_at].iter().any(|field| !maintain.by.contains(field)) {
                return Err(super::maintains::refusal(&index.site,
                    "a maintain value index is a prefix of group fields, then value, id; fields cannot repeat",
                    "end this index with value, id; for post-time ties declare likeCount: count likes on posts, then read posts last 20 by .likeCount, .at after c (guide maintains)"));
            }
        }
        indexes.push(index);
    }
    Ok(TableDecl {
        receipts: None,
        ephemeral: None,
        search: Vec::new(),
        name: maintain.name.clone(),
        columns,
        indexes,
        rules: maintain.read.iter().cloned().collect(),
        immutable: Vec::new(),
        caps: Vec::new(),
        final_exists: Vec::new(),
        retain: None,
        public: None,
        sync: None,
        online_only: maintain.online_only,
        expire: None,
        site,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn quarry_refuses_nullable_target_sync_group_keys() {
        let source = r#"
table memberships:
  room: id ?
  principal: principal
  unique byRoomPrincipal: room, principal
  by byPrincipalRoom: principal, room, id
  read <- .principal = viewer
table messages:
  room: id
  body: text <=100
  by byRoom: room, id
  read <- exists memberships[.room, viewer]
  sync to memberships[.room]
"#;
        let refused = crate::compile(&[("schema.q".into(), source.into())]);
        assert!(refused.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_SYNC" && diagnostic.guide == "sync" && diagnostic.message.contains("needs required group keys") && diagnostic.rewrite.contains("remove `?`")), "{:?}", refused.diagnostics);
        let accepted = crate::compile(&[("schema.q".into(), source.replace("room: id ?", "room: id"))]);
        assert!(accepted.diagnostics.is_empty(), "{:?}", accepted.diagnostics);
    }

    // LLP 3000.036 §1 A: the rule in source form, the paved split, and no "make it public".
    #[test]
    fn e_sync_quotes_the_source_rule_and_names_the_split() {
        let sync = |rule: &str, sync: &str| {
            let source = format!("table claims:\n  claimant: principal\n  postedBy: principal\n  approved: bool\n  read <- {rule}\n  insert <- .postedBy = viewer\n  {sync}\n");
            let bound = crate::compile(&[("schema.q".into(), source)]);
            bound.diagnostics.into_iter().find(|d| d.code == "E_SYNC").expect("E_SYNC")
        };
        let two = sync(".claimant = viewer or .postedBy = viewer", "sync to .claimant");
        assert!(two.message.contains("`read <- .claimant = viewer or .postedBy = viewer`"), "{}", two.message);
        assert!(two.message.contains("do not make private rows public"), "{}", two.message);
        assert!(two.rewrite.contains("`table claimsParties:`") && two.rewrite.contains("`read <- exists claimsParties[.id, viewer]`") && two.rewrite.contains("`after insert <- exists claimsParties[item = .id, party = .claimant]`") && two.rewrite.contains("`online only`"), "{}", two.rewrite);
        let shared = sync(".approved or .postedBy = viewer", "sync");
        assert!(shared.message.contains("`read <- .approved or .postedBy = viewer`") && !shared.message.contains("Bool"), "{}", shared.message);
        assert!(shared.rewrite.contains("`public '..'` table") && shared.rewrite.contains("`.postedBy = viewer`"), "{}", shared.rewrite);
        // The split the rewrite names compiles.
        let split = "table claims:\n  claimant: principal\n  postedBy: principal\n  read <- exists claimsParties[.id, viewer]\n  insert <- .postedBy = viewer\n  after insert <- exists claimsParties[item = .id, party = .claimant]\n  after insert <- exists claimsParties[item = .id, party = .postedBy]\n  sync\ntable claimsParties:\n  item: claims\n  party: principal\n  unique item, party\n  immutable item, party\n  read <- exists claimsParties[.item, viewer]\n  insert <- created claims[.item]\n  sync\n";
        let bound = crate::compile(&[("schema.q".into(), split.into())]);
        assert!(bound.diagnostics.iter().all(|d| !d.code.starts_with("E_")), "{:?}", bound.diagnostics);
    }
}

#[path = "rule_reference.rs"]
mod reference;
use reference::rule_reference;
