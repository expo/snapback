//! The generated surface tree; no IR is constructed or patched.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum Type {
    Int,
    Text,
    Id,
    Bool,
    Principal,
    Time,
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
            Self::Time => "time".into(),
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
    /// `expire at .<column>` (guide expire); the column is a `time ?`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expire: Option<String>,
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
        if let Some(column) = &self.expire {
            out += &format!("  expire at .{column}\n");
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
    Lt,
}
impl Bin {
    fn source(&self) -> &'static str {
        match self {
            Self::Add => "+",
            Self::Mul => "*",
            Self::Eq => "=",
            Self::And => "and",
            Self::Or => "or",
            Self::Lt => "<",
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
    /// A local bound earlier in a block (`v0 = ..`).
    Var(String, Type),
    /// `(items[key].score ?? 0)`: a read inside a mutation, after its writes.
    Score(Key),
    /// `(exists items[key])`.
    Present(Key),
}
impl Expr {
    pub fn ty(&self) -> Type {
        match self {
            Self::Int(_) => Type::Int,
            Self::Text(_) => Type::Text,
            Self::Bool(_) => Type::Bool,
            Self::Arg(_, t) | Self::Var(_, t) => t.clone(),
            Self::Score(_) => Type::Int,
            Self::Present(_) => Type::Bool,
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
            Self::Arg(n, _) | Self::Var(n, _) => n.clone(),
            Self::Score(k) => format!("(items[{}].score ?? 0)", k.source()),
            Self::Present(k) => format!("(exists items[{}])", k.source()),
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
    /// A loop over a bounded page summing a related row's column:
    /// `for row in <page>: t = tags[row.tag] ...` (the planner's `For` path).
    Fold,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Write {
    Insert,
    Upsert,
    Update,
    Delete,
}
/// Which argument names an `items` row: `key` or `k2`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum Key {
    Key,
    K2,
}
impl Key {
    pub fn source(&self) -> &'static str {
        match self {
            Self::Key => "key",
            Self::K2 => "k2",
        }
    }
}
/// A projected page field. `TagGet` and `NameLookup` are cross-table point
/// reads whose keys vary across the page's rows: the Postgres batch planner
/// marks them (`engine/prefetch.rs`), as a `Get` and a unique `Lookup`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum Proj {
    Score,
    TagGet,
    NameLookup,
}
impl Proj {
    fn source(&self) -> &'static str {
        match self {
            Self::Score => "score",
            Self::TagGet => "t: tags[.tag]",
            Self::NameLookup => "u: tags[name = .label]",
        }
    }
}
/// One statement of a generated mutation block.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Stmt {
    Let(String, Expr),
    Require(Expr, String),
    If(Expr, Vec<Stmt>, Vec<Stmt>),
    Write {
        kind: Write,
        target: Key,
        value: Expr,
        /// The inserted `tag` (unique `byTag`): `tag0`/`tag1` clash with seeded rows.
        tag: String,
        /// `until: now + ttl` on an expiring `items`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ttl: Option<i64>,
    },
}
impl Stmt {
    pub fn source(&self, indent: usize) -> String {
        let pad = "  ".repeat(indent);
        match self {
            Self::Let(name, e) => format!("{pad}{name} = {}\n", e.source()),
            Self::Require(e, code) => format!("{pad}require {} else {code}\n", e.source()),
            Self::If(c, then, otherwise) => {
                let mut out = format!("{pad}if {}:\n", c.source());
                for s in then {
                    out += &s.source(indent + 1);
                }
                if !otherwise.is_empty() {
                    out += &format!("{pad}else:\n");
                    for s in otherwise {
                        out += &s.source(indent + 1);
                    }
                }
                out
            }
            Self::Write {
                kind,
                target,
                value,
                tag,
                ttl,
            } => {
                let k = target.source();
                let until = ttl.map_or(String::new(), |t| format!(", until: now + {t}"));
                let fields = format!(
                    "owner: viewer, bucket, score: {}, label: '𐀀', flag: true, maybe: n, tag: '{tag}'{until}",
                    value.source()
                );
                match kind {
                    Write::Insert => format!("{pad}insert items {{ id: {k}, {fields} }}\n"),
                    Write::Upsert => format!("{pad}upsert items[{k}] {{ {fields} }}\n"),
                    Write::Update => format!("{pad}update items[{k}] {{ score: {}{until} }}\n", value.source()),
                    Write::Delete => format!("{pad}delete items[{k}]\n"),
                }
            }
        }
    }
    /// Every statement, depth first, this one included.
    pub fn walk<'a>(&'a self, out: &mut Vec<&'a Stmt>) {
        out.push(self);
        if let Self::If(_, a, b) = self {
            for s in a.iter().chain(b) {
                s.walk(out);
            }
        }
    }
}
/// A mutation body: statements, then `return ret`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Block {
    pub stmts: Vec<Stmt>,
    pub ret: Expr,
}
impl Block {
    pub fn all(&self) -> Vec<&Stmt> {
        let mut out = vec![];
        for s in &self.stmts {
            s.walk(&mut out);
        }
        out
    }
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
        /// A shape over each page row (`{ id, t: tags[.tag], .. }`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        project: Option<Vec<Proj>>,
    },
    Write(Write, Expr),
    /// Several statements and writes in one mutation (LLP 3000.035 §5.1 widening).
    Block(Block),
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
    /// Mutations `prep0`, `prep1`, .. the harness runs in order on the same
    /// store before `run`, each at its step's clock (`Case::steps`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prelude: Vec<Block>,
    /// Rows referencing `items` with a delete action (LLP 3000.038), and
    /// optionally rows restricting those (`widen.rs`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kids: Option<Kids>,
}

/// `kids.item: items` with `on delete <action>` (undeclared when `None`),
/// readable by everyone or by its owner, synced or online; `notes.kid: kids`
/// (undeclared, so restrict) when `notes`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Kids {
    pub action: Option<String>,
    pub nullable: bool,
    pub owner_read: bool,
    pub synced: bool,
    pub notes: bool,
}
impl Kids {
    pub fn source(&self) -> String {
        let action = self.action.as_ref().map_or(String::new(), |a| format!(" on delete {a}"));
        let mut out = format!("table kids:\n  item: items{}{action}\n  owner: principal\n", if self.nullable { " ?" } else { "" });
        if matches!(self.action.as_deref(), Some("cascade" | "set null")) { out += "  cap 4 by item\n"; }
        out += &format!("  read <- {}\n  insert <- allow\n  update <- allow\n  delete <- allow\n", if self.owner_read { ".owner = viewer" } else { "allow" });
        out += match (self.synced, self.owner_read) { (true, true) => "  sync to .owner\n", (true, false) => "  sync public\n", _ => "  online only\n" };
        if self.notes {
            out += &format!("\ntable notes:\n  kid: kids\n  read <- allow\n  insert <- allow\n  delete <- allow\n{}", if self.synced { "  sync public\n" } else { "  online only\n" });
        }
        out
    }
    /// The kids `observe` reads after a mutation: those naming `key`, as the viewer may.
    fn observed(&self) -> String {
        format!("kids where .item = key{} first 10 by .id", if self.owner_read { " and .owner = viewer" } else { "" })
    }
}
const SIGNATURE: &str = "key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int";
const WIDE_SIGNATURE: &str = "key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int";
impl Program {
    /// Whether `run` is a mutation (`observe` then reads its result).
    pub fn mutation(&self) -> bool {
        matches!(self.body, Body::Write(..) | Body::Block(_))
    }
    /// Programs with blocks or a prelude take a second key `k2`, and their
    /// `observe` reads both keys.
    pub fn wide(&self) -> bool {
        matches!(self.body, Body::Block(_)) || !self.prelude.is_empty()
    }
    fn block_source(block: &Block, out: &mut String) -> String {
        for s in &block.stmts {
            *out += &s.source(1);
        }
        block.ret.source()
    }
    pub fn source(&self) -> String {
        let mut declarations = self.tables.iter().map(Table::source).collect::<Vec<_>>();
        if self.helper {
            declarations.push("fn identity(x: int): x\n".into());
        }
        if let Some(kids) = &self.kids {
            declarations.push(kids.source());
        }
        if self.reverse {
            declarations.reverse();
        }
        // The prelude comes first, so that no rewrite of `run` or of the
        // declarations moves its source sites.
        let mut out = String::new();
        for (i, block) in self.prelude.iter().enumerate() {
            out += &format!("mutation prep{i}({WIDE_SIGNATURE}):\n");
            let result = Self::block_source(block, &mut out);
            out += &format!("  return {result}\n\n");
        }
        out += &declarations.join("\n");
        let mutation = self.mutation();
        let signature = if self.wide() { WIDE_SIGNATURE } else { SIGNATURE };
        out += &format!(
            "\n{} run({signature}):\n",
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
                project,
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
                let shape = project.as_ref().map_or(String::new(), |fields| {
                    let mut f = vec!["id"];
                    f.extend(fields.iter().map(Proj::source));
                    format!(" {{ {} }}", f.join(", "))
                });
                let end = if *descending { "last" } else { "first" };
                match kind {
                    Read::Point => "items[key]".into(),
                    Read::Page | Read::Bounded => format!(
                        "{domain} {end} {take} by {order}{}{shape}",
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
                    Read::Fold => {
                        out += &format!("  total = 0\n  for row in {domain} {end} {take} by {order}:\n    t = tags[row.tag]\n    if t != null:\n      total = total + t.rank\n");
                        "total".into()
                    }
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
            Body::Block(block) => Self::block_source(block, &mut out),
        };
        if self.bind_return {
            out += &format!("  answer = {result}\n  return answer\n");
        } else {
            out += &format!("  return {result}\n");
        }
        if mutation && let Some(kids) = &self.kids {
            let (signature, item) = if self.wide() { ("key: id, k2: id", "[items[key], items[k2]]") } else { ("key: id", "items[key]") };
            out += &format!("\nquery observe({signature}):\n  return {{ item: {item}, kids: {} }}\n", kids.observed());
        } else if mutation {
            if self.wide() {
                out += "\nquery observe(key: id, k2: id):\n  return [items[key], items[k2]]\n";
            } else {
                out += "\nquery observe(key: id):\n  return items[key]\n";
            }
        }
        out
    }
}
