//! Service-seat minting selects a project host, then proves local store authority.
use super::*;

/// Mint a service token for the exact registered dev address selected by an
/// operator command. The registry supplies the private store proof path; the
/// host or a stopped store remains the only minting authority.
pub(crate) fn mint_for_dev(address: std::net::SocketAddr, name: &str, days: i64) -> Result<String, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let project = Project::locate(&cwd).ok_or("cannot mint a development operator token outside a Snapback project")?;
    let hosts = crate::dev_hosts::live(&project.root.canonicalize().unwrap_or(project.root.clone()))?;
    let host = hosts.into_iter().find(|host| host.address == address)
        .ok_or_else(|| format!("no registered dev host for this project at {address}; restart dev with this CLI"))?;
    let path = host.store_path.ok_or("this older dev host does not publish its store proof path; restart it with this CLI")?;
    let owner = match crate::store_owner::command(&path) {
        Ok(owner) => Some(owner),
        Err(error) if error.starts_with("E_STORE_BUSY ") => None,
        Err(error) => return Err(error),
    };
    let session = if let Some(owner) = owner {
        let store = owner.open_store(std::time::Duration::from_secs(5)).map_err(|e| format!("cannot open the store: {e}"))?;
        snapback4_core::identity::service_session(&store, name, snapback4_core::now_ms(), days).map_err(|e| e.to_string())?
    } else {
        crate::serve::token::mint_live(&path, name, days).map_err(|(_, error)| error)?
    };
    Ok(session.token)
}

/// `token --service <name> [--days N] [--release <dir>]`: a bearer session
/// for a service principal, printed once. A service is a worker's seat: it
/// claims effects, mints sessions for the accounts the application
/// authenticates itself, and is admitted by rules as `service:<name>`.
pub fn token(options: &Options) -> i32 {
    let Some(name) = options.flags.get("service").filter(|name| !name.is_empty()) else {
        eprintln!("usage: {}", crate::cli_flags::synopsis("token"));
        return 2;
    };
    let days: i64 = options.flags.get("days").and_then(|d| d.parse().ok()).unwrap_or(365);
    // @ref LLP 3000.000.000.001#8-wave-18-developer-loop-amendment-dx4 — project registry selects; private mutual proof authorizes.
    let path = match options.flags.get("release") {
        Some(dir) => match releases::existing_deployment(Path::new(dir)) {
            Ok(dir) => dir.join("store.sqlite"),
            Err(error) => { eprintln!("token: {error}"); return 2; }
        },
        None => {
            let project = project_or_exit();
            let hosts = match crate::dev_hosts::live(&project.root.canonicalize().unwrap_or(project.root.clone())) {
                Ok(hosts) => hosts,
                Err(error) => { eprintln!("token: {error}"); return 2; }
            };
            let port = match options.flags.get("port") {
                Some(value) => match value.parse::<u16>().ok().filter(|p| *p > 0) {
                    Some(port) => Some(port),
                    None => { eprintln!("E_INPUT: token --port must be an integer in 1..65535; no mint request sent"); return 2; }
                },
                None => None,
            };
            let hosts: Vec<_> = hosts.into_iter().filter(|h| port.is_none_or(|p| h.address.port() == p)).collect();
            if hosts.len() > 1 { eprintln!("E_INPUT: multiple live dev hosts; select token --service {name} --port N"); return 2; }
            if let Some(host) = hosts.first() {
                match &host.store_path { Some(path) => path.clone(), None => { eprintln!("token: this older dev host does not publish its store proof path; restart it with this CLI"); return 2; } }
            } else if port.is_some() {
                eprintln!("E_INPUT: no registered dev host for this project on the selected port; start dev and use its printed port"); return 2;
            } else { project.store_path() }
        },
    };
    if !options.flags.contains_key("release") && !path.is_file() {
        eprintln!("cannot open the store: no store at {}; run `snapback4 dev` first", path.display());
        return 2;
    }
    let _owner = match crate::store_owner::command(&path) {
        Ok(owner) => Some(owner),
        Err(error) if error.starts_with("E_STORE_BUSY ") => None,
        Err(error) => { eprintln!("{error}"); return 2; }
    };
    let store_path = &path;
    let session = if let Some(owner) = &_owner {
        let store = match owner.open_store(std::time::Duration::from_secs(5)) {
            Ok(store) => store,
            Err(error) => { eprintln!("cannot open the store: {error}"); return 2; }
        };
        snapback4_core::identity::service_session(&store, name, snapback4_core::now_ms(), days)
            .map_err(|error| (1, format!("token: {error}")))
    } else {
        crate::serve::token::mint_live(&path, name, days)
    };
    match session {
        Ok(session) => {
            if options.json {
                println!("{}", json!({"token":session.token,"principal":session.principal,"expiresAt":session.expires_at,"store":store_path}));
            } else {
                println!("{}", session.token);
                if !options.flags.contains_key("quiet") {
                    eprintln!("token: a session for {} until {}; printed once; keep it where the worker keeps secrets", session.principal, session.expires_at);
                    eprintln!("store: {}; this token belongs only to this store; each isolated store needs its own", store_path.display());
                }
            }
            0
        }
        Err((status, error)) => {
            eprintln!("{error}");
            status
        }
    }
}

