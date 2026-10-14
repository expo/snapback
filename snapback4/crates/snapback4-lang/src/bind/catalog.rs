//! The catalog: every table (declared or generated for a maintain) with its
//! columns and indexes, plus the named shapes and functions, and where each
//! schema path was declared so a core validation issue can point at a line.

use crate::ast::*;
use crate::diag::{Diagnostic, Site, name_rewrite, unknown};
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
pub struct TableInfo {
    pub through: Option<snapback4_core::schema::through::Through>,
    pub captures: BTreeMap<String, ScalarType>,
    pub recorded: BTreeMap<String, ScalarType>,
    pub decl: TableDecl,
    pub columns: BTreeMap<String, ScalarType>,
    pub indexes: Vec<IndexDecl>,
    /// Set when the table is a maintain's generated target.
    pub maintained: Option<MaintainDecl>,
}

impl TableInfo {
    pub fn total_unique(&self, index: &IndexDecl) -> bool {
        index.unique && index.is_plain() && index.columns.iter().all(|column| column == "id" || self.columns.get(column).is_some_and(|ty| !ty.optional))
    }

    // @ref LLP 3000.013#2.1 — a scan cursor carries declared components only;
    // uniqueness with a nullable component cannot resolve ties between nulls.
    pub fn total_cursor(&self, index: &IndexDecl) -> bool {
        index.columns.iter().any(|column| column == "id") || index.unique && index.words.is_none()
            && index.columns.iter().all(|column| match index.computed.get(column) {
                Some(expr) => super::time_indexes::key(&self.decl.name, &self.columns, column, expr).is_ok(),
                None => self.columns.get(column).is_some_and(|ty| !ty.optional),
            })
    }
}

#[derive(Default)]
pub struct Catalog {
    pub ordinary_searches: Vec<String>,
    pub source: crate::source::SourceMap,
    pub feed_views: BTreeMap<String, super::feed_view::Plan>,
    pub extremum_domains: BTreeMap<String, ReadExpr>,
    pub read_origins: BTreeMap<String, String>,
    pub canonical_read_origins: BTreeMap<String, String>,
    pub view_reads: BTreeMap<String, crate::ast::MergeExpr>,
    pub view_types: BTreeMap<String, crate::types::Ty>,
    pub planner_notes: Vec<Diagnostic>,
    /// Exact cap declarations that would admit an otherwise fully verified
    /// owner-or-membership page, keyed by the read's source site.
    pub membership_cap_repairs: BTreeMap<String, String>,
    pub synthesized: std::collections::BTreeSet<(String, String)>,
    pub documents: Vec<Document>,
    pub tables: BTreeMap<String, TableInfo>,
    pub maintains: BTreeMap<String, MaintainDecl>,
    pub shapes: BTreeMap<String, ShapeDecl>,
    pub functions: BTreeMap<String, FunctionDecl>,
    pub effects: BTreeMap<String, String>,
}

impl Catalog {
    pub fn build(documents: Vec<Document>, diagnostics: &mut Vec<Diagnostic>) -> Self {
        let mut tables: BTreeMap<String, TableInfo> = BTreeMap::new();
        let mut maintains = BTreeMap::new();
        let mut shapes: BTreeMap<String, ShapeDecl> = BTreeMap::new();
        let mut functions: BTreeMap<String, FunctionDecl> = BTreeMap::new();
        let mut effects = BTreeMap::new();
        let mut effect_sites: BTreeMap<String, Site> = BTreeMap::new();
        for doc in &documents {
            for table in &doc.tables {
                if tables.contains_key(&table.name) {
                    diagnostics.push(unknown(&table.site, format!("duplicate table {}", table.name), "rename one of the two tables"));
                    continue;
                }
                let mut columns = BTreeMap::new();
                let mut ok = true;
                for column in &table.columns {
                    if column.name == "id" {
                        diagnostics.push(unknown(&column.site, format!("table {} gets id implicitly; remove the id column", table.name), "delete this line"));
                        ok = false;
                        continue;
                    }
                    if columns.insert(column.name.clone(), column.type_.clone()).is_some() {
                        diagnostics.push(unknown(&column.site, format!("duplicate column {}.{}", table.name, column.name), "rename one of the two columns"));
                        ok = false;
                    }
                }
                for field in &table.search {
                    if !matches!(columns.get(field), Some(ScalarType { kind: TypeKind::Text { .. } | TypeKind::Enum { .. }, .. })) {
                        diagnostics.push(crate::diag::type_error(&table.site, format!("search {} requires a text or enum column on {}", field, table.name), format!("declare `{field}: text <=2000` or `{field}: enum('one', 'two')` before `search {field}`")).guide("search"));
                    }
                }
                let mut indexes = vec![IndexDecl { name: "byId".into(), columns: vec!["id".into()], unique: true, refusal: None, words: None, computed: BTreeMap::new(), site: table.site.clone() }];
                for index in &table.indexes {
                    if indexes.iter().any(|existing| existing.name == index.name) {
                        diagnostics.push(unknown(&index.site, format!("duplicate index {}.{}", table.name, index.name), "name one ordering explicitly"));
                        ok = false;
                        continue;
                    }
                    for column in &index.columns {
                        if index.computed.contains_key(column) { continue; }
                        if column != "id" && !columns.contains_key(column) {
                            diagnostics.push(crate::diag::type_error(&index.site, format!("index {}.{} names unknown column {column}", table.name, index.name), name_rewrite(column, columns.keys().map(String::as_str).chain(["id"]), None)));
                            ok = false;
                        }
                    }
                    for field in index.words.iter().flat_map(|(_, fields)| fields) {
                        match columns.get(field) {
                            Some(ScalarType { kind: TypeKind::Text { .. } | TypeKind::Enum { .. }, .. }) => {}
                            // The table stays in the catalog: one line is
                            // wrong, and its readers should hear about that
                            // line, not about a table that vanished.
                            Some(other) => diagnostics.push(crate::diag::type_error(&index.site, format!("index {}.{} tokenizes {field}, which is {}, not text or enum", table.name, index.name, crate::print::scalar_type(other)), format!("words(<a text or enum column of {}>)", table.name))),
                            None => diagnostics.push(crate::diag::type_error(&index.site, format!("index {}.{} tokenizes unknown column {field}", table.name, index.name), name_rewrite(field, columns.keys().map(String::as_str), None))),
                        }
                    }
                    for (name, expr) in &index.computed {
                        if let Err(error) = super::time_indexes::key(&table.name, &columns, name, expr) { diagnostics.push(error); }
                    }
                    indexes.push(index.clone());
                }
                let mut seen_effects = std::collections::BTreeSet::new();
                for rule in &table.rules {
                    if !seen_effects.insert(rule.effect) {
                        if rule.effect == Effect::Read && table.rules.iter().any(|r| matches!(&r.value,Expr::Call{name,..} if name=="$readThrough")) {
                            diagnostics.push(Diagnostic::new(&rule.site,"E_READ_THROUGH",format!("{} declares another read rule beside read through",table.name),"keep read through as the whole read rule; put service grants on the parent").guide("rules"));
                        } else { diagnostics.push(unknown(&rule.site, format!("duplicate {} rule on {}", rule.effect.word(), table.name), "keep one rule per effect")); }
                        ok = false;
                    }
                }
                if ok {
                    let mut decl = table.clone();
                    // @ref LLP 3000.036.002#9 — rejected search metadata must not erase the usable table symbol.
                    // An invalid search field is a fault of that search line,
                    // not evidence that every later reference names an
                    // unknown table. Keep the usable table symbol and omit
                    // only search fields that could not be indexed.
                    decl.search.retain(|field| matches!(columns.get(field), Some(ScalarType { kind: TypeKind::Text { .. } | TypeKind::Enum { .. }, .. })));
                    // @ref LLP 3000.015#2 — catalog consumers see the same
                    // implicit immutability as runtime schema consumers.
                    for column in &table.columns {
                        if let Some(parent) = &column.sequence {
                            decl.immutable.push((vec![column.name.clone(), parent.clone()], column.site.clone()));
                        }
                    }
                    tables.insert(table.name.clone(), TableInfo { through: None, captures: BTreeMap::new(), recorded: BTreeMap::new(), decl, columns, indexes, maintained: None });
                }
            }
            for maintain in &doc.maintains {
                if tables.contains_key(&maintain.name) || maintains.contains_key(&maintain.name) {
                    diagnostics.push(unknown(&maintain.site, format!("maintain {} collides with a table of the same name", maintain.name), "rename the aggregate view"));
                    continue;
                }
                let mut maintain = maintain.clone();
                super::maintains::normalize_keys(&mut maintain);
                maintains.insert(maintain.name.clone(), maintain);
            }
            for shape in &doc.shapes {
                if let Some(first) = shapes.get(&shape.name) {
                    diagnostics.push(unknown(&shape.site, format!("duplicate shape {}; first declared at {}", shape.name, first.site), "rename one shape"));
                    continue;
                }
                shapes.insert(shape.name.clone(), shape.clone());
            }
            for function in &doc.functions {
                if let Some(first) = functions.get(&function.name) {
                    diagnostics.push(unknown(&function.site, format!("duplicate fn {}; first declared at {}", function.name, first.site), "rename one function"));
                    continue;
                }
                // @ref LLP 3000.040#12-surface — a bound belongs to a slot a value enters (a column or an operation's argument); a helper is inlined and has none.
                for param in &function.args {
                    if let Some((min, max)) = int_range_of(&param.type_) {
                        let range = snapback4_core::schema::int_range_text(min, max);
                        diagnostics.push(crate::diag::type_error(&param.site, format!("{}'s parameter {} cannot be {range}: a helper is inlined, so no value crosses a boundary where the bound is checked", function.name, param.name),
                            format!("declare `{}: int` and bound the operation's argument or the stored column as {range}", param.name)).guide("types"));
                    }
                }
                functions.insert(function.name.clone(), function.clone());
            }
            for effect in &doc.effects {
                if let Some(first) = effect_sites.get(&effect.name) {
                    diagnostics.push(unknown(&effect.site, format!("duplicate effect {}; first declared at {first}", effect.name), "rename one effect"));
                    continue;
                }
                effect_sites.insert(effect.name.clone(), effect.site.clone());
                effects.insert(effect.name.clone(), effect.module.clone());
            }
        }
        super::through::expand(&mut tables, diagnostics);
        for maintain in maintains.values_mut() { if let Some(source)=tables.get(&maintain.source) { super::maintains::inherited_keys(source,maintain); } }
        super::columns::resolve(&mut tables, diagnostics);
        super::columns::recorded(&mut tables, diagnostics);
        // Resolve every path against application declarations before generating any target.
        for maintain in maintains.values().filter(|m|m.row_key.is_none()) {
            match super::maintains::recorded_paths(&tables, maintain) {
                Ok(paths) => { if let Some(source) = tables.get_mut(&maintain.source) { source.recorded.extend(paths); } }
                Err(diagnostic) => diagnostics.push(diagnostic),
            }
        }
        // Generated maintain targets join the catalog as tables.
        let names: Vec<String> = maintains.keys().cloned().collect();
        for name in names {
            let maintain = maintains[&name].clone();
            let Some(mut source) = tables.get(&maintain.source).cloned() else {
                diagnostics.push(unknown(&maintain.site, format!("maintain names unknown source table {}", maintain.source), name_rewrite(&maintain.source, tables.keys().map(String::as_str), None)));
                continue;
            };
            source.columns.extend(source.recorded.clone());
            source.columns.extend(source.captures.clone());
            match if maintain.row_key.is_some() { super::row_views::target(&tables, &maintain) } else { super::schema::maintain_target(&source, &maintain) } {
                Ok(decl) => {
                    let columns: BTreeMap<String, ScalarType> = decl.columns.iter().map(|c| (c.name.clone(), c.type_.clone())).collect();
                    let mut indexes = vec![IndexDecl { name: "byId".into(), columns: vec!["id".into()], unique: true, refusal: None, words: None, computed: BTreeMap::new(), site: decl.site.clone() }];
                    indexes.extend(decl.indexes.iter().cloned());
                    tables.insert(name.clone(), TableInfo { through: None, captures: BTreeMap::new(), recorded: BTreeMap::new(), decl, columns, indexes, maintained: Some(maintain) });
                }
                Err(diagnostic) => diagnostics.push(diagnostic),
            }
        }
        let mut source = crate::source::SourceMap::default();
        for document in &documents { source.extend(&document.source); }
        let mut catalog = Self { ordinary_searches: Vec::new(), extremum_domains: BTreeMap::new(), canonical_read_origins: BTreeMap::new(), source, feed_views: BTreeMap::new(), read_origins: BTreeMap::new(), view_reads: BTreeMap::new(), view_types: BTreeMap::new(), documents, tables, maintains, shapes, functions, effects, synthesized: Default::default(), planner_notes: Vec::new(), membership_cap_repairs: BTreeMap::new() };
        for maintain in catalog.maintains.values().filter(|m| m.read.is_none() && m.row_key.is_none()) {
            // A colliding ordinary table can exist even when target generation failed.
            if !catalog.tables.get(&maintain.name).is_some_and(|info| info.maintained.is_some()) { continue; }
            match super::maintains::derived_read(&catalog, maintain) {
                Ok(read) => catalog.tables.get_mut(&maintain.name).unwrap().decl.rules.push(read),
                Err(diagnostic) => diagnostics.push(diagnostic),
            }
        }
        catalog
    }

    /// The declaration site behind a schema validation path.
    pub fn site_for(&self, path: &str) -> Site {
        let mut parts = path.split('.');
        if parts.next() == Some("tables")
            && let Some(table) = parts.next()
            && let Some(info) = self.tables.get(table)
        {
            let rest: Vec<&str> = parts.collect();
            match rest.as_slice() {
                ["columns", column] => {
                    if let Some(c) = info.decl.columns.iter().find(|c| &c.name == column) {
                        return c.site.clone();
                    }
                }
                ["indexes", index] => {
                    if let Some(i) = info.indexes.iter().find(|i| &i.name == index) {
                        return i.site.clone();
                    }
                }
                ["rules", effect] => {
                    let effect = match *effect { "insert-if-absent" | "insert if absent" => "insert", effect => effect };
                    if let Some(r) = info.decl.rules.iter().find(|r| r.effect.word() == effect) {
                        return r.site.clone();
                    }
                }
                ["sync"] => {
                    if let Some(sync) = &info.decl.sync {
                        return sync.site.clone();
                    }
                }
                _ => {}
            }
            return info.decl.site.clone();
        }
        if path.starts_with("maintains[")
            && let Some(position) = path.strip_prefix("maintains[").and_then(|p| p.split(']').next()).and_then(|p| p.parse::<usize>().ok())
            && let Some(maintain) = self.maintains.values().nth(position)
        {
            return maintain.site.clone();
        }
        self.documents.first().map(|d| Site::new(&d.file, 1, 1)).unwrap_or_default()
    }
}

fn int_range_of(ty: &crate::ast::ScalarType) -> Option<(Option<i64>, Option<i64>)> {
    match &ty.kind {
        crate::ast::TypeKind::IntRange { min, max } => Some((*min, *max)),
        crate::ast::TypeKind::List { item, .. } => int_range_of(item),
        _ => None,
    }
}
