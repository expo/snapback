//! Locate the store's successor refusals in the author's current sources.
use crate::project::Project;
use snapback4_core::{Schema, Store};
use snapback4_core::successor::Change;
use snapback4_lang::{Diagnostic, Site};
use std::collections::BTreeMap;
use std::path::PathBuf;

pub(super) fn diagnostics(project: &Project, schema: &Schema, explicit: Option<&String>, detailed:bool) -> Result<(Vec<Diagnostic>, Vec<Diagnostic>), String> {
    let path = explicit.map(PathBuf::from).unwrap_or_else(|| project.store_path());
    if explicit.is_none() && !path.exists() { return Ok((Vec::new(), Vec::new())); }
    let mut store = Store::open_read_only(&path).map_err(|e| e.to_string())?;
    let (estimates, timeline_error) = match store.check_timeline_activation(schema) {
        Ok(estimates) => (estimates, None),
        Err(error @ snapback4_core::RuntimeError::Structural { .. }) => (Vec::new(), Some(error)),
        Err(error) => return Err(error.to_string()),
    };
    let steps = store.successor(schema).map_err(|e| e.to_string())?;
    let pause = store.adoption_estimate(schema).map_err(|e| e.to_string())?;
    let windows = super::sql::window_populations(&path, schema).map_err(|(_, message)| message)?;
    if windows.is_empty() && pause.is_none() && estimates.iter().all(|e| e.sources == 0) && timeline_error.is_none() && !steps.iter().any(|s| s.change == Change::Narrowing) { return Ok((Vec::new(), Vec::new())); }
    let mut sites = BTreeMap::new();
    for (file, source) in project.sources().map_err(|e| e.to_string())? {
        let (document, _) = snapback4_lang::parse_document(&file, &source);
        for view in document.views { sites.insert(format!("timelines.{}", view.name), view.site); }
        for view in document.feed_views { sites.insert(format!("timelines.{}", view.name), view.site); }
        for timeline in document.timelines { sites.insert(format!("timelines.{}", timeline.name), timeline.site); }
        for maintain in document.maintains {
            sites.insert(format!("timelines.{}", maintain.name), maintain.site.clone());
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
    let mut diagnostics: Vec<_> = steps.iter().filter(|s| s.change == Change::Narrowing).map(|step| {
        let table = step.path.split('.').take(2).collect::<Vec<_>>().join(".");
        let site = sites.get(&step.path).or_else(|| sites.get(&table)).cloned().unwrap_or_else(|| Site::new("schema.q", 1, 1));
        Diagnostic::new(&site, "E_ADOPT", &step.message, step.rewrite(schema)).guide("types")
    }).collect();
    // @ref LLP 3000.026#4-atomic-launch-adoption — locate the shared launch verdict at the declaration; successful dev launch is advice.
    if let Some(snapback4_core::RuntimeError::Structural { code, message }) = timeline_error {
        let name = message.strip_prefix("view ").and_then(|s| s.split_once(':')).map(|(name, _)| name);
        let site = name.and_then(|name| sites.get(&format!("timelines.{name}"))).cloned().unwrap_or_else(|| Site::new("schema.q", 1, 1));
        diagnostics.push(Diagnostic::new(&site, code, message,
            snapback4_core::store::timeline_launch::ALTERNATIVE).guide("feeds"));
    }
    let mut notes: Vec<_> = estimates.iter().filter(|e| e.sources != 0).map(|estimate| {
        let site = sites.get(&format!("timelines.{}", estimate.name)).cloned().unwrap_or_else(|| Site::new("schema.q", 1, 1));
        Diagnostic::new(&site, "N_TIMELINE_ADOPT", format!("{}; dev will atomically start this feed now: all retained own events and newest 1,000 live events per current follow, no refill on removal; fresh repost ids, no recovered delivery history. Writes and syncs wait; devices reacquire", estimate.summary()),
            "dev adopts automatically; deploy requires --allow-feed-adoption. Use planned home in guide feeds to avoid the launch lock").guide("feeds")
    }).collect();
    if let Some(pause) = pause.filter(|p| detailed || p.seconds().1 > 1.0) {
        notes.push(Diagnostic::new(&Site::new("schema.q", 1, 1), "N_ADOPTION_PAUSE", pause.summary(),
            "plan this atomic activation's write pause; queries retain the predecessor snapshot; the adoption line reports measured phases after commit").guide("maintains"));
    }
    for (name, last, count) in windows {
        let site = sites.get(&format!("tables.{name}")).cloned().unwrap_or_else(|| Site::new("schema.q", 1, 1));
        notes.push(Diagnostic::new(&site, "N_SYNC_WINDOW_SIZE",
            format!("{name} has at least {count} stored rows across all groups; the new sync last {last} window is per group, not a server history limit (guide sync, opening sentence)"),
            "see the opening of guide sync: cursor history pages beyond the device working set on the server; offline reads use only acquired data").guide("sync"));
    }
    Ok((diagnostics, notes))
}

// @ref LLP 3000.000.000.000.000#3-proof-fixture-loading — discover all live project instances; no guessed ports.
pub(super) const NO_HOST: &str = "no running dev server for this project; restart dev or pass --url with the address dev printed at startup";

pub(super) fn host(project: &Project, options: &super::Options) -> Result<Option<serde_json::Value>, String> {
    let root = project.root.canonicalize().map_err(|e|e.to_string())?;
    if let Some(url)=options.flags.get("url") {
        if options.flags.contains_key("release") {return Err("--url inspects a dev server; omit --release and run doctor in that server's project".into());}
        let address=loopback_url(url)?;
        let mut status=request(address,"GET","/dev/status").ok_or_else(||format!("http://{address} did not return dev status; pass --url with the address dev printed at startup"))?;
        if status["project"]!=serde_json::json!(root) {return Err(format!("http://{address} serves project {}, not {}; use this project's dev address", status["project"].as_str().unwrap_or("<unreported>"),root.display()));}
        if status["temporary"].as_bool().is_none() || status["storeId"].as_str().is_none_or(str::is_empty) {return Err(format!("http://{address} did not report its store identity and lifetime; restart dev with this CLI"));}
        status["address"]=serde_json::json!(address.to_string());status["_explicitSelection"]=serde_json::json!(true);return Ok(Some(status));
    }
    if options.flags.contains_key("release") {return Ok(None);}
    let mut hosts=std::collections::BTreeMap::new();
    for identity in crate::dev_hosts::live(&root)? {
        if let Some(mut status)=request(identity.address,"GET","/dev/status").filter(|s|identity.matches(s)) {
            status["address"]=serde_json::json!(identity.address.to_string());hosts.insert(identity.address,status);
        }
    }
    // Older persisted hosts still publish their address through store ownership.
    let path=project.store_path();
    if let Some(address)=crate::store_owner::inspector_address(&path).filter(|a|!hosts.contains_key(a)) {
        if let Some(id)=Store::open_read_only(&path).ok().and_then(|s|s.meta("store_id").ok().flatten()) {
            if let Some(mut status)=request(address,"GET","/dev/status").filter(|s|s["project"]==serde_json::json!(root) && s["storeId"]==id && s["temporary"]==false) {
                status["address"]=serde_json::json!(address.to_string());hosts.insert(address,status);
            }
        }
    }
    if hosts.len()>1 {return Err(format!("multiple live dev hosts for this project: {}; select one explicitly with --port N for clock/reset or --url http://ADDRESS for doctor",hosts.keys().map(|a|a.to_string()).collect::<Vec<_>>().join(", ")));}
    Ok(hosts.into_values().next())
}

/// Only literal loopback addresses and localhost: no DNS, redirects, credentials,
/// paths or alternate IP encodings can turn this local inspector into a remote request.
fn loopback_url(url: &str) -> Result<std::net::SocketAddr, String> {
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};
    let bad = || "--url requires a loopback HTTP origin, for example http://127.0.0.1:4400 or http://[::1]:4400; use the address dev printed at startup".to_owned();
    let authority = url.strip_prefix("http://").ok_or_else(bad)?;
    let authority = authority.strip_suffix('/').unwrap_or(authority);
    let address = if authority == "localhost" {
        SocketAddr::from((Ipv4Addr::LOCALHOST, 80))
    } else if let Some(port) = authority.strip_prefix("localhost:") {
        SocketAddr::from((Ipv4Addr::LOCALHOST, port.parse::<u16>().map_err(|_| bad())?))
    } else if let Ok(address) = authority.parse::<SocketAddr>() { address }
    else {
        let ip = authority.strip_prefix('[').and_then(|s| s.strip_suffix(']')).unwrap_or(authority);
        SocketAddr::new(ip.parse::<IpAddr>().map_err(|_| bad())?, 80)
    };
    if !address.ip().is_loopback() || address.port() == 0 { return Err(bad()); }
    Ok(address)
}

pub(super) fn request(address: std::net::SocketAddr, method: &str, path: &str) -> Option<serde_json::Value> {
    request_instance(address,method,path,None)
}
pub(super) fn request_instance(address:std::net::SocketAddr,method:&str,path:&str,instance:Option<&str>)->Option<serde_json::Value> {
    use std::{io::{Read, Write}, net::TcpStream, time::Duration};
    let instance=instance.map(|i|format!("x-snapback-dev-instance: {i}\r\n")).unwrap_or_default();
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(200)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(1))).ok()?;
    stream.set_write_timeout(Some(Duration::from_secs(1))).ok()?;
    // The complete latency registry can exceed tiny_http's chunk threshold.
    // HTTP/1.0 requests a length-delimited reply for this close-only reader.
    write!(stream, "{method} {path} HTTP/1.0\r\nHost: {address}\r\n{instance}Connection: close\r\nContent-Length: 0\r\n\r\n").ok()?;
    let mut reply = String::new(); stream.take((16 << 20) + 4096).read_to_string(&mut reply).ok()?;
    let (head, body) = reply.split_once("\r\n\r\n")?;
    if !head.starts_with("HTTP/1.0 200 ") && !head.starts_with("HTTP/1.1 200 ") { return None; }
    serde_json::from_str(body).ok()
}

#[cfg(test)]
mod tests {
    #[test]
    fn doctor_url_is_a_loopback_http_origin() {
        for url in ["http://127.0.0.1:4400", "http://127.0.0.2:4400/", "http://localhost:4400", "http://[::1]:4400", "http://localhost", "http://127.0.0.1", "http://[::1]"] {
            assert!(super::loopback_url(url).unwrap().ip().is_loopback(), "{url}");
        }
        for url in ["", "https://127.0.0.1:4400", "http://example.com:4400", "http://192.168.1.2:4400", "http://0.0.0.0:4400", "http://[::]:4400", "http://[::ffff:192.168.1.2]:4400", "http://127.0.0.1:0", "http://localhost.evil:4400", "http://localhost@evil:4400", "http://evil@localhost:4400", "http://2130706433:4400", "http://127.1:4400", "http://127.0.0.1:4400/dev/status", "http://127.0.0.1:4400/?x", "http://127.0.0.1:4400/#x", "http://127.0.0.1:4400\r\nX: y"] {
            assert!(super::loopback_url(url).is_err(), "{url}");
        }
    }
}
