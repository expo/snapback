//! Language-neutral shared contract type definitions.
//!
//! This module is a dependency-free leaf. Higher-level manifest and runtime
//! modules may consume these definitions, but contract types must not depend on
//! those owners.
//!
//! @ref LLP 0199#target-ownership-map — the shared contract/types leaf is the
//!   canonical downward dependency for Rust owners and generated artifacts.

use serde::{Deserialize, Serialize};

/// The authority mode declared by a schema artifact. The enum is deliberately
/// closed: a mode changes who is allowed to supply invocation authority and an
/// unknown spelling therefore cannot be treated as an additive field.
///
/// @ref LLP 0058#closed-auth-mode — auth mode is a must-understand closed value.
#[derive(
    Clone,
    Copy,
    Debug,
    Default,
    Deserialize,
    Eq,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum AuthMode {
    #[default]
    Dev,
    Sessions,
}

impl AuthMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Sessions => "sessions",
        }
    }

    pub const fn artifact_version(self) -> &'static str {
        match self {
            Self::Dev => "snapback.v0",
            Self::Sessions => "snapback.v1",
        }
    }
}

/// Closed schema-manifest auth declaration. Unknown members are rejected so a
/// future authority-changing field cannot be silently ignored by this parser.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AuthManifest {
    pub mode: AuthMode,
}

/// Function-level requirement applied after caller authority has been resolved.
/// Absence in a legacy function is represented by
/// [`FunctionDefinition::effective_auth_requirement`] as `optional-user`.
///
/// @ref LLP 0058#closed-function-requirement — closed values fail at manifest parse.
#[derive(
    Clone,
    Copy,
    Debug,
    Default,
    Deserialize,
    Eq,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    schemars::JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum AuthRequirement {
    Public,
    #[default]
    OptionalUser,
    Authenticated,
}

impl AuthRequirement {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::OptionalUser => "optional-user",
            Self::Authenticated => "authenticated",
        }
    }
}

/// Optional presentation identity for the loaded app: how the instance should
/// introduce itself to a human. Everything here is public by construction — it
/// is rendered on the public root page and flows into the public inspect
/// projection — so apps must not put secrets in it. The icon/wordmark URLs are
/// ordinary app-served or absolute URLs; the root page renders them as plain
/// `<img>` references with attribute escaping.
///
/// @ref LLP 0017#instance-home-page — the root page renders this identity when
///   the manifest declares it; absent, the page is Snapback-branded only.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct AppIdentity {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default, rename = "iconUrl", alias = "icon_url")]
    pub icon_url: Option<String>,
    #[serde(default, rename = "wordmarkUrl", alias = "wordmark_url")]
    pub wordmark_url: Option<String>,
}
