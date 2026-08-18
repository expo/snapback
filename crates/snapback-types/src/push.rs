use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use crate::diagnostic::{SnapbackError, SnapbackResult};


#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushAppScopeV1 {
    pub eas_project_id: String,
    pub application_id: String,
    pub environment: String,
}


#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushRegistryDeclarationV1 {
    pub idle_retention_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushLedgerDeclarationV1 {
    pub retention_ms: u64,
}

/// The closed v1 resolver vocabulary: all current rows of one LLP 0100
/// membership declaration, optionally narrowed to declared roles.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PushAudienceResolverV1 {
    ExplicitPrincipals {
        principals_arg: String,
        max_items: u16,
    },
    Membership {
        declaration: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resource_arg: Option<String>,
        roles: Vec<String>,
    },
}

/// Host-enforced send authorization. Membership checks are evaluated against
/// the resolved caller at execution; `system` is an explicit declaration,
/// never an inference from a cron/job action.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PushAudienceAuthorizeV1 {
    Membership {
        declaration: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resource_arg: Option<String>,
        roles: Vec<String>,
    },
    System,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushAudienceDeclarationV1 {
    pub resolve: PushAudienceResolverV1,
    pub authorize: PushAudienceAuthorizeV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushSeamDeclarationV1 {
    pub app_scope: PushAppScopeV1,
    pub registry: PushRegistryDeclarationV1,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub audiences: BTreeMap<String, PushAudienceDeclarationV1>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub uses: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ledger: Option<PushLedgerDeclarationV1>,
}

impl PushAppScopeV1 {
    pub fn validate(&self) -> SnapbackResult<()> {
        for (field, value) in [
            ("easProjectId", &self.eas_project_id),
            ("applicationId", &self.application_id),
            ("environment", &self.environment),
        ] {
            if value.is_empty()
                || value.len() > 255
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._-:".contains(&byte))
            {
                return Err(invalid(format!(
                    "push appScope.{field} must be 1..255 ASCII letters, digits, '.', '_', '-', or ':'"
                )));
            }
        }
        Ok(())
    }

    pub fn identity(&self) -> String {
        format!(
            "{}:{}|{}:{}|{}:{}",
            self.eas_project_id.len(),
            self.eas_project_id,
            self.application_id.len(),
            self.application_id,
            self.environment.len(),
            self.environment,
        )
    }
}

impl PushSeamDeclarationV1 {
    pub fn validate(&self) -> SnapbackResult<()> {
        self.app_scope.validate()?;
        if !(86_400_000..=31_536_000_000).contains(&self.registry.idle_retention_ms) {
            return Err(invalid(
                "push registry idleRetentionMs must be between one day and one year",
            ));
        }
        if self.audiences.is_empty() != self.ledger.is_none() {
            return Err(invalid(
                "push audiences and ledger must be declared together",
            ));
        }
        if let Some(ledger) = &self.ledger
            && !(86_400_000..=31_536_000_000).contains(&ledger.retention_ms)
        {
            return Err(invalid(
                "push ledger retentionMs must be between one day and one year",
            ));
        }
        if self.uses.len() > 16
            || self.uses.iter().any(|name| {
                name.is_empty()
                    || name.len() > 64
                    || !name
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
            })
            || self
                .uses
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != self.uses.len()
        {
            return Err(invalid("push uses must be distinct bounded config names"));
        }
        for (name, audience) in &self.audiences {
            if name.is_empty()
                || name.len() > 64
                || !name.bytes().enumerate().all(|(index, byte)| {
                    byte.is_ascii_alphabetic()
                        || byte == b'_'
                        || (index > 0 && byte.is_ascii_digit())
                })
            {
                return Err(invalid("push audience name is invalid"));
            }
            validate_membership_clause(match &audience.resolve {
                PushAudienceResolverV1::ExplicitPrincipals {
                    principals_arg,
                    max_items,
                } => {
                    if !is_push_identifier(principals_arg) || !(1..=1_000).contains(max_items) {
                        return Err(invalid("push explicit-principals resolver is invalid"));
                    }
                    None
                }
                PushAudienceResolverV1::Membership {
                    declaration,
                    resource_arg,
                    roles,
                } => Some((declaration, resource_arg, roles)),
            })?;
            if let PushAudienceAuthorizeV1::Membership {
                declaration,
                resource_arg,
                roles,
            } = &audience.authorize
            {
                validate_membership_clause(Some((declaration, resource_arg, roles)))?;
                if let PushAudienceResolverV1::ExplicitPrincipals { principals_arg, .. } =
                    &audience.resolve
                    && resource_arg.as_ref() == Some(principals_arg)
                {
                    return Err(invalid(
                        "push resolver and authorization arguments have incompatible shapes",
                    ));
                }
            }
        }
        Ok(())
    }
}

fn validate_membership_clause(
    clause: Option<(&String, &Option<String>, &Vec<String>)>,
) -> SnapbackResult<()> {
    let Some((declaration, resource_arg, roles)) = clause else {
        return Ok(());
    };
    if !is_push_identifier(declaration)
        || resource_arg
            .as_deref()
            .is_some_and(|value| !is_push_identifier(value))
        || roles.is_empty()
        || roles.len() > 64
        || roles.iter().any(|role| !is_push_identifier(role))
    {
        return Err(invalid("push membership clause is invalid"));
    }
    Ok(())
}

fn is_push_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphabetic()
                || byte == b'_'
                || byte == b'-'
                || (index > 0 && byte.is_ascii_digit())
        })
}

fn invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_PUSH_TOKEN_INVALID", "push", message)
}
