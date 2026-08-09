//! Language-neutral shared contract type definitions.
//!
//! This module is a dependency-free leaf. Higher-level manifest and runtime
//! modules may consume these definitions, but contract types must not depend on
//! those owners.
//!
//! @ref LLP 0199#target-ownership-map — the shared contract/types leaf is the
//!   canonical downward dependency for Rust owners and generated artifacts.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agents: Option<AgentsManifest>,
}

/// App-owned declaration of the outward-facing function surface. Absence (or
/// `enabled: false`) preserves the existing first-party/grant behavior; when
/// enabled, every function is closed unless its named entry opts in.
///
/// @ref LLP 0204#d1--the-exposure-declaration-keystone — exposure is one
/// declaration governing callability and public projections.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiManifest {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub disclosure: ApiDisclosure,
    #[serde(default)]
    pub functions: BTreeMap<String, ApiFunctionExposure>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origins: Option<Vec<String>>,
}

#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum ApiDisclosure {
    #[default]
    ExposedOnly,
    Full,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiFunctionExposure {
    #[serde(default)]
    pub expose: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
}

/// App policy for creating new agent principals. Absence is deliberately
/// equivalent to `disabled` rather than opening an ambient signup surface.
///
/// @ref LLP 0055#registration — registration is sessions-only, disabled by
/// default, and user invitations require an explicit `invitedBy` opt-in.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentsManifest {
    #[serde(default)]
    pub mode: AgentsMode,
    #[serde(default)]
    pub invited_by: InvitedBy,
    /// Parse-time presence bit used only by declarations, never emitted on
    /// the wire. `api.enabled` needs to distinguish omitted mode (whose
    /// ordinary registration behavior still defaults closed) from an author
    /// explicitly selecting `disabled`.
    // @ref LLP 0204#d1--the-exposure-declaration-keystone — enabled external
    // surfaces require an explicit registration posture, including disabled.
    #[serde(skip)]
    #[schemars(skip)]
    pub mode_explicit: bool,
}

impl AgentsManifest {
    pub const fn explicit(mode: AgentsMode, invited_by: InvitedBy) -> Self {
        Self {
            mode,
            invited_by,
            mode_explicit: true,
        }
    }
}

impl<'de> Deserialize<'de> for AgentsManifest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct WireAgentsManifest {
            #[serde(default)]
            mode: Option<AgentsMode>,
            #[serde(default)]
            invited_by: InvitedBy,
        }

        let wire = WireAgentsManifest::deserialize(deserializer)?;
        Ok(Self {
            mode: wire.mode.unwrap_or_default(),
            invited_by: wire.invited_by,
            mode_explicit: wire.mode.is_some(),
        })
    }
}

#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum AgentsMode {
    #[default]
    Disabled,
    Invited,
    Open,
}

impl AgentsMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Invited => "invited",
            Self::Open => "open",
        }
    }
}

#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum InvitedBy {
    #[default]
    Operators,
    Users,
}

impl InvitedBy {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Operators => "operators",
            Self::Users => "users",
        }
    }
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
pub struct FieldManifest {
    pub name: String,
    pub field_type: FieldType,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum FieldType {
    String,
    /// A closed, declaration-ordered domain of two through eight exact string
    /// values. The authored order is part of manifest identity and generated
    /// TypeScript projection; storage remains the ordinary portable text
    /// representation.
    ///
    /// @ref LLP 0004#dated-alignment-stored-literal-union-domains-2026-08-08
    Enum {
        values: Vec<String>,
    },
    Boolean,
    Integer,
    Real,
    /// `v.vector(dimensions)` — an exact fixed-dimension binary64 vector.
    /// Ordinary arrays keep their separate 1,024-item contract ceiling.
    ///
    /// @ref LLP 0132#the-vvectordimensions-value
    Vector {
        dimensions: u32,
    },
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
    /// `v.assetRef({ upload? })` — a typed asset reference (LLP 0044 §Typed
    /// references; LLP 0007 dated amendment 2026-07-31). Stored as the opaque
    /// asset id string; the commit boundary validates every write's
    /// admission, so a raw string assignment fails there rather than by
    /// shape. The optional `upload` restriction names the upload-intent
    /// binding whose assets the field admits and is what lets write paths
    /// without handler execution derive a commit-boundary admission.
    AssetRef {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        upload: Option<String>,
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
    /// A typed asset reference in a handler result. Its post-JSON wire image
    /// is the non-empty opaque asset id string; attachment authority remains
    /// a storage-commit concern rather than an egress-shape concern.
    AssetRef,
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
    /// A declaration-ordered heterogeneous fixed tuple. Snapshot-batch uses
    /// this closed node so each visible child page keeps its own projection
    /// contract instead of being widened to a homogeneous array.
    ///
    /// @ref LLP 0135#23-seal-entirely-partial-refusal — visible composite
    ///   nodes are an exact static tuple, not a bag of widened values.
    Tuple {
        elements: Vec<ResultValueContract>,
    },
    /// One exact fixed-dimension binary64 vector. This is intentionally not
    /// encoded as an ordinary array: dimensions may reach 4,096 while the
    /// general collection node remains capped at 1,024.
    ///
    /// @ref LLP 0132#the-vvectordimensions-value
    Vector {
        dimensions: u32,
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

/// One declared sequence counter and the structural proof that an invocation
/// may observe its allocation count. `public.v1` is deliberately a string on
/// the wire because it is the reviewed disclosure spelling pinned by LLP
/// 0135; non-public access names the membership declaration and exact roles
/// the host evaluates against the supplied scope row.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(untagged)]
pub enum SequenceScopeAccess {
    Public(String),
    Membership {
        declaration: String,
        roles: Vec<String>,
    },
    ExistingOwner(SequenceExistingOwnerAccess),
}

/// Generated-plan access proof. The function's normalized
/// `write-with-activity.v1` plan must carry the same scope table, owner field,
/// scope expression, and parent-unavailable refusal before this profile is
/// admitted; handlers cannot author this variant.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SequenceExistingOwnerAccess {
    pub kind: String,
    pub owner_field: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SequenceDeclaration {
    pub name: String,
    pub scope_table: String,
    pub scope_access: SequenceScopeAccess,
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

/// The versioned helper/profile identity a standard-pattern function carries
/// (LLP 0065 §3).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StandardPatternIdentity {
    pub helper: String,
    pub profile: String,
    /// Membership-specific generation facts for callable keyset pages. This
    /// block is closed and is admitted only for the exact
    /// `membership-keyset-pages.v1` / `membership.v1` pair.
    ///
    /// @ref LLP 0100#5-index-and-continuation-contract — membership cursor
    ///   custody binds the declaration, resource argument/field, and canonical
    ///   role set; other helpers must not smuggle an uninterpreted block.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub membership: Option<StandardPatternMembershipIdentity>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StandardPatternMembershipIdentity {
    pub declaration: String,
    #[serde(rename = "resourceArg", alias = "resource_arg")]
    pub resource_arg: String,
    #[serde(rename = "resourceField", alias = "resource_field")]
    pub resource_field: String,
    pub roles: Vec<String>,
}

#[derive(
    Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
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
    /// Fixed host bookkeeping; v1 admits zero or one allocation.
    #[serde(default)]
    pub sequence_allocations: u8,
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct IbexModule {
    pub source: String,
    pub export: String,
}
