//! The CLI's local service-seat door. This capability never comes from a bearer session.
use super::{Shared, single_header, authority_host, producing_engine, respond_with_cors};
use snapback4_core::{error::Refusal, identity::{self, Session}};
use std::{io::{self, Read, Seek, SeekFrom, Write}, net::TcpStream, path::{Path, PathBuf}, time::Duration};
use serde_json::{Value as Json, json};
use tiny_http::{Method, Request};

pub(crate) const ENDPOINT: &str = "/dev/token";
#[path = "serve_token_protocol.rs"]
mod protocol;
use protocol::{Mint, CLIENT, SERVER, PROOF};
pub(crate) use protocol::Authority;
const BODY_LIMIT: usize = 4096;
const SECRET_LEN: usize = 64;

fn secret_path(store: &Path) -> PathBuf {
    let mut path = store.as_os_str().to_owned();
    path.push("-token");
    path.into()
}

// @ref LLP 3000.019#3.4 — preserve the hardened auxiliary-file checks and the single owner's lifetime.
pub(crate) fn publish(store: &Path) -> io::Result<Authority> {
    #[cfg(unix)] {
        let secret = protocol::hex(&protocol::random()?);
        let mut file = snapback4_core::private_fs::auxiliary_file(store, &secret_path(store), true, SECRET_LEN as u64)?;
        file.set_len(0)?;
        file.seek(SeekFrom::Start(0))?;
        file.write_all(secret.as_bytes())?;
        Ok(Authority::new(secret, protocol::store_identity(store)?))
    }
    #[cfg(not(unix))] {
        let _ = store;
        Err(io::Error::other("local service minting requires Unix private files"))
    }
}

fn read_secret(store: &Path) -> io::Result<String> {
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        let file = snapback4_core::private_fs::auxiliary_file(store, &secret_path(store), false, SECRET_LEN as u64)?;
        if file.metadata()?.permissions().mode() & 0o777 != 0o600 {
            return Err(io::Error::other("the store token proof must have mode 0600"));
        }
        let mut secret = String::new();
        file.take((SECRET_LEN + 1) as u64).read_to_string(&mut secret)?;
        if secret.len() != SECRET_LEN || !secret.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(io::Error::other("the store token proof is incomplete"));
        }
        Ok(secret)
    }
    #[cfg(not(unix))] {
        let _ = store;
        Err(io::Error::other("local service minting requires Unix private files"))
    }
}

fn refusal(code: &str, family: &str, message: &str, rewrite: &str) -> Refusal {
    Refusal::new(code, family, message).site(ENDPOINT).rewrite(rewrite).guide("services")
}

pub(super) fn denied(request: Request) {
    respond_with_cors(request, 403, json!({"denied": refusal("E_AUTH", "auth",
        "service token minting requires a loopback peer and this server's private store proof",
        "run snapback4 token --service <name> on the server host as the store owner (add --release <dir> for serve)")}), false);
}

// @ref LLP 3000.019#3.4 — authenticate both ends before minting; the store key never leaves its host file/memory.
pub(super) fn handle(mut request: Request, shared: &Shared) {
    let local = request.remote_addr().is_some_and(|peer| peer.ip().is_loopback())
        && matches!(single_header(&request, "host"), Ok(Some(host)) if authority_host(host)
            .is_some_and(|host| host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())))
        && matches!(single_header(&request, "origin"), Ok(None))
        && matches!(single_header(&request, "x-snapback-store-secret"), Ok(None));
    let Some(authority) = shared.owner.as_ref().and_then(|o| o.token_authority.as_ref()).filter(|_| local) else {
        return denied(request);
    };
    if request.method() != &Method::Post || request.url() != ENDPOINT
        || request.body_length().is_some_and(|n| n > BODY_LIMIT) { return denied(request); }
    let client = match single_header(&request, CLIENT) {
        Ok(Some(value)) => match protocol::nonce(value) { Some(nonce) => nonce, None => return denied(request) },
        _ => return denied(request),
    };
    let (server, proof) = match (single_header(&request, SERVER), single_header(&request, PROOF)) {
        (Ok(None), Ok(None)) => (None, None),
        (Ok(Some(server)), Ok(Some(proof))) => match protocol::nonce(server) {
            Some(server) => (Some(server), Some(proof.to_owned())), None => return denied(request),
        },
        _ => return denied(request),
    };
    let mut bytes = Vec::new();
    if request.as_reader().take((BODY_LIMIT + 1) as u64).read_to_end(&mut bytes).is_err() || bytes.len() > BODY_LIMIT {
        return denied(request);
    }
    let mint: Mint = match serde_json::from_slice::<Mint>(&bytes) {
        Ok(mint) if mint.store == authority.store => mint,
        _ => return denied(request),
    };
    let binding = mint.binding();
    let Some(server) = server else {
        let Some(server) = authority.challenge(client, binding.clone(), std::time::Instant::now()) else { return denied(request); };
        return respond_with_cors(request, 200, json!({"server_nonce": protocol::hex(&server),
            "server_proof": protocol::server_proof(&authority.secret, &client, &server, &binding)}), false);
    };
    if !authority.consume(&client, &server, &binding, proof.as_deref().unwrap(), std::time::Instant::now()) {
        return denied(request);
    }
    let result = {
        // Use the same writer and identity routine as offline minting. Sample
        // wall time as the offline CLI does, independent of dev's test clock.
        let engine = producing_engine(shared);
        shared.owner.as_ref().expect("authorized owner").path().and_then(|_| {
            identity::service_session(engine.store(), &mint.service, snapback4_core::now_ms(), mint.days)
        })
    };
    let reply = match result {
        Ok(session) => json!({"session": session}),
        Err(error) => {
            let why = error.refusal().site(ENDPOINT).rewrite(if matches!(error, snapback4_core::RuntimeError::Auth(_)) {
                "use --service with 1–64 letters, digits, _ or -"
            } else { "inspect the store error, repair the store access, then rerun snapback4 token" }).guide("services");
            json!({"denied": why})
        }
    };
    let Some(sealed) = protocol::seal(&authority.secret, &client, &server, &binding, &serde_json::to_vec(&reply).unwrap()) else {
        return denied(request);
    };
    respond_with_cors(request, 200, json!({"sealed": sealed}), false);
}

fn exchange(address: std::net::SocketAddr, headers: &str, body: &str) -> io::Result<Json> {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(1))?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    // HTTP/1.0 keeps the bounded reply length-delimited. No proxy, DNS or redirects.
    write!(stream, "POST {ENDPOINT} HTTP/1.0\r\nHost: {address}\r\n{headers}Content-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len())?;
    let mut response = String::new();
    stream.take(8193).read_to_string(&mut response)?;
    response.split_once("\r\n\r\n").filter(|_| response.len() <= 8192
        && (response.starts_with("HTTP/1.0 200 ") || response.starts_with("HTTP/1.1 200 ")))
        .and_then(|(_, body)| serde_json::from_str(body).ok())
        .ok_or_else(|| io::Error::other("invalid local mint reply"))
}

// @ref LLP 3000.019#3.4 — busy token commands ask the announced loopback owner, never open a second writer.
pub(crate) fn mint_live(path: &Path, name: &str, days: i64) -> Result<Session, (i32, String)> {
    let store = path.canonicalize().unwrap_or_else(|_| path.to_owned());
    let owner = crate::store_owner::address(&store).unwrap_or_else(|| "another CLI command or a server starting up (address pending)".into());
    let unavailable = |reason: &str| (2, format!("E_STORE_BUSY at {}: owned by {owner}; {reason}. Restore access to that server's loopback listener and private store proof, then rerun `snapback4 token --service <name>` (with the same --release <dir> for serve). For an older or unreachable server, stop it, rerun token offline, then restart it; for another CLI, wait for it to finish. Leave <database>-owner in place", path.display()));
    let address = crate::store_owner::inspector_address(&store).ok_or_else(|| unavailable("no published loopback listener; no mint request sent"))?;
    let secret = read_secret(&store).map_err(|_| unavailable("cannot read the 0600 store token proof; no mint request sent"))?;
    let mint = Mint { service: name.into(), days, store: protocol::store_identity(&store)
        .map_err(|_| unavailable("cannot identify the owned store; no mint request sent"))? };
    let body = serde_json::to_string(&mint).unwrap();
    if body.len() > BODY_LIMIT { return Err((1, "token: E_AUTH at --service: a service name is 1–64 letters, digits, _ or -; use --service worker".into())); }
    let binding = mint.binding();
    let client = protocol::random().map_err(|_| unavailable("cannot create a fresh challenge; no mint request sent"))?;
    let headers = format!("{CLIENT}: {}\r\n", protocol::hex(&client));
    let challenge = exchange(address, &headers, &body).map_err(|_| unavailable("server challenge unavailable; no mint proof sent"))?;
    let server = challenge["server_nonce"].as_str().and_then(protocol::nonce)
        .ok_or_else(|| unavailable("invalid server challenge; no mint proof sent"))?;
    if !challenge["server_proof"].as_str().is_some_and(|proof| protocol::verify_server(&secret, &client, &server, &binding, proof)) {
        return Err(unavailable("server proof did not verify; no mint proof sent"));
    }
    // Only a verified server receives a client proof. Neither message contains the key.
    let headers = format!("{headers}{SERVER}: {}\r\n{PROOF}: {}\r\n", protocol::hex(&server),
        protocol::client_proof(&secret, &client, &server, &binding));
    let reply = exchange(address, &headers, &body)
        .map_err(|_| unavailable("mint reply unavailable; a session may have been minted, but no token was received"))?;
    let reply: Json = reply["sealed"].as_str().and_then(|sealed| protocol::open(&secret, &client, &server, &binding, sealed))
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .ok_or_else(|| unavailable("server returned an invalid mint reply; a session may have been minted"))?;
    if let Some(denied) = reply.get("denied") {
        if let Ok(why) = serde_json::from_value::<Refusal>(denied.clone()) {
            return Err((1, format!("token: {} at {ENDPOINT}: {}; {}", why.code, why.message, why.rewrite.unwrap_or_else(|| "rerun snapback4 token with valid service arguments".into()))));
        }
        return Err(unavailable("server refused the local mint request; restart it with this CLI and retry"));
    }
    let session = &reply["session"];
    let principal = format!("service:{name}");
    let token = session["token"].as_str().filter(|t| t.len() == 43 && t.bytes().all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c)));
    if session["principal"] != principal || session["kind"] != "service" || token.is_none() || session["expires_at"].as_i64().is_none() {
        return Err(unavailable("server returned an invalid mint reply; a session may have been minted"));
    }
    Ok(Session { scope: snapback4_core::identity::SessionScope::Full, cap_expires_at: None, principal, kind: "service".into(), token: token.unwrap().into(), expires_at: session["expires_at"].as_i64().unwrap() })
}
