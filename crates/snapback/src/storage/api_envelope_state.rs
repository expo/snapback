use super::*;

const META_API_ENVELOPE_STATE: &str = "api_envelope.state";
const META_API_ENVELOPE_BYTES_PREFIX: &str = "api_envelope.bytes.";

/// The persisted api-envelope disposition (LLP 0062 §5, server-composed).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ApiEnvelopeStateRecord {
    pub current: Option<ApiEnvelopeCurrentRecord>,
    pub previous: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ApiEnvelopeCurrentRecord {
    pub digest: String,
    pub inputs_hash: String,
}

impl LocalDatabase {
    /// Load the served api-envelope state (LLP 0062 §5, server-composed).
    /// `current` binds the digest to the inputsHash it was composed for, so a
    /// crash between activation and this record self-heals on read: a record
    /// whose inputsHash disagrees with the active generation serves the typed
    /// absent marker instead of a stale envelope.
    pub(super) fn load_api_envelope_state(&self) -> SnapbackResult<Option<ApiEnvelopeStateRecord>> {
        let value: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![META_API_ENVELOPE_STATE],
                |row| row.get(0),
            )
            .optional()?;
        value
            .map(|value| {
                serde_json::from_str(&value).map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_APP_API_STATE_PARSE_FAILED",
                        "app-api",
                        "stored api-envelope state could not be parsed",
                    )
                    .with_detail("error", error.to_string())
                })
            })
            .transpose()
    }

    /// Record the activation's envelope disposition, rotating the previous
    /// generation's envelope into the one-deep retention window LLP 0062 §5
    /// pins (the deploy race window), and dropping anything older.
    pub(super) fn record_api_envelope(
        &mut self,
        inputs_hash: &str,
        composed: Option<(&str, &str)>, // (digest, canonical bytes)
    ) -> SnapbackResult<()> {
        let prior = self.load_api_envelope_state()?;
        let mut retained: Vec<String> = Vec::new();
        let previous = prior
            .as_ref()
            .and_then(|state| state.current.as_ref().map(|current| current.digest.clone()));
        let current = composed.map(|(digest, _)| ApiEnvelopeCurrentRecord {
            digest: digest.to_string(),
            inputs_hash: inputs_hash.to_string(),
        });
        if let Some(current) = &current {
            retained.push(current.digest.clone());
        }
        // A redeploy of the identical envelope keeps one copy and no rotation.
        let previous = previous.filter(|digest| {
            current
                .as_ref()
                .is_none_or(|current| current.digest != *digest)
        });
        if let Some(previous) = &previous {
            retained.push(previous.clone());
        }
        let state = ApiEnvelopeStateRecord { current, previous };
        let state_json = serde_json::to_string(&state).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_APP_API_STATE_PARSE_FAILED",
                "app-api",
                "api-envelope state could not be serialized",
            )
            .with_detail("error", error.to_string())
        })?;
        let transaction = self.conn.transaction()?;
        transaction.execute(
            "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![META_API_ENVELOPE_STATE, state_json],
        )?;
        if let Some((digest, canonical)) = composed {
            transaction.execute(
                "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![
                    format!("{META_API_ENVELOPE_BYTES_PREFIX}{digest}"),
                    canonical
                ],
            )?;
        }
        // Evict every stored envelope outside the retention window.
        let mut evict =
            transaction.prepare("SELECT key FROM _snapback_meta WHERE key LIKE ?1 ESCAPE '\\'")?;
        let stored: Vec<String> = evict
            .query_map(
                params![format!(
                    "{}%",
                    META_API_ENVELOPE_BYTES_PREFIX.replace('_', "\\_")
                )],
                |row| row.get::<_, String>(0),
            )?
            .collect::<Result<_, _>>()?;
        drop(evict);
        for key in stored {
            let digest = key
                .strip_prefix(META_API_ENVELOPE_BYTES_PREFIX)
                .unwrap_or_default();
            if !retained.iter().any(|kept| kept == digest) {
                transaction.execute("DELETE FROM _snapback_meta WHERE key = ?1", params![key])?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    /// The canonical bytes for a retained envelope digest, if still within
    /// the retention window.
    pub(super) fn load_api_envelope_bytes(&self, digest: &str) -> SnapbackResult<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![format!("{META_API_ENVELOPE_BYTES_PREFIX}{digest}")],
                |row| row.get(0),
            )
            .optional()?)
    }
}

/// Narrow typed access to served API-envelope persistence.
///
/// @ref LLP 0225#1-ownership-map — storage callers enter the kernel
/// through typed operations instead of the wide `LocalDatabase` surface.
pub struct ApiEnvelopeKernel<'a> {
    db: &'a mut LocalDatabase,
}

impl<'a> ApiEnvelopeKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self { db }
    }

    pub fn load_api_envelope_state(&self) -> SnapbackResult<Option<ApiEnvelopeStateRecord>> {
        self.db.load_api_envelope_state()
    }

    pub fn record_api_envelope(
        &mut self,
        inputs_hash: &str,
        composed: Option<(&str, &str)>,
    ) -> SnapbackResult<()> {
        self.db.record_api_envelope(inputs_hash, composed)
    }

    pub fn load_api_envelope_bytes(&self, digest: &str) -> SnapbackResult<Option<String>> {
        self.db.load_api_envelope_bytes(digest)
    }
}

/// Shared-borrow served API-envelope reads for callers holding `&LocalDatabase`.
pub struct ApiEnvelopeReadKernel<'a> {
    db: &'a LocalDatabase,
}

impl<'a> ApiEnvelopeReadKernel<'a> {
    pub(super) fn new(db: &'a LocalDatabase) -> Self {
        Self { db }
    }

    pub fn load_api_envelope_state(&self) -> SnapbackResult<Option<ApiEnvelopeStateRecord>> {
        self.db.load_api_envelope_state()
    }

    pub fn load_api_envelope_bytes(&self, digest: &str) -> SnapbackResult<Option<String>> {
        self.db.load_api_envelope_bytes(digest)
    }
}
