//! Private local mint protocol; neither the store key nor a usable session crosses this wire.
use chacha20poly1305::{aead::{Aead, Payload}, ChaCha20Poly1305, KeyInit, Nonce};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs::File, io::{self, Read}, path::Path, sync::Mutex, time::{Duration, Instant}};

pub(super) const CLIENT: &str = "x-snapback-token-client-nonce";
pub(super) const SERVER: &str = "x-snapback-token-server-nonce";
pub(super) const PROOF: &str = "x-snapback-token-proof";
const SERVER_DOMAIN: &[u8] = b"snapback4-token-server";
const CLIENT_DOMAIN: &[u8] = b"snapback4-token-client";
const REPLY_DOMAIN: &[u8] = b"snapback4-token-reply";
const TTL: Duration = Duration::from_secs(10);
const MAX_PENDING: usize = 128;

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Mint { pub service: String, pub days: i64, pub store: String }
impl Mint {
    pub fn binding(&self) -> Vec<u8> {
        // An unambiguous, versioned tuple. Days bind before identity's clamping.
        serde_json::to_vec(&(1, &self.service, self.days, &self.store)).unwrap()
    }
}

pub(super) fn hex(bytes: &[u8]) -> String { snapback4_core::value::encode_bytes_hex(bytes) }
pub(super) fn unhex(value: &str) -> Option<Vec<u8>> {
    if value.len() % 2 != 0 { return None; }
    value.as_bytes().chunks_exact(2).map(|pair| {
        let digit = |c: u8| match c { b'0'..=b'9' => Some(c - b'0'), b'a'..=b'f' => Some(c - b'a' + 10), _ => None };
        Some(digit(pair[0])? * 16 + digit(pair[1])?)
    }).collect()
}
pub(super) fn nonce(value: &str) -> Option<[u8; 32]> { unhex(value)?.try_into().ok() }
pub(super) fn random() -> io::Result<[u8; 32]> {
    let mut bytes = [0; 32];
    File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes)
}
pub(super) fn store_identity(store: &Path) -> io::Result<String> {
    #[cfg(unix)] {
        use std::os::unix::{ffi::OsStrExt, fs::MetadataExt};
        let path = store.canonicalize()?;
        let meta = snapback4_core::private_fs::database_metadata(&path)?
            .ok_or_else(|| io::Error::other("store disappeared"))?;
        let identity = serde_json::to_vec(&(hex(path.as_os_str().as_bytes()), meta.dev(), meta.ino()))?;
        Ok(hex(&Sha256::digest(identity)))
    }
    #[cfg(not(unix))] { let _ = store; Err(io::Error::other("local minting requires Unix")) }
}

fn mac(secret: &str, domain: &[u8], first: &[u8; 32], second: &[u8; 32], binding: &[u8]) -> Hmac<Sha256> {
    // The key is the exact 64 ASCII hex bytes in the private file.
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(domain); mac.update(first); mac.update(second); mac.update(binding);
    mac
}
pub(super) fn server_proof(secret: &str, client: &[u8; 32], server: &[u8; 32], binding: &[u8]) -> String {
    hex(&mac(secret, SERVER_DOMAIN, client, server, binding).finalize().into_bytes())
}
pub(super) fn verify_server(secret: &str, client: &[u8; 32], server: &[u8; 32], binding: &[u8], proof: &str) -> bool {
    // RustCrypto's verify_slice uses constant-time equality for the fixed-size tag.
    nonce(proof).is_some_and(|tag| mac(secret, SERVER_DOMAIN, client, server, binding).verify_slice(&tag).is_ok())
}
pub(super) fn client_proof(secret: &str, client: &[u8; 32], server: &[u8; 32], binding: &[u8]) -> String {
    hex(&mac(secret, CLIENT_DOMAIN, server, client, binding).finalize().into_bytes())
}
fn reply_cipher(secret: &str, client: &[u8; 32], server: &[u8; 32], binding: &[u8]) -> ChaCha20Poly1305 {
    let key = mac(secret, REPLY_DOMAIN, client, server, binding).finalize().into_bytes();
    ChaCha20Poly1305::new(&key)
}
pub(super) fn seal(secret: &str, client: &[u8; 32], server: &[u8; 32], binding: &[u8], body: &[u8]) -> Option<String> {
    // One response per single-use server nonce, hence one encryption per derived key.
    // An active forwarding listener may relay a mint, but cannot read its bearer.
    reply_cipher(secret, client, server, binding).encrypt(Nonce::from_slice(&server[..12]), Payload { msg: body, aad: binding }).ok().map(|b| hex(&b))
}
pub(super) fn open(secret: &str, client: &[u8; 32], server: &[u8; 32], binding: &[u8], body: &str) -> Option<Vec<u8>> {
    reply_cipher(secret, client, server, binding).decrypt(Nonce::from_slice(&server[..12]), Payload { msg: &unhex(body)?, aad: binding }).ok()
}

struct Pending { issued: Instant, client: [u8; 32], binding: Vec<u8> }
pub(crate) struct Authority {
    pub(super) secret: String,
    pub(super) store: String,
    pending: Mutex<BTreeMap<[u8; 32], Pending>>,
}
impl Authority {
    pub(super) fn new(secret: String, store: String) -> Self { Self { secret, store, pending: Mutex::new(BTreeMap::new()) } }
    pub(super) fn challenge(&self, client: [u8; 32], binding: Vec<u8>, now: Instant) -> Option<[u8; 32]> {
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        pending.retain(|_, p| now.saturating_duration_since(p.issued) < TTL);
        if pending.len() >= MAX_PENDING { return None; }
        let server = random().ok()?;
        if pending.contains_key(&server) { return None; }
        pending.insert(server, Pending { issued: now, client, binding });
        Some(server)
    }
    // @ref LLP 3000.019#3.4 — consume before verifying or minting, so failed, concurrent and lost-reply attempts cannot replay.
    pub(super) fn consume(&self, client: &[u8; 32], server: &[u8; 32], binding: &[u8], proof: &str, now: Instant) -> bool {
        let pending = self.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(server);
        let Some(p) = pending else { return false; };
        now.saturating_duration_since(p.issued) < TTL && p.client == *client && p.binding == binding
            && nonce(proof).is_some_and(|tag| mac(&self.secret, CLIENT_DOMAIN, server, client, binding).verify_slice(&tag).is_ok())
    }
}

#[cfg(test)]
#[path = "serve_token_protocol_tests.rs"]
mod tests;
