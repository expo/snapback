//! A row-independent test inside a returned page's `where` is a guard: `tickets
//! where exists staff[viewer] and .open = true` is `if exists staff[viewer]:`
//! the page without it, else nothing; `tickets where .owner = viewer or exists
//! staff[viewer]` is `if exists staff[viewer]:` every row, else the owner's.
//! The test reads no row, so it has one value for the whole scan; deciding it
//! once is the same answer, and the `if` is the shape completeness already
//! follows (LLP 3000.036 §14.1). Without this, a non-staff caller walked every
//! row for a necessarily empty answer and got `capped` (wave 5, lanes 053 088 098).
//!
//! Only tests that cannot refuse move (probes by key, comparisons of names and
//! literals, `not`/`and`/`or`), and only when every operand evaluated before
//! them per row cannot refuse either, so no refusal is gained or lost: the
//! original's short-circuit order is kept exactly.
// @ref LLP 3000.036#15.4 — a grant in `where` lowers to the `if` guard; check and the runtime then agree.
use super::catalog::Catalog;
use crate::ast::*;

pub(super) fn lower(catalog: &mut Catalog) {
    for doc in &mut catalog.documents {
        for program in &mut doc.programs { lower_program(program); }
    }
}

/// The lowering of one program, as the compiler applies it (the Lean emitter
/// translates the lowered program, so the model runs what the engine runs).
pub(crate) fn lower_program(program: &mut ProgramDecl) {
    if program.kind == ProgramKind::Query && !program.native { body(&mut program.body); }
}

fn body(statements: &mut Vec<Stmt>) {
    for stmt in statements.iter_mut() {
        match stmt {
            Stmt::If { then_body, else_body, .. } => { body(then_body); body(else_body); }
            Stmt::Return { value, site } => {
                if let Some(lowered) = page(value, site) { *stmt = lowered; }
            }
            _ => {}
        }
    }
}

/// The returned read, through one projection.
fn read_of(value: &mut Expr) -> Option<&mut ReadExpr> {
    match value {
        Expr::Read(read) => Some(read),
        Expr::ShapeUse { base, .. } | Expr::Shape { base, .. } => match base.as_mut() { Expr::Read(read) => Some(read), _ => None },
        _ => None,
    }
}

pub(crate) struct Split { guard: Expr, conjunctive: bool, rest: Option<Expr> }

fn page(value: &Expr, site: &crate::diag::Site) -> Option<Stmt> {
    let mut value = value.clone();
    let read = read_of(&mut value)?;
    let Split { guard, conjunctive, rest } = split(read.filter.as_deref()?)?;
    let empty = Expr::Array { items: Vec::new(), site: site.clone() };
    let with = |filter: Option<Expr>| { let mut value = value.clone(); read_of(&mut value).unwrap().filter = filter.map(Box::new); value };
    let (then, otherwise) = if conjunctive {
        // `G and R`: G holds → the page over R; otherwise no row passes.
        (with(rest), empty)
    } else {
        // `G or R`: G holds → every row passes; otherwise the page over R.
        let otherwise = if rest.is_some() { with(rest) } else { empty };
        (with(None), otherwise)
    };
    Some(Stmt::If { condition: guard, then_body: vec![Stmt::Return { value: then, site: site.clone() }], else_body: vec![Stmt::Return { value: otherwise, site: site.clone() }], site: site.clone() })
}

/// The guard of a page filter, when one can move out of the scan.
pub(crate) fn split(filter: &Expr) -> Option<Split> {
    let conjunctive = matches!(filter, Expr::Binary { op, .. } if op == "and");
    let op = if conjunctive { "and" } else { "or" };
    let mut parts = Vec::new();
    chain(filter, op, &mut parts);
    let last = parts.iter().rposition(|part| guard(part))?;
    // Every operand evaluated per row before the last guard must be unable to refuse.
    if !parts[..last].iter().all(|part| pure(part)) { return None; }
    let (guards, rest): (Vec<Expr>, Vec<Expr>) = parts.into_iter().partition(guard);
    let join = |items: Vec<Expr>| items.into_iter().reduce(|left, right| Expr::Binary { site: left.site().clone(), op: op.into(), left: Box::new(left), right: Box::new(right) });
    Some(Split { guard: join(guards)?, conjunctive, rest: join(rest) })
}

/// Whether a page filter holds a guard this lowering moves.
pub(crate) fn has_guard(filter: &Expr) -> bool { split(filter).is_some() }

fn chain(value: &Expr, op: &str, out: &mut Vec<Expr>) {
    if let Expr::Binary { op: here, left, right, .. } = value && here == op { chain(left, op, out); chain(right, op, out); }
    else { out.push(value.clone()); }
}

/// Reads no column of the scanned row, and cannot refuse.
fn guard(value: &Expr) -> bool { pure(value) && !focal(value) }

fn focal(value: &Expr) -> bool {
    match value {
        Expr::Focal { .. } => true,
        Expr::Member { base, .. } | Expr::Unary { value: base, .. } => focal(base),
        Expr::Binary { left, right, .. } => focal(left) || focal(right),
        Expr::Exists { read, .. } => read.keys.iter().any(|key| focal(&key.value)),
        _ => false,
    }
}

/// Evaluates without a refusal: a column of the row, a name, a literal, a
/// comparison or connective of those, or a probe by key.
fn pure(value: &Expr) -> bool {
    match value {
        Expr::Name { .. } | Expr::Literal { .. } => true,
        Expr::Member { base, .. } => matches!(base.as_ref(), Expr::Focal { .. }),
        Expr::Unary { op, value, .. } => op == "not" && pure(value),
        Expr::Binary { op, left, right, .. } => matches!(op.as_str(), "and" | "or" | "=" | "!=" | "<" | "<=" | ">" | ">=" | "in") && pure(left) && pure(right),
        Expr::Exists { read, .. } => read.filter.is_none() && read.matching.is_none() && read.range.is_none() && read.seeks.is_empty() && read.order_keys.is_empty()
            && !read.keys.is_empty() && read.keys.iter().all(|key| pure(&key.value)),
        _ => false,
    }
}
