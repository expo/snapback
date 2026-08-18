//! Versioned, credential-free logical auth transfer artifacts.
//!
//! @ref LLP 0057#catalog-write-and-lifecycle-rules — logical transfer carries
//! users and identities, never sessions, token material, challenges, mailbox
//! state, or keyring bytes, and import rotates the authorization incarnation.
//! @ref LLP 0055#catalog-and-lifecycle — agent ownership, registration
//! provenance, deactivation, and scope bases travel; spendable and pending
//! authority does not.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read as _, Write as _};
use std::path::Path;

pub(crate) const AUTH_LOGICAL_EXPORT_FORMAT_VERSION: u8 = 1;
pub(crate) const AUTH_LOGICAL_EXPORT_SCHEMA_VERSION: &str = "snapback.auth-logical-export.v1";
pub(crate) const AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V2: u8 = 2;
pub(crate) const AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V3: u8 = 3;
pub(crate) const AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V4: u8 = 4;
pub(crate) const MAX_AUTH_LOGICAL_EXPORT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

fn nullable_string_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<Option<String>>()
}

fn nullable_timestamp_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<Option<u64>>()
}

fn nullable_json_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<Option<BTreeMap<String, Value>>>()
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AuthLogicalPrincipalKindV1 {
    Human,
    Agent,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AuthLogicalUserV1 {
    pub id: String,
    pub created_at_ms: u64,
    pub kind: AuthLogicalPrincipalKindV1,
    #[schemars(required, schema_with = "nullable_string_schema")]
    pub display_name: Option<String>,
    #[schemars(required, schema_with = "nullable_string_schema")]
    pub operator_contact: Option<String>,
    #[schemars(required, schema_with = "nullable_json_schema")]
    pub registration_provenance: Option<Value>,
    #[schemars(required, schema_with = "nullable_timestamp_schema")]
    pub deactivated_at_ms: Option<u64>,
    #[schemars(required, schema_with = "nullable_string_schema")]
    pub owner_user_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AuthLogicalIdentityV1 {
    pub id: String,
    pub user_id: String,
    pub provider: String,
    pub subject: String,
    pub verified_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AuthLogicalScopeBaseV1 {
    pub function_id: String,
    pub kind: String,
    pub generation: u64,
    pub present: bool,
    pub authority_creating: bool,
}

/// The only first-class logical auth artifact. Its closed fields are the
/// exclusion mechanism: no bearer, hash, grant, invitation, request, session,
/// challenge, tombstone, mailbox, or key material has a representable slot.
#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AuthLogicalExportV1 {
    pub schema_version: String,
    pub format_version: u8,
    pub auth_catalog_version: u8,
    /// Catalog-v4 identity subjects can only be reconstructed under the same
    /// immutable canonicalization contract. Pre-v4 format-1 artifacts omit
    /// this field and retain their exact wire shape.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password_identifier_mode: Option<String>,
    pub users: Vec<AuthLogicalUserV1>,
    pub identities: Vec<AuthLogicalIdentityV1>,
    pub scope_bases: Vec<AuthLogicalScopeBaseV1>,
}

impl AuthLogicalExportV1 {
    pub(crate) fn new(
        auth_catalog_version: u8,
        password_identifier_mode: Option<String>,
        users: Vec<AuthLogicalUserV1>,
        identities: Vec<AuthLogicalIdentityV1>,
        scope_bases: Vec<AuthLogicalScopeBaseV1>,
    ) -> SnapbackResult<Self> {
        let artifact = Self {
            schema_version: AUTH_LOGICAL_EXPORT_SCHEMA_VERSION.to_owned(),
            format_version: AUTH_LOGICAL_EXPORT_FORMAT_VERSION,
            auth_catalog_version,
            password_identifier_mode,
            users,
            identities,
            scope_bases,
        };
        artifact.validate()?;
        Ok(artifact)
    }

    pub(crate) fn parse(bytes: &[u8]) -> SnapbackResult<Self> {
        if bytes.len() as u64 > MAX_AUTH_LOGICAL_EXPORT_BYTES {
            return Err(logical_import_invalid(
                "logical auth import exceeds the 64 MiB artifact limit",
            ));
        }
        match serde_json::from_slice::<Self>(bytes) {
            Ok(artifact) => {
                require_nullable_user_fields(bytes)?;
                artifact.validate()?;
                Ok(artifact)
            }
            Err(error) => {
                // Preserve one stable unsupported-version result even when an
                // older shape lacks fields the current closed struct requires.
                if let Ok(value) = serde_json::from_slice::<Value>(bytes)
                    && let Some(version) = value.get("formatVersion").and_then(Value::as_u64)
                    && version != u64::from(AUTH_LOGICAL_EXPORT_FORMAT_VERSION)
                {
                    return Err(logical_format_unsupported(version));
                }
                Err(logical_import_invalid(format!(
                    "logical auth import is not closed format 1 JSON: {error}"
                )))
            }
        }
    }

    pub(crate) fn validate(&self) -> SnapbackResult<()> {
        if self.format_version != AUTH_LOGICAL_EXPORT_FORMAT_VERSION {
            return Err(logical_format_unsupported(u64::from(self.format_version)));
        }
        if self.schema_version != AUTH_LOGICAL_EXPORT_SCHEMA_VERSION
            || !matches!(
                self.auth_catalog_version,
                AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V2
                    | AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V3
                    | AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V4
            )
        {
            return Err(logical_import_invalid(
                "logical auth import names an unsupported schema or auth catalog version",
            ));
        }
        match self.auth_catalog_version {
            AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V4
                if !matches!(
                    self.password_identifier_mode.as_deref(),
                    Some("username-v1" | "email-v1")
                ) =>
            {
                return Err(logical_import_invalid(
                    "catalog-v4 logical auth import lacks a valid password identifier mode",
                ));
            }
            AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V2 | AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V3
                if self.password_identifier_mode.is_some() =>
            {
                return Err(logical_import_invalid(
                    "a predecessor logical auth import carries catalog-v4 identifier metadata",
                ));
            }
            _ => {}
        }

        validate_strictly_sorted_unique(self.users.iter().map(|row| row.id.as_str()), "user")?;
        validate_strictly_sorted_unique(
            self.identities.iter().map(|row| row.id.as_str()),
            "identity",
        )?;
        validate_strictly_sorted_unique(
            self.scope_bases.iter().map(|row| row.function_id.as_str()),
            "scope base",
        )?;

        let users = self
            .users
            .iter()
            .map(|row| (row.id.as_str(), row))
            .collect::<BTreeMap<_, _>>();
        for user in &self.users {
            if user.id.is_empty() || user.created_at_ms > MAX_SAFE_INTEGER {
                return Err(logical_import_invalid(
                    "logical auth import contains an invalid user id or timestamp",
                ));
            }
            if user
                .deactivated_at_ms
                .is_some_and(|value| value > MAX_SAFE_INTEGER)
            {
                return Err(logical_import_invalid(
                    "logical auth import contains an invalid deactivation timestamp",
                ));
            }
            match user.kind {
                AuthLogicalPrincipalKindV1::Human => {
                    if user.registration_provenance.is_some()
                        || user.deactivated_at_ms.is_some()
                        || user.owner_user_id.is_some()
                    {
                        return Err(logical_import_invalid(
                            "a human logical principal carries agent-only state",
                        ));
                    }
                }
                AuthLogicalPrincipalKindV1::Agent => {
                    if !matches!(user.registration_provenance, Some(Value::Object(_))) {
                        return Err(logical_import_invalid(
                            "an agent logical principal lacks object registration provenance",
                        ));
                    }
                    if let Some(owner) = user.owner_user_id.as_deref() {
                        let Some(owner_row) = users.get(owner) else {
                            return Err(logical_import_invalid(
                                "an agent owner is absent from the logical user set",
                            ));
                        };
                        if owner == user.id || owner_row.kind != AuthLogicalPrincipalKindV1::Human {
                            return Err(logical_import_invalid(
                                "an agent owner is not a distinct human principal",
                            ));
                        }
                    }
                }
            }
        }

        let mut provider_subjects = BTreeSet::new();
        for identity in &self.identities {
            if identity.id.is_empty()
                || identity.provider.is_empty()
                || identity.subject.is_empty()
                || identity.verified_at_ms > MAX_SAFE_INTEGER
                || !users.contains_key(identity.user_id.as_str())
            {
                return Err(logical_import_invalid(
                    "logical auth import contains an invalid or orphaned identity",
                ));
            }
            if !provider_subjects.insert((identity.provider.as_str(), identity.subject.as_str())) {
                return Err(logical_identity_collision());
            }
            if identity.provider == "email-code" {
                let canonical = crate::auth::crypto::CanonicalAddress::parse(&identity.subject)
                    .map_err(|_| {
                        logical_import_invalid(
                            "logical auth import contains a non-canonical email-code subject",
                        )
                    })?;
                if canonical.as_str() != identity.subject {
                    return Err(logical_import_invalid(
                        "logical auth import contains a non-canonical email-code subject",
                    ));
                }
            }
        }

        for scope in &self.scope_bases {
            if scope.function_id.is_empty()
                || scope.kind.is_empty()
                || scope.generation > MAX_SAFE_INTEGER
            {
                return Err(logical_import_invalid(
                    "logical auth import contains an invalid scope basis",
                ));
            }
        }
        Ok(())
    }

    pub(crate) fn to_pretty_bytes(&self) -> SnapbackResult<Vec<u8>> {
        self.validate()?;
        let mut bytes = serde_json::to_vec_pretty(self).map_err(|error| {
            logical_export_invalid(format!("logical auth export could not be encoded: {error}"))
        })?;
        bytes.push(b'\n');
        Ok(bytes)
    }
}

fn require_nullable_user_fields(bytes: &[u8]) -> SnapbackResult<()> {
    let value = serde_json::from_slice::<Value>(bytes)
        .map_err(|error| logical_import_invalid(format!("invalid JSON: {error}")))?;
    let Some(users) = value.get("users").and_then(Value::as_array) else {
        return Err(logical_import_invalid(
            "logical auth import users must be an array",
        ));
    };
    const REQUIRED_NULLABLE_FIELDS: &[&str] = &[
        "displayName",
        "operatorContact",
        "registrationProvenance",
        "deactivatedAtMs",
        "ownerUserId",
    ];
    for user in users {
        let Some(object) = user.as_object() else {
            return Err(logical_import_invalid(
                "logical auth import user rows must be objects",
            ));
        };
        if REQUIRED_NULLABLE_FIELDS
            .iter()
            .any(|field| !object.contains_key(*field))
        {
            return Err(logical_import_invalid(
                "logical auth import user rows must explicitly carry every nullable field",
            ));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthLogicalImportOutcomeV1 {
    pub schema_version: &'static str,
    pub users_imported: usize,
    pub identities_imported: usize,
    pub scope_bases_imported: usize,
    pub owned_agents: usize,
    pub unowned_agents: usize,
    pub deactivated_agents: usize,
    pub authorization_incarnation: String,
}

impl AuthLogicalImportOutcomeV1 {
    pub(crate) fn from_artifact(
        artifact: &AuthLogicalExportV1,
        authorization_incarnation: String,
    ) -> Self {
        Self {
            schema_version: "snapback.auth-logical-import-result.v1",
            users_imported: artifact.users.len(),
            identities_imported: artifact.identities.len(),
            scope_bases_imported: artifact.scope_bases.len(),
            owned_agents: artifact
                .users
                .iter()
                .filter(|row| {
                    row.kind == AuthLogicalPrincipalKindV1::Agent && row.owner_user_id.is_some()
                })
                .count(),
            unowned_agents: artifact
                .users
                .iter()
                .filter(|row| {
                    row.kind == AuthLogicalPrincipalKindV1::Agent && row.owner_user_id.is_none()
                })
                .count(),
            deactivated_agents: artifact
                .users
                .iter()
                .filter(|row| row.deactivated_at_ms.is_some())
                .count(),
            authorization_incarnation,
        }
    }
}

pub(crate) fn read_artifact(path: &Path) -> SnapbackResult<AuthLogicalExportV1> {
    let file = std::fs::File::open(path).map_err(|error| {
        logical_import_invalid(format!(
            "logical auth import could not open {}: {error}",
            path.display()
        ))
    })?;
    let length = file
        .metadata()
        .map_err(|error| logical_import_invalid(error.to_string()))?
        .len();
    if length > MAX_AUTH_LOGICAL_EXPORT_BYTES {
        return Err(logical_import_invalid(
            "logical auth import exceeds the 64 MiB artifact limit",
        ));
    }
    let mut bytes = Vec::with_capacity(length as usize);
    file.take(MAX_AUTH_LOGICAL_EXPORT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| logical_import_invalid(error.to_string()))?;
    AuthLogicalExportV1::parse(&bytes)
}

pub(crate) fn write_artifact(path: &Path, artifact: &AuthLogicalExportV1) -> SnapbackResult<()> {
    if path.exists() {
        return Err(logical_export_invalid(format!(
            "logical auth export output already exists: {}",
            path.display()
        )));
    }
    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let bytes = artifact.to_pretty_bytes()?;
    let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(|error| {
        logical_export_invalid(format!(
            "logical auth export could not create staging file: {error}"
        ))
    })?;
    staged
        .as_file_mut()
        .write_all(&bytes)
        .and_then(|_| staged.as_file_mut().sync_all())
        .map_err(|error| {
            logical_export_invalid(format!(
                "logical auth export could not publish bytes: {error}"
            ))
        })?;
    staged.persist_noclobber(path).map_err(|error| {
        logical_export_invalid(format!(
            "logical auth export could not publish {}: {}",
            path.display(),
            error.error
        ))
    })?;
    Ok(())
}

fn validate_strictly_sorted_unique<'a>(
    values: impl Iterator<Item = &'a str>,
    class: &str,
) -> SnapbackResult<()> {
    let mut previous = None;
    for value in values {
        if value.is_empty() || previous.is_some_and(|prior| prior >= value) {
            return Err(logical_import_invalid(format!(
                "logical auth {class} rows are not strictly id-sorted and unique"
            )));
        }
        previous = Some(value);
    }
    Ok(())
}

pub(crate) fn logical_export_invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_LOGICAL_EXPORT_INVALID",
        "auth-logical-export",
        message,
    )
}

pub(crate) fn logical_import_invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_LOGICAL_IMPORT_INVALID",
        "auth-logical-import",
        message,
    )
}

pub(crate) fn logical_target_not_empty() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_LOGICAL_IMPORT_TARGET_NOT_EMPTY",
        "auth-logical-import",
        "logical auth import requires an exact current catalog with no auth rows or retained auth carriers",
    )
}

pub(crate) fn logical_identity_collision() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_LOGICAL_IMPORT_IDENTITY_COLLISION",
        "auth-logical-import",
        "logical auth import contains a duplicate provider/subject identity",
    )
}

fn logical_format_unsupported(version: u64) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_LOGICAL_IMPORT_FORMAT_UNSUPPORTED",
        "auth-logical-import",
        format!("logical auth import format {version} is unsupported; expected format 1"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logical_export_schema_requires_and_accepts_explicit_null_user_fields() {
        let schema = serde_json::to_value(schemars::schema_for!(AuthLogicalExportV1)).unwrap();
        let user = &schema["$defs"]["AuthLogicalUserV1"];
        let required = user["required"].as_array().unwrap();
        for field in [
            "displayName",
            "operatorContact",
            "registrationProvenance",
            "deactivatedAtMs",
            "ownerUserId",
        ] {
            assert!(required.iter().any(|value| value == field), "{field}");
            assert!(schema_accepts_null(&user["properties"][field]), "{field}");
        }
    }

    fn schema_accepts_null(schema: &Value) -> bool {
        schema == &Value::Bool(true)
            || schema["type"] == "null"
            || schema["type"]
                .as_array()
                .is_some_and(|types| types.iter().any(|value| value == "null"))
            || ["anyOf", "oneOf"]
                .iter()
                .filter_map(|key| schema[*key].as_array())
                .flatten()
                .any(schema_accepts_null)
    }
}
