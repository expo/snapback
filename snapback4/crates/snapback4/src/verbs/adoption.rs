//! Locate the store's successor refusals in the author's current sources.
use crate::project::Project;
use snapback4_core::{Schema, Store};
use snapback4_core::successor::Change;
use snapback4_lang::{Diagnostic, Site};
use std::collections::BTreeMap;
use std::path::PathBuf;

pub(super) fn diagnostics(project: &Project, schema: &Schema, explicit: Option<&String>) -> Result<Vec<Diagnostic>, String> {
    let path = explicit.map(PathBuf::from).unwrap_or_else(|| project.store_path());
    if explicit.is_none() && !path.exists() { return Ok(Vec::new()); }
    let mut store = Store::open_read_only(&path).map_err(|e| e.to_string())?;
    let steps = store.successor(schema).map_err(|e| e.to_string())?;
    if !steps.iter().any(|s| s.change == Change::Narrowing) { return Ok(Vec::new()); }
    let mut sites = BTreeMap::new();
    for (file, source) in project.sources().map_err(|e| e.to_string())? {
        let (document, _) = snapback4_lang::parse_document(&file, &source);
        for table in document.tables {
            let path = format!("tables.{}", table.name);
            sites.insert(path.clone(), table.site);
            for column in table.columns { sites.insert(format!("{path}.columns.{}", column.name), column.site); }
            for index in table.indexes { sites.insert(format!("{path}.indexes.{}", index.name), index.site); }
        }
    }
    Ok(steps.iter().filter(|s| s.change == Change::Narrowing).map(|step| {
        let table = step.path.split('.').take(2).collect::<Vec<_>>().join(".");
        let site = sites.get(&step.path).or_else(|| sites.get(&table)).cloned().unwrap_or_else(|| Site::new("schema.q", 1, 1));
        Diagnostic::new(&site, "E_ADOPT", &step.message, step.rewrite(schema)).guide("types")
    }).collect())
}
