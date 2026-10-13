//! The Lean model's case format (LLP 3000.035 §5.2): a checked Quarry
//! program, translated from its **surface** syntax tree into the terms of
//! `snapback4/lean/Quarry/Syntax.lean`, as the JSON that
//! `snapback4/lean/Quarry/CaseJson.lean` decodes (format:
//! `snapback4/lean/README.md`, "The case format").
//!
//! **Why the surface tree.** The model is a second implementation of the
//! binder and the interpreter together. Reading the binder's IR would copy
//! the binder's decisions into the model's input, and the comparison could
//! no longer find a binder defect. So nothing here reads `bind` or the IR:
//! the input is the parsed [`Document`]s, and the only binder fact used is
//! that [`crate::compile`] reported no diagnostics, i.e. that the program
//! type-checks ([`lean`] refuses otherwise).
//!
//! **Types.** The few places that need a type (a text literal beside an id is
//! an id, OPEN V1; a positional key chooses a unique key by its argument
//! types, indexes card) take it from the surface's own declarations, which
//! the type checker has accepted: column types, argument types, helper
//! parameters, `viewer : principal`, and literal kinds, propagated through
//! locals by the small inference in [`Scope::ty`]. When that inference cannot
//! decide, the program is unsupported, never guessed.
//!
//! **The expansions** are those `Syntax.lean` documents: `public` is
//! `read <- allow`; an omitted rule is `deny`; an unnamed `update <- R` is
//! `R[old] and R[next]` (OPEN R2); positional keys become named equalities
//! on `id` (an `id`-typed or `t`-typed single key) or on the one declared
//! unique key whose column types accept the arguments in order; in a
//! `where`, each `.col = e` conjunct (e not reading the row) is a pin and the
//! remaining conjuncts are the filter; `return insert …` is a bound write
//! followed by `return`.
//!
//! **Erased, with the reason.** `sync …` and `online only` (residency
//! decides what a device holds, never a server outcome) and non-unique
//! `by` indexes (tuning; reads choose indexes themselves). A `text <= N`
//! bound is not modelled as a value restriction (OPEN W6):
//! [`LeanModule::store`] and [`LeanModule::tag_args`] refuse inputs that exceed
//! it, and a literal written past it is unsupported. The surface emitter does
//! use the bound to keep PAGE cases with nonportable synthesized keys out of
//! the fragment before the oracle. A computed text written to a bounded column
//! is not checked.
//!
//! **Everything else** outside the model's core fragment is an
//! [`Unsupported`] with a stable `reason` (counted by the harness, never a
//! pass) and a `detail` naming the construct. A translation is all or
//! nothing: there is no partial program.
// @ref LLP 3000.035#52-stage-2-a-small-lean-core — the emitter half of the Lean oracle; surface tree in, model terms out

use crate::ast::{self, Document, Effect, Expr, KeyPart, Literal, ObjectField, OnDelete, Order, ReadExpr, Stmt, TypeKind, WriteOp};
use serde_json::{Map, Value as Json, json};
use std::collections::{BTreeMap, BTreeSet};

/// A construct outside the model's core fragment.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Unsupported {
    /// Stable, low-cardinality name (the harness counts by it).
    pub reason: String,
    /// The construct, for a human.
    pub detail: String,
}

impl Unsupported {
    fn new(reason: impl Into<String>, detail: impl Into<String>) -> Self {
        Self { reason: reason.into(), detail: detail.into() }
    }
}

impl std::fmt::Display for Unsupported {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.reason, self.detail)
    }
}

mod pages;

type R<T> = Result<T, Unsupported>;

/// The calendar builtins the model evaluates (LLP 3000.040 §2.5).
const CALENDAR: [&str; 7] = ["day", "hour", "bucket", "month", "year", "monthStart", "yearStart"];

fn no<T>(reason: &str, detail: impl Into<String>) -> R<T> {
    Err(Unsupported::new(reason, detail))
}

/// What an id-valued column or argument names. All three are the model's
/// `id` scalar; the distinction only chooses positional keys.
#[derive(Clone, Debug, PartialEq, Eq)]
enum IdSort {
    Plain,
    Principal,
    Ref(String),
}

/// A scalar kind of the model.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Kind {
    Int,
    Text(Option<u32>),
    Id(IdSort),
    Bool,
    Cursor,
}

impl Kind {
    fn of(t: &TypeKind) -> R<Kind> {
        Ok(match t {
            TypeKind::Int | TypeKind::Time => Kind::Int,
            // @ref LLP 3000.040#18-the-lean-model — slot bounds sit outside the model's fragment, as text bounds do.
            TypeKind::IntRange { .. } => return no("int-range", "an int range"),
            TypeKind::Text { min: None, max, format: None } => Kind::Text(Some(*max)),
            TypeKind::Text { format: Some(_), .. } => return no("text-format", "a text format"),
            TypeKind::Text { min: Some(_), .. } => return no("text-minimum", "a text minimum length"),
            TypeKind::Id => Kind::Id(IdSort::Plain),
            TypeKind::Principal => Kind::Id(IdSort::Principal),
            TypeKind::Ref { table } => Kind::Id(IdSort::Ref(table.clone())),
            TypeKind::Bool => Kind::Bool,
            TypeKind::Cursor => Kind::Cursor,
            TypeKind::Decimal { .. } => return no("type-decimal", "decimal"),
            TypeKind::Money { .. } => return no("type-money", "money"),
            TypeKind::Json { .. } => return no("type-json", "json"),
            TypeKind::Bytes { .. } => return no("type-bytes", "bytes"),
            TypeKind::Image { .. } | TypeKind::Video { .. } | TypeKind::File { .. } => return no("type-asset", "an asset type"),
            TypeKind::Enum { .. } => return no("type-enum", "an enum"),
            TypeKind::List { .. } => return no("type-list", "a list"),
        })
    }
    fn is_id(&self) -> bool {
        matches!(self, Kind::Id(_))
    }
}

/// A static type, as far as the fragment needs one.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Ty {
    Scalar(Kind),
    Row(String),
    Unknown,
}

#[derive(Clone, Debug)]
struct Col {
    name: String,
    kind: Kind,
    nullable: bool,
    /// A reference's effective delete action (LLP 3000.039 §2): the declared
    /// one, else restrict; `None` for `keep` and for a non-reference.
    on_delete: Option<&'static str>,
}

#[derive(Clone, Debug)]
struct Table {
    name: String,
    cols: Vec<Col>,
    uniques: Vec<Vec<String>>,
    codes: Vec<Option<String>>,
    /// Caps are carried as unenforced declarations: a program that inserts
    /// into or updates a capped table is outside the fragment (`table-cap`).
    caps: Vec<(u32, Vec<String>)>,
}

impl Table {
    fn col(&self, name: &str) -> Option<Kind> {
        if name == "id" {
            return Some(Kind::Id(IdSort::Ref(self.name.clone())));
        }
        self.cols.iter().find(|c| c.name == name).map(|c| c.kind.clone())
    }
}

/// A checked program set, translated.
#[derive(Clone, Debug)]
pub struct LeanModule {
    tables: Vec<Table>,
    /// Surface declarations retained only for fragment eligibility. The model
    /// omits physical indexes, so PAGE must reject cases whose synthesized
    /// source or target key cannot fit every store before asking the oracle.
    surface_tables: Vec<ast::TableDecl>,
    /// `{"tables":[…]}` of `Syntax.lean`'s `Schema`.
    pub schema: Json,
    /// `Helper`s.
    pub helpers: Json,
    /// Each program, or why it is outside the fragment.
    pub programs: BTreeMap<String, R<Json>>,
    args: BTreeMap<String, Vec<(String, Kind, bool)>>,
}

/// Why [`lean`] produced no module.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LeanError {
    /// The sources do not compile; the model takes only checked programs.
    Diagnostics(Vec<String>),
    /// A schema-level construct outside the fragment.
    Unsupported(Unsupported),
}

/// Check `sources` with [`crate::compile`], then translate their surface
/// trees. A program outside the fragment is recorded per program in
/// [`LeanModule::programs`]; a schema construct outside it refuses the whole
/// module.
pub fn lean(sources: &[(String, String)]) -> Result<LeanModule, LeanError> {
    let bound = crate::compile(sources);
    if !bound.diagnostics.is_empty() {
        return Err(LeanError::Diagnostics(bound.diagnostics.iter().map(|d| format!("{}: {}", d.code, d.message)).collect()));
    }
    let documents: Vec<Document> = sources.iter().map(|(file, source)| crate::parse_document(file, source).0).collect();
    from_documents(&documents).map_err(LeanError::Unsupported)
}

/// Translate documents that [`crate::compile`] has accepted. Callers that
/// have not checked them must use [`lean`].
pub fn from_documents(documents: &[Document]) -> R<LeanModule> {
    for d in documents {
        for (present, what) in [
            (!d.maintains.is_empty(), "maintain"),
            (!d.timelines.is_empty(), "timeline"),
            (!d.views.is_empty() || !d.feed_views.is_empty(), "view"),
            (!d.effects.is_empty(), "effect"),
            (!d.shapes.is_empty(), "shape"),
            (!d.actions.is_empty(), "action"),
            (!d.routes.is_empty(), "route"),
            (!d.schedules.is_empty(), "schedule"),
            (d.identity.is_some(), "identity"),
        ] {
            if present {
                return no(&format!("declaration-{what}"), format!("a {what} declaration in {}", d.file));
            }
        }
    }
    let decls: Vec<&ast::TableDecl> = documents.iter().flat_map(|d| d.tables.iter()).collect();
    let mut tables = Vec::new();
    for t in &decls {
        tables.push(table_shape(t)?);
    }
    let module_tables = tables.clone();
    let mut schema_tables = Vec::new();
    for (t, shape) in decls.iter().zip(&tables) {
        schema_tables.push(table_json(t, shape, &module_tables)?);
    }
    let functions: Vec<&ast::FunctionDecl> = documents.iter().flat_map(|d| d.functions.iter()).collect();
    let helper_names: Vec<String> = functions.iter().map(|f| f.name.clone()).collect();
    let mut module = LeanModule {
        tables,
        surface_tables: decls.iter().map(|table| (*table).clone()).collect(),
        schema: json!({"tables": schema_tables}),
        helpers: json!([]),
        programs: BTreeMap::new(),
        args: BTreeMap::new(),
    };
    let mut helpers = Vec::new();
    for f in &functions {
        let ast::FunctionBody::Expression(body) = &f.body else {
            return no("helper-block", format!("helper {} has a block body", f.name));
        };
        let mut scope = Scope::new(&module, &helper_names);
        for a in &f.args {
            if a.type_.optional {
                return no("helper-optional-parameter", format!("{}({})", f.name, a.name));
            }
            scope.vars.insert(a.name.clone(), Ty::Scalar(Kind::of(&a.type_.kind)?));
        }
        let body = scope.expr(body)?;
        helpers.push(json!({"name": f.name, "params": f.args.iter().map(|a| a.name.clone()).collect::<Vec<_>>(), "body": body}));
    }
    module.helpers = Json::Array(helpers);
    let programs: Vec<&ast::ProgramDecl> = documents.iter().flat_map(|d| d.programs.iter()).collect();
    let mut signatures = BTreeMap::new();
    for p in &programs {
        let args = p.args.iter().map(|a| Ok((a.name.clone(), Kind::of(&a.type_.kind)?, a.type_.optional))).collect::<R<Vec<_>>>();
        if let Ok(args) = &args {
            module.args.insert(p.name.clone(), args.clone());
        }
        signatures.insert(p.name.clone(), args);
    }
    for p in &programs {
        let result = signatures[&p.name].clone().and_then(|args| program(&module, &helper_names, p, &args));
        module.programs.insert(p.name.clone(), result);
    }
    Ok(module)
}

fn table_shape(t: &ast::TableDecl) -> R<Table> {
    for (present, what) in [
        (t.receipts.is_some(), "receipts"),
        (t.ephemeral.is_some(), "ephemeral"),
        (!t.search.is_empty(), "search"),
        (!t.immutable.is_empty(), "immutable"),
        (!t.final_exists.is_empty(), "after-insert"),
        (t.retain.is_some(), "retain"),
        (t.expire.is_some(), "expiry"),
    ] {
        if present {
            return no(&format!("table-{what}"), format!("table {} declares {what}", t.name));
        }
    }
    let mut cols = Vec::new();
    for c in &t.columns {
        for (present, what) in [
            (c.sequence.is_some(), "sequence"),
            (c.written_by.is_some(), "written-by"),
            (c.readable_by_audience, "audience-field"),
            (c.maintained.is_some(), "maintained"),
            (c.default.is_some(), "default"),
        ] {
            if present {
                return no(&format!("column-{what}"), format!("{}.{}", t.name, c.name));
            }
        }
        let kind = Kind::of(&c.type_.kind)?;
        if kind == Kind::Cursor {
            return no("type-cursor-column", format!("{}.{}", t.name, c.name));
        }
        // @ref LLP 3000.039#2 — an undeclared reference restricts; keep is the legacy meaning, spelled by absence.
        let on_delete = match (&c.type_.kind, c.on_delete.as_ref().map(|(a, _)| *a)) {
            (TypeKind::Ref { .. }, None | Some(OnDelete::Restrict)) => Some("restrict"),
            (TypeKind::Ref { .. }, Some(OnDelete::Cascade)) => Some("cascade"),
            (TypeKind::Ref { .. }, Some(OnDelete::SetNull)) => Some("setNull"),
            _ => None,
        };
        cols.push(Col { name: c.name.clone(), kind, nullable: c.type_.optional, on_delete });
    }
    let mut uniques = Vec::new();
    let mut codes = Vec::new();
    for i in &t.indexes {
        if !i.is_plain() {
            return no("index-computed-or-words", format!("{} index {}", t.name, i.name));
        }
        if i.unique {
            uniques.push(i.columns.clone());
            codes.push(i.refusal.as_ref().map(|(code, _)| code.clone()));
        }
    }
    Ok(Table { name: t.name.clone(), cols, uniques, codes,
        caps: t.caps.iter().map(|cap| (cap.max, cap.by.clone())).collect() })
}

fn table_json(t: &ast::TableDecl, shape: &Table, tables: &[Table]) -> R<Json> {
    let mut rules: BTreeMap<&str, Json> = BTreeMap::new();
    if t.public.is_some() {
        rules.insert("read", json!("allow"));
    }
    for r in &t.rules {
        let word = r.effect.word();
        if rules.contains_key(word) {
            return no("rule-repeated", format!("{} has two {word} rules", t.name));
        }
        let ctx = RuleCtx { table: shape, tables };
        let json = match (r.effect, r.bindings.as_slice()) {
            (Effect::Update, []) => {
                // OPEN R2: an unnamed update rule judges both images.
                json!({"and": [ctx.rule(&r.value, &Images::As("old"))?, ctx.rule(&r.value, &Images::As("next"))?]})
            }
            (Effect::Update, [old, next]) => ctx.rule(&r.value, &Images::Named { old: old.clone(), next: next.clone() })?,
            (_, []) => ctx.rule(&r.value, &Images::As("self"))?,
            _ => return no("rule-bindings", format!("{} {word} rule bindings", t.name)),
        };
        rules.insert(word, json);
    }
    let rule = |w: &str| rules.get(w).cloned().unwrap_or(json!("deny"));
    Ok(json!({
        "name": t.name,
        "cols": shape.cols.iter().map(|c| {
            let mut col = json!({"name": c.name, "nullable": c.nullable});
            if let (Kind::Id(IdSort::Ref(target)), Some(action)) = (&c.kind, c.on_delete) {
                col["ref"] = json!(target);
                col["onDelete"] = json!(action);
            }
            col
        }).collect::<Vec<_>>(),
        "uniques": shape.uniques,
        "uniqueCodes": shape.codes,
        "caps": shape.caps.iter().map(|(max, by)| json!({"by": by, "max": max})).collect::<Vec<_>>(),
        "notBefore": t.not_before.as_ref().map(|(column, _)| column),
        "read": rule("read"), "insert": rule("insert"), "update": rule("update"), "delete": rule("delete"),
    }))
}

/// Which image a focal `.col` names, or the named update images.
enum Images {
    As(&'static str),
    Named { old: String, next: String },
}

struct RuleCtx<'a> {
    table: &'a Table,
    tables: &'a [Table],
}

impl RuleCtx<'_> {
    fn rule(&self, e: &Expr, images: &Images) -> R<Json> {
        match e {
            Expr::Name { name, .. } => match name.as_str() {
                "allow" | "true" => Ok(json!("allow")),
                "deny" | "false" => Ok(json!("deny")),
                "public" => Ok(json!("allow")),
                other => no("rule-name", other),
            },
            Expr::Literal { value: Literal::Bool(b), .. } => Ok(json!(if *b { "allow" } else { "deny" })),
            Expr::Call { name, .. } if name == "public" => Ok(json!("allow")),
            Expr::Binary { op, left, right, .. } => match op.as_str() {
                "and" | "or" => Ok(json!({op.as_str(): [self.rule(left, images)?, self.rule(right, images)?]})),
                "=" | "!=" => {
                    let (a, b) = self.compared(left, right, images)?;
                    Ok(json!({if op == "=" { "eq" } else { "ne" }: [a, b]}))
                }
                ">" | ">=" | "<" | "<=" => no("rule-ordered-comparison", crate::print::expression(e)),
                other => no("rule-operator", other),
            },
            Expr::Unary { op, value, .. } if op == "not" => Ok(json!({"not": self.rule(value, images)?})),
            Expr::Member { .. } => {
                let (t, k) = self.term(e, images)?;
                if k != Some(Kind::Bool) {
                    return no("rule-bare-term", crate::print::expression(e));
                }
                Ok(json!({"eq": [t, {"lit": {"bool": true}}]}))
            }
            Expr::Exists { read, .. } => self.probe(read, images),
            Expr::Created { .. } => no("rule-created", crate::print::expression(e)),
            _ => no("rule-form", crate::print::expression(e)),
        }
    }

    /// Two compared terms; a text literal beside an id-valued term is an id
    /// (OPEN V1).
    fn compared(&self, left: &Expr, right: &Expr, images: &Images) -> R<(Json, Json)> {
        let (mut a, ak) = self.term(left, images)?;
        let (mut b, bk) = self.term(right, images)?;
        if ak.as_ref().is_some_and(Kind::is_id) {
            id_literal(&mut b);
        }
        if bk.as_ref().is_some_and(Kind::is_id) {
            id_literal(&mut a);
        }
        Ok((a, b))
    }

    fn term(&self, e: &Expr, images: &Images) -> R<(Json, Option<Kind>)> {
        match e {
            Expr::Name { name, .. } if name == "viewer" => Ok((json!("viewer"), Some(Kind::Id(IdSort::Principal)))),
            Expr::Literal { value, .. } => {
                let (s, k) = literal_scalar(value)?;
                Ok((json!({"lit": s}), k))
            }
            // @ref LLP 3000.036.001#14 — fixed membership residuals compare canonical scalar values across rule and expression IR.
            Expr::Unary { op, value, .. } if op == "-" => match value.as_ref() {
                Expr::Literal { value: Literal::Number(n), .. } => {
                    let magnitude = n.parse::<i64>().map_err(|_| Unsupported::new("number-literal", n.clone()))?;
                    let value = magnitude.checked_neg().ok_or_else(|| Unsupported::new("number-literal", format!("-{n}")))?;
                    Ok((json!({"lit": {"int": value.to_string()}}), Some(Kind::Int)))
                }
                _ => no("rule-term", crate::print::expression(e)),
            },
            Expr::Member { base, name, .. } => {
                let image = match (base.as_ref(), images) {
                    (Expr::Focal { .. }, Images::As(img)) => *img,
                    (Expr::Name { name: b, .. }, Images::Named { old, .. }) if b == old => "old",
                    (Expr::Name { name: b, .. }, Images::Named { next, .. }) if b == next => "next",
                    _ => return no("rule-hop", crate::print::expression(e)),
                };
                let Some(kind) = self.table.col(name) else { return no("rule-hop", crate::print::expression(e)) };
                Ok((json!({"col": [image, name]}), Some(kind)))
            }
            _ => no("rule-term", crate::print::expression(e)),
        }
    }

    fn probe(&self, read: &ReadExpr, images: &Images) -> R<Json> {
        if read.range.is_some() || read.filter.is_some() || read.index.is_some() || !read.seeks.is_empty() || read.matching.is_some() || !read.computed.is_empty() {
            return no("rule-probe-form", crate::print::read_expr(read));
        }
        let Some(target) = self.tables.iter().find(|t| t.name == read.table) else { return no("rule-probe-form", &read.table) };
        let mut terms = Vec::new();
        for k in &read.keys {
            terms.push(self.term(&k.value, images)?);
        }
        let kinds: Vec<Option<Kind>> = terms.iter().map(|t| t.1.clone()).collect();
        let columns = resolve_key(target, &read.keys, &kinds)?;
        let point = resolve_probe_point(target, &read.keys, &columns)?;
        let mut key = Vec::new();
        for (c, (mut t, _)) in columns.iter().zip(terms) {
            if target.col(c).as_ref().is_some_and(Kind::is_id) {
                id_literal(&mut t);
            }
            key.push(json!([c, t]));
        }
        Ok(json!({"probe": {"table": read.table, "point": point, "key": key}}))
    }
}

/// Retag a text literal term or expression as an id.
fn id_literal(j: &mut Json) {
    if let Some(lit) = j.get_mut("lit") {
        if let Some(text) = lit.get("text").cloned() {
            *lit = json!({"id": text});
        }
    }
}

fn literal_scalar(value: &Literal) -> R<(Json, Option<Kind>)> {
    Ok(match value {
        Literal::Str(s) => (json!({"text": s}), Some(Kind::Text(None))),
        Literal::Number(n) => match n.parse::<i64>() {
            Ok(v) => (json!({"int": v.to_string()}), Some(Kind::Int)),
            Err(_) => return no("number-literal", n.clone()),
        },
        Literal::Bool(b) => (json!({"bool": b}), Some(Kind::Bool)),
        Literal::Null => (json!({"null": null}), None),
    })
}

/// Whether a column of kind `col` accepts an argument of kind `arg` in a
/// positional key (indexes card: "exactly one declared unique key must
/// accept the argument types in order").
fn accepts(col: &Kind, arg: &Kind) -> bool {
    match (col, arg) {
        (Kind::Int, Kind::Int) | (Kind::Bool, Kind::Bool) => true,
        (Kind::Text(_), Kind::Text(_)) => true,
        (Kind::Id(a), Kind::Id(b)) => a == b || matches!((a, b), (IdSort::Plain, IdSort::Ref(_)) | (IdSort::Ref(_), IdSort::Plain)),
        _ => false,
    }
}

/// Named columns for a key: named parts as written; a single `id`- or
/// `t`-typed positional part is `id`; otherwise the one declared unique key
/// of the same arity whose column types accept the arguments in order.
fn resolve_key(table: &Table, keys: &[KeyPart], kinds: &[Option<Kind>]) -> R<Vec<String>> {
    if keys.iter().all(|k| k.column.is_some()) {
        let names: Vec<String> = keys.iter().map(|k| k.column.clone().unwrap()).collect();
        for n in &names {
            if n.contains('.') || table.col(n).is_none() {
                return no("key-column", format!("{}[{n}]", table.name));
            }
        }
        return Ok(names);
    }
    if keys.iter().any(|k| k.column.is_some()) {
        return no("key-mixed", format!("{}[..]", table.name));
    }
    if kinds.iter().any(Option::is_none) {
        return no("key-untyped", format!("{}[..]", table.name));
    }
    let kinds: Vec<Kind> = kinds.iter().map(|k| k.clone().unwrap()).collect();
    if let [Kind::Id(sort)] = kinds.as_slice() {
        if matches!(sort, IdSort::Plain) || matches!(sort, IdSort::Ref(t) if *t == table.name) {
            return Ok(vec!["id".into()]);
        }
    }
    let fits: Vec<&Vec<String>> = table
        .uniques
        .iter()
        .filter(|u| u.len() == kinds.len() && u.iter().zip(&kinds).all(|(c, k)| table.col(c).is_some_and(|ck| accepts(&ck, k))))
        .collect();
    match fits.as_slice() {
        [one] => Ok((*one).clone()),
        _ => no("key-unresolved", format!("{}[..] matches {} unique keys", table.name, fits.len())),
    }
}

/// The unique key selected by a rule probe. Named equalities may contain
/// residual predicates beyond the point key; the binder selects the shortest
/// covered total unique, then the first declared candidate. Positional probes
/// keep their declared-only, type-directed resolution above.
// @ref LLP 3000.036.001#14 — nullable residual membership equalities are distinct from the selected point key.
fn resolve_probe_point(table: &Table, keys: &[KeyPart], columns: &[String]) -> R<Vec<String>> {
    if keys.iter().any(|key| key.column.is_none()) {
        return Ok(columns.to_vec());
    }
    if columns.iter().any(|column| column == "id") {
        return Ok(vec!["id".into()]);
    }
    let total = |unique: &[String]| {
        unique.iter().all(|column| {
            column == "id"
                || table
                    .cols
                    .iter()
                    .find(|candidate| candidate.name == *column)
                    .is_some_and(|candidate| !candidate.nullable)
        })
    };
    let mut candidates: Vec<&Vec<String>> = table
        .uniques
        .iter()
        .filter(|unique| {
            unique.len() == columns.len() && unique.iter().all(|column| columns.contains(column))
                || total(unique) && unique.iter().all(|column| columns.contains(column))
        })
        .collect();
    if let Some(width) = candidates
        .iter()
        .filter(|unique| total(unique))
        .map(|unique| unique.len())
        .min()
    {
        candidates.retain(|unique| unique.len() == width && total(unique));
        if candidates.len() > 1 {
            let sets: BTreeSet<Vec<String>> = candidates
                .iter()
                .map(|unique| {
                    let mut columns = (*unique).clone();
                    columns.sort();
                    columns
                })
                .collect();
            if sets.len() != candidates.len() {
                return no(
                    "rule-probe-key",
                    format!(
                        "{}[..] matches repeated orderings of one unique key",
                        table.name
                    ),
                );
            }
        }
        return Ok(candidates[0].clone());
    } else if let [selected] = candidates.as_slice() {
        return Ok((*selected).clone());
    }
    no(
        "rule-probe-key",
        format!("{}[..] does not select one declared unique key", table.name),
    )
}

/// Expression translation in one lexical scope.
struct Scope<'a> {
    module: &'a LeanModule,
    helpers: &'a [String],
    vars: BTreeMap<String, Ty>,
    /// The table a `.col` names (in a `where` or an update condition).
    focal: Option<String>,
}

impl<'a> Scope<'a> {
    fn new(module: &'a LeanModule, helpers: &'a [String]) -> Self {
        Self { module, helpers, vars: BTreeMap::new(), focal: None }
    }

    fn table(&self, name: &str) -> R<&'a Table> {
        match self.module.tables.iter().find(|t| t.name == name) {
            Some(t) => Ok(t),
            None => no("table-unknown", name),
        }
    }

    fn with_focal(&self, table: &str) -> Scope<'a> {
        Scope { module: self.module, helpers: self.helpers, vars: self.vars.clone(), focal: Some(table.to_owned()) }
    }

    /// The static type of `e`, as far as the fragment's literal typing and
    /// key resolution need it.
    fn ty(&self, e: &Expr) -> Ty {
        match e {
            Expr::Name { name, .. } if name == "viewer" => Ty::Scalar(Kind::Id(IdSort::Principal)),
            Expr::Name { name, .. } => self.vars.get(name).cloned().unwrap_or(Ty::Unknown),
            Expr::Literal { value, .. } => match literal_scalar(value) {
                Ok((_, Some(k))) => Ty::Scalar(k),
                _ => Ty::Unknown,
            },
            Expr::Member { base, name, .. } => {
                let table = match base.as_ref() {
                    Expr::Focal { .. } => self.focal.clone(),
                    other => match self.ty(other) {
                        Ty::Row(t) | Ty::Scalar(Kind::Id(IdSort::Ref(t))) => Some(t),
                        _ => None,
                    },
                };
                table
                    .and_then(|t| self.module.tables.iter().find(|x| x.name == t).and_then(|x| x.col(name)))
                    .map(Ty::Scalar)
                    .unwrap_or(Ty::Unknown)
            }
            Expr::Read(read) if read.range.is_none() && read.filter.is_none() && !read.keys.is_empty() => Ty::Row(read.table.clone()),
            Expr::Call { name, .. } if name == "count" || CALENDAR.contains(&name.as_str()) => Ty::Scalar(Kind::Int),
            Expr::Exists { .. } => Ty::Scalar(Kind::Bool),
            Expr::Unary { op, value, .. } => if op == "not" { Ty::Scalar(Kind::Bool) } else { self.ty(value) },
            Expr::Binary { op, left, .. } => match op.as_str() {
                "+" | "-" | "*" | "/" | "%" | "??" => self.ty(left),
                _ => Ty::Scalar(Kind::Bool),
            },
            Expr::Assert { value, .. } => self.ty(value),
            Expr::If { then, .. } => self.ty(then),
            _ => Ty::Unknown,
        }
    }

    fn kind(&self, e: &Expr) -> Option<Kind> {
        match self.ty(e) {
            Ty::Scalar(k) => Some(k),
            _ => None,
        }
    }

    /// `e` as a value of kind `want`: a text literal for an id is an id.
    fn expr_as(&self, e: &Expr, want: Option<&Kind>) -> R<Json> {
        let mut j = self.expr(e)?;
        if want.is_some_and(Kind::is_id) {
            id_literal(&mut j);
        }
        Ok(j)
    }

    fn expr(&self, e: &Expr) -> R<Json> {
        let print = || crate::print::expression(e);
        match e {
            Expr::Name { name, .. } => match name.as_str() {
                "viewer" => Ok(json!("viewer")),
                _ if self.vars.contains_key(name) => Ok(json!({"var": name})),
                "now" => no("now", print()),
                _ => no("name", print()),
            },
            Expr::Literal { value, .. } => Ok(json!({"lit": literal_scalar(value)?.0})),
            Expr::Array { items, .. } => Ok(json!({"arr": items.iter().map(|x| self.expr(x)).collect::<R<Vec<_>>>()?})),
            Expr::Object { fields, .. } => Ok(json!({"record": self.fields(fields, None)?})),
            Expr::Unary { op, value, .. } => match op.as_str() {
                "-" => Ok(json!({"neg": self.expr(value)?})),
                "not" => Ok(json!({"not": self.expr(value)?})),
                _ => no("unary-operator", print()),
            },
            Expr::Binary { op, left, right, .. } => {
                let bin = |name: &str| -> R<Json> { Ok(json!({"bin": [name, self.expr(left)?, self.expr(right)?]})) };
                match op.as_str() {
                    "+" => bin("add"),
                    "-" => bin("sub"),
                    "*" => bin("mul"),
                    "/" => bin("div"),
                    "%" => bin("mod"),
                    "<" => bin("lt"),
                    "<=" => bin("le"),
                    ">" => bin("gt"),
                    ">=" => bin("ge"),
                    "=" | "!=" => {
                        let (lk, rk) = (self.kind(left), self.kind(right));
                        let a = self.expr_as(left, rk.as_ref())?;
                        let b = self.expr_as(right, lk.as_ref())?;
                        Ok(json!({"bin": [if op == "=" { "eq" } else { "ne" }, a, b]}))
                    }
                    "and" | "or" => Ok(json!({op.as_str(): [self.expr(left)?, self.expr(right)?]})),
                    "??" => Ok(json!({"coalesce": [self.expr(left)?, self.expr(right)?]})),
                    _ => no("binary-operator", op.clone()),
                }
            }
            Expr::Member { base, name, .. } => match base.as_ref() {
                Expr::Focal { .. } => match &self.focal {
                    Some(t) if self.table(t)?.col(name).is_some() => Ok(json!({"dot": name})),
                    _ => no("focal-column", print()),
                },
                other => {
                    let value = self.expr(other)?;
                    // @ref LLP 3000.036#12 — a reference's member is an authorized point read, null when missing or hidden.
                    match self.ty(other) {
                        Ty::Scalar(Kind::Id(IdSort::Ref(target))) if name != "id" => {
                            self.table(&target)?;
                            Ok(json!({"field": [{"point": {"table": target, "key": [["id", value]]}}, name]}))
                        }
                        Ty::Scalar(Kind::Id(IdSort::Ref(_))) => Ok(value),
                        Ty::Unknown => no("member-type", print()),
                        _ => Ok(json!({"field": [value, name]})),
                    }
                },
            },
            Expr::Call { name, args, .. } => {
                if self.helpers.contains(name) {
                    return Ok(json!({"call": [name, args.iter().map(|a| self.expr(a)).collect::<R<Vec<_>>>()?]}));
                }
                match (name.as_str(), args.as_slice()) {
                    // @ref LLP 3000.040#25-the-lean-model — calendar builtins are in the fragment.
                    (calendar, [value, rest @ ..]) if CALENDAR.contains(&calendar) => {
                        let literal = |e: &Expr| match e {
                            Expr::Literal { value: Literal::Number(n), .. } => n.parse::<i64>().map_err(|_| Unsupported::new("calendar-duration", print())),
                            _ => no("calendar-duration", print()),
                        };
                        let function = match (calendar, rest) {
                            ("day", []) => json!({"fn": "period", "ms": 86_400_000, "off": 0}),
                            ("day", [off]) => json!({"fn": "period", "ms": 86_400_000, "off": literal(off)?}),
                            ("hour", []) => json!({"fn": "period", "ms": 3_600_000, "off": 0}),
                            ("hour", [off]) => json!({"fn": "period", "ms": 3_600_000, "off": literal(off)?}),
                            ("bucket", [ms]) => json!({"fn": "period", "ms": literal(ms)?, "off": 0}),
                            ("bucket", [ms, off]) => json!({"fn": "period", "ms": literal(ms)?, "off": literal(off)?}),
                            (civil @ ("month" | "year" | "monthStart" | "yearStart"), []) => json!({"fn": civil}),
                            _ => return no(&format!("call-{name}"), print()),
                        };
                        let mut function = function;
                        function["arg"] = self.expr(value)?;
                        Ok(json!({"cal": function}))
                    }
                    ("count", [Expr::Read(read)]) => {
                        let (pins, filter) = self.domain(read, false)?;
                        Ok(json!({"count": {"table": read.table, "pins": pins, "filter": filter}}))
                    }
                    _ => no(&format!("call-{name}"), print()),
                }
            }
            Expr::Read(read) => self.read(read),
            // `exists t[key]` is a point read compared with null; only a search
            // `exists t where …` is the model's `exists` (LLP 3000.036 §15.12).
            Expr::Exists { read, .. } if read.range.is_none() && read.filter.is_none() && !read.keys.is_empty() => {
                Ok(json!({"bin": ["ne", self.read(read)?, {"lit": {"null": null}}]}))
            }
            Expr::Exists { read, .. } => {
                let (pins, filter) = self.domain(read, true)?;
                Ok(json!({"exists": {"table": read.table, "pins": pins, "filter": filter}}))
            }
            Expr::Assert { value, code, .. } => Ok(json!({"assert": [self.expr(value)?, code]})),
            Expr::If { then, condition, otherwise, .. } => Ok(json!({"cond": [self.expr(condition)?, self.expr(then)?, self.expr(otherwise)?]})),
            Expr::Write { .. } => no("write-position", "a write inside an expression"),
            Expr::Focal { .. } => no("focal-row", print()),
            Expr::Merge(_) => no("merge", print()),
            Expr::Created { .. } => no("created", print()),
            Expr::ShapeUse { .. } | Expr::Shape { .. } => no("shape", print()),
            Expr::Walk { .. } => no("walk", print()),
        }
    }

    /// Named fields; with `table`, each value takes its column's kind.
    fn fields(&self, fields: &[ObjectField], table: Option<&Table>) -> R<Vec<Json>> {
        let mut out = Vec::new();
        for f in fields {
            if f.spread {
                return no("spread", "an object spread");
            }
            let kind = table.and_then(|t| t.col(&f.name));
            let value = match &f.value {
                Some(v) => {
                    if let (Some(Kind::Text(Some(max))), Expr::Literal { value: Literal::Str(s), .. }) = (&kind, v) {
                        if s.chars().count() > *max as usize {
                            return no("text-bound", format!("{} chars into text <={max}", s.chars().count()));
                        }
                    }
                    self.expr_as(v, kind.as_ref())?
                }
                None => {
                    if !self.vars.contains_key(&f.name) {
                        return no("name", f.name.clone());
                    }
                    json!({"var": f.name})
                }
            };
            out.push(json!([f.name, value]));
        }
        Ok(out)
    }

    /// A key, resolved to named columns of `table`.
    fn key(&self, table: &Table, keys: &[KeyPart]) -> R<Vec<Json>> {
        let kinds: Vec<Option<Kind>> = keys.iter().map(|k| self.kind(&k.value)).collect();
        let columns = resolve_key(table, keys, &kinds)?;
        let mut out = Vec::new();
        for (c, k) in columns.iter().zip(keys) {
            out.push(json!([c, self.expr_as(&k.value, table.col(c).as_ref())?]));
        }
        Ok(out)
    }

    /// A `where` domain as pins and a residual filter (`Syntax.lean`): each
    /// `.col = e` conjunct whose `e` does not read the row is a pin.
    fn domain(&self, read: &ReadExpr, keyed: bool) -> R<(Vec<Json>, Json)> {
        if read.index.is_some() || !read.seeks.is_empty() || read.matching.is_some() || !read.computed.is_empty() || read.cursor_prefix.is_some() {
            return no("read-form", crate::print::read_expr(read));
        }
        let table = self.table(&read.table)?;
        let mut pins = if read.keys.is_empty() {
            Vec::new()
        } else if keyed && read.filter.is_none() {
            self.key(table, &read.keys)?
        } else {
            return no("keyed-range", crate::print::read_expr(read));
        };
        let focal = self.with_focal(&read.table);
        let mut residual = Vec::new();
        let mut conjuncts = Vec::new();
        if let Some(f) = &read.filter {
            flatten_and(f, &mut conjuncts);
        }
        for c in conjuncts {
            if let Expr::Binary { op, left, right, .. } = c {
                if op == "=" {
                    let pin = match (column_of(left), column_of(right)) {
                        (Some(col), None) if !reads_row(right) => Some((col, right)),
                        (None, Some(col)) if !reads_row(left) => Some((col, left)),
                        _ => None,
                    };
                    if let Some((col, value)) = pin {
                        let Some(kind) = table.col(col) else { return no("focal-column", col.to_owned()) };
                        pins.push(json!([col, self.expr_as(value, Some(&kind))?]));
                        continue;
                    }
                }
            }
            residual.push(focal.expr(c)?);
        }
        let filter = residual.into_iter().reduce(|a, b| json!({"and": [a, b]})).unwrap_or(Json::Null);
        Ok((pins, filter))
    }

    fn read(&self, read: &ReadExpr) -> R<Json> {
        let print = || crate::print::read_expr(read);
        if let Some(page) = pages::implicit_page(self.module, read) { return self.read(&page); }
        if let Some(reason) = pages::membership_physical_issue(self.module, read) {
            return no(reason, print());
        }
        if let Some(reason) = pages::compound_physical_issue(self.module, read) { return no(reason, print()); }
        match &read.range {
            None if read.filter.is_none() && !read.keys.is_empty() => {
                if read.index.is_some() || !read.seeks.is_empty() || read.matching.is_some() || !read.computed.is_empty() {
                    return no("read-form", print());
                }
                let table = self.table(&read.table)?;
                Ok(json!({"point": {"table": read.table, "key": self.key(table, &read.keys)?}}))
            }
            None => no("read-unbounded", print()),
            Some(range) => {
                if !read.keys.is_empty() {
                    return no("keyed-range", print());
                }
                let (pins, filter) = self.domain(read, false)?;
                let table = self.table(&read.table)?;
                for c in &read.order_keys {
                    if c != "id" && table.col(c).is_none() {
                        return no("order-column", c.clone());
                    }
                }
                // `by .x, .id` is `by .x`: `id` always breaks ties.
                let mut order = read.order_keys.clone();
                if order.last().is_some_and(|c| c == "id") {
                    order.pop();
                }
                if order.iter().any(|c| c == "id") {
                    return no("order-id-inside", print());
                }
                let after = match &range.cursor {
                    Some(c) => self.expr(c)?,
                    None => Json::Null,
                };
                Ok(json!({"page": {"table": read.table, "pins": pins, "filter": filter, "order": order,
                    "desc": range.order == Order::Desc, "take": range.take, "after": after}}))
            }
        }
    }

    fn write(&self, e: &Expr) -> R<Json> {
        let Expr::Write { op, table, keys, fields, if_absent, condition, .. } = e else { unreachable!() };
        if *op != WriteOp::Insert && keys.is_empty() { return no("row-variable-write", crate::print::expression(e)); }
        let t = self.table(table)?;
        if !t.caps.is_empty() && *op != WriteOp::Delete {
            return no("table-cap", format!("{} writes capped table {table}; the model does not enforce caps", crate::print::expression(e)));
        }
        Ok(match op {
            WriteOp::Insert => {
                if !keys.is_empty() || condition.is_some() {
                    return no("insert-form", crate::print::expression(e));
                }
                json!({"insert": {"table": table, "fields": self.fields(fields, Some(t))?, "ifAbsent": if_absent}})
            }
            WriteOp::Upsert => {
                if *if_absent || condition.is_some() {
                    return no("upsert-form", crate::print::expression(e));
                }
                json!({"upsert": {"table": table, "key": self.key(t, keys)?, "patch": self.fields(fields, Some(t))?}})
            }
            WriteOp::Update => {
                if *if_absent {
                    return no("update-form", crate::print::expression(e));
                }
                let cond = match condition {
                    Some(c) => self.with_focal(table).expr(c)?,
                    None => Json::Null,
                };
                json!({"update": {"table": table, "key": self.key(t, keys)?, "patch": self.fields(fields, Some(t))?, "cond": cond}})
            }
            WriteOp::Delete => {
                if *if_absent || condition.is_some() || !fields.is_empty() {
                    return no("delete-form", crate::print::expression(e));
                }
                json!({"delete": {"table": table, "key": self.key(t, keys)?}})
            }
        })
    }

    fn stmts(&mut self, body: &[Stmt]) -> R<Vec<Json>> {
        let mut out = Vec::new();
        for s in body {
            match s {
                Stmt::Bind { names, value, .. } => {
                    let [name] = names.as_slice() else { return no("bind-destructure", names.join(", ")) };
                    if matches!(value, Expr::Write { .. }) {
                        out.push(json!({"write": {"bind": name, "op": self.write(value)?}}));
                        let ty = match value {
                            Expr::Write { table, .. } => Ty::Row(table.clone()),
                            _ => Ty::Unknown,
                        };
                        self.vars.insert(name.clone(), ty);
                    } else {
                        out.push(json!({"assign": [name, self.expr(value)?]}));
                        let ty = self.ty(value);
                        self.vars.insert(name.clone(), ty);
                    }
                }
                Stmt::Expr { value: value @ Expr::Write { .. }, .. } => out.push(json!({"write": {"bind": null, "op": self.write(value)?}})),
                Stmt::Expr { .. } => return no("expression-statement", "an expression statement"),
                Stmt::Require { condition, code, .. } => out.push(json!({"require": [self.expr(condition)?, code]})),
                Stmt::Return { value: value @ Expr::Write { .. }, .. } => {
                    let fresh = "__lean_returned";
                    out.push(json!({"write": {"bind": fresh, "op": self.write(value)?}}));
                    out.push(json!({"ret": {"var": fresh}}));
                }
                Stmt::Return { value, .. } => out.push(json!({"ret": self.expr(value)?})),
                Stmt::If { condition, then_body, else_body, .. } => {
                    let c = self.expr(condition)?;
                    // Branch locals do not escape (a later use is unsupported).
                    let saved = self.vars.clone();
                    let t = self.stmts(then_body)?;
                    self.vars = saved.clone();
                    let el = self.stmts(else_body)?;
                    self.vars = saved;
                    out.push(json!({"ite": [c, t, el]}));
                }
                Stmt::As { .. } => return no("as-principal", "an `as` block"),
                Stmt::Emit { .. } => return no("emit", "an effect emit"),
                Stmt::For { .. } => return no("loop", "a for loop"),
                Stmt::Break { .. } | Stmt::Continue { .. } => return no("loop", "break/continue"),
            }
        }
        Ok(out)
    }
}

fn flatten_and<'e>(e: &'e Expr, out: &mut Vec<&'e Expr>) {
    match e {
        Expr::Binary { op, left, right, .. } if op == "and" => {
            flatten_and(left, out);
            flatten_and(right, out);
        }
        other => out.push(other),
    }
}

fn column_of(e: &Expr) -> Option<&str> {
    match e {
        Expr::Member { base, name, .. } if matches!(base.as_ref(), Expr::Focal { .. }) => Some(name),
        _ => None,
    }
}

/// Whether `e` mentions the focal row.
fn reads_row(e: &Expr) -> bool {
    match e {
        Expr::Focal { .. } => true,
        Expr::Name { .. } | Expr::Literal { .. } => false,
        Expr::Member { base, .. } => reads_row(base),
        Expr::Unary { value, .. } | Expr::Assert { value, .. } => reads_row(value),
        Expr::Binary { left, right, .. } => reads_row(left) || reads_row(right),
        Expr::Call { args, .. } => args.iter().any(reads_row),
        Expr::Array { items, .. } => items.iter().any(reads_row),
        Expr::If { then, condition, otherwise, .. } => reads_row(then) || reads_row(condition) || reads_row(otherwise),
        // Nested reads, objects and the rest: conservatively the filter.
        _ => true,
    }
}

fn flatten_or<'e>(e: &'e Expr, out: &mut Vec<&'e Expr>) {
    match e {
        Expr::Binary { op, left, right, .. } if op == "or" => {
            flatten_or(left, out);
            flatten_or(right, out);
        }
        other => out.push(other),
    }
}

// The portable key calculation used by optional branch planning. Keeping it
// here makes the oracle gate depend only on surface declarations, never on the
// Rust planner's chosen IR or whether that planner happened to merge the page.
const PORTABLE_KEY_BYTES: usize = 2048;
const PORTABLE_ID_BYTES: usize = 138;

fn model_column_bytes(kind: &Kind) -> usize {
    match kind {
        Kind::Id(_) => PORTABLE_ID_BYTES,
        Kind::Text(Some(max)) => (*max as usize).saturating_mul(4).saturating_add(3),
        Kind::Text(None) => usize::MAX,
        Kind::Int => 9,
        Kind::Bool => 1,
        Kind::Cursor => usize::MAX,
    }
}

fn model_title(value: &str) -> String {
    let mut chars = value.chars();
    chars.next().map(|first| first.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default()
}

fn model_total_unique(table: &Table, index: &ast::IndexDecl) -> bool {
    index.unique && index.is_plain() && index.columns.iter().all(|column| column == "id"
        || table.cols.iter().find(|candidate| candidate.name == *column).is_some_and(|candidate| !candidate.nullable && candidate.on_delete != Some("setNull")))
}

/// The physical index the native planner can reuse for a requested lane.
/// Its components must have the planner's exact sorted-prefix order. A
/// cursorless source may reuse a matching unique without its trailing `id`;
/// a cursored target needs that unique to be total.
// @ref LLP 3000.036.001#14 — the pre-oracle physical gate prices the native-compatible declared PAGE lane.
fn model_declared_indexes<'a>(module: &'a LeanModule, table: &Table, columns: &[String], cursor: bool) -> Vec<&'a ast::IndexDecl> {
    let Some(decl) = module.surface_tables.iter().find(|decl| decl.name == table.name) else { return Vec::new() };
    decl.indexes.iter().filter(|index| index.is_plain() && (index.columns == columns
        || index.unique && (!cursor || model_total_unique(table, index)) && columns.last().map(String::as_str) == Some("id")
            && index.columns == columns[..columns.len() - 1])).collect()
}

fn model_index_label_fits(module: &LeanModule, table: &Table, columns: &[String], declared: Option<&ast::IndexDecl>) -> bool {
    let Some(decl) = module.surface_tables.iter().find(|decl| decl.name == table.name) else { return false };
    if let Some(index) = declared.or_else(|| decl.indexes.iter().filter(|index| index.is_plain() && index.columns == columns).min_by_key(|index| &index.name)) {
        return table.name.len().saturating_add(index.name.len()) <= snapback4_core::rows::MAX_INDEX_LABEL_BYTES;
    }
    let mut components = columns.to_vec();
    if components.len() > 1 && components.last().is_some_and(|column| column == "id") { components.pop(); }
    let base = format!("by{}", components.iter().map(|column| model_title(column)).collect::<String>());
    // `$intent:{base}:` plus the ordinary 16-byte digest suffix. A collision
    // can only lengthen the suffix, so a name already over budget cannot be a
    // physical PAGE lane on every store.
    let generated = "$intent:".len().saturating_add(base.len()).saturating_add(1 + 16);
    table.name.len().saturating_add(generated) <= snapback4_core::rows::MAX_INDEX_LABEL_BYTES
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ModelIndexFit { Fits, Nonportable, Ambiguous }

fn model_plain_index_fit(module: &LeanModule, table: &Table, columns: &[String], cursor: bool) -> ModelIndexFit {
    let declared = model_declared_indexes(module, table, columns, cursor);
    if declared.len() > 1 { return ModelIndexFit::Ambiguous }
    let selected = declared.first().copied();
    let physical = selected.map_or(columns, |index| index.columns.as_slice());
    let fits = physical.len() <= 8 && model_index_label_fits(module, table, physical, selected) && physical.iter().fold(PORTABLE_ID_BYTES, |bytes, column| {
        bytes.saturating_add(table.col(column).map_or(usize::MAX, |kind| model_column_bytes(&kind)))
    }) <= PORTABLE_KEY_BYTES;
    if fits { ModelIndexFit::Fits } else { ModelIndexFit::Nonportable }
}

fn model_selected_index_fit(module: &LeanModule, table: &Table, name: &str) -> ModelIndexFit {
    let Some(decl) = module.surface_tables.iter().find(|decl| decl.name == table.name) else { return ModelIndexFit::Nonportable };
    let Some(index) = decl.indexes.iter().find(|index| index.name == name && index.is_plain()) else { return ModelIndexFit::Nonportable };
    let fits = index.columns.len() <= 8
        && model_index_label_fits(module, table, &index.columns, Some(index))
        && index.columns.iter().fold(PORTABLE_ID_BYTES, |bytes, column| {
            bytes.saturating_add(table.col(column).map_or(usize::MAX, |kind| model_column_bytes(&kind)))
        }) <= PORTABLE_KEY_BYTES;
    if fits { ModelIndexFit::Fits } else { ModelIndexFit::Nonportable }
}

fn model_read_by_form(rule: &Expr, pins: &[(String, &Expr)]) -> bool {
    let pinned = |column: &str| pins.iter().find_map(|(name, value)| (name == column).then_some(*value));
    let viewer = |value: &Expr| matches!(value, Expr::Name { name, .. } if name == "viewer");
    match rule {
        Expr::Name { name, .. } if name == "allow" => true,
        Expr::Binary { op, left, right, .. } if op == "or" =>
            model_read_by_form(left, pins) || model_read_by_form(right, pins),
        Expr::Binary { op, left, right, .. } if op == "and" =>
            model_read_by_form(left, pins) && model_read_by_form(right, pins),
        Expr::Binary { op, left, right, .. } if op == "=" => {
            let (column, value) = match (column_of(left), column_of(right)) {
                (Some(column), None) => (column, right.as_ref()),
                (None, Some(column)) => (column, left.as_ref()),
                _ => return false,
            };
            match (value, pinned(column)) {
                (value, Some(pin)) if viewer(value) => viewer(pin),
                (Expr::Literal { value, .. }, Some(Expr::Literal { value: pin, .. })) =>
                    value == pin && !matches!(value, Literal::Null),
                _ => false,
            }
        }
        _ => false,
    }
}

fn model_independent(expression: &Expr) -> bool {
    match expression {
        Expr::Literal { .. } | Expr::Name { .. } => true,
        Expr::Member { base, .. } | Expr::Unary { value: base, .. } => model_independent(base),
        Expr::Binary { left, right, .. } => model_independent(left) && model_independent(right),
        Expr::Call { args, .. } | Expr::Array { items: args, .. } => args.iter().all(model_independent),
        _ => false,
    }
}

fn model_equality_column(table: &Table, expression: &Expr) -> Option<String> {
    if let Expr::Binary { op, left, right, .. } = expression && op == "=" {
        if let Some(column) = column_of(left) && model_independent(right) && table.col(column).is_some() { return Some(column.into()) }
        if let Some(column) = column_of(right) && model_independent(left) && table.col(column).is_some() { return Some(column.into()) }
    }
    let value = if let Expr::Unary { op, value, .. } = expression && op == "not" { value.as_ref() } else { expression };
    let column = column_of(value)?;
    matches!(table.col(column), Some(Kind::Bool)).then(|| column.into())
}

fn model_pin_columns(table: &Table, expressions: &[&Expr], order: &[String]) -> Vec<String> {
    expressions.iter().filter_map(|expression| model_equality_column(table, expression))
        .filter(|column| column != "id" && !order.contains(column)).collect::<BTreeSet<_>>().into_iter().collect()
}

fn model_lane_columns(mut pins: Vec<String>, order: &[String]) -> Vec<String> {
    for column in order {
        if !pins.contains(column) { pins.push(column.clone()); }
    }
    if !pins.iter().any(|column| column == "id") { pins.push("id".into()); }
    pins
}

/// Equality prefixes for the original system scan and for each PAGE filter
/// alternative. Pins are sorted like the planner's `BTreeMap`, then the
/// shared order and id suffix are appended separately by the caller.
fn model_page_pins(table: &Table, read: &ReadExpr) -> (Vec<String>, Vec<Vec<String>>) {
    let Some(filter) = read.filter.as_deref() else { return (Vec::new(), vec![Vec::new()]) };
    let mut conjuncts = Vec::new();
    flatten_and(filter, &mut conjuncts);
    let system = model_pin_columns(table, &conjuncts, &read.order_keys);
    let ors: Vec<_> = conjuncts.iter().enumerate().filter(|(_, expression)| matches!(expression, Expr::Binary { op, .. } if op == "or")).collect();
    let [(position, expression)] = ors.as_slice() else { return (system.clone(), vec![system]) };
    let mut alternatives = Vec::new();
    flatten_or(expression, &mut alternatives);
    let rest: Vec<_> = conjuncts.iter().enumerate().filter_map(|(at, expression)| (at != *position).then_some(*expression)).collect();
    let branches: Option<Vec<Vec<String>>> = alternatives.into_iter().map(|alternative| {
        let mut parts = Vec::new();
        flatten_and(alternative, &mut parts);
        let alternative_pins = model_pin_columns(table, &parts, &read.order_keys);
        if alternative_pins.is_empty() { return None }
        parts.extend(rest.iter().copied());
        Some(model_pin_columns(table, &parts, &read.order_keys))
    }).collect();
    (system.clone(), branches.filter(|branches| branches.len() >= 2).unwrap_or_else(|| vec![system]))
}

fn party_column<'a>(table: &Table, expression: &'a Expr) -> Option<&'a str> {
    let Expr::Binary { op, left, right, .. } = expression else { return None };
    if op != "=" { return None }
    let viewer = |value: &Expr| matches!(value, Expr::Name { name, .. } if name == "viewer");
    let column = if viewer(left) { column_of(right) } else if viewer(right) { column_of(left) } else { None }?;
    table.col(column).is_some().then_some(column)
}

fn membership_probe_kind(focal: &Table, expression: &Expr) -> Option<Kind> {
    match expression {
        Expr::Name { name, .. } if name == "viewer" => Some(Kind::Id(IdSort::Principal)),
        Expr::Member { base, name, .. } if matches!(base.as_ref(), Expr::Focal { .. }) => focal.col(name),
        Expr::Literal { value, .. } => literal_scalar(value).ok()?.1,
        Expr::Unary { op, value, .. } if op == "-"
            && matches!(value.as_ref(), Expr::Literal { value: Literal::Number(_), .. }) => Some(Kind::Int),
        _ => None,
    }
}

struct ModelMembershipPhysical {
    source: String,
    columns: Vec<String>,
    index: Option<String>,
    target_parent: String,
    source_admissible: bool,
}

/// The physical source key and target parent column of one membership leaf.
/// A fully pinned total unique may replace the provisional discovery key; the
/// other fixed equalities are residuals on its at-most-one row. Otherwise an
/// applicable cap or the rule probe's total point admits metered discovery.
fn membership_physical(module: &LeanModule, focal: &Table, expression: &Expr) -> Option<ModelMembershipPhysical> {
    let Expr::Exists { read, .. } = expression else { return None };
    if read.range.is_some() || read.filter.is_some() || read.keys.is_empty() { return None }
    let source = module.tables.iter().find(|table| table.name == read.table)?;
    let kinds = read.keys.iter().map(|key| membership_probe_kind(focal, &key.value)).collect::<Vec<_>>();
    // Resolve from surface-declared unique keys and surface expression types,
    // independently of whatever plan the Rust binder selected. `Table::uniques`
    // deliberately excludes synthesized indexes.
    let columns = resolve_key(source, &read.keys, &kinds).ok()?;
    let mut fixed_terms = Vec::new();
    let mut target = None;
    for (key, column) in read.keys.iter().zip(&columns) {
        if let Some(parent) = column_of(&key.value) {
            if target.replace((column.clone(), parent.to_owned())).is_some() { return None }
        } else if !reads_row(&key.value) {
            // A fixed source id remains an exact witness constraint, but PAGE
            // evaluates it as a residual. It is neither a discovery prefix nor
            // a cap grouping term; physical indexes always append id last.
            if column != "id" { fixed_terms.push((column.clone(), &key.value)); }
        } else {
            return None;
        }
    }
    let (source_parent, target_parent) = target?;
    let bounded = source.caps.iter().any(|(_, by)|
        by.iter().all(|column| column != "id" && fixed_terms.iter().any(|term| &term.0 == column)
            && !source.cols.iter().any(|col| &col.name == column && col.on_delete == Some("setNull"))));
    let mut fixed = fixed_terms.iter().map(|term| term.0.clone()).collect::<Vec<_>>();
    fixed.sort();
    fixed.dedup();
    let source_parent_is_id = source_parent == "id";
    let surface = module.surface_tables.iter().find(|table| table.name == source.name);
    let point_total = surface.is_some_and(|table| table.indexes.iter().any(|index|
        model_total_unique(source, index)
            && read.index.as_ref().is_none_or(|name| name == &index.name)
            && index.columns.iter().all(|column| columns.contains(column))));
    let read_rule = surface.and_then(|table| {
        let rules = table.rules.iter().filter(|rule| rule.effect == Effect::Read).collect::<Vec<_>>();
        match rules.as_slice() { [rule] => Some(&rule.value), _ => None }
    });
    let one_row = surface.and_then(|table| table.indexes.iter().filter(|index| {
        let point = fixed_terms.iter().filter(|term| index.columns.contains(&term.0)).cloned().collect::<Vec<_>>();
        model_total_unique(source, index)
            && index.columns.iter().all(|column| fixed.contains(column))
            && read_rule.is_some_and(|rule| model_read_by_form(rule, &point))
    }).min_by_key(|index| (index.columns.len(), &index.name)));
    let (source_key, source_index, source_admissible) = if let Some(index) = one_row {
        (index.columns.clone(), Some(index.name.clone()), true)
    } else {
        let mut source_key = fixed;
        if !source_key.contains(&source_parent) { source_key.push(source_parent); }
        if !source_key.iter().any(|column| column == "id") { source_key.push("id".into()); }
        // The ordinary path remains valid when `id` is a physical next component.
        // Only a reused declared index that omits it needs the one-row total-unique
        // proof; zero candidates means the planner synthesizes `source_key`, while
        // multiple candidates are rejected separately as ambiguous.
        let candidates = model_declared_indexes(module, source, &source_key, false);
        let total_id_source = !source_parent_is_id || match candidates.as_slice() {
            [index] => index.columns.iter().any(|column| column == "id") || model_total_unique(source, index),
            [] | [_, _, ..] => true,
        };
        (source_key, None, total_id_source && (bounded || point_total))
    };
    Some(ModelMembershipPhysical { source: source.name.clone(), columns: source_key, index: source_index, target_parent, source_admissible })
}

/// A returned page whose `where` holds both a guard and an argument-presence
/// test (`x = null or …` on an optional argument): the compiler expands the
/// presence variants first (`bind/intent_variants.rs`), and the page it then
/// returns is no longer the one the guard lowering sees. Not translated.
fn presence_and_guard(body: &[Stmt], args: &[(String, Kind, bool)]) -> bool {
    let optional = |e: &Expr| matches!(e, Expr::Name { name, .. } if args.iter().any(|(n, _, o)| n == name && *o));
    let null = |e: &Expr| matches!(e, Expr::Literal { value: Literal::Null, .. });
    let presence = |e: &Expr| matches!(e, Expr::Binary { op, left, right, .. } if op == "="
        && (optional(left) && null(right) || null(left) && optional(right)));
    body.iter().any(|s| match s {
        Stmt::If { then_body, else_body, .. } => presence_and_guard(then_body, args) || presence_and_guard(else_body, args),
        Stmt::Return { value: Expr::Read(read), .. } => read.filter.as_deref().is_some_and(|f| {
            let mut conjuncts = Vec::new();
            flatten_and(f, &mut conjuncts);
            crate::bind::where_guards::has_guard(f) && conjuncts.iter().any(|c| matches!(c, Expr::Binary { op, left, right, .. } if op == "or" && (presence(left) || presence(right))))
        }),
        _ => false,
    })
}

fn program(module: &LeanModule, helpers: &[String], p: &ast::ProgramDecl, args: &[(String, Kind, bool)]) -> R<Json> {
    for (present, what) in [
        (p.delivery.is_some(), "delivery"),
        (p.held, "held"),
        (p.predicts, "predicts"),
        (p.server, "server"),
        (p.native, "native"),
        (!p.prelude.is_empty(), "prelude"),
    ] {
        if present {
            return no(&format!("program-{what}"), p.name.clone());
        }
    }
    let kind = match p.kind {
        ast::ProgramKind::Query => "query",
        ast::ProgramKind::Mutation => "mutation",
        ast::ProgramKind::Job => return no("program-job", p.name.clone()),
    };
    // @ref LLP 3000.036#15.4 — the compiler decides a row-independent test in a
    // returned page's `where` once, as an `if`; the model runs that program.
    let mut lowered = p.clone();
    if presence_and_guard(&p.body, args) {
        return no("where-guard-presence", p.name.clone());
    }
    crate::bind::where_guards::lower_program(&mut lowered);
    let mut scope = Scope::new(module, helpers);
    for (name, k, _) in args {
        scope.vars.insert(name.clone(), Ty::Scalar(k.clone()));
    }
    let body = scope.stmts(&lowered.body)?;
    Ok(json!({
        "name": p.name, "kind": kind,
        "params": args.iter().map(|(n, _, optional)| json!({"name": n, "optional": optional})).collect::<Vec<_>>(),
        "body": body,
    }))
}

impl LeanModule {
    /// A program's case JSON, or why it is outside the fragment.
    pub fn program(&self, name: &str) -> R<&Json> {
        match self.programs.get(name) {
            Some(Ok(p)) => Ok(p), Some(Err(e)) => Err(e.clone()),
            None => no("program-unknown", name),
        }
    }
    fn tag(&self, kind: &Kind, nullable: bool, v: &Json, at: &str) -> R<Json> {
        if v.is_null() { return if nullable { Ok(json!({"null": null})) } else { no("input-null", at) }; }
        Ok(match (kind, v) {
            (Kind::Int, Json::Number(n)) if n.is_i64() => json!({"int": n.as_i64().unwrap().to_string()}),
            (Kind::Text(max), Json::String(s)) => {
                if max.is_some_and(|m| s.chars().count() > m as usize) { return no("text-bound", at); }
                json!({"text": s})
            }
            (Kind::Id(_), Json::String(s)) => json!({"id": s}),
            (Kind::Bool, Json::Bool(b)) => json!({"bool": b}),
            (Kind::Cursor, _) => return no("engine-cursor", at),
            _ => return no("input-kind", format!("{at}: {v}")),
        })
    }

    /// The model's store from the harness's untyped rows (`wire` JSON).
    pub fn store(&self, rows: &[(String, Json)]) -> R<Json> {
        let mut out: Map<String, Json> = self.tables.iter().map(|t| (t.name.clone(), json!([]))).collect();
        for (name, row) in rows {
            let Some(t) = self.tables.iter().find(|t| &t.name == name) else { return no("row-table", name.clone()) };
            let Some(obj) = row.as_object() else { return no("row-form", name.clone()) };
            let Some(id) = obj.get("id").and_then(Json::as_str) else { return no("row-id", name.clone()) };
            if let Some(extra) = obj.keys().find(|k| *k != "id" && t.col(k).is_none())
                { return no("row-column", format!("{name}.{extra}")); }
            let mut cols = Map::new();
            for c in &t.cols {
                let v = obj.get(&c.name).cloned().unwrap_or(Json::Null);
                cols.insert(c.name.clone(), self.tag(&c.kind, c.nullable, &v, &format!("{name}.{}", c.name))?);
            }
            out[name.as_str()].as_array_mut().unwrap().push(json!({"id": id, "cols": cols}));
        }
        Ok(Json::Object(out))
    }

    /// Tag untyped arguments by the program's declared types. A `cursor`
    /// argument must be null here; the harness supplies the model's own
    /// cursor (a key tuple, OPEN C1) for continuations.
    pub fn tag_args(&self, entry: &str, untyped: &Json) -> R<Map<String, Json>> {
        let Some(args) = self.args.get(entry) else { return no("program-unknown", entry) };
        let mut out = Map::new();
        for (name, kind, optional) in args {
            let v = untyped.get(name).cloned().unwrap_or(Json::Null);
            out.insert(name.clone(), self.tag(kind, *optional, &v, name)?);
        }
        Ok(out)
    }

    /// One complete case for `entry`.
    pub fn case(&self, entry: &str, store: Json, viewer: &str, args: Map<String, Json>, budget: Option<u64>) -> R<Json> {
        self.case_at(entry, store, viewer, args, budget, 0)
    }

    /// One complete case for `entry`, evaluated at the server request clock.
    pub fn case_at(&self, entry: &str, store: Json, viewer: &str, args: Map<String, Json>, budget: Option<u64>, now: i64) -> R<Json> {
        Ok(json!({
            "version": 1, "schema": self.schema, "helpers": self.helpers, "store": store,
            "viewer": viewer, "now": now, "program": self.program(entry)?, "args": args, "budget": budget,
        }))
    }
    /// The schema, helpers and every supported program (`check --emit-lean`).
    pub fn to_json(&self) -> Json {
        let mut programs = Map::new();
        let mut unsupported = Map::new();
        for (name, p) in &self.programs {
            match p {
                Ok(p) => { programs.insert(name.clone(), p.clone()); }
                Err(e) => { unsupported.insert(name.clone(), json!(e)); }
            }
        }
        json!({"version": 1, "schema": self.schema, "helpers": self.helpers, "programs": programs, "unsupported": unsupported})
    }
}
