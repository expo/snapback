//! The program IR: what the Quarry binder emits and the interpreter runs, on
//! the server and on a device alike. Copied from Snapback 2 (LLP 2000.000
//! §5.1) in its serialized form, so the conformance corpus loads unchanged;
//! the held-search descriptor, a receipt-era form, is dropped.

use crate::value::Value;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

fn is_zero(value: &u32) -> bool {
    *value == 0
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Program {
    pub name: String,
    pub kind: ProgramKind,
    #[serde(default)]
    pub args: BTreeMap<String, ArgType>,
    #[serde(default)]
    pub read_time_granularity_ms: Option<u64>,
    pub body: Vec<Stmt>,
    /// Binder-marked top-level returned shape loop paths and their source read sites.
    /// Empty for all other programs, preserving their serialized form.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub returned_shapes: BTreeMap<String, String>,
    /// A job whose body is the app's own wasm module, run by the engine's
    /// native host one chunk per commit (LLP 3000.005). The body is empty.
    #[serde(default, skip_serializing_if = "is_false")]
    pub native: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProgramKind {
    Query,
    Mutation,
    #[serde(rename = "job")]
    Job,
    #[serde(rename = "action")]
    Action,
}

impl ProgramKind {
    pub fn word(self) -> &'static str {
        match self {
            Self::Query => "query",
            Self::Mutation => "mutation",
            Self::Job => "job",
            Self::Action => "action",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ArgType {
    Cursor,
    Id,
    Principal,
    Ref { table: String },
    Text {
        max: u32,
        #[serde(default, skip_serializing_if = "is_zero")]
        min: u32,
        #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_text_format")]
        format: Option<crate::schema::TextFormat>,
    },
    Bytes { max: u32 },
    Image { max: u32 },
    Video { max: u32 },
    Int,
    Bool,
    Time,
    Json { max_bytes: u32 },
    Optional(Box<ArgType>),
    Scalar,
    List {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        of: Option<Box<ArgType>>,
        max: u32,
    },
    Enum { variants: Vec<String> },
    Decimal { scale: u8 },
    Money { currency: String, scale: u8 },
}

impl ArgType {
    pub fn bounds_valid(&self) -> bool {
        match self {
            Self::Text { min, max, .. } => min <= max,
            Self::Optional(inner) | Self::List { of: Some(inner), .. } => inner.bounds_valid(),
            _ => true,
        }
    }

    pub fn is_optional(&self) -> bool {
        matches!(self, Self::Optional(_))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Stmt {
    Const { name: String, value: Expr },
    Let { name: String, value: Expr },
    Assign { name: String, value: Expr },
    Push { target: String, value: Expr },
    If { condition: Expr, then_body: Vec<Stmt>, else_body: Vec<Stmt> },
    For { binding: String, domain: LoopDomain, body: Vec<Stmt> },
    Require { condition: Expr, code: String, #[serde(default, skip_serializing_if = "Option::is_none")] site: Option<String> },
    /// A false predicate rolls the transaction back and re-reads `current`.
    Check { condition: Expr, current: Read },
    /// A unique clash yields absence, never the conflicting row.
    InsertIfAbsent { table: String, row: Expr, result: String },
    Insert { table: String, row: Expr },
    Update { table: String, key: Expr, patch: Expr },
    Upsert { table: String, key: Expr, row: Expr },
    /// Target lookup and the old image stay inside the engine. Only a read-filtered result is bound.
    WriteTarget { target: Read, patch: Expr, upsert: bool, condition: Option<WriteCondition>, result: Option<String> },
    Delete { table: String, key: Expr },
    /// Alternate-key delete resolves inside the engine before charging hidden expiry work.
    DeleteTarget { target: Read },
    Emit { effect: String, payload: Expr, #[serde(default, skip_serializing_if = "Option::is_none")] once: Option<Expr> },
    Return(Expr),
    Break,
    Continue,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WriteCondition {
    pub old: String,
    pub setup: Vec<Stmt>,
    pub value: Expr,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LoopDomain {
    Page(Scan),
    LiteralRange { start: i64, end_exclusive: i64 },
    ExpressionRange { start: Expr, end_exclusive: Expr },
    ArgList { name: String, max: u32 },
    DerivedArray { value: Expr, max: u32, bound_source: String },
    Recurse(Recurse),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Recurse {
    pub site: String,
    pub table: String,
    pub index: String,
    pub seed: Box<Expr>,
    pub next_field: String,
    pub depth: u32,
    pub fanout: u32,
    pub provenance: KeyProvenance,
}

pub const MAX_RECURSE_DEPTH: u32 = 10_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Expr {
    Literal(Value),
    Variable(String),
    Input(Input),
    Field { base: Box<Expr>, name: String },
    Array(Vec<Expr>),
    Object(BTreeMap<String, Expr>),
    Shape { base: Box<Expr>, fields: BTreeMap<String, Expr> },
    Binary { op: BinaryOp, left: Box<Expr>, right: Box<Expr> },
    Unary { op: UnaryOp, value: Box<Expr> },
    Builtin { builtin: Builtin, args: Vec<Expr> },
    Get(Read),
    Exists(Read),
    Block { body: Vec<Stmt>, value: Box<Expr> },
    Scan(Scan),
    Merge(Merge),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Input {
    Viewer,
    Now,
    NewId,
    ReadTime,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum BinaryOp {
    Eq,
    Ne,
    SameValueZero,
    Lt,
    Lte,
    Gt,
    Gte,
    Add,
    Sub,
    Mul,
    And,
    Or,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum UnaryOp {
    Not,
    Neg,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Builtin {
    /// Compiler-owned projection of a successful insert result.
    ProjectFields { table: String },
    /// A private field may be absent from a projected row.
    OptionalField { field: String },
    Calendar { millis: i64 },
    Len,
    Slice,
    Concat,
    Lower,
    Trim,
    Sha256,
    Join,
    Group { field: String, #[serde(default, skip_serializing_if = "std::ops::Not::not")] optional: bool },
    First,
    Last,
    At,
    Min,
    Max,
    /// SQL-style column extrema; domain reads require complete coverage.
    Extremum { field: String, max: bool, domain: bool },
    Divmod { remainder_sink: String },
    Sort { keys: Vec<SortKey> },
    MentionTokens,
    SearchPresent,
    DeterministicShare,
    Count,
    Sum,
    CountCapped,
    /// `connected[p]`: how many connections the principal holds open on the
    /// server now; `exists connected[p]` is `> 0`. A device answers 1.
    Connected,
}

impl Builtin {
    pub fn arity(&self) -> usize {
        match self {
            Self::Extremum { .. } | Self::ProjectFields { .. } | Self::OptionalField { .. } | Self::Calendar { .. } | Self::Group { .. } | Self::First | Self::Last | Self::Len | Self::Lower | Self::Trim | Self::Sha256 | Self::Sort { .. } | Self::MentionTokens | Self::SearchPresent | Self::Count | Self::Sum | Self::CountCapped | Self::Connected => 1,
            Self::At | Self::Concat | Self::Join | Self::Min | Self::Max | Self::Divmod { .. } => 2,
            Self::Slice | Self::DeterministicShare => 3,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SortKey {
    pub field: String,
    pub order: Order,
    /// The declared private field can be omitted by row projection.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub optional: bool,
}

/// A point read: one indexed key, all components bound.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Read {
    pub site: String,
    pub table: String,
    pub index: String,
    pub key: Vec<Expr>,
    pub provenance: KeyProvenance,
}

/// One index-key component of a scan prefix. Snapback 2 spelled a search
/// atom here too; Snapback 4 keeps only the scalar form.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum IndexKeyExpr {
    Scalar(Expr),
    WordPrefix(Expr),
}

impl IndexKeyExpr {
    pub fn scalar(&self) -> Option<&Expr> {
        match self {
            Self::Scalar(expr) => Some(expr),
            Self::WordPrefix(_) => None,
        }
    }
}

/// Stable presence identity: fixed storage and lossless JSON on every host.
pub type VariantId = [u32; 4];

/// A bounded range over an index prefix.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scan {
    pub site: String,
    pub table: String,
    pub index: String,
    pub prefix: Vec<IndexKeyExpr>,
    pub order: Order,
    pub take: Bound,
    /// A program existence test consumes at most its first match below page ownership.
    #[serde(default, skip_serializing_if = "is_false")]
    pub existence: bool,
    #[serde(default)]
    pub after: Option<Box<Expr>>,
    #[serde(default)]
    pub before: Option<Box<Expr>>,
    #[serde(default)]
    pub range: Option<Range>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<Box<Expr>>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub opaque_cursor: bool,
    #[serde(default)]
    pub merge_site: Option<String>,
    pub provenance: KeyProvenance,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<crate::ir::VariantId>,
}

impl Scan {
    /// True only for an ordinary index ordered by this column after its pins.
    /// Kept shared by execution and the cost certificate.
    pub fn orders_field(&self, schema: &crate::schema::Schema, field: &str) -> bool {
        let Some(index) = schema.table(&self.table).and_then(|table| table.index(&self.index)) else { return false; };
        // Expiring maintained totals are refreshed while reading. Their
        // stored index value does not order the live value returned today.
        if field == "value" && schema.maintain_for(&self.table).is_some_and(|maintain|
            schema.table(&maintain.source).is_some_and(|source| source.expire.is_some())) { return false; }
        self.prefix.iter().all(|key| matches!(key, IndexKeyExpr::Scalar(_)))
            && matches!(index.components.get(self.prefix.len()), Some(crate::schema::IndexComponent::Column(column)) if column == field)
    }
}

/// A union owns its projected cursor descriptor, including when no branch survives.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ViewPosition {
    pub take: u32,
    pub order: Order,
    pub after: Option<Box<Expr>>,
    pub suffix: Vec<crate::cursor::CursorColumn>,
}

/// A merge owns its lane discovery and ordered scans; no materialized union.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Merge {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<ViewPosition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub order_keys: Vec<String>,
    pub site: String,
    pub lanes: Vec<MergeLane>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<crate::ir::VariantId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MergeLane {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guard: Option<Expr>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distinct: Option<Expr>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    /// Evaluated with $project bound to a rule-visible, filtered source row.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<Expr>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub setup: Vec<Stmt>,
    pub scan: Scan,
    pub source: Option<LaneSource>,
    pub binding: String,
}

/// Query lane domains reuse statement-loop binding and evaluation. The scan
/// variant retains its wire shape for the frozen conformance programs.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum LaneSource {
    Scan(Scan),
    Range { start: Expr, end_exclusive: Expr, max: Option<u64> },
    List { value: Expr, max: u32 },
}

mod lane_source;

impl LaneSource {
    pub fn scan(&self) -> Option<&Scan> { if let Self::Scan(scan) = self { Some(scan) } else { None } }
    pub fn expressions(&self) -> Vec<&Expr> {
        match self { Self::Scan(_) => Vec::new(), Self::Range { start, end_exclusive, .. } => vec![start, end_exclusive], Self::List { value, .. } => vec![value] }
    }
    pub fn static_max(&self) -> Option<u64> {
        match self {
            Self::Scan(scan) => if scan.take == Bound::Meter { None } else { Some(scan.take.maximum()) },
            Self::Range { max, .. } => *max,
            Self::List { max, .. } => Some(u64::from(*max)),
        }
    }
    pub fn domain(&self) -> LoopDomain {
        match self {
            Self::Scan(scan) => LoopDomain::Page(scan.clone()),
            Self::Range { start, end_exclusive, .. } => LoopDomain::ExpressionRange { start: start.clone(), end_exclusive: end_exclusive.clone() },
            Self::List { value, max } => LoopDomain::DerivedArray { value: value.clone(), max: *max, bound_source: "list".into() },
        }
    }
}

impl Merge {
    pub fn take(&self) -> u64 {
        self.position.as_ref().map_or_else(|| self.lanes.first().map_or(0, |lane| lane.scan.take.maximum()), |position| u64::from(position.take))
    }
    pub fn table(&self) -> &str {
        self.lanes.first().map_or("", |lane| lane.scan.table.as_str())
    }
    pub fn max_lanes(&self) -> u64 {
        self.static_lanes().unwrap_or(crate::meter::Ceilings::default().examined)
    }
    pub fn static_lanes(&self) -> Option<u64> {
        self.lanes.iter().try_fold(0u64, |sum, lane| Some(sum.saturating_add(match &lane.source { None => 1, Some(source) => source.static_max()? })))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Range {
    #[serde(default)]
    pub gt: Option<Box<Expr>>,
    #[serde(default)]
    pub gte: Option<Box<Expr>>,
    #[serde(default)]
    pub lt: Option<Box<Expr>>,
    #[serde(default)]
    pub lte: Option<Box<Expr>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Bound {
    Literal(u32),
    /// A query prefix domain has no static population count.
    Meter,
    Arg { name: String, max: u32 },
}

impl Bound {
    pub fn maximum(&self) -> u64 {
        match self {
            Self::Literal(value) => *value as u64,
            Self::Meter => crate::meter::Ceilings::default().examined,
            Self::Arg { max, .. } => *max as u64,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum KeyProvenance {
    Arg,
    Viewer,
    Const,
    Shape,
    Computed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Order {
    Asc,
    Desc,
}

pub fn var(name: &str) -> Expr {
    Expr::Variable(name.to_owned())
}

pub fn field(base: Expr, name: &str) -> Expr {
    Expr::Field { base: Box::new(base), name: name.to_owned() }
}

pub fn lit(value: Value) -> Expr {
    Expr::Literal(value)
}

fn deserialize_text_format<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<crate::schema::TextFormat>, D::Error> {
    match String::deserialize(deserializer)?.as_str() {
        "handle" => Ok(Some(crate::schema::TextFormat::Handle)),
        "url" => Ok(Some(crate::schema::TextFormat::Url)),
        _ => Err(serde::de::Error::custom("text format must be handle or url")),
    }
}

/// Every read site (point, scan, merge lane, recursion) in a program body,
/// with the tables it reads: what a live subscription and `check --cost`
/// both need.
pub fn read_sites(program: &Program) -> Vec<ReadSite> {
    let mut out = Vec::new();
    stmts_read_sites(&program.body, &mut out);
    out
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ReadSite {
    pub site: String,
    pub table: String,
    pub index: String,
    /// `point`, `scan`, or `walk`.
    pub kind: &'static str,
    pub take: u64,
}

fn stmts_read_sites(stmts: &[Stmt], out: &mut Vec<ReadSite>) {
    for stmt in stmts {
        match stmt {
            Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. } | Stmt::Return(value) => expr_read_sites(value, out),
            Stmt::Emit { payload: value, once, .. } => { expr_read_sites(value, out); if let Some(value) = once { expr_read_sites(value, out); } },
            Stmt::If { condition, then_body, else_body } => {
                expr_read_sites(condition, out);
                stmts_read_sites(then_body, out);
                stmts_read_sites(else_body, out);
            }
            Stmt::For { domain, body, .. } => {
                match domain {
                    LoopDomain::Page(scan) => scan_read_sites(scan, out),
                    LoopDomain::ExpressionRange { start, end_exclusive } => { expr_read_sites(start, out); expr_read_sites(end_exclusive, out); }
                    LoopDomain::DerivedArray { value, .. } => expr_read_sites(value, out),
                    LoopDomain::Recurse(recurse) => {
                        expr_read_sites(&recurse.seed, out);
                        out.push(ReadSite { site: recurse.site.clone(), table: recurse.table.clone(), index: recurse.index.clone(), kind: "walk", take: recurse.depth as u64 * recurse.fanout.max(1) as u64 });
                    }
                    LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => {}
                }
                stmts_read_sites(body, out);
            }
            Stmt::Require { condition, .. } => expr_read_sites(condition, out),
            Stmt::Check { condition, current } => {
                expr_read_sites(condition, out);
                out.push(ReadSite { site: current.site.clone(), table: current.table.clone(), index: current.index.clone(), kind: "point", take: 1 });
            }
            Stmt::InsertIfAbsent { row, .. } | Stmt::Insert { row, .. } => expr_read_sites(row, out),
            Stmt::Update { key, patch, .. } => {
                expr_read_sites(key, out);
                expr_read_sites(patch, out);
            }
            Stmt::Upsert { key, row, .. } => {
                expr_read_sites(key, out);
                expr_read_sites(row, out);
            }
            Stmt::WriteTarget { target, patch, condition, .. } => {
                out.push(ReadSite { site: target.site.clone(), table: target.table.clone(), index: target.index.clone(), kind: "write target", take: 1 });
                for key in &target.key { expr_read_sites(key, out); }
                expr_read_sites(patch, out);
                if let Some(condition) = condition { stmts_read_sites(&condition.setup, out); expr_read_sites(&condition.value, out); }
            }
            Stmt::Delete { key, .. } => expr_read_sites(key, out),
            Stmt::DeleteTarget { target } => {
                out.push(ReadSite { site: target.site.clone(), table: target.table.clone(), index: target.index.clone(), kind: "write target", take: 1 });
                for key in &target.key { expr_read_sites(key, out); }
            }
            Stmt::Break | Stmt::Continue => {}
        }
    }
}

fn scan_read_sites(scan: &Scan, out: &mut Vec<ReadSite>) {
    if let Some(filter) = &scan.filter { expr_read_sites(filter, out); }
    if let Some(range) = &scan.range {
        for bound in [&range.gt, &range.gte, &range.lt, &range.lte].into_iter().flatten() { expr_read_sites(bound, out); }
    }
    for key in &scan.prefix {
        // @ref LLP 3000.007#18.1 — matching expressions can read independent sources; retain them in the execution facts.
        match key { IndexKeyExpr::Scalar(expr) | IndexKeyExpr::WordPrefix(expr) => expr_read_sites(expr, out) }
    }
    for cursor in [&scan.after, &scan.before].into_iter().flatten() { expr_read_sites(cursor, out); }
    out.push(ReadSite { site: scan.site.clone(), table: scan.table.clone(), index: scan.index.clone(), kind: "scan", take: scan.take.maximum() });
}

fn expr_read_sites(expr: &Expr, out: &mut Vec<ReadSite>) {
    match expr {
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => {}
        Expr::Field { base, .. } => expr_read_sites(base, out),
        Expr::Array(items) => items.iter().for_each(|item| expr_read_sites(item, out)),
        Expr::Object(fields) => fields.values().for_each(|item| expr_read_sites(item, out)),
        Expr::Shape { base, fields } => { expr_read_sites(base, out); fields.values().for_each(|item| expr_read_sites(item, out)); }
        Expr::Binary { left, right, .. } => {
            expr_read_sites(left, out);
            expr_read_sites(right, out);
        }
        Expr::Unary { value, .. } => expr_read_sites(value, out),
        Expr::Builtin { args, .. } => args.iter().for_each(|item| expr_read_sites(item, out)),
        Expr::Get(read) | Expr::Exists(read) => {
            read.key.iter().for_each(|item| expr_read_sites(item, out));
            out.push(ReadSite { site: read.site.clone(), table: read.table.clone(), index: read.index.clone(), kind: "point", take: 1 });
        }
        Expr::Block { body, value } => { stmts_read_sites(body, out); expr_read_sites(value, out); }
        Expr::Scan(scan) => scan_read_sites(scan, out),
        Expr::Merge(merge) => {
            if let Some(after) = merge.position.as_ref().and_then(|position| position.after.as_ref()) { expr_read_sites(after, out); }
            for lane in &merge.lanes {
                if let Some(guard) = &lane.guard { expr_read_sites(guard, out); }
                if let Some(project) = &lane.project { expr_read_sites(project, out); }
                if let Some(value) = &lane.distinct { expr_read_sites(value, out); }
                stmts_read_sites(&lane.setup, out);
                if let Some(source) = &lane.source {
                    if let Some(scan) = source.scan() { scan_read_sites(scan, out); }
                    for value in source.expressions() { expr_read_sites(value, out); }
                }
                scan_read_sites(&lane.scan, out);
            }
        }
    }
}

/// Every page scan in a program body, including merge lanes and their
/// sources: what the compiler's completeness note looks at.
pub fn scans(program: &Program) -> Vec<&Scan> {
    read_structure(program).0
}

pub(crate) fn expression_scans(expr: &Expr) -> Vec<&Scan> {
    let mut out = Vec::new();
    expr_scans(expr, &mut out, &mut false);
    out
}

pub(crate) fn read_structure(program: &Program) -> (Vec<&Scan>, bool) {
    let mut out = Vec::new();
    let mut has_merge = false;
    stmts_scans(&program.body, &mut out, &mut has_merge);
    (out, has_merge)
}

fn stmts_scans<'a>(stmts: &'a [Stmt], out: &mut Vec<&'a Scan>, has_merge: &mut bool) {
    for stmt in stmts {
        match stmt {
            Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. } | Stmt::Return(value) => expr_scans(value, out, has_merge),
            Stmt::Emit { payload: value, once, .. } => { expr_scans(value, out, has_merge); if let Some(value) = once { expr_scans(value, out, has_merge); } },
            Stmt::If { condition, then_body, else_body } => {
                expr_scans(condition, out, has_merge);
                stmts_scans(then_body, out, has_merge);
                stmts_scans(else_body, out, has_merge);
            }
            Stmt::For { domain, body, .. } => {
                match domain {
                    LoopDomain::Page(scan) => {
                        expr_scans_of_scan(scan, out, has_merge);
                        out.push(scan);
                    }
                    LoopDomain::ExpressionRange { start, end_exclusive } => { expr_scans(start, out, has_merge); expr_scans(end_exclusive, out, has_merge); }
                    LoopDomain::DerivedArray { value, .. } => expr_scans(value, out, has_merge),
                    LoopDomain::Recurse(recurse) => expr_scans(&recurse.seed, out, has_merge),
                    LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => {}
                }
                stmts_scans(body, out, has_merge);
            }
            Stmt::Require { condition, .. } => expr_scans(condition, out, has_merge),
            Stmt::Check { condition, current } => { expr_scans(condition, out, has_merge); for key in &current.key { expr_scans(key, out, has_merge); } }
            Stmt::InsertIfAbsent { row, .. } | Stmt::Insert { row, .. } => expr_scans(row, out, has_merge),
            Stmt::Update { key, patch, .. } => {
                expr_scans(key, out, has_merge);
                expr_scans(patch, out, has_merge);
            }
            Stmt::Upsert { key, row, .. } => {
                expr_scans(key, out, has_merge);
                expr_scans(row, out, has_merge);
            }
            Stmt::WriteTarget { target, patch, condition, .. } => {
                for key in &target.key { expr_scans(key, out, has_merge); }
                expr_scans(patch, out, has_merge);
                if let Some(condition) = condition { stmts_scans(&condition.setup, out, has_merge); expr_scans(&condition.value, out, has_merge); }
            }
            Stmt::Delete { key, .. } => expr_scans(key, out, has_merge),
            Stmt::DeleteTarget { target } => for key in &target.key { expr_scans(key, out, has_merge); },
            Stmt::Break | Stmt::Continue => {}
        }
    }
}

fn expr_scans_of_scan<'a>(scan: &'a Scan, out: &mut Vec<&'a Scan>, has_merge: &mut bool) {
    if let Some(filter) = &scan.filter { expr_scans(filter, out, has_merge); }
    if let Some(range) = &scan.range {
        for bound in [&range.gt, &range.gte, &range.lt, &range.lte].into_iter().flatten() { expr_scans(bound, out, has_merge); }
    }
    for key in &scan.prefix {
        match key { IndexKeyExpr::Scalar(expr) | IndexKeyExpr::WordPrefix(expr) => expr_scans(expr, out, has_merge) }
    }
    for cursor in [&scan.after, &scan.before].into_iter().flatten() { expr_scans(cursor, out, has_merge); }
}

fn expr_scans<'a>(expr: &'a Expr, out: &mut Vec<&'a Scan>, has_merge: &mut bool) {
    match expr {
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => {}
        Expr::Field { base, .. } => expr_scans(base, out, has_merge),
        Expr::Array(items) => items.iter().for_each(|item| expr_scans(item, out, has_merge)),
        Expr::Object(fields) => fields.values().for_each(|item| expr_scans(item, out, has_merge)),
        Expr::Shape { base, fields } => { expr_scans(base, out, has_merge); fields.values().for_each(|item| expr_scans(item, out, has_merge)); }
        Expr::Binary { left, right, .. } => {
            expr_scans(left, out, has_merge);
            expr_scans(right, out, has_merge);
        }
        Expr::Unary { value, .. } => expr_scans(value, out, has_merge),
        Expr::Builtin { args, .. } => args.iter().for_each(|item| expr_scans(item, out, has_merge)),
        Expr::Get(read) | Expr::Exists(read) => read.key.iter().for_each(|item| expr_scans(item, out, has_merge)),
        Expr::Block { body, value } => { stmts_scans(body, out, has_merge); expr_scans(value, out, has_merge); }
        Expr::Scan(scan) => {
            expr_scans_of_scan(scan, out, has_merge);
            out.push(scan);
        }
        Expr::Merge(merge) => {
            *has_merge = true;
            if let Some(after) = merge.position.as_ref().and_then(|position| position.after.as_ref()) { expr_scans(after, out, has_merge); }
            for lane in &merge.lanes {
                if let Some(guard) = &lane.guard { expr_scans(guard, out, has_merge); }
                if let Some(project) = &lane.project { expr_scans(project, out, has_merge); }
                if let Some(value) = &lane.distinct { expr_scans(value, out, has_merge); }
                stmts_scans(&lane.setup, out, has_merge);
                if let Some(source) = &lane.source {
                    if let Some(scan) = source.scan() { expr_scans_of_scan(scan, out, has_merge); out.push(scan); }
                    for value in source.expressions() { expr_scans(value, out, has_merge); }
                }
                expr_scans_of_scan(&lane.scan, out, has_merge);
                out.push(&lane.scan);
            }
        }
    }
}

/// Every table a program writes, by statement kind.
pub fn write_tables(program: &Program) -> Vec<(String, &'static str)> {
    let mut out = Vec::new();
    stmts_write_tables(&program.body, &mut out);
    out
}

fn stmts_write_tables(stmts: &[Stmt], out: &mut Vec<(String, &'static str)>) {
    for stmt in stmts {
        match stmt {
            Stmt::Insert { table, .. } | Stmt::InsertIfAbsent { table, .. } => out.push((table.clone(), "insert")),
            Stmt::Update { table, .. } => out.push((table.clone(), "update")),
            Stmt::Upsert { table, .. } => out.push((table.clone(), "upsert")),
            Stmt::WriteTarget { target, upsert, .. } => out.push((target.table.clone(), if *upsert { "upsert" } else { "update" })),
            Stmt::Delete { table, .. } => out.push((table.clone(), "delete")),
            Stmt::DeleteTarget { target } => out.push((target.table.clone(), "delete")),
            Stmt::If { then_body, else_body, .. } => {
                stmts_write_tables(then_body, out);
                stmts_write_tables(else_body, out);
            }
            Stmt::For { body, .. } => stmts_write_tables(body, out),
            _ => {}
        }
    }
}
