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
        for maintain in document.maintains {
            if let Some(position) = schema.maintains.iter().position(|m| m.target == maintain.name) {
                sites.insert(format!("maintains[{position}]"), maintain.site);
            }
        }
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

/// Read the live host through its address record's listener port. A
/// store identity check prevents a stale port from inspecting another project.
pub(super) fn host(project: &Project, store_id: &str) -> Option<serde_json::Value> {
    use std::{io::{Read, Write}, net::{Ipv4Addr, TcpStream}, time::Duration};
    let port = crate::store_owner::inspector_port(&project.store_path())?;
    let mut stream = TcpStream::connect_timeout(&(Ipv4Addr::LOCALHOST, port).into(), Duration::from_millis(200)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(1))).ok()?;
    stream.set_write_timeout(Some(Duration::from_secs(1))).ok()?;
    write!(stream, "GET /dev/status HTTP/1.1\r\nHost: localhost:{port}\r\nConnection: close\r\n\r\n").ok()?;
    let mut reply = String::new(); stream.take(65_536).read_to_string(&mut reply).ok()?;
    let (head, body) = reply.split_once("\r\n\r\n")?;
    if !head.starts_with("HTTP/1.1 200 ") { return None; }
    let status: serde_json::Value = serde_json::from_str(body).ok()?;
    (status["storeId"].as_str() == Some(store_id)).then_some(status)
}
