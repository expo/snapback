//! Versioned seed identity and idempotent operation receipts.
//!
//! This module deliberately owns only protected metadata. Application-row
//! installation remains in `storage`, which calls these helpers inside the
//! same SQLite transaction as seed writes and stream rotation.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::SeedData;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const SEED_ARTIFACT_FORMAT_V1: &str = "snapback.seed.v1";
pub const SEED_RECEIPT_FORMAT_V1: &str = "snapback.seed.receipt.v1";
pub const SEED_INSTALL_REQUEST_FORMAT_V1: &str = "snapback.seed.install-request.v1";
pub const SEED_RESET_REQUEST_FORMAT_V1: &str = "snapback.seed.reset-request.v1";
pub const SEED_PREVIEW_REQUEST_FORMAT_V1: &str = "snapback.seed.preview-request.v1";
pub const SEED_MATCHED_OBSERVATION_FORMAT_V1: &str = "snapback.seed.matched-observation.v1";
pub const VERSIONED_SEED_MAX_EFFECTS_V1: usize = 1_024;
pub const SEED_ASSET_FIXTURES_FORMAT_V1: &str = "snapback.seed-asset-fixtures.v1";
pub const SEED_ASSET_FIXTURES_MAX_V1: usize = 256;
const ARTIFACT_DIGEST_DOMAIN: &[u8] = b"snapback:seed-artifact:v1\n";
const ASSET_FIXTURES_DIGEST_DOMAIN: &[u8] = b"snapback:seed-asset-fixtures:v1\n";
const INSTALL_REQUEST_DIGEST_DOMAIN: &[u8] = b"snapback:seed-install-request:v1\n";
const RESET_REQUEST_DIGEST_DOMAIN: &[u8] = b"snapback:seed-reset-request:v1\n";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeedArtifactV1 {
    pub format_version: String,
    pub app_id: String,
    pub seed_version: String,
    pub seed_digest: String,
    pub tables: std::collections::BTreeMap<String, Vec<serde_json::Map<String, Value>>>,
}

/// One committed binary fixture (LLP 0109 §17): bytes live as a file with
/// the app's seed assets, never inside any artifact; `source_digest` covers
/// the committed source bytes (canonical published bytes may differ after
/// privacy rewriting — that is the trusted path, not drift).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeedAssetFixtureV1 {
    pub id: String,
    pub upload: String,
    pub file: String,
    pub media_type: String,
    pub source_digest: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeedAssetFixturesV1 {
    pub format_version: String,
    pub app_id: String,
    pub fixtures_digest: String,
    pub fixtures: Vec<SeedAssetFixtureV1>,
}

impl SeedAssetFixturesV1 {
    pub fn validate(&self) -> SnapbackResult<()> {
        if self.format_version != SEED_ASSET_FIXTURES_FORMAT_V1 {
            return Err(invalid("seed asset fixtures format is unsupported"));
        }
        if self.app_id.is_empty() {
            return Err(invalid("seed asset fixtures appId is empty"));
        }
        if self.fixtures.is_empty() || self.fixtures.len() > SEED_ASSET_FIXTURES_MAX_V1 {
            return Err(invalid("seed asset fixtures count is outside bounds"));
        }
        let mut seen = std::collections::BTreeSet::new();
        for fixture in &self.fixtures {
            if !valid_seed_version(&fixture.id) {
                return Err(invalid("fixture id is not a portable identity token"));
            }
            if !seen.insert(fixture.id.as_str()) {
                return Err(invalid("fixture ids must be unique"));
            }
            if fixture.upload.is_empty() {
                return Err(invalid("fixture upload intent is empty"));
            }
            if fixture.media_type.is_empty() {
                return Err(invalid("fixture mediaType is empty"));
            }
            if !valid_fixture_source_path(&fixture.file) {
                return Err(invalid(
                    "fixture file must be a relative path with no traversal",
                ));
            }
            if !valid_sha256_digest(&fixture.source_digest) {
                return Err(invalid("fixture sourceDigest is not sha256:<64 hex>"));
            }
        }
        let observed = asset_fixtures_digest(self)?;
        if self.fixtures_digest != observed {
            return Err(invalid(
                "fixturesDigest does not match the canonical fixtures artifact",
            ));
        }
        Ok(())
    }

    pub fn fixture(&self, id: &str) -> Option<&SeedAssetFixtureV1> {
        self.fixtures.iter().find(|fixture| fixture.id == id)
    }
}

pub fn asset_fixtures_digest(fixtures: &SeedAssetFixturesV1) -> SnapbackResult<String> {
    let body = serde_json::json!({
        "formatVersion": fixtures.format_version,
        "appId": fixtures.app_id,
        "fixtures": fixtures.fixtures,
    });
    tagged_digest(ASSET_FIXTURES_DIGEST_DOMAIN, &body, true)
}

fn valid_fixture_source_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 512
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains("..")
        && path.split('/').all(|segment| !segment.is_empty())
}

fn valid_sha256_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    })
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstallSeedRequestV1 {
    pub format_version: String,
    pub operation_id: String,
    pub artifact: SeedArtifactV1,
    pub requested_mode: crate::manifest::AuthMode,
    /// LLP 0109 §17: fixture-bearing seeds attach the fixtures artifact so
    /// placeholder resolution can bind ingested assets inside the install
    /// transaction. Absent for ordinary seeds; old digests are unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_fixtures: Option<SeedAssetFixturesV1>,
}

impl InstallSeedRequestV1 {
    pub fn validate(&self) -> SnapbackResult<()> {
        if self.format_version != SEED_INSTALL_REQUEST_FORMAT_V1 {
            return Err(invalid("install request format is unsupported"));
        }
        validate_operation_id(&self.operation_id)?;
        self.artifact.validate()?;
        if let Some(fixtures) = &self.asset_fixtures {
            fixtures.validate()?;
            if fixtures.app_id != self.artifact.app_id {
                return Err(invalid("fixtures artifact appId does not match the seed"));
            }
        }
        Ok(())
    }

    pub fn request_digest(&self) -> SnapbackResult<String> {
        self.validate()?;
        install_request_digest(
            &serde_json::to_value(self)
                .map_err(|_| invalid("install request could not be projected"))?,
        )
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResetSeedRequestV1 {
    pub format_version: String,
    pub operation_id: String,
    pub operation: SeedResetOperationV1,
    pub requested_mode: crate::manifest::AuthMode,
    pub expected_data_version_stream: ExpectedDataVersionStreamV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact: Option<SeedArtifactV1>,
}

impl ResetSeedRequestV1 {
    pub fn validate(&self) -> SnapbackResult<()> {
        if self.format_version != SEED_RESET_REQUEST_FORMAT_V1 {
            return Err(invalid("reset request format is unsupported"));
        }
        validate_operation_id(&self.operation_id)?;
        self.expected_data_version_stream.validate()?;
        match (self.operation, self.artifact.as_ref()) {
            (SeedResetOperationV1::ResetInstall, Some(artifact)) => artifact.validate()?,
            (SeedResetOperationV1::Clear, None) => {}
            (SeedResetOperationV1::ResetInstall, None) => {
                return Err(invalid("resetInstall requires artifact"));
            }
            (SeedResetOperationV1::Clear, Some(_)) => {
                return Err(invalid("clear forbids artifact"));
            }
        }
        Ok(())
    }

    pub fn request_digest(&self) -> SnapbackResult<String> {
        self.validate()?;
        reset_request_digest(
            &serde_json::to_value(self)
                .map_err(|_| invalid("reset request could not be projected"))?,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "state", rename_all = "camelCase", deny_unknown_fields)]
pub enum ExpectedDataVersionStreamV1 {
    Absent,
    Present { value: String },
}

impl ExpectedDataVersionStreamV1 {
    pub fn validate(&self) -> SnapbackResult<()> {
        if let Self::Present { value } = self {
            validate_uuid_v7(value, "expectedDataVersionStream.value")?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SeedResetOperationV1 {
    ResetInstall,
    Clear,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SeedPreviewOperationV1 {
    Install,
    ResetInstall,
    Clear,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeedPreviewRequestV1 {
    pub format_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact: Option<SeedArtifactV1>,
    pub requested_mode: crate::manifest::AuthMode,
    pub operation: SeedPreviewOperationV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_data_version_stream: Option<ExpectedDataVersionStreamV1>,
}

impl SeedPreviewRequestV1 {
    pub fn validate(&self) -> SnapbackResult<()> {
        if self.format_version != SEED_PREVIEW_REQUEST_FORMAT_V1 {
            return Err(invalid("preview request format is unsupported"));
        }
        match (
            self.operation,
            self.artifact.as_ref(),
            self.expected_data_version_stream.as_ref(),
        ) {
            (SeedPreviewOperationV1::Install, Some(artifact), None) => artifact.validate(),
            (SeedPreviewOperationV1::ResetInstall, Some(artifact), Some(expected_stream)) => {
                expected_stream.validate()?;
                artifact.validate()
            }
            (SeedPreviewOperationV1::Clear, None, Some(expected_stream)) => {
                expected_stream.validate()
            }
            (SeedPreviewOperationV1::Install, _, _) => Err(invalid(
                "install preview requires artifact and forbids expected stream",
            )),
            (SeedPreviewOperationV1::ResetInstall, _, _) => Err(invalid(
                "resetInstall preview requires artifact and expected stream",
            )),
            (SeedPreviewOperationV1::Clear, _, _) => Err(invalid(
                "clear preview forbids artifact and requires expected stream",
            )),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeedPreviewResultV1 {
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostic_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<ActiveSeedIdentityV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested: Option<ActiveSeedIdentityV1>,
    pub direct_application_rows: usize,
    pub derived_projection_rows: usize,
    pub total_application_effects: usize,
    pub reset_deleted_rows: usize,
}

impl SeedArtifactV1 {
    pub fn seed_data(&self) -> SeedData {
        SeedData {
            tables: self.tables.clone(),
        }
    }

    pub fn row_count(&self) -> SnapbackResult<usize> {
        let count = self.tables.values().try_fold(0usize, |total, rows| {
            total.checked_add(rows.len()).ok_or_else(effect_limit)
        })?;
        if count > VERSIONED_SEED_MAX_EFFECTS_V1 {
            return Err(effect_limit());
        }
        Ok(count)
    }

    pub fn validate(&self) -> SnapbackResult<()> {
        if self.format_version != SEED_ARTIFACT_FORMAT_V1 {
            return Err(invalid("seed artifact format is unsupported"));
        }
        if self.app_id.is_empty() {
            return Err(invalid("seed artifact appId is empty"));
        }
        if !valid_seed_version(&self.seed_version) {
            return Err(invalid("seedVersion is not a portable identity token"));
        }
        self.row_count()?;
        let observed = artifact_digest(self)?;
        if self.seed_digest != observed {
            return Err(invalid("seedDigest does not match the canonical artifact"));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum SeedOperationV1 {
    Install,
    ResetInstall,
    Clear,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum SeedOutcomeV1 {
    Installed,
    ResetInstalled,
    Cleared,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeedInstallReceiptV1 {
    pub format_version: String,
    pub operation_id: String,
    pub request_digest: String,
    pub operation: SeedOperationV1,
    pub outcome: SeedOutcomeV1,
    pub app_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed_digest: Option<String>,
    pub schema_hash: String,
    pub data_version_stream: String,
    pub direct_application_rows: usize,
    pub derived_projection_rows: usize,
    pub total_application_effects: usize,
    pub reset_deleted_rows: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActiveSeedIdentityV1 {
    pub app_id: String,
    pub seed_version: String,
    pub seed_digest: String,
    pub data_version_stream: String,
    pub schema_hash: String,
    pub direct_application_rows: usize,
    pub derived_projection_rows: usize,
    pub total_application_effects: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeedMatchedObservationV1 {
    pub format_version: String,
    pub outcome: String,
    pub active: ActiveSeedIdentityV1,
    pub establishing_receipt: SeedInstallReceiptV1,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "state", rename_all = "camelCase", deny_unknown_fields)]
pub enum SeedEnsureResultV1 {
    Installed {
        receipt: SeedInstallReceiptV1,
    },
    Matched {
        observation: SeedMatchedObservationV1,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ActiveSeedStateV1 {
    Absent,
    Installed(ActiveSeedIdentityV1),
}

#[derive(Clone, Debug, PartialEq)]
pub struct ActiveSeedInstallationV1 {
    pub artifact: SeedArtifactV1,
    pub receipt: SeedInstallReceiptV1,
    pub identity: ActiveSeedIdentityV1,
}

pub(crate) fn create_infra(tx: &Transaction<'_>) -> SnapbackResult<()> {
    // @ref LLP 0109#15-round-2-author-reconciliation-for-the-first-landing —
    // identity is keyed by the already-rotated data stream, so an unmodified
    // predecessor reset cannot leave a stale identity active.
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS _snapback_seed_installations_v1 (
             data_version_stream TEXT PRIMARY KEY NOT NULL,
             artifact_json TEXT NOT NULL,
             receipt_json TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS _snapback_seed_operations_v1 (
             operation_id TEXT PRIMARY KEY NOT NULL,
             request_digest TEXT NOT NULL,
             predecessor_stream TEXT,
             successor_stream TEXT NOT NULL,
             receipt_json TEXT NOT NULL
         );",
    )?;
    Ok(())
}

pub(crate) fn active_identity(
    tx: &Transaction<'_>,
    data_version_stream: &str,
) -> SnapbackResult<ActiveSeedStateV1> {
    Ok(match active_installation(tx, data_version_stream)? {
        None => ActiveSeedStateV1::Absent,
        Some(installation) => ActiveSeedStateV1::Installed(installation.identity),
    })
}

pub(crate) fn active_installation(
    tx: &Transaction<'_>,
    data_version_stream: &str,
) -> SnapbackResult<Option<ActiveSeedInstallationV1>> {
    let row: Option<(String, String)> = tx
        .query_row(
            "SELECT artifact_json, receipt_json
             FROM _snapback_seed_installations_v1
             WHERE data_version_stream = ?1",
            params![data_version_stream],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((artifact_json, receipt_json)) = row else {
        return Ok(None);
    };
    let artifact: SeedArtifactV1 = serde_json::from_str(&artifact_json)
        .map_err(|_| corrupt("active seed artifact is not a closed v1 object"))?;
    artifact
        .validate()
        .map_err(|_| corrupt("active seed artifact failed canonical validation"))?;
    if crate::rqs_contract::jcs(
        &serde_json::to_value(&artifact)
            .map_err(|_| corrupt("active seed artifact could not be projected"))?,
    )
    .map_err(|_| corrupt("active seed artifact is not canonical JSON"))?
        != artifact_json
    {
        return Err(corrupt("active seed artifact JSON is not canonical"));
    }
    let receipt: SeedInstallReceiptV1 = serde_json::from_str(&receipt_json)
        .map_err(|_| corrupt("active seed receipt is not a closed v1 object"))?;
    validate_receipt(&receipt, Some(&artifact), data_version_stream)?;
    if crate::rqs_contract::jcs(
        &serde_json::to_value(&receipt)
            .map_err(|_| corrupt("active seed receipt could not be projected"))?,
    )
    .map_err(|_| corrupt("active seed receipt is not canonical JSON"))?
        != receipt_json
    {
        return Err(corrupt("active seed receipt JSON is not canonical"));
    }
    let identity = ActiveSeedIdentityV1 {
        app_id: artifact.app_id.clone(),
        seed_version: artifact.seed_version.clone(),
        seed_digest: artifact.seed_digest.clone(),
        data_version_stream: data_version_stream.to_owned(),
        schema_hash: receipt.schema_hash.clone(),
        direct_application_rows: receipt.direct_application_rows,
        derived_projection_rows: receipt.derived_projection_rows,
        total_application_effects: receipt.total_application_effects,
    };
    Ok(Some(ActiveSeedInstallationV1 {
        artifact,
        receipt,
        identity,
    }))
}

/// Strictly read the stream that scopes seed identity without creating it.
///
/// @ref LLP 0109#161-replay-observes-current-state-before-historical-completion
/// — replay and preview observe currentness before classifying completion.
pub(crate) fn strict_current_data_version_stream(
    conn: &Connection,
) -> SnapbackResult<Option<String>> {
    let value: Option<(String, Vec<u8>)> = conn
        .query_row(
            "SELECT typeof(value), CAST(value AS BLOB)
             FROM _snapback_meta
             WHERE key = 'auth_invalidation_data_version_stream_v1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((storage_class, bytes)) = value else {
        return Ok(None);
    };
    if storage_class != "text" {
        return Err(corrupt("current data-version stream is not SQLite text"));
    }
    let stream = std::str::from_utf8(&bytes)
        .map_err(|_| corrupt("current data-version stream is not UTF-8"))?;
    validate_uuid_v7(stream, "current data-version stream")
        .map_err(|_| corrupt("current data-version stream is not a canonical UUIDv7"))?;
    Ok(Some(stream.to_owned()))
}

pub fn expected_stream_matches(
    expected: &ExpectedDataVersionStreamV1,
    current: Option<&str>,
) -> bool {
    match (expected, current) {
        (ExpectedDataVersionStreamV1::Absent, None) => true,
        (ExpectedDataVersionStreamV1::Present { value }, Some(current)) => value == current,
        _ => false,
    }
}

pub(crate) fn store_installation(
    tx: &Transaction<'_>,
    artifact: &SeedArtifactV1,
    receipt: &SeedInstallReceiptV1,
) -> SnapbackResult<()> {
    artifact.validate()?;
    validate_receipt(receipt, Some(artifact), &receipt.data_version_stream)?;
    let artifact_json = canonical(artifact)?;
    let receipt_json = canonical(receipt)?;
    tx.execute(
        "INSERT INTO _snapback_seed_installations_v1(
             data_version_stream, artifact_json, receipt_json
         ) VALUES(?1, ?2, ?3)",
        params![receipt.data_version_stream, artifact_json, receipt_json],
    )
    .map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_SEED_IDENTITY_CONFLICT",
            "seed",
            format!("active seed identity already exists or could not be stored: {error}"),
        )
    })?;
    Ok(())
}

pub(crate) fn store_completed_operation(
    tx: &Transaction<'_>,
    predecessor_stream: Option<&str>,
    receipt: &SeedInstallReceiptV1,
) -> SnapbackResult<()> {
    let receipt_json = canonical(receipt)?;
    tx.execute(
        "INSERT INTO _snapback_seed_operations_v1(
             operation_id, request_digest, predecessor_stream,
             successor_stream, receipt_json
         ) VALUES(?1, ?2, ?3, ?4, ?5)",
        params![
            receipt.operation_id,
            receipt.request_digest,
            predecessor_stream,
            receipt.data_version_stream,
            receipt_json
        ],
    )
    .map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_SEED_OPERATION_ID_REUSED",
            "seed",
            format!("seed operation id is already committed: {error}"),
        )
    })?;
    Ok(())
}

/// Best-effort bounded retention for stream-keyed installation and operation
/// history. The current stream and every successor referenced by the newest
/// 256 completed operations remain reachable; an older current-stream
/// completion is also retained so replay cannot change merely because newer,
/// unrelated operations arrived.
///
/// @ref LLP 0109#166-the-manifest-is-an-executable-advertisement-gate —
/// historical seed rows are bounded without weakening current-stream replay.
pub(crate) fn best_effort_prune_history(tx: &Transaction<'_>, current_stream: &str) {
    // Prune installations first while the full operation reference set is
    // still available. `rowid` is the insertion order for this append-only
    // idempotency table.
    let _ = tx.execute(
        "DELETE FROM _snapback_seed_installations_v1
         WHERE data_version_stream <> ?1
           AND data_version_stream NOT IN (
             SELECT successor_stream
             FROM _snapback_seed_operations_v1
             ORDER BY rowid DESC
             LIMIT 256
           )",
        params![current_stream],
    );
    let _ = tx.execute(
        "DELETE FROM _snapback_seed_operations_v1
         WHERE successor_stream <> ?1
           AND rowid NOT IN (
             SELECT rowid
             FROM _snapback_seed_operations_v1
             ORDER BY rowid DESC
             LIMIT 256
           )",
        params![current_stream],
    );
}

pub(crate) fn replay_completed_operation(
    tx: &Transaction<'_>,
    operation_id: &str,
    request_digest: &str,
    current_data_version_stream: Option<&str>,
) -> SnapbackResult<Option<SeedInstallReceiptV1>> {
    let row: Option<(String, String, String)> = tx
        .query_row(
            "SELECT request_digest, successor_stream, receipt_json
             FROM _snapback_seed_operations_v1
             WHERE operation_id = ?1",
            params![operation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((stored_digest, successor_stream, receipt_json)) = row else {
        return Ok(None);
    };
    if stored_digest != request_digest {
        return Err(SnapbackError::error(
            "SNAPBACK_SEED_OPERATION_ID_REUSED",
            "seed",
            "seed operation id was previously committed with another request digest",
        ));
    }
    if current_data_version_stream != Some(successor_stream.as_str()) {
        return Err(SnapbackError::error(
            "SNAPBACK_SEED_OPERATION_HISTORICAL",
            "seed",
            "seed operation completed in a historical data-version stream",
        ));
    }
    let receipt: SeedInstallReceiptV1 = serde_json::from_str(&receipt_json)
        .map_err(|_| corrupt("completed seed operation receipt is malformed"))?;
    match (receipt.outcome, active_identity(tx, &successor_stream)?) {
        (
            SeedOutcomeV1::Installed | SeedOutcomeV1::ResetInstalled,
            ActiveSeedStateV1::Installed(active),
        ) if active.app_id == receipt.app_id
            && active.seed_version == receipt.seed_version.clone().unwrap_or_default()
            && active.seed_digest == receipt.seed_digest.clone().unwrap_or_default()
            && active.schema_hash == receipt.schema_hash
            && active.direct_application_rows == receipt.direct_application_rows
            && active.derived_projection_rows == receipt.derived_projection_rows
            && active.total_application_effects == receipt.total_application_effects => {}
        (SeedOutcomeV1::Cleared, ActiveSeedStateV1::Absent) => {}
        _ => {
            return Err(corrupt(
                "completed seed operation does not match current protected identity",
            ));
        }
    }
    Ok(Some(receipt))
}

pub fn checked_application_effects(
    direct_application_rows: usize,
    derived_projection_rows: usize,
) -> SnapbackResult<usize> {
    let total = direct_application_rows
        .checked_add(derived_projection_rows)
        .ok_or_else(effect_limit)?;
    if total > VERSIONED_SEED_MAX_EFFECTS_V1 {
        return Err(effect_limit());
    }
    Ok(total)
}

pub fn artifact_digest(artifact: &SeedArtifactV1) -> SnapbackResult<String> {
    let body = serde_json::json!({
        "formatVersion": artifact.format_version,
        "appId": artifact.app_id,
        "seedVersion": artifact.seed_version,
        "tables": artifact.tables,
    });
    tagged_digest(ARTIFACT_DIGEST_DOMAIN, &body, true)
}

pub fn install_request_digest(value: &Value) -> SnapbackResult<String> {
    tagged_digest(INSTALL_REQUEST_DIGEST_DOMAIN, value, false)
}

pub fn reset_request_digest(value: &Value) -> SnapbackResult<String> {
    tagged_digest(RESET_REQUEST_DIGEST_DOMAIN, value, false)
}

fn tagged_digest(domain: &[u8], value: &Value, prefixed: bool) -> SnapbackResult<String> {
    let encoded = crate::rqs_contract::jcs(value)
        .map_err(|_| invalid("seed digest input is outside canonical JSON limits"))?;
    let mut hash = Sha256::new();
    hash.update(domain);
    hash.update(encoded.as_bytes());
    let digest = lower_hex(&hash.finalize());
    Ok(if prefixed {
        format!("sha256:{digest}")
    } else {
        digest
    })
}

fn canonical<T: Serialize>(value: &T) -> SnapbackResult<String> {
    let value = serde_json::to_value(value)
        .map_err(|_| invalid("seed carrier could not be projected to JSON"))?;
    crate::rqs_contract::jcs(&value)
        .map_err(|_| invalid("seed carrier is outside canonical JSON limits"))
}

fn validate_receipt(
    receipt: &SeedInstallReceiptV1,
    artifact: Option<&SeedArtifactV1>,
    stream: &str,
) -> SnapbackResult<()> {
    if receipt.format_version != SEED_RECEIPT_FORMAT_V1
        || receipt.data_version_stream != stream
        || receipt.request_digest.len() != 64
        || !receipt
            .request_digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(corrupt("seed receipt header is invalid"));
    }
    validate_operation_id(&receipt.operation_id)
        .map_err(|_| corrupt("seed receipt operation id is not a canonical UUIDv7"))?;
    validate_uuid_v7(stream, "receipt data-version stream")
        .map_err(|_| corrupt("seed receipt data-version stream is not a canonical UUIDv7"))?;
    match (receipt.outcome, artifact) {
        (SeedOutcomeV1::Cleared, None)
            if receipt.seed_version.is_none()
                && receipt.seed_digest.is_none()
                && receipt.direct_application_rows == 0
                && receipt.derived_projection_rows == 0
                && receipt.total_application_effects == 0 =>
        {
            Ok(())
        }
        (SeedOutcomeV1::Installed | SeedOutcomeV1::ResetInstalled, Some(artifact))
            if receipt.app_id == artifact.app_id
                && receipt.seed_version.as_deref() == Some(artifact.seed_version.as_str())
                && receipt.seed_digest.as_deref() == Some(artifact.seed_digest.as_str())
                && receipt.direct_application_rows == artifact.row_count()?
                && receipt.total_application_effects
                    == checked_application_effects(
                        receipt.direct_application_rows,
                        receipt.derived_projection_rows,
                    )? =>
        {
            Ok(())
        }
        _ => Err(corrupt("seed receipt does not match its artifact/outcome")),
    }
}

fn valid_seed_version(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 128
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn validate_operation_id(value: &str) -> SnapbackResult<()> {
    validate_uuid_v7(value, "operationId")
}

fn validate_uuid_v7(value: &str, label: &str) -> SnapbackResult<()> {
    if crate::ids::is_minted_identifier(value) {
        return Ok(());
    }
    Err(invalid(format!("{label} is not a Snapback identifier")))
}

fn invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_SEED_DECLARATION_INVALID", "seed", message.into())
}

fn corrupt(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_SEED_IDENTITY_CORRUPT", "seed", message.into())
}

fn effect_limit() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED",
        "seed",
        format!(
            "versioned seed exceeds the {}-effect ceiling",
            VERSIONED_SEED_MAX_EFFECTS_V1
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn artifact() -> SeedArtifactV1 {
        let mut artifact = SeedArtifactV1 {
            format_version: SEED_ARTIFACT_FORMAT_V1.to_owned(),
            app_id: "demo".to_owned(),
            seed_version: "2026-07-27.1".to_owned(),
            seed_digest: String::new(),
            tables: std::collections::BTreeMap::new(),
        };
        artifact.seed_digest = artifact_digest(&artifact).expect("digest");
        artifact
    }

    #[test]
    fn stream_key_makes_predecessor_identity_inactive() {
        let mut connection = Connection::open_in_memory().expect("sqlite");
        let tx = connection.transaction().expect("transaction");
        create_infra(&tx).expect("infra");
        let artifact = artifact();
        let stream_a = "01983c8d-9f87-7ec1-bc02-7e81290debc1";
        let stream_b = "01983c8d-9f87-7ec1-bc02-7e81290debc2";
        let receipt = SeedInstallReceiptV1 {
            format_version: SEED_RECEIPT_FORMAT_V1.to_owned(),
            operation_id: "01983c8d-9f87-7ec1-bc02-7e81290debc0".to_owned(),
            request_digest: "a".repeat(64),
            operation: SeedOperationV1::Install,
            outcome: SeedOutcomeV1::Installed,
            app_id: artifact.app_id.clone(),
            seed_version: Some(artifact.seed_version.clone()),
            seed_digest: Some(artifact.seed_digest.clone()),
            schema_hash: "schema".to_owned(),
            data_version_stream: stream_a.to_owned(),
            direct_application_rows: 0,
            derived_projection_rows: 0,
            total_application_effects: 0,
            reset_deleted_rows: 0,
        };
        store_installation(&tx, &artifact, &receipt).expect("installation");
        assert!(matches!(
            active_identity(&tx, stream_a).expect("active"),
            ActiveSeedStateV1::Installed(_)
        ));
        assert_eq!(
            active_identity(&tx, stream_b).expect("rotated"),
            ActiveSeedStateV1::Absent
        );
        tx.commit().expect("commit");
    }

    #[test]
    fn install_replay_and_matched_observation_are_distinct() {
        let mut database = crate::storage::LocalDatabase::memory().expect("database");
        let schema = crate::manifest::SchemaManifest {
            app_id: "demo".to_owned(),
            schema_hash: Some(format!("sha256:{}", "1".repeat(64))),
            inputs_hash: Some(format!("sha256:{}", "2".repeat(64))),
            ..Default::default()
        };
        database.schema_seed().apply_schema(schema).expect("schema");
        let artifact = artifact();
        let request = InstallSeedRequestV1 {
            format_version: SEED_INSTALL_REQUEST_FORMAT_V1.to_owned(),
            operation_id: "01983c8d-9f87-7ec1-bc02-7e81290debc0".to_owned(),
            artifact: artifact.clone(),
            requested_mode: crate::manifest::AuthMode::Dev,
            asset_fixtures: None,
        };
        let installed = database
            .schema_seed()
            .ensure_versioned_seed(request.clone())
            .expect("install");
        let receipt = match installed.output {
            SeedEnsureResultV1::Installed { receipt } => receipt,
            SeedEnsureResultV1::Matched { .. } => panic!("fresh install matched"),
        };
        assert_eq!(receipt.outcome, SeedOutcomeV1::Installed);
        assert_eq!(
            database
                .schema_seed()
                .ensure_versioned_seed(request)
                .expect("response-loss replay")
                .output,
            SeedEnsureResultV1::Installed {
                receipt: receipt.clone()
            }
        );
        let matched = database
            .schema_seed()
            .ensure_versioned_seed(InstallSeedRequestV1 {
                format_version: SEED_INSTALL_REQUEST_FORMAT_V1.to_owned(),
                operation_id: "01983c8d-9f87-7ec1-bc02-7e81290debc3".to_owned(),
                artifact,
                requested_mode: crate::manifest::AuthMode::Dev,
                asset_fixtures: None,
            })
            .expect("matched");
        match matched.output {
            SeedEnsureResultV1::Matched { observation } => {
                assert_eq!(observation.outcome, "matched");
                assert_eq!(observation.establishing_receipt, receipt);
            }
            SeedEnsureResultV1::Installed { .. } => panic!("same identity reinstalled"),
        }
    }

    fn todo_schema() -> crate::manifest::SchemaManifest {
        const PATH: &str = "../../../demos/todo/snapback/generated/schema.manifest.json";
        let source = crate::read_generated_demo_fixture("src", PATH, "todo");

        serde_json::from_str(&source).expect("todo generated schema")
    }

    fn todo_artifact(version: &str, rows: usize) -> SeedArtifactV1 {
        let todos = (0..rows)
            .map(|index| {
                serde_json::Map::from_iter([
                    ("_id".to_owned(), serde_json::json!(format!("todo_{index}"))),
                    (
                        "title".to_owned(),
                        serde_json::json!(format!("Todo {index}")),
                    ),
                    ("completed".to_owned(), serde_json::json!(false)),
                    ("userId".to_owned(), serde_json::json!("user_conformance")),
                ])
            })
            .collect();
        let mut artifact = SeedArtifactV1 {
            format_version: SEED_ARTIFACT_FORMAT_V1.to_owned(),
            app_id: "todo".to_owned(),
            seed_version: version.to_owned(),
            seed_digest: String::new(),
            tables: std::collections::BTreeMap::from([("todos".to_owned(), todos)]),
        };
        artifact.seed_digest = artifact_digest(&artifact).expect("artifact digest");
        artifact
    }

    #[test]
    fn versioned_seed_conformance_effect_boundaries_and_migration_refusal() {
        let mut bounded = crate::storage::LocalDatabase::memory().expect("memory database");
        bounded
            .schema_seed()
            .apply_schema(todo_schema())
            .expect("apply todo schema");
        let artifact = todo_artifact("bound-1024", VERSIONED_SEED_MAX_EFFECTS_V1);
        let installed = bounded
            .schema_seed()
            .ensure_versioned_seed(InstallSeedRequestV1 {
                format_version: SEED_INSTALL_REQUEST_FORMAT_V1.to_owned(),
                operation_id: "01982c7a-7c00-7000-8000-000000000101".to_owned(),
                artifact,
                requested_mode: crate::manifest::AuthMode::Dev,
                asset_fixtures: None,
            })
            .expect("1024 direct effects install");
        let SeedEnsureResultV1::Installed { receipt } = installed.output else {
            panic!("fresh bounded install must be effectful")
        };
        assert_eq!(receipt.direct_application_rows, 1024);
        assert_eq!(receipt.total_application_effects, 1024);

        let oversized = todo_artifact("bound-1025", VERSIONED_SEED_MAX_EFFECTS_V1 + 1);
        assert_eq!(
            oversized.validate().unwrap_err().diagnostic.code,
            "SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED"
        );

        let mut migration = crate::storage::LocalDatabase::memory().expect("migration database");
        migration
            .schema_seed()
            .apply_schema(todo_schema())
            .expect("apply todo schema");
        migration
            .schema_seed()
            .ensure_versioned_seed(InstallSeedRequestV1 {
                format_version: SEED_INSTALL_REQUEST_FORMAT_V1.to_owned(),
                operation_id: "01982c7a-7c00-7000-8000-000000000102".to_owned(),
                artifact: todo_artifact("migration-v1", 1),
                requested_mode: crate::manifest::AuthMode::Dev,
                asset_fixtures: None,
            })
            .expect("initial migration identity");
        let refused = migration
            .schema_seed()
            .ensure_versioned_seed(InstallSeedRequestV1 {
                format_version: SEED_INSTALL_REQUEST_FORMAT_V1.to_owned(),
                operation_id: "01982c7a-7c00-7000-8000-000000000103".to_owned(),
                artifact: todo_artifact("migration-v2", 1),
                requested_mode: crate::manifest::AuthMode::Dev,
                asset_fixtures: None,
            })
            .unwrap_err();
        assert_eq!(refused.diagnostic.code, "SNAPBACK_SEED_MIGRATION_REQUIRED");
    }

    #[test]
    fn versioned_seed_conformance_empty_target_and_sessions_membership_lane() {
        let mut occupied = crate::storage::LocalDatabase::memory().expect("occupied database");
        occupied
            .schema_seed()
            .apply_schema(todo_schema())
            .expect("apply todo schema");
        occupied
            .schema_seed()
            .seed(crate::manifest::SeedData {
                tables: std::collections::BTreeMap::from([(
                    "todos".to_owned(),
                    todo_artifact("legacy", 1)
                        .tables
                        .get("todos")
                        .cloned()
                        .expect("todo rows"),
                )]),
            })
            .expect("untracked predecessor row");
        let refused = occupied
            .schema_seed()
            .ensure_versioned_seed(InstallSeedRequestV1 {
                format_version: SEED_INSTALL_REQUEST_FORMAT_V1.to_owned(),
                operation_id: "01982c7a-7c00-7000-8000-000000000104".to_owned(),
                artifact: todo_artifact("empty-named-target", 0),
                requested_mode: crate::manifest::AuthMode::Dev,
                asset_fixtures: None,
            })
            .unwrap_err();
        assert_eq!(refused.diagnostic.code, "SNAPBACK_SEED_NONEMPTY_UNTRACKED");

        // The declared membership fixture lane (LLP 0109 §8; LLP 0100 §8b):
        // a sessions-mode artifact may NAME a membership table — the
        // first-landing SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED
        // narrowing is retired (dated 0109 amendment, 2026-08-01). Naming an
        // empty membership table validates; row-level admission is enforced
        // by the same-transaction activation scan, witnessed in the storage
        // membership-write suite.
        const PATH: &str = "../../../demos/rbac/snapback/generated/schema.manifest.json";
        let source = crate::read_generated_demo_fixture("src", PATH, "rbac");
        let sessions: crate::manifest::SchemaManifest =
            serde_json::from_str(&source).expect("rbac generated schema");
        let mut membership_artifact = SeedArtifactV1 {
            format_version: SEED_ARTIFACT_FORMAT_V1.to_owned(),
            app_id: sessions.app_id.clone(),
            seed_version: "membership-bootstrap".to_owned(),
            seed_digest: String::new(),
            tables: std::collections::BTreeMap::from([("appMembers".to_owned(), Vec::new())]),
        };
        membership_artifact.seed_digest =
            artifact_digest(&membership_artifact).expect("membership digest");
        crate::storage::SchemaSeedKernel::validate_versioned_seed_request(
            &sessions,
            crate::manifest::AuthMode::Sessions,
            Some(&membership_artifact),
        )
        .expect("a named membership table is a legal fixture/reset target");

        // Unknown tables still refuse: the lift is declaration-scoped, not
        // a general widening.
        let mut unknown_artifact = SeedArtifactV1 {
            format_version: SEED_ARTIFACT_FORMAT_V1.to_owned(),
            app_id: sessions.app_id.clone(),
            seed_version: "unknown-table".to_owned(),
            seed_digest: String::new(),
            tables: std::collections::BTreeMap::from([("nope".to_owned(), Vec::new())]),
        };
        unknown_artifact.seed_digest = artifact_digest(&unknown_artifact).expect("unknown digest");
        crate::storage::SchemaSeedKernel::validate_versioned_seed_request(
            &sessions,
            crate::manifest::AuthMode::Sessions,
            Some(&unknown_artifact),
        )
        .expect_err("an undeclared table stays refused");
    }
}
