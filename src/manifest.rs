use crate::diagnostic::{Diagnostic, PublicDiagnostic, SnapbackError, SnapbackResult};
use crate::ephemeral::EphemeralCollection;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::str::FromStr;

pub use crate::search::types::{
    FullTextSearchFactsV1, SearchClauseV1, SearchCursorLimitsV1, SearchCursorV1,
    SearchFieldClassV1, SearchFilterV1, SearchHighlightV1, SearchIndexManifestV1, SearchItemV1,
    SearchMaintenanceLimitsV1, SearchMatchAtomV1, SearchMatchRangeV1, SearchPageV1, SearchPhraseV1,
    SearchQueryAstV1, SearchQueryLimitsV1, SearchQueryPlanV1, SearchRequestV1,
    SearchSourceLimitsV1, SearchTermV1, SearchTextFieldV1, SearchVisibilityV1,
};

pub const SNAPBACK_SCHEMA_VERSION: &str = "snapback.v0";
/// The paired schema/function artifact version reserved for session authority.
/// Non-pair artifacts (capabilities, diagnostics, runtime state, and wire DTOs)
/// intentionally remain at [`SNAPBACK_SCHEMA_VERSION`].
pub const SNAPBACK_SESSIONS_SCHEMA_VERSION: &str = "snapback.v1";
/// Portable query budgets shared by the local and Cloudflare evaluators. The
/// Filter-bind and `In` caps stay below SQLite's 999-variable compatibility
/// floor with room for target-internal parameters; the result cap matches the
/// existing 1,024-item bounded runtime lanes.
pub const QUERY_MAX_LIMIT: usize = 1_024;
pub const QUERY_DEFAULT_LIMIT: usize = QUERY_MAX_LIMIT;
pub const QUERY_MAX_IN_ITEMS: usize = 500;
pub const QUERY_MAX_FILTER_BINDINGS: usize = 500;
pub const QUERY_MAX_BUFFERED_WRITES: usize = 1_024;
pub const QUERY_INTERNAL_OVERFETCH_MAX: usize = QUERY_MAX_LIMIT + QUERY_MAX_BUFFERED_WRITES;
/// One request may cumulatively acknowledge this many durable mutation
/// settlements. It matches the existing 1,024-item replay-ledger budget so a
/// hostile envelope cannot turn acknowledgement into unbounded SQLite work.
pub const CLIENT_MUTATION_ACK_MAX_IDS: usize = 1_024;
pub const TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX: &str = "local-dev-sqlite-ibex";
/// The standard SQLite + Ibex server when its lifecycle and network endpoint
/// are owned outside the consuming application. The service semantics match
/// the local development target; only lifecycle authority differs.
pub const TARGET_PROFILE_REMOTE_SERVICE_SQLITE_IBEX: &str = "remote-service-sqlite-ibex";
/// The LLP 0048 conformance twin's internal profile — named to be
/// unmistakably non-public so generated clients cannot mistake it for a
/// supported `local-dev-sqlite-v8` target.
pub const TARGET_PROFILE_LOCAL_CONFORMANCE_SQLITE_WORKERD_V8: &str =
    "local-conformance-sqlite-workerd-v8";
/// The LLP 0040 Cloudflare narrow-proof profile (LLP 0014 §Resolution:
/// everything on Durable Objects).
pub const TARGET_PROFILE_CLOUDFLARE_DO_SQLITE_V8: &str = "cloudflare-do-sqlite-v8";

fn schema_manifest_kind() -> String {
    "schemaManifest".to_owned()
}

fn function_manifest_kind() -> String {
    "functionManifest".to_owned()
}

fn capability_manifest_kind() -> String {
    "capabilityManifest".to_owned()
}

fn snapback_schema_version() -> String {
    SNAPBACK_SCHEMA_VERSION.to_owned()
}

fn local_app_id() -> String {
    "local-app".to_owned()
}

fn default_true() -> bool {
    true
}

fn is_false(value: &bool) -> bool {
    !*value
}

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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct SchemaManifest {
    #[serde(
        default = "schema_manifest_kind",
        rename = "artifactKind",
        alias = "artifact_kind"
    )]
    pub artifact_kind: String,
    #[serde(
        default = "snapback_schema_version",
        rename = "schemaVersion",
        alias = "schema_version"
    )]
    pub schema_version: String,
    #[serde(default = "local_app_id", rename = "appId", alias = "app_id")]
    pub app_id: String,
    #[serde(default)]
    pub app: Option<AppIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthManifest>,
    #[serde(
        default,
        rename = "requiredCapabilities",
        alias = "required_capabilities",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub required_capabilities: Vec<String>,
    #[serde(default, rename = "schemaHash", alias = "schema_hash")]
    pub schema_hash: Option<String>,
    #[serde(default, rename = "inputsHash", alias = "inputs_hash")]
    pub inputs_hash: Option<String>,
    #[serde(default, rename = "generatedAt", alias = "generated_at")]
    pub generated_at: Option<u64>,
    #[serde(default, rename = "sourceHash", alias = "source_hash")]
    pub source_hash: Option<String>,
    #[serde(
        default,
        rename = "artifactDiagnostics",
        alias = "artifact_diagnostics"
    )]
    pub artifact_diagnostics: Vec<Diagnostic>,
    #[serde(default, rename = "targetProfile", alias = "target_profile")]
    pub target_profile: Option<String>,
    #[serde(default, rename = "portabilityFlags", alias = "portability_flags")]
    pub portability_flags: Vec<String>,
    #[serde(
        default,
        rename = "ephemeralCollections",
        alias = "ephemeral_collections"
    )]
    pub ephemeral_collections: Vec<EphemeralCollection>,
    pub tables: Vec<TableManifest>,
}

impl Default for SchemaManifest {
    fn default() -> Self {
        Self {
            artifact_kind: schema_manifest_kind(),
            schema_version: snapback_schema_version(),
            app_id: local_app_id(),
            app: None,
            auth: None,
            required_capabilities: Vec::new(),
            schema_hash: None,
            inputs_hash: None,
            generated_at: None,
            source_hash: None,
            artifact_diagnostics: Vec::new(),
            target_profile: Some(TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned()),
            portability_flags: Vec::new(),
            ephemeral_collections: Vec::new(),
            tables: Vec::new(),
        }
    }
}

impl SchemaManifest {
    pub fn table(&self, name: &str) -> Option<&TableManifest> {
        self.tables.iter().find(|table| table.name == name)
    }

    pub fn effective_auth_mode(&self) -> AuthMode {
        self.auth.map(|auth| auth.mode).unwrap_or(AuthMode::Dev)
    }

    pub fn validate_artifact(&self) -> SnapbackResult<()> {
        validate_artifact_header(
            "schema",
            "schemaManifest",
            &self.artifact_kind,
            &self.schema_version,
            self.schema_hash.as_deref(),
            self.inputs_hash.as_deref(),
        )?;

        let mode = self.effective_auth_mode();
        let tuple_supported = matches!(
            (self.schema_version.as_str(), mode),
            (SNAPBACK_SCHEMA_VERSION, AuthMode::Dev)
                | (SNAPBACK_SESSIONS_SCHEMA_VERSION, AuthMode::Sessions)
        );
        if !tuple_supported {
            return Err(SnapbackError::error(
                "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION",
                "schema",
                format!(
                    "unsupported schema/auth tuple {} + {}",
                    self.schema_version,
                    mode.as_str()
                ),
            )
            .with_details(serde_json::json!({
                "schemaVersion": self.schema_version,
                "authMode": mode.as_str(),
            })));
        }

        if self.schema_version == SNAPBACK_SESSIONS_SCHEMA_VERSION {
            validate_known_v1_capabilities(self.required_capabilities.iter().map(String::as_str))?;
            if !self
                .required_capabilities
                .iter()
                .any(|capability| capability == TargetCapabilityId::AuthSessionsV1.as_str())
            {
                return Err(unsupported_capability_error(
                    TargetCapabilityId::AuthSessionsV1.as_str(),
                    "a sessions schema must require auth.sessions.v1",
                ));
            }
        } else if self
            .required_capabilities
            .iter()
            .any(|capability| capability == TargetCapabilityId::AuthSessionsV1.as_str())
        {
            return Err(unsupported_capability_error(
                TargetCapabilityId::AuthSessionsV1.as_str(),
                "a v0 dev schema must not require auth.sessions.v1",
            ));
        }

        Ok(())
    }
}

/// Public schema identity facts. The schema itself is intentionally public,
/// but artifact diagnostics are projected to their stable classification so
/// source paths and application values in producer-authored text stay gated.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicSchemaManifest {
    #[serde(rename = "artifactKind")]
    pub artifact_kind: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "appId")]
    pub app_id: String,
    pub app: Option<AppIdentity>,
    pub auth: Option<AuthManifest>,
    #[serde(rename = "requiredCapabilities")]
    pub required_capabilities: Vec<String>,
    #[serde(rename = "schemaHash")]
    pub schema_hash: Option<String>,
    #[serde(rename = "inputsHash")]
    pub inputs_hash: Option<String>,
    #[serde(rename = "generatedAt")]
    pub generated_at: Option<u64>,
    #[serde(rename = "sourceHash")]
    pub source_hash: Option<String>,
    #[serde(rename = "artifactDiagnostics")]
    pub artifact_diagnostics: Vec<PublicDiagnostic>,
    #[serde(rename = "targetProfile")]
    pub target_profile: Option<String>,
    #[serde(rename = "portabilityFlags")]
    pub portability_flags: Vec<String>,
    #[serde(rename = "ephemeralCollections")]
    pub ephemeral_collections: Vec<EphemeralCollection>,
    pub tables: Vec<TableManifest>,
}

impl From<SchemaManifest> for PublicSchemaManifest {
    fn from(manifest: SchemaManifest) -> Self {
        let SchemaManifest {
            artifact_kind,
            schema_version,
            app_id,
            app,
            auth,
            required_capabilities,
            schema_hash,
            inputs_hash,
            generated_at,
            source_hash,
            artifact_diagnostics,
            target_profile,
            portability_flags,
            ephemeral_collections,
            tables,
        } = manifest;
        Self {
            artifact_kind,
            schema_version,
            app_id,
            app,
            auth,
            required_capabilities,
            schema_hash,
            inputs_hash,
            generated_at,
            source_hash,
            artifact_diagnostics: artifact_diagnostics.into_iter().map(Into::into).collect(),
            target_profile,
            portability_flags,
            ephemeral_collections,
            tables,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TableManifest {
    pub name: String,
    #[serde(default)]
    pub fields: Vec<FieldManifest>,
    #[serde(default)]
    pub indexes: Vec<IndexManifest>,
    /// Portable full-text indexes over this ordinary table. Search metadata is
    /// table-local because source field/visibility validation and synchronous
    /// maintenance are schema obligations, not function-handler conventions.
    ///
    /// @ref LLP 0073#search-declarations — one versioned declaration owns the
    /// complete portable index semantics and work bounds.
    #[serde(
        default,
        rename = "searchIndexes",
        alias = "search_indexes",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub search_indexes: Vec<SearchIndexManifestV1>,
    #[serde(default)]
    pub syncable: bool,
    /// This table contains facts that grant or revoke authority. This axis is
    /// independent of query/result dependence and of function-level
    /// `authorityIndependent` declarations.
    ///
    /// @ref LLP 0053#two-orthogonal-declarations — permission-backing data is
    ///   an explicit table property, not inferred from function reads.
    #[serde(
        default,
        rename = "permissionBacking",
        alias = "permission_backing",
        skip_serializing_if = "is_false"
    )]
    pub permission_backing: bool,
    /// Optional narrowing for known updates. Inserts, deletes, and updates
    /// with absent/empty/unknown changed-field metadata remain conservative.
    #[serde(
        default,
        rename = "permissionFields",
        alias = "permission_fields",
        skip_serializing_if = "Option::is_none"
    )]
    pub permission_fields: Option<Vec<String>>,
    /// At most one `.membership()` declaration per table. Its presence turns
    /// the table into a system-recognized role-per-resource membership table:
    /// a closed role vocabulary, immutable `(principal, resource)` axes, a
    /// generated true-unique index, and a host-enforced write contract.
    /// Declaring it alongside a hand-written `permissionBacking`/
    /// `permissionFields` is a typed manifest error — the derivation owns the
    /// table.
    ///
    /// @ref LLP 0056#declaring-a-membership-table — the membership declaration
    ///   is the recognized shape; the derivation, not the app, owns the table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub membership: Option<MembershipManifest>,
}

impl TableManifest {
    pub fn field(&self, name: &str) -> Option<&FieldManifest> {
        self.fields.iter().find(|field| field.name == name)
    }

    /// Whether writes to this table are authorization events under LLP 0053.
    /// A membership declaration is permission-backing by construction; the
    /// app must not repeat the lower-level `permissionBacking` flag (schema
    /// validation rejects that ambiguous double declaration).
    ///
    /// @ref LLP 0056#invalidation-the-llp-0053-mapping — every membership
    ///   declaration is permission-backing, for every writer.
    pub fn is_permission_backing(&self) -> bool {
        self.permission_backing || self.membership.is_some()
    }

    /// Whether a known update to `field` can change authorization. Ordinary
    /// permission-backing tables use their optional `permissionFields`
    /// narrowing. Membership tables invert their explicit `incidental`
    /// attestation: every declared field is authorization-relevant unless the
    /// declaration proves it inert. The membership validator keeps the
    /// principal/resource/role axes out of `incidental`.
    ///
    /// Unknown fields are handled conservatively by callers before consulting
    /// this method.
    pub fn field_affects_authorization(&self, field: &str) -> bool {
        if let Some(membership) = &self.membership {
            return !membership
                .incidental
                .iter()
                .flatten()
                .any(|incidental| incidental == field);
        }
        self.permission_fields
            .as_ref()
            .is_none_or(|permission_fields| permission_fields.iter().any(|item| item == field))
    }
}

/// The scope a membership declaration binds its `resource` axis to.
///
/// @ref LLP 0056#global-roles — a `resource`-scoped declaration references one
///   resource table; `app` scope is the degenerate global-role case whose
///   resource is a system-constant singleton (never a null column).
#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum MembershipScope {
    /// The declared `resource` column references exactly one resource table.
    #[default]
    Resource,
    /// The whole app is the resource (classic global RBAC as the degenerate
    /// case). There is no `resource` column; uniqueness is one row per
    /// principal per declaration.
    App,
}

/// `lastHolder: { protect: <role> }` — the protected role's *eligible* holder
/// set may never be left empty for any live resource. Schema activation
/// validates the declaration and existing rows; the write path preserves the
/// invariant with commit-time concurrency checks.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the
///   protected role never empties; establishment requires `bootstrapRole == R`.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipLastHolder {
    pub protect: String,
}

/// `expiry: { field, onExpiry }` — a time-bounded membership materialized by
/// the host-bound sweep. In v1 the only `onExpiry` effect is `remove`: with no
/// declared role ordering the host cannot prove any downgrade is
/// non-escalating, so a `downgradeTo:` effect is a manifest error.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — remove-only
///   in v1; the host owns the rollback-checked sweep.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipExpiry {
    pub field: String,
    /// The declared expiry effect. v1 accepts exactly `"remove"`; any other
    /// spelling (e.g. `"downgradeTo:guest"`) is refused by `validate_schema`.
    #[serde(rename = "onExpiry", alias = "on_expiry")]
    pub on_expiry: String,
}

/// The two host-filled attribution levels. `authorityCreating` (LLP 0055)
/// requires `full`. Schema validation enforces the `incidental` floor over
/// the generated provenance columns; the membership writer fills those
/// columns and records the append-only transition log.
///
/// @ref LLP 0056#agents — creation attribution vs. the append-only transition
///   log; `full` is `authorityCreating`'s precondition.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum MembershipProvenance {
    Creation,
    Full,
}

/// The op a transition governs. The manifest loader shape-validates it, and
/// the host evaluates the matrix with caller-class derivation, target binding,
/// and witness capture at the central membership write seam.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MembershipOp {
    Insert,
    SetRole,
    Remove,
    Patch,
}

impl MembershipOp {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Insert => "insert",
            Self::SetRole => "setRole",
            Self::Remove => "remove",
            Self::Patch => "patch",
        }
    }
}

/// Whether a transition acts on the caller's own row or another principal's.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum MembershipTarget {
    /// The effective principal **is** the target row's principal ("self").
    #[serde(rename = "self")]
    Own,
    Other,
}

/// One row of the closed, declaration-level transition matrix (`op` × caller
/// class × self/other × `from`→`to`, or `patch` × `fields`). Manifest loading
/// **shape-validates** every entry — chiefly that no unknown role hides in
/// `by`/`from`/`to` and no undeclared column hides in `fields`, so the closed
/// vocabulary holds. The runtime evaluates this same matrix for every
/// declaration-bound membership write.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the
///   policy is declared, closed by default, and enforced by the host.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipTransition {
    pub op: MembershipOp,
    /// Caller classes: a declared role, or the reserved classes `"self"` /
    /// `"none"`.
    pub by: Vec<String>,
    pub target: MembershipTarget,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<Vec<String>>,
    /// Non-axis, non-role columns a `patch` transition may write.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<Vec<String>>,
}

/// The `.membership()` metadata carried by a [`TableManifest`]. See
/// `crate::storage`'s `validate_schema` for the declaration-shape enforcement
/// and `validate_membership_activation` for the fail-closed scan over existing
/// data.
///
/// The public authoring path emits this exact shape from `.membership()`,
/// including nominal `v.principal()` / `v.id(table)` axes. Schema activation
/// validates existing rows and installs the generated indexes; the host then
/// enforces transition writes, declaration-bound reads, invalidation, and
/// provenance below every app writer.
///
/// @ref LLP 0056#declaring-a-membership-table — the recognized membership
///   shape and its closed, non-null, exact-decoded vocabulary.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipManifest {
    /// Stable declaration id. Absent means it defaults from the table name
    /// (see [`MembershipManifest::effective_id`]); pin it with `id:` to keep a
    /// durable reference stable across a table rename.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Name of the non-null principal-axis field (`v.principal()`).
    pub principal: String,
    /// Name of the non-null resource-axis field. Absent iff `scope: "app"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
    /// Name of the non-null role field.
    pub role: String,
    /// The closed, non-pending role vocabulary.
    pub roles: Vec<String>,
    /// Pending roles — in the write vocabulary but excluded from `memberOf`.
    /// Disjoint from `roles`; their union is the closed write vocabulary.
    #[serde(
        default,
        rename = "pendingRoles",
        alias = "pending_roles",
        skip_serializing_if = "Option::is_none"
    )]
    pub pending_roles: Option<Vec<String>>,
    /// The role the creation witness seats. Required to equal `lastHolder`'s
    /// protected role when `lastHolder` is declared.
    #[serde(
        default,
        rename = "bootstrapRole",
        alias = "bootstrap_role",
        skip_serializing_if = "Option::is_none"
    )]
    pub bootstrap_role: Option<String>,
    #[serde(
        default,
        rename = "lastHolder",
        alias = "last_holder",
        skip_serializing_if = "Option::is_none"
    )]
    pub last_holder: Option<MembershipLastHolder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expiry: Option<MembershipExpiry>,
    /// Attested non-authorization columns. Subject to a hard floor: the
    /// principal/resource/role axes and generated provenance columns can never
    /// be attested incidental.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub incidental: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<MembershipProvenance>,
    /// The closed transition matrix. Shape-validated at manifest load and
    /// executed at the central membership write seam.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub transitions: Vec<MembershipTransition>,
    #[serde(default)]
    pub scope: MembershipScope,
    /// The resource table the `resource` axis references (`v.id("events")`).
    /// Present for `scope: "resource"`; absent for `scope: "app"`. Used by the
    /// activation scan's referential-integrity check. Codegen derives it from
    /// the nominal `v.id(...)` resource-axis declaration; direct manifests are
    /// still validated against the same binding.
    #[serde(
        default,
        rename = "resourceTable",
        alias = "resource_table",
        skip_serializing_if = "Option::is_none"
    )]
    pub resource_table: Option<String>,
}

impl MembershipManifest {
    /// The effective stable declaration id: the pinned `id:` if present, else
    /// the table name. Used by helpers, audit, room bindings, and (future)
    /// durable references.
    pub fn effective_id<'a>(&'a self, table_name: &'a str) -> &'a str {
        self.id.as_deref().unwrap_or(table_name)
    }

    /// The closed write vocabulary: `roles ∪ pendingRoles`.
    pub fn vocabulary(&self) -> impl Iterator<Item = &str> {
        self.roles
            .iter()
            .map(String::as_str)
            .chain(self.pending_roles.iter().flatten().map(String::as_str))
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct FieldManifest {
    pub name: String,
    pub field_type: FieldType,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum FieldType {
    String,
    Boolean,
    Integer,
    Real,
    Json,
    /// `v.principal()` — nominal typing over the auth-principal id string space
    /// (the same space as `ctx.auth.userId`, including LLP 0055 agent
    /// principals). It stores and compares exactly like [`FieldType::String`];
    /// the distinct variant lets the schema surface *name* an axis as a
    /// principal reference. It is validated by **shape**, never by a
    /// foreign-key existence check, because memberships may outlive a
    /// principal's deactivation and LLP 0055 recovery preserves the id.
    ///
    /// @ref LLP 0056#declaring-a-membership-table — `v.principal()` is nominal
    ///   typing over the principal-id string space, not an existence check.
    Principal,
    /// `v.id("table")` — a nominal application-table id. The value remains a
    /// string on SQLite and the public wire, while the target table travels in
    /// the manifest so membership resource bindings and helper arguments can
    /// be checked rather than inferred from a bare string.
    ///
    /// @ref LLP 0056#rule-helpers — resource references must name the same
    ///   declared resource type; a plain string cannot prove that equality.
    Id {
        table: String,
    },
    /// Framework-owned relation-incarnation stamp. It is stored as a string,
    /// but unlike an application string it is never writable by application
    /// arguments. The paired required foreign-key field is the complete
    /// relationship declaration.
    ///
    /// @ref LLP 0110#protected-relation-incarnation-and-stamping — central
    ///   writers overwrite the stamp from the active parent registry.
    RelationIncarnation {
        #[serde(rename = "foreignKeyField", alias = "foreign_key_field")]
        foreign_key_field: String,
        #[serde(rename = "parentTable", alias = "parent_table")]
        parent_table: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct IndexManifest {
    pub name: String,
    pub fields: Vec<String>,
    /// A **true, total** unique index: SQLite/Postgres reject a second row
    /// whose declared columns duplicate an existing one. Load-bearing for
    /// LLP 0056 memberships, whose `(principal, resource)` uniqueness invariant
    /// the whole primitive rests on. Non-null key axes are what keep it total —
    /// a NULL-bearing column would admit multiple duplicate-looking rows.
    ///
    /// @ref LLP 0056#declaring-a-membership-table — the generated membership
    ///   index is true-unique; today's `IndexManifest` had no uniqueness flag.
    #[serde(default, skip_serializing_if = "is_false")]
    pub unique: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct FunctionManifest {
    #[serde(
        default = "function_manifest_kind",
        rename = "artifactKind",
        alias = "artifact_kind"
    )]
    pub artifact_kind: String,
    #[serde(
        default = "snapback_schema_version",
        rename = "schemaVersion",
        alias = "schema_version"
    )]
    pub schema_version: String,
    #[serde(default = "local_app_id", rename = "appId", alias = "app_id")]
    pub app_id: String,
    #[serde(default, rename = "bundleHash", alias = "bundle_hash")]
    pub bundle_hash: Option<String>,
    #[serde(default, rename = "inputsHash", alias = "inputs_hash")]
    pub inputs_hash: Option<String>,
    #[serde(default, rename = "generatedAt", alias = "generated_at")]
    pub generated_at: Option<u64>,
    #[serde(
        default,
        rename = "unsupportedDependencyDiagnostics",
        alias = "unsupported_dependency_diagnostics"
    )]
    pub unsupported_dependency_diagnostics: Vec<Diagnostic>,
    /// Experimental-capability acknowledgments for the generated artifact
    /// pair (LLP 0058 §Capability maturity, amendment 2026-07-24): the
    /// registry ids this artifact knowingly requires at experimental
    /// maturity. Emitted by codegen from the same closed capability table it
    /// derives requirements from; admission refuses an experimental
    /// requirement the artifact does not acknowledge. Acknowledging a stable
    /// id is a no-op, so promotion to stable never breaks the artifact, and
    /// an acknowledgment can never make an unsupported capability supported.
    #[serde(
        default,
        rename = "acknowledgedExperimentalCapabilities",
        alias = "acknowledged_experimental_capabilities",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub acknowledged_experimental_capabilities: Vec<String>,
    #[serde(default)]
    pub functions: Vec<FunctionDefinition>,
    #[serde(default, rename = "cronJobs", alias = "cron_jobs")]
    pub cron_jobs: Vec<CronJobDefinition>,
    /// @ref LLP 0036#declared-configuration-in-the-manifest — declared config
    /// entries ride the generated function manifest the way cron jobs do.
    #[serde(default)]
    pub config: Vec<ConfigEntryDefinition>,
    /// Transactionally maintained projections (LLP 0080 §5). Activation
    /// validates each plan against the schema and the whole active set (the
    /// per-source write-budget proof), and every source mutation maintains
    /// the output in its own commit.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub projections: Vec<MaintainedProjectionPlan>,
}

impl Default for FunctionManifest {
    fn default() -> Self {
        Self {
            artifact_kind: function_manifest_kind(),
            schema_version: snapback_schema_version(),
            app_id: local_app_id(),
            bundle_hash: None,
            inputs_hash: None,
            generated_at: None,
            unsupported_dependency_diagnostics: Vec::new(),
            acknowledged_experimental_capabilities: Vec::new(),
            functions: Vec::new(),
            cron_jobs: Vec::new(),
            config: Vec::new(),
            projections: Vec::new(),
        }
    }
}

impl FunctionManifest {
    /// The artifact's experimental acknowledgments parsed to registry ids
    /// (unknown strings are inert; see `parse_acknowledged_capabilities`).
    pub fn acknowledged_capability_ids(&self) -> BTreeSet<TargetCapabilityId> {
        CapabilityManifest::parse_acknowledged_capabilities(
            self.acknowledged_experimental_capabilities
                .iter()
                .map(String::as_str),
        )
    }

    pub fn function(&self, name: &str) -> Option<&FunctionDefinition> {
        self.functions
            .iter()
            .find(|function| function.name == name || function.id == name)
    }

    pub fn validate_artifact(&self) -> SnapbackResult<()> {
        validate_artifact_header(
            "function",
            "functionManifest",
            &self.artifact_kind,
            &self.schema_version,
            self.bundle_hash.as_deref(),
            self.inputs_hash.as_deref(),
        )?;
        self.validate_semantics()
    }

    fn validate_semantics(&self) -> SnapbackResult<()> {
        let mut identities = BTreeMap::<String, (usize, String)>::new();
        for (function_index, function) in self.functions.iter().enumerate() {
            if function.name.trim().is_empty() {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_IDENTITY_INVALID",
                    "runtime",
                    "function names must not be empty",
                ));
            }
            // @ref LLP 0012#v0-function-manifest — the stable function id is
            //   required (grants/consent key on it); a manifest that omits it
            //   fails load with a typed diagnostic before install.
            if function.id.trim().is_empty() {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_IDENTITY_INVALID",
                    "runtime",
                    format!(
                        "function {} is missing the required stable function id",
                        function.name
                    ),
                ));
            }
            let local_identities = [&function.name, &function.id]
                .into_iter()
                .collect::<BTreeSet<_>>();
            for identity in local_identities {
                if let Some((previous_index, previous)) = identities.get(identity)
                    && *previous_index != function_index
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_FUNCTION_IDENTITY_COLLISION",
                        "runtime",
                        format!(
                            "function identity {identity:?} is shared by {previous} and {}",
                            function.name
                        ),
                    ));
                }
                identities.insert(identity.clone(), (function_index, function.name.clone()));
            }

            match (&function.kind, &function.runtime) {
                (
                    FunctionKind::Query | FunctionKind::LiveQuery,
                    FunctionRuntime::HostPlan(HandlerPlan::Query(plan)),
                ) => validate_query_plan_shape(plan)?,
                (
                    FunctionKind::Query | FunctionKind::LiveQuery,
                    FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)),
                ) => validate_relational_query_plan_shape(plan)?,
                (
                    FunctionKind::Query,
                    FunctionRuntime::HostPlan(HandlerPlan::SearchQuery(plan)),
                ) => validate_search_query_plan_shape(plan)?,
                (
                    FunctionKind::Query | FunctionKind::LiveQuery,
                    FunctionRuntime::HostPlan(HandlerPlan::JobStatusQuery(_)),
                ) => {}
                (
                    FunctionKind::LiveQuery,
                    FunctionRuntime::HostPlan(HandlerPlan::BoundedChildrenQuery(plan)),
                ) => validate_bounded_children_plan_shape(plan)?,
                (
                    FunctionKind::Mutation,
                    FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan)),
                ) => crate::value_expr::validate_mutation_plan(plan)?,
                (
                    FunctionKind::Mutation,
                    FunctionRuntime::HostPlan(HandlerPlan::WriteWithActivity(plan)),
                ) => {
                    validate_write_with_activity_plan_shape(plan)?;
                    crate::value_expr::validate_mutation_plan(&plan.mutation)?;
                }
                (FunctionKind::Action, FunctionRuntime::HostPlan(HandlerPlan::Action(plan))) => {
                    crate::value_expr::validate_action_plan(plan)?
                }
                (_, FunctionRuntime::IbexModule(_)) => {}
                _ => {
                    return Err(SnapbackError::error(
                        "SNAPBACK_FUNCTION_KIND_RUNTIME_MISMATCH",
                        "runtime",
                        format!(
                            "function {} kind {:?} does not match its host-plan runtime",
                            function.name, function.kind
                        ),
                    ));
                }
            }
            let implied_capabilities: &[&str] = match &function.runtime {
                FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(_)) => {
                    if function.kind == FunctionKind::LiveQuery {
                        &["relational_query_v1", "live_subscriptions"]
                    } else {
                        &["relational_query_v1"]
                    }
                }
                FunctionRuntime::HostPlan(HandlerPlan::SearchQuery(_)) => {
                    &[crate::search::types::SEARCH_CAPABILITY]
                }
                // The declared job-status query requires the experimental
                // jobs registry id (LLP 0070 is Draft, so the id can never be
                // stable while the claim boundary stands) plus live delivery
                // when declared live.
                FunctionRuntime::HostPlan(HandlerPlan::JobStatusQuery(_)) => {
                    if function.kind == FunctionKind::LiveQuery {
                        &["jobs_one_off_v1", "live_subscriptions"]
                    } else {
                        &["jobs_one_off_v1"]
                    }
                }
                FunctionRuntime::HostPlan(HandlerPlan::BoundedChildrenQuery(_)) => {
                    &["bounded_children_v1", "live_subscriptions"]
                }
                FunctionRuntime::HostPlan(HandlerPlan::WriteWithActivity(_)) => {
                    &["write_activity_v1"]
                }
                _ => &[],
            };
            for required in implied_capabilities {
                if !function
                    .required_capabilities
                    .iter()
                    .any(|capability| capability == *required)
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_CAPABILITY_UNSUPPORTED",
                        "capability",
                        format!(
                            "function {} uses a runtime profile without required capability {required}",
                            function.name
                        ),
                    ));
                }
            }

            validate_protected_query_profile(function)?;
            validate_authority_independent(function)?;
            validate_public_inline(function)?;
            validate_retainable_query(function)?;
            validate_effect_ceiling(function)?;
            validate_result_contract_definition(function)?;
            validate_args_contract_definition(function)?;

            if self.schema_version == SNAPBACK_SESSIONS_SCHEMA_VERSION {
                validate_known_v1_capabilities(
                    function.required_capabilities.iter().map(String::as_str),
                )?;
            }
        }

        if self.schema_version == SNAPBACK_SESSIONS_SCHEMA_VERSION {
            // v1 grammar symmetry (LLP 0058 §Capability maturity): a sessions
            // artifact's acknowledgments must spell known registry ids, the
            // same closed-vocabulary rule its requirements obey.
            validate_known_v1_capabilities(
                self.acknowledged_experimental_capabilities
                    .iter()
                    .map(String::as_str),
            )?;
        }

        let by_name = self
            .functions
            .iter()
            .map(|function| (function.name.as_str(), function))
            .collect::<BTreeMap<_, _>>();
        for function in &self.functions {
            if let FunctionRuntime::HostPlan(HandlerPlan::Action(plan)) = &function.runtime {
                for step in &plan.steps {
                    let ActionStep::RunMutation { name, .. } = step;
                    match self.function(name) {
                        Some(target) if target.kind == FunctionKind::Mutation => {}
                        _ => {
                            return Err(SnapbackError::error(
                                "SNAPBACK_ACTION_MUTATION_REFERENCE_INVALID",
                                "runtime",
                                format!(
                                    "action {} references missing or non-mutation function {name}",
                                    function.name
                                ),
                            ));
                        }
                    }
                }
            }
        }

        let mut config_names = BTreeSet::new();
        for entry in &self.config {
            if entry.name.is_empty()
                || !entry
                    .name
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
                || !config_names.insert(entry.name.clone())
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_CONFIG_ENTRY_INVALID",
                    "config",
                    format!("config entry {:?} is invalid or duplicated", entry.name),
                ));
            }
            if !entry.secret {
                return Err(SnapbackError::error(
                    "SNAPBACK_CONFIG_NON_SECRET_UNIMPLEMENTED",
                    "config",
                    format!(
                        "config entry {} declares secret: false, which is not implemented",
                        entry.name
                    ),
                ));
            }
            if entry.default.is_some() {
                return Err(SnapbackError::error(
                    "SNAPBACK_CONFIG_DEFAULT_UNIMPLEMENTED",
                    "config",
                    format!(
                        "config entry {} declares an unsupported default",
                        entry.name
                    ),
                ));
            }
            if let Some(probe) = &entry.probe {
                match self.function(probe) {
                    Some(target) if target.kind == FunctionKind::Action => {}
                    _ => {
                        return Err(SnapbackError::error(
                            "SNAPBACK_CONFIG_PROBE_INVALID",
                            "config",
                            format!(
                                "config entry {} references missing or non-action probe {probe}",
                                entry.name
                            ),
                        ));
                    }
                }
            }
        }
        for function in by_name.values() {
            for used in &function.uses {
                if !config_names.contains(used) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_CONFIG_USES_UNKNOWN",
                        "config",
                        format!(
                            "function {} declares unknown config entry {used}",
                            function.name
                        ),
                    ));
                }
            }
        }
        for job in &self.cron_jobs {
            if self.schema_version == SNAPBACK_SESSIONS_SCHEMA_VERSION {
                validate_known_v1_capabilities(
                    job.required_capabilities.iter().map(String::as_str),
                )?;
            }
            if let Some(target) = self.function(&job.action)
                && target.effective_auth_requirement() == AuthRequirement::Authenticated
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_CRON_AUTH_REQUIREMENT_INVALID",
                    "cron",
                    format!(
                        "cron job {} targets authenticated function {}; system authority has no user",
                        job.name, job.action
                    ),
                )
                .with_details(serde_json::json!({
                    "jobName": job.name,
                    "function": job.action,
                    "authRequirement": AuthRequirement::Authenticated.as_str(),
                })));
            }
        }
        Ok(())
    }
}

const RESULT_CONTRACT_MAX_DEPTH: usize = 16;
const RESULT_CONTRACT_MAX_FIELDS: usize = 128;
const RESULT_CONTRACT_MAX_UNION_VARIANTS: usize = 8;
const RESULT_CONTRACT_MAX_ARRAY_ITEMS: usize = 1_024;
const RESULT_CONTRACT_MAX_VALUE_BYTES: usize = 1024 * 1024;
const RESULT_CONTRACT_JS_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

fn invalid_result_contract(
    function: &FunctionDefinition,
    message: impl Into<String>,
) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID",
        "runtime",
        format!("function {} {}", function.name, message.into()),
    )
}

fn invalid_args_contract(
    function: &FunctionDefinition,
    message: impl Into<String>,
) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_FUNCTION_ARGS_CONTRACT_INVALID",
        "runtime",
        format!("function {} {}", function.name, message.into()),
    )
}

/// Hash witness for the extended argument-contract descriptor.
///
/// @ref LLP 0131#identity-and-hashing — the canonical form is hashed under
/// the new v2 domain prefix (the v1 descriptor dropped all bounds, so a
/// hash-stable extension would witness nothing this Spec makes contractual).
/// A `PlatformSchemaRef` node contributes its authority class and reference id, never artifact bytes.
pub(crate) fn args_contract_hash(contract: &FunctionArgsContract) -> SnapbackResult<String> {
    let value = serde_json::to_value(contract).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
            "runtime",
            "args contract cannot be represented as canonical JSON",
        )
    })?;
    let canonical = crate::rqs::jcs(&value).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
            "runtime",
            "args contract is outside the canonical JSON profile",
        )
    })?;
    let mut hash = Sha256::new();
    hash.update(b"snapback:function-args:v2\n");
    hash.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", hash.finalize()))
}

pub(crate) fn result_contract_hash(contract: &FunctionResultContract) -> SnapbackResult<String> {
    let value = serde_json::to_value(contract).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
            "runtime",
            "result contract cannot be represented as canonical JSON",
        )
    })?;
    let canonical = crate::rqs::jcs(&value).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
            "runtime",
            "result contract is outside the canonical JSON profile",
        )
    })?;
    let mut hash = Sha256::new();
    hash.update(b"snapback:function-result:v1\n");
    hash.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", hash.finalize()))
}

#[derive(Clone, Copy, Eq, Ord, PartialEq, PartialOrd)]
enum ResultPrimitiveKind {
    Null,
    Boolean,
    String,
    Number,
    Array,
    Object,
    AnyJson,
}

fn result_primitive_kind(contract: &ResultValueContract) -> ResultPrimitiveKind {
    match contract {
        ResultValueContract::Null => ResultPrimitiveKind::Null,
        ResultValueContract::Boolean => ResultPrimitiveKind::Boolean,
        ResultValueContract::String { .. }
        | ResultValueContract::Principal
        | ResultValueContract::Id { .. } => ResultPrimitiveKind::String,
        ResultValueContract::Integer { .. } | ResultValueContract::FiniteReal { .. } => {
            ResultPrimitiveKind::Number
        }
        ResultValueContract::Literal { value } => match value {
            Value::Null => ResultPrimitiveKind::Null,
            Value::Bool(_) => ResultPrimitiveKind::Boolean,
            Value::String(_) => ResultPrimitiveKind::String,
            Value::Number(_) => ResultPrimitiveKind::Number,
            Value::Array(_) => ResultPrimitiveKind::Array,
            Value::Object(_) => ResultPrimitiveKind::Object,
        },
        ResultValueContract::Json { .. }
        | ResultValueContract::Union { .. }
        | ResultValueContract::PlatformSchemaRef { .. } => ResultPrimitiveKind::AnyJson,
        ResultValueContract::Array { .. } => ResultPrimitiveKind::Array,
        ResultValueContract::Object { .. } => ResultPrimitiveKind::Object,
    }
}

fn union_has_object_discriminator(variants: &[ResultValueContract]) -> bool {
    let objects = variants
        .iter()
        .map(|variant| match variant {
            ResultValueContract::Object {
                fields,
                allow_extra: false,
            } => Some(fields),
            _ => None,
        })
        .collect::<Option<Vec<_>>>();
    let Some(objects) = objects else {
        return false;
    };
    let Some(first) = objects.first() else {
        return false;
    };
    first.iter().any(|candidate| {
        if !candidate.required {
            return false;
        }
        let ResultValueContract::Literal { value: first_value } = &candidate.value else {
            return false;
        };
        if !matches!(
            first_value,
            Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_)
        ) {
            return false;
        }
        let mut values = BTreeSet::new();
        for fields in &objects {
            let Some(field) = fields
                .iter()
                .find(|field| field.required && field.name == candidate.name)
            else {
                return false;
            };
            let ResultValueContract::Literal { value } = &field.value else {
                return false;
            };
            let Ok(canonical) = crate::rqs::jcs(value) else {
                return false;
            };
            if !values.insert(canonical) {
                return false;
            }
        }
        true
    })
}

fn union_has_disjoint_primitive_variants(variants: &[ResultValueContract]) -> bool {
    let mut groups = BTreeMap::<ResultPrimitiveKind, Vec<&ResultValueContract>>::new();
    for variant in variants {
        let kind = result_primitive_kind(variant);
        if kind == ResultPrimitiveKind::AnyJson {
            return false;
        }
        groups.entry(kind).or_default().push(variant);
    }
    groups.values().all(|group| {
        if group.len() == 1 {
            return true;
        }
        let mut literals = BTreeSet::new();
        group.iter().all(|variant| {
            let ResultValueContract::Literal { value } = variant else {
                return false;
            };
            crate::rqs::jcs(value)
                .ok()
                .is_some_and(|value| literals.insert(value))
        })
    })
}

fn validate_result_value_contract(
    function: &FunctionDefinition,
    contract: &ResultValueContract,
    depth: usize,
    object_fields: &mut usize,
) -> SnapbackResult<()> {
    validate_value_contract_node(function, contract, depth, object_fields, ContractLane::Result)
}

/// Which contract root a value node sits under. One node vocabulary, two
/// roots (LLP 0131): argument contracts additionally admit registry-checked
/// `PlatformSchemaRef` nodes; result contracts keep the LLP 0108 set.
#[derive(Clone, Copy, Eq, PartialEq)]
enum ContractLane {
    Result,
    Args,
}

fn validate_value_contract_node(
    function: &FunctionDefinition,
    contract: &ResultValueContract,
    depth: usize,
    object_fields: &mut usize,
    lane: ContractLane,
) -> SnapbackResult<()> {
    if depth > RESULT_CONTRACT_MAX_DEPTH {
        return Err(invalid_result_contract(
            function,
            "result contract exceeds the depth-16 profile",
        ));
    }
    match contract {
        ResultValueContract::String { max_bytes } => {
            if *max_bytes > RESULT_CONTRACT_MAX_VALUE_BYTES {
                return Err(invalid_result_contract(
                    function,
                    "result string bound exceeds 1 MiB",
                ));
            }
        }
        ResultValueContract::Integer { min, max } => {
            if min > max
                || *min < -RESULT_CONTRACT_JS_SAFE_INTEGER
                || *max > RESULT_CONTRACT_JS_SAFE_INTEGER
            {
                return Err(invalid_result_contract(
                    function,
                    "result integer bounds are invalid or outside JavaScript-safe integers",
                ));
            }
        }
        ResultValueContract::FiniteReal { min, max } => {
            if !min.is_finite() || !max.is_finite() || min > max {
                return Err(invalid_result_contract(
                    function,
                    "result finite-real bounds are invalid",
                ));
            }
        }
        ResultValueContract::Id { table } if table.is_empty() => {
            return Err(invalid_result_contract(
                function,
                "result id names an empty table",
            ));
        }
        ResultValueContract::Literal { value } => {
            if !matches!(
                value,
                Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_)
            ) || crate::rqs::jcs(value).is_err()
            {
                return Err(invalid_result_contract(
                    function,
                    "result literal is not a canonical JSON scalar",
                ));
            }
        }
        ResultValueContract::Json {
            max_depth,
            max_bytes,
        } => {
            if *max_depth > RESULT_CONTRACT_MAX_DEPTH
                || *max_bytes > RESULT_CONTRACT_MAX_VALUE_BYTES
            {
                return Err(invalid_result_contract(
                    function,
                    "result JSON bound exceeds the depth-16/1-MiB profile",
                ));
            }
        }
        ResultValueContract::Array { element, max_items } => {
            if *max_items > RESULT_CONTRACT_MAX_ARRAY_ITEMS {
                return Err(invalid_result_contract(
                    function,
                    "result array bound exceeds 1,024 items",
                ));
            }
            validate_value_contract_node(function, element, depth + 1, object_fields, lane)?;
        }
        ResultValueContract::Union { variants } => {
            if !(2..=RESULT_CONTRACT_MAX_UNION_VARIANTS).contains(&variants.len()) {
                return Err(invalid_result_contract(
                    function,
                    "result union must contain 2–8 variants",
                ));
            }
            let primitive_disjoint = union_has_disjoint_primitive_variants(variants);
            if !primitive_disjoint && !union_has_object_discriminator(variants) {
                return Err(invalid_result_contract(
                    function,
                    "result union variants are not syntactically disjoint",
                ));
            }
            for variant in variants {
                validate_value_contract_node(function, variant, depth + 1, object_fields, lane)?;
            }
        }
        ResultValueContract::Object {
            fields,
            allow_extra,
        } => {
            // @ref LLP 0131#the-argument-contract-descriptor — `allowExtra`
            // is carried for node-type reuse and must be false at every
            // argument position; argument objects are closed.
            if lane == ContractLane::Args && *allow_extra {
                return Err(invalid_args_contract(
                    function,
                    "argument objects must be closed (allowExtra: false)",
                ));
            }
            *object_fields = object_fields.saturating_add(fields.len());
            if *object_fields > RESULT_CONTRACT_MAX_FIELDS {
                return Err(invalid_result_contract(
                    function,
                    "result contract exceeds 128 object fields",
                ));
            }
            let mut names = BTreeSet::new();
            for field in fields {
                if field.name.is_empty() || !names.insert(field.name.as_str()) {
                    return Err(invalid_result_contract(
                        function,
                        "result object field names must be non-empty and unique",
                    ));
                }
                validate_value_contract_node(
                    function,
                    &field.value,
                    depth + 1,
                    object_fields,
                    lane,
                )?;
            }
        }
        // @ref LLP 0131#one-argument-grammar — PlatformSchemaRef is an argument-lane
        // node in v1; result contracts keep the LLP 0108 vocabulary. The
        // reference id must name an entry in the closed platform registry.
        ResultValueContract::PlatformSchemaRef { schema, .. } => {
            if lane == ContractLane::Result {
                return Err(invalid_result_contract(
                    function,
                    "result contracts do not admit platformSchemaRef nodes",
                ));
            }
            if !schema_ref_registry_v1().contains(&schema.as_str()) {
                // @ref LLP 0131#diagnostics — a manifest naming an id the
                // host does not carry refuses under the load-time identity
                // code, beside recomputation mismatch and unknown node kind.
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
                    "runtime",
                    format!(
                        "function {} references unregistered platform schema {schema}",
                        function.name
                    ),
                ));
            }
        }
        ResultValueContract::Null
        | ResultValueContract::Boolean
        | ResultValueContract::Principal
        | ResultValueContract::Id { .. } => {}
    }
    Ok(())
}

/// Load-time integrity of the argument-contract descriptor (LLP 0131): node
/// bounds under the shared profile, hash pairing under the v2 domain, and the
/// fail-closed capability requirement for structured/reference declarations.
fn validate_args_contract_definition(function: &FunctionDefinition) -> SnapbackResult<()> {
    let Some(contract) = &function.args_contract else {
        // Legacy manifests (v1 args hash, no descriptor) keep loading; the
        // runtime ingress seam validates only descriptor-carrying functions.
        return Ok(());
    };
    let mut object_fields = 0;
    let mut names = BTreeSet::new();
    for field in &contract.fields {
        if field.name.is_empty() || !names.insert(field.name.as_str()) {
            return Err(invalid_args_contract(
                function,
                "argument names must be non-empty and unique",
            ));
        }
        validate_value_contract_node(
            function,
            &field.value,
            0,
            &mut object_fields,
            ContractLane::Args,
        )?;
    }
    match function.args_contract_hash.as_deref() {
        None => {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
                "runtime",
                format!(
                    "function {} must pair its argument contract and argsContractHash",
                    function.name
                ),
            ));
        }
        Some(actual) => {
            let expected = args_contract_hash(contract)?;
            if actual != expected {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
                    "runtime",
                    format!(
                        "function {} argsContractHash does not authenticate its argument contract",
                        function.name
                    ),
                ));
            }
        }
    }
    // @ref LLP 0131#runtime-ingress-validation — the capability posture is
    // app-wide: every function carrying the v2 descriptor requires
    // `args_contract_v1`, scalar-only and empty argument roots included,
    // the same fail-closed pattern result_contract_v1 uses.
    if !function
        .required_capabilities
        .iter()
        .any(|capability| capability == "args_contract_v1")
    {
        return Err(SnapbackError::error(
            "SNAPBACK_CAPABILITY_UNSUPPORTED",
            "capability",
            format!(
                "function {} carries an argument contract without args_contract_v1",
                function.name
            ),
        ));
    }
    Ok(())
}

fn validate_result_contract_definition(function: &FunctionDefinition) -> SnapbackResult<()> {
    let compatible = matches!(
        (&function.kind, &function.result_contract),
        (_, FunctionResultContract::Unknown)
            | (
                FunctionKind::Query | FunctionKind::LiveQuery,
                FunctionResultContract::Documents { .. }
                    | FunctionResultContract::Records { .. }
                    | FunctionResultContract::LegacyQueryRowsV0 { .. },
            )
            | (
                FunctionKind::Mutation | FunctionKind::Action,
                FunctionResultContract::Document { .. } | FunctionResultContract::Value { .. },
            )
    );
    if !compatible {
        return Err(SnapbackError::error(
            "SNAPBACK_RESULT_CONTRACT_KIND_MISMATCH",
            "runtime",
            format!(
                "function {} result contract does not match kind {:?}",
                function.name, function.kind
            ),
        ));
    }
    let value_contract = match &function.result_contract {
        FunctionResultContract::Unknown => None,
        FunctionResultContract::Documents { table, document }
        | FunctionResultContract::Document { table, document } => {
            if table.is_empty() {
                return Err(invalid_result_contract(
                    function,
                    "result contract names an empty table",
                ));
            }
            Some(document)
        }
        FunctionResultContract::Records { record, rows } => {
            let closed_object = matches!(
                record,
                ResultValueContract::Object {
                    allow_extra: false,
                    ..
                }
            );
            let sealed_object_union = matches!(
                record,
                ResultValueContract::Union { variants }
                    if variants.iter().all(|variant| matches!(
                        variant,
                        ResultValueContract::Object { allow_extra: false, .. }
                    ))
            );
            if !closed_object && !sealed_object_union {
                return Err(invalid_result_contract(
                    function,
                    "records result must carry a closed object or discriminated closed-object union contract",
                ));
            }
            if rows.as_ref().is_some_and(|bound| {
                bound.min_items > bound.max_items
                    || bound.max_items > RESULT_CONTRACT_MAX_ARRAY_ITEMS
            }) {
                return Err(invalid_result_contract(
                    function,
                    "records row bounds require 0 <= minItems <= maxItems <= 1,024",
                ));
            }
            Some(record)
        }
        FunctionResultContract::Value { value } => Some(value),
        FunctionResultContract::LegacyQueryRowsV0 { row } => Some(row),
    };
    if let Some(contract) = value_contract {
        let mut object_fields = 0;
        validate_result_value_contract(function, contract, 0, &mut object_fields)?;
    }
    if let Some(form) = function.handler_form.as_deref() {
        let form_matches = matches!(
            (form, &function.runtime),
            ("inline" | "module", FunctionRuntime::IbexModule(_))
                | ("plan", FunctionRuntime::HostPlan(_))
        );
        if !form_matches {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_HANDLER_FORM_INVALID",
                "runtime",
                format!("function {} has an invalid handler form", function.name),
            ));
        }
        if form == "inline"
            && !function
                .required_capabilities
                .iter()
                .any(|capability| capability == "inline_handler_v1")
        {
            return Err(SnapbackError::error(
                "SNAPBACK_CAPABILITY_UNSUPPORTED",
                "capability",
                format!(
                    "function {} uses an inline handler without inline_handler_v1",
                    function.name
                ),
            ));
        }
    }
    for hash in [
        function.implementation_hash.as_deref(),
        function.args_contract_hash.as_deref(),
        function.result_contract_hash.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        let digest = hash.strip_prefix("sha256:").unwrap_or_default();
        if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
                "runtime",
                format!(
                    "function {} carries an invalid contract hash",
                    function.name
                ),
            ));
        }
    }
    match (
        &function.result_contract,
        function.result_contract_hash.as_deref(),
    ) {
        (FunctionResultContract::Unknown, None) => {}
        (_, None) => {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
                "runtime",
                format!(
                    "function {} must pair its concrete result contract and resultContractHash",
                    function.name
                ),
            ));
        }
        (contract, Some(actual)) => {
            let expected = result_contract_hash(contract)?;
            if actual != expected {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
                    "runtime",
                    format!(
                        "function {} resultContractHash does not authenticate its effective contract",
                        function.name
                    ),
                ));
            }
        }
    }
    if function.result_contract_hash.is_some()
        && !function
            .required_capabilities
            .iter()
            .any(|capability| capability == "result_contract_v1")
    {
        return Err(SnapbackError::error(
            "SNAPBACK_CAPABILITY_UNSUPPORTED",
            "capability",
            format!(
                "function {} carries a result contract without result_contract_v1",
                function.name
            ),
        ));
    }
    Ok(())
}

fn unsupported_capability_error(capability: &str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_CAPABILITY_UNSUPPORTED",
        "capability",
        message.into(),
    )
    .with_details(serde_json::json!({ "capability": capability }))
}

fn validate_known_v1_capabilities<'a>(
    required: impl IntoIterator<Item = &'a str>,
) -> SnapbackResult<()> {
    for capability in required {
        capability.parse::<TargetCapabilityId>().map_err(|()| {
            unsupported_capability_error(
                capability,
                format!("unknown required target capability {capability}"),
            )
        })?;
    }
    Ok(())
}

fn validate_authority_independent(function: &FunctionDefinition) -> SnapbackResult<()> {
    if !function.authority_independent {
        return Ok(());
    }

    let eligible_kind = matches!(function.kind, FunctionKind::Query | FunctionKind::LiveQuery);
    let eligible_requirement = function.effective_auth_requirement() == AuthRequirement::Public;
    let eligible_declarations = function.uses.is_empty()
        && function.read_set_summary.auth_scope_field.is_none()
        && function.authorization_dependence.is_empty();
    let eligible_runtime = match &function.runtime {
        FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) => !plan
            .filters
            .iter()
            .any(|filter| value_expr_uses_authority_or_ambient_input(&filter.value)),
        FunctionRuntime::HostPlan(_) | FunctionRuntime::IbexModule(_) => false,
    };

    if eligible_kind && eligible_requirement && eligible_declarations && eligible_runtime {
        return Ok(());
    }

    Err(SnapbackError::error(
        "SNAPBACK_AUTHORITY_INDEPENDENT_INVALID",
        "auth",
        format!(
            "function {} does not satisfy the authority-independent HostPlan profile",
            function.name
        ),
    )
    .with_details(serde_json::json!({
        "function": function.name,
        "kind": &function.kind,
        "authRequirement": function.effective_auth_requirement().as_str(),
        "hostPlanQuery": matches!(&function.runtime, FunctionRuntime::HostPlan(HandlerPlan::Query(_))),
        "usesConfig": !function.uses.is_empty(),
        "authScopeField": function.read_set_summary.auth_scope_field.as_deref(),
        "authorizationDependence": &function.authorization_dependence,
    })))
}

/// LLP 0092 §0C.3: `publicInline` is a disclosure permission accepted only on
/// a query that also carries a *valid* `authorityIndependent: true`
/// declaration (which entails `public` under the existing invariant —
/// [`validate_authority_independent`] runs first, so reaching this check with
/// `authority_independent` set means the declaration validated). v1 keeps the
/// narrower rule fail-closed: no consumer exists for a
/// public-but-authority-dependent inline query.
fn validate_public_inline(function: &FunctionDefinition) -> SnapbackResult<()> {
    if !function.public_inline || function.authority_independent {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_PUBLIC_INLINE_INVALID",
        "auth",
        format!(
            "function {} declares publicInline without a valid authorityIndependent declaration",
            function.name
        ),
    )
    .with_details(serde_json::json!({
        "function": function.name,
        "authRequirement": function.effective_auth_requirement().as_str(),
    })))
}

/// The derived, never-authored `rqsEligible` served-manifest predicate
/// (LLP 0090 Authorization scope; LLP 0092 §0C.2): declared
/// `authorityIndependent` (entailing `public`) AND the LLP 0053
/// closed-inputs/retainable proof — HostPlan query runtime, no ambient or
/// membership dependency, and a complete `singleTable` read summary whose
/// table set equals the plan's. Evaluated non-erroringly: a query failing the
/// proof is simply not eligible, never a load error. Returns the digest kind
/// the eligible query's `contentDigest` takes (LLP 0091 §0A.4's selector:
/// DK-3-analyzable unordered → `mset1`; ordered/limited replace-only →
/// `seq1`).
///
/// Everything keyed on the predicate — token minting, bundle `resume`
/// presence, Channel B persistence, D1.1 admission — reads this one derived
/// fact; there is no authored `rqsEligible` field anywhere (an authored field
/// of that name refuses at load via `deny_unknown_fields`).
pub fn rqs_eligible_digest_kind(function: &FunctionDefinition) -> Option<crate::rqs::DigestKind> {
    if !function.authority_independent {
        return None;
    }
    if function.kind != FunctionKind::LiveQuery {
        return None;
    }
    if function.effective_auth_requirement() != AuthRequirement::Public {
        return None;
    }
    if !function.uses.is_empty()
        || function.read_set_summary.auth_scope_field.is_some()
        || !function.authorization_dependence.is_empty()
    {
        return None;
    }
    let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &function.runtime else {
        return None;
    };
    if plan
        .filters
        .iter()
        .any(|filter| value_expr_uses_authority_or_ambient_input(&filter.value))
    {
        return None;
    }
    if !plan.membership_filters.is_empty() {
        return None;
    }
    // Closed-inputs proof (the `validate_retainable_query` obligations for the
    // retainable class, reused as a measurement): a complete `singleTable`
    // read summary whose table set equals the plan's.
    let summary = &function.read_set_summary;
    let summary_complete = summary.mode.as_deref() == Some("singleTable")
        && summary.primary_table.as_deref() == Some(plan.table.as_str())
        && summary.tables.len() == 1
        && summary.tables.first() == Some(&plan.table);
    if !summary_complete {
        return None;
    }
    Some(if plan.order.is_empty() && plan.limit.is_none() {
        crate::rqs::DigestKind::Mset1
    } else {
        crate::rqs::DigestKind::Seq1
    })
}

pub(crate) fn value_expr_uses_authority_or_ambient_input(value: &ValueExpr) -> bool {
    match value {
        ValueExpr::AuthUserId
        | ValueExpr::AuthKind
        | ValueExpr::AuthActorKind
        | ValueExpr::AuthActivityActorKind
        | ValueExpr::AuthActorUserId
        | ValueExpr::AuthGrantId
        | ValueExpr::ClientMutationDigest
        | ValueExpr::AuthIsDelegated
        | ValueExpr::RuntimeId
        | ValueExpr::RuntimeNow => true,
        ValueExpr::Arg(_) | ValueExpr::Args | ValueExpr::Binding(_) | ValueExpr::Literal(_) => {
            false
        }
        ValueExpr::Field { base, .. } => value_expr_uses_authority_or_ambient_input(base),
        ValueExpr::Binary { left, right, .. } => {
            value_expr_uses_authority_or_ambient_input(left)
                || value_expr_uses_authority_or_ambient_input(right)
        }
        ValueExpr::Unary { expr, .. } => value_expr_uses_authority_or_ambient_input(expr),
        ValueExpr::If { cond, then, r#else } => {
            value_expr_uses_authority_or_ambient_input(cond)
                || value_expr_uses_authority_or_ambient_input(then)
                || value_expr_uses_authority_or_ambient_input(r#else)
        }
        ValueExpr::Concat(values) | ValueExpr::Call { args: values, .. } => values
            .iter()
            .any(value_expr_uses_authority_or_ambient_input),
        ValueExpr::Record { fields } => fields
            .values()
            .any(value_expr_uses_authority_or_ambient_input),
        // A membership semi-join always reads the effective principal (the
        // implicit `auth.userId` axis of the lookup), so it depends on
        // authority by construction.
        ValueExpr::MembershipExists(_) => true,
    }
}

/// Closed caller-authority dimensions that a query result may depend on.
/// Retention v1 accepts `userId` plus the effective principal `kind`, which is
/// an immutable function of that identity; spelling the rejected dimensions
/// is still important because a manifest must describe why it is online-only
/// rather than silently erasing actor/session/provider/opaque dependence.
///
/// @ref LLP 0053#retained-and-offline-authorization — retained rows survive a
///   same-user session replacement, so every other authority dimension is
///   deliberately ineligible.
#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum AuthorizationInputDimension {
    UserId,
    Kind,
    ActorKind,
    IsDelegated,
    SessionId,
    Provider,
    Roles,
    IsAuthenticated,
    Opaque,
}

fn protected_input_error(function: &FunctionDefinition, input_kind: &str) -> SnapbackError {
    let code = if input_kind == "RuntimeNow" {
        "SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY"
    } else {
        "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED"
    };
    SnapbackError::error(
        code,
        "auth",
        format!(
            "protected query {} depends on denied mutable input {input_kind}",
            function.name
        ),
    )
    .with_details(serde_json::json!({
        "function": function.name,
        "inputKind": input_kind,
    }))
}

fn validate_protected_value_expr(
    function: &FunctionDefinition,
    value: &ValueExpr,
) -> SnapbackResult<()> {
    match value {
        ValueExpr::RuntimeNow => Err(protected_input_error(function, "RuntimeNow")),
        ValueExpr::RuntimeId => Err(protected_input_error(function, "RuntimeId")),
        ValueExpr::ClientMutationDigest => {
            Err(protected_input_error(function, "ClientMutationDigest"))
        }
        ValueExpr::Arg(_)
        | ValueExpr::Args
        | ValueExpr::AuthUserId
        | ValueExpr::AuthKind
        | ValueExpr::AuthActorKind
        | ValueExpr::AuthActivityActorKind
        | ValueExpr::AuthActorUserId
        | ValueExpr::AuthGrantId
        | ValueExpr::AuthIsDelegated
        | ValueExpr::Binding(_)
        | ValueExpr::Literal(_) => Ok(()),
        ValueExpr::Field { base, .. } => validate_protected_value_expr(function, base),
        ValueExpr::Binary { left, right, .. } => {
            validate_protected_value_expr(function, left)?;
            validate_protected_value_expr(function, right)
        }
        ValueExpr::Unary { expr, .. } => validate_protected_value_expr(function, expr),
        ValueExpr::If { cond, then, r#else } => {
            validate_protected_value_expr(function, cond)?;
            validate_protected_value_expr(function, then)?;
            validate_protected_value_expr(function, r#else)
        }
        ValueExpr::Concat(values) | ValueExpr::Call { args: values, .. } => {
            for value in values {
                validate_protected_value_expr(function, value)?;
            }
            Ok(())
        }
        ValueExpr::Record { fields } => {
            for value in fields.values() {
                validate_protected_value_expr(function, value)?;
            }
            Ok(())
        }
        // Admitted by the ENG-24906 amendment to LLP 0053's protected-query
        // input profile: a membership semi-join is a snapshot-bound,
        // `DatabaseCaptured` declarative expression kind. It carries no clock,
        // id, or other `MutableNonDatabase` input — its resource reference is a
        // row field or a query argument, both snapshot-bound — so it is
        // admitted rather than refused as an unknown expression kind.
        //
        // @ref LLP 0053#agent-auth-protected-query-inputs-amended-2026-07-14-eng-24906
        //   — the membership predicate node is an admitted declarative input.
        ValueExpr::MembershipExists(_) => Ok(()),
    }
}

fn validate_protected_query_profile(function: &FunctionDefinition) -> SnapbackResult<()> {
    if !function.is_protected_query() {
        return Ok(());
    }
    if let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &function.runtime {
        for filter in &plan.filters {
            validate_protected_value_expr(function, &filter.value)?;
        }
        // Membership predicates are the admitted DatabaseCaptured kind; they
        // carry no mutable non-database input to reject, but validate the
        // recursion for symmetry (a resource-ref cannot smuggle a clock).
        for predicate in &plan.membership_filters {
            let _ = predicate;
        }
    }
    Ok(())
}

/// Observed effects of a closed HostPlan, in exactly the vocabulary of
/// codegen's `EffectCeilingV1` walker (`packages/snapback-codegen/
/// effect-ceiling.mjs`). The two must stay mirror images: deriving *more*
/// here would falsely refuse legitimately generated artifacts, deriving
/// *less* would let a doctored artifact under-declare.
#[derive(Debug, Default)]
struct ObservedEffects {
    reads: BTreeSet<(String, String, Option<String>)>,
    writes: BTreeSet<(String, String)>,
    host_operations: BTreeSet<&'static str>,
    authorization_inputs: BTreeSet<&'static str>,
}

impl ObservedEffects {
    fn read(&mut self, table: &str, access: &str, index: Option<&str>) {
        self.reads.insert((
            table.to_owned(),
            access.to_owned(),
            index.map(str::to_owned),
        ));
    }

    fn write(&mut self, table: &str, operation: &str) {
        self.writes.insert((table.to_owned(), operation.to_owned()));
    }

    fn expr(&mut self, expr: &ValueExpr) {
        match expr {
            ValueExpr::AuthUserId => {
                self.authorization_inputs.insert("authUserId");
            }
            ValueExpr::AuthKind => {
                self.authorization_inputs.insert("authKind");
            }
            ValueExpr::AuthActorKind => {
                self.authorization_inputs.insert("authActorKind");
            }
            ValueExpr::AuthActivityActorKind => {
                self.authorization_inputs.insert("activityActorKind");
            }
            ValueExpr::AuthActorUserId => {
                self.authorization_inputs.insert("actualActor");
            }
            ValueExpr::AuthGrantId => {
                self.authorization_inputs.insert("grantId");
            }
            ValueExpr::ClientMutationDigest => {
                self.host_operations.insert("clientMutationDigest");
            }
            ValueExpr::AuthIsDelegated => {
                self.authorization_inputs.insert("authIsDelegated");
            }
            ValueExpr::RuntimeId => {
                self.host_operations.insert("runtimeId");
            }
            ValueExpr::RuntimeNow => {
                self.host_operations.insert("runtimeNow");
            }
            ValueExpr::MembershipExists(_) => {
                self.authorization_inputs.insert("membershipPredicate");
            }
            ValueExpr::Arg(_) | ValueExpr::Args | ValueExpr::Binding(_) | ValueExpr::Literal(_) => {
            }
            ValueExpr::Field { base, .. } => self.expr(base),
            ValueExpr::Binary { left, right, .. } => {
                self.expr(left);
                self.expr(right);
            }
            ValueExpr::Unary { expr, .. } => self.expr(expr),
            ValueExpr::If { cond, then, r#else } => {
                self.expr(cond);
                self.expr(then);
                self.expr(r#else);
            }
            ValueExpr::Concat(parts) => parts.iter().for_each(|part| self.expr(part)),
            ValueExpr::Call { args, .. } => args.iter().for_each(|arg| self.expr(arg)),
            ValueExpr::Record { fields } => fields.values().for_each(|value| self.expr(value)),
        }
    }

    fn filters(&mut self, filters: &[FilterExpr]) {
        for filter in filters {
            self.expr(&filter.value);
        }
    }

    fn handler_plan(&mut self, plan: &HandlerPlan) {
        match plan {
            HandlerPlan::Query(plan) => {
                self.read(&plan.table, "query", plan.indexed_by.as_deref());
                self.filters(&plan.filters);
                if !plan.membership_filters.is_empty() {
                    self.authorization_inputs.insert("membershipPredicate");
                }
            }
            HandlerPlan::SearchQuery(plan) => {
                self.read(&plan.table, "search", Some(&plan.index));
            }
            HandlerPlan::JobStatusQuery(_) => {
                // A point read of the reserved job-status projection — not an
                // application schema table.
                self.read(crate::jobs::JOBS_STATUS_TABLE, "point", None);
            }
            HandlerPlan::RelationalQuery(plan) => {
                self.read(&plan.root, "query", Some(&plan.root_index));
                self.read(&plan.joined, "query", Some(&plan.joined_index));
                self.filters(&plan.root_filters);
                self.filters(&plan.root_visibility);
                self.filters(&plan.joined_visibility);
            }
            HandlerPlan::BoundedChildrenQuery(plan) => {
                self.read(&plan.parent_table, "point", None);
                self.read(&plan.child_table, "query", Some(&plan.child_index));
                self.authorization_inputs.insert("parentVisibility");
            }
            HandlerPlan::Mutation(plan) => {
                for step in &plan.steps {
                    match step {
                        MutationStep::Insert { table, values, .. } => {
                            self.write(table, "insert");
                            values.values().for_each(|value| self.expr(value));
                        }
                        MutationStep::Patch { table, id, values } => {
                            self.write(table, "patch");
                            self.read(table, "point", None);
                            self.expr(id);
                            values.values().for_each(|value| self.expr(value));
                        }
                        MutationStep::Delete { table, id } => {
                            self.write(table, "delete");
                            self.read(table, "point", None);
                            self.expr(id);
                        }
                        MutationStep::Get { table, id, .. } => {
                            self.read(table, "point", None);
                            self.expr(id);
                        }
                        MutationStep::AssertCurrentRelation {
                            table,
                            id,
                            scope_table,
                            scope_id,
                            ..
                        } => {
                            self.read(table, "point", None);
                            self.read(scope_table, "relationIncarnation", None);
                            self.expr(id);
                            self.expr(scope_id);
                        }
                        MutationStep::Guard { cond, .. } => self.expr(cond),
                        MutationStep::Let { expr, .. } => self.expr(expr),
                        MutationStep::AssertSourceChanged { table, id, .. } => {
                            self.read(table, "sourceEffect", None);
                            self.expr(id);
                        }
                        MutationStep::DeleteWhere { table, filter } => {
                            self.write(table, "deleteWhere");
                            self.read(table, "query", None);
                            self.filters(filter);
                        }
                        MutationStep::InsertEach {
                            table,
                            source,
                            values,
                            ..
                        } => {
                            self.write(table, "insertEach");
                            self.expr(source);
                            values.values().for_each(|value| self.expr(value));
                        }
                    }
                }
            }
            HandlerPlan::WriteWithActivity(plan) => {
                self.read(&plan.scope_table, "point", None);
                self.handler_plan(&HandlerPlan::Mutation(plan.mutation.clone()));
                self.authorization_inputs.insert("resolvedAppAuthority");
                self.host_operations.insert("clientMutationSettlement");
            }
            HandlerPlan::Action(plan) => {
                for step in &plan.steps {
                    let ActionStep::RunMutation { args, .. } = step;
                    args.values().for_each(|value| self.expr(value));
                    self.host_operations.insert("runMutation");
                }
            }
        }
    }
}

/// LLP 0065 §1: the runtime checks observed operations are a subset of the
/// admitted `EffectCeilingV1` and fails closed on mismatch. For a closed
/// HostPlan the plan *is* the totality of what executes, so the load-time
/// subset check over the typed IR is exactly the observed-operations check —
/// a doctored artifact that under-declares its ceiling refuses activation
/// instead of running past its admission.
fn validate_effect_ceiling(function: &FunctionDefinition) -> SnapbackResult<()> {
    let Some(ceiling) = &function.effect_ceiling else {
        return Ok(());
    };
    let FunctionRuntime::HostPlan(plan) = &function.runtime else {
        // Opaque handlers restate author declarations (`basis: "declared"`);
        // their runtime enforcement is the declared-reads path.
        return Ok(());
    };
    let mut observed = ObservedEffects::default();
    observed.handler_plan(plan);

    let exceeded = |axis: &str, detail: String| {
        SnapbackError::error(
            "SNAPBACK_FUNCTION_EFFECT_CEILING_EXCEEDED",
            "runtime",
            format!(
                "function {} performs a {axis} outside its admitted effect ceiling: {detail}",
                function.name
            ),
        )
        .with_details(serde_json::json!({
            "function": function.name,
            "axis": axis,
            "detail": detail,
        }))
    };
    for (table, access, index) in &observed.reads {
        let admitted = ceiling
            .reads
            .iter()
            .any(|read| read.table == *table && read.access == *access && read.index == *index);
        if !admitted {
            return Err(exceeded(
                "read",
                format!("{table} ({access}, index {index:?})"),
            ));
        }
    }
    for (table, operation) in &observed.writes {
        let admitted = ceiling
            .writes
            .iter()
            .any(|write| write.table == *table && write.operations.contains(operation));
        if !admitted {
            return Err(exceeded("write", format!("{table} ({operation})")));
        }
    }
    for host_operation in &observed.host_operations {
        if !ceiling
            .host_operations
            .iter()
            .any(|admitted| admitted == host_operation)
        {
            return Err(exceeded("host operation", (*host_operation).to_owned()));
        }
    }
    for input in &observed.authorization_inputs {
        if !ceiling
            .authorization_inputs
            .iter()
            .any(|admitted| admitted == input)
        {
            return Err(exceeded("authorization input", (*input).to_owned()));
        }
    }
    Ok(())
}

fn undeclarable_retention(function: &FunctionDefinition, reason: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_UNDECLARABLE_RETENTION",
        "auth",
        format!(
            "function {} cannot retain results because its authorization dependence is not declarable: {reason}",
            function.name
        ),
    )
    .with_details(serde_json::json!({
        "function": function.name,
        "reason": reason,
    }))
}

fn collect(value: &ValueExpr, dimensions: &mut BTreeSet<AuthorizationInputDimension>) {
    match value {
        ValueExpr::AuthUserId => {
            dimensions.insert(AuthorizationInputDimension::UserId);
        }
        ValueExpr::AuthKind => {
            dimensions.insert(AuthorizationInputDimension::Kind);
        }
        ValueExpr::AuthActorKind => {
            dimensions.insert(AuthorizationInputDimension::ActorKind);
        }
        ValueExpr::AuthActivityActorKind | ValueExpr::AuthActorUserId => {
            dimensions.insert(AuthorizationInputDimension::ActorKind);
        }
        ValueExpr::AuthGrantId => {
            dimensions.insert(AuthorizationInputDimension::Opaque);
        }
        ValueExpr::ClientMutationDigest => {}
        ValueExpr::AuthIsDelegated => {
            dimensions.insert(AuthorizationInputDimension::IsDelegated);
        }
        ValueExpr::Arg(_)
        | ValueExpr::Args
        | ValueExpr::Binding(_)
        | ValueExpr::Literal(_)
        | ValueExpr::RuntimeId
        | ValueExpr::RuntimeNow => {}
        ValueExpr::Field { base, .. } => collect(base, dimensions),
        ValueExpr::Binary { left, right, .. } => {
            collect(left, dimensions);
            collect(right, dimensions);
        }
        ValueExpr::Unary { expr, .. } => collect(expr, dimensions),
        ValueExpr::If { cond, then, r#else } => {
            collect(cond, dimensions);
            collect(then, dimensions);
            collect(r#else, dimensions);
        }
        ValueExpr::Concat(values) | ValueExpr::Call { args: values, .. } => {
            for value in values {
                collect(value, dimensions);
            }
        }
        ValueExpr::Record { fields } => {
            for value in fields.values() {
                collect(value, dimensions);
            }
        }
        // A membership semi-join authorizes on the effective principal.
        ValueExpr::MembershipExists(_) => {
            dimensions.insert(AuthorizationInputDimension::UserId);
        }
    }
}

fn host_plan_authorization_dimensions(
    function: &FunctionDefinition,
    plan: &QueryPlan,
) -> BTreeSet<AuthorizationInputDimension> {
    let mut dimensions = BTreeSet::new();
    for filter in &plan.filters {
        collect(&filter.value, &mut dimensions);
    }
    // Every membership predicate authorizes on the effective principal.
    if !plan.membership_filters.is_empty() {
        dimensions.insert(AuthorizationInputDimension::UserId);
    }
    if function.read_set_summary.auth_scope_field.is_some() {
        dimensions.insert(AuthorizationInputDimension::UserId);
    }
    dimensions
}

/// The authorization dimensions a relational plan observes: its root
/// filters and both visibility predicate lists (LLP 0080 §3 — visibility
/// is the executable authorization evidence).
fn relational_authorization_dimensions(
    plan: &RelationalQueryPlan,
) -> BTreeSet<AuthorizationInputDimension> {
    let mut dimensions = BTreeSet::new();
    for filter in plan
        .root_filters
        .iter()
        .chain(&plan.root_visibility)
        .chain(&plan.joined_visibility)
    {
        collect(&filter.value, &mut dimensions);
    }
    dimensions
}

fn validate_retainable_query(function: &FunctionDefinition) -> SnapbackResult<()> {
    if !function.retainable {
        return Ok(());
    }
    if !matches!(function.kind, FunctionKind::Query | FunctionKind::LiveQuery) {
        return Err(undeclarable_retention(function, "retainableNonQuery"));
    }

    // @ref LLP 0080#4-live-and-retained-capability — retention is a closed
    //   default-deny plan capability for relational queries: `retainable`
    //   on a relational plan declares exactly the
    //   `opaque-authorized-snapshot-v1` class (there is no third value),
    //   which treats the projected result as an opaque authorized snapshot
    //   under LLP 0053's lease and reconnect rules and therefore requires a
    //   server-resolved authenticated principal. Anonymous results have no
    //   admissible v1 retention, so an all-`public-read` plan refuses. The
    //   retained/native evaluator only decodes the opaque snapshot against
    //   the retained store — it never re-executes the join over retained
    //   rows — which holds by construction: the lease envelope carries
    //   result bytes, never a plan to re-run.
    if let FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)) = &function.runtime {
        let owner_visible = plan
            .root_visibility
            .iter()
            .chain(&plan.joined_visibility)
            .any(|filter| matches!(filter.value, ValueExpr::AuthUserId));
        if !owner_visible {
            return Err(undeclarable_retention(
                function,
                "relationalAnonymousRetention",
            ));
        }
        let summary = &function.read_set_summary;
        let summary_complete = summary.mode.as_deref() == Some("relational")
            && summary.primary_table.as_deref() == Some(plan.root.as_str())
            && summary.tables == vec![plan.root.clone(), plan.joined.clone()]
            && summary
                .auth_scope_field
                .as_ref()
                .is_none_or(|field| !field.trim().is_empty());
        if !summary_complete {
            return Err(undeclarable_retention(function, "incompleteReadSummary"));
        }
        let declared = function
            .authorization_dependence
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        if declared.len() != function.authorization_dependence.len() {
            return Err(undeclarable_retention(
                function,
                "duplicateAuthorizationDimension",
            ));
        }
        let mut observed = relational_authorization_dimensions(plan);
        if summary.auth_scope_field.is_some() {
            observed.insert(AuthorizationInputDimension::UserId);
        }
        if declared != observed {
            return Err(undeclarable_retention(
                function,
                "authorizationDeclarationMismatch",
            ));
        }
        if function.authority_independent {
            return Err(undeclarable_retention(
                function,
                "authorityIndependentWithAuthorizationDependence",
            ));
        }
        if declared == BTreeSet::from([AuthorizationInputDimension::UserId])
            || declared
                == BTreeSet::from([
                    AuthorizationInputDimension::UserId,
                    AuthorizationInputDimension::Kind,
                ])
        {
            return Ok(());
        }
        return Err(undeclarable_retention(function, "notUserIdOnly"));
    }

    // The shipped DK-4 reset does not reset module lexical/imported singleton
    // state, and JavaScript declarations cannot prove they read only userId.
    // Retaining an Ibex result would therefore turn a trusted string into a
    // security boundary. Keep it online until the reset-equivalence/profile
    // proof exists.
    // @ref LLP 0053#the-authorization-event-universe-closed — opaque ctx.auth
    //   or module state makes retention a load error.
    let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &function.runtime else {
        return Err(undeclarable_retention(function, "opaqueJavaScript"));
    };

    let summary = &function.read_set_summary;
    let summary_complete = summary.mode.as_deref() == Some("singleTable")
        && summary.primary_table.as_deref() == Some(plan.table.as_str())
        && summary.tables.len() == 1
        && summary.tables.first() == Some(&plan.table)
        && summary
            .auth_scope_field
            .as_ref()
            .is_none_or(|field| !field.trim().is_empty());
    if !summary_complete {
        return Err(undeclarable_retention(function, "incompleteReadSummary"));
    }

    let declared = function
        .authorization_dependence
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    if declared.len() != function.authorization_dependence.len() {
        return Err(undeclarable_retention(
            function,
            "duplicateAuthorizationDimension",
        ));
    }
    let observed = host_plan_authorization_dimensions(function, plan);
    if declared != observed {
        return Err(undeclarable_retention(
            function,
            "authorizationDeclarationMismatch",
        ));
    }

    if function.authority_independent {
        if declared.is_empty() {
            return Ok(());
        }
        return Err(undeclarable_retention(
            function,
            "authorityIndependentWithAuthorizationDependence",
        ));
    }

    if declared == BTreeSet::from([AuthorizationInputDimension::UserId])
        || declared
            == BTreeSet::from([
                AuthorizationInputDimension::UserId,
                AuthorizationInputDimension::Kind,
            ])
    {
        return Ok(());
    }
    Err(undeclarable_retention(function, "notUserIdOnly"))
}

/// Structural admission of the closed relational plan (LLP 0080 §1); schema
/// binding (tables, fields, indexes, the cardinality proof) is validated at
/// artifact load, and the load-bearing bounds are re-checked at execution.
pub fn validate_relational_query_plan_shape(plan: &RelationalQueryPlan) -> SnapbackResult<()> {
    let invalid = |message: String| {
        SnapbackError::error("SNAPBACK_RELATIONAL_PLAN_INVALID", "runtime", message)
    };
    if plan.root.is_empty() || plan.joined.is_empty() || plan.root == plan.joined {
        return Err(invalid(
            "relational plan requires two distinct named source tables".to_owned(),
        ));
    }
    if plan.root_alias.is_empty()
        || plan.joined_alias.is_empty()
        || plan.root_alias == plan.joined_alias
    {
        return Err(invalid(
            "relational plan requires distinct non-empty source aliases".to_owned(),
        ));
    }
    if plan.join_on.is_empty() || plan.join_on.len() > 4 {
        return Err(invalid(format!(
            "relational plan requires 1..=4 join equality pairs, got {}",
            plan.join_on.len()
        )));
    }
    if plan.take > 1024 {
        return Err(invalid(format!(
            "relational take must be 0..=1024, got {}",
            plan.take
        )));
    }
    if plan.projection.is_empty() {
        return Err(invalid(
            "relational projection must be non-empty".to_owned(),
        ));
    }
    let mut names = std::collections::BTreeSet::new();
    for leaf in &plan.projection {
        if leaf.name.is_empty() || !names.insert(&leaf.name) {
            return Err(invalid(format!(
                "relational projection field {:?} must be non-empty and unique",
                leaf.name
            )));
        }
    }
    if plan.root_index.is_empty() || plan.joined_index.is_empty() {
        return Err(invalid(
            "relational plan requires named root and joined indexes".to_owned(),
        ));
    }
    Ok(())
}

/// Structural admission for the portable search carrier. Table/index binding
/// and field classifications are validated against the schema at activation.
pub fn validate_search_query_plan_shape(plan: &SearchQueryPlanV1) -> SnapbackResult<()> {
    if plan.table.trim().is_empty()
        || plan.index.trim().is_empty()
        || plan.parser != crate::search::types::SEARCH_PARSER
        || plan.result_projection != "search-page-v1"
        || plan.required_capability != crate::search::types::SEARCH_CAPABILITY
    {
        return Err(SnapbackError::error(
            "SNAPBACK_SEARCH_QUERY_PLAN_INVALID",
            "search",
            "search plan must name one table/index and the exact v1 parser, result, and capability profiles",
        ));
    }
    Ok(())
}

pub fn validate_bounded_children_plan_shape(plan: &BoundedChildrenQueryPlan) -> SnapbackResult<()> {
    let valid_projection = |fields: &[BoundedProjectionField]| {
        let names: BTreeSet<&str> = fields.iter().map(|field| field.name.as_str()).collect();
        !fields.is_empty()
            && names.len() == fields.len()
            && fields
                .iter()
                .all(|field| !field.name.trim().is_empty() && !field.field.trim().is_empty())
    };
    let order_fields: BTreeSet<&str> = plan
        .order
        .iter()
        .map(|order| order.field.as_str())
        .collect();
    if plan.profile != "bounded-children.v1"
        || plan.required_capability != "bounded_children_v1"
        || plan.parent_table.trim().is_empty()
        || plan.parent_id_arg.trim().is_empty()
        || plan.child_table.trim().is_empty()
        || plan.child_foreign_key.trim().is_empty()
        || plan.child_relation_incarnation.trim().is_empty()
        || plan.child_index.trim().is_empty()
        || plan.order.is_empty()
        || plan
            .order
            .iter()
            .any(|order| order.direction != OrderDirection::Asc)
        || order_fields.len() != plan.order.len()
        || plan.take > 1024
        || plan.parent_deletion != "hide-orphans.v1"
        || !valid_projection(&plan.parent_projection)
        || !valid_projection(&plan.child_projection)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_BOUNDED_CHILDREN_PLAN_INVALID",
            "query",
            "bounded children plan is outside the closed v1 profile",
        ));
    }
    Ok(())
}

pub fn validate_write_with_activity_plan_shape(plan: &WriteWithActivityPlan) -> SnapbackResult<()> {
    let invalid = || {
        SnapbackError::error(
            "SNAPBACK_WRITE_WITH_ACTIVITY_PLAN_INVALID",
            "mutation",
            "write-with-activity plan is outside the closed v1 profile",
        )
    };
    let relation_tables: BTreeSet<&str> = plan
        .relations
        .iter()
        .map(|relation| relation.table.as_str())
        .collect();
    let provenance_fields = [
        plan.provenance_fields.scope_id.as_str(),
        plan.provenance_fields.source_table.as_str(),
        plan.provenance_fields.source_id.as_str(),
        plan.provenance_fields.operation.as_str(),
        plan.provenance_fields.effective_subject.as_str(),
        plan.provenance_fields.actual_actor.as_str(),
        plan.provenance_fields.actor_kind.as_str(),
        plan.provenance_fields.grant.as_str(),
        plan.provenance_fields.occurred_at.as_str(),
        plan.provenance_fields.mutation.as_str(),
    ];
    let distinct_provenance_fields: BTreeSet<&str> = provenance_fields.iter().copied().collect();
    if plan.profile != "write-with-activity.v1"
        || plan.required_capability != "write_activity_v1"
        // Only the existing-owner authoring mode has a generated evaluator
        // and publication corpus. A direct artifact cannot opt into the
        // reserved create-owner discriminator ahead of that implementation.
        || plan.mode != WriteWithActivityMode::ExistingOwnerV1
        || plan.scope_table.trim().is_empty()
        || plan.scope_owner_field.trim().is_empty()
        || plan.source_table.trim().is_empty()
        || plan.activity_table.trim().is_empty()
        || plan.scope_table == plan.source_table
        || plan.source_table == plan.activity_table
        || plan.scope_table == plan.activity_table
        || plan.activity_scope_foreign_key.trim().is_empty()
        || plan.activity_scope_incarnation.trim().is_empty()
        || plan.activity_scope_foreign_key != plan.provenance_fields.scope_id
        || distinct_provenance_fields.len() != provenance_fields.len()
        || distinct_provenance_fields.contains(plan.activity_scope_incarnation.as_str())
        || plan.relations.is_empty()
        || relation_tables.len() != plan.relations.len()
        || !relation_tables.contains(plan.source_table.as_str())
        || plan.relations.iter().any(|relation| {
            relation.table.trim().is_empty()
                || relation.table == plan.scope_table
                || relation.table == plan.activity_table
                || relation.scope_foreign_key.trim().is_empty()
                || relation.scope_incarnation.trim().is_empty()
                || relation.scope_foreign_key == relation.scope_incarnation
        })
        || plan.effect_formula.source_writes != 1
        || plan.effect_formula.activity_inserts != 1
        || plan.effect_formula.scope_reads != 1
        || plan.effect_formula.runtime_now != 1
        || plan.effect_formula.settlement_lookups != 1
        || plan.effect_formula.settlement_writes != 1
        || plan.effect_formula.auxiliary_point_reads > 8
        || plan.effect_formula.maximum_application_writes > 3
    {
        return Err(invalid());
    }

    let steps = &plan.mutation.steps;
    if steps.len() < 4 {
        return Err(invalid());
    }
    let scope_binding = "__activityScope";
    let activity_binding = "__activityId";
    if !matches!(
        &steps[0],
        MutationStep::Get {
            table,
            id,
            bind_as,
            else_error,
        } if table == &plan.scope_table
            && id == &plan.scope_id
            && bind_as == scope_binding
            && else_error.as_deref() == Some("SNAPBACK_ROW_NOT_FOUND")
    ) {
        return Err(invalid());
    }
    let exact_owner_guard = match &steps[1] {
        MutationStep::Guard {
            cond:
                ValueExpr::Binary {
                    op: BinaryOp::Eq,
                    left,
                    right,
                },
            else_error,
        } if else_error == "SNAPBACK_ROW_NOT_FOUND"
            && matches!(right.as_ref(), ValueExpr::AuthUserId) =>
        {
            matches!(
                left.as_ref(),
                ValueExpr::Field { base, key }
                    if key == &plan.scope_owner_field
                        && matches!(
                            base.as_ref(),
                            ValueExpr::Binding(binding) if binding == scope_binding
                        )
            )
        }
        _ => false,
    };
    if !exact_owner_guard {
        return Err(invalid());
    }
    let source_assertion_index = steps.len() - 2;
    let guard_and_let_count = steps[2..source_assertion_index]
        .iter()
        .filter(|step| matches!(step, MutationStep::Guard { .. } | MutationStep::Let { .. }))
        .count();
    let forbidden_expr =
        |expr: &ValueExpr| expr.uses_runtime_id() || expr.uses_authoritative_only();
    let step_uses_forbidden_expr = |step: &MutationStep| match step {
        MutationStep::Insert { values, .. } => values.values().any(forbidden_expr),
        MutationStep::Patch { id, values, .. } => {
            forbidden_expr(id) || values.values().any(forbidden_expr)
        }
        MutationStep::Delete { id, .. } | MutationStep::Get { id, .. } => forbidden_expr(id),
        MutationStep::Guard { cond, .. } => forbidden_expr(cond),
        MutationStep::AssertCurrentRelation { id, scope_id, .. } => {
            forbidden_expr(id) || forbidden_expr(scope_id)
        }
        MutationStep::Let { expr, .. } => forbidden_expr(expr),
        MutationStep::DeleteWhere { filter, .. } => {
            filter.iter().any(|entry| forbidden_expr(&entry.value))
        }
        MutationStep::InsertEach { source, values, .. } => {
            forbidden_expr(source) || values.values().any(forbidden_expr)
        }
        MutationStep::AssertSourceChanged { id, .. } => forbidden_expr(id),
    };
    let return_uses_forbidden_expr = match &plan.mutation.return_value {
        Some(ReturnValue::Document { id, .. }) => forbidden_expr(id),
        Some(ReturnValue::Expr(expr)) => forbidden_expr(expr),
        _ => false,
    };
    if guard_and_let_count > 16
        || steps.iter().any(step_uses_forbidden_expr)
        || return_uses_forbidden_expr
    {
        return Err(invalid());
    }

    if !matches!(
        &steps[source_assertion_index],
        MutationStep::AssertSourceChanged {
            table,
            id,
            operation,
        } if table == &plan.source_table
            && id == &plan.source_id
            && operation == &plan.source_operation
    ) {
        return Err(invalid());
    }
    let activity_values = match &steps[steps.len() - 1] {
        MutationStep::Insert {
            table,
            values,
            bind_id_as,
        } if table == &plan.activity_table && bind_id_as.as_deref() == Some(activity_binding) => {
            values
        }
        _ => return Err(invalid()),
    };
    let provenance = &plan.provenance_fields;
    let literal_string = |field: &str, expected: &str| {
        matches!(
            activity_values.get(field),
            Some(ValueExpr::Literal(serde_json::Value::String(value))) if value == expected
        )
    };
    if activity_values.get(&provenance.scope_id) != Some(&plan.scope_id)
        || !literal_string(&provenance.source_table, &plan.source_table)
        || activity_values.get(&provenance.source_id) != Some(&plan.source_id)
        || !literal_string(&provenance.operation, plan.source_operation.as_str())
        || !matches!(
            activity_values.get(&provenance.effective_subject),
            Some(ValueExpr::AuthUserId)
        )
        || !matches!(
            activity_values.get(&provenance.actual_actor),
            Some(ValueExpr::AuthActorUserId)
        )
        || !matches!(
            activity_values.get(&provenance.actor_kind),
            Some(ValueExpr::AuthActivityActorKind)
        )
        || !matches!(
            activity_values.get(&provenance.grant),
            Some(ValueExpr::AuthGrantId)
        )
        || !matches!(
            activity_values.get(&provenance.occurred_at),
            Some(ValueExpr::RuntimeNow)
        )
        || !matches!(
            activity_values.get(&provenance.mutation),
            Some(ValueExpr::ClientMutationDigest)
        )
        || activity_values.contains_key(&plan.activity_scope_incarnation)
        || !matches!(&plan.mutation.return_value, Some(ReturnValue::Expr(_)))
    {
        return Err(invalid());
    }

    let mut source_writes = 0_u8;
    let mut scope_patches = 0_u8;
    let mut auxiliary_point_reads = 0_u8;
    for index in 2..source_assertion_index {
        let step = &steps[index];
        match step {
            MutationStep::Get { table, id, .. } => {
                if table == &plan.scope_table
                    || !matches!(
                        steps.get(index - 1),
                        Some(MutationStep::AssertCurrentRelation {
                            table: asserted_table,
                            id: asserted_id,
                            ..
                        }) if asserted_table == table && asserted_id == id
                    )
                {
                    return Err(invalid());
                }
                auxiliary_point_reads += 2;
            }
            MutationStep::Insert {
                table, bind_id_as, ..
            } => {
                if table != &plan.source_table
                    || plan.source_operation != WriteWithActivitySourceOperation::Insert
                    || !matches!(
                        (&plan.source_id, bind_id_as),
                        (ValueExpr::Binding(source_binding), Some(insert_binding))
                            if source_binding == insert_binding
                    )
                {
                    return Err(invalid());
                }
                source_writes += 1;
            }
            MutationStep::Patch { table, id, values } => {
                if table == &plan.scope_table {
                    if id != &plan.scope_id {
                        return Err(invalid());
                    }
                    scope_patches += 1;
                } else {
                    if table != &plan.source_table
                        || id != &plan.source_id
                        || values.is_empty()
                        || plan.source_operation != WriteWithActivitySourceOperation::Patch
                        || !matches!(
                            steps.get(index - 1),
                            Some(MutationStep::AssertCurrentRelation {
                                table: asserted_table,
                                id: asserted_id,
                                ..
                            }) if asserted_table == table && asserted_id == id
                        )
                    {
                        return Err(invalid());
                    }
                    source_writes += 1;
                    auxiliary_point_reads += 2;
                }
            }
            MutationStep::Delete { table, id } => {
                if table != &plan.source_table
                    || id != &plan.source_id
                    || plan.source_operation != WriteWithActivitySourceOperation::Delete
                    || !matches!(
                        steps.get(index - 1),
                        Some(MutationStep::AssertCurrentRelation {
                            table: asserted_table,
                            id: asserted_id,
                            ..
                        }) if asserted_table == table && asserted_id == id
                    )
                {
                    return Err(invalid());
                }
                source_writes += 1;
                auxiliary_point_reads += 2;
            }
            MutationStep::AssertCurrentRelation { table, id, .. } => {
                if !matches!(
                    steps.get(index + 1),
                    Some(MutationStep::Get {
                        table: operation_table,
                        id: operation_id,
                        ..
                    } | MutationStep::Patch {
                        table: operation_table,
                        id: operation_id,
                        ..
                    } | MutationStep::Delete {
                        table: operation_table,
                        id: operation_id,
                    }) if operation_table == table && operation_id == id
                ) {
                    return Err(invalid());
                }
            }
            MutationStep::Guard { .. } | MutationStep::Let { .. } => {}
            MutationStep::AssertSourceChanged { .. }
            | MutationStep::DeleteWhere { .. }
            | MutationStep::InsertEach { .. } => return Err(invalid()),
        }
    }
    let expected_runtime_ids = if plan.source_operation == WriteWithActivitySourceOperation::Insert
    {
        2
    } else {
        1
    };
    if source_writes != 1
        || scope_patches > 1
        || plan.effect_formula.scope_patches != scope_patches
        || plan.effect_formula.auxiliary_point_reads != auxiliary_point_reads
        || plan.effect_formula.runtime_ids != expected_runtime_ids
        || plan.effect_formula.maximum_application_writes != 2 + scope_patches
    {
        return Err(invalid());
    }
    Ok(())
}

pub fn validate_query_plan_shape(plan: &QueryPlan) -> SnapbackResult<()> {
    // @ref LLP 0007#query-semantics — every direct artifact must enter the
    // same bounded portable expression profile before it can be installed.
    if let Some(limit) = plan.limit
        && limit > QUERY_MAX_LIMIT
    {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_LIMIT_INVALID",
            "query",
            format!("query limit {limit} exceeds the portable cap {QUERY_MAX_LIMIT}"),
        ));
    }
    let mut literal_in_items = 0_usize;
    let mut known_filter_bindings = 0_usize;
    for filter in &plan.filters {
        crate::value_expr::validate_value_expr(&filter.value)?;
        let added_bindings = if filter.op == FilterOp::In {
            if let ValueExpr::Literal(value) = &filter.value {
                let Some(items) = value.as_array() else {
                    return Err(SnapbackError::error(
                        "SNAPBACK_QUERY_FILTER_VALUE_INVALID",
                        "query",
                        format!("query In filter on {} expects an array", filter.field),
                    ));
                };
                literal_in_items = literal_in_items.saturating_add(items.len());
                if literal_in_items > QUERY_MAX_IN_ITEMS {
                    return Err(SnapbackError::error(
                        "SNAPBACK_QUERY_IN_ITEMS_EXCEEDED",
                        "query",
                        format!(
                            "query In filters contain {} literal items after {}; maxInItems is {}",
                            literal_in_items, filter.field, QUERY_MAX_IN_ITEMS
                        ),
                    ));
                }
                items.len()
            } else {
                // The runtime validator accounts for a dynamically evaluated
                // `In` array once its length is known.
                0
            }
        } else {
            1
        };
        known_filter_bindings = known_filter_bindings.saturating_add(added_bindings);
        if known_filter_bindings > QUERY_MAX_FILTER_BINDINGS {
            return Err(SnapbackError::error(
                "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED",
                "query",
                format!(
                    "query filters bind {known_filter_bindings} statically known values after {}; maxFilterBindings is {QUERY_MAX_FILTER_BINDINGS}",
                    filter.field
                ),
            ));
        }
    }
    Ok(())
}

pub fn effective_query_limit(plan: &QueryPlan) -> usize {
    plan.limit.unwrap_or(QUERY_DEFAULT_LIMIT)
}

/// The schema-expanded value grammar used to validate handler results at the
/// Rust publication boundary.
///
/// @ref LLP 0108#final-author-reconciliation-after-round-3 — result contracts
/// are Rust-owned, bounded, and carried by every generated function.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ResultValueContract {
    Null,
    Boolean,
    String {
        #[serde(rename = "maxBytes", alias = "max_bytes")]
        max_bytes: usize,
    },
    Integer {
        min: i64,
        max: i64,
    },
    FiniteReal {
        min: f64,
        max: f64,
    },
    Principal,
    Id {
        table: String,
    },
    Literal {
        value: Value,
    },
    Json {
        #[serde(rename = "maxDepth", alias = "max_depth")]
        max_depth: usize,
        #[serde(rename = "maxBytes", alias = "max_bytes")]
        max_bytes: usize,
    },
    Array {
        element: Box<ResultValueContract>,
        #[serde(rename = "maxItems", alias = "max_items")]
        max_items: usize,
    },
    Union {
        variants: Vec<ResultValueContract>,
    },
    Object {
        fields: Vec<ResultObjectFieldContract>,
        #[serde(rename = "allowExtra", alias = "allow_extra")]
        allow_extra: bool,
    },
    /// A reference to an entry in the closed, platform-owned registry of
    /// exported Rust-owned schemas. Valid only at argument positions in v1;
    /// not an app-authorable spelling — `defineSearchQuery` constructs it
    /// internally and no `v.*` builder emits it. The node contributes its
    /// authority class and reference id (never the referenced artifact's
    /// bytes) to the canonical hash form; artifact drift is gated by the
    /// schema-export drift test. The explicit `authority` member is a closed
    /// enum with exactly one admitted value in v1, so a future app-schema
    /// reference (option E) is a distinct authority class with
    /// digest-carrying identity rather than a silent reinterpretation.
    ///
    /// @ref LLP 0131#the-argument-contract-descriptor — PlatformSchemaRef is
    /// the one new node kind; v1's registry has exactly
    /// `snapback:search-query-ast:v1`.
    PlatformSchemaRef {
        authority: SchemaRefAuthority,
        schema: String,
    },
}

/// The closed authority classes a schema-reference node may name. V1 admits
/// exactly `platform`; hash-by-reference-id is a property of this class.
#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
pub enum SchemaRefAuthority {
    #[default]
    #[serde(rename = "platform")]
    Platform,
}

/// The closed v1 registry of platform schema-reference ids (LLP 0131).
/// Exactly one entry: the search query AST, resolving to the
/// `SearchQueryAstV1` definition inside the exported
/// `search.request.schema.json`. The registry maps the id to both its
/// exported artifact definition and its runtime validator; in v1 both are
/// the same Rust type (`SearchQueryAstV1`), so artifact/validator agreement
/// is intrinsic and byte drift is gated by the schema-export drift test.
pub const SCHEMA_REF_SEARCH_QUERY_AST_V1: &str = "snapback:search-query-ast:v1";

pub fn schema_ref_registry_v1() -> [&'static str; 1] {
    [SCHEMA_REF_SEARCH_QUERY_AST_V1]
}

/// One closed object contract over a function's declared arguments:
/// declaration-ordered fields, each carrying a value node from the same node
/// vocabulary the result manifest uses (LLP 0131 — one node vocabulary, two
/// contract roots).
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct FunctionArgsContract {
    pub fields: Vec<ResultObjectFieldContract>,
}


#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ResultObjectFieldContract {
    pub name: String,
    pub required: bool,
    pub value: ResultValueContract,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ResultRowsBound {
    #[serde(rename = "minItems", alias = "min_items")]
    pub min_items: usize,
    #[serde(rename = "maxItems", alias = "max_items")]
    pub max_items: usize,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum FunctionResultContract {
    #[default]
    Unknown,
    Documents {
        table: String,
        document: ResultValueContract,
    },
    Records {
        record: ResultValueContract,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rows: Option<ResultRowsBound>,
    },
    Document {
        table: String,
        document: ResultValueContract,
    },
    Value {
        value: ResultValueContract,
    },
    LegacyQueryRowsV0 {
        row: ResultValueContract,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct FunctionDefinition {
    /// Required stable identity for grants and consent. Deserialization
    /// tolerates an absent field (empty string) so the refusal is a typed
    /// load-time diagnostic rather than an opaque parse error, but
    /// [`FunctionManifest::validate_artifact`] rejects a manifest whose
    /// function lacks a non-empty id before it can install.
    ///
    /// @ref LLP 0012#v0-function-manifest — function ids are required and
    ///   stable; a missing id fails load with a typed diagnostic because
    ///   scoped grants and consent are keyed by this identity.
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default, rename = "exportedName", alias = "exported_name")]
    pub exported_name: Option<String>,
    pub kind: FunctionKind,
    #[serde(default, rename = "sourceSpan", alias = "source_span")]
    pub source_span: Option<SourceSpan>,
    #[serde(default, rename = "handlerForm", alias = "handler_form")]
    pub handler_form: Option<String>,
    #[serde(default, rename = "implementationHash", alias = "implementation_hash")]
    pub implementation_hash: Option<String>,
    #[serde(default, rename = "argsContractHash", alias = "args_contract_hash")]
    pub args_contract_hash: Option<String>,
    /// The declared argument contract (LLP 0131): one closed object over the
    /// function's declaration-ordered arguments, carried beside the result
    /// contract and witnessed by `argsContractHash` (v2 domain). Absent on
    /// pre-0131 manifests, which keep loading without ingress validation.
    #[serde(
        default,
        rename = "argsContract",
        alias = "args_contract",
        skip_serializing_if = "Option::is_none"
    )]
    pub args_contract: Option<FunctionArgsContract>,
    #[serde(default, rename = "resultContract", alias = "result_contract")]
    pub result_contract: FunctionResultContract,
    #[serde(default, rename = "resultContractHash", alias = "result_contract_hash")]
    pub result_contract_hash: Option<String>,
    #[serde(
        default,
        rename = "requiredCapabilities",
        alias = "required_capabilities"
    )]
    pub required_capabilities: Vec<String>,
    #[serde(default, rename = "authRequirement", alias = "auth_requirement")]
    pub auth_requirement: Option<AuthRequirement>,
    #[serde(
        default,
        rename = "authorityIndependent",
        alias = "authority_independent",
        skip_serializing_if = "is_false"
    )]
    pub authority_independent: bool,
    /// Disclosure permission for Channel A / read-mode public bundles: this
    /// already-public query's rows may be embedded in a tokenless HTML
    /// response. Grants no invocation authority; accepted only beside a valid
    /// `authorityIndependent` declaration.
    // @ref LLP 0092#0c3-publicinline--a-codegen-compiled-disclosure-fact —
    //   authored on the function definition, compiled by codegen, re-enforced
    //   at manifest load; never route-manifest authored. Keep this reference
    //   out of the generated JSON Schema description.
    #[serde(
        default,
        rename = "publicInline",
        alias = "public_inline",
        skip_serializing_if = "is_false"
    )]
    pub public_inline: bool,
    /// This entry point may reach a durable permission-backing write. The
    /// marker is part of delegated consent: changing it terminally invalidates
    /// scopes minted against the prior function basis.
    ///
    /// @ref LLP 0055#grants — authority-creating functions require explicit,
    ///   displayed consent and never join a delegated tier expansion.
    #[serde(
        default,
        rename = "authorityCreating",
        alias = "authority_creating",
        skip_serializing_if = "is_false"
    )]
    pub authority_creating: bool,
    /// Results may be durably retained only when the item-8 admission profile
    /// validates this declaration and the complete read summary.
    ///
    /// @ref LLP 0053#retained-and-offline-authorization — retainability is an
    ///   explicit capability, never inferred from live/callable status.
    #[serde(default, skip_serializing_if = "is_false")]
    pub retainable: bool,
    /// Closed authority dimensions used by this result. Codegen derives the
    /// HostPlan value from `AuthUserId`/`authScopeField`; opaque JavaScript is
    /// never upgraded merely because an author writes `userId` here.
    #[serde(
        default,
        rename = "authorizationDependence",
        alias = "authorization_dependence",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub authorization_dependence: Vec<AuthorizationInputDimension>,
    #[serde(default, rename = "syncabilityClass", alias = "syncability_class")]
    pub syncability_class: Option<String>,
    #[serde(default, rename = "readSetSummary", alias = "read_set_summary")]
    pub read_set_summary: DependencySummary,
    #[serde(default, rename = "writeSetSummary", alias = "write_set_summary")]
    pub write_set_summary: DependencySummary,
    /// The versioned conservative effect ceiling. Codegen computes it by a
    /// total default-deny traversal of the closed plan vocabulary for
    /// HostPlans (`basis: "static"`) and records author declarations for
    /// opaque handlers (`basis: "declared"`). Optional so pre-ceiling
    /// manifests keep loading; enforcement remains the runtime subset check.
    // @ref LLP 0065#1-fact-classes — EffectCeilingV1. (Plain comment: doc
    //   text flows into generated schemas.)
    #[serde(default, rename = "effectCeiling", alias = "effect_ceiling")]
    pub effect_ceiling: Option<EffectCeiling>,
    /// Stable versioned standard-pattern identity — which generated helper
    /// and visibility profile produced this function (e.g. `owned-crud.v1`,
    /// `owner.v1`). Absent on free-form definitions.
    /// @ref LLP 0065#3-common-pattern-contracts — versioned identifiers.
    #[serde(default, rename = "standardPattern", alias = "standard_pattern")]
    pub standard_pattern: Option<StandardPatternIdentity>,
    #[serde(
        default,
        rename = "permissionEpochBumps",
        alias = "permission_epoch_bumps"
    )]
    pub permission_epoch_bumps: Vec<PermissionScopeExpr>,
    #[serde(default, rename = "bundleEntrypoint", alias = "bundle_entrypoint")]
    pub bundle_entrypoint: Option<String>,
    /// @ref LLP 0036#declared-configuration-in-the-manifest — D8: the config
    /// entries this function may receive. Declaring an entry makes it exist;
    /// only functions that name it here are granted it at runtime.
    #[serde(default)]
    pub uses: Vec<String>,
    pub runtime: FunctionRuntime,
}

impl FunctionDefinition {
    pub fn new(name: impl Into<String>, kind: FunctionKind, runtime: FunctionRuntime) -> Self {
        let name = name.into();
        let syncability_class = match kind {
            FunctionKind::LiveQuery => "syncable-live",
            FunctionKind::Query => "online-only",
            FunctionKind::Mutation => "mutation",
            FunctionKind::Action => "action",
        };
        Self {
            id: format!("fn:{name}"),
            name: name.clone(),
            exported_name: Some(name.clone()),
            kind,
            source_span: None,
            handler_form: None,
            implementation_hash: None,
            args_contract_hash: None,
            args_contract: None,
            result_contract: FunctionResultContract::Unknown,
            result_contract_hash: None,
            required_capabilities: Vec::new(),
            auth_requirement: None,
            authority_independent: false,
            public_inline: false,
            authority_creating: false,
            retainable: false,
            authorization_dependence: Vec::new(),
            syncability_class: Some(syncability_class.to_owned()),
            read_set_summary: DependencySummary::default(),
            write_set_summary: DependencySummary::default(),
            effect_ceiling: None,
            standard_pattern: None,
            permission_epoch_bumps: Vec::new(),
            bundle_entrypoint: Some(name),
            uses: Vec::new(),
            runtime,
        }
    }

    pub fn effective_auth_requirement(&self) -> AuthRequirement {
        self.auth_requirement
            .unwrap_or(AuthRequirement::OptionalUser)
    }

    /// Every auth-scoped live query and every retainable query uses the same
    /// default-deny execution profile. Ordinary finite queries remain outside
    /// it unless they opt into retention.
    pub fn is_protected_query(&self) -> bool {
        self.retainable || (self.kind == FunctionKind::LiveQuery && !self.authority_independent)
    }

    /// True only for retained results whose continued visibility is bound to
    /// the authenticated user rather than to a session lease. Public,
    /// authority-independent results deliberately stay outside this path.
    pub(crate) fn is_user_scoped_retainable_query(&self) -> bool {
        let dimensions = self
            .authorization_dependence
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        matches!(self.kind, FunctionKind::Query | FunctionKind::LiveQuery)
            && self.retainable
            && (dimensions == BTreeSet::from([AuthorizationInputDimension::UserId])
                || dimensions
                    == BTreeSet::from([
                        AuthorizationInputDimension::UserId,
                        AuthorizationInputDimension::Kind,
                    ]))
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum PermissionScopeExpr {
    AuthUser,
    Arg(String),
    Literal(String),
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct SourceSpan {
    pub file: String,
    pub line: u32,
    pub column: u32,
}

/// EffectCeilingV1 (LLP 0065 §1): the versioned conservative effect ceiling —
/// operations, tables, index ranges, host operations, and authorization
/// dependencies — recorded per generated function. `basis` is `"static"`
/// when the ceiling was proved by codegen's total default-deny traversal of
/// the closed plan vocabulary and `"declared"` when it restates author
/// declarations for an opaque handler.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EffectCeiling {
    pub version: String,
    pub basis: String,
    #[serde(default)]
    pub reads: Vec<EffectCeilingRead>,
    #[serde(default)]
    pub writes: Vec<EffectCeilingWrite>,
    #[serde(default, rename = "hostOperations", alias = "host_operations")]
    pub host_operations: Vec<String>,
    #[serde(
        default,
        rename = "authorizationInputs",
        alias = "authorization_inputs"
    )]
    pub authorization_inputs: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EffectCeilingRead {
    pub table: String,
    /// `"point"` or `"query"`.
    pub access: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EffectCeilingWrite {
    pub table: String,
    pub operations: Vec<String>,
}

/// The closed root-to-output key expression of a maintained projection
/// (LLP 0080 §5): the root `_id`, or the complete ordered tuple of a
/// declared unique root index whose fields the plan marks immutable, so an
/// output key cannot move under maintenance. Either form is injective over
/// roots by the uniqueness proof.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ProjectionOutputKey {
    RootId,
    RootUniqueIndex {
        index: String,
        /// The exact index fields, restated so the plan is self-describing
        /// and validation can prove the restatement matches the schema.
        fields: Vec<String>,
    },
}

/// Source/output visibility declaration for a maintained projection —
/// declarative (unlike the callable plan's executable filter lists) because
/// maintenance runs under internal projection-maintenance authority and the
/// declarations constrain information flow and the output's read
/// enforcement, not a caller (LLP 0080 §3/§5).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ProjectionVisibility {
    #[serde(rename = "public-read")]
    PublicRead,
    #[serde(rename = "owner")]
    Owner { field: String },
}

/// `MaintainedProjectionPlanV1` (LLP 0080 §5): a relational core plus a
/// stable output key expression, per-source and output visibility
/// declarations, the declared root reverse index (the bounded lookup and
/// admission proof for joined-source fan-out), and a static `fanOutLimit`.
/// It deliberately has no caller-relative ordering, cursor, or `take`.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MaintainedProjectionPlan {
    /// Stable plan identity (publication metadata). The stored projection
    /// identity assigned at first activation derives from this and is
    /// revision-stable — it names the row-identity domain, never re-keys.
    pub id: String,
    pub root: String,
    #[serde(rename = "rootAlias", alias = "root_alias")]
    pub root_alias: String,
    pub joined: String,
    #[serde(rename = "joinedAlias", alias = "joined_alias")]
    pub joined_alias: String,
    #[serde(rename = "joinKind", alias = "join_kind")]
    pub join_kind: JoinKind,
    #[serde(rename = "joinOn", alias = "join_on")]
    pub join_on: Vec<JoinEquality>,
    /// The non-security root filter `materializeAll` enumerates under —
    /// portable literal-only predicates in v1 (no caller, no auth exprs).
    #[serde(default, rename = "rootFilters", alias = "root_filters")]
    pub root_filters: Vec<FilterExpr>,
    #[serde(rename = "rootVisibility", alias = "root_visibility")]
    pub root_visibility: ProjectionVisibility,
    #[serde(rename = "joinedVisibility", alias = "joined_visibility")]
    pub joined_visibility: ProjectionVisibility,
    /// Projection leaves; declaration order is the output field order.
    pub projection: Vec<ProjectionLeaf>,
    #[serde(rename = "outputTable", alias = "output_table")]
    pub output_table: String,
    #[serde(rename = "outputKey", alias = "output_key")]
    pub output_key: ProjectionOutputKey,
    #[serde(rename = "outputVisibility", alias = "output_visibility")]
    pub output_visibility: ProjectionVisibility,
    /// Declared root reverse index whose leading fields are exactly the
    /// root join-field sequence — targets may not discover affected roots
    /// through a table scan.
    #[serde(rename = "rootReverseIndex", alias = "root_reverse_index")]
    pub root_reverse_index: String,
    /// Static per-joined-key reference bound, `1..=1023`. Counts every
    /// reverse-index entry for the joined key, not only filter-admitted
    /// roots.
    #[serde(rename = "fanOutLimit", alias = "fan_out_limit")]
    pub fan_out_limit: u32,
    /// Explicit acknowledgment of the cross-authority capacity coupling
    /// when a mutable shared joined source feeds an owner output
    /// (LLP 0080 §3); absent otherwise.
    #[serde(
        default,
        rename = "sharedFanOutDisclosure",
        alias = "shared_fan_out_disclosure"
    )]
    pub shared_fan_out_disclosure: bool,
    /// The versioned rebuild recipe this plan declares (LLP 0080 §5);
    /// `"rebuild-v1"` is the only admitted value until the 0081 slice.
    #[serde(rename = "rebuildRecipe", alias = "rebuild_recipe")]
    pub rebuild_recipe: String,
}

/// The versioned helper/profile identity a standard-pattern function carries
/// (LLP 0065 §3).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StandardPatternIdentity {
    pub helper: String,
    pub profile: String,
}

// @ref LLP 0080#1-closed-relational-plan — this Rust-owned shape is the
// closed first relational profile. Keep the reference out of generated schema
// prose so ref-check does not interpret a JSON string as a source annotation.
/// The closed first relational profile: one root table, exactly one
/// unique-joined table, at most four equality pairs, explicit
/// visibility on both sources, index-served root access, deterministic
/// root ordering, and a bounded `take`. Evaluation follows the normative
/// `root-window-v1` pipeline: visible root filter → cursor boundary → root
/// order → take N roots → join + joined visibility → projection. `take`
/// bounds consumed authorized roots, not emitted rows.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RelationalQueryPlan {
    pub root: String,
    #[serde(rename = "rootAlias", alias = "root_alias")]
    pub root_alias: String,
    pub joined: String,
    #[serde(rename = "joinedAlias", alias = "joined_alias")]
    pub joined_alias: String,
    #[serde(rename = "joinKind", alias = "join_kind")]
    pub join_kind: JoinKind,
    /// 1..=4 equality pairs; declaration order preserved. A null in any
    /// join-key position never matches (LLP 0080 §2).
    #[serde(rename = "joinOn", alias = "join_on")]
    pub join_on: Vec<JoinEquality>,
    /// Non-security root filters from the portable vocabulary, index-served.
    #[serde(default, rename = "rootFilters", alias = "root_filters")]
    pub root_filters: Vec<FilterExpr>,
    /// The root visibility predicate, composed before ordering and `take`
    /// so an invisible root cannot occupy a bounded-result slot. Empty for
    /// an explicitly declared `public-read` root.
    #[serde(default, rename = "rootVisibility", alias = "root_visibility")]
    pub root_visibility: Vec<FilterExpr>,
    /// The joined-source visibility predicate, executed per joined row
    /// before projection: an invisible joined row behaves as absent.
    #[serde(default, rename = "joinedVisibility", alias = "joined_visibility")]
    pub joined_visibility: Vec<FilterExpr>,
    /// Explicit projection whose leaves are literals or qualified source
    /// fields; declaration order is the result field order.
    pub projection: Vec<ProjectionLeaf>,
    /// Root scalar order fields; the storage layer's `_id` tie-break
    /// totalizes it exactly as for single-table queries.
    #[serde(default)]
    pub order: Vec<OrderExpr>,
    /// Consumed-authorized-roots bound, `0..=1024`.
    pub take: u32,
    /// The declared root access index proving bounded, index-served access.
    #[serde(rename = "rootIndex", alias = "root_index")]
    pub root_index: String,
    /// The declared unique joined index whose complete ordered key is
    /// exactly the joined-field sequence — the cardinality proof.
    #[serde(rename = "joinedIndex", alias = "joined_index")]
    pub joined_index: String,
}

/// `bounded-children.v1`: one visible parent point read followed by one exact,
/// forward, `take + 1` child-index range. The one computed result record keeps
/// its continuation inside the row, leaving the ordinary top-level query
/// cursor unused.
///
/// @ref LLP 0110#cursor-and-result-closure — the result is a closed computed
///   record and the cursor binds the current parent version/incarnation.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BoundedChildrenQueryPlan {
    pub profile: String,
    #[serde(rename = "requiredCapability", alias = "required_capability")]
    pub required_capability: String,
    #[serde(rename = "parentTable", alias = "parent_table")]
    pub parent_table: String,
    #[serde(rename = "parentIdArg", alias = "parent_id_arg")]
    pub parent_id_arg: String,
    #[serde(rename = "parentVisibility", alias = "parent_visibility")]
    pub parent_visibility: BoundedParentVisibility,
    #[serde(rename = "parentProjection", alias = "parent_projection")]
    pub parent_projection: Vec<BoundedProjectionField>,
    #[serde(rename = "childTable", alias = "child_table")]
    pub child_table: String,
    #[serde(rename = "childForeignKey", alias = "child_foreign_key")]
    pub child_foreign_key: String,
    #[serde(
        rename = "childRelationIncarnation",
        alias = "child_relation_incarnation"
    )]
    pub child_relation_incarnation: String,
    #[serde(rename = "childIndex", alias = "child_index")]
    pub child_index: String,
    pub order: Vec<OrderExpr>,
    pub take: u32,
    #[serde(rename = "childProjection", alias = "child_projection")]
    pub child_projection: Vec<BoundedProjectionField>,
    #[serde(rename = "parentDeletion", alias = "parent_deletion")]
    pub parent_deletion: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum BoundedParentVisibility {
    PublicRead,
    Owner { field: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BoundedProjectionField {
    pub name: String,
    pub field: String,
}

/// One normalized `write-with-activity.v1` plan. `mutation` is the complete
/// executable closed IR including scope/source guards, the host-checked source
/// effect assertion, the activity insert, and final result expression.
///
/// @ref LLP 0110#total-effect-formulas — the plan carries its mode-indexed,
///   quantitative ceiling rather than reconstructing it from names.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WriteWithActivityPlan {
    pub profile: String,
    #[serde(rename = "requiredCapability", alias = "required_capability")]
    pub required_capability: String,
    pub mode: WriteWithActivityMode,
    #[serde(rename = "scopeTable", alias = "scope_table")]
    pub scope_table: String,
    #[serde(rename = "scopeId", alias = "scope_id")]
    pub scope_id: ValueExpr,
    #[serde(rename = "scopeOwnerField", alias = "scope_owner_field")]
    pub scope_owner_field: String,
    #[serde(rename = "sourceTable", alias = "source_table")]
    pub source_table: String,
    #[serde(rename = "sourceId", alias = "source_id")]
    pub source_id: ValueExpr,
    #[serde(rename = "sourceOperation", alias = "source_operation")]
    pub source_operation: WriteWithActivitySourceOperation,
    #[serde(rename = "activityTable", alias = "activity_table")]
    pub activity_table: String,
    #[serde(
        rename = "activityScopeForeignKey",
        alias = "activity_scope_foreign_key"
    )]
    pub activity_scope_foreign_key: String,
    #[serde(
        rename = "activityScopeIncarnation",
        alias = "activity_scope_incarnation"
    )]
    pub activity_scope_incarnation: String,
    pub relations: Vec<WriteActivityRelation>,
    #[serde(rename = "provenanceFields", alias = "provenance_fields")]
    pub provenance_fields: WriteActivityProvenanceFields,
    #[serde(rename = "effectFormula", alias = "effect_formula")]
    pub effect_formula: WriteWithActivityEffectFormula,
    pub mutation: MutationPlan,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WriteActivityRelation {
    pub table: String,
    #[serde(rename = "scopeForeignKey", alias = "scope_foreign_key")]
    pub scope_foreign_key: String,
    #[serde(rename = "scopeIncarnation", alias = "scope_incarnation")]
    pub scope_incarnation: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum WriteWithActivityMode {
    ExistingOwnerV1,
    CreateOwnerV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum WriteWithActivitySourceOperation {
    Insert,
    Patch,
    Delete,
}

impl WriteWithActivitySourceOperation {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Insert => "insert",
            Self::Patch => "patch",
            Self::Delete => "delete",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteActivityProvenanceFields {
    pub scope_id: String,
    pub source_table: String,
    pub source_id: String,
    pub operation: String,
    pub effective_subject: String,
    pub actual_actor: String,
    pub actor_kind: String,
    pub grant: String,
    pub occurred_at: String,
    pub mutation: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteWithActivityEffectFormula {
    pub scope_reads: u8,
    pub scope_patches: u8,
    pub auxiliary_point_reads: u8,
    pub source_writes: u8,
    pub activity_inserts: u8,
    pub runtime_ids: u8,
    pub runtime_now: u8,
    pub settlement_lookups: u8,
    pub settlement_writes: u8,
    pub maximum_application_writes: u8,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum JoinKind {
    Inner,
    Left,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct JoinEquality {
    #[serde(rename = "rootField", alias = "root_field")]
    pub root_field: String,
    #[serde(rename = "joinedField", alias = "joined_field")]
    pub joined_field: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProjectionLeaf {
    pub name: String,
    pub source: ProjectionSource,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ProjectionSource {
    RootField(String),
    JoinedField(String),
    Literal(Value),
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct DependencySummary {
    #[serde(default, rename = "primaryTable", alias = "primary_table")]
    pub primary_table: Option<String>,
    #[serde(default)]
    pub tables: Vec<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default, rename = "authScopeField", alias = "auth_scope_field")]
    pub auth_scope_field: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum FunctionKind {
    Query,
    Mutation,
    LiveQuery,
    Action,
}

// `HandlerPlan` outgrew clippy's variant-size threshold as the relational
// profile (LLP 0080) widened query plans. The externally-tagged shape is the
// ratified v0 artifact pin and every construction site spells the variant
// directly, so boxing here would be churn without a wire or safety win.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum FunctionRuntime {
    HostPlan(HandlerPlan),
    IbexModule(IbexModule),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct IbexModule {
    pub source: String,
    pub export: String,
}

/// The public projection of [`FunctionManifest`] served inside the root
/// `/inspect` identity descriptor. Like `PublicInspect` it is a typed
/// allowlist: the `From` impls below destructure the full structs exhaustively,
/// so a newly-added field is a compile error here rather than a silent leak.
///
/// What it keeps: identity/compat and dependency facts — app id, bundle/inputs
/// hashes, function names/kinds/capability summaries, read/write summaries,
/// cron and config *declarations* (never values; secrets do not ride the
/// manifest — LLP 0036). What it drops: every executable handler body
/// (`IbexModule.source`, `HandlerPlan` step bodies), every function/cron/config
/// `sourceSpan` (a source-path leak), and free-form unsupported-dependency
/// diagnostic message/details. Full operational context stays only on the gated
/// `/_snapback/api/inspect` twin.
///
/// @ref LLP 0031#resolved-decisions — D3: public `/inspect` is an identity
///   descriptor; handler source and plan bodies are operational facts for the
///   gated twin only (ENG-23441).
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicFunctionManifest {
    #[serde(rename = "artifactKind")]
    pub artifact_kind: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "appId")]
    pub app_id: String,
    #[serde(rename = "bundleHash")]
    pub bundle_hash: Option<String>,
    #[serde(rename = "inputsHash")]
    pub inputs_hash: Option<String>,
    #[serde(rename = "generatedAt")]
    pub generated_at: Option<u64>,
    #[serde(rename = "unsupportedDependencyDiagnostics")]
    pub unsupported_dependency_diagnostics: Vec<PublicDiagnostic>,
    #[serde(
        default,
        rename = "acknowledgedExperimentalCapabilities",
        skip_serializing_if = "Vec::is_empty"
    )]
    #[schemars(default)]
    pub acknowledged_experimental_capabilities: Vec<String>,
    pub functions: Vec<PublicFunctionDefinition>,
    #[serde(rename = "cronJobs")]
    pub cron_jobs: Vec<PublicCronJobDefinition>,
    pub config: Vec<PublicConfigEntryDefinition>,
}

/// Public cron declaration: scheduling posture without its source path.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicCronJobDefinition {
    pub name: String,
    pub schedule: CronSchedule,
    pub action: String,
    pub enabled: bool,
    pub activation: CronActivationPolicy,
    #[serde(rename = "jitterPolicy")]
    pub jitter_policy: CronJitterPolicy,
    #[serde(rename = "overlapPolicy")]
    pub overlap_policy: CronOverlapPolicy,
    #[serde(rename = "retryPolicy")]
    pub retry_policy: CronRetryPolicy,
    #[serde(rename = "requiredCapabilities")]
    pub required_capabilities: Vec<String>,
    #[serde(rename = "targetWakeup")]
    pub target_wakeup: Option<CronTargetWakeup>,
}

/// Public config declaration. Values never ride the manifest; the source span
/// is additionally removed because it reveals local build paths.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicConfigEntryDefinition {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    pub secret: bool,
    pub required: bool,
    pub pool: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe: Option<String>,
    #[serde(rename = "howToGet", skip_serializing_if = "Option::is_none")]
    pub how_to_get: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acquisition: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
}

/// Public projection of [`FunctionDefinition`]: everything except the
/// executable runtime body and the source span.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicFunctionDefinition {
    /// Always present: the validated manifest guarantees a non-empty stable
    /// id, so the public projection never serves a null function identity.
    pub id: String,
    pub name: String,
    #[serde(rename = "exportedName")]
    pub exported_name: Option<String>,
    pub kind: FunctionKind,
    #[serde(rename = "handlerForm", skip_serializing_if = "Option::is_none")]
    pub handler_form: Option<String>,
    #[serde(rename = "implementationHash", skip_serializing_if = "Option::is_none")]
    pub implementation_hash: Option<String>,
    #[serde(rename = "argsContractHash", skip_serializing_if = "Option::is_none")]
    pub args_contract_hash: Option<String>,
    /// The declared argument contract (LLP 0131) — a bounded declarative
    /// schema like the result contract, safe on the public projection.
    #[serde(rename = "argsContract", skip_serializing_if = "Option::is_none")]
    pub args_contract: Option<FunctionArgsContract>,
    // @ref LLP 0107#optimistic-mutation-projection — the browser verifies
    // the deployed descriptor as well as its hash before admitting an
    // optimistic reducer. Result contracts are bounded declarative schemas,
    // not executable handler source.
    #[serde(rename = "resultContract")]
    pub result_contract: FunctionResultContract,
    #[serde(rename = "resultContractHash", skip_serializing_if = "Option::is_none")]
    pub result_contract_hash: Option<String>,
    #[serde(rename = "requiredCapabilities")]
    pub required_capabilities: Vec<String>,
    #[serde(rename = "authRequirement")]
    pub auth_requirement: Option<AuthRequirement>,
    #[serde(rename = "authorityIndependent")]
    pub authority_independent: bool,
    /// LLP 0092 §0C.3 disclosure fact — already disclosed by the behavior it
    /// authorizes, so it rides the public projection.
    #[serde(rename = "publicInline", skip_serializing_if = "is_false")]
    pub public_inline: bool,
    /// LLP 0092 §0C.2 derived predicate — never authored; clients key the
    /// alias-key promotion check and token expectations on it.
    #[serde(rename = "rqsEligible", skip_serializing_if = "is_false")]
    pub rqs_eligible: bool,
    #[serde(rename = "authorityCreating", skip_serializing_if = "is_false")]
    pub authority_creating: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub retainable: bool,
    #[serde(
        rename = "authorizationDependence",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub authorization_dependence: Vec<AuthorizationInputDimension>,
    #[serde(rename = "syncabilityClass")]
    pub syncability_class: Option<String>,
    #[serde(rename = "readSetSummary")]
    pub read_set_summary: DependencySummary,
    #[serde(rename = "writeSetSummary")]
    pub write_set_summary: DependencySummary,
    #[serde(rename = "permissionEpochBumps")]
    pub permission_epoch_bumps: Vec<PermissionScopeExpr>,
    #[serde(rename = "bundleEntrypoint")]
    pub bundle_entrypoint: Option<String>,
    pub uses: Vec<String>,
    pub runtime: PublicFunctionRuntime,
}

/// Public projection of [`FunctionRuntime`]: the runtime kind (and the export
/// name for Ibex modules) without any executable body.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub enum PublicFunctionRuntime {
    HostPlan(PublicHostPlanKind),
    IbexModule(PublicIbexModule),
}

/// Which host-plan family a redacted `HostPlan` runtime executes.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub enum PublicHostPlanKind {
    Query,
    SearchQuery,
    JobStatusQuery,
    Mutation,
    Action,
    RelationalQuery,
    BoundedChildrenQuery,
    WriteWithActivity,
}

/// Public projection of [`IbexModule`]: the export name, never the source.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicIbexModule {
    pub export: String,
}

impl From<FunctionManifest> for PublicFunctionManifest {
    fn from(manifest: FunctionManifest) -> Self {
        // Exhaustive destructure: a new FunctionManifest field must be
        // classified here, not leak by default.
        let FunctionManifest {
            artifact_kind,
            schema_version,
            app_id,
            bundle_hash,
            inputs_hash,
            generated_at,
            unsupported_dependency_diagnostics,
            acknowledged_experimental_capabilities,
            functions,
            cron_jobs,
            config,
            // Maintained-projection plans are dropped from the public
            // projection like every HandlerPlan body: they are executable
            // maintenance declarations, not identity/compat facts. A typed
            // public summary can be added deliberately if inspection needs
            // one.
            projections: _,
        } = manifest;
        PublicFunctionManifest {
            artifact_kind,
            schema_version,
            app_id,
            bundle_hash,
            inputs_hash,
            generated_at,
            unsupported_dependency_diagnostics: unsupported_dependency_diagnostics
                .into_iter()
                .map(Into::into)
                .collect(),
            acknowledged_experimental_capabilities,
            functions: functions.into_iter().map(Into::into).collect(),
            cron_jobs: cron_jobs.into_iter().map(Into::into).collect(),
            config: config.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<CronJobDefinition> for PublicCronJobDefinition {
    fn from(job: CronJobDefinition) -> Self {
        let CronJobDefinition {
            name,
            schedule,
            action,
            enabled,
            activation,
            jitter_policy,
            overlap_policy,
            retry_policy,
            required_capabilities,
            target_wakeup,
            source_span: _,
        } = job;
        Self {
            name,
            schedule,
            action,
            enabled,
            activation,
            jitter_policy,
            overlap_policy,
            retry_policy,
            required_capabilities,
            target_wakeup,
        }
    }
}

impl From<ConfigEntryDefinition> for PublicConfigEntryDefinition {
    fn from(entry: ConfigEntryDefinition) -> Self {
        let ConfigEntryDefinition {
            name,
            description,
            purpose,
            secret,
            required,
            pool,
            probe,
            how_to_get,
            acquisition,
            default,
            source_span: _,
        } = entry;
        Self {
            name,
            description,
            purpose,
            secret,
            required,
            pool,
            probe,
            how_to_get,
            acquisition,
            default,
        }
    }
}

impl From<FunctionDefinition> for PublicFunctionDefinition {
    fn from(definition: FunctionDefinition) -> Self {
        // Derived before the destructure: the served-manifest `rqsEligible`
        // fact (LLP 0092 §0C.2) is computed, never carried.
        let rqs_eligible = rqs_eligible_digest_kind(&definition).is_some();
        let FunctionDefinition {
            id,
            name,
            exported_name,
            kind,
            source_span: _,
            handler_form,
            implementation_hash,
            args_contract_hash,
            args_contract,
            result_contract,
            result_contract_hash,
            required_capabilities,
            auth_requirement,
            authority_independent,
            public_inline,
            authority_creating,
            retainable,
            authorization_dependence,
            syncability_class,
            read_set_summary,
            write_set_summary,
            effect_ceiling: _,
            standard_pattern: _,
            permission_epoch_bumps,
            bundle_entrypoint,
            uses,
            runtime,
        } = definition;
        PublicFunctionDefinition {
            id,
            name,
            exported_name,
            kind,
            handler_form,
            implementation_hash,
            args_contract_hash,
            args_contract,
            result_contract,
            result_contract_hash,
            required_capabilities,
            auth_requirement,
            authority_independent,
            public_inline,
            rqs_eligible,
            authority_creating,
            retainable,
            authorization_dependence,
            syncability_class,
            read_set_summary,
            write_set_summary,
            permission_epoch_bumps,
            bundle_entrypoint,
            uses,
            runtime: runtime.into(),
        }
    }
}

impl From<FunctionRuntime> for PublicFunctionRuntime {
    fn from(runtime: FunctionRuntime) -> Self {
        match runtime {
            FunctionRuntime::HostPlan(plan) => PublicFunctionRuntime::HostPlan(match plan {
                HandlerPlan::Query(_) => PublicHostPlanKind::Query,
                HandlerPlan::SearchQuery(_) => PublicHostPlanKind::SearchQuery,
                HandlerPlan::JobStatusQuery(_) => PublicHostPlanKind::JobStatusQuery,
                HandlerPlan::Mutation(_) => PublicHostPlanKind::Mutation,
                HandlerPlan::Action(_) => PublicHostPlanKind::Action,
                // Plan-level kind only: per-row facts stay off the ordinary
                // inspection surface (LLP 0080 §7).
                HandlerPlan::RelationalQuery(_) => PublicHostPlanKind::RelationalQuery,
                HandlerPlan::BoundedChildrenQuery(_) => PublicHostPlanKind::BoundedChildrenQuery,
                HandlerPlan::WriteWithActivity(_) => PublicHostPlanKind::WriteWithActivity,
            }),
            // `source: _` is the redaction this projection exists for.
            FunctionRuntime::IbexModule(IbexModule { source: _, export }) => {
                PublicFunctionRuntime::IbexModule(PublicIbexModule { export })
            }
        }
    }
}

// Host plans are parsed once and then borrowed throughout admission/execution.
// Keeping the wire-shaped variants inline avoids an otherwise pervasive
// allocation contract in this public serde/schema carrier.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum HandlerPlan {
    Query(QueryPlan),
    /// Non-live portable indexed search. The operation uses the ordinary
    /// query envelope while storage projects SearchItemV1 values into rows.
    ///
    /// @ref LLP 0073#rust-owned-artifacts-and-operation-carrier — search is a
    /// Query-kind HostPlan and never gains live semantics by implication.
    SearchQuery(SearchQueryPlanV1),
    /// The generated declared job-status query (LLP 0121 option 3, decided in
    /// LLP 0070's first slice): a Rust-owned plan serving the privacy-bounded
    /// job lifecycle projection for one job id, live-capable through the
    /// ordinary subscription machinery — a declared operation with an
    /// ordinary contract, never an ambient system table.
    JobStatusQuery(JobStatusQueryPlanV1),
    Mutation(MutationPlan),
    Action(ActionPlan),
    // @ref LLP 0080#1-closed-relational-plan — closed bounded-join plan.
    /// The closed bounded-join profile. Callable and `live_replace`-capable
    /// only; targets that cannot execute it report a machine-readable
    /// capability gap before invocation.
    RelationalQuery(RelationalQueryPlan),
    /// Protected one-parent bounded child page.
    BoundedChildrenQuery(BoundedChildrenQueryPlan),
    /// Closed source/scope/activity transaction.
    WriteWithActivity(WriteWithActivityPlan),
}

/// The v1 job-status plan carries no authored parameters: the job id arrives
/// as the invocation's `jobId` argument, the projection shape is Rust-owned,
/// and observability scoping is the operation's own declared auth requirement
/// (knowledge of the opaque job id within that auth class; per-job row policy
/// is a later vocabulary — see the LLP 0070 amendment note).
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct JobStatusQueryPlanV1 {}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct ActionPlan {
    #[serde(default)]
    pub steps: Vec<ActionStep>,
    #[serde(default, rename = "returnValue", alias = "return_value")]
    pub return_value: Option<ActionReturnValue>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ActionStep {
    RunMutation {
        name: String,
        #[serde(default)]
        args: BTreeMap<String, ValueExpr>,
        #[serde(default, rename = "bindResultAs", alias = "bind_result_as")]
        bind_result_as: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ActionReturnValue {
    Literal(Value),
    Binding(String),
    LastMutationResult,
    ChangedCount,
}

/// @ref LLP 0028#cron-job-definition — generated function manifests carry
/// source-authored cron jobs beside query/mutation/action handlers.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronJobDefinition {
    pub name: String,
    pub schedule: CronSchedule,
    pub action: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub activation: CronActivationPolicy,
    #[serde(default, rename = "jitterPolicy", alias = "jitter_policy")]
    pub jitter_policy: CronJitterPolicy,
    #[serde(default, rename = "overlapPolicy", alias = "overlap_policy")]
    pub overlap_policy: CronOverlapPolicy,
    #[serde(default, rename = "retryPolicy", alias = "retry_policy")]
    pub retry_policy: CronRetryPolicy,
    #[serde(
        default,
        rename = "requiredCapabilities",
        alias = "required_capabilities"
    )]
    pub required_capabilities: Vec<String>,
    #[serde(default, rename = "targetWakeup", alias = "target_wakeup")]
    pub target_wakeup: Option<CronTargetWakeup>,
    #[serde(default, rename = "sourceSpan", alias = "source_span")]
    pub source_span: Option<SourceSpan>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronSchedule {
    #[serde(default, rename = "everyMs", alias = "every_ms")]
    pub every_ms: Option<u64>,
    #[serde(default)]
    pub cron: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronActivationPolicy {
    pub kind: CronActivationKind,
    #[serde(default, rename = "whileLive", alias = "while_live")]
    pub while_live: Vec<String>,
}

impl Default for CronActivationPolicy {
    fn default() -> Self {
        Self {
            kind: CronActivationKind::Always,
            while_live: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CronActivationKind {
    Always,
    WhileLive,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronJitterPolicy {
    pub enabled: bool,
    #[serde(rename = "maxOffsetMs", alias = "max_offset_ms")]
    pub max_offset_ms: u64,
}

impl Default for CronJitterPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            max_offset_ms: 0,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CronOverlapPolicy {
    #[default]
    NoOverlap,
    Allow,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronRetryPolicy {
    pub mode: CronRetryMode,
}

impl Default for CronRetryPolicy {
    fn default() -> Self {
        Self {
            mode: CronRetryMode::NextTick,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CronRetryMode {
    NextTick,
    Backoff,
}

/// @ref LLP 0036#declared-configuration-in-the-manifest — one declared config
/// entry: names, purposes, and acquisition metadata are app source (public by
/// construction); values never appear in any manifest.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct ConfigEntryDefinition {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    /// Default **true**: misclassification fails safe — forgetting the flag
    /// makes a value more protected, never less (LLP 0036 D5).
    #[serde(default = "default_true")]
    pub secret: bool,
    #[serde(default = "default_true")]
    pub required: bool,
    /// The entry holds an ordered pool of values rotated across invocations.
    #[serde(default)]
    pub pool: bool,
    /// Name of a declared action that test-calls the value (`config.verify`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub probe: Option<String>,
    #[serde(
        default,
        rename = "howToGet",
        alias = "how_to_get",
        skip_serializing_if = "Option::is_none"
    )]
    pub how_to_get: Option<String>,
    /// Structured, agent-readable acquisition metadata (LLP 0036 D6). The host
    /// carries it verbatim to status/wizard consumers; v1 does not interpret it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acquisition: Option<Value>,
    /// Non-secret entries only; carried for forward compatibility. v1 rejects
    /// non-secret entries at manifest validation, so this is always absent in
    /// an accepted manifest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
    #[serde(default, rename = "sourceSpan", alias = "source_span")]
    pub source_span: Option<SourceSpan>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronTargetWakeup {
    pub kind: CronTargetWakeupKind,
    #[serde(default, rename = "needsDurableRunner", alias = "needs_durable_runner")]
    pub needs_durable_runner: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CronTargetWakeupKind {
    IntervalMs,
    CronExpression,
    DynamicAlarm,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct QueryPlan {
    pub table: String,
    #[serde(default)]
    pub filters: Vec<FilterExpr>,
    /// Declaration-bound membership semi-joins ANDed onto the field filters —
    /// the first structured-filter IR nodes past single-table filters. Empty
    /// for an ordinary single-table query. Each entry gates the query rows by a
    /// non-recursive membership existence check and contributes an *ordinary*
    /// snapshot-bound capture (never the legacy `Permission` kind) so the
    /// matcher and commit-time read-set validation both wake on membership
    /// writes — including the empty-to-visible direction.
    ///
    /// @ref LLP 0056#what-exists-what-this-adds — the declaration-bound
    ///   membership predicate node, the first step past single-table filters.
    #[serde(
        default,
        rename = "membershipFilters",
        alias = "membership_filters",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub membership_filters: Vec<MembershipPredicate>,
    #[serde(default)]
    pub order: Vec<OrderExpr>,
    pub limit: Option<usize>,
    pub indexed_by: Option<String>,
}

/// A declaration-bound membership semi-join: the structured-filter IR node the
/// `eventMembers.memberOf(resourceRef)` / `eventMembers.hasRole(resourceRef,
/// …)` rule helpers lower to. There is deliberately **no** global
/// `memberOf`/`hasRole` resolver — two declarations can target the same
/// resource type, and that ambiguity is an authorization bug factory
/// (LLP 0056 §Rule helpers), so every predicate names its declaration.
///
/// Semantics: the predicate holds for the effective principal iff a membership
/// row exists in the bound declaration whose `principal` axis is that
/// principal, whose `resource` axis equals the resolved `resource` reference,
/// and whose `role` is one of the effective roles. A null effective principal
/// (unauthenticated) matches no rows — fail-closed.
///
/// The node is **authoritative-only**: it is evaluated by a non-recursive
/// storage semi-join that deliberately bypasses the membership table's own
/// row-visibility rules (a locked-down roster must not break role evaluation
/// for guests), never by the pure/optimistic `ValueExpr` evaluator — which has
/// no storage and no business consulting membership facts.
///
/// @ref LLP 0056#rule-helpers — declaration-bound; `memberOf` excludes
///   `pendingRoles`; `hasRole` names roles explicitly; `resourceRef` is a row
///   field of the queried table or a query argument of the declared resource
///   type.
/// @ref LLP 0053#agent-auth-protected-query-inputs-amended-2026-07-14-eng-24906 —
///   admitted `DatabaseCaptured` declarative expression kind, snapshot-bound,
///   with the pinned empty-result capture.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MembershipPredicate {
    /// The stable declaration id this predicate binds to
    /// (`MembershipManifest::effective_id`).
    pub declaration: String,
    /// Where the `resource` axis value is read from.
    pub resource: MembershipResourceRef,
    /// The satisfying roles. `None` is `memberOf` — every **non-pending** role
    /// of the declaration. `Some(list)` is `hasRole` with exactly the named
    /// roles (which may name pending roles explicitly).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roles: Option<Vec<String>>,
}

/// Where a [`MembershipPredicate`] reads its `resource` axis value from. Both
/// forms are analyzable at subscribe time; anything else — a computed
/// expression, a different resource type, a join through a third table — is a
/// load-time error (LLP 0056 §Rule helpers).
///
/// @ref LLP 0056#rule-helpers — the two analyzable resource-reference forms.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum MembershipResourceRef {
    /// A column of the queried (primary) table whose type is the declared
    /// resource reference. The per-row semi-join; v1 captures a **conservative
    /// table-level** dependency for it (coarse wake = re-query cost; the
    /// reverse choice would be a correctness loss).
    RowField(String),
    /// A query argument (dotted path) of the declared resource type. The
    /// resource is fixed for the whole query, so v1 captures the fine-grained
    /// `(principal, resource)` index-range dependency, including the
    /// empty-result form.
    Arg {
        /// Dotted query-argument path evaluated at invocation time.
        path: String,
        /// Nominal resource type proven by codegen. Resource-scoped
        /// declarations require their exact `resourceTable`; app-scoped
        /// declarations require `null` and the closed synthetic path. Carrying
        /// this provenance in the installed artifact keeps a hand-written
        /// manifest from silently degrading an `Id<table>` to a bare string.
        #[serde(rename = "resourceTable", alias = "resource_table")]
        resource_table: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct FilterExpr {
    pub field: String,
    pub op: FilterOp,
    pub value: ValueExpr,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum FilterOp {
    Eq,
    In,
    Lt,
    Lte,
    Gt,
    Gte,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct OrderExpr {
    pub field: String,
    pub direction: OrderDirection,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum OrderDirection {
    Asc,
    Desc,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct MutationPlan {
    #[serde(default)]
    pub steps: Vec<MutationStep>,
    pub return_value: Option<ReturnValue>,
}

/// The data-tier v1 mutation step set (LLP 0051 D2). Two families:
/// unconditional writes (`Insert`/`Patch`/`Delete`, the original plan forms)
/// and the v1 extension — reads and guards (`Get`/`Guard`/`Let`, evaluated
/// inside the commit transaction with reads captured server-side) plus the
/// two closed set-oriented forms (`DeleteWhere`/`InsertEach`). General
/// iteration, recursion, and data-dependent cross-step control flow stay out
/// of the profile permanently.
// @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation —
//   the v1 step set. (Plain comment: doc text flows into generated schemas.)
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum MutationStep {
    Insert {
        table: String,
        values: BTreeMap<String, ValueExpr>,
        bind_id_as: Option<String>,
    },
    Patch {
        table: String,
        id: ValueExpr,
        values: BTreeMap<String, ValueExpr>,
    },
    Delete {
        table: String,
        id: ValueExpr,
    },
    /// Point read by id, captured into the read-set. Missing is data, not
    /// failure: with `else_error` unset the binding is null (composes with
    /// `coalesce` for the defaulting idiom); with `else_error` set the
    /// mutation fails with that typed code, mirroring `Guard`.
    Get {
        table: String,
        id: ValueExpr,
        bind_as: String,
        else_error: Option<String>,
    },
    /// Truthiness check; failure is the author-supplied typed error code.
    Guard {
        cond: ValueExpr,
        else_error: String,
    },
    /// Host-owned, transaction-local relationship assertion inserted only by
    /// `write-with-activity.v1`. It checks the selected row's required foreign
    /// key and protected stamp against the current active parent incarnation;
    /// missing, cross-scope, and stale-orphan rows collapse to `else_error`.
    AssertCurrentRelation {
        table: String,
        id: ValueExpr,
        scope_table: String,
        scope_id: ValueExpr,
        foreign_key_field: String,
        incarnation_field: String,
        else_error: String,
    },
    /// Bind a computed expression for later steps.
    Let {
        bind_as: String,
        expr: ValueExpr,
    },
    /// Set-oriented delete over one table; the empty filter clears the table.
    /// No more expressive than SQL `DELETE … WHERE`.
    DeleteWhere {
        table: String,
        filter: Vec<FilterExpr>,
    },
    /// One insert per element of an argument-supplied array — a bounded
    /// comprehension (fan-out capped by `MAX_INSERT_EACH_FANOUT`), not a
    /// loop construct. Each value is a `ValueExpr` over `item_as`.
    InsertEach {
        table: String,
        source: ValueExpr,
        item_as: String,
        values: BTreeMap<String, ValueExpr>,
    },
    /// Host-owned assertion inserted only by `write-with-activity.v1`.
    /// Exactly one matching changed source row must already exist in the
    /// provisional transaction; missing/no-op/wrong-source execution refuses
    /// before the activity insert and settlement.
    AssertSourceChanged {
        table: String,
        id: ValueExpr,
        operation: WriteWithActivitySourceOperation,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ReturnValue {
    Literal(Value),
    Binding(String),
    Document {
        table: String,
        id: ValueExpr,
    },
    ChangedCount,
    /// Expression-valued return (with the `Record` constructor this covers
    /// the computed summaries real feed mutations return — LLP 0051 D2).
    Expr(ValueExpr),
}

/// The data-tier v1 expression profile: a closed set — no arrows, no
/// closures, no free calls, no JS method binding — so every evaluator in
/// every language is finite work. Evaluation semantics live in one shared
/// evaluator (`crate::value_expr`) and are pinned by the data-tier corpus.
// @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation —
//   the closed v1 expression profile. (Plain comment: doc text flows into
//   generated schemas.)
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ValueExpr {
    /// Strict arg lookup by dotted path; a missing arg is a typed error.
    Arg(String),
    /// The whole args object — the null-safe base for optional-arg access
    /// via `Field` (missing keys propagate null instead of failing).
    Args,
    AuthUserId,
    /// Effective principal kind in the sealed authorization projection.
    AuthKind,
    /// Actor kind for delegated authority; null for direct and autonomous use.
    AuthActorKind,
    /// Total activity-provenance projection: `human` for sessions and `agent`
    /// for delegated service authority. Unsupported authority classes leave
    /// it absent and the write-with-activity profile refuses.
    AuthActivityActorKind,
    AuthActorUserId,
    AuthGrantId,
    /// Digest of the server-constructed canonical client-mutation identity.
    ClientMutationDigest,
    /// True only when an actor is exercising authority for another principal.
    AuthIsDelegated,
    Binding(String),
    Literal(Value),
    RuntimeId,
    RuntimeNow,
    /// Null-propagating access by arbitrary string key (hyphenated JSON keys
    /// are first-class; settles the IR half of Exact LLP 0329 EQ8).
    Field {
        base: Box<ValueExpr>,
        key: String,
    },
    Binary {
        op: BinaryOp,
        left: Box<ValueExpr>,
        right: Box<ValueExpr>,
    },
    Unary {
        op: UnaryOp,
        expr: Box<ValueExpr>,
    },
    If {
        cond: Box<ValueExpr>,
        then: Box<ValueExpr>,
        #[serde(rename = "else")]
        r#else: Box<ValueExpr>,
    },
    /// String-template lowering: concatenation of stringified parts.
    Concat(Vec<ValueExpr>),
    /// Call into the pinned function library (`value_expr::PINNED_FUNCTIONS`);
    /// anything else fails closed with a typed rejection.
    Call {
        func: String,
        args: Vec<ValueExpr>,
    },
    /// Closed record constructor — the same shape as `Insert`'s values map,
    /// evaluated by the same machinery.
    Record {
        fields: BTreeMap<String, ValueExpr>,
    },
    /// A declaration-bound membership semi-join as a composable boolean
    /// expression kind — the form the `eventMembers.memberOf(...)` /
    /// `hasRole(...)` rule helpers and the `ctx.permissions.<decl>.requireRole`
    /// twin lower to (LLP 0053 §Agent-auth item 1 admits it as a new
    /// declarative IR expression kind).
    ///
    /// It is **authoritative-only**: unlike every other variant it cannot be
    /// answered by the pure `ValueExpr` evaluator, because deciding it requires
    /// a non-recursive storage semi-join over the membership table (bypassing
    /// that table's row-visibility rules). The pure evaluator therefore refuses
    /// it (`SNAPBACK_VALUE_EXPR_AUTHORITATIVE_ONLY`), the query path answers it
    /// through `QueryPlan::membership_filters` / the `ctx.permissions` read, and
    /// the derived optimistic overlay refuses rather than mirrors it — so a
    /// role check is server-decided, never optimistically forged client-side.
    ///
    /// @ref LLP 0056#rule-helpers — the declaration-bound membership predicate.
    MembershipExists(Box<MembershipPredicate>),
}

impl ValueExpr {
    fn uses_runtime_id(&self) -> bool {
        match self {
            Self::RuntimeId => true,
            Self::Field { base, .. } => base.uses_runtime_id(),
            Self::Binary { left, right, .. } => left.uses_runtime_id() || right.uses_runtime_id(),
            Self::Unary { expr, .. } => expr.uses_runtime_id(),
            Self::If { cond, then, r#else } => {
                cond.uses_runtime_id() || then.uses_runtime_id() || r#else.uses_runtime_id()
            }
            Self::Concat(values) | Self::Call { args: values, .. } => {
                values.iter().any(Self::uses_runtime_id)
            }
            Self::Record { fields } => fields.values().any(Self::uses_runtime_id),
            Self::Arg(_)
            | Self::Args
            | Self::AuthUserId
            | Self::AuthKind
            | Self::AuthActorKind
            | Self::AuthActivityActorKind
            | Self::AuthActorUserId
            | Self::AuthGrantId
            | Self::ClientMutationDigest
            | Self::AuthIsDelegated
            | Self::Binding(_)
            | Self::Literal(_)
            | Self::RuntimeNow
            | Self::MembershipExists(_) => false,
        }
    }

    fn uses_authoritative_only(&self) -> bool {
        match self {
            Self::MembershipExists(_) => true,
            Self::Field { base, .. } => base.uses_authoritative_only(),
            Self::Binary { left, right, .. } => {
                left.uses_authoritative_only() || right.uses_authoritative_only()
            }
            Self::Unary { expr, .. } => expr.uses_authoritative_only(),
            Self::If { cond, then, r#else } => {
                cond.uses_authoritative_only()
                    || then.uses_authoritative_only()
                    || r#else.uses_authoritative_only()
            }
            Self::Concat(values) | Self::Call { args: values, .. } => {
                values.iter().any(Self::uses_authoritative_only)
            }
            Self::Record { fields } => fields.values().any(Self::uses_authoritative_only),
            Self::Arg(_)
            | Self::Args
            | Self::AuthUserId
            | Self::AuthKind
            | Self::AuthActorKind
            | Self::AuthActivityActorKind
            | Self::AuthActorUserId
            | Self::AuthGrantId
            | Self::ClientMutationDigest
            | Self::AuthIsDelegated
            | Self::Binding(_)
            | Self::Literal(_)
            | Self::RuntimeNow
            | Self::RuntimeId => false,
        }
    }

    pub(crate) fn uses_actor_projection(&self) -> bool {
        match self {
            Self::AuthActorKind
            | Self::AuthActivityActorKind
            | Self::AuthActorUserId
            | Self::AuthGrantId
            | Self::AuthIsDelegated => true,
            Self::Field { base, .. } => base.uses_actor_projection(),
            Self::Binary { left, right, .. } => {
                left.uses_actor_projection() || right.uses_actor_projection()
            }
            Self::Unary { expr, .. } => expr.uses_actor_projection(),
            Self::If { cond, then, r#else } => {
                cond.uses_actor_projection()
                    || then.uses_actor_projection()
                    || r#else.uses_actor_projection()
            }
            Self::Concat(values) | Self::Call { args: values, .. } => {
                values.iter().any(Self::uses_actor_projection)
            }
            Self::Record { fields } => fields.values().any(Self::uses_actor_projection),
            Self::Arg(_)
            | Self::Args
            | Self::AuthUserId
            | Self::AuthKind
            | Self::Binding(_)
            | Self::Literal(_)
            | Self::ClientMutationDigest
            | Self::RuntimeId
            | Self::RuntimeNow
            | Self::MembershipExists(_) => false,
        }
    }

    pub(crate) fn uses_runtime_intrinsic(&self) -> bool {
        match self {
            Self::RuntimeId | Self::RuntimeNow | Self::ClientMutationDigest => true,
            Self::Field { base, .. } => base.uses_runtime_intrinsic(),
            Self::Binary { left, right, .. } => {
                left.uses_runtime_intrinsic() || right.uses_runtime_intrinsic()
            }
            Self::Unary { expr, .. } => expr.uses_runtime_intrinsic(),
            Self::If { cond, then, r#else } => {
                cond.uses_runtime_intrinsic()
                    || then.uses_runtime_intrinsic()
                    || r#else.uses_runtime_intrinsic()
            }
            Self::Concat(values) | Self::Call { args: values, .. } => {
                values.iter().any(Self::uses_runtime_intrinsic)
            }
            Self::Record { fields } => fields.values().any(Self::uses_runtime_intrinsic),
            Self::Arg(_)
            | Self::Args
            | Self::AuthUserId
            | Self::AuthKind
            | Self::AuthActorKind
            | Self::AuthActivityActorKind
            | Self::AuthActorUserId
            | Self::AuthGrantId
            | Self::AuthIsDelegated
            | Self::Binding(_)
            | Self::Literal(_)
            | Self::MembershipExists(_) => false,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum BinaryOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Eq,
    Ne,
    Lt,
    Lte,
    Gt,
    Gte,
    And,
    Or,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum UnaryOp {
    Not,
    Neg,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct AuthInput {
    pub principal: Option<String>,
    pub session_id: Option<String>,
    pub user_id: Option<String>,
    /// Server-owned declarative-authorization facts. They never deserialize
    /// from or serialize onto the legacy handler input wire.
    #[serde(skip)]
    #[schemars(skip)]
    #[doc(hidden)]
    pub authorization_kind: Option<String>,
    #[serde(skip)]
    #[schemars(skip)]
    #[doc(hidden)]
    pub authorization_actor_kind: Option<String>,
    #[serde(skip)]
    #[schemars(skip)]
    #[doc(hidden)]
    pub authorization_activity_actor_kind: Option<String>,
    #[serde(skip)]
    #[schemars(skip)]
    #[doc(hidden)]
    pub authorization_actor_user_id: Option<String>,
    #[serde(skip)]
    #[schemars(skip)]
    #[doc(hidden)]
    pub authorization_grant_id: Option<String>,
    #[serde(skip)]
    #[schemars(skip)]
    #[doc(hidden)]
    pub client_mutation_digest: Option<String>,
    #[serde(skip)]
    #[schemars(skip)]
    #[doc(hidden)]
    pub authorization_is_delegated: bool,
}

impl AuthInput {
    pub(crate) fn with_authorization_projection(
        mut self,
        kind: Option<&str>,
        actor_kind: Option<&str>,
        is_delegated: bool,
    ) -> Self {
        self.authorization_kind = kind.map(str::to_owned);
        self.authorization_actor_kind = actor_kind.map(str::to_owned);
        self.authorization_is_delegated = is_delegated;
        self
    }

    pub(crate) fn direct_authorization_baseline(&self) -> Option<Self> {
        self.authorization_is_delegated.then(|| {
            let mut direct = self.clone();
            direct.authorization_actor_kind = None;
            direct.authorization_is_delegated = false;
            direct
        })
    }

    pub(crate) fn with_activity_provenance(
        mut self,
        actor_user_id: Option<&str>,
        actor_kind: Option<&str>,
        grant_id: Option<&str>,
    ) -> Self {
        self.authorization_actor_user_id = actor_user_id.map(str::to_owned);
        self.authorization_activity_actor_kind = actor_kind.map(str::to_owned);
        self.authorization_grant_id = grant_id.map(str::to_owned);
        self
    }

    pub(crate) fn with_client_mutation_digest(mut self, digest: Option<&str>) -> Self {
        self.client_mutation_digest = digest.map(str::to_owned);
        self
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct HandlerInput {
    #[serde(default)]
    pub args: Value,
    #[serde(default)]
    pub auth: AuthInput,
    #[serde(default)]
    pub read_set: Vec<ReadDependency>,
    /// Opaque adapter-stitched correlation (LLP 0034 §3.2, ENG-22478): the
    /// Exact adapter's join keys (`actionInvocationId`, `optimisticWaveId`,
    /// `rootId`, `bindingIds`) live inside. The provider echoes it verbatim
    /// on receipts and never interprets it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation: Option<Value>,
    /// Replay ledger (LLP 0051 D1): when present, the invocation runs in
    /// REPLAY mode — `ctx.runtime.now()` answers `ledger.now` and every
    /// host-generated id (`ctx.runtime.id()` and `ctx.db.insert` row ids)
    /// consumes `ledger.ids` in order. Consuming past the end is a typed
    /// divergence error. Additive: absent means record mode, today's
    /// behavior. Queries and mutations only; actions never carry one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ctx_ledger: Option<CtxAnswerLedger>,
}

/// Opaque server-issued consistency descriptor for one queued mutation.
/// Possession grants no authority; the invocation gate first resolves a live
/// credential and only then compares this value with its prepared authority.
///
/// @ref LLP 0039#replay-parity-and-the-authority-instance-id — this is a
///   dedicated MutationRequest channel, never a ctx-answer-ledger member.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityDescriptor {
    pub descriptor_version: u32,
    #[schemars(extend("pattern" = "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"))]
    pub authority_instance_id: String,
    #[schemars(range(max = AUTHORITY_DESCRIPTOR_MAX_SESSION_GENERATION))]
    pub session_generation: u64,
}

/// Highest generation that round-trips exactly through JavaScript's number
/// representation and every generated Snapback client.
pub const AUTHORITY_DESCRIPTOR_MAX_SESSION_GENERATION: u64 = 9_007_199_254_740_991;

/// Client-visible mutation request envelope. The idempotency key is mutation
/// only: queries remain server-authoritative reads and are never queued or
/// ledgered as writes (LLP 0043 M1/M2).
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct MutationRequest {
    #[serde(flatten)]
    pub input: HandlerInput,
    /// Durable client-generated identity for exactly-once reconnect replay.
    /// Reusing an id with another function or auth context is rejected.
    #[serde(
        default,
        rename = "clientMutationId",
        alias = "client_mutation_id",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(
        length(min = 1, max = REPLAY_OPAQUE_ID_MAX_BYTES),
        pattern(REPLAY_OPAQUE_ID_PATTERN)
    )]
    pub client_mutation_id: Option<String>,
    /// Required whenever `clientMutationId` is present after authority
    /// descriptor protocol v1 is negotiated. It is intentionally outside the
    /// flattened HandlerInput/ctx ledger so client-supplied replay answers can
    /// never become execution authority.
    #[serde(
        default,
        rename = "authorityDescriptor",
        alias = "authority_descriptor",
        skip_serializing_if = "Option::is_none"
    )]
    pub authority_descriptor: Option<AuthorityDescriptor>,
    /// Results the client has durably consumed and removed from its replay
    /// queue. The server may reclaim these settlement payloads only after this
    /// explicit acknowledgement; age alone is not proof that an offline
    /// client cannot redeliver the id.
    #[serde(
        default,
        rename = "acknowledgedClientMutationIds",
        alias = "acknowledged_client_mutation_ids",
        skip_serializing_if = "Vec::is_empty"
    )]
    #[schemars(
        length(max = CLIENT_MUTATION_ACK_MAX_IDS),
        inner(
            length(min = 1, max = REPLAY_OPAQUE_ID_MAX_BYTES),
            pattern(REPLAY_OPAQUE_ID_PATTERN)
        )
    )]
    pub acknowledged_client_mutation_ids: Vec<String>,
}

/// Standalone authenticated settlement acknowledgement. It lives outside the
/// `/mutation/{name}` namespace so an application may still declare a
/// mutation named `acknowledge` (or `ack`) without a route collision.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutationAcknowledgementRequest {
    pub auth: AuthInput,
    #[schemars(
        length(max = CLIENT_MUTATION_ACK_MAX_IDS),
        inner(
            length(min = 1, max = REPLAY_OPAQUE_ID_MAX_BYTES),
            pattern(REPLAY_OPAQUE_ID_PATTERN)
        )
    )]
    pub client_mutation_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutationAcknowledgementResponse {
    pub acknowledged: u64,
}

/// The ctx-answer ledger (LLP 0051 D1): the ordered answers the deterministic
/// ctx surface gave during one invocation. Record mode produces it; replay
/// mode consumes it. Reads are never ledgered — `ctx.db` reads always
/// re-evaluate against the executing tier's current view; the ledger pins
/// *answers* only. This is LLP 0043 M2's captured replay environment as a
/// defined channel: LLP 0008 pins the client wire to exactly
/// `{generatedIds, now}`; the auth fingerprint is server-retained and never
/// crosses the client wire.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CtxAnswerLedger {
    /// Ledger format version, versioned alongside the shared data-tier
    /// profile (LLP 0051 D5) so pre-extension ledgers stay replayable.
    #[serde(default = "ctx_ledger_version")]
    pub version: u32,
    /// Every host-generated id, in answer order (LLP 0008's `generatedIds`):
    /// `ctx.runtime.id()` answers and `ctx.db.insert` row-id generation share
    /// one ordered sequence.
    #[serde(default)]
    #[schemars(
        length(max = CTX_ANSWER_LEDGER_MAX_IDS),
        inner(
            length(min = 1, max = REPLAY_OPAQUE_ID_MAX_BYTES),
            pattern(REPLAY_OPAQUE_ID_PATTERN)
        )
    )]
    pub ids: Vec<String>,
    /// The frozen invocation clock every `ctx.runtime.now()` answered with.
    #[serde(default)]
    #[schemars(range(max = PORTABLE_TIMESTAMP_MAX_MS))]
    pub now: u64,
    /// Fingerprint of the resolved auth context the handler observed
    /// (LLP 0043 §Auth posture). Checked at replay when present: a mismatch
    /// surfaces `SNAPBACK_AUTH_STALE_RESULT` rather than replaying under new
    /// authority. Server-retained (D1 wire split) — record-mode outputs leave
    /// it unset on client-bound surfaces.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_fingerprint: Option<String>,
}

pub(crate) fn ctx_ledger_version() -> u32 {
    CTX_ANSWER_LEDGER_VERSION
}

/// The current ctx-answer ledger format version (LLP 0051 D1/D5).
pub const CTX_ANSWER_LEDGER_VERSION: u32 = 1;

/// Declared invocation-scoped limit row (LLP 0047 §Limits / LLP 0051 D1
/// ledger mechanics): the maximum number of host-generated ids one
/// invocation may record. A handler that calls `ctx.runtime.id()` in a loop
/// gets a typed error (`SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED`), not an
/// unbounded artifact.
pub const CTX_ANSWER_LEDGER_MAX_IDS: usize = 1024;

/// Largest exact non-negative integer carried by the plain-JSON portable
/// profile. Timestamps share the same bound as declared Integer values: every
/// accepted millisecond value must survive JavaScript, SQLite, and hosted
/// targets without aliasing or a signed-storage wrap.
///
/// @ref LLP 0007#data-model — the v0 JSON profile is JavaScript-safe-range
/// bounded on every target.
pub const PORTABLE_TIMESTAMP_MAX_MS: u64 = 9_007_199_254_740_991;

/// Largest exact global storage version in the plain-JSON v0 profile. Commit
/// versions are client cursors and row system fields, so they share the same
/// cross-target integer domain rather than SQLite's wider signed range.
///
/// @ref LLP 0007#data-model — `_version` must round-trip without JavaScript
/// aliasing on every supported target.
pub const PORTABLE_STORAGE_VERSION_MAX: u64 = 9_007_199_254_740_991;

/// Shared wire/storage bound for client mutation ids and captured generated
/// ids. The alphabet makes JSON Schema `maxLength` byte-equivalent to the Rust
/// runtime check and keeps ids safe as opaque SQLite/document keys.
pub const REPLAY_OPAQUE_ID_MAX_BYTES: usize = 256;
pub const REPLAY_OPAQUE_ID_PATTERN: &str = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$";

/// Validate a runtime-owned timestamp before an evaluator or storage adapter
/// can observe it. Keeping this at the shared artifact boundary prevents the
/// HostPlan and Ibex paths from accepting different timestamp domains.
pub fn validate_portable_timestamp_millis(value: u64) -> SnapbackResult<()> {
    if value <= PORTABLE_TIMESTAMP_MAX_MS {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_TIMESTAMP_OUT_OF_RANGE",
        "runtime",
        format!(
            "runtime timestamp {value} is outside the portable millisecond range (maximum: {PORTABLE_TIMESTAMP_MAX_MS})"
        ),
    )
    .with_details(serde_json::json!({
        "value": value,
        "maximum": PORTABLE_TIMESTAMP_MAX_MS,
        "unit": "milliseconds",
    })))
}

/// Validate the complete replay ledger once, before either evaluator begins.
/// The local HostPlan and Ibex implementations deliberately share this gate so
/// format, ids, authority, and time cannot drift across execution tiers.
pub fn validate_ctx_answer_ledger(
    input: &HandlerInput,
) -> SnapbackResult<Option<&CtxAnswerLedger>> {
    let Some(ledger) = input.ctx_ledger.as_ref() else {
        return Ok(None);
    };
    if ledger.version != CTX_ANSWER_LEDGER_VERSION {
        return Err(SnapbackError::error(
            "SNAPBACK_CTX_LEDGER_VERSION_UNSUPPORTED",
            "runtime",
            format!(
                "ctx-answer ledger version {} is not supported (current: {})",
                ledger.version, CTX_ANSWER_LEDGER_VERSION
            ),
        ));
    }
    if ledger.ids.len() > CTX_ANSWER_LEDGER_MAX_IDS {
        return Err(SnapbackError::error(
            "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED",
            "runtime",
            format!(
                "ctx-answer ledger contains {} ids, past the declared bound ({})",
                ledger.ids.len(),
                CTX_ANSWER_LEDGER_MAX_IDS
            ),
        ));
    }
    if let Some((index, _)) = ledger
        .ids
        .iter()
        .enumerate()
        .find(|(_, id)| !replay_opaque_id_is_valid(id))
    {
        return Err(SnapbackError::error(
            "SNAPBACK_CTX_LEDGER_ID_INVALID",
            "runtime",
            format!("ctx-answer ledger id at index {index} is not a valid opaque replay id"),
        ));
    }
    validate_portable_timestamp_millis(ledger.now)?;
    if let Some(recorded) = ledger.auth_fingerprint.as_ref()
        && *recorded != auth_fingerprint(&input.auth)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_STALE_RESULT",
            "runtime",
            "ctx-answer ledger was recorded under a different auth context; refusing to replay under new authority (LLP 0043 §Auth posture)",
        ));
    }
    Ok(Some(ledger))
}

pub fn replay_opaque_id_is_valid(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > REPLAY_OPAQUE_ID_MAX_BYTES {
        return false;
    }
    bytes[0].is_ascii_alphanumeric()
        && bytes[1..]
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

/// Stable cross-language fingerprint of the resolved auth context (LLP 0043
/// §Auth posture). Each optional field is tagged, and each present UTF-8 value
/// is length-delimited before SHA-256, so absent/empty values and adjacent
/// fields cannot collide. This is still a staleness/ownership guard rather
/// than authorization: the server re-evaluates authorization at commit
/// regardless (LLP 0051 D1).
pub fn auth_fingerprint(auth: &AuthInput) -> String {
    let mut hash = Sha256::new();
    hash.update(b"snapback-auth-fingerprint-v1\0");
    for field in [&auth.principal, &auth.session_id, &auth.user_id] {
        match field {
            Some(value) => {
                hash.update([1]);
                hash.update((value.len() as u64).to_be_bytes());
                hash.update(value.as_bytes());
            }
            None => hash.update([0]),
        }
    }
    format!("sha256:{:x}", hash.finalize())
}

/// Fingerprint emitted before the SHA-256 transition. Kept only as a deletion
/// alias: a current client may ACK or an administrator may purge its legacy
/// settlement, but replay never rebinds a 64-bit alias to a new SHA identity
/// because the old row lacks enough canonical auth material to disambiguate a
/// collision safely.
pub fn legacy_auth_fingerprint(auth: &AuthInput) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut eat = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    for field in [&auth.principal, &auth.session_id, &auth.user_id] {
        match field {
            Some(value) => {
                eat(&[1]);
                eat(value.as_bytes());
            }
            None => eat(&[0]),
        }
        eat(&[0xff]);
    }
    format!("fnv1a:{hash:016x}")
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct ReadDependency {
    pub table: String,
    pub id: String,
    #[schemars(range(max = PORTABLE_STORAGE_VERSION_MAX))]
    pub version: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct QueryOutput {
    #[schemars(range(max = PORTABLE_STORAGE_VERSION_MAX))]
    pub version: u64,
    pub rows: Vec<Value>,
    /// Relational continuation cursor (LLP 0080 §2): present exactly when a
    /// `root-window-v1` page consumed its full `take` of authorized roots.
    /// Opaque and versioned; presenting it back as the `cursor` argument
    /// resumes from the last consumed root. Absent for every non-relational
    /// query and for terminal pages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct MutationOutput {
    #[schemars(range(max = PORTABLE_STORAGE_VERSION_MAX))]
    pub version: u64,
    pub changed_count: usize,
    pub result: Value,
    /// The recorded ctx-answer ledger for this invocation (LLP 0051 D1).
    /// Present for mutations in both executable tiers (record mode records;
    /// replay mode echoes the consumed ledger). HostPlan and Ibex share the
    /// same bounded id/clock contract so queued replay is tier-neutral. The
    /// `auth_fingerprint` member stays unset here — that channel is
    /// server-retained (D1 wire split).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ctx_ledger: Option<CtxAnswerLedger>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct SeedData {
    #[serde(default)]
    pub tables: BTreeMap<String, Vec<Map<String, Value>>>,
}

/// A schema/function artifact version understood by the auth-aware receiver.
/// Capability manifests report the dimensions separately for discovery, but
/// [`SupportedArtifactAuthPair`] remains the actual compatibility authority.
#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
pub enum ArtifactVersion {
    #[serde(rename = "snapback.v0")]
    V0,
    #[serde(rename = "snapback.v1")]
    V1,
}

impl ArtifactVersion {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::V0 => SNAPBACK_SCHEMA_VERSION,
            Self::V1 => SNAPBACK_SESSIONS_SCHEMA_VERSION,
        }
    }
}

/// One explicitly supported schema/function-version and auth-mode tuple.
/// Separate version/mode arrays are dimension reports and never imply a
/// Cartesian-product authorization.
///
/// @ref LLP 0058#the-two-admissible-tuples — exactly v0+dev and v1+sessions.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SupportedArtifactAuthPair {
    #[serde(rename = "schemaVersion", alias = "schema_version")]
    pub schema_version: ArtifactVersion,
    #[serde(rename = "authMode", alias = "auth_mode")]
    pub auth_mode: AuthMode,
}

/// The exact target-capability vocabulary understood by paired-v1 manifests.
/// App artifacts retain string fields for v0 compatibility; every v1 string
/// is parsed through this enum before target support is consulted.
///
/// @ref LLP 0058#the-two-admissible-tuples — the v1 registry is closed and
/// LLP 0076 adds the ninth id with an exact positive runtime predicate.
#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
pub enum TargetCapabilityId {
    #[serde(rename = "auth.sessions.v1")]
    AuthSessionsV1,
    #[serde(rename = "bounded_response_stream_v1")]
    BoundedResponseStreamV1,
    #[serde(rename = "bounded_children_v1")]
    BoundedChildrenV1,
    #[serde(rename = "cron")]
    Cron,
    #[serde(rename = "cron_action_run_mutation")]
    CronActionRunMutation,
    #[serde(rename = "host_plan_runtime")]
    HostPlanRuntime,
    #[serde(rename = "ibex_ctx_db_host_bridge")]
    IbexCtxDbHostBridge,
    #[serde(rename = "inline_handler_v1")]
    InlineHandlerV1,
    /// Transactional one-off durable work, first slice (LLP 0070, Draft):
    /// `ctx.jobs.enqueue` from JS mutations, the paved default queue,
    /// job/attempt receipts, the declared job-status query, and the
    /// injected-clock forced drain. Experimental for as long as LLP 0070 is
    /// Draft — its claim boundary bars any durable-background-work
    /// capability-class claim, and this id asserts current-contract
    /// compatibility only.
    #[serde(rename = "jobs_one_off_v1")]
    JobsOneOffV1,
    #[serde(rename = "live_subscriptions")]
    LiveSubscriptions,
    #[serde(rename = "mutation_read_set_validation")]
    MutationReadSetValidation,
    #[serde(rename = "permission_epoch_resync")]
    PermissionEpochResync,
    #[serde(rename = "registered_bundle_boot_v1")]
    RegisteredBundleBootV1,
    #[serde(rename = "relational_query_v1")]
    RelationalQueryV1,
    #[serde(rename = "migration_keyset_scan_v1")]
    MigrationKeysetScanV1,
    #[serde(rename = "full_text_search_v1")]
    FullTextSearchV1,
    #[serde(rename = "result_contract_v1")]
    ResultContractV1,
    #[serde(rename = "args_contract_v1")]
    ArgsContractV1,
    #[serde(rename = "versioned_seed_install_v1")]
    VersionedSeedInstallV1,
    #[serde(rename = "versioned_seed_reset_v1")]
    VersionedSeedResetV1,
    #[serde(rename = "write_activity_v1")]
    WriteActivityV1,
}

impl TargetCapabilityId {
    pub const ALL: [Self; 21] = [
        Self::AuthSessionsV1,
        Self::BoundedResponseStreamV1,
        Self::BoundedChildrenV1,
        Self::Cron,
        Self::CronActionRunMutation,
        Self::HostPlanRuntime,
        Self::IbexCtxDbHostBridge,
        Self::InlineHandlerV1,
        Self::JobsOneOffV1,
        Self::LiveSubscriptions,
        Self::MutationReadSetValidation,
        Self::PermissionEpochResync,
        Self::RegisteredBundleBootV1,
        Self::RelationalQueryV1,
        Self::MigrationKeysetScanV1,
        Self::FullTextSearchV1,
        Self::ResultContractV1,
        Self::ArgsContractV1,
        Self::VersionedSeedInstallV1,
        Self::VersionedSeedResetV1,
        Self::WriteActivityV1,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AuthSessionsV1 => "auth.sessions.v1",
            Self::BoundedResponseStreamV1 => "bounded_response_stream_v1",
            Self::BoundedChildrenV1 => "bounded_children_v1",
            Self::Cron => "cron",
            Self::CronActionRunMutation => "cron_action_run_mutation",
            Self::HostPlanRuntime => "host_plan_runtime",
            Self::IbexCtxDbHostBridge => "ibex_ctx_db_host_bridge",
            Self::InlineHandlerV1 => "inline_handler_v1",
            Self::JobsOneOffV1 => "jobs_one_off_v1",
            Self::LiveSubscriptions => "live_subscriptions",
            Self::MutationReadSetValidation => "mutation_read_set_validation",
            Self::PermissionEpochResync => "permission_epoch_resync",
            Self::RegisteredBundleBootV1 => "registered_bundle_boot_v1",
            Self::RelationalQueryV1 => "relational_query_v1",
            Self::MigrationKeysetScanV1 => "migration_keyset_scan_v1",
            Self::FullTextSearchV1 => "full_text_search_v1",
            Self::ResultContractV1 => "result_contract_v1",
            Self::ArgsContractV1 => "args_contract_v1",
            Self::VersionedSeedInstallV1 => "versioned_seed_install_v1",
            Self::VersionedSeedResetV1 => "versioned_seed_reset_v1",
            Self::WriteActivityV1 => "write_activity_v1",
        }
    }

    /// The registry-owned maturity of this capability id (LLP 0058
    /// §Capability maturity, amendment 2026-07-24). Maturity is a fact about
    /// the id's governing contract, not about any one runtime instance, so it
    /// lives on the closed registry next to the id itself: candidate
    /// artifacts can neither assert nor upgrade it.
    ///
    /// @ref LLP 0058#capability-maturity — an `experimental` entry in
    /// `supportedCapabilities` is not the plain 0058 compatibility assertion;
    /// admission refuses it unless the requiring artifact acknowledges the
    /// experimental contract.
    pub const fn maturity(self) -> CapabilityMaturity {
        // LLP 0076 was Accepted 2026-07-25 and LLP 0080/0081 flipped to
        // Implemented 2026-07-26 (coupled suite green, admitted Step 5
        // fixture witnesses complete): `bounded_response_stream_v1`, then
        // `relational_query_v1` and `migration_keyset_scan_v1`, fell out of
        // the non-stable table as those acceptance/Implemented acts —
        // positive presence is now the plain 0058 compatibility assertion
        // for every registered id. Artifacts that still acknowledge a
        // promoted id are unaffected (stable acknowledgment is a no-op).
        match self {
            Self::BoundedChildrenV1
            | Self::InlineHandlerV1
            // LLP 0070 is Draft: `jobs_one_off_v1` stays experimental until
            // the RFC is accepted, and its presence never claims a
            // durable-work capability class or target tuple (claim boundary).
            | Self::JobsOneOffV1
            | Self::RegisteredBundleBootV1
            | Self::ResultContractV1
            | Self::ArgsContractV1
            | Self::VersionedSeedInstallV1
            | Self::VersionedSeedResetV1
            | Self::WriteActivityV1 => CapabilityMaturity::Experimental,
            _ => CapabilityMaturity::Stable,
        }
    }

    /// Evaluate the id's named positive predicate for one exact target/runtime
    /// instance. Missing facts are false; capability gaps are never consulted.
    pub fn is_supported_by(
        self,
        manifest: &CapabilityManifest,
        facts: TargetCapabilityFacts,
    ) -> bool {
        match self {
            Self::AuthSessionsV1 => {
                facts.paired_v1_parser_registered
                    && facts.shared_invocation_gate_registered
                    && facts.staged_mode_registered
            }
            // @ref LLP 0076#target-contract — the stream capability is an
            // instance-live predicate: the implementation must be registered
            // AND this exact process must have outbound egress enabled.
            Self::BoundedResponseStreamV1 => {
                manifest.outbound_actions && facts.bounded_response_stream_v1_registered
            }
            // @ref LLP 0110#local-and-packaged-publication-authority — the
            // relation/activity pair is one source-owned local publication:
            // both private registrations and the compiled carrier must hold
            // on the exact auth-aware local profile. A generated artifact,
            // derived service profile, or hosted target cannot set the facts.
            // @ref LLP 0113#1-closed-capability-registry-assignment — static
            // experimental maturity is independent of this runtime predicate
            // and still requires an artifact acknowledgment at admission.
            Self::BoundedChildrenV1 | Self::WriteActivityV1 => {
                facts.bounded_children_v1_registered
                    && facts.write_activity_v1_registered
                    && facts.local_relation_activity_publication_v1_verified
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
                    && manifest
                        .supported_artifact_auth_pairs
                        .contains(&SupportedArtifactAuthPair {
                            schema_version: ArtifactVersion::V1,
                            auth_mode: AuthMode::Sessions,
                        })
                    && manifest.auth_protocols == Some(AuthProtocols::V1)
                    && match self {
                        Self::BoundedChildrenV1 => {
                            manifest.live_subscriptions && manifest.relational_queries.is_some()
                        }
                        Self::WriteActivityV1 => {
                            facts.result_contract_v1_registered
                                && facts.mutation_read_set_validator_registered
                                && manifest.mutation_isolation_mode
                                    == "handler-captured-read-set-validation"
                        }
                        _ => unreachable!(),
                    }
            }
            Self::HostPlanRuntime => facts.host_plan_runtime,
            Self::IbexCtxDbHostBridge => facts.ibex_ctx_db_host_bridge_available,
            Self::InlineHandlerV1 => facts.inline_handler_v1_registered,
            // Fail-closed dedicated fact: only the local single-process
            // SQLite target registers the jobs enqueue/drain implementation.
            // Hosted targets stay false — LLP 0070's hosted candidate is
            // blocked-on and out of this slice (nonclaim).
            Self::JobsOneOffV1 => facts.jobs_one_off_v1_registered,
            Self::LiveSubscriptions => manifest.live_subscriptions,
            Self::MutationReadSetValidation => {
                manifest.mutation_isolation_mode == "handler-captured-read-set-validation"
                    && facts.mutation_read_set_validator_registered
            }
            Self::Cron => manifest.cron,
            Self::CronActionRunMutation => {
                manifest.cron
                    && manifest
                        .supported_query_forms
                        .iter()
                        .any(|form| form == "cron-action-run-mutation")
            }
            Self::PermissionEpochResync => facts.permission_epoch_resync_registered,
            // @ref LLP 0112#fallback-and-capability-honesty — positive
            // presence means this exact target instance implements the
            // route/register endpoint, pending-owner/grant custody, and the
            // generated client's registered-adoption cleanup contract.
            Self::RegisteredBundleBootV1 => facts.registered_bundle_boot_v1_registered,
            // Fail-closed dedicated fact: a target implementing host plans
            // (e.g. the Cloudflare host-ops path) does not thereby implement
            // the relational executor (LLP 0080 §2's capability-gap rule).
            Self::RelationalQueryV1 => facts.relational_query_v1_registered,
            // Fail-closed dedicated fact (LLP 0081 §3): the privileged
            // migration scan is a target capability; a target without it
            // cannot claim migration proofs.
            Self::MigrationKeysetScanV1 => facts.migration_keyset_scan_v1_registered,
            Self::FullTextSearchV1 => {
                facts.full_text_search_v1_registered
                    && manifest.full_text_search.as_ref().is_some_and(|facts| {
                        facts.capability_id == "full_text_search_v1"
                            && facts.maturity == "stable"
                            && facts.storage_engines == ["sqlite"]
                    })
            }
            Self::ResultContractV1 => facts.result_contract_v1_registered,
            // @ref LLP 0131#runtime-ingress-validation — positive presence
            // means this exact target instance runs `validate_function_args`
            // on every fresh invocation admission lane, scalars included.
            Self::ArgsContractV1 => facts.args_contract_v1_registered,
            // @ref LLP 0109#166-the-manifest-is-an-executable-advertisement-gate
            // — the local fact is enabled only by the complete mandatory
            // conformance receipt; hosted/default target facts remain false.
            Self::VersionedSeedInstallV1 => facts.versioned_seed_install_v1_registered,
            Self::VersionedSeedResetV1 => facts.versioned_seed_reset_v1_registered,
        }
    }
}

impl fmt::Display for TargetCapabilityId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for TargetCapabilityId {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .into_iter()
            .find(|capability| capability.as_str() == value)
            .ok_or(())
    }
}

/// The closed maturity vocabulary for registry capability ids (LLP 0058
/// §Capability maturity, amendment 2026-07-24; LLP 0074's no-overclaim rule
/// for Draft authorities).
///
/// - `proposed`: the contract exists in a proposal document but no
///   implementation is registered; a proposed id is never emitted in
///   `supportedCapabilities` at all.
/// - `experimental`: the implementation is registered and the id's positive
///   instance predicate holds, but the governing contract is not Accepted —
///   the entry asserts current-contract compatibility only, and admission
///   refuses requirements on it unless the requiring artifact explicitly
///   acknowledges the experimental contract.
/// - `stable`: the original LLP 0058 reading — positive presence is the
///   plain compatibility assertion.
#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
pub enum CapabilityMaturity {
    #[serde(rename = "proposed")]
    Proposed,
    #[serde(rename = "experimental")]
    Experimental,
    #[serde(rename = "stable")]
    Stable,
}

impl CapabilityMaturity {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Proposed => "proposed",
            Self::Experimental => "experimental",
            Self::Stable => "stable",
        }
    }
}

const LOCAL_RELATION_ACTIVITY_PUBLICATION_BYTES: &[u8] =
    include_bytes!("local-relation-activity-publication.v1.json");
const LOCAL_RELATION_ACTIVITY_PUBLICATION_SHA256: &str =
    "sha256:2ce65f620949a0504afaacad72f31cb76bcec3e1fc91a9ac4eed004df85f3dc7";
const LOCAL_RELATION_ACTIVITY_QUALIFICATION_RECEIPT_BYTES: &[u8] =
    include_bytes!("../tests/conformance/relation-activity-publication-v1.receipt.json");

#[derive(Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
struct LocalRelationActivityPublicationV1 {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "targetProfileId")]
    target_profile_id: String,
    #[serde(rename = "capabilityIds")]
    capability_ids: Vec<String>,
    #[serde(rename = "qualificationReceiptSha256")]
    qualification_receipt_sha256: String,
    #[serde(rename = "executorSourceSha256")]
    executor_source_sha256: BTreeMap<String, String>,
    #[serde(rename = "schemaSourceSha256")]
    schema_source_sha256: BTreeMap<String, String>,
    #[serde(rename = "packageClosureSha256")]
    package_closure_sha256: Option<String>,
    #[serde(rename = "buildProvenanceRequirement")]
    build_provenance_requirement: String,
}

fn sha256_prefixed(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

/// Validate the private, source-embedded publication carrier before deriving
/// either relation/activity support fact. Failure is intentionally a boolean
/// GAP at the target manifest boundary: an unreviewed carrier edit cannot
/// become target authority through a generated application artifact.
///
/// @ref LLP 0110#local-and-packaged-publication-authority — source builds
/// bind the exact local profile, both atomic capability ids, the executable
/// evidence receipt, and the implementation/schema source bytes.
/// @ref LLP 0113#6-acceptance — carrier and registry tampering must withhold
/// runtime support while leaving the static maturity assignment intact.
fn local_relation_activity_publication_verified_for(
    build_distribution: &str,
    carrier_bytes: &[u8],
    expected_carrier_sha256: &str,
    qualification_receipt_bytes: &[u8],
) -> bool {
    // Public packages cannot inherit the contributor trust root. Until the
    // loader embeds and verifies PackageCapabilityAttestationV1, one
    // distribution predicate closes every substitution/tamper path as a GAP.
    //
    // @ref LLP 0110#local-and-packaged-publication-authority — package support
    // requires the release-key-signed binary/triple/ledger/source/carrier
    // binding; absence or mismatch withholds the atomic pair.
    if build_distribution != crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE {
        return false;
    }
    if sha256_prefixed(carrier_bytes) != expected_carrier_sha256 {
        return false;
    }
    let Ok(carrier) = serde_json::from_slice::<LocalRelationActivityPublicationV1>(carrier_bytes)
    else {
        return false;
    };
    carrier.schema_version == "snapback.local-capability-publication.v1"
        && carrier.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
        && carrier.capability_ids == ["bounded_children_v1", "write_activity_v1"].map(str::to_owned)
        && carrier.qualification_receipt_sha256 == sha256_prefixed(qualification_receipt_bytes)
        && carrier.executor_source_sha256
            == BTreeMap::from([
                (
                    "src/local.rs".to_owned(),
                    "sha256:92de57785058e19f130f5a8393294af920e194efa120fab8a39df0eb567a9b16"
                        .to_owned(),
                ),
                (
                    "src/storage.rs".to_owned(),
                    "sha256:5f3d739ad92675dab6c674a1d92c1cb55c5b3763731b8a2933738b7d929aad7f"
                        .to_owned(),
                ),
            ])
        && carrier.schema_source_sha256
            == BTreeMap::from([(
                "packages/snapback-codegen/define.mjs".to_owned(),
                "sha256:76d6164646f1f0eecb564f630c830b3240e4fb12331dcc6011a971f805250c87"
                    .to_owned(),
            )])
        && carrier.package_closure_sha256.is_none()
        && carrier.build_provenance_requirement == "source-commit-and-embedded-carrier-sha256"
}

#[cfg(test)]
fn local_relation_activity_publication_verified() -> bool {
    local_relation_activity_publication_verified_for(
        crate::identity::build_distribution(),
        LOCAL_RELATION_ACTIVITY_PUBLICATION_BYTES,
        LOCAL_RELATION_ACTIVITY_PUBLICATION_SHA256,
        LOCAL_RELATION_ACTIVITY_QUALIFICATION_RECEIPT_BYTES,
    )
}

/// Code-owned implementation facts not representable by existing capability
/// manifest fields. Constructors are internal so candidate artifacts cannot
/// turn assertions into target authority.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct TargetCapabilityFacts {
    bounded_children_v1_registered: bool,
    bounded_response_stream_v1_registered: bool,
    relational_query_v1_registered: bool,
    migration_keyset_scan_v1_registered: bool,
    full_text_search_v1_registered: bool,
    inline_handler_v1_registered: bool,
    jobs_one_off_v1_registered: bool,
    result_contract_v1_registered: bool,
    args_contract_v1_registered: bool,
    versioned_seed_install_v1_registered: bool,
    versioned_seed_reset_v1_registered: bool,
    paired_v1_parser_registered: bool,
    shared_invocation_gate_registered: bool,
    staged_mode_registered: bool,
    host_plan_runtime: bool,
    ibex_ctx_db_host_bridge_available: bool,
    mutation_read_set_validator_registered: bool,
    permission_epoch_resync_registered: bool,
    registered_bundle_boot_v1_registered: bool,
    write_activity_v1_registered: bool,
    local_relation_activity_publication_v1_verified: bool,
}

impl TargetCapabilityFacts {
    fn local_auth_aware() -> Self {
        Self::local_auth_aware_for_distribution(crate::identity::build_distribution())
    }

    fn local_auth_aware_for_distribution(build_distribution: &str) -> Self {
        let local_relation_activity_publication_v1_verified =
            local_relation_activity_publication_verified_for(
                build_distribution,
                LOCAL_RELATION_ACTIVITY_PUBLICATION_BYTES,
                LOCAL_RELATION_ACTIVITY_PUBLICATION_SHA256,
                LOCAL_RELATION_ACTIVITY_QUALIFICATION_RECEIPT_BYTES,
            );
        // @ref LLP 0109#166-the-manifest-is-an-executable-advertisement-gate — both local capability ids
        // are advertised only after the closed executable suite passes every
        // mandatory local row; LLP 0109 remains Review, so registry maturity
        // stays experimental until the author accepts the contract.
        Self {
            bounded_children_v1_registered: true,
            bounded_response_stream_v1_registered: true,
            relational_query_v1_registered: true,
            migration_keyset_scan_v1_registered: true,
            full_text_search_v1_registered: true,
            inline_handler_v1_registered: true,
            // @ref LLP 0070#non-goals-and-claim-boundary — registered means
            // the local enqueue/drain implementation exists; the id's
            // experimental maturity carries the Draft-status honesty.
            jobs_one_off_v1_registered: true,
            result_contract_v1_registered: true,
            args_contract_v1_registered: true,
            versioned_seed_install_v1_registered: true,
            versioned_seed_reset_v1_registered: true,
            paired_v1_parser_registered: true,
            shared_invocation_gate_registered: true,
            staged_mode_registered: true,
            host_plan_runtime: true,
            ibex_ctx_db_host_bridge_available: true,
            mutation_read_set_validator_registered: true,
            permission_epoch_resync_registered: true,
            // @ref LLP 0112#evidence-and-acceptance — the closed bundle DTO,
            // sender-bound mint/replay, socket-preflight handoff, expiry,
            // and generated-client adoption/cleanup suites jointly prove the
            // local/auth-aware target implementation behind this positive
            // experimental capability fact.
            registered_bundle_boot_v1_registered: true,
            write_activity_v1_registered: true,
            local_relation_activity_publication_v1_verified,
        }
    }

    fn conformance_auth_aware() -> Self {
        Self {
            bounded_children_v1_registered: false,
            ibex_ctx_db_host_bridge_available: false,
            // The conformance profile has no jobs worker/drain instance;
            // fail closed like the other local-only registrations.
            jobs_one_off_v1_registered: false,
            write_activity_v1_registered: false,
            local_relation_activity_publication_v1_verified: false,
            ..Self::local_auth_aware()
        }
    }

    fn with_relation_activity_publication_withheld(mut self) -> Self {
        self.bounded_children_v1_registered = false;
        self.write_activity_v1_registered = false;
        self.local_relation_activity_publication_v1_verified = false;
        self
    }
}

/// Version-1 auth protocol numbers reported by an auth-aware target.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AuthProtocols {
    pub provider: u32,
    pub invocation: u32,
    #[serde(rename = "stagedMode", alias = "staged_mode")]
    pub staged_mode: u32,
    pub bootstrap: u32,
}

impl AuthProtocols {
    const V1: Self = Self {
        provider: 1,
        invocation: 1,
        staged_mode: 1,
        bootstrap: 1,
    };
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CapabilityManifest {
    #[serde(
        default = "capability_manifest_kind",
        rename = "artifactKind",
        alias = "artifact_kind"
    )]
    pub artifact_kind: String,
    #[serde(
        default = "snapback_schema_version",
        rename = "schemaVersion",
        alias = "schema_version"
    )]
    pub schema_version: String,
    #[serde(rename = "targetProfileId", alias = "target_profile_id")]
    pub target_profile_id: String,
    #[serde(
        default,
        rename = "supportedArtifactVersions",
        alias = "supported_artifact_versions"
    )]
    pub supported_artifact_versions: Vec<ArtifactVersion>,
    #[serde(default, rename = "supportedAuthModes", alias = "supported_auth_modes")]
    pub supported_auth_modes: Vec<AuthMode>,
    #[serde(
        default,
        rename = "supportedArtifactAuthPairs",
        alias = "supported_artifact_auth_pairs"
    )]
    pub supported_artifact_auth_pairs: Vec<SupportedArtifactAuthPair>,
    #[serde(
        default,
        rename = "supportedCapabilities",
        alias = "supported_capabilities"
    )]
    pub supported_capabilities: Vec<TargetCapabilityId>,
    /// Maturity annotations over `supportedCapabilities` (LLP 0058
    /// §Capability maturity, amendment 2026-07-24). Only emitted ids whose
    /// registry maturity is not `stable` appear here; an id absent from this
    /// map is stable, and a manifest omitting the field predates the maturity
    /// dimension. The map is derived from the same closed Rust registry as
    /// `supportedCapabilities` — it is reporting, never accepted as authority
    /// from a posted artifact.
    #[serde(
        default,
        rename = "capabilityMaturity",
        alias = "capability_maturity",
        skip_serializing_if = "BTreeMap::is_empty"
    )]
    pub capability_maturity: BTreeMap<TargetCapabilityId, CapabilityMaturity>,
    #[serde(
        default,
        rename = "authProtocols",
        alias = "auth_protocols",
        skip_serializing_if = "Option::is_none"
    )]
    pub auth_protocols: Option<AuthProtocols>,
    /// Target-authored deployment and browser-security facts. App artifacts
    /// and operator input may consume this descriptor but cannot assert it.
    ///
    /// @ref LLP 0060#d5-hosted-readiness-is-conjunctive — hosted auth is an
    /// exact conjunction; local loopback and production profile are not facts.
    #[serde(default, rename = "hostedAuth", alias = "hosted_auth")]
    pub hosted_auth: crate::auth::deployment::HostedAuthCapabilities,
    #[serde(rename = "storageEngine", alias = "storage_engine")]
    pub storage_engine: String,
    #[serde(rename = "runtimeEngine", alias = "runtime_engine")]
    pub runtime_engine: String,
    #[serde(rename = "localServerLifecycle", alias = "local_server_lifecycle")]
    pub local_server_lifecycle: bool,
    #[serde(rename = "liveSubscriptions", alias = "live_subscriptions")]
    pub live_subscriptions: bool,
    #[serde(rename = "syncableLiveQueries", alias = "syncable_live_queries")]
    pub syncable_live_queries: bool,
    #[serde(rename = "onlineOnlyQueries", alias = "online_only_queries")]
    pub online_only_queries: bool,
    #[serde(rename = "replaceOnlyQueries", alias = "replace_only_queries")]
    pub replace_only_queries: bool,
    #[serde(default, rename = "ephemeralRealtime", alias = "ephemeral_realtime")]
    pub ephemeral_realtime: bool,
    #[serde(
        default,
        rename = "ephemeralWebSocketPublish",
        alias = "ephemeral_websocket_publish"
    )]
    pub ephemeral_websocket_publish: bool,
    #[serde(
        default,
        rename = "ephemeralLocalRoomAuthority",
        alias = "ephemeral_local_room_authority"
    )]
    pub ephemeral_local_room_authority: bool,
    #[serde(
        default,
        rename = "ephemeralHostedAdapter",
        alias = "ephemeral_hosted_adapter"
    )]
    pub ephemeral_hosted_adapter: bool,
    #[serde(rename = "offlineRetention", alias = "offline_retention")]
    pub offline_retention: bool,
    #[serde(rename = "optimisticReplay", alias = "optimistic_replay")]
    pub optimistic_replay: bool,
    #[serde(rename = "mutationIsolationMode", alias = "mutation_isolation_mode")]
    pub mutation_isolation_mode: String,
    #[serde(rename = "authImpersonation", alias = "auth_impersonation")]
    pub auth_impersonation: bool,
    #[serde(rename = "permissionDiagnostics", alias = "permission_diagnostics")]
    pub permission_diagnostics: bool,
    #[serde(rename = "assetUpload", alias = "asset_upload")]
    pub asset_upload: bool,
    #[serde(rename = "outboundActions", alias = "outbound_actions")]
    pub outbound_actions: bool,
    pub cron: bool,
    pub notifications: bool,
    #[serde(rename = "supportedQueryForms", alias = "supported_query_forms")]
    pub supported_query_forms: Vec<String>,
    #[serde(rename = "portabilityOptOuts", alias = "portability_opt_outs")]
    pub portability_opt_outs: Vec<String>,
    #[serde(rename = "resourceLimits", alias = "resource_limits")]
    pub resource_limits: Vec<ResourceLimit>,
    #[serde(rename = "capabilityGaps", alias = "capability_gaps")]
    pub capability_gaps: Vec<String>,
    /// VM lifecycle for handler execution. Current targets report
    /// `"fresh-per-invocation"`; `"warm-pooled-reset"` remains a recognized
    /// historical value for compatibility with older artifacts. Surfaced so
    /// LLP 0012's honesty rule holds.
    ///
    /// @ref LLP 0009#dk-4-retired--upstream-ibex-owner-thread-contract-2026-07-27 — lifecycle truthfulness.
    #[serde(
        rename = "vmLifecycle",
        alias = "vm_lifecycle",
        default = "vm_lifecycle_fresh"
    )]
    pub vm_lifecycle: String,
    /// Target-computed runtime facts (LLP 0048 §Single-sourced runtime flags,
    /// DK-5 capability truthfulness): the workerd release id, pinned
    /// compatibility date and flags, kill-domain shape, and computed limit
    /// values. Absent on targets that assert their limits statically.
    #[serde(
        default,
        rename = "runtimeFacts",
        alias = "runtime_facts",
        skip_serializing_if = "Option::is_none"
    )]
    pub runtime_facts: Option<Value>,
    /// Migration-executor facts (LLP 0081 §4): the executor profile and
    /// the closed fence lane registry. Present exactly when the target has
    /// a migration executor; absent targets refuse with
    /// `SNAPBACK_MIGRATION_EXECUTOR_UNAVAILABLE`.
    #[serde(default, rename = "migration", skip_serializing_if = "Option::is_none")]
    pub migration: Option<MigrationTargetFacts>,
    /// Relational-query facts (LLP 0080 §4): the live delivery class and
    /// the closed set of admitted retention classes. Present exactly when
    /// the target supports `relational_query_v1`; a target without the
    /// executor reports the capability gap instead.
    #[serde(
        default,
        rename = "relationalQueries",
        alias = "relational_queries",
        skip_serializing_if = "Option::is_none"
    )]
    pub relational_queries: Option<RelationalQueryFacts>,
    /// Generated standard-pattern facts (LLP 0065 §4): live delivery is the
    /// conservative resnapshot, and the `authScopeField`-enabled
    /// disjointness-skip refinement of LLP 0053 is disabled — the field is
    /// invalidation-routing metadata, never a skip enabler or enforcement.
    /// Present exactly when the target runs generated standard patterns.
    #[serde(
        default,
        rename = "standardPatterns",
        alias = "standard_patterns",
        skip_serializing_if = "Option::is_none"
    )]
    pub standard_patterns: Option<StandardPatternFacts>,
    /// Exact local portable-search posture. Absent on Cloudflare,
    /// conformance, and hosted targets until their independent corpus
    /// qualifies.
    #[serde(
        default,
        rename = "fullTextSearch",
        alias = "full_text_search",
        skip_serializing_if = "Option::is_none"
    )]
    pub full_text_search: Option<FullTextSearchFactsV1>,
}

/// The declared standard-pattern live posture (LLP 0065 §4).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StandardPatternFacts {
    /// Always `"conservative-resnapshot"` in v1: a generated live query
    /// resnapshots on a dependency commit and never claims `live_delta` —
    /// the runtime excludes pattern-identified functions from the delta
    /// lane even when the plan shape would otherwise qualify.
    #[serde(rename = "liveDelivery", alias = "live_delivery")]
    pub live_delivery: String,
    /// Always `"disabled"` in v1: `authScopeField` routes invalidation and
    /// never enables LLP 0053's disjointness-skip refinement, so no
    /// convergence fixture is owed until a future profile claims the skip.
    #[serde(
        rename = "authScopeDisjointnessSkip",
        alias = "auth_scope_disjointness_skip"
    )]
    pub auth_scope_disjointness_skip: String,
}

impl StandardPatternFacts {
    pub fn local_v1() -> Self {
        Self {
            live_delivery: "conservative-resnapshot".to_owned(),
            auth_scope_disjointness_skip: "disabled".to_owned(),
        }
    }
}

/// The migration-executor posture and the closed lane registry the
/// persisted migration fence covers (LLP 0081 §4): a lane the fence does
/// not name cannot be admitted at all, so the registry is a capability
/// fact, not prose.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationTargetFacts {
    /// The executor profile: `"local-exclusive-single-writer"` on the
    /// local target (one IMMEDIATE transaction per durable transition).
    pub executor: String,
    /// The closed, enumerated lane registry the durable fence closes.
    #[serde(rename = "fenceLanes")]
    pub fence_lanes: Vec<String>,
}

impl MigrationTargetFacts {
    pub fn local_v1() -> Self {
        Self {
            executor: "local-exclusive-single-writer".to_owned(),
            fence_lanes: [
                "mutation",
                "buffered-mutation",
                "query",
                "live-subscribe",
                "live-resume",
                "cron",
                "action-stage",
                "ephemeral-publish",
            ]
            .iter()
            .map(|lane| (*lane).to_owned())
            .collect(),
        }
    }
}

/// The declared relational live/retention posture (LLP 0080 §4).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RelationalQueryFacts {
    /// Always `"live_replace"` in v1: relational subscriptions inherit
    /// LLP 0053 with table-granular invalidation and no proved-disjoint
    /// skip, and no incremental delta matcher is admitted.
    #[serde(rename = "liveDelivery", alias = "live_delivery")]
    pub live_delivery: String,
    /// Closed, default-deny retention classes the target admits for
    /// relational plans: `none` (the default) and
    /// `opaque-authorized-snapshot-v1` (the authenticated lease class —
    /// owner-visible plans only; anonymous results have no admissible
    /// retention).
    pub retention: Vec<String>,
}

impl RelationalQueryFacts {
    pub fn local_v1() -> Self {
        Self {
            live_delivery: "live_replace".to_owned(),
            retention: vec![
                "none".to_owned(),
                "opaque-authorized-snapshot-v1".to_owned(),
            ],
        }
    }
}

pub(crate) fn vm_lifecycle_fresh() -> String {
    "fresh-per-invocation".to_owned()
}

pub(crate) const VM_LIFECYCLE_WARM_POOLED_RESET: &str = "warm-pooled-reset";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct ResourceLimit {
    pub name: String,
    pub status: ResourceLimitStatus,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ResourceLimitStatus {
    Enforced,
    Advisory,
    Missing,
}

/// The declared (instance-independent) capability gaps of the local v0
/// target. Instance-live adjustments — today only the `ibex_cli` gap when the
/// CLI is unavailable — are applied by `LocalSnapback::capability_gaps`.
///
/// @ref LLP 0037#decision-ratified-2026-07-02 — the Rust core is the single
/// source of truth for the capability manifest; the committed
/// `schemas/capability.manifest.local-dev-sqlite-ibex.json` is generated from
/// this declaration and embedded by codegen (LLP 0032 P2).
pub fn local_v0_default_capability_gaps() -> Vec<String> {
    vec![
        "postgres".to_owned(),
        "cloudflare".to_owned(),
        "hosted_untrusted_code".to_owned(),
        "external_auth".to_owned(),
        "assets".to_owned(),
        "outbound_actions".to_owned(),
        "bounded_response_stream_v1".to_owned(),
        "bounded_children_v1".to_owned(),
        "notifications".to_owned(),
        "ephemeral_hosted_adapter".to_owned(),
        "ephemeral_multi_instance_sticky_routing".to_owned(),
        "write_activity_v1".to_owned(),
    ]
}

fn ensure_relation_activity_capability_gaps(gaps: &mut Vec<String>) {
    if !gaps.iter().any(|gap| gap == "bounded_children_v1") {
        let insertion = gaps
            .iter()
            .position(|gap| gap == "notifications")
            .unwrap_or(gaps.len());
        gaps.insert(insertion, "bounded_children_v1".to_owned());
    }
    if !gaps.iter().any(|gap| gap == "write_activity_v1") {
        gaps.push("write_activity_v1".to_owned());
    }
}

impl CapabilityManifest {
    /// The declared capability manifest of the local v0 target: what an agent
    /// may assume from the committed artifact alone. Instance-live facts
    /// (`vmLifecycle`, the `ibex_cli` gap) are reported by `/inspect`.
    pub fn local_v0_declared() -> Self {
        Self::local_v0(local_v0_default_capability_gaps())
    }

    pub fn local_v0(capability_gaps: Vec<String>) -> Self {
        Self::local_v0_with_facts(capability_gaps, TargetCapabilityFacts::local_auth_aware())
    }

    fn local_v0_with_facts(
        mut capability_gaps: Vec<String>,
        capability_facts: TargetCapabilityFacts,
    ) -> Self {
        if capability_facts.local_relation_activity_publication_v1_verified {
            capability_gaps
                .retain(|gap| gap != "bounded_children_v1" && gap != "write_activity_v1");
        } else {
            ensure_relation_activity_capability_gaps(&mut capability_gaps);
        }
        let mut manifest = Self {
            artifact_kind: capability_manifest_kind(),
            schema_version: snapback_schema_version(),
            target_profile_id: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            supported_artifact_versions: vec![ArtifactVersion::V0, ArtifactVersion::V1],
            supported_auth_modes: vec![AuthMode::Dev, AuthMode::Sessions],
            supported_artifact_auth_pairs: vec![
                SupportedArtifactAuthPair {
                    schema_version: ArtifactVersion::V0,
                    auth_mode: AuthMode::Dev,
                },
                SupportedArtifactAuthPair {
                    schema_version: ArtifactVersion::V1,
                    auth_mode: AuthMode::Sessions,
                },
            ],
            supported_capabilities: Vec::new(),
            capability_maturity: BTreeMap::new(),
            auth_protocols: Some(AuthProtocols::V1),
            hosted_auth: crate::auth::deployment::HostedAuthCapabilities::local_target(),
            storage_engine: "sqlite".to_owned(),
            runtime_engine: "ibex".to_owned(),
            local_server_lifecycle: true,
            live_subscriptions: true,
            syncable_live_queries: true,
            online_only_queries: true,
            replace_only_queries: true,
            ephemeral_realtime: true,
            ephemeral_websocket_publish: true,
            ephemeral_local_room_authority: true,
            ephemeral_hosted_adapter: false,
            offline_retention: true,
            optimistic_replay: true,
            mutation_isolation_mode: "handler-captured-read-set-validation".to_owned(),
            auth_impersonation: true,
            permission_diagnostics: false,
            asset_upload: false,
            outbound_actions: false,
            cron: true,
            notifications: false,
            migration: Some(MigrationTargetFacts::local_v1()),
            relational_queries: Some(RelationalQueryFacts::local_v1()),
            standard_patterns: Some(StandardPatternFacts::local_v1()),
            full_text_search: Some(FullTextSearchFactsV1::local_v1()),
            supported_query_forms: vec![
                "host-plan-single-table-eq".to_owned(),
                "host-plan-single-table-in".to_owned(),
                "host-plan-single-table-range".to_owned(),
                "host-plan-live-replace".to_owned(),
                "ibex-ctx-db-single-table-eq".to_owned(),
                "ibex-ctx-db-single-table-in".to_owned(),
                "ibex-ctx-db-single-table-range".to_owned(),
                "ibex-live-eq-replace".to_owned(),
                "ibex-live-in-replace".to_owned(),
                "ibex-live-range-replace".to_owned(),
                "ibex-live-limited-boundary-replace".to_owned(),
                "websocket-live-replace".to_owned(),
                "ephemeral-latest-state-local".to_owned(),
                "websocket-ephemeral-publish".to_owned(),
                "cron-fixed-interval-local".to_owned(),
                "cron-calendar-local".to_owned(),
                "cron-action-run-mutation".to_owned(),
            ],
            portability_opt_outs: Vec::new(),
            resource_limits: vec![
                ResourceLimit {
                    name: "wall_clock_timeout".to_owned(),
                    status: ResourceLimitStatus::Missing,
                },
                // ENG-23324: actions (the only egress-capable class) run
                // detached under a coarse wall-clock watchdog — the caller is
                // guaranteed an answer within the budget even when the VM
                // thread is stuck in a hung fetch. Queries/mutations still
                // have no timeout, so `wall_clock_timeout` above stays
                // honestly Missing.
                ResourceLimit {
                    name: "action_wall_clock_timeout".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                // @ref LLP 0076#surface — the v1 bounded response-stream
                // profile limits the local host actually checks. The 64 KiB
                // buffered-bytes bound is enforced structurally (one
                // in-flight 16 KiB pull per cursor x the 4-cursor cap) and
                // witnessed by a real per-invocation materialized-byte
                // counter with a slow-consumer high-water-mark test; the
                // wall row is the absolute mid-read ceiling.
                ResourceLimit {
                    name: "bounded_response_stream_total_bytes".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "bounded_response_stream_buffered_bytes".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "bounded_response_stream_read_bytes".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "bounded_response_stream_open_cursors".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "bounded_response_stream_wall_clock".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "bounded_response_stream_idle_timeout".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "bounded_response_stream_progress_rate".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "cpu_budget".to_owned(),
                    status: ResourceLimitStatus::Missing,
                },
                ResourceLimit {
                    name: "maximum_result_size".to_owned(),
                    // @ref LLP 0108#result-contract-vocabulary — every
                    // handler result now crosses the shared 4 MiB
                    // post-JSON-image validator before publication/commit.
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "maximum_subscription_count".to_owned(),
                    // The local registry enforces the same 2,048-global /
                    // 64-per-connection ceilings as the hosted coordinator.
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "ephemeral_value_size".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "ephemeral_publish_rate".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "ephemeral_durable_lane_priority".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
            ],
            capability_gaps,
            // Current Ibex is owner-thread-affine, so every target uses the
            // conservative fresh-per-invocation lifecycle.
            vm_lifecycle: vm_lifecycle_fresh(),
            runtime_facts: None,
        };
        manifest.refresh_supported_capabilities(capability_facts);
        manifest
    }

    /// The code-owned declaration for a local process configured with the
    /// outbound-action gate enabled. Codegen embeds this exact variant when
    /// its matching authoring switch is on, while `/inspect` remains the
    /// authority for the process that actually serves the artifact.
    pub fn local_v0_outbound_actions_declared() -> Self {
        Self::local_v0_instance(local_v0_default_capability_gaps(), true)
    }

    /// Apply the process-live outbound-action gate to the local declaration.
    /// The committed target artifact remains conservative; `/inspect` is the
    /// authority for whether this exact process enabled egress and therefore
    /// the bounded response-stream profile.
    // @ref LLP 0076#target-contract — capability truth is instance-live, not
    // a static declaration: the served manifest reflects this process.
    pub(crate) fn local_v0_instance(
        mut capability_gaps: Vec<String>,
        outbound_actions: bool,
    ) -> Self {
        if outbound_actions {
            capability_gaps
                .retain(|gap| gap != "outbound_actions" && gap != "bounded_response_stream_v1");
        }
        let mut manifest = Self::local_v0(capability_gaps);
        manifest.outbound_actions = outbound_actions;
        manifest.refresh_supported_capabilities(TargetCapabilityFacts::local_auth_aware());
        manifest
    }

    /// The declared capability manifest for an independently managed
    /// SQLite + Ibex service. This is deliberately derived from the standard
    /// server declaration: moving the same server behind an HTTPS authority
    /// does not change its data semantics. It changes exactly one capability
    /// fact — the consuming host must never start or stop the service.
    ///
    /// Endpoint and credential values are runtime-private host inputs and do
    /// not belong in this manifest or any generated application artifact.
    pub fn remote_service_sqlite_ibex_declared() -> Self {
        let mut manifest = Self::local_v0_declared();
        manifest.target_profile_id = TARGET_PROFILE_REMOTE_SERVICE_SQLITE_IBEX.to_owned();
        manifest.local_server_lifecycle = false;
        manifest.full_text_search = None;
        ensure_relation_activity_capability_gaps(&mut manifest.capability_gaps);
        let mut facts =
            TargetCapabilityFacts::local_auth_aware().with_relation_activity_publication_withheld();
        facts.full_text_search_v1_registered = false;
        manifest.refresh_supported_capabilities(facts);
        manifest
    }

    /// The LLP 0048 conformance twin's internal manifest: the local target's
    /// declaration with the executor swapped and the limits the workerd leg
    /// actually enforces. `runtime_facts` carries the computed values —
    /// workerd version, compat pins, kill domain, measured wall-clock budget
    /// — per DK-5's computed-not-asserted rule. Deliberately NOT a public
    /// target profile (LLP 0048 §Non-goals).
    pub fn conformance_workerd_v8(runtime_facts: Value) -> Self {
        let mut manifest = Self::local_v0(local_v0_default_capability_gaps());
        manifest.target_profile_id = TARGET_PROFILE_LOCAL_CONFORMANCE_SQLITE_WORKERD_V8.to_owned();
        manifest.runtime_engine = "workerd-v8".to_owned();
        manifest.full_text_search = None;
        // Ephemeral, cron, and actions stay on the canonical server; the twin
        // swaps only query/mutation handler execution.
        manifest
            .capability_gaps
            .push("v8_action_execution".to_owned());
        ensure_relation_activity_capability_gaps(&mut manifest.capability_gaps);
        manifest.vm_lifecycle = "fresh-process-per-invocation".to_owned();
        for limit in &mut manifest.resource_limits {
            // The service boundary makes wall-clock enforcement real on this
            // leg (LLP 0047 via LLP 0048 §Limits testbed): the host owns the
            // workerd process and kills it. cpu_budget stays honestly
            // Missing — workerd offers no per-worker CPU budget locally.
            if limit.name == "wall_clock_timeout" {
                limit.status = ResourceLimitStatus::Enforced;
            }
        }
        manifest.runtime_facts = Some(runtime_facts);
        manifest.refresh_supported_capabilities(TargetCapabilityFacts::conformance_auth_aware());
        manifest
    }

    /// The LLP 0040 Cloudflare narrow-proof capability manifest
    /// (`cloudflare-do-sqlite-v8`). Distinct from `local-dev-sqlite-ibex`; its
    /// missing features are product facts, not TODO comments (LLP 0040
    /// §Capability report). Storage is the coordinator Durable Object's
    /// embedded SQLite; the runtime is V8; the live transport is
    /// Durable-Object-owned hibernating WebSockets. Runtime facts are
    /// declared platform/deployment facts here; decisive measurements live in
    /// the generated benchmark/acceptance reports, not in this static
    /// manifest.
    pub fn cloudflare_do_sqlite_v8_declared() -> Self {
        Self::cloudflare_do_sqlite_v8(serde_json::json!({
            "platform": "cloudflare-workers",
            "storage": "durable-object-sqlite",
            "liveTransport": "durable-object-websocket-hibernation",
            "versionAuthority": "coordinator-durable-object",
            "commit": "single-transactionSync (version + rows + journal)",
            "maxRowBytes": 2_000_000,
            "maxObjectStorageBytes": 10_000_000_000_i64,
            "maxSubscriptionsGlobal": 2_048,
            "maxSubscriptionsPerConnection": 64,
            "maxSubscriptionArgsBytes": 32_768,
            "maxLegacyProofSockets": 128,
            "maxAcceptedSockets": 256,
            "maxSocketsPerConnection": 2,
            "wallClockNote": "enforced by the platform (object/request kill); measured value in the benchmark report",
            "codeHotLoad": "missing — deployed Workers forbid dynamic eval; an app-code change is a deploy",
            "handlerHarness": "single-sourced LLP 0048 harness (packages/snapback-harness)",
        }))
    }

    pub fn cloudflare_do_sqlite_v8(runtime_facts: Value) -> Self {
        let mut manifest = Self::local_v0(local_v0_default_capability_gaps());
        manifest.target_profile_id = TARGET_PROFILE_CLOUDFLARE_DO_SQLITE_V8.to_owned();
        manifest.full_text_search = None;
        manifest.supported_artifact_versions = vec![ArtifactVersion::V0];
        manifest.supported_auth_modes = vec![AuthMode::Dev];
        manifest.supported_artifact_auth_pairs = vec![SupportedArtifactAuthPair {
            schema_version: ArtifactVersion::V0,
            auth_mode: AuthMode::Dev,
        }];
        manifest.auth_protocols = None;
        manifest.hosted_auth = crate::auth::deployment::HostedAuthCapabilities::no_auth_target();
        manifest.storage_engine = "durable-object-sqlite".to_owned();
        manifest.runtime_engine = "v8".to_owned();
        manifest.local_server_lifecycle = false;
        manifest.vm_lifecycle = "fresh-isolate-per-deploy".to_owned();
        // The narrow proof has no external auth adapter and does not
        // impersonate users on the deployed Cloudflare target (ENG-23589).
        manifest.auth_impersonation = false;
        // Honest isolation claim (ENG-23575): the coordinator records captured
        // reads but does not yet VALIDATE them at commit; what it enforces is a
        // per-object mutex serializing handler execution + commit (and
        // subscription snapshot + registration). Do not inherit the local
        // target's read-set-validation claim.
        manifest.mutation_isolation_mode = "coordinator-serialized-invocations".to_owned();
        // The ephemeral/presence lane, cron, and the durable-only local
        // niceties are not in the narrow proof; report them honestly.
        manifest.ephemeral_realtime = false;
        manifest.ephemeral_websocket_publish = false;
        manifest.ephemeral_local_room_authority = false;
        // Do not inherit newer local-only queued/offline semantics as the
        // local profile grows. This hosted proof has no retained offline
        // journal or optimistic replay engine; its capability gap below is
        // the matching machine-readable refusal.
        manifest.offline_retention = false;
        manifest.optimistic_replay = false;
        manifest.cron = false;
        // No migration executor on this target: absence of the fact block
        // is the machine-readable refusal (LLP 0081 §4).
        manifest.migration = None;
        // No relational executor on this target: the `relational_query_v1`
        // capability gap is the machine-readable refusal, so the fact block
        // must not ride along from the local profile (LLP 0080 §2).
        manifest.relational_queries = None;
        // The narrow Cloudflare proof has no standard-pattern runtime
        // support (no cursor keyring, no pattern admission gates); loading
        // pattern-identified functions there is outside the proof, so no
        // fact block is claimed.
        manifest.standard_patterns = None;
        // The proof's supported query subset is single-table only (LLP 0040
        // §Measurements: evidence for the supported query subset only).
        manifest.supported_query_forms = vec![
            "ibex-ctx-db-single-table-eq".to_owned(),
            "ibex-ctx-db-single-table-in".to_owned(),
            "ibex-ctx-db-single-table-range".to_owned(),
            "v8-live-eq-replace".to_owned(),
            "websocket-live-replace".to_owned(),
        ];
        // The gaps the narrow proof does not close (LLP 0040 §App subset /
        // §Non-goals). `code_hot_load` is structural: the deployed Workers
        // runtime forbids dynamic eval, so an app-code change is a deploy.
        manifest.capability_gaps = vec![
            "offline_mutation_replay".to_owned(),
            "postgres".to_owned(),
            "hosted_untrusted_code".to_owned(),
            "external_auth".to_owned(),
            "auth_impersonation".to_owned(),
            "handler_captured_read_set_validation".to_owned(),
            "assets".to_owned(),
            "outbound_actions".to_owned(),
            "bounded_response_stream_v1".to_owned(),
            "bounded_children_v1".to_owned(),
            "notifications".to_owned(),
            "cron".to_owned(),
            "ephemeral_realtime".to_owned(),
            "code_hot_load".to_owned(),
            "multiple_apps_per_deployment".to_owned(),
            "hosted_marketplace".to_owned(),
            "retained_version_resume".to_owned(),
            "write_activity_v1".to_owned(),
        ];
        manifest.resource_limits = vec![
            // V8 wall-clock is enforced by the platform (the object/request is
            // killed); measured value carried in runtime_facts.
            ResourceLimit {
                name: "wall_clock_timeout".to_owned(),
                status: ResourceLimitStatus::Enforced,
            },
            ResourceLimit {
                name: "cpu_budget".to_owned(),
                status: ResourceLimitStatus::Enforced,
            },
            // The 2 MB row/BLOB cap is a hard platform limit (LLP 0014
            // one-way door 8) — a declared divergence from the local target.
            ResourceLimit {
                name: "maximum_row_bytes".to_owned(),
                status: ResourceLimitStatus::Enforced,
            },
            ResourceLimit {
                name: "maximum_storage_bytes".to_owned(),
                status: ResourceLimitStatus::Enforced,
            },
            ResourceLimit {
                name: "maximum_subscription_count".to_owned(),
                status: ResourceLimitStatus::Enforced,
            },
        ];
        manifest.runtime_facts = Some(runtime_facts);
        manifest.refresh_supported_capabilities(TargetCapabilityFacts::default());
        manifest
    }

    fn refresh_supported_capabilities(&mut self, facts: TargetCapabilityFacts) {
        self.supported_capabilities = TargetCapabilityId::ALL
            .into_iter()
            .filter(|capability| capability.is_supported_by(self, facts))
            .collect();
        // @ref LLP 0058#capability-maturity — the maturity map annotates
        // exactly the emitted support set; stable ids are omitted, so a
        // manifest with only stable support serializes without the field.
        self.capability_maturity = self
            .supported_capabilities
            .iter()
            .filter(|capability| capability.maturity() != CapabilityMaturity::Stable)
            .map(|capability| (*capability, capability.maturity()))
            .collect();
    }

    /// Validate one app-artifact requirement against the closed registry and
    /// this target's positive support set. Candidate claims and missing gaps
    /// are deliberately irrelevant. Callers with no acknowledgment channel
    /// get stable-only semantics: an experimental capability is refused
    /// exactly like unsupported one, because an experimental entry is not the
    /// plain 0058 compatibility assertion (LLP 0058 §Capability maturity).
    pub fn require_capability(&self, required: &str) -> SnapbackResult<TargetCapabilityId> {
        self.require_capability_acknowledging(required, &BTreeSet::new())
    }

    /// Requirement resolution with the artifact's experimental
    /// acknowledgments (LLP 0058 §Capability maturity, amendment 2026-07-24).
    /// A required id whose registry maturity is not `stable` admits only when
    /// the requiring artifact lists it in
    /// `acknowledgedExperimentalCapabilities`; acknowledging a stable id is a
    /// harmless no-op, so acknowledgments survive the capability's later
    /// promotion to stable unchanged.
    pub fn require_capability_acknowledging(
        &self,
        required: &str,
        acknowledged: &BTreeSet<TargetCapabilityId>,
    ) -> SnapbackResult<TargetCapabilityId> {
        let capability = required.parse::<TargetCapabilityId>().map_err(|()| {
            SnapbackError::error(
                "SNAPBACK_CAPABILITY_UNSUPPORTED",
                "capability",
                format!("unknown required target capability {required}"),
            )
            .with_details(serde_json::json!({ "capability": required }))
        })?;
        if !self.supported_capabilities.contains(&capability) {
            return Err(SnapbackError::error(
                "SNAPBACK_CAPABILITY_UNSUPPORTED",
                "capability",
                format!("target does not support required capability {required}"),
            )
            .with_details(serde_json::json!({ "capability": required })));
        }
        let maturity = capability.maturity();
        if maturity != CapabilityMaturity::Stable && !acknowledged.contains(&capability) {
            return Err(SnapbackError::error(
                "SNAPBACK_CAPABILITY_UNSUPPORTED",
                "capability",
                format!(
                    "target supports required capability {required} only at {} maturity, \
                     which is not plain support; the requiring artifact must list it in \
                     acknowledgedExperimentalCapabilities",
                    maturity.as_str()
                ),
            )
            .with_details(serde_json::json!({
                "capability": required,
                "maturity": maturity.as_str(),
                "acknowledged": false,
            })));
        }
        Ok(capability)
    }

    pub fn require_capabilities<'a>(
        &self,
        required: impl IntoIterator<Item = &'a str>,
        acknowledged: &BTreeSet<TargetCapabilityId>,
    ) -> SnapbackResult<()> {
        for capability in required {
            self.require_capability_acknowledging(capability, acknowledged)?;
        }
        Ok(())
    }

    /// Parse an artifact's acknowledgment list into registry ids. Unknown
    /// strings are ignored — an acknowledgment can only ever narrow a refusal
    /// for a known id, never mint authority, so lenient parsing is
    /// fail-closed (a typo simply leaves the experimental refusal in place).
    pub fn parse_acknowledged_capabilities<'a>(
        acknowledged: impl IntoIterator<Item = &'a str>,
    ) -> BTreeSet<TargetCapabilityId> {
        acknowledged
            .into_iter()
            .filter_map(|capability| capability.parse::<TargetCapabilityId>().ok())
            .collect()
    }
}

fn validate_artifact_header(
    subsystem: &str,
    expected_kind: &str,
    artifact_kind: &str,
    schema_version: &str,
    content_hash: Option<&str>,
    inputs_hash: Option<&str>,
) -> SnapbackResult<()> {
    if artifact_kind != expected_kind {
        return Err(SnapbackError::error(
            format!(
                "SNAPBACK_STALE_{}_ARTIFACT_KIND",
                subsystem.to_ascii_uppercase()
            ),
            subsystem,
            format!("expected {expected_kind} artifact but received {artifact_kind}"),
        )
        .with_artifact_details(
            expected_kind,
            artifact_kind,
            schema_version,
            content_hash,
            inputs_hash,
        ));
    }

    if !matches!(
        schema_version,
        SNAPBACK_SCHEMA_VERSION | SNAPBACK_SESSIONS_SCHEMA_VERSION
    ) {
        return Err(SnapbackError::error(
            format!(
                "SNAPBACK_STALE_{}_ARTIFACT_VERSION",
                subsystem.to_ascii_uppercase()
            ),
            subsystem,
            format!("unsupported {expected_kind} schema version {schema_version}"),
        )
        .with_artifact_details(
            expected_kind,
            artifact_kind,
            schema_version,
            content_hash,
            inputs_hash,
        ));
    }

    Ok(())
}

trait ArtifactDiagnosticExt {
    fn with_artifact_details(
        self,
        expected_kind: &str,
        artifact_kind: &str,
        schema_version: &str,
        content_hash: Option<&str>,
        inputs_hash: Option<&str>,
    ) -> Self;
}

impl ArtifactDiagnosticExt for SnapbackError {
    fn with_artifact_details(
        mut self,
        expected_kind: &str,
        artifact_kind: &str,
        schema_version: &str,
        content_hash: Option<&str>,
        inputs_hash: Option<&str>,
    ) -> Self {
        self.diagnostic.details = serde_json::json!({
            "expectedArtifactKind": expected_kind,
            "artifactKind": artifact_kind,
            "expectedSchemaVersion": SNAPBACK_SCHEMA_VERSION,
            "supportedSchemaVersions": [SNAPBACK_SCHEMA_VERSION, SNAPBACK_SESSIONS_SCHEMA_VERSION],
            "schemaVersion": schema_version,
            "contentHash": content_hash,
            "inputsHash": inputs_hash,
        });
        self
    }
}

#[cfg(test)]
mod membership_manifest_grammar_tests {
    use super::*;
    use serde_json::json;

    fn result_contract_function(contract: FunctionResultContract) -> FunctionDefinition {
        let mut function = FunctionDefinition::new(
            "resultContractFixture",
            FunctionKind::Mutation,
            FunctionRuntime::IbexModule(IbexModule {
                source: "globalThis.__snapbackHandlers = {};".to_owned(),
                export: "resultContractFixture".to_owned(),
            }),
        );
        function.result_contract_hash =
            Some(result_contract_hash(&contract).expect("hash fixture contract"));
        function.result_contract = contract;
        function
            .required_capabilities
            .push("result_contract_v1".to_owned());
        function
    }

    #[test]
    fn result_contract_hash_authenticates_the_effective_contract() {
        let mut function = result_contract_function(FunctionResultContract::Value {
            value: ResultValueContract::String { max_bytes: 8 },
        });
        validate_result_contract_definition(&function).expect("matching contract hash");

        function.result_contract = FunctionResultContract::Value {
            value: ResultValueContract::String { max_bytes: 9 },
        };
        let error = validate_result_contract_definition(&function)
            .expect_err("a valid-looking stale hash must not authenticate changed semantics");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID"
        );

        let mut explicit_unknown = result_contract_function(FunctionResultContract::Unknown);
        validate_result_contract_definition(&explicit_unknown)
            .expect("explicit unknown is still a hashed effective contract");
        explicit_unknown.result_contract_hash = None;
        explicit_unknown.required_capabilities.clear();
        validate_result_contract_definition(&explicit_unknown)
            .expect("legacy manifests may omit the result contract identity");
    }

    #[test]
    fn result_contract_profile_bounds_and_union_disjointness_are_load_time_authority() {
        let oversized = result_contract_function(FunctionResultContract::Value {
            value: ResultValueContract::String {
                max_bytes: RESULT_CONTRACT_MAX_VALUE_BYTES + 1,
            },
        });
        let error = validate_result_contract_definition(&oversized)
            .expect_err("authored bounds may narrow but never widen the profile");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID"
        );

        let overlapping = result_contract_function(FunctionResultContract::Value {
            value: ResultValueContract::Union {
                variants: vec![
                    ResultValueContract::String { max_bytes: 8 },
                    ResultValueContract::String { max_bytes: 16 },
                ],
            },
        });
        let error = validate_result_contract_definition(&overlapping)
            .expect_err("overlapping unions are not deterministic contracts");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID"
        );
    }

    #[test]
    fn bounded_stream_capability_requires_both_implementation_and_live_egress() {
        let declared = CapabilityManifest::local_v0_declared();
        assert!(!declared.outbound_actions);
        assert!(
            !declared
                .supported_capabilities
                .contains(&TargetCapabilityId::BoundedResponseStreamV1)
        );

        let enabled = CapabilityManifest::local_v0_instance(Vec::new(), true);
        assert!(enabled.outbound_actions);
        assert!(
            enabled
                .supported_capabilities
                .contains(&TargetCapabilityId::BoundedResponseStreamV1)
        );
    }

    // @ref LLP 0080#7-generated-authoring-surface — a maintained projection
    // has no function carrier: codegen surfaces its relational-engine
    // dependence as a schema-level `relational_query_v1` requirement, and
    // the load path chains schema-level requirements through the same
    // `require_capabilities` gate as function requirements. A target
    // without the relational engine therefore refuses the projection
    // bundle at admission, never as a late activation surprise.
    #[test]
    fn projection_schema_requirement_refuses_without_relational_support() {
        let supported = CapabilityManifest::local_v0_declared();
        supported
            .require_capability("relational_query_v1")
            .expect("the local target serves projection-carrying bundles");

        let mut stripped = CapabilityManifest::local_v0_declared();
        stripped
            .supported_capabilities
            .retain(|id| *id != TargetCapabilityId::RelationalQueryV1);
        let refusal = stripped
            .require_capabilities(["relational_query_v1"], &BTreeSet::new())
            .expect_err("a projection bundle refuses on a target without the relational engine");
        assert_eq!(refusal.diagnostic.code, "SNAPBACK_CAPABILITY_UNSUPPORTED");
        assert_eq!(
            refusal.diagnostic.details["capability"],
            "relational_query_v1"
        );
    }

    // @ref LLP 0058#capability-maturity — the maturity map annotates the
    // emitted support set with every non-stable id; stable ids never appear.
    // With `relational_query_v1` and `migration_keyset_scan_v1` promoted as
    // LLP 0080/0081's Implemented act (2026-07-26), the source-published LLP
    // 0104 pair joins the explicitly experimental 0101/0103/0107 contracts.
    #[test]
    fn capability_maturity_promotions_hold_and_admission_stays_fail_closed() {
        let disabled = CapabilityManifest::local_v0_declared();
        // Both promoted ids stay supported by the local runtime…
        assert!(
            disabled
                .supported_capabilities
                .contains(&TargetCapabilityId::RelationalQueryV1)
        );
        assert!(
            disabled
                .supported_capabilities
                .contains(&TargetCapabilityId::MigrationKeysetScanV1)
        );
        let experimental = BTreeMap::from([
            (
                TargetCapabilityId::BoundedChildrenV1,
                CapabilityMaturity::Experimental,
            ),
            (
                TargetCapabilityId::InlineHandlerV1,
                CapabilityMaturity::Experimental,
            ),
            // LLP 0070 first slice: experimental while the RFC is Draft (its
            // claim boundary bars any stable/capability-class reading).
            (
                TargetCapabilityId::JobsOneOffV1,
                CapabilityMaturity::Experimental,
            ),
            (
                TargetCapabilityId::RegisteredBundleBootV1,
                CapabilityMaturity::Experimental,
            ),
            (
                TargetCapabilityId::ResultContractV1,
                CapabilityMaturity::Experimental,
            ),
            (
                TargetCapabilityId::ArgsContractV1,
                CapabilityMaturity::Experimental,
            ),
            (
                TargetCapabilityId::VersionedSeedInstallV1,
                CapabilityMaturity::Experimental,
            ),
            (
                TargetCapabilityId::VersionedSeedResetV1,
                CapabilityMaturity::Experimental,
            ),
            (
                TargetCapabilityId::WriteActivityV1,
                CapabilityMaturity::Experimental,
            ),
        ]);
        assert_eq!(disabled.capability_maturity, experimental);
        assert!(
            disabled
                .supported_capabilities
                .contains(&TargetCapabilityId::BoundedChildrenV1)
                && disabled
                    .supported_capabilities
                    .contains(&TargetCapabilityId::WriteActivityV1),
            "the reviewed embedded local carrier publishes the atomic relation/activity pair",
        );
        assert!(
            disabled
                .supported_capabilities
                .contains(&TargetCapabilityId::RegisteredBundleBootV1),
            "registered bundle boot is advertised only by the proven target implementation",
        );
        let enabled = CapabilityManifest::local_v0_instance(Vec::new(), true);
        assert!(
            enabled
                .supported_capabilities
                .contains(&TargetCapabilityId::BoundedResponseStreamV1)
        );
        assert_eq!(enabled.capability_maturity, experimental);

        // Serialization retains the experimental advertisement gate.
        let plain = serde_json::to_value(&enabled).expect("serialize");
        assert!(plain.get("capabilityMaturity").is_some());
        let round_tripped: CapabilityManifest =
            serde_json::from_value(plain).expect("deserialize maturity map");
        assert_eq!(round_tripped.capability_maturity, experimental);

        // Promoted ids are plain support: they admit with NO acknowledgment
        // at all — before 2026-07-26 the first two refusals below were the
        // experimental-gate witnesses.
        enabled
            .require_capability("relational_query_v1")
            .expect("promoted relational support admits without acknowledgment");
        enabled
            .require_capability("migration_keyset_scan_v1")
            .expect("promoted migration-scan support admits without acknowledgment");
        enabled
            .require_capability("bounded_response_stream_v1")
            .expect("stable support admits without acknowledgment");
        assert_eq!(
            enabled
                .require_capability("inline_handler_v1")
                .expect_err("experimental support requires an artifact acknowledgment")
                .diagnostic
                .code,
            "SNAPBACK_CAPABILITY_UNSUPPORTED"
        );
        assert_eq!(
            enabled
                .require_capability("bounded_children_v1")
                .expect_err("experimental local publication requires an artifact acknowledgment")
                .diagnostic
                .code,
            "SNAPBACK_CAPABILITY_UNSUPPORTED"
        );

        // Pre-promotion acknowledgments for stable ids remain harmless, while
        // the current experimental ids admit only through the explicit gate.
        let acknowledged = CapabilityManifest::parse_acknowledged_capabilities([
            "inline_handler_v1",
            "bounded_children_v1",
            "relational_query_v1",
            "bounded_response_stream_v1",
            "live_subscriptions",
            "write_activity_v1",
            "not.a.known.capability",
        ]);
        enabled
            .require_capability_acknowledging("relational_query_v1", &acknowledged)
            .expect("a surviving pre-promotion acknowledgment stays a no-op");
        enabled
            .require_capability_acknowledging("live_subscriptions", &acknowledged)
            .expect("acknowledging a stable id is a no-op");
        enabled
            .require_capability_acknowledging("inline_handler_v1", &acknowledged)
            .expect("acknowledged experimental support admits");
        enabled
            .require_capability_acknowledging("bounded_children_v1", &acknowledged)
            .expect("acknowledged bounded-children support admits");
        enabled
            .require_capability_acknowledging("write_activity_v1", &acknowledged)
            .expect("acknowledged write/activity support admits");
        assert_eq!(
            disabled
                .require_capability_acknowledging("bounded_response_stream_v1", &acknowledged)
                .expect_err("acknowledgment cannot mint support")
                .diagnostic
                .code,
            "SNAPBACK_CAPABILITY_UNSUPPORTED"
        );
    }

    #[test]
    fn relation_activity_publication_is_exactly_local_and_source_owned() {
        assert!(
            local_relation_activity_publication_verified(),
            "the tracked carrier must match its receipt, source bytes, and compiled digest",
        );

        for manifest in [
            CapabilityManifest::remote_service_sqlite_ibex_declared(),
            CapabilityManifest::conformance_workerd_v8(json!({})),
            CapabilityManifest::cloudflare_do_sqlite_v8(json!({})),
        ] {
            for (id, gap) in [
                (TargetCapabilityId::BoundedChildrenV1, "bounded_children_v1"),
                (TargetCapabilityId::WriteActivityV1, "write_activity_v1"),
            ] {
                assert!(
                    !manifest.supported_capabilities.contains(&id),
                    "{} must not inherit the local source publication",
                    manifest.target_profile_id,
                );
                assert!(
                    manifest
                        .capability_gaps
                        .iter()
                        .any(|candidate| candidate == gap),
                    "{} must retain the structured {gap} GAP",
                    manifest.target_profile_id,
                );
            }
        }

        let mut local = CapabilityManifest::local_v0_declared();
        local.refresh_supported_capabilities(
            TargetCapabilityFacts::local_auth_aware().with_relation_activity_publication_withheld(),
        );
        assert!(
            !local
                .supported_capabilities
                .contains(&TargetCapabilityId::BoundedChildrenV1)
                && !local
                    .supported_capabilities
                    .contains(&TargetCapabilityId::WriteActivityV1),
            "target facts, not manifest fields from an app artifact, own publication authority",
        );
    }

    #[test]
    fn packaged_relation_activity_publication_withholds_atomic_pair_as_structured_gaps() {
        let facts = TargetCapabilityFacts::local_auth_aware_for_distribution(
            crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE,
        );
        let manifest =
            CapabilityManifest::local_v0_with_facts(local_v0_default_capability_gaps(), facts);

        for (id, gap) in [
            (TargetCapabilityId::BoundedChildrenV1, "bounded_children_v1"),
            (TargetCapabilityId::WriteActivityV1, "write_activity_v1"),
        ] {
            assert!(!manifest.supported_capabilities.contains(&id));
            assert!(
                manifest
                    .capability_gaps
                    .iter()
                    .any(|candidate| candidate == gap),
                "public package must retain the structured {gap} GAP",
            );
            assert_eq!(id.maturity(), CapabilityMaturity::Experimental);
        }
    }

    #[test]
    fn compiled_build_distribution_owns_relation_activity_publication() {
        let manifest = CapabilityManifest::local_v0_declared();
        let source_authority = crate::identity::build_distribution()
            == crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE;
        for (id, gap) in [
            (TargetCapabilityId::BoundedChildrenV1, "bounded_children_v1"),
            (TargetCapabilityId::WriteActivityV1, "write_activity_v1"),
        ] {
            assert_eq!(
                manifest.supported_capabilities.contains(&id),
                source_authority
            );
            assert_eq!(
                manifest
                    .capability_gaps
                    .iter()
                    .any(|candidate| candidate == gap),
                !source_authority,
            );
        }
    }

    #[test]
    fn relation_activity_publication_tamper_and_package_substitutions_fail_closed() {
        let mut tampered_carrier = LOCAL_RELATION_ACTIVITY_PUBLICATION_BYTES.to_vec();
        tampered_carrier[0] ^= 1;
        assert!(!local_relation_activity_publication_verified_for(
            crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
            &tampered_carrier,
            LOCAL_RELATION_ACTIVITY_PUBLICATION_SHA256,
            LOCAL_RELATION_ACTIVITY_QUALIFICATION_RECEIPT_BYTES,
        ));

        let mut stale_receipt = LOCAL_RELATION_ACTIVITY_QUALIFICATION_RECEIPT_BYTES.to_vec();
        stale_receipt.push(b'\n');
        assert!(!local_relation_activity_publication_verified_for(
            crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
            LOCAL_RELATION_ACTIVITY_PUBLICATION_BYTES,
            LOCAL_RELATION_ACTIVITY_PUBLICATION_SHA256,
            &stale_receipt,
        ));

        // @ref LLP 0110#local-and-packaged-publication-authority — until a
        // release-key verifier and exact PackageCapabilityAttestationV1 are
        // embedded, the public-package distribution cut must reject every
        // mandatory negative before any carrier detail can become authority.
        for attempted_substitution in [
            "tampered embedded carrier",
            "another binary sha256",
            "another target triple",
            "stale installed graph",
            "old package closure",
            "unknown signing key",
            "rollback-incompatible package",
            "candidate artifact substitution",
        ] {
            assert!(
                !local_relation_activity_publication_verified_for(
                    crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE,
                    LOCAL_RELATION_ACTIVITY_PUBLICATION_BYTES,
                    LOCAL_RELATION_ACTIVITY_PUBLICATION_SHA256,
                    LOCAL_RELATION_ACTIVITY_QUALIFICATION_RECEIPT_BYTES,
                ),
                "{attempted_substitution} must not cross the package GAP",
            );
        }
    }

    fn write_activity_plan_fixture() -> WriteWithActivityPlan {
        let scope_id = ValueExpr::Arg("incidentId".to_owned());
        let source_id = ValueExpr::Arg("taskId".to_owned());
        let provenance = WriteActivityProvenanceFields {
            scope_id: "incidentId".to_owned(),
            source_table: "sourceTable".to_owned(),
            source_id: "sourceId".to_owned(),
            operation: "operation".to_owned(),
            effective_subject: "effectiveSubject".to_owned(),
            actual_actor: "actualActor".to_owned(),
            actor_kind: "actorKind".to_owned(),
            grant: "grantId".to_owned(),
            occurred_at: "occurredAt".to_owned(),
            mutation: "mutationDigest".to_owned(),
        };
        let activity_values = BTreeMap::from([
            (provenance.scope_id.clone(), scope_id.clone()),
            (
                provenance.source_table.clone(),
                ValueExpr::Literal(json!("tasks")),
            ),
            (provenance.source_id.clone(), source_id.clone()),
            (
                provenance.operation.clone(),
                ValueExpr::Literal(json!("patch")),
            ),
            (provenance.effective_subject.clone(), ValueExpr::AuthUserId),
            (provenance.actual_actor.clone(), ValueExpr::AuthActorUserId),
            (
                provenance.actor_kind.clone(),
                ValueExpr::AuthActivityActorKind,
            ),
            (provenance.grant.clone(), ValueExpr::AuthGrantId),
            (provenance.occurred_at.clone(), ValueExpr::RuntimeNow),
            (provenance.mutation.clone(), ValueExpr::ClientMutationDigest),
        ]);
        let relation_assertion = MutationStep::AssertCurrentRelation {
            table: "tasks".to_owned(),
            id: source_id.clone(),
            scope_table: "incidents".to_owned(),
            scope_id: scope_id.clone(),
            foreign_key_field: "incidentId".to_owned(),
            incarnation_field: "incidentIncarnation".to_owned(),
            else_error: "SNAPBACK_ROW_NOT_FOUND".to_owned(),
        };
        WriteWithActivityPlan {
            profile: "write-with-activity.v1".to_owned(),
            required_capability: "write_activity_v1".to_owned(),
            mode: WriteWithActivityMode::ExistingOwnerV1,
            scope_table: "incidents".to_owned(),
            scope_id: scope_id.clone(),
            scope_owner_field: "ownerId".to_owned(),
            source_table: "tasks".to_owned(),
            source_id: source_id.clone(),
            source_operation: WriteWithActivitySourceOperation::Patch,
            activity_table: "activity".to_owned(),
            activity_scope_foreign_key: provenance.scope_id.clone(),
            activity_scope_incarnation: "incidentIncarnation".to_owned(),
            relations: vec![WriteActivityRelation {
                table: "tasks".to_owned(),
                scope_foreign_key: "incidentId".to_owned(),
                scope_incarnation: "incidentIncarnation".to_owned(),
            }],
            provenance_fields: provenance,
            effect_formula: WriteWithActivityEffectFormula {
                scope_reads: 1,
                scope_patches: 0,
                auxiliary_point_reads: 2,
                source_writes: 1,
                activity_inserts: 1,
                runtime_ids: 1,
                runtime_now: 1,
                settlement_lookups: 1,
                settlement_writes: 1,
                maximum_application_writes: 2,
            },
            mutation: MutationPlan {
                steps: vec![
                    MutationStep::Get {
                        table: "incidents".to_owned(),
                        id: scope_id,
                        bind_as: "__activityScope".to_owned(),
                        else_error: Some("SNAPBACK_ROW_NOT_FOUND".to_owned()),
                    },
                    MutationStep::Guard {
                        cond: ValueExpr::Binary {
                            op: BinaryOp::Eq,
                            left: Box::new(ValueExpr::Field {
                                base: Box::new(ValueExpr::Binding("__activityScope".to_owned())),
                                key: "ownerId".to_owned(),
                            }),
                            right: Box::new(ValueExpr::AuthUserId),
                        },
                        else_error: "SNAPBACK_ROW_NOT_FOUND".to_owned(),
                    },
                    relation_assertion,
                    MutationStep::Patch {
                        table: "tasks".to_owned(),
                        id: source_id.clone(),
                        values: BTreeMap::from([(
                            "body".to_owned(),
                            ValueExpr::Literal(json!("patched")),
                        )]),
                    },
                    MutationStep::AssertSourceChanged {
                        table: "tasks".to_owned(),
                        id: source_id,
                        operation: WriteWithActivitySourceOperation::Patch,
                    },
                    MutationStep::Insert {
                        table: "activity".to_owned(),
                        values: activity_values,
                        bind_id_as: Some("__activityId".to_owned()),
                    },
                ],
                return_value: Some(ReturnValue::Expr(ValueExpr::Binding(
                    "__activityId".to_owned(),
                ))),
            },
        }
    }

    #[test]
    fn write_activity_direct_artifact_cannot_forge_the_closed_plan_or_ceiling() {
        let valid = write_activity_plan_fixture();
        validate_write_with_activity_plan_shape(&valid).expect("generated closed plan");

        let mut extra_scope_write = valid.clone();
        extra_scope_write.mutation.steps.insert(
            4,
            MutationStep::Delete {
                table: "incidents".to_owned(),
                id: extra_scope_write.scope_id.clone(),
            },
        );
        assert!(
            validate_write_with_activity_plan_shape(&extra_scope_write).is_err(),
            "a direct artifact cannot hide an extra scope write behind the claimed ceiling",
        );

        let mut forged_provenance = valid.clone();
        let actor_field = forged_provenance.provenance_fields.actual_actor.clone();
        let Some(MutationStep::Insert { values, .. }) = forged_provenance.mutation.steps.last_mut()
        else {
            panic!("activity insert fixture");
        };
        values.insert(actor_field, ValueExpr::Arg("claimedActor".to_owned()));
        assert!(
            validate_write_with_activity_plan_shape(&forged_provenance).is_err(),
            "activity actor provenance is server-owned",
        );

        let mut forged_ceiling = valid.clone();
        forged_ceiling.effect_formula.auxiliary_point_reads = 0;
        assert!(
            validate_write_with_activity_plan_shape(&forged_ceiling).is_err(),
            "the declared quantitative ceiling is reconstructed from the executable plan",
        );

        let mut extra_runtime_id = valid.clone();
        let Some(MutationStep::Patch { values, .. }) = extra_runtime_id.mutation.steps.get_mut(3)
        else {
            panic!("source patch fixture");
        };
        values.insert("nonce".to_owned(), ValueExpr::RuntimeId);
        assert!(
            validate_write_with_activity_plan_shape(&extra_runtime_id).is_err(),
            "runtime ids are allocated only by the source/activity insert steps",
        );

        let mut authoritative_escape = valid.clone();
        authoritative_escape.mutation.steps.insert(
            2,
            MutationStep::Guard {
                cond: ValueExpr::MembershipExists(Box::new(MembershipPredicate {
                    declaration: "incidentMembers".to_owned(),
                    resource: MembershipResourceRef::Arg {
                        path: "incidentId".to_owned(),
                        resource_table: Some("incidents".to_owned()),
                    },
                    roles: None,
                })),
                else_error: "SNAPBACK_GUARD_FAILED".to_owned(),
            },
        );
        assert!(
            validate_write_with_activity_plan_shape(&authoritative_escape).is_err(),
            "the closed write profile cannot smuggle in an authoritative membership read",
        );

        let mut empty_source_patch = valid.clone();
        let Some(MutationStep::Patch { values, .. }) = empty_source_patch.mutation.steps.get_mut(3)
        else {
            panic!("source patch fixture");
        };
        values.clear();
        assert!(
            validate_write_with_activity_plan_shape(&empty_source_patch).is_err(),
            "an empty source patch cannot enter the source-effect profile",
        );

        let mut aliased_provenance = valid.clone();
        aliased_provenance.provenance_fields.actual_actor =
            aliased_provenance.activity_scope_incarnation.clone();
        assert!(
            validate_write_with_activity_plan_shape(&aliased_provenance).is_err(),
            "the protected incarnation field cannot alias activity provenance",
        );

        let mut maximum_guards = valid.clone();
        for _ in 0..16 {
            maximum_guards.mutation.steps.insert(
                2,
                MutationStep::Guard {
                    cond: ValueExpr::Literal(json!(true)),
                    else_error: "SNAPBACK_GUARD_FAILED".to_owned(),
                },
            );
        }
        validate_write_with_activity_plan_shape(&maximum_guards)
            .expect("sixteen authored Guard/Let steps are admitted");
        let mut too_many_guards = maximum_guards;
        too_many_guards.mutation.steps.insert(
            2,
            MutationStep::Guard {
                cond: ValueExpr::Literal(json!(true)),
                else_error: "SNAPBACK_GUARD_FAILED".to_owned(),
            },
        );
        assert!(
            validate_write_with_activity_plan_shape(&too_many_guards).is_err(),
            "direct artifacts share the authored Guard/Let ceiling",
        );

        let mut future_mode = valid;
        future_mode.mode = WriteWithActivityMode::CreateOwnerV1;
        assert!(
            validate_write_with_activity_plan_shape(&future_mode).is_err(),
            "the reserved create-owner mode stays unavailable until it has an implementation corpus",
        );
    }

    fn table_json() -> Value {
        json!({
            "name": "eventMembers",
            "fields": [
                { "name": "userId", "field_type": "Principal", "optional": false },
                { "name": "eventId", "field_type": { "Id": { "table": "events" } }, "optional": false },
                { "name": "role", "field_type": "String", "optional": false },
                { "name": "expiresAt", "field_type": "Integer", "optional": true }
            ],
            "membership": {
                "principal": "userId",
                "resource": "eventId",
                "resourceTable": "events",
                "role": "role",
                "roles": ["host", "guest"],
                "bootstrapRole": "host",
                "lastHolder": { "protect": "host" },
                "expiry": { "field": "expiresAt", "onExpiry": "remove" },
                "transitions": [{
                    "op": "patch",
                    "by": ["host"],
                    "target": "other",
                    "from": ["guest"],
                    "fields": ["expiresAt"]
                }]
            }
        })
    }

    #[test]
    fn membership_security_grammar_rejects_unknown_fields_at_every_layer() {
        let mut cases = Vec::new();

        let mut outer = table_json();
        outer
            .as_object_mut()
            .unwrap()
            .insert("membershp".into(), json!({}));
        cases.push(outer);

        for (path, typo) in [
            ("membership", "resourceTabel"),
            ("membership", "lastHodler"),
            ("lastHolder", "unknown"),
            ("expiry", "unknown"),
            ("transition", "frmo"),
            ("transition", "unknown"),
        ] {
            let mut value = table_json();
            let membership = value["membership"].as_object_mut().unwrap();
            match path {
                "membership" => {
                    membership.insert(typo.into(), json!(null));
                }
                "lastHolder" => {
                    membership["lastHolder"]
                        .as_object_mut()
                        .unwrap()
                        .insert(typo.into(), json!(true));
                }
                "expiry" => {
                    membership["expiry"]
                        .as_object_mut()
                        .unwrap()
                        .insert(typo.into(), json!(true));
                }
                "transition" => {
                    membership["transitions"][0]
                        .as_object_mut()
                        .unwrap()
                        .insert(typo.into(), json!(["guest"]));
                }
                _ => unreachable!(),
            }
            cases.push(value);
        }

        for value in cases {
            assert!(
                serde_json::from_value::<TableManifest>(value).is_err(),
                "unknown security field must fail closed"
            );
        }
    }

    #[test]
    fn nominal_id_field_round_trips_its_target_table() {
        let field = FieldType::Id {
            table: "events".to_owned(),
        };
        let encoded = serde_json::to_value(&field).expect("serialize nominal id");
        assert_eq!(encoded, json!({ "Id": { "table": "events" } }));
        assert_eq!(
            serde_json::from_value::<FieldType>(encoded).expect("parse nominal id"),
            field
        );
    }

    #[test]
    fn membership_argument_resource_ref_carries_nominal_table_provenance() {
        let resource = MembershipResourceRef::Arg {
            path: "event.id".to_owned(),
            resource_table: Some("events".to_owned()),
        };
        let encoded = serde_json::to_value(&resource).expect("serialize resource ref");
        assert_eq!(
            encoded,
            json!({
                "arg": {
                    "path": "event.id",
                    "resourceTable": "events"
                }
            })
        );
        assert_eq!(
            serde_json::from_value::<MembershipResourceRef>(encoded)
                .expect("parse nominal resource ref"),
            resource
        );
        assert!(
            serde_json::from_value::<MembershipResourceRef>(json!({ "arg": "event.id" })).is_err(),
            "the old bare-string artifact shape erased nominal provenance"
        );
        assert!(
            serde_json::from_value::<MembershipResourceRef>(json!({
                "arg": {
                    "path": "event.id",
                    "resourceTable": "events",
                    "resourceTabel": "projects"
                }
            }))
            .is_err(),
            "unknown fields inside the authorization reference fail closed"
        );
    }
}
