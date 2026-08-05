//! Encrypted custody for secret-bearing operation-envelope detail.
//!
//! The data database retains only XChaCha20-Poly1305 ciphertext. Its root key
//! lives in a separate owner-only sidecar and is installed into a direct-only
//! function on the owning SQLite connection so transaction-local envelope code
//! can seal detail without widening the public storage API or retaining a TEMP
//! database pager solely for key custody.

use std::path::{Path, PathBuf};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::Zeroizing;

use crate::diagnostic::{SnapbackError, SnapbackResult};

const FORMAT_VERSION: u32 = 1;
const KEY_BYTES: usize = 32;
const PURPOSE: &[u8] = b"snapback:operation-protected-detail:xchacha20:v1";
const MAX_KEY_FILE_BYTES: usize = 4 * 1024;
const KEY_PROJECTION_FUNCTION: &str = "__snapback_operation_detail_key_v1";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedKeyV1 {
    format_version: u32,
    key_id: String,
    secret: String,
}

fn invalid(detail: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_OPERATION_PROTECTED_CUSTODY_INVALID",
        "storage",
        detail.into(),
    )
}

pub(crate) fn keyring_path(database: &Path) -> PathBuf {
    let name = database
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("snapback.db");
    database.with_file_name(format!("{name}.operation-detail-keyring.json"))
}

pub(crate) fn persisted_file_has_key(database: &Path) -> bool {
    crate::secure_file::read_owner_only(&keyring_path(database))
        .ok()
        .and_then(|bytes| decode_key(&bytes))
        .is_some()
}

pub(crate) fn mint_new_sidecar(database: &Path) -> SnapbackResult<()> {
    let path = keyring_path(database);
    if path.exists() {
        return Err(invalid(
            "protected operation detail key sidecar already exists",
        ));
    }
    let key_id = crate::ids::mint_time_ordered(crate::ids::Kind::Opaque);
    let mut secret = [0_u8; KEY_BYTES];
    getrandom::fill(&mut secret)
        .map_err(|_| invalid("protected operation detail key generation failed"))?;
    let bytes = serde_json::to_vec(&PersistedKeyV1 {
        format_version: FORMAT_VERSION,
        key_id,
        secret: URL_SAFE_NO_PAD.encode(secret),
    })
    .map_err(|_| invalid("protected operation detail key could not be encoded"))?;
    crate::secure_file::write_new_owner_only(&path, &bytes)
        .map_err(|_| invalid("protected operation detail key sidecar could not be persisted"))
}

fn decode_key(bytes: &[u8]) -> Option<(String, [u8; KEY_BYTES])> {
    if bytes.len() > MAX_KEY_FILE_BYTES {
        return None;
    }
    let persisted: PersistedKeyV1 = serde_json::from_slice(bytes).ok()?;
    if persisted.format_version != FORMAT_VERSION || persisted.key_id.is_empty() {
        return None;
    }
    let secret = URL_SAFE_NO_PAD.decode(persisted.secret).ok()?;
    Some((persisted.key_id, secret.try_into().ok()?))
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
    let row: Option<(String, String, String, Vec<u8>, Vec<u8>, i64)> = conn
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

/// Install one process-local key projection. Existing ciphertext makes a
/// missing/corrupt sidecar a hard fail-closed condition; a new empty database
/// may create its first key.
pub(crate) fn install(conn: &Connection, database_path: Option<&Path>) -> SnapbackResult<()> {
    let retained_ciphertext = retained_ciphertext_exists(conn)?;
    let persisted = database_path.map(keyring_path);
    let loaded = persisted
        .as_ref()
        .and_then(|path| crate::secure_file::read_owner_only(path).ok())
        .and_then(|bytes| decode_key(&bytes));
    let (key_id, secret) = match loaded {
        Some(key) => key,
        None if retained_ciphertext => {
            return Err(invalid(
                "protected operation detail exists but its owner-only key sidecar is unavailable",
            ));
        }
        None => {
            let key_id = crate::ids::mint_time_ordered(crate::ids::Kind::Opaque);
            let mut secret = [0_u8; KEY_BYTES];
            getrandom::fill(&mut secret)
                .map_err(|_| invalid("protected operation detail key generation failed"))?;
            if let Some(path) = &persisted {
                let bytes = serde_json::to_vec(&PersistedKeyV1 {
                    format_version: FORMAT_VERSION,
                    key_id: key_id.clone(),
                    secret: URL_SAFE_NO_PAD.encode(secret),
                })
                .map_err(|_| invalid("protected operation detail key could not be encoded"))?;
                crate::secure_file::write_owner_only(path, &bytes).map_err(|_| {
                    invalid("protected operation detail key sidecar could not be persisted")
                })?;
            }
            (key_id, secret)
        }
    };
    if retained_ciphertext {
        let mismatched: bool = conn.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM _snapback_operation_protected_detail_v1
                WHERE key_id<>?1 LIMIT 1
             )",
            [&key_id],
            |row| row.get(0),
        )?;
        if mismatched {
            return Err(invalid(
                "protected operation detail does not match its owner-only key sidecar",
            ));
        }
        authenticate_retained_ciphertext(conn, &key_id, &secret)?;
    }
    let key_id_bytes = key_id.as_bytes();
    let key_id_len = u32::try_from(key_id_bytes.len())
        .map_err(|_| invalid("protected operation detail key id is too large"))?;
    let mut projection = Zeroizing::new(Vec::with_capacity(
        std::mem::size_of::<u32>() + key_id_bytes.len() + KEY_BYTES,
    ));
    projection.extend_from_slice(&key_id_len.to_be_bytes());
    projection.extend_from_slice(key_id_bytes);
    projection.extend_from_slice(&secret);
    // @ref LLP 0163#implementation-record--2026-08-04-explanation-and-protected-custody — the root key stays connection-local without retaining a second SQLite pager.
    conn.create_scalar_function(
        KEY_PROJECTION_FUNCTION,
        0,
        rusqlite::functions::FunctionFlags::SQLITE_UTF8
            | rusqlite::functions::FunctionFlags::SQLITE_DIRECTONLY,
        move |_| Ok(projection.as_slice().to_vec()),
    )?;
    Ok(())
}

fn key(conn: &Connection) -> SnapbackResult<(String, [u8; KEY_BYTES])> {
    let projection: Vec<u8> = conn
        .query_row(&format!("SELECT {KEY_PROJECTION_FUNCTION}()"), [], |row| {
            row.get(0)
        })
        .map_err(|_| invalid("protected operation detail key is not installed"))?;
    let projection = Zeroizing::new(projection);
    let key_id_len = projection
        .get(..std::mem::size_of::<u32>())
        .and_then(|bytes| bytes.try_into().ok())
        .map(u32::from_be_bytes)
        .and_then(|length| usize::try_from(length).ok())
        .ok_or_else(|| invalid("protected operation detail key projection is invalid"))?;
    let secret_offset = std::mem::size_of::<u32>()
        .checked_add(key_id_len)
        .ok_or_else(|| invalid("protected operation detail key projection is invalid"))?;
    if secret_offset
        .checked_add(KEY_BYTES)
        .filter(|length| *length == projection.len())
        .is_none()
    {
        return Err(invalid(
            "protected operation detail key projection has an invalid length",
        ));
    }
    let key_id = std::str::from_utf8(
        projection
            .get(std::mem::size_of::<u32>()..secret_offset)
            .ok_or_else(|| invalid("protected operation detail key projection is invalid"))?,
    )
    .ok()
    .filter(|key_id| !key_id.is_empty())
    .map(str::to_owned)
    .ok_or_else(|| invalid("protected operation detail key id is invalid"))?;
    let secret = projection[secret_offset..]
        .try_into()
        .map_err(|_| invalid("protected operation detail key has an invalid length"))?;
    Ok((key_id, secret))
}

fn aad(custody_reference: &str, payload_digest: &str) -> Vec<u8> {
    let mut aad = PURPOSE.to_vec();
    for value in [custody_reference.as_bytes(), payload_digest.as_bytes()] {
        aad.extend_from_slice(&(value.len() as u32).to_be_bytes());
        aad.extend_from_slice(value);
    }
    aad
}

pub(crate) fn seal_in(
    tx: &Transaction<'_>,
    custody_reference: &str,
    payload_digest: &str,
    detail: &Value,
) -> SnapbackResult<u64> {
    let plaintext = serde_json::to_vec(detail)
        .map_err(|_| invalid("protected operation detail could not be encoded"))?;
    let payload_bytes = u64::try_from(plaintext.len())
        .map_err(|_| invalid("protected operation detail length overflowed"))?;
    let (key_id, secret) = key(tx)?;
    let mut nonce = [0_u8; 24];
    getrandom::fill(&mut nonce)
        .map_err(|_| invalid("protected operation detail nonce generation failed"))?;
    let ciphertext = XChaCha20Poly1305::new((&secret).into())
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: &aad(custody_reference, payload_digest),
            },
        )
        .map_err(|_| invalid("protected operation detail encryption failed"))?;
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

pub(crate) fn open(
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
    let (key_id, secret) = key(conn)?;
    if stored_key_id != key_id || nonce.len() != 24 || payload_bytes < 0 {
        return Err(invalid(
            "protected operation detail custody metadata is invalid",
        ));
    }
    let plaintext = XChaCha20Poly1305::new((&secret).into())
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: &aad(custody_reference, payload_digest),
            },
        )
        .map_err(|_| invalid("protected operation detail authentication failed"))?;
    if plaintext.len() != payload_bytes as usize {
        return Err(invalid(
            "protected operation detail length does not match custody",
        ));
    }
    serde_json::from_slice(&plaintext)
        .map(Some)
        .map_err(|_| invalid("protected operation detail plaintext is invalid"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn installed_key_uses_no_temp_schema_and_protected_detail_round_trips() {
        let mut conn = Connection::open_in_memory().expect("database");
        install(&conn, None).expect("install protected custody");
        let temp_objects: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_temp_schema WHERE name NOT GLOB 'sqlite_*'",
                [],
                |row| row.get(0),
            )
            .expect("inspect temp schema");
        assert_eq!(temp_objects, 0, "key custody must not retain a TEMP pager");

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
        let (retained_key_id, original_secret) = decode_key(&original).expect("valid sidecar");
        let forged_secret = if original_secret == [7_u8; KEY_BYTES] {
            [8_u8; KEY_BYTES]
        } else {
            [7_u8; KEY_BYTES]
        };
        let forged = serde_json::to_vec(&PersistedKeyV1 {
            format_version: FORMAT_VERSION,
            key_id: retained_key_id,
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
