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
    pub body: FunctionBody,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FunctionBody {
    Expression(Expr),
    Block(Vec<Stmt>),
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
pub struct SeekBound {
    pub column: String,
    pub op: String,
    pub value: Expr,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReadExpr {
    /// Computed lane keys introduced by the planner, never written as fields.
    pub computed: std::collections::BTreeMap<String, Expr>,
    /// Column order in the intent spelling; an index name remains `index`.
    pub order_keys: Vec<String>,
    pub table: String,
    pub keys: Vec<KeyPart>,
    pub seeks: Vec<SeekBound>,
    pub filter: Option<Box<Expr>>,
    pub index: Option<String>,
    pub range: Option<RangeSpec>,
    /// `matching q`: the search text, read through a `words(..)` index whose
    /// word component follows exactly the keys.
    pub matching: Option<Box<Expr>>,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MergeLane {
    pub distinct: Option<Expr>,
    pub branch: Option<String>,
    pub planned: Option<Box<ReadExpr>>,
    pub project: Option<Vec<ShapeField>>,
    pub table: Option<String>,
    pub prefix: Vec<Expr>,
    pub columns: Option<Vec<Option<String>>>,
    pub loop_: Option<(String, Expr)>,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MergeExpr {
    pub view_order: Vec<String>,
    pub table: String,
    pub matching: Option<Box<Expr>>,
    pub filter: Option<Box<Expr>>,
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
    /// `a if cond else b`: one of two values, the other never evaluated.
    If { then: Box<Expr>, condition: Box<Expr>, otherwise: Box<Expr>, site: Site },
    Write { op: WriteOp, table: String, keys: Vec<KeyPart>, fields: Vec<ObjectField>, if_absent: bool, condition: Option<Box<Expr>>, site: Site },
}

impl Expr {
    pub fn site(&self) -> &Site {
        match self {
            Expr::Name { site, .. } | Expr::Focal { site } | Expr::Literal { site, .. } | Expr::Array { site, .. } | Expr::Object { site, .. } | Expr::Unary { site, .. } | Expr::Binary { site, .. } | Expr::Member { site, .. } | Expr::Call { site, .. } | Expr::Exists { site, .. } | Expr::Created { site, .. } | Expr::Assert { site, .. } | Expr::ShapeUse { site, .. } | Expr::Shape { site, .. } | Expr::Walk { site, .. } | Expr::If { site, .. } | Expr::Write { site, .. } => site,
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
    /// `break`: the enclosing `for` or `chunk` ends.
    Break { site: Site },
    Continue { site: Site },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IndexDecl {
    pub name: String,
    /// The columns, in order, the `words(..)` component left out.
    pub columns: Vec<String>,
    pub unique: bool,
    pub refusal: Option<(String, Option<String>)>,
    /// `words(a, b)`: its position among the components (the number of
    /// columns before it) and the text columns it tokenizes. An index with
    /// one serves `matching` reads whose keys are exactly those columns,
    /// and nothing else.
    pub words: Option<(usize, Vec<String>)>,
    pub computed: std::collections::BTreeMap<String, Expr>,
    pub site: Site,
}

impl IndexDecl {
    /// Whether the index serves ordinary prefix reads and probes.
    pub fn is_plain(&self) -> bool {
        self.words.is_none() && self.computed.is_empty()
    }

    /// Whether a `matching` read with this many keys reads this index.
    pub fn searches_after(&self, keys: usize) -> bool {
        self.words.as_ref().is_some_and(|(position, _)| *position == keys)
    }
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
    pub maintained: Option<ColumnAggregate>,
    pub name: String,
    pub default: Option<Expr>,
    pub type_: ScalarType,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ColumnAggregate {
    pub source: String,
    pub of: Option<String>,
    pub filter: Option<Expr>,
    pub by: String,
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
    Inferred { principal: Option<String> },
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
    pub search: Vec<String>,
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
    pub online_only: bool,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MaintainDecl {
    pub filter: Option<Expr>,
    pub keys: Vec<Expr>,
    pub indexes: Vec<IndexDecl>,
    pub name: String,
    pub aggregate: String,
    pub source: String,
    pub column: Option<String>,
    pub by: Vec<String>,
    pub read: RuleDecl,
    pub online_only: bool,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArgDecl {
    pub name: String,
    pub type_: ScalarType,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActionDecl {
    pub name: String,
    pub args: Vec<ArgDecl>,
    pub returns: Option<Vec<ArgDecl>>,
    pub work: WorkDecl,
    pub rule: Expr,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RouteDecl {
    pub name: String,
    pub path: String,
    pub service: Option<String>,
    pub work: WorkDecl,
    pub wait_ms: u64,
    pub site: Site,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WorkDecl {
    pub secrets: Vec<String>,
    pub max_attempts: Option<u32>,
    pub backoff_ms: Option<u64>,
    pub deadline_ms: Option<u64>,
    pub cancellable: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProgramKind {
    Query,
    Mutation,
    Job,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProgramDecl {
    pub held: bool,
    pub predicts: bool,
    pub server: bool,
    pub kind: ProgramKind,
    pub name: String,
    pub args: Vec<ArgDecl>,
    pub prelude: Vec<Stmt>,
    pub body: Vec<Stmt>,
    /// `job name(): native` — the body is the app's Rust in `snapback/native/`,
    /// compiled to wasm and hosted by the engine (LLP 3000.005).
    pub native: bool,
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
    pub service: Option<String>,
    pub site: Site,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EffectDecl {
    pub name: String,
    pub module: String,
    pub work: WorkDecl,
    pub site: Site,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Document {
    pub file: String,
    pub identity: Option<(bool, bool)>,
    /// Project-wide opt-in, collected across documents like `use identity`.
    pub server: bool,
    pub tables: Vec<TableDecl>,
    pub maintains: Vec<MaintainDecl>,
    pub timelines: Vec<TimelineDecl>,
    pub views: Vec<ViewDecl>,
    pub feed_views: Vec<FeedView>,
    pub effects: Vec<EffectDecl>,
    pub shapes: Vec<ShapeDecl>,
    pub functions: Vec<FunctionDecl>,
    pub programs: Vec<ProgramDecl>,
    pub actions: Vec<ActionDecl>,
    pub routes: Vec<RouteDecl>,
    pub schedules: Vec<ScheduleDecl>,
    /// Personas declared with `use personas alice, bob`.
    pub personas: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimelineDecl {
    pub name: String,
    pub authors: [String; 2],
    pub posts: [String; 4],
    pub reposts: [String; 4],
    pub edges: [String; 3],
    pub size: crate::recipe::FollowingCaps,
    pub site: Site,
}

/// Planned union branches retain their source sites for type/order diagnostics.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ViewDecl {
    pub name: String,
    pub branches: Vec<ViewBranch>,
    pub site: Site,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ViewBranch {
    pub source: String,
    pub predicate: Option<Expr>,
    pub fields: Vec<ShapeField>,
    pub site: Site,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeedView {
    pub name: String,
    pub source: String,
    pub predicate: Expr,
    pub site: Site,
}
