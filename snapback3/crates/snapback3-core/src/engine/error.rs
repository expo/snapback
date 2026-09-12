use super::*;

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("{}: {}", .0.code, .0.message)]
    Refusal(Box<crate::CheckError>),
    #[error("{0}")]
    Job(Box<crate::jobs::JobRefusal>),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Value(#[from] ValueError),
    #[error("E_SCHEMA: {0}")]
    Schema(String),
    #[error("E_SCHEMA_RESERVED: schema or program names reserved table {0}")]
    SchemaReserved(String),
    #[error(
        "E_SCHEMA_INDEX_COLUMN: index {table}.{index} cannot use non-indexable column {column}"
    )]
    SchemaIndexColumn {
        table: String,
        index: String,
        column: String,
    },
    #[error("E_SCHEMA_CONSTRAINT: {message}")]
    SchemaConstraint { message: String, rewrite: String },
    #[error("E_SCHEMA_MAINTAIN: {0}")]
    SchemaMaintain(String),
    /// A `deliver` declaration or generated table refused under its own code
    /// (`E_DELIVER_UNBOUNDED`, `E_DELIVER_PRINCIPAL`, `E_SCHEMA_DELIVER`), so
    /// `check --ir` reports the family and page the compiler would.
    #[error("{code}: {message}")]
    SchemaDeliver {
        code: String,
        message: String,
        rewrite: String,
    },
    #[error("E_SERIALIZATION: {0}")]
    Serialization(String),
    #[error("E_REQUIRE:{code}: program requirement failed")]
    Require { code: String, site: Option<String> },
    #[error("E_CONFLICT: the row no longer matches the update condition")]
    Conflict { current: Read },
    #[error("E_RULE: {effect:?} denied on {table}")]
    Rule { table: String, effect: Effect },
    #[error("E_CONSTRAINT: {0}")]
    Constraint(String),
    #[error("E_FANOUT: runtime loop exceeded its admitted bound")]
    Fanout,
    #[error("E_STEPS: runtime steps exceeded certificate {0}")]
    Steps(u64),
    #[error("E_INPUT: {0}")]
    Input(String),
    #[error("E_ASSET_TYPE: {0}")]
    AssetType(String),
    #[error("E_ASSET_TOO_LARGE: {0}")]
    AssetTooLarge(String),
    #[error("E_ASSET_NOT_READY: {0}")]
    AssetNotReady(String),
    #[error("E_ASSET_IN_USE: {0}")]
    AssetInUse(String),
    #[error("E_ASSET_VIEWED: {0}")]
    AssetViewed(String),
    #[error("E_SCHEMA_SEED_ASSET: {table}.{column} cannot contain an asset value in seed data")]
    SchemaSeedAsset { table: String, column: String },
    #[error("E_STORE_OWNED: {holder}")]
    StoreOwned { holder: String },
    #[error("E_STORE_VERSION: {detail}; reset the development store")]
    StoreVersion { detail: String },
    #[error("E_TRACE_SUBSET: {0}")]
    TraceSubset(String),
    #[error("E_OP_UNKNOWN: {0}")]
    OpUnknown(String),
    #[error("E_MIGRATION_PLAN: {0}")]
    MigrationPlan(String),
    #[error(transparent)]
    Successor(#[from] Box<crate::successor::SuccessorRefusal>),
}

impl RuntimeError {
    pub fn require_code(&self) -> Option<String> {
        match self {
            Self::Require { code, .. } => Some(code.clone()),
            _ => None,
        }
    }

    pub fn require_site(&self) -> Option<String> {
        match self {
            Self::Require { site, .. } => site.clone(),
            Self::Refusal(error) => error.site.clone(),
            Self::Conflict { current } => Some(current.site.clone()),
            _ => None,
        }
    }

    pub fn rewrite(&self) -> Option<String> {
        match self {
            Self::Refusal(error) => Some(error.rewrite.clone()),
            _ => None,
        }
    }

    pub fn code(&self) -> &str {
        match self {
            Self::Job(error) => &error.code,
            Self::Refusal(error) => &error.code,
            Self::Sql(_) if is_sqlite_constraint(self) => "E_CONSTRAINT",
            Self::Sql(_) => "E_SQL",
            Self::Value(error) => match error {
                ValueError::Overflow(_) => "E_OVERFLOW",
                ValueError::Type { .. } => "E_TYPE",
                ValueError::MissingField(_) => "E_FIELD",
                ValueError::DivideByZero => "E_DIV_ZERO",
            },
            Self::Schema(_) => "E_SCHEMA",
            Self::SchemaReserved(_) => "E_SCHEMA_RESERVED",
            Self::SchemaIndexColumn { .. } => "E_SCHEMA_INDEX_COLUMN",
            Self::SchemaMaintain(_) => "E_SCHEMA_MAINTAIN",
            Self::SchemaDeliver { code, .. } => code,
            Self::SchemaConstraint { .. } => "E_SCHEMA_CONSTRAINT",
            Self::Serialization(_) => "E_SERIALIZATION",
            Self::Require { code, .. } => code,
            Self::Conflict { .. } => "E_CONFLICT",
            Self::Rule { .. } => "E_RULE",
            Self::Constraint(_) => "E_CONSTRAINT",
            Self::Fanout => "E_FANOUT",
            Self::Steps(_) => "E_STEPS",
            Self::Input(_) => "E_INPUT",
            Self::AssetType(_) => "E_ASSET_TYPE",
            Self::AssetTooLarge(_) => "E_ASSET_TOO_LARGE",
            Self::AssetNotReady(_) => "E_ASSET_NOT_READY",
            Self::AssetInUse(_) => "E_ASSET_IN_USE",
            Self::AssetViewed(_) => "E_ASSET_VIEWED",
            Self::SchemaSeedAsset { .. } => "E_SCHEMA_SEED_ASSET",
            Self::StoreOwned { .. } => "E_STORE_OWNED",
            Self::StoreVersion { .. } => "E_STORE_VERSION",
            Self::TraceSubset(_) => "E_TRACE_SUBSET",
            Self::OpUnknown(_) => "E_OP_UNKNOWN",
            Self::MigrationPlan(_) => "E_MIGRATION_PLAN",
            Self::Successor(refusal) => &refusal.code,
        }
    }
}

impl Serialize for RuntimeError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;

        let mut error = serializer.serialize_struct("RuntimeError", 2)?;
        error.serialize_field("code", self.code())?;
        error.serialize_field("message", &self.to_string())?;
        error.end()
    }
}
