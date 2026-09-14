//! The catalog: every table (declared or generated for a maintain) with its
//! columns and indexes, plus the named shapes and functions, and where each
//! schema path was declared so a core validation issue can point at a line.

use crate::ast::*;
use crate::diag::{Diagnostic, Site, name_rewrite, unknown};
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
pub struct TableInfo {
    pub decl: TableDecl,
    pub columns: BTreeMap<String, ScalarType>,
    pub indexes: Vec<IndexDecl>,
    /// Set when the table is a maintain's generated target.
    pub maintained: Option<MaintainDecl>,
}

pub struct Catalog {
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
                let mut indexes = vec![IndexDecl { name: "byId".into(), columns: vec!["id".into()], unique: true, words: None, site: table.site.clone() }];
                for index in &table.indexes {
                    if indexes.iter().any(|existing| existing.name == index.name) {
                        diagnostics.push(unknown(&index.site, format!("duplicate index {}.{}", table.name, index.name), "name one ordering explicitly"));
                        ok = false;
                        continue;
                    }
                    for column in &index.columns {
                        if column != "id" && !columns.contains_key(column) {
                            diagnostics.push(crate::diag::type_error(&index.site, format!("index {}.{} names unknown column {column}", table.name, index.name), name_rewrite(column, columns.keys().map(String::as_str).chain(["id"]), None)));
                            ok = false;
                        }
                    }
                    for field in index.words.iter().flat_map(|(_, fields)| fields) {
                        match columns.get(field) {
                            Some(ScalarType { kind: TypeKind::Text { .. }, .. }) => {}
                            // The table stays in the catalog: one line is
                            // wrong, and its readers should hear about that
                            // line, not about a table that vanished.
                            Some(other) => diagnostics.push(crate::diag::type_error(&index.site, format!("index {}.{} tokenizes {field}, which is {}, not text", table.name, index.name, crate::print::scalar_type(other)), format!("words(<a text column of {}>)", table.name))),
                            None => diagnostics.push(crate::diag::type_error(&index.site, format!("index {}.{} tokenizes unknown column {field}", table.name, index.name), name_rewrite(field, columns.keys().map(String::as_str), None))),
                        }
                    }
                    indexes.push(index.clone());
                }
                let mut seen_effects = std::collections::BTreeSet::new();
                for rule in &table.rules {
                    if !seen_effects.insert(rule.effect) {
                        diagnostics.push(unknown(&rule.site, format!("duplicate {} rule on {}", rule.effect.word(), table.name), "keep one rule per effect"));
                        ok = false;
                    }
                }
                if ok {
                    tables.insert(table.name.clone(), TableInfo { decl: table.clone(), columns, indexes, maintained: None });
                }
            }
            for maintain in &doc.maintains {
                if tables.contains_key(&maintain.name) || maintains.contains_key(&maintain.name) {
                    diagnostics.push(unknown(&maintain.site, format!("maintain {} collides with a table of the same name", maintain.name), "rename the maintain"));
                    continue;
                }
                maintains.insert(maintain.name.clone(), maintain.clone());
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
        // Generated maintain targets join the catalog as tables.
        let names: Vec<String> = maintains.keys().cloned().collect();
        for name in names {
            let maintain = maintains[&name].clone();
            let Some(source) = tables.get(&maintain.source).cloned() else {
                diagnostics.push(unknown(&maintain.site, format!("maintain names unknown source table {}", maintain.source), name_rewrite(&maintain.source, tables.keys().map(String::as_str), None)));
                continue;
            };
            match super::schema::maintain_target(&source, &maintain) {
                Ok(decl) => {
                    let columns: BTreeMap<String, ScalarType> = decl.columns.iter().map(|c| (c.name.clone(), c.type_.clone())).collect();
                    let mut indexes = vec![IndexDecl { name: "byId".into(), columns: vec!["id".into()], unique: true, words: None, site: decl.site.clone() }];
                    indexes.extend(decl.indexes.iter().cloned());
                    tables.insert(name.clone(), TableInfo { decl, columns, indexes, maintained: Some(maintain) });
                }
                Err(diagnostic) => diagnostics.push(diagnostic),
            }
        }
        Self { documents, tables, maintains, shapes, functions, effects }
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
                    if let Some(r) = info.decl.rules.iter().find(|r| r.effect.word() == *effect) {
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
