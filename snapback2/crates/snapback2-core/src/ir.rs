use crate::value::Value;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Program {
    pub name: String,
    pub kind: ProgramKind,
    #[serde(default)]
    pub args: BTreeMap<String, ArgType>,
    pub read_time_granularity_ms: Option<u64>,
    pub body: Vec<Stmt>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProgramKind {
    Query,
    Mutation,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ArgType {
    Id,
    Principal,
    Ref {
        table: String,
    },
    Text {
        max: u32,
    },
    Int,
    Bool,
    Time,
    Json {
        max_bytes: u32,
    },
    Optional(Box<ArgType>),
    Scalar,
    List {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        of: Option<Box<ArgType>>,
        max: u32,
    },
    // @ref LLP 1001#9-schema-additions — typed scalar args preserve enum and fixed-scale checks.
    Enum {
        variants: Vec<String>,
    },
    Decimal {
        scale: u8,
    },
    Money {
        currency: String,
        scale: u8,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Stmt {
    Const {
        name: String,
        value: Expr,
    },
    Let {
        name: String,
        value: Expr,
    },
    Assign {
        name: String,
        value: Expr,
    },
    Push {
        target: String,
        value: Expr,
    },
    If {
        condition: Expr,
        then_body: Vec<Stmt>,
        else_body: Vec<Stmt>,
    },
    For {
        binding: String,
        domain: LoopDomain,
        body: Vec<Stmt>,
    },
    Require {
        condition: Expr,
        code: String,
    },
    Insert {
        table: String,
        row: Expr,
    },
    Update {
        table: String,
        key: Expr,
        patch: Expr,
    },
    Upsert {
        table: String,
        key: Expr,
        row: Expr,
    },
    Delete {
        table: String,
        key: Expr,
    },
    // @ref LLP 1001#8-emit-and-the-outbox — effects enter the durable outbox from mutations.
    Emit {
        effect: String,
        payload: Expr,
    },
    Return(Expr),
    Break,
    Continue,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LoopDomain {
    Page(Scan),
    LiteralRange {
        start: i64,
        end_exclusive: i64,
    },
    ArgList {
        name: String,
        max: u32,
    },
    DerivedArray {
        value: Expr,
        max: u32,
        bound_source: String,
    },
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Expr {
    Literal(Value),
    Variable(String),
    Input(Input),
    Field {
        base: Box<Expr>,
        name: String,
    },
    Array(Vec<Expr>),
    Object(BTreeMap<String, Expr>),
    Binary {
        op: BinaryOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    Unary {
        op: UnaryOp,
        value: Box<Expr>,
    },
    Builtin {
        builtin: Builtin,
        args: Vec<Expr>,
    },
    Get(Read),
    Exists(Read),
    Scan(Scan),
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
    Len,
    Slice,
    Concat,
    Min,
    Max,
    Divmod { remainder_sink: String },
    Sort { keys: Vec<SortKey> },
    MentionTokens,
    DeterministicShare,
    Count,
    Sum,
    CountCapped,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SortKey {
    pub field: String,
    pub order: Order,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Read {
    pub site: String,
    pub table: String,
    pub index: String,
    pub key: Vec<Expr>,
    pub provenance: KeyProvenance,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scan {
    pub site: String,
    pub table: String,
    pub index: String,
    pub prefix: Vec<Expr>,
    pub order: Order,
    pub take: Bound,
    pub after: Option<Box<Expr>>,
    pub before: Option<Box<Expr>>,
    pub range: Option<Range>,
    pub provenance: KeyProvenance,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Range {
    pub gt: Option<Box<Expr>>,
    pub gte: Option<Box<Expr>>,
    pub lt: Option<Box<Expr>>,
    pub lte: Option<Box<Expr>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Bound {
    Literal(u32),
    Arg { name: String, max: u32 },
}

impl Bound {
    pub fn maximum(&self) -> u64 {
        match self {
            Self::Literal(value) => *value as u64,
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
    Expr::Field {
        base: Box::new(base),
        name: name.to_owned(),
    }
}

pub fn lit(value: Value) -> Expr {
    Expr::Literal(value)
}
