//! Host-side consumption of LLP 0234 visibility-governance verdicts.
//!
//! The generated review projection is intentionally absent here. Activation
//! consumes only the executable manifest record plus target-owned source OID,
//! observer-key pin, signed verdict, fixture profile, and quarantine checkpoint.

use crate::contract_types::ServerProfile;
use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::manifest::{FunctionManifest, SchemaManifest};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use ring::signature::{ED25519, UnparsedPublicKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use std::fs;
use std::path::Path;

const TARGET_CONFIG_ENV: &str = "SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG";
const ACTIVATION_SCHEMA: &str = "snapback.visibility-governance-activation.v1";
const TARGET_CONFIG_SCHEMA: &str = "snapback.visibility-governance-target-config.v1";
const VERDICT_SCHEMA: &str = "snapback.visibility-governance-update-verdict.v1";
const DEV_VERDICT_PROVIDER: &str = "repository-local-dev-mint-v1";
const DEV_TARGET_CLASS: &str = "repository-local";

fn refusal(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "auth", message.into())
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisibilityFixtureProfileV1 {
    pub override_id: String,
    pub id: String,
    pub digest: String,
    pub target_class_ceiling: String,
    pub principal_class: String,
    pub data_classification: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisibilityProductionWindowV1 {
    pub override_id: String,
    pub issued_on: String,
    pub expires_on: String,
}

/// Compact executable governance carrier. Digests bind the complete generated
/// baselines/program; the larger review projection has no activation role.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisibilityGovernanceActivationV1 {
    pub schema_version: String,
    pub required: bool,
    pub generation_inputs_hash: String,
    pub visibility_authorization_program_digest: String,
    pub override_baseline_digest: String,
    pub table_policy_baseline_digest: String,
    pub quarantine_head_digest: String,
    #[serde(default)]
    pub fixture_profiles: Vec<VisibilityFixtureProfileV1>,
    #[serde(default)]
    pub production_windows: Vec<VisibilityProductionWindowV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetFixtureProfileV1 {
    pub id: String,
    pub digest: String,
    pub target_class: String,
    pub principal_class: String,
    pub data_classification: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisibilityGovernanceTargetConfigV1 {
    pub schema_version: String,
    pub source_oid: String,
    pub observer_key_epoch: String,
    pub observer_key_digest: String,
    pub observer_public_key_base64: String,
    #[serde(default)]
    pub revoked_observer_key_epochs: Vec<String>,
    pub quarantine_checkpoint: String,
    pub target_class: String,
    #[serde(default)]
    pub fixture_profile: Option<TargetFixtureProfileV1>,
    pub verdict: Value,
}

fn required_string<'a>(value: &'a Value, pointer: &str) -> SnapbackResult<&'a str> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            refusal(
                "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
                format!("protected governance verdict lacks {pointer}"),
            )
        })
}

fn target_config_from_path(path: &Path) -> SnapbackResult<VisibilityGovernanceTargetConfigV1> {
    let bytes = fs::read(path).map_err(|error| {
        refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE",
            format!("target-owned visibility governance config is unavailable: {error}"),
        )
    })?;
    let config: VisibilityGovernanceTargetConfigV1 =
        serde_json::from_slice(&bytes).map_err(|error| {
            refusal(
                "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE",
                format!("target-owned visibility governance config is malformed: {error}"),
            )
        })?;
    if config.schema_version != TARGET_CONFIG_SCHEMA {
        return Err(refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE",
            "target-owned visibility governance config uses an unsupported schema",
        ));
    }
    Ok(config)
}

fn target_config_from_environment() -> SnapbackResult<VisibilityGovernanceTargetConfigV1> {
    let path = std::env::var_os(TARGET_CONFIG_ENV).ok_or_else(|| {
        refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE",
            format!("{TARGET_CONFIG_ENV} is required for governed authority activation"),
        )
    })?;
    target_config_from_path(Path::new(&path))
}

fn canonical_unsigned_verdict(verdict: &Value) -> SnapbackResult<Vec<u8>> {
    let mut unsigned = verdict.clone();
    let object = unsigned.as_object_mut().ok_or_else(|| {
        refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
            "protected governance verdict must be an object",
        )
    })?;
    object.remove("signature").ok_or_else(|| {
        refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
            "protected governance verdict has no observer signature",
        )
    })?;
    Ok(canonical_json(&unsigned)?.into_bytes())
}

fn verify_verdict_signature(config: &VisibilityGovernanceTargetConfigV1) -> SnapbackResult<()> {
    if config
        .revoked_observer_key_epochs
        .contains(&config.observer_key_epoch)
    {
        return Err(refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE",
            "target-owned observer key epoch is revoked",
        ));
    }
    if required_string(&config.verdict, "/observerKeyEpoch")? != config.observer_key_epoch
        || required_string(&config.verdict, "/observerKeyDigest")? != config.observer_key_digest
    {
        return Err(refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
            "protected governance verdict does not match the target-owned observer key pin",
        ));
    }
    let public_key = STANDARD
        .decode(&config.observer_public_key_base64)
        .map_err(|_| {
            refusal(
                "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE",
                "target-owned observer public key is not base64",
            )
        })?;
    if public_key.len() != 32 {
        return Err(refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE",
            "target-owned observer public key is not Ed25519",
        ));
    }
    let key_digest = observer_key_digest(&public_key)?;
    if key_digest != config.observer_key_digest {
        return Err(refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE",
            "target-owned observer key bytes do not match the pinned registry digest",
        ));
    }
    let signature = STANDARD
        .decode(required_string(&config.verdict, "/signature")?)
        .map_err(|_| {
            refusal(
                "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
                "protected governance verdict signature is malformed",
            )
        })?;
    UnparsedPublicKey::new(&ED25519, public_key)
        .verify(&canonical_unsigned_verdict(&config.verdict)?, &signature)
        .map_err(|_| {
            refusal(
                "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
                "protected governance verdict signature is untrusted",
            )
        })
}

fn validate_verdict_provider(
    governance: &VisibilityGovernanceActivationV1,
    config: &VisibilityGovernanceTargetConfigV1,
    server_profile: ServerProfile,
) -> SnapbackResult<()> {
    let provider = required_string(&config.verdict, "/providerProfile")?;
    match provider {
        "github-push-v1" | "atomic-push-envelope-v1" => Ok(()),
        DEV_VERDICT_PROVIDER
            if config.target_class == DEV_TARGET_CLASS
                && matches!(
                    server_profile,
                    ServerProfile::Dev | ServerProfile::Demo | ServerProfile::Test
                )
                && governance.production_windows.is_empty() =>
        {
            Ok(())
        }
        DEV_VERDICT_PROVIDER => Err(refusal(
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY",
            format!(
                "repository-local development governance cannot activate server profile {}, target class {}, or production override authority",
                server_profile.as_str(),
                config.target_class
            ),
        )),
        _ => Err(refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
            "visibility governance verdict uses an unsupported provider profile",
        )),
    }
}

fn observer_key_digest(public_key: &[u8]) -> SnapbackResult<String> {
    let mut der = vec![
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ];
    der.extend_from_slice(public_key);
    let encoded = STANDARD.encode(der);
    let mut pem = String::from("-----BEGIN PUBLIC KEY-----\n");
    for chunk in encoded.as_bytes().chunks(64) {
        pem.push_str(std::str::from_utf8(chunk).map_err(|_| {
            refusal(
                "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE",
                "target-owned observer public key cannot be represented canonically",
            )
        })?);
        pem.push('\n');
    }
    pem.push_str("-----END PUBLIC KEY-----\n");
    let canonical_pem = serde_json::to_string(&pem).map_err(|error| {
        refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE",
            format!("target-owned observer public key cannot be canonicalized: {error}"),
        )
    })?;
    let mut hasher = Sha256::new();
    hasher.update(b"snapback:visibility-observer-key:v1\n");
    hasher.update(canonical_pem.as_bytes());
    Ok(format!(
        "sha256:{}",
        hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

fn canonical_json(value: &Value) -> SnapbackResult<String> {
    fn sorted(value: &Value) -> Value {
        match value {
            Value::Array(values) => Value::Array(values.iter().map(sorted).collect()),
            Value::Object(values) => {
                let mut keys = values.keys().collect::<Vec<_>>();
                keys.sort();
                let mut output = serde_json::Map::new();
                for key in keys {
                    output.insert(key.clone(), sorted(&values[key]));
                }
                Value::Object(output)
            }
            _ => value.clone(),
        }
    }
    serde_json::to_string_pretty(&sorted(value)).map_err(|error| {
        refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH",
            format!("visibility governance carrier cannot be canonicalized: {error}"),
        )
    })
}

fn activation_carrier_digest(
    governance: &VisibilityGovernanceActivationV1,
) -> SnapbackResult<String> {
    let value = serde_json::to_value(governance).map_err(|error| {
        refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH",
            format!("visibility governance carrier cannot be represented: {error}"),
        )
    })?;
    let mut hasher = Sha256::new();
    hasher.update(b"snapback:visibility-governance-activation-carrier:v1\n");
    hasher.update(canonical_json(&value)?.as_bytes());
    Ok(format!(
        "sha256:{}",
        hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

fn expected_identity<'a>(
    schema: &SchemaManifest,
    functions: &FunctionManifest,
    governance: &VisibilityGovernanceActivationV1,
    verdict: &'a Value,
) -> SnapbackResult<&'a Value> {
    let identities = verdict
        .pointer("/deploymentIdentities")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            refusal(
                "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
                "green governance verdict lacks derived deployment identities",
            )
        })?;
    let activation_digest = activation_carrier_digest(governance)?;
    let matches = identities
        .iter()
        .filter(|identity| {
            identity.get("appId").and_then(Value::as_str) == Some(&schema.app_id)
                && identity.get("schemaHash").and_then(Value::as_str)
                    == Some(schema.schema_hash.as_deref().unwrap_or(""))
                && identity.get("functionBundleHash").and_then(Value::as_str)
                    == Some(functions.bundle_hash.as_deref().unwrap_or(""))
                && identity.get("generationInputsHash").and_then(Value::as_str)
                    == Some(governance.generation_inputs_hash.as_str())
                && identity
                    .get("visibilityAuthorizationProgramDigest")
                    .and_then(Value::as_str)
                    == Some(governance.visibility_authorization_program_digest.as_str())
                && identity
                    .get("visibilityGovernanceActivationDigest")
                    .and_then(Value::as_str)
                    == Some(activation_digest.as_str())
                && identity.get("quarantineHeadDigest").and_then(Value::as_str)
                    == Some(governance.quarantine_head_digest.as_str())
        })
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH",
            format!(
                "green governance verdict requires exactly one identity for app {}; found {}",
                schema.app_id,
                matches.len()
            ),
        ));
    }
    Ok(matches[0])
}

fn days_from_civil(year: i64, month: u32, day: u32) -> Option<i64> {
    let leap = year.rem_euclid(4) == 0 && (year.rem_euclid(100) != 0 || year.rem_euclid(400) == 0);
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    if day == 0 || day > days_in_month {
        return None;
    }
    let adjusted_year = year - i64::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let month_prime = i64::from(month) + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * month_prime + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    Some(era * 146_097 + day_of_era - 719_468)
}

fn parse_date_ms(value: &str, end_exclusive: bool) -> Option<u64> {
    let bytes = value.as_bytes();
    if bytes.len() < 10 || bytes.get(4) != Some(&b'-') || bytes.get(7) != Some(&b'-') {
        return None;
    }
    let date = value.get(..10)?;
    let mut parts = date.split('-');
    let year: i64 = parts.next()?.parse().ok()?;
    let month: u32 = parts.next()?.parse().ok()?;
    let day: u32 = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    let mut seconds = days_from_civil(year, month, day)?.checked_mul(86_400)?;
    if value.len() > 10 {
        if !matches!(value.len(), 20 | 24)
            || bytes.get(10) != Some(&b'T')
            || bytes.get(13) != Some(&b':')
            || bytes.get(16) != Some(&b':')
            || bytes.last().copied() != Some(b'Z')
            || (value.len() == 24
                && (bytes.get(19) != Some(&b'.') || !bytes[20..23].iter().all(u8::is_ascii_digit)))
        {
            return None;
        }
        let hour: i64 = value.get(11..13)?.parse().ok()?;
        let minute: i64 = value.get(14..16)?.parse().ok()?;
        let second: i64 = value.get(17..19)?.parse().ok()?;
        if hour > 23 || minute > 59 || second > 59 {
            return None;
        }
        seconds = seconds.checked_add(hour * 3_600 + minute * 60 + second)?;
    } else if end_exclusive {
        seconds = seconds.checked_add(86_400)?;
    } else if value.len() != 10 {
        return None;
    }
    let millis = if value.len() == 24 {
        value.get(20..23)?.parse::<i64>().ok()?
    } else {
        0
    };
    u64::try_from(seconds.checked_mul(1_000)?.checked_add(millis)?).ok()
}

pub fn ensure_override_time_valid(
    window: &VisibilityProductionWindowV1,
    now_ms: u64,
) -> SnapbackResult<Option<Diagnostic>> {
    let issued = parse_date_ms(&window.issued_on, false).ok_or_else(|| {
        refusal(
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID",
            format!("override {} has malformed issuedOn", window.override_id),
        )
    })?;
    let expires = parse_date_ms(&window.expires_on, true).ok_or_else(|| {
        refusal(
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID",
            format!("override {} has malformed expiresOn", window.override_id),
        )
    })?;
    if now_ms < issued {
        return Err(refusal(
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_NOT_YET_VALID",
            format!(
                "table visibility override {} is not valid before {}",
                window.override_id, window.issued_on
            ),
        ));
    }
    if now_ms >= expires {
        return Err(refusal(
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRED",
            format!(
                "table visibility override {} expired on {}; remove it or push a separately approved renewal before using its authority",
                window.override_id, window.expires_on
            ),
        ));
    }
    if expires.saturating_sub(issued) > 90 * 24 * 60 * 60 * 1_000 {
        return Err(refusal(
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID",
            format!(
                "table visibility override {} exceeds the 90-day production lifetime",
                window.override_id
            ),
        ));
    }
    if expires.saturating_sub(now_ms) <= 30 * 24 * 60 * 60 * 1_000 {
        return Ok(Some(Diagnostic::warning(
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRING",
            "auth",
            format!(
                "table visibility override {} expires on {}",
                window.override_id, window.expires_on
            ),
        )));
    }
    Ok(None)
}

fn validate_fixture_profiles(
    governance: &VisibilityGovernanceActivationV1,
    config: &VisibilityGovernanceTargetConfigV1,
) -> SnapbackResult<()> {
    for profile in &governance.fixture_profiles {
        let selected = config.fixture_profile.as_ref().ok_or_else(|| {
            refusal(
                "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY",
                format!(
                    "table visibility override {} is fixture-only and cannot activate in profile {}",
                    profile.override_id, config.target_class
                ),
            )
        })?;
        if selected.id != profile.id
            || selected.digest != profile.digest
            || config.target_class != selected.target_class
            || selected.target_class != profile.target_class_ceiling
            || selected.principal_class != profile.principal_class
            || selected.data_classification != profile.data_classification
            || selected.principal_class != "synthetic"
            || selected.data_classification != "fixture-owned"
        {
            return Err(refusal(
                "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY",
                format!(
                    "table visibility override {} is fixture-only and cannot activate in profile {}",
                    profile.override_id, config.target_class
                ),
            ));
        }
    }
    Ok(())
}

/// Verify target-owned custody, observer signature, exact source/deployment
/// identity, latest quarantine checkpoint, trusted time, and fixture fence
/// before the durable activation transaction begins.
///
/// @ref LLP 0234#d4--production-authority-expires-fixtures-cannot-become-production
/// @ref LLP 0234#d5--exact-ratchets-cover-overrides-and-ordinary-policy-widening
pub fn validate_activation_with_config(
    schema: &SchemaManifest,
    functions: &FunctionManifest,
    config: &VisibilityGovernanceTargetConfigV1,
    server_profile: ServerProfile,
    now_ms: u64,
) -> SnapbackResult<Vec<Diagnostic>> {
    let Some(governance) = schema.visibility_governance.as_ref() else {
        return Ok(Vec::new());
    };
    if governance.schema_version != ACTIVATION_SCHEMA {
        return Err(refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
            "visibility governance activation carrier has an unsupported schema",
        ));
    }
    // The `required` bit describes whether this program carries a current
    // widening; it is not a trust bypass. Once a governance carrier exists,
    // the target always binds it to the protected exact-source verdict so an
    // edited manifest cannot downgrade activation by flipping one boolean.
    verify_verdict_signature(config)?;
    // @ref LLP 0234#d4--production-authority-expires-fixtures-cannot-become-production
    // — the dev mint is an explicit local provider class, never a spelling a
    // production window or hosted target may consume.
    validate_verdict_provider(governance, config, server_profile)?;
    if required_string(&config.verdict, "/schemaVersion")? != VERDICT_SCHEMA
        || required_string(&config.verdict, "/disposition")? != "green"
        || required_string(&config.verdict, "/afterOid")? != config.source_oid
    {
        return Err(refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
            "visibility governance verdict is red, stale, or bound to another source OID",
        ));
    }
    let identity = expected_identity(schema, functions, governance, &config.verdict)?;
    if config.quarantine_checkpoint != governance.quarantine_head_digest
        || identity.get("quarantineHeadDigest").and_then(Value::as_str)
            != Some(config.quarantine_checkpoint.as_str())
    {
        return Err(refusal(
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
            "visibility governance quarantine checkpoint is stale or rolled back",
        ));
    }
    validate_fixture_profiles(governance, config)?;
    let observed_at = parse_date_ms(required_string(&config.verdict, "/observedAt")?, false)
        .ok_or_else(|| {
            refusal(
                "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID",
                "protected governance verdict has a malformed observedAt",
            )
        })?;
    if observed_at > now_ms.saturating_add(5 * 60 * 1_000) {
        return Err(refusal(
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID",
            "protected governance verdict is future-dated against trusted host time",
        ));
    }
    let mut warnings = Vec::new();
    for window in &governance.production_windows {
        let issued = parse_date_ms(&window.issued_on, false).ok_or_else(|| {
            refusal(
                "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID",
                format!("override {} has malformed issuedOn", window.override_id),
            )
        })?;
        let expires = parse_date_ms(&window.expires_on, true).ok_or_else(|| {
            refusal(
                "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID",
                format!("override {} has malformed expiresOn", window.override_id),
            )
        })?;
        if issued > observed_at.saturating_add(5 * 60 * 1_000)
            || expires.saturating_sub(observed_at) > 90 * 24 * 60 * 60 * 1_000
        {
            return Err(refusal(
                "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID",
                format!(
                    "override {} exceeds its trusted separation-admission interval",
                    window.override_id
                ),
            ));
        }
        if let Some(warning) = ensure_override_time_valid(window, now_ms)? {
            warnings.push(warning);
        }
    }
    Ok(warnings)
}

pub(crate) fn validate_activation_from_target(
    schema: &SchemaManifest,
    functions: &FunctionManifest,
    server_profile: ServerProfile,
    now_ms: u64,
    config_path: Option<&Path>,
) -> SnapbackResult<Vec<Diagnostic>> {
    if schema.visibility_governance.is_none() {
        return Ok(Vec::new());
    }
    let config = match config_path {
        Some(path) => target_config_from_path(path)?,
        None => target_config_from_environment()?,
    };
    validate_activation_with_config(schema, functions, &config, server_profile, now_ms)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use ring::rand::SystemRandom;
    use ring::signature::{Ed25519KeyPair, KeyPair as _};
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn run_node(root: &Path, arguments: &[&str]) {
        let output = Command::new(std::env::var_os("NODE").unwrap_or_else(|| "node".into()))
            .args(arguments)
            .current_dir(root)
            .output()
            .expect("Node must launch for the visibility-governance dev-mint fixture");
        assert!(
            output.status.success(),
            "Node command failed: {}\nstdout:\n{}\nstderr:\n{}",
            arguments.join(" "),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
    }

    #[test]
    fn trusted_time_refuses_future_and_expired_windows_and_warns_last_thirty_days() {
        let window = VisibilityProductionWindowV1 {
            override_id: "moderator-v1".to_owned(),
            issued_on: "2026-08-15T12:00:00Z".to_owned(),
            expires_on: "2026-09-01".to_owned(),
        };
        let before = parse_date_ms("2026-08-15T11:59:59Z", false).unwrap();
        assert_eq!(
            ensure_override_time_valid(&window, before)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_NOT_YET_VALID"
        );
        let active = parse_date_ms("2026-08-16T00:00:00Z", false).unwrap();
        assert!(
            ensure_override_time_valid(&window, active)
                .unwrap()
                .is_some()
        );
        let expired = parse_date_ms("2026-09-02T00:00:00Z", false).unwrap();
        assert_eq!(
            ensure_override_time_valid(&window, expired)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRED"
        );
        let overlong = VisibilityProductionWindowV1 {
            override_id: "overlong-v1".to_owned(),
            issued_on: "2026-01-01T00:00:00.000Z".to_owned(),
            expires_on: "2026-04-02".to_owned(),
        };
        assert_eq!(
            ensure_override_time_valid(
                &overlong,
                parse_date_ms("2026-01-02T00:00:00Z", false).unwrap(),
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID"
        );
    }

    #[test]
    fn fixture_profile_is_an_exact_target_owned_tuple() {
        let governance = VisibilityGovernanceActivationV1 {
            schema_version: ACTIVATION_SCHEMA.to_owned(),
            required: true,
            generation_inputs_hash: "sha256:inputs".to_owned(),
            visibility_authorization_program_digest: "sha256:program".to_owned(),
            override_baseline_digest: "sha256:overrides".to_owned(),
            table_policy_baseline_digest: "sha256:policies".to_owned(),
            quarantine_head_digest: "sha256:quarantine".to_owned(),
            fixture_profiles: vec![VisibilityFixtureProfileV1 {
                override_id: "system-fixture".to_owned(),
                id: "repo-fixture".to_owned(),
                digest: "sha256:fixture".to_owned(),
                target_class_ceiling: "repository-local".to_owned(),
                principal_class: "synthetic".to_owned(),
                data_classification: "fixture-owned".to_owned(),
            }],
            production_windows: Vec::new(),
        };
        let config = VisibilityGovernanceTargetConfigV1 {
            schema_version: TARGET_CONFIG_SCHEMA.to_owned(),
            source_oid: "0".repeat(40),
            observer_key_epoch: "epoch".to_owned(),
            observer_key_digest: "sha256:key".to_owned(),
            observer_public_key_base64: "unused".to_owned(),
            revoked_observer_key_epochs: Vec::new(),
            quarantine_checkpoint: "sha256:quarantine".to_owned(),
            target_class: "production".to_owned(),
            fixture_profile: None,
            verdict: serde_json::json!({}),
        };
        assert_eq!(
            validate_fixture_profiles(&governance, &config)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY"
        );
        let mut forged_profile = config;
        forged_profile.fixture_profile = Some(TargetFixtureProfileV1 {
            id: "repo-fixture".to_owned(),
            digest: "sha256:fixture".to_owned(),
            target_class: "repository-local".to_owned(),
            principal_class: "synthetic".to_owned(),
            data_classification: "fixture-owned".to_owned(),
        });
        assert_eq!(
            validate_fixture_profiles(&governance, &forged_profile)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY"
        );
    }

    fn signed_activation_fixture() -> (
        SchemaManifest,
        FunctionManifest,
        VisibilityGovernanceTargetConfigV1,
        Vec<u8>,
    ) {
        let mut schema = SchemaManifest {
            app_id: "governed-app".to_owned(),
            schema_hash: Some("sha256:schema".to_owned()),
            ..SchemaManifest::default()
        };
        schema.visibility_governance = Some(VisibilityGovernanceActivationV1 {
            schema_version: ACTIVATION_SCHEMA.to_owned(),
            required: true,
            generation_inputs_hash: "sha256:inputs".to_owned(),
            visibility_authorization_program_digest: "sha256:program".to_owned(),
            override_baseline_digest: "sha256:overrides".to_owned(),
            table_policy_baseline_digest: "sha256:policies".to_owned(),
            quarantine_head_digest: "sha256:quarantine".to_owned(),
            fixture_profiles: Vec::new(),
            production_windows: Vec::new(),
        });
        let functions = FunctionManifest {
            bundle_hash: Some("sha256:functions".to_owned()),
            ..FunctionManifest::default()
        };
        let activation_digest =
            activation_carrier_digest(schema.visibility_governance.as_ref().unwrap()).unwrap();
        assert_eq!(
            activation_digest,
            "sha256:3a90e8a597c05635c058c6b595c95506fb278cec0eeefe88ba217abb7a2ffe1a",
            "Rust activation canonicalization must match the JavaScript G0 digest fixture",
        );
        let private_key = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        let key_pair = Ed25519KeyPair::from_pkcs8(private_key.as_ref()).unwrap();
        let public_key = key_pair.public_key().as_ref();
        let key_digest = observer_key_digest(public_key).unwrap();
        let mut verdict = serde_json::json!({
            "schemaVersion": VERDICT_SCHEMA,
            "disposition": "green",
            "providerProfile": "github-push-v1",
            "afterOid": "1".repeat(40),
            "observedAt": "1970-01-01T00:00:00Z",
            "observerKeyEpoch": "epoch-1",
            "observerKeyDigest": key_digest,
            "deploymentIdentities": [{
                "appId": "governed-app",
                "schemaHash": "sha256:schema",
                "functionBundleHash": "sha256:functions",
                "generationInputsHash": "sha256:inputs",
                "visibilityAuthorizationProgramDigest": "sha256:program",
                "visibilityGovernanceActivationDigest": activation_digest,
                "quarantineHeadDigest": "sha256:quarantine"
            }]
        });
        let signature = key_pair.sign(canonical_json(&verdict).unwrap().as_bytes());
        verdict.as_object_mut().unwrap().insert(
            "signature".to_owned(),
            Value::String(STANDARD.encode(signature)),
        );
        let config = VisibilityGovernanceTargetConfigV1 {
            schema_version: TARGET_CONFIG_SCHEMA.to_owned(),
            source_oid: "1".repeat(40),
            observer_key_epoch: "epoch-1".to_owned(),
            observer_key_digest: key_digest,
            observer_public_key_base64: STANDARD.encode(public_key),
            revoked_observer_key_epochs: Vec::new(),
            quarantine_checkpoint: "sha256:quarantine".to_owned(),
            target_class: "repository-local".to_owned(),
            fixture_profile: None,
            verdict,
        };
        (schema, functions, config, private_key.as_ref().to_vec())
    }

    fn resign_verdict(config: &mut VisibilityGovernanceTargetConfigV1, private_key: &[u8]) {
        config.verdict.as_object_mut().unwrap().remove("signature");
        let key_pair = Ed25519KeyPair::from_pkcs8(private_key).unwrap();
        let signature = key_pair.sign(canonical_json(&config.verdict).unwrap().as_bytes());
        config.verdict.as_object_mut().unwrap().insert(
            "signature".to_owned(),
            Value::String(STANDARD.encode(signature)),
        );
    }

    pub(crate) fn signed_repository_local_dev_activation_fixture() -> (
        SchemaManifest,
        FunctionManifest,
        VisibilityGovernanceTargetConfigV1,
    ) {
        let (schema, functions, mut config, private_key) = signed_activation_fixture();
        config.verdict["providerProfile"] = Value::String(DEV_VERDICT_PROVIDER.to_owned());
        resign_verdict(&mut config, &private_key);
        (schema, functions, config)
    }

    #[test]
    fn activation_deep_matches_every_deployment_identity_digest() {
        let (schema, functions, config, _) = signed_activation_fixture();
        assert!(
            validate_activation_with_config(&schema, &functions, &config, ServerProfile::Dev, 0,)
                .is_ok()
        );

        for field in [
            "schemaHash",
            "functionBundleHash",
            "generationInputsHash",
            "visibilityAuthorizationProgramDigest",
            "quarantineHeadDigest",
        ] {
            let mut changed_schema = schema.clone();
            let mut changed_functions = functions.clone();
            match field {
                "schemaHash" => changed_schema.schema_hash = Some("sha256:swapped".to_owned()),
                "functionBundleHash" => {
                    changed_functions.bundle_hash = Some("sha256:swapped".to_owned());
                }
                "generationInputsHash" => {
                    changed_schema
                        .visibility_governance
                        .as_mut()
                        .unwrap()
                        .generation_inputs_hash = "sha256:swapped".to_owned();
                }
                "visibilityAuthorizationProgramDigest" => {
                    changed_schema
                        .visibility_governance
                        .as_mut()
                        .unwrap()
                        .visibility_authorization_program_digest = "sha256:swapped".to_owned();
                }
                "quarantineHeadDigest" => {
                    changed_schema
                        .visibility_governance
                        .as_mut()
                        .unwrap()
                        .quarantine_head_digest = "sha256:swapped".to_owned();
                }
                _ => unreachable!(),
            }
            assert_eq!(
                validate_activation_with_config(
                    &changed_schema,
                    &changed_functions,
                    &config,
                    ServerProfile::Dev,
                    0,
                )
                .unwrap_err()
                .diagnostic
                .code,
                "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH",
                "field {field} must be verdict-bound",
            );
        }

        for field in [
            "required",
            "overrideBaselineDigest",
            "tablePolicyBaselineDigest",
            "fixtureProfiles",
            "productionWindows",
        ] {
            let mut changed_schema = schema.clone();
            let governance = changed_schema.visibility_governance.as_mut().unwrap();
            match field {
                "required" => governance.required = false,
                "overrideBaselineDigest" => {
                    governance.override_baseline_digest = "sha256:swapped".to_owned();
                }
                "tablePolicyBaselineDigest" => {
                    governance.table_policy_baseline_digest = "sha256:swapped".to_owned();
                }
                "fixtureProfiles" => governance
                    .fixture_profiles
                    .push(VisibilityFixtureProfileV1 {
                        override_id: "swapped".to_owned(),
                        id: "swapped".to_owned(),
                        digest: "sha256:swapped".to_owned(),
                        target_class_ceiling: "repository-local".to_owned(),
                        principal_class: "synthetic".to_owned(),
                        data_classification: "fixture-owned".to_owned(),
                    }),
                "productionWindows" => {
                    governance
                        .production_windows
                        .push(VisibilityProductionWindowV1 {
                            override_id: "swapped".to_owned(),
                            issued_on: "2026-08-15T00:00:00Z".to_owned(),
                            expires_on: "2026-08-16".to_owned(),
                        })
                }
                _ => unreachable!(),
            }
            assert_eq!(
                validate_activation_with_config(
                    &changed_schema,
                    &functions,
                    &config,
                    ServerProfile::Dev,
                    0,
                )
                .unwrap_err()
                .diagnostic
                .code,
                "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH",
                "activation carrier field {field} must be verdict-bound",
            );
        }
    }

    #[test]
    fn node_canonical_signed_verdict_activates() {
        let (schema, functions, _, _) = signed_activation_fixture();
        let key_digest = "sha256:03c9c71d6d7cd9dd5f140942b7bcf352902fb716dcc23739bdd585adb93cd2f6";
        let config = VisibilityGovernanceTargetConfigV1 {
            schema_version: TARGET_CONFIG_SCHEMA.to_owned(),
            source_oid: "1".repeat(40),
            observer_key_epoch: "epoch-1".to_owned(),
            observer_key_digest: key_digest.to_owned(),
            observer_public_key_base64: "qj7qMpwjJ9P9RPBLmnIlUt6ly6lxKeJxoUOTkSyWsng=".to_owned(),
            revoked_observer_key_epochs: Vec::new(),
            quarantine_checkpoint: "sha256:quarantine".to_owned(),
            target_class: "repository-local".to_owned(),
            fixture_profile: None,
            verdict: serde_json::json!({
                "schemaVersion": VERDICT_SCHEMA,
                "disposition": "green",
                "providerProfile": "github-push-v1",
                "afterOid": "1".repeat(40),
                "observedAt": "1970-01-01T00:00:00Z",
                "observerKeyEpoch": "epoch-1",
                "observerKeyDigest": key_digest,
                "deploymentIdentities": [{
                    "appId": "governed-app",
                    "schemaHash": "sha256:schema",
                    "functionBundleHash": "sha256:functions",
                    "generationInputsHash": "sha256:inputs",
                    "visibilityAuthorizationProgramDigest": "sha256:program",
                    "visibilityGovernanceActivationDigest": "sha256:3a90e8a597c05635c058c6b595c95506fb278cec0eeefe88ba217abb7a2ffe1a",
                    "quarantineHeadDigest": "sha256:quarantine"
                }],
                "signature": "9e5LE6sL3r1LBxdk9dcCOXwRgdoPG7FrtjokCDL6fvzdNvuMt+IOu9V9OvL3iyxqOv+xGpcBY/6MM8V2OBVWAQ=="
            }),
        };
        assert!(
            validate_activation_with_config(&schema, &functions, &config, ServerProfile::Dev, 0,)
                .is_ok()
        );
    }

    #[test]
    fn activation_rejects_fixture_tuple_swap_and_observer_key_swap() {
        let (mut schema, functions, mut config, private_key) = signed_activation_fixture();
        schema
            .visibility_governance
            .as_mut()
            .unwrap()
            .fixture_profiles = vec![VisibilityFixtureProfileV1 {
            override_id: "fixture".to_owned(),
            id: "profile".to_owned(),
            digest: "sha256:profile".to_owned(),
            target_class_ceiling: "repository-local".to_owned(),
            principal_class: "synthetic".to_owned(),
            data_classification: "fixture-owned".to_owned(),
        }];
        config.fixture_profile = Some(TargetFixtureProfileV1 {
            id: "profile".to_owned(),
            digest: "sha256:swapped".to_owned(),
            target_class: "repository-local".to_owned(),
            principal_class: "synthetic".to_owned(),
            data_classification: "fixture-owned".to_owned(),
        });
        config.verdict["deploymentIdentities"][0]["visibilityGovernanceActivationDigest"] =
            Value::String(
                activation_carrier_digest(schema.visibility_governance.as_ref().unwrap()).unwrap(),
            );
        config.verdict.as_object_mut().unwrap().remove("signature");
        let key_pair = Ed25519KeyPair::from_pkcs8(&private_key).unwrap();
        let signature = key_pair.sign(canonical_json(&config.verdict).unwrap().as_bytes());
        config.verdict.as_object_mut().unwrap().insert(
            "signature".to_owned(),
            Value::String(STANDARD.encode(signature)),
        );
        assert_eq!(
            validate_activation_with_config(&schema, &functions, &config, ServerProfile::Dev, 0,)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY",
        );

        let (schema, functions, mut config, _) = signed_activation_fixture();
        config.observer_key_digest = "sha256:forged".to_owned();
        assert_eq!(
            validate_activation_with_config(&schema, &functions, &config, ServerProfile::Dev, 0,)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
        );

        for provider in ["", "unsupported-provider-v1"] {
            let (schema, functions, mut config, private_key) = signed_activation_fixture();
            config.verdict["providerProfile"] = Value::String(provider.to_owned());
            resign_verdict(&mut config, &private_key);
            assert_eq!(
                validate_activation_with_config(
                    &schema,
                    &functions,
                    &config,
                    ServerProfile::Dev,
                    0,
                )
                .unwrap_err()
                .diagnostic
                .code,
                "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
                "provider profile {provider:?} must be nonempty and supported",
            );
        }

        let (schema, functions, mut config, _) = signed_activation_fixture();
        config
            .revoked_observer_key_epochs
            .push(config.observer_key_epoch.clone());
        assert_eq!(
            validate_activation_with_config(&schema, &functions, &config, ServerProfile::Dev, 0,)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE",
        );
    }

    #[test]
    fn repository_local_dev_provider_refuses_production_and_hosted_targets() {
        let (schema, functions, mut config, private_key) = signed_activation_fixture();
        config.verdict["providerProfile"] = Value::String(DEV_VERDICT_PROVIDER.to_owned());
        resign_verdict(&mut config, &private_key);

        assert!(
            validate_activation_with_config(&schema, &functions, &config, ServerProfile::Dev, 0,)
                .is_ok()
        );
        assert_eq!(
            validate_activation_with_config(&schema, &functions, &config, ServerProfile::Prod, 0,)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY",
            "the independently host-resolved production profile must refuse an unchanged dev mint",
        );

        for target_class in ["production", "hosted", "hosted-production"] {
            config.target_class = target_class.to_owned();
            assert_eq!(
                validate_activation_with_config(
                    &schema,
                    &functions,
                    &config,
                    ServerProfile::Dev,
                    0,
                )
                .unwrap_err()
                .diagnostic
                .code,
                "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY",
            );
        }

        let (mut schema, functions, mut config, private_key) = signed_activation_fixture();
        config.verdict["providerProfile"] = Value::String(DEV_VERDICT_PROVIDER.to_owned());
        schema
            .visibility_governance
            .as_mut()
            .unwrap()
            .production_windows
            .push(VisibilityProductionWindowV1 {
                override_id: "production-v1".to_owned(),
                issued_on: "1970-01-01T00:00:00Z".to_owned(),
                expires_on: "1970-01-02".to_owned(),
            });
        config.verdict["deploymentIdentities"][0]["visibilityGovernanceActivationDigest"] =
            Value::String(
                activation_carrier_digest(schema.visibility_governance.as_ref().unwrap()).unwrap(),
            );
        resign_verdict(&mut config, &private_key);
        assert_eq!(
            validate_activation_with_config(&schema, &functions, &config, ServerProfile::Dev, 0,)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY",
            "repository-local dev governance must refuse a nonempty production window",
        );
    }

    #[test]
    fn activation_requires_provider_profile_and_exact_source_oids() {
        let (schema, functions, mut config, private_key) = signed_activation_fixture();
        config
            .verdict
            .as_object_mut()
            .unwrap()
            .remove("providerProfile");
        resign_verdict(&mut config, &private_key);
        assert_eq!(
            validate_activation_with_config(&schema, &functions, &config, ServerProfile::Dev, 0,)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
        );

        let (schema, functions, mut config, _) = signed_activation_fixture();
        config.source_oid = "2".repeat(40);
        assert_eq!(
            validate_activation_with_config(&schema, &functions, &config, ServerProfile::Dev, 0,)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
            "the unsigned target wrapper cannot rebind a signed afterOid",
        );

        let (schema, functions, mut config, private_key) = signed_activation_fixture();
        config.verdict["afterOid"] = Value::String("2".repeat(40));
        resign_verdict(&mut config, &private_key);
        assert_eq!(
            validate_activation_with_config(&schema, &functions, &config, ServerProfile::Dev, 0,)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
            "a validly signed verdict for another afterOid cannot activate this target",
        );
    }

    #[test]
    fn primed_todo_and_rbac_dev_mints_validate_from_target_and_tampering_refuses() {
        let repository_root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let scratch = tempfile::tempdir().unwrap();
        let mut fixtures = Vec::new();

        for (index, backend) in ["demos/todo/snapback", "demos/rbac/snapback"]
            .into_iter()
            .enumerate()
        {
            run_node(
                repository_root,
                &["packages/snapback-codegen/index.mjs", backend],
            );
            let config_path = scratch.path().join(format!("target-config-{index}.json"));
            run_node(
                repository_root,
                &[
                    "scripts/mint-visibility-governance-dev-config.mjs",
                    backend,
                    "--out",
                    config_path.to_str().unwrap(),
                ],
            );

            let backend_root = repository_root.join(backend);
            let schema: SchemaManifest = serde_json::from_slice(
                &fs::read(backend_root.join("generated/schema.manifest.json")).unwrap(),
            )
            .unwrap();
            let functions: FunctionManifest = serde_json::from_slice(
                &fs::read(backend_root.join("generated/functions.manifest.json")).unwrap(),
            )
            .unwrap();
            let now_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;
            assert!(
                validate_activation_from_target(
                    &schema,
                    &functions,
                    ServerProfile::Dev,
                    now_ms,
                    Some(&config_path),
                )
                .is_ok()
            );

            let original = fs::read(&config_path).unwrap();
            let mut tampered: Value = serde_json::from_slice(&original).unwrap();
            tampered["verdict"]["signature"] = Value::String(STANDARD.encode([0_u8; 64]));
            fs::write(&config_path, serde_json::to_vec_pretty(&tampered).unwrap()).unwrap();
            assert_eq!(
                validate_activation_from_target(
                    &schema,
                    &functions,
                    ServerProfile::Dev,
                    now_ms,
                    Some(&config_path),
                )
                .unwrap_err()
                .diagnostic
                .code,
                "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
            );
            fs::write(&config_path, original).unwrap();
            fixtures.push((schema, functions, config_path));
        }

        let (_, _, todo_config) = &fixtures[0];
        let (rbac_schema, rbac_functions, _) = &fixtures[1];
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        assert_eq!(
            validate_activation_from_target(
                rbac_schema,
                rbac_functions,
                ServerProfile::Dev,
                now_ms,
                Some(todo_config),
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH",
            "a todo mint cannot authorize the rbac generated backend",
        );
    }
}
