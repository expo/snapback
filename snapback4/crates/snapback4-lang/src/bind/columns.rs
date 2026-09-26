//! The column form lowers to an ordinary private Maintain plus table metadata.
// @ref LLP 3000.007.001#2 — one source reference; ordinary program indexes remain readable.
use super::catalog::{Catalog, TableInfo};
use crate::{ast::*, diag::{Diagnostic, Site}};
use snapback4_core::schema::{self as core, columns::{ColumnOwner, GROUP}};
use std::collections::BTreeMap;

pub fn refusal(site: &Site, message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site,"E_MAINTAINED_COLUMN",message,"write the source rows, or use a separate view for this aggregate").guide("maintains")
}

pub fn resolve(tables: &mut BTreeMap<String,TableInfo>, diagnostics: &mut Vec<Diagnostic>) {
    let declarations = tables.clone();
    for (name,info) in tables {
        for column in &mut info.decl.columns {
            let Some(aggregate) = &mut column.maintained else { continue };
            let Some(source) = declarations.get(&aggregate.source) else {
                diagnostics.push(refusal(&column.site,format!("{name}.{} names unknown ordinary source {}",column.name,aggregate.source))); continue;
            };
            // @ref LLP 3000.013#3.2 — infer only a unique reference to the owning table.
            if aggregate.by.is_empty() {
                let candidates: Vec<_> = source.columns.iter().filter_map(|(field, kind)|
                    (kind.kind == TypeKind::Ref { table: name.clone() }).then_some(field.clone())).collect();
                if let [reference] = candidates.as_slice() {
                    aggregate.by = reference.clone();
                } else {
                    let by = candidates.first().map_or("postId", String::as_str);
                    let mut form = aggregate.of.as_ref().map_or_else(|| format!("count {}", aggregate.source), |of| format!("sum {} of .{of}", aggregate.source));
                    if let Some(filter) = &aggregate.filter { form.push_str(&format!(" where {}", crate::print::expression(filter))); }
                    diagnostics.push(Diagnostic::new(&column.site, "E_MAINTAINED_COLUMN_REFERENCE",
                        format!("{name}.{} needs exactly one reference from {} to {name}; candidates: {}", column.name, aggregate.source,
                            if candidates.is_empty() { "none".into() } else { candidates.join(", ") }),
                        format!("{}: {form} by {by}{}", column.name, if candidates.is_empty() { format!("; declare {by}: {name} on {}", aggregate.source) } else { String::new() })).guide("maintains"));
                    continue;
                }
            } else {
                aggregate.by = aggregate.by.trim_start_matches('.').to_owned();
            }
            if source.decl.expire.is_some() || source.through.as_ref().is_some_and(|t| t.expiring) {
                diagnostics.push(refusal(&column.site,format!("{name}.{} cannot use expiring source {}; use a separate maintain, which reads live contributions",column.name,aggregate.source)));
            }
            if !source.columns.get(&aggregate.by).is_some_and(|kind| kind.kind == TypeKind::Ref { table: name.clone() }) {
                diagnostics.push(refusal(&column.site,format!("{name}.{} needs {}.{} to reference {name}",column.name,aggregate.source,aggregate.by)));
            }
            if let Some(of) = &aggregate.of {
                match source.columns.get(of) {
                    Some(kind) if !kind.optional && matches!(kind.kind,TypeKind::Int | TypeKind::Decimal { .. } | TypeKind::Money { .. }) => {
                        column.type_ = kind.clone();
                        info.columns.insert(column.name.clone(),kind.clone());
                    },
                    _ => diagnostics.push(refusal(&column.site,format!("{name}.{} sums a required int, decimal or money column; {}.{of} does not fit",column.name,aggregate.source))),
                }
            }
        }
    }
}

pub fn recorded(tables: &mut BTreeMap<String,TableInfo>, diagnostics: &mut Vec<Diagnostic>) {
    let declarations = tables.values().flat_map(|t|t.decl.columns.iter().filter_map(|c|c.maintained.as_ref().map(|a|(t.decl.name.clone(),c.clone(),a.clone())))).collect::<Vec<_>>();
    for (table,column,a) in declarations {
        let decl = MaintainDecl { row_key: None, name:format!("{table}.{}",column.name), aggregate:if a.of.is_some() { "sum" } else { "count" }.into(),
            source:a.source.clone(),column:a.of,by:vec![a.by.clone()],keys:vec![Expr::Name {name:a.by,site:column.site.clone()}],filter:a.filter,
            indexes:vec![],read:Some(RuleDecl {effect:Effect::Read,bindings:vec![],value:Expr::Name {name:"deny".into(),site:column.site.clone()},site:column.site.clone()}),online_only:true,site:column.site };
        match super::maintains::recorded_paths(tables,&decl) {
            Ok(paths) => if let Some(source) = tables.get_mut(&decl.source) {source.recorded.extend(paths)},
            Err(d) => diagnostics.push(d),
        }
    }
}

pub fn lower(catalog: &Catalog, schema: &mut core::Schema, diagnostics: &mut Vec<Diagnostic>) {
    for (name,info) in &catalog.tables {
        for column in &info.decl.columns {
            let Some(a) = &column.maintained else { continue };
            let Some(source) = catalog.tables.get(&a.source) else { continue };
            let mut source = source.clone();
            source.columns.extend(source.recorded.clone());
            let filter = match a.filter.as_ref().map(|p| super::maintains::predicate(&source,p)).transpose() {
                Ok(filter) => filter, Err(d) => { diagnostics.push(d); continue; }
            };
            let Some(reference_type) = schema.table(&a.source).and_then(|t|t.columns.get(&a.by)).cloned() else { continue };
            let owner = ColumnOwner { table: name.clone(), column: column.name.clone() };
            let target = owner.target();
            let m = core::Maintain { row_key: None, parent_key: None, aliases: Default::default(), private: Some(owner), source: a.source.clone(), target: target.clone(), by: vec![a.by.clone()],
                kind: a.of.as_ref().map_or(core::MaintainKind::Count, |of|core::MaintainKind::Sum { of: of.clone() }),
                filter, computed: BTreeMap::new(), residency: core::Residency { online_only: true, ..Default::default() }, readable: None };
            let parent = schema.tables.get_mut(name).expect("bound parent");
            parent.maintained.insert(column.name.clone(),m.derivation_identity());
            let value_type = parent.columns[&column.name].clone();
            let mut table = core::public_table(BTreeMap::from([("id".into(),core::ColumnType::Id),(GROUP.into(),reference_type),("value".into(),value_type)]),
                BTreeMap::from([("byId".into(),core::Index::of(&["id"],true)),("byGroup".into(),core::Index::of(&[GROUP],true))]));
            table.rules = core::Rules::deny();
            table.residency.online_only = true;
            schema.tables.insert(target,table);
            schema.maintains.push(m);
        }
    }
}

pub fn fields(info: &TableInfo) -> impl Iterator<Item = &str> {
    info.decl.columns.iter().filter(|c|c.maintained.is_some()).map(|c|c.name.as_str())
}

pub fn notes(catalog: &Catalog, schema: &core::Schema) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    for (name,parent) in schema.visible_tables().filter(|(_,t)| !t.maintained.is_empty()) {
        if parent.sync.is_some() {
            notes.push(Diagnostic::new(&catalog.site_for(&format!("tables.{name}.sync")),"N_MAINTAINED_COLUMN_STREAM",
                format!("{name}: each contributing commit logs and streams the whole parent image per destination partition, coalesced once per row; a 4,000-byte parent costs every holder about 4 KB per change"),
                "use a column when readers want the count with the row; for a large row or a counter changing far more often than it is read, use a view with online only").guide("maintains"));
        }
    }
    for m in schema.maintains.iter().filter(|m|m.private.is_some()) {
        let owner = m.private.as_ref().unwrap();
        let source = &schema.tables[&m.source];
        let parent = &schema.tables[&owner.table];
        // Source write authority is deliberately irrelevant to this proof.
        if source.rules.read.is_uniformly_readable() || parent.rules.read == core::RuleExpr::Deny || source.through.as_ref().is_some_and(|t| t.parent == owner.table && m.by == [t.reference.clone()] && !source.is_expiring()) { continue }
        let indexed = parent.indexes.values().any(|i|i.columns().contains(&owner.column));
        notes.push(Diagnostic::new(&catalog.site_for(&format!("tables.{}.columns.{}",owner.table,owner.column)),"N_MAINTAINED_COLUMN_DISCLOSURE",
            format!("{} discloses the {} of {}{} rows to every parent reader{}; parent readers are not proven able to read those source rows; source writers can observe aggregate overflow",owner.label(),
                if matches!(m.kind,core::MaintainKind::Count) { "count" } else { "sum" },if m.filter.is_some() { "predicate-selected " } else { "" },m.source,
                if indexed { ", and its index discloses relative order" } else { "" }),
            "keep this declared disclosure only when the parent audience should know the aggregate; otherwise restrict parent readers or use a separate maintain").guide("maintains"));
    }
    notes
}
