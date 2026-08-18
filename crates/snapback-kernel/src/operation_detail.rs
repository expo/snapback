//! Encrypted custody for secret-bearing operation-envelope detail.
//!
//! The data database retains only XChaCha20-Poly1305 ciphertext. Its root key
//! lives in a separate owner-only sidecar and is installed into a direct-only
//! function on the owning SQLite connection so transaction-local envelope code
//! can seal detail without widening the public storage API or retaining a TEMP
//! database pager solely for key custody.

use std::{
    io::{self, ErrorKind},
    path::{Path, PathBuf},
    sync::Mutex,
};

#[cfg(unix)]
use std::{ffi::CStr, ffi::OsStr, os::unix::ffi::OsStrExt as _};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::{Zeroize as _, Zeroizing};

use crate::diagnostic::{SnapbackError, SnapbackResult};

const FORMAT_VERSION: u32 = 1;
const KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 24;
const AEAD_TAG_BYTES: usize = 16;
const PURPOSE: &[u8] = b"snapback:operation-protected-detail:xchacha20:v1";
const MAX_KEY_FILE_BYTES: usize = 4 * 1024;
const KEY_CRYPTO_FUNCTION: &str = "__snapback_operation_detail_crypto_v1";
const CRYPTO_RESPONSE_OK: u8 = 0;
const CRYPTO_RESPONSE_METADATA_INVALID: u8 = 1;
const CRYPTO_RESPONSE_AUTH_FAILED: u8 = 2;
const CRYPTO_RESPONSE_VERSION: u8 = 1;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedKeyV1 {
    format_version: u32,
    key_id: String,
    secret: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedKeyRef<'a> {
    format_version: u32,
    key_id: &'a str,
    secret: &'a str,
}

struct CustodyKey {
    key_id: String,
    secret: Zeroizing<[u8; KEY_BYTES]>,
}

struct LazyCustodyKey {
    persisted: Option<PathBuf>,
    loaded: Option<CustodyKey>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum KeyPublication {
    Published,
    Existing,
}

impl LazyCustodyKey {
    fn for_empty_database(persisted: Option<PathBuf>) -> Self {
        Self {
            persisted,
            loaded: None,
        }
    }

    fn with_loaded(persisted: Option<PathBuf>, loaded: CustodyKey) -> Self {
        Self {
            persisted,
            loaded: Some(loaded),
        }
    }

    fn for_seal(&mut self) -> Result<&CustodyKey, ()> {
        if self.loaded.is_none() {
            self.loaded = Some(load_or_mint_key(self.persisted.as_deref())?);
        }
        self.loaded.as_ref().ok_or(())
    }

    fn for_open(&mut self) -> Result<&CustodyKey, ()> {
        if self.loaded.is_none() {
            let path = self.persisted.as_deref().ok_or(())?;
            self.loaded = Some(load_key(path)?);
        }
        self.loaded.as_ref().ok_or(())
    }
}

fn invalid(detail: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_OPERATION_PROTECTED_CUSTODY_INVALID",
        "storage",
        detail.into(),
    )
}

pub fn keyring_path(database: &Path) -> PathBuf {
    let name = database
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("snapback.db");
    database.with_file_name(format!("{name}.operation-detail-keyring.json"))
}

pub fn persisted_file_has_key(database: &Path) -> bool {
    crate::secure_file::read_owner_only(&keyring_path(database))
        .ok()
        .map(Zeroizing::new)
        .and_then(|bytes| decode_key(&bytes))
        .is_some()
}

pub fn mint_new_sidecar(database: &Path) -> SnapbackResult<()> {
    let path = keyring_path(database);
    if path.exists() {
        return Err(invalid(
            "protected operation detail key sidecar already exists",
        ));
    }
    let key =
        generate_key().map_err(|_| invalid("protected operation detail key generation failed"))?;
    match publish_key_candidate(&path, &key) {
        Ok(KeyPublication::Published) => Ok(()),
        Ok(KeyPublication::Existing) => Err(invalid(
            "protected operation detail key sidecar already exists",
        )),
        Err(()) => Err(invalid(
            "protected operation detail key sidecar could not be persisted",
        )),
    }
}

fn decode_key(bytes: &[u8]) -> Option<CustodyKey> {
    if bytes.len() > MAX_KEY_FILE_BYTES {
        return None;
    }
    let mut persisted: PersistedKeyV1 = serde_json::from_slice(bytes).ok()?;
    if persisted.format_version != FORMAT_VERSION || persisted.key_id.is_empty() {
        persisted.secret.zeroize();
        return None;
    }
    let decoded = URL_SAFE_NO_PAD.decode(&persisted.secret).ok();
    persisted.secret.zeroize();
    let decoded = Zeroizing::new(decoded?);
    let secret: [u8; KEY_BYTES] = decoded.as_slice().try_into().ok()?;
    Some(CustodyKey {
        key_id: persisted.key_id,
        secret: Zeroizing::new(secret),
    })
}

fn generate_key() -> Result<CustodyKey, ()> {
    let mut secret = Zeroizing::new([0_u8; KEY_BYTES]);
    getrandom::fill(&mut *secret).map_err(|_| ())?;
    Ok(CustodyKey {
        key_id: crate::ids::mint_time_ordered(crate::ids::Kind::Opaque),
        secret,
    })
}

fn encode_key(key: &CustodyKey) -> Result<Zeroizing<Vec<u8>>, ()> {
    let secret = Zeroizing::new(URL_SAFE_NO_PAD.encode(*key.secret));
    serde_json::to_vec(&PersistedKeyRef {
        format_version: FORMAT_VERSION,
        key_id: &key.key_id,
        secret: &secret,
    })
    .map(Zeroizing::new)
    .map_err(|_| ())
}

fn load_key(path: &Path) -> Result<CustodyKey, ()> {
    crate::secure_file::read_owner_only(path)
        .ok()
        .map(Zeroizing::new)
        .and_then(|bytes| decode_key(&bytes))
        .ok_or(())
}

fn publish_key_candidate(path: &Path, key: &CustodyKey) -> Result<KeyPublication, ()> {
    let bytes = encode_key(key)?;
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let staged = parent.join(format!(".snapback-operation-detail-key-{}.tmp", key.key_id));
    crate::secure_file::write_new_owner_only(&staged, &bytes).map_err(|_| ())?;
    match crate::secure_file::rename_no_replace(&staged, path) {
        Ok(()) => {
            sync_key_parent(path).map_err(|_| ())?;
            Ok(KeyPublication::Published)
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            let _ = std::fs::remove_file(&staged);
            // Either participant may make the winner's complete atomic entry
            // durable before any ciphertext row is allowed to commit.
            sync_key_parent(path).map_err(|_| ())?;
            Ok(KeyPublication::Existing)
        }
        Err(_) => {
            let _ = std::fs::remove_file(&staged);
            Err(())
        }
    }
}

#[cfg(any(test, feature = "test-support"))]
thread_local! {
    static FAIL_NEXT_KEY_PARENT_SYNC: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

fn sync_key_parent(path: &Path) -> io::Result<()> {
    #[cfg(any(test, feature = "test-support"))]
    if FAIL_NEXT_KEY_PARENT_SYNC.with(|fail| fail.replace(false)) {
        return Err(io::Error::other(
            "injected operation-detail parent sync failure",
        ));
    }
    crate::secure_file::sync_parent(path)
}

fn load_or_mint_key(path: Option<&Path>) -> Result<CustodyKey, ()> {
    let Some(path) = path else {
        return generate_key();
    };
    match crate::secure_file::read_owner_only(path) {
        Ok(bytes) => {
            sync_key_parent(path).map_err(|_| ())?;
            decode_key(&Zeroizing::new(bytes)).ok_or(())
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let generated = generate_key()?;
            match publish_key_candidate(path, &generated)? {
                KeyPublication::Published => Ok(generated),
                // Another connection won the empty-database race by atomically
                // publishing complete, fsynced bytes at the final pathname.
                KeyPublication::Existing => load_key(path),
            }
        }
        Err(_) => Err(()),
    }
}

fn retained_ciphertext_exists(conn: &Connection) -> SnapbackResult<bool> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master
          WHERE type='table' AND name='_snapback_operation_protected_detail_v1')",
        [],
        |row| row.get(0),
    )?;
    if !exists {
        return Ok(false);
    }
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM _snapback_operation_protected_detail_v1 LIMIT 1)",
        [],
        |row| row.get(0),
    )
    .map_err(Into::into)
}

fn authenticate_retained_ciphertext(
    conn: &Connection,
    expected_key_id: &str,
    secret: &[u8; KEY_BYTES],
) -> SnapbackResult<()> {
    type RetainedCiphertextRow = (String, String, String, Vec<u8>, Vec<u8>, i64);
    let row: Option<RetainedCiphertextRow> = conn
        .query_row(
            "SELECT custody_reference,payload_digest,key_id,nonce,ciphertext,payload_bytes
               FROM _snapback_operation_protected_detail_v1
              ORDER BY custody_reference LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()?;
    let Some((custody_reference, payload_digest, key_id, nonce, ciphertext, payload_bytes)) = row
    else {
        return Ok(());
    };
    if key_id != expected_key_id || nonce.len() != 24 || payload_bytes < 0 {
        return Err(invalid(
            "protected operation detail custody metadata is invalid at boot",
        ));
    }
    let plaintext = XChaCha20Poly1305::new(secret.into())
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: &aad(&custody_reference, &payload_digest),
            },
        )
        .map_err(|_| invalid("protected operation detail cannot authenticate at boot"))?;
    if plaintext.len() != payload_bytes as usize
        || serde_json::from_slice::<Value>(&plaintext).is_err()
    {
        return Err(invalid(
            "protected operation detail plaintext is invalid at boot",
        ));
    }
    Ok(())
}

/// Install one process-local key projection when retained ciphertext requires
/// it. Existing ciphertext makes a missing/corrupt sidecar a hard fail-closed
/// condition. An empty database stays fully dormant until its first seal.
pub fn install(conn: &Connection, database_path: Option<&Path>) -> SnapbackResult<()> {
    let retained_ciphertext = retained_ciphertext_exists(conn)?;
    if !retained_ciphertext {
        return Ok(());
    }
    let persisted = database_path.map(keyring_path);
    let loaded = persisted
        .as_deref()
        .and_then(|path| load_key(path).ok())
        .ok_or_else(|| {
            invalid(
                "protected operation detail exists but its owner-only key sidecar is unavailable",
            )
        })?;
    let mismatched: bool = conn.query_row(
        "SELECT EXISTS(
               SELECT 1 FROM _snapback_operation_protected_detail_v1
                WHERE key_id<>?1 LIMIT 1
             )",
        [&loaded.key_id],
        |row| row.get(0),
    )?;
    if mismatched {
        return Err(invalid(
            "protected operation detail does not match its owner-only key sidecar",
        ));
    }
    authenticate_retained_ciphertext(conn, &loaded.key_id, &loaded.secret)?;
    register_crypto_function(conn, LazyCustodyKey::with_loaded(persisted, loaded))
}

fn register_crypto_function(conn: &Connection, custody: LazyCustodyKey) -> SnapbackResult<()> {
    let custody = Mutex::new(custody);
    // The function returns only ciphertext or plaintext, never the root key.
    // @ref LLP 0163#implementation-record--2026-08-04-explanation-and-protected-custody — protected crypto stays connection-local without retaining a second SQLite pager or projecting the key through SQL.
    conn.create_scalar_function(
        KEY_CRYPTO_FUNCTION,
        -1,
        rusqlite::functions::FunctionFlags::SQLITE_UTF8
            | rusqlite::functions::FunctionFlags::SQLITE_DIRECTONLY,
        move |context| {
            if context.is_empty() {
                return Err(rusqlite::Error::UserFunctionError(Box::new(
                    std::io::Error::other(
                        "protected operation detail crypto invocation is invalid",
                    ),
                )));
            }
            let mode: String = context.get(0)?;
            match (mode.as_str(), context.len()) {
                ("seal-v1", 4) => {
                    let custody_reference: String = context.get(1)?;
                    let payload_digest: String = context.get(2)?;
                    let plaintext = Zeroizing::new(context.get::<Vec<u8>>(3)?);
                    let Ok(mut custody) = custody.lock() else {
                        return Ok(vec![CRYPTO_RESPONSE_METADATA_INVALID]);
                    };
                    let Ok(key) = custody.for_seal() else {
                        return Ok(vec![CRYPTO_RESPONSE_METADATA_INVALID]);
                    };
                    let mut nonce = [0_u8; NONCE_BYTES];
                    if getrandom::fill(&mut nonce).is_err() {
                        return Ok(vec![CRYPTO_RESPONSE_METADATA_INVALID]);
                    }
                    let Ok(ciphertext) = XChaCha20Poly1305::new((&*key.secret).into()).encrypt(
                        XNonce::from_slice(&nonce),
                        Payload {
                            msg: &plaintext,
                            aad: &aad(&custody_reference, &payload_digest),
                        },
                    ) else {
                        return Ok(vec![CRYPTO_RESPONSE_AUTH_FAILED]);
                    };
                    let key_id_bytes = key.key_id.as_bytes();
                    let Ok(key_id_len) = u32::try_from(key_id_bytes.len()) else {
                        return Ok(vec![CRYPTO_RESPONSE_METADATA_INVALID]);
                    };
                    let mut response = Vec::with_capacity(
                        2 + std::mem::size_of::<u32>()
                            + key_id_bytes.len()
                            + NONCE_BYTES
                            + ciphertext.len(),
                    );
                    response.extend_from_slice(&[CRYPTO_RESPONSE_OK, CRYPTO_RESPONSE_VERSION]);
                    response.extend_from_slice(&key_id_len.to_be_bytes());
                    response.extend_from_slice(key_id_bytes);
                    response.extend_from_slice(&nonce);
                    response.extend_from_slice(&ciphertext);
                    Ok(response)
                }
                ("open-v1", 6) => {
                    let custody_reference: String = context.get(1)?;
                    let payload_digest: String = context.get(2)?;
                    let stored_key_id: String = context.get(3)?;
                    let nonce: Vec<u8> = context.get(4)?;
                    let ciphertext: Vec<u8> = context.get(5)?;
                    let Ok(mut custody) = custody.lock() else {
                        return Ok(vec![CRYPTO_RESPONSE_METADATA_INVALID]);
                    };
                    let Ok(key) = custody.for_open() else {
                        return Ok(vec![CRYPTO_RESPONSE_METADATA_INVALID]);
                    };
                    if stored_key_id != key.key_id || nonce.len() != NONCE_BYTES {
                        return Ok(vec![CRYPTO_RESPONSE_METADATA_INVALID]);
                    }
                    let Ok(plaintext) = XChaCha20Poly1305::new((&*key.secret).into()).decrypt(
                        XNonce::from_slice(&nonce),
                        Payload {
                            msg: &ciphertext,
                            aad: &aad(&custody_reference, &payload_digest),
                        },
                    ) else {
                        return Ok(vec![CRYPTO_RESPONSE_AUTH_FAILED]);
                    };
                    let mut response = Vec::with_capacity(2 + plaintext.len());
                    response.extend_from_slice(&[CRYPTO_RESPONSE_OK, CRYPTO_RESPONSE_VERSION]);
                    response.extend_from_slice(&plaintext);
                    Ok(response)
                }
                _ => Err(rusqlite::Error::UserFunctionError(Box::new(
                    std::io::Error::other(
                        "protected operation detail crypto invocation is invalid",
                    ),
                ))),
            }
        },
    )?;
    Ok(())
}

fn database_path(conn: &Connection) -> Option<PathBuf> {
    #[cfg(unix)]
    {
        // SAFETY: `conn.handle()` is used only for this immediate SQLite
        // metadata lookup, `c"main"` is a valid C string, and the returned
        // connection-owned bytes are copied before this function returns.
        let bytes = unsafe {
            let filename = rusqlite::ffi::sqlite3_db_filename(conn.handle(), c"main".as_ptr());
            (!filename.is_null()).then(|| CStr::from_ptr(filename).to_bytes().to_vec())
        }?;
        (!bytes.is_empty()).then(|| PathBuf::from(OsStr::from_bytes(&bytes)))
    }
    #[cfg(not(unix))]
    {
        conn.path()
            .filter(|path| !path.is_empty())
            .map(PathBuf::from)
    }
}

fn crypto_function_is_missing(error: &rusqlite::Error) -> bool {
    let expected = format!("no such function: {KEY_CRYPTO_FUNCTION}");
    match error {
        rusqlite::Error::SqliteFailure(_, Some(detail)) => detail == &expected,
        rusqlite::Error::SqlInputError { msg, .. } => msg == &expected,
        _ => false,
    }
}

fn install_crypto_function_for_first_seal(conn: &Connection) -> SnapbackResult<()> {
    let database_path = database_path(conn);
    if retained_ciphertext_exists(conn)? {
        return install(conn, database_path.as_deref());
    }
    let persisted = database_path.as_deref().map(keyring_path);
    register_crypto_function(conn, LazyCustodyKey::for_empty_database(persisted))
}

#[cfg(any(test, feature = "test-support"))]
fn crypto_function_is_installed(conn: &Connection) -> SnapbackResult<bool> {
    conn.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM pragma_function_list
            WHERE name=?1 AND builtin=0
         )",
        [KEY_CRYPTO_FUNCTION],
        |row| row.get(0),
    )
    .map_err(Into::into)
}

fn aad(custody_reference: &str, payload_digest: &str) -> Vec<u8> {
    let mut aad = PURPOSE.to_vec();
    for value in [custody_reference.as_bytes(), payload_digest.as_bytes()] {
        aad.extend_from_slice(&(value.len() as u32).to_be_bytes());
        aad.extend_from_slice(value);
    }
    aad
}

pub fn seal_in(
    tx: &Transaction<'_>,
    custody_reference: &str,
    payload_digest: &str,
    detail: &Value,
) -> SnapbackResult<u64> {
    let plaintext = Zeroizing::new(
        serde_json::to_vec(detail)
            .map_err(|_| invalid("protected operation detail could not be encoded"))?,
    );
    let payload_bytes = u64::try_from(plaintext.len())
        .map_err(|_| invalid("protected operation detail length overflowed"))?;
    let statement = format!("SELECT {KEY_CRYPTO_FUNCTION}('seal-v1',?1,?2,?3)");
    let invoke = || {
        tx.query_row(
            &statement,
            params![custody_reference, payload_digest, plaintext.as_slice()],
            |row| row.get(0),
        )
    };
    let response: Vec<u8> = match invoke() {
        Ok(response) => response,
        Err(error) if crypto_function_is_missing(&error) => {
            // Empty databases retain no custody function or mutex. The first
            // actual protected write installs the connection-local DIRECTONLY
            // carrier and retries the still-unexecuted crypto statement.
            // Retained ciphertext remains a boot-time fail-closed condition in
            // `install`.
            // @ref LLP 0163#implementation-record--2026-08-04-explanation-and-protected-custody — protected custody is lazy for empty stores but mandatory before ciphertext exists.
            install_crypto_function_for_first_seal(tx)?;
            invoke().map_err(|_| invalid("protected operation detail crypto is not installed"))?
        }
        Err(_) => {
            return Err(invalid(
                "protected operation detail crypto is not installed",
            ));
        }
    };
    match response.as_slice() {
        [CRYPTO_RESPONSE_METADATA_INVALID] => {
            return Err(invalid(
                "protected operation detail nonce generation or key metadata failed",
            ));
        }
        [CRYPTO_RESPONSE_AUTH_FAILED] => {
            return Err(invalid("protected operation detail encryption failed"));
        }
        _ => {}
    }
    if response.get(..2) != Some(&[CRYPTO_RESPONSE_OK, CRYPTO_RESPONSE_VERSION]) {
        return Err(invalid(
            "protected operation detail seal response is invalid",
        ));
    }
    let key_id_len = response
        .get(2..2 + std::mem::size_of::<u32>())
        .and_then(|bytes| bytes.try_into().ok())
        .map(u32::from_be_bytes)
        .and_then(|length| usize::try_from(length).ok())
        .ok_or_else(|| invalid("protected operation detail seal response is invalid"))?;
    let key_id_start = 2 + std::mem::size_of::<u32>();
    let nonce_start = key_id_start
        .checked_add(key_id_len)
        .ok_or_else(|| invalid("protected operation detail seal response is invalid"))?;
    let ciphertext_start = nonce_start
        .checked_add(NONCE_BYTES)
        .ok_or_else(|| invalid("protected operation detail seal response is invalid"))?;
    let expected_ciphertext_bytes = plaintext
        .len()
        .checked_add(AEAD_TAG_BYTES)
        .ok_or_else(|| invalid("protected operation detail seal response is invalid"))?;
    if ciphertext_start
        .checked_add(expected_ciphertext_bytes)
        .filter(|length| *length == response.len())
        .is_none()
    {
        return Err(invalid(
            "protected operation detail seal response has an invalid length",
        ));
    }
    let key_id = std::str::from_utf8(&response[key_id_start..nonce_start])
        .ok()
        .filter(|key_id| !key_id.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| invalid("protected operation detail seal key id is invalid"))?;
    let nonce: [u8; NONCE_BYTES] = response[nonce_start..ciphertext_start]
        .try_into()
        .map_err(|_| invalid("protected operation detail seal nonce is invalid"))?;
    let ciphertext = &response[ciphertext_start..];
    tx.execute(
        "INSERT INTO _snapback_operation_protected_detail_v1(
           custody_reference,key_id,nonce,ciphertext,payload_digest,payload_bytes
         ) VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            custody_reference,
            key_id,
            nonce.as_slice(),
            ciphertext,
            payload_digest,
            i64::try_from(payload_bytes)
                .map_err(|_| invalid("protected operation detail is too large"))?,
        ],
    )?;
    Ok(payload_bytes)
}

pub fn open(
    conn: &Connection,
    custody_reference: &str,
    payload_digest: &str,
) -> SnapbackResult<Option<Value>> {
    let row: Option<(String, Vec<u8>, Vec<u8>, i64)> = conn
        .query_row(
            "SELECT key_id,nonce,ciphertext,payload_bytes
             FROM _snapback_operation_protected_detail_v1
             WHERE custody_reference=?1 AND payload_digest=?2",
            params![custody_reference, payload_digest],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let Some((stored_key_id, nonce, ciphertext, payload_bytes)) = row else {
        return Ok(None);
    };
    if nonce.len() != NONCE_BYTES || payload_bytes < 0 {
        return Err(invalid(
            "protected operation detail custody metadata is invalid",
        ));
    }
    let response: Vec<u8> = conn
        .query_row(
            &format!("SELECT {KEY_CRYPTO_FUNCTION}('open-v1',?1,?2,?3,?4,?5)"),
            params![
                custody_reference,
                payload_digest,
                stored_key_id,
                nonce,
                ciphertext
            ],
            |row| row.get(0),
        )
        .map_err(|_| invalid("protected operation detail crypto is not installed"))?;
    let response = Zeroizing::new(response);
    match response.as_slice() {
        [CRYPTO_RESPONSE_METADATA_INVALID] => {
            return Err(invalid(
                "protected operation detail custody metadata is invalid",
            ));
        }
        [CRYPTO_RESPONSE_AUTH_FAILED] => {
            return Err(invalid("protected operation detail authentication failed"));
        }
        _ => {}
    }
    if response.get(..2) != Some(&[CRYPTO_RESPONSE_OK, CRYPTO_RESPONSE_VERSION]) {
        return Err(invalid(
            "protected operation detail open response is invalid",
        ));
    }
    let plaintext = &response[2..];
    if plaintext.len() != payload_bytes as usize {
        return Err(invalid(
            "protected operation detail length does not match custody",
        ));
    }
    serde_json::from_slice(plaintext)
        .map(Some)
        .map_err(|_| invalid("protected operation detail plaintext is invalid"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Barrier};

    #[test]
    fn installed_key_uses_no_temp_database_and_protected_detail_round_trips() {
        let mut conn = Connection::open_in_memory().expect("database");
        install(&conn, None).expect("install protected custody");
        let attached_temp_databases = |conn: &Connection| {
            conn.query_row(
                "SELECT COUNT(*) FROM pragma_database_list WHERE name='temp'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("inspect attached databases")
        };
        assert_eq!(
            attached_temp_databases(&conn),
            0,
            "key custody must not attach a TEMP pager"
        );

        let tx = conn.transaction().expect("protected detail transaction");
        crate::operation_ledger::create_infra(&tx).expect("operation infra");
        let digest = format!("sha256:{}", "a".repeat(64));
        let expected = json!({ "secret": "round-trip" });
        seal_in(&tx, "operation-detail:test:round-trip", &digest, &expected)
            .expect("seal protected detail");
        tx.commit().expect("commit protected detail");
        assert_eq!(
            open(&conn, "operation-detail:test:round-trip", &digest)
                .expect("open protected detail"),
            Some(expected)
        );
        assert_eq!(
            attached_temp_databases(&conn),
            0,
            "a real protected-detail round trip must not attach a TEMP pager"
        );
    }

    #[test]
    fn installed_crypto_refuses_indirect_schema_invocation() {
        let mut conn = Connection::open_in_memory().expect("database");
        install(&conn, None).expect("install protected custody");
        let digest = format!("sha256:{}", "a".repeat(64));
        let tx = conn.transaction().expect("protected detail transaction");
        crate::operation_ledger::create_infra(&tx).expect("operation infra");
        seal_in(
            &tx,
            "operation-detail:test:direct-only",
            &digest,
            &json!({ "secret": "install-function" }),
        )
        .expect("first seal installs protected custody");
        tx.commit().expect("commit protected detail");
        conn.execute_batch(&format!(
            "CREATE VIEW _snapback_operation_detail_indirect_probe_v1 AS
             SELECT {KEY_CRYPTO_FUNCTION}(
               'seal-v1',
               'operation-detail:test:indirect',
               '{digest}',
               X'7B7D'
             ) AS packed;"
        ))
        .expect("create indirect probe view");
        let error = conn
            .query_row(
                "SELECT packed FROM _snapback_operation_detail_indirect_probe_v1",
                [],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .expect_err("DIRECTONLY crypto must refuse view invocation");
        let detail = error.to_string();
        assert!(
            detail.contains("unsafe use of"),
            "unexpected error: {detail}"
        );
        assert!(
            detail.contains(KEY_CRYPTO_FUNCTION),
            "unexpected error: {detail}"
        );
    }

    #[test]
    fn empty_file_database_defers_sidecar_until_first_seal_and_reopens() {
        let directory = tempfile::tempdir().expect("tempdir");
        let database = directory.path().join("app.sqlite3");
        let key_path = keyring_path(&database);
        let mut conn = Connection::open(&database).expect("database");

        install(&conn, Some(&database)).expect("install lazy protected custody");
        assert!(
            !crypto_function_is_installed(&conn).expect("inspect crypto registration"),
            "opening an empty database must not retain the protected-detail crypto function"
        );
        assert!(
            !key_path.exists(),
            "opening an empty database must not mint a protected-detail sidecar"
        );
        let tx = conn.transaction().expect("infra transaction");
        crate::operation_ledger::create_infra(&tx).expect("operation infra");
        tx.commit().expect("commit infra");
        let digest = format!("sha256:{}", "b".repeat(64));
        assert_eq!(
            open(&conn, "operation-detail:test:lazy", &digest)
                .expect("open absent protected detail"),
            None
        );
        assert!(
            !key_path.exists(),
            "an absent detail read must not mint a protected-detail sidecar"
        );

        let expected = json!({ "secret": "persist-on-first-seal" });
        let tx = conn.transaction().expect("protected detail transaction");
        seal_in(&tx, "operation-detail:test:lazy", &digest, &expected)
            .expect("first seal initializes protected custody");
        assert!(
            crypto_function_is_installed(&tx).expect("inspect crypto registration"),
            "the first protected write must install the direct-only crypto function"
        );
        assert!(
            persisted_file_has_key(&database),
            "the first protected write must persist its owner-only sidecar before the row"
        );
        tx.commit().expect("commit protected detail");
        drop(conn);

        let reopened = Connection::open(&database).expect("reopen database");
        install(&reopened, Some(&database)).expect("authenticate retained custody at boot");
        assert_eq!(
            open(&reopened, "operation-detail:test:lazy", &digest)
                .expect("open protected detail after restart"),
            Some(expected)
        );
    }

    // APFS refuses non-UTF-8 filenames, so this Unix path-carrier regression
    // is executable on platforms whose filesystems admit the SQLite name.
    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn non_utf8_database_path_persists_first_seal_custody_and_reopens() {
        use std::{ffi::OsString, os::unix::ffi::OsStringExt as _};

        let directory = tempfile::tempdir().expect("tempdir");
        let database = directory
            .path()
            .join(OsString::from_vec(b"app-\xFF.sqlite3".to_vec()));
        let key_path = keyring_path(&database);
        let mut conn = Connection::open(&database).expect("non-UTF-8 database");
        install(&conn, Some(&database)).expect("install dormant protected custody");
        let tx = conn.transaction().expect("infra transaction");
        crate::operation_ledger::create_infra(&tx).expect("operation infra");
        tx.commit().expect("commit infra");

        let digest = format!("sha256:{}", "f".repeat(64));
        let expected = json!({ "secret": "non-utf8-path" });
        let tx = conn.transaction().expect("protected detail transaction");
        seal_in(
            &tx,
            "operation-detail:test:non-utf8-path",
            &digest,
            &expected,
        )
        .expect("first seal recovers the raw SQLite filename");
        tx.commit().expect("commit protected detail");
        assert!(
            persisted_file_has_key(&database),
            "first seal on a non-UTF-8 path must persist its sidecar"
        );
        assert_eq!(
            key_path,
            directory
                .path()
                .join("snapback.db.operation-detail-keyring.json")
        );
        drop(conn);

        let reopened = Connection::open(&database).expect("reopen non-UTF-8 database");
        install(&reopened, Some(&database)).expect("authenticate retained custody at boot");
        assert_eq!(
            open(&reopened, "operation-detail:test:non-utf8-path", &digest)
                .expect("open protected detail after restart"),
            Some(expected)
        );
    }

    #[test]
    fn explicitly_minted_empty_sidecar_is_reused_on_first_seal() {
        let directory = tempfile::tempdir().expect("tempdir");
        let database = directory.path().join("fork.sqlite3");
        let key_path = keyring_path(&database);
        let mut conn = Connection::open(&database).expect("database");
        let tx = conn.transaction().expect("infra transaction");
        crate::operation_ledger::create_infra(&tx).expect("operation infra");
        tx.commit().expect("commit infra");
        mint_new_sidecar(&database).expect("explicit fork sidecar mint");
        let minted = crate::secure_file::read_owner_only(&key_path).expect("minted sidecar");

        install(&conn, Some(&database)).expect("install lazy protected custody");
        let tx = conn.transaction().expect("protected detail transaction");
        seal_in(
            &tx,
            "operation-detail:test:explicit-mint",
            &format!("sha256:{}", "c".repeat(64)),
            &json!({ "secret": "fork-private" }),
        )
        .expect("seal with explicitly minted key");
        tx.commit().expect("commit protected detail");
        assert_eq!(
            crate::secure_file::read_owner_only(&key_path).expect("retained sidecar"),
            minted,
            "lazy initialization must not replace an explicitly minted fork sidecar"
        );
    }

    #[test]
    fn concurrent_first_key_publication_converges_on_one_complete_sidecar() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("app.operation-detail-key.json");
        let barrier = Arc::new(Barrier::new(2));
        let mut publishers = Vec::new();
        for _ in 0..2 {
            let path = path.clone();
            let barrier = Arc::clone(&barrier);
            publishers.push(std::thread::spawn(move || {
                let key = generate_key().expect("generate publication candidate");
                let key_id = key.key_id.clone();
                barrier.wait();
                let publication =
                    publish_key_candidate(&path, &key).expect("publish or join key sidecar");
                (key_id, publication)
            }));
        }
        let outcomes = publishers
            .into_iter()
            .map(|publisher| publisher.join().expect("publisher thread"))
            .collect::<Vec<_>>();
        assert_eq!(
            outcomes
                .iter()
                .filter(|(_, result)| *result == KeyPublication::Published)
                .count(),
            1
        );
        assert_eq!(
            outcomes
                .iter()
                .filter(|(_, result)| *result == KeyPublication::Existing)
                .count(),
            1
        );
        let loaded = load_key(&path).expect("atomically published complete sidecar");
        let published_id = outcomes
            .iter()
            .find_map(|(key_id, result)| (*result == KeyPublication::Published).then_some(key_id))
            .expect("published candidate identity");
        assert_eq!(&loaded.key_id, published_id);
        assert!(
            std::fs::read_dir(directory.path())
                .expect("sidecar directory")
                .all(|entry| !entry
                    .expect("sidecar directory entry")
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")),
            "atomic publication must not retain a losing key candidate"
        );
    }

    #[test]
    fn parent_sync_failure_refuses_ciphertext_commit_and_retry_converges() {
        let directory = tempfile::tempdir().expect("tempdir");
        let database = directory.path().join("app.sqlite3");
        let mut conn = Connection::open(&database).expect("database");
        install(&conn, Some(&database)).expect("install lazy protected custody");
        let tx = conn.transaction().expect("infra transaction");
        crate::operation_ledger::create_infra(&tx).expect("operation infra");
        tx.commit().expect("commit infra");
        let digest = format!("sha256:{}", "e".repeat(64));

        FAIL_NEXT_KEY_PARENT_SYNC.with(|fail| fail.set(true));
        let tx = conn.transaction().expect("protected detail transaction");
        let error = seal_in(
            &tx,
            "operation-detail:test:parent-sync",
            &digest,
            &json!({ "secret": "must-not-commit-before-directory-sync" }),
        )
        .expect_err("parent sync failure must refuse the ciphertext write");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_OPERATION_PROTECTED_CUSTODY_INVALID"
        );
        drop(tx);
        let retained: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM _snapback_operation_protected_detail_v1",
                [],
                |row| row.get(0),
            )
            .expect("count retained ciphertext");
        assert_eq!(retained, 0, "failed parent sync must commit no ciphertext");

        let expected = json!({ "secret": "retry-after-directory-sync" });
        let tx = conn
            .transaction()
            .expect("retry protected detail transaction");
        seal_in(&tx, "operation-detail:test:parent-sync", &digest, &expected)
            .expect("retry loads the complete sidecar and syncs its parent");
        tx.commit().expect("commit retry");
        assert_eq!(
            open(&conn, "operation-detail:test:parent-sync", &digest)
                .expect("open retried protected detail"),
            Some(expected)
        );
    }

    #[test]
    fn retained_ciphertext_without_sidecar_refuses_at_boot() {
        let directory = tempfile::tempdir().expect("tempdir");
        let database = directory.path().join("app.sqlite3");
        let mut conn = Connection::open(&database).expect("database");
        install(&conn, Some(&database)).expect("initial custody");
        let tx = conn.transaction().expect("protected detail transaction");
        crate::operation_ledger::create_infra(&tx).expect("operation infra");
        seal_in(
            &tx,
            "operation-detail:test:missing-sidecar",
            &format!("sha256:{}", "d".repeat(64)),
            &json!({ "secret": "retained" }),
        )
        .expect("seal protected detail");
        tx.commit().expect("commit protected detail");
        drop(conn);

        std::fs::remove_file(keyring_path(&database)).expect("remove sidecar");
        let reopened = Connection::open(&database).expect("reopen database");
        let error = install(&reopened, Some(&database))
            .expect_err("retained ciphertext without its sidecar must fail at boot");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_OPERATION_PROTECTED_CUSTODY_INVALID"
        );
    }

    #[test]
    fn swapped_well_formed_secret_with_retained_key_id_refuses_at_boot() {
        let directory = tempfile::tempdir().expect("tempdir");
        let database = directory.path().join("app.sqlite3");
        let mut conn = Connection::open(&database).expect("database");
        install(&conn, Some(&database)).expect("initial custody");
        let tx = conn.transaction().expect("protected detail transaction");
        crate::operation_ledger::create_infra(&tx).expect("operation infra");
        seal_in(
            &tx,
            "operation-detail:test:reads",
            &format!("sha256:{}", "a".repeat(64)),
            &json!({ "secret": "parent" }),
        )
        .expect("seal protected detail");
        tx.commit().expect("commit protected detail");
        drop(conn);

        let key_path = keyring_path(&database);
        let original = crate::secure_file::read_owner_only(&key_path).expect("original sidecar");
        let original_key = decode_key(&original).expect("valid sidecar");
        let forged_secret = if *original_key.secret == [7_u8; KEY_BYTES] {
            [8_u8; KEY_BYTES]
        } else {
            [7_u8; KEY_BYTES]
        };
        let forged = serde_json::to_vec(&PersistedKeyV1 {
            format_version: FORMAT_VERSION,
            key_id: original_key.key_id,
            secret: URL_SAFE_NO_PAD.encode(forged_secret),
        })
        .expect("forged sidecar encoding");
        crate::secure_file::write_owner_only(&key_path, &forged)
            .expect("replace with same-id wrong-secret sidecar");

        let reopened = Connection::open(&database).expect("reopen database");
        let error = install(&reopened, Some(&database))
            .expect_err("a well-formed swapped sidecar must fail at boot");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_OPERATION_PROTECTED_CUSTODY_INVALID"
        );
    }
}
