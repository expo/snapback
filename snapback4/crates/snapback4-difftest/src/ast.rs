//! The generated surface tree; no IR is constructed or patched.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum Type {
    Int,
    Text,
    Id,
    Bool,
    Principal,
    Nullable(Box<Type>),
}
impl Type {
    fn source(&self) -> String {
        match self {
            Self::Int => "int".into(),
            Self::Text => "text <=64".into(),
            Self::Id => "id".into(),
            Self::Bool => "bool".into(),
            Self::Principal => "principal".into(),
            Self::Nullable(t) => format!("{} ?", t.source()),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Column {
    pub name: String,
    pub ty: Type,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum Rule {
    Allow,
    Deny,
    Owner,
    Witness,
    /// `.owner = viewer or exists access[.bucket, viewer]` (Lean variants).
    OwnerOrWitness,
    /// `.principal = viewer`, for `access` (Lean variants).
    Member,
    /// `update (old, next) <- old.owner = viewer and next.owner = viewer`.
    NamedBoth,
    /// `update (old, next) <- next.owner = viewer`.
    NamedNext,
    /// `update (old, next) <- old.owner = viewer`.
    NamedOld,
}
impl Rule {
    fn source(&self) -> &'static str {
        match self {
            Self::Allow => "allow",
            Self::Deny => "deny",
            Self::Owner => ".owner = viewer",
            Self::Witness => "exists access[.bucket, viewer]",
            Self::OwnerOrWitness => ".owner = viewer or exists access[.bucket, viewer]",
            Self::Member => ".principal = viewer",
            Self::NamedBoth => "old.owner = viewer and next.owner = viewer",
            Self::NamedNext => "next.owner = viewer",
            Self::NamedOld => "old.owner = viewer",
        }
    }
    /// Whether the rule names the update's two images (`update (old, next)`).
    pub fn named(&self) -> bool {
        matches!(self, Self::NamedBoth | Self::NamedNext | Self::NamedOld)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Residency {
    Public,
    Owner,
    Online,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Table {
    pub name: String,
    pub columns: Vec<Column>,
    pub keys: Vec<(String, Vec<String>, bool)>,
    pub rule: Rule,
    pub residency: Residency,
    /// Per-effect rules (read, insert, update, delete) replacing `rule`;
    /// only the Lean oracle's variants set it (`lean.rs`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effects: Option<Vec<Rule>>,
}
impl Table {
    fn source(&self) -> String {
        let mut out = format!("table {}:\n", self.name);
        for c in &self.columns {
            out += &format!("  {}: {}\n", c.name, c.ty.source());
        }
        for (name, cols, unique) in &self.keys {
            out += &format!(
                "  {} {name}: {}\n",
                if *unique { "unique" } else { "by" },
                cols.join(", ")
            );
        }
        for (i, effect) in ["read", "insert", "update", "delete"].into_iter().enumerate() {
            let rule = self.effects.as_ref().map_or(&self.rule, |e| &e[i]);
            let binding = if rule.named() { " (old, next)" } else { "" };
            out += &format!("  {effect}{binding} <- {}\n", rule.source());
        }
        out += match self.residency {
            Residency::Public => "  sync public\n",
            Residency::Owner => "  sync to .owner\n",
            Residency::Online => "  online only\n",
        };
        out
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Bin {
    Add,
    Mul,
    Eq,
    And,
    Or,
}
impl Bin {
    fn source(&self) -> &'static str {
        match self {
            Self::Add => "+",
            Self::Mul => "*",
            Self::Eq => "=",
            Self::And => "and",
            Self::Or => "or",
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Expr {
    Int(i64),
    Text(String),
    Bool(bool),
    Arg(String, Type),
    Binary(Bin, Box<Expr>, Box<Expr>),
    Identity(Box<Expr>),
    Assert(Box<Expr>),
}
impl Expr {
    pub fn ty(&self) -> Type {
        match self {
            Self::Int(_) => Type::Int,
            Self::Text(_) => Type::Text,
            Self::Bool(_) => Type::Bool,
            Self::Arg(_, t) => t.clone(),
            Self::Identity(e) => e.ty(),
            Self::Assert(e) => match e.ty() {
                Type::Nullable(t) => *t,
                t => t,
            },
            Self::Binary(op, _, _) => match op {
                Bin::Add | Bin::Mul => Type::Int,
                _ => Type::Bool,
            },
        }
    }
    pub fn source(&self) -> String {
        match self {
            Self::Int(n) => n.to_string(),
            Self::Text(s) => serde_json::to_string(s).unwrap(),
            Self::Bool(b) => b.to_string(),
            Self::Arg(n, _) => n.clone(),
            Self::Binary(op, a, b) => format!("({} {} {})", a.source(), op.source(), b.source()),
            Self::Identity(e) => format!("identity({})", e.source()),
            Self::Assert(e) => format!("({} ! else NULL_ASSERT)", e.source()),
        }
    }
    pub fn simpler(&self) -> Vec<Self> {
        let mut out = match self.ty() {
            Type::Int => vec![Self::Int(0), Self::Int(1)],
            Type::Bool => vec![Self::Bool(false)],
            Type::Text => vec![Self::Text(String::new())],
            _ => vec![],
        };
        match self {
            Self::Binary(op, a, b) => {
                for e in [a, b] {
                    if e.ty() == self.ty() {
                        out.push((**e).clone());
                    }
                }
                for e in a.simpler() {
                    out.push(Self::Binary(op.clone(), Box::new(e), b.clone()));
                }
                for e in b.simpler() {
                    out.push(Self::Binary(op.clone(), a.clone(), Box::new(e)));
                }
            }
            Self::Identity(e) => out.push((**e).clone()),
            _ => {}
        }
        out.retain(|e| e.source().len() < self.source().len());
        out
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Read {
    Point,
    Page,
    Bounded,
    Count,
    Sum,
    Min,
    Max,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Write {
    Insert,
    Upsert,
    Update,
    Delete,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Body {
    Scalar(Expr),
    Read {
        kind: Read,
        take: u32,
        descending: bool,
        filter: bool,
        owner: bool,
    },
    Write(Write, Expr),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Program {
    pub tables: Vec<Table>,
    pub body: Body,
    pub lets: Vec<(String, Expr)>,
    pub bind_return: bool,
    pub reverse: bool,
    pub helper: bool,
    /// Page order columns replacing `.label, .score` (Lean variants).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<Vec<String>>,
    /// A further domain conjunct, as source (Lean variants).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub residual: Option<String>,
}
impl Program {
    pub fn source(&self) -> String {
        let mut declarations = self.tables.iter().map(Table::source).collect::<Vec<_>>();
        if self.helper {
            declarations.push("fn identity(x: int): x\n".into());
        }
        if self.reverse {
            declarations.reverse();
        }
        let mut out = declarations.join("\n");
        let mutation = matches!(self.body, Body::Write(..));
        out += &format!(
            "\n{} run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):\n",
            if mutation { "mutation" } else { "query" }
        );
        for (name, e) in &self.lets {
            out += &format!("  {name} = {}\n", e.source());
        }
        let result = match &self.body {
            Body::Scalar(e) => e.source(),
            Body::Read {
                kind,
                take,
                descending,
                filter,
                owner,
            } => {
                let mut domain = "items where .bucket = bucket".to_string();
                if *owner {
                    domain += " and .owner = viewer";
                }
                if *filter {
                    domain += " and .flag = true";
                }
                if let Some(residual) = &self.residual {
                    domain += &format!(" and {residual}");
                }
                let order = self.order.as_ref().map_or(".label, .score".to_string(), |o| o.iter().map(|c| format!(".{c}")).collect::<Vec<_>>().join(", "));
                match kind {
                    Read::Point => "items[key]".into(),
                    Read::Page | Read::Bounded => format!(
                        "{domain} {} {take} by {order}{}",
                        if *descending { "last" } else { "first" },
                        if matches!(kind, Read::Page) {
                            " after c"
                        } else {
                            ""
                        }
                    ),
                    Read::Count => format!("count({domain})"),
                    Read::Sum => format!("sum({domain}, .score)"),
                    Read::Min => format!("min({domain}, .score)"),
                    Read::Max => format!("max({domain}, .score)"),
                }
            }
            Body::Write(kind, e) => {
                let fields = format!(
                    "owner: viewer, bucket, score: {}, label: '𐀀', flag: true, maybe: n, tag: 'tag'",
                    e.source()
                );
                out += &match kind {
                    Write::Insert => format!("  insert items {{ id: key, {fields} }}\n"),
                    Write::Upsert => format!("  upsert items[key] {{ {fields} }}\n"),
                    Write::Update => format!("  update items[key] {{ score: {} }}\n", e.source()),
                    Write::Delete => "  delete items[key]\n".into(),
                };
                "true".into()
            }
        };
        if self.bind_return {
            out += &format!("  answer = {result}\n  return answer\n");
        } else {
            out += &format!("  return {result}\n");
        }
        if mutation {
            out += "\nquery observe(key: id):\n  return items[key]\n";
        }
        out
    }
}
