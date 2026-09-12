//! The Quarry syntax tree, ported from Snapback 2 with `sync` in place of
//! `deliver` and without the channel, schedule and search forms this slice
//! does not bind.

use crate::diag::Site;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TypeKind {
    Cursor,
    Text { min: Option<u32>, max: u32, format: Option<String> },
    Id,
    Principal,
    Int,
    Decimal { scale: u8 },
    Money { currency: String, scale: u8 },
    Time,
    Bool,
    Json { max: u32 },
    Bytes { max: u32 },
    Image { max: u32, once: bool },
    Video { max: u32 },
    Enum { variants: Vec<String> },
    Ref { table: String },
    List { item: Box<ScalarType>, max: u32 },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScalarType {
    pub kind: TypeKind,
    pub optional: bool,
}

impl ScalarType {
    pub fn required(&self) -> ScalarType {
        ScalarType { kind: self.kind.clone(), optional: false }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeyPart {
    pub column: Option<String>,
    pub value: Expr,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShapeField {
    Spread { site: Site },
    NamedSpread { name: String, site: Site },
    Bare { name: String, site: Site },
    Field { name: String, value: Expr, site: Site },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShapeDecl {
    pub name: String,
    pub fields: Vec<ShapeField>,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FunctionDecl {
    pub name: String,
    pub args: Vec<ArgDecl>,
    pub body: Expr,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProcDecl {
    pub name: String,
    pub args: Vec<ArgDecl>,
    pub body: Vec<Stmt>,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Import {
    pub name: String,
    pub module: String,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Literal {
    Str(String),
    Number(String),
    Bool(bool),
    Null,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Order {
    Asc,
    Desc,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RangeSpec {
    pub order: Order,
    pub take: u32,
    pub cursor: Option<Box<Expr>>,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReadExpr {
    pub table: String,
    pub keys: Vec<KeyPart>,
    pub index: Option<String>,
    pub range: Option<RangeSpec>,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MergeLane {
    pub prefix: Vec<Expr>,
    pub columns: Option<Vec<Option<String>>>,
    pub loop_: Option<(String, ReadExpr)>,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MergeExpr {
    pub table: String,
    pub index: String,
    pub order: Order,
    pub take: u32,
    pub cursor: Option<Box<Expr>>,
    pub lanes: Vec<MergeLane>,
    pub site: Site,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WriteOp {
    Insert,
    Update,
    Upsert,
    Delete,
}

impl WriteOp {
    pub fn word(self) -> &'static str {
        match self {
            Self::Insert => "insert",
            Self::Update => "update",
            Self::Upsert => "upsert",
            Self::Delete => "delete",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObjectField {
    pub name: String,
    pub value: Option<Expr>,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Expr {
    Name { name: String, site: Site },
    Focal { site: Site },
    Literal { value: Literal, site: Site },
    Array { items: Vec<Expr>, site: Site },
    Object { fields: Vec<ObjectField>, site: Site },
    Unary { op: String, value: Box<Expr>, site: Site },
    Binary { op: String, left: Box<Expr>, right: Box<Expr>, site: Site },
    Member { base: Box<Expr>, name: String, site: Site },
    Call { name: String, args: Vec<Expr>, site: Site },
    Read(ReadExpr),
    Merge(MergeExpr),
    Exists { read: ReadExpr, site: Site },
    Created { read: ReadExpr, site: Site },
    Assert { value: Box<Expr>, code: String, site: Site },
    ShapeUse { base: Box<Expr>, name: String, site: Site },
    Shape { base: Box<Expr>, fields: Vec<ShapeField>, site: Site },
    Walk { table: String, seed: Box<Expr>, column: String, depth: u32, site: Site },
    Write { op: WriteOp, table: String, keys: Vec<KeyPart>, fields: Vec<ObjectField>, if_absent: bool, condition: Option<Box<Expr>>, site: Site },
}

impl Expr {
    pub fn site(&self) -> &Site {
        match self {
            Expr::Name { site, .. } | Expr::Focal { site } | Expr::Literal { site, .. } | Expr::Array { site, .. } | Expr::Object { site, .. } | Expr::Unary { site, .. } | Expr::Binary { site, .. } | Expr::Member { site, .. } | Expr::Call { site, .. } | Expr::Exists { site, .. } | Expr::Created { site, .. } | Expr::Assert { site, .. } | Expr::ShapeUse { site, .. } | Expr::Shape { site, .. } | Expr::Walk { site, .. } | Expr::Write { site, .. } => site,
            Expr::Read(read) => &read.site,
            Expr::Merge(merge) => &merge.site,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Stmt {
    Bind { names: Vec<String>, value: Expr, site: Site },
    Expr { value: Expr, site: Site },
    Require { condition: Expr, code: String, site: Site },
    Return { value: Expr, site: Site },
    Emit { effect: String, payload: Expr, site: Site },
    If { condition: Expr, then_body: Vec<Stmt>, else_body: Vec<Stmt>, site: Site },
    For { name: String, domain: Expr, body: Vec<Stmt>, site: Site },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IndexDecl {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub site: Site,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Effect {
    Read,
    Insert,
    Update,
    Delete,
}

impl Effect {
    pub fn word(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Insert => "insert",
            Self::Update => "update",
            Self::Delete => "delete",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuleDecl {
    pub effect: Effect,
    pub bindings: Vec<String>,
    pub value: Expr,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ColumnDecl {
    pub name: String,
    pub type_: ScalarType,
    pub site: Site,
}

/// `sync public | to .column | to table[.a, .b] [by .principal] [last N by index]`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SyncDecl {
    pub audience: SyncAudience,
    pub horizon: Option<(u32, String)>,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SyncAudience {
    Public,
    Column(String),
    Target { table: String, prefix: Vec<String>, principal: Option<String> },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapDecl {
    pub max: u32,
    pub by: Vec<String>,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TableDecl {
    pub name: String,
    pub columns: Vec<ColumnDecl>,
    pub indexes: Vec<IndexDecl>,
    pub rules: Vec<RuleDecl>,
    pub immutable: Vec<(Vec<String>, Site)>,
    pub caps: Vec<CapDecl>,
    pub final_exists: Vec<(Expr, Site)>,
    pub retain: Option<(String, Site)>,
    /// `expire at .column`: the time column that ends a row's life.
    pub expire: Option<(String, Site)>,
    pub public: Option<(String, Site)>,
    pub sync: Option<SyncDecl>,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MaintainDecl {
    pub name: String,
    pub aggregate: String,
    pub source: String,
    pub column: Option<String>,
    pub by: Vec<String>,
    pub read: RuleDecl,
    pub readable: Option<RuleDecl>,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArgDecl {
    pub name: String,
    pub type_: ScalarType,
    pub site: Site,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProgramKind {
    Query,
    Mutation,
    Job,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProgramDecl {
    pub kind: ProgramKind,
    pub name: String,
    pub args: Vec<ArgDecl>,
    pub body: Vec<Stmt>,
    pub site: Site,
}

/// `schedule name every 2m [at 08:00]: job` — the owner's clock fires a
/// job once per period, with the period it covers as `periodStart` and
/// `periodEnd` when the job declares them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScheduleDecl {
    pub name: String,
    pub every_ms: u64,
    /// The offset of the period boundary within the period (`at 08:00`).
    pub offset_ms: u64,
    pub target: String,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EffectDecl {
    pub name: String,
    pub module: String,
    pub site: Site,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Document {
    pub file: String,
    pub identity: Option<(bool, bool)>,
    pub tables: Vec<TableDecl>,
    pub maintains: Vec<MaintainDecl>,
    pub effects: Vec<EffectDecl>,
    pub shapes: Vec<ShapeDecl>,
    pub shape_imports: Vec<Import>,
    pub functions: Vec<FunctionDecl>,
    pub function_imports: Vec<Import>,
    pub procs: Vec<ProcDecl>,
    pub proc_imports: Vec<Import>,
    pub programs: Vec<ProgramDecl>,
    pub schedules: Vec<ScheduleDecl>,
    /// Personas declared with `use personas alice, bob`.
    pub personas: Vec<String>,
}
